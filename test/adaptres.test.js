import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAdaptiveRes, maxRatioFor, wantsAntialias } from '../src/render/adaptres.js';

const run = (c, dt, seconds) => {
  const n = Math.round(seconds / dt);
  for (let i = 0; i < n; i++) c.update(dt);
  return c.scale;
};

test('steps down when frames are slow and stops at the minimum', () => {
  const c = createAdaptiveRes({ max: 2, start: 1.5 });
  const s1 = run(c, 1 / 40, 1.5);
  assert.ok(s1 < 1.5, `dropped from 1.5 to ${s1}`);
  run(c, 1 / 20, 30);
  assert.equal(c.scale, 0.6);
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
  const c = createAdaptiveRes({ max: 2, start: 0.6 });
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
  assert.equal(wantsAntialias(1), true);
  assert.equal(wantsAntialias(1.5), true);
  assert.equal(wantsAntialias(3.5), false);
});
