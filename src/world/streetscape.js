// Street props off the road (0.13.7, docs/STREETSCAPE.md "props off the
// road"). The owner found lamp posts standing in the roadway. A street
// prop was set at a fixed distance past half the edge's width, so it
// landed on asphalt wherever the real curb was somewhere else: the gap
// between two carriageways closer than 6 m (paved, world/ground.js gapAt),
// a strip moved sideways at a junction (roadGeo.eoff), a taper, a
// junction's area or crosswalk, or another road. Here a prop's place comes
// from the real profile of its edge's side at that point: the curb
// (junctions.js curbsAt), then the sidewalk (walkOf / walkLeftOf), or
// the median (centered, lamps and trees only and only when wide enough),
// or else the verge past the back of the sidewalk. The footprint is then
// tested on the ground itself (surfaceAt 1 is drivable: strips, gaps,
// junction areas and crosswalks); with no clear place the prop is dropped.
// Pure: no three.js, no DOM.
import { groundOf, GAP_MAX, SLIVER_MAX } from './ground.js';
import { ownField } from './lazy.js';
import { curbsAt, supAt, walkOf, walkLeftOf, medianBand, medianAt, pairGap, pointInRing, junctionsInBox } from './junctions.js';

// m kept between a prop's footprint and the drivable surface.
export const CURB_CLEAR = 0.15;
// Full median width (m, curb to curb) that takes a centered lamp or tree.
export const MEDIAN_LAMP = 2.0;
export const MEDIAN_TREE = 3.0;
// Half the widest median a pair can have (roadprofile.js PAIR_MAX 30).
const PAIR_HALF = 15;
// Along-the-edge slides tried when the first place is not clear (m).
const SLIDE = [0, 1.5, -1.5, 3, -3];
// Slides back from a junction (a signal or a stop sign; m).
const BACK = [0, 1, 2, 3, 4.5];
// The last mast of a junction: further back, and out to the verge (m).
const BACK_WIDE = [6, 7.5, 9, 10.5, 12], WANT_WIDE = 2.5;
// Nudges for a prop with no edge (corner blades): rings of 16 directions.
const RING_N = 16;
const RING_C = new Float64Array(RING_N), RING_S = new Float64Array(RING_N);
for (let k = 0; k < RING_N; k++) { RING_C[k] = Math.cos((k / RING_N) * Math.PI * 2); RING_S[k] = Math.sin((k / RING_N) * Math.PI * 2); }

// Is (x, z) inside or within R of one of the triangles (x, z sextuples)?
function trisNear(t, x, z, R) {
  for (let k = 0; k < t.length; k += 6) {
    const ax = t[k], az = t[k + 1], bx = t[k + 2], bz = t[k + 3], cx = t[k + 4], cz = t[k + 5];
    const d1 = (bx - ax) * (z - az) - (bz - az) * (x - ax);
    const d2 = (cx - bx) * (z - bz) - (cz - bz) * (x - bx);
    const d3 = (ax - cx) * (z - cz) - (az - cz) * (x - cx);
    if (!((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0))) return true;
    if (segNear(ax, az, bx, bz, x, z, R) || segNear(bx, bz, cx, cz, x, z, R) || segNear(cx, cz, ax, az, x, z, R)) return true;
  }
  return false;
}
function segNear(ax, az, bx, bz, x, z, R) {
  const dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz;
  let t = L2 > 0 ? ((x - ax) * dx + (z - az) * dz) / L2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const qx = ax + dx * t - x, qz = az + dz * t - z;
  return qx * qx + qz * qz < R * R;
}
// The paved gap beside edge k's side at d to d +- R (ground.js gapAt
// holds a value every 2 m station; a disc can reach the next one).
function gapNear(G, k, side, d, R) {
  return Math.max(G.gapAt(k, side, d), G.gapAt(k, side, d - R - 0.05), G.gapAt(k, side, d + R + 0.05));
}
// Per edge, the numbers the tests below read, worked out once per road
// geometry into typed arrays (the edge objects come in many shapes: a
// test that read them ran polymorphic): node a, unit direction, length,
// the strip's center offset (off + eoff) and half width, the sidewalk
// right and left, the median band, how far a taper moves either curb at
// most, and the end flags.
const ES = 11;
const F_INNER = 1, F_PED = 2, F_BRIDGE = 4, F_PLAIN_A = 8, F_PLAIN_B = 16, F_FAN_A = 32, F_FAN_B = 64;
const TABLES = new WeakMap();
function edgeTable(city) {
  const geo = city.roadGeo, edges = city.edges;
  let T = TABLES.get(geo);
  if (T && T.n === edges.length && T.city === city) return T;
  const n = edges.length;
  const v = new Float64Array(ES * n), f = new Uint8Array(n);
  const isFan = (q) => geo.jEnd[q] >= 0 && !!geo.junctions[geo.jEnd[q]].fan;
  for (let k = 0; k < n; k++) {
    const e = edges[k], a = city.nodes[e.a], o = ES * k;
    const off = (e.off || 0) + (geo.eoff ? geo.eoff[k] : 0), h = e.width / 2;
    let m = 0;
    for (let q = 2 * k; q < 2 * k + 2; q++) {
      if (!(geo.taper[q] > 0)) continue;
      m = Math.max(m, Math.abs(geo.tcl[q] - (off - h)), Math.abs(geo.tcr[q] - (off + h)));
    }
    v[o] = a.x; v[o + 1] = a.z; v[o + 2] = e.ux; v[o + 3] = e.uz; v[o + 4] = e.length;
    v[o + 5] = off; v[o + 6] = h; v[o + 7] = walkOf(e); v[o + 8] = walkLeftOf(e); v[o + 9] = medianBand(e); v[o + 10] = m;
    f[k] = (geo.inner[k] ? F_INNER : 0) | (e.ped ? F_PED : 0) | (e.bridge ? F_BRIDGE : 0) |
      (geo.jEnd[2 * k] >= 0 && !isFan(2 * k) ? F_PLAIN_A : 0) | (geo.jEnd[2 * k + 1] >= 0 && !isFan(2 * k + 1) ? F_PLAIN_B : 0) |
      (isFan(2 * k) ? F_FAN_A : 0) | (isFan(2 * k + 1) ? F_FAN_B : 0);
  }
  // (The tests below take this table, not the city: the city object
  // gains fields as the build goes on, and code that read it was compiled
  // again at each new shape.)
  T = { n, v, f, geo, city };
  TABLES.set(geo, T);
  return T;
}
// The curbs of edge k at d (world/junctions.js curbsAt, value for value,
// from the table) into CL, CR.
let CL = 0, CR = 0;
const smooth = (t) => t * t * (3 - 2 * t);
function curbs(geo, V, k, d) {
  const o = ES * k, len = V[o + 4];
  let l = V[o + 5] - V[o + 6], r = V[o + 5] + V[o + 6];
  const qa = 2 * k, qb = qa + 1;
  const ta = geo.taper[qa], tb = geo.taper[qb];
  if (ta > 0 && d < ta) {
    const f = geo.tlin[qa] ? Math.max(0, d) / ta : smooth(Math.max(0, d) / ta);
    l = geo.tcl[qa] + (l - geo.tcl[qa]) * f;
    r = geo.tcr[qa] + (r - geo.tcr[qa]) * f;
  }
  if (tb > 0 && d > len - tb) {
    const f = geo.tlin[qb] ? Math.max(0, len - d) / tb : smooth(Math.max(0, len - d) / tb);
    l = geo.tcl[qb] + (l - geo.tcl[qb]) * f;
    r = geo.tcr[qb] + (r - geo.tcr[qb]) * f;
  }
  CL = l; CR = r;
}
// The paved gap beside side (0 right, 1 left) of edge k0 at d (gapNear),
// asked of the ground only when another strip in the list could make
// one there: within 25 degrees of it (ground.js gapStation's rule),
// facing this curb, its own curb within GAP_MAX of it near the stations
// that d +- R reads (the stations lie up to R + 2.05 m along; a taper
// moves either curb by up to its amplitude). Asking the ground works out
// its stations, slow the first time; most curbs have no strip facing
// them.
const GAP_COS = Math.cos((25 * Math.PI) / 180) - 0.01;
const SIN_25 = 0.4227;
function gapMay(T, G, k0, side, d, R, list, n) {
  return gapCould(T, k0, side, d, R, list, n) ? gapNear(G, k0, side, d, R) : 0;
}
function gapCould(T, k0, side, d, R, list, n) {
  const geo = T.geo, V = T.v, F = T.f;
  const o0 = ES * k0;
  curbs(geo, V, k0, d);
  const ux = V[o0 + 2], uz = V[o0 + 3];
  const o = side ? CL : CR, dir = side ? -1 : 1;
  const px = V[o0] + ux * d - uz * o, pz = V[o0 + 1] + uz * d + ux * o;
  const nx = -uz * dir, nz = ux * dir;
  const span = R + 2.1, amp = V[o0 + 10], br = F[k0] & F_BRIDGE;
  for (let k = 0; k < n; k++) {
    const k2 = list[k];
    if (k2 === k0 || F[k2] & (F_INNER | F_PED) || (F[k2] & F_BRIDGE) !== br) continue;
    const o2 = ES * k2, ux2 = V[o2 + 2], uz2 = V[o2 + 3];
    if (Math.abs(ux * ux2 + uz * uz2) < GAP_COS) continue;
    const dx = px - V[o2], dz = pz - V[o2 + 1];
    const d2 = dx * ux2 + dz * uz2, s2 = -dx * uz2 + dz * ux2;
    const mv = span + amp + 1;
    if (d2 < geo.trim[2 * k2] - mv || d2 > V[o2 + 4] - geo.trim[2 * k2 + 1] + mv) continue;
    const sl = span * SIN_25 + amp + V[o2 + 10] + 0.05;
    const facing = nx * -uz2 + nz * ux2;
    const g = facing < 0 ? s2 - (V[o2 + 5] + V[o2 + 6]) : V[o2 + 5] - V[o2 + 6] - s2;
    if (g > -sl && g < GAP_MAX + sl) return true;
  }
  // (WP3, ground.js sliverGap: ground under SLIVER_MAX between this curb
  // and a strip at any angle, or a junction's asphalt, is paved too.)
  const rs = span + SLIVER_MAX + amp + 1.5;
  if (junctionsInBox(geo, px - rs, pz - rs, px + rs, pz + rs)) return true;
  for (let k = 0; k < n; k++) {
    const k2 = list[k];
    if (k2 === k0 || F[k2] & (F_INNER | F_PED) || (F[k2] & F_BRIDGE) !== br) continue;
    const o2 = ES * k2, len2 = V[o2 + 4];
    let t = (px - V[o2]) * V[o2 + 2] + (pz - V[o2 + 1]) * V[o2 + 3];
    t = t < 0 ? 0 : t > len2 ? len2 : t;
    const qx = V[o2] + V[o2 + 2] * t - px, qz = V[o2 + 1] + V[o2 + 3] * t - pz, r2 = rs + V[o2 + 6] + Math.abs(V[o2 + 5]) + V[o2 + 10];
    if (qx * qx + qz * qz < r2 * r2) return true;
  }
  return false;
}
export const ROAD_REACH = 7.5; // m past a curb a paved gap can reach
// m from road space (a strip with its sidewalk or median, a junction) within
// which land can be the narrow-gap net (world/ground.js: two rounds of
// NET_MAX 2 m), and how far a junction's corner sidewalks reach past it.
const NET_REACH = 4.2, CORNER = 3;
const NEAR = [], NEAR2 = [], JL = new Array(16).fill(null);
// (world/junctions.js junctionsAt's grid: its cells are JCELL m.)
const JCELL = 32;
// Does some side of the ring come within R of (x, z)?
function ringNear(ring, x, z, R) {
  const n = ring.length, R2 = R * R;
  for (let i = 0, j = n - 2; i < n; j = i, i += 2) {
    const ax = ring[j], az = ring[j + 1], dx = ring[i] - ax, dz = ring[i + 1] - az, L2 = dx * dx + dz * dz;
    let t = L2 > 0 ? ((x - ax) * dx + (z - az) * dz) / L2 : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const qx = ax + dx * t - x, qz = az + dz * t - z;
    if (qx * qx + qz * qz < R2) return true;
  }
  return false;
}
// Does the disc of radius R at (x, z) reach the drivable surface? Told
// from the cross sections where they can (a ground query is slow where
// many strips meet, the first time): a junction's ring (a fan's
// triangles) or gore within R, a strip's piece within R (to the node at a
// plain junction, mitered at a bend, 1.5 m past a dead end) or the paved
// gap beside it is road; a disc inside an edge's own sidewalk or median
// band is not, nor one on land with fewer than two road spaces (junctions
// within NET_REACH plus CORNER, edges within NET_REACH) round it (the
// narrow-gap net needs two). The ground decides (center and a ring at R)
// at a fan's arm end, at a nose, or on land between two road spaces.
// `list`, `n`: the edges to consider (else those near the disc). `net`
// false: the surface without the narrow-gap net (world/ground.js baseAt:
// strips, paved gaps, junctions, gores), so land past a band is never
// road. `quick`: true where the ground would be asked (a cheap first
// test of a large disc round a long feature).
export function discOnRoad(city, G, x, z, R, list = null, n = 0, quick = false, net = true) {
  if (!city.roadGeo) return quick || groundHit(G, x, z, R, net);
  return discTest(edgeTable(city), G, x, z, R, list, n, quick, net, true, null);
}
// discOnRoad with the junction test (`junctions` false: none is near)
// and the paved gap test (`noGap`: per list index, bit 1 the right side,
// bit 2 the left one, set where no gap can be: rowOnRoad) left out.
// (Split in small parts: the build runs it some 100 000 times, and one
// large function was compiled again at each of its rare first paths.)
function discTest(T, G, x, z, R, list, n, quick, net, junctions, noGap) {
  const geo = T.geo;
  let spaces = 0;
  if (junctions) {
    const j = junctionHit(geo, x, z, R, net ? R + NET_REACH + CORNER : R);
    if (j === 1) return true;
    if (j === 2) spaces++;
  }
  if (!list) { list = NEAR; n = edgesNearOf(T.city, x, z, R + ROAD_REACH, NEAR); }
  const r = edgesHit(T, G, x, z, R, list, n, net, noGap, spaces);
  if (r !== 2) return r === 1;
  return quick || groundHit(G, x, z, R, net);
}
// The junctions round the disc: inside or within R of a junction's ring
// (a fan's: its triangles) or a gore is road (1); one within RJ (the
// reach of the net) is road space near (2); else 0.
function junctionHit(geo, x, z, R, RJ) {
  let jNear = false, nj = 0;
  const i0 = Math.floor((x - RJ) / JCELL), i1 = Math.floor((x + RJ) / JCELL);
  const j0 = Math.floor((z - RJ) / JCELL), j1 = Math.floor((z + RJ) / JCELL);
  const multi = i0 !== i1 || j0 !== j1;
  for (let i = i0; i <= i1; i++) {
    for (let j = j0; j <= j1; j++) {
      const l = geo.jGrid.get(i * 100003 + j);
      if (!l) continue;
      for (let k = 0; k < l.length; k++) {
        const J = l[k];
        if (x + RJ < J.x0 || x - RJ > J.x1 || z + RJ < J.z0 || z - RJ > J.z1) continue;
        if (multi) {
          let seen = false;
          for (let m = 0; m < nj && !seen; m++) seen = JL[m] === J;
          if (seen) continue;
          if (nj < JL.length) JL[nj++] = J;
        }
        if (!jNear && junctionNear(J, x, z, RJ)) jNear = true;
        if (x + R < J.x0 || x - R > J.x1 || z + R < J.z0 || z - R > J.z1) continue;
        if (junctionNear(J, x, z, R)) return 1;
        for (let m = 0; m < J.gores.length; m++) if (pointInRing(J.gores[m].poly, x, z) || ringNear(J.gores[m].poly, x, z, R)) return 1;
      }
    }
  }
  return jNear ? 2 : 0;
}
const junctionNear = (J, x, z, R) => (J.fan ? trisNear(J.tris, x, z, R) : pointInRing(J.ring, x, z) || ringNear(J.ring, x, z, R));
// The edges in the list against the disc: 1 road, 0 not road, 2 the
// ground decides (a fan's arm end, a nose, or land between two road
// spaces with the net).
function edgesHit(T, G, x, z, R, list, n, net, noGap, spaces) {
  const geo = T.geo, V = T.v, F = T.f;
  let inBand = false;
  for (let q = 0; q < n; q++) {
    const k = list[q], fl = F[k];
    if (fl & F_INNER || (noGap !== null && noGap[q] & ROW_SKIP)) continue;
    const o = ES * k, ux = V[o + 2], uz = V[o + 3], len = V[o + 4];
    const dx = x - V[o], dz = z - V[o + 1];
    const d = dx * ux + dz * uz, sl = -dx * uz + dz * ux;
    // The strip's own piece at this lateral, as world/ground.js has it:
    // from its start to its end (mitered at a bend, 1.5 m past a dead
    // end), at a junction end on to the node under the junction's
    // polygon (not into a fan's mouth hull).
    const s0 = fl & F_PLAIN_A ? 0 : geo.trim[2 * k] + geo.miter[2 * k] * sl;
    const s1 = fl & F_PLAIN_B ? len : len - geo.trim[2 * k + 1] + geo.miter[2 * k + 1] * sl;
    if (d < Math.min(0, s0) - R - 0.5 || d > Math.max(len, s1) + R + 0.5) continue;
    // (Near the end at a fan junction the ground decides.)
    if ((d < s0 + R ? fl & F_FAN_A : d > s1 - R ? fl & F_FAN_B : 0) !== 0) return 2;
    curbs(geo, V, k, d < 0 ? 0 : d > len ? len : d);
    const cl = CL, cr = CR;
    const side = sl > cr ? 0 : 1;
    const out = sl > cr ? sl - cr : sl < cl ? cl - sl : 0;
    if (out < R) {
      // The disc reaches the strip's piece itself: road.
      const ad = d < s0 ? s0 - d : d > s1 ? d - s1 : 0;
      if (out * out + ad * ad < R * R) return 1;
      continue;
    }
    if (d < 0 || d > len) continue;
    if (out - R > ROAD_REACH) continue;
    const gap = noGap !== null && noGap[q] & (1 << side) ? 0 : gapMay(T, G, k, side, d, R, list, n);
    // (A paved gap to a facing strip is asphalt from the curb out; past
    // it this side has nothing.)
    if (gap > 0) { if (out - R < gap + 0.05) return 1; continue; }
    // (world/junctions.js supAt at d - R and d + R: a gore or nose.)
    const sq = 4 * k + side, sup0 = geo.sup[sq], sup1 = geo.sup[sq + 2];
    if (d - R < sup0 || d - R > len - sup1 || d + R < sup0 || d + R > len - sup1) { if (out - R <= NET_REACH) return 2; continue; }
    const band = side === 0 ? V[o + 7] : V[o + 9] > 0 ? medianOf(T.city, k, d, cl) : V[o + 8];
    if (out + R <= band - 0.05) inBand = true;
    if (out - band - R <= NET_REACH) spaces++;
  }
  // Inside a band (and on no strip) is not road; on land, only the net
  // can be, and only between two road spaces.
  return inBand || !net || spaces < 2 ? 0 : 2;
}
const medianOf = (city, k, d, cl) => medianAt(city, city.edges[k], d, cl);
const edgesNearOf = (city, x, z, r, out) => (city.edgesNear ? city.edgesNear(x, z, r, out).length : 0);
// The ground at the disc: the center, then four points on the rim of a
// small disc (a straight curb reaching into the prop's own radius,
// R - CURB_CLEAR, passes one of them up to R 0.51 m); a wider one sixteen
// and eight inside (a sharp corner of asphalt can reach between them).
function groundHit(G, x, z, R, net) {
  const at = net ? G.surfaceAt : G.roadAt || G.baseAt;
  if (at(x, z) === 1) return true;
  if (R <= 0.51) {
    for (let k = 2; k < RING_N; k += 4) if (at(x + RING_C[k] * R, z + RING_S[k] * R) === 1) return true;
    return false;
  }
  for (let k = 0; k < RING_N; k++) if (at(x + RING_C[k] * R, z + RING_S[k] * R) === 1) return true;
  for (let k = 1; k < RING_N; k += 2) if (at(x + RING_C[k] * R * 0.6, z + RING_S[k] * R * 0.6) === 1) return true;
  return false;
}

// Does any disc of radius R along the row from (x, z) - (ca, sa) * hl to
// (x, z) + (ca, sa) * hl, one every 1 m or less to both ends, reach the
// surface without the narrow-gap net (discOnRoad with net false, disc by
// disc, the same answer)? Worked out once for the row: whether any
// junction's grid cell is near it, and per edge in the list and side
// whether a paved gap can face the row anywhere along it (gapMay over the
// row's length).
const ROW_NOGAP = new Uint8Array(256);
// (bit 4 of a row's per edge flags: no disc of the row can find road,
// a gap, a fan end or a nose on that edge: the disc tests skip it.)
const ROW_SKIP = 4;
let ROW_LIVE = new Uint8Array(256); // per disc of the row: worth testing
export function rowOnRoad(city, G, x, z, ca, sa, hl, R, list, n) {
  const ns = Math.max(1, Math.ceil(2 * hl));
  if (!city.roadGeo || n > ROW_NOGAP.length) {
    for (let i = 0; i <= ns; i++) {
      const u = -hl + (2 * hl * i) / ns;
      if (discOnRoad(city, G, x + ca * u, z + sa * u, R, list, n, false, false)) return true;
    }
    return false;
  }
  return rowTest(edgeTable(city), G, x, z, ca, sa, hl, R, list, n, ns);
}
function rowTest(T, G, x, z, ca, sa, hl, R, list, n, ns) {
  const geo = T.geo;
  if (ROW_LIVE.length < ns + 1) ROW_LIVE = new Uint8Array(2 * (ns + 1));
  const live = ROW_LIVE, noGap = ROW_NOGAP;
  live.fill(0, 0, ns + 1);
  const V = T.v, F = T.f;
  for (let q = 0; q < n; q++) {
    const k = list[q], o = ES * k, ux = V[o + 2], uz = V[o + 3], len = V[o + 4];
    const dx = x - V[o], dz = z - V[o + 1];
    const d = dx * ux + dz * uz, sl = -dx * uz + dz * ux;
    // (gapMay at the projection of the row's middle, its reach along the
    // edge grown by the row's half length.)
    const dc = d < 0 ? 0 : d > len ? len : d, Rr = R + hl + Math.abs(d - dc);
    let f = (gapCould(T, k, 0, dc, Rr, list, n) ? 0 : 1) | (gapCould(T, k, 1, dc, Rr, list, n) ? 0 : 2);
    noGap[q] = f;
    if (F[k] & F_INNER) continue;
    // The row's reach across and along the edge (its two ends), and the
    // curbs anywhere along it (a taper moves them by up to its amplitude):
    // a row wholly off the strip by more than R, on a side with no gap,
    // away from the edge's fan ends, finds something on this edge only
    // where a disc is within NET_REACH of the curb and at a nose or an
    // end (discTest's supAt test: the ground decides there).
    const du = ca * ux + sa * uz, ds = du * hl, ss = (-ca * uz + sa * ux) * hl;
    const sMin = sl - Math.abs(ss), sMax = sl + Math.abs(ss), dMin = d - Math.abs(ds), dMax = d + Math.abs(ds);
    const amp = V[o + 10], crMax = V[o + 5] + V[o + 6] + amp, clMin = V[o + 5] - V[o + 6] - amp;
    const side = sMin > crMax + R ? 0 : sMax < clMin - R ? 1 : -1;
    if (side < 0 || !(f & (1 << side)) || F[k] & (F_FAN_A | F_FAN_B)) {
      // Else, disc by disc: one this edge's tests reach (within its strip's
      // reach along it, and across it within ROAD_REACH past a curb, or
      // anywhere across by a fan end, where the ground decides).
      const fan = F[k] & (F_FAN_A | F_FAN_B), sAbs = Math.max(Math.abs(sMin), Math.abs(sMax));
      const qa = 2 * k, qb = qa + 1;
      const s0 = F[k] & F_PLAIN_A ? 0 : geo.trim[qa] - Math.abs(geo.miter[qa]) * sAbs;
      const s1 = F[k] & F_PLAIN_B ? len : len - geo.trim[qb] + Math.abs(geo.miter[qb]) * sAbs;
      const dLo = Math.min(0, s0) - R - 0.6, dHi = Math.max(len, s1) + R + 0.6;
      const sLo = clMin - R - ROAD_REACH - 0.1, sHi = crMax + R + ROAD_REACH + 0.1;
      const su = -ca * uz + sa * ux;
      for (let i = 0; i <= ns; i++) {
        const u = -hl + (2 * hl * i) / ns, di = d + du * u;
        if (di < dLo || di > dHi) continue;
        const si = sl + su * u;
        if (fan || (si > sLo && si < sHi)) live[i] = 1;
      }
      continue;
    }
    noGap[q] = f | ROW_SKIP;
    const far = side === 0 ? sMin - crMax - R > NET_REACH : clMin - sMax - R > NET_REACH;
    if (far || dMax < 0 || dMin > len) continue;
    const sq = 4 * k + side, lo = geo.sup[sq] + R, hi = len - geo.sup[sq + 2] - R;
    if (dMin >= lo && dMax <= hi) continue;
    noGap[q] = f;
    for (let i = 0; i <= ns; i++) {
      const di = d + du * (-hl + (2 * hl * i) / ns);
      if (di >= 0 && di <= len && (di < lo || di > hi)) live[i] = 1;
    }
  }
  const rx = Math.abs(ca) * hl + R, rz = Math.abs(sa) * hl + R;
  const junctions = junctionsInBox(geo, x - rx, z - rz, x + rx, z + rz);
  for (let i = 0; i <= ns; i++) {
    const u = -hl + (2 * hl * i) / ns, px = x + ca * u, pz = z + sa * u;
    // (A disc no edge can find anything for and with no junction's grid
    // cell round it is off the road.)
    if (!live[i] && !(junctions && junctionsInBox(geo, px - R, pz - R, px + R, pz + R))) continue;
    if (discTest(T, G, px, pz, R, list, n, false, false, junctions, noGap)) return true;
  }
  return false;
}

// Is a disc of radius r at (x, z) clear of the drivable surface by
// CURB_CLEAR, out of buildings and on land? The drivable surface is the
// strips, the paved gaps, junction areas with their crosswalks and fans,
// and gores (ground.js baseAt 1); with `net`, also the narrow-gap net
// (surfaceAt 1: working it out at build cost about 0.5 s on the whole box,
// so the city's props are placed without it).
export function footClear(city, G, x, z, r, net = false, list = null, n = 0) {
  if (city.inBuilding && city.inBuilding(x, z, r + 0.1)) return false;
  if (city.mainShore && city.mainShore(x, z) < r + 0.5) return false;
  return !discOnRoad(city, G, x, z, r + CURB_CLEAR, list, n, false, net);
}

// The place of a prop of radius r beside edge e at d m from node a, on
// side (+1 right of a -> b, -1 left), `want` m out from the curb: into
// out.x, out.z, out.o (lateral offset right of the node line), out.on
// ('walk', 'median', 'verge'). kind: 'lamp', 'tree' (may stand on a wide
// median) or '' (sidewalk or verge only). Returns false when no place
// there is clear.
const OS = [0, 0, 0], ON = ['', '', ''];
export function curbSpot(city, G, e, d, side, want, r, kind, out) {
  const geo = city.roadGeo;
  if (!geo || !(d >= 0 && d <= e.length) || geo.inner[e.id]) return false;
  const a = city.nodes[e.a];
  const C = curbsAt(geo, e, d);
  const cl = C.l, cr = C.r;
  const si = side > 0 ? 0 : 1;
  let nn;
  // The gap to a facing strip under 6 m is asphalt: nothing stands there.
  {
    const o = side > 0 ? cr : cl, cx = a.x + e.ux * d - e.uz * o, cz = a.z + e.uz * d + e.ux * o;
    // (Every edge within reach of any place tried below: the prop stands
    // at most want, or its verge, past this curb point.)
    const reach = side < 0 && medianBand(e) > 0 ? PAIR_HALF : Math.max(want, 4);
    nn = city.edgesNear ? city.edgesNear(cx, cz, ROAD_REACH + reach + r + 1, NEAR2).length : 0;
    if (gapMay(edgeTable(city), G, e.id, si, d, r + CURB_CLEAR, NEAR2, nn) > 0) return false;
  }
  let n = 0;
  if (side < 0 && medianBand(e) > 0) {
    // A median: lamps and trees only, centered, from one edge of the pair.
    if (kind !== 'lamp' && kind !== 'tree') return false;
    if (e.pair >= 0 && e.pair < e.id) return false;
    if (supAt(geo, e, 1, d) || !(medianAt(city, e, d, cl) > 0)) return false;
    const gap = pairGap(city, e, d, cl);
    const full = Number.isFinite(gap) ? gap : 2 * medianBand(e);
    if (full < (kind === 'lamp' ? MEDIAN_LAMP : MEDIAN_TREE)) return false;
    ON[n] = 'median';
    OS[n++] = cl - full / 2;
  } else {
    const walk = supAt(geo, e, si, d) ? 0 : side > 0 ? walkOf(e) : walkLeftOf(e);
    const lo = r + CURB_CLEAR, hi = walk - r - 0.05;
    const verge = walk + r + 0.3;
    const curb = side > 0 ? cr : cl;
    if (hi >= lo) {
      // On the sidewalk at `want` (clamped to it), or set back as asked.
      ON[n] = want <= hi ? 'walk' : 'verge';
      OS[n++] = curb + side * (want <= hi ? Math.max(lo, want) : Math.max(want, verge));
      if (want > hi) { ON[n] = 'walk'; OS[n++] = curb + side * hi; }
    } else {
      ON[n] = 'verge';
      OS[n++] = curb + side * Math.max(want, verge);
    }
  }
  for (let k = 0; k < n; k++) {
    const o = OS[k];
    const x = a.x + e.ux * d - e.uz * o, z = a.z + e.uz * d + e.ux * o;
    if (!footClear(city, G, x, z, r, false, NEAR2, nn)) continue;
    out.x = x; out.z = z; out.o = o; out.on = ON[k];
    return true;
  }
  return false;
}

// Footprint radius of a street prop type (the disc that holds its solid).
const RADIUS = { lamp: 0.18, streettree: 0.25, palmtree: 0.3, tree: 0.3, palm: 0.3, signal: 0.16, stopsign: 0.08, streetsign: 0.08, namesign: 0.08 };
export const propRadius = (type) => RADIUS[type] ?? 0.35;

// Settles a city's street props on the real profile. `specs` maps a
// prop object to its placement [edge id, side, d, want, slide]: slide 0
// tries SLIDE both ways along the edge, +1 / -1 only that way (BACK: a
// signal or a stop sign moves back from its junction; a signal may take
// the far curb). A prop with no spec (a
// corner blade) stays if clear, else moves to the nearest clear point
// within 2 m, else goes. Signals keep their arm reaching the lane.
// Mutates city.props, city.furniture and city.signals; returns counts.
const P = { x: 0, z: 0, o: 0, on: '' };
export function settleStreetProps(city, specs) {
  const S = makeSettler(city, specs);
  if (!S) return { kept: 0, moved: 0, dropped: 0, median: 0, verge: 0 };
  S.keepIf(city.props, (p) => p.type);
  S.keepIf(city.furniture, (f) => f.type);
  S.signals();
  return S.stats;
}
// settleStreetProps on demand (0.15 build time): nothing is settled in the
// build; city.props, city.furniture, city.signals and city.nodes (the
// settle may turn a node's light off) become accessors that settle all
// of them, as settleStreetProps does and in its order, at the first read
// or write of any of them (or of holder[key], the stats). Then each is a
// plain data property again. The settle reads only what is final once
// the build is done (the roads, junctions, buildings and shore), so the
// lists, the nodes and the stats come out the same whenever the first
// read comes. Call it at the very end of the build. Returns nothing: the
// stats are holder[key].
const LAZY_KEYS = ['props', 'furniture', 'signals', 'nodes'];
export function settleStreetPropsLater(city, specs, holder = null, key = 'streetProps') {
  const val = {};
  for (const k of LAZY_KEYS) val[k] = city[k];
  let stats = null, busy = false;
  const resolve = () => {
    if (stats || busy) return;
    // (While it runs the accessors hand out the lists as they stand.)
    busy = true;
    try {
      stats = settleStreetProps(city, specs);
    } finally {
      busy = false;
    }
    for (const k of LAZY_KEYS) ownField(city, k, val[k]);
    if (holder) ownField(holder, key, stats);
  };
  const lazy = (o, k, get, set) => Object.defineProperty(o, k, { get, set, enumerable: true, configurable: true });
  for (const k of LAZY_KEYS) {
    lazy(city, k, () => { resolve(); return val[k]; }, (v) => {
      resolve();
      val[k] = v;
      if (!busy) ownField(city, k, v);
    });
  }
  if (holder) lazy(holder, key, () => { resolve(); return stats; }, (v) => { resolve(); ownField(holder, key, v); });
}
function makeSettler(city, specs) {
  const G = groundOf(city);
  const stats = { kept: 0, moved: 0, dropped: 0, median: 0, verge: 0 };
  if (!G || !city.roadGeo) return null;
  // `wide`: the last mast of a signaled junction, tried further back and
  // further out (BACK_WIDE, WANT_WIDE) once every nearer place failed.
  const settle = (item, type, wide = false) => {
    const r = propRadius(type);
    const sp = specs && specs.get(item);
    if (sp) {
      const e = city.edges[sp[0]], side = sp[1], d0 = sp[2], dir = sp[4] || 0;
      const want = wide ? WANT_WIDE : sp[3], slides = wide ? BACK_WIDE : dir ? BACK : SLIDE;
      const kind = type === 'lamp' ? 'lamp' : type === 'streettree' || type === 'palmtree' ? 'tree' : '';
      // A signal mast may stand on the far curb of its approach (the arm
      // then reaches back across): US junctions have near-side left masts.
      const nSides = type === 'signal' ? 2 : 1;
      for (let q = 0; q < nSides; q++) {
        const sd = q ? -side : side;
        for (let k = 0; k < slides.length; k++) {
          const s = dir ? slides[k] * dir : slides[k];
          if (!curbSpot(city, G, e, d0 + s, sd, want, r, kind, P)) continue;
          if (P.on === 'median') stats.median++;
          else if (P.on === 'verge') stats.verge++;
          const moved = Math.abs(P.x - item.x) > 0.01 || Math.abs(P.z - item.z) > 0.01;
          if (type === 'signal' && moved) {
            const ax = Math.cos(item.armDir), az = Math.sin(item.armDir);
            if (q) {
              // From the far curb the arm points the other way, out to the
              // middle of the approach's lanes as before.
              const ox = item.x + ax * item.armLen, oz = item.z + az * item.armLen;
              item.armDir += Math.PI;
              item.armLen = Math.max(0.6, -((ox - P.x) * ax + (oz - P.z) * az));
            } else {
              // The arm still ends over the same lane line.
              item.armLen = Math.max(0.6, item.armLen - ((P.x - item.x) * ax + (P.z - item.z) * az));
            }
          }
          item.x = P.x; item.z = P.z;
          if (moved) stats.moved++; else stats.kept++;
          return true;
        }
      }
      stats.dropped++;
      return false;
    }
    if (footClear(city, G, item.x, item.z, r)) { stats.kept++; return true; }
    for (let rr = 0.25; rr <= 2.001; rr += 0.25) {
      for (let k = 0; k < RING_N; k++) {
        const x = item.x + RING_C[k] * rr, z = item.z + RING_S[k] * rr;
        if (!footClear(city, G, x, z, r)) continue;
        item.x = x; item.z = z;
        stats.moved++;
        return true;
      }
    }
    stats.dropped++;
    return false;
  };
  const keepIf = (list, typeOf, dropped = null) => {
    if (!list) return;
    let n = 0;
    for (let i = 0; i < list.length; i++) {
      if (settle(list[i], typeOf(list[i]))) list[n++] = list[i];
      else if (dropped) dropped.push(list[i]);
    }
    list.length = n;
  };
  // A signaled junction keeps at least one mast: the node's light stops
  // cars (world/citygen.js signalState), so one with none would stop them
  // at a light no one can see. Where every mast of a junction was
  // dropped, each is tried again further back and out; when none fits
  // the junction loses its light (node.signal false, stats.unlit). (A
  // junction polygon that joins several nodes is one junction: a mast at
  // any of its nodes lights it.)
  const signals = () => {
    const dropped = [];
    keepIf(city.signals, () => 'signal', dropped);
    if (dropped.length && city.signals) {
      const nodeJ = city.roadGeo.nodeJ;
      const litKey = (id) => (nodeJ && nodeJ[id] >= 0 ? -1 - nodeJ[id] : id);
      const lit = new Set();
      for (const s of city.signals) lit.add(litKey(s.node));
      for (const item of dropped) {
        if (lit.has(litKey(item.node)) || !settle(item, 'signal', true)) continue;
        stats.dropped--;
        stats.rescued = (stats.rescued || 0) + 1;
        city.signals.push(item);
        lit.add(litKey(item.node));
      }
      // A junction with no visible light holds no signal on any of its nodes.
      const dark = new Set();
      for (const item of dropped) if (!lit.has(litKey(item.node))) dark.add(litKey(item.node));
      for (let i = 0; i < city.nodes.length; i++) {
        const node = city.nodes[i];
        if (!node.signal || !dark.has(litKey(i))) continue;
        node.signal = false;
        stats.unlit = (stats.unlit || 0) + 1;
      }
    }
  };
  return { stats, keepIf, signals };
}
