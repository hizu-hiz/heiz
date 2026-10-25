/* Summary numbers for the rail. computeFacts is pure so it can be tested and reused. */
export function computeFacts(events, now = Date.now()) {
  const within = (h) => events.filter((e) => e.occurred_at && now - new Date(e.occurred_at).getTime() <= h * 3600e3);
  const mags = within(48).map((e) => e.magnitude).filter((m) => m != null).map(Number);
  return { last24h: within(24).length, m5: mags.filter((m) => m >= 5).length, max: mags.length ? Math.max(...mags) : null };
}

export function renderFacts(root, events) {
  const f = computeFacts(events);
  root.querySelector('[data-fact="24h"]').textContent = f.last24h;
  root.querySelector('[data-fact="m5"]').textContent = f.m5;
  root.querySelector('[data-fact="max"]').textContent = f.max == null ? '-' : f.max.toFixed(1);
}
