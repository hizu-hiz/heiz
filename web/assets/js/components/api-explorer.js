/* "Call the API from here": fixed examples plus one filter form. Inputs are sanitised and debounced; running a
   request is single-flight with a cooldown, and the client-side request budget in http.js backs it up. */
import { api, ApiError } from '../core/http.js';
import { copyText } from '../core/clipboard.js';
import { $, clear, el } from '../core/dom.js';
import { cleanInt, cleanNumber, toQuery } from '../core/sanitize.js';
import { debounce, guardClick } from '../core/timing.js';

const EXAMPLES = [
  { label: 'Latest 3 earthquakes', path: '/api/earthquakes?limit=3' },
  { label: 'Magnitude 5 or more', path: '/api/earthquakes?min_magnitude=5&limit=5' },
  { label: 'Is the database up?', path: '/api/status' },
];

export function mountApiExplorer(root) {
  const list = $('[data-examples]', root); const out = $('[data-out]', root);
  const minMag = $('[data-f-mag]', root); const limit = $('[data-f-limit]', root); const hint = $('[data-f-hint]', root);
  const origin = location.origin;

  async function run(path) {
    out.textContent = `GET ${path}\n\nLoading...`;
    try {
      const data = await api(path, { retries: 0, fresh: true });
      const text = JSON.stringify(data, null, 2);
      out.textContent = `GET ${path}\n200 OK\n\n` + (text.length > 4000 ? text.slice(0, 4000) + '\n... (shortened)' : text);
    } catch (e) {
      const code = e instanceof ApiError ? `${e.status || 'No response'} ${e.code}` : 'Error';
      out.textContent = `GET ${path}\n${code}\n\n${e.message}` + (e.retryable ? '\n\nThis error is temporary. Try again in a moment.' : '')
        + (e.code === 'client_rate_limited' ? `\n\nTry again in about ${e.retryAfter} s.` : '');
    }
  }

  function row(label, path) {
    const cmd = `curl "${origin}${path}"`;
    const code = el('code', { text: cmd }); const lab = el('span', { class: 'label', text: label });
    const runBtn = el('button', { class: 'btn', type: 'button' }, 'Run'); const copyBtn = el('button', { class: 'btn', type: 'button' }, 'Copy');
    guardClick(runBtn, () => run(path), { cooldownMs: 900 });
    guardClick(copyBtn, async () => { copyBtn.textContent = (await copyText(cmd)) ? 'Copied' : 'Copy failed'; setTimeout(() => { copyBtn.textContent = 'Copy'; }, 1600); }, { cooldownMs: 300 });
    const li = el('li', {}, el('div', { class: 'cmd' }, el('div', {}, lab, code), el('div', { class: 'row' }, runBtn, copyBtn)));
    return { li, update(newLabel, newPath) { code.textContent = `curl "${origin}${newPath}"`; lab.textContent = newLabel; path = newPath; } };
  }

  clear(list);
  for (const ex of EXAMPLES) list.append(row(ex.label, ex.path).li);
  const custom = row('Your filter', '/api/earthquakes?limit=5'); list.append(custom.li);

  const rebuild = debounce(() => {
    const mag = cleanNumber(minMag.value, { min: 0, max: 10, decimals: 1 });
    const lim = cleanInt(limit.value, { min: 1, max: 100, fallback: 5 });
    minMag.setAttribute('aria-invalid', String(minMag.value.trim() !== '' && mag === null));
    hint.textContent = minMag.value.trim() !== '' && mag === null ? 'Minimum magnitude must be a number from 0 to 10.' : 'Values are checked and limited before they are used.';
    custom.update('Your filter', '/api/earthquakes' + toQuery({ min_magnitude: mag, limit: lim }));
  }, 350);
  minMag.addEventListener('input', rebuild); limit.addEventListener('input', rebuild);
  rebuild();
}
