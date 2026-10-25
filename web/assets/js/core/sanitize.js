/* Input sanitising. Everything a person can type, and everything read from the URL or storage, passes through here
   before it is used. API data is a separate matter: it is never parsed as HTML (see dom.js, textContent only). */

// C0/C1 control characters (tab and newline excluded), zero-width and bidirectional override characters.
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/g;

/** Plain text: normalised, control characters removed, whitespace collapsed, length capped (by characters). */
export function cleanText(value, { max = 200, multiline = false } = {}) {
  let s = String(value ?? '').normalize('NFC').replace(CONTROL, '');
  s = multiline ? s.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n') : s.replace(/\s+/g, ' ');
  return [...s.trim()].slice(0, max).join('');
}

/** Secrets: keep only token-safe characters. `ok` says whether the result has a plausible length. */
export function cleanToken(value, { min = 24, max = 256 } = {}) {
  const v = String(value ?? '').replace(/[^A-Za-z0-9._~+/=-]/g, '').slice(0, max);
  return { value: v, ok: v.length >= min };
}

export function cleanNumber(value, { min = -Infinity, max = Infinity, fallback = null, decimals = null } = {}) {
  const raw = typeof value === 'string' ? value.trim().replace(',', '.') : value;
  if (raw === '' || raw == null) return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  const clamped = Math.min(max, Math.max(min, n));
  return decimals == null ? clamped : Number(clamped.toFixed(decimals));
}
export const cleanInt = (value, opts = {}) => {
  const n = cleanNumber(value, opts);
  return n == null ? n : Math.trunc(n);
};

export const cleanChoice = (value, allowed, fallback) => (allowed.includes(value) ? value : fallback);

/** Only relative paths into our own API are ever fetched: no scheme, no host, no traversal, no control characters. */
export function safeApiPath(path) {
  const p = String(path ?? '');
  if (!/^\/(api\/|health)[A-Za-z0-9\-._~!$&'()*+,;=:@%/?]*$/.test(p)) return null;
  if (p.includes('..') || p.includes('//') || p.includes('\\')) return null;
  return p;
}

/** href/src values: https/http absolute URLs or same-site paths only (blocks javascript:, data:, vbscript:). */
export function safeUrl(value) {
  const v = String(value ?? '').trim();
  if (/^\/(?!\/)[^\s\\]*$/.test(v)) return v;
  try {
    const u = new URL(v);
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.href : null;
  } catch { return null; }
}

/** Query string from a plain object; empty/null values are dropped and everything is percent-encoded. */
export function toQuery(params) {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== null && v !== undefined && v !== '') q.set(k, String(v));
  const s = q.toString();
  return s ? '?' + s : '';
}
