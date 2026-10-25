import { chip, el, table } from '../core/dom.js';
import { guardClick } from '../core/timing.js';
import { explain, statusKind } from './util.js';

const FEEDS = [['gempaterkini', 'M 5+ (gempaterkini)'], ['gempadirasakan', 'Felt (gempadirasakan)'], ['autogempa', 'Latest (autogempa)']];

export default {
  mount(body, ctx) {
    const boxes = FEEDS.map(([value, label]) => ({ value, input: el('input', { type: 'checkbox', checked: true }), label }));
    const out = el('div', { role: 'status' });
    const go = el('button', { class: 'btn primary', type: 'button' }, 'Sync now');
    body.append(
      el('div', { class: 'row' }, el('fieldset', { class: 'feeds' }, el('legend', { class: 'vh', text: 'Feeds' }),
        boxes.map((b) => el('label', {}, b.input, b.label))), go),
      el('p', { class: 'muted small', text: 'One sync per 60 seconds is allowed. BMKG allows 60 requests per minute per IP.' }), out);
    guardClick(go, async () => {
      const feeds = boxes.filter((b) => b.input.checked).map((b) => b.value);          // only values from our own list ever leave this form
      if (!feeds.length) { out.replaceChildren(el('p', { class: 'msg', text: 'Select at least one feed.' })); return; }
      out.replaceChildren(el('p', { class: 'muted', text: 'Syncing...' }));
      try {
        const logs = await ctx.admin('/api/sync', { method: 'POST', body: { feeds }, timeoutMs: 60_000 });
        out.replaceChildren(table(['Feed', 'Status', 'Received', 'New', 'Updated', 'Skipped', 'Note'],
          logs.map((l) => [l.request_url.split('/').pop(), chip(l.status, statusKind(l.status)), l.records_received, l.records_created, l.records_updated, l.records_skipped, l.error_summary || '']), [2, 3, 4, 5]));
        ctx.refresh();
      } catch (e) { out.replaceChildren(el('p', { class: 'msg', text: explain(e) })); }
    }, { cooldownMs: 1500 });
    return { update() {} };
  },
};
