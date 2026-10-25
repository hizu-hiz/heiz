import { el, table } from '../core/dom.js';
import { bytes } from '../core/format.js';

export default {
  mount(body) {
    return { update({ overview }) {
      body.replaceChildren();
      if (!overview) { body.append(el('p', { class: 'muted', text: 'Waiting for the database.' })); return; }
      const s = overview.storage;
      if (!s.supported) { body.append(el('p', { class: 'muted', text: 'Size reporting needs PostgreSQL. Not available on this server.' })); return; }
      const frac = s.used_fraction ?? 0; const kind = frac > 0.9 ? 'bad' : frac > 0.7 ? 'warn' : '';
      body.append(
        el('p', {}, el('strong', { text: bytes(s.database_bytes) }), ` of ${bytes(s.quota_bytes)} (${(frac * 100).toFixed(1)}%)`),
        el('progress', { class: 'meter ' + kind, max: 1, value: Math.min(1, frac), 'aria-label': 'Database size against quota' }),
        el('p', { class: 'muted small', text: 'Database size includes Supabase system schemas. Confirm the quota on your Supabase plan page.' }),
        table(['Table', 'Size'], s.tables.slice(0, 7).map((t) => [t.name, bytes(t.bytes)]), [1]));
      if (frac > 0.7) body.append(el('p', { class: 'msg', text: 'Above 70% of the quota. Run a cleanup preview.' }));
    } };
  },
};
