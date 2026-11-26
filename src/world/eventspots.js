// Where the street events are (docs/LOOP.md section b): 20 to 40 gates per
// region, placed by rule on the real road graph from a seed. Pure: the
// same city data always gives the same events (no DOM, no three.js, no
// clock). Uses city.nodes, city.edges, city.crop, city.spawn, city.garages,
// city.rampSpots, city.isLand, city.shoreDist and city.inBuilding as they are.
import { createRng } from '../core/rng.js';
import { RAMP_LAND, makeSpot } from './stunts.js';
import {
  trapTargets, missTargets, jumpTargets, dashTargets, dashLimit, heatTargets, wreckTargets,
  TRAP_LIMIT, MISS_LIMIT, JUMP_LIMIT, HEAT_LIMIT, WRECK_LIMIT, TEMPLATE_INFO,
} from '../core/streetevents.js';
import { shortStreet } from '../core/route.js';

export const EVENT_SEED = 41077;
// Gates per template in a region (30 in all; a region too small for a
// template's rule gets fewer of it, never fewer than 20 in all).
export const QUOTA = { trap: 6, miss: 6, jump: 4, dash: 6, heat: 3, wreck: 5 };
export const GATE_APART = 170; // m between any two gates
export const SAME_APART = 420; // m between two gates of one template
export const EDGE_MARGIN = 150; // m inside the region's crop
export const INTRO_AHEAD = 115; // m from the start place to the first gate
export const TRAP_RUN = [260, 420]; // m from the gate to the trap line
export const JUMP_RUN = 95; // m from the gate to the ramp
export const JUMP_LAND = 70; // m of straight street past the ramp
export const DASH_RANGE = [380, 760]; // m (street blocks: |dx| + |dz|) to the drop
const NO_CLASS = { motorway: 1, motorway_link: 1, trunk_link: 1, primary_link: 1, secondary_link: 1, tertiary_link: 1, pedestrian: 1, living_street: 1, causeway: 1 };
const MAIN = { trunk: 1, primary: 1, secondary: 0.85, tertiary: 0.7 };
const SLUGS = { 'miami-beach': 'beach', 'miami-downtown': 'downtown', 'miami-north': 'north', 'miami-west': 'west', 'miami-south': 'south', miami: 'miami', island: 'island' };
export const REGION_SLUGS = Object.values(SLUGS);
export const regionSlug = (city) => (city && SLUGS[city.mapId]) || (city && city.map ? 'miami' : 'island');

const r1 = (v) => Math.round(v * 10) / 10;
const hashOf = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return h >>> 0; };

// A straight run along one street: the edges followed from `from` on edge
// `e`, while the name holds and the street bends less than 14 degrees.
// Writes edge ids, start nodes and lengths into the scratch arrays;
// returns the run's length in meters.
function walk(city, e, from, maxLen, S) {
  S.n = 0;
  let len = 0, cur = e, at = from;
  const ux0 = cur.a === at ? cur.ux : -cur.ux, uz0 = cur.a === at ? cur.uz : -cur.uz;
  while (cur && len < maxLen && S.n < S.edge.length) {
    S.edge[S.n] = cur.id;
    S.from[S.n] = at;
    S.cum[S.n] = len;
    S.n++;
    len += cur.length;
    const end = cur.a === at ? cur.b : cur.a;
    const node = city.nodes[end];
    let next = null;
    for (let k = 0; k < node.edges.length; k++) {
      const o = city.edges[node.edges[k]];
      if (o === cur || o.name !== cur.name || o.bridge || NO_CLASS[o.cls]) continue;
      if (o.oneway && o.a !== end) continue;
      const ux = o.a === end ? o.ux : -o.ux, uz = o.a === end ? o.uz : -o.uz;
      if (ux * ux0 + uz * uz0 < 0.97) continue;
      next = o;
      break;
    }
    cur = next;
    at = end;
  }
  S.len = len;
  return len;
}
// The point `s` meters along a walked run: center of the road strip,
// heading of travel, half width, edge, clearance to the junction boxes.
function pointAt(city, S, s, out) {
  let i = S.n - 1;
  while (i > 0 && S.cum[i] > s) i--;
  const e = city.edges[S.edge[i]], from = city.nodes[S.from[i]];
  const fwd = e.a === S.from[i];
  const ux = fwd ? e.ux : -e.ux, uz = fwd ? e.uz : -e.uz;
  const d = Math.min(e.length, s - S.cum[i]);
  const o = (e.off || 0) * (fwd ? 1 : -1);
  out.x = from.x + ux * d - uz * o;
  out.z = from.z + uz * d + ux * o;
  out.dx = ux;
  out.dz = uz;
  out.w = e.width / 2;
  out.edge = e;
  const to = city.nodes[fwd ? e.b : e.a];
  out.clear = Math.min(d - Math.max(from.hx, from.hz), e.length - d - Math.max(to.hx, to.hz));
  return out;
}

// placeEvents(city): the region's events, in template order. Each:
// { id, tpl, name, street, x, z, heading, dx, dz, w, limit, targets,
//   tx, tz (trap line, ramp or drop point), run (m), level (heat), ramp }.
export function placeEvents(city, seed = EVENT_SEED) {
  const out = [];
  if (!city || !Array.isArray(city.nodes) || !Array.isArray(city.edges) || city.edges.length < 8) return out;
  const slug = regionSlug(city);
  const crop = city.crop || city.bounds || null;
  const inside = (x, z, m = EDGE_MARGIN) => !crop || (x > crop.x0 + m && x < crop.x1 - m && z > crop.z0 + m && z < crop.z1 - m);
  const land = (x, z) => (!city.isLand || city.isLand(x, z)) && (!city.shoreDist || city.shoreDist(x, z) > 12);
  const spawn = city.spawn || null;
  const keep = []; // garages, travel pads, ramps the map already has
  for (const g of city.garages || []) keep.push({ x: g.x, z: g.z, r: 60 });
  for (const t of city.travelPads || []) keep.push({ x: t.x, z: t.z, r: 90 });
  const oldRamps = Array.isArray(city.rampSpots) ? city.rampSpots.filter((r) => !r.event) : [];
  for (const r of oldRamps) keep.push({ x: r.x, z: r.z, r: 70 });
  const usable = (e) => !!e.name && !e.bridge && !e.ped && !NO_CLASS[e.cls] && e.length >= 40 && e.width >= 5; // a gate needs a street wider than one narrow ramp lane
  const S = { edge: new Int32Array(48), from: new Int32Array(48), cum: new Float64Array(48), n: 0, len: 0 };
  const P = { x: 0, z: 0, dx: 0, dz: 0, w: 0, edge: null, clear: 0, s: 0 };
  const Q = { x: 0, z: 0, dx: 0, dz: 0, w: 0, edge: null, clear: 0 };

  const free = (x, z, tpl, apart = GATE_APART, same = SAME_APART) => {
    if (!inside(x, z) || !land(x, z)) return false;
    if (spawn && Math.hypot(x - spawn.x, z - spawn.z) < 70) return false;
    for (const k of keep) if (Math.hypot(x - k.x, z - k.z) < k.r) return false;
    for (const o of out) {
      const d = Math.hypot(x - o.x, z - o.z);
      if (d < apart || (o.tpl === tpl && d < same)) return false;
      // a gate never stands on another event's ramp or trap line
      if (Number.isFinite(o.tx) && o.tpl !== 'dash' && Math.hypot(x - o.tx, z - o.tz) < 60) return false;
    }
    return true;
  };
  const counts = {};
  const push = (tpl, p, extra) => {
    const n = (counts[tpl] = (counts[tpl] || 0) + 1);
    const street = shortStreet(p.edge.name);
    const ev = {
      id: 'ev_' + slug + '_' + tpl + '_' + n, tpl, name: street + ' ' + TEMPLATE_INFO[tpl].title.toLowerCase(), street,
      x: r1(p.x), z: r1(p.z), heading: Math.round(Math.atan2(p.dz, p.dx) * 1000) / 1000, dx: p.dx, dz: p.dz, w: r1(p.w),
      limit: 0, targets: null, tx: NaN, tz: NaN, run: 0, level: 0, ramp: null, busy: 1,
      // where a retry (or a daily start) puts the car: `back` m before the gate, `side` m right of the strip center
      back: Math.max(14, Math.min(40, Math.round(p.s || 40))), side: p.edge.oneway ? 0 : r1(p.w * 0.3),
    };
    Object.assign(ev, extra);
    out.push(ev);
    return ev;
  };
  // Candidate starts for a template, in a seeded order: [edge id, from node].
  const order = (tpl, ok) => {
    const rng = createRng((seed ^ hashOf(slug + ':' + tpl)) >>> 0);
    const list = [];
    for (const e of city.edges) {
      if (!usable(e) || !ok(e)) continue;
      list.push({ e, from: e.a, k: rng.next() });
      if (!e.oneway) list.push({ e, from: e.b, k: rng.next() });
    }
    list.sort((a, b) => a.k - b.k || a.e.id - b.e.id);
    // (A run that starts at a dead end has a gate no car can reach from
    // behind but through the gate itself: 0.13.7, 38th Street on the Beach.)
    return list.filter((c) => city.nodes[c.from].edges.length > 1);
  };
  // The same order with the candidates within 250 to 700 m of the start
  // place first (nearest first): the first heat escape and the first jump
  // are a short drive from the start (the first five minutes). Among them
  // the gates that face away from the start come first: driven to from
  // the start, they are reached from behind, the right way through.
  const nearFirst = (list) => {
    if (!spawn) return list;
    const d = (c) => Math.hypot(city.nodes[c.from].x - spawn.x, city.nodes[c.from].z - spawn.z);
    const away = (c) => {
      const n = city.nodes[c.from], k = c.e.a === c.from ? 1 : -1;
      return (n.x - spawn.x) * c.e.ux * k + (n.z - spawn.z) * c.e.uz * k > 0 ? 0 : 1;
    };
    const near = list.filter((c) => d(c) >= 250 && d(c) <= 700).sort((a, b) => away(a) - away(b) || d(a) - d(b) || a.e.id - b.e.id);
    return near.concat(list.filter((c) => !(d(c) >= 250 && d(c) <= 700)));
  };
  // The gate spot on a walked run: the first point with 14 m to both junction boxes.
  const gateOn = (from = 16) => {
    for (let s = from; s < Math.min(S.len - 16, from + 120); s += 6) {
      pointAt(city, S, s, P);
      P.s = s;
      if (P.clear >= 14) return s;
    }
    return -1;
  };

  // --- 0. The first gate: a near-miss run on the start street, just ahead of the start place. ---
  if (spawn) {
    let best = null, bd = 14;
    const hx = Math.cos(spawn.heading), hz = Math.sin(spawn.heading);
    for (const e of city.edges) {
      if (!usable(e)) continue;
      const a = city.nodes[e.a];
      const t = Math.max(0, Math.min(e.length, (spawn.x - a.x) * e.ux + (spawn.z - a.z) * e.uz));
      const d = Math.hypot(a.x + e.ux * t - spawn.x, a.z + e.uz * t - spawn.z);
      if (d < bd) { bd = d; best = { e, t }; }
    }
    if (best) {
      const fwd = best.e.ux * hx + best.e.uz * hz >= 0;
      const from = fwd ? best.e.a : best.e.b;
      walk(city, best.e, from, 600, S);
      const s0 = (fwd ? best.t : best.e.length - best.t) + INTRO_AHEAD;
      for (let s = s0; s < Math.min(S.len - 20, s0 + 80); s += 5) {
        pointAt(city, S, s, P);
        if (P.clear < 12 || !land(P.x, P.z) || !inside(P.x, P.z, 60)) continue;
        P.s = 40;
        push('miss', P, { limit: MISS_LIMIT, targets: missTargets(MISS_LIMIT, 0.75), busy: 0.75, intro: true });
        break;
      }
    }
  }

  // --- 1. Speed traps: a gate, then the line 260 to 420 m down a straight street. ---
  for (const c of order('trap', (e) => e.length >= 60)) {
    if ((counts.trap || 0) >= QUOTA.trap) break;
    if (walk(city, c.e, c.from, 520, S) < TRAP_RUN[0] + 40) continue;
    const g = gateOn();
    if (g < 0 || !free(P.x, P.z, 'trap')) continue;
    const run = Math.min(TRAP_RUN[1], S.len - g - 24);
    if (run < TRAP_RUN[0]) continue;
    pointAt(city, S, g + run, Q);
    if (Q.clear < 4 || !land(Q.x, Q.z) || !inside(Q.x, Q.z, 60)) continue;
    push('trap', P, { limit: TRAP_LIMIT, targets: trapTargets(run), tx: r1(Q.x), tz: r1(Q.z), run: Math.round(run), tdx: Q.dx, tdz: Q.dz, tw: r1(Q.w) });
  }

  // --- 2. Near-miss runs: main roads, where the cars are. ---
  for (const c of order('miss', (e) => MAIN[e.cls] > 0 && e.length >= 70)) {
    if ((counts.miss || 0) >= QUOTA.miss) break;
    if (walk(city, c.e, c.from, 400, S) < 220) continue;
    const g = gateOn();
    if (g < 0 || !free(P.x, P.z, 'miss')) continue;
    const busy = MAIN[c.e.cls];
    push('miss', P, { limit: MISS_LIMIT, targets: missTargets(MISS_LIMIT, busy), busy });
  }

  // --- 3. Jumps: a ramp 95 m past the gate on a quiet straight street. ---
  const need = RAMP_LAND.slope * 2 + RAMP_LAND.top / 2 + 6;
  for (const c of nearFirst(order('jump', (e) => !MAIN[e.cls] || e.cls === 'tertiary'))) {
    if ((counts.jump || 0) >= QUOTA.jump) break;
    if (walk(city, c.e, c.from, 420, S) < JUMP_RUN + JUMP_LAND + 60) continue;
    const g = gateOn();
    if (g < 0 || !free(P.x, P.z, 'jump')) continue;
    let ramp = null;
    for (let s = g + JUMP_RUN; s <= g + JUMP_RUN + 60 && s + JUMP_LAND < S.len; s += 4) {
      pointAt(city, S, s, Q);
      if (Q.clear < need || !land(Q.x, Q.z) || !inside(Q.x, Q.z, 80)) continue;
      if (city.inBuilding && city.inBuilding(Q.x, Q.z, RAMP_LAND.width)) continue;
      if (keep.some((k) => Math.hypot(Q.x - k.x, Q.z - k.z) < k.r + 60)) continue;
      if (out.some((o) => Math.hypot(Q.x - o.x, Q.z - o.z) < 60 || (o.ramp && Math.hypot(Q.x - o.ramp.x, Q.z - o.ramp.z) < 200))) continue;
      ramp = { s, x: r1(Q.x), z: r1(Q.z), heading: Math.round(Math.atan2(Q.dz, Q.dx) * 1000) / 1000 };
      break;
    }
    if (!ramp) continue;
    pointAt(city, S, g, P);
    P.s = g;
    const run = ramp.s - g;
    const ev = push('jump', P, { limit: JUMP_LIMIT, tx: ramp.x, tz: ramp.z, run: Math.round(run) });
    ev.ramp = makeSpot('stunt_' + ev.id.slice(3), ev.street + ' Kicker', ramp.x, ramp.z, ramp.heading, RAMP_LAND, false);
    ev.ramp.event = ev.id;
    ev.targets = jumpTargets(run, ev.ramp.angle, ev.ramp.height);
  }

  // --- 4. Rush drops: a timed run to a point 380 to 760 m of street blocks away. ---
  {
    const rng = createRng((seed ^ hashOf(slug + ':drop')) >>> 0);
    const ends = city.edges.filter((e) => usable(e) && e.length >= 50);
    for (const c of order('dash', (e) => e.length >= 60)) {
      if ((counts.dash || 0) >= QUOTA.dash) break;
      if (walk(city, c.e, c.from, 200, S) < 80) continue;
      const g = gateOn();
      if (g < 0 || !free(P.x, P.z, 'dash')) continue;
      let drop = null;
      for (let tries = 0; tries < 40 && !drop; tries++) {
        const e = ends[Math.floor(rng.next() * ends.length)];
        const a = city.nodes[e.a], o = e.off || 0;
        const x = a.x + e.ux * e.length / 2 - e.uz * o, z = a.z + e.uz * e.length / 2 + e.ux * o;
        const m = Math.abs(x - P.x) + Math.abs(z - P.z);
        if (m < DASH_RANGE[0] || m > DASH_RANGE[1] || !inside(x, z, 100) || !land(x, z) || e.name === c.e.name) continue;
        // ahead of the gate, so the run does not open with a U-turn
        if ((x - P.x) * P.dx + (z - P.z) * P.dz < 60) continue;
        drop = { x: r1(x), z: r1(z), m, to: shortStreet(e.name) };
      }
      if (!drop) continue;
      const targets = dashTargets(drop.m);
      push('dash', P, { limit: dashLimit(targets), targets, tx: drop.x, tz: drop.z, run: Math.round(drop.m), to: drop.to, name: 'Rush drop to ' + drop.to });
    }
  }

  // --- 5. Heat escapes: the gate sets the stars (the first is one star, then two, two, three). ---
  for (const c of nearFirst(order('heat', (e) => e.length >= 60))) {
    if ((counts.heat || 0) >= QUOTA.heat) break;
    if (walk(city, c.e, c.from, 200, S) < 80) continue;
    const g = gateOn();
    if (g < 0 || !free(P.x, P.z, 'heat')) continue;
    const level = [1, 2, 3][(counts.heat || 0) % 3];
    push('heat', P, { limit: HEAT_LIMIT, targets: heatTargets(level), level });
  }

  // --- 6. Wrecking sprees: streets with sidewalks, where the props stand. ---
  for (const c of order('wreck', (e) => (e.sidewalk || 0) > 0 && e.length >= 60)) {
    if ((counts.wreck || 0) >= QUOTA.wreck) break;
    if (walk(city, c.e, c.from, 300, S) < 120) continue;
    const g = gateOn();
    if (g < 0 || !free(P.x, P.z, 'wreck')) continue;
    const dense = MAIN[c.e.cls] ? 1 : 0.85;
    push('wreck', P, { limit: WRECK_LIMIT, targets: wreckTargets(WRECK_LIMIT, dense), busy: dense });
  }
  return out;
}

// The ramps of the jump events (systems add them to the city's ramps
// before the stunt system is built).
export const eventRamps = (events) => events.filter((e) => e.ramp).map((e) => e.ramp);

// The nearest event of a template (or any) to a point; null when none.
export function nearestEvent(events, x, z, tpl = null, skip = null) {
  let best = null, bd = Infinity;
  for (let i = 0; i < events.length; i++) {
    const e = events[i];
    if ((tpl && e.tpl !== tpl) || e === skip) continue;
    const d = (e.x - x) * (e.x - x) + (e.z - z) * (e.z - z);
    if (d < bd) { bd = d; best = e; }
  }
  return best;
}
