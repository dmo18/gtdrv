// Developer helper (docs/PLAN_V3.md 13, LOTS): screenshots of block
// interiors at the phone size (headless Chromium, swiftshader), from the
// chase camera and from about 40 m up, at the owner's four Downtown places
// and at the two emptiest lots of each region (largest lot area with the
// fewest features; picked once and kept in <out>/spots.json, so a before
// and an after set show the same places). With --pop it also drives a
// sampled route and reports any lot or tile object that comes into being
// within 60 m of the camera, and coplanar ground layers it can find.
// usage: node scripts/wasteland-shots.mjs [outDir=dist/wasteland] [tag=after] [--pop] [--only=<region>]
import { createRequire } from 'node:module';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { buildGame, serve } from './build.mjs';
import { createMiamiCity } from '../src/world/miami.js';
import { dressLot, lotEmptiness } from '../src/world/lots.js';

let chromium;
try {
  ({ chromium } = await import('playwright'));
} catch {
  ({ chromium } = createRequire('/opt/node-tools/node_modules/')('playwright'));
}
const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const out = args[0] || 'dist/wasteland';
const tag = args[1] || 'after';
const pop = process.argv.includes('--pop');
const onlyArg = process.argv.find((a) => a.startsWith('--only='));
const only = onlyArg ? onlyArg.slice(7).split(',') : null;
await mkdir(out, { recursive: true });
const REGIONS = ['miami-downtown', 'miami-beach', 'miami-north', 'miami-west', 'miami-south'];
const OWNER = [
  ['owner-sw1st', 'Southwest 1st Avenue', 'Southwest 6th Street', 'SW 1st Ave', 'SW 6th St'],
  ['owner-miami-6th', 'South Miami Avenue', 'Southwest 6th Street', 'S Miami Ave', 'SW 6th St'],
  ['owner-se5th', 'Southeast 5th Street', 'Brickell Avenue', 'SE 5th St', 'Brickell Ave'],
];
const spotsFile = `${out}/spots.json`;
const spots = existsSync(spotsFile) ? JSON.parse(await readFile(spotsFile, 'utf8')) : {};

const priv = process.env.LOT_BUILD || '/tmp/claude-0/wastebuild';
await buildGame({ outDir: priv });
// The block middles of citymesh addBlock (drawn over the lots inside every
// rectangular block) are left out of this build when WASTE_ROADS=1: the
// line LOTS asked ROADS to change (realcity.js tileJob), so the shots show
// the lot ground as it will be once that lands. Never touches src/.
if (process.env.WASTE_ROADS === '1') {
  const { build } = await import('esbuild');
  const { readFile: rf } = await import('node:fs/promises');
  const pkg = JSON.parse(await rf('package.json', 'utf8'));
  await build({
    entryPoints: { game: 'src/main.js' }, bundle: true, format: 'esm', target: 'es2020', minify: true, splitting: true,
    outdir: priv, chunkNames: 'chunk-[hash]', define: { __PROD__: 'true', __VERSION__: JSON.stringify(pkg.version) }, logLevel: 'warning',
    plugins: [{
      name: 'roads-patch',
      setup(b) {
        b.onLoad({ filter: /render[\\/]realcity\.js$/ }, async (a) => {
          const src = await rf(a.path, 'utf8');
          const out = src.replace('for (const b of t.blocks) addBlock(B, b, DR, groundY, false);', 'if (!city.lots) for (const b of t.blocks) addBlock(B, b, DR, groundY, false);');
          if (out === src) throw new Error('roads patch: line not found');
          return { contents: out, loader: 'js' };
        });
      },
    }],
  });
}
const server = await serve(0, priv);
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const report = {};
for (const id of REGIONS) {
  if (only && !only.includes(id)) continue;
  const page = await browser.newPage({ viewport: { width: 915, height: 412 }, deviceScaleFactor: 1 });
  page.setDefaultTimeout(300000);
  page.on('pageerror', (e) => console.log('pageerror', String(e)));
  await page.goto(`http://127.0.0.1:${server.address().port}/?autostart&map=${id}`);
  await page.waitForFunction(() => window.__rw && window.__rw.loop.running, null, { timeout: 150000 });
  await page.addStyleTag({ content: 'body > :not(canvas) { visibility: hidden !important; }' });
  // The two emptiest lots of the region, picked in node from the pure
  // world (the same city the page builds).
  if (!spots[id]) {
    const city = createMiamiCity(JSON.parse(await readFile(`src/world/data/${id}.json`, 'utf8')), { region: id });
    const scored = [];
    const fs = [];
    for (const l of city.lots) {
      if (!l || l.type === 'verge' || l.type === 'airfield' || l.type === 'beach' || l.area < 400) continue;
      const cx = (l.x0 + l.x1) / 2, cz = (l.z0 + l.z1) / 2;
      if (city.mainShore && city.mainShore(cx, cz) < 20) continue;
      dressLot(city, l, fs);
      const u = lotEmptiness(fs);
      // Uncovered area: the lot's area less 60 m2 per feature unit.
      scored.push({ id: l.id, s: l.area - 60 * u, cx, cz, type: l.type, area: l.area, units: u });
    }
    scored.sort((a, b) => b.s - a.s);
    const e = [];
    for (const s of scored) {
      if (e.some((q) => Math.hypot(q.cx - s.cx, q.cz - s.cz) < 250)) continue;
      e.push(s);
      if (e.length >= 2) break;
    }
    spots[id] = e;
  }
  // The places: owner junctions (Downtown) and the two emptiest lots.
  const places = await page.evaluate(([owner, known]) => {
    const g = window.__rw;
    g.loop.stop();
    const c = g.city;
    for (const k of ['car', 'foot', 'boat', 'plane', 'heli', 'first']) g.progress.medals['hint_' + k] = 'bronze';
    const out = [];
    const named = (e, names) => names.some((n) => (e.name || '').toLowerCase() === n.toLowerCase());
    for (const [name, a1, b1, a2, b2] of owner) {
      // The node of street a nearest to a node of street b (the two meet,
      // or nearly: a junction cluster can keep their ends a few m apart).
      let best = null, bd = 60;
      for (const e of c.edges) {
        if (!named(e, [a1, a2])) continue;
        for (const q of c.edges) {
          if (!named(q, [b1, b2])) continue;
          for (const na of [e.a, e.b]) for (const nb of [q.a, q.b]) {
            const A = c.nodes[na], B = c.nodes[nb], d = Math.hypot(A.x - B.x, A.z - B.z);
            if (d < bd) { bd = d; best = { n: A, ea: e }; }
          }
        }
      }
      if (!best) continue;
      const { n, ea } = best;
      const o = c.nodes[ea.a === n.id ? ea.b : ea.a];
      const L = Math.hypot(n.x - o.x, n.z - o.z) || 1;
      const ux = (n.x - o.x) / L, uz = (n.z - o.z) / L, back = Math.min(30, L * 0.6);
      out.push({ name, x: n.x - ux * back - uz * 2, z: n.z - uz * back + ux * 2, heading: Math.atan2(uz, ux), lx: n.x, lz: n.z });
    }
    const empties = known;
    for (let k = 0; k < empties.length; k++) {
      const s = empties[k];
      // The nearest road point to the lot, facing along the road.
      let best = null, bd = Infinity;
      for (const e of c.edges) {
        if (e.bridge) continue;
        const a = c.nodes[e.a], b = c.nodes[e.b];
        const dx = b.x - a.x, dz = b.z - a.z, L2 = dx * dx + dz * dz || 1;
        let t = ((s.cx - a.x) * dx + (s.cz - a.z) * dz) / L2;
        t = Math.max(0.1, Math.min(0.9, t));
        const px = a.x + dx * t, pz = a.z + dz * t, d = Math.hypot(px - s.cx, pz - s.cz);
        if (d < bd) { bd = d; best = { x: px, z: pz, h: Math.atan2(dz, dx) }; }
      }
      out.push({ name: `empty-${k + 1}`, x: best.x, z: best.z, heading: best.h, lx: s.cx, lz: s.cz, lot: s });
    }
    return { out, empties };
  }, [id === 'miami-downtown' ? OWNER : [], spots[id] || null]);
  spots[id] = places.empties;
  report[id] = [];
  for (const p of places.out) {
    for (const view of ['chase', 'air']) {
      const info = await page.evaluate(async ([p, view]) => {
        const g = window.__rw;
        const v = g.player.vehicle;
        v.x = v.px = p.x; v.z = v.pz = p.z; v.heading = v.pheading = p.heading; v.vx = v.vz = 0; v.speed = 0;
        g.player.x = p.x; g.player.z = p.z;
        g.daynight.setHour(13);
        g.snapCam();
        for (let i = 0; i < 30; i++) g.step(1 / 60);
        const st = g.cityMesh.userData.stream;
        for (let k = 0; k < 3; k++) { g.draw(1, 1 / 60); if (st) st.flush(g.camera); }
        g.draw(1, 1 / 60);
        if (view === 'air') {
          // 40 m over the road, back from the car, looking at the lot.
          const ax = p.lx - p.x, az = p.lz - p.z, L = Math.hypot(ax, az) || 1;
          const ux = L > 5 ? ax / L : Math.cos(p.heading), uz = L > 5 ? az / L : Math.sin(p.heading);
          g.camera.position.set(p.x - Math.cos(p.heading) * 12, 40, p.z - Math.sin(p.heading) * 12);
          g.camera.lookAt(p.x + ux * Math.max(30, Math.min(70, L)), 0, p.z + uz * Math.max(30, Math.min(70, L)));
          g.camera.updateMatrixWorld();
          if (st) st.flush(g.camera);
          for (const s of g.systems) if (s.name === 'graphics' || s.name === 'daynight') s.render(1, 0);
          if (g.renderFrame) g.renderFrame(0); else g.renderer.render(g.scene, g.camera);
        }
        const gr = g.graphics || {};
        return { calls: gr.calls, tris: gr.triangles, cam: [Math.round(g.camera.position.x), Math.round(g.camera.position.y), Math.round(g.camera.position.z)] };
      }, [p, view]);
      await page.screenshot({ path: `${out}/${id.slice(6)}-${p.name}-${view}-${tag}.png` });
      report[id].push({ name: p.name, view, ...info, lot: p.lot ? { type: p.lot.type, area: Math.round(p.lot.area), units: p.lot.units } : undefined });
    }
  }
  if (process.argv.includes('--colors')) {
    // Mean color of each ground picture (TEX_MEAN in render/lotmesh.js).
    report[id + ':colors'] = await page.evaluate(() => {
      const M = window.__rw.cityMesh.userData.materials;
      const out = {};
      for (const [k, m] of [['grass', M.grassMat], ['asphalt', M.asphaltMat], ['sidewalk', M.sidewalkMat], ['ground', M.groundMat], ['sand', M.lotSandMat || M.sandMat]]) {
        const img = m && m.map && m.map.image;
        if (!img || !img.getContext) { out[k] = null; continue; }
        const d = img.getContext('2d').getImageData(0, 0, img.width, img.height).data;
        let r = 0, g = 0, b = 0;
        for (let i = 0; i < d.length; i += 4) { r += d[i]; g += d[i + 1]; b += d[i + 2]; }
        const n = d.length / 4;
        out[k] = [r / n / 255, g / n / 255, b / n / 255].map((v) => +v.toFixed(3));
      }
      return out;
    });
  }
  if (pop) report[id + ':pop'] = await page.evaluate(() => window.__rwPopProbe ? window.__rwPopProbe() : 'no probe');
  await page.close();
}
await writeFile(spotsFile, JSON.stringify(spots, null, 1));
console.log(JSON.stringify(report, null, 1));
await browser.close();
server.close();
