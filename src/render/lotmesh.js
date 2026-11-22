// Lots on the real map (docs/REVAMP.md 6.2): the ground of every lot in
// its own material (lawn, asphalt, paving slabs, rough grass, concrete
// and dirt, sand), clipped to city.lotGrid cell by cell, and the dressing
// that dressLot lists for a lot (fences, hedges, drives, car park bays
// with parked cars, trees, bins, plaza furniture, works yard stacks),
// merged into the tile's builders per material. Solid features get a
// collision shape while their tile is built.
//
// No three.js here beyond the mesh builders: the functions only fill
// MeshBuilder-like objects (`B.key.at(x, z)`), so node tests run them.
// Every consumer treats a city without lots (the island) as "no lots".
import { lotStamps } from './props.js';

// A flat quad through four corners (as citymesh's orientedQuad; kept
// here so the two modules do not import each other).
function orientedQuad(bld, ax, az, bx, bz, cx, cz, dx, dz, y, color) {
  bld.quad(ax, y, az, bx, y, bz, cx, y, cz, dx, y, dz, color, 0, 1, 0);
  if (bld.uv) {
    const k = 1 / bld.uvScale, u = bld.uv, o = u.length - 8;
    u[o] = ax * k; u[o + 1] = az * k; u[o + 2] = bx * k; u[o + 3] = bz * k;
    u[o + 4] = cx * k; u[o + 5] = cz * k; u[o + 6] = dx * k; u[o + 7] = dz * k;
  }
}

export const LOT_TYPES = ['yard', 'carpark', 'plaza', 'grass', 'works', 'beach', 'park', 'wateredge', 'site', 'verge', 'airfield'];

// Ground height of a lot: over the land (-0.06), under the roads (0).
export const LOT_Y = -0.035;

// Ground per lot type: builder key, base colour, tone spread, patchy
// (a second colour mixed in per 10 m cell: dirt in a works yard).
// verge and airfield keep the land they stand on.
export const LOT_GROUND = {
  yard: { key: 'grass', col: 0x86ac5c, spread: 0.1 },
  carpark: { key: 'asphalt', col: 0x5d6064, spread: 0.08 },
  plaza: { key: 'pavement', col: 0xcac3b5, spread: 0.06 },
  grass: { key: 'land', col: 0x93ad62, spread: 0.12 },
  works: { key: 'ground', col: 0xa29d92, spread: 0.08, patch: 0x8c7a62 },
  beach: { key: 'sand', col: 0xf0e0b4, spread: 0.04 },
  park: { key: 'grass', col: 0x7cb256, spread: 0.08 },
  wateredge: { key: 'pavement', col: 0xb0ada4, spread: 0.05 },
  site: { key: 'sand', col: 0x9e8460, spread: 0.08, patch: 0x7e6a50 },
};
// By type index + 1 (the lotGrid.type value), for the hot loops.
const GROUND_BY_T = [null, ...LOT_TYPES.map((t) => LOT_GROUND[t] || null)];

// True where lotGrid.type t gets its own ground (land under it can go).
export const DRAWN_T = Uint8Array.from({ length: 256 }, (_, t) => (GROUND_BY_T[t] ? 1 : 0));
// Far land colour by lotGrid.type (0: keep the land colour).
export const FAR_LOT_COL = Uint32Array.from({ length: 256 }, (_, t) => {
  const g = GROUND_BY_T[t];
  return g ? (g.patch ? mixHexEarly(g.col, g.patch, 0.3) : g.col) : 0;
});
function mixHexEarly(a, b, t) {
  const r = ((a >> 16) & 255) + (((b >> 16) & 255) - ((a >> 16) & 255)) * t;
  const g = ((a >> 8) & 255) + (((b >> 8) & 255) - ((a >> 8) & 255)) * t;
  const c = (a & 255) + ((b & 255) - (a & 255)) * t;
  return (Math.round(r) << 16) | (Math.round(g) << 8) | Math.round(c);
}

function shadeHex(hex, f) {
  const r = Math.min(255, ((hex >> 16) & 255) * f) | 0;
  const g = Math.min(255, ((hex >> 8) & 255) * f) | 0;
  const b = Math.min(255, (hex & 255) * f) | 0;
  return (r << 16) | (g << 8) | b;
}
function mixHex(a, b, t) {
  const r = ((a >> 16) & 255) + (((b >> 16) & 255) - ((a >> 16) & 255)) * t;
  const g = ((a >> 8) & 255) + (((b >> 8) & 255) - ((a >> 8) & 255)) * t;
  const c = (a & 255) + ((b & 255) - (a & 255)) * t;
  return (Math.round(r) << 16) | (Math.round(g) << 8) | Math.round(c);
}
function cellHash(i, j) {
  let h = Math.imul(i * 73856093 ^ j * 19349663, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  return ((h ^ (h >>> 13)) >>> 0) / 4294967296;
}
// Tone of one lot (from its seed, so every tile agrees).
function lotTone(lot, g) {
  return shadeHex(g.col, 1 - g.spread / 2 + g.spread * (((lot.seed >>> 8) & 255) / 255));
}

// The ground of every lot cell in the cell range i0..i1 x j0..j1 (end
// exclusive): rows of cells of one lot merge into one quad (at most
// RUN cells long, so a quad never spans far). Patchy types break the
// run every two cells and mix in their second colour by a cell hash.
const RUN = 24;
export function lotGround(city, B, i0, i1, j0, j1) {
  const G = city.lotGrid;
  if (!G || !city.lots) return 0;
  const { x0, z0, cell, w, id, type } = G;
  const lots = city.lots;
  let quads = 0;
  for (let j = j0; j < j1; j++) {
    const za = z0 + j * cell, zb = za + cell;
    let i = i0;
    while (i < i1) {
      const k = j * w + i;
      const t = type[k], g = GROUND_BY_T[t];
      if (!g) { i++; continue; }
      const lid = id[k];
      const max = g.patch ? 2 : RUN;
      let e = i + 1;
      while (e < i1 && e - i < max && id[j * w + e] === lid) e++;
      const lot = lots[lid];
      let col = lot ? lotTone(lot, g) : g.col;
      if (g.patch) col = mixHex(col, g.patch, Math.max(0, cellHash(i >> 1, j >> 1) * 1.6 - 0.6));
      const xa = x0 + i * cell, xb = x0 + e * cell;
      B[g.key].at((xa + xb) / 2, (za + zb) / 2).flat(xa, za, xb, zb, LOT_Y, col);
      quads++;
      i = e;
    }
  }
  return quads;
}

// ---- dressing ----

const CARS = [0xe8e8e6, 0x2a2c30, 0x8a9096, 0xb8bcc0, 0x7a1e22, 0x1e3a6a, 0x3c5a48, 0xc8b89a, 0x5a2a4a, 0xd0a030];
const HEDGE = 0x3f6e34, WALLS = [0xe6dccb, 0xd4d0c8, 0xf0e8da, 0xc4b8a4], CONTAINERS = [0xb4442c, 0x2c5a8a, 0x3a7a4a, 0xd89a2a, 0x8a8e92, 0x6a3a6a];
const TOWELS = [0xd8452c, 0x2c7fb8, 0xf0c030, 0x2fa88a, 0xf4f0e6, 0xe07aa0];

// Lots whose bays the parked-car system fills (city.parkingSpots entries
// with lot: true), so a drawn car never sits under a live one.
const listedCache = new WeakMap();
function listedBays(city) {
  let s = listedCache.get(city);
  if (s) return s;
  s = new Set();
  for (const p of city.parkingSpots || []) if (p.lot) s.add(Math.round(p.x * 2) * 65536 + Math.round(p.z * 2));
  listedCache.set(city, s);
  return s;
}

// One parked car, about 4.4 by 1.8 m, centred at (x, z), facing h.
function parkedCar(P, x, z, y, h, col) {
  P.obox(x, z, 2.2, 0.88, y + 0.18, y + 0.95, h, col, col, 0.55, 1);
  P.obox(x - Math.cos(h) * 0.25, z - Math.sin(h) * 0.25, 1.15, 0.78, y + 0.95, y + 1.42, h, 0x2a3036, shadeHex(col, 0.92), 0.8, 1);
  P.obox(x, z, 2.05, 0.92, y, y + 0.2, h, 0x141516, 0x141516);
}

// A run of see-through panels (picket or mesh picture) along a line.
function panels(D, r, ax, az, bx, bz, y, hgt, color) {
  const dx = bx - ax, dz = bz - az;
  const L = Math.hypot(dx, dz);
  if (!(L > 0.2)) return;
  const per = hgt * 2;
  const n = Math.max(1, Math.round(L / per));
  for (let i = 0; i < n; i++) {
    const t0 = i / n, t1 = (i + 1) / n;
    D.wall(ax + dx * t0, az + dz * t0, ax + dx * t1, az + dz * t1, y, y + hgt, color, r.u0, r.v0, r.u1, r.v1);
  }
}

// Draws the features of one lot into the builders of C (props, detail,
// paint, pavement, ao, glow, trees, treesDetail) and returns how many it
// drew. stamps: lotStamps(C), made once per tile.
export function drawLotFeatures(C, lot, feats, n, stamps, from = 0) {
  const city = C.city;
  const y = LOT_Y;
  const R = C.R || {};
  const listed = listedBays(city);
  let drawn = 0;
  for (let q = from; q < n; q++) {
    const f = feats[q];
    const x = f.x, z = f.z, h = f.heading || 0;
    const ca = Math.cos(h), sa = Math.sin(h);
    const hl = (f.l || 0) / 2, hw = (f.w || 0) / 2;
    const P = C.props.at(x, z), S = C.solid.at(x, z);
    switch (f.kind) {
      case 'fence': {
        const r = lot.type === 'works' || lot.type === 'site' || f.v % 3 === 2 ? R.mesh : R.fence;
        const hgt = f.h || (r === R.mesh ? 2 : 1.1);
        if (r) panels(C.detail.at(x, z), r, x - ca * hl, z - sa * hl, x + ca * hl, z + sa * hl, y, hgt, r === R.mesh ? 0xc8ccd0 : [0xffffff, 0xe8e0d0, 0xb89a72][f.v % 3]);
        // Posts at the ends.
        S.obox(x - ca * hl, z - sa * hl, 0.06, 0.06, y, y + hgt + 0.05, h, 0x6a6e72);
        S.obox(x + ca * hl, z + sa * hl, 0.06, 0.06, y, y + hgt + 0.05, h, 0x6a6e72);
        break;
      }
      case 'hedge': {
        const hgt = f.h || 1.3;
        const col = shadeHex(HEDGE, 0.9 + (f.v % 4) * 0.06);
        S.obox(x, z, hl, Math.max(0.3, hw), y, y + hgt, h, col, shadeHex(col, 1.12), 0.6, 1.05);
        C.ao.at(x, z).aoSkirt(x - Math.abs(ca * hl) - Math.abs(sa * hw), z - Math.abs(sa * hl) - Math.abs(ca * hw), x + Math.abs(ca * hl) + Math.abs(sa * hw), z + Math.abs(sa * hl) + Math.abs(ca * hw), 0.6, y + 0.012, 0.7);
        break;
      }
      case 'wall': {
        const hgt = f.h || 1.6, col = WALLS[f.v % WALLS.length];
        S.obox(x, z, hl, Math.max(0.12, hw), y, y + hgt, h, col, col, 0.62, 1);
        S.obox(x, z, hl + 0.04, Math.max(0.12, hw) + 0.05, y + hgt, y + hgt + 0.1, h, shadeHex(col, 1.06), 0xf4f2ec);
        break;
      }
      case 'gate': {
        const hgt = f.h || 1.6;
        for (const s of [-1, 1]) S.obox(x + ca * hl * s, z + sa * hl * s, 0.14, 0.14, y, y + hgt + 0.2, h, 0x8a8e92, 0xa0a4a8);
        if (R.mesh) panels(C.detail.at(x, z), R.mesh, x - ca * hl * 0.5, z - sa * hl * 0.5, x + ca * hl * 0.5, z + sa * hl * 0.5, y, hgt, 0x9aa0a6);
        break;
      }
      case 'drive':
      case 'path': {
        const pv = C.pavement.at(x, z);
        const col = f.kind === 'drive' ? (f.v % 2 ? 0xb4aea2 : 0x9a9690) : lot.type === 'beach' ? 0xc8b48a : 0xd6cdb8;
        orientedQuad(pv, x - ca * hl - sa * hw, z - sa * hl + ca * hw, x + ca * hl - sa * hw, z + sa * hl + ca * hw,
          x + ca * hl + sa * hw, z + sa * hl - ca * hw, x - ca * hl + sa * hw, z - sa * hl - ca * hw, y + 0.012, col);
        break;
      }
      case 'bay': {
        // One bay (2.5 by 5 m: l across the row, w the depth) or a row of
        // them when l is longer: side lines, and parked cars in about
        // half of the bays the parked-car system does not fill.
        const lb = C.paint.at(x, z);
        const bw = 2.5, nb = Math.max(1, Math.round((f.l || bw) / bw)), depth = f.w || 5;
        const half = (nb * bw) / 2, dh = depth / 2;
        // The car faces along the depth: perpendicular to the row.
        const cx = -sa, cz = ca;
        for (let s = 0; s <= nb; s++) {
          const o = -half + s * bw;
          const px = x + ca * o, pz = z + sa * o;
          orientedQuad(lb, px - ca * 0.06 - cx * dh, pz - sa * 0.06 - cz * dh, px + ca * 0.06 - cx * dh, pz + sa * 0.06 - cz * dh,
            px + ca * 0.06 + cx * dh, pz + sa * 0.06 + cz * dh, px - ca * 0.06 + cx * dh, pz - sa * 0.06 + cz * dh, y + 0.02, 0xeeeee6);
        }
        for (let s = 0; s < nb; s++) {
          const o = -half + (s + 0.5) * bw;
          const bx = x + ca * o, bz = z + sa * o;
          const key = Math.round(bx * 2) * 65536 + Math.round(bz * 2);
          const u = cellHash(Math.round(bx * 3), Math.round(bz * 3) + f.v);
          if (listed.has(key) || u > 0.55) continue;
          const ch = h + Math.PI / 2 + (u < 0.2 ? Math.PI : 0) + (u - 0.27) * 0.08;
          parkedCar(C.solid.at(bx, bz), bx, bz, y, ch, CARS[(u * 97 | 0) % CARS.length]);
          C.ao.at(bx, bz).aoDisc(bx, bz, 2.4, y + 0.012, 0.6, 8);
          if (C.collision && C.solids) C.solids.push(C.collision.addCircle(bx - cx * 1.2, bz - cz * 1.2, 1.0, 1.4, 'car'), C.collision.addCircle(bx + cx * 1.2, bz + cz * 1.2, 1.0, 1.4, 'car'));
        }
        break;
      }
      case 'tree':
        // v: TREE_VARIANTS (lots.js): royalpalm, coconut, then broadleaf
        // kinds; the model variant comes from the position.
        if (f.v === 0 || f.v === 1) stamps.palm(x, z, y, f.h || 8, cellHash(Math.round(x * 4), Math.round(z * 4)));
        else stamps.tree(x, z, y, f.h || 6, cellHash(Math.round(x * 4) + f.v, Math.round(z * 4)));
        break;
      case 'shrub': {
        const r = f.r || f.w / 2 || 0.7, hgt = f.h || 1.1;
        C.solid.at(x, z).blob(x, y + hgt * 0.45, z, r, hgt * 0.55, r, shadeHex(0x4a7e3a, 0.85 + (f.v % 5) * 0.06), 6, 3, 0.55, 1.1);
        break;
      }
      case 'bin': stamps.bin(x, z, y, h, (f.v % 8) / 8); break;
      case 'bench': stamps.bench(x, z, y, h); break;
      case 'planter': stamps.planter(x, z, y, h, (f.v % 8) / 8); break;
      case 'lamp': stamps.lamp(x, z, y, h, f.h || 6); break;
      case 'bollard': stamps.bollard(x, z, y); break;
      case 'umbrella': stamps.umbrella(x, z, y, (f.v % 6) / 6); break;
      case 'stack': {
        // Shipping containers, 2.6 m a tier.
        const tiers = Math.max(1, Math.round((f.h || 2.6) / 2.6));
        for (let t = 0; t < tiers; t++) {
          const col = CONTAINERS[(f.v + t * 3) % CONTAINERS.length];
          C.solid.at(x, z).obox(x, z, hl || 3, hw || 1.22, y + t * 2.6, y + (t + 1) * 2.6 - 0.04, h, col, shadeHex(col, 1.1), t ? 0.85 : 0.6, 1);
        }
        C.ao.at(x, z).aoDisc(x, z, Math.max(hl, hw) + 1.5, y + 0.012, 0.6, 8);
        break;
      }
      case 'pallet':
        P.obox(x, z, hl || 0.6, hw || 0.5, y, y + (f.h || 0.5), h, 0xa8875a, 0xc8a878, 0.7, 1);
        break;
      case 'cabin': {
        const hgt = f.h || 2.6, col = f.v % 2 ? 0xe8e6e0 : 0x3a6a9a;
        C.solid.at(x, z).obox(x, z, hl || 3, hw || 1.25, y, y + hgt, h, col, 0x8a8e92, 0.6, 1);
        P.obox(x + ca * (hl || 3) * 0.4, z + sa * (hl || 3) * 0.4, 0.5, (hw || 1.25) + 0.02, y + 1, y + 1.9, h, 0x3a4650);
        break;
      }
      case 'boat': {
        // Hull on stands, a cabin on top.
        const L = hl || 4, W = hw || 1.3, col = f.v % 2 ? 0xf2f2ee : 0x2a5a8a;
        const sol = C.solid.at(x, z);
        for (const s of [-0.6, 0.6]) sol.obox(x + ca * L * s, z + sa * L * s, 0.15, W * 0.8, y, y + 0.9, h, 0x55585c);
        sol.obox(x, z, L, W, y + 0.9, y + 2.1, h, col, 0xd8d4c8, 0.7, 1);
        sol.obox(x + ca * L * 0.65, z + sa * L * 0.65, L * 0.35, W * 0.55, y + 0.9, y + 1.9, h, col);
        sol.obox(x - ca * L * 0.15, z - sa * L * 0.15, L * 0.35, W * 0.7, y + 2.1, y + 2.9, h, 0xe8e8e4, 0x9aa4ac);
        break;
      }
      case 'sign': {
        P.obox(x, z, 0.05, 0.05, y, y + 2.2, h, 0x6a7076);
        P.obox(x, z, 0.04, 0.6, y + 1.5, y + 2.3, h, f.v % 2 ? 0x1f55a8 : 0xf2f0e6, 0xd8d8d0);
        break;
      }
      case 'towel': {
        const col = TOWELS[f.v % TOWELS.length];
        P.obox(x, z, hl || 0.9, hw || 0.45, y, y + 0.03, h, col, col);
        break;
      }
      case 'rock': {
        const r = f.r || 0.9;
        C.solid.at(x, z).blob(x, y + r * 0.3, z, r, r * 0.6, r * 0.85, shadeHex(0x8a8680, 0.85 + (f.v % 5) * 0.06), 6, 3, 0.6, 1.05);
        break;
      }
      case 'pile': {
        const r = f.r || Math.max(hl, hw) || 3;
        C.solid.at(x, z).blob(x, y, z, r, f.h || 2, r * 0.85, f.v % 2 ? 0x8a7458 : 0x9a968e, 7, 3, 0.65, 1.05);
        break;
      }
      default:
        continue;
    }
    drawn++;
  }
  return drawn;
}

// Collision shapes for the solid features of one lot (pushed to `list`
// so the tile can switch them off when it goes): a circle for round
// ones (r), a box for boxes along the world axes, else a row of circles.
export function addLotSolids(collision, feats, n, list) {
  for (let q = 0; q < n; q++) {
    const f = feats[q];
    if (!f.solid) continue;
    const hgt = f.h || 1.5;
    if (f.r > 0) {
      list.push(collision.addCircle(f.x, f.z, f.r, hgt, 'lot'));
      continue;
    }
    const h = f.heading || 0, c = Math.cos(h), s = Math.sin(h);
    const hl = (f.l || 0) / 2, hw = Math.max(0.15, (f.w || 0) / 2);
    if (Math.abs(s) < 0.02 || Math.abs(c) < 0.02) {
      const ex = Math.abs(c) * hl + Math.abs(s) * hw, ez = Math.abs(s) * hl + Math.abs(c) * hw;
      list.push(collision.addBox(f.x - ex, f.z - ez, f.x + ex, f.z + ez, hgt, 'lot'));
    } else {
      const k = Math.max(1, Math.ceil(hl / hw));
      for (let i = 0; i <= k; i++) {
        const o = -hl + (2 * hl * i) / k;
        list.push(collision.addCircle(f.x + c * o, f.z + s * o, hw, hgt, 'lot'));
      }
    }
  }
}

// Switches a tile's lot shapes off (the collision world has no removal:
// a shape lower than anything tested is skipped) or back on.
export function setSolids(list, on) {
  for (const it of list) {
    if (on) { if (it.rwH !== undefined) it.h = it.rwH; }
    else { if (it.rwH === undefined) it.rwH = it.h; it.h = -1e9; }
  }
}

// Lots by the tile that owns them (the tile of the lot rect's centre).
export function lotsByTile(city, tileOf, nTiles) {
  const out = [];
  for (let k = 0; k < nTiles; k++) out.push([]);
  for (const lot of city.lots || []) {
    if (!lot || lot.type === 'verge' || lot.type === 'airfield') continue;
    out[tileOf((lot.x0 + lot.x1) / 2, (lot.z0 + lot.z1) / 2)].push(lot);
  }
  return out;
}

// Everything for one tile's lots, a slice at a time: a generator that
// yields when `over()` says the slice is used up. C holds the tile's
// builders (props, solid, detail, paint, pavement, ao, glow, trees,
// treesDetail), `solids` gets the collision shapes.
export function* lotJob(C, lots, dress, over) {
  if (!lots.length || !dress) return;
  const stamps = lotStamps(C);
  const feats = [];
  const stats = C.lotStats || null;
  for (const lot of lots) {
    feats.length = 0;
    dress(C.city, lot, feats);
    const n = feats.length;
    // A few features at a time (a lot can hold 24 trees).
    for (let q = 0; q < n; q += 4) {
      drawLotFeatures(C, lot, feats, Math.min(n, q + 4), stamps, q);
      if (over()) yield 'lots';
    }
    if (C.collision && C.solids) addLotSolids(C.collision, feats, n, C.solids);
    if (stats) { stats.lots++; stats.features += n; }
    if (over()) yield 'lots';
  }
}
