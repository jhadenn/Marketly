import asyncio

from app.models.listing import Listing
from app.services import search_service


def _listing(idx: int, *, source: str = "ebay") -> Listing:
    return Listing(
        source=source,
        source_listing_id=str(idx),
        title=f"item {idx}",
        url=f"https://example.com/{source}/{idx}",
        image_urls=[],
    )


def test_unified_search_multi_source_keeps_fetch_window_stable(monkeypatch):
    limit = 24
    monkeypatch.setattr(search_service, "_pagination_cache", search_service.TTLCache())
    base_pool = [_listing(idx) for idx in range(72)]
    expanded_pool = (
        [_listing(100 + idx, source="kijiji") for idx in range(20)]
        + base_pool
        + [_listing(200 + idx, source="facebook") for idx in range(20)]
    )
    fetch_limits: list[int] = []

    async def fake_fetch_and_score(query, sources, fetch_limit):
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


def test_unified_search_single_source_still_expands_fetch_window(monkeypatch):
    fetch_limits: list[int] = []

    async def fake_fetch_and_score(query, sources, fetch_limit):
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
