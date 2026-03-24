from app.connectors.ebay_connector import EbayConnector
from app.connectors.facebook_marketplace.models import FacebookNormalizedListing
from app.connectors.facebook_marketplace.unified_connector import _to_listing
from app.connectors.kijiji_scrape import KijijiScrapeConnector


def test_kijiji_connector_builds_snippet_from_search_card_blob():
    connector = KijijiScrapeConnector()

    snippet = connector._clean_snippet(
        "Vintage road bike",
        "Vintage road bike $450 Toronto Lightweight aluminum frame freshly tuned and ready to ride",
    )

    assert snippet is not None
    assert "Vintage road bike" not in snippet
    assert "Lightweight aluminum frame" in snippet


def test_facebook_unified_connector_prefers_descriptive_card_lines_for_snippet():
    listing = _to_listing(
        FacebookNormalizedListing(
            source="facebook",
            external_id="1234567890",
            title="Vintage road bike",
            price_value=550.0,
            price_currency="CAD",
            location_text="Toronto, ON",
            latitude=None,
            longitude=None,
            image_urls=["https://example.com/image.jpg"],
            listing_url="https://www.facebook.com/marketplace/item/1234567890/",
            seller_name="Seller",
            posted_at=None,
            raw={
                "href": "/marketplace/item/1234567890/",
                "lines": [
                    "$550",
                    "Toronto, ON",
                    "Vintage road bike",
                    "Lightweight aluminum frame",
                    "Fresh tune-up and new tires",
                ],
            },
            price_bucket="500-750",
            title_keywords=["vintage", "road", "bike"],
            has_images=True,
            location_quality=0.95,
            age_hint="2 days ago",
            dedup_key="facebook:1234567890",
        )
    )

    assert listing.snippet == "Lightweight aluminum frame | Fresh tune-up and new tires"


def test_ebay_connector_maps_posted_at_from_item_origin_date():
    listing = EbayConnector._to_listing(
        {
            "itemId": "v1|123|0",
            "title": "Vintage road bike",
            "itemWebUrl": "https://www.ebay.ca/itm/123",
            "price": {"value": "300", "currency": "CAD"},
            "itemLocation": {"city": "Toronto", "country": "CA"},
            "itemOriginDate": "2026-03-24T12:34:56.000Z",
        }
    )

    assert listing is not None
    assert listing.posted_at == "2026-03-24T12:34:56Z"


def test_kijiji_connector_extracts_relative_posted_at_and_newest_url():
    connector = KijijiScrapeConnector()

    posted_at = connector._extract_posted_at("Posted 2 hours ago Vintage road bike Toronto")
    newest_url = connector._build_search_url("road bike", sort="newest")

    assert posted_at is not None
    assert "sortByName=dateDesc" in newest_url
