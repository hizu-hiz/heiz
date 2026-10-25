import { ApiError } from '../core/http.js';

export const statusKind = (s) => (s === 'success' ? 'ok' : s === 'running' ? 'idle' : s === 'partial' ? 'warn' : 'bad');

export function explain(e) {
  if (!(e instanceof ApiError)) return 'Something went wrong.';
  if (e.code === 'sync_throttled') return `A sync ran in the last minute. Try again in ${e.retryAfter || 60} s.`;
  if (e.code === 'database_unavailable') return 'The database is not responding. Nothing was changed. Try again shortly.';
  if (e.code === 'client_rate_limited') return `Too many requests from this page. Wait about ${e.retryAfter || 30} s.`;
  return `${e.status || ''} ${e.code || ''}: ${e.message}`.trim();
}
