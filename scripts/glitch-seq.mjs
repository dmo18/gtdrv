// Developer helper (0.13.9 visual glitches): video-like frame sequences.
// In each region it drives (or flies, or boats) the camera through a few
// places in fixed 1/60 s steps, reads back every drawn frame and counts,
// per pixel, the frames whose brightness reverses (up then down, or down
// then up, by more than --thr on both sides). Steady motion moves an edge
// across a pixel once; z-fighting, shadow acne, shimmer and popping flip
// it back and forth. Writes, per place, the first frame with the flagged
// pixels in red (<out>/<region>-<place>-<mode>.png) and a JSON report with
// the flagged share, and with --check exits 1 if any share is over --max.
// usage: node scripts/glitch-seq.mjs [outDir] [--only=<region,...>]
//          [--size=780x360] [--dpr=3] [--hour=13] [--weather=rain]
//          [--frames=30] [--settle=40] [--speed=16] [--modes=drive,fly,boat]
//          [--thr=28] [--min=3] [--max=0.004] [--check] [--no-build]
//          [--dump] (every frame as a PNG too)
//          [--traffic] (keep the traffic and walkers; default removed)
//          [--at=name:x:z:headingDeg,...] (extra drive places)
//          [--places=start,core,bridge,carpark,fly,boat] (only these)
// The game is built into GLITCH_BUILD (default under the OS temp dir).
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
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
const opt = (n, d) => {
  const a = process.argv.find((s) => s.startsWith('--' + n + '='));
  return a ? a.slice(n.length + 3) : d;
};
const out = args[0] || join(tmpdir(), 'rustwater-glitch-seq');
const [VW, VH] = opt('size', '780x360').split('x').map(Number);
const DPR = +opt('dpr', 3);
const HOUR = +opt('hour', 13);
const WEATHER = opt('weather', null);
const FRAMES = +opt('frames', 30);
const SETTLE = +opt('settle', 40); // steps and draws before the run (tiles, lot cars, fades settle)
const SPEED = +opt('speed', 16);
const THR = +opt('thr', 28), MIN = +opt('min', 3), MAX = +opt('max', 0.004);
const MODES = opt('modes', 'drive,fly,boat').split(',');
const only = opt('only', null);
const REGIONS = ['miami-beach', 'miami-downtown', 'miami-north', 'miami-west', 'miami-south'];
const AT = opt('at', '') ? opt('at', '').split(',').map((t) => { const [name, x, z, h] = t.split(':'); return { name, x: +x, z: +z, heading: ((+h || 0) * Math.PI) / 180, mode: 'drive' }; }) : [];

const priv = process.env.GLITCH_BUILD || join(tmpdir(), 'rustwater-glitch-build');
if (!flag('no-build')) await buildGame({ outDir: priv });
await mkdir(out, { recursive: true });
const server = await serve(0, priv);
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const report = {};
const errors = [];
let worst = 0;

for (const id of REGIONS) {
  if (only && !only.split(',').includes(id)) continue;
  const page = await browser.newPage({ viewport: { width: VW, height: VH }, deviceScaleFactor: DPR });
  page.setDefaultTimeout(600000);
  page.on('pageerror', (e) => errors.push(`${id}: ${String(e)}`));
  await page.goto(`http://127.0.0.1:${server.address().port}/?autostart&map=${id}`);
  await page.waitForFunction(() => window.__rw && window.__rw.loop.running, null, { timeout: 150000 });
  await page.addStyleTag({ content: 'body > :not(canvas) { visibility: hidden !important; }' });
  // Places: a lane near the start, the downtown core, the longest bridge,
  // the biggest parking lot (drive); over the start at 70 m (fly); along
  // the nearest shore from the water (boat).
  const places = await page.evaluate(([modes, traffic]) => {
    const g = window.__rw;
    g.loop.stop();
    for (const k of ['car', 'foot', 'boat', 'plane', 'heli', 'first']) g.progress.medals['hint_' + k] = 'bronze';
    const c = g.city, E = c.edges, N = c.nodes, sp = c.spawn;
    const lane = (name, x, z) => {
      let best = null, bd = 1e9;
      for (const e of E) {
        if (e.ped || e.length < 60) continue;
        const a = N[e.a];
        const t = Math.max(20, Math.min(e.length - 40, (x - a.x) * e.ux + (z - a.z) * e.uz));
        const px = a.x + e.ux * t, pz = a.z + e.uz * t, d = Math.hypot(px - x, pz - z);
        if (d < bd) { bd = d; best = { e, px, pz }; }
      }
      if (!best) return null;
      const { e, px, pz } = best, o = (e.laneW || 3.3) * 0.5 + (e.center || 0) / 2;
      return { name, mode: 'drive', x: px - e.uz * o, z: pz + e.ux * o, heading: Math.atan2(e.uz, e.ux) };
    };
    const P = [];
    if (modes.includes('drive')) {
      P.push(lane('start', sp.x + Math.cos(sp.heading) * 60, sp.z + Math.sin(sp.heading) * 60));
      const bs = c.buildings.filter((b) => Math.hypot((b.x0 + b.x1) / 2 - sp.x, (b.z0 + b.z1) / 2 - sp.z) < 2500).sort((a, b) => (b.h || 0) - (a.h || 0)).slice(0, 20);
      if (bs.length) P.push(lane('core', bs.reduce((s, b) => s + (b.x0 + b.x1) / 2, 0) / bs.length, bs.reduce((s, b) => s + (b.z0 + b.z1) / 2, 0) / bs.length));
      let br = null;
      for (const e of E) if (e.bridge && !e.ped && (!br || e.length > br.length)) br = e;
      if (br) { const a = N[br.a], t = Math.max(0, br.length / 2 - 60); P.push({ name: 'bridge', mode: 'drive', x: a.x + br.ux * t, z: a.z + br.uz * t, heading: Math.atan2(br.uz, br.ux) }); }
      let lot = null;
      for (const l of c.lots) if (l.type === 'carpark' && (!lot || l.area > lot.area) && Math.hypot((l.x0 + l.x1) / 2 - sp.x, (l.z0 + l.z1) / 2 - sp.z) < 1800) lot = l;
      if (lot) P.push(lane('carpark', (lot.x0 + lot.x1) / 2, (lot.z0 + lot.z1) / 2));
    }
    if (modes.includes('fly')) P.push({ name: 'fly', mode: 'fly', x: sp.x, z: sp.z, heading: sp.heading, y: 70 });
    if (modes.includes('boat')) {
      // The nearest water 30 to 60 m off a shore, heading along it.
      let best = null;
      for (let r = 40; r < 2500 && !best; r += 40) {
        for (let k = 0; k < 48 && !best; k++) {
          const a = (k / 48) * Math.PI * 2, x = sp.x + Math.cos(a) * r, z = sp.z + Math.sin(a) * r;
          if (c.isLand(x, z)) continue;
          let open = true;
          for (let q = 0; q < 8; q++) if (c.isLand(x + Math.cos(q * 0.785) * 25, z + Math.sin(q * 0.785) * 25)) open = false;
          if (!open) continue;
          // Shore direction: the nearest land within 90 m.
          for (let q = 0; q < 16; q++) {
            const b = (q / 16) * Math.PI * 2;
            if (c.isLand(x + Math.cos(b) * 70, z + Math.sin(b) * 70)) { best = { x, z, heading: b + Math.PI / 2 }; break; }
          }
        }
      }
      if (best) P.push({ name: 'boat', mode: 'boat', ...best, y: 2.2 });
    }
    if (!traffic) for (const q of g.vehicles) if (q !== g.player.vehicle && q.kind === 'car' && q.driver) q.removed = true;
    return P.filter(Boolean);
  }, [MODES, flag('traffic')]);
  for (const p of AT) places.push(p);
  const pick = opt('places', null);
  if (pick) for (let i = places.length - 1; i >= 0; i--) if (!pick.split(',').includes(places[i].name)) places.splice(i, 1);
  const rep = report[id] = [];
  for (const p of places) {
    const res = await page.evaluate(async ([p, hour, weather, frames, speed, thr, min, settle, dump]) => {
      const g = window.__rw;
      if (weather) g.daynight.setWeather(weather, true);
      g.daynight.setHour(hour);
      const v = g.player.vehicle;
      const ux = Math.cos(p.heading), uz = Math.sin(p.heading);
      // Start back so the run ends at the place.
      const run = (speed * (frames + 40)) / 60;
      let x = p.x - ux * run * 0.5, z = p.z - uz * run * 0.5;
      const put = () => {
        v.px = v.x; v.pz = v.z; v.pheading = v.heading;
        v.x = x; v.z = z; v.heading = p.heading; v.vx = ux * speed; v.vz = uz * speed; v.speed = speed;
        g.player.x = x; g.player.z = z;
      };
      put(); v.px = v.x; v.pz = v.z;
      g.snapCam();
      const st = g.cityMesh.userData.stream;
      for (let i = 0; i < 20; i++) g.step(1 / 60);
      for (let k = 0; k < settle; k++) { put(); g.step(1 / 60); g.draw(1, 1 / 60); if (st && k < 4) st.flush(g.camera); }
      const gl = g.renderer.getContext();
      const W = gl.drawingBufferWidth, H = gl.drawingBufferHeight, n = W * H;
      const buf = new Uint8Array(n * 4);
      const L = [new Uint8Array(n), new Uint8Array(n), new Uint8Array(n)];
      const cnt = new Uint8Array(n);
      let first = null;
      const dumps = [];
      const view = () => {
        if (p.mode === 'drive') return;
        // Fly: 70 m up, looking 20 degrees down; boat: 2.2 m over the sea.
        const cy = p.mode === 'fly' ? p.y : p.y - 0.6;
        g.camera.position.set(x - ux * 8, cy, z - uz * 8);
        const ahead = p.mode === 'fly' ? p.y / Math.tan(0.35) : 300;
        g.camera.lookAt(x + ux * ahead, p.mode === 'fly' ? 0 : 0.5, z + uz * ahead);
        g.camera.updateMatrixWorld();
        for (const s of g.systems) if (s.name === 'graphics' || s.name === 'daynight') s.render(1, 0);
        if (st) st.update(g.camera, 6);
        if (g.renderFrame) g.renderFrame(1 / 60); else g.renderer.render(g.scene, g.camera);
      };
      for (let f = 0; f < frames; f++) {
        x += (ux * speed) / 60; z += (uz * speed) / 60;
        put();
        g.step(1 / 60);
        g.draw(1, 1 / 60);
        view();
        gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, buf);
        const cur = L[f % 3];
        for (let i = 0, j = 0; i < n; i++, j += 4) cur[i] = (buf[j] * 77 + buf[j + 1] * 150 + buf[j + 2] * 29) >> 8;
        if (f === 0) first = buf.slice();
        // --dump: every frame as a PNG (the canvas as drawn), for a closer look.
        if (dump) dumps.push(g.renderer.domElement.toDataURL('image/png'));
        if (f >= 2) {
          const a = L[(f - 2) % 3], b = L[(f - 1) % 3];
          for (let i = 0; i < n; i++) {
            const d1 = b[i] - a[i], d2 = cur[i] - b[i];
            if ((d1 > thr && d2 < -thr) || (d1 < -thr && d2 > thr)) cnt[i]++;
          }
        }
      }
      // The flagged pixels, and the flagged share by band of the screen.
      let bad = 0;
      const rows = [0, 0, 0, 0];
      for (let i = 0; i < n; i++) if (cnt[i] >= min) { bad++; rows[Math.min(3, ((H - 1 - ((i / W) | 0)) * 4 / H) | 0)]++; }
      const cv = document.createElement('canvas');
      cv.width = W; cv.height = H;
      const cx = cv.getContext('2d');
      const img = cx.createImageData(W, H);
      for (let yy = 0; yy < H; yy++) {
        for (let xx = 0; xx < W; xx++) {
          const s = ((H - 1 - yy) * W + xx), d = (yy * W + xx) * 4;
          const hit = cnt[s] >= min;
          img.data[d] = hit ? 255 : first[s * 4];
          img.data[d + 1] = hit ? 0 : first[s * 4 + 1];
          img.data[d + 2] = hit ? 0 : first[s * 4 + 2];
          img.data[d + 3] = 255;
        }
      }
      cx.putImageData(img, 0, 0);
      return { W, H, share: bad / n, rows: rows.map((r) => r / (n / 4)), png: cv.toDataURL('image/png'), dumps, calls: g.graphics && g.graphics.calls };
    }, [p, HOUR, WEATHER, FRAMES, SPEED, THR, MIN, SETTLE, flag('dump')]);
    const tag = `${id.slice(6)}-${p.name}-${WEATHER || 'clear'}-${HOUR}`;
    await writeFile(`${out}/${tag}.png`, Buffer.from(res.png.split(',')[1], 'base64'));
    for (let k = 0; k < res.dumps.length; k++) await writeFile(`${out}/${tag}-f${String(k).padStart(2, '0')}.png`, Buffer.from(res.dumps[k].split(',')[1], 'base64'));
    worst = Math.max(worst, res.share);
    rep.push({ place: p.name, mode: p.mode, x: Math.round(p.x), z: Math.round(p.z), share: +res.share.toFixed(5), rows: res.rows.map((r) => +r.toFixed(4)), size: `${res.W}x${res.H}`, calls: res.calls });
    console.log(`${tag}: flagged ${(res.share * 100).toFixed(3)} % (bands top to bottom ${res.rows.map((r) => (r * 100).toFixed(2)).join(' ')}) at ${res.W}x${res.H}`);
  }
  await page.close();
}
await writeFile(`${out}/report-${WEATHER || 'clear'}-${HOUR}.json`, JSON.stringify(report, null, 1));
if (errors.length) console.log('page errors:', errors.slice(0, 5));
await browser.close();
server.close();
const fail = errors.length || (flag('check') && worst > MAX);
if (flag('check')) console.log(`worst flagged share ${(worst * 100).toFixed(3)} % (limit ${(MAX * 100).toFixed(2)} %)`);
process.exit(fail ? 1 : 0);
