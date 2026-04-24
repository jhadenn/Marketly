# AGENTS.md

This file provides guidance to Codex (Codex.ai/code) when working with code in this repository.

## Repository layout

Three top-level runnable units:

- `backend/` — FastAPI + SQLAlchemy + Alembic. Python package is `app/` (editable install as `marketly-backend`).
- `frontend/` — Next.js 16 App Router (React 19, TS 5, Tailwind 4). Supabase Auth on the client; backend verifies the Supabase JWT.
- `extension/facebook-session-helper/` — unpacked Chromium extension that pairs with a logged-in Marketly user and keeps their Facebook cookie jar fresh server-side.

`scripts/` contains standalone Python entrypoints run outside the app lifecycle (smoke tests, the alert-digest cron).

## Common commands

### Backend (run from `backend/`)

```bash
python -m venv .venv && .venv\Scripts\activate     # Windows
pip install -e ".[dev]"
python -m playwright install chromium              # required for the Facebook connector
uvicorn app.main:app --reload --port 8000
```

Tests use pytest and default to an in-memory SQLite (`tests/conftest.py` sets `DATABASE_URL=sqlite:///:memory:`):

```bash
pytest                                    # all tests
pytest tests/test_search.py               # one file
pytest tests/test_search.py::test_name    # one test
pytest -k facebook                        # by keyword
```

Lint: `ruff check .` (line length 100, configured in `pyproject.toml`).

Alembic migrations live under `backend/alembic/versions/`. Generate and run with:

```bash
alembic revision -m "message"
alembic upgrade head
```

### Frontend (run from `frontend/`)

```bash
npm install
npm run dev      # http://localhost:3000
npm run build
npm run lint     # eslint (flat config in eslint.config.mjs)
```

### Scripts (run from repo root)

```bash
python scripts/smoke_search.py --query "road bike" --sources "ebay,kijiji,facebook"
python scripts/smoke_facebook.py --query "road bike" --location "Toronto" --limit 10
python scripts/run_saved_search_alerts.py   # saved-search alert digest; meant for cron
```

## Architecture

### Unified search pipeline

`GET /search` (and `GET /saved-searches/{id}/run`) both funnel through `app.services.search_service.unified_search`, which fans out to the connectors registered in `app.connectors.CONNECTORS` (`kijiji`, `ebay`, `facebook`). Each connector implements the `base.py` interface and returns normalized `Listing` objects defined in `app/models/listing.py`. Results are then enriched with fair-value and risk metadata via `app.services.listing_insights.enrich_listings_with_insights` before response.

Key response behaviors encoded in `main.py`:

- Two cache layers: in-process `TTLCache`s inside `search_service` (fetch + pagination), and a Redis-or-local response cache keyed on `build_search_response_cache_key`. The response cache emits `X-Cache: HIT|MISS|BYPASS`.
- Per-source errors never fail the whole request — they surface as `source_errors[source]` on the response while other sources still return.
- Every successful search fires a background task (`persist_listing_snapshots`) that writes listings to the Supabase listings table for valuation history.
- Rate limits (Redis-backed with bounded in-memory fallback) guard `/search` (IP + user), saved-search mutations, and Facebook BYOC endpoints. Behavior when both backends are unavailable is governed by `MARKETLY_RATE_LIMIT_FAIL_OPEN`.

### Facebook connector specifics

Facebook is the most complex source and is gated behind `MARKETLY_ENABLE_FACEBOOK`. It is Playwright-based (`app/connectors/facebook_marketplace/`) and requires per-user cookies — not a shared server cookie. Two cookie-delivery paths exist:

1. **Manual BYOC** — user pastes a cookie JSON via `PUT /me/connectors/facebook/cookies` (encrypted at rest with `MARKETLY_CREDENTIALS_ENCRYPTION_KEY`, a Fernet key).
2. **Browser helper** — the unpacked extension in `extension/facebook-session-helper/` pairs with the user via `POST /me/connectors/facebook/helper/pairing-sessions` → `POST /connectors/facebook/helper/pair`, then keeps cookies fresh via `PUT /connectors/facebook/helper/cookies`. This is preferred for hosted deployments.

Before Facebook is included in a search, `main._build_facebook_runtime_context` runs a preflight (`ensure_facebook_credential_ready`) that verifies/refreshes the credential and maps failures to a typed `SourceError`. The connector also respects the speed-tuning envs documented in `backend/README.md` (`MARKETLY_FACEBOOK_BOOTSTRAP_HOME`, jitter, overfetch multipliers).

Additional constraint on hosted/multi-source runs: `MARKETLY_DISABLE_FACEBOOK_MULTI_SOURCE_EXPANSION=true` suppresses Facebook's expanded-query variants to control scrape cost.

### Saved searches + alerts

`saved_searches` is capped per user by `MARKETLY_SAVED_SEARCH_MAX_PER_USER` (default 3). Saving a search with `alerts_enabled=true` immediately runs a baseline (`_run_saved_search_baseline`), and edits that change `query`/`sources` or re-enable alerts reset the baseline. `GET /me/notifications` opportunistically refreshes stale alert-enabled searches via a *separate* SQLAlchemy session (`sessionmaker(bind=db.get_bind(), ...)`) so the refresh failure path doesn't poison the request transaction. The cron equivalent is `scripts/run_saved_search_alerts.py`.

### AI layer

`app.services.gemini_client` is the single AI provider (Gemini, via `GEMINI_API_KEY` / `GEMINI_API_BASE`). It powers:

- `POST /copilot/query` — marketplace shopping copilot.
- `listing_insights` — per-listing valuation verdict + risk scoring injected into `/search` responses.

For low-cost local dev, use a Gemini Developer API key from Google AI Studio and set `MARKETLY_GEMINI_MODEL=gemini-2.5-flash-lite`.

### Auth

Supabase JWT is verified on the backend in two modes (both in `app/auth.py`): HS256 via `SUPABASE_JWT_SECRET`, or JWKS discovery via `SUPABASE_URL` (+ optional `SUPABASE_ANON_KEY`). `/search` uses `try_get_current_user_id_from_authorization` (optional auth — endpoint works anonymously), while `/me/...` and saved-search endpoints use `get_current_user_id` (required).

### Database

SQLAlchemy 2.0 + Postgres in production, SQLite in tests (see `app/db.py`'s `sqlite` `connect_args` branch). Migrations are Alembic; models live in `app/models/`. Several tables (listings, saved_search_notifications, facebook_sync_*) are central to cross-request state — prefer adding a migration and model over ad-hoc SQL.

### Frontend → backend wiring

The frontend talks to the backend base URL from `NEXT_PUBLIC_API_BASE`. Auth is handled by `@supabase/ssr` + `@supabase/supabase-js`; tokens from the Supabase browser client are attached to backend requests. CORS on the backend (see `main.py`) allows localhost:3000 plus any `https://*.vercel.app` origin by default, and comma-separated extras via `CORS_ORIGINS`.

## Environment variables

Full reference is in `backend/README.md` (production/cache/rate-limit knobs) and the root `README.md` (getting-started subset). Required minimum to boot the backend: `DATABASE_URL` plus one of the Supabase JWT verification options. Required for Facebook: `MARKETLY_ENABLE_FACEBOOK=true` and `MARKETLY_CREDENTIALS_ENCRYPTION_KEY` (Fernet).

## Deployment notes

Backend has a `Dockerfile` tuned for Render's 512 MB plan; the memory-safe baseline envs are documented at the bottom of `backend/README.md`. Local fallback caches/rate-limits are per-instance memory — configure `REDIS_URL` when scaling horizontally.
 