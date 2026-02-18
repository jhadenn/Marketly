import hashlib
import logging
from app.connectors import CONNECTORS
from app.core.cache import TTLCache
from app.core.config import settings
from app.models.listing import Listing, SearchSort
from app.services.scoring import score_listing

_cache = TTLCache()
logger = logging.getLogger(__name__)


def _cache_key(query: str, sources: list[str], fetch_limit: int) -> str:
    raw = f"{query}|{','.join(sorted(sources))}|{fetch_limit}"
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def _dedupe_listings(items: list[Listing]) -> list[Listing]:
    seen: set[str] = set()
    deduped: list[Listing] = []
    for item in items:
        key = f"{item.source}:{item.source_listing_id}"
        if key in seen:
            continue
        seen.add(key)
        deduped.append(item)
    return deduped


def _sort_results(items: list[Listing], sort: SearchSort) -> list[Listing]:
    if sort == "price_asc":
        return sorted(
            items,
            key=lambda x: (
                x.price is None,
                x.price.amount if x.price else float("inf"),
                -(x.score or 0.0),
            ),
        )
    if sort == "price_desc":
        return sorted(
            items,
            key=lambda x: (
                x.price is None,
                -(x.price.amount if x.price else 0.0),
                -(x.score or 0.0),
            ),
        )
    if sort == "newest":
        logger.info("newest sort requested but listing timestamps are unavailable; falling back to relevance")
    return sorted(items, key=lambda x: x.score, reverse=True)


async def _fetch_and_score(query: str, sources: list[str], fetch_limit: int) -> list[Listing]:
    key = _cache_key(query, sources, fetch_limit)
    cached = _cache.get(key)
    if cached is not None:
        return cached

    results: list[Listing] = []
    for src in sources:
        connector = CONNECTORS.get(src)
        if not connector:
            continue
        try:
            listings = await connector.search(query=query, limit=fetch_limit)
            results.extend(listings)
        except Exception as exc:
            logger.warning("search failed for %s: %s", src, exc)

    results = _dedupe_listings(results)
    scored = []
    for item in results:
        sr = score_listing(
            query,
            title=item.title,
            snippet=getattr(item, "snippet", None),
            has_price=item.price is not None,
        )
        item.score = sr.score
        item.score_reason = sr.reason
        scored.append(item)

    _cache.set(key, scored, ttl_seconds=settings.CACHE_TTL_SECONDS)
    return scored


async def unified_search(
    query: str,
    sources: list[str],
    limit: int = 20,
    offset: int = 0,
    sort: SearchSort = "relevance",
) -> tuple[list[Listing], int, int | None]:
    safe_offset = max(0, offset)
    fetch_limit = max(limit + safe_offset, limit)

    scored = await _fetch_and_score(query=query, sources=sources, fetch_limit=fetch_limit)
    ordered = _sort_results(scored, sort=sort)

    total = len(ordered)
    page = ordered[safe_offset : safe_offset + limit]
    next_offset = safe_offset + limit if safe_offset + limit < total else None
    return page, total, next_offset

