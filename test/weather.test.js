import test from 'node:test';
import assert from 'node:assert/strict';
import {
  wetGrip, wetBrake, wetUnderSteer, wetTopSpeed, windPush, lightnessOfMass, fogSightScale, fogSightFactor,
} from '../src/core/weather.js';
import { createVehicle, stepVehicle } from '../src/entities/vehicle.js';
import { createCollisionWorld } from '../src/world/collision.js';

test('wet factors are 1 when dry, monotonic and bounded', () => {
  for (const f of [wetGrip, wetBrake, wetUnderSteer, wetTopSpeed]) {
    assert.equal(f(0), 1);
    let prev = 1;
    for (let r = 0; r <= 1.0001; r += 0.05) {
      const x = f(r);
      assert.ok(x <= prev + 1e-12 && x >= 0.6 && x <= 1);
      prev = x;
    }
    assert.equal(f(-3), 1);
    assert.equal(f(9), f(1));
  }
  assert.equal(wetTopSpeed(0.6), 1);
  assert.ok(wetTopSpeed(1) < 1);
});

test('wind push is zero in calm, bounded and heavier craft feel less', () => {
  const o = { x: 0, z: 0 };
  assert.equal(windPush(3, 1, 1, 0, o), 0);
  assert.equal(o.x, 0);
  for (let w = 0; w < 40; w += 2) {
    const m = windPush(w, 0.7, 1, w, o);
    assert.ok(m >= 0 && m <= 0.9 + 1e-9);
    assert.ok(Math.abs(Math.hypot(o.x, o.z) - m) < 1e-9);
  }
  assert.equal(windPush(12, 0, 0, 0, o), 0);
  assert.ok(lightnessOfMass(1000) > lightnessOfMass(1600));
  assert.equal(lightnessOfMass(2200), 0);
});

test('fog shortens sight monotonically', () => {
  assert.equal(fogSightScale(0), 1);
  let prev = 1;
  for (let f = 0; f <= 1.001; f += 0.1) {
    const s = fogSightScale(f);
    assert.ok(s <= prev && s >= 0.4);
    prev = s;
  }
  assert.ok(fogSightFactor(0, 50, 90) > fogSightFactor(1, 50, 90));
  assert.ok(fogSightFactor(0.5, 20, 90) > fogSightFactor(0.5, 60, 90));
  assert.equal(fogSightFactor(1, 90, 90), 0);
});

test('rain lengthens the stop; clear weather matches no weather', () => {
  const stop = (weather) => {
    const v = createVehicle('sedan', 0, 0, 0);
    const world = { collision: createCollisionWorld(), weather };
    v.vx = 30;
    for (let i = 0; i < 600; i++) {
      stepVehicle(v, { throttle: 0, brake: 1, steer: 0 }, 1 / 60, world);
      if (v.vx < 0.1) break;
    }
    return v.x;
  };
  const none = stop(null);
  assert.equal(stop({ rain: 0, wind: 3, windDir: 0 }), none);
  assert.ok(stop({ rain: 1, wind: 3, windDir: 0 }) > none);
});
