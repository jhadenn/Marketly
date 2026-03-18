# Marketly Backend

## Facebook BYOC (Stage 1)

- Facebook unified search uses per-user BYOC (bring your own cookies), not a shared server cookie.
- Configure `MARKETLY_CREDENTIALS_ENCRYPTION_KEY` (Fernet key) before using BYOC endpoints.
- Logged-in users manage cookies via:
  - `GET /me/connectors/facebook`
  - `PUT /me/connectors/facebook/cookies`
  - `POST /me/connectors/facebook/verify`
  - `DELETE /me/connectors/facebook`
- `GET /search` accepts optional `latitude`, `longitude`, and `radius_km`.

## AI insights, alerts, and copilot

- Search results now expose fair-value and risk metadata directly on each listing.
- Saved searches support `alerts_enabled` and daily in-app digests via:
  - `GET /me/notifications`
  - `POST /me/notifications/{id}/read`
- The shopping copilot is available at `POST /copilot/query`.
- Gemini is the only configured AI provider. For low-cost local development, use a Gemini Developer API key from Google AI Studio and set `MARKETLY_GEMINI_MODEL=gemini-2.5-flash-lite`.
- Run the alert digest job from cron or your scheduler with:

```bash
python scripts/run_saved_search_alerts.py
```

- Optional overrides:

```bash
python scripts/run_saved_search_alerts.py --limit 30
python scripts/run_saved_search_alerts.py --saved-search-id 42
python scripts/run_saved_search_alerts.py --user-id your-user-id
```

## Production cache + rate limiting

- Optional response cache for `/search` using Redis first with bounded in-memory fallback.
- Fixed-window rate limits using Redis first with bounded in-memory fallback for:
  - `/search` (IP + authenticated user),
  - saved-search mutation/run endpoints,
  - Facebook BYOC mutation endpoints.
- If both Redis and local fallback are unavailable and `MARKETLY_RATE_LIMIT_FAIL_OPEN=true`, requests are allowed.

## Environment variables (production additions)

```bash
# Optional. If omitted, backend uses bounded in-memory fallback.
REDIS_URL=redis://:<password>@<host>:6379/0

MARKETLY_RESPONSE_CACHE_ENABLED=true
MARKETLY_RESPONSE_CACHE_TTL_SECONDS=45
MARKETLY_RESPONSE_CACHE_LOCAL_FALLBACK_ENABLED=true
MARKETLY_RESPONSE_CACHE_LOCAL_MAX_ITEMS=24

MARKETLY_RATE_LIMIT_ENABLED=true
MARKETLY_RATE_LIMIT_FAIL_OPEN=true
MARKETLY_RATE_LIMIT_LOCAL_FALLBACK_ENABLED=true
MARKETLY_RATE_LIMIT_LOCAL_MAX_KEYS=5000

MARKETLY_RATE_LIMIT_SEARCH_IP_PER_MIN=60
MARKETLY_RATE_LIMIT_SEARCH_USER_PER_MIN=30
MARKETLY_RATE_LIMIT_SAVED_MUTATION_PER_MIN=20
MARKETLY_RATE_LIMIT_FB_COOKIE_PUT_PER_HOUR=6
MARKETLY_RATE_LIMIT_FB_VERIFY_PER_HOUR=12
MARKETLY_RATE_LIMIT_FB_DELETE_PER_HOUR=20

MARKETLY_SEARCH_FETCH_CACHE_MAX_ITEMS=32
MARKETLY_SEARCH_PAGINATION_CACHE_MAX_ITEMS=8

MARKETLY_ALERTS_SEARCH_LIMIT=20
MARKETLY_VALUATION_LOOKBACK_DAYS=120
MARKETLY_GEMINI_MODEL=gemini-2.5-flash-lite
MARKETLY_GEMINI_TIMEOUT_SECONDS=25
GEMINI_API_KEY=
GEMINI_API_BASE=https://generativelanguage.googleapis.com/v1beta
```

## Facebook speed tuning

Use these when Facebook feels slow:

```bash
# Skip facebook.com home bootstrap before search (faster cold request).
MARKETLY_FACEBOOK_BOOTSTRAP_HOME=false

# Reduce per-scroll wait jitter.
MARKETLY_FACEBOOK_JITTER_MIN_SECONDS=0.08
MARKETLY_FACEBOOK_JITTER_MAX_SECONDS=0.25

# Keep extra Facebook overfetch smaller in unified multi-source mode.
MARKETLY_FACEBOOK_OVERFETCH_BUFFER_MULTI_SOURCE=2
```

## Render deployment (512 MB)

1. Create a Render Web Service from the `backend/` Dockerfile.
2. Configure required secrets (`DATABASE_URL`, Supabase keys, eBay keys, `MARKETLY_CREDENTIALS_ENCRYPTION_KEY`).
3. Use these baseline memory-safe settings:

```bash
ENV=prod
CACHE_TTL_SECONDS=60

MARKETLY_DISABLE_FACEBOOK_MULTI_SOURCE_EXPANSION=true
MARKETLY_SEARCH_FETCH_CACHE_MAX_ITEMS=32
MARKETLY_SEARCH_PAGINATION_CACHE_MAX_ITEMS=8

MARKETLY_RESPONSE_CACHE_ENABLED=true
MARKETLY_RESPONSE_CACHE_TTL_SECONDS=45
MARKETLY_RESPONSE_CACHE_LOCAL_FALLBACK_ENABLED=true
MARKETLY_RESPONSE_CACHE_LOCAL_MAX_ITEMS=24

MARKETLY_RATE_LIMIT_ENABLED=true
MARKETLY_RATE_LIMIT_FAIL_OPEN=true
MARKETLY_RATE_LIMIT_LOCAL_FALLBACK_ENABLED=true
MARKETLY_RATE_LIMIT_LOCAL_MAX_KEYS=5000
```

4. Optional: attach a Redis service and set `REDIS_URL` for shared cache/rate-limit state across instances.
5. Set your frontend `NEXT_PUBLIC_API_BASE` to your Render backend URL and redeploy frontend.

Local fallback cache/rate limits are per-instance memory state and reset on restart.
If you scale to multiple instances, configure Redis for shared and consistent behavior.
