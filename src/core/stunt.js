// Stunt jump measurement: air time, distance, height, flips and rolls of
// a craft launched off a ramp, the landing check and the medal for it.
// Pure logic: no three.js, no DOM, no allocation per step.
//
// Angles of the craft in the air (kept on the vehicle as `air`, and
// mirrored to `airPitch` / `airRoll` for drawing):
//   pitch: nose up positive (a backflip turns it up and over)
//   roll : about the long axis (a barrel roll)
// The body's up axis has a vertical part cos(pitch) * cos(roll): above
// LAND_UP on landing is wheels down; below 0 is on the roof.
import { angleDiff } from './rng.js';

export const STUNT_G = 9.81;
const TAU = Math.PI * 2;

// ---- Medal thresholds (points for one jump) ---------------------------
// Points = air time * PER_AIR + distance * PER_METRE + height * PER_HEIGHT
//          + full flips * PER_FLIP + full rolls * PER_ROLL.
// A fast run off a street ramp (about 1.4 s, 35 m) is silver; add a flip
// or a roll for gold. Bronze needs a real jump (about 0.9 s, 15 m).
export const STUNT_MEDALS = { gold: 1500, silver: 900, bronze: 450 };
export const STUNT_SCORE = {
  perAirSecond: 400,
  perMetre: 10,
  perHeightMetre: 40,
  perFlip: 700,
  perRoll: 500,
};
export const MIN_AIR = 0.35; // s: shorter hops score nothing
export const LAND_UP = 0.64; // cos 50 deg: steeper than this is a bad landing
export const TURN_SLACK = Math.PI / 4; // a flip counts from 315 deg
// In-air control (rad/s): brake pulls the nose up (backflip), steer rolls.
export const AIR_PITCH_RATE = 5.2, AIR_ROLL_RATE = 5.8;
const AIR_RESP = 7; // 1/s: how fast the spin follows the input
const LEVEL_K = 5, LEVEL_D = 3.2; // hands off: nose follows the flight path, wings level

export function createAirState() {
  return {
    on: false, t: 0,
    x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0,
    x0: 0, z0: 0, y0: 0, maxY: 0,
    pitch: 0, roll: 0, wp: 0, wr: 0,
    turnP: 0, turnR: 0, // signed rotation summed over the flight
    spot: null, crashed: false,
  };
}

// Start a flight at (x, y, z) with velocity (vx, vy, vz); `pitch` is the
// ramp angle the craft leaves with.
export function beginAir(st, x, y, z, vx, vy, vz, pitch = 0, roll = 0) {
  st.on = true;
  st.t = 0;
  st.x = st.x0 = x;
  st.y = st.y0 = y;
  st.z = st.z0 = z;
  st.maxY = y;
  st.vx = vx; st.vy = vy; st.vz = vz;
  st.pitch = pitch; st.roll = roll;
  st.wp = 0; st.wr = 0;
  st.turnP = 0; st.turnR = 0;
  st.crashed = false;
  return st;
}

// One fixed step of flight. `inPitch` and `inRoll` are -1..1 player
// inputs (0 for nobody): hands off, the nose eases onto the flight path
// and the wings level, so a plain jump lands on its wheels.
export function stepAir(st, dt, inPitch = 0, inRoll = 0) {
  if (!st.on || !(dt > 0)) return st;
  st.t += dt;
  st.vy -= STUNT_G * dt;
  st.x += st.vx * dt;
  st.y += st.vy * dt;
  st.z += st.vz * dt;
  if (st.y > st.maxY) st.maxY = st.y;
  const k = Math.min(1, AIR_RESP * dt);
  if (inPitch) st.wp += (inPitch * AIR_PITCH_RATE - st.wp) * k;
  else {
    const path = Math.atan2(st.vy, Math.hypot(st.vx, st.vz)) * 0.5;
    st.wp += (LEVEL_K * angleDiff(path, st.pitch) - LEVEL_D * st.wp) * dt;
  }
  if (inRoll) st.wr += (inRoll * AIR_ROLL_RATE - st.wr) * k;
  else st.wr += (LEVEL_K * angleDiff(0, st.roll) - LEVEL_D * st.wr) * dt;
  st.pitch += st.wp * dt;
  st.roll += st.wr * dt;
  st.turnP += st.wp * dt;
  st.turnR += st.wr * dt;
  return st;
}

// Whole turns in a summed rotation (a flip counts from 315 degrees).
export const fullTurns = (angle) => Math.floor((Math.abs(angle) + TURN_SLACK) / TAU);

export const upright = (pitch, roll) => Math.cos(pitch) * Math.cos(roll);

export function stuntPoints(air, dist, height, flips, rolls) {
  if (!(air >= MIN_AIR)) return 0;
  const S = STUNT_SCORE;
  return Math.round(air * S.perAirSecond + Math.max(0, dist) * S.perMetre + Math.max(0, height) * S.perHeightMetre
    + flips * S.perFlip + rolls * S.perRoll);
}

export function medalFor(points) {
  if (points >= STUNT_MEDALS.gold) return 'gold';
  if (points >= STUNT_MEDALS.silver) return 'silver';
  if (points >= STUNT_MEDALS.bronze) return 'bronze';
  return null;
}

const RESULT = { ok: false, upsideDown: false, air: 0, dist: 0, height: 0, flips: 0, rolls: 0, points: 0, medal: null };

// Judge a landing. Returns a shared result object (read it, do not keep
// it). Wrecked, crashed into something, sideways or on the roof: no points.
export function judgeLanding(st, wrecked = false) {
  const r = RESULT;
  const up = upright(st.pitch, st.roll);
  r.air = st.t;
  r.dist = Math.hypot(st.x - st.x0, st.z - st.z0);
  r.height = Math.max(0, st.maxY - st.y0);
  r.flips = fullTurns(st.turnP);
  r.rolls = fullTurns(st.turnR);
  r.upsideDown = up < 0;
  r.ok = !wrecked && !st.crashed && up >= LAND_UP;
  r.points = r.ok ? stuntPoints(r.air, r.dist, r.height, r.flips, r.rolls) : 0;
  r.medal = r.points > 0 ? medalFor(r.points) : null;
  return r;
}

// Rank for comparing medals (higher is better).
export const medalRank = (m) => (m === 'gold' ? 3 : m === 'silver' ? 2 : m === 'bronze' ? 1 : 0);
