import { chip, el, kv } from '../core/dom.js';
import { ago, wib } from '../core/format.js';
import { statusKind } from './util.js';

export default {
  mount(body) {
    const list = el('dl', { class: 'kv' }); body.append(list);
    return { update({ status, overview }) {
      const dbKind = status.database === 'ok' ? 'ok' : status.database === 'unavailable' ? 'warn' : 'bad';
      const last = overview && overview.last_sync;
      kv(list, [
        ['API', chip(status.api === 'ok' ? 'up' : 'unreachable', status.api === 'ok' ? 'ok' : 'bad')],
        ['Database', chip(status.database === 'ok' ? 'reachable' : status.database, dbKind)],
        ['DB latency', status.latency_ms != null ? status.latency_ms + ' ms' : 'n/a'],
        ['Last sync', last ? el('span', {}, chip(last.status, statusKind(last.status)), ' ' + ago(last.finished_at || last.started_at)) : 'none yet'],
        ['Checked', wib(status.checked_at)]]);
    } };
  },
};
