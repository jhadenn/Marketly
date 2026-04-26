from sqlalchemy import Boolean, Column, Integer, String, DateTime, Text, func, Index, JSON, text
from sqlalchemy.orm import validates
from app.db import Base


class SavedSearch(Base):
    __tablename__ = "saved_searches"

    id = Column(Integer, primary_key=True)
    user_id = Column(String, nullable=True, index=True)

    query = Column(String, nullable=False)
    sources = Column(String, nullable=False)
    alerts_enabled = Column(Boolean, nullable=False, default=True, server_default=text("true"))
    last_alert_attempted_at = Column(DateTime(timezone=True), nullable=True)
    last_alert_checked_at = Column(DateTime(timezone=True), nullable=True)
    last_alert_baseline_version = Column(Integer, nullable=True)
    last_alert_result_count = Column(Integer, nullable=True)
    last_alert_notified_at = Column(DateTime(timezone=True), nullable=True)
    last_alert_error_code = Column(String, nullable=True)
    last_alert_error_message = Column(Text, nullable=True)
    last_alert_source_errors_json = Column(JSON, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    # OPTIONAL but recommended: prevent exact duplicates per user
    __table_args__ = (
        Index("ix_saved_searches_user_query_sources", "user_id", "query", "sources", unique=True),
    )

    @validates("user_id")
    def _coerce_user_id(self, key, value):
        if value is None:
            return None
        return str(value)
