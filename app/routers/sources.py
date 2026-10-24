from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.config import get_settings
from app.database import get_db
from app.models import DataSource, SyncLog
from app.schemas.source import SourceOut, SyncLogList

router = APIRouter(prefix="/api", tags=["sources"])


@router.get("/sources", response_model=list[SourceOut])
def list_sources(db: Session = Depends(get_db)):
    return db.scalars(select(DataSource).order_by(DataSource.id)).all()


@router.get("/sync-logs", response_model=SyncLogList)
def list_sync_logs(
    limit: int = Query(20, ge=1, le=get_settings().max_page_size),
    offset: int = Query(0, ge=0),
    status: str | None = Query(None, pattern="^(running|success|partial|failed)$"),
    db: Session = Depends(get_db),
):
    conds = [SyncLog.status == status] if status else []
    total = db.scalar(select(func.count()).select_from(SyncLog).where(*conds))
    rows = db.scalars(select(SyncLog).where(*conds)
                      .order_by(SyncLog.started_at.desc(), SyncLog.id.desc())
                      .limit(limit).offset(offset)).all()
    return {"data": rows, "pagination": {"limit": limit, "offset": offset, "total": total}}
