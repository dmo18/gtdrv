// Service vehicles (docs/REVAMP.md 6.11, V1): the fire truck, the ambulance,
// the garbage truck and the tow truck. Plain data and small pure helpers:
// no three.js, no DOM, no import of vehicle.js (vehicle.js merges
// SERVICE_SPECS into VEHICLE_SPECS with one import line, and
// handlingbands.js merges SERVICE_BANDS into BANDS). All names and
// liveries are invented. None is armed; all can be stolen and boosted.
//
// Spec flags: `service` ('fire' | 'ambulance' | 'garbage' | 'tow'),
// `siren` (true for police, ambulance and fire truck), `emergency` (the
// flag src/core/yield.js hasSiren reads), `beacon` (amber lamps, no
// siren, nobody yields), `extra` (the id of the vehicle's one extra).

// Handling fields as in VEHICLE_SPECS (src/entities/vehicle.js); the
// size, mass, steering and top speed values are the 6.11 table, the
// drivetrain (power, gears, firstGear, brake) is tuned to SERVICE_BANDS.
export const SERVICE_SPECS = {
  ambulance: {
    id: 'ambulance', label: 'Careline', body: 'truck', service: 'ambulance', siren: true, emergency: true, extra: 'treat',
    length: 6.2, width: 2.2, height: 2.8, wheelBase: 3.7, wheelRadius: 0.38,
    mass: 4200, maxSpeed: 42.5, reverseSpeed: 7, accel: 2.5, brake: 8.4, grip: 0.80, steerMax: 0.46,
    lockRate: 2.8, returnRate: 3.6,
    drive: 'rwd', gears: 5, power: 195, firstGear: 14, cgFront: 0.55,
    health: 1600, colors: [0xf4f4f0],
  },
  towtruck: {
    id: 'towtruck', label: 'Hookton', body: 'truck', service: 'tow', beacon: true, extra: 'hook',
    length: 6.8, width: 2.3, height: 2.6, wheelBase: 4.0, wheelRadius: 0.45,
    mass: 5200, maxSpeed: 38.0, reverseSpeed: 6, accel: 2, brake: 7.9, grip: 0.76, steerMax: 0.45,
    lockRate: 2.7, returnRate: 3.5,
    drive: 'rwd', gears: 5, power: 180, firstGear: 11, cgFront: 0.55,
    health: 1800, colors: [0xe8a317],
  },
  firetruck: {
    id: 'firetruck', label: 'Brandwell', body: 'truck', service: 'fire', siren: true, emergency: true, extra: 'cannon',
    length: 9.0, width: 2.5, height: 3.3, wheelBase: 5.0, wheelRadius: 0.52,
    mass: 14000, maxSpeed: 30.0, reverseSpeed: 5, accel: 1.2, brake: 6.9, grip: 0.68, steerMax: 0.42,
    lockRate: 2.55, returnRate: 3.4,
    drive: 'rwd', gears: 6, power: 300, firstGear: 6.5, cgFront: 0.5,
    health: 2600, colors: [0xc8161b],
  },
  garbage: {
    id: 'garbage', label: 'Haulmark', body: 'truck', service: 'garbage', beacon: true, extra: 'lift',
    length: 8.2, width: 2.5, height: 3.5, wheelBase: 4.6, wheelRadius: 0.52,
    mass: 12000, maxSpeed: 29.5, reverseSpeed: 5, accel: 1.0, brake: 6.6, grip: 0.66, steerMax: 0.43,
    lockRate: 2.55, returnRate: 3.4,
    drive: 'rwd', gears: 6, power: 220, firstGear: 6, cgFront: 0.5,
    health: 2400, colors: [0x2f7d3a],
  },
};
export const SERVICE_IDS = Object.keys(SERVICE_SPECS);

// The police car keeps its 6.3 row; these four are exceptions to the
// single car line, modeled on the truck row (same meaning and units as
// BANDS in src/entities/handlingbands.js).
export const SERVICE_BANDS = {
  ambulance: { r0: [7.0, 8.5], t60: [10, 12], top: [90, 100], stop: [40, 46] },
  towtruck: { r0: [7.5, 9.0], t60: [13, 16], top: [80, 90], stop: [42, 50] },
  firetruck: { r0: [10.5, 12.5], t60: [20, 26], top: [62, 72], stop: [48, 58] },
  garbage: { r0: [9.5, 11.5], t60: [24, 30], top: [61, 70], stop: [50, 60] },
};

// Does this spec carry a siren (police, ambulance, fire truck)?
export const specSiren = (spec) => !!(spec && (spec.siren || spec.police));
// Amber beacons only (garbage and tow truck).
export const specBeacon = (spec) => !!(spec && spec.beacon);

// ---- Sirens (sound by audio.js from the `siren` event's `kind`) ----
export const SIRENS = {
  police: { tone: 'wail', lo: 600, hi: 1300, cycle: 3.2, horn: 'yelp', yelpCycle: 0.3 },
  ambulance: { tone: 'hilo', hi: 960, lo: 770, step: 0.5 },
  firetruck: { tone: 'deepwail', lo: 400, hi: 1000, cycle: 5.0, horn: 'airhorn', air: [150, 190] },
  garbage: { tone: null, reverse: { hz: 1000, on: 0.4, off: 0.4 } },
  towtruck: { tone: null, reverse: { hz: 1000, on: 0.4, off: 0.4 } },
};

// ---- Light bars ----
// Colors of the lit lamps.
export const LAMP_COLORS = { red: 0xff2a2a, blue: 0x2a5cff, white: 0xffffff, amber: 0xffa200 };
// Per bar: the lamp slots (bit i of a phase mask lights slot i) and the
// phases in order, each `ms` long (a multiple of 50 ms = 3 fixed steps).
export const LIGHTBARS = {
  // Roof bar, left red and right blue, plus headlamp wig-wag (left lamp
  // the first 400 ms, right lamp the next) while the siren runs.
  police: {
    slots: [['barL', 'red'], ['barR', 'blue'], ['headL', 'white'], ['headR', 'white']],
    phases: [[100, 'barL headL'], [100, 'headL'], [100, 'barL headL'], [100, 'headL'],
      [100, 'barR headR'], [100, 'headR'], [100, 'barR headR'], [100, 'headR']],
  },
  // Four red corner lamps on the box roof, one white lamp over the cab.
  ambulance: {
    slots: [['frontReds', 'red'], ['rearReds', 'red'], ['white', 'white']],
    phases: [[150, 'frontReds'], [150, ''], [150, 'frontReds'], [150, 'rearReds white'], [150, ''], [150, 'rearReds white']],
  },
  // Cab bar in two red halves, two red lamps on each body side in the
  // opposite phase (left side with the right half), a white center lamp
  // for the first 50 ms of each half.
  firetruck: {
    slots: [['barL', 'red'], ['barR', 'red'], ['sideL', 'red'], ['sideR', 'red'], ['white', 'white']],
    phases: [[50, 'barL sideR white'], [200, 'barL sideR'], [50, 'barR sideL white'], [200, 'barR sideL']],
  },
  // Two amber beacons on the cab roof.
  garbage: {
    slots: [['beaconL', 'amber'], ['beaconR', 'amber']],
    phases: [[400, 'beaconL'], [400, 'beaconR']],
  },
  // Amber roof bar in four segments, a chase left to right.
  towtruck: {
    slots: [['seg0', 'amber'], ['seg1', 'amber'], ['seg2', 'amber'], ['seg3', 'amber']],
    phases: [[150, 'seg0'], [150, 'seg1'], [150, 'seg2'], [150, 'seg3']],
  },
};
// Precompute masks and cycle lengths in 50 ms ticks.
for (const id in LIGHTBARS) {
  const b = LIGHTBARS[id];
  const index = {};
  b.slots.forEach(([name], i) => { index[name] = i; });
  b.all = (1 << b.slots.length) - 1;
  b.masks = b.phases.map(([, names]) => names.split(' ').filter(Boolean).reduce((m, n) => m | (1 << index[n]), 0));
  b.ticks = b.phases.map(([ms]) => ms / 50);
  b.cycle = b.phases.reduce((s, [ms]) => s + ms, 0);
  b.cycleTicks = b.cycle / 50;
}
export const BEACON_HOLD = 2; // s the amber beacons stay on after lifting, towing or reversing

// Lamp state of a bar at game time t (seconds, counted in fixed steps):
// out.mask (lit slots), out.phase (index), out.half (steady half
// brightness under reduced motion). Allocation free.
export function lightbarPhase(id, t, reduced = false, out = { mask: 0, phase: 0, half: false }) {
  const b = LIGHTBARS[id];
  out.half = false;
  if (!b) { out.mask = 0; out.phase = -1; return out; }
  if (reduced) { out.mask = b.all; out.phase = -1; out.half = true; return out; }
  const steps = Math.round((t > 0 ? t : 0) * 60);
  let k = Math.floor(steps / 3) % b.cycleTicks;
  for (let i = 0; i < b.ticks.length; i++) {
    if (k < b.ticks[i]) { out.mask = b.masks[i]; out.phase = i; return out; }
    k -= b.ticks[i];
  }
  out.mask = 0;
  out.phase = -1;
  return out;
}

// ---- Extras (rules in src/systems/service.js) ----
const DEG = Math.PI / 180;
export const EXTRAS = {
  cannon: {
    caption: 'WATER', input: 'hold', tank: 20, refill: 40, restart: 0.25, range: 28, cone: 35 * DEG, turn: 90 * DEG,
    personLine: 0.9, craftLine: 2.0, push: 5, downT: 3, hullT: 1.5, score: 150, steamT: 4, craftForce: 3000, particles: 40,
  },
  treat: { caption: 'TREAT', input: 'tap', maxSpeed: 2, range: 8, time: 2.0, cooldown: 5, score: 200, regen: 0.05 },
  lift: {
    caption: 'LIFT', input: 'tap', maxSpeed: 1.5, range: 4.0, raise: 1.0, tip: 1.0, lower: 1.0, binLock: 300, score: 50,
    cap: 20, yardStop: 2, yardScore: 400, crushRange: 4.0, crushMax: 3, crushScore: 20, crushTime: 1.0,
  },
  hook: {
    caption: 'HOOK', release: 'DROP', input: 'tap', maxSpeed: 1.5, range: 3.5, cone: 30 * DEG, maxMass: 2600, targetSpeed: 1,
    attachT: 1.0, tapGap: 1.0, lift: 0.35, hitch: 0.8, massShare: 0.6, topCap: 26.8, releaseAngle: 75 * DEG,
    yardStop: 2, score: 300, policeStars: 2,
  },
};

// ---- Traffic share (read by src/systems/traffic.js) ----
export const TRAFFIC_SHARES = { garbage: 0.012, towtruck: 0.010, ambulance: 0.008, firetruck: 0.005 };
export const TRAFFIC_RULES = { maxAlive: 2, minGap: 150, garbageHours: [5, 15], onCall: 0.25, onCallSpeed: 1.3 };
const SHARE_ORDER = ['garbage', 'towtruck', 'ambulance', 'firetruck'];

// One seeded draw per ordinary traffic spawn: the service kind to spawn in
// its place, or null. alive: the service vehicles now in traffic (with x,
// z, spec). (x, z) the spawn point; clock the game hour; inCore whether the
// point is inside the core. Always draws exactly one number from rng.
export function pickTrafficService(rng, clock, alive, x, z, inCore = true) {
  let r = rng.next();
  let kind = null;
  for (let i = 0; i < SHARE_ORDER.length; i++) {
    const k = SHARE_ORDER[i];
    if (r < TRAFFIC_SHARES[k]) { kind = k; break; }
    r -= TRAFFIC_SHARES[k];
  }
  if (!kind || !inCore) return null;
  const h = TRAFFIC_RULES.garbageHours;
  if (kind === 'garbage' && !(clock >= h[0] && clock < h[1])) return null;
  let n = 0;
  const g2 = TRAFFIC_RULES.minGap * TRAFFIC_RULES.minGap;
  for (let i = 0; i < alive.length; i++) {
    const o = alive[i];
    if (!o || o.removed) continue;
    n++;
    if (o.spec.id === kind) return null;
    const dx = o.x - x, dz = o.z - z;
    if (dx * dx + dz * dz < g2) return null;
  }
  return n >= TRAFFIC_RULES.maxAlive ? null : kind;
}
// One in four ambulance or fire truck spawns is on call (siren on, faster).
export const onCallDraw = (kind, r) => (kind === 'ambulance' || kind === 'firetruck') && r < TRAFFIC_RULES.onCall;

// ---- Parking (SERVICE_SPOTS) ----
// Hand-made spots on the Miami map, made to the 6.11 rules and checked by
// test/service.test.js (SV-P1) against the built city: { kind, x, z,
// heading, name }. kind is a spec id; `yard` marks the City Yard and the
// tow yard (where a load or a towed car is handed in); `curb` a marked curb
// bay (one of city.parkingSpots) rather than a lot. Made with the planner
// in test/service.test.js's rules (checkSpot in src/systems/service.js):
// fire houses Downtown and in Little Havana, a Port station; the medical
// center in Overtown (the health district north-west of Downtown lies
// outside the box); the City Yard on Wynwood's industrial land; the tow
// yard on the Port's industrial land (no legal yard on the river strip);
// patrol bases Downtown and in Little Havana. The third garbage truck is
// in a Downtown lot, not Wynwood: the rule "one of each kind within 600 m
// by road of the start" wins over the home table. 0.9.0: lots now start
// 4 m past the curb (world/miami.js LOT_SETBACK), so twelve lot homes moved
// 1.5 to 33 m onto their lots (the nearest spot that passes every rule),
// and the three curb homes moved to the nearest curb bay the real parking
// lanes still have (16 to 103 m; the tow bay to the nearest one within
// 600 m by road of the start, 318 m north).
export const SERVICE_SPOTS = [
  { kind: 'firetruck', x: -1440.3, z: 956.3, heading: -0.024, name: 'Harbor Fire House' },
  { kind: 'firetruck', x: -1426.3, z: 956.3, heading: -0.024, name: 'Harbor Fire House' },
  { kind: 'ambulance', x: -1412.3, z: 956.3, heading: -0.024, name: 'Harbor Fire House' },
  { kind: 'firetruck', x: -2261.3, z: 727.8, heading: 1.546, name: 'Calle Fire House' },
  { kind: 'ambulance', x: -2261.3, z: 717.8, heading: 1.546, name: 'Calle Fire House' },
  { kind: 'firetruck', x: 2205.3, z: 944.8, heading: 0.84, name: 'Port Fire Station' },
  { kind: 'ambulance', x: -2644.3, z: -1092.3, heading: -0.024, name: 'Tideline Medical Center' },
  { kind: 'ambulance', x: -2683.3, z: -1092.3, heading: 1.558, name: 'Tideline Medical Center' },
  { kind: 'garbage', x: -2234.8, z: -2171.3, heading: -1.6, name: 'City Yard', yard: true },
  { kind: 'garbage', x: -2288.8, z: -2142.3, heading: 3.112, name: 'City Yard', yard: true },
  { kind: 'garbage', x: -1053.8, z: 302.8, heading: 1.536, name: 'Bayside Bin Depot' },
  { kind: 'towtruck', x: 1306.8, z: 598.8, heading: 0.416, name: 'Sunline Towing', yard: true },
  { kind: 'towtruck', x: 1261.8, z: 578.8, heading: 0.416, name: 'Sunline Towing', yard: true },
  { kind: 'towtruck', x: -1053.16, z: 948.3, heading: -2.462, name: 'Sunline Towing curb bay', curb: true },
  { kind: 'police', x: -1492.8, z: 985.3, heading: 0.067, name: 'Central Patrol Base' },
  { kind: 'police', x: -1488.8, z: 977.3, heading: 0.067, name: 'Central Patrol Base' },
  { kind: 'police', x: -2321.3, z: 586.8, heading: -1.605, name: 'Ocho Patrol Base' },
  { kind: 'police', x: -2316.3, z: 586.8, heading: -1.605, name: 'Ocho Patrol Base' },
  { kind: 'police', x: -964.83, z: -118.63, heading: 3.1043, name: 'Biscayne patrol bay', curb: true },
  { kind: 'police', x: -1174.5, z: 1739.29, heading: -2.9102, name: 'Brickell patrol bay', curb: true },
];
export const SPOT_RULES = {
  counts: { firetruck: 4, ambulance: 4, garbage: 3, towtruck: 3, police: 6 },
  lotTypes: ['carpark', 'works', 'plaza'], roadNear: 12, way: 4, wayWide: 6, startNear: 600, titleClear: 60,
  apart: 400, respawn: 300, respawnFar: 250,
};
