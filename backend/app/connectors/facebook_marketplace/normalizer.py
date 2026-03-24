from __future__ import annotations

import re
from typing import Any
from urllib.parse import urlparse

from app.connectors.facebook_marketplace.features import (
    build_fallback_dedup_key,
    compute_location_quality,
    compute_price_bucket,
    extract_age_hint,
    extract_title_keywords,
)
from app.connectors.facebook_marketplace.models import FacebookNormalizedListing
from app.core.time_utils import parse_relative_age_to_utc_iso

PRICE_RE = re.compile(
    r"(?P<symbol>[$\u00a3\u20ac])\s*(?P<amount>\d[\d,]*(?:\.\d{1,2})?)",
    re.IGNORECASE,
)
PRICE_CODE_PREFIX_RE = re.compile(
    r"\b(?P<code>CAD|USD|EUR|GBP)\s*(?P<amount>\d[\d,]*(?:\.\d{1,2})?)\b",
    re.IGNORECASE,
)
PRICE_CODE_SUFFIX_RE = re.compile(
    r"\b(?P<amount>\d[\d,]*(?:\.\d{1,2})?)\s*(?P<code>CAD|USD|EUR|GBP)\b",
    re.IGNORECASE,
)
EXTERNAL_ID_RE = re.compile(r"/marketplace/item/(?P<id>\d+)")
AGE_LINE_RE = re.compile(
    r"\b(?:just\s+listed|(?:listed\s+)?\d+\s+(?:minute|hour|day|week|month|year)s?\s+ago)\b",
    re.IGNORECASE,
)
PRICE_TEXT_RE = re.compile(
    r"^\s*(?:"
    r"free"
    r"|(?:ca|us|au|nz)?\s*[$\u00a3\u20ac]\s*\d[\d,]*(?:\.\d{1,2})?"
    r"|(?:cad|usd|eur|gbp)\s*\d[\d,]*(?:\.\d{1,2})?"
    r"|\d[\d,]*(?:\.\d{1,2})?\s*(?:cad|usd|eur|gbp)"
    r")\s*$",
    re.IGNORECASE,
)
LOCATION_TOKEN_RE = re.compile(r"(?:\bkm away\b|,)", re.IGNORECASE)
GENERIC_TITLE_RE = re.compile(
    r"^(?:facebook\s+)?marketp\w*(?:\s+listing|\s+item)?$",
    re.IGNORECASE,
)

SYMBOL_TO_CURRENCY = {
    "$": "CAD",
    "\u00a3": "GBP",
    "\u20ac": "EUR",
}


def _clean_line(value: str) -> str:
    return re.sub(r"\s+", " ", (value or "")).strip()


def _normalize_url(url: str) -> str:
    if not url:
        return ""
    if url.startswith("http://") or url.startswith("https://"):
        return url
    if url.startswith("/"):
        return f"https://www.facebook.com{url}"
    return f"https://www.facebook.com/{url.lstrip('/')}"


def _extract_external_id(listing_url: str) -> str | None:
    match = EXTERNAL_ID_RE.search(listing_url)
    if not match:
        return None
    return match.group("id")


def _parse_price_from_line(line: str) -> tuple[float | None, str | None]:
    stripped = line.strip()
    if not stripped:
        return None, None
    if stripped.lower().startswith("free"):
        return 0.0, "CAD"

    match = PRICE_RE.search(stripped)
    currency: str | None = None
    if match:
        symbol = match.group("symbol") or "$"
        currency = SYMBOL_TO_CURRENCY.get(symbol, "CAD")
    else:
        match = PRICE_CODE_PREFIX_RE.search(stripped)
        if match:
            currency = str(match.group("code") or "").upper()[:3]
        else:
            match = PRICE_CODE_SUFFIX_RE.search(stripped)
            if match:
                currency = str(match.group("code") or "").upper()[:3]

    if not match:
        return None, None

    amount_raw = str(match.group("amount") or "").replace(",", "")
    try:
        amount = float(amount_raw)
    except ValueError:
        return None, None

    return amount, (currency or "CAD")


def _looks_like_location(line: str) -> bool:
    if not line:
        return False
    lowered = line.lower()
    if "seller" in lowered:
        return False
    if LOCATION_TOKEN_RE.search(lowered):
        return True
    if "," in line and len(line.split()) <= 6:
        return True
    return False


def _looks_like_age(line: str) -> bool:
    return bool(AGE_LINE_RE.search(line or ""))


def _is_title_candidate(line: str) -> bool:
    if not line:
        return False
    if _looks_like_age(line):
        return False
    if PRICE_TEXT_RE.match(line):
        return False
    lowered = line.lower()
    if "seller" in lowered and ":" in lowered:
        return False
    if len(line) < 3:
        return False
    return True


def _is_generic_title(title: str | None) -> bool:
    if not title:
        return True
    cleaned = _clean_line(title).lower()
    if not cleaned:
        return True
    if GENERIC_TITLE_RE.match(cleaned):
        return True
    if cleaned in {"listing", "item"}:
        return True
    return False


def _dedupe_images(image_urls: list[str]) -> list[str]:
    seen: set[str] = set()
    deduped: list[str] = []
    for url in image_urls:
        if not url:
            continue
        cleaned = url.strip()
        if not cleaned or cleaned in seen:
            continue
        seen.add(cleaned)
        deduped.append(cleaned)
    return deduped


def _extract_seller(lines: list[str]) -> str | None:
    for line in lines:
        lowered = line.lower()
        if lowered.startswith("seller:"):
            _, _, remainder = line.partition(":")
            seller = remainder.strip()
            return seller or None
    return None


def _fallback_title_from_url(listing_url: str) -> str:
    parsed = urlparse(listing_url)
    base = parsed.path.strip("/") or "marketplace listing"
    return base.replace("-", " ")


def normalize_marketplace_card(
    card: dict[str, Any],
    *,
    default_currency: str = "CAD",
) -> FacebookNormalizedListing | None:
    raw_href = str(card.get("href") or card.get("url") or "").strip()
    listing_url = _normalize_url(raw_href)
    if "/marketplace/item/" not in listing_url:
        return None

    lines = [_clean_line(str(line)) for line in (card.get("lines") or []) if _clean_line(str(line))]
    text = _clean_line(str(card.get("text") or " ".join(lines)))

    price_value: float | None = None
    price_currency: str | None = None
    location_text: str | None = None
    age_hint: str | None = None
    title: str | None = None
    used_fallback_title = False

    for line in lines:
        if PRICE_TEXT_RE.match(line):
            if price_value is None:
                parsed_price, parsed_currency = _parse_price_from_line(line)
                if parsed_price is not None:
                    price_value = parsed_price
                    price_currency = parsed_currency or default_currency
            continue

        if age_hint is None and _looks_like_age(line):
            age_hint = line
            continue

        if location_text is None and _looks_like_location(line):
            location_text = line
            continue

        if title is None and _is_title_candidate(line) and not _is_generic_title(line):
            title = line

    if title is None:
        candidate_title = _clean_line(str(card.get("title") or ""))
        if (
            candidate_title
            and not _is_generic_title(candidate_title)
            and _is_title_candidate(candidate_title)
        ):
            title = candidate_title
    if not title:
        title = _fallback_title_from_url(listing_url)
        used_fallback_title = True

    images = _dedupe_images([str(i) for i in (card.get("image_urls") or [])])
    external_id = _extract_external_id(listing_url)

    if age_hint is None:
        age_hint = extract_age_hint(text)
    posted_at = parse_relative_age_to_utc_iso(age_hint)

    # Drop obvious placeholder cards that don't carry a usable listing title.
    if _is_generic_title(title) and (used_fallback_title or not images):
        return None

    dedup_key = (
        f"facebook:{external_id}"
        if external_id
        else build_fallback_dedup_key(
            title=title,
            price_value=price_value,
            location_text=location_text,
            first_image_url=(images[0] if images else None),
        )
    )

    return FacebookNormalizedListing(
        source="facebook",
        external_id=external_id,
        title=title,
        price_value=price_value,
        price_currency=price_currency or (default_currency if price_value is not None else None),
        location_text=location_text,
        latitude=card.get("latitude"),
        longitude=card.get("longitude"),
        image_urls=images,
        listing_url=listing_url,
        seller_name=_extract_seller(lines),
        posted_at=posted_at,
        raw=card,
        price_bucket=compute_price_bucket(price_value),
        title_keywords=extract_title_keywords(title),
        has_images=bool(images),
        location_quality=compute_location_quality(location_text),
        age_hint=age_hint,
        dedup_key=dedup_key,
    )
