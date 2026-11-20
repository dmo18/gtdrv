import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AIRCRAFT_SPECS, createAircraft, stepAircraft, collideAircraft,
} from '../src/entities/aircraft.js';
import { createCollisionWorld } from '../src/world/collision.js';
import { createRng } from '../src/core/rng.js';

const DT = 1 / 60;
const emptyWorld = () => ({ collision: createCollisionWorld() });
const seaWorld = () => ({ collision: createCollisionWorld(), city: { shoreDist: () => -100 } });
const run = (a, controls, steps, world = emptyWorld()) => {
  for (let i = 0; i < steps; i++) stepAircraft(a, controls, DT, world);
};
const ctl = (o = {}) => ({ steer: 0, pitch: 0, throttle: 0, brake: 0, handbrake: false, ...o });

// A plane already flying level at a given height and speed.
function airborne(specId, y, speed, heading = 0) {
  const a = createAircraft(specId, 0, 0, heading);
  a.onGround = false;
  a.y = y;
  a.airspeed = speed;
  a.speed = speed;
  a.driver = 'player';
  return a;
}

test('specs are complete, original ids, unique craft ids', () => {
  for (const id of ['prop', 'stunt', 'seaplane', 'jet', 'heli', 'heavyheli']) {
    const s = AIRCRAFT_SPECS[id];
    assert.ok(s, id);
    assert.equal(s.id, id);
    assert.ok(typeof s.label === 'string' && s.label.length > 0);
    for (const k of ['length', 'width', 'height', 'health', 'maxSpeed', 'mass']) assert.ok(s[k] > 0, `${id}.${k}`);
    assert.ok(s.colors.length > 0);
    assert.equal(s.kind, id.includes('heli') ? 'heli' : 'plane');
  }
  assert.equal(AIRCRAFT_SPECS.seaplane.floats, true);
  assert.ok(AIRCRAFT_SPECS.jet.maxSpeed >= 110);
  assert.ok(AIRCRAFT_SPECS.heavyheli.maxSpeed < AIRCRAFT_SPECS.heli.maxSpeed);
  const a = createAircraft('prop', 0, 0, 0), b = createAircraft('heli', 0, 0, 0, createRng(3));
  assert.ok(a.id >= 200000 && b.id > a.id);
  assert.equal(a.kind, 'plane');
  assert.equal(b.kind, 'heli');
  assert.equal(a.driver, null);
  assert.ok(AIRCRAFT_SPECS.heli.colors.includes(b.color));
});

test('prop plane takes off from rest within 500 m and climbs', () => {
  const a = createAircraft('prop', 0, 0, 0);
  const w = emptyWorld();
  let liftX = null;
  for (let i = 0; i < 60 * 40 && liftX === null; i++) {
    stepAircraft(a, ctl({ throttle: 1, pitch: 1 }), DT, w);
    if (!a.onGround) liftX = a.x;
  }
  assert.ok(liftX !== null && liftX < 500, `lift-off at ${liftX}`);
  run(a, ctl({ throttle: 1, pitch: 1 }), 600, w);
  assert.ok(a.y > 40, `climbed to ${a.y}`);
  assert.ok(!a.wrecked);
  assert.ok(a.pitch > 0.1);
});

test('lifts off by itself without up-stick, and inverted stick flips pitch', () => {
  const a = createAircraft('prop', 0, 0, 0);
  run(a, ctl({ throttle: 1 }), 60 * 20);
  assert.equal(a.onGround, false);
  assert.ok(a.x < 500 + 65 * 20);
  const b = airborne('prop', 200, 45);
  run(b, ctl({ throttle: 1, pitch: 1, invertPitch: true }), 120);
  assert.ok(b.pitch < -0.1 && b.y < 200);
});

test('the jet needs more runway than the trainer', () => {
  const dist = (id) => {
    const a = createAircraft(id, 0, 0, 0);
    const w = emptyWorld();
    for (let i = 0; i < 60 * 60 && a.onGround; i++) stepAircraft(a, ctl({ throttle: 1, pitch: 1 }), DT, w);
    assert.equal(a.onGround, false, id);
    return a.x;
  };
  const p = dist('prop'), j = dist('jet');
  assert.ok(j > p * 2, `prop ${p} jet ${j}`);
  assert.ok(j < 900);
});

test('level flight holds altitude with throttle and neutral stick', () => {
  const a = airborne('prop', 150, 50);
  run(a, ctl({ throttle: 1 }), 600);
  assert.ok(Math.abs(a.y - 150) < 5, `y ${a.y}`);
  assert.ok(a.airspeed > 50 && a.airspeed <= 66);
  assert.ok(!a.stalled);
});

test('right steer banks right and turns right; releasing levels out', () => {
  const a = airborne('prop', 150, 50);
  const w = emptyWorld();
  run(a, ctl({ throttle: 1, steer: 1 }), 90, w);
  assert.ok(a.roll > 0.5, `roll ${a.roll}`);
  assert.ok(a.roll <= 56 * Math.PI / 180);
  assert.ok(a.heading > 0.2, `heading ${a.heading}`);
  run(a, ctl({ throttle: 1 }), 180, w);
  assert.ok(Math.abs(a.roll) < 0.03, `roll after release ${a.roll}`);
  const h = a.heading;
  run(a, ctl({ throttle: 1 }), 60, w);
  assert.ok(Math.abs(a.heading - h) < 0.02);
  // The stunt plane banks much further.
  const s = airborne('stunt', 150, 50);
  run(s, ctl({ throttle: 1, steer: -1 }), 120);
  assert.ok(s.roll < -70 * Math.PI / 180 && s.heading < 0);
});

test('idle glide descends slowly and lands itself without a wreck', () => {
  for (const id of ['prop', 'stunt', 'jet']) {
    const a = airborne(id, 120, AIRCRAFT_SPECS[id].stallSpeed * 1.6);
    const w = emptyWorld();
    let maxSink = 0, steps = 0, touched = false, tdSpeed = 0;
    while (!a.onGround && steps < 60 * 300) {
      stepAircraft(a, ctl(), DT, w);
      if (a.y > 15) maxSink = Math.max(maxSink, -a.vy);
      if (a.touchdown) {
        touched = true;
        tdSpeed = a.touchdownSpeed;
      }
      steps++;
    }
    assert.ok(a.onGround, `${id} came down`);
    assert.ok(steps / 60 > 8, `${id} took ${steps / 60}s`);
    assert.ok(maxSink < 12, `${id} sink ${maxSink}`);
    assert.ok(touched && tdSpeed < 5, `${id} touchdown ${tdSpeed}`);
    assert.ok(!a.wrecked && !a.crashed, id);
    assert.equal(a.health, a.spec.health, id);
    run(a, ctl(), 60 * 40, w);
    assert.ok(Math.abs(a.speed) < 0.01, `${id} rolled to a stop`);
    assert.equal(a.y, 0);
  }
});

test('abandoned flying plane glides down; parked plane stays put', () => {
  const a = airborne('prop', 80, 40);
  a.driver = null;
  run(a, null, 60 * 120);
  assert.ok(a.onGround);
  const p = createAircraft('prop', 5, 6, 1);
  run(p, null, 600);
  assert.equal(p.x, 5);
  assert.equal(p.z, 6);
  assert.equal(p.heading, 1);
});

test('brake reverses slowly at a standstill; steering turns on the ground', () => {
  const a = createAircraft('prop', 0, 0, 0);
  const w = emptyWorld();
  run(a, ctl({ brake: 1 }), 240, w);
  assert.ok(a.x < -2 && a.speed < 0 && a.speed > -4.5);
  const b = createAircraft('prop', 0, 0, 0);
  run(b, ctl({ throttle: 0.4, steer: 1 }), 120, w);
  assert.ok(b.heading > 0.2 && b.onGround);
});

test('stall is gentle and recoverable', () => {
  const a = airborne('prop', 300, 12);
  const w = emptyWorld();
  stepAircraft(a, ctl({ throttle: 1 }), DT, w);
  assert.equal(a.stalled, true);
  run(a, ctl({ throttle: 1 }), 60 * 10, w);
  assert.equal(a.stalled, false);
  assert.ok(a.y > 200, `lost ${300 - a.y} m`);
  assert.ok(a.airspeed > AIRCRAFT_SPECS.prop.stallSpeed);
});

test('steep dive into the ground crashes', () => {
  const a = airborne('prop', 60, 55);
  run(a, ctl({ throttle: 1, pitch: -1 }), 600);
  assert.equal(a.crashed, true);
  assert.equal(a.wrecked, true);
  assert.equal(a.onGround, true);
  assert.equal(a.y, 0);
  assert.equal(a.speed, 0);
  const x = a.x;
  run(a, ctl({ throttle: 1 }), 120);
  assert.equal(a.x, x);
});

test('steeply banked touchdown is not a clean landing', () => {
  const a = airborne('prop', 1.5, 30);
  a.roll = 0.9;
  a.pitch = -0.1;
  run(a, ctl({ steer: 1, pitch: -0.5 }), 300);
  assert.ok(a.onGround);
  assert.ok(a.crashed || a.health < a.spec.health);
});

test('flying into a tall box crashes or blocks, never passes through', () => {
  for (const speed of [60, 120]) {
    const w = emptyWorld();
    w.collision.addBox(200, -40, 203, 40, 80);
    const a = airborne(speed > 100 ? 'jet' : 'prop', 30, speed);
    let maxX = 0;
    for (let i = 0; i < 600; i++) {
      stepAircraft(a, ctl({ throttle: 1 }), DT, w);
      maxX = Math.max(maxX, a.x);
    }
    assert.ok(maxX < 200, `reached ${maxX}`);
    assert.ok(a.crashed && a.wrecked);
    assert.ok(a.onGround && a.y === 0, 'the wreck fell to the ground');
  }
  // Coming down onto a roof from above is a crash too when steep.
  const w = emptyWorld();
  w.collision.addBox(40, -60, 500, 60, 40);
  const d = airborne('prop', 90, 55);
  run(d, ctl({ throttle: 1, pitch: -1 }), 600, w);
  assert.ok(d.crashed);
  assert.equal(d.y, 40);
  // A slow nudge into a wall on the ground is only a bump.
  const g = createAircraft('prop', 0, 0, 0);
  const w2 = emptyWorld();
  w2.collision.addBox(12, -20, 16, 20, 10);
  run(g, ctl({ throttle: 0.5 }), 200, w2);
  assert.ok(!g.crashed && g.x < 12);
});

test('non-float plane on water is wrecked; seaplane lands and takes off again', () => {
  const w = seaWorld();
  const a = airborne('prop', 60, 40);
  run(a, ctl(), 60 * 90, w);
  assert.equal(a.wrecked, true);
  assert.equal(a.y, 0);
  assert.equal(a.speed, 0);

  const s = airborne('seaplane', 60, 40);
  run(s, ctl(), 60 * 90, w);
  assert.ok(s.onGround && s.onWater);
  assert.ok(!s.wrecked);
  assert.equal(s.y, 0);
  const x0 = s.x;
  let lift = null;
  for (let i = 0; i < 60 * 60 && lift === null; i++) {
    stepAircraft(s, ctl({ throttle: 1, pitch: 1 }), DT, w);
    if (!s.onGround) lift = s.x - x0;
  }
  assert.ok(lift !== null && lift < 600, `water run ${lift}`);
  run(s, ctl({ throttle: 1, pitch: 1 }), 300, w);
  assert.ok(s.y > 15 && !s.onWater);
});

test('seaplane on water cannot taxi onto land', () => {
  // Land is x > 0; the seaplane starts at sea heading for the beach.
  const w = { collision: createCollisionWorld(), city: { shoreDist: (x) => x } };
  const s = createAircraft('seaplane', -60, 0, 0);
  for (let i = 0; i < 60 * 30; i++) {
    stepAircraft(s, ctl({ throttle: 0.35 }), DT, w);
    assert.ok(s.x < 0, `x ${s.x}`);
  }
  assert.ok(s.onWater && !s.wrecked);
  // And a wheeled plane is kept on land.
  const p = createAircraft('prop', 40, 0, Math.PI);
  for (let i = 0; i < 60 * 20; i++) stepAircraft(p, ctl({ throttle: 0.3 }), DT, w);
  assert.ok(p.x > 0 && !p.wrecked);
});

test('world edge turns the craft back and flags it', () => {
  const a = airborne('prop', 200, 55);
  a.x = 2590;
  let flagged = false;
  const w = emptyWorld();
  for (let i = 0; i < 60 * 60; i++) {
    stepAircraft(a, ctl({ throttle: 1 }), DT, w);
    if (a.turningBack) flagged = true;
    assert.ok(Math.hypot(a.x, a.z) < 3100);
  }
  assert.ok(flagged);
  assert.equal(a.turningBack, false);
  assert.ok(Math.hypot(a.x, a.z) < 2600);
});

test('ceiling is soft', () => {
  const a = airborne('stunt', 560, 60);
  run(a, ctl({ throttle: 1, pitch: 1 }), 60 * 30);
  assert.ok(a.y < 640 && a.y > 540, `y ${a.y}`);
  const h = createAircraft('heli', 0, 0, 0);
  h.driver = 'player';
  h.onGround = false;
  h.y = 590;
  h.rotorSpeed = 1;
  run(h, ctl({ throttle: 1 }), 60 * 20);
  assert.ok(h.y < 610, `heli y ${h.y}`);
});

test('heli spools up, climbs, hovers, flies forward and yaws', () => {
  for (const id of ['heli', 'heavyheli']) {
    const h = createAircraft(id, 0, 0, 0);
    const w = emptyWorld();
    // Nobody aboard: rotor stays still and throttle does nothing.
    run(h, ctl({ throttle: 1 }), 120, w);
    assert.equal(h.rotorSpeed, 0);
    assert.equal(h.y, 0);
    h.driver = 'player';
    run(h, ctl({ throttle: 1 }), 30, w);
    assert.ok(h.rotorSpeed > 0 && h.rotorSpeed < 0.8);
    assert.equal(h.y, 0, 'cannot lift below 0.8 rotor speed');
    run(h, ctl({ throttle: 1 }), 60 * 10, w);
    assert.equal(h.rotorSpeed, 1);
    assert.ok(h.y > 15, `${id} climbed to ${h.y}`);
    // Hover: no input holds altitude and position.
    run(h, ctl(), 120, w);
    const y0 = h.y;
    let dev = 0;
    for (let i = 0; i < 300; i++) {
      stepAircraft(h, ctl(), DT, w);
      dev = Math.max(dev, Math.abs(h.y - y0));
    }
    assert.ok(dev < 1, `${id} hover drift ${dev}`);
    assert.ok(Math.abs(h.speed) < 0.5);
    // Forward.
    const x0 = h.x;
    run(h, ctl({ pitch: 1 }), 300, w);
    assert.ok(h.x - x0 > 40, `${id} moved ${h.x - x0}`);
    assert.ok(h.pitch < -0.05, 'nose tilts down flying forward');
    assert.ok(h.speed <= h.spec.maxSpeed + 0.01);
    // Backward.
    run(h, ctl({ pitch: -1 }), 600, w);
    assert.ok(h.speed < -3);
    run(h, ctl(), 600, w);
    // Yaw.
    const hd = h.heading;
    run(h, ctl({ steer: 1 }), 60, w);
    assert.ok(h.heading - hd > 0.3, `${id} yawed ${h.heading - hd}`);
    assert.ok(h.roll > 0);
  }
});

test('heli lands softly on a 30 m roof', () => {
  const w = emptyWorld();
  w.collision.addBox(-20, -20, 20, 20, 30);
  const h = createAircraft('heli', 0, 0, 0);
  h.driver = 'player';
  h.onGround = false;
  h.y = 60;
  h.rotorSpeed = 1;
  let td = -1;
  for (let i = 0; i < 60 * 40; i++) {
    stepAircraft(h, ctl({ brake: 1 }), DT, w);
    if (h.touchdown) td = h.touchdownSpeed;
  }
  assert.equal(h.y, 30);
  assert.ok(h.onGround && !h.wrecked);
  assert.ok(td >= 0 && td < 2.5, `touchdown ${td}`);
  assert.equal(h.health, h.spec.health);
  // Parked on the roof it is not shoved off by the building under it.
  run(h, null, 600, w);
  assert.equal(h.x, 0);
  assert.equal(h.y, 30);
  // Take off again from the roof.
  run(h, ctl({ throttle: 1 }), 600, w);
  assert.ok(h.y > 31);
});

test('heli placed over a roof starts on it; heli on water is wrecked', () => {
  const w = emptyWorld();
  w.collision.addBox(-20, -20, 20, 20, 18);
  const h = createAircraft('heli', 0, 0, 0);
  run(h, null, 5, w);
  assert.equal(h.y, 18);
  const s = seaWorld();
  const d = createAircraft('heli', 0, 0, 0);
  d.driver = 'player';
  d.onGround = false;
  d.y = 20;
  d.rotorSpeed = 1;
  run(d, ctl({ brake: 1 }), 60 * 30, s);
  assert.ok(d.wrecked);
  assert.equal(d.y, 0);
});

test('heli flying fast into a wall crashes; abandoned heli comes down', () => {
  const w = emptyWorld();
  w.collision.addBox(300, -50, 320, 50, 90);
  const h = createAircraft('heli', 0, 0, 0);
  h.driver = 'player';
  h.onGround = false;
  h.y = 40;
  h.rotorSpeed = 1;
  let maxX = 0;
  for (let i = 0; i < 60 * 30; i++) {
    stepAircraft(h, ctl({ pitch: 1 }), DT, w);
    maxX = Math.max(maxX, h.x);
  }
  assert.ok(h.crashed && maxX < 300);
  const b = createAircraft('heli', 0, 0, 0);
  b.onGround = false;
  b.y = 50;
  b.rotorSpeed = 1;
  run(b, null, 60 * 60);
  assert.ok(b.onGround && b.y === 0);
});

test('collideAircraft separates, damages and reports contact', () => {
  const a = createAircraft('prop', 0, 0, 0);
  const b = createAircraft('prop', 6, 0, Math.PI);
  a.vx = 6;
  b.vx = -6;
  assert.equal(collideAircraft(a, b), true);
  assert.ok(a.vx < 6 && b.vx > -6);
  assert.ok(a.impact > 0 && b.impact > 0);
  assert.ok(a.health < a.spec.health);
  assert.ok(b.x - a.x > 6);
  const far = createAircraft('prop', 100, 0, 0);
  assert.equal(collideAircraft(a, far), false);
  // Height matters.
  const high = airborne('prop', 60, 50);
  const low = createAircraft('heli', 0, 0, 0);
  assert.equal(collideAircraft(high, low), false);
  // A mid-air hit at speed wrecks a flying plane; a car is damaged too.
  const p = airborne('prop', 1, 50);
  p.vx = 50;
  const car = { kind: 'car', x: 3, z: 0, y: 0, vx: 0, vz: 0, radius: 2.5, impact: 0, health: 900, wrecked: false, spec: { mass: 1400 } };
  assert.equal(collideAircraft(p, car), true);
  assert.ok(p.crashed);
  assert.ok(car.health < 900 && car.vx > 0);
});

test('no NaN in 4000 random steps for each spec', () => {
  for (const id of Object.keys(AIRCRAFT_SPECS)) {
    const rng = createRng(id.length * 7919 + 5);
    const col = createCollisionWorld();
    for (let i = 0; i < 40; i++) {
      const x = rng.range(-900, 900), z = rng.range(-900, 900);
      col.addBox(x, z, x + rng.range(8, 40), z + rng.range(8, 40), rng.range(5, 90));
    }
    for (let i = 0; i < 30; i++) col.addCircle(rng.range(-300, 300), rng.range(-300, 300), 0.6, 6);
    const world = { collision: col, city: { shoreDist: (x, z) => 700 - Math.hypot(x, z) }, time: 0 };
    let a = createAircraft(id, 0, 0, 0, rng);
    a.driver = 'player';
    const c = ctl();
    for (let i = 0; i < 4000; i++) {
      if (i % 30 === 0) {
        c.steer = rng.range(-1, 1);
        c.pitch = rng.range(-1, 1);
        c.throttle = rng.chance(0.75) ? 1 : 0;
        c.brake = rng.chance(0.2) ? 1 : 0;
        c.invertPitch = rng.chance(0.1);
      }
      stepAircraft(a, rng.chance(0.02) ? null : c, DT, world);
      world.time += DT;
      for (const k of ['x', 'y', 'z', 'heading', 'pitch', 'roll', 'vx', 'vy', 'vz', 'speed', 'airspeed', 'propSpin', 'rotorSpeed', 'gearCompress', 'health', 'impact', 'px', 'py', 'pz', 'pheading', 'ppitch', 'proll']) {
        assert.ok(Number.isFinite(a[k]), `${id}.${k} step ${i}: ${a[k]}`);
      }
      assert.ok(a.y >= 0 && a.y < 700, `${id} y ${a.y}`);
      assert.ok(Math.abs(a.heading) <= Math.PI + 1e-9);
      if (a.wrecked && i % 400 === 399) {
        // Respawn so the whole run exercises live flight.
        a = createAircraft(id, rng.range(-100, 100), rng.range(-100, 100), rng.range(-3, 3), rng);
        a.driver = 'player';
        if (rng.chance(0.5)) {
          a.onGround = false;
          a.y = rng.range(20, 300);
          a.airspeed = rng.range(0, 90);
          a.rotorSpeed = 1;
        }
      }
    }
  }
});

// ---- task 33: Gannetfang fighter, Lampwatch police heli -------------------------
test('fighter and police heli specs follow ARMS.md', () => {
  const f = AIRCRAFT_SPECS.fighter, h = AIRCRAFT_SPECS.patrolheli;
  assert.equal(f.label, 'Gannetfang');
  assert.equal(f.kind, 'plane');
  assert.deepEqual([f.length, f.width, f.height, f.health, f.maxSpeed, f.stallSpeed, f.thrust], [13.4, 9.6, 3.6, 700, 130, 30, 14]);
  assert.deepEqual(f.mounts, ['nosegun', 'missile', 'bomb']);
  assert.equal(f.armor.bullet, 0.3);
  assert.equal(f.engine, 'turbine');
  assert.ok(f.noStall && f.cruise === 0.45);
  assert.equal(h.label, 'Lampwatch');
  assert.equal(h.kind, 'heli');
  assert.deepEqual([h.length, h.width, h.height, h.health, h.maxSpeed, h.climbRate, h.accel, h.yawRate, h.blades], [10.2, 9.6, 3.2, 360, 46, 10, 10, 1.6, 4]);
  assert.deepEqual(h.mounts, ['chingun']);
  assert.ok(h.police);
  assert.deepEqual(AIRCRAFT_SPECS.heavyheli.mounts, ['drop']);
  const c = createAircraft('patrolheli', 0, 0, 0, createRng(1));
  assert.equal(c.siren, false);
  assert.equal(c.spot, 0);
});

test('fighter takes off within 3.5 s and 400 m, reaches speed and climbs', () => {
  const a = createAircraft('fighter', 0, 0, 0);
  a.driver = 'player';
  const w = emptyWorld();
  let t = null;
  for (let i = 0; i < 60 * 6 && t === null; i++) {
    stepAircraft(a, ctl({ throttle: 1, pitch: 0.4 }), DT, w);
    if (!a.onGround) t = i * DT;
  }
  assert.ok(t !== null && t <= 3.5 && a.x < 400, `lift-off at ${t} s, ${a.x} m`);
  run(a, ctl({ throttle: 1, pitch: 0.5 }), 60 * 8, w);
  assert.ok(a.y > 150, `climbed to ${a.y}`);
  run(a, ctl({ throttle: 1 }), 60 * 10, w);
  assert.ok(a.airspeed > 125, `speed ${a.airspeed}`);
  assert.ok(a.afterburner > 0.95);
  assert.ok(!a.wrecked && !a.stalled);
});

test('fighter afterburner: full THRUST is faster than 0.85; glow state falls off', () => {
  const top = (th) => {
    const a = airborne('fighter', 300, 90);
    run(a, ctl({ throttle: th }), 60 * 30);
    return a;
  };
  const ab = top(1), dry = top(0.85);
  assert.ok(ab.airspeed > dry.airspeed + 15, `${ab.airspeed} vs ${dry.airspeed}`);
  assert.ok(ab.afterburner === 1 && dry.afterburner === 0);
});

test('fighter: cruise floor holds speed with THRUST released, BRAKE slows to 1.1 x stall', () => {
  const a = airborne('fighter', 300, 100);
  run(a, ctl(), 60 * 40);
  assert.ok(a.airspeed > 80 && Math.abs(a.y - 300) < 60, `cruise ${a.airspeed} at ${a.y}`);
  assert.ok(a.throttle >= 0.45);
  run(a, ctl({ brake: 1 }), 60 * 30);
  assert.ok(a.airspeed >= 30 && a.airspeed < 45, `braked to ${a.airspeed}`);
  assert.ok(!a.stalled);
});

test('fighter: 60 s of random stick never stalls, rolls and turns, levels itself', () => {
  const rng = createRng(33);
  const a = airborne('fighter', 400, 100);
  const c = ctl({ throttle: 1 });
  let turned = 0;
  for (let i = 0; i < 3600; i++) {
    if (i % 20 === 0) {
      c.steer = rng.range(-1, 1);
      c.pitch = rng.range(-1, 1);
      c.throttle = rng.chance(0.5) ? 1 : 0;
      if (a.y < 150) c.pitch = 0.8;
    }
    const h = a.heading;
    stepAircraft(a, c, DT, emptyWorld());
    turned += Math.abs(a.heading - h) < 1 ? Math.abs(a.heading - h) : 0;
    assert.ok(!a.stalled && a.airspeed >= 30 - 1e-9, `stalled at ${i}: ${a.airspeed}`);
    assert.ok(Number.isFinite(a.x + a.y + a.z + a.roll + a.pitch));
  }
  assert.ok(!a.wrecked);
  assert.ok(turned > 6, `turned ${turned} rad`);
  // Full right stick banks hard, then centring levels out.
  run(a, ctl({ steer: 1, throttle: 1 }), 60);
  assert.ok(a.roll > 1.2, `bank ${a.roll}`);
  run(a, ctl({ throttle: 1 }), 90);
  assert.ok(Math.abs(a.roll) < 0.05, `levelled to ${a.roll}`);
  // Vertical climb with no throttle: the nose eases down, no stall.
  run(a, ctl({ pitch: 1, brake: 1 }), 60 * 20);
  assert.ok(!a.stalled && a.airspeed >= 30);
});

test('police heli lifts off its pad and hovers', () => {
  const h = createAircraft('patrolheli', 0, 0, 0);
  h.driver = 'player';
  const w = emptyWorld();
  run(h, ctl({ throttle: 1 }), 60 * 8, w);
  assert.ok(!h.onGround && h.y > 15, `climbed to ${h.y}`);
  run(h, ctl(), 120, w);
  const y0 = h.y, x0 = h.x;
  run(h, ctl(), 300, w);
  assert.ok(Math.abs(h.y - y0) < 1 && Math.abs(h.x - x0) < 1);
});
