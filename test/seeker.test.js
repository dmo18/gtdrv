// Seeker and lock-on in flight (docs/ARMS.md).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createCollisionWorld } from '../src/world/collision.js';
import {
  createSeeker, stepSeeker, seekTier, LOCK_T, BREAK_T, SEEK_CONE, CIV_CONE,
} from '../src/core/seeker.js';

const DT = 1 / 60;
const jet = () => ({ kind: 'plane', x: 0, y: 50, z: 0, heading: 0, pitch: 0, spec: { height: 3 }, health: 700 });
const target = (x, z, extra = {}) => ({ kind: 'car', x, y: 48.5, z, spec: { height: 1.5 }, health: 900, wrecked: false, driver: 'crew', crew: true, ...extra });
const ctx = (vehicles, extra = {}) => ({ actors: [], vehicles, collision: null, seaY: 0, self: null, range: 600, ...extra });
const run = (s, c, cx, secs, cycle = false) => {
  const evs = [];
  for (let i = 0; i < Math.round(secs * 60); i++) {
    const e = stepSeeker(s, c, cx, DT, cycle && i === 0);
    if (e) evs.push(e);
  }
  return evs;
};

test('seeker: 0.8 s in the cone locks; breaks 1.0 s after leaving it', () => {
  const s = createSeeker();
  const c = jet();
  const t = target(200, 10);
  const cx = ctx([c, t]);
  assert.equal(stepSeeker(s, c, cx, DT), 'seek');
  assert.equal(s.target, t);
  run(s, c, cx, LOCK_T - 0.1);
  assert.equal(s.state, 'seek');
  assert.ok(s.progress > 0.8 && s.progress < 1);
  const ev = run(s, c, cx, 0.15);
  assert.deepEqual(ev, ['locked']);
  // Out of the cone: held for just under 1 s, lost after.
  c.heading = 1.2;
  run(s, c, cx, BREAK_T - 0.05);
  assert.equal(s.state, 'locked');
  assert.deepEqual(run(s, c, cx, 0.1), ['lost']);
  assert.equal(s.target, null);
});

test('seeker: cone edge, range, line of sight, wrecked targets', () => {
  const c = jet();
  const inside = target(100, Math.tan(SEEK_CONE * 0.9) * 100);
  const outside = target(100, Math.tan(SEEK_CONE * 1.1) * 100);
  let s = createSeeker();
  stepSeeker(s, c, ctx([outside]), DT);
  assert.equal(s.target, null);
  stepSeeker(s, c, ctx([outside, inside]), DT);
  assert.equal(s.target, inside);
  s = createSeeker();
  stepSeeker(s, c, ctx([target(700, 0)]), DT);
  assert.equal(s.target, null, 'beyond the slot-1 range');
  const col = createCollisionWorld();
  col.addBox(40, -20, 50, 20, 200);
  s = createSeeker();
  stepSeeker(s, c, ctx([target(100, 0)], { collision: col }), DT);
  assert.equal(s.target, null, 'behind a tall wall');
  s = createSeeker();
  const t = target(100, 0);
  stepSeeker(s, c, ctx([t]), DT);
  t.wrecked = true;
  assert.equal(stepSeeker(s, c, ctx([t]), DT), 'lost');
});

test('seeker: tiers (attackers, crew, police incl. police helis, crewed), civilians only within 4 deg', () => {
  assert.equal(seekTier({ hostile: true, spec: {}, health: 1 }), 0);
  assert.equal(seekTier({ crew: true, spec: {}, health: 1 }), 1);
  assert.equal(seekTier({ spec: { police: true }, health: 1 }), 2);
  assert.equal(seekTier({ police: true, spec: {}, health: 1 }), 2);
  assert.equal(seekTier({ spec: {}, health: 1 }), 4);
  assert.equal(seekTier({ hp: 30, team: 'crew' }), 1);
  const c = jet();
  const civ = target(100, Math.tan(CIV_CONE * 2) * 100, { crew: false, driver: null });
  const s = createSeeker();
  stepSeeker(s, c, ctx([civ]), DT);
  assert.equal(s.target, null, 'civilian craft at 8 deg ignored');
  const civNear = target(100, Math.tan(CIV_CONE * 0.5) * 100, { crew: false, driver: null });
  const police = target(100, Math.tan(SEEK_CONE * 0.8) * 100, { crew: false, police: true });
  stepSeeker(s, c, ctx([civNear, police]), DT);
  assert.equal(s.target, police, 'police beats a civilian nearer the nose');
});

test('seeker: LOCK tap cycles to the next candidate and restarts the 0.8 s', () => {
  const c = jet();
  const a = target(150, 5), b = target(150, -20, { crew: false, police: true });
  const cx = ctx([a, b]);
  const s = createSeeker();
  run(s, c, cx, 1);
  assert.equal(s.target, a);
  assert.equal(s.state, 'locked');
  assert.equal(stepSeeker(s, c, cx, DT, true), 'seek');
  assert.equal(s.target, b);
  assert.equal(s.state, 'seek');
  run(s, c, cx, 0.5);
  assert.equal(s.state, 'seek');
  run(s, c, cx, 0.35);
  assert.equal(s.state, 'locked');
  stepSeeker(s, c, cx, DT, true);
  assert.equal(s.target, a, 'wraps around');
});
