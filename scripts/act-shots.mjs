// Screenshots of the race UI (START card, countdown, timer with Quit,
// wrong-craft note, full map with activity markers) at two phone sizes.
// Output: shots/act-<w>x<h>-*.png. Look at them; this is not an assertion test
// beyond "no page errors" and a few layout checks.
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

let failed = false;
const check = (ok, label) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}`);
  if (!ok) failed = true;
};

for (const [w, h] of [[915, 412], [780, 360]]) {
  const tag = `act-${w}x${h}`;
  const page = await browser.newPage({ viewport: { width: w, height: h }, hasTouch: true, isMobile: true, deviceScaleFactor: 1 });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  try {
    await page.goto(`http://127.0.0.1:${port}/?autostart`);
    await page.waitForFunction(() => window.__rw && window.__rw.loop.running, null, { timeout: 30000 });
    await page.waitForTimeout(800);
    await page.evaluate(() => {
      const g = window.__rw;
      g.enterVehicle(g.vehicles.find((c) => c.kind === 'car' && !c.ai));
    });
    // Park the car on a point and step the sim with it held still.
    const park = (id, steps) => page.evaluate(([cid, n]) => {
      const g = window.__rw;
      const c = g.activities.courses.find((q) => q.id === cid);
      const car = g.player.vehicle;
      for (let i = 0; i < n; i++) {
        car.x = car.px = c.start.x; car.z = car.pz = c.start.z;
        car.vx = car.vz = 0; car.speed = 0;
        g.step(1 / 60);
      }
      return g.activities.offer;
    }, [id, steps]);
    const sim = (n) => page.evaluate((k) => { for (let i = 0; i < k; i++) window.__rw.step(1 / 60); }, n);

    // 1. Wrong craft: the car at a sky course start gives a note.
    await park('sky-threader', 20);
    const noteShown = await page.evaluate(() => {
      window.__rw.activities.render(0, 0); const n = document.querySelector('.rw-act-note'); return n && !n.classList.contains('rw-act-off') ? n.textContent : ''; });
    check(noteShown === 'Needs a plane or a helicopter', `note shown in the wrong craft (${noteShown})`);
    await page.screenshot({ path: `shots/${tag}-note.png` });

    // 2. START card in a street race zone.
    const offered = await park('street-glasswell', 40);
    check(offered === 'street-glasswell', `offer for the street race (${offered})`);
    await page.evaluate(() => window.__rw.hud.toast('A toast to check the overlap', 30));
    await page.waitForTimeout(300);
    await page.screenshot({ path: `shots/${tag}-offer.png` });
    const btn = await page.evaluate(() => {
      const r = document.querySelector('.rw-act-go').getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2, h: r.height, label: document.querySelector('.rw-act-go').getAttribute('aria-label') };
    });
    check(btn.h >= 56, `START is ${btn.h} px tall (${btn.label})`);
    check(btn.y + btn.h / 2 < h * 0.6, 'START sits in the upper part of the screen');

    // 3. Tap START: countdown.
    await page.touchscreen.tap(btn.x, btn.y);
    await page.waitForTimeout(100);
    await sim(70);
    await page.waitForTimeout(250);
    await page.screenshot({ path: `shots/${tag}-countdown.png` });
    check(await page.evaluate(() => window.__rw.activities.active && window.__rw.activities.active.phase === 'countdown'), 'tapping START begins the countdown');

    // 4. Running: timer with Quit, plus fresh toasts.
    await sim(60 * 3);
    await page.evaluate(() => { const hd = window.__rw.hud; hd.toast('Lap 2', 20); hd.toast('Another toast', 20); });
    await page.waitForTimeout(350);
    await page.screenshot({ path: `shots/${tag}-running.png` });
    const geo = await page.evaluate(() => {
      const box = (s) => { const r = document.querySelector(s).getBoundingClientRect(); return { x: r.x, y: r.y, r: r.right, b: r.bottom, w: r.width, h: r.height }; };
      const toasts = [...document.querySelectorAll('.rw-toast')].map((t) => { const r = t.getBoundingClientRect(); return { y: r.y, b: r.bottom }; });
      return { panel: box('.rw-act-panel'), quit: box('.rw-act-quit'), toastBottom: Math.max(0, ...toasts.map((t) => t.b)), label: document.querySelector('.rw-act-quit').getAttribute('aria-label') };
    });
    check(geo.panel.y >= geo.toastBottom, `timer panel (y ${geo.panel.y.toFixed(0)}) is below the toast stack (${geo.toastBottom.toFixed(0)})`);
    check(geo.quit.w >= 44 && geo.quit.h >= 44 && geo.label === 'Abandon race', `Quit is ${geo.quit.w}x${geo.quit.h} (${geo.label})`);
    check(geo.quit.r <= w && geo.quit.b < h * 0.5, 'Quit is on screen, top centre');

    // 5. Quit abandons the race.
    await page.touchscreen.tap(geo.quit.x + geo.quit.w / 2, geo.quit.y + geo.quit.h / 2);
    await page.waitForTimeout(150);
    check(await page.evaluate(() => window.__rw.activities.active === null), 'Quit abandons the race');

    // 6. Full map with markers; zoom in for labels.
    await page.evaluate(() => window.__rw.input.press('map'));
    await page.waitForTimeout(400);
    await page.screenshot({ path: `shots/${tag}-map.png` });
    await page.evaluate(() => {
      const c = document.querySelector('.rw-map-canvas');
      for (let i = 0; i < 6; i++) c.dispatchEvent(new WheelEvent('wheel', { deltaY: -100, clientX: w0(), clientY: h0(), cancelable: true }));
      function w0() { return window.innerWidth * 0.33; }
      function h0() { return window.innerHeight * 0.55; }
    });
    await page.waitForTimeout(400);
    await page.screenshot({ path: `shots/${tag}-map-zoom.png` });
    check(errors.length === 0, `no page errors (${errors.join(' | ')})`);
  } finally {
    await page.close();
  }
}
await browser.close();
server.close();
if (failed) process.exit(1);
console.log('shots in shots/act-*.png');
