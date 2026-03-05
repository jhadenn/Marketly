from app.core.cache import TTLCache


def test_ttl_cache_expires_entries(monkeypatch):
    now = {"value": 100.0}
    monkeypatch.setattr("app.core.cache.time.time", lambda: now["value"])

    cache = TTLCache(max_items=4)
    cache.set("key", {"ok": True}, ttl_seconds=5)

    assert cache.get("key") == {"ok": True}

    now["value"] = 106.0
    assert cache.get("key") is None


def test_ttl_cache_max_items_uses_lru_eviction(monkeypatch):
    now = {"value": 100.0}
    monkeypatch.setattr("app.core.cache.time.time", lambda: now["value"])

    cache = TTLCache(max_items=2)
    cache.set("a", 1, ttl_seconds=30)
    cache.set("b", 2, ttl_seconds=30)

    assert cache.get("a") == 1

    cache.set("c", 3, ttl_seconds=30)

    assert cache.get("b") is None
    assert cache.get("a") == 1
    assert cache.get("c") == 3
