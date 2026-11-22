// Child process for test/build-budget.test.js: one cold build of the
// whole Miami box between calibration runs; prints the times as JSON.
import fs from 'node:fs';
import { createMiamiCity } from '../../src/world/miami.js';

// A fixed workload shaped like the build: raster passes, a flood fill and
// float maths over a 2.4 M cell grid, plus small object churn.
function calibrate() {
  const W = 1600, H = 1500, N = W * H;
  const grid = new Uint8Array(N), lab = new Int32Array(N).fill(-1), q = new Int32Array(N);
  let s = 12345;
  for (let c = 0; c < N; c++) {
    s = (Math.imul(s, 1103515245) + 12345) | 0;
    grid[c] = (s >>> 16) % 7 === 0 ? 1 : 0;
  }
  let regions = 0;
  for (let c0 = 0; c0 < N; c0++) {
    if (grid[c0] || lab[c0] >= 0) continue;
    let h = 0, t = 0;
    q[t++] = c0;
    lab[c0] = regions;
    while (h < t) {
      const c = q[h++], i = c % W;
      if (i > 0 && !grid[c - 1] && lab[c - 1] < 0) { lab[c - 1] = regions; q[t++] = c - 1; }
      if (i < W - 1 && !grid[c + 1] && lab[c + 1] < 0) { lab[c + 1] = regions; q[t++] = c + 1; }
      if (c >= W && !grid[c - W] && lab[c - W] < 0) { lab[c - W] = regions; q[t++] = c - W; }
      if (c < N - W && !grid[c + W] && lab[c + W] < 0) { lab[c + W] = regions; q[t++] = c + W; }
    }
    regions++;
  }
  let acc = 0;
  for (let c = 0; c < N; c++) acc += Math.sqrt(lab[c] + c * 0.5) * Math.cos(c * 1e-3);
  const boxes = [];
  for (let k = 0; k < 60000; k++) boxes.push({ x0: k * 0.5, z0: k * 0.25, x1: k * 0.5 + 3, z1: k * 0.25 + 2, h: k % 9 });
  for (const b of boxes) acc += (b.x1 - b.x0) * (b.z1 - b.z0) + b.h;
  return acc + regions;
}
function timeIt(fn) {
  const c0 = process.cpuUsage(), t0 = performance.now();
  const r = fn();
  return { r, wall: performance.now() - t0, cpu: process.cpuUsage(c0).user / 1000 };
}

const data = JSON.parse(fs.readFileSync(new URL('../../src/world/data/miami.json', import.meta.url), 'utf8'));
// Calibration once before and three times after the (cold) build; the
// fastest run counts (a pause in one run does not move it).
const cals = [timeIt(calibrate)];
const build = timeIt(() => createMiamiCity(data));
for (let k = 0; k < 3; k++) cals.push(timeIt(calibrate));
const calWall = Math.min(...cals.map((c) => c.wall)), calCpu = Math.min(...cals.map((c) => c.cpu));
process.stdout.write(JSON.stringify({ wall: build.wall, cpu: build.cpu, calWall, calCpu, lots: build.r.lots.length, buildings: build.r.buildings.length, timings: build.r.timings }) + '\n');
