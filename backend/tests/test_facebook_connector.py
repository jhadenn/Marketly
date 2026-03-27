import asyncio

from fastapi.testclient import TestClient

from app.connectors.facebook_marketplace import connector as connector_module
from app.connectors.facebook_marketplace import (
    FacebookConnectorError,
    FacebookConnectorErrorCode,
    FacebookNormalizedListing,
)
from app.connectors.facebook_marketplace.connector import (
    FacebookMarketplaceConnector,
    _apply_vehicle_detail_text,
    _needs_vehicle_detail_enrichment,
)
from app.main import app

client = TestClient(app)


def _sample_record() -> FacebookNormalizedListing:
    return FacebookNormalizedListing(
        source="facebook",
        external_id="1234567890",
        title="Vintage road bike",
        price_value=300.0,
        price_currency="CAD",
        location_text="Toronto, ON",
        latitude=None,
        longitude=None,
        image_urls=["https://example.com/image.jpg"],
        listing_url="https://www.facebook.com/marketplace/item/1234567890/",
        seller_name="Seller",
        posted_at=None,
        raw={"href": "/marketplace/item/1234567890/"},
        price_bucket="250-500",
        title_keywords=["vintage", "road", "bike"],
        has_images=True,
        location_quality=0.95,
        age_hint="2 days ago",
        dedup_key="facebook_marketplace:1234567890",
    )


def _vehicle_record(external_id: str) -> FacebookNormalizedListing:
    return FacebookNormalizedListing(
        source="facebook",
        external_id=external_id,
        title="2008 Honda civic",
        price_value=2200.0,
        price_currency="CAD",
        location_text="Toronto, ON",
        latitude=None,
        longitude=None,
        image_urls=["https://example.com/image.jpg"],
        listing_url=f"https://www.facebook.com/marketplace/item/{external_id}/",
        seller_name="Seller",
        posted_at=None,
        raw={
            "href": f"/marketplace/item/{external_id}/",
            "lines": ["$2,200", "2008 Honda civic", "Toronto, ON"],
            "text": "$2,200 2008 Honda civic Toronto, ON",
        },
        price_bucket="1500-3000",
        title_keywords=["honda", "civic"],
        has_images=True,
        location_quality=0.95,
        age_hint="2 days ago",
        dedup_key=f"facebook:{external_id}",
    )


def _phone_record(external_id: str) -> FacebookNormalizedListing:
    return FacebookNormalizedListing(
        source="facebook",
        external_id=external_id,
        title="iPhone 15 Pro",
        price_value=950.0,
        price_currency="CAD",
        location_text="Toronto, ON",
        latitude=None,
        longitude=None,
        image_urls=["https://example.com/iphone.jpg"],
        listing_url=f"https://www.facebook.com/marketplace/item/{external_id}/",
        seller_name="Seller",
        posted_at=None,
        raw={
            "href": f"/marketplace/item/{external_id}/",
            "lines": ["$950", "iPhone 15 Pro", "Toronto, ON"],
            "text": "$950 iPhone 15 Pro Toronto, ON",
        },
        price_bucket="500-1000",
        title_keywords=["iphone", "15", "pro"],
        has_images=True,
        location_quality=0.95,
        age_hint="1 day ago",
        dedup_key=f"facebook:{external_id}",
    )


class _ExplodingContext:
    async def new_page(self):
        raise AssertionError("detail page should not be opened")


class _FakeDetailPage:
    def __init__(self, *, detail_text: str, goto_error: Exception | None = None) -> None:
        self.detail_text = detail_text
        self.goto_error = goto_error
        self.default_timeout: int | None = None
        self.goto_calls: list[tuple[str, dict]] = []
        self.wait_calls: list[tuple[str, dict]] = []
        self.evaluate_calls = 0
        self.closed = False

    def set_default_timeout(self, timeout: int) -> None:
        self.default_timeout = timeout

    async def goto(self, url: str, **kwargs) -> None:
        self.goto_calls.append((url, kwargs))
        if self.goto_error is not None:
            raise self.goto_error

    async def wait_for_load_state(self, state: str, **kwargs) -> None:
        self.wait_calls.append((state, kwargs))

    async def evaluate(self, script: str) -> str:
        self.evaluate_calls += 1
        return self.detail_text

    async def close(self) -> None:
        self.closed = True


class _FakeContext:
    def __init__(self, page: _FakeDetailPage) -> None:
        self.page = page
        self.new_page_calls = 0

    async def new_page(self) -> _FakeDetailPage:
        self.new_page_calls += 1
        return self.page


class _FakeSearchPage:
    def __init__(self, *, selector_error: Exception | None = None) -> None:
        self.selector_error = selector_error
        self.goto_calls: list[tuple[str, dict]] = []
        self.selector_calls: list[tuple[str, dict]] = []
        self.load_state_calls: list[tuple[str, dict]] = []

    async def goto(self, url: str, **kwargs) -> None:
        self.goto_calls.append((url, kwargs))

    async def wait_for_selector(self, selector: str, **kwargs) -> None:
        self.selector_calls.append((selector, kwargs))
        if self.selector_error is not None:
            raise self.selector_error

    async def wait_for_load_state(self, state: str, **kwargs) -> None:
        self.load_state_calls.append((state, kwargs))


def test_facebook_search_success(monkeypatch):
    monkeypatch.setattr("app.main.settings.MARKETLY_ENABLE_FACEBOOK", True)

    class FakeConnector:
        async def search(self, payload):
            return [_sample_record()]

    async def fake_upsert(records):
        return len(records)

    monkeypatch.setattr("app.main.facebook_connector", FakeConnector())
    monkeypatch.setattr("app.main.upsert_facebook_records", fake_upsert)

    response = client.post(
        "/connectors/facebook/search",
        json={
            "query": "road bike",
            "location_text": "Toronto",
            "limit": 5,
            "auth_mode": "guest",
            "ingest": True,
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["count"] == 1
    assert payload["upserted_count"] == 1
    assert payload["error"] is None
    assert payload["records"][0]["source"] == "facebook"


def test_facebook_search_typed_error(monkeypatch):
    monkeypatch.setattr("app.main.settings.MARKETLY_ENABLE_FACEBOOK", True)

    class FakeConnector:
        async def search(self, payload):
            raise FacebookConnectorError(
                FacebookConnectorErrorCode.login_wall,
                "Login wall detected",
                retryable=False,
            )

    monkeypatch.setattr("app.main.facebook_connector", FakeConnector())

    response = client.post(
        "/connectors/facebook/search",
        json={
            "query": "sofa",
            "limit": 5,
            "auth_mode": "guest",
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["count"] == 0
    assert payload["error"]["code"] == "login_wall"


def test_facebook_search_disabled_by_feature_flag(monkeypatch):
    monkeypatch.setattr("app.main.settings.MARKETLY_ENABLE_FACEBOOK", False)

    response = client.post(
        "/connectors/facebook/search",
        json={
            "query": "desk",
            "limit": 5,
            "auth_mode": "guest",
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["count"] == 0
    assert payload["error"]["code"] == "disabled"


def test_vehicle_detail_text_enrichment_adds_mileage_to_raw_record():
    record = _vehicle_record("vehicle-raw-1")

    assert _needs_vehicle_detail_enrichment(record) is True

    _apply_vehicle_detail_text(record, "2008 Honda civic\n231,000 km\nAutomatic")

    assert record.raw["detail_text"] == "2008 Honda civic 231,000 km Automatic"
    assert "231,000 km" in record.raw["lines"]


def test_vehicle_detail_enrichment_skips_multi_source_queries(monkeypatch):
    connector = FacebookMarketplaceConnector(timeout_seconds=20)
    record = _vehicle_record("vehicle-multi-1")
    events: list[tuple[str, dict]] = []

    monkeypatch.setattr(connector, "_log", lambda event, **payload: events.append((event, payload)))

    asyncio.run(
        connector._enrich_vehicle_records_from_detail_pages(
            context=_ExplodingContext(),
            records=[record],
            skip_reason="multi_source_disabled",
        )
    )

    assert "detail_text" not in record.raw
    assert events[-1][0] == "vehicle_detail_enrichment_summary"
    assert events[-1][1] == {
        "candidates": 1,
        "enriched": 0,
        "skipped": 1,
        "stop_reason": "multi_source_disabled",
    }


def test_vehicle_detail_enrichment_single_source_stops_at_budget(monkeypatch):
    connector = FacebookMarketplaceConnector(timeout_seconds=20)
    records = [_vehicle_record(f"vehicle-budget-{idx}") for idx in range(5)]
    page = _FakeDetailPage(detail_text="2008 Honda civic\n231,000 km\nAutomatic")
    context = _FakeContext(page)
    events: list[tuple[str, dict]] = []
    perf_counter_values = [0.0, 0.0, 8.1]

    monkeypatch.setattr(
        connector_module.time,
        "perf_counter",
        lambda: perf_counter_values.pop(0) if perf_counter_values else 8.1,
    )
    monkeypatch.setattr(connector, "_log", lambda event, **payload: events.append((event, payload)))

    asyncio.run(
        connector._enrich_vehicle_records_from_detail_pages(
            context=context,
            records=records,
            skip_reason=None,
        )
    )

    assert context.new_page_calls == 1
    assert len(page.goto_calls) == 1
    assert page.goto_calls[0][1]["timeout"] == connector_module.VEHICLE_DETAIL_ENRICHMENT_GOTO_TIMEOUT_MS
    assert page.wait_calls[0][1]["timeout"] == connector_module.VEHICLE_DETAIL_ENRICHMENT_NETWORK_IDLE_TIMEOUT_MS
    assert records[0].raw["detail_text"] == "2008 Honda civic 231,000 km Automatic"
    assert "detail_text" not in records[1].raw
    assert page.closed is True
    assert events[-1][0] == "vehicle_detail_enrichment_summary"
    assert events[-1][1] == {
        "candidates": 5,
        "enriched": 1,
        "skipped": 4,
        "stop_reason": "budget_exhausted",
    }


def test_vehicle_detail_enrichment_stops_after_per_record_timeout(monkeypatch):
    connector = FacebookMarketplaceConnector(timeout_seconds=20)
    records = [_vehicle_record("vehicle-timeout-1"), _vehicle_record("vehicle-timeout-2")]
    page = _FakeDetailPage(
        detail_text="",
        goto_error=connector_module.PlaywrightTimeoutError("detail page timeout"),
    )
    context = _FakeContext(page)
    events: list[tuple[str, dict]] = []

    monkeypatch.setattr(connector, "_log", lambda event, **payload: events.append((event, payload)))

    asyncio.run(
        connector._enrich_vehicle_records_from_detail_pages(
            context=context,
            records=records,
            skip_reason=None,
        )
    )

    assert len(page.goto_calls) == 1
    assert all("detail_text" not in record.raw for record in records)
    assert events[-1][0] == "vehicle_detail_enrichment_summary"
    assert events[-1][1] == {
        "candidates": 2,
        "enriched": 0,
        "skipped": 2,
        "stop_reason": "per_record_timeout",
    }


def test_vehicle_detail_enrichment_leaves_non_automotive_queries_unchanged():
    connector = FacebookMarketplaceConnector(timeout_seconds=20)
    records = [_sample_record(), _phone_record("phone-1")]

    asyncio.run(
        connector._enrich_vehicle_records_from_detail_pages(
            context=_ExplodingContext(),
            records=records,
            skip_reason=None,
        )
    )

    assert all("detail_text" not in record.raw for record in records)


def test_vehicle_detail_enrichment_skips_vehicle_queries_even_single_source(monkeypatch):
    connector = FacebookMarketplaceConnector(timeout_seconds=20)
    record = _vehicle_record("vehicle-single-1")
    events: list[tuple[str, dict]] = []

    monkeypatch.setattr(connector, "_log", lambda event, **payload: events.append((event, payload)))

    asyncio.run(
        connector._enrich_vehicle_records_from_detail_pages(
            context=_ExplodingContext(),
            records=[record],
            skip_reason="vehicle_query_disabled",
        )
    )

    assert "detail_text" not in record.raw
    assert events[-1][0] == "vehicle_detail_enrichment_summary"
    assert events[-1][1] == {
        "candidates": 1,
        "enriched": 0,
        "skipped": 1,
        "stop_reason": "vehicle_query_disabled",
    }


def test_resolve_scroll_profile_keeps_multi_source_automotive_queries_on_default_profile():
    connector = FacebookMarketplaceConnector(timeout_seconds=20, max_scrolls=30, idle_scroll_limit=4)

    multi_source_profile = connector._resolve_scroll_profile(
        multi_source=True,
        vehicle_query=True,
    )
    single_source_profile = connector._resolve_scroll_profile(
        multi_source=False,
        vehicle_query=True,
    )
    generic_single_source_profile = connector._resolve_scroll_profile(
        multi_source=False,
        vehicle_query=False,
    )

    assert multi_source_profile == (30, 4)
    assert single_source_profile == (
        connector_module.AUTOMOTIVE_SINGLE_SOURCE_MAX_SCROLLS,
        connector_module.AUTOMOTIVE_SINGLE_SOURCE_IDLE_SCROLL_LIMIT,
    )
    assert generic_single_source_profile == (40, 5)


def test_load_search_results_page_uses_commit_for_single_source_automotive_queries():
    connector = FacebookMarketplaceConnector(timeout_seconds=20)
    page = _FakeSearchPage()

    asyncio.run(
        connector._load_search_results_page(
            page=page,
            search_url="https://www.facebook.com/marketplace/search/?query=mazda+miata",
            auth_mode="cookie",
            vehicle_query=True,
            multi_source=False,
        )
    )

    assert page.goto_calls[0][1]["wait_until"] == "commit"
    assert page.selector_calls[0][0] == connector_module.ITEM_HREF_SELECTOR
    assert page.selector_calls[0][1]["timeout"] == connector_module.AUTOMOTIVE_SEARCH_RESULTS_WAIT_TIMEOUT_MS


def test_load_search_results_page_keeps_domcontentloaded_for_multi_source_automotive_queries():
    connector = FacebookMarketplaceConnector(timeout_seconds=20)
    page = _FakeSearchPage()

    asyncio.run(
        connector._load_search_results_page(
            page=page,
            search_url="https://www.facebook.com/marketplace/search/?query=mazda+miata",
            auth_mode="cookie",
            vehicle_query=True,
            multi_source=True,
        )
    )

    assert page.goto_calls[0][1]["wait_until"] == "domcontentloaded"
    assert page.selector_calls == []


def test_load_search_results_page_keeps_domcontentloaded_for_non_automotive_queries():
    connector = FacebookMarketplaceConnector(timeout_seconds=20)
    page = _FakeSearchPage()

    asyncio.run(
        connector._load_search_results_page(
            page=page,
            search_url="https://www.facebook.com/marketplace/search/?query=sofa",
            auth_mode="cookie",
            vehicle_query=False,
            multi_source=False,
        )
    )

    assert page.goto_calls[0][1]["wait_until"] == "domcontentloaded"
    assert page.selector_calls == []
