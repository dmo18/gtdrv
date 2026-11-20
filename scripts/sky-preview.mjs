// Renders the real city with the day/night system at several hours and
// weathers in headless Chromium, to check the sky by eye.
// Usage: node scripts/sky-preview.mjs
// Output: dist/sky-preview/<shot>.png, each with a street-level view on
// the left and a view from 200 m up on the right.
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
const out = join(root, 'dist', 'sky-preview');
const W = 1600, H = 450;
const SHOTS = [
  { name: 'h06', hour: 6, weather: 'clear' },
  { name: 'h12', hour: 12, weather: 'clear' },
  { name: 'h18_5', hour: 18.5, weather: 'clear' },
  { name: 'h18_5_west', hour: 18.5, weather: 'clear', west: true },
  { name: 'h23', hour: 23, weather: 'clear' },
  { name: 'h12_rain', hour: 12, weather: 'rain' },
  { name: 'h12_fog', hour: 12, weather: 'fog' },
];

const entry = `
import * as THREE from 'three';
import { generateCity } from './src/world/citygen.js';
import { createCollisionWorld } from './src/world/collision.js';
import { buildCityMesh } from './src/render/citymesh.js';
import { createWater } from './src/render/water.js';
import { createEvents } from './src/core/events.js';
import { createRng } from './src/core/rng.js';
import { createVehicle } from './src/entities/vehicle.js';
import { createVehicleMesh, updateVehicleMesh } from './src/render/vehiclemesh.js';
import { createDayNight } from './src/systems/daynight.js';

const W = ${W}, H = ${H}, HW = W / 2;
const renderer = new THREE.WebGLRenderer({ antialias: false, preserveDrawingBuffer: true });
renderer.setPixelRatio(1);
renderer.setSize(W, H);
document.body.appendChild(renderer.domElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color().setHex(0x9fc8e8, THREE.SRGBColorSpace);
scene.fog = new THREE.Fog(scene.background.getHex(), 220, 1050);
const hemi = new THREE.HemisphereLight(0xe4f1ff, 0x8a8272, 1.9);
const sun = new THREE.DirectionalLight(0xfff0d8, 1.7);
sun.position.set(0.55, 1, 0.35);
scene.add(hemi, sun);
const city = generateCity();
const cityMesh = buildCityMesh(city, createCollisionWorld());
scene.add(cityMesh);
cityMesh.remove(cityMesh.userData.water);
const water = createWater({});
const sea = new THREE.Group();
sea.position.y = -0.6;
sea.add(water.mesh);
scene.add(sea);

const camA = new THREE.PerspectiveCamera(62, HW / H, 0.5, 1800);
const camB = new THREE.PerspectiveCamera(62, HW / H, 0.5, 1800);
const sp = city.spawn;
camA.position.set(sp.x - 9, 2.6, sp.z);
camA.lookAt(sp.x + 40, 1.5, sp.z);
camB.position.set(sp.x - 120, 200, sp.z + 60);
camB.lookAt(sp.x + 400, 40, sp.z - 120);

const rng = createRng(5);
const game = {
  scene, renderer, camera: camA, cityMesh, clock: 9, time: 0,
  lights: { hemi, sun }, events: createEvents(), vehicles: [],
  progress: { settings: { quality: 1 } },
  player: { x: sp.x, z: sp.z, y: 0, vehicle: null },
};
const place = [[0, 1.6, 0], [22, 1.6, 0], [45, 1.8, 0], [30, -2, Math.PI], [70, -2, Math.PI]];
for (let i = 0; i < place.length; i++) {
  const [dx, dz, hd] = place[i];
  const v = createVehicle('sedan', sp.x + dx, sp.z + dz, hd, rng);
  v.speed = 8;
  v.controls = {};
  v.mesh = createVehicleMesh(v.spec, v.color);
  updateVehicleMesh(v.mesh, v, 1, 0);
  scene.add(v.mesh);
  game.vehicles.push(v);
  if (i === 0) { v.driver = 'player'; game.player.vehicle = v; }
}
const dn = createDayNight(game);
window.__info = () => renderer.info.render.calls;

window.__shot = (hour, weather, west) => {
  camB.position.set(sp.x + (west ? 120 : -120), 200, sp.z + 60);
  camB.lookAt(sp.x + (west ? -400 : 400), 40, sp.z - 120);
  dn.setWeather(weather, true);
  dn.setHour(hour);
  const calls = [];
  renderer.setScissorTest(true);
  const cams = [camA, camB];
  for (let k = 0; k < 2; k++) {
    const cam = cams[k];
    game.camera = cam;
    for (let i = 0; i < 3; i++) dn.render(1, 1 / 60);
    water.update(30, cam.position);
    renderer.setViewport(k * HW, 0, HW, H);
    renderer.setScissor(k * HW, 0, HW, H);
    renderer.render(scene, cam);
    calls.push(renderer.info.render.calls);
  }
  return calls;
};
window.__ready = true;
`;

await mkdir(out, { recursive: true });
await build({
  stdin: { contents: entry, resolveDir: root, sourcefile: 'sky-preview-entry.js', loader: 'js' },
  bundle: true,
  format: 'esm',
  target: 'es2020',
  outfile: join(out, 'preview.js'),
  logLevel: 'warning',
});
await writeFile(join(out, 'index.html'),
  '<!doctype html><meta charset="utf-8"><title>Sky preview</title>' +
  '<style>html,body{margin:0;background:#000}</style><script type="module" src="preview.js"></script>');

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
try {
  const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => {
    if ((m.type() === 'error' || m.type() === 'warning') && !m.text().includes('GL Driver Message')) errors.push(m.text());
  });
  await page.goto(`http://127.0.0.1:${port}/`);
  await page.waitForFunction(() => window.__ready, null, { timeout: 60000 });
  for (const s of SHOTS) {
    const calls = await page.evaluate(([h, w, west]) => window.__shot(h, w, west), [s.hour, s.weather, !!s.west]);
    await page.screenshot({ path: join(out, `${s.name}.png`) });
    console.log('wrote', `${s.name}.png`, 'draw calls (street, aerial):', calls.join(', '));
  }
} catch (e) {
  console.log('FAIL', e.message);
  failed = true;
} finally {
  await browser.close();
  server.close();
}
for (const e of errors.slice(0, 10)) console.log('page:', e);
process.exit(failed || errors.length ? 1 : 0);
