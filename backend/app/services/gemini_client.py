from __future__ import annotations

import json
import logging

import httpx

from app.core.config import settings
from app.schemas.copilot import CopilotQueryResponse

logger = logging.getLogger(__name__)


def gemini_is_configured() -> bool:
    return bool((settings.GEMINI_API_KEY or "").strip())


def _generate_content_url() -> str:
    base = (settings.GEMINI_API_BASE or "https://generativelanguage.googleapis.com/v1beta").rstrip("/")
    model = (settings.MARKETLY_GEMINI_MODEL or "gemini-2.5-flash-lite").strip()
    return f"{base}/models/{model}:generateContent"


async def request_gemini_structured_json(
    *,
    schema: dict,
    instructions: str,
    prompt: str,
) -> dict:
    if not gemini_is_configured():
        raise RuntimeError("Gemini API key is not configured.")

    payload = {
        "systemInstruction": {
            "parts": [
                {
                    "text": instructions,
                }
            ]
        },
        "contents": [
            {
                "role": "user",
                "parts": [
                    {
                        "text": prompt,
                    }
                ],
            }
        ],
        "generationConfig": {
            "responseMimeType": "application/json",
            "responseJsonSchema": schema,
        },
    }
    headers = {
        "x-goog-api-key": settings.GEMINI_API_KEY or "",
        "Content-Type": "application/json",
    }

    async with httpx.AsyncClient(timeout=settings.MARKETLY_GEMINI_TIMEOUT_SECONDS) as client:
        response = await client.post(_generate_content_url(), headers=headers, json=payload)
    response.raise_for_status()
    data = response.json()

    output_parts: list[str] = []
    for candidate in data.get("candidates", []) or []:
        content = candidate.get("content") or {}
        for part in content.get("parts", []) or []:
            text = part.get("text")
            if isinstance(text, str) and text.strip():
                output_parts.append(text)
    if output_parts:
        return json.loads("\n".join(output_parts))

    raise RuntimeError("Gemini response did not include structured text output.")


async def generate_alert_summary(query: str, items: list[dict]) -> str:
    if not items:
        return f"No strong new matches were found for '{query}'."

    fallback = _fallback_alert_summary(query, items)
    if not gemini_is_configured():
        return fallback

    schema = {
        "type": "object",
        "additionalProperties": False,
        "properties": {
            "summary": {"type": "string"},
        },
        "required": ["summary"],
    }
    prompt = json.dumps(
        {
            "query": query,
            "items": [
                {
                    "title": item.get("title"),
                    "source": item.get("source"),
                    "location": item.get("location"),
                    "match_confidence": item.get("match_confidence"),
                    "valuation_explanation": (item.get("valuation") or {}).get("explanation"),
                    "risk_level": (item.get("risk") or {}).get("level"),
                }
                for item in items[:5]
            ],
        },
        ensure_ascii=True,
    )
    try:
        result = await request_gemini_structured_json(
            schema=schema,
            instructions=(
                "Write one concise sentence summarizing the best new Marketplace matches. "
                "Use only the provided data, stay factual, and avoid hype."
            ),
            prompt=prompt,
        )
    except Exception as exc:
        logger.warning("alert summary generation failed: %s", exc)
        return fallback

    summary = str(result.get("summary") or "").strip()
    return summary or fallback


def _fallback_alert_summary(query: str, items: list[dict]) -> str:
    count = len(items)
    standout = next(
        (
            item
            for item in items
            if (item.get("valuation") or {}).get("verdict") == "underpriced"
        ),
        items[0],
    )
    standout_title = str(standout.get("title") or "listing").strip()
    return f"{count} new high-confidence matches for '{query}', led by {standout_title}."


async def generate_copilot_response(
    *,
    query: str,
    user_question: str,
    listings: list[dict],
    conversation: list[dict] | None = None,
) -> CopilotQueryResponse:
    unavailable = CopilotQueryResponse(
        available=False,
        answer="Shopping copilot is unavailable right now.",
        shortlist=[],
        seller_questions=[],
        red_flags=[],
        error_message="Copilot service is unavailable.",
    )

    if not gemini_is_configured():
        unavailable.error_message = "Gemini API key is not configured."
        return unavailable

    small_talk_response = _small_talk_response(user_question)
    if small_talk_response is not None:
        return CopilotQueryResponse(
            available=True,
            answer=small_talk_response,
            shortlist=[],
            seller_questions=[],
            red_flags=[],
            error_message=None,
        )

    schema = {
        "type": "object",
        "additionalProperties": False,
        "properties": {
            "answer": {"type": "string"},
            "shortlist": {
                "type": "array",
                "items": {
                    "type": "object",
                    "additionalProperties": False,
                    "properties": {
                        "listing_key": {"type": "string"},
                        "title": {"type": "string"},
                        "reason": {"type": "string"},
                    },
                    "required": ["listing_key", "title", "reason"],
                },
            },
            "seller_questions": {
                "type": "array",
                "items": {"type": "string"},
            },
            "red_flags": {
                "type": "array",
                "items": {"type": "string"},
            },
        },
        "required": ["answer", "shortlist", "seller_questions", "red_flags"],
    }
    prompt = json.dumps(
        {
            "query": query,
            "user_question": user_question,
            "conversation": (conversation or [])[-20:],
            "listings": listings[:25],
        },
        ensure_ascii=True,
    )

    try:
        result = await request_gemini_structured_json(
            schema=schema,
            instructions=(
                "You are Marketly's shopping copilot. Answer using only the supplied listings. "
                "Treat the supplied conversation as ongoing context for follow-up questions. "
                "If the user is greeting you, thanking you, or making small talk, reply briefly and naturally "
                "without producing a shortlist, seller questions, or red flags. "
                "Only return shortlist entries when the user is explicitly asking for recommendations, best picks, "
                "comparisons, top options, what to buy, or a shortlist. "
                "If the user has not given enough criteria to decide between listings, ask one short clarifying "
                "question instead of pretending to know their preference. "
                "Return seller_questions only when the user explicitly asks what to ask the seller. "
                "Return red_flags only when the user explicitly asks for risks, red flags, or concerns. "
                "Do not invent facts, and mention uncertainty when the listing data is thin."
            ),
            prompt=prompt,
        )
    except Exception as exc:
        logger.warning("copilot generation failed: %s", exc)
        unavailable.error_message = str(exc)
        return unavailable

    try:
        shortlist = result.get("shortlist") or []
        seller_questions = result.get("seller_questions") or []
        red_flags = result.get("red_flags") or []
        if not _question_requests_shortlist(user_question):
            shortlist = []
        if not _question_requests_seller_questions(user_question):
            seller_questions = []
        if not _question_requests_red_flags(user_question):
            red_flags = []

        return CopilotQueryResponse.model_validate(
            {
                "available": True,
                "answer": result.get("answer") or "I couldn't form a useful answer from these listings.",
                "shortlist": shortlist,
                "seller_questions": seller_questions,
                "red_flags": red_flags,
                "error_message": None,
            }
        )
    except Exception as exc:
        logger.warning("copilot response parse failed: %s", exc)
        unavailable.error_message = "Copilot returned an invalid response."
        return unavailable


def _small_talk_response(user_question: str) -> str | None:
    normalized = " ".join(user_question.lower().split())
    greeting_markers = {"hi", "hello", "hey", "yo", "sup", "good morning", "good afternoon"}
    thanks_markers = {"thanks", "thank you", "thx"}
    acknowledgement_markers = {"ok", "okay", "cool", "nice", "got it"}

    if normalized in greeting_markers or normalized.startswith("hello ") or normalized.startswith("hi "):
        return (
            "Hi. I can compare listings, find the best value, flag risks, build a shortlist, "
            "and suggest seller questions when you ask about the listings in view."
        )
    if normalized in thanks_markers:
        return "You're welcome. Ask me to compare listings, flag risks, or help narrow down the best option."
    if normalized in acknowledgement_markers:
        return "Ask me to compare listings, find the best value, flag red flags, or suggest seller questions."
    return None


def _question_requests_shortlist(user_question: str) -> bool:
    normalized = user_question.lower()
    shortlist_markers = (
        "shortlist",
        "best value",
        "best pick",
        "best option",
        "best one",
        "recommend",
        "recommendation",
        "top pick",
        "top option",
        "which one",
        "which should",
        "compare",
        "contrast",
        "worth buying",
        "worth it",
        "what should i buy",
        "which should i buy",
    )
    return any(marker in normalized for marker in shortlist_markers)


def _question_requests_seller_questions(user_question: str) -> bool:
    normalized = user_question.lower()
    return ("seller" in normalized and "question" in normalized) or "what should i ask" in normalized


def _question_requests_red_flags(user_question: str) -> bool:
    normalized = user_question.lower()
    red_flag_markers = ("red flag", "risk", "concern", "concerns", "suspicious", "sketchy")
    return any(marker in normalized for marker in red_flag_markers)
