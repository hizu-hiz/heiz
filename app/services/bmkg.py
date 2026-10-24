"""BMKG importer: fetch -> validate -> normalize -> deduplicate -> upsert, with audit logging.

Data source: Badan Meteorologi, Klimatologi, dan Geofisika (BMKG), https://data.bmkg.go.id/gempabumi/
Feeds used (JSON, base https://data.bmkg.go.id/DataMKG/TEWS/): autogempa.json (latest),
gempaterkini.json (15 most recent M5.0+), gempadirasakan.json (15 most recent felt).
Heiz is an educational project and is NOT an official BMKG service.

Observed record fields: Tanggal, Jam, DateTime (ISO UTC),
Coordinates ("lat,lon"), Lintang, Bujur, Magnitude, Kedalaman ("76 km"), Wilayah, and either
Potensi (M5+/latest) or Dirasakan (felt). The feeds expose NO stable event id; see dedupe_key().
"""
import logging
import re
from dataclasses import dataclass, field
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation
from typing import Any, Callable

import httpx
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import BMKG_FEED_NAMES, Settings
from app.models import DataSource, EarthquakeEvent, EventUpdate, SyncLog

log = logging.getLogger("heiz.bmkg")

USER_AGENT = "Heiz-LearningLabs/1.0 (educational project; data credit: BMKG)"
_DEPTH_RE = re.compile(r"^\s*(\d+(?:\.\d+)?)\s*km\s*$", re.IGNORECASE)
TRACKED_FIELDS = ("occurred_at", "location_description", "latitude", "longitude",
                  "magnitude", "depth_km", "tsunami_potential")


class FeedError(Exception):
    """Whole-feed failure. `summary` is already sanitized and safe to store/return."""

    def __init__(self, summary: str):
        super().__init__(summary)
        self.summary = summary


class RecordError(ValueError):
    """One record is unusable; it is skipped, never written."""


@dataclass
class NormalizedEvent:
    key: str
    occurred_at: datetime
    location_description: str
    latitude: Decimal
    longitude: Decimal
    magnitude: Decimal | None
    depth_km: Decimal | None
    tsunami_potential: bool | None
    raw: dict[str, Any] = field(default_factory=dict)


def feed_url(settings: Settings, feed: str) -> str:
    if feed not in BMKG_FEED_NAMES:
        raise ValueError(f"unknown feed '{feed}'")
    return f"{settings.bmkg_base_url.rstrip('/')}/{feed}.json"


def fetch_feed(url: str, settings: Settings) -> Any:
    """GET + parse JSON with timeout, size cap and sanitized errors."""
    try:
        resp = httpx.get(url, timeout=settings.bmkg_timeout_seconds, follow_redirects=False,
                         headers={"User-Agent": USER_AGENT, "Accept": "application/json"})
    except httpx.TimeoutException:
        raise FeedError("BMKG request timed out") from None
    except httpx.HTTPError:
        raise FeedError("BMKG request failed (network error)") from None
    if resp.status_code != 200:
        raise FeedError(f"BMKG responded with HTTP {resp.status_code}")
    if len(resp.content) > settings.bmkg_max_response_bytes:
        raise FeedError("BMKG response exceeded the size limit")
    try:
        return resp.json()
    except ValueError:
        raise FeedError("BMKG response was not valid JSON") from None


def extract_records(payload: Any) -> list[Any]:
    """Accept a bare list, or {"Infogempa": {"gempa": <dict|list>}}. Anything else is an error."""
    if isinstance(payload, list):
        return payload
    if isinstance(payload, dict):
        info = payload.get("Infogempa")
        if isinstance(info, dict) and "gempa" in info:
            g = info["gempa"]
            if isinstance(g, list):
                return g
            if isinstance(g, dict):
                return [g]
    raise FeedError("unexpected BMKG payload structure")


def _dec(text: str, places: str) -> Decimal:
    try:
        d = Decimal(text.strip())
    except (InvalidOperation, AttributeError):
        raise RecordError(f"not a number: {text!r}") from None
    if not d.is_finite():
        raise RecordError("non-finite number")
    return d.quantize(Decimal(places))


def parse_tsunami(value: Any) -> bool | None:
    """'Tidak berpotensi tsunami' -> False; 'Berpotensi tsunami' -> True; absent/unknown -> None."""
    if not isinstance(value, str):
        return None
    s = value.lower()
    if "tsunami" not in s:
        return None
    if "tidak" in s:
        return False
    return True if "berpotensi" in s else None


def normalize_record(item: Any) -> NormalizedEvent:
    if not isinstance(item, dict):
        raise RecordError("record is not an object")

    raw_dt = item.get("DateTime")
    try:
        occurred = datetime.fromisoformat(str(raw_dt).replace("Z", "+00:00"))
    except ValueError:
        raise RecordError("missing or invalid DateTime") from None
    if occurred.tzinfo is None:
        raise RecordError("DateTime has no timezone")
    occurred = occurred.astimezone(timezone.utc)

    coords = item.get("Coordinates")
    parts = coords.split(",") if isinstance(coords, str) else []
    if len(parts) != 2:
        raise RecordError("missing or invalid Coordinates")
    lat, lon = _dec(parts[0], "0.000001"), _dec(parts[1], "0.000001")
    if not (-90 <= lat <= 90 and -180 <= lon <= 180):
        raise RecordError("coordinates out of range")

    place = item.get("Wilayah")
    if not isinstance(place, str) or not place.strip():
        raise RecordError("missing Wilayah (location_description is required)")

    magnitude = None
    if item.get("Magnitude") not in (None, ""):
        magnitude = _dec(str(item["Magnitude"]), "0.01")
        if not 0 <= magnitude <= 10:
            raise RecordError("magnitude out of range")

    depth = None
    if item.get("Kedalaman") not in (None, ""):
        m = _DEPTH_RE.match(str(item["Kedalaman"]))
        if not m:
            raise RecordError("unrecognized Kedalaman format")
        depth = _dec(m.group(1), "0.01")

    return NormalizedEvent(
        key=dedupe_key(occurred, parts[0], parts[1]),
        occurred_at=occurred,
        location_description=place.strip()[:500],
        latitude=lat, longitude=lon, magnitude=magnitude, depth_km=depth,
        tsunami_potential=parse_tsunami(item.get("Potensi")),
        raw=item,
    )


def dedupe_key(occurred_utc: datetime, lat_text: str, lon_text: str) -> str:
    """BMKG feeds provide NO event id, so Heiz DERIVES one: origin time (UTC, seconds) + the
    epicentre string exactly as published. Magnitude is excluded so revisions update the same row.
    Limitation: if BMKG revises time or coordinates, the revised event is stored as a new record."""
    return f"derived:{occurred_utc:%Y-%m-%dT%H:%M:%SZ}|{lat_text.strip()},{lon_text.strip()}"


def _jsonable(v: Any) -> Any:
    if isinstance(v, Decimal):
        return str(v)
    if isinstance(v, datetime):
        return v.isoformat()
    return v


def _same(a: Any, b: Any) -> bool:
    if isinstance(a, datetime) and isinstance(b, datetime):
        a = a if a.tzinfo else a.replace(tzinfo=timezone.utc)  # SQLite test DB returns naive
        b = b if b.tzinfo else b.replace(tzinfo=timezone.utc)
    return a == b


def upsert_event(db: Session, source: DataSource, ev: NormalizedEvent, feed: str,
                 url: str, sync: SyncLog) -> str:
    """Return 'created', 'updated' or 'unchanged'. Never overwrites a stored value with None."""
    existing = db.scalar(select(EarthquakeEvent).where(
        EarthquakeEvent.source_id == source.id, EarthquakeEvent.source_event_id == ev.key))

    if existing is None:
        row = EarthquakeEvent(
            source_id=source.id, source_event_id=ev.key, last_sync_id=sync.id,
            occurred_at=ev.occurred_at, location_description=ev.location_description,
            latitude=ev.latitude, longitude=ev.longitude, magnitude=ev.magnitude,
            depth_km=ev.depth_km, tsunami_potential=ev.tsunami_potential,
            source_url=url, source_attribution="BMKG",
            raw_payload={feed: ev.raw}, imported_at=datetime.now(timezone.utc))
        db.add(row)
        db.flush()
        db.add(EventUpdate(event_id=row.id, sync_log_id=sync.id, change_type="created",
                           changed_fields={}, note=f"Imported from BMKG feed '{feed}'"))
        return "created"

    changes: dict[str, dict] = {}
    for name in TRACKED_FIELDS:
        new = getattr(ev, name)
        old = getattr(existing, name)
        if new is not None and not _same(old, new):
            changes[name] = {"old": _jsonable(old), "new": _jsonable(new)}
            setattr(existing, name, new)

    payload = dict(existing.raw_payload or {})
    if payload.get(feed) != ev.raw:
        payload[feed] = ev.raw
        existing.raw_payload = payload
    existing.last_sync_id = sync.id

    if not changes:
        return "unchanged"
    existing.updated_at = datetime.now(timezone.utc)
    corrected = bool({"magnitude", "depth_km"} & changes.keys())
    db.add(EventUpdate(event_id=existing.id, sync_log_id=sync.id,
                       change_type="corrected" if corrected else "updated",
                       changed_fields=changes, note=f"Changed by BMKG feed '{feed}'"))
    return "updated"


def run_feed_sync(db: Session, source: DataSource, feed: str, settings: Settings,
                  fetcher: Callable[[str, Settings], Any] = fetch_feed) -> SyncLog:
    """Sync ONE feed. Always leaves a finished sync_logs row (success/partial/failed)."""
    url = feed_url(settings, feed)
    sync = SyncLog(source_id=source.id, status="running", request_url=url,
                   started_at=datetime.now(timezone.utc))
    db.add(sync)
    db.commit()  # the 'running' row exists even if everything after this fails

    created = updated = skipped = invalid = 0
    received = 0
    problems: list[str] = []
    status = "success"
    try:
        records = extract_records(fetcher(url, settings))
        received = len(records)
        for i, item in enumerate(records):
            try:
                ev = normalize_record(item)
            except RecordError as exc:
                invalid += 1
                skipped += 1
                problems.append(f"record {i}: {exc}")
                continue
            with db.begin_nested():  # a failing record rolls back alone
                outcome = upsert_event(db, source, ev, feed, url, sync)
            if outcome == "created":
                created += 1
            elif outcome == "updated":
                updated += 1
            else:
                skipped += 1  # duplicate with no new information
        if invalid:
            status = "partial" if (created + updated + (skipped - invalid)) > 0 else "failed"
            problems = [f"{invalid} of {received} records were invalid"] + problems[:5]
        db.commit()
    except FeedError as exc:
        db.rollback()
        status, problems = "failed", [exc.summary]
    except Exception as exc:  # DB or logic error: record a sanitized note, never the raw text
        db.rollback()
        log.exception("sync failed")
        status, problems = "failed", [f"internal error ({type(exc).__name__})"]
        created = updated = 0

    sync = db.get(SyncLog, sync.id)
    sync.status = status #type: ignore
    sync.finished_at = datetime.now(timezone.utc) #type: ignore
    sync.records_received, sync.records_created = received, created #type: ignore
    sync.records_updated, sync.records_skipped = updated, skipped #type: ignore
    sync.error_summary = "; ".join(problems)[:1000] or None #type: ignore
    db.commit()
    return sync #type: ignore
