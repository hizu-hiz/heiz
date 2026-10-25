# Heiz API Reference

Public URL: [Heiz](https://heiz.vercel.app/)

All bodies are JSON.
Interactive docs generated from the code: `/docs` (Swagger UI) and `/openapi.json`.

**Data credit:** earthquake records are reported by BMKG (https://data.bmkg.go.id/gempabumi/). Heiz is an
educational project, not an official or early-warning service.

## Conventions

| Item | Rule |
|---|---|
| Access levels | **Public:** all `GET` except `/api/admin/*`. **Writer key:** header `X-API-Key: <HEIZ_API_KEY>` for `POST`/`PUT`/`PATCH`/`DELETE` on `/api/earthquakes`. **Admin:** header `Authorization: Bearer <HEIZ_ADMIN_TOKEN>` for `POST /api/sync`, `/api/admin/*` (and it may also use the write endpoints). Secrets under 24 characters are ignored; with none configured the protected endpoints answer `503 writes_disabled` / `503 admin_disabled`. |
| Error shape | `{"error": {"code": "...", "message": "...", "details": [...optional]}}` |
| Validation failures | `400 validation_error` with `details: [{"field", "problem"}]` |
| Timestamps | ISO 8601 with offset. Request datetimes **must** include a timezone (e.g. `Z`). |
| Pagination | `limit` (1-100, default 20) and `offset` (>=0). Out-of-range values return 400. |
| Ownership policy | Records imported from BMKG are **read-only**; PUT/PATCH/DELETE on them return `403 imported_record_protected`. Only records created by `POST` (source `MANUAL`) can be changed or deleted. |

Common errors: `401 unauthorized`, `404 not_found`, `409 conflict` (database rule/unique violation),
`429 sync_throttled`, `503 database_unavailable`, `500 internal_error` (no internals are exposed).

**Database outage contract (for UIs):** connection failures return `503` with header `Retry-After: 30` and
`{"error": {"code": "database_unavailable", "message": "...", "retryable": true, "retry_after_seconds": 30}}`.
Retry only `GET`s automatically; never auto-retry writes. `GET /api/status` always returns 200 and reports the state.

---

## GET /health
- **Purpose:** liveness check (does not use the database).
- **Headers:** none.
- **Success 200:** `{"status": "ok", "service": "heiz"}`

## GET /api/status
- **Purpose:** state for UIs; never returns 5xx. **Success 200:** `{"api": "ok", "database": "ok" | "unavailable" | "not_configured", "latency_ms": 41, "checked_at": "...", "retry_after_seconds": 30}` (`retry_after_seconds` only when unavailable). Sent with `Cache-Control: no-store`.

## GET /health/db
- **Purpose:** proves the deployed API can reach PostgreSQL.
- **Success 200:** `{"status": "ok", "database": "reachable"}`
- **Error 503:** `{"error": {"code": "database_unavailable", "message": "The database is temporarily unavailable."}}`

## GET /api/earthquakes
- **Purpose:** list stored events, newest `occurred_at` first.
- **Query:** `limit`, `offset`, `min_magnitude` (0-10), `source` (e.g. `BMKG`, `MANUAL`), `occurred_after`, `occurred_before` (ISO 8601).
- **Success 200:**
```json
{
  "data": [{
    "id": 12, "source_code": "BMKG",
    "source_event_id": "derived:2026-10-11T21:34:53Z|0.64,121.75",
    "occurred_at": "2026-10-11T21:34:53Z", "source_reported_at": null,
    "location_description": "29 km BaratLaut POHUWATO-GORONTALO",
    "latitude": 0.64, "longitude": 121.75, "magnitude": 5.7, "depth_km": 76.0,
    "tsunami_potential": false,
    "tsunami_note": "Tidak berpotensi tsunami",
    "felt_text": null,
    "shakemap_url": null,
    "source_url": "https://data.bmkg.go.id/DataMKG/TEWS/gempaterkini.json",
    "source_attribution": "BMKG",
    "imported_at": "2026-10-16T08:00:00Z", "created_at": "2026-10-16T08:00:00Z", "updated_at": "2026-10-16T08:00:00Z"
  }],
  "pagination": {"limit": 20, "offset": 0, "total": 1}
}
```
- **Empty database:** `200` with `"data": []`.
- **Error 400:** invalid `limit`, `offset`, or `min_magnitude`.

## GET /api/earthquakes/{id}
- **Purpose:** one event, including `raw_payload` (original BMKG record(s), keyed by feed name).
- **Success 200:** the object above plus `"raw_payload": {...}`.
- **Error 404:** `{"error": {"code": "not_found", "message": "Earthquake event 999 was not found."}}`

## POST /api/earthquakes
- **Purpose:** create a manual event (source `MANUAL`; attribution "Manual entry (not an official report)").
- **Headers:** `Content-Type: application/json`, `X-API-Key: <key>`
- **Body:** `location_description` (required, 1-500 chars); optional `occurred_at`, `source_reported_at`,
  `latitude` (-90..90), `longitude` (-180..180) (give both or neither), `magnitude` (0-10), `depth_km` (>=0),
  `tsunami_potential` (bool), `source_url` (http/https). Unknown fields (e.g. `source_id`) are rejected.
```json
{"location_description": "Test location, Bogor", "latitude": -6.69, "longitude": 106.63,
 "magnitude": 2.5, "depth_km": 9, "occurred_at": "2026-10-16T03:21:55Z"}
```
- **Success 201:** the event object; `Location: /api/earthquakes/{id}` header.
- **Errors:** 400 (invalid body), 401 (missing/wrong key), 503 (writes disabled / DB down).

## PUT /api/earthquakes/{id}
- **Purpose:** replace all editable fields (same body as POST; omitted optional fields become `null`).
- **Headers/Body:** as POST.
- **Success 200:** updated event. **Errors:** 400, 401, 403 `imported_record_protected`, 404.

## PATCH /api/earthquakes/{id}
- **Purpose:** change only the fields sent, e.g. `{"magnitude": 3.1}`. An empty body is a 400.
- **Success 200:** updated event. **Errors:** 400, 401, 403, 404.
- Each real change writes an `event_updates` row (`manual_edit`) with old/new values; POST writes `created`.

## DELETE /api/earthquakes/{id}
- **Purpose:** delete a manual event (its `event_updates` cascade).
- **Headers:** `X-API-Key`. **Success 204:** empty body. **Errors:** 401, 403, 404.

## GET /api/sources
- **Purpose:** list data sources. **Success 200:** `[{"id":1,"code":"BMKG","name":"...","base_url":"...","description":"...","is_active":true}]`

## GET /api/sync-logs
- **Purpose:** synchronization history, newest first. **Query:** `limit`, `offset`, `status` (`running|success|partial|failed`).
- **Success 200:**
```json
{"data": [{"id": 3, "source_id": 1, "started_at": "...", "finished_at": "...", "status": "success",
  "records_received": 15, "records_created": 15, "records_updated": 0, "records_skipped": 0,
  "error_summary": null, "request_url": "https://data.bmkg.go.id/DataMKG/TEWS/gempaterkini.json"}],
 "pagination": {"limit": 20, "offset": 0, "total": 1}}
```

**Tsunami fields:** `tsunami_potential` is `true`/`false` only when BMKG's text says so, otherwise `null` (felt notices, blank or
ended-warning text are `null`, which is not an all-clear). `tsunami_note` is BMKG's wording verbatim. `felt_text` is BMKG's "Dirasakan" text.
`shakemap_url` points to BMKG's image host (`https://static.bmkg.go.id/...`) when BMKG supplied a shakemap.

## POST /api/sync
- **Purpose:** fetch BMKG feeds and import them. Not automatic: something must call it (dashboard button or a scheduler).
- **Headers:** `Content-Type: application/json`, `Authorization: Bearer <admin token>`
- **Body (optional):** `{"feeds": ["gempaterkini", "gempadirasakan", "autogempa"]}` (default: all three).
- **Success 200:** one sync-log object per feed (see above). A BMKG outage still returns 200 with
  `"status": "failed"` and a sanitized `error_summary`; check the `status` field.
- **Errors:** 400 (unknown feed), 401, 409 `source_unavailable`, 429 `sync_throttled` (+ `Retry-After`; at most one sync per 60 s), 503.

## GET /api/admin/whoami
- **Purpose:** check an admin token without using the database. **Headers:** `Authorization: Bearer <admin token>`.
- **Success 200:** `{"role": "admin"}`. **Errors:** 401 (`WWW-Authenticate: Bearer`), 503 `admin_disabled`.

## GET /api/admin/overview
- **Purpose:** counts, database size against the quota, last sync, retention settings (feeds the dashboard). **Headers:** admin bearer.
- **Success 200:** `{"counts": {"earthquake_events": 34, "manual_events": 0, "event_updates": 0, "sync_logs": 5}, "storage": {"supported": true, "database_bytes": 0, "quota_bytes": 524288000, "used_fraction": 0.0, "tables": [{"name": "earthquake_events", "bytes": 0}]}, "last_sync": {...} | null, "retention": {...}}`
- **Errors:** 401, 503 (`database_unavailable` is retryable).

## POST /api/admin/maintenance/prune
- **Purpose:** free-tier housekeeping. **Headers:** admin bearer, `Content-Type: application/json`.
- **Body:** `{"dry_run": true}` (default). Send `false` to delete. Rules: stale `running` sync logs become `failed`; `raw_payload` cleared after 14 days;
  `event_updates` deleted after 90 days; sync logs after 30 days; imported events after 365 days. `MANUAL` events are never removed. Each rule touches at most `batch_size` rows per call (`more_pending` says to run again); a day count of 0 disables a rule.
- **Success 200:** `{"dry_run": true, "ran_at": "...", "batch_size": 5000, "steps": [{"rule": "delete_old_sync_logs", "enabled": true, "days": 30, "matched": 12, "changed": 0, "more_pending": false}]}`
- **Errors:** 401, 503.

## Pages (HTML, not JSON)
`/` landing page with live map (a splash screen first checks the service and database), `/guide` endpoint guide, `/docs` Swagger UI, and `/dashboard/` the owner sign-in page.
After sign-in the dashboard is served only at `/dashboard/dashboard-<id>.html` (404 without the session cookie).

## POST /api/admin/session  and  DELETE /api/admin/session
- **Purpose:** dashboard login/logout. **Headers (POST):** admin bearer. No database is used, so it works during an outage.
- **Success 200 (POST):** `{"role": "admin", "dashboard_url": "/dashboard/dashboard-<id>.html", "expires_in": 28800}` plus `Set-Cookie: heiz_dash=...; HttpOnly; SameSite=Strict; Path=/dashboard` (`Secure` on HTTPS).
  The cookie only unlocks the dashboard *page*; no API endpoint accepts it.
- **Errors:** 401 `unauthorized` (counts toward the throttle), 429 `login_throttled` (8 failures per 10 minutes per client; see `Retry-After`), 503 `admin_disabled`.
- **DELETE:** clears the cookie, returns 204.
