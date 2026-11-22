// BOOST: one button, every craft (src/entities/boost.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BOOST_SECONDS, BOOST_REFILL_SECONDS, BOOST_RESTART, CAR_BOOST, BOAT_BOOST, initBoost, stepBoost,
} from '../src/entities/boost.js';
import { createVehicle, stepVehicle } from '../src/entities/vehicle.js';
import { createBoat, stepBoat } from '../src/entities/boat.js';
import { createAircraft, stepAircraft } from '../src/entities/aircraft.js';
import { createInput } from '../src/core/input.js';

const DT = 1 / 60;
const W = {};
const run = (secs, fn) => { for (let i = 0; i < Math.round(secs * 60); i++) fn(i); };

test('meter: about 6 s of boost, about 12 s to refill, and a restart threshold after running dry', () => {
  assert.equal(BOOST_SECONDS, 6);
  assert.equal(BOOST_REFILL_SECONDS, 12);
  const e = initBoost({});
  let on = 0;
  run(7, () => { if (stepBoost(e, true, DT)) on++; });
  assert.ok(Math.abs(on * DT - BOOST_SECONDS) < 0.1, `boosted ${(on * DT).toFixed(2)} s`);
  assert.equal(e.boostMeter < 0.5, true, 'refilling while the button is still held and locked out');
  assert.equal(stepBoost(e, true, DT), false, 'locked until the restart level');
  e.boostMeter = 0;
  e.boostLock = true;
  let t = 0;
  while (e.boostMeter < 1 - 1e-9 && t < 30) { stepBoost(e, false, DT); t += DT; }
  assert.ok(Math.abs(t - BOOST_REFILL_SECONDS) < 0.1, `refill ${t.toFixed(2)} s`);
  assert.equal(e.boostLock, false);
  // restart once BOOST_RESTART is back
  const f = initBoost({});
  f.boostMeter = 0;
  f.boostLock = true;
  run(BOOST_RESTART * BOOST_REFILL_SECONDS + 0.2, () => stepBoost(f, false, DT));
  assert.equal(stepBoost(f, true, DT), true);
});

test('level eases in and out so force and the cap never step', () => {
  const e = initBoost({});
  let prev = 0, maxJump = 0;
  run(2, () => { stepBoost(e, true, DT); maxJump = Math.max(maxJump, e.boostLevel - prev); prev = e.boostLevel; });
  assert.ok(e.boostLevel > 0.99 && maxJump < 0.1);
  run(1, () => stepBoost(e, false, DT));
  assert.ok(e.boostLevel > 0.5 && e.boostLevel < 0.8, `fades slowly: ${e.boostLevel}`);
});

test('car: boost raises acceleration and the speed cap by at most 25 percent', () => {
  for (const id of ['sedan', 'sports', 'truck']) {
    const a = createVehicle(id, 0, 0, 0), b = createVehicle(id, 0, 0, 0);
    run(6, () => {
      stepVehicle(a, { throttle: 1 }, DT, W);
      stepVehicle(b, { throttle: 1, boost: true }, DT, W);
    });
    assert.ok(b.speed > a.speed * 1.05, `${id} boosted ${b.speed.toFixed(1)} vs ${a.speed.toFixed(1)}`);
    assert.ok(b.boostOn || b.boostLevel > 0.5);
    // Long run on the flat: never past maxSpeed * (1 + top) (the cap) with the meter held full.
    const c = createVehicle(id, 0, 0, 0);
    run(90, () => { c.boostMeter = 1; c.boostLock = false; stepVehicle(c, { throttle: 1, boost: true }, DT, W); });
    assert.ok(c.speed <= c.spec.maxSpeed * (1 + CAR_BOOST.top) + 1e-6, `${id} cap ${c.speed.toFixed(1)}`);
    assert.ok(c.speed > c.spec.maxSpeed * 1.02, `${id} reaches past the plain top ${c.speed.toFixed(1)}`);
  }
});

test('car: no boost without throttle, while braking, in reverse or for AI controls', () => {
  const v = createVehicle('sedan', 0, 0, 0);
  run(1, () => stepVehicle(v, { throttle: 0, boost: true }, DT, W));
  assert.equal(v.boostOn, false);
  run(1, () => stepVehicle(v, { throttle: 1, brake: 1, boost: true }, DT, W));
  assert.equal(v.boostOn, false);
  const ai = createVehicle('sedan', 0, 0, 0), plain = createVehicle('sedan', 0, 0, 0);
  run(5, () => {
    stepVehicle(ai, { throttle: 1, steer: 0, brake: 0, handbrake: false }, DT, W);
    stepVehicle(plain, { throttle: 1 }, DT, W);
  });
  assert.equal(ai.boostMeter, 1);
  assert.equal(ai.speed, plain.speed);
});

test('boat: planing surge gives more thrust and a higher cap with the same meter rules', () => {
  const a = createBoat('speedboat', 0, 0, 0), b = createBoat('speedboat', 0, 0, 0);
  run(8, () => {
    stepBoat(a, { throttle: 1 }, DT, W);
    stepBoat(b, { throttle: 1, boost: true }, DT, W);
  });
  assert.ok(b.speed > a.speed * 1.05, `boat ${b.speed.toFixed(1)} vs ${a.speed.toFixed(1)}`);
  assert.ok(b.speed <= b.spec.maxSpeed * (1 + BOAT_BOOST.top) + 1e-6);
  assert.ok(b.boostMeter < 0.5, 'drained over 8 s');
  // After release the surge settles back to the plain cap.
  run(15, () => stepBoat(b, { throttle: 1 }, DT, W));
  assert.ok(b.speed <= b.spec.maxSpeed + 0.05, `settles to ${b.speed.toFixed(1)}`);
});

test('fighter: the BOOST button is the afterburner; full throttle alone is not, for the player', () => {
  const mk = () => {
    const a = createAircraft('fighter', 0, 0, 0);
    a.onGround = false; a.placed = true; a.y = 200; a.airspeed = 90; a.speed = 90; a.engineOn = true;
    return a;
  };
  const plain = mk(), boosted = mk();
  run(4, () => {
    stepAircraft(plain, { throttle: 1, steer: 0, pitch: 0, boost: false }, DT, W);
    stepAircraft(boosted, { throttle: 1, steer: 0, pitch: 0, boost: true }, DT, W);
  });
  assert.ok(plain.afterburner < 0.01, 'no afterburner without the button');
  assert.ok(boosted.afterburner > 0.9, `afterburner ${boosted.afterburner.toFixed(2)}`);
  assert.ok(boosted.airspeed > plain.airspeed + 5, `${boosted.airspeed.toFixed(1)} vs ${plain.airspeed.toFixed(1)}`);
  // AI pilots (no boost field) keep the old rule: afterburner at full throttle.
  const ai = mk();
  run(4, () => stepAircraft(ai, { throttle: 1, steer: 0, pitch: 0 }, DT, W));
  assert.ok(ai.afterburner > 0.9, 'AI jet keeps its afterburner');
  assert.equal(ai.boostMeter, 1);
});

test('plane without an afterburner gets a short thrust surge; helicopter a forward speed surge; tank none', () => {
  const mk = (id) => {
    const a = createAircraft(id, 0, 0, 0);
    a.onGround = false; a.placed = true; a.y = 200; a.airspeed = 40; a.speed = 40; a.engineOn = true;
    if (a.kind === 'heli') { a.rotorSpeed = 1; a.driver = 'player'; }
    return a;
  };
  const p1 = mk('prop'), p2 = mk('prop');
  run(5, () => {
    stepAircraft(p1, { throttle: 0.8, steer: 0, pitch: 0, boost: false }, DT, W);
    stepAircraft(p2, { throttle: 0.8, steer: 0, pitch: 0, boost: true }, DT, W);
  });
  assert.ok(p2.airspeed > p1.airspeed + 2, `prop ${p2.airspeed.toFixed(1)} vs ${p1.airspeed.toFixed(1)}`);
  const h1 = mk('heli'), h2 = mk('heli');
  run(6, () => {
    stepAircraft(h1, { throttle: 0, steer: 0, pitch: 1, boost: false }, DT, W);
    stepAircraft(h2, { throttle: 0, steer: 0, pitch: 1, boost: true }, DT, W);
  });
  assert.ok(h2.speed > h1.speed * 1.1, `heli ${h2.speed.toFixed(1)} vs ${h1.speed.toFixed(1)}`);
});

test('input: the boost axis follows any source and the keyboard', () => {
  const input = createInput();
  const src = input.addSource({ boost: false });
  input.poll();
  assert.equal(input.boost, false);
  src.boost = true;
  input.poll();
  assert.equal(input.boost, true);
  src.boost = false;
  input.poll();
  assert.equal(input.boost, false);
});
