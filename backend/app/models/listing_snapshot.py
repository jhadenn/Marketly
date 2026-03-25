from sqlalchemy import Column, DateTime, Float, Index, Integer, String, Text, func

from app.db import Base


class ListingSnapshot(Base):
    __tablename__ = "listing_snapshots"

    id = Column(Integer, primary_key=True)
    user_id = Column(String, nullable=True, index=True)
    saved_search_id = Column(Integer, nullable=True, index=True)
    source = Column(String, nullable=False, index=True)
    source_listing_id = Column(String, nullable=False)
    listing_fingerprint = Column(String(length=128), nullable=False, index=True)
    query = Column(String, nullable=False, index=True)
    title = Column(String, nullable=False)
    price_amount = Column(Float, nullable=True)
    price_currency = Column(String(length=3), nullable=True)
    location = Column(String, nullable=True)
    condition = Column(String, nullable=True)
    snippet = Column(Text, nullable=True)
    image_count = Column(Integer, nullable=False, default=0)
    url = Column(Text, nullable=False)
    valuation_key = Column(String(length=255), nullable=False, index=True)
    observed_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False, index=True)

    __table_args__ = (
        Index(
            "ix_listing_snapshots_saved_search_listing_observed",
            "saved_search_id",
            "listing_fingerprint",
            "observed_at",
        ),
        Index(
            "ix_listing_snapshots_valuation_key_observed",
            "valuation_key",
            "observed_at",
        ),
    )
