// Tracked craft: the Rustback tank (docs/ARMS.md section 3). Pure logic:
// no three.js, no DOM. Shared craft fields as docs/CRAFT.md plus a hull
// that pivots on the spot, a turret with its own aim and gun elevation,
// and track speeds for the tread animation and sound.
//
// Physics in one line: tracks drive along the hull only (no side slip;
// sideways velocity from a blast bleeds off at 8 m/s^2), the hull turns
// at a speed-dependent rate, two body circles keep it out of buildings
// and the sea. collideTank() is the pair rule game.js calls for any tank
// pair: it shoves, rams and crushes (crushed cars are flagged for the
// armor system, which applies the damage and the event).
import { angleDiff } from '../core/rng.js';

export const TANK_ID0 = 300000;
let nextId = TANK_ID0;

const BASE = {
  kind: 'tank', length: 7.2, width: 3.6, height: 2.6, health: 1000,
  maxSpeed: 13, reverseSpeed: 5, accel: 3.2, brake: 6,
  turnRate: 0.9, turnRateFast: 0.55, traverse: 1.6, elevRate: 0.8,
  gunPitchMin: -0.14, gunPitchMax: 0.35,
  mounts: ['cannon', 'coax'],
  armor: { bullet: 0.04, melee: 0, ram: 0.15, blast: 0.6, fire: 0.3 },
  engine: 'tracks', mass: 42000,
  // Turret ring and barrel in hull-local meters (x forward, y up).
  turretX: -0.45, turretY: 2.05, barrelLen: 4.6,
};

export const TANK_SPECS = {
  rustback: { ...BASE, id: 'rustback', label: 'Rustback', colors: [0xb9a77a, 0x5d6670, 0x5e6b45, 0x8a4b32] },
  // Police livery: slate with a white band (task 34 drives these).
  rustbackpolice: { ...BASE, id: 'rustbackpolice', label: 'Rustback Patrol', police: true, colors: [0x5d6670] },
};

const CRUSH_SPEED = 2; // m/s the tank must make to roll over a car
const CRUSH_MAX_LEN = 7; // cars this long or longer are only pushed
const RAM_PER_MS = 30; // ram damage per m/s of closing speed
const BLAST_SLIP_DECAY = 8; // m/s^2: sideways velocity bleeding off
const YAW_ACCEL = 3.2; // rad/s^2 the hull's turn rate changes by
const PHASE_WRAP = 1000;

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
function approach(v, target, step) {
  if (v < target) return Math.min(target, v + step);
  return Math.max(target, v - step);
}

export function createTank(specId, x, z, heading = 0, rng = null) {
  const spec = TANK_SPECS[specId] || TANK_SPECS.rustback;
  const color = rng ? rng.pick(spec.colors) : spec.colors[0];
  return {
    id: nextId++,
    kind: 'tank',
    spec,
    x, z, y: 0, heading, pitch: 0, roll: 0,
    px: x, pz: z, py: 0, pheading: heading, ppitch: 0, proll: 0,
    vx: 0, vz: 0, vy: 0, speed: 0, yawRate: 0,
    steer: 0, throttle: 0, brake: 0, handbrake: false,
    health: spec.health,
    wrecked: false,
    impact: 0,
    driver: null,
    radius: Math.hypot(spec.length / 2, spec.width / 2),
    color,
    onGround: true,
    onWater: false,
    // Turret: yaw relative to the hull, gun pitch, and their previous
    // values for drawing. aimYaw / aimPitch are the wanted world yaw and
    // gun pitch (aimSet false = hold the current turret angle).
    turretYaw: 0, gunPitch: 0, pturretYaw: 0, pgunPitch: 0,
    aimYaw: heading, aimPitch: 0, aimSet: false,
    // Tracks: surface speed of each band (m/s) and how far each has run.
    trackL: 0, trackR: 0, trackPhase: 0, trackPhaseL: 0, trackPhaseR: 0,
    recoil: 0, // 0..1, decays 3/s
    crewAI: null,
    bailed: false,
    crushed: false,
    lat: 0, // sideways velocity (m/s) left from a blast
    sway: 0, swayV: 0, // body pitch spring (visual)
  };
}

// Push a body circle out of buildings, trees and lamps. Returns the
// closing speed into the wall (0 if none) and fixes the velocity.
function wallCircle(t, col, off, r) {
  const ch = Math.cos(t.heading), sh = Math.sin(t.heading);
  const cx = t.x + ch * off, cz = t.z + sh * off;
  const res = col.resolveCircle(cx, cz, r, 1);
  if (!res.hit) return 0;
  const dx = res.x - cx, dz = res.z - cz;
  const d = Math.sqrt(dx * dx + dz * dz);
  if (!(d > 1e-9)) return 0;
  t.x += dx;
  t.z += dz;
  const nx = dx / d, nz = dz / d;
  const vn = t.vx * nx + t.vz * nz;
  if (vn >= 0) return 0;
  t.vx -= vn * nx * 1.05;
  t.vz -= vn * nz * 1.05;
  return -vn;
}

// The shoreline is a wall: keep the land side (the causeway is land).
function keepOnLand(t, city) {
  const d = city.shoreDist(t.x, t.z);
  const edge = t.spec.width / 2 + 0.6;
  if (!(d < edge)) return;
  const e = 1;
  let gx = city.shoreDist(t.x + e, t.z) - city.shoreDist(t.x - e, t.z);
  let gz = city.shoreDist(t.x, t.z + e) - city.shoreDist(t.x, t.z - e);
  const gl = Math.sqrt(gx * gx + gz * gz);
  if (!(gl > 1e-9)) return;
  gx /= gl;
  gz /= gl;
  const push = Math.min(edge - d, 4);
  t.x += gx * push;
  t.z += gz * push;
  const vin = t.vx * gx + t.vz * gz;
  if (vin < 0) {
    t.vx -= vin * gx;
    t.vz -= vin * gz;
  }
}

// One fixed step. controls as docs/CRAFT.md (null = nobody aboard: the
// tracks lock). world = { collision, city, ... }.
export function stepTank(t, controls, dt, world) {
  const s = t.spec;
  t.px = t.x;
  t.pz = t.z;
  t.py = t.y;
  t.pheading = t.heading;
  t.ppitch = t.pitch;
  t.proll = t.roll;
  t.pturretYaw = t.turretYaw;
  t.pgunPitch = t.gunPitch;
  t.impact = 0;
  if (!(dt > 0)) return;

  let throttle = 0, brake = 0, steer = 0;
  const live = !t.wrecked && !t.bailed;
  if (controls && live) {
    throttle = clamp(+controls.throttle || 0, 0, 1);
    brake = clamp(+controls.brake || 0, 0, 1);
    steer = clamp(+controls.steer || 0, -1, 1);
  }
  t.throttle = throttle;
  t.brake = brake;
  t.steer = steer;

  const ch = Math.cos(t.heading), sh = Math.sin(t.heading);
  let v = t.vx * ch + t.vz * sh; // along the hull
  let lat = -t.vx * sh + t.vz * ch; // to the right
  const v0 = v;

  // ---- Tracks: forward demand, brake then reverse, coast, parked.
  if (throttle > 0.02 && throttle >= brake) {
    if (v < -0.2) v = approach(v, 0, s.brake * dt);
    else {
      const r = v / s.maxSpeed;
      v += s.accel * throttle * Math.max(0, 1 - r * r) * dt;
      if (v > s.maxSpeed) v = approach(v, s.maxSpeed, s.brake * dt);
    }
  } else if (brake > 0.02) {
    if (v > 0.3) v = approach(v, 0, s.brake * brake * dt);
    else {
      const r = -v / s.reverseSpeed;
      v -= s.accel * 0.8 * brake * Math.max(0, 1 - r * r) * dt;
      if (v < -s.reverseSpeed) v = approach(v, -s.reverseSpeed, s.brake * dt);
    }
  } else {
    // Heavy rolling resistance; nobody aboard (or wrecked) = locked tracks.
    v = approach(v, 0, (controls && live ? 1.6 : s.brake) * dt);
  }
  // Sideways: never slips; only a blast shove remains and bleeds off.
  lat = approach(lat, 0, BLAST_SLIP_DECAY * dt);

  // ---- Hull turn: full rate at rest (pivot), less at speed.
  const sp = Math.min(1, Math.abs(v) / s.maxSpeed);
  const rate = s.turnRate + (s.turnRateFast - s.turnRate) * sp;
  t.yawRate = approach(t.yawRate, steer * rate, YAW_ACCEL * dt);
  t.heading = angleDiff(t.heading + t.yawRate * dt, 0);

  // ---- Velocity back to world along the (turned) hull, then move.
  const ch2 = Math.cos(t.heading), sh2 = Math.sin(t.heading);
  t.vx = ch2 * v - sh2 * lat;
  t.vz = sh2 * v + ch2 * lat;
  t.x += t.vx * dt;
  t.z += t.vz * dt;
  t.y = 0;
  t.vy = 0;

  // ---- Walls (two circles at +-length/4) and the shore.
  let close = 0;
  const col = world && world.collision;
  if (col) {
    const r = s.width / 2, off = s.length / 4;
    for (let pass = 0; pass < 2; pass++) {
      close = Math.max(close, wallCircle(t, col, off, r), wallCircle(t, col, -off, r));
    }
  }
  const city = world && world.city;
  if (city && city.shoreDist) keepOnLand(t, city);
  if (close > 0) {
    t.impact = close;
    // Armored: only a hard crash hurts (ram armor 0.15).
    if (close > 4) t.health = Math.max(0, t.health - (close - 4) * 40 * s.armor.ram);
    if (t.health <= 0) t.wrecked = true;
  }
  const ch3 = Math.cos(t.heading), sh3 = Math.sin(t.heading);
  t.speed = t.vx * ch3 + t.vz * sh3;
  t.lat = -t.vx * sh3 + t.vz * ch3;

  // ---- Tracks for drawing and sound (left = -z side when facing +x).
  const half = s.width / 2;
  t.trackL = t.speed + t.yawRate * half;
  t.trackR = t.speed - t.yawRate * half;
  t.trackPhaseL = (t.trackPhaseL + t.trackL * dt) % PHASE_WRAP;
  t.trackPhaseR = (t.trackPhaseR + t.trackR * dt) % PHASE_WRAP;
  t.trackPhase = (t.trackPhaseL + t.trackPhaseR) * 0.5;

  // ---- Turret and gun slew toward the wanted aim.
  if (t.aimSet && Number.isFinite(t.aimYaw)) {
    const want = angleDiff(t.aimYaw - t.heading, 0);
    const d = angleDiff(want, t.turretYaw);
    const stepY = s.traverse * dt;
    t.turretYaw = angleDiff(t.turretYaw + clamp(d, -stepY, stepY), 0);
  }
  if (t.aimSet && Number.isFinite(t.aimPitch)) {
    const wantP = clamp(t.aimPitch, s.gunPitchMin, s.gunPitchMax);
    t.gunPitch = approach(t.gunPitch, wantP, s.elevRate * dt);
  }
  t.gunPitch = clamp(t.gunPitch, s.gunPitchMin, s.gunPitchMax);
  t.recoil = Math.max(0, t.recoil - 3 * dt);

  // ---- Visual sway: the nose lifts on pulling away, dips on braking.
  const acc = (t.speed - v0) / dt;
  t.swayV += (-acc * 0.006 - t.sway) * 40 * dt - t.swayV * 8 * dt;
  t.sway = clamp(t.sway + t.swayV * dt, -0.05, 0.05);
  t.pitch = t.sway;
  t.roll = clamp(t.yawRate * t.speed * 0.004, -0.03, 0.03);

  // ---- Never let a NaN out.
  if (!Number.isFinite(t.x + t.z + t.heading + t.vx + t.vz + t.yawRate + t.speed)) {
    t.x = t.px; t.z = t.pz; t.heading = t.pheading;
    t.vx = 0; t.vz = 0; t.yawRate = 0; t.speed = 0; t.lat = 0;
  }
  if (!Number.isFinite(t.turretYaw + t.gunPitch + t.pitch + t.roll + t.sway + t.swayV + t.trackPhaseL + t.trackPhaseR + t.recoil)) {
    t.turretYaw = 0; t.gunPitch = 0; t.pitch = 0; t.roll = 0; t.sway = 0; t.swayV = 0;
    t.trackPhaseL = t.trackPhaseR = t.trackPhase = 0; t.recoil = 0;
  }
}

// World yaw of the turret (and the barrel).
export const turretWorldYaw = (t) => angleDiff(t.heading + t.turretYaw, 0);

// Point and unit direction of the barrel (muzzle tip) in world space.
export function barrelRay(t, out) {
  const s = t.spec;
  const ch = Math.cos(t.heading), sh = Math.sin(t.heading);
  const px = t.x + ch * s.turretX, pz = t.z + sh * s.turretX;
  const yaw = t.heading + t.turretYaw;
  const cp = Math.cos(t.gunPitch), spn = Math.sin(t.gunPitch);
  out.dx = Math.cos(yaw) * cp;
  out.dy = spn;
  out.dz = Math.sin(yaw) * cp;
  const L = s.barrelLen * (1 - 0.08 * t.recoil);
  out.x = px + out.dx * L;
  out.y = (t.y || 0) + s.turretY + out.dy * L;
  out.z = pz + out.dz * L;
  out.px = px;
  out.py = (t.y || 0) + s.turretY;
  out.pz = pz;
  return out;
}

// ---- Pair rule ----------------------------------------------------------------
// Body circles: tanks two (r = width/2 at +-length/4), cars three (as
// vehicle.js), anything else one.
const CA = new Float64Array(6), CB = new Float64Array(9);
function circles(c, out) {
  const s = c.spec;
  const ch = Math.cos(c.heading || 0), sh = Math.sin(c.heading || 0);
  if (c.kind === 'tank') {
    const off = s.length / 4;
    out[0] = c.x + ch * off; out[1] = c.z + sh * off; out[2] = s.width / 2;
    out[3] = c.x - ch * off; out[4] = c.z - sh * off; out[5] = s.width / 2;
    return 2;
  }
  if (c.kind === 'car') {
    const r = s.width / 2, half = Math.max(0, s.length / 2 - r);
    for (let i = 0; i < 3; i++) {
      const o = i === 0 ? half : i === 1 ? 0 : -half;
      out[i * 3] = c.x + ch * o; out[i * 3 + 1] = c.z + sh * o; out[i * 3 + 2] = r;
    }
    return 3;
  }
  out[0] = c.x; out[1] = c.z; out[2] = Math.min(c.radius || 2, ((s && s.width) || 3) / 2 + 0.5);
  return 1;
}

// Tank `t` against any other ground craft. Moves both, records ram and
// crush for the armor system (other.crushedBy, other.ramBy / ramV).
// Returns true on contact.
export function collideTank(t, o) {
  if (!o || o === t || o.removed || t.removed) return false;
  if (o.kind === 'boat' || o.kind === 'plane' || o.kind === 'heli') return false;
  if (o.crushed) return false; // flattened: the tank rolls over it
  const dx0 = o.x - t.x, dz0 = o.z - t.z;
  const rr = t.radius + o.radius;
  if (dx0 * dx0 + dz0 * dz0 >= rr * rr) return false;
  const na = circles(t, CA), nb = circles(o, CB);
  let best = 0, bnx = 1, bnz = 0;
  for (let i = 0; i < na; i++) {
    for (let k = 0; k < nb; k++) {
      const dx = CB[k * 3] - CA[i * 3], dz = CB[k * 3 + 1] - CA[i * 3 + 1];
      const rs = CA[i * 3 + 2] + CB[k * 3 + 2];
      const d2 = dx * dx + dz * dz;
      if (d2 >= rs * rs) continue;
      const d = Math.sqrt(d2);
      const depth = rs - d;
      if (depth <= best) continue;
      best = depth;
      if (d > 1e-6) {
        bnx = dx / d;
        bnz = dz / d;
      } else {
        bnx = Math.cos(t.heading);
        bnz = Math.sin(t.heading);
      }
    }
  }
  if (best <= 0) return false;
  const closing = (t.vx - (o.vx || 0)) * bnx + (t.vz - (o.vz || 0)) * bnz; // + = tank driving into it
  const os = o.spec || {};
  const small = o.kind === 'car' && (os.length || 0) < CRUSH_MAX_LEN;
  const fast = Math.abs(t.speed) > CRUSH_SPEED && !t.wrecked;
  o.asleep = false;
  o.meshDirty = true;
  if (small && fast && !o.crushed) {
    // Rolling over it: the car is only partly shoved aside, so the tank
    // climbs on; deep enough and it is flattened.
    if (best > (os.width || 1.8) * 0.5) {
      o.crushedBy = t;
      o.vx *= 0.3;
      o.vz *= 0.3;
      return true;
    }
    o.x += bnx * best * 0.06;
    o.z += bnz * best * 0.06;
  } else if (o.kind === 'tank') {
    // Two tanks: split the separation, equal mass.
    t.x -= bnx * best * 0.5;
    t.z -= bnz * best * 0.5;
    o.x += bnx * best * 0.5;
    o.z += bnz * best * 0.5;
  } else {
    // A heavy push: the other takes the whole separation.
    o.x += bnx * best;
    o.z += bnz * best;
  }
  if (closing > 0) {
    if (o.kind === 'tank') {
      // Equal masses: swap the normal components (a little restitution).
      const j = closing * 0.55;
      t.vx -= bnx * j;
      t.vz -= bnz * j;
      o.vx += bnx * j;
      o.vz += bnz * j;
    } else {
      // Shoved at the tank's speed (a car being rolled over only gets a
      // nudge, so the tank climbs on). The tank loses about 10% of its
      // speed over a typical shove or crush.
      const k = small && fast ? 0 : 1.05;
      o.vx = (o.vx || 0) + bnx * closing * k;
      o.vz = (o.vz || 0) + bnz * closing * k;
      if (closing > 0.5) {
        t.vx *= 0.994;
        t.vz *= 0.994;
      }
      if (typeof o.yawRate === 'number') o.yawRate = clamp(o.yawRate + (bnx * Math.sin(o.heading) - bnz * Math.cos(o.heading)) * closing * 0.08, -3, 3);
    }
    if (closing > 1) {
      o.ramBy = t;
      o.ramV = Math.max(o.ramV || 0, closing);
      if (closing > (o.impact || 0)) o.impact = closing;
      if (closing > t.impact) t.impact = closing;
    }
  }
  return true;
}

export { RAM_PER_MS, CRUSH_SPEED, CRUSH_MAX_LEN };
