// Real-browser check of the volume model: master scales everything,
// music / effects / ambience scale their own buses, mute silences all.
// Reads the real GainNode values of the master and the category buses.
// The sound bank is slow to build on a loaded machine (up to 4 minutes).
import { build } from 'esbuild';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { readFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(repo, 'dist', 'volume-test');
await mkdir(out, { recursive: true });
await build({
  stdin: {
    resolveDir: repo, sourcefile: 'vol-entry.js',
    contents: "import { createAudio } from './src/systems/audio.js'; import { createEvents } from './src/core/events.js'; window.h = { createAudio, createEvents };",
  },
  bundle: true, platform: 'browser', format: 'esm', outfile: path.join(out, 'harness.js'),
});
const html = '<!doctype html><meta charset="utf-8"><title>vol</title><script type="module" src="/harness.js"></script>';
const js = await readFile(path.join(out, 'harness.js'));
const server = createServer((req, res) => {
  if (req.url === '/harness.js') res.writeHead(200, { 'content-type': 'text/javascript' }).end(js);
  else res.writeHead(200, { 'content-type': 'text/html' }).end(html);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
let chromium;
try { chromium = (await import('playwright')).chromium; } catch { chromium = createRequire(import.meta.url)('/opt/node-tools/node_modules/playwright').chromium; }
const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
let res;
try {
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  await page.waitForFunction(() => window.h);
  res = await page.evaluate(async () => {
    const out = [];
    const check = (name, ok, detail = '') => out.push({ name, ok: !!ok, detail: String(detail) });
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const car = { kind: 'car', spec: { id: 'sedan', maxSpeed: 45 }, x: 0, y: 0, z: 0, speed: 0, throttle: 0, slip: 0, rotorSpeed: 0 };
    const game = {
      events: window.h.createEvents(), time: 0, paused: false,
      camera: { matrixWorld: { elements: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] } },
      city: { shoreDist: (x) => 120 - x }, input: { held: () => false },
      player: { mode: 'car', vehicle: car, x: 0, y: 0, z: 0, heading: 0 }, vehicles: [car],
    };
    const audio = window.h.createAudio(game);
    audio.unlock();
    const t0 = performance.now();
    while (!audio.debug.ready && performance.now() - t0 < 240000) await sleep(100);
    check('bank ready', audio.debug.ready, ((performance.now() - t0) / 1000).toFixed(0) + ' s');
    const d = audio.debug;
    const g = () => ({ master: d.master.gain.value, music: d.buses.music.gain.value, effects: d.buses.effects.gain.value, engine: d.buses.engine.gain.value, tyres: d.buses.tyres.gain.value, ui: d.buses.ui.gain.value, world: d.buses.world.gain.value });
    const settle = () => sleep(600);
    const near = (a, b) => Math.abs(a - b) < 1e-3;
    await settle();
    audio.setVolume({ master: 0.8, music: 0.5, sfx: 1, ambience: 1, musicOn: true, muteAll: false });
    await settle();
    const base = g();
    check('baseline master 0.8', near(base.master, 0.8), JSON.stringify(base));
    // master 0 silences everything
    audio.setVolume({ master: 0 }); await settle();
    check('master 0: master gain 0', g().master === 0 || g().master < 1e-4, g().master);
    // slider change is smooth: a value between old and new right after the change
    audio.setVolume({ master: 0.8 }); await settle();
    audio.setVolume({ master: 0.2 }); await sleep(15);
    const mid = g().master;
    check('master change is smooth', mid > 0.2 && mid < 0.8, mid);
    await settle();
    check('master 0.2', near(g().master, 0.2), g().master);
    audio.setVolume({ master: 0.8 }); await settle();
    // music 0 affects only music
    audio.setVolume({ music: 0 }); await settle();
    let a = g();
    check('music 0: music bus 0', a.music < 1e-4, a.music);
    check('music 0: others untouched', near(a.master, base.master) && near(a.effects, base.effects) && near(a.engine, base.engine) && near(a.world, base.world) && near(a.ui, base.ui) && near(a.tyres, base.tyres), JSON.stringify(a));
    audio.setVolume({ music: 0.5 }); await settle();
    // effects 0 affects only effects (engines, tyres, ui, effects), not music or ambience
    audio.setVolume({ sfx: 0 }); await settle();
    a = g();
    check('effects 0: effects buses 0', a.effects < 1e-4 && a.engine < 1e-4 && a.tyres < 1e-4 && a.ui < 1e-4, JSON.stringify(a));
    check('effects 0: music, ambience, master untouched', near(a.music, base.music) && near(a.world, base.world) && near(a.master, base.master), JSON.stringify(a));
    audio.setVolume({ sfx: 1 }); await settle();
    // ambience 0 affects only the world bus
    audio.setVolume({ ambience: 0 }); await settle();
    a = g();
    check('ambience 0: world bus 0', a.world < 1e-4, a.world);
    check('ambience 0: others untouched', near(a.music, base.music) && near(a.effects, base.effects) && near(a.master, base.master), JSON.stringify(a));
    audio.setVolume({ ambience: 1 }); await settle();
    // mute all: within 0.1 s, sliders not moved
    audio.setVolume({ muteAll: true }); await sleep(100);
    a = g();
    check('mute all silences master within 0.1 s', a.master < 0.01, a.master);
    audio.setVolume({ muteAll: false }); await settle();
    a = g();
    check('unmute restores levels', near(a.master, 0.8) && near(a.music, base.music) && near(a.effects, base.effects), JSON.stringify(a));
    return out;
  });
} finally {
  await browser.close();
  server.close();
}
let bad = 0;
for (const r of res) { if (!r.ok) bad++; console.log((r.ok ? 'ok   ' : 'FAIL ') + r.name + (r.detail ? ' (' + r.detail + ')' : '')); }
process.exit(bad ? 1 : 0);
