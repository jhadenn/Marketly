from app.services.location import (
    interpret_listing_location,
    list_city_suggestions,
    resolve_city_province,
    resolve_coordinates,
    resolve_unique_city,
)


def test_resolve_city_province_normalizes_province_aliases():
    resolved = resolve_city_province("Toronto", "Ontario")

    assert resolved is not None
    assert resolved.display_name == "Toronto, ON"
    assert resolved.province_code == "ON"
    assert resolved.country_code == "CA"
    assert resolved.mode == "manual"


def test_resolve_unique_city_rejects_ambiguous_city_names():
    assert resolve_unique_city("Cochrane") is None


def test_resolve_coordinates_returns_gps_mode_for_canadian_city():
    resolved = resolve_coordinates(43.6532, -79.3832)

    assert resolved is not None
    assert resolved.display_name == "Toronto, ON"
    assert resolved.mode == "gps"


def test_interpret_listing_location_rejects_non_canadian_text():
    match = interpret_listing_location("Buffalo, NY, USA")

    assert match.country_code == "US"
    assert match.latitude is None
    assert match.longitude is None
    assert match.distance_is_approximate is False


def test_list_city_suggestions_returns_canadian_matches_for_province():
    suggestions = list_city_suggestions(province_code="ON", query="Tor", limit=10)

    assert suggestions
    assert suggestions[0].province_code == "ON"
    assert any(entry.display_name == "Toronto, ON" for entry in suggestions)
