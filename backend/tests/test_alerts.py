import asyncio
from datetime import datetime, timedelta, timezone

from app.core.config import settings
from app.models.listing import Listing, ListingRisk, ListingValuation, Money
from app.models.listing_snapshot import ListingSnapshot
from app.models.saved_search import SavedSearch
from app.models.saved_search_notification import SavedSearchNotification
from app.services.alerts import refresh_saved_search_alerts_for_user, run_saved_search_alert_job
from app.services.listing_insights import listing_fingerprint

from .utils import build_test_session_factory


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

    async def fake_unified_search(**kwargs):
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
    assert saved_search.last_alert_checked_at is not None
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
        last_alert_checked_at=datetime.now(timezone.utc) - timedelta(days=2),
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

    monkeypatch.setattr(settings, "MARKETLY_ALERTS_STALE_AFTER_SECONDS", 86400)
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
