import hashlib
from app.connectors import CONNECTORS
from app.core.cache import TTLCache
from app.core.config import settings
from app.models.listing import Listing
from app.services.scoring import score_listing

_cache = TTLCache()


def _cache_key(query: str, sources: list[str], limit: int) -> str:
    raw = f"{query}|{','.join(sorted(sources))}|{limit}"
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


async def unified_search(query: str, sources: list[str], limit: int = 20) -> list[Listing]:
    key = _cache_key(query, sources, limit)
    cached = _cache.get(key)
    if cached is not None:
        return cached

    results: list[Listing] = []
    for src in sources:
        connector = CONNECTORS.get(src)
        if not connector:
            continue
        listings = await connector.search(query=query, limit=limit)
        results.extend(listings)

    # Simple ranking for MVP: cheapest first (you can change later)
    results.sort(key=lambda x: x.price.amount)

    _cache.set(key, results, ttl_seconds=settings.CACHE_TTL_SECONDS)
    return results
