import test from 'node:test';
import assert from 'node:assert/strict';
import { generateCity, lanePoint, signalState } from '../src/world/citygen.js';
import { createCollisionWorld } from '../src/world/collision.js';
import { createVehicle, stepVehicle, collideVehicles } from '../src/entities/vehicle.js';
import { createRng } from '../src/core/rng.js';
import { createDriver, placeDriver, driveStep, createTraffic } from '../src/systems/traffic.js';

const DT = 1 / 60;
const city = generateCity();
const collision = createCollisionWorld();
for (const b of city.buildings) collision.addBox(b.x0, b.z0, b.x1, b.z1, b.h, b.kind);

const extAt = (n, e) => (e.horizontal ? n.hx : n.hz);
const otherEnd = (e, from) => (e.a === from ? e.b : e.a);

function makeCar(seed, edgeId, from, d, { lane = -1, spec = 'sedan', speed = 0 } = {}) {
  const rng = createRng(seed);
  const v = createVehicle(spec, 0, 0, 0, rng);
  const dr = createDriver(city, rng);
  placeDriver(dr, v, edgeId, from, d, lane);
  v.vx = Math.cos(v.heading) * speed;
  v.vz = Math.sin(v.heading) * speed;
  v.speed = speed;
  v.ai = dr;
  v.driver = dr;
  return v;
}

// Simulates like the game does: step every awake vehicle, resolve
// car-car contacts, then let the drivers set next step's controls.
function simulate(vehicles, seconds, { t0 = 0, onStep = null } = {}) {
  const world = { collision, city, time: t0 };
  const ctx = { time: t0, vehicles };
  const steps = Math.round(seconds / DT);
  for (let k = 0; k < steps; k++) {
    world.time += DT;
    ctx.time = world.time;
    for (const v of vehicles) {
      if (v.asleep) continue;
      stepVehicle(v, v.ai ? v.controls : null, DT, world);
      if (!v.ai && Math.abs(v.speed) < 0.02 && Math.abs(v.yawRate) < 0.02) v.asleep = true;
    }
    for (let i = 0; i < vehicles.length; i++) {
      for (let j = i + 1; j < vehicles.length; j++) {
        const a = vehicles[i], b = vehicles[j];
        if (a.asleep && b.asleep) continue;
        if (collideVehicles(a, b)) {
          a.asleep = false;
          b.asleep = false;
        }
      }
    }
    if (onStep) onStep(world.time, k);
    for (const v of vehicles) if (v.ai) driveStep(v.ai, v, DT, ctx);
  }
}

const inJunctionZone = (x, z, m = 8) => city.nodes.some((n) => Math.abs(x - n.x) < n.hx + m && Math.abs(z - n.z) < n.hz + m);

// Distance to the nearest lane centre line of any edge.
function laneDist(x, z) {
  let best = Infinity;
  const p = { x: 0, z: 0, heading: 0 };
  for (const e of city.edges) {
    const a = city.nodes[e.a], b = city.nodes[e.b];
    const ux = (b.x - a.x) / e.length, uz = (b.z - a.z) / e.length;
    const t = (x - a.x) * ux + (z - a.z) * uz;
    if (t < 0 || t > e.length) continue;
    for (const from of [e.a, e.b]) {
      const d = from === e.a ? t : e.length - t;
      for (let l = 0; l < (e.avenue ? 2 : 1); l++) {
        lanePoint(city, e, from, d, l, p);
        best = Math.min(best, Math.hypot(x - p.x, z - p.z));
      }
    }
  }
  return best;
}

const central = (filter) =>
  city.edges
    .filter((e) => !e.causeway && filter(e))
    .map((e) => {
      const a = city.nodes[e.a], b = city.nodes[e.b];
      return { e, r: Math.hypot((a.x + b.x) / 2, (a.z + b.z) / 2) };
    })
    .sort((p, q) => p.r - q.r)
    .map((p) => p.e);

test('an AI car follows its lane through junctions without hitting anything', () => {
  const e = central((x) => !x.avenue && x.length > 80)[0];
  const v = makeCar(11, e.id, e.a, extAt(city.nodes[e.a], e) + 10, { speed: 8 });
  let maxSpeed = 0, maxDev = 0, maxImpact = 0;
  simulate([v], 60, {
    onStep() {
      maxSpeed = Math.max(maxSpeed, Math.abs(v.speed));
      maxImpact = Math.max(maxImpact, v.impact);
      if (!inJunctionZone(v.x, v.z)) maxDev = Math.max(maxDev, laneDist(v.x, v.z));
    },
  });
  assert.equal(maxImpact, 0, 'touched a building');
  assert.ok(maxDev < 3, `lane deviation ${maxDev.toFixed(2)} m`);
  assert.ok(v.ai.junctions >= 3, `passed ${v.ai.junctions} junctions`);
  assert.ok(maxSpeed <= 20, `max speed ${maxSpeed.toFixed(1)}`);
  assert.ok(!v.ai.stuck && !v.ai.dead);
});

test('stops for a red light and goes on green', () => {
  // A signalled junction approached along a long edge.
  let T = null, E = null;
  for (const n of city.nodes) {
    if (!n.signal) continue;
    E = n.edges.map((id) => city.edges[id]).find((e) => e.length > 85 && !e.causeway);
    if (E) {
      T = n;
      break;
    }
  }
  assert.ok(T, 'found a signalled junction');
  const F = city.nodes[otherEnd(E, T.id)];
  // Start just as the light turns red for this approach.
  let t0 = 0;
  while (!(signalState(T, E.horizontal, t0) === 'red' && signalState(T, E.horizontal, t0 - 0.05) === 'amber')) t0 += 0.05;
  const v = makeCar(5, E.id, F.id, extAt(F, E) + 8, { speed: 6 });
  const ux = (T.x - F.x) / E.length, uz = (T.z - F.z) / E.length;
  const boxEdge = E.length - extAt(T, E);
  let maxFrontRed = -Infinity, minSpeedRed = Infinity, passedOnGreen = false, maxImpact = 0;
  simulate([v], 26, {
    t0,
    onStep(time) {
      const front = (v.x - F.x) * ux + (v.z - F.z) * uz + v.spec.length / 2;
      const light = signalState(T, E.horizontal, time);
      maxImpact = Math.max(maxImpact, v.impact);
      if (light === 'red' && v.ai.junctions === 0) {
        maxFrontRed = Math.max(maxFrontRed, front);
        if (front > boxEdge - 12) minSpeedRed = Math.min(minSpeedRed, Math.abs(v.speed));
      }
      if (light === 'green' && v.ai.junctions > 0) passedOnGreen = true;
    },
  });
  assert.ok(maxFrontRed < boxEdge, `front reached ${(maxFrontRed - boxEdge).toFixed(2)} m past the box edge`);
  assert.ok(minSpeedRed < 0.3, `slowest while red ${minSpeedRed.toFixed(2)} m/s`);
  assert.ok(passedOnGreen, 'went through on green');
  assert.equal(maxImpact, 0);
});

test('stops behind a stationary car in its lane without hitting it', () => {
  const e = central((x) => !x.avenue && x.length > 90)[0];
  const from = e.a;
  const d0 = extAt(city.nodes[from], e) + 6;
  const v = makeCar(3, e.id, from, d0, { lane: 0, speed: 10 });
  const p = lanePoint(city, e, from, d0 + 30, 0);
  const block = createVehicle('sedan', p.x, p.z, p.heading);
  let maxImpact = 0;
  simulate([v, block], 9, { onStep() { maxImpact = Math.max(maxImpact, v.impact, block.impact); } });
  const gap = Math.hypot(block.x - v.x, block.z - v.z) - v.spec.length / 2 - block.spec.length / 2;
  assert.equal(maxImpact, 0, 'hit the stopped car');
  assert.ok(Math.abs(v.speed) < 0.3, `still moving at ${v.speed.toFixed(2)}`);
  assert.ok(gap > 0.5 && gap < 8, `gap ${gap.toFixed(2)} m`);
  // After waiting a while it backs up a little and steers round it.
  simulate([v, block], 25, { onStep() { maxImpact = Math.max(maxImpact, v.impact, block.impact); } });
  assert.ok(maxImpact < 2, `impact while passing ${maxImpact.toFixed(2)}`);
  const past = (v.x - block.x) * Math.cos(block.heading) + (v.z - block.z) * Math.sin(block.heading);
  assert.ok(past > 5, `got ${past.toFixed(1)} m past it`);
});

function crowd(seed) {
  const rng = createRng(seed);
  const edges = central((e) => e.length > 80).slice(0, 40);
  const cars = [];
  for (let k = 0; k < 8; k++) {
    const e = edges[(k * 5 + rng.int(0, 4)) % edges.length];
    const from = rng.next() < 0.5 ? e.a : e.b;
    const v = makeCar(seed * 31 + k, e.id, from, extAt(city.nodes[from], e) + 10 + rng.range(0, 20), {
      speed: 6, spec: k % 4 === 3 ? 'truck' : 'sedan',
    });
    if (cars.some((o) => Math.hypot(o.x - v.x, o.z - v.z) < 12)) continue;
    cars.push(v);
  }
  // Parked cars along the kerbs nearby, asleep until touched.
  const parked = city.parkingSpots
    .filter((s) => !s.lot && Math.hypot(s.x, s.z) < 320)
    .map((s, i) => {
      const v = createVehicle(i % 7 === 0 ? 'pickup' : 'compact', s.x, s.z, s.heading);
      v.asleep = true;
      return v;
    });
  return { cars, all: [...cars, ...parked] };
}

test('eight AI cars drive together for two minutes without crashing', () => {
  const { cars, all } = crowd(7);
  assert.ok(cars.length >= 7);
  let maxImpact = 0;
  simulate(all, 120, {
    onStep() {
      for (const v of cars) {
        if (v.impact > maxImpact) maxImpact = v.impact;
        assert.ok(Number.isFinite(v.x + v.z + v.heading + v.speed), 'NaN');
      }
    },
  });
  assert.ok(maxImpact <= 2, `collision at ${maxImpact.toFixed(2)} m/s`);
  const moved = cars.reduce((n, v) => n + v.ai.junctions, 0);
  assert.ok(moved >= cars.length * 3, `junctions passed ${moved}`);
});

test('same seed gives the same result', () => {
  const run = () => {
    const { cars, all } = crowd(21);
    simulate(all, 30);
    return cars.map((v) => [v.x, v.z, v.heading]);
  };
  assert.deepEqual(run(), run());
});

test('traffic system spawns around the player and despawns far cars', () => {
  const vehicles = [];
  const game = {
    city, collision, vehicles, rng: createRng(9), time: 0, quality: 1,
    player: { x: city.spawn.x, z: city.spawn.z, y: 0, heading: 0, vehicle: null },
    addVehicle(v) {
      vehicles.push(v);
    },
    removeVehicle(v) {
      vehicles.splice(vehicles.indexOf(v), 1);
      v.removed = true;
    },
  };
  const traffic = createTraffic(game, { max: 6 });
  const world = { collision, city, time: 0 };
  let minSpawn = Infinity;
  for (let k = 0; k < 60 * 6; k++) {
    game.time += DT;
    world.time = game.time;
    for (const v of vehicles) stepVehicle(v, v.controls, DT, world);
    const before = vehicles.length;
    traffic.fixedUpdate(DT);
    for (let i = before; i < vehicles.length; i++) {
      const v = vehicles[i];
      minSpawn = Math.min(minSpawn, Math.hypot(v.x - game.player.x, v.z - game.player.z));
      assert.ok(v.traffic && v.ai && !v.asleep && v.controls);
    }
  }
  assert.ok(traffic.count > 0 && traffic.count <= 6, `count ${traffic.count}`);
  assert.ok(minSpawn >= 90, `spawned ${minSpawn.toFixed(0)} m away`);
  // The player steals one: it is no longer managed.
  const stolen = traffic.cars[0];
  stolen.driver = 'player';
  traffic.fixedUpdate(DT);
  assert.ok(!traffic.cars.includes(stolen) && !stolen.ai && !stolen.controls);
  // Far away out at sea: everything else is despawned, nothing spawns.
  game.player.x = 0;
  game.player.z = -1400;
  for (let k = 0; k < 120; k++) traffic.fixedUpdate(DT);
  assert.equal(traffic.count, 0);
});
