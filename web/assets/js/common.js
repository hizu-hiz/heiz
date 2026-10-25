/* Shared helpers: safe DOM builder, API client with retry/backoff, stale-data cache, formatters.
   API data (including BMKG text) is untrusted: it is only ever inserted with textContent/createTextNode. */
(() => {
  'use strict';

  const el = (tag, attrs, ...kids) => {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k === 'class') n.className = v;
      else if (k === 'text') n.textContent = v;
      else if (k.startsWith('on') && typeof v === 'function') n.addEventListener(k.slice(2), v);
      else n.setAttribute(k, v === true ? '' : String(v));
    }
    for (const kid of kids.flat()) {
      if (kid == null || kid === false) continue;
      n.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
    }
    return n;
  };

  class ApiError extends Error {
    constructor(status, code, message, retryable, retryAfter) {
      super(message);
      Object.assign(this, { status, code, retryable: !!retryable, retryAfter: retryAfter || 0 });
    }
  }
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  /** JSON request. GETs retry twice (1 s, 2 s) on network errors and retryable 503s; writes never auto-retry. */
  async function api(path, { method = 'GET', body, token, retries, timeoutMs = 12000 } = {}) {
    const maxRetries = retries ?? (method === 'GET' ? 2 : 0);
    for (let attempt = 0; ; attempt++) {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), timeoutMs);
      try {
        const headers = { Accept: 'application/json' };
        if (body !== undefined) headers['Content-Type'] = 'application/json';
        if (token) headers.Authorization = 'Bearer ' + token;
        const res = await fetch(path, {
          method, headers, signal: ctrl.signal, cache: 'no-store',
          body: body === undefined ? undefined : JSON.stringify(body),
        });
        clearTimeout(timer);
        if (res.status === 204) return null;
        let data = null;
        try { data = await res.json(); } catch { /* non-JSON error body */ }
        if (res.ok) return data;
        const e = (data && data.error) || {};
        const err = new ApiError(res.status, e.code || 'http_error', e.message || res.statusText,
          e.retryable === true, Number(res.headers.get('Retry-After')) || e.retry_after_seconds || 0);
        if (err.retryable && attempt < maxRetries) { await sleep(1000 * 2 ** attempt); continue; }
        throw err;
      } catch (e) {
        clearTimeout(timer);
        if (e instanceof ApiError) throw e;
        const err = new ApiError(0, 'network_error',
          e && e.name === 'AbortError' ? 'The request timed out.' : 'Could not reach the Heiz API.', true, 0);
        if (attempt < maxRetries) { await sleep(1000 * 2 ** attempt); continue; }
        throw err;
      }
    }
  }

  // localStorage can be missing or throw (private mode): every access is guarded.
  const cache = {
    get(key) { try { return JSON.parse(localStorage.getItem('heiz:' + key)); } catch { return null; } },
    set(key, value) { try { localStorage.setItem('heiz:' + key, JSON.stringify(value)); } catch { /* ignore */ } },
  };

  const WIB = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Jakarta', day: '2-digit', month: 'short',
    hour: '2-digit', minute: '2-digit', hour12: false });
  const wib = (d) => (d ? WIB.format(new Date(d)).replace(',', '') + ' WIB' : 'unknown time');
  function ago(d, now = Date.now()) {
    if (!d) return 'unknown';
    const s = Math.max(0, Math.round((now - new Date(d).getTime()) / 1000));
    if (s < 90) return 'just now';
    if (s < 5400) return Math.round(s / 60) + ' min ago';
    if (s < 129600) return Math.round(s / 3600) + ' h ago';
    return Math.round(s / 86400) + ' d ago';
  }
  const bytes = (n) => {
    if (n == null) return 'n/a';
    const u = ['B', 'KB', 'MB', 'GB']; let i = 0; let v = n;
    while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
    return (i ? v.toFixed(v < 10 ? 1 : 0) : v) + ' ' + u[i];
  };

  async function copyText(text) {
    try { await navigator.clipboard.writeText(text); return true; } catch {
      const t = el('textarea', { 'aria-hidden': 'true' }); t.value = text; document.body.append(t); t.select();
      let ok = false; try { ok = document.execCommand('copy'); } catch { /* ignore */ } t.remove(); return ok;
    }
  }

  window.Heiz = { el, api, ApiError, cache, wib, ago, bytes, copyText, sleep };
})();
