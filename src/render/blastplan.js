// The blast look in numbers (docs/REVAMP.md 6.7, the combat feel contract):
// ten layers for an ordinary car at visual scale 1, plus the helpers
// combatfx.js uses to size them. Pure: no three.js, no DOM, so the
// numbers are checked in node tests (test/blast.test.js).

export const BLAST = {
  flash: { d: 6, life: 0.05 }, // layer 1: white-yellow sprite, frame 0
  light: { r: 30, life: 0.35, rgb: [1, 0.784, 0.44] }, // 0xffc870, a pooled glow, no real light
  fire: { n: 3, r0: 2, r1: 7, t1: 0.25, life: 0.7 }, // layer 2: additive billboards
  roll: { n0: 8, n1: 12, t0: 0.08, rise: 3, reach: 12, at: 0.5, life: 2.5, drag: 0.8 }, // layer 3
  ring: { r: 16, life: 0.3 }, // layer 4: ground pressure ring
  dust: { n: 10, v: 8, life: 1.2 }, // layer 5: ground skirt
  sparks: { n: 24, life0: 0.4, life1: 0.9 }, // layer 6
  scorch: { d: 9, life: 120, fade: 5 }, // layer 8 (combat.js stores it, combatfx draws it)
  shake: { reach: 60, t: 0.5 }, // layer 10
};

// Visual scale of a blast: the craft's own scale (car 1 .. tank 1.5), or
// for a munition blast with no craft, its radius over a car's 10 m.
export function blastScale(radius, scale, craft) {
  if (craft && scale > 0) return scale;
  const r = radius > 0 ? radius : 6;
  return Math.max(0.4, Math.min(1.6, r / 10));
}

// Fireball radius (m) at time t after the blast, visual scale vs. The
// billboard grows as sqrt of its age (effects.js writePool): from
// r0 to r1 by t1, so its end size follows from that.
export function fireRadius(vs, t) {
  const F = BLAST.fire;
  const u = Math.min(1, Math.max(0, t / F.life));
  const k1 = Math.sqrt(F.t1 / F.life);
  const end = F.r0 + (F.r1 - F.r0) / k1;
  return vs * (F.r0 + (end - F.r0) * Math.sqrt(u));
}

// Smoke roll puffs: outward launch speeds (m/s) at scale 1, the fastest
// ring first. Puffs start at size s0 and grow to s1 (diameters, m).
export const ROLL_V = [30, 27, 24, 21, 17, 13, 9, 5, 25, 18, 11, 4];
export const ROLL_S0 = 3, ROLL_S1 = 9;

// Distance (m) from the centre that the edge of a smoke roll puff
// launched at speed v (scale vs) has reached t seconds after the blast.
export function rollReach(vs, v, t) {
  const R = BLAST.roll;
  const a = t - R.t0;
  if (!(a > 0)) return 0;
  const d = R.drag;
  const centre = (v * vs / d) * (1 - Math.exp(-d * a));
  const size = vs * (ROLL_S0 + (ROLL_S1 - ROLL_S0) * Math.sqrt(Math.min(1, a / R.life)));
  return centre + size * 0.5;
}

// The farthest a blast's smoke is seen from its centre at time t.
export function smokeReach(vs, t) {
  let m = 0;
  for (let i = 0; i < ROLL_V.length; i++) m = Math.max(m, rollReach(vs, ROLL_V[i], t));
  return m;
}

// Camera shake target (0..1, chasecam trauma) for a blast seen from d m:
// 1 at the centre, a straight line down to 0 at 60 m (x the visual scale
// for bigger blasts, so a tank reaches farther).
export function shakeAt(vs, d) {
  const reach = BLAST.shake.reach * Math.max(0.6, vs);
  return d >= reach ? 0 : 1 - d / reach;
}

// Dust skirt colour from the ground under the blast (city.lotTypeAt).
const SAND = [0.8, 0.72, 0.56], DIRT = [0.48, 0.4, 0.31], GREY = [0.6, 0.6, 0.58];
export function dustTone(type) {
  if (type === 'beach' || type === 'site' || type === 'wateredge') return SAND;
  if (type === 'works' || type === 'park' || type === 'grass' || type === 'yard' || type === 'verge') return DIRT;
  return GREY;
}
