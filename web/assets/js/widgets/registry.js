/* Widget catalogue for the dashboard builder. `needs` lists the datasets a widget reads; the board fetches only the
   union of what the visible widgets need. Modules load on demand, so a hidden widget costs nothing.
   To add a widget: create widgets/<name>.js exporting default { mount(body, ctx) -> { update(data), destroy? } }
   and add one line here. */
export const REGISTRY = {
  service: { title: 'Service', size: 'sm', needs: ['status', 'overview'], load: () => import('./service.js') },
  storage: { title: 'Storage', size: 'sm', needs: ['overview'], load: () => import('./storage.js') },
  records: { title: 'Records', size: 'sm', needs: ['overview'], load: () => import('./records.js') },
  sync: { title: 'Sync from BMKG', size: 'md', needs: [], load: () => import('./sync.js') },
  cleanup: { title: 'Clean up old data', size: 'md', needs: ['overview'], load: () => import('./cleanup.js') },
  logs: { title: 'Recent syncs', size: 'lg', needs: ['logs'], load: () => import('./logs.js') },
  events: { title: 'Latest events', size: 'lg', needs: ['events'], load: () => import('./events.js') },
  livemap: { title: 'Live map (48 h)', size: 'md', needs: ['recent'], load: () => import('./livemap.js') },
};

export const SIZES = ['sm', 'md', 'lg'];
export const PRESETS = {
  'Default': ['service', 'storage', 'records', 'sync', 'cleanup', 'logs', 'events'],
  'Monitoring': ['service', 'storage', 'records', 'livemap', 'events', 'logs'],
  'Maintenance': ['service', 'storage', 'records', 'sync', 'cleanup', 'logs'],
};
export const makeLayout = (ids) => ids.map((id) => ({ id, size: REGISTRY[id].size }));
