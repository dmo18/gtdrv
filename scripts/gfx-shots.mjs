// Developer helper: screenshots of the city under different light, to
// judge the graphics by eye. Also prints draw calls, triangles and the
// cost of the bloom pass.
// usage: node scripts/gfx-shots.mjs [name ...]   (no names = all views)
import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { buildGame, serve } from './build.mjs';

let chromium;
try {
  ({ chromium } = await import('playwright'));
} catch {
  ({ chromium } = createRequire('/opt/node-tools/node_modules/')('playwright'));
}
const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
await buildGame({ minify: false });
// Same game, plus the graphics module if game.js does not start it yet.
await build({
  stdin: {
    contents: `import './src/main.js';
import { createGraphics } from './src/render/graphics.js';
const g = window.__rw;
if (g && !g.graphics) g.addSystem(createGraphics(g));`,
    resolveDir: root,
  },
  bundle: true, format: 'esm', target: 'es2020', outfile: join(root, 'dist/game.js'), logLevel: 'warning',
});

// name: [district or [x, z, heading], hour, weather, camera lift]
const VIEWS = {
  'downtown-day': ['spawn', 13, 'clear', 0],
  'downtown-dusk': ['spawn', 19.2, 'clear', 0],
  'downtown-night': ['spawn', 23, 'clear', 0],
  'rain-night': ['spawn', 22.5, 'rain', 0],
  residential: ['residential', 10.5, 'clear', 0],
  docks: ['docks', 15, 'clear', 0],
  beach: ['beach', 16.5, 'clear', 0],
  midtown: ['midtown', 11.5, 'clear', 0],
  airfield: ['airfield', 12, 'clear', 0],
  'aerial-day': ['spawn', 14, 'clear', 150],
  'aerial-night': ['spawn', 23, 'clear', 150],
};
const want = process.argv.slice(2).filter((a) => !a.startsWith('-'));
const server = await serve(0);
await mkdir('shots', { recursive: true });
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 915, height: 412 }, hasTouch: true, isMobile: true, deviceScaleFactor: 1 });
page.on('pageerror', (e) => console.log('pageerror', String(e)));
page.on('console', (m) => {
  if (m.type() === 'error' || m.type() === 'warning') console.log(m.type(), m.text().slice(0, 300));
});
await page.goto(`http://127.0.0.1:${server.address().port}/?autostart`);
await page.waitForFunction(() => window.__rw && window.__rw.loop.running, null, { timeout: 60000 });
console.log('setup ms', JSON.stringify(await page.evaluate(() => ({ graphics: +window.__rw.graphics.setupMs.toFixed(1), cityMesh: +window.__rw.cityMesh.userData.buildMs.toFixed(0) }))));

for (const [name, [where, hour, weather, lift]] of Object.entries(VIEWS)) {
  if (want.length && !want.includes(name)) continue;
  const info = await page.evaluate(async ([where, hour, weather, lift]) => {
    const g = window.__rw;
    const c = g.city;
    let x = c.spawn.x, z = c.spawn.z, heading = 0;
    if (where === 'airfield') {
      x = c.airfield.runway.x0 + 120; z = (c.airfield.runway.z0 + c.airfield.runway.z1) / 2 + 30; heading = -0.5;
    } else if (where !== 'spawn') {
      // A street in the asked-for district, nearest its typical centre.
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
      const a = c.nodes[best.a], b = c.nodes[best.b];
      x = a.x + (best.horizontal ? 18 : -2); z = a.z + (best.horizontal ? 2 : 18);
      heading = best.horizontal ? 0 : Math.PI / 2;
      void b;
    }
    g.loop.start();
    const v = g.player.vehicle;
    v.x = v.px = x; v.z = v.pz = z; v.heading = v.pheading = heading; v.vx = v.vz = 0; v.speed = 0;
    g.daynight.setWeather(weather, true);
    g.daynight.setHour(hour);
    await new Promise((r) => setTimeout(r, 1600));
    g.daynight.setHour(hour);
    g.loop.stop();
    g.graphics.refreshEnvironment();
    if (lift > 0) {
      const t0 = g.draw;
      void t0;
      g.draw(1, 0);
      g.camera.position.set(x - Math.cos(heading) * lift * 1.3, lift, z - Math.sin(heading) * lift * 1.3 + 40);
      g.camera.lookAt(x + 60, 0, z);
      g.systems.forEach((s) => s.name === 'graphics' || s.name === 'daynight' ? s.render(1, 0) : 0);
      g.renderFrame(0);
    } else g.draw(1, 0);
    return { calls: g.graphics.calls, triangles: g.graphics.triangles };
  }, [where, hour, weather, lift]);
  await page.screenshot({ path: `shots/gfx-${name}.png` });
  console.log(name, JSON.stringify(info));
}

if (process.argv.includes('--bloom')) {
  // Cost of the bloom pass: average frame time with and without it.
  const ms = await page.evaluate(() => {
    const g = window.__rw, gl = g.renderer.getContext(), px = new Uint8Array(4);
    g.daynight.setHour(23);
    const run = (on) => {
      g.graphics.setBloom(on);
      g.graphics.render(1, 0);
      const t = performance.now();
      for (let i = 0; i < 40; i++) { g.renderFrame(0); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); }
      return (performance.now() - t) / 40;
    };
    run(true);
    const off = run(false), on = run(true);
    return { off: +off.toFixed(2), on: +on.toFixed(2), bloomMs: +(on - off).toFixed(2) };
  });
  console.log('bloom', JSON.stringify(ms));
}
await browser.close();
server.close();
