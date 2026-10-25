/* Seismograph trace for the splash. One continuous trace scrolls right to left. Every sample is random: a white-noise part
   and a smoothed (low-pass) part are mixed in a proportion that is re-rolled for each short burst, together with the
   burst's strength, so the trace is ragged and uneven rather than periodic. The trace is split into zones that line up with
   the status pins: ok = full activity, pending = faint, bad / skipped = a flat line drawn in the alert colour.
   Solid colour only. Reduced-motion users get one still frame. */
const reduced = () => window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
const rand = (a, b) => a + Math.random() * (b - a);
const smooth = (t) => t * t * (3 - 2 * t);
const GAIN = { ok: 1, pending: 0.22, bad: 0, skip: 0 };
const STEP = 2;                         // CSS px between samples
const SPEED = 80;                       // CSS px per second

function cssColor(name, fallback) {
  try { return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback; } catch { return fallback; }
}

/** Starts the trace. zones = number of status zones across the width. Returns { stop(), setZone(index, state) }. */
export function startSeismicTrails(canvas, { zones = 3 } = {}) {
  const ctx = canvas.getContext('2d');
  const trace = cssColor('--trace', '#6c6cf0'); const alert = cssColor('--pink', '#f26d98');
  let w = 0; let h = 0; let raf = null; let stopped = false; let prev = performance.now(); let acc = 0;
  const state = Array.from({ length: zones }, () => 'pending'); const gain = Array.from({ length: zones }, () => GAIN.pending);
  let samples = []; let lp = 0;
  let burst = { left: 0, amp: 1, sharp: 0.5 };

  const nextSample = () => {
    if (burst.left <= 0) burst = { left: Math.round(rand(6, 40)), amp: Math.random() < 0.2 ? rand(0.1, 0.3) : rand(0.35, 1), sharp: rand(0.15, 1) };
    burst.left -= 1;
    const white = Math.random() * 2 - 1;
    lp = lp * 0.72 + white * 0.28;                           // smoothed random walk
    const v = (lp * 2.4) * (1 - burst.sharp) + white * burst.sharp;
    return Math.max(-1, Math.min(1, v * burst.amp));
  };
  const resize = () => {
    const r = canvas.getBoundingClientRect(); const dpr = Math.min(window.devicePixelRatio || 1, 2);
    w = Math.max(1, Math.round(r.width)); h = Math.max(1, Math.round(r.height));
    canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const need = Math.ceil(w / STEP) + 3; while (samples.length < need) samples.push(nextSample()); samples.length = need;
  };
  const gainAt = (x) => {                                    // zone gain at pixel x, eased across the zone borders
    const f = (x / w) * zones - 0.5; const i = Math.floor(f); const t = smooth(Math.min(1, Math.max(0, (f - i) * 1.0)));
    const a = gain[Math.max(0, Math.min(zones - 1, i))]; const b = gain[Math.max(0, Math.min(zones - 1, i + 1))];
    return a + (b - a) * t;
  };
  const zoneAt = (x) => Math.max(0, Math.min(zones - 1, Math.floor((x / w) * zones)));

  function frame() {
    ctx.clearRect(0, 0, w, h);
    const mid = h * 0.7; const amp = h * 0.3;
    let seg = []; let segFlat = null;
    const flush = () => {
      if (seg.length > 1) {
        ctx.strokeStyle = segFlat ? alert : trace; ctx.lineWidth = segFlat ? 1.6 : 1.4;
        ctx.beginPath(); ctx.moveTo(seg[0][0], seg[0][1]); for (let i = 1; i < seg.length; i++) ctx.lineTo(seg[i][0], seg[i][1]); ctx.stroke();
      }
      seg = [];
    };
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    for (let i = 0; i < samples.length; i++) {
      const x = i * STEP - acc; const g = gainAt(x); const flat = state[zoneAt(x)] === 'bad' || state[zoneAt(x)] === 'skip';
      if (x < -STEP) continue;
      if (segFlat !== null && flat !== segFlat) { const keep = seg[seg.length - 1]; flush(); if (keep) seg.push(keep); }
      segFlat = flat; seg.push([x, mid - samples[i] * g * amp]);
    }
    flush();
  }
  function loop(now) {
    if (stopped) return; raf = requestAnimationFrame(loop);
    const dt = Math.min(0.1, (now - prev) / 1000); prev = now;
    if (document.hidden) return;
    acc += dt * SPEED; while (acc >= STEP) { acc -= STEP; samples.shift(); samples.push(nextSample()); }
    frame();
  }

  const ro = new ResizeObserver(() => { resize(); frame(); }); ro.observe(canvas);
  resize();
  if (reduced()) frame(); else raf = requestAnimationFrame(loop);
  return {
    setZone(i, s) { if (i < 0 || i >= zones) return; state[i] = s; gain[i] = GAIN[s] ?? GAIN.pending; if (reduced()) frame(); },
    stop() { stopped = true; if (raf) cancelAnimationFrame(raf); ro.disconnect(); },
  };
}
