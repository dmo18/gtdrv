// Vehicle simulation: arcade car physics in the car's local frame, static
// collision against the world and simple vehicle-vs-vehicle contact.
// Pure logic (no three.js, no DOM). Heading 0 faces +x, forward vector is
// (cos h, sin h) in (x, z); right vector is (-sin h, cos h).
import { clamp, angleDiff } from '../core/rng.js';

const G = 9.81;

// Original generic vehicle types. Model names are invented.
export const VEHICLE_SPECS = {
  compact: {
    id: 'compact', label: 'Bramlet', body: 'hatch',
    length: 3.8, width: 1.7, height: 1.45, wheelBase: 2.4, wheelRadius: 0.3,
    mass: 1000, maxSpeed: 36, reverseSpeed: 8, accel: 7, brake: 13, grip: 0.95, steerMax: 0.62,
    health: 700, colors: [0xc8402e, 0x3a7bd5, 0xe8e2d0, 0x6bbf59, 0xf0a030],
  },
  sedan: {
    id: 'sedan', label: 'Corvane', body: 'sedan',
    length: 4.6, width: 1.85, height: 1.45, wheelBase: 2.75, wheelRadius: 0.33,
    mass: 1400, maxSpeed: 42, reverseSpeed: 9, accel: 8, brake: 14, grip: 1.0, steerMax: 0.6,
    health: 900, colors: [0x2f3b4c, 0x8a8f96, 0xd9d9d9, 0x5a1f24, 0x1f4a3a, 0x202020],
  },
  sports: {
    id: 'sports', label: 'Vexari R', body: 'coupe',
    length: 4.4, width: 1.95, height: 1.2, wheelBase: 2.6, wheelRadius: 0.34,
    mass: 1300, maxSpeed: 62, reverseSpeed: 10, accel: 13, brake: 17, grip: 1.25, steerMax: 0.58,
    health: 750, colors: [0xd81e2a, 0xf2d21b, 0x1e6fd8, 0xf5f5f5, 0x111111, 0xff7a1a],
  },
  muscle: {
    id: 'muscle', label: 'Thundrel', body: 'coupe',
    length: 4.8, width: 1.95, height: 1.35, wheelBase: 2.85, wheelRadius: 0.36,
    mass: 1600, maxSpeed: 54, reverseSpeed: 9, accel: 11, brake: 14, grip: 1.0, steerMax: 0.58,
    health: 1000, colors: [0x14213d, 0xa31621, 0x2d6a4f, 0xe9c46a, 0x101010],
  },
  pickup: {
    id: 'pickup', label: 'Dunskar', body: 'pickup',
    length: 5.3, width: 2.0, height: 1.85, wheelBase: 3.2, wheelRadius: 0.42,
    mass: 2000, maxSpeed: 38, reverseSpeed: 8, accel: 7, brake: 12, grip: 0.9, steerMax: 0.56,
    health: 1100, colors: [0x7a4b2a, 0x3d5a40, 0xb8b8b0, 0x1c3f75, 0x8c1c13],
  },
  van: {
    id: 'van', label: 'Movaro', body: 'van',
    length: 5.0, width: 2.0, height: 2.2, wheelBase: 3.0, wheelRadius: 0.36,
    mass: 2200, maxSpeed: 33, reverseSpeed: 7, accel: 5.5, brake: 11, grip: 0.85, steerMax: 0.56,
    health: 1100, colors: [0xf0f0ea, 0x5b6770, 0x2a5d8a, 0xc9a227],
  },
  taxi: {
    id: 'taxi', label: 'Corvane Cab', body: 'sedan',
    length: 4.6, width: 1.85, height: 1.45, wheelBase: 2.75, wheelRadius: 0.33,
    mass: 1450, maxSpeed: 42, reverseSpeed: 9, accel: 8, brake: 14, grip: 1.0, steerMax: 0.6,
    health: 900, colors: [0xf2c21b],
  },
  police: {
    id: 'police', label: 'Corvane Patrol', body: 'sedan',
    length: 4.8, width: 1.9, height: 1.45, wheelBase: 2.85, wheelRadius: 0.34,
    mass: 1600, maxSpeed: 52, reverseSpeed: 10, accel: 10.5, brake: 16, grip: 1.1, steerMax: 0.6,
    health: 1200, colors: [0x1b2433],
  },
  truck: {
    id: 'truck', label: 'Bulkora', body: 'truck',
    length: 7.5, width: 2.4, height: 3.3, wheelBase: 4.4, wheelRadius: 0.5,
    mass: 6000, maxSpeed: 28, reverseSpeed: 6, accel: 4, brake: 9, grip: 0.75, steerMax: 0.5,
    health: 2000, colors: [0xe8e8e8, 0x2b4c7e, 0x9b2226, 0x386641],
  },
};

let nextId = 1;

export function createVehicle(specId, x, z, heading = 0, rng = null) {
  const spec = VEHICLE_SPECS[specId] || VEHICLE_SPECS.sedan;
  const color = rng ? rng.pick(spec.colors) : spec.colors[0];
  return {
    id: nextId++,
    kind: 'car',
    spec,
    x, z, heading,
    y: 0, vy: 0, py: 0,
    vx: 0, vz: 0, yawRate: 0, speed: 0,
    steer: 0, steerAngle: 0,
    throttle: 0, brake: 0, handbrake: false,
    health: spec.health,
    color,
    px: x, pz: z, pheading: heading,
    roll: 0, pitch: 0,
    wheelSpin: 0,
    slip: 0,
    impact: 0,
    driver: null,
    wrecked: false,
    onFire: false,
    radius: Math.hypot(spec.length / 2, spec.width / 2),
  };
}

export function damageVehicle(v, amount) {
  if (!(amount > 0)) return;
  v.health -= amount;
  if (v.health <= 0) {
    v.health = 0;
    v.wrecked = true;
  }
}

// Damage from a collision with closing speed c (m/s).
function impactDamage(c) {
  if (c <= 4) return 0;
  const e = c - 4;
  return e * 8 + e * e * 0.15;
}

// Offset of collision circle i (0 front, 1 middle, 2 rear) along the car.
function circleOffset(spec, i) {
  const r = spec.width / 2;
  const half = Math.max(0, spec.length / 2 - r);
  return i === 0 ? half : i === 1 ? 0 : -half;
}

// Move toward target by at most step.
function approach(v, target, step) {
  if (v < target) return Math.min(target, v + step);
  return Math.max(target, v - step);
}

const MAX_SUBSTEP_MOVE = 0.3; // metres per collision sub-step

export function stepVehicle(v, controls, dt, world) {
  const s = v.spec;
  v.px = v.x;
  v.pz = v.z;
  v.pheading = v.heading;
  v.impact = 0;
  if (!(dt > 0)) return;

  let steerIn = 0, throttle = 0, brake = 0, handbrake = false;
  if (controls) {
    steerIn = clamp(+controls.steer || 0, -1, 1);
    throttle = clamp(+controls.throttle || 0, 0, 1);
    brake = clamp(+controls.brake || 0, 0, 1);
    handbrake = !!controls.handbrake;
  }
  if (v.wrecked) throttle = 0;
  v.throttle = throttle;
  v.brake = brake;
  v.handbrake = handbrake;

  const ch = Math.cos(v.heading), sh = Math.sin(v.heading);
  // Local frame velocities.
  let vf = v.vx * ch + v.vz * sh;
  let vl = -v.vx * sh + v.vz * ch;
  const vf0 = vf;

  // Longitudinal.
  if (throttle > 0.02 && vf > -0.5) {
    const r = clamp(vf / s.maxSpeed, 0, 1);
    vf += s.accel * throttle * (1 - r * r) * dt;
  } else if (throttle > 0.02) {
    // Rolling backwards with throttle: throttle acts as a brake.
    vf = approach(vf, 0, s.brake * throttle * dt);
  }
  if (brake > 0.02) {
    if (vf > 0.8) {
      vf = approach(vf, 0, s.brake * brake * dt);
    } else if (throttle <= 0.02 && !v.wrecked) {
      // Near standstill or already reversing: drive backwards.
      const r = clamp(-vf / s.reverseSpeed, 0, 1);
      vf -= s.accel * 0.6 * brake * (1 - r * r) * dt;
    } else if (v.wrecked) {
      vf = approach(vf, 0, s.brake * brake * dt);
    }
  }
  const driving = throttle > 0.02 || (brake > 0.02 && vf <= 0.8 && !v.wrecked);
  if (!driving) {
    // Engine braking and rolling resistance; settles to a full stop.
    vf = approach(vf, 0, ((v.wrecked ? 3 : 1.6) + 0.02 * Math.abs(vf)) * dt);
  }
  if (handbrake) vf = approach(vf, 0, 5 * dt);

  // Steering: smoothed input, less lock at speed.
  v.steer = approach(v.steer, steerIn, (steerIn === 0 ? 7 : 4.5) * dt);
  const aspd = Math.abs(vf);
  v.steerAngle = v.steer * s.steerMax / (1 + aspd / 20);

  // Yaw from a bicycle model, limited by available grip (understeer).
  const gripAcc = s.grip * G;
  let yawTarget = vf * Math.tan(v.steerAngle) / s.wheelBase;
  const lim = (handbrake ? 2.0 : 0.92) * gripAcc / Math.max(aspd, 1);
  let over = false;
  if (Math.abs(yawTarget) > lim) {
    yawTarget = yawTarget > 0 ? lim : -lim;
    over = true;
  }
  if (handbrake && aspd > 3) {
    // Rear steps out: exaggerate rotation in the steer direction.
    yawTarget += v.steer * 0.6;
  }
  const follow = handbrake ? 6 : 9;
  v.yawRate += (yawTarget - v.yawRate) * Math.min(1, follow * dt);
  if (aspd < 0.05 && !driving) v.yawRate *= 0.5;
  v.heading = angleDiff(v.heading + v.yawRate * dt, 0);

  // The world velocity stays put while the body rotates, so re-project
  // onto the new frame, then let lateral grip bleed sideways velocity.
  const wx = vf * ch - vl * sh;
  const wz = vf * sh + vl * ch;
  const nch = Math.cos(v.heading), nsh = Math.sin(v.heading);
  vf = wx * nch + wz * nsh;
  vl = -wx * nsh + wz * nch;
  const latGrip = gripAcc * (handbrake ? 0.3 : over ? 0.95 : 1.05);
  vl = approach(vl, 0, latGrip * dt);
  // Sliding scrubs some forward speed too.
  if (Math.abs(vl) > 1) vf = approach(vf, 0, Math.abs(vl) * 0.08 * dt);

  v.vx = vf * nch - vl * nsh;
  v.vz = vf * nsh + vl * nch;

  // Visual body lean and wheel spin.
  const latAcc = vf * v.yawRate;
  const lonAcc = (vf - vf0) / dt;
  v.roll += (clamp(-latAcc * 0.006, -0.09, 0.09) - v.roll) * Math.min(1, 8 * dt);
  v.pitch += (clamp(lonAcc * 0.006, -0.06, 0.06) - v.pitch) * Math.min(1, 8 * dt);
  v.wheelSpin = (v.wheelSpin + vf * dt / s.wheelRadius) % (Math.PI * 2);
  const slideAmt = clamp((Math.abs(vl) - 0.6) / 4, 0, 1);
  const spinAmt = handbrake && aspd > 3 ? 0.4 : 0;
  v.slip = Math.max(slideAmt, spinAmt);

  // Integrate position in sub-steps with collision.
  const move = Math.hypot(v.vx, v.vz) * dt;
  const n = Math.min(40, Math.max(1, Math.ceil(move / MAX_SUBSTEP_MOVE)));
  const h = dt / n;
  const col = world && world.collision;
  let maxClose = 0;
  for (let k = 0; k < n; k++) {
    v.x += v.vx * h;
    v.z += v.vz * h;
    if (col) {
      const c = collideStatic(v, col);
      if (c > maxClose) maxClose = c;
    }
  }

  // Keep the car on land.
  const city = world && world.city;
  if (city && typeof city.shoreDist === 'function') keepOnLand(v, city);

  if (maxClose > 0) {
    v.impact = maxClose;
    damageVehicle(v, impactDamage(maxClose));
  }
  v.speed = v.vx * Math.cos(v.heading) + v.vz * Math.sin(v.heading);

  // Safety net: never let a NaN escape.
  if (!Number.isFinite(v.x + v.z + v.heading + v.vx + v.vz + v.yawRate)) {
    v.x = v.px; v.z = v.pz; v.heading = v.pheading;
    v.vx = 0; v.vz = 0; v.yawRate = 0; v.speed = 0;
  }
}

// Resolve the three body circles against static geometry. Returns the
// largest normal closing speed of this sub-step (0 if none).
function collideStatic(v, col) {
  const s = v.spec;
  const r = s.width / 2;
  const inertiaK = 12 / (s.length * s.length + s.width * s.width);
  let maxClose = 0;
  for (let i = 0; i < 3; i++) {
    const off = circleOffset(s, i);
    const ox = Math.cos(v.heading) * off, oz = Math.sin(v.heading) * off;
    const cx = v.x + ox, cz = v.z + oz;
    const res = col.resolveCircle(cx, cz, r);
    if (!res.hit) continue;
    const dx = res.x - cx, dz = res.z - cz;
    const d = Math.hypot(dx, dz);
    if (d < 1e-9) continue;
    v.x += dx;
    v.z += dz;
    const nx = dx / d, nz = dz / d;
    // Velocity of the contact point (linear + rotation).
    const pvx = v.vx - v.yawRate * oz;
    const pvz = v.vz + v.yawRate * ox;
    const vn = pvx * nx + pvz * nz;
    if (vn >= 0) continue;
    const close = -vn;
    if (close > maxClose) maxClose = close;
    // Restitution ~0.2, softer for big crashes so wrecks do not rebound far.
    const j = -(1 + 0.2 / (1 + close / 25)) * vn; // change in normal velocity
    let dvx = j * nx, dvz = j * nz;
    // Scrape: lose some tangential speed.
    const tx = -nz, tz = nx;
    const vt = v.vx * tx + v.vz * tz;
    const scrape = vt * Math.min(0.3, close * 0.02);
    dvx -= scrape * tx;
    dvz -= scrape * tz;
    v.vx += dvx;
    v.vz += dvz;
    // Off-centre hits spin the car.
    v.yawRate += (ox * dvz - oz * dvx) * inertiaK * 0.5;
    v.yawRate = clamp(v.yawRate, -4, 4);
  }
  return maxClose;
}

function keepOnLand(v, city) {
  const d = city.shoreDist(v.x, v.z);
  if (!(d < 2)) return;
  // Inward direction is the gradient of shore distance.
  const e = 1;
  let gx = city.shoreDist(v.x + e, v.z) - city.shoreDist(v.x - e, v.z);
  let gz = city.shoreDist(v.x, v.z + e) - city.shoreDist(v.x, v.z - e);
  const gl = Math.hypot(gx, gz);
  if (!(gl > 1e-9)) return;
  gx /= gl;
  gz /= gl;
  const push = Math.min(2 - d, 4) * 0.5;
  v.x += gx * push;
  v.z += gz * push;
  const vin = v.vx * gx + v.vz * gz;
  if (vin < 0) {
    v.vx -= vin * gx;
    v.vz -= vin * gz;
  }
}

// Vehicle-vs-vehicle contact using the same 3 circles per car. Separates
// the deepest overlapping pair by inverse mass and applies an impulse.
export function collideVehicles(a, b) {
  const dx0 = b.x - a.x, dz0 = b.z - a.z;
  const rr = a.radius + b.radius;
  if (dx0 * dx0 + dz0 * dz0 >= rr * rr) return false;
  const sa = a.spec, sb = b.spec;
  const ra = sa.width / 2, rb = sb.width / 2;
  const cha = Math.cos(a.heading), sha = Math.sin(a.heading);
  const chb = Math.cos(b.heading), shb = Math.sin(b.heading);
  let best = 0, bnx = 0, bnz = 0, boax = 0, boaz = 0, bobx = 0, bobz = 0;
  for (let i = 0; i < 3; i++) {
    const oa = circleOffset(sa, i);
    const oax = cha * oa, oaz = sha * oa;
    for (let k = 0; k < 3; k++) {
      const ob = circleOffset(sb, k);
      const obx = chb * ob, obz = shb * ob;
      const dx = b.x + obx - (a.x + oax), dz = b.z + obz - (a.z + oaz);
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
      } else {
        bnx = 1;
        bnz = 0;
      }
      boax = oax; boaz = oaz; bobx = obx; bobz = obz;
    }
  }
  if (best <= 0) return false;
  const ima = 1 / sa.mass, imb = 1 / sb.mass;
  const sum = ima + imb;
  // Positional separation, mass weighted.
  a.x -= bnx * best * (ima / sum);
  a.z -= bnz * best * (ima / sum);
  b.x += bnx * best * (imb / sum);
  b.z += bnz * best * (imb / sum);
  // Relative velocity along the normal (b relative to a).
  const rvn = (b.vx - a.vx) * bnx + (b.vz - a.vz) * bnz;
  if (rvn < 0) {
    const j = -(1 + 0.2) * rvn / sum; // impulse magnitude
    const jx = j * bnx, jz = j * bnz;
    a.vx -= jx * ima;
    a.vz -= jz * ima;
    b.vx += jx * imb;
    b.vz += jz * imb;
    // Off-centre spin, scaled down for arcade feel.
    const ia = sa.mass * (sa.length * sa.length + sa.width * sa.width) / 12;
    const ib = sb.mass * (sb.length * sb.length + sb.width * sb.width) / 12;
    a.yawRate = clamp(a.yawRate - (boax * jz - boaz * jx) / ia * 0.5, -4, 4);
    b.yawRate = clamp(b.yawRate + (bobx * jz - bobz * jx) / ib * 0.5, -4, 4);
    const close = -rvn;
    if (close > a.impact) a.impact = close;
    if (close > b.impact) b.impact = close;
    const dmg = impactDamage(close);
    damageVehicle(a, dmg * 2 * sb.mass / (sa.mass + sb.mass));
    damageVehicle(b, dmg * 2 * sa.mass / (sa.mass + sb.mass));
  }
  return true;
}

// The 4 world-space corners: front-right, front-left, rear-left, rear-right.
// Writes into out (array of 8 numbers: x0, z0, x1, z1, ...).
export function vehicleCorners(v, out = new Array(8)) {
  const hl = v.spec.length / 2, hw = v.spec.width / 2;
  const c = Math.cos(v.heading), s = Math.sin(v.heading);
  const fx = c * hl, fz = s * hl, rx = -s * hw, rz = c * hw;
  out[0] = v.x + fx + rx; out[1] = v.z + fz + rz;
  out[2] = v.x + fx - rx; out[3] = v.z + fz - rz;
  out[4] = v.x - fx - rx; out[5] = v.z - fz - rz;
  out[6] = v.x - fx + rx; out[7] = v.z - fz + rz;
  return out;
}
