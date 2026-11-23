// Screenshot review set (docs/PLAN_V1.md 2.6 item 8) at 915x412, written to a scratch dir.
// Usage: node scripts/review-shots.mjs [outDir]     (default: os tmpdir/rustwater-review)
// Views that need game state with no scripted hook yet are listed as "todo"
// in the printed summary instead of being silently skipped.
import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildGame, serve } from './build.mjs';

let chromium;
try {
  ({ chromium } = await import('playwright'));
} catch {
  ({ chromium } = createRequire('/opt/node-tools/node_modules/')('playwright'));
}

const out = process.argv[2] || join(tmpdir(), 'rustwater-review');
await mkdir(out, { recursive: true });

// Street views: [name, district or 'spawn', hour, weather, drive seconds]
const STREETS = [
  ['downtown-street-day', 'midtown', 13, 'clear', 0],
  ['downtown-night', 'midtown', 22.5, 'clear', 0],
  ['little-havana', 'residential', 15, 'clear', 0],
  ['waterfront', 'docks', 16, 'clear', 0],
  ['spawn-street', 'spawn', 12, 'clear', 0],
  ['car-closeup-day', 'spawn', 13, 'clear', 0],
  ['car-closeup-night', 'spawn', 23, 'clear', 0],
];
// Needs a scripted hook that does not exist yet; reported as todo.
const TODO = [
  'title', 'fighter', 'tank', 'boat', 'person-at-3m', 'street-with-people',
  'blast-0.1s', 'blast-0.5s', 'blast-5s', 'blast-30s', 'service-vehicles-with-lights',
  'boost-car', 'boost-boat', 'boost-jet', 'hud-car', 'hud-foot', 'hud-boat', 'hud-plane', 'hud-tank',
  'menu-screens', 'full-map-with-markers',
];

await buildGame();
const server = await serve(0);
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 915, height: 412 }, hasTouch: true, isMobile: true, deviceScaleFactor: 1 });
page.setDefaultTimeout(240000);
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto(`http://127.0.0.1:${server.address().port}/?autostart`);
await page.waitForFunction(() => window.__rw && window.__rw.loop.running, null, { timeout: 90000 });

const done = [];
for (const [name, where, hour, weather, drive] of STREETS) {
  await page.evaluate(([where, hour, weather]) => {
    const g = window.__rw;
    const c = g.city;
    let x = c.spawn.x, z = c.spawn.z, heading = 0;
    if (where !== 'spawn') {
      const aim = { residential: [0, -420], docks: [150, 420], midtown: [260, -60] }[where];
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
  if (drive) await page.evaluate((s) => { for (let i = 0; i < s * 60; i++) window.__rw.step(1 / 60); }, drive);
  await page.waitForTimeout(2000);
  await page.evaluate((h) => window.__rw.daynight.setHour(h), hour);
  await page.waitForTimeout(500);
  await page.screenshot({ path: join(out, `${name}.png`) });
  done.push(name);
}

// Every region (docs/PLAN_V2.md 5.3 RV): its start view, a generated road end
// with its barrier, and the first travel pad with its sign, one page per
// region (a region is a page load: ?map=<id>). The car is put 26 m before the
// road end or the pad, facing it.
const REGION_IDS = ['miami-downtown', 'miami-beach', 'miami-north', 'miami-west', 'miami-south'];
for (const id of REGION_IDS) {
  const rp = await browser.newPage({ viewport: { width: 915, height: 412 }, hasTouch: true, isMobile: true, deviceScaleFactor: 1 });
  rp.setDefaultTimeout(240000);
  rp.on('pageerror', (e) => errors.push(`${id}: ${e}`));
  await rp.goto(`http://127.0.0.1:${server.address().port}/?autostart&map=${id}`);
  await rp.waitForFunction(() => window.__rw && window.__rw.loop.running, null, { timeout: 120000 });
  const views = [['start', null]];
  const counts = await rp.evaluate(() => {
    const c = window.__rw.city;
    return { ends: (c.roadEnds || []).length, pads: (c.travelPads || []).length };
  });
  if (counts.ends) views.push(['road-end', 'end']);
  if (counts.pads) views.push(['travel-pad', 'pad']);
  for (const [what, target] of views) {
    await rp.evaluate(([target, hour]) => {
      const g = window.__rw, c = g.city;
      let x = c.spawn.x, z = c.spawn.z, heading = c.spawn.heading;
      if (target) {
        // The first pad, or the road end nearest the start place.
        let t = null;
        if (target === 'pad') t = c.travelPads[0];
        else {
          let bd = 1e12;
          for (const e of c.roadEnds) {
            const d = Math.hypot(e.x - c.spawn.x, e.z - c.spawn.z);
            if (d < bd) { bd = d; t = e; }
          }
        }
        heading = t.heading;
        x = t.x - Math.cos(heading) * 26;
        z = t.z - Math.sin(heading) * 26;
      }
      const v = g.player.vehicle;
      v.x = v.px = x; v.z = v.pz = z; v.heading = v.pheading = heading; v.vx = v.vz = 0; v.speed = 0;
      g.daynight.setWeather('clear', true);
      g.daynight.setHour(hour);
    }, [target, 16.5]);
    await rp.waitForTimeout(2500);
    await rp.screenshot({ path: join(out, `${id}-${what}.png`) });
    done.push(`${id}-${what}`);
  }
  await rp.close();
}
await browser.close();
server.close();
console.log(`wrote ${done.length} views to ${out}`);
for (const n of done) console.log(`  ${n}.png`);
console.log(`todo (no scripted hook yet): ${TODO.join(', ')}`);
if (errors.length) { console.error('page errors:\n' + errors.join('\n')); process.exit(1); }
