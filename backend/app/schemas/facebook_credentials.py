from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field


class FacebookCookieUploadRequest(BaseModel):
    cookies_json: Any


class FacebookConnectorStatusResponse(BaseModel):
    configured: bool
    feature_enabled: bool
    status: str | None = None
    cookie_count: int | None = None
    credential_source: str | None = None
    session_cookie_count: int | None = None
    last_error_code: str | None = None
    last_error_message: str | None = None
    last_validated_at: str | None = None
    last_used_at: str | None = None
    last_synced_at: str | None = None
    earliest_cookie_expiry_at: str | None = None
    helper_connected: bool = False
    helper_label: str | None = None
    helper_last_seen_at: str | None = None
    stale_reason: str | None = None
    updated_at: str | None = None


class FacebookVerifyResponse(BaseModel):
    ok: bool = Field(default=False)
    status: FacebookConnectorStatusResponse
    error_code: str | None = None
    error_message: str | None = None


class FacebookHelperPairingCreateRequest(BaseModel):
    helper_label: str | None = Field(default="Browser Helper", max_length=120)


class FacebookHelperPairingSessionResponse(BaseModel):
    pairing_code: str
    helper_label: str
    expires_at: str


class FacebookHelperPairRequest(BaseModel):
    pairing_code: str = Field(min_length=1, max_length=200)


class FacebookHelperPairResponse(BaseModel):
    ok: bool = True
    helper_token: str
    helper_label: str


class FacebookHelperDeleteResponse(BaseModel):
    deleted: bool = True
    revoked_clients: int = 0


class FacebookIngestRequest(BaseModel):
    query: str = Field(min_length=1, max_length=500)
    items: list[dict[str, Any]] = Field(default_factory=list)


class FacebookIngestResponse(BaseModel):
    received: int
    ingested: int
