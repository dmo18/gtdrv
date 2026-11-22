// Master-chain curves (pure, node-testable). audio.js puts them on two
// WaveShaperNodes: the safety curve after the peak limiter, and the
// phone-bass helper curve on a low-passed tap of the master.
//
// A1 (phone check, "harsh and crackly"): the old bass helper curve was
// tanh(3x) * 0.5 + |tanh(2.4x)| * 0.6. The |.| has a sharp corner at every
// zero crossing of the bass, which sprays harmonics far above the band it
// is meant to fill, and it is fully nonlinear even at whisper levels.
// The new curve is smooth everywhere, almost silent for quiet input and
// mixed in lower. The safety curve now tops out under -1 dBFS.

export const SAFETY_KNEE = 0.7; // exactly linear below this
export const SAFETY_CEIL = 0.89; // about -1 dBFS: never reached
export const BASS_HELPER = 0.2; // mix of the helper into the compressor (was 0.32)

export function safetyCurve(n = 4096) {
  const c = new Float32Array(n);
  const room = SAFETY_CEIL - SAFETY_KNEE;
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    const a = Math.abs(x);
    const y = a <= SAFETY_KNEE ? a : SAFETY_KNEE + room * Math.tanh((a - SAFETY_KNEE) / room);
    c[i] = x < 0 ? -y : y;
  }
  return c;
}

// Smooth: a soft clip for the 3rd harmonic and a rounded rectifier
// (sqrt(x^2 + e^2) - e) for the 2nd. Zero at zero, slope continuous.
export function bassCurve(n = 2048) {
  const c = new Float32Array(n);
  const e = 0.25;
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    c[i] = Math.tanh(2 * x) * 0.5 + (Math.sqrt(4 * x * x + e * e) - e) * 0.35;
  }
  return c;
}
