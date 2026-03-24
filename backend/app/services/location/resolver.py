from __future__ import annotations

import json
import math
import re
import unicodedata
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from typing import Iterable

from app.schemas.location import LocationCitySuggestion, ResolvedLocation

DATA_PATH = Path(__file__).resolve().parents[2] / "data" / "canada_cities.json"
MAX_GPS_MATCH_DISTANCE_KM = 250.0
GPS_POPULATION_PREFERENCE_RADIUS_KM = 25.0
EARTH_RADIUS_KM = 6371.0088

PROVINCE_ALIASES: dict[str, tuple[str, ...]] = {
    "AB": ("ab", "alberta"),
    "BC": ("bc", "british columbia", "colombie britannique"),
    "MB": ("mb", "manitoba"),
    "NB": ("nb", "new brunswick", "nouveau brunswick"),
    "NL": ("nl", "newfoundland and labrador", "newfoundland", "terre neuve and labrador"),
    "NS": ("ns", "nova scotia", "nouvelle ecosse", "nouvelle-ecosse"),
    "NT": ("nt", "northwest territories", "northwest territory", "territoires du nord ouest"),
    "NU": ("nu", "nunavut"),
    "ON": ("on", "ontario"),
    "PE": (
        "pe",
        "pei",
        "prince edward island",
        "ile du prince edouard",
        "ile-du-prince-edouard",
    ),
    "QC": ("qc", "pq", "quebec", "québec"),
    "SK": ("sk", "saskatchewan"),
    "YT": ("yt", "yukon", "yukon territory"),
}

COUNTRY_ALIASES: dict[str, str] = {
    "ca": "CA",
    "can": "CA",
    "canada": "CA",
    "us": "US",
    "usa": "US",
    "u s a": "US",
    "u s": "US",
    "united states": "US",
    "united states of america": "US",
    "mx": "MX",
    "mexico": "MX",
    "uk": "GB",
    "united kingdom": "GB",
    "great britain": "GB",
}

LOCATION_DELIMITER_RE = re.compile(r"[|/·]")
DISTANCE_SNIPPET_RE = re.compile(r"\b\d+(?:\.\d+)?\s*km away\b", re.IGNORECASE)
NON_ALNUM_RE = re.compile(r"[^a-z0-9]+")


@dataclass(frozen=True)
class CityRecord:
    city: str
    city_ascii: str
    province_code: str
    province_name: str
    country_code: str
    latitude: float
    longitude: float
    population: int
    geonameid: int


@dataclass(frozen=True)
class ListingLocationMatch:
    country_code: str | None
    latitude: float | None
    longitude: float | None
    distance_is_approximate: bool


@dataclass(frozen=True)
class ResolverIndex:
    records: tuple[CityRecord, ...]
    by_city_province: dict[tuple[str, str], tuple[CityRecord, ...]]
    by_city: dict[str, tuple[CityRecord, ...]]
    by_province: dict[str, tuple[CityRecord, ...]]


def _normalize_text(value: str | None) -> str:
    text = unicodedata.normalize("NFKD", str(value or ""))
    text = "".join(ch for ch in text if not unicodedata.combining(ch))
    text = text.casefold().strip()
    text = re.sub(r"\bsaint\b", "st", text)
    text = re.sub(r"\bsainte\b", "ste", text)
    text = re.sub(r"\bfort\b", "ft", text)
    text = NON_ALNUM_RE.sub(" ", text)
    return re.sub(r"\s+", " ", text).strip()


def _province_alias_lookup() -> dict[str, str]:
    aliases: dict[str, str] = {}
    for province_code, values in PROVINCE_ALIASES.items():
        for value in values:
            aliases[_normalize_text(value)] = province_code
    return aliases


PROVINCE_ALIAS_LOOKUP = _province_alias_lookup()


def normalize_province_code(value: str | None) -> str | None:
    normalized = _normalize_text(value)
    if not normalized:
        return None
    return PROVINCE_ALIAS_LOOKUP.get(normalized)


def _load_records() -> list[CityRecord]:
    payload = json.loads(DATA_PATH.read_text(encoding="utf-8"))
    return [
        CityRecord(
            city=str(item["city"]),
            city_ascii=str(item["city_ascii"]),
            province_code=str(item["province_code"]),
            province_name=str(item["province_name"]),
            country_code=str(item.get("country_code") or "CA"),
            latitude=float(item["latitude"]),
            longitude=float(item["longitude"]),
            population=int(item.get("population") or 0),
            geonameid=int(item["geonameid"]),
        )
        for item in payload
    ]


def _add_index_entry(
    mapping: dict[str | tuple[str, str], list[CityRecord]],
    key: str | tuple[str, str],
    record: CityRecord,
) -> None:
    bucket = mapping.setdefault(key, [])
    if record not in bucket:
        bucket.append(record)


@lru_cache(maxsize=1)
def _resolver_index() -> ResolverIndex:
    records = tuple(_load_records())
    by_city_province: dict[tuple[str, str], list[CityRecord]] = {}
    by_city: dict[str, list[CityRecord]] = {}
    by_province: dict[str, list[CityRecord]] = {}

    for record in records:
        aliases = {_normalize_text(record.city), _normalize_text(record.city_ascii)}
        for alias in aliases:
            if not alias:
                continue
            _add_index_entry(by_city_province, (alias, record.province_code), record)
            _add_index_entry(by_city, alias, record)
        by_province.setdefault(record.province_code, []).append(record)

    return ResolverIndex(
        records=records,
        by_city_province={key: tuple(value) for key, value in by_city_province.items()},
        by_city={key: tuple(value) for key, value in by_city.items()},
        by_province={
            key: tuple(
                sorted(value, key=lambda record: (-record.population, _normalize_text(record.city)))
            )
            for key, value in by_province.items()
        },
    )


def _pick_best(candidates: Iterable[CityRecord]) -> CityRecord | None:
    ordered = sorted(
        candidates,
        key=lambda record: (-record.population, _normalize_text(record.city), record.geonameid),
    )
    return ordered[0] if ordered else None


def _build_display_name(city: str, province_code: str) -> str:
    return f"{city}, {province_code}"


def resolve_city_province(city: str, province: str) -> ResolvedLocation | None:
    province_code = normalize_province_code(province)
    normalized_city = _normalize_text(city)
    if not province_code or not normalized_city:
        return None

    candidates = _resolver_index().by_city_province.get((normalized_city, province_code), ())
    record = _pick_best(candidates)
    if record is None:
        return None

    return ResolvedLocation(
        display_name=_build_display_name(record.city, record.province_code),
        city=record.city,
        province_code=record.province_code,
        province_name=record.province_name,
        country_code=record.country_code,
        latitude=record.latitude,
        longitude=record.longitude,
        mode="manual",
    )


def resolve_unique_city(city: str) -> ResolvedLocation | None:
    normalized_city = _normalize_text(city)
    if not normalized_city:
        return None

    candidates = _resolver_index().by_city.get(normalized_city, ())
    if not candidates:
        return None

    provinces = {candidate.province_code for candidate in candidates}
    if len(provinces) != 1:
        return None

    record = _pick_best(candidates)
    if record is None:
        return None

    return ResolvedLocation(
        display_name=_build_display_name(record.city, record.province_code),
        city=record.city,
        province_code=record.province_code,
        province_name=record.province_name,
        country_code=record.country_code,
        latitude=record.latitude,
        longitude=record.longitude,
        mode="manual",
    )


def haversine_km(
    latitude_a: float,
    longitude_a: float,
    latitude_b: float,
    longitude_b: float,
) -> float:
    lat_a = math.radians(latitude_a)
    lon_a = math.radians(longitude_a)
    lat_b = math.radians(latitude_b)
    lon_b = math.radians(longitude_b)
    sin_lat = math.sin((lat_b - lat_a) / 2)
    sin_lon = math.sin((lon_b - lon_a) / 2)
    value = sin_lat * sin_lat + math.cos(lat_a) * math.cos(lat_b) * sin_lon * sin_lon
    arc = 2 * math.atan2(math.sqrt(value), math.sqrt(max(0.0, 1 - value)))
    return EARTH_RADIUS_KM * arc


def resolve_coordinates(latitude: float, longitude: float) -> ResolvedLocation | None:
    best_record: CityRecord | None = None
    best_distance: float | None = None
    nearby_candidates: list[tuple[CityRecord, float]] = []

    for record in _resolver_index().records:
        distance = haversine_km(latitude, longitude, record.latitude, record.longitude)
        if distance <= GPS_POPULATION_PREFERENCE_RADIUS_KM:
            nearby_candidates.append((record, distance))
        if best_distance is None or distance < best_distance:
            best_record = record
            best_distance = distance

    if best_record is None or best_distance is None or best_distance > MAX_GPS_MATCH_DISTANCE_KM:
        return None

    if nearby_candidates:
        best_record, _ = max(
            nearby_candidates,
            key=lambda item: (item[0].population, -item[1], -item[0].geonameid),
        )

    return ResolvedLocation(
        display_name=_build_display_name(best_record.city, best_record.province_code),
        city=best_record.city,
        province_code=best_record.province_code,
        province_name=best_record.province_name,
        country_code=best_record.country_code,
        latitude=latitude,
        longitude=longitude,
        mode="gps",
    )


def _split_location_tokens(value: str) -> list[str]:
    cleaned = DISTANCE_SNIPPET_RE.sub("", value or "")
    cleaned = LOCATION_DELIMITER_RE.sub(",", cleaned)
    cleaned = re.sub(r"\s+", " ", cleaned).strip(" ,")
    if not cleaned:
        return []
    return [token.strip() for token in cleaned.split(",") if token.strip()]


def _country_code_from_token(token: str | None) -> str | None:
    normalized = _normalize_text(token)
    if not normalized:
        return None
    return COUNTRY_ALIASES.get(normalized)


def interpret_listing_location(
    location_text: str | None,
    *,
    source_hint: str | None = None,
    country_hint: str | None = None,
    latitude: float | None = None,
    longitude: float | None = None,
) -> ListingLocationMatch:
    if latitude is not None and longitude is not None:
        resolved = resolve_coordinates(latitude, longitude)
        country_code = resolved.country_code if resolved is not None else country_hint
        return ListingLocationMatch(
            country_code=country_code,
            latitude=latitude,
            longitude=longitude,
            distance_is_approximate=False,
        )

    tokens = _split_location_tokens(location_text or "")
    if not tokens:
        return ListingLocationMatch(
            country_code=country_hint,
            latitude=None,
            longitude=None,
            distance_is_approximate=False,
        )

    explicit_country = None
    for token in reversed(tokens):
        explicit_country = _country_code_from_token(token)
        if explicit_country is not None:
            break

    country_code = explicit_country or country_hint
    if explicit_country is not None and explicit_country != "CA":
        return ListingLocationMatch(
            country_code=explicit_country,
            latitude=None,
            longitude=None,
            distance_is_approximate=False,
        )

    city = tokens[0]
    province_token = next(
        (token for token in tokens[1:] if normalize_province_code(token) is not None),
        None,
    )
    resolved = (
        resolve_city_province(city, province_token)
        if province_token is not None
        else resolve_unique_city(city)
    )
    if resolved is None:
        return ListingLocationMatch(
            country_code=country_code,
            latitude=None,
            longitude=None,
            distance_is_approximate=False,
        )

    return ListingLocationMatch(
        country_code=resolved.country_code,
        latitude=resolved.latitude,
        longitude=resolved.longitude,
        distance_is_approximate=True,
    )


def list_city_suggestions(
    *,
    province_code: str,
    query: str | None = None,
    limit: int = 20,
) -> list[LocationCitySuggestion]:
    normalized_province = normalize_province_code(province_code)
    if normalized_province is None:
        return []

    normalized_query = _normalize_text(query)
    results: list[LocationCitySuggestion] = []
    seen: set[str] = set()
    for record in _resolver_index().by_province.get(normalized_province, ()):
        normalized_city = _normalize_text(record.city)
        if normalized_query and not (
            normalized_city.startswith(normalized_query) or normalized_query in normalized_city
        ):
            continue
        display_name = _build_display_name(record.city, record.province_code)
        if display_name in seen:
            continue
        seen.add(display_name)
        results.append(
            LocationCitySuggestion(
                city=record.city,
                province_code=record.province_code,
                province_name=record.province_name,
                display_name=display_name,
            )
        )
        if len(results) >= max(1, limit):
            break
    return results
