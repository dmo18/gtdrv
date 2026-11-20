// Developer helper: scripted combat (a gunfight, an explosion, a burning
// car) in the real game at phone size, saving screenshots to shots/ and
// printing draw calls, pool counts and step cost.
// usage: node scripts/combatfx-shots.mjs [gunfight|wall|explosion|burning ...]
import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';
import { buildGame, serve } from './build.mjs';

let chromium;
try {
  ({ chromium } = await import('playwright'));
} catch {
  ({ chromium } = createRequire('/opt/node-tools/node_modules/')('playwright'));
}
const want = process.argv.slice(2).filter((a) => !a.startsWith('-'));
await buildGame({ minify: false });
const server = await serve(0);
await mkdir('shots', { recursive: true });
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

let shotNo = 0;
async function shot(name, extra = '') {
  await page.screenshot({ path: `shots/combatfx-${++shotNo}-${name}.png` });
  const info = await page.evaluate(() => window.__shot.info());
  console.log(name, extra, JSON.stringify(info));
}

if (!want.length || want.includes('baseline')) {
  const base = await page.evaluate(() => {
    window.__shot.run(2);
    return window.__shot.info().calls;
  });
  console.log('baseline calls', base);
}

if (!want.length || want.includes('gunfight')) {
  // Three people in front of the player; he fires an SMG, then a shotgun.
  await page.evaluate(() => {
    const g = window.__rw;
    const w = g.player.walker;
    const peds = g.actors.filter((a) => a !== w && a.team === 'civ').slice(0, 3);
    peds.forEach((a, i) => {
      a.x = a.px = w.x + 11 + i * 1.5;
      a.z = a.pz = w.z - 2 + i * 2;
      a.speed = 0;
    });
    window.__shot.cam = [w.x - 3, 2.0, w.z + 2.5, w.x + 12, 1.3, w.z - 1];
    w.arms.weapon = 'smg';
    g.aim.manual = true;
    g.aim.dx = 1; g.aim.dy = 0; g.aim.dz = 0;
    window.__shot.run(16, (i) => {
      g.aim.dz = (i % 6 - 3) * 0.03;
      if (i % 4 === 3) w.arms.cool = 0;
      if (i % 4 === 3 || i === 15) g.combat.fire(w, 1, 0, g.aim.dz);
    });
  });
  await shot('gunfight', 'smg');
  await page.evaluate(() => {
    const g = window.__rw;
    const w = g.player.walker;
    w.arms.weapon = 'scatter';
    w.arms.cool = 0;
    window.__shot.run(2, (i) => {
      if (i === 0) g.combat.fire(w, 1, 0, 0.05, null, 'scatter');
    });
  });
  await shot('gunfight', 'shotgun');
}

if (!want.length || want.includes('wall')) {
  // Fire at the nearest building wall to see sparks, dust and holes.
  await page.evaluate(() => {
    const g = window.__rw;
    const w = g.player.walker;
    w.arms.weapon = 'pistol';
    // face the first direction with a wall within 20 m
    let best = null;
    for (let a = 0; a < 360; a += 15) {
      const dx = Math.cos((a * Math.PI) / 180), dz = Math.sin((a * Math.PI) / 180);
      const r = g.combat.trace(w.x, 1.4, w.z, dx, 0, dz, 25, w, null);
      if (r.kind === 'wall' && (!best || r.t < best.t)) best = { dx, dz, t: r.t };
    }
    window.__wall = best;
    if (!best) return;
    w.heading = w.pheading = Math.atan2(best.dz, best.dx);
    window.__shot.cam = [w.x - best.dx * 3 - best.dz * 2.2, 1.9, w.z - best.dz * 3 + best.dx * 2.2, w.x + best.dx * best.t, 1.3, w.z + best.dz * best.t];
    g.aim.manual = true;
    g.aim.dx = best.dx; g.aim.dy = 0; g.aim.dz = best.dz;
    window.__shot.run(40, (i) => {
      if (i % 4 === 0) {
        g.player.walker.arms.cool = 0;
        g.combat.fire(w, best.dx + (i % 8) * 0.01, 0, best.dz);
      }
    });
  });
  await shot('wall', JSON.stringify(await page.evaluate(() => window.__wall)));
}

if (!want.length || want.includes('explosion')) {
  await page.evaluate(() => {
    const g = window.__rw;
    const w = g.player.walker;
    g.aim.manual = false;
    const x = w.x + 14, z = w.z - 6;
    window.__shot.cam = [w.x - 5, 2.6, w.z - 4, x, 3.2, z];
    w.heading = w.pheading = 0;
    window.__shot.run(1, () => g.combat.explode(x, 0.5, z, 8, null));
    window.__shot.run(10);
  });
  await shot('explosion', '+0.2s');
  await page.evaluate(() => window.__shot.run(40));
  await shot('explosion', '+0.9s');
  await page.evaluate(() => window.__shot.run(90));
  await shot('explosion', '+2.4s smoke column');
}

if (!want.length || want.includes('burning')) {
  const info = await page.evaluate(() => {
    const g = window.__rw;
    const w = g.player.walker;
    // nearest car that is not far, moved in front of the player
    let c = null, bd = 1e9;
    for (const v of g.vehicles) {
      if (v.kind !== 'car' || v === g.player.vehicle || v.removed) continue;
      const d = Math.hypot(v.x - w.x, v.z - w.z);
      if (d < bd) { bd = d; c = v; }
    }
    c.x = c.px = w.x + 9; c.z = c.pz = w.z - 6; c.heading = c.pheading = 0.3;
    c.vx = c.vz = 0; c.speed = 0; c.asleep = false;
    g.combat.burnAll = true;
    let n = 0;
    window.__shot.cam = [w.x - 1, 2.4, w.z - 3, c.x, 1.0, c.z];
    while (!c.burning && n++ < 5) g.combat.damage(c, c.health * 0.4, null, 'fire');
    window.__shot.run(120);
    return { burning: c.burning, health: Math.round(c.health), hits: n };
  });
  await shot('burning', JSON.stringify(info));
  await page.evaluate(() => window.__shot.run(120));
  await shot('burning', 'later');
}

// Explosives and craft weapons (docs/ARMS.md): throw arc preview, a placed
// charge, a bomb falling onto its impact ring, a missile trail, a huge blast.
if (!want.length || want.includes('arms')) {
  // Out on the open runway, so nothing hides the effects.
  await page.evaluate(() => {
    const g = window.__rw;
    const w = g.player.walker;
    const rw = g.city.airfield.runway;
    w.x = w.px = rw.x0 + 260;
    w.z = w.pz = (rw.z0 + rw.z1) / 2;
    g.player.x = w.x;
    g.player.z = w.z;
    window.__shot.run(30);
  });
  for (const [vw, vh] of [[915, 412], [780, 360]]) {
    await page.setViewportSize({ width: vw, height: vh });
    const pv = await page.evaluate(() => {
      const g = window.__rw;
      const w = g.player.walker;
      g.combat.burnAll = false;
      w.arms.weapon = 'fizz';
      w.arms.cool = 0;
      w.heading = 0;
      if (g.chase && g.chase.aim) { g.chase.aim.yaw = 0; g.chase.aim.pitch = 0.25; }
      g.input.press('fire');
      window.__shot.cam = [w.x - 7, 4.5, w.z + 9, w.x + 9, 0.5, w.z];
      window.__shot.run(12, () => { if (g.chase && g.chase.aim) { g.chase.aim.yaw = 0; g.chase.aim.pitch = 0.25; } });
      return { on: g.combat.preview.on, n: g.combat.preview.n, hx: +g.combat.preview.hx.toFixed(1) };
    });
    await shot(`arms-throw-preview-${vw}x${vh}`, JSON.stringify(pv));
    await page.evaluate(() => { const g = window.__rw; g.input.release('fire'); window.__shot.run(150); });
  }
  await page.setViewportSize({ width: 915, height: 412 });
  const sticky = await page.evaluate(() => {
    const g = window.__rw;
    const w = g.player.walker;
    w.arms.weapon = 'sticky';
    w.arms.cool = 0;
    g.combat.fire(w, Math.cos(0.1), Math.sin(0.1), 0);
    window.__shot.cam = [w.x + 4, 2.2, w.z + 5, w.x + 11, 0.2, w.z];
    window.__shot.run(100);
    return g.combat.countStickies(w);
  });
  await shot('arms-sticky-placed', `charges ${sticky}`);
  await page.evaluate(() => { const g = window.__rw; g.combat.detonateStickies(g.player.walker); window.__shot.run(8); });
  await shot('arms-sticky-blast');
  const drop = await page.evaluate(() => {
    const g = window.__rw;
    const w = g.player.walker;
    window.__shot.run(120);
    // A fixture armed plane flown by hand (the real fighter is task 33).
    const pl = g.vehicles.find((v) => v.kind === 'plane' && !v.wrecked);
    pl.spec = { ...pl.spec, mounts: ['nosegun', 'missile', 'bomb'] };
    pl.arms = undefined;
    pl.x = pl.px = w.x - 30; pl.z = pl.pz = w.z + 6; pl.y = pl.py = 45; pl.heading = 0; pl.pitch = 0;
    pl.vx = 30; pl.vz = 0; pl.vy = 0; pl.onGround = false; pl.asleep = true;
    // Aboard (asleep: it hangs still), so combat draws the impact ring.
    g.player.vehicle = pl;
    pl.driver = 'player';
    g.combat.fireMount(pl, 'drop', 1, 0, 0);
    const pd = g.combat.predictDrop(pl);
    g.combat.dropPreview.hx = pd.hx; g.combat.dropPreview.hy = pd.hy; g.combat.dropPreview.hz = pd.hz;
    window.__shot.cam = [pd.hx - 26, 26, pd.hz + 30, pd.hx, 8, pd.hz];
    window.__shot.run(Math.round(pd.t * 60 * 0.6));
    window.__plane = pl;
    return { hx: +pd.hx.toFixed(1), t: +pd.t.toFixed(2) };
  });
  await shot('arms-bomb-falling', JSON.stringify(drop));
  await page.evaluate(() => {
    const g = window.__rw;
    let n = 0;
    const off = g.events.on('explosion', () => n++);
    window.__shot.run(120, () => { if (n) g.player.vehicle = null; });
    off();
  });
  await page.evaluate(() => window.__shot.run(1));
  await shot('arms-bomb-blast');
  await page.evaluate(() => window.__shot.run(10));
  await shot('arms-bomb-blast', 'later');
  const msl = await page.evaluate(() => {
    const g = window.__rw;
    const pl = window.__plane;
    window.__shot.run(150);
    pl.wrecked = false; pl.health = pl.spec.health; pl.burning = false;
    pl.x = pl.px = g.player.walker.x - 60; pl.y = pl.py = 30; pl.z = pl.pz = g.player.walker.z - 10;
    pl.arms.cool.missile = 0;
    const ok = g.combat.fireMount(pl, 1, 0.97, -0.1, 0.2, null, null);
    window.__shot.cam = [pl.x + 20, 34, pl.z + 30, pl.x + 50, 26, pl.z + 6];
    window.__shot.run(30);
    return ok;
  });
  await shot('arms-missile', `fired ${msl}`);
}

// Cost of a busy fight: step time with 10 shooters, explosions and fire.
const cost = await page.evaluate(() => {
  const g = window.__rw;
  const w = g.player.walker;
  const t0 = performance.now();
  for (let i = 0; i < 300; i++) {
    if (i % 3 === 0) g.combat.fire(w, 1, 0, (i % 7 - 3) * 0.02, null, 'smg');
    if (i % 90 === 0) g.combat.explode(w.x + 20, 0.5, w.z + (i % 5), 8, null);
    g.step(1 / 60);
  }
  return { stepMs: +((performance.now() - t0) / 300).toFixed(3), ...window.__shot.info() };
});
console.log('busy fight', JSON.stringify(cost));
console.log(bad ? `FAIL ${bad} page errors` : 'no page errors');
await browser.close();
server.close();
if (bad) process.exit(1);
