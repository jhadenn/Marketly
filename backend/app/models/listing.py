from pydantic import BaseModel, HttpUrl, Field
from typing import Literal


Source = Literal["ebay", "kijiji"]


class Money(BaseModel):
    amount: float = Field(ge=0)
    currency: str = Field(default="CAD", min_length=3, max_length=3)


class Listing(BaseModel):
    source: Source
    source_listing_id: str
    title: str
    price: Money
    url: HttpUrl
    image_urls: list[HttpUrl] = []
    location: str | None = None
    condition: str | None = None
    snippet: str | None = None


class SearchResponse(BaseModel):
    query: str
    sources: list[Source]
    count: int
    results: list[Listing]
