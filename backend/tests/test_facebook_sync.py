from datetime import datetime, timedelta, timezone

from app.models.facebook_sync_client import FacebookSyncClient
from app.models.user_facebook_credential import UserFacebookCredential
from app.services.facebook_sync import (
    STALE_REASON_COOKIE_EXPIRING_SOON,
    STALE_REASON_HELPER_DISCONNECTED,
    create_pairing_session,
    facebook_credential_state,
    redeem_pairing_code,
)

from .utils import build_test_session_factory


def test_create_pairing_session_and_redeem_revokes_previous_client():
    engine, session_factory = build_test_session_factory()
    db = session_factory()

    _, first_code = create_pairing_session(db, user_id="user-123", helper_label="Chrome helper")
    first_client, _ = redeem_pairing_code(db, pairing_code=first_code)

    _, second_code = create_pairing_session(db, user_id="user-123", helper_label="Edge helper")
    second_client, _ = redeem_pairing_code(db, pairing_code=second_code)

    db.refresh(first_client)
    db.refresh(second_client)

    assert first_client.revoked_at is not None
    assert second_client.revoked_at is None
    assert second_client.helper_label == "Edge helper"

    db.close()
    engine.dispose()


def test_facebook_credential_state_marks_browser_helper_as_disconnected_when_heartbeat_is_stale():
    engine, session_factory = build_test_session_factory()
    db = session_factory()
    now = datetime.now(timezone.utc)

    row = UserFacebookCredential(
        user_id="user-123",
        encrypted_cookie_json="encrypted",
        cookie_fingerprint_sha256="a" * 64,
        cookie_count=4,
        credential_source="browser_helper",
        session_cookie_count=2,
        status="active",
        last_validated_at=now,
        last_synced_at=now - timedelta(hours=2),
        helper_label="Chrome helper",
    )
    client = FacebookSyncClient(
        user_id="user-123",
        token_hash_sha256="b" * 64,
        helper_label="Chrome helper",
        last_seen_at=now - timedelta(hours=2),
    )
    db.add_all([row, client])
    db.commit()
    db.refresh(row)

    state = facebook_credential_state(db, row, user_id="user-123", now=now)

    assert state.helper_connected is False
    assert state.stale_reason == STALE_REASON_HELPER_DISCONNECTED
    assert state.effective_status == "stale"

    db.close()
    engine.dispose()


def test_facebook_credential_state_marks_cookie_expiring_soon():
    engine, session_factory = build_test_session_factory()
    db = session_factory()
    now = datetime.now(timezone.utc)

    row = UserFacebookCredential(
        user_id="user-456",
        encrypted_cookie_json="encrypted",
        cookie_fingerprint_sha256="c" * 64,
        cookie_count=4,
        credential_source="manual_upload",
        session_cookie_count=1,
        status="active",
        last_validated_at=now,
        earliest_cookie_expiry_at=now + timedelta(minutes=10),
    )
    db.add(row)
    db.commit()
    db.refresh(row)

    state = facebook_credential_state(db, row, user_id="user-456", now=now)

    assert state.helper_connected is False
    assert state.stale_reason == STALE_REASON_COOKIE_EXPIRING_SOON
    assert state.effective_status == "stale"

    db.close()
    engine.dispose()
