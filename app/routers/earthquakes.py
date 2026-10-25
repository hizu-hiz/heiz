"""Earthquake CRUD.

Policy: records imported from BMKG are READ-ONLY through this API so manual
edits can never falsify source attribution. Clients create/edit/delete only MANUAL records.
Write methods require the X-API-Key header.
"""
from datetime import datetime, timezone
from decimal import Decimal

from fastapi import APIRouter, Depends, Query, Response
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.config import MANUAL_SOURCE_CODE, get_settings
from app.database import get_db
from app.errors import AppError
from app.models import DataSource, EarthquakeEvent, EventUpdate
from app.schemas.earthquake import (EarthquakeCreate, EarthquakeDetail, EarthquakeList,
                                    EarthquakeOut, EarthquakePatch)
from app.security import require_writer

router = APIRouter(prefix="/api/earthquakes", tags=["earthquakes"])

MANUAL_ATTRIBUTION = "Manual entry (not an official report)"
_QUANT = {"latitude": "0.000001", "longitude": "0.000001", "magnitude": "0.01", "depth_km": "0.01"}


def _store(field: str, value):
    """Convert API floats to Decimal matching the NUMERIC column scale."""
    if field in _QUANT and value is not None:
        return Decimal(str(value)).quantize(Decimal(_QUANT[field]))
    return value


def _json(v):
    if isinstance(v, Decimal):
        return str(v)
    return v.isoformat() if isinstance(v, datetime) else v


def _get_or_404(db: Session, event_id: int) -> EarthquakeEvent:
    event = db.get(EarthquakeEvent, event_id)
    if event is None:
        raise AppError(404, "not_found", f"Earthquake event {event_id} was not found.")
    return event


def _require_manual(event: EarthquakeEvent) -> None:
    if event.source_code != MANUAL_SOURCE_CODE:
        raise AppError(403, "imported_record_protected",
                       "Records imported from an external source are read-only. "
                       "Only manually created records can be changed or deleted.")


def _manual_source(db: Session) -> DataSource:
    src = db.scalar(select(DataSource).where(DataSource.code == MANUAL_SOURCE_CODE))
    if src is None:
        src = DataSource(code=MANUAL_SOURCE_CODE, name="Manual entry (Heiz API clients)",
                         base_url="https://example.invalid/heiz-manual",
                         description="Records created through the Heiz API; not official data.",
                         is_active=True)
        db.add(src)
        db.flush()
    return src


def _apply(db: Session, event: EarthquakeEvent, values: dict) -> dict:
    changes = {}
    for name, new in values.items():
        new = _store(name, new)
        old = getattr(event, name)
        if old != new:
            changes[name] = {"old": _json(old), "new": _json(new)}
            setattr(event, name, new)
    if changes:
        event.updated_at = datetime.now(timezone.utc)
        db.add(EventUpdate(event_id=event.id, change_type="manual_edit",
                           changed_fields=changes, note="Edited through the API"))
    return changes


@router.get("", response_model=EarthquakeList)
def list_earthquakes(
    limit: int = Query(20, ge=1, le=get_settings().max_page_size),
    offset: int = Query(0, ge=0),
    min_magnitude: float | None = Query(None, ge=0, le=10),
    source: str | None = Query(None, max_length=50, description="Source code, e.g. BMKG"),
    occurred_after: datetime | None = None,
    occurred_before: datetime | None = None,
    db: Session = Depends(get_db),
):
    conds = []
    if min_magnitude is not None:
        conds.append(EarthquakeEvent.magnitude >= min_magnitude)
    if source:
        conds.append(EarthquakeEvent.source.has(DataSource.code == source.upper()))
    if occurred_after:
        conds.append(EarthquakeEvent.occurred_at >= occurred_after)
    if occurred_before:
        conds.append(EarthquakeEvent.occurred_at <= occurred_before)
    total = db.scalar(select(func.count()).select_from(EarthquakeEvent).where(*conds))
    rows = db.scalars(
        select(EarthquakeEvent).where(*conds)
        .order_by(EarthquakeEvent.occurred_at.desc().nulls_last(), EarthquakeEvent.id.desc())
        .limit(limit).offset(offset)).unique().all()
    return {"data": rows, "pagination": {"limit": limit, "offset": offset, "total": total}}


@router.get("/{event_id}", response_model=EarthquakeDetail)
def get_earthquake(event_id: int, db: Session = Depends(get_db)):
    return _get_or_404(db, event_id)


@router.post("", response_model=EarthquakeOut, status_code=201,
             dependencies=[Depends(require_writer)])
def create_earthquake(body: EarthquakeCreate, response: Response, db: Session = Depends(get_db)):
    src = _manual_source(db)
    event = EarthquakeEvent(
        source_id=src.id, source_attribution=MANUAL_ATTRIBUTION,
        imported_at=datetime.now(timezone.utc),
        **{k: _store(k, v) for k, v in body.model_dump().items()})
    db.add(event)
    db.flush()
    db.add(EventUpdate(event_id=event.id, change_type="created", changed_fields={},
                       note="Created through the API"))
    db.commit()
    response.headers["Location"] = f"/api/earthquakes/{event.id}"
    return event


@router.put("/{event_id}", response_model=EarthquakeOut, dependencies=[Depends(require_writer)])
def replace_earthquake(event_id: int, body: EarthquakeCreate, db: Session = Depends(get_db)):
    event = _get_or_404(db, event_id)
    _require_manual(event)
    _apply(db, event, body.model_dump())
    db.commit()
    return event


@router.patch("/{event_id}", response_model=EarthquakeOut, dependencies=[Depends(require_writer)])
def update_earthquake(event_id: int, body: EarthquakePatch, db: Session = Depends(get_db)):
    event = _get_or_404(db, event_id)
    _require_manual(event)
    _apply(db, event, body.model_dump(exclude_unset=True))
    db.commit()
    return event


@router.delete("/{event_id}", status_code=204, dependencies=[Depends(require_writer)])
def delete_earthquake(event_id: int, db: Session = Depends(get_db)):
    event = _get_or_404(db, event_id)
    _require_manual(event)
    db.delete(event)  # event_updates/event_regions rows cascade in the database
    db.commit()
    return Response(status_code=204)
