import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAdaptiveRes, maxRatioFor, wantsAntialias } from '../src/render/adaptres.js';

const run = (c, dt, seconds) => {
  const n = Math.round(seconds / dt);
  for (let i = 0; i < n; i++) c.update(dt);
  return c.scale;
};

test('steps down when frames are slow and stops at the 1.0 floor', () => {
  const c = createAdaptiveRes({ max: 2, start: 1.5 });
  const s1 = run(c, 1 / 40, 1.5);
  assert.ok(s1 < 1.5, `dropped from 1.5 to ${s1}`);
  run(c, 1 / 20, 30);
  assert.equal(c.scale, 1);
  // A start below the floor is lifted to it.
  assert.equal(createAdaptiveRes({ max: 2, start: 0.6 }).scale, 1);
});

test('at the floor it sheds detail instead, and gives it back', () => {
  const c = createAdaptiveRes({ max: 2, start: 1 });
  run(c, 1 / 60, 3);
  assert.equal(c.shed, 0);
  // A device that cannot hold 60 at 1.0: one step, then the second.
  run(c, 1 / 40, 3.5);
  assert.equal(c.shed, 1);
  assert.equal(c.scale, 1);
  run(c, 1 / 40, 4);
  assert.equal(c.shed, 2);
  run(c, 1 / 40, 10);
  assert.equal(c.shed, 2, 'never more than two steps');
  // Frames well under budget for a long spell: detail comes back one
  // step at a time before the resolution goes up again.
  run(c, 1 / 90, 13);
  assert.equal(c.shed, 1);
  assert.equal(c.scale, 1);
  run(c, 1 / 90, 13);
  assert.equal(c.shed, 0);
  run(c, 1 / 90, 10);
  assert.ok(c.scale > 1, `resolution climbs once nothing is shed, got ${c.scale}`);
});

test('a level the device holds at the floor sheds nothing', () => {
  const c = createAdaptiveRes({ max: 1.6, start: 1 });
  run(c, 1 / 58, 60);
  assert.equal(c.shed, 0);
});

test('holds steady at a solid 60 fps once at the maximum', () => {
  const c = createAdaptiveRes({ max: 1.6, start: 1.5 });
  run(c, 1 / 60, 20);
  assert.equal(c.scale, 1.6);
  const n = c.changes;
  run(c, 1 / 60, 60);
  assert.equal(c.changes, n);
});

test('recovers quality when there is headroom', () => {
  const c = createAdaptiveRes({ max: 2, start: 1 });
  run(c, 1 / 120, 60);
  assert.equal(c.scale, 2);
});

test('does not oscillate around a level the device cannot hold', () => {
  // A fake device: holds 60 fps at or below 1.2, slow above it.
  const c = createAdaptiveRes({ max: 2, start: 1.2 });
  let changes = 0, last = c.scale;
  for (let i = 0; i < 60 * 120; i++) {
    const s = c.update(c.scale > 1.2 ? 1 / 45 : 1 / 60);
    if (s !== last) { changes++; last = s; }
  }
  assert.ok(c.scale <= 1.25 && c.scale >= 1.1, `settled near 1.2, got ${c.scale}`);
  // Two minutes of play: a handful of probes, not one every few seconds.
  assert.ok(changes <= 16, `changes ${changes}`);
  assert.ok(c.probeWait > 3, 'probe wait backed off');
});

test('ignores pauses and single spikes', () => {
  const c = createAdaptiveRes({ max: 2, start: 1.5 });
  run(c, 1 / 60, 2);
  const s = c.scale;
  c.update(5); // tab was hidden
  c.update(0.2); // one long frame (garbage collection, shader compile)
  run(c, 1 / 60, 0.1);
  assert.ok(c.scale >= s);
});

test('setMax clamps the current scale', () => {
  const c = createAdaptiveRes({ max: 2, start: 2 });
  assert.equal(c.setMax(1.2), 1.2);
  run(c, 1 / 120, 30);
  assert.equal(c.scale, 1.2);
});

test('device and quality caps', () => {
  assert.equal(maxRatioFor(3.5, 1.25), 2);
  assert.equal(maxRatioFor(3.5, 1), 1.6);
  assert.equal(maxRatioFor(3.5, 0.75), 1.2);
  assert.equal(maxRatioFor(1, 1.25), 1);
  assert.equal(maxRatioFor(0, 1), 1);
  // MSAA on every device (the ratio never drops under 1.0).
  assert.equal(wantsAntialias(1), true);
  assert.equal(wantsAntialias(1.5), true);
  assert.equal(wantsAntialias(3.5), true);
});

test('the resolution changes at most once in 5 seconds', () => {
  // A device that swings between slow and very fast every half second.
  const c = createAdaptiveRes({ max: 2, start: 1.5 });
  let last = c.scale, lastAt = -1e9, t = 0, minGap = 1e9;
  for (let i = 0; i < 60 * 120; i++) {
    const dt = Math.floor(t / 0.5) % 2 ? 1 / 25 : 1 / 120;
    t += dt;
    const s = c.update(dt);
    if (s !== last) {
      minGap = Math.min(minGap, t - lastAt);
      lastAt = t;
      last = s;
    }
  }
  assert.ok(minGap >= 5 - 1e-6, `two changes ${minGap.toFixed(2)} s apart`);
});

test('a phone that holds 60 at full resolution never leaves it', () => {
  const c = createAdaptiveRes({ max: 1.6, start: 1.6 });
  // Vsync-locked frames with a few long ones (garbage collection, tiles).
  for (let i = 0; i < 60 * 300; i++) c.update(i % 400 === 0 ? 0.05 : i % 97 === 0 ? 0.034 : 1 / 60);
  assert.equal(c.scale, 1.6);
  assert.equal(c.changes, 0);
  assert.equal(c.good, 1.6, 'full resolution is the good level');
});

test('good is the level that held; it is the start next time', () => {
  // Holds 60 at or below 1.3 only.
  const dev = (s) => (s > 1.3 ? 1 / 40 : 1 / 60);
  const c = createAdaptiveRes({ max: 2, start: 2 });
  for (let i = 0; i < 60 * 120; i++) c.update(dev(c.scale));
  assert.ok(c.good > 0 && c.good <= 1.3, `good ${c.good}`);
  assert.ok(c.good >= 1.1, `good ${c.good}`);
  // The next run starts there and has nothing to change for a while.
  const d = createAdaptiveRes({ max: 2, start: c.good, firstWait: 30 });
  for (let i = 0; i < 60 * 30; i++) d.update(dev(d.scale));
  assert.ok(d.changes <= 1, `changes ${d.changes}`);
  assert.ok(d.scale <= 1.3 + 1e-9);
});
