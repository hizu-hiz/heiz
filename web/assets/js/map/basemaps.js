/* Basemap catalogue. Attribution is shown on the map and repeated in the footer. */
const OSM = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';
const CARTO = OSM + ' &copy; <a href="https://carto.com/attributions">CARTO</a>';

export function makeBasemaps(L) {
  return {
    'Dark, plain': () => L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', { subdomains: 'abcd', maxZoom: 14, attribution: CARTO }),
    'Light, plain': () => L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', { subdomains: 'abcd', maxZoom: 14, attribution: CARTO }),
    'Satellite': () => L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      { maxZoom: 13, attribution: 'Imagery &copy; Esri, Maxar, Earthstar Geographics' }),
    'Terrain': () => L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', { subdomains: 'abc', maxZoom: 13,
      attribution: 'Map data &copy; OpenStreetMap contributors, SRTM | Style &copy; <a href="https://opentopomap.org">OpenTopoMap</a> (CC-BY-SA)' }),
  };
}
