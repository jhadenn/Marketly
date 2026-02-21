from __future__ import annotations

import json
import re
from pathlib import Path

from app.connectors.base import MarketplaceConnector
from app.connectors.facebook_marketplace.connector import FacebookMarketplaceConnector
from app.connectors.facebook_marketplace.errors import (
    FacebookConnectorError,
    FacebookConnectorErrorCode,
)
from app.connectors.facebook_marketplace.models import (
    FacebookNormalizedListing,
    FacebookSearchRequest,
)
from app.core.config import settings
from app.models.listing import Listing, Money

QUERY_TOKEN_RE = re.compile(r"[a-z0-9]+")


def _to_listing(item: FacebookNormalizedListing) -> Listing:
    price: Money | None = None
    if item.price_value is not None:
        currency = (item.price_currency or "CAD").upper()[:3]
        try:
            price = Money(amount=float(item.price_value), currency=currency)
        except (TypeError, ValueError):
            price = None

    snippet_parts: list[str] = []
    if item.seller_name:
        snippet_parts.append(f"Seller: {item.seller_name}")
    if item.age_hint:
        snippet_parts.append(item.age_hint)
    snippet = " | ".join(snippet_parts) if snippet_parts else None

    return Listing(
        source="facebook",
        source_listing_id=item.external_id or item.dedup_key,
        title=item.title,
        price=price,
        url=item.listing_url,
        image_urls=item.image_urls,
        location=item.location_text,
        condition=None,
        snippet=snippet,
    )


def _query_tokens(query: str) -> set[str]:
    return {
        token
        for token in QUERY_TOKEN_RE.findall((query or "").lower())
        if len(token) >= 2
    }


def _looks_like_noise_item(item: FacebookNormalizedListing, query: str) -> bool:
    title = (item.title or "").strip().lower()
    raw_text = str((item.raw or {}).get("text") or "").lower()
    title_tokens = set(QUERY_TOKEN_RE.findall(title))
    query_tokens = _query_tokens(query)
    token_hits = len(title_tokens.intersection(query_tokens))

    if "sponsored" in raw_text:
        return True
    if title.startswith("unread") or " unread" in raw_text:
        return True
    if title.startswith("marketplace"):
        return True

    # Common junk cards in FB feeds are off-query/no-image placeholders.
    if token_hits == 0 and not item.image_urls:
        return True
    if token_hits == 0 and (item.price_value or 0) >= 1000 and not item.image_urls:
        return True

    return False


class FacebookUnifiedConnector(MarketplaceConnector):
    source_name = "facebook"

    def __init__(self) -> None:
        self._connector = FacebookMarketplaceConnector()

    @staticmethod
    def _resolve_cookie_path(cookie_path: str) -> str:
        """
        Docker runs the backend with /app as the working directory (backend root).
        People often set MARKETLY_FACEBOOK_COOKIE_PATH to "backend/secrets/..."
        from the repo root. This normalizes to an existing path if possible.
        """
        raw = (cookie_path or "").strip()
        if not raw:
            return raw
        p = Path(raw)
        if p.exists():
            return raw
        if raw.replace("\\", "/").startswith("backend/"):
            candidate = raw.replace("\\", "/")[len("backend/") :]
            if Path(candidate).exists():
                return candidate
        return raw

    @staticmethod
    def _read_cookie_metadata(cookie_path: str) -> tuple[int, set[str]]:
        cookie_path = FacebookUnifiedConnector._resolve_cookie_path(cookie_path)
        path = Path(cookie_path)
        if not path.exists():
            return 0, set()

        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
        except Exception:
            return 0, set()

        cookies = payload.get("cookies") if isinstance(payload, dict) else payload
        if not isinstance(cookies, list):
            return 0, set()

        names: set[str] = set()
        for cookie in cookies:
            if not isinstance(cookie, dict):
                continue
            name = str(cookie.get("name") or "").strip()
            if name:
                names.add(name)
        return len(cookies), names

    async def search(self, query: str, limit: int = 20) -> list[Listing]:
        auth_mode = (settings.MARKETLY_FACEBOOK_AUTH_MODE or "guest").strip().lower()
        if auth_mode not in {"guest", "cookie"}:
            auth_mode = "guest"
        cookie_path = self._resolve_cookie_path(settings.MARKETLY_FACEBOOK_COOKIE_PATH)
        cookie_count, cookie_names = self._read_cookie_metadata(cookie_path)
        if auth_mode == "cookie":
            missing_required = {"c_user", "xs"} - cookie_names
            if missing_required:
                raise FacebookConnectorError(
                    code=FacebookConnectorErrorCode.cookies_invalid,
                    message=(
                        "Cookie mode requires at least c_user and xs cookies. "
                        f"Missing: {sorted(missing_required)}."
                    ),
                    retryable=False,
                    details={"cookie_path": cookie_path, "cookie_count": cookie_count},
                )
            if cookie_count < 4:
                raise FacebookConnectorError(
                    code=FacebookConnectorErrorCode.cookies_invalid,
                    message=(
                        "Cookie file appears incomplete (too few cookies). "
                        "Export the full facebook.com cookie jar, not only c_user/xs."
                    ),
                    retryable=False,
                    details={"cookie_path": cookie_path, "cookie_count": cookie_count},
                )
        request = FacebookSearchRequest(
            query=query,
            limit=limit,
            auth_mode=auth_mode,
            cookie_path=cookie_path,
            ingest=False,
        )
        try:
            records = await self._connector.search(request)
            filtered = [item for item in records if not _looks_like_noise_item(item, query)]
            return [_to_listing(item) for item in filtered]
        except FacebookConnectorError as exc:
            # If guest mode is blocked, auto-retry once with cookies if a cookie file exists.
            if (
                auth_mode == "guest"
                and exc.code in {FacebookConnectorErrorCode.login_wall, FacebookConnectorErrorCode.checkpoint}
                and Path(cookie_path).exists()
            ):
                fallback_request = request.model_copy(update={"auth_mode": "cookie"})
                records = await self._connector.search(fallback_request)
                filtered = [item for item in records if not _looks_like_noise_item(item, query)]
                return [_to_listing(item) for item in filtered]

            if auth_mode == "guest" and exc.code in {
                FacebookConnectorErrorCode.login_wall,
                FacebookConnectorErrorCode.checkpoint,
            }:
                raise FacebookConnectorError(
                    code=exc.code,
                    message=(
                        f"{exc.message} Guest mode is often gated by Facebook. "
                        f"Use cookie mode and provide {cookie_path}."
                    ),
                    retryable=exc.retryable,
                    details=exc.details,
                ) from exc

            if auth_mode == "cookie" and exc.code in {
                FacebookConnectorErrorCode.login_wall,
                FacebookConnectorErrorCode.checkpoint,
            }:
                raise FacebookConnectorError(
                    code=exc.code,
                    message=(
                        f"{exc.message} Cookie mode was used, but Facebook still challenged the session. "
                        "Refresh/export cookies again (full jar) and retry."
                    ),
                    retryable=exc.retryable,
                    details={
                        **(exc.details or {}),
                        "cookie_path": cookie_path,
                        "cookie_count": cookie_count,
                    },
                ) from exc

            raise
