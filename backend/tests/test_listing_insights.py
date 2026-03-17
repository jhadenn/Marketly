from app.models.listing import Listing, Money
from app.models.listing_snapshot import ListingSnapshot
from app.services.listing_insights import enrich_listings_with_insights, valuation_key_for_listing

from .utils import build_test_session_factory


def test_enrich_listings_with_insights_adds_valuation_and_risk():
    engine, session_factory = build_test_session_factory()
    db = session_factory()

    listing = Listing(
        source="kijiji",
        source_listing_id="listing-1",
        title="Trek Domane road bike",
        price=Money(amount=520, currency="CAD"),
        url="https://example.com/listing-1",
        image_urls=[],
        location=None,
        snippet="Must sell fast.",
    )
    valuation_key = valuation_key_for_listing("trek road bike", listing)
    historical_prices = [760, 780, 800, 820, 790, 810]
    db.add_all(
        [
            ListingSnapshot(
                source="kijiji",
                source_listing_id=f"hist-{index}",
                listing_fingerprint=f"kijiji:hist-{index}",
                query="trek road bike",
                title="Trek Domane road bike",
                price_amount=price,
                price_currency="CAD",
                location="Toronto",
                condition="used",
                snippet="Historical sample",
                image_count=2,
                url=f"https://example.com/hist-{index}",
                valuation_key=valuation_key,
            )
            for index, price in enumerate(historical_prices, start=1)
        ]
    )
    db.commit()

    enrich_listings_with_insights(db, "trek road bike", [listing])

    assert listing.valuation is not None
    assert listing.valuation.verdict == "underpriced"
    assert listing.valuation.sample_count == len(historical_prices)
    assert listing.valuation.estimated_low is not None
    assert listing.risk is not None
    assert listing.risk.level in {"medium", "high"}
    assert listing.risk.reasons

    db.close()
    engine.dispose()


def test_enrich_listings_with_insights_handles_insufficient_data():
    engine, session_factory = build_test_session_factory()
    db = session_factory()

    listing = Listing(
        source="ebay",
        source_listing_id="listing-2",
        title="Used gaming chair",
        price=Money(amount=140, currency="CAD"),
        url="https://example.com/listing-2",
        image_urls=["https://example.com/chair.jpg"],
        location="Ottawa",
        snippet="Comfortable chair",
    )
    valuation_key = valuation_key_for_listing("gaming chair", listing)
    db.add_all(
        [
            ListingSnapshot(
                source="ebay",
                source_listing_id=f"chair-{index}",
                listing_fingerprint=f"ebay:chair-{index}",
                query="gaming chair",
                title="Used gaming chair",
                price_amount=price,
                price_currency="CAD",
                location="Ottawa",
                condition="used",
                snippet="Historical sample",
                image_count=1,
                url=f"https://example.com/chair-{index}",
                valuation_key=valuation_key,
            )
            for index, price in enumerate([135, 150], start=1)
        ]
    )
    db.commit()

    enrich_listings_with_insights(db, "gaming chair", [listing])

    assert listing.valuation is not None
    assert listing.valuation.verdict == "insufficient_data"
    assert listing.valuation.explanation is not None
    assert listing.risk is not None
    assert listing.risk.level == "low"

    db.close()
    engine.dispose()
