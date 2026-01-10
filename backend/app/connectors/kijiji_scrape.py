import json
from urllib.parse import urlparse

import re
from urllib.parse import quote_plus

import httpx
from selectolax.parser import HTMLParser

from app.connectors.base import MarketplaceConnector
from app.models.listing import Listing, Money


class KijijiScrapeConnector(MarketplaceConnector):
    source_name = "kijiji"

    def __init__(self, region: str = "canada"):
        # region examples: "canada", or a city/area path if you later want it
        self.region = region

        self._headers = {
            # A realistic UA helps avoid instant blocks
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                          "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            "Accept-Language": "en-CA,en;q=0.9",
        }

    def _build_search_url(self, query: str) -> str:
        """
        Kijiji URL patterns can vary by category/region.
        This pattern works often, but if it doesn't, do this:
        1) search manually on kijiji.ca
        2) copy the resulting URL
        3) update this function to match that pattern
        """
        q = quote_plus(query)
        # Common pattern:
        # https://www.kijiji.ca/b-buy-sell/canada/<query>/k0l0
        return f"https://www.kijiji.ca/b-buy-sell/{self.region}/c10l0?query={q}"

    def _parse_price(self, text: str) -> float | None:
        # Examples: "$1,200.00", "$1200", "Free", "Please Contact"
        t = text.strip().lower()
        if "free" in t:
            return 0.0
        if "please contact" in t:
            return None

        # Extract numbers like 1,200.00
        m = re.search(r"([\d][\d,]*(?:\.\d{1,2})?)", text.replace(",", ""))
        if not m:
            return None
        try:
            return float(m.group(1))
        except ValueError:
            return None

    def _extract_listing_id(self, url: str) -> str:
    # Kijiji often uses adId in the URL path (not always). We’ll fallback to URL.
    # Example paths can look like: /v-something/1234567890
        path = urlparse(url).path
        parts = [p for p in path.split("/") if p]
        for p in reversed(parts):
            if p.isdigit():
                return p
        return url

    def _abs_url(self, url: str) -> str:
        if url.startswith("/"):
            return "https://www.kijiji.ca" + url
        return url

    def _parse_json_ld_itemlist(self, html: str) -> list[dict]:
        tree = HTMLParser(html)
        scripts = tree.css("script[type='application/ld+json']")
        payloads: list[dict] = []

        for s in scripts:
            raw = s.text(strip=True)
            if not raw:
                continue

            # Some sites embed multiple JSON objects; try best-effort
            try:
                data = json.loads(raw)
            except Exception:
                continue

            def collect(obj):
                if isinstance(obj, dict):
                    payloads.append(obj)
                    # JSON-LD can store items in @graph
                    g = obj.get("@graph")
                    if isinstance(g, list):
                        for x in g:
                            if isinstance(x, dict):
                                payloads.append(x)
                elif isinstance(obj, list):
                    for x in obj:
                        collect(x)

            collect(data)

        items: list[dict] = []

        for p in payloads:
            if p.get("@type") == "ItemList" and isinstance(p.get("itemListElement"), list):
                for entry in p.get("itemListElement", []):
                    if isinstance(entry, dict) and isinstance(entry.get("item"), dict):
                        items.append(entry["item"])

        return items



    async def search(self, query: str, limit: int = 20) -> list[Listing]:
        url = self._build_search_url(query)

        async with httpx.AsyncClient(
            timeout=15,
            headers=self._headers,
            follow_redirects=True
        ) as client:
            r = await client.get(url)
            r.raise_for_status()

        html = r.text

        # ✅ Primary path: parse JSON-LD ItemList (what your debug output shows)
        items = self._parse_json_ld_itemlist(html)

        results: list[Listing] = []
        for it in items:
            if len(results) >= limit:
                break

            title = (it.get("name") or "").strip()
            if not title:
                continue

            listing_url = it.get("url")
            if not listing_url:
                continue
            listing_url = self._abs_url(listing_url)

            desc = it.get("description")

            # Images: can be string or list
            imgs = it.get("image")
            image_urls: list[str] = []
            if isinstance(imgs, str) and imgs:
                image_urls = [imgs]
            elif isinstance(imgs, list):
                image_urls = [x for x in imgs if isinstance(x, str)]

            # Offers -> price/currency
            offers = it.get("offers") or {}
            price_val = 0.0
            currency = "CAD"

            # offers can be dict or list
            if isinstance(offers, list) and offers:
                offers = offers[0]

            if isinstance(offers, dict):
                currency = offers.get("priceCurrency") or currency
                p = offers.get("price")
                try:
                    if p is not None:
                        price_val = float(p)
                except Exception:
                    price_val = 0.0

            results.append(
                Listing(
                    source="kijiji",
                    source_listing_id=self._extract_listing_id(listing_url),
                    title=title,
                    price=Money(amount=price_val, currency=currency),
                    url=listing_url,
                    image_urls=image_urls,
                    location=None,
                    condition=None,
                    snippet=desc,
                )
            )
            print("DEBUG URL:", listing_url)


    # Fallback path: if JSON-LD fails, you can keep your old CSS scraping here later.
        return results
