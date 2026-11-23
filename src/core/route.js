// GPS routes (docs/PLAN_V3.md 2.7 item 1, task NAV). Pure: no three.js, no DOM.
//
// createRouter(city) searches the road graph (city.nodes / city.edges) with
// A*: one-way edges are only entered from node `a` (citygen canDrive), the
// cost is the length times a road-class factor plus a small penalty per
// turn, so a route keeps to the big named roads the way a driver would.
// The graph is the region's own (bridges and causeways are ordinary edges;
// nothing outside the crop exists), and the destination is clamped into
// the region box first.
//
// A route is a polyline of lane points (lane 0 of each edge, citygen
// lanePoint), with the cumulative length and drive time per point and a
// turn list (left, right, slight, sharp, U-turn, merge, exit, arrive), each
// with the street name after it. createTracker() follows the car along it
// with a cursor (no search per frame, no allocation per frame), re-routes
// when the car is more than OFF_ROUTE_M off the line for OFF_ROUTE_S, and
// gives the distance to the next turn, the remaining distance and the ETA.
//
// Coordinates: x east, z south. Heading 0 faces +x and grows toward +z, so
// a positive turn angle is a right turn.
import { lanePoint, canDrive } from '../world/citygen.js';
import { formatDistance, formatMiles } from './units.js';

export const OFF_ROUTE_M = 40; // off the line by more than this ...
export const OFF_ROUTE_S = 1.0; // ... for this long: re-route
export const REROUTE_GAP_S = 0.5; // at most one search per this long
export const ARRIVE_M = 22; // this close to the end: arrived
export const UTURN_COST = 120; // meters added for starting with a U-turn
const TURN_COST_R = 8, TURN_COST_L = 16; // meters added per right / left turn
const MERGE_M = 32; // two turns closer than this read as one (divided roads)
const MAX_PTS = 8192;
const MAX_TURNS = 400;
const FEET_PER_METER = 3.28084;

// Cost factor per road class (lower = preferred). Pedestrian streets are
// drivable in the sandbox but a route uses them only when nothing else goes.
const CLASS_COST = {
  motorway: 0.7, motorway_link: 0.8, trunk: 0.75, trunk_link: 0.85,
  primary: 0.82, primary_link: 0.9, secondary: 0.88, secondary_link: 0.92,
  tertiary: 0.94, causeway: 0.85, residential: 1, unclassified: 1, street: 1, avenue: 0.9,
  living_street: 1.6, service: 1.4, pedestrian: 4,
};
const MIN_COST = 0.7;
// Free-flow speed per class (m/s) for the ETA, when the edge has no posted mph.
const CLASS_SPEED = {
  motorway: 24.6, motorway_link: 15.6, trunk: 17.9, trunk_link: 13.4, primary: 15.6, primary_link: 11.2,
  secondary: 13.4, secondary_link: 11.2, tertiary: 12.5, causeway: 15.6, residential: 11.2, unclassified: 11.2,
  living_street: 6.7, service: 6.7, pedestrian: 4.5,
};

function edgeCost(e) {
  if (e.ped || e.cls === 'pedestrian') return 4;
  const k = CLASS_COST[e.cls];
  if (k !== undefined) return k;
  return e.avenue ? 0.9 : 1;
}
function edgeSpeed(e) {
  if (e.mph > 0) return e.mph * 0.44704 * 0.85;
  const v = CLASS_SPEED[e.cls];
  if (v !== undefined) return v;
  return e.avenue ? 13.4 : 11.2;
}
const isFast = (cls) => cls === 'motorway' || cls === 'trunk';
const isLink = (cls) => typeof cls === 'string' && cls.endsWith('_link');

// Short American street names for the HUD: "Alton Road" -> "Alton Rd",
// "West 28th Street" -> "W 28th St". Cached per name.
const ABBR = {
  Road: 'Rd', Street: 'St', Avenue: 'Ave', Drive: 'Dr', Boulevard: 'Blvd', Causeway: 'Cswy', Court: 'Ct',
  Place: 'Pl', Lane: 'Ln', Terrace: 'Ter', Parkway: 'Pkwy', Highway: 'Hwy', Expressway: 'Expy', Circle: 'Cir',
  Trail: 'Trl', Square: 'Sq', Plaza: 'Plz', Point: 'Pt',
};
const DIRS = { North: 'N', South: 'S', East: 'E', West: 'W', Northeast: 'NE', Northwest: 'NW', Southeast: 'SE', Southwest: 'SW' };
const shortCache = new Map();
export function shortStreet(name) {
  if (!name) return '';
  let s = shortCache.get(name);
  if (s !== undefined) return s;
  const w = String(name).split(' ');
  for (let i = 0; i < w.length; i++) {
    if (i === w.length - 1 && w.length > 1 && ABBR[w[i]]) w[i] = ABBR[w[i]];
    else if (i === 0 && w.length > 2 && DIRS[w[i]]) w[i] = DIRS[w[i]];
    else if (i === w.length - 2 && w.length > 2 && ABBR[w[i]] && DIRS[w[i + 1]]) w[i] = ABBR[w[i]];
  }
  s = w.join(' ');
  if (shortCache.size < 4000) shortCache.set(name, s);
  return s;
}

// Distance as a prompt reads it: "50 ft" steps under 1,000 ft (10 ft under
// 100 ft), then "0.3 mi" (src/core/units.js formatDistance).
export function formatTurnDistance(m) {
  if (!Number.isFinite(m) || m < 0) return '';
  const ft = m * FEET_PER_METER;
  const step = ft < 100 ? 10 : 50;
  const r = Math.max(step, Math.round(ft / step) * step);
  if (r < 1000) return formatDistance(r / FEET_PER_METER);
  return formatMiles(Math.max(m, 161)); // never "0.0 mi"
}

// ETA text: "1 min", "12 min", "1 h 5 min".
export function formatEta(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return '';
  const min = Math.max(1, Math.round(seconds / 60));
  if (min < 60) return min + ' min';
  return Math.floor(min / 60) + ' h ' + (min % 60) + ' min';
}

export const TURN_KINDS = ['depart', 'left', 'right', 'slight-left', 'slight-right', 'sharp-left', 'sharp-right', 'uturn', 'merge', 'exit', 'arrive'];
const VERB = {
  depart: 'Head out', left: 'turn left', right: 'turn right', 'slight-left': 'bear left', 'slight-right': 'bear right',
  'sharp-left': 'make a sharp left', 'sharp-right': 'make a sharp right', uturn: 'make a U-turn', merge: 'merge', exit: 'take the exit', arrive: 'arrive',
};
// Kind of a turn from its signed angle in radians (positive: right).
export function turnKind(angle) {
  const a = Math.abs(angle) * (180 / Math.PI);
  const r = angle > 0;
  if (a >= 155) return 'uturn';
  if (a >= 125) return r ? 'sharp-right' : 'sharp-left';
  if (a >= 50) return r ? 'right' : 'left';
  return r ? 'slight-right' : 'slight-left';
}

// The instruction for one turn: "turn right onto Alton Rd" (lower case
// first letter; turnText capitalizes when it stands alone).
export function turnPhrase(t) {
  if (!t) return '';
  if (t.kind === 'arrive') return t.name ? 'arrive at ' + t.name : 'arrive';
  const v = VERB[t.kind] || 'continue';
  if (t.kind === 'uturn') return t.name ? v + ' onto ' + t.name : v;
  return t.name ? v + ' onto ' + t.name : v;
}
const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
// The prompt: "In 300 ft, turn right onto Alton Rd", or "Turn right onto
// Alton Rd" when it is right there.
export function turnText(t, dist) {
  if (!t) return '';
  const p = turnPhrase(t);
  if (!(dist > 15)) return cap(p);
  return 'In ' + formatTurnDistance(dist) + ', ' + p;
}

// A route, preallocated (fill it with router.search). Points: x, z, cum
// (meters from the start), tim (seconds from the start), seg edge id per
// point (the edge the segment from this point runs on).
export function createRoute(maxPts = MAX_PTS, maxTurns = MAX_TURNS) {
  const turns = [];
  for (let i = 0; i < maxTurns; i++) turns.push({ kind: '', angle: 0, at: 0, idx: 0, x: 0, z: 0, name: '', full: '', node: -1 });
  return {
    ok: false, rev: 0, n: 0, length: 0, time: 0,
    pathE: new Int32Array(maxPts), pathFrom: new Int32Array(maxPts),
    x: new Float32Array(maxPts), z: new Float32Array(maxPts), cum: new Float32Array(maxPts), tim: new Float32Array(maxPts), seg: new Int32Array(maxPts),
    turns, turnCount: 0,
    destX: 0, destZ: 0, startUturn: false, partial: false, edges: 0, searchMs: 0, expanded: 0,
  };
}

// The nearest drivable point to (x, z): the edge, the distance along it from
// node a, the squared distance. Scans every edge (search time only).
function nearestEdge(city, x, z, out, heading, legal = true) {
  const nodes = city.nodes, edges = city.edges;
  const hx = Number.isFinite(heading) ? Math.cos(heading) : 0, hz = Number.isFinite(heading) ? Math.sin(heading) : 0;
  const useH = hx !== 0 || hz !== 0;
  let best = -1, bd = Infinity, bt = 0, bs = Infinity;
  for (let k = 0; k < edges.length; k++) {
    const e = edges[k];
    const a = nodes[e.a], b = nodes[e.b];
    const dx = b.x - a.x, dz = b.z - a.z;
    const l2 = dx * dx + dz * dz || 1;
    let t = ((x - a.x) * dx + (z - a.z) * dz) / l2;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const px = a.x + dx * t - x, pz = a.z + dz * t - z;
    const d2 = px * px + pz * pz;
    // With a heading: an edge along the car wins over a cross street a few meters nearer.
    // And a one-way the car would drive the wrong way loses to its partner
    // carriageway nearby (about 25 m).
    let score = d2;
    if (useH) {
      const dot = hx * e.ux + hz * e.uz;
      score += (1 - Math.abs(dot)) * 80;
      if (legal && e.oneway && dot < 0) score += 600;
    }
    if (score < bs) { bs = score; bd = d2; best = k; bt = t; }
  }
  out.edge = best;
  out.d = best >= 0 ? bt * edges[best].length : 0;
  out.d2 = bd;
  return out;
}

export function createRouter(city, opts = {}) {
  const nodes = city.nodes, edges = city.edges;
  const N = nodes.length;
  const box = opts.bounds || city.crop || null;
  const cost = new Float32Array(edges.length);
  const speed = new Float32Array(edges.length);
  for (let k = 0; k < edges.length; k++) { cost[k] = edgeCost(edges[k]); speed[k] = edgeSpeed(edges[k]); }
  // A* state over nodes (+1: the virtual goal), reused per search.
  const G = new Float64Array(N + 1);
  const prevN = new Int32Array(N + 1), prevE = new Int32Array(N + 1);
  const seen = new Uint32Array(N + 1), closed = new Uint32Array(N + 1);
  let mark = 0;
  let HN = new Int32Array(1024), HF = new Float64Array(1024), HL = 0;
  const push = (v, f) => {
    if (HL >= HN.length) {
      const n2 = new Int32Array(HN.length * 2); n2.set(HN); HN = n2;
      const f2 = new Float64Array(HF.length * 2); f2.set(HF); HF = f2;
    }
    let i = HL++;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (HF[p] <= f) break;
      HN[i] = HN[p]; HF[i] = HF[p];
      i = p;
    }
    HN[i] = v; HF[i] = f;
  };
  const pop = () => {
    const top = HN[0];
    const lv = HN[--HL], lf = HF[HL];
    let i = 0;
    for (;;) {
      let c = 2 * i + 1;
      if (c >= HL) break;
      if (c + 1 < HL && HF[c + 1] < HF[c]) c++;
      if (HF[c] >= lf) break;
      HN[i] = HN[c]; HF[i] = HF[c];
      i = c;
    }
    if (HL > 0) { HN[i] = lv; HF[i] = lf; }
    return top;
  };
  const pathN = new Int32Array(N + 2), pathE = new Int32Array(N + 2);
  const jcum = new Float64Array(N + 2); // cumulative distance of path junction i
  const snapA = { edge: -1, d: 0, d2: 0 }, snapB = { edge: -1, d: 0, d2: 0 };
  const P = { x: 0, z: 0, heading: 0 };
  const GOAL = N;

  // Unit direction of edge `e` when driven away from node `from`.
  const dirX = (e, from) => (e.a === from ? e.ux : -e.ux);
  const dirZ = (e, from) => (e.a === from ? e.uz : -e.uz);
  const turnCost = (e0, from0, e1, from1) => {
    const ax = dirX(e0, from0), az = dirZ(e0, from0), bx = dirX(e1, from1), bz = dirZ(e1, from1);
    const cr = ax * bz - az * bx, dt = ax * bx + az * bz;
    if (dt > 0.8) return 0;
    return cr > 0 ? TURN_COST_R : TURN_COST_L;
  };
  const relax = (v, g, pn, pe, tx, tz) => {
    if (seen[v] !== mark) { seen[v] = mark; G[v] = Infinity; }
    if (closed[v] === mark || g >= G[v]) return;
    G[v] = g; prevN[v] = pn; prevE[v] = pe;
    const h = v === GOAL ? 0 : Math.hypot(nodes[v].x - tx, nodes[v].z - tz) * MIN_COST;
    push(v, g + h);
  };

  const gE = new Int32Array(2), gD = new Float64Array(2);
  let gCount = 1, bestNode = -1;
  // A* from the start edge (both ends seeded; the one behind costs a
  // U-turn) to the virtual GOAL node, entered from the goal edges.
  function astar(es, sd, fwd, tx, tz, ok) {
    mark++;
    HL = 0;
    bestNode = -1;
    let bestD = Infinity, expanded = 0;
    if (ok(es, es.a)) relax(es.b, (es.length - sd) * cost[es.id] + (fwd ? 0 : UTURN_COST), -1, es.id, tx, tz);
    if (ok(es, es.b)) relax(es.a, sd * cost[es.id] + (fwd ? UTURN_COST : 0), -1, es.id, tx, tz);
    let found = false;
    while (HL > 0) {
      const u = pop();
      if (closed[u] === mark) continue;
      closed[u] = mark;
      expanded++;
      if (u === GOAL) { found = true; break; }
      const n = nodes[u];
      const dd = Math.hypot(n.x - tx, n.z - tz);
      if (dd < bestD) { bestD = dd; bestNode = u; }
      const inE = prevE[u];
      const inFrom = prevN[u] >= 0 ? prevN[u] : (edges[inE].a === u ? edges[inE].b : edges[inE].a);
      const gu = G[u];
      for (let q = 0; q < gCount; q++) { // onto a goal edge
        const ge = edges[gE[q]];
        if (inE === ge.id) continue;
        if (u === ge.a && ok(ge, ge.a)) relax(GOAL, gu + gD[q] * cost[ge.id] + turnCost(edges[inE], inFrom, ge, u), u, ge.id, tx, tz);
        if (u === ge.b && ok(ge, ge.b)) relax(GOAL, gu + (ge.length - gD[q]) * cost[ge.id] + turnCost(edges[inE], inFrom, ge, u), u, ge.id, tx, tz);
      }
      for (let k = 0; k < n.edges.length; k++) {
        const id = n.edges[k];
        if (id === inE) continue; // no U-turn at a junction
        const e = edges[id];
        if (!ok(e, u)) continue;
        const v = e.a === u ? e.b : e.a;
        relax(v, gu + e.length * cost[id] + turnCost(edges[inE], inFrom, e, u), u, id, tx, tz);
      }
    }
    expandedLast = expanded;
    return found;
  }
  let expandedLast = 0;

  // Fill `route` with the way from (fx, fz) facing `heading` to (tx, tz).
  // Returns route.ok. legal: false ignores one-way rules (on foot).
  function search(fx, fz, heading, tx, tz, route, legal = true) {
    const t0 = typeof performance !== 'undefined' ? performance.now() : 0;
    route.ok = false;
    route.rev++;
    route.n = 0;
    route.turnCount = 0;
    route.length = 0;
    route.time = 0;
    route.startUturn = false;
    if (!N || !edges.length) return false;
    if (box) {
      tx = Math.max(box.x0 + 5, Math.min(box.x1 - 5, tx));
      tz = Math.max(box.z0 + 5, Math.min(box.z1 - 5, tz));
    }
    nearestEdge(city, fx, fz, snapA, heading, legal);
    nearestEdge(city, tx, tz, snapB);
    if (snapA.edge < 0 || snapB.edge < 0) return false;
    const es = edges[snapA.edge];
    let eg = edges[snapB.edge];
    // Goal edges: the nearest, and its partner on a divided road (the
    // other carriageway is as good a place to stop as the near one).
    gE[0] = eg.id; gD[0] = snapB.d; gCount = 1;
    if (eg.pair !== undefined && eg.pair >= 0 && edges[eg.pair]) {
      const p2 = edges[eg.pair], a2 = nodes[p2.a];
      gE[1] = p2.id;
      gD[1] = Math.max(0, Math.min(p2.length, (tx - a2.x) * p2.ux + (tz - a2.z) * p2.uz));
      gCount = 2;
    }
    const fwd = Math.cos(heading) * es.ux + Math.sin(heading) * es.uz >= 0;
    const ok = (e, from) => !legal || canDrive(e, from);
    // Same edge: straight there (with a U-turn first when it is behind on a two-way road).
    let direct = 0; // 1 forward (a -> b), -1 backward
    let directU = false;
    if (snapA.edge === snapB.edge) {
      const ahead = fwd ? snapB.d >= snapA.d : snapB.d <= snapA.d;
      const want = snapB.d >= snapA.d ? 1 : -1;
      if (ok(es, want > 0 ? es.a : es.b)) { direct = want; directU = !ahead; }
    }
    let pc = 0;
    let startFrom = -1; // node id the start edge is driven away from (its direction)
    route.partial = false;
    if (!direct) {
      let found = astar(es, snapA.d, fwd, tx, tz, ok);
      if (!found && bestNode >= 0 && prevE[bestNode] >= 0) {
        // No way to the spot (another island, a one-way trap): to the
        // nearest junction the car can reach instead.
        const e = edges[prevE[bestNode]];
        gE[0] = e.id; gD[0] = bestNode === e.a ? 0 : e.length; gCount = 1;
        route.partial = true;
        found = astar(es, snapA.d, fwd, nodes[bestNode].x, nodes[bestNode].z, ok);
      }
      if (!found) { route.searchMs = (typeof performance !== 'undefined' ? performance.now() : 0) - t0; return false; }
      eg = edges[prevE[GOAL]];
      snapB.d = gD[eg.id === gE[0] ? 0 : 1];
      // Walk back: GOAL <- ... <- seed node.
      let v = GOAL;
      while (v >= 0 && pc < pathN.length) {
        pathN[pc] = v;
        pathE[pc] = prevE[v];
        pc++;
        v = prevN[v];
      }
      for (let i = 0, j = pc - 1; i < j; i++, j--) {
        const a = pathN[i]; pathN[i] = pathN[j]; pathN[j] = a;
        const b = pathE[i]; pathE[i] = pathE[j]; pathE[j] = b;
      }
      // pathN[0] = the first junction (end of the start edge), pathE[0] = start edge;
      // pathN[pc-1] = GOAL, pathE[pc-1] = goal edge.
      startFrom = pathN[0] === es.b ? es.a : es.b;
      route.startUturn = (startFrom === es.a) !== fwd;
    }
    // --- The polyline ---
    let n = 0;
    const X = route.x, Z = route.z, C = route.cum, T = route.tim, S = route.seg;
    let cum = 0, tim = 0;
    const add = (x, z, eid) => {
      if (n >= X.length) return;
      if (n > 0) {
        const d = Math.hypot(x - X[n - 1], z - Z[n - 1]);
        if (d < 0.5) { S[n - 1] = eid; return; }
        cum += d;
        tim += d / speed[S[n - 1] >= 0 ? S[n - 1] : eid];
      }
      X[n] = x; Z[n] = z; C[n] = cum; T[n] = tim; S[n] = eid;
      n++;
    };
    const trim = (id) => {
      const q = nodes[id];
      return q.edges.length > 2 ? Math.max(q.hx || 0, q.hz || 0) * 0.7 : 0;
    };
    // lane point at distance d from `from` along e; d clamped into the edge
    const lp = (e, from, d) => lanePoint(city, e, from, Math.max(0, Math.min(e.length, d)), 0, P);
    if (direct) {
      const from = direct > 0 ? es.a : es.b;
      const d0 = direct > 0 ? snapA.d : es.length - snapA.d;
      const d1 = direct > 0 ? snapB.d : es.length - snapB.d;
      route.startUturn = directU;
      if (directU) { lp(es, direct > 0 ? es.b : es.a, es.length - d0); add(P.x, P.z, es.id); }
      lp(es, from, d0); add(P.x, P.z, es.id);
      lp(es, from, d1); add(P.x, P.z, es.id);
    } else {
      // start edge
      const d0 = startFrom === es.a ? snapA.d : es.length - snapA.d;
      if (route.startUturn) { // the U-turn: from the car's side of the road to the other
        const from2 = startFrom === es.a ? es.b : es.a;
        lp(es, from2, es.length - d0); add(P.x, P.z, es.id);
      }
      lp(es, startFrom, d0); add(P.x, P.z, es.id);
      let from = startFrom;
      let exitCum = 0;
      for (let i = 0; i < pc; i++) {
        const e = edges[pathE[i]];
        const isStart = i === 0, isGoal = pathN[i] === GOAL;
        if (!isStart) from = pathN[i - 1];
        const to = e.a === from ? e.b : e.a;
        const L = e.length;
        if (!isStart) {
          const a0 = Math.min(trim(from), L * 0.4);
          lp(e, from, a0); add(P.x, P.z, e.id);
          jcum[i - 1] = (exitCum + cum) / 2;
        }
        if (isGoal) {
          const dg = from === eg.a ? snapB.d : eg.length - snapB.d;
          lp(e, from, dg); add(P.x, P.z, e.id);
        } else {
          const b0 = L - Math.min(trim(to), L * 0.4);
          lp(e, from, Math.max(isStart ? d0 : 0, b0)); add(P.x, P.z, e.id);
          exitCum = cum;
        }
      }
    }
    route.n = n;
    route.length = cum;
    route.time = tim;
    route.destX = n ? X[n - 1] : tx;
    route.destZ = n ? Z[n - 1] : tz;
    route.edges = direct ? 1 : Math.min(pc, route.pathE.length);
    if (direct) { route.pathE[0] = es.id; route.pathFrom[0] = direct > 0 ? es.a : es.b; } else {
      for (let i = 0; i < route.edges; i++) { route.pathE[i] = pathE[i]; route.pathFrom[i] = i === 0 ? startFrom : pathN[i - 1]; }
    }
    route.expanded = expandedLast;
    buildTurns(route, direct ? 0 : pc, es, eg, startFrom);
    route.ok = n >= 2;
    route.searchMs = (typeof performance !== 'undefined' ? performance.now() : 0) - t0;
    return route.ok;
  }

  // Direction of the path `look` m before / after cumulative distance `at`
  // (point index hint i): writes into dir.

  // The point index whose segment starts at or before cumulative s.
  function idxAt(route, s) {
    const C = route.cum;
    let lo = 0, hi = route.n - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (C[m] <= s) lo = m; else hi = m; }
    return lo;
  }

  function nameAfter(pc, i) {
    // the first named edge from path index i on (within 150 m)
    let run = 0;
    for (let k = i; k < pc; k++) {
      const e = edges[pathE[k]];
      if (e.name) return e.name;
      run += e.length;
      if (run > 150) break;
    }
    return '';
  }

  function buildTurns(route, pc, es, eg, startFrom) {
    const T = route.turns;
    let tc = 0;
    const put = (kind, angle, at, name, node) => {
      if (tc >= T.length) return null;
      const t = T[tc++];
      const i = idxAt(route, at);
      const C = route.cum;
      const l = (C[i + 1] || C[i]) - C[i] || 1, f = Math.max(0, Math.min(1, (at - C[i]) / l));
      t.kind = kind; t.angle = angle; t.at = at; t.idx = i; t.node = node;
      t.x = route.x[i] + ((route.x[i + 1] || route.x[i]) - route.x[i]) * f;
      t.z = route.z[i] + ((route.z[i + 1] || route.z[i]) - route.z[i]) * f;
      t.full = name; t.name = shortStreet(name);
      return t;
    };
    if (route.startUturn) put('uturn', Math.PI, 0, es.name, -1);
    for (let i = 0; i + 1 < pc; i++) {
      const node = pathN[i];
      const e0 = edges[pathE[i]], e1 = edges[pathE[i + 1]];
      const jAt = jcum[i];
      const deg = nodes[node].edges.length;
      if (deg < 3) continue; // a bend, no choice
      // The two edges' own directions at the junction (edges are straight).
      const from0 = i === 0 ? startFrom : pathN[i - 1];
      const ax = dirX(e0, from0), az = dirZ(e0, from0), bx = dirX(e1, node), bz = dirZ(e1, node);
      const cr = ax * bz - az * bx, dt = ax * bx + az * bz;
      const ang = Math.atan2(cr, dt);
      const deg0 = Math.abs(ang) * (180 / Math.PI);
      let kind = '';
      if (isLink(e1.cls) && isFast(e0.cls)) kind = 'exit';
      else if (isLink(e0.cls) && isFast(e1.cls)) kind = 'merge';
      else if (deg0 >= 28) kind = turnKind(ang);
      else if (deg0 >= 14 && e1.name !== e0.name && e1.name) kind = turnKind(ang); // a fork onto another road
      // The same road going on round a bend: nothing to tell.
      if (kind !== 'exit' && kind !== 'merge' && e1.name && e1.name === e0.name && deg0 < 60) kind = '';
      if (!kind) continue;
      const name = nameAfter(pc, i + 1);
      // Close to the previous turn (a divided road's two junctions): one turn.
      const prev = tc > 0 ? T[tc - 1] : null;
      if (prev && prev.kind !== 'arrive' && jAt - prev.at < MERGE_M && prev.node >= 0 && kind !== 'exit' && kind !== 'merge') {
        let sum = prev.angle + ang;
        sum = Math.atan2(Math.sin(sum), Math.cos(sum)) || sum; // keeps +-180 as a U-turn
        const sd = Math.abs(sum) * (180 / Math.PI);
        if (sd < 20) { tc--; continue; } // a jog: nothing to tell
        prev.angle = sum;
        prev.kind = turnKind(sum);
        prev.full = name; prev.name = shortStreet(name);
        continue;
      }
      put(kind, ang, jAt, name, node);
    }
    const last = route.n - 1;
    put('arrive', 0, route.cum[last], eg.name || '', -1);
    route.turnCount = tc;
  }

  return { search, cost, speed, nodes, edges, nearestEdge: (x, z, out = { edge: -1, d: 0, d2: 0 }, heading) => nearestEdge(city, x, z, out, heading) };
}

// ---------------------------------------------------------------------------
// Following a route: a cursor along the polyline (no allocation per update).
// ---------------------------------------------------------------------------
export function createTracker(router, opts = {}) {
  const route = opts.route || createRoute();
  const st = {
    route,
    active: false, // a destination is set
    arrived: false,
    goalX: 0, goalZ: 0, legal: true,
    seg: 0, along: 0, off: 0, offT: 0, wrongT: 0, sinceSearch: 99,
    turn: 0, // index of the next turn in route.turns
    toTurn: 0, remaining: 0, eta: 0,
    reroutes: 0, searches: 0, lastMs: 0, rev: 0,
    pending: false,
  };

  function setGoal(x, z, legal = true) {
    st.active = Number.isFinite(x) && Number.isFinite(z);
    st.goalX = x; st.goalZ = z; st.legal = legal !== false;
    st.arrived = false;
    st.pending = st.active;
    st.sinceSearch = 99;
    if (!st.active) { route.ok = false; route.n = 0; route.rev++; st.rev++; }
  }
  function clear() { setGoal(NaN, NaN); }

  function doSearch(x, z, heading) {
    router.search(x, z, heading, st.goalX, st.goalZ, route, st.legal);
    st.searches++;
    st.lastMs = route.searchMs;
    st.sinceSearch = 0;
    st.pending = false;
    st.seg = 0; st.along = 0; st.turn = 0; st.offT = 0; st.wrongT = 0;
    st.rev++;
  }

  // Project (x, z) on segments [i0, i1): writes best into st (returns dist).
  let bSeg = 0, bAlong = 0;
  function project(x, z, i0, i1) {
    const X = route.x, Z = route.z, C = route.cum;
    let bd = Infinity;
    for (let i = Math.max(0, i0); i < i1 && i + 1 < route.n; i++) {
      const ax = X[i], az = Z[i], dx = X[i + 1] - ax, dz = Z[i + 1] - az;
      const l2 = dx * dx + dz * dz || 1;
      let t = ((x - ax) * dx + (z - az) * dz) / l2;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const px = ax + dx * t - x, pz = az + dz * t - z;
      const d = px * px + pz * pz;
      if (d < bd - 1e-6) { bd = d; bSeg = i; bAlong = C[i] + (C[i + 1] - C[i]) * t; }
    }
    return Math.sqrt(bd);
  }

  // Advance with the car: x, z, heading, speed (m/s), dt (sim seconds).
  // Returns true when the route changed (a new search).
  function update(x, z, heading, spd, dt) {
    if (!st.active || st.arrived) return false;
    st.sinceSearch += dt;
    if (st.pending || !route.ok) {
      if (st.sinceSearch < 2 && !st.pending) return false; // no way there: try again now and then
      doSearch(x, z, heading);
      if (!route.ok) return true;
    }
    // Cursor window: a few segments back, more ahead.
    let off = project(x, z, st.seg - 2, st.seg + 24);
    if (off > OFF_ROUTE_M * 0.5) {
      // Maybe further along (a jump): the whole line, no allocation.
      const s0 = bSeg, a0 = bAlong;
      const offAll = project(x, z, 0, route.n);
      if (offAll < off - 1) off = offAll; else { bSeg = s0; bAlong = a0; }
    }
    st.seg = bSeg;
    st.along = bAlong;
    st.off = off;
    // Wrong way along the line at speed
    const i = st.seg;
    const sx = route.x[i + 1] - route.x[i], sz = route.z[i + 1] - route.z[i];
    const sl = Math.hypot(sx, sz) || 1;
    const dot = (Math.cos(heading) * sx + Math.sin(heading) * sz) / sl;
    if (dot < -0.5 && spd > 3) st.wrongT += dt; else st.wrongT = 0;
    if (off > OFF_ROUTE_M) st.offT += dt; else st.offT = 0;
    let changed = false;
    if ((st.offT >= OFF_ROUTE_S || st.wrongT >= 4) && st.sinceSearch >= REROUTE_GAP_S) {
      doSearch(x, z, heading);
      st.reroutes++;
      changed = true;
      if (!route.ok) return true;
      project(x, z, 0, Math.min(route.n, 24));
      st.seg = bSeg; st.along = bAlong;
    }
    // Next turn: the first one past the car (a turn counts as passed 5 m on).
    const T = route.turns;
    while (st.turn < route.turnCount - 1 && T[st.turn].at < st.along - 5) st.turn++;
    st.toTurn = Math.max(0, T[st.turn] ? T[st.turn].at - st.along : 0);
    st.remaining = Math.max(0, route.length - st.along);
    // ETA from the route's drive times, scaled by how the part left compares
    const C = route.cum, Tm = route.tim;
    const segL = C[i + 1] - C[i] || 1;
    const tNow = Tm[i] + (Tm[i + 1] - Tm[i]) * Math.max(0, Math.min(1, (st.along - C[i]) / segL));
    st.eta = Math.max(0, route.time - tNow);
    if (st.remaining < ARRIVE_M && off < OFF_ROUTE_M) {
      st.arrived = true;
      changed = true;
    }
    return changed;
  }

  // The next turn object (or null).
  st.next = () => (route.ok && route.turnCount ? route.turns[st.turn] : null);
  st.setGoal = setGoal;
  st.clear = clear;
  st.update = update;
  st.search = doSearch;
  return st;
}
