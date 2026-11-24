// Races, sky courses and timed deliveries, built from the generated city.
// Pure data: no drawing, no randomness, so the same city always gives the
// same courses and everything can be checked in node tests.
//
// Every activity: { id, name, type, kinds, start {x,z,y,heading},
//   checkpoints [{x,z,y,r, kind, dir}], laps, medalTimes, reward, blurb }
// Checkpoint `kind`: 'ground' (car), 'buoy' (boat gate), 'ring' (sky),
// 'pad' (touch down on a roof or helipad). `dir` is the heading of travel
// through it, used to face rings and line up buoy pairs.
import { holdsAll, pointsIn, PLACE_MARGIN } from './regions.js';

// Average speed (m/s) a good run holds, per craft kind. Gold needs this.
export const REF_SPEED = { car: 21, boat: 17, plane: 46, heli: 27 };
// Seconds for getting going (pulling away, a take-off roll).
export const START_OVERHEAD = { car: 4, boat: 4, plane: 14, heli: 6 };
// Extra seconds for each touch-down point.
export const PAD_TIME = 5;
// Sky routes are flown in curves, not straight lines.
export const SKY_TURN_FACTOR = 1.12;
// Silver and bronze allow this much more time than gold.
export const MEDAL_FACTOR = { gold: 1, silver: 1.22, bronze: 1.5 };
// Prize money: base + per gold-second, scaled per medal.
export const REWARD_BASE = 120;
export const REWARD_PER_SECOND = 4;
export const REWARD_FACTOR = { gold: 1, silver: 0.6, bronze: 0.35 };
// Sky ring clearance rules.
export const RING_CLEAR_RADIUS = 40; // look for buildings this far around a ring
export const RING_CLEAR_HEIGHT = 25; // ring bottom must clear them by this much
export const CANYON_RING_R = 14; // street-canyon rings (avenues only) are at least this big
// Boat gate rules.
export const GATE_SHORE = -25; // every buoy gate this far out to sea (shoreDist below this)
export const GATE_PIER_CLEAR = 20; // and at least this far from any pier

// Start zones keep this far from aircraft and boat spawn spots (except the
// runway course, whose plane waits on the line on purpose).
export const START_SPOT_CLEAR = 16;

const TAU = Math.PI * 2;
const hyp = Math.hypot;
const r1 = (v) => Math.round(v * 10) / 10;
const headingOf = (ax, az, bx, bz) => Math.atan2(bz - az, bx - ax);
const wrapAngle = (a) => {
  while (a > Math.PI) a -= TAU;
  while (a < -Math.PI) a += TAU;
  return a;
};

// ---------------------------------------------------------------------------
// Road graph helpers
// ---------------------------------------------------------------------------

const otherEnd = (e, id) => (e.a === id ? e.b : e.a);

// Cheapest path between two nodes. `cost(edge)` defaults to its length.
// Returns node ids from `from` to `to`, or null.
export function roadPath(city, from, to, cost = null, avoid = null) {
  const n = city.nodes.length;
  const dist = new Float64Array(n).fill(Infinity);
  const prev = new Int32Array(n).fill(-1);
  const done = new Uint8Array(n);
  dist[from] = 0;
  if (n > 400) return heapPath(city, from, to, cost, avoid, dist, prev, done);
  // The graph is small (a few hundred nodes): a plain O(n^2) search is fine.
  for (;;) {
    let u = -1, best = Infinity;
    for (let i = 0; i < n; i++) if (!done[i] && dist[i] < best) { best = dist[i]; u = i; }
    if (u < 0) return null;
    if (u === to) break;
    done[u] = 1;
    const node = city.nodes[u];
    for (const eid of node.edges) {
      const e = city.edges[eid];
      const v = otherEnd(e, u);
      if (avoid && avoid.has(v) && v !== to) continue;
      const d = best + (cost ? cost(e) : e.length);
      if (d < dist[v]) { dist[v] = d; prev[v] = u; }
    }
  }
  const path = [];
  for (let v = to; v >= 0; v = prev[v]) path.push(v);
  return path.reverse();
}

// The same search with a binary heap, for a real map (thousands of nodes).
// The heap lives in module typed arrays (reused, grown as needed): one
// entry per improved distance, so at most one per edge end plus the start.
let HN = new Int32Array(1024), HD = new Float64Array(1024), HLEN = 0;
function heapPush(v, d) {
  const hn = HN, hd = HD;
  let i = HLEN++;
  while (i > 0) {
    const p = (i - 1) >> 1;
    if (hd[p] <= d) break;
    hn[i] = hn[p]; hd[i] = hd[p];
    i = p;
  }
  hn[i] = v; hd[i] = d;
}
function heapPop() {
  const hn = HN, hd = HD;
  const v = hn[0];
  const len = --HLEN;
  const lv = hn[len], ld = hd[len];
  if (len) {
    let i = 0;
    for (;;) {
      let c = 2 * i + 1;
      if (c >= len) break;
      if (c + 1 < len && hd[c + 1] < hd[c]) c++;
      if (hd[c] >= ld) break;
      hn[i] = hn[c]; hd[i] = hd[c];
      i = c;
    }
    hn[i] = lv; hd[i] = ld;
  }
  return v;
}
function heapPath(city, from, to, cost, avoid, dist, prev, done) {
  const cap = 2 * city.edges.length + 2;
  if (HN.length < cap) { HN = new Int32Array(cap); HD = new Float64Array(cap); }
  HLEN = 0;
  const push = heapPush, pop = heapPop;
  push(from, 0);
  let found = false;
  while (HLEN) {
    const u = pop();
    if (done[u]) continue;
    if (u === to) { found = true; break; }
    done[u] = 1;
    const best = dist[u];
    const ue = city.nodes[u].edges;
    for (let j = 0; j < ue.length; j++) {
      const e = city.edges[ue[j]];
      const v = otherEnd(e, u);
      if (done[v] || (avoid && avoid.has(v) && v !== to)) continue;
      const d = best + (cost ? cost(e) : e.length);
      if (d < dist[v]) { dist[v] = d; prev[v] = u; push(v, d); }
    }
  }
  if (!found) return null;
  const path = [];
  for (let v = to; v >= 0; v = prev[v]) path.push(v);
  return path.reverse();
}

// Length in meters of the shortest road path between two nodes.
export function roadDistance(city, from, to) {
  const p = roadPath(city, from, to);
  if (!p) return Infinity;
  let d = 0;
  for (let i = 1; i < p.length; i++) d += hyp(city.nodes[p[i]].x - city.nodes[p[i - 1]].x, city.nodes[p[i]].z - city.nodes[p[i - 1]].z);
  return d;
}

const edgeKey = (a, b) => (a < b ? a * 100000 + b : b * 100000 + a);

function nearestNode(nodes, x, z) {
  let best = null, bd = Infinity;
  for (let nIdx = 0; nIdx < nodes.length; nIdx++) {
    const n = nodes[nIdx];
    const d = hyp(n.x - x, n.z - z);
    if (d < bd) { bd = d; best = n; }
  }
  return best;
}

// The node of `nodes` farthest from (cx,cz) in each of `sectors` angular
// slices, in order of angle (increasing heading = clockwise from above).
function ringNodes(nodes, cx, cz, sectors, theta0 = 0) {
  const best = new Array(sectors).fill(null);
  const bestD = new Array(sectors).fill(-1);
  for (let nIdx = 0; nIdx < nodes.length; nIdx++) {
    const n = nodes[nIdx];
    const a = (Math.atan2(n.z - cz, n.x - cx) - theta0 + TAU * 2) % TAU;
    const s = Math.min(sectors - 1, Math.floor((a / TAU) * sectors));
    const d = hyp(n.x - cx, n.z - cz);
    if (d > bestD[s]) { bestD[s] = d; best[s] = n; }
  }
  return best.filter(Boolean);
}

// Joins waypoints (node ids) into one closed walk of node ids. Roads used
// already cost more, so the route avoids running back along itself.
function closedWalk(city, waypoints, baseCost, avoid) {
  const used = new Set();
  const walk = [];
  for (let k = 0; k < waypoints.length; k++) {
    const a = waypoints[k], b = waypoints[(k + 1) % waypoints.length];
    const cost = (e) => baseCost(e) * (used.has(edgeKey(e.a, e.b)) ? 6 : 1);
    const p = roadPath(city, a, b, cost, avoid);
    if (!p) throw new Error('courses: waypoints not connected');
    for (let i = 1; i < p.length; i++) used.add(edgeKey(p[i - 1], p[i]));
    for (let i = 0; i < p.length - 1; i++) walk.push(p[i]);
  }
  return walk;
}

// Picks checkpoint positions along a closed walk: walk[0] always, nodes in
// `forced`, and otherwise a node each time `spacing` meters have passed.
// The count is tuned into [minN, maxN]. Returns indices into the walk.
// `ok(node)`, when given, limits the picks (not walk[0]) to the nodes it
// accepts (a real map: junctions rather than bends in the road).
function pickAlongWalk(city, walk, minN, maxN, forced = new Set(), ok = null) {
  const N = city.nodes;
  let total = 0;
  for (let i = 0; i < walk.length; i++) {
    const a = N[walk[i]], b = N[walk[(i + 1) % walk.length]];
    total += hyp(b.x - a.x, b.z - a.z);
  }
  let spacing = total / ((minN + maxN) / 2);
  let picks = [];
  for (let tries = 0; tries < 40; tries++) {
    picks = [0];
    const seen = new Set([walk[0]]);
    let acc = 0;
    for (let i = 1; i < walk.length; i++) {
      const a = N[walk[i - 1]], b = N[walk[i]];
      acc += hyp(b.x - a.x, b.z - a.z);
      const must = forced.has(walk[i]);
      if ((must || (acc >= spacing && (!ok || ok(b)))) && !seen.has(walk[i])) {
        // Leave room before the finish line at walk[0].
        let rest = 0;
        for (let j = i; j < walk.length; j++) {
          const p = N[walk[j]], q = N[walk[(j + 1) % walk.length]];
          rest += hyp(q.x - p.x, q.z - p.z);
        }
        if (!must && rest < spacing * 0.5) continue;
        picks.push(i);
        seen.add(walk[i]);
        acc = 0;
      }
    }
    if (picks.length > maxN) spacing *= 1.12;
    else if (picks.length < minN) spacing *= 0.88;
    else break;
  }
  return picks;
}

const groundR = (node) => r1(Math.max(node.hx, node.hz) + 6);

// A start spot `d` meters from node a toward node b, facing b.
function startOnEdge(a, b, d) {
  const L = hyp(b.x - a.x, b.z - a.z);
  const t = Math.min(0.45, d / L);
  return { x: r1(a.x + (b.x - a.x) * t), z: r1(a.z + (b.z - a.z) * t), y: 0, heading: headingOf(a.x, a.z, b.x, b.z) };
}

// A closed street circuit through the given waypoint nodes. The last
// checkpoint is the finish line; the start sits just past it.
function streetCircuit(city, waypointIds, opts) {
  const { minN = 8, maxN = 16, cost = (e) => e.length, avoid = null, forced, ok = null } = opts;
  const walk = closedWalk(city, waypointIds, cost, avoid);
  const picks = pickAlongWalk(city, walk, minN, maxN, forced, ok);
  const N = city.nodes;
  const ids = picks.slice(1).map((i) => walk[i]);
  ids.push(walk[0]);
  const start = startOnEdge(N[walk[0]], N[walk[1]], 26);
  return { start, nodeIds: ids };
}

function groundCheckpoints(city, nodeIds, startHeading) {
  const N = city.nodes;
  return nodeIds.map((id, k) => {
    const n = N[id];
    const nxt = N[nodeIds[(k + 1) % nodeIds.length]];
    const dir = nxt === n ? startHeading : headingOf(n.x, n.z, nxt.x, nxt.z);
    return { x: r1(n.x), z: r1(n.z), y: 0, r: groundR(n), kind: 'ground', node: id, dir };
  });
}

// Shortest road length from a node through each checkpoint node in turn.
function roadLength(city, startNode, nodeIds) {
  let d = 0;
  let prev = startNode;
  for (const id of nodeIds) {
    d += roadDistance(city, prev, id);
    prev = id;
  }
  return d;
}

// ---------------------------------------------------------------------------
// Sea helpers
// ---------------------------------------------------------------------------

function pierDist(city, x, z) {
  let best = Infinity;
  for (const p of city.piers) {
    const dx = Math.max(p.x0 - x, 0, x - p.x1), dz = Math.max(p.z0 - z, 0, z - p.z1);
    best = Math.min(best, hyp(dx, dz));
  }
  return best;
}

export function gateIsClear(city, x, z) {
  return city.shoreDist(x, z) < GATE_SHORE && pierDist(city, x, z) > GATE_PIER_CLEAR;
}

// True when a boat can run in a straight line from a to b (sampled every 5 m).
export function waterLineClear(city, ax, az, bx, bz, margin = -3) {
  const L = hyp(bx - ax, bz - az);
  const n = Math.max(1, Math.ceil(L / 5));
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    if (city.shoreDist(ax + (bx - ax) * t, az + (bz - az) * t) >= margin) return false;
  }
  return true;
}

const coastPoint = (city, theta, off) => {
  const r = city.radiusAt(theta) + off;
  return { x: Math.cos(theta) * r, z: Math.sin(theta) * r };
};

// Moves a gate straight out from the island center until it is clear.
function pushOut(city, p, extra = 0) {
  let { x, z } = p;
  const th = Math.atan2(z, x);
  for (let i = 0; i < 60 && (!gateIsClear(city, x, z) || city.shoreDist(x, z) > GATE_SHORE - 5 - extra); i++) {
    x += Math.cos(th) * 8;
    z += Math.sin(th) * 8;
  }
  return { x, z };
}

// Inserts extra gates wherever a straight leg would touch land or run long.
// A real map has no island center: move a gate down the shore field
// (away from the nearest land) until it is clear.
function pushToSea(city, p, extra = 0) {
  let { x, z } = p;
  for (let i = 0; i < 60 && (!gateIsClear(city, x, z) || city.shoreDist(x, z) > GATE_SHORE - 5 - extra); i++) {
    const gx = city.shoreDist(x + 2, z) - city.shoreDist(x - 2, z);
    const gz = city.shoreDist(x, z + 2) - city.shoreDist(x, z - 2);
    const l = hyp(gx, gz);
    if (!(l > 1e-6)) break;
    x -= (gx / l) * 8;
    z -= (gz / l) * 8;
  }
  return { x, z };
}

// `push` moves a gate out to sea (pushOut on the island, pushToSea on a
// real map, which also picks the side to push a blocked leg's midpoint
// by the water depth instead of by the island center).
function refineSea(city, pts, closed, maxLeg = 320, push = pushOut) {
  const out = [pts[0]];
  const legs = closed ? pts.length : pts.length - 1;
  const solve = (a, b, depth) => {
    const L = hyp(b.x - a.x, b.z - a.z);
    if ((waterLineClear(city, a.x, a.z, b.x, b.z, -8) && L <= maxLeg) || depth > 6) {
      out.push(b);
      return;
    }
    let mx = (a.x + b.x) / 2, mz = (a.z + b.z) / 2;
    if (!waterLineClear(city, a.x, a.z, b.x, b.z, -8)) {
      // Push the midpoint away from land, sideways to the leg.
      const nx = -(b.z - a.z) / L, nz = (b.x - a.x) / L;
      const outward = push === pushOut
        ? (nx * mx + nz * mz > 0 ? 1 : -1)
        : (city.shoreDist(mx + nx * 40, mz + nz * 40) < city.shoreDist(mx - nx * 40, mz - nz * 40) ? 1 : -1);
      for (let i = 0; i < 40 && city.shoreDist(mx, mz) > GATE_SHORE - 15; i++) {
        mx += nx * outward * 10;
        mz += nz * outward * 10;
      }
    }
    const m = push(city, { x: mx, z: mz });
    solve(a, m, depth + 1);
    solve(m, b, depth + 1);
  };
  for (let k = 0; k < legs; k++) solve(pts[k], pts[(k + 1) % pts.length], 0);
  if (closed) out.pop();
  return out;
}

function buoyCheckpoints(pts, r, closed, startPos) {
  return pts.map((p, k) => {
    const prev = k === 0 ? (closed ? pts[pts.length - 1] : startPos) : pts[k - 1];
    const next = k === pts.length - 1 ? (closed ? pts[0] : null) : pts[k + 1];
    const h1 = headingOf(prev.x, prev.z, p.x, p.z);
    const h2 = next ? headingOf(p.x, p.z, next.x, next.z) : h1;
    const dir = h1 + wrapAngle(h2 - h1) / 2;
    return { x: r1(p.x), z: r1(p.z), y: 0, r: typeof r === 'function' ? r(k) : r, kind: 'buoy', dir };
  });
}

// ---------------------------------------------------------------------------
// Sky helpers
// ---------------------------------------------------------------------------

// Tallest building whose footprint comes within `R` meters of (x,z).
const NEAR = [];
export function tallestNear(city, x, z, R = RING_CLEAR_RADIUS) {
  let h = 0;
  if (city.buildingsNear) {
    // A real map: only the buildings in the grid cells around the point.
    city.buildingsNear(x - R, z - R, x + R, z + R, NEAR);
    for (let i = 0; i < NEAR.length; i++) {
      const b = city.buildings[NEAR[i]];
      if (b.h <= h) continue;
      const dx = Math.max(b.x0 - x, 0, x - b.x1), dz = Math.max(b.z0 - z, 0, z - b.z1);
      if (dx * dx + dz * dz <= R * R) h = b.h;
    }
    return h;
  }
  for (let bIdx = 0; bIdx < city.buildings.length; bIdx++) {
    const b = city.buildings[bIdx];
    if (b.h <= h) continue;
    const dx = Math.max(b.x0 - x, 0, x - b.x1), dz = Math.max(b.z0 - z, 0, z - b.z1);
    if (dx * dx + dz * dz <= R * R) h = b.h;
  }
  return h;
}

// Ring center height that keeps the ring's bottom well above any roof
// nearby (or 12 m above open ground and sea).
function ringY(city, x, z, r, wantY) {
  const tall = tallestNear(city, x, z);
  const minBottom = tall > 0 ? tall + RING_CLEAR_HEIGHT : 12;
  return Math.ceil(Math.max(wantY, minBottom + r) + 0.5);
}

// The avenue edge under (x,z), if there is one.
export function avenueAt(city, x, z) {
  const edges = city.edges;
  for (let k = 0; k < edges.length; k++) {
    const e = edges[k];
    if (!e.avenue || e.causeway) continue;
    const a = city.nodes[e.a], b = city.nodes[e.b];
    if (e.ux !== undefined) {
      // A real map: edges run any way. On the center line (within 1 m),
      // clear of the junction box at either end.
      const t = (x - a.x) * e.ux + (z - a.z) * e.uz;
      const s = -(x - a.x) * e.uz + (z - a.z) * e.ux;
      if (Math.abs(s) < 1 && t > Math.max(a.hx, a.hz) && t < e.length - Math.max(b.hx, b.hz)) return e;
      continue;
    }
    if (e.horizontal) {
      if (Math.abs(z - a.z) < 1 && x > Math.min(a.x, b.x) + a.hx && x < Math.max(a.x, b.x) - b.hx) return e;
    } else if (Math.abs(x - a.x) < 1 && z > Math.min(a.z, b.z) + a.hz && z < Math.max(a.z, b.z) - b.hz) return e;
  }
  return null;
}

function skyCheckpoints(city, list, start) {
  const out = [];
  for (let k = 0; k < list.length; k++) {
    const s = list[k];
    let y;
    if (s.pad) y = s.y;
    else if (s.canyon) {
      if (!avenueAt(city, s.x, s.z) || s.r < CANYON_RING_R) throw new Error('courses: canyon ring off an avenue');
      y = s.y;
    } else y = ringY(city, s.x, s.z, s.r, s.y);
    out.push({ x: r1(s.x), z: r1(s.z), y: r1(y), r: s.r, kind: s.pad ? 'pad' : 'ring', dir: 0, canyon: !!s.canyon });
  }
  for (let k = 0; k < out.length; k++) {
    const p = out[k];
    const prev = k === 0 ? start : out[k - 1];
    const next = out[k + 1];
    const h1 = headingOf(prev.x, prev.z, p.x, p.z);
    // Canyon rings face straight down their avenue.
    if (p.canyon) {
      const e = avenueAt(city, p.x, p.z);
      const along = e.ux !== undefined ? Math.atan2(e.uz, e.ux) : e.horizontal ? 0 : Math.PI / 2;
      p.dir = Math.cos(h1 - along) >= 0 ? along : along + Math.PI;
    } else if (next) {
      p.dir = h1 + wrapAngle(headingOf(p.x, p.z, next.x, next.z) - h1) / 2;
    } else p.dir = h1;
  }
  return out;
}

// Flat roofs a helicopter can touch down on.
function roofNear(city, x, z, used) {
  let best = null, bd = Infinity;
  const B = city.buildings;
  for (let k = 0; k < B.length; k++) {
    const b = B[k];
    if (b.kind !== 'building' && b.kind !== 'warehouse') continue;
    if (b.x1 - b.x0 < 18 || b.z1 - b.z0 < 18 || b.h < 8 || b.h > 45) continue;
    if (used.has(b)) continue;
    const cx = (b.x0 + b.x1) / 2, cz = (b.z0 + b.z1) / 2;
    // (Only a nearer roof can win: the neighbor test runs for those alone.)
    const d = hyp(cx - x, cz - z);
    if (d >= bd) continue;
    // Nothing much taller right next to it.
    if (tallestNear(city, cx, cz, 30) > b.h + 6) continue;
    bd = d; best = b;
  }
  if (!best) throw new Error('courses: no roof found');
  used.add(best);
  return { x: (best.x0 + best.x1) / 2, z: (best.z0 + best.z1) / 2, y: best.h + 1, r: 6, pad: true, roof: best.h };
}

// ---------------------------------------------------------------------------
// Medal times and prizes
// ---------------------------------------------------------------------------

export function medalTimesFor(kind, meters, pads = 0) {
  const gold = Math.ceil(START_OVERHEAD[kind] + meters / REF_SPEED[kind] + pads * PAD_TIME);
  return {
    gold,
    silver: Math.ceil(gold * MEDAL_FACTOR.silver),
    bronze: Math.ceil(gold * MEDAL_FACTOR.bronze),
  };
}

export function rewardFor(medalTimes) {
  const top = REWARD_BASE + REWARD_PER_SECOND * medalTimes.gold;
  const round = (v) => Math.round(v / 10) * 10;
  return { gold: round(top * REWARD_FACTOR.gold), silver: round(top * REWARD_FACTOR.silver), bronze: round(top * REWARD_FACTOR.bronze) };
}

function pathLength3(start, cps) {
  let d = 0;
  let p = start;
  for (const c of cps) {
    d += hyp(c.x - p.x, c.z - p.z, (c.y || 0) - (p.y || 0));
    p = c;
  }
  return d;
}

function finish(a, meters, pads = 0) {
  a.medalTimes = medalTimesFor(a.kinds[0], meters, pads);
  a.reward = rewardFor(a.medalTimes);
  a.length = Math.round(meters);
  return a;
}

// ---------------------------------------------------------------------------
// The activities
// ---------------------------------------------------------------------------

export function buildCourses(city) {
  if (city.courseSpec) return buildSpecCourses(city, city.courseSpec);
  const N = city.nodes;
  const { gate } = city.airfield;
  const mainNodes = N.filter((n) => n !== gate);
  const avoidGate = new Set([gate.id]);
  const list = [];

  // Grid lines of the central avenues.
  let aCol = 0, aRow = 0;
  for (let i = 0; i < city.N; i++) {
    if (i % 4 === 0 && Math.abs(city.xs[i]) < Math.abs(city.xs[aCol])) aCol = i;
    if (i % 4 === 0 && Math.abs(city.zs[i]) < Math.abs(city.zs[aRow])) aRow = i;
  }
  const xs = city.xs, zs = city.zs;
  const avX = xs[aCol], avZ = zs[aRow];
  const midX = (i) => (xs[i] + xs[i + 1]) / 2;
  const midZ = (j) => (zs[j] + zs[j + 1]) / 2;

  // --- Street races ---------------------------------------------------------
  const street = (id, name, blurb, waypoints, laps, opts = {}) => {
    const c = streetCircuit(city, waypoints.map((n) => n.id), { avoid: avoidGate, ...opts });
    const cps = groundCheckpoints(city, c.nodeIds, c.start.heading);
    const startNode = cps[cps.length - 1].node;
    const lap = roadLength(city, startNode, c.nodeIds);
    list.push(finish({ id, name, type: 'street', kinds: ['car'], start: c.start, checkpoints: cps, laps, blurb }, lap * laps));
  };

  const downtown = mainNodes.filter((n) => city.districtOf(n.x, n.z) === 'downtown');
  const dc = centroid(downtown);
  street('street-glasswell', 'Glasswell Glide', 'Two laps between the glass towers of the city center.',
    ringNodes(downtown, dc.x, dc.z, 8), 2);

  const north = mainNodes.filter((n) => city.districtOf(n.x, n.z) === 'residential' && n.z < 0);
  const nc = centroid(north);
  street('street-fernside', 'Fernside Hedgerow Loop', 'Two quick laps of the leafy north-side lanes.',
    ringNodes(north, nc.x, nc.z, 8), 2);

  // The island loop prefers roads near the shore.
  const outerCost = (e) => {
    const a = N[e.a], b = N[e.b];
    return e.length * (1 + Math.max(0, city.shoreDist((a.x + b.x) / 2, (a.z + b.z) / 2)) / 90);
  };
  street('street-rim', 'Rim Road Rally', 'One long lap of the outer roads, all the way round the island.',
    ringNodes(mainNodes, 0, 0, 16), 1, { cost: outerCost });

  // Out over the causeway to the airfield gate and back again.
  {
    const anchor = N[otherEnd(city.edges[gate.edges[0]], gate.id)];
    list.push(causewayCourse(city, mainNodes, avoidGate,
      { x: anchor.x - 170, z: anchor.z - 230 }, { x: anchor.x - 170, z: anchor.z + 230 }, { x: anchor.x - 330, z: anchor.z },
      'Causeway Dash', 'From Cinder Row across the causeway to the airfield gate and back.'));
  }
  boatCourses(city, list);
  skyCourses(city, list, { avX, avZ, aCol, aRow, xs, zs, midX, midZ });
  deliveries(city, list, mainNodes);
  return tidy(list);
}

// The causeway race: from c up to a, out to the gate, back to b and c.
function causewayCourse(city, mainNodes, avoidGate, pa, pb, pc, name, blurb, ok = null) {
  const N = city.nodes;
  const gate = city.airfield.gate;
  {
    const anchor = N[otherEnd(city.edges[gate.edges[0]], gate.id)];
    const a = nearestNode(mainNodes, pa.x, pa.z);
    const b = nearestNode(mainNodes, pb.x, pb.z);
    const c = nearestNode(mainNodes, pc.x, pc.z);
    const used = new Set();
    const cost = (e) => e.length * (used.has(edgeKey(e.a, e.b)) ? 6 : 1);
    const legs = [[c.id, a.id], [a.id, anchor.id], [anchor.id, b.id], [b.id, c.id]];
    const walk = [];
    for (const [from, to] of legs) {
      const p = roadPath(city, from, to, cost, avoidGate);
      for (let i = 1; i < p.length; i++) used.add(edgeKey(p[i - 1], p[i]));
      for (let i = 0; i < p.length - 1; i++) walk.push(p[i]);
      if (to === anchor.id) walk.push(anchor.id, gate.id);
    }
    // `walk` now runs ... anchor, gate, (anchor again starts the next leg).
    const picks = pickAlongWalk(city, walk, 8, 16, new Set([gate.id]), ok);
    const ids = picks.slice(1).map((i) => walk[i]);
    ids.push(walk[0]);
    const start = startOnEdge(N[walk[0]], N[walk[1]], 26);
    const cps = groundCheckpoints(city, ids, start.heading);
    const lap = roadLength(city, walk[0], ids);
    return finish({
      id: 'street-causeway', name, type: 'street', kinds: ['car'], start, checkpoints: cps, laps: 1, blurb,
    }, lap);
  }
}

function boatCourse(list, id, name, blurb, start, pts, r, closed = false) {
  const cps = buoyCheckpoints(pts, r, closed, start);
  const meters = pathLength3(start, cps) + (closed ? hyp(cps[0].x - cps[cps.length - 1].x, cps[0].z - cps[cps.length - 1].z) : 0);
  list.push(finish({ id, name, type: 'boat', kinds: ['boat'], start, checkpoints: cps, laps: 1, blurb }, meters));
}

function skyCourse(city, list, id, name, kinds, blurb, start, spec, extra = 0) {
  const cps = skyCheckpoints(city, spec, start);
  const pads = cps.filter((c) => c.kind === 'pad').length;
  const meters = pathLength3(start, cps) * SKY_TURN_FACTOR + extra;
  list.push(finish({ id, name, type: 'sky', kinds, start, checkpoints: cps, laps: 1, blurb }, meters, pads));
}

function deliveryCourse(list, id, name, kinds, blurb, start, cps, meters, pads = 0) {
  const a = finish({ id, name, type: 'delivery', kinds, start, checkpoints: cps, laps: 1, blurb }, meters, pads);
  a.timeLimit = a.medalTimes.bronze;
  list.push(a);
}

function tidy(list) {
  for (const a of list) {
    a.start.x = r1(a.start.x);
    a.start.z = r1(a.start.z);
    a.start.heading = Math.round(a.start.heading * 1000) / 1000;
    for (const c of a.checkpoints) c.dir = Math.round(c.dir * 1000) / 1000;
  }
  return list;
}

function boatCourses(city, list) {
  const { islet } = city.airfield;
  const boat = (id, name, blurb, start, pts, r, closed = false) => boatCourse(list, id, name, blurb, start, pts, r, closed);
  const angleOf = (p) => Math.atan2((p.z0 + p.z1) / 2, (p.x0 + p.x1) / 2);
  const mainPiers = city.piers.filter((p) => city.mainShore((p.x0 + p.x1) / 2, (p.z0 + p.z1) / 2) > -200);
  // Piers in the order they were built: Saltyard, Pale Shore, Northpoint.
  const marinaPier = mainPiers[0], westPier = mainPiers[1] || mainPiers[0];

  const seaStart = (theta, off, towardTheta) => {
    const p = pushOut(city, coastPoint(city, theta, off));
    const q = coastPoint(city, towardTheta, off);
    return { x: r1(p.x), z: r1(p.z), y: 0, heading: headingOf(p.x, p.z, q.x, q.z) };
  };

  {
    // Sprint: west along the coast from Saltyard Marina.
    const th = angleOf(marinaPier);
    const start = seaStart(th + 0.08, 55, th + 0.2);
    const pts = [];
    for (let k = 1; k <= 6; k++) pts.push(pushOut(city, coastPoint(city, th + 0.08 + k * 0.13, 70 + (k % 2) * 15)));
    boat('boat-saltyard', 'Saltyard Sprint', 'A short dash along the harbor wall from Saltyard Marina.', start,
      refineSea(city, [start, ...pts], false).slice(1), 16);
  }
  {
    // Slalom: weave north from Pale Shore Pier.
    const th = angleOf(westPier);
    const start = seaStart(th + 0.1, 100, th + 0.2);
    const pts = [];
    for (let k = 1; k <= 9; k++) pts.push(pushOut(city, coastPoint(city, th + 0.1 + k * 0.075, k % 2 ? 55 : 145)));
    boat('boat-slalom', 'Pale Shore Slalom', 'Swing left and right through the buoys off the beach.', start,
      refineSea(city, [start, ...pts], false, 140).slice(1), 13);
  }
  {
    // Island lap, around the far side of the airfield islet.
    const M = 100;
    const ex = { x0: islet.x0 - M, z0: islet.z0 - M, x1: islet.x1 + M, z1: islet.z1 + M };
    const inEx = (p) => p.x > ex.x0 - 60 && p.z > ex.z0 - 40 && p.z < ex.z1 + 40;
    const OFF = 120;
    const K = 22;
    const th0 = 0.6; // start south-east, just past the islet
    const ring = [];
    for (let k = 0; k < K; k++) ring.push(pushOut(city, coastPoint(city, th0 + (k * TAU) / K, OFF)));
    const kept = ring.filter((p) => !inEx(p));
    // The ring runs clockwise from above (heading increasing): it reaches
    // the islet from the north and leaves it to the south.
    const detour = [
      { x: ex.x0, z: ex.z0 }, { x: (ex.x0 + ex.x1) / 2, z: ex.z0 }, { x: ex.x1, z: ex.z0 },
      { x: ex.x1, z: ex.z1 }, { x: (ex.x0 + ex.x1) / 2, z: ex.z1 }, { x: ex.x0, z: ex.z1 },
    ];
    const pts = refineSea(city, [...kept, ...detour], true, 330);
    const s = pts[0];
    const startP = pushOut(city, coastPoint(city, th0 - 0.1, OFF));
    const start = { x: r1(startP.x), z: r1(startP.z), y: 0, heading: headingOf(startP.x, startP.z, s.x, s.z) };
    // Finish back where it began: close the loop on the first gate.
    boat('boat-island', 'Rustwater Round', 'The big one: a full lap of the island, out around the airfield.', start,
      [...pts, pts[0]], 18, false);
  }
}

// The main piers in the order they were built (Saltyard, Pale Shore,
// Northpoint on the island).
function mainPiersOf(city) {
  const mainPiers = city.piers.filter((p) => city.mainShore((p.x0 + p.x1) / 2, (p.z0 + p.z1) / 2) > -200);
  return { marinaPier: mainPiers[0], westPier: mainPiers[1] || mainPiers[0], northPier: mainPiers[2] || mainPiers[0] };
}

// First Feathers: an easy plane loop around the airfield islet.
function gullCourse(city, list, name = 'First Feathers', blurb = 'An easy, low loop around Gullwing Airfield. Take off east.') {
  const { islet, runway } = city.airfield;
  const rz = (runway.z0 + runway.z1) / 2;
  const icx = (islet.x0 + islet.x1) / 2, icz = (islet.z0 + islet.z1) / 2;
  const sky = (id, nm, kinds, bl, start, spec, extra = 0) => skyCourse(city, list, id, nm, kinds, bl, start, spec, extra);
  {
    const start = { x: r1(runway.x0 + 30), z: r1(rz), y: 0, heading: 0 };
    const R = 20;
    sky('sky-gull', name, ['plane'], blurb, start, [
      { x: islet.x1 + 160, z: rz, y: 35, r: R },
      { x: islet.x1 + 420, z: icz + 40, y: 50, r: R },
      { x: islet.x1 + 180, z: islet.z1 + 260, y: 55, r: R },
      { x: icx, z: islet.z1 + 320, y: 55, r: R },
      { x: islet.x0 + 40, z: islet.z1 + 260, y: 50, r: R },
      { x: islet.x0 - 140, z: icz, y: 45, r: R },
      { x: islet.x0 + 60, z: islet.z0 - 230, y: 45, r: R },
      { x: islet.x0 + 380, z: islet.z0 - 250, y: 40, r: R },
      { x: islet.x0 + 640, z: rz, y: 22, r: R },
    ]);
  }
}

function skyCourses(city, list, g) {
  const { avX, avZ, aCol, aRow, xs, zs, midX, midZ } = g;
  const { islet, runway } = city.airfield;
  const rz = (runway.z0 + runway.z1) / 2;
  const sky = (id, nm, kinds, bl, start, spec, extra = 0) => skyCourse(city, list, id, nm, kinds, bl, start, spec, extra);
  gullCourse(city, list);
  {
    const start = { x: r1(runway.x1 - 40), z: r1(rz), y: 0, heading: Math.PI };
    const C = CANYON_RING_R, R = 16;
    sky('sky-threader', 'Glasswell Threader', ['plane', 'heli'],
      'Thread the avenues between the towers. Low and fast, then over the top.', start, [
        { x: islet.x0 - 120, z: (rz + avZ) / 2, y: 60, r: R },
        { x: midX(aCol + 4), z: avZ, y: 50, r: R },
        { x: midX(aCol + 3), z: avZ, y: 30, r: C, canyon: true },
        { x: midX(aCol + 1), z: avZ, y: 30, r: C, canyon: true },
        { x: midX(aCol - 1), z: avZ, y: 30, r: C, canyon: true },
        { x: midX(aCol - 3), z: avZ, y: 30, r: C, canyon: true },
        { x: xs[aCol - 6] + 30, z: avZ - 60, y: 60, r: R },
        { x: xs[aCol - 5], z: zs[aRow - 4] - 20, y: 60, r: R },
        { x: xs[aCol - 2], z: zs[aRow - 6] + 10, y: 50, r: R },
        { x: avX, z: midZ(aRow - 5), y: 30, r: C, canyon: true },
        { x: avX, z: midZ(aRow - 3), y: 30, r: C, canyon: true },
        { x: avX, z: midZ(aRow - 2), y: 30, r: C, canyon: true },
        { x: avX, z: midZ(aRow), y: 30, r: C, canyon: true },
        { x: avX, z: midZ(aRow + 1), y: 30, r: C, canyon: true },
        { x: avX + 60, z: midZ(aRow + 3), y: 50, r: R },
      ]);
  }
  rooftopCourse(city, list);
}

// Rooftop Hopper: rings and three roof touch-downs west of the islet,
// home to the first airfield helipad.
function rooftopCourse(city, list, name = 'Rooftop Hopper', blurb = 'Tight rings and three rooftop touch-downs, then home to the helipad.') {
  const { islet } = city.airfield;
  const icz = (islet.z0 + islet.z1) / 2;
  const sky = (id, nm, kinds, bl, start, spec, extra = 0) => skyCourse(city, list, id, nm, kinds, bl, start, spec, extra);
  {
    const pad0 = city.helipads[0];
    // The helicopter parked on the pad sits in the zone, so start a little
    // way off the pad, on the first spot clear of every parked craft.
    const spots = [...city.aircraftSpots, ...city.boatSpots];
    const clear = (x, z) => spots.every((q) => hyp(q.x - x, q.z - z) >= START_SPOT_CLEAR);
    let sp = { x: pad0.x, z: pad0.z };
    for (let k = 0; k < 16 && !clear(sp.x, sp.z); k++) {
      const ang = (k * TAU) / 16;
      sp = { x: pad0.x + Math.cos(ang) * START_SPOT_CLEAR, z: pad0.z + Math.sin(ang) * START_SPOT_CLEAR };
    }
    const start = { x: r1(sp.x), z: r1(sp.z), y: 0, heading: Math.PI };
    const used = new Set();
    const T = 7;
    const roof1 = roofNear(city, islet.x0 - 380, icz - 140, used);
    const roof2 = roofNear(city, islet.x0 - 520, icz + 120, used);
    const roof3 = roofNear(city, islet.x0 - 300, icz + 260, used);
    sky('sky-rooftop', name, ['heli'], blurb, start, [
        { x: islet.x0 + 120, z: icz - 40, y: 25, r: T },
        { x: islet.x0 - 90, z: icz - 110, y: 30, r: T },
        roof1,
        { x: (roof1.x + roof2.x) / 2, z: (roof1.z + roof2.z) / 2, y: 30, r: T },
        roof2,
        { x: (roof2.x + roof3.x) / 2 - 20, z: (roof2.z + roof3.z) / 2, y: 30, r: T },
        roof3,
        { x: islet.x0 - 100, z: icz + 160, y: 30, r: T },
        { x: islet.x0 + 200, z: icz + 40, y: 25, r: T },
        { x: pad0.x, z: pad0.z, y: 1, r: 6, pad: true },
      ]);
  }
}

function deliveries(city, list, mainNodes) {
  const N = city.nodes;
  const { westPier, northPier } = mainPiersOf(city);
  const angleOf = (p) => Math.atan2((p.z0 + p.z1) / 2, (p.x0 + p.x1) / 2);
  const seaStart = (theta, off, towardTheta) => {
    const p = pushOut(city, coastPoint(city, theta, off));
    const q = coastPoint(city, towardTheta, off);
    return { x: r1(p.x), z: r1(p.z), y: 0, heading: headingOf(p.x, p.z, q.x, q.z) };
  };
  const delivery = (id, name, kinds, blurb, start, cps, meters, pads = 0) => deliveryCourse(list, id, name, kinds, blurb, start, cps, meters, pads);
  {
    // Courier: north-west Fernside to the Saltyard docks.
    const from = nearestNode(mainNodes, -420, -420);
    const to = nearestNode(mainNodes.filter((n) => city.districtOf(n.x, n.z) === 'docks'), 300, 520);
    const next = N[roadPath(city, from.id, to.id)[1]];
    const start = startOnEdge(from, next, 20);
    const cps = groundCheckpoints(city, [to.id], start.heading);
    delivery('deliver-courier', 'Parcel Dash', ['car'], 'A parcel for the docks, right across town. Do not dawdle.',
      start, cps, roadDistance(city, from.id, to.id));
  }
  {
    // Taxi fare: pick up downtown, three drop-offs.
    const from = nearestNode(mainNodes, 60, -150);
    const stops = [nearestNode(mainNodes, -330, 120), nearestNode(mainNodes, -200, -420), nearestNode(mainNodes, 400, -260)];
    const next = N[roadPath(city, from.id, stops[0].id)[1]];
    const start = startOnEdge(from, next, 20);
    const ids = stops.map((n) => n.id);
    const cps = groundCheckpoints(city, ids, start.heading);
    delivery('deliver-fare', 'Fare and Square', ['car'], 'A chatty passenger with three stops to make.',
      start, cps, roadLength(city, from.id, ids));
  }
  {
    // Boat parcel: Northpoint Jetty round to Pale Shore Pier.
    const thA = angleOf(northPier), thB = angleOf(westPier);
    const span = wrapAngle(thB - thA);
    const sg = span < 0 ? -1 : 1;
    const th0 = thA + sg * 0.08, th1 = thA + span - sg * 0.08; // clear of both piers
    const start = seaStart(th0, 50, th0 + sg * 0.12);
    const pts = [];
    const steps = Math.max(3, Math.ceil(Math.abs(th1 - th0) / 0.22));
    for (let k = 1; k <= steps; k++) pts.push(pushOut(city, coastPoint(city, th0 + ((th1 - th0) * k) / steps, k === steps ? 55 : 90)));
    const route = refineSea(city, [start, ...pts], false).slice(1);
    const cps = buoyCheckpoints(route, (k) => (k === route.length - 1 ? 14 : 18), false, start);
    delivery('deliver-tide', 'Tideline Parcel', ['boat'], 'Rush a crate from Northpoint Jetty round to Pale Shore Pier.',
      start, cps, pathLength3(start, cps));
  }
  airmailCourse(city, list, northPier);
}

// Air mail: from the airfield apron to a helipad (via a mail pick-up
// when every helipad is on the airfield itself).
function airmailCourse(city, list, northPier, name = 'Gullwing Air Mail', blurbAway = 'Fly the mail bag to the helipad before the post closes.') {
  const { islet, runway } = city.airfield;
  const delivery = (id, nm, kinds, blurb, start, cps, meters, pads = 0) => deliveryCourse(list, id, nm, kinds, blurb, start, cps, meters, pads);
  {
    const start = { x: r1(islet.x0 + 300), z: r1(runway.z1 + 90), y: 0, heading: Math.PI };
    const onIslet = (p) => p.x > islet.x0 && p.x < islet.x1 && p.z > islet.z0 && p.z < islet.z1;
    const away = city.helipads.filter((p) => !onIslet(p));
    const pool = away.length ? away : city.helipads;
    let pad = pool[0];
    for (const p of pool) if (hyp(p.x - start.x, p.z - start.z) > hyp(pad.x - start.x, pad.z - start.z)) pad = p;
    const spec = [];
    if (!away.length) {
      const nj = { x: (northPier.x0 + northPier.x1) / 2, z: northPier.z0 - 20 };
      spec.push({ x: 300, z: -380, y: 40, r: 14 }, { x: nj.x, z: nj.z, y: 25, r: 14 }, { x: 250, z: -250, y: 40, r: 14 });
    }
    spec.push({ x: pad.x, z: pad.z, y: 1, r: 7, pad: true });
    const cps = skyCheckpoints(city, spec, start);
    delivery('deliver-airmail', name, ['heli'],
      away.length ? blurbAway
        : 'Collect the mail bag over Northpoint Jetty and land it on the helipad.',
      start, cps, pathLength3(start, cps) * SKY_TURN_FACTOR, 1);
  }
}

function centroid(nodes) {
  let x = 0, z = 0;
  for (const n of nodes) { x += n.x; z += n.z; }
  return { x: x / nodes.length, z: z / nodes.length };
}

// ---------------------------------------------------------------------------
// A real map: courses from a hand-made spec (world/miami-spots.js)
// ---------------------------------------------------------------------------

// The point on an avenue's center line nearest (x, z) where a canyon ring
// of radius r fits: road under it, no building across its full width.
const CANYON_S = [-1, -0.5, 0, 0.5, 1]; // across the ring, in radii
function canyonPoint(city, street, x, z, r) {
  let best = null, bd = Infinity;
  const clear = (px, pz, e) => {
    for (let k = 0; k < CANYON_S.length; k++) {
      const s = CANYON_S[k];
      if (city.inBuilding(px - e.uz * s * r, pz + e.ux * s * r, 0.5)) return false;
    }
    return true;
  };
  const edges = city.edges;
  for (let k = 0; k < edges.length; k++) {
    const e = edges[k];
    if (!e.avenue || e.causeway || e.bridge || (street && e.name !== street)) continue;
    const a = city.nodes[e.a], b = city.nodes[e.b];
    const t0 = Math.max(a.hx, a.hz) + 3, t1 = e.length - Math.max(b.hx, b.hz) - 3;
    for (let t = t0; t <= t1; t += 2) {
      const px = a.x + e.ux * t, pz = a.z + e.uz * t;
      const d = hyp(px - x, pz - z);
      if (d >= bd || !clear(px, pz, e)) continue;
      bd = d;
      best = { x: px, z: pz };
    }
  }
  if (!best || bd > 150) throw new Error('courses: no canyon spot on ' + street);
  return best;
}

// A region build holds only part of the spec (world/regioncontent.js
// regionCourseSpec): every part is optional, the sky parts need the
// airfield, and a part that cannot be built on this region's ground is left
// out instead of throwing (the whole box still throws).
export function buildSpecCourses(city, spec) {
  const N = city.nodes;
  const gate = city.airfield ? city.airfield.gate : null;
  const mainNodes = N.filter((n) => n !== gate);
  const avoidGate = new Set(gate ? [gate.id] : []);
  const junction = (n) => n.edges.length !== 2;
  const junctions = mainNodes.filter(junction);
  const at = (p) => nearestNode(junctions, p.x, p.z);
  const list = [];
  const soft = !!city.region;
  const part = (f) => {
    if (!soft) return f();
    const n = list.length;
    try { return f(); } catch (err) {
      void err;
      list.length = n;
      return undefined;
    }
  };

  // --- Street races ---------------------------------------------------------
  for (const s of spec.street || []) {
    part(() => {
      const c = streetCircuit(city, s.via.map((p) => at(p).id), { avoid: avoidGate, ok: junction });
      const cps = groundCheckpoints(city, c.nodeIds, c.start.heading);
      const lap = roadLength(city, cps[cps.length - 1].node, c.nodeIds);
      list.push(finish({ id: s.id, name: s.name, type: 'street', kinds: ['car'], start: c.start, checkpoints: cps, laps: s.laps, blurb: s.blurb }, lap * s.laps));
    });
  }
  if (spec.causeway && gate) {
    const s = spec.causeway;
    part(() => list.push(causewayCourse(city, junctions, avoidGate, s.a, s.b, s.c, s.name, s.blurb, junction)));
  }

  // --- Boat races -----------------------------------------------------------
  const seaRoute = (start, gates, closed, maxLeg) => {
    const pts = gates.map((p) => pushToSea(city, p));
    return closed ? refineSea(city, pts, true, maxLeg, pushToSea) : refineSea(city, [start, ...pts], false, maxLeg, pushToSea).slice(1);
  };
  const seaStart = (s, toward) => {
    const p = pushToSea(city, s);
    return { x: r1(p.x), z: r1(p.z), y: 0, heading: headingOf(p.x, p.z, toward.x, toward.z) };
  };
  for (const b of spec.boats || []) {
    part(() => {
      const start = seaStart(b.start, b.gates[0]);
      if (b.lap) {
        // Close the loop on the first gate: the finish is where it began.
        const pts = seaRoute(start, b.gates, true, b.maxLeg || 330);
        start.heading = headingOf(start.x, start.z, pts[0].x, pts[0].z);
        boatCourse(list, b.id, b.name, b.blurb, start, [...pts, pts[0]], b.r, false);
      } else boatCourse(list, b.id, b.name, b.blurb, start, seaRoute(start, b.gates, false, b.maxLeg || 320), b.r);
    });
  }

  // --- Sky courses ----------------------------------------------------------
  if (spec.gull && city.airfield) part(() => gullCourse(city, list, spec.gull.name, spec.gull.blurb));
  if (spec.threader && city.airfield) {
    part(() => {
      const { runway } = city.airfield;
      const s = spec.threader;
      const start = { x: r1(runway.x1 - 40), z: r1((runway.z0 + runway.z1) / 2), y: 0, heading: Math.PI };
      const rings = s.rings.map((q) => (q.canyon ? { ...canyonPoint(city, q.street, q.x, q.z, q.r), y: q.y, r: q.r, canyon: true } : q));
      skyCourse(city, list, 'sky-threader', s.name, ['plane', 'heli'], s.blurb, start, rings);
    });
  }
  if (spec.rooftop && city.airfield && city.helipads.length) part(() => rooftopCourse(city, list, spec.rooftop.name, spec.rooftop.blurb));

  // --- Timed deliveries -----------------------------------------------------
  if (spec.courier) {
    part(() => {
      const s = spec.courier;
      const from = at(s.from), to = at(s.to);
      const next = N[roadPath(city, from.id, to.id, null, avoidGate)[1]];
      const start = startOnEdge(from, next, 20);
      const cps = groundCheckpoints(city, [to.id], start.heading);
      deliveryCourse(list, s.id || 'deliver-courier', s.name, ['car'], s.blurb, start, cps, roadDistance(city, from.id, to.id));
    });
  }
  if (spec.fare) {
    part(() => {
      const s = spec.fare;
      const from = at(s.from);
      const stops = s.stops.map(at);
      const next = N[roadPath(city, from.id, stops[0].id, null, avoidGate)[1]];
      const start = startOnEdge(from, next, 20);
      const ids = stops.map((n) => n.id);
      const cps = groundCheckpoints(city, ids, start.heading);
      deliveryCourse(list, 'deliver-fare', s.name, ['car'], s.blurb, start, cps, roadLength(city, from.id, ids));
    });
  }
  if (spec.tide) {
    part(() => {
      const s = spec.tide;
      const start = seaStart(s.start, s.gates[0]);
      const route = seaRoute(start, s.gates, false, 320);
      const cps = buoyCheckpoints(route, (k) => (k === route.length - 1 ? 14 : 18), false, start);
      deliveryCourse(list, 'deliver-tide', s.name, ['boat'], s.blurb, start, cps, pathLength3(start, cps));
    });
  }
  if (spec.airmail && city.airfield) {
    part(() => {
      if (soft && !city.helipads.some((p) => !onIslet(city, p))) return;
      airmailCourse(city, list, mainPiersOf(city).northPier, spec.airmail.name, spec.airmail.blurb);
    });
  }
  return tidy(list);
}
const onIslet = (city, p) => p.x > city.airfield.islet.x0 && p.x < city.airfield.islet.x1 && p.z > city.airfield.islet.z0 && p.z < city.airfield.islet.z1;

// ---------------------------------------------------------------------------
// Locked routes (docs/REVAMP.md 6.6): the three extra courses an adventure
// opens, built like the spec courses from world/adventures.js ROUTE_SPECS.
// Kept apart from buildCourses (city.routes) so the 14 courses and their
// order never change; each route carries `locked: adventureId` and the
// activities system offers it only once that adventure is done.
// A `river` boat route follows a narrow river: its gates sit on the
// deepest water near each point instead of being pushed out to open sea.
// ---------------------------------------------------------------------------
function deepestNear(city, p, R = 40) {
  let best = { x: p.x, z: p.z }, bd = city.shoreDist(p.x, p.z);
  for (let dx = -R; dx <= R; dx += 4) {
    for (let dz = -R; dz <= R; dz += 4) {
      if (dx * dx + dz * dz > R * R) continue;
      const d = city.shoreDist(p.x + dx, p.z + dz);
      if (d < bd) { bd = d; best = { x: p.x + dx, z: p.z + dz }; }
    }
  }
  return { x: r1(best.x), z: r1(best.z) };
}

// A region build offers a route only when the region holds all of its
// points 40 m inside (the PLAN_V2 3.2 rule); boat routes may end out on
// the water, so they get the land margin. The airfield is not needed.
export function buildRoutes(city, specs) {
  if (!city || !city.courseSpec || !specs) return [];
  const N = city.nodes;
  const gate = city.airfield ? city.airfield.gate : null;
  const avoidGate = new Set(gate ? [gate.id] : []);
  const junction = (n) => n.edges.length !== 2;
  const junctions = N.filter((n) => n !== gate && junction(n));
  const at = (p) => nearestNode(junctions, p.x, p.z);
  const region = city.region || null;
  const holds = (v, m) => !region || holdsAll(region, pointsIn(v), m);
  const list = [];
  for (const s of specs.street || []) {
    if (!holds(s.via, PLACE_MARGIN)) continue;
    const c = streetCircuit(city, s.via.map((p) => at(p).id), { avoid: avoidGate, ok: junction });
    const cps = groundCheckpoints(city, c.nodeIds, c.start.heading);
    const lap = roadLength(city, cps[cps.length - 1].node, c.nodeIds);
    list.push(finish({ id: s.id, name: s.name, type: 'street', kinds: ['car'], start: c.start, checkpoints: cps, laps: s.laps, blurb: s.blurb, locked: s.locked }, lap * s.laps));
  }
  for (const b of specs.boats || []) {
    if (!holds([b.start, b.gates], PLACE_MARGIN)) continue;
    let start, pts;
    if (b.river) {
      const s0 = deepestNear(city, b.start, 16);
      pts = b.gates.map((p) => deepestNear(city, p, 8));
      start = { x: s0.x, z: s0.z, y: 0, heading: headingOf(s0.x, s0.z, pts[0].x, pts[0].z) };
    } else {
      const p = pushToSea(city, b.start);
      start = { x: r1(p.x), z: r1(p.z), y: 0, heading: headingOf(p.x, p.z, b.gates[0].x, b.gates[0].z) };
      pts = refineSea(city, [start, ...b.gates.map((q) => pushToSea(city, q))], false, b.maxLeg || 320, pushToSea).slice(1);
    }
    boatCourse(list, b.id, b.name, b.blurb, start, pts, b.r);
    list[list.length - 1].locked = b.locked;
  }
  return tidy(list);
}
