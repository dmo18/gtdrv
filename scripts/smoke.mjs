// Builds the game, opens it in headless Chromium at phone size, drives
// forward for a few seconds and fails on any error.
import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';
import { buildGame, serve } from './build.mjs';

let chromium;
try {
  ({ chromium } = await import('playwright'));
} catch {
  ({ chromium } = createRequire('/opt/node-tools/node_modules/')('playwright'));
}

await buildGame();
const server = await serve(0);
const port = server.address().port;
await mkdir('shots', { recursive: true });

const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 915, height: 412 }, hasTouch: true, isMobile: true, deviceScaleFactor: 1 });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text());
});
const requests = [];
page.on('request', (r) => requests.push(r.url()));

let failed = false;
const check = (ok, label) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}`);
  if (!ok) failed = true;
};

try {
  // The default page (no parameters): the Miami map.
  const t0 = Date.now();
  await page.goto(`http://127.0.0.1:${port}/?autostart`);
  await page.waitForFunction(() => window.__rw && window.__rw.loop.running, null, { timeout: 90000 });
  const loadMs = Date.now() - t0;
  await page.waitForTimeout(1500);
  const before = await page.evaluate(() => ({ x: window.__rw.player.x, z: window.__rw.player.z, cars: window.__rw.vehicles.length, map: window.__rw.city.map, cityMs: window.__rw.city.buildMs, meshMs: Math.round(window.__rw.cityMesh.userData.buildMs) }));
  check(before.map === 'miami', `the default page is the Miami map (${before.map}; loaded in ${loadMs} ms: city ${before.cityMs} ms, mesh ${before.meshMs} ms)`);
  check(before.cityMs + before.meshMs < 8000, `Miami build time within budget (${before.cityMs + before.meshMs} ms of 8000)`);
  await page.keyboard.down('ArrowUp');
  await page.waitForTimeout(200);
  await page.evaluate(() => {
    for (let i = 0; i < 300; i++) window.__rw.step(1 / 60);
  });
  await page.waitForTimeout(300);
  const mid = await page.evaluate(() => ({ x: window.__rw.player.x, z: window.__rw.player.z, speed: window.__rw.player.vehicle?.speed ?? 0, t: window.__rw.time }));
  await page.screenshot({ path: 'shots/drive.png' });
  await page.keyboard.up('ArrowUp');
  const moved = Math.hypot(mid.x - before.x, mid.z - before.z);
  check(moved > 3, `car moved under throttle (${moved.toFixed(1)} m, sim time ${mid.t.toFixed(1)} s)`);
  check(before.cars > 3, `parked cars spawned (${before.cars} vehicles)`);
  check(Number.isFinite(mid.x) && Number.isFinite(mid.speed), 'state is finite');
  const external = requests.filter((u) => !u.startsWith(`http://127.0.0.1:${port}/`) && !u.startsWith('data:') && !u.startsWith('blob:'));
  check(external.length === 0, `no outside network requests (${external.length})`);
  check(errors.length === 0, `no page errors (${errors.length})`);
  for (const e of errors.slice(0, 10)) console.log('   ', e);
  if (process.argv.includes('--extra')) {
    // The extra checks start on the procedural island (?map=island).
    await page.goto(`http://127.0.0.1:${port}/?autostart&map=island`);
    await page.waitForFunction(() => window.__rw && window.__rw.loop.running, null, { timeout: 60000 });
    await page.waitForTimeout(1500);
    check(await page.evaluate(() => !window.__rw.city.map), '?map=island opens the procedural island');
    await page.keyboard.down('ArrowUp');
    await page.waitForTimeout(200);
    await page.evaluate(() => {
      for (let i = 0; i < 240; i++) window.__rw.step(1 / 60);
    });
    await page.keyboard.up('ArrowUp');
    const mod = await import('./smoke-extra.mjs');
    failed = (await mod.default(page, check)) === false || failed;
  }
} catch (e) {
  console.log('FAIL', e.message);
  for (const er of errors.slice(0, 10)) console.log('   ', er);
  failed = true;
} finally {
  await browser.close();
  server.close();
}
process.exit(failed ? 1 : 0);
