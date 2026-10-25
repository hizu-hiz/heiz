import { el } from '../core/dom.js';
import { ago, wib } from '../core/format.js';

/** Popup content built with DOM nodes only (BMKG text is untrusted). */
export function popupContent(e) {
  const root = el('div', { class: 'pop' },
    el('h3', { text: e.magnitude == null ? 'Magnitude not reported' : 'M ' + Number(e.magnitude).toFixed(1) }),
    el('p', { text: e.location_description }),
    el('p', { class: 'small', text: `${wib(e.occurred_at)} (${ago(e.occurred_at)})` }),
    el('p', { class: 'small', text: e.depth_km == null ? 'Depth not reported' : `Depth ${Number(e.depth_km).toFixed(0)} km` }));
  if (e.tsunami_potential === true) root.append(el('p', { class: 'tsu alert', text: 'BMKG indicates tsunami potential. Follow official BMKG channels.' }));
  else if (e.tsunami_potential === false) root.append(el('p', { class: 'tsu', text: 'BMKG: no tsunami potential.' }));
  if (e.tsunami_note) root.append(el('p', { class: 'small', text: 'BMKG note: ' + e.tsunami_note }));
  if (e.felt_text) root.append(el('p', { class: 'small', text: 'Felt: ' + e.felt_text }));
  if (typeof e.shakemap_url === 'string' && e.shakemap_url.startsWith('https://static.bmkg.go.id/')) {   // BMKG's own image host only
    root.append(el('p', { class: 'small' }, el('a', { href: e.shakemap_url, target: '_blank', rel: 'noopener noreferrer', text: 'Shakemap image (BMKG)' })));
  }
  root.append(el('p', { class: 'small', text: `Source: ${e.source_attribution}` }));
  return root;
}
