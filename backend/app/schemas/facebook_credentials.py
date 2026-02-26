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
    last_error_code: str | None = None
    last_error_message: str | None = None
    last_validated_at: str | None = None
    last_used_at: str | None = None
    updated_at: str | None = None


class FacebookVerifyResponse(BaseModel):
    ok: bool = Field(default=False)
    status: FacebookConnectorStatusResponse
    error_code: str | None = None
    error_message: str | None = None
