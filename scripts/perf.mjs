// Developer helper: reports draw calls, triangles and step/draw cost.
import { createRequire } from 'node:module';
import { buildGame, serve } from './build.mjs';

let chromium;
try {
  ({ chromium } = await import('playwright'));
} catch {
  ({ chromium } = createRequire('/opt/node-tools/node_modules/')('playwright'));
}
await buildGame();
const server = await serve(0);
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 915, height: 412 }, deviceScaleFactor: 1 });
page.on('pageerror', (e) => console.log('pageerror', String(e)));
await page.goto(`http://127.0.0.1:${server.address().port}/?autostart`);
await page.waitForFunction(() => window.__rw && window.__rw.loop.running, null, { timeout: 30000 });
await page.waitForTimeout(6000);
const out = await page.evaluate(() => {
  const g = window.__rw;
  g.loop.stop();
  const info = g.renderer.info;
  let t0 = performance.now();
  for (let i = 0; i < 300; i++) g.step(1 / 60);
  const stepMs = (performance.now() - t0) / 300;
  g.draw(1, 1 / 60);
  const kinds = {};
  for (const v of g.vehicles) kinds[v.kind] = (kinds[v.kind] || 0) + 1;
  let meshes = 0;
  g.scene.traverse((o) => {
    if (o.isMesh || o.isPoints || o.isLine) meshes++;
  });
  return { calls: info.render.calls, triangles: info.render.triangles, geometries: info.memory.geometries, textures: info.memory.textures, stepMs: +stepMs.toFixed(3), vehicles: kinds, sceneMeshes: meshes, systems: g.systems.map((s) => s.name) };
});
console.log(JSON.stringify(out, null, 1));
await browser.close();
server.close();
