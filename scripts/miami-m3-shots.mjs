// Screenshots of the whole-box Miami map (docs/MAP.md milestone 3) at
// 915 x 412 on the default page: a downtown street by day and at night,
// a corner street sign, a view over the bay to the towers, the airfield,
// and a high view that shows the far level of detail.
// usage: node scripts/miami-m3-shots.mjs [outDir]
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
  if (g.traffic && g.traffic.clear) g.traffic.clear();
});
// Steps, then draws a few frames so the chase camera catches up (every
// near tile is built first).
const step = (n, draws = 30) => page.evaluate(([k, d]) => {
  const g = window.__rw;
  for (let i = 0; i < k; i++) g.step(1 / 60);
  for (let i = 0; i < d; i++) {
    g.cityMesh.userData.stream.flush(g.camera);
    g.draw(1, 1 / 60);
  }
}, [n, draws]);
// Re-render from a free camera at e looking at t (the HUD stays).
const look = (e, t) => page.evaluate(([e, t]) => {
  const g = window.__rw;
  g.camera.position.set(e[0], e[1], e[2]);
  g.camera.lookAt(t[0], t[1], t[2]);
  g.camera.updateMatrixWorld();
  g.cityMesh.userData.stream.flush(g.camera);
  // Sky, sea and lights follow the camera: let the systems see it here.
  for (const s of g.systems) if (s.render) s.render(1, 0);
  if (g.renderFrame) g.renderFrame(1 / 60);
  else g.renderer.render(g.scene, g.camera);
  return { calls: g.renderer.info.render.calls, tris: g.renderer.info.render.triangles, near: g.cityMesh.userData.stream.stats.near };
}, [e, t]);
const info = () => page.evaluate(() => {
  const g = window.__rw;
  return { calls: g.renderer.info.render.calls, tris: g.renderer.info.render.triangles, near: g.cityMesh.userData.stream.stats.near };
});
const shot = async (name, view = null, wait = 500) => {
  let i = view ? await look(view[0], view[1]) : await info();
  await page.waitForTimeout(wait);
  if (view) i = await look(view[0], view[1]);
  await page.screenshot({ path: `${out}/${name}.png` });
  console.log('wrote', `${out}/${name}.png`, JSON.stringify(i));
};
const hour = (h) => page.evaluate((h) => { window.__rw.daynight.setHour(h); }, h);
// The player car at a point on a street, facing along it.
const park = (x, z, heading) => page.evaluate(([x, z, h]) => {
  const g = window.__rw;
  const v = g.player.vehicle;
  v.x = v.px = x;
  v.z = v.pz = z;
  v.heading = v.pheading = h;
  v.vx = v.vz = 0;
  v.speed = 0;
  if (g.snapCam) g.snapCam();
}, [x, z, heading]);

// 1-2. A downtown street (the spawn on Southeast 1st Street, looking
// east to Biscayne Boulevard) by day and at night.
const sp = await page.evaluate(() => window.__rw.city.spawn);
await hour(14);
await park(sp.x - 60 * Math.cos(sp.heading), sp.z - 60 * Math.sin(sp.heading), sp.heading);
await step(60);
await shot('miami-m3-downtown-day');
await hour(22);
await step(30);
await shot('miami-m3-downtown-night');

// A corner street sign (real names from the data) near the start.
const sign = await page.evaluate(() => {
  const g = window.__rw, s = g.city.spawn;
  return g.city.furniture.filter((f) => f.type === 'streetsign').sort((a, b) => Math.hypot(a.x - s.x, a.z - s.z) - Math.hypot(b.x - s.x, b.z - s.z))[0];
});
await hour(14);
await step(5, 5);
{
  // From the corner opposite, between the two plates' roads.
  const ex = sign.x - (Math.cos(sign.ra) + Math.cos(sign.rb)) * 5, ez = sign.z - (Math.sin(sign.ra) + Math.sin(sign.rb)) * 5;
  await shot('miami-m3-street-sign', [[ex, 2.6, ez], [sign.x, 2.9, sign.z]]);
}

// 3. Over the bay off Bayfront Park, west to the Downtown towers.
await hour(16.5);
await step(5, 5);
await shot('miami-m3-bay', [[-150, 40, 520], [-1300, 70, 380]]);

// 4. The airfield on its islet in the north bay, from the south-east.
const af = await page.evaluate(() => window.__rw.city.airfield.islet);
await shot('miami-m3-airfield', [[af.x1 - 40, 55, af.z1 + 120], [af.x0 + 250, 0, (af.z0 + af.z1) / 2]]);

// 5. High over Edgewater looking south: the whole box at the far level.
await shot('miami-m3-high', [[-1500, 420, -3300], [-900, 0, 0]]);

console.log(errors.length ? `${errors.length} page errors: ${errors.slice(0, 5).join(' | ')}` : 'no page errors');
await browser.close();
server.close();
