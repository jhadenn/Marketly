from datetime import datetime, timedelta, timezone

from app.core.config import settings
from app.models.listing import Listing, Money
from app.models.listing_snapshot import ListingSnapshot
from app.services.listing_insights import enrich_listings_with_insights, valuation_key_for_listing

from .utils import build_test_session_factory


def _listing(
    *,
    source_listing_id: str,
    title: str,
    price_amount: float,
    query: str,
    snippet: str | None = None,
    condition: str | None = None,
) -> Listing:
    return Listing(
        source="ebay",
        source_listing_id=source_listing_id,
        title=title,
        price=Money(amount=price_amount, currency="CAD"),
        url=f"https://example.com/{source_listing_id}",
        image_urls=["https://example.com/item.jpg"],
        location="Toronto",
        condition=condition,
        snippet=snippet,
        score=6.0,
    )


def _snapshot(
    *,
    query: str,
    source_listing_id: str,
    title: str,
    price_amount: float,
    valuation_key: str,
    snippet: str | None = None,
    condition: str | None = None,
    observed_at: datetime | None = None,
) -> ListingSnapshot:
    return ListingSnapshot(
        source="ebay",
        source_listing_id=source_listing_id,
        listing_fingerprint=f"ebay:{source_listing_id}",
        query=query,
        title=title,
        price_amount=price_amount,
        price_currency="CAD",
        location="Toronto",
        condition=condition,
        snippet=snippet,
        image_count=1,
        url=f"https://example.com/{source_listing_id}",
        valuation_key=valuation_key,
        observed_at=observed_at,
    )


def test_enrich_listings_with_insights_uses_historical_exact_when_exact_key_has_enough_history():
    engine, session_factory = build_test_session_factory()
    db = session_factory()

    query = "trek road bike"
    listing = _listing(
        source_listing_id="listing-1",
        title="Trek Domane road bike",
        price_amount=520,
        query=query,
        snippet="Carbon frame and Shimano drivetrain.",
        condition="used",
    )
    valuation_key = valuation_key_for_listing(query, listing)
    db.add_all(
        [
            _snapshot(
                query=query,
                source_listing_id=f"hist-{index}",
                title="Trek Domane road bike",
                price_amount=price,
                valuation_key=valuation_key,
                snippet="Historical sample",
                condition="used",
            )
            for index, price in enumerate([760, 780, 800, 820, 790, 810], start=1)
        ]
    )
    db.commit()

    enrich_listings_with_insights(db, query, [listing])

    assert listing.valuation is not None
    assert listing.valuation.verdict == "underpriced"
    assert listing.valuation.estimate_source == "historical_exact"
    assert listing.valuation.confidence_label in {"medium", "high"}
    assert listing.valuation.sample_count == 6
    assert listing.valuation.estimated_low is not None
    assert listing.risk is not None
    assert listing.risk.level in {"medium", "high"}

    db.close()
    engine.dispose()


def test_enrich_listings_with_insights_falls_back_to_historical_relaxed_band():
    engine, session_factory = build_test_session_factory()
    db = session_factory()

    query = "road bike"
    listing = _listing(
        source_listing_id="listing-2",
        title="Specialized Allez road bike Shimano Claris",
        price_amount=705,
        query=query,
        snippet="54cm alloy frame.",
        condition="used",
    )
    historical_items = [
        _listing(
            source_listing_id="hist-1",
            title="Specialized road bike Claris 54cm",
            price_amount=700,
            query=query,
            snippet="Light alloy frame.",
            condition="used",
        ),
        _listing(
            source_listing_id="hist-2",
            title="Allez road bike Shimano 56cm",
            price_amount=715,
            query="bike road",
            snippet="Claris groupset and tuned.",
            condition="used",
        ),
        _listing(
            source_listing_id="hist-3",
            title="Road bike Claris Specialized frame",
            price_amount=725,
            query=query,
            snippet="Fast commuter build.",
            condition="used",
        ),
    ]
    db.add_all(
        [
            _snapshot(
                query=query if index != 2 else "bike road",
                source_listing_id=item.source_listing_id,
                title=item.title,
                price_amount=float(item.price.amount),
                valuation_key=valuation_key_for_listing(query if index != 2 else "bike road", item),
                snippet=item.snippet,
                condition=item.condition,
            )
            for index, item in enumerate(historical_items, start=1)
        ]
    )
    db.commit()

    enrich_listings_with_insights(db, query, [listing])

    assert listing.valuation is not None
    assert listing.valuation.verdict == "fair"
    assert listing.valuation.estimate_source == "historical_relaxed"
    assert listing.valuation.sample_count == 3
    assert listing.valuation.explanation == "Estimate from recent similar listings in this search family."
    assert listing.valuation.estimated_low is not None
    assert listing.valuation.estimated_high is not None

    db.close()
    engine.dispose()


def test_enrich_listings_with_insights_uses_live_cohort_for_rough_estimate_when_history_is_missing():
    engine, session_factory = build_test_session_factory()
    db = session_factory()

    query = "gaming chair"
    listing = _listing(
        source_listing_id="listing-3",
        title="Gaming chair with lumbar support",
        price_amount=140,
        query=query,
        snippet="Black fabric chair.",
    )
    peers = [
        _listing(
            source_listing_id="peer-1",
            title="Gaming chair reclining lumbar",
            price_amount=135,
            query=query,
            snippet="Fabric seat and armrests.",
        ),
        _listing(
            source_listing_id="peer-2",
            title="Gaming chair ergonomic support",
            price_amount=145,
            query=query,
            snippet="Comfortable black chair.",
        ),
        _listing(
            source_listing_id="peer-3",
            title="Gaming chair with footrest",
            price_amount=150,
            query=query,
            snippet="Lumbar pillow included.",
        ),
    ]

    enrich_listings_with_insights(db, query, [listing, *peers])

    assert listing.valuation is not None
    assert listing.valuation.verdict == "insufficient_data"
    assert listing.valuation.estimate_source == "live_cohort"
    assert listing.valuation.sample_count == 3
    assert listing.valuation.explanation == "Rough estimate from similar live listings in this result set."
    assert listing.valuation.estimated_low is not None
    assert listing.valuation.estimated_high is not None

    db.close()
    engine.dispose()


def test_enrich_listings_with_insights_uses_compatible_live_cohort_peers_for_verdict():
    engine, session_factory = build_test_session_factory()
    db = session_factory()

    query = "iphone 15"
    listing = _listing(
        source_listing_id="listing-iphone-base",
        title="Apple iPhone 15 128GB Unlocked",
        price_amount=450,
        query=query,
        snippet="Blue smartphone in excellent condition.",
        condition="excellent",
    )
    compatible_peers = [
        _listing(
            source_listing_id=f"peer-compatible-{index}",
            title=f"Apple iPhone 15 128GB Unlocked #{index}",
            price_amount=price,
            query=query,
            snippet="Unlocked iPhone 15 with 128GB storage.",
            condition="excellent",
        )
        for index, price in enumerate([500, 505, 510, 515, 520], start=1)
    ]
    incompatible_peers = [
        _listing(
            source_listing_id="peer-plus",
            title="Apple iPhone 15 Plus 128GB Unlocked",
            price_amount=610,
            query=query,
            snippet="Plus model.",
            condition="excellent",
        ),
        _listing(
            source_listing_id="peer-storage",
            title="Apple iPhone 15 256GB Unlocked",
            price_amount=590,
            query=query,
            snippet="Larger storage option.",
            condition="excellent",
        ),
        _listing(
            source_listing_id="peer-locked",
            title="Apple iPhone 15 128GB Rogers Locked",
            price_amount=470,
            query=query,
            snippet="Locked to Rogers.",
            condition="excellent",
        ),
    ]

    enrich_listings_with_insights(db, query, [listing, *compatible_peers, *incompatible_peers])

    assert listing.valuation is not None
    assert listing.valuation.verdict == "underpriced"
    assert listing.valuation.estimate_source == "live_cohort"
    assert listing.valuation.sample_count == 5
    assert "comparable current listings" in str(listing.valuation.explanation).lower()

    db.close()
    engine.dispose()


def test_enrich_listings_with_insights_uses_category_prior_when_only_broad_history_exists():
    engine, session_factory = build_test_session_factory()
    db = session_factory()

    query = "bicycle"
    listing = _listing(
        source_listing_id="listing-4",
        title="Vintage city commuter bicycle",
        price_amount=250,
        query=query,
        snippet="Steel frame with upright bars.",
    )
    broad_history = [
        _listing(
            source_listing_id="broad-1",
            title="Bicycle trailer rack",
            price_amount=210,
            query=query,
            snippet="Garage storage setup.",
        ),
        _listing(
            source_listing_id="broad-2",
            title="Bicycle trainer stand",
            price_amount=235,
            query="used bicycle",
            snippet="Indoor workout setup.",
        ),
        _listing(
            source_listing_id="broad-3",
            title="Bicycle wheel set",
            price_amount=260,
            query=query,
            snippet="Alloy wheels for commuter build.",
        ),
    ]
    db.add_all(
        [
            _snapshot(
                query=query if index != 2 else "used bicycle",
                source_listing_id=item.source_listing_id,
                title=item.title,
                price_amount=float(item.price.amount),
                valuation_key=valuation_key_for_listing(query if index != 2 else "used bicycle", item),
                snippet=item.snippet,
            )
            for index, item in enumerate(broad_history, start=1)
        ]
    )
    db.commit()

    enrich_listings_with_insights(db, query, [listing])

    assert listing.valuation is not None
    assert listing.valuation.verdict == "insufficient_data"
    assert listing.valuation.estimate_source == "category_prior"
    assert listing.valuation.sample_count == 3
    assert listing.valuation.explanation == "Rough estimate from broader recent listings in this category."
    assert listing.valuation.estimated_low is not None
    assert listing.valuation.estimated_high is not None

    db.close()
    engine.dispose()


def test_enrich_listings_with_insights_uses_configured_lookback_window(monkeypatch):
    engine, session_factory = build_test_session_factory()
    db = session_factory()

    query = "trek road bike"
    listing = _listing(
        source_listing_id="listing-lookback",
        title="Trek Domane road bike",
        price_amount=520,
        query=query,
        snippet="Carbon frame and Shimano drivetrain.",
        condition="used",
    )
    valuation_key = valuation_key_for_listing(query, listing)
    now = datetime.now(timezone.utc)
    snapshots = [
        _snapshot(
            query=query,
            source_listing_id=f"recent-{index}",
            title="Trek Domane road bike",
            price_amount=price,
            valuation_key=valuation_key,
            snippet="Recent comparable listing",
            condition="used",
            observed_at=now - timedelta(days=10 + index),
        )
        for index, price in enumerate([760, 780, 800], start=1)
    ] + [
        _snapshot(
            query=query,
            source_listing_id=f"older-{index}",
            title="Trek Domane road bike",
            price_amount=price,
            valuation_key=valuation_key,
            snippet="Older comparable listing",
            condition="used",
            observed_at=now - timedelta(days=95 + index),
        )
        for index, price in enumerate([820, 790, 810], start=1)
    ]
    db.add_all(snapshots)
    db.commit()

    monkeypatch.setattr(settings, "MARKETLY_VALUATION_LOOKBACK_DAYS", 30)
    enrich_listings_with_insights(db, query, [listing])
    assert listing.valuation is not None
    assert listing.valuation.estimate_source == "historical_relaxed"
    assert listing.valuation.sample_count == 3

    listing_longer_lookback = _listing(
        source_listing_id="listing-lookback-2",
        title="Trek Domane road bike",
        price_amount=520,
        query=query,
        snippet="Carbon frame and Shimano drivetrain.",
        condition="used",
    )
    monkeypatch.setattr(settings, "MARKETLY_VALUATION_LOOKBACK_DAYS", 180)
    enrich_listings_with_insights(db, query, [listing_longer_lookback])
    assert listing_longer_lookback.valuation is not None
    assert listing_longer_lookback.valuation.estimate_source == "historical_exact"
    assert listing_longer_lookback.valuation.sample_count == 6

    db.close()
    engine.dispose()


def test_enrich_listings_with_insights_keeps_pending_when_no_signal_exists():
    engine, session_factory = build_test_session_factory()
    db = session_factory()

    listing = _listing(
        source_listing_id="listing-5",
        title="Compact espresso machine",
        price_amount=100,
        query="espresso machine",
        snippet="Works well and includes portafilter.",
    )

    enrich_listings_with_insights(db, "espresso machine", [listing])

    assert listing.valuation is not None
    assert listing.valuation.verdict == "insufficient_data"
    assert listing.valuation.estimate_source == "none"
    assert listing.valuation.estimated_low is None
    assert listing.valuation.estimated_high is None
    assert listing.valuation.explanation == "Not enough comparable historical listings yet."
    assert listing.risk is not None
    assert listing.risk.level == "low"

    db.close()
    engine.dispose()
