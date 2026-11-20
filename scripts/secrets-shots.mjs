// Developer helper: screenshots of the hidden secrets (docs/SPEC.md "Secrets").
// usage: node scripts/secrets-shots.mjs
// Writes docs/preview/secrets-*.png at 915 x 412.
import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';
import { buildGame, serve } from './build.mjs';

let chromium;
try {
  ({ chromium } = await import('playwright'));
} catch {
  ({ chromium } = createRequire('/opt/node-tools/node_modules/')('playwright'));
}
await buildGame({ minify: false });
const server = await serve(0);
await mkdir('docs/preview', { recursive: true });
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 915, height: 412 }, hasTouch: true, isMobile: true, deviceScaleFactor: 1 });
page.on('pageerror', (e) => console.log('pageerror', String(e)));
await page.goto(`http://127.0.0.1:${server.address().port}/?autostart`);
await page.waitForFunction(() => window.__rw && window.__rw.loop.running, null, { timeout: 60000 });
await page.evaluate(() => window.__rw.daynight?.setHour(14));
await page.addStyleTag({ content: '.rw-toasts { display: none !important; }' });

// A free camera looking at (tx, ty, tz) from (cx, cy, cz), as a still.
async function look(name, [cx, cy, cz], [tx, ty, tz], wait = 800) {
  await page.evaluate(([c, t]) => {
    const g = window.__rw;
    const p = g.player;
    p.x = t[0]; p.z = t[2];
    const v = p.vehicle;
    if (v) { v.x = v.px = c[0]; v.z = v.pz = c[2]; v.vx = v.vz = 0; }
  }, [[cx, cy, cz], [tx, ty, tz]]);
  await page.waitForTimeout(wait);
  await page.evaluate(([c, t]) => {
    const g = window.__rw;
    g.loop.stop();
    g.camera.position.set(c[0], c[1], c[2]);
    g.camera.lookAt(t[0], t[1], t[2]);
    g.renderer.render(g.scene, g.camera);
  }, [[cx, cy, cz], [tx, ty, tz]]);
  await page.screenshot({ path: `docs/preview/${name}.png` });
  await page.evaluate(() => window.__rw.loop.start && window.__rw.loop.start());
}

const spots = await page.evaluate(() => window.__rw.secrets.spots.map((s) => ({ id: s.id, x: s.x, z: s.z, h: s.heading, roofY: s.roofY, tag: s.tag })));
const garage = await page.evaluate(() => { const g = window.__rw.secrets.garage; return { ox: g.ox, oz: g.oz, h: g.heading, cx: g.carX, cz: g.carZ }; });
const by = Object.fromEntries(spots.map((s) => [s.id, s]));
const which = process.argv[2] || 'all';
const at = (s, back, up, side = 0) => [s.x - Math.cos(s.h) * back - Math.sin(s.h) * side, up, s.z - Math.sin(s.h) * back + Math.cos(s.h) * side];
if (which === 'all' || which === 'world') {
  const lh = by.rustlamp;
  await look('secrets-lighthouse', at(lh, 26, 9), [lh.x, 8, lh.z]);
  const bx = by['drowned-box'];
  await look('secrets-container', at(bx, 14, 4.5, 3), [bx.x + Math.cos(bx.h) * 9, 0, bx.z + Math.sin(bx.h) * 9]);
  const cv = by['the-gullet'];
  await look('secrets-cave', at(cv, -20, 6), [cv.x, 2.5, cv.z]);
  const al = by['tag-alley'];
  await look('secrets-alley', [al.tag.x + al.tag.nx * 8, 2.2, al.tag.z + al.tag.nz * 8], [al.tag.x, 2.4, al.tag.z]);
  const pg = by['lone-ride'];
  await look('secrets-playground', at(pg, 18, 7), [pg.x, 2.5, pg.z]);
  const rf = by['roof-garden'];
  await look('secrets-roof', at(rf, 20, rf.roofY + 8), [rf.x, rf.roofY + 1, rf.z]);
}
if (which === 'all' || which === 'garage') {
  await page.evaluate(() => {
    const g = window.__rw;
    g.progress.secrets.found = g.secrets.spots.map((s) => s.id);
    g.progress.secrets.ghostwake = true;
  });
  const fx = garage.ox + Math.cos(garage.h) * 6, fz = garage.oz + Math.sin(garage.h) * 6;
  await page.evaluate(([x, z]) => { const p = window.__rw.player; if (p.vehicle) { p.vehicle.x = x; p.vehicle.z = z; } }, [fx, fz]);
  await page.waitForTimeout(2500);
  await look('secrets-garage', [garage.ox + Math.cos(garage.h) * 10 - Math.sin(garage.h) * 3, 2.4, garage.oz + Math.sin(garage.h) * 10 + Math.cos(garage.h) * 3], [garage.cx, 0.8, garage.cz], 1800);
}
if (which === 'all' || which === 'records') {
  await page.evaluate(() => {
    const g = window.__rw;
    g.progress.secrets.found = ['rustlamp', 'tag-alley', 'lone-ride'];
    g.progress.secrets.ghostwake = false;
    g.events.emit('progress');
    g.menu.open('records');
  });
  await page.waitForTimeout(500);
  await page.screenshot({ path: 'docs/preview/secrets-records.png' });
}
await browser.close();
server.close();
