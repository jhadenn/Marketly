from sqlalchemy import Column, DateTime, Integer, String, Text, func

from app.db import Base


class UserFacebookCredential(Base):
    __tablename__ = "user_facebook_credentials"

    id = Column(Integer, primary_key=True)
    user_id = Column(String, nullable=False, unique=True, index=True)
    encrypted_cookie_json = Column(Text, nullable=False)
    cookie_fingerprint_sha256 = Column(String(64), nullable=False)
    cookie_count = Column(Integer, nullable=False, default=0)
    status = Column(String, nullable=False, default="active")
    last_error_code = Column(String, nullable=True)
    last_error_message = Column(Text, nullable=True)
    last_validated_at = Column(DateTime(timezone=True), nullable=True)
    last_used_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )
