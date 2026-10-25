/* Timing guards: debounce, throttle, single-flight and click guards, so rapid input never piles up requests. */
export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Runs `fn` after `ms` of quiet. `leading` also runs it immediately on the first call of a burst. */
export function debounce(fn, ms, { leading = false } = {}) {
  let timer = null; let lastArgs = null;
  const wrapped = (...args) => {
    lastArgs = args;
    const startNow = leading && timer === null;
    clearTimeout(timer);
    timer = setTimeout(() => { timer = null; if (!startNow && lastArgs) fn(...lastArgs); lastArgs = null; }, ms);
    if (startNow) fn(...args);
  };
  wrapped.cancel = () => { clearTimeout(timer); timer = null; lastArgs = null; };
  return wrapped;
}

/** At most one call per `ms`; the last call during the wait still runs afterwards. */
export function throttle(fn, ms) {
  let last = 0; let timer = null; let pending = null;
  return (...args) => {
    const wait = ms - (Date.now() - last);
    if (wait <= 0) { last = Date.now(); fn(...args); return; }
    pending = args;
    if (!timer) timer = setTimeout(() => { timer = null; last = Date.now(); fn(...pending); }, wait);
  };
}

/** While a call is running, further calls get the same promise instead of starting another. */
export function singleFlight(fn) {
  let running = null;
  return (...args) => {
    if (!running) running = Promise.resolve().then(() => fn(...args)).finally(() => { running = null; });
    return running;
  };
}

/** Click handler that ignores clicks while it is running and for `cooldownMs` afterwards. */
export function guardClick(button, handler, { cooldownMs = 700 } = {}) {
  let busy = false;
  button.addEventListener('click', async (event) => {
    if (busy) { event.preventDefault(); return; }
    busy = true; button.setAttribute('aria-busy', 'true'); button.disabled = true;
    try { await handler(event); } finally {
      setTimeout(() => { busy = false; button.removeAttribute('aria-busy'); button.disabled = false; }, cooldownMs);
    }
  });
}
