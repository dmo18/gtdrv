// Street alignment audit (0.13.8, docs/STATUS.md "0.13.8 street
// alignment"): node-level measurements of how the drawn streets line up,
// shared by test/streetalign.test.js and scripts/street-align.mjs. Not a
// test file itself. Pure: reads a Miami city (createMiamiCity) and its
// roadGeo; no three.js.
//
// Measured, per city:
// - bend: degree-2 joints that are not junctions: the step of the left
//   and right curb and of the divide where the two cross sections meet
//   (raw: the two edges' own cross sections; drawn: after the tapers),
//   and how many joints taper at all (a width change between junctions).
// - through: a street running straight on through a junction (same name,
//   same one-way kind, under 35 degrees): the lateral offset of its two
//   curbs and of its divide (the lane lines) from one side to the other,
//   at the junction center.
// - mouth: arm mouths (both curbs at the trim) farther than 0.3 m from
//   the junction's asphalt (the ring, or the fan area).
// - pair: divided roads: the spread (max - min) of the drawn gap between
//   the two halves' left curbs along a run of one street, and the jump of
//   that gap where two paired edges meet.
// - curb spots: parking spots off the lot (curb parking) whose center is
//   farther than 0.4 m from the middle of the parking lane they stand in.
import { curbsAt, ringDist, inJunctionArea, edgePaint } from '../src/world/junctions.js';
import { divideOf, GUTTER } from '../src/world/roadprofile.js';

const RUN_COS = Math.cos((35 * Math.PI) / 180);

// Lateral offsets (right of the node line seen a -> b) of edge e at d:
// [left curb, right curb, divide], as drawn (tapers, side shifts).
function drawnAt(geo, e, d, out) {
  const C = curbsAt(geo, e, d);
  const base = (e.off || 0) + geo.eoff[e.id] - e.width / 2;
  out[0] = C.l;
  out[1] = C.r;
  out[2] = C.l + ((divideOf(e) + geo.eoff[e.id] - base) * (C.r - C.l)) / e.width;
  return out;
}
function rawAt(geo, e, out) {
  const o = (e.off || 0) + geo.eoff[e.id];
  out[0] = o - e.width / 2;
  out[1] = o + e.width / 2;
  out[2] = divideOf(e) + geo.eoff[e.id];
  return out;
}
const skip = (e) => e.lanesF === undefined || e.causeway || e.ped;

export function auditStreets(city) {
  const geo = city.roadGeo, N = city.nodes, E = city.edges;
  const A = [0, 0, 0], B = [0, 0, 0];
  const r = {
    bends: 0, bendStep: 0, bendKink: 0, bendSlopeMax: 0, kinkWorst: null, bendTaper: 0, bendRaw: 0, bendRawMax: 0, bendDrawnMax: 0, bendDivRaw: 0, bendDivMax: 0, bendWorst: null,
    through: 0, throughCurb: 0, throughCurbMax: 0, throughDiv: 0, throughDivMax: 0, throughWorst: null, throughWidth: 0,
    arms: 0, mouthMiss: 0, mouthMax: 0, mouthWorst: null,
    pairRuns: 0, pairSpreadBad: 0, pairSpreadMax: 0, pairJump: 0, pairJumpMax: 0, pairWorst: null,
    curbSpots: 0, curbSpotOff: 0, curbSpotMax: 0, curbWorst: null,
  };
  // ---- Degree-2 joints (bends that are not junctions).
  for (const n of N) {
    if (n.edges.length !== 2 || geo.nodeJ[n.id] >= 0) continue;
    const e1 = E[n.edges[0]], e2 = E[n.edges[1]];
    if (e1 === e2 || skip(e1) || skip(e2)) continue;
    const end1 = e1.b === n.id ? 1 : 0, end2 = e2.b === n.id ? 1 : 0;
    const f = end1 === end2 ? -1 : 1;
    r.bends++;
    // Raw cross sections in e1's frame.
    rawAt(geo, e1, A);
    rawAt(geo, e2, B);
    let l2 = B[0], r2 = B[1], d2 = B[2];
    if (f < 0) { l2 = -B[1]; r2 = -B[0]; d2 = -B[2]; }
    const raw = Math.max(Math.abs(A[0] - l2), Math.abs(A[1] - r2));
    if (raw > 0.05) r.bendTaper++;
    if (raw > 0.2) r.bendRaw++;
    if (raw > r.bendRawMax) { r.bendRawMax = raw; r.bendWorst = { x: Math.round(n.x), z: Math.round(n.z), name: e1.name || e2.name, raw: +raw.toFixed(2) }; }
    const div = Math.abs(A[2] - d2);
    if (div > 0.2 && (e1.lanesF > 0 && e2.lanesF > 0)) r.bendDivRaw++;
    if (div > r.bendDivMax) r.bendDivMax = div;
    // Drawn at the node.
    drawnAt(geo, e1, end1 ? e1.length : 0, A);
    drawnAt(geo, e2, end2 ? e2.length : 0, B);
    l2 = B[0]; r2 = B[1];
    if (f < 0) { l2 = -B[1]; r2 = -B[0]; }
    const drawn = Math.max(Math.abs(A[0] - l2), Math.abs(A[1] - r2));
    if (drawn > r.bendDrawnMax) r.bendDrawnMax = drawn;
    if (drawn > 0.2) r.bendStep++;
    // The kink the cross sections add: each curb's offset from the node
    // lines, every 5 m from 30 m back on e1 to 30 m on along e2 (e1's
    // frame), and the largest change of its slope between two windows
    // (m per m: 0.1 is a 6 degree bend in a curb the node lines do not
    // make).
    let slope = 0;
    for (let side = 0; side < 2; side++) {
      const L = [];
      for (let s = -30; s <= 30; s += 5) {
        if (s <= 0) {
          if (-s > e1.length) continue;
          const C = curbsAt(geo, e1, end1 ? e1.length + s : -s);
          L.push(side ? C.r : C.l);
        } else {
          if (s > e2.length) continue;
          const C = curbsAt(geo, e2, end2 ? e2.length - s : s);
          L.push(f < 0 ? -(side ? C.l : C.r) : side ? C.r : C.l);
        }
      }
      for (let i = 2; i < L.length; i++) {
        const k = Math.abs(L[i] - 2 * L[i - 1] + L[i - 2]) / 5;
        if (k > slope) slope = k;
      }
    }
    if (slope > 0.1) r.bendKink++;
    if (slope > r.bendSlopeMax) { r.bendSlopeMax = slope; r.kinkWorst = { x: Math.round(n.x), z: Math.round(n.z), name: e1.name || e2.name, slope: +slope.toFixed(2) }; }
  }
  // ---- Straight on through a junction, and arm mouths.
  const triDist = (T, x, z) => {
    let best = Infinity;
    for (let k = 0; k + 5 < T.length; k += 6) best = Math.min(best, ringDist(T.subarray ? T.subarray(k, k + 6) : T.slice(k, k + 6), x, z));
    return best;
  };
  for (const J of geo.junctions) {
    const arms = [];
    for (const q of J.arms) {
      const e = E[q >> 1], end = q & 1, n = N[end ? e.b : e.a], s = end ? -1 : 1;
      arms.push({ q, e, end, nx: n.x, nz: n.z, ux: e.ux * s, uz: e.uz * s, rx: -e.uz * s, rz: e.ux * s, trim: geo.trim[q] });
    }
    for (let i = 0; i < arms.length; i++) {
      const P = arms[i];
      if (skip(P.e)) continue;
      // Mouth points on the asphalt.
      r.arms++;
      for (const right of [false, true]) {
        const e = P.e, d = P.end ? e.length - P.trim : P.trim;
        const C = curbsAt(geo, e, d);
        const o = right ? C.r : C.l;
        const a = N[e.a];
        const x = a.x + e.ux * d - e.uz * o, z = a.z + e.uz * d + e.ux * o;
        const miss = inJunctionArea(J, x, z) ? 0 : J.fan ? triDist(J.tris, x, z) : ringDist(J.ring, x, z);
        if (miss > 0.3) {
          r.mouthMiss++;
          if (miss > r.mouthMax) { r.mouthMax = miss; r.mouthWorst = { x: Math.round(x), z: Math.round(z), name: e.name, miss: +miss.toFixed(2) }; }
        }
      }
      for (let j = i + 1; j < arms.length; j++) {
        const Q = arms[j];
        if (skip(Q.e)) continue;
        const e = P.e, f = Q.e;
        if (e.oneway !== f.oneway || (e.name || '') !== (f.name || '') || !e.name) continue;
        // Leaving directions opposite.
        const c = -(P.ux * Q.ux + P.uz * Q.uz);
        if (c < RUN_COS) continue;
        // One-way: one enters, the other leaves.
        if (e.oneway && P.end === Q.end) continue;
        r.through++;
        // World lines of the curbs and the divide of each, as drawn at
        // the mouth, carried to the junction center along each arm.
        const line = (Arm, out) => {
          const ee = Arm.e, d = Arm.end ? ee.length - Arm.trim : Arm.trim;
          drawnAt(geo, ee, d, out);
        };
        line(P, A);
        line(Q, B);
        // Perpendicular offset at the junction center, in P's leaving
        // frame (right = (P.rx, P.rz)). A lateral o of edge e (right of
        // a -> b) is at P-frame lateral o * sP where sP = P.end ? -1 : 1.
        const sP = P.end ? -1 : 1, sQ = Q.end ? -1 : 1;
        const lat = (Arm, o, s) => {
          // The point on the line through the arm's node at lateral o
          // (arm frame), its offset from J center across P's direction.
          const px = Arm.nx + Arm.rx * o * s, pz = Arm.nz + Arm.rz * o * s;
          return (px - J.x) * P.rx + (pz - J.z) * P.rz;
        };
        // P's left curb (arm frame) is e's right curb when P.end... keep
        // it simple: both curbs of each, sorted by P-frame offset.
        const pl = [lat(P, A[0], sP), lat(P, A[1], sP)].sort((a, b) => a - b);
        const ql = [lat(Q, B[0], sQ), lat(Q, B[1], sQ)].sort((a, b) => a - b);
        // (Q leaves the other way: its lateral in P's frame flips with
        // its own r, which lat() already accounts for through Arm.rx.)
        const dc = Math.max(Math.abs(pl[0] - ql[0]), Math.abs(pl[1] - ql[1]));
        const dd = Math.abs(lat(P, A[2], sP) - lat(Q, B[2], sQ));
        if (Math.abs(e.width - f.width) > 0.2) r.throughWidth++;
        if (dc > 0.3) r.throughCurb++;
        if (dc > r.throughCurbMax) { r.throughCurbMax = dc; r.throughWorst = { x: Math.round(J.x), z: Math.round(J.z), name: e.name, curb: +dc.toFixed(2), div: +dd.toFixed(2) }; }
        if (dd > 0.3 && e.lanesF > 0 && f.lanesF > 0) r.throughDiv++;
        if (dd > r.throughDivMax) r.throughDivMax = dd;
      }
    }
  }
  // ---- Divided pairs: the drawn gap between the halves along a street.
  // Runs: paired edges of one name joined at degree-2 joints.
  const gapAt = (e, d) => {
    const C = curbsAt(geo, e, d);
    const lc = C.l;
    const p = E[e.pair], a = N[e.a], pa = N[p.a];
    const x = a.x + e.ux * d - e.uz * lc, z = a.z + e.uz * d + e.ux * lc;
    const t = (x - pa.x) * p.ux + (z - pa.z) * p.uz;
    if (t < 0 || t > p.length) return NaN;
    const Cp = curbsAt(geo, p, t);
    const lat = -(x - pa.x) * p.uz + (z - pa.z) * p.ux;
    return Math.abs(lat - Cp.l);
  };
  // Halves drawn as one road (no median): their left curbs (the two
  // yellow edge lines) should be one line. Samples every 4 m along the
  // strip where the partner's left curb is within 6 m: how far apart.
  r.mergedSamples = 0; r.mergedApart = 0; r.mergedApartMax = 0;
  for (const e of E) {
    if (!(e.pair >= 0) || e.median > 0 || skip(e) || geo.inner[e.id]) continue;
    const t0 = geo.trim[2 * e.id], t1 = e.length - geo.trim[2 * e.id + 1];
    for (let d = t0 + 2; d < t1 - 2; d += 4) {
      const g = gapAt(e, d);
      if (!Number.isFinite(g) || g > 6) continue;
      r.mergedSamples++;
      if (g > 0.5) r.mergedApart++;
      if (g > r.mergedApartMax) r.mergedApartMax = g;
    }
  }
  // Their yellow edge lines (paint, color 1 on a one-way): every 2 m of
  // one half's line, how far the partner's yellow line lies across (a
  // double yellow is 0.24 m; apart: over 0.6 m), where the partner has a
  // yellow line at that place.
  r.yellowSamples = 0; r.yellowApart = 0;
  const PE = [], PP = [];
  const latOn = (P, t) => {
    for (let k = 0; k + 5 < P.length; k += 6) {
      if (P[k + 5] !== 1) continue;
      const lo = Math.min(P[k], P[k + 2]), hi = Math.max(P[k], P[k + 2]);
      if (t < lo || t > hi || hi - lo < 1e-6) continue;
      return P[k + 1] + ((P[k + 3] - P[k + 1]) * (t - P[k])) / (P[k + 2] - P[k]);
    }
    return NaN;
  };
  for (const e of E) {
    if (!(e.pair >= 0) || e.median > 0 || skip(e) || geo.inner[e.id] || !e.oneway) continue;
    const p = E[e.pair];
    edgePaint(city, e, PE);
    edgePaint(city, p, PP);
    const a = N[e.a], pa = N[p.a];
    for (let k = 0; k + 5 < PE.length; k += 6) {
      if (PE[k + 5] !== 1) continue;
      const L = Math.hypot(PE[k + 2] - PE[k], PE[k + 3] - PE[k + 1]), n = Math.max(1, Math.floor(L / 2));
      for (let m = 0; m <= n; m++) {
        const d = PE[k] + ((PE[k + 2] - PE[k]) * m) / n, o = PE[k + 1] + ((PE[k + 3] - PE[k + 1]) * m) / n;
        const x = a.x + e.ux * d - e.uz * o, z = a.z + e.uz * d + e.ux * o;
        const t = (x - pa.x) * p.ux + (z - pa.z) * p.uz;
        const lp = latOn(PP, t);
        if (!Number.isFinite(lp)) continue;
        const lat = -(x - pa.x) * p.uz + (z - pa.z) * p.ux;
        r.yellowSamples++;
        if (Math.abs(lat - lp) > 0.6) r.yellowApart++;
      }
    }
  }
  const seen = new Uint8Array(E.length);
  for (const e0 of E) {
    if (!(e0.pair >= 0) || seen[e0.id] || skip(e0)) continue;
    // Walk the run both ways through degree-2 non-junction nodes.
    const run = [e0];
    seen[e0.id] = 1;
    for (const start of [e0.a, e0.b]) {
      let cur = e0, node = start;
      for (let guard = 0; guard < 200; guard++) {
        const n = N[node];
        if (n.edges.length !== 2) break;
        const nx = E[n.edges[0]] === cur ? E[n.edges[1]] : E[n.edges[0]];
        if (!(nx.pair >= 0) || seen[nx.id] || nx.name !== e0.name) break;
        // The gap jump at the joint.
        const g1 = gapAt(cur, cur.b === node ? cur.length - 0.01 : 0.01), g2 = gapAt(nx, nx.a === node ? 0.01 : nx.length - 0.01);
        if (Number.isFinite(g1) && Number.isFinite(g2)) {
          const jmp = Math.abs(g1 - g2);
          if (jmp > 0.2) r.pairJump++;
          if (jmp > r.pairJumpMax) r.pairJumpMax = jmp;
        }
        seen[nx.id] = 1;
        run.push(nx);
        cur = nx;
        node = nx.a === node ? nx.b : nx.a;
      }
    }
    let lo = Infinity, hi = -Infinity, len = 0;
    for (const e of run) {
      len += e.length;
      const t0 = geo.trim[2 * e.id], t1 = e.length - geo.trim[2 * e.id + 1];
      for (let d = t0 + 2; d < t1 - 2; d += 4) {
        const g = gapAt(e, d);
        if (!Number.isFinite(g)) continue;
        if (g < lo) lo = g;
        if (g > hi) hi = g;
      }
    }
    if (!(hi >= lo) || len < 40) continue;
    r.pairRuns++;
    const sp = hi - lo;
    if (sp > 1) r.pairSpreadBad++;
    if (sp > r.pairSpreadMax) { r.pairSpreadMax = sp; const a = N[e0.a]; r.pairWorst = { x: Math.round(a.x), z: Math.round(a.z), name: e0.name, spread: +sp.toFixed(2), len: Math.round(len) }; }
  }
  // ---- Curb parking spots against the parking lane.
  if (city.parkingSpots && city.edgesNear) {
    const near = [];
    for (const s of city.parkingSpots) {
      if (s.lot) continue;
      city.edgesNear(s.x, s.z, 12, near);
      let best = Infinity, bestE = null;
      for (const k of near) {
        const e = E[k];
        if (!(e.parkL > 0 || e.parkR > 0)) continue;
        const a = N[e.a];
        const d = (s.x - a.x) * e.ux + (s.z - a.z) * e.uz;
        if (d < 0 || d > e.length) continue;
        const o = -(s.x - a.x) * e.uz + (s.z - a.z) * e.ux;
        const C = curbsAt(geo, e, d);
        // Parking lane middles, as drawn.
        const lm = C.l + GUTTER + e.parkL / 2, rm = C.r - GUTTER - e.parkR / 2;
        const off = Math.min(e.parkL > 0 ? Math.abs(o - lm) : Infinity, e.parkR > 0 ? Math.abs(o - rm) : Infinity);
        if (off < best) { best = off; bestE = e; }
      }
      if (!bestE) continue;
      r.curbSpots++;
      if (best > 0.4) {
        r.curbSpotOff++;
        if (best > r.curbSpotMax) { r.curbSpotMax = best; r.curbWorst = { x: Math.round(s.x), z: Math.round(s.z), name: bestE.name, off: +best.toFixed(2) }; }
      }
    }
  }
  for (const k of Object.keys(r)) if (typeof r[k] === 'number' && !Number.isInteger(r[k])) r[k] = +r[k].toFixed(2);
  return r;
}
