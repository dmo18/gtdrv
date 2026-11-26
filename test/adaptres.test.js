import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAdaptiveRes, maxRatioFor, floorFor, wantsAntialias, sizeCapFor, pixelBudgetFor, contextLimits, watchContext, PIXEL_BUDGET } from '../src/render/adaptres.js';

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
  // 0.13.7: a 3.5 ratio phone draws sharp (was 2, 1.6 and 1.2).
  assert.equal(maxRatioFor(3.5, 1.25), 2.5);
  assert.equal(maxRatioFor(3.5, 1), 2.25);
  assert.equal(maxRatioFor(3.5, 0.75), 1.5);
  assert.equal(maxRatioFor(2, 1), 2);
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

test('dense screens get a higher floor', () => {
  assert.equal(floorFor(1), 1);
  assert.equal(floorFor(2), 1);
  // 0.13.7 render safety: the dense floor is 1.25 (was 1.5, the Low cap
  // itself, so Low could never step down on a 3.5 ratio phone).
  assert.equal(floorFor(3), 1.25);
  assert.equal(floorFor(3.5), 1.25);
  assert.equal(floorFor(0), 1);
  const c = createAdaptiveRes({ max: maxRatioFor(3.5, 1), min: floorFor(3.5), start: 2.25 });
  run(c, 1 / 20, 60);
  assert.equal(c.scale, 1.25, 'never under the floor');
  assert.ok(c.shed > 0, 'sheds detail there instead');
});

test('Low on a dense screen can adapt (floor under the Low cap)', () => {
  assert.ok(floorFor(3.5) < maxRatioFor(3.5, 0.75));
  const c = createAdaptiveRes({ max: maxRatioFor(3.5, 0.75), min: floorFor(3.5), start: 1.5 });
  run(c, 1 / 40, 20);
  assert.ok(c.scale < 1.5 && c.scale >= 1.25, `Low stepped down to ${c.scale}`);
});

// Synthetic frame timings: dt is the frame interval, work the frame's
// JavaScript before its draw is issued (graphics.js noteWork).
test('GPU-bound frames step down, even with some JavaScript in them', () => {
  // 30 fps from a GPU wait in the draw; light JavaScript (6 ms).
  const a = createAdaptiveRes({ max: 2.25, min: 1.25, start: 2.25 });
  for (let i = 0; i < 60 * 10; i++) a.update(1 / 30, 0.006);
  assert.ok(a.scale < 2.25, `stepped down to ${a.scale}`);
  assert.equal(a.cpuFrames, 0);
  // 14 ms of JavaScript (over budget * cpuAt) but a 33 ms frame: mostly a
  // GPU wait, still the pixels' fault.
  const b = createAdaptiveRes({ max: 2.25, min: 1.25, start: 2.25 });
  for (let i = 0; i < 60 * 10; i++) b.update(1 / 30, 0.014);
  assert.ok(b.scale < 2.25, `stepped down to ${b.scale}`);
  assert.equal(b.cpuFrames, 0);
  // A device GPU-bound over 1.8 settles at or under it.
  const c = createAdaptiveRes({ max: 2.25, min: 1.25, start: 2.25 });
  for (let i = 0; i < 60 * 120; i++) c.update(c.scale > 1.8 ? 1 / 40 : 1 / 60, 0.007);
  assert.ok(c.scale <= 1.8 && c.scale >= 1.6, `settled at ${c.scale}`);
});

test('JavaScript-bound frames do not lower the resolution', () => {
  // Every frame 30 fps from 28 ms of steps and updates; the GPU is idle.
  const c = createAdaptiveRes({ max: 2.25, min: 1.25, start: 2.25 });
  for (let i = 0; i < 60 * 60; i++) c.update(1 / 30, 0.028);
  assert.equal(c.scale, 2.25);
  assert.equal(c.changes, 0);
  assert.ok(c.cpuFrames > 1700);
  // Mixed: one slow step in four, 22 ms of JavaScript in a 35 ms frame.
  const d = createAdaptiveRes({ max: 2.25, min: 1.25, start: 2.25 });
  for (let i = 0; i < 60 * 120; i++) d.update(i % 4 === 0 ? 0.035 : 1 / 60, i % 4 === 0 ? 0.022 : 0.008);
  assert.equal(d.scale, 2.25);
});

test('recovery: back to the cap after a GPU-bound spell', () => {
  const c = createAdaptiveRes({ max: 2.25, min: 1.25, start: 2.25 });
  let low = 9, back = -1;
  for (let i = 0; i < 60 * 90; i++) {
    const t = i / 60;
    const gpu = t > 10 && t < 25;
    c.update(gpu ? 1 / 35 : 1 / 60, gpu ? 0.006 : 0.008);
    if (c.scale < low) low = c.scale;
    if (t > 25 && back < 0 && c.scale === 2.25) back = t - 25;
  }
  assert.ok(low < 2.0, `went down to ${low} in the spell`);
  // Slow at every level for 15 s it walks a long way down (about 1.65);
  // each step back up waits its probe, so the climb takes under a minute.
  assert.ok(back >= 0 && back < 60, `back after ${back.toFixed(1)} s`);
});

test('size cap: the drawing buffer stays within the GPU and the pixel budget', () => {
  // The phone (915x412 CSS px): 2.25 fits (1.9 million pixels).
  assert.ok(sizeCapFor(915, 412, null, pixelBudgetFor(1)) >= 2.25);
  assert.ok(sizeCapFor(915, 412, null, pixelBudgetFor(1.25)) >= 2.5);
  // A tablet (1280x800) is held to about 2.6 million pixels at Normal.
  const r = sizeCapFor(1280, 800, null, pixelBudgetFor(1));
  assert.ok(Math.round(1280 * r) * Math.round(800 * r) <= PIXEL_BUDGET.normal, `ratio ${r}`);
  assert.ok(r >= 1.5, `ratio ${r}`);
  const rh = sizeCapFor(1280, 800, null, pixelBudgetFor(1.25));
  assert.ok(rh > r && Math.round(1280 * rh) * Math.round(800 * rh) <= PIXEL_BUDGET.high);
  // GPU sizes: a 4096 renderbuffer and viewport bound a wide canvas.
  const lim = { renderbuffer: 4096, viewportW: 4096, viewportH: 4096, texture: 8192 };
  const w = sizeCapFor(3000, 400, lim, 1e9);
  assert.ok(3000 * w <= 4096, `ratio ${w}`);
  assert.ok(sizeCapFor(400, 3000, { viewportH: 2048 }, 1e9) * 3000 <= 2048);
  // Bloom copies the frame into a texture: its size bounds it too.
  assert.ok(sizeCapFor(3000, 400, { texture: 2048 }, 1e9) * 3000 <= 2048);
  // No size known: no cap; never under 0.25.
  assert.equal(sizeCapFor(0, 0, lim), Infinity);
  assert.equal(sizeCapFor(1e6, 1e6, lim), 0.25);
  // The controller follows a lower cap.
  const c = createAdaptiveRes({ max: 2.25, min: 1.25, start: 2.25 });
  assert.equal(c.setMax(Math.min(maxRatioFor(3.5, 1), r)), r);
});

test('context limits from a fake WebGL context', () => {
  const gl = {
    MAX_RENDERBUFFER_SIZE: 1, MAX_TEXTURE_SIZE: 2, MAX_VIEWPORT_DIMS: 3,
    getParameter(k) { return k === 1 ? 8192 : k === 2 ? 4096 : k === 3 ? new Int32Array([16384, 8192]) : null; },
  };
  assert.deepEqual(contextLimits(gl), { renderbuffer: 8192, viewportW: 16384, viewportH: 8192, texture: 4096 });
  // A lost context answers null: no limit known, never a zero cap.
  const lost = { getParameter: () => null };
  assert.equal(contextLimits(lost).renderbuffer, Infinity);
  assert.equal(contextLimits(null).viewportW, Infinity);
});

test('context loss: claimed with preventDefault, restore reported', () => {
  const ls = {};
  const canvas = {
    addEventListener(type, fn) { (ls[type] = ls[type] || []).push(fn); },
    removeEventListener(type, fn) { ls[type] = (ls[type] || []).filter((f) => f !== fn); },
  };
  const fire = (type) => {
    const e = { type, prevented: false, preventDefault() { this.prevented = true; } };
    for (const f of ls[type] || []) f(e);
    return e;
  };
  const seen = [];
  const st = watchContext(canvas, { onLost: () => seen.push('lost'), onRestored: () => seen.push('restored') });
  assert.equal(st.lost, false);
  const e = fire('webglcontextlost');
  assert.equal(e.prevented, true, 'the browser may give the context back');
  assert.equal(st.lost, true);
  fire('webglcontextrestored');
  assert.equal(st.lost, false);
  assert.deepEqual(seen, ['lost', 'restored']);
  assert.equal(st.losses, 1);
  assert.equal(st.restores, 1);
  st.detach();
  fire('webglcontextlost');
  assert.equal(st.losses, 1, 'detached');
  // No canvas (node, a test game): nothing to watch, nothing thrown.
  assert.equal(watchContext(null).lost, false);
});

test('frames made late by the main thread do not lower the resolution', () => {
  // A phone whose GPU holds 60 at full resolution; one frame in nine is a
  // slow step (20 ms of JavaScript) that misses a refresh.
  const c = createAdaptiveRes({ max: 2.25, min: 1.5, start: 2.25 });
  for (let i = 0; i < 60 * 180; i++) c.update(i % 9 === 0 ? 2 / 60 : 1 / 60, i % 9 === 0 ? 0.02 : 0.009);
  assert.equal(c.scale, 2.25);
  assert.equal(c.changes, 0);
  assert.ok(c.cpuFrames > 1000);
  // The same frames without the work hint: the old behavior, walked down.
  const d = createAdaptiveRes({ max: 2.25, min: 1.5, start: 2.25 });
  for (let i = 0; i < 60 * 180; i++) d.update(i % 9 === 0 ? 2 / 60 : 1 / 60);
  assert.ok(d.scale < 2.25);
  // Late frames with light work are the pixels' fault: still stepped down.
  const e = createAdaptiveRes({ max: 2.25, min: 1.5, start: 2.25 });
  run(e, 1 / 40, 8);
  for (let i = 0; i < 60 * 8; i++) e.update(1 / 40, 0.006);
  assert.ok(e.scale < 2.25);
});

test('a level lost to a busy spell comes back within half a minute', () => {
  // GPU-bound over 1.4 for 15 s (a big fire fight), then calm again.
  const c = createAdaptiveRes({ max: 2.25, min: 1.5, start: 2.25 });
  let back = -1;
  for (let i = 0; i < 60 * 120; i++) {
    const t = i / 60;
    c.update(t > 20 && t < 35 && c.scale > 1.4 ? 1 / 40 : 1 / 60, 0.008);
    if (t > 35 && back < 0 && c.scale === 2.25) back = t - 35;
  }
  assert.ok(back >= 0 && back < 30, `back after ${back.toFixed(1)} s`);
});
