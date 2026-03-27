from types import SimpleNamespace

from fastapi.testclient import TestClient

from app.auth import get_current_user_id
from app.core.cache import TTLCache
from app.db import get_db
from app.main import app
from app.models.listing import Listing, Money
from app.models.saved_search import SavedSearch

from .utils import build_test_session_factory, db_override_factory

client = TestClient(app)


def _override_auth():
    return "user-123"


def _sample_listing(
    source: str,
    listing_id: str,
    *,
    vehicle_mileage_km: float | None = None,
) -> Listing:
    return Listing(
        source=source,
        source_listing_id=listing_id,
        title=f"{source} item {listing_id}",
        price=Money(amount=100, currency="CAD"),
        url=f"https://example.com/{source}/{listing_id}",
        image_urls=[],
        location="Toronto",
        condition="used",
        snippet="sample",
        vehicle_mileage_km=vehicle_mileage_km,
    )


def test_search_supports_pagination_and_sort(monkeypatch):
    captured = {}

    async def fake_unified_search(query, sources, limit=20, offset=0, sort="relevance", **kwargs):
        captured["query"] = query
        captured["sources"] = sources
        captured["limit"] = limit
        captured["offset"] = offset
        captured["sort"] = sort
        captured["kwargs"] = kwargs
        return ([_sample_listing("ebay", "1"), _sample_listing("kijiji", "2")], 42, 20, {})

    monkeypatch.setattr("app.main.unified_search", fake_unified_search)

    response = client.get(
        "/search",
        params=[
            ("q", "iphone"),
            ("sources", "ebay"),
            ("sources", "kijiji"),
            ("limit", "20"),
            ("offset", "0"),
            ("sort", "price_asc"),
        ],
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["query"] == "iphone"
    assert payload["count"] == 2
    assert payload["next_offset"] == 20
    assert payload["total"] == 42
    assert payload["sources"] == ["ebay", "kijiji"]
    assert payload["source_errors"] == {}
    assert {item["source"] for item in payload["results"]} == {"ebay", "kijiji"}

    assert captured == {
        "query": "iphone",
        "sources": ["ebay", "kijiji"],
        "limit": 20,
        "offset": 0,
        "sort": "price_asc",
        "kwargs": {"search_location_context": None},
    }


def test_search_keeps_comma_separated_sources_compatibility(monkeypatch):
    captured = {}

    async def fake_unified_search(query, sources, limit=20, offset=0, sort="relevance", **kwargs):
        captured["sources"] = sources
        return ([_sample_listing("ebay", "1")], 1, None, {})

    monkeypatch.setattr("app.main.unified_search", fake_unified_search)

    response = client.get("/search", params={"q": "iphone", "sources": "ebay,kijiji"})

    assert response.status_code == 200
    payload = response.json()
    assert payload["sources"] == ["ebay", "kijiji"]
    assert captured["sources"] == ["ebay", "kijiji"]


def test_search_propagates_newest_sort(monkeypatch):
    captured = {}

    async def fake_unified_search(query, sources, limit=20, offset=0, sort="relevance", **kwargs):
        captured["sort"] = sort
        return ([_sample_listing("ebay", "1")], 1, None, {})

    monkeypatch.setattr("app.main.unified_search", fake_unified_search)

    response = client.get(
        "/search",
        params={"q": "iphone", "sources": "ebay", "sort": "newest"},
    )

    assert response.status_code == 200
    assert captured["sort"] == "newest"


def test_search_can_include_facebook_and_pass_source_errors(monkeypatch):
    captured = {}

    async def fake_unified_search(query, sources, limit=20, offset=0, sort="relevance", **kwargs):
        captured["sources"] = sources
        captured["kwargs"] = kwargs
        return (
            [_sample_listing("ebay", "1")],
            1,
            None,
            {
                "facebook": {
                    "code": "DISABLED",
                    "message": "Facebook source is disabled by server configuration.",
                    "retryable": False,
                }
            },
        )

    monkeypatch.setattr("app.main.unified_search", fake_unified_search)

    response = client.get(
        "/search",
        params={
            "q": "bike",
            "sources": "ebay",
            "include_facebook": "true",
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["sources"] == ["ebay", "facebook"]
    assert payload["source_errors"]["facebook"]["code"] == "DISABLED"
    assert captured["sources"] == ["ebay", "facebook"]
    assert "facebook_runtime_context" in captured["kwargs"]


def test_search_facebook_only_keeps_pagination_alive(monkeypatch):
    captured = {}

    async def fake_unified_search(query, sources, limit=20, offset=0, sort="relevance", **kwargs):
        captured["sources"] = sources
        return (
            [_sample_listing("facebook", str(i)) for i in range(limit)],
            None,
            offset + limit,
            {},
        )

    monkeypatch.setattr("app.main.unified_search", fake_unified_search)

    response = client.get(
        "/search",
        params={
            "q": "badminton racket",
            "sources": "facebook",
            "limit": "20",
            "offset": "0",
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["sources"] == ["facebook"]
    assert payload["count"] == 20
    assert payload["next_offset"] == 20
    assert payload["total"] is None
    assert captured["sources"] == ["facebook"]


def test_search_passes_facebook_runtime_context_and_location(monkeypatch):
    captured = {}
    engine, session_factory = build_test_session_factory()
    app.dependency_overrides[get_db] = db_override_factory(session_factory)

    class FakeContext:
        def __init__(self):
            self.user_id = "user-123"
            self.cookie_payload = [{"name": "c_user"}]
            self.credential_fingerprint_sha256 = "abc"
            self.latitude = 43.6532
            self.longitude = -79.3832
            self.radius_km = 25

    def fake_build_context(**kwargs):
        captured["context_build_kwargs"] = kwargs
        return FakeContext()

    async def fake_unified_search(query, sources, limit=20, offset=0, sort="relevance", **kwargs):
        captured["unified_kwargs"] = kwargs
        return ([_sample_listing("facebook", "1")], None, None, {})

    monkeypatch.setattr("app.main._build_facebook_runtime_context", fake_build_context)
    monkeypatch.setattr("app.main.unified_search", fake_unified_search)

    response = client.get(
        "/search",
        params={
            "q": "chair",
            "sources": "facebook",
            "latitude": "43.6532",
            "longitude": "-79.3832",
            "radius_km": "25",
        },
        headers={"Authorization": "Bearer invalid"},
    )

    assert response.status_code == 200
    assert "facebook_runtime_context" in captured["unified_kwargs"]
    assert captured["unified_kwargs"]["search_location_context"].display_name == "Toronto, ON"
    assert captured["unified_kwargs"]["search_location_context"].mode == "gps"
    assert captured["context_build_kwargs"]["latitude"] == 43.6532
    assert captured["context_build_kwargs"]["longitude"] == -79.3832
    assert captured["context_build_kwargs"]["radius_km"] == 25

    app.dependency_overrides.clear()
    engine.dispose()


def test_location_resolve_endpoint_manual_city():
    response = client.post(
        "/location/resolve",
        json={"city": "Toronto", "province": "Ontario"},
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["display_name"] == "Toronto, ON"
    assert payload["province_code"] == "ON"
    assert payload["country_code"] == "CA"
    assert payload["mode"] == "manual"


def test_me_location_crud_and_saved_search_run_use_stored_location(monkeypatch):
    engine, session_factory = build_test_session_factory()
    app.dependency_overrides[get_current_user_id] = _override_auth
    app.dependency_overrides[get_db] = db_override_factory(session_factory)

    db = session_factory()
    saved_search = SavedSearch(
        user_id="user-123",
        query="road bike",
        sources="kijiji,ebay",
        alerts_enabled=True,
    )
    db.add(saved_search)
    db.commit()
    db.refresh(saved_search)
    db.close()

    captured: dict[str, object] = {}

    async def fake_unified_search(query, sources, limit=20, offset=0, sort="relevance", **kwargs):
        captured["query"] = query
        captured["sources"] = sources
        captured["kwargs"] = kwargs
        return ([_sample_listing("kijiji", "1")], 1, None, {})

    monkeypatch.setattr("app.main.unified_search", fake_unified_search)

    put_response = client.put(
        "/me/location",
        json={"city": "Toronto", "province": "ON"},
    )
    get_response = client.get("/me/location")
    run_response = client.get(f"/saved-searches/{saved_search.id}/run")
    delete_response = client.delete("/me/location")
    get_after_delete = client.get("/me/location")

    assert put_response.status_code == 200
    assert get_response.status_code == 200
    assert get_response.json()["display_name"] == "Toronto, ON"
    assert run_response.status_code == 200
    assert captured["query"] == "road bike"
    assert captured["sources"] == ["kijiji", "ebay"]
    search_location_context = captured["kwargs"]["search_location_context"]
    assert search_location_context is not None
    assert search_location_context.display_name == "Toronto, ON"
    assert delete_response.status_code == 200
    assert delete_response.json()["deleted"] is True
    assert get_after_delete.status_code == 200
    assert get_after_delete.json() is None

    app.dependency_overrides.clear()
    engine.dispose()


def test_saved_search_run_cache_hit_returns_header(monkeypatch):
    engine, session_factory = build_test_session_factory()
    app.dependency_overrides[get_current_user_id] = _override_auth
    app.dependency_overrides[get_db] = db_override_factory(session_factory)

    db = session_factory()
    try:
        saved_search = SavedSearch(
            user_id="user-123",
            query="road bike",
            sources="ebay",
            alerts_enabled=True,
        )
        db.add(saved_search)
        db.commit()
        db.refresh(saved_search)
        saved_search_id = saved_search.id
    finally:
        db.close()

    calls = {"unified_search": 0}

    async def fake_unified_search(query, sources, limit=20, offset=0, sort="relevance", **kwargs):
        calls["unified_search"] += 1
        return ([_sample_listing("ebay", "1")], 1, None, {})

    monkeypatch.setattr("app.main.unified_search", fake_unified_search)
    monkeypatch.setattr("app.main._enrich_results", lambda db, *, query, results: results)
    monkeypatch.setattr("app.main.persist_listing_snapshots", lambda **kwargs: 1)
    monkeypatch.setattr("app.main.settings.MARKETLY_RESPONSE_CACHE_ENABLED", True)
    monkeypatch.setattr("app.main.settings.MARKETLY_RESPONSE_CACHE_LOCAL_FALLBACK_ENABLED", True)
    monkeypatch.setattr("app.main.settings.MARKETLY_SAVED_SEARCH_RUN_CACHE_TTL_SECONDS", 300)
    monkeypatch.setattr("app.services.response_cache.get_redis_client", lambda: None)
    monkeypatch.setattr("app.services.response_cache._local_response_cache", TTLCache(max_items=8))

    first = client.get(f"/saved-searches/{saved_search_id}/run")
    second = client.get(f"/saved-searches/{saved_search_id}/run")

    assert first.status_code == 200
    assert second.status_code == 200
    assert first.headers.get("x-cache") == "MISS"
    assert second.headers.get("x-cache") == "HIT"
    assert calls["unified_search"] == 1

    app.dependency_overrides.clear()
    engine.dispose()


def test_saved_search_run_refresh_bypasses_cache(monkeypatch):
    engine, session_factory = build_test_session_factory()
    app.dependency_overrides[get_current_user_id] = _override_auth
    app.dependency_overrides[get_db] = db_override_factory(session_factory)

    db = session_factory()
    try:
        saved_search = SavedSearch(
            user_id="user-123",
            query="road bike",
            sources="ebay",
            alerts_enabled=True,
        )
        db.add(saved_search)
        db.commit()
        db.refresh(saved_search)
        saved_search_id = saved_search.id
    finally:
        db.close()

    calls = {"unified_search": 0}

    async def fake_unified_search(query, sources, limit=20, offset=0, sort="relevance", **kwargs):
        calls["unified_search"] += 1
        return ([_sample_listing("ebay", str(calls["unified_search"]))], 1, None, {})

    monkeypatch.setattr("app.main.unified_search", fake_unified_search)
    monkeypatch.setattr("app.main._enrich_results", lambda db, *, query, results: results)
    monkeypatch.setattr("app.main.persist_listing_snapshots", lambda **kwargs: 1)
    monkeypatch.setattr("app.main.settings.MARKETLY_RESPONSE_CACHE_ENABLED", True)
    monkeypatch.setattr("app.main.settings.MARKETLY_RESPONSE_CACHE_LOCAL_FALLBACK_ENABLED", True)
    monkeypatch.setattr("app.main.settings.MARKETLY_SAVED_SEARCH_RUN_CACHE_TTL_SECONDS", 300)
    monkeypatch.setattr("app.services.response_cache.get_redis_client", lambda: None)
    monkeypatch.setattr("app.services.response_cache._local_response_cache", TTLCache(max_items=8))

    first = client.get(f"/saved-searches/{saved_search_id}/run")
    refreshed = client.get(f"/saved-searches/{saved_search_id}/run", params={"refresh": "true"})
    third = client.get(f"/saved-searches/{saved_search_id}/run")

    assert first.status_code == 200
    assert refreshed.status_code == 200
    assert third.status_code == 200
    assert first.headers.get("x-cache") == "MISS"
    assert refreshed.headers.get("x-cache") == "BYPASS"
    assert third.headers.get("x-cache") == "HIT"
    assert refreshed.json()["results"][0]["source_listing_id"] == "2"
    assert third.json()["results"][0]["source_listing_id"] == "2"
    assert calls["unified_search"] == 2

    app.dependency_overrides.clear()
    engine.dispose()


def test_saved_search_run_cache_key_varies_by_facebook_context_and_location(monkeypatch):
    engine, session_factory = build_test_session_factory()
    app.dependency_overrides[get_current_user_id] = _override_auth
    app.dependency_overrides[get_db] = db_override_factory(session_factory)

    db = session_factory()
    try:
        saved_search = SavedSearch(
            user_id="user-123",
            query="bike",
            sources="facebook",
            alerts_enabled=True,
        )
        db.add(saved_search)
        db.commit()
        db.refresh(saved_search)
        saved_search_id = saved_search.id
    finally:
        db.close()

    calls = {"unified_search": 0}
    context_state = {
        "fingerprint": "fp-a",
        "cookie_payload": [{"name": "c_user"}],
    }

    def fake_build_context(**kwargs):
        return SimpleNamespace(
            user_id="user-123",
            cookie_payload=context_state["cookie_payload"],
            credential_fingerprint_sha256=context_state["fingerprint"],
            latitude=kwargs.get("latitude"),
            longitude=kwargs.get("longitude"),
            radius_km=kwargs.get("radius_km"),
        )

    async def fake_unified_search(query, sources, limit=20, offset=0, sort="relevance", **kwargs):
        calls["unified_search"] += 1
        return ([_sample_listing("facebook", str(calls["unified_search"]))], 1, None, {})

    monkeypatch.setattr("app.main._build_facebook_runtime_context", fake_build_context)
    monkeypatch.setattr("app.main.unified_search", fake_unified_search)
    monkeypatch.setattr("app.main._enrich_results", lambda db, *, query, results: results)
    monkeypatch.setattr("app.main.persist_listing_snapshots", lambda **kwargs: 1)
    monkeypatch.setattr("app.main.settings.MARKETLY_RESPONSE_CACHE_ENABLED", True)
    monkeypatch.setattr("app.main.settings.MARKETLY_RESPONSE_CACHE_LOCAL_FALLBACK_ENABLED", True)
    monkeypatch.setattr("app.main.settings.MARKETLY_SAVED_SEARCH_RUN_CACHE_TTL_SECONDS", 300)
    monkeypatch.setattr("app.services.response_cache.get_redis_client", lambda: None)
    monkeypatch.setattr("app.services.response_cache._local_response_cache", TTLCache(max_items=8))

    first = client.get(
        f"/saved-searches/{saved_search_id}/run",
        params={"latitude": "43.6532", "longitude": "-79.3832"},
    )
    second = client.get(
        f"/saved-searches/{saved_search_id}/run",
        params={"latitude": "43.6532", "longitude": "-79.3832"},
    )
    context_state["fingerprint"] = "fp-b"
    third = client.get(
        f"/saved-searches/{saved_search_id}/run",
        params={"latitude": "43.6532", "longitude": "-79.3832"},
    )
    fourth = client.get(
        f"/saved-searches/{saved_search_id}/run",
        params={"latitude": "45.4215", "longitude": "-75.6972"},
    )

    assert first.status_code == 200
    assert second.status_code == 200
    assert third.status_code == 200
    assert fourth.status_code == 200
    assert first.headers.get("x-cache") == "MISS"
    assert second.headers.get("x-cache") == "HIT"
    assert third.headers.get("x-cache") == "MISS"
    assert fourth.headers.get("x-cache") == "MISS"
    assert calls["unified_search"] == 3

    app.dependency_overrides.clear()
    engine.dispose()


def test_search_cache_hit_returns_header(monkeypatch):
    payload = {
        "query": "iphone",
        "sources": ["ebay"],
        "count": 1,
        "results": [
            {
                "source": "ebay",
                "source_listing_id": "1",
                "title": "ebay item 1",
                "price": {"amount": 100.0, "currency": "CAD"},
                "url": "https://example.com/ebay/1",
                "image_urls": [],
                "location": "Toronto",
                "latitude": None,
                "longitude": None,
                "condition": None,
                "snippet": None,
                "score": 0.0,
                "score_reason": None,
            }
        ],
        "next_offset": None,
        "total": 1,
        "source_errors": {},
    }

    monkeypatch.setattr("app.main.settings.MARKETLY_RESPONSE_CACHE_ENABLED", True)
    monkeypatch.setattr("app.main.is_search_response_cache_active", lambda: True)
    monkeypatch.setattr("app.main.get_cached_search_response", lambda key: payload)
    monkeypatch.setattr("app.main.unified_search", lambda *args, **kwargs: (_ for _ in ()).throw(RuntimeError("should not call")))

    response = client.get("/search", params={"q": "iphone", "sources": "ebay"})

    assert response.status_code == 200
    assert response.headers.get("x-cache") == "HIT"
    assert response.json()["count"] == 1


def test_search_returns_vehicle_mileage_when_present(monkeypatch):
    async def fake_unified_search(query, sources, limit=20, offset=0, sort="relevance", **kwargs):
        return ([_sample_listing("kijiji", "car-1", vehicle_mileage_km=123456)], 1, None, {})

    monkeypatch.setattr("app.main.unified_search", fake_unified_search)

    response = client.get("/search", params={"q": "civic", "sources": "kijiji"})

    assert response.status_code == 200
    assert response.json()["results"][0]["vehicle_mileage_km"] == 123456.0


def test_search_local_cache_fallback_miss_then_hit(monkeypatch):
    calls = {"unified_search": 0}

    async def fake_unified_search(query, sources, limit=20, offset=0, sort="relevance", **kwargs):
        calls["unified_search"] += 1
        return ([_sample_listing("ebay", "1")], 1, None, {})

    monkeypatch.setattr("app.main.unified_search", fake_unified_search)
    monkeypatch.setattr("app.main.settings.MARKETLY_RESPONSE_CACHE_ENABLED", True)
    monkeypatch.setattr("app.main.settings.MARKETLY_RESPONSE_CACHE_LOCAL_FALLBACK_ENABLED", True)
    monkeypatch.setattr("app.main.settings.REDIS_URL", "")
    monkeypatch.setattr("app.services.response_cache.get_redis_client", lambda: None)
    monkeypatch.setattr("app.services.response_cache._local_response_cache", TTLCache(max_items=8))

    first = client.get("/search", params={"q": "iphone", "sources": "ebay"})
    second = client.get("/search", params={"q": "iphone", "sources": "ebay"})

    assert first.status_code == 200
    assert second.status_code == 200
    assert first.headers.get("x-cache") == "MISS"
    assert second.headers.get("x-cache") == "HIT"
    assert calls["unified_search"] == 1


def test_search_rate_limit_returns_429(monkeypatch):
    monkeypatch.setattr("app.main.settings.MARKETLY_RATE_LIMIT_ENABLED", True)
    monkeypatch.setattr(
        "app.main.check_rate_limit",
        lambda **kwargs: SimpleNamespace(allowed=False, retry_after_seconds=17),
    )

    response = client.get("/search", params={"q": "iphone", "sources": "ebay"})

    assert response.status_code == 429
    payload = response.json()
    assert payload["code"] == "RATE_LIMITED"
    assert payload["retry_after_seconds"] == 17
    assert response.headers.get("Retry-After") == "17"
