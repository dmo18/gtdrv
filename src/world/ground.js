// The one ground height function (docs/PLAN_V3.md 2.2 item 5): meshes and
// physics both stand on groundAt(x, z). Road 0, sidewalk and raised median
// +CURB_H, lots and open land 0, the sea floor slopes down from the water
// line (a beach is waded into, not floated over). Bridges are flat in
// 0.9.0; raised decks come through this same function in 0.11.0.
//
// Pure and deterministic. The edges and junctions that can reach a 32 m
// cell are listed the first time a point in it is asked for (lazy, by edge
// id), so a call costs a handful of segment distances and allocates nothing.
// The answer is a pure function of the city and the point.

import { divideOf, GUTTER } from './roadprofile.js';
import { inJunctionArea, pointInRing, ringDist, supAt, curbsAt, walkOf, walkLeftOf, medianBand, medianAt } from './junctions.js';

export const CURB_H = 0.15; // m, curb step (docs/MAP.md edge contract)
export const SIDEWALK_W = 2.0; // m, sidewalk on an edge without `sidewalk`
export const SEA_LEVEL = -0.6; // m, the water surface (game.js SEA_Y)
export const SEA_SLOPE = 0.4; // m of drop per m out from the water line
export const SEA_FLOOR = -2.2; // m, deepest the shallows go
const CELL = 32;
export const FILL_STEP = 2; // m between sliver fill samples
export const FILL_MAX = 1.5; // m, gaps narrower than this are filled
export const GAP_MAX = 6; // m, a gap to a facing strip under this is asphalt
const GAP_COS = Math.cos((25 * Math.PI) / 180);
const NOFILL_ALL = new Float32Array(0);

// The sidewalk beside an edge: its own `sidewalk` (a real map's profile,
// the island's block ring), SIDEWALK_W on an edge without one; none on a
// bridge or causeway.
function sidewalkOf(e) {
  if (e.bridge || e.causeway) return 0;
  return Number.isFinite(e.sidewalk) ? e.sidewalk : SIDEWALK_W;
}

// The raised median of a paired one-way (docs/MAP.md edge contract): it
// is not part of `width`; the edge owns the band along its left curb,
// `median / 2` wide, drawn up to 4 m (render/citymesh.js realRoads: a
// wider median is lot ground in its middle). The left curb is the divide
// of the one-way (roadprofile.js divideOf, the left lane edge) less the
// gutter and the left parking lane. Center offset to the right of the node
// line, NaN when there is none; medianHalf is half the band.
const MEDIAN_BAND = 4;
function medianHalf(e) {
  return e.median > 0 && !e.bridge ? Math.min(e.median / 2, MEDIAN_BAND) / 2 : 0;
}
function medianOffset(e) {
  const h = medianHalf(e);
  if (!(h > 0) || !(e.laneW > 0)) return NaN;
  const curb = divideOf(e) - GUTTER - (e.parkL || 0) - (e.lanesB || 0) * e.laneW - (e.center || 0) / 2;
  return curb - h;
}

export function createGround(city) {
  const nodes = city.nodes || [], edges = city.edges || [];
  // Grid extent: the city bounds, else the road graph plus a margin.
  let x0, z0, x1, z1;
  if (city.bounds) ({ x0, z0, x1, z1 } = city.bounds);
  else {
    x0 = z0 = Infinity; x1 = z1 = -Infinity;
    for (const n of nodes) { x0 = Math.min(x0, n.x); x1 = Math.max(x1, n.x); z0 = Math.min(z0, n.z); z1 = Math.max(z1, n.z); }
    if (!(x1 >= x0)) { x0 = z0 = -1; x1 = z1 = 1; }
    x0 -= 200; z0 -= 200; x1 += 200; z1 += 200;
  }
  const gx0 = Math.floor(x0 / CELL), gz0 = Math.floor(z0 / CELL);
  const W = Math.floor(x1 / CELL) - gx0 + 1, H = Math.floor(z1 / CELL) - gz0 + 1;
  const cellE = new Array(W * H).fill(null); // Int32Array of edge ids, per cell
  const cellN = new Array(W * H).fill(null); // Int32Array of node ids
  const EMPTY = new Int32Array(0);
  // Per edge, precomputed: node a, unit direction, length, half width,
  // outer reach (half width + sidewalk), median offset and half width.
  const NE = edges.length;
  // The junction polygons and trimmed strips of a real map (world/
  // junctions.js); null on the island (node boxes and capsules).
  const geo = city.roadGeo || null;
  const cellJ = geo ? new Array(W * H).fill(null) : null;
  const ax = new Float64Array(NE), az = new Float64Array(NE), ux = new Float64Array(NE), uz = new Float64Array(NE);
  const len = new Float64Array(NE), hw = new Float64Array(NE), reach = new Float64Array(NE);
  const mo = new Float64Array(NE), mh = new Float64Array(NE);
  let maxReach = 0;
  for (let k = 0; k < NE; k++) {
    const e = edges[k], a = nodes[e.a], b = nodes[e.b];
    const dx = b.x - a.x, dz = b.z - a.z, L = Math.hypot(dx, dz) || 1e-6;
    ax[k] = a.x; az[k] = a.z; ux[k] = dx / L; uz[k] = dz / L; len[k] = L;
    hw[k] = e.width / 2;
    mo[k] = medianOffset(e);
    mh[k] = medianHalf(e);
    reach[k] = hw[k] + Math.max(sidewalkOf(e), 2 * mh[k]);
    // A taper or a mitered end reaches a little past the plain strip.
    if (geo) reach[k] = reach[k] * 1.6 + 1;
    if (reach[k] > maxReach) maxReach = reach[k];
  }
  const scratch = [];
  const segD2 = (px, pz, k) => {
    let t = (px - ax[k]) * ux[k] + (pz - az[k]) * uz[k];
    if (t < 0) t = 0; else if (t > len[k]) t = len[k];
    const qx = ax[k] + ux[k] * t - px, qz = az[k] + uz[k] * t - pz;
    return qx * qx + qz * qz;
  };
  function build(c, cx, cz) {
    const mx = (cx + 0.5) * CELL, mz = (cz + 0.5) * CELL;
    scratch.length = 0;
    if (city.edgesNear && NE > 400) city.edgesNear(mx, mz, CELL * 0.7072 + 0.5 + maxReach, scratch);
    else for (let k = 0; k < NE; k++) scratch.push(k);
    const keep = [];
    for (let q = 0; q < scratch.length; q++) {
      const k = scratch[q];
      const r = CELL * 0.7072 + reach[k] + 0.5;
      if (segD2(mx, mz, k) <= r * r) keep.push(k);
    }
    keep.sort((a, b) => a - b);
    cellE[c] = keep.length ? Int32Array.from(keep) : EMPTY;
    // Junction boxes: the ends of those edges that reach the cell.
    const nk = [];
    const h = CELL / 2 + 0.5;
    for (let q = 0; q < keep.length; q++) {
      const e = edges[keep[q]];
      for (const id of [e.a, e.b]) {
        const n = nodes[id];
        if (!(n.hx > 0) && !(n.hz > 0)) continue;
        if (Math.abs(n.x - mx) <= h + (n.hx || 0) && Math.abs(n.z - mz) <= h + (n.hz || 0) && !nk.includes(id)) nk.push(id);
      }
    }
    nk.sort((a, b) => a - b);
    cellN[c] = nk.length ? Int32Array.from(nk) : EMPTY;
    if (geo) {
      const jl = [];
      for (let q = 0; q < 2 * keep.length; q++) {
        const e = edges[keep[q >> 1]];
        const J = geo.junctions[geo.nodeJ[q & 1 ? e.b : e.a]];
        if (J && !jl.includes(J.id) && J.x0 <= mx + h && J.x1 >= mx - h && J.z0 <= mz + h && J.z1 >= mz - h) jl.push(J.id);
      }
      jl.sort((a, b) => a - b);
      cellJ[c] = jl.length ? Int32Array.from(jl) : EMPTY;
    }
    return cellE[c];
  }
  const shore = typeof city.shoreDist === 'function' ? city.shoreDist : null;

  // Real map: inside a junction polygon is road; else within a strip's
  // curbs between its ends (exact taper and miter), else its sidewalk or
  // median band beside the curbs (from the node at a junction end, where
  // the polygon and the sidewalk corners take over).
  // Edges whose reach covered the last geoSurface point (read at once by
  // surfaceAt for the narrow-gap net below).
  let nearEdges = 0;
  function geoSurface(x, z, c, fills = true) {
    const js = cellJ[c];
    for (let q = 0; q < js.length; q++) {
      const J = geo.junctions[js[q]];
      if (inJunctionArea(J, x, z)) return 1;
      for (let gq = 0; gq < J.gores.length; gq++) if (pointInRing(J.gores[gq].poly, x, z)) return 1;
    }
    const es = cellE[c];
    let side = false, median = false;
    nearEdges = 0;
    for (let q = 0; q < es.length; q++) {
      const k = es[q];
      if (geo.inner[k]) continue;
      const e = edges[k];
      const d = (x - ax[k]) * ux[k] + (z - az[k]) * uz[k];
      if (d < -reach[k] || d > len[k] + reach[k]) continue;
      const s = -(x - ax[k]) * uz[k] + (z - az[k]) * ux[k];
      if (Math.abs(s) > reach[k]) continue;
      nearEdges++;
      const qa = 2 * k, qb = qa + 1;
      const d0 = geo.jEnd[qa] >= 0 ? 0 : geo.trim[qa] + geo.miter[qa] * s;
      const d1 = geo.jEnd[qb] >= 0 ? len[k] : len[k] - geo.trim[qb] + geo.miter[qb] * s;
      if (d < d0 || d > d1) continue;
      const C = curbsAt(geo, e, d);
      const cl = C.l, cr = C.r;
      if (s >= cl && s <= cr) return 1;
      if (s > cr) {
        // A gap to a facing strip under GAP_MAX: asphalt (gapAt).
        const g = gapAt(k, 0, d);
        if (g > 0) { if (s <= cr + g) return 1; continue; }
        const wr = walkOf(e), back = cr + wr;
        if (supAt(geo, e, 0, d)) continue;
        // (A side with no sidewalk gets no raised fill either: a narrow
        // gap beside a bare curb is the net's, flat asphalt.)
        if (s <= back || (fills && wr > 0 && (s <= back + fillAt(k, 0, d) || (fills !== 1 && closes(k, x, z, s - back, 1, fills === true ? 2 : 1))))) side = true;
        continue;
      }
      const gl = gapAt(k, 1, d);
      if (gl > 0) { if (s >= cl - gl) return 1; continue; }
      if (supAt(geo, e, 1, d)) continue;
      const m = medianBand(e) > 0;
      const wl = m ? medianAt(city, e, d, cl) : walkLeftOf(e), back = cl - wl;
      if (s >= back) { if (m) median = true; else side = true; } else if (fills && wl > 0 && (s >= back - fillAt(k, 1, d) || (fills !== 1 && closes(k, x, z, back - s, -1, fills === true ? 2 : 1)))) side = true;
    }
    return median ? 3 : side ? 2 : 0;
  }

  // Sliver fills (docs/PLAN_V3.md 13 item 6): where more road space lies
  // within FILL_MAX m beyond the back of an edge's sidewalk or median, the
  // ground between is raised concrete too (drawn by render/citymesh.js
  // from fillOf), so no strip of ground under 1.5 m is left between two
  // roads. Per edge, sampled every FILL_STEP m from strip end to strip end,
  // right side then left; computed the first time it is asked for.
  const fillCache = new Map();
  const NOFILL = new Float32Array(0);
  // (Samples are worked out one at a time when first needed, so no call
  // costs more than a couple of samples; fillOf, for the meshes, works
  // out all of an edge's in its tile's build slice.)
  // Facing strips (docs/PLAN_V3.md 13, ROADS pass 3): along each curb, in
  // FILL_STEP stations, the gap to the nearest curb of another strip that
  // faces it (within 25 degrees of parallel either way) when under GAP_MAX
  // m. That gap is asphalt: no sidewalk, median or fill on that side, so
  // two strips that fork or run close read as one widening surface.
  // Per edge, right then left; a station is worked out when first asked.
  const gapCache = new Map();
  function gapArr(k) {
    let f = gapCache.get(k);
    if (f) return f;
    const e = edges[k];
    if (geo.inner[k] || e.ped) { gapCache.set(k, NOFILL); return NOFILL; }
    const n = Math.max(1, Math.ceil((len[k] - geo.trim[2 * k + 1] - geo.trim[2 * k]) / FILL_STEP)) + 1;
    f = new Float32Array(2 * n).fill(NaN);
    gapCache.set(k, f);
    return f;
  }
  function gapStation(k, f, i) {
    f[2 * i] = f[2 * i + 1] = 0;
    const e = edges[k];
    const d0 = geo.trim[2 * k], d1 = len[k] - geo.trim[2 * k + 1];
    const d = Math.min(d1, d0 + i * FILL_STEP);
    const C = curbsAt(geo, e, d);
    const cl = C.l, cr = C.r;
    for (let side = 0; side < 2; side++) {
      const o = side ? cl : cr, dir = side ? -1 : 1;
      const x = ax[k] + ux[k] * d - uz[k] * o, z = az[k] + uz[k] * d + ux[k] * o;
      const nx = -uz[k] * dir, nz = ux[k] * dir;
      const cx = Math.floor(x / CELL), cz = Math.floor(z / CELL), ci = cx - gx0, cj = cz - gz0;
      if (ci < 0 || cj < 0 || ci >= W || cj >= H) continue;
      const c = cj * W + ci;
      const es = cellE[c] || build(c, cx, cz);
      let best = Infinity;
      for (let q = 0; q < es.length; q++) {
        const k2 = es[q];
        if (k2 === k || geo.inner[k2] || edges[k2].ped || !!edges[k2].bridge !== !!e.bridge) continue;
        if (Math.abs(ux[k] * ux[k2] + uz[k] * uz[k2]) < GAP_COS) continue;
        const out = hw[k2] + Math.abs(edges[k2].off || 0) + Math.abs(geo.eoff[k2]) + GAP_MAX + 1;
        if (segD2(x, z, k2) > out * out) continue;
        const d2 = (x - ax[k2]) * ux[k2] + (z - az[k2]) * uz[k2];
        if (d2 < geo.trim[2 * k2] - 1 || d2 > len[k2] - geo.trim[2 * k2 + 1] + 1) continue;
        const s2 = -(x - ax[k2]) * uz[k2] + (z - az[k2]) * ux[k2];
        const C2 = curbsAt(geo, edges[k2], Math.max(0, Math.min(len[k2], d2)));
        const facing = nx * -uz[k2] + nz * ux[k2];
        let g;
        if (s2 > C2.r && facing < 0) g = s2 - C2.r;
        else if (s2 < C2.l && facing > 0) g = C2.l - s2;
        else continue;
        if (g < best) best = g;
      }
      if (best <= GAP_MAX && best > 0.02) f[2 * i + side] = best + 0.05;
    }
  }
  function gapAt(k, side, d) {
    const f = gapArr(k);
    if (!f.length) return 0;
    const d0 = geo.trim[2 * k], d1 = len[k] - geo.trim[2 * k + 1];
    if (d < d0 - 0.01 || d > d1 + 0.01) return 0;
    const n = f.length / 2;
    const i = Math.min(n - 1, Math.max(0, Math.floor((d - d0) / FILL_STEP))), j = Math.min(n - 1, i + 1);
    if (Number.isNaN(f[2 * i])) gapStation(k, f, i);
    if (Number.isNaN(f[2 * j])) gapStation(k, f, j);
    return Math.max(f[2 * i + side], f[2 * j + side]);
  }
  function gapOf(k) {
    const f = gapArr(k);
    for (let i = 0; i < f.length / 2; i++) if (Number.isNaN(f[2 * i])) gapStation(k, f, i);
    return f;
  }

  function fillArr(k) {
    let f = fillCache.get(k);
    if (f) return f;
    const e = edges[k];
    if (geo.inner[k] || e.bridge || e.causeway || e.ped) { fillCache.set(k, NOFILL); return NOFILL; }
    const n = Math.max(1, Math.ceil((len[k] - geo.trim[2 * k + 1] - geo.trim[2 * k]) / FILL_STEP)) + 1;
    f = new Float32Array(2 * n).fill(NaN);
    fillCache.set(k, f);
    return f;
  }
  function fillOf(k) {
    const f = fillArr(k);
    for (let i = 0; i < f.length / 2; i++) if (Number.isNaN(f[2 * i])) station(k, f, i);
    return f;
  }
  function station(k, f, i) {
    const e = edges[k];
    const qa = 2 * k, qb = qa + 1;
    const d0 = geo.trim[qa], d1 = len[k] - geo.trim[qb];
    f[2 * i] = f[2 * i + 1] = 0;
    {
      const d = Math.min(d1, d0 + i * FILL_STEP);
      const C = curbsAt(geo, e, d);
      const cl = C.l, cr = C.r;
      const backR = cr + walkOf(e), backL = cl - (medianBand(e) > 0 ? medianAt(city, e, d, cl) : walkLeftOf(e));
      for (let side = 0; side < 2; side++) {
        if (supAt(geo, e, side, d) || gapAt(k, side, d) > 0) continue;
        const b = side ? backL : backR, dir = side ? -1 : 1;
        // (No fill beside a bare curb: see geoSurface.)
        if (side ? !(cl - backL > 0) : !(backR - cr > 0)) continue;
        const bx = ax[k] + ux[k] * d - uz[k] * b, bz = az[k] + uz[k] * d + ux[k] * b;
        // (None where the back of sidewalk is already on road space.)
        if (baseSurface(bx + -uz[k] * dir * 0.05, bz + ux[k] * dir * 0.05) !== 0) continue;
        let gap = gapFrom(k, bx, bz, -uz[k] * dir, ux[k] * dir);
        if (!(gap > 0) && GAP.near) {
          // Other road space in reach that the outer edges did not explain
          // (a sidewalk corner, a strip end): probe out along the normal.
          let open = false;
          for (let t = 0.05; t < FILL_MAX + 0.2; t += 0.2) {
            const o = b + dir * t;
            const x = ax[k] + ux[k] * d - uz[k] * o, z = az[k] + uz[k] * d + ux[k] * o;
            if (baseSurface(x, z) === 0) open = true;
            else if (open) { gap = t; break; }
          }
        }
        if (gap > 0) f[2 * i + side] = gap + 0.1;
      }
    }
  }
  // Fill width at d m along edge k on side 0 (right) or 1 (left), linear
  // between samples.
  function fillAt(k, side, d) {
    const f = fillArr(k);
    if (!f.length) return 0;
    const d0 = geo.trim[2 * k];
    const u = (d - d0) / FILL_STEP;
    if (u < 0 || u > f.length / 2 - 1 + 1e-9) {
      const d1 = len[k] - geo.trim[2 * k + 1];
      if (u < 0 || d > d1) return 0;
    }
    const n = f.length / 2;
    const i = Math.min(n - 1, Math.max(0, Math.floor(u)));
    const j = Math.min(n - 1, i + 1);
    // The last sample sits at the strip end, less than a step after the one before.
    const di = d0 + i * FILL_STEP, dj = j === n - 1 ? len[k] - geo.trim[2 * k + 1] : d0 + j * FILL_STEP;
    const w = dj > di ? Math.max(0, Math.min(1, (d - di) / (dj - di))) : 0;
    if (Number.isNaN(f[2 * i])) station(k, f, i);
    if (Number.isNaN(f[2 * j])) station(k, f, j);
    // (The wider of the two samples, over the whole step: a gap that
    // opens between two samples is still covered.)
    return w > 0 || i === j ? Math.max(f[2 * i + side], f[2 * j + side]) : f[2 * i + side];
  }
  // The open gap (m, along the outward normal nx, nz) from (x, z) to the
  // nearest other road space, when under FILL_MAX; else 0. Analytic: the
  // outer edges (back of sidewalk or median) of the edges near, and the
  // junction rings.
  const GAP = { near: false };
  function gapFrom(k, x, z, nx, nz) {
    GAP.near = false;
    const cx = Math.floor(x / CELL), cz = Math.floor(z / CELL);
    const i = cx - gx0, j = cz - gz0;
    if (i < 0 || j < 0 || i >= W || j >= H) return 0;
    const c = j * W + i;
    const es = cellE[c] || build(c, cx, cz);
    let best = Infinity;
    for (let q = 0; q < es.length; q++) {
      const k2 = es[q];
      if (k2 === k || geo.inner[k2]) continue;
      const e2 = edges[k2];
      const out = reach[k2] / 1.6 + FILL_MAX;
      if (segD2(x, z, k2) > out * out) continue;
      GAP.near = true;
      const d2 = (x - ax[k2]) * ux[k2] + (z - az[k2]) * uz[k2];
      const qa = 2 * k2, qb = qa + 1;
      const s2 = -(x - ax[k2]) * uz[k2] + (z - az[k2]) * ux[k2];
      // Within that edge's span (a junction end: from its node, as the
      // ground's bands run).
      const lo = geo.jEnd[qa] >= 0 ? 0 : geo.trim[qa] + geo.miter[qa] * s2, hi = geo.jEnd[qb] >= 0 ? len[k2] : len[k2] - geo.trim[qb] + geo.miter[qb] * s2;
      if (d2 < lo - 1 || d2 > hi + 1) continue;
      const C = curbsAt(geo, e2, d2);
      const cl = C.l, cr = C.r;
      const oR = cr + walkOf(e2), oL = cl - (medianBand(e2) > 0 ? medianAt(city, e2, d2, cl) : walkLeftOf(e2));
      if (s2 <= oR && s2 >= oL) continue;
      const right = s2 > oR;
      let g = right ? s2 - oR : oL - s2;
      const cos = (right ? -1 : 1) * (nx * -uz[k2] + nz * ux[k2]);
      // Along our own normal (facing it: cos > 0).
      if (cos < 0.2) continue;
      g /= cos;
      if (g < best) best = g;
    }
    const js = cellJ[c];
    for (let q = 0; q < js.length; q++) {
      const J = geo.junctions[js[q]];
      if (x < J.x0 - FILL_MAX || x > J.x1 + FILL_MAX || z < J.z0 - FILL_MAX || z > J.z1 + FILL_MAX) continue;
      // March out along the normal to the ring (0.2 m steps).
      for (let t = 0.1; t < Math.min(best, FILL_MAX + 0.2); t += 0.2) {
        if (inJunctionArea(J, x + nx * t, z + nz * t)) { best = t; break; }
      }
    }
    return best < FILL_MAX + 0.15 && best > 0.15 ? best : 0;
  }
  // Exact close, per query: a point `t` m beyond the back of edge k's
  // sidewalk or median (dir 1 right, -1 left) is filled when more road
  // space lies within CLOSE_MAX m of that back along the edge's normal. The
  // sampled fills above cover almost all of it; this makes it certain, so
  // no strip of ground under 1.5 m is left between two roads (test (d)).
  // Only points in that narrow band pay for the few extra probes.
  const CLOSE_MAX = 1.8, CLOSE_STEP = 0.25;
  function closes(k, x, z, t, dir, level) {
    if (!(t > 0) || t > CLOSE_MAX) return false;
    const nx = -uz[k] * dir, nz = ux[k] * dir;
    for (let g = CLOSE_STEP; t + g <= CLOSE_MAX + 1e-9; g += CLOSE_STEP) {
      if (probeSurface(x + nx * g, z + nz * g, level) !== 0) return true;
    }
    return false;
  }
  // Road space as the close sees it: strips, sidewalks, medians and the
  // sampled fills; level 2 also sees other edges' closes (whose own probes
  // then run at level 1: one step of chaining, no deeper).
  function probeSurface(x, z, level) {
    const cx = Math.floor(x / CELL), cz = Math.floor(z / CELL);
    const i = cx - gx0, j = cz - gz0;
    if (i < 0 || j < 0 || i >= W || j >= H) return 0;
    const c = j * W + i;
    if (!cellE[c]) build(c, cx, cz);
    return geoSurface(x, z, c, level);
  }
  function baseSurface(x, z) {
    const cx = Math.floor(x / CELL), cz = Math.floor(z / CELL);
    const i = cx - gx0, j = cz - gz0;
    if (i < 0 || j < 0 || i >= W || j >= H) return 0;
    const c = j * W + i;
    if (!cellE[c]) build(c, cx, cz);
    return geoSurface(x, z, c, false);
  }

  // The narrow-gap net: ground that is off every road but has road space
  // on two opposite sides within NET_MAX m (2.75) of each other (in one of four
  // directions) is road space too, flat like asphalt. It catches what the per-edge rules above leave at strip
  // ends and suppressed sides, so no strip of ground under 1.5 m survives
  // between two roads. Only points within reach of an edge get here;
  // results are kept in a small cache on a 0.25 m lattice.
  const NET_MAX = 2.0, NET_STEP = 0.25, NET_CAP = 20000;
  const NET_DIRS = [1, 0, 0, 1, Math.SQRT1_2, Math.SQRT1_2, Math.SQRT1_2, -Math.SQRT1_2];
  const netCache = new Map(), netCache1 = new Map();
  // Two rounds: the second sees what the first filled, so a fill never
  // leaves a new narrow strip beside itself.
  const net1 = (x, z) => baseSurface(x, z) || netRound(x, z, netCache1, baseSurface);
  function netAt(x, z) {
    return netRound(x, z, netCache, net1);
  }
  function netRound(x, z, cache, probe) {
    const qx = Math.round(x / NET_STEP), qz = Math.round(z / NET_STEP);
    const key = qx * 131071 + qz;
    const hit = cache.get(key);
    if (hit !== undefined) return hit;
    // Worked out at the lattice point, so the answer is one value per cell
    // whatever point of the cell asked first.
    x = qx * NET_STEP;
    z = qz * NET_STEP;
    let out = probe === baseSurface ? 0 : probe(x, z);
    for (let q = 0; q < 8 && !out; q += 2) {
      const ux2 = NET_DIRS[q], uz2 = NET_DIRS[q + 1];
      let a = 0;
      for (let g = NET_STEP / 2; g <= NET_MAX; g += NET_STEP / 2) {
        if (probe(x + ux2 * g, z + uz2 * g)) { a = g; break; }
      }
      if (!a) continue;
      for (let g = NET_STEP / 2; a + g <= NET_MAX + 1e-9; g += NET_STEP / 2) {
        const sb = probe(x - ux2 * g, z - uz2 * g);
        // Flat road ground whatever lies each side: the fill is not drawn
        // as a raised strip, so it must not be an unseen curb step either.
        if (sb) { out = 1; break; }
      }
    }
    if (cache.size >= NET_CAP) cache.clear();
    cache.set(key, out);
    return out;
  }

  // The net as rectangles, for the meshes (render/citymesh.js netRoads):
  // the lattice cells of the box x0..x1, z0..z1 (cell centers; x1, z1
  // exclusive) that the per-edge rules leave off the road but netAt
  // fills, merged along x and then down z into [xa, za, xb, zb] quads
  // pushed on `out` (not cleared). The same lattice and the same netAt as
  // the physics, so what is drawn as asphalt is what drives as road.
  // Found from seeds on a 1 m lattice (every fourth point each way, the
  // same points whatever the box) and grown over their neighbors, so a
  // patch is drawn whole; one that holds no seed point (under 1 m2 or so)
  // is not drawn. A seed is only tried where two roads (or a road and a
  // junction) come within reach: a net cell has road space on two sides.
  const NQ_SEED = 4, NQ_SLACK = 0.3;
  const nqSeen = new Set(), nqCells = [], nqStack = [], nqOpen = [];
  // Could (x, z) be net ground? Road space of two roads (strips with their
  // sidewalk, median and fill, or a junction's box) within NET_MAX, one
  // of them within half of it.
  function twoRoads(x, z, slack) {
    const cx = Math.floor(x / CELL), cz = Math.floor(z / CELL);
    const i = cx - gx0, j = cz - gz0;
    if (i < 0 || j < 0 || i >= W || j >= H) return false;
    const c = j * W + i;
    const es = cellE[c] || build(c, cx, cz);
    const far = NET_MAX + NQ_SLACK + slack, close = NET_MAX / 2 + NQ_SLACK + slack;
    let n = 0, best = Infinity;
    const js = cellJ[c];
    for (let q = 0; q < js.length; q++) {
      const J = geo.junctions[js[q]];
      if (x < J.x0 - far || x > J.x1 + far || z < J.z0 - far || z > J.z1 + far) continue;
      const dd = inJunctionArea(J, x, z) ? 0 : ringDist(J.ring, x, z);
      if (dd > far) continue;
      n++;
      if (dd < best) best = dd;
    }
    for (let q = 0; q < es.length; q++) {
      const k = es[q];
      if (geo.inner[k]) continue;
      const d = (x - ax[k]) * ux[k] + (z - az[k]) * uz[k];
      if (d < -far || d > len[k] + far) continue;
      const s = -(x - ax[k]) * uz[k] + (z - az[k]) * ux[k];
      if (s > reach[k] + far || s < -reach[k] - far) continue;
      const e = edges[k];
      const C = curbsAt(geo, e, d < 0 ? 0 : d > len[k] ? len[k] : d);
      // (Past the side's sidewalk or median band.)
      const over = s > C.r ? s - C.r - walkOf(e) : C.l - s - Math.max(walkLeftOf(e), medianBand(e));
      const along = d < 0 ? -d : d > len[k] ? d - len[k] : 0;
      const dd = over > along ? over : along;
      if (dd > far) continue;
      n++;
      if (dd < best) best = dd;
    }
    return n >= 2 && best <= close;
  }
  const nqIs = (qx, qz) => {
    const x = qx * NET_STEP, z = qz * NET_STEP;
    return baseSurface(x, z) === 0 && baseAt(x, z) === 0 && netAt(x, z) !== 0;
  };
  function netQuads(x0, z0, x1, z1, out) {
    if (!geo) return out;
    const S = NET_STEP;
    const qx0 = Math.ceil(x0 / S - 1e-9), qx1 = Math.ceil(x1 / S - 1e-9), qz0 = Math.ceil(z0 / S - 1e-9), qz1 = Math.ceil(z1 / S - 1e-9);
    if (qx1 <= qx0 || qz1 <= qz0) return out;
    const nx = qx1 - qx0;
    nqSeen.clear();
    nqCells.length = 0;
    // Seeds on a 1 m lattice (the same points whatever the box), tried
    // only in the 4 m squares two roads can reach.
    const SQ = 4 * NQ_SEED;
    for (let sz = Math.floor(qz0 / SQ) * SQ; sz < qz1; sz += SQ) {
      for (let sx = Math.floor(qx0 / SQ) * SQ; sx < qx1; sx += SQ) {
        if (!twoRoads((sx + SQ / 2) * S, (sz + SQ / 2) * S, SQ * S * 0.71)) continue;
        for (let qz = Math.max(sz, Math.ceil(qz0 / NQ_SEED) * NQ_SEED); qz < sz + SQ && qz < qz1; qz += NQ_SEED) {
          for (let qx = Math.max(sx, Math.ceil(qx0 / NQ_SEED) * NQ_SEED); qx < sx + SQ && qx < qx1; qx += NQ_SEED) {
            const key = (qz - qz0) * nx + (qx - qx0);
            if (nqSeen.has(key)) continue;
            nqSeen.add(key);
            if (!twoRoads(qx * S, qz * S, 0) || !nqIs(qx, qz)) continue;
            nqStack.length = 0;
            nqStack.push(qx, qz);
            while (nqStack.length) {
              const pz = nqStack.pop(), px = nqStack.pop();
              nqCells.push((pz - qz0) * nx + (px - qx0));
              for (let n = 0; n < 4; n++) {
                const ex = px + (n === 0 ? 1 : n === 1 ? -1 : 0), ez = pz + (n === 2 ? 1 : n === 3 ? -1 : 0);
                if (ex < qx0 || ex >= qx1 || ez < qz0 || ez >= qz1) continue;
                const k2 = (ez - qz0) * nx + (ex - qx0);
                if (nqSeen.has(k2)) continue;
                nqSeen.add(k2); // (tried: a miss is not tried again)
                if (nqIs(ex, ez)) nqStack.push(ex, ez);
              }
            }
          }
        }
      }
    }
    if (!nqCells.length) return out;
    // Runs along x, then runs of one extent merged down z.
    nqCells.sort((a, b) => a - b);
    nqOpen.length = 0; // open quads: first column, end column, first row
    const emit = (a, end) => out.push((qx0 + nqOpen[a] - 0.5) * S, (qz0 + nqOpen[a + 2] - 0.5) * S, (qx0 + nqOpen[a + 1] - 0.5) * S, (qz0 + end - 0.5) * S);
    let prev = -2;
    for (let i = 0; i < nqCells.length;) {
      const r = Math.floor(nqCells[i] / nx);
      const from = nqOpen.length;
      while (i < nqCells.length && Math.floor(nqCells[i] / nx) === r) {
        const c0 = nqCells[i] - r * nx;
        let c1 = c0 + 1;
        i++;
        while (i < nqCells.length && nqCells[i] === r * nx + c1) { c1++; i++; }
        nqOpen.push(c0, c1, r);
      }
      // An open quad goes on with a run of the same extent in the next
      // row; else it ends under its last row.
      for (let a = 0; a < from; a += 3) {
        let hit = false;
        if (r === prev + 1) {
          for (let q = from; q < nqOpen.length; q += 3) {
            if (nqOpen[q] === nqOpen[a] && nqOpen[q + 1] === nqOpen[a + 1]) { nqOpen[q + 2] = nqOpen[a + 2]; hit = true; break; }
          }
        }
        if (!hit) emit(a, prev + 1);
      }
      nqOpen.copyWithin(0, from);
      nqOpen.length -= from;
      prev = r;
    }
    for (let a = 0; a < nqOpen.length; a += 3) emit(a, prev + 1);
    nqOpen.length = 0;
    return out;
  }

  // Kind of ground at (x, z): 0 off any road, 1 road, 2 sidewalk, 3 median.
  function surfaceAt(x, z) {
    const cx = Math.floor(x / CELL), cz = Math.floor(z / CELL);
    const i = cx - gx0, j = cz - gz0;
    if (i < 0 || j < 0 || i >= W || j >= H) return 0;
    const c = j * W + i;
    const es = cellE[c] || build(c, cx, cz);
    if (geo) {
      const r = geoSurface(x, z, c);
      return r === 0 && nearEdges >= 1 ? netAt(x, z) : r;
    }
    const ns = cellN[c];
    let side = false;
    for (let q = 0; q < ns.length; q++) {
      const n = nodes[ns[q]];
      const ex = Math.abs(x - n.x) - (n.hx || 0), ez = Math.abs(z - n.z) - (n.hz || 0);
      if (ex <= 0 && ez <= 0) return 1;
    }
    let road = false, median = false;
    for (let q = 0; q < es.length; q++) {
      const k = es[q];
      const d2 = segD2(x, z, k);
      const r = reach[k];
      if (d2 > r * r) continue;
      const h = hw[k];
      if (d2 <= h * h) { road = true; continue; }
      if (mh[k] > 0) {
        // Signed offset to the right of the node line: the left side of a
        // divided one-way is its median band (no sidewalk), the right side
        // its sidewalk.
        const s = -(x - ax[k]) * uz[k] + (z - az[k]) * ux[k];
        if (s < mo[k] + mh[k]) {
          if (Math.abs(s - mo[k]) <= mh[k]) median = true;
          continue;
        }
        if (d2 > (h + sidewalkOf(edges[k])) ** 2) continue;
      }
      side = true;
    }
    return road ? 1 : median ? 3 : side ? 2 : 0;
  }

  // The surface without the narrow-gap net (what the per-edge rules alone
  // give): surfaceAt differs from it exactly on net ground.
  function baseAt(x, z) {
    const cx = Math.floor(x / CELL), cz = Math.floor(z / CELL);
    const i = cx - gx0, j = cz - gz0;
    if (i < 0 || j < 0 || i >= W || j >= H) return 0;
    const c = j * W + i;
    if (!cellE[c]) build(c, cx, cz);
    return geo ? geoSurface(x, z, c) : surfaceAt(x, z);
  }

  function groundAt(x, z) {
    const s = surfaceAt(x, z);
    if (s === 2 || s === 3) return CURB_H;
    if (s === 1) return 0;
    if (shore) {
      const d = shore(x, z);
      if (d < 0) {
        const g = d * SEA_SLOPE;
        return g < SEA_FLOOR ? SEA_FLOOR : g;
      }
    }
    return 0;
  }
  return { groundAt, surfaceAt, baseAt, netQuads, fillOf: geo ? fillOf : () => NOFILL_ALL, gapOf: geo ? gapOf : () => NOFILL_ALL, gapAt: geo ? gapAt : () => 0, stats: () => ({ cells: cellE.filter(Boolean).length, W, H }) };
}

// The ground of a city, made once and kept (city.groundAt when the city
// already has one).
const cache = new WeakMap();
export function groundOf(city) {
  if (!city) return null;
  let g = cache.get(city);
  if (!g) {
    g = createGround(city);
    cache.set(city, g);
  }
  return g;
}

// city.groundAt(x, z) and city.surfaceAt(x, z), attached once (no-op when
// the city has them).
export function attachGround(city) {
  if (!city || typeof city.groundAt === 'function') return city;
  const g = groundOf(city);
  city.groundAt = g.groundAt;
  city.surfaceAt = g.surfaceAt;
  return city;
}

// The ground height function for a city (city.groundAt or the made one).
export function groundFn(city) {
  if (!city) return null;
  if (typeof city.groundAt === 'function') return city.groundAt;
  return groundOf(city).groundAt;
}
