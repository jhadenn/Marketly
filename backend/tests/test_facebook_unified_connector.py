import asyncio

from app.connectors.facebook_marketplace.unified_connector import FacebookUnifiedConnector


def _valid_cookie_metadata(_payload):
    return 4, {"c_user", "xs", "fr", "datr"}


def test_automotive_multi_source_caps_fetch_depth(monkeypatch):
    connector = FacebookUnifiedConnector()
    captured: dict[str, int] = {}

    async def fake_search(request):
        captured["limit"] = int(request.limit)
        return []

    monkeypatch.setattr(connector, "_read_cookie_metadata_from_payload", _valid_cookie_metadata)
    monkeypatch.setattr(connector._connector, "search", fake_search)

    asyncio.run(
        connector.search(
            query="mazda miata",
            limit=24,
            cookie_payload=[{"name": "c_user"}],
            multi_source=True,
        )
    )

    assert captured["limit"] == 12


def test_automotive_single_source_removes_overfetch(monkeypatch):
    connector = FacebookUnifiedConnector()
    captured: dict[str, int] = {}

    async def fake_search(request):
        captured["limit"] = int(request.limit)
        return []

    monkeypatch.setattr(connector, "_read_cookie_metadata_from_payload", _valid_cookie_metadata)
    monkeypatch.setattr(connector._connector, "search", fake_search)

    asyncio.run(
        connector.search(
            query="mazda miata",
            limit=24,
            cookie_payload=[{"name": "c_user"}],
            multi_source=False,
        )
    )

    assert captured["limit"] == 24


def test_non_automotive_single_source_keeps_existing_overfetch(monkeypatch):
    connector = FacebookUnifiedConnector()
    captured: dict[str, int] = {}

    async def fake_search(request):
        captured["limit"] = int(request.limit)
        return []

    monkeypatch.setattr(connector, "_read_cookie_metadata_from_payload", _valid_cookie_metadata)
    monkeypatch.setattr(connector._connector, "search", fake_search)

    asyncio.run(
        connector.search(
            query="sofa",
            limit=24,
            cookie_payload=[{"name": "c_user"}],
            multi_source=False,
        )
    )

    assert captured["limit"] == 30
