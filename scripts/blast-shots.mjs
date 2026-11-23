// Developer helper: a big car explosion at three moments (flash, fireball,
// smoke column), a cop shot dead on the street and a missile hitting a tank,
// at phone size, saved to docs/preview/. Prints draw calls and step cost.
// usage: node scripts/blast-shots.mjs [explosion|cop|missile|w6|w6-day|w6-night|w6-fall]
// w6: a car blast at 0.1, 0.5, 5 and 30 s after it, by day and by night,
// and a body falling away from a shot (docs/preview/w6-*.png).
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
// Its own build folder: other scripts may be building dist/ at the same time.
const OUT = join(tmpdir(), 'rw-blast-shots');
await buildGame({ minify: false, outDir: OUT });
const server = await serve(0, OUT);
await mkdir('docs/preview', { recursive: true });
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 915, height: 412 }, deviceScaleFactor: 1 });
let bad = 0;
page.on('pageerror', (e) => {
  bad++;
  console.log('pageerror', String(e));
});
page.on('console', (m) => {
  if (m.type() === 'error') {
    bad++;
    console.log('console.error', m.text().slice(0, 300));
  }
});
await page.goto(`http://127.0.0.1:${server.address().port}/?autostart`);
await page.waitForFunction(() => window.__rw && window.__rw.loop.running, null, { timeout: 60000 });
await page.waitForTimeout(3000);

// Put the player on foot at the spawn, facing +x, at noon.
await page.evaluate(() => {
  const g = window.__rw;
  g.loop.stop();
  const p = g.player;
  const v = p.vehicle;
  const w = p.walker;
  w.x = w.px = v.x + 3;
  w.z = w.pz = v.z + 3;
  w.heading = w.pheading = 0;
  v.driver = null;
  p.vehicle = null;
  g.setPlayerMode('foot');
  g.daynight.setHour(14);
  g.daynight.setWeather('clear', true);
  g.step(1 / 60);
  window.__shot = {
    // Step n times, then draw with the camera at cam = [x, y, z, lookX, lookY, lookZ].
    cam: null,
    run(n, fn) {
      for (let i = 0; i < n; i++) {
        if (fn) fn(i);
        g.step(1 / 60);
      }
      g.draw(1, 1 / 60);
      const c = window.__shot.cam;
      if (c) {
        g.camera.position.set(c[0], c[1], c[2]);
        g.camera.lookAt(c[3], c[4], c[5]);
        g.camera.updateMatrixWorld();
        g.systems.find((s) => s.name === 'combatfx').render(1, 0);
        g.renderFrame(0);
      }
    },
    info() {
      const fx = g.systems.find((s) => s.name === 'combatfx');
      return { calls: g.renderer.info.render.calls, ...fx.counts() };
    },
  };
});


const shot = async (name) => {
  await page.screenshot({ path: `docs/preview/${name}.png`, timeout: 180000 });
  console.log(name, JSON.stringify(await page.evaluate(() => window.__shot.info())));
};


const only = process.argv[2] || 'all';

if (only === 'all' || only === 'explosion') {
  // A parked car blows up in front of the player; three moments, same camera.
  await page.evaluate(() => {
    const g = window.__rw;
    const w = g.player.walker;
    const c = g.debug.spawnCar('sedan', w.x + 16, w.z - 3, 0);
    c.vx = c.vz = c.speed = 0;
    window.__car = c;
    window.__shot.cam = [w.x - 3, 3.4, w.z - 9, c.x, 4.2, c.z];
    window.__shot.run(2);
    g.combat.damage(c, 1e5, w, 'blast');
    window.__shot.run(2);
  });
  await shot('boom-1-flash');
  await page.evaluate(() => window.__shot.run(16));
  await shot('boom-2-fireball');
  const perf = await page.evaluate(() => {
    let worst = 0, at = 0, sum = 0;
    for (let i = 0; i < 220; i++) {
      const t0 = performance.now();
      window.__rw.step(1 / 60);
      const dtm = performance.now() - t0;
      sum += dtm;
      if (dtm > worst) {
        worst = dtm;
        at = i;
      }
    }
    window.__perf = { mean: +(sum / 220).toFixed(2), at };
    window.__shot.run(1);
    return +worst.toFixed(2);
  });
  await shot('boom-3-smoke-column');
  console.log('worst step ms during the blast', perf, JSON.stringify(await page.evaluate(() => window.__perf)));
}

if (only === 'all' || only === 'cop') {
  await page.evaluate(() => {
    const g = window.__rw;
    const w = g.player.walker;
    const pol = g.police;
    pol.heat.level = 2;
    pol.heat.points = 2.5;
    let o = null;
    for (let i = 0; i < 1500 && !o; i++) {
      g.step(1 / 60);
      const c = pol.cars.find((q) => q.occ);
      if (c) {
        c.x = c.px = w.x + 12;
        c.z = c.pz = w.z - 6;
        c.vx = c.vz = c.speed = 0;
        c.role = 'out';
        c.outT = 0;
      }
      o = pol.officers.find((q) => q.active && q.life === 'ok');
    }
    window.__o = o;
    // Put the officer a few meters ahead of the player on the street and shoot him.
    o.x = o.px = w.x + 6;
    o.z = o.pz = w.z - 1;
    o.state = 'return';
    window.__shot.cam = [w.x + 3.2, 1.7, w.z + 2.6, o.x, 0.3, o.z];
    window.__shot.run(2);
    w.arms.weapon = 'pistol';
    w.arms.cool = 0;
    const dx = o.x - w.x, dz = o.z - w.z, l = Math.hypot(dx, dz);
    g.combat.fire(w, dx / l, (1.0 - 1.4) / l, dz / l);
    window.__shot.run(70);
  });
  await shot('cop-dead-street');
}

if (only === 'all' || only === 'missile') {
  await page.evaluate(() => {
    const g = window.__rw;
    const w = g.player.walker;
    const t = g.vehicles.find((v) => v.kind === 'tank' && !v.wrecked);
    t.x = t.px = w.x + 40;
    t.z = t.pz = w.z - 2;
    t.vx = t.vz = t.speed = 0;
    t.health = t.spec.health;
    window.__tank = t;
    // The missile comes in low from the left of the camera.
    window.__shot.cam = [t.x - 25, 2.4, t.z + 3.5, t.x, 2.0, t.z];
    const plane = g.vehicles.find((v) => v.kind === 'plane' && v.spec.id === 'fighter');
    plane.x = plane.px = t.x - 160;
    plane.z = plane.pz = t.z;
    plane.y = plane.py = 22;
    plane.heading = plane.pheading = 0;
    plane.vx = 80; plane.vz = 0; plane.vy = 0;
    plane.arms = undefined;
    window.__plane = plane;
    g.combat.armsOf(plane);
    g.combat.fireMount(plane, 1, 1, -0.12, 0, w, t);
    window.__shot.run(60);
  });
  await shot('missile-flight');
  await page.evaluate(() => {
    for (let i = 0; i < 200; i++) {
      window.__rw.step(1 / 60);
      const b = window.__rw.combat.projectiles.find((p) => p.active);
      if (!b) break;
    }
    window.__shot.run(5);
  });
  await shot('missile-tank-impact');
  await page.evaluate(() => window.__shot.run(40));
  await shot('missile-tank-after');
}
if (only === 'all' || only.startsWith('w6')) {
  const moments = [[0.1, '0.1s'], [0.5, '0.5s'], [5, '5s'], [30, '30s']];
  for (const [hour, tag] of [[14, 'day'], [21.5, 'night']]) {
    if (only !== 'all' && only !== 'w6' && only !== 'w6-' + tag) continue;
    await page.evaluate((hour) => {
      const g = window.__rw;
      g.daynight.setHour(hour);
      g.daynight.setWeather('clear', true);
      const w = g.player.walker;
      if (window.__car && !window.__car.removed) g.removeVehicle(window.__car);
      // Down the start street: the car in the road ahead, the camera behind
      // and a little up, so the whole 12 m blast and the street round it show.
      const sp = g.city.spawn;
      const fx = Math.cos(sp.heading), fz = Math.sin(sp.heading);
      const cx = sp.x + fx * 30, cz = sp.z + fz * 30;
      const c = g.debug.spawnCar('sedan', cx, cz, sp.heading + 0.5);
      c.vx = c.vz = c.speed = 0;
      window.__car = c;
      window.__shot.cam = [cx - fx * 19 + fz * 2.5, 4.2, cz - fz * 19 - fx * 2.5, cx, 2.2, cz];
      // Closer for the later shots: the hull and the parts lying round it.
      window.__closeCam = [cx - fx * 9 + fz * 5, 2.8, cz - fz * 9 - fx * 5, cx + fx * 2, 0.6, cz + fz * 2];
      window.__shot.run(2);
      g.combat.damage(c, 1e5, w, 'blast');
      window.__blastT = 0;
    }, hour);
    for (const [t, name] of moments) {
      await page.evaluate((t) => {
        const n = Math.max(0, Math.round((t - window.__blastT) * 60));
        window.__blastT = t;
        if (t >= 5) window.__shot.cam = window.__closeCam;
        window.__shot.run(n);
      }, t);
      await shot(`w6-blast-${tag}-${name}`);
    }
  }
  if (only === 'all' || only === 'w6' || only === 'w6-fall') {
    // A civilian shot from the side falls away from the shot.
    await page.evaluate(() => {
      const g = window.__rw;
      g.daynight.setHour(14);
      const w = g.player.walker;
      const sp = g.city.spawn;
      // Beside the start road, clear of the parked start car.
      const X0 = sp.x - Math.sin(sp.heading) * 6, Z0 = sp.z + Math.cos(sp.heading) * 6;
      const a = g.actors.find((q) => q.team === 'civ' && q.life === 'ok');
      const pin = () => {
        w.x = w.px = X0;
        w.z = w.pz = Z0;
        w.vx = w.vz = 0;
        a.x = a.px = w.x + 4;
        a.z = a.pz = w.z;
        a.heading = Math.PI / 2;
        a.vx = a.vz = 0;
      };
      window.__victim = a;
      window.__pinW = () => { w.x = w.px = X0; w.z = w.pz = Z0; };
      window.__shot.cam = [X0 + 3.4, 2.4, Z0 - 4.2, X0 + 4.8, 0.5, Z0];
      window.__shot.run(3, pin);
      pin();
      w.heading = 0;
      w.arms.weapon = 'scatter';
      w.arms.cool = 0;
      const hp0 = a.hp;
      g.combat.fire(w, 1, (1.0 - 1.4) / 4, 0);
      window.__trace = [[a.x - w.x, a.z - w.z, a.life, hp0, a.hp, w.x, a.rag && a.rag.vx]];
      for (let i = 0; i < 12; i++) {
        window.__shot.run(1, () => {
          w.x = w.px = X0;
          w.z = w.pz = Z0;
        });
        window.__trace.push([+(a.x - w.x).toFixed(2), +(w.x).toFixed(2), +(a.x).toFixed(2), a.life]);
      }
    });
    await shot('w6-fall-hit');
    console.log('victim', JSON.stringify(await page.evaluate(() => { const a = window.__victim; return { life: a.life, x: a.x - window.__rw.player.walker.x, rag: !!a.rag, tr: window.__trace }; })));
    await page.evaluate(() => window.__shot.run(100, window.__pinW));
    await shot('w6-fall-lying');
  }
}
if (only === 'all' || only === 'w6-perf') {
  // A heavy fight: six cars blown up in a row (six burning hulls, about 100
  // parts), a dozen people killed round them, the camera on it all.
  const r = await page.evaluate(() => {
    const g = window.__rw;
    g.daynight.setHour(14);
    const sp = g.city.spawn;
    const fx = Math.cos(sp.heading), fz = Math.sin(sp.heading);
    const w = g.player.walker;
    const cars = [];
    for (let i = 0; i < 6; i++) {
      const c = g.debug.spawnCar('sedan', sp.x + fx * (24 + i * 7) - fz * ((i % 2) * 4 - 2), sp.z + fz * (24 + i * 7) + fx * ((i % 2) * 4 - 2), sp.heading + i);
      c.vx = c.vz = c.speed = 0;
      cars.push(c);
    }
    const civs = g.actors.filter((a) => a.team === 'civ' && a.life === 'ok').slice(0, 12);
    civs.forEach((a, i) => {
      a.x = a.px = sp.x + fx * (26 + i * 3) + fz * 5;
      a.z = a.pz = sp.z + fz * (26 + i * 3) - fx * 5;
    });
    const cx = sp.x + fx * 40, cz = sp.z + fz * 40;
    window.__shot.cam = [sp.x + fx * 8 - fz * 6, 6, sp.z + fz * 8 + fx * 6, cx, 1.5, cz];
    const steps = [];
    let worst = 0;
    for (let i = 0; i < 360; i++) {
      if (i % 20 === 0 && i / 20 < cars.length) g.combat.damage(cars[i / 20], 1e5, w, 'blast');
      if (i === 150) civs.forEach((a) => { if (a.life === 'ok') g.combat.damage(a, 100, w, 'bullet'); });
      const t0 = performance.now();
      g.step(1 / 60);
      const dt = performance.now() - t0;
      steps.push(dt);
      if (dt > worst) worst = dt;
    }
    window.__shot.run(1);
    steps.sort((a, b) => a - b);
    const hulls = g.combat.hulls.length;
    const bodies = g.actors.filter((a) => a.life === 'out' || a.life === 'down').length;
    return { mean: +(steps.reduce((a, b) => a + b, 0) / steps.length).toFixed(2), p95: +steps[Math.floor(steps.length * 0.95)].toFixed(2), worst: +worst.toFixed(2), hulls, bodies };
  });
  await shot('w6-heavy-fight');
  console.log('heavy fight step ms', JSON.stringify(r));
}
await browser.close();
server.close();
console.log(bad ? `${bad} errors` : 'no errors');
