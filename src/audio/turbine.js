// Fighter ('turbine' engine) and police heli sounds, generated in code
// like everything in banks.js, which registers these:
//   abroar     loop: afterburner roar, deep rumble with a ragged crackle
//              (played over the jet rig above throttle 0.9)
//   spotClick  one-shot: the spotlight switch, a heavy relay clunk
//   shockThump one-shot: the fighter's shock ring, a soft double boom
import { R, TAU, white, smoothRandom, removeDC, normalize, fadeEdges, addBurst, biquad, filter } from './dsp.js';

const len = (s) => Math.round(s * R.sr);
const z = (n) => new Float32Array(n);
const spec = (n, parts, finish) => ({ sr: R.sr, n, loop: true, parts, post: [], finish });

export const TURBINE_LOOPS = {
  abroar(rng) {
    const n = len(2);
    const m = smoothRandom(n, 23, rng); // ragged flame flicker
    const pops = [];
    for (let k = 0; k < 40; k++) pops.push([Math.floor(rng.next() * n), 0.2 + rng.next() * 0.5]);
    return spec(n, [{ x: white(n, rng), bands: [['lp', 260, 0.7, 2.2], ['bp', 120, 0.9, 1.2], ['bp', 900, 0.6, 0.35]] }], (out) => {
      for (let i = 0; i < n; i++) out[i] *= 0.75 + 0.25 * m[i];
      for (const [at, a] of pops) {
        const L = Math.min(n - at, 90);
        for (let i = 0; i < L; i++) out[at + i] += (rng.next() * 2 - 1) * a * 0.25 * Math.exp(-i / 18);
      }
      return normalize(removeDC(out), 0.8);
    });
  },
};

export const TURBINE_SHOTS = {
  spotClick(rng) {
    const n = len(0.16);
    const out = z(n);
    // Two metal contacts and a little body ring.
    for (const [at, f, a] of [[0, 1900, 1], [0.012, 1300, 0.6]]) {
      const i0 = Math.floor(at * R.sr);
      for (let i = i0; i < n; i++) {
        const t = (i - i0) / R.sr;
        out[i] += Math.sin(TAU * f * t) * a * Math.exp(-t / 0.012);
        out[i] += Math.sin(TAU * 210 * t) * a * 0.4 * Math.exp(-t / 0.04);
      }
    }
    const nz = z(n);
    addBurst(nz, 0, 0.006, 0.7, rng);
    filter(nz, out, biquad('hp', 2500, 0.7), { gain: 0.6, add: true, loop: false });
    return fadeEdges(normalize(out, 0.7));
  },
  shockThump(rng) {
    const n = len(0.9);
    const out = z(n);
    for (const at of [0, 0.11]) {
      const i0 = Math.floor(at * R.sr);
      let ph = 0;
      for (let i = i0; i < n; i++) {
        const t = (i - i0) / R.sr;
        const f = 38 + 70 * Math.exp(-t / 0.05);
        ph += (TAU * f) / R.sr;
        out[i] += Math.sin(ph) * Math.min(1, t / 0.003) * Math.exp(-t / 0.18) * (at ? 0.7 : 1);
      }
    }
    const nz = z(n);
    addBurst(nz, 0, 0.3, 0.5, rng);
    filter(nz, out, biquad('lp', 500, 0.7), { gain: 0.5, add: true, loop: false });
    return fadeEdges(normalize(out, 0.85));
  },
};
