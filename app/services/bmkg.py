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
                  "magnitude", "depth_km", "tsunami_potential", "tsunami_note", "felt_text",
                  "shakemap_code")
_SHAKEMAP_RE = re.compile(r"^[A-Za-z0-9._-]{1,100}$")
_ACTIVE_LEVELS = {"waspada", "siaga", "awas"}
# Real wording: "Tsunami Tingkat Ancaman AWAS" (level words only count next to the word "tsunami").
_LEVEL_RE = re.compile(r"\b(?:waspada|siaga|awas)\b")


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
    tsunami_note: str | None = None
    felt_text: str | None = None
    shakemap_code: str | None = None
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


def classify_potensi(value: Any) -> tuple[bool | None, str | None]:
    """Return (tsunami_potential, verbatim_text) from BMKG's free-text `Potensi` field.

    Tri-state, never invented:
      False -> BMKG explicitly says there is NO tsunami potential ("Tidak berpotensi tsunami")
      True  -> BMKG indicates tsunami potential / an active warning ("Berpotensi tsunami",
               "Peringatan Dini Tsunami", "Potensi tsunami ...", "Tsunami Tingkat Ancaman
               WASPADA/SIAGA/AWAS", or a bare level word)
      None  -> anything else: missing/empty text, a *felt-quake notice* ("Gempa ini dirasakan ..."),
               a warning-ended notice ("... telah BERAKHIR"), or unrecognized text.
    Those cases say nothing about tsunami risk, so they must not become False (a false "all clear").
    The original text is always returned so nothing is lost."""
    if not isinstance(value, str) or not value.strip():
        return None, None
    text = value.strip()[:500]
    s = " ".join(text.lower().split())
    if "berakhir" in s or "dicabut" in s or "dirasakan" in s:
        return None, text
    if "tidak berpotensi" in s or "tidak ada potensi" in s:
        return False, text
    if ("berpotensi tsunami" in s or "potensi tsunami" in s or "peringatan dini tsunami" in s
            or s in _ACTIVE_LEVELS or ("tsunami" in s and _LEVEL_RE.search(s))):
        return True, text
    return None, text


def _clean(value: Any, limit: int = 500) -> str | None:
    return value.strip()[:limit] if isinstance(value, str) and value.strip() else None


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

    tsunami, tsunami_note = classify_potensi(item.get("Potensi"))
    shake = _clean(item.get("Shakemap"), 1000)  # validated below, never truncated into validity

    return NormalizedEvent(
        key=dedupe_key(occurred, parts[0], parts[1]),
        occurred_at=occurred,
        location_description=place.strip()[:500],
        latitude=lat, longitude=lon, magnitude=magnitude, depth_km=depth,
        tsunami_potential=tsunami, tsunami_note=tsunami_note,
        felt_text=_clean(item.get("Dirasakan")),
        shakemap_code=shake if shake and _SHAKEMAP_RE.match(shake) else None,
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
                 url: str, sync: SyncLog, known: dict[str, EarthquakeEvent],
                 audit: list[tuple[EarthquakeEvent, str, dict, str]]) -> str:
    """Return 'created', 'updated' or 'unchanged'. Never overwrites a stored value with None.

    `known` maps source_event_id -> row for every event this feed mentions (one SELECT for the whole feed, because
    one query per record is what made syncs time out on Vercel: every query is a network round trip to the database).
    Audit rows are queued in `audit` and written after one flush, so there is no per-record flush either."""
    existing = known.get(ev.key)

    if existing is None:
        row = EarthquakeEvent(
            source_id=source.id, source_event_id=ev.key, last_sync_id=sync.id,
            occurred_at=ev.occurred_at, location_description=ev.location_description,
            latitude=ev.latitude, longitude=ev.longitude, magnitude=ev.magnitude,
            depth_km=ev.depth_km, tsunami_potential=ev.tsunami_potential,
            tsunami_note=ev.tsunami_note, felt_text=ev.felt_text, shakemap_code=ev.shakemap_code,
            source_url=url, source_attribution="BMKG",
            raw_payload={feed: ev.raw}, imported_at=datetime.now(timezone.utc))
        db.add(row)
        known[ev.key] = row
        audit.append((row, "created", {}, f"Imported from BMKG feed '{feed}'"))
        return "created"

    changes: dict[str, dict] = {}
    for name in TRACKED_FIELDS:
        new = getattr(ev, name)
        old = getattr(existing, name)
        # A feed that only says "felt" must not replace the tsunami wording another feed gave.
        if name == "tsunami_note" and old is not None and ev.tsunami_potential is None:
            continue
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
    audit.append((existing, "corrected" if corrected else "updated", changes, f"Changed by BMKG feed '{feed}'"))
    return "updated"


def _apply(db: Session, source: DataSource, feed: str, url: str, sync: SyncLog,
           events: list[NormalizedEvent], isolate: bool) -> tuple[int, int, int]:
    """Write normalized events. isolate=False: one SELECT, one flush for rows, one for audit rows (minimal round trips).
    isolate=True: a savepoint per record (slow, used only to recover from a failure of the fast path)."""
    created = updated = unchanged = 0
    keys = list({e.key for e in events})
    known: dict[str, EarthquakeEvent] = {}
    if keys:
        for row in db.scalars(select(EarthquakeEvent).where(EarthquakeEvent.source_id == source.id,
                                                            EarthquakeEvent.source_event_id.in_(keys))):
            known[row.source_event_id] = row                                                                #type: ignore
    audit: list[tuple[EarthquakeEvent, str, dict, str]] = []
    for ev in events:
        if isolate:
            local: list = []
            try:
                with db.begin_nested():
                    outcome = upsert_event(db, source, ev, feed, url, sync, known, local)
                    db.flush()
                    for row, kind, changed, note in local:
                        db.add(EventUpdate(event_id=row.id, sync_log_id=sync.id, change_type=kind, changed_fields=changed, note=note))
            except Exception:
                log.exception("record failed")
                known.pop(ev.key, None)
                continue
        else:
            outcome = upsert_event(db, source, ev, feed, url, sync, known, audit)
        if outcome == "created":
            created += 1
        elif outcome == "updated":
            updated += 1
        else:
            unchanged += 1
    if not isolate:
        db.flush()                                  # assigns ids to new rows
        for row, kind, changed, note in audit:
            db.add(EventUpdate(event_id=row.id, sync_log_id=sync.id, change_type=kind, changed_fields=changed, note=note))
        db.flush()
    return created, updated, unchanged


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
        parsed: list[tuple[int, NormalizedEvent]] = []
        for i, item in enumerate(records):
            try:
                parsed.append((i, normalize_record(item)))
            except RecordError as exc:
                invalid += 1
                skipped += 1
                problems.append(f"record {i}: {exc}")
        try:
            created, updated, unchanged = _apply(db, source, feed, url, sync, [e for _, e in parsed], isolate=False)
        except Exception:
            # Fast path (one transaction, few round trips) failed: redo record by record so one bad row
            # cannot take the others down with it.
            db.rollback()
            log.warning("bulk apply failed for %s, retrying record by record", feed, exc_info=True)
            created, updated, unchanged = _apply(db, source, feed, url, sync, [e for _, e in parsed], isolate=True)
        skipped += unchanged
        if invalid:
            status = "partial" if (created + updated + unchanged) > 0 else "failed"
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
