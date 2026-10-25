import { chip, el, table } from '../core/dom.js';
import { wib } from '../core/format.js';
import { statusKind } from './util.js';

export default {
  mount(body) {
    const box = el('div', { class: 'scroll' }); body.append(box);
    return { update({ logs }) {
      if (!logs) return;
      const rows = logs.data;
      box.replaceChildren(rows.length ? table(['When', 'Status', 'Received', 'New', 'Updated', 'Skipped', 'Feed / note'],
        rows.map((r) => [wib(r.started_at), chip(r.status, statusKind(r.status)), r.records_received, r.records_created, r.records_updated, r.records_skipped,
          (r.request_url ? r.request_url.split('/').pop() : '') + (r.error_summary ? ' | ' + r.error_summary : '')]), [2, 3, 4, 5])
        : el('p', { class: 'muted', text: 'No syncs yet. Run one from the Sync widget.' }));
    } };
  },
};
