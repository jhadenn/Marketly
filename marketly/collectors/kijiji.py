import re
from urllib.parse import urljoin

import requests
from bs4 import BeautifulSoup

from marketly.models.listing import Listing

BASE = "https://www.kijiji.ca"
HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                  "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
}

LISTING_HREF_RE = re.compile(r"(?:https?://www\.kijiji\.ca)?/v-[^/]+/[^/]+/[^/]+/\d+")

def _price_to_cents(text: str):
    if not text:
        return None
    m = re.search(r"\$\s?([\d,]+(?:\.\d{2})?)", text)
    if not m:
        return None
    val = m.group(1).replace(",", "")
    return int(round(float(val) * 100))

def search(search_url: str) -> list[Listing]:
    r = requests.get(search_url, headers=HEADERS, timeout=30)
    r.raise_for_status()

    soup = BeautifulSoup(r.text, "lxml")

        # DEBUG: show some hrefs so we can see the page structure
    hrefs = [a["href"] for a in soup.find_all("a", href=True)]
    print("DEBUG total links:", len(hrefs))
    print("DEBUG first 30 hrefs:")
    for h in hrefs[:30]:
        print("  ", h)


    results: list[Listing] = []
    seen = set()

    for a in soup.find_all("a", href=True):
        href = a["href"]
        if not LISTING_HREF_RE.search(href):
            continue

        url = href if href.startswith("http") else urljoin(BASE, href)
        if url in seen:
            continue
        seen.add(url)

        title = a.get_text(" ", strip=True) or "Untitled"

        # Heuristic: scan nearby text for a price
        container = a
        for _ in range(4):
            if container.parent:
                container = container.parent
        blob = container.get_text(" ", strip=True)
        price_cents = _price_to_cents(blob)

        results.append(Listing(
            platform="kijiji",
            title=title,
            price_cents=price_cents,
            currency="CAD",
            location=None,
            url=url,
        ))

    return results
