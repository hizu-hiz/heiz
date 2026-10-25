/* Seismograph trails for loading states. Three channels scroll a trace across the canvas. Each pass (iteration)
   draws new random parameters, and sharpness changes along the trace: calm and rounded at the start, the sharp
   S-wave in the middle, a ragged decay at the end. The trail tapers in width and steps down in opacity behind the head.
   Solid colour only. Reduced-motion users get one still frame. */
const COLORS = ['#fafa64', '#d3e58f', '#8fa54a'];
const BANDS = 14;                      // the trail is drawn in bands, each with its own width and opacity
const reduced = () => window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
const rand = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const smooth = (t) => t * t * (3 - 2 * t);

function newIteration(channel) {
  return {
    p: rand(0.12, 0.3),                 // P-wave arrival (fraction of the width)
    s: rand(0.34, 0.6),                 // S-wave arrival
    peak: rand(0.55, 0.95) * (1 - channel * 0.18),
    decay: rand(2.2, 4.6),
    freq: rand(26, 52),
    sharpStart: rand(0, 0.25), sharpMid: rand(0.55, 1), sharpEnd: rand(0.15, 0.95),
    seed: Math.random() * 1000, tilt: rand(-0.04, 0.04),
  };
}

function sharpnessAt(it, x) {           // 0 = smooth sine, 1 = jagged spikes
  return x < 0.5 ? it.sharpStart + (it.sharpMid - it.sharpStart) * smooth(x / 0.5)
    : it.sharpMid + (it.sharpEnd - it.sharpMid) * smooth((x - 0.5) / 0.5);
}
function amplitudeAt(it, x) {
  if (x < it.p) return 0.04;
  if (x < it.s) return 0.04 + 0.2 * smooth((x - it.p) / (it.s - it.p));
  return 0.24 + (it.peak - 0.24) * Math.exp(-it.decay * Math.max(0, x - it.s - 0.05)) * (x < it.s + 0.05 ? smooth((x - it.s) / 0.05) : 1);
}
function valueAt(it, x) {
  const phase = x * it.freq + it.seed;
  const smoothWave = Math.sin(phase) * 0.8 + Math.sin(phase * 0.43) * 0.2;
  const tri = (2 / Math.PI) * Math.asin(Math.sin(phase * 1.31));
  const noise = Math.sin(phase * 7.7 + it.seed) * Math.sin(phase * 3.1) ;
  const sharpWave = Math.sign(tri) * Math.pow(Math.abs(tri), 0.45) * 0.8 + noise * 0.35;
  const k = clamp(sharpnessAt(it, x));
  return smoothWave * (1 - k) + sharpWave * k;
}

/** Starts the animation on a canvas. Returns { stop() }. */
export function startSeismicTrails(canvas, { channels = 3, durationMs = 3600 } = {}) {
  const ctx = canvas.getContext('2d');
  let w = 0; let h = 0; let raf = null; let startedAt = performance.now(); let stopped = false;
  let iterations = Array.from({ length: channels }, (_, i) => newIteration(i));
  let lastPass = -1;

  const resize = () => {
    const r = canvas.getBoundingClientRect(); const dpr = Math.min(window.devicePixelRatio || 1, 2);
    w = Math.max(1, Math.round(r.width)); h = Math.max(1, Math.round(r.height));
    canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  };
  const ro = new ResizeObserver(() => { resize(); frame(performance.now()); }); ro.observe(canvas);

  function drawTrace(ch, head, tail) {
    const it = iterations[ch]; const lane = h / channels; const mid = lane * (ch + 0.5);
    const step = 2; const n = Math.max(2, Math.floor(w / step));
    const pts = [];
    for (let i = 0; i <= n; i++) {
      const x = i / n;
      if (x > head) break;
      pts.push([x * w, mid + (amplitudeAt(it, x) * valueAt(it, x) + it.tilt * (x - 0.5)) * lane * 0.46]);
    }
    if (pts.length < 2) return;
    ctx.strokeStyle = COLORS[ch % COLORS.length]; ctx.lineJoin = ctx.lineCap = 'round';
    const first = Math.max(0, Math.floor(((head - tail) * n)));
    const span = pts.length - 1 - first;
    for (let b = 0; b < BANDS; b++) {                      // oldest band first (thin, faint) -> newest (thick, opaque)
      const from = first + Math.floor((span * b) / BANDS); const to = first + Math.floor((span * (b + 1)) / BANDS) + 1;
      if (to <= from + 0) continue;
      const age = (b + 1) / BANDS;
      ctx.globalAlpha = 0.12 + 0.88 * age; ctx.lineWidth = 0.6 + 2.0 * age * (0.5 + 0.5 * clamp(sharpnessAt(it, pts[Math.min(to, pts.length - 1)][0] / w)));
      ctx.beginPath(); ctx.moveTo(pts[from][0], pts[from][1]);
      for (let i = from + 1; i <= Math.min(to, pts.length - 1); i++) ctx.lineTo(pts[i][0], pts[i][1]);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    const tip = pts[pts.length - 1]; ctx.fillStyle = COLORS[ch % COLORS.length];
    ctx.beginPath(); ctx.arc(tip[0], tip[1], 2.6, 0, 6.283); ctx.fill();
  }

  function frame(now) {
    ctx.clearRect(0, 0, w, h);
    ctx.strokeStyle = '#232b17'; ctx.lineWidth = 1;          // baselines
    for (let c = 0; c < channels; c++) { const y = (h / channels) * (c + 0.5); ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke(); }
    const elapsed = now - startedAt; const pass = Math.floor(elapsed / durationMs);
    if (pass !== lastPass) { iterations = iterations.map((_, i) => newIteration(i)); lastPass = pass; }   // new look every pass
    const progress = (elapsed % durationMs) / durationMs;
    const head = clamp(progress * 1.12);                       // slightly beyond 1 so the end of the trace is fully drawn
    for (let c = 0; c < channels; c++) drawTrace(c, Math.min(1, head - c * 0.04 > 0 ? head - c * 0.04 : 0.001), 0.62);
  }
  const loop = (now) => { if (stopped) return; if (!document.hidden) frame(now); raf = requestAnimationFrame(loop); };

  resize();
  if (reduced()) { startedAt = performance.now() - durationMs * 0.62; frame(performance.now()); }
  else raf = requestAnimationFrame(loop);
  return { stop() { stopped = true; if (raf) cancelAnimationFrame(raf); ro.disconnect(); } };
}
