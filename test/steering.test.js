import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createInput, attachKeyboard, shapeSteer, rampSteer, tiltAngle, tiltToSteer, tiltFilter, tiltFallback, angleDelta,
  clampSensitivity, wheelCurve, steerTravel, rawFromTravel, createWheelTracker, sliderRaw,
  STEER_STYLES, TILT_LOCK_DEG, TILT_DEAD_DEG, TILT_SMOOTH, TILT_WAIT, CURVE_LINEAR, WHEEL_CORE_PX, SLIDER_W,
} from '../src/core/input.js';
import { defaultProgress, sanitizeProgress } from '../src/core/save.js';
import { createVehicle, stepVehicle, setHandlingMode, getHandlingMode, lateralGrip, setHandlingPreset, getHandlingPreset, presetParams } from '../src/entities/vehicle.js';
import { createRng, angleDiff } from '../src/core/rng.js';
import {
  PRESETS, PRESET_VALUES, VERDICTS, validPreset, validVerdict, setActivePreset, activePreset, presetValues,
} from '../src/core/handlingpreset.js';

// Task PLANTED (deliberate): 0.9 x + 0.1 x^3, 0.4625 at half (was 0.85 x + 0.15 x^3, 0.44375).
test('wheel curve: odd, rising, 0.4625 at half, slope 0.9 at the center; sensitivity changes travel only', () => {
  assert.equal(wheelCurve(0), 0);
  assert.equal(wheelCurve(1), 1);
  assert.equal(wheelCurve(-1), -1);
  assert.ok(Math.abs(wheelCurve(0.5) - 0.4625) < 1e-12);
  assert.equal(CURVE_LINEAR, 0.9);
  assert.ok(Math.abs(wheelCurve(1e-6) / 1e-6 - CURVE_LINEAR) < 1e-6, 'slope at 0');
  let last = -2;
  for (let x = -1; x <= 1.0001; x += 0.01) {
    const y = wheelCurve(x);
    assert.ok(y > last && Math.abs(y) <= 1, 'strictly rising and bounded');
    assert.ok(Math.abs(wheelCurve(-x) + y) < 1e-12, 'odd');
    last = y;
  }
  assert.equal(wheelCurve(5), 1);
  assert.equal(wheelCurve(NaN), 0);
  // shapeSteer is the same curve whatever the sensitivity.
  for (const x of [0.2, 0.5, 0.9]) for (const k of [0.5, 1, 1.5]) assert.equal(shapeSteer(x, k), wheelCurve(x));
  // Travel per style, less travel with more sensitivity.
  assert.equal(steerTravel('wheel'), 110);
  assert.equal(steerTravel('slider'), 90);
  assert.equal(steerTravel('tilt'), 22);
  assert.equal(steerTravel('buttons'), 0.3);
  assert.equal(steerTravel('wheel', 1.5), 110 / 1.5);
  assert.equal(steerTravel('wheel', 9), 110 / 1.5);
  assert.equal(steerTravel('nope'), 110);
  assert.equal(rawFromTravel('wheel', 55), 0.5);
  assert.equal(rawFromTravel('wheel', 55, 2), 0.75);
  assert.equal(rawFromTravel('slider', -400), -1);
  assert.equal(clampSensitivity(9), 1.5);
  assert.equal(clampSensitivity(NaN), 1);
});

test('buttons: ramp 0.30 s to a full target while held, 0 on release or both, frame-rate independent', () => {
  const run = (hz, target, secs, start = 0) => {
    let v = start;
    for (let i = 0; i < Math.round(secs * hz); i++) v = rampSteer(v, target, 1 / hz);
    return v;
  };
  for (const hz of [30, 60, 120]) {
    assert.ok(Math.abs(run(hz, 1, 0.1) - 1 / 3) < 1e-9, `0.1 s at ${hz} Hz`);
    assert.equal(run(hz, 1, 0.3), 1);
    assert.equal(run(hz, -1, 0.3), -1);
    assert.equal(run(hz, 1, 1), 1);
  }
  assert.equal(rampSteer(0.7, 0, 1 / 60), 0, 'release: target 0 at once');
  // Pressing the other side ramps from where it is, through the center.
  assert.ok(Math.abs(rampSteer(1, -1, 0.06) - 0.8) < 1e-12);
  // Sensitivity shortens the ramp.
  assert.ok(Math.abs(rampSteer(0, 1, 0.1, 1.5) - 0.5) < 1e-12);
  // The keyboard uses the same mapping, one 1/60 s step per poll.
  const listeners = {};
  const target = { addEventListener: (t, f) => { listeners[t] = f; }, removeEventListener() {} };
  const input = createInput();
  attachKeyboard(input, target);
  listeners.keydown({ code: 'ArrowRight' });
  for (let i = 0; i < 9; i++) input.poll();
  assert.ok(Math.abs(input.steer - 0.5) < 1e-9, `keyboard after 9 steps ${input.steer}`);
  for (let i = 0; i < 20; i++) input.poll();
  assert.equal(input.steer, 1);
  listeners.keydown({ code: 'ArrowLeft' });
  input.poll();
  assert.equal(input.steer, 0, 'both held: 0');
  listeners.keyup({ code: 'ArrowRight' });
  listeners.keyup({ code: 'ArrowLeft' });
  input.poll();
  assert.equal(input.steer, 0);
});

test('wheel tracker: summed angle, 55 deg is half, holds through the core, full at 110, 0 on lift', () => {
  const R = 60, DEG = Math.PI / 180;
  const at = (deg) => [R * Math.cos(deg * DEG), R * Math.sin(deg * DEG)];
  const w = createWheelTracker();
  // The thumb lands anywhere: no jump.
  assert.equal(w.down(...at(-40), 0, 0), 0);
  for (let a = -40; a <= 15; a += 5) w.move(...at(a));
  assert.ok(Math.abs(w.raw() - 0.5) < 1e-9, `55 deg raw ${w.raw()}`);
  assert.ok(w.target() >= 0.4 && w.target() <= 0.55);
  // A path straight through the center core barely changes the target.
  const before = w.target();
  const [x0, y0] = at(15);
  for (let k = 1; k <= 20; k++) w.move(x0 - (2 * x0 * k) / 20, y0 - (2 * y0 * k) / 20);
  assert.ok(Math.abs(w.target() - before) < 0.02, `through the core ${before} -> ${w.target()}`);
  assert.ok(WHEEL_CORE_PX === 16);
  // Tracked wherever it goes; winding past full lock clamps and unwinds at once.
  const v = createWheelTracker();
  v.down(...at(0), 0, 0);
  for (let a = 0; a <= 200; a += 10) v.move(...at(a));
  assert.equal(v.raw(), 1);
  assert.equal(v.target(), 1);
  v.move(...at(190));
  assert.ok(Math.abs(v.raw() - 100 / 110) < 1e-9);
  assert.equal(v.up(), 0);
  assert.equal(v.raw(), 0);
  assert.equal(v.move(...at(50)), 0, 'no steering after lift');
  // Sensitivity shortens the travel only.
  const s = createWheelTracker();
  s.down(...at(0), 0, 0, 1.5);
  for (let a = 0; a <= 55; a += 5) s.move(...at(a));
  assert.ok(Math.abs(s.raw() - 0.75) < 1e-9);
});

test('slider: absolute from the bar center, 45 px is half, works off the bar, clamps at the ends', () => {
  assert.equal(SLIDER_W, 180);
  assert.equal(sliderRaw(545, 500), 0.5);
  assert.equal(sliderRaw(455, 500), -0.5);
  assert.ok(wheelCurve(sliderRaw(545, 500)) >= 0.4 && wheelCurve(sliderRaw(545, 500)) <= 0.55);
  assert.equal(sliderRaw(500 + SLIDER_W, 500), 1, 'off the bar still steers, clamped');
  assert.equal(sliderRaw(0, 500), -1);
  assert.equal(sliderRaw(530, 500, 1.5), 0.5);
  assert.equal(sliderRaw(NaN, 500), -1);
});

test('tilt: both landscape orientations, flat is 0, dead zone 1.5, 22 degrees of travel, filter and fallback', () => {
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
  assert.ok(Math.abs(tiltToSteer(TILT_DEAD_DEG + 11) - 0.5) < 1e-12, '12.5 deg past zero is half');
  assert.ok(Math.abs(tiltToSteer(-12.5) + 0.5) < 1e-12);
  assert.equal(tiltToSteer(0.5), 0, 'noise at rest');
  assert.equal(tiltToSteer(-0.5), 0);
  // The one filter: a 0.08 s low-pass, frame-rate independent.
  let a = 0, b = 0;
  for (let i = 0; i < 6; i++) a = tiltFilter(a, 10, 1 / 60);
  for (let i = 0; i < 12; i++) b = tiltFilter(b, 10, 1 / 120);
  assert.ok(Math.abs(a - b) < 1e-9 && Math.abs(a - 10 * (1 - Math.exp(-0.1 / TILT_SMOOTH))) < 1e-9);
  // No event within 1 s, or a refusal: the wheel stands in.
  assert.equal(tiltFallback(0.5, false), false);
  assert.equal(tiltFallback(TILT_WAIT, false), true);
  assert.equal(tiltFallback(5, true), false);
  assert.equal(tiltFallback(0, false, true), true);
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

test('handling presets: values, default standard, enum validation, one table with the car', () => {
  // HANDLE re-pin (deliberate): Sharp's lock floor 35 to 40 degrees, as every car's own lock is now 33 to 36.
  // 0.9.0 re-pin (deliberate): the lab's own steer-scale table (lockScale,
  // speedReduction, gripFeel), which no car read, is gone; PRESET_VALUES is
  // now the one table the car model reads (entities/vehicle.js).
  // DRIVE re-pin (deliberate, docs/PLAN_V3.md 13): each preset also scales
  // the player's input shaping by speed (shapeK: Relaxed finer, Sharp more direct).
  assert.deepEqual(PRESETS, ['standard', 'relaxed', 'sharp']);
  // PLANTED re-pin (deliberate, docs/REVAMP.md 6.3): Standard is the planted
  // Arcade target. assistK is gone with the stability assist; lockAdd (degrees
  // on Arcade's 40 degree lock) and gainK (share of Arcade's grip gain kept)
  // join. Relaxed: slower steering (0.7, was 0.8), 0.7 of the grip gain
  // (was gripK 0.95), finer shaping (1.25 of a rise that is now 0.2, was 1.2
  // of 0.8). Sharp: 44 degrees in Arcade, shaping halved (was 0.75).
  // GRIP re-pin (deliberate, owner round 6, docs/REVAMP.md 6.3): arcShape (the
  // Arcade player's shaping exponent from 70 mph: Standard and Sharp 1,
  // linear at first, then coordinator decision: Standard 1.4, the 30-seed lane
  // change sweep; Relaxed 1.6; Sharp 1) and turnK (share of the player's full-input turn,
  // playerLatG: Relaxed 0.8, Sharp 1.1) join; shapeK now shapes Sim only.
  assert.deepEqual(PRESET_VALUES.standard, { lockK: 1, returnK: 1, lockDeg: 0, lockAdd: 0, gripK: 1, gainK: 1, rollK: 1, shapeK: 1, arcShape: 1.4, turnK: 1 }, 'standard is the target');
  assert.deepEqual(PRESET_VALUES.relaxed, { lockK: 0.7, returnK: 0.8, lockDeg: 0, lockAdd: 0, gripK: 1, gainK: 0.7, rollK: 1.3, shapeK: 1.25, arcShape: 1.6, turnK: 0.8 });
  assert.deepEqual(PRESET_VALUES.sharp, { lockK: 1.25, returnK: 1.2, lockDeg: 40, lockAdd: 4, gripK: 1, gainK: 1, rollK: 0.85, shapeK: 0.5, arcShape: 1, turnK: 1.1 });
  assert.ok(PRESET_VALUES.relaxed.turnK < 1 && PRESET_VALUES.sharp.turnK > 1 && PRESET_VALUES.relaxed.arcShape > PRESET_VALUES.standard.arcShape);
  assert.ok(PRESET_VALUES.relaxed.gainK < 1 && PRESET_VALUES.sharp.lockAdd > 0);
  assert.ok(PRESET_VALUES.relaxed.shapeK > 1 && PRESET_VALUES.sharp.shapeK < 1);
  assert.ok(PRESET_VALUES.relaxed.lockK < 1 && PRESET_VALUES.sharp.lockK > 1);
  for (const id of PRESETS) assert.deepEqual(presetParams(id), PRESET_VALUES[id], `${id}: the car reads the same row`);
  assert.equal(activePreset(), 'standard');
  assert.equal(setActivePreset('sharp'), 'sharp');
  assert.equal(presetValues(), PRESET_VALUES.sharp);
  assert.equal(getHandlingPreset(), 'sharp', 'the car follows the one active preset');
  assert.equal(setHandlingPreset('relaxed'), 'relaxed');
  assert.equal(activePreset(), 'relaxed');
  assert.equal(setActivePreset('bogus'), 'standard');
  assert.equal(getHandlingPreset(), 'standard');
  assert.equal(presetValues('relaxed'), PRESET_VALUES.relaxed);
  for (const bad of ['', 'Sharp', 5, null, undefined, ['sharp'], {}]) assert.equal(validPreset(bad), 'standard');
  // settings: absent reads as standard / none, only enums are kept
  assert.equal(defaultProgress().settings.handlingPreset, undefined);
  for (const id of PRESETS) assert.equal(sanitizeProgress({ settings: { handlingPreset: id } }).settings.handlingPreset, id);
  for (const bad of ['', 'Sharp', 'tight', 3, null, ['sharp'], { a: 1 }]) {
    const s = sanitizeProgress({ settings: { handlingPreset: bad, handlingVerdict: bad } }).settings;
    assert.equal(validPreset(s.handlingPreset), 'standard');
    assert.equal(s.handlingPreset, undefined);
    assert.equal(s.handlingVerdict, undefined);
  }
  for (const id of VERDICTS) assert.equal(sanitizeProgress({ settings: { handlingVerdict: id } }).settings.handlingVerdict, id);
  assert.equal(validVerdict('twitchy'), 'twitchy');
  assert.equal(validVerdict('nope'), 'none');
});

// ---- Car handling: arcade (default) and sim modes (bands in
// test/handling-bands.test.js). Turning circles are measured like this:
// hold a speed, then full steer and keep holding the speed; the radius is
// half the larger extent of the path over one full turn, entry included.

const DT = 1 / 60;
const DEG = Math.PI / 180;
const ALL = ['compact', 'sedan', 'taxi', 'police', 'pickup', 'van', 'truck', 'sports', 'muscle'];
const SPEEDS = [5, 15, 25, 40]; // HANDLE: 5 m/s (was 8) is the lock-limited pace now that Arcade grips 1.25 of the real car in town
const player = (o) => ({ steer: 0, throttle: 0, brake: 0, handbrake: false, steerMode: 'proportional', ...o });
const bodySlip = (v) => {
  const ch = Math.cos(v.heading), sh = Math.sin(v.heading);
  return Math.atan2(-v.vx * sh + v.vz * ch, v.vx * ch + v.vz * sh);
};
const withMode = (mode, fn) => () => {
  setHandlingMode(mode);
  try { fn(); } finally { setHandlingMode('arcade'); }
};

function hold(v, c, target) {
  const e = target - v.speed;
  c.throttle = Math.max(0, Math.min(1, e * 0.8));
  c.brake = e < -0.5 ? Math.min(1, -e * 0.3) : 0;
}

// Full-lock turning radius at a held speed (40 means "or top speed").
function turnRadius(id, target) {
  const v = createVehicle(id, 0, 0, 0);
  const c = player({});
  for (let i = 0; i < 1500; i++) { hold(v, c, target); stepVehicle(v, c, DT, {}); }
  c.steer = 1;
  let turned = 0, last = v.heading, minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity, minSpeed = Infinity;
  for (let i = 0; i < 2400 && turned < Math.PI * 2; i++) {
    hold(v, c, target);
    stepVehicle(v, c, DT, {});
    turned += angleDiff(v.heading, last);
    last = v.heading;
    minSpeed = Math.min(minSpeed, v.speed);
    minX = Math.min(minX, v.x); maxX = Math.max(maxX, v.x); minZ = Math.min(minZ, v.z); maxZ = Math.max(maxZ, v.z);
  }
  assert.ok(turned >= Math.PI * 2 - 0.05, `${id} at ${target} m/s turned only ${turned.toFixed(2)} rad`);
  return { r: Math.max(maxX - minX, maxZ - minZ) / 2, minSpeed };
}

function radiusTable() {
  const t = {};
  for (const id of ALL) t[id] = SPEEDS.map((u) => turnRadius(id, u));
  return t;
}

test('handling mode: arcade by default, sim on request, anything else is arcade', () => {
  assert.equal(getHandlingMode(), 'arcade');
  assert.equal(setHandlingMode('sim'), 'sim');
  assert.equal(getHandlingMode(), 'sim');
  for (const bad of [undefined, null, 'SIM', 'gt', 3]) {
    setHandlingMode('sim');
    assert.equal(setHandlingMode(bad), 'arcade');
  }
  assert.equal(getHandlingMode(), 'arcade');
});

// Task PLANTED (deliberate, was "the same at walking pace in both modes"):
// Arcade cuts 40 degrees for every vehicle up to 3000 kg, so at 5 m/s it
// turns tighter than Sim by the ratio of the two locks; heavier vehicles
// turn the same circle in both modes.
test('turning circles: at walking pace the lock (40 degrees in Arcade for cars), at speed set by the grip', () => {
  const t = {};
  for (const mode of ['arcade', 'sim']) {
    setHandlingMode(mode);
    t[mode] = radiusTable();
  }
  setHandlingMode('arcade');
  for (const id of ALL) {
    const spec = createVehicle(id, 0, 0, 0).spec;
    // Walking-ish pace (5 m/s): the lock.
    const b = spec.wheelBase * spec.cgFront;
    const geo = (lock) => Math.hypot(spec.wheelBase / Math.tan(lock), b);
    const want = spec.mass <= 3000 ? geo(Math.max(spec.steerMax, 40 * Math.PI / 180)) / geo(spec.steerMax) : 1;
    assert.ok(Math.abs(t.arcade[id][0].r / t.sim[id][0].r / want - 1) < 0.1, `${id} at 5 m/s: arcade ${t.arcade[id][0].r.toFixed(2)} sim ${t.sim[id][0].r.toFixed(2)}, lock ratio ${want.toFixed(2)}`);
    assert.ok(t.arcade[id][0].r <= t.sim[id][0].r * 1.02, `${id}: Arcade is never wider at walking pace`);
    for (const k of [1, 2]) {
      const u = SPEEDS[k];
      for (const mode of ['arcade', 'sim']) {
        const { r, minSpeed } = t[mode][id][k];
        setHandlingMode(mode);
        const g = lateralGrip(spec, u) * 9.81;
        setHandlingMode('arcade');
        // Entry included, so the circle is a little wider than u^2 / a.
        const ideal = (u * u) / g;
        assert.ok(r > ideal * 0.85 && r < ideal * 1.35, `${mode} ${id} at ${u} m/s: ${r.toFixed(1)} m, ideal ${ideal.toFixed(1)}`);
        assert.ok(minSpeed > u * 0.75, `${mode} ${id} kept ${minSpeed.toFixed(1)} m/s of ${u}`);
      }
    }
  }
});

test('Sim corners wider than Arcade at speed, never tighter', () => {
  for (const id of ['sedan', 'sports', 'van']) {
    for (const u of [15, 25]) {
      setHandlingMode('arcade');
      const a = turnRadius(id, u).r;
      setHandlingMode('sim');
      const s = turnRadius(id, u).r;
      setHandlingMode('arcade');
      // (Task PLANTED, deliberate: Arcade grips up to 1.6 times Sim, was 1.25: the upper bound was 1.4.)
      assert.ok(s > a * 1.05 && s < a * 1.75, `${id} at ${u}: arcade ${a.toFixed(1)} sim ${s.toFixed(1)}`);
    }
  }
});

// Yaw rate after a full-steer step at 15 m/s: time to 90 % of steady.
function yawRise(id) {
  const v = createVehicle(id, 0, 0, 0);
  v.vx = 15;
  const c = player({});
  for (let i = 0; i < 60; i++) { hold(v, c, 15); stepVehicle(v, c, DT, {}); }
  c.steer = 1;
  const ys = [];
  for (let i = 0; i < 240; i++) { hold(v, c, 15); stepVehicle(v, c, DT, {}); ys.push(v.yawRate); }
  const steady = ys.slice(150).reduce((a, b) => a + b, 0) / 90;
  return { t90: (ys.findIndex((y) => y >= 0.9 * steady) + 1) * DT, overshoot: Math.max(...ys) / steady, steady };
}

test('yaw response to full steer at 15 m/s: 90 % within the lock time plus 0.35 s, both modes', () => {
  for (const mode of ['arcade', 'sim']) {
    setHandlingMode(mode);
    for (const id of ALL) {
      const { t90, overshoot, steady } = yawRise(id);
      const lockT = 1 / createVehicle(id, 0, 0, 0).spec.lockRate;
      assert.ok(steady > 0.4, `${mode} ${id} steady yaw ${steady.toFixed(2)}`);
      assert.ok(t90 > 0 && t90 <= lockT + 0.35, `${mode} ${id} t90 ${t90.toFixed(2)} s`);
      assert.ok(overshoot < 1.2, `${mode} ${id} overshoot ${overshoot.toFixed(2)}`);
    }
  }
  setHandlingMode('arcade');
});

test('full steer at 40 m/s (and the sports car at 62) never spins, in both modes', () => {
  for (const mode of ['arcade', 'sim']) {
    setHandlingMode(mode);
    const runs = ALL.map((id) => [id, 40]).concat([['sports', 62]]);
    for (const [id, u0] of runs) {
      const v = createVehicle(id, 0, 0, 0);
      v.vx = Math.min(u0, v.spec.maxSpeed);
      const c = player({ steer: 1 });
      let maxRate = 0, lateBeta = 0;
      for (let i = 0; i < 60 * 6; i++) {
        hold(v, c, u0);
        stepVehicle(v, c, DT, {});
        maxRate = Math.max(maxRate, Math.abs(v.yawRate));
        if (i >= 60 * 4) lateBeta = Math.max(lateBeta, Math.abs(bodySlip(v)));
      }
      const tag = `${mode} ${id} at ${u0}`;
      assert.ok(lateBeta < 35 * DEG, `${tag}: sideslip ${(lateBeta / DEG).toFixed(1)} deg`);
      assert.ok(maxRate < 2.2, `${tag}: yaw rate ${maxRate.toFixed(2)}`);
      assert.ok(v.speed > 10, `${tag}: still driving at ${v.speed.toFixed(1)}`);
      // Heading rate matches a car going round a curve, not a spin.
      assert.ok(Math.abs(v.yawRate) * v.speed < 3 * 9.81, `${tag}: ${(Math.abs(v.yawRate) * v.speed / 9.81).toFixed(2)} g`);
    }
  }
  setHandlingMode('arcade');
});

test('arcade: releasing full steer at 40 m/s straightens within 1.5 s, no weave', withMode('arcade', () => {
  for (const id of ['sedan', 'police', 'sports', 'muscle']) {
    const v = createVehicle(id, 0, 0, 0);
    v.vx = 40;
    for (let i = 0; i < 90; i++) stepVehicle(v, player({ steer: 1, throttle: 0.6 }), DT, {});
    assert.ok(v.yawRate > 0.15, `${id} was turning (${v.yawRate.toFixed(2)})`);
    const hs = [];
    let settled = -1;
    for (let i = 0; i < 180; i++) {
      stepVehicle(v, player({ throttle: 0.5 }), DT, {});
      hs.push(v.heading);
      if (settled < 0 && Math.abs(v.yawRate) < 0.01) settled = (i + 1) * DT;
    }
    assert.ok(settled > 0 && settled <= 1.5, `${id} straight after ${settled.toFixed(2)} s`);
    const peak = Math.max(...hs);
    const back = peak - Math.min(...hs.slice(hs.indexOf(peak)));
    assert.ok(back < 2 * DEG, `${id} heading swings back ${(back / DEG).toFixed(2)} deg`);
    assert.ok(Math.abs(bodySlip(v)) < 1 * DEG);
  }
}));

test('arcade muscle car: full throttle at full lock is held by traction control and keeps its speed', withMode('arcade', () => {
  for (const u0 of [12, 15, 20, 25]) {
    const v = createVehicle('muscle', 0, 0, 0);
    v.vx = u0;
    let minSpeed = Infinity, maxBeta = 0;
    for (let i = 0; i < 240; i++) {
      stepVehicle(v, player({ steer: 1, throttle: 1 }), DT, {});
      minSpeed = Math.min(minSpeed, v.speed);
      maxBeta = Math.max(maxBeta, Math.abs(bodySlip(v)));
    }
    assert.ok(minSpeed > Math.max(8, u0 * 0.75), `from ${u0} m/s it fell to ${minSpeed.toFixed(1)}`);
    assert.ok(maxBeta < 16 * DEG, `from ${u0} m/s slide ${(maxBeta / DEG).toFixed(1)} deg`);
    // Easing off settles it at once.
    for (let i = 0; i < 120; i++) stepVehicle(v, player({ steer: 1, throttle: 0.2 }), DT, {});
    assert.ok(Math.abs(bodySlip(v)) < 12 * DEG, `settled to ${(Math.abs(bodySlip(v)) / DEG).toFixed(1)} deg`);
  }
}));

test('handbrake drift is big and recovers after release, in both modes', () => {
  for (const mode of ['arcade', 'sim']) {
    setHandlingMode(mode);
    for (const id of ['muscle', 'sports', 'sedan']) {
      const v = createVehicle(id, 0, 0, 0);
      v.vx = 20;
      let maxBeta = 0, maxSlip = 0, minSpeed = Infinity;
      for (let i = 0; i < 50; i++) {
        stepVehicle(v, player({ steer: 1, handbrake: true }), DT, {});
        maxBeta = Math.max(maxBeta, Math.abs(bodySlip(v)));
        maxSlip = Math.max(maxSlip, v.slip);
      }
      const tag = `${mode} ${id}`;
      assert.ok(maxBeta > (mode === 'arcade' ? 25 : 15) * DEG, `${tag} slide ${(maxBeta / DEG).toFixed(1)} deg`);
      assert.ok(maxBeta < 70 * DEG, `${tag} no spin-out ${(maxBeta / DEG).toFixed(1)} deg`);
      assert.ok(maxSlip > 0.5, `${tag} squeal ${maxSlip}`);
      let recovered = -1;
      for (let i = 0; i < 180; i++) {
        stepVehicle(v, player({ throttle: 0.3 }), DT, {});
        minSpeed = Math.min(minSpeed, Math.hypot(v.vx, v.vz));
        if (recovered < 0 && Math.abs(bodySlip(v)) < 3 * DEG && Math.abs(v.yawRate) < 0.1) recovered = (i + 1) * DT;
      }
      assert.ok(recovered > 0 && recovered < 2, `${tag} recovered after ${recovered.toFixed(2)} s`);
      // Sim holds the slide while the handbrake is held, so it scrubs more.
      const keep = mode === 'arcade' ? 7 : 4;
      assert.ok(minSpeed > keep && v.speed > keep, `${tag} kept going (${minSpeed.toFixed(1)}, ${v.speed.toFixed(1)})`);
      assert.ok(Math.abs(bodySlip(v)) < 1 * DEG);
    }
  }
  setHandlingMode('arcade');
});

test('no NaN over 5000 random-control steps in both modes', () => {
  for (const mode of ['arcade', 'sim']) {
    setHandlingMode(mode);
    const rng = createRng(mode === 'sim' ? 7 : 11);
    const cars = ALL.map((id, i) => createVehicle(id, i * 12, 0, i, rng));
    const ctl = { steer: 0, throttle: 0, brake: 0, handbrake: false, steerMode: 'proportional' };
    for (let i = 0; i < 5000; i++) {
      if (i % 20 === 0) {
        ctl.steer = rng.range(-1, 1);
        ctl.throttle = rng.chance(0.7) ? rng.next() : 0;
        ctl.brake = rng.chance(0.2) ? rng.next() : 0;
        ctl.handbrake = rng.chance(0.15);
        ctl.steerMode = rng.chance(0.5) ? 'proportional' : undefined;
      }
      for (const c of cars) stepVehicle(c, ctl, DT, {});
    }
    for (const c of cars) {
      for (const k of ['x', 'z', 'heading', 'vx', 'vz', 'yawRate', 'speed', 'steer', 'steerAngle', 'roll', 'pitch', 'rpm', 'slip']) {
        assert.ok(Number.isFinite(c[k]), `${mode} ${c.spec.id} ${k}=${c[k]}`);
      }
      assert.ok(Math.abs(c.speed) <= c.spec.maxSpeed + 1e-9);
    }
  }
  setHandlingMode('arcade');
});
