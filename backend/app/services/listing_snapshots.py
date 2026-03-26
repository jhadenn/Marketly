from __future__ import annotations

import logging
from datetime import datetime

from sqlalchemy.orm import Session

from app.db import SessionLocal
from app.models.listing import Listing
from app.models.listing_snapshot import ListingSnapshot
from app.services.listing_insights import listing_fingerprint, valuation_key_for_listing
from app.services.user_ids import normalize_user_id

logger = logging.getLogger(__name__)


def persist_listing_snapshots(
    *,
    query: str,
    listings: list[Listing],
    user_id: object | None = None,
    saved_search_id: int | None = None,
    db: Session | None = None,
) -> int:
    if not listings:
        return 0

    owns_session = db is None
    session = db or SessionLocal()
    normalized_user_id = normalize_user_id(user_id)
    try:
        rows = [
            ListingSnapshot(
                user_id=normalized_user_id,
                saved_search_id=saved_search_id,
                source=item.source,
                source_listing_id=item.source_listing_id or item.url,
                listing_fingerprint=listing_fingerprint(item),
                query=query,
                title=item.title,
                price_amount=float(item.price.amount) if item.price is not None else None,
                price_currency=(item.price.currency if item.price is not None else None),
                location=item.location,
                condition=item.condition,
                snippet=item.snippet,
                image_count=len(item.image_urls or []),
                url=item.url,
                valuation_key=valuation_key_for_listing(query, item),
            )
            for item in listings
        ]
        session.add_all(rows)
        if owns_session:
            session.commit()
        else:
            session.flush()
        return len(rows)
    except Exception as exc:
        session.rollback()
        logger.warning("listing snapshot persistence failed: %s", exc)
        return 0
    finally:
        if owns_session:
            session.close()


def previously_seen_fingerprints(
    db: Session,
    *,
    saved_search_id: int,
    listing_fingerprints: list[str],
    seen_before: datetime | None,
) -> set[str]:
    if not listing_fingerprints:
        return set()

    query = (
        db.query(ListingSnapshot.listing_fingerprint)
        .filter(ListingSnapshot.saved_search_id == saved_search_id)
        .filter(ListingSnapshot.listing_fingerprint.in_(listing_fingerprints))
    )
    if seen_before is not None:
        query = query.filter(ListingSnapshot.observed_at <= seen_before)
    rows = query.distinct().all()

    return {str(row[0]) for row in rows if row and row[0]}
