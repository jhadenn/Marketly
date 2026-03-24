import asyncio
import json

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


def test_generate_copilot_response_supports_general_item_questions_without_listings(monkeypatch):
    captured: dict[str, object] = {}

    async def fake_request(**kwargs):
        captured.update(kwargs)
        return {
            "answer": "The Acura RSX is a sporty compact coupe. Check maintenance history, rust, and transmission condition before buying.",
            "shortlist": [
                {
                    "listing_key": "ebay:1",
                    "title": "Should be ignored without listings",
                    "reason": "No live listing context was supplied.",
                }
            ],
            "seller_questions": [],
            "red_flags": [],
        }

    monkeypatch.setattr(settings, "GEMINI_API_KEY", "test-gemini-key")
    monkeypatch.setattr("app.services.gemini_client.request_gemini_structured_json", fake_request)

    result = asyncio.run(
        generate_copilot_response(
            query=None,
            user_question="What can you tell me about the Acura RSX?",
            listings=[],
        )
    )

    prompt_payload = json.loads(str(captured["prompt"]))
    assert result.available is True
    assert result.shortlist == []
    assert prompt_payload["query"] is None
    assert prompt_payload["has_listing_context"] is False
    assert prompt_payload["listings"] == []
    assert "refuse requests that are unrelated" in str(captured["instructions"]).lower()
    assert "rough estimates" in str(captured["instructions"]).lower()


def test_generate_copilot_response_refuses_off_topic_questions(monkeypatch):
    async def fake_request(**kwargs):
        return {
            "answer": "I can help with marketplace items and listing research, but I can't help with unrelated requests like that.",
            "shortlist": [],
            "seller_questions": [],
            "red_flags": [],
        }

    monkeypatch.setattr(settings, "GEMINI_API_KEY", "test-gemini-key")
    monkeypatch.setattr("app.services.gemini_client.request_gemini_structured_json", fake_request)

    result = asyncio.run(
        generate_copilot_response(
            query=None,
            user_question="Write me a haiku about the weather.",
            listings=[],
        )
    )

    assert result.available is True
    assert "marketplace items" in result.answer.lower()
    assert result.shortlist == []
    assert result.seller_questions == []
    assert result.red_flags == []


def test_generate_copilot_response_drops_stale_search_context_for_new_marketplace_topic(monkeypatch):
    captured: dict[str, object] = {}

    async def fake_request(**kwargs):
        captured.update(kwargs)
        return {
            "answer": "I can help compare badminton rackets, explain what to look for, and suggest seller questions.",
            "shortlist": [],
            "seller_questions": [],
            "red_flags": [],
        }

    monkeypatch.setattr(settings, "GEMINI_API_KEY", "test-gemini-key")
    monkeypatch.setattr("app.services.gemini_client.request_gemini_structured_json", fake_request)

    result = asyncio.run(
        generate_copilot_response(
            query="acura rsx",
            user_question="what about badminton racket shopping",
            listings=[{"listing_key": "fb:1", "title": "2003 Acura RSX Base"}],
            conversation=[
                {"role": "user", "content": "Which is the best value?"},
                {
                    "role": "assistant",
                    "content": "The 2003 Acura RSX Base is the best value.",
                },
                {"role": "user", "content": "can you help me answer math homework"},
                {
                    "role": "assistant",
                    "content": "I cannot help with math homework. Is there anything related to car shopping I can help you with?",
                },
            ],
        )
    )

    prompt_payload = json.loads(str(captured["prompt"]))
    assert result.available is True
    assert prompt_payload["query"] is None
    assert prompt_payload["listings"] == []
    assert prompt_payload["context_mode"] == "fresh_topic"
    assert prompt_payload["conversation"] == []


def test_generate_copilot_response_keeps_active_listing_context_for_best_value_questions(monkeypatch):
    captured: dict[str, object] = {}

    async def fake_request(**kwargs):
        captured.update(kwargs)
        return {
            "answer": "The first listing is the strongest value.",
            "shortlist": [
                {
                    "listing_key": "ebay:1",
                    "title": "Road bike",
                    "reason": "Priced below comparable listings.",
                }
            ],
            "seller_questions": [],
            "red_flags": [],
        }

    monkeypatch.setattr(settings, "GEMINI_API_KEY", "test-gemini-key")
    monkeypatch.setattr("app.services.gemini_client.request_gemini_structured_json", fake_request)

    result = asyncio.run(
        generate_copilot_response(
            query="road bike",
            user_question="Which is the best value?",
            listings=[{"listing_key": "ebay:1", "title": "Road bike"}],
        )
    )

    prompt_payload = json.loads(str(captured["prompt"]))
    assert result.available is True
    assert prompt_payload["query"] == "road bike"
    assert prompt_payload["has_listing_context"] is True
    assert prompt_payload["listings"] == [{"listing_key": "ebay:1", "title": "Road bike"}]
    assert prompt_payload["context_mode"] == "active_search"


def test_generate_copilot_response_strips_ui_sections_from_assistant_history(monkeypatch):
    captured: dict[str, object] = {}

    async def fake_request(**kwargs):
        captured.update(kwargs)
        return {
            "answer": "Ask for the battery health details.",
            "shortlist": [],
            "seller_questions": [],
            "red_flags": [],
        }

    monkeypatch.setattr(settings, "GEMINI_API_KEY", "test-gemini-key")
    monkeypatch.setattr("app.services.gemini_client.request_gemini_structured_json", fake_request)

    result = asyncio.run(
        generate_copilot_response(
            query="iphone 15",
            user_question="What should I ask next?",
            listings=[{"listing_key": "fb:1", "title": "iPhone 15"}],
            conversation=[
                {
                    "role": "assistant",
                    "content": (
                        "Ask about battery health and repair history.\n\n"
                        "Seller questions:\n- What is the battery health?\n\n"
                        "Red flags:\n- Missing IMEI photo."
                    ),
                }
            ],
        )
    )

    prompt_payload = json.loads(str(captured["prompt"]))
    assert result.available is True
    assert prompt_payload["conversation"] == [
        {"role": "assistant", "content": "Ask about battery health and repair history."}
    ]


def test_generate_copilot_response_clears_seller_questions_and_red_flags_when_not_requested(
    monkeypatch,
):
    async def fake_request(**kwargs):
        return {
            "answer": "The road bike is the strongest overall value.",
            "shortlist": [
                {
                    "listing_key": "ebay:1",
                    "title": "Road bike",
                    "reason": "It is priced below comps.",
                }
            ],
            "seller_questions": ["Has it been serviced recently?"],
            "red_flags": ["Ask why the price is this low."],
        }

    monkeypatch.setattr(settings, "GEMINI_API_KEY", "test-gemini-key")
    monkeypatch.setattr("app.services.gemini_client.request_gemini_structured_json", fake_request)

    result = asyncio.run(
        generate_copilot_response(
            query="road bike",
            user_question="Which is the best value?",
            listings=[{"listing_key": "ebay:1", "title": "Road bike"}],
            conversation=[{"role": "user", "content": "Show me the strongest options."}],
        )
    )

    assert result.available is True
    assert result.seller_questions == []
    assert result.red_flags == []
    assert result.shortlist[0].listing_key == "ebay:1"


def test_generate_copilot_response_keeps_seller_questions_when_requested(monkeypatch):
    async def fake_request(**kwargs):
        return {
            "answer": "Ask the seller about service history and ownership.",
            "shortlist": [],
            "seller_questions": ["Has it been serviced recently?"],
            "red_flags": ["The price is unusually low."],
        }

    monkeypatch.setattr(settings, "GEMINI_API_KEY", "test-gemini-key")
    monkeypatch.setattr("app.services.gemini_client.request_gemini_structured_json", fake_request)

    result = asyncio.run(
        generate_copilot_response(
            query="road bike",
            user_question="What should I ask the seller about this bike?",
            listings=[{"listing_key": "ebay:1", "title": "Road bike"}],
        )
    )

    assert result.seller_questions == ["Has it been serviced recently?"]
    assert result.red_flags == []


def test_generate_copilot_response_keeps_seller_questions_for_general_item_questions(monkeypatch):
    async def fake_request(**kwargs):
        return {
            "answer": "Ask about rust, maintenance history, clutch wear, and title status.",
            "shortlist": [],
            "seller_questions": [
                "Has the clutch ever been replaced?",
                "Do you have maintenance records?",
            ],
            "red_flags": [],
        }

    monkeypatch.setattr(settings, "GEMINI_API_KEY", "test-gemini-key")
    monkeypatch.setattr("app.services.gemini_client.request_gemini_structured_json", fake_request)

    result = asyncio.run(
        generate_copilot_response(
            query=None,
            user_question="What should I ask before buying an Acura RSX?",
            listings=[],
        )
    )

    assert result.seller_questions == [
        "Has the clutch ever been replaced?",
        "Do you have maintenance records?",
    ]


def test_generate_copilot_response_keeps_red_flags_when_requested(monkeypatch):
    async def fake_request(**kwargs):
        return {
            "answer": "The low price and thin description deserve follow-up.",
            "shortlist": [],
            "seller_questions": ["Has it been serviced recently?"],
            "red_flags": ["The price is unusually low."],
        }

    monkeypatch.setattr(settings, "GEMINI_API_KEY", "test-gemini-key")
    monkeypatch.setattr("app.services.gemini_client.request_gemini_structured_json", fake_request)

    result = asyncio.run(
        generate_copilot_response(
            query="road bike",
            user_question="What red flags do you see here?",
            listings=[{"listing_key": "ebay:1", "title": "Road bike"}],
        )
    )

    assert result.seller_questions == []
    assert result.red_flags == ["The price is unusually low."]


def test_generate_copilot_response_keeps_red_flags_for_general_item_questions(monkeypatch):
    async def fake_request(**kwargs):
        return {
            "answer": "Watch for rust, transmission issues, and signs of poor modifications.",
            "shortlist": [],
            "seller_questions": [],
            "red_flags": [
                "Rust around the rear wheel arches can be expensive to fix.",
                "Grinding gears can point to transmission wear.",
            ],
        }

    monkeypatch.setattr(settings, "GEMINI_API_KEY", "test-gemini-key")
    monkeypatch.setattr("app.services.gemini_client.request_gemini_structured_json", fake_request)

    result = asyncio.run(
        generate_copilot_response(
            query=None,
            user_question="What should I watch out for with an Acura RSX?",
            listings=[],
        )
    )

    assert result.red_flags == [
        "Rust around the rear wheel arches can be expensive to fix.",
        "Grinding gears can point to transmission wear.",
    ]


def test_generate_copilot_response_clears_shortlist_when_not_requested(monkeypatch):
    async def fake_request(**kwargs):
        return {
            "answer": "The condition details are limited in the listing.",
            "shortlist": [
                {
                    "listing_key": "ebay:1",
                    "title": "Road bike",
                    "reason": "It is priced below comps.",
                }
            ],
            "seller_questions": [],
            "red_flags": [],
        }

    monkeypatch.setattr(settings, "GEMINI_API_KEY", "test-gemini-key")
    monkeypatch.setattr("app.services.gemini_client.request_gemini_structured_json", fake_request)

    result = asyncio.run(
        generate_copilot_response(
            query="road bike",
            user_question="Tell me more about the condition of this listing.",
            listings=[{"listing_key": "ebay:1", "title": "Road bike"}],
        )
    )

    assert result.shortlist == []


def test_generate_copilot_response_handles_small_talk_without_shortlist(monkeypatch):
    monkeypatch.setattr(settings, "GEMINI_API_KEY", "test-gemini-key")

    result = asyncio.run(
        generate_copilot_response(
            query="road bike",
            user_question="hello",
            listings=[{"listing_key": "ebay:1", "title": "Road bike"}],
        )
    )

    assert result.available is True
    assert result.shortlist == []
    assert result.seller_questions == []
    assert result.red_flags == []
    assert "marketplace items" in result.answer.lower()
