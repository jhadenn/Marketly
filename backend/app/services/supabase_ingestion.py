from __future__ import annotations

import logging

import httpx

from app.connectors.facebook_marketplace.models import FacebookNormalizedListing
from app.core.config import settings

logger = logging.getLogger(__name__)


def _supabase_rest_url(table: str) -> str:
    base = (settings.SUPABASE_URL or "").rstrip("/")
    return f"{base}/rest/v1/{table}"


def _supabase_api_key() -> str | None:
    return (
        getattr(settings, "SUPABASE_SERVICE_ROLE_KEY", None)
        or settings.SUPABASE_ANON_KEY
    )


async def upsert_facebook_records(records: list[FacebookNormalizedListing]) -> int:
    if not records:
        return 0

    if not settings.SUPABASE_URL:
        logger.warning("SUPABASE_URL not configured; skipping facebook ingestion")
        return 0

    api_key = _supabase_api_key()
    if not api_key:
        logger.warning("Supabase API key missing; skipping facebook ingestion")
        return 0

    table = getattr(settings, "SUPABASE_LISTINGS_TABLE", "listings")
    url = _supabase_rest_url(table)
    params = {
        "on_conflict": "dedup_key",
    }

    headers = {
        "apikey": api_key,
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
        "Prefer": "resolution=merge-duplicates,return=representation",
    }

    payload = [r.model_dump(mode="json", exclude_none=True) for r in records]

    async with httpx.AsyncClient(timeout=30) as client:
        response = await client.post(url, params=params, json=payload, headers=headers)

    if response.status_code >= 400:
        body = response.text[:600]
        raise RuntimeError(
            f"Supabase upsert failed ({response.status_code}): {body}"
        )

    inserted = response.json() if response.content else []
    inserted_count = len(inserted) if isinstance(inserted, list) else 0
    logger.info(
        "facebook_ingest_complete table=%s requested=%s upserted=%s",
        table,
        len(records),
        inserted_count,
    )
    return inserted_count
