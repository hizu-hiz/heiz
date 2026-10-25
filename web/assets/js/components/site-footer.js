import { el } from '../core/dom.js';
import { CREDITS } from './credits.js';
import { LOGO_BANNER } from './site-header.js';

/** Footer with the banner logo as the "back to home" link, followed by the credits. */
export function siteFooter() {
  return el('div', { class: 'wrap' },
    el('a', { class: 'home', href: '/', 'aria-label': 'Heiz, back to the home page' },
      el('img', { src: LOGO_BANNER, alt: '', width: 260, height: 84 })),
    CREDITS.map((c) => el('span', {}, c.parts.map((p) => (typeof p === 'string' ? p
      : el('a', { href: p.a, rel: 'noopener noreferrer', text: p.t }))))));
}
