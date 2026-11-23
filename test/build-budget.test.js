// Regression guard for the node build of the whole Miami box (REVAMP 6.1,
// W1: the whole city builds in under 3 s). The 3 s tests in miami.test.js
// and world-density.test.js measure absolute time, which a slow shared
// runner stretches; this one measures the build against a fixed pure-JS
// calibration workload run in the same process, so a slower machine
// slows both and the ratio stays put. It fails when the build, or one of
// its big stages, gets slower relative to the calibration.
// Raising a limit needs a profile first (node scripts/city-build-bench.mjs).
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Cold builds, each in its own process between calibration runs
// (test/fixtures/build-budget-run.mjs); the best ratio counts, so a burst
// of load on a shared runner does not fail the test. Three runs, and up
// to three more only while a limit is still missed: every run must be
// over a limit for the test to fail, so a real regression still fails
// every time and no limit moves.
const runner = fileURLToPath(new URL('./fixtures/build-budget-run.mjs', import.meta.url));
const runs = [];
const runOnce = () => {
  const r = spawnSync(process.execPath, [runner], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(r.stderr);
  runs.push(JSON.parse(r.stdout.trim().split('\n').pop()));
};
// The ratio by wall time and by CPU time; the smaller counts (a runner
// that shares its CPU stretches wall time, one that runs other test
// files beside this one adds CPU time on other threads).
// Main-thread CPU (thread / calThread, when the node reports it) is the
// same measure without the GC helper threads, which other processes on a
// loaded runner slow down as well.
const ratioOf = (r) => Math.min(r.wall / r.calWall, r.cpu / r.calCpu, r.thread > 0 && r.calThread > 0 ? r.thread / r.calThread : Infinity);
const sumOf = (t, keys) => keys.reduce((s, k) => s + ((t && t[k]) || 0), 0);
// A stage's ratio in one run, by the same rule as the whole build: its
// wall time over the calibration's wall time, or its main-thread CPU time
// (miami.js cpuClock laps) over the calibration's main-thread CPU time,
// whichever is smaller.
// Before 0.7.0 only the wall ratio counted: with the full suite running
// beside it (npm test runs files in parallel on every core) a stage that
// met a burst of load in all three runs read 1.7 times slow while its CPU
// time had not moved, and the test flickered. Other processes do not
// stretch CPU time, so the limits stay as they are.
const stageOf = (r, keys) => {
  const wall = sumOf(r.timings, keys) / r.calWall;
  return r.cpuTimings && r.calThread > 0 ? Math.min(wall, sumOf(r.cpuTimings, keys) / r.calThread) : wall;
};

// Limits, measured 2026-11-22 as the best of three runs, after the 0.5.1
// build work (before it in brackets): whole 13.5 to 14.7 (17.2 to 22.1);
// stages: land 0.8 to 1.1 (1.8 to 2.6), roads 0.8 to 1.1, shore 1.3 to
// 1.9 (2.7 to 3.6), blocks and buildings 2.4 to 3.2 (3.8 to 5.4),
// infill and lot masks 2.5 to 2.7 (3.0 to 4.0), lots 3.0 to 3.2 (the
// same), places 0.7 to 0.8. Each limit is about 1.7 times the slowest
// value measured now on a quiet machine plus room for
// the rest of the suite running beside it (npm test runs files in
// parallel): a regression of about 1.7 times in a stage, or 1.5 times in
// the whole build, fails.
const TOTAL_LIMIT = 22;
const STAGES = {
  land: [['land.coast', 'land.fill', 'land.votes', 'land.walls', 'land.water', 'land'], 1.9],
  roads: [['graph', 'network'], 1.9],
  shore: [['shore.stamp', 'shore.field', 'shore'], 3.2],
  buildings: [['blocks', 'buildings'], 5.4],
  infill: [['infill.stamp', 'infill.masks', 'infill.plan', 'infill'], 4.6],
  // the whole buildLots call plus the parking lot bays
  lots: [['lots.build', 'lots'], 5.4],
  places: [['places.ramps', 'places.secrets', 'places.courses', 'places'], 1.4],
};

// Each stage at its best over the runs, and the stages over their limit.
const stageBest = (keys) => Math.min(...runs.map((r) => stageOf(r, keys)));
const overBudget = () => {
  const bad = [];
  for (const [k, [keys, limit]] of Object.entries(STAGES)) {
    const v = stageBest(keys);
    if (v >= limit) bad.push(`${k} ${v.toFixed(2)} (limit ${limit})`);
  }
  return bad;
};
for (let k = 0; k < 3; k++) runOnce();
while (runs.length < 6 && (overBudget().length || ratioOf(runs.reduce((a, r) => (ratioOf(r) < ratioOf(a) ? r : a))) >= TOTAL_LIMIT)) runOnce();
const best = runs.reduce((a, r) => (ratioOf(r) < ratioOf(a) ? r : a));
const total = ratioOf(best);

test(`build budget: whole box / calibration ${total.toFixed(1)} (build ${best.wall.toFixed(0)} ms, calibration ${best.calWall.toFixed(0)} ms)`, () => {
  assert.ok(best.lots > 10000 && best.buildings > 25000);
  assert.ok(total < TOTAL_LIMIT, `whole build is ${total.toFixed(2)} calibrations (limit ${TOTAL_LIMIT}; ${runs.map(ratioOf).map((x) => x.toFixed(2)).join(', ')})`);
});

test(`build budget: no stage regresses against the calibration (best of ${runs.length} runs)`, () => {
  // Stage times (createMiamiCity laps) over the calibration, wall or CPU.
  const bad = overBudget();
  assert.deepEqual(bad, [], `stages over budget: ${bad.join(', ')}`);
});

// Per region (docs/PLAN_V2.md 3.7): each region built from its own data
// file, against the same calibration (scripts/city-build-bench.mjs
// --ratio), best of two cold runs. Measured 2026-11-23: Downtown 8.0 to
// 9.3, the others 5.5 to 6.2; limits about 1.7 times the slowest.
const bench = fileURLToPath(new URL('../scripts/city-build-bench.mjs', import.meta.url));
const REGION_LIMIT = { 'miami-downtown': 16, 'miami-beach': 11, 'miami-north': 11, 'miami-west': 11, 'miami-south': 11 };
test('build budget: each region / calibration', () => {
  const bad = [], seen = [];
  for (const [id, limit] of Object.entries(REGION_LIMIT)) {
    let best = Infinity;
    for (let k = 0; k < 2; k++) {
      const r = spawnSync(process.execPath, [bench, '--ratio', '--region', id], { encoding: 'utf8' });
      if (r.status !== 0) throw new Error(r.stderr);
      best = Math.min(best, ratioOf(JSON.parse(r.stdout.trim().split('\n').pop())));
    }
    seen.push(`${id} ${best.toFixed(1)}`);
    if (best >= limit) bad.push(`${id} ${best.toFixed(2)} (limit ${limit})`);
  }
  assert.deepEqual(bad, [], `regions over budget: ${bad.join(', ')} (all: ${seen.join(', ')})`);
});
