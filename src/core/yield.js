// Giving way to a siren (pure logic, node-testable; no three.js, no DOM).
//
// A vehicle with `siren` on (the player's stolen police car, an AI police
// car in a chase, later a fire truck or an ambulance) clears the road:
//  - AI cars ahead of it in the same or the neighboring lane, and oncoming
//    ones close by, slow down, pull to the curb on the right, stop, and
//    start again a moment after it has passed or its siren goes off
//    (yieldTarget, stepYield, used by driveStep in src/systems/traffic.js);
//  - pedestrians on the road in front of it step to the curb side and wait
//    (asideNeed, used by stepPed in src/systems/peds.js).
// Nothing here allocates per call: results go into caller-owned objects.

// A craft counts as an emergency vehicle when its spec says so. Police
// specs carry `police`; later fire trucks and ambulances carry `emergency`.
export const hasSiren = (spec) => !!(spec && (spec.police || spec.emergency));

export const YIELD_RANGE = 60; // m ahead of the siren vehicle (same direction)
export const YIELD_ONCOMING = 40; // m (oncoming cars close by, they are on the other side)
export const YIELD_LATERAL = 6.5; // m: the same or the neighboring lane
export const START_SPEED = 4; // m/s: a parked car with its siren on moves nobody
export const KEEP_SPEED = 1.5; // m/s: once pulled over, cars wait until it really stops
export const MAX_YIELD = 25; // s: no car is held longer than this in one go
export const COOLDOWN = 8; // s: after a maximum hold a car drives on before it may yield again
export const PULL_SPEED = 6; // m/s: speed cap while moving to the curb

// Is this vehicle a siren vehicle that traffic should react to?
export function isSirenCar(v) {
  return !!(v && v.siren && v.kind === 'car' && !v.removed && !v.wrecked && !((v.y || 0) > 3));
}

// Fill `out` (cleared first) with the siren vehicles of `vehicles`.
export function collectSirens(vehicles, out) {
  out.length = 0;
  if (!vehicles) return out;
  for (let i = 0; i < vehicles.length; i++) if (isSirenCar(vehicles[i])) out.push(vehicles[i]);
  return out;
}

const halfLen = (v) => (v.spec && v.spec.length ? v.spec.length / 2 : 2.4);

// Should `car` give way to `siren`? Fills out.yield (bool), out.along (meters
// of the car ahead of the siren vehicle, negative once passed) and out.lat
// (to the right of the siren vehicle). `engaged` is true when the car is
// already pulling over: the speed bar is lower then, so a siren car that
// slows in traffic does not release the cars at once.
export function yieldTarget(car, siren, out, engaged = false) {
  out.yield = false;
  out.along = 0;
  out.lat = 0;
  if (!car || !siren || car === siren || siren.removed) return out;
  const sp = siren.speed || 0;
  if (!(sp > (engaged ? KEEP_SPEED : START_SPEED))) return out;
  const fx = Math.cos(siren.heading), fz = Math.sin(siren.heading);
  const dx = car.x - siren.x, dz = car.z - siren.z;
  const along = dx * fx + dz * fz;
  const lat = -dx * fz + dz * fx; // right of the siren vehicle
  out.along = along;
  out.lat = lat;
  if (Math.abs(lat) >= YIELD_LATERAL) return out;
  const ch = Math.cos(car.heading) * fx + Math.sin(car.heading) * fz;
  const passed = -(halfLen(car) + halfLen(siren) + 1);
  if (ch > 0.5) out.yield = along > passed && along < YIELD_RANGE;
  else if (ch < -0.5) out.yield = along > passed && along < YIELD_ONCOMING;
  return out;
}

const YT = { yield: false, along: 0, lat: 0 };

// True when any siren vehicle of the list asks `car` to give way.
export function wantsYield(car, sirens, engaged) {
  if (!sirens) return false;
  for (let i = 0; i < sirens.length; i++) {
    if (yieldTarget(car, sirens[i], YT, engaged).yield) return true;
  }
  return false;
}

// Per-driver state. on: pulling over or waiting at the curb; hold: seconds
// left before it drives off again; total: seconds in this yield; cool:
// seconds before it may yield again after a maximum hold.
export function createYield() {
  return { on: false, hold: 0, total: 0, cool: 0 };
}

// Resume delay after the siren has gone: 0.8 to 1.8 s, spread over the
// cars by their id so they do not all start at once (no random draw).
export const resumeDelay = (id) => 0.8 + (((id | 0) >>> 0) % 1000) / 1000;

// One step of the state machine. Returns y.on. The caller decides whether
// it can act on it (not inside a junction); the state runs regardless.
export function stepYield(y, car, sirens, dt, id) {
  if (y.cool > 0) y.cool -= dt;
  if (y.hold > 0) y.hold -= dt;
  const want = y.cool <= 0 && wantsYield(car, sirens, y.on);
  if (want && !y.on) {
    y.on = true;
    y.total = 0;
    y.hold = 0;
  } else if (y.on) {
    y.total += dt;
    if (!want) {
      y.on = false;
      y.hold = resumeDelay(id);
    } else if (y.total > MAX_YIELD) {
      // Never hold a car for good (a siren car idling beside the road).
      y.on = false;
      y.hold = 0;
      y.cool = COOLDOWN;
    }
  }
  return y.on;
}

// How far from the curb-side edge of the lane a pulled-over car goes: the
// room between its side and the road edge, with a margin, capped so a car
// in the inner lane of an avenue only shifts within its own lane.
export function curbShift(roadWidth, laneOff, halfW, innerLane) {
  const room = roadWidth / 2 - laneOff - halfW - 1.0;
  const cap = innerLane ? 1.2 : 1.8;
  return room < 0 ? 0 : room > cap ? cap : room;
}

// --- Pedestrians. ---
export const ASIDE_AHEAD = 25; // m ahead of the siren vehicle
export const ASIDE_BEHIND = 3; // m: still in the way when level with it
export const ASIDE_SPEED = 5; // m/s: the siren vehicle must be moving at least this fast
export const ASIDE_LAT = 5.2; // m from the siren vehicle's line: further than this is safe
export const ASIDE_WALK = 3; // m/s
export const ASIDE_HOLD = 1.2; // s they wait after the last siren vehicle has gone by

// Is `ped` in the way of `siren`? Fills out.need (meters still to walk to
// be clear, 0 when clear but still close) and the unit direction out.dx,
// out.dz away from the siren vehicle's line, on the ped's own side.
export function asideNeed(ped, siren, out) {
  out.active = false;
  out.need = 0;
  out.dx = 0;
  out.dz = 0;
  if (!ped || !siren || siren.removed || !((siren.speed || 0) > ASIDE_SPEED)) return false;
  const fx = Math.cos(siren.heading), fz = Math.sin(siren.heading);
  const dx = ped.x - siren.x, dz = ped.z - siren.z;
  const along = dx * fx + dz * fz;
  if (along < -ASIDE_BEHIND || along > ASIDE_AHEAD) return false;
  const lat = -dx * fz + dz * fx;
  const a = Math.abs(lat);
  if (a >= ASIDE_LAT + 0.5) return false;
  const side = lat < 0 ? -1 : 1;
  out.active = true;
  out.need = a < ASIDE_LAT ? ASIDE_LAT - a : 0;
  out.dx = -fz * side;
  out.dz = fx * side;
  return true;
}
