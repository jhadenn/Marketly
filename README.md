<div align="center">
  <img src="frontend/app/favicon.ico" alt="Marketly Logo" width="140" height="140" />

  <h1>Marketly</h1>

  <p><strong>Unified marketplace search across Kijiji, eBay, and Facebook Marketplace.</strong></p>

  <p>
    <a href="https://github.com/jhadenn/Marketly">Repo</a> |
    <a href="https://github.com/jhadenn/Marketly/issues">Report Bug</a> |
    <a href="https://github.com/jhadenn/Marketly/issues">Request Feature</a>
  </p>

  <p>
    <img alt="Next.js" src="https://img.shields.io/badge/Next.js-16-black?style=for-the-badge&logo=nextdotjs&logoColor=white" />
    <img alt="React" src="https://img.shields.io/badge/React-19-61DAFB?style=for-the-badge&logo=react&logoColor=white" />
    <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-5-3178C6?style=for-the-badge&logo=typescript&logoColor=white" />
    <img alt="TailwindCSS" src="https://img.shields.io/badge/TailwindCSS-4-06B6D4?style=for-the-badge&logo=tailwindcss&logoColor=white" />
    <img alt="FastAPI" src="https://img.shields.io/badge/FastAPI-0.110-009688?style=for-the-badge&logo=fastapi&logoColor=white" />
    <img alt="License" src="https://img.shields.io/badge/License-MIT-yellow?style=for-the-badge" />
  </p>
</div>

---

## Overview

Marketly aggregates and normalizes listings from multiple online marketplaces into a single, unified interface. Instead of manually browsing Kijiji, eBay, and Facebook Marketplace separately, you can search across supported platforms simultaneously and compare results in one feed.

Why Marketly:
- Multi-source search, one workflow
- Image-first unified grid for fast scanning
- Per-user saved searches with re-run plus batch run
- Filters, sorting, and infinite scroll loading
<div align="center" style="margin: 32px 0;">
  <img src="imgs/Marketly-landing.png" alt="Marketly screenshot" width="900" />
  <p><em>Landing page</em></p>
</div>
<div align="center" style="margin: 32px 0;">
  <img src="imgs/Marketly-v1.png" alt="Marketly screenshot" width="900" />
  <p><em>Unified results grid with filters and saved searches</em></p>
</div>

---

## Features

| Feature | Description |
|---|---|
| Multi-source search | Query Kijiji, eBay, and Facebook Marketplace in one request. |
| Normalized results | Consistent listing cards (title, price, images, location) across sources. |
| Saved searches | Save queries per user and re-run instantly (single or batch). |
| Client-side filters | Location filtering, distance helpers, and sort controls in the search UI. |
| Supabase authentication | Sign-in via Supabase Auth; backend verifies Supabase JWT for API access. |

---

## Tech Stack

<div align="center">

### Frontend
<img alt="Next.js" src="https://img.shields.io/badge/Next.js-16-black?style=for-the-badge&logo=nextdotjs&logoColor=white" />
<img alt="React" src="https://img.shields.io/badge/React-19-61DAFB?style=for-the-badge&logo=react&logoColor=white" />
<img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-5-3178C6?style=for-the-badge&logo=typescript&logoColor=white" />
<img alt="TailwindCSS" src="https://img.shields.io/badge/TailwindCSS-4-06B6D4?style=for-the-badge&logo=tailwindcss&logoColor=white" />

### Backend
<img alt="Python" src="https://img.shields.io/badge/Python-3.10+-3776AB?style=for-the-badge&logo=python&logoColor=white" />
<img alt="FastAPI" src="https://img.shields.io/badge/FastAPI-0.110-009688?style=for-the-badge&logo=fastapi&logoColor=white" />
<img alt="SQLAlchemy" src="https://img.shields.io/badge/SQLAlchemy-2.0-D71F00?style=for-the-badge&logo=sqlalchemy&logoColor=white" />

### Data / Auth
<img alt="Postgres" src="https://img.shields.io/badge/Postgres-16-4169E1?style=for-the-badge&logo=postgresql&logoColor=white" />
<img alt="Supabase" src="https://img.shields.io/badge/Supabase-Auth-3ECF8E?style=for-the-badge&logo=supabase&logoColor=white" />

</div>

---

## Getting Started

### Prerequisites

- Node.js 18+ (or current LTS)
- Python 3.10+
- (Optional) Docker Desktop (for local Postgres)

### 1) Clone

```bash
git clone https://github.com/jhadenn/Marketly.git
cd Marketly
```

### 2) Backend (FastAPI)

Create `backend/.env` (see Environment Variables below), then:

```bash
cd backend
python -m venv .venv
```

Windows:

```powershell
.venv\Scripts\activate
pip install -e ".[dev]"
python -m playwright install chromium
uvicorn app.main:app --reload --port 8000
```

### 3) Frontend (Next.js)

Create `frontend/.env.local` (see Environment Variables below), then:

```bash
cd ../frontend
npm install
npm run dev
```

Open `http://localhost:3000`.

---

## Environment Variables

### Backend (`backend/.env`)

Required:

```bash
DATABASE_URL=postgresql+psycopg2://USER:PASSWORD@HOST:5432/DBNAME
```

Auth verification (pick one approach):

```bash
# Option A (HS JWT): provide the Supabase JWT secret
SUPABASE_JWT_SECRET=YOUR_SUPABASE_JWT_SECRET

# Option B (JWKS): provide project URL (and optionally anon key) for key discovery
SUPABASE_URL=https://YOUR_PROJECT.supabase.co
SUPABASE_ANON_KEY=YOUR_SUPABASE_ANON_KEY
```

Optional:

```bash
MARKETLY_ENABLE_FACEBOOK=false
MARKETLY_FACEBOOK_AUTH_MODE=guest
MARKETLY_FACEBOOK_COOKIE_PATH=secrets/fb_cookies.json
```

### Frontend (`frontend/.env.local`)

```bash
NEXT_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=YOUR_SUPABASE_ANON_KEY
NEXT_PUBLIC_API_BASE=http://127.0.0.1:8000
```

---

## Local Database (Optional)

This repo includes a Postgres service in `backend/docker-compose.yml`, but it is currently commented out. If you want a local database:

1) Uncomment the `db` service in `backend/docker-compose.yml`.

2) Start Postgres:

```bash
cd backend
docker compose up -d db
```

3) Set:

```bash
DATABASE_URL=postgresql+psycopg2://marketly:marketly@localhost:5432/marketly
```

---

## Project Structure

```text
Marketly/
  backend/                   # FastAPI + connectors + DB models
    app/
      connectors/
      core/
      models/
      schemas/
      services/
    alembic/
    docker-compose.yml
    pyproject.toml
  frontend/                  # Next.js App Router UI
    app/
    components/
    lib/
    styles/
  imgs/                      # Screenshots
  scripts/                   # Smoke scripts
```

---

## Roadmap

- [x] Multi-source search (Kijiji, eBay, Facebook)
- [x] Saved searches (per user)
- [x] Filters, sorting, infinite scroll
- [x] Edit saved searches
- [ ] Deploy
- [ ] Rate limiting and caching
- [ ] Notifications

See `https://github.com/jhadenn/Marketly/issues` for open items.

---

## License

MIT - see `LICENSE`.

---

## Contact

Built by Jhaden Goy.
