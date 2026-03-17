from pydantic import BaseModel, Field

from app.models.listing import ListingRisk, ListingValuation, Money


class CopilotListingContext(BaseModel):
    listing_key: str
    source: str
    source_listing_id: str
    title: str
    price: Money | None = None
    location: str | None = None
    snippet: str | None = None
    score: float | None = None
    valuation: ListingValuation | None = None
    risk: ListingRisk | None = None


class CopilotQueryRequest(BaseModel):
    query: str = Field(min_length=1, max_length=200)
    user_question: str = Field(min_length=1, max_length=500)
    listings: list[CopilotListingContext] = Field(default_factory=list, max_length=25)


class CopilotShortlistItem(BaseModel):
    listing_key: str
    title: str
    reason: str


class CopilotQueryResponse(BaseModel):
    available: bool = True
    answer: str
    shortlist: list[CopilotShortlistItem] = Field(default_factory=list)
    seller_questions: list[str] = Field(default_factory=list)
    red_flags: list[str] = Field(default_factory=list)
    error_message: str | None = None
