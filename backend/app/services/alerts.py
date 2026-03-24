from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone

from sqlalchemy.orm import Session

from app.connectors import CONNECTORS
from app.core.cache import TTLCache
from app.core.config import settings
from app.models.listing import Listing
from app.models.saved_search import SavedSearch
from app.models.saved_search_notification import SavedSearchNotification
from app.schemas.location import ResolvedLocation
from app.schemas.notifications import SavedSearchNotificationOut
from app.services.facebook_credentials import decrypt_cookie_payload, get_user_facebook_credential
from app.services.location import get_user_location_preference
from app.services.listing_insights import enrich_listings_with_insights, listing_fingerprint, listing_key
from app.services.listing_snapshots import persist_listing_snapshots, previously_seen_fingerprints
from app.services.search_service import FacebookRuntimeContext, unified_search

logger = logging.getLogger(__name__)

ALERT_CONFIDENCE_THRESHOLD = 0.65
_alerts_refresh_limiter = TTLCache(max_items=2048)


def _split_sources(raw_sources: str) -> list[str]:
    parsed: list[str] = []
    for token in (raw_sources or "").split(","):
        cleaned = token.strip().lower()
        if cleaned and cleaned in CONNECTORS:
            parsed.append(cleaned)
    deduped: list[str] = []
    seen: set[str] = set()
    for source in parsed:
        if source in seen:
            continue
        seen.add(source)
        deduped.append(source)
    return deduped


def _facebook_runtime_context(db: Session, user_id: str | None) -> FacebookRuntimeContext | None:
    if not user_id:
        return None

    location_row = get_user_location_preference(db, user_id)
    location = (
        ResolvedLocation(
            display_name=location_row.display_name,
            city=location_row.city,
            province_code=location_row.province_code,
            province_name=location_row.province_name,
            country_code=location_row.country_code,
            latitude=location_row.latitude,
            longitude=location_row.longitude,
            mode=(location_row.mode if location_row.mode in {"manual", "gps"} else "manual"),
        )
        if location_row is not None
        else None
    )

    row = get_user_facebook_credential(db, user_id)
    if row is None:
        return FacebookRuntimeContext(
            user_id=user_id,
            latitude=location.latitude if location is not None else None,
            longitude=location.longitude if location is not None else None,
        )

    try:
        cookie_payload = decrypt_cookie_payload(row.encrypted_cookie_json)
    except Exception as exc:
        logger.warning("alert job facebook decrypt failed for user %s: %s", user_id, exc)
        return FacebookRuntimeContext(
            user_id=user_id,
            latitude=location.latitude if location is not None else None,
            longitude=location.longitude if location is not None else None,
        )

    return FacebookRuntimeContext(
        user_id=user_id,
        cookie_payload=cookie_payload,
        credential_fingerprint_sha256=row.cookie_fingerprint_sha256,
        latitude=location.latitude if location is not None else None,
        longitude=location.longitude if location is not None else None,
    )


def _search_location_context(db: Session, user_id: str | None) -> ResolvedLocation | None:
    if not user_id:
        return None
    row = get_user_location_preference(db, user_id)
    if row is None:
        return None
    return ResolvedLocation(
        display_name=row.display_name,
        city=row.city,
        province_code=row.province_code,
        province_name=row.province_name,
        country_code=row.country_code,
        latitude=row.latitude,
        longitude=row.longitude,
        mode=(row.mode if row.mode in {"manual", "gps"} else "manual"),
    )


def compute_match_confidence(item: Listing) -> tuple[float, list[str]]:
    score = 0.35
    reasons: list[str] = []

    if item.score is not None:
        lexical_bonus = max(0.0, min(0.28, (float(item.score) / 16.0)))
        score += lexical_bonus
        if lexical_bonus >= 0.12:
            reasons.append("Strong keyword match to the saved search.")

    if item.price is not None:
        score += 0.08
        reasons.append("Includes a clear asking price.")

    if item.image_urls:
        score += 0.07
        reasons.append("Includes listing photos.")

    if item.snippet:
        score += 0.06
        reasons.append("Has enough detail to review quickly.")

    if item.valuation is not None:
        if item.valuation.verdict == "underpriced" and item.valuation.confidence >= 0.55:
            score += 0.15
            reasons.append("Looks priced below recent market comps.")
        elif item.valuation.verdict == "fair" and item.valuation.confidence >= 0.55:
            score += 0.08
            reasons.append("Price sits inside the recent market range.")

    if item.risk is not None:
        if item.risk.level == "high":
            score -= 0.25
            reasons.append("High-risk listing signals lower the match quality.")
        elif item.risk.level == "medium":
            score -= 0.12
            reasons.append("Some caution signals are present.")

    confidence = round(max(0.0, min(0.99, score)), 2)
    deduped_reasons: list[str] = []
    seen: set[str] = set()
    for reason in reasons:
        if reason in seen:
            continue
        seen.add(reason)
        deduped_reasons.append(reason)
        if len(deduped_reasons) >= 3:
            break
    return confidence, deduped_reasons


def _notification_item_from_listing(item: Listing, confidence: float, why_matched: list[str]) -> dict:
    return {
        "listing_key": listing_key(item),
        "source": item.source,
        "source_listing_id": item.source_listing_id,
        "title": item.title,
        "url": item.url,
        "price": item.price.model_dump(mode="json") if item.price is not None else None,
        "location": item.location,
        "match_confidence": confidence,
        "why_matched": why_matched,
        "valuation": item.valuation.model_dump(mode="json") if item.valuation is not None else None,
        "risk": item.risk.model_dump(mode="json") if item.risk is not None else None,
    }


def _notification_new_count(items_json: object) -> int:
    if not isinstance(items_json, list):
        return 0
    return len(items_json)


def build_notification_summary(query: str, new_count: int) -> str:
    listing_label = "listing" if new_count == 1 else "listings"
    return f"{new_count} new {listing_label} for {query}"


def serialize_notification(row: SavedSearchNotification) -> SavedSearchNotificationOut:
    items = row.items_json if isinstance(row.items_json, list) else []
    new_count = _notification_new_count(items)
    return SavedSearchNotificationOut(
        id=row.id,
        saved_search_id=row.saved_search_id,
        saved_search_query=row.saved_search_query,
        summary=build_notification_summary(row.saved_search_query, new_count),
        new_count=new_count,
        created_at=str(row.created_at),
        read_at=str(row.read_at) if row.read_at is not None else None,
        items=items,
    )


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _as_utc(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def _saved_search_is_stale(saved_search: SavedSearch, *, now: datetime) -> bool:
    last_checked_at = _as_utc(getattr(saved_search, "last_alert_checked_at", None))
    if last_checked_at is None:
        return True

    stale_after_seconds = max(1, int(settings.MARKETLY_ALERTS_STALE_AFTER_SECONDS))
    return last_checked_at <= now - timedelta(seconds=stale_after_seconds)


async def refresh_saved_search_alerts_for_user(
    db: Session,
    *,
    user_id: str,
) -> bool:
    saved_searches = (
        db.query(SavedSearch)
        .filter(
            SavedSearch.user_id == user_id,
            SavedSearch.alerts_enabled.is_(True),
        )
        .all()
    )
    if not saved_searches:
        return False

    now = _utc_now()
    if not any(_saved_search_is_stale(row, now=now) for row in saved_searches):
        return False

    refresh_window_seconds = max(0, int(settings.MARKETLY_ALERTS_AUTO_REFRESH_WINDOW_SECONDS))
    cache_key = f"saved-search-alert-refresh:{user_id}"
    if refresh_window_seconds > 0 and _alerts_refresh_limiter.get(cache_key) is not None:
        return False
    if refresh_window_seconds > 0:
        _alerts_refresh_limiter.set(cache_key, True, ttl_seconds=refresh_window_seconds)

    try:
        await run_saved_search_alert_job(
            db,
            limit_per_search=max(1, int(settings.MARKETLY_ALERTS_SEARCH_LIMIT)),
            user_id=user_id,
        )
    except Exception as exc:
        db.rollback()
        logger.warning("saved search alert refresh failed for user %s: %s", user_id, exc)
        if refresh_window_seconds > 0:
            _alerts_refresh_limiter.delete(cache_key)
        return False

    return True


async def run_saved_search_alert_job(
    db: Session,
    *,
    limit_per_search: int,
    user_id: str | None = None,
    saved_search_id: int | None = None,
) -> dict[str, int]:
    query = db.query(SavedSearch).filter(SavedSearch.alerts_enabled.is_(True))
    if user_id:
        query = query.filter(SavedSearch.user_id == user_id)
    if saved_search_id is not None:
        query = query.filter(SavedSearch.id == saved_search_id)
    saved_searches = query.order_by(SavedSearch.created_at.desc()).all()

    checked = 0
    notifications_created = 0

    for saved_search in saved_searches:
        checked += 1
        saved_search_id_value = saved_search.id
        saved_search_user_id = saved_search.user_id
        saved_search_query = saved_search.query

        try:
            source_list = _split_sources(saved_search.sources)
            if not source_list:
                continue

            facebook_runtime_context = None
            search_location_context = _search_location_context(db, saved_search.user_id)
            if "facebook" in source_list:
                facebook_runtime_context = _facebook_runtime_context(db, saved_search.user_id)

            results, _, _, _ = await unified_search(
                query=saved_search.query,
                sources=source_list,
                limit=limit_per_search,
                offset=0,
                sort="relevance",
                facebook_runtime_context=facebook_runtime_context,
                search_location_context=search_location_context,
            )
            enrich_listings_with_insights(db, saved_search.query, results)
            now = _utc_now()
            seen_before = _as_utc(saved_search.last_alert_checked_at)
            if seen_before is None:
                persist_listing_snapshots(
                    query=saved_search.query,
                    listings=results,
                    user_id=saved_search.user_id,
                    saved_search_id=saved_search.id,
                )
                saved_search.last_alert_checked_at = now
                db.commit()
                continue

            fingerprints = [listing_fingerprint(item) for item in results]
            seen_fingerprints = previously_seen_fingerprints(
                db,
                saved_search_id=saved_search.id,
                listing_fingerprints=fingerprints,
                seen_before=seen_before,
            )

            persist_listing_snapshots(
                query=saved_search.query,
                listings=results,
                user_id=saved_search.user_id,
                saved_search_id=saved_search.id,
            )

            matched_items: list[dict] = []
            for item in results:
                fingerprint = listing_fingerprint(item)
                if fingerprint in seen_fingerprints:
                    continue

                confidence, why_matched = compute_match_confidence(item)
                if confidence < ALERT_CONFIDENCE_THRESHOLD:
                    continue
                matched_items.append(_notification_item_from_listing(item, confidence, why_matched))

            saved_search.last_alert_checked_at = now
            created_notification = False
            if matched_items:
                new_count = len(matched_items)
                db.add(
                    SavedSearchNotification(
                        user_id=saved_search.user_id or "",
                        saved_search_id=saved_search.id,
                        saved_search_query=saved_search.query,
                        summary_text=build_notification_summary(saved_search.query, new_count),
                        items_json=matched_items,
                    )
                )
                saved_search.last_alert_notified_at = now
                created_notification = True

            db.commit()
            if created_notification:
                notifications_created += 1
        except Exception as exc:
            db.rollback()
            logger.warning(
                "saved search alert run failed id=%s user_id=%s query=%s error=%s",
                saved_search_id_value,
                saved_search_user_id,
                saved_search_query,
                exc,
            )
            continue

    return {
        "checked": checked,
        "notifications_created": notifications_created,
    }


def list_notifications(
    db: Session,
    *,
    user_id: str,
    limit: int = 25,
) -> list[SavedSearchNotificationOut]:
    stale_count = purge_stale_notifications(db, user_id=user_id)
    if stale_count > 0:
        db.commit()

    rows = (
        db.query(SavedSearchNotification)
        .filter(SavedSearchNotification.user_id == user_id)
        .order_by(SavedSearchNotification.created_at.desc())
        .limit(max(1, min(limit, 100)))
        .all()
    )
    return [serialize_notification(row) for row in rows]


def delete_notifications_for_saved_search(
    db: Session,
    *,
    user_id: str,
    saved_search_id: int,
) -> int:
    deleted = (
        db.query(SavedSearchNotification)
        .filter(
            SavedSearchNotification.user_id == user_id,
            SavedSearchNotification.saved_search_id == saved_search_id,
        )
        .delete(synchronize_session=False)
    )
    return int(deleted or 0)


def purge_stale_notifications(
    db: Session,
    *,
    user_id: str,
) -> int:
    saved_search_rows = (
        db.query(SavedSearch.id, SavedSearch.query)
        .filter(SavedSearch.user_id == user_id)
        .all()
    )
    active_queries_by_id = {int(row.id): str(row.query) for row in saved_search_rows}

    notification_rows = (
        db.query(
            SavedSearchNotification.id,
            SavedSearchNotification.saved_search_id,
            SavedSearchNotification.saved_search_query,
        )
        .filter(SavedSearchNotification.user_id == user_id)
        .all()
    )

    stale_ids = [
        int(row.id)
        for row in notification_rows
        if active_queries_by_id.get(int(row.saved_search_id)) != str(row.saved_search_query)
    ]
    if not stale_ids:
        return 0

    deleted = (
        db.query(SavedSearchNotification)
        .filter(
            SavedSearchNotification.user_id == user_id,
            SavedSearchNotification.id.in_(stale_ids),
        )
        .delete(synchronize_session=False)
    )
    return int(deleted or 0)


def mark_notification_read(
    db: Session,
    *,
    user_id: str,
    notification_id: int,
) -> SavedSearchNotificationOut | None:
    row = (
        db.query(SavedSearchNotification)
        .filter(
            SavedSearchNotification.id == notification_id,
            SavedSearchNotification.user_id == user_id,
        )
        .first()
    )
    if row is None:
        return None

    if row.read_at is None:
        row.read_at = _utc_now()
        db.commit()
        db.refresh(row)
    return serialize_notification(row)
