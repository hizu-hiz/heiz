/* API guide page: renders the endpoint reference from data using safe DOM construction only. */
import { mountDecor } from '../components/decor.js';
import { mountComponents } from '../components/mount.js';
import { copyText } from '../core/clipboard.js';
import { $, el } from '../core/dom.js';
import { guardClick } from '../core/timing.js';
import { ENDPOINTS, WHO } from './guide-data.js';

mountComponents(); mountDecor();
const origin = location.origin;
$('#base').textContent = origin;
$('#qs-pre').textContent = `curl "${origin}/api/earthquakes?limit=3"`;

const pre = (t) => el('pre', { text: t });
const section = (title, node) => el('div', {}, el('h4', { text: title }), node);
const root = $('#endpoint-list');

for (const e of ENDPOINTS) {
  const auth = e.who === 'writer' ? ' -H "X-API-Key: $HEIZ_API_KEY"' : e.who === 'admin' ? ' -H "Authorization: Bearer $HEIZ_ADMIN_TOKEN"' : '';
  const data = e.req ? ` -H "Content-Type: application/json" -d '${e.req.split('//')[0].trim().replace(/\s*\n\s*/g, ' ')}'` : '';
  const curl = `curl -X ${e.m} "${origin}${e.p.replace('{id}', '12')}"${auth}${data}`;
  const body = el('div', { class: 'body' });
  if (e.q) body.append(section('Query parameters', el('ul', {}, e.q.map((x) => el('li', { text: x })))));
  if (e.req) { body.append(section('Request body (JSON)', pre(e.req))); if (e.notes) body.append(el('ul', {}, e.notes.map((x) => el('li', { text: x })))); }
  body.append(section('Success', pre(e.ok)));
  if (e.err) body.append(section('Errors', el('ul', {}, e.err.map((x) => el('li', { text: x })))));
  const copy = el('button', { class: 'btn small', type: 'button' }, 'Copy command');
  guardClick(copy, async () => { copy.textContent = (await copyText(curl)) ? 'Copied' : 'Copy failed'; setTimeout(() => { copy.textContent = 'Copy command'; }, 1600); }, { cooldownMs: 300 });
  body.append(section('Example', el('div', {}, pre(curl), copy)));
  root.append(el('details', { class: 'ep' },
    el('summary', {}, el('span', { class: `verb ${e.m}`, text: e.m }),
      el('span', { class: 'path' }, e.p, el('span', { class: 'tier', text: WHO[e.who] })), el('span', { class: 'what', text: e.what })), body));
}
