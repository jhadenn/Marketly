import hashlib
import time
from collections import OrderedDict
from dataclasses import dataclass
from threading import Lock

from fastapi import Request

from app.core.config import settings
from app.core.redis_client import get_redis_client


@dataclass
class RateLimitDecision:
    allowed: bool
    retry_after_seconds: int | None = None


_local_fixed_windows: OrderedDict[str, tuple[int, int]] = OrderedDict()
_local_lock = Lock()


def get_client_ip(request: Request) -> str:
    forwarded_for = request.headers.get("x-forwarded-for", "")
    if forwarded_for:
        first_hop = forwarded_for.split(",")[0].strip()
        if first_hop:
            return first_hop
    if request.client and request.client.host:
        return request.client.host
    return "unknown"


def _rate_limit_key(*, bucket: str, identifier: str, window_start: int) -> str:
    identifier_hash = hashlib.sha256(identifier.encode("utf-8")).hexdigest()[:24]
    return f"marketly:rl:{bucket}:{identifier_hash}:{window_start}"


def _decision_when_backend_unavailable(window_seconds: int) -> RateLimitDecision:
    if settings.MARKETLY_RATE_LIMIT_FAIL_OPEN:
        return RateLimitDecision(allowed=True)
    return RateLimitDecision(allowed=False, retry_after_seconds=window_seconds)


def _check_local_rate_limit(
    *,
    key: str,
    limit: int,
    window_seconds: int,
    now: int,
    window_start: int,
) -> RateLimitDecision:
    with _local_lock:
        expired_keys = [
            known_key
            for known_key, (_, expires_at) in _local_fixed_windows.items()
            if now >= expires_at
        ]
        for expired_key in expired_keys:
            _local_fixed_windows.pop(expired_key, None)

        expires_at = window_start + window_seconds
        count = 0
        existing = _local_fixed_windows.get(key)
        if existing is not None:
            current_count, current_expires_at = existing
            if now < current_expires_at:
                count = current_count
                expires_at = current_expires_at

        count += 1
        _local_fixed_windows[key] = (count, expires_at)
        _local_fixed_windows.move_to_end(key)

        max_keys = max(1, int(settings.MARKETLY_RATE_LIMIT_LOCAL_MAX_KEYS))
        while len(_local_fixed_windows) > max_keys:
            _local_fixed_windows.popitem(last=False)

    ttl_seconds = max(1, expires_at - now)
    if int(count) > int(limit):
        return RateLimitDecision(allowed=False, retry_after_seconds=ttl_seconds)
    return RateLimitDecision(allowed=True)


def check_rate_limit(
    *,
    bucket: str,
    identifier: str,
    limit: int,
    window_seconds: int,
) -> RateLimitDecision:
    if not settings.MARKETLY_RATE_LIMIT_ENABLED:
        return RateLimitDecision(allowed=True)
    if limit <= 0 or window_seconds <= 0:
        return RateLimitDecision(allowed=True)

    now = int(time.time())
    window_start = now - (now % window_seconds)
    key = _rate_limit_key(bucket=bucket, identifier=identifier, window_start=window_start)

    redis_client = get_redis_client()
    if redis_client is not None:
        try:
            pipeline = redis_client.pipeline()
            pipeline.incr(key)
            pipeline.expire(key, window_seconds, nx=True)
            pipeline.ttl(key)
            count, _, ttl = pipeline.execute()

            ttl_seconds = (
                ttl if isinstance(ttl, int) and ttl > 0 else max(1, window_seconds - (now % window_seconds))
            )
            if int(count) > int(limit):
                return RateLimitDecision(allowed=False, retry_after_seconds=ttl_seconds)
            return RateLimitDecision(allowed=True)
        except Exception:
            pass

    if settings.MARKETLY_RATE_LIMIT_LOCAL_FALLBACK_ENABLED:
        return _check_local_rate_limit(
            key=key,
            limit=limit,
            window_seconds=window_seconds,
            now=now,
            window_start=window_start,
        )

    return _decision_when_backend_unavailable(window_seconds)
