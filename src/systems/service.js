// Service vehicles at work (docs/REVAMP.md 6.11, V1): the one working
// extra of each service vehicle, the amber beacons, the parked service
// vehicles at their homes, and the HUD state of the EXTRA button.
//
//   fire truck  `cannon` hold: a water jet that knocks people down (no
//               damage, no blood, they get up and flee) and puts out
//               burning hulls and burning cars.
//   ambulance   `treat`  tap: revives a body lying close by; in hard mode
//               heals the player (and seated regen); in normal mode, with
//               nobody to treat, refills the boost meter.
//   garbage     `lift`   tap: lifts and empties a kerb bin into the hopper;
//               with no bin in reach the crusher takes small wreck parts.
//   tow truck   `hook`   tap: hooks the car behind and tows it as a one-axle
//               trailer (pure kinematics); tap again to drop it.
//
// The rule core is pure logic (no three.js, no DOM): the system works on
// a bare `game` with vehicles, actors and events (test/service.test.js).
// The look (lights, water jet, bin on the arm) is in render(), guarded by
// game.scene. Fixed steps only; randomness through createRng; nothing
// allocated per step once warmed up. AI drivers never use an extra.
//
// Events: 'extra' { kind, on, x, z } (sound), 'hullBurn' { craft, id, on:
// false, x, z } when a hull is put out, 'burning' { craft, on: false },
// 'down' { target, source: null, kind: 'water' } for a person knocked
// over by the jet (no blood: they are not hurt), 'revived' { target, x, z }
// (combatfx clears the blood pool), 'siren' { craft, on, kind } when a
// siren is switched off here (wreck, leaving an on-call vehicle).
import { createRng, angleDiff, clamp } from '../core/rng.js';
import {
  EXTRAS, SERVICE_SPOTS, SPOT_RULES, BEACON_HOLD, specSiren, specBeacon,
} from '../entities/servicevehicles.js';
import { createVehicle, VEHICLE_SPECS } from '../entities/vehicle.js';
import { dressLot } from '../world/lots.js';
import { resetActor } from './combat.js';
import { scarePed } from './peds.js';
import { attachServiceLook } from '../render/servicebody.js';

const C = EXTRAS.cannon, T = EXTRAS.treat, L = EXTRAS.lift, H = EXTRAS.hook;
const PARK_SPAWN_R = 135, PARK_DESPAWN_R = 185, PARK_MIN_R = 60;
const SOAK_MAX = 16;
const DOWN_HOLD = 0.5; // lifeT kept under combat's DOWN_T while soaked
const GETUP_T = 0.6;

// ---------------------------------------------------------------------
// Per-vehicle state, made once per vehicle on first use.
export function svcState(v) {
  if (v.svc) return v.svc;
  v.svc = {
    tank: C.tank, dry: false, spray: false, jetYaw: 0, jetLen: 0, aimX: 0, aimZ: 0,
    treat: 0, treatBody: null, treatHeal: false, healFrom: 0, cool: 0,
    lift: 0, liftMode: 0, binX: 0, binZ: 0, binKey: '', load: 0, yardT: 0, crushN: 0,
    crush: [-1, -1, -1], crushGen: [0, 0, 0],
    tapCool: 0, hook: null, hooking: null, hookT: 0, nearSign: 1, u0: 0, towYardT: 0,
    beaconT: 0, beacon: false,
  };
  return v.svc;
}

// Is the vehicle's extra usable now (player at the wheel, not wrecked)?
export const extraLive = (v) => !!(v && v.kind === 'car' && v.spec && v.spec.extra && v.driver === 'player' && !v.wrecked && !v.removed);

const fwdSpeed = (v) => v.vx * Math.cos(v.heading) + v.vz * Math.sin(v.heading);

// ---------------------------------------------------------------------
// Parking rules (6.11): one spot against the built city. Returns
// { ok, why, heading, road } in `out`. heading null picks the best
// heading (nose out toward the road, else along it). `cache` (Map) keeps
// dressed lots between calls. Pure; used by the test and the planner.
function featuresOf(city, lot, cache) {
  let f = cache && cache.get(lot.id);
  if (!f) {
    f = dressLot(city, lot, []).filter((q) => q.solid);
    if (cache) cache.set(lot.id, f);
  }
  return f;
}
function hitsSolid(city, x, z, cache, m = 0.3) {
  const lot = city.lotAt ? city.lotAt(x, z) : null;
  if (!lot) return false;
  const fs = featuresOf(city, lot, cache);
  for (let i = 0; i < fs.length; i++) {
    const f = fs[i];
    const dx = x - f.x, dz = z - f.z;
    if (f.r > 0) { if (dx * dx + dz * dz < (f.r + m) * (f.r + m)) return true; continue; }
    const c = Math.cos(f.heading), s = Math.sin(f.heading);
    const a = dx * c + dz * s, b = -dx * s + dz * c;
    if (Math.abs(a) < f.l / 2 + m && Math.abs(b) < f.w / 2 + m) return true;
  }
  return false;
}
const inGarage = (city, x, z, m) => !!(city.garages && city.garages.some((g) => x > g.x0 - m && x < g.x1 + m && z > g.z0 - m && z < g.z1 + m));
// Nearest road surface: distance from (x, z) to the carriageway edge of
// the nearest edge, the point on its centre line, the edge.
const EDGES = [];
export function nearestRoad(city, x, z, r = 60) {
  let best = null, bd = Infinity, px = 0, pz = 0;
  const ids = city.edgesNear ? city.edgesNear(x, z, r, EDGES) : null;
  const n = ids ? ids.length : city.edges.length;
  for (let k = 0; k < n; k++) {
    const e = city.edges[ids ? ids[k] : k];
    const a = city.nodes[e.a], b = city.nodes[e.b];
    const ux = (b.x - a.x) / e.length, uz = (b.z - a.z) / e.length;
    const t = clamp((x - a.x) * ux + (z - a.z) * uz, 0, e.length);
    const qx = a.x + ux * t, qz = a.z + uz * t;
    const d = Math.hypot(x - qx, z - qz) - e.width / 2;
    if (d < bd) { bd = d; best = e; px = qx; pz = qz; }
  }
  return best ? { edge: best, dist: bd, x: px, z: pz } : null;
}
function boxClear(city, x, z, h, len, wid, cache, why) {
  const c = Math.cos(h), s = Math.sin(h);
  const G = city.lotGrid;
  let lotId = -2;
  for (let a = -len / 2; a <= len / 2 + 1e-6; a += 1) {
    for (let b = -wid / 2; b <= wid / 2 + 1e-6; b += 1) {
      const px = x + a * c - b * s, pz = z + a * s + b * c;
      const lot = G ? city.lotAt(px, pz) : null;
      if (!lot) { why.v = 'box off the lot'; return false; }
      if (lotId === -2) lotId = lot.id;
      if (lot.type === 'beach') { why.v = 'beach'; return false; }
      if (inGarage(city, px, pz, 1)) { why.v = 'garage'; return false; }
      if (hitsSolid(city, px, pz, cache)) { why.v = 'solid feature'; return false; }
    }
  }
  return true;
}
// A way out of `way` m wide from the spot to the road surface.
function wayOut(city, x, z, road, way, cache) {
  const dx = road.x - x, dz = road.z - z;
  const d = Math.hypot(dx, dz) || 1;
  const ux = dx / d, uz = dz / d;
  const end = d - road.edge.width / 2;
  for (let t = 0; t <= end; t += 1) {
    for (let b = -way / 2; b <= way / 2 + 1e-6; b += 1) {
      const px = x + ux * t - uz * b, pz = z + uz * t + ux * b;
      if (city.isLand && !city.isLand(px, pz)) return false;
      if (city.inBuilding && city.inBuilding(px, pz)) return false;
      if (hitsSolid(city, px, pz, cache)) return false;
      if (inGarage(city, px, pz, 0.5)) return false;
    }
  }
  return true;
}
export function checkSpot(city, spot, spec, cache = null, out = {}) {
  out.ok = false;
  out.why = '';
  out.heading = spot.heading;
  out.road = Infinity;
  out.street = '';
  const road = nearestRoad(city, spot.x, spot.z);
  if (!road) { out.why = 'no road'; return out; }
  out.road = road.dist;
  out.street = road.edge.name || '';
  if (road.dist > SPOT_RULES.roadNear) { out.why = 'road too far'; return out; }
  const len = spec.length + 2, wid = spec.width + 1.5;
  const way = spec.id === 'firetruck' || spec.id === 'garbage' ? SPOT_RULES.wayWide : SPOT_RULES.way;
  const why = { v: '' };
  const toRoad = Math.atan2(road.z - spot.z, road.x - spot.x);
  const along = Math.atan2(road.edge.uz, road.edge.ux);
  const tries = spot.heading == null ? [toRoad, along, along + Math.PI] : [spot.heading];
  for (const h of tries) {
    if (!boxClear(city, spot.x, spot.z, h, len, wid, cache, why)) continue;
    if (!wayOut(city, spot.x, spot.z, road, way, cache)) { why.v = 'no way out'; continue; }
    out.ok = true;
    out.heading = h;
    return out;
  }
  out.why = why.v || 'blocked';
  return out;
}

// Road distance (m) from (x0, z0) to every node: Dijkstra from the nodes
// near the start. Returns a Float64Array by node id (tests and tools).
export function roadDistances(city, x0, z0) {
  const N = city.nodes.length;
  const dist = new Float64Array(N).fill(Infinity);
  const road = nearestRoad(city, x0, z0, 80);
  if (!road) return dist;
  const e = road.edge;
  const a = city.nodes[e.a], b = city.nodes[e.b];
  dist[e.a] = Math.hypot(road.x - a.x, road.z - a.z);
  dist[e.b] = Math.hypot(road.x - b.x, road.z - b.z);
  const open = [e.a, e.b];
  const done = new Uint8Array(N);
  while (open.length) {
    let bi = 0;
    for (let i = 1; i < open.length; i++) if (dist[open[i]] < dist[open[bi]]) bi = i;
    const u = open[bi];
    open[bi] = open[open.length - 1];
    open.pop();
    if (done[u]) continue;
    done[u] = 1;
    const n = city.nodes[u];
    for (const id of n.edges) {
      const ed = city.edges[id];
      const w = ed.a === u ? ed.b : ed.a;
      const nd = dist[u] + ed.length;
      if (nd < dist[w]) { dist[w] = nd; open.push(w); }
    }
  }
  return dist;
}

// The island (no lots, no hand list): one of each kind, seeded, on the
// largest open car parks (rows of lot bays), 400 m apart.
export function planIslandSpots(city, seed = 6011) {
  const groups = new Map();
  for (const s of city.parkingSpots || []) {
    if (!s.lot) continue;
    const alongX = Math.abs(Math.cos(s.heading)) > 0.5;
    const key = alongX ? 'z' + Math.round(s.z) : 'x' + Math.round(s.x);
    let g = groups.get(key);
    if (!g) groups.set(key, (g = { alongX, list: [] }));
    g.list.push(s);
  }
  const lots = [...groups.values()].filter((g) => g.list.length >= 3).sort((a, b) => b.list.length - a.list.length || a.list[0].x - b.list[0].x);
  const rng = createRng(seed);
  const kinds = ['firetruck', 'ambulance', 'garbage', 'towtruck'];
  const out = [];
  for (const g of lots) {
    if (out.length >= kinds.length) break;
    let sx = 0, sz = 0;
    for (const s of g.list) { sx += s.x; sz += s.z; }
    const x = sx / g.list.length, z = sz / g.list.length;
    if (out.some((o) => Math.hypot(o.x - x, o.z - z) < SPOT_RULES.apart)) continue;
    const heading = (g.alongX ? 0 : Math.PI / 2) + (rng.next() < 0.5 ? 0 : Math.PI);
    out.push({ kind: kinds[out.length], x, z, heading, name: 'Car park' });
  }
  return out;
}

// ---------------------------------------------------------------------
export function createService(game, { seed = 6110, spots: givenSpots = null } = {}) {
  const rng = createRng(seed);
  const city = game.city || null;
  const EV = { kind: '', on: false, x: 0, z: 0 };
  const DOWN = { target: null, source: null, kind: 'water' };
  const HB = { craft: null, id: -1, on: false, x: 0, z: 0 };
  const BURN = { craft: null, on: false };
  const REV = { target: null, x: 0, z: 0 };
  const SIREN = { craft: null, on: false, kind: '' };
  const HUD = { can: false, text: 'EXTRA', fill: -1, weak: false };
  const soaked = []; // people knocked over by the jet (fixed cap)
  const emptied = new Map(); // bin key -> game time it can be lifted again
  const tipped = []; // { x, z, h, t } bins dropped on their side (render)
  const lotCache = new Map();
  let lastPv = null;
  const stats = { firesOut: 0, knocked: 0, revived: 0, bins: 0, dumps: 0, crushed: 0, towed: 0 };

  const emit = (name, p) => { if (game.events && game.events.emit) game.events.emit(name, p); };
  const toast = (text, s = 1.6) => { if (game.hud && game.hud.toast) game.hud.toast(text, s, 'info'); };
  const score = (pts, why, x, z) => { if (game.score && game.score.add) game.score.add(pts, why, x, z); };
  const mortal = () => !!(game.progress && game.progress.settings && game.progress.settings.mortal === true);
  const extraEv = (kind, on, v) => {
    EV.kind = kind;
    EV.on = on;
    EV.x = v.x;
    EV.z = v.z;
    emit('extra', EV);
  };
  function sirenOff(v) {
    if (!v.siren) return;
    v.siren = false;
    v.onCall = false;
    SIREN.craft = v;
    SIREN.on = false;
    SIREN.kind = v.spec ? v.spec.id : '';
    emit('siren', SIREN);
    SIREN.craft = null;
  }
  function addStars(n, why) {
    const heat = game.police && game.police.heat;
    if (!heat) return;
    const want = Math.min(4, (heat.level | 0) + n);
    if (want > heat.level) {
      heat.level = want;
      heat.unseen = 0;
      heat.cooldown = 0;
      heat.calm = 0;
      if (why) toast(why, 2);
    }
  }

  // --- Street bins (city.furniture) and lot bins (dressLot), searched on a tap.
  const streetBins = [];
  if (city && Array.isArray(city.furniture)) for (const f of city.furniture) if (f.type === 'bin') streetBins.push(f);
  const BIN = { x: 0, z: 0, key: '', d: Infinity };
  const LOTS_SEEN = [];
  function findBin(v, r) {
    BIN.d = Infinity;
    BIN.key = '';
    const t = game.time || 0;
    const r2 = r * r;
    const consider = (x, z) => {
      const dx = x - v.x, dz = z - v.z, d2 = dx * dx + dz * dz;
      if (d2 > r2 || d2 >= BIN.d) return;
      const key = Math.round(x * 10) + ':' + Math.round(z * 10);
      const until = emptied.get(key);
      if (until !== undefined && until > t) return;
      BIN.d = d2;
      BIN.x = x;
      BIN.z = z;
      BIN.key = key;
    };
    for (let i = 0; i < streetBins.length; i++) {
      const f = streetBins[i];
      if (Math.abs(f.x - v.x) < r && Math.abs(f.z - v.z) < r) consider(f.x, f.z);
    }
    if (city && city.lotAt && game.bins !== false) {
      LOTS_SEEN.length = 0;
      for (let i = -2; i <= 2; i++) {
        for (let j = -2; j <= 2; j++) {
          const lot = city.lotAt(v.x + i * 3, v.z + j * 3);
          if (lot && LOTS_SEEN.indexOf(lot) < 0) LOTS_SEEN.push(lot);
        }
      }
      for (const lot of LOTS_SEEN) {
        let fs = lotCache.get('b' + lot.id);
        if (!fs) lotCache.set('b' + lot.id, (fs = dressLot(city, lot, []).filter((f) => f.kind === 'bin')));
        for (const f of fs) consider(f.x, f.z);
      }
    }
    // Bins handed in by a test or a tool (game.extraBins: [{ x, z }]).
    if (game.extraBins) for (const b of game.extraBins) consider(b.x, b.z);
    return BIN.d < Infinity ? BIN : null;
  }

  // --- Places where a load or a towed car is handed in.
  const spots = givenSpots || (city && city.lots && city.lots.length ? SERVICE_SPOTS : city && city.parkingSpots ? planIslandSpots(city) : []);
  const yardOf = (kind) => spots.filter((s) => s.kind === kind && s.yard);
  const garbageYards = yardOf('garbage'), towYards = yardOf('towtruck');
  function inYard(list, v) {
    const lot = city && city.lotAt ? city.lotAt(v.x, v.z) : null;
    for (let i = 0; i < list.length; i++) {
      const s = list[i];
      if (lot && city.lotAt(s.x, s.z) === lot) return true;
      if (Math.hypot(s.x - v.x, s.z - v.z) < 15) return true;
    }
    if (game.extraYards) for (const y of game.extraYards) if (Math.hypot(y.x - v.x, y.z - v.z) < (y.r || 15)) return true;
    return false;
  }
  const inTowYard = (v) => inYard(towYards, v) || (city && city.garages ? inGarage(city, v.x, v.z, 2) : false);

  // =====================================================================
  // Fire truck: the water cannon.
  function cannonTarget(v, s) {
    const ch = Math.cos(v.heading), sh = Math.sin(v.heading);
    const ox = v.x + ch * v.spec.length * 0.15, oz = v.z + sh * v.spec.length * 0.15;
    let best = null, bestRank = 9, bestD = Infinity;
    const look = (o, rank) => {
      const dx = o.x - ox, dz = o.z - oz, d = Math.hypot(dx, dz);
      if (d > C.range || d < 0.5) return;
      const off = Math.abs(angleDiff(Math.atan2(dz, dx), v.heading));
      if (off > C.cone) return;
      if (rank < bestRank || (rank === bestRank && d < bestD)) { best = o; bestRank = rank; bestD = d; }
    };
    const hulls = game.combat && game.combat.hulls;
    if (hulls) for (let i = 0; i < hulls.length; i++) { const c = hulls[i]; if (c && c.wrecked && c.hullFlame && !c.doused && !c.removed) look(c, 0); }
    const vs = game.vehicles || [];
    for (let i = 0; i < vs.length; i++) { const c = vs[i]; if (c && c !== v && c.burning && !c.wrecked && !c.removed) look(c, 1); }
    const as = game.actors || [];
    for (let i = 0; i < as.length; i++) { const a = as[i]; if (a && a.team !== 'player' && a.life === 'ok' && !a.wetT) look(a, 2); }
    s.aimX = ox;
    s.aimZ = oz;
    return best;
  }
  function soak(a, dx, dz) {
    if (soaked.length >= SOAK_MAX) return;
    a.life = 'down';
    a.lifeT = 0;
    if (a.vx !== undefined) a.vx = a.vz = 0;
    a.wetT = C.downT;
    a.wetUp = 0;
    a.wetVx = dx * C.push;
    a.wetVz = dz * C.push;
    soaked.push(a);
    stats.knocked++;
    DOWN.target = a;
    emit('down', DOWN);
    DOWN.target = null;
    if (a.team === 'police') addStars(1, 'Officer down! The police want a word');
  }
  function douse(c, s, dt, v) {
    c.douseT = (c.douseT || 0) + dt;
    if (c.douseT < C.hullT) return;
    c.doused = true;
    c.dousedAt = game.time || 0;
    c.dousedWreck = c.wreckT || 0; // combatfx: steam for 4 s from here
    stats.firesOut++;
    if (c.wrecked) {
      if (c.hullFlame) {
        c.hullFlame = false;
        HB.craft = c;
        HB.id = c.id === undefined ? -1 : c.id;
        HB.on = false;
        HB.x = c.x;
        HB.z = c.z;
        emit('hullBurn', HB);
        HB.craft = null;
      }
    } else {
      c.burning = false;
      c.onFire = false;
      c.burnT = 0;
      BURN.craft = c;
      BURN.on = false;
      emit('burning', BURN);
      BURN.craft = null;
    }
    score(C.score, 'Fire out', c.x, c.z);
    void s;
    void v;
  }
  function stepCannon(v, s, hold, dt) {
    const canStart = s.tank > 0 && !(s.dry && s.tank < C.tank * C.restart);
    const want = hold && (s.spray ? s.tank > 0 : canStart);
    if (want !== s.spray) {
      s.spray = want;
      extraEv('cannon', want, v);
    }
    if (!s.spray) {
      s.jetLen = 0;
      return;
    }
    s.tank -= dt;
    if (s.tank <= 1e-9) {
      s.tank = 0;
      s.dry = true;
      s.spray = false;
      extraEv('cannon', false, v);
      toast('Water tank empty', 1.4);
    }
    // Aim: turn toward the best target in the cone, else back to the nose.
    const tgt = cannonTarget(v, s);
    const want2 = tgt ? clamp(angleDiff(Math.atan2(tgt.z - s.aimZ, tgt.x - s.aimX), v.heading), -C.cone, C.cone) : 0;
    const step = C.turn * dt;
    const d = angleDiff(want2, s.jetYaw);
    s.jetYaw += d > step ? step : d < -step ? -step : d;
    const a = v.heading + s.jetYaw;
    const dx = Math.cos(a), dz = Math.sin(a);
    s.jetLen = Math.min(C.range, s.jetLen + 60 * dt);
    const ox = s.aimX, oz = s.aimZ, len = s.jetLen;
    // People in the jet.
    const as = game.actors || [];
    for (let i = 0; i < as.length; i++) {
      const p = as[i];
      if (!p || p.team === 'player' || p.life !== 'ok' || p.wetT) continue;
      const qx = p.x - ox, qz = p.z - oz, al = qx * dx + qz * dz;
      if (al < 0 || al > len) continue;
      if (Math.abs(-qx * dz + qz * dx) <= C.personLine) soak(p, dx, dz);
    }
    // Hulls and burning cars; any other car is pushed.
    const vs = game.vehicles || [];
    const hulls = game.combat && game.combat.hulls;
    const inJet = (c) => {
      const qx = c.x - ox, qz = c.z - oz, al = qx * dx + qz * dz;
      return al >= 0 && al <= len + 1 && Math.abs(-qx * dz + qz * dx) <= C.craftLine;
    };
    if (hulls) {
      for (let i = 0; i < hulls.length; i++) {
        const c = hulls[i];
        if (c && c.wrecked && c.hullFlame && !c.doused && !c.removed && inJet(c)) douse(c, s, dt, v);
      }
    }
    for (let i = 0; i < vs.length; i++) {
      const c = vs[i];
      if (!c || c === v || c.removed || c.kind !== 'car' || !inJet(c)) continue;
      if (c.burning && !c.wrecked && !c.doused) { douse(c, s, dt, v); continue; }
      if (c.wrecked || !(c.spec && c.spec.mass > 0)) continue;
      const k = C.craftForce / c.spec.mass * dt;
      c.vx += dx * k;
      c.vz += dz * k;
      c.asleep = false;
    }
  }
  function stepSoaked(dt) {
    for (let i = soaked.length - 1; i >= 0; i--) {
      const a = soaked[i];
      if (a.removed || a.hp <= 0 || (a.life !== 'down' && a.life !== 'getup' && a.life !== 'ok') || (a.life === 'ok' && a.wetT > 0)) {
        a.wetT = 0;
        soaked.splice(i, 1);
        continue;
      }
      // Slide along the jet, slowing at the knock-back rate.
      const sp = Math.hypot(a.wetVx, a.wetVz);
      if (sp > 0) {
        const k = sp > 6 * dt ? (sp - 6 * dt) / sp : 0;
        a.wetVx *= k;
        a.wetVz *= k;
        let nx = a.x + a.wetVx * dt, nz = a.z + a.wetVz * dt;
        if (game.collision) {
          const r = game.collision.resolveCircle(nx, nz, a.radius || 0.35, 0);
          nx = r.x;
          nz = r.z;
        }
        if (Number.isFinite(nx) && Number.isFinite(nz)) {
          a.x = nx;
          a.z = nz;
        }
      }
      if (a.wetT > 0) {
        a.wetT -= dt;
        a.life = 'down';
        if (a.lifeT > DOWN_HOLD) a.lifeT = DOWN_HOLD;
        if (a.wetT <= 0) {
          a.wetT = 0;
          a.life = 'getup';
          a.lifeT = 0;
          a.wetUp = GETUP_T;
        }
        continue;
      }
      a.wetUp -= dt;
      if (a.wetUp <= 0 || a.life === 'ok') {
        a.life = 'ok';
        a.lifeT = 0;
        if (a.rng && a.panicT !== undefined) scarePed(a, a.x - a.wetVx, a.z - a.wetVz);
        soaked.splice(i, 1);
      }
    }
  }

  // =====================================================================
  // Ambulance: treat.
  function nearestBody(v) {
    const as = game.actors || [];
    let best = null, bd = T.range * T.range;
    for (let i = 0; i < as.length; i++) {
      const a = as[i];
      if (!a || a.life !== 'out' || a.team !== 'civ' || a.fade > 0 || a.removed) continue;
      const dx = a.x - v.x, dz = a.z - v.z, d = dx * dx + dz * dz;
      if (d <= bd) { bd = d; best = a; }
    }
    return best;
  }
  function stepTreat(v, s, tap, dt) {
    const w = game.player && game.player.walker;
    const sp = Math.abs(v.speed || 0);
    if (s.treat > 0) {
      if (sp > T.maxSpeed || (s.treatBody && (s.treatBody.life !== 'out' || s.treatBody.removed))) {
        s.treat = 0;
        s.treatBody = null;
        extraEv('treat', false, v);
        toast('Treatment stopped', 1.2);
        return;
      }
      s.treat += dt;
      if (s.treatHeal && w && typeof w.hp === 'number') {
        const max = w.maxHp || 100;
        w.hp = Math.min(max, s.healFrom + (max - s.healFrom) * Math.min(1, s.treat / T.time));
        if (game.player) game.player.health = w.hp;
      }
      if (s.treat >= T.time - 1e-9) {
        const b = s.treatBody;
        if (b) {
          resetActor(b);
          b.y = 0;
          b.wetT = 0;
          REV.target = b;
          REV.x = b.x;
          REV.z = b.z;
          emit('revived', REV);
          REV.target = null;
          if (b.rng && b.panicT !== undefined) scarePed(b, v.x, v.z, 4);
          score(T.score, 'Revived', b.x, b.z);
          stats.revived++;
        }
        if (s.treatHeal && w) w.hp = w.maxHp || 100;
        s.treat = 0;
        s.treatBody = null;
        s.treatHeal = false;
        s.cool = T.cooldown;
        extraEv('treat', false, v);
      }
      return;
    }
    if (!tap) return;
    if (s.cool > 0) { toast('Kit restocking', 1); return; }
    if (sp >= T.maxSpeed) { toast('Stop to treat', 1.2); return; }
    const body = nearestBody(v);
    const hurt = mortal() && w && typeof w.hp === 'number' && w.hp < (w.maxHp || 100);
    if (body || hurt) {
      s.treat = 1e-6;
      s.treatBody = body;
      s.treatHeal = !!hurt;
      s.healFrom = hurt ? w.hp : 0;
      extraEv('treat', true, v);
      return;
    }
    if (!mortal() && v.boostMeter < 1) {
      v.boostMeter = 1;
      v.boostLock = false;
      s.cool = T.cooldown;
      extraEv('treat', true, v);
      extraEv('treat', false, v);
      toast('Boost refilled', 1.2);
      return;
    }
    toast('Nobody to treat', 1.2);
  }

  // =====================================================================
  // Garbage truck: the bin lift and the crusher.
  const CYCLE = L.raise + L.tip + L.lower;
  function stepLift(v, s, tap, dt) {
    const sp = Math.abs(v.speed || 0);
    if (s.lift > 0) {
      if (sp > L.maxSpeed) {
        if (s.liftMode === 1) {
          tipped.push({ x: s.binX, z: s.binZ, h: v.heading, t: game.time || 0 });
          if (tipped.length > 6) tipped.shift();
          toast('Bin dropped', 1.2);
        }
        s.lift = 0;
        s.liftMode = 0;
        extraEv('lift', false, v);
        return;
      }
      s.lift += dt;
      const end = s.liftMode === 1 ? CYCLE : L.crushTime;
      if (s.lift >= end - 1e-9) {
        if (s.liftMode === 1) {
          emptied.set(s.binKey, (game.time || 0) + L.binLock);
          s.load++;
          stats.bins++;
          score(L.score, 'Bin emptied', s.binX, s.binZ);
        } else {
          const P = game.combatFx && game.combatFx.parts;
          let n = 0;
          for (let k = 0; k < s.crushN; k++) {
            const i = s.crush[k];
            if (P && i >= 0 && P.age[i] >= 0 && P.gen[i] === s.crushGen[k]) {
              P.age[i] = -1;
              n++;
            }
          }
          if (n) {
            stats.crushed += n;
            score(L.crushScore * n, n > 1 ? `Crushed ${n} parts` : 'Crushed a part', v.x, v.z);
          }
        }
        s.lift = 0;
        s.liftMode = 0;
        extraEv('lift', false, v);
      }
      return;
    }
    // A full hopper is emptied by stopping in the yard for 2 s.
    if (s.load > 0 && sp < 0.5 && inYard(garbageYards, v)) {
      s.yardT += dt;
      if (s.yardT >= L.yardStop) {
        score(L.yardScore, 'Load dumped', v.x, v.z);
        stats.dumps++;
        s.load = 0;
        s.yardT = 0;
        toast('Hopper emptied', 1.4);
      }
    } else s.yardT = 0;
    if (!tap) return;
    if (sp >= L.maxSpeed) { toast('Stop to lift', 1.2); return; }
    const bin = findBin(v, L.range);
    if (bin) {
      if (s.load >= L.cap) { toast('Full', 1.2); return; }
      s.lift = 1e-6;
      s.liftMode = 1;
      s.binX = bin.x;
      s.binZ = bin.z;
      s.binKey = bin.key;
      extraEv('lift', true, v);
      return;
    }
    // No bin: the crusher takes up to three lying wreck parts.
    const P = game.combatFx && game.combatFx.parts;
    s.crushN = 0;
    if (P) {
      const r2 = L.crushRange * L.crushRange;
      for (let i = 0; i < P.max && s.crushN < L.crushMax; i++) {
        if (!(P.age[i] >= 0) || P.hits[i] < 2) continue;
        const dx = P.x[i] - v.x, dz = P.z[i] - v.z;
        if (dx * dx + dz * dz > r2) continue;
        s.crush[s.crushN] = i;
        s.crushGen[s.crushN] = P.gen[i];
        s.crushN++;
      }
    }
    if (s.crushN) {
      s.lift = 1e-6;
      s.liftMode = 2;
      extraEv('lift', true, v);
      return;
    }
    toast('Nothing to lift', 1.2);
  }

  // =====================================================================
  // Tow truck: the hook.
  const hookable = (c, v) => c && c !== v && c.kind === 'car' && !c.removed && c.spec && !c.spec.service
    && c.spec.mass <= H.maxMass && !c.towedBy && c !== (game.player && game.player.vehicle)
    && (c.wrecked || (c.driver !== 'player' && !(c.ai && c.cop)));
  function findTow(v) {
    const ch = Math.cos(v.heading), sh = Math.sin(v.heading);
    const rx = v.x - ch * v.spec.length / 2, rz = v.z - sh * v.spec.length / 2;
    const vs = game.vehicles || [];
    let best = null, bd = H.range;
    for (let i = 0; i < vs.length; i++) {
      const c = vs[i];
      if (!hookable(c, v)) continue;
      const dx = c.x - rx, dz = c.z - rz, d = Math.hypot(dx, dz);
      if (d > bd) continue;
      // Within 30 degrees of the truck's axis, behind it.
      const back = -(dx * ch + dz * sh);
      if (!(back > 0) || Math.acos(Math.min(1, back / Math.max(1e-6, d))) > H.cone) continue;
      best = c;
      bd = d;
    }
    return best;
  }
  // Pin the towed car's near end to the hitch; its far axle trails.
  // towLine() works out the new line (hitch, unit u from the far axle to
  // the hitch) and returns the hitch angle; placeTowed() moves the car.
  const TL = { hx: 0, hz: 0, ux: 1, uz: 0 };
  function towLine(v, s, c) {
    const ch = Math.cos(v.heading), sh = Math.sin(v.heading);
    TL.hx = v.x - ch * (v.spec.length / 2 + H.hitch);
    TL.hz = v.z - sh * (v.spec.length / 2 + H.hitch);
    const wb = c.spec.wheelBase || c.spec.length * 0.6;
    // The far axle where the car is now (centre minus half the wheelbase
    // toward its far end).
    const ax = c.x - Math.cos(c.heading) * s.nearSign * (wb / 2), az = c.z - Math.sin(c.heading) * s.nearSign * (wb / 2);
    let ux = TL.hx - ax, uz = TL.hz - az;
    const ul = Math.hypot(ux, uz) || 1;
    TL.ux = ux / ul;
    TL.uz = uz / ul;
    return Math.abs(angleDiff(Math.atan2(TL.uz, TL.ux), v.heading));
  }
  function placeTowed(s, c) {
    const cl = c.spec.length;
    const nx = TL.hx - TL.ux * (cl / 2), nz = TL.hz - TL.uz * (cl / 2);
    c.px = c.x;
    c.pz = c.z;
    c.pheading = c.heading;
    const nh = Math.atan2(TL.uz * s.nearSign, TL.ux * s.nearSign);
    const vx = (nx - c.x) / s.dt, vz = (nz - c.z) / s.dt;
    c.yawRate = angleDiff(nh, c.heading) / s.dt;
    c.x = nx;
    c.z = nz;
    c.heading = nh;
    c.vx = vx;
    c.vz = vz;
    c.speed = vx * Math.cos(nh) + vz * Math.sin(nh);
    if (!c.wrecked) c.y = H.lift * 0.5;
    c.pitch = 0;
    c.asleep = true;
    c.meshDirty = true;
  }
  function release(v, s, why) {
    const c = s.hook;
    s.hook = null;
    s.hooking = null;
    s.hookT = 0;
    if (c) {
      c.towedBy = null;
      c.towed = false;
      if (!c.wrecked) c.y = 0;
      c.asleep = false; // keeps its speed and heading
      c.meshDirty = true;
    }
    extraEv('hook', false, v);
    if (why) toast(why, 1.2);
  }
  function stepHook(v, s, tap, dt) {
    s.dt = dt;
    if (s.tapCool > 0) s.tapCool -= dt;
    const sp = Math.abs(v.speed || 0);
    if (s.hooking) {
      const c = s.hooking;
      if (!hookable(c, v) || sp > H.maxSpeed || Math.abs(c.speed || 0) > H.targetSpeed) {
        s.hooking = null;
        s.hookT = 0;
        extraEv('hook', false, v);
      } else {
        s.hookT += dt;
        if (s.hookT >= H.attachT - 1e-9) {
          s.hook = c;
          s.hooking = null;
          c.towedBy = v;
          c.towed = true;
          // Which end is nearer the hitch.
          const ch = Math.cos(v.heading), sh = Math.sin(v.heading);
          const hx = v.x - ch * (v.spec.length / 2 + H.hitch), hz = v.z - sh * (v.spec.length / 2 + H.hitch);
          const fx = c.x + Math.cos(c.heading) * c.spec.length / 2, fz = c.z + Math.sin(c.heading) * c.spec.length / 2;
          const bx = c.x - Math.cos(c.heading) * c.spec.length / 2, bz = c.z - Math.sin(c.heading) * c.spec.length / 2;
          s.nearSign = Math.hypot(fx - hx, fz - hz) <= Math.hypot(bx - hx, bz - hz) ? 1 : -1;
          s.u0 = fwdSpeed(v);
          if (c.spec.police || c.spec.id === 'police') addStars(H.policeStars, 'You hooked a police car!');
          toast(c.wrecked ? 'Hull hooked' : 'Car hooked', 1.2);
        }
      }
    }
    if (tap && s.tapCool <= 0) {
      s.tapCool = H.tapGap;
      if (s.hook || s.hooking) release(v, s, s.hook ? 'Dropped' : null);
      else if (sp >= H.maxSpeed) toast('Stop to hook', 1.2);
      else {
        const c = findTow(v);
        if (!c) toast('Nothing to hook', 1.2);
        else if (Math.abs(c.speed || 0) > H.targetSpeed) toast('It is moving', 1.2);
        else {
          s.hooking = c;
          s.hookT = 1e-6;
          extraEv('hook', true, v);
        }
      }
    }
  }
  // While towing: heavier to speed up and slow down, capped top speed;
  // then the trailer follows. Runs for the truck the player drives (and
  // releases the car if they leave).
  function stepTow(v, s, dt) {
    const c = s.hook;
    if (!c) return;
    if (c.removed || v.wrecked || v.removed || v.driver !== 'player') {
      release(v, s, v.driver !== 'player' ? null : 'Dropped');
      return;
    }
    const k = v.spec.mass / (v.spec.mass + H.massShare * c.spec.mass);
    const kb = Math.max(k, 0.82);
    const ch = Math.cos(v.heading), sh = Math.sin(v.heading);
    const u1 = v.vx * ch + v.vz * sh;
    const du = u1 - s.u0;
    let u = s.u0 + du * (Math.abs(u1) > Math.abs(s.u0) ? k : kb);
    if (u > H.topCap) u = H.topCap;
    if (u < -H.topCap) u = -H.topCap;
    v.vx += (u - u1) * ch;
    v.vz += (u - u1) * sh;
    v.speed = u;
    s.u0 = u;
    s.dt = dt;
    if (towLine(v, s, c) > H.releaseAngle) { release(v, s, 'The hook slipped'); return; }
    placeTowed(s, c);
    // Stopping 2 s in the tow yard (or a garage) hands the car in.
    if (Math.abs(u) < 0.5 && inTowYard(v)) {
      s.towYardT += dt;
      if (s.towYardT >= H.yardStop) {
        s.towYardT = 0;
        s.hook = null;
        c.towedBy = null;
        if (game.removeVehicle) game.removeVehicle(c);
        else c.removed = true;
        stats.towed++;
        score(H.score, 'Towed in', v.x, v.z);
        extraEv('hook', false, v);
      }
    } else s.towYardT = 0;
  }

  // =====================================================================
  // Amber beacons (garbage and tow): on while lifting, towing or reversing
  // and BEACON_HOLD s after.
  function stepBeacon(v, dt) {
    const s = v.svc;
    const busy = (s && (s.lift > 0 || s.hook || s.hooking)) || (v.gear === 0 && (v.speed || 0) < -0.2);
    if (busy) v.beaconT = BEACON_HOLD;
    else if (v.beaconT > 0) v.beaconT = Math.max(0, v.beaconT - dt);
    v.beacon = !!busy || v.beaconT > 0;
  }

  // =====================================================================
  // Parked service vehicles at their homes (6.11 "Where they park").
  const homes = spots.map((s) => ({ s, v: null, back: 0 }));
  // Ordinary parked cars keep off the service homes (src/systems/parked.js
  // fills the kerb and lot bays): their bays near a home are taken.
  const parked = game.systems ? game.systems.find((q) => q && q.name === 'parked') : null;
  if (parked && parked.spots) {
    for (const ps of parked.spots) {
      for (const h of homes) {
        const r = (VEHICLE_SPECS[h.s.kind] ? VEHICLE_SPECS[h.s.kind].length : 5) / 2 + 3.5;
        if (Math.abs(ps.x - h.s.x) < r && Math.abs(ps.z - h.s.z) < r) { ps.used = true; break; }
      }
    }
  }
  let parkTimer = 0, first = true;
  function scanHomes() {
    const p = game.player;
    if (!p) return;
    const t = game.time || 0;
    for (let i = 0; i < homes.length; i++) {
      const h = homes[i];
      const sp = h.s;
      const d = Math.hypot(sp.x - p.x, sp.z - p.z);
      if (h.v) {
        const v = h.v;
        if (v.removed || v.driver || v.wrecked || Math.hypot(v.x - sp.x, v.z - sp.z) > 1.5) {
          v.parked = false;
          v.svcHome = null;
          h.v = null;
          h.back = t + SPOT_RULES.respawn;
        } else if (d > PARK_DESPAWN_R) {
          if (game.removeVehicle) game.removeVehicle(v);
          h.v = null;
        }
        continue;
      }
      if (t < h.back || d > PARK_SPAWN_R) continue;
      if (h.back > 0 && d < SPOT_RULES.respawnFar) continue;
      if (!first && d < PARK_MIN_R) continue;
      if (!game.addVehicle || !VEHICLE_SPECS[sp.kind]) continue;
      const v = createVehicle(sp.kind, sp.x, sp.z, sp.heading, rng);
      v.parked = true;
      v.asleep = true;
      v.svcHome = h;
      h.v = v;
      h.back = 0;
      game.addVehicle(v);
    }
    first = false;
  }

  // =====================================================================
  const NOINPUT = { held: () => false, consume: () => false };
  const sys = {
    name: 'service',
    stats,
    soaked,
    emptied,
    tipped,
    homes,
    spots,
    findBin,
    // HUD face of the EXTRA button for vehicle v (read by tests too).
    hudFor(v, out = HUD) {
      out.can = extraLive(v);
      out.text = 'EXTRA';
      out.fill = -1;
      out.weak = false;
      if (!out.can) return out;
      const s = svcState(v);
      const sp = Math.abs(v.speed || 0);
      const x = v.spec.extra;
      if (x === 'cannon') {
        out.text = C.caption;
        out.fill = s.tank / C.tank;
        out.weak = s.tank <= 0 || (s.dry && s.tank < C.tank * C.restart);
      } else if (x === 'treat') {
        out.text = T.caption;
        out.fill = s.treat > 0 ? s.treat / T.time : s.cool > 0 ? 1 - s.cool / T.cooldown : -1;
        out.weak = s.cool > 0 || sp >= T.maxSpeed;
      } else if (x === 'lift') {
        out.text = L.caption;
        out.fill = s.lift > 0 ? s.lift / (s.liftMode === 1 ? CYCLE : L.crushTime) : s.load / L.cap;
        out.weak = sp >= L.maxSpeed || s.load >= L.cap;
      } else if (x === 'hook') {
        out.text = s.hook || s.hooking ? H.release : H.caption;
        out.fill = s.hooking ? s.hookT / H.attachT : -1;
        out.weak = !(s.hook || s.hooking) && sp >= H.maxSpeed;
      }
      return out;
    },
    // One step of the extra of vehicle v with the given input (tests drive
    // this directly; the system calls it for the player's vehicle).
    stepExtra(v, input, dt) {
      if (!v || !v.spec || !v.spec.extra) return;
      const s = svcState(v);
      const live = extraLive(v);
      const inp = live && input ? input : NOINPUT;
      const x = v.spec.extra;
      if (!live) {
        if (s.spray) { s.spray = false; extraEv('cannon', false, v); }
        if (s.treat > 0) { s.treat = 0; s.treatBody = null; extraEv('treat', false, v); }
        if (s.lift > 0) { s.lift = 0; s.liftMode = 0; extraEv('lift', false, v); }
        if (s.hooking) { s.hooking = null; s.hookT = 0; }
      }
      if (x === 'cannon') stepCannon(v, s, !!(inp.held && inp.held('extra')), dt);
      else {
        const tap = !!(inp.consume && inp.consume('extra'));
        if (x === 'treat') stepTreat(v, s, tap, dt);
        else if (x === 'lift') stepLift(v, s, tap, dt);
        else if (x === 'hook') stepHook(v, s, tap, dt);
      }
    },
    fixedUpdate(dt) {
      const p = game.player;
      const pv = p ? p.vehicle : null;
      // Leaving an emergency vehicle switches its siren off (police.js does
      // it for the ones it switched on; on-call ones are caught here).
      if (lastPv && lastPv !== pv) {
        if (lastPv.siren && specSiren(lastPv.spec) && !lastPv.ai) sirenOff(lastPv);
        if (lastPv.svc && lastPv.svc.hook) release(lastPv, lastPv.svc, null);
      }
      if (pv && pv !== lastPv && pv.onCall) sirenOff(pv);
      lastPv = pv;
      if (pv && pv.wrecked && pv.siren) sirenOff(pv);
      // Timers of every service vehicle that has been used.
      const vs = game.vehicles || [];
      for (let i = 0; i < vs.length; i++) {
        const v = vs[i];
        if (!v || v.kind !== 'car' || !v.spec) continue;
        const s = v.svc;
        if (!s) continue;
        if (s.cool > 0) s.cool = Math.max(0, s.cool - dt);
        if (!s.spray && s.tank < C.tank) {
          s.tank = Math.min(C.tank, s.tank + (C.tank / C.refill) * dt);
          if (s.dry && s.tank >= C.tank * C.restart) s.dry = false;
        }
        if (v !== pv && (s.spray || s.treat > 0 || s.lift > 0 || s.hooking)) sys.stepExtra(v, null, dt);
        if (s.hook) stepTow(v, s, dt);
      }
      if (pv && pv.kind === 'car' && pv.spec && pv.spec.extra) {
        sys.stepExtra(pv, game.input, dt);
        if (pv.svc && pv.svc.hook) pv.svc.u0 = fwdSpeed(pv);
      }
      // Beacons after the extras: a lift or hook started this step counts.
      for (let i = 0; i < vs.length; i++) {
        const v = vs[i];
        if (v && v.kind === 'car' && v.spec && specBeacon(v.spec)) stepBeacon(v, dt);
      }
      // Hard mode: seated in an ambulance the player regains 5 % a second.
      if (pv && pv.spec && pv.spec.extra === 'treat' && !pv.wrecked && mortal()) {
        const w = p.walker;
        if (w && typeof w.hp === 'number' && w.hp < (w.maxHp || 100)) {
          w.hp = Math.min(w.maxHp || 100, w.hp + T.regen * (w.maxHp || 100) * dt);
          p.health = w.hp;
        }
      }
      stepSoaked(dt);
      if (game.touch && game.touch.setExtra) game.touch.setExtra(sys.hudFor(pv));
      parkTimer -= dt;
      if (parkTimer <= 0 && game.addVehicle) {
        parkTimer = 0.5;
        scanHomes();
      }
    },
    render: null, // set by attachServiceLook when there is a scene
  };
  // The look (service bodies, light bars, the water jet, the bin on the
  // arm) only when the game draws (src/render/servicebody.js).
  if (game.scene && game.kinds) attachServiceLook(game, sys);
  return sys;
}

// A short world hash for determinism tests: positions, states, scores.
export function serviceHash(game) {
  let h = 2166136261 >>> 0;
  const mix = (x) => {
    const n = Math.round(x * 1000) | 0;
    h = Math.imul(h ^ n, 16777619) >>> 0;
  };
  for (const v of game.vehicles || []) {
    mix(v.x); mix(v.z); mix(v.heading); mix(v.speed || 0);
    if (v.svc) { mix(v.svc.tank); mix(v.svc.jetYaw); mix(v.svc.load); mix(v.svc.treat); }
  }
  for (const a of game.actors || []) { mix(a.x); mix(a.z); mix(a.life === 'ok' ? 1 : a.life === 'down' ? 2 : a.life === 'getup' ? 3 : 4); }
  return h;
}
