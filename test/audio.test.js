// Audio logic and generated sound in node: DSP helpers, measurements,
// spatial maths, the music composer, engine loops and the whole bank
// (JS filter path). Nothing is played; these are measured properties.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRng } from '../src/core/rng.js';
import { warm, harmonize, addNWave, envelope, peak } from '../src/audio/dsp.js';
import { measure, spectrum, centroid, pitchOf, loudness, bandShares } from '../src/audio/analyze.js';
import { dopplerFactor, distanceLowpass, travelDelay } from '../src/audio/spatial.js';
import { createComposer } from '../src/audio/music.js';
import { ENGINES, engineSpec, pointsFor, LOOP_S } from '../src/audio/engines.js';
import { runSpecJS } from '../src/audio/dsp.js';
import { buildAll } from '../scripts/audio-analyze.mjs';

const SR = 22050;
const sine = (f, s = 0.5, a = 0.5) => {
  const d = new Float32Array(Math.round(s * SR));
  for (let i = 0; i < d.length; i++) d[i] = Math.sin((2 * Math.PI * f * i) / SR) * a;
  return d;
};

test('measurements: centroid, pitch and loudness of known signals', () => {
  const s = sine(1000);
  assert.ok(Math.abs(centroid(spectrum(s, SR)) - 1000) < 60);
  assert.ok(Math.abs(pitchOf(sine(110), SR, 40, 500) - 110) < 3);
  assert.ok(loudness(sine(1000, 0.5, 0.5), SR) > loudness(sine(1000, 0.5, 0.1), SR) + 12);
  const m = measure(s, SR, true);
  assert.ok(Math.abs(m.crestDb - 3.01) < 0.2, `crest ${m.crestDb}`);
  assert.equal(m.clipped, 0);
});

test('warm keeps the peak and adds harmonics', () => {
  const s = sine(200);
  const before = bandShares(spectrum(s, SR), [0, 300, 1e9])[1];
  warm(s, 3, 0.3);
  assert.ok(Math.abs(peak(s) - 0.5) < 1e-3);
  assert.ok(bandShares(spectrum(s, SR), [0, 300, 1e9])[1] > before + 0.05);
});

test('harmonize puts low energy where a phone speaker can play it', () => {
  const s = sine(55, 1, 0.8);
  const above = (d) => 1 - bandShares(spectrum(d, SR), [0, 100, 1e9])[0];
  const a0 = above(s);
  harmonize(s, 120, 0.8);
  assert.ok(above(s) > a0 + 0.1, `${a0} -> ${above(s)}`);
});

test('N-wave is zero-mean and envelope decays', () => {
  const d = new Float32Array(1000);
  addNWave(d, 10, 2, 1, SR);
  let sum = 0;
  for (const v of d) sum += v;
  assert.ok(Math.abs(sum) < 1);
  const e = envelope(new Float32Array(SR).fill(1), 0.01, 0.1, SR);
  assert.ok(e[Math.round(0.1 * SR) + Math.round(0.01 * SR)] < 0.4 && e[SR - 1] < 1e-3);
});

test('doppler direction, distance low-pass and delay', () => {
  assert.ok(dopplerFactor(-30) > 1.05, 'approaching is higher');
  assert.ok(dopplerFactor(30) < 0.95, 'receding is lower');
  assert.equal(dopplerFactor(NaN), 1);
  assert.ok(dopplerFactor(-1e6) <= 1.25 && dopplerFactor(1e6) >= 0.8);
  assert.ok(distanceLowpass(0) > distanceLowpass(100) && distanceLowpass(100) > distanceLowpass(400));
  assert.ok(distanceLowpass(1e5) >= 900);
  assert.ok(Math.abs(travelDelay(343) - 1) < 1e-9 && travelDelay(1e6) === 2.5 && travelDelay(-5) === 0);
});

test('music composer: seeded, bars well formed, sections vary', () => {
  const a = createComposer(createRng(7));
  const b = createComposer(createRng(7));
  const c = createComposer(createRng(8));
  assert.deepEqual(a.bar(0), b.bar(0));
  assert.ok(a.tempo >= 88 && a.tempo < 104);
  let kicks = 0, quietBars = 0;
  const first = JSON.stringify(c.bar(0));
  for (let i = 1; i < 40; i++) {
    const notes = a.bar(i);
    assert.ok(notes.length > 4);
    for (const n of notes) {
      assert.ok(n.beat >= 0 && n.beat < 4, 'inside the bar');
      assert.ok(n.vel > 0 && n.vel <= 1);
      assert.ok(Math.abs(n.semi) < 30);
    }
    const k = notes.filter((n) => n.inst === 'kick').length;
    kicks += k;
    if (!k) quietBars++;
  }
  const differs = JSON.stringify(a.bar(40)) !== first;
  assert.ok(kicks > 40 && quietBars >= 4, `kicks ${kicks}, breakdown bars ${quietBars}`);
  assert.ok(differs);
});

// Fundamental by harmonic product over the spectrum (f, 2f, 3f, 4f).
function firing(d, sr) {
  const sp = spectrum(d, sr, 8192);
  const lg = (k) => 10 * Math.log10(Math.max(sp.psd[k - 1] || 0, sp.psd[k], sp.psd[k + 1] || 0) + 1e-20);
  let best = -Infinity, bi = 0;
  for (let k = Math.floor(20 / sp.binHz); k < 400 / sp.binHz; k++) {
    let s = 0;
    for (let h = 1; h <= 4; h++) s += lg(k * h);
    if (s > best) {
      best = s;
      bi = k;
    }
  }
  return bi * sp.binHz;
}

test('engine loops: whole cycles, firing note follows rpm per character', () => {
  const sr = 12000;
  for (const ch of ['i4', 'v8', 'diesel', 'sports']) {
    const e = ENGINES[ch];
    const pts = pointsFor(ch);
    const f = [];
    for (const i of [1, 3]) {
      const sp = engineSpec(ch, pts[i], 1, createRng(3), sr);
      const cycles = (sp.n / sr) * (pts[i] * e.red) / 120;
      assert.ok(Math.abs(cycles - Math.round(cycles)) < 0.02, `${ch} loop holds whole cycles (${cycles})`);
      assert.ok(sp.n / sr > LOOP_S * 0.7, 'long enough not to motorboat');
      const d = runSpecJS(sp);
      assert.ok(d.every(Number.isFinite));
      f.push(firing(d, sr));
    }
    const expect = pts[3] / pts[1];
    const got = f[1] / f[0];
    assert.ok(Math.abs(got / expect - 1) < 0.2, `${ch}: ${f[0].toFixed(0)} -> ${f[1].toFixed(0)} Hz, ratio ${got.toFixed(2)} vs ${expect.toFixed(2)}`);
    const want = (e.cyl * pts[1] * e.red) / 120;
    assert.ok(Math.abs(f[0] / want - 1) < 0.2, `${ch} firing ${f[0].toFixed(0)} Hz vs ${want.toFixed(0)} Hz`);
  }
});

test('the whole bank: finite, never clips, fits memory', () => {
  const bank = buildAll(48000);
  const names = Object.keys(bank.buffers);
  assert.ok(names.length > 180);
  for (const n of names) {
    const b = bank.buffers[n];
    for (let c = 0; c < b.numberOfChannels; c++) {
      const d = b.getChannelData(c);
      const p = peak(d);
      assert.ok(Number.isFinite(p) && p < 0.999, `${n} peak ${p}`);
      assert.ok(p > 0.05, `${n} has signal`);
    }
  }
  assert.ok(bank.bytes < 12.5 * 1048576, `${(bank.bytes / 1048576).toFixed(2)} MB`);
});
