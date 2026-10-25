/* Component registry: <div data-component="site-header" data-variant="bar"> is replaced by the real component.
   Pages stay thin: they declare what they want in HTML and import only page logic. */
import { siteFooter } from './site-footer.js';
import { siteHeader } from './site-header.js';

const registry = {
  'site-header': (host) => siteHeader({
    variant: host.dataset.variant === 'brand' ? 'brand' : 'bar',
    current: host.dataset.current || '',
    nav: [{ id: 'map', href: '/', label: 'Live map' }, { id: 'guide', href: '/guide', label: 'API guide' }, { id: 'swagger', href: '/docs', label: 'Swagger' }],
  }),
  'site-footer': () => siteFooter(),
};

export function register(name, factory) { registry[name] = factory; }

export function mountComponents(root = document) {
  root.querySelectorAll('[data-component]').forEach((host) => {
    const make = registry[host.dataset.component];
    if (!make || host.dataset.mounted) return;
    host.dataset.mounted = '1';
    host.replaceChildren(make(host));
  });
}
