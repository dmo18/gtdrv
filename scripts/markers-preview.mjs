// Renders one of each activity marker on a plain ground plane in headless
// Chromium, plus the activity panel and result card at phone size, to
// check them by eye.
// Usage: node scripts/markers-preview.mjs
// Output: dist/markers-preview/markers.png, panel.png, result.png
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

let chromium;
try {
  ({ chromium } = await import('playwright'));
} catch {
  ({ chromium } = createRequire('/opt/node-tools/node_modules/')('playwright'));
}

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const out = join(root, 'dist', 'markers-preview');
const W = 1280, H = 720;

const entry = `
import * as THREE from 'three';
import { createMarkers } from './src/render/markers.js';
import { createActivities } from './src/systems/activities.js';
import { generateCity } from './src/world/citygen.js';
import { createEvents } from './src/core/events.js';
import { injectStyles } from './src/ui/styles.js';

window.__markers = () => {
  const W = ${W}, H = ${H};
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(W, H);
  renderer.setPixelRatio(1);
  document.body.appendChild(renderer.domElement);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x9fc8e8);
  scene.fog = new THREE.Fog(0x9fc8e8, 220, 1050);
  scene.add(new THREE.HemisphereLight(0xe4f1ff, 0x8a8272, 1.9));
  const sun = new THREE.DirectionalLight(0xfff0d8, 1.7);
  sun.position.set(0.55, 1, 0.35);
  scene.add(sun);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(600, 600).rotateX(-Math.PI / 2), new THREE.MeshLambertMaterial({ color: 0x8f9a86 }));
  scene.add(ground);
  const road = new THREE.Mesh(new THREE.PlaneGeometry(400, 14).rotateX(-Math.PI / 2), new THREE.MeshLambertMaterial({ color: 0x4a4a4e }));
  road.position.set(0, 0.02, 10);
  scene.add(road);
  const sea = new THREE.Mesh(new THREE.PlaneGeometry(120, 90).rotateX(-Math.PI / 2), new THREE.MeshLambertMaterial({ color: 0x2f7fa6 }));
  sea.position.set(-50, 0.03, -60);
  scene.add(sea);
  const roof = new THREE.Mesh(new THREE.BoxGeometry(22, 12, 22), new THREE.MeshLambertMaterial({ color: 0xa89684 }));
  roof.position.set(50, 6, -60);
  scene.add(roof);

  const m1 = createMarkers(scene, { seaY: 0.05 });
  const m2 = createMarkers(scene, { seaY: 0.05 });
  const types = ['street', 'boat', 'sky', 'delivery'];
  types.forEach((type, i) => m1.showStart(i, { type, start: { x: -45 + i * 30, z: 40, y: 0 } }, 9));
  m1.showCheckpoint(0, { kind: 'ground', x: -30, z: 10, y: 0, r: 12, dir: 0 }, 'next');
  m1.showCheckpoint(1, { kind: 'ground', x: 30, z: 10, y: 0, r: 12, dir: 0 }, 'after');
  m1.showCheckpoint(2, { kind: 'buoy', x: -55, z: -50, y: 0, r: 16, dir: 0.3 }, 'next');
  m2.showCheckpoint(0, { kind: 'ring', x: 0, z: -40, y: 22, r: 14, dir: 0.5 }, 'next');
  m2.showCheckpoint(1, { kind: 'pad', x: 50, z: -60, y: 13, r: 6, dir: 0 }, 'next');
  m2.showCheckpoint(2, { kind: 'buoy', x: -40, z: -85, y: 0, r: 16, dir: 0.3 }, 'after');
  const cam = new THREE.PerspectiveCamera(55, W / H, 0.5, 1800);
  cam.position.set(10, 38, 105);
  cam.lookAt(0, 4, -20);
  m1.update(1.3, cam.position);
  m2.update(1.3, cam.position);
  renderer.render(scene, cam);
  window.__close = () => {
    cam.position.set(-20, 9, -18);
    cam.lookAt(-50, 1, -62);
    m1.update(2.1, cam.position);
    m2.update(2.1, cam.position);
    renderer.render(scene, cam);
  };
};

window.__panel = (finish) => {
  injectStyles();
  const ui = document.createElement('div');
  ui.style.cssText = 'position:fixed;inset:0;background:linear-gradient(#7fb0d8,#5d6b58)';
  document.body.appendChild(ui);
  // Stand-ins for the HUD corners so overlaps are visible.
  const box = (css) => { const d = document.createElement('div'); d.style.cssText = 'position:absolute;background:rgba(24,18,15,.58);border-radius:14px;' + css; ui.appendChild(d); };
  box('left:10px;top:8px;width:116px;height:150px;border-radius:58px');
  box('right:134px;top:8px;width:150px;height:84px');
  box('right:8px;top:8px;width:118px;height:56px');
  box('right:16px;bottom:14px;width:180px;height:110px');
  box('right:16px;bottom:138px;width:260px;height:58px');
  const toasts = document.createElement('div');
  toasts.className = 'rw-hud';
  ui.appendChild(toasts);
  const t = document.createElement('div');
  t.className = 'rw-toasts';
  toasts.appendChild(t);
  const toast = document.createElement('div');
  toast.className = 'rw-toast';
  toast.textContent = 'Glasswell Glide';
  t.appendChild(toast);
  const city = generateCity();
  const car = { kind: 'car', x: 0, z: 0, y: 0, speed: 0, wrecked: false };
  const game = {
    city, events: createEvents(), time: 0,
    hud: { toast() {} },
    progress: { money: 0, owned: [], medals: {}, bestTimes: {}, stats: { races: 0 } },
    player: { mode: 'car', vehicle: car, x: 0, z: 0, y: 0 },
  };
  const sys = createActivities(game, ui);
  const c = sys.courses.find((k) => k.id === 'street-glasswell');
  const put = (x, z, n) => { car.x = x; car.z = z; game.player.x = x; game.player.z = z; for (let i = 0; i < n; i++) sys.fixedUpdate(1 / 60); };
  put(c.start.x, c.start.z, 60 * 6);
  for (let k = 0; k < 3; k++) put(c.checkpoints[k].x, c.checkpoints[k].z, 600);
  if (finish) {
    for (let lap = 0; lap < 2; lap++) for (const cp of c.checkpoints) put(cp.x, cp.z, 120);
  }
  sys.render(1, 1 / 60);
};
window.__ready = true;
`;

await mkdir(out, { recursive: true });
await build({
  stdin: { contents: entry, resolveDir: root, sourcefile: 'markers-preview-entry.js', loader: 'js' },
  bundle: true,
  format: 'esm',
  target: 'es2020',
  outfile: join(out, 'preview.js'),
  logLevel: 'warning',
});
await writeFile(join(out, 'index.html'),
  '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">' +
  '<title>Markers preview</title><style>html,body{margin:0;background:#000;overflow:hidden}</style>' +
  '<script type="module" src="preview.js"></script>');

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.png': 'image/png' };
const server = createServer(async (req, res) => {
  try {
    let p = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname));
    if (p.endsWith('/')) p = join(p, 'index.html');
    const file = join(out, p);
    if (!file.startsWith(out)) throw new Error('outside');
    const data = await readFile(file);
    res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream' });
    res.end(data);
  } catch {
    res.writeHead(404);
    res.end('not found');
  }
});
await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
const port = server.address().port;

const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const errors = [];
let failed = false;
const open = async (w, h) => {
  const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => {
    if ((m.type() === 'error' || m.type() === 'warning') && !m.text().includes('GL Driver Message')) errors.push(m.text());
  });
  await page.goto(`http://127.0.0.1:${port}/`);
  await page.waitForFunction(() => window.__ready, null, { timeout: 30000 });
  return page;
};
try {
  const p1 = await open(W, H);
  await p1.evaluate(() => window.__markers());
  await p1.screenshot({ path: join(out, 'markers.png') });
  await p1.evaluate(() => window.__close());
  await p1.screenshot({ path: join(out, 'markers-close.png') });
  const p2 = await open(915, 412);
  await p2.evaluate(() => window.__panel(false));
  await p2.waitForTimeout(1000);
  await p2.screenshot({ path: join(out, 'panel.png') });
  const p3 = await open(780, 360);
  await p3.evaluate(() => window.__panel(true));
  await p3.screenshot({ path: join(out, 'result.png') });
  console.log('wrote', join(out, 'markers.png'), 'panel.png and result.png');
} catch (e) {
  console.log('FAIL', e.message);
  failed = true;
} finally {
  await browser.close();
  server.close();
}
for (const e of errors.slice(0, 10)) console.log('page:', e);
process.exit(failed || errors.length ? 1 : 0);
