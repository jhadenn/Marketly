from types import SimpleNamespace

from fastapi.testclient import TestClient

from app.auth import get_current_user_id
from app.db import get_db
from app.main import app

client = TestClient(app)


def _override_auth():
    return "user-123"


def _override_db():
    yield SimpleNamespace()


def test_saved_search_create_rate_limited(monkeypatch):
    app.dependency_overrides[get_current_user_id] = _override_auth
    app.dependency_overrides[get_db] = _override_db
    monkeypatch.setattr(
        "app.main.check_rate_limit",
        lambda **kwargs: SimpleNamespace(allowed=False, retry_after_seconds=22),
    )

    response = client.post(
        "/saved-searches",
        json={"query": "iphone", "sources": ["ebay"]},
    )

    app.dependency_overrides.clear()

    assert response.status_code == 429
    payload = response.json()
    assert payload["code"] == "RATE_LIMITED"
    assert payload["retry_after_seconds"] == 22
