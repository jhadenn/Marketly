from types import SimpleNamespace

from fastapi.testclient import TestClient

from app.auth import get_current_user_id
from app.connectors.facebook_marketplace import FacebookConnectorError, FacebookConnectorErrorCode
from app.db import get_db
from app.main import app

client = TestClient(app)


def _override_auth():
    return "user-123"


def _override_db():
    yield SimpleNamespace()


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
    monkeypatch.setattr(
        "app.main.decrypt_cookie_payload",
        lambda value: [{"name": "c_user"}, {"name": "xs"}, {"name": "fr"}, {"name": "datr"}],
    )

    class FakeConnector:
        async def search(self, payload):
            raise FacebookConnectorError(
                FacebookConnectorErrorCode.login_wall,
                "Login wall detected",
                retryable=False,
            )

    calls = {"failed": 0}

    def fake_mark_failed(db, row_obj, **kwargs):
        calls["failed"] += 1
        row_obj.status = "verification_failed"
        row_obj.last_error_code = kwargs.get("error_code")
        row_obj.last_error_message = kwargs.get("error_message")

    monkeypatch.setattr("app.main.facebook_connector", FakeConnector())
    monkeypatch.setattr("app.main.mark_credential_failed", fake_mark_failed)

    response = client.post("/me/connectors/facebook/verify")

    app.dependency_overrides.clear()

    assert response.status_code == 200
    payload = response.json()
    assert payload["ok"] is False
    assert payload["error_code"] == "login_wall"
    assert calls["failed"] == 1
