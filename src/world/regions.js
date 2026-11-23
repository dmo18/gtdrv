// Miami regions (docs/PLAN_V2.md section 3): the data box split into five
// regions that load one at a time, all in the one coordinate frame of
// docs/MAP.md (x east, z south, meters from lat 25.78, lon -80.18).
// Nothing is re-centered, so saved positions, ids and medals stay valid.
//
// Pure data and helpers: runs in node tests (no DOM, no three.js). The
// data loaders below are dynamic imports, one per region file, so the
// bundler makes one chunk per region and the game fetches only the one
// it plays (still from its own origin: no request leaves the page).
//
// The filter rule used by every placement (garages, adventures, courses,
// routes, secrets, ramps, piers, helipads, service homes): a thing
// belongs to a region when it lies at least PLACE_MARGIN m inside the
// region's crop (garages GARAGE_MARGIN m). The whole box (region null)
// holds everything. Placement code skips what a region does not hold; it
// never throws for it.

// The data box (the bounds of src/world/data/miami.json, whole meters).
// 0.9.0 (docs/PLAN_V3.md 2.1 item 1): the data reaches the Atlantic, so
// only x1 grew (4505 to 6508); the origin, x0, z0 and z1 are as before,
// and so is the raster lattice anchored at (x0, z0) (miami.js
// RASTER_LATTICE): saved positions, ids and placed things keep their
// meaning.
export const BOX = { x0: -4505, z0: -3891, x1: 6508, z1: 3891 };

// The filter margins (PLAN_V2 3.2, 3.5 rule 6).
export const PLACE_MARGIN = 40;
export const GARAGE_MARGIN = 60;
// A start place keeps this far from every region edge (3.3).
export const START_EDGE = 300;

// The region a new game starts in (2.1 item 10, owner decision 1): the
// Beach, on Ocean Drive at 10th Street. CORE_REGION is the
// region that holds the old core crop and its designed first view
// (MIAMI_SPOTS.startView, Southeast 1st Street).
export const DEFAULT_REGION = 'miami-beach';
export const CORE_REGION = 'miami-downtown';

// The map id of the whole box: tests, benches and a development build
// (`?map=miami`); not in the picker.
export const WHOLE_BOX = 'miami';

// Travel links (3.4): at most five a region, each on a named main road
// that crosses the shared edge. (x, z) is a point on the road near the
// crop line; the build snaps it to the cut road end (city.travelPads) and
// the link of the same `id` in region `to` is its twin. `head` (bridges
// and causeways cut over water): the pad stands at the bridge head on
// the last land instead of mid-span.
const L = (id, to, road, x, z) => ({ id, to, road, x, z });

// The five regions. `crop` is exact (3.2); `start` is the region's
// designed start place (a named street, 300 m or more from every edge, a
// long straight with room ahead for the first view's cars). It is the one
// source: the build snaps its spawn to it, world/regioncontent.js
// (REGION_STARTS) re-snaps the same numbers and core/travel.js
// regionStart() hands it to travel. The numbers are the snapped lane
// point itself (to 0.1 m), so the table and the spawn agree (pinned by
// test/regioncontent.test.js). Downtown's is MIAMI_SPOTS.spawn.
// 0.9.0: North, West and South re-snapped (0.4 to 2.0 m) when the lanes
// moved to the road profile (world/roadprofile.js: right-hand lane of the
// real lane count and width, not 2.0 or 2.6 m off the line).
export const REGIONS = [
  {
    id: 'miami-downtown', name: 'Downtown and the Bay', crop: { x0: -2700, z0: -2700, x1: 2450, z1: 1900 },
    start: null, // MIAMI_SPOTS.spawn and startView (Southeast 1st Street)
    links: [
      L('downtown-beach-macarthur', 'miami-beach', 'MacArthur Causeway', 2450, 678),
      L('downtown-north-biscayne', 'miami-north', 'Biscayne Boulevard', -936, -2699),
      L('downtown-north-nw2', 'miami-north', 'Northwest 2nd Avenue', -1923, -2700),
      L('downtown-west-sw8', 'miami-west', 'Southwest 8th Street', -2700, 1555),
      L('downtown-west-flagler', 'miami-west', 'West Flagler Street', -2700, 696),
      L('downtown-south-brickell', 'miami-south', 'Brickell Avenue', -1165, 1900),
      L('downtown-south-miamiave', 'miami-south', 'South Miami Avenue', -1320, 1900),
    ],
  },
  {
    id: 'miami-beach', name: 'Miami Beach and the Islands', crop: { x0: 1400, z0: -3891, x1: 6508, z1: 3891 },
    // Ocean Drive at 10th Street (2.1 item 10), just north of the
    // junction. The plan asks for "facing north, the sea on the right",
    // but the data maps Ocean Drive from 5th to 15th Street as one-way
    // southbound (oneway=yes, 1 lane), so the legal start faces south with
    // Lummus Park and the sea on the left; flip `heading` (to -1.38) only
    // with the owner's word.
    // The numbers are the snapped lane point (test/regioncontent.test.js).
    start: { street: 'Ocean Drive', x: 4957.9, z: -124.5, heading: 1.766 },
    links: [
      L('downtown-beach-macarthur', 'miami-downtown', 'MacArthur Causeway', 1400, 176),
      L('north-beach-tuttle', 'miami-north', 'Julia Tuttle Causeway', 1400, -3392),
    ],
  },
  {
    id: 'miami-north', name: 'Wynwood and the North Side', crop: { x0: -4505, z0: -3891, x1: 1500, z1: -1500 },
    start: { street: 'Northwest 34th Street', x: -2445.8, z: -3146.8, heading: -0.034 },
    links: [
      L('downtown-north-biscayne', 'miami-downtown', 'Biscayne Boulevard', -900, -1507),
      L('downtown-north-nw2', 'miami-downtown', 'Northwest 2nd Avenue', -1886, -1500),
      L('north-beach-tuttle', 'miami-beach', 'Julia Tuttle Causeway', 1500, -3404),
      L('north-west-nw12', 'miami-west', 'Northwest 12th Avenue', -3517, -1500),
    ],
  },
  {
    id: 'miami-west', name: 'Little Havana and Civic Center', crop: { x0: -4505, z0: -1700, x1: -1900, z1: 2050 },
    start: { street: 'Southwest 5th Street', x: -3029.4, z: 1244.9, heading: -0.036 },
    links: [
      L('downtown-west-sw8', 'miami-downtown', 'Southwest 8th Street', -1906, 1529),
      L('downtown-west-flagler', 'miami-downtown', 'West Flagler Street', -1900, 641),
      L('north-west-nw12', 'miami-north', 'Northwest 12th Avenue', -3523, -1700),
      L('west-south-sw12', 'miami-south', 'Southwest 12th Avenue', -3433, 2050),
    ],
  },
  {
    id: 'miami-south', name: 'The Roads and the South Shore', crop: { x0: -4505, z0: 1850, x1: 1400, z1: 3891 },
    start: { street: 'Southwest 1st Avenue', x: -1904.3, z: 2447.2, heading: 2.488 },
    links: [
      L('downtown-south-brickell', 'miami-downtown', 'Brickell Avenue', -1145, 1850),
      L('downtown-south-miamiave', 'miami-downtown', 'South Miami Avenue', -1322, 1850),
      L('west-south-sw12', 'miami-west', 'Southwest 12th Avenue', -3439, 1850),
    ],
  },
];

export const REGION_IDS = REGIONS.map((r) => r.id);

// Region budget (3.2), pinned by test/regions.test.js.
export const REGION_BUDGET = { buildings: 10500, landKm2: 14 };

// The region of an id, or null (the island, the whole box, junk). Pure.
export function regionFor(id) {
  for (let i = 0; i < REGIONS.length; i++) if (REGIONS[i].id === id) return REGIONS[i];
  return null;
}

// The filter rule: (x, z) is at least `margin` m inside the region's
// crop. region: a region object, an id, a city (its `region`), or null
// (the whole box: always true). Edges of the crop that are the data
// box's own edges count too (nothing lies past them).
export function inRegion(region, x, z, margin = PLACE_MARGIN) {
  // A city carries `region` (null for the whole box); a region has
  // `crop`; an id that is no region holds nothing (the whole box's id
  // holds everything).
  if (typeof region === 'string') {
    if (region === WHOLE_BOX) return true;
    region = regionFor(region);
    if (!region) return false;
  }
  const r = region && 'region' in region ? region.region : region;
  if (!r) return true;
  const c = r.crop;
  return x >= c.x0 + margin && x <= c.x1 - margin && z >= c.z0 + margin && z <= c.z1 - margin;
}

// Every point of a list ({x, z} objects) is in the region.
export function holdsAll(region, points, margin = PLACE_MARGIN) {
  for (const p of points) if (!inRegion(region, p.x, p.z, margin)) return false;
  return true;
}

// Every {x, z} point (and every {x0, z0, x1, z1} rect's corners) found
// anywhere in a plain data value (a hand table such as a course spec).
export function pointsIn(value, out = []) {
  if (Array.isArray(value)) {
    for (const v of value) pointsIn(v, out);
  } else if (value && typeof value === 'object') {
    if (typeof value.x === 'number' && typeof value.z === 'number') out.push({ x: value.x, z: value.z });
    if (typeof value.x0 === 'number' && typeof value.z0 === 'number' && typeof value.x1 === 'number' && typeof value.z1 === 'number') {
      out.push({ x: value.x0, z: value.z0 }, { x: value.x1, z: value.z1 });
    }
    for (const k of Object.keys(value)) if (value[k] && typeof value[k] === 'object') pointsIn(value[k], out);
  }
  return out;
}

// The ids of the regions holding (x, z) (default region first where
// regions overlap, then table order).
export function regionsAt(x, z, margin = PLACE_MARGIN) {
  const out = [];
  for (const r of REGIONS) if (inRegion(r, x, z, margin)) out.push(r.id);
  return out;
}

// The region a whole-box position belongs to (rule 3.5.2): Downtown
// where regions overlap; Downtown when there is none.
export function regionOfPoint(x, z, margin = 0) {
  if (!(Number.isFinite(x) && Number.isFinite(z))) return DEFAULT_REGION;
  const ids = regionsAt(x, z, margin);
  return ids.length ? ids[0] : DEFAULT_REGION;
}

// The data of one region, as its own chunk (src/world/data/miami-<id>.json,
// written by scripts/split-map.mjs). One static import() per file, so the
// bundler splits them; resolves to the parsed JSON.
const LOADERS = {
  'miami-downtown': () => import('./data/miami-downtown.json'),
  'miami-beach': () => import('./data/miami-beach.json'),
  'miami-north': () => import('./data/miami-north.json'),
  'miami-west': () => import('./data/miami-west.json'),
  'miami-south': () => import('./data/miami-south.json'),
};
export async function loadRegionData(id) {
  const f = Object.prototype.hasOwnProperty.call(LOADERS, id) ? LOADERS[id] : null;
  if (!f) throw new Error('regions: no data for ' + String(id).slice(0, 40));
  const m = await f();
  return m.default || m;
}

// ---- Fingerprints (test/regions.test.js) ----
// FNV-1a over the exact values: numbers by their 8 bytes, strings by
// their UTF-16 code units, typed arrays by their bytes. Two cities with
// the same fingerprint have the same nodes, edges, buildings, lots and
// lot grid, value for value.
const F64 = new Float64Array(1), U32 = new Uint32Array(F64.buffer);
function mix(h, v) {
  h ^= v & 0xff; h = Math.imul(h, 16777619);
  h ^= (v >>> 8) & 0xff; h = Math.imul(h, 16777619);
  h ^= (v >>> 16) & 0xff; h = Math.imul(h, 16777619);
  h ^= v >>> 24; return Math.imul(h, 16777619);
}
function hashValue(h, v) {
  if (typeof v === 'number') {
    F64[0] = v;
    return mix(mix(mix(h, 1), U32[0]), U32[1]);
  }
  if (typeof v === 'string') {
    h = mix(mix(h, 2), v.length);
    for (let i = 0; i < v.length; i++) h = mix(h, v.charCodeAt(i));
    return h;
  }
  if (typeof v === 'boolean') return mix(h, v ? 3 : 4);
  if (v === null || v === undefined) return mix(h, 5);
  if (ArrayBuffer.isView(v)) {
    const b = new Uint8Array(v.buffer, v.byteOffset, v.byteLength);
    h = mix(mix(h, 6), b.length);
    for (let i = 0; i < b.length; i++) { h ^= b[i]; h = Math.imul(h, 16777619); }
    return h;
  }
  if (Array.isArray(v)) {
    h = mix(mix(h, 7), v.length);
    for (const x of v) h = hashValue(h, x);
    return h;
  }
  if (typeof v === 'object') {
    const keys = Object.keys(v);
    h = mix(mix(h, 8), keys.length);
    for (const k of keys) h = hashValue(hashValue(h, k), v[k]);
    return h;
  }
  return h; // functions are not data
}
const hex = (h) => (h >>> 0).toString(16).padStart(8, '0');

// { nodes, edges, buildings, lots, lotGrid } as hex hashes, plus counts.
export function cityFingerprint(city) {
  const g = city.lotGrid;
  return {
    nodes: hex(hashValue(0x811c9dc5, city.nodes)),
    edges: hex(hashValue(0x811c9dc5, city.edges)),
    buildings: hex(hashValue(0x811c9dc5, city.buildings)),
    lots: hex(hashValue(0x811c9dc5, city.lots)),
    lotGrid: g ? hex(hashValue(hashValue(hashValue(0x811c9dc5, [g.x0, g.z0, g.cell, g.w, g.h]), g.id), g.type)) : '',
    counts: { nodes: city.nodes.length, edges: city.edges.length, buildings: city.buildings.length, lots: city.lots.length },
  };
}
