from __future__ import annotations

import hashlib
import json
import math
from datetime import datetime, timezone
from typing import Any

from sqlalchemy.orm import Session

try:
    from cryptography.fernet import Fernet, InvalidToken
except Exception:  # pragma: no cover - local dev env may be partially provisioned
    Fernet = None

    class InvalidToken(Exception):
        pass

from app.connectors.facebook_marketplace import FacebookConnectorError, FacebookConnectorErrorCode
from app.connectors.facebook_marketplace.connector import sanitize_cookie_payload
from app.core.config import settings
from app.models.user_facebook_credential import UserFacebookCredential
from app.services.user_ids import normalize_user_id

MAX_COOKIE_JSON_BYTES = 256 * 1024
DEFAULT_HELPER_LABEL = "Browser Helper"
MAX_HELPER_LABEL_LENGTH = 120


def _now_utc() -> datetime:
    return datetime.now(timezone.utc)


def _canonical_json(payload: Any) -> str:
    return json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=True)


def _clean_helper_label(value: object | None) -> str:
    cleaned = " ".join(str(value or "").split()).strip()
    if not cleaned:
        return DEFAULT_HELPER_LABEL
    return cleaned[:MAX_HELPER_LABEL_LENGTH]


def _cookie_expiry_meta(sanitized: list[dict[str, Any]]) -> tuple[datetime | None, int]:
    earliest_expiry: datetime | None = None
    session_cookie_count = 0
    for cookie in sanitized:
        expires_value = cookie.get("expires")
        if expires_value in (None, "", 0, 0.0, -1, -1.0):
            session_cookie_count += 1
            continue
        try:
            expires_ts = float(expires_value)
        except (TypeError, ValueError):
            session_cookie_count += 1
            continue
        if not math.isfinite(expires_ts) or expires_ts <= 0:
            session_cookie_count += 1
            continue
        expires_at = datetime.fromtimestamp(expires_ts, tz=timezone.utc)
        if earliest_expiry is None or expires_at < earliest_expiry:
            earliest_expiry = expires_at
    return earliest_expiry, session_cookie_count


def _fernet():
    if Fernet is None:
        raise RuntimeError("cryptography is required for BYOC credential encryption.")
    key = (settings.MARKETLY_CREDENTIALS_ENCRYPTION_KEY or "").strip()
    if not key:
        raise RuntimeError(
            "MARKETLY_CREDENTIALS_ENCRYPTION_KEY is required for BYOC credential storage."
        )
    try:
        return Fernet(key.encode("utf-8"))
    except Exception as exc:  # pragma: no cover
        raise RuntimeError("Invalid MARKETLY_CREDENTIALS_ENCRYPTION_KEY (must be a Fernet key).") from exc


def parse_and_validate_cookie_payload(payload: Any) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    try:
        raw_canonical = _canonical_json(payload)
    except Exception as exc:
        raise FacebookConnectorError(
            FacebookConnectorErrorCode.cookies_invalid,
            "Cookie JSON must be valid JSON data.",
            retryable=False,
            details={"error": str(exc)},
        ) from exc

    raw_size = len(raw_canonical.encode("utf-8"))
    if raw_size > MAX_COOKIE_JSON_BYTES:
        raise FacebookConnectorError(
            FacebookConnectorErrorCode.cookies_invalid,
            "Cookie JSON is too large. Export only facebook.com cookies.",
            retryable=False,
            details={"size_bytes": raw_size, "max_bytes": MAX_COOKIE_JSON_BYTES},
        )

    sanitized, cookie_names = sanitize_cookie_payload(payload)
    names_set = set(cookie_names)
    missing_required = {"c_user", "xs"} - names_set
    if missing_required:
        raise FacebookConnectorError(
            FacebookConnectorErrorCode.cookies_invalid,
            "Cookie mode requires at least c_user and xs cookies. "
            f"Missing: {sorted(missing_required)}.",
            retryable=False,
            details={"cookie_count": len(sanitized)},
        )
    if len(sanitized) < 4:
        raise FacebookConnectorError(
            FacebookConnectorErrorCode.cookies_invalid,
            "Cookie file appears incomplete (too few cookies). "
            "Export the full facebook.com cookie jar, not only c_user/xs.",
            retryable=False,
            details={"cookie_count": len(sanitized)},
        )

    canonical_sanitized = _canonical_json(sanitized)
    fingerprint = hashlib.sha256(canonical_sanitized.encode("utf-8")).hexdigest()
    earliest_cookie_expiry_at, session_cookie_count = _cookie_expiry_meta(sanitized)
    return sanitized, {
        "cookie_count": len(sanitized),
        "cookie_names": sorted(names_set),
        "cookie_fingerprint_sha256": fingerprint,
        "canonical_sanitized_json": canonical_sanitized,
        "earliest_cookie_expiry_at": earliest_cookie_expiry_at,
        "session_cookie_count": session_cookie_count,
    }


def encrypt_cookie_payload(payload: Any) -> str:
    canonical = _canonical_json(payload)
    token = _fernet().encrypt(canonical.encode("utf-8"))
    return token.decode("utf-8")


def decrypt_cookie_payload(encrypted_token: str) -> Any:
    try:
        decrypted = _fernet().decrypt(encrypted_token.encode("utf-8"))
    except InvalidToken as exc:
        raise RuntimeError("Stored Facebook credential could not be decrypted.") from exc
    return json.loads(decrypted.decode("utf-8"))


def get_user_facebook_credential(db: Session, user_id: object | None) -> UserFacebookCredential | None:
    normalized_user_id = normalize_user_id(user_id)
    if not normalized_user_id:
        return None
    return (
        db.query(UserFacebookCredential)
        .filter(UserFacebookCredential.user_id == normalized_user_id)
        .first()
    )


def upsert_user_facebook_credential(
    db: Session,
    user_id: object,
    payload: Any,
    *,
    credential_source: str = "manual_upload",
    helper_label: str | None = None,
    synced_at: datetime | None = None,
) -> UserFacebookCredential:
    sanitized, meta = parse_and_validate_cookie_payload(payload)
    encrypted = encrypt_cookie_payload(sanitized)

    normalized_user_id = normalize_user_id(user_id)
    if not normalized_user_id:
        raise ValueError("user_id is required")

    row = get_user_facebook_credential(db, normalized_user_id)
    if row is None:
        row = UserFacebookCredential(user_id=normalized_user_id)
        db.add(row)

    effective_synced_at = synced_at if credential_source == "browser_helper" else None
    row.encrypted_cookie_json = encrypted
    row.cookie_fingerprint_sha256 = str(meta["cookie_fingerprint_sha256"])
    row.cookie_count = int(meta["cookie_count"])
    row.credential_source = (credential_source or "manual_upload").strip() or "manual_upload"
    row.session_cookie_count = int(meta["session_cookie_count"])
    row.status = "active"
    row.last_error_code = None
    row.last_error_message = None
    row.last_synced_at = effective_synced_at
    row.earliest_cookie_expiry_at = meta["earliest_cookie_expiry_at"]
    row.helper_label = _clean_helper_label(helper_label) if credential_source == "browser_helper" else None
    row.updated_at = _now_utc()
    db.commit()
    db.refresh(row)
    return row


def upsert_user_facebook_credential_from_helper(
    db: Session,
    user_id: object,
    payload: Any,
    *,
    helper_label: str | None = None,
) -> UserFacebookCredential:
    return upsert_user_facebook_credential(
        db,
        user_id,
        payload,
        credential_source="browser_helper",
        helper_label=helper_label,
        synced_at=_now_utc(),
    )


def delete_user_facebook_credential(db: Session, user_id: object | None) -> bool:
    row = get_user_facebook_credential(db, user_id)
    if row is None:
        return False
    db.delete(row)
    db.commit()
    return True


def mark_credential_used(db: Session, row: UserFacebookCredential, *, commit: bool = True) -> None:
    row.last_used_at = _now_utc()
    row.updated_at = _now_utc()
    if commit:
        db.commit()


def mark_credential_validated(
    db: Session, row: UserFacebookCredential, *, commit: bool = True
) -> None:
    now = _now_utc()
    row.status = "active"
    row.last_validated_at = now
    row.last_error_code = None
    row.last_error_message = None
    row.updated_at = now
    if commit:
        db.commit()


def mark_credential_failed(
    db: Session,
    row: UserFacebookCredential,
    *,
    error_code: str,
    error_message: str,
    commit: bool = True,
) -> None:
    clean_message = (error_message or "").strip()
    if len(clean_message) > 500:
        clean_message = clean_message[:500]
    row.status = "verification_failed"
    row.last_error_code = (error_code or "")[:100] or None
    row.last_error_message = clean_message or None
    row.updated_at = _now_utc()
    if commit:
        db.commit()


def normalize_helper_label(value: object | None) -> str:
    return _clean_helper_label(value)
