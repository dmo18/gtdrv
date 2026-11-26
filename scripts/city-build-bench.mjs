// Developer helper: times the node build of the whole Miami box (or one
// region, from its own data file), stage by stage, each run in a fresh
// (cold) node process like the unit test, and prints the median of the
// runs, with the heap and buffers held after a forced collection.
// usage: node scripts/city-build-bench.mjs [--runs 3] [--best] [--slow] [--json] [--stages] [--region miami-downtown]
//   --best   the best (lowest) of the runs instead of the median.
//   --slow   mimic a slow shared CI runner: every run and a busy node loop
//            share one CPU (taskset -c 0), so the build gets about half a core.
//   --child  one cold run, prints its stage times as JSON (used by the parent;
//            add `node --cpu-prof` in front of it to profile one build).
//   --ratio  one cold build between calibration runs (the workload of
//            test/fixtures/build-budget-run.mjs), prints wall, cpu, main-
//            thread cpu (thread) and the calibration times as JSON
//            (test/build-budget.test.js, regions).
//   --stages the stage table of test/build-budget.test.js: --runs cold
//            --ratio builds (with --slow: pinned beside the busy loop),
//            each stage's best ratio and its main-thread CPU ms.
import fs from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const opt = (k, d) => {
  const i = args.indexOf(k);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : d;
};
const self = fileURLToPath(import.meta.url);
const region = opt('--region', null);

// Stage name, then the city.timings keys it sums (createMiamiCity laps).
const CITY_STAGES = [
  ['land mask', ['land.coast', 'land.fill', 'land.votes', 'land.walls', 'land.water', 'land']],
  ['roads and graph', ['graph', 'network']],
  ['junctions', ['junctions']],
  ['shore field', ['shore.stamp', 'shore.field', 'shore']],
  ['blocks', ['blocks']],
  ['buildings', ['buildings']],
  ['landmark infill', ['infill.stamp', 'infill.masks', 'infill.plan', 'infill']],
  ['extras (props, spots)', ['extras']],
  ['lot grid and classes', ['lots.classes', 'lots.pieces', 'lots.objects', 'lots.grid']],
  // lots.build is the whole buildLots call plus the parking lot bays; the
  // lots.* laps inside buildLots are subtracted (see the child).
  ['parking lot bays', ['lots.build', 'lots']],
  ['stunts (ramps)', ['places.ramps']],
  ['secrets', ['places.secrets']],
  ['courses', ['places.courses']],
  ['places (rest)', ['places']],
  ['street props settle', ['streetscape']],
];

async function child() {
  const now = () => performance.now();
  const cpu0 = process.cpuUsage();
  const out = {};
  let t = now();
  const lap = (k) => {
    const n = now();
    out[k] = n - t;
    t = n;
  };
  const { createMiamiCity } = await import('../src/world/miami.js');
  const { attachExplore, placeAdventures, ROUTE_SPECS } = await import('../src/world/adventures.js');
  const { buildRoutes } = await import('../src/world/courses.js');
  const { placeGarages } = await import('../src/world/garages.js');
  const { createCollisionWorld, fillCollision, attachLotCollision } = await import('../src/world/collision.js');
  const { dressLot } = await import('../src/world/lots.js');
  const { createService } = await import('../src/systems/service.js');
  lap('module load');
  const file = region ? region + '.json' : 'miami.json';
  const data = JSON.parse(fs.readFileSync(new URL('../src/world/data/' + file, import.meta.url), 'utf8'));
  lap('data decode');
  const c0 = process.cpuUsage();
  const t0 = now();
  const city = createMiamiCity(data, region ? { region } : {});
  out['createMiamiCity wall'] = now() - t0;
  out['createMiamiCity cpu'] = process.cpuUsage(c0).user / 1000;
  t = now();
  for (const [name, keys] of CITY_STAGES) out[name] = keys.reduce((s, k) => s + (city.timings[k] || 0), 0);
  out['parking lot bays'] -= out['lot grid and classes'];
  // What the game does next (game.js): explore, then the renderer's
  // whole-map collision. Garages and adventures timed on their own first.
  // (attachExplore does these three plus the clean-up of spots and props.)
  // (On a region these may still throw until they filter by region:
  // reported as NaN.)
  try {
    const g = placeGarages(city);
    lap('garages');
    placeAdventures(city, g);
    lap('adventures');
    buildRoutes(city, ROUTE_SPECS);
    lap('routes');
    attachExplore(city);
    lap('attachExplore (all)');
  } catch {
    out['attachExplore (all)'] = NaN;
    t = now();
  }
  const col = createCollisionWorld();
  fillCollision(city, col);
  lap('static collision fill');
  // The lots' solids: a lazy layer (cells filled by the first query that
  // touches them), as buildRealCity attaches it.
  const layer = attachLotCollision(city, col);
  lap('lot collision attach');
  try {
    createService({ city, events: null });
    lap('service spots');
  } catch {
    out['service spots'] = NaN;
  }
  // createMiamiCity to here: the node part of the game's start.
  out['game path wall'] = now() - t0;
  out['game path cpu'] = process.cpuUsage(c0).user / 1000;
  // Not on the game's start path, for reference: every lot's shapes (a
  // full sweep of the lazy layer, which dresses every lot once).
  t = now();
  out.lotShapes = layer.count();
  lap('lot full sweep (ref)');
  let nf = 0;
  const F = [];
  for (const lot of city.lots) nf += dressLot(city, lot, F).length;
  lap('dressLot all again (ref)');
  out.features = nf;
  out['process cpu'] = process.cpuUsage(cpu0).user / 1000;
  out.buildingBoxes = city.buildings.length;
  out.nodes = city.nodes.length;
  out.edges = city.edges.length;
  out.lots = city.lots.length;
  out.parkingSpots = city.parkingSpots.length;
  if (globalThis.gc) {
    globalThis.gc();
    const m = process.memoryUsage();
    out['heap MB after gc'] = m.heapUsed / 1e6;
    out['buffers MB after gc'] = m.arrayBuffers / 1e6;
  }
  void city.lots.length;
  process.stdout.write(JSON.stringify(out) + '\n');
}

function runChild(pin) {
  const cmd = pin ? 'taskset' : process.execPath;
  const tail = ['--expose-gc', self, '--child', ...(region ? ['--region', region] : [])];
  const a = pin ? ['-c', '0', process.execPath, ...tail] : tail;
  const r = spawnSync(cmd, a, { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(r.stderr || 'child failed');
  return JSON.parse(r.stdout.trim().split('\n').pop());
}

// The stages of test/build-budget.test.js (createMiamiCity laps).
const BUDGET_STAGES = {
  land: ['land.coast', 'land.fill', 'land.votes', 'land.walls', 'land.water', 'land'],
  roads: ['graph', 'network'],
  shore: ['shore.stamp', 'shore.field', 'shore'],
  buildings: ['blocks', 'buildings'],
  infill: ['infill.stamp', 'infill.masks', 'infill.plan', 'infill'],
  lots: ['lots.build', 'lots'],
  places: ['places.ramps', 'places.secrets', 'places.courses', 'places'],
};
function stages(runs, slow) {
  const tail = [self, '--ratio', ...(region ? ['--region', region] : [])];
  const best = {}, cpu = {};
  for (let k = 0; k < runs; k++) {
    const r = spawnSync(slow ? 'taskset' : process.execPath, slow ? ['-c', '0', process.execPath, ...tail] : tail, { encoding: 'utf8' });
    if (r.status !== 0) throw new Error(r.stderr || 'child failed');
    const o = JSON.parse(r.stdout.trim().split('\n').pop());
    for (const [name, keys] of Object.entries(BUDGET_STAGES)) {
      const wall = keys.reduce((a, x) => a + (o.timings[x] || 0), 0), th = keys.reduce((a, x) => a + (o.cpuTimings[x] || 0), 0);
      best[name] = Math.min(best[name] ?? Infinity, wall / o.calWall, th / o.calThread);
      cpu[name] = Math.min(cpu[name] ?? Infinity, th);
    }
  }
  console.log(`build budget stages${slow ? ' (slow)' : ''}: best of ${runs} cold runs, ratio to the calibration (main-thread CPU ms)`);
  for (const name of Object.keys(BUDGET_STAGES)) console.log(`${name.padEnd(10)} ${best[name].toFixed(2).padStart(6)}  (${cpu[name].toFixed(0)} ms)`);
}

async function main() {
  const runs = Number(opt('--runs', 3));
  const slow = args.includes('--slow');
  let busy = null;
  if (slow) {
    // A second busy node loop on the same CPU as the build.
    busy = spawn('taskset', ['-c', '0', process.execPath, '-e', 'for(;;){}'], { stdio: 'ignore' });
  }
  if (args.includes('--stages')) {
    try {
      stages(runs, slow);
    } finally {
      if (busy) busy.kill('SIGKILL');
    }
    return;
  }
  const res = [];
  try {
    for (let k = 0; k < runs; k++) res.push(runChild(slow));
  } finally {
    if (busy) busy.kill('SIGKILL');
  }
  const best = args.includes('--best');
  const med = (k) => {
    const v = res.map((r) => r[k]).filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
    return v.length ? v[best ? 0 : (v.length - 1) >> 1] : NaN;
  };
  const keys = Object.keys(res[0]);
  if (args.includes('--json')) {
    const o = {};
    for (const k of keys) o[k] = Math.round(med(k));
    console.log(JSON.stringify(o));
    return;
  }
  console.log(`${slow ? 'slow-runner simulation (taskset -c 0 with a busy loop)' : 'normal'}: ${best ? 'best' : 'median'} of ${runs} cold runs, ms`);
  for (const k of keys) console.log(`${k.padEnd(28)} ${String(Math.round(med(k))).padStart(7)}   [${res.map((r) => Math.round(r[k])).join(', ')}]`);
}

// The calibration workload of test/fixtures/build-budget-run.mjs (kept
// the same, so the ratios of both are comparable).
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
async function ratio() {
  const { createMiamiCity } = await import('../src/world/miami.js');
  const file = region ? region + '.json' : 'miami.json';
  const data = JSON.parse(fs.readFileSync(new URL('../src/world/data/' + file, import.meta.url), 'utf8'));
  // Main-thread CPU as well (as test/fixtures/build-budget-run.mjs): the
  // compiler's and the GC's helper threads, which a loaded runner slows
  // with everything else, are not in it.
  const threadMs = typeof process.threadCpuUsage === 'function'
    ? () => { const u = process.threadCpuUsage(); return (u.user + u.system) / 1000; }
    : () => { const u = process.cpuUsage(); return (u.user + u.system) / 1000; };
  const timeIt = (fn) => {
    const c0 = process.cpuUsage(), t0 = performance.now(), m0 = threadMs();
    const r = fn();
    return { r, wall: performance.now() - t0, cpu: process.cpuUsage(c0).user / 1000, thread: threadMs() - m0 };
  };
  const cals = [timeIt(calibrate)];
  const build = timeIt(() => createMiamiCity(data, region ? { region, cpuClock: threadMs } : { cpuClock: threadMs }));
  for (let k = 0; k < 3; k++) cals.push(timeIt(calibrate));
  const calWall = Math.min(...cals.map((c) => c.wall)), calCpu = Math.min(...cals.map((c) => c.cpu));
  const calThread = Math.min(...cals.map((c) => c.thread));
  process.stdout.write(JSON.stringify({ region, wall: build.wall, cpu: build.cpu, thread: build.thread, calWall, calCpu, calThread, buildings: build.r.buildings.length, timings: build.r.timings, cpuTimings: build.r.cpuTimings }) + '\n');
}

if (args.includes('--ratio')) await ratio();
else if (args.includes('--child')) await child();
else await main();
