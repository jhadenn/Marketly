from sqlalchemy import Column, Integer, String, DateTime, func, Index
from app.db import Base

class SavedSearch(Base):
    __tablename__ = "saved_searches"

    id = Column(Integer, primary_key=True)
    user_id = Column(String, nullable=True, index=True)

    query = Column(String, nullable=False)
    sources = Column(String, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    # OPTIONAL but recommended: prevent exact duplicates per user
    __table_args__ = (
        Index("ix_saved_searches_user_query_sources", "user_id", "query", "sources", unique=True),
    )