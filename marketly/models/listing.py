from datetime import datetime
from typing import Optional
from sqlmodel import Field, SQLModel


class Listing(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)

    platform: str = Field(index=True)              # e.g., "kijiji"
    title: str
    price_cents: Optional[int] = Field(default=None, index=True)
    currency: str = Field(default="CAD")

    location: Optional[str] = Field(default=None, index=True)
    url: str = Field(index=True, unique=True)

    first_seen: datetime = Field(default_factory=datetime.utcnow, index=True)
    last_seen: datetime = Field(default_factory=datetime.utcnow, index=True)
