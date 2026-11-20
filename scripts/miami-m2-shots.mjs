// Screenshots of the Miami map's places (docs/MAP.md milestone 2) at
// 915 x 412: a race start marker with the minimap, the full map with the
// race starts, a secret found, the HUD neighbourhood name and the
// OpenStreetMap credit in the menu.
// usage: node scripts/miami-m2-shots.mjs [outDir]
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
await page.goto(`http://127.0.0.1:${server.address().port}/?autostart&map=miami`);
await page.waitForFunction(() => window.__rw && window.__rw.loop.running, null, { timeout: 120000 });
await page.evaluate(() => {
  const g = window.__rw;
  g.loop.stop();
  if (g.daynight && g.daynight.setHour) g.daynight.setHour(15);
  // Hints off for clean shots (they are marked as seen).
  for (const k of ['car', 'foot', 'boat', 'plane', 'heli', 'first']) g.progress.medals['hint_' + k] = 'bronze';
  // Areas seen too, so the only toast in the secret shot is the find.
  for (const k of ['downtown', 'midtown', 'residential', 'docks', 'industrial', 'beach', 'airfield', 'park', 'shore']) g.progress.medals['seen_' + k] = 'bronze';
});
// Steps, then draws a few frames so the chase camera catches up.
const step = (n, draws = 40) => page.evaluate(([k, d]) => { const g = window.__rw; for (let i = 0; i < k; i++) g.step(1 / 60); for (let i = 0; i < d; i++) g.draw(1, 1 / 60); }, [n, draws]);
// Re-render from a free camera at e looking at t (the HUD stays).
const look = (e, t) => page.evaluate(([e, t]) => {
  const g = window.__rw;
  g.camera.position.set(e[0], e[1], e[2]);
  g.camera.lookAt(t[0], t[1], t[2]);
  g.camera.updateMatrixWorld();
  g.renderer.render(g.scene, g.camera);
}, [e, t]);
const shot = async (name, view = null, wait = 700) => {
  if (view) await look(view[0], view[1]);
  await page.waitForTimeout(wait); // CSS fades (HUD name, toasts)
  await page.screenshot({ path: `${out}/${name}.png` });
  console.log('wrote', `${out}/${name}.png`);
};

// 1. The Downtown Loop start marker, from the car just short of it,
// with the minimap (the start icons) in the corner.
await page.evaluate(() => {
  const g = window.__rw;
  const c = g.activities.courses.find((q) => q.id === 'street-glasswell');
  const v = g.player.vehicle;
  const back = 22;
  v.x = v.px = c.start.x - Math.cos(c.start.heading) * back;
  v.z = v.pz = c.start.z - Math.sin(c.start.heading) * back;
  v.heading = v.pheading = c.start.heading;
  v.vx = v.vz = 0;
  v.speed = 0;
});
await step(90);
const st = await page.evaluate(() => window.__rw.activities.courses.find((q) => q.id === 'street-glasswell').start);
await shot('miami-m2-race-start', [[st.x - Math.cos(st.heading) * 34, 16, st.z - Math.sin(st.heading) * 34], [st.x, 0, st.z]]);

// 2. The full map with every race, boat and sky course start.
await page.evaluate(() => {
  const g = window.__rw;
  g.input.press('map');
  g.map.always();
  g.input.release('map');
});
await shot('miami-m2-map');
await page.evaluate(() => {
  const g = window.__rw;
  g.input.press('map');
  g.map.always();
  g.input.release('map');
  g.paused = false;
});

// 3. A secret found: on foot at Rustlamp Rock, the Palm Island lighthouse.
const lamp = await page.evaluate(() => {
  const g = window.__rw;
  const v = g.player.vehicle;
  if (v) {
    v.vx = v.vz = 0;
    v.speed = 0;
    v.driver = null;
    g.player.vehicle = null;
    g.setPlayerMode('foot');
  }
  const s = g.secrets.spots.find((q) => q.id === 'rustlamp');
  const w = g.player.walker;
  // Stand on the land side, facing the lighthouse and the bay.
  w.x = w.px = s.x - Math.cos(s.heading) * 9;
  w.z = w.pz = s.z - Math.sin(s.heading) * 9;
  w.heading = s.heading;
  return { x: s.x, z: s.z, h: s.heading };
});
// Find it before the area toast: stand at the spot first, then step.
await step(40, 2); // few draws: the find toast is still up for the shot
const found = await page.evaluate(() => window.__rw.secrets.count());
await shot('miami-m2-secret', [[lamp.x - Math.cos(lamp.h) * 24 + 10, 15, lamp.z - Math.sin(lamp.h) * 24 + 10], [lamp.x, 7, lamp.z]], 250);
console.log('secret found', found, lamp);

// 4. The HUD name: walk into Watson Island from the Biscayne Bay side.
await page.evaluate(() => {
  const g = window.__rw;
  const hp = g.city.helipads.find((h) => g.city.placeOf(h.x, h.z) === 'Watson Island');
  const w = g.player.walker;
  w.x = w.px = hp.x + 20;
  w.z = w.pz = hp.z + 20;
});
await step(30);
const name = await page.evaluate(() => document.querySelector('.rw-district') && document.querySelector('.rw-district').textContent);
await shot('miami-m2-district');
console.log('HUD name', name);

// 5. The menu: Settings, scrolled to the map credit.
await page.evaluate(() => {
  const g = window.__rw;
  g.menu.open('settings');
  const c = document.querySelector('[data-role="map-credit"]');
  if (c) c.scrollIntoView({ block: 'end' });
});
await shot('miami-m2-credit');
const credit = await page.evaluate(() => { const c = document.querySelector('[data-role="map-credit"]'); return c && c.textContent; });
console.log('credit', credit);

console.log('page errors', errors.length);
for (const e of errors.slice(0, 10)) console.log('  ', e);
await browser.close();
server.close();
