import logging

try:
    from redis import Redis
except Exception:  # pragma: no cover - optional runtime dependency during local tests
    Redis = None  # type: ignore[assignment]

from app.core.config import settings

logger = logging.getLogger(__name__)

_redis_client = None


def get_redis_client():
    global _redis_client
    if _redis_client is not None:
        return _redis_client

    redis_url = (settings.REDIS_URL or "").strip()
    if not redis_url:
        return None

    if Redis is None:
        logger.warning("redis client library is unavailable; continuing without redis")
        return None

    try:
        _redis_client = Redis.from_url(
            redis_url,
            decode_responses=True,
            socket_timeout=1.5,
            socket_connect_timeout=1.5,
            health_check_interval=30,
        )
    except Exception as exc:
        logger.warning("failed to initialize redis client: %s", exc)
        _redis_client = None

    return _redis_client
