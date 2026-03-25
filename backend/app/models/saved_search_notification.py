from sqlalchemy import Column, DateTime, Integer, JSON, String, Text, func

from app.db import Base


class SavedSearchNotification(Base):
    __tablename__ = "saved_search_notifications"

    id = Column(Integer, primary_key=True)
    user_id = Column(String, nullable=False, index=True)
    saved_search_id = Column(Integer, nullable=False, index=True)
    saved_search_query = Column(String, nullable=False)
    summary_text = Column(Text, nullable=False)
    items_json = Column(JSON, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False, index=True)
    read_at = Column(DateTime(timezone=True), nullable=True, index=True)
