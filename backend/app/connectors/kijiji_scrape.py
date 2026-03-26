import re
from datetime import datetime
from urllib.parse import quote_plus, urljoin

import httpx
from bs4 import BeautifulSoup

from app.connectors.base import MarketplaceConnector
from app.connectors.vehicle_metadata import extract_vehicle_mileage_km
from app.core.time_utils import parse_absolute_date_to_utc_iso, parse_relative_age_to_utc_iso
from app.models.listing import Listing, Money, SearchSort

BASE = "https://www.kijiji.ca"

# Matches URLs like:
# /v-cell-phone/edmonton/iphone-12-and-iphone-xr/1731510626
LISTING_HREF_RE = re.compile(r"^/v-[^/]+/.+/\d+/?$")

PRICE_RE = re.compile(r"\$\s*([\d,]+(?:\.\d{1,2})?)")
RELATIVE_POSTED_RE = re.compile(
    r"\b(?:posted|updated)?\s*(just listed|\d+\s+(?:minute|hour|day|week|month|year)s?\s+ago|today|yesterday)\b",
    re.IGNORECASE,
)
ABSOLUTE_POSTED_RE = re.compile(
    r"\b(?:posted|updated)(?:\s+on)?\s+([A-Za-z]+\s+\d{1,2},\s+\d{4}|\d{4}[-/]\d{2}[-/]\d{2})\b",
    re.IGNORECASE,
)
CANADA_PROVINCE_RE = re.compile(
    r"\b(?P<city>[A-Za-zÀ-ÿ0-9' .-]{2,60}),\s*"
    r"(?P<province>AB|BC|MB|NB|NL|NS|NT|NU|ON|PE|QC|SK|YT)\b"
)


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

    def _build_search_url(
        self,
        query: str,
        page: int = 1,
        *,
        sort: SearchSort = "relevance",
    ) -> str:
        q = quote_plus(query.strip())
        sort_fragment = "&sortByName=dateDesc" if sort == "newest" else ""
        if page <= 1:
            return f"{BASE}/b-canada/{q}/k0l0?dc=true&view=list{sort_fragment}"
        return f"{BASE}/b-canada/{q}/page-{page}/k0l0?dc=true&view=list{sort_fragment}"

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
        q_tokens = [t.lower() for t in query.split() if len(t) >= 2]
        t = (title or "").lower()
        return sum(1 for tok in q_tokens if tok in t)

    def _clean_snippet(self, title: str, blob: str) -> str | None:
        text = " ".join((blob or "").split())
        if not text:
            return None

        stripped_title = (title or "").strip()
        if stripped_title:
            text = text.replace(stripped_title, "", 1).strip(" -|:")
        text = re.sub(r"\s+", " ", text).strip()
        if not text or text.lower() == stripped_title.lower():
            return None
        if len(text) > 240:
            text = text[:237].rstrip() + "..."
        return text

    def _extract_location_from_listing_url(self, listing_url: str) -> str | None:
        path = listing_url.replace(BASE, "")
        parts = [part for part in path.split("/") if part]
        if len(parts) < 2:
            return None
        city_slug = parts[1].strip().lower()
        if not city_slug:
            return None
        city = city_slug.replace("-", " ").title()
        return city or None

    def _extract_location(self, blob: str, listing_url: str) -> str | None:
        compact_blob = " ".join((blob or "").split())
        if compact_blob:
            location_match = CANADA_PROVINCE_RE.search(compact_blob)
            if location_match:
                city = location_match.group("city").strip(" -|:")
                province = location_match.group("province").upper()
                if city:
                    return f"{city}, {province}"
        return self._extract_location_from_listing_url(listing_url)

    def _extract_posted_at(self, blob: str, *, now: datetime | None = None) -> str | None:
        if not blob:
            return None

        relative_match = RELATIVE_POSTED_RE.search(blob)
        if relative_match:
            return parse_relative_age_to_utc_iso(relative_match.group(1), now=now)

        absolute_match = ABSOLUTE_POSTED_RE.search(blob)
        if absolute_match:
            return parse_absolute_date_to_utc_iso(absolute_match.group(1), now=now)

        return None

    def _extract_vehicle_mileage_km(self, title: str, blob: str, listing_url: str) -> float | None:
        return extract_vehicle_mileage_km(title, blob, listing_url)

    def _extract_candidates(
        self,
        *,
        query: str,
        soup: BeautifulSoup,
        seen_urls: set[str],
    ) -> list[tuple[int, str, str, str, list[str]]]:
        anchors = soup.find_all("a", href=True)
        candidates: list[tuple[int, str, str, str, list[str]]] = []

        for anchor in anchors:
            href = anchor.get("href", "")
            if not href:
                continue

            if href.startswith("http"):
                if "kijiji.ca" not in href:
                    continue
                path = href.replace(BASE, "")
                full_url = href
            else:
                path = href
                full_url = self._abs_url(href)

            if not LISTING_HREF_RE.match(path):
                continue
            if full_url in seen_urls:
                continue

            container = anchor
            for _ in range(6):
                if container.parent:
                    container = container.parent
                else:
                    break

            blob = container.get_text(" ", strip=True)
            title = anchor.get_text(" ", strip=True) or ""
            if not title or len(title) < 4:
                heading = container.find(["h3", "h2"])
                if heading:
                    title = heading.get_text(" ", strip=True) or title

            title = (title or "").strip()
            if not title:
                continue

            image_urls: list[str] = []
            img = container.find("img")
            if img:
                src = img.get("src") or img.get("data-src")
                if src:
                    image_urls = [src]

            score = self._token_score(query, title)
            candidates.append((score, full_url, title, blob, image_urls))
            seen_urls.add(full_url)

        return candidates

    async def search(
        self,
        query: str,
        limit: int = 20,
        *,
        sort: SearchSort = "relevance",
    ) -> list[Listing]:
        safe_limit = max(1, int(limit))
        max_pages = max(1, min(10, (safe_limit // 24) + 2))
        all_candidates: list[tuple[int, str, str, str, list[str]]] = []
        seen_urls: set[str] = set()

        async with httpx.AsyncClient(
            timeout=20,
            headers=self._headers,
            follow_redirects=True,
        ) as client:
            for page in range(1, max_pages + 1):
                url = self._build_search_url(query, page=page, sort=sort)
                try:
                    response = await client.get(url)
                    response.raise_for_status()
                except Exception:
                    if page == 1:
                        raise
                    break

                soup = BeautifulSoup(response.text, "lxml")
                page_candidates = self._extract_candidates(
                    query=query,
                    soup=soup,
                    seen_urls=seen_urls,
                )
                if not page_candidates:
                    break
                all_candidates.extend(page_candidates)

                if len(all_candidates) >= safe_limit * 2:
                    break

        if sort == "relevance":
            all_candidates.sort(key=lambda item: item[0], reverse=True)

        results: list[Listing] = []
        for score, listing_url, title, blob, image_urls in all_candidates:
            if len(results) >= safe_limit:
                break
            if query.strip() and score == 0:
                continue

            price_val = self._parse_price(blob)
            results.append(
                Listing(
                    source="kijiji",
                    source_listing_id=listing_url,
                    title=title,
                    price=Money(amount=price_val or 0.0, currency="CAD"),
                    url=listing_url,
                    image_urls=image_urls,
                    location=self._extract_location(blob, listing_url),
                    condition=None,
                    snippet=self._clean_snippet(title, blob),
                    posted_at=self._extract_posted_at(blob),
                    vehicle_mileage_km=self._extract_vehicle_mileage_km(title, blob, listing_url),
                )
            )

        return results
