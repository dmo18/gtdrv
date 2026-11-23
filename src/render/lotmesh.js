// Lots on the real map (docs/REVAMP.md 6.2): the ground of every lot in
// its own material (lawn, asphalt, paving slabs, rough grass, concrete
// and dirt, sand), clipped to city.lotGrid cell by cell, and the dressing
// that dressLot lists for a lot (fences, hedges, drives, parking lot bays
// with parked cars, trees, bins, plaza furniture, works yard stacks),
// merged into the tile's builders per material. Their collision shapes
// are not made here: the simulation makes them itself, cell by cell (the
// lazy lot layer, attachLotCollision in world/collision.js), whatever is
// drawn.
//
// No three.js here beyond the mesh builders: the functions only fill
// MeshBuilder-like objects (`B.key.at(x, z)`), so node tests run them.
// Every consumer treats a city without lots (the island) as "no lots".
import { lotStamps } from './props.js';
import { bayCar } from '../world/collision.js';
import { lotDressCache, lotFill, dressLot } from '../world/lots.js';
import { VEHICLE_SPECS } from '../entities/vehicle.js';
import { PROP_SOLIDS } from '../world/propsolid.js';
const BREAKS = new Set(Object.keys(PROP_SOLIDS).filter((k) => PROP_SOLIDS[k].mode === 'break'));

// A flat quad through four corners (as citymesh's orientedQuad; kept
// here so the two modules do not import each other).
function orientedQuad(bld, ax, az, bx, bz, cx, cz, dx, dz, y, color) {
  bld.quad(ax, y, az, bx, y, bz, cx, y, cz, dx, y, dz, color, 0, 1, 0);
  const k = 1 / bld.uvScale;
  bld.lastQuadUv(ax * k, az * k, bx * k, bz * k, cx * k, cz * k, dx * k, dz * k);
}

export const LOT_TYPES = ['yard', 'carpark', 'plaza', 'grass', 'works', 'beach', 'park', 'wateredge', 'site', 'verge', 'airfield'];

// Ground height of a lot: over the land (-0.06), under the roads (0).
export const LOT_Y = -0.035;

// Ground per lot type: builder key, base color, tone spread, patchy
// (a second color mixed in per 10 m cell: dirt in a works yard).
// verge and airfield keep the land they stand on.
export const LOT_GROUND = {
  yard: { key: 'grass', col: 0x84a85c, spread: 0.18 },
  carpark: { key: 'asphalt', col: 0x5d6064, spread: 0.08 },
  plaza: { key: 'sidewalk', col: 0xcac3b5, spread: 0.06 },
  grass: { key: 'land', col: 0x93ad62, spread: 0.12 },
  works: { key: 'ground', col: 0xa29d92, spread: 0.08, patch: 0x8c7a62 },
  beach: { key: 'sand', col: 0xf0e0b4, spread: 0.04 },
  park: { key: 'grass', col: 0x7aa856, spread: 0.12 },
  wateredge: { key: 'sidewalk', col: 0xb0ada4, spread: 0.05 },
  site: { key: 'sand', col: 0x9e8460, spread: 0.08, patch: 0x7e6a50 },
};
// By type index + 1 (the lotGrid.type value), for the hot loops.
const GROUND_BY_T = [null, ...LOT_TYPES.map((t) => LOT_GROUND[t] || null)];

// True where lotGrid.type t gets its own ground (land under it can go).
export const DRAWN_T = Uint8Array.from({ length: 256 }, (_, t) => (GROUND_BY_T[t] ? 1 : 0));
// Far land color by lotGrid.type (0: keep the land color).
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
// run every two cells and mix in their second color by a cell hash.
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
      const bld = B[g.key].at((xa + xb) / 2, (za + zb) / 2);
      if (g.key === 'sidewalk' && lot) {
        // Paving of its own per plaza: stone tone, slab size and lay.
        const pv = PAVING[(lot.seed >>> 4) % PAVING.length];
        col = shadeHex(PAVE_TONES[(lot.seed >>> 12) % PAVE_TONES.length], 1 - g.spread / 2 + g.spread * (((lot.seed >>> 8) & 255) / 255));
        if (lot.type === 'wateredge') col = mixHex(col, g.col, 0.5);
        bld.flat(xa, za, xb, zb, LOT_Y, col);
        pavedUv(bld, xa, za, xb, zb, pv);
      } else {
        bld.flat(xa, za, xb, zb, LOT_Y, col);
      }
      quads++;
      i = e;
    }
  }
  return quads;
}

// Plaza paving (by lot seed): slab picture scale (1: the 1.2 m slabs of
// the sidewalk texture) and turn (a diagonal lay), and stone tones.
const PAVING = [
  { s: 1, c: 1, n: 0 }, { s: 0.5, c: 1, n: 0 }, { s: 0.5, c: 0.7071, n: 0.7071 }, { s: 1.5, c: 1, n: 0 },
  { s: 0.75, c: 0.7071, n: 0.7071 }, { s: 0.35, c: 1, n: 0 },
];
const PAVE_TONES = [0xcac3b5, 0xd8c3a8, 0xbebcb6, 0xddd3bc, 0xcdb79c, 0xc4c8c6, 0xe0d6c6];
// Texture coordinates of the last flat quad (x0, z1), (x1, z1), (x1, z0),
// (x0, z0) for the paving pv: turned and scaled in world space, so
// neighboring quads of one lot still line up.
function pavedUv(bld, x0, z0, x1, z1, pv) {
  if (!bld.lastQuadUv || !bld.uvScale) return;
  const k = 1 / (bld.uvScale * pv.s), c = pv.c * k, n = pv.n * k;
  bld.lastQuadUv(x0 * c - z1 * n, x0 * n + z1 * c, x1 * c - z1 * n, x1 * n + z1 * c, x1 * c - z0 * n, x1 * n + z0 * c, x0 * c - z0 * n, x0 * n + z0 * c);
}

// Edges of the lot ground (docs/PLAN_V1.md W2b), over the same cell range
// as lotGround: a concrete edging strip and a band of darker, rougher
// grass inside every lawn (yard, park) where it meets anything that is not
// lawn, a border course of darker stone round every plaza and, on most
// plazas, courses of it across the paving in 15 m squares. Runs of
// cells along one side merge into one strip. Returns the strips drawn.
const EDGE_Y = LOT_Y + 0.008, CURB = 0.25, VERGE = 0.6, BORDER = 0.55, INLAY = 0.45;
const CURB_COL = 0xd4d0c6, VERGE_COL = 0x6f7a3e;
export function lotEdges(city, B, i0, i1, j0, j1) {
  const G = city.lotGrid;
  if (!G || !city.lots) return 0;
  const { x0, z0, cell, w, h, id, type } = G;
  const lots = city.lots;
  let strips = 0;
  // Which edge cell k shows toward neighbor cell n (-1 off the grid):
  // 1 lawn edge, 2 plaza border, 0 none.
  const edgeOf = (k, n) => {
    const g = GROUND_BY_T[type[k]];
    if (!g) return 0;
    if (g.key === 'grass') {
      const o = n < 0 ? null : GROUND_BY_T[type[n]];
      return o && o.key === 'grass' ? 0 : 1;
    }
    if (type[k] === T_PLAZA) {
      if (n < 0 || id[n] !== id[k]) return 2;
      // Inside the plaza: a contrasting stone course on every third cell
      // line (15 m squares), on most plazas, from the north or west side.
      return inlayAt && (lots[id[k]].seed >>> 20) % 10 < 7 ? 3 : 0;
    }
    return 0;
  };
  let inlayAt = false;
  // side: 0 north (-z), 1 south (+z), 2 west (-x), 3 east (+x).
  const strip = (kind, lid, side, a0, a1, line) => {
    const lot = lots[lid];
    for (let layer = 0; layer < (kind === 1 ? 2 : 1); layer++) {
      const d0 = kind === 1 ? (layer ? CURB : 0) : kind === 3 ? -INLAY / 2 : 0, d1 = kind === 1 ? (layer ? CURB + VERGE : CURB) : kind === 3 ? INLAY / 2 : BORDER;
      let col;
      let bld;
      if (kind === 1 && layer === 1) {
        col = lot ? mixHex(lotTone(lot, LOT_GROUND[lot.type] || LOT_GROUND.yard), VERGE_COL, 0.5) : VERGE_COL;
        bld = B.grass;
      } else if (kind === 1) {
        col = CURB_COL;
        bld = B.sidewalk;
      } else {
        col = shadeHex(lot ? PAVE_TONES[((lot.seed >>> 12) + 3) % PAVE_TONES.length] : 0xb8b0a0, 0.8);
        bld = B.sidewalk;
      }
      let xa, xb, za, zb;
      if (side < 2) {
        xa = a0; xb = a1;
        za = side === 0 ? line + d0 : line - d1;
        zb = side === 0 ? line + d1 : line - d0;
      } else {
        za = a0; zb = a1;
        xa = side === 2 ? line + d0 : line - d1;
        xb = side === 2 ? line + d1 : line - d0;
      }
      const b = bld.at((xa + xb) / 2, (za + zb) / 2);
      b.flat(xa, za, xb, zb, EDGE_Y + layer * 0.002, col);
      if (kind >= 2) pavedUv(b, xa, za, xb, zb, BORDER_LAY);
      strips++;
    }
  };
  // North and south sides: runs along each row.
  for (const side of [0, 1]) {
    for (let j = j0; j < j1; j++) {
      const nj = side === 0 ? j - 1 : j + 1;
      const line = z0 + (side === 0 ? j : j + 1) * cell;
      let run = -1, runKind = 0, runId = -1;
      for (let i = i0; i <= i1; i++) {
        let kind = 0, lid = -1;
        if (i < i1) {
          const k = j * w + i;
          inlayAt = side === 0 && j % 3 === 0;
          kind = edgeOf(k, nj >= 0 && nj < h ? nj * w + i : -1);
          lid = id[k];
        }
        if (run >= 0 && (kind !== runKind || lid !== runId)) {
          strip(runKind, runId, side, x0 + run * cell, x0 + i * cell, line);
          run = -1;
        }
        if (kind && run < 0) { run = i; runKind = kind; runId = lid; }
      }
    }
  }
  // West and east sides: runs down each column.
  for (const side of [2, 3]) {
    for (let i = i0; i < i1; i++) {
      const ni = side === 2 ? i - 1 : i + 1;
      const line = x0 + (side === 2 ? i : i + 1) * cell;
      let run = -1, runKind = 0, runId = -1;
      for (let j = j0; j <= j1; j++) {
        let kind = 0, lid = -1;
        if (j < j1) {
          const k = j * w + i;
          inlayAt = side === 2 && i % 3 === 0;
          kind = edgeOf(k, ni >= 0 && ni < w ? j * w + ni : -1);
          lid = id[k];
        }
        if (run >= 0 && (kind !== runKind || lid !== runId)) {
          strip(runKind, runId, side, z0 + run * cell, z0 + j * cell, line);
          run = -1;
        }
        if (kind && run < 0) { run = j; runKind = kind; runId = lid; }
      }
    }
  }
  return strips;
}
const T_PLAZA = LOT_TYPES.indexOf('plaza') + 1;
const BORDER_LAY = { s: 0.4, c: 0, n: 1 };

// ---- dressing ----

const HEDGE = 0x3f6e34, WALLS = [0xe6dccb, 0xd4d0c8, 0xf0e8da, 0xc4b8a4], CONTAINERS = [0xb4442c, 0x2c5a8a, 0x3a7a4a, 0xd89a2a, 0x8a8e92, 0x6a3a6a];
const TOWELS = [0xd8452c, 0x2c7fb8, 0xf0c030, 0x2fa88a, 0xf4f0e6, 0xe07aa0];

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
// paint, sidewalk, ao, glow, trees, treesDetail) and returns how many it
// drew. stamps: lotStamps(C), made once per tile.
export function drawLotFeatures(C, lot, feats, n, stamps, from = 0) {
  const y = LOT_Y;
  const R = C.R || {};
  // A breakable feature lying broken (world/collision.js isBroken) is left
  // out of a tile rebuilt after the break, as the street props are.
  const gone = C.city && typeof C.city.propBroken === 'function' ? C.city.propBroken : null;
  let drawn = 0;
  for (let q = from; q < n; q++) {
    const f = feats[q];
    if (gone && BREAKS.has(f.kind) && gone(f.x, f.z)) continue;
    const x = f.x, z = f.z, h = f.heading || 0;
    const ca = Math.cos(h), sa = Math.sin(h);
    const hl = (f.l || 0) / 2, hw = (f.w || 0) / 2;
    const P = C.props.at(x, z), S = C.solid.at(x, z);
    switch (f.kind) {
      case 'fence': {
        const r = lot.type === 'works' || lot.type === 'site' || f.v % 3 === 2 ? R.mesh : R.fence;
        const hgt = f.h || (r === R.mesh ? 2 : 1.1);
        if (r) panels(C.detail.at(x, z), r, x - ca * hl, z - sa * hl, x + ca * hl, z + sa * hl, y, hgt, r === R.mesh ? 0xc8ccd0 : [0xffffff, 0xe8e0d0, 0xb89a72][f.v % 3]);
        break;
      }
      case 'hedge': {
        const hgt = f.h || 1.3;
        const col = shadeHex(HEDGE, 0.9 + (f.v % 4) * 0.06);
        S.obox(x, z, hl, Math.max(0.3, hw), y, y + hgt, h, col, shadeHex(col, 1.12), 0.6, 1.05);
        if (Math.abs(sa) < 0.02 || Math.abs(ca) < 0.02) C.ao.at(x, z).aoSkirt(x - Math.abs(ca * hl) - Math.abs(sa * hw), z - Math.abs(sa * hl) - Math.abs(ca * hw), x + Math.abs(ca * hl) + Math.abs(sa * hw), z + Math.abs(sa * hl) + Math.abs(ca * hw), 0.6, y + 0.012, 0.7);
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
        const pv = C.sidewalk.at(x, z);
        const col = f.kind === 'drive' ? (f.v % 2 ? 0xb4aea2 : 0x9a9690) : lot.type === 'beach' ? 0xc8b48a : 0xd6cdb8;
        orientedQuad(pv, x - ca * hl - sa * hw, z - sa * hl + ca * hw, x + ca * hl - sa * hw, z + sa * hl + ca * hw,
          x + ca * hl + sa * hw, z + sa * hl - ca * hw, x - ca * hl + sa * hw, z - sa * hl - ca * hw, y + 0.012, col);
        break;
      }
      case 'bay': {
        // One bay (2.5 by 5 m: l across the row, w the depth) or a row of
        // them when l is longer (W1 emits rows, eachBay splits them the
        // same way): the side lines only. The cars are not part of the tile:
        // the lot car field (createLotCarField, drawn by systems/parked.js)
        // parks real car bodies in them by lot, hour and view.
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
        C.solid.at(x, z).blob(x, y + hgt * 0.45, z, r, hgt * 0.55, r, shadeHex(0x4a7e3a, 0.85 + (f.v % 5) * 0.06), 5, 3, 0.55, 1.1);
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
        C.ao.at(x, z).aoDisc(x, z, Math.max(hl, hw) + 1.5, y + 0.012, 0.6, 6);
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
        C.solid.at(x, z).blob(x, y + r * 0.3, z, r, r * 0.6, r * 0.85, shadeHex(0x8a8680, 0.85 + (f.v % 5) * 0.06), 5, 3, 0.6, 1.05);
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

// Lots by the tile that owns them (the tile of the lot rect's center).
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
// builders (props, solid, detail, paint, sidewalk, ao, glow, trees,
// treesDetail). Drawing only: no collision shapes.
export function* lotJob(C, lots, dress, over) {
  if (!lots.length || !dress) return;
  const stamps = lotStamps(C);
  const feats = [];
  const stats = C.lotStats || null;
  for (const lot of lots) {
    feats.length = 0;
    // dress fills feats, or returns its own (shared, read-only) list.
    const fs = dress(C.city, lot, feats) || feats;
    const n = fs.length;
    // A few features at a time (a lot can hold 24 trees); dressing a lot
    // the first time is a piece of its own.
    if (over()) yield 'lots';
    for (let q = 0; q < n; q += 2) {
      drawLotFeatures(C, lot, fs, Math.min(n, q + 2), stamps, q);
      if (over()) yield 'lots';
    }
    if (stats) { stats.lots++; stats.features += n; }
    if (over()) yield 'lots';
  }
}

// ---- Cars in the bays ----
// The cars of a lot are not baked into the tile: they depend on the hour and
// on what is in view. createLotCarField picks, a few times a second, the
// bays near the camera that hold a car (by lot fill, see world/lots.js
// lotFill, and the bay hash of world/collision.js bayCar), at most `cap`
// of them, nearest first. systems/parked.js draws them: the real car body
// (vehiclemesh) up close, lotHull below beyond that, both instanced.

export const LOT_CAR_CAP = 40; // static parked cars in view, default
export const LOT_CAR_CAP_MAX = 60; // the most a quality tier may ask for
// Which cars stand in the lots of a district (spec ids of VEHICLE_SPECS).
// The sedan and hatchback roles are the fleet bodies (docs/FLEET.md),
// drawn as their L2 shell (systems/parked.js).
export const LOT_CAR_MIX = {
  downtown: ['midsize', 'midsize', 'taxi', 'suv', 'sports', 'van', 'midsize'],
  midtown: ['midsize', 'suv', 'crewcab', 'pickup', 'van', 'muscle', 'midsize'],
  residential: ['suv', 'midsize', 'pickup', 'midsize', 'muscle', 'crewcab'],
  beach: ['sports', 'suv', 'muscle', 'midsize', 'pickup', 'suv'],
  docks: ['pickup', 'van', 'midsize', 'crewcab'],
  industrial: ['pickup', 'van', 'crewcab', 'midsize'],
  park: ['suv', 'midsize', 'pickup'],
};
// Every spec id a lot can show, in a fixed order (the index is stored per car).
export const LOT_CAR_SPECS = [...new Set(Object.values(LOT_CAR_MIX).flat())];
const MIX_IDX = {};
for (const k of Object.keys(LOT_CAR_MIX)) MIX_IDX[k] = LOT_CAR_MIX[k].map((id) => LOT_CAR_SPECS.indexOf(id));
// Paint by fleet palette: the spec's own colors, plus the two most common
// street colors (white and black), so a lot is not a row of one hue.
const COMMON = [0xe8e8e6, 0x24272b];
export function lotCarColor(specIdx, r) {
  const spec = VEHICLE_SPECS[LOT_CAR_SPECS[specIdx]];
  const cols = spec.colors;
  const n = cols.length + COMMON.length;
  const k = Math.floor(r * n);
  return k < cols.length ? cols[k] : COMMON[k - cols.length];
}

// The car in one bay: the bay center (bx, bz), the row's variant v and the
// lot's fill. -1 when the bay is empty (see bayCar: a listed spot is empty
// here, the parked-car system puts a real car in it), else the bay's hash
// u in 0..fill. Same hash as the collision world.
export function lotCarAt(city, bx, bz, v, fill) {
  return bayCar(city, bx, bz, v, fill);
}

function hash2(x, z, k) {
  let h = Math.imul(x * 374761393 ^ z * 668265263 ^ k * 2246822519, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

const FIELD_CELL = 128;
// The field of static bay cars of one city. Make it once, call update(...)
// a few times a second, read the arrays n, x, z, yaw (heading, rad), spec
// (index in LOT_CAR_SPECS), color (hex), dist (m). No allocation in update.
export function createLotCarField(city, opts = {}) {
  const range = opts.range || 150;
  const dress = opts.dress || dressLot;
  const MAX = LOT_CAR_CAP_MAX;
  const field = {
    n: 0, cap: opts.cap || LOT_CAR_CAP,
    x: new Float32Array(MAX), z: new Float32Array(MAX), yaw: new Float32Array(MAX),
    spec: new Uint8Array(MAX), color: new Uint32Array(MAX), dist: new Float32Array(MAX),
    stats: { lots: 0, bays: 0, updates: 0 },
    update: null,
  };
  // Parking lots by 128 m cell.
  const grid = new Map();
  const cx0 = (v) => Math.floor(v / FIELD_CELL);
  for (const lot of city.lots || []) {
    if (!lot || lot.type !== 'carpark') continue;
    for (let i = cx0(lot.x0); i <= cx0(lot.x1); i++) {
      for (let j = cx0(lot.z0); j <= cx0(lot.z1); j++) {
        const key = i * 65536 + j;
        let a = grid.get(key);
        if (!a) grid.set(key, (a = []));
        a.push(lot);
      }
    }
  }
  field.lotCount = () => { let n = 0; for (const a of grid.values()) n += a.length; return n; };
  const cache = lotDressCache(city, dress);
  const seen = new Set();
  // (cx, cz): the camera; (fx, fz): its look direction on the ground
  // (unit); hour: the clock; cap: cars wanted (default field.cap). blk, nBlk:
  // the real vehicles standing in the lots, six floats each (x, z, cos, sin
  // of the heading, half length, half width): a bay one of them overlaps
  // stays empty (a parked fire truck, a car the player left).
  field.update = (cx, cz, fx, fz, hour, cap = field.cap, blk = null, nBlk = 0) => {
    const want = Math.min(MAX, Math.max(0, cap | 0));
    let n = 0;
    field.stats.updates++;
    seen.clear();
    const r2 = range * range;
    const i0 = cx0(cx - range), i1 = cx0(cx + range), j0 = cx0(cz - range), j1 = cx0(cz + range);
    for (let i = i0; i <= i1; i++) {
      for (let j = j0; j <= j1; j++) {
        const list = grid.get(i * 65536 + j);
        if (!list) continue;
        for (let li = 0; li < list.length; li++) {
          const lot = list[li];
          if (seen.has(lot.id)) continue;
          seen.add(lot.id);
          const qx = cx < lot.x0 ? lot.x0 - cx : cx > lot.x1 ? cx - lot.x1 : 0;
          const qz = cz < lot.z0 ? lot.z0 - cz : cz > lot.z1 ? cz - lot.z1 : 0;
          if (qx * qx + qz * qz > r2) continue;
          field.stats.lots++;
          const fill = lotFill(lot, hour);
          const mix = MIX_IDX[lot.district] || MIX_IDX.midtown;
          const feats = cache.get(lot);
          for (let q = 0; q < feats.length; q++) {
            const f = feats[q];
            if (f.kind !== 'bay') continue;
            const nb = Math.max(1, Math.round(f.l / 2.5));
            const ca = Math.cos(f.heading), sa = Math.sin(f.heading);
            const half = (nb * 2.5) / 2;
            for (let s = 0; s < nb; s++) {
              const o = -half + (s + 0.5) * 2.5;
              const bx = f.x + ca * o, bz = f.z + sa * o;
              const dx = bx - cx, dz = bz - cz;
              const d2 = dx * dx + dz * dz;
              if (d2 > r2) continue;
              const d = Math.sqrt(d2);
              // In view: ahead within about 57 degrees, or close by.
              if (d > 14 && dx * fx + dz * fz < 0.54 * d) continue;
              field.stats.bays++;
              if (n >= want && d >= field.dist[n - 1]) continue;
              const u = lotCarAt(city, bx, bz, f.v, fill);
              if (u < 0) continue;
              let blocked = false;
              for (let k = 0; k < nBlk && !blocked; k++) {
                const o = k * 6, rx = bx - blk[o], rz = bz - blk[o + 1];
                const lx = rx * blk[o + 2] + rz * blk[o + 3], lz = -rx * blk[o + 3] + rz * blk[o + 2];
                blocked = Math.abs(lx) < blk[o + 4] + 2.4 && Math.abs(lz) < blk[o + 5] + 1.0;
              }
              if (blocked) continue;
              // Insert by distance (the arrays hold the nearest `want`).
              let at = n < want ? n++ : want - 1;
              while (at > 0 && field.dist[at - 1] > d) {
                const t = at - 1;
                field.x[at] = field.x[t]; field.z[at] = field.z[t]; field.yaw[at] = field.yaw[t];
                field.spec[at] = field.spec[t]; field.color[at] = field.color[t]; field.dist[at] = field.dist[t];
                at--;
              }
              const bi = Math.round(bx * 5), bj = Math.round(bz * 5);
              const r1 = hash2(bi, bj, 1), r2h = hash2(bi, bj, 2), r3 = hash2(bi, bj, 3), r4 = hash2(bi, bj, 4);
              const sp = mix[Math.floor(r1 * mix.length)];
              field.x[at] = bx + ca * (r4 - 0.5) * 0.3;
              field.z[at] = bz + sa * (r4 - 0.5) * 0.3;
              // Nose in or tail in, a few degrees off the bay line.
              field.yaw[at] = f.heading + Math.PI / 2 + (r3 < 0.3 ? Math.PI : 0) + (r2h - 0.5) * 0.12;
              field.spec[at] = sp;
              field.color[at] = lotCarColor(sp, hash2(bi, bj, 5));
              field.dist[at] = d;
            }
          }
        }
      }
    }
    field.n = n;
    return n;
  };
  return field;
}

// ---- The rounded hull for cars past the real body's range ----
// A low-poly car (about 350 triangles): 12 stations along the length, a ring
// of 11 points round the cross-section (sill, belt, glass or hood side, roof
// edge, crown), wheels as 8-sided drums. Vertex colors: paint is white (the
// instance color tints it), glass, sills and rubber are dark. No flat box
// anywhere: the greenhouse tapers, the nose and tail round in, the roof
// crowns. Origin: the ground center, the car points along +x, y up.
// Returns { pos, nor, col, idx, tris } (typed arrays).
const HULL_BODY = {
  // t along the car from the tail (0) to the nose (1): rear window base,
  // roof start, roof end, windshield base; belt height share of the car's.
  hatch: { w1: 0.08, r0: 0.26, r1: 0.52, w0: 0.7, belt: 0.54 },
  sedan: { w1: 0.2, r0: 0.35, r1: 0.6, w0: 0.72, belt: 0.55 },
  coupe: { w1: 0.2, r0: 0.4, r1: 0.55, w0: 0.7, belt: 0.6 },
  pickup: { w1: 0.34, r0: 0.38, r1: 0.6, w0: 0.72, belt: 0.58 },
  van: { w1: 0.1, r0: 0.24, r1: 0.56, w0: 0.8, belt: 0.5 },
  truck: { w1: 0.5, r0: 0.54, r1: 0.7, w0: 0.78, belt: 0.5 },
};
const GLASS = 0.012, DARK = 0.05, RUBBER = 0.02;

export function buildLotHull(spec) {
  const P = HULL_BODY[spec.body] || HULL_BODY.sedan;
  const L = spec.length, W = spec.width, H = spec.height, hw = W / 2;
  const yb = 0.17; // ground clearance of the body
  const ts = [0, 0.025, 0.07, P.w1, P.r0, (P.r0 + P.r1) / 2, P.r1, P.w0, 0.86, 0.94, 0.98, 1];
  ts.sort((a, b) => a - b);
  const NS = ts.length;
  const NJ = 11;
  const sm = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  // Grid of ring points [station][j] -> (x, y, z).
  const G = new Float32Array(NS * NJ * 3);
  const roofAt = new Float32Array(NS);
  for (let i = 0; i < NS; i++) {
    const t = ts[i];
    const x = (t - 0.5) * L;
    // Belt line: the trunk and hood tuck down at the ends.
    const belt = H * P.belt * (0.9 + 0.1 * sm(0, 0.16, t)) * (1 - 0.1 * sm(0.78, 1, t));
    let roof = belt, glass = 0;
    if (t > P.w1 && t < P.w0) {
      const up = sm(P.w1, P.r0, t), down = 1 - sm(P.r1, P.w0, t);
      const k = t < (P.r0 + P.r1) / 2 ? up : down;
      roof = belt + (H - belt) * k;
      glass = 1;
    }
    roofAt[i] = glass;
    // The ends round in: narrower and lower at the tail and the nose.
    const end = Math.min(sm(0, 0.07, t), sm(1, 0.93, t));
    const w = hw * (0.8 + 0.2 * end);
    const lo = yb + 0.06 * (1 - end);
    const sill = lo + 0.13;
    const cabin = glass ? 1 : 0;
    const topIn = cabin ? 0.8 : 0.93; // the greenhouse tumbles home
    const crown = 0.05 * (cabin ? 1 : 0.5);
    const pts = [
      [0.8, lo], [1, sill], [1, belt - 0.02], [topIn, roof - 0.02], [0.52, roof + crown * 0.4], [0, roof + crown],
      [-0.52, roof + crown * 0.4], [-topIn, roof - 0.02], [-1, belt - 0.02], [-1, sill], [-0.8, lo],
    ];
    for (let j = 0; j < NJ; j++) {
      const o = (i * NJ + j) * 3;
      G[o] = x; G[o + 1] = pts[j][1]; G[o + 2] = pts[j][0] * w;
    }
  }
  const pos = [], nor = [], col = [], idx = [];
  const vp = (i, j) => [G[(i * NJ + j) * 3], G[(i * NJ + j) * 3 + 1], G[(i * NJ + j) * 3 + 2]];
  // Smooth normal of grid point (i, j): across the neighbors, facing out.
  const nrm = (i, j) => {
    const a = vp(Math.max(0, i - 1), j), b = vp(Math.min(NS - 1, i + 1), j);
    const c = vp(i, Math.max(0, j - 1)), d = vp(i, Math.min(NJ - 1, j + 1));
    const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], v = [d[0] - c[0], d[1] - c[1], d[2] - c[2]];
    let n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    const p = vp(i, j);
    // Outward: away from the middle of this station's ring.
    let cy = 0;
    for (let q = 0; q < NJ; q++) cy += G[(i * NJ + q) * 3 + 1] / NJ;
    const out = [0, p[1] - cy, p[2]];
    if (n[0] * out[0] + n[1] * out[1] + n[2] * out[2] < 0) n = [-n[0], -n[1], -n[2]];
    const l = Math.hypot(n[0], n[1], n[2]) || 1;
    return [n[0] / l, n[1] / l, n[2] / l];
  };
  const emit = (p, n, c) => { pos.push(p[0], p[1], p[2]); nor.push(n[0], n[1], n[2]); col.push(c, c, c); return pos.length / 3 - 1; };
  const tri = (a, b, c, flip) => (flip ? idx.push(a, c, b) : idx.push(a, b, c));
  for (let i = 0; i + 1 < NS; i++) {
    const slope = roofAt[i] && roofAt[i + 1] && (ts[i + 1] <= P.r0 + 1e-6 || ts[i] >= P.r1 - 1e-6);
    const cabin = roofAt[i] && roofAt[i + 1];
    for (let j = 0; j + 1 < NJ; j++) {
      // Segment j..j+1 of the ring: 0 and 9 sills, 1 and 8 lower side, 2 and
      // 7 glass (cabin) or hood side, 3, 6 roof edge (glass on the slopes),
      // 4, 5 roof.
      const side = j === 0 || j === 9 ? 'sill' : j === 1 || j === 8 ? 'low' : j === 2 || j === 7 ? 'win' : 'roof';
      let c = 1;
      if (side === 'sill') c = DARK;
      else if (side === 'win') c = cabin ? GLASS : 1;
      else if (side === 'roof' && slope) c = j === 3 || j === 6 || j === 4 || j === 5 ? GLASS : 1;
      const a = emit(vp(i, j), nrm(i, j), c), b = emit(vp(i + 1, j), nrm(i + 1, j), c);
      const d = emit(vp(i, j + 1), nrm(i, j + 1), c), e = emit(vp(i + 1, j + 1), nrm(i + 1, j + 1), c);
      // Wound so the face points out: the ring runs right side up over to
      // the left, stations run tail to nose.
      tri(a, b, d, false); tri(b, e, d, false);
    }
  }
  // Tail and nose caps: a fan round the ring's middle, paint.
  for (const end of [0, 1]) {
    const i = end ? NS - 1 : 0;
    const nx = end ? 1 : -1;
    let cy = 0;
    for (let j = 0; j < NJ; j++) cy += G[(i * NJ + j) * 3 + 1] / NJ;
    const hub = emit([G[i * NJ * 3], cy, 0], [nx, 0, 0], 1);
    const ring = [];
    for (let j = 0; j < NJ; j++) ring.push(emit(vp(i, j), [nx, 0, 0], j === 0 || j === NJ - 1 ? DARK : 1));
    for (let j = 0; j + 1 < NJ; j++) tri(hub, ring[j], ring[j + 1], end === 0);
  }
  // Wheels: drums of 8 sides, the outer face closed.
  const { wheelBase = L * 0.6, wheelRadius = 0.32 } = spec;
  const wr = wheelRadius, ww = 0.22;
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const cx = sx * wheelBase / 2, cz = sz * (hw - ww / 2 - 0.01);
      const base = pos.length / 3;
      for (let k = 0; k < 8; k++) {
        const a = (k / 8) * Math.PI * 2, ca = Math.cos(a), sa = Math.sin(a);
        const nrmv = [ca, sa, 0];
        emit([cx + ca * wr, wr + sa * wr, cz - sz * ww / 2], nrmv, RUBBER);
        emit([cx + ca * wr, wr + sa * wr, cz + sz * ww / 2], nrmv, RUBBER);
      }
      for (let k = 0; k < 8; k++) {
        const k2 = (k + 1) % 8;
        const a = base + k * 2, b = base + k * 2 + 1, c = base + k2 * 2, d = base + k2 * 2 + 1;
        tri(a, c, b, sz < 0); tri(b, c, d, sz < 0);
      }
      const hub = emit([cx, wr, cz + sz * ww / 2], [0, 0, sz], 0.18);
      const rim = [];
      for (let k = 0; k < 8; k++) {
        const a = (k / 8) * Math.PI * 2;
        rim.push(emit([cx + Math.cos(a) * wr * 0.9, wr + Math.sin(a) * wr * 0.9, cz + sz * ww / 2], [0, 0, sz], 0.1));
      }
      for (let k = 0; k < 8; k++) tri(hub, rim[k], rim[(k + 1) % 8], sz < 0);
    }
  }
  // Wind every triangle so its face looks the way its vertex normals do.
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t] * 3, b = idx[t + 1] * 3, c = idx[t + 2] * 3;
    const ux = pos[b] - pos[a], uy = pos[b + 1] - pos[a + 1], uz = pos[b + 2] - pos[a + 2];
    const vx = pos[c] - pos[a], vy = pos[c + 1] - pos[a + 1], vz = pos[c + 2] - pos[a + 2];
    const d = (uy * vz - uz * vy) * nor[a] + (uz * vx - ux * vz) * nor[a + 1] + (ux * vy - uy * vx) * nor[a + 2];
    if (d < 0) { const q = idx[t + 1]; idx[t + 1] = idx[t + 2]; idx[t + 2] = q; }
  }
  return {
    pos: Float32Array.from(pos), nor: Float32Array.from(nor), col: Float32Array.from(col),
    idx: Uint16Array.from(idx), tris: idx.length / 3,
  };
}
