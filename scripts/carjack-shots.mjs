// Screenshots of a carjacking at three moments (door open and the driver
// leaving the seat, driver on the ground, player driving off). Output:
// docs/preview/carjack-{1,2,3}.png at 915x412. Look at them; the only
// assertions are "no page errors" and that the sequence reaches each moment.
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
await mkdir('docs/preview', { recursive: true });
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 915, height: 412 }, hasTouch: true, isMobile: true, deviceScaleFactor: 1 });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
let failed = false;
const check = (ok, label) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}`);
  if (!ok) failed = true;
};

try {
  await page.goto(`http://127.0.0.1:${port}/?autostart`);
  await page.waitForFunction(() => window.__rw && window.__rw.loop.running, null, { timeout: 30000 });
  await page.evaluate(() => {
    const g = window.__rw;
    g.loop.stop();
    // Drawing is slow in software GL, so only the last two frames are drawn.
    window.__frames = (n) => { for (let i = 0; i < n; i++) { g.step(1 / 60); if (i >= n - 2) g.draw(1, 1 / 60); } };
    window.__steps = (n) => { for (let i = 0; i < n; i++) g.step(1 / 60); };
    // Get out of the starter car, then park an occupied car on the street ahead.
    const car = g.player.vehicle;
    car.vx = car.vz = car.speed = 0;
    g.exitVehicle();
    const sp = g.city.spawn;
    const target = g.debug.spawnOccupied('sports', sp.x + 26, sp.z + 4, 0.4, 'civ');
    const w = g.player.walker;
    w.x = w.px = target.x - 4.2;
    w.z = w.pz = target.z - 1.5;
    w.heading = w.pheading = Math.atan2(target.z - w.z, target.x - w.x);
    g.snapCam();
    window.__target = target;
  });
  await page.evaluate(() => window.__frames(3));
  await page.evaluate(() => {
    const g = window.__rw;
    g.input.press('enter');
    window.__steps(1);
  });
  const near = await page.evaluate(() => ({ busy: window.__rw.carjack.busy, mode: window.__rw.player.mode }));
  check(near.busy, `ENTER on an occupied car starts a carjack (${JSON.stringify(near)})`);
  // Moment 1: door open, driver leaving the seat.
  console.log('stage: waiting for drag');
  let guard = 0;
  while (guard++ < 400) {
    const ph = await page.evaluate(() => { const j = window.__rw.carjack.jack; return j ? j.phase + ':' + j.t.toFixed(2) : 'none'; });
    if (ph.startsWith('drag')) break;
    await page.evaluate(() => window.__steps(1));
  }
  console.log('stage: drag reached after', guard);
  await page.evaluate(() => window.__frames(2));
  await page.screenshot({ path: 'docs/preview/carjack-1.png' });
  // Moment 2: driver on the ground.
  await page.evaluate(() => window.__frames(30));
  const s2 = await page.evaluate(() => { const v = window.__rw.carjack.victims[0]; return v ? { life: v.life, phase: v.cj.phase, mode: window.__rw.player.mode } : null; });
  check(!!s2 && s2.life === 'down', `driver lies on the ground (${JSON.stringify(s2)})`);
  await page.screenshot({ path: 'docs/preview/carjack-2.png' });
  // Moment 3: driving off.
  await page.keyboard.down('ArrowUp');
  await page.evaluate(() => {
    window.__steps(120);
    window.__frames(3);
  });
  const s3 = await page.evaluate(() => ({ mode: window.__rw.player.mode, speed: window.__rw.player.vehicle?.speed ?? 0 }));
  check(s3.mode === 'car' && s3.speed > 3, `player drives off in the stolen car (${JSON.stringify(s3)})`);
  await page.screenshot({ path: 'docs/preview/carjack-3.png' });
  await page.keyboard.up('ArrowUp');
  check(errors.length === 0, `no page errors (${errors.length})`);
  for (const e of errors.slice(0, 10)) console.log('   ', e);
} catch (e) {
  console.log('FAIL', e.message);
  for (const er of errors.slice(0, 10)) console.log('   ', er);
  failed = true;
} finally {
  await browser.close();
  server.close();
}
process.exit(failed ? 1 : 0);
