import { el } from './dom.js';

export async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch {
    const t = el('textarea', { 'aria-hidden': 'true' }); t.value = text; document.body.append(t); t.select();
    let ok = false; try { ok = document.execCommand('copy'); } catch { /* ignore */ } t.remove(); return ok;
  }
}
