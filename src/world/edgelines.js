import { mkShape } from './shape.js';
// Sea walls and rails (docs/PLAN_V3.md 2.2 item 4). The edge of everything
// a car can stand on (the drawn land, plus every road strip widened to its
// rail line) is traced on a fixed 2 m lattice into short segments, cell by
// cell, the first time a query or the renderer needs a cell. Each segment
// is tagged:
//   seawall  a concrete cap wall on the shore (collision, 0.9 m)
//   rail     a bridge, causeway or water-side road edge, and the sides and
//            end of a pier (collision, 0.9 m)
//   beach    sand into the water: no wall, the car wades and bogs down
//   gap      the root of a pier (6 m): no wall, cars and people walk on
// The same segments are drawn (render/props.js createEdgeLineView), so what
// you see is what you hit. Pure, deterministic: a cell's segments are a
// function of the city alone (the lattice is global, so neighbor cells
// meet exactly), whatever the order cells are touched in.

export const EDGE_STEP = 2; // m, lattice spacing (the 2 m simplification)
export const WALL_H = 0.9; // m, sea wall and rail height
export const WALL_R = 0.25; // m, half thickness (capsule radius)
export const RAIL_OFF = 0.5; // m, rail line outside a road's curb
export const GAP_PAD = 0.4; // m, a pier root gap is the pier width plus this each side
import { pairGap, MEDIAN_GAP } from './junctions.js';

const CELL = 32; // the collision world's cell
const N = CELL / EDGE_STEP; // squares per cell side
const NO_ITEMS = [];

export const EDGE_TAGS = ['seawall', 'rail', 'beach', 'gap'];
export const isWallTag = (t) => t === 'seawall' || t === 'rail';

export function createEdgeLayer(city) {
  const edges = city.edges || [], nodes = city.nodes || [];
  const land = typeof city.mainShore === 'function' ? city.mainShore : typeof city.shoreDist === 'function' ? city.shoreDist : () => 1;
  // The island's mainShore leaves out its islet and causeway rects; the
  // real map's already holds them.
  const extra = city.landGrid ? [] : (city.extraLand || []);
  const piers = city.piers || [];
  const NE = edges.length;
  const ax = new Float64Array(NE), az = new Float64Array(NE), ux = new Float64Array(NE), uz = new Float64Array(NE);
  const len = new Float64Array(NE), rr = new Float64Array(NE), rl = new Float64Array(NE);
  let maxR = 0;
  for (let k = 0; k < NE; k++) {
    const e = edges[k], a = nodes[e.a], b = nodes[e.b];
    const dx = b.x - a.x, dz = b.z - a.z, L = Math.hypot(dx, dz) || 1e-6;
    ax[k] = a.x; az[k] = a.z; ux[k] = dx / L; uz[k] = dz / L; len[k] = L;
    rr[k] = rl[k] = e.width / 2 + RAIL_OFF;
    // The two halves of a divided road under MEDIAN_GAP apart (two bridge
    // decks side by side): the left side reaches past the middle of the
    // gap, so the decks are one road with no rail pair down the middle
    // (the meshes pave the gap, render/citymesh.js pairGap).
    if (e.pair >= 0 && edges[e.pair] && e.ux !== undefined) {
      const lc = (e.off || 0) - e.width / 2;
      const g = Math.max(pairGap(city, e, 0, lc), pairGap(city, e, L, lc));
      if (g < MEDIAN_GAP) rl[k] = e.width / 2 - (e.off || 0) + Math.max(RAIL_OFF, g / 2 + 0.3);
    }
    if (rr[k] > maxR) maxR = rr[k];
    if (rl[k] > maxR) maxR = rl[k];
  }
  const rectSdf = (r, x, z) => {
    const ix = Math.min(x - r.x0, r.x1 - x), iz = Math.min(z - r.z0, r.z1 - z);
    if (ix >= 0 && iz >= 0) return Math.min(ix, iz);
    return -Math.hypot(Math.max(0, -ix), Math.max(0, -iz));
  };
  // Road strip term over a list of edge ids: max (rail radius - distance).
  let near = [];
  const nearBuf = [];
  function roadTerm(x, z) {
    let best = -1e9;
    for (let q = 0; q < near.length; q++) {
      const k = near[q];
      let t = (x - ax[k]) * ux[k] + (z - az[k]) * uz[k];
      if (t < 0) t = 0; else if (t > len[k]) t = len[k];
      const dx = ax[k] + ux[k] * t - x, dz = az[k] + uz[k] * t - z;
      // (Left of the edge: s = -(x - ax) uz + (z - az) ux < 0.)
      const v = (rl[k] !== rr[k] && -(x - ax[k]) * uz[k] + (z - az[k]) * ux[k] < 0 ? rl[k] : rr[k]) - Math.sqrt(dx * dx + dz * dz);
      if (v > best) best = v;
    }
    return best;
  }
  function extraTerm(x, z) {
    let best = -1e9;
    for (let i = 0; i < extra.length; i++) {
      const v = rectSdf(extra[i], x, z);
      if (v > best) best = v;
    }
    return best;
  }
  // The field: > 0 where a car may stand.
  function field(x, z) {
    const l = land(x, z);
    if (l > 0) return l;
    const r = roadTerm(x, z), e = extraTerm(x, z);
    return Math.max(l, r, e);
  }
  function edgesFor(cx, cz) {
    const mx = (cx + 0.5) * CELL, mz = (cz + 0.5) * CELL;
    const R = CELL * 0.7072 + maxR + EDGE_STEP;
    nearBuf.length = 0;
    if (city.edgesNear && NE > 400) city.edgesNear(mx, mz, R, nearBuf);
    else for (let k = 0; k < NE; k++) nearBuf.push(k);
    const out = [];
    for (let q = 0; q < nearBuf.length; q++) {
      const k = nearBuf[q];
      let t = (mx - ax[k]) * ux[k] + (mz - az[k]) * uz[k];
      if (t < 0) t = 0; else if (t > len[k]) t = len[k];
      const d = Math.hypot(ax[k] + ux[k] * t - mx, az[k] + uz[k] * t - mz);
      if (d <= CELL * 0.7072 + rr[k] + EDGE_STEP) out.push(k);
    }
    out.sort((a, b) => a - b);
    return out;
  }
  const inPier = (x, z, pad) => {
    for (let i = 0; i < piers.length; i++) {
      const p = piers[i];
      if (x >= p.x0 - pad && x <= p.x1 + pad && z >= p.z0 - pad && z <= p.z1 + pad) return p;
    }
    return null;
  };
  const causewayRect = (r) => edges.some((e) => e.causeway && (() => {
    const a = nodes[e.a], b = nodes[e.b], mx = (a.x + b.x) / 2, mz = (a.z + b.z) / 2;
    return mx >= r.x0 && mx <= r.x1 && mz >= r.z0 && mz <= r.z1;
  })());
  const extraRail = extra.map(causewayRect);
  function isBeach(x, z) {
    if (typeof city.lotTypeAt === 'function' && city.lotTypeAt(x, z) === 'beach') return true;
    if (!city.landGrid && typeof city.districtOf === 'function' && city.districtOf(x, z) === 'beach') return true;
    return false;
  }
  // Tag of a segment from (x0, z0) to (x1, z1) (land on its left or right).
  function tagOf(x0, z0, x1, z1) {
    const mx = (x0 + x1) / 2, mz = (z0 + z1) / 2;
    if (inPier(mx, mz, GAP_PAD)) return 'gap';
    const l = land(mx, mz), r = roadTerm(mx, mz), e = extraTerm(mx, mz);
    if (r >= l - 0.05 && r >= e - 0.05) return 'rail';
    if (e > l + 0.05) {
      for (let i = 0; i < extra.length; i++) if (extraRail[i] && Math.abs(rectSdf(extra[i], mx, mz) - e) < 1e-6) return 'rail';
    }
    // The landward side: the normal toward the higher field.
    let nx = -(z1 - z0), nz = x1 - x0;
    const nl = Math.hypot(nx, nz) || 1;
    nx /= nl; nz /= nl;
    if (field(mx + nx, mz + nz) < field(mx - nx, mz - nz)) { nx = -nx; nz = -nz; }
    if (isBeach(mx + nx * 4, mz + nz * 4)) return 'beach';
    return 'seawall';
  }

  // Raw segments of one cell: flat Float64 list (x0, z0, x1, z1) and tags.
  const raw = new Map();
  const vals = new Float64Array((N + 1) * (N + 1));
  const stats = { cells: 0, segments: 0, walls: 0 };
  function rawCell(cx, cz) {
    const key = cx * 100003 + cz;
    let r = raw.get(key);
    if (r) return r;
    const bx = cx * CELL, bz = cz * CELL;
    // Land term first; the road strips only where land says "water".
    let pos = 0, neg = 0;
    for (let j = 0; j <= N; j++) {
      for (let i = 0; i <= N; i++) {
        const v = land(bx + i * EDGE_STEP, bz + j * EDGE_STEP);
        vals[j * (N + 1) + i] = v;
        if (v > 0) pos++; else neg++;
      }
    }
    const segs = [], tags = [];
    if (neg > 0) {
      near = edgesFor(cx, cz);
      const ex = extra.length > 0;
      if (near.length || ex) {
        for (let j = 0; j <= N; j++) {
          for (let i = 0; i <= N; i++) {
            const o = j * (N + 1) + i;
            if (vals[o] > 0) continue;
            const x = bx + i * EDGE_STEP, z = bz + j * EDGE_STEP;
            const v = Math.max(vals[o], roadTerm(x, z), ex ? extraTerm(x, z) : -1e9);
            vals[o] = v;
            if (v > 0) { pos++; neg--; }
          }
        }
      }
      if (pos > 0 && neg > 0) march(bx, bz, segs);
      for (let s = 0; s < segs.length; s += 4) tags.push(tagOf(segs[s], segs[s + 1], segs[s + 2], segs[s + 3]));
    }
    // Pier rails: the long sides and the far end, where they stand over water.
    for (let p = 0; p < piers.length; p++) pierRails(piers[p], cx, cz, segs, tags);
    r = { segs, tags, shapes: null };
    raw.set(key, r);
    stats.cells++;
    stats.segments += tags.length;
    return r;
  }
  // Marching squares over vals (land > 0), one or two segments per square.
  function march(bx, bz, segs) {
    const S = N + 1;
    const lerp = (va, vb) => {
      const d = va - vb;
      return Math.abs(d) < 1e-12 ? 0.5 : va / d;
    };
    for (let j = 0; j < N; j++) {
      for (let i = 0; i < N; i++) {
        const a = vals[j * S + i], b = vals[j * S + i + 1], c = vals[(j + 1) * S + i + 1], d = vals[(j + 1) * S + i];
        const code = (a > 0 ? 1 : 0) | (b > 0 ? 2 : 0) | (c > 0 ? 4 : 0) | (d > 0 ? 8 : 0);
        if (code === 0 || code === 15) continue;
        const x = bx + i * EDGE_STEP, z = bz + j * EDGE_STEP, s = EDGE_STEP;
        // Edge points: top (a-b), right (b-c), bottom (d-c), left (a-d).
        const tX = x + lerp(a, b) * s, tZ = z;
        const rX = x + s, rZ = z + lerp(b, c) * s;
        const bX = x + lerp(d, c) * s, bZ = z + s;
        const lX = x, lZ = z + lerp(a, d) * s;
        const put = (x0, z0, x1, z1) => segs.push(x0, z0, x1, z1);
        switch (code) {
          case 1: case 14: put(lX, lZ, tX, tZ); break;
          case 2: case 13: put(tX, tZ, rX, rZ); break;
          case 3: case 12: put(lX, lZ, rX, rZ); break;
          case 4: case 11: put(rX, rZ, bX, bZ); break;
          case 6: case 9: put(tX, tZ, bX, bZ); break;
          case 7: case 8: put(lX, lZ, bX, bZ); break;
          case 5: case 10: {
            // Saddle: the center decides which corners join.
            const m = (a + b + c + d) / 4;
            const cutLand = (m > 0) !== (code === 5); // the land corners are cut off alone
            if (cutLand) { put(lX, lZ, tX, tZ); put(rX, rZ, bX, bZ); } else { put(tX, tZ, rX, rZ); put(lX, lZ, bX, bZ); }
            break;
          }
          default: break;
        }
      }
    }
  }
  // A pier's rails in cell (cx, cz): 2 m pieces along both long sides and
  // across the far end, kept where the piece's middle is over water and in
  // the cell.
  function pierRails(p, cx, cz, segs, tags) {
    const alongX = p.x1 - p.x0 >= p.z1 - p.z0;
    const out = [];
    if (alongX) {
      for (const z of [p.z0, p.z1]) out.push([p.x0, z, p.x1, z]);
      // The end away from land.
      const endX = land(p.x0 - 1, (p.z0 + p.z1) / 2) > land(p.x1 + 1, (p.z0 + p.z1) / 2) ? p.x1 : p.x0;
      out.push([endX, p.z0, endX, p.z1]);
    } else {
      for (const x of [p.x0, p.x1]) out.push([x, p.z0, x, p.z1]);
      const endZ = land((p.x0 + p.x1) / 2, p.z0 - 1) > land((p.x0 + p.x1) / 2, p.z1 + 1) ? p.z1 : p.z0;
      out.push([p.x0, endZ, p.x1, endZ]);
    }
    for (const [x0, z0, x1, z1] of out) {
      const L = Math.hypot(x1 - x0, z1 - z0), n = Math.max(1, Math.round(L / EDGE_STEP));
      for (let k = 0; k < n; k++) {
        const ax0 = x0 + (x1 - x0) * (k / n), az0 = z0 + (z1 - z0) * (k / n);
        const ax1 = x0 + (x1 - x0) * ((k + 1) / n), az1 = z0 + (z1 - z0) * ((k + 1) / n);
        const mx = (ax0 + ax1) / 2, mz = (az0 + az1) / 2;
        if (Math.floor(mx / CELL) !== cx || Math.floor(mz / CELL) !== cz) continue;
        if (land(mx, mz) > 0) continue;
        segs.push(ax0, az0, ax1, az1);
        tags.push('rail');
      }
    }
  }
  // Collision shapes (capsules, kind 2) of a raw cell's wall segments,
  // made once per raw cell.
  function shapesOfRaw(r) {
    if (r.shapes) return r.shapes;
    const list = [];
    for (let s = 0, t = 0; s < r.segs.length; s += 4, t++) {
      if (!isWallTag(r.tags[t])) continue;
      list.push(mkShape(2, r.segs[s], r.segs[s + 1], r.segs[s + 2], r.segs[s + 3], 0, 0, WALL_R, WALL_H, r.tags[t]));
      stats.walls++;
    }
    r.shapes = list.length ? list : NO_ITEMS;
    return r.shapes;
  }
  // The collision list of cell (cx, cz): its own walls and the neighbors'
  // whose capsules reach into it.
  const cells = new Map();
  function cell(cx, cz) {
    const key = cx * 100003 + cz;
    let list = cells.get(key);
    if (list) return list;
    list = null;
    const x0 = cx * CELL, z0 = cz * CELL, x1 = x0 + CELL, z1 = z0 + CELL, m = WALL_R + 1e-3;
    for (let dj = -1; dj <= 1; dj++) {
      for (let di = -1; di <= 1; di++) {
        const sh = shapesOfRaw(rawCell(cx + di, cz + dj));
        for (let q = 0; q < sh.length; q++) {
          const s = sh[q];
          if (Math.max(s.x0, s.x1) < x0 - m || Math.min(s.x0, s.x1) > x1 + m || Math.max(s.z0, s.z1) < z0 - m || Math.min(s.z0, s.z1) > z1 + m) continue;
          (list || (list = [])).push(s);
        }
      }
    }
    list = list || NO_ITEMS;
    cells.set(key, list);
    return list;
  }
  // Every segment (all tags) of the cells overlapping a rectangle, as
  // fn(x0, z0, x1, z1, tag), cell by cell in row order (the renderer).
  function eachLine(x0, z0, x1, z1, fn) {
    const c0 = Math.floor(x0 / CELL), c1 = Math.floor(x1 / CELL);
    const r0 = Math.floor(z0 / CELL), r1 = Math.floor(z1 / CELL);
    for (let cz = r0; cz <= r1; cz++) {
      for (let cx = c0; cx <= c1; cx++) {
        const r = rawCell(cx, cz);
        for (let s = 0, t = 0; s < r.segs.length; s += 4, t++) fn(r.segs[s], r.segs[s + 1], r.segs[s + 2], r.segs[s + 3], r.tags[t]);
      }
    }
  }
  // The field at any point (tests): > 0 where a car may stand.
  function fieldAt(x, z) {
    near = edgesFor(Math.floor(x / CELL), Math.floor(z / CELL));
    return field(x, z);
  }
  const hasCell = (cx, cz) => raw.has(cx * 100003 + cz);
  return { name: 'edges', cell, eachLine, fieldAt, rawCell, hasCell, stats, allShapes: null };
}
