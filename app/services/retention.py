"""Free-tier housekeeping: keep the Supabase database small. Dry-run by default.

Rules (days configurable in app/config.py, 0 disables a rule), each capped at prune_batch_size rows
per run so one call can never run long:
  1. 'running' sync logs older than stale_running_minutes -> marked 'failed'
  2. raw_payload nulled on events older than retention_raw_payload_days (normalized columns stay)
  3. event_updates older than retention_event_updates_days -> deleted
  4. finished sync_logs older than retention_sync_logs_days -> deleted (FKs are ON DELETE SET NULL)
  5. imported events older than retention_events_days -> deleted (MANUAL events are never pruned)
"""
from datetime import datetime, timedelta, timezone

from sqlalchemy import delete, func, null, select, text, update
from sqlalchemy.orm import Session

from app.config import MANUAL_SOURCE_CODE, Settings
from app.models import DataSource, EarthquakeEvent, EventUpdate, SyncLog


def _capped_ids(db: Session, model, cond, limit: int):
    return select(model.id).where(cond).order_by(model.id).limit(limit)


def run_prune(db: Session, settings: Settings, dry_run: bool = True) -> dict:
    now = datetime.now(timezone.utc)
    batch = settings.prune_batch_size
    steps: list[dict] = []

    def step(name: str, model, cond, days: int | None, apply):
        if days is not None and days <= 0:
            steps.append({"rule": name, "enabled": False, "matched": 0, "changed": 0})
            return
        matched = db.scalar(select(func.count()).select_from(model).where(cond)) or 0
        changed = 0
        if not dry_run and matched:
            changed = apply(_capped_ids(db, model, cond, batch)).rowcount or 0
        steps.append({"rule": name, "enabled": True, "days": days, "matched": matched,
                      "changed": changed, "more_pending": matched > batch})

    stale_cut = now - timedelta(minutes=settings.stale_running_minutes)
    step("stale_running_sync_logs", SyncLog,
         (SyncLog.status == "running") & (SyncLog.started_at < stale_cut),
         None,
         lambda ids: db.execute(update(SyncLog).where(SyncLog.id.in_(ids)).values(
             status="failed", finished_at=now,
             error_summary="marked failed: still 'running' after "
                           f"{settings.stale_running_minutes} minutes")))

    d = settings.retention_raw_payload_days
    step("null_old_raw_payload", EarthquakeEvent,
         EarthquakeEvent.raw_payload.is_not(None) & (EarthquakeEvent.imported_at < now - timedelta(days=d)),
         d,
         lambda ids: db.execute(update(EarthquakeEvent).where(EarthquakeEvent.id.in_(ids))
                                .values(raw_payload=null())))

    d = settings.retention_event_updates_days
    step("delete_old_event_updates", EventUpdate, EventUpdate.changed_at < now - timedelta(days=d), d,
         lambda ids: db.execute(delete(EventUpdate).where(EventUpdate.id.in_(ids))))

    d = settings.retention_sync_logs_days
    step("delete_old_sync_logs", SyncLog,
         (SyncLog.status != "running") & (SyncLog.started_at < now - timedelta(days=d)), d,
         lambda ids: db.execute(delete(SyncLog).where(SyncLog.id.in_(ids))))

    d = settings.retention_events_days
    imported = EarthquakeEvent.source_id.in_(
        select(DataSource.id).where(DataSource.code != MANUAL_SOURCE_CODE))
    step("delete_old_imported_events", EarthquakeEvent,
         imported & (func.coalesce(EarthquakeEvent.occurred_at, EarthquakeEvent.imported_at)
                     < now - timedelta(days=d)), d,
         lambda ids: db.execute(delete(EarthquakeEvent).where(EarthquakeEvent.id.in_(ids))))

    if not dry_run:
        db.commit()
    return {"dry_run": dry_run, "ran_at": now.isoformat(), "batch_size": batch, "steps": steps}


def storage_report(db: Session, settings: Settings) -> dict:
    quota = settings.db_quota_mb * 1024 * 1024
    if db.get_bind().dialect.name != "postgresql":
        return {"supported": False, "quota_bytes": quota}
    total = db.scalar(text("SELECT pg_database_size(current_database())"))
    rows = db.execute(text(
        "SELECT c.relname, pg_total_relation_size(c.oid) FROM pg_class c "
        "JOIN pg_namespace n ON n.oid = c.relnamespace "
        "WHERE n.nspname = 'public' AND c.relkind = 'r' ORDER BY 2 DESC")).all()
    return {"supported": True, "database_bytes": total, "quota_bytes": quota,
            "used_fraction": round(total / quota, 4) if quota else None,
            "tables": [{"name": r[0], "bytes": r[1]} for r in rows]}
