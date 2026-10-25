/* Small status components shared by every page: pill, notice banner (with retry countdown) and toasts. */
import { el } from '../core/dom.js';

export function setPill(node, state, text) { node.dataset.state = state; node.textContent = text; }

export function createNotice(node) {
  let timer = null;
  const stop = () => { clearInterval(timer); timer = null; };
  return {
    show(text, kind = 'warn') { stop(); node.hidden = !text; node.textContent = text || ''; node.className = `notice ${kind}`; },
    hide() { stop(); node.hidden = true; },
    /** "<reason> Retrying in N s." counting down, then calls onDone(). */
    countdown(seconds, reason, onDone, kind = 'warn') {
      stop(); let left = Math.max(1, Math.round(seconds));
      node.hidden = false; node.className = `notice ${kind}`;
      const tick = () => { node.textContent = `${reason} Retrying in ${left} s.`; if (left-- <= 0) { stop(); onDone(); } };
      tick(); timer = setInterval(tick, 1000);
    },
    stop,
  };
}

export function createToasts(container, { max = 3, ms = 9000 } = {}) {
  return {
    push(text) {
      const t = el('div', { class: 'toast', text });
      container.append(t);
      while (container.children.length > max) container.firstChild.remove();
      setTimeout(() => t.remove(), ms);
    },
  };
}
