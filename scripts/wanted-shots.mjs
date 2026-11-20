// Developer helper: the wanted meter at heat 3, the slow-motion overlay after a
// kill and the cinematic pull-back after a blast, at 915x412, to docs/preview/.
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
const page = await browser.newPage({ viewport: { width: 915, height: 412 }, deviceScaleFactor: 1 });
let bad = 0;
page.on('pageerror', (e) => { bad++; console.log('pageerror', String(e)); });
page.on('console', (m) => { if (m.type() === 'error') { bad++; console.log('console.error', m.text().slice(0, 300)); } });
await page.goto(`http://127.0.0.1:${server.address().port}/?autostart`);
await page.waitForFunction(() => window.__rw && window.__rw.loop.running, null, { timeout: 60000 });
await page.waitForTimeout(3000);
await page.evaluate(() => {
  const g = window.__rw;
  g.loop.stop();
  g.daynight.setHour(14);
  g.daynight.setWeather('clear', true);
  g.step(1 / 60);
});
const steps = (n) => page.evaluate((k) => { const g = window.__rw; for (let i = 0; i < k; i++) g.step(1 / 60); g.draw(1, 1 / 60); }, n);

// 1. Wanted meter at heat 3, cooling half way.
await page.evaluate(() => {
  const g = window.__rw;
  const h = g.police.heat;
  h.level = 3; h.grace = 5; h.unseen = 10; h.cooldown = 0.5;
});
await steps(3);
await page.evaluate(() => { const h = window.__rw.police.heat; h.level = 3; h.cooldown = 0.55; window.__rw.draw(1, 1 / 60); });
await page.waitForTimeout(150);
await page.screenshot({ path: 'docs/preview/wanted-meter-heat3.png' });
await page.evaluate(() => { const g = window.__rw; g.police.heat.level = 0; g.police.heat.cooldown = 0; });
await steps(3);

// 2 and 3. A parked car is blasted near the player: slow-mo, then the pull-back.
const info = await page.evaluate(() => {
  const g = window.__rw;
  const v = g.player.vehicle;
  const c = g.debug.spawnCar('sedan', v.x + 14, v.z + 6, 0);
  g.combat.explode(c.x, 0.5, c.z, 8, g.player.vehicle, 0, 1, c);
  return { x: c.x };
});
// real-time frames: slow-mo and the pull-back run on real dt in render
const frames = async (n) => page.evaluate((k) => { const g = window.__rw; for (let i = 0; i < k; i++) { g.step(1 / 60); g.draw(1, 1 / 60); } return { ts: g.timeScale, k: g.slowmo.k, fx: { ...g.chase.fx } }; }, n);
console.log(JSON.stringify(info), JSON.stringify(await frames(4)));
await page.evaluate(() => { const g = window.__rw; g.slowmo.trigger(); for (let i = 0; i < 18; i++) g.draw(1, 1 / 60); });
await page.waitForTimeout(150);
console.log('slow', JSON.stringify(await page.evaluate(() => ({ ts: window.__rw.timeScale, k: window.__rw.slowmo.k }))));
await page.screenshot({ path: 'docs/preview/slowmo-after-kill.png' });
console.log('pull', JSON.stringify(await frames(30)));
await page.evaluate(() => { for (let i = 0; i < 20; i++) window.__rw.draw(1, 1 / 60); });
await page.waitForTimeout(150);
console.log('pull', JSON.stringify(await page.evaluate(() => ({ ...window.__rw.chase.fx, active: window.__rw.cinematic.pull.active }))));
await page.screenshot({ path: 'docs/preview/cinematic-pullback.png' });
console.log(bad ? 'FAIL errors ' + bad : 'ok');
await browser.close();
server.close();
