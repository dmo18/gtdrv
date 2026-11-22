// Lots fixture for the world renderer (W2), following docs/REVAMP.md 6.2
// field by field (built before W1's src/world/lots.js landed):
// makeLotsFixture() is a small made-up city (200 by 150 m, one road)
// with 12 lots, at least one of every type, and fixtureDressLot(city,
// lot, out) a stand-in dressLot with the minimum content per type and
// the caps (24 features, 12 solid). Pure: no three.js, no DOM.
import { createRng } from '../../src/core/rng.js';

export const LOT_TYPES = ['yard', 'carpark', 'plaza', 'grass', 'works', 'beach', 'park', 'wateredge', 'site', 'verge', 'airfield'];
export const FEATURE_KINDS = ['fence', 'hedge', 'wall', 'gate', 'drive', 'bay', 'tree', 'shrub', 'bin',
  'bench', 'planter', 'lamp', 'bollard', 'umbrella', 'stack', 'pallet', 'cabin', 'boat',
  'path', 'sign', 'towel', 'rock', 'pile'];
const CELL = 5;

export function hash32(...xs) {
  let h = 0x811c9dc5;
  for (const x of xs) {
    h = Math.imul(h ^ (x | 0), 0x01000193);
    h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  }
  return (h ^ (h >>> 16)) >>> 0;
}

function attach(city, lots, grid) {
  city.lots = lots;
  city.lotGrid = grid;
  const at = (x, z) => {
    const i = Math.floor((x - grid.x0) / grid.cell), j = Math.floor((z - grid.z0) / grid.cell);
    if (i < 0 || j < 0 || i >= grid.w || j >= grid.h) return -1;
    return grid.id[j * grid.w + i];
  };
  city.lotAt = (x, z) => { const k = at(x, z); return k >= 0 ? lots[k] : null; };
  city.lotTypeAt = (x, z) => { const k = at(x, z); return k >= 0 ? lots[k].type : ''; };
  city.dressLot = (lot, out) => fixtureDressLot(city, lot, out);
  return city;
}

function makeLot(city, id, type, x0, z0, x1, z1, area, building = -1, front = 1) {
  const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
  const ti = LOT_TYPES.indexOf(type);
  return {
    id, type, x0, z0, x1, z1, area,
    district: city.districtOf ? city.districtOf(cx, cz) : 'downtown',
    place: city.placeOf ? city.placeOf(cx, cz) || '' : '',
    seed: hash32(city.seed | 0, Math.round(cx / 5), Math.round(cz / 5), ti),
    dress: type + '-a', building, edge: -1, front, core: true,
  };
}

// ---- the small fixture: 12 lots, every type ----
export function makeLotsFixture() {
  const W = 40, H = 30; // cells: 200 by 150 m
  const grid = { x0: 0, z0: 0, cell: CELL, w: W, h: H, id: new Int32Array(W * H).fill(-1), type: new Uint8Array(W * H) };
  // Land everywhere (the land raster shares the lot grid's cells).
  const landGrid = { x0: 0, z0: 0, cell: CELL, w: W, h: H, data: new Uint8Array(W * H).fill(1) };
  const city = {
    map: 'fixture', seed: 7, lots: null, lotGrid: null, parkingSpots: [], landGrid,
    buildings: [{ x0: 12, z0: 12, x1: 22, z1: 22, h: 6, style: 'house' }],
    districtOf: () => 'residential', placeOf: () => 'Fixture',
    mainShore: (x, z) => 150 - z, // water to the south, past z 150
  };
  // Road along z 70..80 (cells 14 and 15 stay -1).
  const rects = [
    ['yard', 0, 0, 8, 6, 0], ['carpark', 8, 0, 18, 8], ['plaza', 18, 0, 26, 6], ['grass', 26, 0, 40, 10],
    ['works', 0, 16, 10, 24], ['site', 10, 16, 18, 24], ['park', 18, 16, 32, 26], ['verge', 32, 16, 34, 18],
    ['beach', 0, 26, 12, 30], ['wateredge', 12, 26, 18, 30], ['airfield', 34, 16, 40, 22], ['yard', 32, 22, 40, 30],
  ];
  const lots = [];
  rects.forEach(([type, i0, j0, i1, j1, b], id) => {
    for (let j = j0; j < j1; j++) for (let i = i0; i < i1; i++) {
      grid.id[j * W + i] = id;
      grid.type[j * W + i] = LOT_TYPES.indexOf(type) + 1;
    }
    lots.push(makeLot(city, id, type, i0 * CELL, j0 * CELL, i1 * CELL, j1 * CELL, (i1 - i0) * (j1 - j0) * 25, b ?? -1, j1 <= 14 ? 1 : 3));
  });
  // A building cell inside the first yard.
  for (let j = 2; j < 4; j++) for (let i = 2; i < 4; i++) { grid.id[j * W + i] = -1; grid.type[j * W + i] = 0; }
  return attach(city, lots, grid);
}

// ---- stand-in dressLot ----
const MAX_FEATURES = 24, MAX_SOLID = 12;

export function fixtureDressLot(city, lot, out = []) {
  const G = city.lotGrid;
  const rng = createRng(lot.seed);
  const mine = (x, z) => {
    const i = Math.floor((x - G.x0) / G.cell), j = Math.floor((z - G.z0) / G.cell);
    return i >= 0 && j >= 0 && i < G.w && j < G.h && G.id[j * G.w + i] === lot.id;
  };
  let solid = 0;
  const add = (kind, x, z, heading, l, w, h, r, isSolid) => {
    if (out.length >= MAX_FEATURES || !mine(x, z)) return false;
    if (isSolid && solid >= MAX_SOLID) isSolid = false;
    if (isSolid) solid++;
    out.push({ kind, x, z, heading, l, w, h, r, solid: !!isSolid, v: rng.int(0, 255) });
    return true;
  };
  const { x0, z0, x1, z1 } = lot;
  const W = x1 - x0, D = z1 - z0;
  const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
  // The four sides: centre, heading along, length. 0 +x, 1 +z, 2 -x, 3 -z.
  const side = (s, inset = 0.4) => s === 0 ? [x1 - inset, cz, Math.PI / 2, D] : s === 1 ? [cx, z1 - inset, 0, W] : s === 2 ? [x0 + inset, cz, Math.PI / 2, D] : [cx, z0 + inset, 0, W];
  // The road side: the side whose outside is not lot or building land.
  let front = lot.front ?? 1;
  if (city.onRoad) {
    let best = -1;
    for (let s = 0; s < 4; s++) {
      const [sx, sz, hh, len] = side(s, -7);
      let k = 0;
      for (let t = -0.4; t <= 0.4; t += 0.2) if (city.onRoad(sx + Math.cos(hh) * len * t, sz + Math.sin(hh) * len * t)) k++;
      if (k > best) { best = k; front = s; }
    }
  }
  const randomIn = (fn, tries = 6) => {
    for (let t = 0; t < tries; t++) {
      const x = x0 + 1.5 + rng.next() * (W - 3), z = z0 + 1.5 + rng.next() * (D - 3);
      if (mine(x, z) && fn(x, z)) return true;
    }
    return false;
  };
  const boundary = (kind, sides, h, gate = -1) => {
    for (const s of sides) {
      const [sx, sz, hh, len] = side(s);
      if (s === gate && len > 8) {
        const a = (len - 4) / 2;
        const ox = Math.cos(hh), oz = Math.sin(hh);
        add(kind, sx - ox * (a / 2 + 2), sz - oz * (a / 2 + 2), hh, a, 0.3, h, 0, kind !== 'fence');
        add(kind, sx + ox * (a / 2 + 2), sz + oz * (a / 2 + 2), hh, a, 0.3, h, 0, kind !== 'fence');
        add('gate', sx, sz, hh, 4, 0.3, h, 0, false);
      } else add(kind, sx, sz, hh, len - 0.8, kind === 'hedge' ? 0.8 : 0.3, h, 0, kind !== 'fence');
    }
  };
  const trees = (per, max, kind = 'tree') => {
    const n = Math.min(max, Math.max(1, Math.round(lot.area / per)));
    for (let i = 0; i < n; i++) randomIn((x, z) => add(kind, x, z, rng.next() * 6.28, 0, 0, kind === 'tree' ? 5 + rng.next() * 4 : 1.2, kind === 'tree' ? 0.35 : 0.7, kind === 'tree'));
  };
  const others = [0, 1, 2, 3].filter((s) => s !== front);
  switch (lot.type) {
    case 'yard': {
      boundary(rng.chance(0.5) ? 'hedge' : rng.chance(0.5) ? 'fence' : 'wall', others, 1.2);
      const b = lot.building >= 0 ? city.buildings[lot.building] : null;
      const [fx, fz] = side(front, 0);
      const tx = b ? (b.x0 + b.x1) / 2 : cx, tz = b ? (b.z0 + b.z1) / 2 : cz;
      const dl = Math.max(3, Math.hypot(tx - fx, tz - fz) * 0.6);
      const hh = Math.atan2(tz - fz, tx - fx);
      add('drive', fx + Math.cos(hh) * dl / 2, fz + Math.sin(hh) * dl / 2, hh, dl, 3, 0, 0, false);
      trees(120, 2);
      trees(150, 2, 'shrub');
      if (rng.next() < 0.34) randomIn((x, z) => add('bin', x, z, 0, 0, 0, 1, 0, false));
      break;
    }
    case 'carpark': {
      // Rows of bays along x with 6 m aisles: 5 bay, 6 aisle, 5 bay, ...
      const [fx, fz, fh, fl] = side(front);
      const gx = Math.cos(fh), gz = Math.sin(fh);
      add('wall', fx - gx * (fl / 4 + 1.5), fz - gz * (fl / 4 + 1.5), fh, fl / 2 - 3, 0.3, 0.9, 0, true);
      add('hedge', fx + gx * (fl / 4 + 1.5), fz + gz * (fl / 4 + 1.5), fh, fl / 2 - 3, 0.8, 1, 0, true);
      const alongX = W >= D;
      const rowLen = (alongX ? W : D) - 3;
      for (let o = 1.5 + 2.5; o + 2.5 < (alongX ? D : W) - 1; o += 8) {
        const n = Math.floor(rowLen / 2.5);
        if (n < 2) break;
        const px = alongX ? cx : x0 + o, pz = alongX ? z0 + o : cz;
        // Trim the row to the lot's cells.
        let m = n;
        while (m >= 2) {
          const hx = alongX ? (m * 2.5) / 2 : 0, hz = alongX ? 0 : (m * 2.5) / 2;
          if (mine(px - hx + 0.3, pz - hz + 0.3) && mine(px + hx - 0.3, pz + hz - 0.3)) break;
          m--;
        }
        if (m >= 2) add('bay', px, pz, alongX ? 0 : Math.PI / 2, m * 2.5, 5, 0, 0, false);
        o += 5;
      }
      const lamps = Math.max(1, Math.round(lot.area / 400));
      for (let i = 0; i < Math.min(lamps, 4); i++) randomIn((x, z) => add('lamp', x, z, rng.next() * 6.28, 0, 0, 6, 0.2, true));
      trees(300, 3, rng.chance(0.5) ? 'tree' : 'planter');
      break;
    }
    case 'plaza': {
      const [fx, fz, fh, fl] = side(front, 1.2);
      const gx = Math.cos(fh), gz = Math.sin(fh);
      for (let t = -fl / 2 + 2; t < fl / 2 - 1; t += 3) add('bollard', fx + gx * t, fz + gz * t, 0, 0, 0, 0.9, 0.15, false);
      trees(150, 4);
      for (let i = 0; i < 3; i++) randomIn((x, z) => add('planter', x, z, 0, 1.2, 1.2, 0.8, 0.7, true));
      for (let i = 0; i < 3; i++) randomIn((x, z) => add('bench', x, z, fh + Math.PI / 2, 1.6, 0.5, 0.9, 0, false));
      if (lot.district === 'downtown') for (let i = 0; i < 2; i++) randomIn((x, z) => add('umbrella', x, z, 0, 0, 0, 2.3, 0, false));
      break;
    }
    case 'grass': {
      trees(250, 6, rng.chance(0.7) ? 'tree' : 'shrub');
      if (lot.area > 1500) add('path', cx, cz, W > D ? 0 : Math.PI / 2, Math.max(W, D) - 2, 2, 0, 0, false);
      break;
    }
    case 'works': {
      boundary('fence', [0, 1, 2, 3], 2, front);
      const n = Math.max(1, Math.round((lot.area * 0.2) / 18));
      for (let i = 0; i < Math.min(n, 8); i++) {
        const k = rng.next();
        randomIn((x, z) => k < 0.5 ? add('stack', x, z, W > D ? 0 : Math.PI / 2, 6, 2.44, 2.6 * (1 + rng.int(0, 2)), 0, true)
          : k < 0.8 ? add('pallet', x, z, 0, 1.2, 1, 0.6, 0, false) : add('cabin', x, z, 0, 6, 2.5, 2.6, 0, true));
      }
      if (city.mainShore && city.mainShore(cx, cz) < 60) randomIn((x, z) => add('boat', x, z, rng.next() * 3, 8, 2.6, 2.9, 0, true));
      break;
    }
    case 'beach': {
      for (let i = 0; i < 4; i++) {
        randomIn((x, z) => {
          if (!add('umbrella', x, z, 0, 0, 0, 2.3, 0, false)) return false;
          add('towel', x + 1.2, z + 0.4, rng.next() * 6.28, 1.8, 0.9, 0, 0, false);
          return true;
        });
      }
      trees(200, 4);
      break;
    }
    case 'park': {
      trees(120, 10);
      add('path', cx, cz, W > D ? 0 : Math.PI / 2, Math.max(W, D) - 2, 2.4, 0, 0, false);
      add('bench', cx + (W > D ? 4 : 2), cz + (W > D ? 2 : 4), 0, 1.6, 0.5, 0.9, 0, false);
      add('lamp', cx - 3, cz + (W > D ? 2 : 0), 0, 0, 0, 5, 0.2, true);
      break;
    }
    case 'wateredge': {
      // Seawall cap along the water side, bollards or a rail, benches.
      let ws = 0, wd = 1e9;
      for (let s = 0; s < 4; s++) {
        const [sx, sz] = side(s, -3);
        const d = city.mainShore ? city.mainShore(sx, sz) : 0;
        if (d < wd) { wd = d; ws = s; }
      }
      const [sx, sz, hh, len] = side(ws, 0.5);
      add('wall', sx, sz, hh, len - 0.5, 0.6, 0.45, 0, true);
      const gx = Math.cos(hh), gz = Math.sin(hh);
      const [ix, iz] = side(ws, 1.6);
      for (let t = -len / 2 + 2; t < len / 2 - 1; t += 6) add('bollard', ix + gx * t, iz + gz * t, 0, 0, 0, 0.9, 0.15, false);
      for (let t = -len / 2 + 10; t < len / 2; t += 40) add('bench', ix + gx * t - Math.sin(hh) * 1.2, iz + gz * t, hh + Math.PI / 2, 1.6, 0.5, 0.9, 0, false);
      if (rng.chance(0.4)) randomIn((x, z) => add('rock', x, z, 0, 0, 0, 0.8, 0.9, true));
      break;
    }
    case 'site': {
      boundary('fence', [0, 1, 2, 3], 2, front);
      randomIn((x, z) => add('pile', x, z, 0, 0, 0, 2, 3, true));
      randomIn((x, z) => add('cabin', x, z, 0, 6, 2.5, 2.6, 0, true));
      randomIn((x, z) => add('stack', x, z, 0, 6, 2.44, 2.6, 0, true));
      randomIn((x, z) => add('sign', x, z, 0, 0, 0, 2.3, 0, false));
      break;
    }
    default:
  }
  return out;
}
