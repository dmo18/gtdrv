import test from 'node:test';
import assert from 'node:assert/strict';
import { BOAT_SPECS, createBoat, stepBoat, collideBoats, waveHeight } from '../src/entities/boat.js';
import { createCollisionWorld } from '../src/world/collision.js';
import { createRng } from '../src/core/rng.js';

const DT = 1 / 60;
const IDS = ['speedboat', 'jetski', 'fisher', 'yacht', 'dinghy'];
const ctl = (throttle = 0, steer = 0, brake = 0) => ({ steer, throttle, brake, handbrake: false, pitch: 0 });

function run(b, controls, steps, world = {}) {
  const w = { time: 0, ...world };
  for (let i = 0; i < steps; i++) {
    w.time = (world.time || 0) + i * DT;
    stepBoat(b, controls, DT, w);
  }
  return w;
}

test('specs are complete and craft fields are set', () => {
  for (const id of IDS) {
    const s = BOAT_SPECS[id];
    assert.equal(s.id, id);
    assert.equal(typeof s.label, 'string');
    for (const k of ['length', 'width', 'height', 'health', 'maxSpeed', 'accel', 'turnRate', 'drag', 'draft', 'mass']) {
      assert.ok(s[k] > 0, `${id}.${k}`);
    }
    assert.ok(s.colors.length > 0);
  }
  assert.ok(BOAT_SPECS.speedboat.maxSpeed > BOAT_SPECS.yacht.maxSpeed);
  assert.ok(BOAT_SPECS.fisher.maxSpeed < BOAT_SPECS.dinghy.maxSpeed);
  const a = createBoat('jetski', 1, 2, 0.5, createRng(3));
  const b = createBoat('yacht', 0, 0);
  assert.equal(a.kind, 'boat');
  assert.ok(a.id >= 100000 && b.id > a.id);
  for (const k of ['x', 'z', 'y', 'heading', 'pitch', 'roll', 'px', 'pz', 'py', 'pheading', 'ppitch', 'proll',
    'vx', 'vz', 'vy', 'speed', 'throttle', 'brake', 'health', 'impact', 'radius', 'color', 'wake', 'planing']) {
    assert.equal(typeof a[k], 'number', k);
  }
  assert.equal(a.wrecked, false);
  assert.equal(a.driver, null);
});

test('accelerates to near but not over maxSpeed', () => {
  for (const id of IDS) {
    const b = createBoat(id, 0, 0, 0);
    let max = 0;
    const w = { time: 0 };
    for (let i = 0; i < 60 * 60; i++) {
      w.time = i * DT;
      stepBoat(b, ctl(1), DT, w);
      max = Math.max(max, b.speed);
    }
    assert.ok(max <= b.spec.maxSpeed + 1e-9, `${id} max ${max}`);
    assert.ok(b.speed > b.spec.maxSpeed * 0.85, `${id} final ${b.speed}`);
    assert.ok(b.planing > 0.5, `${id} planing ${b.planing}`);
    assert.ok(b.wake > 0.5, `${id} wake ${b.wake}`);
  }
});

test('coasts to a stop with throttle released', () => {
  const b = createBoat('speedboat', 0, 0, 0);
  b.vx = 28;
  run(b, ctl(0), 60 * 40);
  assert.ok(Math.abs(b.speed) < 0.05, `speed ${b.speed}`);
  assert.ok(b.x > 50, 'it glided a fair way first');
});

test('brake is reverse thrust: slows, then backs up', () => {
  const b = createBoat('speedboat', 0, 0, 0);
  b.vx = 20;
  let stopStep = -1;
  const w = { time: 0 };
  for (let i = 0; i < 60 * 15; i++) {
    stepBoat(b, ctl(0, 0, 1), DT, w);
    if (stopStep < 0 && b.speed <= 0) stopStep = i;
  }
  assert.ok(stopStep > 0 && stopStep < 60 * 5, `stopped at step ${stopStep}`);
  assert.ok(b.speed < -1 && b.speed >= -b.spec.reverseSpeed - 1e-9, `reverse ${b.speed}`);
});

test('right steer under power increases heading', () => {
  const b = createBoat('speedboat', 0, 0, 0);
  run(b, ctl(1), 120);
  const h0 = b.heading;
  run(b, ctl(1, 1), 30);
  assert.ok(b.heading > h0 + 0.1, `heading ${h0} -> ${b.heading}`);
  assert.ok(b.roll > 0, 'leans into the right turn');
});

test('turns harder at speed under power than at rest; weak when drifting', () => {
  const rate = (b, c) => {
    const h0 = b.heading;
    run(b, c, 30);
    return (b.heading - h0) / (30 * DT);
  };
  const fast = createBoat('speedboat', 0, 0, 0);
  fast.vx = 20;
  const atSpeed = rate(fast, ctl(1, 1));
  const still = createBoat('speedboat', 0, 0, 0);
  const atRest = rate(still, ctl(1, 1));
  const drift = createBoat('speedboat', 0, 0, 0);
  drift.vx = 20;
  const drifting = rate(drift, ctl(0, 1));
  assert.ok(atSpeed > atRest * 1.5, `at speed ${atSpeed} vs rest ${atRest}`);
  assert.ok(atRest > 0, 'prop wash gives some turn at rest');
  assert.ok(drifting < atSpeed * 0.6, `drifting ${drifting} vs powered ${atSpeed}`);
  const dead = createBoat('speedboat', 0, 0, 0);
  assert.ok(Math.abs(rate(dead, ctl(0, 1))) < 1e-6, 'no turn when stopped and unpowered');
});

test('slides sideways in a hard turn, and the slide bleeds off', () => {
  const b = createBoat('speedboat', 0, 0, 0);
  run(b, ctl(1), 600);
  run(b, ctl(1, 1), 45);
  const ch = Math.cos(b.heading), sh = Math.sin(b.heading);
  const lat = Math.abs(-b.vx * sh + b.vz * ch);
  assert.ok(lat > 1, `lateral ${lat}`);
  run(b, ctl(1), 240);
  const ch2 = Math.cos(b.heading), sh2 = Math.sin(b.heading);
  assert.ok(Math.abs(-b.vx * sh2 + b.vz * ch2) < lat * 0.2);
});

test('cannot enter land', () => {
  const city = { shoreDist: (x, z) => 100 - Math.hypot(x, z) };
  for (const id of IDS) {
    const b = createBoat(id, -220, 6, 0);
    const w = { city, time: 0 };
    let worst = -Infinity, hit = 0;
    for (let i = 0; i < 60 * 30; i++) {
      w.time = i * DT;
      stepBoat(b, ctl(1, i > 900 ? 0.3 : 0), DT, w);
      worst = Math.max(worst, city.shoreDist(b.x, b.z));
      hit = Math.max(hit, b.impact);
    }
    assert.ok(worst < 0, `${id} shoreDist reached ${worst}`);
    assert.ok(hit > 0, `${id} registered an impact`);
  }
  // A gentle nudge does no damage, a fast run in does.
  const slow = createBoat('speedboat', -103, 0, 0);
  slow.vx = 4;
  run(slow, ctl(0), 60, { city });
  assert.equal(slow.health, slow.spec.health);
  const fast = createBoat('speedboat', -106, 0, 0);
  fast.vx = 25;
  run(fast, ctl(0), 60, { city });
  assert.ok(fast.health < fast.spec.health);
});

test('pier in waterCollision blocks the boat', () => {
  const waterCollision = createCollisionWorld();
  waterCollision.addBox(40, -20, 50, 20, 2, 'pier');
  const b = createBoat('speedboat', 0, 0, 0);
  let maxX = -Infinity, hit = 0;
  const w = { waterCollision, time: 0 };
  for (let i = 0; i < 60 * 10; i++) {
    w.time = i * DT;
    stepBoat(b, ctl(1), DT, w);
    maxX = Math.max(maxX, b.x + b.spec.length / 2);
    hit = Math.max(hit, b.impact);
  }
  assert.ok(maxX < 40.2, `bow reached ${maxX}`);
  assert.ok(hit > 6, `impact ${hit}`);
  assert.ok(b.health < b.spec.health);
  // A buoy is a circle.
  const buoys = createCollisionWorld();
  buoys.addCircle(30, 0, 0.6, 1.5, 'buoy');
  const c = createBoat('jetski', 0, 0, 0);
  const off = c.spec.length / 2 - c.spec.width / 2;
  const wb = { waterCollision: buoys, time: 0 };
  let closest = Infinity;
  for (let i = 0; i < 300; i++) {
    stepBoat(c, ctl(0.6), DT, wb);
    const bx = c.x + Math.cos(c.heading) * off, bz = c.z + Math.sin(c.heading) * off;
    closest = Math.min(closest, Math.hypot(bx - 30, bz));
  }
  assert.ok(closest > 0.6 + c.spec.width / 2 - 0.05, `bow came within ${closest} of the buoy`);
});

test('bobbing y stays within a sane band and follows the waves', () => {
  for (const id of IDS) {
    const b = createBoat(id, 37, -12, 1);
    let lo = Infinity, hi = -Infinity;
    const w = { time: 0 };
    for (let i = 0; i < 60 * 20; i++) {
      w.time = i * DT;
      stepBoat(b, i < 600 ? null : ctl(1, Math.sin(i * 0.01)), DT, w);
      lo = Math.min(lo, b.y);
      hi = Math.max(hi, b.y);
      assert.ok(Math.abs(b.pitch) < 0.4 && Math.abs(b.roll) < 0.55, `${id} angles`);
    }
    assert.ok(lo > -0.4 && hi < 1.2, `${id} y in ${lo}..${hi}`);
    assert.ok(hi - lo > 0.05, `${id} actually bobs`);
  }
  for (let i = 0; i < 1000; i++) {
    const h = waveHeight(i * 7.3 - 2000, i * 3.1 - 900, i * 0.37);
    assert.ok(Math.abs(h) <= 0.25);
  }
});

test('null controls: drifts to rest and stays put', () => {
  const b = createBoat('fisher', 10, 10, 2);
  b.vx = 3;
  b.vz = -2;
  b.yawRate = 0.3;
  run(b, null, 60 * 30);
  const x = b.x, z = b.z, h = b.heading;
  run(b, null, 60 * 30, { time: 30 });
  assert.ok(Math.hypot(b.x - x, b.z - z) < 0.01, 'stays put');
  assert.ok(Math.abs(b.heading - h) < 0.01);
  assert.equal(b.throttle, 0);
  assert.ok(Number.isFinite(b.y));
});

test('collideBoats separates overlapping boats', () => {
  const a = createBoat('speedboat', 0, 0, 0);
  const b = createBoat('dinghy', 3.5, 0.3, 0.2);
  a.vx = 8;
  assert.equal(collideBoats(a, b), true);
  const ra = a.spec.width / 2, rb = b.spec.width / 2;
  // Run a few more passes; they must end apart.
  for (let i = 0; i < 10; i++) collideBoats(a, b);
  assert.equal(collideBoats(a, b), false);
  assert.ok(Math.hypot(b.x - a.x, b.z - a.z) > Math.min(ra, rb));
  assert.ok(b.vx > 0, 'pushed the light dinghy');
  const far = createBoat('yacht', 500, 0, 0);
  assert.equal(collideBoats(a, far), false);
});

test('no NaN in 3000 random steps', () => {
  const rng = createRng(42);
  const city = { shoreDist: (x, z) => 60 - Math.hypot(x - 120, z) };
  const waterCollision = createCollisionWorld();
  waterCollision.addBox(-30, -5, -20, 5, 2);
  waterCollision.addCircle(0, 40, 0.5, 1);
  const boats = IDS.map((id, i) => createBoat(id, -60 + i * 12, -20 + i * 3, rng.range(-3, 3), rng));
  const w = { city, waterCollision, time: 0 };
  let c = ctl();
  for (let i = 0; i < 3000; i++) {
    w.time = i * DT;
    if (i % 20 === 0) c = rng.chance(0.1) ? null : ctl(rng.next(), rng.range(-1, 1), rng.chance(0.3) ? rng.next() : 0);
    for (const b of boats) stepBoat(b, c, rng.chance(0.01) ? 0 : DT, w);
    for (let a = 0; a < boats.length; a++) for (let k = a + 1; k < boats.length; k++) collideBoats(boats[a], boats[k]);
  }
  for (const b of boats) {
    for (const k of ['x', 'z', 'y', 'heading', 'pitch', 'roll', 'vx', 'vz', 'vy', 'speed', 'wake', 'planing', 'health']) {
      assert.ok(Number.isFinite(b[k]), `${b.spec.id}.${k}`);
    }
    assert.ok(city.shoreDist(b.x, b.z) < 0);
  }
});
