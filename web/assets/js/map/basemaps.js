/* Basemap catalogue. Attribution is shown on the map and repeated in the footer.
   Every tile provider here is free to use with attribution and works without an API key. If tiles cannot be
   fetched at all (blocked network, provider outage), QuakeMap switches to the bundled "Outline (offline)" map. */
const ESRI_ATTR = 'Tiles &copy; Esri &mdash; Esri, DeLorme, NAVTEQ, Maxar, Earthstar Geographics';
const ESRI = 'https://server.arcgisonline.com/ArcGIS/rest/services';
export const OUTLINE_URL = '/assets/data/outline.json';
export const OFFLINE_NAME = 'Outline (offline)';
export const DEFAULT_BASEMAP = 'Dark gray';

/** Bundled country outlines drawn as vector polygons: no network needed after the page itself has loaded. */
function outlineLayer(L) {
  const group = L.layerGroup();
  const paneName = 'outline';
  let loaded = false;
  group.on('add', async () => {
    const map = group._map || null;
    if (map && !map.getPane(paneName)) { map.createPane(paneName).style.zIndex = 250; }   // below overlayPane (400): quake circles always draw on top
    if (loaded) return;
    loaded = true;
    try {
      const data = await (await fetch(OUTLINE_URL, { credentials: 'same-origin' })).json();
      L.geoJSON(data, { pane: paneName, interactive: false, style: { color: '#4b4b86', weight: 1, fillColor: '#1e1e36', fillOpacity: 1 } }).addTo(group);
    } catch { loaded = false; }
  });
  group.options = { attribution: 'Outlines: Natural Earth (public domain)' };
  return group;
}

export function makeBasemaps(L) {
  return {
    'Dark gray': () => L.tileLayer(`${ESRI}/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}`, { maxZoom: 14, maxNativeZoom: 16, attribution: ESRI_ATTR }),
    'Light gray': () => L.tileLayer(`${ESRI}/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}`, { maxZoom: 14, maxNativeZoom: 16, attribution: ESRI_ATTR }),
    'Satellite': () => L.tileLayer(`${ESRI}/World_Imagery/MapServer/tile/{z}/{y}/{x}`, { maxZoom: 13, attribution: 'Imagery &copy; Esri, Maxar, Earthstar Geographics' }),
    'Terrain': () => L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', { subdomains: 'abc', maxZoom: 13,
      attribution: 'Map data &copy; OpenStreetMap contributors, SRTM | Style &copy; <a href="https://opentopomap.org">OpenTopoMap</a> (CC-BY-SA)' }),
    [OFFLINE_NAME]: () => outlineLayer(L),
  };
}
