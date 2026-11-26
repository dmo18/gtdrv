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
import { groundOf } from './ground.js';
import { curbsAt, supAt, walkOf, walkLeftOf, medianBand, medianAt, pairGap, junctionsInBox, junctionsAt, pointInRing, ringDist } from './junctions.js';

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
// Can edge e have a paved gap here at all: another strip in the list
// that runs within 25 degrees of it (ground.js gapStation's rule; asking
// the ground works out its stations, slow the first time)?
const GAP_COS = Math.cos((25 * Math.PI) / 180) - 0.01;
function mayGap(city, e, list, n) {
  const geo = city.roadGeo;
  for (let k = 0; k < n; k++) {
    const o = city.edges[list[k]];
    if (o === e || geo.inner[o.id] || o.ped || !!o.bridge !== !!e.bridge) continue;
    if (Math.abs(e.ux * o.ux + e.uz * o.uz) >= GAP_COS) return true;
  }
  return false;
}
const plainEnd = (geo, q) => geo.jEnd[q] >= 0 && !geo.junctions[geo.jEnd[q]].fan;
export const ROAD_REACH = 7.5; // m past a curb a paved gap can reach
// m from road space (a strip with its sidewalk or median, a junction) within
// which land can be the narrow-gap net (world/ground.js: two rounds of
// NET_MAX 2 m), and how far a junction's corner sidewalks reach past it.
const NET_REACH = 4.2, CORNER = 3;
const NEAR = [], NEAR2 = [], JL = new Array(16).fill(null);
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
  const geo = city.roadGeo;
  let unsure = !geo, spaces = 0;
  const RJ = net ? R + NET_REACH + CORNER : R;
  if (geo && junctionsInBox(geo, x - RJ, z - RJ, x + RJ, z + RJ)) {
    // The junctions round the disc: inside or within R of a junction's
    // ring (a fan's: its triangles) or a gore is road; one within reach
    // of the net is road space near.
    let jNear = false, nj = 0;
    for (let q = 0; q < 5; q++) {
      const l = junctionsAt(geo, x + (q === 1 ? RJ : q === 2 ? -RJ : 0), z + (q === 3 ? RJ : q === 4 ? -RJ : 0));
      for (let k = 0; k < l.length; k++) {
        const J = l[k];
        if (x + RJ < J.x0 || x - RJ > J.x1 || z + RJ < J.z0 || z - RJ > J.z1) continue;
        let seen = false;
        for (let m = 0; m < nj && !seen; m++) seen = JL[m] === J;
        if (seen) continue;
        if (nj < JL.length) JL[nj++] = J;
        if (!jNear && (J.fan ? trisNear(J.tris, x, z, RJ) : pointInRing(J.ring, x, z) || ringDist(J.ring, x, z) < RJ)) jNear = true;
        if (x + R < J.x0 || x - R > J.x1 || z + R < J.z0 || z - R > J.z1) continue;
        if (J.fan ? trisNear(J.tris, x, z, R) : pointInRing(J.ring, x, z) || ringDist(J.ring, x, z) < R) return true;
        for (let m = 0; m < J.gores.length; m++) if (pointInRing(J.gores[m].poly, x, z) || ringDist(J.gores[m].poly, x, z) < R) return true;
      }
    }
    if (jNear) spaces++;
  }
  if (!unsure) {
    if (!list) { list = NEAR; n = city.edgesNear ? city.edgesNear(x, z, R + ROAD_REACH, NEAR).length : 0; }
    let inBand = false;
    for (let k = 0; k < n; k++) {
      const e = city.edges[list[k]];
      if (geo.inner[e.id]) continue;
      const a = city.nodes[e.a];
      const dx = x - a.x, dz = z - a.z;
      const d = dx * e.ux + dz * e.uz, sl = -dx * e.uz + dz * e.ux;
      // The strip's own piece at this lateral, as world/ground.js has it:
      // from its start to its end (mitered at a bend, 1.5 m past a dead
      // end), at a junction end on to the node under the junction's
      // polygon (not into a fan's mouth hull).
      const s0 = plainEnd(geo, 2 * e.id) ? 0 : geo.trim[2 * e.id] + geo.miter[2 * e.id] * sl;
      const s1 = plainEnd(geo, 2 * e.id + 1) ? e.length : e.length - geo.trim[2 * e.id + 1] + geo.miter[2 * e.id + 1] * sl;
      if (d < Math.min(0, s0) - R - 0.5 || d > Math.max(e.length, s1) + R + 0.5) continue;
      // (Near the end at a fan junction the ground decides.)
      const qe = d < s0 + R ? 2 * e.id : d > s1 - R ? 2 * e.id + 1 : -1;
      if (qe >= 0 && geo.jEnd[qe] >= 0 && geo.junctions[geo.jEnd[qe]].fan) { unsure = true; break; }
      const dc = d < 0 ? 0 : d > e.length ? e.length : d;
      const C = curbsAt(geo, e, dc);
      const side = sl > C.r ? 0 : 1, cl = C.l;
      const out = sl > C.r ? sl - C.r : sl < C.l ? C.l - sl : 0;
      if (out < R) {
        // The disc reaches the strip's piece itself: road.
        const ad = d < s0 ? s0 - d : d > s1 ? d - s1 : 0;
        if (out * out + ad * ad < R * R) return true;
        continue;
      }
      if (d < 0 || d > e.length) continue;
      if (out - R > ROAD_REACH) continue;
      const gap = mayGap(city, e, list, n) ? gapNear(G, e.id, side, d, R) : 0;
      // (A paved gap to a facing strip is asphalt from the curb out; past
      // it this side has nothing.)
      if (gap > 0) { if (out - R < gap + 0.05) return true; continue; }
      if (supAt(geo, e, side, d - R) || supAt(geo, e, side, d + R)) { if (out - R <= NET_REACH) { unsure = true; break; } continue; }
      const band = side === 0 ? walkOf(e) : medianBand(e) > 0 ? medianAt(city, e, d, cl) : walkLeftOf(e);
      if (out + R <= band - 0.05) inBand = true;
      if (out - band - R <= NET_REACH) spaces++;
    }
    // Inside a band (and on no strip) is not road; on land, only the net
    // can be, and only between two road spaces.
    if (!unsure && (inBand || !net || spaces < 2)) return false;
  }
  if (quick) return true;
  const at = net ? G.surfaceAt : G.baseAt;
  if (at(x, z) === 1) return true;
  // (Four points on the rim of a small disc (a straight curb reaching
  // into the prop's own radius, R - CURB_CLEAR, passes one of them up to
  // R 0.51 m); a wider one sixteen and eight inside: a sharp corner of
  // asphalt can reach between them.)
  if (R <= 0.51) {
    for (let k = 2; k < RING_N; k += 4) if (at(x + RING_C[k] * R, z + RING_S[k] * R) === 1) return true;
    return false;
  }
  for (let k = 0; k < RING_N; k++) if (at(x + RING_C[k] * R, z + RING_S[k] * R) === 1) return true;
  for (let k = 1; k < RING_N; k += 2) if (at(x + RING_C[k] * R * 0.6, z + RING_S[k] * R * 0.6) === 1) return true;
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
    if (mayGap(city, e, NEAR2, nn) && gapNear(G, e.id, si, d, r + CURB_CLEAR) > 0) return false;
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
  const G = groundOf(city);
  const stats = { kept: 0, moved: 0, dropped: 0, median: 0, verge: 0 };
  if (!G || !city.roadGeo) return stats;
  const settle = (item, type) => {
    const r = propRadius(type);
    const sp = specs && specs.get(item);
    if (sp) {
      const e = city.edges[sp[0]], side = sp[1], d0 = sp[2], want = sp[3], dir = sp[4] || 0;
      const kind = type === 'lamp' ? 'lamp' : type === 'streettree' || type === 'palmtree' ? 'tree' : '';
      // A signal mast may stand on the far curb of its approach (the arm
      // then reaches back across): US junctions have near-side left masts.
      const nSides = type === 'signal' ? 2 : 1;
      for (let q = 0; q < nSides; q++) {
        const sd = q ? -side : side;
        for (let k = 0; k < SLIDE.length; k++) {
          const s = dir ? BACK[k] * dir : SLIDE[k];
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
  const keepIf = (list, typeOf) => {
    if (!list) return;
    let n = 0;
    for (let i = 0; i < list.length; i++) if (settle(list[i], typeOf(list[i]))) list[n++] = list[i];
    list.length = n;
  };
  keepIf(city.props, (p) => p.type);
  keepIf(city.furniture, (f) => f.type);
  keepIf(city.signals, () => 'signal');
  return stats;
}
