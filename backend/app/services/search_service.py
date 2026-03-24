import asyncio
import hashlib
import logging
from dataclasses import dataclass

from app.connectors import CONNECTORS
from app.connectors.facebook_marketplace import FacebookConnectorError, FacebookConnectorErrorCode
from app.core.cache import TTLCache
from app.core.config import settings
from app.core.time_utils import parse_iso_datetime
from app.models.listing import Listing, SearchSort, SourceError
from app.schemas.location import ResolvedLocation
from app.services.location import haversine_km, interpret_listing_location
from app.services.scoring import score_listing

_cache = TTLCache(max_items=int(settings.MARKETLY_SEARCH_FETCH_CACHE_MAX_ITEMS))
_pagination_cache = TTLCache(max_items=int(settings.MARKETLY_SEARCH_PAGINATION_CACHE_MAX_ITEMS))
logger = logging.getLogger(__name__)


@dataclass
class FacebookRuntimeContext:
    user_id: str | None = None
    cookie_payload: object | None = None
    credential_fingerprint_sha256: str | None = None
    latitude: float | None = None
    longitude: float | None = None
    radius_km: int | None = None


def _location_cache_fragment(search_location_context: ResolvedLocation | None) -> str:
    if search_location_context is None:
        return "|loc=|loc_mode="
    return (
        f"|loc={_rounded_coord(search_location_context.latitude)},"
        f"{_rounded_coord(search_location_context.longitude)}"
        f"|loc_mode={search_location_context.mode}"
    )


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
    sort: SearchSort,
    facebook_runtime_context: FacebookRuntimeContext | None = None,
    search_location_context: ResolvedLocation | None = None,
) -> str:
    raw = (
        f"{query}|{','.join(sorted(sources))}|{fetch_limit}|sort={sort}|"
        f"facebook_enabled={settings.MARKETLY_ENABLE_FACEBOOK}"
        f"{_facebook_cache_fragment(sources, facebook_runtime_context)}"
        f"{_location_cache_fragment(search_location_context)}"
    )
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def _pagination_key(
    query: str,
    sources: list[str],
    sort: SearchSort,
    limit: int,
    facebook_runtime_context: FacebookRuntimeContext | None = None,
    search_location_context: ResolvedLocation | None = None,
) -> str:
    raw = (
        f"{query}|{','.join(sorted(sources))}|sort={sort}|limit={limit}|"
        f"facebook_enabled={settings.MARKETLY_ENABLE_FACEBOOK}"
        f"{_facebook_cache_fragment(sources, facebook_runtime_context)}"
        f"{_location_cache_fragment(search_location_context)}"
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


def _source_timeout_seconds(src: str, *, is_multi_source: bool) -> float | None:
    if src == "facebook":
        if is_multi_source:
            timeout_seconds = float(settings.MARKETLY_FACEBOOK_SOURCE_TIMEOUT_SECONDS)
        else:
            timeout_seconds = float(
                settings.MARKETLY_FACEBOOK_SOURCE_TIMEOUT_SECONDS_SINGLE_SOURCE
            )
    else:
        timeout_seconds = float(settings.MARKETLY_SOURCE_TIMEOUT_SECONDS)
    if timeout_seconds <= 0:
        return None
    return timeout_seconds


async def _run_with_timeout(awaitable, timeout_seconds: float | None):
    if timeout_seconds is None:
        return await awaitable
    return await asyncio.wait_for(awaitable, timeout=timeout_seconds)


def _interleave_by_source(items: list[Listing], sources: list[str]) -> list[Listing]:
    if not items:
        return items

    buckets: dict[str, list[Listing]] = {}
    for item in items:
        buckets.setdefault(item.source, []).append(item)

    source_order = [src for src in sources if src in buckets]
    source_order.extend(sorted(src for src in buckets if src not in source_order))
    positions = {src: 0 for src in source_order}

    merged: list[Listing] = []
    while len(merged) < len(items):
        appended = False
        for src in source_order:
            idx = positions[src]
            bucket = buckets[src]
            if idx >= len(bucket):
                continue
            merged.append(bucket[idx])
            positions[src] = idx + 1
            appended = True
        if not appended:
            break

    return merged


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
        parsed_posted_at = {
            id(item): parse_iso_datetime(item.posted_at)
            for item in items
        }
        return sorted(
            items,
            key=lambda x: (
                parsed_posted_at[id(x)] is None,
                -(parsed_posted_at[id(x)].timestamp() if parsed_posted_at[id(x)] is not None else 0.0),
            ),
        )
    return sorted(items, key=lambda x: x.score, reverse=True)


def _sort_results_with_distance(items: list[Listing], sort: SearchSort) -> list[Listing]:
    ordered = _sort_results(items, sort=sort)
    return sorted(
        ordered,
        key=lambda item: (
            item.distance_km is None,
            item.distance_km if item.distance_km is not None else float("inf"),
        ),
    )


def _reset_distance_fields(items: list[Listing]) -> None:
    for item in items:
        item.distance_km = None
        item.distance_is_approximate = False


def _location_bucket(item: Listing, country_code: str | None) -> int:
    if item.source in {"kijiji", "facebook"}:
        if country_code not in {None, "CA"}:
            return 3
        return 0 if item.distance_km is not None else 1
    if item.source == "ebay":
        return 2
    return 3


def _order_with_location_context(
    items: list[Listing],
    *,
    sources: list[str],
    sort: SearchSort,
    search_location_context: ResolvedLocation | None,
) -> list[Listing]:
    if (
        search_location_context is None
        or search_location_context.latitude is None
        or search_location_context.longitude is None
    ):
        _reset_distance_fields(items)
        ordered = _sort_results(items, sort=sort)
        if sort == "relevance" and settings.MARKETLY_BALANCE_MULTI_SOURCE_RESULTS:
            return _interleave_by_source(ordered, sources)
        return ordered

    origin_latitude = float(search_location_context.latitude)
    origin_longitude = float(search_location_context.longitude)
    buckets: dict[int, list[Listing]] = {0: [], 1: [], 2: [], 3: []}

    for item in items:
        country_hint = "CA" if item.source in {"kijiji", "facebook"} else None
        match = interpret_listing_location(
            item.location,
            source_hint=item.source,
            country_hint=country_hint,
            latitude=item.latitude,
            longitude=item.longitude,
        )
        if item.latitude is None and match.latitude is not None:
            item.latitude = match.latitude
        if item.longitude is None and match.longitude is not None:
            item.longitude = match.longitude

        item.distance_km = None
        item.distance_is_approximate = False
        if match.latitude is not None and match.longitude is not None:
            item.distance_km = haversine_km(
                origin_latitude,
                origin_longitude,
                match.latitude,
                match.longitude,
            )
            item.distance_is_approximate = match.distance_is_approximate

        bucket = _location_bucket(item, match.country_code)
        buckets.setdefault(bucket, []).append(item)

    ordered: list[Listing] = []
    for bucket_index in (0, 1, 2, 3):
        if bucket_index == 0:
            bucket_items = _sort_results_with_distance(buckets.get(bucket_index, []), sort=sort)
        else:
            bucket_items = _sort_results(buckets.get(bucket_index, []), sort=sort)
        if (
            bucket_index != 0
            and sort == "relevance"
            and settings.MARKETLY_BALANCE_MULTI_SOURCE_RESULTS
        ):
            bucket_items = _interleave_by_source(bucket_items, sources)
        ordered.extend(bucket_items)
    return ordered


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
    sort: SearchSort,
    facebook_runtime_context: FacebookRuntimeContext | None = None,
    is_multi_source: bool = False,
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
        timeout_seconds = _source_timeout_seconds(src, is_multi_source=is_multi_source)
        if src == "facebook":
            facebook_fetch_limit = max(1, int(fetch_limit))
            if is_multi_source:
                # Keep multi-source Facebook fetches bounded for low-memory hosts,
                # but allow deeper pagination than the first-page soft cap.
                hard_multi_source_cap = max(
                    int(settings.MARKETLY_FACEBOOK_MAX_FETCH_LIMIT),
                    int(settings.MARKETLY_FACEBOOK_MAX_SCRAPE_LIMIT),
                )
                facebook_fetch_limit = min(
                    facebook_fetch_limit,
                    max(1, hard_multi_source_cap),
                )
            listings = await _run_with_timeout(
                connector.search(
                    query=query,
                    limit=facebook_fetch_limit,
                    sort=sort,
                    auth_mode="cookie",
                    cookie_payload=facebook_runtime_context.cookie_payload if facebook_runtime_context else None,
                    latitude=facebook_runtime_context.latitude if facebook_runtime_context else None,
                    longitude=facebook_runtime_context.longitude if facebook_runtime_context else None,
                    radius_km=facebook_runtime_context.radius_km if facebook_runtime_context else None,
                    multi_source=is_multi_source,
                ),
                timeout_seconds,
            )
        else:
            listings = await _run_with_timeout(
                connector.search(query=query, limit=fetch_limit, sort=sort), timeout_seconds
            )
        return src, listings, None
    except asyncio.TimeoutError:
        return (
            src,
            [],
            SourceError(
                code="TIMEOUT",
                message=f"{src} source timed out.",
                retryable=True,
            ),
        )
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
    sort: SearchSort,
    facebook_runtime_context: FacebookRuntimeContext | None = None,
    search_location_context: ResolvedLocation | None = None,
) -> tuple[list[Listing], dict[str, SourceError], dict[str, int]]:
    key = _cache_key(
        query,
        sources,
        fetch_limit,
        sort,
        facebook_runtime_context,
        search_location_context,
    )
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
            sort=sort,
            facebook_runtime_context=facebook_runtime_context,
            is_multi_source=len(sources) > 1,
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
    search_location_context: ResolvedLocation | None = None,
) -> tuple[list[Listing], int, int | None, dict[str, SourceError]]:
    safe_offset = max(0, offset)
    facebook_only = len(sources) == 1 and sources[0] == "facebook"
    multi_source = len(sources) > 1

    if multi_source:
        max_expansions = max(0, int(settings.MARKETLY_MULTI_SOURCE_MAX_EXPANSIONS))
        if "facebook" in sources and settings.MARKETLY_DISABLE_FACEBOOK_MULTI_SOURCE_EXPANSION:
            max_expansions = 0

        # When multi-source expansion is disabled (low-memory mode), don't rely on cached
        # first-page state. Recompute with an offset-sized fetch window so infinite scroll
        # still advances.
        if max_expansions == 0:
            fetch_limit = max(limit + safe_offset, limit)
            if facebook_runtime_context is None:
                scored, source_errors, source_counts = await _fetch_and_score(
                    query=query,
                    sources=sources,
                    fetch_limit=fetch_limit,
                    sort=sort,
                    search_location_context=search_location_context,
                )
            else:
                scored, source_errors, source_counts = await _fetch_and_score(
                    query=query,
                    sources=sources,
                    fetch_limit=fetch_limit,
                    sort=sort,
                    facebook_runtime_context=facebook_runtime_context,
                    search_location_context=search_location_context,
                )
            ordered = _order_with_location_context(
                scored,
                sources=sources,
                sort=sort,
                search_location_context=search_location_context,
            )
            page = ordered[safe_offset : safe_offset + limit]
            page_end = safe_offset + len(page)
            can_expand = _multi_source_can_expand(
                sources=sources,
                source_counts=source_counts,
                fetch_limit=fetch_limit,
            )

            total = None if can_expand else len(ordered)
            if page_end < len(ordered):
                next_offset = page_end
            elif page_end > safe_offset and can_expand:
                next_offset = page_end
            else:
                next_offset = None

            return page, total, next_offset, source_errors

        pagination_key = _pagination_key(
            query,
            sources,
            sort,
            limit,
            facebook_runtime_context,
            search_location_context,
        )
        pagination_state = None if safe_offset == 0 else _pagination_cache.get(pagination_key)

        if pagination_state is None:
            fetch_limit = limit
            if facebook_runtime_context is None:
                scored, source_errors, source_counts = await _fetch_and_score(
                    query=query,
                    sources=sources,
                    fetch_limit=fetch_limit,
                    sort=sort,
                    search_location_context=search_location_context,
                )
            else:
                scored, source_errors, source_counts = await _fetch_and_score(
                    query=query,
                    sources=sources,
                    fetch_limit=fetch_limit,
                    sort=sort,
                    facebook_runtime_context=facebook_runtime_context,
                    search_location_context=search_location_context,
                )
            ordered = _order_with_location_context(
                scored,
                sources=sources,
                sort=sort,
                search_location_context=search_location_context,
            )
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
                    sort=sort,
                    search_location_context=search_location_context,
                )
            else:
                scored, incoming_source_errors, source_counts = await _fetch_and_score(
                    query=query,
                    sources=sources,
                    fetch_limit=next_fetch_limit,
                    sort=sort,
                    facebook_runtime_context=facebook_runtime_context,
                    search_location_context=search_location_context,
                )
            expanded_ordered = _order_with_location_context(
                scored,
                sources=sources,
                sort=sort,
                search_location_context=search_location_context,
            )

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
            sort=sort,
            search_location_context=search_location_context,
        )
    else:
        scored, source_errors, _ = await _fetch_and_score(
            query=query,
            sources=sources,
            fetch_limit=fetch_limit,
            sort=sort,
            facebook_runtime_context=facebook_runtime_context,
            search_location_context=search_location_context,
        )
    ordered = _order_with_location_context(
        scored,
        sources=sources,
        sort=sort,
        search_location_context=search_location_context,
    )

    total = len(ordered)
    page = ordered[safe_offset : safe_offset + limit]
    next_offset = safe_offset + limit if safe_offset + limit < total else None

    # For single-source connectors, we often don't know global total upfront.
    # If the current fetch window is fully filled, keep pagination alive.
    if len(page) == limit and total == fetch_limit:
        total = None
        next_offset = safe_offset + limit

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
