from typing import List, Literal, Optional

from pydantic import BaseModel, Field


Source = Literal["ebay", "kijiji", "facebook"]
SearchSort = Literal["relevance", "price_asc", "price_desc", "newest"]
ValuationVerdict = Literal["underpriced", "fair", "overpriced", "insufficient_data"]
ValuationEstimateSource = Literal[
    "historical_exact",
    "historical_relaxed",
    "live_cohort",
    "category_prior",
    "none",
]
ValuationConfidenceLabel = Literal["high", "medium", "low"]
RiskLevel = Literal["low", "medium", "high"]


class Money(BaseModel):
    amount: float = Field(ge=0)
    currency: str = Field(default="CAD", min_length=3, max_length=3)


class ListingValuation(BaseModel):
    verdict: ValuationVerdict = "insufficient_data"
    estimated_low: Optional[float] = Field(default=None, ge=0)
    estimated_high: Optional[float] = Field(default=None, ge=0)
    median_price: Optional[float] = Field(default=None, ge=0)
    currency: str = Field(default="CAD", min_length=3, max_length=3)
    confidence: float = Field(default=0.0, ge=0.0, le=1.0)
    confidence_label: ValuationConfidenceLabel = "low"
    sample_count: int = Field(default=0, ge=0)
    estimate_source: ValuationEstimateSource = "none"
    explanation: Optional[str] = None


class ListingRisk(BaseModel):
    level: RiskLevel = "low"
    score: float = Field(default=0.0, ge=0.0, le=1.0)
    reasons: list[str] = Field(default_factory=list)
    explanation: Optional[str] = None


class Listing(BaseModel):
    source: str
    source_listing_id: str
    title: str
    price: Optional[Money] = None
    url: str
    image_urls: List[str] = []
    location: Optional[str] = None
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    condition: Optional[str] = None
    snippet: Optional[str] = None

    # Ranking metadata
    score: float = Field(default=0.0, description="Relevance score (higher is better)")
    score_reason: Optional[str] = Field(default=None, description="Debug string explaining score")
    valuation: Optional[ListingValuation] = None
    risk: Optional[ListingRisk] = None


class SourceError(BaseModel):
    code: str
    message: str
    retryable: bool = False


class SearchResponse(BaseModel):
    query: str
    sources: list[Source]
    count: int
    results: list[Listing]
    next_offset: Optional[int] = None
    total: Optional[int] = None
    source_errors: dict[str, SourceError] = Field(default_factory=dict)
