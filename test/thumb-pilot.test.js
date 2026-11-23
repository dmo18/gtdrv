// A coarse thumb flies every plane through a whole sortie: take-off, climb
// to 150 m, a full circle at about 30 degrees of bank, back around and a
// landing on the runway (the seaplane on open water). The thumb sees the
// plane 180 ms late, sweeps the stick at most 4 units a second, shakes
// by up to 0.08 and sags 0.12 down while it holds a turn. Arcade flight
// (docs/PLAN_V3.md section 13, AIR) must forgive all of that.
import test from 'node:test';
import assert from 'node:assert/strict';
import { AIRCRAFT_SPECS, createAircraft, stepAircraft } from '../src/entities/aircraft.js';
import { createCollisionWorld } from '../src/world/collision.js';
import { createRng, clamp, angleDiff } from '../src/core/rng.js';

const DT = 1 / 60;
const DEG = Math.PI / 180;
const X0 = -1200; // runway from x = X0 to X0 + 710 (the airfield's length), z -15..15
const RW_END = X0 + 710;
const DELAY = Math.round(0.18 / DT);
const RATE = 4 * DT;

function thumbFlight(id, seed) {
  const sea = id === 'seaplane';
  const world = sea
    ? { collision: createCollisionWorld(), city: { shoreDist: () => -100 } }
    : { collision: createCollisionWorld() };
  const rng = createRng(seed);
  const a = createAircraft(id, X0 + 30, 0, 0);
  a.driver = 'player';
  const s = a.spec;
  const seen = [];
  const ctl = { steer: 0, pitch: 0, throttle: 0, brake: 0, boost: false };
  const want = { steer: 0, pitch: 0, throttle: 0, brake: 0 };
  let noiseS = 0, noiseP = 0;
  let phase = 'takeoff', turned = 0, lastH = 0, circleY0 = 0, circleMinY = Infinity, circleT = 0;
  const out = {
    liftX: null, liftV: null, circleLoss: null, circleT: null,
    tdSink: null, tdBank: null, tdX: null, tdZ: null, stopX: null, stopZ: null,
    maxRoll: 0, maxPitch: 0, stalled: false, phase: '', wrecked: false, health: 0,
  };
  for (let i = 0; i < 60 * 400; i++) {
    seen.push({ x: a.x, y: a.y, z: a.z, h: a.heading, g: a.onGround });
    if (seen.length > DELAY + 1) seen.shift();
    const o = seen[0]; // what the thumb saw 180 ms ago
    const holdAlt = (y) => (o.y < y - 6 ? 0.3 : o.y > y + 6 ? -0.25 : 0);
    const seek = (tx, tz, lim = 0.7) => clamp(angleDiff(Math.atan2(tz - o.z, tx - o.x), o.h) * 1.5, -lim, lim);
    want.throttle = 1;
    want.brake = 0;
    if (phase === 'takeoff') {
      // Full THRUST and a light pull the whole run; keep it on the centerline.
      want.steer = clamp(-o.z * 0.05 - angleDiff(o.h, 0) * 1.5, -0.4, 0.4);
      want.pitch = 0.3;
      if (!o.g && o.y > 20) phase = 'climb';
    } else if (phase === 'climb') {
      want.steer = seek(o.x + 400, 0);
      want.pitch = o.y < 135 ? 0.5 : 0;
      if (o.y >= 135) phase = 'level';
    } else if (phase === 'level') {
      want.steer = seek(o.x + 400, 0);
      want.pitch = holdAlt(150);
      if (o.x > -200) {
        phase = 'circle';
        lastH = a.heading;
        circleY0 = a.y;
      }
    } else if (phase === 'circle') {
      // Stick held at about 30 degrees of bank, the thumb sagging down a little.
      want.steer = (30 * DEG) / s.maxBank;
      want.pitch = -0.12;
      turned += angleDiff(a.heading, lastH);
      lastH = a.heading;
      circleT += DT;
      circleMinY = Math.min(circleMinY, a.y);
      if (turned >= 2 * Math.PI) {
        phase = 'return';
        out.circleLoss = circleY0 - circleMinY;
        out.circleT = circleT;
      }
    } else if (phase === 'return') {
      want.steer = seek(1500, 800);
      want.pitch = holdAlt(150);
      if (Math.hypot(o.x - 1500, o.z - 800) < 300) phase = 'base';
    } else if (phase === 'base') {
      want.steer = seek(1000, 0);
      want.pitch = holdAlt(150);
      if (Math.abs(angleDiff(o.h, Math.PI)) < 0.6 && o.x < 1400) phase = 'final';
    } else if (phase === 'final') {
      // Chase the centerline, coarse glide toward x = X0 + 560: too high,
      // THRUST off and push a bit; too low, THRUST on; the last 12 m hands off.
      const hi = o.y - clamp((o.x - (X0 + 560)) * Math.tan(4 * DEG), 0, 400);
      want.pitch = hi > 12 ? -0.3 : hi < -12 ? 0.15 : 0;
      want.throttle = hi > 12 ? 0 : hi < -12 ? 1 : hi < 0 ? 1 : 0;
      if (o.y < 12) {
        want.throttle = 0;
        want.pitch = 0;
      }
      want.steer = seek(o.x - 500, 0, 0.5);
      if (o.g) phase = 'rollout';
    } else {
      want.steer = clamp(o.z * 0.05 - angleDiff(o.h, Math.PI) * 1.5, -0.4, 0.4);
      want.pitch = 0;
      want.throttle = 0;
      want.brake = 1;
    }
    if (i % 6 === 0) {
      noiseS = rng.range(-0.08, 0.08);
      noiseP = rng.range(-0.08, 0.08);
    }
    ctl.steer += clamp(clamp(want.steer + noiseS, -1, 1) - ctl.steer, -RATE, RATE);
    ctl.pitch += clamp(clamp(want.pitch + noiseP, -1, 1) - ctl.pitch, -RATE, RATE);
    ctl.throttle = want.throttle;
    ctl.brake = want.brake;
    const wasGround = a.onGround;
    stepAircraft(a, ctl, DT, world);
    if (wasGround && !a.onGround && out.liftX === null) {
      out.liftX = a.x - (X0 + 30);
      out.liftV = a.airspeed;
    }
    if (a.touchdown && phase === 'final' && out.tdSink === null) {
      out.tdSink = a.touchdownSpeed;
      out.tdBank = Math.abs(a.roll) / DEG;
      out.tdX = a.x;
      out.tdZ = a.z;
    }
    if (!a.onGround) {
      out.maxRoll = Math.max(out.maxRoll, Math.abs(a.roll));
      out.maxPitch = Math.max(out.maxPitch, Math.abs(a.pitch));
      if (a.stalled) out.stalled = true;
    }
    if (a.wrecked) break;
    if (phase === 'rollout' && Math.abs(a.speed) < 0.2) {
      out.stopX = a.x;
      out.stopZ = a.z;
      break;
    }
  }
  out.phase = phase;
  out.wrecked = a.wrecked;
  out.health = a.health;
  out.spec = s;
  return out;
}

const fmt = (r) => JSON.stringify(r, (k, v) => (k === 'spec' ? undefined : typeof v === 'number' ? Math.round(v * 10) / 10 : v));

for (const id of ['prop', 'jet', 'fighter', 'stunt', 'seaplane']) {
  test(`thumb pilot: ${id} takes off, circles, returns and lands`, () => {
    for (const seed of [1, 7]) {
      const r = thumbFlight(id, seed);
      const msg = `${id} seed ${seed}: ${fmt(r)}`;
      assert.ok(!r.wrecked && r.health === r.spec.health, `no crash, no damage: ${msg}`);
      assert.equal(r.phase, 'rollout', msg);
      assert.ok(r.liftX !== null && r.liftV >= r.spec.stallSpeed * 1.2, `lift-off well above the stall: ${msg}`);
      if (id === 'prop') assert.ok(r.liftX >= 250 && r.liftX <= 400, `prop take-off run 250..400 m: ${msg}`);
      if (!r.spec.floats) assert.ok(r.liftX < 600, `fits the runway: ${msg}`);
      assert.ok(r.circleLoss !== null && r.circleLoss < 20, `altitude lost in the turn under 20 m: ${msg}`);
      assert.ok(r.circleT < 60, `full circle in under a minute: ${msg}`);
      assert.ok(!r.stalled, `never stalled: ${msg}`);
      assert.ok(r.maxRoll <= r.spec.maxBank + 1e-6 && r.maxPitch < 50 * DEG, `no flip: ${msg}`);
      assert.ok(r.tdSink !== null && r.tdSink < 4, `touchdown sink under 4 m/s: ${msg}`);
      assert.ok(r.tdBank < 15, `wings within 15 degrees: ${msg}`);
      if (!r.spec.floats) {
        assert.ok(r.tdX > X0 && r.tdX < RW_END && Math.abs(r.tdZ) < 15, `touched down on the runway: ${msg}`);
        assert.ok(r.stopX > X0 && Math.abs(r.stopZ) < 15, `stopped on the runway: ${msg}`);
      }
    }
  });
}

const DRY = () => ({ collision: createCollisionWorld() });
function flying(id, y, v) {
  const a = createAircraft(id, 0, 0, 0);
  a.onGround = false;
  a.y = y;
  a.airspeed = v;
  a.speed = v;
  a.driver = 'player';
  return a;
}

test('hands off, wings and nose come back to level flight within 2 s', () => {
  for (const id of ['prop', 'jet', 'fighter', 'stunt', 'seaplane']) {
    const s = AIRCRAFT_SPECS[id];
    const a = flying(id, 300, s.maxSpeed * 0.75);
    a.roll = Math.min(45 * DEG, s.maxBank);
    a.pitch = 25 * DEG;
    const w = DRY();
    for (let i = 0; i < 120; i++) stepAircraft(a, { steer: 0, pitch: 0, throttle: 1, brake: 0 }, DT, w);
    assert.ok(Math.abs(a.roll) < 3 * DEG && Math.abs(a.pitch) < 2 * DEG, `${id} roll ${a.roll / DEG} pitch ${a.pitch / DEG}`);
    const y = a.y;
    for (let i = 0; i < 600; i++) stepAircraft(a, { steer: 0, pitch: 0, throttle: 1, brake: 0 }, DT, w);
    assert.ok(Math.abs(a.y - y) < 3, `${id} holds altitude hands off: ${a.y - y}`);
  }
});

test('stick moves bank and nose at a capped rate; a hard idle turn never stalls', () => {
  for (const id of ['prop', 'jet', 'fighter', 'seaplane']) {
    const s = AIRCRAFT_SPECS[id];
    const a = flying(id, 300, s.maxSpeed * 0.75);
    const w = DRY();
    let rollRate = 0, pitchRate = 0;
    for (let i = 0; i < 120; i++) {
      const r0 = a.roll, p0 = a.pitch;
      stepAircraft(a, { steer: 1, pitch: 1, throttle: 1, brake: 0 }, DT, w);
      rollRate = Math.max(rollRate, Math.abs(a.roll - r0) / DT);
      pitchRate = Math.max(pitchRate, Math.abs(a.pitch - p0) / DT);
    }
    assert.ok(rollRate <= s.rollMax + 1e-6 && rollRate > 60 * DEG, `${id} roll rate ${rollRate / DEG}`);
    assert.ok(pitchRate <= s.pitchMax + 1e-6 && pitchRate > 20 * DEG, `${id} pitch rate ${pitchRate / DEG}`);
    // Full bank, THRUST released, a minute: speed bleeds, never to a stall.
    const b = flying(id, 450, s.maxSpeed * 0.75);
    for (let i = 0; i < 3600; i++) {
      stepAircraft(b, { steer: 1, pitch: 0, throttle: 0, brake: 0 }, DT, w);
      assert.ok(!b.stalled && b.airspeed >= s.stallSpeed, `${id} stalled at ${i}: ${b.airspeed}`);
    }
    assert.ok(!b.wrecked);
  }
});

test('the runway: a held bank does not swerve a fast plane; good and hard landings', () => {
  const a = createAircraft('prop', 0, 0, 0);
  a.driver = 'player';
  a.speed = 30;
  const w = DRY();
  for (let i = 0; i < 60; i++) stepAircraft(a, { steer: 1, pitch: 0, throttle: 0, brake: 1 }, DT, w);
  assert.ok(a.heading < 12 * DEG, `heading ${a.heading / DEG}`); // was 22 degrees before AIR
  // 3.5 m/s of sink with 12 degrees of bank is a good landing.
  const land = (sink, bank) => {
    const p = flying('prop', 0.05, 28);
    p.pitch = -Math.asin(sink / 28);
    p.roll = bank * DEG;
    stepAircraft(p, { steer: bank / 55, pitch: -0.25, throttle: 0, brake: 0 }, DT, w);
    return p;
  };
  const good = land(3.5, 12);
  assert.ok(good.onGround && !good.wrecked && good.health === good.spec.health, `good ${good.touchdownSpeed}`);
  const hard = land(6, 20);
  assert.ok(hard.onGround && !hard.wrecked && hard.health < hard.spec.health);
});
