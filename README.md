# Heiz: Earthquake Information API

An educational REST API and live map that store and serve earthquake information **reported by BMKG**
(Badan Meteorologi, Klimatologi, dan Geofisika), the Indonesian meteorology and geophysics agency.
Built with Python (FastAPI), PostgreSQL and Leaflet as a Learning Labs backend project.

> **Not an official service.** Heiz does not predict earthquakes, is not an early-warning system, and does not
> calculate magnitudes or epicentres. For official information use https://www.bmkg.go.id/ .
> **Data credit:** BMKG, https://data.bmkg.go.id/gempabumi/ . Respect BMKG's terms (attribution, 60 requests/minute/IP).

- **Live demo:** [Heiz](https://heiz.vercel.app/) (map, `/guide`, `/docs`)
- **Docs:** [API reference](docs/API.md) | [ERD](docs/ERD.md)

## What it does
- Imports BMKG's public JSON feeds (latest, M 5+, felt), validates and de-duplicates them, and logs every import.
- Serves them as JSON with filters and pagination, plus full create/read/update/delete for manually added test records.
- Shows them on a map with switchable basemaps, depth and magnitude styling, animated recent events and a 48-hour replay, behind a splash screen that checks the service and database first.
- Handles an unreachable database gracefully: `503` with a retry hint, and a map that keeps the last data saved in your browser.

## Try it without any setup
```bash
python -m venv .venv && source .venv/bin/activate      # Python 3.12 or newer
pip install -r requirements-dev.txt
pytest -q
python tools/demo_server.py                            # http://127.0.0.1:8765, FAKE demo data, in-memory SQLite
```

## Run your own copy
1. Create a PostgreSQL database (the project was built on Supabase Free) and run `sql/schema_v2.sql` in it.
2. `cp .env.example .env`, fill in `DATABASE_URL`, and generate two different 24+ character secrets for `HEIZ_API_KEY` (manual CRUD) and `HEIZ_ADMIN_TOKEN` (sync, cleanup, dashboard).
3. `uvicorn app.main:app --reload`, then open `/health/db`.
4. Import data with `POST /api/sync` (Bearer admin token). Nothing syncs automatically: call it yourself or from a scheduler you set up.
5. Deploy: Vercel detects the FastAPI app at `app/main.py`. Set the same variables as Vercel environment variables.

## Security model
Reading is public. Manual writes need `X-API-Key`; sync, cleanup and the dashboard need the admin Bearer token (the dashboard has its own sign-in page and a signed, HttpOnly page cookie). Secrets live only in
environment variables and must be 24+ characters. Imported BMKG records are read-only through the API. Pages ship a strict
Content-Security-Policy, all API text is inserted with `textContent`, and Row Level Security is enabled in `sql/schema_v2.sql`.
This is a class-project scheme (shared secrets), not per-user authentication. Report issues by opening an issue.

## Troubleshooting (Windows): blank map, dead buttons
If the console says `Refused to execute script ... MIME type ('text/plain')`, your OS registry maps `.js` to the wrong type. `app/web.py` serves static files with a fixed
Content-Type table to avoid this; hard-reload (Ctrl+F5) if you still see old behaviour.

## Keeping a free database small
`POST /api/admin/maintenance/prune` (admin, preview by default) clears old raw payloads and deletes old audit rows, sync logs and
imported events. Defaults are in `app/config.py`. The dashboard shows database size against the quota.

## Credits
- Earthquake data: **BMKG**.
- Libraries: FastAPI, Pydantic, SQLAlchemy, psycopg, httpx, pytest. [Leaflet](https://leafletjs.com) 1.9.4 (BSD-2-Clause). Fonts: Bricolage Grotesque and Atkinson Hyperlegible (SIL OFL 1.1). Licenses are in `web/assets/`.
- Map tiles load at runtime from Esri, OpenTopoMap and OpenStreetMap contributors, with attribution on the map; a bundled Natural Earth outline is the offline fallback. Check each provider's terms before heavy use.
- Deployment approach: Vercel's FastAPI guide, https://vercel.com/docs/frameworks/backend/fastapi .

MIT, see `LICENSE`. Third-party material keeps its own licenses (`THIRD_PARTY_NOTICES.md`). The Heiz name and logo files are not covered by MIT.
