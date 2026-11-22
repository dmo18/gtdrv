// Which map to play. The real Miami map (world/miami.js, docs/MAP.md) is
// the default; the procedural island is picked with ?map=island. Pure:
// runs in node tests.
import { DISTRICTS } from './citygen.js';

// The island's name for its coast (the economy's 'shore' flag).
export const SHORE_NAME = 'The Strand';

export const MAP_IDS = ['island', 'miami'];

export const DEFAULT_MAP = 'miami';

// The URL parameter wins (tests and links); otherwise the map the player
// picked in Settings (stored as its own key, see main.js); otherwise Miami.
export const MAP_CHOICE_KEY = 'rustwater.map';

export function mapFromSearch(search = '', stored = null) {
  let v = null;
  try {
    v = new URLSearchParams(search).get('map');
  } catch {
    // unreadable search string: fall through to the stored choice
  }
  if (MAP_IDS.includes(v)) return v;
  return MAP_IDS.includes(stored) ? stored : DEFAULT_MAP;
}

// What the HUD shows for a point: `out.key` is the district key the
// economy's first-visit flags use (`seen_<key>`, 'shore' for the coast),
// `out.name` the text. The island shows its district names (The Strand
// on the shore); a real map shows the real neighbourhood, bridge or
// water name (city.placeOf) and keys 'shore' when out on the water.
// Fills and returns `out` (no allocation: the HUD calls it every frame).
export function hudPlace(city, x, z, out) {
  if (city.placeOf) {
    out.key = city.shoreDist(x, z) < 0 ? 'shore' : city.districtOf(x, z);
    out.name = city.placeOf(x, z);
    return out;
  }
  out.key = city.shoreDist(x, z) < 34 && !city.onRoad(x, z) ? 'shore' : city.districtOf(x, z);
  out.name = out.key === 'shore' ? SHORE_NAME : DISTRICTS[out.key].name;
  return out;
}
