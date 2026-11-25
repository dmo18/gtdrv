// The sound library: every sample buffer the game plays, generated once
// at unlock. Work is split into small jobs that the audio system runs a
// few milliseconds at a time, so the page never freezes. Excitations
// (pulse trains, noise, tones) are made in JS; the heavy filtering of
// loops runs in OfflineAudioContexts on the audio thread (JS fallback
// when that is missing). Loops are seamless; one-shots fade cleanly.

import { createRng } from '../core/rng.js';
import {
  SR, R, TAU, biquad, filter, lp1, svf, white, gauss, smoothRandom, removeDC, normalize, peak,
  fadeEdges, soft, addMode, addBurst, runSpecJS, harmonize,
} from './dsp.js';
import { ENGINES, pointsFor, engineSpec, normalizeSet } from './engines.js';
import { TURBINE_LOOPS, TURBINE_SHOTS } from './turbine.js'; // fighter, police heli (task 33)
import { TANK_LOOPS, TANK_SHOTS } from './tanksounds.js'; // tank (task 32)
import { COMBAT_SHOTS, COMBAT_VARIANTS } from './combatsounds.js';
import { CAR_LOOPS, CAR_SHOTS } from './carsounds.js';
import { MUSIC_SHOTS } from './music.js';
import { RADIO_SHOTS, RADIO_LOW } from './radiosounds.js';

const len = (s) => Math.round(s * R.sr);
const z = (n) => new Float32Array(n);
const nowMs = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

// Band-limited buzzy wave as a one-period table (K harmonics), read
// with linear interpolation by phase in cycles.
const TBL = 2048;
function buzzTable(K, evenGain = 0.5) {
  const t = z(TBL + 1);
  for (let i = 0; i < TBL; i++) {
    const ph = (TAU * i) / TBL;
    let s = 0;
    for (let k = 1; k <= K; k++) s += (Math.sin(ph * k) / k) * (k % 2 ? 1 : evenGain);
    t[i] = s;
  }
  t[TBL] = t[0];
  return t;
}
function harmTable(amps) {
  const t = z(TBL + 1);
  for (let i = 0; i < TBL; i++) {
    let v = 0;
    for (let k = 0; k < amps.length; k++) v += amps[k] * Math.sin((TAU * (k + 1) * i) / TBL);
    t[i] = v;
  }
  t[TBL] = t[0];
  return t;
}
let gullTable = null;
function look(t, cyc) {
  const x = (cyc - Math.floor(cyc)) * TBL;
  const i = x | 0;
  return t[i] + (t[i + 1] - t[i]) * (x - i);
}


// ---------------------------------------------------------------- loops
// Each loop returns either a finished Float32Array (pure JS synthesis)
// or a filter spec (see dsp.js) whose filtering runs offline.
const spec = (n, parts, finish, post = []) => ({ sr: R.sr, n, loop: true, parts, post, finish });
const am = (out, m, base, depth) => {
  for (let i = 0; i < out.length; i++) out[i] *= base + depth * m[i];
  return out;
};
const done = (to) => (out) => normalize(removeDC(out), to);

const LOOPS = {
  road(rng) {
    const n = len(2);
    const m = smoothRandom(n, 36, rng);
    return spec(n, [{ x: white(n, rng), bands: [['lp', 240, 0.7, 1.8], ['bp', 780, 0.8, 0.55], ['bp', 2500, 1, 0.14]] }],
      (out) => normalize(removeDC(am(out, m, 0.8, 0.2)), 0.8));
  },
  squeal(rng) {
    const n = len(1.6);
    const m = smoothRandom(n, 21, rng);
    // Filtered band noise around 1.2 and 1.8 kHz (the rubber's stick-slip
    // note), wide enough to read as a tire, not a whistle; no saturation.
    // The audio system moves its pitch with the slip.
    return spec(n, [{ x: white(n, rng), bands: [['bp', 1185, 11, 3], ['bp', 1793, 9, 2.2], ['bp', 2716, 6, 0.6], ['bp', 700, 2, 0.25]] }], (out) => {
      for (let i = 0; i < n; i++) out[i] *= 0.72 + 0.16 * Math.sin((TAU * 5 * i) / n) + 0.12 * m[i];
      lp1(out, 4200, { loop: true, passes: 2 });
      return normalize(removeDC(out), 0.7);
    });
  },
  gravel(rng) {
    const n = len(2);
    const g = z(n);
    for (let k = 0; k < 1900; k++) {
      const a = rng.next();
      addBurst(g, Math.floor(rng.next() * n), 0.0004 + rng.next() * 0.0012, a * a, rng, { loop: true, attack: 0 });
    }
    return spec(n, [
      { x: g, bands: [['bp', 2300, 0.6, 1.4], ['bp', 850, 0.8, 0.7]] },
      { x: white(n, rng), bands: [['lp', 170, 0.7, 0.9]] },
    ], done(0.8));
  },
  wet(rng) {
    const n = len(2);
    const m = smoothRandom(n, 70, rng);
    return spec(n, [{ x: white(n, rng), bands: [['hp', 1500, 0.7, 1]] }],
      (out) => normalize(removeDC(am(out, m, 0.75, 0.25)), 0.45), [['lp', 4200, 0.7]]);
  },
  wind(rng) {
    const n = len(2.5);
    const m = smoothRandom(n, 7, rng);
    return spec(n, [{ x: white(n, rng), bands: [['lp', 420, 0.6, 2], ['bp', 950, 0.7, 0.35]] }],
      (out) => normalize(removeDC(am(out, m, 0.62, 0.38)), 0.8));
  },
  wash(rng) {
    const n = len(2);
    const m = smoothRandom(n, 90, rng);
    for (let i = 0; i < n; i++) m[i] = Math.abs(m[i]);
    return spec(n, [{ x: white(n, rng), bands: [['bp', 1100, 0.6, 1], ['hp', 3500, 0.7, 0.35], ['lp', 260, 0.7, 1]] }],
      (out) => normalize(removeDC(am(out, m, 0.55, 0.45)), 0.8));
  },
  rain(rng) {
    const n = len(2);
    const imp = z(n);
    for (let k = 0; k < 2600; k++) {
      const a = rng.next();
      imp[Math.floor(rng.next() * n)] += (rng.next() < 0.5 ? -1 : 1) * a * a;
    }
    return spec(n, [
      { x: imp, bands: [['bp', 2900, 3, 1], ['bp', 5200, 4, 0.6], ['bp', 1300, 2, 0.3]] },
      { x: white(n, rng), bands: [['hp', 900, 0.7, 0.08]] },
    ], done(0.75));
  },
  buffet(rng) {
    const n = len(1.5);
    const m = smoothRandom(n, 17, rng);
    const thumps = [];
    for (let k = 0; k < 16; k++) thumps.push([Math.floor(rng.next() * n), 32 + rng.next() * 30, 0.4 + rng.next() * 0.5]);
    return spec(n, [{ x: white(n, rng), bands: [['lp', 85, 1.2, 3]] }], (out) => {
      for (const [at, f, a] of thumps) addMode(out, at, f, 0.04, a, R.sr, 0, true);
      return normalize(removeDC(am(out, m, 0.6, 0.4)), 0.85);
    });
  },
  jetroar(rng) {
    const n = len(2);
    const m = smoothRandom(n, 11, rng);
    return spec(n, [{ x: white(n, rng), bands: [['lp', 900, 0.6, 1.6], ['bp', 330, 0.8, 0.6], ['hp', 2600, 0.7, 0.2]] }],
      (out) => normalize(removeDC(am(out, m, 0.9, 0.1)), 0.8));
  },
  turbine(rng) {
    const n = R.sr; // exactly 1 s, so whole-Hz tones loop
    const tones = [[1730, 1], [2617, 0.45], [3481, 0.3], [4409, 0.16], [871, 0.22]];
    const phases = tones.map(() => rng.next() * TAU);
    return spec(n, [{ x: white(n, rng), bands: [['bp', 1730, 70, 2.5], ['bp', 2617, 70, 1.1], ['hp', 5000, 0.7, 0.06]] }], (out) => {
      for (let k = 0; k < tones.length; k++) {
        const w = (TAU * tones[k][0]) / R.sr;
        const a = tones[k][1] * 0.5;
        for (let i = 0; i < n; i++) out[i] += Math.sin(w * i + phases[k]) * a;
      }
      return normalize(removeDC(out), 0.45);
    });
  },
  rotor(rng) {
    // 8 blade passes at a reference rate of 14 Hz
    const passes = 8;
    const n = Math.round((passes / 14) * R.sr);
    const per = n / passes;
    const sr = R.sr;
    const slap = z(n);
    return spec(n, [{ x: white(n, rng), bands: [['bp', 520, 0.7, 1]] }], (out) => {
      for (let i = 0; i < n; i++) {
        const u = (i % per) / per;
        out[i] *= 0.35 * u * u * u;
      }
      const sig = 0.0012 * sr;
      for (let k = 0; k < passes; k++) {
        const at = Math.floor(k * per);
        const a = k % 2 ? 0.85 : 1;
        for (let j = -Math.ceil(sig * 5); j < sig * 5; j++) {
          const x = j / sig;
          out[(at + j + n) % n] += -x * Math.exp(-0.5 * x * x) * a * 1.4;
        }
        addMode(out, at, 46, 0.03, 0.9 * a, sr, 0, true);
        addMode(out, at, 110, 0.012, 0.4 * a, sr, 0, true);
        // the slap itself: a short broadband crack of air
        addBurst(slap, at, 0.004, a, rng, { loop: true, attack: 0.0008 });
      }
      filter(slap, out, biquad('bp', 900, 0.8, sr), { gain: 0.9, add: true });
      filter(slap, out, biquad('bp', 320, 1.2, sr), { gain: 0.8, add: true });
      harmonize(out, 120, 0.7, { loop: true, sr, hi: 1000 });
      return normalize(removeDC(out), 0.85);
    });
  },
  tail(rng) {
    const pulses = 22;
    const n = Math.round((pulses / 88) * R.sr);
    const exc = z(n);
    for (let k = 0; k < pulses; k++) exc[Math.floor((k * n) / pulses)] += 1 + 0.1 * gauss(rng);
    return spec(n, [
      { x: exc, bands: [['bp', 640, 2, 3], ['bp', 1350, 3, 1.5], ['lp', 240, 0.8, 1]] },
      { x: white(n, rng), bands: [['bp', 900, 1, 0.05]] },
    ], done(0.8));
  },
  scrape(rng) {
    const n = len(1.2);
    const a = z(n);
    for (let k = 0; k < 42; k++) a[Math.floor(rng.next() * n)] += 0.5 + rng.next();
    lp1(a, 18);
    const p = peak(a) || 1;
    for (let i = 0; i < n; i++) a[i] /= p;
    return spec(n, [{ x: white(n, rng), bands: [['bp', 1350, 22, 4], ['bp', 2240, 28, 3.2], ['bp', 3650, 20, 2.4], ['bp', 5100, 24, 1.4], ['bp', 520, 1, 0.5]] }],
      (out) => normalize(removeDC(am(out, a, 0.4, 0.6)), 0.8));
  },
  city(rng) {
    const n = len(3);
    const m = smoothRandom(n, 5, rng);
    // a couple of distant vehicles passing within the bed
    const pass = white(n, rng);
    const env = z(n);
    for (let k = 0; k < 3; k++) {
      const c = rng.next() * n;
      const w = (0.5 + rng.next() * 0.6) * R.sr;
      for (let i = 0; i < n; i++) {
        let d = Math.abs(i - c);
        if (d > n / 2) d = n - d;
        const q = d / w;
        if (q < 3) env[i] += Math.exp(-q * q);
      }
    }
    for (let i = 0; i < n; i++) pass[i] *= env[i];
    return spec(n, [
      { x: white(n, rng), bands: [['lp', 130, 0.7, 3.2], ['bp', 380, 0.7, 0.55], ['hp', 2200, 0.7, 0.05]] },
      { x: pass, bands: [['bp', 620, 0.9, 0.35]] },
    ], (out) => normalize(removeDC(am(out, m, 0.75, 0.25)), 0.8));
  },
  crickets(rng) {
    const n = len(3);
    const out = z(n);
    const kinds = [[4150, 0.6, 1], [4420, 0.72, 0.7], [4760, 0.85, 0.55], [3920, 1.0, 0.4]];
    const pl = Math.round(0.016 * R.sr);
    const env = z(pl);
    for (let j = 0; j < pl; j++) env[j] = Math.sin((Math.PI * j) / pl) ** 2;
    for (const [f, period, amp] of kinds) {
      const chirps = Math.max(1, Math.round(3 / period));
      const step = n / chirps;
      const off = rng.next() * step;
      const pulses = 3 + Math.floor(rng.next() * 2);
      const gap = Math.round(0.036 * R.sr);
      for (let c = 0; c < chirps; c++) {
        const a0 = amp * (0.8 + 0.2 * rng.next());
        for (let p = 0; p < pulses; p++) {
          const at = Math.floor(off + c * step + p * gap);
          const w = (TAU * f * (1 + 0.004 * gauss(rng))) / R.sr;
          for (let j = 0, i = at % n; j < pl; j++) {
            out[i] += Math.sin(w * j) * env[j] * a0;
            if (++i >= n) i = 0;
          }
        }
      }
    }
    return normalize(removeDC(out), 0.7);
  },
  surf(rng) {
    const n = len(5.5);
    const sr = R.sr;
    const eC = z(n);
    const eF = z(n);
    for (const w0 of [0.2, 2.4]) {
      const at = Math.floor((w0 + rng.next() * 0.4) * sr);
      const amp = 0.7 + rng.next() * 0.3;
      const rise = Math.floor(0.5 * sr);
      const dc = Math.exp(-1 / (1.1 * sr));
      const df = Math.exp(-1 / (1.6 * sr));
      let c = amp;
      let f = amp;
      for (let j = 0, i = at; j < n; j++) {
        if (j < rise) {
          const r = j / rise;
          eC[i] += amp * r * r;
        } else {
          eC[i] += c;
          c *= dc;
        }
        const tf = j - Math.floor(0.7 * sr);
        if (tf > 0) {
          eF[i] += f * Math.min(1, tf / (0.3 * sr));
          f *= df;
        }
        if (++i >= n) i = 0;
      }
    }
    const a = white(n, rng);
    for (let i = 0; i < n; i++) a[i] *= 0.12 + eC[i];
    const b = white(n, rng);
    for (let i = 0; i < n; i++) b[i] *= eF[i];
    return spec(n, [
      { x: a, bands: [['lp', 2200, 0.6, 1]] },
      { x: b, bands: [['hp', 3200, 0.7, 0.6]] },
      { x: white(n, rng), bands: [['lp', 160, 0.7, 0.6]] },
    ], done(0.8));
  },
  lap(rng) {
    const n = len(3);
    const g = z(n);
    for (let k = 0; k < 12; k++) addBurst(g, Math.floor(rng.next() * n), 0.04 + rng.next() * 0.08, 0.5 + rng.next() * 0.5, rng, { loop: true, attack: 0.01 });
    return spec(n, [
      { x: g, bands: [['bp', 340, 2, 2], ['bp', 760, 3, 1], ['hp', 2500, 0.7, 0.15]] },
      { x: white(n, rng), bands: [['lp', 120, 0.7, 0.5]] },
    ], done(0.75));
  },
  hornA() {
    return horn([[415, 417], [523, 525]], [['bp', 1800, 1.3, 2], ['bp', 650, 1, 1]], 2);
  },
  hornB() {
    return horn([[155, 156], [196, 197]], [['bp', 850, 1, 2], ['bp', 1700, 2, 0.8]], 2.6);
  },
  sirenWail() {
    return siren(3.0, (u) => (u < 0.56 ? 620 + 760 * Math.sin((u / 0.56) * Math.PI * 0.5) : 1380 - 760 * Math.pow((u - 0.56) / 0.44, 1.6)));
  },
  sirenYelp() {
    return siren(0.62, (u) => {
      const v = (u * 2) % 1;
      return v < 0.55 ? 720 + 820 * (v / 0.55) : 1540 - 820 * ((v - 0.55) / 0.45);
    });
  },
  ...TURBINE_LOOPS,
  ...TANK_LOOPS,
  ...CAR_LOOPS,
};

// Two detuned pairs of buzzy tones through a honky band-pass.
function horn(pairs, bands, drive) {
  const n = R.sr; // 1 s, whole-Hz tones loop
  const raw = z(n);
  for (const pair of pairs) {
    for (const f of pair) {
      const t = buzzTable(Math.max(1, Math.floor(6500 / f)), 0.55);
      for (let i = 0; i < n; i++) raw[i] += look(t, (f * i) / R.sr) * 0.5;
    }
  }
  return spec(n, [{ x: raw, bands: [...bands, ['gain', 0, 0, 0.15]] }], (out) => {
    soft(normalize(out, 1), drive);
    return normalize(removeDC(out), 0.8);
  });
}

// A swept buzzy tone through a small loudspeaker band.
function siren(T, fOf) {
  const n = len(T);
  // integrate phase, then stretch slightly so the loop ends on a whole cycle
  let total = 0;
  for (let i = 0; i < n; i++) total += fOf(i / n) / R.sr;
  const k = Math.round(total) / total;
  const raw = z(n);
  // A1: a near-sine with a soft triangle-like top (2nd and 3rd harmonics
  // well down), no overdrive. The old buzz wave was soft-clipped into an
  // almost square tone at -5 dBFS RMS: the harshest thing in the mix.
  const tb = harmTable([1, 0.12, 0.1, 0.03, 0.02]);
  let ph = 0;
  for (let i = 0; i < n; i++) {
    raw[i] = look(tb, ph);
    ph += (fOf(i / n) * k) / R.sr;
  }
  return spec(n, [{ x: raw, bands: [['bp', 1300, 0.6, 0.9], ['gain', 0, 0, 0.6]] }], (out) => {
    lp1(out, 3500, { loop: true, passes: 2 });
    return normalize(removeDC(out), 0.7);
  });
}


// ---- combat sounds: helpers ----
// A noise burst through one filter, summed into out.
function noiseBand(out, rng, at, decay, amp, type, f, q = 0.7, gain = 1) {
  const t = z(out.length);
  addBurst(t, at, decay, amp, rng);
  filter(t, out, biquad(type, f, q), { gain, add: true, loop: false });
}
// A decaying sine whose pitch falls from f0 to f1 (time constant tc).
function sweep(out, f0, f1, tc, amp, dur, at = 0) {
  let ph = 0;
  const n = Math.min(out.length - at, len(dur));
  for (let i = 0; i < n; i++) {
    const t = i / R.sr;
    ph += (TAU * (f1 + (f0 - f1) * Math.exp(-t / tc))) / R.sr;
    out[at + i] += Math.sin(ph) * amp * Math.min(1, t / 0.0015) * Math.exp(-t / (dur * 0.3));
  }
}

// ------------------------------------------------------------ one-shots
const SHOTS = {
  thud(rng) {
    const n = len(0.45);
    const out = z(n);
    const f0 = 80 + rng.next() * 45;
    let ph = 0;
    for (let i = 0; i < n; i++) {
      const t = i / R.sr;
      const f = 36 + (f0 - 36) * Math.exp(-t / 0.05);
      ph += (TAU * f) / R.sr;
      const e = Math.min(1, t / 0.002) * Math.exp(-t / 0.075);
      out[i] = Math.sin(ph) * e;
    }
    const nz = z(n);
    addBurst(nz, 0, 0.02, 0.8, rng);
    filter(nz, out, biquad('lp', 650, 0.7), { gain: 1, add: true, loop: false });
    return fadeEdges(normalize(out, 0.9));
  },
  crunch(rng) {
    const n = len(0.8);
    const g = z(n);
    for (let k = 0; k < 240; k++) {
      const t = Math.min(0.6, -Math.log(1 - rng.next() * 0.999) * 0.11);
      const a = rng.next();
      addBurst(g, Math.floor(t * R.sr), 0.0005 + rng.next() * 0.0035, a * (1 - t), rng);
    }
    const out = z(n);
    filter(g, out, biquad('bp', 1800, 0.8), { gain: 1, loop: false });
    filter(g, out, biquad('hp', 3000, 0.7), { gain: 0.4, add: true, loop: false });
    filter(g, out, biquad('lp', 500, 0.7), { gain: 0.6, add: true, loop: false });
    for (let k = 0; k < 6; k++) addMode(out, Math.floor(rng.next() * 0.1 * R.sr), 300 + rng.next() * 2900, 0.05 + rng.next() * 0.15, 0.06);
    return fadeEdges(normalize(out, 0.9));
  },
  glass(rng) {
    const n = len(1.1);
    const out = z(n);
    const crack = z(n);
    addBurst(crack, 0, 0.008, 1, rng);
    filter(crack, out, biquad('hp', 2000, 0.7), { gain: 0.7, loop: false });
    for (let k = 0; k < 42; k++) {
      const t = Math.min(0.85, 0.004 + -Math.log(1 - rng.next() * 0.999) * 0.12);
      addMode(out, Math.floor(t * R.sr), 2400 + rng.next() * 5800, 0.01 + rng.next() * 0.04, (0.2 + 0.5 * rng.next()) * (1 - t * 0.8), R.sr, rng.next() * TAU);
    }
    filter(out, out, biquad('hp', 1500, 0.7), { loop: false });
    return fadeEdges(normalize(out, 0.8));
  },
  doorOpen(rng) {
    const n = len(0.4);
    const out = z(n);
    const c = z(n);
    addBurst(c, 0, 0.003, 1, rng);
    filter(c, out, biquad('hp', 2000, 0.7), { gain: 0.6, loop: false });
    addMode(out, Math.floor(0.012 * R.sr), 130, 0.03, 0.5);
    addMode(out, Math.floor(0.012 * R.sr), 610, 0.015, 0.15);
    return fadeEdges(normalize(out, 0.7));
  },
  doorClose(rng) {
    const n = len(0.45);
    const out = z(n);
    addMode(out, 0, 72, 0.06, 1);
    addMode(out, 0, 150, 0.03, 0.4);
    const b = z(n);
    addBurst(b, 0, 0.03, 0.9, rng);
    filter(b, out, biquad('lp', 800, 0.7), { gain: 1, add: true, loop: false });
    const c = z(n);
    addBurst(c, Math.floor(0.035 * R.sr), 0.003, 0.6, rng);
    filter(c, out, biquad('hp', 2200, 0.7), { gain: 1, add: true, loop: false });
    addMode(out, Math.floor(0.035 * R.sr), 470, 0.02, 0.15);
    addMode(out, Math.floor(0.035 * R.sr), 790, 0.02, 0.1);
    return fadeEdges(normalize(out, 0.9));
  },
  crank(rng) {
    const n = len(1.15);
    const out = z(n);
    let ph = 0, pc = 0;
    const tb = buzzTable(20, 0.6);
    const chug = white(n, rng);
    filter(chug, chug, biquad('lp', 300, 0.7), { loop: false });
    for (let i = 0; i < n; i++) {
      const t = i / R.sr;
      const fc = 7 + 5 * (t / 1.15);
      pc += (TAU * fc) / R.sr;
      const comp = 0.5 + 0.5 * Math.cos(pc);
      const f = (150 + 55 * (t / 1.15)) * (0.85 + 0.15 * comp);
      ph += (TAU * f) / R.sr;
      const m = 0.45 + 0.55 * comp * comp;
      out[i] = (look(tb, ph / TAU) * 0.25 + chug[i] * 1.6) * m;
    }
    filter(out, out, biquad('bp', 700, 0.7), { loop: false });
    return fadeEdges(normalize(out, 0.8), 400, 1500);
  },
  pop(rng) {
    const n = len(0.14);
    const out = z(n);
    const b = z(n);
    addBurst(b, 0, 0.0015, 1, rng);
    for (let k = 0; k < 4; k++) addBurst(b, Math.floor(rng.next() * 0.06 * R.sr), 0.0008, 0.4 * rng.next(), rng);
    filter(b, out, biquad('bp', 1600, 0.8), { gain: 1.5, loop: false });
    addMode(out, 0, 70 + rng.next() * 40, 0.02, 0.7);
    return fadeEdges(normalize(out, 0.9), 8, 200);
  },
  slap(rng) {
    const n = len(0.4);
    const out = z(n);
    addMode(out, 0, 70 + rng.next() * 40, 0.035, 1);
    const b = z(n);
    addBurst(b, 0, 0.06, 1, rng, { attack: 0.003 });
    filter(b, out, biquad('bp', 700, 0.9), { gain: 0.8, add: true, loop: false });
    const h = z(n);
    addBurst(h, Math.floor(0.01 * R.sr), 0.1, 0.5, rng, { attack: 0.01 });
    filter(h, out, biquad('hp', 2500, 0.7), { gain: 0.5, add: true, loop: false });
    return fadeEdges(normalize(out, 0.85));
  },
  splash(rng) {
    const n = len(1.3);
    const b = z(n);
    addBurst(b, 0, 0.25, 1, rng, { attack: 0.01 });
    const out = svf(b, z(n), (u) => 4000 * Math.exp(-u * 2) + 400, 0.8, 'lp');
    for (let k = 0; k < 26; k++) {
      const at = Math.floor(Math.min(1.1, -Math.log(1 - rng.next() * 0.99) * 0.25) * R.sr);
      const L = Math.floor(0.02 * R.sr);
      const f0 = 400 + rng.next() * 500;
      let ph = 0;
      for (let j = 0; j < L && at + j < n; j++) {
        const u = j / L;
        ph += (TAU * f0 * (1 + 1.5 * u)) / R.sr;
        out[at + j] += Math.sin(ph) * (1 - u) * 0.25;
      }
    }
    return fadeEdges(normalize(out, 0.85));
  },
  whoosh(rng) {
    const n = len(2.2);
    const src = white(n, rng);
    const c = 0.45 + rng.next() * 0.1;
    const out = svf(src, z(n), (u) => (u < c ? 1500 : 650) + 300 * Math.tanh((c - u) * 12), 1.2, 'bp');
    const low = z(n);
    filter(src, low, biquad('lp', 220, 0.7), { loop: false });
    for (let i = 0; i < n; i++) {
      const u = i / n - c;
      const e = Math.exp(-(u * u) / 0.03);
      out[i] = (out[i] * 1.2 + low[i] * 0.8) * e;
    }
    return fadeEdges(normalize(out, 0.8), 200, 2000);
  },
  // Boost: a whoosh of noise whose low-pass opens from about 300 Hz to
  // 4 kHz over 0.7 s while a band-pass rises with it, then falls away.
  boostWhoosh(rng) {
    const n = len(1.2);
    const src = white(n, rng);
    const lo = svf(src, z(n), (u) => 300 + 3700 * Math.pow(Math.min(1, u / 0.58), 1.5), 0.9, 'lp');
    const bp = svf(src, z(n), (u) => 500 + 2300 * Math.min(1, u / 0.58), 2.2, 'bp');
    const out = z(n);
    for (let i = 0; i < n; i++) {
      const t = i / R.sr;
      const e = Math.min(1, t / 0.12) * (t < 0.6 ? 1 : Math.exp(-(t - 0.6) / 0.22));
      out[i] = (lo[i] * 0.8 + bp[i] * 0.9) * e;
    }
    lp1(out, 4500, { loop: false });
    return fadeEdges(normalize(removeDC(out), 0.8), 64, 1200);
  },
  gull(rng) {
    const n = len(1.2);
    const out = z(n);
    const cries = 2 + Math.floor(rng.next() * 3);
    const f0 = 950 + rng.next() * 350;
    const tb = gullTable || (gullTable = harmTable([1, 0.6, 0.35, 0.18]));
    let t0 = 0.02;
    for (let c = 0; c < cries; c++) {
      const dur = 0.16 + rng.next() * 0.16;
      const at = Math.floor(t0 * R.sr);
      const L = Math.floor(dur * R.sr);
      let ph = 0;
      const fc = f0 * (1 + 0.06 * gauss(rng));
      for (let j = 0; j < L && at + j < n; j++) {
        const u = j / L;
        const f = fc * (0.8 + 0.6 * Math.sin(Math.PI * Math.min(1, u * 1.25)) - 0.2 * u);
        ph += f / R.sr;
        const e = Math.sqrt(Math.sin(Math.PI * u)) * (1 + 0.3 * Math.sin((TAU * 72 * j) / R.sr));
        out[at + j] += look(tb, ph) * e * 0.4;
      }
      t0 += dur + 0.05 + rng.next() * 0.12;
    }
    filter(out, out, biquad('hp', 600, 0.7), { loop: false });
    return fadeEdges(normalize(out, 0.8));
  },
  clank(rng) {
    const n = len(1);
    const out = z(n);
    const hit = (at, base, a) => {
      const ratios = [1, 2.31, 3.98, 5.43, 7.1];
      const dec = [0.35, 0.22, 0.15, 0.1, 0.07];
      const amp = [1, 0.7, 0.5, 0.35, 0.2];
      for (let k = 0; k < ratios.length; k++) addMode(out, at, base * ratios[k] * (1 + 0.01 * gauss(rng)), dec[k], amp[k] * a, R.sr, rng.next() * TAU);
      const b = z(n);
      addBurst(b, at, 0.002, a, rng);
      filter(b, out, biquad('hp', 2500, 0.7), { gain: 0.5, add: true, loop: false });
    };
    const base = 220 + rng.next() * 300;
    hit(0, base, 1);
    if (rng.next() < 0.6) hit(Math.floor((0.11 + rng.next() * 0.1) * R.sr), base * 1.07, 0.45);
    return fadeEdges(normalize(out, 0.8));
  },
  click(rng) {
    const n = len(0.06);
    const out = z(n);
    addMode(out, 0, 2300, 0.006, 0.6);
    const b = z(n);
    addBurst(b, 0, 0.002, 0.5, rng);
    filter(b, out, biquad('hp', 3000, 0.7), { gain: 1, add: true, loop: false });
    return fadeEdges(normalize(out, 0.6), 4, 100);
  },
  chime() {
    // an original three-note motif (F5, A5, D6) with a soft mallet tone
    const n = len(1.1);
    const out = z(n);
    const notes = [[0, 698.5], [0.085, 880], [0.19, 1174.7]];
    for (const [t, f] of notes) {
      const at = Math.floor(t * R.sr);
      addMode(out, at, f, 0.32, 0.6);
      addMode(out, at, f * 3.01, 0.06, 0.12);
      addMode(out, at, f * 4.17, 0.03, 0.06);
    }
    return fadeEdges(normalize(out, 0.7), 16, 2000);
  },
  // A flow tier up (docs/LOOP.md a): bigger than the chime, from the same
  // mallet partials. A soft low thump, then an original four-note rising
  // motif (C5 E5 G5 C6) over a held octave below, so it lands on the body
  // and not only on the top end.
  chimeTier() {
    const n = len(1.5);
    const out = z(n);
    sweep(out, 150, 70, 0.05, 0.5, 0.35);
    const notes = [[0.02, 523.3], [0.1, 659.3], [0.18, 784], [0.27, 1046.5]];
    for (const [t, f] of notes) {
      const at = Math.floor(t * R.sr);
      addMode(out, at, f, 0.36, 0.55);
      addMode(out, at, f / 2, 0.42, 0.3);
      addMode(out, at, f * 2.01, 0.08, 0.08);
    }
    addMode(out, Math.floor(0.27 * R.sr), 261.6, 0.6, 0.35);
    lp1(out, 3200, { loop: false });
    return fadeEdges(normalize(out, 0.78), 16, 3000);
  },
  fail() {
    const n = len(0.75);
    const out = z(n);
    for (const [t, f] of [[0, 330], [0.17, 262]]) {
      const at = Math.floor(t * R.sr);
      addMode(out, at, f, 0.18, 0.6);
      addMode(out, at, f * 2, 0.08, 0.15);
    }
    lp1(out, 1800, { loop: false });
    return fadeEdges(normalize(out, 0.6), 16, 1500);
  },
  checkpoint() {
    const n = len(0.45);
    const out = z(n);
    addMode(out, 0, 1480, 0.16, 0.6);
    addMode(out, 0, 1480 * 2.76, 0.05, 0.15);
    return fadeEdges(normalize(out, 0.6), 8, 1000);
  },
  // ---- combat (weapons, impacts, blasts) ----
  gunPistol(rng) {
    const out = z(len(0.4));
    noiseBand(out, rng, 0, 0.0025, 1, 'hp', 1500);
    noiseBand(out, rng, 0, 0.03, 0.7, 'bp', 1800, 0.8);
    sweep(out, 260 + rng.next() * 30, 90, 0.02, 0.8, 0.15);
    noiseBand(out, rng, len(0.004), 0.09, 0.25, 'lp', 900);
    noiseBand(out, rng, len(0.06), 0.1, 0.08, 'lp', 700);
    return fadeEdges(normalize(out, 0.9));
  },
  gunSmg(rng) {
    const out = z(len(0.25));
    noiseBand(out, rng, 0, 0.002, 1, 'hp', 2200);
    noiseBand(out, rng, 0, 0.02, 0.7, 'bp', 2600, 1);
    sweep(out, 330 + rng.next() * 40, 140, 0.012, 0.5, 0.08);
    noiseBand(out, rng, len(0.003), 0.05, 0.15, 'lp', 1200);
    return fadeEdges(normalize(out, 0.85));
  },
  gunScatter(rng) {
    const out = z(len(1));
    noiseBand(out, rng, 0, 0.006, 1, 'hp', 900);
    noiseBand(out, rng, 0, 0.12, 1, 'lp', 1100);
    sweep(out, 120, 40, 0.06, 1.2, 0.5);
    noiseBand(out, rng, len(0.03), 0.3, 0.35, 'lp', 500);
    noiseBand(out, rng, len(0.09), 0.08, 0.15, 'bp', 1000);
    return fadeEdges(normalize(out, 0.95), 32, 600);
  },
  gunLobber(rng) {
    const n = len(1.1);
    const out = z(n);
    sweep(out, 150, 50, 0.05, 1, 0.4);
    noiseBand(out, rng, 0, 0.01, 0.6, 'hp', 800);
    // whoosh: noise swept upward through a band-pass
    const w = white(n, rng);
    for (let i = 0; i < n; i++) {
      const t = i / R.sr;
      w[i] *= Math.min(1, t / 0.08) * Math.exp(-t / 0.35);
    }
    const sw = z(n);
    svf(w, sw, (x) => 300 + 2600 * Math.pow(x, 0.6), 1.2, 'bp');
    for (let i = 0; i < n; i++) out[i] += sw[i] * 2.2;
    return fadeEdges(normalize(out, 0.9), 32, 800);
  },
  blast(rng) {
    const n = len(2.4);
    const out = z(n);
    // body: noise whose low-pass closes as it dies
    const body = white(n, rng);
    for (let i = 0; i < n; i++) {
      const t = i / R.sr;
      body[i] *= Math.min(1, t / 0.004) * Math.exp(-t / 0.35);
    }
    const lowered = z(n);
    svf(body, lowered, (x) => 80 + 1800 * Math.exp(-x * 9), 0.7, 'lp');
    for (let i = 0; i < n; i++) out[i] += lowered[i] * 2;
    sweep(out, 78, 26, 0.25, 1.4, 1.6);
    noiseBand(out, rng, 0, 0.01, 1.2, 'hp', 600);
    // rumble
    const rum = white(n, rng);
    for (let i = 0; i < n; i++) {
      const t = i / R.sr;
      rum[i] *= Math.min(1, t / 0.05) * Math.exp(-t / 0.9);
    }
    lp1(rum, 140, { loop: false, passes: 2 });
    for (let i = 0; i < n; i++) out[i] += rum[i] * 5;
    // debris: scattered ticks and a few clinks
    const deb = z(n);
    for (let k = 0; k < 36; k++) {
      const t = Math.min(2.1, 0.25 - Math.log(1 - rng.next() * 0.999) * 0.5);
      addBurst(deb, Math.floor(t * R.sr), 0.002 + rng.next() * 0.004, rng.next() * 0.4 * (1 - t / 2.4), rng);
    }
    filter(deb, out, biquad('hp', 1800, 0.7), { gain: 0.8, add: true, loop: false });
    for (let k = 0; k < 4; k++) addMode(out, Math.floor((0.3 + rng.next() * 1.4) * R.sr), 500 + rng.next() * 2000, 0.04, 0.06);
    return fadeEdges(normalize(out, 0.95), 16, 2000);
  },
  thwack(rng) {
    const out = z(len(0.22));
    noiseBand(out, rng, 0, 0.008, 1, 'lp', 2200);
    sweep(out, 190, 110, 0.015, 1, 0.12);
    addMode(out, 0, 420 + rng.next() * 80, 0.02, 0.5);
    addMode(out, 0, 780 + rng.next() * 100, 0.012, 0.2);
    return fadeEdges(normalize(out, 0.9));
  },
  bodyHit(rng) {
    const out = z(len(0.25));
    sweep(out, 150, 70, 0.03, 1, 0.15);
    noiseBand(out, rng, 0, 0.02, 0.6, 'lp', 800);
    addMode(out, 0, 240 + rng.next() * 40, 0.02, 0.3);
    return fadeEdges(normalize(out, 0.8));
  },
  impact(rng) {
    const out = z(len(0.15));
    noiseBand(out, rng, 0, 0.004, 1, 'bp', 2800, 1);
    noiseBand(out, rng, 0, 0.02, 0.5, 'lp', 600);
    sweep(out, 220, 110, 0.02, 0.1, 0.08);
    return fadeEdges(normalize(out, 0.7));
  },
  ricochet(rng) {
    const n = len(0.5);
    const out = z(n);
    const f0 = 3600 + rng.next() * 600;
    const f1 = 1300 + rng.next() * 300;
    let ph = 0;
    for (let i = 0; i < n; i++) {
      const t = i / R.sr;
      ph += (TAU * (f1 + (f0 - f1) * Math.exp(-t / 0.12))) / R.sr;
      out[i] = Math.sin(ph) * 0.6 * Math.min(1, t / 0.003) * Math.exp(-t / 0.12);
    }
    noiseBand(out, rng, 0, 0.003, 0.8, 'hp', 2000);
    return fadeEdges(normalize(out, 0.7), 16, 600);
  },
  whiz(rng) {
    const n = len(0.35);
    const w = white(n, rng);
    for (let i = 0; i < n; i++) {
      const s = Math.sin((Math.PI * i) / n);
      w[i] *= s * s;
    }
    const out = z(n);
    svf(w, out, (x) => 3800 - 2200 * x, 3, 'bp');
    return fadeEdges(normalize(out, 0.4), 64, 400);
  },
  reloadA(rng) {
    const out = z(len(0.16));
    addMode(out, 0, 1900, 0.006, 0.6);
    addMode(out, 0, 900, 0.01, 0.5);
    noiseBand(out, rng, 0, 0.002, 0.6, 'hp', 3000);
    addMode(out, len(0.07), 1500, 0.004, 0.3);
    return fadeEdges(normalize(out, 0.7));
  },
  reloadB(rng) {
    const out = z(len(0.3));
    sweep(out, 200, 120, 0.01, 0.6, 0.08);
    addMode(out, len(0.1), 2400, 0.004, 0.5);
    addMode(out, len(0.1), 1100, 0.008, 0.4);
    noiseBand(out, rng, len(0.2), 0.03, 0.4, 'bp', 1500);
    addMode(out, len(0.22), 2100, 0.004, 0.4);
    addMode(out, len(0.22), 950, 0.01, 0.4);
    return fadeEdges(normalize(out, 0.7));
  },
  emptyClick(rng) {
    const out = z(len(0.08));
    addMode(out, 0, 2600, 0.003, 0.6);
    addMode(out, 0, 1300, 0.006, 0.4);
    noiseBand(out, rng, 0, 0.001, 0.4, 'hp', 3000);
    return fadeEdges(normalize(out, 0.6), 4, 200);
  },
  // ---- arms (docs/ARMS.md section 7) ----
  // pin: a ring pulled off a can, a bright metal ping and a scrape
  pin(rng) {
    const out = z(len(0.22));
    noiseBand(out, rng, 0, 0.012, 0.5, 'bp', 3800, 2);
    addMode(out, len(0.02), 3150, 0.05, 0.5);
    addMode(out, len(0.02), 5200, 0.025, 0.25);
    return fadeEdges(normalize(out, 0.4));
  },
  // tink: a can bouncing on the street
  tink(rng) {
    const out = z(len(0.16));
    addMode(out, 0, 1450 + rng.next() * 200, 0.03, 0.6);
    addMode(out, 0, 2900 + rng.next() * 300, 0.012, 0.3);
    noiseBand(out, rng, 0, 0.003, 0.5, 'hp', 2500);
    return fadeEdges(normalize(out, 0.6));
  },
  // whistle: a falling bomb, the pitch sliding down over 2.4 s
  whistle(rng) {
    const n = len(2.6);
    const out = z(n);
    let ph = 0;
    for (let i = 0; i < n; i++) {
      const t = i / R.sr;
      const f = 1900 - 1150 * (t / 2.6) + Math.sin(t * 31) * 6;
      ph += (TAU * f) / R.sr;
      out[i] = Math.sin(ph) * Math.min(1, t / 0.25) * (0.5 + 0.5 * t / 2.6);
    }
    const air = white(n, rng);
    const band = z(n);
    svf(air, band, (x) => 1700 - 1000 * x, 4, 'bp');
    for (let i = 0; i < n; i++) out[i] += band[i] * 0.25 * Math.min(1, i / len(0.3));
    return fadeEdges(normalize(out, 0.55), 64, 400);
  },
  // beep: a charge's blink
  beep() {
    const out = z(len(0.07));
    for (let i = 0; i < out.length; i++) {
      const t = i / R.sr;
      out[i] = (Math.sin(TAU * 2350 * t) + 0.3 * Math.sin(TAU * 4700 * t)) * Math.min(1, t / 0.002) * Math.exp(-t / 0.04);
    }
    return fadeEdges(normalize(out, 0.25), 8, 120);
  },
  // lock tones: a short seek tick and a steady "locked" double tone
  lockSeek() {
    const out = z(len(0.06));
    for (let i = 0; i < out.length; i++) {
      const t = i / R.sr;
      out[i] = Math.sin(TAU * 1180 * t) * Math.min(1, t / 0.003) * Math.exp(-t / 0.03);
    }
    return fadeEdges(normalize(out, 0.45), 8, 120);
  },
  lockOn() {
    const out = z(len(0.42));
    for (let i = 0; i < out.length; i++) {
      const t = i / R.sr;
      const f = t < 0.2 ? 1560 : 1760;
      out[i] = (Math.sin(TAU * f * t) + 0.25 * Math.sin(TAU * f * 2 * t)) * Math.min(1, t / 0.004) * (t < 0.38 ? 1 : Math.max(0, 1 - (t - 0.38) / 0.04));
    }
    return fadeEdges(normalize(out, 0.45), 16, 200);
  },
  ...TURBINE_SHOTS,
  ...TANK_SHOTS,
  ...COMBAT_SHOTS,
  ...CAR_SHOTS,
  ...MUSIC_SHOTS,
  ...RADIO_SHOTS,
};
delete SHOTS.blast; // replaced by the layered blastCrack/Body/Tail + debris


// Low-frequency beds rendered at half rate (less memory and work).
const LOW_RATE = new Set(['road', 'wind', 'buffet', 'city', 'lap', 'tail']);

// Built by the one-shot table but played as a loop (the bank lists it in
// `loops`, so tests hold its seam to the loop rules).
const LOOP_SHOTS = new Set(['fireCrackle']);

// Deep one-shots rendered at half rate too.
// (whoosh and boostWhoosh hold nothing above 4.5 kHz: half rate saves memory)
const LOW_SHOTS = new Set(['blastTail', 'whoosh', 'boostWhoosh', 'm:pad', 'm:bass', 'm:kick', ...RADIO_LOW]);

// Made after the bank is playable: ambience beds and calls, the siren.
const EXTRA = new Set(['crickets', 'surf', 'lap', 'sirenWail', 'sirenYelp', 'gull', 'clank', 'whoosh',
  'gunPistol', 'gunSmg', 'gunScatter', 'gunLobber', 'blast', 'thwack', 'bodyHit', 'impact', 'ricochet', 'whiz',
  'reloadA', 'reloadB', 'emptyClick', 'pin', 'tink', 'whistle', 'beep', 'lockSeek', 'lockOn',
  ...Object.keys(TURBINE_SHOTS), ...Object.keys(TANK_SHOTS), ...Object.keys(COMBAT_SHOTS).filter((k) => k !== 'thud'), ...Object.keys(MUSIC_SHOTS), ...Object.keys(RADIO_SHOTS), 'birds', 'stepHard', 'stepSoft']);

// variants: how many copies of each one-shot to make
const SHOT_VARIANTS = {
  thud: 3, crunch: 2, glass: 2, pop: 3, slap: 3, whoosh: 2, gull: 3, clank: 2,
  thwack: 2, impact: 2, ricochet: 2, whiz: 2, tink: 2, stepHard: 3, stepSoft: 3,
  ...COMBAT_VARIANTS,
};

// Stereo impulse response of a street: a few early wall reflections and
// a short darkening tail. Built at the context's own rate.
function impulse(ctx, rng) {
  const sr = ctx.sampleRate;
  const n = Math.round(1.1 * sr);
  const buf = ctx.createBuffer(2, n, sr);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    const nz = white(n, rng);
    for (let k = 0; k < 10; k++) {
      const t = 0.009 + rng.next() * 0.07;
      const g = (0.55 - t * 4) * (rng.next() < 0.5 ? -1 : 1);
      d[Math.floor(t * sr)] += g;
    }
    // building slap-back: a few strong, slightly smeared echoes
    for (let k = 0; k < 4; k++) {
      const at = Math.floor((0.06 + k * 0.035 + rng.next() * 0.02 + ch * 0.007) * sr);
      for (let j = 0; j < 24; j++) d[at + j] += (0.32 - k * 0.05) * (1 - j / 24) * (j % 2 ? -0.6 : 1);
    }
    let y = 0;
    let e = 1;
    const de = Math.exp(-1 / (0.3 * sr));
    const att = 0.02 * sr;
    for (let i = 0; i < n; i++) {
      const a = 0.65 * Math.exp(-i / (0.25 * sr)) + 0.06;
      y += a * (nz[i] - y);
      d[i] += y * e * 0.5 * (i < att ? i / att : 1);
      e *= de;
    }
    lp1(d, 6000, { loop: false, sr });
  }
  return buf;
}

// ---- offline filtering ----
const WARM = 0.25; // seconds of filter run-in rendered before each loop
const MAX_CH = 16;
const ENGINE_SR = 12000; // engine loops: content stays below 5.4 kHz

function offlineCtor() {
  if (typeof window === 'undefined') return null;
  return window.OfflineAudioContext || window.webkitOfflineAudioContext || null;
}

// Render up to 32 specs of one sample rate in one OfflineAudioContext,
// one spec per output channel. Each excitation loops, so after the
// run-in the filters are in their periodic steady state; the period is
// cut out aligned to the excitation's own start. Resolves to filtered
// arrays (before finish), or rejects.
function renderOffline(Off, specs, sr) {
  const warm = Math.round(WARM * sr);
  let maxN = 0;
  for (const s of specs) maxN = Math.max(maxN, s.n + warm);
  const oc = new Off(specs.length, maxN, sr);
  const merger = oc.createChannelMerger(specs.length);
  merger.connect(oc.destination);
  const node = (type, f, q) => {
    const b = oc.createBiquadFilter();
    b.type = type === 'lp' ? 'lowpass' : type === 'hp' ? 'highpass' : 'bandpass';
    b.frequency.value = Math.min(f, sr * 0.45);
    // low/high-pass Q is in dB in Web Audio; band-pass Q is linear
    b.Q.value = type === 'bp' ? q : 20 * Math.log10(q);
    return b;
  };
  specs.forEach((s, ch) => {
    const sum = oc.createGain();
    let tail = sum;
    for (const [type, f, q] of s.post || []) {
      const b = node(type, f, q);
      tail.connect(b);
      tail = b;
    }
    tail.connect(merger, 0, ch);
    const offset = ((s.n - (warm % s.n)) % s.n) / sr;
    for (const part of s.parts) {
      const b = oc.createBuffer(1, s.n, sr);
      if (b.copyToChannel) b.copyToChannel(part.x, 0);
      else b.getChannelData(0).set(part.x);
      const src = oc.createBufferSource();
      src.buffer = b;
      src.loop = true;
      for (const [type, f, q, g] of part.bands) {
        const gn = oc.createGain();
        gn.gain.value = g;
        gn.connect(sum);
        if (type === 'gain') src.connect(gn);
        else {
          const bq = node(type, f, q);
          src.connect(bq);
          bq.connect(gn);
        }
      }
      src.start(0, offset);
    }
  });
  const p = oc.startRendering();
  const finish = (rendered) => specs.map((s, ch) => rendered.getChannelData(ch).slice(warm, warm + s.n));
  if (p && p.then) return p.then(finish);
  return new Promise((resolve, reject) => {
    oc.oncomplete = (e) => resolve(finish(e.renderedBuffer));
    setTimeout(() => reject(new Error('offline render timeout')), 8000);
  });
}

// ---- the bank ----
// Build the job list. Engines are made per character on request (the
// player's and the common traffic engine at unlock, others when first
// heard), so the start-up cost stays small.
export function createBank(ctx, { first = null, engines = ['v6'] } = {}) {
  const rng = createRng(0x5a17);
  const buffers = Object.create(null);
  const loops = [];
  let bytes = 0;
  const jobs = [];
  let next = 0;
  let waiting = null;
  const put = (name, data, loop, sr = SR) => {
    const b = ctx.createBuffer(1, data.length, sr);
    if (b.copyToChannel) b.copyToChannel(data, 0);
    else b.getChannelData(0).set(data);
    buffers[name] = b;
    bytes += data.length * 4;
    if (loop) loops.push(name);
  };
  const Off = offlineCtor();
  const stats = { offline: 0, js: 0, offlineMs: 0, engines: [], slowJob: '', slowMs: 0, jobMs: [] };
  const label = (name, fn) => {
    fn.label = name;
    return fn;
  };
  const flags = { essential: false, extras: false };

  // A batch: jobs that each make one filter spec, a job that starts the
  // offline renders, and (later in the queue) a wait plus one finishing
  // job per spec (JS filtering for any the offline pass could not do).
  function batch(makers) {
    const items = [];
    const renders = [];
    let t0 = 0;
    for (const mk of makers) {
      jobs.push(label('make', () => {
        const it = mk();
        if (it) items.push(it);
      }));
    }
    jobs.push(() => {
      if (!Off) return;
      t0 = nowMs();
      const groups = new Map();
      for (const it of items) {
        const k = it.spec.sr;
        if (!groups.has(k)) groups.set(k, []);
        groups.get(k).push(it);
      }
      const kicks = [];
      for (const [sr, list] of groups) {
        for (let i = 0; i < list.length; i += MAX_CH) {
          const chunk = list.slice(i, i + MAX_CH);
          kicks.push(() => {
            try {
              renders.push(renderOffline(Off, chunk.map((it) => it.spec), sr).then((datas) => {
                chunk.forEach((it, j) => {
                  it.data = datas[j];
                });
              }, () => {}));
            } catch {
              /* falls back to JS */
            }
          });
        }
      }
      jobs.splice(next, 0, ...kicks);
    });
    // returns the jobs that complete the batch, to queue where wanted
    return () => {
      jobs.push(() => (renders.length ? Promise.all(renders).then(() => {
        stats.offlineMs += nowMs() - t0;
      }) : null));
      jobs.push(() => {
        const fin = items.map((it) => label(`finish ${it.name || ''}`, () => {
          let data = it.data;
          if (data) {
            stats.offline++;
            data = it.spec.finish ? it.spec.finish(data) : data;
          } else {
            stats.js++;
            data = runSpecJS(it.spec);
          }
          it.spec = null;
          it.done(data);
        }));
        jobs.splice(next, 0, ...fin);
      });
    };
  }

  // Engines: 6 rpm points x 2 loads per character, normalized together.
  const requested = new Set();
  function engineMakers(ch) {
    const pts = pointsFor(ch);
    const set = [];
    const total = pts.length * 2;
    const makers = [];
    for (let i = 0; i < pts.length; i++) {
      for (const load of [1, 0]) {
        makers.push(() => {
          R.sr = ENGINE_SR;
          const sp = engineSpec(ch, pts[i], load, rng, ENGINE_SR);
          R.sr = SR;
          return {
            name: `eng:${ch}:${i}`,
            spec: sp,
            done(data) {
              set.push({ i, load, data });
              if (set.length < total) return;
              normalizeSet(set.map((q) => q.data));
              for (const q of set) put(`eng:${ch}:${q.i}:${q.load ? 'on' : 'off'}`, q.data, true, ENGINE_SR);
              stats.engines.push(ch);
            },
          };
        });
      }
    }
    return makers;
  }
  const initial = [];
  for (const ch of [first, ...engines]) {
    if (ch && ENGINES[ch] && !requested.has(ch)) {
      requested.add(ch);
      initial.push(...engineMakers(ch));
    }
  }
  const loopMaker = (name) => {
    const sr = LOW_RATE.has(name) ? SR / 2 : SR;
    return () => {
      R.sr = sr;
      const r = LOOPS[name](rng);
      R.sr = SR;
      if (r instanceof Float32Array) {
        put(name, r, true, sr);
        return null;
      }
      return { name, spec: r, done: (data) => put(name, data, true, sr) };
    };
  };
  const shotJobs = (name) => {
    const v = SHOT_VARIANTS[name] || 1;
    const sr = LOW_SHOTS.has(name) ? SR / 2 : SR;
    for (let k = 0; k < v; k++) {
      jobs.push(label(name, () => {
        R.sr = sr;
        const d = SHOTS[name](rng);
        R.sr = SR;
        put(v > 1 ? `${name}${k}` : name, d, LOOP_SHOTS.has(name), sr);
      }));
    }
  };
  for (const name of Object.keys(LOOPS)) if (!EXTRA.has(name)) initial.push(loopMaker(name));
  const complete = batch(initial);
  // one-shots are made while the offline renders run
  for (const name of Object.keys(SHOTS)) if (!EXTRA.has(name)) shotJobs(name);
  jobs.push(() => {
    buffers.ir = impulse(ctx, rng);
    bytes += buffers.ir.length * 2 * 4;
  });
  complete();
  // everything needed to play is ready here; ambience extras follow
  jobs.push(() => {
    flags.essential = true;
  });
  const completeExtra = batch(Object.keys(LOOPS).filter((n) => EXTRA.has(n)).map(loopMaker));
  for (const name of Object.keys(SHOTS)) if (EXTRA.has(name)) shotJobs(name);
  completeExtra();
  jobs.push(() => {
    flags.extras = true;
  });

  return {
    buffers,
    loops,
    stats,
    get bytes() {
      return bytes;
    },
    get essential() {
      return flags.essential;
    },
    get extras() {
      return flags.extras;
    },
    get done() {
      return next >= jobs.length && !waiting;
    },
    // Queue an engine character; returns true if it was newly queued.
    request(ch) {
      if (!ch || !ENGINES[ch] || requested.has(ch)) return false;
      requested.add(ch);
      batch(engineMakers(ch))();
      return true;
    },
    // Run jobs for about budgetMs. Returns true when everything is done,
    // false when there is more, or a promise to wait for.
    step(budgetMs) {
      if (waiting) return waiting;
      const t0 = nowMs();
      while (next < jobs.length) {
        const job = jobs[next++];
        const j0 = nowMs();
        const r = job();
        const jm = nowMs() - j0;
        if (stats.jobMs.length < 2000) stats.jobMs.push(Math.round(jm * 10) / 10);
        if (jm > stats.slowMs) {
          stats.slowMs = jm;
          stats.slowJob = job.label || 'job';
        }
        if (r && typeof r.then === 'function') {
          waiting = r.then(() => {
            waiting = null;
          }, () => {
            waiting = null;
          });
          return waiting;
        }
        if (nowMs() - t0 >= budgetMs) break;
      }
      return next >= jobs.length;
    },
  };
}
