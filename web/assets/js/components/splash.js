/* Splash screen controller. Markup lives in the page (so it paints immediately); this wires behaviour. */
import { $, $$ } from '../core/dom.js';
import { startSeismicTrails } from './seismic-trails.js';

export function createSplash(root, { minVisibleMs = 1400 } = {}) {
  const shownAt = Date.now();
  const trails = startSeismicTrails($('.splash-trails', root));
  const stepNode = $('[data-splash-step]', root); const detailNode = $('[data-splash-detail]', root);
  const actions = $('.splash-actions', root);
  const skipBtn = $('[data-splash-skip]', root); const retryBtn = $('[data-splash-retry]', root);
  let wake = null;

  const signal = (what) => () => { if (wake) { const w = wake; wake = null; w(what); } };
  skipBtn.addEventListener('click', signal('skip'));
  retryBtn.addEventListener('click', signal('retry'));

  return {
    step(text, detail = '') { stepNode.textContent = text; detailNode.textContent = detail; },
    check(name, state) { const li = $(`[data-check="${name}"]`, root); if (li) li.dataset.state = state; },
    offerChoices({ canUseSaved }) {
      actions.hidden = false;
      skipBtn.textContent = canUseSaved ? 'Show saved data' : 'Continue anyway';
    },
    /** Resolves 'timeout', or early with 'skip' / 'retry' when the visitor presses a button. */
    waitOrAction(ms) {
      return new Promise((resolve) => {
        const timer = setTimeout(() => { wake = null; resolve('timeout'); }, ms);
        wake = (what) => { clearTimeout(timer); resolve(what); };
      });
    },
    async dismiss() {
      const wait = minVisibleMs - (Date.now() - shownAt);
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));   // long enough to read, short enough not to annoy
      root.classList.add('leaving');
      document.documentElement.classList.remove('splashing');
      await new Promise((r) => setTimeout(r, 480));
      trails.stop(); root.hidden = true;
      $$('[data-contour]', root).forEach((c) => c.remove());
    },
  };
}
