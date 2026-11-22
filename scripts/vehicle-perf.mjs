// Developer helper: draw calls and triangles spent on vehicles in the
// running game (street view at the spawn), split near / far LOD, and the
// cost of ten extra cars parked 20 to 50 m ahead of the camera.
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
const measure = () => page.evaluate(() => {
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
      // Instanced meshes (the four wheels) draw count copies.
      tris += ((gg.index ? gg.index.count : gg.attributes.position.count) / 3) * (o.isInstancedMesh ? o.count : 1);
    });
  }
  return { carsNear: near, carsFar: far, carCallsAll: calls, carTrisAll: tris, totalCalls: g.renderer.info.render.calls, totalTris: g.renderer.info.render.triangles };
});
const base = await measure();
console.log('street', JSON.stringify(base));
// Ten more cars, 20 to 50 m ahead of the camera, in view.
await page.evaluate(() => {
  const g = window.__rw;
  const c = g.camera.position;
  const dir = g.camera.getWorldDirection(g.camera.position.clone());
  const h = Math.atan2(dir.z, dir.x);
  const ids = ['compact', 'sedan', 'taxi', 'police', 'sports', 'muscle', 'ghostwake', 'pickup', 'van', 'truck'];
  ids.forEach((id, k) => {
    const d = 20 + k * 3.3, side = (k % 2 ? 1 : -1) * 2;
    g.debug.spawnCar(id, c.x + Math.cos(h) * d - Math.sin(h) * side, c.z + Math.sin(h) * d + Math.cos(h) * side, h);
  });
  g.loop.start();
});
await page.waitForTimeout(1500);
const ten = await measure();
console.log('ten more cars', JSON.stringify(ten));
console.log(JSON.stringify({ tenCarsAddCalls: ten.totalCalls - base.totalCalls, tenCarsAddCarCalls: ten.carCallsAll - base.carCallsAll, tenCarsAddTris: ten.totalTris - base.totalTris }));
await browser.close();
server.close();
