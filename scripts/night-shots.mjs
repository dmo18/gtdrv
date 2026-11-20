// Developer helper: night (and matching day) screenshots for judging the
// night look: a downtown street, the harbour and the player car with its
// headlights, each at 23:00 and at 13:00 for day regression.
// usage: node scripts/night-shots.mjs [prefix]   (default prefix "night")
// Writes docs/preview/<prefix>-<view>.png and prints draw calls.
import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';
import { buildGame, serve } from './build.mjs';

let chromium;
try {
  ({ chromium } = await import('playwright'));
} catch {
  ({ chromium } = createRequire('/opt/node-tools/node_modules/')('playwright'));
}
const prefix = process.argv[2] || 'night';
const only = process.argv.slice(3);
await buildGame({ minify: false });
// name: [where, hour, camera]
const VIEWS = {
  downtown: ['spawn', 23, 'chase'],
  harbour: ['harbour', 23, 'chase'],
  car: ['spawn', 23, 'front'],
  'downtown-day': ['spawn', 13, 'chase'],
  'harbour-day': ['harbour', 13, 'chase'],
  'car-day': ['spawn', 13, 'front'],
};
const server = await serve(0);
await mkdir('docs/preview', { recursive: true });
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 915, height: 412 }, hasTouch: true, isMobile: true, deviceScaleFactor: 1 });
page.on('pageerror', (e) => console.log('pageerror', String(e)));
page.on('console', (m) => {
  if (m.type() === 'error') console.log(m.type(), m.text().slice(0, 300));
});
await page.goto(`http://127.0.0.1:${server.address().port}/?autostart`);
await page.waitForFunction(() => window.__rw && window.__rw.loop.running, null, { timeout: 90000 });
for (const [name, [where, hour, cam]] of Object.entries(VIEWS)) {
  if (only.length && !only.includes(name)) continue;
  const info = await page.evaluate(async ([where, hour, cam]) => {
    const g = window.__rw;
    const c = g.city;
    let x = c.spawn.x, z = c.spawn.z, heading = c.spawn.heading || 0;
    if (where === 'harbour') {
      // Out on the docks marina pier, looking back at the city over the water.
      const m = c.pois.find((p) => p.type === 'marina' && /Saltyard/.test(p.label)) || c.pois.find((p) => p.type === 'marina');
      if (m) { x = m.x; z = m.z + 26; heading = -Math.PI / 2; } else { x = 58; z = 596; heading = 1.35; }
    }
    if (g.graphics && 'adaptive' in g.graphics) { g.graphics.adaptive = false; g.resize(); }
    g.loop.start();
    const v = g.player.vehicle;
    v.x = v.px = x; v.z = v.pz = z; v.heading = v.pheading = heading; v.vx = v.vz = 0; v.speed = 0;
    if (g.snapCam) g.snapCam();
    g.daynight.setWeather('clear', true);
    g.daynight.setHour(hour);
    await new Promise((r) => setTimeout(r, 1600));
    g.daynight.setHour(hour);
    g.loop.stop();
    g.graphics.refreshEnvironment();
    g.draw(1, 0);
    if (cam === 'front') {
      // Low and ahead of the car, to one side, looking back at it and
      // along the road it lights.
      const ch = Math.cos(heading), sh = Math.sin(heading);
      g.camera.position.set(x + ch * 9 - sh * 4.5, 1.5, z + sh * 9 + ch * 4.5);
      g.camera.lookAt(x + ch * 1.5, 0.7, z + sh * 1.5);
      g.camera.updateMatrixWorld();
      g.renderFrame(0);
    }
    return { calls: g.graphics.calls, triangles: g.graphics.triangles };
  }, [where, hour, cam]);
  await page.screenshot({ path: `docs/preview/${prefix}-${name}.png` });
  console.log(name, JSON.stringify(info));
}
await browser.close();
server.close();
