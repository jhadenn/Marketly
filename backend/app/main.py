import logging

from fastapi import BackgroundTasks, Depends, FastAPI, HTTPException, Header, Query, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.auth import get_current_user_id, try_get_current_user_id_from_authorization
from app.connectors import CONNECTORS
from app.connectors.facebook_marketplace import (
    FacebookConnectorError,
    FacebookConnectorErrorCode,
    FacebookConnectorErrorPayload,
    FacebookMarketplaceConnector,
    FacebookSearchRequest,
    FacebookSearchResponse,
)
from app.core.config import settings
from app.core.logging import setup_logging
from app.db import get_db
from app.models.listing import SearchResponse, SearchSort, Source
from app.models.saved_search import SavedSearch
from app.schemas.copilot import CopilotQueryRequest, CopilotQueryResponse
from app.models.user_facebook_credential import UserFacebookCredential
from app.schemas.notifications import SavedSearchNotificationOut
from app.schemas.facebook_credentials import (
    FacebookConnectorStatusResponse,
    FacebookCookieUploadRequest,
    FacebookVerifyResponse,
)
from app.schemas.saved_search import SavedSearchCreate, SavedSearchOut, SavedSearchUpdate
from app.services.facebook_credentials import (
    decrypt_cookie_payload,
    delete_user_facebook_credential,
    get_user_facebook_credential,
    mark_credential_failed,
    mark_credential_used,
    mark_credential_validated,
    upsert_user_facebook_credential,
)
from app.services.rate_limit import check_rate_limit, get_client_ip
from app.services.response_cache import (
    build_search_response_cache_key,
    get_cached_search_response,
    is_search_response_cache_active,
    set_cached_search_response,
)
from app.services.alerts import list_notifications, mark_notification_read
from app.services.gemini_client import generate_copilot_response
from app.services.listing_insights import enrich_listings_with_insights
from app.services.listing_snapshots import persist_listing_snapshots
from app.services.search_service import FacebookRuntimeContext, unified_search
from app.services.supabase_ingestion import upsert_facebook_records

setup_logging()
logger = logging.getLogger(__name__)

app = FastAPI(title="Marketly API", version="0.1.0")
print("LOADED MAIN.PY", __file__)

default_cors_origins = {
    "http://localhost:3000",
    "http://127.0.0.1:3000",
}
configured_cors_origins = (settings.CORS_ORIGINS or "").strip()
if configured_cors_origins:
    for raw_origin in configured_cors_origins.split(","):
        normalized_origin = raw_origin.strip()
        if normalized_origin:
            default_cors_origins.add(normalized_origin)

app.add_middleware(
    CORSMiddleware,
    allow_origins=sorted(default_cors_origins),
    allow_origin_regex=r"https://.*\.vercel\.app",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

DEFAULT_SOURCES: list[Source] = ["ebay", "kijiji", "facebook"]
facebook_connector = FacebookMarketplaceConnector()


def _dt_str(value) -> str | None:
    if value is None:
        return None
    return str(value)


def _facebook_status_response(
    row: UserFacebookCredential | None,
) -> FacebookConnectorStatusResponse:
    return FacebookConnectorStatusResponse(
        configured=row is not None,
        feature_enabled=settings.MARKETLY_ENABLE_FACEBOOK,
        status=(row.status if row else None),
        cookie_count=(row.cookie_count if row else None),
        last_error_code=(row.last_error_code if row else None),
        last_error_message=(row.last_error_message if row else None),
        last_validated_at=_dt_str(row.last_validated_at if row else None),
        last_used_at=_dt_str(row.last_used_at if row else None),
        updated_at=_dt_str(row.updated_at if row else None),
    )


def _build_facebook_runtime_context(
    *,
    db: Session,
    user_id: str | None,
    latitude: float | None,
    longitude: float | None,
    radius_km: int | None,
) -> FacebookRuntimeContext:
    context = FacebookRuntimeContext(
        user_id=user_id,
        latitude=latitude,
        longitude=longitude,
        radius_km=radius_km,
    )
    if not user_id:
        return context

    row = get_user_facebook_credential(db, user_id)
    if not row:
        return context

    try:
        cookie_payload = decrypt_cookie_payload(row.encrypted_cookie_json)
    except Exception as exc:
        logger.warning("facebook_byoc_decrypt_failed user_id=%s error=%s", user_id, exc)
        return context

    try:
        mark_credential_used(db, row, commit=True)
    except Exception as exc:
        db.rollback()
        logger.warning("facebook_byoc_mark_used_failed user_id=%s error=%s", user_id, exc)

    context.cookie_payload = cookie_payload
    context.credential_fingerprint_sha256 = row.cookie_fingerprint_sha256
    return context


def _normalize_source_name(name: str) -> str:
    normalized = name.strip().lower()
    if normalized == "facebook_marketplace":
        return "facebook"
    return normalized


def _saved_search_out(row: SavedSearch) -> SavedSearchOut:
    return SavedSearchOut(
        id=row.id,
        query=row.query,
        sources=[s.strip() for s in row.sources.split(",") if s.strip()],
        alerts_enabled=bool(getattr(row, "alerts_enabled", True)),
        last_alert_checked_at=_dt_str(getattr(row, "last_alert_checked_at", None)),
        last_alert_notified_at=_dt_str(getattr(row, "last_alert_notified_at", None)),
        created_at=str(row.created_at),
    )


def _enrich_results(
    db: Session,
    *,
    query: str,
    results,
):
    try:
        enrich_listings_with_insights(db, query, results)
    except Exception as exc:
        logger.warning("listing insight enrichment failed query=%s error=%s", query, exc)
    return results


def parse_sources(raw_sources: list[str] | None, *, include_facebook: bool = False) -> list[str]:
    if not raw_sources:
        deduped = list(DEFAULT_SOURCES)
    else:
        parsed: list[str] = []
        for source_value in raw_sources:
            for token in source_value.split(","):
                cleaned = _normalize_source_name(token)
                if cleaned:
                    parsed.append(cleaned)

        if not parsed:
            raise HTTPException(status_code=400, detail="No sources provided")

        deduped = []
        seen: set[str] = set()
        for source_name in parsed:
            if source_name in seen:
                continue
            seen.add(source_name)
            deduped.append(source_name)

    if include_facebook and "facebook" not in deduped:
        deduped.append("facebook")
    return deduped


def _rate_limited_response(retry_after_seconds: int) -> JSONResponse:
    retry_after = max(1, int(retry_after_seconds))
    return JSONResponse(
        status_code=429,
        content={
            "code": "RATE_LIMITED",
            "message": "Rate limit exceeded",
            "retry_after_seconds": retry_after,
        },
        headers={"Retry-After": str(retry_after)},
    )


def _apply_rate_limit(
    *,
    bucket: str,
    identifier: str | None,
    limit: int,
    window_seconds: int,
) -> JSONResponse | None:
    if not identifier:
        return None
    decision = check_rate_limit(
        bucket=bucket,
        identifier=identifier,
        limit=limit,
        window_seconds=window_seconds,
    )
    if decision.allowed:
        return None
    retry_after = decision.retry_after_seconds or window_seconds
    return _rate_limited_response(retry_after)


@app.get("/health")
def health():
    return {"status": "ok"}


@app.get("/sources")
def sources():
    return {"sources": sorted(CONNECTORS.keys())}


@app.get("/search", response_model=SearchResponse)
async def search(
    request: Request,
    response: Response,
    background_tasks: BackgroundTasks,
    q: str = Query(min_length=1, description="Search query"),
    sources: list[str] | None = Query(
        default=None,
        description="Sources (comma-separated or repeated query param)",
    ),
    limit: int = Query(default=20, ge=1, le=50),
    offset: int = Query(default=0, ge=0),
    sort: SearchSort = Query(default="relevance"),
    include_facebook: bool = Query(
        default=False,
        description="Include facebook source in addition to selected sources",
    ),
    latitude: float | None = Query(default=None, ge=-90, le=90),
    longitude: float | None = Query(default=None, ge=-180, le=180),
    radius_km: int | None = Query(default=None, ge=1, le=500),
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
):
    source_list = parse_sources(sources, include_facebook=include_facebook)

    for source_name in source_list:
        if source_name not in CONNECTORS:
            raise HTTPException(status_code=400, detail=f"Unknown source: {source_name}")

    optional_user_id = try_get_current_user_id_from_authorization(authorization)
    client_ip = get_client_ip(request)
    limited = _apply_rate_limit(
        bucket="search_ip",
        identifier=client_ip,
        limit=int(settings.MARKETLY_RATE_LIMIT_SEARCH_IP_PER_MIN),
        window_seconds=60,
    )
    if limited is not None:
        return limited
    if optional_user_id:
        limited = _apply_rate_limit(
            bucket="search_user",
            identifier=optional_user_id,
            limit=int(settings.MARKETLY_RATE_LIMIT_SEARCH_USER_PER_MIN),
            window_seconds=60,
        )
        if limited is not None:
            return limited

    facebook_runtime_context = None
    if "facebook" in source_list:
        facebook_runtime_context = _build_facebook_runtime_context(
            db=db,
            user_id=optional_user_id,
            latitude=latitude,
            longitude=longitude,
            radius_km=radius_km,
        )

    cache_key = build_search_response_cache_key(
        query=q,
        sources=source_list,
        limit=limit,
        offset=offset,
        sort=sort,
        facebook_runtime_context=facebook_runtime_context,
    )
    cache_active = is_search_response_cache_active()
    cached_payload = get_cached_search_response(cache_key) if cache_active else None
    if cached_payload is not None:
        response.headers["X-Cache"] = "HIT"
        cached_response = SearchResponse.model_validate(cached_payload)
        background_tasks.add_task(
            persist_listing_snapshots,
            query=q,
            listings=cached_response.results,
            user_id=optional_user_id,
        )
        return cached_response

    if facebook_runtime_context is None:
        results, total, next_offset, source_errors = await unified_search(
            query=q,
            sources=source_list,
            limit=limit,
            offset=offset,
            sort=sort,
        )
    else:
        results, total, next_offset, source_errors = await unified_search(
            query=q,
            sources=source_list,
            limit=limit,
            offset=offset,
            sort=sort,
            facebook_runtime_context=facebook_runtime_context,
        )

    _enrich_results(db, query=q, results=results)
    typed_sources: list[Source] = [source_name for source_name in source_list]

    payload = SearchResponse(
        query=q,
        sources=typed_sources,
        count=len(results),
        results=results,
        next_offset=next_offset,
        total=total,
        source_errors=source_errors,
    )
    if cache_active:
        set_cached_search_response(cache_key, payload.model_dump(mode="json"))
    background_tasks.add_task(
        persist_listing_snapshots,
        query=q,
        listings=results,
        user_id=optional_user_id,
    )
    response.headers["X-Cache"] = "MISS" if cache_active else "BYPASS"
    return payload


@app.post("/connectors/facebook/search", response_model=FacebookSearchResponse)
async def facebook_search(payload: FacebookSearchRequest):
    if not settings.MARKETLY_ENABLE_FACEBOOK:
        return FacebookSearchResponse(
            query=payload.query,
            auth_mode=payload.auth_mode,
            count=0,
            records=[],
            upserted_count=0,
            error=FacebookConnectorErrorPayload(
                code=FacebookConnectorErrorCode.disabled,
                message="Facebook connector is disabled by server configuration.",
                retryable=False,
            ),
        )

    try:
        records = await facebook_connector.search(payload)
    except FacebookConnectorError as exc:
        logger.warning("facebook_search_error code=%s message=%s", exc.code.value, exc.message)
        return FacebookSearchResponse(
            query=payload.query,
            auth_mode=payload.auth_mode,
            count=0,
            records=[],
            upserted_count=0,
            error=exc.to_payload(),
        )
    except Exception as exc:
        logger.exception("facebook_search_unhandled_error")
        fallback_error = FacebookConnectorError(
            FacebookConnectorErrorCode.scrape_failed,
            "Unexpected connector failure while fetching Facebook listings.",
            retryable=True,
            details={"error": str(exc)},
        )
        return FacebookSearchResponse(
            query=payload.query,
            auth_mode=payload.auth_mode,
            count=0,
            records=[],
            upserted_count=0,
            error=fallback_error.to_payload(),
        )

    upserted_count = 0
    error = None

    if payload.ingest:
        try:
            upserted_count = await upsert_facebook_records(records)
        except Exception as exc:
            logger.warning("facebook_ingestion_failed error=%s", exc)
            ingestion_error = FacebookConnectorError(
                FacebookConnectorErrorCode.ingestion_failed,
                "Facebook listings were fetched but ingestion failed.",
                retryable=True,
                details={"error": str(exc)},
            )
            error = ingestion_error.to_payload()

    return FacebookSearchResponse(
        query=payload.query,
        auth_mode=payload.auth_mode,
        count=len(records),
        records=records,
        upserted_count=upserted_count,
        error=error,
    )


@app.get("/me/connectors/facebook", response_model=FacebookConnectorStatusResponse)
def get_facebook_connector_status(
    db: Session = Depends(get_db),
    user_id: str = Depends(get_current_user_id),
):
    row = get_user_facebook_credential(db, user_id)
    return _facebook_status_response(row)


@app.put("/me/connectors/facebook/cookies", response_model=FacebookConnectorStatusResponse)
def put_facebook_connector_cookies(
    payload: FacebookCookieUploadRequest,
    db: Session = Depends(get_db),
    user_id: str = Depends(get_current_user_id),
):
    limited = _apply_rate_limit(
        bucket="fb_cookie_put_user",
        identifier=user_id,
        limit=int(settings.MARKETLY_RATE_LIMIT_FB_COOKIE_PUT_PER_HOUR),
        window_seconds=3600,
    )
    if limited is not None:
        return limited

    try:
        row = upsert_user_facebook_credential(db, user_id, payload.cookies_json)
    except FacebookConnectorError as exc:
        raise HTTPException(status_code=400, detail=exc.to_payload().model_dump(mode="json")) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    return _facebook_status_response(row)


@app.post("/me/connectors/facebook/verify", response_model=FacebookVerifyResponse)
async def verify_facebook_connector_cookies(
    db: Session = Depends(get_db),
    user_id: str = Depends(get_current_user_id),
):
    limited = _apply_rate_limit(
        bucket="fb_verify_user",
        identifier=user_id,
        limit=int(settings.MARKETLY_RATE_LIMIT_FB_VERIFY_PER_HOUR),
        window_seconds=3600,
    )
    if limited is not None:
        return limited

    row = get_user_facebook_credential(db, user_id)
    if row is None:
        return FacebookVerifyResponse(
            ok=False,
            status=_facebook_status_response(None),
            error_code="BYOC_REQUIRED",
            error_message="Upload your Facebook cookies first.",
        )

    try:
        cookie_payload = decrypt_cookie_payload(row.encrypted_cookie_json)
    except RuntimeError as exc:
        db.rollback()
        mark_credential_failed(
            db,
            row,
            error_code="decrypt_failed",
            error_message=str(exc),
            commit=True,
        )
        return FacebookVerifyResponse(
            ok=False,
            status=_facebook_status_response(row),
            error_code="decrypt_failed",
            error_message="Stored Facebook credential could not be decrypted.",
        )

    try:
        await facebook_connector.search(
            FacebookSearchRequest(
                query="bicycle",
                limit=3,
                auth_mode="cookie",
                cookie_payload=cookie_payload,
                ingest=False,
            )
        )
    except FacebookConnectorError as exc:
        mark_credential_failed(
            db,
            row,
            error_code=exc.code.value,
            error_message=exc.message,
            commit=True,
        )
        return FacebookVerifyResponse(
            ok=False,
            status=_facebook_status_response(row),
            error_code=exc.code.value,
            error_message=exc.message,
        )
    except Exception as exc:
        mark_credential_failed(
            db,
            row,
            error_code=FacebookConnectorErrorCode.scrape_failed.value,
            error_message=str(exc),
            commit=True,
        )
        return FacebookVerifyResponse(
            ok=False,
            status=_facebook_status_response(row),
            error_code=FacebookConnectorErrorCode.scrape_failed.value,
            error_message="Unexpected verification failure.",
        )

    mark_credential_validated(db, row, commit=True)
    return FacebookVerifyResponse(
        ok=True,
        status=_facebook_status_response(row),
    )


@app.delete("/me/connectors/facebook")
def delete_facebook_connector_cookies(
    db: Session = Depends(get_db),
    user_id: str = Depends(get_current_user_id),
):
    limited = _apply_rate_limit(
        bucket="fb_delete_user",
        identifier=user_id,
        limit=int(settings.MARKETLY_RATE_LIMIT_FB_DELETE_PER_HOUR),
        window_seconds=3600,
    )
    if limited is not None:
        return limited

    deleted = delete_user_facebook_credential(db, user_id)
    return {"deleted": deleted}


@app.post("/saved-searches", response_model=SavedSearchOut)
def create_saved_search(
    payload: SavedSearchCreate,
    db: Session = Depends(get_db),
    user_id: str = Depends(get_current_user_id),
):
    limited = _apply_rate_limit(
        bucket="saved_mutation_user",
        identifier=user_id,
        limit=int(settings.MARKETLY_RATE_LIMIT_SAVED_MUTATION_PER_MIN),
        window_seconds=60,
    )
    if limited is not None:
        return limited

    row = SavedSearch(
        user_id=user_id,
        query=payload.query,
        sources=",".join(payload.sources),
        alerts_enabled=payload.alerts_enabled,
    )
    db.add(row)
    db.commit()
    db.refresh(row)

    return _saved_search_out(row)


@app.get("/saved-searches", response_model=list[SavedSearchOut])
def list_saved_searches(
    db: Session = Depends(get_db),
    user_id: str = Depends(get_current_user_id),
):
    rows = (
        db.query(SavedSearch)
        .filter(SavedSearch.user_id == user_id)
        .order_by(SavedSearch.created_at.desc())
        .all()
    )

    return [_saved_search_out(r) for r in rows]


@app.delete("/saved-searches/{search_id}")
def delete_saved_search(
    search_id: int,
    db: Session = Depends(get_db),
    user_id: str = Depends(get_current_user_id),
):
    limited = _apply_rate_limit(
        bucket="saved_mutation_user",
        identifier=user_id,
        limit=int(settings.MARKETLY_RATE_LIMIT_SAVED_MUTATION_PER_MIN),
        window_seconds=60,
    )
    if limited is not None:
        return limited

    row = (
        db.query(SavedSearch)
        .filter(SavedSearch.id == search_id, SavedSearch.user_id == user_id)
        .first()
    )
    if not row:
        raise HTTPException(status_code=404, detail="Saved search not found")
    db.delete(row)
    db.commit()
    return {"deleted": True, "id": search_id}


@app.patch("/saved-searches/{search_id}", response_model=SavedSearchOut)
def update_saved_search(
    search_id: int,
    payload: SavedSearchUpdate,
    db: Session = Depends(get_db),
    user_id: str = Depends(get_current_user_id),
):
    limited = _apply_rate_limit(
        bucket="saved_mutation_user",
        identifier=user_id,
        limit=int(settings.MARKETLY_RATE_LIMIT_SAVED_MUTATION_PER_MIN),
        window_seconds=60,
    )
    if limited is not None:
        return limited

    row = (
        db.query(SavedSearch)
        .filter(SavedSearch.id == search_id, SavedSearch.user_id == user_id)
        .first()
    )
    if not row:
        raise HTTPException(status_code=404, detail="Saved search not found")

    row.query = payload.query
    row.sources = ",".join(payload.sources)
    row.alerts_enabled = payload.alerts_enabled

    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(
            status_code=409,
            detail="Saved search already exists with the same query and sources.",
        )

    db.refresh(row)
    return _saved_search_out(row)


@app.get("/saved-searches/{search_id}/run", response_model=SearchResponse)
async def run_saved_search(
    background_tasks: BackgroundTasks,
    search_id: int,
    limit: int = Query(default=20, ge=1, le=50),
    offset: int = Query(default=0, ge=0),
    sort: SearchSort = Query(default="relevance"),
    latitude: float | None = Query(default=None, ge=-90, le=90),
    longitude: float | None = Query(default=None, ge=-180, le=180),
    radius_km: int | None = Query(default=None, ge=1, le=500),
    db: Session = Depends(get_db),
    user_id: str = Depends(get_current_user_id),
):
    limited = _apply_rate_limit(
        bucket="saved_mutation_user",
        identifier=user_id,
        limit=int(settings.MARKETLY_RATE_LIMIT_SAVED_MUTATION_PER_MIN),
        window_seconds=60,
    )
    if limited is not None:
        return limited

    row = (
        db.query(SavedSearch)
        .filter(SavedSearch.id == search_id, SavedSearch.user_id == user_id)
        .first()
    )
    if not row:
        raise HTTPException(status_code=404, detail="Saved search not found")

    source_list = parse_sources([row.sources or ""])
    for source_name in source_list:
        if source_name not in CONNECTORS:
            raise HTTPException(status_code=400, detail=f"Unknown source: {source_name}")

    facebook_runtime_context = None
    if "facebook" in source_list:
        facebook_runtime_context = _build_facebook_runtime_context(
            db=db,
            user_id=user_id,
            latitude=latitude,
            longitude=longitude,
            radius_km=radius_km,
        )

    if facebook_runtime_context is None:
        results, total, next_offset, source_errors = await unified_search(
            query=row.query,
            sources=source_list,
            limit=limit,
            offset=offset,
            sort=sort,
        )
    else:
        results, total, next_offset, source_errors = await unified_search(
            query=row.query,
            sources=source_list,
            limit=limit,
            offset=offset,
            sort=sort,
            facebook_runtime_context=facebook_runtime_context,
        )

    _enrich_results(db, query=row.query, results=results)
    typed_sources: list[Source] = [source_name for source_name in source_list]

    background_tasks.add_task(
        persist_listing_snapshots,
        query=row.query,
        listings=results,
        user_id=user_id,
        saved_search_id=row.id,
    )
    return SearchResponse(
        query=row.query,
        sources=typed_sources,
        count=len(results),
        results=results,
        next_offset=next_offset,
        total=total,
        source_errors=source_errors,
    )


@app.get("/me/notifications", response_model=list[SavedSearchNotificationOut])
def get_notifications(
    limit: int = Query(default=25, ge=1, le=100),
    db: Session = Depends(get_db),
    user_id: str = Depends(get_current_user_id),
):
    return list_notifications(db, user_id=user_id, limit=limit)


@app.post("/me/notifications/{notification_id}/read", response_model=SavedSearchNotificationOut)
def mark_notification_as_read(
    notification_id: int,
    db: Session = Depends(get_db),
    user_id: str = Depends(get_current_user_id),
):
    notification = mark_notification_read(
        db,
        user_id=user_id,
        notification_id=notification_id,
    )
    if notification is None:
        raise HTTPException(status_code=404, detail="Notification not found")
    return notification


@app.post("/copilot/query", response_model=CopilotQueryResponse)
async def copilot_query(payload: CopilotQueryRequest):
    listing_payload = [item.model_dump(mode="json") for item in payload.listings[:25]]
    return await generate_copilot_response(
        query=payload.query,
        user_question=payload.user_question,
        listings=listing_payload,
    )
