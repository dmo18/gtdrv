// Takes the Google Play screenshots: store/screenshot-1.png .. 8, each
// 1920x1080 (landscape, 16:9: a 960x540 phone-style viewport at 2x) from the
// real running game, HUD included, in the five Miami regions. Playwright PNGs
// carry no EXIF or text chunks; the script checks that.
// usage: node scripts/store-shots.mjs
import { createRequire } from 'node:module';
import { mkdir, readFile } from 'node:fs/promises';
import { buildGame, serve } from './build.mjs';

let chromium;
try {
  ({ chromium } = await import('playwright'));
} catch {
  ({ chromium } = createRequire('/opt/node-tools/node_modules/')('playwright'));
}
await buildGame();
const server = await serve(0);
await mkdir('store', { recursive: true });
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });

// [region, hour, weather, drive forward seconds]
const VIEWS = [
  ['miami-beach', 13, 'clear', 0],
  ['miami-downtown', 16.8, 'clear', 3],
  ['miami-beach', 19.2, 'clear', 3],
  ['miami-north', 11, 'clear', 2],
  ['miami-west', 10.5, 'clear', 2],
  ['miami-south', 15, 'clear', 2],
  ['miami-downtown', 22.5, 'rain', 3],
  ['miami-beach', 23, 'clear', 4],
];
// Optional first argument: number of the shot to start from (to resume).
let n = Number(process.argv[2] || 1) - 1;
let page = null, current = null;
for (const [region, hour, weather, drive] of VIEWS.slice(n)) {
  if (region !== current) {
    if (page) await page.close();
    page = await browser.newPage({ viewport: { width: 960, height: 540 }, hasTouch: true, isMobile: false, deviceScaleFactor: 2 });
    page.setDefaultTimeout(240000);
    page.on('pageerror', (e) => console.log('pageerror', String(e)));
    await page.goto(`http://127.0.0.1:${server.address().port}/?autostart&map=${region}`);
    await page.waitForFunction(() => window.__rw && window.__rw.loop.running, null, { timeout: 150000 });
    current = region;
  }
  await page.evaluate(([hour, weather]) => {
    const g = window.__rw;
    const v = g.player.vehicle;
    v.px = v.x; v.pz = v.z; v.pheading = v.heading; v.vx = v.vz = 0; v.speed = 0;
    g.daynight.setWeather(weather, true);
    g.daynight.setHour(hour);
  }, [hour, weather]);
  if (drive) {
    await page.keyboard.down('ArrowUp');
    await page.evaluate((s) => { for (let i = 0; i < s * 60; i++) window.__rw.step(1 / 60); }, drive);
  }
  await page.waitForTimeout(1800);
  await page.evaluate((h) => window.__rw.daynight.setHour(h), hour);
  await page.waitForTimeout(600);
  const file = `store/screenshot-${++n}.png`;
  await page.screenshot({ path: file });
  await page.keyboard.up('ArrowUp');
  // No metadata: a PNG from the browser has only IHDR, IDAT, IEND (and sRGB/gAMA).
  const buf = await readFile(file);
  const chunks = [];
  for (let o = 8; o < buf.length; o += 12 + buf.readUInt32BE(o)) chunks.push(buf.toString('latin1', o + 4, o + 8));
  const bad = chunks.filter((c) => ['eXIf', 'tEXt', 'iTXt', 'zTXt', 'tIME'].includes(c));
  if (bad.length) throw new Error(`${file} has metadata chunks: ${bad}`);
  console.log('shot', n, region, hour, weather);
}
await browser.close();
server.close();
