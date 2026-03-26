from pydantic import BaseModel, Field
from app.models.listing import Source


class SavedSearchCreate(BaseModel):
    query: str = Field(min_length=1, max_length=200)
    sources: list[Source] = Field(min_length=1)
    alerts_enabled: bool = True


class SavedSearchUpdate(BaseModel):
    query: str = Field(min_length=1, max_length=200)
    sources: list[Source] = Field(min_length=1)
    alerts_enabled: bool = True


class SavedSearchOut(BaseModel):
    id: int
    query: str
    sources: list[Source]
    alerts_enabled: bool
    last_alert_attempted_at: str | None = None
    last_alert_checked_at: str | None = None
    last_alert_notified_at: str | None = None
    last_alert_error_code: str | None = None
    last_alert_error_message: str | None = None
    next_alert_check_due_at: str | None = None
    created_at: str

    class Config:
        from_attributes = True
