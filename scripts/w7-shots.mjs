// W7 sky, light and water shots (derived from m1-render-shots.mjs):
// Little Havana and the waterfront at noon, dusk and night. Writes
// docs/preview/w7-<view>-<time>.png.
// (old header) Screenshots for the world render workstream (docs/REVAMP.md W2) at
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
const prefix = process.argv[3] || 'w7';
await buildGame();
const server = await serve(0);
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 915, height: 412 }, hasTouch: true, isMobile: true, deviceScaleFactor: 1 });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
await page.goto(`http://127.0.0.1:${server.address().port}/?autostart`);
await page.waitForFunction(() => window.__rw && window.__rw.loop.running, null, { timeout: 420000 });
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
  const i = { calls: await page.evaluate(() => window.__rw.graphics.calls) };
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${out}/${prefix}-${name}.png`, timeout: 180000 });
  console.log('wrote', `${out}/${prefix}-${name}.png`, JSON.stringify({ ...where, ...i }));
};
await page.evaluate(() => { const g = window.__rw; if (g.traffic && g.traffic.clear) g.traffic.clear(); });
// After place(): put the camera somewhere with sky in view. 'shore' stands
// 30 m out to sea from the nearest shoreline looking back at it; 'street' sits a
// little behind and above the car looking along the street.
const aim = (mode) => page.evaluate((mode) => {
  const g = window.__rw, c = g.city, v = g.player.vehicle;
  let px = v.x, pz = v.z, lx = Math.cos(v.heading), lz = Math.sin(v.heading), y = 5, ly = 90;
  if (mode === 'shore') {
    let best = null, bd = 1e9;
    for (let a = 0; a < 16; a++) {
      const dx = Math.cos(a * Math.PI / 8), dz = Math.sin(a * Math.PI / 8);
      for (let t = 5; t < 700; t += 5) {
        if (c.shoreDist(v.x + dx * t, v.z + dz * t) < 0) { if (t < bd) { bd = t; best = [dx, dz, t]; } break; }
      }
    }
    if (best) {
      // 30 m out in the water, looking back at the wall and the city.
      px = v.x + best[0] * (best[2] + 30); pz = v.z + best[1] * (best[2] + 30);
      lx = -best[0]; lz = -best[1]; y = 3.0; ly = 60;
    }
  } else { px = v.x - lx * 12; pz = v.z - lz * 12; y = 7; ly = 140; }
  g.camera.position.set(px, y, pz);
  g.camera.lookAt(px + lx * 200, ly * 0.3, pz + lz * 200);
  g.camera.updateMatrixWorld();
  for (let i = 0; i < 4; i++) {
    g.cityMesh.userData.stream.flush(g.camera);
    for (const sys of g.systems) if (sys.render) sys.render(1, 0);
    g.renderFrame(1 / 60);
  }
}, mode);
const views = { havana: [-2300, 1090, 8, false, 'street'], waterfront: [-620, 1000, 8, false, 'shore'] };
const times = { noon: 12.5, dusk: 18.9, night: 22.5 };
const only = process.argv.slice(4);
for (const [vn, [x, z, mw, fl, mode]] of Object.entries(views)) {
  if (only.length && !only.includes(vn)) continue;
  await hour(12.5);
  const w = await place(x, z, mw, fl);
  await step(60, 4);
  for (const [tn, h] of Object.entries(times)) {
    await hour(h);
    await step(30, 6);
    await aim(mode);
    await shot(`${vn}-${tn}`, w);
  }
}
console.log(errors.length ? `${errors.length} page errors: ${errors.slice(0, 5).join(' | ')}` : 'no page errors');
await browser.close();
server.close();
