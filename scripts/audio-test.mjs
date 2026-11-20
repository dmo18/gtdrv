// Audio system test in headless Chromium. Bundles a harness with esbuild,
// serves it locally, drives createAudio with a fake game and measures the
// master output with an AnalyserNode. Exits non-zero on any failure.
import { build } from 'esbuild';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { readFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '..');
const out = path.join(repo, 'dist', 'audio-test');

async function loadChromium() {
  try {
    return (await import('playwright')).chromium;
  } catch {
    const require = createRequire(import.meta.url);
    return require('/opt/node-tools/node_modules/playwright').chromium;
  }
}

await mkdir(out, { recursive: true });
await build({
  stdin: {
    resolveDir: repo,
    sourcefile: 'audio-entry.js',
    contents: `
      import { createAudio } from './src/systems/audio.js';
      import { createEvents } from './src/core/events.js';
      window.h = { createAudio, createEvents };
    `,
  },
  bundle: true, platform: 'browser', format: 'esm', outfile: path.join(out, 'harness.js'),
});

const html = '<!doctype html><meta charset="utf-8"><title>audio</title><script type="module" src="/harness.js"></script>';
const js = await readFile(path.join(out, 'harness.js'));
const server = createServer((req, res) => {
  if (req.url === '/harness.js') res.writeHead(200, { 'content-type': 'text/javascript' }).end(js);
  else res.writeHead(200, { 'content-type': 'text/html' }).end(html);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const url = `http://127.0.0.1:${server.address().port}/`;

const errors = [];
const chromium = await loadChromium();
const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
let results;
try {
  const page = await browser.newPage();
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console.error: ${m.text()}`);
  });
  await page.goto(url);
  await page.waitForFunction(() => window.h);
  results = await page.evaluate(async () => {
    const res = [];
    const check = (name, ok, detail = '') => res.push({ name, ok: !!ok, detail: String(detail) });
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const { createAudio, createEvents } = window.h;

    const events = createEvents();
    const held = new Set();
    const mk = (kind, id, maxSpeed, extra = {}) => ({
      kind, spec: { id, maxSpeed }, x: 0, y: 0, z: 0, speed: 0, throttle: 0, slip: 0, rotorSpeed: 0, ...extra,
    });
    const car = mk('car', 'sedan', 45);
    const other = mk('car', 'truck', 30, { x: 20, z: 5, speed: 12 });
    const far = mk('car', 'sedan', 30, { x: 500, z: 0, speed: 20 });
    const game = {
      events, time: 0, paused: false,
      camera: { matrixWorld: { elements: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] } },
      city: { shoreDist: (x) => 120 - x },
      input: { held: (n) => held.has(n) },
      player: { mode: 'car', vehicle: car, x: 0, y: 0, z: 0, heading: 0 },
      vehicles: [car, other, far],
    };

    const audio = createAudio(game);
    check('name', audio.name === 'audio');

    // Before unlock everything is a no-op.
    let threw = null;
    try {
      audio.render(1, 1 / 60);
      for (const e of ['vehicleImpact', 'enter', 'ui', 'reward', 'fail', 'checkpoint', 'splash']) events.emit(e, car, 10);
      audio.setVolume({ master: 0.8 });
      audio.setMuted(false);
    } catch (e) {
      threw = e;
    }
    check('no-op before unlock', !threw && audio.activeVoices === 0, threw && threw.message);

    audio.unlock();
    const ctx = audio.output && audio.output.context;
    check('context created', !!ctx);
    await sleep(100);
    check('context running', ctx && ctx.state === 'running', ctx && ctx.state);
    const an = ctx.createAnalyser();
    an.fftSize = 2048;
    audio.output.connect(an);
    const buf = new Float32Array(an.fftSize);
    let peak = 0;
    let maxVoices = 0;
    let rmsMax = 0;
    function sample() {
      an.getFloatTimeDomainData(buf);
      let s = 0;
      for (let i = 0; i < buf.length; i++) {
        const a = Math.abs(buf[i]);
        if (a > peak) peak = a;
        s += buf[i] * buf[i];
      }
      const rms = Math.sqrt(s / buf.length);
      if (rms > rmsMax) rmsMax = rms;
      if (audio.activeVoices > maxVoices) maxVoices = audio.activeVoices;
      return rms;
    }
    async function run(frames, fn) {
      rmsMax = 0;
      for (let i = 0; i < frames; i++) {
        game.time += 1 / 60;
        fn(i / frames, i);
        audio.render(1, 1 / 60);
        sample();
        await sleep(8);
      }
    }
    const saw = (t, n) => 0.5 + 0.5 * Math.sin(t * n * Math.PI * 2);

    // Car: sweep speed and throttle, with horn and slip.
    for (const id of ['sedan', 'truck', 'sports']) {
      car.spec = { id, maxSpeed: 45 };
      await run(220, (t, i) => {
        car.speed = t * 50;
        car.throttle = saw(t, 3);
        car.slip = i > 150 ? 0.9 : 0;
        if (i === 100) held.add('horn');
        if (i === 140) held.delete('horn');
      });
      check(`car ${id} audible`, rmsMax > 0.003, `rms ${rmsMax.toFixed(4)}`);
    }
    // Idle and hard throttle differ in level.
    car.speed = 0; car.throttle = 0; car.slip = 0;
    await run(60, () => {});
    const idle = rmsMax;
    car.throttle = 1;
    await run(60, () => {});
    check('throttle louder than idle', rmsMax > idle, `${idle.toFixed(4)} -> ${rmsMax.toFixed(4)}`);

    // Boat, plane (prop), jet, heli.
    const crafts = [
      mk('boat', 'runabout', 20, { y: 0 }),
      mk('plane', 'propplane', 80),
      mk('plane', 'jet', 200),
      mk('heli', 'chopper', 60),
    ];
    for (const c of crafts) {
      game.player.vehicle = c;
      game.vehicles[0] = c;
      game.player.y = 40;
      await run(220, (t) => {
        c.speed = t * c.spec.maxSpeed;
        c.throttle = saw(t, 2);
        c.rotorSpeed = Math.min(1, t * 2);
        c.y = t * 60;
      });
      check(`${c.kind}/${c.spec.id} audible`, rmsMax > 0.003, `rms ${rmsMax.toFixed(4)}`);
    }

    // Back to the car for the event tests.
    game.player.vehicle = car;
    game.vehicles[0] = car;
    game.player.y = 0;
    car.speed = 25;
    car.throttle = 0.7;
    await run(60, () => {});

    // Events: each should add a voice (except far crash).
    const before = audio.activeVoices;
    events.emit('vehicleImpact', far, 30);
    events.emit('vehicleCrash', far, { x: 600, z: 0 }, 30);
    check('far crash ignored', audio.activeVoices === before, `${before} -> ${audio.activeVoices}`);
    for (const [name, a, b, c] of [
      ['vehicleImpact', car, 20], ['vehicleCrash', car, other, 25], ['enter'], ['exit'],
      ['ui'], ['reward'], ['fail'], ['checkpoint'], ['splash', car],
    ]) {
      await sleep(150); // clear the crash rate limit
      const v0 = audio.activeVoices;
      events.emit(name, a, b, c);
      check(`event ${name} voice`, audio.activeVoices === v0 + 1, `${v0} -> ${audio.activeVoices}`);
      sample();
    }
    await run(30, () => {});

    // Voice cap.
    for (let i = 0; i < 30; i++) events.emit(i % 2 ? 'ui' : 'checkpoint');
    check('voice cap', audio.activeVoices <= 8, `voices ${audio.activeVoices}`);
    await run(60, () => {});

    // Mute.
    audio.setMuted(true);
    await run(80, () => {});
    await run(20, () => {});
    check('muted near silence', rmsMax < 0.0005, `rms ${rmsMax.toExponential(2)}`);
    audio.setMuted(false);
    await run(80, () => {});
    check('unmuted audible', rmsMax > 0.003, `rms ${rmsMax.toFixed(4)}`);

    // Pause suspends, unpause resumes.
    game.paused = true;
    audio.render(1, 1 / 60);
    await sleep(200);
    check('paused suspends', ctx.state === 'suspended', ctx.state);
    game.paused = false;
    audio.render(1, 1 / 60);
    await sleep(200);
    check('unpaused resumes', ctx.state === 'running', ctx.state);

    // On foot: engine stops, voices drain.
    game.player.vehicle = null;
    game.player.mode = 'foot';
    await run(60, () => {});
    let drained = false;
    for (let i = 0; i < 40 && !drained; i++) {
      await sleep(100);
      audio.render(1, 1 / 60);
      drained = audio.activeVoices === 0;
    }
    check('voices drain to 0', drained, `voices ${audio.activeVoices}`);
    check('peak <= 1', peak <= 1.0, `peak ${peak.toFixed(4)}`);
    check('peak sane', peak > 0.01, `peak ${peak.toFixed(4)}`);
    check('max voices <= 8', maxVoices <= 8, `max ${maxVoices}`);

    audio.dispose();
    check('dispose', true);
    return res;
  });
} finally {
  await browser.close();
  server.close();
}

let failed = 0;
for (const r of results) {
  if (!r.ok) failed++;
  console.log(`${r.ok ? 'ok  ' : 'FAIL'} ${r.name} ${r.detail}`);
}
for (const e of errors) {
  failed++;
  console.log(`FAIL ${e}`);
}
console.log(`${results.length} checks, ${failed} failures`);
process.exit(failed ? 1 : 0);
