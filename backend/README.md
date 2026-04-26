# Marketly Backend

## Facebook BYOC (Stage 1)

- Facebook unified search uses per-user BYOC (bring your own cookies), not a shared server cookie.
- Configure `MARKETLY_CREDENTIALS_ENCRYPTION_KEY` (Fernet key) before using BYOC endpoints.
- Hosted deployments can now pair a local browser helper instead of relying on a static cookie export.
- Logged-in users manage cookies via:
  - `GET /me/connectors/facebook`
  - `PUT /me/connectors/facebook/cookies`
  - `POST /me/connectors/facebook/verify`
  - `DELETE /me/connectors/facebook`
- Browser-helper endpoints:
  - `POST /me/connectors/facebook/helper/pairing-sessions`
  - `POST /connectors/facebook/helper/pair`
  - `PUT /connectors/facebook/helper/cookies`
  - `POST /connectors/facebook/helper/heartbeat`
  - `DELETE /me/connectors/facebook/helper`
- `GET /me/connectors/facebook` returns helper health fields including `last_synced_at`, `helper_last_seen_at`, `last_error_message`, and typed `stale_reason`.
- `GET /search` accepts optional `latitude`, `longitude`, and `radius_km`.

## AI insights, alerts, and copilot

- Search results now expose fair-value and risk metadata directly on each listing.
- Saved searches support `alerts_enabled`, immediate baseline creation on save, and in-app alerts via:
  - `GET /me/notifications`
  - `POST /me/notifications/{id}/read`
- Saved searches are capped per user with `MARKETLY_SAVED_SEARCH_MAX_PER_USER`, and automatic batch runs only use the newest saved searches up to that cap.
- `GET /me/notifications` now auto-refreshes stale alert-enabled saved searches before returning the latest digests.
- By default, saved-search alerts remain strict: any source error fails that alert check. Set `MARKETLY_ALERTS_PARTIAL_SOURCE_SUCCESS_ENABLED=true` to let mixed-source alerts continue for healthy sources while persisting failed-source details on the saved search and notification payload.
- The shopping copilot is available at `POST /copilot/query` and can answer broader marketplace-item questions even without loaded listings.
- Gemini is the only configured AI provider. For low-cost local development, use a Gemini Developer API key from Google AI Studio and set `MARKETLY_GEMINI_MODEL=gemini-2.5-flash-lite`.
- Run the alert digest job from cron or your scheduler as a fallback or batch backstop with:

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
MARKETLY_SAVED_SEARCH_MAX_PER_USER=3
MARKETLY_RATE_LIMIT_FB_COOKIE_PUT_PER_HOUR=6
MARKETLY_RATE_LIMIT_FB_VERIFY_PER_HOUR=12
MARKETLY_RATE_LIMIT_FB_DELETE_PER_HOUR=20

MARKETLY_SEARCH_FETCH_CACHE_MAX_ITEMS=32
MARKETLY_SEARCH_PAGINATION_CACHE_MAX_ITEMS=8

MARKETLY_ALERTS_SEARCH_LIMIT=20
MARKETLY_ALERTS_STALE_AFTER_SECONDS=28800
MARKETLY_ALERTS_AUTO_REFRESH_WINDOW_SECONDS=300
MARKETLY_ALERTS_PARTIAL_SOURCE_SUCCESS_ENABLED=false
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

## Production saved-search alert runbook

Schedule `scripts/run_saved_search_alerts.py` as a cron or platform scheduler backstop in addition to opportunistic `GET /me/notifications` refreshes. Recommended frequency is every 15 minutes; each saved search still respects `MARKETLY_ALERTS_STALE_AFTER_SECONDS` before doing a real check, so frequent scheduler wakeups are cheap.

Example cron:

```cron
*/15 * * * * cd /app && python scripts/run_saved_search_alerts.py --limit 20 >> /var/log/marketly-alerts.log 2>&1
```

Retry policy:
- Let the scheduler retry on the next interval for transient connector or network failures.
- Keep `MARKETLY_ALERTS_PARTIAL_SOURCE_SUCCESS_ENABLED=false` if you prefer all-or-nothing alerts.
- Enable `MARKETLY_ALERTS_PARTIAL_SOURCE_SUCCESS_ENABLED=true` when production reliability favors eBay/Kijiji alerts continuing while Facebook is unavailable.

Monitor these signals:
- Non-zero `last_alert_error_code` or recurring `last_alert_source_errors_json.facebook`.
- `helper_last_seen_at` older than `MARKETLY_FACEBOOK_HELPER_STALE_AFTER_SECONDS`.
- `stale_reason` values: `helper_disconnected`, `cookie_expired`, `cookie_expiring_soon`, `facebook_session_invalid`.
- Cron exit failures or logs containing `saved search alert run incomplete`.
- Notification payloads with `source_errors.facebook`, which indicate partial-success delivery.

Troubleshooting:
- Invalid token: ask the user to disconnect and re-pair the helper. The extension status will show `Token invalid`.
- Wrong developer API base: production users do not enter an API base. For local development, enable extension developer mode and use `http://127.0.0.1:8000`, not the frontend dev server at `http://localhost:3000`.
- Helper disconnected: open Facebook in Chrome or Edge, then click `Sync now` in the extension options page. Re-pair if `helper_last_seen_at` stays stale.
- Facebook checkpoint/login wall: open Facebook Marketplace in the browser account used for Marketly, resolve the prompt, then sync and re-verify.
