// Which map to play. The procedural island is the default; the real
// Miami map (world/miami.js, in progress, docs/MAP.md) is picked with
// ?map=miami. Pure: runs in node tests.
export const MAP_IDS = ['island', 'miami'];

export function mapFromSearch(search = '') {
  let v;
  try {
    v = new URLSearchParams(search).get('map');
  } catch {
    return 'island';
  }
  return v === 'miami' ? 'miami' : 'island';
}
