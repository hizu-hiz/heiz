import { el } from '../core/dom.js';
import { QuakeMap } from '../map/quake-map.js';

export default {
  mount(body) {
    const box = el('div', { class: 'livemap', role: 'region', 'aria-label': 'Map of the last 48 hours' }); body.append(box);
    const map = new QuakeMap(box, { collapsedControls: true });
    setTimeout(() => map.invalidate(), 200);
    return { update({ recent }) { if (recent) map.setEvents(recent.data); map.invalidate(); }, destroy() { map.stopReplay(); map.map.remove(); } };
  },
};
