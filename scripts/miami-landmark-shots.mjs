// Miami landmarks on the full map and the minimap, 915 x 412.
// usage: node scripts/miami-landmark-shots.mjs [outDir]
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
const p = await page.evaluate(() => {
  const g = window.__rw;
  g.player.x = -835; g.player.z = -260; // near the Kaseya Center, downtown
  if (g.player.vehicle) { g.player.vehicle.x = -835; g.player.vehicle.z = -260; }
  g.paused = false;
  for (let i = 0; i < 30; i++) g.step(1 / 60);
  for (let i = 0; i < 10; i++) g.draw(1, 1 / 60);
  g.map.render(1, 1);
  return { x: g.player.x, z: g.player.z, n: g.city.mapLandmarks.length };
});
console.log(JSON.stringify(p));
await page.screenshot({ path: `${out}/miami-landmarks-minimap.png` });
await page.evaluate(() => {
  const g = window.__rw;
  g.map.fullMap.open({ x: -1100, z: 1500, heading: 0, waypoint: null, markers: g.map.markers });
});
await page.waitForTimeout(400);
await page.screenshot({ path: `${out}/miami-landmarks-fullmap.png` });
console.log(errors.length ? 'ERRORS ' + errors.join('\n') : 'no errors');
await browser.close();
server.close();
