
from fastapi import Depends
from sqlalchemy.orm import Session

from app.db import get_db
from app.models.saved_search import SavedSearch
from app.schemas.saved_search import SavedSearchCreate, SavedSearchOut
from fastapi import FastAPI, Query, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from app.core.logging import setup_logging
from app.models.listing import SearchResponse, Source
from app.services.search_service import unified_search
from app.connectors import CONNECTORS

setup_logging()

app = FastAPI(title="Marketly API", version="0.1.0")
print("LOADED MAIN.PY ✅", __file__)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://127.0.0.1:3000",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/health")
def health():
    return {"status": "ok"}


@app.get("/sources")
def sources():
    return {"sources": sorted(CONNECTORS.keys())}


@app.get("/search", response_model=SearchResponse)
async def search(
    q: str = Query(min_length=1, description="Search query"),
    sources: str = Query(default="ebay,kijiji", description="Comma-separated sources"),
    limit: int = Query(default=20, ge=1, le=50),
):
    source_list = [s.strip() for s in sources.split(",") if s.strip()]
    if not source_list:
        raise HTTPException(status_code=400, detail="No sources provided")

    # validate sources
    for s in source_list:
        if s not in CONNECTORS:
            raise HTTPException(status_code=400, detail=f"Unknown source: {s}")

    results = await unified_search(query=q, sources=source_list, limit=limit)

    # typed list for response model
    typed_sources: list[Source] = [s for s in source_list]  # FastAPI will validate

    return SearchResponse(
        query=q,
        sources=typed_sources,
        count=len(results),
        results=results,
    )

@app.post("/saved-searches", response_model=SavedSearchOut)
def create_saved_search(payload: SavedSearchCreate, db: Session = Depends(get_db)):
    row = SavedSearch(
        query=payload.query,
        sources=",".join(payload.sources),
    )
    db.add(row)
    db.commit()
    db.refresh(row)

    return SavedSearchOut(
        id=row.id,
        query=row.query,
        sources=[s.strip() for s in row.sources.split(",") if s.strip()],
        created_at=str(row.created_at),
    )


@app.get("/saved-searches", response_model=list[SavedSearchOut])
def list_saved_searches(db: Session = Depends(get_db)):
    rows = db.query(SavedSearch).order_by(SavedSearch.created_at.desc()).all()

    return [
        SavedSearchOut(
            id=r.id,
            query=r.query,
            sources=[s.strip() for s in r.sources.split(",") if s.strip()],
            created_at=str(r.created_at),
        )
        for r in rows
    ]

@app.delete("/saved-searches/{search_id}")
def delete_saved_search(search_id: int, db: Session = Depends(get_db)):
    row = db.query(SavedSearch).filter(SavedSearch.id == search_id).first()
    if not row:
        raise HTTPException(status_code=404, detail="Saved search not found")
    db.delete(row)
    db.commit()
    return {"deleted": True, "id": search_id}


@app.get("/saved-searches/{search_id}/run", response_model=SearchResponse)
async def run_saved_search(
    search_id: int,
    limit: int = 20,
    db: Session = Depends(get_db),
):
    row = db.query(SavedSearch).filter(SavedSearch.id == search_id).first()
    if not row:
        raise HTTPException(status_code=404, detail="Saved search not found")

    source_list = [s.strip() for s in (row.sources or "").split(",") if s.strip()]

    # LIVE fetch every time (DO NOT STORE results)
    results = await unified_search(query=row.query, sources=source_list, limit=limit)

    return SearchResponse(
        query=row.query,
        sources=source_list,
        count=len(results),
        results=results,
    )
