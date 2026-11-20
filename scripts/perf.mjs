// Developer helper: reports draw calls, triangles, shader programs and
// step/draw cost in a fixed daytime street view, a night view and the
// worst frame of the first seconds of play (first-time costs).
import { createRequire } from 'node:module';
import { buildGame, serve } from './build.mjs';

let chromium;
try {
  ({ chromium } = await import('playwright'));
} catch {
  ({ chromium } = createRequire('/opt/node-tools/node_modules/')('playwright'));
}
await buildGame();
const server = await serve(0);
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 915, height: 412 }, deviceScaleFactor: 1 });
page.on('pageerror', (e) => console.log('pageerror', String(e)));
// Record every animation frame from the very start, to catch hitches.
await page.addInitScript(() => {
  const gaps = (window.__rwGaps = []);
  let last = 0;
  const tick = (t) => {
    if (last) gaps.push(t - last);
    last = t;
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
});
await page.goto(`http://127.0.0.1:${server.address().port}/?autostart`);
await page.waitForFunction(() => window.__rw && window.__rw.loop.running, null, { timeout: 30000 });
const startGaps = await page.evaluate(() => window.__rwGaps.length);
await page.waitForTimeout(6000);
const out = await page.evaluate((startGaps) => {
  const g = window.__rw;
  const gaps = window.__rwGaps.slice(startGaps);
  const sorted = gaps.slice().sort((a, b) => b - a);
  g.loop.stop();
  const info = g.renderer.info;
  const gl = g.renderer.getContext(), px = new Uint8Array(4);
  const programsAtStart = info.programs ? info.programs.length : 0;
  let t0 = performance.now();
  for (let i = 0; i < 300; i++) g.step(1 / 60);
  const stepMs = (performance.now() - t0) / 300;
  // A fixed street view: the player car parked at the spawn point.
  const v = g.player.vehicle, c = g.city;
  if (v) { v.x = v.px = c.spawn.x; v.z = v.pz = c.spawn.z; v.heading = v.pheading = c.spawn.heading; v.vx = v.vz = 0; v.speed = 0; }
  const view = (hour) => {
    g.daynight.setHour(hour);
    for (let i = 0; i < 30; i++) g.step(1 / 60);
    g.draw(1, 1 / 60);
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    const p0 = info.programs ? info.programs.length : 0;
    let cpu = 0;
    const t = performance.now();
    for (let i = 0; i < 20; i++) {
      const a = performance.now();
      g.draw(1, 1 / 60);
      cpu += performance.now() - a;
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    }
    const gr = g.graphics || {};
    return { calls: gr.calls || info.render.calls, triangles: gr.triangles || info.render.triangles, drawCpuMs: +(cpu / 20).toFixed(2), frameMs: +((performance.now() - t) / 20).toFixed(2), newPrograms: (info.programs ? info.programs.length : 0) - p0 };
  };
  const day = view(13);
  const night = view(23);
  const kinds = {};
  for (const x of g.vehicles) kinds[x.kind] = (kinds[x.kind] || 0) + 1;
  return {
    day, night, stepMs: +stepMs.toFixed(3),
    pixelRatio: g.renderer.getPixelRatio(),
    programs: info.programs ? info.programs.length : 0, programsAtStart,
    firstFrames: { count: gaps.length, worstMs: sorted.slice(0, 5).map((x) => +x.toFixed(0)), over50ms: gaps.filter((x) => x > 50).length },
    geometries: info.memory.geometries, textures: info.memory.textures, vehicles: kinds,
  };
}, startGaps);
console.log(JSON.stringify(out, null, 1));
await browser.close();
server.close();
