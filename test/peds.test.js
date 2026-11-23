import test from 'node:test';
import assert from 'node:assert/strict';
import { generateCity } from '../src/world/citygen.js';
import { createCollisionWorld } from '../src/world/collision.js';
import { createRng } from '../src/core/rng.js';
import { createVehicle, stepVehicle } from '../src/entities/vehicle.js';
import fs from 'node:fs';
import { createMiamiCity } from '../src/world/miami.js';
import { createPed, placePed, stepPed, createPeds, crowdAt } from '../src/systems/peds.js';
import { createTraffic, createDriver, placeDriver } from '../src/systems/traffic.js';
import { makeFightGame, step as fightStep, cityAndCollision } from './fightgame.js';

const DT = 1 / 60;
const city = generateCity();
const collision = createCollisionWorld();
for (const b of city.buildings) collision.addBox(b.x0, b.z0, b.x1, b.z1, b.h);

const plain = city.blocks.filter((b) => b.district !== 'park' && b.district !== 'airfield');
const smallest = plain.reduce((a, b) => ((a.x1 - a.x0 + a.z1 - a.z0) < (b.x1 - b.x0 + b.z1 - b.z0) ? a : b));
const biggest = plain.reduce((a, b) => ((a.x1 - a.x0) * (a.z1 - a.z0) > (b.x1 - b.x0) * (b.z1 - b.z0) ? a : b));

const makeCtx = (vehicles = []) => ({ city, collision, vehicles, player: { x: 1e5, z: 1e5, y: 0, vehicle: null } });
const inBlock = (b, p) => p.x > b.x0 && p.x < b.x1 && p.z > b.z0 && p.z < b.z1;

test('a ped strolls a block loop, stays on the sidewalk and comes back', () => {
  const rng = createRng(5);
  const ped = createPed(rng);
  ped.dir = 1;
  placePed(ped, smallest, rng, 'loop');
  const sx = ped.x, sz = ped.z;
  const per = 2 * (smallest.x1 - smallest.x0 - 4 + smallest.z1 - smallest.z0 - 4);
  const ctx = makeCtx();
  let lapDone = false;
  // 120 s of walking, then on until one full lap has been covered
  // (a block loop is longer than 120 s of strolling).
  for (let i = 0; i < 60 * 900 && !lapDone; i++) {
    stepPed(ped, DT, ctx);
    assert.ok(inBlock(smallest, ped), `left block at step ${i}`);
    assert.equal(city.onRoad(ped.x, ped.z), false, `on road at step ${i}`);
    if (ped.travel >= per) lapDone = true;
  }
  assert.ok(lapDone, 'finished a lap');
  assert.ok(Math.hypot(ped.x - sx, ped.z - sz) < 2.5, `back near start: ${Math.hypot(ped.x - sx, ped.z - sz)}`);
});

// A car driven straight through the ped's position, kinematically.
function driveAt(angle, withReturn) {
  const rng = createRng(11 + Math.round(angle * 10));
  const ped = createPed(rng);
  placePed(ped, biggest, rng, 'loop');
  ped.nextPause = 1e9;
  const px = ped.x, pz = ped.z;
  const car = createVehicle('sedan', px - Math.cos(angle) * 70, pz - Math.sin(angle) * 70, angle, rng);
  car.vx = Math.cos(angle) * 20;
  car.vz = Math.sin(angle) * 20;
  car.speed = 20;
  const ctx = makeCtx([car]);
  const lim = car.radius * 0.5 + 0.35;
  let minD = Infinity, startled = 0;
  const steps = 60 * 8;
  for (let i = 0; i < steps; i++) {
    car.x += car.vx * DT;
    car.z += car.vz * DT;
    stepPed(ped, DT, ctx);
    if (ped.startled) startled++;
    minD = Math.min(minD, Math.hypot(car.x - ped.x, car.z - ped.z));
  }
  assert.ok(minD >= lim, `angle ${angle.toFixed(2)}: closest ${minD.toFixed(2)} < ${lim.toFixed(2)}`);
  assert.ok(startled >= 1, 'ped reacted');
  if (withReturn) {
    // Car has long gone; the ped should get back onto the sidewalk.
    car.vx = car.vz = 0;
    car.x = car.z = 1e5;
    for (let i = 0; i < 60 * 15; i++) stepPed(ped, DT, ctx);
    assert.ok(inBlock(biggest, ped) && !city.onRoad(ped.x, ped.z), `angle ${angle.toFixed(2)} not back on sidewalk`);
    assert.notEqual(ped.state, 'fleeing');
  }
}

test('peds dodge a car driven straight at them from 8 directions', () => {
  for (let k = 0; k < 8; k++) driveAt((k * Math.PI) / 4, false);
});

test('after dodging a ped is back on the sidewalk within 15 s', () => {
  for (let k = 0; k < 8; k++) driveAt((k * Math.PI) / 4 + 0.2, true);
});

test('a stopped car on top of a ped pushes it out', () => {
  const rng = createRng(3);
  const ped = createPed(rng);
  placePed(ped, biggest, rng, 'loop');
  ped.nextPause = 1e9;
  const car = createVehicle('truck', ped.x + 0.2, ped.z, 0, rng);
  const ctx = makeCtx([car]);
  for (let i = 0; i < 120; i++) stepPed(ped, DT, ctx);
  const d = Math.hypot(ped.x - car.x, ped.z - car.z);
  assert.ok(d >= car.radius * 0.6 + 0.3, `still inside: ${d}`);
});

test('no NaN over 5000 steps with random vehicles moving about', () => {
  const rng = createRng(99);
  const peds = [];
  for (let i = 0; i < 12; i++) {
    const p = createPed(rng);
    placePed(p, plain[i % plain.length], rng, i % 4 === 0 ? 'chat' : 'loop');
    peds.push(p);
  }
  const cars = [];
  for (let i = 0; i < 6; i++) {
    const b = plain[i % plain.length];
    const c = createVehicle('sedan', (b.x0 + b.x1) / 2, (b.z0 + b.z1) / 2, rng.range(0, 6), rng);
    c.speed = rng.range(0, 25);
    cars.push(c);
  }
  const ctx = makeCtx(cars);
  for (let i = 0; i < 5000; i++) {
    for (const c of cars) {
      if (i % 120 === 0) c.heading += rng.range(-1, 1);
      c.vx = Math.cos(c.heading) * c.speed;
      c.vz = Math.sin(c.heading) * c.speed;
      c.x += c.vx * DT;
      c.z += c.vz * DT;
    }
    for (const p of peds) {
      stepPed(p, DT, ctx);
      assert.ok(Number.isFinite(p.x + p.z + p.heading + p.stride + p.speed), `NaN at ${i}`);
    }
  }
});

// --- Drivers who bail out (task 27) ---

function trafficCar(game, sys, along = 30) {
  const { city: c } = cityAndCollision();
  const e = c.edges.find((x) => !x.causeway && x.length > 80 && Math.hypot(c.nodes[x.a].x - game.player.x, c.nodes[x.a].z - game.player.z) < 120);
  const dr = createDriver(c, game.rng);
  const v = createVehicle('sedan', 0, 0, 0);
  placeDriver(dr, v, e.id, e.a, along, 0);
  v.controls = { steer: 0, throttle: 0, brake: 0, handbrake: false };
  v.ai = dr;
  v.driver = dr;
  v.traffic = true;
  v.asleep = false;
  game.addVehicle(v);
  sys.cars.push(v);
  return v;
}

test('a shot traffic car stops; the driver gets out and runs as a ped', () => {
  const { city: c } = cityAndCollision();
  const game = makeFightGame({ px: c.spawn.x, pz: c.spawn.z, seed: 2 });
  game.peds = createPeds(game);
  const traffic = createTraffic(game, { max: 0 });
  const v = trafficCar(game, traffic);
  v.vx = Math.cos(v.heading) * 10;
  v.vz = Math.sin(v.heading) * 10;
  v.speed = 10;
  let bailed = 0;
  game.events.on('driverBailed', () => bailed++);
  fightStep(game, [game.peds, traffic], 30, (g) => { for (const o of g.vehicles) stepVehicle(o, o.controls, DT, g.world); });
  assert.equal(bailed, 0);
  game.combat.damage(v, 30, game.player.walker, 'bullet');
  let t = 0;
  while (!bailed && t < 600) {
    fightStep(game, [game.peds, traffic], 1, (g) => { for (const o of g.vehicles) stepVehicle(o, o.controls, DT, g.world); });
    t++;
  }
  assert.equal(bailed, 1, 'bailed out');
  assert.ok(Math.abs(v.speed) < 2.5, `stopped first (${v.speed.toFixed(1)} m/s)`);
  assert.equal(v.driver, null);
  assert.ok(v.bailed && !traffic.cars.includes(v));
  const runner = game.peds.slots.map((s) => s.ped).find((p) => p.active && p.state === 'fleeing' && Math.hypot(p.x - v.x, p.z - v.z) < 6);
  assert.ok(runner, 'a fleeing ped next to the car');
  assert.ok(game.actors.includes(runner));
  fightStep(game, [game.peds, traffic], 120);
  assert.ok(Math.hypot(runner.x - v.x, runner.z - v.z) > 5, 'ran off');
});

test('hijack: entering a traffic car with its driver pulls them out; they flee from the player', () => {
  const { city: c } = cityAndCollision();
  const game = makeFightGame({ px: c.spawn.x, pz: c.spawn.z, seed: 3 });
  game.peds = createPeds(game);
  const traffic = createTraffic(game, { max: 0 });
  const v = trafficCar(game, traffic, 40);
  const w = game.player.walker;
  w.x = v.x - Math.sin(v.heading) * 2.5;
  w.z = v.z + Math.cos(v.heading) * 2.5;
  fightStep(game, [game.peds], 40); // fill the ped slots first
  const before = game.peds.slots.filter((s) => s.ped.active).length;
  let bailed = 0;
  game.events.on('driverBailed', () => bailed++);
  // What game.enterVehicle does.
  v.driver = 'player';
  game.player.vehicle = v;
  fightStep(game, [game.peds, traffic], 1);
  assert.equal(bailed, 1);
  assert.ok(!traffic.cars.includes(v) && !v.ai && !v.traffic);
  const runner = game.peds.slots.map((s) => s.ped).find((p) => p.active && p.state === 'fleeing' && p.panicT > 5);
  assert.ok(runner, 'the driver runs');
  assert.ok(game.peds.slots.filter((s) => s.ped.active).length >= Math.min(before, 21));
  // Runs away from where the player stood.
  const d0 = Math.hypot(runner.x - w.x, runner.z - w.z);
  fightStep(game, [game.peds], 90);
  assert.ok(Math.hypot(runner.x - w.x, runner.z - w.z) > d0 + 3);
  // A parked car (no driver) gives no runner.
  const parked = createVehicle('sedan', v.x + 20, v.z, 0);
  game.addVehicle(parked);
  parked.driver = 'player';
  game.player.vehicle = parked;
  fightStep(game, [game.peds, traffic], 2);
  assert.equal(bailed, 1);
});

// ---------------------------------------------------------------------
// Street life (docs/PLAN_V1.md W8): people on sidewalks and plazas by
// district and hour, on the real Miami map.
// ---------------------------------------------------------------------
const miami = createMiamiCity(JSON.parse(fs.readFileSync(new URL('../src/world/data/miami.json', import.meta.url), 'utf8')));
const miamiCol = createCollisionWorld();
for (const b of miami.buildings) miamiCol.addBox(b.x0, b.z0, b.x1, b.z1, b.h, b.kind);

const FIVE_SPOTS = {
  'start street': miami.startView.spawn,
  'Tidewater Arena': { x: -749, z: -204 },
  'Brickell Twin Spires': { x: -1216, z: 1458 },
  'Opal Opera House': { x: -802, z: -1053 },
  'Bayfront Sail': { x: -700, z: 650 },
};

function crowdGame(at, clock, seed = 5) {
  return {
    city: miami, collision: miamiCol, rng: createRng(seed), vehicles: [], actors: [], time: 0, clock, quality: 1,
    player: { x: at.x, z: at.z, y: 0, heading: 0, vehicle: null }, events: { emit() {}, on() {} },
  };
}
function walkersNear(g, peds, r) {
  let n = 0;
  for (const s of peds.slots) if (s.ped.active && Math.hypot(s.ped.x - g.player.x, s.ped.z - g.player.z) < r) n++;
  return n;
}

test('crowd by hour: centers peak at lunch, the beach in the afternoon, nobody at night', () => {
  assert.ok(crowdAt('downtown', 13) > crowdAt('downtown', 3) * 5);
  assert.ok(crowdAt('beach', 14) > crowdAt('beach', 22) * 4);
  assert.ok(crowdAt('residential', 7) > crowdAt('residential', 14) * 1.2, 'homes busiest in the morning rush');
  assert.ok(crowdAt('docks', 10) > crowdAt('docks', 21) * 5);
  assert.equal(crowdAt('airfield', 12), 0);
  assert.ok(Math.abs(crowdAt('downtown', 23.5) - crowdAt('downtown', -0.5)) < 1e-9, 'the clock wraps');
});

test('at 14:00 at least 8 walkers within 80 m of the camera at five named spots', () => {
  for (const [name, at] of Object.entries(FIVE_SPOTS)) {
    const g = crowdGame(at, 14);
    const peds = createPeds(g);
    for (let i = 0; i < 600; i++) peds.fixedUpdate(DT);
    const n = walkersNear(g, peds, 80);
    assert.ok(n >= 8, `${name}: ${n} walkers within 80 m`);
  }
});

test('street life is deterministic and thins out at night', () => {
  const at = FIVE_SPOTS['start street'];
  const run = (clock) => {
    const g = crowdGame(at, clock);
    const peds = createPeds(g);
    for (let i = 0; i < 300; i++) peds.fixedUpdate(DT);
    return { n: peds.count, pos: peds.slots.filter((s) => s.ped.active).map((s) => [Math.round(s.ped.x), Math.round(s.ped.z)]) };
  };
  const day = run(14), again = run(14), night = run(3);
  assert.deepEqual(again, day);
  assert.ok(night.n * 2 <= day.n, `night ${night.n} vs day ${day.n}`);
});

test('sidewalk walkers keep off the road and out of buildings, and a teleport refills the crowd', () => {
  const g = crowdGame(FIVE_SPOTS['Opal Opera House'], 14);
  const peds = createPeds(g);
  let bad = 0, seen = 0;
  for (let i = 0; i < 60 * 40; i++) {
    peds.fixedUpdate(DT);
    if (i % 60 !== 59) continue;
    for (const s of peds.slots) {
      if (!s.ped.active) continue;
      seen++;
      if (miami.inBuilding(s.ped.x, s.ped.z, 0) || miami.onRoad(s.ped.x, s.ped.z)) bad++;
    }
  }
  assert.ok(seen > 200, `${seen} samples`);
  assert.ok(bad <= seen * 0.03, `${bad} of ${seen} samples on a road or in a building`);
  // Teleport 1.5 km: the crowd is around the new spot within a second.
  const to = FIVE_SPOTS['Brickell Twin Spires'];
  g.player.x = to.x;
  g.player.z = to.z;
  for (let i = 0; i < 60; i++) peds.fixedUpdate(DT);
  assert.ok(walkersNear(g, peds, 80) >= 8, `${walkersNear(g, peds, 80)} walkers after a teleport`);
});
