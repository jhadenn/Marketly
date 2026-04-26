from typing import Any

from pydantic import BaseModel, Field, model_validator

from app.models.listing import ListingRisk, ListingValuation, Money, SourceError


_MARKETPLACE_LOGO_IMAGE_MARKERS = (
    "/marketplaces/",
    "facebook_logo",
    "kijiji_logo",
    "ebay_logo",
)


def _clean_image_url(value: object) -> str | None:
    if not isinstance(value, str):
        return None
    cleaned = value.strip()
    if any(marker in cleaned.lower() for marker in _MARKETPLACE_LOGO_IMAGE_MARKERS):
        return None
    return cleaned or None


def _first_image_url(value: object) -> str | None:
    if not isinstance(value, list):
        return None
    for url in value:
        cleaned = _clean_image_url(url)
        if cleaned:
            return cleaned
    return None


class NotificationItem(BaseModel):
    listing_key: str
    source: str
    source_listing_id: str
    title: str
    url: str
    image_url: str | None = None
    price: Money | None = None
    location: str | None = None
    match_confidence: float = Field(ge=0.0, le=1.0)
    why_matched: list[str] = Field(default_factory=list)
    valuation: ListingValuation | None = None
    risk: ListingRisk | None = None

    @model_validator(mode="before")
    @classmethod
    def populate_image_url(cls, data: Any) -> Any:
        if not isinstance(data, dict):
            return data

        image_url = _clean_image_url(data.get("image_url"))
        if image_url:
            return {**data, "image_url": image_url}

        legacy_image_url = _first_image_url(data.get("image_urls"))
        if legacy_image_url:
            return {**data, "image_url": legacy_image_url}

        return data


class SavedSearchNotificationOut(BaseModel):
    id: int
    saved_search_id: int
    saved_search_query: str
    summary: str
    new_count: int = Field(ge=0)
    created_at: str
    read_at: str | None = None
    items: list[NotificationItem] = Field(default_factory=list)
    source_errors: dict[str, SourceError] = Field(default_factory=dict)
