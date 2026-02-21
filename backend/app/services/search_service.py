import asyncio
import hashlib
import logging

from app.connectors import CONNECTORS
from app.connectors.facebook_marketplace import FacebookConnectorError, FacebookConnectorErrorCode
from app.core.cache import TTLCache
from app.core.config import settings
from app.models.listing import Listing, SearchSort, SourceError
from app.services.scoring import score_listing

_cache = TTLCache()
logger = logging.getLogger(__name__)


def _cache_key(query: str, sources: list[str], fetch_limit: int) -> str:
    raw = (
        f"{query}|{','.join(sorted(sources))}|{fetch_limit}|"
        f"facebook_enabled={settings.MARKETLY_ENABLE_FACEBOOK}"
    )
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


def _map_facebook_error(exc: FacebookConnectorError) -> SourceError:
    detailed_message = exc.message
    detail_error = str(exc.details.get("error", "")).strip() if exc.details else ""
    if detail_error:
        detailed_message = f"{exc.message} ({detail_error})"

    if exc.code == FacebookConnectorErrorCode.disabled:
        return SourceError(code="DISABLED", message=detailed_message, retryable=False)
    if exc.code in {
        FacebookConnectorErrorCode.login_wall,
        FacebookConnectorErrorCode.checkpoint,
        FacebookConnectorErrorCode.cookies_missing,
        FacebookConnectorErrorCode.cookies_invalid,
    }:
        return SourceError(code="LOGIN_REQUIRED", message=detailed_message, retryable=False)
    if exc.code == FacebookConnectorErrorCode.blocked:
        return SourceError(code="BLOCKED", message=detailed_message, retryable=exc.retryable)
    if exc.code == FacebookConnectorErrorCode.timeout:
        return SourceError(code="TIMEOUT", message=detailed_message, retryable=True)
    if exc.code == FacebookConnectorErrorCode.empty_results:
        return SourceError(code="EMPTY", message=detailed_message, retryable=False)
    return SourceError(code="UNAVAILABLE", message=detailed_message, retryable=exc.retryable)


async def _fetch_source(
    *,
    src: str,
    query: str,
    fetch_limit: int,
) -> tuple[str, list[Listing], SourceError | None]:
    if src == "facebook" and not settings.MARKETLY_ENABLE_FACEBOOK:
        return (
            src,
            [],
            SourceError(
                code="DISABLED",
                message="Facebook source is disabled by server configuration.",
                retryable=False,
            ),
        )

    connector = CONNECTORS.get(src)
    if not connector:
        return (
            src,
            [],
            SourceError(
                code="UNKNOWN_SOURCE",
                message=f"Unknown source: {src}",
                retryable=False,
            ),
        )

    try:
        listings = await connector.search(query=query, limit=fetch_limit)
        return src, listings, None
    except FacebookConnectorError as exc:
        logger.warning(
            "facebook search failed code=%s message=%s details=%s",
            exc.code.value,
            exc.message,
            exc.details,
        )
        return src, [], _map_facebook_error(exc)
    except Exception as exc:
        logger.warning("search failed for %s: %s", src, exc)
        return (
            src,
            [],
            SourceError(
                code="UNAVAILABLE",
                message=f"{src} source unavailable.",
                retryable=True,
            ),
        )


async def _fetch_and_score(
    query: str,
    sources: list[str],
    fetch_limit: int,
) -> tuple[list[Listing], dict[str, SourceError]]:
    key = _cache_key(query, sources, fetch_limit)
    cached = _cache.get(key)
    if cached is not None:
        return cached

    tasks = [
        _fetch_source(src=src, query=query, fetch_limit=fetch_limit)
        for src in sources
    ]
    fetched = await asyncio.gather(*tasks)

    results: list[Listing] = []
    source_errors: dict[str, SourceError] = {}
    for src, listings, source_error in fetched:
        if listings:
            results.extend(listings)
        if source_error is not None:
            source_errors[src] = source_error

    results = _dedupe_listings(results)
    scored: list[Listing] = []
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

    cached_payload = (scored, source_errors)
    _cache.set(key, cached_payload, ttl_seconds=settings.CACHE_TTL_SECONDS)
    return cached_payload


async def unified_search(
    query: str,
    sources: list[str],
    limit: int = 20,
    offset: int = 0,
    sort: SearchSort = "relevance",
) -> tuple[list[Listing], int, int | None, dict[str, SourceError]]:
    safe_offset = max(0, offset)
    fetch_limit = max(limit + safe_offset, limit)

    scored, source_errors = await _fetch_and_score(
        query=query,
        sources=sources,
        fetch_limit=fetch_limit,
    )
    ordered = _sort_results(scored, sort=sort)

    total = len(ordered)
    page = ordered[safe_offset : safe_offset + limit]
    next_offset = safe_offset + limit if safe_offset + limit < total else None

    # Facebook scraping does not expose a stable total count in advance.
    # For facebook-only queries, keep pagination alive while each page is full.
    # The next request increases fetch_limit (limit + offset), allowing deeper scroll extraction.
    facebook_only = len(sources) == 1 and sources[0] == "facebook"
    if facebook_only:
        total = None
        if len(page) == limit:
            next_offset = safe_offset + limit
        else:
            next_offset = None

    return page, total, next_offset, source_errors
