from fastapi.testclient import TestClient

from app.auth import get_current_user_id
from app.db import get_db
from app.main import app
from app.models.listing import Listing, ListingRisk, ListingValuation, Money
from app.models.saved_search import SavedSearch
from app.models.saved_search_notification import SavedSearchNotification
from app.schemas.copilot import CopilotQueryResponse

from .utils import build_test_session_factory, db_override_factory


client = TestClient(app)


def _override_auth():
    return "user-123"


def _sample_listing() -> Listing:
    return Listing(
        source="ebay",
        source_listing_id="listing-1",
        title="Road bike listing",
        price=Money(amount=450, currency="CAD"),
        url="https://example.com/listing-1",
        image_urls=["https://example.com/listing-1.jpg"],
        location="Toronto",
        snippet="Detailed seller description",
        score=6.0,
    )


def test_saved_search_and_notification_endpoints_include_alert_fields(monkeypatch):
    engine, session_factory = build_test_session_factory()
    app.dependency_overrides[get_current_user_id] = _override_auth
    app.dependency_overrides[get_db] = db_override_factory(session_factory)

    create_res = client.post(
        "/saved-searches",
        json={"query": "road bike", "sources": ["ebay"], "alerts_enabled": False},
    )
    assert create_res.status_code == 200
    payload = create_res.json()
    assert payload["alerts_enabled"] is False
    assert payload["last_alert_checked_at"] is None

    db = session_factory()
    try:
        db.add(
            SavedSearchNotification(
                user_id="user-123",
                saved_search_id=payload["id"],
                saved_search_query="road bike",
                summary_text="1 new match for road bike",
                items_json=[
                    {
                        "listing_key": "ebay:listing-1",
                        "source": "ebay",
                        "source_listing_id": "listing-1",
                        "title": "Road bike listing",
                        "url": "https://example.com/listing-1",
                        "price": {"amount": 450, "currency": "CAD"},
                        "location": "Toronto",
                        "match_confidence": 0.91,
                        "why_matched": ["Strong keyword match to the saved search."],
                        "valuation": None,
                        "risk": None,
                    }
                ],
            )
        )
        db.commit()
    finally:
        db.close()

    notifications_res = client.get("/me/notifications")
    assert notifications_res.status_code == 200
    notifications = notifications_res.json()
    assert len(notifications) == 1
    assert notifications[0]["summary"] == "1 new match for road bike"

    read_res = client.post(f"/me/notifications/{notifications[0]['id']}/read")
    assert read_res.status_code == 200
    assert read_res.json()["read_at"] is not None

    app.dependency_overrides.clear()
    engine.dispose()


def test_search_and_saved_search_run_include_insight_fields(monkeypatch):
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

    async def fake_unified_search(**kwargs):
        return [_sample_listing()], 1, None, {}

    def fake_enrich_results(db, *, query, results):
        results[0].valuation = ListingValuation(
            verdict="underpriced",
            estimated_low=500,
            estimated_high=620,
            median_price=560,
            currency="CAD",
            confidence=0.83,
            sample_count=7,
            explanation="Price is below the recent market band.",
        )
        results[0].risk = ListingRisk(
            level="medium",
            score=0.42,
            reasons=["Price is materially below recent market comps."],
            explanation="Price is materially below recent market comps.",
        )
        return results

    monkeypatch.setattr("app.main.unified_search", fake_unified_search)
    monkeypatch.setattr("app.main._enrich_results", fake_enrich_results)
    monkeypatch.setattr("app.main.persist_listing_snapshots", lambda **kwargs: 1)

    search_res = client.get("/search", params={"q": "road bike", "sources": "ebay"})
    saved_search_res = client.get(f"/saved-searches/{saved_search_id}/run")

    assert search_res.status_code == 200
    assert saved_search_res.status_code == 200
    assert search_res.json()["results"][0]["valuation"]["verdict"] == "underpriced"
    assert search_res.json()["results"][0]["risk"]["level"] == "medium"
    assert saved_search_res.json()["results"][0]["valuation"]["sample_count"] == 7
    assert saved_search_res.json()["results"][0]["risk"]["reasons"][0] == "Price is materially below recent market comps."

    app.dependency_overrides.clear()
    engine.dispose()


def test_copilot_query_returns_graceful_payload(monkeypatch):
    captured: dict[str, object] = {}

    async def fake_generate_copilot_response(**kwargs):
        captured.update(kwargs)
        return CopilotQueryResponse(
            available=True,
            answer="The best value looks like the road bike listing.",
            shortlist=[
                {
                    "listing_key": "ebay:listing-1",
                    "title": "Road bike listing",
                    "reason": "It is below the estimated market range.",
                }
            ],
            seller_questions=["Has the bike been serviced recently?"],
            red_flags=["Ask why the price is below nearby comps."],
            error_message=None,
        )

    monkeypatch.setattr("app.main.generate_copilot_response", fake_generate_copilot_response)

    response = client.post(
        "/copilot/query",
        json={
            "query": "road bike",
            "user_question": "Which is the best value?",
            "listings": [
                {
                    "listing_key": "ebay:listing-1",
                    "source": "ebay",
                    "source_listing_id": "listing-1",
                    "title": "Road bike listing",
                    "price": {"amount": 450, "currency": "CAD"},
                    "url": "https://example.com/listing-1",
                    "condition": "used",
                    "location": "Toronto",
                    "snippet": "Detailed seller description",
                    "score": 6.0,
                    "score_reason": "Strong keyword match.",
                    "valuation": {
                        "verdict": "underpriced",
                        "estimated_low": 500,
                        "estimated_high": 620,
                        "median_price": 560,
                        "currency": "CAD",
                        "confidence": 0.83,
                        "sample_count": 7,
                        "explanation": "Price is below the recent market band.",
                    },
                    "risk": {
                        "level": "medium",
                        "score": 0.42,
                        "reasons": ["Price is materially below recent market comps."],
                        "explanation": "Price is materially below recent market comps.",
                    },
                }
            ],
            "conversation": [
                {
                    "role": "user",
                    "content": "Which bike looks best so far?",
                }
            ],
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["available"] is True
    assert payload["shortlist"][0]["listing_key"] == "ebay:listing-1"
    assert captured["conversation"] == [{"role": "user", "content": "Which bike looks best so far?"}]
