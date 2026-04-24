import base64
import os
from types import SimpleNamespace

from fastapi.testclient import TestClient

from app.auth import get_current_user_id
from app.core.config import settings
from app.connectors.facebook_marketplace import FacebookConnectorErrorCode
from app.db import get_db
from app.main import app
from app.services.facebook_verification import FacebookCredentialVerificationOutcome

from .utils import db_override_factory, build_test_session_factory

client = TestClient(app)


def _override_auth():
    return "user-123"


def _override_db():
    yield SimpleNamespace()


def _fernet_key() -> str:
    return base64.urlsafe_b64encode(os.urandom(32)).decode("utf-8")


def test_me_facebook_status_requires_auth():
    response = client.get("/me/connectors/facebook")
    assert response.status_code == 401


def test_me_facebook_put_and_delete(monkeypatch):
    app.dependency_overrides[get_current_user_id] = _override_auth
    app.dependency_overrides[get_db] = _override_db

    row = SimpleNamespace(
        status="active",
        cookie_count=7,
        last_error_code=None,
        last_error_message=None,
        last_validated_at=None,
        last_used_at=None,
        updated_at=None,
    )

    monkeypatch.setattr("app.main.upsert_user_facebook_credential", lambda db, user_id, payload: row)
    monkeypatch.setattr("app.main.delete_user_facebook_credential", lambda db, user_id: True)

    put_res = client.put(
        "/me/connectors/facebook/cookies",
        json={"cookies_json": [{"name": "c_user"}, {"name": "xs"}, {"name": "fr"}, {"name": "datr"}]},
    )
    delete_res = client.delete("/me/connectors/facebook")

    app.dependency_overrides.clear()

    assert put_res.status_code == 200
    assert put_res.json()["configured"] is True
    assert put_res.json()["cookie_count"] == 7
    assert delete_res.status_code == 200
    assert delete_res.json()["deleted"] is True


def test_me_facebook_verify_returns_typed_error(monkeypatch):
    app.dependency_overrides[get_current_user_id] = _override_auth
    app.dependency_overrides[get_db] = _override_db

    row = SimpleNamespace(
        encrypted_cookie_json="encrypted",
        status="active",
        cookie_count=4,
        last_error_code=None,
        last_error_message=None,
        last_validated_at=None,
        last_used_at=None,
        updated_at=None,
    )

    monkeypatch.setattr("app.main.get_user_facebook_credential", lambda db, user_id: row)
    calls = {"failed": 0}

    async def fake_verify_facebook_credential(db, row_obj):
        calls["failed"] += 1
        row_obj.status = "verification_failed"
        row_obj.last_error_code = FacebookConnectorErrorCode.login_wall.value
        row_obj.last_error_message = "Login wall detected"
        return FacebookCredentialVerificationOutcome(
            ok=False,
            error_code=FacebookConnectorErrorCode.login_wall.value,
            error_message="Login wall detected",
        )

    monkeypatch.setattr("app.main.verify_facebook_credential", fake_verify_facebook_credential)

    response = client.post("/me/connectors/facebook/verify")

    app.dependency_overrides.clear()

    assert response.status_code == 200
    payload = response.json()
    assert payload["ok"] is False
    assert payload["error_code"] == "login_wall"
    assert calls["failed"] == 1


def test_me_facebook_put_rate_limited(monkeypatch):
    app.dependency_overrides[get_current_user_id] = _override_auth
    app.dependency_overrides[get_db] = _override_db
    monkeypatch.setattr(
        "app.main.check_rate_limit",
        lambda **kwargs: SimpleNamespace(allowed=False, retry_after_seconds=30),
    )

    response = client.put(
        "/me/connectors/facebook/cookies",
        json={"cookies_json": [{"name": "c_user"}, {"name": "xs"}, {"name": "fr"}, {"name": "datr"}]},
    )

    app.dependency_overrides.clear()

    assert response.status_code == 429
    payload = response.json()
    assert payload["code"] == "RATE_LIMITED"
    assert payload["retry_after_seconds"] == 30


def test_facebook_helper_pair_and_sync_flow(monkeypatch):
    engine, session_factory = build_test_session_factory()
    app.dependency_overrides[get_current_user_id] = _override_auth
    app.dependency_overrides[get_db] = db_override_factory(session_factory)
    monkeypatch.setattr(settings, "MARKETLY_CREDENTIALS_ENCRYPTION_KEY", _fernet_key())

    pair_res = client.post(
        "/me/connectors/facebook/helper/pairing-sessions",
        json={"helper_label": "Chrome helper"},
    )
    assert pair_res.status_code == 200
    pairing_payload = pair_res.json()
    assert pairing_payload["helper_label"] == "Chrome helper"
    assert pairing_payload["pairing_code"]

    redeem_res = client.post(
        "/connectors/facebook/helper/pair",
        json={"pairing_code": pairing_payload["pairing_code"]},
    )
    assert redeem_res.status_code == 200
    redeem_payload = redeem_res.json()
    helper_token = redeem_payload["helper_token"]
    assert helper_token

    sync_res = client.put(
        "/connectors/facebook/helper/cookies",
        headers={"Authorization": f"Bearer {helper_token}"},
        json={
            "cookies_json": [
                {
                    "name": "c_user",
                    "value": "1",
                    "domain": ".facebook.com",
                    "path": "/",
                    "expires": 1893456000,
                },
                {"name": "xs", "value": "abc", "domain": ".facebook.com", "path": "/"},
                {"name": "fr", "value": "frv", "domain": ".facebook.com", "path": "/"},
                {"name": "datr", "value": "datr", "domain": ".facebook.com", "path": "/"},
            ]
        },
    )
    assert sync_res.status_code == 200
    sync_payload = sync_res.json()
    assert sync_payload["configured"] is True
    assert sync_payload["credential_source"] == "browser_helper"
    assert sync_payload["helper_connected"] is True
    assert sync_payload["helper_label"] == "Chrome helper"
    assert sync_payload["last_synced_at"] is not None

    status_res = client.get("/me/connectors/facebook")
    assert status_res.status_code == 200
    status_payload = status_res.json()
    assert status_payload["credential_source"] == "browser_helper"
    assert status_payload["helper_connected"] is True

    app.dependency_overrides.clear()
    engine.dispose()


def test_delete_facebook_helper_revokes_existing_helper_token(monkeypatch):
    engine, session_factory = build_test_session_factory()
    app.dependency_overrides[get_current_user_id] = _override_auth
    app.dependency_overrides[get_db] = db_override_factory(session_factory)
    monkeypatch.setattr(settings, "MARKETLY_CREDENTIALS_ENCRYPTION_KEY", _fernet_key())

    pair_res = client.post(
        "/me/connectors/facebook/helper/pairing-sessions",
        json={"helper_label": "Chrome helper"},
    )
    redeem_res = client.post(
        "/connectors/facebook/helper/pair",
        json={"pairing_code": pair_res.json()["pairing_code"]},
    )
    helper_token = redeem_res.json()["helper_token"]
    sync_res = client.put(
        "/connectors/facebook/helper/cookies",
        headers={"Authorization": f"Bearer {helper_token}"},
        json={
            "cookies_json": [
                {"name": "c_user", "value": "1", "domain": ".facebook.com", "path": "/"},
                {"name": "xs", "value": "abc", "domain": ".facebook.com", "path": "/"},
                {"name": "fr", "value": "frv", "domain": ".facebook.com", "path": "/"},
                {"name": "datr", "value": "datr", "domain": ".facebook.com", "path": "/"},
            ]
        },
    )
    assert sync_res.status_code == 200

    delete_res = client.delete("/me/connectors/facebook/helper")
    assert delete_res.status_code == 200
    assert delete_res.json()["revoked_clients"] == 1

    denied_sync_res = client.put(
        "/connectors/facebook/helper/cookies",
        headers={"Authorization": f"Bearer {helper_token}"},
        json={
            "cookies_json": [
                {"name": "c_user", "value": "1", "domain": ".facebook.com", "path": "/"},
                {"name": "xs", "value": "abc", "domain": ".facebook.com", "path": "/"},
                {"name": "fr", "value": "frv", "domain": ".facebook.com", "path": "/"},
                {"name": "datr", "value": "datr", "domain": ".facebook.com", "path": "/"},
            ]
        },
    )
    assert denied_sync_res.status_code == 401

    status_res = client.get("/me/connectors/facebook")
    assert status_res.status_code == 200
    status_payload = status_res.json()
    assert status_payload["configured"] is True
    assert status_payload["helper_connected"] is False
    assert status_payload["stale_reason"] == "helper_disconnected"

    app.dependency_overrides.clear()
    engine.dispose()
