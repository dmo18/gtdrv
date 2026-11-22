// Developer helper: the police helicopter at 915x412, day and night, to
// docs/preview/heli-*.png. The heli about 60 m out in the car chase view
// with its searchlight on the player, the light pool on the street, the
// far chase view, the heli landed with the ENTER prompt, and a wreck
// falling after a hit. usage: node scripts/heli-shots.mjs [name ...]
import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';
import { buildGame, serve } from './build.mjs';

let chromium;
try {
  ({ chromium } = await import('playwright'));
} catch {
  ({ chromium } = createRequire('/opt/node-tools/node_modules/')('playwright'));
}
const only = process.argv.slice(2);
await buildGame({ minify: false });
const server = await serve(0);
await mkdir('docs/preview', { recursive: true });
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
let bad = 0;

async function shot(name, hour, setup) {
  if (only.length && !only.includes(name)) return;
  const page = await browser.newPage({ viewport: { width: 915, height: 412 }, deviceScaleFactor: 1 });
  page.on('pageerror', (e) => { bad++; console.log('pageerror', String(e)); });
  page.on('console', (m) => { if (m.type() === 'error') { bad++; console.log('console.error', m.text().slice(0, 300)); } });
  await page.goto(`http://127.0.0.1:${server.address().port}/?autostart`);
  await page.waitForFunction(() => window.__rw && window.__rw.loop.running, null, { timeout: 60000 });
  await page.waitForTimeout(2500);
  const info = await page.evaluate(([hour, src]) => {
    const g = window.__rw;
    g.loop.stop();
    g.daynight.setWeather('clear', true);
    g.daynight.setHour(hour);
    // Steps, drawing only every 15th and the last few (software GL is slow).
    const frames = (n) => { for (let i = 0; i < n; i++) { g.step(1 / 60); if (i % 15 === 14 || i >= n - 3) g.draw(1, 1 / 60); } };
    // A heli held in a hover at (dist along the camera, side, up) from the player.
    const heliAt = (dist, side, up, target) => {
      const h = g.camHeading, p = g.player;
      const x = p.x + Math.cos(h) * dist - Math.sin(h) * side, z = p.z + Math.sin(h) * dist + Math.cos(h) * side;
      const pilot = g.helipilot.spawn({ x, z, y: up, target: target || p });
      g.helipilot.setOrder(pilot, 'hover', { x, z, y: up });
      pilot.craft.spot = 1;
      return pilot;
    };
    const r = new Function('g', 'frames', 'heliAt', src)(g, frames, heliAt);
    g.draw(1, 1 / 60);
    // The tutorial tips sit over the top of the view: hide them here.
    for (const e of document.querySelectorAll('.rw-toasts')) e.style.visibility = 'hidden';
    return r || null;
  }, [hour, setup]);
  await page.waitForTimeout(200);
  await page.screenshot({ path: `docs/preview/heli-${name}.png`, timeout: 120000 });
  console.log(name, JSON.stringify(info));
  await page.close();
}

// Player car parked on its spawn street, chase view; heli 60 m ahead.
const CHASE = `
  frames(30);
  const p = heliAt(60, 7, 20);
  frames(150);
  // Side on, as it is on its orbit (the hover faces the target).
  p.craft.heading = p.craft.pheading = g.camHeading + 1.9;
  frames(1);
  p.craft.heading = p.craft.pheading = g.camHeading + 1.9;
  const a = p.craft, P = a.mesh.position.clone().project(g.camera);
  return { d: Math.hypot(a.x - g.player.x, a.z - g.player.z).toFixed(1), y: a.y.toFixed(1), ndc: [P.x.toFixed(2), P.y.toFixed(2)], spot: a.spot, lod: a.mesh.userData.lod.getCurrentLevel(), calls: g.graphics.calls };
`;
await shot('chase-day', 14, CHASE);
await shot('chase-night', 22.5, CHASE);
// The pool on the street: the beam aimed at a point ahead of the car.
const STREET = `
  g.exitVehicle();
  const car = g.vehicles.find((v) => v.home && v.home.craft === v) || null;
  frames(30);
  const h = g.camHeading, pl = g.player;
  // Park the car out of the way (its headlights would light the street too).
  for (const v of g.vehicles) if (v.kind === 'car' && Math.hypot(v.x - pl.x, v.z - pl.z) < 12) { v.x = v.px = pl.x - Math.cos(h) * 30; v.z = v.pz = pl.z - Math.sin(h) * 30; }
  const spotAt = { x: pl.x + Math.cos(h) * 16 - Math.sin(h) * 3, z: pl.z + Math.sin(h) * 16 + Math.cos(h) * 3, y: 0 };
  const p = heliAt(70, 7, 24, spotAt);
  frames(150);
  const sw = p.craft.mesh.userData.spotW;
  return { spot: p.craft.spot, y: p.craft.y.toFixed(1), sw: [sw.on, sw.x.toFixed(0), sw.y.toFixed(0), sw.z.toFixed(0), sw.dy.toFixed(2), sw.len.toFixed(0)], at: [spotAt.x.toFixed(0), spotAt.z.toFixed(0)] };
`;
await shot('street-night', 22.5, STREET);
await shot('street-day', 14, STREET);
// Far chase view (VIEW once), heli about 100 m out.
const FAR = `
  g.chase.cycleView();
  frames(30);
  const p = heliAt(95, 0, 26);
  frames(150);
  p.craft.heading = p.craft.pheading = g.camHeading + 1.9;
  frames(1);
  p.craft.heading = p.craft.pheading = g.camHeading + 1.9;
  const a = p.craft;
  const P = a.mesh.position.clone().project(g.camera);
  return { d: Math.hypot(a.x - g.player.x, a.z - g.player.z).toFixed(1), y: a.y.toFixed(1), ndc: [P.x.toFixed(2), P.y.toFixed(2)], lod: a.mesh.userData.lod.getCurrentLevel() };
`;
await shot('far-day', 14, FAR);
await shot('far-night', 22.5, FAR);
// Landed beside the player on foot: the ENTER prompt.
const LANDED = `
  g.exitVehicle();
  frames(40);
  const w = g.player.walker, h = g.camHeading;
  const x = w.x + Math.cos(h) * 9, z = w.z + Math.sin(h) * 9;
  const p = heliAt(9, 0, 12);
  g.helipilot.setOrder(p, 'land', { x, z });
  for (let i = 0; i < 60 * 14 && p.state !== 'landed'; i++) g.step(1 / 60);
  g.helipilot.setOrder(p, 'leave');
  p.state = 'landed';
  w.x = x - Math.cos(h) * 5.5; w.z = z - Math.sin(h) * 5.5;
  frames(20);
  return { state: p.state, near: g.player.near && g.player.near.spec.id, prompt: document.querySelector('.rw-prompt') ? document.querySelector('.rw-prompt').textContent : null };
`;
await shot('landed-day', 14, LANDED);
// Shot down: a hit wrecks it, it falls spinning with smoke.
const WRECK = `
  frames(30);
  const p = heliAt(55, 4, 30);
  frames(90);
  g.combat.damage ? g.combat.damage(p.craft, 10000, g.player.vehicle, 'blast') : null;
  const a = p.craft;
  if (!a.wrecked) { a.health = 0; a.wrecked = true; }
  frames(60);
  // Every frame drawn for the last half second (smoke and fire fill in).
  for (let i = 0; i < 30; i++) { g.step(1 / 60); g.draw(1, 1 / 60); }
  const P = a.mesh.position.clone().project(g.camera);
  return { state: p.state, y: a.y.toFixed(1), wrecked: a.wrecked, ndc: [P.x.toFixed(2), P.y.toFixed(2)] };
`;
await shot('wreck-day', 14, WRECK);
await shot('wreck-night', 22.5, WRECK);
console.log(bad ? 'FAIL errors ' + bad : 'ok');
await browser.close();
server.close();
