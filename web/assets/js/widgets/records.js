import { el, kv } from '../core/dom.js';

export default {
  mount(body) {
    const list = el('dl', { class: 'kv' }); body.append(list);
    return { update({ overview }) {
      if (!overview) return;
      const c = overview.counts;
      kv(list, [['Earthquake events', c.earthquake_events, true], ['of which manual', c.manual_events], ['Audit rows (event_updates)', c.event_updates], ['Sync logs', c.sync_logs]]);
    } };
  },
};
