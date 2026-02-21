from __future__ import annotations

import hashlib
import re

UNKNOWN_LOCATION_TOKENS = {
    "",
    "unknown",
    "unspecified",
    "not specified",
    "n/a",
    "na",
}

TITLE_TOKEN_RE = re.compile(r"[a-z0-9]+")
AGE_HINT_RE = re.compile(
    r"\b(\d+)\s+(minute|hour|day|week|month|year)s?\s+ago\b",
    re.IGNORECASE,
)


def compute_price_bucket(price_value: float | None) -> str | None:
    if price_value is None:
        return None
    if price_value < 25:
        return "0-25"
    if price_value < 50:
        return "25-50"
    if price_value < 100:
        return "50-100"
    if price_value < 250:
        return "100-250"
    if price_value < 500:
        return "250-500"
    return "500+"


def extract_title_keywords(title: str) -> list[str]:
    seen: set[str] = set()
    keywords: list[str] = []
    for token in TITLE_TOKEN_RE.findall((title or "").lower()):
        if token in seen:
            continue
        seen.add(token)
        keywords.append(token)
    return keywords


def compute_location_quality(location_text: str | None) -> float:
    if not location_text:
        return 0.1

    normalized = location_text.strip().lower()
    if normalized in UNKNOWN_LOCATION_TOKENS:
        return 0.1

    # Heuristic only. Full geocoding is out of scope for MVP.
    if "," in normalized:
        return 0.95
    if len(normalized.split()) >= 2:
        return 0.75
    return 0.55


def extract_age_hint(text: str | None) -> str | None:
    if not text:
        return None
    match = AGE_HINT_RE.search(text)
    if not match:
        return None
    return match.group(0)


def build_fallback_dedup_key(
    *,
    title: str,
    price_value: float | None,
    location_text: str | None,
    first_image_url: str | None,
) -> str:
    parts = [
        (title or "").strip().lower(),
        "" if price_value is None else f"{price_value:.2f}",
        (location_text or "").strip().lower(),
        (first_image_url or "").strip(),
    ]
    raw = "|".join(parts)
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()
