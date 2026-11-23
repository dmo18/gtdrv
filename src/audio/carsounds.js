// Extra vehicle and ambience sounds (banks.js registers these):
//   turbo     loop: turbocharger whistle (two inharmonic tones plus air)
//   blowoff   one-shot: the valve dumping boost on lift-off, with flutter
//   shift     one-shot: a gear change clunk through the body
//   birds     loop: daytime song birds, sparse chirps and trills
import { R, TAU, white, removeDC, normalize, fadeEdges, addMode, addBurst, biquad, filter, svf, smoothRandom } from './dsp.js';

const len = (s) => Math.round(s * R.sr);
const z = (n) => new Float32Array(n);
const spec = (n, parts, finish) => ({ sr: R.sr, n, loop: true, parts, post: [], finish });

export const CAR_LOOPS = {
  turbo(rng) {
    const n = R.sr; // 1 s, whole-Hz tones loop
    const m = smoothRandom(n, 9, rng);
    return spec(n, [{ x: white(n, rng), bands: [['bp', 3000, 4, 0.5], ['bp', 5200, 6, 0.25]] }], (out) => {
      for (let i = 0; i < n; i++) {
        const t = i / R.sr;
        out[i] += (Math.sin(TAU * 3100 * t) * 0.5 + Math.sin(TAU * 4650 * t + 0.6) * 0.18 + Math.sin(TAU * 6200 * t + 1.1) * 0.08) * (0.85 + 0.15 * m[i]);
      }
      return normalize(removeDC(out), 0.7);
    });
  },
  birds(rng) {
    const n = len(4);
    const out = z(n);
    const calls = 9 + Math.floor(rng.next() * 4);
    for (let c = 0; c < calls; c++) {
      const at = Math.floor(rng.next() * n);
      const f0 = 2600 + rng.next() * 2200;
      const kind = rng.next();
      const notes = kind < 0.4 ? 1 : 2 + Math.floor(rng.next() * 5);
      const amp = 0.25 + 0.75 * rng.next() * rng.next();
      let t0 = 0;
      for (let k = 0; k < notes; k++) {
        const L = Math.floor((kind < 0.4 ? 0.12 : 0.04 + rng.next() * 0.03) * R.sr);
        const up = rng.next() < 0.5;
        let ph = 0;
        for (let j = 0; j < L; j++) {
          const u = j / L;
          const f = f0 * (up ? 0.8 + 0.4 * u : 1.2 - 0.45 * u) * (1 + 0.04 * Math.sin(TAU * 40 * j / R.sr));
          ph += (TAU * f) / R.sr;
          out[(at + t0 + j) % n] += Math.sin(ph) * Math.sin(Math.PI * u) * amp;
        }
        t0 += L + Math.floor((0.02 + rng.next() * 0.03) * R.sr);
      }
    }
    filter(out, out, biquad('hp', 1800, 0.7), { loop: true });
    return normalize(removeDC(out), 0.6);
  },
};

export const CAR_SHOTS = {
  blowoff(rng) {
    const n = len(0.6);
    const w = white(n, rng);
    for (let i = 0; i < n; i++) {
      const t = i / R.sr;
      // flutter: the valve chattering at about 22 Hz
      const fl = 0.6 + 0.4 * Math.max(0, Math.sin(TAU * 22 * t));
      w[i] *= Math.min(1, t / 0.008) * Math.exp(-t / 0.16) * fl;
    }
    const out = svf(w, z(n), (u) => 3600 - 2200 * u, 1.6, 'bp');
    const hi = z(n);
    filter(w, hi, biquad('hp', 5000, 0.7), { loop: false });
    for (let i = 0; i < n; i++) out[i] += hi[i] * 0.3;
    return fadeEdges(normalize(removeDC(out), 0.8), 8, 800);
  },
  // footsteps: a heel tap and a sole scuff on sidewalk; a soft rustle on grass
  stepHard(rng) {
    const out = z(len(0.16));
    const b = z(out.length);
    addBurst(b, 0, 0.003, 1, rng);
    filter(b, out, biquad('bp', 2200, 1.1), { gain: 0.8, add: true, loop: false });
    addMode(out, 0, 150 + rng.next() * 40, 0.015, 0.6);
    const s2 = z(out.length);
    addBurst(s2, len(0.03), 0.025, 0.35, rng, { attack: 0.006 });
    filter(s2, out, biquad('hp', 3000, 0.7), { add: true, loop: false });
    return fadeEdges(normalize(removeDC(out), 0.6), 2, 300);
  },
  stepSoft(rng) {
    const out = z(len(0.22));
    const b = z(out.length);
    addBurst(b, 0, 0.05, 1, rng, { attack: 0.01 });
    filter(b, out, biquad('bp', 1500, 0.6), { gain: 0.8, add: true, loop: false });
    addMode(out, 0, 110, 0.02, 0.3);
    return fadeEdges(normalize(removeDC(out), 0.5), 8, 400);
  },
  shift(rng) {
    const out = z(len(0.18));
    addMode(out, 0, 180, 0.03, 0.8);
    addMode(out, 0, 520, 0.012, 0.3);
    const b = z(out.length);
    addBurst(b, 0, 0.004, 0.5, rng);
    filter(b, out, biquad('bp', 1400, 1), { add: true, loop: false });
    return fadeEdges(normalize(removeDC(out), 0.7));
  },
};
