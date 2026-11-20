// Developer helper: screenshot the talk station caption strip in a car at
// phone size (915x412), and the fan with the RADIO button.
// usage: node scripts/radio-shot.mjs
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
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 915, height: 412 }, hasTouch: true, isMobile: true, deviceScaleFactor: 1 });
page.on('pageerror', (e) => console.log('pageerror', String(e)));
await page.goto(`http://127.0.0.1:${server.address().port}/?autostart`, { timeout: 120000 });
await page.waitForFunction(() => window.__rw && window.__rw.loop.running, null, { timeout: 120000 });
const info = await page.evaluate(async () => {
  const g = window.__rw;
  g.audio.unlock();
  g.radio.setStation('talk', true);
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const t0 = performance.now();
  let readyAt = -1;
  // the radio samples are made in the background after unlock: wait for them,
  // then for a DJ line (not the station sting, not a song title)
  while (performance.now() - t0 < 240000) {
    const s = document.querySelector('.rw-radiocap');
    const r = g.audio.debug.radio;
    if (r && r.ready && readyAt < 0) readyAt = performance.now() - t0;
    const t = s && s.classList.contains('rw-on') ? s.lastChild.textContent : '';
    if (t && !/Gullspeak|Now playing/.test(t)) break;
    await wait(200);
  }
  const s = document.querySelector('.rw-radiocap');
  return { ctx: g.audio.output && g.audio.output.context.state, text: s ? s.textContent : null, on: s && s.classList.contains('rw-on'), station: g.radio.station, saved: g.progress.settings.station, readyAtMs: Math.round(readyAt) };
});
console.log(JSON.stringify(info));
await page.screenshot({ path: 'docs/preview/radio-talk-caption.png', timeout: 180000 });
const mb = await page.locator('.rw-more').boundingBox();
await page.touchscreen.tap(mb.x + mb.width / 2, mb.y + mb.height / 2);
await page.waitForTimeout(400);
await page.screenshot({ path: 'docs/preview/radio-fan.png', timeout: 180000 });
await browser.close();
server.close();
