from typing import List, Literal, Optional

from pydantic import BaseModel, Field


Source = Literal["ebay", "kijiji", "facebook"]
SearchSort = Literal["relevance", "price_asc", "price_desc", "newest"]


class Money(BaseModel):
    amount: float = Field(ge=0)
    currency: str = Field(default="CAD", min_length=3, max_length=3)


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
