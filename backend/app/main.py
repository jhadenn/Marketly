import logging

from fastapi import Depends, FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.auth import get_current_user_id
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
from app.schemas.saved_search import SavedSearchCreate, SavedSearchOut, SavedSearchUpdate
from app.services.search_service import unified_search
from app.services.supabase_ingestion import upsert_facebook_records

setup_logging()
logger = logging.getLogger(__name__)

app = FastAPI(title="Marketly API", version="0.1.0")
print("LOADED MAIN.PY", __file__)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://127.0.0.1:3000",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

DEFAULT_SOURCES: list[Source] = ["ebay", "kijiji", "facebook"]
facebook_connector = FacebookMarketplaceConnector()


def _normalize_source_name(name: str) -> str:
    normalized = name.strip().lower()
    if normalized == "facebook_marketplace":
        return "facebook"
    return normalized


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


@app.get("/health")
def health():
    return {"status": "ok"}


@app.get("/sources")
def sources():
    return {"sources": sorted(CONNECTORS.keys())}


@app.get("/search", response_model=SearchResponse)
async def search(
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
):
    source_list = parse_sources(sources, include_facebook=include_facebook)

    for source_name in source_list:
        if source_name not in CONNECTORS:
            raise HTTPException(status_code=400, detail=f"Unknown source: {source_name}")

    results, total, next_offset, source_errors = await unified_search(
        query=q,
        sources=source_list,
        limit=limit,
        offset=offset,
        sort=sort,
    )

    typed_sources: list[Source] = [source_name for source_name in source_list]

    return SearchResponse(
        query=q,
        sources=typed_sources,
        count=len(results),
        results=results,
        next_offset=next_offset,
        total=total,
        source_errors=source_errors,
    )


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


@app.post("/saved-searches", response_model=SavedSearchOut)
def create_saved_search(
    payload: SavedSearchCreate,
    db: Session = Depends(get_db),
    user_id: str = Depends(get_current_user_id),
):
    row = SavedSearch(
        user_id=user_id,
        query=payload.query,
        sources=",".join(payload.sources),
    )
    db.add(row)
    db.commit()
    db.refresh(row)

    return SavedSearchOut(
        id=row.id,
        query=row.query,
        sources=[s.strip() for s in row.sources.split(",") if s.strip()],
        created_at=str(row.created_at),
    )


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

    return [
        SavedSearchOut(
            id=r.id,
            query=r.query,
            sources=[s.strip() for s in r.sources.split(",") if s.strip()],
            created_at=str(r.created_at),
        )
        for r in rows
    ]


@app.delete("/saved-searches/{search_id}")
def delete_saved_search(
    search_id: int,
    db: Session = Depends(get_db),
    user_id: str = Depends(get_current_user_id),
):
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
    row = (
        db.query(SavedSearch)
        .filter(SavedSearch.id == search_id, SavedSearch.user_id == user_id)
        .first()
    )
    if not row:
        raise HTTPException(status_code=404, detail="Saved search not found")

    row.query = payload.query
    row.sources = ",".join(payload.sources)

    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(
            status_code=409,
            detail="Saved search already exists with the same query and sources.",
        )

    db.refresh(row)
    return SavedSearchOut(
        id=row.id,
        query=row.query,
        sources=[s.strip() for s in row.sources.split(",") if s.strip()],
        created_at=str(row.created_at),
    )


@app.get("/saved-searches/{search_id}/run", response_model=SearchResponse)
async def run_saved_search(
    search_id: int,
    limit: int = Query(default=20, ge=1, le=50),
    offset: int = Query(default=0, ge=0),
    sort: SearchSort = Query(default="relevance"),
    db: Session = Depends(get_db),
    user_id: str = Depends(get_current_user_id),
):
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

    results, total, next_offset, source_errors = await unified_search(
        query=row.query,
        sources=source_list,
        limit=limit,
        offset=offset,
        sort=sort,
    )

    typed_sources: list[Source] = [source_name for source_name in source_list]

    return SearchResponse(
        query=row.query,
        sources=typed_sources,
        count=len(results),
        results=results,
        next_offset=next_offset,
        total=total,
        source_errors=source_errors,
    )
