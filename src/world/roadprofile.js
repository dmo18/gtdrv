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
// (0.15 WP1) A named two-way living_street or unclassified road is a
// residential street for parking (Meridian Avenue was 7.2 m south of 16th
// Street and 12 m north of it: one street, two classes).
const PARK_AS_RESIDENTIAL = new Set(['living_street', 'unclassified']);
// Local street classes: a two-way local street parks on one curb.
const LOCAL_TIER = new Set(['residential', 'living_street', 'unclassified', 'service', 'road', 'pedestrian']);
export const isLocalClass = (cls) => LOCAL_TIER.has(cls);
const LINK = /_link$/;
// Sane lanes by class (0.13.7 road logic; the owner drove 5 to 8 lane
// residential and collector streets that no city builds). Per class:
// [lanes each way on a two-way road (untagged, most), lanes of a one-way
// (untagged, most), center turn lane allowed]. A tag is kept inside these
// bounds; a two-way road's lanes are always equal each way, an odd total
// (or a tag past the cap where a turn lane is allowed) is the center turn
// lane. Local streets: 1 + 1; collectors (tertiary) 1 + 1 and a turn lane;
// arterials (secondary, primary) up to 2 + 2 and a turn lane; only trunks
// and motorways more.
const LOCAL = [1, 1, 1, 2, false];
const CAPS = {
  residential: LOCAL, living_street: LOCAL, unclassified: LOCAL, service: LOCAL, pedestrian: LOCAL, road: LOCAL,
  tertiary: [1, 1, 1, 2, true], tertiary_link: [1, 1, 1, 2, false],
  secondary: [2, 2, 2, 3, true], primary: [2, 2, 2, 3, true],
  secondary_link: [1, 1, 1, 2, false], primary_link: [1, 1, 1, 2, false],
  trunk: [2, 3, 2, 4, true], trunk_link: [1, 2, 1, 2, false],
  motorway: [3, 4, 3, 5, false], motorway_link: [1, 2, 1, 2, false],
};
// [two-way untagged, two-way max, one-way untagged, one-way max, center].
export function laneCaps(cls) {
  return CAPS[cls] || (LINK.test(cls) ? CAPS.primary_link : LOCAL);
}
const clampInt = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
// Local streets: no center line, no parking lane line (US residential
// streets are mostly unmarked).
const UNMARKED = new Set(['residential', 'living_street', 'unclassified', 'service', 'road']);
// The pedestrian streets drawn as paving (2.1 item 8).
export const PED_STREETS = new Set(['Lincoln Road', 'Espanola Way', 'Española Way']);

// The cross section of a way (a road of the data file, docs/MAP.md
// "Contents": class, oneway, lanes, lf, lb, name, bridge, mall).
// opts: { district } (the district key at the way, for the sidewalk),
// curbParking (a hand table says the street parks on its curbs where the
// data has no parking tags: MIAMI_SPOTS.curbParking). (`turnLane`, the
// 0.12.6 Beach rule, is now the rule everywhere: see laneCaps.)
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
  const cap = laneCaps(cls);
  if (oneway) {
    lanesB = 0;
    if (lanes) tagged = true;
    lanesF = clampInt(lanes || cap[2], 1, cap[3]);
  } else {
    // The total of the tags: lanes:forward + lanes:backward (the missing
    // one from `lanes`), else `lanes`. OSM gives the shared middle lane of
    // a 2 + 1 or 3 + 2 road to either direction by way (Collins Avenue and
    // Alton Road swapped 2/1 and 1/2 every block), and turn bays add a lane
    // a block: the road is drawn with equal lanes each way, the odd lane
    // as the painted center turn lane, so a street keeps one count.
    let total = 0;
    if (way.lf > 0 || way.lb > 0) {
      let f = way.lf | 0, b = way.lb | 0;
      if (lanes) {
        if (!f) f = lanes - b;
        if (!b) b = lanes - f;
      }
      f = Math.max(1, f);
      b = Math.max(1, b);
      total = Math.max(f + b, lanes);
      tagged = true;
    } else if (lanes) {
      total = lanes === 1 ? 2 : lanes;
      tagged = true;
    }
    if (!total) lanesF = cap[0];
    else {
      lanesF = clampInt(total >> 1, 1, cap[1]);
      // An odd total, or a tag past the class's lanes, is the turn lane.
      if (cap[4] && ((total & 1) || total > 2 * cap[1])) center = laneW;
    }
    lanesB = lanesF;
  }
  // Parking lanes: residential and tertiary streets (and named two-way
  // living streets and unclassified roads), not on bridges, not on a
  // pedestrian street. A two-way street of one lane each way parks on its
  // curbs, a wider one (or one with a turn lane) on neither; a one-way of
  // one or two lanes on both curbs, of three on the right only.
  // (0.15 WP1) A two-way local street parks on one curb (9.6 m: the 12 m
  // street with two nearly empty parking lanes read as four lanes); a
  // collector, or a street the hand table names (opts.curbParking), on
  // both. The curb is the right one here; harmonizeStreets puts every edge
  // of one street on the same curb.
  const byClass = PARKING.has(cls) || (!oneway && !!name && PARK_AS_RESIDENTIAL.has(cls));
  const park = (byClass || opts.curbParking) && !way.bridge && !ped ? PARK_W : 0;
  let parkL = 0, parkR = 0;
  if (oneway) {
    parkR = lanesF <= 3 ? park : 0;
    parkL = lanesF <= 2 ? park : 0;
  } else if (!center && lanesF === 1) {
    parkR = park;
    parkL = LOCAL_TIER.has(cls) && !opts.curbParking ? 0 : park;
  }
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
  // A local street of one lane each way (or a one-lane one-way) is not
  // marked at all; a wider local street gets its lane lines only.
  const local = UNMARKED.has(e.cls);
  if (local && !e.divided && !e.center) {
    // (Only the lane lines of a one-way of two lanes.)
    if (e.oneway) for (let k = 1; k < e.lanesF; k++) out.push(s + k * e.laneW, 'dash');
    return out;
  }
  if (!local && e.parkL > 0) out.push(L + e.parkL, 'park');
  if (!local && e.parkR > 0) out.push(R - e.parkR, 'park');
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
  const found = new Array(edges.length).fill(null), dist = new Float64Array(edges.length);
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
    found[e.id] = best;
    dist[e.id] = bd;
  }
  // A carriageway of a divided road parks on its right curb only: no
  // parking lane against the median or the other carriageway (0.13.7: two
  // overlapping halves each with two parking lanes made 24 m of asphalt).
  for (const e of edges) {
    if (!found[e.id] || !(e.parkL > 0)) continue;
    e.parkL = 0;
    e.width = profileWidth(e);
  }
  for (const e of edges) {
    const best = found[e.id];
    if (!best) continue;
    const bd = dist[e.id];
    const gap = bd - (e.width + best.width) / 2;
    // Raised median or one road: judged as if both halves parked on both
    // curbs where their class parks, so a half drawn narrower (no parking
    // against the partner, fewer lanes than a bad tag) does not turn the
    // space it gave up into a median.
    const gapN = bd - (nominalW(e) + nominalW(best)) / 2;
    e.pair = best.id;
    e.divided = true;
    if (gap >= MEDIAN_MIN && gapN >= MEDIAN_MIN) {
      e.median = round2(gap);
      e.off = 0;
    } else {
      e.median = 0;
      // Left curb (off - w/2) onto the middle line (-d/2).
      e.off = round2((e.width - bd) / 2);
      // (0.13.8) The drawn strip runs straight from the middle line at
      // node a to the middle line at node b (world/junctions.js
      // pairEnds): `off` is its middle, the mean of the two ends, so the
      // lanes lie in it (was: the gap at the edge's midpoint, a kink in
      // the curbs at the middle).
      // (Not on a bridge: the land under it was stamped along `off`.)
      const ga = e.bridge ? Infinity : endGap(nodes, edges, e, 0, edgesNear, near), gb = e.bridge ? Infinity : endGap(nodes, edges, e, 1, edgesNear, near);
      if (ga <= PAIR_MAX && gb <= PAIR_MAX) {
        const m = (e.width - (ga + gb) / 2) / 2;
        if (Math.abs(m - e.off) <= PAIR_END_MAX) e.off = round2(m);
      }
    }
    paired++;
  }
  return paired;
}
// Distance from edge e's node at `end` to the nearest one-way of its name
// running the other way on its left (any edge of the partner street;
// Infinity when none within PAIR_MAX m).
export const PAIR_END_MAX = 3;
export function endGap(nodes, edges, e, end, edgesNear, near) {
  const n = nodes[end ? e.b : e.a];
  edgesNear(n.x, n.z, PAIR_MAX, near);
  let bd = Infinity;
  for (let i = 0; i < near.length; i++) {
    const o = edges[near[i]];
    if (o === e || !o.oneway || o.name !== e.name || e.ux * o.ux + e.uz * o.uz > -0.85) continue;
    const oa = nodes[o.a];
    const t = (n.x - oa.x) * o.ux + (n.z - oa.z) * o.uz;
    if (t < -2 || t > o.length + 2) continue;
    const lat = (oa.x + o.ux * t - n.x) * -e.uz + (oa.z + o.uz * t - n.z) * e.ux;
    if (lat < 0 && -lat < bd) bd = -lat;
  }
  return bd;
}

const nominalW = (e) => (PARKING.has(e.cls) && !e.bridge && !e.ped ? e.width + 2 * PARK_W - e.parkL - e.parkR : e.width);

// One cross section along a street (0.13.7 road logic). OSM splits a
// street into many ways and tags them unevenly (a turn bay's extra lane, a
// block with parking tags, a lane count missing on one block), so the
// road went from big to small and back along one street. Edges of one
// street, joined where they run on through a node (same name, both
// one-way or both two-way, a one-way entering where the other leaves,
// within 35 degrees of straight; an unnamed road only at a bend), take the
// lanes, turn lane and parking of the cross section that covers most of
// that street's length. (0.15 WP1) Across a class change too, at a junction as
// at a bend: OSM changes the class of one street mid-way (Meridian Avenue
// living_street and residential, Northwest 3rd Avenue residential and
// tertiary), and the road doubled in width there; each edge keeps its
// class and its class's lane caps. Bridges keep no parking. Pedestrian
// streets and causeways are left alone.
// (0.15 WP1) Lanes across a split: a one-way half of a divided street that
// runs on straight from a two-way block of its name takes the lanes per
// direction of that street's one cross section (a 2 + 2 avenue splits into
// halves of 2, not of 1 or 3). Parking stays per kind.
// (0.15 WP1) One curb: a street that parks on one curb parks on the same
// side along all its edges (the side by a position hash of the street).
// Mutates edges (lanesF, lanesB, center, parkL, parkR, width, avenue);
// returns the count of edges changed.
const RUN_COS = Math.cos((35 * Math.PI) / 180), FORK = (15 * Math.PI) / 180;
// Parking key with left and right swapped (an edge running against its
// street's frame).
const swapLR = (k) => ((k & 1) << 1) | ((k & 2) >> 1);
// A small integer hash (the curb side of a one-curb street; no rng).
function sideHash(name, x, z) {
  let h = 0x811c9dc5;
  for (let i = 0; i < name.length; i++) h = Math.imul(h ^ name.charCodeAt(i), 0x01000193);
  h = Math.imul(h ^ (Math.round(x / 10) | 0), 0x27d4eb2d);
  h = Math.imul(h ^ (Math.round(z / 10) | 0), 0x165667b1);
  h ^= h >>> 15;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  return (h >>> 0) & 1;
}
// made: (optional) a mark per edge id, 1 on the two-way edges collapsePairs
// made of a pair (world/pairmerge.js).
export function harmonizeStreets(nodes, edges, made = null) {
  const n = edges.length;
  const isMade = (e) => !!made && made[e.id] === 1;
  // Street groups: a union-find with each edge's direction against its
  // root (par 1: runs the other way), so a one-curb street keeps its side.
  const uf = new Int32Array(n), par = new Uint8Array(n);
  for (let i = 0; i < n; i++) uf[i] = i;
  let fp = 0;
  const find = (v) => {
    let r = v, p = 0;
    while (uf[r] !== r) { p ^= par[r]; r = uf[r]; }
    for (let c = v, cp = p; c !== r;) {
      const nx = uf[c], old = par[c];
      uf[c] = r;
      par[c] = cp;
      cp ^= old;
      c = nx;
    }
    fp = p;
    return r;
  };
  const skip = (e) => e.ped || e.causeway || e.lanesF === undefined;
  // How straight e runs on into f through node (cosine of the turn; -2: not
  // the same street running on).
  const onward = (node, e, f, bend) => {
    if (f === e || skip(f)) return -2;
    if (e.oneway !== f.oneway || (e.name || '') !== (f.name || '')) return -2;
    if (!bend && !e.name) return -2;
    // (A pair collapsed into one road joins the street where its lanes
    // each way and turn lane agree: the data's lanes on either side stand.)
    if ((isMade(e) || isMade(f)) && (e.lanesF !== f.lanesF || !e.center !== !f.center)) return -2;
    // Directions leaving the node: straight on when they are opposite.
    const se = e.a === node.id ? 1 : -1, sf = f.a === node.id ? 1 : -1;
    const c = -(e.ux * se * f.ux * sf + e.uz * se * f.uz * sf);
    if (c < RUN_COS || (e.oneway && se === sf)) return -2;
    return c;
  };
  // Each edge end runs on into its straightest partner; two edges join
  // where each is the other's (a fork, two carriageways or a slip lane
  // leaving one street, joins neither branch: widened to the street's
  // lanes, the two branches ran over each other).
  // (Two partners within 15 degrees of each other: a fork, neither.)
  const bestOf = (node, e, bend) => {
    let best = -1, bc = -2, second = -2;
    for (let j = 0; j < node.edges.length; j++) {
      const c = onward(node, e, edges[node.edges[j]], bend);
      if (c > bc) { second = bc; bc = c; best = node.edges[j]; } else if (c > second) second = c;
    }
    if (bc <= -2 || (second > -2 && Math.acos(Math.min(1, second)) - Math.acos(Math.min(1, bc)) < FORK)) return -1;
    return best;
  };
  for (const node of nodes) {
    const list = node.edges;
    if (!list || list.length < 2) continue;
    const bend = list.length === 2;
    for (let i = 0; i < list.length; i++) {
      const e = edges[list[i]];
      if (skip(e)) continue;
      const f = bestOf(node, e, bend);
      if (f < 0 || f < e.id || bestOf(node, edges[f], bend) !== e.id) continue;
      // The same direction along the street when one arrives where the
      // other leaves.
      const rel = (e.a === node.id) === (edges[f].a === node.id) ? 1 : 0;
      const ra = find(e.id), pa = fp, rb = find(f), pb = fp;
      if (ra !== rb) { uf[ra] = rb; par[ra] = pa ^ pb ^ rel; }
    }
  }
  // Lane groups: the street groups, and a one-way half joined to the
  // two-way block of its name it runs on from (either way).
  const ul = new Int32Array(n);
  for (let i = 0; i < n; i++) ul[i] = find(i);
  const findL = (v) => {
    while (ul[v] !== v) { ul[v] = ul[ul[v]]; v = ul[v]; }
    return v;
  };
  // (Where the street splits: a one-way of the name leaves the node and
  // another arrives, the two halves; and a local one-way street that
  // becomes two-way. A one-way collector or arterial that becomes two-way
  // keeps its own lanes: downtown's one-way grid.)
  const halvesAt = (node, name) => {
    let out = false, inn = false;
    for (let j = 0; j < node.edges.length; j++) {
      const f = edges[node.edges[j]];
      if (skip(f) || !f.oneway || f.name !== name) continue;
      if (f.a === node.id) out = true; else inn = true;
    }
    return out && inn;
  };
  for (const node of nodes) {
    const list = node.edges;
    if (!list || list.length < 3) continue;
    for (let i = 0; i < list.length; i++) {
      const e = edges[list[i]];
      if (skip(e) || !e.oneway || !e.name || !(halvesAt(node, e.name) || LOCAL_TIER.has(e.cls))) continue;
      const se = e.a === node.id ? 1 : -1;
      for (let j = 0; j < list.length; j++) {
        const f = edges[list[j]];
        if (skip(f) || f.oneway || f.name !== e.name) continue;
        const sf = f.a === node.id ? 1 : -1;
        if (-(e.ux * se * f.ux * sf + e.uz * se * f.uz * sf) < RUN_COS) continue;
        const ra = findL(e.id), rb = findL(f.id);
        if (ra !== rb) ul[ra] = rb;
      }
    }
  }
  const mixed = new Uint8Array(n);
  for (const e of edges) if (!skip(e)) mixed[findL(e.id)] |= e.oneway ? 1 : 2;
  // Length per (group, cross section): lanes as lanesF and the turn lane
  // (a two-way road has equal lanes each way; a half in a mixed group
  // counts its lanes inside the two-way lanes of its class), parking as
  // left and right in the street group's frame. The longest edge of each
  // street group places a one-curb street's side.
  const lanesLen = new Map(), parkLen = new Map(), longest = new Map();
  // (And per street group alone, with the tagged length of each: a half
  // street the data tags keeps its own one section.)
  const lanesLenS = new Map(), tagLen = new Map();
  const add = (M, key, len) => M.set(key, (M.get(key) || 0) + len);
  for (const e of edges) {
    if (skip(e)) continue;
    const gl = findL(e.id);
    const lk = e.oneway && mixed[gl] === 3 ? Math.min(e.lanesF, laneCaps(e.cls)[1]) * 2 : e.lanesF * 2 + (e.center ? 1 : 0);
    // (A split street's two-way blocks decide its lanes: a half takes
    // their lanes per direction, and so does a pair collapsed into one
    // road, unless the collapsed pieces are all there is.)
    const weak = isMade(e) || (e.oneway && mixed[gl] === 3);
    add(lanesLen, gl * 64 + lk, weak ? e.length * 1e-3 : e.length);
    const g = find(e.id), p = fp;
    add(lanesLenS, g * 64 + e.lanesF * 2 + (e.center ? 1 : 0), e.length);
    if (e.lanesTag) add(tagLen, g, e.length);
    // (A two-way edge on one curb votes "one curb", either side: the side
    // is the street's, below.)
    let k = (e.parkL > 0 ? 2 : 0) + (e.parkR > 0 ? 1 : 0);
    if (!e.oneway && (k === 1 || k === 2)) k = 1;
    else if (p) k = swapLR(k);
    if (!e.bridge) add(parkLen, g * 4 + k, e.length);
    const L = longest.get(g);
    if (L === undefined || e.length > edges[L].length) longest.set(g, e.id);
  }
  const bestLanes = new Map(), bestPark = new Map();
  const pick = (M, div, out) => {
    for (const [key, len] of M) {
      const g = Math.floor(key / div), v = key - g * div;
      const b = out.get(g);
      if (!b || len > b[1] + 1e-9 || (Math.abs(len - b[1]) <= 1e-9 && v > b[0])) out.set(g, [v, len]);
    }
  };
  pick(lanesLen, 64, bestLanes);
  const bestLanesS = new Map();
  pick(lanesLenS, 64, bestLanesS);
  pick(parkLen, 4, bestPark);
  // A two-way street on one curb: the side by its longest edge's place.
  for (const [g, b] of bestPark) {
    if (b[0] !== 1 && b[0] !== 2) continue;
    const L = edges[longest.get(g)];
    if (L.oneway) continue;
    find(L.id);
    const a = nodes[L.a], bn = nodes[L.b];
    const own = sideHash(L.name || '', (a.x + bn.x) / 2, (a.z + bn.z) / 2) ? 2 : 1;
    b[0] = fp ? swapLR(own) : own;
  }
  let changed = 0;
  for (const e of edges) {
    if (e.causeway || e.lanesF === undefined) continue;
    // (A pedestrian street keeps its own lanes, inside the class's.)
    if (e.ped) fitSection(e, e.lanesF * 2 + (e.center ? 1 : 0), (e.parkL > 0 ? 2 : 0) + (e.parkR > 0 ? 1 : 0), FIT);
    else {
      const g = find(e.id), p = fp, gl = findL(e.id);
      const pk = e.bridge || !bestPark.has(g) ? 0 : bestPark.get(g)[0];
      // (A half in a mixed group: no more lanes than a two-way street of
      // its class carries each way.)
      let lk = bestLanes.get(gl)[0];
      // (A half street the data tags keeps its own one section: the tags
      // say the carriageways are wider or narrower than the street's
      // two-way blocks.)
      if (e.oneway && mixed[gl] === 3) lk = tagLen.has(g) ? bestLanesS.get(g)[0] & ~1 : Math.min(lk >> 1, laneCaps(e.cls)[1]) * 2;
      fitSection(e, lk, p ? swapLR(pk) : pk, FIT);
    }
    // A block the data tags under 4 lanes is not widened past
    // MAX_UNTAGGED_W by the rest of its street: it keeps its own lanes.
    if (FIT.width > MAX_UNTAGGED_W && (e.lanesTag || 0) * (e.merged ? 2 : 1) < 4) {
      fitSection(e, e.lanesF * 2 + (e.center ? 1 : 0), (e.parkL > 0 ? 2 : 0) + (e.parkR > 0 ? 1 : 0), FIT);
    }
    if (e.lanesF === FIT.lanesF && e.lanesB === FIT.lanesB && (e.center || 0) === FIT.center && e.parkL === FIT.parkL && e.parkR === FIT.parkR) continue;
    e.lanesF = FIT.lanesF;
    e.lanesB = FIT.lanesB;
    e.center = FIT.center;
    e.parkL = FIT.parkL;
    e.parkR = FIT.parkR;
    e.width = FIT.width;
    e.avenue = e.oneway ? e.lanesF >= 3 : e.lanesF >= 2;
    changed++;
  }
  return changed;
}
const FIT = { lanesF: 0, lanesB: 0, center: 0, parkL: 0, parkR: 0, width: 0 };
// The cross section of edge e for lanes key L (lanesF * 2 + turn lane) and
// parking key P (2 left, 1 right), inside the class's lanes (a pair of
// one-ways merged into one road carries both halves' lanes) and the
// parking rule of roadProfile, into out.
function fitSection(e, L, P, out) {
  const cap = laneCaps(e.cls);
  let lanesF = L >> 1, center = L & 1 ? e.laneW : 0;
  if (lanesF > cap[e.oneway ? 3 : 1]) {
    lanesF = cap[e.oneway ? 3 : 1];
    if (!e.oneway && cap[4]) center = e.laneW;
  }
  if (center && (e.oneway || !cap[4])) center = 0;
  out.lanesF = lanesF;
  out.lanesB = e.oneway ? 0 : lanesF;
  out.center = center;
  out.parkL = P & 2 && (e.oneway ? lanesF <= 2 : !center && lanesF === 1) ? PARK_W : 0;
  out.parkR = P & 1 && (e.oneway ? lanesF <= 3 : !center && lanesF === 1) ? PARK_W : 0;
  out.width = round2((out.lanesF + out.lanesB) * e.laneW + center + out.parkL + out.parkR + 2 * GUTTER);
  return out;
}
