// Takes the Google Play screenshots: store/screenshot-1.png .. 8, each
// 1920x1080 (landscape, 16:9: a 960x540 phone-style viewport at 2x) from the
// real running game, HUD included, in the five Miami regions, each from its own street. Playwright PNGs
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

// [region, hour, weather, drive forward seconds, camera]: the camera is a
// place of its own for every shot: the nearest car road to (x, z), the car
// facing along it (back: against its direction), so the chase camera looks
// down a different street or causeway each time. Null: where the region starts.
const VIEWS = [
  ['miami-beach', 13, 'clear', 0, null], // Ocean Drive, the region start
  ['miami-downtown', 16.8, 'clear', 3, { x: -740, z: -120 }], // Biscayne Boulevard by the arena
  ['miami-beach', 19.2, 'clear', 3, { x: 4900, z: 1500, back: true }], // Beach, south of the start
  ['miami-north', 11, 'clear', 2, { x: -2150, z: -2000 }], // Wynwood
  ['miami-west', 10.5, 'clear', 2, { x: -2100, z: 1530 }], // Calle Ocho
  ['miami-south', 15, 'clear', 2, { x: -1250, z: 1680 }], // Brickell
  ['miami-downtown', 22.5, 'rain', 3, { x: 900, z: 330 }], // the port, in rain
  ['miami-beach', 23, 'clear', 4, { x: 2600, z: 650, back: true }], // the MacArthur Causeway at night
];
// Optional first argument: number of the shot to start from (to resume).
let n = Number(process.argv[2] || 1) - 1;
let page = null, current = null;
for (const [region, hour, weather, drive, cam] of VIEWS.slice(n)) {
  if (region !== current) {
    if (page) await page.close();
    page = await browser.newPage({ viewport: { width: 960, height: 540 }, hasTouch: true, isMobile: false, deviceScaleFactor: 2 });
    page.setDefaultTimeout(240000);
    page.on('pageerror', (e) => console.log('pageerror', String(e)));
    await page.goto(`http://127.0.0.1:${server.address().port}/?autostart&map=${region}`);
    await page.waitForFunction(() => window.__rw && window.__rw.loop.running, null, { timeout: 150000 });
    current = region;
  }
  await page.evaluate(([hour, weather, cam]) => {
    const g = window.__rw;
    const v = g.player.vehicle;
    if (cam) {
      // Nearest car road edge (not a footpath, not a bridge deck) to the place.
      const c = g.city, E = c.edges, N = c.nodes;
      let best = null, bd = 1e9;
      for (const e of E) {
        if (e.ped || e.bridge) continue;
        const a = N[e.a];
        const t = Math.max(0, Math.min(e.length, (cam.x - a.x) * e.ux + (cam.z - a.z) * e.uz));
        const px = a.x + e.ux * t, pz = a.z + e.uz * t, d = Math.hypot(px - cam.x, pz - cam.z);
        if (d < bd) { bd = d; best = { e, px, pz }; }
      }
      const { e, px, pz } = best;
      v.x = px; v.z = pz;
      v.heading = Math.atan2(e.uz, e.ux) + (cam.back ? Math.PI : 0);
    }
    v.px = v.x; v.pz = v.z; v.pheading = v.heading; v.vx = v.vz = 0; v.speed = 0;
    g.daynight.setWeather(weather, true);
    g.daynight.setHour(hour);
  }, [hour, weather, cam]);
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
  console.log('shot', n, region, hour, weather, cam ? `${cam.x},${cam.z}` : 'start');
}
await browser.close();
server.close();
