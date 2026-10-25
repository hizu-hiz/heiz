/* QuakeMap: Leaflet map with switchable basemaps and overlays, animated rings for fresh events and a time-lapse
   replay. Reusable: the landing page and the dashboard's live-map widget both construct it. Needs window.L (vendored). */
import { el } from '../core/dom.js';
import { makeBasemaps } from './basemaps.js';
import { band } from './depth.js';
import { popupContent } from './popup.js';

const radiusPx = (m) => Math.max(5, 2.1 * Math.pow(Math.max(m ?? 2, 1), 1.28));
const glowMeters = (m) => 9000 * Math.pow(2, Math.max(m ?? 2, 1) - 2);
const reduceMotion = () => window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
const hasPos = (e) => typeof e.latitude === 'number' && typeof e.longitude === 'number';
const mag = (e) => (e.magnitude == null ? null : Number(e.magnitude));
const colorOf = (e) => band(e.depth_km).color;

export class QuakeMap {
  constructor(container, { onNew, padLeft = 0, collapsedControls = window.innerWidth < 860 } = {}) {
    const L = window.L;
    if (!L) throw new Error('Leaflet is not loaded');
    this.L = L; this.onNew = onNew; this.known = new Set(); this.markers = new Map();
    this.map = L.map(container, { zoomControl: false, worldCopyJump: true, minZoom: 3, attributionControl: false }).setView([-2.5, 118], 5);
    L.control.attribution({ prefix: '<a href="https://leafletjs.com">Leaflet</a>', position: 'bottomright' }).addTo(this.map);
    L.control.zoom({ position: 'bottomright' }).addTo(this.map);
    this.map.createPane('glow').style.zIndex = 380; this.map.getPane('glow').classList.add('glow-pane');
    this.map.createPane('rings').style.zIndex = 650;
    this.groups = { circles: L.layerGroup(), glow: L.layerGroup(), pulse: L.layerGroup() };
    this.ripples = L.layerGroup().addTo(this.map);
    const base = {}; for (const [name, make] of Object.entries(makeBasemaps(L))) base[name] = make();
    base['Dark, plain'].addTo(this.map);
    Object.values(this.groups).forEach((g) => g.addTo(this.map));
    L.control.layers(base, { 'Magnitude circles': this.groups.circles, 'Energy glow': this.groups.glow, 'Pulse rings (last 24 h)': this.groups.pulse },
      { position: 'topright', collapsed: collapsedControls }).addTo(this.map);
    this.map.fitBounds([[-11.5, 94.5], [6.5, 141.5]], { paddingTopLeft: [padLeft, 10], paddingBottomRight: [10, 10] });
  }

  invalidate() { this.map.invalidateSize(); }

  _clear() { Object.values(this.groups).forEach((g) => g.clearLayers()); this.markers.clear(); }

  _ringIcon(e, cls) {
    const size = Math.round(radiusPx(mag(e)) * 3.4);
    const node = el('span', { class: cls });
    node.style.setProperty('--c', colorOf(e));
    node.style.setProperty('--dur', (4.2 - Math.min(2.4, (mag(e) ?? 2) * 0.4)).toFixed(1) + 's');
    return this.L.divIcon({ className: '', html: node, iconSize: [size, size], iconAnchor: [size / 2, size / 2] });
  }

  _addEvent(e, target, { glow = true, pulse = true } = {}) {
    if (!hasPos(e)) return null;
    const L = this.L; const color = colorOf(e); const ll = [e.latitude, e.longitude];
    const marker = L.circleMarker(ll, { radius: radiusPx(mag(e)), color: '#0b0f07', weight: 1.2, fillColor: color, fillOpacity: 0.8 })
      .bindPopup(() => popupContent(e), { maxWidth: 300 });
    (target.circles || this.groups.circles).addLayer(marker);
    if (glow) (target.glow || this.groups.glow).addLayer(L.circle(ll, { pane: 'glow', radius: glowMeters(mag(e)), stroke: false, fillColor: color, fillOpacity: 0.28, interactive: false }));
    const young = e.occurred_at && Date.now() - new Date(e.occurred_at).getTime() < 24 * 3600e3;
    if (pulse && young) (target.pulse || this.groups.pulse).addLayer(L.marker(ll, { pane: 'rings', interactive: false, keyboard: false, icon: this._ringIcon(e, 'pulse') }));
    return marker;
  }

  /** Replace the shown events. Events not seen before (after the first load) get a ripple and onNew. */
  setEvents(events) {
    if (this._replaying) { this._pending = events; return; }
    const fresh = this.known.size ? events.filter((e) => !this.known.has(e.id)) : [];
    this._clear();
    for (const e of events) { const m = this._addEvent(e, {}); if (m) this.markers.set(e.id, m); }
    events.forEach((e) => this.known.add(e.id));
    for (const e of fresh.filter(hasPos)) { this.ripple(e); if (this.onNew) this.onNew(e); }
  }

  ripple(e) {
    if (reduceMotion() || !hasPos(e)) return;
    const m = this.L.marker([e.latitude, e.longitude], { pane: 'rings', interactive: false, keyboard: false, icon: this._ringIcon(e, 'ripple') });
    this.ripples.addLayer(m); setTimeout(() => this.ripples.removeLayer(m), 6000);
  }

  focus(id) {
    const m = this.markers.get(id); if (!m) return;
    this.map.flyTo(m.getLatLng(), Math.max(this.map.getZoom(), 6), { duration: reduceMotion() ? 0 : 0.9 });
    m.openPopup();
  }

  /** Time-lapse in chronological order. Returns false when there is nothing to replay. */
  replay(events, { durationMs = 22_000, onTick, onEnd } = {}) {
    this.stopReplay();
    const evs = events.filter((e) => hasPos(e) && e.occurred_at).map((e) => ({ e, t: new Date(e.occurred_at).getTime() })).sort((a, b) => a.t - b.t);
    if (!evs.length) return false;
    const L = this.L; this._replaying = true;
    this._hidden = Object.values(this.groups).filter((g) => this.map.hasLayer(g));
    this._hidden.forEach((g) => this.map.removeLayer(g));
    this._rLayers = { circles: L.layerGroup().addTo(this.map), glow: L.layerGroup().addTo(this.map), pulse: L.layerGroup() };
    const t0 = evs[0].t; const t1 = Math.max(evs[evs.length - 1].t, t0 + 1); const start = performance.now(); let i = 0;
    const step = (now) => {
      const p = Math.min(1, (now - start) / durationMs); const tNow = t0 + (t1 - t0) * p;
      while (i < evs.length && evs[i].t <= tNow) { this._addEvent(evs[i].e, this._rLayers, { pulse: false }); this.ripple(evs[i].e); i++; }
      if (onTick) onTick({ progress: p, time: new Date(tNow) });
      if (p < 1) this._raf = requestAnimationFrame(step); else { this._raf = null; if (onEnd) onEnd(); }
    };
    this._raf = requestAnimationFrame(step);
    return true;
  }

  stopReplay() {
    if (!this._replaying) return;
    if (this._raf) cancelAnimationFrame(this._raf);
    this._raf = null;
    Object.values(this._rLayers).forEach((g) => this.map.removeLayer(g));
    this._hidden.forEach((g) => g.addTo(this.map));
    this._replaying = false;
    if (this._pending) { const p = this._pending; this._pending = null; this.setEvents(p); }
  }
}
