from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

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


def _as_utc(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def _sqlite_dt_str(value: datetime) -> str:
    return str(value.astimezone(timezone.utc).replace(tzinfo=None) if value.tzinfo is not None else value)


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
    assert payload["last_alert_attempted_at"] is None
    assert payload["last_alert_checked_at"] is None
    assert payload["last_alert_notified_at"] is None
    assert payload["last_alert_error_code"] is None
    assert payload["last_alert_error_message"] is None
    assert payload["next_alert_check_due_at"] is None

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
    assert notifications[0]["summary"] == "1 new listing for road bike"
    assert notifications[0]["new_count"] == 1

    read_res = client.post(f"/me/notifications/{notifications[0]['id']}/read")
    assert read_res.status_code == 200
    assert read_res.json()["read_at"] is not None
    assert read_res.json()["new_count"] == 1

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


def test_copilot_query_allows_missing_query_and_empty_listings(monkeypatch):
    captured: dict[str, object] = {}

    async def fake_generate_copilot_response(**kwargs):
        captured.update(kwargs)
        return CopilotQueryResponse(
            available=True,
            answer="The Acura RSX is a sporty compact coupe with good aftermarket support.",
            shortlist=[],
            seller_questions=[],
            red_flags=[],
            error_message=None,
        )

    monkeypatch.setattr("app.main.generate_copilot_response", fake_generate_copilot_response)

    response = client.post(
        "/copilot/query",
        json={
            "user_question": "What can you tell me about the Acura RSX?",
            "listings": [],
            "conversation": [],
        },
    )

    assert response.status_code == 200
    assert response.json()["available"] is True
    assert captured["query"] is None
    assert captured["listings"] == []


def test_notifications_endpoint_refreshes_alerts_before_listing(monkeypatch):
    engine, session_factory = build_test_session_factory()
    app.dependency_overrides[get_current_user_id] = _override_auth
    app.dependency_overrides[get_db] = db_override_factory(session_factory)

    called: dict[str, object] = {}

    async def fake_refresh_saved_search_alerts_for_user(db, *, user_id):
        called["user_id"] = user_id
        return True

    monkeypatch.setattr("app.main.refresh_saved_search_alerts_for_user", fake_refresh_saved_search_alerts_for_user)

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
        db.add(
            SavedSearchNotification(
                user_id="user-123",
                saved_search_id=saved_search.id,
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
    assert called == {"user_id": "user-123"}
    assert len(notifications_res.json()) == 1
    assert notifications_res.json()[0]["summary"] == "1 new listing for road bike"
    assert notifications_res.json()[0]["new_count"] == 1

    app.dependency_overrides.clear()
    engine.dispose()


def test_create_saved_search_runs_initial_baseline_and_returns_due_time(monkeypatch):
    engine, session_factory = build_test_session_factory()
    app.dependency_overrides[get_current_user_id] = _override_auth
    app.dependency_overrides[get_db] = db_override_factory(session_factory)

    baseline_time = datetime(2026, 3, 25, 15, 10, tzinfo=timezone.utc)

    async def fake_execute_saved_search_alert_check(db, *, saved_search_id, limit_per_search):
        row = db.query(SavedSearch).filter(SavedSearch.id == saved_search_id).first()
        assert row is not None
        row.last_alert_attempted_at = baseline_time
        row.last_alert_checked_at = baseline_time
        row.last_alert_error_code = None
        row.last_alert_error_message = None
        db.commit()
        return SimpleNamespace(error_code=None, error_message=None, notification_created=False)

    monkeypatch.setattr("app.main.execute_saved_search_alert_check", fake_execute_saved_search_alert_check)

    response = client.post(
        "/saved-searches",
        json={"query": "iphone 14 pro", "sources": ["ebay"], "alerts_enabled": True},
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["alerts_enabled"] is True
    assert payload["last_alert_attempted_at"] == _sqlite_dt_str(baseline_time)
    assert payload["last_alert_checked_at"] == _sqlite_dt_str(baseline_time)
    assert payload["last_alert_error_code"] is None
    assert payload["last_alert_error_message"] is None
    assert payload["next_alert_check_due_at"] == str(baseline_time + timedelta(hours=8))

    app.dependency_overrides.clear()
    engine.dispose()


def test_create_saved_search_persists_baseline_failure_metadata(monkeypatch):
    engine, session_factory = build_test_session_factory()
    app.dependency_overrides[get_current_user_id] = _override_auth
    app.dependency_overrides[get_db] = db_override_factory(session_factory)

    failure_time = datetime(2026, 3, 25, 15, 10, tzinfo=timezone.utc)

    async def fake_execute_saved_search_alert_check(db, *, saved_search_id, limit_per_search):
        row = db.query(SavedSearch).filter(SavedSearch.id == saved_search_id).first()
        assert row is not None
        row.last_alert_attempted_at = failure_time
        row.last_alert_checked_at = None
        row.last_alert_error_code = "LOGIN_REQUIRED"
        row.last_alert_error_message = "Facebook: Cookies expired."
        db.commit()
        return SimpleNamespace(
            error_code="LOGIN_REQUIRED",
            error_message="Facebook: Cookies expired.",
            notification_created=False,
        )

    monkeypatch.setattr("app.main.execute_saved_search_alert_check", fake_execute_saved_search_alert_check)

    response = client.post(
        "/saved-searches",
        json={"query": "mazda miata", "sources": ["facebook"], "alerts_enabled": True},
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["last_alert_attempted_at"] == _sqlite_dt_str(failure_time)
    assert payload["last_alert_checked_at"] is None
    assert payload["last_alert_error_code"] == "LOGIN_REQUIRED"
    assert payload["last_alert_error_message"] == "Facebook: Cookies expired."
    assert payload["next_alert_check_due_at"] is None

    app.dependency_overrides.clear()
    engine.dispose()


def test_notifications_endpoint_returns_existing_rows_when_refresh_session_is_poisoned(monkeypatch):
    engine, session_factory = build_test_session_factory()
    app.dependency_overrides[get_current_user_id] = _override_auth
    app.dependency_overrides[get_db] = db_override_factory(session_factory)

    async def fake_refresh_saved_search_alerts_for_user(db, *, user_id):
        db.add(
            SavedSearchNotification(
                user_id=None,
                saved_search_id=999,
                saved_search_query="broken",
                summary_text="broken",
                items_json=[],
            )
        )
        try:
            db.commit()
        except Exception:
            return False
        return True

    monkeypatch.setattr("app.main.refresh_saved_search_alerts_for_user", fake_refresh_saved_search_alerts_for_user)

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
        db.add(
            SavedSearchNotification(
                user_id="user-123",
                saved_search_id=saved_search.id,
                saved_search_query="road bike",
                summary_text="legacy summary",
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
    payload = notifications_res.json()
    assert len(payload) == 1
    assert payload[0]["saved_search_query"] == "road bike"
    assert payload[0]["summary"] == "1 new listing for road bike"
    assert payload[0]["new_count"] == 1

    app.dependency_overrides.clear()
    engine.dispose()


def test_update_saved_search_resets_alert_baseline_when_query_changes(monkeypatch):
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
            last_alert_attempted_at=datetime.now(timezone.utc) - timedelta(days=1),
            last_alert_checked_at=datetime.now(timezone.utc) - timedelta(days=1),
            last_alert_notified_at=datetime.now(timezone.utc) - timedelta(hours=8),
        )
        db.add(saved_search)
        db.commit()
        db.refresh(saved_search)
        saved_search_id = saved_search.id
        db.add(
            SavedSearchNotification(
                user_id="user-123",
                saved_search_id=saved_search_id,
                saved_search_query="road bike",
                summary_text="1 new listing for road bike",
                items_json=[],
            )
        )
        db.commit()
    finally:
        db.close()

    rerun_time = datetime(2026, 3, 25, 18, 0, tzinfo=timezone.utc)

    async def fake_execute_saved_search_alert_check(db, *, saved_search_id, limit_per_search):
        row = db.query(SavedSearch).filter(SavedSearch.id == saved_search_id).first()
        assert row is not None
        row.last_alert_attempted_at = rerun_time
        row.last_alert_checked_at = rerun_time
        row.last_alert_notified_at = None
        row.last_alert_error_code = None
        row.last_alert_error_message = None
        db.commit()
        return SimpleNamespace(error_code=None, error_message=None, notification_created=False)

    monkeypatch.setattr("app.main.execute_saved_search_alert_check", fake_execute_saved_search_alert_check)

    response = client.patch(
        f"/saved-searches/{saved_search_id}",
        json={"query": "acura rsx", "sources": ["ebay"], "alerts_enabled": True},
    )

    assert response.status_code == 200

    db = session_factory()
    try:
        updated = db.query(SavedSearch).filter(SavedSearch.id == saved_search_id).first()
        notifications = (
            db.query(SavedSearchNotification)
            .filter(SavedSearchNotification.saved_search_id == saved_search_id)
            .all()
        )
        assert updated is not None
        assert _as_utc(updated.last_alert_attempted_at) == rerun_time
        assert _as_utc(updated.last_alert_checked_at) == rerun_time
        assert updated.last_alert_notified_at is None
        assert updated.last_alert_error_code is None
        assert updated.last_alert_error_message is None
        assert notifications == []
    finally:
        db.close()

    app.dependency_overrides.clear()
    engine.dispose()


def test_update_saved_search_resets_alert_baseline_when_reenabled(monkeypatch):
    engine, session_factory = build_test_session_factory()
    app.dependency_overrides[get_current_user_id] = _override_auth
    app.dependency_overrides[get_db] = db_override_factory(session_factory)

    db = session_factory()
    try:
        saved_search = SavedSearch(
            user_id="user-123",
            query="acura rsx",
            sources="ebay",
            alerts_enabled=False,
            last_alert_attempted_at=datetime.now(timezone.utc) - timedelta(days=3),
            last_alert_checked_at=datetime.now(timezone.utc) - timedelta(days=3),
            last_alert_notified_at=datetime.now(timezone.utc) - timedelta(days=2),
        )
        db.add(saved_search)
        db.commit()
        db.refresh(saved_search)
        saved_search_id = saved_search.id
    finally:
        db.close()

    rerun_time = datetime(2026, 3, 25, 19, 0, tzinfo=timezone.utc)

    async def fake_execute_saved_search_alert_check(db, *, saved_search_id, limit_per_search):
        row = db.query(SavedSearch).filter(SavedSearch.id == saved_search_id).first()
        assert row is not None
        row.last_alert_attempted_at = rerun_time
        row.last_alert_checked_at = rerun_time
        row.last_alert_notified_at = None
        row.last_alert_error_code = None
        row.last_alert_error_message = None
        db.commit()
        return SimpleNamespace(error_code=None, error_message=None, notification_created=False)

    monkeypatch.setattr("app.main.execute_saved_search_alert_check", fake_execute_saved_search_alert_check)

    response = client.patch(
        f"/saved-searches/{saved_search_id}",
        json={"query": "acura rsx", "sources": ["ebay"], "alerts_enabled": True},
    )

    assert response.status_code == 200

    db = session_factory()
    try:
        updated = db.query(SavedSearch).filter(SavedSearch.id == saved_search_id).first()
        assert updated is not None
        assert updated.alerts_enabled is True
        assert _as_utc(updated.last_alert_attempted_at) == rerun_time
        assert _as_utc(updated.last_alert_checked_at) == rerun_time
        assert updated.last_alert_notified_at is None
        assert updated.last_alert_error_code is None
        assert updated.last_alert_error_message is None
    finally:
        db.close()

    app.dependency_overrides.clear()
    engine.dispose()


def test_refresh_saved_search_alert_endpoint_retries_incomplete_baseline(monkeypatch):
    engine, session_factory = build_test_session_factory()
    app.dependency_overrides[get_current_user_id] = _override_auth
    app.dependency_overrides[get_db] = db_override_factory(session_factory)

    db = session_factory()
    try:
        saved_search = SavedSearch(
            user_id="user-123",
            query="transformers jazz",
            sources="ebay",
            alerts_enabled=True,
            last_alert_checked_at=None,
            last_alert_attempted_at=None,
            last_alert_error_code=None,
            last_alert_error_message=None,
        )
        db.add(saved_search)
        db.commit()
        db.refresh(saved_search)
        saved_search_id = saved_search.id
    finally:
        db.close()

    rerun_time = datetime(2026, 3, 26, 4, 55, tzinfo=timezone.utc)

    async def fake_execute_saved_search_alert_check(db, *, saved_search_id, limit_per_search):
        row = db.query(SavedSearch).filter(SavedSearch.id == saved_search_id).first()
        assert row is not None
        row.last_alert_attempted_at = rerun_time
        row.last_alert_checked_at = rerun_time
        row.last_alert_error_code = None
        row.last_alert_error_message = None
        db.commit()
        return SimpleNamespace(error_code=None, error_message=None, notification_created=False)

    monkeypatch.setattr("app.main.execute_saved_search_alert_check", fake_execute_saved_search_alert_check)

    response = client.post(f"/saved-searches/{saved_search_id}/alerts/refresh")

    assert response.status_code == 200
    payload = response.json()
    assert payload["id"] == saved_search_id
    assert payload["last_alert_attempted_at"] == _sqlite_dt_str(rerun_time)
    assert payload["last_alert_checked_at"] == _sqlite_dt_str(rerun_time)
    assert payload["last_alert_error_code"] is None
    assert payload["last_alert_error_message"] is None

    app.dependency_overrides.clear()
    engine.dispose()


def test_delete_saved_search_removes_notifications():
    engine, session_factory = build_test_session_factory()
    app.dependency_overrides[get_current_user_id] = _override_auth
    app.dependency_overrides[get_db] = db_override_factory(session_factory)

    db = session_factory()
    try:
        saved_search = SavedSearch(
            user_id="user-123",
            query="acura rsx",
            sources="ebay",
            alerts_enabled=True,
        )
        db.add(saved_search)
        db.commit()
        db.refresh(saved_search)
        saved_search_id = saved_search.id
        db.add(
            SavedSearchNotification(
                user_id="user-123",
                saved_search_id=saved_search_id,
                saved_search_query="acura rsx",
                summary_text="1 new listing for acura rsx",
                items_json=[],
            )
        )
        db.commit()
    finally:
        db.close()

    response = client.delete(f"/saved-searches/{saved_search_id}")

    assert response.status_code == 200

    notifications_res = client.get("/me/notifications")
    assert notifications_res.status_code == 200
    assert notifications_res.json() == []

    db = session_factory()
    try:
        notifications = db.query(SavedSearchNotification).all()
        assert notifications == []
    finally:
        db.close()

    app.dependency_overrides.clear()
    engine.dispose()


def test_notifications_endpoint_prunes_orphaned_and_renamed_rows(monkeypatch):
    engine, session_factory = build_test_session_factory()
    app.dependency_overrides[get_current_user_id] = _override_auth
    app.dependency_overrides[get_db] = db_override_factory(session_factory)

    async def fake_refresh_saved_search_alerts_for_user(db, *, user_id):
        return False

    monkeypatch.setattr(
        "app.main.refresh_saved_search_alerts_for_user",
        fake_refresh_saved_search_alerts_for_user,
    )

    db = session_factory()
    try:
        saved_search = SavedSearch(
            user_id="user-123",
            query="mazda miata",
            sources="ebay",
            alerts_enabled=True,
        )
        db.add(saved_search)
        db.commit()
        db.refresh(saved_search)

        db.add_all(
            [
                SavedSearchNotification(
                    user_id="user-123",
                    saved_search_id=saved_search.id,
                    saved_search_query="mazda miata",
                    summary_text="valid",
                    items_json=[],
                ),
                SavedSearchNotification(
                    user_id="user-123",
                    saved_search_id=saved_search.id,
                    saved_search_query="acura rsx",
                    summary_text="renamed",
                    items_json=[],
                ),
                SavedSearchNotification(
                    user_id="user-123",
                    saved_search_id=9999,
                    saved_search_query="ghost",
                    summary_text="orphaned",
                    items_json=[],
                ),
            ]
        )
        db.commit()
    finally:
        db.close()

    notifications_res = client.get("/me/notifications")

    assert notifications_res.status_code == 200
    payload = notifications_res.json()
    assert len(payload) == 1
    assert payload[0]["saved_search_query"] == "mazda miata"

    db = session_factory()
    try:
        remaining = (
            db.query(SavedSearchNotification)
            .filter(SavedSearchNotification.user_id == "user-123")
            .all()
        )
        assert len(remaining) == 1
        assert remaining[0].saved_search_query == "mazda miata"
    finally:
        db.close()

    app.dependency_overrides.clear()
    engine.dispose()


def test_saved_search_run_passes_newest_sort(monkeypatch):
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

    captured: dict[str, object] = {}

    async def fake_unified_search(query, sources, limit=20, offset=0, sort="relevance", **kwargs):
        captured["sort"] = sort
        return ([_sample_listing()], 1, None, {})

    monkeypatch.setattr("app.main.unified_search", fake_unified_search)
    monkeypatch.setattr("app.main._enrich_results", lambda db, *, query, results: results)
    monkeypatch.setattr("app.main.persist_listing_snapshots", lambda **kwargs: 1)

    response = client.get(f"/saved-searches/{saved_search_id}/run", params={"sort": "newest"})

    assert response.status_code == 200
    assert captured["sort"] == "newest"

    app.dependency_overrides.clear()
    engine.dispose()
