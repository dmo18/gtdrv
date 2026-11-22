// Developer helper: what the police helicopter costs and does. Draw calls,
// triangles, shader programs and transparent overdraw with the heli on
// screen versus off (day and night), and what 600 steps of a heli hunt
// do to traffic, heat and the player's view compared with the same run
// without one. usage: node scripts/heli-perf.mjs
import { createRequire } from 'node:module';
import { buildGame, serve } from './build.mjs';

let chromium;
try {
  ({ chromium } = await import('playwright'));
} catch {
  ({ chromium } = createRequire('/opt/node-tools/node_modules/')('playwright'));
}
await buildGame({ minify: false });
const server = await serve(0);
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });

async function load() {
  const page = await browser.newPage({ viewport: { width: 915, height: 412 }, deviceScaleFactor: 1 });
  page.on('pageerror', (e) => console.log('pageerror', String(e)));
  await page.goto(`http://127.0.0.1:${server.address().port}/?autostart`);
  await page.waitForFunction(() => window.__rw && window.__rw.loop.running, null, { timeout: 60000 });
  await page.waitForTimeout(2500);
  await page.evaluate(() => {
    const g = window.__rw;
    g.loop.stop();
    if (g.graphics && 'adaptive' in g.graphics) { g.graphics.adaptive = false; g.resize(); }
    g.daynight.setWeather('clear', true);
  });
  return page;
}

// 1. Render cost, heli off and on screen (60 m ahead of the camera).
const page = await load();
const render = await page.evaluate(() => {
  const g = window.__rw;
  const info = g.renderer.info, gl = g.renderer.getContext(), px = new Uint8Array(4);
  const v = g.player.vehicle, c = g.city;
  v.x = v.px = c.spawn.x; v.z = v.pz = c.spawn.z; v.heading = v.pheading = c.spawn.heading; v.vx = v.vz = 0; v.speed = 0;
  const measure = () => {
    for (let i = 0; i < 20; i++) { g.step(1 / 60); g.draw(1, 1 / 60); }
    const st = g.cityMesh.userData.stream;
    if (st) st.flush(g.camera);
    g.draw(1, 1 / 60);
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    const p0 = info.programs ? info.programs.length : 0;
    let ms = 0;
    for (let i = 0; i < 10; i++) {
      const t = performance.now();
      g.draw(1, 1 / 60);
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
      ms += performance.now() - t;
    }
    // Transparent / additive area the heli adds: projected screen share of its beam.
    let beamShare = 0, beamVisible = false, lightbar = false;
    for (const a of g.vehicles) {
      if (!a.spec || a.spec.id !== 'patrolheli' || !a.mesh) continue;
      const ud = a.mesh.userData;
      beamVisible = !!(ud.beam && ud.beam.visible);
      lightbar = !!(ud.lightbar && ud.lightbar.visible);
      if (beamVisible) {
        const b = ud.beam;
        b.geometry.computeBoundingBox();
        const bb = b.geometry.boundingBox.clone().applyMatrix4(b.matrixWorld);
        const pts = [];
        for (let k = 0; k < 8; k++) {
          const p = bb.min.clone();
          if (k & 1) p.x = bb.max.x;
          if (k & 2) p.y = bb.max.y;
          if (k & 4) p.z = bb.max.z;
          p.project(g.camera);
          pts.push(p);
        }
        const xs = pts.map((p) => Math.max(-1, Math.min(1, p.x))), ys = pts.map((p) => Math.max(-1, Math.min(1, p.y)));
        beamShare = ((Math.max(...xs) - Math.min(...xs)) * (Math.max(...ys) - Math.min(...ys))) / 4;
      }
    }
    return {
      calls: g.graphics.calls || info.render.calls, triangles: g.graphics.triangles || info.render.triangles,
      newPrograms: (info.programs ? info.programs.length : 0) - p0, programs: info.programs ? info.programs.length : 0,
      frameMs: +(ms / 10).toFixed(1), beamVisible, lightbar, beamBoxScreenShare: +beamShare.toFixed(2),
    };
  };
  const out = {};
  for (const [name, hour] of [['day', 13], ['night', 23]]) {
    g.daynight.setHour(hour);
    for (const p of g.helipilot.pilots.slice()) { if (g.removeVehicle) g.removeVehicle(p.craft); }
    for (let i = 0; i < 5; i++) g.step(1 / 60);
    const off = measure();
    const h = g.camHeading;
    const pilot = g.helipilot.spawn({ dist: 60, angle: h, y: 40 });
    pilot.craft.spot = 1;
    const on = measure();
    const a = pilot.craft;
    // Where is it on screen?
    const P = a.mesh.position.clone().project(g.camera);
    on.heliNdc = [+P.x.toFixed(2), +P.y.toFixed(2), +P.z.toFixed(3)];
    on.heliOnScreen = Math.abs(P.x) < 1 && Math.abs(P.y) < 1 && P.z < 1;
    on.heliDist = +Math.hypot(a.x - g.player.x, a.z - g.player.z).toFixed(1);
    on.heliAlt = +a.y.toFixed(1);
    on.lod = a.mesh.userData.lod.getCurrentLevel();
    out[name] = { off, on };
    if (g.removeVehicle) g.removeVehicle(a);
    else a.removed = true;
    g.step(1 / 60);
  }
  return out;
});
console.log('render', JSON.stringify(render, null, 1));
await page.close();

// 2. 600 steps of a hunt (heat 4 with a heli) against the same seed without one.
async function hunt(withHeli) {
  const pg = await load();
  const r = await pg.evaluate((withHeli) => {
    const g = window.__rw;
    g.daynight.setHour(13);
    const v = g.player.vehicle;
    const ph = g.police.heat;
    let pilot = null;
    if (withHeli) pilot = g.helipilot.spawn({ dist: 150, angle: g.camHeading });
    const stats = { stopped: 0, impacts: 0, traffic: 0, overhead: 0, elevMax: 0, elevSum: 0, onScreen: 0, dMin: 1e9, dMax: 0, altMin: 1e9, altMax: 0, heatStart: ph.level, frames: 0 };
    for (let i = 0; i < 600; i++) {
      // The player drives slowly along its road, like a chase.
      v.controls = v.controls || {};
      g.step(1 / 60);
      for (const o of g.vehicles) {
        if (o === v || o.kind !== 'car' || o.parked || !o.driver) continue;
        if (i === 599) stats.traffic++;
        if (Math.abs(o.speed) < 0.3) stats.stopped++;
        if (o.impact > 0) stats.impacts++;
      }
      if (pilot && !pilot.craft.removed) {
        const a = pilot.craft;
        const d = Math.hypot(a.x - g.player.x, a.z - g.player.z);
        const up = a.y - (g.player.y || 0);
        const elev = Math.atan2(up, d) * 180 / Math.PI;
        stats.elevMax = Math.max(stats.elevMax, elev);
        stats.elevSum += elev;
        stats.dMin = Math.min(stats.dMin, d); stats.dMax = Math.max(stats.dMax, d);
        stats.altMin = Math.min(stats.altMin, up); stats.altMax = Math.max(stats.altMax, up);
        if (elev > 60) stats.overhead++;
        if (i % 10 === 0) {
          g.draw(1, 1 / 60);
          const P = a.mesh.position.clone().project(g.camera);
          stats.frames++;
          if (Math.abs(P.x) < 1 && Math.abs(P.y) < 1 && P.z < 1) stats.onScreen++;
        }
      }
    }
    stats.heatEnd = ph.level;
    stats.elevMean = +(stats.elevSum / 600).toFixed(1);
    delete stats.elevSum;
    stats.state = pilot ? pilot.state : null;
    return stats;
  }, withHeli);
  await pg.close();
  return r;
}
console.log('hunt without heli', JSON.stringify(await hunt(false)));
console.log('hunt with heli', JSON.stringify(await hunt(true)));
await browser.close();
server.close();
