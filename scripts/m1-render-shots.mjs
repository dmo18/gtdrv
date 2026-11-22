// Screenshots for the world render workstream (docs/REVAMP.md W2) at
// 915 x 412, pixel ratio 1, on the default page: a downtown street by day
// and at night, Little Havana, the waterfront and the spawn street. Each
// line printed gives the draw calls, triangles and near tiles of the view.
// usage: node scripts/m1-render-shots.mjs [outDir] [prefix]
import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';
import { buildGame, serve } from './build.mjs';

let chromium;
try {
  ({ chromium } = await import('playwright'));
} catch {
  ({ chromium } = createRequire('/opt/node-tools/node_modules/')('playwright'));
}
const out = process.argv[2] || 'docs/preview';
const prefix = process.argv[3] || 'm1-render';
await buildGame();
const server = await serve(0);
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 915, height: 412 }, hasTouch: true, isMobile: true, deviceScaleFactor: 1 });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
await page.goto(`http://127.0.0.1:${server.address().port}/?autostart`);
await page.waitForFunction(() => window.__rw && window.__rw.loop.running, null, { timeout: 180000 });
await page.evaluate(() => {
  const g = window.__rw;
  g.loop.stop();
  for (const k of ['car', 'foot', 'boat', 'plane', 'heli', 'first']) g.progress.medals['hint_' + k] = 'bronze';
  for (const k of ['downtown', 'midtown', 'residential', 'docks', 'industrial', 'beach', 'airfield', 'park', 'shore']) g.progress.medals['seen_' + k] = 'bronze';
  if (g.graphics && 'adaptive' in g.graphics) { g.graphics.adaptive = false; g.resize(); }
});
// The player car on the road edge nearest (x, z) (at least `minW` wide),
// facing along it (or the other way with flip), the chase camera caught up.
const place = (x, z, minW = 0, flip = false) => page.evaluate(([x, z, minW, flip]) => {
  const g = window.__rw, c = g.city;
  let best = null, bd = Infinity;
  for (const e of c.edges) {
    if (e.width < minW || e.bridge || e.causeway) continue;
    const a = c.nodes[e.a], b = c.nodes[e.b];
    const mx = (a.x + b.x) / 2, mz = (a.z + b.z) / 2;
    const d = Math.hypot(mx - x, mz - z);
    if (d < bd && e.length > 40) { bd = d; best = e; }
  }
  const a = c.nodes[best.a], b = c.nodes[best.b];
  const v = g.player.vehicle;
  const h = Math.atan2(b.z - a.z, b.x - a.x) + (flip ? Math.PI : 0);
  // On the right-hand lane, a third of the way along.
  const t = 0.35, side = best.width / 4;
  v.x = v.px = a.x + (b.x - a.x) * t - Math.sin(h) * side;
  v.z = v.pz = a.z + (b.z - a.z) * t + Math.cos(h) * side;
  v.heading = v.pheading = h;
  v.vx = v.vz = 0;
  v.speed = 0;
  if (g.snapCam) g.snapCam();
  return { x: Math.round(v.x), z: Math.round(v.z), road: best.name || '', lotType: c.lotTypeAt ? c.lotTypeAt(v.x, v.z) : '' };
}, [x, z, minW, flip]);
const step = (n, draws = 30) => page.evaluate(([k, d]) => {
  const g = window.__rw;
  for (let i = 0; i < k; i++) g.step(1 / 60);
  for (let i = 0; i < d; i++) {
    g.cityMesh.userData.stream.flush(g.camera);
    g.draw(1, 1 / 60);
  }
  return { calls: g.graphics.calls, tris: g.graphics.triangles, near: g.cityMesh.userData.stream.stats.near };
}, [n, draws]);
const hour = (h) => page.evaluate((h) => { window.__rw.daynight.setHour(h); }, h);
const shot = async (name, where) => {
  const i = await step(5, 3);
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${out}/${prefix}-${name}.png`, timeout: 180000 });
  console.log('wrote', `${out}/${prefix}-${name}.png`, JSON.stringify({ ...where, ...i }));
};
const sp = await page.evaluate(() => {
  const g = window.__rw;
  if (g.traffic && g.traffic.clear) g.traffic.clear();
  return g.city.spawn;
});

// 1-2. Downtown: a street north of the spawn, by day and at night.
await hour(14);
let w = await place(-1000, 420, 10);
await step(60, 4);
await shot('downtown-day', w);
await hour(22);
await step(30, 4);
await shot('downtown-night', w);
// 3. Little Havana, mid afternoon.
await hour(15.5);
w = await place(-2300, 1090, 8);
await step(60, 4);
await shot('little-havana', w);
// 4. The waterfront: along the bay south of the river mouth.
await hour(16.5);
w = await place(-620, 1000, 8);
await step(60, 4);
await shot('waterfront', w);
// 5. The spawn street, as the game starts it.
await hour(17.5);

await page.evaluate(([x, z, h]) => {
  const g = window.__rw, v = g.player.vehicle;
  v.x = v.px = x; v.z = v.pz = z; v.heading = v.pheading = h;
  if (g.snapCam) g.snapCam();
}, [sp.x, sp.z, sp.heading]);
await step(60, 4);
await shot('spawn-street', { x: Math.round(sp.x), z: Math.round(sp.z) });

console.log(errors.length ? `${errors.length} page errors: ${errors.slice(0, 5).join(' | ')}` : 'no page errors');
await browser.close();
server.close();
