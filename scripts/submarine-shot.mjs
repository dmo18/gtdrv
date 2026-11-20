// Checks the easter egg end to end: pause, double-tap the version, a submarine
// appears at a pier. Saves one screenshot of it.
import { createRequire } from 'node:module';
import { buildGame, serve } from './build.mjs';
const { chromium } = createRequire('/opt/node-tools/node_modules/')('playwright');
await buildGame({ minify: false });
const server = await serve(0);
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 915, height: 412 }, hasTouch: true, isMobile: true, deviceScaleFactor: 1 });
let errors = 0;
page.on('pageerror', () => { errors++; });
await page.goto(`http://127.0.0.1:${server.address().port}/?autostart`);
await page.waitForFunction(() => window.__rw && window.__rw.loop.running, null, { timeout: 30000 });
await page.evaluate(() => window.__rw.input.press('pause'));
await page.waitForTimeout(400);
const label = page.locator('.rw-menu-version');
const box = await label.boundingBox();
const x = box.x + box.width / 2, y = box.y + box.height / 2;
const hit = await page.evaluate(([a, b]) => { const e = document.elementFromPoint(a, b); return e ? e.className + ' ' + e.tagName : 'none'; }, [x, y]);
console.log('under label:', hit);
await page.evaluate(() => { window.__taps = []; for (const t of ['pointerdown','pointerup','click']) document.addEventListener(t, (e) => window.__taps.push(t + ':' + e.target.className), true); });
await page.mouse.click(x, y);
await page.waitForTimeout(120);
await page.mouse.click(x, y);
console.log('taps', JSON.stringify(await page.evaluate(() => window.__taps)));
await page.waitForTimeout(400);
const dbg0 = await page.evaluate(() => { const el = document.querySelector('.rw-menu-version'); const r = el.getBoundingClientRect(); const o = { x: r.x + r.width / 2, y: r.y + r.height / 2 }; const ev = (t) => new PointerEvent(t, { clientX: o.x, clientY: o.y, bubbles: true }); el.dispatchEvent(ev('pointerup')); el.dispatchEvent(ev('pointerup')); return { n: window.__rw.vehicles.length, paused: window.__rw.paused }; }); console.log('synthetic', JSON.stringify(dbg0));
const dbg = await page.evaluate(() => ({ menuOpen: !!document.querySelector(".rw-menu") , has: typeof window.__rw.easterEgg, n: (window.__rw.vehicles||[]).length })); console.log(JSON.stringify(dbg));
const found = await page.evaluate(() => window.__rw.vehicles.filter((v) => v.spec && v.spec.id === 'submarine').length);
console.log(found === 1 ? 'ok   double-tap spawns one submarine' : `FAIL double-tap spawned ${found}`);
await page.evaluate(() => {
  const g = window.__rw;
  const sub = g.vehicles.find((v) => v.spec && v.spec.id === 'submarine');
  const p = g.player.vehicle || g.player.walker;
  // Stand the player 16 m off the submarine, looking at it, for the picture.
  p.x = p.px = sub.x - Math.cos(sub.heading) * 16 - Math.sin(sub.heading) * 6;
  p.z = p.pz = sub.z - Math.sin(sub.heading) * 16 + Math.cos(sub.heading) * 6;
  if (g.player.vehicle) { p.heading = p.pheading = Math.atan2(sub.z - p.z, sub.x - p.x); p.speed = 0; }
  g.loop.stop();
  g.draw(1, 1 / 60);
});
await page.waitForTimeout(300);
await page.screenshot({ path: 'docs/preview/submarine-easter-egg.png' });
console.log(errors === 0 ? 'ok   no page errors' : `FAIL ${errors} page errors`);
await browser.close();
server.close();
