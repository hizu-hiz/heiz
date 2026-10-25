/* Animated contour map: solid isolines (marching squares) over a slowly drifting terrain field.
   Lines only, no fills, no gradients, no heat map. One shared animation loop drives every canvas, and canvases
   that are off-screen, or a hidden tab, cost nothing. Reduced-motion users get a single still frame. */
const THEMES = {
  dark: { minor: '#222a15', index: '#38441f', accent: '#5b6a22' },
  light: { minor: '#d3d8bf', index: '#bcc59c', accent: '#9aa86a' },
};
const FPS = 20;
const instances = new Set();
let raf = null; let last = 0;
const reduced = () => window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;

// Corner order a(top-left) b(top-right) c(bottom-right) d(bottom-left); edges T=a-b R=b-c B=d-c L=a-d.
const CASES = { 1: ['L', 'B'], 2: ['B', 'R'], 3: ['L', 'R'], 4: ['T', 'R'], 6: ['T', 'B'], 7: ['L', 'T'], 8: ['L', 'T'],
  9: ['T', 'B'], 11: ['T', 'R'], 12: ['L', 'R'], 13: ['B', 'R'], 14: ['L', 'B'] };

function field(x, y, t, blobs) {
  let v = 0;
  for (const b of blobs) {
    const cx = b.x + Math.cos(t * b.sx + b.p) * b.rx; const cy = b.y + Math.sin(t * b.sy + b.p * 1.7) * b.ry;
    const dx = x - cx; const dy = y - cy;
    v += b.a * Math.exp(-(dx * dx + dy * dy) / (2 * b.s * b.s));
  }
  return v + 0.05 * Math.sin(x * 3.1 + t * 0.13) * Math.cos(y * 2.3 - t * 0.1);
}

class Contour {
  constructor(canvas, { theme = 'dark', cell = 24, levels = 9, speed = 1 } = {}) {
    Object.assign(this, { canvas, ctx: canvas.getContext('2d'), colors: THEMES[theme] || THEMES.dark, cell, levels, speed });
    this.t = Math.random() * 100; this.visible = true; this.w = 0; this.h = 0;
    this.blobs = Array.from({ length: 6 }, () => ({
      x: Math.random(), y: Math.random(), rx: 0.15 + Math.random() * 0.22, ry: 0.12 + Math.random() * 0.2,
      sx: 0.05 + Math.random() * 0.09, sy: 0.04 + Math.random() * 0.08, p: Math.random() * 6.28,
      s: 0.13 + Math.random() * 0.12, a: 0.55 + Math.random() * 0.45 }));
    this.ro = new ResizeObserver(() => this.resize()); this.ro.observe(canvas);
    this.io = new IntersectionObserver(([entry]) => { this.visible = entry.isIntersecting; }, { rootMargin: '80px' });
    this.io.observe(canvas);
    this.resize();
  }

  resize() {
    const r = this.canvas.getBoundingClientRect(); const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    this.w = Math.max(1, Math.round(r.width)); this.h = Math.max(1, Math.round(r.height));
    this.canvas.width = Math.round(this.w * dpr); this.canvas.height = Math.round(this.h * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.cols = Math.ceil(this.w / this.cell) + 1; this.rows = Math.ceil(this.h / this.cell) + 1;
    this.grid = new Float32Array((this.cols + 1) * (this.rows + 1));
    this.draw();
  }

  draw() {
    const { ctx, w, h, cell, cols, rows, grid } = this;
    ctx.clearRect(0, 0, w, h);
    const stride = cols + 1; const aspect = w / h;
    for (let j = 0; j <= rows; j++) for (let i = 0; i <= cols; i++) {
      grid[j * stride + i] = field((i * cell) / w * aspect, (j * cell) / h, this.t, this.blobs);
    }
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    for (let k = 1; k <= this.levels; k++) {
      const level = k * (1.15 / (this.levels + 1));
      const major = k % 4 === 0;
      ctx.strokeStyle = major ? this.colors.accent : k % 2 === 0 ? this.colors.index : this.colors.minor;
      ctx.lineWidth = major ? 1.6 : 1;
      ctx.beginPath();
      for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
        const a = grid[j * stride + i]; const b = grid[j * stride + i + 1];
        const c = grid[(j + 1) * stride + i + 1]; const d = grid[(j + 1) * stride + i];
        const code = (a > level ? 8 : 0) | (b > level ? 4 : 0) | (c > level ? 2 : 0) | (d > level ? 1 : 0);
        if (code === 0 || code === 15) continue;
        const x0 = i * cell; const y0 = j * cell;
        const pt = (edge) => {
          if (edge === 'T') return [x0 + ((level - a) / (b - a)) * cell, y0];
          if (edge === 'R') return [x0 + cell, y0 + ((level - b) / (c - b)) * cell];
          if (edge === 'B') return [x0 + ((level - d) / (c - d)) * cell, y0 + cell];
          return [x0, y0 + ((level - a) / (d - a)) * cell];
        };
        let segs = CASES[code];
        if (code === 5 || code === 10) {
          const inside = (a + b + c + d) / 4 > level;
          segs = code === 5 ? (inside ? ['L', 'T', 'B', 'R'] : ['T', 'R', 'L', 'B']) : (inside ? ['T', 'R', 'L', 'B'] : ['L', 'T', 'B', 'R']);
        }
        for (let s = 0; s < segs.length; s += 2) {
          const p = pt(segs[s]); const q = pt(segs[s + 1]);
          ctx.moveTo(p[0], p[1]); ctx.lineTo(q[0], q[1]);
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
