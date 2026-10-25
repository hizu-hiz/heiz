/* Landing page: loads events, keeps them fresh, and degrades gracefully when the database is down. */
(() => {
  'use strict';
  const { el, api, cache, wib, ago, copyText } = window.Heiz;
  const { DEPTH_BANDS, UNKNOWN_DEPTH, band } = window.HeizMapKit;
  const $ = (id) => document.getElementById(id);

  const POLL_MS = 60_000;
  const WINDOW_H = 48;
  const CACHE_KEY = 'events-v1';

  let events = [];
  let timer = null; let countdown = null; let loading = false;

  const qmap = new window.QuakeMap('map', { onNew: (e) => toast(e) });

  // ---------------------------------------------------------------- legend
  for (const b of [...DEPTH_BANDS, UNKNOWN_DEPTH]) {
    const dot = el('i'); dot.style.background = b.color;
    $('legend-list').append(el('li', {}, dot, b.label));
  }

  // ---------------------------------------------------------------- small UI helpers
  function setStatus(state, text) { const n = $('status'); n.dataset.state = state; n.textContent = text; }
  function setNotice(text, bad) {
    const n = $('notice');
    n.hidden = !text; n.textContent = text || ''; n.classList.toggle('bad', !!bad);
  }
  function toast(e) {
    const t = el('div', { class: 'toast', text: `New: M ${e.magnitude == null ? '?' : Number(e.magnitude).toFixed(1)} ${e.location_description}` });
    $('toasts').append(t);
    setTimeout(() => t.remove(), 9000);
  }
  const depthKey = (e) => (e.depth_km == null ? 'unknown' : band(Number(e.depth_km)).key);

  function renderFeed(unreachable) {
    const list = $('feed'); list.replaceChildren();
    if (!events.length) {
      list.append(el('li', { class: 'empty', text: unreachable
        ? 'No earthquakes to show while the service is unreachable.'
        : 'No earthquakes stored yet. They appear after the first sync from BMKG.' }));
      return;
    }
    for (const e of events.slice(0, 12)) {
      const m = e.magnitude == null ? '?' : Number(e.magnitude).toFixed(1);
      list.append(el('li', {}, el('button', { class: 'ev', type: 'button', 'data-depth': depthKey(e),
        'aria-label': `Magnitude ${m}, ${e.location_description}, ${ago(e.occurred_at)}. Show on map.`, onclick: () => qmap.focus(e.id) },
        el('span', { class: 'mag' }, m),
        el('span', { class: 'where', text: e.location_description }),
        el('span', { class: 'when', text: ago(e.occurred_at) }))));
    }
  }

  function renderFacts() {
    const now = Date.now();
    const within = (h) => events.filter((e) => e.occurred_at && now - new Date(e.occurred_at).getTime() <= h * 3600e3);
    const mags = within(WINDOW_H).map((e) => e.magnitude).filter((m) => m != null).map(Number);
    $('f-24h').textContent = within(24).length;
    $('f-m5').textContent = mags.filter((m) => m >= 5).length;
    $('f-max').textContent = mags.length ? Math.max(...mags).toFixed(1) : '-';
  }

  function render(stale) {
    qmap.setEvents(events);
    renderFeed(); renderFacts();
    if (!stale) setNotice('');
  }

  // ---------------------------------------------------------------- data loading
  function scheduleNext(seconds, reason) {
    clearTimeout(timer); clearInterval(countdown);
    if (!reason) { timer = setTimeout(() => load(), seconds * 1000); return; }
    let left = seconds;
    const tick = () => {
      const n = $('notice');
      n.textContent = `${reason} Retrying in ${left} s.`;
      if (left-- <= 0) { clearInterval(countdown); load(); }
    };
    tick(); countdown = setInterval(tick, 1000);
  }

  function fromCache() {
    const saved = cache.get(CACHE_KEY);
    if (saved && Array.isArray(saved.events)) { events = saved.events; return saved; }
    return null;
  }

  async function load() {
    if (loading) return; loading = true;
    clearInterval(countdown);
    $('refresh').disabled = true;
    try {
      let status;
      try { status = await api('/api/status', { retries: 1 }); }
      catch { status = { database: 'unreachable' }; }

      if (status.database === 'ok') {
        const since = new Date(Date.now() - WINDOW_H * 3600e3).toISOString();
        const data = await api(`/api/earthquakes?limit=100&occurred_after=${encodeURIComponent(since)}`);
        events = data.data;
        cache.set(CACHE_KEY, { events, savedAt: new Date().toISOString() });
        setStatus('ok', 'Service and database are up');
        render(false);
        loadSync();
        scheduleNext(POLL_MS / 1000);
      } else {
        throw Object.assign(new Error(status.database), { dbState: status.database, retryAfter: status.retry_after_seconds });
      }
    } catch (e) {
      handleFailure(e);
    } finally {
      loading = false; $('refresh').disabled = false;
    }
  }

  function handleFailure(e) {
    const saved = fromCache();
    const wait = Math.max(30, e.retryAfter || 0);
    let reason; let state = 'bad';
    if (e.dbState === 'not_configured') { reason = 'This server has no database configured.'; }
    else if (e.dbState === 'unavailable' || e.code === 'database_unavailable') { reason = 'The database is not responding.'; state = 'warn'; }
    else { reason = 'Could not reach the Heiz API.'; }
    setStatus(state, e.dbState === 'not_configured' ? 'Database not configured' : e.dbState === 'unavailable' || e.code === 'database_unavailable' ? 'Database not responding' : 'API not reachable');
    $('sync').textContent = '';
    if (saved) {
      reason += ` Showing data saved on this device at ${wib(saved.savedAt)}.`;
      render(true);
    } else {
      events = []; renderFeed(true); renderFacts();
      reason += ' Nothing is saved on this device yet.';
    }
    $('notice').classList.toggle('bad', state === 'bad');
    $('notice').hidden = false;
    if (e.dbState === 'not_configured') { $('notice').textContent = reason; return; }
    scheduleNext(wait, reason);
  }

  async function loadSync() {
    try {
      const r = await api('/api/sync-logs?limit=1', { retries: 0 });
      const s = r.data[0]; const p = $('sync');
      if (!s) { p.dataset.state = 'warn'; p.textContent = 'BMKG has not been synced yet.'; return; }
      const when = s.finished_at || s.started_at;
      p.dataset.state = s.status === 'success' ? 'ok' : s.status === 'running' ? 'idle' : 'warn';
      p.textContent = `Last BMKG sync ${ago(when)}: ${s.status}`;
    } catch { /* the main status line already reports problems */ }
  }

  // ---------------------------------------------------------------- replay
  let replaying = false;
  function endReplay() {
    replaying = false; qmap.stopReplay();
    $('replay').textContent = 'Replay last 48 hours'; $('replaybar').hidden = true;
  }
  $('replay').addEventListener('click', () => {
    if (replaying) { endReplay(); return; }
    const started = qmap.replay(events, {
      onTick: ({ progress, time }) => { $('replay-progress').value = progress; $('replay-clock').textContent = wib(time); },
      onEnd: () => setTimeout(() => { if (replaying) endReplay(); }, 2500),
    });
    if (!started) { setNotice('There are no located earthquakes to replay yet.', false); return; }
    replaying = true; $('replay').textContent = 'Stop replay'; $('replaybar').hidden = false;
  });
  $('refresh').addEventListener('click', () => { clearTimeout(timer); load(); });
  document.addEventListener('visibilitychange', () => { if (!document.hidden && !loading) { clearTimeout(timer); load(); } });

  // ---------------------------------------------------------------- API examples
  const origin = location.origin;
  const EXAMPLES = [
    { label: 'Latest 3 earthquakes', path: '/api/earthquakes?limit=3' },
    { label: 'Magnitude 5 or more', path: '/api/earthquakes?min_magnitude=5&limit=5' },
    { label: 'Is the database up?', path: '/api/status' },
  ];
  for (const ex of EXAMPLES) {
    const cmd = `curl "${origin}${ex.path}"`;
    $('examples').append(el('li', {}, el('div', { class: 'cmd' },
      el('div', {}, el('span', { class: 'label', text: ex.label }), el('code', { text: cmd })),
      el('div', { class: 'row' },
        el('button', { class: 'btn', type: 'button', onclick: (ev) => run(ex.path, ev.currentTarget) }, 'Run'),
        ' ',
        el('button', { class: 'btn', type: 'button', onclick: async (ev) => {
          const b = ev.currentTarget; b.textContent = (await copyText(cmd)) ? 'Copied' : 'Copy failed';
          setTimeout(() => { b.textContent = 'Copy'; }, 1600);
        } }, 'Copy')))));
  }
  async function run(path, btn) {
    const out = $('out'); btn.disabled = true; out.textContent = `GET ${path}\n\nLoading...`;
    try {
      const data = await api(path, { retries: 0 });
      const text = JSON.stringify(data, null, 2);
      out.textContent = `GET ${path}\n200 OK\n\n` + (text.length > 4000 ? text.slice(0, 4000) + '\n... (shortened)' : text);
    } catch (e) {
      out.textContent = `GET ${path}\n${e.status || 'No response'} ${e.code || ''}\n\n${e.message}`
        + (e.retryable ? '\n\nThis error is temporary. Try again in a moment.' : '');
    } finally { btn.disabled = false; }
  }

  // ---------------------------------------------------------------- start
  fromCache(); if (events.length) { renderFeed(); renderFacts(); }
  load();
})();
