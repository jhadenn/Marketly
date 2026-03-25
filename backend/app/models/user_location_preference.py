from sqlalchemy import Column, DateTime, Float, Integer, String, func

from app.db import Base


class UserLocationPreference(Base):
    __tablename__ = "user_location_preferences"

    id = Column(Integer, primary_key=True)
    user_id = Column(String, nullable=False, unique=True, index=True)
    display_name = Column(String(length=200), nullable=False)
    city = Column(String(length=120), nullable=False)
    province_code = Column(String(length=2), nullable=False)
    province_name = Column(String(length=80), nullable=False)
    country_code = Column(String(length=2), nullable=False, default="CA")
    latitude = Column(Float, nullable=False)
    longitude = Column(Float, nullable=False)
    mode = Column(String(length=16), nullable=False, default="manual")
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
