import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createFlow, TIER_MAX, FILL, HOLD_S, DRAIN, COOL_S, BANK_STILL_S, BANK_BONUS, CRASH_LOSS, CRASH_TIERS, SPEED_MPS, SPEED_TICK, SPEED_POINTS,
  FAST_MPS, DROP_REFILL, MAX_RUN, CARRY, TIER_COST,
} from '../src/core/flow.js';

const DT = 1 / 60;
const moving = { speed: 15, driving: true, airborne: false, wanted: false, canBank: true };
const run = (f, seconds, facts = moving) => { for (let i = 0, n = Math.round(seconds / DT); i < n; i++) f.step(DT, facts); };
function withLog() {
  const log = [];
  const f = createFlow((...a) => log.push(a));
  return { f, log };
}

test('a source adds points times the multiplier and fills the meter', () => {
  const { f, log } = withLog();
  assert.equal(f.feed('nearMiss', 150), 150);
  assert.equal(f.run, 150);
  assert.equal(f.tier, 1);
  assert.ok(Math.abs(f.meter - FILL.nearMiss) < 1e-9);
  assert.deepEqual(log[0], ['feed', 'nearMiss', 150]);
  assert.equal(f.feed('nearMiss', 0), 0);
  assert.equal(f.feed('nearMiss', NaN), 0);
  assert.equal(f.feed('nearMiss', -5), 0);
});

test('four near misses reach x2; each tier needs more; x5 is the top', () => {
  const { f, log } = withLog();
  for (let i = 0; i < 4; i++) f.feed('nearMiss', 150);
  assert.equal(f.tier, 2);
  assert.ok(Math.abs(f.meter - CARRY) < 1e-9, 'a tier up leaves the carry');
  assert.ok(log.some((e) => e[0] === 'tier' && e[1] === 2 && e[2] === true));
  // at x2 a near miss is worth double and fills 1 / (1 + cost) as much
  const before = f.meter;
  assert.equal(f.feed('nearMiss', 150), 300);
  assert.ok(Math.abs(f.meter - before - FILL.nearMiss / (1 + TIER_COST)) < 1e-9);
  for (let i = 0; i < 80; i++) f.feed('oncoming', 225);
  assert.equal(f.tier, TIER_MAX);
  assert.ok(f.meter <= 1);
  assert.equal(f.peak, TIER_MAX);
});

test('an escape is worth a whole tier at once', () => {
  const f = createFlow();
  f.feed('escape', 1000);
  assert.equal(f.tier, 2);
});

test('the meter holds, then drains; an empty meter costs a tier; x1 never goes below', () => {
  const { f, log } = withLog();
  for (let i = 0; i < 4; i++) f.feed('nearMiss', 150);
  const m0 = f.meter;
  run(f, HOLD_S - 0.4 - 0.1); // the hold at x2 is 0.4 s shorter
  assert.ok(Math.abs(f.meter - m0) < 1e-9, 'no drain during the hold');
  run(f, 0.2 + m0 / (DRAIN + 0.05) + 0.1);
  assert.equal(f.tier, 1, 'the tier is lost when the meter runs dry');
  assert.ok(f.meter <= DROP_REFILL && f.meter > 0);
  assert.ok(log.some((e) => e[0] === 'tier' && e[1] === 1 && e[2] === false));
  run(f, 5);
  assert.equal(f.tier, 1);
  assert.equal(f.meter, 0);
  assert.ok(f.run > 0, 'the run is still there, not banked: the car is moving and it has not gone cold for long');
});

test('driving fast halves the drain; the air freezes it', () => {
  const slow = createFlow(), fast = createFlow(), air = createFlow();
  for (const f of [slow, fast, air]) { f.feed('drift', 100); f.hold = 0; }
  const m = slow.meter;
  run(slow, 0.5);
  run(fast, 0.5, { ...moving, speed: FAST_MPS + 1 });
  run(air, 0.5, { ...moving, airborne: true });
  assert.ok(Math.abs((m - slow.meter) - 2 * (m - fast.meter)) < 1e-6);
  assert.equal(air.meter, m);
});

test('speed over 70 mph is a source every half second', () => {
  const f = createFlow();
  run(f, SPEED_TICK * 4 + 0.01, { ...moving, speed: SPEED_MPS + 1 });
  assert.equal(f.run, SPEED_POINTS * 4);
  run(f, 1, { ...moving, speed: SPEED_MPS - 1 });
  assert.equal(f.run, SPEED_POINTS * 4);
});

test('stopping at a safe spot banks the run with a bonus per tier', () => {
  const { f, log } = withLog();
  for (let i = 0; i < 5; i++) f.feed('nearMiss', 150);
  const runPts = f.run, tier = f.tier;
  assert.equal(tier, 2);
  run(f, BANK_STILL_S - 0.1, { ...moving, speed: 0 });
  assert.equal(f.run, runPts, 'not yet');
  run(f, 0.2, { ...moving, speed: 0 });
  assert.equal(f.run, 0);
  assert.equal(f.tier, 1);
  const want = runPts + Math.round(runPts * BANK_BONUS * (tier - 1));
  assert.equal(f.banked, want);
  assert.equal(f.best, want);
  assert.deepEqual(log.find((e) => e[0] === 'bank'), ['bank', want, 'stop', tier]);
});

test('no bank while wanted, during an event or in the air; a cold flow banks without a bonus', () => {
  const f = createFlow();
  f.feed('nearMiss', 150);
  run(f, 3, { ...moving, speed: 0, wanted: true });
  assert.equal(f.run, 150);
  run(f, 3, { ...moving, speed: 0, canBank: false });
  assert.equal(f.run, 150);
  run(f, 3, { ...moving, speed: 0, airborne: true });
  assert.equal(f.run, 150);
  // moving, quiet: the meter empties, then COOL_S later the run banks by itself
  const { f: g, log } = withLog();
  g.feed('nearMiss', 150);
  run(g, HOLD_S + FILL.nearMiss / DRAIN + COOL_S + 0.2);
  assert.equal(g.run, 0);
  assert.deepEqual(log.find((e) => e[0] === 'bank'), ['bank', 150, 'cool', 1]);
});

test('a hard crash costs two tiers and a share of the run, never the banked score', () => {
  const { f, log } = withLog();
  for (let i = 0; i < 30; i++) f.feed('oncoming', 225);
  run(f, 0.1, { ...moving, speed: 0, wanted: true });
  const tier = f.tier, r = f.run;
  assert.ok(tier >= 4);
  const lost = f.crash();
  assert.equal(lost, Math.round(r * CRASH_LOSS));
  assert.equal(f.run, r - lost);
  assert.equal(f.tier, tier - CRASH_TIERS);
  assert.equal(f.meter, 0);
  assert.equal(f.crash(), 0, 'one penalty per second');
  run(f, 1.1, { ...moving, wanted: true });
  assert.ok(f.crash() > 0);
  assert.ok(log.some((e) => e[0] === 'crash'));
  // banked points are out of reach
  const g = createFlow();
  g.feed('nearMiss', 150);
  g.bank('stop');
  const banked = g.banked;
  g.feed('nearMiss', 150);
  g.crash();
  g.wipe();
  assert.equal(g.banked, banked);
  assert.equal(g.run, 0);
});

test('a wreck or a bust wipes the run; an event bank pays the bonus', () => {
  const { f, log } = withLog();
  for (let i = 0; i < 5; i++) f.feed('nearMiss', 150);
  assert.equal(f.wipe(), 900);
  assert.equal(f.tier, 1);
  assert.ok(log.some((e) => e[0] === 'wipe' && e[1] === 900));
  for (let i = 0; i < 5; i++) f.feed('nearMiss', 150);
  assert.equal(f.bank('event'), 900 + Math.round(900 * BANK_BONUS));
  assert.equal(f.bank('event'), 0, 'nothing to bank twice');
});

test('caps and determinism', () => {
  const f = createFlow();
  for (let i = 0; i < 400; i++) f.feed('takedown', 1e9);
  assert.ok(f.run <= MAX_RUN);
  const a = createFlow(), b = createFlow();
  for (const g of [a, b]) {
    for (let i = 0; i < 600; i++) {
      if (i % 37 === 0) g.feed('nearMiss', 150);
      if (i % 191 === 0) g.crash();
      g.step(DT, { ...moving, speed: 10 + (i % 30) });
    }
  }
  assert.deepEqual([a.run, a.tier, a.meter, a.banked], [b.run, b.tier, b.meter, b.banked]);
});
