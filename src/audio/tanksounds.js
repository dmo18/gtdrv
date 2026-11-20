// Tank sounds (task 32), generated in code like everything in banks.js,
// which registers these:
//   tankTracks  loop: diesel rumble with track-link clanks (the rig plays
//               it faster with track speed; a second copy squeals on pivots)
//   tankTurret  loop: the turret traverse motor, a geared whine
//   tankBoom    one-shot: the main gun, a hard crack and a long low boom
//   tankCoax    one-shot: one round of the coaxial gun (a heavy rattle)
//   tankCrush   one-shot: a car or bench rolled flat, metal crunch
import { R, TAU, white, lp1, removeDC, normalize, fadeEdges, addBurst, addMode, biquad, filter, soft } from './dsp.js';

const len = (s) => Math.round(s * R.sr);
const z = (n) => new Float32Array(n);

export const TANK_LOOPS = {
  tankTracks(rng) {
    // 1.5 s: 48 firing pulses at 32 Hz, 12 link clanks, all periodic.
    const n = len(1.5);
    const out = z(n);
    for (let i = 0; i < n; i++) {
      const ph = (i / n) * 48;
      const p = ph - Math.floor(ph);
      // A blunt pulse per firing stroke with a few harmonics.
      out[i] = Math.exp(-p * 7) * 0.9 + Math.sin(TAU * ph) * 0.35 + Math.sin(TAU * ph * 2 + 0.7) * 0.18 + Math.sin(TAU * ph * 0.5) * 0.25;
    }
    lp1(out, 260, { passes: 2 });
    const grit = white(n, rng);
    lp1(grit, 900);
    for (let i = 0; i < n; i++) out[i] += grit[i] * 0.25;
    // Track links: metallic knocks, evenly spaced with a little jitter.
    const clank = z(n);
    for (let k = 0; k < 12; k++) {
      const at = Math.floor(((k + 0.5 + (rng.next() - 0.5) * 0.25) / 12) * n);
      addBurst(clank, at, 0.004 + rng.next() * 0.003, 0.55 + rng.next() * 0.3, rng, { loop: true });
      addMode(clank, at, 640 + rng.next() * 500, 0.035, 0.18, R.sr, 0, true);
      addMode(clank, at, 1500 + rng.next() * 700, 0.02, 0.1, R.sr, 0, true);
    }
    filter(clank, out, biquad('bp', 1100, 0.8), { gain: 0.9, add: true });
    return normalize(removeDC(soft(out, 1.3)), 0.8);
  },
  tankTurret(rng) {
    // 1 s of geared electric whine (integer cycles, so it loops).
    const n = len(1);
    const out = z(n);
    for (let i = 0; i < n; i++) {
      const t = i / n;
      out[i] = Math.sin(TAU * 190 * t) * 0.5 + Math.sin(TAU * 380 * t + 1.1) * 0.3 + Math.sin(TAU * 1140 * t) * 0.12
        + Math.sin(TAU * 38 * t) * Math.sin(TAU * 190 * t) * 0.2;
    }
    const nz = white(n, rng);
    lp1(nz, 1600);
    for (let i = 0; i < n; i++) out[i] += nz[i] * 0.15;
    return normalize(removeDC(out), 0.6);
  },
};

export const TANK_SHOTS = {
  tankBoom(rng) {
    const n = len(2.6);
    const out = z(n);
    // Crack: a short bright noise burst.
    addBurst(out, 0, 0.012, 1.6, rng);
    // Body: low noise closing down, a falling thump, a long rumble.
    const body = white(n, rng);
    for (let i = 0; i < n; i++) {
      const t = i / R.sr;
      body[i] *= Math.min(1, t / 0.003) * Math.exp(-t / 0.28);
    }
    lp1(body, 520, { loop: false, passes: 2 });
    for (let i = 0; i < n; i++) out[i] += body[i] * 4;
    let ph = 0;
    for (let i = 0; i < n; i++) {
      const t = i / R.sr;
      const f = 22 + 52 * Math.exp(-t / 0.18);
      ph += TAU * f / R.sr;
      out[i] += Math.sin(ph) * 1.5 * Math.min(1, t / 0.006) * Math.exp(-t / 0.5);
    }
    const rum = white(n, rng);
    for (let i = 0; i < n; i++) {
      const t = i / R.sr;
      rum[i] *= Math.min(1, t / 0.08) * Math.exp(-t / 1.0);
    }
    lp1(rum, 110, { loop: false, passes: 2 });
    for (let i = 0; i < n; i++) out[i] += rum[i] * 6;
    // The breech: a metallic clunk as it recoils.
    addMode(out, len(0.09), 380, 0.06, 0.25);
    addMode(out, len(0.1), 920, 0.03, 0.12);
    return fadeEdges(normalize(soft(out, 1.4), 0.97), 8, 3000);
  },
  tankCoax(rng) {
    const n = len(0.16);
    const out = z(n);
    addBurst(out, 0, 0.006, 1.2, rng);
    for (let i = 0; i < n; i++) {
      const t = i / R.sr;
      out[i] += Math.sin(TAU * 140 * t) * Math.exp(-t / 0.025) * 0.8;
    }
    addMode(out, len(0.004), 2100, 0.012, 0.15);
    const tail = z(n);
    addBurst(tail, len(0.01), 0.04, 0.35, rng);
    filter(tail, out, biquad('lp', 1800, 0.7), { gain: 1, add: true, loop: false });
    return fadeEdges(normalize(out, 0.9), 4, 400);
  },
  tankCrush(rng) {
    const n = len(0.8);
    const out = z(n);
    // Several bending crunches and a low body thud.
    for (let k = 0; k < 7; k++) {
      const at = Math.floor((k * 0.07 + rng.next() * 0.05) * R.sr);
      addBurst(out, at, 0.01 + rng.next() * 0.02, 0.6 + rng.next() * 0.5, rng);
      addMode(out, at, 300 + rng.next() * 900, 0.05, 0.2);
    }
    for (let i = 0; i < n; i++) {
      const t = i / R.sr;
      out[i] += Math.sin(TAU * 55 * t) * Math.exp(-t / 0.12) * 0.9;
    }
    const glass = z(n);
    for (let k = 0; k < 10; k++) addBurst(glass, Math.floor((0.05 + rng.next() * 0.4) * R.sr), 0.002, 0.3 * rng.next(), rng);
    filter(glass, out, biquad('hp', 2500, 0.7), { gain: 0.8, add: true, loop: false });
    return fadeEdges(normalize(soft(out, 1.2), 0.9), 8, 1200);
  },
};
