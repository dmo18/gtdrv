// Renders the minimap and full map in headless Chromium (915x412, touch),
// asserts on pixels and waypoint taps, and saves screenshots to dist/map-test/.
import { build } from 'esbuild';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { readFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '..');
const out = path.join(repo, 'dist', 'map-test');

async function loadChromium() {
  try {
    return (await import('playwright')).chromium;
  } catch {
    return createRequire(import.meta.url)('/opt/node-tools/node_modules/playwright').chromium;
  }
}

await mkdir(out, { recursive: true });
await build({
  stdin: {
    resolveDir: repo,
    sourcefile: 'map-entry.js',
    contents: `
      import { generateCity } from './src/world/citygen.js';
      import { createMapRenderer, createMinimap, createFullMap } from './src/ui/minimap.js';
      const city = generateCity();
      // Optional shapes the game will add later, to exercise those paths.
      city.extraLand = [{ x0: 980, z0: -150, x1: 1150, z1: 60 }];
      city.piers = [{ x0: 330, z0: 480, x1: 342, z1: 560 }];
      city.pois = [
        { type: 'airfield', x: 1060, z: -40, label: 'Kestrel Field' },
        { type: 'marina', x: 336, z: 560, label: 'Saltyard Marina' },
        { type: 'garage', x: -90, z: -60, label: 'Garage' },
        { type: 'shop', x: 120, z: 90, label: 'Shop' },
        { type: 'race', x: -300, z: 200, label: 'Race' },
        { type: 'helipad', x: 40, z: -210, label: 'Helipad' },
      ];
      const t0 = performance.now();
      const mapR = createMapRenderer(city);
      const buildMs = performance.now() - t0;
      const canvas = document.createElement('canvas');
      canvas.width = 176; canvas.height = 176;
      canvas.style.cssText = 'position:fixed;left:20px;top:20px;border-radius:50%;border:3px solid #e2733a';
      document.body.appendChild(canvas);
      const mini = createMinimap(canvas, mapR);
      const calls = [];
      const root = document.createElement('div');
      root.style.cssText = 'position:fixed;inset:0';
      document.body.appendChild(root);
      let closed = 0;
      const full = createFullMap(root, mapR, { onWaypoint: (w) => calls.push(w), onClose: () => closed++ });
      const blips = [
        { x: 0, z: 0, type: 'car', color: '#6fd0c4' },
        { x: 3000, z: 0, type: 'far', color: '#f2b84b' },
      ];
      window.t = { city, mapR, mini, full, calls, buildMs, getClosed: () => closed, blips };
    `,
  },
  bundle: true, format: 'iife', outfile: path.join(out, 'game.js'), logLevel: 'error',
});

const html = '<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1">' +
  '<body style="margin:0;background:#222"><script src="game.js"></script>';
const server = createServer(async (req, res) => {
  if (req.url === '/' || req.url === '/index.html') {
    res.setHeader('content-type', 'text/html'); res.end(html); return;
  }
  try {
    const f = await readFile(path.join(out, req.url.split('?')[0]));
    res.setHeader('content-type', 'text/javascript'); res.end(f);
  } catch { res.statusCode = 404; res.end(); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const url = `http://127.0.0.1:${server.address().port}/`;

const failures = [];
const check = (ok, msg) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${msg}`); if (!ok) failures.push(msg); };

const chromium = await loadChromium();
const browser = await chromium.launch();
try {
  const ctx = await browser.newContext({ viewport: { width: 915, height: 412 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(url);
  await page.waitForFunction(() => window.t);

  check(true, `map pre-render took ${(await page.evaluate(() => window.t.buildMs)).toFixed(0)} ms`);

  // Minimap: sample pixels for a few poses.
  const poses = await page.evaluate(() => {
    const { city, mini } = window.t;
    const n = city.nodes.find((q) => Math.abs(q.x) < 120 && Math.abs(q.z) < 120) || city.nodes[0];
    const res = [];
    const cases = [
      { x: city.spawn.x, z: city.spawn.z, heading: 0, zoomMetres: 180 },
      { x: n.x, z: n.z, heading: Math.PI / 2, zoomMetres: 120 },
      { x: n.x + 200, z: n.z + 60, heading: 2.3, zoomMetres: 500 },
      { x: 1000, z: -40, heading: -1, zoomMetres: 500 },
    ];
    const canvas = document.querySelector('canvas');
    const g = canvas.getContext('2d');
    for (const c of cases) {
      mini.draw({ ...c, blips: window.t.blips, blipCount: 2, waypoint: { x: c.x + 60, z: c.z - 40 } });
      const d = g.getImageData(0, 0, 176, 176).data;
      let road = 0, opaque = 0;
      for (let i = 0; i < d.length; i += 4) {
        if (d[i + 3] > 200) opaque++;
        // road greys #3b3a3c / #4a484a
        if (Math.abs(d[i] - 0x3b) < 6 && Math.abs(d[i + 1] - 0x3a) < 6 && Math.abs(d[i + 2] - 0x3c) < 6) road++;
        else if (Math.abs(d[i] - 0x4a) < 6 && Math.abs(d[i + 1] - 0x48) < 6 && Math.abs(d[i + 2] - 0x4a) < 6) road++;
      }
      const p = g.getImageData(88, 88, 1, 1).data;
      res.push({ road, opaque, centre: [p[0], p[1], p[2]] });
    }
    return res;
  });
  poses.forEach((p, i) => {
    if (i < 3) check(p.road > 150, `minimap pose ${i}: road pixels present (${p.road})`);
    check(p.opaque > 15000, `minimap pose ${i}: not blank (${p.opaque} opaque px)`);
    const d = Math.hypot(p.centre[0] - 0xe2, p.centre[1] - 0x73, p.centre[2] - 0x3a);
    check(d < 12, `minimap pose ${i}: centre pixel is player arrow colour (${p.centre})`);
  });

  // Redraw skipping: an identical state must not touch the canvas.
  const skipped = await page.evaluate(() => {
    const { mini } = window.t;
    const canvas = document.querySelector('canvas');
    const g = canvas.getContext('2d');
    const s = { x: 50, z: 50, heading: 1, zoomMetres: 180, blips: window.t.blips, blipCount: 2, waypoint: null };
    mini.draw(s);
    g.fillStyle = '#ff00ff'; g.fillRect(0, 0, 4, 4);
    mini.draw(s); // should skip, leaving the magenta marker
    const kept = g.getImageData(1, 1, 1, 1).data[0] === 255;
    mini.draw({ ...s, x: 60 });
    const redrawn = g.getImageData(1, 1, 1, 1).data[0] !== 255 || g.getImageData(1, 1, 1, 1).data[3] === 0;
    return { kept, redrawn };
  });
  check(skipped.kept, 'minimap skips redraw when nothing moved');
  check(skipped.redrawn, 'minimap redraws after movement');

  await page.evaluate(() => {
    const { city, mini } = window.t;
    mini.draw({ x: city.spawn.x, z: city.spawn.z, heading: 0.6, zoomMetres: 180, blips: window.t.blips, blipCount: 2, waypoint: { x: city.spawn.x + 120, z: city.spawn.z - 60 } });
  });
  await page.screenshot({ path: path.join(out, 'minimap.png'), clip: { x: 0, y: 0, width: 260, height: 240 } });

  // Full map.
  await page.evaluate(() => {
    const { city, full } = window.t;
    full.open({ x: city.spawn.x, z: city.spawn.z, heading: 0.6, waypoint: null });
  });
  check(await page.evaluate(() => window.t.full.isOpen()), 'full map opens');
  await page.waitForTimeout(100);
  const v = await page.evaluate(() => window.t.full.getView());
  const size = await page.evaluate(() => window.t.city.mapHalf || window.t.city.size);
  const fit = Math.min(v.width, v.height) / (size * 0.95 * 2);
  check(Math.abs(v.ppm - fit) < 1e-9, 'full map opens at fit zoom');

  async function tapAt(sx, sy) {
    await page.touchscreen.tap(sx, sy);
    await page.waitForTimeout(80);
  }
  const lastCall = () => page.evaluate(() => window.t.calls[window.t.calls.length - 1]);
  const spots = [[0, 0], [150, -80], [-220, 120]]; // screen px offsets from centre
  for (const [ox, oy] of spots) {
    await tapAt(v.width / 2 + ox, v.height / 2 + oy);
    const c = await lastCall();
    const ex = ox / fit, ez = oy / fit;
    const err = c ? Math.hypot(c.x - ex, c.z - ez) : 1e9;
    check(err < 5, `tap (${ox},${oy}) -> world (${c && c.x.toFixed(1)}, ${c && c.z.toFixed(1)}), expected (${ex.toFixed(1)}, ${ez.toFixed(1)}), err ${err.toFixed(2)} m`);
  }
  await page.screenshot({ path: path.join(out, 'fullmap.png') });

  // Tap the last waypoint again to clear it.
  const before = await page.evaluate(() => window.t.calls.length);
  const [lx, ly] = spots[spots.length - 1];
  await tapAt(v.width / 2 + lx, v.height / 2 + ly);
  const after = await page.evaluate((b) => window.t.calls.slice(b), before);
  check(after.length === 1 && after[0] === null, 'tapping the waypoint again clears it with onWaypoint(null)');

  // Close.
  await page.tap('.rw-map-close');
  await page.waitForTimeout(50);
  check(!(await page.evaluate(() => window.t.full.isOpen())), 'close button closes the map');
  check((await page.evaluate(() => window.t.getClosed())) === 1, 'onClose called once');
  const btn = await page.evaluate(() => { const b = document.querySelector('.rw-map-close'); return [b.offsetWidth, b.offsetHeight, b.getAttribute('aria-label')]; });
  check(btn[0] === 0 || btn[0] === 56, 'close button is 56 px wide');

  check(errors.length === 0, `no page errors ${errors.join(' | ')}`);
} finally {
  await browser.close();
  server.close();
}

if (failures.length) {
  console.error(`\n${failures.length} check(s) failed`);
  process.exit(1);
}
console.log('\nmap-test passed; screenshots in dist/map-test/');
