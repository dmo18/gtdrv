// Measurement helpers for generated sound buffers (used by the node
// analysis script, unit tests and the browser harness). Pure maths on
// Float32Arrays, no Web Audio. None of this runs during play.

const TAU = Math.PI * 2;

// In-place radix-2 FFT on re/im arrays of power-of-two length.
export function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      let t = re[i]; re[i] = re[j]; re[j] = t;
      t = im[i]; im[i] = im[j]; im[j] = t;
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const w = -TAU / len;
    const wr = Math.cos(w);
    const wi = Math.sin(w);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k, b = a + len / 2;
        const tr = re[b] * cr - im[b] * ci;
        const ti = re[b] * ci + im[b] * cr;
        re[b] = re[a] - tr; im[b] = im[a] - ti;
        re[a] += tr; im[a] += ti;
        const nr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = nr;
      }
    }
  }
}

// Averaged power spectrum (Hann windows, 50 % overlap). Returns
// { psd: Float64Array(size/2), binHz }.
export function spectrum(data, sr, size = 4096) {
  const N = Math.min(size, 1 << Math.floor(Math.log2(Math.max(64, data.length))));
  const psd = new Float64Array(N / 2);
  const re = new Float64Array(N);
  const im = new Float64Array(N);
  const hop = N / 2;
  let frames = 0;
  for (let s = 0; s + N <= Math.max(N, data.length); s += hop) {
    for (let i = 0; i < N; i++) {
      const x = s + i < data.length ? data[s + i] : 0;
      re[i] = x * (0.5 - 0.5 * Math.cos((TAU * i) / (N - 1)));
      im[i] = 0;
    }
    fft(re, im);
    for (let k = 0; k < N / 2; k++) psd[k] += re[k] * re[k] + im[k] * im[k];
    frames++;
    if (s + N >= data.length) break;
  }
  for (let k = 0; k < N / 2; k++) psd[k] /= frames;
  return { psd, binHz: sr / N };
}

// Fraction of spectral power in each band [lo, hi) Hz.
export function bandShares(sp, edges = [0, 100, 300, 1000, 3000, 8000, 1e9]) {
  const out = new Array(edges.length - 1).fill(0);
  let total = 0;
  for (let k = 1; k < sp.psd.length; k++) {
    const f = k * sp.binHz;
    total += sp.psd[k];
    for (let b = 0; b < out.length; b++) {
      if (f >= edges[b] && f < edges[b + 1]) {
        out[b] += sp.psd[k];
        break;
      }
    }
  }
  return out.map((v) => (total > 0 ? v / total : 0));
}

export function centroid(sp) {
  let a = 0, b = 0;
  for (let k = 1; k < sp.psd.length; k++) {
    a += k * sp.binHz * sp.psd[k];
    b += sp.psd[k];
  }
  return b > 0 ? a / b : 0;
}

// Spectral flatness 0..1 (1 = white noise, near 0 = tonal), 60 Hz..8 kHz.
export function flatness(sp) {
  let lg = 0, ar = 0, n = 0;
  for (let k = 1; k < sp.psd.length; k++) {
    const f = k * sp.binHz;
    if (f < 60 || f > 8000) continue;
    const p = sp.psd[k] + 1e-20;
    lg += Math.log(p);
    ar += p;
    n++;
  }
  return n ? Math.exp(lg / n) / (ar / n) : 0;
}

export function peakOf(d) {
  let p = 0;
  for (let i = 0; i < d.length; i++) {
    const a = Math.abs(d[i]);
    if (a > p) p = a;
  }
  return p;
}

export function rmsOf(d, from = 0, to = d.length) {
  let s = 0;
  for (let i = from; i < to; i++) s += d[i] * d[i];
  return Math.sqrt(s / Math.max(1, to - from));
}

export const db = (v) => (v > 0 ? 20 * Math.log10(v) : -120);

// A rough loudness: RMS after a K-like weighting (2nd-order high-pass at
// 60 Hz and a +4 dB shelf above 2 kHz, done with one-pole sections),
// over the loudest 400 ms window (one-shots) or the whole loop.
export function loudness(d, sr, loop = false) {
  const n = d.length;
  const w = new Float32Array(n);
  const a = Math.exp((-TAU * 60) / sr);
  let y1 = 0, x1 = 0, y2 = 0, x2 = 0;
  const ah = Math.exp((-TAU * 2000) / sr);
  let lpz = 0;
  for (let i = 0; i < n; i++) {
    const x = d[i];
    y1 = a * (y1 + x - x1); x1 = x;
    y2 = a * (y2 + y1 - x2); x2 = y1;
    lpz = ah * lpz + (1 - ah) * y2;
    w[i] = y2 + 0.58 * (y2 - lpz);
  }
  if (loop) return db(rmsOf(w)) - 0.7;
  const win = Math.min(n, Math.round(0.4 * sr));
  let best = 0;
  let s = 0;
  for (let i = 0; i < n; i++) {
    s += w[i] * w[i];
    if (i >= win) s -= w[i - win] * w[i - win];
    if (i >= win - 1 && s > best) best = s;
  }
  return db(Math.sqrt(best / win)) - 0.7;
}

// Time (s) for the envelope to fall 40 dB below its peak (one-shots).
export function decayTime(d, sr) {
  const blk = Math.max(1, Math.round(sr * 0.01));
  let pk = 0, pkAt = 0;
  const env = [];
  for (let i = 0; i < d.length; i += blk) {
    const e = rmsOf(d, i, Math.min(d.length, i + blk));
    env.push(e);
    if (e > pk) {
      pk = e;
      pkAt = env.length - 1;
    }
  }
  let last = pkAt;
  for (let i = pkAt; i < env.length; i++) if (env[i] > pk * 0.01) last = i;
  return ((last - pkAt + 1) * blk) / sr;
}

// Time of peak envelope (attack), seconds.
export function attackTime(d, sr) {
  const blk = Math.max(1, Math.round(sr * 0.002));
  let pk = 0, at = 0;
  for (let i = 0; i < d.length; i += blk) {
    const e = rmsOf(d, i, Math.min(d.length, i + blk));
    if (e > pk) {
      pk = e;
      at = i;
    }
  }
  return at / sr;
}

// Fundamental by autocorrelation in [fMin, fMax] Hz.
export function pitchOf(d, sr, fMin = 20, fMax = 1000) {
  const n = Math.min(d.length, Math.round(sr * 0.5));
  const lo = Math.max(2, Math.floor(sr / fMax));
  const hi = Math.min(n - 2, Math.ceil(sr / fMin));
  let best = 0, bestL = 0;
  let r0 = 0;
  for (let i = 0; i < n; i++) r0 += d[i] * d[i];
  for (let L = lo; L <= hi; L++) {
    let s = 0;
    for (let i = 0; i + L < n; i++) s += d[i] * d[i + L];
    s /= r0 || 1;
    if (s > best * 1.0001) {
      best = s;
      bestL = L;
    }
  }
  return bestL ? sr / bestL : 0;
}

// Everything at once for one buffer.
export function measure(d, sr, loop = false) {
  const sp = spectrum(d, sr);
  const pk = peakOf(d);
  const rms = rmsOf(d);
  let clipped = 0;
  for (let i = 0; i < d.length; i++) if (Math.abs(d[i]) >= 0.999) clipped++;
  return {
    dur: d.length / sr,
    peak: pk,
    peakDb: db(pk),
    rmsDb: db(rms),
    crestDb: db(pk) - db(rms),
    lufs: loudness(d, sr, loop),
    centroid: centroid(sp),
    flat: flatness(sp),
    bands: bandShares(sp),
    clipped,
    decay: loop ? 0 : decayTime(d, sr),
    attack: loop ? 0 : attackTime(d, sr),
  };
}
