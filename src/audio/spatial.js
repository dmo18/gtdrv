// Small pure helpers for positioning sounds (audio.js uses them; unit
// tests check them in node).
export const SOUND_SPEED = 343;
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

// Doppler pitch factor for a source moving away from the listener at
// `rel` m/s (negative = approaching). Clamped so a glitchy velocity
// never produces a silly pitch.
export function dopplerFactor(rel) {
  const r = Number.isFinite(rel) ? clamp(rel, -80, 80) : 0;
  return clamp(SOUND_SPEED / (SOUND_SPEED + r), 0.8, 1.25);
}

// Air absorbs high frequencies: a low-pass cut-off for distance d (m).
export function distanceLowpass(d, k = 120) {
  const x = Number.isFinite(d) ? Math.max(0, d) : 0;
  return clamp(20000 * Math.exp(-x / k), 900, 20000);
}

// Seconds for a sound to arrive from d metres, capped.
export function travelDelay(d, cap = 2.5) {
  return Number.isFinite(d) && d > 0 ? Math.min(cap, d / SOUND_SPEED) : 0;
}
