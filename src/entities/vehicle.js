// Vehicle simulation: a single-track ("bicycle") car model with a
// saturating tire curve per axle, load transfer, an automatic gearbox and
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
// - `slip` 0..1 tire squeal / skid amount, `abs` true while ABS works.
import { clamp, angleDiff } from '../core/rng.js';
import { stepBoost, CAR_BOOST } from './boost.js';
import { SERVICE_SPECS } from './servicevehicles.js'; // V1 service vehicles, merged below the reward cars
import { wetGrip, wetUnderSteer, wetBrake, wetTopSpeed, windPush, lightnessOfMass } from '../core/weather.js';
import { groundFn, SEA_LEVEL } from '../world/ground.js';
import { PRESETS, setActivePreset, activePreset, presetValues, validPreset } from '../core/handlingpreset.js';

const WIND = { x: 0, z: 0 };

const G = 9.81;

// Original generic vehicle types. Model names are invented.
// Handling and drivetrain fields:
//   drive 'fwd'|'rwd'|'awd', gears (forward gear count), power (kW),
//   firstGear (m/s at the redline in 1st), cgFront (share of weight on the
//   front axle), grip (steady lateral grip in g in Sim, the real car's
//   skidpad figure; `lateralGrip(spec, u)` in the current mode), gripLong
//   (longitudinal tire friction; absent: grip * LONG_K), brake (pedal decel
//   request, m/s^2; the tires limit it), steerMax (true front wheel angle at
//   walking pace, rad, the same in both modes), lockRate / returnRate (full
//   locks per second away from / back toward the center), rollDeg (body
//   roll at the limit), accel (rough launch acceleration, m/s^2,
//   informative). Tuned to the bands of src/entities/handlingbands.js.
// The tire, steering and drivetrain numbers written below are the chassis
// the reward cars were built on; the eighteen fleet classes take their own
// from CLASS_HANDLING (task HANDLE), applied after the reward cars.
export const VEHICLE_SPECS = {
  // The fleet of docs/FLEET.md: the compact sedan (the hatchback retired).
  compact: {
    id: 'compact', label: 'Marlow', body: 'sedan',
    length: 4.63, width: 1.76, height: 1.43, wheelBase: 2.70, wheelRadius: 0.32,
    mass: 1350, maxSpeed: 44.7, reverseSpeed: 8, accel: 3, brake: 9.8, grip: 0.95, steerMax: 0.43,
    lockRate: 3.3, returnRate: 4.2,
    drive: 'fwd', gears: 5, power: 58, firstGear: 13, cgFront: 0.62,
    health: 700, colors: [0xeeeeec, 0x1b1c1f, 0xa9adb2, 0x5c6167, 0x8e1b1f, 0x2b4a7a, 0x3f5a4a],
  },
  // The full-size sedan (the Selwick retired); the taxi and the police car
  // share its body.
  sedan: {
    id: 'sedan', label: 'Brigham', body: 'sedan',
    length: 5.1, width: 1.85, height: 1.47, wheelBase: 2.95, wheelRadius: 0.35,
    mass: 1450, maxSpeed: 51.4, reverseSpeed: 9, accel: 3.5, brake: 10.1, grip: 0.95, steerMax: 0.48,
    lockRate: 3.3, returnRate: 4.2,
    drive: 'fwd', gears: 5, power: 92, firstGear: 14, cgFront: 0.6,
    health: 900, colors: [0x1b1c1f, 0xeeeeec, 0xa9adb2, 0x4a4f55, 0x1c2a44, 0x5a1a20, 0x6b6052],
  },
  sports: {
    id: 'sports', label: 'Kestrel', body: 'coupe',
    length: 4.55, width: 1.93, height: 1.23, wheelBase: 2.72, wheelRadius: 0.34,
    mass: 1550, maxSpeed: 70, reverseSpeed: 10, accel: 7, brake: 11.3, grip: 1.18, steerMax: 0.45,
    lockRate: 3.8, returnRate: 5.0,
    drive: 'rwd', gears: 6, power: 220, firstGear: 18, cgFront: 0.45,
    health: 750, colors: [0xc8161e, 0xeeeeec, 0x111214, 0xe8b60f, 0x1e5fc8, 0x9aa0a6],
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
    id: 'muscle', label: 'Redtail', body: 'coupe',
    length: 4.8, width: 1.92, height: 1.38, wheelBase: 2.72, wheelRadius: 0.36,
    mass: 1750, maxSpeed: 61.5, reverseSpeed: 9, accel: 5, brake: 10.6, grip: 1.0, steerMax: 0.48,
    lockRate: 3.3, returnRate: 4.2,
    drive: 'rwd', gears: 5, power: 215, firstGear: 21, cgFront: 0.55,
    health: 1000, colors: [0x111214, 0xa31621, 0x1d3f8a, 0xeeeeec, 0x4a5a3a, 0xd86a14, 0x8a8f96],
  },
  pickup: {
    id: 'pickup', label: 'Fieldhand', body: 'pickup',
    length: 5.3, width: 2.0, height: 1.85, wheelBase: 3.2, wheelRadius: 0.42,
    mass: 2100, maxSpeed: 44.7, reverseSpeed: 8, accel: 3, brake: 9.0, grip: 0.85, steerMax: 0.47,
    lockRate: 3.0, returnRate: 3.8,
    drive: 'awd', gears: 5, power: 112, firstGear: 16, cgFront: 0.57,
    health: 1100, colors: [0xf0f0ee, 0xf0f0ee, 0xa9adb2, 0x15161a, 0x8e1b1f, 0x233a5c],
  },
  // The conventional cargo van (the one-box van retired).
  van: {
    id: 'van', label: 'Cartway', body: 'van',
    length: 5.95, width: 2.03, height: 2.1, wheelBase: 3.3, wheelRadius: 0.38,
    mass: 2500, maxSpeed: 40.2, reverseSpeed: 7, accel: 2.4, brake: 8.7, grip: 0.82, steerMax: 0.45,
    lockRate: 2.8, returnRate: 3.6,
    drive: 'fwd', gears: 4, power: 100, firstGear: 12, cgFront: 0.58,
    health: 1100, colors: [0xf0f0ee, 0xf0f0ee, 0xa9adb2, 0x5c6167, 0x1c2a44, 0x15161a],
  },
  taxi: {
    id: 'taxi', label: 'Brigham Cab', body: 'sedan',
    length: 5.1, width: 1.85, height: 1.47, wheelBase: 2.95, wheelRadius: 0.35,
    mass: 1500, maxSpeed: 51.4, reverseSpeed: 9, accel: 3.5, brake: 10.1, grip: 0.95, steerMax: 0.48,
    lockRate: 3.3, returnRate: 4.2,
    drive: 'fwd', gears: 5, power: 92, firstGear: 14, cgFront: 0.6,
    health: 900, colors: [0xf2b80f],
  },
  police: {
    id: 'police', label: 'Brigham Patrol', body: 'sedan', police: true, // siren and lights (src/core/yield.js: hasSiren)
    length: 5.1, width: 1.9, height: 1.46, wheelBase: 2.95, wheelRadius: 0.34,
    mass: 1700, maxSpeed: 60.4, reverseSpeed: 10, accel: 4.5, brake: 9.6, grip: 1.05, steerMax: 0.49,
    lockRate: 3.6, returnRate: 4.5,
    drive: 'awd', gears: 6, power: 140, firstGear: 21, cgFront: 0.56,
    health: 1200, colors: [0x121315],
  },
  // The conventional box truck (the cab-over truck retired).
  truck: {
    id: 'truck', label: 'Stockman', body: 'truck',
    length: 7.6, width: 2.4, height: 3.3, wheelBase: 4.5, wheelRadius: 0.5,
    mass: 7500, maxSpeed: 31.3, reverseSpeed: 6, accel: 1.3, brake: 7.4, grip: 0.70, steerMax: 0.42,
    lockRate: 2.6, returnRate: 3.4,
    drive: 'rwd', gears: 6, power: 190, firstGear: 6.5, cgFront: 0.5,
    health: 2000, colors: [0xeeeeec, 0xeeeeec, 0x1c3f75, 0x8e1b1f, 0x2f5a3a, 0x15161a],
  },
};
// The three reward cars of docs/REVAMP.md 6.6 (the Ghostwake pattern: an
// existing chassis and body, their own id, label and one color).
function rewardCar(base, id, label, power, o) {
  const b = VEHICLE_SPECS[base];
  return Object.assign({}, b, { id, label, power: Math.round(b.power * power), reward: true }, o);
}
// The reward cars keep the size and mass of the chassis they were built on
// (the fleet changed those specs' bodies).
const OLD_MUSCLE = { length: 4.8, width: 1.95, height: 1.35, wheelBase: 2.85, wheelRadius: 0.36, mass: 1700 };
const OLD_SEDAN = { length: 4.6, width: 1.85, height: 1.45, wheelBase: 2.75, wheelRadius: 0.33, mass: 1450 };
VEHICLE_SPECS.sunchaser = rewardCar('muscle', 'sunchaser', 'Sunchaser', 1.08, { ...OLD_MUSCLE, maxSpeed: 64.0, grip: 1.05, brake: 10.0, colors: [0xff5a1f] });
VEHICLE_SPECS.tidewinder = rewardCar('pickup', 'tidewinder', 'Tidewinder', 1.15, { maxSpeed: 49.0, grip: 0.92, brake: 9.6, firstGear: 20, health: 1400, colors: [0x1f8a8a] });
VEHICLE_SPECS.nightheron = rewardCar('sedan', 'nightheron', 'Night Heron', 1.4, { ...OLD_SEDAN, maxSpeed: 58.0, grip: 1.05, brake: 9.6, colors: [0x1a1a2e] });
// The first three bodies of the American fleet (docs/FLEET.md, PLAN_V3
// 2.6): their own size, body and driver's eye point (car frame: x ahead,
// y up, z right; the driver sits on the left), handling of the base
// chassis until the HANDLE task gives them their own (PLAN_V3 2.4).
function fleetCar(base, id, label, body, size, eye, colors) {
  return Object.assign({}, VEHICLE_SPECS[base], { id, label, body, colors, eye }, size);
}
VEHICLE_SPECS.midsize = fleetCar('sedan', 'midsize', 'Avenel', 'sedan',
  { length: 4.9, width: 1.86, height: 1.45, wheelBase: 2.83, wheelRadius: 0.345, mass: 1500 }, { x: -0.39, y: 1.17, z: -0.34 },
  [0xeeeeec, 0x1b1c1f, 0xa9adb2, 0x5c6167, 0x1f3556, 0x8e1b1f, 0x6b5a4a]);
VEHICLE_SPECS.suv = fleetCar('pickup', 'suv', 'Tallgrass', 'suv',
  { length: 5.35, width: 2.06, height: 1.92, wheelBase: 3.07, wheelRadius: 0.41 }, { x: -0.17, y: 1.64, z: -0.4 },
  [0x121315, 0xeeeeec, 0x6c7176, 0x2a3442, 0x4a1c20, 0xb3b6ba]);
VEHICLE_SPECS.crewcab = fleetCar('pickup', 'crewcab', 'Ironbark', 'pickup',
  { length: 5.9, width: 2.03, height: 1.95, wheelBase: 3.68, wheelRadius: 0.41 }, { x: -0.21, y: 1.68, z: -0.4 },
  [0xf0f0ee, 0x15161a, 0x8f9499, 0x7a1416, 0x233a5c, 0x4f5546]);
// The other new classes (task FLEET): the handling of the nearest existing
// chassis (HANDLE gives them their own), their own size, mass and paint.
// The buses' wheels cut further than the truck's (a bus turns in a 72 to
// 86 ft circle, PLAN_V3 2.4, on a far longer wheelbase): `extra`.
function newClass(base, id, label, body, size, colors, extra) {
  return Object.assign({}, VEHICLE_SPECS[base], { id, label, body, colors }, size, extra || {});
}
VEHICLE_SPECS.crossover = newClass('sedan', 'crossover', 'Sandpiper', 'crossover',
  { length: 4.75, width: 1.88, height: 1.7, wheelBase: 2.75, wheelRadius: 0.37, mass: 1750 },
  [0xeeeeec, 0x1b1c1f, 0xa9adb2, 0x5c6167, 0x2b4a7a, 0x7a1a20, 0x6b6052]);
VEHICLE_SPECS.convertible = newClass('sedan', 'convertible', 'Shoreline', 'coupe',
  { length: 4.95, width: 1.88, height: 1.4, wheelBase: 2.85, wheelRadius: 0.35, mass: 1750 },
  [0xeeeeec, 0xa31621, 0x1b1c1f, 0x2e6fb0, 0xe8d9b0, 0x9aa0a6]);
VEHICLE_SPECS.minivan = newClass('van', 'minivan', 'Homestead', 'van',
  { length: 5.18, width: 1.99, height: 1.78, wheelBase: 3.03, wheelRadius: 0.36, mass: 2050 },
  [0xeeeeec, 0xa9adb2, 0x1b1c1f, 0x5c6167, 0x1c2a44, 0x5a1a20]);
VEHICLE_SPECS.semi = newClass('truck', 'semi', 'Plainsman', 'truck',
  { length: 6.8, width: 2.5, height: 3.25, wheelBase: 3.9, wheelRadius: 0.52, mass: 8500 },
  [0xeeeeec, 0x8e1b1f, 0x1c3f75, 0x15161a, 0x5c6167, 0x2f5a3a]);
VEHICLE_SPECS.schoolbus = newClass('truck', 'schoolbus', 'Larkfield', 'bus',
  { length: 11.6, width: 2.44, height: 3.05, wheelBase: 6.4, wheelRadius: 0.5, mass: 12000 },
  [0xf2b400], { steerMax: 0.59 });
VEHICLE_SPECS.citybus = newClass('truck', 'citybus', 'Crosstown', 'bus',
  { length: 12.2, width: 2.59, height: 3.2, wheelBase: 7.2, wheelRadius: 0.5, mass: 13500 },
  [0xf2f2ee], { steerMax: 0.59 });
// The handling of the eighteen fleet classes (docs/PLAN_V3.md 2.4, task
// HANDLE), from published figures for a US reference vehicle of each class
// (the reference table and its bands: REFERENCE in handlingbands.js):
//   grip      skidpad g of the real car: the steady lateral grip in Sim
//             (Arcade multiplies it by its grip curve, gripFactor)
//   gripLong  longitudinal tire friction (brakes and traction), above
//             grip like a real tire: a car stops harder than it corners
//   rollDeg   body roll at the limit in Sim (the roll gradient is
//             rollDeg / grip degrees per g)
//   steerMax  wheel angle at full lock (bicycle mean of the two fronts),
//             set so the curb-to-curb circle is the table's
//   power     tuned to the table's 0-60 mph
//   brake     full-pedal deceleration asked, 1.06 times what the tires
//             give (gripLong with ABS): ABS works at full brake on dry
//             ground, the 60-0 mph figure comes from the tires, and half
//             pedal is still about half the stop
// Steering timing for every player car (task DRIVE, docs/PLAN_V3.md 13):
// the wheels reach full lock in 0.18 s (lockRate 5.5) and come back to
// center in 0.2 s (returnRate 5), so a slow thumb, not the car, sets the
// pace. The service vehicles keep their own slower rates.
export const LOCK_RATE = 5.5;
export const RETURN_RATE = 5;
export const CLASS_HANDLING = {
  compact: { grip: 0.83, gripLong: 1.011, rollDeg: 4.5, steerMax: 0.607, power: 79, brake: 9.99 },
  midsize: { grip: 0.84, gripLong: 1.012, rollDeg: 4.5, steerMax: 0.603, power: 107, brake: 10 },
  sedan: { grip: 0.82, gripLong: 0.97, rollDeg: 5, steerMax: 0.591, power: 106, brake: 9.58 },
  taxi: { grip: 0.82, gripLong: 0.97, rollDeg: 5, steerMax: 0.591, power: 109, brake: 9.59 },
  police: { grip: 0.88, gripLong: 1.013, rollDeg: 4, steerMax: 0.593, power: 153, brake: 10.01 },
  crossover: { grip: 0.80, gripLong: 0.971, rollDeg: 5.5, steerMax: 0.605, power: 117, brake: 9.59 },
  suv: { grip: 0.76, gripLong: 0.933, rollDeg: 6, steerMax: 0.628, power: 150, brake: 9.21 },
  crewcab: { grip: 0.74, gripLong: 0.933, rollDeg: 6, steerMax: 0.623, power: 150, brake: 9.21 },
  pickup: { grip: 0.74, gripLong: 0.898, rollDeg: 6, steerMax: 0.617, power: 140, brake: 8.87, wheelBase: 3.12 },
  muscle: { grip: 0.95, gripLong: 1.16, rollDeg: 3.5, steerMax: 0.581, power: 222, brake: 11.46 },
  sports: { grip: 1.03, gripLong: 1.282, rollDeg: 2.5, steerMax: 0.582, power: 267, brake: 12.66 },
  convertible: { grip: 0.85, gripLong: 1.014, rollDeg: 4.5, steerMax: 0.589, power: 139, brake: 10.01 },
  minivan: { grip: 0.78, gripLong: 0.971, rollDeg: 5.5, steerMax: 0.636, power: 141, brake: 9.6 },
  van: { grip: 0.72, gripLong: 0.899, rollDeg: 6, steerMax: 0.638, power: 138, brake: 8.88 },
  truck: { grip: 0.62, gripLong: 0.737, rollDeg: 5, steerMax: 0.655, power: 234, brake: 7.28 },
  semi: { grip: 0.55, gripLong: 0.622, rollDeg: 4, steerMax: 0.507, power: 211, brake: 6.14 },
  schoolbus: { grip: 0.52, gripLong: 0.658, rollDeg: 5, steerMax: 0.695, power: 265, brake: 6.5 },
  citybus: { grip: 0.52, gripLong: 0.658, rollDeg: 5, steerMax: 0.602, power: 274, brake: 6.5 },
};
for (const id in CLASS_HANDLING) Object.assign(VEHICLE_SPECS[id], CLASS_HANDLING[id]);
for (const id in VEHICLE_SPECS) Object.assign(VEHICLE_SPECS[id], { lockRate: LOCK_RATE, returnRate: RETURN_RATE });
// The driver's eye of each new body (car frame, the driver on the left),
// from the cabin it is built with (carbody eyePoint; test/carmesh checks).
const FLEET_EYES = {
  compact: [-0.31, 1.14, -0.32],
  police: [-0.33, 1.18, -0.35],
  taxi: [-0.33, 1.19, -0.34],
  crossover: [-0.22, 1.41, -0.35],
  muscle: [-0.41, 1.1, -0.34],
  sports: [-0.55, 0.95, -0.33],
  convertible: [-0.36, 1.13, -0.33],
  minivan: [0.05, 1.44, -0.38],
  van: [0.43, 1.62, -0.41],
  truck: [1.45, 2.08, -0.48],
  semi: [0.29, 2.56, -0.5],
  schoolbus: [4.47, 1.96, -0.53],
  citybus: [4.76, 2.12, -0.57],
  pickup: [0.05, 1.58, -0.39],
};
for (const id in FLEET_EYES) {
  const [x, y, z] = FLEET_EYES[id];
  VEHICLE_SPECS[id].eye = { x, y, z };
}
Object.assign(VEHICLE_SPECS, SERVICE_SPECS, { police: Object.assign(VEHICLE_SPECS.police, { siren: true }) });

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
    // Ground following (docs/PLAN_V3.md 2.2 item 5): wheel ground heights
    // (front-right, front-left, rear-right, rear-left), the ground plane's
    // pitch and roll, each wheel's offset from that plane, curb jolts.
    wg: new Float32Array(4), wheelDy: new Float32Array(4), gPitch: 0, gRoll: 0, pgPitch: 0, pgRoll: 0,
    grounded: false, jolt: 0, jolts: 0, joltCool: 0, wade: 0,
    propHits: 0,
    px: x, pz: z, pheading: heading, ppitch: 0, proll: 0,
    roll: 0, pitch: 0, rollV: 0, pitchV: 0, suspension: 0,
    gear: 1, rpm: IDLE, shiftT: 0, sinceShift: 0, spin: 0, revHold: 0,
    accelX: 0, accelY: 0, brakeP: 0, abs: false,
    wheelSpin: 0,
    slip: 0,
    // Arcade (planted model): the handbrake slide asked for (rad, + nose
    // right of the travel), its rate, the time a crash leaves the car loose, and the path curvature
    // the steering has built up (1/m).
    slide: 0, slideV: 0, knock: 0, curv: 0,
    // Front tire slip as a multiple of its peak (1 = at the grip limit) and
    // how far past the limit the front is pushing (0..1, understeer).
    slipF: 0, push: 0,
    impact: 0,
    driver: null,
    wrecked: false,
    onFire: false,
    radius: Math.hypot(spec.length / 2, spec.width / 2),
  };
}

// The damage rule (docs/PLAN_V3.md 2.3 item 1): every damageVehicle call
// passes through it, fn(vehicle, amount, kind, source) -> the amount to
// apply. src/systems/combat.js sets it (the "cannot die" floor, Hard mode).
// kind: 'crash' (wall, prop or car contact), 'prop' (shearing a prop),
// or whatever the caller names. null: the amount as given.
let damageRule = null;
export function setDamageRule(fn) {
  damageRule = typeof fn === 'function' ? fn : null;
}
export function getDamageRule() {
  return damageRule;
}

// Returns the damage applied. A car wrecked by a crash (not by fire or a
// weapon) is marked crashWreck: it does not explode.
export function damageVehicle(v, amount, kind = 'crash', source = null) {
  if (!(amount > 0)) return 0;
  if (damageRule) {
    amount = damageRule(v, amount, kind, source);
    if (!(amount > 0)) return 0;
  }
  v.health -= amount;
  if (v.health <= 0) {
    v.health = 0;
    if (!v.wrecked && (kind === 'crash' || kind === 'prop')) v.crashWreck = true;
    v.wrecked = true;
  }
  return amount;
}

// Crash damage starts at 11 mph of closing speed (2.3 item 3).
export const CRASH_MIN = 11 / 2.23694; // m/s
// Shearing a breakable prop: a small fixed knock (Hard mode only, by the rule).
export const PROP_BREAK_DAMAGE = 10;
// Car on car: the lighter car takes at most this much more than an even
// share (and the heavier at least the low share).
export const MASS_SHARE = [0.6, 1.3];

// Damage from a collision with closing speed c (m/s).
export function impactDamage(c) {
  if (c <= CRASH_MIN) return 0;
  const e = c - CRASH_MIN;
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
const NSUB = 3; // tire-dynamics sub-steps per simulation step
const V0 = 4; // m/s: slip angles use at least this speed (low-speed sanity)
const KIN_V = 4; // below this the car blends into a no-slip kinematic model
const ROLL_RES = 0.013; // rolling resistance coefficient
const ABS_K = 0.95; // ABS keeps braking at this share of the tire limit
const HB_K = 0.8; // locked rear tires slide at this share of grip
const LONG_K = 1.08; // tires grip a little more in a straight line than sideways
const COMB = 0.85; // friction ellipse weight of the longitudinal force
const PEDAL_S = 1.0; // brake pedal S-curve strength (see brakePedal); 0 = linear
const BRAKE_BUILD = 9; // brake pressure rise, full pedal per second
const BRAKE_FADE_V = 0.9; // m/s: below this the brake eases off (no stop jerk)
const REV_HOLD = 0.5; // s at rest with the brake held after a stop before reverse
const DRAG_K = 0.16; // aero drag N per (m/s)^2 per m^2 of width times height
const REAR_K = 1.08; // rear tires a little grippier than the front: the car settles at the limit (both modes)
const SCRUB = 0.2; // Arcade: share of the front's cornering drag that slows the car in a turn
const KNOCK_MIN = 3, KNOCK_S = 0.4, KNOCK_PER = 30; // Arcade: a crash over 3 m/s leaves the car loose for up to 0.4 s (closing speed / 30)
const SLIP_QUIET = 0.05, SLIP_FULL = 0.5; // Arcade: rear slip angle (rad) where the squeal starts and where v.slip reaches 1
const HB_SQUEAL = 0.3; // Arcade: v.slip of locked rear wheels with no slide (under the drift score's line)
const ARCADE_ROLL = 1.2; // Arcade: body roll at the grip limit, as a multiple of the class table's roll
const USE_K = 0.95; // Arcade: v.slipF at full input (the front just under its peak, as since task DRIVE)
const COUNTER = 0.7; // Arcade: share of a slide the drawn front wheels steer into
const ASK_V1 = 10, ASK_V2 = 20; // m/s: the full-input ask ramps in between
const ROLL_MAX = 0.16; // rad: steady body roll limit (the heaviest roller, Arcade, at its limit)

// Two handling modes, module-wide (every car at once), docs/REVAMP.md 6.3.
// Both modes have the same straight line (power, gears, brakes with ABS,
// traction limits) and the same input. Sim is the single-track tire model
// (the real car's numbers). Arcade (the default, task PLANTED) is a planted
// model: the car goes where the nose points and the nose goes where the
// thumb says; it has no tire state that can let the rear step out.
//
// Arcade rows:
//   planted   the model below (stepVehicle: "Arcade: planted")
//   lat       steady lateral grip as multiples of spec.grip: lat[0] up to
//             latV[0] mph, easing linearly to lat[1] at latV[1] mph and above
//   lockDeg   full-lock wheel angle of every vehicle up to LIGHT_MASS (cars,
//             SUVs, pickups, vans); heavier ones keep their own steerMax
//   lockV     mph: at or below lockV[0] full input is the full lock whatever
//             the grip table says; the bonus fades out by lockV[1]
//   yawTau    s: the yaw rate follows the steering command with this lag
//   plantK    lateral velocity at the rear axle is taken out at up to this
//             multiple of the lateral grip (a hit from the side decays, the
//             car's own cornering never needs more than 1)
//   lockRate / returnRate  the player's steering (controls.steerShape):
//             full locks per second away from / back to the center. AI
//             drivers keep the spec's own rates (their planners are tuned
//             to them).
//   knockTau / knockK  after a crash (v.knock seconds): the yaw lag and the
//             share of plantK kept, so a hit can still push the car a little
//   hbSlide   handbrake: the rear slip angle (rad) full steering asks for;
//             the tail swings out toward it at hbRate (rad/s) from hbV[0]
//             m/s (none) to hbV[1] m/s (all of it)
//   hbCourse  share of the steering's turn the path keeps while sliding
//   hbDrag    extra deceleration at a full slide, as a share of lateral grip
//   hbRec     s: time constant of the recovery after release (the travel
//             lines up with the nose; the nose never swings back), with a
//             floor of hbRecMin rad/s
//
// Sim rows (unchanged since HANDLE and DRIVE):
//   lat       1 (the table's skidpad g)
//   cal       tire friction over that steady grip
//   fall      tire force sag past the peak slip
//   ask       share of lateral grip that full steering input asks for (1.15:
//             past the limit the front pushes wide with tire noise)
//   use       share of the front tire's peak force full input uses
//   yawK / yawFirm  light yaw damper gains (under / over rotating)
//   squeal    tire squeal onset in multiples of the peak slip
const HANDLING = {
  arcade: {
    planted: true, lat: [1.6, 1.25], latV: [35, 75], lockDeg: 40, lockV: [15, 25], yawTau: 0.04, plantK: 2,
    lockRate: 12, returnRate: 12, knockTau: 0.08, knockK: 0.45,
    hbSlide: 0.6, hbRate: 2.2, hbV: [3, 8], hbCourse: 0.85, hbDrag: 0.3, hbRec: 0.12, hbRecMin: 0.5,
  },
  sim: {
    planted: false, lat: [1.0, 1.0], latV: [30, 60], cal: [1.04, 1.04], fall: 0.2, ask: 1.15, use: 1.15, yawK: 1.2, yawFirm: 3, squeal: 0.9,
  },
};
let handlingMode = 'arcade';
let H = HANDLING.arcade;
const FALL = HANDLING.sim.fall; // Sim: tire force falls this much past the peak slip

// Pick the handling for every car: 'arcade' (default) or 'sim'. Anything
// else means 'arcade'.
export function setHandlingMode(mode) {
  handlingMode = mode === 'sim' ? 'sim' : 'arcade';
  H = HANDLING[handlingMode];
  return handlingMode;
}

export function getHandlingMode() {
  return handlingMode;
}

// Handling presets (docs/PLAN_V3.md 2.4 item 5, the Handling lab):
// settings.handlingPreset, 'standard' (default, the target of task PLANTED),
// 'relaxed' (gentler: less of Arcade's grip gain, slower steering, more
// roll) or 'sharp' (quicker steering and more lock, less roll). Module-wide
// like the mode; on top of either mode. The one table and the active name
// live in core/handlingpreset.js (PRESET_VALUES, read here every step
// through presetValues()).
export const HANDLING_PRESETS = PRESETS;
// Pick the preset for every car; anything else means 'standard'.
export function setHandlingPreset(name) {
  return setActivePreset(name);
}
export function getHandlingPreset() {
  return activePreset();
}
// A copy of a preset's row (tests, the lab).
export function presetParams(name) {
  return Object.assign({}, presetValues(validPreset(name)));
}
// Full-lock wheel angle at walking pace in the current mode under the
// preset: the spec's own, at least the preset's floor, and in Arcade at
// least the mode's lock (plus the preset's lockAdd) for every vehicle up to
// LIGHT_MASS.
export const LIGHT_MASS = 3000; // kg
export function steerMaxOf(spec) {
  const pv = presetValues();
  let deg = pv.lockDeg;
  if (H.planted && spec.mass <= LIGHT_MASS && H.lockDeg + pv.lockAdd > deg) deg = H.lockDeg + pv.lockAdd;
  const lockMin = (deg * Math.PI) / 180;
  return spec.steerMax > lockMin ? spec.steerMax : lockMin;
}

// The mode's steady lateral grip as a multiple of spec.grip at speed u
// (m/s): Arcade 1.6 up to 35 mph, easing to 1.25 at 75 mph (the preset
// keeps its gainK share of the gain above 1); Sim 1.
const MPH = 2.23694;
export const SERVICE_GAIN = 5 / 12;
export const LAT_V1 = HANDLING.arcade.latV[0] / MPH, LAT_V2 = HANDLING.arcade.latV[1] / MPH;
function latRamp(u) {
  const au = u < 0 ? -u : u;
  const v1 = H.latV[0] / MPH, v2 = H.latV[1] / MPH;
  return au <= v1 ? 0 : au >= v2 ? 1 : (au - v1) / (v2 - v1);
}
export function gripFactor(u = 0) {
  const f = H.lat[0] + (H.lat[1] - H.lat[0]) * latRamp(u);
  return H.planted ? 1 + (f - 1) * presetValues().gainK : f;
}

// Steady lateral grip (g) of a spec at speed u in the current mode: what a
// skidpad run on full input measures above town speeds (dry, the preset's
// grip included). In Arcade at town speeds a full lock can ask a little
// more (arcadeLatA).
export function lateralGrip(spec, u = 0) {
  let f = gripFactor(u);
  // The four tall service vehicles (docs/REVAMP.md 6.11) keep 5/12 of
  // Arcade's gain (1.25 in town, 1.10 at speed, as before task PLANTED):
  // with more their inner wheels would lift (test SV-H3).
  if (H.planted && spec.service) f = 1 + (f - 1) * SERVICE_GAIN;
  return f * spec.grip * presetValues().gripK;
}

// Arcade: the lateral acceleration (m/s^2) full input gives at speed au
// when the lock does not limit it: the grip curve, and at or below
// lockV[0] whatever the full lock takes (so the car always uses its whole
// lock in town), that bonus fading out by lockV[1].
function arcadeLatA(spec, au, kLock) {
  let a = lateralGrip(spec, au) * G;
  const v1 = H.lockV[0] / MPH, v2 = H.lockV[1] / MPH;
  if (au < v2) {
    const aLock = kLock * v1 * v1;
    if (aLock > a) a += (aLock - a) * (au <= v1 ? 1 : (v2 - au) / (v2 - v1));
  }
  return a;
}
// Arcade: path curvature (1/m) of full input at speed au: the full lock,
// or the turn the lateral grip allows.
function arcadeK(spec, au) {
  const kLock = Math.tan(steerMaxOf(spec)) / spec.wheelBase;
  if (au <= H.lockV[0] / MPH) return kLock;
  const k = arcadeLatA(spec, au, kLock) / (au * au);
  return k < kLock ? k : kLock;
}

// Arcade, the player's turn (task GRIP, owner round 6: "still too loose,
// especially at high speed; a fully rotated wheel barely changed the
// trajectory"). The player's steering (controls.steerShape) is a yaw-rate
// command: full input asks yaw rate = playerLatG * g / speed (path
// curvature = that over the speed), steer s asks s times it (linear), the
// curvature reached with the planted 0.04 s lag; at walking pace it is the
// whole lock. AI drivers keep arcadeK (their planners were tuned on it)
// and so do the four tall service vehicles (their rollover tests).
// TURN_G: knots (mph, g) of a car's full-input lateral acceleration, eased
// between knots (smoothstep) and held flat past the ends.
export const TURN_G = [[20, 2.0], [35, 2.3], [55, 2.6], [110, 2.6], [130, 2.3], [160, 2.0]];
// Tall bodies would roll over long before a low car slides: the turn is
// scaled by the static stability factor (track / (2 * cg height)), 1 from
// TALL_SSF[0] up, TALL_K[0] at TALL_SSF[1], never under TALL_K[1]
// (SUV and pickup about 0.81, the van and box truck 0.65).
export const TALL_SSF = [1.45, 1.3], TALL_K = [0.8, 0.65];
// Grippier cars (the sports cars) turn up to TURN_GRIP_MAX times harder:
// spec.grip over TURN_GRIP_REF, at least 1.
export const TURN_GRIP_REF = 0.82, TURN_GRIP_MAX = 1.1;
function turnTable(mph) {
  const T = TURN_G;
  if (mph <= T[0][0]) return T[0][1];
  for (let i = 1; i < T.length; i++) {
    if (mph <= T[i][0]) {
      const t = (mph - T[i - 1][0]) / (T[i][0] - T[i - 1][0]);
      return T[i - 1][1] + (T[i][1] - T[i - 1][1]) * t * t * (3 - 2 * t);
    }
  }
  return T[T.length - 1][1];
}
export function tallK(spec) {
  const ssf = (spec.width - 0.25) / (2 * spec.height * 0.36);
  if (ssf >= TALL_SSF[0]) return 1;
  const k = 1 - (1 - TALL_K[0]) * (TALL_SSF[0] - ssf) / (TALL_SSF[0] - TALL_SSF[1]);
  return k > TALL_K[1] ? k : TALL_K[1];
}
// The player's full-input lateral acceleration (g) at speed u, dry, in
// Arcade (the preset's turnK and gripK in): at least what the AI's turn
// gives. Sim, and the service vehicles: lateralGrip.
export function playerLatG(spec, u = 0) {
  const au = u < 0 ? -u : u;
  if (!H.planted || spec.service) return lateralGrip(spec, au);
  const kLock = Math.tan(steerMaxOf(spec)) / spec.wheelBase;
  const base = arcadeLatA(spec, au, kLock) / G;
  const pv = presetValues();
  const gk = spec.grip / TURN_GRIP_REF;
  const g = turnTable(au * MPH) * (gk < 1 ? 1 : gk > TURN_GRIP_MAX ? TURN_GRIP_MAX : gk) * tallK(spec) * pv.turnK * pv.gripK;
  return g > base ? g : base;
}
function playerK(spec, au, aLat) {
  const kLock = Math.tan(steerMaxOf(spec)) / spec.wheelBase;
  if (au <= H.lockV[0] / MPH) return kLock;
  const k = aLat / (au * au);
  return k < kLock ? k : kLock;
}
// Path curvature (1/m) the player's full input gives at speed u (what
// fullLockCurvature is for the AI); steer s gives s times it in Arcade.
export function playerLockCurvature(spec, u) {
  if (!H.planted || spec.service) return fullLockCurvature(spec, u);
  const au = u < 0 ? -u : u;
  return playerK(spec, au, playerLatG(spec, au) * G);
}

// Normalized engine torque, peak around 60% of the redline.
function torque(r) {
  const t = (r - 0.6) / 0.45;
  return 1 - 0.3 * t * t;
}

// Saturating tire curve: x = slip / peak slip. Rises linearly, peaks at
// x = 1, then sags toward (1 - FALL) in a full slide.
function tire(x) {
  const ax = x < 0 ? -x : x;
  let y;
  if (ax < 1) y = ax * (2 - ax);
  else y = 1 - FALL * (1 - Math.exp(-(ax - 1) * 1.4));
  return x < 0 ? -y : y;
}

// Brake pedal to share of the full brake: a gentle S that is exact at 0,
// half and full (half pedal is half the stop, test B1) and a little
// firmer in the first half of the travel, where drivers and the AI trim
// their speed. Strictly rising. Every brake input (player and AI) goes
// through it; it replaces the traffic brake gain scale (docs/REVAMP.md 6.3,
// pinned by BRAKE_PEDAL_S in handlingbands.js).
export function brakePedal(p) {
  const x = p < 0 ? 0 : p > 1 ? 1 : p;
  return x + PEDAL_S * x * (1 - x) * (1 - 2 * x);
}

// The tire curve of the current mode (tests and tools).
export function tireCurve(x) {
  return tire(x);
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
    // Longitudinal tire friction (brakes, traction): the class's own, or
    // a little above the lateral grip.
    muLong: s.gripLong > 0 ? s.gripLong : s.grip * LONG_K,
    // Body roll (rad) per m/s^2 of lateral acceleration: rollDeg at the
    // car's real grip (Sim's limit), else 4.2 degrees per g.
    rollPerA: s.rollDeg > 0 && s.grip > 0 ? (s.rollDeg * Math.PI / 180) / (s.grip * G) : 0.0075,
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
// real wheel angle adds the tires' slip angles (steerAngle).
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
// The share of the front tire's peak full input uses at speed au: the
// mode's `use` where it is under 1 (Arcade, at every speed); where it is
// over 1 (Sim) it ramps in with the ask.
function useAt(au) {
  if (H.use <= 1) return H.use;
  return askAt(au) * H.use / H.ask;
}

// The geometric wheel angle of the whole grip-limited turn at speed au
// asking `ask` of the lateral grip: the angle whose kinematic curvature
// tan(angle) / L is that turn (task DRIVE: the atan keeps a town-speed
// turn from asking a few percent more than the grip).
function geoAngle(d, spec, au, ask) {
  return Math.atan(d.L * ask * lateralGrip(spec, au) * G / Math.max(au * au, 1));
}

// Wheel angle for a share q of the grip-limited turn at this speed: the
// geometric angle q * geo (geo: the whole grip-limited turn, asking `ask`
// of the grip) plus the slip angles the tires need for that share of grip
// on the curve tireCurve (front at q * use of its peak, rear at the share
// its extra REAR_K grip leaves).
function gripAngle(d, geo, use, q) {
  const yF = q * use;
  const xF = yF < 1 ? 1 - Math.sqrt(1 - yF) : yF;
  const yR = Math.min(1, q * Math.min(1, use) / REAR_K);
  const xR = 1 - Math.sqrt(1 - yR);
  return q * geo + d.apF * xF - d.apR * xR;
}
// The share of the grip-limited turn that full lock reaches: 1 when the
// grip, not the lock, is the limit.
function lockShare(d, geo, use, smax) {
  if (gripAngle(d, geo, use, 1) <= smax) return 1;
  let lo = 0, hi = 1;
  for (let i = 0; i < 14; i++) {
    const m = (lo + hi) / 2;
    if (gripAngle(d, geo, use, m) > smax) hi = m;
    else lo = m;
  }
  return lo;
}
// Speed band over which a lock-limited turn goes from the plain share of
// the lock (walking pace, kinematic) to the share of the turn that lock
// reaches (the tires' slip angles counted, so the curvature stays linear in
// the input: accuracy test A1 for the long trucks in Arcade's town grip).
const LOCK_V1 = KIN_V, LOCK_V2 = KIN_V + 4;
function lockBlend(au) {
  return au <= LOCK_V1 ? 0 : au >= LOCK_V2 ? 1 : (au - LOCK_V1) / (LOCK_V2 - LOCK_V1);
}

// Front wheel angle for a steer share s (-1..1) at speed u. At walking
// pace s * steerMax. Above that the angle is built so the steady path
// curvature is the share s of the full-lock curvature (accuracy test A1):
// gripAngle of the share s of the turn full input gives (all of the
// grip-limited turn, or the part of it the lock reaches).
export function steerAngle(spec, u, s) {
  // Arcade: the geometric angle (a planted car has no slip angles to add).
  if (H.planted) return steerGeo(spec, u, s < -1 ? -1 : s > 1 ? 1 : s);
  const d = derive(spec);
  const au = u < 0 ? -u : u;
  const as = s < 0 ? -s : s > 1 ? 1 : s;
  const ask = askAt(au), use = useAt(au);
  const geo = geoAngle(d, spec, au, ask);
  const smax = steerMaxOf(spec);
  const q = lockShare(d, geo, use, smax);
  let ang;
  if (q === 1) ang = gripAngle(d, geo, use, as);
  else {
    const w = lockBlend(au);
    ang = w * gripAngle(d, geo, use, as * q) + (1 - w) * as * smax;
  }
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
  if (H.planted) return s * Math.atan(d.L * arcadeK(spec, au));
  const ask = askAt(au);
  const geo = geoAngle(d, spec, au, ask);
  const smax = steerMaxOf(spec);
  const q = lockShare(d, geo, useAt(au), smax);
  if (q === 1) return s * geo;
  const w = lockBlend(au);
  return s * (w * q * geo + (1 - w) * smax);
}

// Player input shaping by speed (task DRIVE, docs/REVAMP.md 6.3): the
// player's steer x (-1..1) becomes sign(x) * |x|^e, the exponent rising
// smoothly from 1 at SHAPE_V1 (15 mph) to SHAPE_EXP (1.2; task PLANTED,
// was 1.8, which felt vague near the center) at SHAPE_V2 (70 mph), times
// the preset's shapeK on the rise. Small thumb moves give small lane
// corrections on the highway, full input is still full lock, and the
// response stays monotonic (no dead zone). Only controls flagged
// `steerShape` (the player's input, src/core/input.js) are shaped; the AI
// planners send a share of the lock and get it unchanged.
export const SHAPE_V1 = 15 / 2.23694, SHAPE_V2 = 70 / 2.23694, SHAPE_EXP = 1.2;
// Task GRIP (deliberate): in Arcade the exponent is the preset's arcShape
// at 70 mph (Standard 1.4: the 2.6 g full turn with fine highway
// corrections; Sharp 1, linear; Relaxed 1.6, the gentler curve); Sim keeps
// SHAPE_EXP times shapeK.
export function steerShapeExp(u) {
  const au = u < 0 ? -u : u;
  const t = au <= SHAPE_V1 ? 0 : au >= SHAPE_V2 ? 1 : (au - SHAPE_V1) / (SHAPE_V2 - SHAPE_V1);
  const pv = presetValues();
  const rise = H.planted ? pv.arcShape - 1 : (SHAPE_EXP - 1) * pv.shapeK;
  return rise === 0 ? 1 : 1 + rise * t * t * (3 - 2 * t);
}
export function shapeSteerBySpeed(x, u) {
  const e = steerShapeExp(u);
  if (e === 1 || x === 0) return x;
  const ax = x < 0 ? -x : x;
  const y = Math.pow(ax > 1 ? 1 : ax, e);
  return x < 0 ? -y : y;
}

// Move the steering value toward its target: away from the center at
// `lockRate` full locks per second, toward it at `returnRate`, and through
// the center at the return rate first when the target is on the other side.
export function steerToward(cur, target, lockRate, returnRate, dt) {
  if (cur === target || !(dt > 0)) return cur;
  const away = cur === 0 ? true : cur > 0 ? target > cur : target < cur;
  if (away) return approach(cur, target, lockRate * dt);
  // Toward the center: stop at the target if it is on the same side.
  const stop = target * cur > 0 ? target : 0;
  const need = cur > stop ? cur - stop : stop - cur;
  const step = returnRate * dt;
  if (step <= need) return cur > stop ? cur - step : cur + step;
  if (stop === target) return target;
  // Crossed the center: spend the rest of the step at the lock rate.
  return approach(0, target, lockRate * (step - need) / returnRate);
}

const MAX_SUBSTEP_MOVE = 0.3; // meters per collision sub-step

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
    if (controls.steerShape) steerIn = shapeSteerBySpeed(steerIn, v.vx * Math.cos(v.heading) + v.vz * Math.sin(v.heading));
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
  let ch = Math.cos(v.heading), sh = Math.sin(v.heading);
  const vf0 = v.vx * ch + v.vz * sh;
  const planted = H.planted;
  const m = s.mass, mg = m * G, mu = d.muLong * wet, muLat = lateralGrip(s, vf0) * (planted ? 1 : H.cal[0]) * wet, fLat = wetUnderSteer(rain);
  const avf0 = Math.abs(vf0);
  if (v.slide === undefined) { v.slide = 0; v.slideV = 0; v.knock = 0; }
  if (!(v.curv === v.curv)) v.curv = 0; // also undefined
  if (v.knock > 0) v.knock = Math.max(0, v.knock - dt);
  if (hitBefore > KNOCK_MIN) v.knock = Math.max(v.knock, Math.min(KNOCK_S, hitBefore / KNOCK_PER));

  // ---- Steering: one rate limit, steer is a share of the lock. The car's
  // lockRate / returnRate; in Arcade the player's own quicker rates (the
  // thumb, not the car, sets the pace; AI planners keep the spec's).
  const pv = presetValues();
  const quick = planted && controls && controls.steerShape;
  v.steer = steerToward(v.steer, steerIn, (quick ? H.lockRate : d.lockRate) * pv.lockK, (quick ? H.returnRate : d.returnRate) * pv.returnK, dt);
  // Arcade, the player (task GRIP): a yaw-rate command, linear in steer.
  const turn = quick && !s.service;
  const aTurn = turn ? playerLatG(s, vf0) * G : 0;
  const kTurn = turn ? playerK(s, Math.abs(vf0), aTurn) : 0;
  const deltaGeo = turn ? Math.atan(d.L * v.steer * kTurn) : steerGeo(s, vf0, v.steer);
  const delta = turn ? deltaGeo : steerAngle(s, vf0, v.steer);
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
    // Badly dented (under 30 percent): 15 percent less power (2.3 item 2).
    if (v.health < s.health * 0.3) driveF *= 0.85;
    // Wading: the water takes most of the drive away (followGround stops
    // the car going deeper than BOG_DEPTH; it can still back out).
    if (v.wade > 0) driveF *= 1 - 0.7 * v.wade;
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

  // ---- Tire dynamics in sub-steps.
  const h = dt / NSUB;
  const a = d.a, b = d.b, L = d.L;
  let spinMax = 0, absOn = false, slideF = 0, slideR = 0, hbSlide = 0;
  let sumAx = 0, sumAy = 0;
  // Arcade: the turn the steering asks (curvature), the lateral
  // acceleration the road gives now, how hard the rear axle is held in
  // line, and the yaw lag (a crash loosens both for v.knock seconds).
  const kGeo = Math.tan(deltaGeo) / L, sinGeo = Math.abs(Math.sin(deltaGeo));
  const aCap = planted ? (turn ? aTurn : arcadeLatA(s, avf0, Math.tan(steerMaxOf(s)) / L)) * wet * fLat : 0;
  const plantA = planted ? Math.max(muLat * G, turn ? aTurn * wet : 0) * H.plantK * (v.knock > 0 ? H.knockK : 1) : 0;
  const kYaw = planted ? 1 - Math.exp(-h / (v.knock > 0 ? H.knockTau : H.yawTau)) : 0;
  for (let k = 0; k < NSUB; k++) {
    ch = Math.cos(v.heading);
    sh = Math.sin(v.heading);
    const vf = v.vx * ch + v.vz * sh;
    const vl = -v.vx * sh + v.vz * ch;
    let r = v.yawRate;
    const avf = vf < 0 ? -vf : vf;
    // Loads with longitudinal weight transfer (from last sub-step's accel):
    // brakes and traction see it in both modes.
    const dFz = m * v.accelX * d.h / L;
    const fzF = clamp(mg * d.cgF - dFz, 0.2 * mg, 0.85 * mg);
    const fzR = mg - fzF;
    const capF = mu * fzF, capR = mu * fzR; // longitudinal limits

    // Longitudinal forces per axle (along each wheel), friction limited.
    // The brake force is shared by axle load (brake force distribution),
    // so ABS holds both axles near their limit together. The same in both
    // modes: Arcade and Sim share the straight line.
    const sgn = vf > 0 ? 1 : vf < 0 ? -1 : 0;
    const fade = Math.min(1, avf / BRAKE_FADE_V);
    const resist = brakeF * fade;
    const shareF = fzF / mg;
    const dF = driveF * d.frontDrive, dR = handbrake ? 0 : driveF - dF;
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
    const spd = Math.hypot(vf, vl);
    const drag = d.kd * spd;

    if (planted) {
      // ---- Arcade: planted. The nose follows the steering (yaw rate =
      // speed times the curvature asked, within what the road gives, with a
      // short lag) and the travel follows the nose (the rear axle's
      // sideways velocity is taken out). Power and brakes act along the
      // car only: nothing here can rotate it or let the tail step out. The
      // one slide is the handbrake's, asked for by the player (v.slide).
      const r0 = r;
      const aLat = vf * r;
      let fx = fxF * cd + fxR - drag * vf - roll; // the front axle pushes and brakes along its wheels
      if (handbrake) fx -= sgn * HB_K * muLat * fzR * Math.min(1, avf / 0.5); // locked rear wheels
      // Cornering scrub, and the drag of a slide (tires going sideways).
      fx -= sgn * m * (SCRUB * (aLat < 0 ? -aLat : aLat) * sinGeo + H.hbDrag * muLat * G * Math.abs(Math.sin(v.slide)));
      const ax = fx / m;
      sumAx += ax;
      sumAy += aLat;
      v.accelX += (ax - v.accelX) * Math.min(1, 25 * h);
      const nf = vf + ax * h;
      const anf = nf < 0 ? -nf : nf;
      const rLim = aCap / (anf > 1 ? anf : 1);
      let rRef = clamp(nf * kGeo, -rLim, rLim);
      // The handbrake slide: the tail swings out toward the steering's
      // side (the nose turns in by the slide's rate); with the handbrake
      // off it comes back by the travel lining up with the nose.
      let slideV = 0;
      if (handbrake || v.slide !== 0) {
        const as = v.slide < 0 ? -v.slide : v.slide;
        let next;
        if (handbrake) {
          const hk = v.wrecked ? 0 : clamp((nf - H.hbV[0]) / (H.hbV[1] - H.hbV[0]), 0, 1);
          next = approach(v.slide, v.steer * H.hbSlide * hk, H.hbRate * h);
          rRef *= H.hbCourse;
        } else next = approach(v.slide, 0, Math.max(as / H.hbRec, H.hbRecMin) * h);
        if ((next < 0 ? -next : next) > as) slideV = (next - v.slide) / h;
        v.slide = next;
      }
      // The curvature follows the steering with the yaw lag; the yaw rate
      // is the speed times it at once (wheels roll: pulling away on lock
      // turns the car from the first meter). Yaw from outside (a crash)
      // is what the car turns beyond that; it decays with the same lag.
      const kick = (r - (vf * v.curv + v.slideV)) * (1 - kYaw);
      v.curv += ((anf > 0.3 ? rRef / nf : kGeo) - v.curv) * kYaw;
      r = clamp(nf * v.curv + slideV + kick, -4, 4);
      v.slideV = slideV;
      v.yawRate = r;
      v.heading = angleDiff(v.heading + r * h, 0);
      ch = Math.cos(v.heading);
      sh = Math.sin(v.heading);
      // The old velocity seen from the turned nose: the rear axle's
      // sideways part of it is what the tires take out.
      const want = nf > 0 ? -Math.tan(v.slide) * nf : 0;
      const w = approach(-v.vx * sh + v.vz * ch - b * r0, want, plantA * h);
      const nl = w + b * r;
      v.vx = nf * ch - nl * sh;
      v.vz = nf * sh + nl * ch;
      const use = rLim > 0 ? (r < 0 ? -r : r) / rLim : 0;
      if (use > slideF) slideF = use;
      if (handbrake && avf > hbSlide) hbSlide = avf;
      continue;
    }

    // ---- Sim: the single-track tire model.
    // The lateral balance sees all of the weight transfer.
    const capLF = muLat * fLat * fzF, capLR = muLat * REAR_K * fzR; // lateral limits
    // A light yaw damper toward the steering's intent, firmer when over-rotating.
    let assistMz = 0;
    if (!handbrake && avf > 4 && !v.wrecked) {
      let yawRef = vf * Math.tan(deltaGeo) / L;
      const yLim = muLat * G / Math.max(avf, 1);
      yawRef = clamp(yawRef, -yLim, yLim);
      const eY = r - yawRef;
      const firm = eY * r > 0 && Math.abs(r) > Math.abs(yawRef) ? H.yawFirm : H.yawK;
      assistMz -= d.iz * firm * eY;
    }

    // Front axle: slip angle between wheel heading and contact velocity.
    const vlf = vl + a * r;
    const vpar = vf * cd + vlf * sd;
    const vperp = -vf * sd + vlf * cd;
    const alphaF = Math.atan(vperp / Math.max(Math.abs(vpar), V0));
    const uF = fxF / capF;
    const latF = capLF * Math.sqrt(Math.max(0.05, 1 - COMB * uF * uF));
    const xF = alphaF / d.apF;
    const fyF = -latF * tire(xF);
    const ffx = fxF * cd - fyF * sd;
    const ffy = fxF * sd + fyF * cd;
    slideF = Math.max(slideF, Math.abs(xF));

    // Rear axle: normal tire, or locked by the handbrake (sliding friction).
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
      fry = -latR * tire(xR);
      frx = fxR;
      slideR = Math.max(slideR, Math.abs(xR));
    }

    // Aero drag along the velocity.
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
  // Arcade corners at up to 1.6 times the real car's grip: the body rolls
  // ARCADE_ROLL times the real car's roll at its own limit, not 1.6 times.
  // The player's harder turn (task GRIP) rolls ARCADE_ROLL times the table's roll at its own full input.
  const rollK = !planted ? 1 : turn ? ARCADE_ROLL * s.grip * G / Math.max(aTurn, s.grip * G) : ARCADE_ROLL / (H.lat[0] + (H.lat[1] - H.lat[0]) * latRamp(vf));
  const rollEq = clamp(-ayAvg * d.rollPerA * pv.rollK * rollK, -ROLL_MAX, ROLL_MAX);
  const w = 9, z2 = 2 * 0.5 * w;
  v.pitchV += (w * w * (pitchEq - v.pitch) - z2 * v.pitchV) * dt;
  v.pitch += v.pitchV * dt;
  v.rollV += (w * w * (rollEq - v.roll) - z2 * v.rollV) * dt;
  v.roll += v.rollV * dt;
  v.pitch = clamp(v.pitch, -0.2, 0.2);
  v.roll = clamp(v.roll, -0.25, 0.25);
  v.suspension *= Math.exp(-3 * dt);
  if (v.suspension < 1e-4) v.suspension = 0;

  v.wheelSpin = (v.wheelSpin + (vf + Math.sign(driveF) * v.spin * 8) * dt / s.wheelRadius) % (Math.PI * 2);
  if (planted) {
    // Arcade: squeal, smoke and the drift score follow the real slide (the
    // rear axle's slip angle): silent under 3 degrees, full at 29. Locked
    // rear wheels squeal on their own; wheelspin and ABS as in Sim. The
    // drawn front wheels steer into a slide (automatic countersteer).
    const sl = Math.atan2(vl - b * v.yawRate, Math.max(Math.abs(vf), V0));
    const asl = sl < 0 ? -sl : sl;
    const slideAmt = clamp((asl - SLIP_QUIET) / (SLIP_FULL - SLIP_QUIET), 0, 1);
    const hbAmt = handbrake && hbSlide > 3 ? HB_SQUEAL : 0;
    v.slip = Math.max(slideAmt, hbAmt, v.spin * 0.8, absOn ? 0.3 : 0);
    v.slipF = slideF * USE_K; // the grip in use: full input reports the front at 0.95 of its peak
    v.push = 0;
    if (asl > SLIP_QUIET && vf > V0) v.steerAngle = clamp(deltaGeo + COUNTER * sl, -steerMaxOf(s), steerMaxOf(s));
  } else {
    // Sim: squeal starts past the tire peak. A front pushing wide past its
    // limit is heard at once.
    const slideAmt = Math.max(clamp((slideR - H.squeal) / 1.2, 0, 1), clamp((slideF - H.squeal) / 0.5, 0, 1));
    const hbAmt = handbrake && Math.abs(vf) > 3 ? clamp(0.4 + hbSlide / 25, 0, 1) : 0;
    v.slip = Math.max(slideAmt, hbAmt, v.spin * 0.8, absOn ? 0.3 : 0);
    v.slipF = slideF;
    v.push = clamp(slideF - 1, 0, 1);
  }

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

  // Wheels on the ground (not while a stunt ramp or a flight owns y).
  v.jolt = 0;
  if (v.joltCool > 0) v.joltCool = Math.max(0, v.joltCool - dt);
  if (city && !(v.air && v.air.on) && !v.stuntRamp && !v.tossing && !(v.wreckFade > 0)) followGround(v, groundFn(city), dt);

  if (maxClose > 0) {
    v.impact = maxClose;
    damageVehicle(v, impactDamage(maxClose), 'crash', null);
    bump(v, maxClose);
  }
  v.speed = v.vx * Math.cos(v.heading) + v.vz * Math.sin(v.heading);

  // Safety net: never let a NaN escape.
  if (!Number.isFinite(v.x + v.z + v.heading + v.vx + v.vz + v.yawRate)) {
    v.x = v.px; v.z = v.pz; v.heading = v.pheading;
    v.vx = 0; v.vz = 0; v.yawRate = 0; v.speed = 0;
  }
  if (!Number.isFinite(v.pitch + v.roll + v.pitchV + v.rollV + v.rpm + v.accelX + v.steer + v.brakeP + v.slide + v.slideV + v.curv)) {
    v.pitch = 0; v.roll = 0; v.pitchV = 0; v.rollV = 0; v.rpm = IDLE; v.accelX = 0; v.steer = 0; v.brakeP = 0; v.slide = 0; v.slideV = 0; v.curv = 0;
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
// largest normal closing speed of this sub-step (0 if none). A breakable
// prop met faster than its breakSpeed shears off (collision.breakShape):
// the car loses its `slow` share of speed and goes on through.
function collideStatic(v, col) {
  const s = v.spec;
  const r = s.width / 2;
  const inertiaK = 12 / (s.length * s.length + s.width * s.width);
  const y = Number.isFinite(v.y) ? v.y : 0;
  let maxClose = 0;
  const ch = Math.cos(v.heading), sh = Math.sin(v.heading);
  for (let i = 0; i < 3; i++) {
    const off = circleOffset(s, i);
    const ox = ch * off, oz = sh * off;
    const cx = v.x + ox, cz = v.z + oz;
    let res = col.resolveCircle(cx, cz, r, y);
    for (let tries = 0; tries < 3 && res.brk && col.breakShape; tries++) {
      const b = res.brk;
      const pvx = v.vx - v.yawRate * oz, pvz = v.vz + v.yawRate * ox;
      // The car's speed into the prop (a glancing hit on a long bench
      // shears it as well as a square one).
      const into = -(pvx * res.bnx + pvz * res.bnz);
      const close = into > 0 ? Math.sqrt(pvx * pvx + pvz * pvz) : 0;
      if (!(close > b.brk.breakSpeed)) break;
      col.breakShape(b, v.vx, v.vz, v);
      const keep = 1 - (b.brk.slow || 0);
      v.vx *= keep;
      v.vz *= keep;
      v.propHits = (v.propHits || 0) + 1;
      if (damageRule) damageVehicle(v, PROP_BREAK_DAMAGE, 'prop', b);
      res = col.resolveCircle(cx, cz, r, y);
    }
    if (!res.hit) continue;
    const c = contact(v, res.x - cx, res.z - cz, ox, oz, inertiaK);
    if (c > maxClose) maxClose = c;
  }
  // The box corners stick out of the three circles by up to 0.2 of the
  // width: by a sea wall or a rail they are probed too (against the walls
  // and rails alone), so no corner reaches over the water (docs/PLAN_V3.md
  // section 6 item 6).
  const edges = col.layerNamed ? col.layerNamed('edges') : null;
  if (edges && edgeWallsNear(edges, v.x, v.z, s.length / 2 + 0.5)) {
    const hl = s.length / 2 - CORNER_R, hw = s.width / 2 - CORNER_R;
    for (let k = 0; k < 4; k++) {
      const lo = k < 2 ? hl : -hl, la = k === 0 || k === 3 ? hw : -hw;
      const ox = ch * lo - sh * la, oz = sh * lo + ch * la;
      // Twice: in the corner where a rail meets a sea wall one push can
      // land the point on the other line.
      for (let pass = 0; pass < 2; pass++) {
        const cx = v.x + ox, cz = v.z + oz;
        // The edge layer only: a corner tip inside a thin lot wall or a post
        // left it by the far face and pulled the car through (0.33 m into a
        // 0.5 m wall; scripts/collision-sweep.mjs).
        const res = col.resolveLayer ? col.resolveLayer('edges', cx, cz, CORNER_R, y) : col.resolveCircle(cx, cz, CORNER_R, y);
        if (!res.hit) break;
        const c = contact(v, res.x - cx, res.z - cz, ox, oz, inertiaK);
        if (c > maxClose) maxClose = c;
      }
    }
  }
  return maxClose;
}
const CORNER_R = 0.08;
// True when a sea wall or rail is listed in any edge cell the box within
// reach of (x, z) touches. (Was the center's cell only: a long truck with
// its center one cell back put its front corners 0.6 m past a bridge
// rail; scripts/collision-sweep.mjs, test/collision-sweep.test.js.)
function edgeWallsNear(edges, x, z, reach) {
  const cx0 = Math.floor((x - reach) / 32), cx1 = Math.floor((x + reach) / 32);
  const cz0 = Math.floor((z - reach) / 32), cz1 = Math.floor((z + reach) / 32);
  for (let cx = cx0; cx <= cx1; cx++) for (let cz = cz0; cz <= cz1; cz++) if (edges.cell(cx, cz).length) return true;
  return false;
}

// One contact: move the car by the push (dx, dz) found for its body point
// at offset (ox, oz) and bounce that point's velocity. Returns the closing
// speed (0 if it was moving away).
function contact(v, dx, dz, ox, oz, inertiaK) {
  const d = Math.hypot(dx, dz);
  if (d < 1e-9) return 0;
  v.x += dx;
  v.z += dz;
  const nx = dx / d, nz = dz / d;
  // Velocity of the contact point (linear + rotation).
  const pvx = v.vx - v.yawRate * oz;
  const pvz = v.vz + v.yawRate * ox;
  const vn = pvx * nx + pvz * nz;
  if (vn >= 0) return 0;
  const close = -vn;
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
  // Off-center hits spin the car.
  v.yawRate += (ox * dvz - oz * dvx) * inertiaK * 0.5;
  v.yawRate = clamp(v.yawRate, -4, 4);
  return close;
}

// The last net at the water's edge. With sea walls and rails (city.edgeLines,
// world/edgelines.js) it acts only 3 m out past the shore line (a beach or
// a gap let the car that far) and never on a pier; without them it keeps
// the car's center 2 m inside the shore, as before the walls.
export const LAND_NET = 3;
function keepOnLand(v, city) {
  const d = city.shoreDist(v.x, v.z);
  const walled = !!city.edgeLines;
  const lim = walled ? -LAND_NET : 2;
  if (!(d < lim)) return;
  if (walled && city.isGround && city.isGround(v.x, v.z)) return;
  // Inward direction is the gradient of shore distance.
  const e = 1;
  let gx = city.shoreDist(v.x + e, v.z) - city.shoreDist(v.x - e, v.z);
  let gz = city.shoreDist(v.x, v.z + e) - city.shoreDist(v.x, v.z - e);
  const gl = Math.hypot(gx, gz);
  if (!(gl > 1e-9)) return;
  gx /= gl;
  gz /= gl;
  const push = Math.min(lim - d, 4) * 0.5;
  v.x += gx * push;
  v.z += gz * push;
  const vin = v.vx * gx + v.vz * gz;
  if (vin < 0) {
    v.vx -= vin * gx;
    v.vz -= vin * gz;
  }
}

// ---- Ground following ----
// Wheel points: half the wheelbase ahead and behind the center, the track
// 0.15 m inside the body sides. A wheel's ground stepping up more than
// JOLT_H in a step is a curb: a jolt in the springs, and above JOLT_V a
// share JOLT_LOSS of the speed per axle (5 percent across a curb).
export const JOLT_H = 0.08, JOLT_V = 10 / 2.23694, JOLT_LOSS = 0.025;
export const CLEARANCE = 0.14; // m: the body never sits lower than this under the center's ground
export const BOG_DEPTH = 0.5; // m of water that stops a car (a beach)
const WX = new Float64Array(4), WZ = new Float64Array(4), WY = new Float64Array(4);
function followGround(v, g, dt) {
  if (!g) return;
  const s = v.spec;
  const c = Math.cos(v.heading), sn = Math.sin(v.heading);
  const hb = (s.wheelBase || s.length * 0.6) / 2, ht = Math.max(0.3, s.width / 2 - 0.15);
  if (!v.wg) { v.wg = new Float32Array(4); v.wheelDy = new Float32Array(4); }
  let up = 0, down = 0;
  for (let i = 0; i < 4; i++) {
    const lo = i < 2 ? hb : -hb, la = i % 2 === 0 ? ht : -ht; // along, across (right +)
    const x = v.x + c * lo - sn * la, z = v.z + sn * lo + c * la;
    WX[i] = x; WZ[i] = z;
    const y = g(x, z);
    WY[i] = y;
    if (v.grounded) {
      const dy = y - v.wg[i];
      if (dy > up) up = dy;
      if (-dy > down) down = -dy;
    }
    v.wg[i] = y;
  }
  const fA = (WY[0] + WY[1]) / 2, rA = (WY[2] + WY[3]) / 2;
  const rS = (WY[0] + WY[2]) / 2, lS = (WY[1] + WY[3]) / 2;
  const yc = (fA + rA) / 2;
  v.pgPitch = v.gPitch;
  v.pgRoll = v.gRoll;
  v.gPitch = Math.atan2(fA - rA, 2 * hb);
  v.gRoll = Math.atan2(lS - rS, 2 * ht);
  for (let i = 0; i < 4; i++) {
    const plane = yc + (i < 2 ? 0.5 : -0.5) * (fA - rA) + (i % 2 === 0 ? -0.5 : 0.5) * (lS - rS);
    v.wheelDy[i] = WY[i] - plane;
  }
  const gc = g(v.x, v.z);
  v.y = yc > gc - CLEARANCE ? yc : gc - CLEARANCE;
  v.vy = 0;
  if (!v.grounded) {
    v.grounded = true;
    v.pgPitch = v.gPitch;
    v.pgRoll = v.gRoll;
  }
  // Curbs.
  const j = up > down ? up : down;
  if (j > JOLT_H) {
    v.jolt = j;
    v.jolts = (v.jolts || 0) + 1;
    const k = Math.min(1, j / 0.3);
    if (k > v.suspension) v.suspension = k;
    v.pitchV += (up > down ? -1 : 1) * k * 0.6;
    if (up > JOLT_H && !(v.joltCool > 0)) {
      const sp = Math.hypot(v.vx, v.vz);
      if (sp > JOLT_V) {
        v.vx *= 1 - JOLT_LOSS;
        v.vz *= 1 - JOLT_LOSS;
      }
      v.joltCool = 0.12;
    }
  }
  // Wading: drive fades and the car slows to a stop at BOG_DEPTH; it can
  // still back out (motion toward shallower water is kept).
  const depth = SEA_LEVEL - gc;
  v.wade = depth > 0 ? Math.min(1, depth / BOG_DEPTH) : 0;
  if (v.wade > 0) {
    const drag = Math.exp(-v.wade * v.wade * 4 * dt);
    v.vx *= drag;
    v.vz *= drag;
    if (v.wade >= 1) {
      // Seaward is downhill on the sea floor.
      let sx = g(v.x - 1, v.z) - g(v.x + 1, v.z), sz = g(v.x, v.z - 1) - g(v.x, v.z + 1);
      const sl = Math.hypot(sx, sz);
      if (sl > 1e-6) {
        sx /= sl; sz /= sl;
        const out = v.vx * sx + v.vz * sz;
        if (out > 0) { v.vx -= out * sx; v.vz -= out * sz; }
      }
    }
  }
}

// The world height of wheel i's bottom (0 front-right, 1 front-left,
// 2 rear-right, 3 rear-left): the body plane plus the wheel's own travel.
export function wheelBottomY(v, i) {
  const s = v.spec;
  const hb = (s.wheelBase || s.length * 0.6) / 2, ht = Math.max(0.3, s.width / 2 - 0.15);
  const lo = i < 2 ? hb : -hb, la = i % 2 === 0 ? ht : -ht;
  const y = Number.isFinite(v.y) ? v.y : 0;
  const dy = v.wheelDy ? v.wheelDy[i] : 0;
  return y + Math.tan(v.gPitch || 0) * lo - Math.tan(v.gRoll || 0) * la + dy;
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
    // Off-center spin, scaled down for arcade feel.
    const ia = sa.mass * (sa.length * sa.length + sa.width * sa.width) / 12;
    const ib = sb.mass * (sb.length * sb.length + sb.width * sb.width) / 12;
    a.yawRate = clamp(a.yawRate - (boax * jz - boaz * jx) / ia * 0.5, -4, 4);
    b.yawRate = clamp(b.yawRate + (bobx * jz - bobz * jx) / ib * 0.5, -4, 4);
    const close = -rvn;
    if (close > a.impact) a.impact = close;
    if (close > b.impact) b.impact = close;
    // By the closing speed of the two; the lighter car takes a little
    // more, within MASS_SHARE (was up to 1.7 times an even share).
    const dmg = impactDamage(close);
    const ka = clamp(2 * sb.mass / (sa.mass + sb.mass), MASS_SHARE[0], MASS_SHARE[1]);
    const kb = clamp(2 * sa.mass / (sa.mass + sb.mass), MASS_SHARE[0], MASS_SHARE[1]);
    damageVehicle(a, dmg * ka, 'crash', b);
    damageVehicle(b, dmg * kb, 'crash', a);
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
