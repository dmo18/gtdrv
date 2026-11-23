// Developer helper: screenshots and counts of a parking lot at the phone
// size (headless Chromium, swiftshader). Puts the player's car at the edge
// of the largest mapped parking lot, facing in, and writes a day and a
// night shot and the draw numbers.
// usage: node scripts/lot-shots.mjs [outDir=dist/lots] [tag=after]
import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';
import { buildGame, serve } from './build.mjs';

let chromium;
try {
  ({ chromium } = await import('playwright'));
} catch {
  ({ chromium } = createRequire('/opt/node-tools/node_modules/')('playwright'));
}
const out = process.argv[2] || 'dist/lots';
const tag = process.argv[3] || 'after';
await mkdir(out, { recursive: true });
// A private build folder, so another build of dist/ cannot swap the page.
const priv = process.env.LOT_BUILD || '/tmp/claude-0/lotbuild';
await buildGame({ outDir: priv });
const server = await serve(0, priv);
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 915, height: 412 }, deviceScaleFactor: 1 });
page.setDefaultTimeout(240000);
page.on('pageerror', (e) => console.log('pageerror', String(e)));
await page.goto(`http://127.0.0.1:${server.address().port}/?autostart`);
await page.waitForFunction(() => window.__rw && window.__rw.loop.running, null, { timeout: 90000 });
if (process.env.LOT_HULL) await page.evaluate(() => { window.__lotHull = true; });
if (process.env.LOT_CLOSE) await page.evaluate((n) => { window.__lotClose = n; }, +process.env.LOT_CLOSE);
const res = await page.evaluate(async () => {
  const g = window.__rw;
  g.loop.stop();
  const c = g.city;
  // The largest parking lot with a road side (front).
  let best = null;
  for (const l of c.lots) if (l.type === 'carpark' && (!best || l.area > best.area)) best = l;
  const cx = (best.x0 + best.x1) / 2, cz = (best.z0 + best.z1) / 2;
  // Stand on the side facing the lot's longer axis, looking across it.
  const alongX = best.x1 - best.x0 >= best.z1 - best.z0;
  const px = alongX ? best.x0 - 6 : cx, pz = alongX ? cz : best.z0 - 6;
  const heading = alongX ? 0 : Math.PI / 2;
  const v = g.player.vehicle;
  v.x = v.px = px; v.z = v.pz = pz; v.heading = v.pheading = heading; v.vx = v.vz = 0; v.speed = 0;
  g.player.x = px; g.player.z = pz;
  g.snapCam();
  const info = g.renderer.info;
  const stats = {};
  const shot = async (name, hour) => {
    g.daynight.setHour(hour);
    for (let i = 0; i < 90; i++) { g.step(1 / 60); if (i % 30 === 29) g.draw(1, 1 / 60); }
    const st = g.cityMesh.userData.stream;
    for (let k = 0; k < 4; k++) { g.draw(1, 1 / 60); if (st) st.flush(g.camera); }
    g.draw(1, 1 / 60);
    const gr = g.graphics || {};
    stats[name] = { calls: gr.calls || info.render.calls, triangles: gr.triangles || info.render.triangles };
    const parked = g.systems.find((s) => s.name === 'parked');
    if (parked && parked.lotField) stats[name].lotCars = parked.lotField.n;
    if (parked && parked.lotView) stats[name].lotView = { ...parked.lotView.stats };
  };
  if (window.__lotClose) {
    // Close-up: 9 m from the nearest lot car, looking at it.
    if (window.__lotHull) g.systems.find((q) => q.name === 'parked').lotView.nearM = 0;
    await shot('prep', 13);
    const f = g.systems.find((q) => q.name === 'parked').lotField;
    if (f.n) {
      const i = Math.min(f.n - 1, window.__lotClose - 1);
      const a = Math.atan2(f.z[i] - pz, f.x[i] - px);
      v.x = v.px = f.x[i] - Math.cos(a) * 9; v.z = v.pz = f.z[i] - Math.sin(a) * 9; v.heading = v.pheading = a;
      g.player.x = v.x; g.player.z = v.z; g.snapCam();
    }
  }
  await shot('day', 13);
  const cam = { x: g.camera.position.x, z: g.camera.position.z };
  if (window.__lotClose) {
    const f = g.systems.find((q) => q.name === 'parked').lotField;
    const near = [];
    for (let i = 0; i < f.n; i++) if (Math.hypot(f.x[i] - g.camera.position.x, f.z[i] - g.camera.position.z) < 25) near.push(['lot', f.spec[i], +f.x[i].toFixed(1), +f.z[i].toFixed(1), +f.yaw[i].toFixed(2)]);
    for (const q of g.vehicles) if (Math.hypot(q.x - g.camera.position.x, q.z - g.camera.position.z) < 25 && q !== g.player.vehicle) near.push([q.kind, q.spec.id, +q.x.toFixed(1), +q.z.toFixed(1), +q.heading.toFixed(2), q.parked ? 'parked' : 'moving']);
    stats.near = near;
  }
  await shot('night', 23);
  return { lot: best.id, type: best.type, district: best.district, area: Math.round(best.area), px, pz, heading, cam, stats };
});
console.log(JSON.stringify(res));
await page.screenshot({ path: `${out}/lot-${tag}-night.png` });
// Back to day for the second shot.
await page.evaluate(() => { const g = window.__rw; g.daynight.setHour(13); for (let i = 0; i < 60; i++) g.step(1 / 60); g.draw(1, 1 / 60); });
await page.screenshot({ path: `${out}/lot-${tag}-day.png` });
await browser.close();
server.close();
