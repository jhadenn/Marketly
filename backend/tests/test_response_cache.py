from types import SimpleNamespace

from app.core.cache import TTLCache
from app.services import response_cache


class FakeRedis:
    def __init__(self):
        self.values: dict[str, str] = {}

    def get(self, key: str):
        return self.values.get(key)

    def setex(self, key: str, ttl_seconds: int, payload: str):
        self.values[key] = payload
        return True


def test_cache_key_varies_by_facebook_context():
    ctx_a = SimpleNamespace(
        user_id="user-a",
        credential_fingerprint_sha256="fp-a",
        latitude=43.6532,
        longitude=-79.3832,
        radius_km=25,
    )
    ctx_b = SimpleNamespace(
        user_id="user-b",
        credential_fingerprint_sha256="fp-b",
        latitude=45.4215,
        longitude=-75.6972,
        radius_km=25,
    )

    key_a = response_cache.build_search_response_cache_key(
        query="bike",
        sources=["facebook"],
        limit=24,
        offset=0,
        sort="relevance",
        facebook_runtime_context=ctx_a,
    )
    key_b = response_cache.build_search_response_cache_key(
        query="bike",
        sources=["facebook"],
        limit=24,
        offset=0,
        sort="relevance",
        facebook_runtime_context=ctx_b,
    )

    assert key_a != key_b


def test_response_cache_roundtrip(monkeypatch):
    fake_redis = FakeRedis()
    monkeypatch.setattr(response_cache.settings, "MARKETLY_RESPONSE_CACHE_ENABLED", True)
    monkeypatch.setattr(response_cache.settings, "MARKETLY_RESPONSE_CACHE_TTL_SECONDS", 45)
    monkeypatch.setattr(response_cache.settings, "MARKETLY_RESPONSE_CACHE_LOCAL_FALLBACK_ENABLED", True)
    monkeypatch.setattr(response_cache, "get_redis_client", lambda: fake_redis)
    monkeypatch.setattr(response_cache, "_local_response_cache", TTLCache(max_items=8))

    key = "marketly:test:key"
    payload = {
        "query": "iphone",
        "sources": ["ebay"],
        "count": 1,
        "results": [],
        "source_errors": {},
    }
    response_cache.set_cached_search_response(key, payload)

    cached = response_cache.get_cached_search_response(key)
    assert cached == payload


def test_response_cache_local_fallback_roundtrip(monkeypatch):
    monkeypatch.setattr(response_cache.settings, "MARKETLY_RESPONSE_CACHE_ENABLED", True)
    monkeypatch.setattr(response_cache.settings, "MARKETLY_RESPONSE_CACHE_TTL_SECONDS", 45)
    monkeypatch.setattr(response_cache.settings, "MARKETLY_RESPONSE_CACHE_LOCAL_FALLBACK_ENABLED", True)
    monkeypatch.setattr(response_cache, "get_redis_client", lambda: None)
    monkeypatch.setattr(response_cache, "_local_response_cache", TTLCache(max_items=8))

    key = "marketly:test:local:key"
    payload = {
        "query": "iphone",
        "sources": ["ebay"],
        "count": 1,
        "results": [],
        "source_errors": {},
    }

    response_cache.set_cached_search_response(key, payload)

    cached = response_cache.get_cached_search_response(key)
    assert cached == payload


def test_is_search_response_cache_active(monkeypatch):
    monkeypatch.setattr(response_cache.settings, "MARKETLY_RESPONSE_CACHE_ENABLED", True)
    monkeypatch.setattr(response_cache.settings, "MARKETLY_RESPONSE_CACHE_LOCAL_FALLBACK_ENABLED", True)

    monkeypatch.setattr(response_cache, "get_redis_client", lambda: None)
    assert response_cache.is_search_response_cache_active() is True

    monkeypatch.setattr(response_cache.settings, "MARKETLY_RESPONSE_CACHE_LOCAL_FALLBACK_ENABLED", False)
    assert response_cache.is_search_response_cache_active() is False

    monkeypatch.setattr(response_cache, "get_redis_client", lambda: FakeRedis())
    assert response_cache.is_search_response_cache_active() is True

    monkeypatch.setattr(response_cache.settings, "MARKETLY_RESPONSE_CACHE_ENABLED", False)
    assert response_cache.is_search_response_cache_active() is False


def test_response_cache_read_fail_returns_none(monkeypatch):
    class BrokenRedis:
        def get(self, key: str):
            raise RuntimeError("boom")

    monkeypatch.setattr(response_cache.settings, "MARKETLY_RESPONSE_CACHE_ENABLED", True)
    monkeypatch.setattr(response_cache.settings, "MARKETLY_RESPONSE_CACHE_LOCAL_FALLBACK_ENABLED", False)
    monkeypatch.setattr(response_cache, "get_redis_client", lambda: BrokenRedis())

    assert response_cache.get_cached_search_response("marketly:test:key") is None
