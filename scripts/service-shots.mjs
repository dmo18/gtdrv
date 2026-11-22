// Screenshots of the service vehicles in the real game (docs/REVAMP.md
// 6.11, V1): each of the five by day (front three-quarter, 8 m), each at
// night with its lamps in a lit phase, and the extras at work (the water
// jet on a burning hull, the bin at the top of the lift, a car on the hook
// in a corner, the ambulance beside a body before and after).
// Usage: node scripts/service-shots.mjs [--size=915x412] [shot ...]
// Output: docs/preview/v1-<shot>.png
import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

let chromium;
try {
  ({ chromium } = await import('playwright'));
} catch {
  ({ chromium } = createRequire('/opt/node-tools/node_modules/')('playwright'));
}
const opt = (k) => (process.argv.find((a) => a.startsWith('--' + k + '=')) || '').split('=')[1];
const [CW, CH] = (opt('size') || '915x412').split('x').map(Number);
const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const out = join(root, 'docs', 'preview');
await mkdir(out, { recursive: true });
const IDS = ['firetruck', 'ambulance', 'garbage', 'towtruck', 'police'];
const ALL = [...IDS.map((id) => id + '-day'), ...IDS.map((id) => id + '-night'), 'jet', 'binlift', 'tow', 'treat-before', 'treat-after', 'pair'];
const want = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const shots = want.length ? want : ALL;

const { buildGame, serve } = await import('./build.mjs');
await buildGame({ minify: false });
const server = await serve(0);
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
let failed = false;
try {
  const page = await browser.newPage({ viewport: { width: CW, height: CH }, deviceScaleFactor: 1 });
  page.on('pageerror', (e) => { failed = true; console.error('page error:', e.message, (e.stack || '').split('\n').slice(0, 4).join(' | ')); });
  await page.goto(`http://127.0.0.1:${server.address().port}/?autostart`);
  await page.waitForFunction(() => window.__rw && window.__rw.loop.running, null, { timeout: 60000 });
  await page.waitForTimeout(3000);
  await page.evaluate(() => window.__rw.renderer.domElement.setAttribute('data-main', '1'));
  await page.addStyleTag({ content: '* { visibility: hidden !important; } canvas[data-main] { visibility: visible !important; }' });
  for (const name of shots) {
    const [subject, mode] = name.split('-');
    const night = mode === 'night';
    // Set up with the loop running, so sky, lamps and systems settle.
    await page.evaluate(({ subject, night }) => {
      const g = window.__rw;
      if (!g.loop.running) g.loop.start();
      g.daynight.setHour(night ? 21.5 : subject === 'jet' ? 17.2 : 11);
      g.input.release('extra');
      for (const v of window.__show || []) if (!v.removed && v !== g.player.vehicle) g.removeVehicle(v);
      window.__show = [];
      const p0 = g.player.vehicle || g.player;
      const b = window.__base || (window.__base = { x: p0.x, z: p0.z, h: p0.heading });
      const fx = Math.cos(b.h), fz = Math.sin(b.h), rx = -Math.sin(b.h), rz = Math.cos(b.h);
      for (const v of g.vehicles.slice()) {
        if (v.kind === 'car' && v !== g.player.vehicle && Math.hypot(v.x - b.x, v.z - b.z) < 90) g.removeVehicle(v);
      }
      // The player's own vehicle waits out of the frame, behind the camera.
      const pv = g.player.vehicle;
      if (pv) {
        if (pv.svc && pv.svc.hook) { pv.svc.hook.towedBy = null; pv.svc.hook = null; }
        pv.x = pv.px = b.x - fx * 70;
        pv.z = pv.pz = b.z - fz * 70;
        pv.heading = pv.pheading = b.h;
        pv.vx = pv.vz = pv.speed = 0;
      }
      const put = (sid, d, side, hh) => {
        const v = g.debug.spawnCar(sid, b.x + fx * d + rx * side, b.z + fz * d + rz * side, hh);
        window.__show.push(v);
        return v;
      };
      const drive = (v) => {
        if (g.player.vehicle && g.player.vehicle !== v) g.player.vehicle.driver = null;
        g.enterVehicle(v);
        g.snapCam();
      };
      if (subject === 'jet') {
        const ft = put('firetruck', 10, 1.5, b.h);
        drive(ft);
        const hull = put('sedan', 26, 1.8, b.h + 0.4);
        hull.health = 0; hull.wrecked = true; hull.wreckT = 2;
        window.__subject = ft;
        window.__other = hull;
      } else if (subject === 'binlift') {
        const gt = put('garbage', 10, 0.6, b.h);
        drive(gt);
        g.extraBins = [{ x: gt.x + rx * 2.6, z: gt.z + rz * 2.6 }];
        window.__subject = gt;
      } else if (subject === 'tow') {
        const tt = put('towtruck', 10, 1.5, b.h);
        drive(tt);
        const car = put('sedan', 10 - 6.2, 1.5, b.h);
        window.__subject = tt;
        window.__other = car;
      } else if (subject === 'treat') {
        const am = put('ambulance', 10, 1.8, b.h);
        drive(am);
        window.__subject = am;
      } else if (subject === 'pair') {
        put('firetruck', 16, 2.0, b.h + Math.PI);
        put('ambulance', 26, -2.0, b.h);
        window.__subject = null;
      } else {
        const v = put(subject, 12, 0, b.h + Math.PI / 2);
        if (night) {
          v.siren = true;
          v.beacon = true;
          v.beaconT = 99;
        }
        window.__subject = v;
      }
    }, { subject, night });
    await page.waitForTimeout(1500);
    // Start the extras and let them run in game time.
    await page.evaluate(async ({ subject, mode }) => {
      const g = window.__rw;
      // Game time in fixed steps (the headless renderer is too slow to
      // keep the loop at speed): ms of game time.
      g.loop.stop();
      const wait = async (ms) => { for (let i = 0; i < Math.round(ms * 0.06); i++) g.step(1 / 60); };
      await wait(1000);
      const v = window.__subject;
      if (subject === 'jet') {
        g.input.press('extra');
        await wait(900);
      } else if (subject === 'binlift') {
        g.input.press('extra');
        await wait(30);
        g.input.release('extra');
        await wait(1150);
      } else if (subject === 'tow') {
        g.input.press('extra');
        await wait(30);
        g.input.release('extra');
        await wait(1400);
        // Drive off and into a right-hand corner.
        const src = window.__drv || (window.__drv = g.input.addSource({ steer: 0, throttle: 0, brake: 0 }));
        src.throttle = 0.6;
        await wait(2200);
        src.steer = -0.55;
        await wait(1300);
        src.throttle = 0;
        src.steer = 0;
      } else if (subject === 'treat') {
        // A body lying beside the ambulance (a pedestrian taken down).
        const ped = (g.actors || []).find((a) => a.team === 'civ' && a.life === 'ok');
        if (ped) {
          ped.x = v.x - Math.sin(v.heading) * 3.4;
          ped.z = v.z + Math.cos(v.heading) * 3.4;
          ped.hp = 0;
          ped.life = 'out';
          ped.lifeT = 2;
          window.__ped = ped;
        }
        if (mode === 'after') {
          g.input.press('extra');
          await wait(30);
          g.input.release('extra');
          await wait(2400);
        }
      }
    }, { subject, mode });
    const r = await page.evaluate(({ subject, night }) => {
      const g = window.__rw;
      g.loop.stop();
      const cam = g.camera;
      const v = window.__subject;
      const b = window.__base;
      if (night && v) g.time = Math.ceil(g.time) + 0.05; // a lit phase start of every bar
      for (const c of g.vehicles) if (c.mesh) g.kinds[c.kind].updateMesh(c.mesh, c, 1, g.time);
      for (const s of g.systems) if (s.render && s.name !== 'title') { try { s.render(1, 0); } catch { /* a system that needs a live frame */ } }
      if (subject === 'pair') {
        const fx = Math.cos(b.h), fz = Math.sin(b.h);
        cam.fov = 55;
        cam.position.set(b.x - fx * 4, 2.2, b.z - fz * 4);
        cam.lookAt(b.x + fx * 30, 1.2, b.z + fz * 30);
      } else {
        const L = v.spec.length, H = v.spec.height;
        const view = subject === 'tow' ? -2.2 : subject === 'binlift' ? 0.95 : subject === 'jet' ? 2.05 : subject === 'treat' ? 1.1 : 0.62;
        const a = v.heading + view;
        const d = subject === 'jet' ? 17 : subject === 'tow' ? 12 : night ? Math.max(6.5, L * 0.5 + 3.5) : Math.max(8, L * 0.6 + 4.5);
        cam.fov = subject === 'jet' ? 50 : 42;
        const up = subject === 'jet' ? 5 : subject === 'tow' ? 6 : H * 0.55 + 0.6;
        cam.position.set(v.x + Math.cos(a) * d, up, v.z + Math.sin(a) * d);
        const look = subject === 'jet' ? 8 : subject === 'tow' ? -4 : 0;
        cam.lookAt(v.x + Math.cos(v.heading) * look, H * 0.45, v.z + Math.sin(v.heading) * look);
      }
      cam.updateProjectionMatrix();
      cam.updateMatrixWorld();
      g.renderer.info.reset();
      if (g.renderFrame) g.renderFrame(1 / 60);
      else g.renderer.render(g.scene, cam);
      const s = v && v.svc;
      return {
        calls: g.renderer.info.render.calls, tris: g.renderer.info.render.triangles, time: +g.time.toFixed(2),
        state: s ? { spray: s.spray, jetLen: +(s.jetLen || 0).toFixed(1), lift: +s.lift.toFixed(2), hook: !!s.hook, tank: +s.tank.toFixed(1) } : null,
        hull: window.__other ? { flame: !!window.__other.hullFlame, doused: !!window.__other.doused } : null,
        ped: window.__ped ? window.__ped.life : null,
        look: g.service && g.service.look ? { drops: g.service.look.drops.visible, arm: g.service.look.arm.visible, inScene: !!g.service.look.drops.parent } : null,
      };
    }, { subject, night });
    const file = join(out, 'v1-' + name + '.png');
    await page.locator('canvas[data-main]').screenshot({ path: file });
    console.log(name, JSON.stringify(r), '->', file);
    await page.evaluate(() => {
      const g = window.__rw;
      g.input.release('extra');
      g.extraBins = null;
    });
  }
} finally {
  await browser.close();
  server.close();
}
if (failed) process.exit(1);
