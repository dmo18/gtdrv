// Renders vehicle line-ups and effect action shots in headless Chromium
// (SwiftShader) to check the vehicle models and effects by eye.
// Usage: node scripts/vehicle-shots.mjs [shotName ...]
// Output: dist/vehicle-shots/<shot>.png and triangle / draw-call stats.
//
// --game renders inside the real game instead (its sky, light, tone
// mapping and street). Shot names there: g:<id>:<view>[:<hour>[:<state>]]
// with view front | side | rear | top, state hurt | burnt | brake, and
// g:street:<hour> (ten cars 20 to 50 m ahead of the chase camera).
// Example: node scripts/vehicle-shots.mjs --game --size=915x412 g:sedan:front:11
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

let chromium;
try {
  ({ chromium } = await import('playwright'));
} catch {
  ({ chromium } = createRequire('/opt/node-tools/node_modules/')('playwright'));
}

// --size=WxH renders at that canvas size (default 1280x720); --out=DIR
// copies the pictures there as well.
const opt = (k) => (process.argv.find((a) => a.startsWith('--' + k + '=')) || '').split('=')[1];
const [CW, CH] = (opt('size') || '1280x720').split('x').map(Number);
const copyTo = opt('out');
const names = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const out = join(root, 'dist', 'vehicle-shots');
await mkdir(out, { recursive: true });
if (process.argv.includes('--game')) {
  await gameShots();
  process.exit(0);
}
// --compare=before.png,after.png,out.png stacks two pictures with labels.
if (opt('compare')) {
  await compare(...opt('compare').split(','));
  process.exit(0);
}
await build({
  entryPoints: [join(root, 'scripts', 'vehicle-shots-entry.js')],
  bundle: true,
  format: 'esm',
  target: 'es2020',
  outfile: join(out, 'harness.js'),
  logLevel: 'warning',
});
await writeFile(join(out, 'index.html'), '<!doctype html><html><body style="margin:0;background:#000"><canvas id="c"></canvas><script type="module" src="harness.js"></script></body></html>');

const server = createServer(async (req, res) => {
  try {
    const name = new URL(req.url, 'http://x').pathname.endsWith('/harness.js') ? 'harness.js' : 'index.html';
    const data = await readFile(join(out, name));
    res.writeHead(200, { 'content-type': name.endsWith('.js') ? 'text/javascript' : 'text/html', 'cache-control': 'no-store' });
    res.end(data);
  } catch {
    res.writeHead(404);
    res.end('not found');
  }
});
await new Promise((ok) => server.listen(0, '127.0.0.1', ok));

const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
let failed = false;
try {
  const page = await browser.newPage({ viewport: { width: CW, height: CH }, deviceScaleFactor: 1 });
  page.on('pageerror', (e) => {
    failed = true;
    console.error('page error:', e.message);
  });
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') console.error('console:', m.text());
  });
  await page.goto(`http://127.0.0.1:${server.address().port}/?w=${CW}&h=${CH}`);
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 60000 });
  const all = await page.evaluate(() => window.shotNames);
  const want = names.length ? names : all;
  console.log('triangles per car:', JSON.stringify(await page.evaluate(() => window.stats())));
  for (const name of want) {
    const t0 = Date.now();
    const r = await page.evaluate((n) => window.shot(n), name);
    const file = join(out, name + '.png');
    await page.locator('#c').screenshot({ path: file });
    if (copyTo) await copyFile(file, join(resolve(copyTo), name + '.png'));
    console.log(name, r ? JSON.stringify(r) : '', `${Date.now() - t0} ms ->`, file);
  }
} finally {
  await browser.close();
  server.close();
}
if (failed) process.exit(1);

// ---- shots inside the running game ----------------------------------------------
async function gameShots() {
  const { buildGame, serve } = await import('./build.mjs');
  await buildGame({ minify: false });
  const server = await serve(0);
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  try {
    const page = await browser.newPage({ viewport: { width: CW, height: CH }, deviceScaleFactor: 1 });
    page.on('pageerror', (e) => console.error('page error:', e.message));
    await page.goto(`http://127.0.0.1:${server.address().port}/?autostart`);
    await page.waitForFunction(() => window.__rw && window.__rw.loop.running, null, { timeout: 60000 });
    await page.waitForTimeout(3000);
    // Only the 3D view: hide the HUD and touch controls.
    await page.evaluate(() => window.__rw.renderer.domElement.setAttribute('data-main', '1'));
    await page.addStyleTag({ content: '* { visibility: hidden !important; } canvas[data-main] { visibility: visible !important; }' });
    for (const name of names) {
      const parts = name.split(':');
      if (parts[1] === 'street') parts.splice(2, 0, 'street');
      const [, id, view, hour = '11', state = ''] = parts;
      // Set the scene up with the loop running (sky, light and lamps follow
      // the hour), then freeze it and frame the shot.
      await page.evaluate(({ id, view, hour, state }) => {
        const g = window.__rw;
        if (!g.loop.running) g.loop.start();
        g.daynight.setHour(+hour);
        for (const v of window.__show || []) g.removeVehicle(v);
        window.__show = [];
        const p0 = g.player.vehicle || g.player;
        const p = window.__base || { x: p0.x, z: p0.z, heading: p0.heading };
        const h = p.heading, fx = Math.cos(h), fz = Math.sin(h), rx = -Math.sin(h), rz = Math.cos(h);
        const put = (sid, d, side, hh) => {
          const v = g.debug.spawnCar(sid, p.x + fx * d + rx * side, p.z + fz * d + rz * side, hh);
          window.__show.push(v);
          return v;
        };
        if (g.player.vehicle) {
          // Park the player's own car out of the way.
          const pv = g.player.vehicle;
          pv.x = pv.px = p.x - fx * 60;
          pv.z = pv.pz = p.z - fz * 60;
        }
        window.__base = { x: p.x, z: p.z, heading: h, h };
        // Clear passing traffic out of the frame.
        for (const v of g.vehicles.slice()) {
          if (v === g.player.vehicle || v.kind !== 'car') continue;
          if (Math.hypot(v.x - p.x, v.z - p.z) < 70) g.removeVehicle(v);
        }
        if (id === 'street') {
          const ids = ['compact', 'sedan', 'taxi', 'police', 'sports', 'muscle', 'ghostwake', 'pickup', 'van', 'truck'];
          ids.forEach((sid, k) => put(sid, 14 + k * 3.4, (k % 2 ? 1 : -1) * (1.8 + (k % 3) * 1.6), h + (k % 2 ? 0 : Math.PI)));
        } else {
          const v = put(id, 12, 0, h + Math.PI / 2);
          if (state === 'hurt') {
            v.health = v.spec.health * 0.3;
          } else if (state === 'burnt') {
            v.health = 0;
            v.wrecked = true;
          } else if (state === 'brake') {
            v.brake = 1;
            v.driver = { dead: false, debug: true };
          }
        }
      }, { id, view, hour, state });
      await page.waitForTimeout(1600);
      const r = await page.evaluate(({ id, view, state }) => {
        const g = window.__rw;
        g.loop.stop();
        const b = window.__base;
        const fx = Math.cos(b.h), fz = Math.sin(b.h), rx = -Math.sin(b.h), rz = Math.cos(b.h);
        const cam = g.camera;
        if (g.player.vehicle && g.player.vehicle.mesh) g.player.vehicle.mesh.visible = false;
        for (const v of window.__show) {
          if (state === 'hurt') {
            const mesh = v.mesh;
            // Two hits: a front corner and the near side.
            mesh.userData.hits[0].set(0.8, 0, 0.6, 1);
            mesh.userData.hits[1].set(0, 0, -1, 0.9);
            mesh.userData.crushF = 0.22;
            mesh.userData.hitDirty = true;
          }
          g.kinds.car.updateMesh(v.mesh, v, 1, g.time);
        }
        if (id === 'street') {
          cam.fov = 55;
          cam.position.set(b.x - fx * 6, 2.4, b.z - fz * 6);
          cam.lookAt(b.x + fx * 30, 0.8, b.z + fz * 30);
        } else {
          const v = window.__show[0];
          const L = v.spec.length;
          // Car centre, its own forward (heading) and the view direction.
          const cx = v.x, cz = v.z, ch = v.heading;
          const az = view === 'side' ? Math.PI / 2 : view === 'rear' ? Math.PI + 0.62 : view === 'top' ? -0.5 : 0.62;
          const a = ch + az;
          const d = L * 0.95 + 1.8;
          const up = view === 'top' ? L * 0.8 : v.spec.height * 0.62 + 0.3;
          cam.fov = 36;
          cam.position.set(cx + Math.cos(a) * d, up, cz + Math.sin(a) * d);
          cam.lookAt(cx, v.spec.height * 0.42, cz);
          void rx; void rz;
        }
        cam.updateProjectionMatrix();
        cam.updateMatrixWorld();
        g.renderer.info.reset();
        if (g.renderFrame) g.renderFrame(1 / 60);
        else g.renderer.render(g.scene, cam);
        return { calls: g.renderer.info.render.calls, tris: g.renderer.info.render.triangles };
      }, { id, view, state });
      const file = join(out, name.replace(/:/g, '-') + '.png');
      await page.locator('canvas[data-main]').screenshot({ path: file });
      if (copyTo) await copyFile(file, join(resolve(copyTo), name.replace(/:/g, '-') + '.png'));
      console.log(name, JSON.stringify(r), '->', file);
    }
  } finally {
    await browser.close();
    server.close();
  }
}

async function compare(a, b, dest) {
  const url = async (f) => 'data:image/png;base64,' + (await readFile(resolve(f))).toString('base64');
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: CW, height: CH * 2 }, deviceScaleFactor: 1 });
    const cell = (src, label) => `<div style="position:relative;width:${CW}px;height:${CH}px;overflow:hidden"><img src="${src}" style="width:${CW}px;height:${CH}px;display:block"><span style="position:absolute;left:10px;top:8px;font:bold 18px sans-serif;color:#fff;background:rgba(0,0,0,.55);padding:2px 8px">${label}</span></div>`;
    await page.setContent(`<body style="margin:0">${cell(await url(a), 'before')}${cell(await url(b), 'after')}</body>`);
    await page.screenshot({ path: resolve(dest) });
    console.log('compare ->', resolve(dest));
  } finally {
    await browser.close();
  }
}
