from __future__ import annotations

import logging
from datetime import datetime, timezone

from sqlalchemy.orm import Session

from app.connectors import CONNECTORS
from app.models.listing import Listing
from app.models.saved_search import SavedSearch
from app.models.saved_search_notification import SavedSearchNotification
from app.schemas.notifications import SavedSearchNotificationOut
from app.services.facebook_credentials import decrypt_cookie_payload, get_user_facebook_credential
from app.services.listing_insights import enrich_listings_with_insights, listing_fingerprint, listing_key
from app.services.listing_snapshots import persist_listing_snapshots, previously_seen_fingerprints
from app.services.openai_client import generate_alert_summary
from app.services.search_service import FacebookRuntimeContext, unified_search

logger = logging.getLogger(__name__)

ALERT_CONFIDENCE_THRESHOLD = 0.65


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

    row = get_user_facebook_credential(db, user_id)
    if row is None:
        return FacebookRuntimeContext(user_id=user_id)

    try:
        cookie_payload = decrypt_cookie_payload(row.encrypted_cookie_json)
    except Exception as exc:
        logger.warning("alert job facebook decrypt failed for user %s: %s", user_id, exc)
        return FacebookRuntimeContext(user_id=user_id)

    return FacebookRuntimeContext(
        user_id=user_id,
        cookie_payload=cookie_payload,
        credential_fingerprint_sha256=row.cookie_fingerprint_sha256,
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


def serialize_notification(row: SavedSearchNotification) -> SavedSearchNotificationOut:
    return SavedSearchNotificationOut(
        id=row.id,
        saved_search_id=row.saved_search_id,
        saved_search_query=row.saved_search_query,
        summary=row.summary_text,
        created_at=str(row.created_at),
        read_at=str(row.read_at) if row.read_at is not None else None,
        items=row.items_json or [],
    )


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
        source_list = _split_sources(saved_search.sources)
        if not source_list:
            continue

        facebook_runtime_context = None
        if "facebook" in source_list:
            facebook_runtime_context = _facebook_runtime_context(db, saved_search.user_id)

        try:
            results, _, _, _ = await unified_search(
                query=saved_search.query,
                sources=source_list,
                limit=limit_per_search,
                offset=0,
                sort="relevance",
                facebook_runtime_context=facebook_runtime_context,
            )
            enrich_listings_with_insights(db, saved_search.query, results)
        except Exception as exc:
            logger.warning("saved search alert run failed id=%s error=%s", saved_search.id, exc)
            continue

        now = datetime.now(timezone.utc)
        fingerprints = [listing_fingerprint(item) for item in results]
        seen_fingerprints = previously_seen_fingerprints(
            db,
            saved_search_id=saved_search.id,
            listing_fingerprints=fingerprints,
            seen_before=saved_search.last_alert_checked_at,
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
            if saved_search.last_alert_checked_at is not None and fingerprint in seen_fingerprints:
                continue

            confidence, why_matched = compute_match_confidence(item)
            if confidence < ALERT_CONFIDENCE_THRESHOLD:
                continue
            matched_items.append(_notification_item_from_listing(item, confidence, why_matched))

        saved_search.last_alert_checked_at = now
        if matched_items:
            summary_text = await generate_alert_summary(saved_search.query, matched_items)
            db.add(
                SavedSearchNotification(
                    user_id=saved_search.user_id or "",
                    saved_search_id=saved_search.id,
                    saved_search_query=saved_search.query,
                    summary_text=summary_text,
                    items_json=matched_items,
                )
            )
            saved_search.last_alert_notified_at = now
            notifications_created += 1

        db.commit()

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
    rows = (
        db.query(SavedSearchNotification)
        .filter(SavedSearchNotification.user_id == user_id)
        .order_by(SavedSearchNotification.created_at.desc())
        .limit(max(1, min(limit, 100)))
        .all()
    )
    return [serialize_notification(row) for row in rows]


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
        row.read_at = datetime.now(timezone.utc)
        db.commit()
        db.refresh(row)
    return serialize_notification(row)
