from __future__ import annotations

import re

ODOMETER_RE = re.compile(
    r"(?<![\d.])(?P<value>\d{1,3}(?:[,\s]\d{3})+|\d{4,7})\s*"
    r"(?P<unit>km|kms|kilomet(?:er|re)s?)\b(?!\s*away\b)",
    re.IGNORECASE,
)
AUTOMOTIVE_MARKER_RE = re.compile(
    r"\b(?:"
    r"acura|audi|bmw|buick|cadillac|chevrolet|chevy|chrysler|dodge|ford|gmc|"
    r"honda|hyundai|infiniti|jeep|kia|lexus|lincoln|mazda|mercedes(?:-benz)?|"
    r"mini|mitsubishi|nissan|porsche|ram|subaru|tesla|toyota|volkswagen|vw|"
    r"volvo|car|cars|truck|trucks|suv|sedan|coupe|hatchback|wagon|pickup|"
    r"minivan|van|crossover|automotive|vehicle|vehicles"
    r")\b",
    re.IGNORECASE,
)
AUTOMOTIVE_YEAR_RE = re.compile(r"\b(?:19[5-9]\d|20[0-3]\d)\b")
AUTOMOTIVE_URL_MARKERS = (
    "/v-cars-trucks/",
    "/cars+trucks/",
)


def looks_like_automotive_listing(*parts: object) -> bool:
    normalized_parts = [str(part or "").strip().lower() for part in parts if str(part or "").strip()]
    if not normalized_parts:
        return False

    if any(marker in part for part in normalized_parts for marker in AUTOMOTIVE_URL_MARKERS):
        return True

    combined = " ".join(normalized_parts)
    return bool(AUTOMOTIVE_MARKER_RE.search(combined) or AUTOMOTIVE_YEAR_RE.search(combined))


def extract_vehicle_mileage_km(*parts: object) -> float | None:
    normalized_parts = [str(part or "").strip() for part in parts if str(part or "").strip()]
    if not normalized_parts:
        return None

    combined = " ".join(normalized_parts)
    if not looks_like_automotive_listing(combined):
        return None

    match = ODOMETER_RE.search(combined)
    if not match:
        return None

    raw_value = str(match.group("value") or "")
    digits_only = re.sub(r"[,\s]", "", raw_value)
    if not digits_only:
        return None

    try:
        return float(digits_only)
    except ValueError:
        return None
