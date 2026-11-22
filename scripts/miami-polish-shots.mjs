// Screenshots for the Miami street polish pass at 915 x 412 on the
// default page: downtown from the street by day and at night, Little
// Havana low-rise on Calle Ocho, the Bayfront waterfront and sea, and a
// palm-lined Brickell Avenue. Prints draw calls and triangles per view.
// usage: node scripts/miami-polish-shots.mjs [prefix] [outDir]
import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';
import { buildGame, serve } from './build.mjs';

let chromium;
try {
  ({ chromium } = await import('playwright'));
} catch {
  ({ chromium } = createRequire('/opt/node-tools/node_modules/')('playwright'));
}
const prefix = process.argv[2] || 'miami-polish';
const out = process.argv[3] || 'docs/preview';
await buildGame();
const server = await serve(0);
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 915, height: 412 }, hasTouch: true, isMobile: true, deviceScaleFactor: 1 });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
await page.goto(`http://127.0.0.1:${server.address().port}/?autostart`);
await page.addStyleTag({ content: '.rw-title { display: none !important; }' }).catch(() => {});
await page.waitForFunction(() => window.__rw && window.__rw.loop.running, null, { timeout: 180000 });
await page.evaluate(() => {
  const g = window.__rw;
  g.loop.stop();
  for (const k of ['car', 'foot', 'boat', 'plane', 'heli', 'first']) g.progress.medals['hint_' + k] = 'bronze';
  for (const k of ['downtown', 'midtown', 'residential', 'docks', 'industrial', 'beach', 'airfield', 'park', 'shore']) g.progress.medals['seen_' + k] = 'bronze';
  if (g.traffic && g.traffic.clear) g.traffic.clear();
});
const step = (n, draws = 30) => page.evaluate(([k, d]) => {
  const g = window.__rw;
  for (let i = 0; i < k; i++) g.step(1 / 60);
  for (let i = 0; i < d; i++) {
    g.cityMesh.userData.stream.flush(g.camera);
    g.draw(1, 1 / 60);
  }
}, [n, draws]);
const look = (e, t) => page.evaluate(([e, t]) => {
  const g = window.__rw;
  g.camera.position.set(e[0], e[1], e[2]);
  g.camera.lookAt(t[0], t[1], t[2]);
  g.camera.updateMatrixWorld();
  g.cityMesh.userData.stream.flush(g.camera);
  for (const s of g.systems) if (s.render) s.render(1, 0);
  if (g.renderFrame) g.renderFrame(1 / 60);
  else g.renderer.render(g.scene, g.camera);
  return { calls: g.renderer.info.render.calls, tris: g.renderer.info.render.triangles };
}, [e, t]);
const info = () => page.evaluate(() => {
  const g = window.__rw, gr = g.graphics || {};
  return { calls: gr.calls || g.renderer.info.render.calls, tris: gr.triangles || g.renderer.info.render.triangles };
});
const shot = async (name, view = null) => {
  let i = view ? await look(view[0], view[1]) : await info();
  await page.waitForTimeout(400);
  if (view) i = await look(view[0], view[1]);
  await page.screenshot({ path: `${out}/${prefix}-${name}.png` });
  console.log('wrote', `${out}/${prefix}-${name}.png`, JSON.stringify(i));
};
const hour = (h) => page.evaluate((h) => { window.__rw.daynight.setHour(h); }, h);
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
// A point `k` of the way along the longest edge whose name has `name`
// near (px, pz), on its right-hand lane, facing along it.
const onStreet = (name, px, pz, k = 0.3) => page.evaluate(([name, px, pz, k]) => {
  const c = window.__rw.city;
  let best = null, bd = Infinity;
  for (const e of c.edges) {
    if (!e.name || !e.name.includes(name)) continue;
    const a = c.nodes[e.a], b = c.nodes[e.b];
    const d = Math.hypot((a.x + b.x) / 2 - px, (a.z + b.z) / 2 - pz) - e.length * 0.3;
    if (d < bd) { bd = d; best = e; }
  }
  const a = c.nodes[best.a];
  const off = best.width * 0.25;
  return [a.x + best.ux * best.length * k - best.uz * off, a.z + best.uz * best.length * k + best.ux * off, Math.atan2(best.uz, best.ux)];
}, [name, px, pz, k]);

// 1-2. Downtown from the street (the spawn street) by day and at night.
const sp = await page.evaluate(() => window.__rw.city.spawn);
await hour(14);
await park(sp.x - 60 * Math.cos(sp.heading), sp.z - 60 * Math.sin(sp.heading), sp.heading);
await step(60);
await shot('downtown-day');
await hour(22);
await step(30);
await shot('downtown-night');

// 3. Little Havana low-rise on Calle Ocho (Southwest 8th Street).
await hour(10.5);
{
  const [x, z, h] = await onStreet('Southwest 8th Street', -2100, 1530, 0.25);
  await park(x, z, h);
  // Long enough for the neighbourhood banner to fade.
  await step(260);
  await shot('havana');
}

// 4. The Bayfront waterfront and the sea from the seawall.
await hour(16);
{
  const p = await page.evaluate(() => {
    const c = window.__rw.city;
    let x = -760;
    const z = 470;
    while (x < 0 && c.mainShore(x, z) > 12) x += 2;
    return [x, z];
  });
  await step(5, 5);
  // From the park edge, south along the shore toward Brickell Key.
  await shot('waterfront', [[p[0] - 14, 3.2, p[1] - 40], [p[0] + 90, 4, p[1] + 320]]);
}

// 5. A palm-lined street: Brickell Avenue.
await hour(15);
{
  const [x, z, h] = await onStreet('Brickell Avenue', -1440, 2580, 0.2);
  await park(x, z, h);
  await step(260);
  await shot('palms');
  // Looking up at the Brickell towers from the pavement.
  await shot('towers', [[x - Math.sin(h) * 9, 1.7, z + Math.cos(h) * 9], [x + Math.cos(h) * 60 - Math.sin(h) * 30, 32, z + Math.sin(h) * 60 + Math.cos(h) * 30]]);
}

console.log(errors.length ? `${errors.length} page errors: ${errors.slice(0, 5).join(' | ')}` : 'no page errors');
await browser.close();
server.close();
