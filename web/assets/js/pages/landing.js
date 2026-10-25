/* Landing page: splash check -> map, feed and facts, kept fresh by polling, degrading gracefully when the DB is down. */
import { mountApiExplorer } from '../components/api-explorer.js';
import { mountDecor } from '../components/decor.js';
import { renderEventFeed } from '../components/event-feed.js';
import { renderFacts } from '../components/facts.js';
import { renderLegend } from '../components/legend.js';
import { mountComponents } from '../components/mount.js';
import { createSplash } from '../components/splash.js';
import { createNotice, createToasts, setPill } from '../components/ui.js';
import { $ } from '../core/dom.js';
import { ago, magText, wib } from '../core/format.js';
import { debounce, guardClick, singleFlight } from '../core/timing.js';
import { QuakeMap } from '../map/quake-map.js';
import { boot } from '../services/boot.js';
import { checkStatus, fetchLastSync, fetchRecent, loadCached } from '../services/earthquakes.js';

const POLL_SECONDS = 60;
document.documentElement.classList.add('js-ready');
$('#boot-fallback')?.setAttribute('hidden', '');
mountComponents(); mountDecor();

const splash = createSplash($('#splash'));
const state = { events: [] };
let qmap; let pollTimer = null;
const notice = createNotice($('#notice')); const toasts = createToasts($('#toasts'));
const pill = $('#status'); const syncPill = $('#sync');

function render() {
  qmap.setEvents(state.events);
  renderEventFeed($('#feed'), state.events, { onSelect: (id) => qmap.focus(id) });
  renderFacts($('#facts'), state.events);
}

async function showLastSync() {
  const s = await fetchLastSync();
  if (s === undefined) return;
  if (!s) { setPill(syncPill, 'warn', 'BMKG has not been synced yet.'); return; }
  setPill(syncPill, s.status === 'success' ? 'ok' : s.status === 'running' ? 'idle' : 'warn', `Last BMKG sync ${ago(s.finished_at || s.started_at)}: ${s.status}`);
}

function schedule(seconds) { clearTimeout(pollTimer); pollTimer = setTimeout(refresh, seconds * 1000); }

function applyLive(events) {
  state.events = events; notice.hide();
  setPill(pill, 'ok', 'Service and database are up');
  render(); showLastSync(); schedule(POLL_SECONDS);
}

function applyDegraded(result) {
  const { status } = result;
  const dbState = status.database; let reason; let kind = 'warn'; let label;
  if (dbState === 'not_configured') { reason = 'This server has no database configured.'; label = 'Database not configured'; kind = 'bad'; }
  else if (dbState === 'unavailable') { reason = 'The database is not responding.'; label = 'Database not responding'; }
  else if (status.api === 'unreachable') { reason = 'Could not reach the Heiz API.'; label = 'API not reachable'; kind = 'bad'; }
  else { reason = 'Recent earthquakes could not be loaded.'; label = 'Data not available'; }
  setPill(pill, kind, label); setPill(syncPill, 'idle', '');
  const saved = result.mode === 'cached' ? result : loadCached();
  if (saved && saved.events?.length !== undefined) {
    state.events = saved.events; render();
    reason += ` Showing data saved on this device at ${wib(saved.savedAt)}.`;
  } else {
    state.events = []; render(); reason += ' Nothing is saved on this device yet.';
  }
  if (dbState === 'not_configured') { notice.show(reason, 'bad'); return; }
  notice.countdown(Math.max(30, status.retry_after_seconds || 0), reason, refresh, kind === 'bad' ? 'bad' : 'warn');
}

const refresh = singleFlight(async () => {
  clearTimeout(pollTimer); notice.stop();
  const status = await checkStatus();
  if (status.database !== 'ok') { applyDegraded({ mode: 'cached', status, ...(loadCached() || {}) }); return; }
  try { applyLive(await fetchRecent()); } catch { applyDegraded({ mode: 'offline', status: { ...status, database: 'unavailable' } }); }
});

// ---------------------------------------------------------------- replay
let replaying = false;
function endReplay() { replaying = false; qmap.stopReplay(); $('#replay').textContent = 'Replay last 48 hours'; $('#replaybar').hidden = true; }
const toggleReplay = debounce(() => {
  if (replaying) { endReplay(); return; }
  const started = qmap.replay(state.events, {
    onTick: ({ progress, time }) => { $('#replay-progress').value = progress; $('#replay-clock').textContent = wib(time); },
    onEnd: () => setTimeout(() => { if (replaying) endReplay(); }, 2500) });
  if (!started) { notice.show('There are no located earthquakes to replay yet.', 'warn'); return; }
  replaying = true; $('#replay').textContent = 'Stop replay'; $('#replaybar').hidden = false;
}, 300, { leading: true });

// ---------------------------------------------------------------- start
async function start() {
  const result = await boot(splash);
  await splash.dismiss();
  qmap = new QuakeMap($('#map'), { onNew: (e) => toasts.push(`New: M ${magText(e.magnitude)} ${e.location_description}`), padLeft: window.innerWidth > 860 ? 410 : 10 });
  renderLegend($('#legend-list'));
  $('#replay').addEventListener('click', toggleReplay);
  guardClick($('#refresh'), () => refresh(), { cooldownMs: 1500 });
  document.addEventListener('visibilitychange', debounce(() => { if (!document.hidden) refresh(); }, 600));
  mountApiExplorer($('#try'));
  qmap.invalidate();
  if (result.mode === 'live') applyLive(result.events); else applyDegraded(result);
}
start();
