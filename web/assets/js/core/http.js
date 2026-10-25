/* API client. Protects both sides:
   - identical GETs in flight share one request, and a repeat within 1.5 s reuses the answer (debounced at the transport);
   - at most 4 requests run at once and there is a per-minute budget, so a stuck loop or an impatient click cannot flood the API;
   - GETs retry with backoff on network errors and retryable 503s; writes never retry automatically;
   - only same-origin /api and /health paths are fetched (see safeApiPath). */
import { safeApiPath } from './sanitize.js';
import { sleep } from './timing.js';

export class ApiError extends Error {
  constructor(status, code, message, retryable, retryAfter) {
    super(message);
    Object.assign(this, { status, code, retryable: !!retryable, retryAfter: retryAfter || 0 });
  }
}

const MAX_PARALLEL = 4;
const BUDGET = { GET: { limit: 90, windowMs: 60_000 }, WRITE: { limit: 12, windowMs: 60_000 } };
const REUSE_MS = 1500;
let running = 0; const waiting = []; const stamps = { GET: [], WRITE: [] };
const inflight = new Map(); const recent = new Map();

async function slot() {
  if (running < MAX_PARALLEL) { running++; return; }
  await new Promise((resolve) => waiting.push(resolve));
  running++;
}
function release() { running--; waiting.shift()?.(); }

function spend(kind) {
  const { limit, windowMs } = BUDGET[kind]; const now = Date.now();
  stamps[kind] = stamps[kind].filter((t) => now - t < windowMs);
  if (stamps[kind].length >= limit) {
    throw new ApiError(0, 'client_rate_limited', 'Too many requests from this page. Wait a moment and try again.', false,
      Math.ceil((windowMs - (now - stamps[kind][0])) / 1000));
  }
  stamps[kind].push(now);
}

async function once(path, { method, body, token, timeoutMs }) {
  const ctrl = new AbortController(); const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const headers = { Accept: 'application/json' };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (token) headers.Authorization = 'Bearer ' + token;
    const res = await fetch(path, { method, headers, signal: ctrl.signal, cache: 'no-store', credentials: 'same-origin',
      body: body === undefined ? undefined : JSON.stringify(body) });
    if (res.status === 204) return null;
    let data = null; try { data = await res.json(); } catch { /* non-JSON error body */ }
    if (res.ok) return data;
    const e = (data && data.error) || {};
    throw new ApiError(res.status, e.code || 'http_error', e.message || res.statusText,
      e.retryable === true, Number(res.headers.get('Retry-After')) || e.retry_after_seconds || 0);
  } catch (err) {
    if (err instanceof ApiError) throw err;
    throw new ApiError(0, 'network_error', err && err.name === 'AbortError' ? 'The request timed out.' : 'Could not reach the Heiz API.', true, 0);
  } finally { clearTimeout(timer); }
}

async function run(path, opts) {
  const retries = opts.retries ?? (opts.method === 'GET' ? 2 : 0);
  for (let attempt = 0; ; attempt++) {
    await slot();
    try {
      return await once(path, opts);
    } catch (err) {
      if (!(err.retryable && attempt < retries)) throw err;   // otherwise fall through to the backoff below
    } finally { release(); }
    await sleep(1000 * 2 ** attempt);
  }
}

export async function api(path, { method = 'GET', body, token, retries, timeoutMs = 12_000, fresh = false } = {}) {
  const safe = safeApiPath(path);
  if (!safe) throw new ApiError(0, 'bad_path', 'That request path is not allowed.', false);
  const opts = { method, body, token, retries, timeoutMs };
  if (method !== 'GET') { spend('WRITE'); return run(safe, opts); }
  const key = `${token ? 'a' : 'p'}|${safe}`;
  if (!fresh) {
    if (inflight.has(key)) return inflight.get(key);
    const hit = recent.get(key);
    if (hit && Date.now() - hit.at < REUSE_MS) return hit.value;
  }
  spend('GET');
  const promise = run(safe, opts).then((value) => {
    recent.set(key, { at: Date.now(), value });
    if (recent.size > 50) recent.delete(recent.keys().next().value);
    return value;
  })
    .finally(() => { inflight.delete(key); });
  inflight.set(key, promise);
  return promise;
}
