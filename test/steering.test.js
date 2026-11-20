import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createInput, shapeSteer, rampSteer, tiltAngle, tiltToSteer, angleDelta, clampSensitivity,
  STEER_STYLES, TILT_LOCK_DEG,
} from '../src/core/input.js';
import { defaultProgress, sanitizeProgress } from '../src/core/save.js';

test('response curve: fine near centre, full lock at the end, sensitivity blends', () => {
  assert.equal(shapeSteer(0), 0);
  assert.equal(shapeSteer(1), 1);
  assert.equal(shapeSteer(-1), -1);
  assert.ok(Math.abs(shapeSteer(0.5) - Math.pow(0.5, 1.6)) < 1e-12, 'default is |x|^1.6');
  for (const x of [0.1, 0.3, 0.6, 0.9]) {
    assert.equal(shapeSteer(-x), -shapeSteer(x), 'odd');
    assert.ok(shapeSteer(x) < x, `finer than linear at ${x}`);
    assert.ok(shapeSteer(x, 0.5) < shapeSteer(x, 1) && shapeSteer(x, 1) < shapeSteer(x, 1.5), `sensitivity order at ${x}`);
  }
  for (const s of [0.5, 0.8, 1, 1.2, 1.5]) assert.equal(shapeSteer(1, s), 1, `full lock reachable at ${s}`);
  let last = -1;
  for (let x = -1; x <= 1.0001; x += 0.01) {
    const y = shapeSteer(x, 1.3);
    assert.ok(y >= last - 1e-12 && Math.abs(y) <= 1, 'monotonic and bounded');
    last = y;
  }
  assert.equal(shapeSteer(5), 1);
  assert.equal(shapeSteer(NaN), 0);
  assert.equal(clampSensitivity(9), 1.5);
  assert.equal(clampSensitivity(NaN), 1);
});

test('button ramp: 0.25 s to full lock, 0.15 s back, independent of frame rate', () => {
  const run = (hz, target, secs, start = 0) => {
    let v = start;
    for (let i = 0; i < Math.round(secs * hz); i++) v = rampSteer(v, target, 1 / hz);
    return v;
  };
  for (const hz of [30, 60, 120]) {
    assert.ok(Math.abs(run(hz, 1, 0.1) - 0.4) < 1e-9, `0.1 s at ${hz} Hz`);
    assert.equal(run(hz, 1, 0.25), 1);
    assert.equal(run(hz, -1, 0.25), -1);
    assert.ok(Math.abs(run(hz, 0, 0.1, 1) - (1 - 0.1 / 0.15)) < 1e-9);
    assert.equal(run(hz, 0, 0.15, 1), 0);
  }
  // Switching sides goes back through centre at the return rate first.
  assert.ok(Math.abs(rampSteer(1, -1, 0.05) - (1 - 0.05 / 0.15)) < 1e-12);
});

test('tilt: both landscape orientations, dead zone, 25 degrees = full lock', () => {
  // Landscape, phone upright: no tilt either way round.
  assert.ok(Math.abs(tiltAngle(0, -90, 90)) < 1e-9);
  assert.ok(Math.abs(tiltAngle(0, 90, 270)) < 1e-9);
  // Device orientation (beta, gamma) of a landscape phone (angle 90) whose
  // screen leans back `back` degrees and is turned `turn` degrees like a wheel.
  const R = Math.PI / 180;
  const pose = (back, turn) => {
    const cb = Math.cos(back * R), sb = Math.sin(back * R);
    const beta = Math.asin(cb * Math.sin(turn * R)) / R;
    const gamma = Math.atan2(-cb * Math.cos(turn * R), sb) / R;
    return [beta, gamma];
  };
  for (const back of [0, 30, 60]) {
    for (const turn of [-20, -10, 5, 10, 20]) {
      const [b, g] = pose(back, turn);
      assert.ok(Math.abs(tiltAngle(b, g, 90) - turn) < 0.01, `angle 90, back ${back}, turn ${turn}: ${tiltAngle(b, g, 90)}`);
      // The other landscape is the same pose rotated half a turn.
      assert.ok(Math.abs(tiltAngle(-b, -g, 270) - turn) < 0.01, `angle 270, back ${back}, turn ${turn}`);
    }
  }
  assert.equal(tiltAngle(0, 0, 90), 0, 'flat on a table: nothing');
  assert.equal(tiltToSteer(1), 0);
  assert.equal(tiltToSteer(TILT_LOCK_DEG), 1);
  assert.equal(tiltToSteer(-40), -1);
  assert.ok(tiltToSteer(12) > 0.4 && tiltToSteer(12) < 0.5);
  assert.ok(Math.abs(angleDelta(Math.PI - 0.1, -Math.PI + 0.1) + 0.2) < 1e-12);
});

test('player input asks for proportional steering; settings sanitise', () => {
  assert.equal(createInput().steerMode, 'proportional');
  assert.deepEqual(STEER_STYLES, ['wheel', 'buttons', 'tilt', 'slider']);
  const d = defaultProgress().settings;
  assert.equal(d.steering, 'wheel');
  assert.equal(d.steerSensitivity, 1);
  for (const st of STEER_STYLES) assert.equal(sanitizeProgress({ settings: { steering: st } }).settings.steering, st);
  for (const bad of ['joystick', '', 5, null, ['wheel'], { a: 1 }]) {
    assert.equal(sanitizeProgress({ settings: { steering: bad } }).settings.steering, 'wheel');
  }
  const sens = (x) => sanitizeProgress({ settings: { steerSensitivity: x } }).settings.steerSensitivity;
  assert.equal(sens(0.75), 0.75);
  assert.equal(sens(0.1), 0.5);
  assert.equal(sens(7), 1.5);
  assert.equal(sens('1.2'), 1);
  assert.equal(sens(NaN), 1);
  assert.equal(sens(Infinity), 1);
});
