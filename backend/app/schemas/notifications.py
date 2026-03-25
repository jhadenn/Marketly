from pydantic import BaseModel, Field

from app.models.listing import ListingRisk, ListingValuation, Money


class NotificationItem(BaseModel):
    listing_key: str
    source: str
    source_listing_id: str
    title: str
    url: str
    price: Money | None = None
    location: str | None = None
    match_confidence: float = Field(ge=0.0, le=1.0)
    why_matched: list[str] = Field(default_factory=list)
    valuation: ListingValuation | None = None
    risk: ListingRisk | None = None


class SavedSearchNotificationOut(BaseModel):
    id: int
    saved_search_id: int
    saved_search_query: str
    summary: str
    new_count: int = Field(ge=0)
    created_at: str
    read_at: str | None = None
    items: list[NotificationItem] = Field(default_factory=list)
