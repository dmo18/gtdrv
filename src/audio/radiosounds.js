// Instrument samples for the car radio stations (docs/AUDIO.md, "Radio").
// Like every other sound they are rendered once from code: no audio files.
// Dance: stab, sub bass, clap. Jazz: electric keys, upright-style bass,
// brush swish, ride and a feathered kick. Talk: four vowel blips made
// with a glottal pulse train through formant filters. They are a stylised
// texture, not speech: no words are ever spoken, the captions carry them.
import { R, TAU, white, removeDC, normalize, fadeEdges, addBurst, biquad, filter, svf, warm, harmonize } from './dsp.js';
import { saw } from './music.js';

const len = (s) => Math.round(s * R.sr);
const z = (n) => new Float32Array(n);

// Reference pitches (playbackRate = f / ref).
export const RADIO_REF = { stab: 220, sub: 55, keys: 220, dbass: 55, voc: 140 };

// Formants (F1, F2, F3 in Hz) of four vowels the blips cycle through.
const VOWELS = {
  A: [730, 1090, 2440],
  E: [530, 1840, 2480],
  O: [570, 840, 2410],
  I: [300, 2200, 2900],
};

// A voiced blip: a band-limited saw whose pitch sags a little, through
// three formant band-passes, with a short consonant puff at the front.
function vocal(name, rng) {
  const n = len(0.2);
  const src = z(n);
  const K = 24; // harmonics below about 3.4 kHz
  const TBL = 1024;
  const tb = new Float32Array(TBL + 1);
  for (let k = 1; k <= K; k++) for (let i = 0; i < TBL; i++) tb[i] += Math.sin((TAU * k * i) / TBL) / k;
  tb[TBL] = tb[0];
  let ph = 0;
  for (let i = 0; i < n; i++) {
    const t = i / R.sr;
    const f = RADIO_REF.voc * (1.05 - 0.1 * (t / 0.2)); // a falling contour
    const j = ph | 0;
    src[i] = tb[j] + (tb[j + 1] - tb[j]) * (ph - j);
    ph += (f * TBL) / R.sr;
    if (ph >= TBL) ph -= TBL;
  }
  const out = z(n);
  const fm = VOWELS[name];
  const amp = [1, 0.7, 0.35];
  for (let b = 0; b < 3; b++) filter(src, out, biquad('bp', fm[b], 7 - b * 1.5), { gain: amp[b] * 3, add: true, loop: false });
  // consonant: a 14 ms band-passed puff
  const puff = z(n);
  addBurst(puff, 0, 0.012, 0.9, rng, { attack: 0.0015 });
  const pf = z(n);
  filter(puff, pf, biquad('bp', 3200, 0.8), { loop: false });
  for (let i = 0; i < n; i++) {
    const t = i / R.sr;
    const env = Math.min(1, t / 0.012) * Math.exp(-t / 0.085) * (t > 0.16 ? Math.max(0, 1 - (t - 0.16) / 0.04) : 1);
    out[i] = out[i] * env + pf[i] * 0.5;
  }
  return fadeEdges(normalize(removeDC(out), 0.7), 8, 300);
}

export const RADIO_SHOTS = {
  // ---- dance ----
  'r:stab'() {
    const n = len(0.32);
    const out = z(n);
    for (const d of [-0.008, 0.006]) saw(out, 220, 0.5, 0, 4500, d);
    const f = svf(out, z(n), (u) => 4200 * Math.exp(-u * 3.2) + 500, 1.4, 'lp');
    for (let i = 0; i < n; i++) {
      const t = i / R.sr;
      f[i] *= Math.min(1, t / 0.003) * Math.exp(-t / 0.1);
    }
    return fadeEdges(normalize(removeDC(f), 0.7), 4, 800);
  },
  'r:sub'() {
    const n = len(0.36);
    const out = z(n);
    let ph = 0;
    for (let i = 0; i < n; i++) {
      const t = i / R.sr;
      ph += (TAU * (55 + 14 * Math.exp(-t / 0.02))) / R.sr;
      out[i] = Math.sin(ph) * Math.min(1, t / 0.004) * Math.exp(-t / 0.14);
    }
    warm(out, 2.2, 0.3);
    harmonize(out, 110, 1.0, { hi: 650 });
    return fadeEdges(normalize(removeDC(out), 0.8), 4, 1200);
  },
  'r:clap'(rng) {
    const n = len(0.26);
    const b = z(n);
    for (const at of [0, 0.011, 0.023]) addBurst(b, at, 0.012, 0.8, rng);
    addBurst(b, 0.03, 0.07, 0.5, rng);
    const out = z(n);
    filter(b, out, biquad('bp', 1700, 0.7), { loop: false });
    return fadeEdges(normalize(removeDC(out), 0.7), 2, 600);
  },
  // ---- jazz ----
  'r:keys'() {
    const n = len(1.3);
    const out = z(n);
    let ph = 0;
    for (let i = 0; i < n; i++) {
      const t = i / R.sr;
      ph += (TAU * RADIO_REF.keys) / R.sr;
      const idx = 1.3 * Math.exp(-t / 0.09) + 0.15;
      const tine = Math.sin(ph * 4 + 0.4) * 0.12 * Math.exp(-t / 0.05);
      out[i] = (Math.sin(ph + idx * Math.sin(ph)) + tine) * Math.min(1, t / 0.003) * Math.exp(-t / 0.55);
    }
    return fadeEdges(normalize(removeDC(out), 0.7), 4, 2500);
  },
  'r:dbass'() {
    const n = len(0.9);
    const out = z(n);
    const f0 = RADIO_REF.dbass;
    for (let k = 1; k <= 7; k++) {
      const a = 1 / Math.pow(k, 1.35);
      const tau = 0.5 / Math.pow(k, 0.7);
      for (let i = 0; i < n; i++) {
        const t = i / R.sr;
        out[i] += Math.sin(TAU * f0 * k * t) * a * Math.exp(-t / tau);
      }
    }
    for (let i = 0; i < n; i++) out[i] *= Math.min(1, i / R.sr / 0.006);
    warm(out, 1.4, 0.15);
    harmonize(out, 100, 0.8, { hi: 600 });
    return fadeEdges(normalize(removeDC(out), 0.8), 4, 2000);
  },
  'r:brush'(rng) {
    const n = len(0.32);
    const w = white(n, rng);
    const out = z(n);
    filter(w, out, biquad('bp', 5200, 0.45), { loop: false });
    for (let i = 0; i < n; i++) {
      const u = i / n;
      out[i] *= Math.sin(Math.PI * Math.pow(u, 0.6)) * (0.6 + 0.4 * Math.sin(u * 14));
    }
    return fadeEdges(normalize(out, 0.5), 32, 400);
  },
  'r:ride'(rng) {
    const n = len(0.45);
    const out = z(n);
    for (const [f, a] of [[3100, 0.5], [4350, 0.4], [5900, 0.3]]) {
      for (let i = 0; i < n; i++) out[i] += Math.sin(TAU * f * (i / R.sr)) * a;
    }
    const w = white(n, rng);
    const h = z(n);
    filter(w, h, biquad('hp', 6500, 0.7), { loop: false });
    for (let i = 0; i < n; i++) {
      const t = i / R.sr;
      out[i] = (out[i] * 0.4 + h[i] * 0.6) * Math.min(1, t / 0.001) * Math.exp(-t / 0.13);
    }
    return fadeEdges(normalize(out, 0.5), 1, 500);
  },
  'r:feather'() {
    const n = len(0.18);
    const out = z(n);
    for (let i = 0; i < n; i++) {
      const t = i / R.sr;
      out[i] = Math.sin(TAU * (62 + 30 * Math.exp(-t / 0.03)) * t) * Math.min(1, t / 0.003) * Math.exp(-t / 0.05);
    }
    harmonize(out, 100, 0.8, { hi: 500 });
    return fadeEdges(normalize(removeDC(out), 0.6), 2, 500);
  },
  // ---- talk ----
  'r:vocA'(rng) { return vocal('A', rng); },
  'r:vocE'(rng) { return vocal('E', rng); },
  'r:vocO'(rng) { return vocal('O', rng); },
  'r:vocI'(rng) { return vocal('I', rng); },
};

// Samples that are low enough to be made at half rate.
export const RADIO_LOW = ['r:sub', 'r:dbass', 'r:feather'];
