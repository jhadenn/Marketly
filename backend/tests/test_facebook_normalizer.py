from app.connectors.facebook_marketplace.normalizer import normalize_marketplace_card


def _card(*, listing_id: str, lines: list[str], title: str = "", scopes: list[dict] | None = None) -> dict:
    card = {
        "href": f"/marketplace/item/{listing_id}/",
        "lines": lines,
        "text": " ".join(lines),
        "title": title,
        "image_urls": ["https://example.com/image.jpg"],
    }
    if scopes is not None:
        card["scopes"] = scopes
    return card


def test_normalizer_ignores_secondary_price_line_for_title() -> None:
    card = _card(
        listing_id="1001",
        lines=["$550", "CA$580", "Toronto, ON", "iPhone 15, 128GB, Unlocked"],
    )

    listing = normalize_marketplace_card(card)

    assert listing is not None
    assert listing.price_value == 550.0
    assert listing.title == "iPhone 15, 128GB, Unlocked"


def test_normalizer_rejects_price_only_anchor_title() -> None:
    card = _card(
        listing_id="1002",
        lines=["$520", "CA$555", "Toronto, ON"],
        title="CA$555",
    )

    listing = normalize_marketplace_card(card)

    assert listing is not None
    assert listing.price_value == 520.0
    assert listing.title != "CA$555"


def test_normalizer_treats_just_listed_as_age_not_title() -> None:
    card = _card(
        listing_id="1003",
        lines=["$375", "Just listed", "Toronto, ON", "iPhone 14 Pro"],
    )

    listing = normalize_marketplace_card(card)

    assert listing is not None
    assert listing.title == "iPhone 14 Pro"
    assert listing.age_hint == "Just listed"
    assert listing.posted_at is not None


def test_normalizer_does_not_treat_vehicle_mileage_as_location() -> None:
    card = _card(
        listing_id="1004",
        lines=["$8,000", "1990 Mazda mx-5 miata", "187,000 km", "Toronto, ON"],
    )

    listing = normalize_marketplace_card(card)

    assert listing is not None
    assert listing.location_text == "Toronto, ON"


def test_normalizer_prefers_richer_scope_when_it_contains_vehicle_details() -> None:
    card = _card(
        listing_id="1005",
        lines=["$2,200", "2008 Honda civic", "Toronto, ON"],
        title="2008 Honda civic",
        scopes=[
            {
                "depth": 0,
                "lines": ["$2,200", "2008 Honda civic", "Toronto, ON"],
                "text": "$2,200 2008 Honda civic Toronto, ON",
            },
            {
                "depth": 1,
                "lines": ["$2,200", "2008 Honda civic", "123,456 km", "Toronto, ON"],
                "text": "$2,200 2008 Honda civic 123,456 km Toronto, ON",
            },
        ],
    )

    listing = normalize_marketplace_card(card)

    assert listing is not None
    assert listing.raw["lines"] == ["$2,200", "2008 Honda civic", "123,456 km", "Toronto, ON"]
