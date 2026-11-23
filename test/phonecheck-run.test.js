// The pure parts of scripts/phonecheck-run.mjs (the Phone check drive at 4x throttle,
// docs/PERF.md): frame statistics, the gate rows, the fastest pass of each frame, the
// collections of a trace, the CPU-profile window and the resolution the frames lead to.
import test from 'node:test';
import assert from 'node:assert/strict';
import { LIMITS, driveStats, checkDrive, fastestFrames, gcStats, profileIndex, profileWindow, resAfter } from '../scripts/phonecheck-run.mjs';
import { createAdaptiveRes } from '../src/render/adaptres.js';

test('drive statistics: a frame is judged by its excess over the running level', () => {
  const ms = new Array(200).fill(20);
  ms[50] = 20 + LIMITS.overMs + 1; // one lost refresh
  ms[120] = 20 + LIMITS.overMs / 2 + 1; // half way: counted in `half` only
  const s = driveStats(ms);
  assert.equal(s.frames, 200);
  assert.equal(s.over, 1);
  assert.equal(s.half, 2);
  assert.equal(s.median, 20);
  assert.ok(Math.abs(s.worstExcess - (LIMITS.overMs + 1)) < 1e-9);
  assert.ok(s.phoneWorst > 33.3 && s.phoneWorst < 35);
  // a slow rise of the level is not a hitch
  const ramp = Array.from({ length: 600 }, (_, i) => 20 + i * 0.05);
  assert.equal(driveStats(ramp).over, 0);
  assert.equal(driveStats([]).frames, 0);
});

test('gate rows: the pinned limits of the drive', () => {
  const ok = checkDrive({ over: LIMITS.maxOver, phoneWorst: LIMITS.maxWorstPhoneMs, newPrograms: 0 });
  assert.equal(ok.length, 3);
  assert.ok(ok.every((r) => r.ok));
  const bad = checkDrive({ over: LIMITS.maxOver + 1, phoneWorst: LIMITS.maxWorstPhoneMs + 0.1, newPrograms: 1 });
  assert.ok(bad.every((r) => !r.ok));
  assert.ok(LIMITS.maxOver <= 4 && LIMITS.maxWorstPhoneMs <= 50 && LIMITS.maxNewPrograms === 0, 'the limits are never looser than the owner\'s target');
});

test('fastest frames: each frame takes its fastest pass; a frame whose state differs keeps the first', () => {
  const row = (ms, sig) => [ms, 0, 0, sig];
  const a = { rows: [row(30, 1), row(20, 2), row(25, 3)] };
  const b = { rows: [row(22, 1), row(90, 2), row(10, 99)] };
  const f = fastestFrames([a, b]);
  assert.deepEqual(f.rows.map((r) => r[0]), [22, 20, 25]);
  assert.deepEqual(f.from, [1, 0, 0]);
  assert.equal(f.mixed, 1);
});

test('garbage collections between the marks of a phase', () => {
  const ev = [
    { name: 'rwpc-drive-0', ts: 1e6 }, { name: 'rwpc-drive-1', ts: 61e6 },
    { name: 'MinorGC', ph: 'X', ts: 0.5e6, dur: 9000, args: { usedHeapSizeBefore: 50 << 20, usedHeapSizeAfter: 40 << 20 } },
    { name: 'MinorGC', ph: 'X', ts: 2e6, dur: 2000, args: { usedHeapSizeBefore: 60 << 20, usedHeapSizeAfter: 44 << 20 } },
    { name: 'MajorGC', ph: 'X', ts: 30e6, dur: 40000, args: { type: 'finalize', usedHeapSizeBefore: 70 << 20, usedHeapSizeAfter: 50 << 20 } },
  ];
  const g = gcStats(ev, 'drive');
  assert.equal(g.minor, 1);
  assert.equal(g.major, 1);
  assert.equal(g.pauseMs, 42);
  assert.equal(g.worstMs, 40);
  assert.equal(g.allocMb, 26); // 70 before the second collection, 44 after the first
  assert.equal(g.majors.length, 1);
  assert.equal(g.majors[0].s, 29);
  assert.equal(gcStats(ev, 'first play'), null);
});

test('profile window: self time by function between two times, the collector apart', () => {
  const profile = {
    startTime: 1000,
    nodes: [
      { id: 1, callFrame: { functionName: '(root)' } }, { id: 2, callFrame: { functionName: 'stepPed' } },
      { id: 3, callFrame: { functionName: '(garbage collector)' } }, { id: 4, callFrame: { functionName: '', url: 'http://x/game.js', lineNumber: 7 } },
    ],
    samples: [2, 2, 3, 4, 2],
    timeDeltas: [0, 250, 250, 250, 250],
  };
  const index = profileIndex(profile);
  assert.deepEqual(Array.from(index.times), [1000, 1250, 1500, 1750, 2000]);
  const w = profileWindow(index, 1000, 1750, 3);
  assert.equal(w.gcMs, 0.25);
  assert.equal(w.top[0], 'stepPed 0.5');
  assert.ok(w.top.some((x) => x.startsWith('(anonymous game.js:7)')));
});

test('resolution after a run: steady frames hold 2.00, a burst of lost refreshes drops it', () => {
  const steady = new Array(1200).fill(20);
  assert.equal(resAfter(createAdaptiveRes, steady), 2);
  const one = steady.slice();
  one[300] = 20 + LIMITS.overMs * 3; // a single spike is clipped
  assert.equal(resAfter(createAdaptiveRes, one), 2);
  const burst = steady.slice();
  for (let i = 300; i < 420; i++) burst[i] = 20 + LIMITS.overMs * 1.5;
  assert.ok(resAfter(createAdaptiveRes, burst) < 2);
});
