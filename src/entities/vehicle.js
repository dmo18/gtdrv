// Vehicle simulation: a single-track ("bicycle") car model with a
// saturating tyre curve per axle, load transfer, an automatic gearbox and
// a stability assist, plus static collision against the world and simple
// vehicle-vs-vehicle contact.
// Pure logic (no three.js, no DOM). Heading 0 faces +x, forward vector is
// (cos h, sin h) in (x, z); right vector is (-sin h, cos h).
//
// Extra car state on top of docs/CRAFT.md:
// - `gear`: 0 = reverse, 1..spec.gears = forward gears (automatic).
// - `rpm`: engine speed as a fraction of the redline, 0..1 (idle ~0.14).
// - `steer` smoothed input (-1..1), `steerAngle` front wheel angle (rad).
// - `pitch`/`roll` body motion from a damped spring (visual only),
//   `suspension` 0..1 extra wheel travel after an impact (decays).
// - `slip` 0..1 tyre squeal / skid amount, `abs` true while ABS works.
import { clamp, angleDiff } from '../core/rng.js';
import { stepBoost, CAR_BOOST } from './boost.js';
import { wetGrip, wetUnderSteer, wetBrake, wetTopSpeed, windPush, lightnessOfMass } from '../core/weather.js';

const WIND = { x: 0, z: 0 };

const G = 9.81;

// Original generic vehicle types. Model names are invented.
// Handling and drivetrain fields:
//   drive 'fwd'|'rwd'|'awd', gears (forward gear count), power (kW),
//   firstGear (m/s at the redline in 1st), cgFront (share of weight on the
//   front axle), grip (peak tyre friction, the lateral grip in g is about
//   `lateralGrip(spec)`), brake (pedal decel request, m/s^2; the tyres
//   limit it), steerMax (true front wheel angle at walking pace, rad, the
//   same in both modes), lockRate / returnRate (full locks per second
//   away from / back toward the centre), accel (rough launch acceleration,
//   m/s^2, informative). Tuned to the bands of src/entities/handlingbands.js.
export const VEHICLE_SPECS = {
  compact: {
    id: 'compact', label: 'Bramlet', body: 'hatch',
    length: 3.8, width: 1.7, height: 1.45, wheelBase: 2.4, wheelRadius: 0.3,
    mass: 1100, maxSpeed: 44.7, reverseSpeed: 8, accel: 3, brake: 9.8, grip: 0.92, steerMax: 0.43,
    lockRate: 3.3, returnRate: 4.2,
    drive: 'fwd', gears: 5, power: 58, firstGear: 13, cgFront: 0.62,
    health: 700, colors: [0xc8402e, 0x3a7bd5, 0xe8e2d0, 0x6bbf59, 0xf0a030],
  },
  sedan: {
    id: 'sedan', label: 'Selwick', body: 'sedan',
    length: 4.6, width: 1.85, height: 1.45, wheelBase: 2.75, wheelRadius: 0.33,
    mass: 1450, maxSpeed: 51.4, reverseSpeed: 9, accel: 3.5, brake: 10.1, grip: 0.95, steerMax: 0.48,
    lockRate: 3.3, returnRate: 4.2,
    drive: 'fwd', gears: 5, power: 92, firstGear: 14, cgFront: 0.6,
    health: 900, colors: [0x2f3b4c, 0x8a8f96, 0xd9d9d9, 0x5a1f24, 0x1f4a3a, 0x202020],
  },
  sports: {
    id: 'sports', label: 'Vexari R', body: 'coupe',
    length: 4.4, width: 1.95, height: 1.2, wheelBase: 2.6, wheelRadius: 0.34,
    mass: 1400, maxSpeed: 70, reverseSpeed: 10, accel: 7, brake: 11.3, grip: 1.18, steerMax: 0.45,
    lockRate: 3.8, returnRate: 5.0,
    drive: 'rwd', gears: 6, power: 220, firstGear: 18, cgFront: 0.45,
    health: 750, colors: [0xd81e2a, 0xf2d21b, 0x1e6fd8, 0xf5f5f5, 0x111111, 0xff7a1a],
  },
  // The secret car (world/secrets.js): a sports-car chassis, 10 percent
  // quicker at the top. `pedSafe`: knocking people down costs it nothing.
  ghostwake: {
    id: 'ghostwake', label: 'Ghostwake', body: 'coupe', glow: 0x3ff0dc, pedSafe: true,
    length: 4.4, width: 1.95, height: 1.2, wheelBase: 2.6, wheelRadius: 0.34,
    mass: 1350, maxSpeed: 77, reverseSpeed: 10, accel: 7.5, brake: 11.0, grip: 1.22, steerMax: 0.45,
    lockRate: 3.8, returnRate: 5.0,
    drive: 'rwd', gears: 6, power: 260, firstGear: 19.5, cgFront: 0.45,
    health: 850, colors: [0x0f9e92],
  },
  muscle: {
    id: 'muscle', label: 'Thundrel', body: 'coupe',
    length: 4.8, width: 1.95, height: 1.35, wheelBase: 2.85, wheelRadius: 0.36,
    mass: 1700, maxSpeed: 61.5, reverseSpeed: 9, accel: 5, brake: 10.6, grip: 1.0, steerMax: 0.48,
    lockRate: 3.3, returnRate: 4.2,
    drive: 'rwd', gears: 5, power: 215, firstGear: 21, cgFront: 0.55,
    health: 1000, colors: [0x14213d, 0xa31621, 0x2d6a4f, 0xe9c46a, 0x101010],
  },
  pickup: {
    id: 'pickup', label: 'Dunskar', body: 'pickup',
    length: 5.3, width: 2.0, height: 1.85, wheelBase: 3.2, wheelRadius: 0.42,
    mass: 2100, maxSpeed: 44.7, reverseSpeed: 8, accel: 3, brake: 9.0, grip: 0.85, steerMax: 0.47,
    lockRate: 3.0, returnRate: 3.8,
    drive: 'awd', gears: 5, power: 112, firstGear: 16, cgFront: 0.57,
    health: 1100, colors: [0x7a4b2a, 0x3d5a40, 0xb8b8b0, 0x1c3f75, 0x8c1c13],
  },
  van: {
    id: 'van', label: 'Portaby', body: 'van',
    length: 5.0, width: 2.0, height: 2.2, wheelBase: 3.0, wheelRadius: 0.36,
    mass: 2200, maxSpeed: 40.2, reverseSpeed: 7, accel: 2.4, brake: 8.7, grip: 0.82, steerMax: 0.45,
    lockRate: 2.8, returnRate: 3.6,
    drive: 'fwd', gears: 4, power: 100, firstGear: 12, cgFront: 0.58,
    health: 1100, colors: [0xf0f0ea, 0x5b6770, 0x2a5d8a, 0xc9a227],
  },
  taxi: {
    id: 'taxi', label: 'Selwick Cab', body: 'sedan',
    length: 4.6, width: 1.85, height: 1.45, wheelBase: 2.75, wheelRadius: 0.33,
    mass: 1500, maxSpeed: 51.4, reverseSpeed: 9, accel: 3.5, brake: 10.1, grip: 0.95, steerMax: 0.48,
    lockRate: 3.3, returnRate: 4.2,
    drive: 'fwd', gears: 5, power: 92, firstGear: 14, cgFront: 0.6,
    health: 900, colors: [0xf2c21b],
  },
  police: {
    id: 'police', label: 'Selwick Patrol', body: 'sedan',
    length: 4.8, width: 1.9, height: 1.45, wheelBase: 2.85, wheelRadius: 0.34,
    mass: 1700, maxSpeed: 60.4, reverseSpeed: 10, accel: 4.5, brake: 9.6, grip: 1.05, steerMax: 0.49,
    lockRate: 3.6, returnRate: 4.5,
    drive: 'awd', gears: 6, power: 140, firstGear: 21, cgFront: 0.56,
    health: 1200, colors: [0x1b2433],
  },
  truck: {
    id: 'truck', label: 'Bulkora', body: 'truck',
    length: 7.5, width: 2.4, height: 3.3, wheelBase: 4.4, wheelRadius: 0.5,
    mass: 7500, maxSpeed: 31.3, reverseSpeed: 6, accel: 1.3, brake: 7.4, grip: 0.70, steerMax: 0.42,
    lockRate: 2.6, returnRate: 3.4,
    drive: 'rwd', gears: 6, power: 190, firstGear: 6.5, cgFront: 0.5,
    health: 2000, colors: [0xe8e8e8, 0x2b4c7e, 0x9b2226, 0x386641],
  },
};
// The three reward cars of docs/REVAMP.md 6.6 (the Ghostwake pattern: an
// existing chassis and body, their own id, label and one colour).
function rewardCar(base, id, label, power, o) {
  const b = VEHICLE_SPECS[base];
  return Object.assign({}, b, { id, label, power: Math.round(b.power * power), reward: true }, o);
}
VEHICLE_SPECS.sunchaser = rewardCar('muscle', 'sunchaser', 'Sunchaser', 1.08, { maxSpeed: 64.0, grip: 1.05, brake: 10.0, colors: [0xff5a1f] });
VEHICLE_SPECS.tidewinder = rewardCar('pickup', 'tidewinder', 'Tidewinder', 1.15, { maxSpeed: 49.0, grip: 0.92, brake: 9.6, firstGear: 20, health: 1400, colors: [0x1f8a8a] });
VEHICLE_SPECS.nightheron = rewardCar('sedan', 'nightheron', 'Night Heron', 1.4, { maxSpeed: 58.0, grip: 1.05, brake: 9.6, colors: [0x1a1a2e] });

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
    boostMeter: 1, boostLevel: 0, boostLock: false, boostOn: false,
    health: spec.health,
    color,
    px: x, pz: z, pheading: heading, ppitch: 0, proll: 0,
    roll: 0, pitch: 0, rollV: 0, pitchV: 0, suspension: 0,
    gear: 1, rpm: IDLE, shiftT: 0, sinceShift: 0, spin: 0, revHold: 0,
    accelX: 0, accelY: 0, brakeP: 0, abs: false,
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

// ---------------------------------------------------------------------
// Tuning constants.
const IDLE = 0.14; // idle rpm as a fraction of the redline
const RP = 0.75; // rpm fraction where the engine makes its rated power
const NSUB = 3; // tyre-dynamics sub-steps per simulation step
const V0 = 4; // m/s: slip angles use at least this speed (low-speed sanity)
const KIN_V = 4; // below this the car blends into a no-slip kinematic model
const ROLL_RES = 0.013; // rolling resistance coefficient
const ABS_K = 0.95; // ABS keeps braking at this share of the tyre limit
const HB_K = 0.8; // locked rear tyres slide at this share of grip
const LONG_K = 1.08; // tyres grip a little more in a straight line than sideways
const COMB = 0.85; // friction ellipse weight of the longitudinal force
const PEDAL_S = 1.0; // brake pedal S-curve strength (see brakePedal); 0 = linear
const BRAKE_BUILD = 9; // brake pressure rise, full pedal per second
const BRAKE_FADE_V = 0.9; // m/s: below this the brake eases off (no stop jerk)
const REV_HOLD = 0.5; // s at rest with the brake held after a stop before reverse
const DRAG_K = 0.16; // aero drag N per (m/s)^2 per m^2 of width times height
const REAR_K = 1.08; // rear tyres a little grippier than the front: the car settles at the limit (both modes)
// Rear slip (share of its peak) when the front is at its peak in a steady turn.
const XR_REAR = 1 - Math.sqrt(1 - 1 / REAR_K);
const TC_X = 1.0; // traction control starts at the rear peak slip
const ASK_V1 = 10, ASK_V2 = 20; // m/s: Sim's full-input ask ramps in between

// Two handling modes, module-wide (every car at once), docs/REVAMP.md 6.3.
// Both modes have the same straight line (power, gears, brakes with ABS),
// the same steering timing (lockRate, returnRate, steerMax) and the same
// input; they differ only in these rows:
//   latK     lateral grip = latK * spec.grip
//   fall     tyre force sag past the peak slip
//   ask      share of lateral grip that full steering input asks for
//   assist   stability assist (yaw and slide correction) on
//   yawK / yawFirm  yaw assist gains (under / over rotating); sim keeps a
//            light damper only
//   betaK    slide correction gain
//   tc       traction control: drive cut in a slide, at least cutMin kept
//   hbCap    handbrake slide capped at hbBeta (rad) and yaw at hbYaw, and
//            it recovers by itself; off = free slide while held
//   transfer share of the longitudinal weight transfer the lateral grip
//            (the balance) sees; braking and traction always see all of it
//   squeal   tyre squeal onset in multiples of the peak slip
const HANDLING = {
  arcade: {
    latK: 1.06, fall: 0.05, ask: 1.0, assist: true, yawK: 10, yawFirm: 4, betaK: 150,
    tc: true, cutMin: 0.3, hbCap: true, hbBeta: 0.6, hbYaw: 2.2, transfer: 0.5, squeal: 1.3,
  },
  sim: {
    latK: 0.98, fall: 0.2, ask: 1.1, assist: false, yawK: 1.2, yawFirm: 1.2, betaK: 0,
    tc: false, cutMin: 1, hbCap: false, hbBeta: 0, hbYaw: 0, transfer: 1, squeal: 0.9,
  },
};
let handlingMode = 'arcade';
let H = HANDLING.arcade;
let FALL = H.fall; // tyre force falls this much past the peak slip

// Pick the handling for every car: 'arcade' (default) or 'sim'. Anything
// else means 'arcade'.
export function setHandlingMode(mode) {
  handlingMode = mode === 'sim' ? 'sim' : 'arcade';
  H = HANDLING[handlingMode];
  FALL = H.fall;
  return handlingMode;
}

export function getHandlingMode() {
  return handlingMode;
}

// Lateral tyre friction of a spec in the current mode.
export function lateralGrip(spec) {
  return H.latK * spec.grip;
}

// Normalised engine torque, peak around 60% of the redline.
function torque(r) {
  const t = (r - 0.6) / 0.45;
  return 1 - 0.3 * t * t;
}

// Saturating tyre curve: x = slip / peak slip. Rises linearly, peaks at
// x = 1, then sags toward (1 - FALL) in a full slide.
function tyre(x) {
  const ax = x < 0 ? -x : x;
  let y;
  if (ax < 1) y = ax * (2 - ax);
  else y = 1 - FALL * (1 - Math.exp(-(ax - 1) * 1.4));
  return x < 0 ? -y : y;
}

// Brake pedal to share of the full brake: a gentle S that is exact at 0,
// half and full (half pedal is half the stop, test B1) and a little
// firmer in the first half of the travel, where drivers and the AI trim
// their speed. Strictly rising.
export function brakePedal(p) {
  const x = p < 0 ? 0 : p > 1 ? 1 : p;
  return x + PEDAL_S * x * (1 - x) * (1 - 2 * x);
}

// The tyre curve of the current mode (tests and tools).
export function tyreCurve(x) {
  return tyre(x);
}

// A copy of a mode's handling row (tests and tools).
export function handlingParams(mode) {
  return Object.assign({}, HANDLING[mode === 'sim' ? 'sim' : 'arcade']);
}

// Per-spec derived constants, computed once.
const derivedCache = new WeakMap();
function derive(s) {
  let d = derivedCache.get(s);
  if (d) return d;
  const L = s.wheelBase;
  const cgF = clamp(s.cgFront || 0.55, 0.3, 0.7);
  const N = clamp(Math.round(s.gears || 5), 1, 8);
  const vRed = new Float64Array(N + 1);
  const v1 = Math.min(s.firstGear || s.maxSpeed * 0.33, s.maxSpeed);
  const ratio = N > 1 ? Math.pow(s.maxSpeed / v1, 1 / (N - 1)) : 1;
  for (let g = 1; g <= N; g++) vRed[g] = v1 * Math.pow(ratio, g - 1);
  vRed[N] = s.maxSpeed; // top speed is the redline in top gear
  vRed[0] = s.reverseSpeed;
  const drive = s.drive === 'rwd' || s.drive === 'awd' ? s.drive : 'fwd';
  const heavy = s.mass > 3000;
  d = {
    L, a: L * (1 - cgF), b: L * cgF, cgF, N, vRed, drive,
    frontDrive: drive === 'fwd' ? 1 : drive === 'awd' ? 0.4 : 0,
    iz: s.mass * (s.length * s.length + s.width * s.width) / 12 * 0.9,
    h: s.height * 0.36,
    P: (s.power || 100) * 1000,
    kd: DRAG_K * s.width * s.height, // aero drag N per (m/s)^2
    lockRate: s.lockRate > 0 ? s.lockRate : 3.3,
    returnRate: s.returnRate > 0 ? s.returnRate : 4.2,
    apF: heavy ? 0.15 : 0.13, // peak slip angles (rad); softer front = understeer
    apR: heavy ? 0.13 : 0.115,
    shiftTime: heavy ? 0.45 : drive === 'rwd' && s.power > 200 ? 0.16 : 0.22,
    betaAllow: drive === 'rwd' ? 0.16 : 0.08, // body slip the assist allows
  };
  derivedCache.set(s, d);
  return d;
}

// Steering lock at speed u, as the geometric wheel angle whose kinematic
// curvature tan(angle) / L is the steady path curvature full input gives:
// at walking pace the true lock `steerMax` (the same in both modes), above
// that the angle that asks for `ask` of the lateral grip, so full input
// never simply spins the car. `steer` (-1..1, from the player or an AI
// planner) is a share of it: a planner that wants a path curvature k sends
// atan(k * wheelBase) / steerLock(spec, u) and gets about k (test A1). The
// real wheel angle adds the tyres' slip angles (steerAngle).
export function steerLock(spec, u) {
  return steerGeo(spec, u, 1);
}

// The share of lateral grip full input asks for at speed au: the mode's
// `ask` from ASK_V2 up, 1.00 at ASK_V1 and below (town speeds steer
// linearly in both modes; Sim's extra lock that scrubs and runs wide is a
// thing of real speed).
function askAt(au) {
  if (H.ask === 1) return 1;
  const k = au <= ASK_V1 ? 0 : au >= ASK_V2 ? 1 : (au - ASK_V1) / (ASK_V2 - ASK_V1);
  return 1 + (H.ask - 1) * k;
}

// Front wheel angle for a steer share s (-1..1) at speed u. At walking
// pace s * steerMax. Above that the angle is built so the steady path
// curvature is the share s of the full-lock curvature (accuracy test A1):
// the geometric angle s * L * kappa plus the slip angles the tyres need
// for that share of grip on the curve tyreCurve (front at s * ask of its
// peak, rear at the share its extra REAR_K grip leaves).
export function steerAngle(spec, u, s) {
  const d = derive(spec);
  const au = u < 0 ? -u : u;
  const as = s < 0 ? -s : s > 1 ? 1 : s;
  const ask = askAt(au);
  const geo = d.L * ask * lateralGrip(spec) * G / Math.max(au * au, 1);
  const full = geo + d.apF * ask - d.apR * XR_REAR;
  if (full >= spec.steerMax) return s * spec.steerMax;
  const yF = as * ask;
  const xF = yF < 1 ? 1 - Math.sqrt(1 - yF) : yF;
  const yR = Math.min(1, as * Math.min(1, ask) / REAR_K);
  const xR = 1 - Math.sqrt(1 - yR);
  const ang = as * geo + d.apF * xF - d.apR * xR;
  return s < 0 ? -ang : ang;
}

// Path curvature (1/m) that full input gives at speed u in a steady turn:
// steer s gives about s times it (test A1). For planners and drivers that
// want a curvature rather than a wheel angle.
export function fullLockCurvature(spec, u) {
  return Math.tan(steerGeo(spec, u, 1)) / derive(spec).L;
}

// The geometric part of that angle (what the stability assist steers the
// yaw rate toward, and what steerLock reports).
function steerGeo(spec, u, s) {
  const d = derive(spec);
  const au = u < 0 ? -u : u;
  const ask = askAt(au);
  const geo = d.L * ask * lateralGrip(spec) * G / Math.max(au * au, 1);
  const full = geo + d.apF * ask - d.apR * XR_REAR;
  return full >= spec.steerMax ? s * spec.steerMax : s * geo;
}

// Move the steering value toward its target: away from the centre at
// `lockRate` full locks per second, toward it at `returnRate`, and through
// the centre at the return rate first when the target is on the other side.
export function steerToward(cur, target, lockRate, returnRate, dt) {
  if (cur === target || !(dt > 0)) return cur;
  const away = cur === 0 ? true : cur > 0 ? target > cur : target < cur;
  if (away) return approach(cur, target, lockRate * dt);
  // Toward the centre: stop at the target if it is on the same side.
  const stop = target * cur > 0 ? target : 0;
  const need = cur > stop ? cur - stop : stop - cur;
  const step = returnRate * dt;
  if (step <= need) return cur > stop ? cur - step : cur + step;
  if (stop === target) return target;
  // Crossed the centre: spend the rest of the step at the lock rate.
  return approach(0, target, lockRate * (step - need) / returnRate);
}

const MAX_SUBSTEP_MOVE = 0.3; // metres per collision sub-step

export function stepVehicle(v, controls, dt, world) {
  const s = v.spec;
  const d = derive(s);
  v.px = v.x;
  v.pz = v.z;
  v.pheading = v.heading;
  v.ppitch = v.pitch;
  v.proll = v.roll;
  const hitBefore = v.impact;
  v.impact = 0;
  if (!(dt > 0)) return;

  let steerIn = 0, throttle = 0, brake = 0, handbrake = false, wantBoost = false;
  if (controls) {
    steerIn = clamp(+controls.steer || 0, -1, 1);
    throttle = clamp(+controls.throttle || 0, 0, 1);
    brake = clamp(+controls.brake || 0, 0, 1);
    handbrake = !!controls.handbrake;
    wantBoost = !!controls.boost;
  }
  if (v.wrecked) throttle = 0;
  v.throttle = throttle;
  v.brake = brake;
  v.handbrake = handbrake;
  // Boost (docs: src/entities/boost.js): more engine force and a higher
  // redline while the meter lasts. Grip, steering and brakes are untouched.
  stepBoost(v, wantBoost && throttle > 0.02 && brake < 0.02 && !handbrake && v.gear >= 1 && !v.wrecked, dt);
  const bLevel = v.boostLevel;
  const topK = 1 + CAR_BOOST.top * bLevel;

  const wx = world && world.weather;
  const rain = wx ? wx.rain || 0 : 0;
  const wet = wetGrip(rain);
  const m = s.mass, mg = m * G, mu = s.grip * LONG_K * wet, muLat = lateralGrip(s) * wet, fLat = wetUnderSteer(rain);
  let ch = Math.cos(v.heading), sh = Math.sin(v.heading);
  const vf0 = v.vx * ch + v.vz * sh;
  const avf0 = Math.abs(vf0);

  // ---- Steering: one rate limit (the car's lockRate / returnRate), the
  // same for the player and the AI. steer is a share of the lock.
  v.steer = steerToward(v.steer, steerIn, d.lockRate, d.returnRate, dt);
  const delta = steerAngle(s, vf0, v.steer);
  const deltaGeo = steerGeo(s, vf0, v.steer);
  v.steerAngle = delta;
  const cd = Math.cos(delta), sd = Math.sin(delta);

  // ---- Gearbox (automatic). Reverse engages from near standstill; after
  // a stop under brake the car first holds still for REV_HOLD seconds.
  if (brake > 0.02 && vf0 > 0.8) v.revHold = REV_HOLD;
  else if (brake <= 0.02) v.revHold = 0;
  else if (v.revHold > 0 && avf0 < 0.12) v.revHold = Math.max(0, v.revHold - dt);
  const wantReverse = brake > 0.02 && throttle <= 0.02 && vf0 < 0.8 && !v.wrecked && !(v.revHold > 0);
  if (v.gear === 0) {
    if (throttle > 0.02 && vf0 > -0.5) { v.gear = 1; v.shiftT = d.shiftTime; v.sinceShift = 0; }
  } else if (wantReverse && vf0 < 0.3) {
    v.gear = 0;
    v.shiftT = d.shiftTime;
    v.sinceShift = 0;
  }
  v.sinceShift += dt;
  if (v.shiftT > 0) v.shiftT = Math.max(0, v.shiftT - dt);
  if (v.gear >= 1) {
    // Far over the redline (spawned moving, towed): pick a gear at once.
    while (v.gear < d.N && avf0 > d.vRed[v.gear] * topK * 1.04) v.gear++;
    const rw = avf0 / (d.vRed[v.gear] * topK);
    const rUp = throttle > 0.02 ? 0.62 + 0.33 * throttle : 0.97; // no upshifts when coasting
    const rDown = brake > 0.02 ? 0.36 : 0.28 + 0.27 * throttle;
    if (v.shiftT === 0) {
      if (v.gear < d.N && rw > rUp && v.sinceShift > 0.3) {
        v.gear++;
        v.shiftT = d.shiftTime;
        v.sinceShift = 0;
      } else if (v.gear > 1 && rw < rDown && v.sinceShift > 0.6) {
        v.gear--;
        v.shiftT = d.shiftTime * 0.6;
        v.sinceShift = 0;
      }
    }
  }
  const gear = v.gear;
  const vRed = d.vRed[gear] * topK;
  const rWheel = avf0 / vRed;

  // ---- Engine: torque at the current revs, clutch slip when pulling away.
  const reversing = gear === 0;
  const pedal = reversing ? (wantReverse || (brake > 0.02 && vf0 < 0.8) ? brake : 0) : throttle;
  let rEng = rWheel > IDLE ? rWheel : IDLE;
  if ((gear <= 1) && pedal > 0.02) rEng = Math.max(rEng, IDLE + 0.42 * pedal);
  if (handbrake && throttle > 0.02) rEng = IDLE + 0.8 * throttle; // clutch in, free revs
  let driveF = 0;
  if (pedal > 0.02 && !handbrake && !v.wrecked) {
    const limiter = clamp((1 - rWheel) / 0.035, 0, 1);
    driveF = pedal * torque(Math.min(rEng, 1)) * d.P * (1 + (CAR_BOOST.force - 1) * bLevel) / (RP * vRed) * limiter;
    if (reversing) driveF *= -0.8;
    if (v.shiftT > 0) driveF *= 0.2; // torque dip while the clutch is out
  }
  // Engine braking at the driven wheels when off the pedal.
  let engBrake = 0;
  // The automatic's converter lets go once the brake is on, so the pedal
  // alone sets the deceleration (half pedal is half the stop).
  if (pedal <= 0.02 && brake <= 0.02 && rWheel > 0.18 && !handbrake) engBrake = m * (0.45 + 1.1 * Math.min(rWheel, 1.1));
  if (v.wrecked) engBrake += m * 2;
  // Rolling to a halt with nothing driving: drivetrain drag at crawl speed.
  const coast = pedal <= 0.02 && avf0 < 4 ? m * 0.9 : 0;

  // Throttle while rolling backwards in a forward gear acts as a brake;
  // so does the held brake while the car waits before reverse.
  let brakeReq = 0;
  if (!reversing && brake > 0.02 && (vf0 > 0.8 || v.revHold > 0)) brakeReq = brake;
  if (throttle > 0.02 && vf0 < -0.5) brakeReq = Math.max(brakeReq, throttle);
  if (v.wrecked && brake > 0.02) brakeReq = Math.max(brakeReq, brake);
  // Hydraulic build-up: the pedal pressure rises over ~0.11 s, the same
  // linear pedal in both modes (half pedal is half the deceleration).
  v.brakeP = approach(v.brakeP, brakePedal(brakeReq), BRAKE_BUILD * dt);
  const brakeF = v.brakeP * m * s.brake * wetBrake(rain);

  // ---- Tyre dynamics in sub-steps.
  const h = dt / NSUB;
  const a = d.a, b = d.b, L = d.L;
  let spinMax = 0, absOn = false, slideF = 0, slideR = 0, hbSlide = 0;
  let sumAx = 0, sumAy = 0;
  for (let k = 0; k < NSUB; k++) {
    ch = Math.cos(v.heading);
    sh = Math.sin(v.heading);
    const vf = v.vx * ch + v.vz * sh;
    const vl = -v.vx * sh + v.vz * ch;
    const r = v.yawRate;
    const avf = vf < 0 ? -vf : vf;
    // Loads with longitudinal weight transfer (from last sub-step's accel).
    // Brakes and traction see all of it; the lateral balance sees the
    // mode's share (Arcade half, Sim full).
    const dFz = m * v.accelX * d.h / L;
    const fzF = clamp(mg * d.cgF - dFz, 0.2 * mg, 0.85 * mg);
    const fzR = mg - fzF;
    const fzLF = clamp(mg * d.cgF - dFz * H.transfer, 0.2 * mg, 0.85 * mg);
    const fzLR = mg - fzLF;
    const capF = mu * fzF, capR = mu * fzR; // longitudinal limits
    const capLF = muLat * fLat * fzLF, capLR = muLat * REAR_K * fzLR; // lateral limits

    // Stability assist (Arcade), or a light yaw damper (Sim).
    const beta = Math.atan2(vl, Math.max(avf, V0));
    let assistMz = 0;
    let driveScale = 1;
    if (!handbrake && avf > 4 && !v.wrecked) {
      let yawRef = vf * Math.tan(deltaGeo) / L;
      const yLim = muLat * G / Math.max(avf, 1);
      yawRef = clamp(yawRef, -yLim, yLim);
      if (H.assist) {
        // The slide is measured at the rear axle past its peak, so the big
        // body slip of a tight turn at low speed is not mistaken for one.
        const sl = Math.atan2(vl - b * r, Math.max(avf, V0));
        const over = Math.abs(sl) - d.betaAllow - d.apR;
        if (over > 0) {
          assistMz += d.iz * H.betaK * (sl > 0 ? over : -over);
          if (H.tc) driveScale = clamp(1 - over * 5, H.cutMin, 1);
        }
        // Traction control: ease the drive off as the driven rear tyres
        // reach their peak slip, so power does not break them loose.
        const xr = (sl < 0 ? -sl : sl) / d.apR;
        if (H.tc && d.frontDrive < 1 && xr > TC_X) driveScale = Math.min(driveScale, clamp(1 - (xr - TC_X) * 4, H.cutMin, 1));
      }
      const eY = r - yawRef;
      // Damp yaw toward the steering's intent; firmer when over-rotating.
      const firm = eY * r > 0 && Math.abs(r) > Math.abs(yawRef) ? H.yawFirm : H.yawK;
      assistMz -= d.iz * firm * eY;
    } else if (handbrake && H.hbCap && avf > 2 && !v.wrecked) {
      // Arcade handbrake: a big slide, but held short of a spin-out.
      // Starts a little short of the cap so the slide does not overshoot it.
      const over = Math.abs(beta) - H.hbBeta * 0.9;
      if (over > 0) assistMz += d.iz * H.betaK * 3 * (beta > 0 ? over : -over);
      const rOver = Math.abs(r) - H.hbYaw;
      if (rOver > 0) assistMz -= d.iz * 12 * (r > 0 ? rOver : -rOver);
    }

    // Longitudinal forces per axle (along each wheel), friction limited.
    // The brake force is shared by axle load (brake force distribution),
    // so ABS holds both axles near their limit together.
    const df = driveF * driveScale;
    const sgn = vf > 0 ? 1 : vf < 0 ? -1 : 0;
    const fade = Math.min(1, avf / BRAKE_FADE_V);
    const resist = brakeF * fade;
    const shareF = fzF / mg;
    const dF = df * d.frontDrive, dR = handbrake ? 0 : df - dF;
    let fxF = dF - sgn * (resist * shareF + engBrake * d.frontDrive * fade);
    let fxR = handbrake ? 0 : dR - sgn * (resist * (1 - shareF) + engBrake * (1 - d.frontDrive) * fade);
    const roll = (ROLL_RES * mg + coast) * Math.min(1, avf / 0.5) * sgn;
    // Traction limit for driving wheels, ABS for braking ones.
    const tracF = dF !== 0 && fxF * dF > 0, tracR = dR !== 0 && fxR * dR > 0;
    const limF = tracF ? capF : capF * ABS_K;
    const limR = tracR ? capR : capR * ABS_K;
    if (Math.abs(fxF) > limF) {
      if (tracF) spinMax = Math.max(spinMax, Math.abs(fxF) / limF - 1);
      else absOn = true;
      fxF = fxF > 0 ? limF : -limF;
    }
    if (Math.abs(fxR) > limR) {
      if (tracR) spinMax = Math.max(spinMax, Math.abs(fxR) / limR - 1);
      else absOn = true;
      fxR = fxR > 0 ? limR : -limR;
    }

    // Front axle: slip angle between wheel heading and contact velocity.
    const vlf = vl + a * r;
    const vpar = vf * cd + vlf * sd;
    const vperp = -vf * sd + vlf * cd;
    const alphaF = Math.atan(vperp / Math.max(Math.abs(vpar), V0));
    const uF = fxF / capF;
    const latF = capLF * Math.sqrt(Math.max(0.05, 1 - COMB * uF * uF));
    const xF = alphaF / d.apF;
    const fyF = -latF * tyre(xF);
    const ffx = fxF * cd - fyF * sd;
    const ffy = fxF * sd + fyF * cd;
    slideF = Math.max(slideF, Math.abs(xF));

    // Rear axle: normal tyre, or locked by the handbrake (sliding friction).
    const vlr = vl - b * r;
    let frx, fry;
    if (handbrake) {
      const sp = Math.hypot(vf, vlr);
      const mag = HB_K * muLat * fzR * Math.min(1, sp / 0.5);
      if (sp > 1e-6) {
        frx = -vf / sp * mag;
        fry = -vlr / sp * mag;
      } else {
        frx = 0;
        fry = 0;
      }
      hbSlide = Math.max(hbSlide, sp);
    } else {
      const alphaR = Math.atan(vlr / Math.max(avf, V0));
      const uR = fxR / capR;
      const latR = capLR * Math.sqrt(Math.max(0.05, 1 - COMB * uR * uR));
      const xR = alphaR / d.apR;
      fry = -latR * tyre(xR);
      frx = fxR;
      slideR = Math.max(slideR, Math.abs(xR));
    }

    // Aero drag along the velocity.
    const spd = Math.hypot(vf, vl);
    const drag = d.kd * spd;
    const fx = ffx + frx - drag * vf - roll;
    const fy = ffy + fry - drag * vl;
    const mz = a * ffy - b * fry + assistMz;

    const ax = fx / m, ay = fy / m;
    sumAx += ax;
    sumAy += ay;
    v.accelX += (ax - v.accelX) * Math.min(1, 25 * h);
    v.vx += (ax * ch - ay * sh) * h;
    v.vz += (ax * sh + ay * ch) * h;
    v.yawRate = clamp(v.yawRate + mz / d.iz * h, -4, 4);
    v.heading = angleDiff(v.heading + v.yawRate * h, 0);

    // Low speed: blend into a kinematic (no side slip) model.
    const blend = clamp((avf - 0.5) / (KIN_V - 0.5), 0, 1);
    if (blend < 1) {
      ch = Math.cos(v.heading);
      sh = Math.sin(v.heading);
      const nf = v.vx * ch + v.vz * sh;
      let nl = -v.vx * sh + v.vz * ch;
      const rk = nf * Math.tan(delta) / L;
      const lk = b * rk;
      v.yawRate = rk + (v.yawRate - rk) * blend;
      nl = approach(nl, lk + (nl - lk) * blend, muLat * G * h * 1.5);
      v.vx = nf * ch - nl * sh;
      v.vz = nf * sh + nl * ch;
    }
  }

  // Strong wind nudges light cars sideways (zero in calm air).
  if (wx && wx.wind > 5 && !v.wrecked) {
    windPush(wx.wind, wx.windDir || 0, lightnessOfMass(m), world.time || 0, WIND);
    v.vx += WIND.x * dt;
    v.vz += WIND.z * dt;
  }

  // Never past the top speed or the reverse limit.
  ch = Math.cos(v.heading);
  sh = Math.sin(v.heading);
  let vf = v.vx * ch + v.vz * sh;
  const vl = -v.vx * sh + v.vz * ch;
  const vfc = clamp(vf, -s.reverseSpeed, s.maxSpeed * topK * wetTopSpeed(rain));
  // Come to a clean rest when nothing drives the car.
  const driving = driveF !== 0;
  if (!driving && Math.abs(vfc) < 0.12 && Math.abs(vl) < 0.12 && (Math.abs(v.yawRate) < 0.08 || Math.abs(vf) < 0.02)) {
    vf = 0;
    v.yawRate = 0;
    v.vx = 0;
    v.vz = 0;
  } else if (vfc !== vf) {
    vf = vfc;
    v.vx = vf * ch - vl * sh;
    v.vz = vf * sh + vl * ch;
  }
  const axAvg = sumAx / NSUB, ayAvg = sumAy / NSUB;
  v.accelY = ayAvg;
  v.abs = absOn;

  // Revs (smoothed so the engine note does not jump).
  let rTarget = rEng;
  if (v.shiftT > 0) rTarget = Math.max(IDLE, Math.abs(vf) / vRed);
  rTarget = Math.min(1, rTarget + Math.min(0.15, spinMax * 0.3));
  v.rpm = clamp(v.rpm + (rTarget - v.rpm) * Math.min(1, 14 * dt), 0, 1);
  v.spin = clamp(spinMax * 2, 0, 1);

  // ---- Body motion: damped springs for pitch (dive/squat) and roll.
  if (hitBefore > 0) bump(v, hitBefore);
  const pitchEq = clamp(axAvg * 0.0065, -0.075, 0.06);
  const rollEq = clamp(-ayAvg * 0.0075, -0.1, 0.1);
  const w = 9, z2 = 2 * 0.5 * w;
  v.pitchV += (w * w * (pitchEq - v.pitch) - z2 * v.pitchV) * dt;
  v.pitch += v.pitchV * dt;
  v.rollV += (w * w * (rollEq - v.roll) - z2 * v.rollV) * dt;
  v.roll += v.rollV * dt;
  v.pitch = clamp(v.pitch, -0.2, 0.2);
  v.roll = clamp(v.roll, -0.2, 0.2);
  v.suspension *= Math.exp(-3 * dt);
  if (v.suspension < 1e-4) v.suspension = 0;

  v.wheelSpin = (v.wheelSpin + (vf + Math.sign(driveF) * v.spin * 8) * dt / s.wheelRadius) % (Math.PI * 2);
  // Squeal starts past the tyre peak (later in Arcade, whose tyres saturate softly).
  const slideAmt = Math.max(clamp((slideR - H.squeal) / 1.2, 0, 1), clamp((slideF - H.squeal) / 2, 0, 1));
  const hbAmt = handbrake && Math.abs(vf) > 3 ? clamp(0.4 + hbSlide / 25, 0, 1) : 0;
  v.slip = Math.max(slideAmt, hbAmt, v.spin * 0.8, absOn ? 0.3 : 0);

  // Integrate position in sub-steps with collision.
  const move = Math.hypot(v.vx, v.vz) * dt;
  const n = Math.min(40, Math.max(1, Math.ceil(move / MAX_SUBSTEP_MOVE)));
  const hs = dt / n;
  const col = world && world.collision;
  let maxClose = 0;
  for (let k = 0; k < n; k++) {
    v.x += v.vx * hs;
    v.z += v.vz * hs;
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
    bump(v, maxClose);
  }
  v.speed = v.vx * Math.cos(v.heading) + v.vz * Math.sin(v.heading);

  // Safety net: never let a NaN escape.
  if (!Number.isFinite(v.x + v.z + v.heading + v.vx + v.vz + v.yawRate)) {
    v.x = v.px; v.z = v.pz; v.heading = v.pheading;
    v.vx = 0; v.vz = 0; v.yawRate = 0; v.speed = 0;
  }
  if (!Number.isFinite(v.pitch + v.roll + v.pitchV + v.rollV + v.rpm + v.accelX + v.steer + v.brakeP)) {
    v.pitch = 0; v.roll = 0; v.pitchV = 0; v.rollV = 0; v.rpm = IDLE; v.accelX = 0; v.steer = 0; v.brakeP = 0;
  }
}

// A knock to the body: suspension travel and a jolt to the springs.
function bump(v, close) {
  const k = Math.min(1, close / 12);
  if (k > v.suspension) v.suspension = k;
  v.pitchV -= k * 0.8;
  v.rollV += (v.id % 2 ? 1 : -1) * k * 0.5;
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
