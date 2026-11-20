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
import { wetGrip, wetUnderSteer, wetBrake, wetTopSpeed, windPush, lightnessOfMass } from '../core/weather.js';

const WIND = { x: 0, z: 0 };

const G = 9.81;

// Original generic vehicle types. Model names are invented.
// Handling and drivetrain fields:
//   drive 'fwd'|'rwd'|'awd', gears (forward gear count), power (kW),
//   firstGear (m/s at the redline in 1st), cgFront (share of weight on the
//   front axle), grip (peak tyre friction), brake (pedal decel request,
//   m/s^2; the tyres limit it), steerMax (wheel lock at walking pace, rad),
//   accel (rough launch acceleration, m/s^2, informative).
export const VEHICLE_SPECS = {
  compact: {
    id: 'compact', label: 'Bramlet', body: 'hatch',
    length: 3.8, width: 1.7, height: 1.45, wheelBase: 2.4, wheelRadius: 0.3,
    mass: 1000, maxSpeed: 36, reverseSpeed: 8, accel: 4, brake: 13, grip: 0.95, steerMax: 0.62,
    drive: 'fwd', gears: 5, power: 56, firstGear: 13, cgFront: 0.62,
    health: 700, colors: [0xc8402e, 0x3a7bd5, 0xe8e2d0, 0x6bbf59, 0xf0a030],
  },
  sedan: {
    id: 'sedan', label: 'Selwick', body: 'sedan',
    length: 4.6, width: 1.85, height: 1.45, wheelBase: 2.75, wheelRadius: 0.33,
    mass: 1400, maxSpeed: 42, reverseSpeed: 9, accel: 4.5, brake: 14, grip: 1.0, steerMax: 0.6,
    drive: 'fwd', gears: 5, power: 88, firstGear: 14, cgFront: 0.6,
    health: 900, colors: [0x2f3b4c, 0x8a8f96, 0xd9d9d9, 0x5a1f24, 0x1f4a3a, 0x202020],
  },
  sports: {
    id: 'sports', label: 'Vexari R', body: 'coupe',
    length: 4.4, width: 1.95, height: 1.2, wheelBase: 2.6, wheelRadius: 0.34,
    mass: 1300, maxSpeed: 62, reverseSpeed: 10, accel: 7.5, brake: 17, grip: 1.25, steerMax: 0.58,
    drive: 'rwd', gears: 6, power: 190, firstGear: 18, cgFront: 0.45,
    health: 750, colors: [0xd81e2a, 0xf2d21b, 0x1e6fd8, 0xf5f5f5, 0x111111, 0xff7a1a],
  },
  // The secret car (world/secrets.js): a sports-car chassis, 10 percent
  // quicker at the top. `pedSafe`: knocking people down costs it nothing.
  ghostwake: {
    id: 'ghostwake', label: 'Ghostwake', body: 'coupe', glow: 0x3ff0dc, pedSafe: true,
    length: 4.4, width: 1.95, height: 1.2, wheelBase: 2.6, wheelRadius: 0.34,
    mass: 1250, maxSpeed: 68.2, reverseSpeed: 10, accel: 8, brake: 18, grip: 1.3, steerMax: 0.58,
    drive: 'rwd', gears: 6, power: 215, firstGear: 19.5, cgFront: 0.45,
    health: 850, colors: [0x0f9e92],
  },
  muscle: {
    id: 'muscle', label: 'Thundrel', body: 'coupe',
    length: 4.8, width: 1.95, height: 1.35, wheelBase: 2.85, wheelRadius: 0.36,
    mass: 1600, maxSpeed: 54, reverseSpeed: 9, accel: 6.5, brake: 14, grip: 1.0, steerMax: 0.58,
    drive: 'rwd', gears: 5, power: 290, firstGear: 18, cgFront: 0.55,
    health: 1000, colors: [0x14213d, 0xa31621, 0x2d6a4f, 0xe9c46a, 0x101010],
  },
  pickup: {
    id: 'pickup', label: 'Dunskar', body: 'pickup',
    length: 5.3, width: 2.0, height: 1.85, wheelBase: 3.2, wheelRadius: 0.42,
    mass: 2000, maxSpeed: 38, reverseSpeed: 8, accel: 4, brake: 12, grip: 0.9, steerMax: 0.56,
    drive: 'awd', gears: 5, power: 112, firstGear: 13, cgFront: 0.57,
    health: 1100, colors: [0x7a4b2a, 0x3d5a40, 0xb8b8b0, 0x1c3f75, 0x8c1c13],
  },
  van: {
    id: 'van', label: 'Portaby', body: 'van',
    length: 5.0, width: 2.0, height: 2.2, wheelBase: 3.0, wheelRadius: 0.36,
    mass: 2200, maxSpeed: 33, reverseSpeed: 7, accel: 3, brake: 11, grip: 0.85, steerMax: 0.56,
    drive: 'fwd', gears: 4, power: 98, firstGear: 12, cgFront: 0.58,
    health: 1100, colors: [0xf0f0ea, 0x5b6770, 0x2a5d8a, 0xc9a227],
  },
  taxi: {
    id: 'taxi', label: 'Selwick Cab', body: 'sedan',
    length: 4.6, width: 1.85, height: 1.45, wheelBase: 2.75, wheelRadius: 0.33,
    mass: 1450, maxSpeed: 42, reverseSpeed: 9, accel: 4.5, brake: 14, grip: 1.0, steerMax: 0.6,
    drive: 'fwd', gears: 5, power: 88, firstGear: 14, cgFront: 0.6,
    health: 900, colors: [0xf2c21b],
  },
  police: {
    id: 'police', label: 'Selwick Patrol', body: 'sedan',
    length: 4.8, width: 1.9, height: 1.45, wheelBase: 2.85, wheelRadius: 0.34,
    mass: 1600, maxSpeed: 52, reverseSpeed: 10, accel: 6, brake: 16, grip: 1.1, steerMax: 0.6,
    drive: 'awd', gears: 6, power: 140, firstGear: 16, cgFront: 0.56,
    health: 1200, colors: [0x1b2433],
  },
  truck: {
    id: 'truck', label: 'Bulkora', body: 'truck',
    length: 7.5, width: 2.4, height: 3.3, wheelBase: 4.4, wheelRadius: 0.5,
    mass: 6000, maxSpeed: 28, reverseSpeed: 6, accel: 2, brake: 9, grip: 0.75, steerMax: 0.5,
    drive: 'rwd', gears: 6, power: 150, firstGear: 6.5, cgFront: 0.5,
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
    px: x, pz: z, pheading: heading, ppitch: 0, proll: 0,
    roll: 0, pitch: 0, rollV: 0, pitchV: 0, suspension: 0,
    gear: 1, rpm: IDLE, shiftT: 0, sinceShift: 0, spin: 0,
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

// Two handling modes, module-wide (every car at once):
// - 'arcade' (default): tight and forgiving, about 2.5..2.8 g of lateral
//   grip (latBase + latK * spec.grip), a tyre curve that hardly sags past
//   the peak, more lock at speed (capped by the lateral acceleration it
//   asks for rather than a heavy speed taper), quicker steering, a
//   yaw-rate assist toward the bicycle-model yaw rate, less speed scrubbed
//   off through the steered wheels, and a firmer stability assist that
//   watches the rear axle (also during handbrake slides, short of a
//   spin-out). Longitudinal grip (traction, braking, ABS), weight
//   transfer, gears, power oversteer and handbrake slides remain.
// - 'sim': realistic grip (lateral friction = spec.grip), the tyre force
//   sags past the peak, full input asks for about 0.85 of grip and the
//   lock tapers with speed; only a light yaw damper. The original model.
// Fields: latBase/latK lateral friction; fall tyre sag past the peak;
// latTarget share of lateral grip full lock asks for; mechV and lockK
// mechanical lock lockK * steerMax / (1 + u / mechV); rearLat rear axle
// lateral grip factor (> 1: settles at the limit); comb/combR friction
// ellipse weight of the longitudinal force, front/rear; scrub share of
// the steered-wheel drag kept; steerRate/steerRateV input rate
// rate / (1 + u / rateV); yawK/yawFirm yaw assist gains (under/over
// rotating); betaK slide-correction gain; cutMin least drive kept in a
// slide; rearSlide measure the slide at the rear axle instead of the
// body; hbBeta/hbYaw handbrake slide caps (0 = none); squealR/squealF
// tyre squeal onset (multiples of the peak slip).
const HANDLING = {
  arcade: {
    latBase: 2.4, latK: 0.3, fall: 0.06, latTarget: 1, mechV: 80, lockK: 1.12, rearLat: 1.12,
    comb: 0.5, combR: 0.85, scrub: 0.35, steerRate: 14, steerRateV: 40, yawK: 10, yawFirm: 4,
    betaK: 150, cutMin: 0.3, rearSlide: true, hbBeta: 0.6, hbYaw: 2.2, squealR: 1.3, squealF: 1.5,
  },
  sim: {
    latBase: 0, latK: 1, fall: 0.22, latTarget: 0.85, mechV: 20, lockK: 1, rearLat: 1,
    comb: 0.85, combR: 0.85, scrub: 1, steerRate: 7, steerRateV: 15, yawK: 1.5, yawFirm: 4,
    betaK: 30, cutMin: 0.25, rearSlide: false, hbBeta: 0, hbYaw: 0, squealR: 0.9, squealF: 1.1,
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
  return H.latBase + H.latK * spec.grip;
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
    kd: 0.32 * s.width * s.height, // aero drag N per (m/s)^2
    apF: heavy ? 0.15 : 0.13, // peak slip angles (rad); softer front = understeer
    apR: heavy ? 0.13 : 0.115,
    shiftTime: heavy ? 0.45 : drive === 'rwd' && s.power > 200 ? 0.16 : 0.22,
    betaAllow: drive === 'rwd' ? 0.16 : 0.08, // body slip the assist allows
  };
  derivedCache.set(s, d);
  return d;
}

// Maximum front wheel angle at speed u: near walking pace the mechanical
// lock (which eases off a little with speed), above that whatever asks for
// about latTarget of lateral grip in a steady turn, so full input never
// simply spins the car. 'sim' tapers the mechanical lock as
// steerMax / (1 + u / 20), the same curve the traffic and police planners
// use to turn a wanted wheel angle into `steer`.
export function steerLock(spec, u) {
  const d = derive(spec);
  const au = u < 0 ? -u : u;
  const want = d.L * H.latTarget * lateralGrip(spec) * G / Math.max(au * au, 1) + (d.apF - d.apR) * 0.6;
  return Math.min(H.lockK * spec.steerMax / (1 + au / H.mechV), want);
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

  let steerIn = 0, throttle = 0, brake = 0, handbrake = false, proportional = false;
  if (controls) {
    proportional = controls.steerMode === 'proportional';
    steerIn = clamp(+controls.steer || 0, -1, 1);
    throttle = clamp(+controls.throttle || 0, 0, 1);
    brake = clamp(+controls.brake || 0, 0, 1);
    handbrake = !!controls.handbrake;
  }
  if (v.wrecked) throttle = 0;
  v.throttle = throttle;
  v.brake = brake;
  v.handbrake = handbrake;

  const wx = world && world.weather;
  const rain = wx ? wx.rain || 0 : 0;
  const wet = wetGrip(rain);
  const m = s.mass, mg = m * G, mu = s.grip * wet, muLat = lateralGrip(s) * wet, fLat = wetUnderSteer(rain);
  let ch = Math.cos(v.heading), sh = Math.sin(v.heading);
  const vf0 = v.vx * ch + v.vz * sh;
  const avf0 = Math.abs(vf0);

  // ---- Steering: rate-limited, quicker at low speed, lock shrinks with speed.
  const back = steerIn === 0 || steerIn * v.steer < 0;
  const rate = (back ? 1.6 : 1) * H.steerRate / (1 + avf0 / H.steerRateV);
  v.steer = approach(v.steer, steerIn, rate * dt);
  // Two input mappings, same limit: 'proportional' (the player) scales the
  // speed-dependent lock, so the whole input range stays useful at speed;
  // the default treats steer as a fraction of the mechanical lock curve
  // steerMax / (1 + u / 20), which the traffic and police planners use to
  // turn a wanted wheel angle into `steer`, clipped to the same lock.
  const lock = steerLock(s, vf0);
  const delta = proportional ? v.steer * lock
    : clamp(v.steer * s.steerMax / (1 + avf0 / 20), -lock, lock);
  v.steerAngle = delta;
  const cd = Math.cos(delta), sd = Math.sin(delta);

  // ---- Gearbox (automatic). Reverse engages from near standstill.
  const wantReverse = brake > 0.02 && throttle <= 0.02 && vf0 < 0.8 && !v.wrecked;
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
    while (v.gear < d.N && avf0 > d.vRed[v.gear] * 1.04) v.gear++;
    const rw = avf0 / d.vRed[v.gear];
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
  const vRed = d.vRed[gear];
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
    driveF = pedal * torque(Math.min(rEng, 1)) * d.P / (RP * vRed) * limiter;
    if (reversing) driveF *= -0.8;
    if (v.shiftT > 0) driveF *= 0.2; // torque dip while the clutch is out
  }
  // Engine braking at the driven wheels when off the pedal.
  let engBrake = 0;
  if (pedal <= 0.02 && rWheel > 0.18 && !handbrake) engBrake = m * (0.45 + 1.1 * Math.min(rWheel, 1.1));
  if (v.wrecked) engBrake += m * 2;
  // Rolling to a halt with nothing driving: drivetrain drag at crawl speed.
  const coast = pedal <= 0.02 && avf0 < 4 ? m * 0.9 : 0;

  // Throttle while rolling backwards in a forward gear acts as a brake.
  let brakeReq = 0;
  if (!reversing && brake > 0.02 && vf0 > 0.8) brakeReq = brake;
  if (throttle > 0.02 && vf0 < -0.5) brakeReq = Math.max(brakeReq, throttle);
  if (v.wrecked && brake > 0.02) brakeReq = Math.max(brakeReq, brake);
  // Hydraulic build-up: the pedal pressure rises over ~0.12 s.
  v.brakeP = approach(v.brakeP, brakeReq, 9 * dt);
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
    const dFz = m * v.accelX * d.h / L;
    const fzF = clamp(mg * d.cgF - dFz, 0.2 * mg, 0.85 * mg);
    const fzR = mg - fzF;
    const capF = mu * fzF, capR = mu * fzR; // longitudinal limits
    const capLF = muLat * fLat * fzF, capLR = muLat * H.rearLat * fzR; // lateral limits

    // Stability assist (sim: off while the handbrake is held).
    const beta = Math.atan2(vl, Math.max(avf, V0));
    let assistMz = 0;
    let driveScale = 1;
    if (!handbrake && avf > 4 && !v.wrecked) {
      let yawRef = vf * Math.tan(delta) / L;
      const yLim = muLat * G / Math.max(avf, 1);
      yawRef = clamp(yawRef, -yLim, yLim);
      // Sim measures the slide by the body slip angle; arcade by the rear
      // axle's slip past its peak, so the big body slip of a tight turn
      // at low speed is not mistaken for a slide.
      const sl = H.rearSlide ? Math.atan2(vl - b * r, Math.max(avf, V0)) : beta;
      const over = Math.abs(sl) - d.betaAllow - (H.rearSlide ? d.apR : 0);
      if (over > 0) {
        assistMz += d.iz * H.betaK * (sl > 0 ? over : -over);
        driveScale = clamp(1 - over * 5, H.cutMin, 1);
      }
      const eY = r - yawRef;
      // Damp yaw toward the steering's intent; firmer when over-rotating.
      const firm = eY * r > 0 && Math.abs(r) > Math.abs(yawRef) ? H.yawFirm : H.yawK;
      assistMz -= d.iz * firm * eY;
    } else if (handbrake && H.hbBeta > 0 && avf > 2 && !v.wrecked) {
      // Arcade handbrake: a big slide, but held short of a spin-out.
      const over = Math.abs(beta) - H.hbBeta;
      if (over > 0) assistMz += d.iz * H.betaK * (beta > 0 ? over : -over);
      const rOver = Math.abs(r) - H.hbYaw;
      if (rOver > 0) assistMz -= d.iz * 12 * (r > 0 ? rOver : -rOver);
    }

    // Longitudinal forces per axle (along each wheel), friction limited.
    const df = driveF * driveScale;
    const sgn = vf > 0 ? 1 : vf < 0 ? -1 : 0;
    const fade = Math.min(1, avf / 0.6);
    const resist = (brakeF * fade);
    const dF = df * d.frontDrive, dR = handbrake ? 0 : df - dF;
    let fxF = dF - sgn * (resist * 0.62 + engBrake * d.frontDrive * fade);
    let fxR = handbrake ? 0 : dR - sgn * (resist * 0.38 + engBrake * (1 - d.frontDrive) * fade);
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
    const latF = capLF * Math.sqrt(Math.max(0.05, 1 - H.comb * uF * uF));
    const xF = alphaF / d.apF;
    const fyF = -latF * tyre(xF);
    // Arcade tyres scrub less speed off through the steered wheel angle.
    const ffx = fxF * cd - fyF * sd * H.scrub;
    const ffy = fxF * sd + fyF * cd;
    slideF = Math.max(slideF, Math.abs(xF));

    // Rear axle: normal tyre, or locked by the handbrake (sliding friction).
    const vlr = vl - b * r;
    let frx, fry;
    if (handbrake) {
      const sp = Math.hypot(vf, vlr);
      const mag = HB_K * capR * Math.min(1, sp / 0.5);
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
      const latR = capLR * Math.sqrt(Math.max(0.05, 1 - H.combR * uR * uR));
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
  const vfc = clamp(vf, -s.reverseSpeed, s.maxSpeed * wetTopSpeed(rain));
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
  // Squeal starts past the tyre peak (later in arcade, whose tyres saturate softly).
  const slideAmt = Math.max(clamp((slideR - H.squealR) / 1.2, 0, 1), clamp((slideF - H.squealF) / 2, 0, 1));
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
