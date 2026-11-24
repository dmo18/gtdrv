// Developer helper (docs/PLAN_V3.md 14, STREETSCAPE; docs/STREETSCAPE.md):
// the drive review. In each of the five regions it follows a 1.5 km route
// along named main streets from the start and saves a chase-camera frame
// every 50 m at the phone size (915x412, headless Chromium, swiftshader),
// a top view from 40 m at every fifth frame, and both views at the owner's
// spots. With `montage` (ImageMagick) on the path it also writes contact
// sheets of four frames (<out>/sheets/), which are quicker to read.
// usage: node scripts/drive-review.mjs [outDir] [tag=r] [--only=<region,...>]
//          [--spots] (owner spots only) [--no-build] [--night] [--no-traffic]
//          [--at=name:x:z:headingDeg:height,...] (extra places, with --only=<one region>;
//          chase and top view, the top from `height` m, default 40)
// The game is built into DRIVE_BUILD (default: a folder under the OS temp
// dir), never into dist/.
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
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
const out = args[0] || join(tmpdir(), 'rustwater-drive-review');
const tag = args[1] || 'r';
const onlyArg = process.argv.find((a) => a.startsWith('--only='));
const only = onlyArg ? onlyArg.slice(7).split(',') : null;
const REGIONS = ['miami-beach', 'miami-downtown', 'miami-north', 'miami-west', 'miami-south'];
const ROUTE_LEN = 1500, FRAME_STEP = 50, TOP_EVERY = 5;
// The owner's spots: [name, street a (long, short), street b (long, short)].
const SPOTS = {
  'miami-downtown': [
    ['miami-6th', ['South Miami Avenue', 'S Miami Ave'], ['Southwest 6th Street', 'SW 6th St']],
    ['sw1st-miami', ['Southwest 1st Avenue', 'SW 1st Ave'], ['South Miami Avenue', 'S Miami Ave']],
    ['se5th-brickell', ['Southeast 5th Street', 'SE 5th St'], ['Brickell Avenue', 'Brickell Ave']],
  ],
  'miami-beach': [
    ['ocean-10th', ['Ocean Drive', 'Ocean Dr'], ['10th Street', '10th St']],
    ['alton-5th', ['Alton Road', 'Alton Rd'], ['5th Street', '5th St']],
    ['lincoln-washington', ['Lincoln Road', 'Lincoln Rd'], ['Washington Avenue', 'Washington Ave']],
  ],
};

const atArg = process.argv.find((a) => a.startsWith('--at='));
const AT = atArg ? atArg.slice(5).split(',').map((t) => { const [name, x, z, h, top] = t.split(':'); return { name, jx: +x, jz: +z, heading: ((+h || 0) * Math.PI) / 180, top: +top || 40 }; }) : [];
const priv = process.env.DRIVE_BUILD || join(tmpdir(), 'rustwater-drive-build');
if (!flag('no-build')) await buildGame({ outDir: priv });
await mkdir(out, { recursive: true });
const server = await serve(0, priv);
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const report = {};
const errors = [];

for (const id of REGIONS) {
  if (only && !only.includes(id)) continue;
  const short = id.slice(6);
  const page = await browser.newPage({ viewport: { width: 915, height: 412 }, deviceScaleFactor: 1 });
  page.setDefaultTimeout(300000);
  page.on('pageerror', (e) => errors.push(`${id}: ${String(e)}`));
  await page.goto(`http://127.0.0.1:${server.address().port}/?autostart&map=${id}`);
  await page.waitForFunction(() => window.__rw && window.__rw.loop.running, null, { timeout: 150000 });
  await page.addStyleTag({ content: 'body > :not(canvas) { visibility: hidden !important; }' });
  // The route (points every FRAME_STEP m on the driving lane) and the spots.
  const plan = await page.evaluate(([spots, ROUTE_LEN, FRAME_STEP]) => {
    const g = window.__rw;
    g.loop.stop();
    const c = g.city;
    for (const k of ['car', 'foot', 'boat', 'plane', 'heli', 'first']) g.progress.medals['hint_' + k] = 'bronze';
    const N = c.nodes, E = c.edges;
    const adj = N.map(() => []);
    for (const e of E) { adj[e.a].push(e); adj[e.b].push(e); }
    const v = g.player.vehicle;
    // The start edge: under the car, driven the way the car faces.
    const at = c.streetAt(v.x, v.z);
    let e = E[at && at.edge >= 0 ? at.edge : 0];
    let from = Math.cos(v.heading) * e.ux + Math.sin(v.heading) * e.uz >= 0 ? e.a : e.b;
    const main = (q) => (q.name ? 1 : 0) + (q.avenue ? 1 : 0) + Math.min(2, ((q.lanesF || 0) + (q.lanesB || 0)) / 2);
    const legs = [];
    const seen = new Set();
    let total = 0;
    // Start part way along the first edge (where the car stands).
    const a0 = N[from];
    let d0 = Math.max(0, Math.min(e.length, Math.hypot(v.x - a0.x, v.z - a0.z)));
    while (total < ROUTE_LEN + FRAME_STEP && legs.length < 400) {
      legs.push({ e: e.id, from, d0 });
      seen.add(e.id);
      total += e.length - d0;
      d0 = 0;
      const to = e.a === from ? e.b : e.a;
      const hx = (N[to].x - N[from].x) / e.length, hz = (N[to].z - N[from].z) / e.length;
      let best = null, bs = -1e9;
      for (const q of adj[to]) {
        if (q === e || q.bridge || q.ped || q.length < 1) continue;
        const o = N[q.a === to ? q.b : q.a];
        const dot = ((o.x - N[to].x) * hx + (o.z - N[to].z) * hz) / q.length;
        if (dot < -0.7) continue; // no U-turn
        const legal = !(q.oneway && q.b === to);
        // Straight on along the same named street first; at its end the
        // widest named street.
        const s = dot * 3 + (q.name && q.name === e.name ? 3 : 0) + main(q) + (legal ? 2 : 0) - (seen.has(q.id) ? 8 : 0);
        if (s > bs) { bs = s; best = q; }
      }
      if (!best) break;
      from = to;
      e = best;
    }
    // Points on the lane (right of the divide, lane 0), every FRAME_STEP m.
    const pts = [];
    let next = 0, run = 0;
    for (const l of legs) {
      const q = E[l.e], fwd = q.a === l.from;
      const a = N[l.from], b = N[fwd ? q.b : q.a];
      const ux = (b.x - a.x) / q.length, uz = (b.z - a.z) / q.length;
      const lw = q.laneW || 3.3, ctr = q.center || 0;
      const sdiv = (q.off || 0) - q.width / 2 + 0.3 + (q.parkL || 0) + (q.lanesB || 0) * lw + ctr / 2;
      // Right of the travel direction; a one-way driven backward keeps the forward lane.
      const legal = fwd || !q.oneway;
      const o = !legal ? -(sdiv + 0.5 * lw) : fwd ? sdiv + ctr / 2 + 0.5 * lw : -sdiv + ctr / 2 + 0.5 * lw;
      while (next <= run + q.length - l.d0 && pts.length <= ROUTE_LEN / FRAME_STEP) {
        const d = l.d0 + (next - run);
        pts.push({ x: a.x + ux * d - uz * o, z: a.z + uz * d + ux * o, heading: Math.atan2(uz, ux), street: q.name || '', d: next });
        next += FRAME_STEP;
      }
      run += q.length - l.d0;
    }
    // The owner's spots: the node of street a nearest to a node of street b.
    const named = (q, names) => names.some((n) => (q.name || '').toLowerCase() === n.toLowerCase());
    const places = [];
    for (const [name, A, B] of spots) {
      let best = null, bd = 60;
      for (const p of E) {
        if (!named(p, A)) continue;
        for (const q of E) {
          if (!named(q, B)) continue;
          for (const na of [p.a, p.b]) for (const nb of [q.a, q.b]) {
            const d = Math.hypot(N[na].x - N[nb].x, N[na].z - N[nb].z);
            if (d < bd) { bd = d; best = { n: N[na], p }; }
          }
        }
      }
      if (!best) { places.push({ name, missing: true }); continue; }
      const { n, p } = best;
      const o = N[p.a === n.id ? p.b : p.a];
      const L = Math.hypot(n.x - o.x, n.z - o.z) || 1;
      const ux = (n.x - o.x) / L, uz = (n.z - o.z) / L, back = Math.min(32, L * 0.7);
      places.push({ name, x: n.x - ux * back - uz * 2, z: n.z - uz * back + ux * 2, heading: Math.atan2(uz, ux), jx: n.x, jz: n.z });
    }
    return { pts, places, streets: [...new Set(pts.map((p) => p.street))] };
  }, [AT.length ? [] : SPOTS[id] || [], ROUTE_LEN, FRAME_STEP]);

  const shoot = async (p, view, file) => {
    const info = await page.evaluate(async ([p, view, night, noTraffic]) => {
      const g = window.__rw;
      const v = g.player.vehicle;
      v.x = v.px = p.x; v.z = v.pz = p.z; v.heading = v.pheading = p.heading; v.vx = v.vz = 0; v.speed = 0;
      g.player.x = p.x; g.player.z = p.z;
      g.daynight.setHour(night ? 22.5 : 13);
      if (noTraffic) for (const q of g.vehicles) if (q !== v && q.kind === 'car' && q.driver) q.removed = true;
      g.snapCam();
      for (let i = 0; i < 30; i++) g.step(1 / 60);
      const st = g.cityMesh.userData.stream;
      for (let k = 0; k < 3; k++) { g.draw(1, 1 / 60); if (st) st.flush(g.camera); }
      g.draw(1, 1 / 60);
      if (view === 'top') {
        const ux = Math.cos(p.heading), uz = Math.sin(p.heading);
        const cx = p.jx !== undefined ? p.jx : p.x + ux * 14, cz = p.jz !== undefined ? p.jz : p.z + uz * 14;
        const hy = p.top || 40;
        g.camera.position.set(cx - ux * 0.3 * hy, hy, cz - uz * 0.3 * hy);
        g.camera.lookAt(cx + ux * 2, 0, cz + uz * 2);
        g.camera.updateMatrixWorld();
        if (st) st.flush(g.camera);
        for (const s of g.systems) if (s.name === 'graphics' || s.name === 'daynight') s.render(1, 0);
        if (g.renderFrame) g.renderFrame(0); else g.renderer.render(g.scene, g.camera);
      }
      const gr = g.graphics || {};
      return { calls: gr.calls, tris: gr.triangles };
    }, [p, view, flag('night'), flag('no-traffic')]);
    // A loaded machine can time a screenshot out: try again.
    for (let k = 0; ; k++) {
      try { await page.screenshot({ path: file, timeout: 120000 }); break; } catch (err) { if (k >= 2) throw err; }
    }
    return info;
  };

  const rep = report[id] = { streets: plan.streets, frames: [], spots: [] };
  const files = [];
  if (!flag('spots') && !AT.length) {
    for (let k = 0; k < plan.pts.length; k++) {
      const p = plan.pts[k], n = String(k).padStart(2, '0');
      const f = `${out}/${short}-${tag}-${n}.png`;
      const info = await shoot(p, 'chase', f);
      files.push([f, `${short} ${n} ${p.street} (${Math.round(p.x)}, ${Math.round(p.z)})`]);
      rep.frames.push({ n, street: p.street, x: Math.round(p.x), z: Math.round(p.z), ...info });
      if (k % TOP_EVERY === 0) {
        const ft = `${out}/${short}-${tag}-${n}-top.png`;
        await shoot(p, 'top', ft);
        files.push([ft, `${short} ${n} top`]);
      }
    }
  }
  for (const a of AT) plan.places.push({ ...a, x: a.jx - Math.cos(a.heading) * 25, z: a.jz - Math.sin(a.heading) * 25 });
  for (const p of plan.places) {
    if (p.missing) { rep.spots.push({ name: p.name, missing: true }); continue; }
    for (const view of ['chase', 'top']) {
      const f = `${out}/${short}-${tag}-spot-${p.name}-${view}.png`;
      await shoot(p, view, f);
      files.push([f, `${short} ${p.name} ${view} (${Math.round(p.jx)}, ${Math.round(p.jz)})`]);
    }
    rep.spots.push({ name: p.name, x: Math.round(p.jx), z: Math.round(p.jz) });
  }
  await page.close();
  // Contact sheets, four frames each.
  try {
    await mkdir(`${out}/sheets`, { recursive: true });
    for (let k = 0, s = 0; k < files.length; k += 4, s++) {
      const part = files.slice(k, k + 4);
      const a = [];
      for (const [f, label] of part) a.push('-label', label, f);
      execFileSync('montage', [...a, '-tile', '2x2', '-geometry', '915x412+2+2', '-pointsize', '15', `${out}/sheets/${short}-${tag}-${String(s).padStart(2, '0')}.png`]);
    }
  } catch (err) {
    console.log('no contact sheets:', String(err).slice(0, 80));
  }
}
await writeFile(`${out}/report-${tag}.json`, JSON.stringify(report, null, 1));
for (const [id, r] of Object.entries(report)) {
  const calls = r.frames.map((f) => f.calls || 0), tris = r.frames.map((f) => f.tris || 0);
  console.log(`${id}: ${r.frames.length} frames along ${r.streets.join(', ')}; calls max ${Math.max(0, ...calls)}, triangles max ${Math.max(0, ...tris)}; spots ${r.spots.map((s) => s.name + (s.missing ? ' (missing)' : '')).join(', ') || 'none'}`);
}
if (errors.length) console.log('page errors:', errors.slice(0, 5));
await browser.close();
server.close();
process.exit(errors.length ? 1 : 0);
