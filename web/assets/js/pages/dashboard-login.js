/* Dashboard login page. The token is checked by the server (POST /api/admin/session) via fetch(), never by a form
   post, and never placed in a URL. Inputs are sanitised, attempts are single-flight, and repeated failures back off. */
import { mountDecor } from '../components/decor.js';
import { ApiError } from '../core/http.js';
import { $ } from '../core/dom.js';
import { cleanToken } from '../core/sanitize.js';
import { login, takeFlash } from '../core/session.js';

document.documentElement.classList.add('js-ready');
$('#boot-fallback')?.setAttribute('hidden', '');
mountDecor();

const form = $('#login-form'); const input = $('#token'); const msg = $('#login-msg'); const go = $('#login-go');
let failures = 0; let lockedUntil = 0; let busy = false; let timer = null;

const show = (text, kind = 'bad') => { msg.hidden = !text; msg.textContent = text || ''; msg.dataset.kind = kind; };
const flashMessage = takeFlash(); if (flashMessage) show(flashMessage, 'warn');

function lockFor(seconds, reason) {
  lockedUntil = Date.now() + seconds * 1000; go.disabled = true; clearInterval(timer);
  const tick = () => {
    const left = Math.ceil((lockedUntil - Date.now()) / 1000);
    if (left <= 0) { clearInterval(timer); go.disabled = false; show(''); return; }
    show(`${reason} Try again in ${left} s.`);
  };
  tick(); timer = setInterval(tick, 1000);
}

async function attempt() {
  if (busy || Date.now() < lockedUntil) return;
  const { value, ok } = cleanToken(input.value);
  input.setAttribute('aria-invalid', String(!ok));
  if (!ok) { show('The admin token is at least 24 characters. Check what you pasted.'); return; }
  busy = true; go.setAttribute('aria-busy', 'true'); go.disabled = true; show('Checking...', 'warn');
  try {
    const url = await login(value);
    input.value = '';
    location.assign(url);
    return;
  } catch (e) {
    if (e instanceof ApiError && e.code === 'login_throttled') lockFor(e.retryAfter || 60, 'Too many failed attempts.');
    else if (e instanceof ApiError && e.code === 'admin_disabled') show('The server has no admin token configured. Set HEIZ_ADMIN_TOKEN (24 characters or more) and redeploy.');
    else if (e instanceof ApiError && e.status === 401) {
      failures += 1; show('That token was not accepted.');
      if (failures >= 3) lockFor(Math.min(60, 5 * 2 ** (failures - 3)), 'Slow down.');     // local back-off: 5 s, 10 s, 20 s ...
    } else show(e.message || 'Could not sign in.');
  } finally {
    busy = false; go.removeAttribute('aria-busy'); if (Date.now() >= lockedUntil) go.disabled = false;
  }
}

form.addEventListener('submit', (ev) => { ev.preventDefault(); attempt(); });
