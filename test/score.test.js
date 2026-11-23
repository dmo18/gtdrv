import test from 'node:test';
import assert from 'node:assert/strict';
import { createEvents } from '../src/core/events.js';
import { createRng } from '../src/core/rng.js';
import { generateCity } from '../src/world/citygen.js';
import { defaultProgress, loadProgress, SAVE_KEY } from '../src/core/save.js';
import { createEconomy } from '../src/systems/economy.js';
import { createFleet, PREMIUM } from '../src/systems/fleet.js';
import {
  createScore, racePoints, COMBO_MAX, MAX_EVENT, MAX_PENDING, POINTS,
} from '../src/systems/score.js';

const DT = 1 / 60;
const memory = (init) => {
  const m = new Map(init ? [[SAVE_KEY, init]] : []);
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)) };
};

function fake(extra = {}) {
  const events = createEvents();
  const game = {
    events,
    progress: defaultProgress(),
    hudState: { score: 0, pending: 0, combo: 1 },
    hud: { toast() {} },
    player: { x: 0, z: 0, y: 0, vehicle: null, mode: 'foot' },
    vehicles: [],
    ...extra,
  };
  game.score = createScore(game);
  return game;
}
const run = (game, seconds) => {
  const n = Math.round(seconds / DT);
  for (let i = 0; i < n; i++) game.score.fixedUpdate(DT);
};
const crewActor = { team: 'crew', x: 1, z: 2 };
const takedown = (game, target, depth = 0) => game.events.emit('takedown', { target, source: game.player, kind: 'bullet', depth });

test('add: first event x1, each event within 4 s adds 0.5, capped at x5', () => {
  const g = fake();
  assert.equal(g.score.add(100, 'a'), 100);
  assert.equal(g.score.combo, 1);
  run(g, 1);
  assert.equal(g.score.add(100, 'b'), 150);
  assert.equal(g.score.combo, 1.5);
  run(g, 3.5);
  assert.equal(g.score.add(100, 'c'), 200);
  assert.equal(g.score.pending, 450);
  assert.equal(g.score.total, 0, 'still pending');
  for (let i = 0; i < 20; i++) g.score.add(100, 'x');
  assert.equal(g.score.combo, COMBO_MAX);
});

test('pending banks after 4 quiet seconds and resets the combo', () => {
  const g = fake();
  g.score.add(100, 'a');
  g.score.add(100, 'b');
  run(g, 3.9);
  assert.equal(g.score.total, 0);
  run(g, 0.3);
  assert.equal(g.score.total, 250);
  assert.equal(g.progress.score.total, 250);
  assert.equal(g.progress.score.sessionBest, 250);
  assert.equal(g.progress.score.best.combo, 1.5);
  assert.equal(g.score.pending, 0);
  assert.equal(g.score.combo, 1);
  assert.equal(g.hudState.score, 250);
});

test('caps: per event, pending, bad numbers', () => {
  const g = fake();
  assert.equal(g.score.add(1e9, 'huge'), MAX_EVENT);
  for (const bad of [0, -5, NaN, Infinity, '50', null, undefined]) assert.equal(g.score.add(bad, 'bad'), 0);
  for (let i = 0; i < 200; i++) g.score.add(MAX_EVENT, 'spam');
  assert.ok(g.score.pending <= MAX_PENDING);
  run(g, 5);
  assert.ok(g.score.total <= 1e9);
  assert.ok(Number.isInteger(g.progress.score.total));
});

test('awards bank straight away without a combo', () => {
  const g = fake();
  g.score.add(100, 'a');
  assert.equal(g.score.add(2000, 'Medal', 0, 0, true), 2000);
  assert.equal(g.score.total, 2000);
  assert.equal(g.score.pending, 100);
  assert.equal(g.score.combo, 1);
});

test('crew takedown 100; civilians and officers earn nothing', () => {
  const g = fake();
  takedown(g, { team: 'civ', x: 0, z: 0 });
  takedown(g, { team: 'police', x: 0, z: 0 });
  takedown(g, { team: 'player', x: 0, z: 0 });
  takedown(g, null);
  assert.equal(g.score.pending, 0);
  takedown(g, crewActor);
  assert.equal(g.score.pending, 100);
});

test('takedown streak adds 50 within 3 s; chain blasts double', () => {
  const g = fake();
  takedown(g, crewActor);
  run(g, 1);
  takedown(g, crewActor); // 100 + 50, combo x1.5 -> 225
  assert.equal(g.score.pending, 100 + 225);
  const h = fake();
  takedown(h, { spec: {}, kind: 'car', x: 0, z: 0 }, 1);
  assert.equal(h.score.pending, 500, 'craft 250 doubled by the chain');
});

test('craft wrecked: 250, crew craft 400', () => {
  const a = fake();
  takedown(a, { spec: {}, kind: 'car', x: 0, z: 0 });
  assert.equal(a.score.pending, POINTS.craft);
  const b = fake();
  takedown(b, { spec: {}, kind: 'car', crew: true, x: 0, z: 0 });
  assert.equal(b.score.pending, POINTS.crewCraft);
});

test('downed, busted and hard crashes lose the pending points', () => {
  const car = { kind: 'car' };
  const mk = () => { const g = fake(); g.player.vehicle = car; g.score.add(500, 'a'); return g; };
  let g = mk();
  g.events.emit('playerDown');
  assert.equal(g.score.pending, 0);
  g = mk();
  g.events.emit('fail', 'x', 'Pulled over');
  assert.equal(g.score.pending, 0);
  g = mk();
  g.events.emit('fail', 'x', 'Race abandoned');
  assert.equal(g.score.pending, 500, 'other failures keep it');
  g = mk();
  g.events.emit('vehicleImpact', car, 7);
  assert.equal(g.score.pending, 500, 'soft bump');
  g.events.emit('vehicleImpact', { kind: 'car' }, 20);
  assert.equal(g.score.pending, 500, 'someone else crashed');
  g.events.emit('vehicleImpact', car, 9);
  assert.equal(g.score.pending, 0);
  g = mk();
  g.events.emit('vehicleCrash', car, {}, 12);
  assert.equal(g.score.pending, 0);
  run(g, 5);
  assert.equal(g.score.total, 0, 'nothing banked');
});

test('escaping the police pays 500 x level, once', () => {
  const g = fake({ police: { heat: { escapedLevel: 3 } } });
  g.events.emit('reward', 120, 'Lost the police');
  g.events.emit('escaped', 3);
  assert.equal(g.score.total, 1500);
  g.events.emit('reward', 5, 'something else');
  assert.equal(g.score.total, 1500);
});

test('stunts: airtime and jump, drift, near miss, low flying, roof landing', () => {
  const car = { kind: 'car', x: 0, z: 0, y: 0, speed: 25, slip: 0, spec: { width: 1.8 }, impact: 0 };
  const g = fake({ vehicles: [car] });
  g.player.vehicle = car;
  // Jump: 1 s in the air over 20 m.
  car.y = 1;
  for (let i = 0; i < 60; i++) { car.x += 20 / 60; g.score.fixedUpdate(DT); }
  car.y = 0;
  g.score.fixedUpdate(DT);
  assert.ok(g.score.pending >= 100 + 190, `jump pending ${g.score.pending}`);
  assert.ok(g.progress.score.best.jump >= 19);
  assert.ok(g.progress.score.best.airtime >= 0.9);
  run(g, 5);

  // A short hop scores nothing.
  const before = g.score.total;
  car.y = 1;
  run(g, 0.3);
  car.y = 0;
  run(g, 5);
  assert.equal(g.score.total, before);

  // Drift for 2 s.
  car.slip = 0.6;
  run(g, 2);
  car.slip = 0;
  run(g, 0.5);
  assert.ok(g.score.pending >= 95 && g.score.pending <= 105, `drift ${g.score.pending}`);
  assert.ok(g.progress.score.best.drift >= 95);
  run(g, 5);

  // Near miss: traffic car beside us, 1 m between the sides.
  const other = { kind: 'car', driver: {}, x: car.x, z: 2.8, spec: { width: 1.8 } };
  car.slip = 0;
  g.vehicles.push(other);
  const t0 = g.score.total;
  g.score.fixedUpdate(DT);
  assert.equal(g.score.pending, POINTS.nearMiss);
  g.score.fixedUpdate(DT);
  assert.equal(g.score.pending, POINTS.nearMiss, 'once per pass');
  g.vehicles.length = 1;
  run(g, 5);
  assert.equal(g.score.total, t0 + POINTS.nearMiss);
  // Too slow: nothing.
  car.speed = 10;
  other.nearMissT = 0;
  g.vehicles.push(other);
  g.score.fixedUpdate(DT);
  assert.equal(g.score.pending, 0);
  g.vehicles.length = 1;

  // Low flying, then a heli roof landing.
  const plane = { kind: 'plane', x: 0, z: 0, y: 10, speed: 60, onGround: false };
  g.player.vehicle = plane;
  run(g, 2.1);
  assert.equal(g.score.pending, POINTS.lowFlyPerSecond + Math.round(POINTS.lowFlyPerSecond * 1.5));
  plane.y = 100;
  run(g, 5);
  const heli = { kind: 'heli', x: 0, z: 0, y: 30, speed: 0, onGround: false };
  g.player.vehicle = heli;
  g.score.fixedUpdate(DT);
  heli.onGround = true;
  g.score.fixedUpdate(DT);
  assert.equal(g.score.pending, POINTS.roofLanding);
});

test('race points', () => {
  assert.equal(racePoints('gold', false), 3000);
  assert.equal(racePoints('silver', true), 2500);
  assert.equal(racePoints(null, true), 1000);
});

test('high scores persist: economy saves, a new session loads them', () => {
  const storage = memory();
  const g = { events: createEvents(), progress: defaultProgress(), player: { x: 0, z: 0 } };
  g.economy = createEconomy(g, storage);
  g.score = createScore(g);
  g.score.add(1000, 'a');
  run(g, 5); // banks, emits 'progress' which saves
  g.score.recordCourse('street-glasswell', 3500);
  g.score.recordCourse('street-glasswell', 2000);
  g.events.emit('missionDone', { id: 'm1', score: 4000, time: 200, newBest: true });
  g.events.emit('missionDone', { id: 'm1', score: 3000, time: 150, newBest: false });
  const saved = JSON.parse(storage.getItem(SAVE_KEY));
  assert.equal(saved.version, 3);
  assert.equal(saved.score.total, 1000);
  assert.equal(saved.score.sessionBest, 1000);
  assert.equal(saved.score.missions.m1.best, 4000);
  assert.equal(saved.score.missions.m1.time, 150);

  const g2 = { events: createEvents(), progress: defaultProgress(), player: { x: 0, z: 0 } };
  createEconomy(g2, storage);
  g2.score = createScore(g2);
  assert.equal(g2.score.total, 1000);
  assert.equal(g2.progress.score.sessionBest, 1000);
  assert.equal(g2.progress.score.courses['street-glasswell'], 3500);
  assert.equal(g2.progress.score.missions.m1.done, true);
  assert.equal(g2.score.session, 0, 'a new session starts at zero');
  g2.score.add(50, 'x', 0, 0, true);
  assert.equal(g2.progress.score.sessionBest, 1000, 'not beaten yet');
});

test('economy loads an old save in place and reset clears everything', () => {
  const v1 = { money: 300, owned: ['jet'], medals: { race1: 'gold', hint_car: 'bronze' }, bestTimes: { race1: 70 } };
  const storage = memory(JSON.stringify(v1));
  const g = {
    events: createEvents(),
    player: { x: 0, z: 0 },
    // The shape the game starts with before the save is applied.
    progress: { money: 250, owned: [], medals: {}, bestTimes: {}, stats: { distance: 0, flights: 0, races: 0 }, settings: { master: 0.8 } },
  };
  const medals = g.progress.medals;
  g.economy = createEconomy(g, storage);
  assert.equal(g.progress.money, undefined);
  assert.equal(g.progress.owned, undefined);
  assert.equal(g.progress.score.total, 3000);
  assert.equal(g.progress.medals, medals, 'nested objects kept in place');
  assert.equal(g.progress.medals.hint_car, 'bronze');
  g.score = createScore(g);
  g.economy.reset();
  assert.equal(g.progress.score.total, 0);
  assert.equal(g.score.total, 0);
  assert.deepEqual(g.progress.medals, {});
  assert.equal(JSON.parse(storage.getItem(SAVE_KEY)).score.total, 0);
  assert.deepEqual(loadProgress(storage), defaultProgress());
});

test('premium craft are at their berths from the start', () => {
  const city = generateCity();
  const added = [];
  const game = {
    city, events: createEvents(), rng: createRng(7), progress: defaultProgress(),
    player: { x: 0, z: 0, vehicle: null },
    kinds: { boat: {}, plane: {}, heli: {}, car: {} },
    addVehicle(v) { added.push(v); },
    removeVehicle() {},
  };
  const fleet = createFleet(game);
  for (let i = 0; i < 600 && !fleet.ready; i++) fleet.fixedUpdate(1 / 60);
  assert.ok(fleet.ready, 'every berth filled within ten seconds');
  const specs = new Set(added.map((v) => v.spec.id));
  for (const id of PREMIUM) {
    const wanted = [...city.aircraftSpots, ...city.boatSpots].some((s) => s.spec === id);
    assert.ok(wanted, `${id} has a berth`);
    assert.ok(specs.has(id), `${id} is placed with nothing bought`);
  }
});
