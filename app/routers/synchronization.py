"""POST /api/sync: admin-only (Bearer token), throttled trigger for the BMKG importer.

Serverless functions do not run continuously, so nothing here is automatic: a person or an
external scheduler must call this endpoint."""
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import BMKG_FEED_NAMES, BMKG_SOURCE_CODE, get_settings
from app.database import get_db
from app.errors import AppError
from app.models import DataSource, SyncLog
from app.schemas.source import SyncLogOut, SyncRequest
from app.security import require_admin
from app.services import bmkg

router = APIRouter(prefix="/api", tags=["synchronization"])


@router.post("/sync", response_model=list[SyncLogOut], dependencies=[Depends(require_admin)])
def trigger_sync(body: SyncRequest | None = None, db: Session = Depends(get_db)):
    settings = get_settings()
    feeds = (body.feeds if body and body.feeds else list(BMKG_FEED_NAMES))
    bad = [f for f in feeds if f not in BMKG_FEED_NAMES]
    if bad:
        raise AppError(400, "validation_error", "Unknown feed name(s).",
                       {"unknown": bad, "allowed": list(BMKG_FEED_NAMES)})
    feeds = list(dict.fromkeys(feeds))  # de-duplicate, keep order

    source = db.scalar(select(DataSource).where(DataSource.code == BMKG_SOURCE_CODE))
    if source is None or not source.is_active:
        raise AppError(409, "source_unavailable", "The BMKG data source is missing or disabled.")

    cutoff = datetime.now(timezone.utc) - timedelta(seconds=settings.sync_min_interval_seconds)
    recent = db.scalar(select(SyncLog).where(SyncLog.source_id == source.id,
                                             SyncLog.started_at >= cutoff)
                       .order_by(SyncLog.started_at.desc()).limit(1))
    if recent is not None:
        started = recent.started_at if recent.started_at.tzinfo else \
            recent.started_at.replace(tzinfo=timezone.utc)
        wait = max(1, int((started + timedelta(seconds=settings.sync_min_interval_seconds)
                           - datetime.now(timezone.utc)).total_seconds()) + 1)
        raise AppError(429, "sync_throttled",
                       f"A sync ran recently. Try again in about {wait} seconds.",
                       headers={"Retry-After": str(wait)})

    return [bmkg.run_feed_sync(db, source, feed, settings) for feed in feeds]
