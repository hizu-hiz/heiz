/* Tiny publish/subscribe so components do not need to know about each other. */
export function createBus() {
  const handlers = new Map();
  return {
    on(name, fn) { (handlers.get(name) || handlers.set(name, new Set()).get(name)).add(fn); return () => handlers.get(name)?.delete(fn); },
    emit(name, payload) { handlers.get(name)?.forEach((fn) => { try { fn(payload); } catch (e) { console.error(e); } }); },
  };
}
