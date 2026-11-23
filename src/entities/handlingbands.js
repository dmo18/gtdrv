// Handling bands (docs/REVAMP.md section 6.3): plain constants, imported
// by test/handling-bands.test.js and by nothing at runtime.
// Units: m/s, m, s, g = 9.81 m/s2. "mph" is m/s times 2.23694. All
// measurements use `stepVehicle` at 1/60 s on dry ground with no wind,
// starting from rest or from a settled speed.

import { SERVICE_BANDS } from './servicevehicles.js'; // V1: the four service vehicles (6.11)

export const MODES = ['arcade', 'sim']; // settings.handling, default 'arcade'

// The reference table (docs/PLAN_V3.md 2.4 item 1, task HANDLE): one row per
// fleet class, approximate published figures for a US vehicle of that
// class, re-checked for this task. The model's specs (CLASS_HANDLING in
// vehicle.js) are tuned to it; these are the targets the tests hold it to.
//   wb      wheelbase, m
//   circle  curb-to-curb turning circle, ft (the outer front tire's path)
//   grip    skidpad lateral g (Sim holds it; Arcade multiplies it, below)
//   t60     0 to 60 mph, s
//   stop    60 to 0 mph, ft (dry, full brake with ABS)
//   roll    body roll at the limit, degrees (Sim)
// Reference classes: compact sedan; midsize sedan; full-size sedan (the
// taxi is the same car); police pursuit sedan; compact crossover SUV;
// full-size SUV; full-size crew cab pickup; regular cab short bed work
// pickup (base V6; table row added by HANDLE); muscle coupe; sports car;
// convertible cruiser; minivan; full-size cargo van; 16 ft box truck;
// semi tractor (no trailer); 40 ft school bus; 40 ft city bus.
export const REFERENCE = {
  compact: { wb: 2.70, circle: 36, grip: 0.83, t60: 8.5, stop: 125, roll: 4.5 },
  midsize: { wb: 2.83, circle: 38, grip: 0.84, t60: 7.5, stop: 125, roll: 4.5 },
  sedan: { wb: 2.95, circle: 40, grip: 0.82, t60: 7.5, stop: 130, roll: 5 },
  taxi: { wb: 2.95, circle: 40, grip: 0.82, t60: 7.5, stop: 130, roll: 5 },
  police: { wb: 2.95, circle: 40, grip: 0.88, t60: 6.0, stop: 125, roll: 4 },
  crossover: { wb: 2.75, circle: 37, grip: 0.80, t60: 8.0, stop: 130, roll: 5.5 },
  suv: { wb: 3.07, circle: 40, grip: 0.76, t60: 7.0, stop: 135, roll: 6 },
  crewcab: { wb: 3.68, circle: 47, grip: 0.74, t60: 7.0, stop: 135, roll: 6 },
  pickup: { wb: 3.12, circle: 41, grip: 0.74, t60: 7.5, stop: 140, roll: 6 },
  muscle: { wb: 2.72, circle: 38, grip: 0.95, t60: 4.8, stop: 110, roll: 3.5 },
  sports: { wb: 2.72, circle: 38, grip: 1.03, t60: 3.6, stop: 100, roll: 2.5 },
  convertible: { wb: 2.85, circle: 39, grip: 0.85, t60: 7.0, stop: 125, roll: 4.5 },
  minivan: { wb: 3.03, circle: 39, grip: 0.78, t60: 8.0, stop: 130, roll: 5.5 },
  van: { wb: 3.30, circle: 42, grip: 0.72, t60: 9.5, stop: 140, roll: 6 },
  truck: { wb: 4.50, circle: 55, grip: 0.62, t60: 16, stop: 170, roll: 5 },
  semi: { wb: 3.90, circle: 60, grip: 0.55, t60: 20, stop: 200, roll: 4 },
  schoolbus: { wb: 6.40, circle: 72, grip: 0.52, t60: 22, stop: 190, roll: 5 },
  citybus: { wb: 7.20, circle: 86, grip: 0.52, t60: 24, stop: 190, roll: 5 },
};
export const FLEET_CLASSES = Object.keys(REFERENCE);
// How close the model must come (PLAN_V3 section 6, item 8): circle within
// 5 %, 0-60 and 60-0 within 8 %, Sim grip within 0.03 g, roll within 0.5 deg.
export const TOL = { circle: 0.05, t60: 0.08, stop: 0.08, simG: 0.03, arcadeG: 0.03, roll: 0.5 };
export const FT = 0.3048;
// Curb-to-curb circle (ft) from the measured radius rc (m) of the path of
// the car's center (its center of mass) on full lock at walking pace: the
// rear axle's radius from the center's, then the outer front tire's outer
// edge. Track = width - 0.25 m, tire half width 0.12 m.
export const TIRE_HALF = 0.12;
export function curbCircleFt(spec, rc) {
  const L = spec.wheelBase, b = L * (spec.cgFront || 0.55), t = spec.width - 0.25;
  const rr = Math.sqrt(Math.max(0, rc * rc - b * b));
  return 2 * (Math.hypot(rr + t / 2, L) + TIRE_HALF) / FT;
}

// Arcade grip curve: steady lateral grip = factor * spec.grip, the factor
// `low` up to `v1` mph, falling linearly to `high` at `v2` mph and held
// there. Sim: factor 1 (the table as is).
// Task PLANTED (owner round 5, deliberate): 1.6 up to 35 mph, 1.25 from 75
// mph (the sedan about 1.31 g in town). Was 1.25 up to 30 mph and 1.1 from
// 60 mph (2.4 item 3): the owner could not turn sharp enough.
export const ARCADE_GRIP = { low: 1.6, high: 1.25, v1: 35, v2: 75 };
// The four tall service vehicles (6.11) keep SERVICE_GAIN of the gain over
// 1 (1.25 in town, 1.10 at speed, as before task PLANTED): with more their
// inner wheels would lift on full lock (test SV-H3).
export const SERVICE_GAIN = 5 / 12;
export function arcadeFactor(u, spec = null) {
  const mph = Math.abs(u) * 2.23694;
  const { low, high, v1, v2 } = ARCADE_GRIP;
  const f = mph <= v1 ? low : mph >= v2 ? high : low + (high - low) * (mph - v1) / (v2 - v1);
  return spec && spec.service ? 1 + (f - 1) * SERVICE_GAIN : f;
}
// Steady full-lock lateral grip measured at the test speeds, as a share of
// the mode's curve times spec.grip (every car, both modes).
export const LAT_SHARE = [0.96, 1.04];
// Arcade (the default): ordinary cars hold 1.0 to 1.4 g at the test speeds
// (task PLANTED, deliberate: was the section 2 line K10, 0.9 to 1.1 g, on
// the old 1.25 curve). Sim holds the real car's skidpad figure (REFERENCE).
export const LAT_G_LINE = [1.0, 1.4];
export const ORDINARY_CARS = ['compact', 'sedan', 'taxi'];
export const LAT_TEST_SPEEDS = [15, 30]; // m/s; a car whose top speed is under 36 uses 0.8 * maxSpeed for the second
export const LOCK_TIME = [0.25, 0.40]; // s, center to full lock, at 0 to 10 m/s (service vehicles)
export const RETURN_TIME = [0.20, 0.30]; // s, full lock to center, hands off
// Player cars (every car but the service vehicles; task DRIVE, PLAN_V3 13,
// deliberate: was LOCK_TIME and a 0.25 s return): the wheels reach full lock
// in 0.15 to 0.2 s and come back in 0.2 s, so a slow thumb sets the pace.
export const DRIVE_LOCK_TIME = [0.15, 0.20];
export const RETURN_TARGET = 0.2; // s, every player car
// The steering buttons ramp their target over 0.3 s (input.js): a held
// button reaches full lock at the wheels in this time (the old LOCK_TIME).
export const BUTTON_TIME = [0.25, 0.40];
export const LOCK_TIME_FAST_MAX = 0.55; // s, at 30 m/s
// Steering lock at full input and walking pace, degrees: 33 to 36 for cars
// (2.4 item 2); trucks, buses and the vans cut further on longer wheelbases
// (the tests check the circle; this only keeps the angles real).
export const LOCK_DEG = { car: [33, 36], heavy: [28, 42] };
// Arcade (task PLANTED, deliberate: the lock was the same in both modes):
// every vehicle up to ARCADE_LOCK.mass kg cuts ARCADE_LOCK.deg degrees at
// full input up to ARCADE_LOCK.fullMph (the car always uses its whole lock
// in town); heavier vehicles keep their own. The sedan's curb-to-curb
// circle comes to `sedanFt` (Sim keeps the reference table's 40 ft).
export const ARCADE_LOCK = { deg: 40, mass: 3000, fullMph: 15, sedanFt: [33, 36] };
// Arcade, the player's steering (controls.steerShape): center to full lock
// and back in `time` s (AI drivers keep DRIVE_LOCK_TIME and RETURN_TARGET).
export const ARCADE_PLAYER_STEER = { time: [0.07, 0.10] };
// Arcade is planted (task PLANTED): without the handbrake the slip angle at
// the rear axle never passes `slipDeg` degrees; the yaw rate answers the
// input within `delay` s (63 % of the settled rate, a full step) at every
// speed; a released car is straight within `release` s; the handbrake
// slide recovers within `recover` s of the release with no yaw the other way.
export const PLANTED = { slipDeg: 4, delay: 0.12, release: 0.25, recover: 0.6, slideDeg: [25, 37], shapeExp: 1.25 };
export const HEAVY = ['minivan', 'van', 'suv', 'crewcab', 'pickup', 'truck', 'semi', 'schoolbus', 'citybus'];
export const MODE_BRAKE_DIFF = 0.05; // Arcade and Sim stopping distance within 5 %
export const MODE_STRAIGHT_DIFF = 0.03; // 0 to 60 and top speed within 3 %
// [min, max]. Fleet classes: circle (ft), t60 (s) and stop (m) from REFERENCE
// within TOL; top (mph) as before HANDLE. Other cars: r0 (m) as before.
const TOP = {
  compact: [95, 105], midsize: [110, 120], sedan: [110, 120], taxi: [110, 120], police: [130, 140],
  crossover: [105, 118], suv: [95, 105], crewcab: [95, 105], pickup: [95, 105], muscle: [130, 145],
  sports: [150, 165], convertible: [105, 118], minivan: [83, 95], van: [85, 95], truck: [65, 75],
  semi: [64, 75], schoolbus: [64, 75], citybus: [64, 75],
};
const fleetBand = (id) => {
  const r = REFERENCE[id];
  return {
    circle: [r.circle * (1 - TOL.circle), r.circle * (1 + TOL.circle)],
    t60: [r.t60 * (1 - TOL.t60), r.t60 * (1 + TOL.t60)],
    top: TOP[id],
    stop: [r.stop * FT * (1 - TOL.stop), r.stop * FT * (1 + TOL.stop)],
  };
};
export const BANDS = { // [min, max]
  ...Object.fromEntries(FLEET_CLASSES.map((id) => [id, fleetBand(id)])),
  ghostwake: { r0: [5.0, 6.5], t60: [3.3, 4.3], top: [165, 180], stop: [30, 36] },
  // The three reward cars of section 6.6 (W3): bands set from their base
  // chassis as it was when they were built, and the top speed the table gives them.
  sunchaser: { r0: [5.0, 6.5], t60: [4.6, 5.6], top: [135, 150], stop: [34, 42] },
  tidewinder: { r0: [6.0, 7.5], t60: [8, 10], top: [102, 115], stop: [36, 44] },
  nightheron: { r0: [5.0, 6.5], t60: [5.5, 7], top: [122, 135], stop: [34, 42] },
  ...SERVICE_BANDS,
};
// circle: curb-to-curb ft (curbCircleFt of the radius at 2 m/s on full lock).
// r0: radius (m) of the path of the car's center at 2 m/s on full lock.
// t60: s from rest to 26.82 m/s. top: mph, reached within 90 s. stop: m from 26.82 m/s to rest.

// Street tests (2.4 item 4), a 12 m street curb to curb:
// U-turn: from rest beside the right curb (tires `gap` m off it), full lock
// set at rest, then away at walking pace (`speed` m/s): every tire stays
// between the curbs (the body may overhang them, as over a real curb).
// Trucks and buses make a three-point turn instead (`threePoint`).
export const UTURN = { street: 12, gap: 0.3, speed: 2.5, threePoint: ['crewcab', 'van', 'truck', 'semi', 'schoolbus', 'citybus'] };
// Handbrake turn (Arcade, the default): at 25 mph pull the handbrake on full
// lock and turn 90 degrees into a cross street 12 m wide: the car's center
// goes no more than `street` m further along, the slide stays under the
// Arcade cap, the car ends within `endDeg` of the new street's heading and
// drives away. Every fleet class but the trucks and buses (`except`).
export const HB_TURN = { mph: 25, street: 12, endDeg: 15, except: ['truck', 'semi', 'schoolbus', 'citybus'] };
// Lift-off at 80 mph in a steady turn (`share` of the lateral grip asked),
// every car that reaches 80 mph: the nose tucks in a little (more in Sim, with
// its full weight transfer), never a snap: the yaw rate rises no more than
// `yawRise`, the body slip stays under `slipDeg` and is not growing 2 s on.
export const LIFT_OFF = { mph: 80, share: 0.8, yawRise: { arcade: 0.25, sim: 0.5 }, slipDeg: { arcade: 5, sim: 9 } };
// Past the limit (2.4 item 4, Sim since task DRIVE): at 20 m/s full input
// gives more wheel angle than `share` of it, the same curvature within
// `same`, the front past its peak and tire squeal of at least `squeal`.
// Arcade (task DRIVE): full input stays under the limit, so its curvature
// is at least `grow` times that of `share` (monotonic to the last bit of
// travel), the front under `frontMax` of its peak slip and no squeal.
export const PUSH = { speed: 20, share: 0.85, same: 0.04, squeal: 0.15, grow: 1.1, frontMax: 1, quiet: 0.02 };

// Steering accuracy and braking accuracy limits (6.3, tests A1 to A5 and B1 to B4).
export const A1_LINEAR = 0.12; // curvature share error at 0.25, 0.5, 0.75
export const A2_OVERSHOOT = { arcade: 0.15, sim: 0.30 };
export const A2_SETTLE = { arcade: 0.6, sim: 1.0 }; // s to stay within 5 %
export const A3_MIRROR = 0.01;
export const A4_DRIFT = 0.2; // m in 5 s at 30 m/s
export const A5 = { side: 3.5, road: 30, speed: 20, truckSpeed: 15, endErr: 0.4, endDeg: 3, after: 1.5 };
export const B1_HALF = [0.45, 0.55];
export const B2 = { deg: 1, side: 0.3 };
export const B4_KEEP = 0.6;
// Brake pedal S-curve (K11): share of the full brake = p + S * p * (1 - p) * (1 - 2p).
// It replaces the traffic brake gain scale; AI planners send their pedal through it unchanged.
export const BRAKE_PEDAL_S = 1.0;
// Assist rows of the Arcade versus Sim table.
export const ARCADE_SLIP_MAX_DEG = { fwd: 8, rwd: 16 };
// Task PLANTED (deliberate): the tire rows are Sim's alone. Arcade has no
// tire curve (no sag, no ask past the grip, no squeal onset in peak slips):
// full input is 1.00 of the lateral grip by construction, the grip in use
// is reported as v.slipF (USE.arcade at full input), and the squeal follows
// the real slip angle at the rear axle, silent under SQUEAL_DEG degrees.
export const SAG = { sim: [0.18, 0.22] };
// Full input asks this share of the steady lateral grip. Sim 1.15 (2.4 item
// 4: past the limit the front pushes wide). Arcade 1.00 (task DRIVE): the
// tightest turn the car makes without sliding, quiet, never pushing wide.
export const ASK = { arcade: 1, sim: 1.15 };
export const USE = { arcade: 0.95, sim: 1.15 };
export const HB_SLIP_CAP = 0.6; // rad, Arcade: the handbrake slide full steering asks for
export const SQUEAL = { sim: 0.9 };
export const SQUEAL_DEG = 3; // Arcade
// Touch curve and travel.
export const HALF_TRAVEL = [0.40, 0.55]; // 0.4625 on the 0.9 x + 0.1 x^3 curve (task PLANTED; 0.444 before)
// Slalom pass rule (K9): all `cones` reached in order, each passed on its own side
// with the car's center at least `clear` m out, at least `keep` of the speed held,
// one scripted driver for every style (only the input device and its rate limit differ).
export const SLALOM = {
  gap: 18, speed: 20, simSpeed: 17, thumbDegPerS: 300, tiltDegPerS: 60, sliderPxPerS: 400,
  cones: 6, clear: 0.4, keep: 0.95,
};
// Chase camera (6.3): roll into the turn, yaw lag, pitch under braking.
// Task DRIVE: the chase views follow the car's yaw with a 0.12 s lag (was
// 0.18) and look up to lookDeg into the turn by the steering.
export const CAMERA = { rollMaxDeg: 2, yawLag: 0.12, pitchMaxDeg: 1.5, lookDeg: 4 };

// Handling presets (docs/PLAN_V3.md 2.4 item 5; vehicle.js HANDLING_PRESETS,
// settings.handlingPreset, default 'standard'): how far each one moves a
// sedan from Standard, as [min, max] ratios to Standard's value.
//   r0       full-lock circle at 2 m/s
//   lockTime center to full lock at 5 m/s
//   roll     body roll in a steady 0.7 g turn at 20 m/s
export const PRESETS = ['standard', 'relaxed', 'sharp'];
export const PRESET_DEFAULT = 'standard';
// Task PLANTED (deliberate): Standard is the planted target; Relaxed steers
// slower still (1.3 to 1.6 of the lock time, was 1.15 to 1.35); Sharp cuts
// 44 degrees (Standard already cuts 40, so its circle is 0.8 to 0.95 of
// Standard's; was 0.6 to 0.85 of a 35 degree lock).
export const PRESET_BANDS = {
  standard: { r0: [1, 1], lockTime: [1, 1], roll: [1, 1] },
  relaxed: { r0: [0.97, 1.03], lockTime: [1.3, 1.6], roll: [1.15, 1.45] },
  sharp: { r0: [0.8, 0.95], lockTime: [0.7, 0.88], roll: [0.75, 0.95] },
};
