import asyncio
from datetime import datetime, timedelta, timezone
import uuid

from app.core.config import settings
from app.models.listing import Listing, ListingRisk, ListingValuation, Money, SourceError
from app.models.listing_snapshot import ListingSnapshot
from app.models.saved_search import SavedSearch
from app.models.saved_search_notification import SavedSearchNotification
from app.models.user_location_preference import UserLocationPreference
from app.services.alerts import (
    execute_saved_search_alert_check,
    refresh_saved_search_alerts_for_user,
    run_saved_search_alert_check,
    run_saved_search_alert_job,
)
from app.services.location import get_user_location_preference
from app.services.listing_insights import listing_fingerprint

from .utils import build_test_session_factory


def _as_utc(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def _build_listing(
    *,
    source_listing_id: str,
    title: str,
    price_amount: float,
    snippet: str,
    score: float = 8.0,
) -> Listing:
    return Listing(
        source="ebay",
        source_listing_id=source_listing_id,
        title=title,
        price=Money(amount=price_amount, currency="CAD"),
        url=f"https://example.com/{source_listing_id}",
        image_urls=[f"https://example.com/{source_listing_id}.jpg"],
        location="Toronto",
        snippet=snippet,
        score=score,
        valuation=ListingValuation(
            verdict="underpriced",
            estimated_low=520,
            estimated_high=620,
            median_price=560,
            currency="CAD",
            confidence=0.86,
            sample_count=9,
            explanation="Price is below the recent market band.",
        ),
        risk=ListingRisk(level="low", score=0.12, reasons=["No major risk signals were detected."]),
    )


def test_run_saved_search_alert_job_creates_digest_for_new_high_confidence_listing(monkeypatch):
    engine, session_factory = build_test_session_factory()
    db = session_factory()

    saved_search = SavedSearch(
        user_id="user-123",
        query="road bike",
        sources="ebay",
        alerts_enabled=True,
        last_alert_checked_at=datetime.now(timezone.utc) - timedelta(days=1),
    )
    db.add(saved_search)
    db.commit()
    db.refresh(saved_search)

    seen_listing = _build_listing(
        source_listing_id="old-1",
        title="Road bike old listing",
        price_amount=500,
        snippet="Old result",
        score=7.0,
    )
    seen_listing.valuation = ListingValuation(
        verdict="fair",
        estimated_low=480,
        estimated_high=560,
        median_price=520,
        currency="CAD",
        confidence=0.8,
        sample_count=8,
        explanation="Price is in the recent market band.",
    )
    seen_listing.risk = ListingRisk(level="low", score=0.1, reasons=["No major risk signals were detected."])
    new_listing = _build_listing(
        source_listing_id="new-1",
        title="Road bike fresh listing",
        price_amount=430,
        snippet="Clean frame and detailed listing.",
    )

    db.add(
        ListingSnapshot(
            user_id="user-123",
            saved_search_id=saved_search.id,
            source=seen_listing.source,
            source_listing_id=seen_listing.source_listing_id,
            listing_fingerprint=listing_fingerprint(seen_listing),
            query=saved_search.query,
            title=seen_listing.title,
            price_amount=seen_listing.price.amount if seen_listing.price else None,
            price_currency="CAD",
            location=seen_listing.location,
            condition=None,
            snippet=seen_listing.snippet,
            image_count=1,
            url=seen_listing.url,
            valuation_key="road|bike",
            observed_at=datetime.now(timezone.utc) - timedelta(days=2),
        )
    )
    db.commit()

    captured: dict[str, object] = {}

    async def fake_unified_search(**kwargs):
        captured.update(kwargs)
        return [seen_listing, new_listing], None, None, {}

    monkeypatch.setattr("app.services.alerts.unified_search", fake_unified_search)
    monkeypatch.setattr("app.services.alerts.enrich_listings_with_insights", lambda db, query, results: results)
    monkeypatch.setattr("app.services.alerts.persist_listing_snapshots", lambda **kwargs: len(kwargs["listings"]))

    result = asyncio.run(
        run_saved_search_alert_job(
            db,
            limit_per_search=20,
            user_id="user-123",
        )
    )

    notifications = db.query(SavedSearchNotification).all()
    db.refresh(saved_search)

    assert result["checked"] == 1
    assert result["notifications_created"] == 1
    assert len(notifications) == 1
    assert notifications[0].saved_search_id == saved_search.id
    assert notifications[0].summary_text == "1 new listing for road bike"
    assert notifications[0].items_json[0]["source_listing_id"] == "new-1"
    assert captured["sort"] == "newest"
    assert saved_search.last_alert_notified_at is not None
    assert saved_search.last_alert_checked_at is not None

    db.close()
    engine.dispose()


def test_run_saved_search_alert_job_baselines_first_check_without_creating_digest(monkeypatch):
    engine, session_factory = build_test_session_factory()
    db = session_factory()

    saved_search = SavedSearch(
        user_id="user-baseline",
        query="acura rsx",
        sources="ebay",
        alerts_enabled=True,
        last_alert_checked_at=None,
    )
    db.add(saved_search)
    db.commit()
    db.refresh(saved_search)

    fresh_listing = _build_listing(
        source_listing_id="rsx-1",
        title="2005 Acura RSX Type S",
        price_amount=9500,
        snippet="Clean title and recent service records.",
    )

    async def fake_unified_search(**kwargs):
        return [fresh_listing], None, None, {}

    monkeypatch.setattr("app.services.alerts.unified_search", fake_unified_search)
    monkeypatch.setattr("app.services.alerts.enrich_listings_with_insights", lambda db, query, results: results)
    monkeypatch.setattr("app.services.alerts.persist_listing_snapshots", lambda **kwargs: len(kwargs["listings"]))

    result = asyncio.run(
        run_saved_search_alert_job(
            db,
            limit_per_search=20,
            user_id="user-baseline",
        )
    )

    notifications = db.query(SavedSearchNotification).all()
    db.refresh(saved_search)

    assert result["checked"] == 1
    assert result["notifications_created"] == 0
    assert notifications == []
    assert saved_search.last_alert_attempted_at is not None
    assert saved_search.last_alert_checked_at is not None
    assert saved_search.last_alert_error_code is None
    assert saved_search.last_alert_error_message is None
    assert saved_search.last_alert_notified_at is None

    db.close()
    engine.dispose()


def test_run_saved_search_alert_job_skips_incomplete_source_results(monkeypatch):
    engine, session_factory = build_test_session_factory()
    db = session_factory()

    saved_search = SavedSearch(
        user_id="user-source-error",
        query="mazda miata",
        sources="facebook,kijiji",
        alerts_enabled=True,
        last_alert_checked_at=None,
    )
    db.add(saved_search)
    db.commit()
    db.refresh(saved_search)

    fresh_listing = _build_listing(
        source_listing_id="miata-1",
        title="Mazda Miata local listing",
        price_amount=7800,
        snippet="Fresh local result.",
    )
    persist_calls = 0

    async def fake_unified_search(**kwargs):
        return [fresh_listing], None, None, {
            "facebook": SourceError(
                code="LOGIN_REQUIRED",
                message="Facebook session expired.",
                retryable=False,
            )
        }

    def fake_persist_listing_snapshots(**kwargs):
        nonlocal persist_calls
        persist_calls += 1
        return len(kwargs["listings"])

    monkeypatch.setattr("app.services.alerts.unified_search", fake_unified_search)
    monkeypatch.setattr("app.services.alerts.enrich_listings_with_insights", lambda db, query, results: results)
    monkeypatch.setattr("app.services.alerts.persist_listing_snapshots", fake_persist_listing_snapshots)

    result = asyncio.run(
        run_saved_search_alert_job(
            db,
            limit_per_search=20,
            user_id="user-source-error",
        )
    )

    notifications = db.query(SavedSearchNotification).all()
    db.refresh(saved_search)

    assert result["checked"] == 1
    assert result["notifications_created"] == 0
    assert notifications == []
    assert persist_calls == 0
    assert saved_search.last_alert_attempted_at is not None
    assert saved_search.last_alert_checked_at is None
    assert saved_search.last_alert_error_code == "LOGIN_REQUIRED"
    assert saved_search.last_alert_error_message == "Facebook: Facebook session expired."
    assert saved_search.last_alert_notified_at is None

    db.close()
    engine.dispose()


def test_refresh_saved_search_alerts_for_user_runs_only_when_stale(monkeypatch):
    engine, session_factory = build_test_session_factory()
    db = session_factory()

    saved_search = SavedSearch(
        user_id="user-refresh",
        query="acura rsx",
        sources="ebay",
        alerts_enabled=True,
        last_alert_checked_at=datetime.now(timezone.utc) - timedelta(hours=9),
    )
    db.add(saved_search)
    db.commit()
    db.refresh(saved_search)

    calls: list[tuple[int, str | None]] = []

    async def fake_run_saved_search_alert_job(db, *, limit_per_search, user_id=None, saved_search_id=None):
        calls.append((limit_per_search, user_id))
        saved_search.last_alert_checked_at = datetime.now(timezone.utc)
        db.commit()
        return {"checked": 1, "notifications_created": 0}

    monkeypatch.setattr(settings, "MARKETLY_ALERTS_STALE_AFTER_SECONDS", 28800)
    monkeypatch.setattr(settings, "MARKETLY_ALERTS_AUTO_REFRESH_WINDOW_SECONDS", 0)
    monkeypatch.setattr(settings, "MARKETLY_ALERTS_SEARCH_LIMIT", 12)
    monkeypatch.setattr("app.services.alerts.run_saved_search_alert_job", fake_run_saved_search_alert_job)

    refreshed = asyncio.run(refresh_saved_search_alerts_for_user(db, user_id="user-refresh"))
    db.refresh(saved_search)
    refreshed_again = asyncio.run(refresh_saved_search_alerts_for_user(db, user_id="user-refresh"))

    assert refreshed is True
    assert refreshed_again is False
    assert calls == [(12, "user-refresh")]

    db.close()
    engine.dispose()


def test_refresh_saved_search_alerts_for_user_bypasses_refresh_window_for_pending_baseline(monkeypatch):
    engine, session_factory = build_test_session_factory()
    db = session_factory()

    saved_search = SavedSearch(
        user_id="user-pending-refresh",
        query="transformers jazz",
        sources="ebay",
        alerts_enabled=True,
        last_alert_checked_at=None,
    )
    db.add(saved_search)
    db.commit()
    db.refresh(saved_search)

    calls: list[tuple[int, str | None]] = []

    async def fake_run_saved_search_alert_job(db, *, limit_per_search, user_id=None, saved_search_id=None):
        calls.append((limit_per_search, user_id))
        saved_search.last_alert_checked_at = datetime.now(timezone.utc)
        db.commit()
        return {"checked": 1, "notifications_created": 0}

    monkeypatch.setattr(settings, "MARKETLY_ALERTS_STALE_AFTER_SECONDS", 28800)
    monkeypatch.setattr(settings, "MARKETLY_ALERTS_AUTO_REFRESH_WINDOW_SECONDS", 300)
    monkeypatch.setattr(settings, "MARKETLY_ALERTS_SEARCH_LIMIT", 12)
    monkeypatch.setattr("app.services.alerts.run_saved_search_alert_job", fake_run_saved_search_alert_job)
    from app.services.alerts import _alerts_refresh_limiter

    _alerts_refresh_limiter.set("saved-search-alert-refresh:user-pending-refresh", True, ttl_seconds=300)

    refreshed = asyncio.run(refresh_saved_search_alerts_for_user(db, user_id="user-pending-refresh"))

    assert refreshed is True
    assert calls == [(12, "user-pending-refresh")]

    db.close()
    engine.dispose()


def test_run_saved_search_alert_job_rolls_back_failed_search_and_continues(monkeypatch):
    engine, session_factory = build_test_session_factory()
    db = session_factory()
    now = datetime.now(timezone.utc)

    failing_search = SavedSearch(
        user_id="user-continue",
        query="failing search",
        sources="ebay",
        alerts_enabled=True,
        last_alert_checked_at=now - timedelta(days=1),
        created_at=now,
    )
    succeeding_search = SavedSearch(
        user_id="user-continue",
        query="working search",
        sources="ebay",
        alerts_enabled=True,
        last_alert_checked_at=now - timedelta(days=1),
        created_at=now - timedelta(seconds=1),
    )
    db.add_all([failing_search, succeeding_search])
    db.commit()
    db.refresh(failing_search)
    db.refresh(succeeding_search)

    async def fake_unified_search(**kwargs):
        query = kwargs["query"]
        if query == "failing search":
            return [_build_listing(source_listing_id="fail-1", title="Fail listing", price_amount=410, snippet="Broken path.")], None, None, {}
        return [_build_listing(source_listing_id="work-1", title="Working listing", price_amount=390, snippet="Good path.")], None, None, {}

    def fake_previously_seen_fingerprints(db, *, saved_search_id, listing_fingerprints, seen_before):
        if saved_search_id == failing_search.id:
            db.add(
                SavedSearchNotification(
                    user_id=None,
                    saved_search_id=saved_search_id,
                    saved_search_query="broken",
                    summary_text="broken",
                    items_json=[],
                )
            )
            db.commit()
        return set()

    monkeypatch.setattr("app.services.alerts.unified_search", fake_unified_search)
    monkeypatch.setattr("app.services.alerts.enrich_listings_with_insights", lambda db, query, results: results)
    monkeypatch.setattr("app.services.alerts.persist_listing_snapshots", lambda **kwargs: len(kwargs["listings"]))
    monkeypatch.setattr(
        "app.services.alerts.previously_seen_fingerprints",
        fake_previously_seen_fingerprints,
    )

    result = asyncio.run(
        run_saved_search_alert_job(
            db,
            limit_per_search=20,
            user_id="user-continue",
        )
    )

    notifications = (
        db.query(SavedSearchNotification)
        .filter(SavedSearchNotification.user_id == "user-continue")
        .order_by(SavedSearchNotification.created_at.asc())
        .all()
    )
    db.refresh(failing_search)
    db.refresh(succeeding_search)

    assert result["checked"] == 2
    assert result["notifications_created"] == 1
    assert len(notifications) == 1
    assert notifications[0].saved_search_id == succeeding_search.id
    assert notifications[0].summary_text == "1 new listing for working search"
    assert failing_search.last_alert_notified_at is None
    assert succeeding_search.last_alert_notified_at is not None

    db.close()
    engine.dispose()


def test_run_saved_search_alert_job_uses_stored_user_location(monkeypatch):
    engine, session_factory = build_test_session_factory()
    db = session_factory()

    saved_search = SavedSearch(
        user_id="user-location",
        query="road bike",
        sources="kijiji,facebook",
        alerts_enabled=True,
        last_alert_checked_at=datetime.now(timezone.utc) - timedelta(days=1),
    )
    db.add(saved_search)
    db.add(
        UserLocationPreference(
            user_id="user-location",
            display_name="Toronto, ON",
            city="Toronto",
            province_code="ON",
            province_name="Ontario",
            country_code="CA",
            latitude=43.6532,
            longitude=-79.3832,
            mode="manual",
        )
    )
    db.commit()

    captured: dict[str, object] = {}

    async def fake_unified_search(**kwargs):
        captured.update(kwargs)
        return [], 0, None, {}

    monkeypatch.setattr("app.services.alerts.unified_search", fake_unified_search)
    monkeypatch.setattr("app.services.alerts.enrich_listings_with_insights", lambda db, query, results: results)
    monkeypatch.setattr("app.services.alerts.persist_listing_snapshots", lambda **kwargs: 0)

    result = asyncio.run(
        run_saved_search_alert_job(
            db,
            limit_per_search=20,
            user_id="user-location",
        )
    )

    assert result["checked"] == 1
    assert captured["query"] == "road bike"
    search_location_context = captured["search_location_context"]
    assert search_location_context is not None
    assert search_location_context.display_name == "Toronto, ON"

    db.close()
    engine.dispose()


def test_get_user_location_preference_normalizes_uuid_user_ids():
    engine, session_factory = build_test_session_factory()
    db = session_factory()
    user_id = uuid.uuid4()

    db.add(
        UserLocationPreference(
            user_id=str(user_id),
            display_name="Toronto, ON",
            city="Toronto",
            province_code="ON",
            province_name="Ontario",
            country_code="CA",
            latitude=43.6532,
            longitude=-79.3832,
            mode="manual",
        )
    )
    db.commit()

    row = get_user_location_preference(db, user_id)

    assert row is not None
    assert row.user_id == str(user_id)

    db.close()
    engine.dispose()


def test_run_saved_search_alert_check_normalizes_uuid_saved_search_user_ids(monkeypatch):
    engine, session_factory = build_test_session_factory()
    db = session_factory()
    user_id = uuid.uuid4()

    saved_search = SavedSearch(
        user_id=str(user_id),
        query="road bike",
        sources="kijiji,facebook",
        alerts_enabled=True,
        last_alert_checked_at=datetime.now(timezone.utc) - timedelta(days=1),
    )
    db.add(saved_search)
    db.add(
        UserLocationPreference(
            user_id=str(user_id),
            display_name="Toronto, ON",
            city="Toronto",
            province_code="ON",
            province_name="Ontario",
            country_code="CA",
            latitude=43.6532,
            longitude=-79.3832,
            mode="manual",
        )
    )
    db.commit()
    db.refresh(saved_search)
    saved_search.user_id = user_id

    captured: dict[str, object] = {}

    async def fake_unified_search(**kwargs):
        captured.update(kwargs)
        return [], 0, None, {}

    monkeypatch.setattr("app.services.alerts.unified_search", fake_unified_search)
    monkeypatch.setattr("app.services.alerts.enrich_listings_with_insights", lambda db, query, results: results)
    monkeypatch.setattr("app.services.alerts.persist_listing_snapshots", lambda **kwargs: 0)

    outcome = asyncio.run(
        run_saved_search_alert_check(
            db,
            saved_search=saved_search,
            limit_per_search=20,
        )
    )

    search_location_context = captured["search_location_context"]
    facebook_runtime_context = captured["facebook_runtime_context"]

    assert outcome.successful_check is True
    assert search_location_context is not None
    assert search_location_context.display_name == "Toronto, ON"
    assert facebook_runtime_context is not None
    assert facebook_runtime_context.user_id == str(user_id)
    assert facebook_runtime_context.latitude == 43.6532
    assert saved_search.last_alert_error_code is None

    db.close()
    engine.dispose()


def test_execute_saved_search_alert_check_clears_prior_error_state_on_success(monkeypatch):
    engine, session_factory = build_test_session_factory()
    db = session_factory()
    previous_check = datetime.now(timezone.utc) - timedelta(hours=9)

    saved_search = SavedSearch(
        user_id="user-clear-error",
        query="road bike",
        sources="ebay",
        alerts_enabled=True,
        last_alert_attempted_at=previous_check - timedelta(minutes=5),
        last_alert_checked_at=previous_check,
        last_alert_error_code="TIMEOUT",
        last_alert_error_message="eBay: timed out.",
    )
    db.add(saved_search)
    db.commit()
    db.refresh(saved_search)

    async def fake_unified_search(**kwargs):
        return [], 0, None, {}

    monkeypatch.setattr("app.services.alerts.unified_search", fake_unified_search)
    monkeypatch.setattr("app.services.alerts.enrich_listings_with_insights", lambda db, query, results: results)
    monkeypatch.setattr("app.services.alerts.persist_listing_snapshots", lambda **kwargs: 0)

    outcome = asyncio.run(
        execute_saved_search_alert_check(
            db,
            saved_search_id=saved_search.id,
            limit_per_search=20,
        )
    )

    db.refresh(saved_search)

    assert outcome.successful_check is True
    assert outcome.error_code is None
    assert saved_search.last_alert_attempted_at is not None
    assert saved_search.last_alert_checked_at is not None
    assert _as_utc(saved_search.last_alert_checked_at) > previous_check
    assert saved_search.last_alert_error_code is None
    assert saved_search.last_alert_error_message is None

    db.close()
    engine.dispose()


def test_execute_saved_search_alert_check_preserves_last_successful_check_on_failure(monkeypatch):
    engine, session_factory = build_test_session_factory()
    db = session_factory()
    previous_check = datetime.now(timezone.utc) - timedelta(hours=9)

    saved_search = SavedSearch(
        user_id="user-preserve-check",
        query="mazda miata",
        sources="facebook",
        alerts_enabled=True,
        last_alert_checked_at=previous_check,
    )
    db.add(saved_search)
    db.commit()
    db.refresh(saved_search)

    async def fake_unified_search(**kwargs):
        return [], 0, None, {
            "facebook": SourceError(
                code="LOGIN_REQUIRED",
                message="Cookies expired.",
                retryable=False,
            )
        }

    monkeypatch.setattr("app.services.alerts.unified_search", fake_unified_search)

    outcome = asyncio.run(
        execute_saved_search_alert_check(
            db,
            saved_search_id=saved_search.id,
            limit_per_search=20,
        )
    )

    db.refresh(saved_search)

    assert outcome.successful_check is False
    assert outcome.error_code == "LOGIN_REQUIRED"
    assert _as_utc(saved_search.last_alert_checked_at) == previous_check
    assert saved_search.last_alert_attempted_at is not None
    assert saved_search.last_alert_error_code == "LOGIN_REQUIRED"
    assert saved_search.last_alert_error_message == "Facebook: Cookies expired."

    db.close()
    engine.dispose()
