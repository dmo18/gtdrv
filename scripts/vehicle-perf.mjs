// Developer helper: draw calls and triangles spent on vehicles in the
// running game (street view at the spawn), split near / far LOD.
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
  g.draw(1, 1 / 60);
  const cam = g.camera;
  cam.updateMatrixWorld();
  let near = 0, far = 0, calls = 0, tris = 0;
  for (const v of g.vehicles) {
    if (v.kind !== 'car' || !v.mesh) continue;
    if (v.lodFar) far++; else near++;
    v.mesh.traverseVisible((o) => {
      if (!o.isMesh) return;
      calls++;
      const gg = o.geometry;
      tris += (gg.index ? gg.index.count : gg.attributes.position.count) / 3;
    });
  }
  return { carsNear: near, carsFar: far, carCallsAll: calls, carTrisAll: tris, totalCalls: g.renderer.info.render.calls, totalTris: g.renderer.info.render.triangles };
});
console.log(JSON.stringify(out));
await browser.close();
server.close();
