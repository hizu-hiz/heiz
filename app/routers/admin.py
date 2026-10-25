"""Developer-only endpoints (Authorization: Bearer <HEIZ_ADMIN_TOKEN>) used by /dashboard."""
from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.config import MANUAL_SOURCE_CODE, get_settings
from app.database import get_db
from app.models import DataSource, EarthquakeEvent, EventUpdate, SyncLog
from app.schemas.source import SyncLogOut
from app.security import require_admin
from app.services import retention

router = APIRouter(prefix="/api/admin", tags=["admin"], dependencies=[Depends(require_admin)])


class PruneRequest(BaseModel):
    dry_run: bool = True


@router.get("/whoami")
def whoami():
    """Validates the token without touching the database (works while the DB is down)."""
    return {"role": "admin"}


@router.get("/overview")
def overview(db: Session = Depends(get_db)):
    s = get_settings()
    manual = select(DataSource.id).where(DataSource.code == MANUAL_SOURCE_CODE)
    count = lambda model, *c: db.scalar(select(func.count()).select_from(model).where(*c)) or 0  # noqa: E731
    last = db.scalar(select(SyncLog).order_by(SyncLog.started_at.desc(), SyncLog.id.desc()).limit(1))
    return {
        "counts": {
            "earthquake_events": count(EarthquakeEvent),
            "manual_events": count(EarthquakeEvent, EarthquakeEvent.source_id.in_(manual)),
            "event_updates": count(EventUpdate),
            "sync_logs": count(SyncLog),
        },
        "storage": retention.storage_report(db, s),
        "last_sync": SyncLogOut.model_validate(last).model_dump(mode="json") if last else None,
        "retention": {
            "raw_payload_days": s.retention_raw_payload_days,
            "event_updates_days": s.retention_event_updates_days,
            "sync_logs_days": s.retention_sync_logs_days,
            "events_days": s.retention_events_days,
            "batch_size": s.prune_batch_size,
        },
    }


@router.post("/maintenance/prune")
def prune(body: PruneRequest | None = None, db: Session = Depends(get_db)):
    """Dry run unless {"dry_run": false} is sent explicitly."""
    return retention.run_prune(db, get_settings(), dry_run=body.dry_run if body else True)
