// Offline DSP helpers for building sample buffers once at start-up. All
// work happens on plain Float32Arrays (normally the channel data of an
// AudioBuffer). Loops are made seamless by treating the buffer as one
// period of a periodic signal: every recursive filter is "warmed up" on
// the tail of the buffer before the real pass, so its state at sample 0
// matches the state it would have after the last sample.

export const SR = 22050; // sample rate of generated mono buffers
export const TAU = Math.PI * 2;

// ---- filter coefficients (RBJ cookbook) ----
// type: 'lp' | 'hp' | 'bp' (0 dB peak) | 'peak'
export function biquad(type, f, q, sr = SR, gainDb = 0) {
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
export function filter(src, dst, c, { gain = 1, add = false, loop = true, sr = SR } = {}) {
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
export function lp1(buf, fc, { loop = true, sr = SR, passes = 1 } = {}) {
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
export function svf(src, dst, fFn, q, mode = 'lp', sr = SR) {
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
export function white(n, rng, out = new Float32Array(n)) {
  for (let i = 0; i < n; i++) out[i] = rng.next() * 2 - 1;
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
    const k = Math.floor(p);
    const t = p - k;
    const a = pts[k % cycles];
    const b = pts[(k + 1) % cycles];
    const s = (1 - Math.cos(t * Math.PI)) / 2;
    out[i] = a + (b - a) * s;
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

// Add a decaying sine "ping" (a struck mode) at sample `at`.
export function addMode(buf, at, f, decay, amp, sr = SR, phase = 0) {
  const n = buf.length;
  const len = Math.min(n - at, Math.ceil(decay * sr * 7));
  const w = (TAU * f) / sr;
  const d = Math.exp(-1 / (decay * sr));
  let e = amp;
  for (let i = 0; i < len; i++) {
    buf[at + i] += Math.sin(w * i + phase) * e;
    e *= d;
  }
}

// Add an exponentially decaying noise burst at `at` (wraps if loop).
export function addBurst(buf, at, decay, amp, rng, { loop = false, attack = 0.001, sr = SR } = {}) {
  const n = buf.length;
  const len = Math.ceil(decay * sr * 6);
  const att = Math.max(1, attack * sr);
  const d = Math.exp(-1 / (decay * sr));
  let e = amp;
  for (let i = 0; i < len; i++) {
    let j = at + i;
    if (j >= n) {
      if (!loop) break;
      j %= n;
    }
    const a = i < att ? i / att : 1;
    buf[j] += (rng.next() * 2 - 1) * e * a;
    if (i >= att) e *= d;
  }
}
