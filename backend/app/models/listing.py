from pydantic import BaseModel, HttpUrl, Field
from typing import Literal, Optional, List


Source = Literal["ebay", "kijiji"]


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
    condition: Optional[str] = None
    snippet: Optional[str] = None

    # NEW: ranking metadata
    score: float = Field(default=0.0, description="Relevance score (higher is better)")
    score_reason: Optional[str] = Field(default=None, description="Debug string explaining score")

class SearchResponse(BaseModel):
    query: str
    sources: list[Source]
    count: int
    results: list[Listing]
