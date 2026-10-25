const WIB = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Jakarta', day: '2-digit', month: 'short',
  hour: '2-digit', minute: '2-digit', hour12: false });

export const wib = (date) => (date ? WIB.format(new Date(date)).replace(',', '') + ' WIB' : 'unknown time');

export function ago(date, now = Date.now()) {
  if (!date) return 'unknown';
  const s = Math.max(0, Math.round((now - new Date(date).getTime()) / 1000));
  if (s < 90) return 'just now';
  if (s < 5400) return Math.round(s / 60) + ' min ago';
  if (s < 129600) return Math.round(s / 3600) + ' h ago';
  return Math.round(s / 86400) + ' d ago';
}

export function bytes(n) {
  if (n == null) return 'n/a';
  const units = ['B', 'KB', 'MB', 'GB']; let i = 0; let v = n;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return (i ? v.toFixed(v < 10 ? 1 : 0) : v) + ' ' + units[i];
}

export const magText = (m) => (m == null ? '?' : Number(m).toFixed(1));
