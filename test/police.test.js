import test from 'node:test';
import assert from 'node:assert/strict';
import { generateCity, lanePoint } from '../src/world/citygen.js';
import { createCollisionWorld } from '../src/world/collision.js';
import { createVehicle, stepVehicle, collideVehicles } from '../src/entities/vehicle.js';
import { createRng } from '../src/core/rng.js';
import { createEvents } from '../src/core/events.js';
import {
  createHeat, updateHeat, updateBust, bustFine, isRam, escapeReward,
  createCop, chaseStep, createPolice, COOLDOWN,
} from '../src/systems/police.js';

const DT = 1 / 60;
const city = generateCity();
const collision = createCollisionWorld();
for (const b of city.buildings) collision.addBox(b.x0, b.z0, b.x1, b.z1, b.h, b.kind);

const baseFacts = () => ({
  speeding: 0, crashedTraffic: false, startledPed: false, seenByPolice: false,
  inCar: true, atSea: false, airborne: false,
});

// Run the heat rules for `seconds`, calling `mod(facts, t)` each step.
function runHeat(heat, seconds, mod) {
  const out = [];
  const f = baseFacts();
  const n = Math.round(seconds / DT);
  for (let k = 0; k < n; k++) {
    Object.assign(f, baseFacts());
    if (mod) mod(f, k * DT);
    const r = updateHeat(heat, DT, f);
    if (r) out.push(r);
  }
  return out;
}

test('a minor bump does not count; ramming traffic raises heat one step at a time', () => {
  const me = createVehicle('sedan', 0, 0, 0);
  const other = createVehicle('sedan', 4, 0, 0);
  other.traffic = true;
  me.px = -0.05; me.pz = 0; me.x = 0; me.z = 0; // ~3 m/s
  other.px = other.x; other.pz = other.z;
  assert.equal(isRam(me, other, 3), false, 'gentle bump');
  me.px = -0.25; // 15 m/s into a standing car
  assert.equal(isRam(me, other, 12), true, 'ram');
  const parked = createVehicle('sedan', 4, 0, 0);
  assert.equal(isRam(me, parked, 12), false, 'parked cars do not count');
  // Being hit by a faster car is not ramming.
  other.px = other.x + 0.4;
  assert.equal(isRam(me, other, 12), false, 'was rammed');

  const heat = createHeat();
  runHeat(heat, 2, () => {});
  assert.equal(heat.level, 0);
  const ev = runHeat(heat, 1, (f, t) => { f.crashedTraffic = t === 0; f.seenByPolice = true; });
  assert.deepEqual(ev, ['up']);
  assert.equal(heat.level, 1);
  // A second ram straight away waits out the grace period, then steps up.
  runHeat(heat, 0.5, (f, t) => { f.crashedTraffic = t === 0; f.seenByPolice = true; });
  assert.equal(heat.level, 1, 'grace period');
  runHeat(heat, 4, (f) => { f.seenByPolice = true; });
  assert.equal(heat.level, 2);
  // Never above 3, however many rams.
  runHeat(heat, 60, (f, t) => { f.crashedTraffic = Math.floor(t * 60) % 30 === 0; f.seenByPolice = true; });
  assert.equal(heat.level, 3);
});

test('speeding unseen does nothing; seen for long enough gives heat 1', () => {
  const heat = createHeat();
  runHeat(heat, 60, (f) => { f.speeding = 15; });
  assert.equal(heat.level, 0, 'nobody saw');
  runHeat(heat, 5, (f) => { f.speeding = 3; f.seenByPolice = true; });
  assert.equal(heat.level, 0, 'mild speeding');
  runHeat(heat, 5, (f) => { f.speeding = 15; f.seenByPolice = true; });
  assert.equal(heat.level, 0, 'not long enough');
  runHeat(heat, 8, (f) => { f.speeding = 15; f.seenByPolice = true; });
  assert.equal(heat.level, 1);
});

test('startling pedestrians is a medium offence', () => {
  const heat = createHeat();
  runHeat(heat, 1, (f, t) => { f.startledPed = t === 0; });
  assert.equal(heat.level, 0);
  runHeat(heat, 1, (f, t) => { f.startledPed = t === 0; });
  assert.equal(heat.level, 1);
});

test('out of sight for the cooldown clears heat and reports the escape once', () => {
  const heat = createHeat();
  runHeat(heat, 0.1, (f, t) => { f.crashedTraffic = t === 0; });
  assert.equal(heat.level, 1);
  // Seen: never escapes.
  assert.deepEqual(runHeat(heat, 30, (f) => { f.seenByPolice = true; }), []);
  assert.equal(heat.level, 1);
  let half = -1;
  const ev = runHeat(heat, COOLDOWN[1] + 5, (f, t) => {
    if (half < 0 && t > COOLDOWN[1] / 2) half = heat.cooldown;
  });
  assert.ok(half > 0.4 && half < 0.6, `cooldown ${half}`);
  assert.deepEqual(ev, ['escaped']);
  assert.equal(heat.level, 0);
  assert.equal(heat.escapedLevel, 1);
  assert.equal(heat.cooldown, 0);
  assert.equal(escapeReward(heat.escapedLevel), 30);
});

test('at sea clears faster, even with police nearby', () => {
  const time = (mod) => {
    const heat = createHeat();
    runHeat(heat, 0.1, (f, t) => { f.crashedTraffic = t === 0; });
    let at = -1;
    runHeat(heat, 30, (f, t) => {
      mod(f);
      if (at < 0 && heat.level === 0) at = t;
    });
    return at;
  };
  const land = time(() => {});
  const sea = time((f) => { f.atSea = true; f.inCar = false; f.seenByPolice = true; });
  const air = time((f) => { f.airborne = true; f.inCar = false; f.seenByPolice = true; });
  assert.ok(land > 0 && sea > 0 && sea < land, `land ${land} sea ${sea}`);
  assert.ok(air > 0 && air < land);
});

test('settings off keeps heat at 0', () => {
  const heat = createHeat();
  runHeat(heat, 10, (f) => { f.crashedTraffic = true; f.enabled = false; });
  assert.equal(heat.level, 0);
});

test('bust: stopped beside a police car, or on foot next to one; fine is clamped', () => {
  const heat = createHeat();
  const f = { playerSpeed: 0.5, copDist: 5, onFoot: false, inCar: true };
  assert.equal(updateBust(heat, 3, f), false, 'not wanted');
  heat.level = 2;
  let busted = false, t = 0;
  while (!busted && t < 5) {
    busted = updateBust(heat, DT, f);
    t += DT;
  }
  assert.ok(busted && Math.abs(t - 2.5) < 0.05, `busted at ${t}`);
  heat.bustTime = 0;
  for (let k = 0; k < 300; k++) assert.equal(updateBust(heat, DT, { ...f, playerSpeed: 6 }), false);
  for (let k = 0; k < 300; k++) assert.equal(updateBust(heat, DT, { ...f, copDist: 9 }), false);
  assert.equal(updateBust(heat, DT, { playerSpeed: 0, copDist: 4, onFoot: true, inCar: false }), true);
  assert.equal(updateBust(heat, DT, { playerSpeed: 0, copDist: 6, onFoot: true, inCar: false }), false);
  assert.equal(bustFine(1, 1000), 60);
  assert.equal(bustFine(3, 1000), 180);
  assert.equal(bustFine(3, 75), 75);
  assert.equal(bustFine(2, 0), 0);
  assert.equal(bustFine(2, -40), 0);
});

// --- Chase on the real city. ---

const world = { collision, city, time: 0 };

function edgePoint(e, from, d, lane = 0) {
  const p = { x: 0, z: 0, heading: 0 };
  lanePoint(city, e, from, d, lane, p);
  return p;
}

function placeOn(spec, p, rng) {
  const v = createVehicle(spec, p.x, p.z, p.heading, rng);
  v.px = v.x; v.pz = v.z;
  return v;
}

// Run a chase; `moveTarget(t)` may move the target kinematically.
function chase(cop, cv, target, seconds, { moveTarget = null, collide = true, onStep = null } = {}) {
  const vehicles = [cv, target];
  const ctx = { collision, vehicles, time: 0 };
  const n = Math.round(seconds / DT);
  let maxWall = 0;
  for (let k = 0; k < n; k++) {
    world.time += DT;
    ctx.time = world.time;
    stepVehicle(cv, cv.controls, DT, world);
    maxWall = Math.max(maxWall, cv.impact);
    if (moveTarget) moveTarget(k * DT);
    else stepVehicle(target, null, DT, world);
    if (collide) collideVehicles(cv, target);
    chaseStep(cop, cv, DT, target, ctx);
    for (const v of vehicles) {
      for (const key of ['x', 'z', 'heading', 'vx', 'vz', 'speed']) assert.ok(Number.isFinite(v[key]), `NaN ${key}`);
    }
    if (onStep && onStep(k * DT)) break;
  }
  return { maxWall };
}

function findPair() {
  // Target: middle of a central street; police: on a road ~150 m away.
  const central = city.edges
    .filter((e) => !e.causeway && !e.avenue && e.length > 80)
    .sort((a, b) => {
      const ra = Math.hypot(city.nodes[a.a].x, city.nodes[a.a].z), rb = Math.hypot(city.nodes[b.a].x, city.nodes[b.a].z);
      return ra - rb;
    });
  const te = central[0];
  const tp = edgePoint(te, te.a, te.length / 2);
  for (const e of city.edges) {
    if (e.causeway) continue;
    for (const from of [e.a, e.b]) {
      const p = edgePoint(e, from, e.length / 2);
      const d = Math.hypot(p.x - tp.x, p.z - tp.z);
      if (d > 145 && d < 155 && !collision.lineClear(p.x, p.z, tp.x, tp.z)) return { tp, cp: p };
    }
  }
  throw new Error('no start found');
}

function runCatch(seed) {
  const rng = createRng(seed);
  const { tp, cp } = findPair();
  const target = placeOn('sedan', tp, rng);
  const cv = placeOn('police', cp, rng);
  const cop = createCop(city, rng);
  let caught = -1;
  const { maxWall } = chase(cop, cv, target, 40, {
    onStep(t) {
      if (Math.hypot(cv.x - target.x, cv.z - target.z) < 10) {
        caught = t;
        return true;
      }
      return false;
    },
  });
  return { caught, maxWall, x: cv.x, z: cv.z };
}

test('a police car 150 m away reaches a stopped car without crashing into buildings', () => {
  const r = runCatch(5);
  assert.ok(r.caught > 0 && r.caught < 40, `caught at ${r.caught}`);
  assert.ok(r.maxWall <= 6, `wall impact ${r.maxWall.toFixed(1)} m/s`);
  const again = runCatch(5);
  assert.deepEqual(again, r, 'deterministic');
});

test('keeps within 80 m of a car doing 20 m/s along an avenue for 30 s', () => {
  // The long north-south avenue: kinematic target driving south.
  const av = city.edges.filter((e) => e.avenue && !e.horizontal && !e.causeway);
  const xs = new Map();
  for (const e of av) {
    const x = Math.round(city.nodes[e.a].x);
    xs.set(x, (xs.get(x) || 0) + e.length);
  }
  const ax = [...xs.entries()].sort((a, b) => b[1] - a[1])[0][0];
  const line = av.filter((e) => Math.round(city.nodes[e.a].x) === ax);
  const zs = line.flatMap((e) => [city.nodes[e.a].z, city.nodes[e.b].z]);
  const z0 = Math.min(...zs), z1 = Math.max(...zs);
  assert.ok(z1 - z0 > 700, `avenue ${z1 - z0} m`);
  const rng = createRng(9);
  const lx = city.nodes[line[0].a].x - 2.6; // southbound lane (right of travel)
  const target = createVehicle('sedan', lx, z0 + 60, Math.PI / 2, rng);
  target.vz = 20; target.speed = 20;
  // Police starts 50 m behind, on the same avenue.
  const e0 = line.find((e) => Math.min(city.nodes[e.a].z, city.nodes[e.b].z) <= z0 + 10);
  const from = city.nodes[e0.a].z < city.nodes[e0.b].z ? e0.a : e0.b;
  const cp = edgePoint(e0, from, 10, 0);
  const cv = placeOn('police', cp, rng);
  cv.vx = Math.cos(cv.heading) * 15; cv.vz = Math.sin(cv.heading) * 15; cv.speed = 15;
  const cop = createCop(city, rng);
  let maxGap = 0, minGap = Infinity;
  chase(cop, cv, target, 30, {
    collide: false,
    moveTarget() {
      target.px = target.x; target.pz = target.z;
      target.z += target.vz * DT;
    },
    onStep(t) {
      const d = Math.hypot(cv.x - target.x, cv.z - target.z);
      if (t > 3) maxGap = Math.max(maxGap, d);
      minGap = Math.min(minGap, d);
      return false;
    },
  });
  assert.ok(target.z < z1, 'stayed on the avenue');
  assert.ok(maxGap < 80, `fell ${maxGap.toFixed(1)} m behind`);
  assert.ok(minGap > 1.5, 'did not drive through the target');
});

// --- The system with a minimal game. ---

function fakeGame(police = true) {
  const vehicles = [];
  const toasts = [];
  const game = {
    city, collision, rng: createRng(3), events: createEvents(), vehicles, time: 0,
    progress: { money: 100, settings: { police } },
    hud: { toast: (t) => toasts.push(t) },
    toasts,
    addVehicle(v) { vehicles.push(v); return v; },
    removeVehicle(v) {
      const i = vehicles.indexOf(v);
      if (i >= 0) vehicles.splice(i, 1);
      v.removed = true;
    },
  };
  const car = createVehicle('sedan', city.spawn.x, city.spawn.z, 0);
  car.driver = 'player';
  vehicles.push(car);
  game.player = { x: car.x, z: car.z, y: 0, heading: 0, mode: 'car', vehicle: car, walker: null, wanted: 0 };
  return game;
}

function ram(game) {
  const pv = game.player.vehicle;
  const other = createVehicle('sedan', pv.x + 4, pv.z, 0);
  other.traffic = true;
  other.px = other.x; other.pz = other.z;
  pv.px = pv.x - 0.25; pv.pz = pv.z;
  game.events.emit('vehicleCrash', pv, other, 12);
}

test('system: off means nothing happens; on, a ram brings a siren chase', () => {
  const off = fakeGame(false);
  const sysOff = createPolice(off);
  for (let k = 0; k < 600; k++) {
    if (k % 60 === 0) ram(off);
    off.time += DT;
    sysOff.fixedUpdate(DT);
  }
  assert.equal(off.player.wanted, 0);
  assert.equal(off.vehicles.filter((v) => v.police).length, 0);

  const game = fakeGame(true);
  const sys = createPolice(game);
  const sirens = [];
  game.events.on('siren', (on) => sirens.push(on));
  for (let k = 0; k < 60; k++) {
    game.time += DT;
    sys.fixedUpdate(DT);
  }
  ram(game);
  for (let k = 0; k < 240; k++) {
    game.time += DT;
    sys.fixedUpdate(DT);
  }
  assert.equal(game.player.wanted, 1);
  const cops = game.vehicles.filter((v) => v.police);
  assert.ok(cops.length >= 1 && cops.length <= 1, `${cops.length} police cars`);
  assert.ok(cops.every((v) => v.ai && v.siren));
  assert.deepEqual(sirens, [true]);
  const d = Math.hypot(cops[0].x - game.player.x, cops[0].z - game.player.z);
  assert.ok(d > 60, `spawned ${d.toFixed(0)} m away`);
  // Turning the setting off ends it at once.
  game.progress.settings.police = false;
  sys.fixedUpdate(DT);
  assert.equal(game.player.wanted, 0);
  assert.equal(game.vehicles.filter((v) => v.police).length, 0);
  assert.deepEqual(sirens, [true, false]);
});

test('system: pulled over takes a fine no bigger than the player has', () => {
  const game = fakeGame(true);
  game.progress.money = 70;
  const sys = createPolice(game);
  const fails = [];
  game.events.on('fail', (r) => fails.push(r));
  ram(game);
  sys.fixedUpdate(DT);
  ram(game);
  for (let k = 0; k < 300; k++) sys.fixedUpdate(DT);
  ram(game);
  for (let k = 0; k < 2; k++) sys.fixedUpdate(DT);
  assert.equal(sys.heat.level, 2);
  // Park a pursuit car right beside the stopped player.
  const pv = game.player.vehicle;
  let cop = game.vehicles.find((v) => v.police && v.role === 'chase');
  assert.ok(cop, 'a pursuit car');
  for (let k = 0; k < 200 && sys.heat.level > 0; k++) {
    cop.x = pv.x; cop.z = pv.z + 3.5; cop.vx = cop.vz = 0; cop.speed = 0;
    sys.fixedUpdate(DT);
  }
  assert.equal(sys.heat.level, 0);
  assert.equal(game.progress.money, 0);
  assert.ok(game.toasts.some((t) => t === 'Pulled over! Fine $70'), game.toasts.join('|'));
  assert.deepEqual(fails, ['Pulled over']);
  assert.ok(game.vehicles.filter((v) => v.police).every((v) => v.role === 'leave' && !v.siren));
});
