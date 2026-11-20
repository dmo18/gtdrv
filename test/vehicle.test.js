import test from 'node:test';
import assert from 'node:assert/strict';
import {
  VEHICLE_SPECS, createVehicle, stepVehicle, collideVehicles, vehicleCorners, damageVehicle,
} from '../src/entities/vehicle.js';
import { createCollisionWorld } from '../src/world/collision.js';
import { createRng } from '../src/core/rng.js';

const DT = 1 / 60;
const emptyWorld = () => ({ collision: createCollisionWorld() });
const run = (v, controls, steps, world = emptyWorld()) => {
  for (let i = 0; i < steps; i++) stepVehicle(v, controls, DT, world);
};

test('specs are complete and sensible', () => {
  for (const id of ['compact', 'sedan', 'sports', 'muscle', 'pickup', 'van', 'taxi', 'police', 'truck']) {
    const s = VEHICLE_SPECS[id];
    assert.ok(s, id);
    assert.equal(s.id, id);
    for (const k of ['length', 'width', 'height', 'wheelBase', 'mass', 'maxSpeed', 'reverseSpeed', 'accel', 'brake', 'grip', 'steerMax', 'health']) {
      assert.ok(s[k] > 0, `${id}.${k}`);
    }
    assert.ok(s.colors.length > 0);
    assert.ok(['sedan', 'hatch', 'coupe', 'pickup', 'van', 'truck'].includes(s.body));
  }
  assert.ok(VEHICLE_SPECS.sports.maxSpeed > VEHICLE_SPECS.sedan.maxSpeed);
  assert.ok(VEHICLE_SPECS.truck.maxSpeed < VEHICLE_SPECS.sedan.maxSpeed);
  const a = createVehicle('sedan', 0, 0, 0), b = createVehicle('sedan', 0, 0, 0);
  assert.ok(b.id > a.id);
  assert.equal(a.driver, null);
  assert.equal(a.wrecked, false);
});

test('accelerates toward but never exceeds maxSpeed', () => {
  for (const id of ['sedan', 'sports', 'truck']) {
    const v = createVehicle(id, 0, 0, 0);
    const world = emptyWorld();
    let max = 0;
    for (let i = 0; i < 60 * 60; i++) {
      stepVehicle(v, { steer: 0, throttle: 1, brake: 0, handbrake: false }, DT, world);
      max = Math.max(max, v.speed);
      if (i === 60) assert.ok(v.speed > 4, `${id} 1s speed ${v.speed}`);
    }
    assert.ok(max <= v.spec.maxSpeed + 1e-9, `${id} max ${max}`);
    assert.ok(v.speed > v.spec.maxSpeed * 0.9, `${id} final ${v.speed}`);
    assert.ok(v.x > 100);
  }
});

test('brakes to a stop', () => {
  const v = createVehicle('sedan', 0, 0, 0);
  v.vx = 30;
  run(v, { steer: 0, throttle: 0, brake: 1, handbrake: false }, 150);
  // Holding brake keeps going into reverse eventually, so check the stop moment.
  const w = createVehicle('sedan', 0, 0, 0);
  w.vx = 30;
  const world = emptyWorld();
  let steps = 0;
  while (w.speed >= 0 && steps < 600) {
    stepVehicle(w, { steer: 0, throttle: 0, brake: 1, handbrake: false }, DT, world);
    steps++;
  }
  assert.ok(steps < 60 * 4, `stopping took ${steps} steps`);
  assert.ok(w.x < 60, `stopping distance ${w.x}`);
});

test('reverses when brake is held at standstill', () => {
  const v = createVehicle('sedan', 0, 0, 0);
  run(v, { steer: 0, throttle: 0, brake: 1, handbrake: false }, 180);
  assert.ok(v.speed < -2, `speed ${v.speed}`);
  assert.ok(v.speed >= -v.spec.reverseSpeed - 1e-9);
  assert.ok(v.x < -2);
});

test('steering right increases heading, left decreases', () => {
  const right = createVehicle('sedan', 0, 0, 0);
  const left = createVehicle('sedan', 0, 0, 0);
  right.vx = left.vx = 12;
  run(right, { steer: 1, throttle: 0.4, brake: 0, handbrake: false }, 40);
  run(left, { steer: -1, throttle: 0.4, brake: 0, handbrake: false }, 40);
  assert.ok(right.heading > 0.2, `right ${right.heading}`);
  assert.ok(left.heading < -0.2, `left ${left.heading}`);
  // A right turn while facing +x moves toward +z (south).
  assert.ok(right.z > 0.5 && left.z < -0.5);
});

test('handbrake produces more slip than without', () => {
  const maxSlip = (hb) => {
    const v = createVehicle('sedan', 0, 0, 0);
    v.vx = 25;
    const world = emptyWorld();
    let m = 0;
    for (let i = 0; i < 90; i++) {
      stepVehicle(v, { steer: 1, throttle: 0, brake: 0, handbrake: hb }, DT, world);
      m = Math.max(m, v.slip);
    }
    return m;
  };
  const without = maxSlip(false), withHb = maxSlip(true);
  assert.ok(withHb > without + 0.3, `with ${withHb} without ${without}`);
});

test('head-on into a wall at max speed stops outside the wall', () => {
  for (const id of ['sports', 'sedan', 'truck']) {
    const col = createCollisionWorld();
    col.addBox(40, -20, 46, 20, 10);
    const world = { collision: col };
    const v = createVehicle(id, 0, 0, 0);
    v.vx = v.spec.maxSpeed;
    let impact = 0;
    for (let i = 0; i < 180; i++) {
      stepVehicle(v, { steer: 0, throttle: 1, brake: 0, handbrake: false }, DT, world);
      impact = Math.max(impact, v.impact);
      assert.ok(v.x + v.spec.length / 2 <= 40 + 0.35, `${id} front at ${v.x + v.spec.length / 2}`);
    }
    assert.ok(impact > 4, `${id} impact ${impact}`);
    assert.ok(v.health < v.spec.health, `${id} health ${v.health}`);
    assert.ok(Math.abs(v.speed) < 3, `${id} speed ${v.speed}`);
  }
});

test('wrecked car has no throttle', () => {
  const v = createVehicle('compact', 0, 0, 0);
  damageVehicle(v, 1e6);
  assert.equal(v.wrecked, true);
  run(v, { steer: 0, throttle: 1, brake: 0, handbrake: false }, 120);
  assert.ok(Math.abs(v.x) < 1e-6);
});

test('parked car with null controls stays put and coasts to a stop', () => {
  const v = createVehicle('van', 5, 7, 1);
  run(v, null, 300);
  assert.equal(v.x, 5);
  assert.equal(v.z, 7);
  assert.equal(v.heading, 1);
  const c = createVehicle('sedan', 0, 0, 0);
  c.vx = 15;
  run(c, null, 60 * 15);
  assert.equal(c.speed, 0);
  const x = c.x;
  run(c, null, 60);
  assert.equal(c.x, x);
});

test('overlapping vehicles separate and conserve momentum', () => {
  const a = createVehicle('sedan', 0, 0, 0);
  const b = createVehicle('truck', 5, 0.5, 0);
  a.vx = 12;
  const px = a.spec.mass * a.vx + b.spec.mass * b.vx;
  const pz = a.spec.mass * a.vz + b.spec.mass * b.vz;
  assert.equal(collideVehicles(a, b), true);
  const px2 = a.spec.mass * a.vx + b.spec.mass * b.vx;
  const pz2 = a.spec.mass * a.vz + b.spec.mass * b.vz;
  assert.ok(Math.abs(px2 - px) < 1e-6 * Math.abs(px));
  assert.ok(Math.abs(pz2 - pz) < 1e-6 * Math.abs(px));
  assert.ok(a.vx < 12 && b.vx > 0);
  assert.ok(a.impact > 0 && b.impact > 0);
  assert.ok(a.health < a.spec.health);
  for (let i = 0; i < 10; i++) collideVehicles(a, b);
  assert.equal(collideVehicles(a, b), false);
  const far = createVehicle('sedan', 100, 0, 0);
  assert.equal(collideVehicles(a, far), false);
});

test('vehicleCorners spans the body', () => {
  const v = createVehicle('sedan', 10, 0, 0);
  const c = vehicleCorners(v, []);
  assert.ok(Math.abs(c[0] - (10 + v.spec.length / 2)) < 1e-9);
  assert.ok(Math.abs(c[1] - v.spec.width / 2) < 1e-9);
});

test('no NaN after 2000 random-control steps among random boxes', () => {
  const rng = createRng(42);
  const col = createCollisionWorld();
  for (let i = 0; i < 80; i++) {
    const x = rng.range(-150, 150), z = rng.range(-150, 150);
    col.addBox(x, z, x + rng.range(2, 20), z + rng.range(2, 20));
  }
  for (let i = 0; i < 30; i++) col.addCircle(rng.range(-150, 150), rng.range(-150, 150), rng.range(0.2, 1));
  const city = { shoreDist: (x, z) => 180 - Math.hypot(x, z) };
  const world = { collision: col, city };
  const cars = [createVehicle('sports', 0, 0, 0, rng), createVehicle('truck', 10, 3, 1, rng), createVehicle('compact', -8, 2, 2, rng)];
  const ctl = { steer: 0, throttle: 0, brake: 0, handbrake: false };
  for (let i = 0; i < 2000; i++) {
    if (i % 30 === 0) {
      ctl.steer = rng.range(-1, 1);
      ctl.throttle = rng.chance(0.7) ? rng.next() : 0;
      ctl.brake = rng.chance(0.2) ? rng.next() : 0;
      ctl.handbrake = rng.chance(0.15);
    }
    for (const c of cars) stepVehicle(c, ctl, DT, world);
    for (let a = 0; a < cars.length; a++) {
      for (let b = a + 1; b < cars.length; b++) collideVehicles(cars[a], cars[b]);
    }
    for (const c of cars) {
      for (const k of ['x', 'z', 'heading', 'vx', 'vz', 'yawRate', 'speed', 'steer', 'roll', 'pitch', 'wheelSpin', 'slip', 'impact', 'health']) {
        assert.ok(Number.isFinite(c[k]), `step ${i} ${k}=${c[k]}`);
      }
      assert.ok(Math.hypot(c.x, c.z) < 185, `left land ${c.x},${c.z}`);
    }
  }
});
