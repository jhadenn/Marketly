from fastapi import Depends, FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session

from app.auth import get_current_user_id
from app.connectors import CONNECTORS
from app.core.logging import setup_logging
from app.db import get_db
from app.models.listing import SearchResponse, SearchSort, Source
from app.models.saved_search import SavedSearch
from app.schemas.saved_search import SavedSearchCreate, SavedSearchOut
from app.services.search_service import unified_search

setup_logging()

app = FastAPI(title="Marketly API", version="0.1.0")
print("LOADED MAIN.PY", __file__)

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

DEFAULT_SOURCES: list[Source] = ["ebay", "kijiji"]


def parse_sources(raw_sources: list[str] | None) -> list[str]:
    if not raw_sources:
        return list(DEFAULT_SOURCES)

    parsed: list[str] = []
    for source_value in raw_sources:
        for token in source_value.split(","):
            cleaned = token.strip()
            if cleaned:
                parsed.append(cleaned)

    if not parsed:
        raise HTTPException(status_code=400, detail="No sources provided")

    deduped: list[str] = []
    seen: set[str] = set()
    for source_name in parsed:
        if source_name in seen:
            continue
        seen.add(source_name)
        deduped.append(source_name)
    return deduped


@app.get("/health")
def health():
    return {"status": "ok"}


@app.get("/sources")
def sources():
    return {"sources": sorted(CONNECTORS.keys())}


@app.get("/search", response_model=SearchResponse)
async def search(
    q: str = Query(min_length=1, description="Search query"),
    sources: list[str] | None = Query(
        default=None,
        description="Sources (comma-separated or repeated query param)",
    ),
    limit: int = Query(default=20, ge=1, le=50),
    offset: int = Query(default=0, ge=0),
    sort: SearchSort = Query(default="relevance"),
):
    source_list = parse_sources(sources)

    for source_name in source_list:
        if source_name not in CONNECTORS:
            raise HTTPException(status_code=400, detail=f"Unknown source: {source_name}")

    results, total, next_offset = await unified_search(
        query=q,
        sources=source_list,
        limit=limit,
        offset=offset,
        sort=sort,
    )

    typed_sources: list[Source] = [source_name for source_name in source_list]

    return SearchResponse(
        query=q,
        sources=typed_sources,
        count=len(results),
        results=results,
        next_offset=next_offset,
        total=total,
    )


@app.post("/saved-searches", response_model=SavedSearchOut)
def create_saved_search(
    payload: SavedSearchCreate,
    db: Session = Depends(get_db),
    user_id: str = Depends(get_current_user_id),
):
    row = SavedSearch(
        user_id=user_id,
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
def list_saved_searches(
    db: Session = Depends(get_db),
    user_id: str = Depends(get_current_user_id),
):
    rows = (
        db.query(SavedSearch)
        .filter(SavedSearch.user_id == user_id)
        .order_by(SavedSearch.created_at.desc())
        .all()
    )

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
def delete_saved_search(
    search_id: int,
    db: Session = Depends(get_db),
    user_id: str = Depends(get_current_user_id),
):
    row = (
        db.query(SavedSearch)
        .filter(SavedSearch.id == search_id, SavedSearch.user_id == user_id)
        .first()
    )
    if not row:
        raise HTTPException(status_code=404, detail="Saved search not found")
    db.delete(row)
    db.commit()
    return {"deleted": True, "id": search_id}


@app.get("/saved-searches/{search_id}/run", response_model=SearchResponse)
async def run_saved_search(
    search_id: int,
    limit: int = Query(default=20, ge=1, le=50),
    offset: int = Query(default=0, ge=0),
    sort: SearchSort = Query(default="relevance"),
    db: Session = Depends(get_db),
    user_id: str = Depends(get_current_user_id),
):
    row = (
        db.query(SavedSearch)
        .filter(SavedSearch.id == search_id, SavedSearch.user_id == user_id)
        .first()
    )
    if not row:
        raise HTTPException(status_code=404, detail="Saved search not found")

    source_list = parse_sources([row.sources or ""])
    for source_name in source_list:
        if source_name not in CONNECTORS:
            raise HTTPException(status_code=400, detail=f"Unknown source: {source_name}")

    results, total, next_offset = await unified_search(
        query=row.query,
        sources=source_list,
        limit=limit,
        offset=offset,
        sort=sort,
    )

    typed_sources: list[Source] = [source_name for source_name in source_list]

    return SearchResponse(
        query=row.query,
        sources=typed_sources,
        count=len(results),
        results=results,
        next_offset=next_offset,
        total=total,
    )
