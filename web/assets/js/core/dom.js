/* Safe DOM helpers. Text is always inserted with textContent / text nodes, never as HTML. */
import { safeUrl } from './sanitize.js';

export const $ = (selector, root = document) => root.querySelector(selector);
export const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
export const clear = (node) => { node.replaceChildren(); return node; };

/** el('button', { class: 'btn', onclick: fn, text: 'Go' }, child, 'text') */
export function el(tag, attrs, ...kids) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs || {})) {
    if (value == null || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key.startsWith('on') && typeof value === 'function') node.addEventListener(key.slice(2), value);
    else if (key === 'href' || key === 'src') {
      const safe = safeUrl(value);
      if (safe) node.setAttribute(key, safe);
    } else if (/^on/i.test(key)) continue;            // never set inline event-handler attributes from strings
    else node.setAttribute(key, value === true ? '' : String(value));
  }
  for (const kid of kids.flat()) {
    if (kid == null || kid === false) continue;
    node.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  }
  return node;
}

export const chip = (text, kind) => el('span', { class: `chip ${kind}`, text });

export function table(heads, rows, numericColumns = []) {
  return el('table', { class: 't' },
    el('thead', {}, el('tr', {}, heads.map((h) => el('th', { scope: 'col', text: h })))),
    el('tbody', {}, rows.map((r) => el('tr', {}, r.map((c, i) => el('td', { class: numericColumns.includes(i) ? 'num' : null }, c))))));
}

export function kv(target, pairs) {
  target.replaceChildren();
  for (const [k, v, big] of pairs) target.append(el('dt', { text: k }), el('dd', { class: big ? 'big' : null }, v));
}
