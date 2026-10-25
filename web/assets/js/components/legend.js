import { el } from '../core/dom.js';
import { DEPTH_BANDS, UNKNOWN_DEPTH } from '../map/depth.js';

export function renderLegend(list) {
  for (const b of [...DEPTH_BANDS, UNKNOWN_DEPTH]) list.append(el('li', {}, el('i', { class: b.cls }), b.label));
}
