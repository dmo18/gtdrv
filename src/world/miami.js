// The Miami map: turns the baked OpenStreetMap data (world/data/miami.json,
// see docs/MAP.md) into the same city object generateCity() returns, so
// traffic, police, peds, fleet and the renderer work on real streets.
// Pure data, no drawing: runs in node tests. Milestone 1 builds a core
// crop (MIAMI_CROP in miami-spots.js) plus the invented airfield islet.
//
// Coordinates: x east, z south, metres, flat ground y = 0.
import { createRng, TAU } from '../core/rng.js';
import { DISTRICTS, SIDEWALK, STREET_W, AVENUE_W } from './citygen.js';
import { MIAMI_CROP, MIAMI_CORE, LAND_MARGIN, MIAMI_SPOTS, MIAMI_LANDMARKS } from './miami-spots.js';
import { buildLots, planInfill, stepDistance, dressLot, eachBay, INFILL_GAP, SRC_ID, SRC_ZERO } from './lots.js';
import { buildCourses } from './courses.js';
import { placeSecrets } from './secrets.js';
import { placeRamps } from './stunts.js';

export { MIAMI_CROP, MIAMI_CORE, MIAMI_SPOTS };

const CELL = 5; // land raster cell (m)
const CLAMP = 250; // shoreDist is clamped to +-CLAMP m
const SEA_PAD = 260; // raster reaches this far past the land cut (all sea)
const GRID = 64; // spatial index cell (m)
const MERGE = 12; // junctions closer than this become one
const SNAP = 2.2; // a vertex this close to another road joins it
const CHAIN_TOL = 2.5; // Douglas-Peucker tolerance for bends (m)
const RIVERS = { 'Miami River': 19 }; // carved half widths (m)
const BAY_LIST_MAX = 3; // car park bays listed as parking spots, per lot

const DRIVE = new Set([
  'trunk', 'primary', 'secondary', 'tertiary', 'trunk_link', 'primary_link', 'secondary_link',
  'tertiary_link', 'residential', 'unclassified', 'living_street', 'motorway', 'motorway_link',
]);
const BIG = new Set(['trunk', 'primary', 'secondary']);
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

// Polyline field p: delta-encoded decimetres. Returns metres [x0, z0, x1, z1, ...].
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

const segDist2 = (px, pz, ax, az, bx, bz) => {
  const dx = bx - ax, dz = bz - az;
  const L2 = dx * dx + dz * dz;
  let t = L2 > 1e-12 ? ((px - ax) * dx + (pz - az) * dz) / L2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const qx = ax + dx * t - px, qz = az + dz * t - pz;
  return qx * qx + qz * qz;
};

// Distance from segment ab to the axis-aligned rect (0 when they touch).
const pointRect2 = (px, pz, x0, z0, x1, z1) => {
  const qx = px < x0 ? x0 - px : px > x1 ? px - x1 : 0;
  const qz = pz < z0 ? z0 - pz : pz > z1 ? pz - z1 : 0;
  return qx * qx + qz * qz;
};
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
    R.data.fill(v, j * R.w + a, j * R.w + b + 1);
  }
}
function stampRect(R, x0, z0, x1, z1, v) {
  const c = R.cell;
  const i0 = Math.max(0, Math.ceil((x0 - R.x0) / c - 0.5)), i1 = Math.min(R.w - 1, Math.floor((x1 - R.x0) / c - 0.5));
  const j0 = Math.max(0, Math.ceil((z0 - R.z0) / c - 0.5)), j1 = Math.min(R.h - 1, Math.floor((z1 - R.z0) / c - 0.5));
  for (let j = j0; j <= j1; j++) R.data.fill(v, j * R.w + i0, j * R.w + i1 + 1);
}
// Even-odd fill of a closed polygon (pts metres, implicit closing edge).
let POLY_XS = new Float64Array(64); // scratch: the crossings of one row
function fillPolygon(R, pts, v) {
  const n = pts.length / 2;
  let zmin = Infinity, zmax = -Infinity;
  for (let k = 0; k < n; k++) { zmin = Math.min(zmin, pts[2 * k + 1]); zmax = Math.max(zmax, pts[2 * k + 1]); }
  const c = R.cell;
  const j0 = Math.max(0, Math.ceil((zmin - R.z0) / c - 0.5)), j1 = Math.min(R.h - 1, Math.floor((zmax - R.z0) / c - 0.5));
  if (POLY_XS.length < n) POLY_XS = new Float64Array(n * 2);
  const xs = POLY_XS;
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
      if (i1 >= i0) R.data.fill(v, j * R.w + i0, j * R.w + i1 + 1);
    }
  }
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

// Signed distance (decimetres, Int16) from a land mask: + on land, the
// exact Euclidean distance between cell centres (Felzenszwalb squared
// distance transform of each side) less half a cell, clamped to CLAMP.
// A squared distance of FAR cells or more always clamps, so the column
// pass caps at FAR (squared run length to the nearest cell of the other
// side, two row-major sweeps for both sides at once), and the row pass
// builds the lower envelope of the cells under FAR only.
function signedField(R) {
  const W = R.w, H = R.h, N = W * H, m = R.data;
  const lim = CLAMP * 10;
  const FAR = (Math.ceil(lim / (10 * R.cell) + 0.5) + 1) ** 2;
  // Every squared distance under FAR, as the output it gives.
  const posOf = new Int16Array(FAR), negOf = new Int16Array(FAR);
  for (let d = 0; d < FAR; d++) {
    const p = Math.round((Math.sqrt(d) - 0.5) * R.cell * 10), q = Math.round(-(Math.sqrt(d) - 0.5) * R.cell * 10);
    posOf[d] = p > lim ? lim : p < -lim ? -lim : p;
    negOf[d] = q > lim ? lim : q < -lim ? -lim : q;
  }
  // Column pass: one field for both sides (a cell's distance is to the
  // other side), squared, capped at FAR.
  const col = new Int32Array(N);
  {
    const run = new Int32Array(W).fill(-1); // rows since the side changed (-1 none)
    const side = new Uint8Array(W).fill(2);
    for (let j = 0, c = 0; j < H; j++) {
      for (let i = 0; i < W; i++, c++) {
        const t = m[c] ? 1 : 0;
        if (t !== side[i]) { run[i] = side[i] === 2 ? -1 : 0; side[i] = t; }
        if (run[i] >= 0) run[i]++;
        col[c] = run[i];
      }
    }
    run.fill(-1);
    side.fill(2);
    for (let j = H - 1, c = N - 1; j >= 0; j--) {
      for (let i = W - 1; i >= 0; i--, c--) {
        const t = m[c] ? 1 : 0;
        if (t !== side[i]) { run[i] = side[i] === 2 ? -1 : 0; side[i] = t; }
        if (run[i] >= 0) run[i]++;
        const up = col[c], dn = run[i];
        const r = up < 0 ? dn : dn < 0 ? up : up < dn ? up : dn;
        col[c] = r < 0 || r * r >= FAR ? FAR : r * r;
      }
    }
  }
  // Row pass: per row and side, the parabolas (q - p)^2 + g[p] of the
  // other side's cells (g = 0) and of this side's cells under FAR.
  const out = new Int16Array(N);
  const v = new Int32Array(W), zz = new Float64Array(W + 1), gv = new Float64Array(W);
  for (let y = 0, row = 0; y < H; y++, row += W) {
    for (let t = 0; t < 2; t++) {
      // t = 1: land cells, distance to water; t = 0: water cells, to land.
      const tab = t ? posOf : negOf;
      let k = -1;
      for (let x = 0; x < W; x++) {
        const c = row + x;
        const own = (m[c] ? 1 : 0) === t;
        const g = own ? col[c] : 0;
        if (g >= FAR) continue;
        // A cell of the other side is a source at 0.
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
        for (let x = 0; x < W; x++) if ((m[row + x] ? 1 : 0) === t) out[row + x] = t ? lim : -lim;
        continue;
      }
      zz[k + 1] = Infinity;
      let e = 0;
      for (let x = 0; x < W; x++) {
        const c = row + x;
        if ((m[c] ? 1 : 0) !== t) continue;
        while (zz[e + 1] < x) e++;
        const d = (x - v[e]) * (x - v[e]) + gv[e];
        out[c] = d < FAR ? tab[d] : t ? lim : -lim;
      }
    }
  }
  return out;
}

// Bilinear sample of a signed field at cell centres; metres.
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

// Labels the 4-connected regions of cells where wall is 0. Returns the
// count. Regions are numbered in the row order of their first cell (a
// span fill: each run of a row is labelled at once, and one seed per
// open run above and below it is stacked). queue: unused scratch.
function labelRegions(wall, W, H, label, queue) {
  const NC = W * H;
  label.fill(-1);
  void queue;
  const stack = [];
  let n = 0;
  for (let s = 0; s < NC; s++) {
    if (wall[s] || label[s] >= 0) continue;
    stack.length = 0;
    stack.push(s);
    while (stack.length) {
      const c = stack.pop();
      if (label[c] >= 0) continue;
      const row = c - (c % W), end = row + W - 1;
      let l = c, r = c;
      while (l > row && !wall[l - 1] && label[l - 1] < 0) l--;
      while (r < end && !wall[r + 1] && label[r + 1] < 0) r++;
      for (let k = l; k <= r; k++) label[k] = n;
      if (row >= W) seedRuns(wall, label, l - W, r - W, stack);
      if (row + W < NC) seedRuns(wall, label, l + W, r + W, stack);
    }
    n++;
  }
  return n;
}
// Stacks the first cell of every open, unlabelled run in a..b.
function seedRuns(wall, label, a, b, stack) {
  let inRun = false;
  for (let k = a; k <= b; k++) {
    const open = !wall[k] && label[k] < 0;
    if (open && !inRun) stack.push(k);
    inRun = open;
  }
}

// Each region's vote from one coast line: +1 per sample on its land side
// (6 m to the left of the line), -1 on its water side. Segments wholly
// outside the raster (x0..bx1, z0..bz1) are skipped.
function voteCoast(pts, R, label, votes, bx1, bz1) {
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
    }
  }
}
function applyVotes(label, votes, data, NC) {
  for (let c = 0; c < NC; c++) if (label[c] >= 0) data[c] = votes[label[c]] > 0 ? 1 : 0;
}

// Coastline wall cells (1) take the majority of their settled neighbours.
function settleWalls(wall, land, W, H) {
  const NC = W * H;
  for (let pass = 0; pass < 3; pass++) {
    for (let c = 0; c < NC; c++) {
      if (!wall[c]) continue;
      let l = 0, n = 0;
      const i = c % W;
      if (i > 0 && wall[c - 1] !== 1) { n++; l += land[c - 1]; }
      if (i < W - 1 && wall[c + 1] !== 1) { n++; l += land[c + 1]; }
      if (c >= W && wall[c - W] !== 1) { n++; l += land[c - W]; }
      if (c < NC - W && wall[c + W] !== 1) { n++; l += land[c + W]; }
      if (n) {
        land[c] = l * 2 >= n ? 1 : 0;
        wall[c] = 2;
      }
    }
  }
}

// Greedy cover of the 1-cells of a cw x ch mask by up to 6 rectangles
// (largest first, via the histogram method), until 85 % is covered.
// Writes [i0, j0, i1, j1] per rectangle into out; returns the count.
function largestRects(cells, cw, ch, filled, hist, stack, out) {
  const total = filled;
  let n = 0;
  while (n < 6 && filled > total * 0.15) {
    let best = 0, bi0 = 0, bj0 = 0, bi1 = 0, bj1 = 0;
    for (let i = 0; i < cw; i++) hist[i] = 0;
    for (let j = 0; j < ch; j++) {
      const row = j * cw;
      for (let i = 0; i < cw; i++) hist[i] = cells[row + i] === 1 ? hist[i] + 1 : 0;
      let sp = 0;
      for (let i = 0; i <= cw; i++) {
        const hh = i < cw ? hist[i] : 0;
        while (sp > 0 && hist[stack[sp - 1]] >= hh) {
          const height = hist[stack[--sp]];
          const left = sp > 0 ? stack[sp - 1] + 1 : 0;
          const a = height * (i - left);
          if (a > best) { best = a; bi0 = left; bi1 = i - 1; bj1 = j; bj0 = j - height + 1; }
        }
        stack[sp++] = i;
      }
    }
    if (best < 4) break;
    for (let j = bj0; j <= bj1; j++) for (let i = bi0; i <= bi1; i++) cells[j * cw + i] = 2;
    filled -= best;
    out[4 * n] = bi0; out[4 * n + 1] = bj0; out[4 * n + 2] = bi1; out[4 * n + 3] = bj1;
    n++;
  }
  return n;
}

// Free lot cells: drawn land (visual 1) off the road strips (near 0) and
// outside every building box (owner < 0). Sets free[c] = 1 and returns
// the free cells in row order. (Hot loops live in small top-level
// functions: the optimiser takes them at once, not the whole build.)
function freeCells(visual, near, owner, free, NC) {
  let n = 0;
  for (let c = 0; c < NC; c++) {
    if (visual[c] === 1 && near[c] === 0 && owner[c] < 0) { free[c] = 1; n++; }
  }
  const list = new Int32Array(n);
  for (let c = 0, k = 0; k < n; c++) if (free[c]) list[k++] = c;
  return list;
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
// when no cell centre is inside the polygon).
function footprintRects(R, pts, hist, stack, rects) {
  const cw = R.w, ch = R.h, cells = R.data;
  cells.fill(0, 0, cw * ch);
  fillPolygon(R, pts, 1);
  let filled = 0;
  for (let k = 0; k < cw * ch; k++) filled += cells[k];
  if (!filled) return 0;
  return largestRects(cells, cw, ch, filled, hist, stack, rects);
}

// Building box k on the owner raster (CELL cells from x0, z0): the cells
// whose centre is strictly inside the box (as inBuilding); a box too
// small to cover a cell centre still holds its own cell.
function stampOwnerBox(owner, b, k, x0, z0, W, H) {
  const e = 1e-6;
  const i0 = Math.max(0, Math.ceil((b.x0 - x0) / CELL - 0.5 + e)), i1 = Math.min(W - 1, Math.floor((b.x1 - x0) / CELL - 0.5 - e));
  const j0 = Math.max(0, Math.ceil((b.z0 - z0) / CELL - 0.5 + e)), j1 = Math.min(H - 1, Math.floor((b.z1 - z0) / CELL - 0.5 - e));
  if (i1 >= i0) for (let j = j0; j <= j1; j++) owner.fill(k, j * W + i0, j * W + i1 + 1);
  const ci = Math.floor(((b.x0 + b.x1) / 2 - x0) / CELL), cj = Math.floor(((b.z0 + b.z1) / 2 - z0) / CELL);
  const c = ci < 0 || cj < 0 || ci >= W || cj >= H ? -1 : cj * W + ci;
  if (c >= 0 && owner[c] < 0) owner[c] = k;
}

// Indices of the boxes (not the depot's) whose centre is within r of (x, z).
function boxesWithin(boxes, x, z, r) {
  const out = [];
  for (let k = 0; k < boxes.length; k++) {
    const b = boxes[k];
    if (b.depot || Math.hypot((b.x0 + b.x1) / 2 - x, (b.z0 + b.z1) / 2 - z) > r) continue;
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

// Flood fills one road-free land region from cell s (inside the crop
// window ci0..ci1, cj0..cj1). out: [cells, i0, i1, j0, j1, park cells,
// 1 if it stays clear of the window edge].
function floodBlock(s, W, ci0, ci1, cj0, cj1, land, road, park, lab, queue, out) {
  let qh = 0, qt = 0, i0 = s % W, i1 = i0, j0 = (s - i0) / W, j1 = j0, parks = 0, ok = 1;
  queue[qt++] = s;
  lab[s] = s;
  while (qh < qt) {
    const c = queue[qh++];
    const ci = c % W, cj = (c - ci) / W;
    if (ci <= ci0 || ci >= ci1 || cj <= cj0 || cj >= cj1) ok = 0;
    if (ci < i0) i0 = ci;
    if (ci > i1) i1 = ci;
    if (cj < j0) j0 = cj;
    if (cj > j1) j1 = cj;
    if (park[c]) parks++;
    if (ci > ci0 && lab[c - 1] < 0 && land[c - 1] === 1 && road[c - 1] === 0) { lab[c - 1] = s; queue[qt++] = c - 1; }
    if (ci < ci1 && lab[c + 1] < 0 && land[c + 1] === 1 && road[c + 1] === 0) { lab[c + 1] = s; queue[qt++] = c + 1; }
    if (cj > cj0 && lab[c - W] < 0 && land[c - W] === 1 && road[c - W] === 0) { lab[c - W] = s; queue[qt++] = c - W; }
    if (cj < cj1 && lab[c + W] < 0 && land[c + W] === 1 && road[c + W] === 0) { lab[c + W] = s; queue[qt++] = c + W; }
  }
  out[0] = qt; out[1] = i0; out[2] = i1; out[3] = j0; out[4] = j1; out[5] = parks; out[6] = ok;
}

// floodBlock from every unlabelled road-free land cell of the window, in
// row order. Returns an Int32Array of 7 values per region (as FB).
function floodRegions(W, ci0, ci1, cj0, cj1, land, road, park, lab, queue, FB) {
  let out = new Int32Array(7 * 4096), n = 0;
  for (let j = cj0; j <= cj1; j++) {
    for (let i = ci0; i <= ci1; i++) {
      const s = j * W + i;
      if (lab[s] >= 0 || land[s] !== 1 || road[s] !== 0) continue;
      floodBlock(s, W, ci0, ci1, cj0, cj1, land, road, park, lab, queue, FB);
      if (n + 7 > out.length) { const o = new Int32Array(out.length * 2); o.set(out); out = o; }
      for (let k = 0; k < 7; k++) out[n++] = FB[k];
    }
  }
  return out.subarray(0, n);
}

// Junctions the simplified data lost: a vertex lying on another road, or
// two streets crossing with no shared vertex. Splits the segments
// (segA, segB, segW) there; returns the new [segA, segB, segW], or null
// when nothing was split. vertexOf(x, z, flag) adds a vertex.
function splitJunctions(crop, vx, vz, vflag, segA, segB, segW, ways, vertexOf) {
  const SG = 40;
  const gx0 = crop.x0 - 10, gz0 = crop.z0 - 10;
  const gw = Math.ceil((crop.x1 - crop.x0 + 20) / SG) + 1, gh = Math.ceil((crop.z1 - crop.z0 + 20) / SG) + 1;
  const cells = Array.from({ length: gw * gh }, () => []);
  const ns = segA.length;
  for (let s = 0; s < ns; s++) {
    const ax = vx[segA[s]], az = vz[segA[s]], bx = vx[segB[s]], bz = vz[segB[s]];
    const i0 = Math.max(0, Math.floor((Math.min(ax, bx) - SNAP - gx0) / SG)), i1 = Math.min(gw - 1, Math.floor((Math.max(ax, bx) + SNAP - gx0) / SG));
    const j0 = Math.max(0, Math.floor((Math.min(az, bz) - SNAP - gz0) / SG)), j1 = Math.min(gh - 1, Math.floor((Math.max(az, bz) + SNAP - gz0) / SG));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) cells[j * gw + i].push(s);
  }
  const splits = new Map(); // seg -> [{t, v}]
  const addSplit = (s, t, v) => {
    let l = splits.get(s);
    if (!l) splits.set(s, (l = []));
    if (!l.some((q) => q.v === v)) l.push({ t, v });
  };
  // Vertex on a segment.
  const nv = vx.length;
  for (let v = 0; v < nv; v++) {
    const i = Math.floor((vx[v] - gx0) / SG), j = Math.floor((vz[v] - gz0) / SG);
    if (i < 0 || j < 0 || i >= gw || j >= gh) continue;
    for (const s of cells[j * gw + i]) {
      const a = segA[s], b = segB[s];
      if (a === v || b === v) continue;
      const sb = ways[segW[s]].bridge;
      const f = vflag[v];
      if (!(f & 4) && !(sb ? f & 2 : f & 1)) continue;
      const ax = vx[a], az = vz[a], dx = vx[b] - ax, dz = vz[b] - az;
      const L = Math.hypot(dx, dz);
      const t = ((vx[v] - ax) * dx + (vz[v] - az) * dz) / L;
      if (t < 1 || t > L - 1) continue;
      const ox = ax + (dx * t) / L - vx[v], oz = az + (dz * t) / L - vz[v];
      if (ox * ox + oz * oz < SNAP * SNAP) addSplit(s, t, v);
    }
  }
  // Street crossings without a shared vertex (never with a bridge).
  const seen = new Int32Array(ns).fill(-1);
  for (let s = 0; s < ns; s++) {
    if (ways[segW[s]].bridge) continue;
    const a = segA[s], b = segB[s];
    const ax = vx[a], az = vz[a], dx = vx[b] - ax, dz = vz[b] - az;
    const i0 = Math.max(0, Math.floor((Math.min(ax, vx[b]) - gx0) / SG)), i1 = Math.min(gw - 1, Math.floor((Math.max(ax, vx[b]) - gx0) / SG));
    const j0 = Math.max(0, Math.floor((Math.min(az, vz[b]) - gz0) / SG)), j1 = Math.min(gh - 1, Math.floor((Math.max(az, vz[b]) - gz0) / SG));
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        for (const u of cells[j * gw + i]) {
          if (u <= s || seen[u] === s || ways[segW[u]].bridge) continue;
          seen[u] = s;
          const c = segA[u], d = segB[u];
          if (c === a || c === b || d === a || d === b) continue;
          const ex = vx[d] - vx[c], ez = vz[d] - vz[c];
          const den = dx * ez - dz * ex;
          if (Math.abs(den) < 1e-9) continue;
          const wx = vx[c] - ax, wz = vz[c] - az;
          const p = (wx * ez - wz * ex) / den, q = (wx * dz - wz * dx) / den;
          const La = Math.hypot(dx, dz), Lb = Math.hypot(ex, ez);
          if (p * La < 0.5 || p * La > La - 0.5 || q * Lb < 0.5 || q * Lb > Lb - 0.5) continue;
          const v = vertexOf(ax + dx * p, az + dz * p, 1);
          addSplit(s, p * La, v);
          addSplit(u, q * Lb, v);
        }
      }
    }
  }
  if (splits.size) {
    const A = [], B = [], Wd = [];
    for (let s = 0; s < ns; s++) {
      const l = splits.get(s);
      if (!l) { A.push(segA[s]); B.push(segB[s]); Wd.push(segW[s]); continue; }
      l.sort((p, q) => p.t - q.t);
      let prev = segA[s];
      for (const q of l) {
        if (q.v !== prev) { A.push(prev); B.push(q.v); Wd.push(segW[s]); }
        prev = q.v;
      }
      if (prev !== segB[s]) { A.push(prev); B.push(segB[s]); Wd.push(segW[s]); }
    }
    return [A, B, Wd];
  }
  return null;
}

// Removes the spots (only car park ones when lotOnly) with
// Math.hypot(dx, dz) < r from (x, z), keeping the order of the rest;
// hypot only where the squared distance is within rounding of r squared.
function dropSpotsNear(spots, x, z, r, lotOnly) {
  const r2 = r * r, lo = r2 * (1 - 1e-9), hi = r2 * (1 + 1e-9);
  let w = 0;
  for (let i = 0; i < spots.length; i++) {
    const p = spots[i];
    const dx = p.x - x, dz = p.z - z, d2 = dx * dx + dz * dz;
    const near = (!lotOnly || p.lot) && (d2 < lo || (d2 <= hi && Math.hypot(dx, dz) < r));
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
// opts: { crop, spots, seed }. data: the parsed miami.json.
export function createMiamiCity(data, opts = {}) {
  const tStart = typeof performance !== 'undefined' ? performance.now() : Date.now();
  // The whole data box by default (milestone 3); `opts.crop` (a test
  // option, e.g. MIAMI_CROP) limits it to a rect with land cut
  // LAND_MARGIN m outside it.
  const crop = opts.crop || fullBox(data);
  const margin = opts.crop ? LAND_MARGIN : BOX_INSET;
  const S = opts.spots || MIAMI_SPOTS;
  const seed = opts.seed ?? 25780;
  const rng = createRng(seed);
  const timings = {};
  let tMark = tStart;
  const lap = (name) => {
    const t = typeof performance !== 'undefined' ? performance.now() : Date.now();
    timings[name] = Math.round(t - tMark);
    tMark = t;
  };

  // ---- 1. Land mask: coastline sides, water polygons, the river. ----
  const cut = { x0: crop.x0 - margin, z0: crop.z0 - margin, x1: crop.x1 + margin, z1: crop.z1 + margin };
  const land = makeRaster(cut.x0 - SEA_PAD, cut.z0 - SEA_PAD, cut.x1 + SEA_PAD, cut.z1 + SEA_PAD, CELL);
  const W = land.w, H = land.h, NC = W * H;
  const labelBuf = new Int32Array(NC), queueBuf = new Int32Array(NC);
  let coastLand = null;
  {
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
    // along the box closes every region inside.
    if (!opts.crop) {
      stampLine(wall, cut.x0, cut.z0, cut.x1, cut.z0, 1);
      stampLine(wall, cut.x1, cut.z0, cut.x1, cut.z1, 1);
      stampLine(wall, cut.x1, cut.z1, cut.x0, cut.z1, 1);
      stampLine(wall, cut.x0, cut.z1, cut.x0, cut.z0, 1);
    }
    lap('land.coast');
    const label = labelBuf;
    const nLab = labelRegions(wall.data, W, H, label, queueBuf);
    lap('land.fill');
    const votes = new Float64Array(nLab);
    for (const pts of coast) voteCoast(pts, land, label, votes, bx1, bz1);
    applyVotes(label, votes, land.data, NC);
    lap('land.votes');
    // Wall cells: majority of their labelled neighbours.
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
  }
  const baseLand = land.data.slice(); // before the islet: "is it real land"
  // Hot lookups read the raster bounds from constants, not the raster
  // object (whose shape the optimiser may see change during the build).
  const landCell = cellLookup(land);
  const baseAt = (x, z) => {
    const c = landCell(x, z);
    return c >= 0 && baseLand[c] === 1;
  };
  lap('land');

  // ---- 2. Roads: drivable ways inside the crop. ----
  const CX0 = crop.x0, CX1 = crop.x1, CZ0 = crop.z0, CZ1 = crop.z1;
  const inCrop = (x, z) => x >= CX0 && x <= CX1 && z >= CZ0 && z <= CZ1;
  const ways = [];
  for (const r of data.roads) {
    if (!DRIVE.has(r.class)) continue;
    if (r.name && /tunnel/i.test(r.name)) continue;
    const fx = r.p[0] / 10, fz = r.p[1] / 10;
    if (fx < crop.x0 - 3000 || fx > crop.x1 + 3000 || fz < crop.z0 - 3000 || fz > crop.z1 + 3000) continue;
    const pts = decodePolyline(r.p);
    const nearWater = (x, z) => {
      for (let k = 0; k < 8; k++) {
        const c = landCell(x + Math.cos(k * 0.785) * 40, z + Math.sin(k * 0.785) * 40);
        if (c < 0 || !coastLand[c]) return true;
      }
      return false;
    };
    const m = pts.length;
    // Freeway pieces at grade between the dropped flyovers are islands of
    // ramps; only the ones that run out to a water crossing are kept.
    if (!r.bridge && r.class.startsWith('motorway') && !nearWater(pts[0], pts[1]) && !nearWater(pts[m - 2], pts[m - 1])) continue;
    if (r.bridge) {
      // A long bridge over land is a flyover: the flat world would make
      // it cross the streets below at grade, so it is left out.
      let on = 0, n = 0, L = 0;
      for (let k = 0; k + 3 < pts.length; k += 2) {
        const sl = Math.hypot(pts[k + 2] - pts[k], pts[k + 3] - pts[k + 1]);
        L += sl;
        for (let t = 0; t < sl; t += 5) {
          n++;
          if (baseAt(pts[k] + ((pts[k + 2] - pts[k]) * t) / sl, pts[k + 1] + ((pts[k + 3] - pts[k + 1]) * t) / sl)) on++;
        }
      }
      // Bridges that land near the water are approaches to a crossing: kept.
      if (n && on / n > 0.6 && L > 50 && !nearWater(pts[0], pts[1]) && !nearWater(pts[m - 2], pts[m - 1])) continue;
    }
    const oneway = !!r.oneway;
    const avenue = !oneway && (BIG.has(r.class) || (r.lanes || 0) >= 4);
    const info = { cls: r.class, name: r.name || '', bridge: !!r.bridge, oneway, avenue, width: avenue ? AVENUE_W : STREET_W };
    // Split at the crop edge: only runs of vertices inside it.
    let run = [];
    const flush = () => {
      if (run.length >= 4) ways.push({ ...info, pts: run });
      run = [];
    };
    // Where a segment leaves the crop, it is cut at the edge.
    const edgePoint = (ax, az, bx, bz) => {
      let t = 1;
      const dx = bx - ax, dz = bz - az;
      if (bx < crop.x0) t = Math.min(t, (crop.x0 - ax) / dx);
      if (bx > crop.x1) t = Math.min(t, (crop.x1 - ax) / dx);
      if (bz < crop.z0) t = Math.min(t, (crop.z0 - az) / dz);
      if (bz > crop.z1) t = Math.min(t, (crop.z1 - az) / dz);
      run.push(Math.round((ax + dx * t) * 10) / 10, Math.round((az + dz * t) * 10) / 10);
    };
    for (let k = 0; k < pts.length; k += 2) {
      const x = pts[k], z = pts[k + 1];
      const inside = inCrop(x, z);
      const prevIn = k > 0 && inCrop(pts[k - 2], pts[k - 1]);
      if (inside) {
        if (k > 0 && !prevIn) edgePoint(x, z, pts[k - 2], pts[k - 1]);
        run.push(x, z);
      } else if (prevIn) {
        edgePoint(pts[k - 2], pts[k - 1], x, z);
        flush();
      }
    }
    flush();
  }

  // Vertices are shared where the data shares them (same decimetre).
  const vx = [], vz = [], vflag = []; // flag: 1 street, 2 bridge, 4 way end
  const vkey = new Map();
  const vertexOf = (x, z, flag) => {
    const key = Math.round(x * 10 + 100000) * 400000 + Math.round(z * 10 + 100000);
    let id = vkey.get(key);
    if (id === undefined) {
      id = vx.length;
      vkey.set(key, id);
      vx.push(x);
      vz.push(z);
      vflag.push(0);
    }
    vflag[id] |= flag;
    return id;
  };
  let segA = [], segB = [], segW = [];
  ways.forEach((w, wi) => {
    const n = w.pts.length / 2;
    let prev = -1;
    for (let k = 0; k < n; k++) {
      const id = vertexOf(w.pts[2 * k], w.pts[2 * k + 1], (w.bridge ? 2 : 1) | (k === 0 || k === n - 1 ? 4 : 0));
      if (prev >= 0 && prev !== id) {
        segA.push(prev);
        segB.push(id);
        segW.push(wi);
      }
      prev = id;
    }
  });

  // Junctions the simplified data lost: a vertex lying on another road,
  // or two streets crossing with no shared vertex.
  {
    const split = splitJunctions(crop, vx, vz, vflag, segA, segB, segW, ways, vertexOf);
    if (split) [segA, segB, segW] = split;
  }

  // Merge junction vertices closer than MERGE m (dual carriageways, ramps).
  const nv = vx.length;
  const parent = new Int32Array(nv);
  for (let v = 0; v < nv; v++) parent[v] = v;
  const find = (v) => {
    while (parent[v] !== v) v = parent[v] = parent[parent[v]];
    return v;
  };
  {
    const deg = new Int32Array(nv);
    for (let s = 0; s < segA.length; s++) { deg[segA[s]]++; deg[segB[s]]++; }
    const grid = new Map();
    const MG = MERGE;
    const junc = [];
    for (let v = 0; v < nv; v++) {
      if (deg[v] === 0 || deg[v] === 2) continue;
      junc.push(v);
      const k = Math.floor(vx[v] / MG) * 100000 + Math.floor(vz[v] / MG);
      let l = grid.get(k);
      if (!l) grid.set(k, (l = []));
      l.push(v);
    }
    for (const v of junc) {
      const ci = Math.floor(vx[v] / MG), cj = Math.floor(vz[v] / MG);
      for (let dj = -1; dj <= 1; dj++) {
        for (let di = -1; di <= 1; di++) {
          const l = grid.get((ci + di) * 100000 + cj + dj);
          if (!l) continue;
          for (const u of l) {
            if (u <= v) continue;
            if ((vx[u] - vx[v]) ** 2 + (vz[u] - vz[v]) ** 2 > MG * MG) continue;
            const ra = find(u), rb = find(v);
            if (ra !== rb) parent[ra] = rb;
          }
        }
      }
    }
  }
  // Representative positions: the mean of each merged group.
  const px = new Float64Array(nv), pz = new Float64Array(nv), pn = new Int32Array(nv);
  for (let v = 0; v < nv; v++) {
    const r = find(v);
    px[r] += vx[v];
    pz[r] += vz[v];
    pn[r]++;
  }
  // Adjacency on representatives (one segment per pair, the wider wins).
  const adj = new Map(); // rep -> Map(rep -> way index)
  const link = (a, b, wi) => {
    let m = adj.get(a);
    if (!m) adj.set(a, (m = new Map()));
    const old = m.get(b);
    if (old === undefined || ways[wi].width > ways[old].width) m.set(b, wi);
  };
  for (let s = 0; s < segA.length; s++) {
    const a = find(segA[s]), b = find(segB[s]);
    if (a === b) continue;
    link(a, b, segW[s]);
    link(b, a, segW[s]);
  }
  for (const s of S.links || []) {
    // Hand-made links: nearest representative to each end.
    const near = (x, z) => {
      let best = -1, bd = Infinity;
      for (const r of adj.keys()) {
        const d = (px[r] / pn[r] - x) ** 2 + (pz[r] / pn[r] - z) ** 2;
        if (d < bd) { bd = d; best = r; }
      }
      return best;
    };
    const a = near(s[0], s[1]), b = near(s[2], s[3]);
    if (a >= 0 && b >= 0 && a !== b) {
      ways.push({ cls: 'unclassified', name: '', bridge: false, oneway: false, avenue: false, width: STREET_W, pts: [] });
      link(a, b, ways.length - 1);
      link(b, a, ways.length - 1);
    }
  }
  const posX = (r) => px[r] / pn[r], posZ = (r) => pz[r] / pn[r];
  const sameKind = (w1, w2) => w1 === w2 || (ways[w1].width === ways[w2].width && ways[w1].bridge === ways[w2].bridge && ways[w1].cls === ways[w2].cls && ways[w1].name === ways[w2].name);
  // Chains between junctions, simplified (Douglas-Peucker) into edges.
  const isBreak = (r) => {
    const m = adj.get(r);
    if (!m || m.size !== 2) return true;
    const [w1, w2] = [...m.values()];
    return !sameKind(w1, w2);
  };
  const nodes = [], edges = [];
  const nodeOfRep = new Map();
  const nodeFor = (r) => {
    let n = nodeOfRep.get(r);
    if (n === undefined) {
      n = nodes.length;
      nodeOfRep.set(r, n);
      nodes.push({ id: n, i: 0, j: 0, x: posX(r), z: posZ(r), hx: 2, hz: 2, edges: [], signal: false });
    }
    return n;
  };
  const edgeKey = new Set();
  const addEdge = (na, nb, wi) => {
    if (na === nb) return;
    const k = na < nb ? na * 1e6 + nb : nb * 1e6 + na;
    if (edgeKey.has(k)) return;
    edgeKey.add(k);
    const A = nodes[na], Bn = nodes[nb], w = ways[wi];
    const dx = Bn.x - A.x, dz = Bn.z - A.z, length = Math.hypot(dx, dz);
    if (length < 0.5) return;
    edges.push({
      id: edges.length, a: na, b: nb, horizontal: Math.abs(dx) >= Math.abs(dz), width: w.width, avenue: w.avenue, length,
      ux: dx / length, uz: dz / length, bridge: w.bridge, oneway: w.oneway, cls: w.cls, name: w.name,
    });
  };
  const visited = new Set();
  const pairKey = (a, b) => (a < b ? a * 1e7 + b : b * 1e7 + a);
  const simplify = (chain, wi) => {
    // chain: reps from break to break.
    const keep = new Uint8Array(chain.length);
    keep[0] = keep[chain.length - 1] = 1;
    const dp = (i0, i1) => {
      let best = -1, bd = CHAIN_TOL * CHAIN_TOL;
      const ax = posX(chain[i0]), az = posZ(chain[i0]), bx = posX(chain[i1]), bz = posZ(chain[i1]);
      for (let i = i0 + 1; i < i1; i++) {
        const d = segDist2(posX(chain[i]), posZ(chain[i]), ax, az, bx, bz);
        if (d > bd) { bd = d; best = i; }
      }
      if (best >= 0) {
        keep[best] = 1;
        dp(i0, best);
        dp(best, i1);
      }
    };
    dp(0, chain.length - 1);
    let prev = nodeFor(chain[0]);
    for (let i = 1; i < chain.length; i++) {
      if (!keep[i]) continue;
      const n = nodeFor(chain[i]);
      addEdge(prev, n, wi);
      prev = n;
    }
  };
  const walkFrom = (start, next) => {
    const chain = [start, next];
    const wi = adj.get(start).get(next);
    visited.add(pairKey(start, next));
    let prev = start, cur = next;
    while (!isBreak(cur) && cur !== start) {
      let nxt = -1;
      for (const o of adj.get(cur).keys()) if (o !== prev) nxt = o;
      if (nxt < 0 || visited.has(pairKey(cur, nxt))) break;
      visited.add(pairKey(cur, nxt));
      chain.push(nxt);
      prev = cur;
      cur = nxt;
    }
    simplify(chain, wi);
  };
  for (const r of adj.keys()) {
    if (!isBreak(r)) continue;
    for (const o of adj.get(r).keys()) if (!visited.has(pairKey(r, o))) walkFrom(r, o);
  }
  for (const r of adj.keys()) {
    // Loops with no junction on them (a roundabout on its own).
    for (const o of adj.get(r).keys()) if (!visited.has(pairKey(r, o))) walkFrom(r, o);
  }
  for (const e of edges) {
    nodes[e.a].edges.push(e.id);
    nodes[e.b].edges.push(e.id);
  }
  lap('graph');

  // ---- 3. Airfield islet and causeway (citygen's layout, placed here). ----
  // Anchor: the shore end of the street the causeway leaves from.
  let anchor = null;
  {
    let bd = Infinity;
    for (const n of nodes) {
      if (!n.edges.length) continue;
      const d = Math.hypot(n.x - S.airfield.x, n.z - S.airfield.z);
      if (d < bd) { bd = d; anchor = n; }
    }
  }
  const IW = 300;
  const islet = { x0: S.airfield.isletX0, z0: anchor.z - 205, x1: S.airfield.isletX1, z1: anchor.z - 205 + IW };
  const roadHalf = STREET_W / 2;
  const gate = { id: nodes.length, i: -1, j: -1, x: islet.x0 + 60, z: anchor.z, hx: roadHalf, hz: roadHalf, edges: [], signal: false };
  nodes.push(gate);
  {
    const L = gate.x - anchor.x;
    edges.push({ id: edges.length, a: anchor.id, b: gate.id, horizontal: true, width: STREET_W, avenue: false, length: L, ux: 1, uz: 0, causeway: true, bridge: false, oneway: false, cls: 'causeway', name: 'Gullwing Causeway' });
    anchor.edges.push(edges.length - 1);
    gate.edges.push(edges.length - 1);
  }
  const causewayRect = { x0: anchor.x - 30, z0: anchor.z - roadHalf - 4, x1: islet.x0 + 30, z1: anchor.z + roadHalf + 4 };
  const extraLand = [islet, causewayRect];

  // Keep the largest connected road network only.
  const graphStats = {};
  {
    const comp = new Int32Array(nodes.length).fill(-1);
    let best = -1, bestN = 0, c = 0;
    for (const n of nodes) {
      if (comp[n.id] >= 0) continue;
      const stack = [n.id];
      comp[n.id] = c;
      let cnt = 0;
      while (stack.length) {
        const k = stack.pop();
        cnt++;
        for (const eid of nodes[k].edges) {
          const e = edges[eid];
          const o = e.a === k ? e.b : e.a;
          if (comp[o] < 0) { comp[o] = c; stack.push(o); }
        }
      }
      if (cnt > bestN) { bestN = cnt; best = c; }
      c++;
    }
    // Junctions (degree 1 or 3+) per component, for the connectivity check.
    const jc = new Int32Array(c);
    for (const n of nodes) if (n.edges.length !== 2) jc[comp[n.id]]++;
    let jAll = 0;
    for (let k = 0; k < c; k++) jAll += jc[k];
    graphStats.components = c;
    graphStats.junctions = jAll;
    graphStats.mainJunctions = jc[best];
    graphStats.nodesBefore = nodes.length;
    graphStats.nodesKept = bestN;
    graphStats.lost = [];
    for (let k = 0; k < c; k++) {
      if (k === best || jc[k] < 3) continue;
      const n = nodes.find((q) => comp[q.id] === k);
      graphStats.lost.push({ junctions: jc[k], x: Math.round(n.x), z: Math.round(n.z) });
    }
    const remap = new Int32Array(nodes.length).fill(-1);
    const keptNodes = [];
    for (const n of nodes) {
      if (comp[n.id] !== best) continue;
      remap[n.id] = keptNodes.length;
      n.id = keptNodes.length;
      n.edges = [];
      keptNodes.push(n);
    }
    const keptEdges = [];
    for (const e of edges) {
      if (remap[e.a] < 0 || remap[e.b] < 0) continue;
      e.a = remap[e.a];
      e.b = remap[e.b];
      e.id = keptEdges.length;
      keptEdges.push(e);
      keptNodes[e.a].edges.push(e.id);
      keptNodes[e.b].edges.push(e.id);
    }
    nodes.length = 0;
    nodes.push(...keptNodes);
    edges.length = 0;
    edges.push(...keptEdges);
  }
  if (gate.id >= nodes.length || nodes[gate.id] !== gate) throw new Error('miami: the airfield causeway is not on the main road network');
  // Junction boxes: half the widest road, kept short of the edges.
  for (const n of nodes) {
    if (n.i < 0) continue;
    let half = 0, minLen = Infinity, avenue = false;
    for (const eid of n.edges) {
      const e = edges[eid];
      half = Math.max(half, e.width / 2);
      minLen = Math.min(minLen, e.length);
      if (e.avenue) avenue = true;
    }
    const deg = n.edges.length;
    const want = deg === 2 ? 2 : half;
    n.hx = n.hz = Math.max(1, Math.min(want, minLen * 0.4));
    if (deg === 2) n.bend = true;
    n.signal = deg >= 3 && avenue;
  }
  lap('network');

  // ---- 4. Spatial index of edges; shoreDist with every road on land. ----
  const gx0 = land.x0, gz0 = land.z0;
  const gw = Math.ceil((W * CELL) / GRID), gh = Math.ceil((H * CELL) / GRID);
  const buildIndex = (count, bounds) => {
    // CSR lists: for every GRID cell, the items whose bounds touch it.
    const cnt = new Int32Array(gw * gh + 1);
    const each = (k, fn) => {
      const b = bounds(k);
      const i0 = Math.max(0, Math.floor((b[0] - gx0) / GRID)), i1 = Math.min(gw - 1, Math.floor((b[2] - gx0) / GRID));
      const j0 = Math.max(0, Math.floor((b[1] - gz0) / GRID)), j1 = Math.min(gh - 1, Math.floor((b[3] - gz0) / GRID));
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) fn(j * gw + i);
    };
    for (let k = 0; k < count; k++) each(k, (c) => cnt[c + 1]++);
    for (let c = 0; c < gw * gh; c++) cnt[c + 1] += cnt[c];
    const items = new Int32Array(cnt[gw * gh]);
    const fill = cnt.slice();
    for (let k = 0; k < count; k++) each(k, (c) => { items[fill[c]++] = k; });
    return { start: cnt, items };
  };
  const EB = [0, 0, 0, 0];
  const edgeIndex = buildIndex(edges.length, (k) => {
    const e = edges[k], a = nodes[e.a], b = nodes[e.b], r = e.width / 2 + 1;
    EB[0] = Math.min(a.x, b.x) - r; EB[1] = Math.min(a.z, b.z) - r; EB[2] = Math.max(a.x, b.x) + r; EB[3] = Math.max(a.z, b.z) + r;
    return EB;
  });
  const gridCell = (x, z) => {
    const i = Math.floor((x - gx0) / GRID), j = Math.floor((z - gz0) / GRID);
    return i < 0 || j < 0 || i >= gw || j >= gh ? -1 : j * gw + i;
  };
  // Calls fn(edge) for every edge whose strip may come within r of the rect.
  const edgeSeen = new Int32Array(edges.length);
  let edgeMark = 0;
  const edgesInRect = (x0, z0, x1, z1, fn) => {
    const i0 = Math.max(0, Math.floor((x0 - gx0) / GRID)), i1 = Math.min(gw - 1, Math.floor((x1 - gx0) / GRID));
    const j0 = Math.max(0, Math.floor((z0 - gz0) / GRID)), j1 = Math.min(gh - 1, Math.floor((z1 - gz0) / GRID));
    const mark = ++edgeMark;
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const c = j * gw + i;
        for (let k = edgeIndex.start[c]; k < edgeIndex.start[c + 1]; k++) {
          const id = edgeIndex.items[k];
          if (edgeSeen[id] === mark) continue;
          edgeSeen[id] = mark;
          if (fn(edges[id]) === false) return;
        }
      }
    }
  };
  // Distance from a rect to the nearest road strip edge (negative = overlap).
  const roadClearance = (x0, z0, x1, z1, skip = null) => {
    let best = Infinity;
    edgesInRect(x0 - 12, z0 - 12, x1 + 12, z1 + 12, (e) => {
      if (e === skip) return;
      const a = nodes[e.a], b = nodes[e.b];
      const d = segRectDist(a.x, a.z, b.x, b.z, x0, z0, x1, z1) - e.width / 2;
      if (d < best) best = d;
    });
    return best;
  };

  // Shrinks rect r (x0, z0, x1, z1) away from road strips until it is
  // `margin` m clear of every kerb. False when it gets below minSize.
  const TR = { x0: 0, z0: 0, x1: 0, z1: 0 };
  function trimRect(r, margin, minSize) {
    for (let k = 0; k < 12; k++) {
      let hit = null;
      edgesInRect(r.x0 - 12, r.z0 - 12, r.x1 + 12, r.z1 + 12, (e) => {
        const a = nodes[e.a], b = nodes[e.b];
        if (segRectDist(a.x, a.z, b.x, b.z, r.x0, r.z0, r.x1, r.z1) - e.width / 2 < margin - 0.01) { hit = e; return false; }
        return true;
      });
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
  for (const e of edges) {
    const a = nodes[e.a], b = nodes[e.b];
    stampCapsule(land, a.x, a.z, b.x, b.z, e.width / 2 + 3, 1);
  }
  lap('shore.stamp');
  const fieldAll = signedField(land);
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
  stampRect(dist, islet.x0 - 60, islet.z0 - 60, islet.x1 + 60, islet.z1 + 60, DKEYS.indexOf('airfield'));
  const distCell = cellLookup(dist), distData = dist.data;
  function districtOf(x, z) {
    const c = distCell(x, z);
    return c < 0 ? 'midtown' : DKEYS[distData[c]];
  }
  // Real neighbourhood names for the HUD (placeOf, below), baked at 16 m:
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
  {
    const road = makeRaster(land.x0, land.z0, land.x0 + W * CELL, land.z0 + H * CELL, CELL);
    for (const e of edges) {
      const a = nodes[e.a], b = nodes[e.b];
      stampCapsule(road, a.x, a.z, b.x, b.z, e.width / 2, 1);
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
    const queue = queueBuf;
    const FB = new Int32Array(7);
    const ci0 = Math.max(0, Math.floor((crop.x0 - land.x0) / CELL)), ci1 = Math.min(W - 1, Math.floor((crop.x1 - land.x0) / CELL));
    const cj0 = Math.max(0, Math.floor((crop.z0 - land.z0) / CELL)), cj1 = Math.min(H - 1, Math.floor((crop.z1 - land.z0) / CELL));
    // Every road-free land region of the crop window, in scan order.
    const regions = floodRegions(W, ci0, ci1, cj0, cj1, baseLand, road.data, parkMask.data, lab, queue, FB);
    for (let r = 0; r < regions.length; r += 7) {
      {
        const qt = regions[r], bi0 = regions[r + 1], bi1 = regions[r + 2], bj0 = regions[r + 3], bj1 = regions[r + 4], parks = regions[r + 5], ok = regions[r + 6] === 1;
        const bw = (bi1 - bi0 + 1) * CELL, bh = (bj1 - bj0 + 1) * CELL;
        if (!ok || qt * CELL * CELL < 0.85 * bw * bh || Math.min(bw, bh) < 24 || Math.max(bw, bh) > 320) continue;
        // Start from the cell centres (clear of the road), then grow.
        let x0 = land.x0 + (bi0 + 0.5) * CELL, z0 = land.z0 + (bj0 + 0.5) * CELL, x1 = land.x0 + (bi1 + 0.5) * CELL, z1 = land.z0 + (bj1 + 0.5) * CELL;
        // Clear of every kerb first, then grow each side up to the kerb.
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
  }
  const blockIndex = buildIndex(blocks.length, (k) => {
    const b = blocks[k];
    EB[0] = b.x0; EB[1] = b.z0; EB[2] = b.x1; EB[3] = b.z1;
    return EB;
  });
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
    buildings.push({ x0, z0, x1, z1, h, district, kind, color: color ?? rng.pick(PALETTES[district] ?? PALETTES.midtown), osm, fp, gen, landmark: '', style: '', tint: 0, vseed: 0, block: -1, street: 0 });
  };
  {
    const BC = 2;
    const cellsBuf = new Uint8Array(200 * 200);
    const hist = new Int32Array(201);
    const stack = new Int32Array(202);
    const rects = new Int32Array(24);
    const FB4 = new Float64Array(5);
    const R2 = { x0: 0, z0: 0, cell: BC, w: 0, h: 0, data: cellsBuf };
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
      // Rasterise at 2 m (cell centres inside the polygon), then the
      // largest all-inside rectangles, until 85 % is covered.
      R2.x0 = x0; R2.z0 = z0; R2.w = cw; R2.h = ch;
      const nb = footprintRects(R2, pts, hist, stack, rects);
      if (!nb) continue;
      const kindTag = b.kind || '';
      const h = Math.max(3, b.h || 8);
      for (let k = 0; k < nb; k++) {
        const bi0 = rects[4 * k], bj0 = rects[4 * k + 1], bi1 = rects[4 * k + 2], bj1 = rects[4 * k + 3];
        const bx0 = bi0 === 0 ? x0 : x0 + bi0 * BC, bz0 = bj0 === 0 ? z0 : z0 + bj0 * BC;
        const bx1 = bi1 === cw - 1 ? x1 : x0 + (bi1 + 1) * BC, bz1 = bj1 === ch - 1 ? z1 : z0 + (bj1 + 1) * BC;
        placeBox(bx0, bz0, bx1, bz1, h, kindTag, fp);
      }
    }
  }
  function placeBox(x0, z0, x1, z1, h, tag, fp) {
    const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
    const blk = blockAt(cx, cz);
    if (blk) {
      // Inside a block: keep the pavement ring clear.
      x0 = Math.max(x0, blk.x0 + SIDEWALK); z0 = Math.max(z0, blk.z0 + SIDEWALK);
      x1 = Math.min(x1, blk.x1 - SIDEWALK); z1 = Math.min(z1, blk.z1 - SIDEWALK);
    } else {
      // Trim the side facing a road until it is 1.5 m clear of the kerb.
      TR.x0 = x0; TR.z0 = z0; TR.x1 = x1; TR.z1 = z1;
      if (!trimRect(TR, 1.5, 3)) return;
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
  const runway = { x0: islet.x0 + 40, z0: islet.z0 + 40, x1: islet.x1 - 30, z1: islet.z0 + 70, type: 'runway' };
  const apron = { x0: islet.x0 + 40, z0: runway.z1, x1: islet.x0 + 470, z1: anchor.z + roadHalf + 30, type: 'apron' };
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
  addPier('Airfield Dock', islet.x0 + 600, islet.z1 - 2, 0, 1, ['speedboat', 'jetski'], (x, z) => rectDist(islet, x, z));
  {
    const dock = piers[piers.length - 1];
    aircraftSpots.push({ x: dock.x1 + 14, z: dock.z1 - 12, heading: Math.PI / 2, spec: 'seaplane' });
    if (S.seaplane) aircraftSpots.push({ x: S.seaplane.x, z: S.seaplane.z, heading: S.seaplane.heading, spec: 'seaplane' });
  }
  for (const hp of S.helipads || []) helipads.push({ x: hp.x, z: hp.z });

  // Depot (as citygen, explicit colours, no rng).
  const tankSpots = [];
  let depot;
  {
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
  aircraftSpots.push(
    { x: islet.x0 + 90, z: runway.z1 + 34, heading: -Math.PI / 2, spec: 'fighter' },
    { x: islet.x0 + 448, z: runway.z1 + 40, heading: -Math.PI / 2, spec: 'patrolheli' },
  );

  // ---- 8b. Lot rasters and infill (docs/REVAMP.md 6.2, world/lots.js). ----
  // free: drawn land clear of every road strip and its pavement and
  // outside every building box; owner: the building box at a cell. Big
  // empty pieces of built-up districts get plain infill boxes (`gen`).
  let lotIn;
  const landmarkSites = [];
  {
    const near = new Uint8Array(NC);
    const R = { x0: land.x0, z0: land.z0, cell: CELL, w: W, h: H, data: near };
    for (const e of edges) {
      const a = nodes[e.a], b = nodes[e.b];
      stampCapsule(R, a.x, a.z, b.x, b.z, e.width / 2 + SIDEWALK, 1);
    }
    for (const n of nodes) stampRect(R, n.x - n.hx - SIDEWALK, n.z - n.hz - SIDEWALK, n.x + n.hx + SIDEWALK, n.z + n.hz + SIDEWALK, 1);
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
    const beachRects = (S.beaches || []).map((r) => [Math.ceil((r.x0 - land.x0) / CELL - 0.5), Math.floor((r.x1 - land.x0) / CELL - 0.5), Math.ceil((r.z0 - land.z0) / CELL - 0.5), Math.floor((r.z1 - land.z0) / CELL - 0.5)]);
    const inBeach = (c) => {
      const i = c % W, j = (c - i) / W;
      for (const r of beachRects) if (i >= r[0] && i <= r[1] && j >= r[2] && j <= r[3]) return true;
      return false;
    };
    const free = new Uint8Array(NC);
    // The free cells in row order (every lot cell is one of them).
    const list = freeCells(visual, near, owner, free, NC);
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
    const infill = planInfill({ W, H, x0: land.x0, z0: land.z0, cell: CELL, free, bdist, water, mask, districtOf, seed, keep });
    for (const f of infill) {
      const pal = PALETTES[f.district] || PALETTES.midtown;
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
    lotIn = { free, owner, park: parkCells, inBeach, water, queue: queueBuf, list, nList, scratch8: near };
  }
  lap('infill');

  // Building index (for spots, props and buildingsNear).
  const buildingIndex = buildIndex(buildings.length, (k) => {
    const b = buildings[k];
    EB[0] = b.x0; EB[1] = b.z0; EB[2] = b.x1; EB[3] = b.z1;
    return EB;
  });
  const buildingSeen = new Int32Array(buildings.length);
  let buildingMark = 0;
  const inBuilding = (x, z, m = 0) => {
    const c = gridCell(x, z);
    if (c < 0) return false;
    for (let k = buildingIndex.start[c]; k < buildingIndex.start[c + 1]; k++) {
      const b = buildings[buildingIndex.items[k]];
      if (x > b.x0 - m && x < b.x1 + m && z > b.z0 - m && z < b.z1 + m) return true;
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
      const a = nodes[e.a], b = nodes[e.b];
      const h = e.width / 2 + 0.3;
      if (segDist2(x, z, a.x, a.z, b.x, b.z) < h * h) return true;
    }
    return false;
  };
  // Other edge strips at a point, ignoring `own`.
  const onOtherRoad = (x, z, own, m) => {
    let hit = false;
    edgesInRect(x - 1, z - 1, x + 1, z + 1, (e) => {
      if (e === own) return true;
      const a = nodes[e.a], b = nodes[e.b], h = e.width / 2 + m;
      if (segDist2(x, z, a.x, a.z, b.x, b.z) < h * h) { hit = true; return false; }
      return true;
    });
    return hit;
  };
  const inJunctionBox = (x, z, m) => {
    let hit = false;
    edgesInRect(x - 1, z - 1, x + 1, z + 1, (e) => {
      for (const id of [e.a, e.b]) {
        const n = nodes[id];
        if (n.edges.length !== 2 && Math.abs(x - n.x) < n.hx + m && Math.abs(z - n.z) < n.hz + m) { hit = true; return false; }
      }
      return true;
    });
    return hit;
  };

  // ---- 9. Spawn: on the named street, near the given point. ----
  let spawn;
  {
    let best = null, bd = Infinity;
    const LP = { x: 0, z: 0 };
    for (const e of edges) {
      if (e.name !== S.spawn.street || e.causeway) continue;
      const a = nodes[e.a], b = nodes[e.b];
      for (let d = Math.min(e.length / 2, 12); d <= e.length - 12; d += 2) {
        // Right-hand lane of the direction closest to the wanted heading.
        const fwd = Math.cos(S.spawn.heading) * e.ux + Math.sin(S.spawn.heading) * e.uz >= 0;
        const from = fwd ? a : b, ux = fwd ? e.ux : -e.ux, uz = fwd ? e.uz : -e.uz;
        const off = e.avenue ? 2.6 : 2.0;
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
  }

  // ---- 10. Kerb parking, lamps, street trees, signals. ----
  const parkingSpots = [], props = [], furniture = [], signals = [];
  const dr = createRng(seed ^ 0x5eed51);
  for (const e of edges) {
    const a = nodes[e.a], b = nodes[e.b];
    const half = e.width / 2;
    const startPad = a.hx + 6, endPad = b.hx + 6;
    const usable = e.length - startPad - endPad;
    const rx = -e.uz, rzv = e.ux; // right of a -> b
    if (!e.bridge && !e.causeway) {
      for (let d = startPad; d <= e.length - endPad; d += 34) {
        const side = ((d / 34) | 0) % 2 ? 1 : -1;
        const x = a.x + e.ux * d + rx * side * (half + 0.8), z = a.z + e.uz * d + rzv * side * (half + 0.8);
        if (inBuilding(x, z, 0.5) || onOtherRoad(x, z, e, 0.3) || mainShore(x, z) < 1) continue;
        props.push({ type: 'lamp', x, z, r: 0.18, h: 7, rot: Math.atan2(-rx * side, -rzv * side) });
      }
    }
    if (!e.avenue && !e.causeway && !e.bridge && usable > 14) {
      for (const side of [-1, 1]) {
        for (let d = startPad + 3; d < e.length - endPad - 3; d += 6.5) {
          if (!rng.chance(0.22)) continue;
          const off = side * (half - 1.25);
          const x = a.x + e.ux * d + rx * off, z = a.z + e.uz * d + rzv * off;
          if (mainShore(x, z) < 3 || inBuilding(x, z, 1.5) || onOtherRoad(x, z, e, 1.5) || inJunctionBox(x, z, 3)) continue;
          const heading = side > 0 ? Math.atan2(e.uz, e.ux) : Math.atan2(-e.uz, -e.ux);
          parkingSpots.push({ x, z, heading, lot: false });
        }
      }
    }
  }
  const TREE_P = { downtown: 0.55, midtown: 0.5, residential: 0.7, beach: 0.7, docks: 0.08, industrial: 0.1, park: 0.7, airfield: 0 };
  for (const e of edges) {
    if (e.causeway || e.bridge) continue;
    const a = nodes[e.a];
    const half = e.width / 2;
    const rx = -e.uz, rzv = e.ux;
    for (const side of [-1, 1]) {
      const treeP = TREE_P[districtOf(a.x, a.z)] ?? 0.3;
      for (let d = a.hx + 10; d + 10 <= e.length - nodes[e.b].hx; d += 24) {
        if (!dr.chance(treeP)) continue;
        const x = a.x + e.ux * d + rx * side * (half + 1.15), z = a.z + e.uz * d + rzv * side * (half + 1.15);
        if (!blockAt(x, z) || inBuilding(x, z, 1) || onOtherRoad(x, z, e, 0.5)) continue;
        furniture.push({ type: 'streettree', x, z, rot: dr.range(0, TAU), q: 0, v: dr.next() });
      }
    }
  }
  for (const n of nodes) {
    if (!n.signal || n.i < 0) continue;
    for (const eid of n.edges) {
      const e = edges[eid];
      const o = nodes[e.a === n.id ? e.b : e.a];
      const l = Math.hypot(n.x - o.x, n.z - o.z);
      const tx = (n.x - o.x) / l, tz = (n.z - o.z) / l;
      const rx = -tz, rzv = tx;
      const x = n.x - tx * (n.hx + 0.9) + rx * (e.width / 2 + 0.9);
      const z = n.z - tz * (n.hx + 0.9) + rzv * (e.width / 2 + 0.9);
      if (inBuilding(x, z, 0.5) || onOtherRoad(x, z, e, 0.2)) continue;
      signals.push({ node: n.id, x, z, face: Math.atan2(-tz, -tx), armDir: Math.atan2(-rzv, -rx), armLen: (e.width / 2) * 0.5 + 0.9, horizontal: e.horizontal });
    }
  }

  // ---- 10b. The designed start street (MIAMI_SPOTS.startView, core hand
  // content): street trees on both kerbs and kerb spaces (`start`, filled
  // first) along the spawn street ahead of the title camera. No rng.
  if (S.startView) {
    const fx = Math.cos(spawn.heading), fz = Math.sin(spawn.heading);
    const TREE_STEP = 7, SPOT_STEP = 6.5;
    // The two framed views stay clear of trunks and posts (docs/PLAN_V1.md
    // W2b): the title shot (a cone of FRAME_DEG round the view line within
    // FRAME_R m, along the whole dolly) and the near pavement in front of
    // the chase camera at the start (NEAR_R m, the width of the view).
    const cam = S.startView.camera;
    const FRAME_DEG = 9.5, FRAME_R = 42, NEAR_R = 16.5, NEAR_DEG = 55, CHASE_BACK = 7.5;
    const tanF = Math.tan((FRAME_DEG * Math.PI) / 180), cosN = Math.cos((NEAR_DEG * Math.PI) / 180);
    const framed = (x, z, r) => {
      for (let d = 0; d <= cam.dolly + 1e-9; d += cam.dolly / 4 || 1) {
        // Camera and look point as in render/titlecam.js titlePose.
        const cx = spawn.x + fx * (d - cam.back) - fz * cam.side, cz = spawn.z + fz * (d - cam.back) + fx * cam.side;
        const lx = spawn.x + fx * (d + cam.lookAhead) - cx, lz = spawn.z + fz * (d + cam.lookAhead) - cz;
        const ll = Math.hypot(lx, lz);
        const along = ((x - cx) * lx + (z - cz) * lz) / ll, lat = Math.abs((x - cx) * lz - (z - cz) * lx) / ll;
        if (along > 0 && along < FRAME_R + r && lat - r < along * tanF) return true;
        // Nothing tall right in front of the title camera either.
        if (along > 0 && along < NEAR_R && along > lat * 0.8) return true;
        if (!cam.dolly) break;
      }
      const qx = x - (spawn.x - fx * CHASE_BACK), qz = z - (spawn.z - fz * CHASE_BACK), q = Math.hypot(qx, qz);
      return q < NEAR_R && (qx * fx + qz * fz) > q * cosN;
    };
    const TALL = new Set(['streettree', 'palmtree', 'lamp', 'shelter', 'streetsign', 'namesign', 'stopsign', 'umbrella']);
    const keep = (list) => {
      let n = 0;
      for (const f of list) if (!(TALL.has(f.type) && framed(f.x, f.z, 0.5))) list[n++] = f;
      list.length = n;
    };
    keep(props);
    keep(furniture);
    for (const e of edges) {
      if (e.name !== S.spawn.street || e.bridge || e.causeway) continue;
      const a = nodes[e.a], b = nodes[e.b];
      const half = e.width / 2;
      const rx = -e.uz, rzv = e.ux;
      let prevSlot = null;
      for (let d = a.hx + 4; d <= e.length - b.hx - 4; d += 1) {
        const px = a.x + e.ux * d, pz = a.z + e.uz * d;
        const along = (px - spawn.x) * fx + (pz - spawn.z) * fz;
        const lat = -(px - spawn.x) * fz + (pz - spawn.z) * fx;
        if (along < -20 || along > 110 || Math.abs(lat) > 12) continue;
        // One tree slot each TREE_STEP m of `along` (the first metre step
        // into a new slot), so no slot is skipped or doubled by rounding.
        const slot = Math.floor((along + 20) / TREE_STEP);
        const newSlot = slot !== prevSlot;
        prevSlot = slot;
        const k = slot * TREE_STEP;
        for (const side of [-1, 1]) {
          if (newSlot) {
            // On the kerb line, or set back into the plaza where the kerb
            // line is in a framed view.
            for (const off of [1.15, 4.8]) {
              const x = px + rx * side * (half + off), z = pz + rzv * side * (half + off);
              if (framed(x, z, off > 2 ? 1.5 : 0.5)) continue;
              if (!inBuilding(x, z, 1.2) && !onOtherRoad(x, z, e, 0.5) && !inJunctionBox(x, z, 2) && mainShore(x, z) > 2 && !furniture.some((f) => Math.hypot(f.x - x, f.z - z) < 4)) {
                furniture.push({ type: 'streettree', x, z, rot: (k * 0.61) % TAU, q: 0, v: ((k * 37 + (side > 0 ? 11 : 0)) % 100) / 100 });
              }
              break;
            }
          }
          if (Math.round(along * 2) % Math.round(SPOT_STEP * 2) === 0 && along > 10 && along < 90) {
            const off = side * (half - 1.25);
            const x = px + rx * off, z = pz + rzv * off;
            if (mainShore(x, z) < 3 || inBuilding(x, z, 1.5) || onOtherRoad(x, z, e, 1.5) || inJunctionBox(x, z, 3)) continue;
            if (parkingSpots.some((p) => Math.hypot(p.x - x, p.z - z) < 5.5)) continue;
            const heading = side > 0 ? Math.atan2(e.uz, e.ux) : Math.atan2(-e.uz, -e.ux);
            parkingSpots.push({ x, z, heading, lot: false, start: true });
          }
        }
      }
    }
  }

  // ---- 11. Facade styles (citygen's rules, own random stream). ----
  for (const b of buildings) {
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

  // Police roof pad: the midtown roof nearest a downtown anchor.
  const roofPads = [];
  {
    let best = null, bd = Infinity;
    const ax = S.roofPadAnchor ? S.roofPadAnchor.x : -1100, az = S.roofPadAnchor ? S.roofPadAnchor.z : 600;
    for (const b of buildings) {
      if (b.district !== 'midtown' || b.kind !== 'building' || b.x1 - b.x0 < 16 || b.z1 - b.z0 < 16 || b.h < 12 || b.h > 30) continue;
      const d = Math.hypot((b.x0 + b.x1) / 2 - ax, (b.z0 + b.z1) / 2 - az);
      if (d < bd) { bd = d; best = b; }
    }
    if (best) roofPads.push({ x: (best.x0 + best.x1) / 2, z: (best.z0 + best.z1) / 2, y: best.h, building: buildings.indexOf(best) });
    for (const r of roofPads) aircraftSpots.push({ x: r.x, z: r.z, heading: 0, spec: 'patrolheli', roof: true });
  }

  // Landmarks: windsock, runway lights and the port cranes.
  const landmarks = { lighthouse: null, cranes: [], billboards: [], windsock: { x: runway.x0 + 70, z: runway.z0 - 14 }, runwayLights: [] };
  // Each crane steps south from its point to the quay edge: legs (x +-7,
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
  // The Cinder tank: open ground in a Wynwood yard (no car parks in the
  // data); kerb spaces within 6 m are cleared, as in citygen.
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
  for (let x = runway.x0; x <= runway.x1 + 0.1; x += 35.5) {
    landmarks.runwayLights.push({ x, z: runway.z0 - 1.4, color: 0xfff2d0 }, { x, z: runway.z1 + 1.4, color: 0xfff2d0 });
  }
  for (let k = 0; k < 6; k++) {
    const z = runway.z0 + 2.5 + k * ((runway.z1 - runway.z0 - 5) / 5);
    landmarks.runwayLights.push({ x: runway.x0 - 1.5, z, color: 0x40ff70 }, { x: runway.x1 + 1.5, z, color: 0xff4030 });
  }

  // Street name signs (the sign textures hold 32 names): the names that
  // meet most often at signal junctions (ties: the longer road), then a
  // sign on a corner of every signal junction where two of them cross.
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
  for (const n of nodes) {
    if (!n.signal) continue;
    const ns = namesAt(n);
    if (ns.length >= 2) for (const nm of ns) nameHits.set(nm, (nameHits.get(nm) || 0) + 1);
  }
  const topNames = [...nameLen.keys()]
    .sort((p, q) => (nameHits.get(q) || 0) - (nameHits.get(p) || 0) || nameLen.get(q) - nameLen.get(p) || (p < q ? -1 : 1))
    .slice(0, 32);
  while (topNames.length < 32) topNames.push('Biscayne Bay');
  const streetNames = { x: topNames.slice(0, 16), z: topNames.slice(16, 32), plates: topNames.map(plateText) };
  {
    const plateOf = new Map(topNames.map((nm, k) => [nm, k]));
    for (const n of nodes) {
      if (!n.signal || n.i < 0) continue;
      // The two signed roads: the first edge of each of two names.
      let ea = null, eb = null;
      for (const eid of n.edges) {
        const e = edges[eid];
        if (!plateOf.has(e.name)) continue;
        if (!ea) ea = e;
        else if (e.name !== ea.name && !eb) eb = e;
      }
      if (!ea || !eb) continue;
      // Directions away from the junction along each road.
      const dir = (e) => (e.a === n.id ? 1 : -1);
      const ax = ea.ux * dir(ea), az = ea.uz * dir(ea), bx = eb.ux * dir(eb), bz = eb.uz * dir(eb);
      // The corner between them, clear of both carriageways.
      const x = n.x + ax * (eb.width / 2 + 1.6) + bx * (ea.width / 2 + 1.6);
      const z = n.z + az * (eb.width / 2 + 1.6) + bz * (ea.width / 2 + 1.6);
      if (onRoad(x, z) || inBuilding(x, z, 0.8) || mainShore(x, z) < 2) continue;
      // Each plate runs along its own road.
      furniture.push({ type: 'streetsign', x, z, rot: 0, q: 0, v: 0, a: plateOf.get(ea.name), b: plateOf.get(eb.name), ra: Math.atan2(az, ax), rb: Math.atan2(bz, bx) });
    }
  }

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
    edgesInRect(x - r, z - r, x + r, z + r, (e) => {
      const a = nodes[e.a], b = nodes[e.b], h = r + e.width / 2;
      if (segDist2(x, z, a.x, a.z, b.x, b.z) <= h * h) out.push(e.id);
    });
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
          const id = buildingIndex.items[k];
          const b = buildings[id];
          if (buildingSeen[id] === mark || b.x1 < x0 || b.x0 > x1 || b.z1 < z0 || b.z0 > z1) continue;
          buildingSeen[id] = mark;
          out.push(id);
        }
      }
    }
    return out;
  }
  // The real neighbourhood (or water, or bridge) name at a point, for the
  // HUD. No allocation: the edge scratch list is reused.
  const placeEdges = [];
  const landPlaceCell = cellLookup(landPlace), waterPlaceCell = cellLookup(waterPlace);
  function placeOf(x, z) {
    if (x > islet.x0 - 60 && x < islet.x1 + 60 && z > islet.z0 - 60 && z < islet.z1 + 60) return DISTRICTS.airfield.name;
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
  lap('extras');

  const span = Math.max(Math.abs(cut.x0), Math.abs(cut.x1), Math.abs(cut.z0), Math.abs(cut.z1));
  const inCore = (x, z) => x >= MIAMI_CORE.x0 && x <= MIAMI_CORE.x1 && z >= MIAMI_CORE.z0 && z <= MIAMI_CORE.z1;
  const city = {
    map: 'miami',
    seed, N: 1, xs: [0], zs: [0], wx: [STREET_W], wz: [STREET_W],
    nodes, edges, blocks, buildings,
    props, parkingSpots, spawn,
    furniture, signals, landmarks, streetNames,
    extraLand, piers, pois, surfaces, aircraftSpots, boatSpots, helipads,
    // The real places, then the invented landmarks not already listed.
    mapLandmarks: MIAMI_LANDMARKS.concat(landmarkSites.filter((t) => !MIAMI_LANDMARKS.some((m) => m.landmark === t.id)).map((t) => ({ name: t.name, src: '', x: t.x, z: t.z, landmark: t.id }))),
    tankSpots, roofPads, depot,
    airfield: { islet, runway, apron, gate },
    // Activities, secrets and stunt ramps: filled in below, from the spots.
    courses: [], secretSpots: [], secretGarage: null, rampSpots: [], courseSpec: S.courses || null, texts: S.texts || null,
    shoreDist, mainShore, isLand, isGround, districtOf, onRoad, placeOf, placeNames: placeNames.slice(1),
    nodeAt: () => null,
    blockAt, edgesNear, buildingsNear, landRuns, landTarget, inBuilding,
    // Drawn land (no road strips): 1 = land, sampled at cell centres.
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
  };

  // ---- 11b. Lots: every free land cell typed and dressed (world/lots.js). ----
  {
    lotIn.timings = timings;
    const L = buildLots(city, lotIn);
    city.lots = L.lots;
    city.lotGrid = L.lotGrid;
    city.lotAt = L.lotAt;
    city.lotTypeAt = L.lotTypeAt;
    // Car park bays: some of each car park's bays are parking spots (the
    // parked-car system spawns a real car in each one near the player, so
    // at most 3 per lot and never over 60 %), chosen by the lot seed; the
    // renderer parks static cars in part of the others.
    const F = [], bays = [];
    for (const lot of city.lots) {
      if (lot.type !== 'carpark') continue;
      dressLot(city, lot, F);
      bays.length = 0;
      for (const f of F) if (f.kind === 'bay') eachBay(f, (x, z, h) => bays.push(x, z, h));
      const n = bays.length / 3, keep = Math.min(BAY_LIST_MAX, Math.floor(n * 0.6));
      const r = createRng(lot.seed ^ 0x6a09e667);
      const order = Array.from({ length: n }, (_, k) => k);
      for (let k = n - 1; k > 0; k--) {
        const q = r.int(0, k);
        const t = order[k]; order[k] = order[q]; order[q] = t;
      }
      for (let k = 0; k < keep; k++) {
        const q = order[k] * 3;
        parkingSpots.push({ x: bays[q], z: bays[q + 1], heading: bays[q + 2], lot: true });
      }
    }
    lap('lots.build');
    for (const t of tankSpots) {
      if (t.place !== 'cinder') continue;
      dropSpotsNear(parkingSpots, t.x, t.z, 6, true);
    }
  }
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
  city.buildMs = Math.round((typeof performance !== 'undefined' ? performance.now() : Date.now()) - tStart);
  return city;
}

export { DISTRICTS };
