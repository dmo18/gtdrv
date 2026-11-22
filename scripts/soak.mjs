// Soak test: drives the game for a fixed simulated time with the loop
// stopped (step 1/60, draw every few steps), across a loop of places over
// the whole map so tiles stream in and out, traffic and parked cars cycle
// and LODs switch. Along the way it switches craft (car, boat, plane,
// helicopter, tank), gets out and in, carjacks, blows up cars near traffic,
// uses a garage, boost and the siren, the fire truck's water and the tow
// hook. Fails on any page error, console error or exception thrown from a
// step or a draw (printed with its stack from an unminified build).
// usage: node scripts/soak.mjs [simSeconds=600] [drawEvery=12]
import { createRequire } from 'node:module';
import { buildGame, serve } from './build.mjs';

let chromium;
try {
  ({ chromium } = await import('playwright'));
} catch {
  ({ chromium } = createRequire('/opt/node-tools/node_modules/')('playwright'));
}
const simSeconds = Number(process.argv[2]) || 600;
const drawEvery = Math.max(1, Number(process.argv[3]) || 12);
const t0 = Date.now();
await buildGame({ minify: false });
const server = await serve(0);
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 915, height: 412 }, hasTouch: true, isMobile: true, deviceScaleFactor: 1 });
const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + (e.stack || String(e))));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push('console: ' + m.text());
});
await page.goto(`http://127.0.0.1:${server.address().port}/?autostart`);
await page.waitForFunction(() => window.__rw && window.__rw.loop.running, null, { timeout: 180000 });

// The in-page driver: run(n) steps n times, drawing every `drawEvery`
// steps; exceptions are kept with their stacks (and the step carries on so
// one failure does not hide the next).
await page.evaluate((drawEvery) => {
  const g = window.__rw;
  g.loop.stop();
  for (const k of ['car', 'foot', 'boat', 'plane', 'heli', 'first']) g.progress.medals['hint_' + k] = 'bronze';
  if (g.graphics && 'adaptive' in g.graphics) { g.graphics.adaptive = false; g.resize(); }
  const caught = (window.__soakErr = []);
  const seen = new Set();
  const keep = (where, e) => {
    const s = where + ': ' + (e && e.stack ? e.stack : String(e));
    const key = where + String(e && e.message);
    if (seen.has(key)) return;
    seen.add(key);
    caught.push(s);
  };
  const src = (window.__soakSrc = g.input.addSource({ steer: 0, throttle: 0, brake: 0, handbrake: false, moveX: 0, moveY: 0, sprint: false, pitch: 0, boost: false }));
  let k = 0;
  window.__soakRun = (n) => {
    for (let i = 0; i < n; i++) {
      // Weave a little so the car does not just hit the first wall.
      src.steer = Math.sin(g.time * 0.7) * 0.35;
      try { g.step(1 / 60); } catch (e) { keep('step', e); }
      if (++k % drawEvery === 0) {
        try { g.draw(1, drawEvery / 60); } catch (e) { keep('draw', e); }
      }
    }
    return { t: g.time, vehicles: g.vehicles.length, mode: g.player.mode };
  };
  window.__soakTry = (label, f) => {
    try { return f(); } catch (e) { keep(label, e); return null; }
  };
}, drawEvery);

const log = (s) => console.log(`[${((Date.now() - t0) / 1000).toFixed(0)} s] ${s}`);
const run = (n) => page.evaluate((n) => window.__soakRun(n), n);
const act = (label, fn, arg) => page.evaluate(([label, fn, arg]) => window.__soakTry(label, () => new Function('g', 'arg', fn)(window.__rw, arg)), [label, `return (${fn.toString()})(g, arg);`, arg ?? null]);

// Regressions first (docs/STATUS.md, frame loop errors): the car left at
// the start is swept away while the player is far off, then entered again
// (the Phone check did that: every later draw threw on its null mesh), and
// a craft removed with the player still in it.
const reg = await page.evaluate(() => {
  const g = window.__rw, p = g.player, out = [];
  const v0 = g.debug.spawnCar('sedan', p.x, p.z, p.heading);
  v0.home = null;
  if (p.vehicle) { const o = p.vehicle; o.driver = null; o.speed = o.vx = o.vz = 0; p.vehicle = null; g.setPlayerMode('foot'); }
  const car = g.debug.spawnCar('sedan', v0.x + 400, v0.z, 0);
  g.enterVehicle(car);
  window.__soakRun(300); // the 3 s sweep clears v0 (over 300 m away)
  if (!v0.removed) out.push('the left car was not swept');
  if (g.enterVehicle(v0) !== false) out.push('entered a removed car');
  window.__soakRun(12);
  const v1 = g.player.vehicle;
  g.removeVehicle(v1);
  if (g.player.vehicle || g.player.mode !== 'foot') out.push('left inside a removed car');
  window.__soakRun(12);
  return out;
});
if (reg.length) errors.push('regression: ' + reg.join('; '));
log(`regressions ${reg.length ? 'FAILED: ' + reg.join('; ') : 'ok'}`);

// Ten places on a loop over the whole map: the road node nearest each.
const places = await page.evaluate(() => {
  const g = window.__rw, c = g.city;
  const b = c.bounds || { x0: -3000, z0: -3000, x1: 3000, z1: 3000 };
  const out = [];
  const pts = [[0.2, 0.2], [0.5, 0.15], [0.8, 0.2], [0.85, 0.5], [0.8, 0.8], [0.5, 0.85], [0.2, 0.8], [0.15, 0.5], [0.4, 0.45], [0.6, 0.55]];
  for (const [fx, fz] of pts) {
    const x = b.x0 + (b.x1 - b.x0) * fx, z = b.z0 + (b.z1 - b.z0) * fz;
    let best = null, bd = Infinity;
    for (const e of c.edges) {
      if (e.bridge || e.causeway || e.length < 40) continue;
      const a = c.nodes[e.a], n = c.nodes[e.b];
      const d = Math.hypot((a.x + n.x) / 2 - x, (a.z + n.z) / 2 - z);
      if (d < bd) { bd = d; best = e; }
    }
    const a = c.nodes[best.a], n = c.nodes[best.b];
    out.push({ x: a.x + (n.x - a.x) * 0.3, z: a.z + (n.z - a.z) * 0.3, h: Math.atan2(n.z - a.z, n.x - a.x) });
  }
  return out;
});

// Helpers run in the page.
const getInCar = (g, spec) => {
  const p = g.player;
  if (p.vehicle && p.vehicle.kind === 'car' && (!spec || p.vehicle.spec.id === spec)) return p.vehicle;
  if (p.vehicle) { const o = p.vehicle; o.driver = null; o.speed = o.vx = o.vz = 0; p.vehicle = null; g.setPlayerMode('foot'); }
  const v = g.debug.spawnCar(spec || 'sedan', p.x, p.z, p.heading);
  g.player.walker.x = v.x; g.player.walker.z = v.z;
  g.enterVehicle(v);
  return v;
};
const teleport = (g, pl) => {
  const v = g.player.vehicle;
  if (!v) return;
  v.x = v.px = pl.x; v.z = v.pz = pl.z; v.heading = v.pheading = pl.h;
  v.vx = Math.cos(pl.h) * 25; v.vz = Math.sin(pl.h) * 25; v.speed = 25;
  v.y = v.py = v.kind === 'plane' || v.kind === 'heli' ? 80 : 0;
  if (g.snapCam) g.snapCam();
};

const startT = await page.evaluate(() => window.__rw.time);
let simDone = 0, leg = 0;
const legSteps = 600; // 10 simulated seconds per leg
while (simDone < simSeconds) {
  const pl = places[leg % places.length];
  const what = leg % 9;
  await page.evaluate(() => { window.__soakSrc.throttle = 1; window.__soakSrc.boost = false; });
  if (what === 0 || what === 3 || what === 6) {
    // Plain driving at speed with boost and the siren (police car).
    await act('car', getInCar, what === 3 ? 'police' : null);
    await act('teleport', teleport, pl);
    await page.evaluate(() => { window.__soakSrc.boost = true; window.__rw.input.press('siren'); window.__rw.input.release('siren'); });
  } else if (what === 1) {
    // Blow up the traffic round the player: hulls, parts, bodies.
    await act('car', getInCar, null);
    await act('teleport', teleport, pl);
    await run(120);
    await act('explode', (g) => {
      const p = g.player;
      let n = 0;
      for (const v of g.vehicles.slice()) {
        if (v === p.vehicle || v.kind !== 'car') continue;
        const d = Math.hypot(v.x - p.x, v.z - p.z);
        if (d < 120 && n < 3) { g.combat.explode(v.x, 1, v.z, 8); n++; }
      }
      // Also one by a person on the pavement, if any.
      const a = g.actors.find((x) => x !== p.walker && x.life === 'ok' && Math.hypot(x.x - p.x, x.z - p.z) < 80);
      if (a) g.combat.explode(a.x, 1, a.z, 6);
      return n;
    });
  } else if (what === 2) {
    // Out, on foot, then carjack the nearest driven car (or any car).
    await act('car', getInCar, null);
    await act('teleport', teleport, pl);
    await run(180);
    await act('exit', (g) => { const v = g.player.vehicle; v.speed = v.vx = v.vz = 0; return g.exitVehicle(); });
    await run(60);
    await act('jack', (g) => {
      const p = g.player;
      let best = null, bd = Infinity;
      for (const v of g.vehicles) {
        if (v.kind !== 'car' || v.wrecked) continue;
        const d = Math.hypot(v.x - p.x, v.z - p.z);
        if (d < bd) { bd = d; best = v; }
      }
      if (!best) best = g.debug.spawnOccupied('sedan', p.x + 3, p.z, 0, 'civ');
      g.player.walker.x = g.player.walker.px = best.x + 2.5;
      g.player.walker.z = g.player.walker.pz = best.z;
      return g.tryEnterVehicle(best);
    });
    await run(240);
    await act('carjackDone', (g) => { if (!g.player.vehicle && g.carjack && g.carjack.cancel) g.carjack.cancel(); });
  } else if (what === 4) {
    // Each craft in turn: boat, plane, helicopter, tank, then a car.
    for (const kind of ['boat', 'plane', 'heli', 'tank']) {
      await act('craft-' + kind, (g, kind) => {
        const p = g.player;
        let c = g.vehicles.find((v) => v.kind === kind && !v.wrecked && v !== p.vehicle);
        if (!c) return false;
        if (p.vehicle) { const o = p.vehicle; o.driver = null; o.speed = o.vx = o.vz = 0; p.vehicle = null; g.setPlayerMode('foot'); }
        g.player.walker.x = c.x; g.player.walker.z = c.z;
        g.enterVehicle(c);
        return true;
      }, kind);
      await run(150);
    }
    await act('car', getInCar, null);
  } else if (what === 5) {
    // A garage: drive to its door, open, store, take out, close.
    await act('car', getInCar, null);
    await act('garage', (g) => {
      const gs = g.garages;
      if (!gs || !gs.list.length) return false;
      const gg = gs.list[(g.time | 0) % gs.list.length];
      const v = g.player.vehicle;
      const d = gg.door || gg;
      v.x = v.px = d.x; v.z = v.pz = d.z; v.speed = v.vx = v.vz = 0;
      if (g.snapCam) g.snapCam();
      return true;
    });
    await run(180);
    await act('garageUse', (g) => {
      const gs = g.garages;
      for (let i = 0; i < gs.list.length; i++) if (gs.open(i)) break;
      gs.store();
      gs.takeOut(0);
      gs.close();
      if (g.menu && g.menu.close) g.menu.close();
    });
    await act('car', getInCar, null);
  } else if (what === 7) {
    // Fire truck: drive, then spray at a burning hull.
    await act('car', getInCar, 'firetruck');
    await act('teleport', teleport, pl);
    await run(120);
    await act('fire', (g) => {
      const p = g.player, v = p.vehicle;
      v.speed = v.vx = v.vz = 0;
      const t = g.debug.spawnCar('sedan', p.x + Math.cos(p.heading) * 12, p.z + Math.sin(p.heading) * 12, 0);
      g.combat.explode(t.x, 1, t.z, 6);
      g.input.press('extra');
    });
    await page.evaluate(() => { window.__soakSrc.throttle = 0; });
    await run(240);
    await act('fireOff', (g) => g.input.release('extra'));
  } else if (what === 8) {
    // Tow truck: hook a parked car and drive off with it.
    await act('car', getInCar, 'towtruck');
    await act('teleport', teleport, pl);
    await act('tow', (g) => {
      const p = g.player, v = p.vehicle;
      v.speed = v.vx = v.vz = 0;
      g.debug.spawnCar('sedan', p.x - Math.cos(p.heading) * 7, p.z - Math.sin(p.heading) * 7, p.heading);
      g.input.press('extra');
      g.input.release('extra');
    });
    await page.evaluate(() => { window.__soakSrc.throttle = 0; });
    await run(150);
    await page.evaluate(() => { window.__soakSrc.throttle = 0.6; });
  }
  const s = await run(legSteps);
  simDone = s.t - startT;
  // Every other leg, also flush the streamed tiles round the camera.
  if (leg % 2 === 0) await act('flush', (g) => { const st = g.cityMesh.userData.stream; if (st) st.flush(g.camera); });
  // Every drawable in the scene has a material (three.js reads
  // material.visible for each one it draws).
  const bad = await page.evaluate(() => {
    const out = [];
    window.__rw.scene.traverse((o) => {
      if (!(o.isMesh || o.isPoints || o.isLine || o.isSprite)) return;
      const m = o.material;
      if (!m || (Array.isArray(m) && m.some((x) => !x))) out.push(o.name || o.type);
      for (const c of o.children) if (!c) out.push('undefined child of ' + (o.name || o.type));
    });
    return out.slice(0, 5);
  });
  if (bad.length) errors.push('meshes without a material: ' + bad.join(', '));
  const errs = await page.evaluate(() => window.__soakErr.length + window.__rw.errors.count);
  log(`leg ${leg} (${what}) sim ${s.t.toFixed(0)} s, ${s.vehicles} vehicles, ${s.mode}, ${errs} caught, ${errors.length} page errors`);
  leg++;
}
const caught = await page.evaluate(() => window.__soakErr.concat(window.__rw.errors.list.map((e) => `${e.where} (${e.n}x): ${e.stack || e.message}`)));
const simT = await page.evaluate(() => window.__rw.time);
await browser.close();
server.close();
for (const e of caught) console.log('CAUGHT ' + e);
for (const e of errors) console.log('ERROR ' + e);
console.log(`soak: ${simT.toFixed(0)} simulated s in ${((Date.now() - t0) / 1000).toFixed(0)} s wall, ${caught.length} exceptions, ${errors.length} page/console errors`);
process.exit(caught.length || errors.length ? 1 : 0);
