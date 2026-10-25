/* One place that fetches dashboard data. Each dataset is fetched at most once per cycle, however many widgets use it.
   If the database is down, DB-backed datasets are skipped (not retried in a loop) and the last good values are kept. */
import { api } from '../core/http.js';
import { toQuery } from '../core/sanitize.js';
import { checkStatus } from '../services/earthquakes.js';

export function createHub(admin) {
  const loaders = {
    overview: () => admin('/api/admin/overview'),
    logs: () => api('/api/sync-logs?limit=10', { fresh: true }),
    events: () => api('/api/earthquakes?limit=10', { fresh: true }),
    recent: () => api('/api/earthquakes' + toQuery({ limit: 100, occurred_after: new Date(Date.now() - 48 * 3600e3).toISOString() }), { fresh: true }),
  };
  const lastGood = {}; let lastGoodAt = null;

  return {
    get lastGoodAt() { return lastGoodAt; },
    async load(needs) {
      const status = await checkStatus();
      const result = { status, errors: {}, stale: status.database !== 'ok' };
      const wanted = [...new Set(needs)].filter((n) => n in loaders);
      if (status.database === 'ok') {
        const settled = await Promise.allSettled(wanted.map((n) => loaders[n]()));
        settled.forEach((s, i) => {
          if (s.status === 'fulfilled') { lastGood[wanted[i]] = s.value; lastGoodAt = new Date().toISOString(); }
          else result.errors[wanted[i]] = s.reason;
        });
      }
      for (const n of wanted) result[n] = lastGood[n];       // fresh when available, otherwise the last good copy
      return result;
    },
  };
}
