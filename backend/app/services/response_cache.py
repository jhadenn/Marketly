import hashlib
import json
import logging
from typing import Any

from app.core.cache import TTLCache
from app.core.config import settings
from app.core.redis_client import get_redis_client

logger = logging.getLogger(__name__)
_local_response_cache = TTLCache(max_items=int(settings.MARKETLY_RESPONSE_CACHE_LOCAL_MAX_ITEMS))


def _response_cache_ttl_seconds() -> int:
    return max(1, int(settings.MARKETLY_RESPONSE_CACHE_TTL_SECONDS))


def _local_fallback_enabled() -> bool:
    return bool(settings.MARKETLY_RESPONSE_CACHE_LOCAL_FALLBACK_ENABLED)


def _read_payload(raw_payload: str) -> dict[str, Any] | None:
    parsed = json.loads(raw_payload)
    if isinstance(parsed, dict):
        return parsed
    return None


def _get_local_cached_search_response(cache_key: str) -> dict[str, Any] | None:
    payload = _local_response_cache.get(cache_key)
    if not payload:
        return None

    if not isinstance(payload, str):
        return None

    try:
        return _read_payload(payload)
    except Exception as exc:
        logger.warning("search response local cache read failed key=%s error=%s", cache_key, exc)
        return None


def _set_local_cached_search_response(cache_key: str, payload: dict[str, Any]) -> None:
    try:
        _local_response_cache.set(
            cache_key,
            json.dumps(payload, separators=(",", ":"), ensure_ascii=False),
            ttl_seconds=_response_cache_ttl_seconds(),
        )
    except Exception as exc:
        logger.warning("search response local cache write failed key=%s error=%s", cache_key, exc)


def _rounded_coord(value: float | None) -> str:
    if value is None:
        return ""
    return f"{value:.3f}"


def _facebook_fragment(
    *,
    sources: list[str],
    facebook_runtime_context: Any | None,
) -> str:
    if "facebook" not in sources:
        return ""

    if facebook_runtime_context is None:
        return "|fb_user=anon|fb_fp=|fb_lat=|fb_lon=|fb_rkm="

    return (
        f"|fb_user={getattr(facebook_runtime_context, 'user_id', None) or 'anon'}"
        f"|fb_fp={getattr(facebook_runtime_context, 'credential_fingerprint_sha256', None) or ''}"
        f"|fb_lat={_rounded_coord(getattr(facebook_runtime_context, 'latitude', None))}"
        f"|fb_lon={_rounded_coord(getattr(facebook_runtime_context, 'longitude', None))}"
        f"|fb_rkm={getattr(facebook_runtime_context, 'radius_km', None) or ''}"
    )


def _location_fragment(search_location_context: Any | None) -> str:
    if search_location_context is None:
        return "|loc=|loc_mode="
    return (
        f"|loc={_rounded_coord(getattr(search_location_context, 'latitude', None))},"
        f"{_rounded_coord(getattr(search_location_context, 'longitude', None))}"
        f"|loc_mode={getattr(search_location_context, 'mode', None) or ''}"
    )


def build_search_response_cache_key(
    *,
    query: str,
    sources: list[str],
    limit: int,
    offset: int,
    sort: str,
    facebook_runtime_context: Any | None = None,
    search_location_context: Any | None = None,
) -> str:
    raw = (
        f"v5|q={query}"
        f"|sources={','.join(sorted(sources))}"
        f"|limit={limit}"
        f"|offset={offset}"
        f"|sort={sort}"
        f"|facebook_enabled={settings.MARKETLY_ENABLE_FACEBOOK}"
        f"|disable_fb_multi_expansion={settings.MARKETLY_DISABLE_FACEBOOK_MULTI_SOURCE_EXPANSION}"
        f"|balance_multi={settings.MARKETLY_BALANCE_MULTI_SOURCE_RESULTS}"
        f"{_facebook_fragment(sources=sources, facebook_runtime_context=facebook_runtime_context)}"
        f"{_location_fragment(search_location_context)}"
    )
    digest = hashlib.sha256(raw.encode("utf-8")).hexdigest()
    return f"marketly:search_response:{digest}"


def is_search_response_cache_active() -> bool:
    if not settings.MARKETLY_RESPONSE_CACHE_ENABLED:
        return False
    if get_redis_client() is not None:
        return True
    return _local_fallback_enabled()


def get_cached_search_response(cache_key: str) -> dict[str, Any] | None:
    if not settings.MARKETLY_RESPONSE_CACHE_ENABLED:
        return None

    client = get_redis_client()
    if client is not None:
        try:
            payload = client.get(cache_key)
            if payload:
                return _read_payload(payload)
            return None
        except Exception as exc:
            logger.warning("search response cache read failed key=%s error=%s", cache_key, exc)

    if _local_fallback_enabled():
        return _get_local_cached_search_response(cache_key)
    return None


def set_cached_search_response(cache_key: str, payload: dict[str, Any]) -> None:
    if not settings.MARKETLY_RESPONSE_CACHE_ENABLED:
        return

    client = get_redis_client()
    if client is not None:
        try:
            client.setex(
                cache_key,
                _response_cache_ttl_seconds(),
                json.dumps(payload, separators=(",", ":"), ensure_ascii=False),
            )
            return
        except Exception as exc:
            logger.warning("search response cache write failed key=%s error=%s", cache_key, exc)

    if _local_fallback_enabled():
        _set_local_cached_search_response(cache_key, payload)
