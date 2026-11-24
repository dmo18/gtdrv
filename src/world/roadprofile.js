// Road cross sections (docs/PLAN_V3.md 2.1 items 3 to 7; the edge
// contract in docs/MAP.md "Edge contract"). One pure function decides the
// lanes, widths, parking, sidewalk and median of every Miami road; nothing
// else decides a width. Runs in node tests: no three.js, no DOM.
//
// US practice: 3.3 m (11 ft) lanes on streets, 3.6 m (12 ft) on trunk and
// motorway; 2.4 m (8 ft) parking lanes on residential and tertiary
// streets; a 0.3 m gutter on each curb; 1.8 m (6 ft) sidewalks on
// residential streets and 3 m (10 ft) downtown and on Lincoln Road; a
// 0.15 m (6 in) curb.

export const LANE_W = 3.3;
export const LANE_W_FAST = 3.6;
export const PARK_W = 2.4;
export const GUTTER = 0.3;
export const CURB_H = 0.15;
export const SIDEWALK_RES = 1.8;
export const SIDEWALK_WIDE = 3.0;
// Divided roads (2.1 item 4): one-way ways of one name running opposite
// within PAIR_MAX m pair up; a data gap under MEDIAN_MIN m between their
// curbs is one undivided road (a double yellow line), a wider one a
// raised median, planted from MEDIAN_PLANT m. (0.11.0, ROADS: MEDIAN_MIN
// was 1.0; a median under 1.5 m read as a sliver of curb between the two
// halves, so the two now meet as one surface below MEDIAN_PLANT.)
export const PAIR_MAX = 30;
export const MEDIAN_MIN = 1.5;
export const MEDIAN_PLANT = 1.5;
// No edge is wider than this unless the data tags 4 lanes or more (test).
export const MAX_UNTAGGED_W = 15;

const FAST = new Set(['trunk', 'trunk_link', 'motorway', 'motorway_link']);
const PARKING = new Set(['residential', 'tertiary']);
const ONE_EACH = new Set(['residential', 'living_street', 'unclassified', 'tertiary', 'service', 'pedestrian']);
const LINK = /_link$/;
// The pedestrian streets drawn as paving (2.1 item 8).
export const PED_STREETS = new Set(['Lincoln Road', 'Espanola Way', 'Española Way']);

// The cross section of a way (a road of the data file, docs/MAP.md
// "Contents": class, oneway, lanes, lf, lb, name, bridge, mall).
// opts: { district } (the district key at the way, for the sidewalk),
// curbParking (a hand table says the street parks on its curbs where the
// data has no parking tags: MIAMI_SPOTS.curbParking), turnLane (Miami: a
// two-way road tagged lanes:forward / lanes:backward as 2 + 1 or 3 + 2 is
// an equal number each way and a center turn lane).
// Returns a new object with the edge contract's fields:
// { lanesF, lanesB, laneW, parkL, parkR, median, center, width, oneway,
//   sidewalk, ped, tagged }. `lanesF` is along the way's own direction
// (for `oneway: -1` the caller reverses the way first; this function
// treats any truthy oneway as "along the way"). `tagged`: the lane count
// came from the data. `center`: a painted two-way left-turn lane (odd
// tagged lane counts on a two-way road), part of the width.
export function roadProfile(way, opts = {}) {
  const cls = way.class || way.cls || 'residential';
  const name = way.name || '';
  const oneway = !!way.oneway;
  const ped = cls === 'pedestrian' || !!way.mall || PED_STREETS.has(name);
  const laneW = FAST.has(cls) ? LANE_W_FAST : LANE_W;
  let lanesF, lanesB, center = 0, tagged = false;
  const lanes = way.lanes > 0 ? way.lanes | 0 : 0;
  if (oneway) {
    lanesB = 0;
    if (lanes) { lanesF = lanes; tagged = true; }
    else if (LINK.test(cls)) lanesF = 1;
    else if (cls === 'motorway') lanesF = 3;
    else lanesF = ONE_EACH.has(cls) && cls !== 'tertiary' ? 1 : 2;
  } else if (way.lf > 0 || way.lb > 0) {
    // lanes:forward / lanes:backward; the missing one from `lanes`, and the
    // total kept to `lanes` where the tags disagree.
    let f = way.lf | 0, b = way.lb | 0;
    if (lanes) {
      if (!f) f = lanes - b;
      if (!b) b = lanes - f;
    }
    f = Math.max(1, f);
    b = Math.max(1, b);
    if (lanes >= 2 && f + b > lanes) {
      b = Math.max(1, lanes - f);
      if (f + b > lanes) f = Math.max(1, lanes - b);
    }
    // The odd lane of a two-way road mapped as 2 + 1 (or 3 + 2) is the shared
    // middle lane, which OSM assigns to either direction by way (Collins
    // Avenue and Alton Road swapped 2/1 and 1/2 every block): with `turnLane`
    // it is drawn as the painted center turn lane, so a street keeps one
    // count along its length. The width is the same.
    if (opts.turnLane && lanes >= 3 && (lanes & 1) && f + b === lanes && Math.abs(f - b) === 1) {
      f = b = Math.min(f, b);
      center = laneW;
    }
    lanesF = f;
    lanesB = b;
    if (lanes === f + b + 1) center = laneW;
    tagged = true;
  } else if (lanes) {
    tagged = true;
    if (lanes === 1) { lanesF = 1; lanesB = 1; }
    else {
      lanesF = lanesB = lanes >> 1;
      if (lanes & 1) center = laneW;
    }
  } else if (ONE_EACH.has(cls) || LINK.test(cls)) {
    lanesF = lanesB = 1;
  } else if (cls === 'motorway') {
    lanesF = lanesB = 3;
  } else {
    // secondary, primary, trunk: 2 each way.
    lanesF = lanesB = 2;
  }
  // Parking lanes: residential and tertiary streets, not on bridges, not
  // on a pedestrian street; a one-way street parks on both curbs too. A
  // street of three driving lanes (a turn lane counts) parks on the right
  // curb only and one of four or more on neither, so no untagged-wide
  // street passes MAX_UNTAGGED_W.
  const park = (PARKING.has(cls) || opts.curbParking) && !way.bridge && !ped ? PARK_W : 0;
  const drive = lanesF + lanesB + (center ? 1 : 0);
  const parkR = drive <= 3 ? park : 0, parkL = drive <= 2 ? park : 0;
  const width = (lanesF + lanesB) * laneW + center + parkL + parkR + 2 * GUTTER;
  const district = opts.district || '';
  const sidewalk = cls === 'motorway' || cls === 'motorway_link' || way.bridge ? 0
    : ped || district === 'downtown' || name === 'Lincoln Road' ? SIDEWALK_WIDE : SIDEWALK_RES;
  return { lanesF, lanesB, laneW, parkL, parkR, median: 0, center, width: round2(width), oneway, sidewalk, ped, tagged };
}

const round2 = (v) => Math.round(v * 100) / 100;

// Curb-to-curb width of a profile (the contract's formula; the median of a
// paired one-way lies outside its width).
export function profileWidth(p) {
  return round2((p.lanesF + p.lanesB) * p.laneW + (p.center || 0) + p.parkL + p.parkR + 2 * GUTTER);
}

// The divide of an edge: meters to the right of the node line seen a -> b
// (the center of a two-way road's center line or median; the left curb
// side of a one-way road's lanes). Includes `off`.
export function divideOf(e) {
  return (e.off || 0) - e.width / 2 + GUTTER + e.parkL + e.lanesB * e.laneW + (e.center || 0) / 2;
}

// Lane center offset, to the right of the node line seen in the direction
// of travel (docs/MAP.md laneOffset). lane 0 is next to the divide.
export function profileLaneOffset(e, lane, forward) {
  // Backward on a one-way (illegal): the forward lane's offset.
  if (!forward && !(e.lanesB > 0)) forward = true;
  const n = forward ? e.lanesF : e.lanesB;
  const k = lane < 0 ? 0 : lane >= n ? n - 1 : lane;
  const s = divideOf(e);
  return (forward ? s : -s) + (e.center || 0) / 2 + (k + 0.5) * e.laneW;
}

// Paint lines of an edge, as offsets to the right of the node line seen
// a -> b, into `out` (cleared): [offset, kind, ...] with kind
// 'yellow2' (double yellow), 'yellow' (solid yellow edge line), 'white'
// (solid white edge line), 'dash' (white dashed lane line), 'park'
// (parking lane line), 'turn' (yellow center turn lane edges, solid outer
// dashed inner as one 'turn' line). US style: crosswalks are two lines.
export function paintLines(e, out = []) {
  out.length = 0;
  const L = -e.width / 2 + GUTTER + (e.off || 0);
  const R = e.width / 2 - GUTTER + (e.off || 0);
  const s = divideOf(e);
  if (e.ped) return out;
  if (e.parkL > 0) out.push(L + e.parkL, 'park');
  if (e.parkR > 0) out.push(R - e.parkR, 'park');
  if (e.oneway) {
    // Yellow on the left edge, white on the right, dashes between lanes.
    out.push(L + e.parkL + 0.15, 'yellow');
    for (let k = 1; k < e.lanesF; k++) out.push(s + k * e.laneW, 'dash');
    if (!e.parkR) out.push(R - 0.15, 'white');
    return out;
  }
  const half = (e.center || 0) / 2;
  if (e.center) out.push(s - half + 0.1, 'turn', s + half - 0.1, 'turn');
  else out.push(s, 'yellow2');
  for (let k = 1; k < e.lanesF; k++) out.push(s + half + k * e.laneW, 'dash');
  for (let k = 1; k < e.lanesB; k++) out.push(s - half - k * e.laneW, 'dash');
  if (e.lanesF + e.lanesB >= 4 && !e.parkR) out.push(R - 0.15, 'white');
  if (e.lanesF + e.lanesB >= 4 && !e.parkL) out.push(L + 0.15, 'white');
  return out;
}

// Pairs the one-way edges of a city graph into divided roads (2.1 item
// 4). For each one-way edge, the nearest one-way edge of the same name
// running the opposite way (dot < -0.85) whose line passes within
// PAIR_MAX m on its LEFT (traffic keeps right, so the other carriageway
// is on the driver's left), measured from this edge's midpoint. Then
// gap = distance - (w1 + w2) / 2 between the two curbs:
// - gap >= MEDIAN_MIN: a raised median; the edge gets `median = gap`,
//   `divided = true`, `pair = partner id` (it owns the half of the median
//   along its left curb; the median is not part of its width);
// - gap < MEDIAN_MIN (overlapping slabs included): one undivided road;
//   the edge gets `off` (its cross section moved so the two left curbs
//   meet on the middle line) and `median = 0`; the two yellow left edge
//   lines read as a double yellow.
// edgesNear(x, z, r, out) is the city's grid query. Mutates edges; returns
// the count of paired edges.
export function pairDivided(nodes, edges, edgesNear) {
  const near = [];
  let paired = 0;
  for (const e of edges) {
    if (!e.oneway || !e.name || e.causeway) continue;
    const a = nodes[e.a], b = nodes[e.b];
    const mx = (a.x + b.x) / 2, mz = (a.z + b.z) / 2;
    edgesNear(mx, mz, PAIR_MAX, near);
    let best = null, bd = Infinity;
    for (let i = 0; i < near.length; i++) {
      const o = edges[near[i]];
      if (o === e || !o.oneway || o.name !== e.name) continue;
      if (e.ux * o.ux + e.uz * o.uz > -0.85) continue;
      const oa = nodes[o.a];
      // Foot of the midpoint on o's line, inside o.
      const t = ((mx - oa.x) * o.ux + (mz - oa.z) * o.uz);
      if (t < -2 || t > o.length + 2) continue;
      const fx = oa.x + o.ux * t, fz = oa.z + o.uz * t;
      // Lateral position of the foot to the right of e (negative: left).
      const lat = (fx - mx) * -e.uz + (fz - mz) * e.ux;
      if (lat >= 0) continue;
      const d = -lat;
      if (d < bd && d <= PAIR_MAX) { bd = d; best = o; }
    }
    if (!best) continue;
    const gap = bd - (e.width + best.width) / 2;
    e.pair = best.id;
    e.divided = true;
    if (gap >= MEDIAN_MIN) {
      e.median = round2(gap);
      e.off = 0;
    } else {
      e.median = 0;
      // Left curb (off - w/2) onto the middle line (-d/2).
      e.off = round2((e.width - bd) / 2);
    }
    paired++;
  }
  return paired;
}
