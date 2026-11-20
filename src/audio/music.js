// Generated driving music: a few short instrument samples (rendered once,
// like every other sound) and a seeded composer that writes one bar at a
// time. The audio system schedules each bar's notes ahead of the clock
// on a music bus, so the groove never repeats exactly and costs almost
// no memory. Everything is composed from the seeded rng: no melodies are
// copied from anywhere. Pure logic (the composer) runs in node tests.
import { R, TAU, white, lp1, removeDC, normalize, fadeEdges, addBurst, biquad, filter, svf, warm, harmonize } from './dsp.js';

const len = (s) => Math.round(s * R.sr);
const z = (n) => new Float32Array(n);

// Reference pitches of the instrument samples (playbackRate = f / ref).
export const MUSIC_REF = { bass: 55, pluck: 440, pad: 220 };

// Band-limited saw (harmonics up to `top` Hz) from a one-period table,
// read with linear interpolation: cheap even for long notes.
const TBL = 2048;
export function saw(out, f, amp, from = 0, top = 7000, detune = 0) {
  const K = Math.max(1, Math.floor(top / f));
  const tb = new Float32Array(TBL + 1);
  for (let k = 1; k <= K; k++) {
    for (let i = 0; i < TBL; i++) tb[i] += Math.sin((TAU * k * i) / TBL) / k;
  }
  tb[TBL] = tb[0];
  const inc = (f * (1 + detune) * TBL) / R.sr;
  let ph = 0;
  for (let i = from; i < out.length; i++) {
    const j = ph | 0;
    out[i] += (tb[j] + (tb[j + 1] - tb[j]) * (ph - j)) * amp;
    ph += inc;
    if (ph >= TBL) ph -= TBL;
  }
}

export const MUSIC_SHOTS = {
  'm:bass'() {
    const n = len(0.7);
    const out = z(n);
    saw(out, 55, 0.7, 0, 2000);
    for (let i = 0; i < n; i++) out[i] += Math.sin((TAU * 55 * i) / R.sr) * 0.8;
    const f = svf(out, z(n), (u) => 180 + 1400 * Math.exp(-u * 9), 1.2, 'lp');
    for (let i = 0; i < n; i++) {
      const t = i / R.sr;
      f[i] *= Math.min(1, t / 0.004) * Math.exp(-t / 0.35);
    }
    warm(f, 1.6, 0.2);
    return fadeEdges(normalize(removeDC(f), 0.8), 8, 1500);
  },
  'm:pluck'() {
    const n = len(0.6);
    const out = z(n);
    // two-operator FM pluck, the index falling fast
    let ph = 0;
    for (let i = 0; i < n; i++) {
      const t = i / R.sr;
      const idx = 2.2 * Math.exp(-t / 0.05);
      ph += (TAU * 440) / R.sr;
      out[i] = Math.sin(ph + idx * Math.sin(ph * 2)) * Math.min(1, t / 0.002) * Math.exp(-t / 0.16);
    }
    return fadeEdges(normalize(out, 0.7), 4, 1200);
  },
  'm:pad'() {
    const n = len(4);
    const out = z(n);
    for (const d of [-0.006, 0, 0.007]) saw(out, 220, 0.35, 0, 3000, d);
    const f = svf(out, z(n), (u) => 700 + 500 * Math.sin(Math.PI * u), 0.9, 'lp');
    for (let i = 0; i < n; i++) {
      const t = i / R.sr;
      f[i] *= Math.min(1, t / 0.5) * (t > 2.8 ? Math.max(0, 1 - (t - 2.8) / 1.2) : 1);
    }
    return fadeEdges(normalize(removeDC(f), 0.6), 64, 2000);
  },
  'm:kick'() {
    const n = len(0.4);
    const out = z(n);
    let ph = 0;
    for (let i = 0; i < n; i++) {
      const t = i / R.sr;
      ph += (TAU * (48 + 110 * Math.exp(-t / 0.03))) / R.sr;
      out[i] = Math.sin(ph) * Math.min(1, t / 0.001) * Math.exp(-t / 0.16);
    }
    warm(out, 2, 0.4); // harmonics so the kick reads on a phone
    harmonize(out, 110, 1.2, { hi: 700 });
    return fadeEdges(normalize(removeDC(out), 0.9), 2, 600);
  },
  'm:snare'(rng) {
    const n = len(0.3);
    const out = z(n);
    const b = z(n);
    addBurst(b, 0, 0.07, 1, rng);
    filter(b, out, biquad('bp', 2600, 0.6), { loop: false });
    for (let i = 0; i < n; i++) {
      const t = i / R.sr;
      out[i] += Math.sin(TAU * 190 * t) * Math.exp(-t / 0.04) * 0.6;
    }
    return fadeEdges(normalize(removeDC(out), 0.7), 2, 600);
  },
  'm:hat'(rng) {
    const n = len(0.08);
    const w = white(n, rng);
    for (let i = 0; i < n; i++) w[i] *= Math.exp(-i / (0.018 * R.sr));
    const out = z(n);
    filter(w, out, biquad('hp', 7000, 0.7), { loop: false });
    lp1(out, 10500, { loop: false });
    return fadeEdges(normalize(out, 0.5), 1, 200);
  },
};

// Scale degrees (semitones) of the modes the composer may pick.
const MODES = { aeolian: [0, 2, 3, 5, 7, 8, 10], dorian: [0, 2, 3, 5, 7, 9, 10], mixolydian: [0, 2, 4, 5, 7, 9, 10] };
const CHORD_STEPS = [[0, 5, 3, 4], [0, 3, 5, 6], [0, 6, 5, 4], [0, 4, 5, 3], [0, 5, 6, 4], [0, 2, 5, 4]];

// A seeded composer. bar(i) returns the notes of bar i:
// [{ beat (0..4), inst, semi (from the key root), vel }]. tempo in BPM.
// opt.tempo: [min, span] overrides the 88..103 BPM range (other stations).
export function createComposer(rng, opt = {}) {
  const modeNames = Object.keys(MODES);
  const mode = MODES[modeNames[Math.floor(rng.next() * modeNames.length)]];
  const root = Math.floor(rng.next() * 7) - 3; // key: a few semitones around A
  const tr = opt.tempo || [88, 16];
  const tempo = tr[0] + Math.floor(rng.next() * tr[1]);
  let prog = CHORD_STEPS[Math.floor(rng.next() * CHORD_STEPS.length)];
  let arp = makeArp();
  let groove = makeGroove();
  function makeArp() {
    const a = [];
    for (let k = 0; k < 8; k++) a.push(rng.next() < 0.8 ? Math.floor(rng.next() * 5) : -1);
    return a;
  }
  function makeGroove() {
    return { pickup: rng.next() < 0.5, open: rng.next() < 0.4, bassSync: Math.floor(rng.next() * 3) };
  }
  const deg = (d) => {
    const o = Math.floor(d / 7);
    return mode[((d % 7) + 7) % 7] + 12 * o;
  };
  function bar(i) {
    const section = Math.floor(i / 8);
    const inSec = i % 8;
    if (inSec === 0 && i > 0) {
      // a new section: sometimes a new progression, a new arpeggio
      if (rng.next() < 0.5) prog = CHORD_STEPS[Math.floor(rng.next() * CHORD_STEPS.length)];
      arp = makeArp();
      groove = makeGroove();
    }
    const step = prog[inSec % 4];
    const chord = [deg(step), deg(step + 2), deg(step + 4)];
    const notes = [];
    const quiet = section % 4 === 3; // a breakdown: pads and pluck only
    for (const c of chord) notes.push({ beat: 0, inst: 'pad', semi: root + c, vel: 0.5 });
    // bass: root on one, then a syncopated answer
    notes.push({ beat: 0, inst: 'bass', semi: root + chord[0], vel: 0.9 });
    const sync = [[1.5, 2.5], [2, 3.5], [1.75, 2.5, 3.25]][groove.bassSync];
    for (const b of sync) notes.push({ beat: b, inst: 'bass', semi: root + chord[0] + (rng.next() < 0.3 ? 7 : 0), vel: 0.6 + 0.2 * rng.next() });
    // arpeggio in eighths over the chord, an octave up
    for (let k = 0; k < 8; k++) {
      const a = arp[k];
      if (a < 0 || (quiet && k % 2)) continue;
      const tone = a < 3 ? chord[a] : chord[a - 3] + 12;
      notes.push({ beat: k * 0.5, inst: 'pluck', semi: root + tone, vel: 0.35 + 0.25 * rng.next() });
    }
    if (!quiet) {
      for (const b of [0, 2]) notes.push({ beat: b, inst: 'kick', semi: 0, vel: 0.9 });
      if (groove.pickup) notes.push({ beat: 3.75, inst: 'kick', semi: 0, vel: 0.5 });
      for (const b of [1, 3]) notes.push({ beat: b, inst: 'snare', semi: 0, vel: 0.55 });
      for (let k = 0; k < 8; k++) notes.push({ beat: k * 0.5 + (groove.open && k % 2 ? 0.0 : 0), inst: 'hat', semi: 0, vel: k % 2 ? 0.45 : 0.25 });
      if (rng.next() < 0.4) notes.push({ beat: 3.25, inst: 'hat', semi: 0, vel: 0.3 });
    }
    return notes;
  }
  return { tempo, root, mode, bar };
}
