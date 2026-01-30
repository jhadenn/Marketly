
import re
from dataclasses import dataclass
from typing import Iterable

STOPWORDS = {
    "the","a","an","and","or","for","to","of","in","on","with","at","by","from",
    "is","are","it","this","that"
}

# “Wrong intent” words that commonly appear in Kijiji noise
NEGATIVE_HINTS = [
    "repair", "repairs", "fix", "screen replacement", "replacement",
    "case", "cases", "cover", "charger", "cable", "accessory", "accessories",
    "parts", "part", "broken", "cracked", "wanted", "wtb", "buying",
    "cash for", "trade", "swap", "unlock service", "service"
]

def tokenize(text: str) -> list[str]:
    text = (text or "").lower()
    tokens = re.findall(r"[a-z0-9]+", text)
    return [t for t in tokens if t and t not in STOPWORDS]

@dataclass
class ScoreResult:
    score: float
    reason: str

def score_listing(query: str, title: str, snippet: str | None = None, has_price: bool = False) -> ScoreResult:
    q_tokens = tokenize(query)
    if not q_tokens:
        return ScoreResult(0.0, "empty_query")

    title_l = (title or "").lower()
    snippet_l = (snippet or "").lower()

    score = 0.0
    reasons: list[str] = []

    # Token match scoring
    # Title matches matter more than snippet matches
    title_hits = sum(1 for t in q_tokens if t in title_l)
    snip_hits = sum(1 for t in q_tokens if t in snippet_l)

    score += title_hits * 3.0
    score += snip_hits * 1.0
    if title_hits:
        reasons.append(f"title_hits={title_hits}")
    if snip_hits:
        reasons.append(f"snippet_hits={snip_hits}")

    # Phrase bonus (exact query appears)
    q_phrase = " ".join(q_tokens)
    if q_phrase and q_phrase in title_l:
        score += 2.0
        reasons.append("phrase_in_title")

    # Negative hint penalties (soft penalties, not filtering)
    neg_hits = 0
    for bad in NEGATIVE_HINTS:
        if bad in title_l or bad in snippet_l:
            neg_hits += 1
    if neg_hits:
        score -= neg_hits * 2.5
        reasons.append(f"neg_hits={neg_hits}")

    # Small quality boost if a price exists
    if has_price:
        score += 0.5
        reasons.append("has_price")

    # Avoid negative scores exploding
    score = max(-10.0, score)

    return ScoreResult(score, ",".join(reasons) if reasons else "no_signals")
