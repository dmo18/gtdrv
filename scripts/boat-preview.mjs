// Renders all boat types on the animated sea in headless Chromium and
// saves screenshots, to check the meshes and water by eye.
// Usage: node scripts/boat-preview.mjs
// Output: dist/boat-preview/boats.png (overview) and boats-close.png
// (each boat from front-right and rear-left).
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
const out = join(root, 'dist', 'boat-preview');
const W = 1280, H = 720;

const entry = `
import * as THREE from 'three';
import { createBoat, stepBoat } from './src/entities/boat.js';
import { createBoatMesh, updateBoatMesh } from './src/render/boatmesh.js';
import { createWater, createWakeTrail } from './src/render/water.js';

const W = ${W}, H = ${H};
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(W, H);
renderer.setPixelRatio(1);
document.body.appendChild(renderer.domElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color(0xa9cde8);
scene.fog = new THREE.Fog(0xa9cde8, 220, 1050);
scene.add(new THREE.HemisphereLight(0xe4f1ff, 0x8a8272, 1.9));
const sun = new THREE.DirectionalLight(0xfff0d8, 1.7);
sun.position.set(80, 120, 40);
scene.add(sun);

const water = createWater();
scene.add(water.mesh);
const wake = createWakeTrail(scene, 64);

const DT = 1 / 60;
const ids = ['speedboat', 'jetski', 'fisher', 'yacht', 'dinghy', 'submarine'];
const slots = [[0, -14], [3, 14], [-30, -14], [-34, 14], [-6, 0], [-14, 22]];
const runs = {
  speedboat: { steps: 300, c: (i) => ({ throttle: 1, steer: i > 200 ? 0.6 : 0, brake: 0 }) },
  jetski: { steps: 240, c: (i) => ({ throttle: 1, steer: i > 160 ? -0.8 : 0, brake: 0 }) },
  fisher: { steps: 300, c: () => ({ throttle: 0.6, steer: 0, brake: 0 }) },
  yacht: { steps: 300, c: () => null },
  dinghy: { steps: 200, c: () => ({ throttle: 0.4, steer: 0, brake: 0 }) },
  submarine: { steps: 240, c: () => ({ throttle: 0.5, steer: 0, brake: 0 }) },
};
const boats = [];
const T = 12;
for (let k = 0; k < ids.length; k++) {
  const id = ids[k];
  const r = runs[id];
  const b = createBoat(id, 0, 0, 0);
  const world = { time: T - r.steps * DT };
  const trail = [];
  for (let i = 0; i < r.steps; i++) {
    world.time += DT;
    stepBoat(b, r.c(i), DT, world);
    const ch = Math.cos(b.heading), sh = Math.sin(b.heading);
    trail.push(b.x, b.z, b.heading, b.wake, ch, sh);
  }
  const dx = slots[k][0] - b.x, dz = slots[k][1] - b.z;
  b.x += dx; b.px += dx; b.z += dz; b.pz += dz;
  boats.push({ b, trail, dx, dz });
  const mesh = createBoatMesh(b.spec, b.spec.colors[k % b.spec.colors.length]);
  updateBoatMesh(mesh, b, 1, T);
  scene.add(mesh);
}
// Replay the wakes so foam has a spread of ages.
const sterns = boats.filter((o) => o.b.wake > 0.2);
const maxSteps = Math.max(...sterns.map((o) => o.trail.length / 6));
for (let i = 0; i < maxSteps; i++) {
  for (const o of sterns) {
    const n = o.trail.length / 6;
    const j = i - (maxSteps - n);
    if (j < 0 || j % 5) continue;
    const t = o.trail;
    const L = o.b.spec.length * 0.5;
    wake.emit(t[j * 6] + o.dx - t[j * 6 + 4] * L, t[j * 6 + 1] + o.dz - t[j * 6 + 5] * L, t[j * 6 + 2], t[j * 6 + 3]);
  }
  wake.update(DT, T - (maxSteps - i) * DT);
}

const cam = new THREE.PerspectiveCamera(50, W / H, 0.3, 2000);
cam.position.set(18, 16, 30);
cam.lookAt(-14, 0, 0);
water.update(T, cam.position);
renderer.render(scene, cam);
window.__shot = 'overview';
window.__ready = true;

window.__close = () => {
  renderer.setScissorTest(true);
  const cols = boats.length, cw = Math.floor(W / cols), chh = Math.floor(H / 2);
  const c2 = new THREE.PerspectiveCamera(40, cw / chh, 0.1, 2000);
  for (let k = 0; k < cols; k++) {
    const b = boats[k].b;
    const L = b.spec.length;
    for (let row = 0; row < 2; row++) {
      const s = row === 0 ? 1 : -1;
      const ch = Math.cos(b.heading), sh = Math.sin(b.heading);
      const fx = ch * s, fz = sh * s, rx = -sh * s, rz = ch * s;
      const d = Math.max(L * 1.15, 5.5);
      c2.position.set(b.x + (fx * 1.1 + rx * 1.0) * d, b.y + d * 0.5, b.z + (fz * 1.1 + rz * 1.0) * d);
      c2.lookAt(b.x, b.y + b.spec.height * 0.3, b.z);
      water.update(T, c2.position);
      renderer.setViewport(k * cw, (1 - row) * chh, cw, chh);
      renderer.setScissor(k * cw, (1 - row) * chh, cw, chh);
      renderer.render(scene, c2);
    }
  }
};
`;

await mkdir(out, { recursive: true });
await build({
  stdin: { contents: entry, resolveDir: root, sourcefile: 'boat-preview-entry.js', loader: 'js' },
  bundle: true,
  format: 'esm',
  target: 'es2020',
  outfile: join(out, 'preview.js'),
  logLevel: 'warning',
});
await writeFile(join(out, 'index.html'),
  '<!doctype html><meta charset="utf-8"><title>Boat preview</title>' +
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
  await page.waitForFunction(() => window.__ready, null, { timeout: 30000 });
  await page.screenshot({ path: join(out, 'boats.png') });
  await page.evaluate(() => window.__close());
  await page.screenshot({ path: join(out, 'boats-close.png') });
  console.log('wrote', join(out, 'boats.png'), 'and boats-close.png');
} catch (e) {
  console.log('FAIL', e.message);
  failed = true;
} finally {
  await browser.close();
  server.close();
}
for (const e of errors.slice(0, 10)) console.log('page:', e);
process.exit(failed || errors.length ? 1 : 0);
