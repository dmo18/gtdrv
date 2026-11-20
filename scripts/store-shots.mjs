// Takes the Google Play screenshots: store/screenshot-1.png .. 8, each
// 1920x1080 (landscape, 16:9) from the real running game, HUD included.
// usage: node scripts/store-shots.mjs
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
await mkdir('store', { recursive: true });
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, hasTouch: true, isMobile: false, deviceScaleFactor: 1 });
page.on('pageerror', (e) => console.log('pageerror', String(e)));
await page.goto(`http://127.0.0.1:${server.address().port}/?autostart`);
await page.waitForFunction(() => window.__rw && window.__rw.loop.running, null, { timeout: 90000 });

// [district, hour, weather, drive forward seconds]
const VIEWS = [
  ['spawn', 13, 'clear', 0],
  ['spawn', 19.2, 'clear', 3],
  ['docks', 15, 'clear', 0],
  ['beach', 16.8, 'clear', 2],
  ['residential', 10.5, 'clear', 2],
  ['midtown', 22.5, 'rain', 3],
  ['airfield', 12, 'clear', 0],
  ['spawn', 23, 'clear', 4],
];
// Optional first argument: number of the shot to start from (to resume).
let n = Number(process.argv[2] || 1) - 1;
const first = n;
page.setDefaultTimeout(240000);
for (const [where, hour, weather, drive] of VIEWS.slice(first)) {
  await page.evaluate(([where, hour, weather]) => {
    const g = window.__rw;
    const c = g.city;
    let x = c.spawn.x, z = c.spawn.z, heading = 0;
    if (where === 'airfield') {
      x = c.airfield.runway.x0 + 120; z = (c.airfield.runway.z0 + c.airfield.runway.z1) / 2 + 30; heading = -0.5;
    } else if (where !== 'spawn') {
      const aim = { residential: [0, -420], docks: [150, 420], beach: [-470, 60], midtown: [260, -60] }[where];
      let best = null, bd = 1e9;
      for (const e of c.edges) {
        if (e.avenue || e.causeway) continue;
        const a = c.nodes[e.a], b = c.nodes[e.b];
        const mx = (a.x + b.x) / 2, mz = (a.z + b.z) / 2;
        const blk = c.blocks.find((q) => Math.abs((q.x0 + q.x1) / 2 - mx) < 70 && Math.abs((q.z0 + q.z1) / 2 - mz) < 70);
        if (!blk || blk.district !== where) continue;
        const d = Math.hypot(mx - aim[0], mz - aim[1]);
        if (d < bd) { bd = d; best = e; }
      }
      if (best) {
        const a = c.nodes[best.a];
        x = a.x + (best.horizontal ? 18 : -2); z = a.z + (best.horizontal ? 2 : 18);
        heading = best.horizontal ? 0 : Math.PI / 2;
      }
    }
    const v = g.player.vehicle;
    v.x = v.px = x; v.z = v.pz = z; v.heading = v.pheading = heading; v.vx = v.vz = 0; v.speed = 0;
    g.daynight.setWeather(weather, true);
    g.daynight.setHour(hour);
  }, [where, hour, weather]);
  if (drive) {
    await page.keyboard.down('ArrowUp');
    await page.evaluate((s) => { for (let i = 0; i < s * 60; i++) window.__rw.step(1 / 60); }, drive);
  }
  await page.waitForTimeout(1800);
  await page.evaluate((h) => window.__rw.daynight.setHour(h), hour);
  await page.waitForTimeout(600);
  await page.screenshot({ path: `store/screenshot-${++n}.png` });
  await page.keyboard.up('ArrowUp');
  console.log('shot', n, where, hour, weather);
}
await browser.close();
server.close();
