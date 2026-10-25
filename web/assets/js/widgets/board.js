/* Dashboard builder: composes widgets from the registry according to a saved layout.
   Layout = ordered list of { id, size }. It is stored per browser, validated on load (unknown ids, duplicates and bad
   sizes are dropped), and edited with plain buttons (move, resize, remove, add, presets) so it works with a keyboard. */
import { el } from '../core/dom.js';
import { cleanChoice } from '../core/sanitize.js';
import { local } from '../core/store.js';
import { PRESETS, REGISTRY, SIZES, makeLayout } from './registry.js';

const KEY = 'dash-layout-v1';

export function sanitizeLayout(raw) {
  if (!Array.isArray(raw)) return null;
  const seen = new Set(); const out = [];
  for (const item of raw) {
    if (!item || typeof item.id !== 'string' || !(item.id in REGISTRY) || seen.has(item.id)) continue;
    seen.add(item.id); out.push({ id: item.id, size: cleanChoice(item.size, SIZES, REGISTRY[item.id].size) });
  }
  return out;
}

export function createBoard({ root, palette, ctx }) {
  let layout = sanitizeLayout(local.get(KEY)) ?? makeLayout(PRESETS.Default);
  const cards = new Map();            // id -> { node, body, instance, title }
  let editing = false;

  const save = () => local.set(KEY, layout);
  const sizeLabel = { sm: 'Small', md: 'Medium', lg: 'Wide' };

  async function mountWidget(entry) {
    const meta = REGISTRY[entry.id];
    const body = el('div', { class: 'w-body' });
    const tools = el('div', { class: 'w-tools' },
      el('button', { class: 'btn small', type: 'button', 'aria-label': `Move ${meta.title} earlier`, onclick: () => move(entry.id, -1) }, '↑'),
      el('button', { class: 'btn small', type: 'button', 'aria-label': `Move ${meta.title} later`, onclick: () => move(entry.id, 1) }, '↓'),
      el('button', { class: 'btn small', type: 'button', 'aria-label': `Change size of ${meta.title}`, onclick: () => resize(entry.id) }, sizeLabel[entry.size]),
      el('button', { class: 'btn small danger', type: 'button', 'aria-label': `Remove ${meta.title}`, onclick: () => remove(entry.id) }, 'Remove'));
    const node = el('section', { class: 'w', 'data-size': entry.size, 'data-widget': entry.id, 'aria-label': meta.title },
      el('header', {}, el('h2', { text: meta.title }), tools), body);
    const card = { node, body, instance: null, tools };
    cards.set(entry.id, card);
    try {
      const mod = (await meta.load()).default;
      card.instance = mod.mount(body, ctx);
    } catch (e) {
      console.error(e); body.append(el('p', { class: 'w-fail', text: 'This widget could not start.' }));
    }
    return node;
  }

  async function renderAll() {
    root.replaceChildren();
    cards.forEach((c) => c.instance?.destroy?.()); cards.clear();
    for (const entry of layout) root.append(await mountWidget(entry));
    renderPalette(); ctx.refresh();
  }

  function reorderDom() { for (const entry of layout) root.append(cards.get(entry.id).node); }
  function move(id, delta) {
    const i = layout.findIndex((e) => e.id === id); const j = i + delta;
    if (j < 0 || j >= layout.length) return;
    [layout[i], layout[j]] = [layout[j], layout[i]]; save(); reorderDom();
  }
  function resize(id) {
    const e = layout.find((x) => x.id === id); e.size = SIZES[(SIZES.indexOf(e.size) + 1) % SIZES.length]; save();
    const c = cards.get(id); c.node.dataset.size = e.size; c.tools.children[2].textContent = sizeLabel[e.size];
    c.instance?.update && c.instance.resized?.();
  }
  function remove(id) {
    layout = layout.filter((e) => e.id !== id); save();
    const c = cards.get(id); c.instance?.destroy?.(); c.node.remove(); cards.delete(id); renderPalette();
  }
  async function add(id) {
    if (!(id in REGISTRY) || cards.has(id)) return;
    const entry = { id, size: REGISTRY[id].size }; layout.push(entry); save();
    root.append(await mountWidget(entry)); renderPalette(); ctx.refresh();
  }

  function renderPalette() {
    palette.replaceChildren();
    palette.hidden = !editing;
    if (!editing) return;
    const missing = Object.keys(REGISTRY).filter((id) => !cards.has(id));
    const select = el('select', { 'aria-label': 'Widget to add' }, missing.map((id) => el('option', { value: id, text: REGISTRY[id].title })));
    const addBtn = el('button', { class: 'btn small', type: 'button', onclick: () => select.value && add(select.value) }, 'Add widget');
    const presetSel = el('select', { 'aria-label': 'Layout preset' }, Object.keys(PRESETS).map((p) => el('option', { value: p, text: p })));
    const apply = el('button', { class: 'btn small', type: 'button', onclick: () => {
      layout = makeLayout(PRESETS[cleanChoice(presetSel.value, Object.keys(PRESETS), 'Default')]); save(); renderAll();
    } }, 'Apply preset');
    palette.append(missing.length ? el('span', {}, select, ' ', addBtn) : el('span', { class: 'muted', text: 'All widgets are on the board.' }), el('span', {}, presetSel, ' ', apply));
  }

  return {
    start: renderAll,
    get editing() { return editing; },
    setEditing(on) { editing = on; root.classList.toggle('editing', on); renderPalette(); },
    needs() { return layout.flatMap((e) => REGISTRY[e.id].needs); },
    update(data) { cards.forEach((c) => { try { c.instance?.update?.(data); } catch (e) { console.error(e); } }); },
    reset() { layout = makeLayout(PRESETS.Default); save(); return renderAll(); },
  };
}
