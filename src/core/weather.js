// Pure weather effects on driving. Plain numbers in, plain numbers out, no
// three.js and no DOM. All inputs are the blended values of game.weather
// (rain, fog 0..1, wind in m/s), so nothing here ever jumps.

const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const unit = (x) => (x > 0 ? (x < 1 ? x : 1) : 0);

// Share of dry tire grip left on a wet road. Exactly 1 in clear weather,
// falling smoothly to 0.72 in a downpour.
export function wetGrip(rain) {
  return 1 - 0.28 * unit(rain);
}

// Extra loss of front lateral grip in rain (a touch of understeer).
// 1 when dry, 0.94 in a downpour.
export function wetUnderSteer(rain) {
  return 1 - 0.06 * unit(rain);
}

// Brake pedal strength on a wet road (the longer stop). 1 when dry.
export function wetBrake(rain) {
  return 1 - 0.1 * unit(rain);
}

// Top speed share: untouched up to rain 0.6, then down to 0.94 in a downpour.
export function wetTopSpeed(rain) {
  const r = unit(rain);
  return r <= 0.6 ? 1 : 1 - 0.06 * ((r - 0.6) / 0.4);
}

// Gentle sideways push on light craft in strong wind. `lightness` is 0
// (heavy, unaffected) to 1 (very light). Writes the world acceleration
// (m/s^2) into out.x/out.z; never more than 0.9 m/s^2, zero in calm air.
export function windPush(wind, windDir, lightness, time, out) {
  const strength = clamp((wind - 5) / 9, 0, 1);
  const gust = 0.8 + 0.2 * Math.sin(time * 0.9 + windDir * 3);
  const mag = 0.9 * strength * clamp(lightness, 0, 1) * gust;
  out.x = Math.cos(windDir) * mag;
  out.z = Math.sin(windDir) * mag;
  return mag;
}

// Lightness of a road vehicle from its mass (1000 kg compact ~0.67, 2000+ 0).
export function lightnessOfMass(mass) {
  return clamp((2000 - mass) / 1500, 0, 1);
}

// Scale on how far watchers see in fog (1 clear, 0.45 in thick fog).
export function fogSightScale(fog) {
  return 1 - 0.55 * unit((unit(fog) - 0.2) / 0.8);
}

// 0..1 chance weight of spotting something `dist` away given `range`.
// Falls with both fog and distance.
export function fogSightFactor(fog, dist, range) {
  const r = range * fogSightScale(fog);
  return r > 0 ? unit(1 - dist / r) : 0;
}
