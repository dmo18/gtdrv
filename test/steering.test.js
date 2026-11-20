import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createInput, shapeSteer, rampSteer, tiltAngle, tiltToSteer, angleDelta, clampSensitivity,
  STEER_STYLES, TILT_LOCK_DEG,
} from '../src/core/input.js';
import { defaultProgress, sanitizeProgress } from '../src/core/save.js';
import { createVehicle, stepVehicle, setHandlingMode, getHandlingMode } from '../src/entities/vehicle.js';
import { createRng, angleDiff } from '../src/core/rng.js';

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

// ---- Car handling: arcade (default) and sim modes. ----
// Turning circles are measured like this: hold a speed, then full steer
// with the player's (proportional) mapping and keep holding the speed;
// the radius is half the larger extent of the path over one full turn,
// entry included.

const DT = 1 / 60;
const DEG = Math.PI / 180;
const ALL = ['compact', 'sedan', 'taxi', 'police', 'pickup', 'van', 'truck', 'sports', 'muscle'];
const SPEEDS = [8, 15, 25, 40];
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

test('arcade turning circles: tight at every speed, per car', withMode('arcade', () => {
  const t = radiusTable();
  // Sedan-class limits (m) at 8, 15, 25, 40 m/s, and sane lower bounds.
  const max = [5, 10, 27, 65], min = [3.2, 7, 19, 45];
  const sedan = t.sedan.map((x) => x.r);
  for (const id of ['compact', 'sedan', 'taxi', 'police']) {
    SPEEDS.forEach((u, k) => {
      const r = t[id][k].r;
      assert.ok(r <= max[k] && r >= min[k], `${id} at ${u} m/s: ${r.toFixed(1)} m, want ${min[k]}..${max[k]}`);
    });
  }
  // Pickup and van within 20 % of the sedan; the truck 10.5 m at 8 m/s
  // and within 30 % at speed. Sports and muscle within 1.3x from 15 m/s,
  // the muscle car no wider than 8 m at walking-ish pace.
  SPEEDS.forEach((u, k) => {
    for (const id of ['pickup', 'van']) {
      const r = t[id][k].r;
      assert.ok(r <= Math.max(max[k], sedan[k]) * 1.2 && r >= min[k] * 0.8, `${id} at ${u} m/s: ${r.toFixed(1)} m`);
    }
    const tr = t.truck[k].r;
    assert.ok(tr <= (k === 0 ? 10.5 : Math.max(max[k], sedan[k]) * 1.3) && tr > 4.4, `truck at ${u} m/s: ${tr.toFixed(1)} m`);
    for (const id of ['sports', 'muscle']) {
      const r = t[id][k].r;
      const lim = k === 0 ? (id === 'muscle' ? 8 : max[0] * 1.4) : Math.max(max[k], sedan[k]) * 1.3;
      assert.ok(r <= lim && r >= min[k] * 0.8, `${id} at ${u} m/s: ${r.toFixed(1)} m, max ${lim.toFixed(1)}`);
    }
  });
  // The speed holds through the turn (no scrubbing down to a crawl).
  for (const id of ALL) {
    for (const k of [1, 2]) {
      assert.ok(t[id][k].minSpeed > SPEEDS[k] * 0.75, `${id} kept ${t[id][k].minSpeed.toFixed(1)} m/s of ${SPEEDS[k]}`);
    }
  }
}));

test('sim turning circles stay at today\'s realistic values (within 15 %)', withMode('sim', () => {
  // Measured with this same method on the code before the arcade mode.
  const today = {
    compact: [7.2, 26.5, 77.0, 169.5], sedan: [6.8, 25.4, 71.7, 198.4], taxi: [6.7, 25.4, 71.5, 197.8],
    police: [6.6, 23.3, 64.8, 169.5], pickup: [8.1, 27.8, 77.4, 179.4], van: [8.0, 29.6, 85.0, 155.1],
    truck: [12.2, 31.5, 88.0, 109.2], sports: [6.2, 20.9, 57.9, 148.3], muscle: [7.3, 26.0, 70.8, 186.6],
  };
  const t = radiusTable();
  for (const id of ALL) {
    SPEEDS.forEach((u, k) => {
      const r = t[id][k].r, ref = today[id][k];
      assert.ok(Math.abs(r / ref - 1) <= 0.15, `sim ${id} at ${u} m/s: ${r.toFixed(1)} m vs ${ref}`);
    });
  }
  // Realistic means much wider than arcade at speed.
  setHandlingMode('arcade');
  assert.ok(turnRadius('sedan', 25).r < t.sedan[2].r * 0.5);
}));

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

test('arcade yaw response: 90 % of the steady yaw rate within 0.35 s', withMode('arcade', () => {
  for (const id of ALL) {
    const { t90, overshoot, steady } = yawRise(id);
    assert.ok(steady > 1, `${id} steady yaw ${steady.toFixed(2)}`);
    assert.ok(t90 > 0 && t90 <= 0.35, `${id} t90 ${t90.toFixed(2)} s`);
    assert.ok(overshoot < 1.2, `${id} overshoot ${overshoot.toFixed(2)}`);
  }
  // Sim is noticeably slower to answer.
  setHandlingMode('sim');
  assert.ok(yawRise('sedan').t90 > 0.35);
}));

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
    assert.ok(v.yawRate > 0.3, `${id} was turning (${v.yawRate.toFixed(2)})`);
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

test('arcade muscle car: full throttle at full lock power-slides but keeps its speed', withMode('arcade', () => {
  for (const u0 of [12, 15, 20, 25]) {
    const v = createVehicle('muscle', 0, 0, 0);
    v.vx = u0;
    let minSpeed = Infinity, maxBeta = 0, maxSlip = 0;
    for (let i = 0; i < 240; i++) {
      stepVehicle(v, player({ steer: 1, throttle: 1 }), DT, {});
      minSpeed = Math.min(minSpeed, v.speed);
      maxBeta = Math.max(maxBeta, Math.abs(bodySlip(v)));
      maxSlip = Math.max(maxSlip, v.slip);
    }
    assert.ok(minSpeed > Math.max(8, u0 * 0.75), `from ${u0} m/s it fell to ${minSpeed.toFixed(1)}`);
    assert.ok(maxBeta > 5 * DEG && maxBeta < 25 * DEG, `from ${u0} m/s slide ${(maxBeta / DEG).toFixed(1)} deg`);
    assert.ok(maxSlip > 0.5, `tyres squeal (${maxSlip.toFixed(2)})`);
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
      assert.ok(minSpeed > 7 && v.speed > 10, `${tag} kept going (${minSpeed.toFixed(1)}, ${v.speed.toFixed(1)})`);
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
