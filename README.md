# Heiz: Earthquake Information API

Learning Labs Backend Development final project. Heiz stores, organizes and serves earthquake information
**reported by BMKG** (Badan Meteorologi, Klimatologi, dan Geofisika) through a Python REST API on PostgreSQL (Supabase).

> **Not an official service.** Heiz does not predict earthquakes, is not an early-warning system, and does not
> determine magnitude or epicentre. For official information use BMKG: https://www.bmkg.go.id/ .
> **Data credit:** BMKG, https://data.bmkg.go.id/gempabumi/ (used per its terms: attribution required, max 60 requests/minute/IP).

- **Base URL:** local: `http://127.0.0.1:8000`
- **Docs:** [API reference](docs/API.md) | [ERD](docs/ERD.md)

## Implementation status
| Area | Status |
|---|---|
| Supabase schema, 6 tables, 7 FKs, ERD | Done and verified |
| FastAPI app: health, earthquake CRUD, sources, sync-logs, sync | Implemented; 39 offline tests pass (SQLite) |
| Against real PostgreSQL / BMKG live / Vercel / public URL | Done and verified |
| Automatic periodic sync | **Not implemented**: `POST /api/sync` is manual or externally triggered |
| `regions` / `event_regions` population | Not implemented (no reliable source) |

## Stack
Python 3.12 (tested), FastAPI, Pydantic v2, SQLAlchemy 2 + psycopg 3, httpx, pytest | Hosted DB: Supabase PostgreSQL | Target: Vercel.

## Layout
```
app/main.py            FastAPI app + routers          app/services/bmkg.py   fetch/validate/normalize/dedupe/upsert
app/config.py          env settings                   app/routers/           health, earthquakes, sources, synchronization
app/database.py        lazy engine, NullPool          app/models/            SQLAlchemy mappings of the existing tables
app/security.py        X-API-Key check                app/schemas/           Pydantic request/response models
app/errors.py          uniform JSON errors            tests/  docs/  sql/
```

## Run locally
```bash
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env        # fill in DATABASE_URL and HEIZ_API_KEY
pytest -q
uvicorn app.main:app --reload   # open http://127.0.0.1:8000/docs
```
The schema already exists in Supabase; the app never creates or drops tables. `sql/001_heiz_schema.sql` is kept for reference.

## Design decisions
- **CRUD policy:** `POST` creates records under source `MANUAL`. Records imported from BMKG are read-only via the API (403), so manual edits cannot falsify attribution. Manual changes are logged in `event_updates`.
- **Deduplication:** BMKG feeds expose no event id, so `source_event_id` is derived from origin time + epicentre; the unique `(source_id, source_event_id)` constraint then blocks duplicates.
- **Missing data stays NULL**; a missing/invalid value from BMKG never overwrites a stored value; invalid records are skipped and counted (`partial`/`failed` in `sync_logs`).
- **Imports are traceable:** every attempt writes `sync_logs`; changes write `event_updates`; the original record is kept in `raw_payload`.

## Security
- Secrets only via environment variables (`.env` is git-ignored; `.env.example` has placeholders). Set them in Vercel for production.
- Writes and sync need `X-API-Key` (constant-time comparison); with no key configured they are disabled. Read endpoints are public. This is a shared-key scheme suitable for a class project, not per-user authentication.
- All DB access goes through SQLAlchemy (parameterized); request bodies reject unknown fields; BMKG responses are treated as untrusted (timeout, size cap, strict validation, no redirects).
- Errors never include stack traces, connection strings or SQL; sync errors are stored as sanitized summaries.
- Sync trigger is protected and throttled (1 per 60 s). No general rate limiting is implemented for public GETs; consider Vercel's firewall if needed.
- The API connects with the database user from `DATABASE_URL`. Never put a Supabase `service_role` key in this project.

## Credits
- Earthquake data: **BMKG**, https://data.bmkg.go.id/gempabumi/ (BMKG also publishes XML tooling at https://github.com/infoBMKG/data-gempabumi, not used here).
- Libraries: [FastAPI](https://fastapi.tiangolo.com/), [Pydantic](https://docs.pydantic.dev/), [SQLAlchemy](https://www.sqlalchemy.org/), [psycopg](https://www.psycopg.org/), [httpx](https://www.python-httpx.org/), [pytest](https://pytest.org/).
- Deployment approach follows Vercel's FastAPI guide: https://vercel.com/docs/frameworks/backend/fastapi
- ERD generated with DBeaver.
