from pydantic import BaseModel, Field
from app.models.listing import Source


class SavedSearchCreate(BaseModel):
    query: str = Field(min_length=1, max_length=200)
    sources: list[Source] = Field(min_length=1)


class SavedSearchOut(BaseModel):
    id: int
    query: str
    sources: list[Source]
    created_at: str

    class Config:
        from_attributes = True
