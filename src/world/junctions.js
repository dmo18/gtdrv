// Junction geometry of a real-map road graph (docs/PLAN_V3.md 13, ROADS;
// docs/MAP.md "Junctions and strip ends"). Pure: runs in node tests, no
// three.js, no DOM. Built once per city (world/miami.js) after the cross
// sections and the divided pairs are known; the meshes (render/citymesh.js
// realRoads), the ground (world/ground.js) and traffic stop lines read it.
//
// - Junction clusters: nodes joined by an edge shorter than CLUSTER_LEN m
//   (both ends junctions), a bend node within STUB_LEN m of a junction, and
//   the two nodes where a street crosses both carriageways of a divided
//   road are one junction. Each junction is ONE asphalt polygon (`ring`),
//   built from the curb lines of the roads that meet there, with round curb
//   returns. Edges with both ends in one junction draw no strip (`inner`).
// - Every strip ends on its junction's boundary (`trim` m from the node),
//   far enough back that no two strips overlap (pairwise strip clipping)
//   and the curb return fits.
// - A bend (a node of two edges that is not a junction) joins its two strips
//   on the bisector (`miter`: the strip end lies at d = trim + miter * o for
//   the lateral offset o); where the two cross sections differ the curbs
//   taper over up to TAPER_LEN m each side (`taper`, to the mean curbs
//   `tcl`, `tcr` at the node) and lane lines that do not continue stop
//   before the taper.
// - Sidewalk corners are offsets of the curb lines: the curb return arc and
//   the back of sidewalk where the two back lines meet (`corners`).
//
// Lateral offsets are meters right of the node line seen a -> b (the edge
// frame of docs/MAP.md); along distances are meters from node a.

import { GUTTER, paintLines, divideOf } from './roadprofile.js';

export const CLUSTER_LEN = 14;
export const STUB_LEN = 8;
export const DIVIDED_LINK = 45;
export const TAPER_LEN = 10;
export const CURB_R_MIN = 1.5;
export const CURB_R_MAX = 4.5;
export const ARC_SEGS = 3;
export const MITER_MAX = Math.PI / 3;
export const TRIM_MAX = 40;
// Paint at a controlled approach (signal or stop sign): a two-line
// crosswalk (0.3 m lines) and a stop bar, distances from the strip end.
export const CW_NEAR = 0.65, CW_FAR = 3.65, CW_HW = 0.15;
export const STOP_BAR = 4.65, STOP_HW = 0.225;
// Paint lines stop this far short of an uncontrolled junction.
export const LINE_GAP = 0.4;
const PAR = (20 * Math.PI) / 180;
const STRAIGHT = (170 * Math.PI) / 180;
const REFLEX = Math.PI + (20 * Math.PI) / 180;
const TAU = Math.PI * 2;

// Sidewalk width beside an edge (0 on bridges, causeways and pedestrian
// streets, which render/citymesh.js pave curb to curb) and the median band
// an edge owns along its left curb (drawn up to 4 m).
export function walkOf(e) {
  return e.lanesF !== undefined && !e.bridge && !e.causeway && !e.ped ? e.sidewalk || 0 : 0;
}
export function medianBand(e) {
  return e.median > 0 && !e.bridge ? Math.min(e.median / 2, 4) : 0;
}
// The left curb of a divided one-way faces its partner (a median, or the
// partner's own strip where the two touch): no sidewalk there.
export function walkLeftOf(e) {
  return e.divided || medianBand(e) > 0 ? 0 : walkOf(e);
}
// The median band at d m along edge e whose left curb is at lateral lc:
// half the real distance to the partner's left curb there (the data gap
// varies along a pair; a fixed band left a sliver of ground down the
// middle or ran onto the partner), up to 4 m.
export const MEDIAN_GAP = 6;
// The distance from edge e's left curb (lateral lc) at d m along it to
// the left curb line of its partner (the other half of a divided road);
// Infinity without a partner.
export function pairGap(city, e, d, lc) {
  if (!(e.pair >= 0)) return Infinity;
  const p = city.edges[e.pair], a = city.nodes[e.a], pa = city.nodes[p.a];
  const x = a.x + e.ux * d - e.uz * lc, z = a.z + e.uz * d + e.ux * lc;
  const lat = -(x - pa.x) * p.uz + (z - pa.z) * p.ux;
  return Math.abs(lat - ((p.off || 0) - p.width / 2));
}
export function medianAt(city, e, d, lc) {
  const m = medianBand(e);
  if (!(m > 0) || !(e.pair >= 0)) return m;
  // (No median against a partner drawn as part of a junction.)
  if (city.roadGeo && city.roadGeo.inner[e.pair]) return 0;
  if (e.median > 8) return m;
  const dist = pairGap(city, e, d, lc);
  // (+0.3 m: the two halves overlap a little, so no ground shows between
  // them where the pair is not parallel.)
  // A median only where the two curbs are 6 m apart or more; nearer,
  // the gap is asphalt (world/ground.js gapAt).
  if (dist < MEDIAN_GAP) return 0;
  return Math.max(0, Math.min(4, dist / 2 + 0.3));
}
const walkR = (e) => walkOf(e);
const walkL = walkLeftOf;

function find(uf, v) {
  while (uf[v] !== v) {
    uf[v] = uf[uf[v]];
    v = uf[v];
  }
  return v;
}
// One merge pass of buildRoadGeo's clusters (a top-level loop, optimized
// on its own): two junctions that both want more than the edge between
// them has are one; so is a junction and a bend its arm runs past.
// hasArms[root]: that cluster is a junction. Returns the merges made.
function mergeClusters(nodes, edges, uf, hasArms, want) {
  let merged = 0;
  for (let k = 0; k < edges.length; k++) {
    const e = edges[k];
    const ra = find(uf, e.a), rb = find(uf, e.b);
    const ha = hasArms[ra] === 1, hb = hasArms[rb] === 1;
    if (ra === rb || e.causeway || (!ha && !hb)) continue;
    const ta = want[2 * e.id], tb = want[2 * e.id + 1];
    const both = ha && hb;
    const bend = !both && nodes[ha ? e.b : e.a].edges.length === 2;
    if ((both && ta + tb > e.length - 1 && e.length < 30) || (bend && ta + tb > e.length - 1)) { union(uf, e.a, e.b); merged++; }
  }
  return merged;
}
function union(uf, a, b) {
  const ra = find(uf, a), rb = find(uf, b);
  if (ra !== rb) uf[ra < rb ? rb : ra] = ra < rb ? ra : rb;
}

// Intersection of p + u s and q + v t: ISX.s, ISX.t; false when parallel.
const ISX = { s: 0, t: 0 };
function isect(px, pz, ux, uz, qx, qz, vx, vz) {
  const den = ux * vz - uz * vx;
  if (Math.abs(den) < 1e-6) return false;
  const wx = qx - px, wz = qz - pz;
  ISX.s = (wx * vz - wz * vx) / den;
  ISX.t = (wx * uz - wz * ux) / den;
  return true;
}

// An arm: one edge end at a junction, in its own frame: outward u, right r,
// strip middle o right of the node line, half width h, sidewalks on its
// right and left (seen outward).
let EOFF = null;
function makeArm(nodes, e, end) {
  const n = nodes[end ? e.b : e.a];
  const s = end ? -1 : 1;
  const sh = EOFF ? EOFF[e.id] : 0;
  const ux = e.ux * s, uz = e.uz * s;
  return {
    q: 2 * e.id + end, e, end, node: n.id, nx: n.x, nz: n.z, ux, uz, rx: -uz, rz: ux,
    o: ((e.off || 0) + sh) * s, h: e.width / 2, wR: end ? walkL(e) : walkR(e), wL: end ? walkR(e) : walkL(e),
    len: e.length, ang: 0, trim: 0, want: 0, shift: 0, tl: 0, partner: -1,
  };
}

// The largest distance along arm i at which its strip still meets arm j's
// strip (both from their nodes outward, up to 60 m); 0 when they do not.
const CLIP_A = new Float64Array(32), CLIP_B = new Float64Array(32);
function clipReach(A, B) {
  const SA = Math.min(A.len, 60), SB = Math.min(B.len, 60);
  // B's quad in A's frame (s along, l lateral).
  let n = 4;
  const P = CLIP_A;
  // (0.3 m in from B's curbs: two strips that only touch, the halves of a
  // paired one-way, do not count.)
  const lo = B.o - B.h + 0.3, hi = B.o + B.h - 0.3;
  // Corners (0, lo), (SB, lo), (SB, hi), (0, hi), no array made per call.
  for (let k = 0; k < 4; k++) {
    const ps = k === 1 || k === 2 ? SB : 0, pl = k < 2 ? lo : hi;
    const x = B.nx + B.ux * ps + B.rx * pl - A.nx, z = B.nz + B.uz * ps + B.rz * pl - A.nz;
    P[2 * k] = x * A.ux + z * A.uz;
    P[2 * k + 1] = x * A.rx + z * A.rz;
  }
  // Clip by A's strip: s >= 0, s <= SA, l >= o - h, l <= o + h.
  let src = P, dst = CLIP_B;
  for (let c = 0; c < 4 && n > 0; c++) {
    const axis = c < 2 ? 0 : 1, sign = c % 2 === 0 ? 1 : -1;
    const lim = c === 0 ? 0 : c === 1 ? SA : c === 2 ? A.o - A.h : A.o + A.h;
    let m = 0;
    for (let k = 0; k < n; k++) {
      const k2 = (k + 1) % n;
      const va = sign * (src[2 * k + axis] - lim), vb = sign * (src[2 * k2 + axis] - lim);
      if (va >= 0) { dst[2 * m] = src[2 * k]; dst[2 * m + 1] = src[2 * k + 1]; m++; }
      if ((va >= 0) !== (vb >= 0) && m < 15) {
        const t = va / (va - vb);
        dst[2 * m] = src[2 * k] + (src[2 * k2] - src[2 * k]) * t;
        dst[2 * m + 1] = src[2 * k + 1] + (src[2 * k2 + 1] - src[2 * k + 1]) * t;
        m++;
      }
    }
    n = m;
    const t = src; src = dst; dst = t;
  }
  let best = 0;
  for (let k = 0; k < n; k++) if (src[2 * k] > best) best = src[2 * k];
  // A sliver of contact (touching curbs) is not an overlap.
  return n >= 3 ? best : 0;
}

// The corner between arm A (its right curb) and the next arm B (its left
// curb), going round the junction toward A's right: the sector angle and,
// for a curb return, the radius, the curb line crossing P (s along each)
// and the tangent length.
function cornerOf(A, B, C) {
  const cross = A.ux * B.uz - A.uz * B.ux, dot = A.ux * B.ux + A.uz * B.uz;
  let th = Math.atan2(cross, dot);
  if (th <= 0) th += TAU;
  C.th = th;
  C.kind = 0; // 0 chord, 1 curb return, 2 outside miter
  const pax = A.nx + A.rx * (A.o + A.h), paz = A.nz + A.rz * (A.o + A.h);
  const pbx = B.nx + B.rx * (B.o - B.h), pbz = B.nz + B.rz * (B.o - B.h);
  C.pax = pax; C.paz = paz; C.pbx = pbx; C.pbz = pbz;
  // (A pedestrian street meets the junction with a straight edge.)
  if (A.e.ped || B.e.ped) return C;
  if (th > PAR && th < STRAIGHT) {
    if (!isect(pax, paz, A.ux, A.uz, pbx, pbz, B.ux, B.uz)) return C;
    if (ISX.s < -3 || ISX.t < -3 || ISX.s > TRIM_MAX || ISX.t > TRIM_MAX) return C;
    const s = Math.sin(th / 2), tn = Math.tan(th / 2);
    const w = Math.min(A.wR, B.wL);
    let R = w > 0 ? (w - 0.3 * s) / (1 - s) : 3;
    R = Math.max(CURB_R_MIN, Math.min(CURB_R_MAX, R, 10 * tn));
    C.kind = 1;
    C.R = R;
    C.T = R / tn;
    C.sa = ISX.s;
    C.sb = ISX.t;
  } else if (th > REFLEX) {
    if (!isect(pax, paz, A.ux, A.uz, pbx, pbz, B.ux, B.uz)) return C;
    C.kind = 2;
    C.sa = ISX.s;
    C.sb = ISX.t;
  }
  return C;
}

// Simple polygon test (no two non-adjacent sides cross).
function segCross(ax, az, bx, bz, cx, cz, dx, dz) {
  const d1 = (dx - cx) * (az - cz) - (dz - cz) * (ax - cx);
  const d2 = (dx - cx) * (bz - cz) - (dz - cz) * (bx - cx);
  const d3 = (bx - ax) * (cz - az) - (bz - az) * (cx - ax);
  const d4 = (bx - ax) * (dz - az) - (bz - az) * (dx - ax);
  return ((d1 > 1e-9 && d2 < -1e-9) || (d1 < -1e-9 && d2 > 1e-9)) && ((d3 > 1e-9 && d4 < -1e-9) || (d3 < -1e-9 && d4 > 1e-9));
}
export function isSimple(ring) {
  const n = ring.length / 2;
  for (let i = 0; i < n; i++) {
    const i2 = (i + 1) % n;
    for (let j = i + 2; j < n; j++) {
      const j2 = (j + 1) % n;
      if (j2 === i) continue;
      if (segCross(ring[2 * i], ring[2 * i + 1], ring[2 * i2], ring[2 * i2 + 1], ring[2 * j], ring[2 * j + 1], ring[2 * j2], ring[2 * j2 + 1])) return false;
    }
  }
  return true;
}
export function ringArea(ring) {
  let a = 0;
  const n = ring.length / 2;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    a += ring[2 * i] * ring[2 * j + 1] - ring[2 * j] * ring[2 * i + 1];
  }
  return a / 2;
}

// Ear clipping: triangles (x, z, x, z, x, z) of a simple ring, any winding.
// (The live vertices in a typed scratch list, the cross products inline:
// the same tests in the same order as with an array and splice.)
let TRI_IDX = new Int32Array(64);
const crossOf = (ring, a, b, c, sgn) => ((ring[2 * b] - ring[2 * a]) * (ring[2 * c + 1] - ring[2 * a + 1]) - (ring[2 * b + 1] - ring[2 * a + 1]) * (ring[2 * c] - ring[2 * a])) * sgn;
export function triangulate(ring) {
  const n = ring.length / 2;
  const out = [];
  if (n < 3) return out;
  if (TRI_IDX.length < n) TRI_IDX = new Int32Array(2 * n);
  const idx = TRI_IDX;
  let len = n;
  for (let i = 0; i < n; i++) idx[i] = i;
  const sgn = ringArea(ring) >= 0 ? 1 : -1;
  let guard = 0;
  while (len > 3 && guard++ < 4 * n * n) {
    let cut = false;
    for (let k = 0; k < len; k++) {
      const a = idx[(k + len - 1) % len], b = idx[k], c = idx[(k + 1) % len];
      if (crossOf(ring, a, b, c, sgn) <= 1e-9) continue;
      let inside = false;
      for (let m = 0; m < len; m++) {
        const p = idx[m];
        if (p === a || p === b || p === c) continue;
        if (crossOf(ring, a, b, p, sgn) >= -1e-9 && crossOf(ring, b, c, p, sgn) >= -1e-9 && crossOf(ring, c, a, p, sgn) >= -1e-9) { inside = true; break; }
      }
      if (inside) continue;
      out.push(ring[2 * a], ring[2 * a + 1], ring[2 * b], ring[2 * b + 1], ring[2 * c], ring[2 * c + 1]);
      idx.copyWithin(k, k + 1, len);
      len--;
      cut = true;
      break;
    }
    if (!cut) {
      // Degenerate (collinear) remainder: drop the flattest vertex.
      let bk = 0, bv = Infinity;
      for (let k = 0; k < len; k++) {
        const v = Math.abs(crossOf(ring, idx[(k + len - 1) % len], idx[k], idx[(k + 1) % len], sgn));
        if (v < bv) { bv = v; bk = k; }
      }
      idx.copyWithin(bk, bk + 1, len);
      len--;
    }
  }
  if (len === 3 && Math.abs(crossOf(ring, idx[0], idx[1], idx[2], sgn)) > 1e-9) out.push(ring[2 * idx[0]], ring[2 * idx[0] + 1], ring[2 * idx[1]], ring[2 * idx[1] + 1], ring[2 * idx[2]], ring[2 * idx[2] + 1]);
  return out;
}

// Convex hull (x, z pairs), counterclockwise in x, z.
export function hullOf(pts) {
  const P = [];
  for (let k = 0; k < pts.length; k += 2) P.push([pts[k], pts[k + 1]]);
  P.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cr = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo = [], up = [];
  for (const p of P) { while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], p) <= 0) lo.pop(); lo.push(p); }
  for (let k = P.length - 1; k >= 0; k--) { const p = P[k]; while (up.length >= 2 && cr(up[up.length - 2], up[up.length - 1], p) <= 0) up.pop(); up.push(p); }
  const out = [];
  for (const p of lo.slice(0, -1).concat(up.slice(0, -1))) out.push(p[0], p[1]);
  return out;
}
// An arm's curb (arm frame lateral) and its point at the arm's trim.
function mouthLat(PG, A, right, s = A.trim) {
  const c = curbsAt(PG, A.e, A.end ? A.e.length - s : s);
  return A.end ? (right ? -c.l : -c.r) : right ? c.r : c.l;
}
function mouth(PG, A, right, s = A.trim) {
  const o = mouthLat(PG, A, right, s);
  return [A.nx + A.ux * s + A.rx * o, A.nz + A.uz * s + A.rz * o];
}
// A fork or merge: arm B leaves just to the right of arm A (under
// GORE_TH apart). The gap between A's right curb and B's left curb is
// asphalt with a painted chevron gore out to where it is GORE_W wide;
// no sidewalk, median or fill on those two sides before that.
export const GORE_TH = (25 * Math.PI) / 180, GORE_W = 6;
function goreOf(PG, A, B) {
  const pa = [], pb = [];
  let k = 0;
  for (; k < 40; k++) {
    const sa = A.trim + 2 * k, sb = B.trim + 2 * k;
    if (sa > A.len * 0.9 || sb > B.len * 0.9) break;
    const a = mouth(PG, A, true, sa), b = mouth(PG, B, false, sb);
    pa.push(a[0], a[1]);
    pb.push(b[0], b[1]);
    if (Math.hypot(a[0] - b[0], a[1] - b[1]) >= GORE_W) break;
  }
  if (pa.length < 4) return null;
  if (Math.hypot(pa[0] - pb[0], pa[1] - pb[1]) >= GORE_W) return null;
  const m = pa.length / 2;
  const poly = pa.slice();
  for (let i = m - 1; i >= 0; i--) poly.push(pb[2 * i], pb[2 * i + 1]);
  if (!isSimple(poly)) return null;
  // White edge lines along both curbs, a chevron (apex toward the node)
  // every 4 m: [x0, z0, x1, z1, half width, ...].
  const paint = [];
  for (let i = 0; i + 1 < m; i++) {
    paint.push(pa[2 * i], pa[2 * i + 1], pa[2 * i + 2], pa[2 * i + 3], 0.1, pb[2 * i], pb[2 * i + 1], pb[2 * i + 2], pb[2 * i + 3], 0.1);
    if (i % 2 === 0) {
      const mx = (pa[2 * i] + pb[2 * i]) / 2, mz = (pa[2 * i + 1] + pb[2 * i + 1]) / 2;
      const f = 0.75;
      for (const q of [pa, pb]) {
        const ex = q[2 * i] + (q[2 * i + 2] - q[2 * i]) * f, ez = q[2 * i + 1] + (q[2 * i + 3] - q[2 * i + 1]) * f;
        paint.push(mx, mz, mx + (ex - mx) * 0.88, mz + (ez - mz) * 0.88, 0.15);
      }
    }
  }
  return {
    poly: Float64Array.from(poly), tris: Float64Array.from(triangulate(poly)), paint: Float64Array.from(paint),
    qa: A.q, sideA: A.end ? 1 : 0, la: A.trim + 2 * (m - 1), qb: B.q, sideB: B.end ? 0 : 1, lb: B.trim + 2 * (m - 1),
  };
}

function inTri(t, k, x, z) {
  const ax = t[k], az = t[k + 1], bx = t[k + 2], bz = t[k + 3], cx = t[k + 4], cz = t[k + 5];
  const d1 = (bx - ax) * (z - az) - (bz - az) * (x - ax);
  const d2 = (cx - bx) * (z - bz) - (cz - bz) * (x - bx);
  const d3 = (ax - cx) * (z - cz) - (az - cz) * (x - cx);
  return !((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0));
}
// Is (x, z) on junction J's asphalt (its ring; a fan junction: its
// triangles)?
export function inJunctionArea(J, x, z) {
  if (x < J.x0 || x > J.x1 || z < J.z0 || z > J.z1) return false;
  if (!J.fan) return pointInRing(J.ring, x, z);
  for (let k = 0; k < J.tris.length; k += 6) if (inTri(J.tris, k, x, z)) return true;
  return false;
}

export function pointInRing(ring, x, z) {
  let inside = false;
  const n = ring.length;
  for (let i = 0, j = n - 2; i < n; j = i, i += 2) {
    const zi = ring[i + 1], zj = ring[j + 1];
    if ((zi > z) !== (zj > z) && x < ((ring[j] - ring[i]) * (z - zi)) / (zj - zi) + ring[i]) inside = !inside;
  }
  return inside;
}
// Distance from (x, z) to the ring's boundary.
export function ringDist(ring, x, z) {
  let best = Infinity;
  const n = ring.length;
  for (let i = 0, j = n - 2; i < n; j = i, i += 2) {
    const ax = ring[j], az = ring[j + 1], bx = ring[i], bz = ring[i + 1];
    const dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz;
    let t = L2 > 0 ? ((x - ax) * dx + (z - az) * dz) / L2 : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const d = Math.hypot(ax + dx * t - x, az + dz * t - z);
    if (d < best) best = d;
  }
  return best;
}

// The road geometry of a city graph: { junctions, nodeJ, trim, miter,
// taper, tcl, tcr, nbr, flip, inner, jEnd, ctrl, stats }. End q = 2 * edge
// id + (0 at node a, 1 at node b).
export function buildRoadGeo(nodes, edges, edgesNear = null) {
  const NN = nodes.length, NE = edges.length;
  const eoff = sideShifts(nodes, edges, edgesNear);
  EOFF = eoff;
  const deg = (id) => nodes[id].edges.length;
  const uf = new Int32Array(NN);
  for (let i = 0; i < NN; i++) uf[i] = i;
  for (let eIdx = 0; eIdx < edges.length; eIdx++) {
    const e = edges[eIdx];
    if (e.causeway) continue;
    const da = deg(e.a), db = deg(e.b);
    if (e.length < CLUSTER_LEN && da >= 3 && db >= 3) union(uf, e.a, e.b);
    else if (e.length < STUB_LEN && ((da >= 3 && db === 2) || (db >= 3 && da === 2))) union(uf, e.a, e.b);
  }
  // A street across both carriageways of a divided road: one junction.
  const dividedAt = (id, skip, name, other) => {
    for (let kIdx = 0; kIdx < nodes[id].edges.length; kIdx++) {
      const k = nodes[id].edges[kIdx];
      const d = edges[k];
      if (d === skip || !d.divided || d.name === skip.name) continue;
      if (name === null) { if (dividedAt(other, skip, d.name, -1)) return true; } else if (d.name === name) return true;
    }
    return false;
  };
  for (let eIdx = 0; eIdx < edges.length; eIdx++) {
    const e = edges[eIdx];
    if (e.causeway || e.divided || e.length >= DIVIDED_LINK) continue;
    if (deg(e.a) < 3 || deg(e.b) < 3) continue;
    if (dividedAt(e.a, e, null, e.b)) union(uf, e.a, e.b);
  }

  const trim = new Float64Array(2 * NE), miter = new Float64Array(2 * NE), taper = new Float64Array(2 * NE);
  const tcl = new Float64Array(2 * NE), tcr = new Float64Array(2 * NE);
  const nbr = new Int32Array(2 * NE).fill(-1), flip = new Uint8Array(2 * NE), inner = new Uint8Array(NE);
  const jEnd = new Int32Array(2 * NE).fill(-1), ctrl = new Uint8Array(2 * NE), tlin = new Uint8Array(2 * NE);
  const nodeJ = new Int32Array(NN).fill(-1);
  const stats = { junctions: 0, multi: 0, hull: 0, merged: 0, bends: 0, tapers: 0, capped: 0 };

  // Clusters, then trims; an edge between two junctions that both want more
  // than it has joins them (up to 3 passes).
  let groups, arms;
  const C = {};
  // (A cluster that no pass changed keeps its arms: same root, same size.)
  const want = new Float64Array(2 * NE);
  const hasArms = new Uint8Array(NN); // 1: the root's cluster is a junction (arms.has)
  // bendIsJunction depends on the graph alone: asked once per node, not per pass.
  const bendJ = new Int8Array(NN).fill(-1);
  const isBendJ = (id) => {
    if (bendJ[id] < 0) bendJ[id] = bendIsJunction(nodes, edges, id) ? 1 : 0;
    return bendJ[id] === 1;
  };
  let prev = new Map();
  for (let pass = 0; pass < 5; pass++) {
    groups = new Map();
    for (let i = 0; i < NN; i++) {
      const r = find(uf, i);
      let g = groups.get(r);
      if (!g) groups.set(r, (g = []));
      g.push(i);
    }
    arms = new Map();
    // (Map.forEach, not for-of: no entry array per group.)
    groups.forEach((g, r) => {
      const old = prev.get(r);
      if (old && old.size === g.length) { arms.set(r, old.list); return; }
      const isJ = g.length > 1 || deg(g[0]) >= 3 || (deg(g[0]) === 2 && isBendJ(g[0]));
      if (!isJ) return;
      const list = [];
      for (let m = 0; m < g.length; m++) {
        const id = g[m], ne = nodes[id].edges;
        for (let j = 0; j < ne.length; j++) {
          const e = edges[ne[j]];
          if (find(uf, e.a) === find(uf, e.b)) continue;
          list.push(makeArm(nodes, e, e.a === id ? 0 : 1));
        }
      }
      solveTrims(list, C);
      arms.set(r, list);
    });
    prev = new Map();
    want.fill(0);
    hasArms.fill(0);
    arms.forEach((list, r) => {
      prev.set(r, { size: groups.get(r).length, list });
      hasArms[r] = 1;
      for (let m = 0; m < list.length; m++) want[list[m].q] = list[m].want;
    });
    const merged = mergeClusters(nodes, edges, uf, hasArms, want);
    stats.merged += merged;
    if (!merged) break;
  }

  // Ends capped by short edges between two junctions (before the rings, so
  // every strip end stays on its ring).
  const armAt = new Map();
  arms.forEach((list) => { for (let m = 0; m < list.length; m++) armAt.set(list[m].q, list[m]); });
  for (let eIdx = 0; eIdx < edges.length; eIdx++) {
    const e = edges[eIdx];
    const A = armAt.get(2 * e.id), B = armAt.get(2 * e.id + 1);
    if (!A || !B) continue;
    const room = e.length - 1;
    if (A.trim + B.trim > room) {
      const f = Math.max(0, room) / (A.trim + B.trim);
      A.trim *= f;
      B.trim *= f;
      stats.capped++;
    }
  }
  // Pair shifts as linear tapers of the curbs (edge frame), within the
  // room the other end leaves.
  armAt.forEach((A) => {
    if (!(A.tl > 0)) return;
    const sg = A.end ? -1 : 1, e = A.e, sh = A.shift * sg, o = (e.off || 0) + eoff[e.id];
    tcl[A.q] = o - e.width / 2 + sh;
    tcr[A.q] = o + e.width / 2 + sh;
    taper[A.q] = A.tl;
    tlin[A.q] = 1;
  });
  // Bends: mitered joins and tapers.
  for (let i = 0; i < NN; i++) {
    if (arms.has(find(uf, i)) || deg(i) !== 2) continue;
    const n = nodes[i];
    const e1 = edges[n.edges[0]], e2 = edges[n.edges[1]];
    if (e1 === e2) continue;
    const end1 = e1.b === i ? 1 : 0, end2 = e2.b === i ? 1 : 0;
    const q1 = 2 * e1.id + end1, q2 = 2 * e2.id + end2;
    // Travel through the node: into it along e1, out along e2.
    const t1x = end1 ? e1.ux : -e1.ux, t1z = end1 ? e1.uz : -e1.uz;
    const t2x = end2 ? -e2.ux : e2.ux, t2z = end2 ? -e2.uz : e2.uz;
    let cx = -t1z - t2z, cz = t1x + t2x;
    const cl = Math.hypot(cx, cz);
    if (cl < 1e-6) continue;
    cx /= cl; cz /= cl;
    const c1 = cx * -t1z + cz * t1x, c2 = cx * -t2z + cz * t2x;
    miter[q1] = (cx * t1x + cz * t1z) / c1;
    miter[q2] = (cx * t2x + cz * t2z) / c2;
    nbr[q1] = e2.id; nbr[q2] = e1.id;
    flip[q1] = flip[q2] = end1 === end2 ? 1 : 0;
    stats.bends++;
    // Curbs at the node in each edge's frame; a taper where they differ.
    const o1 = (e1.off || 0) + eoff[e1.id], o2 = (e2.off || 0) + eoff[e2.id];
    const lc1 = o1 - e1.width / 2, rc1 = o1 + e1.width / 2;
    const f = end1 === end2 ? -1 : 1;
    let lc2 = o2 - e2.width / 2, rc2 = o2 + e2.width / 2;
    if (f < 0) { const t = lc2; lc2 = -rc2; rc2 = -t; }
    if (Math.abs(lc1 - lc2) > 0.05 || Math.abs(rc1 - rc2) > 0.05) {
      const ml = (lc1 + lc2) / 2, mr = (rc1 + rc2) / 2;
      tcl[q1] = ml; tcr[q1] = mr;
      if (f < 0) { tcl[q2] = -mr; tcr[q2] = -ml; } else { tcl[q2] = ml; tcr[q2] = mr; }
      taper[q1] = Math.min(TAPER_LEN, 0.4 * e1.length);
      taper[q2] = Math.min(TAPER_LEN, 0.4 * e2.length);
      stats.tapers++;
    }
  }
  // The rings read the curbs as the strips draw them (tapers included).
  const PG = { taper, tcl, tcr, tlin, eoff };
  // Per end and side (q * 2 + 0 right, 1 left, edge frame): no sidewalk,
  // median or fill within this many m of that end's node (gores, noses).
  const sup = new Float64Array(4 * NE);
  const mthru = new Uint8Array(2 * NE);
  const junctions = [];
  groups.forEach((g, r) => {
    const list = arms.get(r);
    if (!list) return;
    for (let m = 0; m < g.length; m++) {
      const ne = nodes[g[m]].edges;
      for (let j = 0; j < ne.length; j++) { const k = ne[j]; if (find(uf, edges[k].a) === find(uf, edges[k].b)) inner[k] = 1; }
    }
    let J = buildJunction(junctions.length, nodes, g, list, C, PG);
    // A ring that crosses itself: the arms a little longer, a few times.
    for (let t = 0; t < 6 && J.hull; t++) {
      for (const A of list) {
        const O = armAt.get(A.q ^ 1);
        A.trim = Math.max(A.trim, Math.min(A.trim + 1.5, TRIM_MAX, A.len - 1 - (O ? O.trim : 0)));
      }
      J = buildJunction(junctions.length, nodes, g, list, C, PG);
    }
    if (J.hull) {
      // Still crossing itself: the ring is the convex hull of the arm
      // mouths, each arm drawn out until both its curbs reach the hull.
      const keep = list.map((A) => A.trim);
      for (let it = 0; it < 4; it++) {
        const pts = [];
        for (const A of list) pts.push(...mouth(PG, A, false), ...mouth(PG, A, true));
        const H = hullOf(pts), nh = H.length / 2;
        let moved = false;
        for (const A of list) {
          const O = armAt.get(A.q ^ 1), cap = Math.min(TRIM_MAX + 10, A.len - 1 - (O ? O.trim : 0));
          let need = A.trim;
          for (const right of [false, true]) {
            const p = mouth(PG, A, right);
            if (ringDist(H, p[0], p[1]) <= 0.2) continue;
            const o = mouthLat(PG, A, right);
            const px = A.nx + A.rx * o, pz = A.nz + A.rz * o;
            for (let h = 0; h < nh; h++) {
              const h2 = (h + 1) % nh;
              if (!isect(px, pz, A.ux, A.uz, H[2 * h], H[2 * h + 1], H[2 * h2] - H[2 * h], H[2 * h2 + 1] - H[2 * h + 1])) continue;
              if (ISX.t >= -1e-6 && ISX.t <= 1 + 1e-6 && ISX.s + 0.02 > need) need = ISX.s + 0.02;
            }
          }
          need = Math.min(need, cap);
          if (need > A.trim + 0.01) { A.trim = need; moved = true; }
        }
        if (!moved) break;
      }
      const H = buildJunction(junctions.length, nodes, g, list, C, PG, true);
      // (Kept only when every mouth reached the hull; else the fan stays.)
      let onHull = true;
      for (const A of list) for (const right of [false, true]) { const p = mouth(PG, A, right); if (ringDist(H.ring, p[0], p[1]) > 0.25) onHull = false; }
      if (onHull) J = H;
      else {
        list.forEach((A, i) => { A.trim = keep[i]; });
        stats.fanKept = (stats.fanKept || 0) + 1;
      }
    }
    J = finishJunction(J);
    for (const G of J.gores) {
      sup[2 * G.qa + G.sideA] = Math.max(sup[2 * G.qa + G.sideA], G.la);
      sup[2 * G.qb + G.sideB] = Math.max(sup[2 * G.qb + G.sideB], G.lb);
    }
    // Median noses stop 2 m short of the junction.
    // (Not where nothing leaves the junction on the median's side: a
    // street that ends at one half of a divided road, a T. The median
    // runs on past it, `mthru`, and the meshes carry it through.)
    for (let armIdx = 0; armIdx < list.length; armIdx++) {
      const A = list[armIdx];
      if (!(medianBand(A.e) > 0)) continue;
      const sg = A.end ? 1 : -1;
      let crossed = false;
      for (let m = 0; m < list.length; m++) { const B = list[m]; if (B !== A && (B.ux * A.rx + B.uz * A.rz) * sg > 0.35) { crossed = true; break; } }
      if (crossed || list.length < 2) sup[2 * A.q + 1] = Math.max(sup[2 * A.q + 1], A.trim + 2);
      else mthru[A.q] = 1;
    }
    for (let m = 0; m < g.length; m++) nodeJ[g[m]] = J.id;
    for (let armIdx = 0; armIdx < list.length; armIdx++) {
      const A = list[armIdx];
      trim[A.q] = A.trim;
      jEnd[A.q] = J.id;
    }
    junctions.push(J);
    if (g.length > 1) stats.multi++;
    if (J.hull) stats.hull++;
  });
  stats.junctions = junctions.length;
  // Controlled approaches: a signal or stop sign at the junction, 3+ arms.
  for (let jIdx = 0; jIdx < junctions.length; jIdx++) {
    const J = junctions[jIdx];
    if (!(J.signal || J.stop) || J.arms.length < 3) continue;
    for (let qIdx = 0; qIdx < J.arms.length; qIdx++) {
      const q = J.arms[qIdx];
      const e = edges[q >> 1];
      if (!e.causeway && !e.ped && !e.bridge) ctrl[q] = 1;
    }
  }
  // Dead ends: the strip runs 1.5 m past its node, so a stub that stops
  // just short of another road's sidewalk meets it (no sliver between).
  for (let i = 0; i < NN; i++) {
    if (deg(i) !== 1 || nodeJ[i] >= 0) continue;
    const e = edges[nodes[i].edges[0]];
    trim[2 * e.id + (e.b === i ? 1 : 0)] = -1.5;
  }
  // The junctions by 32 m cell of their boxes (junctionsAt).
  const jGrid = new Map();
  for (let jIdx = 0; jIdx < junctions.length; jIdx++) {
    const J = junctions[jIdx];
    for (let i = Math.floor(J.x0 / JCELL); i <= Math.floor(J.x1 / JCELL); i++) {
      for (let j = Math.floor(J.z0 / JCELL); j <= Math.floor(J.z1 / JCELL); j++) {
        const k = i * 100003 + j;
        let l = jGrid.get(k);
        if (!l) jGrid.set(k, (l = []));
        l.push(J);
      }
    }
  }
  return { junctions, nodeJ, trim, miter, taper, tcl, tcr, tlin, nbr, flip, inner, jEnd, ctrl, stats, jGrid, eoff, sup, mthru };
}

// Two one-way ways in the same direction drawn over each other (a turn
// roadway beside its street, a duplicated way): each is drawn moved away
// from the other by half the overlap (per edge, m right of its node line;
// the edge's own `off` is the contract's and stays). Needs the city's
// edgesNear; none without it.
function sideShifts(nodes, edges, edgesNear) {
  const out = new Float64Array(edges.length);
  if (!edgesNear) return out;
  const near = [];
  for (let eIdx = 0; eIdx < edges.length; eIdx++) {
    const e = edges[eIdx];
    if (!e.oneway || e.causeway || e.pair >= 0 || e.bridge) continue;
    const a = nodes[e.a], b = nodes[e.b];
    const mx = (a.x + b.x) / 2, mz = (a.z + b.z) / 2;
    edgesNear(mx, mz, 20, near);
    let shift = 0;
    for (let i = 0; i < near.length; i++) {
      const o = edges[near[i]];
      if (o === e || !o.oneway || o.pair >= 0 || o.bridge || e.ux * o.ux + e.uz * o.uz < 0.95) continue;
      if (o.a === e.a && o.b === e.b) continue;
      const oa = nodes[o.a];
      const t = (mx - oa.x) * o.ux + (mz - oa.z) * o.uz;
      if (t < 0 || t > o.length) continue;
      const lat = (oa.x + o.ux * t - mx) * -e.uz + (oa.z + o.uz * t - mz) * e.ux;
      const over = (e.width + o.width) / 2 - Math.abs(lat);
      if (over > 0.3 && over / 2 > Math.abs(shift)) shift = lat > 0 ? -over / 2 : over / 2;
    }
    out[e.id] = shift;
  }
  return out;
}

// A node of two edges is a junction when the road turns sharply there or
// the two edges are one pair of nodes twice.
function bendIsJunction(nodes, edges, id) {
  const n = nodes[id];
  const e1 = edges[n.edges[0]], e2 = edges[n.edges[1]];
  if (e1 === e2) return false;
  const o1 = e1.a === id ? e1.b : e1.a, o2 = e2.a === id ? e2.b : e2.a;
  if (o1 === o2) return true;
  const t1x = e1.b === id ? e1.ux : -e1.ux, t1z = e1.b === id ? e1.uz : -e1.uz;
  const t2x = e2.a === id ? e2.ux : -e2.ux, t2z = e2.a === id ? e2.uz : -e2.uz;
  const dot = t1x * t2x + t1z * t2z;
  if (dot < Math.cos(MITER_MAX)) return true;
  // The mitered ends reach tan(half the turn) times the half width past
  // the node: not more than 0.4 of either edge.
  const k = Math.tan(Math.acos(Math.max(-1, Math.min(1, dot))) / 2);
  const reach = (e) => k * (e.width / 2 + Math.abs(e.off || 0) + Math.max(walkOf(e), medianBand(e)));
  return reach(e1) > 0.4 * e1.length || reach(e2) > 0.4 * e2.length;
}


// Arms in order round the junction, and their trims.
function solveTrims(list, C) {
  let cx = 0, cz = 0;
  for (let i = 0; i < list.length; i++) { cx += list[i].nx; cz += list[i].nz; }
  cx /= list.length || 1; cz /= list.length || 1;
  let rad = 0;
  for (let i = 0; i < list.length; i++) rad = Math.max(rad, Math.hypot(list[i].nx - cx, list[i].nz - cz));
  const D = rad + 15;
  for (let i = 0; i < list.length; i++) { const A = list[i]; A.ang = Math.atan2(A.nz + A.uz * D + A.rz * A.o - cz, A.nx + A.ux * D + A.rx * A.o - cx); }
  list.sort((a, b) => a.ang - b.ang || a.q - b.q);
  pairShifts(list);
  // Two arms moved side by side keep that order round the junction (the
  // left one first: the order runs toward each arm's right).
  for (let i = 0; i < list.length; i++) {
    const A = list[i], j = (i + 1) % list.length, B = list[j];
    if (A.partner === B.q && A.shift > 0 && list.length > 2) { list[i] = B; list[j] = A; }
  }
  for (let i = 0; i < list.length; i++) list[i].trim = list.length > 1 ? 0.5 : 0;
  for (let i = 0; i < list.length; i++) {
    for (let j = 0; j < list.length; j++) {
      if (i === j || list[i].partner === list[j].q) continue;
      const t = clipReach(list[i], list[j]);
      if (t + 0.3 > list[i].trim) list[i].trim = t + 0.3;
    }
  }
  if (list.length > 1) {
    for (let i = 0; i < list.length; i++) {
      const A = list[i], B = list[(i + 1) % list.length];
      cornerOf(A, B, C);
      if (C.kind !== 1) continue;
      A.trim = Math.max(A.trim, C.sa + C.T + 0.2);
      B.trim = Math.max(B.trim, C.sb + C.T + 0.2);
    }
  }
  for (let armIdx = 0; armIdx < list.length; armIdx++) {
    const A = list[armIdx];
    A.want = A.trim;
    A.trim = Math.min(A.trim, TRIM_MAX, Math.max(0.5, A.len - 1));
  }
}

// Two arms leaving a junction side by side whose node lines converge
// there (the halves of a paired one-way, a fork) overlap for tens of
// meters: each is
// moved sideways at the node (half the overlap each, back to its own line
// over `tl` m, linearly) so the two meet curb to curb (one surface).
const PAIR_COS = Math.cos((25 * Math.PI) / 180);
function pairShifts(list) {
  for (let armIdx = 0; armIdx < list.length; armIdx++) {
    const A = list[armIdx];
    if (A.partner >= 0 || A.e.median > 0) continue;
    for (let otherIdx = 0; otherIdx < list.length; otherIdx++) {
      const B = list[otherIdx];
      if (B === A || B.partner >= 0 || B.e.median > 0 || B.e.name !== A.e.name) continue;
      const dot = A.ux * B.ux + A.uz * B.uz;
      if (dot < PAIR_COS) continue;
      const cB = (B.nx + B.rx * B.o - A.nx) * A.rx + (B.nz + B.rz * B.o - A.nz) * A.rz;
      const right = cB > A.o;
      const ov = right ? A.o + A.h - (cB - B.h) : cB + B.h - (A.o - A.h);
      if (ov <= 0.3) continue;
      const sin = Math.sqrt(Math.max(0, 1 - dot * dot));
      const tl = Math.min(TRIM_MAX, ov / Math.max(sin, 0.02) + 2, 0.45 * A.len, 0.45 * B.len);
      if (tl < 3) continue;
      const half = ov / 2;
      A.shift = right ? -half : half;
      B.shift = right ? half : -half;
      A.tl = B.tl = tl;
      A.o += A.shift;
      B.o += B.shift;
      A.partner = B.q;
      B.partner = A.q;
      break;
    }
  }
}
function buildJunction(id, nodes, g, list, C, PG, forceHull = false) {
  let x = 0, z = 0, signal = false, stop = false;
  for (let m = 0; m < g.length; m++) { const k = g[m]; x += nodes[k].x; z += nodes[k].z; signal = signal || !!nodes[k].signal; stop = stop || !!nodes[k].stop; }
  x /= g.length; z /= g.length;
  const ring = [], corners = [], gores = [];
  const n = list.length;
  // Arm curbs at its trim, as the strip draws them (arm frame).
  const lat = (A, right) => {
    const c = curbsAt(PG, A.e, A.end ? A.e.length - A.trim : A.trim);
    return A.end ? (right ? -c.l : -c.r) : right ? c.r : c.l;
  };
  const L = (A) => { const o = lat(A, false); return [A.nx + A.ux * A.trim + A.rx * o, A.nz + A.uz * A.trim + A.rz * o]; };
  const R = (A) => { const o = lat(A, true); return [A.nx + A.ux * A.trim + A.rx * o, A.nz + A.uz * A.trim + A.rz * o]; };
  for (let i = 0; i < n; i++) {
    const A = list[i], B = list[(i + 1) % n];
    const la = L(A), ra = R(A), lb = L(B);
    ring.push(la[0], la[1], ra[0], ra[1]);
    if (n < 2) break;
    cornerOf(A, B, C);
    if (C.th < GORE_TH && !A.e.ped && !B.e.ped && !A.e.bridge && !B.e.bridge) {
      const G = goreOf(PG, A, B);
      if (G) gores.push(G);
    }
    const curb = [ra[0], ra[1]];
    let fan = null;
    if (C.kind === 1 && C.sa + C.T <= A.trim + 0.01 && C.sb + C.T <= B.trim + 0.01) {
      // Curb return: tangent points, then the arc round its center.
      const tax = C.pax + A.ux * (C.sa + C.T), taz = C.paz + A.uz * (C.sa + C.T);
      const tbx = C.pbx + B.ux * (C.sb + C.T), tbz = C.pbz + B.uz * (C.sb + C.T);
      let bx = A.ux + B.ux, bz = A.uz + B.uz;
      const bl = Math.hypot(bx, bz) || 1;
      bx /= bl; bz /= bl;
      const px = C.pax + A.ux * C.sa, pz = C.paz + A.uz * C.sa;
      const d = C.R / Math.sin(C.th / 2);
      const ox = px + bx * d, oz = pz + bz * d;
      const a0 = Math.atan2(taz - oz, tax - ox);
      let sw = Math.atan2(tbz - oz, tbx - ox) - a0;
      while (sw > Math.PI) sw -= TAU;
      while (sw < -Math.PI) sw += TAU;
      ring.push(tax, taz);
      curb.push(tax, taz);
      for (let m = 1; m < ARC_SEGS; m++) {
        const a = a0 + (sw * m) / ARC_SEGS;
        const qx = ox + Math.cos(a) * C.R, qz = oz + Math.sin(a) * C.R;
        ring.push(qx, qz);
        curb.push(qx, qz);
      }
      ring.push(tbx, tbz);
      curb.push(tbx, tbz);
      fan = 'q';
    } else if (C.kind === 2 && C.sa <= A.trim && C.sb <= B.trim && A.trim - C.sa < 3 * A.h && B.trim - C.sb < 3 * B.h) {
      const mx = C.pax + A.ux * C.sa, mz = C.paz + A.uz * C.sa;
      ring.push(mx, mz);
      curb.push(mx, mz);
      fan = 'm';
    }
    curb.push(lb[0], lb[1]);
    // Sidewalk corner: back lines are the curb lines moved out by the walks.
    const wa = A.wR, wb = B.wL;
    let tris = null;
    if (wa > 0 && wb > 0 && C.th > PAR) {
      const bax = ra[0] + A.rx * wa, baz = ra[1] + A.rz * wa;
      const bbx = lb[0] - B.rx * wb, bbz = lb[1] - B.rz * wb;
      tris = [];
      const qOk = isect(C.pax + A.rx * wa, C.paz + A.rz * wa, A.ux, A.uz, C.pbx - B.rx * wb, C.pbz - B.rz * wb, B.ux, B.uz) &&
        ISX.s <= A.trim + 0.01 && ISX.t <= B.trim + 0.01 && ISX.s > -A.h - 10 && ISX.t > -B.h - 10;
      const qx = C.pax + A.rx * wa + A.ux * ISX.s, qz = C.paz + A.rz * wa + A.uz * ISX.s;
      if (fan === 'q' && qOk) {
        const v = [bax, baz, ...curb, bbx, bbz];
        for (let k = 0; k + 3 < v.length; k += 2) tris.push(qx, qz, v[k], v[k + 1], v[k + 2], v[k + 3]);
      } else if (fan === 'm' && qOk) {
        const mx = curb[2], mz = curb[3];
        tris.push(ra[0], ra[1], mx, mz, qx, qz, ra[0], ra[1], qx, qz, bax, baz);
        tris.push(mx, mz, lb[0], lb[1], bbx, bbz, mx, mz, bbx, bbz, qx, qz);
      } else if (qOk && C.th < STRAIGHT) {
        // A straight curb across the corner (no room for a return).
        tris.push(qx, qz, bax, baz, ra[0], ra[1], qx, qz, ra[0], ra[1], lb[0], lb[1], qx, qz, lb[0], lb[1], bbx, bbz);
      } else {
        tris.push(ra[0], ra[1], lb[0], lb[1], bbx, bbz, ra[0], ra[1], bbx, bbz, bax, baz);
      }
    }
    // (qa, sideA: the edge end and side (0 right, 1 left) of the arm before
    // the corner; qb, sideB: of the arm after it. The meshes leave the
    // sidewalk off a corner whose two sides are bare, world/ground.js.)
    if (wa > 0 || wb > 0) corners.push({ curb, tris, qa: A.q, sideA: A.end ? 1 : 0, qb: B.q, sideB: B.end ? 0 : 1 });
  }
  let hull = false;
  let poly = ring;
  if (n >= 2 && !isSimple(ring)) {
    // The arm ends alone (no curb returns); else the ring as it is, drawn
    // as a fan round the junction's middle (`fan`: its area is the union
    // of the fan's triangles).
    const plain = [];
    for (const A of list) plain.push(...L(A), ...R(A));
    if (isSimple(plain)) poly = plain;
    else hull = true;
  }
  if (forceHull) {
    // The convex hull of the arm mouths (the arms drawn out onto it).
    const plain = [];
    for (const A of list) plain.push(...L(A), ...R(A));
    poly = hullOf(plain);
    hull = false;
    corners.length = 0;
  }
  // A fan junction's asphalt (its ring crosses itself): each arm's
  // carriageway carried straight on from its mouth to its node, and the
  // convex hull of those ends in the middle. Straight edges along every
  // arm, no spikes from a fan round the middle across the crossing.
  let area = null;
  if (hull && n >= 2) {
    area = [];
    const mid = [];
    for (let armIdx = 0; armIdx < list.length; armIdx++) {
      const A = list[armIdx];
      const ol = lat(A, false), or = lat(A, true), la = L(A), ra = R(A);
      const lx = A.nx + A.rx * ol, lz = A.nz + A.rz * ol, rx = A.nx + A.rx * or, rz = A.nz + A.rz * or;
      area.push(la[0], la[1], ra[0], ra[1], rx, rz, la[0], la[1], rx, rz, lx, lz);
      mid.push(lx, lz, rx, rz);
    }
    const H = hullOf(mid), nh = H.length / 2;
    for (let i = 1; i + 1 < nh; i++) area.push(H[0], H[1], H[2 * i], H[2 * i + 1], H[2 * i + 2], H[2 * i + 3]);
  }
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
  const grow = (p) => {
    for (let k = 0; k < p.length; k += 2) {
      if (p[k] < x0) x0 = p[k]; if (p[k] > x1) x1 = p[k];
      if (p[k + 1] < z0) z0 = p[k + 1]; if (p[k + 1] > z1) z1 = p[k + 1];
    }
  };
  grow(poly);
  if (area) grow(area);
  for (let m = 0; m < corners.length; m++) if (corners[m].tris) grow(corners[m].tris);
  for (let m = 0; m < gores.length; m++) grow(gores[m].poly);
  const lead = Math.min(...g);
  // A draft: plain arrays, the ring not yet triangulated (a ring that
  // crosses itself is built again, so only the kept one is finished).
  return {
    id, lead, nodes: g, x, z, signal, stop, hull, fan: hull,
    ring: poly, tris: n < 2 ? null : area, corners, gores, arms: list, x0, z0, x1, z1, hullRing: forceHull,
  };
}
// The kept draft as a junction: typed arrays, its asphalt triangulated.
function finishJunction(D) {
  const corners = D.corners;
  for (let k = 0; k < corners.length; k++) {
    const c = corners[k];
    corners[k] = { curb: Float64Array.from(c.curb), tris: c.tris ? Float64Array.from(c.tris) : null, qa: c.qa, sideA: c.sideA, qb: c.qb, sideB: c.sideB };
  }
  return {
    id: D.id, lead: D.lead, nodes: Int32Array.from(D.nodes), x: D.x, z: D.z, signal: D.signal, stop: D.stop, hull: D.hull, fan: D.fan,
    ring: Float64Array.from(D.ring), tris: D.arms.length < 2 ? new Float64Array(0) : Float64Array.from(D.tris || triangulate(D.ring)),
    corners, gores: D.gores, arms: Int32Array.from(D.arms.map((A) => A.q)), x0: D.x0, z0: D.z0, x1: D.x1, z1: D.z1, hullRing: D.hullRing,
  };
}

const JCELL = 32;
const NONE = [];
// The junctions whose box may hold (x, z) (a list owned by the grid).
export function junctionsAt(geo, x, z) {
  return geo.jGrid.get(Math.floor(x / JCELL) * 100003 + Math.floor(z / JCELL)) || NONE;
}
// Does any junction's grid cell list meet the box x0..x1, z0..z1? (When
// none does, onJunction is false at every point of the box.)
export function junctionsInBox(geo, x0, z0, x1, z1) {
  const i0 = Math.floor(x0 / JCELL), i1 = Math.floor(x1 / JCELL), j0 = Math.floor(z0 / JCELL), j1 = Math.floor(z1 / JCELL);
  for (let i = i0; i <= i1; i++) {
    for (let j = j0; j <= j1; j++) {
      const l = geo.jGrid.get(i * 100003 + j);
      if (l && l.length) return true;
    }
  }
  return false;
}
// Is (x, z) on some junction's asphalt?
export function onJunction(geo, x, z) {
  const l = junctionsAt(geo, x, z);
  for (let k = 0; k < l.length; k++) if (inJunctionArea(l[k], x, z)) return true;
  return false;
}

// ---- Per edge: strip outline, curbs and paint. ----

const smooth = (t) => t * t * (3 - 2 * t);
// Left and right curb offsets of edge k at d m from node a: CURBS.l, .r.
export const CURBS = { l: 0, r: 0 };
export function curbsAt(geo, e, d) {
  const off = (e.off || 0) + (geo.eoff ? geo.eoff[e.id] : 0), h = e.width / 2;
  let l = off - h, r = off + h;
  const qa = 2 * e.id, qb = qa + 1;
  const ta = geo.taper[qa], tb = geo.taper[qb];
  if (ta > 0 && d < ta) {
    const f = geo.tlin[qa] ? Math.max(0, d) / ta : smooth(Math.max(0, d) / ta);
    l = geo.tcl[qa] + (l - geo.tcl[qa]) * f;
    r = geo.tcr[qa] + (r - geo.tcr[qa]) * f;
  }
  if (tb > 0 && d > e.length - tb) {
    const f = geo.tlin[qb] ? Math.max(0, e.length - d) / tb : smooth(Math.max(0, e.length - d) / tb);
    l = geo.tcl[qb] + (l - geo.tcl[qb]) * f;
    r = geo.tcr[qb] + (r - geo.tcr[qb]) * f;
  }
  CURBS.l = l;
  CURBS.r = r;
  return CURBS;
}
// Is side (0 right, 1 left, edge frame) of edge e bare at d (a gore, a
// median nose)?
export function supAt(geo, e, side, d) {
  const q = 4 * e.id + side;
  return d < geo.sup[q] || d > e.length - geo.sup[q + 2];
}
// Along distance of the strip start and end at lateral o.
export const startAt = (geo, e, o) => geo.trim[2 * e.id] + geo.miter[2 * e.id] * o;
export const endAt = (geo, e, o) => e.length - geo.trim[2 * e.id + 1] + geo.miter[2 * e.id + 1] * o;

// Stations of an edge's strip into out (cleared): [d, k, l, r, ...]: at
// lateral o the station lies at d + k * o; l, r the curbs there. Pieces are
// at most `piece` m; tapers get 3 steps. Empty for an inner edge or one
// with no room left.
export function edgeStations(geo, e, piece, out) {
  out.length = 0;
  if (geo.inner[e.id]) return out;
  const qa = 2 * e.id, qb = qa + 1;
  const d0 = geo.trim[qa], d1 = e.length - geo.trim[qb];
  if (d1 - d0 < 0.05) return out;
  const push = (d, k) => {
    curbsAt(geo, e, d);
    out.push(d, k, CURBS.l, CURBS.r);
  };
  push(d0, geo.miter[qa]);
  const ta = Math.min(geo.taper[qa], d1), tb = Math.max(d0, e.length - geo.taper[qb]);
  const cuts = [];
  if (geo.taper[qa] > 0) for (let m = 1; m <= 2; m++) cuts.push(d0 + ((ta - d0) * m) / 2);
  if (geo.taper[qb] > 0) for (let m = 0; m < 2; m++) cuts.push(tb + ((d1 - tb) * m) / 2);
  for (let side = 0; side < 2; side++) {
    const sa = geo.sup[4 * e.id + side], sb = geo.sup[4 * e.id + 2 + side];
    if (sa > d0 && sa < d1) cuts.push(sa);
    if (sb > 0 && e.length - sb > d0 && e.length - sb < d1) cuts.push(e.length - sb);
  }
  cuts.push(d1);
  cuts.sort((a, b) => a - b);
  let last = d0;
  for (const c of cuts) {
    if (c <= last + 0.05) continue;
    const n = Math.max(1, Math.ceil((c - last) / piece - 1e-9));
    for (let m = 1; m <= n; m++) {
      const d = last + ((c - last) * m) / n;
      if (d >= d1 - 0.05) break;
      push(d, 0);
    }
    last = c;
  }
  push(d1, geo.miter[qb]);
  return out;
}

const PL = [], PN = [];
const familyOf = (kind) => (kind === 'yellow2' || kind === 'yellow' || kind === 'turn' ? 1 : 0);
const DS = [];
// Where a paint line at lateral o (the untapered strip) lies at d: at the
// same fraction of the way across the tapered strip.
function mapAt(geo, e, d, o) {
  const base = (e.off || 0) + geo.eoff[e.id] - e.width / 2;
  const C = curbsAt(geo, e, d);
  return C.l + ((o - base) * (C.r - C.l)) / e.width;
}
// Does the next edge at the bend of end q have a line of this family at
// the node within 0.3 m of p (this edge's frame)?
function continues(city, geo, q, p, fam) {
  const k = geo.nbr[q];
  if (k < 0) return false;
  const e = city.edges[q >> 1], nb = city.edges[k], node = q & 1 ? e.b : e.a;
  const dn = nb.b === node ? nb.length : 0, f = geo.flip[q] ? -1 : 1;
  paintLines(nb, PN);
  for (let i = 0; i < PN.length; i += 2) {
    if (familyOf(PN[i + 1]) !== fam) continue;
    if (Math.abs(mapAt(geo, nb, dn, PN[i] + geo.eoff[k]) * f - p) < 0.3) return true;
  }
  return false;
}

// Paint of edge e into out (cleared): [d0, o0, d1, o1, hw, color, ...]: a
// line from (d0, o0) to (d1, o1) (along, lateral), hw m either side of
// it; color 0 white, 1 yellow. Lines stop at the strip ends (junction
// boundary, before a taper where they do not continue); crosswalk and
// stop bar on controlled approaches only.
export function edgePaint(city, e, out) {
  out.length = 0;
  const geo = city.roadGeo;
  if (!geo || e.ped || geo.inner[e.id] || e.lanesF === undefined) return out;
  const qa = 2 * e.id, qb = qa + 1;
  const sA = geo.trim[qa], sB = e.length - geo.trim[qb];
  if (sB - sA < 1) return out;
  const sh = geo.eoff[e.id];
  const div = divideOf(e) + sh;
  paintLines(e, PL);
  if (sh) for (let i = 0; i < PL.length; i += 2) PL[i] += sh;
  const span = sB - sA;
  const room = span >= 12;
  for (let i = 0; i < PL.length; i += 2) {
    const o = PL[i], kind = PL[i + 1], fam = familyOf(kind);
    // A line keeps its place across the road while the curbs taper (it
    // moves with them, never across a lane). Start and end: the junction
    // boundary (stop bar, crosswalk); at a bend the node when the next
    // edge has the same line there, else before the taper; a dead end.
    let dA, dB;
    if (geo.jEnd[qa] >= 0) {
      const inc = e.oneway ? false : o <= div + 0.01;
      dA = sA + (geo.ctrl[qa] && room ? (inc ? STOP_BAR + STOP_HW : CW_FAR + CW_HW + 0.25) : LINE_GAP);
    } else if (geo.nbr[qa] >= 0) {
      const p = mapAt(geo, e, 0, o);
      dA = continues(city, geo, qa, p, fam) ? geo.miter[qa] * p : Math.max(geo.taper[qa], 2);
    } else dA = 0.5;
    if (geo.jEnd[qb] >= 0) {
      const inc = e.oneway ? true : o >= div - 0.01;
      dB = sB - (geo.ctrl[qb] && room ? (inc ? STOP_BAR + STOP_HW : CW_FAR + CW_HW + 0.25) : LINE_GAP);
    } else if (geo.nbr[qb] >= 0) {
      const p = mapAt(geo, e, e.length, o);
      dB = continues(city, geo, qb, p, fam) ? e.length + geo.miter[qb] * p : e.length - Math.max(geo.taper[qb], 2);
    } else dB = e.length - 0.5;
    if (dB <= dA + 0.3) continue;
    // Samples: the ends and the taper steps between them.
    DS.length = 0;
    DS.push(dA);
    const ta = geo.taper[qa], tb = geo.taper[qb];
    if (ta > 0) for (const d of [ta / 3, (2 * ta) / 3, ta]) if (d > dA + 0.2 && d < dB - 0.2) DS.push(d);
    if (tb > 0) for (const d of [e.length - tb, e.length - (2 * tb) / 3, e.length - tb / 3]) if (d > DS[DS.length - 1] + 0.2 && d < dB - 0.2) DS.push(d);
    DS.push(dB);
    for (let k = 0; k + 1 < DS.length; k++) {
      const d0 = DS[k], d1 = DS[k + 1];
      emitLine(out, kind, o, d0, mapAt(geo, e, Math.max(0, Math.min(e.length, d0)), o), d1, mapAt(geo, e, Math.max(0, Math.min(e.length, d1)), o), div);
    }
  }
  // Crosswalks and stop bars.
  for (let end = 0; end < 2; end++) {
    const q = qa + end;
    if (!geo.ctrl[q] || !room) continue;
    const dir = end ? -1 : 1, d = end ? sB : sA;
    for (const c of [CW_NEAR, CW_FAR]) {
      const dd = d + dir * c;
      curbsAt(geo, e, dd);
      out.push(dd, CURBS.l + GUTTER, dd, CURBS.r - GUTTER, CW_HW, 0);
    }
    const dd = d + dir * STOP_BAR;
    curbsAt(geo, e, dd);
    let lo, hi;
    if (end) { lo = e.oneway ? CURBS.l + GUTTER + e.parkL : div + 0.3; hi = CURBS.r - GUTTER - e.parkR; } else {
      if (e.oneway) continue;
      lo = CURBS.l + GUTTER + e.parkL; hi = div - 0.3;
    }
    if (hi - lo > 1) out.push(dd, lo, dd, hi, STOP_HW, 0);
  }
  return clipPaint(city, e, out);
}

// Paint never lies on a junction's asphalt: a line with a point on one
// (a neighbor's polygon reaching over the strip) keeps only its pieces off
// every junction, found in 0.5 m steps.
const CLIP = [];
function clipPaint(city, e, out) {
  const geo = city.roadGeo, a = city.nodes[e.a];
  const on = (d, o) => onJunction(geo, a.x + e.ux * d - e.uz * o, a.z + e.uz * d + e.ux * o);
  let dirty = false;
  for (let k = 0; k < out.length && !dirty; k += 6) {
    if (on(out[k], out[k + 1]) || on(out[k + 2], out[k + 3]) || on((out[k] + out[k + 2]) / 2, (out[k + 1] + out[k + 3]) / 2)) dirty = true;
  }
  if (!dirty) return out;
  CLIP.length = 0;
  for (let k = 0; k < out.length; k += 6) {
    const d0 = out[k], o0 = out[k + 1], d1 = out[k + 2], o1 = out[k + 3];
    const L = Math.hypot(d1 - d0, o1 - o0), n = Math.max(1, Math.ceil(L / 0.5));
    let run = -1;
    for (let m = 0; m <= n; m++) {
      const f = m / n, free = !on(d0 + (d1 - d0) * f, o0 + (o1 - o0) * f);
      if (free && run < 0) run = m;
      if ((!free || m === n) && run >= 0) {
        const end = free ? m : m - 1;
        if (end > run) {
          const f0 = run / n, f1 = end / n;
          CLIP.push(d0 + (d1 - d0) * f0, o0 + (o1 - o0) * f0, d0 + (d1 - d0) * f1, o0 + (o1 - o0) * f1, out[k + 4], out[k + 5]);
        }
        run = -1;
      }
    }
  }
  out.length = 0;
  for (let k = 0; k < CLIP.length; k++) out.push(CLIP[k]);
  return out;
}

// One painted line of a kind from (d0, o0) to (d1, o1) (o: the line's own
// offset on the strip, for the turn lane's inner side).
function emitLine(out, kind, o, d0, o0, d1, o1, div) {
  if (kind === 'yellow2') {
    out.push(d0, o0 - 0.195, d1, o1 - 0.195, 0.075, 1, d0, o0 + 0.195, d1, o1 + 0.195, 0.075, 1);
  } else if (kind === 'yellow') {
    out.push(d0, o0, d1, o1, 0.07, 1);
  } else if (kind === 'turn') {
    out.push(d0, o0, d1, o1, 0.07, 1);
    const s = o < div ? 0.3 : -0.3;
    dashes(out, d0, o0 + s, d1, o1 + s, 1);
  } else if (kind === 'white') {
    out.push(d0, o0, d1, o1, 0.07, 0);
  } else if (kind === 'park') {
    out.push(d0, o0, d1, o1, 0.05, 0);
  } else dashes(out, d0, o0, d1, o1, 0);
}
// 3 m dashes every 12 m (10 ft dash, 30 ft gap), phase from node a.
function dashes(out, d0, o0, d1, o1, col) {
  const L = d1 - d0;
  if (L <= 0) return;
  for (let s = Math.ceil((d0 - 7) / 12) * 12 + 4; s < d1; s += 12) {
    const a = Math.max(d0, s), b = Math.min(d1, s + 3);
    if (b - a < 0.5) continue;
    out.push(a, o0 + ((o1 - o0) * (a - d0)) / L, b, o0 + ((o1 - o0) * (b - d0)) / L, 0.07, col);
  }
}

// Distance from the node of end q (2 * edge + end) back to the far side of
// its stop bar, or -1 when the approach has none.
export function stopDistance(city, edgeId, nodeId) {
  const geo = city.roadGeo;
  if (!geo) return -1;
  const e = city.edges[edgeId];
  const q = 2 * edgeId + (e.b === nodeId ? 1 : 0);
  if (!geo.ctrl[q]) return -1;
  const span = e.length - geo.trim[2 * edgeId] - geo.trim[2 * edgeId + 1];
  if (span < 12) return -1;
  return geo.trim[q] + STOP_BAR + STOP_HW;
}

// World point of (d, o) on edge e into P ({ x, z }).
export function edgePoint(city, e, d, o, P) {
  const a = city.nodes[e.a];
  P.x = a.x + e.ux * d - e.uz * o;
  P.z = a.z + e.uz * d + e.ux * o;
  return P;
}
