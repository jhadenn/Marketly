# Facebook Marketplace Connector (MVP)

This connector uses Playwright to attempt dynamic extraction from Facebook Marketplace search pages.

## What it supports

- Inputs:
  - `query`
  - `location_text` or `latitude`/`longitude`
  - `radius_km`
  - `min_price` / `max_price`
  - `condition`
  - `sort`
  - `limit`
  - `auth_mode` (`guest` or `cookie`)
  - `cookie_path`
- Output: normalized `facebook_marketplace` records with derived features (`price_bucket`, `title_keywords`, `has_images`, `location_quality`, `age_hint`, `dedup_key`).

## Local setup

1. Install backend deps:

```powershell
cd backend
pip install -e ".[dev]"
```

2. Install Playwright browser:

```powershell
playwright install chromium
```

3. Run API:

```powershell
uvicorn app.main:app --reload
```

4. Call endpoint:

```powershell
curl -X POST http://127.0.0.1:8000/connectors/facebook/search `
  -H "Content-Type: application/json" `
  -d "{\"query\":\"bike\",\"location_text\":\"Toronto\",\"limit\":10,\"auth_mode\":\"guest\"}"
```

## Smoke test script

From repo root:

```powershell
python scripts/smoke_facebook.py --query "road bike" --location "Toronto" --limit 10
```

Unified search integration smoke test:

```powershell
python scripts/smoke_search.py --query "road bike" --sources "ebay,kijiji,facebook"
```

## Cookie mode (`auth_mode = "cookie"`)

Cookie mode improves results when guest mode hits login walls.

Expected file: `secrets/fb_cookies.json` (override with `cookie_path`).
Example template: `secrets/fb_cookies.example.json`.
This file is not committed by design; you must generate it locally from your own logged-in browser.

Accepted JSON formats:

- Array of cookie objects (`[{"name":"c_user",...}]`)
- Object with `cookies` array (`{"cookies":[...]}`)

Important: do not provide only `c_user` + `xs`. Export the full cookie jar for `facebook.com`.

### Manual cookie export steps

1. Open Facebook in Chrome.
2. Log in and open Marketplace search.
3. Open DevTools (`F12`) -> `Application` tab -> `Cookies` -> `https://www.facebook.com`.
4. Export cookies to JSON (via extension or copy values manually into JSON).
5. Save to `secrets/fb_cookies.json`.
6. Keep this file out of source control.

Quick setup:

```powershell
cd backend
Copy-Item .\secrets\fb_cookies.example.json .\secrets\fb_cookies.json
# then replace REPLACE_ME values with real cookie values
```

## Common failure modes

- `login_wall`: guest mode was blocked behind login.
- `checkpoint`: account/session requires verification.
- `blocked`: temporary anti-bot block; retry later.
- `empty_results`: page loaded but extractor found no cards.
- `cookies_missing` / `cookies_invalid`: cookie file path or format issue.
- `playwright_unavailable`: Playwright package or browser is not installed.

## Notes

- Scraping behavior can change frequently as Facebook updates markup.
- This connector intentionally avoids bypass/security evasion and returns typed errors on gating states.

## Unified Search Integration

- Main search endpoint: `GET /search`.
- Request must include Facebook by either:
  - adding `facebook` to `sources`, or
  - setting `include_facebook=true`.
- Facebook runs only when env flag is on:
  - `MARKETLY_ENABLE_FACEBOOK=true`
- If requested while disabled or unavailable, `source_errors.facebook` is populated and other sources still return.
