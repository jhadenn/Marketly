from __future__ import annotations

import asyncio
import json
import logging
import random
from pathlib import Path
from typing import Any
from urllib.parse import urlencode
from urllib.parse import urlparse

from app.connectors.facebook_marketplace.errors import (
    FacebookConnectorError,
    FacebookConnectorErrorCode,
)
from app.connectors.facebook_marketplace.models import (
    FacebookNormalizedListing,
    FacebookSearchRequest,
)
from app.connectors.facebook_marketplace.normalizer import normalize_marketplace_card
from app.core.config import settings

try:
    from playwright.async_api import (
        TimeoutError as PlaywrightTimeoutError,
        async_playwright,
    )
except Exception:  # pragma: no cover - import fallback
    PlaywrightTimeoutError = TimeoutError
    async_playwright = None


logger = logging.getLogger(__name__)

LOGIN_HINTS = (
    "log in to continue",
    "you must log in",
    "see more on facebook",
    "create new account",
)
CHECKPOINT_URL_HINTS = (
    "/checkpoint/",
    "/login/device-based/",
)
CHECKPOINT_TEXT_HINTS = (
    "security check",
    "confirm it is you",
    "confirm it's you",
    "suspicious activity",
    "we need to verify your account",
    "enter the code from your authentication app",
)
BLOCKED_HINTS = (
    "temporarily blocked",
    "unusual activity",
    "unusual traffic",
    "try again later",
)

EXTRACTION_SCRIPT = """
() => {
  const anchors = Array.from(document.querySelectorAll('a[href*="/marketplace/item/"]'));
  const seen = new Set();
  const items = [];

  for (const anchor of anchors) {
    const rawHref = anchor.getAttribute("href") || "";
    if (!rawHref || seen.has(rawHref)) continue;
    seen.add(rawHref);

    let container = anchor;
    for (let i = 0; i < 6; i++) {
      if (!container.parentElement) break;
      container = container.parentElement;
    }

    const rawText = container.innerText || anchor.innerText || "";
    const lines = rawText
      .split(/\\r?\\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    const text = rawText.replace(/\\s+/g, " ").trim();
    const images = Array.from(container.querySelectorAll("img"))
      .map((img) => img.src || "")
      .filter(Boolean);

    items.push({
      href: rawHref,
      title: (anchor.innerText || anchor.getAttribute("aria-label") || "").replace(/\\s+/g, " ").trim(),
      text,
      lines,
      image_urls: images.slice(0, 4),
    });
  }

  return items;
}
"""


def _is_facebook_cookie_domain(domain: str) -> bool:
    normalized = (domain or "").strip().lower().lstrip(".")
    return normalized == "facebook.com" or normalized.endswith(".facebook.com")


def _is_facebook_cookie_url(url: str) -> bool:
    try:
        hostname = (urlparse(str(url)).hostname or "").strip().lower()
    except Exception:
        return False
    return _is_facebook_cookie_domain(hostname)


def sanitize_cookie_payload(payload: Any) -> tuple[list[dict[str, Any]], list[str]]:
    cookies = payload.get("cookies") if isinstance(payload, dict) else payload
    if not isinstance(cookies, list) or not cookies:
        raise FacebookConnectorError(
            FacebookConnectorErrorCode.cookies_invalid,
            "Cookie JSON must contain a non-empty cookie list.",
            retryable=False,
        )

    sanitized: list[dict[str, Any]] = []
    cookie_names: list[str] = []
    for cookie in cookies:
        if not isinstance(cookie, dict):
            continue
        item = dict(cookie)
        if "expires" not in item and "expirationDate" in item:
            try:
                item["expires"] = int(float(item["expirationDate"]))
            except (TypeError, ValueError):
                item.pop("expirationDate", None)
        item.pop("expirationDate", None)
        item.pop("id", None)
        item.pop("storeId", None)
        item.pop("hostOnly", None)
        item.pop("session", None)
        same_site = item.get("sameSite")
        if isinstance(same_site, str):
            normalized_same_site = {
                "no_restriction": "None",
                "unspecified": "Lax",
                "strict": "Strict",
                "lax": "Lax",
                "none": "None",
            }.get(same_site.strip().lower())
            if normalized_same_site:
                item["sameSite"] = normalized_same_site
        if "sameSite" in item and item["sameSite"] not in {"Strict", "Lax", "None"}:
            item.pop("sameSite", None)
        domain = item.get("domain")
        url = item.get("url")
        if "domain" not in item and "url" not in item:
            item["domain"] = ".facebook.com"
            item["path"] = "/"
        elif isinstance(domain, str):
            domain_value = domain.strip()
            if not _is_facebook_cookie_domain(domain_value):
                continue
            if domain_value and not domain_value.startswith("."):
                item["domain"] = f".{domain_value}"
        elif "domain" in item:
            continue
        elif not isinstance(url, str) or not _is_facebook_cookie_url(url):
            continue

        name = str(item.get("name") or "").strip()
        if name:
            cookie_names.append(name)
        sanitized.append(item)

    if not sanitized:
        raise FacebookConnectorError(
            FacebookConnectorErrorCode.cookies_invalid,
            "Cookie JSON did not include valid facebook.com cookie objects.",
            retryable=False,
        )
    return sanitized, cookie_names


class FacebookMarketplaceConnector:
    source_name = "facebook"
    base_url = "https://www.facebook.com/marketplace/search/"

    def __init__(
        self,
        *,
        retries: int | None = None,
        timeout_seconds: float | None = None,
        idle_scroll_limit: int | None = None,
        max_scrolls: int | None = None,
        max_concurrency: int | None = None,
    ) -> None:
        configured_retries = (
            int(settings.MARKETLY_FACEBOOK_RETRIES) if retries is None else int(retries)
        )
        configured_timeout = (
            float(settings.MARKETLY_FACEBOOK_TIMEOUT_SECONDS)
            if timeout_seconds is None
            else float(timeout_seconds)
        )
        configured_idle_scroll_limit = (
            int(settings.MARKETLY_FACEBOOK_IDLE_SCROLL_LIMIT)
            if idle_scroll_limit is None
            else int(idle_scroll_limit)
        )
        configured_max_scrolls = (
            int(settings.MARKETLY_FACEBOOK_MAX_SCROLLS)
            if max_scrolls is None
            else int(max_scrolls)
        )
        configured_max_concurrency = (
            int(settings.MARKETLY_FACEBOOK_MAX_CONCURRENCY)
            if max_concurrency is None
            else int(max_concurrency)
        )

        self.retries = max(1, configured_retries)
        self.timeout_ms = int(max(5, configured_timeout) * 1000)
        self.idle_scroll_limit = max(1, configured_idle_scroll_limit)
        self.max_scrolls = max(4, configured_max_scrolls)
        self._semaphore = asyncio.Semaphore(max(1, configured_max_concurrency))
        self._playwright_driver: Any | None = None
        self._browser: Any | None = None
        self._browser_lock = asyncio.Lock()

    async def _get_browser(self):
        async with self._browser_lock:
            if self._browser is not None and self._browser.is_connected():
                return self._browser
            if self._browser is not None:
                await self._close_browser_locked()
            if self._playwright_driver is None:
                self._playwright_driver = await async_playwright().start()
            self._browser = await self._playwright_driver.chromium.launch(headless=True)
            return self._browser

    async def _close_browser_locked(self) -> None:
        if self._browser is not None:
            try:
                await self._browser.close()
            except Exception:
                pass
            self._browser = None
        if self._playwright_driver is not None:
            try:
                await self._playwright_driver.stop()
            except Exception:
                pass
            self._playwright_driver = None

    async def _invalidate_browser(self) -> None:
        async with self._browser_lock:
            await self._close_browser_locked()

    async def search(self, request: FacebookSearchRequest) -> list[FacebookNormalizedListing]:
        if async_playwright is None:
            raise FacebookConnectorError(
                FacebookConnectorErrorCode.playwright_unavailable,
                "Playwright is not installed. Install it and run `playwright install chromium`.",
                retryable=False,
            )

        last_error: Exception | None = None
        for attempt in range(1, self.retries + 1):
            try:
                async with self._semaphore:
                    return await self._search_once(request)
            except FacebookConnectorError as exc:
                last_error = exc
                if not exc.retryable or attempt >= self.retries:
                    raise
                self._log(
                    "retryable_connector_error",
                    attempt=attempt,
                    code=exc.code.value,
                    message=exc.message,
                )
                await asyncio.sleep(self._retry_delay(attempt))
            except PlaywrightTimeoutError as exc:
                last_error = exc
                if attempt >= self.retries:
                    raise FacebookConnectorError(
                        FacebookConnectorErrorCode.timeout,
                        "Facebook Marketplace request timed out.",
                        retryable=True,
                        details={"attempts": attempt},
                    ) from exc
                await asyncio.sleep(self._retry_delay(attempt))
            except Exception as exc:  # pragma: no cover - network/runtime variability
                if self._is_browser_closed_error(exc):
                    await self._invalidate_browser()
                last_error = exc
                if attempt >= self.retries:
                    raise self._classify_unexpected_error(exc) from exc
                await asyncio.sleep(self._retry_delay(attempt))

        if isinstance(last_error, FacebookConnectorError):
            raise last_error
        raise FacebookConnectorError(
            FacebookConnectorErrorCode.scrape_failed,
            "Failed to scrape Facebook Marketplace.",
            retryable=True,
            details={"error": str(last_error) if last_error else "unknown"},
        )

    def _classify_unexpected_error(self, exc: Exception) -> FacebookConnectorError:
        message = str(exc)
        lowered = message.lower()

        if "executable doesn't exist" in lowered or "playwright install" in lowered:
            return FacebookConnectorError(
                FacebookConnectorErrorCode.playwright_unavailable,
                "Playwright browser binary is missing in the API runtime. Run `python -m playwright install chromium` inside the running environment.",
                retryable=False,
                details={"error": message},
            )

        if "net::err_name_not_resolved" in lowered or "net::err_internet_disconnected" in lowered:
            return FacebookConnectorError(
                FacebookConnectorErrorCode.scrape_failed,
                "Network error while connecting to Facebook Marketplace.",
                retryable=True,
                details={"error": message},
            )

        if self._is_browser_closed_error(exc):
            return FacebookConnectorError(
                FacebookConnectorErrorCode.scrape_failed,
                "Browser context closed unexpectedly during scrape.",
                retryable=True,
                details={"error": message},
            )

        return FacebookConnectorError(
            FacebookConnectorErrorCode.scrape_failed,
            "Failed to scrape Facebook Marketplace.",
            retryable=True,
            details={"error": message},
        )

    @staticmethod
    def _is_browser_closed_error(exc: Exception) -> bool:
        lowered = str(exc).lower()
        return (
            "target page, context or browser has been closed" in lowered
            or "browser has been closed" in lowered
        )

    async def _search_once(self, request: FacebookSearchRequest) -> list[FacebookNormalizedListing]:
        search_url = self._build_search_url(request)
        self._log(
            "facebook_search_start",
            auth_mode=request.auth_mode,
            limit=request.limit,
            query=request.query,
            url=search_url,
        )

        browser = await self._get_browser()
        context = await browser.new_context(
            user_agent=(
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/122.0.0.0 Safari/537.36"
            ),
            locale="en-CA",
        )
        context.set_default_timeout(self.timeout_ms)

        try:
            if request.auth_mode == "cookie":
                if request.cookie_payload is not None:
                    await self._load_cookie_payload(context, request.cookie_payload)
                else:
                    await self._load_cookies(context, request.cookie_path)

            page = await context.new_page()
            if settings.MARKETLY_FACEBOOK_BOOTSTRAP_HOME and request.auth_mode == "cookie":
                await page.goto("https://www.facebook.com/", wait_until="domcontentloaded")
                await self._jitter_sleep()
            await page.goto(search_url, wait_until="domcontentloaded")

            if request.multi_source:
                max_scrolls = self.max_scrolls
                idle_scroll_limit = self.idle_scroll_limit
            else:
                max_scrolls = max(
                    self.max_scrolls, int(settings.MARKETLY_FACEBOOK_MAX_SCROLLS_SINGLE_SOURCE)
                )
                idle_scroll_limit = max(
                    self.idle_scroll_limit,
                    int(settings.MARKETLY_FACEBOOK_IDLE_SCROLL_LIMIT_SINGLE_SOURCE),
                )
            raw_cards = await self._scroll_and_extract(
                page=page,
                target_limit=request.limit,
                max_scrolls=max_scrolls,
                idle_scroll_limit=idle_scroll_limit,
            )
            normalized = self._normalize_cards(
                raw_cards,
                limit=request.limit,
                fallback_latitude=request.latitude,
                fallback_longitude=request.longitude,
            )

            if not normalized:
                await self._raise_if_blocked(page, extracted_cards=len(raw_cards))
                raise FacebookConnectorError(
                    FacebookConnectorErrorCode.empty_results,
                    "No listings were extracted from Facebook Marketplace.",
                    retryable=False,
                )

            self._log(
                "facebook_search_complete",
                extracted=len(raw_cards),
                normalized=len(normalized),
                query=request.query,
            )
            return normalized
        except Exception as exc:
            if self._is_browser_closed_error(exc):
                await self._invalidate_browser()
            raise
        finally:
            try:
                await context.close()
            except Exception:
                pass

    def _build_search_url(self, request: FacebookSearchRequest) -> str:
        params: dict[str, Any] = {
            "query": request.query,
        }
        if request.location_text:
            params["location"] = request.location_text
        if request.latitude is not None and request.longitude is not None:
            params["latitude"] = request.latitude
            params["longitude"] = request.longitude
        if request.radius_km is not None:
            params["radiusKM"] = request.radius_km
        if request.min_price is not None:
            params["minPrice"] = int(request.min_price)
        if request.max_price is not None:
            params["maxPrice"] = int(request.max_price)
        if request.condition:
            params["itemCondition"] = request.condition.lower()
        sort_map = {
            "newest": "creation_time_descend",
            "price_low_to_high": "price_ascend",
            "price_high_to_low": "price_descend",
        }
        if request.sort in sort_map:
            params["sortBy"] = sort_map[request.sort]
        return f"{self.base_url}?{urlencode(params)}"

    async def _load_cookies(self, context, cookie_path: str) -> None:
        cookie_file = Path(cookie_path)
        if not cookie_file.exists():
            raise FacebookConnectorError(
                FacebookConnectorErrorCode.cookies_missing,
                f"Cookie file not found: {cookie_path}",
                retryable=False,
            )

        try:
            payload = json.loads(cookie_file.read_text(encoding="utf-8"))
        except Exception as exc:
            raise FacebookConnectorError(
                FacebookConnectorErrorCode.cookies_invalid,
                f"Cookie file is not valid JSON: {cookie_path}",
                retryable=False,
                details={"error": str(exc)},
            ) from exc
        await self._load_cookie_payload(context, payload, cookie_label=cookie_path)

    async def _load_cookie_payload(self, context, payload: Any, *, cookie_label: str = "__in_memory__") -> None:
        sanitized, cookie_names = sanitize_cookie_payload(payload)
        await context.add_cookies(sanitized)
        self._log(
            "cookies_loaded",
            count=len(sanitized),
            cookie_path=cookie_label,
            names=sorted(set(cookie_names)),
        )

    async def _scroll_and_extract(
        self,
        *,
        page,
        target_limit: int,
        max_scrolls: int | None = None,
        idle_scroll_limit: int | None = None,
    ) -> list[dict[str, Any]]:
        scroll_budget = self.max_scrolls if max_scrolls is None else max_scrolls
        max_scrolls = max(4, min(scroll_budget, target_limit + 4))
        idle_limit = self.idle_scroll_limit if idle_scroll_limit is None else idle_scroll_limit
        idle_scrolls = 0
        seen_urls: set[str] = set()
        merged: list[dict[str, Any]] = []

        for scroll_index in range(max_scrolls):
            cards = await page.evaluate(EXTRACTION_SCRIPT)

            new_count = 0
            for card in cards or []:
                href = str(card.get("href") or "").strip()
                if not href or href in seen_urls:
                    continue
                seen_urls.add(href)
                merged.append(card)
                new_count += 1

            self._log(
                "scroll_iteration",
                iteration=scroll_index + 1,
                new_cards=new_count,
                total_cards=len(merged),
            )

            if len(merged) >= target_limit:
                break

            if new_count == 0:
                idle_scrolls += 1
            else:
                idle_scrolls = 0
            if idle_scrolls >= idle_limit:
                break

            await page.mouse.wheel(0, random.randint(1000, 1700))
            await self._jitter_sleep()

        return merged

    def _normalize_cards(
        self,
        cards: list[dict[str, Any]],
        *,
        limit: int,
        fallback_latitude: float | None = None,
        fallback_longitude: float | None = None,
    ) -> list[FacebookNormalizedListing]:
        dedupe: set[str] = set()
        records: list[FacebookNormalizedListing] = []
        skipped = 0

        for card in cards:
            if fallback_latitude is not None and "latitude" not in card:
                card["latitude"] = fallback_latitude
            if fallback_longitude is not None and "longitude" not in card:
                card["longitude"] = fallback_longitude
            listing = normalize_marketplace_card(card)
            if listing is None:
                skipped += 1
                continue
            dedup_key = listing.external_id or listing.dedup_key
            if dedup_key in dedupe:
                continue
            dedupe.add(dedup_key)
            records.append(listing)
            if len(records) >= limit:
                break

        if skipped:
            self._log("normalize_skipped_cards", skipped=skipped, total=len(cards))

        return records

    async def _raise_if_blocked(self, page, *, extracted_cards: int = 0) -> None:
        url = (page.url or "").lower()
        try:
            body_text = (await page.evaluate("() => (document.body ? document.body.innerText : '')")).lower()
        except Exception:
            body_text = ""

        # If cards are extracted and URL is not an explicit checkpoint path, do not false-positive.
        if extracted_cards > 0 and not any(hint in url for hint in CHECKPOINT_URL_HINTS):
            return

        if any(hint in url for hint in CHECKPOINT_URL_HINTS) or any(
            hint in body_text for hint in CHECKPOINT_TEXT_HINTS
        ):
            self._log(
                "blocked_checkpoint",
                url=url,
                extracted_cards=extracted_cards,
            )
            raise FacebookConnectorError(
                FacebookConnectorErrorCode.checkpoint,
                "Facebook checkpoint detected; authentication verification is required.",
                retryable=False,
            )

        if any(hint in body_text for hint in LOGIN_HINTS):
            self._log(
                "blocked_login_wall",
                url=url,
                extracted_cards=extracted_cards,
            )
            raise FacebookConnectorError(
                FacebookConnectorErrorCode.login_wall,
                "Facebook login wall detected. Try cookie mode with valid session cookies.",
                retryable=False,
            )

        if any(hint in body_text for hint in BLOCKED_HINTS):
            self._log(
                "blocked_rate_limit",
                url=url,
                extracted_cards=extracted_cards,
            )
            raise FacebookConnectorError(
                FacebookConnectorErrorCode.blocked,
                "Facebook temporarily blocked this scraping session.",
                retryable=True,
            )

    @staticmethod
    def _retry_delay(attempt: int) -> float:
        base = min(1.5 * attempt, 6.0)
        return base + random.uniform(0.15, 0.75)

    @staticmethod
    async def _jitter_sleep() -> None:
        jitter_min = max(0.0, float(settings.MARKETLY_FACEBOOK_JITTER_MIN_SECONDS))
        jitter_max = max(0.0, float(settings.MARKETLY_FACEBOOK_JITTER_MAX_SECONDS))
        if jitter_max < jitter_min:
            jitter_min, jitter_max = jitter_max, jitter_min
        await asyncio.sleep(random.uniform(jitter_min, jitter_max))

    def _log(self, event: str, **payload: Any) -> None:
        logger.info(json.dumps({"event": event, **payload}))
