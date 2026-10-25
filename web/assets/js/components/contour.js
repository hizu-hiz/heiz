/* Animated contour map: solid isolines (marching squares, interpolated) over a slowly evolving terrain field that
   fills the whole canvas. Each mount rolls its own terrain (noise seed, feature size, warp strength, hills and basins),
   so no two screens look alike, and the field is domain-warped so the lines wander like real topography instead of
   forming even blobs. Lines only: no fills, no gradients. One shared loop drives every canvas; off-screen canvases and
   hidden tabs cost nothing. Reduced-motion users get one still frame. */
const THEMES = {
  dark: { minor: 'rgba(120, 120, 220, .13)', index: 'rgba(130, 130, 235, .24)', accent: 'rgba(160, 160, 255, .36)' },
  light: { minor: 'rgba(47, 47, 143, .10)', index: 'rgba(47, 47, 143, .18)', accent: 'rgba(47, 47, 143, .28)' },
};
const FPS = 20;
const MAX_VERTICES = 9000;               // keeps big screens affordable by enlarging the cell instead of dropping detail elsewhere
const instances = new Set();
let raf = null; let last = 0;
const reduced = () => window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
const rand = (a, b) => a + Math.random() * (b - a);

/* 3D value noise with a per-instance permutation table (so every mount has a different landscape). */
function makeNoise() {
  const p = new Uint8Array(512); const base = Array.from({ length: 256 }, (_, i) => i);
  for (let i = 255; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [base[i], base[j]] = [base[j], base[i]]; }
  for (let i = 0; i < 512; i++) p[i] = base[i & 255];
  const v = (x, y, z) => p[p[p[x & 255] + (y & 255)] + (z & 255)] / 255;
  const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);
  return (x, y, z) => {
    const xi = Math.floor(x); const yi = Math.floor(y); const zi = Math.floor(z);
    const u = fade(x - xi); const w = fade(y - yi); const s = fade(z - zi);
    const l = (a, b, t) => a + (b - a) * t;
    return l(l(l(v(xi, yi, zi), v(xi + 1, yi, zi), u), l(v(xi, yi + 1, zi), v(xi + 1, yi + 1, zi), u), w),
      l(l(v(xi, yi, zi + 1), v(xi + 1, yi, zi + 1), u), l(v(xi, yi + 1, zi + 1), v(xi + 1, yi + 1, zi + 1), u), w), s);
  };
}

// Corner bits: a(top-left)=8 b(top-right)=4 c(bottom-right)=2 d(bottom-left)=1. Edges: T=a-b R=b-c B=d-c L=a-d.
const CASES = { 1: ['L', 'B'], 2: ['B', 'R'], 3: ['L', 'R'], 4: ['T', 'R'], 5: ['T', 'L', 'B', 'R'], 6: ['T', 'B'], 7: ['L', 'T'],
  8: ['L', 'T'], 9: ['T', 'B'], 10: ['L', 'B', 'T', 'R'], 11: ['T', 'R'], 12: ['L', 'R'], 13: ['B', 'R'], 14: ['L', 'B'] };

class Contour {
  constructor(canvas, { theme = 'dark', cell = 16, speed = 1 } = {}) {
    Object.assign(this, { canvas, ctx: canvas.getContext('2d'), colors: THEMES[theme] || THEMES.dark, cell, speed });
    this.noise = makeNoise();
    this.t = Math.random() * 200; this.visible = true; this.w = 0; this.h = 0;
    this.levels = Math.round(rand(15, 20));              // how many isolines (variety between mounts)
    this.feature = rand(240, 480);                       // px size of the main terrain features
    this.warp = rand(0.7, 1.7);                          // how strongly the lines wander
    this.hills = Array.from({ length: Math.round(rand(3, 6)) }, () => ({
      x: Math.random(), y: Math.random(), r: rand(0.12, 0.3), a: rand(0.35, 0.8) * (Math.random() < 0.3 ? -1 : 1),
      sx: rand(0.05, 0.14), sy: rand(0.05, 0.14), ph: rand(0, 6.28), orbit: rand(0.02, 0.07),
    }));
    this.ro = new ResizeObserver(() => { this.resize(); this.draw(); }); this.ro.observe(canvas);
    this.io = new IntersectionObserver((e) => { this.visible = e[e.length - 1].isIntersecting; }); this.io.observe(canvas);
    this.resize(); this.draw();
  }

  resize() {
    const r = this.canvas.getBoundingClientRect(); const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.w = Math.max(1, Math.round(r.width)); this.h = Math.max(1, Math.round(r.height));
    this.canvas.width = Math.round(this.w * dpr); this.canvas.height = Math.round(this.h * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.step = Math.max(this.cell, Math.sqrt((this.w * this.h) / MAX_VERTICES));
    this.cols = Math.ceil(this.w / this.step) + 1; this.rows = Math.ceil(this.h / this.step) + 1;
    this.grid = new Float32Array(this.cols * this.rows);
  }

  value(px, py, t) {
    const n = this.noise; const k = 1 / this.feature; const x = px * k; const y = py * k; const z = t * 0.05;
    const fbm = (a, b, c) => (n(a, b, c) * 0.58 + n(a * 2.03, b * 2.03, c * 1.3) * 0.29 + n(a * 4.1, b * 4.1, c * 1.7) * 0.13);
    const wx = fbm(x + 5.2, y + 1.3, z * 0.7) - 0.5; const wy = fbm(x + 1.7, y + 9.2, z * 0.7) - 0.5;
    let v = (fbm(x + this.warp * wx * 2, y + this.warp * wy * 2, z) - 0.5) * 2.1;
    for (const h of this.hills) {                          // hills and basins give the closed rings real maps have
      const cx = (h.x + Math.cos(t * h.sx + h.ph) * h.orbit) * this.w; const cy = (h.y + Math.sin(t * h.sy + h.ph * 1.7) * h.orbit) * this.h;
      const rr = h.r * Math.max(this.w, this.h); const dx = px - cx; const dy = py - cy;
      v += h.a * Math.exp(-(dx * dx + dy * dy) / (2 * rr * rr));
    }
    return v;
  }

  draw() {
    const { ctx, cols, rows, step, grid, w, h } = this;
    ctx.clearRect(0, 0, w, h);
    for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) grid[j * cols + i] = this.value(i * step, j * step, this.t);
    const lo = -0.85; const hi = 1.05;
    ctx.lineJoin = ctx.lineCap = 'round';
    for (let k = 0; k < this.levels; k++) {
      const level = lo + ((hi - lo) * (k + 0.5)) / this.levels;
      ctx.strokeStyle = k % 8 === 0 ? this.colors.accent : k % 4 === 0 ? this.colors.index : this.colors.minor;
      ctx.lineWidth = k % 8 === 0 ? 1.7 : k % 4 === 0 ? 1.3 : 0.9;
      ctx.beginPath();
      for (let j = 0; j < rows - 1; j++) {
        for (let i = 0; i < cols - 1; i++) {
          const a = grid[j * cols + i]; const b = grid[j * cols + i + 1]; const c = grid[(j + 1) * cols + i + 1]; const d = grid[(j + 1) * cols + i];
          const idx = (a > level ? 8 : 0) | (b > level ? 4 : 0) | (c > level ? 2 : 0) | (d > level ? 1 : 0);
          const segs = CASES[idx]; if (!segs) continue;
          const x0 = i * step; const y0 = j * step;
          const pt = (e) => (e === 'T' ? [x0 + step * ((level - a) / (b - a)), y0]
            : e === 'B' ? [x0 + step * ((level - d) / (c - d)), y0 + step]
              : e === 'L' ? [x0, y0 + step * ((level - a) / (d - a))] : [x0 + step, y0 + step * ((level - b) / (c - b))]);
          for (let s = 0; s < segs.length; s += 2) { const p = pt(segs[s]); const q = pt(segs[s + 1]); ctx.moveTo(p[0], p[1]); ctx.lineTo(q[0], q[1]); }
        }
      }
      ctx.stroke();
    }
  }

  destroy() { this.ro.disconnect(); this.io.disconnect(); instances.delete(this); }
}

function loop(now) {
  raf = requestAnimationFrame(loop);
  if (document.hidden || now - last < 1000 / FPS) return;
  const dt = (now - last) / 1000; last = now;
  for (const c of instances) if (c.visible) { c.t += Math.min(dt, 0.2) * c.speed; c.draw(); }
}

/** Starts a contour animation on a canvas. Returns { stop() }. */
export function startContours(canvas, options = {}) {
  const c = new Contour(canvas, options);
  if (reduced()) return { stop: () => c.destroy() };       // still frame only
  instances.add(c);
  if (raf === null) { last = performance.now(); raf = requestAnimationFrame(loop); }
  return { stop() { c.destroy(); if (!instances.size && raf !== null) { cancelAnimationFrame(raf); raf = null; } } };
}
