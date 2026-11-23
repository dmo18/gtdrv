// Region smoke (docs/PLAN_V2.md 5.4): each Miami region loads in the real
// page (?map=<id>), shows its start view with moving cars, starts, drives
// 300 steps, makes no page error and no request off the page's origin.
// Screenshots: dist/regions/<id>.png (the start view behind the title)
// and dist/regions/<id>-drive.png (after the drive).
// Usage: node scripts/smoke-regions.mjs [--no-build] [miami-beach ...]
//        npm run gate -- --regions   (runs it after smoke --extra)
import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';
import { buildGame, serve } from './build.mjs';
import { REGION_IDS } from '../src/world/regions.js';

let chromium;
try {
  ({ chromium } = await import('playwright'));
} catch {
  ({ chromium } = createRequire('/opt/node-tools/node_modules/')('playwright'));
}

const only = process.argv.slice(2).filter((a) => REGION_IDS.includes(a));
const ids = only.length ? only : REGION_IDS;
const MIN_MOVING = 4; // moving cars in the start view
const VIEW_R = 160; // m round the spawn that count as the start view

if (!process.argv.includes('--no-build')) await buildGame();
const server = await serve(0);
const port = server.address().port;
const origin = `http://127.0.0.1:${port}/`;
await mkdir('dist/regions', { recursive: true });
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });

let failed = false;
const check = (ok, label) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}`);
  if (!ok) failed = true;
};

try {
  for (const id of ids) {
    console.log(`--- ${id}`);
    const page = await browser.newPage({ viewport: { width: 915, height: 412 }, hasTouch: true, isMobile: true, deviceScaleFactor: 1 });
    const errors = [], external = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    page.on('request', (r) => {
      const u = r.url();
      if (!u.startsWith(origin) && !u.startsWith('data:') && !u.startsWith('blob:')) external.push(u);
    });
    try {
      // A fresh page with no save: the start view behind the title.
      await page.goto(`${origin}?map=${id}`);
      await page.waitForFunction(() => window.__rw && window.__rw.loop.running && !document.querySelector('#play')?.disabled, null, { timeout: 120000 });
      // Let the start-view traffic get going (simulated time, not wall time).
      await page.evaluate(() => { for (let i = 0; i < 120; i++) window.__rw.step(1 / 60); window.__rw.draw(1, 0); });
      await page.waitForTimeout(400);
      const view = await page.evaluate((R) => {
        const g = window.__rw, c = g.city, s = c.startView ? c.startView.spawn : c.spawn;
        let moving = 0, cars = 0;
        for (const v of g.vehicles) {
          if (v.removed || v === g.player.vehicle || Math.hypot(v.x - s.x, v.z - s.z) > R) continue;
          if (v.kind === 'car') cars++;
          if (v.kind === 'car' && Math.abs(v.speed || 0) > 1) moving++;
        }
        const pv = g.player.vehicle;
        return {
          mapId: c.mapId, moving, cars, title: !!c.startView, street: c.startView && c.startView.spawn.street,
          land: c.shoreDist(s.x, s.z), onRoad: c.onRoad(s.x, s.z), inBuilding: c.inBuilding(s.x, s.z, 0.5),
          car: pv ? { y: pv.y || 0, inBuilding: c.inBuilding(pv.x, pv.z, 0.5) } : null,
          pads: (c.travelPads || []).length, ends: (c.roadEnds || []).length,
          marks: g.session && g.session.travelMarkers ? !!g.session.travelMarkers() : false,
        };
      }, VIEW_R);
      await page.screenshot({ path: `dist/regions/${id}.png` });
      check(view.mapId === id, `${id}: the page plays ${view.mapId}`);
      check(view.title && !!view.street, `${id}: a designed start view on ${view.street}`);
      check(view.land > 5 && view.onRoad && !view.inBuilding, `${id}: the start is on a road on land (${view.land.toFixed(0)} m inland)`);
      check(view.moving >= MIN_MOVING, `${id}: ${view.moving} moving cars in the start view (${view.cars} cars within ${VIEW_R} m; at least ${MIN_MOVING})`);
      check(!view.car || (Math.abs(view.car.y) < 1 && !view.car.inBuilding), `${id}: the start car stands on the street`);
      check(view.pads > 0 && view.marks, `${id}: ${view.pads} travel pads, drawn`);
      // Start, then drive 300 steps with the throttle held.
      await page.locator('#play').click();
      // The camera blends to the chase view, then (first visit) the steering
      // question pauses the game: answer it with the buttons.
      await page.waitForFunction(() => !(window.__rw.titleCam && window.__rw.titleCam.active) || window.__rw.menu.isAsking(), null, { timeout: 30000 });
      await page.waitForFunction(() => window.__rw.menu.isAsking() || !window.__rw.paused, null, { timeout: 10000 }).catch(() => {});
      if (await page.evaluate(() => window.__rw.menu.isAsking())) await page.locator('.rw-menu-ask [data-steering="buttons"]').click();
      await page.waitForTimeout(300);
      check(await page.evaluate(() => !window.__rw.paused), `${id}: playing after Start`);
      const before = await page.evaluate(() => ({ x: window.__rw.player.x, z: window.__rw.player.z }));
      await page.keyboard.down('ArrowUp');
      await page.waitForTimeout(150);
      await page.evaluate(() => { for (let i = 0; i < 300; i++) window.__rw.step(1 / 60); window.__rw.draw(1, 0); });
      await page.waitForTimeout(400);
      const after = await page.evaluate(() => {
        const g = window.__rw, v = g.player.vehicle;
        return { x: g.player.x, z: g.player.z, speed: v ? v.speed : 0, y: v ? v.y || 0 : 0, mode: g.player.mode };
      });
      await page.screenshot({ path: `dist/regions/${id}-drive.png` });
      await page.keyboard.up('ArrowUp');
      const moved = Math.hypot(after.x - before.x, after.z - before.z);
      check(moved > 3 && Number.isFinite(after.x), `${id}: drove ${moved.toFixed(1)} m in 300 steps (${after.mode})`);
    } catch (e) {
      check(false, `${id}: ${e.message}`);
    }
    check(external.length === 0, `${id}: no outside network requests (${external.length})`);
    check(errors.length === 0, `${id}: no page errors (${errors.length})`);
    for (const e of errors.slice(0, 5)) console.log('   ', e);
    await page.close();
  }
} finally {
  await browser.close();
  server.close();
}
console.log(failed ? 'REGION SMOKE FAILED' : 'REGION SMOKE PASSED');
process.exit(failed ? 1 : 0);
