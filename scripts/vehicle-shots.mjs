// Renders vehicle line-ups and effect action shots in headless Chromium
// (SwiftShader) to check the vehicle models and effects by eye.
// Usage: node scripts/vehicle-shots.mjs [shotName ...]
// Output: dist/vehicle-shots/<shot>.png and triangle / draw-call stats.
//
// --game renders inside the real game instead (its sky, light, tone
// mapping and street). Shot names there: g:<id>:<view>[:<hour>[:<state>]]
// with view front | side | rear | top, state hurt | burnt | brake, and
// g:street:<hour>[:tele] (ten cars 20 to 50 m ahead of the chase camera).
// Example: node scripts/vehicle-shots.mjs --game --size=915x412 g:sedan:front:11
//
// --fleet renders the review sheets of the fleet bodies (docs/FLEET.md):
// side, front and three-quarter views of the midsize sedan, full-size SUV
// and crew-cab pickup at L0, L1 and L2, at 915x412 and 2x scale, to
// dist/fleet/ (side.png, front.png, threequarter.png, one sheet per body
// <id>.png, and distance.png: each level at the distance it is drawn).
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
if (process.argv.includes('--fleet')) {
  await fleetShots();
  process.exit(0);
}
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
// --sheet=out.png,a.png,b.png,... lays pictures out two by two.
if (opt('sheet')) {
  const [dest, ...files] = opt('sheet').split(',');
  await sheet(dest, files);
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
      await page.evaluate(({ id, hour, state }) => {
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
      }, { id, hour, state });
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
          // The level switch (graphics.js) ran with the chase camera's last
          // place: draw the posed cars near (a fleet body at L0).
          const ud = v.mesh.userData;
          v.lodFar = false;
          ud.lodDist = false;
          if (ud.fleet) {
            ud.head.visible = false;
            ud.nearLevel = 0;
          }
          ud.head.visible = true;
          g.kinds.car.updateMesh(v.mesh, v, 1, g.time);
        }
        if (id === 'street') {
          // state 'tele': a long lens, so the 20 to 50 m cars fill the frame.
          cam.fov = state === 'tele' ? 26 : 55;
          cam.position.set(b.x - fx * 6, 2.4, b.z - fz * 6);
          cam.lookAt(b.x + fx * 30, 0.8, b.z + fz * 30);
        } else {
          const v = window.__show[0];
          const L = v.spec.length;
          // Car center, its own forward (heading) and the view direction.
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

async function sheet(dest, files) {
  const url = async (f) => 'data:image/png;base64,' + (await readFile(resolve(f))).toString('base64');
  const rows = Math.ceil(files.length / 2);
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: CW * 2, height: CH * rows }, deviceScaleFactor: 1 });
    let html = '<body style="margin:0;display:flex;flex-wrap:wrap;width:' + CW * 2 + 'px;background:#000">';
    for (const f of files) html += `<img src="${await url(f)}" style="width:${CW}px;height:${CH}px;display:block">`;
    await page.setContent(html + '</body>');
    await page.screenshot({ path: resolve(dest) });
    console.log('sheet ->', resolve(dest));
  } finally {
    await browser.close();
  }
}

// ---- fleet review sheets (--fleet) ----------------------------------------------
// The harness is bundled from the string below (no separate entry file):
// one canvas the page's size, tiles drawn with the scissor, labels as HTML.
function fleetHarness() {
  return `
import * as THREE from 'three';
import { VEHICLE_SPECS, createVehicle } from './src/entities/vehicle.js';
import { createVehicleMesh, updateVehicleMesh, setVehicleLod, setVehicleNearLevel, vehicleStats } from './src/render/vehiclemesh.js';
import { FLEET_MODELS } from './src/render/carbody.js';
const W = innerWidth, H = innerHeight;
const canvas = document.getElementById('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(devicePixelRatio);
renderer.setSize(W, H);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.1;
renderer.autoClear = false;
const SKY = 0xb4d3ea;
const scene = new THREE.Scene();
scene.fog = new THREE.Fog(SKY, 400, 1400);
scene.add(new THREE.HemisphereLight(0xe4f1ff, 0x6a6458, 1.25));
const sun = new THREE.DirectionalLight(0xfff0d8, 2.5);
sun.position.set(0.5, 1, 0.45);
scene.add(sun);
{
  const s = new THREE.Scene();
  s.add(new THREE.Mesh(new THREE.SphereGeometry(10, 48, 24), new THREE.ShaderMaterial({ side: THREE.BackSide,
    vertexShader: 'varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: 'varying vec3 vP; void main(){ vec3 d = normalize(vP); float h = d.y; vec3 sky = mix(vec3(0.8,0.87,0.93), vec3(0.3,0.5,0.8), smoothstep(0.0,0.6,h)); vec3 g = mix(vec3(0.4,0.39,0.37), vec3(0.2), smoothstep(0.0,-0.4,h)); vec3 c = h > 0.0 ? sky : g; c = mix(c, vec3(0.3,0.32,0.35), step(0.0,h) * step(h,0.07) * step(0.2, sin(atan(d.z,d.x) * 19.0)) * 0.6); gl_FragColor = vec4(c,1.0); }' })));
  const pm = new THREE.PMREMGenerator(renderer);
  scene.environment = pm.fromScene(s, 0.01).texture;
  scene.environmentIntensity = 0.8;
}
const ground = new THREE.Mesh(new THREE.PlaneGeometry(2000, 2000), new THREE.MeshLambertMaterial({ color: 0x5d6064 }));
ground.rotation.x = -Math.PI / 2;
scene.add(ground);
const cam = new THREE.PerspectiveCamera(30, 1, 0.3, 3000);
// Paint per body in the sheets: white, dark blue, red (fleet colors).
const PAINT = { midsize: 0x1f3556, suv: 0xeeeeec, crewcab: 0x7a1416 };
const cars = {};
for (const id of FLEET_MODELS) {
  const spec = VEHICLE_SPECS[id];
  const v = createVehicle(id, 0, 0, 0);
  const m = createVehicleMesh(spec, PAINT[id] || spec.colors[0]);
  updateVehicleMesh(m, v, 1, 0);
  m.visible = false;
  scene.add(m);
  cars[id] = { spec, v, m };
}
function setLevel(c, lvl) {
  setVehicleLod(c.m, lvl === 2);
  setVehicleNearLevel(c.m, lvl === 2 ? 0 : lvl);
  c.m.updateMatrixWorld(true);
}
// Camera azimuth from the car's nose (+x) toward its right (+z).
const VIEWS = { side: { az: Math.PI / 2 + 0.0, el: 0.06 }, front: { az: 0, el: 0.1 }, threequarter: { az: 0.68, el: 0.16 }, rear: { az: Math.PI - 0.68, el: 0.16 } };
function aim(c, view, aspect, dist) {
  const V = VIEWS[view];
  const L = c.spec.length, Hh = c.spec.height;
  // At a set distance: the phone's scale (a 55 degree view 412 px tall).
  cam.fov = dist ? (2 * Math.atan(((H - 18) / 3 / 412) * Math.tan((27.5 * Math.PI) / 180)) * 180) / Math.PI : 30;
  cam.aspect = aspect;
  const tanV = Math.tan((cam.fov * Math.PI) / 360), tanH = tanV * aspect;
  const span = view === 'front' ? c.spec.width * 1.5 : view === 'side' ? L * 1.12 : L * 1.0;
  const d = dist || Math.max(span / 2 / tanH, Hh * 0.75 / tanV) + (view === 'side' ? c.spec.width / 2 : L / 2);
  cam.position.set(Math.cos(V.az) * Math.cos(V.el) * d, Hh * 0.45 + Math.sin(V.el) * d, Math.sin(V.az) * Math.cos(V.el) * d);
  cam.lookAt(0, Hh * 0.45, 0);
  cam.updateProjectionMatrix();
  cam.updateMatrixWorld();
}
const DPR = devicePixelRatio;
// cells: [{ id, level, view, label, dist }], cols x rows.
window.sheet = (cells, cols, rows, title) => {
  renderer.setScissorTest(false);
  renderer.setClearColor(0x222222);
  renderer.clear();
  const tw = W / cols, th = (H - 18) / rows;
  const labels = document.getElementById('labels');
  labels.innerHTML = '<div style="position:absolute;left:6px;top:1px;font:bold 12px sans-serif;color:#fff">' + title + '</div>';
  const info = [];
  cells.forEach((cell, i) => {
    const cx = i % cols, cy = Math.floor(i / cols);
    const c = cars[cell.id];
    for (const k in cars) cars[k].m.visible = false;
    c.m.visible = true;
    setLevel(c, cell.level);
    const x = cx * tw, y = H - 18 - (cy + 1) * th;
    renderer.setScissorTest(true);
    renderer.setViewport(x, y, tw - 2, th - 2);
    renderer.setScissor(x, y, tw - 2, th - 2);
    renderer.setClearColor(SKY);
    renderer.clear();
    aim(c, cell.view, (tw - 2) / (th - 2), cell.dist || 0);
    renderer.info.reset();
    renderer.render(scene, cam);
    info.push(cell.id + ' L' + cell.level + ' ' + cell.view + ': ' + renderer.info.render.calls + ' calls, ' + renderer.info.render.triangles + ' tris');
    labels.innerHTML += '<div style="position:absolute;left:' + (x + 4) + 'px;top:' + (18 + cy * th + 2) + 'px;font:10px sans-serif;color:#fff;background:rgba(0,0,0,.5);padding:0 4px">' + cell.label + '</div>';
  });
  renderer.setScissorTest(false);
  return info;
};
window.stats = () => FLEET_MODELS.map((id) => id + ' ' + JSON.stringify(vehicleStats(VEHICLE_SPECS[id])));
window.models = FLEET_MODELS.map((id) => [id, VEHICLE_SPECS[id].label]);
window.__ready = true;
`;
}

async function fleetShots() {
  const dir = join(root, 'dist', 'fleet');
  await mkdir(dir, { recursive: true });
  await build({
    stdin: { contents: fleetHarness(), resolveDir: root, sourcefile: 'fleet-harness.js', loader: 'js' },
    bundle: true, format: 'esm', target: 'es2020', outfile: join(dir, 'harness.js'), logLevel: 'warning',
  });
  await writeFile(join(dir, 'index.html'), '<!doctype html><html><body style="margin:0;background:#222;overflow:hidden"><canvas id="c" style="display:block"></canvas><div id="labels" style="position:absolute;left:0;top:0;width:100%;height:100%"></div><script type="module" src="harness.js"></script></body></html>');
  const server = createServer(async (req, res) => {
    try {
      const name = new URL(req.url, 'http://x').pathname.endsWith('/harness.js') ? 'harness.js' : 'index.html';
      const data = await readFile(join(dir, name));
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
    const page = await browser.newPage({ viewport: { width: 915, height: 412 }, deviceScaleFactor: 2 });
    page.on('pageerror', (e) => { failed = true; console.error('page error:', e.message); });
    page.on('console', (m) => { if (m.type() === 'error') console.error('console:', m.text()); });
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    await page.waitForFunction(() => window.__ready === true, null, { timeout: 60000 });
    for (const line of await page.evaluate(() => window.stats())) console.log(line);
    const models = await page.evaluate(() => window.models);
    const LV = ['L0 near', 'L1 one draw', 'L2 shell'];
    const shots = [];
    for (const view of ['side', 'front', 'threequarter']) {
      const cells = [];
      for (let lv = 0; lv < 3; lv++) for (const [id, label] of models) cells.push({ id, level: lv, view, label: `${label} (${id}) ${LV[lv]}` });
      shots.push([view, cells, 3, 3, `Fleet ${view}: rows L0, L1, L2`]);
    }
    for (const [id, label] of models) {
      const cells = [];
      for (let lv = 0; lv < 3; lv++) for (const view of ['side', 'front', 'threequarter', 'rear']) cells.push({ id, level: lv, view, label: `${LV[lv]} ${view}` });
      shots.push([id, cells, 4, 3, `${label} (${id}): rows L0, L1, L2`]);
    }
    // Each level at a distance it is drawn at, at the phone's scale (the
    // tile is a crop of a 915x412 screen with a 55 degree view).
    const far = [];
    for (const [id, label] of models) for (const [lv, d] of [[0, 15], [1, 40], [2, 90]]) far.push({ id, level: lv, view: 'threequarter', dist: d, label: `${label} ${LV[lv]} at ${d} m` });
    shots.push(['distance', far, 3, 3, 'Each level at its distance, phone scale']);
    for (const [name, cells, cols, rows, title] of shots) {
      const info = await page.evaluate(([c, a, b, t]) => window.sheet(c, a, b, t), [cells, cols, rows, title]);
      const file = join(dir, name + '.png');
      await page.screenshot({ path: file });
      console.log(name, '->', file);
      if (process.argv.includes('--verbose')) for (const l of info) console.log('  ' + l);
    }
  } finally {
    await browser.close();
    server.close();
  }
  if (failed) process.exit(1);
}
