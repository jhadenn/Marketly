from __future__ import annotations

from dataclasses import dataclass

from sqlalchemy.orm import Session

from app.connectors.facebook_marketplace import (
    FacebookConnectorError,
    FacebookConnectorErrorCode,
    FacebookMarketplaceConnector,
    FacebookSearchRequest,
)
from app.models.user_facebook_credential import UserFacebookCredential
from app.services.facebook_credentials import (
    decrypt_cookie_payload,
    mark_credential_failed,
    mark_credential_validated,
)
from app.services.facebook_sync import (
    STALE_REASON_COOKIE_EXPIRED,
    STALE_REASON_COOKIE_EXPIRING_SOON,
    STALE_REASON_FACEBOOK_SESSION_INVALID,
    STALE_REASON_HELPER_DISCONNECTED,
    facebook_credential_state,
)

verification_connector = FacebookMarketplaceConnector()


@dataclass
class FacebookCredentialVerificationOutcome:
    ok: bool
    cookie_payload: object | None = None
    error_code: str | None = None
    error_message: str | None = None


def _helper_recovery_message(row: UserFacebookCredential | None) -> str:
    source = str(getattr(row, "credential_source", "") or "").strip().lower()
    if source == "browser_helper":
        return (
            "Open Facebook in Chrome or Edge so the Marketly browser helper can resync, then try again."
        )
    return "Open Facebook, refresh the session, then verify or upload a fresh cookie export."


def _verification_failure_message(
    row: UserFacebookCredential | None,
    *,
    code: str | None,
    message: str,
    stale_reason: str | None,
) -> str:
    if stale_reason == STALE_REASON_HELPER_DISCONNECTED:
        return f"Facebook browser helper is disconnected or stale. {_helper_recovery_message(row)}"
    if stale_reason in {STALE_REASON_COOKIE_EXPIRED, STALE_REASON_COOKIE_EXPIRING_SOON}:
        return f"Facebook session cookies are stale. {_helper_recovery_message(row)}"
    if stale_reason == STALE_REASON_FACEBOOK_SESSION_INVALID:
        return f"Facebook session verification failed. {_helper_recovery_message(row)}"
    if code in {
        FacebookConnectorErrorCode.login_wall.value,
        FacebookConnectorErrorCode.checkpoint.value,
    }:
        return f"{message} {_helper_recovery_message(row)}"
    return message


async def verify_facebook_credential(
    db: Session,
    row: UserFacebookCredential | None,
) -> FacebookCredentialVerificationOutcome:
    if row is None:
        return FacebookCredentialVerificationOutcome(
            ok=False,
            error_code="BYOC_REQUIRED",
            error_message="Upload your Facebook cookies first.",
        )

    state = facebook_credential_state(db, row, user_id=row.user_id)
    try:
        cookie_payload = decrypt_cookie_payload(row.encrypted_cookie_json)
    except RuntimeError as exc:
        db.rollback()
        mark_credential_failed(
            db,
            row,
            error_code="decrypt_failed",
            error_message=str(exc),
            commit=True,
        )
        return FacebookCredentialVerificationOutcome(
            ok=False,
            error_code="decrypt_failed",
            error_message="Stored Facebook credential could not be decrypted.",
        )

    try:
        await verification_connector.search(
            FacebookSearchRequest(
                query="bicycle",
                limit=3,
                auth_mode="cookie",
                cookie_payload=cookie_payload,
                ingest=False,
            )
        )
    except FacebookConnectorError as exc:
        error_message = _verification_failure_message(
            row,
            code=exc.code.value,
            message=exc.message,
            stale_reason=state.stale_reason,
        )
        mark_credential_failed(
            db,
            row,
            error_code=exc.code.value,
            error_message=error_message,
            commit=True,
        )
        return FacebookCredentialVerificationOutcome(
            ok=False,
            error_code=exc.code.value,
            error_message=error_message,
        )
    except Exception:
        error_message = "Unexpected verification failure."
        mark_credential_failed(
            db,
            row,
            error_code=FacebookConnectorErrorCode.scrape_failed.value,
            error_message=error_message,
            commit=True,
        )
        return FacebookCredentialVerificationOutcome(
            ok=False,
            error_code=FacebookConnectorErrorCode.scrape_failed.value,
            error_message=error_message,
        )

    mark_credential_validated(db, row, commit=True)
    return FacebookCredentialVerificationOutcome(ok=True, cookie_payload=cookie_payload)


async def ensure_facebook_credential_ready(
    db: Session,
    row: UserFacebookCredential | None,
) -> FacebookCredentialVerificationOutcome:
    if row is None:
        return FacebookCredentialVerificationOutcome(
            ok=False,
            error_code="BYOC_REQUIRED",
            error_message="Upload your Facebook cookies first.",
        )

    state = facebook_credential_state(db, row, user_id=row.user_id)
    if state.stale_reason is not None or state.needs_verification:
        return await verify_facebook_credential(db, row)

    try:
        cookie_payload = decrypt_cookie_payload(row.encrypted_cookie_json)
    except RuntimeError as exc:
        db.rollback()
        mark_credential_failed(
            db,
            row,
            error_code="decrypt_failed",
            error_message=str(exc),
            commit=True,
        )
        return FacebookCredentialVerificationOutcome(
            ok=False,
            error_code="decrypt_failed",
            error_message="Stored Facebook credential could not be decrypted.",
        )

    return FacebookCredentialVerificationOutcome(ok=True, cookie_payload=cookie_payload)
