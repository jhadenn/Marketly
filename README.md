# Marketly
Marketly is a web app that makes it easier to browse marketplace listings from multiple apps in one place. It scrapes listings from eBay, Kijiji, and Facebook Marketplace, then displays them in a unified view for the user.

## Features
- Aggregated listings across multiple marketplaces
- Normalized listing data for consistent display
- Backend API with scraping and data access
- Web UI for browsing results

## Tech Stack
**Frontend**
- Next.js (App Router)
- React
- TypeScript
- Tailwind CSS

**Backend**
- FastAPI
- Python 3.10+
- Requests + BeautifulSoup + Selectolax + lxml (scraping/parsing)
- SQLAlchemy + Alembic

**Data**
- PostgreSQL (via Docker Compose)

## Project Structure
- `frontend/` Next.js app
- `backend/` FastAPI app and scraping services

## Getting Started
### Prerequisites
- Node.js 18+ (or current LTS)
- Python 3.10+
- Docker (optional, for Postgres)

### Backend (local)
```powershell
cd backend
python -m venv .venv
.venv\Scripts\activate
pip install -e ".[dev]"
uvicorn app.main:app --reload
```

### Frontend (local)
```powershell
cd frontend
npm install
npm run dev
```

### Database (Docker)
```powershell
cd backend
docker compose up -d
```

## Environment Variables
Backend env vars live in `backend/.env` (see `backend/.env.example`):
- `ENV`
- `CACHE_TTL_SECONDS`

If running the backend against Docker Postgres, set:
```
DATABASE_URL=postgresql+psycopg2://marketly:marketly@localhost:5432/marketly
```

## Roadmap
- Expand to more marketplaces (ebay, facebook marketplace)
- Improve scraping reliability and anti-block handling
- Add filters, sorting, and search on the frontend
- Add price alerts
- Add user personalization

## API Keys

- https://developer.ebay.com/my/keys