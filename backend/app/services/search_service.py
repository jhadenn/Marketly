import asyncio
import hashlib
import logging
from dataclasses import dataclass

from app.connectors import CONNECTORS
from app.connectors.facebook_marketplace import FacebookConnectorError, FacebookConnectorErrorCode
from app.core.cache import TTLCache
from app.core.config import settings
from app.models.listing import Listing, SearchSort, SourceError
from app.services.scoring import score_listing

_cache = TTLCache()
_pagination_cache = TTLCache()
logger = logging.getLogger(__name__)


@dataclass
class FacebookRuntimeContext:
    user_id: str | None = None
    cookie_payload: object | None = None
    credential_fingerprint_sha256: str | None = None
    latitude: float | None = None
    longitude: float | None = None
    radius_km: int | None = None


def _rounded_coord(value: float | None) -> str:
    if value is None:
        return ""
    return f"{value:.3f}"


def _facebook_cache_fragment(
    sources: list[str],
    facebook_runtime_context: FacebookRuntimeContext | None,
) -> str:
    if "facebook" not in sources:
        return ""

    ctx = facebook_runtime_context or FacebookRuntimeContext()
    return (
        f"|fb_user={ctx.user_id or 'anon'}"
        f"|fb_fp={ctx.credential_fingerprint_sha256 or ''}"
        f"|fb_lat={_rounded_coord(ctx.latitude)}"
        f"|fb_lon={_rounded_coord(ctx.longitude)}"
        f"|fb_rkm={ctx.radius_km if ctx.radius_km is not None else ''}"
    )


def _cache_key(
    query: str,
    sources: list[str],
    fetch_limit: int,
    facebook_runtime_context: FacebookRuntimeContext | None = None,
) -> str:
    raw = (
        f"{query}|{','.join(sorted(sources))}|{fetch_limit}|"
        f"facebook_enabled={settings.MARKETLY_ENABLE_FACEBOOK}"
        f"{_facebook_cache_fragment(sources, facebook_runtime_context)}"
    )
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def _pagination_key(
    query: str,
    sources: list[str],
    sort: SearchSort,
    limit: int,
    facebook_runtime_context: FacebookRuntimeContext | None = None,
) -> str:
    raw = (
        f"{query}|{','.join(sorted(sources))}|sort={sort}|limit={limit}|"
        f"facebook_enabled={settings.MARKETLY_ENABLE_FACEBOOK}"
        f"{_facebook_cache_fragment(sources, facebook_runtime_context)}"
    )
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def _listing_key(item: Listing) -> str:
    return f"{item.source}:{item.source_listing_id or item.url}"


def _multi_source_can_expand(
    *,
    sources: list[str],
    source_counts: dict[str, int],
    fetch_limit: int,
) -> bool:
    for source in sources:
        if source_counts.get(source, 0) >= fetch_limit:
            return True
    return False


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
    facebook_runtime_context: FacebookRuntimeContext | None = None,
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
    if src == "facebook":
        if facebook_runtime_context is None or not facebook_runtime_context.user_id:
            return (
                src,
                [],
                SourceError(
                    code="AUTH_REQUIRED",
                    message="Log in and configure Facebook cookies to use the Facebook source.",
                    retryable=False,
                ),
            )
        if facebook_runtime_context.cookie_payload is None:
            return (
                src,
                [],
                SourceError(
                    code="BYOC_REQUIRED",
                    message="Upload your Facebook cookies in Facebook Setup to use the Facebook source.",
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
        if src == "facebook":
            listings = await connector.search(
                query=query,
                limit=fetch_limit,
                auth_mode="cookie",
                cookie_payload=facebook_runtime_context.cookie_payload if facebook_runtime_context else None,
                latitude=facebook_runtime_context.latitude if facebook_runtime_context else None,
                longitude=facebook_runtime_context.longitude if facebook_runtime_context else None,
                radius_km=facebook_runtime_context.radius_km if facebook_runtime_context else None,
            )
        else:
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
    facebook_runtime_context: FacebookRuntimeContext | None = None,
) -> tuple[list[Listing], dict[str, SourceError], dict[str, int]]:
    key = _cache_key(query, sources, fetch_limit, facebook_runtime_context)
    cached = _cache.get(key)
    if cached is not None:
        # Backward-compatible with old cache entries that only stored 2 fields.
        if isinstance(cached, tuple) and len(cached) == 2:
            cached_scored, cached_errors = cached
            return cached_scored, cached_errors, {}
        return cached

    tasks = [
        _fetch_source(
            src=src,
            query=query,
            fetch_limit=fetch_limit,
            facebook_runtime_context=facebook_runtime_context,
        )
        for src in sources
    ]
    fetched = await asyncio.gather(*tasks)

    results: list[Listing] = []
    source_errors: dict[str, SourceError] = {}
    source_counts: dict[str, int] = {}
    for src, listings, source_error in fetched:
        source_counts[src] = len(listings)
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

    cached_payload = (scored, source_errors, source_counts)
    _cache.set(key, cached_payload, ttl_seconds=settings.CACHE_TTL_SECONDS)
    return cached_payload


async def unified_search(
    query: str,
    sources: list[str],
    limit: int = 20,
    offset: int = 0,
    sort: SearchSort = "relevance",
    facebook_runtime_context: FacebookRuntimeContext | None = None,
) -> tuple[list[Listing], int, int | None, dict[str, SourceError]]:
    safe_offset = max(0, offset)
    facebook_only = len(sources) == 1 and sources[0] == "facebook"
    multi_source = len(sources) > 1

    if multi_source:
        pagination_key = _pagination_key(query, sources, sort, limit, facebook_runtime_context)
        pagination_state = None if safe_offset == 0 else _pagination_cache.get(pagination_key)

        if pagination_state is None:
            fetch_limit = limit
            if facebook_runtime_context is None:
                scored, source_errors, source_counts = await _fetch_and_score(
                    query=query,
                    sources=sources,
                    fetch_limit=fetch_limit,
                )
            else:
                scored, source_errors, source_counts = await _fetch_and_score(
                    query=query,
                    sources=sources,
                    fetch_limit=fetch_limit,
                    facebook_runtime_context=facebook_runtime_context,
                )
            ordered = _sort_results(scored, sort=sort)
            pagination_state = {
                "fetch_limit": fetch_limit,
                "ordered": ordered,
                "source_errors": source_errors,
                "can_expand": _multi_source_can_expand(
                    sources=sources,
                    source_counts=source_counts,
                    fetch_limit=fetch_limit,
                ),
            }
        else:
            fetch_limit = int(pagination_state.get("fetch_limit", limit))
            ordered = list(pagination_state.get("ordered", []))
            source_errors = dict(pagination_state.get("source_errors", {}))
            can_expand = bool(pagination_state.get("can_expand", False))
            pagination_state = {
                "fetch_limit": fetch_limit,
                "ordered": ordered,
                "source_errors": source_errors,
                "can_expand": can_expand,
            }

        max_expansions = 4
        expansions = 0
        while (
            safe_offset + limit > len(pagination_state["ordered"])
            and pagination_state["can_expand"]
            and expansions < max_expansions
        ):
            next_fetch_limit = int(pagination_state["fetch_limit"]) + limit
            if facebook_runtime_context is None:
                scored, incoming_source_errors, source_counts = await _fetch_and_score(
                    query=query,
                    sources=sources,
                    fetch_limit=next_fetch_limit,
                )
            else:
                scored, incoming_source_errors, source_counts = await _fetch_and_score(
                    query=query,
                    sources=sources,
                    fetch_limit=next_fetch_limit,
                    facebook_runtime_context=facebook_runtime_context,
                )
            expanded_ordered = _sort_results(scored, sort=sort)

            seen = {_listing_key(item) for item in pagination_state["ordered"]}
            appended = 0
            for item in expanded_ordered:
                item_key = _listing_key(item)
                if item_key in seen:
                    continue
                seen.add(item_key)
                pagination_state["ordered"].append(item)
                appended += 1

            merged_source_errors = dict(pagination_state["source_errors"])
            merged_source_errors.update(incoming_source_errors)
            pagination_state["source_errors"] = merged_source_errors
            pagination_state["fetch_limit"] = next_fetch_limit
            pagination_state["can_expand"] = _multi_source_can_expand(
                sources=sources,
                source_counts=source_counts,
                fetch_limit=next_fetch_limit,
            )

            expansions += 1
            if appended == 0 and not pagination_state["can_expand"]:
                break

        _pagination_cache.set(
            pagination_key,
            pagination_state,
            ttl_seconds=settings.CACHE_TTL_SECONDS,
        )

        ordered = pagination_state["ordered"]
        source_errors = pagination_state["source_errors"]
        can_expand = bool(pagination_state["can_expand"])
        page = ordered[safe_offset : safe_offset + limit]
        page_end = safe_offset + len(page)

        total = None if can_expand else len(ordered)
        if page_end < len(ordered):
            next_offset = page_end
        elif page_end > safe_offset and can_expand:
            next_offset = page_end
        else:
            next_offset = None

        return page, total, next_offset, source_errors

    fetch_limit = max(limit + safe_offset, limit)

    if facebook_runtime_context is None:
        scored, source_errors, _ = await _fetch_and_score(
            query=query,
            sources=sources,
            fetch_limit=fetch_limit,
        )
    else:
        scored, source_errors, _ = await _fetch_and_score(
            query=query,
            sources=sources,
            fetch_limit=fetch_limit,
            facebook_runtime_context=facebook_runtime_context,
        )
    ordered = _sort_results(scored, sort=sort)

    total = len(ordered)
    page = ordered[safe_offset : safe_offset + limit]
    next_offset = safe_offset + limit if safe_offset + limit < total else None

    # Facebook scraping does not expose a stable total count in advance.
    # For facebook-only queries, keep pagination alive while each page is full.
    # The next request increases fetch_limit (limit + offset), allowing deeper scroll extraction.
    if facebook_only:
        total = None
        if len(page) == limit:
            next_offset = safe_offset + limit
        else:
            next_offset = None

    return page, total, next_offset, source_errors
