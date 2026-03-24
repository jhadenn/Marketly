from __future__ import annotations

import re
from datetime import datetime, timedelta, timezone

RELATIVE_AGE_RE = re.compile(
    r"\b(?P<count>\d+)\s+"
    r"(?P<unit>minute|hour|day|week|month|year)s?\s+ago\b",
    re.IGNORECASE,
)
ABSOLUTE_DATE_PATTERNS = (
    "%Y-%m-%d",
    "%Y/%m/%d",
    "%b %d, %Y",
    "%B %d, %Y",
)


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def ensure_utc(dt: datetime) -> datetime:
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def to_utc_iso(dt: datetime | None) -> str | None:
    if dt is None:
        return None
    return ensure_utc(dt).isoformat().replace("+00:00", "Z")


def parse_iso_datetime(value: str | None) -> datetime | None:
    if not value:
        return None

    cleaned = value.strip()
    if not cleaned:
        return None

    if cleaned.endswith("Z"):
        cleaned = f"{cleaned[:-1]}+00:00"

    try:
        parsed = datetime.fromisoformat(cleaned)
    except ValueError:
        return None
    return ensure_utc(parsed)


def normalize_timestamp_to_utc_iso(value: str | None) -> str | None:
    parsed = parse_iso_datetime(value)
    if parsed is None:
        return None
    return to_utc_iso(parsed)


def parse_relative_age_to_datetime(
    value: str | None,
    *,
    now: datetime | None = None,
) -> datetime | None:
    if not value:
        return None

    cleaned = value.strip()
    if not cleaned:
        return None

    normalized = cleaned.lower()
    base_now = ensure_utc(now or _utc_now())
    if normalized == "just listed":
        return base_now
    if normalized == "yesterday":
        return base_now - timedelta(days=1)
    if normalized == "today":
        return base_now

    match = RELATIVE_AGE_RE.search(cleaned)
    if not match:
        return None

    count = int(match.group("count"))
    unit = str(match.group("unit")).lower()
    if unit == "minute":
        delta = timedelta(minutes=count)
    elif unit == "hour":
        delta = timedelta(hours=count)
    elif unit == "day":
        delta = timedelta(days=count)
    elif unit == "week":
        delta = timedelta(weeks=count)
    elif unit == "month":
        delta = timedelta(days=30 * count)
    else:
        delta = timedelta(days=365 * count)
    return base_now - delta


def parse_relative_age_to_utc_iso(
    value: str | None,
    *,
    now: datetime | None = None,
) -> str | None:
    return to_utc_iso(parse_relative_age_to_datetime(value, now=now))


def parse_absolute_date_to_utc_iso(
    value: str | None,
    *,
    now: datetime | None = None,
) -> str | None:
    if not value:
        return None

    cleaned = value.strip()
    if not cleaned:
        return None

    for pattern in ABSOLUTE_DATE_PATTERNS:
        try:
            parsed = datetime.strptime(cleaned, pattern)
        except ValueError:
            continue
        base_now = ensure_utc(now or _utc_now())
        parsed = parsed.replace(
            hour=base_now.hour,
            minute=base_now.minute,
            second=base_now.second,
            microsecond=base_now.microsecond,
            tzinfo=timezone.utc,
        )
        return to_utc_iso(parsed)
    return None
