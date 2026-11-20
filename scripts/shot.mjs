// Developer helper: screenshot the running game from a chosen spot.
// usage: node scripts/shot.mjs name x z heading [camHeight]
import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';
import { buildGame, serve } from './build.mjs';

let chromium;
try {
  ({ chromium } = await import('playwright'));
} catch {
  ({ chromium } = createRequire('/opt/node-tools/node_modules/')('playwright'));
}
const [name = 'shot', x, z, heading = '0', up = '0'] = process.argv.slice(2);
await buildGame({ minify: false });
const server = await serve(0);
await mkdir('shots', { recursive: true });
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 915, height: 412 }, hasTouch: true, isMobile: true, deviceScaleFactor: 1 });
page.on('pageerror', (e) => console.log('pageerror', String(e)));
await page.goto(`http://127.0.0.1:${server.address().port}/?autostart`);
await page.waitForFunction(() => window.__rw && window.__rw.loop.running, null, { timeout: 30000 });
if (x !== undefined) {
  await page.evaluate(([px, pz, h, u]) => {
    const g = window.__rw;
    const v = g.player.vehicle;
    if (v) {
      v.x = v.px = px;
      v.z = v.pz = pz;
      v.heading = v.pheading = h;
      v.vx = v.vz = 0;
    }
    g.debugCamUp = u;
  }, [Number(x), Number(z), Number(heading), Number(up)]);
}
await page.waitForTimeout(1500);
if (Number(up) > 0) {
  await page.evaluate((u) => {
    const g = window.__rw;
    g.loop.stop();
    g.camera.position.y += u;
    g.camera.position.x -= Math.cos(g.player.heading) * u;
    g.camera.position.z -= Math.sin(g.player.heading) * u;
    g.camera.lookAt(g.player.x, 0, g.player.z);
    g.renderer.render(g.scene, g.camera);
  }, Number(up));
}
await page.screenshot({ path: `shots/${name}.png` });
await browser.close();
server.close();
