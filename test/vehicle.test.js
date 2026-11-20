import test from 'node:test';
import assert from 'node:assert/strict';
import {
  VEHICLE_SPECS, createVehicle, stepVehicle, collideVehicles, vehicleCorners, damageVehicle, setHandlingMode,
} from '../src/entities/vehicle.js';
import { createCollisionWorld } from '../src/world/collision.js';
import { createRng } from '../src/core/rng.js';

const DT = 1 / 60;
const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
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
    assert.ok(['fwd', 'rwd', 'awd'].includes(s.drive), `${id}.drive`);
    assert.ok(Number.isInteger(s.gears) && s.gears >= 4 && s.gears <= 6, `${id}.gears`);
    assert.ok(s.power > 0 && s.firstGear > 0 && s.cgFront > 0.3 && s.cgFront < 0.7, `${id} drivetrain`);
  }
  assert.equal(VEHICLE_SPECS.sports.drive, 'rwd');
  assert.equal(VEHICLE_SPECS.muscle.drive, 'rwd');
  assert.equal(VEHICLE_SPECS.sedan.drive, 'fwd');
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

// ---- Driving feel: drivetrain, brakes, tyres, assists. ----

const PLAYER = (o) => ({ steer: 0, throttle: 0, brake: 0, handbrake: false, steerMode: 'proportional', ...o });
const bodySlip = (v) => {
  const ch = Math.cos(v.heading), sh = Math.sin(v.heading);
  return Math.atan2(-v.vx * sh + v.vz * ch, v.vx * ch + v.vz * sh);
};
const DEG = Math.PI / 180;
// Run a test body in one handling mode, then go back to the default.
const inMode = (mode, fn) => () => {
  setHandlingMode(mode);
  try { fn(); } finally { setHandlingMode('arcade'); }
};

test('0-100 km/h times fall in believable bands per spec', () => {
  const bands = {
    compact: [9, 12.5], sedan: [8, 10.5], taxi: [8, 10.5], sports: [3.6, 5.2], muscle: [4.8, 6.8],
    pickup: [8.5, 11.5], van: [11, 15], police: [5.2, 7.5],
  };
  const timeTo = (id, target) => {
    const v = createVehicle(id, 0, 0, 0);
    const world = emptyWorld();
    for (let i = 1; i <= 60 * 40; i++) {
      stepVehicle(v, PLAYER({ throttle: 1 }), DT, world);
      if (v.speed >= target) return i * DT;
    }
    return Infinity;
  };
  for (const [id, [lo, hi]] of Object.entries(bands)) {
    const t = timeTo(id, 100 / 3.6);
    assert.ok(t >= lo && t <= hi, `${id} 0-100 in ${t.toFixed(2)} s, want ${lo}..${hi}`);
  }
  // The truck tops out near 100 km/h: 0-80 is slow.
  const t80 = timeTo('truck', 80 / 3.6);
  assert.ok(t80 > 11 && t80 < 20, `truck 0-80 in ${t80.toFixed(2)} s`);
  assert.ok(timeTo('sports', 27.78) < timeTo('sedan', 27.78) - 3);
});

test('braking from 100 km/h stops in a realistic distance, with ABS and no lock', () => {
  const bands = { sedan: [34, 46], sports: [28, 38], compact: [36, 48], truck: [45, 65], police: [32, 44] };
  for (const [id, [lo, hi]] of Object.entries(bands)) {
    const v = createVehicle(id, 0, 0, 0);
    v.vx = 100 / 3.6;
    const world = emptyWorld();
    let steps = 0, absSeen = false, maxPitch = 0;
    do {
      stepVehicle(v, PLAYER({ brake: 1 }), DT, world);
      steps++;
      absSeen = absSeen || v.abs;
      maxPitch = Math.min(maxPitch, v.pitch);
      // Wheels never lock: no sideways sliding or squeal beyond ABS chatter.
      assert.ok(v.slip <= 0.31, `${id} slip ${v.slip}`);
    } while (v.speed > 0.05 && v.gear !== 0 && steps < 600);
    assert.ok(v.x >= lo && v.x <= hi, `${id} stopped in ${v.x.toFixed(1)} m, want ${lo}..${hi}`);
    assert.ok(absSeen, `${id} ABS active`);
    assert.ok(maxPitch < -0.02, `${id} nose dives (${maxPitch.toFixed(3)})`);
  }
});

test('steady cornering at 20 m/s with full steer settles to a constant radius (sim)', inMode('sim', () => {
  for (const id of ['sedan', 'sports', 'muscle', 'truck']) {
    const v = createVehicle(id, 0, 0, 0);
    v.vx = 20;
    const world = emptyWorld();
    const yaw = [];
    let maxBeta = 0;
    for (let i = 0; i < 60 * 10; i++) {
      // Hold about 20 m/s.
      const throttle = clamp01((20 - v.speed) * 0.5);
      stepVehicle(v, PLAYER({ steer: 1, throttle }), DT, world);
      if (i >= 60 * 5) {
        yaw.push(v.yawRate);
        maxBeta = Math.max(maxBeta, Math.abs(bodySlip(v)));
      }
    }
    const mean = yaw.reduce((a, b) => a + b, 0) / yaw.length;
    const spread = Math.max(...yaw) - Math.min(...yaw);
    const radius = v.speed / mean;
    const latG = v.speed * mean / 9.81;
    assert.ok(spread < 0.02, `${id} yaw rate wanders ${spread.toFixed(3)}`);
    assert.ok(maxBeta < 6 * DEG, `${id} body slip ${(maxBeta / DEG).toFixed(1)} deg`);
    // Full input asks for ~0.85 of grip, never a spin.
    const g = v.spec.grip;
    assert.ok(latG > 0.7 * g && latG < 0.95 * g, `${id} lateral ${latG.toFixed(2)} g (grip ${g})`);
    assert.ok(radius > 30 && radius < 70, `${id} radius ${radius.toFixed(1)} m`);
    assert.ok(Math.abs(v.roll) > 0.02 && v.roll < 0, `${id} leans out of a right turn (roll ${v.roll.toFixed(3)})`);
  }
}));

test('releasing the steering at 40 m/s returns straight without weaving', () => {
  for (const id of ['sports', 'police', 'muscle', 'sedan']) {
    const v = createVehicle(id, 0, 0, 0);
    v.vx = 40;
    const world = emptyWorld();
    for (let i = 0; i < 120; i++) stepVehicle(v, PLAYER({ steer: 0.7, throttle: 0.5 }), DT, world);
    assert.ok(v.yawRate > 0.1, `${id} was turning (${v.yawRate.toFixed(2)})`);
    const hs = [];
    let settled = -1;
    for (let i = 0; i < 180; i++) {
      stepVehicle(v, PLAYER({ throttle: 0.5 }), DT, world);
      hs.push(v.heading);
      if (settled < 0 && Math.abs(v.yawRate) < 0.01) settled = (i + 1) * DT;
    }
    assert.ok(settled > 0 && settled <= 1.5, `${id} straight after ${settled.toFixed(2)} s`);
    // After the heading peaks it may only creep back a hair: no weave.
    const peak = Math.max(...hs);
    const after = hs.slice(hs.indexOf(peak));
    const back = peak - Math.min(...after);
    assert.ok(back < 2 * DEG, `${id} heading swings back ${(back / DEG).toFixed(2)} deg`);
    const tail = hs.slice(-60);
    assert.ok(Math.max(...tail) - Math.min(...tail) < 0.1 * DEG, `${id} still yawing at the end`);
  }
});

test('rwd car: handbrake starts a slide, the assist recovers it after release (sim)', inMode('sim', () => {
  for (const id of ['sports', 'muscle']) {
    const v = createVehicle(id, 0, 0, 0);
    v.vx = 20;
    const world = emptyWorld();
    let maxBeta = 0, maxSlip = 0;
    for (let i = 0; i < 50; i++) {
      stepVehicle(v, PLAYER({ steer: 1, handbrake: true }), DT, world);
      maxBeta = Math.max(maxBeta, Math.abs(bodySlip(v)));
      maxSlip = Math.max(maxSlip, v.slip);
    }
    assert.ok(maxBeta > 15 * DEG, `${id} slide ${(maxBeta / DEG).toFixed(1)} deg`);
    assert.ok(maxSlip > 0.5, `${id} squeal ${maxSlip}`);
    let recovered = -1;
    for (let i = 0; i < 180; i++) {
      stepVehicle(v, PLAYER({ throttle: 0.3 }), DT, world);
      if (recovered < 0 && Math.abs(bodySlip(v)) < 3 * DEG && Math.abs(v.yawRate) < 0.1) recovered = (i + 1) * DT;
    }
    assert.ok(recovered > 0 && recovered < 2, `${id} recovered after ${recovered.toFixed(2)} s`);
    assert.ok(v.speed > 10, `${id} still driving at ${v.speed.toFixed(1)}`);
    assert.ok(Math.abs(bodySlip(v)) < 1 * DEG);
  }
}));

test('power oversteer in rwd cars, gentle understeer in fwd ones; assist catches it (sim)', inMode('sim', () => {
  const powerOn = (id) => {
    const v = createVehicle(id, 0, 0, 0);
    v.vx = 12;
    const world = emptyWorld();
    for (let i = 0; i < 180; i++) stepVehicle(v, PLAYER({ steer: 0.8, throttle: 0.25 }), DT, world);
    const before = v.yawRate;
    let maxBeta = 0, maxYaw = 0;
    for (let i = 0; i < 120; i++) {
      stepVehicle(v, PLAYER({ steer: 0.8, throttle: 1 }), DT, world);
      maxBeta = Math.max(maxBeta, Math.abs(bodySlip(v)));
      maxYaw = Math.max(maxYaw, v.yawRate);
    }
    return { before, maxBeta, maxYaw, end: Math.abs(bodySlip(v)) };
  };
  const m = powerOn('muscle');
  assert.ok(m.maxYaw > m.before * 1.3 && m.maxBeta > 6 * DEG, `muscle oversteer ${JSON.stringify(m)}`);
  assert.ok(m.maxBeta < 25 * DEG, `muscle caught before spinning ${(m.maxBeta / DEG).toFixed(1)}`);
  const s = powerOn('sedan');
  assert.ok(s.maxYaw <= s.before * 1.05 && s.maxBeta < 3 * DEG, `sedan understeers ${JSON.stringify(s)}`);
  // Off the throttle the front bites harder than on it (weight transfer).
  const turnIn = (throttle) => {
    const v = createVehicle('sedan', 0, 0, 0);
    v.vx = 18;
    run(v, PLAYER({ steer: 1, throttle }), 60);
    return v.yawRate;
  };
  assert.ok(turnIn(0) > turnIn(1) * 1.2);
}));

test('gearbox: gears and revs stay in range, upshifts under full throttle', () => {
  for (const id of ['sedan', 'sports', 'truck', 'van']) {
    const v = createVehicle(id, 0, 0, 0);
    const world = emptyWorld();
    assert.equal(v.gear, 1);
    let maxGear = 0, ups = 0, last = v.gear, dip = false;
    for (let i = 0; i < 60 * 30; i++) {
      const before = v.speed;
      stepVehicle(v, PLAYER({ throttle: 1 }), DT, world);
      assert.ok(Number.isInteger(v.gear) && v.gear >= 1 && v.gear <= v.spec.gears, `${id} gear ${v.gear}`);
      assert.ok(v.rpm >= 0 && v.rpm <= 1, `${id} rpm ${v.rpm}`);
      if (v.gear > last) ups++;
      if (v.shiftT > 0 && v.speed - before < 0.02) dip = true;
      last = v.gear;
      maxGear = Math.max(maxGear, v.gear);
    }
    assert.ok(ups >= v.spec.gears - 2, `${id} upshifts ${ups}`);
    assert.ok(maxGear >= v.spec.gears - 1, `${id} top gear ${maxGear}`);
    assert.ok(v.rpm > 0.6, `${id} revs at speed ${v.rpm}`);
    assert.ok(dip, `${id} torque dips during a shift`);
    // Reverse is gear 0, and revs fall back to idle when stopped.
    const r = createVehicle(id, 0, 0, 0);
    run(r, PLAYER({ brake: 1 }), 60);
    assert.equal(r.gear, 0);
    assert.ok(r.speed < 0);
    run(r, PLAYER({}), 240);
    assert.ok(r.rpm < 0.2, `${id} idle ${r.rpm}`);
  }
});

test('engine braking slows a coasting car; body pitch and roll settle', () => {
  const coast = createVehicle('sedan', 0, 0, 0);
  coast.vx = 25;
  const world = emptyWorld();
  run(coast, PLAYER({}), 120, world);
  const lost = 25 - coast.speed;
  assert.ok(lost > 1 && lost < 6, `coasting lost ${lost.toFixed(2)} m/s in 2 s`);
  // Squat under power, then the springs settle at a steady cruise.
  const v = createVehicle('sedan', 0, 0, 0);
  let maxPitch = 0;
  for (let i = 0; i < 60; i++) {
    stepVehicle(v, PLAYER({ throttle: 1 }), DT, world);
    maxPitch = Math.max(maxPitch, v.pitch);
  }
  assert.ok(maxPitch > 0.01, `squat ${maxPitch}`);
  v.vx = Math.cos(v.heading) * 15;
  v.vz = Math.sin(v.heading) * 15;
  run(v, PLAYER({ throttle: 0.12 }), 300, world);
  assert.ok(Math.abs(v.pitch) < 0.01 && Math.abs(v.roll) < 0.002, `settled ${v.pitch} ${v.roll}`);
  assert.ok(Math.abs(v.pitchV) < 0.01 && Math.abs(v.rollV) < 0.01);
});

test('a kerb or wall strike adds suspension travel that decays', () => {
  const col = createCollisionWorld();
  col.addBox(20, -20, 26, 20, 10);
  const world = { collision: col };
  const v = createVehicle('sedan', 0, 0, 0);
  v.vx = 15;
  let peak = 0;
  for (let i = 0; i < 120; i++) {
    stepVehicle(v, PLAYER({}), DT, world);
    peak = Math.max(peak, v.suspension);
  }
  assert.ok(peak > 0.5 && peak <= 1, `suspension ${peak}`);
  run(v, PLAYER({}), 300, world);
  assert.ok(v.suspension < 0.05);
});

test('AI steering keeps its angle mapping, and the same lock as the player', () => {
  // Traffic and police turn a wanted wheel angle into steer with
  // steerMax / (1 + u / 20); at town speeds that must still hold.
  const s = VEHICLE_SPECS.sedan;
  const v = createVehicle('sedan', 0, 0, 0);
  v.vx = 5;
  run(v, { steer: 0.5, throttle: 0.1, brake: 0, handbrake: false }, 40);
  const expect = 0.5 * s.steerMax / (1 + Math.abs(v.speed) / 20);
  assert.ok(Math.abs(v.steerAngle - expect) < 0.01, `${v.steerAngle} vs ${expect}`);
  // At speed full input from either is clipped to the grip-based lock.
  const a = createVehicle('sedan', 0, 0, 0), p = createVehicle('sedan', 0, 0, 0);
  a.vx = p.vx = 30;
  run(a, { steer: 1, throttle: 0.3, brake: 0, handbrake: false }, 60);
  run(p, PLAYER({ steer: 1, throttle: 0.3 }), 60);
  assert.ok(Math.abs(a.steerAngle - p.steerAngle) < 0.002);
  assert.ok(p.steerAngle < s.steerMax / (1 + 30 / 20) * 0.5, `lock at 30 m/s ${p.steerAngle}`);
  // Half input from the player is about half the lock (useful range).
  const q = createVehicle('sedan', 0, 0, 0);
  q.vx = 30;
  run(q, PLAYER({ steer: 0.5, throttle: 0.3 }), 60);
  assert.ok(Math.abs(q.steerAngle / p.steerAngle - 0.5) < 0.05);
});
