// Developer helper: builds the real-map renderer in node (no browser, no
// canvas: a stand-in texture set) and times every tile build slice
// (docs/REVAMP.md W2: no slice over 5 ms) for the tiles round a few
// points. Garbage collection pauses are timed apart (a PerformanceObserver
// on 'gc'), so a slice is reported with and without the pauses inside it.
// usage: node scripts/tile-bench.mjs [rounds]
import fs from 'node:fs';
import { PerformanceObserver } from 'node:perf_hooks';
import { createMiamiCity } from '../src/world/miami.js';
import { createCollisionWorld } from '../src/world/collision.js';
import { buildRealCity } from '../src/render/realcity.js';

const gcs = [];
new PerformanceObserver((l) => { for (const e of l.getEntries()) gcs.push([e.startTime, e.startTime + e.duration]); }).observe({ entryTypes: ['gc'] });
const data = JSON.parse(fs.readFileSync(new URL('../src/world/data/miami.json', import.meta.url), 'utf8'));
const city = createMiamiCity(data);
const rect = { u0: 0, u1: 1, v0: 0, v1: 1, w: 64, h: 64 };
const rects = new Proxy({}, { get: (o, k) => (typeof k === 'string' ? rect : undefined) });
const tex = new Proxy({}, { get: (o, k) => (k === 'decals' || k === 'details' ? { rects } : {}) });
const warn = console.warn;
console.warn = () => {};
const t0 = performance.now();
const group = buildRealCity(city, createCollisionWorld(), { textures: tex });
console.warn = warn;
const st = group.userData.stream;
console.log('renderer build', Math.round(performance.now() - t0), 'ms', JSON.stringify(group.userData.timings), 'lot shapes', st.lotShapes());
const points = [
  ['spawn', city.spawn.x, city.spawn.z],
  ['little havana', -2300, 1090],
  ['brickell', -1300, 1700],
  ['wynwood', -1800, -2600],
  ['port', 300, 1200],
];
const rounds = +process.argv[2] || 1;
const worst = { all: 0, work: 0 }, byKind = {};
let slices = 0, over5 = 0, over5work = 0;
const cpus = [];
await new Promise((r) => setTimeout(r, 10));
for (let round = 0; round < rounds; round++) {
  for (const [, x, z] of points) {
    const k0 = st.tileOf(x, z);
    const ks = [k0, k0 + 1, k0 - 1, k0 + st.NX, k0 - st.NX];
    for (const k of ks) {
      const t = st.tiles[k];
      if (!t) continue;
      const job = st.tileJob(t);
      for (;;) {
        const c0 = process.cpuUsage();
        const a = performance.now();
        const r = job.next();
        const b = performance.now();
        const c1 = process.cpuUsage(c0);
        cpus.push((c1.user + c1.system) / 1000);
        // GC entries arrive late: settle them after the loop.
        slices++;
        const d = b - a;
        if (r.value) byKind[r.value] = byKind[r.value] || [];
        if (r.value) byKind[r.value].push([a, b]);
        if (d > worst.all) worst.all = d;
        if (d > 5) over5++;
        if (r.done) break;
      }
      // Drop what was built (the job leaves it on the tile).
      if (t.group) { group.remove(t.group); for (const m of t.meshes) m.geometry.dispose(); t.group = null; }
    }
  }
}
await new Promise((r) => setTimeout(r, 50));
const gcIn = (a, b) => { let s = 0; for (const [g0, g1] of gcs) s += Math.max(0, Math.min(b, g1) - Math.max(a, g0)); return s; };
const out = {};
const works = [];
for (const [k, list] of Object.entries(byKind)) {
  let w = 0, wg = 0;
  for (const [a, b] of list) {
    const d = b - a, work = d - gcIn(a, b);
    if (d > w) w = d;
    if (work > wg) wg = work;
    works.push(work);
    if (work > 5) over5work++;
  }
  out[k] = { slices: list.length, worst: +w.toFixed(1), worstWithoutGc: +wg.toFixed(1) };
  if (wg > worst.work) worst.work = wg;
}
console.log(JSON.stringify(out));
works.sort((a, b) => a - b);
const pc = (q) => works[Math.min(works.length - 1, Math.floor(q * works.length))].toFixed(1);
console.log(`slice work without GC: median ${pc(0.5)} ms, 95th ${pc(0.95)}, 99th ${pc(0.99)}, max ${pc(1)}`);
cpus.sort((a, b) => a - b);
const pcc = (q) => cpus[Math.min(cpus.length - 1, Math.floor(q * cpus.length))].toFixed(1);
console.log(`slice CPU time (process, all threads; not slowed by other processes): median ${pcc(0.5)} ms, 95th ${pcc(0.95)}, 99th ${pcc(0.99)}, max ${pcc(1)}`);
console.log(`slices ${slices}; worst ${worst.all.toFixed(1)} ms (${over5} over 5 ms); worst without GC pauses ${worst.work.toFixed(1)} ms (${over5work} over 5 ms); GC pauses ${gcs.length}, longest ${Math.max(...gcs.map(([a, b]) => b - a)).toFixed(1)} ms`);
