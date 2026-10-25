export const DEPTH_BANDS = [
  { max: 30, key: 'shallow', cls: 'd-shallow', color: '#fafa64', label: 'Shallow, under 30 km' },
  { max: 70, key: 'mid', cls: 'd-mid', color: '#f0a04b', label: '30 to 70 km' },
  { max: 150, key: 'deep', cls: 'd-deep', color: '#d9568f', label: '70 to 150 km' },
  { max: Infinity, key: 'vdeep', cls: 'd-vdeep', color: '#8f7bf0', label: 'Deep, over 150 km' },
];
export const UNKNOWN_DEPTH = { key: 'unknown', cls: 'd-unknown', color: '#aab491', label: 'Depth not reported' };
export const band = (depth) => (depth == null ? UNKNOWN_DEPTH : DEPTH_BANDS.find((b) => Number(depth) < b.max));
export const depthKey = (e) => band(e.depth_km).key;
