import { el, table } from '../core/dom.js';
import { guardClick } from '../core/timing.js';
import { explain } from './util.js';

export default {
  mount(body, ctx) {
    const rules = el('p', { class: 'muted' }); const out = el('div', { role: 'status' });
    const preview = el('button', { class: 'btn', type: 'button' }, 'Preview cleanup');
    const run = el('button', { class: 'btn danger', type: 'button' }, 'Run cleanup');
    body.append(rules, el('div', { class: 'row' }, preview, run), out);

    async function prune(dry) {
      if (!dry && !window.confirm('Delete old records now? This cannot be undone. Run a preview first if you have not.')) return;
      out.replaceChildren(el('p', { class: 'muted', text: dry ? 'Previewing...' : 'Cleaning up...' }));
      try {
        const r = await ctx.admin('/api/admin/maintenance/prune', { method: 'POST', body: { dry_run: dry }, timeoutMs: 60_000 });
        out.replaceChildren(el('p', { text: dry ? 'Preview only. Nothing was changed.' : 'Cleanup finished.' }),
          table(['Rule', 'Matching', dry ? 'Would change' : 'Changed', 'More waiting'],
            r.steps.map((s) => [s.rule.replaceAll('_', ' '), s.enabled ? s.matched : 'off', s.enabled ? (dry ? Math.min(s.matched, r.batch_size) : s.changed) : '-', s.more_pending ? 'yes, run again' : 'no']), [1, 2]));
        if (!dry) ctx.refresh();
      } catch (e) { out.replaceChildren(el('p', { class: 'msg', text: explain(e) })); }
    }
    guardClick(preview, () => prune(true), { cooldownMs: 1200 });
    guardClick(run, () => prune(false), { cooldownMs: 2500 });
    return { update({ overview }) {
      if (!overview) return;
      const r = overview.retention;
      rules.textContent = `Rules: raw payloads older than ${r.raw_payload_days} days are cleared; audit rows older than ${r.event_updates_days} days, sync logs older than ${r.sync_logs_days} days and imported events older than ${r.events_days} days are deleted. Manual events are never removed. Each rule handles at most ${r.batch_size} rows per run. A value of 0 turns a rule off.`;
    } };
  },
};
