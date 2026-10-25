/* QuakeMap: Leaflet map with switchable basemaps and overlays, animated rings for fresh events,
   and a time-lapse replay. Depends on window.L (vendored Leaflet) and window.Heiz (common.js). */
(() => {
  'use strict';
  const { el, wib, ago } = window.Heiz;
  const L = window.L;

  const TILE_ATTR = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';
  const BASEMAPS = {
    'Dark, plain': () => L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
      { subdomains: 'abcd', maxZoom: 14, attribution: TILE_ATTR + ' &copy; <a href="https://carto.com/attributions">CARTO</a>' }),
    'Light, plain': () => L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',
      { subdomains: 'abcd', maxZoom: 14, attribution: TILE_ATTR + ' &copy; <a href="https://carto.com/attributions">CARTO</a>' }),
    'Satellite': () => L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      { maxZoom: 13, attribution: 'Imagery &copy; Esri, Maxar, Earthstar Geographics' }),
    'Terrain': () => L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',
      { subdomains: 'abc', maxZoom: 13, attribution: 'Map data &copy; OpenStreetMap contributors, SRTM | Style &copy; <a href="https://opentopomap.org">OpenTopoMap</a> (CC-BY-SA)' }),
  };

  const DEPTH_BANDS = [
    { max: 30, key: 'shallow', color: '#e3be2b', label: 'Shallow, under 30 km' },
    { max: 70, key: 'mid', color: '#ee8550', label: '30 to 70 km' },
    { max: 150, key: 'deep', color: '#c4558f', label: '70 to 150 km' },
    { max: Infinity, key: 'vdeep', color: '#7a6ae0', label: 'Deep, over 150 km' },
  ];
  const UNKNOWN_DEPTH = { key: 'unknown', color: '#9aa8b6', label: 'Depth not reported' };
  const band = (depth) => (depth == null ? UNKNOWN_DEPTH : DEPTH_BANDS.find((b) => depth < b.max));
  const radiusPx = (m) => Math.max(5, 2.1 * Math.pow(Math.max(m ?? 2, 1), 1.28));
  const glowMeters = (m) => 9000 * Math.pow(2, Math.max(m ?? 2, 1) - 2);
  const reduceMotion = () => window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const hasPos = (e) => typeof e.latitude === 'number' && typeof e.longitude === 'number';
  const mag = (e) => (e.magnitude == null ? null : Number(e.magnitude));

  function popupContent(e) {
    const root = el('div', { class: 'pop' },
      el('h3', { text: e.magnitude == null ? 'Magnitude not reported' : 'M ' + Number(e.magnitude).toFixed(1) }),
      el('p', { text: e.location_description }),
      el('p', { class: 'small', text: `${wib(e.occurred_at)} (${ago(e.occurred_at)})` }),
      el('p', { class: 'small', text: e.depth_km == null ? 'Depth not reported' : `Depth ${Number(e.depth_km).toFixed(0)} km` }));
    if (e.tsunami_potential === true) {
      root.append(el('p', { class: 'tsu alert', text: 'BMKG indicates tsunami potential. Follow official BMKG channels.' }));
    } else if (e.tsunami_potential === false) {
      root.append(el('p', { class: 'tsu', text: 'BMKG: no tsunami potential.' }));
    }
    if (e.tsunami_note) root.append(el('p', { class: 'small', text: 'BMKG note: ' + e.tsunami_note }));
    if (e.felt_text) root.append(el('p', { class: 'small', text: 'Felt: ' + e.felt_text }));
    // Only ever link to BMKG's own image host.
    if (typeof e.shakemap_url === 'string' && e.shakemap_url.startsWith('https://static.bmkg.go.id/')) {
      root.append(el('p', { class: 'small' },
        el('a', { href: e.shakemap_url, target: '_blank', rel: 'noopener noreferrer', text: 'Shakemap image (BMKG)' })));
    }
    root.append(el('p', { class: 'small', text: `Source: ${e.source_attribution}` }));
    return root;
  }

  class QuakeMap {
    constructor(container, { onNew } = {}) {
      this.onNew = onNew;
      this.known = new Set();
      this.markers = new Map();
      this.map = L.map(container, { zoomControl: false, worldCopyJump: true, minZoom: 3, attributionControl: false })
        .setView([-2.5, 118], 5);
      L.control.attribution({ prefix: '<a href="https://leafletjs.com">Leaflet</a>', position: 'bottomright' }).addTo(this.map);
      L.control.zoom({ position: 'bottomright' }).addTo(this.map);
      this.map.createPane('glow').style.zIndex = 380;
      this.map.getPane('glow').classList.add('glow-pane');
      this.map.createPane('rings').style.zIndex = 650;

      this.groups = {
        circles: L.layerGroup(), glow: L.layerGroup(), pulse: L.layerGroup(),
      };
      this.ripples = L.layerGroup().addTo(this.map);
      const base = {};
      for (const [name, make] of Object.entries(BASEMAPS)) base[name] = make();
      base['Dark, plain'].addTo(this.map);
      this.overlays = {
        'Magnitude circles': this.groups.circles,
        'Energy glow': this.groups.glow,
        'Pulse rings (last 24 h)': this.groups.pulse,
      };
      Object.values(this.groups).forEach((g) => g.addTo(this.map));
      L.control.layers(base, this.overlays, { position: 'topright', collapsed: window.innerWidth < 860 }).addTo(this.map);
      this.map.fitBounds([[-11.5, 94.5], [6.5, 141.5]], { paddingTopLeft: [window.innerWidth > 860 ? 410 : 10, 10], paddingBottomRight: [10, 10] });
    }

    _clear() {
      Object.values(this.groups).forEach((g) => g.clearLayers());
      this.markers.clear();
    }

    _addEvent(e, target, { glow = true, pulse = true } = {}) {
      if (!hasPos(e)) return null;
      const color = band(e.depth_km == null ? null : Number(e.depth_km)).color;
      const ll = [e.latitude, e.longitude];
      const marker = L.circleMarker(ll, { radius: radiusPx(mag(e)), color: '#0b0f14', weight: 1.2, fillColor: color, fillOpacity: 0.8 })
        .bindPopup(() => popupContent(e), { maxWidth: 300 });
      (target.circles || this.groups.circles).addLayer(marker);
      if (glow) {
        (target.glow || this.groups.glow).addLayer(L.circle(ll, {
          pane: 'glow', radius: glowMeters(mag(e)), stroke: false, fillColor: color, fillOpacity: 0.28, interactive: false }));
      }
      const young = e.occurred_at && Date.now() - new Date(e.occurred_at).getTime() < 24 * 3600 * 1000;
      if (pulse && young) {
        (target.pulse || this.groups.pulse).addLayer(L.marker(ll, { pane: 'rings', interactive: false, keyboard: false, icon: this._ringIcon(e, 'pulse') }));
      }
      return marker;
    }

    _ringIcon(e, cls) {
      const size = Math.round(radiusPx(mag(e)) * 3.4);
      const node = el('span', { class: cls });
      node.style.setProperty('--c', band(e.depth_km == null ? null : Number(e.depth_km)).color);
      node.style.setProperty('--dur', (4.2 - Math.min(2.4, (mag(e) ?? 2) * 0.4)).toFixed(1) + 's');
      return L.divIcon({ className: '', html: node, iconSize: [size, size], iconAnchor: [size / 2, size / 2] });
    }

    /** Replace the shown events. Events not seen before (after the first load) get a ripple and onNew. */
    setEvents(events) {
      if (this._replaying) { this._pending = events; return; }
      const fresh = this.known.size ? events.filter((e) => !this.known.has(e.id)) : [];
      this._clear();
      for (const e of events) {
        const m = this._addEvent(e, {});
        if (m) this.markers.set(e.id, m);
      }
      events.forEach((e) => this.known.add(e.id));
      for (const e of fresh.filter(hasPos)) { this.ripple(e); if (this.onNew) this.onNew(e); }
    }

    ripple(e) {
      if (reduceMotion() || !hasPos(e)) return;
      const m = L.marker([e.latitude, e.longitude], { pane: 'rings', interactive: false, keyboard: false, icon: this._ringIcon(e, 'ripple') });
      this.ripples.addLayer(m);
      setTimeout(() => this.ripples.removeLayer(m), 6000);
    }

    focus(id) {
      const m = this.markers.get(id);
      if (!m) return;
      this.map.flyTo(m.getLatLng(), Math.max(this.map.getZoom(), 6), { duration: reduceMotion() ? 0 : 0.9 });
      m.openPopup();
    }

    /** Time-lapse of the given events in chronological order. Returns false when there is nothing to replay. */
    replay(events, { durationMs = 22000, onTick, onEnd } = {}) {
      this.stopReplay();
      const evs = events.filter((e) => hasPos(e) && e.occurred_at)
        .map((e) => ({ e, t: new Date(e.occurred_at).getTime() })).sort((a, b) => a.t - b.t);
      if (!evs.length) return false;
      this._replaying = true;
      this._hidden = Object.entries(this.groups).filter(([, g]) => this.map.hasLayer(g)).map(([, g]) => g);
      this._hidden.forEach((g) => this.map.removeLayer(g));
      this._rLayers = { circles: L.layerGroup().addTo(this.map), glow: L.layerGroup().addTo(this.map), pulse: L.layerGroup() };
      const t0 = evs[0].t; const t1 = Math.max(evs[evs.length - 1].t, t0 + 1);
      const start = performance.now(); let i = 0;
      const step = (now) => {
        const p = Math.min(1, (now - start) / durationMs);
        const tNow = t0 + (t1 - t0) * p;
        while (i < evs.length && evs[i].t <= tNow) {
          this._addEvent(evs[i].e, this._rLayers, { pulse: false });
          this.ripple(evs[i].e);
          i++;
        }
        if (onTick) onTick({ progress: p, time: new Date(tNow) });
        if (p < 1) this._raf = requestAnimationFrame(step);
        else { this._raf = null; if (onEnd) onEnd(); }
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

  window.QuakeMap = QuakeMap;
  window.HeizMapKit = { DEPTH_BANDS, UNKNOWN_DEPTH, band, popupContent };
})();
