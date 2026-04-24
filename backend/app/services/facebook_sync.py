from __future__ import annotations

import hashlib
import secrets
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

from sqlalchemy.orm import Session

from app.connectors.facebook_marketplace.errors import FacebookConnectorErrorCode
from app.core.config import settings
from app.models.facebook_sync_client import FacebookSyncClient
from app.models.facebook_sync_pairing_session import FacebookSyncPairingSession
from app.models.user_facebook_credential import UserFacebookCredential
from app.services.facebook_credentials import normalize_helper_label
from app.services.user_ids import normalize_user_id

STALE_REASON_HELPER_DISCONNECTED = "helper_disconnected"
STALE_REASON_COOKIE_EXPIRED = "cookie_expired"
STALE_REASON_COOKIE_EXPIRING_SOON = "cookie_expiring_soon"
STALE_REASON_FACEBOOK_SESSION_INVALID = "facebook_session_invalid"


def _now_utc() -> datetime:
    return datetime.now(timezone.utc)


def _as_utc(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def _hash_secret(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def _parse_bearer_token(authorization: str | None) -> str | None:
    if not authorization or not authorization.lower().startswith("bearer "):
        return None
    token = authorization.split(" ", 1)[1].strip()
    return token or None


@dataclass(frozen=True)
class FacebookCredentialState:
    effective_status: str | None
    helper_connected: bool
    helper_label: str | None
    stale_reason: str | None
    needs_verification: bool


def create_pairing_session(
    db: Session,
    *,
    user_id: object,
    helper_label: object | None = None,
) -> tuple[FacebookSyncPairingSession, str]:
    normalized_user_id = normalize_user_id(user_id)
    if not normalized_user_id:
        raise ValueError("user_id is required")

    db.query(FacebookSyncPairingSession).filter(
        FacebookSyncPairingSession.user_id == normalized_user_id
    ).delete(synchronize_session=False)

    now = _now_utc()
    pairing_code = secrets.token_urlsafe(18)
    row = FacebookSyncPairingSession(
        user_id=normalized_user_id,
        code_hash_sha256=_hash_secret(pairing_code),
        helper_label=normalize_helper_label(helper_label),
        expires_at=now
        + timedelta(seconds=max(60, int(settings.MARKETLY_FACEBOOK_HELPER_PAIRING_TTL_SECONDS))),
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return row, pairing_code


def redeem_pairing_code(
    db: Session,
    *,
    pairing_code: object,
) -> tuple[FacebookSyncClient, str]:
    normalized_code = str(pairing_code or "").strip()
    if not normalized_code:
        raise ValueError("Pairing code is required.")

    now = _now_utc()
    row = (
        db.query(FacebookSyncPairingSession)
        .filter(FacebookSyncPairingSession.code_hash_sha256 == _hash_secret(normalized_code))
        .first()
    )
    if row is None or row.claimed_at is not None or _as_utc(row.expires_at) is None:
        raise LookupError("Pairing code is invalid or expired.")
    if _as_utc(row.expires_at) <= now:
        raise LookupError("Pairing code is invalid or expired.")

    db.query(FacebookSyncClient).filter(
        FacebookSyncClient.user_id == row.user_id,
        FacebookSyncClient.revoked_at.is_(None),
    ).update({"revoked_at": now}, synchronize_session=False)

    helper_token = secrets.token_urlsafe(48)
    client = FacebookSyncClient(
        user_id=row.user_id,
        token_hash_sha256=_hash_secret(helper_token),
        helper_label=row.helper_label,
        last_seen_at=now,
    )
    row.claimed_at = now
    db.add(client)
    db.commit()
    db.refresh(client)
    return client, helper_token


def get_sync_client_for_token(
    db: Session,
    *,
    token: str | None,
) -> FacebookSyncClient | None:
    normalized_token = (token or "").strip()
    if not normalized_token:
        return None
    return (
        db.query(FacebookSyncClient)
        .filter(
            FacebookSyncClient.token_hash_sha256 == _hash_secret(normalized_token),
            FacebookSyncClient.revoked_at.is_(None),
        )
        .first()
    )


def get_sync_client_from_authorization(
    db: Session,
    authorization: str | None,
) -> FacebookSyncClient | None:
    return get_sync_client_for_token(db, token=_parse_bearer_token(authorization))


def touch_sync_client(db: Session, client: FacebookSyncClient, *, commit: bool = True) -> None:
    client.last_seen_at = _now_utc()
    if commit:
        db.commit()


def latest_active_sync_client(db: Session, user_id: object | None) -> FacebookSyncClient | None:
    if not hasattr(db, "query"):
        return None
    normalized_user_id = normalize_user_id(user_id)
    if not normalized_user_id:
        return None
    return (
        db.query(FacebookSyncClient)
        .filter(
            FacebookSyncClient.user_id == normalized_user_id,
            FacebookSyncClient.revoked_at.is_(None),
        )
        .order_by(FacebookSyncClient.created_at.desc(), FacebookSyncClient.id.desc())
        .first()
    )


def revoke_helper_access_for_user(db: Session, user_id: object | None, *, commit: bool = True) -> int:
    if not hasattr(db, "query"):
        return 0
    normalized_user_id = normalize_user_id(user_id)
    if not normalized_user_id:
        return 0
    now = _now_utc()
    revoked = (
        db.query(FacebookSyncClient)
        .filter(
            FacebookSyncClient.user_id == normalized_user_id,
            FacebookSyncClient.revoked_at.is_(None),
        )
        .update({"revoked_at": now}, synchronize_session=False)
    )
    db.query(FacebookSyncPairingSession).filter(
        FacebookSyncPairingSession.user_id == normalized_user_id
    ).delete(synchronize_session=False)
    if commit:
        db.commit()
    return int(revoked or 0)


def facebook_credential_state(
    db: Session,
    row: UserFacebookCredential | None,
    *,
    user_id: object | None = None,
    now: datetime | None = None,
) -> FacebookCredentialState:
    effective_now = _as_utc(now) or _now_utc()
    resolved_user_id = normalize_user_id(user_id) or normalize_user_id(getattr(row, "user_id", None))
    active_client = latest_active_sync_client(db, resolved_user_id)

    helper_connected = False
    helper_label = None
    if active_client is not None:
        helper_label = active_client.helper_label
        last_seen_at = _as_utc(active_client.last_seen_at)
        if (
            last_seen_at is not None
            and last_seen_at
            > effective_now - timedelta(seconds=max(60, int(settings.MARKETLY_FACEBOOK_HELPER_STALE_AFTER_SECONDS)))
        ):
            helper_connected = True

    if row is None:
        return FacebookCredentialState(
            effective_status=None,
            helper_connected=helper_connected,
            helper_label=helper_label,
            stale_reason=None,
            needs_verification=False,
        )

    stale_reason: str | None = None
    earliest_cookie_expiry_at = _as_utc(getattr(row, "earliest_cookie_expiry_at", None))
    status = str(getattr(row, "status", "") or "").strip().lower()
    last_error_code = str(getattr(row, "last_error_code", "") or "").strip().lower()
    credential_source = str(getattr(row, "credential_source", "") or "").strip().lower()

    if credential_source == "browser_helper" and not helper_connected:
        stale_reason = STALE_REASON_HELPER_DISCONNECTED

    stale_window = timedelta(
        seconds=max(60, int(settings.MARKETLY_FACEBOOK_COOKIE_EXPIRY_STALE_WINDOW_SECONDS))
    )
    if stale_reason is None and earliest_cookie_expiry_at is not None:
        if earliest_cookie_expiry_at <= effective_now:
            stale_reason = STALE_REASON_COOKIE_EXPIRED
        elif earliest_cookie_expiry_at <= effective_now + stale_window:
            stale_reason = STALE_REASON_COOKIE_EXPIRING_SOON

    if stale_reason is None and status == "verification_failed" and last_error_code in {
        FacebookConnectorErrorCode.login_wall.value,
        FacebookConnectorErrorCode.checkpoint.value,
    }:
        stale_reason = STALE_REASON_FACEBOOK_SESSION_INVALID

    last_validated_at = _as_utc(getattr(row, "last_validated_at", None))
    verify_age = timedelta(seconds=max(300, int(settings.MARKETLY_FACEBOOK_VERIFY_MAX_AGE_SECONDS)))
    needs_verification = last_validated_at is None or last_validated_at <= effective_now - verify_age

    return FacebookCredentialState(
        effective_status="stale" if stale_reason else (status or "active"),
        helper_connected=helper_connected,
        helper_label=helper_label or getattr(row, "helper_label", None),
        stale_reason=stale_reason,
        needs_verification=needs_verification,
    )
