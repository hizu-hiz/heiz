import { el, table } from '../core/dom.js';
import { wib } from '../core/format.js';

export default {
  mount(body) {
    const box = el('div', { class: 'scroll' }); body.append(box);
    return { update({ events }) {
      if (!events) return;
      const rows = events.data;
      box.replaceChildren(rows.length ? table(['ID', 'Source', 'M', 'Location', 'Occurred'],
        rows.map((e) => [e.id, e.source_code, e.magnitude == null ? '-' : Number(e.magnitude).toFixed(1), e.location_description, wib(e.occurred_at)]), [0, 2])
        : el('p', { class: 'muted', text: 'No events stored.' }));
    } };
  },
};
