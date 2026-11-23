// Handling bands (docs/REVAMP.md section 6.3): plain constants, imported
// by test/handling-bands.test.js and by nothing at runtime.
// Units: m/s, m, s, g = 9.81 m/s2. "mph" is m/s times 2.23694. All
// measurements use `stepVehicle` at 1/60 s on dry ground with no wind,
// starting from rest or from a settled speed.

import { SERVICE_BANDS } from './servicevehicles.js'; // V1: the four service vehicles (6.11)

export const MODES = ['arcade', 'sim']; // settings.handling, default 'arcade'
export const LAT_G_FACTOR = { arcade: [1.00, 1.12], sim: [0.88, 1.00] }; // times spec.grip
// Section 2 line (K10): ordinary cars hold 0.9 to 1.1 g at the test speeds, in both modes.
export const LAT_G_LINE = [0.9, 1.1];
export const ORDINARY_CARS = ['compact', 'sedan', 'taxi'];
export const LAT_TEST_SPEEDS = [15, 30]; // m/s; a car whose top speed is under 36 uses 0.8 * maxSpeed for the second
export const LOCK_TIME = [0.25, 0.40]; // s, center to full lock, at 0 to 10 m/s
export const RETURN_TIME = [0.20, 0.30]; // s, full lock to center, hands off
export const LOCK_TIME_FAST_MAX = 0.55; // s, at 30 m/s
export const MODE_BRAKE_DIFF = 0.05; // Arcade and Sim stopping distance within 5 %
export const MODE_STRAIGHT_DIFF = 0.03; // 0 to 60 and top speed within 3 %
export const BANDS = { // [min, max]
  compact: { r0: [5.0, 6.5], t60: [9, 11], top: [95, 105], stop: [34, 42] },
  sedan: { r0: [5.0, 6.5], t60: [7.5, 9], top: [110, 120], stop: [34, 42] },
  taxi: { r0: [5.0, 6.5], t60: [7.5, 9.5], top: [110, 120], stop: [34, 42] },
  police: { r0: [5.0, 6.5], t60: [6, 7], top: [130, 140], stop: [33, 40] },
  sports: { r0: [5.0, 6.5], t60: [3.5, 4.5], top: [150, 165], stop: [30, 36] },
  ghostwake: { r0: [5.0, 6.5], t60: [3.3, 4.3], top: [165, 180], stop: [30, 36] },
  muscle: { r0: [5.0, 6.5], t60: [5, 6], top: [130, 145], stop: [34, 42] },
  pickup: { r0: [6.0, 7.5], t60: [9, 11], top: [95, 105], stop: [36, 44] },
  van: { r0: [6.0, 7.5], t60: [11, 13], top: [85, 95], stop: [40, 46] },
  truck: { r0: [9.0, 11.0], t60: [18, 24], top: [65, 75], stop: [46, 55] },
  // The three reward cars of section 6.6 (W3): bands set from their base
  // chassis and the top speed the table gives them.
  sunchaser: { r0: [5.0, 6.5], t60: [4.6, 5.6], top: [135, 150], stop: [34, 42] },
  tidewinder: { r0: [6.0, 7.5], t60: [8, 10], top: [102, 115], stop: [36, 44] },
  nightheron: { r0: [5.0, 6.5], t60: [5.5, 7], top: [122, 135], stop: [34, 42] },
  ...SERVICE_BANDS,
};
// r0: radius (m) of the path of the car's center at 2 m/s on full lock.
// t60: s from rest to 26.82 m/s. top: mph, reached within 90 s. stop: m from 26.82 m/s to rest.

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
export const SAG = { arcade: [0, 0.06], sim: [0.18, 0.22] };
export const ASK = { arcade: 1.00, sim: 1.10 };
export const HB_SLIP_CAP = 0.6; // rad, Arcade handbrake slide cap
export const SQUEAL = { arcade: 1.3, sim: 0.9 };
// Touch curve and travel.
export const HALF_TRAVEL = [0.40, 0.55];
// Slalom pass rule (K9): all `cones` reached in order, each passed on its own side
// with the car's center at least `clear` m out, at least `keep` of the speed held,
// one scripted driver for every style (only the input device and its rate limit differ).
export const SLALOM = {
  gap: 18, speed: 20, simSpeed: 17, thumbDegPerS: 300, tiltDegPerS: 60, sliderPxPerS: 400,
  cones: 6, clear: 0.4, keep: 0.95,
};
// Chase camera (6.3): roll into the turn, yaw lag, pitch under braking.
export const CAMERA = { rollMaxDeg: 2, yawLag: 0.18, pitchMaxDeg: 1.5 };
