// Screenshots of the Miami map (docs/MAP.md milestone 1) at phone size:
// from the street at the spawn and from out on the bay.
// usage: node scripts/miami-shots.mjs [outDir]
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
page.on('crash', () => console.log('PAGE CRASHED'));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
await page.goto(`http://127.0.0.1:${server.address().port}/?autostart&map=miami`);
await page.waitForFunction(() => window.__rw && window.__rw.loop.running, null, { timeout: 60000 });
await page.evaluate(() => window.__rw.loop.stop());
// Free camera: eye at (ex, ey, ez) looking at (tx, ty, tz).
const look = (name, e, t) => page.evaluate(([e, t]) => {
  const g = window.__rw;
  g.draw(1, 0);
  g.camera.position.set(e[0], e[1], e[2]);
  g.camera.lookAt(t[0], t[1], t[2]);
  g.camera.updateMatrixWorld();
  g.renderer.render(g.scene, g.camera);
}, [e, t]).then(() => page.screenshot({ path: `${out}/${name}.png` }));
const spawn = await page.evaluate(() => {
  const g = window.__rw;
  for (let i = 0; i < 120; i++) g.step(1 / 60);
  g.draw(1, 0);
  return { x: g.city.spawn.x, z: g.city.spawn.z, h: g.city.spawn.heading, ms: g.city.buildMs, mesh: Math.round(g.cityMesh.userData.buildMs) };
});
console.log('spawn', spawn);
await page.screenshot({ path: `${out}/miami-street.png` });
// From the bay east of Bayfront Park, looking west at downtown.
await look('miami-bay', [-150, 40, 450], [-1100, 60, 650]);
// High over Watson Island looking south-west across downtown and Brickell.
await look('miami-aerial', [600, 420, -900], [-900, 0, 700]);
// The airfield islet from the causeway end.
await look('miami-airfield', [-500, 60, -2150], [400, 0, -2300]);
console.log('page errors', errors.length);
for (const e of errors.slice(0, 10)) console.log('  ', e);
await browser.close();
server.close();
