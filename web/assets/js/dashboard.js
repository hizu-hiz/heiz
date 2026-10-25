/* Developer dashboard. Data is fetched only with the admin bearer token, kept in sessionStorage. */
(() => {
  'use strict';
  const { el, api, ApiError, wib, ago, bytes } = window.Heiz;
  const $ = (id) => document.getElementById(id);
  const TOKEN_KEY = 'heiz:admin-token';
  const REFRESH_S = 15;

  let token = null; let timer = null; let busy = false; let lastGood = null;
  const store = {
    get() { try { return sessionStorage.getItem(TOKEN_KEY); } catch { return null; } },
    set(v) { try { sessionStorage.setItem(TOKEN_KEY, v); } catch { /* memory only */ } },
    del() { try { sessionStorage.removeItem(TOKEN_KEY); } catch { /* ignore */ } },
  };

  const chip = (text, kind) => el('span', { class: 'chip ' + kind, text });
  const statusKind = (s) => (s === 'success' ? 'ok' : s === 'running' ? 'idle' : s === 'partial' ? 'warn' : 'bad');
  function table(heads, rows, numCols = []) {
    return el('table', { class: 't' },
      el('thead', {}, el('tr', {}, heads.map((h) => el('th', { scope: 'col', text: h })))),
      el('tbody', {}, rows.map((r) => el('tr', {}, r.map((c, i) => el('td', { class: numCols.includes(i) ? 'num' : null }, c))))));
  }
  const kv = (target, pairs) => {
    target.replaceChildren();
    for (const [k, v, big] of pairs) target.append(el('dt', { text: k }), el('dd', { class: big ? 'big' : null }, v));
  };
  function setBanner(text, bad) { const b = $('banner'); b.hidden = !text; b.textContent = text || ''; b.classList.toggle('bad', !!bad); }

  // ---------------------------------------------------------------- lock / unlock
  function lock(message) {
    token = null; store.del(); clearTimeout(timer);
    $('panel').hidden = true; $('gate').hidden = false; $('lock').hidden = true; $('who').textContent = '';
    $('token').value = '';
    const m = $('gate-msg'); m.hidden = !message; m.textContent = message || '';
  }
  async function unlock(candidate) {
    const m = $('gate-msg'); m.hidden = true;
    try {
      await api('/api/admin/whoami', { token: candidate, retries: 1 });
    } catch (e) {
      if (e.code === 'admin_disabled') return lock('The server has no admin token configured. Set HEIZ_ADMIN_TOKEN (24 characters or more) and redeploy.');
      if (e.status === 401) return lock('That token was not accepted.');
      return lock(e.message);
    }
    token = candidate; store.set(candidate);
    $('gate').hidden = true; $('panel').hidden = false; $('lock').hidden = false; $('who').textContent = 'Signed in as admin';
    refresh();
  }

  // ---------------------------------------------------------------- loading
  async function admin(path, opts = {}) {
    try { return await api(path, { token, ...opts }); }
    catch (e) { if (e instanceof ApiError && e.status === 401) { lock('The token was rejected. Enter it again.'); } throw e; }
  }

  function schedule(seconds) { clearTimeout(timer); timer = setTimeout(refresh, seconds * 1000); }

  async function refresh() {
    if (busy || !token) return; busy = true;
    try {
      let status;
      try { status = await api('/api/status', { retries: 1 }); } catch { status = { api: 'unreachable', database: 'unknown' }; }
      renderService(status, null);
      if (status.database !== 'ok') {
        const reason = status.api === 'unreachable' ? 'The Heiz API is not reachable.'
          : status.database === 'not_configured' ? 'DATABASE_URL is not configured on the server.' : 'The database is not responding.';
        setBanner(`${reason} Values below are from the last successful refresh${lastGood ? ' at ' + wib(lastGood.at) : ' (none yet)'}. Checking again in ${Math.max(30, status.retry_after_seconds || 0)} s.`, status.database === 'not_configured');
        document.querySelectorAll('#records, #storage').forEach((n) => n.classList.add('stale'));
        schedule(Math.max(30, status.retry_after_seconds || 0));
        return;
      }
      setBanner('');
      document.querySelectorAll('#records, #storage').forEach((n) => n.classList.remove('stale'));
      const [ov, logs, evs] = await Promise.allSettled([
        admin('/api/admin/overview'), api('/api/sync-logs?limit=10'), api('/api/earthquakes?limit=10')]);
      if (ov.status === 'fulfilled') { lastGood = { at: new Date().toISOString(), ov: ov.value }; renderOverview(ov.value); renderService(status, ov.value); }
      else if (ov.reason && ov.reason.code === 'database_unavailable') setBanner('The database stopped responding during the refresh. Retrying shortly.');
      if (logs.status === 'fulfilled') renderLogs(logs.value.data);
      if (evs.status === 'fulfilled') renderEvents(evs.value.data);
      schedule(REFRESH_S);
    } finally { busy = false; }
  }

  // ---------------------------------------------------------------- renderers
  function renderService(status, ov) {
    const dbKind = status.database === 'ok' ? 'ok' : status.database === 'unavailable' ? 'warn' : 'bad';
    const last = ov && ov.last_sync;
    kv($('service'), [
      ['API', chip(status.api === 'ok' ? 'up' : 'unreachable', status.api === 'ok' ? 'ok' : 'bad')],
      ['Database', chip(status.database === 'ok' ? 'reachable' : status.database, dbKind)],
      ['DB latency', status.latency_ms != null ? status.latency_ms + ' ms' : 'n/a'],
      ['Last sync', last ? el('span', {}, chip(last.status, statusKind(last.status)), ' ' + ago(last.finished_at || last.started_at)) : 'none yet'],
      ['Checked', wib(status.checked_at)],
    ]);
  }

  function renderOverview(ov) {
    const c = ov.counts;
    kv($('records'), [['Earthquake events', c.earthquake_events, true], ['of which manual', c.manual_events], ['Audit rows (event_updates)', c.event_updates], ['Sync logs', c.sync_logs]]);
    const s = ov.storage; const box = $('storage'); box.replaceChildren();
    if (!s.supported) { box.append(el('p', { class: 'muted', text: 'Size reporting needs PostgreSQL. Not available on this server.' })); }
    else {
      const frac = s.used_fraction ?? 0; const kind = frac > 0.9 ? 'bad' : frac > 0.7 ? 'warn' : '';
      box.append(
        el('p', {}, el('strong', { text: bytes(s.database_bytes) }), ` of ${bytes(s.quota_bytes)} (${(frac * 100).toFixed(1)}%)`),
        el('progress', { class: 'meter ' + kind, max: 1, value: Math.min(1, frac), 'aria-label': 'Database size against quota' }),
        el('p', { class: 'muted small', text: 'Database size includes Supabase system schemas. Confirm the quota on your Supabase plan page.' }),
        table(['Table', 'Size'], s.tables.slice(0, 7).map((t) => [t.name, bytes(t.bytes)]), [1]));
      if (frac > 0.7) box.append(el('p', { class: 'msg', text: 'Above 70% of the quota. Run a cleanup preview.' }));
    }
    const r = ov.retention;
    $('retention-text').textContent = `Rules: raw payloads older than ${r.raw_payload_days} days are cleared, audit rows older than ${r.event_updates_days} days, sync logs older than ${r.sync_logs_days} days and imported events older than ${r.events_days} days are deleted. Manual events are never removed. Each rule handles at most ${r.batch_size} rows per run. A value of 0 turns a rule off.`;
  }

  function renderLogs(rows) {
    $('logs').replaceChildren(rows.length ? table(['When', 'Status', 'Received', 'New', 'Updated', 'Skipped', 'Feed / note'],
      rows.map((r) => [wib(r.started_at), chip(r.status, statusKind(r.status)), r.records_received, r.records_created, r.records_updated, r.records_skipped,
        (r.request_url ? r.request_url.split('/').pop() : '') + (r.error_summary ? ' | ' + r.error_summary : '')]), [2, 3, 4, 5])
      : el('p', { class: 'muted', text: 'No syncs yet. Run one above.' }));
  }
  function renderEvents(rows) {
    $('events').replaceChildren(rows.length ? table(['ID', 'Source', 'M', 'Location', 'Occurred'],
      rows.map((e) => [e.id, e.source_code, e.magnitude == null ? '-' : Number(e.magnitude).toFixed(1), e.location_description, wib(e.occurred_at)]), [0, 2])
      : el('p', { class: 'muted', text: 'No events stored.' }));
  }

  // ---------------------------------------------------------------- actions
  function explain(e) {
    if (e.code === 'sync_throttled') return `A sync ran in the last minute. Try again in ${e.retryAfter || 60} s.`;
    if (e.code === 'database_unavailable') return 'The database is not responding. Nothing was changed. Try again shortly.';
    return `${e.status || ''} ${e.code || ''}: ${e.message}`.trim();
  }

  $('sync-form').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const feeds = [...document.querySelectorAll('input[name=feed]:checked')].map((i) => i.value);
    const out = $('sync-result'); const btn = $('sync-go');
    if (!feeds.length) { out.replaceChildren(el('p', { class: 'msg', text: 'Select at least one feed.' })); return; }
    btn.disabled = true; out.replaceChildren(el('p', { class: 'muted', text: 'Syncing...' }));
    try {
      const logs = await admin('/api/sync', { method: 'POST', body: { feeds }, timeoutMs: 60000 });
      out.replaceChildren(table(['Feed', 'Status', 'Received', 'New', 'Updated', 'Skipped', 'Note'],
        logs.map((l) => [l.request_url.split('/').pop(), chip(l.status, statusKind(l.status)), l.records_received, l.records_created, l.records_updated, l.records_skipped, l.error_summary || '']), [2, 3, 4, 5]));
      refresh();
    } catch (e) { if (e.status !== 401) out.replaceChildren(el('p', { class: 'msg', text: explain(e) })); }
    finally { btn.disabled = false; }
  });

  async function prune(dry) {
    const out = $('prune-result');
    if (!dry && !window.confirm('Delete old records now? This cannot be undone. Run a preview first if you have not.')) return;
    $('prune-preview').disabled = $('prune-run').disabled = true;
    out.replaceChildren(el('p', { class: 'muted', text: dry ? 'Previewing...' : 'Cleaning up...' }));
    try {
      const r = await admin('/api/admin/maintenance/prune', { method: 'POST', body: { dry_run: dry }, timeoutMs: 60000 });
      out.replaceChildren(
        el('p', { text: dry ? 'Preview only. Nothing was changed.' : 'Cleanup finished.' }),
        table(['Rule', 'Matching', dry ? 'Would change' : 'Changed', 'More waiting'],
          r.steps.map((s) => [s.rule.replaceAll('_', ' '), s.enabled ? s.matched : 'off', s.enabled ? (dry ? Math.min(s.matched, r.batch_size) : s.changed) : '-', s.more_pending ? 'yes, run again' : 'no']), [1, 2]));
      if (!dry) refresh();
    } catch (e) { if (e.status !== 401) out.replaceChildren(el('p', { class: 'msg', text: explain(e) })); }
    finally { $('prune-preview').disabled = $('prune-run').disabled = false; }
  }
  $('prune-preview').addEventListener('click', () => prune(true));
  $('prune-run').addEventListener('click', () => prune(false));

  $('gate-form').addEventListener('submit', (ev) => { ev.preventDefault(); unlock($('token').value.trim()); });
  $('lock').addEventListener('click', () => lock('Locked.'));
  document.addEventListener('visibilitychange', () => { if (!document.hidden && token && !busy) { clearTimeout(timer); refresh(); } });

  const saved = store.get();
  if (saved) unlock(saved);
})();
