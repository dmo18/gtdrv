// Survival measure (docs/PLAN_V4.md task 4): a clumsy player for 10 sim
// minutes in a region, in the default "cannot die" mode and in Hard, with
// the game's own traffic, people, parked cars, police and combat stepping
// round them in game.js order. Counts what kills or wrecks the player.
//
// Drive: the player's car follows the streets (a traffic driver's route,
// with no braking for anything in the way), 1.3 times the lane speed, a
// slow thumb on the wheel (0.18 s late, steps of 0.08, noise), a swerve to
// one side every 15 to 30 s (curbs, parked cars, people on the sidewalk),
// and one 60 mph run straight on at minute 5 until it hits something.
// Walk: the player on foot crossing streets and sprinting along the
// sidewalks for 10 minutes, now and then into a parked car.
//
//   node scripts/survival.mjs [--region miami-beach] [--minutes 10] [--json out.json]
//
// Pure logic, seeded, fixed 1/60 s steps; no three.js, no DOM.
import fs from 'node:fs';
import { buildWorld } from './collision-sweep.mjs';
import { createRng } from '../src/core/rng.js';
import { createEvents } from '../src/core/events.js';
import { RULES, createArms } from '../src/core/weapons.js';
import { createVehicle, stepVehicle, collideVehicles, CRASH_MIN, getDamageRule, setDamageRule } from '../src/entities/vehicle.js';
import { createWalker, stepWalker } from '../src/entities/onfoot.js';
import { createCombat } from '../src/systems/combat.js';
import { createTraffic, createDriver, placeDriver, driveStep } from '../src/systems/traffic.js';
import { createPeds } from '../src/systems/peds.js';
import { createParkedCars } from '../src/systems/parked.js';
import { createPolice } from '../src/systems/police.js';

export const DT = 1 / 60;
const MPH = 2.23694;

// A game object with the systems that meet the player on the street.
export function makeGame(W, { seed = 1, hard = false } = {}) {
  const { city, collision } = W;
  const events = createEvents();
  const vehicles = [];
  const walker = createWalker(city.spawn.x, city.spawn.z, city.spawn.heading || 0);
  walker.arms = createArms('pistol');
  const game = {
    city, collision, waterCollision: W.waterCollision, events, rng: createRng(seed + 7), vehicles, actors: [], time: 0, clock: 10, quality: 1,
    seaY: -0.6,
    world: { collision, waterCollision: W.waterCollision, city, crafts: vehicles, time: 0 },
    player: { mode: 'car', vehicle: null, walker, x: walker.x, z: walker.z, y: 0, heading: walker.heading, health: 100, armor: 0, wanted: 0 },
    progress: { settings: { police: true, mortal: hard }, stats: {} },
    hud: { toast() {} },
    score: { add: (pts) => pts },
    systems: [],
    addSystem(s) { game.systems.push(s); return s; },
    addVehicle(v) { vehicles.push(v); return v; },
    removeVehicle(v) {
      if (v === game.player.vehicle) { game.player.vehicle = null; game.player.mode = 'foot'; }
      const i = vehicles.indexOf(v);
      if (i >= 0) vehicles.splice(i, 1);
      v.removed = true;
    },
    setPlayerMode(m) { game.player.mode = m; },
  };
  RULES.invulnerable = !hard;
  game.addSystem(createParkedCars(game));
  game.peds = game.addSystem(createPeds(game));
  game.traffic = game.addSystem(createTraffic(game));
  game.police = game.addSystem(createPolice(game));
  game.combat = game.addSystem(createCombat(game, { seed }));
  return game;
}

// One fixed step in game.js order: crafts, car pairs, the player, systems.
const NO_CTL = { steer: 0, throttle: 0, brake: 0 };
export function stepGame(game, playerCtl, walkCtl, camHeading) {
  const dt = DT;
  game.time += dt;
  game.world.time = game.time;
  const p = game.player, vs = game.vehicles;
  for (let i = 0; i < vs.length; i++) {
    const v = vs[i];
    if (v.asleep || v.kind !== 'car') continue;
    v.px = v.x; v.pz = v.z; v.pheading = v.heading;
    stepVehicle(v, v === p.vehicle ? playerCtl : v.controls || null, dt, game.world);
    if (!v.driver && !v.controls && Math.abs(v.speed) < 0.02 && Math.abs(v.yawRate) < 0.02) v.asleep = true;
  }
  for (let i = 0; i < vs.length; i++) {
    const a = vs[i];
    for (let j = i + 1; j < vs.length; j++) {
      const b = vs[j];
      if ((a.asleep && b.asleep) || a.kind !== 'car' || b.kind !== 'car') continue;
      if (collideVehicles(a, b)) {
        a.asleep = false; b.asleep = false;
        game.events.emit('vehicleCrash', a, b, Math.max(a.impact, b.impact));
      }
    }
  }
  if (p.vehicle) {
    p.x = p.vehicle.x; p.z = p.vehicle.z; p.heading = p.vehicle.heading;
  } else {
    const w = p.walker;
    w.px = w.x; w.pz = w.z; w.pheading = w.heading;
    stepWalker(w, walkCtl || NO_CTL, dt, game.world, camHeading);
    p.x = w.x; p.z = w.z; p.heading = w.heading;
  }
  for (let i = 0; i < game.systems.length; i++) if (game.systems[i].fixedUpdate) game.systems[i].fixedUpdate(dt);
}

// The nearest drivable edge to (x, z): [edge id, from node, distance along].
function nearestEdge(city, x, z) {
  let best = Infinity, out = null;
  for (let k = 0; k < city.edges.length; k++) {
    const e = city.edges[k];
    if (e.ped || e.causeway || e.bridge) continue;
    const a = city.nodes[e.a], b = city.nodes[e.b];
    const dx = b.x - a.x, dz = b.z - a.z, L2 = dx * dx + dz * dz;
    if (L2 < 400) continue;
    let t = ((x - a.x) * dx + (z - a.z) * dz) / L2;
    t = t < 0.2 ? 0.2 : t > 0.8 ? 0.8 : t;
    const d = Math.hypot(a.x + dx * t - x, a.z + dz * t - z);
    if (d < best) { best = d; out = [k, e.oneway === -1 ? e.b : e.a, t * Math.sqrt(L2)]; }
  }
  return out;
}

// The player's car on the street nearest (x, z), with its route driver.
function seatCar(game, rng, x, z) {
  const city = game.city;
  const [eid, from, d] = nearestEdge(city, x, z);
  const car = createVehicle('sedan', 0, 0, 0, rng);
  const dr = createDriver(city, rng);
  placeDriver(dr, car, eid, from, d);
  // placeDriver puts the car on its lane (lane pose from the driver).
  if (!Number.isFinite(car.x) || (car.x === 0 && car.z === 0)) {
    const a = city.nodes[from], b = city.nodes[city.edges[eid].a === from ? city.edges[eid].b : city.edges[eid].a];
    const L = Math.hypot(b.x - a.x, b.z - a.z);
    car.x = a.x + ((b.x - a.x) * d) / L; car.z = a.z + ((b.z - a.z) * d) / L;
    car.heading = Math.atan2(b.z - a.z, b.x - a.x);
  }
  car.driver = 'player';
  game.addVehicle(car);
  game.player.vehicle = car;
  game.player.mode = 'car';
  return { car, dr };
}

// The clumsy thumb (thumbdriver.js numbers): late, quantized, noisy.
function createThumb(rng) {
  return { ring: new Float64Array(12), i: 0, out: 0, noise: 0, nt: 0, rng };
}
function thumb(t, want) {
  t.ring[t.i % 12] = want;
  t.i++;
  const late = t.ring[(t.i + 1) % 12]; // 11 steps (0.18 s) ago
  if (--t.nt <= 0) { t.noise = (t.rng.next() * 2 - 1) * 0.04; t.nt = 6; }
  const step = 4 * DT;
  const target = Math.round((late + t.noise) / 0.08) * 0.08;
  t.out += Math.max(-step, Math.min(step, target - t.out));
  return Math.max(-1, Math.min(1, t.out));
}

// The tally of one run.
function createTally() {
  return {
    seconds: 0, driveSeconds: 0, walkSeconds: 0, km: 0,
    crashes: 0, crashesOver30: 0, crashMaxMph: 0, carContacts: 0, bumpsUnder30: 0, parkedContacts: 0,
    carWrecks: 0, wreckCauses: {}, damage: { crashUnder20: 0, crash20to30: 0, crash30to45: 0, crashOver45: 0, props: 0, combat: 0 }, carExplosions: 0, maxWanted: 0, minCarHealth: 1,
    playerHits: 0, playerHitByCar: 0, playerKnockdowns: 0, knockdownsByCarUnder15: 0, playerDeaths: 0, deathCauses: {},
    pedHits: 0, propBreaks: 0,
  };
}

// Runs one 10 minute (by default) clumsy session: drive, then walk.
export function runSurvival(W, opts = {}) {
  const before = RULES.invulnerable;
  try {
    return runSession(W, opts);
  } finally {
    RULES.invulnerable = before;
  }
}
function runSession(W, { seed = 1, hard = false, minutes = 10, walkMinutes = null } = {}) {
  const game = makeGame(W, { seed, hard });
  const rng = createRng(seed * 977 + (hard ? 13 : 0));
  const T = createTally();
  const p = game.player;
  let { car, dr } = seatCar(game, rng, game.city.spawn.x, game.city.spawn.z);
  p.walker.x = car.x; p.walker.z = car.z;
  const th = createThumb(rng);
  const ctl = { steer: 0, throttle: 0, brake: 0, handbrake: false };
  const walk = { moveX: 0, moveY: 0, sprint: false };
  let lastCause = '';
  game.events.on('hit', (h) => {
    if (h.kind === 'ram' && h.source && h.source === p.vehicle && h.target !== p.walker) T.pedHits++;
    if (h.target !== p.walker) return;
    T.playerHits++;
    lastCause = h.kind + (h.source && h.source.spec ? ':car' : h.source && h.source.team ? ':' + h.source.team : '');
    if (h.kind === 'ram') T.playerHitByCar++;
  });
  game.events.on('down', (d) => {
    if (d.target !== p.walker) return;
    T.playerKnockdowns++;
    const s = d.source;
    if (d.kind === 'ram' && s && Math.hypot(s.vx || 0, s.vz || 0) * MPH < 15) T.knockdownsByCarUnder15++;
  });
  game.events.on('playerDown', () => { T.playerDeaths++; T.deathCauses[lastCause] = (T.deathCauses[lastCause] || 0) + 1; });
  game.events.on('explosion', (e) => { if (e.craft && e.craft.driver === 'player') T.carExplosions++; });
  // Car contacts: one per touch (not per step), by what was touched.
  let touching = null, touchedAt = -1;
  game.events.on('vehicleCrash', (a, b, close) => {
    if (a !== p.vehicle && b !== p.vehicle) return;
    const o = a === p.vehicle ? b : a;
    const fresh = touching !== o || game.time - touchedAt > 0.5;
    touching = o; touchedAt = game.time;
    if (!fresh) return;
    T.carContacts++;
    if (close * MPH < 30) T.bumpsUnder30++;
    if (!o.driver) T.parkedContacts++;
  });
  game.events.on('propBreak', () => T.propBreaks++);

  // Crash and prop damage to the player's car through the damage rule
  // (vehicle.js damageVehicle), by the closing speed of the contact.
  const inner = getDamageRule();
  let ruleDamage = 0;
  setDamageRule((v, amount, kind, src) => {
    const a = inner ? inner(v, amount, kind, src) : amount;
    if (v === p.vehicle && a > 0) {
      const mph = (v.impact || 0) * MPH;
      const band = kind === 'prop' ? 'props' : mph < 20 ? 'crashUnder20' : mph < 30 ? 'crash20to30' : mph < 45 ? 'crash30to45' : 'crashOver45';
      T.damage[band] += Math.min(a, v.health) / v.spec.health;
      ruleDamage += Math.min(a, v.health);
    }
    return a;
  });
  const driveSteps = Math.round(minutes * 60 / DT);
  const walkSteps = Math.round((walkMinutes === null ? minutes : walkMinutes) * 60 / DT);
  const ctx = { time: 0, vehicles: [], sirens: [] };
  let swerveT = 15 + rng.next() * 15, swerveLeft = 0, swerveDir = 1, slowT = 0, backT = 0;
  let crashDone = false, crashRun = 0;
  let lastX = car.x, lastZ = car.z, lastCrash = -1;
  for (let i = 0; i < driveSteps; i++) {
    const t = i * DT;
    if (!p.vehicle || p.vehicle !== car || car.wrecked) {
      // Wrecked (Hard) or out: count it, a fresh car on the nearest street.
      if (car.wrecked && !car.tallied) {
        car.tallied = true;
        T.carWrecks++;
        const how = car.crashWreck ? 'crash' : (car.lastKind || '?') + (car.lastHitBy && car.lastHitBy.team ? ':' + car.lastHitBy.team : car.lastHitBy && car.lastHitBy.police ? ':police car' : '');
        T.wreckCauses[how] = (T.wreckCauses[how] || 0) + 1;
      }
      if (p.vehicle === car) { car.driver = null; p.vehicle = null; }
      if (p.walker.life && p.walker.life !== 'ok') { stepGame(game, ctl, null, 0); continue; }
      ({ car, dr } = seatCar(game, rng, p.walker.x, p.walker.z));
      lastX = car.x; lastZ = car.z;
    }
    // The route's own controls, without braking for what is in the way.
    ctx.time = game.time;
    const saved = car.controls;
    car.controls = null;
    const c = driveStep(dr, car, DT, ctx);
    car.controls = saved;
    let want = c.steer, thr = c.throttle, brk = c.brake * 0.6;
    const target = dr.targetSpeed * 1.3;
    if (car.speed < target - 1) { thr = Math.max(thr, 0.8); brk = 0; }
    // A swerve to one side now and then.
    swerveT -= DT;
    if (swerveT <= 0) { swerveLeft = 0.6 + rng.next() * 0.6; swerveDir = rng.next() < 0.5 ? -1 : 1; swerveT = 15 + rng.next() * 15; }
    if (swerveLeft > 0) { swerveLeft -= DT; want += swerveDir * 0.4; }
    // Minute 5: one 60 mph run straight on into whatever is there.
    if (!crashDone && t >= 300) {
      crashRun += DT;
      want = 0; thr = 1; brk = 0;
      if (car.speed < 60 / MPH) car.vx += Math.cos(car.heading) * 0.4, car.vz += Math.sin(car.heading) * 0.4;
      if (car.impact > 5 || crashRun > 12) crashDone = true;
    }
    // Stuck: back up with the wheel over, then go on.
    if (Math.abs(car.speed) < 0.8 && thr > 0.5) slowT += DT; else slowT = 0;
    if (slowT > 3) { backT = 1.8; slowT = 0; }
    if (backT > 0) { backT -= DT; want = -swerveDir; thr = 0; brk = 1; }
    ctl.steer = thumb(th, Math.max(-1, Math.min(1, want)));
    ctl.throttle = thr; ctl.brake = brk;
    const h0 = car.health;
    ruleDamage = 0;
    stepGame(game, ctl, null, 0);
    if (p.wanted > T.maxWanted) T.maxWanted = p.wanted;
    // The rest of the health lost: weapons and fire (combat.js).
    const lost = h0 - car.health - ruleDamage;
    if (lost > 1e-9) T.damage.combat += lost / car.spec.health;
    if (car.impact > CRASH_MIN && game.time - lastCrash > 0.5) {
      lastCrash = game.time;
      T.crashes++;
      const mph = car.impact * MPH;
      if (mph >= 30) T.crashesOver30++;
      if (mph > T.crashMaxMph) T.crashMaxMph = mph;
    }
    if (p.vehicle === car) {
      T.km += Math.hypot(car.x - lastX, car.z - lastZ) / 1000;
      lastX = car.x; lastZ = car.z;
      T.minCarHealth = Math.min(T.minCarHealth, car.health / car.spec.health);
      T.driveSeconds += DT;
    }
  }
  // Walk: out of the car, then along and across the streets.
  if (p.vehicle) { p.vehicle.driver = null; p.vehicle.controls = null; p.vehicle = null; p.mode = 'foot'; p.walker.x = car.x - Math.sin(car.heading) * 2.5; p.walker.z = car.z + Math.cos(car.heading) * 2.5; }
  let cam = car.heading, legT = 0, sprint = false;
  for (let i = 0; i < walkSteps; i++) {
    legT -= DT;
    if (legT <= 0) {
      // A new leg: a quarter of the time straight across the street.
      const r = rng.next();
      cam += r < 0.25 ? Math.PI / 2 * (rng.next() < 0.5 ? -1 : 1) : (rng.next() - 0.5) * 0.8;
      sprint = rng.next() < 0.5;
      legT = 3 + rng.next() * 6;
    }
    walk.moveY = 1; walk.moveX = 0; walk.sprint = sprint;
    stepGame(game, ctl, walk, cam);
    const w = p.walker;
    if (Math.hypot(w.x - w.px, w.z - w.pz) < 0.3 * DT && w.life === 'ok') legT = Math.min(legT, 0.2); // walled in: turn
    T.walkSeconds += DT;
  }
  setDamageRule(inner);
  T.seconds = (driveSteps + walkSteps) * DT;
  T.km = +T.km.toFixed(2);
  T.crashMaxMph = +T.crashMaxMph.toFixed(0);
  T.minCarHealth = +T.minCarHealth.toFixed(2);
  for (const k of Object.keys(T.damage)) T.damage[k] = +T.damage[k].toFixed(2);
  return T;
}

const isMain = process.argv[1] && process.argv[1].endsWith('survival.mjs');
if (isMain) {
  const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
  const regions = arg('--region', null) ? [arg('--region')] : ['miami-beach', 'miami-downtown'];
  const minutes = +arg('--minutes', 10);
  const seeds = (arg('--seeds', '1')).split(',').map(Number);
  const all = {};
  for (const id of regions) {
    const W = buildWorld(id);
    for (const hard of [false, true]) {
      for (const seed of seeds) {
        const t0 = Date.now();
        const r = runSurvival(W, { seed, hard, minutes });
        const key = `${id} ${hard ? 'hard' : 'default'} seed ${seed}`;
        all[key] = r;
        console.log(key, JSON.stringify(r), `(${((Date.now() - t0) / 1000).toFixed(0)} s)`);
      }
    }
  }
  const out = arg('--json', null);
  if (out) fs.writeFileSync(out, JSON.stringify(all, null, 1));
}
