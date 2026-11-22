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

// ---- A1: the eight phone-check sounds (owner: "harsh and crackly") ----
import { safetyCurve, bassCurve, SAFETY_CEIL, BASS_HELPER } from '../src/audio/master.js';

test('master curves: safety curve linear, under -1 dBFS; bass helper curve smooth', () => {
  const c = safetyCurve();
  const n = c.length;
  let max = 0;
  for (let i = 1; i < n; i++) {
    assert.ok(c[i] >= c[i - 1], 'monotonic');
    max = Math.max(max, Math.abs(c[i]));
  }
  assert.ok(max <= SAFETY_CEIL + 1e-6 && 20 * Math.log10(max) < -1, `ceiling ${max}`);
  const at = (x) => c[Math.round(((x + 1) / 2) * (n - 1))];
  assert.ok(Math.abs(at(0.5) - 0.5) < 2e-3, 'linear well below the knee');
  // the bass curve: zero at rest, no corner (second difference small
  // everywhere, as against the old |tanh| rectifier), helper mixed low
  const b = bassCurve();
  const m = b.length;
  const mid = (m - 1) / 2;
  assert.ok(Math.abs(b[Math.floor(mid)]) < 0.01 && Math.abs(b[Math.ceil(mid)]) < 0.01);
  let worst = 0;
  for (let i = 1; i < m - 1; i++) worst = Math.max(worst, Math.abs(b[i + 1] - 2 * b[i] + b[i - 1]));
  const old = (x) => Math.tanh(3 * x) * 0.5 + Math.abs(Math.tanh(2.4 * x)) * 0.6;
  const h = 2 / (m - 1);
  const oldCorner = Math.abs(old(h) - 2 * old(0) + old(-h));
  assert.ok(worst < oldCorner / 4, `curvature ${worst} vs old corner ${oldCorner}`);
  assert.ok(BASS_HELPER <= 0.25);
});

test('phone-check sounds: peaks under -1 dBFS, sane RMS, no harsh top, right character', () => {
  const bank = buildAll(48000);
  const B = bank.buffers;
  const get = (name) => {
    const x = B[name];
    assert.ok(x, `${name} exists`);
    return { d: x.getChannelData(0), sr: x.sampleRate, loop: bank.loops.includes(name) };
  };
  const above = (d, sr, f) => 1 - bandShares(spectrum(d, sr), [0, f, 1e9])[0];
  const between = (d, sr, lo, hi) => bandShares(spectrum(d, sr), [0, lo, hi, 1e9])[1];
  const names = ['eng:v6:0:on', 'eng:v6:2:on', 'eng:v6:4:on', 'eng:v8:4:on', 'eng:sports:4:on', 'eng:i4:4:on', 'squeal',
    'gunPistol0', 'gunPistol1', 'gunSmg0', 'blastCrack0', 'blastBody0', 'blastThump', 'blastTail', 'sirenWail', 'sirenYelp',
    'm:bass', 'm:pad', 'm:pluck', 'm:kick', 'm:snare', 'm:hat', 'boostWhoosh'];
  for (const n of names) {
    const { d, sr, loop } = get(n);
    const m = measure(d, sr, loop);
    assert.equal(m.clipped, 0, `${n} clips`);
    assert.ok(m.peakDb < -1, `${n} peak ${m.peakDb.toFixed(2)} dBFS`);
    assert.ok(m.rmsDb > -30 && m.rmsDb < -5, `${n} RMS ${m.rmsDb.toFixed(1)} dBFS`);
    let s = 0;
    for (let i = 0; i < d.length; i++) s += d[i];
    assert.ok(Math.abs(s / d.length) < 0.01, `${n} DC`);
    if (!loop) {
      // no click at either end
      assert.ok(Math.abs(d[0]) < 0.02 && Math.abs(d[d.length - 1]) < 0.01, `${n} edges ${d[0]} ${d[d.length - 1]}`);
    }
  }
  // engines: no fizz above 4.5 kHz (it was overdriven up to the 6 kHz Nyquist)
  for (const n of ['eng:v6:4:on', 'eng:v8:4:on', 'eng:sports:4:on', 'eng:i4:4:on']) {
    const { d, sr } = get(n);
    assert.ok(above(d, sr, 4500) < 0.01, `${n} above 4.5 kHz ${above(d, sr, 4500)}`);
    assert.ok(between(d, sr, 300, 4000) > 0.25, `${n} carries on a phone (${between(d, sr, 300, 4000).toFixed(2)})`);
  }
  // tyre squeal: band noise around 1 to 3 kHz, not saturated into a dense block
  {
    const { d, sr } = get('squeal');
    const m = measure(d, sr, true);
    assert.ok(m.crestDb > 10, `squeal crest ${m.crestDb.toFixed(1)} (was 9.6, saturated)`);
    assert.ok(m.bands[3] > 0.6 && above(d, sr, 4500) < 0.02);
  }
  // siren: a clean near-sine sweep in the 500 Hz..2 kHz band, almost no upper harmonics
  for (const n of ['sirenWail', 'sirenYelp']) {
    const { d, sr } = get(n);
    assert.ok(between(d, sr, 450, 2600) > 0.95, `${n} in band ${between(d, sr, 450, 2600)}`);
    assert.ok(above(d, sr, 3000) < 0.005, `${n} upper harmonics ${above(d, sr, 3000)}`);
  }
  // gunshot: a crack and a body with a low thump, not a lone tick
  for (const n of ['gunPistol0', 'gunSmg0']) {
    const { d, sr } = get(n);
    const m = measure(d, sr, false);
    assert.ok(m.crestDb < 21.5, `${n} crest ${m.crestDb.toFixed(1)} (pistol was 22.8)`);
    assert.ok(bandShares(spectrum(d, sr), [0, 400, 1e9])[0] > 0.25, `${n} low thump`);
    assert.ok(between(d, sr, 1000, 4000) > 0.1, `${n} crack`);
    assert.ok(above(d, sr, 7000) < 0.01, `${n} no fizz`);
  }
  // blast: long decay with a low drop, the crack not saturated noise
  {
    const body = get('blastBody0');
    assert.ok(measure(body.d, body.sr, false).decay > 1.5);
    const tail = get('blastTail');
    assert.ok(measure(tail.d, tail.sr, false).decay > 3);
    const crack = get('blastCrack0');
    assert.ok(above(crack.d, crack.sr, 7000) < 0.03, 'blast crack top');
  }
  // boost: the low-pass opens, so the sound rises: centroid of the
  // second quarter is above that of the first 0.12 s
  {
    const { d, sr } = get('boostWhoosh');
    const seg = (a, b) => centroid(spectrum(d.slice(Math.round(a * sr), Math.round(b * sr)), sr, 512));
    assert.ok(seg(0.3, 0.6) > seg(0, 0.15) * 1.4, `boost sweep ${seg(0, 0.15).toFixed(0)} -> ${seg(0.3, 0.6).toFixed(0)} Hz`);
  }
});

test('music composer stays in key: every pitched note is a degree of its mode', () => {
  const c = createComposer(createRng(11));
  for (let i = 0; i < 64; i++) {
    for (const nt of c.bar(i)) {
      if (nt.inst === 'kick' || nt.inst === 'snare' || nt.inst === 'hat') continue;
      const deg = ((((nt.semi - c.root) % 12) + 12) % 12);
      assert.ok(c.mode.includes(deg), `bar ${i} ${nt.inst} degree ${deg}`);
    }
  }
  assert.ok(c.tempo >= 88 && c.tempo < 104);
});
