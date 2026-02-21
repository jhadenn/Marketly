from fastapi.testclient import TestClient

from app.connectors.facebook_marketplace import (
    FacebookConnectorError,
    FacebookConnectorErrorCode,
    FacebookNormalizedListing,
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
    assert payload["records"][0]["source"] == "facebook_marketplace"


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
