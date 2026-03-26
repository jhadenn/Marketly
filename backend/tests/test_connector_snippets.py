from app.connectors.ebay_connector import EbayConnector
from app.connectors.facebook_marketplace.normalizer import normalize_marketplace_card
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


def test_facebook_unified_connector_prioritizes_vehicle_mileage_in_snippet():
    listing = _to_listing(
        FacebookNormalizedListing(
            source="facebook",
            external_id="vehicle-snippet-1",
            title="2017 Toyota Corolla LE",
            price_value=14900.0,
            price_currency="CAD",
            location_text="Toronto, ON",
            latitude=None,
            longitude=None,
            image_urls=["https://example.com/car.jpg"],
            listing_url="https://www.facebook.com/marketplace/item/vehicle-snippet-1/",
            seller_name="Seller",
            posted_at=None,
            raw={
                "href": "/marketplace/item/vehicle-snippet-1/",
                "lines": [
                    "$14,900",
                    "Toronto, ON",
                    "2017 Toyota Corolla LE",
                    "Automatic",
                    "123,456 km",
                    "Clean title",
                ],
            },
            price_bucket="10000-15000",
            title_keywords=["toyota", "corolla"],
            has_images=True,
            location_quality=0.95,
            age_hint="2 days ago",
            dedup_key="facebook:vehicle-snippet-1",
        )
    )

    assert listing.snippet == "123,456 km | Automatic"
    assert listing.vehicle_mileage_km == 123456.0


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


def test_kijiji_connector_prefers_visible_canadian_location_text_over_url_slug():
    connector = KijijiScrapeConnector()

    location = connector._extract_location(
        "Vintage road bike | Toronto, ON | Posted today",
        "https://www.kijiji.ca/v-road-bike/calgary/item-123",
    )

    assert location == "Toronto, ON"


def test_kijiji_connector_extracts_vehicle_mileage_from_automotive_blob():
    connector = KijijiScrapeConnector()

    mileage = connector._extract_vehicle_mileage_km(
        "2016 Honda Civic LX",
        "2016 Honda Civic LX $11,500 Toronto, ON 123,456 km Automatic",
        "https://www.kijiji.ca/v-cars-trucks/toronto/2016-honda-civic-lx/1234567890",
    )

    assert mileage == 123456.0


def test_kijiji_connector_does_not_treat_distance_as_vehicle_mileage():
    connector = KijijiScrapeConnector()

    mileage = connector._extract_vehicle_mileage_km(
        "2016 Honda Civic LX",
        "2016 Honda Civic LX $11,500 Toronto, ON 1,200 km away",
        "https://www.kijiji.ca/v-cars-trucks/toronto/2016-honda-civic-lx/1234567890",
    )

    assert mileage is None


def test_facebook_unified_connector_extracts_vehicle_mileage_from_raw_lines():
    listing = _to_listing(
        FacebookNormalizedListing(
            source="facebook",
            external_id="vehicle-1",
            title="2017 Toyota Corolla LE",
            price_value=14900.0,
            price_currency="CAD",
            location_text="Toronto, ON",
            latitude=None,
            longitude=None,
            image_urls=["https://example.com/car.jpg"],
            listing_url="https://www.facebook.com/marketplace/item/vehicle-1/",
            seller_name="Seller",
            posted_at=None,
            raw={
                "href": "/marketplace/item/vehicle-1/",
                "lines": [
                    "$14,900",
                    "Toronto, ON",
                    "2017 Toyota Corolla LE",
                    "123,456 km",
                    "Automatic",
                ],
            },
            price_bucket="10000-15000",
            title_keywords=["toyota", "corolla"],
            has_images=True,
            location_quality=0.95,
            age_hint="2 days ago",
            dedup_key="facebook:vehicle-1",
        )
    )

    assert listing.vehicle_mileage_km == 123456.0


def test_facebook_unified_connector_extracts_vehicle_mileage_from_raw_text():
    listing = _to_listing(
        FacebookNormalizedListing(
            source="facebook",
            external_id="vehicle-2",
            title="1990 Mazda mx-5 miata",
            price_value=8000.0,
            price_currency="CAD",
            location_text="Toronto, ON",
            latitude=None,
            longitude=None,
            image_urls=["https://example.com/car-2.jpg"],
            listing_url="https://www.facebook.com/marketplace/item/vehicle-2/",
            seller_name="Seller",
            posted_at=None,
            raw={
                "href": "/marketplace/item/vehicle-2/",
                "lines": [
                    "$8,000",
                    "Toronto, ON",
                    "1990 Mazda mx-5 miata",
                ],
                "text": "$8,000 Toronto, ON 1990 Mazda mx-5 miata 187,000 km Manual",
            },
            price_bucket="7500-9000",
            title_keywords=["mazda", "miata"],
            has_images=True,
            location_quality=0.95,
            age_hint="2 days ago",
            dedup_key="facebook:vehicle-2",
        )
    )

    assert listing.vehicle_mileage_km == 187000.0


def test_facebook_unified_connector_extracts_vehicle_mileage_from_detail_text():
    listing = _to_listing(
        FacebookNormalizedListing(
            source="facebook",
            external_id="vehicle-detail-1",
            title="2008 Honda civic",
            price_value=2200.0,
            price_currency="CAD",
            location_text="Toronto, ON",
            latitude=None,
            longitude=None,
            image_urls=["https://example.com/car-detail.jpg"],
            listing_url="https://www.facebook.com/marketplace/item/vehicle-detail-1/",
            seller_name="Seller",
            posted_at=None,
            raw={
                "href": "/marketplace/item/vehicle-detail-1/",
                "lines": [
                    "$2,200",
                    "2008 Honda civic",
                    "Toronto, ON",
                ],
                "detail_text": "2008 Honda civic 231,000 km automatic",
            },
            price_bucket="1500-3000",
            title_keywords=["honda", "civic"],
            has_images=True,
            location_quality=0.95,
            age_hint="2 days ago",
            dedup_key="facebook:vehicle-detail-1",
        )
    )

    assert listing.vehicle_mileage_km == 231000.0


def test_facebook_unified_connector_extracts_vehicle_mileage_from_candidate_scopes():
    normalized = normalize_marketplace_card(
        {
            "href": "/marketplace/item/vehicle-3/",
            "title": "2008 Honda civic",
            "lines": ["$2,200", "2008 Honda civic", "Toronto, ON"],
            "text": "$2,200 2008 Honda civic Toronto, ON",
            "image_urls": ["https://example.com/car-3.jpg"],
            "scopes": [
                {
                    "depth": 0,
                    "lines": ["$2,200", "2008 Honda civic", "Toronto, ON"],
                    "text": "$2,200 2008 Honda civic Toronto, ON",
                },
                {
                    "depth": 1,
                    "lines": ["$2,200", "2008 Honda civic", "186,000 km", "Toronto, ON"],
                    "text": "$2,200 2008 Honda civic 186,000 km Toronto, ON",
                },
            ],
        }
    )

    assert normalized is not None

    listing = _to_listing(normalized)

    assert listing.vehicle_mileage_km == 186000.0
    assert listing.snippet == "186,000 km"
