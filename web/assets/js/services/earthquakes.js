/* Data access for the public pages: status check, recent events, and the on-device copy used during outages. */
import { api } from '../core/http.js';
import { toQuery } from '../core/sanitize.js';
import { local } from '../core/store.js';

export const WINDOW_HOURS = 48;
const CACHE_KEY = 'events-v1';

/** Never throws: an unreachable API is reported as a state so the UI can explain it. */
export async function checkStatus() {
  try { return await api('/api/status', { retries: 0, timeoutMs: 6000, fresh: true }); }
  catch { return { api: 'unreachable', database: 'unreachable' }; }
}

export async function fetchRecent(hours = WINDOW_HOURS) {
  const since = new Date(Date.now() - hours * 3600e3).toISOString();
  const data = await api('/api/earthquakes' + toQuery({ limit: 100, occurred_after: since }), { fresh: true });
  local.set(CACHE_KEY, { events: data.data, savedAt: new Date().toISOString() });
  return data.data;
}

export function loadCached() {
  const saved = local.get(CACHE_KEY);
  return saved && Array.isArray(saved.events) ? saved : null;
}

export async function fetchLastSync() {
  try { return (await api('/api/sync-logs?limit=1', { retries: 0 })).data[0] || null; } catch { return undefined; }
}
