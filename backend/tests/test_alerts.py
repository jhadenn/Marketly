from datetime import datetime, timedelta, timezone

from app.models.listing import Listing, ListingRisk, ListingValuation, Money
from app.models.listing_snapshot import ListingSnapshot
from app.models.saved_search import SavedSearch
from app.models.saved_search_notification import SavedSearchNotification
from app.services.alerts import run_saved_search_alert_job
from app.services.listing_insights import listing_fingerprint

from .utils import build_test_session_factory


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

    seen_listing = Listing(
        source="ebay",
        source_listing_id="old-1",
        title="Road bike old listing",
        price=Money(amount=500, currency="CAD"),
        url="https://example.com/old-1",
        image_urls=["https://example.com/old-1.jpg"],
        location="Toronto",
        snippet="Old result",
        score=7.0,
        valuation=ListingValuation(
            verdict="fair",
            estimated_low=480,
            estimated_high=560,
            median_price=520,
            currency="CAD",
            confidence=0.8,
            sample_count=8,
            explanation="Price is in the recent market band.",
        ),
        risk=ListingRisk(level="low", score=0.1, reasons=["No major risk signals were detected."]),
    )
    new_listing = Listing(
        source="ebay",
        source_listing_id="new-1",
        title="Road bike fresh listing",
        price=Money(amount=430, currency="CAD"),
        url="https://example.com/new-1",
        image_urls=["https://example.com/new-1.jpg"],
        location="Toronto",
        snippet="Clean frame and detailed listing.",
        score=8.0,
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

    async def fake_generate_alert_summary(query, items):
        return f"{len(items)} new match for {query}"

    monkeypatch.setattr("app.services.alerts.unified_search", fake_unified_search)
    monkeypatch.setattr("app.services.alerts.enrich_listings_with_insights", lambda db, query, results: results)
    monkeypatch.setattr("app.services.alerts.persist_listing_snapshots", lambda **kwargs: len(kwargs["listings"]))
    monkeypatch.setattr("app.services.alerts.generate_alert_summary", fake_generate_alert_summary)

    result = __import__("asyncio").run(
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
    assert notifications[0].items_json[0]["source_listing_id"] == "new-1"
    assert saved_search.last_alert_notified_at is not None
    assert saved_search.last_alert_checked_at is not None

    db.close()
    engine.dispose()
