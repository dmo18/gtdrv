// Developer helper: reports draw calls, triangles, shader programs and
// step/draw cost in a fixed daytime street view, a night view and the
// worst frame of the first seconds of play (first-time costs).
// usage: node scripts/perf.mjs [query]   (e.g. map=island)
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
// Optional extra query, e.g. `node scripts/perf.mjs map=island` (the
// default page is the Miami map).
const extra = process.argv[2] ? '&' + process.argv[2] : '';
await page.goto(`http://127.0.0.1:${server.address().port}/?autostart${extra}`);
await page.waitForFunction(() => window.__rw && window.__rw.loop.running, null, { timeout: 30000 });
// Worst single-call JS cost of each system and of the final draw (which
// includes any shader compiles) while the game runs for a few seconds.
const startGaps = await page.evaluate(() => {
  const g = window.__rw;
  const worst = (window.__rwWorst = {});
  const wrap = (obj, key, label) => {
    const f = obj[key];
    if (typeof f !== 'function') return;
    obj[key] = function (...a) {
      const t = performance.now();
      const r = f.apply(this, a);
      const d = performance.now() - t;
      if (!(worst[label] >= d)) worst[label] = d;
      return r;
    };
  };
  for (const s of g.systems) for (const k of ['update', 'render', 'always']) wrap(s, k, s.name + '.' + k);
  if (g.renderFrame) wrap(g, 'renderFrame', 'renderFrame');
  return window.__rwGaps.length;
});
await page.waitForTimeout(6000);
const out = await page.evaluate((startGaps) => {
  const g = window.__rw;
  const gaps = window.__rwGaps.slice(startGaps);
  const sorted = gaps.slice().sort((a, b) => b - a);
  g.loop.stop();
  const info = g.renderer.info;
  const gl = g.renderer.getContext(), px = new Uint8Array(4);
  const programsAtStart = info.programs ? info.programs.length : 0;
  // Measure at a fixed pixel ratio of 1 so runs compare; report what the
  // adaptive controller had picked on this (software) renderer.
  const adaptiveScale = g.graphics && g.graphics.res ? g.graphics.res.scale : null;
  if (g.graphics && 'adaptive' in g.graphics) { g.graphics.adaptive = false; g.resize(); }
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
    // A streamed map: every near tile at the view built first.
    const st = g.cityMesh.userData.stream;
    if (st) st.flush(g.camera);
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
    // Far level triangles in the index buffers (before frustum culling).
    let farTris = 0;
    g.cityMesh.traverse((o) => { if (o.isMesh && o.name === 'far' && o.visible) farTris += Math.min(o.geometry.drawRange.count, o.geometry.index ? o.geometry.index.count : 0) / 3; });
    return { farTris: Math.round(farTris), calls: gr.calls || info.render.calls, triangles: gr.triangles || info.render.triangles, drawCpuMs: +(cpu / 20).toFixed(2), frameMs: +((performance.now() - t) / 20).toFixed(2), newPrograms: (info.programs ? info.programs.length : 0) - p0 };
  };
  const day = view(13);
  const night = view(23);
  const kinds = {};
  for (const x of g.vehicles) kinds[x.kind] = (kinds[x.kind] || 0) + 1;
  const worstJs = Object.entries(window.__rwWorst).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k, v]) => k + ' ' + v.toFixed(1));
  return {
    day, night, worstJs, stepMs: +stepMs.toFixed(3),
    pixelRatio: g.renderer.getPixelRatio(), adaptiveScale, warmMs: g.graphics && g.graphics.warmMs ? +g.graphics.warmMs.toFixed(0) : null,
    programs: info.programs ? info.programs.length : 0, programsAtStart,
    firstFrames: { count: gaps.length, worstMs: sorted.slice(0, 5).map((x) => +x.toFixed(0)), over50ms: gaps.filter((x) => x > 50).length },
    geometries: info.memory.geometries, textures: info.memory.textures, vehicles: kinds,
    map: g.city.map || 'island', cityMs: g.city.buildMs || null, meshMs: Math.round(g.cityMesh.userData.buildMs),
    lots: g.city.lots ? g.city.lots.length : 0,
    stream: g.cityMesh.userData.stream ? { ...g.cityMesh.userData.stream.stats, lotStats: g.cityMesh.userData.stream.lotStats, worstSliceMs: +g.cityMesh.userData.stream.stats.worstSliceMs.toFixed(1), buildMs: Math.round(g.cityMesh.userData.stream.stats.buildMs) } : null,
    heapMB: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1e6) : null,
  };
}, startGaps);
console.log(JSON.stringify(out, null, 1));
await browser.close();
server.close();
