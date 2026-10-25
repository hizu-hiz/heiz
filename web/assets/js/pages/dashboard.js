/* Dashboard shell: checks the session, builds the board from the widget registry and keeps it fresh. */
import { mountDecor } from '../components/decor.js';
import { $ } from '../core/dom.js';
import { ago, wib } from '../core/format.js';
import { adminApi, getToken, signOut } from '../core/session.js';
import { debounce, guardClick, singleFlight } from '../core/timing.js';
import { createBoard } from '../widgets/board.js';
import { createHub } from '../widgets/data-hub.js';

document.documentElement.classList.add('js-ready');
$('#boot-fallback')?.setAttribute('hidden', '');
mountDecor();

const REFRESH_MS = 15_000; const IDLE_MS = 30 * 60_000;
if (!getToken()) { location.replace('/dashboard/'); }

const banner = $('#banner'); const hub = createHub(adminApi);
let timer = null; let board;

const refresh = singleFlight(async () => {
  clearTimeout(timer);
  const data = await hub.load(board.needs());
  board.update(data);
  const { status } = data;
  if (status.database === 'ok') { banner.hidden = true; }
  else {
    const reason = status.api === 'unreachable' ? 'The Heiz API is not reachable.'
      : status.database === 'not_configured' ? 'DATABASE_URL is not configured on the server.' : 'The database is not responding.';
    const wait = Math.max(30, status.retry_after_seconds || 0);
    banner.textContent = `${reason} Values shown are from the last successful refresh${hub.lastGoodAt ? ' at ' + wib(hub.lastGoodAt) : ' (none yet)'}. Checking again in ${wait} s.`;
    banner.className = 'banner' + (status.database === 'not_configured' ? ' bad' : ''); banner.hidden = false;
    timer = setTimeout(refresh, wait * 1000); return;
  }
  timer = setTimeout(refresh, REFRESH_MS);
});

board = createBoard({ root: $('#board'), palette: $('#palette'), ctx: { admin: adminApi, refresh: debounce(() => refresh(), 400) } });

async function start() {
  try { await adminApi('/api/admin/whoami', { retries: 1 }); } catch { return; }   // adminApi signs out on 401
  $('#who').textContent = 'Signed in as admin';
  await board.start();
}

const edit = $('#edit');
edit.addEventListener('click', () => {
  const on = !board.editing; board.setEditing(on);
  edit.textContent = on ? 'Done editing' : 'Edit layout'; edit.setAttribute('aria-pressed', String(on)); $('#reset').hidden = !on;
});
$('#reset').addEventListener('click', () => { if (window.confirm('Reset the board to the default layout?')) board.reset(); });
guardClick($('#refresh-now'), () => refresh(), { cooldownMs: 1500 });
$('#signout').addEventListener('click', () => signOut('Signed out.'));
document.addEventListener('visibilitychange', debounce(() => { if (!document.hidden && getToken()) refresh(); }, 600));

// Sign out after 30 minutes without interaction.
let idle = setTimeout(() => signOut('Signed out after 30 minutes of inactivity.'), IDLE_MS);
const touch = debounce(() => { clearTimeout(idle); idle = setTimeout(() => signOut('Signed out after 30 minutes of inactivity.'), IDLE_MS); }, 1000);
['pointerdown', 'keydown'].forEach((t) => document.addEventListener(t, touch));
if (getToken()) start();
