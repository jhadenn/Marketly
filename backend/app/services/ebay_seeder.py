from __future__ import annotations

import asyncio
import logging

from sqlalchemy import func

from app.core.config import settings
from app.db import SessionLocal
from app.models.listing_snapshot import ListingSnapshot

logger = logging.getLogger(__name__)


def _snapshot_count_for_query(query: str) -> int:
    session = SessionLocal()
    try:
        return int(
            session.query(func.count(ListingSnapshot.id))
            .filter(ListingSnapshot.query == query)
            .scalar()
            or 0
        )
    except Exception as exc:
        logger.warning("ebay seeder snapshot count failed: %s", exc)
        return 0
    finally:
        session.close()


def seed_ebay_snapshots_if_below_threshold(query: str) -> None:
    if not settings.MARKETLY_EBAY_SEED_ENABLED:
        return
    if not query or not query.strip():
        return

    threshold = int(settings.MARKETLY_EBAY_SEED_MIN_SNAPSHOT_COUNT)
    fetch_limit = int(settings.MARKETLY_EBAY_SEED_FETCH_LIMIT)
    if threshold <= 0 or fetch_limit <= 0:
        return

    existing = _snapshot_count_for_query(query)
    if existing >= threshold:
        return

    try:
        from app.connectors.ebay_connector import EbayConnector
        from app.services.listing_snapshots import persist_listing_snapshots
    except Exception as exc:
        logger.warning("ebay seeder import failed: %s", exc)
        return

    try:
        connector = EbayConnector()
    except Exception as exc:
        logger.warning("ebay seeder init failed: %s", exc)
        return

    try:
        listings = asyncio.run(connector.search(query, limit=fetch_limit))
    except RuntimeError:
        try:
            loop = asyncio.new_event_loop()
            try:
                listings = loop.run_until_complete(connector.search(query, limit=fetch_limit))
            finally:
                loop.close()
        except Exception as exc:
            logger.warning("ebay seeder fetch failed: %s", exc)
            return
    except Exception as exc:
        logger.warning("ebay seeder fetch failed: %s", exc)
        return

    if not listings:
        return

    try:
        persist_listing_snapshots(query=query, listings=listings)
    except Exception as exc:
        logger.warning("ebay seeder persist failed: %s", exc)
