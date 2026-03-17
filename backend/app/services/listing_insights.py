from __future__ import annotations

import logging
import math
from collections import defaultdict
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from statistics import median

from sqlalchemy.orm import Session

from app.models.listing import Listing, ListingRisk, ListingValuation
from app.models.listing_snapshot import ListingSnapshot
from app.services.scoring import tokenize

logger = logging.getLogger(__name__)

MARKETPLACE_NOISE = {
    "sale",
    "selling",
    "seller",
    "pickup",
    "delivery",
    "available",
    "condition",
    "used",
    "new",
    "best",
    "great",
    "good",
    "excellent",
    "marketplace",
    "facebook",
    "kijiji",
    "ebay",
}

SUSPICIOUS_KEYWORDS = [
    "deposit",
    "wire transfer",
    "gift card",
    "crypto only",
    "shipping only",
    "zelle",
    "cashapp",
    "must sell fast",
    "urgent sale",
]

DEFAULT_VALUATION_LOOKBACK_DAYS = 120
DEFAULT_VALUATION_MIN_SAMPLES = 5
DEFAULT_VALUATION_MAX_NOISE_RATIO = 0.9


@dataclass
class ValuationStats:
    sample_count: int
    median_price: float
    q1: float
    q3: float
    iqr: float
    confidence: float
    insufficient_reason: str | None = None


def listing_key(item: Listing) -> str:
    return f"{item.source}:{item.source_listing_id or item.url}"


def listing_fingerprint(item: Listing) -> str:
    base = item.source_listing_id or item.url or item.title
    return f"{item.source}:{base}"


def valuation_key_for_listing(query: str, item: Listing) -> str:
    tokens: list[str] = []
    seen: set[str] = set()

    for token in tokenize(query) + tokenize(item.title or ""):
        if token in MARKETPLACE_NOISE:
            continue
        if token in seen:
            continue
        seen.add(token)
        tokens.append(token)
        if len(tokens) >= 6:
            break

    if not tokens:
        fallback = tokenize(item.title or "")[:3]
        tokens.extend(fallback)

    return "|".join(tokens) if tokens else "marketly|general"


def _quantile(sorted_values: list[float], q: float) -> float:
    if not sorted_values:
        return 0.0
    if len(sorted_values) == 1:
        return float(sorted_values[0])

    position = (len(sorted_values) - 1) * q
    lower_index = int(math.floor(position))
    upper_index = int(math.ceil(position))
    if lower_index == upper_index:
        return float(sorted_values[lower_index])

    lower = sorted_values[lower_index]
    upper = sorted_values[upper_index]
    weight = position - lower_index
    return float(lower + (upper - lower) * weight)


def _compute_valuation_stats(prices: list[float]) -> ValuationStats | None:
    clean_prices = sorted(float(price) for price in prices if price is not None and price > 0)
    if len(clean_prices) < DEFAULT_VALUATION_MIN_SAMPLES:
        return None

    med = float(median(clean_prices))
    if med <= 0:
        return None

    q1 = _quantile(clean_prices, 0.25)
    q3 = _quantile(clean_prices, 0.75)
    if q3 < q1:
        q1, q3 = q3, q1
    iqr = max(0.0, q3 - q1)
    spread_ratio = iqr / med if med else 1.0
    if spread_ratio > DEFAULT_VALUATION_MAX_NOISE_RATIO:
        return ValuationStats(
            sample_count=len(clean_prices),
            median_price=med,
            q1=q1,
            q3=q3,
            iqr=iqr,
            confidence=0.0,
            insufficient_reason="Market prices vary too widely for a confident estimate.",
        )

    sample_factor = min(1.0, len(clean_prices) / 14.0)
    spread_factor = max(0.0, 1.0 - (spread_ratio / DEFAULT_VALUATION_MAX_NOISE_RATIO))
    confidence = round(min(0.97, 0.35 + (sample_factor * 0.4) + (spread_factor * 0.25)), 2)
    return ValuationStats(
        sample_count=len(clean_prices),
        median_price=med,
        q1=q1,
        q3=q3,
        iqr=iqr,
        confidence=confidence,
    )


def load_valuation_stats(
    db: Session,
    valuation_keys: list[str],
    *,
    lookback_days: int = DEFAULT_VALUATION_LOOKBACK_DAYS,
) -> dict[str, ValuationStats]:
    keys = [key for key in valuation_keys if key]
    if not keys:
        return {}

    cutoff = datetime.now(timezone.utc) - timedelta(days=lookback_days)
    try:
        rows = (
            db.query(ListingSnapshot)
            .filter(ListingSnapshot.valuation_key.in_(keys))
            .filter(ListingSnapshot.price_amount.isnot(None))
            .filter(ListingSnapshot.price_amount > 0)
            .filter(ListingSnapshot.observed_at >= cutoff)
            .order_by(ListingSnapshot.observed_at.desc())
            .all()
        )
    except Exception as exc:
        logger.warning("listing valuation lookup failed: %s", exc)
        return {}

    grouped: dict[str, list[float]] = defaultdict(list)
    for row in rows:
        if row.price_amount is None:
            continue
        grouped[row.valuation_key].append(float(row.price_amount))

    stats: dict[str, ValuationStats] = {}
    for key, prices in grouped.items():
        computed = _compute_valuation_stats(prices[:80])
        if computed is not None:
            stats[key] = computed
    return stats


def build_listing_valuation(
    item: Listing,
    stats: ValuationStats | None,
) -> ListingValuation:
    currency = (item.price.currency if item.price else "CAD") or "CAD"
    if stats is None:
        return ListingValuation(
            verdict="insufficient_data",
            currency=currency,
            explanation="Not enough comparable historical listings yet.",
        )

    if stats.insufficient_reason:
        return ListingValuation(
            verdict="insufficient_data",
            estimated_low=round(stats.q1, 2),
            estimated_high=round(stats.q3, 2),
            median_price=round(stats.median_price, 2),
            currency=currency,
            confidence=stats.confidence,
            sample_count=stats.sample_count,
            explanation=stats.insufficient_reason,
        )

    estimated_low = stats.q1 if stats.q1 > 0 else max(0.0, stats.median_price * 0.9)
    estimated_high = stats.q3 if stats.q3 > 0 else max(estimated_low, stats.median_price * 1.1)
    if estimated_high < estimated_low:
        estimated_high = estimated_low

    verdict = "insufficient_data"
    explanation = "Comparable pricing history is available."

    if item.price is not None:
        current_price = float(item.price.amount)
        if current_price < estimated_low * 0.92:
            verdict = "underpriced"
            explanation = f"Price is below the recent market band (median {currency} {stats.median_price:.0f})."
        elif current_price > estimated_high * 1.08:
            verdict = "overpriced"
            explanation = f"Price is above the recent market band (median {currency} {stats.median_price:.0f})."
        else:
            verdict = "fair"
            explanation = f"Price falls within the recent market band from similar listings."

    return ListingValuation(
        verdict=verdict,
        estimated_low=round(estimated_low, 2),
        estimated_high=round(estimated_high, 2),
        median_price=round(stats.median_price, 2),
        currency=currency,
        confidence=stats.confidence,
        sample_count=stats.sample_count,
        explanation=explanation,
    )


def build_listing_risk(item: Listing) -> ListingRisk:
    signals: list[tuple[str, float]] = []
    searchable_text = " ".join(part for part in [item.title, item.snippet or ""] if part).lower()

    for keyword in SUSPICIOUS_KEYWORDS:
        if keyword in searchable_text:
            signals.append((f"Contains suspicious sales language: '{keyword}'.", 0.32))
            break

    if not item.image_urls:
        signals.append(("Listing has no images.", 0.18))

    if not item.location:
        signals.append(("Location details are missing.", 0.14))

    descriptive_text = " ".join(part for part in [item.title, item.snippet or ""] if part).strip()
    if len(descriptive_text) < 28:
        signals.append(("Listing description is very short.", 0.16))

    if item.price is not None and item.price.amount <= 0:
        signals.append(("Price is missing or looks unrealistic.", 0.12))

    if item.valuation is not None:
        if item.valuation.verdict == "underpriced" and item.valuation.confidence >= 0.55:
            signals.append(("Price is materially below recent market comps.", 0.38))
        elif item.valuation.verdict == "insufficient_data":
            signals.append(("Market value could not be estimated confidently.", 0.08))

    score = max(0.0, min(1.0, round(sum(weight for _, weight in signals), 2)))
    if score >= 0.65:
        level = "high"
    elif score >= 0.32:
        level = "medium"
    else:
        level = "low"

    reasons = [reason for reason, _ in signals[:3]]
    if not reasons:
        reasons = ["No major risk signals were detected."]

    return ListingRisk(
        level=level,
        score=score,
        reasons=reasons,
        explanation=reasons[0],
    )


def enrich_listings_with_insights(
    db: Session,
    query: str,
    listings: list[Listing],
) -> list[Listing]:
    if not listings:
        return listings

    valuation_keys = [valuation_key_for_listing(query, item) for item in listings]
    valuation_stats = load_valuation_stats(db, valuation_keys)

    for item, valuation_key in zip(listings, valuation_keys):
        item.valuation = build_listing_valuation(item, valuation_stats.get(valuation_key))
        item.risk = build_listing_risk(item)

    return listings
