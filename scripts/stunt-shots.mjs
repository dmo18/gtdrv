// Developer helper: a person thrown over a car hood mid-tumble
// (ragdoll) and a car in the air over a stunt ramp with the stunt toast,
// at phone size, saved to docs/preview/.
// usage: node scripts/stunt-shots.mjs
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
await page.goto(`http://127.0.0.1:${server.address().port}/?autostart`, { timeout: 120000 });
await page.waitForFunction(() => window.__rw && window.__rw.loop.running, null, { timeout: 120000 });
await page.waitForTimeout(3000);

await page.evaluate(() => {
  const g = window.__rw;
  g.loop.stop();
  g.daynight.setHour(15);
  g.daynight.setWeather('clear', true);
  window.__shot = {
    draw(cam) {
      g.draw(1, 1 / 60);
      if (cam) {
        g.camera.position.set(cam[0], cam[1], cam[2]);
        g.camera.lookAt(cam[3], cam[4], cam[5]);
        g.camera.updateMatrixWorld();
        if (g.renderFrame) g.renderFrame(0);
        else g.renderer.render(g.scene, g.camera);
      }
    },
    place(v, x, z, h, speed) {
      v.x = v.px = x;
      v.z = v.pz = z;
      v.heading = v.pheading = h;
      v.vx = Math.cos(h) * speed;
      v.vz = Math.sin(h) * speed;
      v.speed = speed;
      v.yawRate = 0;
      v.y = 0;
      v.asleep = false;
    },
  };
});

// --- 1. Pedestrian run-over: thrown over the hood, mid-tumble. ---
const ram = await page.evaluate(() => {
  const g = window.__rw;
  const v = g.player.vehicle;
  // A long straight street: the middle of an east-west edge near the spawn.
  let best = null;
  for (const e of g.city.edges) {
    if (!e.horizontal || e.avenue || e.length < 80) continue;
    const a = g.city.nodes[e.a], b = g.city.nodes[e.b];
    const d = Math.hypot((a.x + b.x) / 2 - g.city.spawn.x, (a.z + b.z) / 2 - g.city.spawn.z);
    if (!best || d < best.d) best = { d, x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 + 2 };
  }
  window.__shot.place(v, best.x - 30, best.z, 0, 16);
  for (let i = 0; i < 30; i++) g.step(1 / 60);
  const slot = g.peds.slots.find((s) => s.ped.active && s.ped.life === 'ok');
  if (!slot) return { ok: false };
  const ped = slot.ped;
  // Standing in the road right in front of the bumper, facing the car.
  ped.x = ped.px = v.x + Math.cos(v.heading) * (v.spec.length / 2 + 0.6);
  ped.z = ped.pz = v.z + 0.4;
  ped.heading = ped.pheading = Math.PI;
  ped.bumpBy = v;
  ped.bumpV = Math.hypot(v.vx, v.vz);
  g.input.throttle = 0.4;
  for (let i = 0; i < 21; i++) {
    v.controls = null;
    g.step(1 / 60);
  }
  window.__ped = ped;
  const s = ped.rag;
  return { ok: !!s, y: ped.y, cy: s && s.y, pitch: s && s.pitch, x: ped.x, z: ped.z, carX: v.x, carZ: v.z, life: ped.life };
});
console.log('ram', JSON.stringify(ram));
await page.evaluate((r) => {
  window.__shot.draw([r.x + 0.8, 1.9, r.z + 6.2, r.x - 0.6, 1.5, r.z]);
}, ram);
await page.waitForTimeout(200);
await page.screenshot({ path: 'docs/preview/ragdoll-hood.png' });

// --- 2. Stunt ramp: one jump for the toast, then the car in the air. ---
// Drive to the ramp first and let the district banner fade.
await page.evaluate(() => {
  const g = window.__rw;
  const v = g.player.vehicle;
  const spot = g.stunts.spots.find((s) => s.id === 'stunt_dock_kicker') || g.stunts.spots[0];
  window.__shot.place(v, spot.x - spot.ax * 60, spot.z - spot.az * 60, spot.heading, 0);
  for (let i = 0; i < 10; i++) g.step(1 / 60);
  window.__shot.draw(null);
});
await page.waitForTimeout(4500);
const jump = await page.evaluate(() => {
  const g = window.__rw;
  const v = g.player.vehicle;
  g.input.throttle = 0;
  const spot = g.stunts.spots.find((s) => s.id === 'stunt_dock_kicker') || g.stunts.spots[0];
  const at = (d) => [spot.x - spot.ax * d, spot.z - spot.az * d];
  // The player jumps first (the toast comes on landing); a second car
  // follows a little behind and is in the air when the toast shows.
  window.__shot.place(v, ...at(45), spot.heading, 27);
  const c2 = g.debug.spawnCar('sedan', ...at(80), spot.heading);
  c2.controls = { steer: 0, throttle: 1, brake: 0, handbrake: false };
  window.__shot.place(c2, ...at(80), spot.heading, 27);
  let flew = false, n = 0;
  while (n < 600) {
    g.input.throttle = 1;
    g.step(1 / 60);
    n++;
    if (v.air && v.air.on) flew = true;
    else if (flew) break;
  }
  g.input.throttle = 0;
  while (!(c2.air && c2.air.on && c2.air.t > 0.2) && n < 900) {
    g.step(1 / 60);
    n++;
  }
  return {
    id: spot.id, medal: g.progress.medals[spot.id], sx: spot.x, x: c2.x, y: c2.y, z: c2.z, pitch: c2.airPitch,
    toast: [...document.querySelectorAll('.rw-toast')].map((e) => e.textContent),
  };
});
console.log('jump', JSON.stringify(jump));
await page.evaluate((j) => {
  window.__shot.draw([j.sx + 1, 2.6, j.z + 12.5, j.x + 1, j.y * 0.55, j.z]);
}, jump);
await page.waitForTimeout(150);
await page.screenshot({ path: 'docs/preview/stunt-jump.png' });

await browser.close();
server.close();
console.log(bad ? `errors: ${bad}` : 'no errors');
process.exit(bad ? 1 : 0);
