from __future__ import annotations

import json
import logging
import re

import httpx

from app.core.config import settings
from app.schemas.copilot import CopilotQueryResponse
from app.services.scoring import tokenize

logger = logging.getLogger(__name__)

CURRENT_CONTEXT_MARKERS = (
    "this listing",
    "these listings",
    "those listings",
    "this result",
    "these results",
    "those results",
    "current search",
    "search results",
    "best value",
    "best deal",
    "which one",
    "which listing",
    "compare",
    "comparison",
    "shortlist",
    "top pick",
    "top option",
    "what should i ask",
    "ask the seller",
    "red flag",
    "red flags",
    "worth buying",
    "worth it",
)
CURRENT_CONTEXT_TOKEN_MARKERS = {
    "condition",
    "listing",
    "listings",
    "result",
    "results",
    "risk",
    "risks",
    "seller",
    "compare",
    "comparison",
    "versus",
    "price",
    "priced",
    "value",
    "shortlist",
}
GENERIC_TOPIC_TOKENS = {
    "about",
    "answer",
    "ask",
    "buy",
    "buying",
    "can",
    "find",
    "help",
    "item",
    "items",
    "know",
    "listing",
    "listings",
    "market",
    "marketplace",
    "more",
    "need",
    "price",
    "prices",
    "question",
    "questions",
    "result",
    "results",
    "search",
    "seller",
    "should",
    "selling",
    "shop",
    "shopping",
    "tell",
    "value",
    "want",
    "what",
    "which",
}


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
    query: str | None,
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

    normalized_query = " ".join((query or "").split())
    resolved_query, resolved_listings, resolved_conversation, context_mode = _resolve_copilot_context(
        query=normalized_query,
        user_question=user_question,
        listings=listings,
        conversation=conversation or [],
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
            "query": resolved_query,
            "user_question": user_question,
            "conversation": resolved_conversation,
            "context_mode": context_mode,
            "has_listing_context": bool(resolved_listings),
            "listings": resolved_listings[:25],
        },
        ensure_ascii=True,
    )

    try:
        result = await request_gemini_structured_json(
            schema=schema,
            instructions=(
                "You are Marketly's marketplace copilot. "
                "You may help with marketplace items, model-specific buying guidance, common issues, "
                "used-market considerations, negotiation advice, and interpreting the supplied listings. "
                "Treat the supplied conversation as ongoing context for follow-up questions. "
                "Refusals are turn-local and must not narrow future shopping help to a previous category. "
                "If the current turn starts a new marketplace topic, let it replace unrelated prior search context. "
                "Use supplied listings only for listing-specific claims, comparisons, or recommendations. "
                "If the user asks about the item or model more broadly, answer from general marketplace and "
                "used-buying knowledge even when no listings are supplied. "
                "Refuse requests that are unrelated to marketplace items, shopping, buying, selling, or "
                "listing evaluation. Keep refusals brief and redirect back to item-related help. "
                "If the question depends on a specific item and the item is still unclear, ask one short "
                "clarifying question instead of guessing. "
                "Only return shortlist entries when the user is explicitly asking for recommendations, best picks, "
                "comparisons, top options, what to buy, or a shortlist, and only use supplied listings for that. "
                "If no listings are supplied, shortlist must be empty. "
                "Treat low-confidence valuation bands, especially estimate_source values of live_cohort, "
                "category_prior, or confidence_label low, as approximate rough estimates and never as precise market value. "
                "Return seller_questions only when the user explicitly asks what to ask before buying or what to ask the seller. "
                "Return red_flags only when the user explicitly asks for risks, red flags, common issues, or what to watch out for. "
                "Do not invent listing details, and mention uncertainty when the available context is thin."
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
        if not listings or not _question_requests_shortlist(user_question):
            shortlist = []
        if not _question_requests_seller_questions(user_question):
            seller_questions = []
        if not _question_requests_red_flags(user_question):
            red_flags = []

        return CopilotQueryResponse.model_validate(
            {
                "available": True,
                "answer": result.get("answer") or "I couldn't form a useful answer from the available context.",
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
            "Hi. I can help with marketplace items, explain what to know before buying, "
            "compare live listings, flag risks, and suggest seller questions."
        )
    if normalized in thanks_markers:
        return "You're welcome. Ask about an item, compare listings, check risks, or get seller questions."
    if normalized in acknowledgement_markers:
        return "Ask about an item, compare listings, find the best value, flag red flags, or get seller questions."
    return None


def _question_tokens(text: str) -> set[str]:
    return {token for token in tokenize(text) if token not in GENERIC_TOPIC_TOKENS}


def _strip_ui_appended_sections(content: str) -> str:
    normalized = content.replace("\r\n", "\n").strip()
    first_heading = re.search(r"\n\n(?:Seller questions|Red flags):\n", normalized)
    if first_heading is not None:
        normalized = normalized[: first_heading.start()]
    return normalized.strip()


def _sanitize_conversation(conversation: list[dict]) -> list[dict]:
    sanitized: list[dict] = []
    for message in conversation[-20:]:
        role = str(message.get("role") or "").strip().lower()
        if role not in {"user", "assistant"}:
            continue
        content = str(message.get("content") or "").strip()
        if not content:
            continue
        if role == "assistant":
            content = _strip_ui_appended_sections(content)
            if not content:
                continue
        sanitized.append({"role": role, "content": content[:4000]})
    return sanitized[-20:]


def _question_references_active_context(user_question: str) -> bool:
    normalized = " ".join(user_question.lower().split())
    if any(marker in normalized for marker in CURRENT_CONTEXT_MARKERS):
        return True
    return bool(set(tokenize(user_question)).intersection(CURRENT_CONTEXT_TOKEN_MARKERS))


def _should_use_active_search_context(
    *,
    query: str | None,
    user_question: str,
    listings: list[dict],
) -> bool:
    has_active_context = bool((query or "").strip()) or bool(listings)
    if not has_active_context:
        return False
    if _question_references_active_context(user_question):
        return True

    query_tokens = _question_tokens(query or "")
    question_tokens = _question_tokens(user_question)
    if not query_tokens or not question_tokens:
        return False

    shared_tokens = len(query_tokens.intersection(question_tokens))
    required_overlap = 1 if min(len(query_tokens), len(question_tokens)) <= 2 else 2
    return shared_tokens >= required_overlap


def _conversation_for_fresh_topic(conversation: list[dict], user_question: str) -> list[dict]:
    question_tokens = _question_tokens(user_question)
    if not question_tokens:
        return []

    filtered = [
        message
        for message in conversation
        if _question_tokens(message["content"]).intersection(question_tokens)
    ]
    return filtered[-8:]


def _resolve_copilot_context(
    *,
    query: str | None,
    user_question: str,
    listings: list[dict],
    conversation: list[dict],
) -> tuple[str | None, list[dict], list[dict], str]:
    sanitized_conversation = _sanitize_conversation(conversation)
    if _should_use_active_search_context(query=query, user_question=user_question, listings=listings):
        return query or None, listings[:25], sanitized_conversation, "active_search"
    return None, [], _conversation_for_fresh_topic(sanitized_conversation, user_question), "fresh_topic"


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
    normalized = " ".join(user_question.lower().split())
    seller_question_markers = (
        "what should i ask",
        "what should i ask the seller",
        "what to ask the seller",
        "questions should i ask",
        "ask before buying",
        "ask the seller",
    )
    return (
        any(marker in normalized for marker in seller_question_markers)
        or ("seller" in normalized and ("question" in normalized or "ask" in normalized))
    )


def _question_requests_red_flags(user_question: str) -> bool:
    normalized = " ".join(user_question.lower().split())
    red_flag_markers = (
        "red flag",
        "risk",
        "concern",
        "concerns",
        "suspicious",
        "sketchy",
        "watch out",
        "look out",
        "common issues",
        "known issues",
        "problem",
        "problems",
    )
    return any(marker in normalized for marker in red_flag_markers)
