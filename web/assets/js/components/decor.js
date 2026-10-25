/* Declarative decoration: <canvas data-contour data-contour-theme="dark"> gets the contour animation. Textures are
   pure CSS (class "tex tex-hex" or "tex tex-diamond"), so nothing else is needed for them. */
import { startContours } from './contour.js';

export function mountDecor(root = document) {
  const handles = [];
  root.querySelectorAll('canvas[data-contour]').forEach((canvas) => {
    if (canvas.dataset.mounted) return;
    canvas.dataset.mounted = '1';
    handles.push(startContours(canvas, { theme: canvas.dataset.contourTheme === 'light' ? 'light' : 'dark' }));
  });
  return { stop: () => handles.forEach((h) => h.stop()) };
}
