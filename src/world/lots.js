// Lots: every piece of free land on a real map gets a type and is dressed
// for it (docs/REVAMP.md section 6.2). Pure: no three.js, no DOM, runs in
// node tests. createMiamiCity (world/miami.js) stamps the rasters and calls
// buildLots; the renderer, the collision code and the parking code all
// call dressLot, which is the one dressing function for every lot in the
// box (no core test anywhere in here).
//
// Coordinates: x east, z south, meters. Heading 0 faces +x and grows
// toward +z.
import { createRng, firstNext } from '../core/rng.js';

export const LOT_TYPES = ['yard', 'carpark', 'plaza', 'grass', 'works', 'beach', 'park',
  'wateredge', 'site', 'verge', 'airfield'];

export const FEATURE_KINDS = ['fence', 'hedge', 'wall', 'gate', 'drive', 'bay', 'tree', 'shrub', 'bin',
  'bench', 'planter', 'lamp', 'bollard', 'umbrella', 'stack', 'pallet', 'cabin', 'boat',
  'path', 'sign', 'towel', 'rock', 'pile'];

// `v` of a `tree` feature: the species (renderer models), and of a
// `shrub` the same list (a low version of it).
export const TREE_VARIANTS = ['royalpalm', 'coconut', 'oak', 'seagrape', 'ficus', 'pine', 'mahogany'];

// Start values (6.2); the density tests must still pass when tuned.
export const SHORE_STRIP = 8;
export const BEACH_DEPTH = 30;
export const LOT_REACH = 40;
export const LOT_MAX_AREA = 6400;
export const LOT_MIN_AREA = 100;
export const LOT_MIN_WIDTH = 10;
export const CARPARK_MIN = 600;
// Bays per parking lot (a lot is a part of the land, not all of it).
export const CARPARK_BAYS = 36;
export const CARPARK_BAYS_MAPPED = 72;
// Caps (phone budget).
export const MAX_FEATURES = 24;
export const MAX_PER_HA = 120;
export const MAX_SOLID = 12;

const T = Object.fromEntries(LOT_TYPES.map((t, k) => [t, k]));
const CUT = 80; // world grid that cuts long shore runs and big open pieces

// 32-bit hash of integers (murmur3 finaliser per word).
const hmix = (h, w) => {
  let v = Math.imul(w | 0, 0xcc9e2d51);
  v = (v << 15) | (v >>> 17);
  h ^= Math.imul(v, 0x1b873593);
  h = (h << 13) | (h >>> 19);
  return (Math.imul(h, 5) + 0xe6546b64) | 0;
};
// Four words (the lot seed and infill parcels; no allocation).
export function hash32(a, b = 0, c = 0, d = 0) {
  let h = 0x9e3779b9;
  h = hmix(h, a);
  h = hmix(h, b);
  h = hmix(h, c);
  h = hmix(h, d);
  h ^= 16;
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

export const lotSeed = (citySeed, cx, cz, type) => hash32(citySeed, Math.round(cx / 5), Math.round(cz / 5), T[type]);

// ---------------------------------------------------------------------
// Dressing sets. DRESS[type][district] lists set ids; DRESS_SETS[id]
// holds what the set changes: boundary kind, tree species, furniture
// variant, umbrellas. Every district has its own sets for every type, so
// districts differ in tree species and street furniture as well as in
// building height and lot type.
// ---------------------------------------------------------------------
const DISTRICT_STYLE = {
  // trees: species weights (first is the most common); furn: the bench,
  // bin, lamp, bollard and planter model; bound: boundary kinds by set.
  downtown: { trees: [0, 0, 0, 4], furn: 0, bound: ['wall', 'hedge'], umbrella: true },
  midtown: { trees: [4, 4, 4, 0], furn: 1, bound: ['wall', 'fence'], umbrella: false },
  residential: { trees: [2, 2, 2, 1], furn: 2, bound: ['hedge', 'fence'], umbrella: false },
  industrial: { trees: [5, 5, 5, 3], furn: 3, bound: ['fence', 'wall'], umbrella: false },
  docks: { trees: [3, 3, 3, 1], furn: 4, bound: ['fence', 'wall'], umbrella: false },
  park: { trees: [6, 6, 6, 2], furn: 5, bound: ['hedge', 'fence'], umbrella: false },
  beach: { trees: [1, 1, 1, 0], furn: 6, bound: ['hedge', 'wall'], umbrella: true },
  airfield: { trees: [3, 3, 3, 5], furn: 7, bound: ['fence', 'wall'], umbrella: false },
};
export const DRESS_DISTRICTS = Object.keys(DISTRICT_STYLE);
export const DRESS_SETS = {};
export const DRESS = {};
for (const type of LOT_TYPES) {
  DRESS[type] = {};
  for (const d of DRESS_DISTRICTS) {
    const st = DISTRICT_STYLE[d];
    const ids = [];
    for (let k = 0; k < 2; k++) {
      const id = `${type}-${d}-${'ab'[k]}`;
      // Set b swaps the boundary kind and rotates the tree list, so the two
      // sets of one district look related but not the same.
      const trees = k ? [...st.trees.slice(1), st.trees[0]] : st.trees.slice();
      DRESS_SETS[id] = { id, type, district: d, bound: st.bound[k], trees, furn: st.furn, umbrella: st.umbrella && (type !== 'plaza' || k === 0 || d === 'downtown') };
      ids.push(id);
    }
    DRESS[type][d] = ids;
  }
}
// Beach and water edge trees are coastal whatever the district.
for (const id of Object.keys(DRESS_SETS)) {
  const s = DRESS_SETS[id];
  if (s.type === 'beach') s.trees = [1, 1, 0, 3];
  if (s.type === 'wateredge') s.trees = [1, 3, 1, 3];
}

// ---------------------------------------------------------------------
// Raster helpers (cells of the 5 m land grid).
// ---------------------------------------------------------------------
// 8-connected step distance through pass cells (pass[c] === pv) from
// source cells, up to `max` steps; 255 where not reached. `mode` says what
// a source is: SRC_FLAG src[c] != 0, SRC_ID src[c] >= 0 (an id array),
// SRC_ZERO src[c] == 0 (for a 0/1 array). Only the `n` cells of `list`
// (every pass cell, in row order) are visited at the start, so the cost
// follows the free land, not the raster. `owner` (optional, SRC_ID only)
// gets, per reached cell, the source id it was reached from.
export const SRC_FLAG = 0, SRC_ID = 1, SRC_ZERO = 2;
// The cells of list next to a source (the first of the four sides, then
// the corners), at step 1, queued in list order. Returns the queue length.
function seedSources(W, N, src, pass, pv, sg, bias, dist, owner, queue, list, n) {
  let qt = 0;
  for (let k = 0; k < n; k++) {
    const c = list[k];
    if (pass[c] !== pv) continue;
    const i = c % W;
    const up = c >= W, dn = c < N - W, lf = i > 0, rt = i < W - 1;
    let o = -1;
    if (lf && sg * src[c - 1] + bias >= 0) o = c - 1;
    else if (rt && sg * src[c + 1] + bias >= 0) o = c + 1;
    else if (up && sg * src[c - W] + bias >= 0) o = c - W;
    else if (dn && sg * src[c + W] + bias >= 0) o = c + W;
    else if (up && lf && sg * src[c - W - 1] + bias >= 0) o = c - W - 1;
    else if (up && rt && sg * src[c - W + 1] + bias >= 0) o = c - W + 1;
    else if (dn && lf && sg * src[c + W - 1] + bias >= 0) o = c + W - 1;
    else if (dn && rt && sg * src[c + W + 1] + bias >= 0) o = c + W + 1;
    if (o < 0) continue;
    dist[c] = 1;
    if (owner) owner[c] = src[o];
    queue[qt++] = c;
  }
  return qt;
}
export function stepDistance(W, H, src, pass, max, dist, owner, queue, list, n, mode = SRC_FLAG, pv = 1) {
  dist.fill(255);
  const N = W * H;
  // sg * src + bias >= 0 is the source test for every mode.
  const sg = mode === SRC_ZERO ? -1 : 1, bias = mode === SRC_FLAG ? -1 : 0;
  let qt = seedSources(W, N, src, pass, pv, sg, bias, dist, owner, queue, list, n);
  let qh = 0;
  while (qh < qt) {
    const c = queue[qh++];
    const d = dist[c];
    if (d >= max) continue;
    const nd = d + 1, ow = owner ? owner[c] : 0;
    const i = c % W;
    const up = c >= W, dn = c < N - W, lf = i > 0, rt = i < W - 1;
    let m;
    // The eight neighbors, unrolled.
    if (lf) { m = c - 1; if (dist[m] === 255 && pass[m] === pv) { dist[m] = nd; if (owner) owner[m] = ow; queue[qt++] = m; } }
    if (rt) { m = c + 1; if (dist[m] === 255 && pass[m] === pv) { dist[m] = nd; if (owner) owner[m] = ow; queue[qt++] = m; } }
    if (up) {
      m = c - W; if (dist[m] === 255 && pass[m] === pv) { dist[m] = nd; if (owner) owner[m] = ow; queue[qt++] = m; }
      if (lf) { m = c - W - 1; if (dist[m] === 255 && pass[m] === pv) { dist[m] = nd; if (owner) owner[m] = ow; queue[qt++] = m; } }
      if (rt) { m = c - W + 1; if (dist[m] === 255 && pass[m] === pv) { dist[m] = nd; if (owner) owner[m] = ow; queue[qt++] = m; } }
    }
    if (dn) {
      m = c + W; if (dist[m] === 255 && pass[m] === pv) { dist[m] = nd; if (owner) owner[m] = ow; queue[qt++] = m; }
      if (lf) { m = c + W - 1; if (dist[m] === 255 && pass[m] === pv) { dist[m] = nd; if (owner) owner[m] = ow; queue[qt++] = m; } }
      if (rt) { m = c + W + 1; if (dist[m] === 255 && pass[m] === pv) { dist[m] = nd; if (owner) owner[m] = ow; queue[qt++] = m; } }
    }
  }
}

// ---------------------------------------------------------------------
// Infill. Where the map data has big empty pieces of land in built-up
// districts (port yards, downtown vacant tracts) a plain building box is
// added on a world grid of parcels, so a street there is not a desert.
// Same rule everywhere in the box; parks, grass, beaches, the shore and
// the airfield are never filled, and a seeded share of parcels stays open
// (parking lots and works yards).
// ---------------------------------------------------------------------
const INFILL = {
  docks: { pitch: 34, size: [18, 26], h: [8, 15], keep: 0.9, kind: 'warehouse', osm: ['warehouse', 'industrial', ''] },
  industrial: { pitch: 38, size: [20, 28], h: [7, 13], keep: 0.85, kind: 'warehouse', osm: ['warehouse', 'industrial', ''] },
  downtown: { pitch: 34, size: [17, 25], h: [14, 46], keep: 0.8, kind: 'building', osm: ['parking', 'commercial', 'office', ''] },
  midtown: { pitch: 31, size: [14, 21], h: [9, 26], keep: 0.8, kind: 'building', osm: ['parking', 'commercial', 'retail', ''] },
  residential: { pitch: 26, size: [10, 14], h: [5, 8], keep: 0.6, kind: 'house', osm: ['house'] },
};
export const INFILL_GAP = 3; // cells (15 m) from any existing building

// inp: { W, H, x0, z0, cell, free, bdist, water, mask, districtOf, seed, keep }
// free: 1 for free land; bdist: step distance to a building through free
// land; water: step distance to water; mask: non-zero where never filled
// (park, grass).
// Returns [{ x0, z0, x1, z1, h, district, kind, osm }].
export function planInfill(inp) {
  const { W, H, x0, z0, cell, free, bdist, water, mask } = inp;
  const out = [];
  const gx0 = x0, gz0 = z0, gx1 = x0 + W * cell, gz1 = z0 + H * cell;
  for (const district of Object.keys(INFILL)) {
    const P = INFILL[district];
    const pi0 = Math.floor(gx0 / P.pitch), pi1 = Math.floor(gx1 / P.pitch);
    const pj0 = Math.floor(gz0 / P.pitch), pj1 = Math.floor(gz1 / P.pitch);
    for (let pj = pj0; pj <= pj1; pj++) {
      // Quick reject on the parcel's center cell; the rest (rare) in
      // infillParcel.
      const cz = (pj + 0.5) * P.pitch;
      const cj = Math.floor((cz - z0) / cell);
      if (cj < 0 || cj >= H) continue;
      for (let pi = pi0; pi <= pi1; pi++) {
        const cx = (pi + 0.5) * P.pitch;
        const ci = Math.floor((cx - x0) / cell);
        if (ci < 0 || ci >= W) continue;
        const cc = cj * W + ci;
        if (!free[cc] || mask[cc] || bdist[cc] < INFILL_GAP || water[cc] < 4) continue;
        infillParcel(inp, district, P, pi, pj, cx, cz, out);
      }
    }
  }
  return out;
}
// One parcel that passed the quick reject: its box, if it may be built.
function infillParcel(inp, district, P, pi, pj, cx, cz, out) {
  const { W, H, x0, z0, cell, free, bdist, water, mask, districtOf, seed } = inp;
  const keepOpen = inp.keep || []; // [{ x, z, r }]: hand places stay open
  if (districtOf(cx, cz) !== district) return;
  const h0 = hash32(seed, pi, pj, 77 + P.pitch);
  if ((h0 % 1000) / 1000 >= P.keep) return;
  const r = createRng(h0);
  const sx = r.range(P.size[0], P.size[1]), sz = r.range(P.size[0], P.size[1]);
  const bx0 = cx - sx / 2, bz0 = cz - sz / 2, bx1 = cx + sx / 2, bz1 = cz + sz / 2;
  for (let q = 0; q < keepOpen.length; q++) {
    const k = keepOpen[q];
    if (Math.hypot(Math.max(bx0 - k.x, 0, k.x - bx1), Math.max(bz0 - k.z, 0, k.z - bz1)) < k.r) return;
  }
  // Every cell under the box plus 5 m is free, far enough from the
  // existing buildings and the water, and not in a park.
  const i0 = Math.floor((bx0 - 5 - x0) / cell), i1 = Math.floor((bx1 + 5 - x0) / cell);
  const j0 = Math.floor((bz0 - 5 - z0) / cell), j1 = Math.floor((bz1 + 5 - z0) / cell);
  if (i0 < 0 || j0 < 0 || i1 >= W || j1 >= H) return;
  for (let j = j0; j <= j1; j++) {
    for (let i = i0; i <= i1; i++) {
      const c = j * W + i;
      if (!free[c] || mask[c] || bdist[c] < INFILL_GAP || water[c] < 4) return;
    }
  }
  out.push({
    x0: Math.round(bx0 * 10) / 10, z0: Math.round(bz0 * 10) / 10, x1: Math.round(bx1 * 10) / 10, z1: Math.round(bz1 * 10) / 10,
    h: Math.round(r.range(P.h[0], P.h[1])), district, kind: P.kind, osm: r.pick(P.osm), color: r.next(),
  });
}

// ---------------------------------------------------------------------
// Lots.
// ---------------------------------------------------------------------
// Mapped parking (OSM amenity=parking, garage, garages) makes a parking lot from
// a modest lot; the other kinds of building only get one on a large lot, and
// then only on a third of them (a hash of the building's corner, so the rule
// is a function of its arguments). A building carrying `parking` or
// `amenity: 'parking'` (the map data's own field, once it has one) counts as
// mapped whatever its `osm` says.
const PARKING_MAPPED_OSM = new Set(['parking', 'garage', 'garages']);
const CARPARK_OSM = new Set(['retail', 'commercial', 'hospital', 'school', 'university', 'college', 'train_station']);
const PLAZA_OSM = new Set(['public', 'museum', 'library', 'church', 'cathedral', 'synagogue', 'hotel', 'cruise_terminal']);
const WORKS_STYLE = new Set(['shed', 'hangar', 'container']);
// Free area (m2) a lot needs to be a parking lot of an unmapped kind.
export const CARPARK_BIG = 1800;
export function isMappedParking(b) {
  return !!b && (PARKING_MAPPED_OSM.has(b.osm) || b.parking === true || b.amenity === 'parking');
}
// One in three, by the building's corner.
function oneInThree(b) {
  return ((Math.imul(Math.round(b.x0 * 4) | 0, 73856093) ^ Math.imul(Math.round(b.z0 * 4) | 0, 19349663)) >>> 0) % 3 === 0;
}

// The type rule table (6.2 step 5) for a lot from steps 4c and 4d.
export function lotTypeFor(b, district, free) {
  if (b && b.osm === 'construction') return 'site';
  if (district === 'airfield') return 'airfield';
  if (district === 'industrial' || district === 'docks' || (b && WORKS_STYLE.has(b.style))) return 'works';
  if (isMappedParking(b) && free >= CARPARK_MIN) return 'carpark';
  if (b && CARPARK_OSM.has(b.osm) && free >= CARPARK_BIG && oneInThree(b)) return 'carpark';
  if (b && (b.h >= 30 || PLAZA_OSM.has(b.osm))) return 'plaza';
  if (district === 'residential' || (b && (b.kind === 'house' || (b.h <= 8 && (b.x1 - b.x0) * (b.z1 - b.z0) <= 300)))) return 'yard';
  if ((district === 'downtown' || district === 'midtown') && !b && free >= CARPARK_BIG) return 'carpark';
  if (district === 'downtown' || district === 'midtown') return b ? 'plaza' : 'grass';
  return b ? 'yard' : 'grass';
}

// Distance from segment ab to the axis-aligned rect (0 when they touch).
const segD2 = (px, pz, ax, az, bx, bz) => {
  const dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz;
  let t = L2 > 1e-12 ? ((px - ax) * dx + (pz - az) * dz) / L2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const qx = ax + dx * t - px, qz = az + dz * t - pz;
  return qx * qx + qz * qz;
};
const ptRect2 = (px, pz, x0, z0, x1, z1) => {
  const qx = px < x0 ? x0 - px : px > x1 ? px - x1 : 0, qz = pz < z0 ? z0 - pz : pz > z1 ? pz - z1 : 0;
  return qx * qx + qz * qz;
};
function segRectDist(ax, az, bx, bz, x0, z0, x1, z1) {
  let t0 = 0, t1 = 1, hit = true;
  const dx = bx - ax, dz = bz - az;
  for (let k = 0; k < 4 && hit; k++) {
    const p = k === 0 ? -dx : k === 1 ? dx : k === 2 ? -dz : dz;
    const q = k === 0 ? ax - x0 : k === 1 ? x1 - ax : k === 2 ? az - z0 : z1 - az;
    if (p === 0) { if (q < 0) hit = false; continue; }
    const r = q / p;
    if (p < 0) { if (r > t1) hit = false; else if (r > t0) t0 = r; } else if (r < t0) hit = false; else if (r < t1) t1 = r;
  }
  if (hit && t0 <= t1) return 0;
  const d = Math.min(ptRect2(ax, az, x0, z0, x1, z1), ptRect2(bx, bz, x0, z0, x1, z1), segD2(x0, z0, ax, az, bx, bz),
    segD2(x1, z0, ax, az, bx, bz), segD2(x0, z1, ax, az, bx, bz), segD2(x1, z1, ax, az, bx, bz));
  return Math.sqrt(d);
}

// ---- buildLots steps (small top-level functions: the optimiser takes
// them at once, not the whole of buildLots) ----
function newPiece(tmp, k, building, W, H) {
  tmp.push({ cls: k, building, n: 0, i0: W, i1: -1, j0: H, j1: -1 });
  return tmp.length - 1;
}
function growPiece(p, c, W) {
  const i = c % W, j = (c - i) / W;
  p.n++;
  if (i < p.i0) p.i0 = i;
  if (i > p.i1) p.i1 = i;
  if (j < p.j0) p.j0 = j;
  if (j > p.j1) p.j1 = j;
}
// Flood fill of one piece from cell s: same class, and the same grid
// square when `cut`. Returns the piece id.
function floodPiece(PS, s, k, cut) {
  const { W, N, lid, cls, queue, tmp, colKey, rowKey } = PS;
  const id = newPiece(tmp, k, -1, W, PS.H);
  const p = tmp[id];
  let gk = 0;
  if (cut) { const i = s % W; gk = colKey[i] + rowKey[(s - i) / W]; }
  let qh = 0, qt = 0;
  queue[qt++] = s;
  lid[s] = id;
  while (qh < qt) {
    const c = queue[qh++];
    growPiece(p, c, W);
    const i = c % W;
    for (let q = 0; q < 4; q++) {
      const n = q === 0 ? (i > 0 ? c - 1 : -1) : q === 1 ? (i < W - 1 ? c + 1 : -1) : q === 2 ? c - W : c + W;
      if (n < 0 || n >= N || lid[n] !== -1 || cls[n] !== k) continue;
      if (cut) { const ni = n % W; if (colKey[ni] + rowKey[(n - ni) / W] !== gk) continue; }
      lid[n] = id;
      queue[qt++] = n;
    }
  }
  return id;
}
// Pieces: one lot per building (cells sharing it, connected or not);
// other classes are connected pieces, shore runs cut by the 80 m grid,
// park, grass and open pieces cut by it only when over LOT_MAX_AREA.
function piecesOf(PS, list, nList, own, mainOf, byBuilding, cell) {
  const { W, H, N, lid, cls, queue, tmp } = PS;
  for (let q = 0; q < nList; q++) {
    const c = list[q];
    const k = cls[c];
    if (!k || lid[c] !== -1) continue;
    if (k === 5) {
      const m = mainOf[own[c]];
      let id = byBuilding[m];
      if (id < 0) { id = newPiece(tmp, 5, m, W, H); byBuilding[m] = id; }
      lid[c] = id;
      growPiece(tmp[id], c, W);
      continue;
    }
    const id = floodPiece(PS, c, k, k <= 2);
    if (k >= 3 && tmp[id].n * cell * cell > LOT_MAX_AREA) {
      // Too big: undo and cut it by the world grid.
      let qh = 0, qt = 0;
      queue[qt++] = c;
      lid[c] = -2;
      while (qh < qt) {
        const q2 = queue[qh++];
        const i = q2 % W;
        for (let t = 0; t < 4; t++) {
          const n = t === 0 ? (i > 0 ? q2 - 1 : -1) : t === 1 ? (i < W - 1 ? q2 + 1 : -1) : t === 2 ? q2 - W : q2 + W;
          if (n < 0 || n >= N || lid[n] !== id) continue;
          lid[n] = -2;
          queue[qt++] = n;
        }
      }
      tmp[id].n = 0;
      tmp[id].dead = true;
      // Collect the cells (the queue holds them), then fill each square.
      const cells = queue.slice(0, qt);
      for (let t = 0; t < qt; t++) lid[cells[t]] = -1;
      for (let t = 0; t < qt; t++) if (lid[cells[t]] === -1) floodPiece(PS, cells[t], k, true);
    }
  }
}

// Lot objects from the pieces (tiny or thin pieces become verge).
function lotObjects(city, tmp, remap, lots, G, cell) {
  const B = city.buildings;
  const x0 = G.x0, z0 = G.z0;
  const EN = [];
  const seed = city.seed >>> 0;
  for (let p = 0; p < tmp.length; p++) {
    const P = tmp[p];
    if (P.dead || !P.n) continue;
    const lx0 = x0 + P.i0 * cell, lz0 = z0 + P.j0 * cell, lx1 = x0 + (P.i1 + 1) * cell, lz1 = z0 + (P.j1 + 1) * cell;
    const area = P.n * cell * cell;
    const cx = (lx0 + lx1) / 2, cz = (lz0 + lz1) / 2;
    const district = city.districtOf(cx, cz);
    const b = P.building >= 0 ? B[P.building] : null;
    let type;
    if (area < LOT_MIN_AREA || Math.min(lx1 - lx0, lz1 - lz0) < LOT_MIN_WIDTH) type = 'verge';
    else if (P.cls === 1) type = 'beach';
    else if (P.cls === 2) type = 'wateredge';
    else if (P.cls === 3) type = 'park';
    else if (P.cls === 4) type = 'grass';
    else type = lotTypeFor(b, district, area);
    // A seeded 2 % of the large grass lots are building sites.
    if (type === 'grass' && area >= 1500 && lotSeed(seed, cx, cz, 'grass') % 50 === 0) type = 'site';
    // The lot's road: the nearest edge that touches it.
    let edge = -1, front = 3, ed = Infinity;
    city.edgesNear(cx, cz, Math.hypot(lx1 - lx0, lz1 - lz0) / 2 + 10, EN);
    for (let k = 0; k < EN.length; k++) {
      const e = city.edges[EN[k]];
      const a = city.nodes[e.a], q = city.nodes[e.b];
      const d = segRectDist(a.x, a.z, q.x, q.z, lx0, lz0, lx1, lz1) - e.width / 2;
      if (d < ed) { ed = d; edge = e.id; }
    }
    if (edge >= 0 && ed > 8) edge = -1;
    if (edge >= 0) {
      const e = city.edges[edge], a = city.nodes[e.a], q = city.nodes[e.b];
      // Closest point of the edge to the lot center.
      const dx = q.x - a.x, dz = q.z - a.z, L2 = dx * dx + dz * dz || 1;
      let t = ((cx - a.x) * dx + (cz - a.z) * dz) / L2;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const px = a.x + dx * t - cx, pz = a.z + dz * t - cz;
      // Normalize by the rect's half sizes so a long thin lot faces its side.
      const nx = px / ((lx1 - lx0) / 2 + 1), nz = pz / ((lz1 - lz0) / 2 + 1);
      front = Math.abs(nx) >= Math.abs(nz) ? (nx >= 0 ? 0 : 2) : nz >= 0 ? 1 : 3;
    }
    const lotSeedV = lotSeed(seed, cx, cz, type);
    const sets = DRESS[type][DRESS[type][district] ? district : 'midtown'];
    const id = lots.length;
    remap[p] = id;
    lots.push({
      id, type, x0: lx0, z0: lz0, x1: lx1, z1: lz1, area, district, place: city.placeOf ? city.placeOf(cx, cz) : '',
      seed: lotSeedV, dress: sets[Math.floor(0 + (sets.length - 1 - 0 + 1) * firstNext(lotSeedV))], // createRng(lotSeedV).int(0, sets.length - 1)
      building: b ? P.building : -1, edge, front, core: city.inCore ? city.inCore(cx, cz) : false,
    });
  }
}

// inp (from createMiamiCity): { free, owner, park, inBeach, water, queue,
// list, nList }. park: 1 park or forest, 2 grass, per cell; inBeach(c):
// the cell is in a beach rect; owner: building index per cell (-1 none).
// on the land grid. city needs landGrid, buildings, edges, nodes, seed,
// districtOf, placeOf, edgesNear and inCore. Returns { lots, lotGrid,
// lotAt, lotTypeAt, stats }.
export function buildLots(city, inp) {
  const G = city.landGrid;
  const { w: W, h: H, cell } = G;
  const N = W * H;
  const { free, owner, park, inBeach } = inp;
  const tm = inp.timings || null;
  let t0 = typeof performance !== 'undefined' ? performance.now() : 0;
  const lap = (k) => {
    if (!tm) return;
    const t = performance.now();
    tm[k] = Math.round(t - t0);
    t0 = t;
  };
  const queue = inp.queue || new Int32Array(N);
  // The free cells in row order (every lot cell is one of them).
  let list = inp.list, nList = inp.nList;
  if (!list) {
    list = new Int32Array(N);
    nList = 0;
    for (let c = 0; c < N; c++) if (free[c]) list[nList++] = c;
  }
  // Steps of 5 m to the water.
  let water = inp.water;
  if (!water) {
    water = new Uint8Array(N);
    stepDistance(W, H, G.data, free, 8, water, null, queue, list, nList, SRC_ZERO);
  }
  const stripSteps = Math.ceil(SHORE_STRIP / cell - 0.5); // cells whose center is < 8 m in
  const beachSteps = Math.ceil(BEACH_DEPTH / cell - 0.5);
  // Class per free cell: 1 beach, 2 water edge, 3 park, 4 grass, 5 to a
  // building, 6 open.
  const cls = inp.scratch8 ? inp.scratch8.fill(0) : new Uint8Array(N);
  for (let k = 0; k < nList; k++) {
    const c = list[k];
    const d = water[c];
    if (d <= beachSteps && inBeach && inBeach(c)) cls[c] = 1;
    else if (d <= stripSteps) cls[c] = 2;
    else if (park[c] === 1) cls[c] = 3;
    else if (park[c] === 2) cls[c] = 4;
    else cls[c] = 7; // still to place: 4c or 4d
  }
  // 4c: the nearest building box (main box of its footprint) within reach.
  const own = new Int32Array(N);
  const bd = water; // reused: the water steps are no longer needed
  stepDistance(W, H, owner, cls, Math.floor(LOT_REACH / cell), bd, own, queue, list, nList, SRC_ID, 7);
  for (let k = 0; k < nList; k++) {
    const c = list[k];
    if (cls[c] === 7) cls[c] = bd[c] !== 255 ? 5 : 6;
  }
  lap('lots.classes');
  // Main box of each footprint: the largest box of the same `fp`.
  const B = city.buildings;
  const mainOf = new Int32Array(B.length);
  {
    const best = new Map();
    for (let k = 0; k < B.length; k++) {
      const b = B[k];
      if (b.fp === undefined || b.fp < 0) continue;
      const a = (b.x1 - b.x0) * (b.z1 - b.z0);
      const o = best.get(b.fp);
      if (o === undefined || a > (B[o].x1 - B[o].x0) * (B[o].z1 - B[o].z0)) best.set(b.fp, k);
    }
    for (let k = 0; k < B.length; k++) {
      const b = B[k];
      mainOf[k] = b.fp === undefined || b.fp < 0 ? k : best.get(b.fp);
    }
  }
  // Pieces: one lot per building (cells sharing it, connected or not);
  // other classes are connected pieces, shore runs cut by the 80 m grid,
  // park, grass and open pieces cut by it only when over LOT_MAX_AREA.
  const lid = new Int32Array(N).fill(-1);
  const lots = [];
  const tmp = []; // per raw piece: { cls, building, n, i0, i1, j0, j1 }
  const byBuilding = new Int32Array(B.length).fill(-1); // building -> piece
  // The 80 m world grid square of a cell, as a column part plus a row
  // part (the same key as floor(x / CUT) * 100003 + floor(z / CUT)).
  const colKey = new Float64Array(W), rowKey = new Float64Array(H);
  for (let i = 0; i < W; i++) colKey[i] = Math.floor((G.x0 + (i + 0.5) * cell) / CUT) * 100003;
  for (let j = 0; j < H; j++) rowKey[j] = Math.floor((G.z0 + (j + 0.5) * cell) / CUT);
  const PS = { W, H, N, lid, cls, queue, tmp, colKey, rowKey };
  piecesOf(PS, list, nList, own, mainOf, byBuilding, cell);
  lap('lots.pieces');
  // Lot objects; tiny or thin pieces become verge.
  const remap = new Int32Array(tmp.length).fill(-1);
  lotObjects(city, tmp, remap, lots, G, cell);
  lap('lots.objects');
  const typeGrid = new Uint8Array(N);
  for (let q = 0; q < nList; q++) {
    const c = list[q];
    const p = lid[c];
    if (p < 0) { lid[c] = -1; continue; }
    const id = remap[p];
    lid[c] = id;
    typeGrid[c] = id >= 0 ? T[lots[id].type] + 1 : 0;
  }
  lap('lots.grid');
  const lotGrid = { x0: G.x0, z0: G.z0, cell, w: W, h: H, id: lid, type: typeGrid };
  const cellAt = (x, z) => {
    const i = Math.floor((x - G.x0) / cell), j = Math.floor((z - G.z0) / cell);
    return i < 0 || j < 0 || i >= W || j >= H ? -1 : j * W + i;
  };
  const lotAt = (x, z) => {
    const c = cellAt(x, z);
    return c < 0 || lid[c] < 0 ? null : lots[lid[c]];
  };
  const lotTypeAt = (x, z) => {
    const c = cellAt(x, z);
    return c < 0 || !typeGrid[c] ? '' : LOT_TYPES[typeGrid[c] - 1];
  };
  return { lots, lotGrid, lotAt, lotTypeAt };
}

// ---------------------------------------------------------------------
// dressLot: the features of one lot, from its seed. Pure and
// deterministic; `out` is cleared and filled. Feature = { kind, x, z,
// heading, l, w, h, r, solid, v }.
// ---------------------------------------------------------------------
const MIN_CONTENT = { yard: 6, carpark: 9, plaza: 6, grass: 2, works: 8, beach: 5, park: 5, wateredge: 4, site: 8, verge: 0, airfield: 0 };
const SIDE_HEADING = [Math.PI / 2, 0, Math.PI / 2, 0]; // a run along side s

// The cap on features for a lot: 120 per hectare and 24 per lot, but never
// below what the type's minimum content needs (small yards).
export function featureCap(lot) {
  return Math.min(MAX_FEATURES, Math.max(MIN_CONTENT[lot.type] || 0, Math.floor((lot.area * MAX_PER_HA) / 10000)));
}

const NEAR_B = []; // scratch: building ids round the lot being dressed
// Scratch per feature index of the lot being dressed (put fills it):
// center and radius, 1 for a drive, bay or path, with the cosine and sine
// of its heading and its half length and width.
const F_X = new Float64Array(MAX_FEATURES), F_Z = new Float64Array(MAX_FEATURES), F_R = new Float64Array(MAX_FEATURES);
const F_FLAT = new Uint8Array(MAX_FEATURES);
const F_COS = new Float64Array(MAX_FEATURES), F_SIN = new Float64Array(MAX_FEATURES);
const F_HL = new Float64Array(MAX_FEATURES), F_HW = new Float64Array(MAX_FEATURES);
// Math.hypot(dx, dz) < r (r > 0), with hypot only where the squared sum
// is within rounding of r squared.
function nearer(dx, dz, r) {
  const s = dx * dx + dz * dz, r2 = r * r;
  if (s < r2 * (1 - 1e-9)) return true;
  if (s > r2 * (1 + 1e-9)) return false;
  return Math.hypot(dx, dz) < r;
}
export function dressLot(city, lot, out = []) {
  out.length = 0;
  const G = city.lotGrid;
  if (!G || !lot || lot.type === 'verge' || lot.type === 'airfield') return out;
  const set = DRESS_SETS[lot.dress] || DRESS_SETS[DRESS[lot.type].midtown[0]];
  const rng = createRng(lot.seed);
  const cell = G.cell, W = G.w;
  const id = lot.id;
  const cap = featureCap(lot);
  let solid = 0;
  const garages = city.garages;
  const cellOf = (x, z) => {
    const i = Math.floor((x - G.x0) / cell), j = Math.floor((z - G.z0) / cell);
    return i < 0 || j < 0 || i >= W || j >= G.h ? -1 : j * W + i;
  };
  const inLot = (x, z) => {
    const c = cellOf(x, z);
    return c >= 0 && G.id[c] === id;
  };
  const inGarage = (x, z) => {
    if (!garages || !garages.length) return false;
    for (let k = 0; k < garages.length; k++) {
      const g = garages[k];
      if (g.x0 !== undefined) { if (x >= g.x0 && x <= g.x1 && z >= g.z0 && z <= g.z1) return true; } else if (Math.hypot(x - g.x, z - g.z) < (g.r || 12)) return true;
    }
    return false;
  };
  // Clear of every building box by m (a cell can be partly covered): the
  // boxes round the lot, gathered once.
  const BX = city.buildings;
  let inB = null;
  if (city.buildingsNear) {
    city.buildingsNear(lot.x0 - 4, lot.z0 - 4, lot.x1 + 4, lot.z1 + 4, NEAR_B);
    inB = (x, z, m) => {
      for (let k = 0; k < NEAR_B.length; k++) {
        const q = BX[NEAR_B[k]];
        if (x > q.x0 - m && x < q.x1 + m && z > q.z0 - m && z < q.z1 + m) return true;
      }
      return false;
    };
  } else if (city.inBuilding) inB = city.inBuilding;
  const offBuildings = (x, z, heading, l, w, r) => {
    if (!inB) return true;
    if (r > 0 || (!l && !w)) return !inB(x, z, Math.max(r, 0.3));
    const ca = Math.cos(heading), sa = Math.sin(heading), hl = l / 2, hw = w / 2;
    // Center, the two ends and the four corners.
    if (inB(x, z, 0.2) || inB(x + ca * hl, z + sa * hl, 0.2) || inB(x - ca * hl, z - sa * hl, 0.2)) return false;
    for (let k = 0; k < 4; k++) {
      const u = k & 1 ? hl : -hl, q = k & 2 ? hw : -hw;
      if (inB(x + ca * u - sa * q, z + sa * u + ca * q, 0.1)) return false;
    }
    return true;
  };
  // Adds a feature when its center is in the lot and the caps allow.
  const put = (kind, x0f, z0f, heading, l, w, h, r, isSolid, v) => {
    if (out.length >= cap || (isSolid && solid >= MAX_SOLID)) return false;
    // Rounded to the centimeter first, so the stored point is the tested one.
    const x = Math.round(x0f * 100) / 100, z = Math.round(z0f * 100) / 100;
    if (!inLot(x, z) || inGarage(x, z) || !offBuildings(x, z, heading, l, w, r)) return false;
    const q = out.length;
    out.push({ kind, x, z, heading, l, w, h, r, solid: isSolid, v });
    // What scatter tests against this feature, in flat scratch arrays
    // (out never holds more than cap <= MAX_FEATURES features).
    const flat = kind === 'drive' || kind === 'bay' || kind === 'path';
    F_X[q] = x; F_Z[q] = z; F_R[q] = r; F_FLAT[q] = flat ? 1 : 0;
    if (flat) { F_COS[q] = Math.cos(heading); F_SIN[q] = Math.sin(heading); F_HL[q] = l / 2; F_HW[q] = w / 2; }
    if (isSolid) solid++;
    return true;
  };
  // A box feature that also needs both ends inside the lot.
  const putLong = (kind, x, z, heading, l, w, h, isSolid, v) => {
    const ux = Math.cos(heading) * (l / 2 - 0.3), uz = Math.sin(heading) * (l / 2 - 0.3);
    if (!inLot(x + ux, z + uz) || !inLot(x - ux, z - uz)) return false;
    return put(kind, x, z, heading, l, w, h, 0, isSolid, v);
  };
  const { x0, z0, x1, z1 } = lot;
  const i0 = Math.round((x0 - G.x0) / cell), i1 = Math.round((x1 - G.x0) / cell) - 1;
  const j0 = Math.round((z0 - G.z0) / cell), j1 = Math.round((z1 - G.z0) / cell) - 1;
  // Longest run of lot cells along side s (0 +x, 1 +z, 2 -x, 3 -z), on the
  // outermost row of cells that has one of at least `min` cells. Returns
  // [from, to, fixed] in meters (from..to along the side) or null.
  const RUN = [0, 0, 0];
  const sideRun = (s, min = 2) => {
    const alongX = s === 1 || s === 3;
    const nA = alongX ? i1 - i0 + 1 : j1 - j0 + 1;
    const depthMax = alongX ? j1 - j0 + 1 : i1 - i0 + 1;
    for (let dep = 0; dep < Math.min(depthMax, 4); dep++) {
      let best = 0, bs = 0, run = 0, rs = 0;
      for (let a = 0; a <= nA; a++) {
        let on = false;
        if (a < nA) {
          const i = alongX ? i0 + a : s === 0 ? i1 - dep : i0 + dep;
          const j = alongX ? (s === 1 ? j1 - dep : j0 + dep) : j0 + a;
          on = G.id[j * W + i] === id;
        }
        if (on) { if (!run) rs = a; run++; } else { if (run > best) { best = run; bs = rs; } run = 0; }
      }
      if (best >= min) {
        const base = alongX ? x0 : z0;
        RUN[0] = base + bs * cell;
        RUN[1] = base + (bs + best) * cell;
        // The fixed coordinate: 1 m inside the outer face of that row.
        RUN[2] = s === 0 ? x1 - dep * cell - 1 : s === 1 ? z1 - dep * cell - 1 : s === 2 ? x0 + dep * cell + 1 : z0 + dep * cell + 1;
        return RUN;
      }
    }
    return null;
  };
  const pointOnSide = (s, along, fixed, out2) => {
    if (s === 1 || s === 3) { out2[0] = along; out2[1] = fixed; } else { out2[0] = fixed; out2[1] = along; }
    return out2;
  };
  const P = [0, 0];
  // A boundary segment along side s; `gap` cuts a gate opening in the middle.
  const H_OF = { fence: 1.5, hedge: 1.6, wall: 2.0 };
  const W_OF = { fence: 0.12, hedge: 0.9, wall: 0.3 };
  const boundary = (s, kind, gap = 0, gateKind = '') => {
    const run = sideRun(s);
    if (!run) return 0;
    const [a, b, f] = run;
    const len = b - a - 1;
    if (len < 3) return 0;
    const hd = SIDE_HEADING[s];
    if (!gap) {
      pointOnSide(s, (a + b) / 2, f, P);
      return put(kind, P[0], P[1], hd, len, W_OF[kind], H_OF[kind], 0, true, set.furn) ? 1 : 0;
    }
    const mid = a + 0.5 + len * (0.3 + rng.next() * 0.4);
    let n = 0;
    const l1 = mid - gap / 2 - (a + 0.5), l2 = b - 0.5 - (mid + gap / 2);
    if (l1 > 1) { pointOnSide(s, a + 0.5 + l1 / 2, f, P); if (put(kind, P[0], P[1], hd, l1, W_OF[kind], H_OF[kind], 0, true, set.furn)) n++; }
    if (l2 > 1) { pointOnSide(s, b - 0.5 - l2 / 2, f, P); if (put(kind, P[0], P[1], hd, l2, W_OF[kind], H_OF[kind], 0, true, set.furn)) n++; }
    if (gateKind) { pointOnSide(s, mid, f, P); if (put(gateKind, P[0], P[1], hd, gap, 0.15, 1.6, 0, false, set.furn)) n++; }
    return n;
  };
  const tree = () => set.trees[rng.int(0, set.trees.length - 1)];
  // Random points in the lot, kept `gapM` apart from earlier round solids.
  const scatter = (count, kind, r, h, isSolid, gapM, vFn, margin = 1.5) => {
    let n = 0;
    for (let t = 0; t < count * 8 && n < count; t++) {
      const x = x0 + margin + rng.next() * (x1 - x0 - 2 * margin), z = z0 + margin + rng.next() * (z1 - z0 - 2 * margin);
      let clear = true;
      for (let k = 0, n2 = out.length; k < n2; k++) {
        const fr = F_R[k];
        if (fr > 0 && nearer(F_X[k] - x, F_Z[k] - z, gapM + fr)) { clear = false; break; }
        if (F_FLAT[k]) {
          // Never on a drive, a bay or a path.
          const dx = x - F_X[k], dz = z - F_Z[k], c = F_COS[k], s = F_SIN[k];
          if (Math.abs(dx * c + dz * s) < F_HL[k] + r && Math.abs(-dx * s + dz * c) < F_HW[k] + r) { clear = false; break; }
        }
      }
      // Round solids keep their whole disc in the lot.
      if (!clear || !inLot(x + r, z) || !inLot(x - r, z) || !inLot(x, z + r) || !inLot(x, z - r)) continue;
      if (put(kind, x, z, rng.next() * Math.PI * 2, 0, 0, h, r, isSolid, vFn ? vFn() : set.furn)) n++;
    }
    return n;
  };
  const b = lot.building >= 0 ? city.buildings[lot.building] : null;
  const front = lot.front;
  const back = (front + 2) % 4;
  const sides = [(front + 1) % 4, back, (front + 3) % 4];
  const area = lot.area;
  const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
  // Outward normal of side s.
  const NX = [1, 0, -1, 0], NZ = [0, 1, 0, -1];

  switch (lot.type) {
    case 'yard': {
      // Drive from the road side to the building, beside it if it fills the front.
      if (b) {
        const fx = NX[front], fz = NZ[front];
        const hd = Math.atan2(fz, fx);
        const edgeOut = front === 0 ? x1 : front === 1 ? z1 : front === 2 ? x0 : z0;
        const face = front === 0 ? b.x1 : front === 1 ? b.z1 : front === 2 ? b.x0 : b.z0;
        const across0 = front % 2 ? b.x0 : b.z0, across1 = front % 2 ? b.x1 : b.z1;
        const dl = Math.abs(edgeOut - face);
        const lo = front % 2 ? x0 : z0, hi = front % 2 ? x1 : z1;
        const tries = dl >= 3
          ? [across0 + 2, across1 - 2, (across0 + across1) / 2]
          : [across1 + 2, across0 - 2];
        let done = false;
        for (const t of tries) {
          if (t < lo + 1.5 || t > hi - 1.5) continue;
          const len = dl >= 3 ? dl : Math.min(12, Math.abs(edgeOut - (front % 2 ? (b.z0 + b.z1) / 2 : (b.x0 + b.x1) / 2)));
          if (len < 3) continue;
          const mid = edgeOut - (front === 0 || front === 1 ? 1 : -1) * len / 2;
          const x = front % 2 ? t : mid, z = front % 2 ? mid : t;
          if (put('drive', x, z, hd, len, 3, 0, 0, false, set.furn)) { done = true; break; }
        }
        if (!done) {
          // Small lot: a short drive on the road side of the lot.
          const run = sideRun(front);
          if (run) {
            for (const t of [0.5, 0.25, 0.75, 0.1, 0.9]) {
              pointOnSide(front, run[0] + 1.5 + t * (run[1] - run[0] - 3), run[2] - (front < 2 ? 1.5 : -1.5), P);
              if (put('drive', P[0], P[1], hd, 3, 3, 0, 0, false, set.furn)) break;
            }
          }
        }
      }
      for (const s of sides) boundary(s, set.bound);
      if (lot.seed % 3 === 0 && !scatter(1, 'bin', 0.35, 1.1, false, 1, null, 1)) scatter(1, 'bin', 0.3, 1.1, false, 0.5, null, 0.4);
      const nt = Math.max(1, Math.min(4, Math.round(area / 90)));
      const got = scatter(nt, rng.chance(0.6) ? 'tree' : 'shrub', 1.2, 6, true, 2.5, tree);
      if (!got) scatter(1, 'shrub', 0.6, 1.4, false, 1.5, tree, 0.8);
      break;
    }
    case 'carpark': {
      // Road-side boundary with one entrance gap.
      const bk = set.bound === 'fence' ? 'hedge' : set.bound === 'hedge' ? 'hedge' : 'wall';
      boundary(front, bk, 6, '');
      const nl = Math.min(4, Math.ceil(area / 400));
      const ntr = Math.min(4, Math.ceil(area / 300));
      // Rows parallel to the front: bays 2.5 by 5 m, aisles 6 m.
      const alongX = front === 1 || front === 3;
      const depth0 = front === 0 ? x1 : front === 1 ? z1 : front === 2 ? x0 : z0;
      const sgn = front === 0 || front === 1 ? -1 : 1; // inward
      const span0 = alongX ? x0 : z0, span1 = alongX ? x1 : z1;
      const depthLen = alongX ? z1 - z0 : x1 - x0;
      const reserve = nl + ntr;
      // Rows of bays: one `bay` feature per straight run (heading along the
      // row, l = 2.5 m per bay, w = 5 m deep; the car faces across it).
      const rows = [];
      // A smaller lot: at most CARPARK_BAYS bays (mapped parking gets more).
      const bayMax = isMappedParking(lot.building >= 0 && city.buildings ? city.buildings[lot.building] : null) ? CARPARK_BAYS_MAPPED : CARPARK_BAYS;
      let bayN = 0;
      for (let off = 4.5, row = 0; off < depthLen - 2.5 && bayN < bayMax; row++) {
        const d = depth0 + sgn * off;
        let runA = -1, runN = 0;
        const flush = () => {
          if (runN >= 1 && bayN < bayMax) {
            const n = Math.min(runN, bayMax - bayN);
            rows.push(runA, n, d);
            bayN += n;
          }
          runN = 0;
        };
        for (let a = span0 + 1.25; a <= span1 - 1.25 + 1e-6; a += 2.5) {
          const x = alongX ? a : d, z = alongX ? d : a;
          // The whole bay on the lot: its center and both ends.
          const ex = alongX ? 0 : 2.2, ez = alongX ? 2.2 : 0;
          const ok = inLot(x, z) && inLot(x + ex, z + ez) && inLot(x - ex, z - ez) && (!inB || (!inB(x, z, 1.5) && !inB(x + ex, z + ez, 1.3) && !inB(x - ex, z - ez, 1.3)));
          if (ok && runN < 16) { if (!runN) runA = a; runN++; } else { flush(); if (ok) { runA = a; runN = 1; } }
        }
        flush();
        off += row % 2 === 0 ? 11 : 5; // bay, aisle, bay | bay, aisle, bay
      }
      // Lamps on the aisles and trees or planters at the row ends.
      const aisleOff = 4.5 + 5.5;
      for (let k = 0; k < nl; k++) {
        const a = span0 + ((k + 0.5) / nl) * (span1 - span0);
        const d = depth0 + sgn * Math.min(aisleOff + 16 * (k % 2), depthLen - 2);
        put('lamp', alongX ? a : d, alongX ? d : a, 0, 0, 0, 8, 0.2, true, set.furn);
      }
      let nt = 0;
      for (let k = 0; k < ntr * 3 && nt < ntr; k++) {
        const a = k % 2 ? span0 + 1.5 : span1 - 1.5;
        const d = depth0 + sgn * (4.5 + 16 * Math.floor(k / 2));
        const x = alongX ? a : d, z = alongX ? d : a;
        if (set.district === 'downtown' || set.district === 'midtown' ? put('planter', x, z, 0, 0, 0, 0.9, 0.7, true, set.furn) : put('tree', x, z, 0, 0, 0, 7, 1.0, true, tree())) nt++;
      }
      if (!nt) scatter(1, 'planter', 0.7, 0.9, true, 1.5, null);
      void reserve;
      const rowHead = alongX ? 0 : Math.PI / 2;
      for (let k = 0; k < rows.length; k += 3) {
        const n = rows[k + 1], a = rows[k] + ((n - 1) * 2.5) / 2, d = rows[k + 2];
        put('bay', alongX ? a : d, alongX ? d : a, rowHead, n * 2.5, 5, 0, 0, false, rng.int(0, 3));
      }
      break;
    }
    case 'plaza': {
      // Bollards along the road side.
      const run = sideRun(front);
      if (run) {
        const [a, bb, f] = run;
        const n = Math.max(2, Math.min(3, Math.floor((bb - a) / 4)));
        for (let k = 0; k < n; k++) { pointOnSide(front, a + ((k + 0.5) / n) * (bb - a), f, P); put('bollard', P[0], P[1], 0, 0, 0, 0.9, 0.15, true, set.furn); }
      }
      // One of each first (small plazas), then more by area.
      if (!scatter(1, 'planter', 0.8, 0.8, true, 2, null, 2)) scatter(1, 'planter', 0.6, 0.8, true, 1, null, 0.8);
      if (!scatter(1, 'bench', 0.6, 0.5, false, 2, null, 2)) scatter(1, 'bench', 0.5, 0.5, false, 1, null, 0.8);
      if (!scatter(1, 'tree', 1.0, 8, true, 3, tree, 2)) scatter(1, 'tree', 0.8, 7, true, 2, tree, 1);
      if (set.umbrella && !scatter(1, 'umbrella', 1.4, 2.6, false, 2.5, null, 2.5)) scatter(1, 'umbrella', 1.0, 2.6, false, 1.5, null, 1.2);
      const nt = Math.max(1, Math.min(6, Math.round(area / 150)));
      scatter(nt - 1, 'tree', 1.0, 8, true, 3, tree, 2);
      scatter(Math.min(2, Math.floor(area / 400)), 'planter', 0.8, 0.8, true, 2, null, 2);
      scatter(Math.min(2, Math.floor(area / 500)), 'bench', 0.6, 0.5, false, 2, null, 2);
      if (set.umbrella) scatter(Math.min(2, Math.floor(area / 600)), 'umbrella', 1.4, 2.6, false, 2.5, null, 2.5);
      if (lot.seed % 4 === 0) scatter(1, 'bin', 0.3, 1, false, 1, null, 1.5);
      break;
    }
    case 'grass': {
      if (area > 1500) {
        const alongX = x1 - x0 >= z1 - z0;
        const len = (alongX ? x1 - x0 : z1 - z0) - 4;
        if (!putLong('path', cx, cz, alongX ? 0 : Math.PI / 2, len, 2, 0, false, set.furn)) put('path', cx, cz, alongX ? 0 : Math.PI / 2, Math.min(len, 10), 2, 0, 0, false, set.furn);
      }
      const nt = Math.max(1, Math.min(cap - out.length, Math.round(area / 250)));
      const got = scatter(nt, 'tree', 1.1, 7, true, 3, tree, 1.5);
      if (got < nt) scatter(Math.max(1, nt - got), 'shrub', 0.6, 1.3, false, 1.5, tree, 0.8);
      break;
    }
    case 'works':
    case 'site': {
      const fk = lot.type === 'site' ? 'fence' : set.bound === 'wall' ? 'wall' : 'fence';
      // The gate goes in the front; a front too short for it (a lot in
      // pieces round its building) gives the gate to the longest side.
      let gs = front;
      const runLen = (q) => { const r = sideRun(q); return r ? r[1] - r[0] - 1 : 0; };
      if (runLen(front) < 9) {
        let bl = runLen(front);
        for (const q of sides) { const l = runLen(q); if (l > bl) { bl = l; gs = q; } }
      }
      boundary(gs, fk, 7, 'gate');
      for (const q of [front, ...sides]) if (q !== gs) boundary(q, fk);
      if (lot.type === 'site') {
        scatter(2, 'pile', 2.5, 2.2, true, 3, null, 3);
        scatter(1, 'cabin', 1.6, 2.6, true, 3, null, 3);
        scatter(1, 'stack', 1.4, 2.6, true, 3, null, 3);
        break;
      }
      // A boat on stands by the water.
      if (city.mainShore && (city.mainShore(cx, cz) < 60 || city.mainShore(x0, z0) < 30 || city.mainShore(x1, z1) < 30)) scatter(1, 'boat', 2.2, 3, true, 3, null, 3);
      // Stacks, pallets and cabins to 20 % of the area (within the caps).
      let used = 0;
      for (let t = 0; t < 40 && used < area * 0.2 && out.length < cap; t++) {
        const pick = rng.next();
        if (pick < 0.55) {
          const hd = rng.chance(0.5) ? 0 : Math.PI / 2;
          const x = x0 + 4 + rng.next() * (x1 - x0 - 8), z = z0 + 4 + rng.next() * (z1 - z0 - 8);
          if (clearBox(out, x, z, 7.5)) if (putLong('stack', x, z, hd, 12.2, 2.5, 2.6 * rng.int(1, 3), true, rng.int(0, 5))) used += 30;
        } else if (pick < 0.8) {
          const x = x0 + 2 + rng.next() * (x1 - x0 - 4), z = z0 + 2 + rng.next() * (z1 - z0 - 4);
          if (clearBox(out, x, z, 2) && put('pallet', x, z, rng.next() * 3, 1.2, 1.2, 1, 0, false, rng.int(0, 2))) used += 1.5;
        } else {
          const x = x0 + 4 + rng.next() * (x1 - x0 - 8), z = z0 + 4 + rng.next() * (z1 - z0 - 8);
          if (clearBox(out, x, z, 5) && putLong('cabin', x, z, rng.chance(0.5) ? 0 : Math.PI / 2, 6, 2.5, 2.6, true, set.furn)) used += 15;
        }
      }
      if (!out.some((f) => f.kind === 'stack' || f.kind === 'pallet' || f.kind === 'cabin')) scatter(1, 'pallet', 0.8, 1, false, 1, null, 1);
      scatter(1, 'tree', 1.0, 7, true, 3, tree, 2);
      break;
    }
    case 'beach': {
      // Water side: the side whose outside is lowest on the shore field.
      let ws = 0, wmin = Infinity;
      for (let s = 0; s < 4; s++) {
        const px = s === 0 ? x1 + 3 : s === 2 ? x0 - 3 : cx, pz = s === 1 ? z1 + 3 : s === 3 ? z0 - 3 : cz;
        const v = city.mainShore ? city.mainShore(px, pz) : 0;
        if (v < wmin) { wmin = v; ws = s; }
      }
      const bs = (ws + 2) % 4;
      const run = sideRun(bs);
      const np = Math.max(1, Math.min(6, Math.round(area / 200)));
      if (run) {
        const [a, bb, f] = run;
        for (let k = 0; k < np; k++) {
          pointOnSide(bs, a + ((k + 0.5) / np) * (bb - a), f - (bs < 2 ? 1.5 : -1.5), P);
          put('tree', P[0], P[1], 0, 0, 0, 9, 0.5, true, set.trees[k % set.trees.length]);
        }
      }
      const groups = Math.max(1, Math.min(4, Math.round(area / 300)));
      for (let g = 0; g < groups && out.length < cap - 1; g++) {
        for (let t = 0; t < 10; t++) {
          const x = x0 + 3 + rng.next() * (x1 - x0 - 6), z = z0 + 3 + rng.next() * (z1 - z0 - 6);
          if (!clearBox(out, x, z, 4)) continue;
          if (put('umbrella', x, z, 0, 0, 0, 2.4, 1.3, false, rng.int(0, 5))) {
            const hd = rng.next() * Math.PI * 2;
            put('towel', x + Math.cos(hd) * 1.8, z + Math.sin(hd) * 1.8, hd, 1.8, 0.9, 0.02, 0, false, rng.int(0, 7));
            break;
          }
        }
      }
      break;
    }
    case 'park': {
      const alongX = x1 - x0 >= z1 - z0;
      const len = (alongX ? x1 - x0 : z1 - z0) - 4;
      const hasPath = len > 8 && (putLong('path', cx, cz, alongX ? 0 : Math.PI / 2, len, 2.5, 0, false, set.furn) || put('path', cx, cz, alongX ? 0 : Math.PI / 2, Math.min(len, 10), 2.5, 0, 0, false, set.furn));
      if (hasPath) {
        const nb = Math.max(1, Math.min(3, Math.floor(len / 30)));
        for (let k = 0; k < nb; k++) {
          const a = (alongX ? x0 : z0) + 2 + ((k + 0.5) / nb) * len;
          const x = alongX ? a : cx + 2.2, z = alongX ? cz + 2.2 : a;
          put('bench', x, z, alongX ? 0 : Math.PI / 2, 1.8, 0.6, 0.5, 0, false, set.furn);
        }
        const nl = Math.max(1, Math.min(2, Math.floor(len / 40)));
        for (let k = 0; k < nl; k++) {
          const a = (alongX ? x0 : z0) + 2 + (k / nl) * len + 6;
          put('lamp', alongX ? a : cx - 2.2, alongX ? cz - 2.2 : a, 0, 0, 0, 5, 0.15, true, set.furn);
        }
      }
      const nt = Math.max(1, Math.min(cap - out.length, Math.round(area / 120)));
      const got = scatter(nt, 'tree', 1.2, 9, true, 3.5, tree, 1.5);
      if (got < nt) scatter(Math.min(cap - out.length, nt - got), 'shrub', 0.7, 1.5, false, 2, tree, 0.8);
      break;
    }
    case 'wateredge': {
      // The water side (as for the beach); a cap or rocks along it.
      let ws = 0, wmin = Infinity;
      for (let s = 0; s < 4; s++) {
        const px = s === 0 ? x1 + 3 : s === 2 ? x0 - 3 : cx, pz = s === 1 ? z1 + 3 : s === 3 ? z0 - 3 : cz;
        const v = city.mainShore ? city.mainShore(px, pz) : 0;
        if (v < wmin) { wmin = v; ws = s; }
      }
      const run = sideRun(ws, 2);
      const walled = set.bound !== 'hedge' || lot.district === 'downtown' || lot.district === 'midtown';
      if (run) {
        const [a, bb, f] = run;
        const len = bb - a - 0.5;
        pointOnSide(ws, (a + bb) / 2, f, P);
        if (walled) put('wall', P[0], P[1], SIDE_HEADING[ws], len, 0.6, 0.6, 0, true, set.furn);
        else {
          const nr = Math.max(2, Math.min(5, Math.floor(len / 8)));
          for (let k = 0; k < nr; k++) { pointOnSide(ws, a + ((k + 0.5) / nr) * (bb - a), f, P); put('rock', P[0], P[1], rng.next() * 6, 0, 0, 0.9, 1.1, true, rng.int(0, 3)); }
        }
        // Bollards (or a rail) a little inland, a bench per 40 m.
        const fi = f - (ws < 2 ? 1.8 : -1.8);
        if (walled && rng.chance(0.5)) {
          pointOnSide(ws, (a + bb) / 2, fi, P);
          put('fence', P[0], P[1], SIDE_HEADING[ws], len, 0.08, 1.1, 0, true, set.furn);
        } else {
          const nbol = Math.max(2, Math.min(4, Math.floor(len / 12)));
          for (let k = 0; k < nbol; k++) { pointOnSide(ws, a + ((k + 0.5) / nbol) * (bb - a), fi, P); put('bollard', P[0], P[1], 0, 0, 0, 0.7, 0.2, true, set.furn); }
        }
        const nbe = Math.max(1, Math.floor(len / 40));
        for (let k = 0; k < nbe; k++) {
          pointOnSide(ws, a + ((k + 0.5) / nbe) * (bb - a), f - (ws < 2 ? 3.2 : -3.2), P);
          put('bench', P[0], P[1], SIDE_HEADING[ws], 1.8, 0.6, 0.5, 0, false, set.furn);
        }
      }
      if (area > 300) scatter(1, 'tree', 1, 7, true, 3, tree, 2);
      break;
    }
    default:
      break;
  }
  return out;
}

// True when no box-like feature already in `list` is within r of (x, z).
function clearBox(list, x, z, r) {
  for (let k = 0; k < list.length; k++) {
    const f = list[k];
    const ext = Math.max(f.l, f.w, 2 * f.r) / 2;
    if (Math.abs(f.x - x) < r + ext && Math.abs(f.z - z) < r + ext && f.kind !== 'fence' && f.kind !== 'wall' && f.kind !== 'hedge' && f.kind !== 'gate') return false;
  }
  return true;
}

// Share of lot area by type, over the lots that `keep` accepts.
export function lotShares(lots, keep = () => true) {
  const a = Object.fromEntries(LOT_TYPES.map((t) => [t, 0]));
  let total = 0;
  for (const l of lots) {
    if (!keep(l)) continue;
    a[l.type] += l.area;
    total += l.area;
  }
  for (const t of LOT_TYPES) a[t] = total ? a[t] / total : 0;
  return { share: a, total };
}

// ---- How full a parking lot is ----
// Share of the bays holding a car, by the lot's district and the hour:
// [day, night]. Residential lots fill up at night, the rest empty out. Never
// below 0.2 and never above 0.55 (a lot is never full; the collision world
// of world/collision.js only knows cars up to 0.55).
export const FILL_BY_DISTRICT = {
  downtown: [0.55, 0.2], midtown: [0.5, 0.2], residential: [0.3, 0.55], beach: [0.5, 0.2],
  docks: [0.3, 0.2], industrial: [0.3, 0.2], park: [0.35, 0.2],
};
export const FILL_MIN = 0.2, FILL_MAX = 0.55;
// The fill of lot `lot` at `hour` (0 to 24): the day and night values blended
// by a daylight curve (noon 1, midnight 0), a small seeded offset per lot
// (so two lots never match), clamped to FILL_MIN..FILL_MAX. Hours go by
// half hours, so the cars of a lot appear one at a time as the day goes.
export function lotFill(lot, hour) {
  const f = FILL_BY_DISTRICT[lot.district] || FILL_BY_DISTRICT.midtown;
  const h = Math.floor((((hour % 24) + 24) % 24) * 2) / 2;
  const w = 0.5 + 0.5 * Math.cos(((h - 13) * Math.PI) / 12);
  const jit = (((lot.seed >>> 6) & 255) / 255 - 0.5) * 0.12;
  const v = f[1] + (f[0] - f[1]) * w + jit;
  return v < FILL_MIN ? FILL_MIN : v > FILL_MAX ? FILL_MAX : v;
}

// The single bays of a `bay` feature (a row): calls fn(x, z, heading) per
// bay, heading the way a parked car faces (across the row). The renderer
// splits a row the same way (2.5 m per bay, centered on the feature).
export function eachBay(f, fn) {
  const n = Math.max(1, Math.round(f.l / 2.5));
  const ca = Math.cos(f.heading), sa = Math.sin(f.heading);
  const half = (n * 2.5) / 2;
  for (let s = 0; s < n; s++) {
    const o = -half + (s + 0.5) * 2.5;
    fn(f.x + ca * o, f.z + sa * o, f.heading + Math.PI / 2, s);
  }
}

// ---- Shared dressing cache ----
// One cache per city and dressing function: the lot's features from
// dress(city, lot, []) by lot id, made the first time they are asked for
// and kept for the last DRESS_CACHE_MAX lots asked for (the oldest go
// first; asked for again, a lot is dressed again, to the same features).
// The collision world (world/collision.js) and the renderer read the same
// arrays, so a lot is dressed once whichever asks first. The arrays are
// shared: callers must not change them. Emptied when the city's lot list
// or garages are replaced (the dressing depends on both).
export const DRESS_CACHE_MAX = 4096;
const dressCaches = new WeakMap();
export function lotDressCache(city, dress = dressLot) {
  let byFn = dressCaches.get(city);
  if (!byFn) dressCaches.set(city, (byFn = new Map()));
  let c = byFn.get(dress);
  if (c) return c;
  const map = new Map();
  let lots = city.lots, garages = city.garages;
  const stats = { dressed: 0, hits: 0 };
  c = {
    stats,
    get(lot) {
      if (city.lots !== lots || city.garages !== garages) {
        map.clear();
        lots = city.lots;
        garages = city.garages;
      }
      let f = map.get(lot.id);
      if (f) { stats.hits++; return f; }
      f = [];
      dress(city, lot, f);
      stats.dressed++;
      if (map.size >= DRESS_CACHE_MAX) map.delete(map.keys().next().value);
      map.set(lot.id, f);
      return f;
    },
    size: () => map.size,
  };
  byFn.set(dress, c);
  return c;
}
