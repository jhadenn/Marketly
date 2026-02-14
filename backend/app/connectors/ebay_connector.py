import base64
import logging
import time

import httpx

from app.connectors.base import MarketplaceConnector
from app.core.config import settings
from app.models.listing import Listing, Money

logger = logging.getLogger(__name__)


class EbayConnector(MarketplaceConnector):
    source_name = "ebay"

    def __init__(self):
        self.client_id = settings.EBAY_CLIENT_ID
        self.client_secret = settings.EBAY_CLIENT_SECRET
        self.marketplace_id = settings.EBAY_MARKETPLACE_ID or "EBAY_CA"
        self.accept_language = settings.EBAY_ACCEPT_LANGUAGE or "en-CA"
        self.environment = (settings.EBAY_ENV or "production").strip().lower()
        self.scope = settings.EBAY_SCOPE or "https://api.ebay.com/oauth/api_scope"

        self._access_token: str | None = None
        self._token_expires_at: float = 0

    def _is_sandbox(self) -> bool:
        return self.environment == "sandbox"

    def _api_base(self) -> str:
        if self._is_sandbox():
            return "https://api.sandbox.ebay.com"
        return "https://api.ebay.com"

    async def _get_access_token(self) -> str:
        now = time.time()
        # Refresh early to avoid edge expirations during request flight.
        if self._access_token and now < (self._token_expires_at - 30):
            return self._access_token

        if not self.client_id or not self.client_secret:
            raise RuntimeError("Missing eBay client credentials")

        basic = base64.b64encode(f"{self.client_id}:{self.client_secret}".encode("utf-8")).decode("utf-8")
        token_url = f"{self._api_base()}/identity/v1/oauth2/token"
        headers = {
            "Authorization": f"Basic {basic}",
            "Content-Type": "application/x-www-form-urlencoded",
        }
        data = {
            "grant_type": "client_credentials",
            "scope": self.scope,
        }

        async with httpx.AsyncClient(timeout=20) as client:
            resp = await client.post(token_url, headers=headers, data=data)
            resp.raise_for_status()
            payload = resp.json()

        token = payload.get("access_token")
        expires_in = int(payload.get("expires_in", 0))
        if not token or expires_in <= 0:
            raise RuntimeError("eBay token response missing access token")

        self._access_token = token
        self._token_expires_at = now + expires_in
        return token

    @staticmethod
    def _build_location(item_location: dict | None) -> str | None:
        if not item_location:
            return None
        parts = [
            item_location.get("city"),
            item_location.get("stateOrProvince"),
            item_location.get("country"),
        ]
        loc = ", ".join([p for p in parts if p])
        return loc or None

    @staticmethod
    def _to_listing(item: dict) -> Listing | None:
        item_id = item.get("itemId")
        title = item.get("title")
        url = item.get("itemWebUrl")
        if not item_id or not title or not url:
            return None

        price_block = item.get("price") or {}
        price_value = price_block.get("value")
        currency = price_block.get("currency") or "CAD"
        price: Money | None = None
        try:
            if price_value is not None:
                price = Money(amount=float(price_value), currency=currency)
        except (TypeError, ValueError):
            price = None

        image_urls: list[str] = []
        image = item.get("image") or {}
        if image.get("imageUrl"):
            image_urls.append(image["imageUrl"])
        for extra in item.get("additionalImages") or []:
            url_extra = extra.get("imageUrl")
            if url_extra:
                image_urls.append(url_extra)

        return Listing(
            source="ebay",
            source_listing_id=item_id,
            title=title,
            price=price,
            url=url,
            image_urls=image_urls,
            location=EbayConnector._build_location(item.get("itemLocation")),
            condition=item.get("condition"),
            snippet=item.get("shortDescription") or item.get("subtitle"),
        )

    async def _search_api(self, query: str, limit: int) -> list[Listing]:
        token = await self._get_access_token()
        url = f"{self._api_base()}/buy/browse/v1/item_summary/search"
        params = {
            "q": query,
            "limit": str(max(1, min(limit, 200))),
        }
        headers = {
            "Authorization": f"Bearer {token}",
            "X-EBAY-C-MARKETPLACE-ID": self.marketplace_id,
            "Accept-Language": self.accept_language,
        }

        async with httpx.AsyncClient(timeout=20) as client:
            resp = await client.get(url, params=params, headers=headers)
            resp.raise_for_status()
            payload = resp.json()

        items = payload.get("itemSummaries") or []
        results: list[Listing] = []
        for item in items:
            listing = self._to_listing(item)
            if listing is not None:
                results.append(listing)
        return results[:limit]

    async def search(self, query: str, limit: int = 20) -> list[Listing]:
        if not self.client_id or not self.client_secret:
            logger.warning("eBay credentials missing, returning no eBay results")
            return []

        try:
            return await self._search_api(query=query, limit=limit)
        except Exception as exc:
            logger.warning("eBay API search failed, returning no eBay results: %s", exc)
            return []
