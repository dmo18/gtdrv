// Developer helper: close-up screenshots of the boats, aircraft and tanks
// in the real game at phone size (915 x 412), daylight, saved to
// docs/preview/craft-<name>.png, with draw calls per shot.
// usage: node scripts/craft-shots.mjs [name ...]   (no names: all shots)
import { createRequire } from 'node:module';
import { mkdir, readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, join, normalize } from 'node:path';
import { buildGame } from './build.mjs';

let chromium;
try {
  ({ chromium } = await import('playwright'));
} catch {
  ({ chromium } = createRequire('/opt/node-tools/node_modules/')('playwright'));
}
const want = process.argv.slice(2).filter((a) => !a.startsWith('-'));
// Own build folder: other scripts rebuild dist/ while this one runs.
const outDir = join(process.cwd(), 'build', 'craft-shots');
await buildGame({ minify: false, outDir });
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json' };
const server = createServer(async (req, res) => {
  try {
    let p = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname));
    if (p.endsWith('/')) p += 'index.html';
    const file = join(outDir, p);
    if (!file.startsWith(outDir)) throw new Error('outside');
    const data = await readFile(file);
    res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream' });
    res.end(data);
  } catch {
    res.writeHead(404);
    res.end();
  }
});
await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
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

await page.evaluate(() => {
  const g = window.__rw;
  g.loop.stop();
  const p = g.player;
  if (p.vehicle) {
    const v = p.vehicle;
    p.walker.x = p.walker.px = v.x + 3;
    p.walker.z = p.walker.pz = v.z + 3;
    v.driver = null;
    p.vehicle = null;
    g.setPlayerMode('foot');
  }
  g.daynight.setHour(15);
  g.daynight.setWeather('clear', true);
  g.step(1 / 60);
  const hud = document.querySelectorAll('body > div');
  for (const d of hud) d.style.visibility = 'hidden';
  const S = {
    pick(id) {
      return g.vehicles.find((v) => v.spec.id === id);
    },
    // Open sea: walk out from (x, z) until well off shore.
    sea(x, z) {
      for (let r = 0; r < 3000; r += 20) {
        for (let k = 0; k < 16; k++) {
          const a = (k / 16) * Math.PI * 2;
          const px = x + Math.cos(a) * r, pz = z + Math.sin(a) * r;
          if (g.city.shoreDist(px, pz) < -120 && g.city.shoreDist(px + 150, pz) < -60 && g.city.shoreDist(px - 150, pz) < -60) return [px, pz];
        }
      }
      return [x, z];
    },
    place(v, x, y, z, h) {
      v.x = v.px = x;
      v.z = v.pz = z;
      v.y = v.py = y;
      v.heading = v.pheading = h;
      v.asleep = false;
      v.meshDirty = true;
    },
    // Camera in the craft frame: fwd, up, side (right +), looking at a
    // point (lf, lu, ls) in the same frame.
    cam(v, f, u, s, lf = 0, lu = 1, ls = 0) {
      const c = Math.cos(v.heading), sn = Math.sin(v.heading);
      const y0 = v.kind === 'boat' ? -0.6 : 0;
      const wx = (a, b) => v.x + c * a - sn * b, wz = (a, b) => v.z + sn * a + c * b;
      S.camPos = [wx(f, s), (v.y || 0) + y0 + u, wz(f, s), wx(lf, ls), (v.y || 0) + y0 + lu, wz(lf, ls)];
    },
    render(fov = 45) {
      g.draw(1, 1 / 60);
      const c = S.camPos;
      g.camera.fov = fov;
      g.camera.updateProjectionMatrix();
      g.camera.position.set(c[0], c[1], c[2]);
      g.camera.lookAt(c[3], c[4], c[5]);
      g.camera.updateMatrixWorld();
      g.renderFrame(0);
      return g.renderer.info.render.calls;
    },
  };
  window.__S = S;
});

const SHOTS = {
  fighter: () => {
    const v = S.pick('fighter');
    S.cam(v, 9, 2.6, 7, 0, 1.6, 0);
    return S.render(42);
  },
  'fighter-rear': () => {
    const v = S.pick('fighter');
    v.engineOn = true;
    S.cam(v, -12, 3.5, -6, 0, 1.8, 0);
    return S.render(40);
  },
  'fighter-afterburner': () => {
    const v = S.pick('fighter');
    v.mesh.userData.rig.gear = 1;
    v.onGround = false;
    v.engineOn = true;
    v.afterburner = 1;
    v.driver = 'player';
    v.steer = 0.4;
    v.roll = v.proll = 0.35;
    v.pitch = v.ppitch = 0.08;
    v.airspeed = 120;
    S.place(v, v.x, 160, v.z, v.heading);
    S.cam(v, -13, 3.2, 7.5, 0, 0.5, 0);
    return S.render(40);
  },
  'fighter-top': () => {
    const v = S.pick('fighter');
    v.afterburner = 0.0;
    v.roll = v.proll = -0.5;
    S.cam(v, -4, 9, -9, 0, 0, 0);
    return S.render(48);
  },
  prop: () => {
    const v = S.pick('prop');
    S.cam(v, 7, 2.2, 6, 0, 1.2, 0);
    return S.render(44);
  },
  'prop-flight': () => {
    const v = S.pick('prop');
    v.onGround = false;
    v.engineOn = true;
    v.driver = 'player';
    v.airspeed = 50;
    v.roll = v.proll = 0.25;
    S.place(v, v.x, 120, v.z, v.heading);
    S.cam(v, 6, 1.5, 8.5, 0, 0, 0);
    return S.render(44);
  },
  stunt: () => {
    const v = S.pick('stunt');
    S.cam(v, 6, 2.0, -5.5, 0, 1.2, 0);
    return S.render(44);
  },
  seaplane: () => {
    const v = S.pick('seaplane');
    S.cam(v, 8, 2.5, 8, 0, 1.6, 0);
    return S.render(44);
  },
  jet: () => {
    const v = S.pick('jet');
    S.cam(v, 11, 3.0, 9, 0, 1.6, 0);
    return S.render(44);
  },
  heli: () => {
    const v = S.pick('heli');
    S.cam(v, 6, 2.4, 6, 0, 1.4, 0);
    return S.render(46);
  },
  'heli-flight': () => {
    const v = S.pick('heli');
    v.onGround = false;
    v.engineOn = true;
    v.rotorSpeed = 1;
    v.driver = 'player';
    S.place(v, v.x, 60, v.z, v.heading);
    v.pitch = v.ppitch = -0.12;
    S.cam(v, 8, 1.5, 9, 0, 1.4, 0);
    return S.render(46);
  },
  heavyheli: () => {
    const v = S.pick('heavyheli');
    S.cam(v, 11, 3.5, 10, 0, 2.0, 0);
    return S.render(46);
  },
  patrolheli: () => {
    const v = S.pick('patrolheli');
    S.cam(v, 7, 2.0, -6.5, 0, 1.5, 0);
    return S.render(46);
  },
  'patrolheli-flight': () => {
    const v = S.pick('patrolheli');
    v.onGround = false;
    v.engineOn = true;
    v.rotorSpeed = 1;
    v.siren = true;
    v.spot = 1;
    v.driver = 'player';
    S.place(v, v.x, 45, v.z, v.heading);
    v.pitch = v.ppitch = -0.1;
    v.roll = v.proll = 0.15;
    S.cam(v, 9, 2.5, -8, 0, 0.5, 0);
    return S.render(48);
  },
  tank: () => {
    const v = S.pick('rustback');
    S.cam(v, 8, 2.6, 7, 0, 1.3, 0);
    return S.render(44);
  },
  'tank-rear': () => {
    const v = S.pick('rustback');
    S.cam(v, -8, 3.4, -6, 0, 1.3, 0);
    return S.render(44);
  },
  'tank-fire': () => {
    const v = S.pick('rustback');
    const g = window.__rw;
    v.turretYaw = v.pturretYaw = 0.4;
    v.gunPitch = v.pgunPitch = 0.06;
    const a = v.heading + 0.4;
    g.combat.fireMount(v, 0, Math.cos(a), 0.06, Math.sin(a), null, null);
    for (let i = 0; i < 3; i++) g.step(1 / 60);
    S.cam(v, 2, 3.0, -11, 4, 2.0, 2);
    return S.render(48);
  },
};
/* global S */
// Boats: moved out to open sea and run along at speed for 3 s so the
// wake trail builds up.
const BOATS = { speedboat: [26, -7, 4.2, 6], jetski: [20, -4, 2.2, 3.5], fisher: [9, -14, 6, 12], yacht: [12, -20, 7, 16], dinghy: [10, -5, 2, 4] };
const ARGS = {};
for (const [id, [spd, back, up, side]] of Object.entries(BOATS)) {
  ARGS['boat-' + id] = ARGS['boat-' + id + '-wake'] = { id, spd, back, up, side };
  SHOTS['boat-' + id] = ({ id, spd, back, up, side }) => {
    const g = window.__rw;
    const v = S.pick(id);
    const [x, z] = S.sea(v.x, v.z);
    S.place(v, x, 0, z, 0.3);
    v.throttle = 1;
    v.speed = spd;
    v.wake = 1;
    v.pitch = v.ppitch = id === 'speedboat' || id === 'jetski' ? 0.06 : 0.02;
    const rf = g.renderFrame;
    g.renderFrame = () => {};
    for (let i = 0; i < 180; i++) {
      v.px = v.x;
      v.pz = v.z;
      v.x += Math.cos(v.heading) * spd / 60;
      v.z += Math.sin(v.heading) * spd / 60;
      v.meshDirty = true;
      g.time += 1 / 60;
      g.draw(1, 1 / 60);
    }
    g.renderFrame = rf;
    S.cam(v, -back * 0.2, up, side, 0, 0.6, 0);
    return S.render(48);
  };
  SHOTS['boat-' + id + '-wake'] = ({ id, back, up, side }) => {
    const v = S.pick(id);
    S.cam(v, back * 1.8, up * 2.2, side * 0.8, back * 2.5, 0, 0);
    return S.render(55);
  };
}
const names = want.length ? want : Object.keys(SHOTS);
for (const n of names) {
  if (!SHOTS[n]) {
    console.log('unknown shot', n);
    continue;
  }
  const calls = await page.evaluate(`(() => { const S = window.__S; return (${SHOTS[n].toString()})(${JSON.stringify(ARGS[n] || {})}); })()`);
  await page.screenshot({ path: `docs/preview/craft-${n}.png` });
  console.log(n, 'calls', calls);
}
console.log(bad ? `FAIL ${bad} errors` : 'ok');
await browser.close();
server.close();
process.exit(bad ? 1 : 0);
