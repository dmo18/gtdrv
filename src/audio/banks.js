// The sound library: every sample buffer the game plays, generated once
// at unlock. Work is split into small jobs (one buffer each) that the
// audio system runs a few milliseconds at a time, so the page never
// freezes. Loops are seamless; one-shots fade in and out cleanly.

import { createRng } from '../core/rng.js';
import {
  SR, TAU, biquad, filter, lp1, svf, white, gauss, smoothRandom, removeDC, normalize,
  fadeEdges, soft, addMode, addBurst,
} from './dsp.js';
import { ENGINES, pointsFor, renderEngineLoop, normalizeSet } from './engines.js';

const len = (s) => Math.round(s * SR);
const z = (n) => new Float32Array(n);

// Add a decaying sine at a possibly wrapping position (for loops).
function modeWrap(buf, at, f, decay, amp, phase = 0) {
  const n = buf.length;
  const L = Math.ceil(decay * SR * 7);
  const w = (TAU * f) / SR;
  const d = Math.exp(-1 / (decay * SR));
  let e = amp;
  for (let i = 0; i < L; i++) {
    buf[(at + i) % n] += Math.sin(w * i + phase) * e;
    e *= d;
  }
}

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
function look(t, cyc) {
  const x = (cyc - Math.floor(cyc)) * TBL;
  const i = x | 0;
  return t[i] + (t[i + 1] - t[i]) * (x - i);
}

// ---------------------------------------------------------------- loops
const LOOPS = {
  road(rng) {
    const n = len(2);
    const src = white(n, rng);
    const out = z(n);
    filter(src, out, biquad('lp', 240, 0.7), { gain: 1.8 });
    filter(src, out, biquad('bp', 780, 0.8), { gain: 0.55, add: true });
    filter(src, out, biquad('bp', 2500, 1), { gain: 0.14, add: true });
    const m = smoothRandom(n, 36, rng);
    for (let i = 0; i < n; i++) out[i] *= 0.8 + 0.2 * m[i];
    return normalize(removeDC(out), 0.8);
  },
  squeal(rng) {
    const n = len(1.6);
    const src = white(n, rng);
    const out = z(n);
    filter(src, out, biquad('bp', 1185, 36), { gain: 6 });
    filter(src, out, biquad('bp', 1793, 30), { gain: 4.4, add: true });
    filter(src, out, biquad('bp', 2716, 24), { gain: 1.5, add: true });
    const m = smoothRandom(n, 21, rng);
    for (let i = 0; i < n; i++) out[i] *= 0.7 + 0.18 * Math.sin((TAU * 5 * i) / n) + 0.12 * m[i];
    soft(normalize(out, 1), 1.4);
    return normalize(removeDC(out), 0.8);
  },
  gravel(rng) {
    const n = len(2);
    const g = z(n);
    for (let k = 0; k < 1900; k++) {
      const a = rng.next();
      addBurst(g, Math.floor(rng.next() * n), 0.0004 + rng.next() * 0.0012, a * a, rng, { loop: true, attack: 0 });
    }
    const out = z(n);
    filter(g, out, biquad('bp', 2300, 0.6), { gain: 1.4 });
    filter(g, out, biquad('bp', 850, 0.8), { gain: 0.7, add: true });
    filter(white(n, rng), out, biquad('lp', 170, 0.7), { gain: 0.9, add: true });
    return normalize(removeDC(out), 0.8);
  },
  wet(rng) {
    const n = len(2);
    const out = white(n, rng);
    filter(out, out, biquad('hp', 1500, 0.7));
    filter(out, out, biquad('lp', 6500, 0.7));
    const m = smoothRandom(n, 70, rng);
    for (let i = 0; i < n; i++) out[i] *= 0.75 + 0.25 * m[i];
    return normalize(removeDC(out), 0.75);
  },
  wind(rng) {
    const n = len(3);
    const src = white(n, rng);
    const out = z(n);
    filter(src, out, biquad('lp', 420, 0.6), { gain: 2 });
    filter(src, out, biquad('bp', 950, 0.7), { gain: 0.35, add: true });
    const m = smoothRandom(n, 7, rng);
    for (let i = 0; i < n; i++) out[i] *= 0.62 + 0.38 * m[i];
    return normalize(removeDC(out), 0.8);
  },
  wash(rng) {
    const n = len(2);
    const src = white(n, rng);
    const out = z(n);
    filter(src, out, biquad('bp', 1100, 0.6), { gain: 1 });
    filter(src, out, biquad('hp', 3500, 0.7), { gain: 0.35, add: true });
    filter(src, out, biquad('lp', 260, 0.7), { gain: 1, add: true });
    const m = smoothRandom(n, 90, rng);
    for (let i = 0; i < n; i++) out[i] *= 0.55 + 0.45 * Math.abs(m[i]);
    return normalize(removeDC(out), 0.8);
  },
  rain(rng) {
    const n = len(3);
    const out = z(n);
    for (let k = 0; k < 3200; k++) {
      const a = rng.next();
      modeWrap(out, Math.floor(rng.next() * n), 2200 + rng.next() * 4200, 0.0015 + rng.next() * 0.004, a * a * 0.5, rng.next() * TAU);
    }
    filter(white(n, rng), out, biquad('hp', 900, 0.7), { gain: 0.22, add: true });
    lp1(out, 7000);
    return normalize(removeDC(out), 0.75);
  },
  buffet(rng) {
    const n = len(1.5);
    const out = z(n);
    filter(white(n, rng), out, biquad('lp', 85, 1.2), { gain: 3 });
    for (let k = 0; k < 16; k++) modeWrap(out, Math.floor(rng.next() * n), 32 + rng.next() * 30, 0.04, 0.4 + rng.next() * 0.5);
    const m = smoothRandom(n, 17, rng);
    for (let i = 0; i < n; i++) out[i] *= 0.6 + 0.4 * m[i];
    return normalize(removeDC(out), 0.85);
  },
  jetroar(rng) {
    const n = len(2);
    const src = white(n, rng);
    const out = z(n);
    filter(src, out, biquad('lp', 900, 0.6), { gain: 1.6 });
    filter(src, out, biquad('bp', 330, 0.8), { gain: 0.6, add: true });
    filter(src, out, biquad('hp', 2600, 0.7), { gain: 0.2, add: true });
    const m = smoothRandom(n, 11, rng);
    for (let i = 0; i < n; i++) out[i] *= 0.9 + 0.1 * m[i];
    return normalize(removeDC(out), 0.8);
  },
  turbine(rng) {
    const n = SR; // exactly 1 s, so whole-Hz tones loop
    const out = z(n);
    const tones = [[1730, 1], [2617, 0.45], [3481, 0.3], [4409, 0.16], [871, 0.22]];
    for (const [f, a] of tones) {
      const w = (TAU * f) / SR;
      const ph = rng.next() * TAU;
      for (let i = 0; i < n; i++) out[i] += Math.sin(w * i + ph) * a * 0.5;
    }
    const src = white(n, rng);
    for (const [f, a] of tones) filter(src, out, biquad('bp', f, 70), { gain: a * 2.5, add: true });
    filter(src, out, biquad('hp', 5000, 0.7), { gain: 0.06, add: true });
    return normalize(removeDC(out), 0.8);
  },
  rotor(rng) {
    // 8 blade passes at a reference rate of 14 Hz
    const passes = 8;
    const n = Math.round((passes / 14) * SR);
    const per = n / passes;
    const out = z(n);
    const swish = white(n, rng);
    const sw = z(n);
    filter(swish, sw, biquad('bp', 520, 0.7));
    for (let i = 0; i < n; i++) {
      const u = (i % per) / per;
      out[i] += sw[i] * 0.35 * u * u * u;
    }
    const sig = 0.0012 * SR;
    for (let k = 0; k < passes; k++) {
      const at = Math.floor(k * per);
      const a = k % 2 ? 0.85 : 1;
      for (let j = -Math.ceil(sig * 5); j < sig * 5; j++) {
        const x = j / sig;
        out[(at + j + n) % n] += -x * Math.exp(-0.5 * x * x) * a * 1.4;
      }
      modeWrap(out, at, 46, 0.03, 0.9 * a);
      modeWrap(out, at, 110, 0.012, 0.4 * a);
    }
    filter(out, out, biquad('lp', 2800, 0.7));
    return normalize(removeDC(out), 0.85);
  },
  tail(rng) {
    const pulses = 22;
    const n = Math.round((pulses / 88) * SR);
    const exc = z(n);
    for (let k = 0; k < pulses; k++) exc[Math.floor((k * n) / pulses)] += 1 + 0.1 * gauss(rng);
    const out = z(n);
    filter(exc, out, biquad('bp', 640, 2), { gain: 3 });
    filter(exc, out, biquad('bp', 1350, 3), { gain: 1.5, add: true });
    filter(exc, out, biquad('lp', 240, 0.8), { gain: 1, add: true });
    filter(white(n, rng), out, biquad('bp', 900, 1), { gain: 0.05, add: true });
    return normalize(removeDC(out), 0.8);
  },
  scrape(rng) {
    const n = len(1.2);
    const src = white(n, rng);
    const out = z(n);
    const modes = [[1350, 22, 1], [2240, 28, 0.8], [3650, 20, 0.6], [5100, 24, 0.35]];
    for (const [f, q, g] of modes) filter(src, out, biquad('bp', f, q), { gain: g * 4, add: true });
    filter(src, out, biquad('bp', 520, 1), { gain: 0.5, add: true });
    const am = z(n);
    for (let k = 0; k < 42; k++) am[Math.floor(rng.next() * n)] += 0.5 + rng.next();
    lp1(am, 18);
    let p = 0;
    for (let i = 0; i < n; i++) p = Math.max(p, am[i]);
    for (let i = 0; i < n; i++) out[i] *= 0.4 + 0.6 * (am[i] / (p || 1));
    return normalize(removeDC(out), 0.8);
  },
  city(rng) {
    const n = len(4);
    const src = white(n, rng);
    const out = z(n);
    filter(src, out, biquad('lp', 130, 0.7), { gain: 3.2 });
    filter(src, out, biquad('bp', 380, 0.7), { gain: 0.55, add: true });
    filter(src, out, biquad('hp', 2200, 0.7), { gain: 0.05, add: true });
    // a couple of distant vehicles passing within the bed
    const pass = white(n, rng);
    filter(pass, pass, biquad('bp', 620, 0.9));
    for (let k = 0; k < 3; k++) {
      const c = rng.next() * n;
      const w = (0.5 + rng.next() * 0.6) * SR;
      for (let i = 0; i < n; i++) {
        let d = Math.abs(i - c);
        if (d > n / 2) d = n - d;
        out[i] += pass[i] * 0.35 * Math.exp(-(d * d) / (w * w));
      }
    }
    const m = smoothRandom(n, 5, rng);
    for (let i = 0; i < n; i++) out[i] *= 0.75 + 0.25 * m[i];
    return normalize(removeDC(out), 0.8);
  },
  crickets(rng) {
    const n = len(4);
    const out = z(n);
    const kinds = [[4150, 0.6, 1], [4420, 0.72, 0.7], [4760, 0.85, 0.55], [3920, 1.0, 0.4]];
    for (const [f, period, amp] of kinds) {
      const chirps = Math.max(1, Math.round(4 / period));
      const step = n / chirps;
      const off = rng.next() * step;
      const pulses = 3 + Math.floor(rng.next() * 2);
      const pl = Math.round(0.016 * SR);
      const gap = Math.round(0.036 * SR);
      for (let c = 0; c < chirps; c++) {
        const a0 = amp * (0.8 + 0.2 * rng.next());
        for (let p = 0; p < pulses; p++) {
          const at = Math.floor(off + c * step + p * gap);
          const ff = f * (1 + 0.004 * gauss(rng));
          for (let j = 0; j < pl; j++) {
            const e = Math.sin((Math.PI * j) / pl);
            out[(at + j) % n] += Math.sin((TAU * ff * j) / SR) * e * e * a0;
          }
        }
      }
    }
    return normalize(removeDC(out), 0.7);
  },
  surf(rng) {
    const n = len(8);
    const crash = white(n, rng);
    filter(crash, crash, biquad('lp', 2200, 0.6));
    const fizz = white(n, rng);
    filter(fizz, fizz, biquad('hp', 3200, 0.7));
    const eC = z(n);
    const eF = z(n);
    const waves = [0.2, 2.9, 5.4];
    for (const w0 of waves) {
      const at = (w0 + rng.next() * 0.4) * SR;
      const amp = 0.7 + rng.next() * 0.3;
      for (let i = 0; i < n; i++) {
        let t = (i - at) / SR;
        if (t < 0) t += n / SR;
        const rise = t < 0.5 ? t / 0.5 : 1;
        eC[i] += amp * rise * rise * (t < 0.5 ? 1 : Math.exp(-(t - 0.5) / 1.1));
        const tf = t - 0.7;
        eF[i] += tf > 0 ? amp * Math.min(1, tf / 0.3) * Math.exp(-tf / 1.6) : 0;
      }
    }
    const out = z(n);
    for (let i = 0; i < n; i++) out[i] = crash[i] * (0.12 + eC[i]) + fizz[i] * eF[i] * 0.6;
    filter(white(n, rng), out, biquad('lp', 160, 0.7), { gain: 0.6, add: true });
    return normalize(removeDC(out), 0.8);
  },
  lap(rng) {
    const n = len(4);
    const g = z(n);
    for (let k = 0; k < 16; k++) addBurst(g, Math.floor(rng.next() * n), 0.04 + rng.next() * 0.08, 0.5 + rng.next() * 0.5, rng, { loop: true, attack: 0.01 });
    const out = z(n);
    filter(g, out, biquad('bp', 340, 2), { gain: 2 });
    filter(g, out, biquad('bp', 760, 3), { gain: 1, add: true });
    filter(g, out, biquad('hp', 2500, 0.7), { gain: 0.15, add: true });
    filter(white(n, rng), out, biquad('lp', 120, 0.7), { gain: 0.5, add: true });
    return normalize(removeDC(out), 0.75);
  },
  hornA() {
    return horn([[415, 417], [523, 525]], [[1800, 1.3, 2], [650, 1, 1]], 2);
  },
  hornB() {
    return horn([[155, 156], [196, 197]], [[850, 1, 2], [1700, 2, 0.8]], 2.6);
  },
  sirenWail() {
    return siren(3.4, (u) => (u < 0.56 ? 620 + 760 * Math.sin((u / 0.56) * Math.PI * 0.5) : 1380 - 760 * Math.pow((u - 0.56) / 0.44, 1.6)));
  },
  sirenYelp() {
    return siren(0.62, (u) => {
      const v = (u * 2) % 1;
      return v < 0.55 ? 720 + 820 * (v / 0.55) : 1540 - 820 * ((v - 0.55) / 0.45);
    });
  },
};

function horn(pairs, bands, drive) {
  const n = SR; // 1 s, whole-Hz tones loop
  const raw = z(n);
  for (const pair of pairs) {
    for (const f of pair) {
      const t = buzzTable(Math.max(1, Math.floor(9000 / f)), 0.55);
      for (let i = 0; i < n; i++) raw[i] += look(t, (f * i) / SR) * 0.5;
    }
  }
  const out = z(n);
  for (const [f, q, g] of bands) filter(raw, out, biquad('bp', f, q), { gain: g, add: true });
  for (let i = 0; i < n; i++) out[i] += raw[i] * 0.15;
  soft(normalize(out, 1), drive);
  return normalize(removeDC(out), 0.8);
}

function siren(T, fOf) {
  const n = len(T);
  // integrate phase, then stretch slightly so the loop ends on a whole cycle
  let total = 0;
  for (let i = 0; i < n; i++) total += (TAU * fOf(i / n)) / SR;
  const k = (Math.round(total / TAU) * TAU) / total;
  const raw = z(n);
  const tb = buzzTable(5, 0.3);
  let ph = 0;
  for (let i = 0; i < n; i++) {
    const f = fOf(i / n) * k;
    raw[i] = look(tb, ph / TAU);
    ph += (TAU * f) / SR;
  }
  const out = z(n);
  filter(raw, out, biquad('bp', 1500, 0.7), { gain: 1.6 });
  for (let i = 0; i < n; i++) out[i] += raw[i] * 0.35;
  soft(normalize(out, 1), 1.8);
  return normalize(removeDC(out), 0.8);
}

// ------------------------------------------------------------ one-shots
const SHOTS = {
  thud(rng) {
    const n = len(0.45);
    const out = z(n);
    const f0 = 80 + rng.next() * 45;
    let ph = 0;
    for (let i = 0; i < n; i++) {
      const t = i / SR;
      const f = 36 + (f0 - 36) * Math.exp(-t / 0.05);
      ph += (TAU * f) / SR;
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
      addBurst(g, Math.floor(t * SR), 0.0005 + rng.next() * 0.0035, a * (1 - t), rng);
    }
    const out = z(n);
    filter(g, out, biquad('bp', 1800, 0.8), { gain: 1, loop: false });
    filter(g, out, biquad('hp', 3000, 0.7), { gain: 0.4, add: true, loop: false });
    filter(g, out, biquad('lp', 500, 0.7), { gain: 0.6, add: true, loop: false });
    for (let k = 0; k < 6; k++) addMode(out, Math.floor(rng.next() * 0.1 * SR), 300 + rng.next() * 2900, 0.05 + rng.next() * 0.15, 0.06);
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
      addMode(out, Math.floor(t * SR), 2400 + rng.next() * 5800, 0.01 + rng.next() * 0.04, (0.2 + 0.5 * rng.next()) * (1 - t * 0.8), SR, rng.next() * TAU);
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
    addMode(out, Math.floor(0.012 * SR), 130, 0.03, 0.5);
    addMode(out, Math.floor(0.012 * SR), 610, 0.015, 0.15);
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
    addBurst(c, Math.floor(0.035 * SR), 0.003, 0.6, rng);
    filter(c, out, biquad('hp', 2200, 0.7), { gain: 1, add: true, loop: false });
    addMode(out, Math.floor(0.035 * SR), 470, 0.02, 0.15);
    addMode(out, Math.floor(0.035 * SR), 790, 0.02, 0.1);
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
      const t = i / SR;
      const fc = 7 + 5 * (t / 1.15);
      pc += (TAU * fc) / SR;
      const comp = 0.5 + 0.5 * Math.cos(pc);
      const f = (150 + 55 * (t / 1.15)) * (0.85 + 0.15 * comp);
      ph += (TAU * f) / SR;
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
    for (let k = 0; k < 4; k++) addBurst(b, Math.floor(rng.next() * 0.06 * SR), 0.0008, 0.4 * rng.next(), rng);
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
    addBurst(h, Math.floor(0.01 * SR), 0.1, 0.5, rng, { attack: 0.01 });
    filter(h, out, biquad('hp', 2500, 0.7), { gain: 0.5, add: true, loop: false });
    return fadeEdges(normalize(out, 0.85));
  },
  splash(rng) {
    const n = len(1.3);
    const b = z(n);
    addBurst(b, 0, 0.25, 1, rng, { attack: 0.01 });
    const out = svf(b, z(n), (u) => 4000 * Math.exp(-u * 2) + 400, 0.8, 'lp');
    for (let k = 0; k < 26; k++) {
      const at = Math.floor(Math.min(1.1, -Math.log(1 - rng.next() * 0.99) * 0.25) * SR);
      const L = Math.floor(0.02 * SR);
      const f0 = 400 + rng.next() * 500;
      let ph = 0;
      for (let j = 0; j < L && at + j < n; j++) {
        const u = j / L;
        ph += (TAU * f0 * (1 + 1.5 * u)) / SR;
        out[at + j] += Math.sin(ph) * (1 - u) * 0.25;
      }
    }
    return fadeEdges(normalize(out, 0.85));
  },
  whoosh(rng) {
    const n = len(2.6);
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
  gull(rng) {
    const n = len(1.5);
    const out = z(n);
    const cries = 2 + Math.floor(rng.next() * 3);
    const f0 = 950 + rng.next() * 350;
    let t0 = 0.02;
    for (let c = 0; c < cries; c++) {
      const dur = 0.16 + rng.next() * 0.16;
      const at = Math.floor(t0 * SR);
      const L = Math.floor(dur * SR);
      let ph = 0;
      const fc = f0 * (1 + 0.06 * gauss(rng));
      for (let j = 0; j < L && at + j < n; j++) {
        const u = j / L;
        const f = fc * (0.8 + 0.6 * Math.sin(Math.PI * Math.min(1, u * 1.25)) - 0.2 * u);
        ph += (TAU * f) / SR;
        const e = Math.pow(Math.sin(Math.PI * u), 0.6) * (1 + 0.3 * Math.sin((TAU * 72 * j) / SR));
        out[at + j] += (Math.sin(ph) + 0.6 * Math.sin(2 * ph) + 0.35 * Math.sin(3 * ph) + 0.18 * Math.sin(4 * ph)) * e * 0.4;
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
      for (let k = 0; k < ratios.length; k++) addMode(out, at, base * ratios[k] * (1 + 0.01 * gauss(rng)), dec[k], amp[k] * a, SR, rng.next() * TAU);
      const b = z(n);
      addBurst(b, at, 0.002, a, rng);
      filter(b, out, biquad('hp', 2500, 0.7), { gain: 0.5, add: true, loop: false });
    };
    const base = 220 + rng.next() * 300;
    hit(0, base, 1);
    if (rng.next() < 0.6) hit(Math.floor((0.11 + rng.next() * 0.1) * SR), base * 1.07, 0.45);
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
      const at = Math.floor(t * SR);
      addMode(out, at, f, 0.32, 0.6);
      addMode(out, at, f * 3.01, 0.06, 0.12);
      addMode(out, at, f * 4.17, 0.03, 0.06);
    }
    return fadeEdges(normalize(out, 0.7), 16, 2000);
  },
  fail() {
    const n = len(0.75);
    const out = z(n);
    for (const [t, f] of [[0, 330], [0.17, 262]]) {
      const at = Math.floor(t * SR);
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
};

// variants: how many copies of each one-shot to make
const SHOT_VARIANTS = { thud: 3, crunch: 3, glass: 2, pop: 4, slap: 3, whoosh: 2, gull: 3, clank: 3 };

// Stereo impulse response of a street: a few early wall reflections and
// a short darkening tail. Built at the context's own rate.
function impulse(ctx, rng) {
  const sr = ctx.sampleRate;
  const n = Math.round(0.85 * sr);
  const buf = ctx.createBuffer(2, n, sr);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    for (let k = 0; k < 10; k++) {
      const t = 0.009 + rng.next() * 0.07;
      const g = (0.55 - t * 4) * (rng.next() < 0.5 ? -1 : 1);
      d[Math.floor(t * sr)] += g;
    }
    let y = 0;
    for (let i = 0; i < n; i++) {
      const t = i / sr;
      const a = 0.65 * Math.exp(-t / 0.25) + 0.06;
      y += a * ((rng.next() * 2 - 1) - y);
      const e = Math.min(1, t / 0.02) * Math.exp(-t / 0.16);
      d[i] += y * e * 0.5;
    }
    lp1(d, 6000, { loop: false, sr });
  }
  return buf;
}

// Build the job list. `first` is an engine character to make first.
export function createBank(ctx, { first = null } = {}) {
  const rng = createRng(0x5a17);
  const buffers = Object.create(null);
  const loops = [];
  let bytes = 0;
  const jobs = [];
  const put = (name, data, loop) => {
    const b = ctx.createBuffer(1, data.length, SR);
    if (b.copyToChannel) b.copyToChannel(data, 0);
    else b.getChannelData(0).set(data);
    buffers[name] = b;
    bytes += data.length * 4;
    if (loop) loops.push(name);
  };

  const chars = Object.keys(ENGINES);
  if (first && chars.includes(first)) {
    chars.splice(chars.indexOf(first), 1);
    chars.unshift(first);
  }
  for (const ch of chars) {
    const pts = pointsFor(ch);
    const set = [];
    for (let i = 0; i < pts.length; i++) {
      for (const load of [1, 0]) jobs.push(() => set.push({ i, load, data: renderEngineLoop(ch, pts[i], load, rng) }));
    }
    jobs.push(() => {
      normalizeSet(set.map((s) => s.data));
      for (const s of set) put(`eng:${ch}:${s.i}:${s.load ? 'on' : 'off'}`, s.data, true);
    });
  }
  for (const name of Object.keys(LOOPS)) jobs.push(() => put(name, LOOPS[name](rng), true));
  for (const name of Object.keys(SHOTS)) {
    const v = SHOT_VARIANTS[name] || 1;
    for (let k = 0; k < v; k++) jobs.push(() => put(v > 1 ? `${name}${k}` : name, SHOTS[name](rng), false));
  }
  jobs.push(() => {
    buffers.ir = impulse(ctx, rng);
    bytes += buffers.ir.length * 2 * 4;
  });

  let next = 0;
  const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
  return {
    buffers,
    loops,
    variants: SHOT_VARIANTS,
    get bytes() {
      return bytes;
    },
    get done() {
      return next >= jobs.length;
    },
    get progress() {
      return next / jobs.length;
    },
    // Run jobs until about budgetMs has passed. Returns true when done.
    step(budgetMs) {
      const t0 = now();
      while (next < jobs.length) {
        jobs[next++]();
        if (now() - t0 >= budgetMs) break;
      }
      return next >= jobs.length;
    },
  };
}

