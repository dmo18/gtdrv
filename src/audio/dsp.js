// Offline DSP helpers for building sample buffers once at start-up. All
// work happens on plain Float32Arrays (normally the channel data of an
// AudioBuffer). Loops are made seamless by treating the buffer as one
// period of a periodic signal: every recursive filter is "warmed up" on
// the tail of the buffer before the real pass, so its state at sample 0
// matches the state it would have after the last sample.

export const SR = 22050; // default sample rate of generated mono buffers
// Rate used by the helpers below when none is passed; the bank sets it
// per buffer (quiet low-frequency beds use half the rate).
export const R = { sr: SR };
export const TAU = Math.PI * 2;

// ---- filter coefficients (RBJ cookbook) ----
// type: 'lp' | 'hp' | 'bp' (0 dB peak) | 'peak'
export function biquad(type, f, q, sr = R.sr, gainDb = 0) {
  const w = (TAU * Math.min(f, sr * 0.45)) / sr;
  const cw = Math.cos(w);
  const sw = Math.sin(w);
  const alpha = sw / (2 * q);
  let b0, b1, b2, a0, a1, a2;
  if (type === 'lp') {
    b0 = (1 - cw) / 2; b1 = 1 - cw; b2 = b0;
    a0 = 1 + alpha; a1 = -2 * cw; a2 = 1 - alpha;
  } else if (type === 'hp') {
    b0 = (1 + cw) / 2; b1 = -(1 + cw); b2 = b0;
    a0 = 1 + alpha; a1 = -2 * cw; a2 = 1 - alpha;
  } else if (type === 'peak') {
    const A = Math.pow(10, gainDb / 40);
    b0 = 1 + alpha * A; b1 = -2 * cw; b2 = 1 - alpha * A;
    a0 = 1 + alpha / A; a1 = -2 * cw; a2 = 1 - alpha / A;
  } else {
    b0 = alpha; b1 = 0; b2 = -alpha;
    a0 = 1 + alpha; a1 = -2 * cw; a2 = 1 - alpha;
  }
  return { b0: b0 / a0, b1: b1 / a0, b2: b2 / a0, a1: a1 / a0, a2: a2 / a0, f, q };
}

// Samples needed for a filter's state to forget where it started.
function warmFor(c, sr) {
  const bw = Math.max(1, c.f / Math.max(0.3, c.q));
  return Math.min(40000, Math.ceil((6 * sr) / (Math.PI * bw)) + 64);
}

// Filter src into dst (may be the same array). gain scales the output;
// add=true sums into dst instead of overwriting. loop=true for loops.
export function filter(src, dst, c, { gain = 1, add = false, loop = true, sr = R.sr } = {}) {
  const n = src.length;
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  const { b0, b1, b2, a1, a2 } = c;
  if (loop) {
    const w = warmFor(c, sr);
    for (let k = 0; k < w; k++) {
      let i = (n - w + k) % n;
      if (i < 0) i += n;
      const x = src[i];
      const y = b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
      x2 = x1; x1 = x; y2 = y1; y1 = y;
    }
  }
  for (let i = 0; i < n; i++) {
    const x = src[i];
    const y = b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
    x2 = x1; x1 = x; y2 = y1; y1 = y;
    if (add) dst[i] += y * gain;
    else dst[i] = y * gain;
  }
  return dst;
}

// One-pole low-pass in place (cheap smoothing); loop-aware.
export function lp1(buf, fc, { loop = true, sr = R.sr, passes = 1 } = {}) {
  const n = buf.length;
  const a = 1 - Math.exp((-TAU * fc) / sr);
  const w = Math.min(60000, Math.ceil((6 * sr) / (TAU * fc)) + 16);
  for (let p = 0; p < passes; p++) {
    let y = 0;
    if (loop) {
      for (let k = 0; k < w; k++) {
        let i = (n - w + k) % n;
        if (i < 0) i += n;
        y += a * (buf[i] - y);
      }
    }
    for (let i = 0; i < n; i++) {
      y += a * (buf[i] - y);
      buf[i] = y;
    }
  }
  return buf;
}

// Sweepable state-variable filter for one-shots: fFn(t01) gives the
// cut-off in Hz along the buffer; mode 'lp' | 'bp' | 'hp'.
export function svf(src, dst, fFn, q, mode = 'lp', sr = R.sr) {
  const n = src.length;
  let low = 0, band = 0;
  const damp = 1 / q;
  let f = 0;
  for (let i = 0; i < n; i++) {
    if ((i & 15) === 0) f = 2 * Math.sin((Math.PI * Math.min(fFn(i / n), sr * 0.12)) / sr);
    low += f * band;
    const high = src[i] - low - damp * band;
    band += f * high;
    dst[i] = mode === 'lp' ? low : mode === 'bp' ? band : high;
  }
  return dst;
}

// ---- generators ----
// Bulk noise uses a xorshift stream seeded from the game's seeded rng:
// still deterministic, but many times faster per sample.
export function white(n, rng, out = new Float32Array(n)) {
  let s = (Math.floor(rng.next() * 4294967295) | 0) || 0x2545f491;
  for (let i = 0; i < n; i++) {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    out[i] = s / 2147483648;
  }
  return out;
}

// Gaussian-ish random number (sum of three uniforms).
export function gauss(rng) {
  return (rng.next() + rng.next() + rng.next() - 1.5) * 1.15;
}

// Smooth periodic random modulation: `cycles` random control points
// across the loop, cosine-interpolated, values in -1..1.
export function smoothRandom(n, cycles, rng, out = new Float32Array(n)) {
  const pts = new Float32Array(cycles);
  for (let i = 0; i < cycles; i++) pts[i] = rng.next() * 2 - 1;
  for (let i = 0; i < n; i++) {
    const p = (i / n) * cycles;
    const k = p | 0;
    const t = p - k;
    const a = pts[k % cycles];
    const b = pts[(k + 1) % cycles];
    out[i] = a + (b - a) * t * t * (3 - 2 * t);
  }
  return out;
}

// ---- finishing ----
export function removeDC(buf) {
  let s = 0;
  for (let i = 0; i < buf.length; i++) s += buf[i];
  const m = s / buf.length;
  for (let i = 0; i < buf.length; i++) buf[i] -= m;
  return buf;
}

export function peak(buf) {
  let p = 0;
  for (let i = 0; i < buf.length; i++) {
    const a = buf[i] < 0 ? -buf[i] : buf[i];
    if (a > p) p = a;
  }
  return p;
}

export function scale(buf, g) {
  for (let i = 0; i < buf.length; i++) buf[i] *= g;
  return buf;
}

export function normalize(buf, to = 0.9) {
  const p = peak(buf);
  if (p > 1e-9) scale(buf, to / p);
  return buf;
}

// Multiply in place by an attack ramp (att s) and exponential decay
// (time constant tau s), by recurrence: no exp() per sample.
export function envelope(buf, att, tau, sr = R.sr, from = 0) {
  const a = Math.max(1, att * sr);
  const d = Math.exp(-1 / (tau * sr));
  let e = 1;
  for (let i = from; i < buf.length; i++) {
    const j = i - from;
    buf[i] *= (j < a ? j / a : 1) * e;
    e *= d;
  }
  return buf;
}

// Short fades so one-shots never click.
export function fadeEdges(buf, inS = 32, outS = 256) {
  const n = buf.length;
  for (let i = 0; i < inS && i < n; i++) buf[i] *= i / inS;
  for (let i = 0; i < outS && i < n; i++) buf[n - 1 - i] *= i / outS;
  return buf;
}

// Soft saturation in place.
export function soft(buf, drive = 1) {
  const k = Math.tanh(drive);
  for (let i = 0; i < buf.length; i++) buf[i] = Math.tanh(buf[i] * drive) / k;
  return buf;
}

// Asymmetric saturation relative to the buffer's own peak, keeping that
// peak: odd and even harmonics (a "throaty" exhaust, a fat boom).
export function warm(buf, drive = 2, asym = 0.25) {
  const p = peak(buf);
  if (p < 1e-9) return buf;
  const k = drive / p;
  for (let i = 0; i < buf.length; i++) {
    const x = buf[i] * k;
    buf[i] = Math.tanh(x + asym * x * x * (x > 0 ? 0.5 : 0.25));
  }
  removeDC(buf);
  return scale(buf, p / (peak(buf) || 1));
}

// Phone speakers barely move below ~250 Hz, so energy under `fc` is
// mostly lost there. This adds its harmonics (the ear hears the missing
// fundamental): the low band is clipped hard, the result band-limited
// to fc*1.6 .. hi and mixed back at `amount` of the low band's peak.
export function harmonize(buf, fc = 120, amount = 0.6, { hi = 900, loop = false, sr = R.sr, drive = 2 } = {}) {
  const n = buf.length;
  const low = new Float32Array(n);
  // two low-pass stages: only the true lows reach the curve, so mids do
  // not intermodulate into a fizzy grit
  const lc = biquad('lp', fc, 0.7, sr);
  filter(buf, low, lc, { loop, sr });
  filter(low, low, lc, { loop, sr });
  const p = peak(low);
  if (p < 1e-9) return buf;
  const k = drive / p;
  for (let i = 0; i < n; i++) {
    const x = low[i] * k;
    // a soft clip (3rd harmonic) plus a smooth rectifier (2nd harmonic).
    // The old |tanh| had a corner at every zero crossing, which sprayed
    // harmonics far up the spectrum (heard as crackle); this one is round.
    low[i] = Math.tanh(x) * 0.6 + (Math.sqrt(x * x + 0.09) - 0.3) * 0.5;
  }
  filter(low, low, biquad('hp', fc * 1.6, 0.7, sr), { loop, sr });
  const hc = biquad('lp', hi, 0.7, sr);
  filter(low, low, hc, { loop, sr });
  filter(low, low, hc, { loop, sr });
  const q = peak(low) || 1;
  const g = (amount * p) / q;
  for (let i = 0; i < n; i++) buf[i] += low[i] * g;
  return buf;
}

// An N-wave (supersonic crack of a bullet or a blast front): a fast rise,
// linear fall through zero, a fast return, `ms` long, at sample `at`.
export function addNWave(buf, at, ms, amp, sr = R.sr) {
  const L = Math.max(4, Math.round((ms / 1000) * sr));
  for (let j = 0; j < L && at + j < buf.length; j++) {
    const u = j / L;
    buf[at + j] += amp * (1 - 2 * u) * Math.min(1, j / 2) * Math.min(1, (L - j) / 2);
  }
}

// Add a decaying sine "ping" (a struck mode) at sample `at`, by a
// two-pole recursion (no trig per sample). loop=true wraps around.
export function addMode(buf, at, f, decay, amp, sr = R.sr, phase = 0, loop = false) {
  const n = buf.length;
  let len = Math.ceil(decay * sr * 7);
  if (!loop) len = Math.min(n - at, len);
  const w = (TAU * f) / sr;
  const r = Math.exp(-1 / (decay * sr));
  const c1 = 2 * r * Math.cos(w);
  const c2 = r * r;
  let y2 = amp * Math.sin(phase - w) / r;
  let y1 = amp * Math.sin(phase);
  let j = at % n;
  for (let i = 0; i < len; i++) {
    buf[j] += y1;
    const y = c1 * y1 - c2 * y2;
    y2 = y1;
    y1 = y;
    if (++j >= n) j = 0;
  }
}

// Add an exponentially decaying noise burst at `at` (wraps if loop).
export function addBurst(buf, at, decay, amp, rng, { loop = false, attack = 0.001, sr = R.sr } = {}) {
  const n = buf.length;
  const len = Math.ceil(decay * sr * 6);
  const att = Math.max(1, attack * sr);
  const d = Math.exp(-1 / (decay * sr));
  let e = amp;
  let s = (Math.floor(rng.next() * 4294967295) | 0) || 0x1b873593;
  for (let i = 0; i < len; i++) {
    let j = at + i;
    if (j >= n) {
      if (!loop) break;
      j %= n;
    }
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    const a = i < att ? i / att : 1;
    buf[j] += (s / 2147483648) * e * a;
    if (i >= att) e *= d;
  }
}

// ---- filter specs ----
// A spec describes a buffer as excitation parts run through parallel
// filters, summed, then a serial post chain, then a JS finishing step:
//   { name, sr, n, loop, parts: [{ x, bands: [[type, f, q, gain]] }],
//     post: [[type, f, q]], finish(out) -> Float32Array }
// type: 'lp' | 'hp' | 'bp' | 'gain' (straight through). The same spec
// can be rendered here in JS or by an OfflineAudioContext (banks.js).
export function runSpecJS(spec) {
  const sr = spec.sr;
  const out = new Float32Array(spec.n);
  const loop = spec.loop !== false;
  for (const part of spec.parts) {
    for (const [type, f, q, g] of part.bands) {
      if (type === 'gain') {
        for (let i = 0; i < out.length; i++) out[i] += part.x[i] * g;
      } else {
        filter(part.x, out, biquad(type, f, q, sr), { gain: g, add: true, loop, sr });
      }
    }
  }
  for (const [type, f, q] of spec.post || []) filter(out, out, biquad(type, f, q, sr), { loop, sr });
  return spec.finish ? spec.finish(out) : out;
}
