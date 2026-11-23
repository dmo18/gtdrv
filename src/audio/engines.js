// Engine tone generator: a firing-pulse model rendered into seamless
// loops. Each firing is a short exhaust pressure pulse (a fast blowdown
// spike followed by a slower rarefaction) that rings a few exhaust/body
// resonances; combustion roughness, intake noise modulated by the firing
// rhythm and a gear/valve-train whine are added, then band-limited.
// A loop holds a whole number of engine cycles (two crank turns), so it
// repeats without a seam. Every character is rendered at a few rpm
// points, each with an on-load and an off-load layer.

import { R, TAU, lp1, white, gauss, removeDC, peak, scale, runSpecJS, warm, harmonize, biquad, filter } from './dsp.js';

// Highest frequency kept in an engine loop (Hz): the rasp sits at 1.5 to
// 3.2 kHz; above about 4 kHz there is only fizz on a phone speaker.
export const ENGINE_TOP = 3900;

// Normalized rpm points (fraction of redline) shared by all characters:
// idle (replaced by each character's own), low, mid, high, redline.
export const RPM_POINTS = [0, 0.3, 0.5, 0.72, 0.95];
// Loop length: long enough that the cycle-to-cycle variation does not
// repeat audibly (short loops "motorboat" at 3 to 4 Hz).
export const LOOP_S = 0.64;

// Exhaust "bank" pattern for a cross-plane V8: the two banks fire at
// uneven intervals, and the nearer exhaust dominates. This gives the
// lumpy burble at low revs.
const V8_BANK = [1, 0.5, 1, 1, 0.5, 1, 0.5, 0.5];

export const ENGINES = {
  // small inline four: buzzy, light, mid-heavy
  i4: {
    cyl: 4, idle: 850, red: 6800, gears: 5, var: 0.07, jitter: 0.05,
    tauK: 0.03, body: 0.5, formants: [[210, 3, 1], [560, 4, 0.7], [1500, 3.5, 0.35]],
    clatter: 0.12, intake: 0.22, intakeF: 1250, whineMul: 36, whine: 0.018,
    lpOn: 6800, lpOff: 3800, offPulse: 0.32, burble: 0, wet: 0, rasp: [2700, 0.55], drive: 2.1,
  },
  // V6 sedan: smoother, rounder
  v6: {
    cyl: 6, idle: 750, red: 6400, gears: 6, var: 0.05, jitter: 0.035,
    tauK: 0.032, body: 0.6, formants: [[150, 2.8, 1], [430, 3.5, 0.6], [1150, 3, 0.28]],
    clatter: 0.08, intake: 0.2, intakeF: 1000, whineMul: 30, whine: 0.014,
    lpOn: 6200, lpOff: 3400, offPulse: 0.3, burble: 0.1, wet: 0, rasp: [2000, 0.35], drive: 1.6, turbo: 0.25,
  },
  // burbling cross-plane V8 (muscle car, pickup)
  v8: {
    cyl: 8, idle: 680, red: 6000, gears: 5, var: 0.12, jitter: 0.07, bank: V8_BANK,
    tauK: 0.036, body: 0.85, formants: [[98, 2.4, 1.1], [290, 2.8, 0.75], [780, 2.6, 0.32]],
    clatter: 0.1, intake: 0.26, intakeF: 850, whineMul: 26, whine: 0.012,
    lpOn: 5600, lpOff: 3000, offPulse: 0.38, burble: 0.55, wet: 0, rasp: [1500, 0.9], drive: 2.4,
  },
  // high-revving sports flat six: rasp and a strong upper band
  sports: {
    cyl: 6, idle: 950, red: 8800, gears: 6, var: 0.05, jitter: 0.04,
    tauK: 0.028, body: 0.5, formants: [[240, 3, 0.85], [720, 4.5, 0.85], [1900, 4, 0.45]],
    clatter: 0.1, intake: 0.3, intakeF: 1600, whineMul: 40, whine: 0.022,
    lpOn: 7200, lpOff: 4200, offPulse: 0.34, burble: 0.4, wet: 0, rasp: [3200, 0.7], drive: 2.6, turbo: 1,
  },
  // diesel (truck, van): low, knocking, a turbo-ish whine
  diesel: {
    cyl: 6, idle: 620, red: 3400, gears: 6, var: 0.06, jitter: 0.04,
    tauK: 0.022, body: 0.75, formants: [[120, 2.2, 1], [390, 2.6, 0.5], [1700, 5, 0.42]],
    clatter: 0.55, intake: 0.18, intakeF: 1400, whineMul: 72, whine: 0.026,
    lpOn: 6400, lpOff: 3600, offPulse: 0.4, burble: 0, wet: 0, rasp: [2300, 0.3], drive: 1.8, turbo: 0.8,
  },
  // outboard four (speedboat, jet ski, dinghy): exhaust through the water
  outboard: {
    cyl: 4, idle: 800, red: 6000, gears: 0, var: 0.08, jitter: 0.06,
    tauK: 0.03, body: 0.7, formants: [[170, 2, 1], [470, 2.6, 0.6], [1250, 3, 0.25]],
    clatter: 0.1, intake: 0.24, intakeF: 1300, whineMul: 34, whine: 0.016,
    lpOn: 5200, lpOff: 2800, offPulse: 0.35, burble: 0.2, wet: 1, rasp: [2200, 0.45], drive: 2.2,
  },
  // inboard diesel (fishing boat, yacht)
  inboard: {
    cyl: 6, idle: 600, red: 2600, gears: 0, var: 0.07, jitter: 0.05,
    tauK: 0.024, body: 0.9, formants: [[95, 2, 1], [300, 2.4, 0.5], [1100, 4, 0.3]],
    clatter: 0.35, intake: 0.14, intakeF: 1000, whineMul: 60, whine: 0.012,
    lpOn: 3800, lpOff: 2400, offPulse: 0.4, burble: 0.1, wet: 0.7, rasp: [1500, 0.22], drive: 1.6,
  },
  // aircraft flat six with a two-blade propeller
  prop: {
    cyl: 6, idle: 700, red: 2750, gears: 0, var: 0.06, jitter: 0.05, blades: 2,
    tauK: 0.03, body: 0.6, formants: [[130, 2.4, 1], [400, 3, 0.55], [950, 3, 0.3]],
    clatter: 0.1, intake: 0.2, intakeF: 900, whineMul: 30, whine: 0.008,
    lpOn: 5600, lpOff: 3400, offPulse: 0.45, burble: 0.15, wet: 0, rasp: [1800, 0.3], drive: 1.7,
  },
};

// Which character a craft uses.
const CAR_ENGINE = {
  compact: 'i4', sedan: 'v6', taxi: 'v6', police: 'v6', sports: 'sports', ghostwake: 'sports',
  muscle: 'v8', pickup: 'v8', van: 'diesel', truck: 'diesel',
};
const BOAT_ENGINE = { fisher: 'inboard', yacht: 'inboard' };

export function engineFor(craft) {
  if (!craft || !craft.spec) return null;
  const id = String(craft.spec.id || '');
  if (craft.kind === 'car') return CAR_ENGINE[id] || 'v6';
  if (craft.kind === 'boat') return BOAT_ENGINE[id] || 'outboard';
  if (craft.kind === 'plane') return isJet(craft) ? null : 'prop';
  return null;
}

export function isJet(craft) {
  const s = craft && craft.spec;
  return !!s && (s.jet === true || s.engine === 'jet' || /jet/i.test(String(s.id)));
}

// Pitch multiplier per spec, so a van does not sound like a truck and
// two sedans are not identical.
const SPEC_PITCH = { van: 1.18, truck: 0.92, pickup: 0.94, muscle: 1, jetski: 1.22, dinghy: 1.12, compact: 1.04 };
export function pitchFor(craft) {
  const id = craft && craft.spec ? String(craft.spec.id) : '';
  return SPEC_PITCH[id] || 1;
}

export function pointsFor(ch) {
  const e = ENGINES[ch];
  const pts = RPM_POINTS.slice();
  pts[0] = e.idle / e.red;
  return pts;
}

// Gamma-shaped pulse value at time t (seconds after the pulse start).
function pulseShape(t, tau) {
  if (t < 0) return 0;
  const u = t / tau;
  const u3 = u / 3;
  // fast blowdown spike minus a slower rarefaction of similar area
  return u * Math.exp(1 - u) - 0.31 * u3 * Math.exp(1 - u3);
}

// Describe one loop as a filter spec (see dsp.js runSpecJS): the pulse
// excitation is built here; the filtering runs in JS or offline.
// rpmNorm: fraction of redline; load: 1 = on throttle, 0 = overrun.
export function engineSpec(ch, rpmNorm, load, rng, sr = R.sr, target = LOOP_S) {
  const e = ENGINES[ch];
  const rpm = Math.max(200, rpmNorm * e.red);
  const cycleS = 120 / rpm;
  const nCyc = Math.max(2, Math.round(target / cycleS));
  const N = Math.round(nCyc * cycleS * sr);
  const cs = N / nCyc; // samples per cycle
  const exc = new Float32Array(N);
  const comb = new Float32Array(N);
  const env = new Float32Array(N);

  const on = load > 0.5;
  const tau = Math.max(0.00022, (e.tauK * 60) / rpm / 3);
  // one pulse and one roughness envelope, reused for every firing
  const pulseLen = Math.ceil(tau * 30 * sr);
  const pulse = new Float32Array(pulseLen);
  for (let j = 0; j < pulseLen; j++) pulse[j] = pulseShape(j / sr, tau);
  const noiseLen = Math.ceil(tau * 8 * sr);
  const nEnv = new Float32Array(noiseLen);
  for (let j = 0; j < noiseLen; j++) nEnv[j] = Math.exp(-j / (noiseLen * 0.25));
  const noise = white(noiseLen * 7 + 13, rng);
  const cylBias = new Float32Array(e.cyl);
  for (let k = 0; k < e.cyl; k++) cylBias[k] = rng.next() * 2 - 1;
  const fireN = e.cyl;
  const jitterAmp = on ? e.jitter : e.jitter * (1 + 3 * e.burble);
  for (let c = 0; c < nCyc; c++) {
    for (let k = 0; k < fireN; k++) {
      const bank = e.bank ? e.bank[k % e.bank.length] : 1;
      let amp = bank * (1 + e.var * cylBias[k]) * (1 + jitterAmp * gauss(rng));
      if (!on) {
        amp *= e.offPulse;
        // overrun: some cycles nearly misfire, others pop a little
        if (e.burble > 0 && rng.next() < 0.25 * e.burble) amp *= 0.2 + 1.8 * rng.next();
      }
      const timing = (rng.next() - 0.5) * 0.012;
      const start = Math.round((c + (k + timing) / fireN) * cs);
      for (let j = 0, i = start % N; j < pulseLen; j++) {
        const v = pulse[j] * amp;
        exc[i] += v;
        env[i] += v < 0 ? -v : v;
        if (++i >= N) i = 0;
      }
      // combustion roughness: a short noise burst with each firing
      const ca = amp * (on ? 1 : 0.35);
      const no = Math.floor(rng.next() * noiseLen * 6);
      for (let j = 0, i = start % N; j < noiseLen; j++) {
        comb[i] += noise[no + j] * ca * nEnv[j];
        if (++i >= N) i = 0;
      }
    }
  }
  // Propeller: blade passes add a broad thump at blades * rpm / 60.
  if (e.blades) {
    const passes = e.blades * 2; // per two-turn cycle
    const bt = (60 / rpm / e.blades) * 0.18;
    const len = Math.ceil(bt * 12 * sr);
    const amp = 0.9 * (0.45 + 0.55 * rpmNorm);
    const shape = new Float32Array(len);
    for (let j = 0; j < len; j++) {
      const u = j / sr / bt;
      shape[j] = Math.sin(Math.min(u, 2) * Math.PI) * Math.exp(-u * 0.6) * amp;
    }
    for (let c = 0; c < nCyc; c++) {
      for (let k = 0; k < passes; k++) {
        const g = k % 2 ? 0.9 : 1;
        for (let j = 0, i = Math.round((c + k / passes + 0.37) * cs) % N; j < len; j++) {
          exc[i] += shape[j] * g;
          if (++i >= N) i = 0;
        }
      }
    }
  }

  const firingHz = (e.cyl * rpm) / 120;
  // intake noise breathing with the firing rhythm
  lp1(env, Math.min(400, firingHz * 0.9), { sr });
  const ep = peak(env) || 1;
  const nz = white(N, rng);
  for (let i = 0; i < N; i++) nz[i] *= 0.35 + 0.65 * (env[i] / ep);

  const bright = on ? 1 : 0.45;
  const bands = [
    // body: the low pulse train itself with its first few firing
    // harmonics (the throaty 80 to 400 Hz part)
    ['lp', Math.min(1400, firingHz * 4.5), 0.8, e.body * 2.2],
  ];
  // exhaust and body resonances, brighter on load
  for (let f = 0; f < e.formants.length; f++) {
    const [fq, q, g] = e.formants[f];
    bands.push(['bp', fq, q, g * (f === 0 ? 1 : bright) * 2.2]);
  }
  const parts = [
    { x: exc, bands },
    // combustion clatter (diesel knock), high-passed
    { x: comb, bands: [['hp', 1100, 0.7, e.clatter * (on ? 1.6 : 0.5)]] },
    { x: nz, bands: [['bp', e.intakeF * (0.8 + 0.4 * rpmNorm), 1.1, e.intake * (on ? 1.4 : 0.35) * (0.4 + 0.8 * rpmNorm)]] },
  ];
  // exhaust rasp: noise gated by each exhaust pulse, a hard edge in the
  // 1.5 to 3.5 kHz region that real recordings have and phones reproduce
  if (e.rasp) {
    const gate = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      const v = env[i] / ep;
      gate[i] = v * v;
    }
    const rn = white(N, rng);
    for (let i = 0; i < N; i++) rn[i] *= gate[i];
    // (gated noise reads as crackle on a phone when it is loud: kept low)
    const rg = 1.7 * e.rasp[1] * (on ? 1 : 0.3) * (0.15 + 0.9 * rpmNorm);
    parts.push({ x: rn, bands: [['bp', e.rasp[0], 0.9, rg], ['bp', e.rasp[0] * 0.55, 1.2, rg * 0.6]] });
  }
  let bub = null;
  if (e.wet > 0) {
    // boats: exhaust through water, bubbling
    const gurgle = white(N, rng);
    for (let i = 0; i < N; i++) gurgle[i] *= env[i] / ep;
    parts.push({ x: gurgle, bands: [['bp', 320, 1.5, 0.35 * e.wet]] });
    bub = white(N, rng);
    lp1(bub, 18, { sr });
  }
  const finish = (out) => {
    // mechanical whine: an exact harmonic of the cycle rate so it loops
    const h = Math.max(1, Math.round(e.whineMul * 2));
    const wAmp = e.whine * (0.5 + rpmNorm) * (on ? 1 : 0.7);
    const h2 = Math.round(h * 1.5);
    const g2 = (h2 * rpm) / 120 < sr * 0.3 ? 0.4 : 0;
    // two-pole sine recursions (no trig per sample)
    const w1 = (TAU * h) / cs;
    const w2 = (TAU * h2) / cs;
    const k1 = 2 * Math.cos(w1);
    const k2 = 2 * Math.cos(w2);
    let a1 = 0, a0 = -Math.sin(w1) * wAmp;
    let b1 = Math.sin(1.3) * wAmp * g2, b0 = Math.sin(1.3 - w2) * wAmp * g2;
    for (let i = 0; i < N; i++) {
      out[i] += a1 + b1;
      const an = k1 * a1 - a0;
      a0 = a1;
      a1 = an;
      const bn = k2 * b1 - b0;
      b0 = b1;
      b1 = bn;
    }
    if (bub) {
      const bp = peak(bub) || 1;
      for (let i = 0; i < N; i++) out[i] *= 1 - e.wet * 0.35 * (0.5 + 0.5 * bub[i] / bp);
    }
    removeDC(out);
    // the exhaust pipe overdriven: harmonics that keep the firing note
    // audible on a small speaker, then the missing-fundamental helper
    // Gentle on purpose: the saturation runs at the engine buffer rate
    // with no oversampling, so a hard drive folds its harmonics back as
    // inharmonic fizz (A1: heard as "harsh and crackly" on the phone).
    warm(out, (e.drive || 1.5) * (on ? 0.75 : 0.3), 0.3);
    harmonize(out, Math.min(160, Math.max(70, firingHz * 1.2)), on ? 0.3 : 0.2, { loop: true, sr, hi: 1100 });
    // then a 4-pole low-pass: no buzz edges left near the buffer's
    // Nyquist, which the browser's resampler would mirror upwards
    const lc = biquad('lp', Math.min(ENGINE_TOP, sr * 0.33), 0.7, sr);
    filter(out, out, lc, { loop: true, sr });
    filter(out, out, lc, { loop: true, sr });
    return removeDC(out);
  };
  return { sr, n: N, loop: true, parts, post: [['lp', on ? e.lpOn : e.lpOff, 0.6]], finish };
}

// Render one loop in JS (used when OfflineAudioContext is missing).
export function renderEngineLoop(ch, rpmNorm, load, rng, sr = R.sr, target = LOOP_S) {
  return runSpecJS(engineSpec(ch, rpmNorm, load, rng, sr, target));
}

// Scale a set of loops of one character together to a common peak.
export function normalizeSet(list, to = 0.85) {
  let p = 0;
  for (const b of list) p = Math.max(p, peak(b));
  if (p > 1e-9) for (const b of list) scale(b, to / p);
}
