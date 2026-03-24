from __future__ import annotations

import logging
import math
import re
from collections import defaultdict
from dataclasses import dataclass, replace
from datetime import datetime, timedelta, timezone
from statistics import median

from sqlalchemy.orm import Session

from app.core.config import settings
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
DEFAULT_VALUATION_FALLBACK_MIN_SAMPLES = 3
DEFAULT_VALUATION_MAX_NOISE_RATIO = 0.9
DEFAULT_VALUATION_STRONG_CONFIDENCE = 0.55
DEFAULT_VALUATION_HISTORY_LIMIT = 400
DEFAULT_VALUATION_EXACT_SAMPLE_LIMIT = 80
DEFAULT_VALUATION_QUERY_TOKEN_LIMIT = 4
DEFAULT_VALUATION_TEXT_TOKEN_LIMIT = 12
DEFAULT_VALUATION_DB_QUERY_TOKEN_LIMIT = 2
DEFAULT_RELAXED_SHARED_TOKEN_MIN = 2
DEFAULT_LIVE_COHORT_VERDICT_MIN_SAMPLES = 5
DEFAULT_LIVE_COHORT_VERDICT_MIN_CONFIDENCE = 0.70
DEFAULT_LIVE_COHORT_UNDERPRICED_MULTIPLIER = 0.90
DEFAULT_LIVE_COHORT_OVERPRICED_MULTIPLIER = 1.10
DEVICE_FAMILY_MARKERS = {
    "galaxy",
    "google",
    "iphone",
    "ipad",
    "macbook",
    "pixel",
    "surface",
    "watch",
}
CARRIER_PATTERNS = (
    (r"\brogers\b", "carrier:rogers"),
    (r"\bbell\b", "carrier:bell"),
    (r"\btelus\b", "carrier:telus"),
    (r"\bfido\b", "carrier:fido"),
    (r"\bkoodo\b", "carrier:koodo"),
    (r"\bvirgin\b", "carrier:virgin"),
    (r"\bfreedom\b", "carrier:freedom"),
    (r"\bvideotron\b", "carrier:videotron"),
    (r"\bat&t\b|\batt\b", "carrier:att"),
    (r"\bverizon\b", "carrier:verizon"),
    (r"\bt-?mobile\b", "carrier:tmobile"),
    (r"\bsprint\b", "carrier:sprint"),
)
VARIANT_PATTERNS = (
    (r"\bpro\s*max\b", "pro max"),
    (r"\bplus\b", "plus"),
    (r"\bmini\b", "mini"),
    (r"\bultra\b", "ultra"),
    (r"\bpro\b", "pro"),
    (r"\bmax\b", "max"),
    (r"\bbase\b", "base"),
)


@dataclass
class ValuationStats:
    sample_count: int
    median_price: float
    q1: float
    q3: float
    iqr: float
    confidence: float
    insufficient_reason: str | None = None


@dataclass
class ComparableProfile:
    model_year: str | None
    variant: str | None
    storage: str | None
    lock_state: str | None
    condition_bucket: str | None


@dataclass
class SnapshotSample:
    valuation_key: str
    price: float
    query_tokens: frozenset[str]
    text_tokens: frozenset[str]
    normalized_condition: str | None
    comparable_profile: ComparableProfile


@dataclass
class ValuationCandidate:
    stats: ValuationStats
    estimate_source: str
    explanation: str
    verdict_allowed: bool


def listing_key(item: Listing) -> str:
    return f"{item.source}:{item.source_listing_id or item.url}"


def listing_fingerprint(item: Listing) -> str:
    base = item.source_listing_id or item.url or item.title
    return f"{item.source}:{base}"


def _dedupe_tokens(tokens: list[str], *, limit: int | None = None) -> list[str]:
    deduped: list[str] = []
    seen: set[str] = set()
    for token in tokens:
        if token in MARKETPLACE_NOISE or token in seen:
            continue
        seen.add(token)
        deduped.append(token)
        if limit is not None and len(deduped) >= limit:
            break
    return deduped


def _valuation_tokens(*parts: str | None, limit: int | None = None) -> list[str]:
    raw_tokens: list[str] = []
    for part in parts:
        raw_tokens.extend(tokenize(part or ""))
    return _dedupe_tokens(raw_tokens, limit=limit)


def _query_family_tokens(query: str) -> frozenset[str]:
    return frozenset(_valuation_tokens(query, limit=DEFAULT_VALUATION_QUERY_TOKEN_LIMIT))


def _listing_similarity_tokens(item: Listing) -> frozenset[str]:
    return frozenset(
        _valuation_tokens(
            item.title,
            item.snippet,
            limit=DEFAULT_VALUATION_TEXT_TOKEN_LIMIT,
        )
    )


def _normalized_condition(value: str | None) -> str | None:
    cleaned = " ".join((value or "").lower().split())
    if not cleaned:
        return None
    if any(marker in cleaned for marker in ("for parts", "not working", "broken", "damaged", "cracked", "as is", "as-is", "parts")):
        return "parts"
    if any(marker in cleaned for marker in ("refurb", "renewed", "remanufactured", "reconditioned", "certified")):
        return "refurbished"
    if any(marker in cleaned for marker in ("brand new", "sealed", "new in box", "new-in-box", "open box", "open-box")):
        return "new"
    if any(marker in cleaned for marker in ("used", "pre-owned", "pre owned", "very good", "good", "fair", "acceptable", "like new", "mint", "excellent")):
        return "used"
    return None


def _comparable_profile_text(*parts: str | None) -> str:
    return " ".join(part.strip() for part in parts if part and part.strip()).lower()


def _extract_model_year(text: str) -> str | None:
    years = set(re.findall(r"\b(19[5-9]\d|20[0-3]\d)\b", text))
    return next(iter(years)) if len(years) == 1 else None


def _extract_storage(text: str) -> str | None:
    if re.search(r"\b\d{2,4}(?:/\d{2,4})+\s*(?:gb|g|tb)\b", text):
        return None
    matches: set[str] = set()
    for amount, _ in re.findall(r"\b(\d{2,4})\s*(gb|g)\b", text):
        size = int(amount)
        if size in {32, 64, 128, 256, 512}:
            matches.add(f"{size}gb")
        elif size == 1024:
            matches.add("1tb")
    for amount in re.findall(r"\b([12])\s*tb\b", text):
        matches.add(f"{amount}tb")
    return next(iter(matches)) if len(matches) == 1 else None


def _extract_lock_state(text: str) -> str | None:
    if "unlocked" in text or "sim free" in text or "sim-free" in text:
        return "unlocked"
    if any(marker in text for marker in ("icloud locked", "activation lock", "bad esn", "blacklisted")):
        return "locked"

    carriers = {label for pattern, label in CARRIER_PATTERNS if re.search(pattern, text)}
    if len(carriers) == 1:
        return next(iter(carriers))

    if "locked" in text:
        return "locked"
    return None


def _extract_variant(
    text: str,
    *,
    storage: str | None,
    lock_state: str | None,
) -> str | None:
    for pattern, label in VARIANT_PATTERNS:
        if re.search(pattern, text):
            return label

    has_device_family = any(re.search(fr"\b{re.escape(marker)}\b", text) for marker in DEVICE_FAMILY_MARKERS)
    if has_device_family and (storage or lock_state) and re.search(r"\b\d{1,2}\b", text):
        return "base"
    return None


def comparable_profile_for_text(
    *,
    query: str | None,
    title: str | None,
    snippet: str | None,
    condition: str | None,
) -> ComparableProfile:
    combined_text = _comparable_profile_text(query, title, snippet, condition)
    storage = _extract_storage(combined_text)
    lock_state = _extract_lock_state(combined_text)
    return ComparableProfile(
        model_year=_extract_model_year(combined_text),
        variant=_extract_variant(combined_text, storage=storage, lock_state=lock_state),
        storage=storage,
        lock_state=lock_state,
        condition_bucket=_normalized_condition(_comparable_profile_text(condition, title, snippet)),
    )


def _profiles_compatible(left: ComparableProfile, right: ComparableProfile) -> bool:
    attributes = (
        (left.model_year, right.model_year),
        (left.variant, right.variant),
        (left.storage, right.storage),
        (left.lock_state, right.lock_state),
        (left.condition_bucket, right.condition_bucket),
    )
    return all(not left_value or not right_value or left_value == right_value for left_value, right_value in attributes)


def _hard_attribute_match_count(left: ComparableProfile, right: ComparableProfile) -> int:
    attributes = (
        (left.model_year, right.model_year),
        (left.variant, right.variant),
        (left.storage, right.storage),
        (left.lock_state, right.lock_state),
        (left.condition_bucket, right.condition_bucket),
    )
    return sum(1 for left_value, right_value in attributes if left_value and right_value and left_value == right_value)


def _apply_hard_match_bonus(stats: ValuationStats, match_counts: list[int]) -> ValuationStats:
    if not match_counts:
        return stats
    average_matches = sum(match_counts) / len(match_counts)
    bonus = 0.04 * min(1.0, average_matches / 3.0)
    if bonus <= 0:
        return stats
    return replace(stats, confidence=round(min(0.97, stats.confidence + bonus), 2))


def valuation_key_for_listing(query: str, item: Listing) -> str:
    tokens = _valuation_tokens(query, item.title, limit=6)
    if not tokens:
        tokens = _valuation_tokens(item.title, limit=3)
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


def _compute_valuation_stats(
    prices: list[float],
    *,
    min_samples: int = DEFAULT_VALUATION_MIN_SAMPLES,
) -> ValuationStats | None:
    clean_prices = sorted(float(price) for price in prices if price is not None and price > 0)
    if len(clean_prices) < min_samples:
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


def _snapshot_sample_from_row(row: ListingSnapshot) -> SnapshotSample | None:
    if row.price_amount is None or float(row.price_amount) <= 0:
        return None
    return SnapshotSample(
        valuation_key=row.valuation_key,
        price=float(row.price_amount),
        query_tokens=_query_family_tokens(row.query or ""),
        text_tokens=frozenset(
            _valuation_tokens(
                row.title,
                row.snippet,
                limit=DEFAULT_VALUATION_TEXT_TOKEN_LIMIT,
            )
        ),
        normalized_condition=_normalized_condition(row.condition),
        comparable_profile=comparable_profile_for_text(
            query=row.query,
            title=row.title,
            snippet=row.snippet,
            condition=row.condition,
        ),
    )


def _load_recent_snapshot_samples(
    db: Session,
    *,
    query: str,
    valuation_keys: list[str],
    lookback_days: int | None = None,
) -> tuple[dict[str, list[SnapshotSample]], list[SnapshotSample]]:
    effective_lookback_days = lookback_days if lookback_days is not None else settings.MARKETLY_VALUATION_LOOKBACK_DAYS
    cutoff = datetime.now(timezone.utc) - timedelta(days=effective_lookback_days)
    exact_samples: dict[str, list[SnapshotSample]] = defaultdict(list)
    family_samples: list[SnapshotSample] = []

    try:
        if valuation_keys:
            exact_rows = (
                db.query(ListingSnapshot)
                .filter(ListingSnapshot.valuation_key.in_(valuation_keys))
                .filter(ListingSnapshot.price_amount.isnot(None))
                .filter(ListingSnapshot.price_amount > 0)
                .filter(ListingSnapshot.observed_at >= cutoff)
                .order_by(ListingSnapshot.observed_at.desc())
                .all()
            )
            for row in exact_rows:
                sample = _snapshot_sample_from_row(row)
                if sample is not None:
                    exact_samples[row.valuation_key].append(sample)

        family_query = (
            db.query(ListingSnapshot)
            .filter(ListingSnapshot.price_amount.isnot(None))
            .filter(ListingSnapshot.price_amount > 0)
            .filter(ListingSnapshot.observed_at >= cutoff)
            .order_by(ListingSnapshot.observed_at.desc())
        )
        db_query_tokens = _valuation_tokens(query, limit=DEFAULT_VALUATION_DB_QUERY_TOKEN_LIMIT)
        if db_query_tokens:
            for token in db_query_tokens:
                family_query = family_query.filter(ListingSnapshot.query.ilike(f"%{token}%"))
        else:
            family_query = family_query.filter(ListingSnapshot.query == query)

        family_rows = family_query.limit(DEFAULT_VALUATION_HISTORY_LIMIT).all()
        if not family_rows and query:
            family_rows = (
                db.query(ListingSnapshot)
                .filter(ListingSnapshot.query == query)
                .filter(ListingSnapshot.price_amount.isnot(None))
                .filter(ListingSnapshot.price_amount > 0)
                .filter(ListingSnapshot.observed_at >= cutoff)
                .order_by(ListingSnapshot.observed_at.desc())
                .limit(DEFAULT_VALUATION_HISTORY_LIMIT)
                .all()
            )

        for row in family_rows:
            sample = _snapshot_sample_from_row(row)
            if sample is not None:
                family_samples.append(sample)
    except Exception as exc:
        logger.warning("listing valuation lookup failed: %s", exc)
        return {}, []

    return exact_samples, family_samples


def _shared_token_count(left: frozenset[str], right: frozenset[str]) -> int:
    return len(left.intersection(right))


def _same_query_family(snapshot_query_tokens: frozenset[str], query_tokens: frozenset[str]) -> bool:
    if not query_tokens:
        return True
    required_matches = 1 if len(query_tokens) == 1 else 2
    return len(snapshot_query_tokens.intersection(query_tokens)) >= min(required_matches, len(query_tokens))


def _estimate_band(stats: ValuationStats) -> tuple[float, float]:
    estimated_low = stats.q1 if stats.q1 > 0 else max(0.0, stats.median_price * 0.9)
    estimated_high = stats.q3 if stats.q3 > 0 else max(estimated_low, stats.median_price * 1.1)
    if estimated_high < estimated_low:
        estimated_high = estimated_low
    return estimated_low, estimated_high


def _confidence_label(confidence: float) -> str:
    if confidence >= 0.75:
        return "high"
    if confidence >= 0.45:
        return "medium"
    return "low"


def _historical_exact_candidate(
    valuation_key: str,
    exact_samples: dict[str, list[SnapshotSample]],
) -> ValuationCandidate | None:
    samples = exact_samples.get(valuation_key) or []
    stats = _compute_valuation_stats(
        [sample.price for sample in samples[:DEFAULT_VALUATION_EXACT_SAMPLE_LIMIT]],
        min_samples=DEFAULT_VALUATION_MIN_SAMPLES,
    )
    if stats is None:
        return None
    return ValuationCandidate(
        stats=stats,
        estimate_source="historical_exact",
        explanation="Comparable pricing history is available.",
        verdict_allowed=True,
    )


def _historical_relaxed_candidate(
    *,
    query_tokens: frozenset[str],
    listing_tokens: frozenset[str],
    comparable_profile: ComparableProfile,
    normalized_condition: str | None,
    family_samples: list[SnapshotSample],
) -> ValuationCandidate | None:
    matched_samples: list[SnapshotSample] = []
    condition_matches = 0
    hard_match_counts: list[int] = []

    for sample in family_samples:
        if not _same_query_family(sample.query_tokens, query_tokens):
            continue
        if _shared_token_count(listing_tokens, sample.text_tokens) < DEFAULT_RELAXED_SHARED_TOKEN_MIN:
            continue
        if not _profiles_compatible(comparable_profile, sample.comparable_profile):
            continue
        matched_samples.append(sample)
        hard_match_counts.append(_hard_attribute_match_count(comparable_profile, sample.comparable_profile))
        if normalized_condition and sample.normalized_condition == normalized_condition:
            condition_matches += 1

    stats = _compute_valuation_stats(
        [sample.price for sample in matched_samples],
        min_samples=DEFAULT_VALUATION_FALLBACK_MIN_SAMPLES,
    )
    if stats is None:
        return None

    stats = _apply_hard_match_bonus(stats, hard_match_counts)
    if normalized_condition and matched_samples:
        condition_bonus = 0.05 * (condition_matches / len(matched_samples))
        if condition_bonus > 0:
            stats = replace(stats, confidence=round(min(0.97, stats.confidence + condition_bonus), 2))

    return ValuationCandidate(
        stats=stats,
        estimate_source="historical_relaxed",
        explanation="Estimate from recent similar listings in this search family.",
        verdict_allowed=True,
    )


def _live_cohort_candidate(
    *,
    item: Listing,
    listing_tokens: frozenset[str],
    comparable_profile: ComparableProfile,
    listings: list[Listing],
    listing_tokens_by_key: dict[str, frozenset[str]],
    comparable_profiles_by_key: dict[str, ComparableProfile],
) -> ValuationCandidate | None:
    current_key = listing_key(item)
    prices: list[float] = []
    hard_match_counts: list[int] = []

    for peer in listings:
        if listing_key(peer) == current_key:
            continue
        if peer.price is None or float(peer.price.amount) <= 0:
            continue
        peer_tokens = listing_tokens_by_key.get(listing_key(peer), frozenset())
        if _shared_token_count(listing_tokens, peer_tokens) < DEFAULT_RELAXED_SHARED_TOKEN_MIN:
            continue
        peer_profile = comparable_profiles_by_key.get(listing_key(peer))
        if peer_profile is None or not _profiles_compatible(comparable_profile, peer_profile):
            continue
        prices.append(float(peer.price.amount))
        hard_match_counts.append(_hard_attribute_match_count(comparable_profile, peer_profile))

    stats = _compute_valuation_stats(prices, min_samples=DEFAULT_VALUATION_FALLBACK_MIN_SAMPLES)
    if stats is None:
        return None

    stats = _apply_hard_match_bonus(stats, hard_match_counts)
    verdict_allowed = (
        stats.insufficient_reason is None
        and stats.sample_count >= DEFAULT_LIVE_COHORT_VERDICT_MIN_SAMPLES
        and stats.confidence >= DEFAULT_LIVE_COHORT_VERDICT_MIN_CONFIDENCE
    )
    return ValuationCandidate(
        stats=stats,
        estimate_source="live_cohort",
        explanation=(
            "Estimate from comparable live listings in this result set."
            if verdict_allowed
            else "Rough estimate from similar live listings in this result set."
        ),
        verdict_allowed=verdict_allowed,
    )


def _category_prior_candidate(
    *,
    query_tokens: frozenset[str],
    listing_tokens: frozenset[str],
    family_samples: list[SnapshotSample],
) -> ValuationCandidate | None:
    prices: list[float] = []

    for sample in family_samples:
        if not _same_query_family(sample.query_tokens, query_tokens):
            continue
        if _shared_token_count(listing_tokens, sample.text_tokens) < 1:
            continue
        prices.append(sample.price)

    stats = _compute_valuation_stats(prices, min_samples=DEFAULT_VALUATION_FALLBACK_MIN_SAMPLES)
    if stats is None:
        return None

    return ValuationCandidate(
        stats=stats,
        estimate_source="category_prior",
        explanation="Rough estimate from broader recent listings in this category.",
        verdict_allowed=False,
    )


def _valuation_from_candidate(item: Listing, candidate: ValuationCandidate) -> ListingValuation:
    currency = (item.price.currency if item.price else "CAD") or "CAD"
    estimated_low, estimated_high = _estimate_band(candidate.stats)
    stats = candidate.stats
    explanation = candidate.explanation
    verdict = "insufficient_data"

    if candidate.estimate_source == "historical_exact" and stats.insufficient_reason:
        explanation = stats.insufficient_reason
    elif (
        candidate.verdict_allowed
        and stats.insufficient_reason is None
        and item.price is not None
        and float(item.price.amount) > 0
        and stats.confidence >= DEFAULT_VALUATION_STRONG_CONFIDENCE
    ):
        current_price = float(item.price.amount)
        if candidate.estimate_source == "historical_exact":
            if current_price < estimated_low * 0.92:
                verdict = "underpriced"
                explanation = (
                    f"Price is below the recent market band (median {currency} {stats.median_price:.0f})."
                )
            elif current_price > estimated_high * 1.08:
                verdict = "overpriced"
                explanation = (
                    f"Price is above the recent market band (median {currency} {stats.median_price:.0f})."
                )
            else:
                verdict = "fair"
                explanation = "Price falls within the recent market band from similar listings."
        elif candidate.estimate_source == "live_cohort":
            if current_price < estimated_low * DEFAULT_LIVE_COHORT_UNDERPRICED_MULTIPLIER:
                verdict = "underpriced"
                explanation = "Price sits below the live band from comparable current listings."
            elif current_price > estimated_high * DEFAULT_LIVE_COHORT_OVERPRICED_MULTIPLIER:
                verdict = "overpriced"
                explanation = "Price sits above the live band from comparable current listings."
            else:
                verdict = "fair"
                explanation = "Price sits within the live band from comparable current listings."
        else:
            if current_price < estimated_low * 0.92:
                verdict = "underpriced"
            elif current_price > estimated_high * 1.08:
                verdict = "overpriced"
            else:
                verdict = "fair"

    return ListingValuation(
        verdict=verdict,
        estimated_low=round(estimated_low, 2),
        estimated_high=round(estimated_high, 2),
        median_price=round(stats.median_price, 2),
        currency=currency,
        confidence=stats.confidence,
        confidence_label=_confidence_label(stats.confidence),
        sample_count=stats.sample_count,
        estimate_source=candidate.estimate_source,
        explanation=explanation,
    )


def build_listing_valuation(
    item: Listing,
    *,
    exact_candidate: ValuationCandidate | None,
    relaxed_candidate: ValuationCandidate | None,
    live_candidate: ValuationCandidate | None,
    category_candidate: ValuationCandidate | None,
) -> ListingValuation:
    candidates = [
        exact_candidate,
        relaxed_candidate,
        live_candidate,
        category_candidate,
    ]

    for candidate in candidates:
        if candidate is None:
            continue
        valuation = _valuation_from_candidate(item, candidate)
        if candidate.verdict_allowed and valuation.verdict != "insufficient_data":
            return valuation
        if candidate.estimate_source in {"historical_exact", "historical_relaxed"} and (
            candidate.stats.insufficient_reason is None
        ):
            return valuation
        if candidate.estimate_source in {"live_cohort", "category_prior"}:
            return valuation

    for candidate in candidates:
        if candidate is not None:
            return _valuation_from_candidate(item, candidate)

    currency = (item.price.currency if item.price else "CAD") or "CAD"
    return ListingValuation(
        verdict="insufficient_data",
        currency=currency,
        confidence=0.0,
        confidence_label="low",
        sample_count=0,
        estimate_source="none",
        explanation="Not enough comparable historical listings yet.",
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
    exact_samples, family_samples = _load_recent_snapshot_samples(
        db,
        query=query,
        valuation_keys=valuation_keys,
        lookback_days=settings.MARKETLY_VALUATION_LOOKBACK_DAYS,
    )
    query_tokens = _query_family_tokens(query)
    listing_tokens_by_key = {
        listing_key(item): _listing_similarity_tokens(item)
        for item in listings
    }
    comparable_profiles_by_key = {
        listing_key(item): comparable_profile_for_text(
            query=query,
            title=item.title,
            snippet=item.snippet,
            condition=item.condition,
        )
        for item in listings
    }

    for item, valuation_key in zip(listings, valuation_keys):
        current_listing_key = listing_key(item)
        current_listing_tokens = listing_tokens_by_key.get(current_listing_key, frozenset())
        current_comparable_profile = comparable_profiles_by_key.get(
            current_listing_key,
            comparable_profile_for_text(
                query=query,
                title=item.title,
                snippet=item.snippet,
                condition=item.condition,
            ),
        )
        normalized_condition = _normalized_condition(item.condition)
        exact_candidate = _historical_exact_candidate(valuation_key, exact_samples)
        relaxed_candidate = _historical_relaxed_candidate(
            query_tokens=query_tokens,
            listing_tokens=current_listing_tokens,
            comparable_profile=current_comparable_profile,
            normalized_condition=normalized_condition,
            family_samples=family_samples,
        )
        live_candidate = _live_cohort_candidate(
            item=item,
            listing_tokens=current_listing_tokens,
            comparable_profile=current_comparable_profile,
            listings=listings,
            listing_tokens_by_key=listing_tokens_by_key,
            comparable_profiles_by_key=comparable_profiles_by_key,
        )
        category_candidate = _category_prior_candidate(
            query_tokens=query_tokens,
            listing_tokens=current_listing_tokens,
            family_samples=family_samples,
        )

        item.valuation = build_listing_valuation(
            item,
            exact_candidate=exact_candidate,
            relaxed_candidate=relaxed_candidate,
            live_candidate=live_candidate,
            category_candidate=category_candidate,
        )
        item.risk = build_listing_risk(item)

    return listings
