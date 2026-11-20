// Renders all aircraft models side by side in headless Chromium and saves
// dist/aircraft-preview/aircraft.png, so the models can be checked by eye.
import { build } from 'esbuild';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const out = join(root, 'dist/aircraft-preview');

const PAGE = `<!doctype html><meta charset="utf-8"><title>Aircraft preview</title>
<style>html,body{margin:0;background:#9cc3e6;overflow:hidden}canvas{display:block}</style>
<canvas id="c"></canvas><script type="module" src="preview.js"></script>`;

// Front row: parked, seen from the front quarter. Back row: flying, banked,
// engines running, seen from the rear quarter.
const ENTRY = `
import * as THREE from 'three';
import { AIRCRAFT_SPECS, createAircraft } from './src/entities/aircraft.js';
import { createAircraftMesh, updateAircraftMesh } from './src/render/aircraftmesh.js';

const W = 2200, H = 1200;
const renderer = new THREE.WebGLRenderer({ canvas: document.getElementById('c'), antialias: true, preserveDrawingBuffer: true });
renderer.setSize(W, H, false);
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x9cc3e6);
scene.add(new THREE.HemisphereLight(0xffffff, 0x6b7a5a, 1.5));
const sun = new THREE.DirectionalLight(0xffffff, 2.2);
sun.position.set(30, 60, 40);
scene.add(sun);
const ground = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), new THREE.MeshLambertMaterial({ color: 0x7f8a80 }));
ground.rotation.x = -Math.PI / 2;
scene.add(ground);

const ids = ['prop', 'stunt', 'seaplane', 'jet', 'heli', 'heavyheli', 'fighter', 'patrolheli'];
const camera = new THREE.PerspectiveCamera(28, 1, 1, 900);
const views = [];
ids.forEach((id, i) => {
  const spec = AIRCRAFT_SPECS[id];
  // Spaced far apart so each tile shows one craft.
  const parked = createAircraft(id, i * 120, 0, 0);
  const m1 = createAircraftMesh(spec, spec.colors[0]);
  updateAircraftMesh(m1, parked, 1, 0);
  scene.add(m1);
  views.push({ x: i * 120, y: 0, z: 0, r: parked.radius, ang: 0.75, col: i, row: 0 });
  const flying = createAircraft(id, i * 120, 150, 0);
  flying.y = 8; flying.py = 8;
  flying.roll = flying.proll = 0.3;
  flying.pitch = flying.ppitch = 0.12;
  flying.engineOn = true;
  flying.rotorSpeed = 1;
  flying.propSpin = 0.5;
  flying.afterburner = 1;
  flying.siren = true;
  flying.spot = 1;
  const m2 = createAircraftMesh(spec, spec.colors[1]);
  updateAircraftMesh(m2, flying, 1, 0);
  scene.add(m2);
  views.push({ x: i * 120, y: 8, z: 150, r: flying.radius, ang: 2.5, col: i, row: 1 });
});
ground.position.set(300, 0, 75);
ground.scale.set(4, 4, 1);

// One tile per craft: all in a row, parked above, flying below.
const tw = Math.floor(W / ids.length), th = H / 2;
camera.aspect = tw / th;
camera.updateProjectionMatrix();
renderer.setScissorTest(true);
for (const v of views) {
  const d = v.r * 4.3;
  camera.position.set(v.x + Math.cos(v.ang) * d, v.y + d * 0.42, v.z + Math.sin(v.ang) * d);
  camera.lookAt(v.x, v.y + 1.4, v.z);
  renderer.setViewport(v.col * tw, v.row === 0 ? th : 0, tw, th);
  renderer.setScissor(v.col * tw, v.row === 0 ? th : 0, tw, th);
  renderer.render(scene, camera);
}
window.__ready = true;
`;

async function loadChromium() {
  try {
    return (await import('playwright')).chromium;
  } catch {
    return createRequire('/opt/node-tools/node_modules/')('playwright').chromium;
  }
}

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript' };

await mkdir(out, { recursive: true });
await build({
  stdin: { contents: ENTRY, resolveDir: root, sourcefile: 'aircraft-preview-entry.js', loader: 'js' },
  bundle: true,
  format: 'esm',
  target: 'es2020',
  outfile: join(out, 'preview.js'),
  logLevel: 'warning',
});
await writeFile(join(out, 'index.html'), PAGE);

const server = createServer(async (req, res) => {
  try {
    const name = new URL(req.url, 'http://x').pathname === '/preview.js' ? 'preview.js' : 'index.html';
    const data = await readFile(join(out, name));
    res.writeHead(200, { 'content-type': TYPES[extname(name)], 'cache-control': 'no-store' });
    res.end(data);
  } catch {
    res.writeHead(404);
    res.end('not found');
  }
});
await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
const url = `http://127.0.0.1:${server.address().port}/`;

const chromium = await loadChromium();
const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
let failed = false;
try {
  const page = await browser.newPage({ viewport: { width: 2200, height: 1200 } });
  page.on('pageerror', (e) => {
    failed = true;
    console.error('page error:', e.message);
  });
  page.on('console', (m) => {
    if (m.type() === 'error') console.error('console:', m.text());
  });
  await page.goto(url);
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 30000 });
  const file = join(out, 'aircraft.png');
  await page.locator('#c').screenshot({ path: file });
  console.log('Wrote', file);
} finally {
  await browser.close();
  server.close();
}
if (failed) process.exit(1);
