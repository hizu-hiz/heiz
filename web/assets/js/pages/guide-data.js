/* Endpoint reference data. Kept separate from rendering so the docs can change without touching the page logic. */
export const EVENT = `{
  "id": 12,
  "source_code": "BMKG",
  "source_event_id": "derived:2026-10-11T21:34:53Z|0.64,121.75",
  "occurred_at": "2026-10-11T21:34:53Z",
  "location_description": "29 km BaratLaut POHUWATO-GORONTALO",
  "latitude": 0.64, "longitude": 121.75,
  "magnitude": 5.7, "depth_km": 76.0,
  "tsunami_potential": false,
  "tsunami_note": "Tidak berpotensi tsunami",
  "felt_text": null,
  "shakemap_url": null,
  "source_attribution": "BMKG"
}`;
export const MANUAL_BODY = `{
  "location_description": "Test location, Bogor",
  "latitude": -6.69, "longitude": 106.63,
  "magnitude": 2.5, "depth_km": 9,
  "occurred_at": "2026-10-16T03:21:55Z"
}`;
export const BODY_NOTES = [
  'location_description is required (1 to 500 characters). Every other field is optional.',
  'latitude (-90 to 90) and longitude (-180 to 180) must be sent together.',
  'magnitude is 0 to 10, depth_km is 0 or more, datetimes must include a timezone such as Z.',
  'Unknown fields (for example source_id) are rejected with 400.',
];
export const WHO = { public: 'public', writer: 'writer key', admin: 'admin token' };

export const ENDPOINTS = [
  { m: 'GET', p: '/health', who: 'public', what: 'Liveness check. Does not use the database.', ok: '200  { "status": "ok", "service": "heiz" }' },
  { m: 'GET', p: '/api/status', who: 'public', what: 'Is the API up, and can it reach the database? Always answers 200.',
    ok: '200  { "api": "ok", "database": "ok", "latency_ms": 41, "checked_at": "..." }\n\ndatabase is one of: ok, unavailable, not_configured.\nWhen unavailable the body also has retry_after_seconds.' },
  { m: 'GET', p: '/health/db', who: 'public', what: 'Readiness check: 200 when the database is reachable, otherwise 503.', ok: '200  { "status": "ok", "database": "reachable" }', err: ['503 database_unavailable (retryable)'] },
  { m: 'GET', p: '/api/earthquakes', who: 'public', what: 'List stored events, newest first.',
    q: ['limit: 1 to 100, default 20', 'offset: 0 or more', 'min_magnitude: 0 to 10', 'source: BMKG or MANUAL', 'occurred_after, occurred_before: ISO 8601 with timezone'],
    ok: `200\n{ "data": [ ${EVENT.replace(/\n/g, '\n  ')} ],\n  "pagination": { "limit": 20, "offset": 0, "total": 1 } }\n\nAn empty database returns "data": [].`, err: ['400 validation_error (bad limit, offset or filter)', '503 database_unavailable'] },
  { m: 'GET', p: '/api/earthquakes/{id}', who: 'public', what: 'One event, including raw_payload (the original BMKG record, keyed by feed name).', ok: '200  the event object plus "raw_payload": { ... }', err: ['404 not_found'] },
  { m: 'POST', p: '/api/earthquakes', who: 'writer', what: 'Create a manual event. It is stored under source MANUAL and labelled as not an official report.',
    req: MANUAL_BODY, notes: BODY_NOTES, ok: '201  the new event, with a Location header', err: ['400 validation_error', '401 unauthorized', '503 writes_disabled (no key configured on the server)'] },
  { m: 'PUT', p: '/api/earthquakes/{id}', who: 'writer', what: 'Replace all editable fields of a manual event. Optional fields you leave out become null.',
    req: MANUAL_BODY, notes: BODY_NOTES, ok: '200  the updated event', err: ['400', '401', '403 imported_record_protected', '404 not_found'] },
  { m: 'PATCH', p: '/api/earthquakes/{id}', who: 'writer', what: 'Change only the fields you send. An empty body is rejected.',
    req: '{ "magnitude": 3.1 }', ok: '200  the updated event', err: ['400', '401', '403 imported_record_protected', '404 not_found'] },
  { m: 'DELETE', p: '/api/earthquakes/{id}', who: 'writer', what: 'Delete a manual event.', ok: '204  empty body', err: ['401', '403 imported_record_protected', '404 not_found'] },
  { m: 'GET', p: '/api/sources', who: 'public', what: 'List data sources.', ok: '200  [ { "id": 1, "code": "BMKG", "name": "...", "base_url": "...", "description": "...", "is_active": true } ]' },
  { m: 'GET', p: '/api/sync-logs', who: 'public', what: 'History of BMKG imports, newest first.', q: ['limit, offset as above', 'status: running, success, partial or failed'],
    ok: '200  { "data": [ { "id": 3, "status": "success", "records_received": 15, "records_created": 4, "records_updated": 0, "records_skipped": 11, "error_summary": null, "request_url": "..." } ], "pagination": { ... } }' },
  { m: 'POST', p: '/api/sync', who: 'admin', what: 'Fetch BMKG feeds and import them. At most one sync per 60 seconds.',
    req: '{ "feeds": ["gempaterkini", "gempadirasakan", "autogempa"] }   // optional, default is all three',
    ok: '200  one sync-log object per feed. A BMKG outage still returns 200 with "status": "failed", so check each status.', err: ['400 unknown feed', '401 unauthorized', '429 sync_throttled (see Retry-After)', '503 database_unavailable'] },
  { m: 'GET', p: '/api/admin/whoami', who: 'admin', what: 'Checks the admin token. Does not use the database, so it works during an outage.', ok: '200  { "role": "admin" }', err: ['401', '503 admin_disabled'] },
  { m: 'POST', p: '/api/admin/session', who: 'admin', what: 'Dashboard login. Verifies the token and sets a signed, HttpOnly page cookie that unlocks the dashboard page. Failed attempts are rate limited.',
    ok: '200  { "role": "admin", "dashboard_url": "/dashboard/dashboard-<id>.html", "expires_in": 28800 }', err: ['401 unauthorized', '429 login_throttled (see Retry-After)', '503 admin_disabled'] },
  { m: 'DELETE', p: '/api/admin/session', who: 'public', what: 'Dashboard sign-out. Clears the page cookie.', ok: '204  empty body' },
  { m: 'GET', p: '/api/admin/overview', who: 'admin', what: 'Counts, database size against the free-tier quota, last sync and retention settings. Used by the dashboard.', ok: '200  { "counts": {...}, "storage": {...}, "last_sync": {...}, "retention": {...} }', err: ['401', '503'] },
  { m: 'POST', p: '/api/admin/maintenance/prune', who: 'admin', what: 'Remove old logs, audit rows and raw payloads. Preview by default.',
    req: '{ "dry_run": true }   // send false to actually delete', ok: '200  { "dry_run": true, "steps": [ { "rule": "...", "matched": 0, "changed": 0 } ] }', err: ['401', '503'] },
];
