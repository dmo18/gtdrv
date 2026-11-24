// GPS audit (docs/PLAN_V4.md task 2): seeded origin/destination pairs per
// region run through the in-game router. Exported so test/gps-audit.test.js
// can pin the same checks; run directly for a table: node scripts/gps-audit.mjs [pairs]
import { createRng } from '../src/core/rng.js';
import { canDrive, lanePoint } from '../src/world/citygen.js';
import { createRouter, createRoute, createTracker, shortStreet } from '../src/core/route.js';

// A point on a random edge's lane, facing along a legal direction.
export function pickPoint(city, rng, out) {
  for (let k = 0; k < 50; k++) {
    const e = city.edges[rng.int(0, city.edges.length - 1)];
    if (e.length < 25 || e.ped || e.cls === 'pedestrian') continue;
    const fromA = e.oneway ? true : rng.next() < 0.5;
    const from = fromA ? e.a : e.b;
    const d = e.length * (0.2 + rng.next() * 0.6);
    lanePoint(city, e, from, d, 0, out);
    out.edge = e.id; out.from = from; out.d = d;
    return out;
  }
  return out;
}

// Dijkstra on pure length over legal directions (node to node), for the ratio check.
// Shortest legal length by plain meters (malls, pedestrian and living streets left out).
export function shortestLength(city, e0, from0, d0, e1, from1, d1) {
  // start: after leaving e0 from `from0` we reach the far node; goal: reach the near node of e1 then drive d1.
  const nodes = city.nodes, edges = city.edges;
  const dist = new Float64Array(nodes.length).fill(Infinity);
  const heap = [];
  const push = (n, d) => { heap.push([d, n]); let i = heap.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; } };
  const pop = () => { const t = heap[0], l = heap.pop(); if (heap.length) { heap[0] = l; let i = 0; for (;;) { let c = 2 * i + 1; if (c >= heap.length) break; if (c + 1 < heap.length && heap[c + 1][0] < heap[c][0]) c++; if (heap[c][0] >= heap[i][0]) break; [heap[c], heap[i]] = [heap[i], heap[c]]; i = c; } } return t; };
  const e0o = e0.a === from0 ? e0.b : e0.a;
  push(e0o, e0.length - d0); dist[e0o] = e0.length - d0;
  let best = Infinity;
  if (e0 === e1 && from0 === from1 && d1 >= d0) best = d1 - d0;
  while (heap.length) {
    const [d, u] = pop();
    if (d > dist[u]) continue;
    if (u === from1 && canDrive(e1, from1)) best = Math.min(best, d + d1);
    if (d > best) break;
    for (const id of nodes[u].edges) {
      const e = edges[id];
      if (!canDrive(e, u) || e.ped || e.cls === 'pedestrian' || e.cls === 'living_street') continue; // a route avoids malls and living streets on purpose
      const v = e.a === u ? e.b : e.a;
      if (d + e.length < dist[v]) { dist[v] = d + e.length; push(v, dist[v]); }
    }
  }
  return best;
}

// Checks one route; returns an array of problem strings (empty when fine).
export function checkRoute(city, r, edges = city.edges) {
  const bad = [];
  for (let i = 0; i < r.edges; i++) {
    const e = edges[r.pathE[i]], from = r.pathFrom[i];
    if (!(e.a === from || e.b === from)) bad.push('edge ' + i + ' not at from node');
    else if (!canDrive(e, from)) bad.push('wrong way on edge ' + e.id + ' ' + e.name);
    if (i > 0) {
      const p = edges[r.pathE[i - 1]], pf = r.pathFrom[i - 1];
      if ((p.a === pf ? p.b : p.a) !== from) bad.push('path break at ' + i);
    }
  }
  for (let i = 1; i < r.n; i++) if (!(r.cum[i] > r.cum[i - 1])) bad.push('cum not growing at ' + i);
  return bad;
}

function posAt(r, s, out) {
  let i = 0;
  while (i + 2 < r.n && r.cum[i + 1] < s) i++;
  const t = Math.max(0, Math.min(1, (s - r.cum[i]) / (r.cum[i + 1] - r.cum[i] || 1)));
  out.x = r.x[i] + (r.x[i + 1] - r.x[i]) * t; out.z = r.z[i] + (r.z[i + 1] - r.z[i]) * t;
  return out;
}
function lineHeading(r, s0, s1) {
  if (s0 < 0 || s1 > r.length) return null;
  const a = posAt(r, s0, { x: 0, z: 0 }), b = posAt(r, s1, { x: 0, z: 0 });
  if (Math.hypot(b.x - a.x, b.z - a.z) < 3) return null;
  return Math.atan2(b.z - a.z, b.x - a.x);
}

// Guidance vs path: every turn (but arrive) sits at the junction between two
// path edges; its name is the road taken, its kind follows the signed angle.
// Also the pill the HUD would show for the first turn.
export function checkGuidance(city, r) {
  const bad = [];
  const edges = city.edges;
  for (let k = 0; k < r.turnCount; k++) {
    const t = r.turns[k];
    if (t.kind === 'arrive') {
      if (k !== r.turnCount - 1) bad.push('arrive not last');
      continue;
    }
    if (t.node < 0) continue; // the opening U-turn
    // locate the junction on the path
    let pi = -1;
    for (let i = 1; i < r.edges; i++) if (r.pathFrom[i] === t.node) { pi = i; break; }
    if (pi < 0) { bad.push('turn ' + k + ' node not on path'); continue; }
    const e1 = edges[r.pathE[pi]];
    if (t.kind !== 'exit' && t.kind !== 'merge') {
      // the street after the turn: named edge within the next 150 m of path
      let run = 0, name = '';
      for (let j = pi; j < r.edges; j++) { const e = edges[r.pathE[j]]; if (e.name) { name = e.name; break; } run += e.length; if (run > 150) break; }
      // a merged pair of divided-road turns names the later one; allow any edge name within 60 m after the node
      let ok = shortStreet(name) === t.name;
      if (!ok) { // merged turns: the name may come from a later junction within MERGE reach
        let acc = 0;
        for (let j = pi; j < r.edges && acc < 120; j++) { const e = edges[r.pathE[j]]; if (e.name && shortStreet(e.name) === t.name) ok = true; acc += e.length; }
      }
      if (!ok) bad.push('turn ' + k + ' says "' + t.name + '", next edge is "' + e1.name + '" (' + name + ')');
    }
    // the arrow's side agrees with the lane line the car follows: heading
    // 30 to 6 m before the turn against 6 to 30 m after it (clear turns only)
    const eIn = edges[r.pathE[pi - 1]];
    if (eIn.length >= 40 && e1.length >= 40 && (t.kind === 'left' || t.kind === 'right' || t.kind === 'sharp-left' || t.kind === 'sharp-right')) {
      const h0 = lineHeading(r, t.at - 30, t.at - 6), h1 = lineHeading(r, t.at + 6, t.at + 30);
      if (h0 !== null && h1 !== null) {
        let d = h1 - h0;
        d = Math.atan2(Math.sin(d), Math.cos(d));
        if (Math.abs(d) > 0.5 && (d > 0) !== t.kind.endsWith('right')) bad.push('turn ' + k + ' arrow ' + t.kind + ' but line turns ' + (d * 57.3).toFixed(0) + ' deg');
      }
    }
    if (!(t.at >= 0 && t.at <= r.length + 0.01)) bad.push('turn ' + k + ' at ' + t.at + ' outside route');
  }
  if (r.turnCount < 1 || r.turns[r.turnCount - 1].kind !== 'arrive') bad.push('no arrive');
  return bad;
}

// Strongly connected components over legal driving (Tarjan, iterative): comp[node].
// A pair in the same component must have a route; a pair across two is a one-way trap
// or an island of the crop and may only get a partial route.
export function components(city) {
  const N = city.nodes.length, idx = new Int32Array(N).fill(-1), low = new Int32Array(N), on = new Uint8Array(N), comp = new Int32Array(N).fill(-1);
  let t = 0, nc = 0;
  const st = [];
  for (let s = 0; s < N; s++) {
    if (idx[s] >= 0) continue;
    const stack = [[s, 0]];
    idx[s] = low[s] = t++; st.push(s); on[s] = 1;
    while (stack.length) {
      const fr = stack[stack.length - 1], u = fr[0], es = city.nodes[u].edges;
      if (fr[1] < es.length) {
        const e = city.edges[es[fr[1]++]];
        if (!canDrive(e, u)) continue;
        const v = e.a === u ? e.b : e.a;
        if (idx[v] < 0) { idx[v] = low[v] = t++; st.push(v); on[v] = 1; stack.push([v, 0]); } else if (on[v]) low[u] = Math.min(low[u], idx[v]);
      } else {
        stack.pop();
        if (stack.length) { const p = stack[stack.length - 1][0]; low[p] = Math.min(low[p], low[u]); }
        if (low[u] === idx[u]) { let w; do { w = st.pop(); on[w] = 0; comp[w] = nc; } while (w !== u); nc++; }
      }
    }
  }
  return comp;
}

export function runRegion(city, seed, pairs = 200) {
  const rng = createRng(seed);
  const router = createRouter(city);
  const comp = components(city);
  const r = createRoute();
  const A = { x: 0, z: 0, heading: 0, edge: 0, from: 0, d: 0 }, B = { x: 0, z: 0, heading: 0, edge: 0, from: 0, d: 0 };
  const res = { pairs: 0, noRoute: [], partial: 0, illegal: [], ratioBad: [], guide: [], missed: [], longer: [], maxRatio: 0, sumRatio: 0, ratioN: 0, worstVsShortest: 0 };
  for (let n = 0; n < pairs; n++) {
    pickPoint(city, rng, A); pickPoint(city, rng, B);
    const info = { n, a: [A.edge, A.from, A.d], b: [B.edge, B.from, B.d] };
    res.pairs++;
    const ok = router.search(A.x, A.z, A.heading, B.x, B.z, r);
    const connected = comp[city.edges[A.edge].a === A.from ? city.edges[A.edge].b : city.edges[A.edge].a] === comp[B.from];
    info.connected = connected;
    if (!ok || r.partial) {
      if (r.partial) res.partial++;
      res.noRoute.push(info);
      if (connected) res.missed.push(info); // both on roads, one strongly connected piece: a route must exist
      continue;
    }
    const bad = checkRoute(city, r);
    if (bad.length) res.illegal.push({ ...info, bad });
    const straight = Math.hypot(A.x - B.x, A.z - B.z);
    // B is a lane point entered from B.from; the goal edge may be driven either way on a two-way road
    if (straight > 150) {
      const ratio = r.length / straight;
      res.sumRatio += ratio; res.ratioN++;
      if (ratio > res.maxRatio) res.maxRatio = ratio;
      if (ratio > 3.5) res.ratioBad.push({ ...info, ratio, len: r.length, straight });
    }
    if (connected) {
      const L = shortestLength(city, city.edges[A.edge], A.from, A.d, city.edges[B.edge], B.from, B.d);
      if (L > 100 && Number.isFinite(L)) {
        const q = r.length / L;
        if (q > res.worstVsShortest) res.worstVsShortest = q;
        if (q > 1.2) res.longer.push({ ...info, q, len: r.length, shortest: L });
      }
    }
    const g = checkGuidance(city, r);
    if (g.length) res.guide.push({ ...info, g });
  }
  return res;
}

const DT = 1 / 60;
function lineAt(r, d, o) {
  let i = 0;
  while (i + 2 < r.n && r.cum[i + 1] < d) i++;
  const t = Math.max(0, Math.min(1, (d - r.cum[i]) / (r.cum[i + 1] - r.cum[i] || 1)));
  const dx = r.x[i + 1] - r.x[i], dz = r.z[i + 1] - r.z[i];
  o.x = r.x[i] + dx * t; o.z = r.z[i] + dz * t; o.h = Math.atan2(dz, dx);
  return o;
}
function distToLine(r, x, z) {
  let md = Infinity;
  for (let i = 0; i + 1 < r.n; i++) {
    const ax = r.x[i], az = r.z[i], dx = r.x[i + 1] - ax, dz = r.z[i + 1] - az, l2 = dx * dx + dz * dz || 1;
    let u = ((x - ax) * dx + (z - az) * dz) / l2;
    u = u < 0 ? 0 : u > 1 ? 1 : u;
    md = Math.min(md, Math.hypot(ax + dx * u - x, az + dz * u - z));
  }
  return md;
}

// Drive each route at 14 m/s, `lat` meters to the side of the lane line (a
// real car is never exactly on it): the cursor must not re-route, must
// step the next turn one at a time, and the car must arrive.
export function followRoutes(city, seed, pairs, lat = 2) {
  const rng = createRng(seed), router = createRouter(city);
  const A = {}, B = {};
  const out = { ran: 0, arrived: 0, rerouted: 0, skipped: 0, backwards: 0, worstToTurnRise: 0 };
  for (let k = 0; k < pairs; k++) {
    pickPoint(city, rng, A); pickPoint(city, rng, B);
    const tr = createTracker(router);
    tr.setGoal(B.x, B.z);
    tr.update(A.x, A.z, A.heading, 0, DT);
    const r = tr.route;
    if (!r.ok || r.partial) continue;
    out.ran++;
    const rev0 = tr.rev, q = { x: 0, z: 0, h: 0 };
    let along = 0, lastTurn = 0;
    while (along < r.length + 5 && tr.rev === rev0 && !tr.arrived) {
      along += 14 * DT;
      lineAt(r, along, q);
      tr.update(q.x - Math.sin(q.h) * lat, q.z + Math.cos(q.h) * lat, q.h, 14, DT);
      if (tr.turn < lastTurn) out.backwards++;
      if (tr.turn > lastTurn + 1) out.skipped++;
      lastTurn = tr.turn;
    }
    if (tr.rev !== rev0) out.rerouted++; else if (tr.arrived) out.arrived++;
  }
  return out;
}

// A wrong turn: drive route 1 up to 25 m before its first turn, then follow a
// route to somewhere else (leaving the line). Returns the seconds from the car
// being 8 m off the line until the tracker searched again, per case.
export function rerouteTimes(city, seed, tries) {
  const rng = createRng(seed), router = createRouter(city);
  const A = {}, B = {}, C = {};
  const times = [];
  for (let k = 0; k < tries; k++) {
    pickPoint(city, rng, A); pickPoint(city, rng, B); pickPoint(city, rng, C);
    const tr = createTracker(router);
    tr.setGoal(B.x, B.z);
    tr.update(A.x, A.z, A.heading, 0, DT);
    const r1 = tr.route;
    if (!r1.ok || r1.partial || r1.startUturn || r1.turnCount < 2) continue;
    const t = r1.turns[0];
    if (t.kind === 'arrive' || t.kind === 'uturn' || t.at < 40) continue;
    const q = { x: 0, z: 0, h: 0 };
    lineAt(r1, t.at - 25, q);
    const r2 = createRoute();
    router.search(q.x, q.z, q.h, C.x, C.z, r2);
    if (!r2.ok || r2.partial || r2.length < 200) continue;
    // r2 has to leave r1 within 120 m of the branch
    let leaves = false;
    for (let d = 26; d < 120 && !leaves; d += 2) { lineAt(r2, d, q); leaves = distToLine(r1, q.x, q.z) > 8; }
    if (!leaves) continue;
    let along = 0;
    while (along < t.at - 25) { along += 12 * DT; lineAt(r1, along, q); tr.update(q.x, q.z, q.h, 12, DT); }
    const rev0 = tr.rev;
    let d2 = 0, off8 = 0, done = false;
    for (let g = 0; g < 60 * 20 && !done; g++) {
      d2 += 12 * DT;
      lineAt(r2, d2, q);
      if (distToLine(r1, q.x, q.z) > 8) off8 += DT;
      tr.update(q.x, q.z, q.h, 12, DT);
      if (tr.rev !== rev0) { done = true; times.push(off8); }
    }
    if (!done) times.push(Infinity);
  }
  return times;
}

if (process.argv[1] && process.argv[1].endsWith('gps-audit.mjs')) {
  const { regionCity, REGION_IDS } = await import('../test/regionfixture.js');
  const pairs = Number(process.argv[2]) || 200;
  for (const id of REGION_IDS) {
    const c = regionCity(id);
    const res = runRegion(c, 4242, pairs);
    console.log(id, 'pairs', res.pairs, 'noRoute', res.noRoute.length, 'missed', res.missed.length, 'worstVsShortest', res.worstVsShortest.toFixed(2), 'illegal', res.illegal.length, 'ratio>3.5', res.ratioBad.length, 'maxRatio', res.maxRatio.toFixed(2), 'meanRatio', (res.sumRatio / (res.ratioN || 1)).toFixed(2), 'guide', res.guide.length);
    for (const k of ['missed', 'longer', 'illegal', 'ratioBad', 'guide']) for (const x of res[k].slice(0, 3)) console.log('  ', k, JSON.stringify(x));
  }
}
