import asyncio

from app.models.listing import Listing
from app.services import search_service


def _listing(idx: int, *, source: str = "ebay", posted_at: str | None = None) -> Listing:
    return Listing(
        source=source,
        source_listing_id=str(idx),
        title=f"item {idx}",
        url=f"https://example.com/{source}/{idx}",
        image_urls=[],
        posted_at=posted_at,
    )


def test_unified_search_multi_source_keeps_fetch_window_stable(monkeypatch):
    limit = 24
    monkeypatch.setattr(search_service.settings, "MARKETLY_DISABLE_FACEBOOK_MULTI_SOURCE_EXPANSION", False)
    monkeypatch.setattr(search_service.settings, "MARKETLY_MULTI_SOURCE_MAX_EXPANSIONS", 4)
    monkeypatch.setattr(search_service.settings, "MARKETLY_BALANCE_MULTI_SOURCE_RESULTS", False)
    monkeypatch.setattr(search_service, "_pagination_cache", search_service.TTLCache())
    base_pool = [_listing(idx) for idx in range(72)]
    expanded_pool = (
        [_listing(100 + idx, source="kijiji") for idx in range(20)]
        + base_pool
        + [_listing(200 + idx, source="facebook") for idx in range(20)]
    )
    fetch_limits: list[int] = []

    async def fake_fetch_and_score(query, sources, fetch_limit, sort):
        fetch_limits.append(fetch_limit)
        if fetch_limit <= limit:
            return (
                base_pool,
                {},
                {"ebay": limit, "kijiji": limit, "facebook": limit},
            )
        return (
            expanded_pool,
            {},
            {"ebay": 30, "kijiji": 32, "facebook": 28},
        )

    monkeypatch.setattr(search_service, "_fetch_and_score", fake_fetch_and_score)
    monkeypatch.setattr(search_service, "_sort_results", lambda items, sort: items)

    page1, total1, next_offset1, _ = asyncio.run(
        search_service.unified_search(
            query="bike",
            sources=["ebay", "kijiji", "facebook"],
            limit=limit,
            offset=0,
            sort="relevance",
        )
    )
    page2, total2, next_offset2, _ = asyncio.run(
        search_service.unified_search(
            query="bike",
            sources=["ebay", "kijiji", "facebook"],
            limit=limit,
            offset=limit,
            sort="relevance",
        )
    )
    page3, total3, next_offset3, _ = asyncio.run(
        search_service.unified_search(
            query="bike",
            sources=["ebay", "kijiji", "facebook"],
            limit=limit,
            offset=48,
            sort="relevance",
        )
    )
    page4, total4, next_offset4, _ = asyncio.run(
        search_service.unified_search(
            query="bike",
            sources=["ebay", "kijiji", "facebook"],
            limit=limit,
            offset=72,
            sort="relevance",
        )
    )

    assert fetch_limits == [limit, 48]
    assert [item.source_listing_id for item in page1] == [str(idx) for idx in range(24)]
    assert [item.source_listing_id for item in page2] == [str(idx) for idx in range(24, 48)]
    assert [item.source_listing_id for item in page3] == [str(idx) for idx in range(48, 72)]
    assert [item.source_listing_id for item in page4] == [str(idx) for idx in range(100, 120)] + [
        str(idx) for idx in range(200, 204)
    ]
    assert total1 is None
    assert total2 is None
    assert total3 is None
    assert total4 == 112
    assert next_offset1 == 24
    assert next_offset2 == 48
    assert next_offset3 == 72
    assert next_offset4 == 96


def test_unified_search_multi_source_skips_expansion_when_facebook_guard_enabled(monkeypatch):
    limit = 24
    monkeypatch.setattr(search_service.settings, "MARKETLY_DISABLE_FACEBOOK_MULTI_SOURCE_EXPANSION", True)
    monkeypatch.setattr(search_service.settings, "MARKETLY_MULTI_SOURCE_MAX_EXPANSIONS", 4)
    monkeypatch.setattr(search_service.settings, "MARKETLY_BALANCE_MULTI_SOURCE_RESULTS", False)
    monkeypatch.setattr(search_service, "_pagination_cache", search_service.TTLCache())
    base_pool = [_listing(idx) for idx in range(limit * 2)]
    fetch_limits: list[int] = []

    async def fake_fetch_and_score(query, sources, fetch_limit, sort):
        fetch_limits.append(fetch_limit)
        return (
            base_pool[:fetch_limit],
            {},
            {"ebay": fetch_limit, "kijiji": fetch_limit, "facebook": fetch_limit},
        )

    monkeypatch.setattr(search_service, "_fetch_and_score", fake_fetch_and_score)
    monkeypatch.setattr(search_service, "_sort_results", lambda items, sort: items)

    page, total, next_offset, _ = asyncio.run(
        search_service.unified_search(
            query="bike",
            sources=["ebay", "kijiji", "facebook"],
            limit=limit,
            offset=limit,
            sort="relevance",
        )
    )

    assert fetch_limits == [limit * 2]
    assert [item.source_listing_id for item in page] == [str(idx) for idx in range(limit, limit * 2)]
    assert total is None
    assert next_offset == limit * 2


def test_unified_search_single_source_still_expands_fetch_window(monkeypatch):
    fetch_limits: list[int] = []

    async def fake_fetch_and_score(query, sources, fetch_limit, sort):
        fetch_limits.append(fetch_limit)
        return [_listing(idx) for idx in range(fetch_limit)], {}, {"ebay": fetch_limit}

    monkeypatch.setattr(search_service, "_fetch_and_score", fake_fetch_and_score)

    asyncio.run(
        search_service.unified_search(
            query="bike",
            sources=["ebay"],
            limit=24,
            offset=24,
            sort="relevance",
        )
    )

    assert fetch_limits == [48]


def test_unified_search_single_source_first_page_keeps_next_offset(monkeypatch):
    limit = 24
    fetch_limits: list[int] = []

    async def fake_fetch_and_score(query, sources, fetch_limit, sort):
        fetch_limits.append(fetch_limit)
        pool_size = min(fetch_limit, 50)
        return [_listing(idx) for idx in range(pool_size)], {}, {"ebay": pool_size}

    monkeypatch.setattr(search_service, "_fetch_and_score", fake_fetch_and_score)
    monkeypatch.setattr(search_service, "_sort_results", lambda items, sort: items)

    page1, total1, next_offset1, _ = asyncio.run(
        search_service.unified_search(
            query="bike",
            sources=["ebay"],
            limit=limit,
            offset=0,
            sort="relevance",
        )
    )
    page2, total2, next_offset2, _ = asyncio.run(
        search_service.unified_search(
            query="bike",
            sources=["ebay"],
            limit=limit,
            offset=limit,
            sort="relevance",
        )
    )
    page3, total3, next_offset3, _ = asyncio.run(
        search_service.unified_search(
            query="bike",
            sources=["ebay"],
            limit=limit,
            offset=48,
            sort="relevance",
        )
    )

    assert fetch_limits == [limit, 48, 72]
    assert [item.source_listing_id for item in page1] == [str(idx) for idx in range(24)]
    assert [item.source_listing_id for item in page2] == [str(idx) for idx in range(24, 48)]
    assert [item.source_listing_id for item in page3] == [str(idx) for idx in range(48, 50)]
    assert total1 is None
    assert total2 is None
    assert total3 == 50
    assert next_offset1 == 24
    assert next_offset2 == 48
    assert next_offset3 is None


def test_unified_search_multi_source_balances_sources_for_relevance(monkeypatch):
    monkeypatch.setattr(search_service.settings, "MARKETLY_BALANCE_MULTI_SOURCE_RESULTS", True)
    monkeypatch.setattr(search_service.settings, "MARKETLY_DISABLE_FACEBOOK_MULTI_SOURCE_EXPANSION", True)

    async def fake_fetch_and_score(query, sources, fetch_limit, sort):
        results = [
            _listing(1, source="ebay"),
            _listing(2, source="ebay"),
            _listing(3, source="ebay"),
            _listing(4, source="facebook"),
            _listing(5, source="facebook"),
        ]
        return results, {}, {"ebay": 3, "facebook": 2}

    monkeypatch.setattr(search_service, "_fetch_and_score", fake_fetch_and_score)
    monkeypatch.setattr(search_service, "_sort_results", lambda items, sort: items)

    page, _, _, _ = asyncio.run(
        search_service.unified_search(
            query="bike",
            sources=["ebay", "facebook"],
            limit=4,
            offset=0,
            sort="relevance",
        )
    )

    assert [item.source for item in page] == ["ebay", "facebook", "ebay", "facebook"]


def test_sort_results_newest_prefers_timestamps_and_pushes_missing_to_bottom():
    items = [
        _listing(1, posted_at="2026-03-20T10:00:00Z"),
        _listing(2),
        _listing(3, posted_at="2026-03-24T12:00:00Z"),
        _listing(4, posted_at="2026-03-24T12:00:00Z"),
    ]

    ordered = search_service._sort_results(items, sort="newest")

    assert [item.source_listing_id for item in ordered] == ["3", "4", "1", "2"]


def test_fetch_source_facebook_requires_auth(monkeypatch):
    monkeypatch.setattr(search_service.settings, "MARKETLY_ENABLE_FACEBOOK", True)

    src, listings, source_error = asyncio.run(
        search_service._fetch_source(
            src="facebook",
            query="bike",
            fetch_limit=10,
            facebook_runtime_context=search_service.FacebookRuntimeContext(user_id=None),
        )
    )

    assert src == "facebook"
    assert listings == []
    assert source_error is not None
    assert source_error.code == "AUTH_REQUIRED"


def test_fetch_source_facebook_requires_byoc(monkeypatch):
    monkeypatch.setattr(search_service.settings, "MARKETLY_ENABLE_FACEBOOK", True)

    src, listings, source_error = asyncio.run(
        search_service._fetch_source(
            src="facebook",
            query="bike",
            fetch_limit=10,
            facebook_runtime_context=search_service.FacebookRuntimeContext(user_id="user-1"),
        )
    )

    assert src == "facebook"
    assert listings == []
    assert source_error is not None
    assert source_error.code == "BYOC_REQUIRED"


def test_fetch_source_facebook_applies_limit_cap(monkeypatch):
    monkeypatch.setattr(search_service.settings, "MARKETLY_ENABLE_FACEBOOK", True)
    monkeypatch.setattr(search_service.settings, "MARKETLY_FACEBOOK_MAX_FETCH_LIMIT", 7)
    monkeypatch.setattr(search_service.settings, "MARKETLY_FACEBOOK_MAX_SCRAPE_LIMIT", 7)

    captured: dict[str, int] = {}

    class FakeFacebookConnector:
        async def search(self, **kwargs):
            captured["limit"] = int(kwargs["limit"])
            return [_listing(1, source="facebook")]

    monkeypatch.setitem(search_service.CONNECTORS, "facebook", FakeFacebookConnector())

    src, listings, source_error = asyncio.run(
        search_service._fetch_source(
            src="facebook",
            query="bike",
            fetch_limit=20,
            facebook_runtime_context=search_service.FacebookRuntimeContext(
                user_id="user-1",
                cookie_payload=[{"name": "c_user"}],
            ),
            is_multi_source=True,
        )
    )

    assert src == "facebook"
    assert source_error is None
    assert captured["limit"] == 7
    assert len(listings) == 1


def test_fetch_source_facebook_multi_source_uses_higher_hard_cap(monkeypatch):
    monkeypatch.setattr(search_service.settings, "MARKETLY_ENABLE_FACEBOOK", True)
    monkeypatch.setattr(search_service.settings, "MARKETLY_FACEBOOK_MAX_FETCH_LIMIT", 12)
    monkeypatch.setattr(search_service.settings, "MARKETLY_FACEBOOK_MAX_SCRAPE_LIMIT", 32)

    captured: dict[str, int] = {}

    class FakeFacebookConnector:
        async def search(self, **kwargs):
            captured["limit"] = int(kwargs["limit"])
            return [_listing(1, source="facebook")]

    monkeypatch.setitem(search_service.CONNECTORS, "facebook", FakeFacebookConnector())

    src, listings, source_error = asyncio.run(
        search_service._fetch_source(
            src="facebook",
            query="bike",
            fetch_limit=48,
            facebook_runtime_context=search_service.FacebookRuntimeContext(
                user_id="user-1",
                cookie_payload=[{"name": "c_user"}],
            ),
            is_multi_source=True,
        )
    )

    assert src == "facebook"
    assert source_error is None
    assert captured["limit"] == 32
    assert len(listings) == 1


def test_fetch_source_facebook_single_source_not_capped(monkeypatch):
    monkeypatch.setattr(search_service.settings, "MARKETLY_ENABLE_FACEBOOK", True)
    monkeypatch.setattr(search_service.settings, "MARKETLY_FACEBOOK_MAX_FETCH_LIMIT", 7)

    captured: dict[str, int] = {}

    class FakeFacebookConnector:
        async def search(self, **kwargs):
            captured["limit"] = int(kwargs["limit"])
            return [_listing(1, source="facebook")]

    monkeypatch.setitem(search_service.CONNECTORS, "facebook", FakeFacebookConnector())

    src, listings, source_error = asyncio.run(
        search_service._fetch_source(
            src="facebook",
            query="bike",
            fetch_limit=20,
            facebook_runtime_context=search_service.FacebookRuntimeContext(
                user_id="user-1",
                cookie_payload=[{"name": "c_user"}],
            ),
            is_multi_source=False,
        )
    )

    assert src == "facebook"
    assert source_error is None
    assert captured["limit"] == 20
    assert len(listings) == 1


def test_fetch_source_facebook_timeout_returns_timeout_error(monkeypatch):
    monkeypatch.setattr(search_service.settings, "MARKETLY_ENABLE_FACEBOOK", True)
    monkeypatch.setattr(search_service.settings, "MARKETLY_FACEBOOK_SOURCE_TIMEOUT_SECONDS", 0.001)
    monkeypatch.setattr(
        search_service.settings, "MARKETLY_FACEBOOK_SOURCE_TIMEOUT_SECONDS_SINGLE_SOURCE", 0.001
    )

    class SlowFacebookConnector:
        async def search(self, **kwargs):
            await asyncio.sleep(0.05)
            return [_listing(1, source="facebook")]

    monkeypatch.setitem(search_service.CONNECTORS, "facebook", SlowFacebookConnector())

    src, listings, source_error = asyncio.run(
        search_service._fetch_source(
            src="facebook",
            query="bike",
            fetch_limit=10,
            facebook_runtime_context=search_service.FacebookRuntimeContext(
                user_id="user-1",
                cookie_payload=[{"name": "c_user"}],
            ),
        )
    )

    assert src == "facebook"
    assert listings == []
    assert source_error is not None
    assert source_error.code == "TIMEOUT"


def test_cache_keys_vary_by_facebook_user_cookie_and_location():
    ctx_a = search_service.FacebookRuntimeContext(
        user_id="user-a",
        credential_fingerprint_sha256="fp-a",
        latitude=43.65321,
        longitude=-79.38318,
        radius_km=25,
    )
    ctx_b = search_service.FacebookRuntimeContext(
        user_id="user-b",
        credential_fingerprint_sha256="fp-b",
        latitude=45.42153,
        longitude=-75.69719,
        radius_km=25,
    )

    key_a = search_service._cache_key("bike", ["facebook"], 24, ctx_a)
    key_b = search_service._cache_key("bike", ["facebook"], 24, ctx_b)
    pag_a = search_service._pagination_key("bike", ["facebook"], "relevance", 24, ctx_a)
    pag_b = search_service._pagination_key("bike", ["facebook"], "relevance", 24, ctx_b)

    assert key_a != key_b
    assert pag_a != pag_b
