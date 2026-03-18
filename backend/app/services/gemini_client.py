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
            "listings": listings[:25],
        },
        ensure_ascii=True,
    )

    try:
        result = await request_gemini_structured_json(
            schema=schema,
            instructions=(
                "You are Marketly's shopping copilot. Answer using only the supplied listings. "
                "Do not invent facts, and mention uncertainty when the listing data is thin."
            ),
            prompt=prompt,
        )
    except Exception as exc:
        logger.warning("copilot generation failed: %s", exc)
        unavailable.error_message = str(exc)
        return unavailable

    try:
        return CopilotQueryResponse.model_validate(
            {
                "available": True,
                "answer": result.get("answer") or "I couldn't form a useful answer from these listings.",
                "shortlist": result.get("shortlist") or [],
                "seller_questions": result.get("seller_questions") or [],
                "red_flags": result.get("red_flags") or [],
                "error_message": None,
            }
        )
    except Exception as exc:
        logger.warning("copilot response parse failed: %s", exc)
        unavailable.error_message = "Copilot returned an invalid response."
        return unavailable
