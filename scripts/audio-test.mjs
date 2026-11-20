// Audio system test in headless Chromium. Bundles a harness with esbuild,
// serves it locally, drives createAudio with a fake game and measures the
// master output (and the engine bus) with AnalyserNodes. Also checks the
// generated sound bank: generation time, memory, seamless loops without
// DC offset, engine pitch rising with rpm, and the police siren.
// Exits non-zero on any failure.
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

    // The sound bank is generated in slices after unlock.
    const t0 = performance.now();
    while (!audio.debug.ready && performance.now() - t0 < 10000) await sleep(20);
    const dbg = audio.debug;
    check('bank ready', dbg.ready);
    check('generation time < 1500 ms', dbg.genWallMs > 0 && dbg.genWallMs < 1500,
      `wall ${dbg.genWallMs.toFixed(0)} ms, main-thread cpu ${dbg.genCpuMs.toFixed(0)} ms in ${dbg.slices} slices, longest slice ${dbg.maxSliceMs.toFixed(1)} ms, offline ${JSON.stringify(dbg.bankStats)}`);
    const mb = dbg.bytes / 1048576;
    check('buffer memory < 12 MB', mb > 0.5 && mb < 12, `${mb.toFixed(2)} MB in ${Object.keys(dbg.buffers).length} buffers`);

    // Every loop is seamless: the step across the loop point is no bigger
    // than the steps right next to it, and there is no DC offset.
    function checkLoops(tag) {
    let worstSeam = 0;
    let worstSeamName = '';
    let worstDc = 0;
    let badLoops = [];
    for (const name of dbg.loops) {
      const b = dbg.buffers[name];
      for (let c = 0; c < b.numberOfChannels; c++) {
        const d = b.getChannelData(c);
        const n = d.length;
        const jump = Math.abs(d[n - 1] - d[0]);
        let local = 0;
        for (let k = 1; k <= 3; k++) {
          local = Math.max(local, Math.abs(d[k] - d[k - 1]), Math.abs(d[n - k] - d[n - k - 1]));
        }
        let sum = 0;
        for (let i = 0; i < n; i++) sum += d[i];
        const dc = Math.abs(sum / n);
        const ratio = jump / (0.01 + 2.5 * local);
        if (ratio > worstSeam) {
          worstSeam = ratio;
          worstSeamName = name;
        }
        if (dc > worstDc) worstDc = dc;
        if (ratio > 1 || dc > 0.02) badLoops.push(`${name} jump ${jump.toFixed(3)} local ${local.toFixed(3)} dc ${dc.toFixed(3)}`);
      }
    }
    check(`loops seamless (${tag})`, badLoops.length === 0 && dbg.loops.length > 20,
      `${dbg.loops.length} loops, worst seam ${worstSeam.toFixed(2)} of limit (${worstSeamName}) ${badLoops.slice(0, 3).join('; ')}`);
    check(`loops have no DC offset (${tag})`, worstDc < 0.02, `worst ${worstDc.toExponential(1)}`);
    }
    checkLoops('at unlock');

    const an = ctx.createAnalyser();
    an.fftSize = 2048;
    audio.output.connect(an);
    const ean = ctx.createAnalyser();
    ean.fftSize = 2048;
    dbg.buses.engine.connect(ean);
    const buf = new Float32Array(an.fftSize);
    const ebuf = new Float32Array(ean.fftSize);
    let peak = 0;
    let maxVoices = 0;
    let rmsMax = 0;
    let engMax = 0;
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
      ean.getFloatTimeDomainData(ebuf);
      s = 0;
      for (let i = 0; i < ebuf.length; i++) s += ebuf[i] * ebuf[i];
      const er = Math.sqrt(s / ebuf.length);
      if (er > engMax) engMax = er;
      if (audio.activeVoices > maxVoices) maxVoices = audio.activeVoices;
      return rms;
    }
    async function run(frames, fn) {
      rmsMax = 0;
      engMax = 0;
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
    for (const id of ['sedan', 'truck', 'sports', 'compact', 'muscle']) {
      car.spec = { id, maxSpeed: 45 };
      await run(220, (t, i) => {
        car.speed = t * 50;
        car.throttle = saw(t, 3);
        car.slip = i > 150 ? 0.9 : 0;
        if (i === 100) held.add('horn');
        if (i === 140) held.delete('horn');
      });
      check(`car ${id} audible`, rmsMax > 0.003 && engMax > 0.003, `rms ${rmsMax.toFixed(4)} engine ${engMax.toFixed(4)}`);
    }
    // Idle and hard throttle differ in level (engine bus, once settled).
    car.speed = 0; car.throttle = 0; car.slip = 0;
    await run(120, () => {});
    await run(40, () => {});
    const idle = engMax;
    car.throttle = 1;
    await run(60, () => {});
    await run(40, () => {});
    check('throttle louder than idle', engMax > idle * 1.1, `${idle.toFixed(4)} -> ${engMax.toFixed(4)}`);

    // Mix balance while cruising: per-bus levels; the engine must not
    // drown everything else.
    {
      const taps = {};
      const nodes = { ...dbg.buses, reverb: dbg.reverb, master: dbg.master };
      for (const k of Object.keys(nodes)) {
        const a = ctx.createAnalyser();
        a.fftSize = 2048;
        nodes[k].connect(a);
        taps[k] = { a, max: 0, node: nodes[k] };
      }
      const tb = new Float32Array(2048);
      car.speed = 25; car.throttle = 0.6;
      await run(90, () => {
        for (const k of Object.keys(taps)) {
          taps[k].a.getFloatTimeDomainData(tb);
          let s2 = 0;
          for (let i = 0; i < tb.length; i++) s2 += tb[i] * tb[i];
          taps[k].max = Math.max(taps[k].max, Math.sqrt(s2 / tb.length));
        }
      });
      const line = Object.keys(taps).map((k) => `${k} ${taps[k].max.toFixed(3)}`).join(', ');
      check('mix balanced', taps.engine.max < 0.7 * rmsMax * 2 && rmsMax < 0.35, `out ${rmsMax.toFixed(3)}; ${line}`);
      for (const k of Object.keys(taps)) taps[k].node.disconnect(taps[k].a);
    }

    // Boat, plane (prop), jet, heli.
    const crafts = [
      mk('boat', 'runabout', 20, { y: 0 }),
      mk('plane', 'propplane', 80),
      mk('plane', 'jet', 200),
      mk('heli', 'chopper', 60),
      mk('boat', 'fisher', 12, { y: 0 }),
      mk('plane', 'stunt', 72, { stalled: true }),
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
      check(`${c.kind}/${c.spec.id} audible`, rmsMax > 0.003 && engMax > 0.003, `rms ${rmsMax.toFixed(4)} engine ${engMax.toFixed(4)}`);
    }

    // Engine pitch follows rpm (v.rpm given by the car): FFT peak of the
    // engine bus at two rpm values.
    game.player.vehicle = car;
    game.vehicles[0] = car;
    game.player.y = 0;
    car.spec = { id: 'sedan', maxSpeed: 45 };
    const otherSpeed = other.speed;
    other.speed = 0;
    far.speed = 0;
    const fan = ctx.createAnalyser();
    fan.fftSize = 16384;
    fan.smoothingTimeConstant = 0.6;
    dbg.buses.engine.connect(fan);
    const spec = new Float32Array(fan.frequencyBinCount);
    // Average the power spectrum over several analyser frames, then take
    // the lowest clear peak within 10 dB of the loudest.
    async function peakAt(rpm) {
      await run(10, () => {});
      car.rpm = rpm;
      car.gear = 3;
      car.speed = 15;
      car.throttle = 0.6;
      await run(70, () => {});
      const hz = ctx.sampleRate / fan.fftSize;
      const i0 = Math.floor(20 / hz);
      const i1 = Math.ceil(700 / hz);
      const avg = new Float32Array(i1 + 2);
      const frames = 8;
      for (let f = 0; f < frames; f++) {
        await run(6, () => {});
        fan.getFloatFrequencyData(spec);
        for (let i = i0; i < i1 + 2; i++) avg[i] += 10 ** (spec[i] / 10) / frames;
      }
      for (let i = i0; i < i1 + 2; i++) avg[i] = 10 * Math.log10(avg[i] + 1e-12);
      let best = -Infinity;
      for (let i = i0; i < i1; i++) best = Math.max(best, avg[i]);
      for (let i = i0 + 2; i < i1 - 2; i++) {
        const v = avg[i];
        if (v > best - 10 && v >= avg[i - 1] && v >= avg[i + 1] && v >= avg[i - 2] && v >= avg[i + 2]) return i * hz;
      }
      return 0;
    }
    const fLow = await peakAt(0.2);
    const fHigh = await peakAt(0.6);
    // The fundamental rises with rpm: the frequency ratio follows the rpm
    // ratio (3x) to within 25 percent, not an absolute peak position.
    const ratio = fHigh / (fLow || 1);
    check('engine pitch rises with rpm', fLow > 0 && ratio > 3 * 0.75 && ratio < 3 * 1.25, `${fLow.toFixed(0)} Hz at 0.2 -> ${fHigh.toFixed(0)} Hz at 0.6 (ratio ${ratio.toFixed(2)}, rpm ratio 3)`);
    delete car.rpm;
    delete car.gear;
    other.speed = otherSpeed;
    far.speed = 20;

    // Police siren starts and stops with the event, at the police car.
    const cop = mk('car', 'police', 52, { x: 25, z: 8, speed: 10, police: true, siren: true });
    game.vehicles.push(cop);
    const san = ctx.createAnalyser();
    san.fftSize = 2048;
    for (let i = 0; i < 200 && !audio.debug.siren; i++) await sleep(20);
    audio.debug.siren.connect(san);
    const sbuf = new Float32Array(san.fftSize);
    const sirenRms = () => {
      san.getFloatTimeDomainData(sbuf);
      let s = 0;
      for (let i = 0; i < sbuf.length; i++) s += sbuf[i] * sbuf[i];
      return Math.sqrt(s / sbuf.length);
    };
    await run(20, () => {});
    const sOff0 = sirenRms();
    events.emit('siren', true);
    let sOn = 0;
    await run(60, () => { sOn = Math.max(sOn, sirenRms()); });
    events.emit('siren', false);
    await run(90, () => {});
    const sOff = sirenRms();
    check('siren starts with event', audio.debug.sirenOn === false && sOn > 0.01 && sOff0 < 0.001, `off ${sOff0.toExponential(1)} on ${sOn.toFixed(4)}`);
    check('siren stops with event', sOff < 0.001, `after ${sOff.toExponential(1)}`);
    game.vehicles.pop();

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

    // ---- Combat sounds: generated, bounded, positioned, drained ----
    {
      const names = ['gunPistol0', 'gunPistol1', 'gunSmg0', 'gunScatter', 'gunLobber', 'blast0', 'blast1', 'thwack0', 'bodyHit0',
        'impact0', 'ricochet0', 'whiz0', 'reloadA', 'reloadB', 'emptyClick',
        'pin', 'tink0', 'tink1', 'whistle', 'beep', 'lockSeek', 'lockOn', 'abroar', 'spotClick', 'shockThump'];
      const t1 = performance.now();
      while (names.some((n) => !audio.debug.buffers[n]) && performance.now() - t1 < 8000) {
        audio.render(1, 1 / 60);
        await sleep(30);
      }
      const B = audio.debug.buffers;
      const missing = names.filter((n) => !B[n]);
      check('combat buffers generated', missing.length === 0, missing.join(' '));
      const weak = [];
      let cbytes = 0;
      for (const n of names) {
        const d = B[n] && B[n].getChannelData(0);
        if (!d) continue;
        let pk = 0;
        let sum2 = 0;
        let bad = false;
        for (let i = 0; i < d.length; i++) {
          const a = Math.abs(d[i]);
          if (!(a <= 1)) bad = true;
          if (a > pk) pk = a;
          sum2 += d[i] * d[i];
        }
        cbytes += d.length * 4;
        if (bad || pk < 0.3 || Math.sqrt(sum2 / d.length) < 0.01) weak.push(`${n} pk ${pk.toFixed(2)}`);
      }
      check('combat buffers have signal and no clipping', weak.length === 0, weak.join('; '));
      check('combat buffer memory < 2 MB', cbytes < 2 * 1048576, `${(cbytes / 1048576).toFixed(2)} MB listed`);

      game.vehicles.length = 0; // quiet street: no other engines
      const walker = { x: 0, z: 0, hp: 100, team: 'player' };
      game.player.walker = walker;
      const other = { x: 20, z: 0, team: 'crew' };
      const payload = (w, x, z, hk = 'none') => ({ shooter: other, weapon: w, x, y: 1.4, z, dx: 1, dy: 0, dz: 0, hx: x + 30, hy: 1.4, hz: z, hitKind: hk });
      // Each event starts a voice (a gap between them clears rate limits).
      const cases = [
        ['shot pistol', 'shot', payload('pistol', 10, 6)],
        ['shot smg', 'shot', payload('smg', 10, 6)],
        ['shot scatter', 'shot', payload('scatter', 10, 6)],
        ['shot lobber', 'shot', payload('lobber', 10, 6)],
        ['shot fizz', 'shot', payload('fizz', 10, 6)],
        ['shot wrench swing', 'shot', payload('wrench', 1, 0)],
        ['hit bullet actor', 'hit', { target: other, source: walker, amount: 9, kind: 'bullet', x: 5, y: 1, z: 2 }],
        ['hit bullet craft', 'hit', { target: car, source: other, amount: 9, kind: 'bullet', x: 5, y: 1, z: 2 }],
        ['hit melee', 'hit', { target: other, source: walker, amount: 9, kind: 'melee', x: 1, y: 1, z: 0 }],
        ['down', 'down', { target: other, source: walker, kind: 'bullet' }],
        ['explosion', 'explosion', { x: 25, y: 1, z: 5, radius: 8, source: null, depth: 0 }],
        ['burning', 'burning', { craft: car, on: true }],
        ['reload', 'reload', { actor: walker, weapon: 'pistol' }],
        ['empty', 'empty', { actor: walker, weapon: 'pistol' }],
        ['weaponSwitch', 'weaponSwitch', { actor: walker, weapon: 'smg' }],
        ['playerDown', 'playerDown', {}],
        // docs/ARMS.md section 7
        ['shot fizz (pin)', 'shot', payload('fizz', 2, 0)],
        ['launch missile', 'launch', { shooter: walker, craft: null, weapon: 'missile', x: 8, y: 20, z: 0 }],
        ['launch bomb', 'launch', { shooter: walker, craft: null, weapon: 'bomb', x: 8, y: 20, z: 0 }],
        ['launch shell', 'launch', { shooter: walker, craft: null, weapon: 'cannon', x: 8, y: 1, z: 0 }],
        ['bombFall whistle', 'bombFall', { index: 0, x: 10, y: 20, z: 0, vy: 0 }],
        ['sticky beep', 'sticky', { x: 3, y: 0, z: 1, on: true, beep: true, index: 0 }],
        ['sticky stuck', 'sticky', { x: 3, y: 0, z: 1, on: true, beep: false, index: 0 }],
        ['bounce tink', 'bounce', { x: 3, y: 0, z: 1, v: 9, weapon: 'fizz' }],
        ['detonate click', 'detonate', { count: 2 }],
        ['huge explosion', 'explosion', { x: 25, y: 1, z: 5, radius: 11, source: null, depth: 0, size: 'huge', puff: false }],
      ];
      // ricochet / impact strike on a wall
      cases.push(['shot wall strike', 'shot', payload('pistol', 10, 6, 'wall')]);
      for (const [label, name, pl] of cases) {
        await sleep(260);
        audio.render(1, 1 / 60);
        const v0 = audio.activeVoices;
        events.emit(name, pl);
        check(`combat ${label} voice`, audio.activeVoices > v0, `${v0} -> ${audio.activeVoices}`);
        sample();
      }
      // A strike on a wall may play an impact or a ricochet; both are voices. A far
      // gunfight is silent.
      await sleep(300);
      let v0 = audio.activeVoices;
      events.emit('shot', payload('smg', 900, 0));
      events.emit('explosion', { x: 3000, y: 0, z: 0, radius: 8, source: null, depth: 0 });
      check('far combat ignored', audio.activeVoices === v0, `${v0} -> ${audio.activeVoices}`);

      // Distance: the same blast is quieter far away; pan follows the side.
      const split = ctx.createChannelSplitter(2);
      audio.output.connect(split);
      const aL = ctx.createAnalyser();
      const aR = ctx.createAnalyser();
      aL.fftSize = aR.fftSize = 2048;
      split.connect(aL, 0);
      split.connect(aR, 1);
      const bl = new Float32Array(2048);
      const br = new Float32Array(2048);
      // rms: energy over the whole window (steadier than a peak pick).
      async function measure(fn, rms = false) {
        let l = 0;
        let r = 0;
        let sl = 0;
        let sr = 0;
        let n = 0;
        for (let i = 0; i < 60 && audio.activeVoices > 0; i++) {
          await sleep(100);
          audio.render(1, 1 / 60);
        }
        await sleep(500);
        fn();
        for (let i = 0; i < 40; i++) {
          audio.render(1, 1 / 60);
          await sleep(15);
          aL.getFloatTimeDomainData(bl);
          aR.getFloatTimeDomainData(br);
          for (let k = 0; k < 2048; k++) {
            l = Math.max(l, Math.abs(bl[k]));
            r = Math.max(r, Math.abs(br[k]));
            sl += bl[k] * bl[k];
            sr += br[k] * br[k];
          }
          n += 2048;
        }
        return rms ? [Math.sqrt(sl / n), Math.sqrt(sr / n)] : [l, r];
      }
      const exp = (x) => () => events.emit('explosion', { x, y: 0, z: 0, radius: 8, source: null, depth: 0 });
      const nearB = await measure(exp(15));
      const farB = await measure(exp(250));
      check('explosion audible', Math.max(...nearB) > 0.02, `peak ${Math.max(...nearB).toFixed(3)}`);
      check('explosion falls off with distance', Math.max(...farB) < Math.max(...nearB) * 0.6, `near ${Math.max(...nearB).toFixed(3)} far ${Math.max(...farB).toFixed(3)}`);
      // The pan check hears only the effects bus: the engine, tyre and
      // ambience buses are cut from the master for this measurement (the
      // engine never goes silent and its level drifts, which swamped the
      // small left-right difference). Compared as RMS over a long window.
      const cut = ['engine', 'tyres', 'world'].filter((k) => dbg.buses[k]);
      for (const k of cut) dbg.buses[k].disconnect(dbg.master);
      const quiet = await measure(() => {}, true);
      const rightB = await measure(() => events.emit('shot', payload('scatter', 25, 0)), true);
      const leftB = await measure(() => events.emit('shot', payload('scatter', -25, 0)), true);
      for (const k of cut) dbg.buses[k].connect(dbg.master);
      // Balance index -1 (all left) .. +1 (all right), independent of loudness.
      const bal = (v) => (v[1] - v[0]) / (v[1] + v[0] + 1e-9);
      check('shot pans to its side', rightB[1] > rightB[0] && leftB[0] > leftB[1] && bal(rightB) - bal(leftB) > 0.12,
        `quiet rms ${quiet.map((v) => v.toFixed(4))}; right src L ${rightB[0].toFixed(4)} R ${rightB[1].toFixed(4)} (bal ${bal(rightB).toFixed(2)}); left src L ${leftB[0].toFixed(4)} R ${leftB[1].toFixed(4)} (bal ${bal(leftB).toFixed(2)})`);

      // A storm of events stays within the voice cap and the limiter.
      peak = 0;
      maxVoices = 0;
      for (let i = 0; i < 60; i++) {
        events.emit('shot', payload(i % 3 ? 'smg' : 'scatter', 8 + (i % 5), 3, i % 2 ? 'wall' : 'actor'));
        events.emit('hit', { target: other, source: walker, amount: 5, kind: 'bullet', x: 4, y: 1, z: 1 });
        if (i % 12 === 0) events.emit('explosion', { x: 10 + i, y: 0, z: 3, radius: 8, source: null, depth: 0 });
        audio.render(1, 1 / 60);
        sample();
        await sleep(5);
      }
      check('combat storm within voice cap', maxVoices <= 8, `max ${maxVoices}`);
      check('combat storm does not clip', peak <= 1.0, `peak ${peak.toFixed(3)}`);
      let drained2 = false;
      for (let i = 0; i < 60 && !drained2; i++) {
        await sleep(100);
        audio.render(1, 1 / 60);
        drained2 = audio.activeVoices === 0;
      }
      check('combat voices drain to 0', drained2, `voices ${audio.activeVoices}`);
      split.disconnect();
    }

    // Engines made on first use: all characters are in the bank now.
    const fin = audio.debug;
    check('all engines generated', fin.bankStats.engines.length === 8, fin.bankStats.engines.join(' '));
    checkLoops('all engines');
    const mb2 = fin.bytes / 1048576;
    check('total buffer memory < 12 MB', mb2 < 12, `${mb2.toFixed(2)} MB in ${Object.keys(fin.buffers).length} buffers; whole bank after ${fin.fullMs.toFixed(0)} ms; background generation (extras + later engines) ${fin.lazyMs.toFixed(0)} ms main-thread`);

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
