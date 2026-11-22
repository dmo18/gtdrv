// Weapons, impacts and explosions, generated in code (banks.js registers
// these and they replace the older, thinner versions of the same names).
// Every gun has three parts like a real report: a broadband supersonic
// crack (an N-wave plus a very short noise burst), a muzzle-blast body
// (100 Hz to 1 kHz) and a short room tail; the reverb and the city slap
// echo are added at play time. Explosions are split into layers that the
// audio system scales by size and distance: crack, body, tail, debris.
// Low parts are passed through `harmonize` so a phone speaker still
// carries them (see dsp.js).
import {
  R, TAU, white, lp1, svf, removeDC, normalize, fadeEdges, addBurst, addMode, biquad, filter,
  warm, harmonize, addNWave, smoothRandom, envelope,
} from './dsp.js';

const len = (s) => Math.round(s * R.sr);
const z = (n) => new Float32Array(n);

// A filtered noise burst, filtered only over the span where it rings
// (cheap even in long buffers).
function band(out, rng, at, decay, amp, type, f, q = 0.7, attack = 0.0005) {
  const L = Math.min(out.length - at, Math.ceil((decay * 7 + 0.02) * R.sr));
  if (L <= 0) return;
  const t = z(L);
  addBurst(t, 0, decay, amp, rng, { attack });
  filter(t, t, biquad(type, f, q), { loop: false });
  for (let i = 0; i < L; i++) out[at + i] += t[i];
}
// A sine whose pitch falls from f0 to f1 (time constant tc), decaying
// with tau; recurrences instead of exp() per sample.
function thump(out, f0, f1, tc, amp, tau, at = 0) {
  let ph = 0;
  const end = Math.min(out.length, at + Math.ceil(tau * 9 * R.sr));
  const dc = Math.exp(-1 / (tc * R.sr));
  const de = Math.exp(-1 / (tau * R.sr));
  const att = 0.0012 * R.sr;
  let gc = 1, ge = amp;
  for (let i = at; i < end; i++) {
    const j = i - at;
    ph += (TAU * (f1 + (f0 - f1) * gc)) / R.sr;
    out[i] += Math.sin(ph) * ge * (j < att ? j / att : 1);
    gc *= dc;
    ge *= de;
  }
}
// A gun report. o: crackMs, crack, body f/decay, low f0/f1, tail decay.
function report(rng, o) {
  const out = z(len(o.dur));
  // A1 balance: the crack used to set the peak alone (a 0.5 ms tick 23 dB
  // above everything else), so after normalising the body and thump were
  // too quiet to carry and the shot read as a click. The crack is now
  // softer and a little longer, the body and the low thump longer and
  // louder, so the report is a crack *and* a boom.
  const ck = o.crack * 0.55;
  addNWave(out, 0, o.crackMs * 1.4, ck);
  band(out, rng, 0, Math.max(0.003, o.crackMs * 0.004), ck * 1.1, 'hp', 1400);
  band(out, rng, 0, 0.01, ck * 0.9, 'bp', 2400, 0.9);
  band(out, rng, len(0.0006), o.bodyDecay * 1.6, o.body * 1.7, 'bp', o.bodyF, 0.8, 0.0008);
  band(out, rng, len(0.0006), o.bodyDecay * 2.4, o.body * 0.8, 'lp', o.bodyF * 0.6, 0.7, 0.001);
  thump(out, o.f0, o.f1, 0.014, o.low * 0.75, o.lowTau * 1.4);
  thump(out, o.f0 * 2, o.f1 * 2, 0.014, o.low * 0.55, o.lowTau);
  band(out, rng, len(0.008), o.tail * 1.5, o.tailAmp * 1.6, 'lp', o.tailF, 0.7, 0.006);
  for (const [t, f, d, a] of o.mech || []) addMode(out, len(t), f, d, a, R.sr, rng.next() * TAU);
  harmonize(out, 130, 0.3, { hi: 1100 });
  warm(out, (o.drive || 1.6) * 0.7, 0.2);
  // no hard noise edges above 7 kHz (they read as fizz on a phone)
  lp1(out, 7000, { loop: false, passes: 2 });
  return fadeEdges(normalize(removeDC(out), 0.85), 2, 400);
}

export const COMBAT_SHOTS = {
  gunPistol(rng) {
    return report(rng, {
      dur: 0.55, crackMs: 0.5, crack: 1, bodyF: 750, bodyDecay: 0.018, body: 0.9,
      f0: 210 + rng.next() * 30, f1: 80, low: 0.55, lowTau: 0.03, tail: 0.11, tailAmp: 0.16, tailF: 1600,
      mech: [[0.035, 2900, 0.006, 0.05], [0.04, 1750, 0.01, 0.04]],
    });
  },
  gunSmg(rng) {
    return report(rng, {
      dur: 0.32, crackMs: 0.35, crack: 1, bodyF: 1050, bodyDecay: 0.011, body: 0.8,
      f0: 260 + rng.next() * 40, f1: 120, low: 0.4, lowTau: 0.018, tail: 0.06, tailAmp: 0.12, tailF: 2000,
      mech: [[0.02, 3300, 0.004, 0.04]],
    });
  },
  gunRifle(rng) {
    return report(rng, {
      dur: 0.8, crackMs: 0.8, crack: 1.2, bodyF: 600, bodyDecay: 0.03, body: 1,
      f0: 160 + rng.next() * 20, f1: 55, low: 0.8, lowTau: 0.05, tail: 0.22, tailAmp: 0.2, tailF: 1200, drive: 1.9,
    });
  },
  gunScatter(rng) {
    return report(rng, {
      dur: 1.1, crackMs: 1.2, crack: 1, bodyF: 520, bodyDecay: 0.055, body: 1.2,
      f0: 120, f1: 42, low: 1, lowTau: 0.09, tail: 0.32, tailAmp: 0.28, tailF: 900, drive: 2,
      // the pump: back and forward
      mech: [[0.5, 1500, 0.012, 0.05], [0.5, 3100, 0.006, 0.04], [0.66, 1250, 0.014, 0.06], [0.66, 2600, 0.007, 0.05]],
    });
  },
  // A short heavy rattle element for aircraft guns: lower and fatter.
  gunCannon(rng) {
    return report(rng, {
      dur: 0.4, crackMs: 1, crack: 0.9, bodyF: 420, bodyDecay: 0.03, body: 1.2,
      f0: 130, f1: 60, low: 1, lowTau: 0.04, tail: 0.12, tailAmp: 0.2, tailF: 1000, drive: 2.2,
    });
  },

  // ---- explosion layers ----
  blastCrack(rng) {
    const out = z(len(0.4));
    addNWave(out, 0, 3.5, 1);
    band(out, rng, 0, 0.012, 1, 'hp', 900);
    band(out, rng, 0, 0.04, 0.7, 'bp', 1600, 0.7);
    band(out, rng, 0, 0.06, 0.6, 'bp', 500, 0.8);
    warm(out, 1.3, 0.3); // was 2.2: saturated noise is crackle
    lp1(out, 7500, { loop: false, passes: 2 });
    return fadeEdges(normalize(removeDC(out), 0.85), 2, 800);
  },
  blastBody(rng) {
    const n = len(2.2);
    const out = z(n);
    // a low sine drop (110 to 40 Hz, long decay) with its octave, so a
    // phone speaker that cannot play 40 Hz still hears the drop
    thump(out, 100 + rng.next() * 12, 40, 0.16, 1, 0.5);
    thump(out, 210, 80, 0.16, 0.45, 0.35);
    // the fireball roar: noise whose low-pass closes as it dies
    const b = envelope(white(n, rng), 0.006, 0.32);
    const lo = svf(b, z(n), (u) => 180 + 3200 * Math.exp(-u * 7), 0.8, 'lp');
    for (let i = 0; i < n; i++) out[i] += lo[i] * 1.8;
    harmonize(out, 110, 0.7, { hi: 1000 });
    warm(out, 1.3, 0.35); // was 2.4: a fireball, not a fuzz box
    return fadeEdges(normalize(removeDC(out), 0.85), 4, 3000);
  },
  blastTail(rng) {
    const n = len(4.5);
    const out = envelope(white(n, rng), 0.12, 1.25);
    const m = smoothRandom(n, 14, rng);
    for (let i = 0; i < n; i++) out[i] *= 0.7 + 0.3 * m[i];
    const mid = out.slice();
    lp1(out, 160, { loop: false, passes: 3 });
    lp1(mid, 700, { loop: false, passes: 2 });
    for (let i = 0; i < n; i++) out[i] = out[i] * 6 + mid[i] * 1.1; // more of the audible rumble
    harmonize(out, 120, 0.8, { hi: 800 });
    return fadeEdges(normalize(removeDC(out), 0.85), 64, 6000);
  },
  debris(rng) {
    const n = len(2.6);
    const g = z(n);
    const out = z(n);
    for (let k = 0; k < 70; k++) {
      const t = Math.min(2.4, 0.15 - Math.log(1 - rng.next() * 0.995) * 0.45);
      const a = rng.next() * (1 - t / 2.6);
      addBurst(g, len(t), 0.0015 + rng.next() * 0.004, a, rng);
      if (k % 6 === 0) addMode(out, len(t), 900 + rng.next() * 3000, 0.02 + rng.next() * 0.04, a * 0.15, R.sr, rng.next() * TAU);
      if (k % 9 === 0) thump(out, 140, 70, 0.02, a * 0.4, 0.03, len(t));
    }
    filter(g, out, biquad('hp', 1500, 0.7), { add: true, loop: false });
    filter(g, out, biquad('bp', 600, 0.9), { gain: 0.6, add: true, loop: false });
    return fadeEdges(normalize(removeDC(out), 0.85), 16, 3000);
  },

  // The thump under a blast (REVAMP 6.7): a 55 Hz drop with its harmonics
  // at 110, 165 and 220 Hz so a phone speaker still carries it, 250 ms.
  blastThump() {
    const out = z(len(0.3));
    thump(out, 80, 55, 0.03, 1, 0.07);
    thump(out, 160, 110, 0.03, 0.7, 0.06);
    thump(out, 240, 165, 0.03, 0.45, 0.05);
    thump(out, 320, 220, 0.03, 0.3, 0.04);
    warm(out, 1.3, 0.2);
    return fadeEdges(normalize(removeDC(out), 0.85), 8, 900);
  },
  // Fire on a burnt hull: a low roar with crackles and pops (a loop).
  fireCrackle(rng) {
    const n = len(2.4);
    const out = z(n);
    const roar = white(n, rng);
    lp1(roar, 380, { loop: true, passes: 2 });
    const m = smoothRandom(n, 6, rng);
    for (let i = 0; i < n; i++) out[i] = roar[i] * 2.2 * (0.6 + 0.4 * m[i]);
    const cr = z(n);
    for (let k = 0; k < 90; k++) {
      const at = Math.floor(rng.next() * (n - len(0.02)));
      addBurst(cr, at, 0.0008 + rng.next() * 0.002, 0.3 + rng.next() * 0.7, rng);
    }
    filter(cr, out, biquad('hp', 1800, 0.7), { add: true, gain: 0.8, loop: true });
    filter(cr, out, biquad('bp', 700, 1.1), { add: true, gain: 0.4, loop: true });
    return normalize(removeDC(out), 0.8);
  },
  // The player's hit marker: a dry 30 ms tick at 1.8 kHz, not positioned.
  hitTick() {
    const out = z(len(0.05));
    for (let i = 0; i < out.length; i++) {
      const t = i / R.sr;
      const e = t < 0.0015 ? t / 0.0015 : Math.exp(-(t - 0.0015) / 0.009);
      out[i] = (Math.sin(TAU * 1800 * t) + 0.3 * Math.sin(TAU * 3600 * t)) * e * (t < 0.03 ? 1 : Math.max(0, 1 - (t - 0.03) / 0.01));
    }
    return normalize(out, 0.7);
  },
  // The kill cue: two notes falling 660 to 440 Hz in 90 ms.
  killCue() {
    const out = z(len(0.16));
    for (let i = 0; i < out.length; i++) {
      const t = i / R.sr;
      const f = t < 0.045 ? 660 : 440;
      const u = t < 0.045 ? t : t - 0.045;
      const e = Math.min(1, u / 0.003) * (t < 0.045 ? 1 : Math.exp(-u / 0.05));
      out[i] = (Math.sin(TAU * f * t) + 0.35 * Math.sin(TAU * f * 2 * t) + 0.15 * Math.sin(TAU * f * 3 * t)) * e;
    }
    return fadeEdges(normalize(out, 0.7), 8, 400);
  },

  // ---- impacts by surface ----
  impactConcrete(rng) {
    const out = z(len(0.3));
    band(out, rng, 0, 0.002, 1, 'hp', 1800);
    band(out, rng, 0, 0.012, 0.6, 'bp', 2400, 1.2);
    band(out, rng, len(0.004), 0.06, 0.25, 'bp', 900, 0.7, 0.004); // dust
    thump(out, 260, 140, 0.01, 0.3, 0.015);
    return fadeEdges(normalize(removeDC(out), 0.85), 2, 600);
  },
  impactMetal(rng) {
    const out = z(len(0.45));
    band(out, rng, 0, 0.0015, 1, 'hp', 2500);
    const base = 1100 + rng.next() * 900;
    for (const [r, d, a] of [[1, 0.12, 0.4], [2.76, 0.07, 0.3], [5.4, 0.04, 0.2], [1.53, 0.09, 0.2]]) {
      addMode(out, 0, base * r, d, a, R.sr, rng.next() * TAU);
    }
    thump(out, 300, 180, 0.01, 0.25, 0.02);
    return fadeEdges(normalize(removeDC(out), 0.85), 2, 1200);
  },
  bodyHit(rng) {
    const out = z(len(0.25));
    band(out, rng, 0, 0.004, 0.7, 'bp', 1300, 0.9); // the slap
    thump(out, 170, 80, 0.02, 1, 0.04);
    band(out, rng, 0, 0.02, 0.4, 'lp', 700);
    harmonize(out, 120, 0.7, { hi: 900 });
    return fadeEdges(normalize(removeDC(out), 0.85));
  },
  thud(rng) {
    const out = z(len(0.5));
    thump(out, 95 + rng.next() * 40, 38, 0.05, 1, 0.08);
    band(out, rng, 0, 0.025, 0.7, 'bp', 320, 0.9, 0.001); // panel knock
    band(out, rng, 0, 0.004, 0.25, 'hp', 2000);
    harmonize(out, 120, 1.1, { hi: 900 });
    warm(out, 1.8, 0.3);
    return fadeEdges(normalize(removeDC(out), 0.9));
  },
  casing(rng) {
    // a brass case dropping: three or four bright bounces
    const out = z(len(0.5));
    let t = 0.01;
    let a = 0.6;
    for (let k = 0; k < 4; k++) {
      const f = 3300 + rng.next() * 1500;
      addMode(out, len(t), f, 0.025, a, R.sr, rng.next() * TAU);
      addMode(out, len(t), f * 1.47, 0.015, a * 0.5, R.sr, rng.next() * TAU);
      t += 0.07 + rng.next() * 0.06 * (1 - k * 0.2);
      a *= 0.55;
    }
    return fadeEdges(normalize(removeDC(out), 0.6), 2, 300);
  },

  // ---- rockets ----
  rocketLaunch(rng) {
    const n = len(1.6);
    const out = z(n);
    band(out, rng, 0, 0.01, 0.8, 'hp', 1000); // ignition
    thump(out, 110, 50, 0.04, 0.7, 0.12);
    const w = envelope(white(n, rng), 0.03, 0.7);
    const roar = svf(w, z(n), (u) => 500 + 2500 * Math.pow(u, 0.5), 0.9, 'bp');
    const hiss = z(n);
    filter(w, hiss, biquad('hp', 3500, 0.7), { loop: false });
    for (let i = 0; i < n; i++) out[i] += roar[i] * 1.6 + hiss[i] * 0.5;
    harmonize(out, 120, 0.5);
    return fadeEdges(normalize(removeDC(out), 0.9), 8, 2500);
  },
};

// Extra variants per name (banks.js merges these).
export const COMBAT_VARIANTS = {
  gunPistol: 3, gunSmg: 3, gunRifle: 2, gunCannon: 2, blastCrack: 2, blastBody: 2, debris: 2,
  impactConcrete: 3, impactMetal: 3, bodyHit: 2, thud: 3, casing: 2,
};
