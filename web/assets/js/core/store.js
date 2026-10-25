/* localStorage/sessionStorage can be missing or throw (private mode, blocked data): every access is guarded,
   with an in-memory fallback so the page works either way. */
const memory = new Map();
function make(getStorage) {
  return {
    get(key) {
      try { const raw = getStorage().getItem('heiz:' + key); return raw == null ? null : JSON.parse(raw); } catch { return memory.get(key) ?? null; }
    },
    set(key, value) {
      try { getStorage().setItem('heiz:' + key, JSON.stringify(value)); } catch { memory.set(key, value); }
    },
    del(key) { try { getStorage().removeItem('heiz:' + key); } catch { /* ignore */ } memory.delete(key); },
  };
}
export const local = make(() => localStorage);
export const session = make(() => sessionStorage);
