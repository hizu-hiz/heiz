from datetime import datetime

from pydantic import BaseModel, ConfigDict

from app.schemas.earthquake import Pagination


class SourceOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    code: str
    name: str
    base_url: str
    description: str | None
    is_active: bool


class SyncLogOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    source_id: int
    started_at: datetime
    finished_at: datetime | None
    status: str
    records_received: int
    records_created: int
    records_updated: int
    records_skipped: int
    error_summary: str | None
    request_url: str | None


class SyncLogList(BaseModel):
    data: list[SyncLogOut]
    pagination: Pagination


class SyncRequest(BaseModel):
    feeds: list[str] | None = None  # default: all configured BMKG feeds
