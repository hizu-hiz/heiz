import { el } from '../core/dom.js';

export const LOGO_ACCENT = '/assets/img/heiz-logo-accent.svg';
export const LOGO_BANNER = '/assets/img/heiz-logo-banner.svg';

/** Brand mark linking home: the accent logo plus the wordmark. */
export function brand({ label = 'Heiz', href = '/' } = {}) {
  return el('a', { class: 'brand', href, 'aria-label': `${label}, home` },
    el('img', { src: LOGO_ACCENT, alt: '', width: 38, height: 26 }), el('span', { text: label }));
}

/** variant "bar": brand + navigation. variant "brand": brand only (used inside the landing rail). */
export function siteHeader({ variant = 'bar', nav = [], current = '' } = {}) {
  const root = el('div', { class: 'site-header' }, brand());
  if (variant === 'bar' && nav.length) {
    root.append(el('nav', { 'aria-label': 'Site' }, nav.map((n) =>
      el('a', { href: n.href, 'aria-current': n.id === current ? 'page' : null, text: n.label }))));
  }
  return root;
}
