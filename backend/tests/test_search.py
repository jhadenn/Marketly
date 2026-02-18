from fastapi.testclient import TestClient

from app.main import app
from app.models.listing import Listing, Money

client = TestClient(app)


def _sample_listing(source: str, listing_id: str) -> Listing:
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
    )


def test_search_supports_pagination_and_sort(monkeypatch):
    captured = {}

    async def fake_unified_search(query, sources, limit=20, offset=0, sort="relevance"):
        captured["query"] = query
        captured["sources"] = sources
        captured["limit"] = limit
        captured["offset"] = offset
        captured["sort"] = sort
        return ([_sample_listing("ebay", "1"), _sample_listing("kijiji", "2")], 42, 20)

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
    assert {item["source"] for item in payload["results"]} == {"ebay", "kijiji"}

    assert captured == {
        "query": "iphone",
        "sources": ["ebay", "kijiji"],
        "limit": 20,
        "offset": 0,
        "sort": "price_asc",
    }


def test_search_keeps_comma_separated_sources_compatibility(monkeypatch):
    captured = {}

    async def fake_unified_search(query, sources, limit=20, offset=0, sort="relevance"):
        captured["sources"] = sources
        return ([_sample_listing("ebay", "1")], 1, None)

    monkeypatch.setattr("app.main.unified_search", fake_unified_search)

    response = client.get("/search", params={"q": "iphone", "sources": "ebay,kijiji"})

    assert response.status_code == 200
    payload = response.json()
    assert payload["sources"] == ["ebay", "kijiji"]
    assert captured["sources"] == ["ebay", "kijiji"]
