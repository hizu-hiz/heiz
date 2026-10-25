import { clear, el } from '../core/dom.js';
import { ago, magText } from '../core/format.js';
import { depthKey } from '../map/depth.js';

/** Latest-events list. onSelect(id) is called when a row is activated. */
export function renderEventFeed(list, events, { unreachable = false, onSelect, limit = 12 } = {}) {
  clear(list);
  if (!events.length) {
    list.append(el('li', { class: 'empty', text: unreachable ? 'No earthquakes to show while the service is unreachable.'
      : 'No earthquakes stored yet. They appear after the first sync from BMKG.' }));
    return;
  }
  for (const e of events.slice(0, limit)) {
    const m = magText(e.magnitude);
    list.append(el('li', {}, el('button', { class: 'ev', type: 'button', 'data-depth': depthKey(e),
      'aria-label': `Magnitude ${m}, ${e.location_description}, ${ago(e.occurred_at)}. Show on map.`, onclick: () => onSelect && onSelect(e.id) },
      el('span', { class: 'mag', text: m }), el('span', { class: 'where', text: e.location_description }),
      el('span', { class: 'when', text: ago(e.occurred_at) }))));
  }
}
