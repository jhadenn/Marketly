import asyncio

from app.core.config import settings
from app.services.gemini_client import (
    generate_alert_summary,
    generate_copilot_response,
    request_gemini_structured_json,
)


def test_request_gemini_structured_json_uses_generate_content_payload(monkeypatch):
    captured: dict[str, object] = {}

    class DummyResponse:
        def raise_for_status(self):
            return None

        def json(self):
            return {
                "candidates": [
                    {
                        "content": {
                            "parts": [
                                {
                                    "text": '{"summary":"1 fresh bike listing"}',
                                }
                            ]
                        }
                    }
                ]
            }

    class DummyClient:
        def __init__(self, *args, **kwargs):
            captured["timeout"] = kwargs.get("timeout")

        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc, tb):
            return False

        async def post(self, url, *, headers=None, json=None):
            captured["url"] = url
            captured["headers"] = headers
            captured["json"] = json
            return DummyResponse()

    monkeypatch.setattr(settings, "GEMINI_API_KEY", "test-gemini-key")
    monkeypatch.setattr(settings, "GEMINI_API_BASE", "https://generativelanguage.googleapis.com/v1beta")
    monkeypatch.setattr(settings, "MARKETLY_GEMINI_MODEL", "gemini-2.5-flash-lite")
    monkeypatch.setattr(settings, "MARKETLY_GEMINI_TIMEOUT_SECONDS", 13.0)
    monkeypatch.setattr("app.services.gemini_client.httpx.AsyncClient", DummyClient)

    schema = {
        "type": "object",
        "properties": {"summary": {"type": "string"}},
        "required": ["summary"],
    }

    result = asyncio.run(
        request_gemini_structured_json(
            schema=schema,
            instructions="Return JSON only.",
            prompt='{"query":"bike"}',
        )
    )

    assert result == {"summary": "1 fresh bike listing"}
    assert captured["timeout"] == 13.0
    assert captured["url"] == "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent"
    assert captured["headers"] == {
        "x-goog-api-key": "test-gemini-key",
        "Content-Type": "application/json",
    }
    payload = captured["json"]
    assert payload["generationConfig"]["responseMimeType"] == "application/json"
    assert payload["generationConfig"]["responseJsonSchema"] == schema
    assert payload["systemInstruction"]["parts"][0]["text"] == "Return JSON only."
    assert payload["contents"][0]["parts"][0]["text"] == '{"query":"bike"}'


def test_generate_alert_summary_returns_fallback_without_gemini_key(monkeypatch):
    monkeypatch.setattr(settings, "GEMINI_API_KEY", None)

    result = asyncio.run(
        generate_alert_summary(
            "road bike",
            [
                {
                    "title": "Road bike listing",
                    "valuation": {"verdict": "underpriced"},
                }
            ],
        )
    )

    assert result == "1 new high-confidence matches for 'road bike', led by Road bike listing."


def test_generate_copilot_response_returns_unavailable_without_gemini_key(monkeypatch):
    monkeypatch.setattr(settings, "GEMINI_API_KEY", "")

    result = asyncio.run(
        generate_copilot_response(
            query="road bike",
            user_question="Which is the best value?",
            listings=[],
        )
    )

    assert result.available is False
    assert result.error_message == "Gemini API key is not configured."


def test_generate_copilot_response_surfaces_generation_errors(monkeypatch):
    async def fake_request(**kwargs):
        raise RuntimeError("Gemini quota exhausted")

    monkeypatch.setattr(settings, "GEMINI_API_KEY", "test-gemini-key")
    monkeypatch.setattr("app.services.gemini_client.request_gemini_structured_json", fake_request)

    result = asyncio.run(
        generate_copilot_response(
            query="road bike",
            user_question="Which is the best value?",
            listings=[{"listing_key": "ebay:1", "title": "Road bike"}],
        )
    )

    assert result.available is False
    assert result.error_message == "Gemini quota exhausted"
