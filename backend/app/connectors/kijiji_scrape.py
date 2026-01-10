import re
from urllib.parse import quote_plus, urljoin

import httpx
from bs4 import BeautifulSoup

from app.connectors.base import MarketplaceConnector
from app.models.listing import Listing, Money

BASE = "https://www.kijiji.ca"

# Matches URLs like:
# /v-cell-phone/edmonton/iphone-12-and-iphone-xr/1731510626
LISTING_HREF_RE = re.compile(r"^/v-[^/]+/.+/\d+/?$")

PRICE_RE = re.compile(r"\$\s*([\d,]+(?:\.\d{1,2})?)")


class KijijiScrapeConnector(MarketplaceConnector):
    source_name = "kijiji"

    def __init__(self, region: str = "canada"):
        self.region = region
        self._headers = {
            "User-Agent": (
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
            ),
            "Accept-Language": "en-CA,en;q=0.9",
        }

    def _build_search_url(self, query: str) -> str:
        # This URL pattern matches what you see in the browser for “iphone” searches
        # e.g. https://www.kijiji.ca/b-canada/iphone/k0l0?dc=true&view=list
        q = quote_plus(query.strip())
        return f"{BASE}/b-canada/{q}/k0l0?dc=true&view=list"

    def _abs_url(self, href: str) -> str:
        return urljoin(BASE, href)

    def _parse_price(self, text: str) -> float | None:
        if not text:
            return None
        t = text.strip().lower()
        if "free" in t:
            return 0.0
        if "please contact" in t:
            return None
        m = PRICE_RE.search(text)
        if not m:
            return None
        val = m.group(1).replace(",", "")
        try:
            return float(val)
        except ValueError:
            return None

    def _token_score(self, query: str, title: str) -> int:
        # Generic relevance scoring (works for any item type, not just iphones)
        q_tokens = [t.lower() for t in query.split() if len(t) >= 2]
        t = (title or "").lower()
        return sum(1 for tok in q_tokens if tok in t)

    async def search(self, query: str, limit: int = 20) -> list[Listing]:
        url = self._build_search_url(query)

        async with httpx.AsyncClient(
            timeout=20,
            headers=self._headers,
            follow_redirects=True,
        ) as client:
            r = await client.get(url)
            r.raise_for_status()

        soup = BeautifulSoup(r.text, "lxml")
        # DEBUG: show what links exist in the HTML we received
        hrefs = [a.get("href") for a in soup.find_all("a", href=True)]
        print("KIJIJI(BS4): total <a href> =", len(hrefs))
        print("KIJIJI(BS4): first 40 hrefs =", hrefs[:40])

        v_links = [h for h in hrefs if h and "/v-" in h]
        print("KIJIJI(BS4): links containing /v- =", len(v_links))
        print("KIJIJI(BS4): first 20 /v- links =", v_links[:20])

        # 1) Grab candidate listing links
        anchors = soup.find_all("a", href=True)
        candidates: list[tuple[int, str, str, str]] = []
        # tuple: (score, url, title, blob_text)

        seen = set()

        for a in anchors:
            href = a.get("href", "")
            if not href:
                continue

            # Normalize absolute vs relative
            if href.startswith("http"):
                # absolute url
                if "kijiji.ca" not in href:
                    continue
                path = href.replace(BASE, "")  # convert to /v-...
                full_url = href
            else:
                # relative url like /v-...
                path = href
                full_url = self._abs_url(href)

            # Now apply regex to the PATH
            if not LISTING_HREF_RE.match(path):
                continue
            if full_url in seen:
                continue
            seen.add(full_url)

            # 2) Find a reasonable “card container” around this link
            container = a
            for _ in range(6):
                if container.parent:
                    container = container.parent
                else:
                    break

            blob = container.get_text(" ", strip=True)
            # title: prefer visible text near the link; fallback to blob
            title = a.get_text(" ", strip=True) or ""
            if not title or len(title) < 4:
                # sometimes the link text is empty; try h3/h2 in container
                h = container.find(["h3", "h2"])
                if h:
                    title = h.get_text(" ", strip=True) or title

            title = (title or "").strip()
            if not title:
                continue

            score = self._token_score(query, title)
            candidates.append((score, full_url, title, blob))

        # 3) Sort by relevance score (descending), then take top N
        candidates.sort(key=lambda x: x[0], reverse=True)

        results: list[Listing] = []
        for score, listing_url, title, blob in candidates:
            if len(results) >= limit:
                break

            # If the query has tokens, require at least ONE token hit.
            # (This prevents random junk, but won’t kill results for broad searches.)
            if query.strip() and score == 0:
                continue

            price_val = self._parse_price(blob)
            image_urls: list[str] = []

            # Try to grab an image near the listing card (best-effort)
            # We need to refind the card by URL: quick hack via searching the soup again.
            card_link = soup.find("a", href=re.compile(re.escape(listing_url.replace(BASE, ""))))
            if card_link:
                card = card_link
                for _ in range(6):
                    if card.parent:
                        card = card.parent
                    else:
                        break
                img = card.find("img")
                if img:
                    src = img.get("src") or img.get("data-src")
                    if src:
                        image_urls = [src]

            results.append(
                Listing(
                    source="kijiji",
                    source_listing_id=listing_url,  # MVP: use URL as id
                    title=title,
                    price=Money(amount=price_val or 0.0, currency="CAD"),
                    url=listing_url,
                    image_urls=image_urls,
                    location=None,
                    condition=None,
                    snippet=None,
                )
            )

        print("KIJIJI(BS4): url =", url)
        print("KIJIJI(BS4): candidates =", len(candidates), "returned =", len(results))
        if results:
            print("KIJIJI(BS4): top titles =", [r.title for r in results[:10]])

        return results
