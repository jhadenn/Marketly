from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field, model_validator

from app.connectors.facebook_marketplace.errors import FacebookConnectorErrorPayload

AuthMode = Literal["guest", "cookie"]
FacebookSort = Literal["relevance", "newest", "price_low_to_high", "price_high_to_low"]


class FacebookSearchRequest(BaseModel):
    query: str = Field(min_length=1, max_length=200)
    location_text: str | None = Field(default=None, max_length=200)
    latitude: float | None = Field(default=None, ge=-90, le=90)
    longitude: float | None = Field(default=None, ge=-180, le=180)
    radius_km: int | None = Field(default=None, ge=1, le=500)
    min_price: float | None = Field(default=None, ge=0)
    max_price: float | None = Field(default=None, ge=0)
    condition: str | None = Field(default=None, max_length=64)
    sort: FacebookSort = "relevance"
    limit: int = Field(default=25, ge=1, le=100)
    auth_mode: AuthMode = "guest"
    cookie_path: str = "secrets/fb_cookies.json"
    cookie_payload: Any | None = None
    ingest: bool = False

    @model_validator(mode="after")
    def validate_price_range(self) -> "FacebookSearchRequest":
        if (
            self.min_price is not None
            and self.max_price is not None
            and self.max_price < self.min_price
        ):
            raise ValueError("max_price must be greater than or equal to min_price")
        return self


class FacebookNormalizedListing(BaseModel):
    source: Literal["facebook"] = "facebook"
    external_id: str | None = None
    title: str
    price_value: float | None = None
    price_currency: str | None = None
    location_text: str | None = None
    latitude: float | None = None
    longitude: float | None = None
    image_urls: list[str] = Field(default_factory=list)
    listing_url: str
    seller_name: str | None = None
    posted_at: str | None = None
    raw: dict[str, Any] = Field(default_factory=dict)
    price_bucket: str | None = None
    title_keywords: list[str] = Field(default_factory=list)
    has_images: bool = False
    location_quality: float = Field(default=0.0, ge=0.0, le=1.0)
    age_hint: str | None = None
    dedup_key: str


class FacebookSearchResponse(BaseModel):
    query: str
    auth_mode: AuthMode
    count: int
    records: list[FacebookNormalizedListing] = Field(default_factory=list)
    upserted_count: int = 0
    error: FacebookConnectorErrorPayload | None = None
