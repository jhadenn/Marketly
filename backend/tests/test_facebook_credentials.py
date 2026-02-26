import base64
import os

import pytest

from app.connectors.facebook_marketplace import FacebookConnectorError
from app.services import facebook_credentials


def _fernet_key() -> str:
    return base64.urlsafe_b64encode(os.urandom(32)).decode("utf-8")


def _cookie_payload(extra: dict | None = None):
    payload = [
        {"name": "c_user", "value": "1", "domain": ".facebook.com", "path": "/"},
        {"name": "xs", "value": "abc", "domain": ".facebook.com", "path": "/"},
        {"name": "fr", "value": "frv", "domain": ".facebook.com", "path": "/"},
        {"name": "datr", "value": "datr", "domain": ".facebook.com", "path": "/"},
    ]
    if extra:
        payload.append(extra)
    return payload


def test_parse_and_validate_cookie_payload_accepts_array():
    sanitized, meta = facebook_credentials.parse_and_validate_cookie_payload(_cookie_payload())
    assert len(sanitized) >= 4
    assert meta["cookie_count"] >= 4
    assert "c_user" in meta["cookie_names"]
    assert "xs" in meta["cookie_names"]
    assert len(meta["cookie_fingerprint_sha256"]) == 64


def test_parse_and_validate_cookie_payload_accepts_wrapped_object():
    sanitized, meta = facebook_credentials.parse_and_validate_cookie_payload(
        {"cookies": _cookie_payload()}
    )
    assert len(sanitized) >= 4
    assert meta["cookie_count"] >= 4


def test_parse_and_validate_cookie_payload_rejects_missing_required():
    with pytest.raises(FacebookConnectorError) as excinfo:
        facebook_credentials.parse_and_validate_cookie_payload(
            [{"name": "fr", "value": "x", "domain": ".facebook.com", "path": "/"}]
        )
    assert excinfo.value.code.value == "cookies_invalid"


def test_parse_and_validate_cookie_payload_filters_non_facebook_cookies():
    mixed_payload = _cookie_payload(
        {"name": "sid", "value": "g", "domain": ".google.com", "path": "/"}
    )
    sanitized, meta = facebook_credentials.parse_and_validate_cookie_payload(mixed_payload)
    assert len(sanitized) == 4
    assert meta["cookie_count"] == 4
    assert "sid" not in meta["cookie_names"]


def test_parse_and_validate_cookie_payload_rejects_non_facebook_domain_only():
    payload = [
        {"name": "c_user", "value": "1", "domain": ".google.com", "path": "/"},
        {"name": "xs", "value": "abc", "domain": ".google.com", "path": "/"},
        {"name": "fr", "value": "frv", "domain": ".google.com", "path": "/"},
        {"name": "datr", "value": "datr", "domain": ".google.com", "path": "/"},
    ]
    with pytest.raises(FacebookConnectorError) as excinfo:
        facebook_credentials.parse_and_validate_cookie_payload(payload)
    assert excinfo.value.code.value == "cookies_invalid"


def test_encrypt_decrypt_roundtrip(monkeypatch):
    pytest.importorskip("cryptography")
    monkeypatch.setattr(
        facebook_credentials.settings,
        "MARKETLY_CREDENTIALS_ENCRYPTION_KEY",
        _fernet_key(),
    )
    payload = _cookie_payload()
    token = facebook_credentials.encrypt_cookie_payload(payload)
    decrypted = facebook_credentials.decrypt_cookie_payload(token)
    assert isinstance(token, str)
    assert decrypted == payload


def test_fingerprint_changes_when_cookie_changes():
    _, meta_a = facebook_credentials.parse_and_validate_cookie_payload(_cookie_payload())
    _, meta_b = facebook_credentials.parse_and_validate_cookie_payload(
        _cookie_payload({"name": "presence", "value": "v", "domain": ".facebook.com", "path": "/"})
    )
    assert meta_a["cookie_fingerprint_sha256"] != meta_b["cookie_fingerprint_sha256"]
