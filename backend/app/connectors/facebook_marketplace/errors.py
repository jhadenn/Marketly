from __future__ import annotations

from enum import Enum
from typing import Any

from pydantic import BaseModel, Field


class FacebookConnectorErrorCode(str, Enum):
    disabled = "disabled"
    login_wall = "login_wall"
    checkpoint = "checkpoint"
    blocked = "blocked"
    empty_results = "empty_results"
    timeout = "timeout"
    cookies_missing = "cookies_missing"
    cookies_invalid = "cookies_invalid"
    playwright_unavailable = "playwright_unavailable"
    scrape_failed = "scrape_failed"
    ingestion_failed = "ingestion_failed"


class FacebookConnectorErrorPayload(BaseModel):
    code: FacebookConnectorErrorCode
    message: str
    retryable: bool = False
    details: dict[str, Any] = Field(default_factory=dict)


class FacebookConnectorError(Exception):
    def __init__(
        self,
        code: FacebookConnectorErrorCode,
        message: str,
        *,
        retryable: bool = False,
        details: dict[str, Any] | None = None,
    ) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.retryable = retryable
        self.details = details or {}

    def to_payload(self) -> FacebookConnectorErrorPayload:
        return FacebookConnectorErrorPayload(
            code=self.code,
            message=self.message,
            retryable=self.retryable,
            details=self.details,
        )
