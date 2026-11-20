// Developer helper: blood after a shot and a car blowing apart, at phone
// size, saved to docs/preview/. Also prints draw calls and step cost
// for a heavy chain explosion.
// usage: node scripts/gore-shots.mjs
import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';
import { buildGame, serve } from './build.mjs';

let chromium;
try {
  ({ chromium } = await import('playwright'));
} catch {
  ({ chromium } = createRequire('/opt/node-tools/node_modules/')('playwright'));
}
await buildGame({ minify: false });
const server = await serve(0);
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
  await page.screenshot({ path: `docs/preview/${name}.png` });
  console.log(name, JSON.stringify(await page.evaluate(() => window.__shot.info())));
};

// 1. Blood: three people shot in front of the player.
await page.evaluate(() => {
  const g = window.__rw;
  const w = g.player.walker;
  const peds = g.actors.filter((a) => a !== w && a.team === 'civ').slice(0, 3);
  peds.forEach((a, i) => {
    a.x = a.px = w.x + 8 + i * 1.2;
    a.z = a.pz = w.z - 4.5 + i * 1.3;
    a.speed = 0;
  });
  window.__shot.cam = [w.x + 1, 3.0, w.z + 1.5, w.x + 9.5, 0, w.z - 3.5];
  g.aim.manual = true;
  g.aim.dx = 1; g.aim.dy = 0; g.aim.dz = 0;
  w.arms.weapon = 'smg';
  window.__shot.run(40, (i) => {
    if (i % 3 === 0) {
      const t = peds[(i / 3 | 0) % 3];
      const dx = t.x - w.x, dz = t.z - w.z, l = Math.hypot(dx, dz);
      w.arms.cool = 0;
      g.combat.fire(w, dx / l, -0.05, dz / l);
    }
  });
  window.__shot.run(100);
});
await shot('blood-street');

// 2. A car blown apart: debris in the air.
await page.evaluate(() => {
  const g = window.__rw;
  const w = g.player.walker;
  const car = g.debug.spawnCar('sedan', w.x + 14, w.z - 4, 0);
  car.vx = car.vz = 0;
  car.speed = 0;
  window.__shot.cam = [w.x - 4, 3.2, w.z - 7, car.x, 2.2, car.z];
  g.combat.damage(car, 1e5, null, 'blast');
  window.__shot.run(22);
});
await shot('car-blast-debris');

// 3. Heavy: twelve cars in a chain, step cost and draw calls.
const heavy = await page.evaluate(() => {
  const g = window.__rw;
  const w = g.player.walker;
  const cars = [];
  for (let i = 0; i < 12; i++) {
    const c = g.debug.spawnCar('sedan', w.x + 12 + (i % 4) * 5, w.z + 6 + Math.floor(i / 4) * 5, 0);
    c.health = 40;
    cars.push(c);
  }
  window.__shot.cam = [w.x - 4, 5, w.z - 8, w.x + 20, 1, w.z + 10];
  g.combat.damage(cars[0], 1e5, null, 'blast');
  let worst = 0, calls = 0, debris = 0;
  for (let i = 0; i < 240; i++) {
    const t0 = performance.now();
    g.step(1 / 60);
    worst = Math.max(worst, performance.now() - t0);
    if (i % 10 === 0) {
      g.draw(1, 1 / 60);
      calls = Math.max(calls, g.renderer.info.render.calls);
      debris = Math.max(debris, window.__shot.info().debris);
    }
  }
  return { worstStepMs: +worst.toFixed(2), maxDrawCalls: calls, maxDebris: debris, left: cars.filter((c) => !c.removed).length };
});
console.log('heavy chain', JSON.stringify(heavy));
await shot('chain-blast');
await browser.close();
server.close();
console.log(bad ? `${bad} errors` : 'no errors');
