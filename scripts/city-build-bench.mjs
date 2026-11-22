// Developer helper: times the node build of the whole Miami box, stage by
// stage, each run in a fresh (cold) node process like the unit test, and
// prints the median of the runs.
// usage: node scripts/city-build-bench.mjs [--runs 3] [--slow] [--json]
//   --slow   mimic a slow shared CI runner: every run and a busy node loop
//            share one CPU (taskset -c 0), so the build gets about half a core.
//   --child  one cold run, prints its stage times as JSON (used by the parent;
//            add `node --cpu-prof` in front of it to profile one build).
import fs from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const opt = (k, d) => {
  const i = args.indexOf(k);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : d;
};
const self = fileURLToPath(import.meta.url);

// Stage name, then the city.timings keys it sums (createMiamiCity laps).
const CITY_STAGES = [
  ['land mask', ['land.coast', 'land.fill', 'land.votes', 'land.walls', 'land.water', 'land']],
  ['roads and graph', ['graph', 'network']],
  ['shore field', ['shore.stamp', 'shore.field', 'shore']],
  ['blocks', ['blocks']],
  ['buildings', ['buildings']],
  ['landmark infill', ['infill.stamp', 'infill.masks', 'infill.plan', 'infill']],
  ['extras (props, spots)', ['extras']],
  ['lot grid and classes', ['lots.classes', 'lots.pieces', 'lots.objects', 'lots.grid']],
  // lots.build is the whole buildLots call plus the car park bays; the
  // lots.* laps inside buildLots are subtracted (see the child).
  ['car park bays', ['lots.build', 'lots']],
  ['stunts (ramps)', ['places.ramps']],
  ['secrets', ['places.secrets']],
  ['courses', ['places.courses']],
  ['places (rest)', ['places']],
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
  const data = JSON.parse(fs.readFileSync(new URL('../src/world/data/miami.json', import.meta.url), 'utf8'));
  lap('data decode');
  const c0 = process.cpuUsage();
  const t0 = now();
  const city = createMiamiCity(data);
  out['createMiamiCity wall'] = now() - t0;
  out['createMiamiCity cpu'] = process.cpuUsage(c0).user / 1000;
  t = now();
  for (const [name, keys] of CITY_STAGES) out[name] = keys.reduce((s, k) => s + (city.timings[k] || 0), 0);
  out['car park bays'] -= out['lot grid and classes'];
  // What the game does next (game.js): explore, then the renderer's
  // whole-map collision. Garages and adventures timed on their own first.
  // (attachExplore does these three plus the clean-up of spots and props.)
  const g = placeGarages(city);
  lap('garages');
  placeAdventures(city, g);
  lap('adventures');
  buildRoutes(city, ROUTE_SPECS);
  lap('routes');
  attachExplore(city);
  lap('attachExplore (all)');
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
  process.stdout.write(JSON.stringify(out) + '\n');
}

function runChild(pin) {
  const cmd = pin ? 'taskset' : process.execPath;
  const a = pin ? ['-c', '0', process.execPath, self, '--child'] : [self, '--child'];
  const r = spawnSync(cmd, a, { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(r.stderr || 'child failed');
  return JSON.parse(r.stdout.trim().split('\n').pop());
}

async function main() {
  const runs = Number(opt('--runs', 3));
  const slow = args.includes('--slow');
  let busy = null;
  if (slow) {
    // A second busy node loop on the same CPU as the build.
    busy = spawn('taskset', ['-c', '0', process.execPath, '-e', 'for(;;){}'], { stdio: 'ignore' });
  }
  const res = [];
  try {
    for (let k = 0; k < runs; k++) res.push(runChild(slow));
  } finally {
    if (busy) busy.kill('SIGKILL');
  }
  const med = (k) => {
    const v = res.map((r) => r[k]).filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
    return v.length ? v[(v.length - 1) >> 1] : NaN;
  };
  const keys = Object.keys(res[0]);
  if (args.includes('--json')) {
    const o = {};
    for (const k of keys) o[k] = Math.round(med(k));
    console.log(JSON.stringify(o));
    return;
  }
  console.log(`${slow ? 'slow-runner simulation (taskset -c 0 with a busy loop)' : 'normal'}: median of ${runs} cold runs, ms`);
  for (const k of keys) console.log(`${k.padEnd(28)} ${String(Math.round(med(k))).padStart(7)}   [${res.map((r) => Math.round(r[k])).join(', ')}]`);
}

if (args.includes('--child')) await child();
else await main();
