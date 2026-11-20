// Boat simulation: arcade handling on water. Thrust comes from the stern,
// the rudder/prop only bites when the boat is moving or the engine is
// pushing water past it, and the hull slides sideways a lot before the
// water bleeds that slide off. Pure logic (no three.js, no DOM).
// Heading 0 faces +x, forward vector (cos h, sin h) in (x, z), right
// vector (-sin h, cos h).
import { clamp, angleDiff } from '../core/rng.js';

const G = 9.81;

// Sea surface: a cheap sum of three travelling sines (amplitude about
// 0.24 m). The water renderer builds its vertex shader from this same
// table so boats sit on the visible waves.
// Each wave: height a * sin(kx * x + kz * z + w * t).
export const WAVES = [
  { a: 0.11, kx: 0.09, kz: 0.03, w: 0.9 },
  { a: 0.08, kx: -0.05, kz: 0.12, w: 1.3 },
  { a: 0.05, kx: 0.15, kz: 0.15, w: 2.1 },
];

export function waveHeight(x, z, t) {
  let h = 0;
  for (let i = 0; i < WAVES.length; i++) {
    const w = WAVES[i];
    h += w.a * Math.sin(w.kx * x + w.kz * z + w.w * t);
  }
  return h;
}

// Original boat types. Names are invented.
// accel: full-throttle thrust (m/s^2) at rest; drag: linear water drag
// (1/s) while powered; coastDrag: extra constant drag (m/s^2) when the
// engine is idle so the boat coasts to a stop; turnRate: max yaw rate
// (rad/s); yawResp: how quickly the yaw rate follows (1/s); sideGrip:
// how quickly sideways slide bleeds off (1/s, lower = more slide);
// draft: hull depth below the waterline; hop: how readily it skips off
// wave crests at speed; pitchMax/rollMax: visual body angles (rad).
export const BOAT_SPECS = {
  speedboat: {
    id: 'speedboat', label: 'Swiftgull', hull: 'runabout',
    length: 6.4, width: 2.3, height: 1.5, draft: 0.45,
    mass: 1400, maxSpeed: 30, reverseSpeed: 5, accel: 8.5, drag: 0.02, coastDrag: 0.8,
    turnRate: 1.2, yawResp: 3.2, sideGrip: 2.0, hop: 1.0, pitchMax: 0.13, rollMax: 0.2,
    health: 800, colors: [0xf4f4f0, 0xc8302a, 0x1e5fa8, 0xf2c230, 0x222831],
  },
  jetski: {
    id: 'jetski', label: 'Skimlet', hull: 'jetski',
    length: 3.0, width: 1.15, height: 1.15, draft: 0.25,
    mass: 380, maxSpeed: 26, reverseSpeed: 3, accel: 11, drag: 0.02, coastDrag: 1.1,
    turnRate: 2.3, yawResp: 6, sideGrip: 2.8, hop: 1.4, pitchMax: 0.1, rollMax: 0.4,
    health: 400, colors: [0xffd21f, 0x18b4c8, 0xe0306a, 0x38c050, 0xf2f2f2],
  },
  fisher: {
    id: 'fisher', label: 'Kettlewake', hull: 'fisher',
    length: 9.0, width: 3.2, height: 3.8, draft: 1.0,
    mass: 6500, maxSpeed: 12, reverseSpeed: 3, accel: 2.4, drag: 0.03, coastDrag: 0.5,
    turnRate: 0.45, yawResp: 1.3, sideGrip: 1.1, hop: 0.15, pitchMax: 0.05, rollMax: 0.08,
    health: 1600, colors: [0x2f6d4f, 0x8a2a22, 0x2a4c7a, 0xd8d0b8],
  },
  yacht: {
    id: 'yacht', label: 'Marlowen', hull: 'yacht',
    length: 14, width: 4.2, height: 4.6, draft: 1.3,
    mass: 16000, maxSpeed: 16, reverseSpeed: 3, accel: 2.6, drag: 0.025, coastDrag: 0.45,
    turnRate: 0.38, yawResp: 1.0, sideGrip: 1.0, hop: 0.1, pitchMax: 0.06, rollMax: 0.07,
    health: 2400, colors: [0xf7f7f4, 0x1c2a44, 0xe6e0d0],
  },
  // Easter egg (found by double-tapping the version number in the pause menu).
  submarine: {
    id: 'submarine', label: 'Sub', hull: 'submarine',
    length: 12, width: 2.6, height: 3.4, draft: 0.7,
    mass: 9000, maxSpeed: 18, reverseSpeed: 4, accel: 3.2, drag: 0.03, coastDrag: 0.5,
    turnRate: 0.7, yawResp: 1.6, sideGrip: 1.3, hop: 0.2, pitchMax: 0.05, rollMax: 0.1,
    health: 2000, colors: [0x2b3a42, 0x3d4a3a, 0x58402a],
  },
  dinghy: {
    id: 'dinghy', label: 'Bobbin', hull: 'inflatable',
    length: 3.2, width: 1.6, height: 0.75, draft: 0.2,
    mass: 260, maxSpeed: 14, reverseSpeed: 3, accel: 4.5, drag: 0.04, coastDrag: 1.0,
    turnRate: 1.4, yawResp: 4, sideGrip: 2.0, hop: 0.6, pitchMax: 0.09, rollMax: 0.16,
    health: 300, colors: [0xe8582a, 0x3a3f46, 0xd8d8d0, 0xf0b81c],
  },
};

let nextId = 100000;

export function createBoat(specId, x, z, heading = 0, rng = null) {
  const spec = BOAT_SPECS[specId] || BOAT_SPECS.speedboat;
  const color = rng ? rng.pick(spec.colors) : spec.colors[0];
  return {
    id: nextId++,
    kind: 'boat',
    spec,
    x, z, y: 0, heading, pitch: 0, roll: 0,
    px: x, pz: z, py: 0, pheading: heading, ppitch: 0, proll: 0,
    vx: 0, vz: 0, vy: 0, speed: 0, yawRate: 0, steer: 0,
    throttle: 0, brake: 0,
    health: spec.health, wrecked: false, impact: 0,
    driver: null,
    radius: Math.hypot(spec.length / 2, spec.width / 2),
    color,
    wake: 0, planing: 0,
    surf: NaN, hop: 0, hopV: 0, hopCool: 0,
  };
}

export function damageBoat(b, amount) {
  if (!(amount > 0)) return;
  b.health -= amount;
  if (b.health <= 0) {
    b.health = 0;
    b.wrecked = true;
  }
}

// Damage from a collision with closing speed c (m/s); none up to 6 m/s.
function impactDamage(c) {
  if (c <= 6) return 0;
  const e = c - 6;
  return e * 7 + e * e * 0.15;
}

function approach(v, target, step) {
  if (v < target) return Math.min(target, v + step);
  return Math.max(target, v - step);
}

// Collision circles: bow (i = 0) and stern (i = 1) on the centre line.
function circleRadius(s) {
  return s.width / 2;
}
function circleOffset(s, i) {
  const half = Math.max(0, s.length / 2 - s.width / 2);
  return i === 0 ? half : -half;
}

const MAX_SUBSTEP_MOVE = 0.3;
const SHORE_MARGIN = -1.5; // boats keep shoreDist below this

export function stepBoat(b, controls, dt, world) {
  const s = b.spec;
  b.px = b.x;
  b.pz = b.z;
  b.py = b.y;
  b.pheading = b.heading;
  b.ppitch = b.pitch;
  b.proll = b.roll;
  b.impact = 0;
  if (!(dt > 0)) return;
  const time = world && Number.isFinite(world.time) ? world.time : 0;

  let steerIn = 0, throttle = 0, brake = 0;
  if (controls) {
    steerIn = clamp(+controls.steer || 0, -1, 1);
    throttle = clamp(+controls.throttle || 0, 0, 1);
    brake = clamp(+controls.brake || 0, 0, 1);
  }
  if (b.wrecked) {
    throttle = 0;
    brake = 0;
  }
  b.throttle = throttle;
  b.brake = brake;

  const ch = Math.cos(b.heading), sh = Math.sin(b.heading);
  let vf = b.vx * ch + b.vz * sh;
  let vl = -b.vx * sh + b.vz * ch;

  // Thrust from the stern. Brake is reverse thrust: it slows a boat
  // going forward and then backs it up.
  if (throttle > 0.02) {
    if (vf >= 0) {
      const r = clamp(vf / s.maxSpeed, 0, 1);
      vf += s.accel * throttle * (1 - r * r) * dt;
    } else {
      vf += s.accel * throttle * dt;
    }
  }
  if (brake > 0.02 && throttle <= 0.02) {
    if (vf > 0) {
      vf = Math.max(-0.01, vf - s.accel * 0.9 * brake * dt);
    } else {
      const r = clamp(-vf / s.reverseSpeed, 0, 1);
      vf -= s.accel * 0.5 * brake * (1 - r * r) * dt;
    }
  }
  const power = Math.max(throttle, brake * 0.7);
  // Water drag: linear while powered, stronger plus a constant term when
  // idle so it coasts to a stop instead of creeping forever.
  if (power > 0.02) {
    vf -= vf * s.drag * dt;
  } else {
    vf = approach(vf, 0, (s.coastDrag + 2 * s.drag * Math.abs(vf)) * dt);
  }

  // Steering authority: grows with speed through the water and with
  // prop wash over the rudder; weak when drifting with no power.
  b.steer = approach(b.steer, steerIn, (steerIn === 0 ? 5 : 3.5) * dt);
  const aspd = Math.abs(vf);
  const spdF = clamp(aspd / (s.maxSpeed * 0.35), 0, 1);
  const auth = clamp(spdF * (0.3 + 0.7 * power) + 0.3 * power, 0, 1);
  // Fast boats lose a little authority at the very top end.
  const hiSpd = 1 - 0.25 * clamp((aspd / s.maxSpeed - 0.6) / 0.4, 0, 1);
  const dir = vf < -0.3 ? -1 : 1;
  const yawTarget = b.steer * s.turnRate * auth * hiSpd * dir;
  b.yawRate += (yawTarget - b.yawRate) * Math.min(1, s.yawResp * dt);
  b.heading = angleDiff(b.heading + b.yawRate * dt, 0);

  // The water velocity stays while the hull rotates (that is the slide),
  // then the keel bleeds off sideways motion. A share of it is turned
  // into forward speed (the hull carves), the rest is lost.
  const wx = vf * ch - vl * sh;
  const wz = vf * sh + vl * ch;
  const nch = Math.cos(b.heading), nsh = Math.sin(b.heading);
  vf = wx * nch + wz * nsh;
  vl = -wx * nsh + wz * nch;
  const keep = Math.exp(-s.sideGrip * (0.6 + 0.4 * power) * dt);
  const lost = vl * (1 - keep);
  vl -= lost;
  if (vf > 0.5) vf = Math.min(s.maxSpeed, vf + Math.abs(lost) * 0.25);
  if (Math.abs(vl) > 1) vf = approach(vf, 0, Math.abs(vl) * 0.05 * dt);
  if (aspd < 0.02 && power <= 0.02) b.yawRate *= Math.exp(-3 * dt);

  b.vx = vf * nch - vl * nsh;
  b.vz = vf * nsh + vl * nch;

  // Integrate position in sub-steps with collision.
  const move = Math.hypot(b.vx, b.vz) * dt;
  const n = Math.min(40, Math.max(1, Math.ceil(move / MAX_SUBSTEP_MOVE)));
  const hdt = dt / n;
  const wcol = world && world.waterCollision;
  const city = world && world.city;
  const hasShore = !!(city && typeof city.shoreDist === 'function');
  let maxClose = 0;
  for (let k = 0; k < n; k++) {
    b.x += b.vx * hdt;
    b.z += b.vz * hdt;
    if (wcol) {
      const c = collideStatic(b, wcol);
      if (c > maxClose) maxClose = c;
    }
    if (hasShore) {
      const c = keepOffShore(b, city);
      if (c > maxClose) maxClose = c;
    }
  }
  if (maxClose > 0) {
    b.impact = maxClose;
    damageBoat(b, impactDamage(maxClose));
  }

  const fch = Math.cos(b.heading), fsh = Math.sin(b.heading);
  b.speed = b.vx * fch + b.vz * fsh;
  const sr = clamp(Math.abs(b.speed) / s.maxSpeed, 0, 1);

  // Planing: the hull climbs onto the surface above ~30% of top speed.
  const planeTarget = b.speed > 0 ? clamp((sr - 0.3) / 0.4, 0, 1) : 0;
  b.planing += (planeTarget - b.planing) * Math.min(1, 1.5 * dt);

  // Waves under bow, stern and both sides.
  const hl = s.length * 0.4, hw = s.width * 0.45;
  const rx = -fsh, rz = fch;
  const hb = waveHeight(b.x + fch * hl, b.z + fsh * hl, time);
  const hs = waveHeight(b.x - fch * hl, b.z - fsh * hl, time);
  const hr = waveHeight(b.x + rx * hw, b.z + rz * hw, time);
  const hlft = waveHeight(b.x - rx * hw, b.z - rz * hw, time);
  const surf = (hb + hs + hr + hlft) * 0.25;
  const prevSurf = Number.isFinite(b.surf) ? b.surf : surf;
  b.surf = surf;
  const rise = (surf - prevSurf) / dt;
  // A planing hull rides higher and skims over the waves.
  const follow = 1 - 0.45 * b.planing;
  const baseY = surf * follow + 0.06 * b.planing;

  // Small hops off rising crests at high speed.
  b.hopCool = Math.max(0, b.hopCool - dt);
  if (b.hop <= 0 && b.hopCool <= 0 && sr > 0.6 && rise > 0.3 && s.hop > 0) {
    b.hopV = s.hop * (0.4 + rise) * (sr - 0.4) * 2;
    b.hopCool = 0.7;
  }
  if (b.hop > 0 || b.hopV > 0) {
    b.hopV -= G * dt;
    b.hop += b.hopV * dt;
    if (b.hop <= 0) {
      b.hop = 0;
      b.hopV = 0;
    }
  }
  b.y = baseY + b.hop;
  b.vy = (b.y - b.py) / dt;

  // Visual angles. Pitch: bow rises climbing onto the plane (a hump in
  // the middle of the speed range under power), settles a bit once up,
  // plus wave slope. Roll: leans into the turn, plus wave slope.
  const climb = throttle * clamp(sr / 0.5, 0, 1) * (1 - 0.5 * b.planing);
  const wavePitch = Math.atan((hb - hs) / (2 * hl)) * (1 - 0.5 * b.planing);
  const pitchTarget = s.pitchMax * (0.55 * b.planing + 0.6 * climb) + wavePitch + b.hopV * 0.01;
  b.pitch += (clamp(pitchTarget, -0.35, 0.35) - b.pitch) * Math.min(1, 4 * dt);
  const latAcc = b.speed * b.yawRate;
  const lean = clamp(latAcc * s.rollMax / 7, -s.rollMax, s.rollMax);
  const waveRoll = Math.atan((hlft - hr) / (2 * hw)) * (0.6 - 0.3 * b.planing);
  b.roll += (clamp(lean + waveRoll, -0.5, 0.5) - b.roll) * Math.min(1, 5 * dt);

  // Spray / wake strength for effects.
  const slide = clamp(Math.abs(vl) / 6, 0, 1);
  const wakeTarget = clamp(sr * (0.45 + 0.55 * power) + slide * 0.5, 0, 1);
  b.wake += (wakeTarget - b.wake) * Math.min(1, 3 * dt);

  // Safety net: never let a NaN escape.
  if (!Number.isFinite(b.x + b.z + b.y + b.heading + b.vx + b.vz + b.yawRate + b.pitch + b.roll + b.hop + b.hopV)) {
    b.x = b.px; b.z = b.pz; b.y = b.py; b.heading = b.pheading;
    b.pitch = 0; b.roll = 0; b.vx = 0; b.vz = 0; b.vy = 0;
    b.yawRate = 0; b.speed = 0; b.hop = 0; b.hopV = 0; b.surf = NaN;
    if (!Number.isFinite(b.x + b.z + b.y + b.heading)) {
      b.x = 0; b.z = 0; b.y = 0; b.heading = 0;
    }
  }
}

// Bow and stern circles against piers and buoys. Returns the largest
// closing speed of this sub-step (0 if none).
function collideStatic(b, col) {
  const s = b.spec;
  const r = circleRadius(s);
  const ch = Math.cos(b.heading), sh = Math.sin(b.heading);
  let maxClose = 0;
  for (let i = 0; i < 2; i++) {
    const off = circleOffset(s, i);
    const ox = ch * off, oz = sh * off;
    const cx = b.x + ox, cz = b.z + oz;
    const res = col.resolveCircle(cx, cz, r, 0);
    if (!res.hit) continue;
    const dx = res.x - cx, dz = res.z - cz;
    const d = Math.hypot(dx, dz);
    if (d < 1e-9) continue;
    b.x += dx;
    b.z += dz;
    const nx = dx / d, nz = dz / d;
    const pvx = b.vx - b.yawRate * oz;
    const pvz = b.vz + b.yawRate * ox;
    const vn = pvx * nx + pvz * nz;
    if (vn >= 0) continue;
    const close = -vn;
    if (close > maxClose) maxClose = close;
    const j = -1.15 * vn;
    b.vx += j * nx;
    b.vz += j * nz;
    // Off-centre knocks swing the hull around.
    const k = 6 / (s.length * s.length);
    b.yawRate = clamp(b.yawRate + (ox * j * nz - oz * j * nx) * k, -3, 3);
  }
  return maxClose;
}

// Keep bow, middle and stern out of the shallows: where shoreDist is
// above the margin, push back out along the outward gradient and kill
// velocity into the shore. Returns the closing speed (0 if none).
function keepOffShore(b, city) {
  const s = b.spec;
  const ch = Math.cos(b.heading), sh = Math.sin(b.heading);
  const reach = s.length * 0.45;
  let close = 0;
  for (let i = 0; i < 3; i++) {
    const off = i === 0 ? reach : i === 1 ? 0 : -reach;
    const qx = b.x + ch * off, qz = b.z + sh * off;
    const d = city.shoreDist(qx, qz);
    if (!(d > SHORE_MARGIN)) continue;
    const e = 1;
    let gx = city.shoreDist(qx + e, qz) - city.shoreDist(qx - e, qz);
    let gz = city.shoreDist(qx, qz + e) - city.shoreDist(qx, qz - e);
    const gl = Math.hypot(gx, gz);
    if (!(gl > 1e-9)) continue;
    gx /= gl;
    gz /= gl; // points inland
    const push = Math.min(d - SHORE_MARGIN + 0.05, 20);
    b.x -= gx * push;
    b.z -= gz * push;
    const vin = b.vx * gx + b.vz * gz;
    if (vin > 0) {
      b.vx -= vin * gx;
      b.vz -= vin * gz;
      if (vin > close) close = vin;
      // Grounding scrubs some of the remaining speed too.
      b.vx *= 0.97;
      b.vz *= 0.97;
    }
  }
  return close;
}

// Boat-vs-boat contact using bow and stern circles. Separates the
// deepest overlapping pair by inverse mass and applies an impulse.
export function collideBoats(a, b) {
  const dx0 = b.x - a.x, dz0 = b.z - a.z;
  const rr = a.radius + b.radius;
  if (dx0 * dx0 + dz0 * dz0 >= rr * rr) return false;
  const sa = a.spec, sb = b.spec;
  const ra = circleRadius(sa), rb = circleRadius(sb);
  const cha = Math.cos(a.heading), sha = Math.sin(a.heading);
  const chb = Math.cos(b.heading), shb = Math.sin(b.heading);
  let best = 0, bnx = 1, bnz = 0;
  for (let i = 0; i < 2; i++) {
    const oa = circleOffset(sa, i);
    for (let k = 0; k < 2; k++) {
      const ob = circleOffset(sb, k);
      const dx = b.x + chb * ob - (a.x + cha * oa);
      const dz = b.z + shb * ob - (a.z + sha * oa);
      const d2 = dx * dx + dz * dz;
      const rs = ra + rb;
      if (d2 >= rs * rs) continue;
      const d = Math.sqrt(d2);
      const depth = rs - d;
      if (depth <= best) continue;
      best = depth;
      if (d > 1e-6) {
        bnx = dx / d;
        bnz = dz / d;
      } else if (Math.hypot(dx0, dz0) > 1e-6) {
        const l = Math.hypot(dx0, dz0);
        bnx = dx0 / l;
        bnz = dz0 / l;
      } else {
        bnx = 1;
        bnz = 0;
      }
    }
  }
  if (best <= 0) return false;
  const ima = 1 / sa.mass, imb = 1 / sb.mass;
  const sum = ima + imb;
  a.x -= bnx * best * (ima / sum);
  a.z -= bnz * best * (ima / sum);
  b.x += bnx * best * (imb / sum);
  b.z += bnz * best * (imb / sum);
  const rvn = (b.vx - a.vx) * bnx + (b.vz - a.vz) * bnz;
  if (rvn < 0) {
    const j = -(1 + 0.3) * rvn / sum;
    a.vx -= j * bnx * ima;
    a.vz -= j * bnz * ima;
    b.vx += j * bnx * imb;
    b.vz += j * bnz * imb;
    const close = -rvn;
    if (close > a.impact) a.impact = close;
    if (close > b.impact) b.impact = close;
    const dmg = impactDamage(close);
    damageBoat(a, dmg * 2 * sb.mass / (sa.mass + sb.mass));
    damageBoat(b, dmg * 2 * sa.mass / (sa.mass + sb.mass));
  }
  return true;
}
