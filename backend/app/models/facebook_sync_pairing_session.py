from sqlalchemy import Column, DateTime, Integer, String, func

from app.db import Base


class FacebookSyncPairingSession(Base):
    __tablename__ = "facebook_sync_pairing_sessions"

    id = Column(Integer, primary_key=True)
    user_id = Column(String, nullable=False, index=True)
    code_hash_sha256 = Column(String(64), nullable=False, unique=True, index=True)
    helper_label = Column(String(120), nullable=False)
    expires_at = Column(DateTime(timezone=True), nullable=False)
    claimed_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
