from sqlalchemy import String, DateTime, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


class SavedSearch(Base):
    __tablename__ = "saved_searches"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    query: Mapped[str] = mapped_column(String(200), index=True)
    sources: Mapped[str] = mapped_column(String(200))  # store as "kijiji,ebay"
    created_at: Mapped[str] = mapped_column(DateTime(timezone=True), server_default=func.now())
