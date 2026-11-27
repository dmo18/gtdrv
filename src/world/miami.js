// The Miami map: turns the baked OpenStreetMap data (world/data/miami.json,
// see docs/MAP.md) into the same city object generateCity() returns, so
// traffic, police, peds, fleet and the renderer work on real streets.
// Pure data, no drawing: runs in node tests. Builds the whole data box,
// or one region of it (world/regions.js, docs/PLAN_V2.md 3), plus the
// invented airfield islet where the region holds it.
//
// Coordinates: x east, z south, meters, flat ground y = 0.
import { createRng, TAU } from '../core/rng.js';
import { DISTRICTS, STREET_W, lanePoint, laneOffset, SIGNAL } from './citygen.js';
import { roadProfile, pairDivided, harmonizeStreets, divideOf, isLocalClass, PED_STREETS, SIDEWALK_WIDE, GUTTER, PARK_W } from './roadprofile.js';
import { buildRoadGeo, onJunction, curbsAt } from './junctions.js';
import { collapsePairs } from './pairmerge.js';
import { MIAMI_CROP, MIAMI_CORE, LAND_MARGIN, MIAMI_SPOTS, MIAMI_LANDMARKS } from './miami-spots.js';
import { buildLots, planInfill, stepDistance, dressLot, BAYS_ONLY_FAST, bayCount, bayAt, INFILL_GAP, SRC_ID, SRC_ZERO, hash32 } from './lots.js';
import { buildCourses } from './courses.js';
import { placeSecrets } from './secrets.js';
import { placeRamps } from './stunts.js';
import { settleStreetProps } from './streetscape.js';
import { regionFor, inRegion, holdsAll, pointsIn, WHOLE_BOX, BOX, REGIONS } from './regions.js';

export { MIAMI_CROP, MIAMI_CORE, MIAMI_SPOTS };

const CELL = 5; // land raster cell (m)
const CLAMP = 250; // shoreDist is clamped to +-CLAMP m
const SEA_PAD = 260; // raster reaches this far past the land cut (all sea)
// The world lattice of every land raster origin: a multiple of CELL (5 m)
// and of the district (32 m) and place (16 m) rasters, anchored at the
// whole box's origin (BOX x0, z0 less SEA_PAD). See step 1.
export const RASTER_LATTICE = 160;
const RASTER_X0 = BOX.x0 - SEA_PAD, RASTER_Z0 = BOX.z0 - SEA_PAD;
const GRID = 64; // spatial index cell (m)
const MERGE = 12; // junctions closer than this become one
const SNAP = 2.2; // a vertex this close to another road joins it
const CHAIN_TOL = 2.5; // Douglas-Peucker tolerance for bends (m)
const RIVERS = { 'Miami River': 19 }; // carved half widths (m)
const BAY_LIST_MAX = 3; // parking lot bays listed as parking spots, per lot

const DRIVE = new Set([
  'trunk', 'primary', 'secondary', 'tertiary', 'trunk_link', 'primary_link', 'secondary_link',
  'tertiary_link', 'residential', 'unclassified', 'living_street', 'motorway', 'motorway_link',
]);
// A block keeps this ring clear inside its curbs (the widest sidewalk);
// a building outside a block keeps WALK_CLEAR m from the curb.
const WALK_RING = SIDEWALK_WIDE;
const WALK_CLEAR = 1.8;
const SLIVER = 30;
// Lots and infill start this far past the curb (the sidewalk band).
const LOT_SETBACK = 4;
const SETBACK_IN = LOT_SETBACK - 1e-6;
// A data signal or stop sign this close to a junction belongs to it.
const SIGNAL_SNAP = 22;
const HOUSE = new Set(['house', 'detached', 'terrace', 'semidetached_house', 'bungalow']);
const SHED = new Set(['warehouse', 'industrial', 'garages', 'garage', 'service', 'shed']);
const SKIP_BUILDING = new Set(['roof', 'patio']);

const PALETTES = {
  downtown: [0x8fa3b8, 0x6f8196, 0xa9b6c4, 0x57697d, 0xb9c4cc, 0x7a8c8f],
  midtown: [0xb0806a, 0xa89684, 0x8c5f4e, 0xc2ab8f, 0x8a8f96, 0xa66a52],
  residential: [0xe6d9c3, 0xd9b99b, 0xc9d6c2, 0xe3c7b4, 0xbfd0dc, 0xf0e4d0],
  docks: [0x7d8a8c, 0x9a6b4b, 0x6b7780, 0xa8a08f],
  industrial: [0x8c8478, 0x73706c, 0x9c8f7c, 0x6a625a],
  beach: [0xf2e2c4, 0xf5c9a8, 0xa8dcd4, 0xf7efe0, 0xf0b9a0, 0xc8e4f0],
};
const GLASS_TINTS = [0x7fa6cc, 0x6fae9f, 0xb89264, 0x9fb2c4, 0x5f7f9c, 0x86b8c8, 0xa8a090];
const DKEYS = ['midtown', 'downtown', 'residential', 'docks', 'industrial', 'beach', 'airfield', 'park'];

// A street name as a sign plate shows it (the usual short forms).
const SHORT = [
  [/\bNortheast\b/g, 'NE'], [/\bNorthwest\b/g, 'NW'], [/\bSoutheast\b/g, 'SE'], [/\bSouthwest\b/g, 'SW'],
  [/\bNorth\b/g, 'N'], [/\bSouth\b/g, 'S'], [/\bEast\b/g, 'E'], [/\bWest\b/g, 'W'],
  [/\bStreet\b/g, 'St'], [/\bAvenue\b/g, 'Ave'], [/\bBoulevard\b/g, 'Blvd'], [/\bDrive\b/g, 'Dr'], [/\bCourt\b/g, 'Ct'],
  [/\bTerrace\b/g, 'Ter'], [/\bPlace\b/g, 'Pl'], [/\bRoad\b/g, 'Rd'], [/\bCauseway\b/g, 'Cswy'], [/\bParkway\b/g, 'Pkwy'],
];
export function plateText(name) {
  let t = name;
  for (const [re, short] of SHORT) t = t.replace(re, short);
  return t;
}

// Polyline field p: delta-encoded decimeters. Returns meters [x0, z0, x1, z1, ...].
export function decodePolyline(p) {
  const out = new Float64Array(p.length);
  let x = 0, z = 0;
  for (let i = 0; i < p.length; i += 2) {
    x += p[i];
    z += p[i + 1];
    out[i] = x / 10;
    out[i + 1] = z / 10;
  }
  return out;
}

// The derived `avenue` flag of the edge contract: two or more lanes each
// way, or a one-way of three or more.
const isAvenue = (p) => (p.oneway ? p.lanesF >= 3 : Math.min(p.lanesF, p.lanesB) >= 2);

const segDist2 = (px, pz, ax, az, bx, bz) => {
  const dx = bx - ax, dz = bz - az;
  const L2 = dx * dx + dz * dz;
  let t = L2 > 1e-12 ? ((px - ax) * dx + (pz - az) * dz) / L2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const qx = ax + dx * t - px, qz = az + dz * t - pz;
  return qx * qx + qz * qz;
};

// True when segment ab's bounding box is more than h (+ 1e-6 m of
// rounding) from (px, pz) along x or z: then segDist2 > h * h, and the
// callers skip it.
function boxFar(px, pz, ax, az, bx, bz, h) {
  const g = h + 1e-6;
  return (ax < bx ? ax : bx) - px > g || px - (ax > bx ? ax : bx) > g || (az < bz ? az : bz) - pz > g || pz - (az > bz ? az : bz) > g;
}
// Distance from segment ab to the axis-aligned rect (0 when they touch).
const pointRect2 = (px, pz, x0, z0, x1, z1) => {
  const qx = px < x0 ? x0 - px : px > x1 ? px - x1 : 0;
  const qz = pz < z0 ? z0 - pz : pz > z1 ? pz - z1 : 0;
  return qx * qx + qz * qz;
};
// A lower bound of segRectDist: the gap between the segment's bounding
// box and the rect along x or z (0 when they overlap). Callers skip the
// exact distance where this bound, less 1e-6 m of rounding, already
// decides their test.
function rectGap(ax, az, bx, bz, x0, z0, x1, z1) {
  const gx = Math.max((ax < bx ? ax : bx) - x1, x0 - (ax > bx ? ax : bx)), gz = Math.max((az < bz ? az : bz) - z1, z0 - (az > bz ? az : bz));
  return gx > gz ? (gx > 0 ? gx : 0) : gz > 0 ? gz : 0;
}
function segRectDist(ax, az, bx, bz, x0, z0, x1, z1) {
  // Liang-Barsky clip: does the segment touch the rect?
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
  let d = Math.min(pointRect2(ax, az, x0, z0, x1, z1), pointRect2(bx, bz, x0, z0, x1, z1));
  d = Math.min(d, segDist2(x0, z0, ax, az, bx, bz), segDist2(x1, z0, ax, az, bx, bz), segDist2(x0, z1, ax, az, bx, bz), segDist2(x1, z1, ax, az, bx, bz));
  return Math.sqrt(d);
}

// ---------------------------------------------------------------------
// Rasters
// ---------------------------------------------------------------------
function makeRaster(x0, z0, x1, z1, cell) {
  const w = Math.ceil((x1 - x0) / cell), h = Math.ceil((z1 - z0) / cell);
  return { x0, z0, cell, w, h, data: new Uint8Array(w * h) };
}
const cellOf = (R, x, z) => {
  const i = Math.floor((x - R.x0) / R.cell), j = Math.floor((z - R.z0) / R.cell);
  return i < 0 || j < 0 || i >= R.w || j >= R.h ? -1 : j * R.w + i;
};
// cellOf(R, x, z) as a function of (x, z), R's bounds read once.
function cellLookup(R) {
  const x0 = R.x0, z0 = R.z0, cell = R.cell, w = R.w, h = R.h;
  return (x, z) => {
    const i = Math.floor((x - x0) / cell), j = Math.floor((z - z0) / cell);
    return i < 0 || j < 0 || i >= w || j >= h ? -1 : j * w + i;
  };
}
// a[from..to) = v. A short run (most rows of a box or a footprint) as a
// plain loop: TypedArray#fill costs more per call than a few stores.
function fillRun(a, v, from, to) {
  if (to - from > 24) a.fill(v, from, to);
  else for (let c = from; c < to; c++) a[c] = v;
}
// Every cell within r of segment ab gets value v.
function stampCapsule(R, ax, az, bx, bz, r, v) {
  const c = R.cell;
  const i0 = Math.max(0, Math.floor((Math.min(ax, bx) - r - R.x0) / c)), i1 = Math.min(R.w - 1, Math.floor((Math.max(ax, bx) + r - R.x0) / c));
  const j0 = Math.max(0, Math.floor((Math.min(az, bz) - r - R.z0) / c)), j1 = Math.min(R.h - 1, Math.floor((Math.max(az, bz) + r - R.z0) / c));
  const r2 = r * r;
  // The capsule is convex, so its cells in a row are one run: found from
  // both ends with the same test, then filled.
  for (let j = j0; j <= j1; j++) {
    const z = R.z0 + (j + 0.5) * c;
    let a = i0;
    while (a <= i1 && segDist2(R.x0 + (a + 0.5) * c, z, ax, az, bx, bz) > r2) a++;
    if (a > i1) continue;
    let b = i1;
    while (b > a && segDist2(R.x0 + (b + 0.5) * c, z, ax, az, bx, bz) > r2) b--;
    fillRun(R.data, v, j * R.w + a, j * R.w + b + 1);
  }
}
function stampRect(R, x0, z0, x1, z1, v) {
  const c = R.cell;
  const i0 = Math.max(0, Math.ceil((x0 - R.x0) / c - 0.5)), i1 = Math.min(R.w - 1, Math.floor((x1 - R.x0) / c - 0.5));
  const j0 = Math.max(0, Math.ceil((z0 - R.z0) / c - 0.5)), j1 = Math.min(R.h - 1, Math.floor((z1 - R.z0) / c - 0.5));
  for (let j = j0; j <= j1; j++) fillRun(R.data, v, j * R.w + i0, j * R.w + i1 + 1);
}
// Even-odd fill of a closed polygon (pts meters, implicit closing edge).
let POLY_XS = new Float64Array(64); // scratch: the crossings of one row
// The last fillPolygon's written cells: count, then i0, j0, i1, j1 of their box.
const FILL = new Int32Array(5);
function fillPolygon(R, pts, v, spans = false) {
  const n = pts.length / 2;
  let zmin = Infinity, zmax = -Infinity;
  for (let k = 0; k < n; k++) { zmin = Math.min(zmin, pts[2 * k + 1]); zmax = Math.max(zmax, pts[2 * k + 1]); }
  const c = R.cell;
  const j0 = Math.max(0, Math.ceil((zmin - R.z0) / c - 0.5)), j1 = Math.min(R.h - 1, Math.floor((zmax - R.z0) / c - 0.5));
  if (POLY_XS.length < n) POLY_XS = new Float64Array(n * 2);
  const xs = POLY_XS;
  // (The cells written, counted with their bounding box, into FILL.)
  let fn = 0, fi0 = R.w, fi1 = -1, fj0 = R.h, fj1 = -1;
  // (spans: each row's first and last column written, SPAN_L / SPAN_R.)
  if (spans) { SPAN_L.fill(R.w, 0, R.h); SPAN_R.fill(-1, 0, R.h); }
  for (let j = j0; j <= j1; j++) {
    const z = R.z0 + (j + 0.5) * c;
    let nx = 0;
    for (let k = 0; k < n; k++) {
      const ax = pts[2 * k], az = pts[2 * k + 1];
      const b = k + 1 === n ? 0 : k + 1, bx = pts[2 * b], bz = pts[2 * b + 1];
      if ((az <= z) !== (bz <= z)) {
        // Insertion in ascending order (a handful of crossings per row).
        const x = ax + ((z - az) / (bz - az)) * (bx - ax);
        let q = nx++;
        while (q > 0 && xs[q - 1] > x) { xs[q] = xs[q - 1]; q--; }
        xs[q] = x;
      }
    }
    for (let k = 0; k + 1 < nx; k += 2) {
      const i0 = Math.max(0, Math.ceil((xs[k] - R.x0) / c - 0.5)), i1 = Math.min(R.w - 1, Math.floor((xs[k + 1] - R.x0) / c - 0.5));
      if (i1 >= i0) {
        fillRun(R.data, v, j * R.w + i0, j * R.w + i1 + 1);
        if (spans) { if (i0 < SPAN_L[j]) SPAN_L[j] = i0; if (i1 > SPAN_R[j]) SPAN_R[j] = i1; }
        fn += i1 - i0 + 1;
        if (i0 < fi0) fi0 = i0;
        if (i1 > fi1) fi1 = i1;
        if (j < fj0) fj0 = j;
        fj1 = j;
      }
    }
  }
  FILL[0] = fn; FILL[1] = fi0; FILL[2] = fj0; FILL[3] = fi1; FILL[4] = fj1;
}
// 4-connected line of cells (no diagonal leaks for a 4-connected fill).
function stampLine(R, ax, az, bx, bz, v) {
  const L = Math.hypot(bx - ax, bz - az);
  const n = Math.max(1, Math.ceil(L / (R.cell * 0.25)));
  let pi = -1, pj = -1;
  for (let k = 0; k <= n; k++) {
    const x = ax + ((bx - ax) * k) / n, z = az + ((bz - az) * k) / n;
    const i = Math.floor((x - R.x0) / R.cell), j = Math.floor((z - R.z0) / R.cell);
    if (i === pi && j === pj) continue;
    if (pi >= 0 && i !== pi && j !== pj && pi >= 0 && pi < R.w && j >= 0 && j < R.h) R.data[j * R.w + pi] = v;
    if (i >= 0 && j >= 0 && i < R.w && j < R.h) R.data[j * R.w + i] = v;
    pi = i;
    pj = j;
  }
}

// Signed distance (decimeters, Int16) from a land mask: + on land, the
// exact Euclidean distance between cell centers (Felzenszwalb squared
// distance transform of each side) less half a cell, clamped to CLAMP.
// A squared distance of FAR cells or more always clamps, so the column
// pass caps at FAR (squared run length to the nearest cell of the other
// side: one sweep down, then one sweep up fused with the row passes), and
// the row pass builds the lower envelope of the cells under FAR only,
// within `reach` cells of the row's first and last cell of its side,
// skipping cells of the other side inside a run of it (never the
// nearest), and writes the clamp past reach of the outer sources. Each
// skip leaves out only parabolas that are never the minimum under FAR,
// so the field is the full transform's, value for value.
// sdBuf (Uint8) and colBuf (Int16 when FAR < 32768, else Int32), N cells
// each: optional scratch views for the sides and the column pass (every
// cell of both is written before it is read).
function signedField(R, sdBuf = null, colBuf = null) {
  const W = R.w, H = R.h, N = W * H, m = R.data;
  const lim = CLAMP * 10;
  const FAR = (Math.ceil(lim / (10 * R.cell) + 0.5) + 1) ** 2;
  let reach = 0;
  while (reach * reach < FAR) reach++;
  const posOf = new Int16Array(FAR), negOf = new Int16Array(FAR);
  for (let d = 0; d < FAR; d++) {
    const p = Math.round((Math.sqrt(d) - 0.5) * R.cell * 10), q = Math.round(-(Math.sqrt(d) - 0.5) * R.cell * 10);
    posOf[d] = p > lim ? lim : p < -lim ? -lim : p;
    negOf[d] = q > lim ? lim : q < -lim ? -lim : q;
  }
  const sd = sidesOf(m, N, sdBuf);
  const col = colBuf && (FAR < 32768) === (colBuf instanceof Int16Array) ? colBuf : FAR < 32768 ? new Int16Array(N) : new Int32Array(N);
  colUp(sd, col, W, H);
  const out = new Int16Array(N);
  const v = new Int32Array(W), zz = new Float64Array(W + 1), gv = new Float64Array(W);
  const run = new Int32Array(W).fill(-1), side = new Uint8Array(W).fill(2);
  for (let y = H - 1; y >= 0; y--) {
    const row = y * W;
    colDown(sd, col, row, W, FAR, run, side);
    for (let t = 0; t < 2; t++) {
      let a = 0, b = W - 1;
      while (a < W && sd[row + a] !== t) a++;
      if (a === W) continue;
      while (sd[row + b] !== t) b--;
      rowPass(sd, col, out, row, W, t, a, b, reach, FAR, t ? posOf : negOf, t ? lim : -lim, v, zz, gv);
    }
  }
  return out;
}
// The side of each cell (0 water, 1 land).
function sidesOf(m, N, buf) {
  const sd = buf || new Uint8Array(N);
  for (let c = 0; c < N; c++) sd[c] = m[c] ? 1 : 0;
  return sd;
}
function colUp(sd, col, W, H) {
  // rows since the side changed going down (-1: none yet)
  for (let i = 0; i < W; i++) col[i] = -1;
  for (let c = W, N = W * H; c < N; c++) {
    const p = col[c - W];
    col[c] = sd[c] !== sd[c - W] ? 1 : p >= 0 ? p + 1 : -1;
  }
}
function colDown(sd, col, row, W, FAR, run, side) {
  for (let i = 0; i < W; i++) {
    const c = row + i, t = sd[c];
    if (t !== side[i]) { run[i] = side[i] === 2 ? -1 : 0; side[i] = t; }
    if (run[i] >= 0) run[i]++;
    const up = col[c], dn = run[i];
    const r = up < 0 ? dn : dn < 0 ? up : up < dn ? up : dn;
    col[c] = r < 0 || r * r >= FAR ? FAR : r * r;
  }
}
function rowPass(sd, col, out, row, W, t, a, b, reach, FAR, tab, far, v, zz, gv) {
  const x0 = a - reach < 0 ? 0 : a - reach, x1 = b + reach > W - 1 ? W - 1 : b + reach;
  let k = -1;
  for (let x = x0; x <= x1; x++) {
    const c = row + x;
    let g;
    if (sd[c] === t) {
      g = col[c];
      if (g >= FAR) continue;
    } else {
      // A cell of the other side inside a run of its side is never the
      // nearest of them to a cell of this side.
      if (x > 0 && x < W - 1 && sd[c - 1] !== t && sd[c + 1] !== t) continue;
      g = 0;
    }
    const gq = g + x * x;
    let s = -Infinity;
    while (k >= 0) {
      s = (gq - (gv[k] + v[k] * v[k])) / (2 * x - 2 * v[k]);
      if (s > zz[k]) break;
      k--;
    }
    if (k < 0) s = -Infinity;
    k++;
    v[k] = x;
    gv[k] = g;
    zz[k] = s;
  }
  if (k < 0) {
    for (let x = a; x <= b; x++) if (sd[row + x] === t) out[row + x] = far;
    return;
  }
  zz[k + 1] = Infinity;
  // Past reach of the first and last source every distance clamps.
  const lo = v[0] - reach + 1 > a ? v[0] - reach + 1 : a, hi = v[k] + reach - 1 < b ? v[k] + reach - 1 : b;
  for (let x = a; x < lo; x++) if (sd[row + x] === t) out[row + x] = far;
  for (let x = hi + 1; x <= b; x++) if (sd[row + x] === t) out[row + x] = far;
  let e = 0;
  for (let x = lo; x <= hi; x++) {
    const c = row + x;
    if (sd[c] !== t) continue;
    while (zz[e + 1] < x) e++;
    const d = (x - v[e]) * (x - v[e]) + gv[e];
    out[c] = d < FAR ? tab[d] : far;
  }
}

// Bilinear sample of a signed field at cell centers; meters.
function makeSampler(R, f) {
  const { x0, z0, cell, w, h } = R;
  const inv = 1 / cell;
  return (x, z) => {
    const fx = (x - x0) * inv - 0.5, fz = (z - z0) * inv - 0.5;
    if (!(fx >= 0 && fz >= 0 && fx < w - 1 && fz < h - 1)) return -CLAMP;
    const i = fx | 0, j = fz | 0, tx = fx - i, tz = fz - j;
    const k = j * w + i;
    const top = f[k] + (f[k + 1] - f[k]) * tx;
    const bot = f[k + w] + (f[k + w + 1] - f[k + w]) * tx;
    return (top + (bot - top) * tz) * 0.1;
  };
}

// Labels the 4-connected regions of cells where wall is 0 (wall holds
// 0 and 1 only). Returns the count. Regions are numbered in the row order
// of their first cell. Run based: the open runs of each row (found with
// indexOf, native) are joined to the runs they touch in the row above
// (union-find), then each run is filled with its region's label. `runs`
// (makeRuns) keeps the runs, start and end cell and label, for applyVotes.
function makeRuns(cap = 1024) {
  return { n: 0, a: new Int32Array(cap), b: new Int32Array(cap), lab: new Int32Array(cap), up: new Int32Array(cap) };
}
function growRuns(runs) {
  for (const k of ['a', 'b', 'lab', 'up']) {
    const o = runs[k], g = new Int32Array(o.length * 2);
    g.set(o);
    runs[k] = g;
  }
}
// The root of run x (path halving).
function runRoot(up, x) {
  while (up[x] !== x) x = up[x] = up[up[x]];
  return x;
}
function labelRegions(wall, W, H, label, runs) {
  label.fill(-1);
  const nr = wallRuns(wall, W, H, runs);
  runs.n = nr;
  return labelRuns(runs, nr, label);
}
// The open runs of every row, joined to the runs above (one loop per
// function: each is optimized on its own, once).
function wallRuns(wall, W, H, runs) {
  let nr = 0, prev0 = 0;
  for (let j = 0, row = 0; j < H; j++, row += W) {
    const end = row + W, cur0 = nr;
    let c = row;
    while (c < end) {
      const s = wall.indexOf(0, c);
      if (s < 0 || s >= end) break;
      let e = wall.indexOf(1, s);
      if (e < 0 || e > end) e = end;
      if (nr === runs.a.length) growRuns(runs);
      runs.a[nr] = s;
      runs.b[nr] = e;
      runs.up[nr] = nr;
      nr++;
      c = e;
    }
    joinRuns(runs, prev0, cur0, nr, W);
    prev0 = cur0;
  }
  return nr;
}
// Joins the runs of a row (cur0..nr) to the runs above (prev0..cur0) that
// share a column; the smaller run id stays the root, so a region's root is
// its first run.
function joinRuns(runs, prev0, cur0, nr, W) {
  const A = runs.a, B = runs.b, up = runs.up;
  let p = prev0, q = cur0;
  while (p < cur0 && q < nr) {
    const pa = A[p] + W, pb = B[p] + W;
    if (pa < B[q] && A[q] < pb) {
      const x = runRoot(up, p), y = runRoot(up, q);
      if (x < y) up[y] = x; else if (y < x) up[x] = y;
    }
    if (pb < B[q]) p++; else q++;
  }
}
// Labels in run order (a region's first run holds its first cell), filled.
function labelRuns(runs, nr, label) {
  const up = runs.up, lab = runs.lab;
  let n = 0;
  for (let r = 0; r < nr; r++) {
    const x = runRoot(up, r);
    lab[r] = x === r ? n++ : lab[x];
    label.fill(lab[r], runs.a[r], runs.b[r]);
  }
  return n;
}
// Every labeled cell takes its region's vote (land when over 0), run by run.
function applyVotes(runs, votes, data) {
  for (let r = 0; r < runs.n; r++) data.fill(votes[runs.lab[r]] > 0 ? 1 : 0, runs.a[r], runs.b[r]);
}

// Each region's vote from one coast line: +1 per sample on its land side
// (6 m to the left of the line), -1 on its water side. Segments wholly
// outside the raster (x0..bx1, z0..bz1) are skipped.
function voteCoast(pts, R, label, votes, bx1, bz1, hits = null) {
  for (let k = 0; k + 3 < pts.length; k += 2) {
    const ax = pts[k], az = pts[k + 1], bx = pts[k + 2], bz = pts[k + 3];
    const L = Math.hypot(bx - ax, bz - az);
    if (L < 1e-6) continue;
    if ((ax < R.x0 && bx < R.x0) || (ax > bx1 && bx > bx1) || (az < R.z0 && bz < R.z0) || (az > bz1 && bz > bz1)) continue;
    const nx = (bz - az) / L, nz = -(bx - ax) / L; // toward land
    for (let t = 2; t < L; t += 6) {
      const px = ax + ((bx - ax) * t) / L, pz = az + ((bz - az) * t) / L;
      const cl = cellOf(R, px + nx * 6, pz + nz * 6), cw = cellOf(R, px - nx * 6, pz - nz * 6);
      if (cl >= 0 && label[cl] >= 0) votes[label[cl]] += 1;
      if (cw >= 0 && label[cw] >= 0) votes[label[cw]] -= 1;
      if (hits) {
        if (cl >= 0 && label[cl] >= 0) hits[label[cl]] = 1;
        if (cw >= 0 && label[cw] >= 0) hits[label[cw]] = 1;
      }
    }
  }
}

// The whole box's land and sea at COARSE m (coast walls along every
// coastline and the box, regions voted as in step 1). A region build
// asks it for the side of a region that has no coast line inside the
// build window (West: the mainland's shore is 1.2 km east of it), which
// the window alone cannot tell. Cached per data object.
const COARSE = 20;
const coarseCache = new WeakMap();
function coarseLand(data, coast) {
  let R = coarseCache.get(data);
  if (R) return R;
  const b = data.bounds;
  const x0 = Math.ceil(b.minX), z0 = Math.ceil(b.minZ), x1 = Math.floor(b.maxX), z1 = Math.floor(b.maxZ);
  R = makeRaster(x0 - COARSE * 4, z0 - COARSE * 4, x1 + COARSE * 4, z1 + COARSE * 4, COARSE);
  const wall = makeRaster(R.x0, R.z0, R.x0 + R.w * COARSE, R.z0 + R.h * COARSE, COARSE);
  for (const pts of coast) for (let k = 0; k + 3 < pts.length; k += 2) stampLine(wall, pts[k], pts[k + 1], pts[k + 2], pts[k + 3], 1);
  stampLine(wall, x0, z0, x1, z0, 1);
  stampLine(wall, x1, z0, x1, z1, 1);
  stampLine(wall, x1, z1, x0, z1, 1);
  stampLine(wall, x0, z1, x0, z0, 1);
  const NC = R.w * R.h, label = new Int32Array(NC), runs = makeRuns();
  const n = labelRegions(wall.data, R.w, R.h, label, runs);
  const votes = new Float64Array(n);
  for (const pts of coast) voteCoast(pts, R, label, votes, R.x0 + R.w * COARSE, R.z0 + R.h * COARSE);
  applyVotes(runs, votes, R.data);
  settleWalls(wall.data, R.data, R.w, R.h);
  coarseCache.set(data, R);
  return R;
}

// Regions of the fine raster that no coast sample reached and that run
// off the raster's edge take the majority side of the coarse whole-box
// mask over their cells (coarseOf() gives it).
function voteUnreached(R, label, nLab, hits, coarseOf) {
  const W = R.w, H = R.h, NC = W * H;
  const open = new Uint8Array(nLab);
  for (let i = 0; i < W; i++) {
    for (const c of [i, (H - 1) * W + i]) if (label[c] >= 0 && !hits[label[c]]) open[label[c]] = 1;
  }
  for (let j = 0; j < H; j++) {
    for (const c of [j * W, j * W + W - 1]) if (label[c] >= 0 && !hits[label[c]]) open[label[c]] = 1;
  }
  let any = false;
  for (let k = 0; k < nLab; k++) if (open[k]) any = true;
  if (!any) return;
  // The coarse whole-box mask, only built when some region needs it.
  const coarse = coarseOf();
  const score = new Float64Array(nLab);
  for (let c = 0; c < NC; c++) {
    const k = label[c];
    if (k < 0 || !open[k]) continue;
    const i = c % W, j = (c - i) / W;
    const q = cellOf(coarse, R.x0 + (i + 0.5) * R.cell, R.z0 + (j + 0.5) * R.cell);
    score[k] += q >= 0 && coarse.data[q] ? 1 : -1;
  }
  for (let c = 0; c < NC; c++) {
    const k = label[c];
    if (k >= 0 && open[k]) R.data[c] = score[k] > 0 ? 1 : 0;
  }
}

// Coastline wall cells (1) take the majority of their settled neighbors.
// Three passes in cell order over the wall cells only (found with
// indexOf: wall holds 0 and 1 here).
function settleWalls(wall, land, W, H) {
  const NC = W * H;
  let n = 0;
  for (let c = wall.indexOf(1); c >= 0; c = wall.indexOf(1, c + 1)) n++;
  const list = new Int32Array(n);
  for (let c = wall.indexOf(1), k = 0; c >= 0; c = wall.indexOf(1, c + 1)) list[k++] = c;
  for (let pass = 0; pass < 3; pass++) {
    for (let k = 0; k < n; k++) {
      const c = list[k];
      let l = 0, m = 0;
      const i = c % W;
      if (i > 0 && wall[c - 1] !== 1) { m++; l += land[c - 1]; }
      if (i < W - 1 && wall[c + 1] !== 1) { m++; l += land[c + 1]; }
      if (c >= W && wall[c - W] !== 1) { m++; l += land[c - W]; }
      if (c < NC - W && wall[c + W] !== 1) { m++; l += land[c + W]; }
      if (m) {
        land[c] = l * 2 >= m ? 1 : 0;
        wall[c] = 2;
      }
    }
  }
}

// Greedy cover of the 1-cells of a cw x ch mask by up to 6 rectangles
// (largest first, via the histogram method), until 85 % is covered.
// Writes [i0, j0, i1, j1] per rectangle into out; returns the count.
// The pick is the first largest rectangle in scan order (rows, then the
// histogram's pops). Each row keeps its histogram (HIST, row by row) and
// its own first largest (bottom row j: ROW_A area, ROW_I0 and ROW_I1
// columns, ROW_H height); taking a rectangle changes the histograms only
// from its top row down, so the next pass redoes those rows only (the
// earliest row with the largest area is the scan's pick, as before).
// The picks never grow (a later one was all 1-cells for the earlier pass
// too), so once one after the first is under minLater cells, so is every
// later one: the cover stops there (the caller drops pieces that small).
const ROW_A = new Int32Array(201), ROW_I0 = new Int32Array(201), ROW_I1 = new Int32Array(201), ROW_H = new Int32Array(201);
const HIST = new Int32Array(201 * 201), STACK_H = new Int32Array(202);
// Per row of the footprint raster, the first and last column fillPolygon
// wrote (lo > hi: none).
const SPAN_L = new Int32Array(201), SPAN_R = new Int32Array(201);
function largestRects(cells, cw, ch, filled, stack, out, minLater = 0) {
  // filled < 0: the first pass, which reads every cell, counts them.
  let fresh = false;
  if (filled < 0) {
    filled = histRows(cells, cw, ch, 0, stack, 0, -1, ch);
    if (!filled) return 0;
    fresh = true;
  }
  const total = filled;
  let n = 0, from = 0, pi0 = 0, pi1 = -1, pj1 = ch;
  while (n < 6 && filled > total * 0.15) {
    // (No pick can be larger than the cells left: under 4, or under
    // minLater after the first, the pass would stop the cover anyway.)
    if (filled < 4 || (n > 0 && filled < minLater)) break;
    if (!fresh) histRows(cells, cw, ch, from, stack, pi0, pi1, pj1);
    fresh = false;
    let best = 0, bj = 0;
    for (let j = 0; j < ch; j++) if (ROW_A[j] > best) { best = ROW_A[j]; bj = j; }
    if (best < 4 || (n > 0 && best < minLater)) break;
    const bi0 = ROW_I0[bj], bi1 = ROW_I1[bj], bj1 = bj, bj0 = bj - ROW_H[bj] + 1;
    for (let j = bj0; j <= bj1; j++) for (let i = bi0; i <= bi1; i++) cells[j * cw + i] = 2;
    filled -= best;
    out[4 * n] = bi0; out[4 * n + 1] = bj0; out[4 * n + 2] = bi1; out[4 * n + 3] = bj1;
    n++;
    from = bj0; pi0 = bi0; pi1 = bi1; pj1 = bj1;
  }
  return n;
}
// The histograms of rows from..ch-1 (HIST) and their first largest
// rectangles (ROW_*). After a pick of columns i0..i1 down to row j1, a row
// below j1 whose old columns i0..i1 all start below j1 is unchanged, and
// so is every row after it (a column's run there grows from that row's):
// the pass stops there, the rows below keep their values. Returns the
// count of 1-cells in the rows it made.
// Only the columns of each row's span (SPAN_L..SPAN_R, fillPolygon: every
// 1-cell of the row is in it) are swept: outside it a row is all 0 (its
// histogram 0, never stored), and a 0 column only empties the stack,
// with areas of 0 that never beat the row's best.
function histRows(cells, cw, ch, from, stack, i0, i1, j1) {
  const hist = HIST, hs = STACK_H, SL = SPAN_L, SR = SPAN_R;
  let ones = 0;
  for (let j = from; j < ch; j++) {
    const row = j * cw, lo = SL[j], hi = SR[j];
    if (j > j1) {
      let hit = false;
      const a = i0 > lo ? i0 : lo, b = i1 < hi ? i1 : hi;
      for (let i = a; i <= b; i++) if (hist[row + i] > j - j1) { hit = true; break; }
      if (!hit) break;
    }
    // The stack holds each column (stack) with its height (hs); the
    // row's histogram is made in the same sweep.
    // (The row above: its histogram where its span holds the column.)
    const up = j === 0 ? -1 : row - cw, ulo = j === 0 ? 0 : SL[j - 1], uhi = j === 0 ? -1 : SR[j - 1];
    let best = 0, b0 = 0, b1 = 0, bh = 0, sp = 0;
    if (hi >= lo) {
      // (The stack starts as after the 0 column before the span.)
      for (let i = lo; i <= hi + 1; i++) {
        let hh = 0;
        if (i <= hi) {
          if (cells[row + i] === 1) { hh = i < ulo || i > uhi ? 1 : hist[up + i] + 1; ones++; }
          hist[row + i] = hh;
        }
        while (sp > 0 && hs[sp - 1] >= hh) {
          const height = hs[--sp];
          const left = sp > 0 ? stack[sp - 1] + 1 : lo;
          const a = height * (i - left);
          if (a > best) { best = a; b0 = left; b1 = i - 1; bh = height; }
        }
        stack[sp] = i;
        hs[sp++] = hh;
      }
    }
    ROW_A[j] = best; ROW_I0[j] = b0; ROW_I1[j] = b1; ROW_H[j] = bh;
  }
  return ones;
}

// Free lot cells: drawn land (visual 1) off the road strips (near 0) and
// outside every building box (owner < 0). Sets free[c] = 1 and returns
// the free cells in row order, listed in scratch (an Int32Array of NC)
// as they are found and copied out. (Hot loops live in small top-level
// functions: the optimizer takes them at once, not the whole build.)
function freeCells(visual, near, owner, free, NC, scratch) {
  return scratch.slice(0, markFree(visual, near, owner, free, NC, scratch));
}
function markFree(visual, near, owner, free, NC, list) {
  let n = 0;
  for (let c = 0; c < NC; c++) {
    if (visual[c] === 1 && near[c] === 0 && owner[c] < 0) { free[c] = 1; list[n++] = c; }
  }
  return n;
}

// The blocks (blockLab labels on the CELL raster from x0, z0) holding a
// real footprint's box: its center or a corner 0.5 m in. fpBlock[label] = 1.
function markFootprintBlocks(buildings, blockLab, fpBlock, x0, z0, W, H) {
  const mark = (x, z) => {
    const i = Math.floor((x - x0) / CELL), j = Math.floor((z - z0) / CELL);
    const L = i < 0 || j < 0 || i >= W || j >= H ? -1 : blockLab[j * W + i];
    if (L >= 0) fpBlock[L] = 1;
  };
  for (let k = 0; k < buildings.length; k++) {
    const b = buildings[k];
    if (b.fp < 0) continue;
    mark((b.x0 + b.x1) / 2, (b.z0 + b.z1) / 2);
    mark(b.x0 + 0.5, b.z0 + 0.5);
    mark(b.x1 - 0.5, b.z1 - 0.5);
    mark(b.x0 + 0.5, b.z1 - 0.5);
    mark(b.x1 - 0.5, b.z0 + 0.5);
  }
}

// Bounding box and area of a closed polygon: out = [x0, z0, x1, z1, area].
function polyBox(pts, out) {
  const n = pts.length / 2;
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity, area = 0;
  for (let k = 0; k < n; k++) {
    const ax = pts[2 * k], az = pts[2 * k + 1], q = (k + 1) % n;
    x0 = Math.min(x0, ax); x1 = Math.max(x1, ax); z0 = Math.min(z0, az); z1 = Math.max(z1, az);
    area += ax * pts[2 * q + 1] - pts[2 * q] * az;
  }
  out[0] = x0; out[1] = z0; out[2] = x1; out[3] = z1; out[4] = Math.abs(area) / 2;
}

// A footprint rasterised on R (its cells at 2 m, R.data the buffer) and
// covered by largestRects (into rects). Returns the rectangle count (0
// when no cell center is inside the polygon). Pieces after the first under
// minLater cells are left out (the caller would drop them).
function footprintRects(R, pts, stack, rects, minLater = 0) {
  const cw = R.w, ch = R.h, cells = R.data;
  cells.fill(0, 0, cw * ch);
  fillPolygon(R, pts, 1, true);
  // Cells that fill their own bounding box are one rectangle: the cover
  // is that box (largestRects would find it first and stop, 100 %
  // covered; under 4 cells it finds none).
  const n = FILL[0];
  if (n ===(FILL[3] - FILL[1] + 1) * (FILL[4] - FILL[2] + 1)) {
    if (n < 4) return 0;
    rects[0] = FILL[1]; rects[1] = FILL[2]; rects[2] = FILL[3]; rects[3] = FILL[4];
    return 1;
  }
  // (largestRects counts the filled cells in its first pass.)
  return largestRects(cells, cw, ch, -1, stack, rects, minLater);
}

// Building box k on the owner raster (CELL cells from x0, z0): the cells
// whose center is strictly inside the box (as inBuilding); a box too
// small to cover a cell center still holds its own cell.
function stampOwnerBox(owner, b, k, x0, z0, W, H) {
  const e = 1e-6;
  const i0 = Math.max(0, Math.ceil((b.x0 - x0) / CELL - 0.5 + e)), i1 = Math.min(W - 1, Math.floor((b.x1 - x0) / CELL - 0.5 - e));
  const j0 = Math.max(0, Math.ceil((b.z0 - z0) / CELL - 0.5 + e)), j1 = Math.min(H - 1, Math.floor((b.z1 - z0) / CELL - 0.5 - e));
  // (A plain loop: fillRun stays on the Uint8 rasters, one array type.)
  if (i1 >= i0) for (let j = j0; j <= j1; j++) for (let c = j * W + i0, e2 = j * W + i1; c <= e2; c++) owner[c] = k;
  const ci = Math.floor(((b.x0 + b.x1) / 2 - x0) / CELL), cj = Math.floor(((b.z0 + b.z1) / 2 - z0) / CELL);
  const c = ci < 0 || cj < 0 || ci >= W || cj >= H ? -1 : cj * W + ci;
  if (c >= 0 && owner[c] < 0) owner[c] = k;
}

// Indices of the boxes (not the depot's) whose center is within r of (x, z).
function boxesWithin(boxes, x, z, r) {
  const out = [];
  for (let k = 0; k < boxes.length; k++) {
    const b = boxes[k];
    const dx = (b.x0 + b.x1) / 2 - x, dz = (b.z0 + b.z1) / 2 - z;
    // hypot is at least |dx| and |dz|: the far ones are skipped first.
    if (b.depot || dx > r || dx < -r || dz > r || dz < -r || Math.hypot(dx, dz) > r) continue;
    out.push(k);
  }
  return out;
}
// True when every cell of i0..i1 x j0..j1 is inside the W x H raster and set.
function allSet(a, W, H, i0, i1, j0, j1) {
  if (!(i0 >= 0 && j0 >= 0 && i1 < W && j1 < H)) return false;
  for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) if (!a[j * W + i]) return false;
  return true;
}
// Cells of the rect held by a building (owner >= 0) are no longer free.
function clearOwned(free, owner, W, i0, i1, j0, j1) {
  for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) if (owner[j * W + i] >= 0) free[j * W + i] = 0;
}
// Drops the cells of list[0..n) that are no longer free; returns the count.
function keepFree(list, n, free) {
  let m = 0;
  for (let k = 0; k < n; k++) if (free[list[k]]) list[m++] = list[k];
  return m;
}

// The raster kernels on small mixed rasters at load (WARM_RUNS times:
// V8 keeps type feedback for a function only from about its eighth
// call). The build's first calls are long single loops, so the code
// optimized inside them lacked the feedback of paths not yet taken and of
// the code after the loop, bailed out and was compiled again (before
// 0.9.0 the block flood fill did so at the end of every region after the
// first large one, 80 times a build). The rasters' origin is fractional, so raster
// objects start with float fields and keep one shape (an origin that
// turned float later changed the shape under code already optimized).
// Nothing here is kept; it costs well under a millisecond.
const WARM_RUNS = 10;
(function warmKernels() {
  for (let k = 0; k < WARM_RUNS; k++) {
    floodRegions(3, 0, 2, 0, 2, Uint8Array.of(1, 1, 0, 1, 1, 0, 0, 0, 1), new Uint8Array(9), Uint8Array.of(1, 0, 0, 0, 0, 0, 0, 0, 0), new Int32Array(9).fill(-1), makeRuns(1));
    const R = makeRaster(0.5, 0.5, 60.5, 60.5, 5), wall = makeRaster(0.5, 0.5, 60.5, 60.5, 5);
    stampCapsule(R, 10, 10, 40, 30, 8, 1);
    stampRect(R, 30, 35, 55, 55, 1);
    fillPolygon(R, Float64Array.of(5, 40, 25, 40, 20, 58), 1);
    stampLine(R, 2, 2, 58, 20, 0);
    signedField(R);
    stampLine(wall, 0, 30, 60, 30, 1);
    stampLine(wall, 30, 0, 30, 60, 1);
    const runs = makeRuns(1); // (so the warm-up grows it too)
    labelRegions(wall.data, R.w, R.h, new Int32Array(R.w * R.h), runs);
    applyVotes(runs, new Float64Array(runs.n).fill(1), R.data);
    settleWalls(wall.data, R.data, R.w, R.h);
  }
})();

// The road-free land regions (land 1, road 0) of the crop window
// ci0..ci1, cj0..cj1, 4-connected inside it, in the row order of their
// first cell s: lab gets s on every cell of the region. Returns an
// Int32Array of 7 values per region: [cells, i0, i1, j0, j1, park cells,
// 1 if it stays clear of the window edge]. Run based, as labelRegions
// (the runs of a row joined to the runs they touch in the row above; a
// region's root is its first run, whose first cell is s).
function floodRegions(W, ci0, ci1, cj0, cj1, land, road, park, lab, runs) {
  const nr = blockRuns(W, ci0, ci1, cj0, cj1, land, road, runs);
  return blockStats(W, ci0, ci1, cj0, cj1, park, lab, runs, nr);
}
function blockRuns(W, ci0, ci1, cj0, cj1, land, road, runs) {
  let nr = 0, prev0 = 0;
  for (let j = cj0; j <= cj1; j++) {
    const row = j * W, cur0 = nr;
    let i = ci0;
    while (i <= ci1) {
      if (land[row + i] !== 1 || road[row + i] !== 0) { i++; continue; }
      const st = i;
      while (i <= ci1 && land[row + i] === 1 && road[row + i] === 0) i++;
      if (nr === runs.a.length) growRuns(runs);
      runs.a[nr] = row + st;
      runs.b[nr] = row + i;
      runs.up[nr] = nr;
      nr++;
    }
    joinRuns(runs, prev0, cur0, nr, W);
    prev0 = cur0;
  }
  return nr;
}
// Regions in root order (the order of their first cells), with their
// stats; lab gets each region's first cell.
function blockStats(W, ci0, ci1, cj0, cj1, park, lab, runs, nr) {
  const up = runs.up, reg = runs.lab, A = runs.a, B = runs.b;
  let out = new Int32Array(7 * 4096), n = 0;
  for (let r = 0; r < nr; r++) {
    const x = runRoot(up, r);
    if (x === r) {
      if (n + 7 > out.length) { const o = new Int32Array(out.length * 2); o.set(out); out = o; }
      const c = A[r], ci = c % W, cj = (c - ci) / W;
      reg[r] = n;
      out[n] = 0; out[n + 1] = ci; out[n + 2] = ci; out[n + 3] = cj; out[n + 4] = cj; out[n + 5] = 0; out[n + 6] = 1;
      n += 7;
    } else reg[r] = reg[x];
    const k = reg[r], s = A[x], a = A[r], b = B[r];
    const ai = a % W, j = (a - ai) / W, bi = ai + (b - a) - 1;
    out[k] += b - a;
    if (ai < out[k + 1]) out[k + 1] = ai;
    if (bi > out[k + 2]) out[k + 2] = bi;
    if (j > out[k + 4]) out[k + 4] = j;
    let parks = 0;
    for (let c = a; c < b; c++) if (park[c]) parks++;
    out[k + 5] += parks;
    if (ai <= ci0 || bi >= ci1 || j <= cj0 || j >= cj1) out[k + 6] = 0;
    lab.fill(s, a, b);
  }
  return out.subarray(0, n);
}

// ---------------------------------------------------------------------
// The road graph (createMiamiCity stage 2), as small module functions:
// typed arrays and index lists instead of maps keyed by large numbers,
// so every loop runs optimized and the stage allocates little.
// ---------------------------------------------------------------------
const GROW_I32 = (a, n) => {
  if (n <= a.length) return a;
  const b = new Int32Array(Math.max(n, a.length * 2));
  b.set(a);
  return b;
};
const GROW_F64 = (a, n) => {
  if (n <= a.length) return a;
  const b = new Float64Array(Math.max(n, a.length * 2));
  b.set(a);
  return b;
};

// Reads the drivable ways of the data inside the crop into R: R.ways
// (one info object per data way, shared by its runs), R.wayS / R.wayE
// (each run's coordinate range in R.P, of R.np used), R.cuts (where a
// run leaves the crop: x, z, unit direction out, run index).
function readWays(data, S, crop, landCell, coastLand, baseLand) {
  const R = {
    crop, landCell, coastLand, baseLand, districts: S.districts, curb: bothCurbs(S),
    popts: { district: '', curbParking: false }, classIds: new Map(), profiles: new Map(),
    ways: [], wayS: [], wayE: [], P: new Float64Array(1 << 16), np: 0, cuts: [],
    // decodePolyline's output for one road, reused (pts[0, m)).
    pts: new Float64Array(4096),
    // At-grade freeway ramps left out by readRoad, for keepJoinedRamps.
    ramps: [],
  };
  const roads = data.roads;
  for (let k = 0; k < roads.length; k++) readRoad(R, roads[k], false);
  keepJoinedRamps(R);
  return R;
}
// An at-grade ramp (motorway_link) between dropped flyovers is left out
// with them, but some are how the streets get on and off a kept water
// crossing (Biscayne Boulevard onto the eastbound MacArthur Causeway:
// without its two ramps that carriageway, Watson Island and the islands
// past it could be left but never reached by a legal route). Ramps that
// touch end to end make a group; a group is kept (in data order) when
// every end of it meets another ramp of the group or a road that is kept
// and goes on there: within RAMP_JOIN m of the inside of one of its
// segments (1 m or more from that road's own ends), of the end of a
// plain road (not a bridge, not a ramp) or of the ends of two roads, and
// one end of it merges into a kept freeway past its ends (an on or off
// ramp of a crossing). So a kept ramp does not end at the loose end of a
// flyover stub, nor join one freeway stub to another.
const RAMP_JOIN = 2.2;
function keepJoinedRamps(R) {
  const list = R.ramps, n = list.length;
  if (!n) return;
  const pts = [];
  for (let i = 0; i < n; i++) pts.push(decodePolyline(list[i].p));
  // Groups of ramps that touch (union-find).
  const up = new Int32Array(n);
  for (let i = 0; i < n; i++) up[i] = i;
  const touch = new Uint8Array(n * 2); // end 0 / 1 of ramp i meets another ramp
  // (Each ramp's box: an end more than RAMP_JOIN outside it is near no
  // segment of it.)
  const rbox = new Float64Array(4 * n);
  for (let j = 0; j < n; j++) ptsBox(pts[j], 0, pts[j].length, rbox, 4 * j);
  for (let i = 0; i < n; i++) {
    for (let e = 0; e < 2; e++) {
      const P = pts[i], q = e ? P.length - 2 : 0;
      const x = P[q], z = P[q + 1];
      for (let j = 0; j < n; j++) {
        if (x < rbox[4 * j] - RAMP_JOIN || x > rbox[4 * j + 2] + RAMP_JOIN || z < rbox[4 * j + 1] - RAMP_JOIN || z > rbox[4 * j + 3] + RAMP_JOIN) continue;
        if (j === i || !nearLine(pts[j], 0, pts[j].length, P[q], P[q + 1], -1)) continue;
        touch[i * 2 + e] = 1;
        const ra = findRoot(up, i), rb = findRoot(up, j);
        if (ra !== rb) up[ra] = rb;
      }
    }
  }
  // Ends that hang loose (no ramp, no kept road going on) keep their group
  // out; so does a group that merges into no kept freeway.
  const bad = new Uint8Array(n), onto = new Uint8Array(n);
  const WG = wayGrid(R);
  for (let i = 0; i < n; i++) {
    for (let e = 0; e < 2; e++) {
      if (touch[i * 2 + e]) continue;
      const P = pts[i], q = e ? P.length - 2 : 0;
      const m = meetsWay(R, P[q], P[q + 1], WG);
      if (!m) bad[findRoot(up, i)] = 1;
      else if (m === 2) onto[findRoot(up, i)] = 1;
    }
  }
  // A group is kept whole or not at all: if readRoad rejects any member
  // (not drivable, outside the crop, cut to nothing), the members read so
  // far are taken back, since a kept part would end at a dead end.
  const done = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const g = findRoot(up, i);
    if (done[g]) continue;
    done[g] = 1;
    if (bad[g] || !onto[g]) continue;
    const w0 = R.ways.length, np0 = R.np, c0 = R.cuts.length;
    let ok = true;
    for (let j = i; j < n && ok; j++) if (findRoot(up, j) === g) ok = readRoad(R, list[j], true);
    if (!ok) {
      R.ways.length = R.wayS.length = R.wayE.length = w0;
      R.np = np0;
      R.cuts.length = c0;
    }
  }
}
// True when (x, z) is within RAMP_JOIN of a segment of P (flat x, z pairs)
// from k0 to k1; with skip >= 0, not within skip m of P's own two ends.
function nearLine(P, k0, k1, x, z, skip) {
  const r2 = RAMP_JOIN * RAMP_JOIN;
  if (skip >= 0) {
    const s2 = skip * skip;
    if ((x - P[k0]) ** 2 + (z - P[k0 + 1]) ** 2 < s2 || (x - P[k1 - 2]) ** 2 + (z - P[k1 - 1]) ** 2 < s2) return false;
  }
  for (let k = k0; k + 3 < k1; k += 2) {
    const ax = P[k], az = P[k + 1], bx = P[k + 2], bz = P[k + 3];
    if (x < Math.min(ax, bx) - RAMP_JOIN || x > Math.max(ax, bx) + RAMP_JOIN || z < Math.min(az, bz) - RAMP_JOIN || z > Math.max(az, bz) + RAMP_JOIN) continue;
    if (segDist2(x, z, ax, az, bx, bz) <= r2) return true;
  }
  return false;
}
// Whether a road read so far goes on at (x, z) (see keepJoinedRamps):
// 0 no, 1 yes, 2 yes and it is a freeway (motorway or trunk) going on past
// the point (the ramp merges into it or leaves it there).
// (WG: wayGrid. Only the runs listed in the point's cell can be within
// RAMP_JOIN of it; the answer does not depend on the order they are
// asked in: 2 when any is a freeway the point lies along, else 1 when
// any rule below holds, else 0.)
function meetsWay(R, x, z, WG) {
  let ends = 0, got = 0;
  const ci = Math.floor((x - WG.x0) / WAY_CELL), cj = Math.floor((z - WG.z0) / WAY_CELL);
  if (ci < 0 || cj < 0 || ci >= WG.gw || cj >= WG.gh) return 0;
  const c = cj * WG.gw + ci, box = WG.box;
  for (let t = WG.start[c]; t < WG.start[c + 1]; t++) {
    const w = WG.items[t], o = 4 * w;
    if (x < box[o] - RAMP_JOIN || x > box[o + 2] + RAMP_JOIN || z < box[o + 1] - RAMP_JOIN || z > box[o + 3] + RAMP_JOIN) continue;
    const k0 = R.wayS[w], k1 = R.wayE[w], info = R.ways[w];
    if (nearLine(R.P, k0, k1, x, z, 1)) {
      if (info.cls === 'motorway' || info.cls === 'trunk') return 2;
      got = 1;
      continue;
    }
    if (got || !nearLine(R.P, k0, k1, x, z, -1)) continue;
    // At its end: a plain road goes on from there; a bridge or another
    // ramp may itself hang loose (a stub of a dropped flyover).
    if ((!info.bridge && info.cls !== 'motorway_link') || ++ends >= 2) got = 1;
  }
  return got;
}

// The bounding box (x0, z0, x1, z1) of points k0..k1 of P into out at o.
function ptsBox(P, k0, k1, out, o) {
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
  for (let k = k0; k + 1 < k1; k += 2) {
    const x = P[k], z = P[k + 1];
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (z < z0) z0 = z;
    if (z > z1) z1 = z;
  }
  out[o] = x0; out[o + 1] = z0; out[o + 2] = x1; out[o + 3] = z1;
}
// The runs read so far by WAY_CELL m cell of their boxes grown by
// RAMP_JOIN: { box, x0, z0, gw, gh, start, items } (cell c lists
// items[start[c]] .. items[start[c + 1] - 1]).
const WAY_CELL = 200;
function wayGrid(R) {
  const n = R.ways.length, box = new Float64Array(4 * n);
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
  for (let w = 0; w < n; w++) {
    ptsBox(R.P, R.wayS[w], R.wayE[w], box, 4 * w);
    x0 = Math.min(x0, box[4 * w] - RAMP_JOIN); z0 = Math.min(z0, box[4 * w + 1] - RAMP_JOIN);
    x1 = Math.max(x1, box[4 * w + 2] + RAMP_JOIN); z1 = Math.max(z1, box[4 * w + 3] + RAMP_JOIN);
  }
  if (!n) { x0 = z0 = 0; x1 = z1 = 1; }
  const gw = Math.floor((x1 - x0) / WAY_CELL) + 1, gh = Math.floor((z1 - z0) / WAY_CELL) + 1;
  const start = new Int32Array(gw * gh + 1);
  const cellsOf = (w, f) => {
    const o = 4 * w;
    const i0 = Math.floor((box[o] - RAMP_JOIN - x0) / WAY_CELL), i1 = Math.floor((box[o + 2] + RAMP_JOIN - x0) / WAY_CELL);
    const j0 = Math.floor((box[o + 1] - RAMP_JOIN - z0) / WAY_CELL), j1 = Math.floor((box[o + 3] + RAMP_JOIN - z0) / WAY_CELL);
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) f(j * gw + i);
  };
  for (let w = 0; w < n; w++) cellsOf(w, (c) => { start[c + 1]++; });
  for (let c = 0; c < gw * gh; c++) start[c + 1] += start[c];
  const items = new Int32Array(start[gw * gh]), fill = start.slice(0, gw * gh);
  for (let w = 0; w < n; w++) cellsOf(w, (c) => { items[fill[c]++] = w; });
  return { box, x0, z0, gw, gh, start, items };
}

// The district key at a point straight from the hand table (the raster
// comes later): for the sidewalk width of a road. (The last rect holding
// the point wins: read from the end.)
function districtKeyAt(districts, x, z) {
  for (let i = districts.length - 1; i >= 0; i--) {
    const d = districts[i];
    if (x >= d.x0 && x <= d.x1 && z >= d.z0 && z <= d.z1) return d.key;
  }
  return 'midtown';
}
// roadProfile(r, { district, curbParking }) shared by every way with the
// same inputs (it reads class, name, oneway, lanes, lf, lb, mall, bridge,
// and of the options only whether the district is downtown and whether
// the street parks on its curbs; of the name only whether it is one of
// the pedestrian streets, Lincoln Road, or any name at all): one frozen
// profile per key. Lane tags other than whole numbers 0 to 15 (or none)
// are not cached.
// (0.15 WP1) Share of the 6.5 m slots of a parking lane that list a curb
// spot (was 22 %, a seeded draw: a parking lane stood 78 % empty even
// with every spot taken), and the hash seed that picks them.
// (0.15 integration: 30 %, was 60 %. The static curb cars of
// render/parkedfield.js fill the lane stations clear of a spot; the live
// cars, capped at 40 with the lot cars, filled only the spots nearest the
// player, so at 60 % most spots stood empty and the lane held 44 to 50 %.
// At 30 % the live cap about covers the spots near the start (28 to 74
// within 135 m) and static plus live cars hold 59 to 66 % of the lane.)
const CURB_FILL = 0.3, CURB_SEED = 0xc0b5;
// (0.15 WP1) Streets that keep a parking lane on both curbs where a local
// street parks on one: the hand table (MIAMI_SPOTS.curbParking), the
// streets of the regions' start places (their designed first views: parked
// cars on both curbs, the spawn on its lane) and the streets of the
// service homes' marked curb bays (CURB_BAYS stand in the middle of a
// parking lane of a 12 m street). The same in every build, so a region and
// the whole box agree.
const CURB_BAY_STREETS = ['Southeast 4th Street', 'Northeast 7th Street', 'Southeast 10th Street'];
const START_STREETS = REGIONS.map((r) => (r.start ? r.start.street : MIAMI_SPOTS.spawn.street));
const bothCurbs = (S) => (S.curbParking || []).concat(CURB_BAY_STREETS, START_STREETS);
// The service homes' marked curb bays (x, z, heading; entities/
// servicevehicles.js SERVICE_SPOTS with `curb: true`), kept as curb spots.
const CURB_BAYS = [-1053.16, 948.3, -2.462, -964.83, -118.63, 3.1043, -1174.5, 1739.29, -2.9102];
const laneKey = (v) => (v === undefined || v === null || v === 0 ? 0 : Number.isInteger(v) && v > 0 && v < 16 ? v : -1);
function cachedProfile(R, r, downtown, curb) {
  const lanes = laneKey(r.lanes), lf = laneKey(r.lf), lb = laneKey(r.lb);
  let ci = R.classIds.get(r.class);
  if (ci === undefined) R.classIds.set(r.class, (ci = R.classIds.size));
  const popts = R.popts;
  popts.district = downtown ? 'downtown' : '';
  popts.curbParking = curb;
  if (lanes < 0 || lf < 0 || lb < 0 || ci > 63) return roadProfile(r, popts);
  const name = r.name || '';
  let key = ci;
  key = key * 16 + lanes;
  key = key * 16 + lf;
  key = key * 16 + lb;
  key = key * 2 + (r.oneway ? 1 : 0);
  key = key * 2 + (r.mall ? 1 : 0);
  key = key * 2 + (r.bridge ? 1 : 0);
  key = key * 2 + (PED_STREETS.has(name) ? 1 : 0);
  key = key * 2 + (name === 'Lincoln Road' ? 1 : 0);
  key = key * 2 + (downtown ? 1 : 0);
  key = key * 2 + (curb ? 1 : 0);
  key = key * 2 + (name ? 1 : 0);
  let prof = R.profiles.get(key);
  if (!prof) R.profiles.set(key, (prof = Object.freeze(roadProfile(r, popts))));
  return prof;
}
function nearWater(landCell, coastLand, x, z) {
  for (let k = 0; k < 8; k++) {
    const c = landCell(x + Math.cos(k * 0.785) * 40, z + Math.sin(k * 0.785) * 40);
    if (c < 0 || !coastLand[c]) return true;
  }
  return false;
}
// A long bridge over land is a flyover (more than 0.6 of it, sampled
// every 5 m, over the base land, and longer than 50 m).
function flyoverOverLand(landCell, baseLand, pts, m) {
  let on = 0, n = 0, L = 0;
  for (let k = 0; k + 3 < m; k += 2) {
    const sl = Math.hypot(pts[k + 2] - pts[k], pts[k + 3] - pts[k + 1]);
    L += sl;
    for (let t = 0; t < sl; t += 5) {
      n++;
      const c = landCell(pts[k] + ((pts[k + 2] - pts[k]) * t) / sl, pts[k + 1] + ((pts[k + 3] - pts[k + 1]) * t) / sl);
      if (c >= 0 && baseLand[c] === 1) on++;
    }
  }
  return n && on / n > 0.6 && L > 50;
}
// One way of the data.
const TUNNEL = /tunnel/i;
// ramp: a ramp keepJoinedRamps keeps (not left out as at grade).
// Returns whether the road became at least one way (false: left out).
function readRoad(R, r, ramp) {
  const w0 = R.ways.length;
  readRoadInto(R, r, ramp);
  return R.ways.length > w0;
}
function readRoadInto(R, r, ramp) {
  // Pedestrian streets: only the named malls (2.1 item 8), drivable.
  if (!DRIVE.has(r.class) && !(r.class === 'pedestrian' && (r.mall || PED_STREETS.has(r.name)))) return;
  if (r.name && TUNNEL.test(r.name)) return;
  const crop = R.crop;
  const p = r.p, m = p.length;
  if (m > R.pts.length) R.pts = new Float64Array(m * 2);
  const pts = R.pts;
  // Decoded, with the bounds in whole decimeters (x / 10 keeps the order).
  let x = 0, z = 0, ix0 = Infinity, ix1 = -Infinity, iz0 = Infinity, iz1 = -Infinity;
  for (let i = 0; i < m; i += 2) {
    x += p[i];
    z += p[i + 1];
    if (x < ix0) ix0 = x;
    if (x > ix1) ix1 = x;
    if (z < iz0) iz0 = z;
    if (z > iz1) iz1 = z;
    pts[i] = x / 10;
    pts[i + 1] = z / 10;
  }
  if (r.oneway === -1) {
    // Stored against the traffic: reverse, so every one-way runs along its points.
    for (let i = 0, j = m - 2; i < j; i += 2, j -= 2) {
      const tx = pts[i], tz = pts[i + 1];
      pts[i] = pts[j]; pts[i + 1] = pts[j + 1];
      pts[j] = tx; pts[j + 1] = tz;
    }
  }
  const bx0 = ix0 / 10, bx1 = ix1 / 10, bz0 = iz0 / 10, bz1 = iz1 / 10;
  if (bx1 < crop.x0 || bx0 > crop.x1 || bz1 < crop.z0 || bz0 > crop.z1) return;
  const landCell = R.landCell, coastLand = R.coastLand;
  // Freeway pieces at grade between the dropped flyovers are islands of
  // ramps; only the ones that run out to a water crossing are kept.
  if (!ramp && !r.bridge && r.class.startsWith('motorway') && !nearWater(landCell, coastLand, pts[0], pts[1]) && !nearWater(landCell, coastLand, pts[m - 2], pts[m - 1])) {
    if (r.class === 'motorway_link') R.ramps.push(r);
    return;
  }
  // A long bridge over land is a flyover: the flat world would make it
  // cross the streets below at grade, so it is left out. Bridges that
  // land near the water are approaches to a crossing: kept.
  if (r.bridge && flyoverOverLand(landCell, R.baseLand, pts, m) && !nearWater(landCell, coastLand, pts[0], pts[1]) && !nearWater(landCell, coastLand, pts[m - 2], pts[m - 1])) return;
  // The cross section (world/roadprofile.js; docs/MAP.md "Edge contract").
  const prof = cachedProfile(R, r, districtKeyAt(R.districts, pts[0], pts[1]) === 'downtown', !!r.name && R.curb.includes(r.name));
  const oneway = prof.oneway;
  const info = { cls: r.class, name: r.name || '', bridge: !!r.bridge, oneway, avenue: isAvenue(prof), width: prof.width, prof, mph: r.mph || 0, lanesTag: r.lanes || (r.lf || 0) + (r.lb || 0) };
  // Split at the crop edge: only runs of vertices inside it; where a
  // segment leaves the crop, it is cut at the edge.
  let run = R.np;
  // (Room for every point and a cut point on every segment.)
  if (run + 2 * m > R.P.length) R.P = GROW_F64(R.P, run + 2 * m);
  const P = R.P;
  const CX0 = crop.x0, CX1 = crop.x1, CZ0 = crop.z0, CZ1 = crop.z1;
  if (bx0 >= CX0 && bx1 <= CX1 && bz0 >= CZ0 && bz1 <= CZ1) {
    // All inside: one run of every vertex.
    for (let k = 0; k < m; k++) P[run + k] = pts[k];
    R.np = run + m;
    flushRun(R, run, info);
    return;
  }
  let prevIn = false;
  for (let k = 0; k < m; k += 2) {
    const x = pts[k], z = pts[k + 1];
    const inside = x >= CX0 && x <= CX1 && z >= CZ0 && z <= CZ1;
    if (inside) {
      if (k > 0 && !prevIn) edgePoint(R, x, z, pts[k - 2], pts[k - 1]);
      P[R.np++] = x;
      P[R.np++] = z;
    } else if (prevIn) {
      edgePoint(R, pts[k - 2], pts[k - 1], x, z);
      run = flushRun(R, run, info);
    }
    prevIn = inside;
  }
  flushRun(R, run, info);
}
// The run from P[run] on becomes a way when it has two vertices or more.
function flushRun(R, run, info) {
  if (R.np - run >= 4) {
    R.ways.push(info);
    R.wayS.push(run);
    R.wayE.push(R.np);
  } else R.np = run;
  return R.np;
}
function edgePoint(R, ax, az, bx, bz) {
  const crop = R.crop;
  let t = 1;
  const dx = bx - ax, dz = bz - az;
  if (bx < crop.x0) t = Math.min(t, (crop.x0 - ax) / dx);
  if (bx > crop.x1) t = Math.min(t, (crop.x1 - ax) / dx);
  if (bz < crop.z0) t = Math.min(t, (crop.z0 - az) / dz);
  if (bz > crop.z1) t = Math.min(t, (crop.z1 - az) / dz);
  const cx = Math.round((ax + dx * t) * 10) / 10, cz = Math.round((az + dz * t) * 10) / 10;
  R.P[R.np++] = cx;
  R.P[R.np++] = cz;
  const dl = Math.hypot(dx, dz) || 1;
  R.cuts.push(cx, cz, dx / dl, dz / dl, R.ways.length);
}

// Vertices, shared where the data shares them (same decimeter): an open
// addressing table on the decimeter pair. flag: 1 street, 2 bridge, 4 way
// end. ix, iz: the vertex in whole decimeters plus 100000 (Math.round),
// within 0.05 m of it: the cheap first tests of splitJunctions.
// (The decimeter key of the data, Math.round(x * 10 + 100000) * 400000 +
// Math.round(z * 10 + 100000), is the pair: z is within 10 km of 0.)
function makeVertices(cap) {
  let hs = 1024;
  while (hs < cap * 2) hs *= 2;
  return {
    n: 0, vx: new Float64Array(cap), vz: new Float64Array(cap), ix: new Int32Array(cap), iz: new Int32Array(cap), vflag: new Uint8Array(cap),
    hid: new Int32Array(hs).fill(-1), hmask: hs - 1,
  };
}
function vertexOf(V, x, z, flag) {
  const ix = Math.round(x * 10 + 100000), iz = Math.round(z * 10 + 100000);
  const mask = V.hmask, hid = V.hid, vix = V.ix, viz = V.iz;
  let h = (Math.imul(ix, 73856093) ^ Math.imul(iz, 19349663)) & mask;
  let id;
  for (;;) {
    id = hid[h];
    if (id < 0 || (vix[id] === ix && viz[id] === iz)) break;
    h = (h + 1) & mask;
  }
  if (id < 0) {
    id = V.n++;
    if (id >= V.vx.length) growVertices(V, id + 1);
    hid[h] = id;
    V.vx[id] = x;
    V.vz[id] = z;
    V.ix[id] = ix;
    V.iz[id] = iz;
    if (V.n * 2 > mask) rehashVertices(V);
  }
  V.vflag[id] |= flag;
  return id;
}
function growVertices(V, n) {
  V.vx = GROW_F64(V.vx, n);
  V.vz = GROW_F64(V.vz, n);
  V.ix = GROW_I32(V.ix, V.vx.length);
  V.iz = GROW_I32(V.iz, V.vx.length);
  const f = new Uint8Array(V.vx.length);
  f.set(V.vflag);
  V.vflag = f;
}
function rehashVertices(V) {
  const hs = (V.hmask + 1) * 2, mask = hs - 1;
  const hid = new Int32Array(hs).fill(-1);
  for (let v = 0; v < V.n; v++) {
    let h = (Math.imul(V.ix[v], 73856093) ^ Math.imul(V.iz[v], 19349663)) & mask;
    while (hid[h] >= 0) h = (h + 1) & mask;
    hid[h] = v;
  }
  V.hid = hid;
  V.hmask = mask;
}
// Segments of every run between its vertices: seg { n, a, b, w } plus,
// for splitJunctions, per segment: on a bridge, its length (Math.hypot),
// its bounds in the vertices' whole decimeters (box: x0, x1, z0, z1); the
// segments of each SPLIT_GRID m cell over their bounds plus SNAP (cells:
// head per cell, then next and seg per entry, in segment order); and the
// degree of each vertex (deg; the vertices made here are at most the
// points).
const SPLIT_GRID = 40;
function waySegments(R, V, crop) {
  const P = R.P, wayS = R.wayS, wayE = R.wayE, ways = R.ways;
  const SG = SPLIT_GRID;
  const gx0 = crop.x0 - 10, gz0 = crop.z0 - 10;
  const gw = Math.ceil((crop.x1 - crop.x0 + 20) / SG) + 1, gh = Math.ceil((crop.z1 - crop.z0 + 20) / SG) + 1;
  const cap = (R.np >> 1) + 1;
  const seg = {
    n: 0, a: new Int32Array(cap), b: new Int32Array(cap), w: new Int32Array(cap),
    bridge: new Uint8Array(cap), len: new Float64Array(cap), box: new Int32Array(4 * cap), deg: new Int32Array(cap),
    cells: { gx0, gz0, gw, gh, n: 0, head: new Int32Array(gw * gh).fill(-1), tail: new Int32Array(gw * gh), next: new Int32Array(6 * cap), seg: new Int32Array(6 * cap) },
  };
  for (let wi = 0; wi < ways.length; wi++) {
    const s0 = wayS[wi], n = (wayE[wi] - s0) >> 1, br = ways[wi].bridge;
    const base = br ? 2 : 1;
    let prev = -1;
    for (let k = 0; k < n; k++) {
      const id = vertexOf(V, P[s0 + 2 * k], P[s0 + 2 * k + 1], base | (k === 0 || k === n - 1 ? 4 : 0));
      if (prev >= 0 && prev !== id) addSegment(V, seg, prev, id, wi, br);
      prev = id;
    }
  }
  return seg;
}
function addSegment(V, seg, a, b, wi, br) {
  const s = seg.n++;
  seg.a[s] = a;
  seg.b[s] = b;
  seg.w[s] = wi;
  seg.deg[a]++;
  seg.deg[b]++;
  const vx = V.vx, vz = V.vz, vix = V.ix, viz = V.iz;
  const ax = vx[a], az = vz[a], bx = vx[b], bz = vz[b];
  seg.bridge[s] = br ? 1 : 0;
  seg.len[s] = Math.hypot(bx - ax, bz - az);
  const k = 4 * s, box = seg.box;
  box[k] = vix[a] < vix[b] ? vix[a] : vix[b];
  box[k + 1] = vix[a] < vix[b] ? vix[b] : vix[a];
  box[k + 2] = viz[a] < viz[b] ? viz[a] : viz[b];
  box[k + 3] = viz[a] < viz[b] ? viz[b] : viz[a];
  const C = seg.cells, SG = SPLIT_GRID, gw = C.gw;
  // The cells Math.max(0, Math.floor(lo / SG)) to Math.min(n - 1,
  // Math.floor(hi / SG)) (from 0 up to 2^31, | 0 truncates as it floors).
  const xl = (ax < bx ? ax : bx) - SNAP - C.gx0, xh = (ax < bx ? bx : ax) + SNAP - C.gx0;
  const zl = (az < bz ? az : bz) - SNAP - C.gz0, zh = (az < bz ? bz : az) + SNAP - C.gz0;
  const i0 = xl >= 0 && xl < 2e9 ? (xl / SG) | 0 : Math.max(0, Math.floor(xl / SG));
  const j0 = zl >= 0 && zl < 2e9 ? (zl / SG) | 0 : Math.max(0, Math.floor(zl / SG));
  let i1 = xh >= 0 && xh < 2e9 ? (xh / SG) | 0 : Math.floor(xh / SG), j1 = zh >= 0 && zh < 2e9 ? (zh / SG) | 0 : Math.floor(zh / SG);
  if (i1 > gw - 1) i1 = gw - 1;
  if (j1 > C.gh - 1) j1 = C.gh - 1;
  let n = C.n;
  if (n + (i1 - i0 + 1) * (j1 - j0 + 1) > C.next.length) {
    C.next = GROW_I32(C.next, n + (i1 - i0 + 1) * (j1 - j0 + 1));
    C.seg = GROW_I32(C.seg, C.next.length);
  }
  const head = C.head, tail = C.tail, next = C.next, cseg = C.seg;
  for (let j = j0; j <= j1; j++) {
    for (let i = i0; i <= i1; i++) {
      const c = j * gw + i;
      next[n] = -1;
      cseg[n] = s;
      if (head[c] < 0) head[c] = n;
      else next[tail[c]] = n;
      tail[c] = n++;
    }
  }
  C.n = n;
}

// Junctions the simplified data lost: a vertex lying on another road, or
// two streets crossing with no shared vertex. Returns the split segments
// (or seg itself when nothing splits).
function splitJunctions(V, seg) {
  const C = seg.cells, ns = seg.n;
  // Splits per segment: linked lists in insertion order (count in n[0]).
  const cap = ns + 256;
  const SP = { head: new Int32Array(ns).fill(-1), tail: new Int32Array(ns), n: new Int32Array(1), t: new Float64Array(cap), v: new Int32Array(cap), next: new Int32Array(cap) };
  splitOnVertices(V, seg, C.gx0, C.gz0, C.gw, C.gh, C.head, C.next, C.seg, SP);
  splitCrossings(V, seg, C.gx0, C.gz0, C.gw, C.gh, C.head, C.next, C.seg, SP);
  if (!SP.n[0]) return seg;
  return applySplits(V, seg, SP);
}
function addSplit(SP, s, t, v) {
  let q = SP.head[s];
  while (q >= 0) {
    if (SP.v[q] === v) return;
    q = SP.next[q];
  }
  const k = SP.n[0]++;
  if (k >= SP.t.length) {
    SP.t = GROW_F64(SP.t, k + 1);
    SP.v = GROW_I32(SP.v, k + 1);
    SP.next = GROW_I32(SP.next, k + 1);
  }
  SP.t[k] = t;
  SP.v[k] = v;
  SP.next[k] = -1;
  if (SP.head[s] < 0) SP.head[s] = k;
  else SP.next[SP.tail[s]] = k;
  SP.tail[s] = k;
}
// Vertex on a segment. (A vertex more than SNAP_DM decimeters outside a
// segment's decimeter bounds is skipped first: with the rounding of both,
// it is over 2.4 m from the segment, farther than SNAP.)
const SNAP_DM = 24;
function splitOnVertices(V, seg, gx0, gz0, gw, gh, head, next, cseg, SP) {
  const bridge = seg.bridge, len = seg.len, box = seg.box;
  const SG = SPLIT_GRID, vx = V.vx, vz = V.vz, vix = V.ix, viz = V.iz, vflag = V.vflag, segA = seg.a, segB = seg.b;
  const nv = V.n;
  for (let v = 0; v < nv; v++) {
    const x = vx[v], z = vz[v];
    const xr = x - gx0, zr = z - gz0;
    const i = xr >= 0 && xr < 2e9 ? (xr / SG) | 0 : Math.floor(xr / SG), j = zr >= 0 && zr < 2e9 ? (zr / SG) | 0 : Math.floor(zr / SG);
    if (i < 0 || j < 0 || i >= gw || j >= gh) continue;
    const f = vflag[v], ix = vix[v], iz = viz[v];
    const c = j * gw + i;
    for (let q = head[c]; q >= 0; q = next[q]) {
      const s = cseg[q], k = 4 * s;
      if (ix < box[k] - SNAP_DM || ix > box[k + 1] + SNAP_DM || iz < box[k + 2] - SNAP_DM || iz > box[k + 3] + SNAP_DM) continue;
      const a = segA[s], b = segB[s];
      if (a === v || b === v) continue;
      if (!(f & 4) && !(bridge[s] ? f & 2 : f & 1)) continue;
      const ax = vx[a], az = vz[a], dx = vx[b] - ax, dz = vz[b] - az;
      const L = len[s];
      const t = ((x - ax) * dx + (z - az) * dz) / L;
      if (t < 1 || t > L - 1) continue;
      const ox = ax + (dx * t) / L - x, oz = az + (dz * t) / L - z;
      if (ox * ox + oz * oz < SNAP * SNAP) addSplit(SP, s, t, v);
    }
  }
}
// Street crossings without a shared vertex (never with a bridge). Each
// cell's list is read from a cursor past the segments up to s (they come
// in order, and only later ones pair with s); two segments whose
// decimeter bounds lie more than 2 dm apart are skipped first (over 0.2 m
// apart: they cannot cross).
function splitCrossings(V, seg, gx0, gz0, gw, gh, head, next, cseg, SP) {
  const bridge = seg.bridge, len = seg.len, box = seg.box;
  const SG = SPLIT_GRID, segA = seg.a, segB = seg.b, ns = seg.n;
  const seen = new Int32Array(ns).fill(-1);
  const cur = head.slice();
  // (vertexOf may grow the vertex arrays: the segments' ends are read
  // from the arrays as they were, which keep their values.)
  const vx = V.vx, vz = V.vz;
  for (let s = 0; s < ns; s++) {
    if (bridge[s]) continue;
    const a = segA[s], b = segB[s];
    const ax = vx[a], az = vz[a], bx = vx[b], bz = vz[b], dx = bx - ax, dz = bz - az;
    const La = len[s];
    const sx0 = box[4 * s] - 2, sx1 = box[4 * s + 1] + 2, sz0 = box[4 * s + 2] - 2, sz1 = box[4 * s + 3] + 2;
    // (Cells as in addSegment, the bounds without SNAP.)
    const xl = (ax < bx ? ax : bx) - gx0, xh = (ax < bx ? bx : ax) - gx0, zl = (az < bz ? az : bz) - gz0, zh = (az < bz ? bz : az) - gz0;
    const i0 = xl >= 0 && xl < 2e9 ? (xl / SG) | 0 : Math.max(0, Math.floor(xl / SG));
    const j0 = zl >= 0 && zl < 2e9 ? (zl / SG) | 0 : Math.max(0, Math.floor(zl / SG));
    let i1 = xh >= 0 && xh < 2e9 ? (xh / SG) | 0 : Math.floor(xh / SG), j1 = zh >= 0 && zh < 2e9 ? (zh / SG) | 0 : Math.floor(zh / SG);
    if (i1 > gw - 1) i1 = gw - 1;
    if (j1 > gh - 1) j1 = gh - 1;
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const c = j * gw + i;
        let q = cur[c];
        while (q >= 0 && cseg[q] <= s) q = next[q];
        cur[c] = q;
        for (; q >= 0; q = next[q]) {
          const u = cseg[q], k = 4 * u;
          if (seen[u] === s || bridge[u]) continue;
          seen[u] = s;
          if (box[k + 1] < sx0 || box[k] > sx1 || box[k + 3] < sz0 || box[k + 2] > sz1) continue;
          const cc = segA[u], d = segB[u];
          if (cc === a || cc === b || d === a || d === b) continue;
          const cx = vx[cc], cz = vz[cc];
          const ex = vx[d] - cx, ez = vz[d] - cz;
          const den = dx * ez - dz * ex;
          if (Math.abs(den) < 1e-9) continue;
          const wx = cx - ax, wz = cz - az;
          const p = (wx * ez - wz * ex) / den, qq = (wx * dz - wz * dx) / den;
          const Lb = len[u];
          if (p * La < 0.5 || p * La > La - 0.5 || qq * Lb < 0.5 || qq * Lb > Lb - 0.5) continue;
          const v = vertexOf(V, ax + dx * p, az + dz * p, 1);
          addSplit(SP, s, p * La, v);
          addSplit(SP, u, qq * Lb, v);
        }
      }
    }
  }
}
// Each split segment as its pieces, the splits in order along it (a
// stable insertion sort by distance: equal ones keep their order).
// Returns { n, a, b, w, deg }.
function applySplits(V, seg, SP) {
  const ns = seg.n, segA = seg.a, segB = seg.b, segW = seg.w;
  // (A segment with k splits makes k + 1 pieces at most.)
  const cap = ns + SP.n[0];
  const A = new Int32Array(cap), B = new Int32Array(cap), Wd = new Int32Array(cap);
  const deg = new Int32Array(V.n);
  let n = 0;
  let st = new Float64Array(16), sv = new Int32Array(16);
  for (let s = 0; s < ns; s++) {
    let q = SP.head[s];
    if (q < 0) { A[n] = segA[s]; B[n] = segB[s]; Wd[n] = segW[s]; n++; deg[segA[s]]++; deg[segB[s]]++; continue; }
    let m = 0;
    for (; q >= 0; q = SP.next[q]) {
      if (m >= st.length) { st = GROW_F64(st, m + 1); sv = GROW_I32(sv, m + 1); }
      const t = SP.t[q], v = SP.v[q];
      let k = m++;
      while (k > 0 && st[k - 1] > t) { st[k] = st[k - 1]; sv[k] = sv[k - 1]; k--; }
      st[k] = t;
      sv[k] = v;
    }
    let prev = segA[s];
    for (let k = 0; k < m; k++) {
      if (sv[k] !== prev) { A[n] = prev; B[n] = sv[k]; Wd[n] = segW[s]; n++; deg[prev]++; deg[sv[k]]++; }
      prev = sv[k];
    }
    if (prev !== segB[s]) { A[n] = prev; B[n] = segB[s]; Wd[n] = segW[s]; n++; deg[prev]++; deg[segB[s]]++; }
  }
  return { n, a: A, b: B, w: Wd, deg };
}

function findRoot(parent, v) {
  while (parent[v] !== v) v = parent[v] = parent[parent[v]];
  return v;
}
// Merge junction vertices closer than MERGE m (dual carriageways, ramps):
// union-find parents over the vertices. The junctions (degree 1 or 3+)
// sit in a MERGE m grid of linked lists, in vertex order in each cell.
// Also the representative positions (rx, rz): the mean of each merged
// group, summed in vertex order from 0 (a vertex on its own: 0 + its x).
// Returns { parent, rx, rz } (rx, rz set for the representatives).
function mergeJunctions(V, seg) {
  const nv = V.n, vx = V.vx, vz = V.vz;
  const parent = new Int32Array(nv), deg = seg.deg;
  const rx = new Float64Array(nv), rz = new Float64Array(nv);
  const MG = MERGE;
  const junc = new Int32Array(nv), jci = new Int32Array(nv), jcj = new Int32Array(nv);
  let nj = 0, ci0 = Infinity, ci1 = -Infinity, cj0 = Infinity, cj1 = -Infinity;
  for (let v = 0; v < nv; v++) {
    parent[v] = v;
    rx[v] = 0 + vx[v];
    rz[v] = 0 + vz[v];
    if (deg[v] === 0 || deg[v] === 2) continue;
    const ci = Math.floor(vx[v] / MG), cj = Math.floor(vz[v] / MG);
    junc[nj] = v;
    jci[nj] = ci;
    jcj[nj] = cj;
    nj++;
    if (ci < ci0) ci0 = ci;
    if (ci > ci1) ci1 = ci;
    if (cj < cj0) cj0 = cj;
    if (cj > cj1) cj1 = cj;
  }
  if (!nj) return { parent, rx, rz };
  // One empty cell of margin all round (the neighbors of every junction).
  const gw = ci1 - ci0 + 3, gh = cj1 - cj0 + 3;
  const head = new Int32Array(gw * gh).fill(-1), next = new Int32Array(nj);
  for (let q = nj - 1; q >= 0; q--) {
    const c = (jcj[q] - cj0 + 1) * gw + jci[q] - ci0 + 1;
    next[q] = head[c];
    head[c] = q;
  }
  mergeNear(vx, vz, parent, junc, jci, jcj, nj, head, next, gw, ci0 - 1, cj0 - 1);
  groupMeans(vx, vz, parent, junc, nj, rx, rz);
  return { parent, rx, rz };
}
// Only junctions merge: each group's mean from its members in order (the
// mean set again as each adds in, so the last one leaves the mean of all).
function groupMeans(vx, vz, parent, junc, nj, rx, rz) {
  const nv = parent.length;
  const px = new Float64Array(nv), pz = new Float64Array(nv), pn = new Int32Array(nv);
  for (let q = 0; q < nj; q++) {
    const v = junc[q];
    const r = parent[v] === v ? v : findRoot(parent, v);
    px[r] += vx[v];
    pz[r] += vz[v];
    pn[r]++;
    rx[r] = px[r] / pn[r];
    rz[r] = pz[r] / pn[r];
  }
}
function mergeNear(vx, vz, parent, junc, jci, jcj, nj, head, next, gw, oi, oj) {
  const MG = MERGE;
  for (let q = 0; q < nj; q++) {
    const v = junc[q];
    for (let dj = -1; dj <= 1; dj++) {
      for (let di = -1; di <= 1; di++) {
        for (let r = head[(jcj[q] + dj - oj) * gw + jci[q] + di - oi]; r >= 0; r = next[r]) {
          const u = junc[r];
          if (u <= v) continue;
          if ((vx[u] - vx[v]) ** 2 + (vz[u] - vz[v]) ** 2 > MG * MG) continue;
          const ra = findRoot(parent, u), rb = findRoot(parent, v);
          if (ra !== rb) parent[ra] = rb;
        }
      }
    }
  }
}

// Adjacency on representatives (one entry per directed pair, the wider
// way wins), as linked lists in insertion order: G.head / G.tail per rep,
// per entry to, way, next, mate (the reverse entry), legal (a one-way runs
// along it), seen (walked). G.order: the reps in order of first link.
function makeAdjacency(nv, cap) {
  return {
    nv, nOrder: 0, order: new Int32Array(nv), head: new Int32Array(nv).fill(-1), tail: new Int32Array(nv), deg: new Int32Array(nv),
    n: 0, to: new Int32Array(cap), way: new Int32Array(cap), next: new Int32Array(cap), mate: new Int32Array(cap), legal: new Uint8Array(cap), seen: new Uint8Array(cap),
  };
}
function adjEntry(G, a, b) {
  for (let e = G.head[a]; e >= 0; e = G.next[e]) if (G.to[e] === b) return e;
  return -1;
}
function adjAppend(G, a, b, wi) {
  const e = G.n++;
  if (e >= G.to.length) {
    const c = Math.max(e + 1, G.to.length * 2);
    G.to = GROW_I32(G.to, c); G.way = GROW_I32(G.way, c); G.next = GROW_I32(G.next, c); G.mate = GROW_I32(G.mate, c);
    const l = new Uint8Array(c); l.set(G.legal); G.legal = l;
    const s = new Uint8Array(c); s.set(G.seen); G.seen = s;
  }
  G.to[e] = b;
  G.way[e] = wi;
  G.next[e] = -1;
  if (G.head[a] < 0) { G.head[a] = e; G.order[G.nOrder++] = a; }
  else G.next[G.tail[a]] = e;
  G.tail[a] = e;
  G.deg[a]++;
  return e;
}
// link(a, b) and link(b, a): returns the entry a -> b.
function adjLink(G, ways, a, b, wi) {
  let e = adjEntry(G, a, b);
  if (e < 0) {
    e = adjAppend(G, a, b, wi);
    const r = adjAppend(G, b, a, wi);
    G.mate[e] = r;
    G.mate[r] = e;
  } else if (ways[wi].width > ways[G.way[e]].width) {
    G.way[e] = wi;
    G.way[G.mate[e]] = wi;
  }
  return e;
}
function linkReps(seg, parent, ways, links, rx, rz) {
  const G = makeAdjacency(parent.length, 2 * seg.n + 2 * links.length + 2);
  const folds = [];
  for (let s = 0; s < seg.n; s++) {
    const a = findRoot(parent, seg.a[s]), b = findRoot(parent, seg.b[s]);
    if (a === b) continue;
    // (A way that links a and b a second time ran there and back: a
    // traffic circle round one merged junction node, out to a point of
    // its ring and back in.)
    const was = adjEntry(G, a, b);
    if (was >= 0 && G.way[was] === seg.w[s]) folds.push(was);
    const e = adjLink(G, ways, a, b, seg.w[s]);
    if (ways[seg.w[s]].oneway) G.legal[e] = 1;
  }
  // (0.13.8) Such a fold that ends at a rep with no other neighbor is a
  // dead-end stub out of the junction (drawn as a 12 m two-way stub, a
  // wedge of road and sidewalk across the crossing: SW 20th Road at SW
  // 5th Avenue): never walked, so it makes no edge.
  for (const e of folds) {
    const b = G.to[e], a = G.to[G.mate[e]];
    if (G.deg[a] === 1 || G.deg[b] === 1) G.seen[e] = G.seen[G.mate[e]] = 1;
  }
  for (let k = 0; k < links.length; k++) {
    // Hand-made links: nearest representative to each end.
    const s = links[k];
    const a = nearestRep(G, rx, rz, s[0], s[1]), b = nearestRep(G, rx, rz, s[2], s[3]);
    if (a >= 0 && b >= 0 && a !== b) {
      const prof = roadProfile({ class: 'unclassified' });
      ways.push({ cls: 'unclassified', name: '', bridge: false, oneway: false, avenue: false, width: prof.width, prof, mph: 0, lanesTag: 0 });
      adjLink(G, ways, a, b, ways.length - 1);
    }
  }
  return G;
}
function nearestRep(G, rx, rz, x, z) {
  let best = -1, bd = Infinity;
  for (let k = 0; k < G.nOrder; k++) {
    const r = G.order[k];
    const d = (rx[r] - x) ** 2 + (rz[r] - z) ** 2;
    if (d < bd) { bd = d; best = r; }
  }
  return best;
}

const sameKind = (ways, w1, w2) => w1 === w2 || (ways[w1].width === ways[w2].width && ways[w1].bridge === ways[w2].bridge && ways[w1].cls === ways[w2].cls && ways[w1].name === ways[w2].name &&
  ways[w1].oneway === ways[w2].oneway && ways[w1].prof.lanesF === ways[w2].prof.lanesF);
// A rep where a chain ends: not two neighbors, or two of different ways.
function isBreak(G, ways, r) {
  if (G.deg[r] !== 2) return true;
  const e = G.head[r];
  return !sameKind(ways, G.way[e], G.way[G.next[e]]);
}

// Chains between junctions, simplified (Douglas-Peucker) into edges.
// Returns { nodes, edges } (node.edges filled, in edge order: addEdge
// adds each new edge to its two nodes).
function walkChains(G, ways, rx, rz) {
  const W = {
    G, ways, rx, rz, nodes: [], edges: [],
    nodeOfRep: new Int32Array(G.nv).fill(-1),
    chain: new Int32Array(G.nv + 2), chainE: new Int32Array(G.nv + 2), keep: new Uint8Array(G.nv + 2), stack: new Int32Array(2 * G.nv + 8),
    // Edges by their smaller node: head per node, next and other end per edge.
    ekHead: new Int32Array(G.nv).fill(-1), ekNext: [], ekOther: [],
    // Union-find over the nodes, joined along every edge (keepMainNetwork).
    uf: new Int32Array(G.nv + 1),
  };
  // From every break, then (k past nOrder) the loops with no junction on
  // them (a traffic circle on its own): one loop over the reps twice.
  const nr = G.nOrder;
  for (let k = 0; k < 2 * nr; k++) {
    const r = G.order[k < nr ? k : k - nr];
    if (k < nr && !isBreak(G, ways, r)) continue;
    for (let e = G.head[r]; e >= 0; e = G.next[e]) if (!G.seen[e]) walkFrom(W, r, e);
  }
  return { nodes: W.nodes, edges: W.edges, uf: W.uf };
}
function walkFrom(W, start, e0) {
  const G = W.G, ways = W.ways, chain = W.chain, chainE = W.chainE;
  const next = G.to[e0];
  chain[0] = start;
  chain[1] = next;
  chainE[0] = e0;
  let len = 2;
  const wi = G.way[e0];
  G.seen[e0] = G.seen[G.mate[e0]] = 1;
  let prev = start, cur = next;
  while (!isBreak(G, ways, cur) && cur !== start) {
    let nxt = -1, ne = -1;
    for (let e = G.head[cur]; e >= 0; e = G.next[e]) if (G.to[e] !== prev) { nxt = G.to[e]; ne = e; }
    if (nxt < 0 || G.seen[ne]) break;
    G.seen[ne] = G.seen[G.mate[ne]] = 1;
    chainE[len - 1] = ne;
    chain[len++] = nxt;
    prev = cur;
    cur = nxt;
  }
  simplifyChain(W, len, wi);
}
// Douglas-Peucker over chain[0, len): marks the kept points in keep (the
// pieces on an explicit stack; each piece's split point does not depend
// on the order they are taken in).
function chainDP(chain, keep, stack, rx, rz, len) {
  let sp = 0;
  stack[sp++] = 0;
  stack[sp++] = len - 1;
  const tol2 = CHAIN_TOL * CHAIN_TOL;
  while (sp) {
    const i1 = stack[--sp], i0 = stack[--sp];
    let best = -1, bd = tol2;
    const ax = rx[chain[i0]], az = rz[chain[i0]], bx = rx[chain[i1]], bz = rz[chain[i1]];
    for (let i = i0 + 1; i < i1; i++) {
      const d = segDist2(rx[chain[i]], rz[chain[i]], ax, az, bx, bz);
      if (d > bd) { bd = d; best = i; }
    }
    if (best >= 0) {
      keep[best] = 1;
      stack[sp++] = i0;
      stack[sp++] = best;
      stack[sp++] = best;
      stack[sp++] = i1;
    }
  }
}
function simplifyChain(W, len, wi) {
  // chain: reps from break to break.
  const G = W.G, chain = W.chain, chainE = W.chainE, keep = W.keep;
  keep[0] = keep[len - 1] = 1;
  if (len > 2) {
    // (Two reps: nothing between them to keep or drop.)
    keep.fill(0, 1, len - 1);
    chainDP(chain, keep, W.stack, W.rx, W.rz, len);
  }
  // (0.13.8) A chain that leaves a node and comes back to it keeping
  // under two points between its ends folds into a dead-end stub out of
  // the node (two passes over one pair of nodes are one two-way road,
  // drawn 12 m wide): dropped. (A loop of three points or more, a
  // turning circle, stays.)
  if (chain[0] === chain[len - 1]) {
    let kept = 0;
    for (let i = 1; i < len - 1; i++) if (keep[i]) kept++;
    if (kept < 2) return;
  }
  let prev = nodeFor(W, chain[0]), prevI = 0;
  const oneway = W.ways[wi].oneway;
  for (let i = 1; i < len; i++) {
    if (!keep[i]) continue;
    const n = nodeFor(W, chain[i]);
    // A one-way edge runs the way its way runs (first step of the piece);
    // legal both ways: the two carriageways of a pair on one line.
    const e = chainE[prevI];
    const fw = G.legal[e] === 1, bw = G.legal[G.mate[e]] === 1;
    if (oneway && fw && bw) addEdge(W, prev, n, wi, true);
    else if (oneway && !fw && bw) addEdge(W, n, prev, wi, false);
    else addEdge(W, prev, n, wi, false);
    prev = n;
    prevI = i;
  }
}
function nodeFor(W, r) {
  let n = W.nodeOfRep[r];
  if (n < 0) {
    n = W.nodes.length;
    W.nodeOfRep[r] = n;
    W.uf[n] = n;
    // (stop, blade, signalSrc: set by keepNodes on every kept node, in
    // the literal so the node is made with room for them. hx, hz made
    // fractional, then 2: their fields hold any number from the start,
    // so the boxes keepNodes writes do not move every node to a new map.)
    const nd = { id: n, i: 0, j: 0, x: W.rx[r], z: W.rz[r], hx: 0.5, hz: 0.5, edges: [], signal: false, stop: false, blade: false, signalSrc: '' };
    nd.hx = 2;
    nd.hz = 2;
    W.nodes.push(nd);
  }
  return n;
}
// both: the two carriageways of a one-way pair collapsed onto the same
// junctions (closer than MERGE): one two-way road (2.1 item 4).
function addEdge(W, na, nb, wi, both) {
  if (na === nb) return;
  const lo = na < nb ? na : nb, hi = na < nb ? nb : na;
  const w = W.ways[wi], edges = W.edges;
  let old = W.ekHead[lo];
  while (old >= 0 && W.ekOther[old] !== hi) old = W.ekNext[old];
  if (old >= 0) {
    // Both carriageways of a tight one-way pair between the same two
    // junctions: one two-way road (2.1 item 4, gap under 1 m).
    const e = edges[old];
    if (e.oneway && w.oneway && e.a === nb && e.name === w.name) {
      e.oneway = false;
      e.lanesB = w.prof.lanesF;
      // (0.15 WP1: a local street parks on one curb.)
      e.parkL = isLocalClass(e.cls) ? 0 : w.prof.parkR;
      e.width = Math.round(((e.lanesF + e.lanesB) * e.laneW + e.center + e.parkL + e.parkR + 0.6) * 100) / 100;
      e.avenue = isAvenue(e);
      e.merged = true;
    }
    return;
  }
  const A = W.nodes[na], Bn = W.nodes[nb];
  const dx = Bn.x - A.x, dz = Bn.z - A.z, length = Math.hypot(dx, dz);
  if (length < 0.5) return;
  W.ekNext.push(W.ekHead[lo]);
  W.ekOther.push(hi);
  W.ekHead[lo] = edges.length;
  const P = w.prof;
  const ed = {
    id: edges.length, a: na, b: nb, horizontal: Math.abs(dx) >= Math.abs(dz), width: P.width, avenue: w.avenue, length,
    ux: dx / length, uz: dz / length, bridge: w.bridge, oneway: w.oneway, cls: w.cls, name: w.name,
    // The edge contract (docs/MAP.md), from world/roadprofile.js.
    lanesF: P.lanesF, lanesB: P.lanesB, laneW: P.laneW, parkL: P.parkL, parkR: P.parkR, median: 0.5, center: P.center,
    off: 0.5, sidewalk: P.sidewalk, ped: P.ped, divided: false, pair: -1, mph: w.mph, lanesTag: w.lanesTag || 0,
  };
  // (median, off made fractional, then 0: their fields hold any number
  // from the start, so pairDivided's do not move every edge to a new map.)
  ed.median = 0;
  ed.off = 0;
  edges.push(ed);
  A.edges.push(edges.length - 1);
  Bn.edges.push(edges.length - 1);
  const ra = findRoot(W.uf, na), rb = findRoot(W.uf, nb);
  if (ra !== rb) W.uf[ra] = rb;
  if (both && w.oneway) {
    const e = edges[edges.length - 1];
    e.oneway = false;
    e.lanesB = e.lanesF;
    if (isLocalClass(e.cls)) e.parkL = 0;
    e.width = Math.round(((e.lanesF + e.lanesB) * e.laneW + e.center + e.parkL + e.parkR + 0.6) * 100) / 100;
    e.avenue = isAvenue(e);
    e.merged = true;
  }
}

// The node with edges nearest (x, z) (the first of equals), or null.
function nearestLinkedNode(nodes, x, z) {
  let bd = Infinity, best = null;
  for (let k = 0; k < nodes.length; k++) {
    const n = nodes[k];
    if (!n.edges.length) continue;
    const d = Math.hypot(n.x - x, n.z - z);
    if (d < bd) { bd = d; best = n; }
  }
  return best;
}
// Keeps the largest connected road network only: renumbers the nodes
// and edges (in order) and their edge lists (a kept node keeps all its
// edges: their other ends are in its component). On the way, the kept
// nodes' junction boxes: half the widest road, kept short of the edges.
// Returns { stats, juncGrid } (the junctions, degree 3+ and not the
// airfield gate, in a JUNC_GRID m grid, for signalsAndStops).
const JUNC_GRID = 32;
// (One loop per function: a function optimized in its first loop would
// meet the later ones with no type feedback and drop back.)
// J: buildRoadGraph's union-find of its J.nodes nodes (J.uf), joined
// along its J.edges edges; the nodes and edges added since (the airfield
// gate and causeway) join here.
function keepMainNetwork(nodes, edges, J) {
  const N = nodes.length;
  const uf = J.uf.length < N ? GROW_I32(J.uf, N) : J.uf;
  for (let v = J.nodes; v < N; v++) uf[v] = v;
  for (let k = J.edges; k < edges.length; k++) {
    const ra = findRoot(uf, edges[k].a), rb = findRoot(uf, edges[k].b);
    if (ra !== rb) uf[ra] = rb;
  }
  const comp = new Int32Array(N), cc = new Int32Array(2);
  componentsOf(N, uf, comp, cc);
  const c = cc[0], best = cc[1];
  // Junctions (degree 1 or 3+) per component, for the connectivity check;
  // the first node of each component (where a lost one is).
  const jc = new Int32Array(c), first = new Array(c).fill(null), remap = new Int32Array(N).fill(-1);
  const juncGrid = new Map(), juncs = [];
  const kn = keepNodes(nodes, edges, comp, best, jc, first, remap, juncGrid, juncs);
  let jAll = 0;
  for (let k = 0; k < c; k++) jAll += jc[k];
  const stats = { components: c, junctions: jAll, mainJunctions: jc[best], nodesBefore: N, nodesKept: kn, lost: [] };
  for (let k = 0; k < c; k++) {
    if (k === best || jc[k] < 3) continue;
    stats.lost.push({ junctions: jc[k], x: Math.round(first[k].x), z: Math.round(first[k].z) });
  }
  keepEdges(nodes, edges, remap, kn);
  return { stats, juncGrid, juncs };
}
// Connected components (the union-find's groups), numbered from the
// lowest node up (comp); cc[0] the count, cc[1] the first of the largest.
function componentsOf(N, uf, comp, cc) {
  const label = new Int32Array(N).fill(-1), size = new Int32Array(N);
  let c = 0;
  for (let k = 0; k < N; k++) {
    const r = uf[k] === k ? k : findRoot(uf, k);
    if (label[r] < 0) label[r] = c++;
    comp[k] = label[r];
    size[label[r]]++;
  }
  let best = -1, bestN = 0;
  for (let k = 0; k < c; k++) if (size[k] > bestN) { bestN = size[k]; best = k; }
  cc[0] = c;
  cc[1] = best;
}
// The kept nodes renumbered in place, with their boxes; returns their count.
function keepNodes(nodes, edges, comp, best, jc, first, remap, juncGrid, juncs) {
  const N = nodes.length, JG = JUNC_GRID;
  let kn = 0;
  for (let k = 0; k < N; k++) {
    const n = nodes[k], ck = comp[k];
    const l = n.edges, deg = l.length;
    if (deg !== 2) jc[ck]++;
    if (!first[ck]) first[ck] = n;
    if (ck !== best) continue;
    remap[k] = kn;
    n.id = kn;
    nodes[kn++] = n;
    n.stop = false;
    n.blade = false;
    n.signalSrc = '';
    if (n.i < 0) continue;
    let half = 0, minLen = Infinity;
    for (let q = 0; q < deg; q++) {
      const e = edges[l[q]];
      half = Math.max(half, e.width / 2);
      minLen = Math.min(minLen, e.length);
    }
    const want = deg === 2 ? 2 : half;
    n.hx = n.hz = Math.max(1, Math.min(want, minLen * 0.4));
    if (deg === 2) n.bend = true;
    if (deg < 3) continue;
    const key = Math.floor(n.x / JG) * 100000 + Math.floor(n.z / JG);
    let g = juncGrid.get(key);
    if (!g) juncGrid.set(key, (g = []));
    g.push(n);
    juncs.push(n);
  }
  nodes.length = kn;
  return kn;
}
// The kept edges renumbered; each node's list (in edge order) takes the
// new ids in turn (fill: the next entry of each node to set).
function keepEdges(nodes, edges, remap, kn) {
  const fill = new Int32Array(kn);
  let ke = 0;
  for (let k = 0, NE = edges.length; k < NE; k++) {
    const e = edges[k];
    if (remap[e.a] < 0 || remap[e.b] < 0) continue;
    const a = remap[e.a], b = remap[e.b];
    e.a = a;
    e.b = b;
    e.id = ke;
    nodes[a].edges[fill[a]++] = ke;
    nodes[b].edges[fill[b]++] = ke;
    edges[ke++] = e;
  }
  edges.length = ke;
}
// Signals and stop signs where the data has them (2.1 item 6): each data
// point goes to the nearest junction within SIGNAL_SNAP m.
// juncs: the junctions of juncGrid in node order.
function signalsAndStops(edges, data, juncGrid, juncs) {
  const sig = data.signals || [], stp = data.stops || [];
  // The signals, then the stops (one loop).
  const nS = sig.length >> 1, nT = stp.length >> 1;
  for (let q = 0; q < nS + nT; q++) {
    const isSig = q < nS, L = isSig ? sig : stp, k = isSig ? 2 * q : 2 * (q - nS);
    const n = nearestJunction(juncGrid, L[k] / 10, L[k + 1] / 10);
    if (!n) continue;
    if (isSig) { n.signal = true; n.signalSrc = 'data'; }
    else if (!n.signal) n.stop = true;
  }
  // Generated only where the data has none at a junction of two named
  // streets: a signal where a road of two lanes each way meets another
  // named street (the old rule), with no data signal or stop sign within
  // 60 m (dual carriageways put several nodes on one crossing).
  const hasData = sig.length + stp.length > 0;
  let near = null;
  for (let k = 0; k < juncs.length; k++) {
    const n = juncs[k];
    if (n.signal || n.stop) continue;
    let avenue = false, n1 = '', two = false;
    const l = n.edges;
    for (let q = 0; q < l.length; q++) {
      const e = edges[l[q]];
      if (e.avenue) avenue = true;
      if (e.name && !n1) n1 = e.name;
      else if (e.name && e.name !== n1) two = true;
    }
    if (!avenue || !two) continue;
    if (hasData && !near) near = dataPointGrid(sig, stp);
    if (!hasData || !dataNear(near, sig, stp, n.x, n.z)) { n.signal = true; n.signalSrc = 'gen'; }
  }
}
function nearestJunction(juncGrid, x, z) {
  const JG = JUNC_GRID;
  let best = null, bd = SIGNAL_SNAP * SIGNAL_SNAP;
  const ci = Math.floor(x / JG), cj = Math.floor(z / JG);
  for (let dj = -1; dj <= 1; dj++) {
    for (let di = -1; di <= 1; di++) {
      const l = juncGrid.get((ci + di) * 100000 + cj + dj);
      if (!l) continue;
      for (let q = 0; q < l.length; q++) {
        const n = l[q];
        const d = (n.x - x) ** 2 + (n.z - z) ** 2;
        if (d < bd) { bd = d; best = n; }
      }
    }
  }
  return best;
}
// The data signals and stops in a 64 m grid (point index lists; stops
// after the signals, offset by the signal count): for dataNear.
const DATA_GRID = 64;
function dataPointGrid(sig, stp) {
  const grid = new Map();
  const add = (list, off) => {
    for (let k = 0; k + 1 < list.length; k += 2) {
      const key = Math.floor(list[k] / 10 / DATA_GRID) * 100000 + Math.floor(list[k + 1] / 10 / DATA_GRID);
      let l = grid.get(key);
      if (!l) grid.set(key, (l = []));
      l.push(off + k);
    }
  };
  add(sig, 0);
  add(stp, sig.length);
  return grid;
}
// A data signal or stop sign within 60 m of (x, z) (squared distance
// under 3600, the cells within 64 m checked).
function dataNear(grid, sig, stp, x, z) {
  const ci = Math.floor(x / DATA_GRID), cj = Math.floor(z / DATA_GRID);
  for (let dj = -1; dj <= 1; dj++) {
    for (let di = -1; di <= 1; di++) {
      const l = grid.get((ci + di) * 100000 + cj + dj);
      if (!l) continue;
      for (let q = 0; q < l.length; q++) {
        const k = l[q];
        if (k < sig.length) {
          if ((sig[k] / 10 - x) ** 2 + (sig[k + 1] / 10 - z) ** 2 < 3600) return true;
        } else if ((stp[k - sig.length] / 10 - x) ** 2 + (stp[k - sig.length + 1] / 10 - z) ** 2 < 3600) return true;
      }
    }
  }
  return false;
}

// The whole stage: { nodes, edges, cuts }.
function buildRoadGraph(data, S, crop, landCell, coastLand, baseLand) {
  const R = readWays(data, S, crop, landCell, coastLand, baseLand);
  const ways = R.ways;
  const V = makeVertices((R.np >> 1) + 1024);
  const seg = splitJunctions(V, waySegments(R, V, crop));
  const M = mergeJunctions(V, seg);
  const parent = M.parent, rx = M.rx, rz = M.rz;
  const G = linkReps(seg, parent, ways, S.links || [], rx, rz);
  const g = walkChains(G, ways, rx, rz);
  // (0.15 roads, WP1) A pair of one-ways that is one street (a refuge
  // island, a turn bay, a sliver median, a short split) becomes one two-way
  // street (world/pairmerge.js); a true divided road is kept.
  const pm = collapsePairs(g.nodes, g.edges, { curb: bothCurbs(S) });
  // One cross section along each street (0.13.7 road logic).
  harmonizeStreets(g.nodes, g.edges, pm.made || null);
  // (After a collapse the nodes and edges changed: keepMainNetwork joins
  // the network again from scratch.)
  const joined = pm.collapsed ? { uf: new Int32Array(g.nodes.length + 1), nodes: 0, edges: 0 } : { uf: g.uf, nodes: g.nodes.length, edges: g.edges.length };
  return { nodes: g.nodes, edges: g.edges, joined, cuts: R.cuts, pairMerge: pm };
}

// True when some item of list (x, z fields) has Math.hypot(dx, dz) < r
// (hypot is at least |dx| and |dz|: the far ones are skipped first).
function anyWithin(list, x, z, r) {
  for (let k = 0; k < list.length; k++) {
    const dx = list[k].x - x, dz = list[k].z - z;
    if (dx < r && dx > -r && dz < r && dz > -r && Math.hypot(dx, dz) < r) return true;
  }
  return false;
}

// CSR lists of a GRID m spatial index (gw x gh cells from gx0, gz0): for
// every cell, the items whose bounds (B: x0, z0, x1, z1 per item) touch it,
// in item order. { start, items }.
function gridIndex(count, B, gx0, gz0, gw, gh) {
  const cnt = new Int32Array(gw * gh + 1);
  gridCount(count, B, gx0, gz0, gw, gh, cnt);
  for (let c = 0; c < gw * gh; c++) cnt[c + 1] += cnt[c];
  const items = new Int32Array(cnt[gw * gh]);
  gridFill(count, B, gx0, gz0, gw, gh, cnt.slice(), items);
  return { start: cnt, items };
}
function gridCount(count, B, gx0, gz0, gw, gh, cnt) {
  for (let k = 0; k < count; k++) {
    const i0 = Math.max(0, Math.floor((B[4 * k] - gx0) / GRID)), i1 = Math.min(gw - 1, Math.floor((B[4 * k + 2] - gx0) / GRID));
    const j0 = Math.max(0, Math.floor((B[4 * k + 1] - gz0) / GRID)), j1 = Math.min(gh - 1, Math.floor((B[4 * k + 3] - gz0) / GRID));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) cnt[j * gw + i + 1]++;
  }
}
function gridFill(count, B, gx0, gz0, gw, gh, fill, items) {
  for (let k = 0; k < count; k++) {
    const i0 = Math.max(0, Math.floor((B[4 * k] - gx0) / GRID)), i1 = Math.min(gw - 1, Math.floor((B[4 * k + 2] - gx0) / GRID));
    const j0 = Math.max(0, Math.floor((B[4 * k + 1] - gz0) / GRID)), j1 = Math.min(gh - 1, Math.floor((B[4 * k + 3] - gz0) / GRID));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) items[fill[j * gw + i]++] = k;
  }
}
// x0, z0, x1, z1 of every box of a list, for gridIndex.
function boxBounds(list) {
  const B = new Float64Array(4 * list.length);
  for (let k = 0; k < list.length; k++) {
    const b = list[k];
    B[4 * k] = b.x0; B[4 * k + 1] = b.z0; B[4 * k + 2] = b.x1; B[4 * k + 3] = b.z1;
  }
  return B;
}

// Removes the spots (only parking lot ones when lotOnly) with
// Math.hypot(dx, dz) < r from (x, z), keeping the order of the rest;
// hypot only where the squared distance is within rounding of r squared.
function dropSpotsNear(spots, x, z, r, lotOnly) {
  const r2 = r * r, lo = r2 * (1 - 1e-9), hi = r2 * (1 + 1e-9);
  let w = 0;
  for (let i = 0; i < spots.length; i++) {
    const p = spots[i], lot = p.lot; // (read always: one shape of code for both kinds of call)
    const dx = p.x - x, dz = p.z - z, d2 = dx * dx + dz * dz;
    const near = (!lotOnly || lot) && (d2 < lo || (d2 <= hi && Math.hypot(dx, dz) < r));
    if (!near) spots[w++] = p;
  }
  spots.length = w;
}

// ---------------------------------------------------------------------
// The city
// ---------------------------------------------------------------------
// The whole data box: roads and buildings stop BOX_INSET m inside the
// data bounds, land is cut at the bounds (so a dead end at the edge of
// the world still has land round it).
const BOX_INSET = 40;
export function fullBox(data) {
  const b = data.bounds;
  return { x0: Math.ceil(b.minX) + BOX_INSET, z0: Math.ceil(b.minZ) + BOX_INSET, x1: Math.floor(b.maxX) - BOX_INSET, z1: Math.floor(b.maxZ) - BOX_INSET };
}
// The build window of a region (docs/PLAN_V2.md 3.4): the region's crop
// clipped to the whole box; `box` marks the sides that are the data box's
// own edges (land cut at the bounds and closed by a wall, as the whole
// box), the other sides are sea edges (land cut LAND_MARGIN m past the
// crop: a straight seawall; roads end at the crop line with a generated
// road end). Without a region: the whole box, or `crop` (a test option)
// with sea edges all round.
export function buildWindow(data, region = null, crop = null) {
  if (crop) return { crop, box: { x0: false, z0: false, x1: false, z1: false } };
  const fb = fullBox(data);
  if (!region) return { crop: fb, box: { x0: true, z0: true, x1: true, z1: true } };
  const r = region.crop;
  const box = { x0: r.x0 <= fb.x0, z0: r.z0 <= fb.z0, x1: r.x1 >= fb.x1, z1: r.z1 >= fb.z1 };
  return { crop: { x0: Math.max(r.x0, fb.x0), z0: Math.max(r.z0, fb.z0), x1: Math.min(r.x1, fb.x1), z1: Math.min(r.z1, fb.z1) }, box };
}

// The hand tables a region build uses: MIAMI_SPOTS (or opts.spots) with
// every placed list filtered by the region rule (regions.js inRegion),
// plus the region's own start place and lists. A table that only works
// whole (the course spec, the secrets) is kept when the region holds
// every point of it, else left out (per-item placement is the job of
// courses.js and secrets.js). Downtown filters nothing: it is MIAMI_SPOTS.
export function regionSpots(base, region) {
  if (!region) return base;
  const keep = (list, own) => (list || []).filter((p) => inRegion(region, p.x, p.z)).concat(own || []);
  const whole = (v, m) => (v && holdsAll(region, pointsIn(v), m) ? v : null);
  const st = region.start;
  const spawn = st ? { street: st.street, x: st.x, z: st.z, heading: st.heading } : base.spawn;
  const one = (v) => (v && inRegion(region, v.x, v.z) ? v : null);
  return {
    ...base,
    spawn,
    startView: st ? region.startView || null : base.startView,
    piers: keep(base.piers, region.piers),
    seaplane: region.seaplane !== undefined ? region.seaplane : one(base.seaplane),
    helipads: keep(base.helipads, region.helipads),
    ramps: keep(base.ramps, region.ramps),
    cranes: keep(base.cranes),
    landmarks: keep(base.landmarks),
    cinder: one(base.cinder),
    secrets: whole(base.secrets),
    // Course gates out on the water may lie past the crop, where the
    // build still has sea (Downtown's Palm Island Sprint ends 100 m east
    // of it): the spec is kept whole within the land margin.
    courses: whole(base.courses, -LAND_MARGIN),
  };
}

// opts: { region, crop, spots, seed }. data: the parsed miami.json, or a
// region's own file (scripts/split-map.mjs). region: a region id or
// object (world/regions.js): only that region is built. Without one the
// whole data box (milestone 3); `opts.crop` (a test option, e.g.
// MIAMI_CROP) limits it to a rect with land cut LAND_MARGIN m outside it.
export function createMiamiCity(data, opts = {}) {
  // (Its stages run as inner functions, `(function stage() { ... })()`:
  // this function's own bytecode is over V8's limit for the optimizing
  // compiler, so a loop written straight in its body never leaves the
  // interpreter and boxes every number it makes.)
  const tStart = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const region = opts.region ? (typeof opts.region === 'string' ? regionFor(opts.region) : opts.region) : null;
  if (opts.region && !region) throw new Error('miami: unknown region ' + String(opts.region).slice(0, 40));
  const win = buildWindow(data, opts.crop ? null : region, opts.crop || null);
  const crop = win.crop, boxSide = win.box;
  const marginOf = (side) => (boxSide[side] ? BOX_INSET : LAND_MARGIN);
  const S = regionSpots(opts.spots || MIAMI_SPOTS, region);
  const seed = opts.seed ?? 25780;
  const rng = createRng(seed);
  const timings = {};
  let tMark = tStart;
  // opts.cpuClock (test/fixtures/build-budget-run.mjs only): a function
  // giving CPU ms; each lap then also records the stage's CPU time in
  // city.cpuTimings, which load from other processes does not stretch.
  const cpuClock = typeof opts.cpuClock === 'function' ? opts.cpuClock : null;
  const cpuTimings = cpuClock ? {} : null;
  let cMark = cpuClock ? cpuClock() : 0;
  const lap = (name) => {
    const t = typeof performance !== 'undefined' ? performance.now() : Date.now();
    timings[name] = Math.round(t - tMark);
    tMark = t;
    if (cpuClock) {
      const c = cpuClock();
      cpuTimings[name] = c - cMark;
      cMark = c;
    }
  };

  // ---- 1. Land mask: coastline sides, water polygons, the river. ----
  const cut = { x0: crop.x0 - marginOf('x0'), z0: crop.z0 - marginOf('z0'), x1: crop.x1 + marginOf('x1'), z1: crop.z1 + marginOf('z1') };
  // The raster origin sits on one world lattice (RASTER_LATTICE m, from
  // the whole box's own origin), so every region and crop rasters its
  // land, roads, districts (32 m), places (16 m) and lots on the same
  // cells as the whole box: a region holds the whole box's buildings and
  // lots inside it, not ones shifted by a part of a cell (before 0.7.0
  // was integrated Downtown's origin was 1 m off in z, which moved every
  // lot edge, 6 % of its buildings and the service homes tuned on the
  // whole box). The whole box itself is unchanged.
  const lx0 = RASTER_X0 + Math.floor((cut.x0 - SEA_PAD - RASTER_X0) / RASTER_LATTICE) * RASTER_LATTICE;
  const lz0 = RASTER_Z0 + Math.floor((cut.z0 - SEA_PAD - RASTER_Z0) / RASTER_LATTICE) * RASTER_LATTICE;
  const land = makeRaster(lx0, lz0, cut.x1 + SEA_PAD, cut.z1 + SEA_PAD, CELL);
  const W = land.w, H = land.h, NC = W * H;
  // Build scratch rasters (released once the lots are built: a closure kept on
  // the city holds this scope, so whatever it still points at stays alive).
  let labelBuf = new Int32Array(NC), queueBuf = new Int32Array(NC);
  // (coastLand is a plain local, not held by a closure: build only.)
  const coastLand = (function landMask() {
    let coastLand;
    // Coastline cells form walls; regions between them are flood filled
    // and each region votes land or water from the side of the coast
    // lines it touches (OSM: land on the left of a coastline way, seen
    // with north up; with z = south that is (dz, -dx) here).
    const wall = makeRaster(land.x0, land.z0, land.x0 + W * CELL, land.z0 + H * CELL, CELL);
    const coast = data.coastline.map((c) => decodePolyline(c.p));
    const bx1 = land.x0 + W * CELL, bz1 = land.z0 + H * CELL;
    const outside = (ax, az, bx, bz) => (ax < land.x0 && bx < land.x0) || (ax > bx1 && bx > bx1) || (az < land.z0 && bz < land.z0) || (az > bz1 && bz > bz1);
    for (const pts of coast) {
      for (let k = 0; k + 3 < pts.length; k += 2) {
        if (!outside(pts[k], pts[k + 1], pts[k + 2], pts[k + 3])) stampLine(wall, pts[k], pts[k + 1], pts[k + 2], pts[k + 3], 1);
      }
    }
    // The whole box: the data ends at the box, so coast lines that stop
    // just past it would let land and sea regions meet outside it. A wall
    // along the box closes every region inside (on a region, the sides
    // that are the box's own).
    if (boxSide.z0) stampLine(wall, cut.x0, cut.z0, cut.x1, cut.z0, 1);
    if (boxSide.x1) stampLine(wall, cut.x1, cut.z0, cut.x1, cut.z1, 1);
    if (boxSide.z1) stampLine(wall, cut.x1, cut.z1, cut.x0, cut.z1, 1);
    if (boxSide.x0) stampLine(wall, cut.x0, cut.z1, cut.x0, cut.z0, 1);
    lap('land.coast');
    const label = labelBuf;
    const runs = makeRuns();
    const nLab = labelRegions(wall.data, W, H, label, runs);
    lap('land.fill');
    const votes = new Float64Array(nLab);
    const hits = region ? new Uint8Array(nLab) : null;
    for (const pts of coast) voteCoast(pts, land, label, votes, bx1, bz1, hits);
    applyVotes(runs, votes, land.data);
    if (region) voteUnreached(land, label, nLab, hits, () => coarseLand(data, coast));
    lap('land.votes');
    // Wall cells: majority of their labeled neighbors.
    settleWalls(wall.data, land.data, W, H);
    lap('land.walls');
    // The river (water lines are carved with a width), then lakes and
    // ponds; `coastLand` (before the ponds) tells bridges over water.
    const polys = [];
    for (const w of data.water) {
      const pts = decodePolyline(w.p);
      if (!w.line) { polys.push(pts); continue; }
      const r = RIVERS[w.name];
      if (!r) continue;
      for (let k = 0; k + 3 < pts.length; k += 2) stampCapsule(land, pts[k], pts[k + 1], pts[k + 2], pts[k + 3], r, 0);
    }
    coastLand = land.data.slice();
    for (const pts of polys) {
      let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
      for (let k = 0; k < pts.length; k += 2) {
        x0 = Math.min(x0, pts[k]); x1 = Math.max(x1, pts[k]);
        z0 = Math.min(z0, pts[k + 1]); z1 = Math.max(z1, pts[k + 1]);
      }
      if (Math.min(x1 - x0, z1 - z0) >= 12) fillPolygon(land, pts, 0);
    }
    lap('land.water');
    // The cut: nothing outside the crop margin is land.
    const ci0 = Math.ceil((cut.x0 - land.x0) / CELL - 0.5), ci1 = Math.floor((cut.x1 - land.x0) / CELL - 0.5);
    for (let j = 0; j < H; j++) {
      const z = land.z0 + (j + 0.5) * CELL;
      if (z < cut.z0 || z > cut.z1) land.data.fill(0, j * W, (j + 1) * W);
      else {
        land.data.fill(0, j * W, j * W + ci0);
        land.data.fill(0, j * W + ci1 + 1, (j + 1) * W);
      }
    }
    return coastLand;
  })();
  let baseLand = land.data.slice(); // before the islet: "is it real land"
  // Hot lookups read the raster bounds from constants, not the raster
  // object (whose shape the optimizer may see change during the build).
  const landCell = cellLookup(land);
  lap('land');

  // ---- 2. Roads: drivable ways inside the crop. ----
  const CX0 = crop.x0, CX1 = crop.x1, CZ0 = crop.z0, CZ1 = crop.z1;
  const inCrop = (x, z) => x >= CX0 && x <= CX1 && z >= CZ0 && z <= CZ1;
  // The road graph (buildRoadGraph: module functions, so every loop of
  // the stage runs optimized).
  const { nodes, edges, cuts, joined, pairMerge } = buildRoadGraph(data, S, crop, landCell, coastLand, baseLand);
  lap('graph');

  // ---- 3. Airfield islet and causeway (citygen's layout, placed here). ----
  // Only where the region holds the islet and the street it leaves from
  // (Downtown and North share Gullwing); elsewhere there is none.
  const AF = S.airfield;
  const IW = 300;
  const hasAirfield = !!AF && inRegion(region, AF.x, AF.z) && inRegion(region, AF.isletX0, AF.z - 205) && inRegion(region, AF.isletX1, AF.z - 205 + IW);
  // Anchor: the shore end of the street the causeway leaves from.
  const anchor = hasAirfield ? nearestLinkedNode(nodes, AF.x, AF.z) : null;
  const islet = anchor ? { x0: AF.isletX0, z0: anchor.z - 205, x1: AF.isletX1, z1: anchor.z - 205 + IW } : null;
  const roadHalf = STREET_W / 2;
  const causewayProf = roadProfile({ class: 'tertiary', bridge: 1 });
  let gate = null;
  const extraLand = [];
  if (islet) {
    gate = { id: nodes.length, i: -1, j: -1, x: islet.x0 + 60, z: anchor.z, hx: roadHalf, hz: roadHalf, edges: [], signal: false, stop: false, blade: false, signalSrc: '' };
    nodes.push(gate);
    const L = gate.x - anchor.x;
    const P = causewayProf;
    edges.push({
      id: edges.length, a: anchor.id, b: gate.id, horizontal: true, width: P.width, avenue: false, length: L, ux: 1, uz: 0, causeway: true, bridge: false, oneway: false, cls: 'causeway', name: 'Gullwing Causeway',
      lanesF: P.lanesF, lanesB: P.lanesB, laneW: P.laneW, parkL: 0, parkR: 0, median: 0, center: 0, off: 0, sidewalk: 0, ped: false, divided: false, pair: -1, mph: 35, lanesTag: 0,
    });
    anchor.edges.push(edges.length - 1);
    gate.edges.push(edges.length - 1);
    const causewayRect = { x0: anchor.x - 30, z0: anchor.z - roadHalf - 4, x1: islet.x0 + 30, z1: anchor.z + roadHalf + 4 };
    extraLand.push(islet, causewayRect);
  }

  // Keep the largest connected road network only.
  const kept = keepMainNetwork(nodes, edges, joined);
  const graphStats = kept.stats;
  graphStats.pairMerge = { runs: pairMerge.runs, collapsed: pairMerge.collapsed, kept: pairMerge.kept, legs: pairMerge.legs };
  if (gate && (gate.id >= nodes.length || nodes[gate.id] !== gate)) throw new Error('miami: the airfield causeway is not on the main road network');
  signalsAndStops(edges, data, kept.juncGrid, kept.juncs);
  lap('network');

  // ---- 4. Spatial index of edges; shoreDist with every road on land. ----
  const gx0 = land.x0, gz0 = land.z0;
  const gw = Math.ceil((W * CELL) / GRID), gh = Math.ceil((H * CELL) / GRID);
  const buildIndex = (count, B) => gridIndex(count, B, gx0, gz0, gw, gh);
  const edgeIndex = buildIndex(edges.length, (() => {
    const B = new Float64Array(4 * edges.length);
    for (let k = 0; k < edges.length; k++) {
      // + 4 m: room for a paired one-way's `off` (set just below).
      const e = edges[k], a = nodes[e.a], b = nodes[e.b], r = e.width / 2 + 4;
      B[4 * k] = Math.min(a.x, b.x) - r; B[4 * k + 1] = Math.min(a.z, b.z) - r; B[4 * k + 2] = Math.max(a.x, b.x) + r; B[4 * k + 3] = Math.max(a.z, b.z) + r;
    }
    return B;
  })());
  const gridCell = (x, z) => {
    const i = Math.floor((x - gx0) / GRID), j = Math.floor((z - gz0) / GRID);
    return i < 0 || j < 0 || i >= gw || j >= gh ? -1 : j * gw + i;
  };
  // The ids of every edge whose index cells touch the rect, each once, in
  // index order, into EIDS; returns the count. The callers loop over them
  // themselves (one callback for all of them ran polymorphic). Not
  // re-entrant: a caller is done with EIDS before the next call.
  const edgeSeen = new Int32Array(edges.length);
  const EIDS = new Int32Array(edges.length);
  let edgeMark = 0;
  const edgeIds = (x0, z0, x1, z1) => {
    const i0 = Math.max(0, Math.floor((x0 - gx0) / GRID)), i1 = Math.min(gw - 1, Math.floor((x1 - gx0) / GRID));
    const j0 = Math.max(0, Math.floor((z0 - gz0) / GRID)), j1 = Math.min(gh - 1, Math.floor((z1 - gz0) / GRID));
    const mark = ++edgeMark, start = edgeIndex.start, items = edgeIndex.items;
    let n = 0;
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const c = j * gw + i;
        for (let k = start[c]; k < start[c + 1]; k++) {
          const id = items[k];
          if (edgeSeen[id] === mark) continue;
          edgeSeen[id] = mark;
          EIDS[n++] = id;
        }
      }
    }
    return n;
  };
  // The strip of an edge: its node line moved `off` to the right.
  const SEG = [0, 0, 0, 0];
  let STRIPS = null;
  const stripOf = (e) => {
    const a = nodes[e.a], b = nodes[e.b], o = e.off || 0;
    SEG[0] = a.x - e.uz * o; SEG[1] = a.z + e.ux * o; SEG[2] = b.x - e.uz * o; SEG[3] = b.z + e.ux * o;
    return SEG;
  };
  // Divided roads (2.1 item 4): one-way carriageways of one name paired,
  // with a raised median as wide as the data gap leaves.
  graphStats.paired = pairDivided(nodes, edges, edgesNear);
  // Junction polygons, strip ends, bends and tapers (world/junctions.js).
  const roadGeo = buildRoadGeo(nodes, edges, edgesNear);
  // Where the strip of edge e starts, from node id: past the junction box
  // and the junction polygon (props stand back from both).
  const trimAt = (e, id) => Math.max(nodes[id].hx, roadGeo.trim[2 * e.id + (e.b === id ? 1 : 0)]);
  // The strips are final from here on (pairDivided set `off`): edgesNear
  // reads them from flat arrays, x0, z0, x1, z1 and half the width per
  // edge (the edge objects come in many shapes).
  STRIPS = new Float64Array(5 * edges.length);
  for (let k = 0; k < edges.length; k++) {
    const g = stripOf(edges[k]);
    STRIPS[5 * k] = g[0]; STRIPS[5 * k + 1] = g[1]; STRIPS[5 * k + 2] = g[2]; STRIPS[5 * k + 3] = g[3]; STRIPS[5 * k + 4] = edges[k].width / 2;
  }
  lap('junctions');
  // Distance from a rect to the nearest road strip edge (negative = overlap).
  const roadClearance = (x0, z0, x1, z1, skip = null) => {
    let best = Infinity;
    const n = edgeIds(x0 - 12, z0 - 12, x1 + 12, z1 + 12);
    for (let k = 0; k < n; k++) {
      const e = edges[EIDS[k]];
      if (e === skip) continue;
      const a = nodes[e.a], b = nodes[e.b];
      if (rectGap(a.x, a.z, b.x, b.z, x0, z0, x1, z1) - e.width / 2 > best + 1e-6) continue;
      const d = segRectDist(a.x, a.z, b.x, b.z, x0, z0, x1, z1) - e.width / 2;
      if (d < best) best = d;
    }
    return best;
  };

  // Shrinks rect r (x0, z0, x1, z1) away from road strips until it is
  // `margin` m clear of every curb. False when it gets below minSize.
  const TR = { x0: 0, z0: 0, x1: 0, z1: 0 };
  function trimRect(r, margin, minSize) {
    for (let k = 0; k < 12; k++) {
      let hit = null;
      const n = edgeIds(r.x0 - 12, r.z0 - 12, r.x1 + 12, r.z1 + 12);
      for (let q = 0; q < n; q++) {
        const e = edges[EIDS[q]];
        const a = nodes[e.a], b = nodes[e.b];
        if (rectGap(a.x, a.z, b.x, b.z, r.x0, r.z0, r.x1, r.z1) - e.width / 2 > margin - 0.01 + 1e-6) continue;
        if (segRectDist(a.x, a.z, b.x, b.z, r.x0, r.z0, r.x1, r.z1) - e.width / 2 < margin - 0.01) { hit = e; break; }
      }
      if (!hit) return true;
      const a = nodes[hit.a], b = nodes[hit.b];
      const half = hit.width / 2 + margin;
      const ccx = (r.x0 + r.x1) / 2, ccz = (r.z0 + r.z1) / 2;
      if (Math.abs(hit.uz) >= Math.abs(hit.ux)) {
        // Mostly north-south: the strip's x range over the rect's z span.
        const za = Math.max(r.z0 - half, Math.min(a.z, b.z)), zb = Math.min(r.z1 + half, Math.max(a.z, b.z));
        const xa = a.x + ((za - a.z) / (b.z - a.z || 1)) * (b.x - a.x), xb = a.x + ((zb - a.z) / (b.z - a.z || 1)) * (b.x - a.x);
        const w = half / Math.abs(hit.uz);
        const lo = Math.min(xa, xb) - w, hi = Math.max(xa, xb) + w;
        if ((lo + hi) / 2 > ccx) r.x1 = Math.min(r.x1, lo); else r.x0 = Math.max(r.x0, hi);
      } else {
        const xa = Math.max(r.x0 - half, Math.min(a.x, b.x)), xb = Math.min(r.x1 + half, Math.max(a.x, b.x));
        const za = a.z + ((xa - a.x) / (b.x - a.x || 1)) * (b.z - a.z), zb = a.z + ((xb - a.x) / (b.x - a.x || 1)) * (b.z - a.z);
        const w = half / Math.abs(hit.ux);
        const lo = Math.min(za, zb) - w, hi = Math.max(za, zb) + w;
        if ((lo + hi) / 2 > ccz) r.z1 = Math.min(r.z1, lo); else r.z0 = Math.max(r.z0, hi);
      }
      if (r.x1 - r.x0 < minSize || r.z1 - r.z0 < minSize) return false;
    }
    return roadClearance(r.x0, r.z0, r.x1, r.z1) >= margin - 0.05;
  }

  // Everything drivable is land for shoreDist (bridges, causeway, roads
  // along a seawall), so a car never meets a seam on a road.
  for (const r of extraLand) stampRect(land, r.x0, r.z0, r.x1, r.z1, 1);
  const visual = land.data.slice(); // land as drawn: real land, islet and causeway
  for (let eIdx = 0; eIdx < edges.length; eIdx++) {
    const e = edges[eIdx];
    const g = stripOf(e);
    // (+1 m on a paired one-way: its strip sits `off` aside of the data
    // line, and the 5 m raster must still hold its outer lane 2 m inland.)
    stampCapsule(land, g[0], g[1], g[2], g[3], e.width / 2 + 3 + (e.median || 0) / 2 + (e.divided ? 1 : 0), 1);
  }
  lap('shore.stamp');
  // (Its sides and column pass in views of the label and queue buffers,
  // which are free until the blocks step: no new rasters.)
  const fieldAll = signedField(land, new Uint8Array(queueBuf.buffer, 0, NC), new Int16Array(labelBuf.buffer, 0, NC));
  lap('shore.field');
  const shoreDist = makeSampler(land, fieldAll);
  // Real land (and the islet) only: no bridges or road strips. Not a
  // true distance at sea (-1 anywhere off the drawn land).
  const visualAt = (x, z) => {
    const c = landCell(x, z);
    return c >= 0 && visual[c] === 1;
  };
  const mainShore = (x, z) => (visualAt(x, z) ? Math.max(0.01, shoreDist(x, z)) : -1);
  lap('shore');

  // ---- 5. Districts (hand table, baked at 32 m). ----
  const DC = 32;
  const dist = makeRaster(land.x0, land.z0, land.x0 + W * CELL, land.z0 + H * CELL, DC);
  for (const r of S.districts) stampRect(dist, r.x0, r.z0, r.x1, r.z1, DKEYS.indexOf(r.key));
  if (islet) stampRect(dist, islet.x0 - 60, islet.z0 - 60, islet.x1 + 60, islet.z1 + 60, DKEYS.indexOf('airfield'));
  const distCell = cellLookup(dist), distData = dist.data;
  function districtOf(x, z) {
    const c = distCell(x, z);
    return c < 0 ? 'midtown' : DKEYS[distData[c]];
  }
  // Real neighborhood names for the HUD (placeOf, below), baked at 16 m:
  // index into placeNames, 0 = none.
  const placeNames = [''];
  const landPlace = makeRaster(land.x0, land.z0, land.x0 + W * CELL, land.z0 + H * CELL, 16);
  const waterPlace = makeRaster(land.x0, land.z0, land.x0 + W * CELL, land.z0 + H * CELL, 16);
  for (const [R, list] of [[landPlace, S.places || []], [waterPlace, S.waterPlaces || []]]) {
    for (const p of list) {
      let k = placeNames.indexOf(p.name);
      if (k < 0) k = placeNames.push(p.name) - 1;
      if (p.line) stampCapsule(R, p.line[0], p.line[1], p.line[2], p.line[3], p.line[4], k);
      else stampRect(R, p.x0, p.z0, p.x1, p.z1, k);
    }
  }

  // ---- 6. Blocks: road-free land regions that are nearly rectangles. ----
  const blocks = [];
  let parkCells; // 1 park or forest, 2 grass (data.parks)
  let blockLab; // region label (its first cell) per land cell, -1 off land and on roads
  (function findBlocks() {
    const road = makeRaster(land.x0, land.z0, land.x0 + W * CELL, land.z0 + H * CELL, CELL);
    for (let eIdx = 0; eIdx < edges.length; eIdx++) {
      const e = edges[eIdx];
      const g = stripOf(e);
      stampCapsule(road, g[0], g[1], g[2], g[3], e.width / 2, 1);
      if (e.median > 0) {
        // The median half along the left curb is not a block.
        const o = -(e.width / 2 + e.median / 4);
        stampCapsule(road, g[0] - e.uz * o, g[1] + e.ux * o, g[2] - e.uz * o, g[3] + e.ux * o, e.median / 4 + 0.5, 1);
      }
    }
    for (const n of nodes) stampRect(road, n.x - n.hx, n.z - n.hz, n.x + n.hx, n.z + n.hz, 1);
    // Park and forest, and grass, polygons (also the lot masks, 8b).
    const parkMask = makeRaster(land.x0, land.z0, land.x0 + W * CELL, land.z0 + H * CELL, CELL);
    // Grass first, so a park wins where the two overlap.
    for (const grassPass of [true, false]) {
      for (const p of data.parks) {
        if ((p.kind === 'grass') !== grassPass) continue;
        const pts = decodePolyline(p.p);
        if (pts.length >= 6 && inCrop(pts[0], pts[1])) fillPolygon(parkMask, pts, grassPass ? 2 : 1);
      }
    }
    parkCells = parkMask.data;
    const lab = labelBuf.fill(-1);
    const ci0 = Math.max(0, Math.floor((crop.x0 - land.x0) / CELL)), ci1 = Math.min(W - 1, Math.floor((crop.x1 - land.x0) / CELL));
    const cj0 = Math.max(0, Math.floor((crop.z0 - land.z0) / CELL)), cj1 = Math.min(H - 1, Math.floor((crop.z1 - land.z0) / CELL));
    // Every road-free land region of the crop window, in scan order.
    const regions = floodRegions(W, ci0, ci1, cj0, cj1, baseLand, road.data, parkMask.data, lab, makeRuns());
    // The block (road-free land region) of each cell, for the infill rule.
    blockLab = lab.slice();
    baseLand = null; // build only (last read just above)
    for (let r = 0; r < regions.length; r += 7) {
      {
        const qt = regions[r], bi0 = regions[r + 1], bi1 = regions[r + 2], bj0 = regions[r + 3], bj1 = regions[r + 4], parks = regions[r + 5], ok = regions[r + 6] === 1;
        const bw = (bi1 - bi0 + 1) * CELL, bh = (bj1 - bj0 + 1) * CELL;
        if (!ok || qt * CELL * CELL < 0.85 * bw * bh || Math.min(bw, bh) < 24 || Math.max(bw, bh) > 320) continue;
        // Start from the cell centers (clear of the road), then grow.
        let x0 = land.x0 + (bi0 + 0.5) * CELL, z0 = land.z0 + (bj0 + 0.5) * CELL, x1 = land.x0 + (bi1 + 0.5) * CELL, z1 = land.z0 + (bj1 + 0.5) * CELL;
        // Clear of every curb first, then grow each side up to the curb.
        TR.x0 = x0; TR.z0 = z0; TR.x1 = x1; TR.z1 = z1;
        const area0 = (x1 - x0) * (z1 - z0);
        if (!trimRect(TR, 0, 20) || (TR.x1 - TR.x0) * (TR.z1 - TR.z0) < area0 * 0.7) continue;
        x0 = TR.x0; z0 = TR.z0; x1 = TR.x1; z1 = TR.z1;
        const step = 0.25;
        for (let k = 0; k < 16 && roadClearance(x0 - step, z0, x1, z1) > 0; k++) x0 -= step;
        for (let k = 0; k < 16 && roadClearance(x0, z0, x1 + step, z1) > 0; k++) x1 += step;
        for (let k = 0; k < 16 && roadClearance(x0, z0 - step, x1, z1) > 0; k++) z0 -= step;
        for (let k = 0; k < 16 && roadClearance(x0, z0, x1, z1 + step) > 0; k++) z1 += step;
        if (mainShore(x0, z0) < 1 || mainShore(x1, z0) < 1 || mainShore(x0, z1) < 1 || mainShore(x1, z1) < 1) continue;
        const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
        let district = districtOf(cx, cz);
        if (district === 'airfield') continue;
        if (parks > qt * 0.5) district = 'park';
        blocks.push({ id: blocks.length, i: 0, j: 0, x0, z0, x1, z1, district });
      }
    }
  })();
  const blockIndex = buildIndex(blocks.length, boxBounds(blocks));
  const blockAt = (x, z) => {
    const c = gridCell(x, z);
    if (c < 0) return null;
    for (let k = blockIndex.start[c]; k < blockIndex.start[c + 1]; k++) {
      const b = blocks[blockIndex.items[k]];
      if (x >= b.x0 && x <= b.x1 && z >= b.z0 && z <= b.z1) return b;
    }
    return null;
  };
  lap('blocks');

  // ---- 7. Buildings: footprints cut into axis-aligned boxes. ----
  const buildings = [];
  // osm: the OSM building kind; fp: the footprint the box was cut from
  // (-1 for made boxes); gen: an infill box (world/lots.js planInfill).
  const addBuilding = (x0, z0, x1, z1, h, district, kind = 'building', color = null, osm = '', fp = -1, gen = false) => {
    // Every field step 11 fills is declared here, so all boxes share one shape.
    // (h is made a double field from the first box: most heights are whole
    // meters, so the first ones made it a small-integer field, and the first
    // fractional one moved every box made so far to a new shape, one by one,
    // when next read: some 33,000 object migrations a build.)
    const o = { x0, z0, x1, z1, h: 0.5, district, kind, color: color ?? rng.pick(PALETTES[district] ?? PALETTES.midtown), osm, fp, gen, landmark: '', style: '', tint: 0, vseed: 0, block: -1, street: 0 };
    o.h = h;
    buildings.push(o);
  };
  (function cutFootprints() {
    const BC = 2;
    const cellsBuf = new Uint8Array(200 * 200);
    const stack = new Int32Array(202);
    const rects = new Int32Array(24);
    const FB4 = new Float64Array(5);
    const R2 = { x0: 0, z0: 0, cell: BC, w: 0, h: 0, data: cellsBuf };
    // A region file (scripts/split-map.mjs) lists the source index of
    // each building: footprint ids stay those of the whole file.
    const srcIds = Array.isArray(data.buildingIds) ? data.buildingIds : null;
    for (let fp = 0; fp < data.buildings.length; fp++) {
      const b = data.buildings[fp];
      if (SKIP_BUILDING.has(b.kind) || !inCrop(b.p[0] / 10, b.p[1] / 10)) continue;
      const pts = decodePolyline(b.p);
      const n = pts.length / 2;
      if (n < 3) continue;
      polyBox(pts, FB4);
      const x0 = FB4[0], z0 = FB4[1], x1 = FB4[2], z1 = FB4[3], area = FB4[4];
      if (area < 25 || !inCrop((x0 + x1) / 2, (z0 + z1) / 2)) continue;
      const cw = Math.ceil((x1 - x0) / BC), ch = Math.ceil((z1 - z0) / BC);
      if (cw < 2 || ch < 2 || cw > 200 || ch > 200) continue;
      // Rasterise at 2 m (cell centers inside the polygon), then the
      // largest all-inside rectangles, until 85 % is covered.
      R2.x0 = x0; R2.z0 = z0; R2.w = cw; R2.h = ch;
      // Pieces after the first under SLIVER m2 are dropped below; one of
      // fewer cells than that is under it whatever its edges (each cell is
      // BC m or less across), so the cover stops at the first such piece.
      const nb = footprintRects(R2, pts, stack, rects, Math.ceil(SLIVER / (BC * BC)));
      if (!nb) continue;
      const kindTag = b.kind || '';
      const h = Math.max(3, b.h || 8);
      for (let k = 0; k < nb; k++) {
        const bi0 = rects[4 * k], bj0 = rects[4 * k + 1], bi1 = rects[4 * k + 2], bj1 = rects[4 * k + 3];
        const bx0 = bi0 === 0 ? x0 : x0 + bi0 * BC, bz0 = bj0 === 0 ? z0 : z0 + bj0 * BC;
        const bx1 = bi1 === cw - 1 ? x1 : x0 + (bi1 + 1) * BC, bz1 = bj1 === ch - 1 ? z1 : z0 + (bj1 + 1) * BC;
        // 0.9.0: a footprint's extra pieces under SLIVER m2 are left out
        // (the first, largest piece always stays): they cost a box each
        // for a strip nobody sees, and the Beach's real footprints (the
        // east strip) must fit the region budget.
        if (k > 0 && (bx1 - bx0) * (bz1 - bz0) < SLIVER) continue;
        placeBox(bx0, bz0, bx1, bz1, h, kindTag, srcIds ? srcIds[fp] : fp);
      }
    }
  })();
  function placeBox(x0, z0, x1, z1, h, tag, fp) {
    const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
    const blk = blockAt(cx, cz);
    if (blk) {
      // Inside a block: keep the sidewalk ring clear.
      x0 = Math.max(x0, blk.x0 + WALK_RING); z0 = Math.max(z0, blk.z0 + WALK_RING);
      x1 = Math.min(x1, blk.x1 - WALK_RING); z1 = Math.min(z1, blk.z1 - WALK_RING);
    } else {
      // Trim the side facing a road until it is clear of the sidewalk.
      TR.x0 = x0; TR.z0 = z0; TR.x1 = x1; TR.z1 = z1;
      if (!trimRect(TR, WALK_CLEAR, 3)) return;
      x0 = TR.x0; z0 = TR.z0; x1 = TR.x1; z1 = TR.z1;
    }
    if (x1 - x0 < 3 || z1 - z0 < 3 || (x1 - x0) * (z1 - z0) < 12) return;
    if (mainShore((x0 + x1) / 2, (z0 + z1) / 2) < 1) return;
    const district = districtOf((x0 + x1) / 2, (z0 + z1) / 2);
    let kind = HOUSE.has(tag) ? 'house' : SHED.has(tag) ? 'warehouse' : 'building';
    if (kind === 'building' && (district === 'docks' || district === 'industrial') && h <= 20) kind = 'warehouse';
    addBuilding(x0, z0, x1, z1, h, district === 'park' || district === 'airfield' ? 'midtown' : district, kind, null, tag, fp);
  }
  lap('buildings');

  // ---- 8. Airfield contents (as citygen, relative to the islet). ----
  const pois = [], aircraftSpots = [], boatSpots = [], surfaces = [], helipads = [], piers = [];
  let runway = null, apron = null;
  if (islet) {
    runway = { x0: islet.x0 + 40, z0: islet.z0 + 40, x1: islet.x1 - 30, z1: islet.z0 + 70, type: 'runway' };
    apron = { x0: islet.x0 + 40, z0: runway.z1, x1: islet.x0 + 470, z1: anchor.z + roadHalf + 30, type: 'apron' };
    surfaces.push(apron, runway);
    for (let k = 0; k < 5; k++) {
      const hx0 = islet.x0 + 110 + k * 70;
      addBuilding(hx0, islet.z1 - 50, hx0 + 52, islet.z1 - 14, rng.range(11, 14), 'industrial', 'warehouse');
    }
    addBuilding(islet.x0 + 480, islet.z1 - 44, islet.x0 + 494, islet.z1 - 30, 34, 'downtown', 'building', 0xcfd6dc);
    const rz = (runway.z0 + runway.z1) / 2;
    aircraftSpots.push({ x: runway.x0 + 30, z: rz, heading: 0, spec: 'prop' });
    ['stunt', 'jet', 'prop'].forEach((spec, k) => {
      aircraftSpots.push({ x: islet.x0 + 150 + k * 60, z: runway.z1 + 34, heading: -Math.PI / 2, spec });
    });
    ['heli', 'heavyheli'].forEach((spec, k) => {
      const hp = { x: islet.x0 + 360 + k * 50, z: runway.z1 + 40 };
      helipads.push(hp);
      aircraftSpots.push({ ...hp, heading: -Math.PI / 2, spec });
    });
    pois.push({ type: 'airfield', x: islet.x0 + 250, z: anchor.z - 60, label: 'Gullwing Airfield' });
  }

  const rectDist = (r, x, z) => {
    const ix = Math.min(x - r.x0, r.x1 - x), iz = Math.min(z - r.z0, r.z1 - z);
    if (ix >= 0 && iz >= 0) return Math.min(ix, iz);
    return -Math.hypot(Math.max(0, -ix), Math.max(0, -iz));
  };
  function addPier(label, x, z, dirX, dirZ, boats, shoreFn) {
    for (let k = 0; k < 600 && shoreFn(x, z) > 0; k++) {
      x += dirX * 2;
      z += dirZ * 2;
    }
    const LEN = 64, HALF = 2.6;
    const ex = x + dirX * LEN, ez = z + dirZ * LEN;
    const bx = x - dirX * 8, bz = z - dirZ * 8;
    const pier = dirX
      ? { x0: Math.min(bx, ex), x1: Math.max(bx, ex), z0: z - HALF, z1: z + HALF }
      : { x0: x - HALF, x1: x + HALF, z0: Math.min(bz, ez), z1: Math.max(bz, ez) };
    pier.label = label;
    piers.push(pier);
    boats.forEach((spec, k) => {
      const side = k % 2 ? 1 : -1;
      const d = 22 + Math.floor(k / 2) * 18;
      const off = HALF + 3.2;
      const sx = dirX ? x + dirX * d : x + side * off;
      const sz = dirX ? z + side * off : z + dirZ * d;
      boatSpots.push({ x: sx, z: sz, heading: Math.atan2(dirZ, dirX), spec });
    });
    pois.push({ type: 'marina', x: x + dirX * 20, z: z + dirZ * 20, label });
    return pier;
  }
  for (const p of S.piers) addPier(p.label, p.x, p.z, p.dx, p.dz, p.boats, mainShore);
  if (islet) {
    addPier('Airfield Dock', islet.x0 + 600, islet.z1 - 2, 0, 1, ['speedboat', 'jetski'], (x, z) => rectDist(islet, x, z));
    const dock = piers[piers.length - 1];
    aircraftSpots.push({ x: dock.x1 + 14, z: dock.z1 - 12, heading: Math.PI / 2, spec: 'seaplane' });
  }
  if (S.seaplane) aircraftSpots.push({ x: S.seaplane.x, z: S.seaplane.z, heading: S.seaplane.heading, spec: 'seaplane' });
  for (const hp of S.helipads || []) helipads.push({ x: hp.x, z: hp.z });

  // Depot (as citygen, explicit colors, no rng).
  const tankSpots = [];
  let depot = null;
  if (islet) {
    const D = { x0: islet.x0 + 520, z0: runway.z1 + 12, x1: islet.x1 - 40, z1: islet.z1 - 24 };
    depot = { ...D, gate: { x: D.x0, z: 0 } };
    const WALL = 0xb7b09c, WALL_H = 2.5, T = 1.2;
    const gz = Math.round((D.z0 + D.z1) / 2);
    depot.gate.z = gz;
    const put = (x0, z0, x1, z1, h, kind, style, color) => {
      buildings.push({ x0, z0, x1, z1, h, district: 'airfield', kind, color, osm: '', fp: -1, gen: false, landmark: '', style, tint: color, vseed: 32032 + buildings.length, block: -1, street: 0, depot: true });
    };
    const wall = (x0, z0, x1, z1) => put(x0, z0, x1, z1, WALL_H, 'container', 'container', WALL);
    wall(D.x0, D.z0 + 30, D.x0 + T, gz - 7);
    wall(D.x0, gz + 7, D.x0 + T, D.z1);
    wall(D.x0, D.z1 - T, D.x1, D.z1);
    wall(D.x1 - T, D.z0 + 30, D.x1, D.z1);
    put(D.x0 - 0.6, gz - 8, D.x0 + 1.8, gz - 7, 3.4, 'container', 'container', 0x8e8a7c);
    put(D.x0 - 0.6, gz + 7, D.x0 + 1.8, gz + 8, 3.4, 'container', 'container', 0x8e8a7c);
    put(D.x0 + 40, D.z1 - 46, D.x0 + 88, D.z1 - 14, 11, 'warehouse', 'hangar', 0x7d8273);
    put(D.x0 + 104, D.z1 - 46, D.x0 + 152, D.z1 - 14, 11, 'warehouse', 'hangar', 0x7d8273);
    put(D.x0 + 12, gz + 18, D.x0 + 28, gz + 30, 5, 'building', 'office', 0xb8b4a6);
    const bayZ = D.z1 - 74;
    for (const bx of [D.x0 + 48, D.x0 + 66, D.x0 + 84]) wall(bx - 0.6, bayZ - 8, bx + 0.6, bayZ + 6);
    wall(D.x0 + 8, gz - 22, D.x0 + 20, gz - 21);
    wall(D.x0 + 8, gz + 40, D.x0 + 20, gz + 41);
    for (const bx of [D.x0 + 57, D.x0 + 75]) tankSpots.push({ x: bx, z: bayZ, heading: -Math.PI / 2, spec: 'rustback', place: 'depot' });
    for (const fx of [D.x0 + 120, D.x0 + 160]) aircraftSpots.push({ x: fx, z: D.z0 + 34, heading: -Math.PI / 2, spec: 'fighter', depot: true });
    const pad = { x: D.x1 - 30, z: gz + 10 };
    helipads.push(pad);
    aircraftSpots.push({ ...pad, heading: Math.PI, spec: 'patrolheli', depot: true });
    surfaces.push({ x0: D.x0, z0: D.z0, x1: D.x1, z1: D.z1, type: 'apron', depot: true });
    pois.push({ type: 'depot', x: D.x0 + 110, z: gz, label: 'Ironbank Depot' });
  }
  if (islet) {
    aircraftSpots.push(
      { x: islet.x0 + 90, z: runway.z1 + 34, heading: -Math.PI / 2, spec: 'fighter' },
      { x: islet.x0 + 448, z: runway.z1 + 40, heading: -Math.PI / 2, spec: 'patrolheli' },
    );
  }

  // ---- 8b. Lot rasters and infill (docs/REVAMP.md 6.2, world/lots.js). ----
  // free: drawn land clear of every road strip and its sidewalk and
  // outside every building box; owner: the building box at a cell. Big
  // empty pieces of built-up districts get plain infill boxes (`gen`).
  let lotIn;
  const landmarkSites = [];
  (function lotRasters() {
    const near = new Uint8Array(NC);
    const R = { x0: land.x0, z0: land.z0, cell: CELL, w: W, h: H, data: near };
    for (let eIdx = 0; eIdx < edges.length; eIdx++) {
      const e = edges[eIdx];
      const g = stripOf(e);
      // The curb and LOT_SETBACK m beyond it (the drawn sidewalk, 1.8 or
      // 3 m, and a verge; lots and infill start past it, as before). A
      // median wider than that band is a lot in its middle.
      stampCapsule(R, g[0], g[1], g[2], g[3], e.width / 2 + SETBACK_IN, 1);
    }
    // (A cell center exactly LOT_SETBACK from a junction box, common with
    // 0.1 m boxes on the 5 m lattice, is free: the band is just short of it,
    // so rounding cannot leave such a cell outside both the band and a lot.)
    for (const n of nodes) stampRect(R, n.x - n.hx - SETBACK_IN, n.z - n.hz - SETBACK_IN, n.x + n.hx + SETBACK_IN, n.z + n.hz + SETBACK_IN, 1);
    const owner = labelBuf.fill(-1); // free since the blocks step
    const LX0 = land.x0, LZ0 = land.z0;
    const stampOwner = (k) => stampOwnerBox(owner, buildings[k], k, LX0, LZ0, W, H);
    for (let k = 0; k < buildings.length; k++) stampOwnerBox(owner, buildings[k], k, LX0, LZ0, W, H);
    lap('infill.stamp');
    // Lot masks: `parkCells` from the blocks step (1 park or forest, 2
    // grass) gets the park district rects too; beaches are rects
    // (MIAMI_SPOTS.beaches), looked up only near the water.
    const parkR = { x0: land.x0, z0: land.z0, cell: CELL, w: W, h: H, data: parkCells };
    for (const r of S.districts) if (r.key === 'park') stampRect(parkR, r.x0, r.z0, r.x1, r.z1, 1);
    // i0, i1, j0, j1 per beach rect.
    const beachRects = new Int32Array((S.beaches || []).length * 4);
    (S.beaches || []).forEach((r, k) => beachRects.set([Math.ceil((r.x0 - land.x0) / CELL - 0.5), Math.floor((r.x1 - land.x0) / CELL - 0.5), Math.ceil((r.z0 - land.z0) / CELL - 0.5), Math.floor((r.z1 - land.z0) / CELL - 0.5)], 4 * k));
    const inBeach = (c) => {
      const i = c % W, j = (c - i) / W;
      for (let k = 0; k < beachRects.length; k += 4) if (i >= beachRects[k] && i <= beachRects[k + 1] && j >= beachRects[k + 2] && j <= beachRects[k + 3]) return true;
      return false;
    };
    const free = new Uint8Array(NC);
    // The free cells in row order (every lot cell is one of them).
    const list = freeCells(visual, near, owner, free, NC, queueBuf); // (the queue is free until the steps below)
    let nList = list.length;
    const mask = parkCells; // never filled: park and grass (a beach is near the water, which infill keeps off)
    // Steps of 5 m to the water and to a building, through free land.
    const water = new Uint8Array(NC);
    stepDistance(W, H, visual, free, 8, water, null, queueBuf, list, nList, SRC_ZERO);
    const bdist = new Uint8Array(NC);
    stepDistance(W, H, owner, free, INFILL_GAP, bdist, null, queueBuf, list, nList, SRC_ID);
    lap('infill.masks');
    // Landmarks (MIAMI_SPOTS.landmarks): a real site's boxes are marked,
    // or a box is stood on free ground near the point.
    for (const L of S.landmarks || []) {
      if (!inCrop(L.x, L.z)) continue;
      const site = { id: L.id, name: L.name, shape: L.shape, x: L.x, z: L.z, l: 0, w: 0, h: L.h, heading: 0, buildings: [] };
      if (L.fit === 'site') {
        let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
        for (const k of boxesWithin(buildings, L.x, L.z, L.r)) {
          const b = buildings[k];
          b.landmark = L.id;
          site.buildings.push(k);
          x0 = Math.min(x0, b.x0); z0 = Math.min(z0, b.z0); x1 = Math.max(x1, b.x1); z1 = Math.max(z1, b.z1);
        }
        if (!site.buildings.length) continue;
        site.x = (x0 + x1) / 2; site.z = (z0 + z1) / 2; site.l = x1 - x0; site.w = z1 - z0;
      } else {
        // Nearest free spot (every cell under the box plus 3 m free).
        let spot = null;
        const hx = L.l / 2 + 3, hz = L.w / 2 + 3;
        for (let r = 0; r <= 150 && !spot; r += 5) {
          const n = r ? Math.max(8, Math.round((TAU * r) / 5)) : 1;
          for (let k = 0; k < n && !spot; k++) {
            const x = L.x + Math.cos((k / n) * TAU) * r, z = L.z + Math.sin((k / n) * TAU) * r;
            const i0 = Math.floor((x - hx - land.x0) / CELL), i1 = Math.floor((x + hx - land.x0) / CELL);
            const j0 = Math.floor((z - hz - land.z0) / CELL), j1 = Math.floor((z + hz - land.z0) / CELL);
            if (allSet(free, W, H, i0, i1, j0, j1)) spot = { x: Math.round(x), z: Math.round(z) };
          }
        }
        if (!spot) continue;
        site.x = spot.x; site.z = spot.z; site.l = L.l; site.w = L.w;
        const dk = districtOf(spot.x, spot.z);
        addBuilding(spot.x - L.l / 2, spot.z - L.w / 2, spot.x + L.l / 2, spot.z + L.w / 2, L.h, dk === 'park' || dk === 'airfield' ? 'midtown' : dk, 'building', 0xd8d4cc, 'landmark', -1, false);
        buildings[buildings.length - 1].landmark = L.id;
        site.buildings.push(buildings.length - 1);
        stampOwner(buildings.length - 1);
        const b = buildings[buildings.length - 1];
        const ci0 = Math.max(0, Math.floor((b.x0 - land.x0) / CELL)), ci1 = Math.min(W - 1, Math.floor((b.x1 - land.x0) / CELL));
        const cj0 = Math.max(0, Math.floor((b.z0 - land.z0) / CELL)), cj1 = Math.min(H - 1, Math.floor((b.z1 - land.z0) / CELL));
        clearOwned(free, owner, W, ci0, ci1, cj0, cj1);
      }
      landmarkSites.push(site);
    }
    // Hand places keep their open ground.
    const keep = [];
    for (const h of S.helipads || []) keep.push({ x: h.x, z: h.z, r: 30 });
    for (const v of Object.values(S.secrets || {})) if (v.x !== undefined) keep.push({ x: v.x, z: v.z, r: 60 });
    if (S.cinder) keep.push({ x: S.cinder.x, z: S.cinder.z, r: 60 });
    for (const p of S.piers) keep.push({ x: p.x, z: p.z, r: 40 });
    for (const r of S.ramps || []) keep.push({ x: r.x, z: r.z, r: 40 });
    for (const l of S.landmarks || []) keep.push({ x: l.x, z: l.z, r: (l.r || 20) + 10 });
    const planned = planInfill({ W, H, x0: land.x0, z0: land.z0, cell: CELL, free, bdist, water, mask, districtOf, seed, keep });
    // The infill rule (docs/PLAN_V3.md 2.1 item 9): real footprints
    // always; infill only on blocks with no footprint at all (outside the
    // core, whose density the first view was tuned on), and then by the
    // neighborhood's style (MIAMI_SPOTS.infillStyles): floors, palette and
    // where towers may stand (by the water, or along a named street).
    const cellAt = (x, z) => {
      const i = Math.floor((x - land.x0) / CELL), j = Math.floor((z - land.z0) / CELL);
      return i < 0 || j < 0 || i >= W || j >= H ? -1 : j * W + i;
    };
    const fpBlock = new Uint8Array(NC);
    if (blockLab) markFootprintBlocks(buildings, blockLab, fpBlock, land.x0, land.z0, W, H);
    const styles = S.infillStyles || [];
    const styleAt = (x, z) => {
      let st = null;
      for (const r of styles) if (x >= r.x0 && x <= r.x1 && z >= r.z0 && z <= r.z1) st = r;
      return st;
    };
    const towerNear = [];
    const infill = [];
    for (const f of planned) {
      const cx = (f.x0 + f.x1) / 2, cz = (f.z0 + f.z1) / 2;
      if (!(cx >= MIAMI_CORE.x0 && cx <= MIAMI_CORE.x1 && cz >= MIAMI_CORE.z0 && cz <= MIAMI_CORE.z1)) {
        const c = cellAt(cx, cz);
        const L = c >= 0 && blockLab ? blockLab[c] : -1;
        if (L >= 0 && fpBlock[L]) continue;
      }
      const st = styleAt(cx, cz);
      if (st) {
        const c = cellAt(cx, cz);
        let tower = c >= 0 && water[c] < (st.towerWater || 0) / CELL;
        if (!tower && st.towerStreets) {
          edgesNear(cx, cz, st.towerReach || 60, towerNear);
          for (const id of towerNear) if (st.towerStreets.includes(edges[id].name)) tower = true;
        }
        const floors = st.floors[0] + Math.floor(f.color * 997 % 1 * (st.floors[1] - st.floors[0] + 1));
        if (!tower || f.h < floors * 3.2) f.h = Math.round(floors * 3.2 + 1);
        f.kind = 'building';
        if (st.palette) f.palette = st.palette;
      }
      infill.push(f);
    }
    for (const f of infill) {
      const pal = PALETTES[f.palette || f.district] || PALETTES.midtown;
      addBuilding(f.x0, f.z0, f.x1, f.z1, f.h, f.district, f.kind, pal[Math.floor(f.color * pal.length)], f.osm, -1, true);
      stampOwner(buildings.length - 1);
    }
    for (const f of infill) {
      // The new boxes' cells are no longer free.
      const i0 = Math.max(0, Math.floor((f.x0 - land.x0) / CELL)), i1 = Math.min(W - 1, Math.floor((f.x1 - land.x0) / CELL));
      const j0 = Math.max(0, Math.floor((f.z0 - land.z0) / CELL)), j1 = Math.min(H - 1, Math.floor((f.z1 - land.z0) / CELL));
      clearOwned(free, owner, W, i0, i1, j0, j1);
    }
    {
      // Landmark and infill boxes took some cells.
      nList = keepFree(list, nList, free);
    }
    lap('infill.plan');
    // (The block labels and the owner raster are spent: buildLots reuses
    // them for its nearest-box raster and its lot ids.)
    lotIn = { free, owner, park: parkCells, inBeach, water, queue: queueBuf, list, nList, scratch8: near, scratch32: blockLab, lidBuf: owner };
    blockLab = null; // build only
  })();
  lap('infill');

  // Building index (for spots, props and buildingsNear).
  // (BBOX keeps every box as flat x0, z0, x1, z1: the boxes do not move
  // after this, and the hot tests below read no objects.)
  const BBOX = boxBounds(buildings);
  const buildingIndex = buildIndex(buildings.length, BBOX);
  const buildingSeen = new Int32Array(buildings.length);
  let buildingMark = 0;
  const inBuilding = (x, z, m = 0) => {
    const c = gridCell(x, z);
    if (c < 0) return false;
    const items = buildingIndex.items;
    for (let k = buildingIndex.start[c], k1 = buildingIndex.start[c + 1]; k < k1; k++) {
      const q = 4 * items[k];
      if (x > BBOX[q] - m && x < BBOX[q + 2] + m && z > BBOX[q + 1] - m && z < BBOX[q + 3] + m) return true;
    }
    return false;
  };
  const isGround = (x, z) => {
    if (shoreDist(x, z) > 0) return true;
    for (let i = 0; i < piers.length; i++) {
      const r = piers[i];
      if (x >= r.x0 && x <= r.x1 && z >= r.z0 && z <= r.z1) return true;
    }
    return false;
  };
  const isLand = (x, z) => shoreDist(x, z) > 0;
  const onRoad = (x, z) => {
    const c = gridCell(x, z);
    if (c < 0) return false;
    for (let k = edgeIndex.start[c]; k < edgeIndex.start[c + 1]; k++) {
      const e = edges[edgeIndex.items[k]];
      const g = stripOf(e);
      const h = e.width / 2 + 0.3;
      if (boxFar(x, z, g[0], g[1], g[2], g[3], h)) continue;
      if (segDist2(x, z, g[0], g[1], g[2], g[3]) < h * h) return true;
    }
    return false;
  };
  // Other edge strips at a point, ignoring `own`.
  const onOtherRoad = (x, z, own, m) => {
    const n = edgeIds(x - 1, z - 1, x + 1, z + 1);
    for (let k = 0; k < n; k++) {
      const e = edges[EIDS[k]];
      if (e === own) continue;
      const a = nodes[e.a], b = nodes[e.b], h = e.width / 2 + m;
      if (boxFar(x, z, a.x, a.z, b.x, b.z, h)) continue;
      if (segDist2(x, z, a.x, a.z, b.x, b.z) < h * h) return true;
    }
    return false;
  };
  const inJunctionBox = (x, z, m) => {
    const cnt = edgeIds(x - 1, z - 1, x + 1, z + 1);
    for (let k = 0; k < cnt; k++) {
      const e = edges[EIDS[k]];
      // Both end nodes, a first.
      for (let q = 0; q < 2; q++) {
        const n = nodes[q ? e.b : e.a];
        if (n.edges.length !== 2 && Math.abs(x - n.x) < n.hx + m && Math.abs(z - n.z) < n.hz + m) return true;
      }
    }
    return onJunction(roadGeo, x, z);
  };

  // ---- 9. Spawn: on the named street, near the given point. ----
  let spawn;
  (function placeSpawn() {
    let best = null, bd = Infinity;
    const LP = { x: 0, z: 0 };
    for (let eIdx = 0; eIdx < edges.length; eIdx++) {
      const e = edges[eIdx];
      if (e.name !== S.spawn.street || e.causeway) continue;
      const a = nodes[e.a], b = nodes[e.b];
      for (let d = Math.min(e.length / 2, 12); d <= e.length - 12; d += 2) {
        // Right-hand lane of the direction closest to the wanted heading
        // (a one-way only along its own direction).
        const fwd = Math.cos(S.spawn.heading) * e.ux + Math.sin(S.spawn.heading) * e.uz >= 0;
        if (e.oneway && !fwd) continue;
        const from = fwd ? a : b, ux = fwd ? e.ux : -e.ux, uz = fwd ? e.uz : -e.uz;
        const off = laneOffset(e, (fwd ? e.lanesF : e.lanesB) - 1, fwd);
        const dd = fwd ? d : e.length - d;
        LP.x = from.x + ux * dd - uz * off;
        LP.z = from.z + uz * dd + ux * off;
        const dist = Math.hypot(LP.x - S.spawn.x, LP.z - S.spawn.z);
        if (dist < bd && !inBuilding(LP.x, LP.z, 3) && !inJunctionBox(LP.x, LP.z, 4)) {
          bd = dist;
          best = { x: LP.x, z: LP.z, heading: Math.atan2(uz, ux) };
        }
      }
    }
    if (!best) {
      const n = nodes.reduce((p, q) => (Math.hypot(q.x - S.spawn.x, q.z - S.spawn.z) < Math.hypot(p.x - S.spawn.x, p.z - S.spawn.z) ? q : p), nodes[0]);
      best = { x: n.x, z: n.z, heading: 0 };
    }
    spawn = best;
  })();

  // ---- 10. Curb parking, lamps, street trees, signals. ----
  const parkingSpots = [], props = [], furniture = [], signals = [];
  // Where each lamp, tree, signal and stop sign was meant to stand (edge,
  // side, d, m from the curb, slide): world/streetscape.js settles them on
  // the real profile once the city is made (no rng there).
  const SPEC = new Map();
  const spec = (item, eIdx, side, d, want, slide = 0) => { SPEC.set(item, [eIdx, side, d, want, slide]); return item; };
  const dr = createRng(seed ^ 0x5eed51);
  (function streetProps() {
    for (let eIdx = 0; eIdx < edges.length; eIdx++) {
      const e = edges[eIdx];
      const a = nodes[e.a];
      const half = e.width / 2;
      const startPad = trimAt(e, e.a) + 6, endPad = trimAt(e, e.b) + 6;
      const usable = e.length - a.hx - nodes[e.b].hx - 12; // (the old box pads: the seeded curb spots)
      const rx = -e.uz, rzv = e.ux; // right of a -> b
      if (!e.bridge && !e.causeway) {
        for (let d = startPad; d <= e.length - endPad; d += 34) {
          const side = ((d / 34) | 0) % 2 ? 1 : -1;
          const lo = (e.off || 0) + side * (half + 0.8);
          const x = a.x + e.ux * d + rx * lo, z = a.z + e.uz * d + rzv * lo;
          if (inBuilding(x, z, 0.5) || onOtherRoad(x, z, e, 0.3) || mainShore(x, z) < 1) continue;
          props.push(spec({ type: 'lamp', x, z, r: 0.18, h: 7, rot: Math.atan2(-rx * side, -rzv * side) }, eIdx, side, d, 0.8));
        }
      }
      if (!e.causeway && !e.bridge && usable > 14) {
        // Curb spots only in the parking lanes of the profile (2.1 item 3),
        // in the middle of the lane; cars face the traffic of their side (on
        // a one-way street both curbs face its direction).
        for (let side = -1; side <= 1; side += 2) {
          const park = side > 0 ? e.parkR : e.parkL;
          if (!(park > 0)) continue;
          // (The old box pads, so the seeded draws and the hand-placed
          // service bays stay where they were; a spot on a junction's
          // asphalt is dropped by inJunctionBox.)
          for (let d = a.hx + 9; d < e.length - nodes[e.b].hx - 9; d += 6.5) {
            // (0.15 WP1) A spot on CURB_FILL of the slots, by a hash of the
            // slot's place (no rng); the seeded draw is still made, so the
            // draws after it in the stream are the ones they were.
            rng.chance(0.22);
            if (hash32(CURB_SEED, Math.round((a.x + e.ux * d) * 2), Math.round((a.z + e.uz * d) * 2), side + 1) >= CURB_FILL * 4294967296) continue;
            // (0.13.8: in the parking lane as drawn, tapers and side
            // shifts included, not the edge's nominal cross section.)
            const C = curbsAt(roadGeo, e, d);
            const off = side > 0 ? C.r - GUTTER - PARK_W / 2 : C.l + GUTTER + PARK_W / 2;
            const x = a.x + e.ux * d + rx * off, z = a.z + e.uz * d + rzv * off;
            if (mainShore(x, z) < 3 || inBuilding(x, z, 1.5) || onOtherRoad(x, z, e, 1.5) || inJunctionBox(x, z, 3)) continue;
            const heading = side > 0 || e.oneway ? Math.atan2(e.uz, e.ux) : Math.atan2(-e.uz, -e.ux);
            parkingSpots.push({ x, z, heading, lot: false });
          }
        }
      }
    }
    // The service homes' marked curb bays (entities/servicevehicles.js,
    // `curb: true`) are curb spots whatever the seeded draws above gave
    // (0.13.7: the draws run in one sequence over every edge, so a parking
    // lane changed anywhere moved them), where the point lies in the middle
    // of a parking lane of an edge, clear of its junction boxes.
    for (let k = 0; k < CURB_BAYS.length; k += 3) {
      const x = CURB_BAYS[k], z = CURB_BAYS[k + 1];
      if (!inCrop(x, z) || anyWithin(parkingSpots, x, z, 0.5)) continue;
      for (let eIdx = 0; eIdx < edges.length; eIdx++) {
        const e = edges[eIdx], a = nodes[e.a];
        if (e.causeway || e.bridge) continue;
        const d = (x - a.x) * e.ux + (z - a.z) * e.uz, s = -(x - a.x) * e.uz + (z - a.z) * e.ux;
        if (d < a.hx + 9 || d > e.length - nodes[e.b].hx - 9) continue;
        const side = s - (e.off || 0) > 0 ? 1 : -1;
        if (!((side > 0 ? e.parkR : e.parkL) > 0)) continue;
        if (Math.abs(s - (e.off || 0) - side * (e.width / 2 - GUTTER - PARK_W / 2)) > 0.3) continue;
        parkingSpots.push({ x, z, heading: CURB_BAYS[k + 2], lot: false });
        break;
      }
    }
    const TREE_P = { downtown: 0.55, midtown: 0.5, residential: 0.7, beach: 0.7, docks: 0.08, industrial: 0.1, park: 0.7, airfield: 0 };
    for (let eIdx = 0; eIdx < edges.length; eIdx++) {
      const e = edges[eIdx];
      if (e.causeway || e.bridge) continue;
      const a = nodes[e.a];
      const half = e.width / 2;
      const rx = -e.uz, rzv = e.ux;
      const dEnd = e.length - trimAt(e, e.b); // (read once, not per step)
      for (let side = -1; side <= 1; side += 2) {
        const treeP = TREE_P[districtOf(a.x, a.z)] ?? 0.3;
        for (let d = trimAt(e, e.a) + 10; d + 10 <= dEnd; d += 24) {
          if (!dr.chance(treeP)) continue;
          const lo = (e.off || 0) + side * (half + 1.15);
          const x = a.x + e.ux * d + rx * lo, z = a.z + e.uz * d + rzv * lo;
          if (!blockAt(x, z) || inBuilding(x, z, 1) || onOtherRoad(x, z, e, 0.5)) continue;
          furniture.push(spec({ type: 'streettree', x, z, rot: dr.range(0, TAU), q: 0, v: dr.next() }, eIdx, side, d, 1.15));
        }
      }
    }
    for (let nIdx = 0; nIdx < nodes.length; nIdx++) {
      const n = nodes[nIdx];
      if (!n.signal || n.i < 0) continue;
      for (const eid of n.edges) {
        const e = edges[eid];
        // (None inside a junction: on an edge between two of its nodes.)
        if (roadGeo.inner[eid]) continue;
        const o = nodes[e.a === n.id ? e.b : e.a];
        const l = Math.hypot(n.x - o.x, n.z - o.z);
        const tx = (n.x - o.x) / l, tz = (n.z - o.z) / l;
        const rx = -tz, rzv = tx;
        // The right curb of the approach (the strip may sit `off` aside).
        const rc = e.width / 2 + 0.9 + (e.b === n.id ? e.off || 0 : -(e.off || 0));
        const x = n.x - tx * (trimAt(e, n.id) + 0.9) + rx * rc;
        const z = n.z - tz * (trimAt(e, n.id) + 0.9) + rzv * rc;
        if (inBuilding(x, z, 0.5) || onOtherRoad(x, z, e, 0.2)) continue;
        const fwd = e.b === n.id, back = trimAt(e, n.id) + 0.9;
        signals.push(spec({ node: n.id, x, z, face: Math.atan2(-tz, -tx), armDir: Math.atan2(-rzv, -rx), armLen: (e.width / 2) * 0.5 + 0.9, horizontal: e.horizontal },
          eid, fwd ? 1 : -1, fwd ? e.length - back : back, 0.9, fwd ? -1 : 1));
      }
    }
  })();

  // ---- 10b. The designed start street (MIAMI_SPOTS.startView, core hand
  // content): street trees on both curbs and curb spaces (`start`, filled
  // first) along the spawn street ahead of the title camera. No rng.
  (function startStreet() {
    if (S.startView) {
      const fx = Math.cos(spawn.heading), fz = Math.sin(spawn.heading);
      const TREE_STEP = 7, SPOT_STEP = 6.5;
      // The two framed views stay clear of trunks and posts (docs/PLAN_V1.md
      // W2b): the title shot (a cone of FRAME_DEG round the view line within
      // FRAME_R m, along the whole dolly) and the near sidewalk in front of
      // the chase camera at the start (NEAR_R m, the width of the view).
      const cam = S.startView.camera;
      const FRAME_DEG = 9.5, FRAME_R = 42, NEAR_R = 16.5, NEAR_DEG = 55, CHASE_BACK = 7.5;
      const tanF = Math.tan((FRAME_DEG * Math.PI) / 180), cosN = Math.cos((NEAR_DEG * Math.PI) / 180);
      // The camera poses along the dolly (camera, look direction and its
      // length), made once: they do not depend on the point tested.
      const POSE = [];
      for (let d = 0; d <= cam.dolly + 1e-9; d += cam.dolly / 4 || 1) {
        // Camera and look point as in render/titlecam.js titlePose.
        const cx = spawn.x + fx * (d - cam.back) - fz * cam.side, cz = spawn.z + fz * (d - cam.back) + fx * cam.side;
        const lx = spawn.x + fx * (d + cam.lookAhead) - cx, lz = spawn.z + fz * (d + cam.lookAhead) - cz;
        POSE.push(cx, cz, lx, lz, Math.hypot(lx, lz));
        if (!cam.dolly) break;
      }
      const framed = (x, z, r) => {
        for (let k = 0; k < POSE.length; k += 5) {
          const cx = POSE[k], cz = POSE[k + 1], lx = POSE[k + 2], lz = POSE[k + 3], ll = POSE[k + 4];
          const along = ((x - cx) * lx + (z - cz) * lz) / ll, lat = Math.abs((x - cx) * lz - (z - cz) * lx) / ll;
          if (along > 0 && along < FRAME_R + r && lat - r < along * tanF) return true;
          // Nothing tall right in front of the title camera either.
          if (along > 0 && along < NEAR_R && along > lat * 0.8) return true;
        }
        const qx = x - (spawn.x - fx * CHASE_BACK), qz = z - (spawn.z - fz * CHASE_BACK), q = Math.hypot(qx, qz);
        return q < NEAR_R && (qx * fx + qz * fz) > q * cosN;
      };
      const TALL = new Set(['streettree', 'palmtree', 'lamp', 'shelter', 'streetsign', 'namesign', 'stopsign', 'umbrella']);
      const keep = (list) => {
        let n = 0;
        for (let k = 0; k < list.length; k++) { const f = list[k]; if (!(TALL.has(f.type) && framed(f.x, f.z, 0.5))) list[n++] = f; }
        list.length = n;
      };
      keep(props);
      keep(furniture);
      for (let eIdx = 0; eIdx < edges.length; eIdx++) {
        const e = edges[eIdx];
        if (e.name !== S.spawn.street || e.bridge || e.causeway) continue;
        const a = nodes[e.a];
        const half = e.width / 2;
        const rx = -e.uz, rzv = e.ux;
        let prevSlot = null;
        const dEnd = e.length - trimAt(e, e.b) - 4; // (read once, not per step)
        for (let d = trimAt(e, e.a) + 4; d <= dEnd; d += 1) {
          const px = a.x + e.ux * d, pz = a.z + e.uz * d;
          const along = (px - spawn.x) * fx + (pz - spawn.z) * fz;
          const lat = -(px - spawn.x) * fz + (pz - spawn.z) * fx;
          if (along < -20 || along > 110 || Math.abs(lat) > 12) continue;
          // One tree slot each TREE_STEP m of `along` (the first meter step
          // into a new slot), so no slot is skipped or doubled by rounding.
          const slot = Math.floor((along + 20) / TREE_STEP);
          const newSlot = slot !== prevSlot;
          prevSlot = slot;
          const k = slot * TREE_STEP;
          for (let side = -1; side <= 1; side += 2) {
            if (newSlot) {
              // On the curb line, or set back into the plaza where the curb
              // line is in a framed view.
              for (let q = 0; q < 2; q++) {
                const off = q ? 4.8 : 1.15;
                const x = px + rx * side * (half + off), z = pz + rzv * side * (half + off);
                if (framed(x, z, off > 2 ? 1.5 : 0.5)) continue;
                if (!inBuilding(x, z, 1.2) && !onOtherRoad(x, z, e, 0.5) && !inJunctionBox(x, z, 2) && mainShore(x, z) > 2 && !anyWithin(furniture, x, z, 4)) {
                  furniture.push(spec({ type: 'streettree', x, z, rot: (k * 0.61) % TAU, q: 0, v: ((k * 37 + (side > 0 ? 11 : 0)) % 100) / 100 }, eIdx, side, d, off));
                }
                break;
              }
            }
            if (Math.round(along * 2) % Math.round(SPOT_STEP * 2) === 0 && along > 10 && along < 90) {
              // In the parking lane of that curb (MIAMI_SPOTS.curbParking).
              if (!((side > 0 ? e.parkR : e.parkL) > 0)) continue;
              const off = (e.off || 0) + side * (half - GUTTER - PARK_W / 2);
              const x = px + rx * off, z = pz + rzv * off;
              if (mainShore(x, z) < 3 || inBuilding(x, z, 1.5) || onOtherRoad(x, z, e, 1.5) || inJunctionBox(x, z, 3)) continue;
              if (anyWithin(parkingSpots, x, z, 5.5)) continue;
              const heading = side > 0 ? Math.atan2(e.uz, e.ux) : Math.atan2(-e.uz, -e.ux);
              parkingSpots.push({ x, z, heading, lot: false, start: true });
            }
          }
        }
      }
    }
  })();
  // The first light ahead of the start along the start street turns green
  // as the game starts (`node.phase`, citygen.js signalState), so the first
  // view's cars drive off. (0.13.7: the phase came from the node id alone,
  // and the road logic renumbered the nodes: the light stayed red for the
  // whole first view.)
  (function startLight() {
    if (!S.startView) return;
    const fx = Math.cos(spawn.heading), fz = Math.sin(spawn.heading);
    let cur = null, at = -1, bd = 8;
    for (let k = 0; k < edges.length; k++) {
      const e = edges[k], a = nodes[e.a];
      const t = (spawn.x - a.x) * e.ux + (spawn.z - a.z) * e.uz;
      if (t < 0 || t > e.length || Math.abs(e.ux * fx + e.uz * fz) < 0.9) continue;
      const d = Math.abs(-(spawn.x - a.x) * e.uz + (spawn.z - a.z) * e.ux);
      if (d < bd) { bd = d; cur = e; at = e.ux * fx + e.uz * fz > 0 ? e.b : e.a; }
    }
    // (At most 64 hops as well: a run of very short or zero-length edges
    // would never add up to 400 m.)
    for (let walked = 0, hops = 0; cur && walked < 400 && hops < 64; hops++) {
      const n = nodes[at];
      if (n.signal) {
        // The whole junction (signal nodes joined by short edges, as in
        // signalClusters) takes the phase, or its other lights fall out of step.
        const ph = cur.horizontal ? 0 : 12, todo = [at];
        n.phase = ph;
        while (todo.length) {
          const mi = todo.pop(), m = nodes[mi];
          for (let k = 0; k < m.edges.length; k++) {
            const e2 = edges[m.edges[k]], o = e2.a === mi ? e2.b : e2.a;
            if (!(e2.length < SIGNAL.cluster) || !nodes[o].signal || nodes[o].phase === ph) continue;
            nodes[o].phase = ph;
            todo.push(o);
          }
        }
        return;
      }
      walked += cur.length;
      let next = null, best = 0.9;
      for (let k = 0; k < n.edges.length; k++) {
        const o = edges[n.edges[k]];
        if (o === cur) continue;
        const s = o.a === at ? 1 : -1, c = (o.ux * fx + o.uz * fz) * s;
        if (c > best) { best = c; next = o; }
      }
      if (!next) return;
      at = next.a === at ? next.b : next.a;
      cur = next;
    }
  })();

  // ---- 11. Facade styles (citygen's rules, own random stream). ----
  (function facadeStyles() {
    for (let bIdx = 0; bIdx < buildings.length; bIdx++) {
      const b = buildings[bIdx];
      if (b.style) continue; // the depot sets its own
      const blk = blockAt((b.x0 + b.x1) / 2, (b.z0 + b.z1) / 2);
      b.block = blk ? blk.id : -1;
      let street = 0;
      if (blk) {
        const lim = b.kind === 'house' ? 12.5 : 9;
        if (b.z0 - blk.z0 < lim) street |= 1;
        if (blk.z1 - b.z1 < lim) street |= 2;
        if (b.x0 - blk.x0 < lim) street |= 4;
        if (blk.x1 - b.x1 < lim) street |= 8;
      }
      b.street = street;
      let style;
      if (b.kind === 'house') style = 'house';
      else if (b.kind === 'container') style = 'container';
      else if (b.kind === 'warehouse') style = !blk ? (b.district === 'industrial' ? 'hangar' : 'shed') : dr.chance(0.25) ? 'brick' : 'shed';
      else if (b.district === 'beach') style = 'stucco';
      else if (b.district === 'downtown') style = b.h > 58 ? (dr.chance(0.85) ? 'glass' : 'office') : dr.chance(0.6) ? 'glass' : 'office';
      else if (b.h >= 24) style = dr.pick(['office', 'office', 'brick', 'glass', 'stucco']);
      else style = dr.chance(0.5) ? 'stucco' : dr.chance(0.6) ? 'brick' : 'office';
      b.style = style;
      b.tint = style === 'glass' ? dr.pick(GLASS_TINTS) : b.color;
      b.vseed = dr.int(1, 1e9);
    }
  })();

  // Police roof pad: the midtown roof nearest a downtown anchor.
  const roofPads = [];
  (function roofPad() {
    let best = null, bd = Infinity;
    const ax = S.roofPadAnchor ? S.roofPadAnchor.x : -1100, az = S.roofPadAnchor ? S.roofPadAnchor.z : 600;
    for (let bIdx = 0; bIdx < buildings.length; bIdx++) {
      const b = buildings[bIdx];
      if (b.district !== 'midtown' || b.kind !== 'building' || b.x1 - b.x0 < 16 || b.z1 - b.z0 < 16 || b.h < 12 || b.h > 30) continue;
      const d = Math.hypot((b.x0 + b.x1) / 2 - ax, (b.z0 + b.z1) / 2 - az);
      if (d < bd) { bd = d; best = b; }
    }
    if (best) roofPads.push({ x: (best.x0 + best.x1) / 2, z: (best.z0 + best.z1) / 2, y: best.h, building: buildings.indexOf(best) });
    for (const r of roofPads) aircraftSpots.push({ x: r.x, z: r.z, heading: 0, spec: 'patrolheli', roof: true });
  })();

  // Landmarks: windsock, runway lights and the port cranes.
  const landmarks = { lighthouse: null, cranes: [], billboards: [], windsock: runway ? { x: runway.x0 + 70, z: runway.z0 - 14 } : null, runwayLights: [] };
  // Each crane steps south from its point to the pier edge: legs (x +-7,
  // z +-6) on land, clear of buildings and roads, the boom (to z + 40)
  // out over the water.
  (S.cranes || []).forEach((c, k) => {
    const x = c.x;
    let z = c.z;
    while (Math.min(mainShore(x - 7, z + 6), mainShore(x + 7, z + 6)) > 4 && z < c.z + 600) z += 1;
    for (const ox of [-7, 7]) {
      for (const oz of [-6, 6]) {
        if (mainShore(x + ox, z + oz) < 2 || inBuilding(x + ox, z + oz, 1.5) || onRoad(x + ox, z + oz)) return;
      }
    }
    if (shoreDist(x, z + 30) > -2) return;
    landmarks.cranes.push({ x, z, rot: Math.PI / 2, v: k % 2 ? 0.7 : 0.3 });
  });
  // The Cinder tank: open ground in a Wynwood yard (no parking lots in the
  // data); curb spaces within 6 m are cleared, as in citygen.
  (function cinderTank() {
    if (S.cinder) {
      let spot = null;
      for (let r = 0; r <= 400 && !spot; r += 4) {
        const n = r ? Math.max(8, Math.round((TAU * r) / 4)) : 1;
        for (let k = 0; k < n && !spot; k++) {
          const x = S.cinder.x + Math.cos((k / n) * TAU) * r, z = S.cinder.z + Math.sin((k / n) * TAU) * r;
          if (districtOf(x, z) !== 'industrial' || mainShore(x, z) < 8 || inBuilding(x, z, 4.5)) continue;
          let road = onRoad(x, z);
          for (let a = 0; a < 8 && !road; a++) road = onRoad(x + Math.cos((a / 8) * TAU) * 5, z + Math.sin((a / 8) * TAU) * 5);
          if (!road) spot = { x: Math.round(x * 10) / 10, z: Math.round(z * 10) / 10 };
        }
      }
      if (spot) {
        tankSpots.push({ x: spot.x, z: spot.z, heading: 0, spec: 'rustback', place: 'cinder' });
        for (let i = parkingSpots.length - 1; i >= 0; i--) {
          if (Math.hypot(parkingSpots[i].x - spot.x, parkingSpots[i].z - spot.z) < 6) parkingSpots.splice(i, 1);
        }
      }
    }
  })();
  for (let x = runway ? runway.x0 : 1; runway && x <= runway.x1 + 0.1; x += 35.5) {
    landmarks.runwayLights.push({ x, z: runway.z0 - 1.4, color: 0xfff2d0 }, { x, z: runway.z1 + 1.4, color: 0xfff2d0 });
  }
  for (let k = 0; runway && k < 6; k++) {
    const z = runway.z0 + 2.5 + k * ((runway.z1 - runway.z0 - 5) / 5);
    landmarks.runwayLights.push({ x: runway.x0 - 1.5, z, color: 0x40ff70 }, { x: runway.x1 + 1.5, z, color: 0xff4030 });
  }

  // Street names (2.1 item 11): the sign atlas holds every name of the
  // region (`atlas`, the names that meet most often at signals first, then
  // the longer road, then by name), and street blades (white on green)
  // stand at every signal and every junction of two named streets: one
  // post on a corner between the two, one blade along each road. Stop
  // signs stand where the data has them, on the minor approaches (all of
  // them where no approach is a main road). `x`, `z` (16 each) and
  // `plates` (the short forms, atlas order) as before for old callers.
  const nameLen = new Map(), nameHits = new Map();
  for (const e of edges) if (e.name && !e.causeway) nameLen.set(e.name, (nameLen.get(e.name) || 0) + e.length);
  const namesAt = (n) => {
    const out = [];
    for (const eid of n.edges) {
      const nm = edges[eid].name;
      if (nm && nameLen.has(nm) && !out.includes(nm)) out.push(nm);
    }
    return out;
  };
  for (let nIdx = 0; nIdx < nodes.length; nIdx++) {
    const n = nodes[nIdx];
    if (!n.signal) continue;
    const ns = namesAt(n);
    if (ns.length >= 2) for (const nm of ns) nameHits.set(nm, (nameHits.get(nm) || 0) + 1);
  }
  const atlas = [...nameLen.keys()]
    .sort((p, q) => (nameHits.get(q) || 0) - (nameHits.get(p) || 0) || nameLen.get(q) - nameLen.get(p) || (p < q ? -1 : 1));
  const topNames = atlas.slice(0, 32);
  while (topNames.length < 32) topNames.push('Biscayne Bay');
  const plateOf = new Map(atlas.map((nm, k) => [nm, k]));
  // plates: made at the first read (the renderer's sign atlas), not at build.
  let plates = null;
  const streetNames = {
    x: topNames.slice(0, 16), z: topNames.slice(16, 32), atlas,
    get plates() { return plates || (plates = atlas.map(plateText)); },
    plateIndex: (nm) => (plateOf.has(nm) ? plateOf.get(nm) : -1),
  };
  let bladeCount = 0, stopCount = 0;
  (function bladesAndStops() {
    for (let nIdx = 0; nIdx < nodes.length; nIdx++) {
      const n = nodes[nIdx];
      if (n.i < 0 || n.edges.length < 3) continue;
      // The two signed roads: the first edge of each of two names.
      let ea = null, eb = null;
      for (const eid of n.edges) {
        const e = edges[eid];
        if (!plateOf.has(e.name)) continue;
        if (!ea) ea = e;
        else if (e.name !== ea.name && !eb) eb = e;
      }
      if (ea && eb) {
        // Directions away from the junction along each road.
        const dir = (e) => (e.a === n.id ? 1 : -1);
        const ax = ea.ux * dir(ea), az = ea.uz * dir(ea), bx = eb.ux * dir(eb), bz = eb.uz * dir(eb);
        // The corner between them, clear of both carriageways; else the
        // other corners in turn.
        // (1.6 m into the corner: past the round curb return, on the
        // sidewalk corner; never on the junction's asphalt.)
        for (const [sa, sb] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
          const x = n.x + sa * ax * (eb.width / 2 + 1.6) + sb * bx * (ea.width / 2 + 1.6);
          const z = n.z + sa * az * (eb.width / 2 + 1.6) + sb * bz * (ea.width / 2 + 1.6);
          if (onRoad(x, z) || onJunction(roadGeo, x, z) || inBuilding(x, z, 0.8) || mainShore(x, z) < 2) continue;
          // Each blade runs along its own road.
          furniture.push({ type: 'streetsign', x, z, rot: 0, q: 0, v: 0, a: plateOf.get(ea.name), b: plateOf.get(eb.name), ra: Math.atan2(az, ax), rb: Math.atan2(bz, bx) });
          n.blade = true;
          bladeCount++;
          break;
        }
      }
      if (!n.stop) continue;
      let main = false;
      for (const eid of n.edges) if (edges[eid].avenue) main = true;
      for (const eid of n.edges) {
        const e = edges[eid];
        if (main && e.avenue) continue;
        // Traffic comes in on this edge only if it may drive toward n.
        if (e.oneway && e.b !== n.id) continue;
        const o = nodes[e.a === n.id ? e.b : e.a];
        const l = Math.hypot(n.x - o.x, n.z - o.z) || 1;
        const tx = (n.x - o.x) / l, tz = (n.z - o.z) / l;
        const fwd = e.b === n.id;
        // The right curb of the approach, seen driving toward n.
        const rc = fwd ? e.width / 2 + (e.off || 0) : e.width / 2 - (e.off || 0);
        if (roadGeo.inner[eid]) continue;
        const back = trimAt(e, n.id) + 1.5;
        const x = n.x - tx * back - tz * (rc + 0.7), z = n.z - tz * back + tx * (rc + 0.7);
        if (onRoad(x, z) || inBuilding(x, z, 0.5)) continue;
        furniture.push(spec({ type: 'stopsign', x, z, rot: Math.atan2(-tz, -tx), q: 0, v: 0 }, eid, fwd ? 1 : -1, fwd ? e.length - back : back, 0.7, fwd ? -1 : 1));
        stopCount++;
      }
    }
  })();
  graphStats.blades = bladeCount;
  graphStats.stopSigns = stopCount;

  // Land drawn as horizontal runs of `cell` size (renderer and minimap).
  function landRuns(cell = 8) {
    const out = [];
    const x0 = cut.x0, z0 = cut.z0;
    const nx = Math.ceil((cut.x1 - x0) / cell), nz = Math.ceil((cut.z1 - z0) / cell);
    for (let j = 0; j < nz; j++) {
      const z = z0 + (j + 0.5) * cell;
      let start = -1;
      for (let i = 0; i <= nx; i++) {
        const on = i < nx && mainShore(x0 + (i + 0.5) * cell, z) > 0;
        if (on && start < 0) start = i;
        if (!on && start >= 0) {
          out.push(x0 + start * cell, z0 + j * cell, x0 + i * cell, z0 + (j + 1) * cell);
          start = -1;
        }
      }
    }
    return out;
  }
  // Nearest point well inside land (follows the shore field uphill).
  function landTarget(x, z, out, inland = 12) {
    let cx = x, cz = z;
    for (let k = 0; k < 400; k++) {
      const d = shoreDist(cx, cz);
      if (d >= inland) break;
      let gx = shoreDist(cx + 2, cz) - shoreDist(cx - 2, cz);
      let gz = shoreDist(cx, cz + 2) - shoreDist(cx, cz - 2);
      const gl = Math.hypot(gx, gz);
      if (!(gl > 1e-6)) { gx = spawn.x - cx; gz = spawn.z - cz; }
      const l = Math.hypot(gx, gz) || 1;
      const st = Math.max(2, Math.min(40, Math.abs(inland - d)));
      cx += (gx / l) * st;
      cz += (gz / l) * st;
    }
    out.x = cx;
    out.z = cz;
    return out;
  }
  // Spatial queries (out arrays are cleared and filled with indices).
  function edgesNear(x, z, r, out) {
    out.length = 0;
    const n = edgeIds(x - r, z - r, x + r, z + r);
    const S = STRIPS;
    if (S !== null && S.length === 5 * edges.length) {
      for (let k = 0; k < n; k++) {
        const o = 5 * EIDS[k], h = r + S[o + 4];
        if (boxFar(x, z, S[o], S[o + 1], S[o + 2], S[o + 3], h)) continue;
        if (segDist2(x, z, S[o], S[o + 1], S[o + 2], S[o + 3]) <= h * h) out.push(EIDS[k]);
      }
      return out;
    }
    for (let k = 0; k < n; k++) {
      const e = edges[EIDS[k]];
      // The strip (moved `off` on a tight divided pair).
      const g = stripOf(e), h = r + e.width / 2;
      if (boxFar(x, z, g[0], g[1], g[2], g[3], h)) continue;
      if (segDist2(x, z, g[0], g[1], g[2], g[3]) <= h * h) out.push(e.id);
    }
    return out;
  }
  // The street under a point (docs/MAP.md "Edge contract", 2.1 item 11):
  // the edge whose strip holds it, its name, the next named cross street
  // ahead. Cross streets are found once per edge end, at the first query
  // (not at build: the build itself never asks; through bends and
  // junctions along the same name), so a query only scans the point's
  // grid cell. No allocation when `out` is given.
  let crossF = null, crossB = null;
  function crossStreets() {
    crossF = new Array(edges.length).fill('');
    crossB = new Array(edges.length).fill('');
    const crossFrom = (e0, toward) => {
      let e = e0, n = nodes[toward];
      for (let guard = 0; guard < 40; guard++) {
        let next = null, bestDot = -2;
        const tx = e.b === n.id ? e.ux : -e.ux, tz = e.b === n.id ? e.uz : -e.uz;
        for (const id of n.edges) {
          if (id === e.id) continue;
          const o = edges[id];
          if (o.name && o.name !== e0.name && n.edges.length > 2) return o.name;
          const ox = o.a === n.id ? o.ux : -o.ux, oz = o.a === n.id ? o.uz : -o.uz;
          const dot = ox * tx + oz * tz;
          if ((!o.name || o.name === e0.name) && dot > bestDot) { bestDot = dot; next = o; }
        }
        if (!next || bestDot < 0.3) return '';
        e = next;
        n = nodes[e.a === n.id ? e.b : e.a];
      }
      return '';
    };
    for (const e of edges) {
      crossF[e.id] = crossFrom(e, e.b);
      crossB[e.id] = crossFrom(e, e.a);
    }
  }
  // The nearest named strip within 40 m (unnamed edges take its name).
  const nearestName = (x, z) => {
    let best = null, bd = 1600;
    const n = edgeIds(x - 40, z - 40, x + 40, z + 40);
    for (let k = 0; k < n; k++) {
      const e = edges[EIDS[k]];
      if (!e.name) continue;
      const g = stripOf(e);
      const d = segDist2(x, z, g[0], g[1], g[2], g[3]);
      if (d < bd) { bd = d; best = e; }
    }
    return best ? best.name : '';
  };
  function streetAt(x, z, out = { edge: -1, name: '', cross: '', d: 0, side: 1 }, heading) {
    const c = gridCell(x, z);
    if (c < 0) return null;
    let best = null, bd = Infinity;
    for (let k = edgeIndex.start[c]; k < edgeIndex.start[c + 1]; k++) {
      const e = edges[edgeIndex.items[k]];
      const g = stripOf(e);
      const d2 = segDist2(x, z, g[0], g[1], g[2], g[3]);
      const h = e.width / 2 + 0.3;
      if (d2 <= h * h && d2 < bd) { bd = d2; best = e; }
    }
    if (!best) return null;
    const e = best, a = nodes[e.a];
    const d = (x - a.x) * -e.uz + (z - a.z) * e.ux;
    let name = e.name;
    if (!name) name = nearestName(x, z);
    const fwd = heading === undefined || Math.cos(heading) * e.ux + Math.sin(heading) * e.uz >= 0;
    out.edge = e.id;
    out.name = name;
    if (!crossF) crossStreets();
    out.cross = fwd ? crossF[e.id] : crossB[e.id];
    out.d = d;
    out.side = d >= divideOf(e) ? 1 : -1;
    return out;
  }
  function buildingsNear(x0, z0, x1, z1, out) {
    out.length = 0;
    const i0 = Math.max(0, Math.floor((x0 - gx0) / GRID)), i1 = Math.min(gw - 1, Math.floor((x1 - gx0) / GRID));
    const j0 = Math.max(0, Math.floor((z0 - gz0) / GRID)), j1 = Math.min(gh - 1, Math.floor((z1 - gz0) / GRID));
    const mark = ++buildingMark;
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const c = j * gw + i;
        for (let k = buildingIndex.start[c]; k < buildingIndex.start[c + 1]; k++) {
          const id = buildingIndex.items[k], q = 4 * id;
          if (buildingSeen[id] === mark || BBOX[q + 2] < x0 || BBOX[q] > x1 || BBOX[q + 3] < z0 || BBOX[q + 1] > z1) continue;
          buildingSeen[id] = mark;
          out.push(id);
        }
      }
    }
    return out;
  }
  // The real neighborhood (or water, or bridge) name at a point, for the
  // HUD. No allocation: the edge scratch list is reused.
  const placeEdges = [];
  const landPlaceCell = cellLookup(landPlace), waterPlaceCell = cellLookup(waterPlace);
  function placeOf(x, z) {
    if (islet && x > islet.x0 - 60 && x < islet.x1 + 60 && z > islet.z0 - 60 && z < islet.z1 + 60) return DISTRICTS.airfield.name;
    if (mainShore(x, z) > 0) {
      const c = landPlaceCell(x, z);
      const k = c < 0 ? 0 : landPlace.data[c];
      if (k) return placeNames[k];
    }
    if (shoreDist(x, z) > 0) {
      // A road strip over the water: the bridge's own street name.
      edgesNear(x, z, 2, placeEdges);
      for (let i = 0; i < placeEdges.length; i++) {
        const e = edges[placeEdges[i]];
        if (e.name && (e.bridge || e.causeway)) return e.name;
      }
      if (mainShore(x, z) > 0) return 'Miami';
    }
    const c = waterPlaceCell(x, z);
    const k = c < 0 ? 0 : waterPlace.data[c];
    return k ? placeNames[k] : 'Biscayne Bay';
  }
  // ---- 10c. Road ends at the region's sea edges (docs/PLAN_V2.md 3.4).
  // Every road cut by a crop side that is not the box's own edge ends in
  // a generated end: a striped barrier just past the end (collision:
  // world/collision.js fillCollision) and a round turning pad inside it,
  // so no lane runs into a wall. A road cut over water (a bridge or
  // causeway) ends at its bridge head on the last land: `head`, where the
  // barrier then stands. One end per graph node (both carriageways of a
  // dual road get their own). Data only (no rng, nothing else moves).
  const roadEnds = [];
  const city0 = () => ({ nodes });
  (function roadEndsAt() {
    const CUT_SNAP = MERGE + 1;
    const seenNode = new Set();
    const sideOf = (x, z) => {
      const d = [x - crop.x0, crop.x1 - x, z - crop.z0, crop.z1 - z];
      let k = 0;
      for (let q = 1; q < 4; q++) if (d[q] < d[k]) k = q;
      return ['x0', 'x1', 'z0', 'z1'][k];
    };
    // The nodes on the spatial index (a point each), for the nearest node
    // to each cut: the closest under CUT_SNAP m, the lowest index of equals
    // (the first of a scan of every node in order, as before).
    const nodeIndex = cuts.length ? buildIndex(nodes.length, (() => {
      const B = new Float64Array(4 * nodes.length);
      for (let k = 0; k < nodes.length; k++) { B[4 * k] = B[4 * k + 2] = nodes[k].x; B[4 * k + 1] = B[4 * k + 3] = nodes[k].z; }
      return B;
    })()) : null;
    for (let q = 0; q < cuts.length; q += 5) {
      const x = cuts[q], z = cuts[q + 1], ox = cuts[q + 2], oz = cuts[q + 3];
      const side = sideOf(x, z);
      if (boxSide[side]) continue;
      // The kept node this cut vertex became (merged junctions included).
      let n = null, bd = CUT_SNAP;
      const i0 = Math.max(0, Math.floor((x - CUT_SNAP - gx0) / GRID)), i1 = Math.min(gw - 1, Math.floor((x + CUT_SNAP - gx0) / GRID));
      const j0 = Math.max(0, Math.floor((z - CUT_SNAP - gz0) / GRID)), j1 = Math.min(gh - 1, Math.floor((z + CUT_SNAP - gz0) / GRID));
      for (let j = j0; j <= j1; j++) {
        for (let i = i0; i <= i1; i++) {
          const c = j * gw + i;
          for (let t = nodeIndex.start[c]; t < nodeIndex.start[c + 1]; t++) {
            const m = nodes[nodeIndex.items[t]];
            // hypot is at least |dx| and |dz|: the far ones are skipped first.
            if (m.i < 0 || Math.abs(m.x - x) > bd || Math.abs(m.z - z) > bd) continue;
            const d = Math.hypot(m.x - x, m.z - z);
            if (d < bd || (d === bd && n && m.id < n.id)) { bd = d; n = m; }
          }
        }
      }
      if (!n || seenNode.has(n.id)) continue;
      // The edge it ends: the one whose far end lies most against `out`.
      let e = null, best = -Infinity;
      for (const id of n.edges) {
        const ed = edges[id], o = nodes[ed.a === n.id ? ed.b : ed.a];
        const l = Math.hypot(n.x - o.x, n.z - o.z) || 1;
        const dot = ((n.x - o.x) * ox + (n.z - o.z) * oz) / l;
        if (dot > best) { best = dot; e = ed; }
      }
      if (!e || best < 0.3) continue;
      seenNode.add(n.id);
      const o = nodes[e.a === n.id ? e.b : e.a];
      const l = Math.hypot(n.x - o.x, n.z - o.z) || 1;
      const ux = (n.x - o.x) / l, uz = (n.z - o.z) / l;
      // Over water: back along the road to the first point on real land.
      let hx = n.x, hz = n.z, head = null;
      const wet = !(mainShore(n.x, n.z) > 0);
      if (wet) {
        let cur = n, ce = e, guard = 0;
        while (!head && ce && guard++ < 40) {
          const far = nodes[ce.a === cur.id ? ce.b : ce.a];
          for (let d = 0; d <= ce.length; d += 2) {
            const px = cur.x + ((far.x - cur.x) * d) / ce.length, pz = cur.z + ((far.z - cur.z) * d) / ce.length;
            if (mainShore(px, pz) > 1) { head = { x: Math.round(px * 10) / 10, z: Math.round(pz * 10) / 10 }; break; }
          }
          if (head || far.edges.length !== 2) break;
          const nid = far.edges[0] === ce.id ? far.edges[1] : far.edges[0];
          cur = far;
          ce = edges[nid];
        }
        if (head) { hx = head.x; hz = head.z; }
      }
      const half = e.width / 2, reach = Math.max(n.hx, n.hz);
      const r = half + 3;
      roadEnds.push({
        id: roadEnds.length, node: n.id, edge: e.id, road: e.name, side, width: e.width, bridge: e.bridge || wet, head,
        x: n.x, z: n.z, heading: Math.atan2(uz, ux),
        // The turning pad: a disc of paving just inside the end.
        pad: { x: hx - ux * (head ? r + 3 : r), z: hz - uz * (head ? r + 3 : r), r },
        // The barrier: across the road, just past the end (past the
        // junction box where the end merged into a junction).
        barrier: { x: hx + ux * (head ? 0 : reach + 3), z: hz + uz * (head ? 0 : reach + 3), heading: Math.atan2(uz, ux), w: e.width + 2 },
      });
    }
  })();
  // Travel pads (3.4): each of the region's links snapped to the nearest
  // road end of its road (within LINK_SNAP m), with the arrival pose 30 m
  // inside on the right-hand lane, facing in. `twin` is the link of the
  // same id in region `to`.
  const travelPads = [];
  (function travelPadsAt() {
    if (region) {
      const LINK_SNAP = 60, ARRIVE = 30;
      const P = { x: 0, z: 0, heading: 0 };
      for (const lk of region.links || []) {
        let end = null, bd = LINK_SNAP;
        for (const re of roadEnds) {
          if (re.road !== lk.road) continue;
          const d = Math.hypot(re.x - lk.x, re.z - lk.z);
          if (d < bd) { bd = d; end = re; }
        }
        if (!end) continue;
        // Walk in from the end along the road (through bends) ARRIVE m.
        let cur = nodes[end.node], ce = edges[end.edge], left = ARRIVE + (end.head ? Math.hypot(end.x - end.head.x, end.z - end.head.z) : 0), guard = 0;
        while (left > ce.length - 6 && guard++ < 20) {
          // On through bends and junctions: the next edge of the same road
          // that goes on most straight.
          const far = nodes[ce.a === cur.id ? ce.b : ce.a];
          const tx = (far.x - cur.x) / ce.length, tz = (far.z - cur.z) / ce.length;
          let next = null, bestDot = 0.5;
          for (const id of far.edges) {
            if (id === ce.id) continue;
            const ne = edges[id];
            if (far.edges.length > 2 && ne.name !== ce.name) continue;
            const o2 = nodes[ne.a === far.id ? ne.b : ne.a];
            const dot = ((o2.x - far.x) * tx + (o2.z - far.z) * tz) / ne.length;
            if (dot > bestDot) { bestDot = dot; next = ne; }
          }
          if (!next) break;
          left -= ce.length;
          cur = far;
          ce = next;
        }
        lanePoint(city0(), ce, cur.id, Math.max(2, Math.min(left, ce.length - 2)), 0, P);
        travelPads.push({
          id: lk.id, to: lk.to, road: lk.road, end: end.id, x: end.pad.x, z: end.pad.z, r: end.pad.r, heading: end.heading,
          arrive: { x: Math.round(P.x * 10) / 10, z: Math.round(P.z * 10) / 10, heading: Math.round(P.heading * 1000) / 1000 },
        });
      }
    }
  })();
  lap('extras');

  const span = Math.max(Math.abs(cut.x0), Math.abs(cut.x1), Math.abs(cut.z0), Math.abs(cut.z1));
  const inCore = (x, z) => x >= MIAMI_CORE.x0 && x <= MIAMI_CORE.x1 && z >= MIAMI_CORE.z0 && z <= MIAMI_CORE.z1;
  const city = {
    map: 'miami',
    // The map id (world/maps.js): the region's id, or 'miami' for the
    // whole box (and the test crops). `region`: the region object, null
    // for the whole box; `boxSides`: which crop sides are the box's own.
    mapId: region ? region.id : WHOLE_BOX, region, boxSides: boxSide,
    seed, N: 1, xs: [0], zs: [0], wx: [STREET_W], wz: [STREET_W],
    nodes, edges, blocks, buildings,
    props, parkingSpots, spawn,
    furniture, signals, landmarks, streetNames,
    extraLand, piers, pois, surfaces, aircraftSpots, boatSpots, helipads,
    // The real places, then the invented landmarks not already listed.
    mapLandmarks: MIAMI_LANDMARKS.concat(landmarkSites.filter((t) => !MIAMI_LANDMARKS.some((m) => m.landmark === t.id)).map((t) => ({ name: t.name, src: '', x: t.x, z: t.z, landmark: t.id }))),
    tankSpots, roofPads, depot,
    airfield: islet ? { islet, runway, apron, gate } : null,
    // Activities, secrets and stunt ramps: filled in below, from the spots.
    courses: [], secretSpots: [], secretGarage: null, rampSpots: [], courseSpec: S.courses || null, texts: S.texts || null,
    shoreDist, mainShore, isLand, isGround, districtOf, onRoad, placeOf, placeNames: placeNames.slice(1),
    nodeAt: () => null,
    blockAt, edgesNear, buildingsNear, landRuns, landTarget, inBuilding, streetAt,
    // Drawn land (no road strips): 1 = land, sampled at cell centers.
    landGrid: { x0: land.x0, z0: land.z0, cell: CELL, w: W, h: H, data: visual },
    crop, cut, bounds: { x0: land.x0, z0: land.z0, x1: land.x0 + W * CELL, z1: land.z0 + H * CELL },
    attribution: data.attribution,
    size: span,
    mapHalf: span + 100,
    buildMs: 0,
    timings, graphStats,
    // Lots (docs/REVAMP.md 6.2): filled in below.
    core: MIAMI_CORE, inCore, lots: [], lotGrid: null, lotAt: () => null, lotTypeAt: () => '',
    dressLot: (lot, out) => dressLot(city, lot, out),
    startView: S.startView ? { ...S.startView, spawn: { ...S.startView.spawn, x: spawn.x, z: spawn.z, heading: spawn.heading } } : null,
    landmarkSites,
    // Region edges (3.4): generated road ends and the travel pads.
    roadEnds, travelPads,
    // Junction polygons and trimmed strip ends (docs/MAP.md "Junctions").
    roadGeo,
  };

  // ---- 11b. Lots: every free land cell typed and dressed (world/lots.js). ----
  (function lotsAndBays() {
    lotIn.timings = timings;
    const L = buildLots(city, lotIn);
    // The lot rasters are build scratch: drop them (some 30 MB on a region).
    lotIn = null; labelBuf = null; queueBuf = null; parkCells = null;
    city.lots = L.lots;
    city.lotGrid = L.lotGrid;
    city.lotAt = L.lotAt;
    city.lotTypeAt = L.lotTypeAt;
    // Parking lot bays: some of each parking lot's bays are parking spots (the
    // parked-car system spawns a real car in each one near the player, so
    // at most 3 per lot and never over 60 %), chosen by the lot seed; the
    // renderer parks static cars in part of the others.
    // (The bays in eachBay order, by index: only the few kept are placed,
    // so a lot's hundreds of bays cost a count and a shuffle of indices;
    // the lot is dressed only as far as its bay rows.)
    const F = [], BAY = [0, 0, 0];
    let order = new Int32Array(1024);
    for (let lotIdx = 0; lotIdx < city.lots.length; lotIdx++) {
      const lot = city.lots[lotIdx];
      if (lot.type !== 'carpark') continue;
      dressLot(city, lot, F, BAYS_ONLY_FAST);
      let n = 0;
      for (let k = 0; k < F.length; k++) if (F[k].kind === 'bay') n += bayCount(F[k]);
      const keep = Math.min(BAY_LIST_MAX, Math.floor(n * 0.6));
      const r = createRng(lot.seed ^ 0x6a09e667);
      if (order.length < n) order = new Int32Array(n * 2);
      for (let k = 0; k < n; k++) order[k] = k;
      for (let k = n - 1; k > 0; k--) {
        const q = r.int(0, k);
        const t = order[k]; order[k] = order[q]; order[q] = t;
      }
      for (let k = 0; k < keep; k++) {
        let s = order[k];
        for (let m = 0; m < F.length; m++) {
          const f = F[m];
          if (f.kind !== 'bay') continue;
          const c = bayCount(f);
          if (s < c) { bayAt(f, s, BAY); break; }
          s -= c;
        }
        parkingSpots.push({ x: BAY[0], z: BAY[1], heading: BAY[2], lot: true });
      }
    }
    lap('lots.build');
    for (const t of tankSpots) {
      if (t.place !== 'cinder') continue;
      dropSpotsNear(parkingSpots, t.x, t.z, 6, true);
    }
  })();
  lap('lots');

  // ---- 12. Places and activities (docs/MAP.md milestone 2). ----
  if (S.ramps) {
    city.rampSpots = placeRamps(city, S.ramps);
    // No parked car on a street ramp.
    for (const r of city.rampSpots) {
      if (r.water) continue;
      dropSpotsNear(parkingSpots, r.x, r.z, r.r + 6, false);
    }
  }
  lap('places.ramps');
  if (S.secrets) {
    const sec = placeSecrets(city, S.secrets);
    for (const sp of sec.spots) if (S.secretNotes && S.secretNotes[sp.id]) sp.note = S.secretNotes[sp.id];
    city.secretSpots = sec.spots;
    city.secretGarage = sec.garage;
  }
  lap('places.secrets');
  if (city.courseSpec) city.courses = buildCourses(city);
  lap('places.courses');
  lap('places');
  // ---- 13. Street props on the real profile, off the drivable surface. ----
  graphStats.streetProps = settleStreetProps(city, SPEC);
  lap('streetscape');
  if (cpuTimings) city.cpuTimings = cpuTimings;
  city.buildMs = Math.round((typeof performance !== 'undefined' ? performance.now() : Date.now()) - tStart);
  return city;
}

export { DISTRICTS };
