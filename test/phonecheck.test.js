import test from 'node:test';
import assert from 'node:assert/strict';
import { generateCity } from '../src/world/citygen.js';
import { createVehicle, stepVehicle } from '../src/entities/vehicle.js';
import { createInput } from '../src/core/input.js';
import { createRng } from '../src/core/rng.js';
import {
  frameStats, formatResult, RESULT_RE, createSystemTimer, buildRoute, createDriver, createCheckRun, SOUNDS, findLabStreet, createLabDrive,
} from '../src/ui/phonecheck.js';
import { makeFightGame, cityAndCollision } from './fightgame.js';

const DT = 1 / 60;

test('frame statistics: median, worst, frames over 33 ms', () => {
  const s = frameStats([16.6, 16.7, 16.8, 40, 17, 33.5, 16.9]);
  assert.equal(s.frames, 7);
  assert.ok(Math.abs(s.median - 16.9) < 1e-9);
  assert.equal(s.worst, 40);
  assert.equal(s.over33, 2);
  assert.deepEqual(frameStats([]), { median: 0, worst: 0, over33: 0, frames: 0 });
  assert.equal(frameStats([10, 20]).median, 15);
});

test('result line: one ASCII line in the agreed format', () => {
  const line = formatResult({
    version: '0.5.0', w: 915, h: 412, insets: { l: 40, r: 0, t: 0, b: 0 }, median: 16.7, worst: 48.25, over33: 3,
    scale: 0.85, fullscreen: true, bad: [5, 2], startMs: 4630, map: 'miami-downtown', memMb: 255.4, worstSystem: { name: 'parked', ms: 7.34 },
  });
  assert.match(line, RESULT_RE);
  assert.equal(line, 'RW 0.5.0 | 915x412 inset L40 R0 T0 B0 | median 16.7 ms worst 48.3 ms | over33 3 | res 0.85 | start 4.6 s | map miami-downtown | mem 255 MB | slowsys parked 7.3 ms | fullscreen yes | bad 2,5 | handling standard none');
  const none = formatResult({ version: 'dev', w: 780, h: 360, median: 8.3, worst: 9, over33: 0, scale: 1, fullscreen: false, bad: [] });
  assert.match(none, RESULT_RE);
  assert.ok(none.endsWith('fullscreen no | bad none | handling standard none'));
  assert.ok(none.includes('| start n/a | map n/a | mem n/a | slowsys n/a |'), none);
  // Names are cleaned to plain ASCII so the line always matches.
  const odd = formatResult({ version: 'dev', w: 780, h: 360, median: 8.3, worst: 9, over33: 0, scale: 1, fullscreen: false, bad: [], map: 'mi ami\u2014-x', worstSystem: { name: 'a b', ms: 1 } });
  assert.match(odd, RESULT_RE);
  assert.ok(/\| map miami-x \| mem n\/a \| slowsys ab 1\.0 ms \|/.test(odd), odd);
  assert.ok(!/[\u2013\u2014\n]/.test(line + none), 'no dashes, no newline');
});

test('result line: the Handling lab preset and verdict close the line, bad values read as standard none', () => {
  const base = { version: 'dev', w: 748, h: 360, median: 8.3, worst: 9, over33: 0, scale: 1, fullscreen: false, bad: [1] };
  const a = formatResult({ ...base, handlingPreset: 'sharp', handlingVerdict: 'twitchy' });
  assert.match(a, RESULT_RE);
  assert.ok(a.endsWith('| bad 1 | handling sharp twitchy'), a);
  for (const [p, v] of [['relaxed', 'heavy'], ['standard', 'wide'], ['sharp', 'right']]) {
    assert.match(formatResult({ ...base, handlingPreset: p, handlingVerdict: v }), RESULT_RE);
  }
  const bad = formatResult({ ...base, handlingPreset: 'x y\n', handlingVerdict: 9 });
  assert.match(bad, RESULT_RE);
  assert.ok(bad.endsWith('| handling standard none'), bad);
  assert.doesNotMatch('RW d | 1x1 | handling sharp twitchy', RESULT_RE);
});

test('lab street: the nearest straight street of 120 m or more, no bridge, deterministic', () => {
  const { city } = cityAndCollision();
  const a = findLabStreet(city, 0, 0);
  assert.ok(a && a.run >= 60, JSON.stringify(a));
  assert.deepEqual(a, findLabStreet(city, 0, 0));
  const e = city.edges[a.edge];
  assert.ok(e.length >= 80 && !e.bridge && !e.causeway);
  const n = city.nodes[e.a];
  assert.ok(Math.hypot(a.x - n.x, a.z - n.z) <= 20.01);
  assert.equal(findLabStreet({ nodes: [], edges: [] }, 0, 0), null);
  assert.equal(findLabStreet(null, 0, 0), null);
});

test('lab test drive: sedan on the street, traffic near it removed, player put back', () => {
  const game = checkGame();
  const { city } = cityAndCollision();
  game.player.x = game.player.walker.x = city.nodes[3].x;
  game.player.z = game.player.walker.z = city.nodes[3].z;
  const home = { x: game.player.walker.x, z: game.player.walker.z };
  const lab = createLabDrive(game, null, {});
  assert.equal(lab.start(), true, lab.error);
  assert.equal(game.player.mode, 'car');
  assert.equal(game.player.vehicle.kind, 'car');
  const car = lab.car;
  assert.equal(car, game.player.vehicle);
  const st = findLabStreet(city, home.x, home.z);
  assert.equal(car.x, st.x);
  assert.equal(car.heading, st.heading);
  // a traffic car near the street is cleared by the system step; a far one stays
  const near = game.debug.spawnCar('sedan', car.x + 40, car.z, 0);
  near.traffic = true;
  const far = game.debug.spawnCar('sedan', car.x + 900, car.z, 0);
  far.traffic = true;
  for (const sys of game.systems || []) if (sys.name === 'handlinglab') sys.fixedUpdate(DT);
  lab.finish();
  assert.equal(game.player.vehicle, null, 'back on foot');
  assert.equal(game.player.walker.x, home.x);
  assert.equal(game.vehicles.includes(car), false);
  assert.equal(lab.isActive(), false);
  lab.finish(); // idempotent
});

test('the route is fixed: the same start gives the same points, and it is long enough', () => {
  const { city } = cityAndCollision();
  const a = buildRoute(city, 0, 0, 900);
  const b = buildRoute(city, 0, 0, 900);
  assert.deepEqual(a, b);
  let len = 0;
  for (let i = 1; i < a.length; i++) len += Math.hypot(a[i].x - a[i - 1].x, a[i].z - a[i - 1].z);
  assert.ok(len >= 900, `route ${len.toFixed(0)} m`);
});

// A game double on the real city: the player, a car on the real vehicle physics, the real combat.
function checkGame() {
  const game = makeFightGame({ seed: 5 });
  game.input = createInput();
  game.audio = { station: 'off', setStation(id) { this.station = id; this.log.push(id); }, log: [] };
  game.hud.toast = () => {};
  game.setPlayerMode = (m) => { game.player.mode = m; };
  game.enterVehicle = (v) => { game.player.vehicle = v; v.driver = 'player'; v.parked = false; game.setPlayerMode('car'); };
  game.exitVehicle = () => { const v = game.player.vehicle; if (!v) return false; v.driver = null; game.player.vehicle = null; game.setPlayerMode('foot'); return true; };
  const rng = createRng(3);
  game.debug = {
    spawnCar: (id, x, z, h) => game.addVehicle(createVehicle(id, x, z, h, rng)),
    spawnOccupied(id, x, z, h) { const v = game.debug.spawnCar(id, x, z, h); v.driver = { dead: false, debug: true }; v.controls = { steer: 0, throttle: 0, brake: 1, handbrake: true }; return v; },
  };
  game.events.log = [];
  for (const n of ['shot', 'explosion', 'siren', 'boost']) game.events.on(n, (e) => game.events.log.push([n, e]));
  return game;
}

test('a short check runs: drives the route, fights, blasts, plays the eight sounds, restores the player, prints the line', () => {
  const game = checkGame();
  const { city } = cityAndCollision();
  game.player.x = game.player.walker.x = city.nodes[3].x;
  game.player.z = game.player.walker.z = city.nodes[3].z;
  const run = createCheckRun(game, { driveSeconds: 6, soundSeconds: 0.5, source: game.input.addSource({ steer: 0, throttle: 0, brake: 0, handbrake: false }) });
  const home = { x: game.player.walker.x, z: game.player.walker.z }; // read before start() moves the player
  assert.equal(run.start(), true);
  assert.equal(game.player.mode, 'car');
  const car = run.car;
  let moved = 0, lastX = car.x, lastZ = car.z, steps = 0;
  while (run.phase !== 'done' && steps < 60 * 30) {
    game.input.poll();
    car.controls = { steer: game.input.steer, throttle: game.input.throttle, brake: game.input.brake, handbrake: game.input.handbrake };
    stepVehicle(car, car.controls, DT, game.world);
    for (const v of game.vehicles) if (v !== car && v.driver && v.driver.debug) stepVehicle(v, v.controls, DT, game.world);
    run.step(DT);
    run.feedFrame(16 + (steps % 7)); // a made-up frame time for each step
    moved += Math.hypot(car.x - lastX, car.z - lastZ);
    lastX = car.x; lastZ = car.z;
    game.combat.fixedUpdate(DT);
    game.input.endStep();
    steps++;
  }
  assert.equal(run.phase, 'done', 'the check ended');
  assert.ok(moved > 25, `the car drove ${moved.toFixed(0)} m by itself`);
  assert.ok(run.fixtures >= 1, 'the fight and the blast fixtures were placed');
  const names = new Set(game.events.log.map((e) => e[0]));
  for (const n of ['shot', 'explosion', 'siren', 'boost']) assert.ok(names.has(n), `the ${n} hook fired`);
  assert.ok(game.audio.log.length >= 2, 'the radio test changed the station and put it back');
  assert.equal(game.audio.station, 'off');
  run.mark(3, true);
  run.mark(7, true);
  const line = formatResult(run.result({ version: '0.5.0', w: 915, h: 412, insets: { l: 0, r: 0, t: 0, b: 0 }, scale: 1, startMs: 3200, map: 'miami-downtown', memMb: 160 }));
  assert.match(line, RESULT_RE);
  assert.ok(line.includes('| start 3.2 s | map miami-downtown | mem 160 MB | slowsys '), line);
  assert.ok(line.endsWith('bad 3,7 | handling standard none'), line);
  assert.ok(/median 1\d\.\d ms worst 2\d\.\d ms \| over33 0/.test(line), line);
  run.finish();
  assert.equal(game.player.vehicle, null, 'back on foot');
  assert.equal(game.player.walker.x, home.x);
  assert.equal(game.player.walker.z, home.z);
  assert.equal(game.vehicles.length, 0, 'the test cars are gone');
  assert.equal(SOUNDS.length, 8);
});

test('the scripted driver follows the route for 20 s on the real vehicle physics', () => {
  const city = generateCity();
  const route = buildRoute(city, 0, 0, 800);
  const d = createDriver(route);
  const a = route[0];
  const car = createVehicle('sedan', a.x, a.z, d.heading(), createRng(1));
  const out = { steer: 0, throttle: 0, brake: 0 };
  const { collision } = cityAndCollision();
  const world = { collision, city, crafts: [car], time: 0 };
  let dist = 0, px = car.x, pz = car.z;
  for (let k = 0; k < 60 * 20; k++) {
    d.step(car, out, DT);
    stepVehicle(car, { steer: out.steer, throttle: out.throttle, brake: out.brake, handbrake: false }, DT, world);
    dist += Math.hypot(car.x - px, car.z - pz);
    px = car.x; pz = car.z;
  }
  assert.ok(dist > 120, `drove ${dist.toFixed(0)} m in 20 s`);
});

// Regression: the check drives far from the start, and the car the player
// left there can be swept away (removed, its mesh gone). Getting back into
// it made every later draw throw ("null userData"): stay on foot instead.
test('finish never puts the player back in a car that was removed meanwhile', () => {
  const game = checkGame();
  const { city } = cityAndCollision();
  const n = city.nodes[3];
  const own = game.debug.spawnCar('sedan', n.x, n.z, 0);
  game.player.x = game.player.walker.x = n.x;
  game.player.z = game.player.walker.z = n.z;
  game.enterVehicle(own);
  const entered = [];
  const enter = game.enterVehicle;
  game.enterVehicle = (v) => { entered.push(v); enter(v); };
  const run = createCheckRun(game, { driveSeconds: 6, soundSeconds: 0.5, source: game.input.addSource({ steer: 0, throttle: 0, brake: 0, handbrake: false }) });
  assert.equal(run.start(), true);
  assert.equal(own.driver, null, 'left at the start');
  // Cleared away while the check drives off.
  game.vehicles.splice(game.vehicles.indexOf(own), 1);
  own.removed = true;
  own.mesh = null;
  run.finish();
  assert.ok(!entered.includes(own), 'the removed car is not entered again');
  assert.equal(game.player.vehicle, null, 'on foot');
  assert.equal(game.player.mode, 'foot');
  // The same car still on the map is entered again as before.
  const game2 = checkGame();
  const own2 = game2.debug.spawnCar('sedan', n.x, n.z, 0);
  game2.enterVehicle(own2);
  const run2 = createCheckRun(game2, { driveSeconds: 6, soundSeconds: 0.5, source: game2.input.addSource({ steer: 0, throttle: 0, brake: 0, handbrake: false }) });
  assert.equal(run2.start(), true);
  run2.finish();
  assert.equal(game2.player.vehicle, own2, 'back in the car left at the start');
});

test('the system timer names the slowest single call and puts the methods back', () => {
  let t = 0;
  const ran = [];
  const a = { name: 'traffic', fixedUpdate(dt) { ran.push('a'); t += 2; return dt; } };
  const b = { name: 'parked', fixedUpdate() { ran.push('b'); t += 7; }, always() { t += 1; } };
  const c = { name: 'phonecheck', fixedUpdate() { t += 50; } };
  const origA = a.fixedUpdate, origC = c.fixedUpdate;
  const timer = createSystemTimer([a, b, c], () => t);
  timer.start();
  timer.start(); // a second start does not wrap twice
  a.fixedUpdate(1); b.fixedUpdate(1); b.always(1); c.fixedUpdate(1);
  assert.deepEqual(ran, ['a', 'b']);
  assert.deepEqual(timer.worst(), { name: 'parked', ms: 7 });
  timer.stop();
  assert.equal(a.fixedUpdate, origA);
  assert.equal(c.fixedUpdate, origC);
  assert.deepEqual(createSystemTimer(null).worst(), { name: '', ms: 0 });
});
