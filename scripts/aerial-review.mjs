// Developer helper (0.13.8 street alignment, docs/STATUS.md): top-down
// orthographic views of the real game's render (headless Chromium,
// swiftshader), one PNG per square, with road paint, curbs, sidewalks
// and building roofs (footprints) in full detail: the near tiles are
// built under the square and their small meshes (paint, decals) shown
// whatever the distance; trees, traffic and fog are left out.
// usage: node scripts/aerial-review.mjs [outDir] [tag=a] [--only=<region,...>]
//          [--at=name:x:z[:side],...] (squares centered on x, z; side m,
//          default 400; with --only=<one region>) [--px=1080] [--no-build]
//          [--trees] [--traffic]
// Without --at each region gets a square on its start. The game is built
// into DRIVE_BUILD (default: a folder under the OS temp dir), never into
// dist/.
import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildGame, serve } from './build.mjs';

let chromium;
try {
  ({ chromium } = await import('playwright'));
} catch {
  ({ chromium } = createRequire('/opt/node-tools/node_modules/')('playwright'));
}
const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const flag = (n) => process.argv.includes('--' + n);
const opt = (n) => { const a = process.argv.find((s) => s.startsWith('--' + n + '=')); return a ? a.slice(n.length + 3) : null; };
const out = args[0] || join(tmpdir(), 'rustwater-aerial');
const tag = args[1] || 'a';
const only = opt('only') ? opt('only').split(',') : null;
const PX = +(opt('px') || 1080);
const REGIONS = ['miami-beach', 'miami-downtown', 'miami-north', 'miami-west', 'miami-south'];
const AT = opt('at') ? opt('at').split(',').map((t) => { const [name, x, z, side] = t.split(':'); return { name, x: +x, z: +z, side: +side || 400 }; }) : [];
const priv = process.env.DRIVE_BUILD || join(tmpdir(), 'rustwater-drive-build');
if (!flag('no-build')) await buildGame({ outDir: priv });
await mkdir(out, { recursive: true });
const server = await serve(0, priv);
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const errors = [];
for (const id of REGIONS) {
  if (only && !only.includes(id)) continue;
  const page = await browser.newPage({ viewport: { width: PX, height: PX }, deviceScaleFactor: 1 });
  page.setDefaultTimeout(300000);
  page.on('pageerror', (e) => errors.push(`${id}: ${String(e)}`));
  await page.goto(`http://127.0.0.1:${server.address().port}/?autostart&map=${id}`);
  await page.waitForFunction(() => window.__rw && window.__rw.loop.running, null, { timeout: 150000 });
  await page.addStyleTag({ content: 'body > :not(canvas) { visibility: hidden !important; }' });
  const squares = AT.length ? AT : await page.evaluate(() => { const s = window.__rw.city.spawn; return [{ name: 'start', x: s.x, z: s.z, side: 400 }]; });
  for (const sq of squares) {
    await page.evaluate(([sq, trees, traffic]) => {
      const g = window.__rw;
      g.loop.stop();
      for (const k of ['car', 'foot', 'boat', 'plane', 'heli', 'first']) g.progress.medals['hint_' + k] = 'bronze';
      g.daynight.setHour(12.5);
      const v = g.player.vehicle;
      v.x = v.px = sq.x; v.z = v.pz = sq.z; v.vx = v.vz = 0; v.speed = 0;
      g.player.x = sq.x; g.player.z = sq.z;
      if (!traffic) for (const q of g.vehicles) if (q !== v && q.driver) q.removed = true;
      g.snapCam();
      for (let i = 0; i < 10; i++) g.step(1 / 60);
      g.draw(1, 1 / 60);
      const cam = g.camera, st = g.cityMesh.userData.stream;
      // Camera low over the middle (the streamer builds near tiles round
      // it), looking straight down, north (-z) up the image.
      cam.position.set(sq.x, 2, sq.z);
      cam.up.set(0, 0, -1);
      cam.lookAt(sq.x, 0, sq.z);
      cam.updateMatrixWorld();
      if (st) st.flush(cam);
      // Every built tile in full detail (paint and decals past MID).
      if (st) for (const t of st.tiles) if (t.group) { t.group.visible = true; for (const m of t.small) m.visible = true; }
      const ud = g.cityMesh.userData;
      if (!trees && ud.trees && ud.trees.mesh) ud.trees.mesh.visible = false;
      if (!trees && st) for (const t of st.tiles) if (t.group) t.group.traverse((o) => { if (/tree/i.test(o.name || '')) o.visible = false; });
      for (const s of g.systems) if (s.name === 'graphics' || s.name === 'daynight') s.render(1, 0);
      if (g.scene.fog) { g.scene.fog.near = 1e6; g.scene.fog.far = 2e6; }
      const h = sq.side / 2;
      cam.position.set(sq.x, 400, sq.z);
      cam.lookAt(sq.x, 0, sq.z);
      cam.updateMatrixWorld();
      cam.projectionMatrix.makeOrthographic(-h, h, h, -h, 1, 900);
      cam.projectionMatrixInverse.copy(cam.projectionMatrix).invert();
      g.renderer.render(g.scene, cam);
    }, [sq, flag('trees'), flag('traffic')]);
    const f = `${out}/${id.slice(6)}-${tag}-${sq.name}.png`;
    for (let k = 0; ; k++) {
      try { await page.screenshot({ path: f, timeout: 120000 }); break; } catch (err) { if (k >= 2) throw err; }
    }
    console.log(f, `(${Math.round(sq.x)}, ${Math.round(sq.z)}) ${sq.side} m`);
  }
  await page.close();
}
if (errors.length) console.log('page errors:', errors.slice(0, 5));
await browser.close();
server.close();
process.exit(errors.length ? 1 : 0);
