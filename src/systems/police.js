// Police: reckless driving (ramming traffic, making pedestrians dive,
// heavy speeding in sight of a patrol car) and violence (docs/COMBAT.md
// "Police": shots near witnesses, hurting people, explosions) raise
// "heat" 0..4. Level 1: a car follows. 2: officers step out when close
// or stopped and shoot pistols. 3: more cars, ramming, SMGs. 4: a
// roadblock ahead. Slip out of sight long enough and they give up; stop
// next to one and you are pulled over (no fine). The owner's
// `settings.police` off means no police at all.
//
// The heat rules (createHeat / updateHeat / updateBust) and the pursuit
// driver (createCop / chaseStep) are pure logic, tested in node.
// createPolice is the game system that spawns cars and officers.
import { lanePoint, lanesPerDirection } from '../world/citygen.js';
import { createVehicle, steerLock } from '../entities/vehicle.js';
import { createDriver, placeDriver, driveStep, LANE_SPEED, edgesAround } from './traffic.js';
import { setVehicleLights } from '../render/vehiclemesh.js';
import { clamp, createRng } from '../core/rng.js';
import { exitPosition } from '../entities/onfoot.js';
import { createPersonMesh, updatePersonMesh } from '../render/personmesh.js';
import { addActor, removeActor, isPlayerSource, isCraft, canBeHit, layDown, damage, setPush, occupantsAlive, HP } from './combat.js';
import {
  createFootActor, placeFootActor, stepFoot, faceToward, aiShoot, hitChance,
  takeSlot, releaseSlot, losRay, playerSpeedOf, playerUp,
} from './crew.js';
import { WEAPONS, selectWeapon } from '../core/weapons.js';
import { fogSightScale } from '../core/weather.js';
import { hasSiren } from '../core/yield.js';
import { spawnPoliceHeli, setOrder as setHeliOrder } from './helipilot.js';
import { createTank, barrelRay } from '../entities/tank.js';
import { createTankUnit, tankDrive, tankGunnerStep } from './armor.js';
import { beginSpawnStep, takeSpawn, spawnsLeft, belowLiveCap, createWarmer, SPAWNER } from '../core/spatial.js';
import { VEHICLE_SPECS } from '../entities/vehicle.js';
import { TANK_SPECS } from '../entities/tank.js';
import { AIRCRAFT_SPECS } from '../entities/aircraft.js';

// --- Heat rules. ---

export const TOWN_LIMIT = 22; // m/s
export const HEAVY_SPEEDING = 6; // m/s over the limit that counts
export const RAM_SPEED = 6; // closing speed (m/s) that counts as ramming
// No star for car contact under 11 mph of relative speed, or for breaking
// props (docs/PLAN_V3.md 2.3 item 6): RAM_SPEED (13.4 mph) is above it, and
// a startled pedestrian counts only with the car at this speed or more.
export const STAR_CONTACT_MPH = 11;
export const STAR_CONTACT = STAR_CONTACT_MPH / 2.23694; // m/s
export const MAX_HEAT = 4;
export const SIGHT = 90; // police see this far, given a clear line
let sightNow = SIGHT; // SIGHT shortened by fog (updated each tick)
export const COOLDOWN = [0, 12, 18, 25, 32]; // seconds out of sight to escape
export const FINE_PER_LEVEL = 60; // legacy helper only: busts no longer fine
export const ESCAPE_REWARD_PER_LEVEL = 500; // score points (MISSIONS.md)
// Violence heat (COMBAT.md "Police").
export const VIOLENCE = {
  shot: 0.3, civHit: 0.6, civDown: 1, officerHit: 1, officerDown: 1.5,
  explosion: 1, craft: 0.7, crewSeen: 0.3,
};
export const WITNESS_DIST = 40;
export const OFFICERS_MAX = 4;
// What each heat level brings. units: patrol cars on the chase; every: seconds
// between spawn attempts (faster response); launch: m/s a new chase car starts
// at (it arrives already moving); pace: top-speed multiplier of chase cars;
// heli: a police helicopter joins (roadblocks come at the top level too).
export const LEVEL_RULES = [
  { units: 0, every: 1.2, launch: 12, pace: 1, heli: false },
  { units: 1, every: 1.2, launch: 12, pace: 1, heli: false },
  { units: 2, every: 1.0, launch: 14, pace: 1.05, heli: false },
  { units: 3, every: 0.8, launch: 17, pace: 1.1, heli: false },
  { units: 4, every: 0.6, launch: 21, pace: 1.16, heli: true },
];
const rulesFor = (level) => LEVEL_RULES[Math.max(0, Math.min(MAX_HEAT, level | 0))];
// Chase cars wanted at a level. `max` is the system's base cap; the top
// level may field one more car than it.
export const unitsFor = (level, max = 3) => Math.min(rulesFor(level).units, max + (level >= MAX_HEAT ? 1 : 0));
// HUD stars 0..5: one per heat level, the fifth once the helicopter is up.
export const wantedStars = (level, heliUp = false) => {
  const l = Math.max(0, Math.min(MAX_HEAT, level | 0));
  return l >= MAX_HEAT && heliUp ? 5 : l;
};
// Heat 5 (the helicopter is up): one police tank rolls in; a wrecked or bailed
// one is replaced after a pause.
export const TANK_DELAY = 8, TANK_REPEAT = 60; // s after the fifth star / after losing a tank
export const TANK_MAX = 1;
const HELI_DELAY = 6, HELI_REPEAT = 30; // s after reaching the top level / after losing a heli
const GRACE = 4; // seconds between level steps
const RAM_POINTS = 1;
const PED_POINTS = 0.5;
const SPEED_DELAY = 3; // seconds of seen speeding before it counts
const SPEED_RATE = 0.15; // points per second after that
const POINT_DECAY = 0.03;
const CALM_TIME = 10;
const BUST_TIME = 2.5;
const BUST_SPEED = 2;
const BUST_DIST_CAR = 7;
const BUST_DIST_FOOT = 5;

export function createHeat() {
  return {
    level: 0,
    ceiling: MAX_HEAT, // the level a street event's heat escape lets it climb to (events.js); MAX_HEAT: no limit
    points: 0, // pending infractions; 1 point = one level step
    calm: 0, // seconds since the last infraction
    grace: 0,
    unseen: 0, // seconds continuously out of sight
    cooldown: 0, // 0..1 progress toward escaping (HUD blink)
    speedTime: 0,
    bustTime: 0,
    escapedLevel: 0, // level of the last escape (for the reward)
  };
}

export function resetHeat(heat, grace = 0) {
  heat.level = 0;
  heat.points = 0;
  heat.calm = 0;
  heat.grace = grace;
  heat.unseen = 0;
  heat.cooldown = 0;
  heat.speedTime = 0;
  heat.bustTime = 0;
  return heat;
}

// One step of the heat rules. Returns 'up' when the level rose,
// 'escaped' (once) when the police lost the player, else null.
// facts: { speeding, crashedTraffic, startledPed, seenByPolice, inCar,
//          atSea, airborne, enabled, violence (heat points this step) }
export function updateHeat(heat, dt, facts) {
  if (!facts || facts.enabled === false) {
    resetHeat(heat);
    return null;
  }
  if (!(dt > 0)) return null;
  if (heat.grace > 0) heat.grace = Math.max(0, heat.grace - dt);
  const away = !!(facts.atSea || facts.airborne);
  const seen = !!facts.seenByPolice && !away;

  let add = 0;
  if (facts.crashedTraffic) add += RAM_POINTS;
  if (facts.startledPed) add += PED_POINTS;
  if (facts.violence > 0 && Number.isFinite(facts.violence)) add += facts.violence;
  const speeding = facts.inCar && !away ? +facts.speeding || 0 : 0;
  if (speeding > HEAVY_SPEEDING && seen) {
    heat.speedTime += dt;
    if (heat.speedTime > SPEED_DELAY) add += SPEED_RATE * dt;
  } else {
    heat.speedTime = Math.max(0, heat.speedTime - dt * 0.5);
  }
  // Pending points fade only after a calm spell.
  if (add > 0) {
    heat.points = Math.min(heat.points + add, heat.level >= MAX_HEAT ? 1 : 1.5);
    heat.calm = 0;
  } else if ((heat.calm += dt) > CALM_TIME) heat.points = Math.max(0, heat.points - POINT_DECAY * dt);

  if (heat.level >= heat.ceiling && heat.points > 0.9) heat.points = 0.9; // at the ceiling: no step up
  if (heat.points >= 1 && heat.grace <= 0 && heat.level < MAX_HEAT) {
    heat.level++;
    heat.points -= 1;
    heat.grace = GRACE;
    heat.unseen = 0;
    heat.cooldown = 0;
    return 'up';
  }
  if (heat.level >= MAX_HEAT && heat.points > 1) heat.points = 1;

  if (heat.level > 0) {
    if (seen) heat.unseen = 0;
    else heat.unseen += dt * (away ? 1.5 : 1);
    const need = COOLDOWN[heat.level];
    heat.cooldown = clamp(heat.unseen / need, 0, 1);
    if (heat.unseen >= need) {
      heat.escapedLevel = heat.level;
      resetHeat(heat, 2);
      return 'escaped';
    }
  } else {
    heat.unseen = 0;
    heat.cooldown = 0;
  }
  return null;
}

// Pulled over? facts: { playerSpeed, copDist (nearest police car center,
// meters), onFoot, inCar }. Returns true on the step the bust happens.
export function updateBust(heat, dt, facts) {
  if (heat.level <= 0 || !facts) {
    heat.bustTime = 0;
    return false;
  }
  const d = facts.copDist;
  if (facts.onFoot) {
    heat.bustTime = 0;
    return d < BUST_DIST_FOOT;
  }
  if (facts.inCar && Math.abs(facts.playerSpeed) < BUST_SPEED && d < BUST_DIST_CAR) {
    heat.bustTime += dt;
    if (heat.bustTime >= BUST_TIME) {
      heat.bustTime = 0;
      return true;
    }
  } else heat.bustTime = 0;
  return false;
}

export function bustFine(level, money) {
  const m = Number.isFinite(money) ? Math.floor(money) : 0;
  return Math.max(0, Math.min(FINE_PER_LEVEL * Math.max(0, level | 0), m));
}

export const escapeReward = (level) => ESCAPE_REWARD_PER_LEVEL * Math.max(0, level | 0);

// Did the player ram `other` hard enough to count? Only traffic and police
// cars count, and only when the player was the faster one into the hit:
// each car's speed toward the other (0.13.5: was each car's whole speed,
// so a patrol car swiping a faster player from the side or behind gave
// the player the heat).
export function isRam(player, other, strength, dt = 1 / 60) {
  if (!player || !other || player === other) return false;
  if (!(other.traffic || other.police)) return false;
  if (!(strength >= RAM_SPEED)) return false;
  let nx = other.x - player.x, nz = other.z - player.z;
  const d = Math.hypot(nx, nz);
  if (!(d > 1e-6)) return false;
  nx /= d; nz /= d;
  const ps = ((player.x - player.px) * nx + (player.z - player.pz) * nz) / dt;
  const os = -((other.x - other.px) * nx + (other.z - other.pz) * nz) / dt;
  return ps >= 4 && ps >= os;
}

// --- Pursuit driver. ---

const ROAD = 1, DIRECT = 2;
const V_AVENUE = 36, V_STREET = 30;
const DECEL = 7;
const TURN_V = 10, UTURN_V = 5;
const DIRECT_IN = 60, DIRECT_OUT = 75;

const otherEnd = (e, from) => (e.a === from ? e.b : e.a);
const LP = { x: 0, z: 0, heading: 0 };

export function createCop(city, rng) {
  return {
    city, rng,
    police: true,
    state: 0,
    e: -1, f: -1, t: -1, n1: -1, n2: -1,
    lane: 0, pass: 0, passTime: 0,
    routeTimer: 0,
    los: false, lostTime: 99, tick: Math.floor(rng.next() * 4),
    side: 1,
    obsGap: Infinity, obsSpeed: 0,
    stuckTime: 0, reverse: 0,
    targetSpeed: 0,
    // Fields traffic drivers read from other cars' `ai`.
    mode: 2, stuck: false, dead: false, obsVeh: null, waitTime: 0, t1: 0, f1: -1,
  };
}

// Edge out of `nodeId` (arriving on `edgeId`) whose far node is closest
// to the target. No U-turns unless it is a dead end.
function pickToward(city, edgeId, nodeId, tx, tz) {
  const n = city.nodes[nodeId];
  if (n.edges.length <= 1) return edgeId;
  let best = Infinity, be = edgeId;
  for (let i = 0; i < n.edges.length; i++) {
    const id = n.edges[i];
    if (id === edgeId) continue;
    const far = city.nodes[otherEnd(city.edges[id], nodeId)];
    const d = Math.hypot(far.x - tx, far.z - tz);
    if (d < best) {
      best = d;
      be = id;
    }
  }
  return be;
}

function segDist(city, e, x, z) {
  const a = city.nodes[e.a], b = city.nodes[e.b];
  const ux = (b.x - a.x) / e.length, uz = (b.z - a.z) / e.length;
  const t = clamp((x - a.x) * ux + (z - a.z) * uz, 0, e.length);
  return Math.hypot(a.x + ux * t - x, a.z + uz * t - z);
}

const byId = (a, b) => a - b;

function attach(cop, v, tx, tz) {
  const city = cop.city;
  let best = Infinity, be = -1;
  // A real map: only the edges near the car (its edge grid).
  const ids = edgesAround(city, v.x, v.z, 60);
  const n = ids ? ids.length : city.edges.length;
  for (let j = 0; j < n; j++) {
    const i = ids ? ids[j] : j;
    const d = segDist(city, city.edges[i], v.x, v.z);
    if (d < best) {
      best = d;
      be = i;
    }
  }
  const e = city.edges[be];
  const a = city.nodes[e.a], b = city.nodes[e.b];
  const ux = (b.x - a.x) / e.length, uz = (b.z - a.z) / e.length;
  const dot = Math.cos(v.heading) * ux + Math.sin(v.heading) * uz;
  let from;
  if (Math.abs(v.speed) > 4) from = (dot >= 0) === (v.speed >= 0) ? e.a : e.b;
  else {
    const ca = Math.hypot(b.x - tx, b.z - tz) + (dot < 0 ? 40 : 0);
    const cb = Math.hypot(a.x - tx, a.z - tz) + (dot > 0 ? 40 : 0);
    from = ca <= cb ? e.a : e.b;
  }
  cop.e = be;
  cop.f = from;
  cop.t = otherEnd(e, from);
  cop.n1 = pickToward(city, be, cop.t, tx, tz);
  cop.n2 = pickToward(city, cop.n1, otherEnd(city.edges[cop.n1], cop.t), tx, tz);
  cop.lane = 0;
  cop.state = ROAD;
}

function cornerSpeed(city, ea, fa, eb, fb, vNext) {
  if (ea === eb) return UTURN_V;
  const A = city.edges[ea], B = city.edges[eb];
  const a0 = city.nodes[fa], a1 = city.nodes[otherEnd(A, fa)];
  const b0 = city.nodes[fb], b1 = city.nodes[otherEnd(B, fb)];
  const dot = ((a1.x - a0.x) * (b1.x - b0.x) + (a1.z - a0.z) * (b1.z - b0.z)) / (A.length * B.length);
  if (dot > 0.7) return vNext;
  if (dot < -0.7) return UTURN_V;
  return TURN_V;
}

const vmaxOf = (e) => (e.avenue || e.causeway ? V_AVENUE : V_STREET);

// Road following: sets AIM to a look-ahead point on the route and
// AIM.vt to the speed planned for the next corners.
const AIM = { x: 0, z: 0, vt: 0 };
function roadAim(cop, v, dt, tx, tz) {
  const city = cop.city;
  let E = city.edges[cop.e];
  let F = city.nodes[cop.f], T = city.nodes[cop.t];
  let ux = (T.x - F.x) / E.length, uz = (T.z - F.z) / E.length;
  let d = (v.x - F.x) * ux + (v.z - F.z) * uz;
  const lat = (v.x - F.x) * -uz + (v.z - F.z) * ux;
  if (Math.abs(lat) > 14 || d < -15 || d > E.length + 25) {
    attach(cop, v, tx, tz);
    return roadAim2(cop, v);
  }
  // Onto the next edge once nearer to it than to this one.
  if (d > E.length - 30) {
    const N = city.edges[cop.n1];
    const advanceNow = cop.n1 === cop.e ? d > E.length - 8 : segDist(city, N, v.x, v.z) < segDist(city, E, v.x, v.z);
    if (advanceNow) {
      const far = otherEnd(N, cop.t);
      cop.e = cop.n1;
      cop.f = cop.t;
      cop.t = far;
      cop.n1 = cop.n2;
      cop.n2 = pickToward(city, cop.n1, otherEnd(city.edges[cop.n1], cop.t), tx, tz);
      if (cop.passTime <= 0) cop.lane = 0;
      E = city.edges[cop.e];
      F = city.nodes[cop.f];
      T = city.nodes[cop.t];
      ux = (T.x - F.x) / E.length;
      uz = (T.z - F.z) / E.length;
      d = (v.x - F.x) * ux + (v.z - F.z) * uz;
    }
  }
  // Re-plan the turns ahead while there is still room to brake.
  const sp = Math.max(0, v.speed);
  const distT = E.length - d;
  cop.routeTimer -= dt;
  if (cop.routeTimer <= 0) {
    cop.routeTimer = 0.5;
    if (distT > (sp * sp) / (2 * DECEL) + 10) cop.n1 = pickToward(city, cop.e, cop.t, tx, tz);
    cop.n2 = pickToward(city, cop.n1, otherEnd(city.edges[cop.n1], cop.t), tx, tz);
  }
  return roadAim2(cop, v);
}

function roadAim2(cop, v) {
  const city = cop.city;
  const E = city.edges[cop.e];
  const F = city.nodes[cop.f], T = city.nodes[cop.t];
  const ux = (T.x - F.x) / E.length, uz = (T.z - F.z) / E.length;
  const d = (v.x - F.x) * ux + (v.z - F.z) * uz;
  const sp = Math.max(0, v.speed);
  const N = city.edges[cop.n1];
  const far1 = otherEnd(N, cop.t);
  const L = clamp(6 + 0.45 * sp, 7, 20);
  const lane = Math.min(cop.lane, lanesPerDirection(E) - 1);
  if (d + L <= E.length) {
    lanePoint(city, E, cop.f, d + L, lane, LP);
    AIM.x = LP.x - uz * cop.pass;
    AIM.z = LP.z + ux * cop.pass;
  } else {
    const lane1 = Math.min(cop.lane, lanesPerDirection(N) - 1);
    lanePoint(city, N, cop.t, d + L - E.length, lane1, LP);
    const gx = Math.cos(LP.heading), gz = Math.sin(LP.heading);
    AIM.x = LP.x - gz * cop.pass;
    AIM.z = LP.z + gx * cop.pass;
  }
  const distT = E.length - d;
  let vt = vmaxOf(E);
  const c1 = cornerSpeed(city, cop.e, cop.f, cop.n1, cop.t, vmaxOf(N));
  vt = Math.min(vt, Math.sqrt(c1 * c1 + 2 * DECEL * Math.max(0, distT - 4)));
  const N2 = city.edges[cop.n2];
  const c2 = cornerSpeed(city, cop.n1, cop.t, cop.n2, far1, vmaxOf(N2));
  vt = Math.min(vt, Math.sqrt(c2 * c2 + 2 * DECEL * Math.max(0, distT + N.length - 4)));
  AIM.vt = vt;
  return AIM;
}

// Nearest vehicle ahead in the car's path (not the target).
function scanAhead(cop, v, target, vehicles) {
  const ch = Math.cos(v.heading), sh = Math.sin(v.heading);
  const sp = Math.max(0, v.speed);
  const range = Math.min(60, 12 + sp * 1.5);
  let gap = Infinity, gs = 0;
  for (let i = 0; i < vehicles.length; i++) {
    const o = vehicles[i];
    if (o === v || o === target || o.removed || (o.y || 0) > 2.5 || o.kind === 'plane' || o.kind === 'heli') continue;
    const rx = o.x - v.x, rz = o.z - v.z;
    const lx = rx * ch + rz * sh;
    if (lx <= 0 || lx > range + 6) continue;
    const ly = -rx * sh + rz * ch;
    const ow = o.spec ? o.spec.width : 2, ol = o.spec ? o.spec.length : 4;
    if (Math.abs(ly) > ow / 2 + v.spec.width / 2 + 0.5) continue;
    const g = lx - v.spec.length / 2 - ol / 2;
    if (g < gap) {
      gap = g;
      gs = (o.vx || 0) * ch + (o.vz || 0) * sh;
    }
  }
  cop.obsGap = gap;
  cop.obsSpeed = gs;
}

function wideClear(col, x0, z0, x1, z1, w) {
  const d = Math.hypot(x1 - x0, z1 - z0);
  if (d < 1e-6) return true;
  const ox = (-(z1 - z0) / d) * w, oz = ((x1 - x0) / d) * w;
  return col.lineClear(x0, z0, x1, z1) && col.lineClear(x0 + ox, z0 + oz, x1 + ox, z1 + oz) &&
    col.lineClear(x0 - ox, z0 - oz, x1 - ox, z1 - oz);
}

// Fill v.controls for one step of chasing `target` (any craft or the
// player on foot: { x, z, vx, vz, heading, spec?, y? }).
// ctx: { collision, vehicles, time }.
export function chaseStep(cop, v, dt, target, ctx = {}) {
  let c = v.controls;
  if (!c) c = v.controls = { steer: 0, throttle: 0, brake: 0, handbrake: false };
  if (v.wrecked || !target) {
    c.steer = 0;
    c.throttle = 0;
    c.brake = 0;
    c.handbrake = true;
    return c;
  }
  const col = ctx.collision;
  const sp = v.speed;
  const tx = target.x, tz = target.z;
  const dist = Math.hypot(tx - v.x, tz - v.z);
  const ch = Math.cos(v.heading), sh = Math.sin(v.heading);

  if (cop.tick % 4 === 0) {
    // A car-wide clear line, not just a sight line, so it never cuts
    // across a building corner.
    cop.los = dist < sightNow && (target.y || 0) < 4 && (!col || wideClear(col, v.x, v.z, tx, tz, 1.2));
  }
  if (cop.tick % 3 === 0 && ctx.vehicles) scanAhead(cop, v, target, ctx.vehicles);
  else if (cop.obsGap < Infinity) cop.obsGap -= (sp - cop.obsSpeed) * dt;
  cop.tick++;
  if (cop.los) cop.lostTime = 0;
  else cop.lostTime += dt;

  const direct = cop.lostTime < 1 && dist < (cop.state === DIRECT ? DIRECT_OUT : DIRECT_IN);
  // Heat 3: some cars ram a target craft instead of boxing it in.
  const ram = !!cop.ram && direct && !!target.spec;
  let ax, az, vt;
  const tvx = target.vx || 0, tvz = target.vz || 0;
  const tsp = Math.hypot(tvx, tvz);
  const tw = target.spec ? target.spec.width : 0.8;
  const tl = target.spec ? target.spec.length : 0.8;
  if (direct) {
    cop.state = DIRECT;
    cop.pass = 0;
    cop.passTime = 0;
    let hx, hz;
    if (tsp > 1) {
      hx = tvx / tsp;
      hz = tvz / tsp;
    } else {
      hx = Math.cos(target.heading || 0);
      hz = Math.sin(target.heading || 0);
    }
    const rx = -hz, rz = hx;
    // Slot beside the target: keep to the side the car is already on.
    const relLat = (v.x - tx) * rx + (v.z - tz) * rz;
    if (Math.abs(relLat) > 2 && (relLat > 0 ? 1 : -1) !== cop.side) cop.side = -cop.side;
    let off = tw / 2 + v.spec.width / 2 + 1.3;
    if (col && cop.tick % 4 === 1) {
      if (col.raycast(tx, tz, rx * cop.side, rz * cop.side, off + 1.5) < off + 1.2) {
        cop.side = -cop.side;
        if (col.raycast(tx, tz, rx * cop.side, rz * cop.side, off + 1.5) < off + 1.2) cop.blocked = true;
        else cop.blocked = false;
      } else cop.blocked = false;
    }
    const blend = clamp((28 - dist) / 14, 0, 1);
    let back = 0;
    if (ram) off = 0;
    if (cop.blocked && !ram) {
      off = 0;
      back = tl / 2 + v.spec.length / 2 + 2.5; // no room beside: wait behind
    }
    const lead = clamp(dist / 30, 0, 1);
    const sx = tx + tvx * lead * (1 - blend) + (rx * cop.side * off - hx * back) * blend;
    const sz = tz + tvz * lead * (1 - blend) + (rz * cop.side * off - hz * back) * blend;
    const ahead = tsp > 1.5 ? 1 + 0.3 * tsp : 0;
    ax = sx + hx * ahead;
    az = sz + hz * ahead;
    const da = Math.hypot(sx - v.x, sz - v.z);
    if (ram) {
      ax = tx + tvx * 0.25;
      az = tz + tvz * 0.25;
      vt = Math.max(tsp + 9, 14);
    } else if (tsp < 1.5) {
      vt = Math.min(V_STREET, Math.sqrt(2 * 5 * Math.max(0, da - 0.8)));
      if (da < 2) {
        ax = v.x + ch * 5;
        az = v.z + sh * 5;
      }
    } else {
      const behind = (sx - v.x) * hx + (sz - v.z) * hz;
      vt = tsp + clamp(behind * 0.6, -6, 14);
    }
  } else {
    if (cop.state !== ROAD || cop.e < 0) attach(cop, v, tx, tz);
    roadAim(cop, v, dt, tx, tz);
    ax = AIM.x;
    az = AIM.z;
    vt = AIM.vt;
    // Overtake slower cars: change lane, or use the other side of a street.
    if (cop.obsGap < 30 && cop.obsSpeed < Math.max(0, sp) - 1 && cop.passTime <= 0) {
      const E = cop.city.edges[cop.e];
      if (lanesPerDirection(E) > 1) cop.lane = 1 - cop.lane;
      else cop.passTarget = -4;
      cop.passTime = 3;
    }
    if (cop.passTime > 0) cop.passTime -= dt;
    else cop.passTarget = 0;
    const pt = cop.passTarget || 0;
    cop.pass += clamp(pt - cop.pass, -4 * dt, 4 * dt);
  }
  vt = Math.min(vt * (cop.pace || 1), V_AVENUE);

  // Never ram the target (unless told to): hold back when it is right in front.
  if (!ram) {
    const rx = tx - v.x, rz = tz - v.z;
    const lx = rx * ch + rz * sh, ly = -rx * sh + rz * ch;
    if (lx > 0 && Math.abs(ly) < tw / 2 + v.spec.width / 2 + 0.6) {
      const gap = lx - v.spec.length / 2 - tl / 2;
      const along = Math.max(0, tvx * ch + tvz * sh);
      vt = Math.min(vt, along + Math.max(0, gap - 1.5) * 0.9);
    }
  }
  // Other cars ahead.
  if (cop.obsGap < Infinity) {
    const u = Math.max(0, cop.obsSpeed);
    vt = Math.min(vt, u + Math.max(0, cop.obsGap - 3) * 0.9);
  }

  // Steering: pure pursuit toward the aim point.
  const dx = ax - v.x, dz = az - v.z;
  const lx = dx * ch + dz * sh;
  const ly = -dx * sh + dz * ch;
  const spec = v.spec;
  const maxAng = steerLock(spec, sp);
  let steer;
  if (lx < 0.5) steer = ly >= 0 ? 1 : -1;
  else steer = Math.atan(((2 * ly) / (lx * lx + ly * ly)) * spec.wheelBase) / maxAng;
  const cosA = lx / (Math.hypot(lx, ly) || 1);
  vt = Math.min(vt, 5 + 31 * Math.max(0, cosA) * Math.max(0, cosA));

  const want = vt;
  // Feelers: ease off and steer away from walls.
  if (col) {
    const asp = Math.abs(sp);
    const fl = Math.min(45, 4 + asp * 1.2);
    const fwd = col.raycast(v.x, v.z, ch, sh, fl);
    if (fwd < fl) vt = Math.min(vt, Math.sqrt(2 * 8 * Math.max(0, fwd - 3.5)));
    const sl = Math.min(18, 3 + asp * 0.5);
    const a = 0.45, ca = Math.cos(a), sa = Math.sin(a);
    const lh = col.raycast(v.x, v.z, ch * ca + sh * sa, sh * ca - ch * sa, sl);
    const rh = col.raycast(v.x, v.z, ch * ca - sh * sa, sh * ca + ch * sa, sl);
    const push = (sl - lh) / sl - (sl - rh) / sl;
    steer += push * (direct ? 0.7 : 0.35);
  }
  steer = clamp(steer, -1, 1);
  if (!Number.isFinite(steer)) steer = 0;
  if (!Number.isFinite(vt)) vt = 0;
  cop.targetSpeed = vt;

  // Stuck against something: back up for a moment and try again.
  if (cop.reverse <= 0) {
    if (want > 2.5 && Math.abs(sp) < 1.2) cop.stuckTime += dt;
    else cop.stuckTime = Math.max(0, cop.stuckTime - 2 * dt);
    if (cop.stuckTime >= 2) {
      cop.stuckTime = 0;
      cop.reverse = 1.5;
    }
  }
  c.throttle = 0;
  c.brake = 0;
  c.handbrake = false;
  if (cop.reverse > 0) {
    cop.reverse -= dt;
    c.steer = -steer;
    c.brake = sp > 0.8 ? 1 : 0.8;
    if (cop.reverse <= 0) cop.state = 0; // re-plan from where it ends up
    return c;
  }
  c.steer = steer;
  const err = vt - sp;
  if (vt < 0.3 && sp < 1) c.handbrake = true;
  else if (err > 0.05) c.throttle = clamp(err * 0.5, 0, 1);
  else if (err < -0.5) {
    if (sp > 1) c.brake = clamp(-err * 0.3, 0, 1);
    else c.handbrake = true;
  }
  return c;
}

// --- The game system. ---

const SPAWN_MIN = 120, SPAWN_MAX = 200;
const PATROL_DESPAWN = 280, CHASE_DESPAWN = 320;
const LEAVE_GONE = 130;
const CLEARANCE = 12;
const PATROL_DELAY = 10; // seconds after a chase before a patrol returns
const BODIES_MAX = 4;
const STEP_OUT = 22, STEP_OUT_BLOCK = 35; // officers get out this close
const OUT_COOL = 8; // seconds after re-boarding before stepping out again
const BLOCK_COOL = 20; // seconds between roadblocks
const BLOCK_MIN = 100, BLOCK_MAX = 190;
const OFFICER_THINK = 0.2;
const extAt = (node, e) => (e.horizontal ? node.hx : node.hz);
const OFFICER_LOOK = { shirt: 0x26406b, trousers: 0x1a2233, skin: 0xb98060, hair: 0x22180f };

export function createPolice(game, { max = 3, seed = 27044 } = {}) {
  const city = game.city;
  const heat = createHeat();
  const orng = createRng(seed); // officers' own dice (deterministic)
  const cars = []; // managed police vehicles (v.role: 'patrol' | 'chase' | 'out' | 'block' | 'leave')
  const near = [];
  const facts = {
    speeding: 0, crashedTraffic: false, startledPed: false, seenByPolice: false,
    inCar: false, atSea: false, airborne: false, enabled: true, violence: 0,
  };
  const bustFacts = { playerSpeed: 0, copDist: Infinity, onFoot: false, inCar: false };
  const trafficCtx = { time: 0, vehicles: game.vehicles };
  const chaseCtx = { collision: game.collision, vehicles: game.vehicles, time: 0 };
  const footTarget = { x: 0, z: 0, vx: 0, vz: 0, heading: 0, y: 0, spec: null };
  const officers = [];
  // Bodies of officers killed inside a car: a small pool of lying actors.
  const bodies = [];
  for (let i = 0; i < BODIES_MAX; i++) {
    const b = createFootActor('police', orng, 'pistol');
    b.car = null;
    bodies.push(b);
  }
  for (let i = 0; i < OFFICERS_MAX; i++) {
    const o = createFootActor('police', orng, 'pistol');
    o.car = null;
    officers.push(o);
  }
  const EXIT = { x: 0, z: 0, ok: false };
  let crashed = false, startled = false, pedCool = 0;
  let nearTimer = 0, spawnTimer = 0, patrolDelay = 3, seenTick = 0;
  let sirenOn = false, wasEnabled = true;
  let violence = 0, lastShotStamp = NaN, officerSees = false;
  let blockCool = 0, stepTick = 0, enabledNow = true;
  let heliPilot = null, heliWait = HELI_DELAY;
  let renders = 0, prebuilt = 0;
  function callOffHeli() {
    if (heliPilot && heliPilot.state !== 'done' && heliPilot.state !== 'crash') setHeliOrder(heliPilot, 'leave');
    heliPilot = null;
    heliWait = HELI_DELAY;
  }
  // The police car, tank and helicopter meshes are built in the first
  // seconds of play, so the first chase, tank or helicopter is no hitch.
  const warmer = createWarmer([
    ['car', VEHICLE_SPECS.police],
    ['tank', TANK_SPECS.rustbackpolice],
    ['heli', AIRCRAFT_SPECS.patrolheli],
  ], 6, 5);
  const stats = { officerShots: 0, officerHits: 0, roadblocks: 0, stepOuts: 0, blockFail: '', tanks: 0, tankShells: 0 };

  // --- The heat 5 police tank (existing tank, armor and combat code). ---
  let tankWait = TANK_DELAY, tankUnit = null, tankLeave = 0;
  const tankBR = { x: 0, y: 0, z: 0, dx: 0, dy: 0, dz: 0, px: 0, py: 0, pz: 0 };
  const tankCtx = { collision: null, onFoot: false, hurtBy: false, seaY: -0.6 };
  const tankDriver = { dead: false, police: true };
  const tankOld = []; // retired or wrecked police tanks, removed once far away
  function retireTank(t) {
    if (t.driver === tankDriver) t.driver = null;
    t.controls = null;
    t.police = false;
    tankOld.push(t);
  }
  function dropTank(remove) {
    const t = tankUnit && tankUnit.t;
    tankUnit = null;
    if (!t) return;
    if (remove) game.removeVehicle(t);
    else retireTank(t);
  }
  function spawnTank() {
    if (!near.length) return null;
    const p = game.player, rng = game.rng, col = game.collision;
    let best = -Infinity, bx = 0, bz = 0, bh = 0;
    for (let k = 0; k < 12; k++) {
      const e = city.edges[near[rng.int(0, near.length - 1)]];
      const from = rng.next() < 0.5 ? e.a : e.b;
      const d0 = extAt(city.nodes[from], e) + 12, d1 = e.length - extAt(city.nodes[otherEnd(e, from)], e) - 18;
      if (d1 <= d0) continue;
      lanePoint(city, e, from, rng.range(d0, d1), 0, LP);
      const dist = Math.hypot(LP.x - p.x, LP.z - p.z);
      if (dist < SPAWN_MIN || dist > SPAWN_MAX || !spotClear(LP.x, LP.z, CLEARANCE + 6)) continue;
      const hidden = col && col.lineClear ? !col.lineClear(p.x, p.z, LP.x, LP.z) : false;
      const score = (hidden ? 2 : 0) + rng.next() * 0.3;
      if (score > best) {
        best = score;
        bx = LP.x; bz = LP.z; bh = LP.heading;
      }
    }
    if (best === -Infinity || !takeSpawn(game)) return null;
    const t = createTank('rustbackpolice', bx, bz, bh, game.rng);
    t.police = true;
    t.role = 'tank';
    t.driver = tankDriver;
    t.controls = { steer: 0, throttle: 0, brake: 0, handbrake: false };
    t.asleep = false;
    t.occupantTeam = 'police';
    game.addVehicle(t);
    tankUnit = { t, u: createTankUnit(), shot: 0 };
    stats.tanks++;
    return t;
  }
  // One step of the police tank: roll toward the player, aim, shoot.
  function stepTankUnit(dt, want, idle) {
    const p = game.player;
    if (tankUnit) {
      const t = tankUnit.t;
      if (t.removed || t.wrecked || t.bailed) {
        if (!t.removed) retireTank(t);
        tankUnit = null;
        tankWait = TANK_REPEAT;
      } else if (!want) {
        // Heat dropped: it stops and is taken away once out of sight.
        hold(t.controls);
        tankLeave += dt;
        if (tankLeave > 8 || Math.hypot(t.x - p.x, t.z - p.z) > 150) {
          dropTank(true);
          tankLeave = 0;
          tankWait = TANK_DELAY;
        }
      } else if (idle) hold(t.controls);
      else {
        tankLeave = 0;
        const pv = p.vehicle;
        const target = pv && !pv.removed ? pv : p.walker;
        tankDrive(tankUnit.u, t, p.x, p.z, dt, t.controls);
        tankCtx.collision = game.collision;
        tankCtx.onFoot = !pv;
        tankCtx.seaY = Number.isFinite(game.seaY) ? game.seaY : -0.6;
        const ev = tankGunnerStep(tankUnit.u.g, t, target, tankCtx, dt);
        if (ev === 'aim') {
          if (game.armor && game.armor.telegraph) game.armor.telegraph(t, target);
        } else if (ev === 'fire' && game.combat && game.combat.fireMount) {
          barrelRay(t, tankBR);
          if (game.combat.fireMount(t, 0, tankBR.dx, tankBR.dy, tankBR.dz, null, target)) stats.tankShells++;
        }
      }
    } else if (want && !idle) {
      tankWait -= dt;
      if (tankWait <= 0 && spawnsLeft(game) > 0) {
        if (spawnTank()) tankWait = TANK_REPEAT;
        else tankWait = 1;
      }
    } else tankWait = Math.max(tankWait, want ? 0 : TANK_DELAY);
    for (let i = tankOld.length - 1; i >= 0; i--) {
      const t = tankOld[i];
      if (t.removed) tankOld.splice(i, 1);
      else if (Math.hypot(t.x - p.x, t.z - p.z) > 150) {
        game.removeVehicle(t);
        tankOld.splice(i, 1);
      }
    }
  }

  // --- Witnesses for violence heat. ---
  function civNear(x, z, r) {
    const actors = game.actors;
    if (!actors) return false;
    const r2 = r * r;
    for (let i = 0; i < actors.length; i++) {
      const a = actors[i];
      if (a.team !== 'civ' || !canBeHit(a)) continue;
      const dx = a.x - x, dz = a.z - z;
      if (dx * dx + dz * dz < r2) return true;
    }
    return false;
  }
  const policeSee = () => facts.seenByPolice || officerSees;
  const witnessed = (x, z) => policeSee() || civNear(x, z, WITNESS_DIST);

  const ev = game.events;
  if (ev && ev.on) {
    ev.on('vehicleCrash', (a, b, strength) => {
      const pv = game.player.vehicle;
      if (!pv || pv.kind !== 'car') return;
      const other = a === pv ? b : b === pv ? a : null;
      if (other && isRam(pv, other, strength)) crashed = true;
    });
    ev.on('pedStartled', (ped) => {
      const p = game.player, pv = p.vehicle;
      if (!pv || pv.kind !== 'car' || Math.abs(pv.speed) < STAR_CONTACT || !ped) return;
      if (Math.hypot(ped.x - p.x, ped.z - p.z) < 16 && pedCool <= 0) {
        startled = true;
        pedCool = 1.5;
      }
    });
    ev.on('shot', (s) => {
      if (!enabledNow || !s || !isPlayerSource(game, s.shooter)) return;
      if (lastShotStamp === game.time) return; // one trigger pull (pellets) counts once
      lastShotStamp = game.time;
      if (witnessed(s.x, s.z)) violence += VIOLENCE.shot;
    });
    ev.on('hit', (h) => {
      if (!enabledNow || !h || !h.target || !isPlayerSource(game, h.source)) return;
      const t = h.target;
      if (t.team === 'civ') violence += VIOLENCE.civHit;
      else if (t.team === 'police') violence += VIOLENCE.officerHit;
      else if (t.team === 'crew' && policeSee()) violence += VIOLENCE.crewSeen;
    });
    ev.on('down', (d) => {
      if (!enabledNow || !d || !d.target || !isPlayerSource(game, d.source)) return;
      if (d.target.team === 'civ') violence += VIOLENCE.civDown;
      else if (d.target.team === 'police') violence += VIOLENCE.officerDown;
    });
    ev.on('down', (d) => {
      const t = d && d.target;
      if (t && t.team === 'police' && t.hp <= 0 && t.car && t.state !== 'dead') seatLost(t);
    });
    ev.on('explosion', (e) => {
      if (!enabledNow || !e || !isPlayerSource(game, e.source)) return;
      if (witnessed(e.x, e.z)) violence += VIOLENCE.explosion;
    });
    ev.on('takedown', (t) => {
      if (!enabledNow || !t || !isCraft(t.target)) return;
      if (witnessed(t.target.x, t.target.z)) violence += VIOLENCE.craft;
    });
  }

  // --- Officers on foot. ---
  function freeOfficer() {
    for (let i = 0; i < officers.length; i++) if (!officers[i].active) return officers[i];
    return null;
  }
  function officersOut() {
    let n = 0;
    for (let i = 0; i < officers.length; i++) if (officers[i].active) n++;
    return n;
  }

  function stepOut(v) {
    let n = 0;
    const seats = v.occ ? occupantsAlive(v) - (v.officers || 0) : 2;
    for (let k = 0; k < 2 && k < seats; k++) {
      const o = freeOfficer();
      if (!o) break;
      exitPosition(v, game.world || { collision: game.collision, city }, EXIT);
      const side = k === 0 ? 1 : -1;
      const h = v.heading;
      let x = EXIT.ok ? EXIT.x : v.x - Math.sin(h) * 2;
      let z = EXIT.ok ? EXIT.z : v.z + Math.cos(h) * 2;
      if (k === 1) {
        // The other side of the car.
        x = 2 * v.x - x;
        z = 2 * v.z - z;
        if (game.collision && game.collision.resolveCircle(x, z, 0.4, 0).hit) {
          x = v.x - Math.cos(h) * (v.spec.length / 2 + 0.8);
          z = v.z - Math.sin(h) * (v.spec.length / 2 + 0.8);
        }
      }
      placeFootActor(o, x, z, h + side * 1.2);
      if (game.actors && !addActor(game, o)) break;
      const wpn = heat.level >= 3 ? 'smg' : 'pistol';
      selectWeapon(o.arms, wpn);
      o.arms.mag[wpn] = WEAPONS[wpn].mag;
      o.active = true;
      o.car = v;
      o.seatNo = k;
      o.state = 'fight';
      o.think = (k * OFFICER_THINK) / 2;
      n++;
    }
    if (n) {
      v.officers = (v.officers || 0) + n;
      stats.stepOuts++;
    }
    return n;
  }

  // --- Officers inside cars: hurt through the car (combat.js occupants). ---
  function crewUp(v) {
    v.occ = [HP.police, HP.police];
    v.occDown = occDown;
    v.copsDead = false;
  }
  function freeBody() {
    let old = null;
    for (let i = 0; i < bodies.length; i++) {
      const b = bodies[i];
      if (!b.active) return b;
      if (!old || b.lifeT > old.lifeT) old = b;
    }
    releaseBody(old);
    return old;
  }
  function releaseBody(b) {
    removeActor(game, b);
    b.active = false;
    b.car = null;
    if (b.mesh) b.mesh.visible = false;
  }
  // A seat died: the officer falls out beside the car, dead (blood, heat,
  // score all come from the normal down event).
  function occDown(v, seat, source, kind) {
    const b = freeBody();
    if (v.spec && v.spec.width && (v.y || 0) < 3) exitPosition(v, game.world || { collision: game.collision, city }, EXIT);
    else EXIT.ok = false;
    let x = EXIT.ok ? EXIT.x : v.x - Math.sin(v.heading) * 2;
    let z = EXIT.ok ? EXIT.z : v.z + Math.cos(v.heading) * 2;
    if (seat % 2 === 1) {
      x = 2 * v.x - x;
      z = 2 * v.z - z;
    }
    placeFootActor(b, x, z, v.heading + 1.2);
    b.active = true;
    b.car = v;
    b.seatNo = seat;
    b.state = 'dead';
    addActor(game, b);
    const dx = b.x - v.x, dz = b.z - v.z;
    const d = Math.hypot(dx, dz) || 1;
    const push = kind === 'blast' ? 7 : 2;
    setPush((dx / d) * push, (dz / d) * push);
    damage(game, b, 999, source, kind === 'ram' ? 'bullet' : kind);
  }
  // An officer on foot died: that seat of his car is empty for good.
  function seatLost(o) {
    const v = o.car;
    if (!v || !v.occ) return;
    const k = o.seatNo;
    if (k >= 0 && v.occ[k] > 0) v.occ[k] = 0;
    else for (let i = 0; i < v.occ.length; i++) if (v.occ[i] > 0) { v.occ[i] = 0; break; }
  }

  function freeOfficerActor(o) {
    releaseSlot(game, o);
    removeActor(game, o);
    o.active = false;
    if (o.car) o.car.officers = Math.max(0, (o.car.officers || 0) - 1);
    o.car = null;
    if (o.mesh) o.mesh.visible = false;
  }

  function thinkOfficer(o) {
    const p = game.player;
    const dx = p.x - o.x, dz = p.z - o.z;
    const d = Math.sqrt(dx * dx + dz * dz);
    if (d < sightNow && (p.y || 0) < 6) {
      const r = losRay(game, o.x, o.z, p.x, p.z);
      if (r >= 0) o.los = r === 1;
    } else o.los = false;
    if (o.los) {
      o.lastSeen = 0;
      o.seenX = p.x;
      o.seenZ = p.z;
    }
    const v = o.car;
    const fast = p.vehicle && Math.abs(p.vehicle.speed) > 8 && d > 30;
    if (heat.level < 2 || !playerUp(game) || fast || d > 90 || !v || v.removed) o.state = 'return';
    if (o.state === 'return') {
      o.shooting = false;
      releaseSlot(game, o);
      if (!v || v.removed) {
        o.moveV = 0;
        return;
      }
      o.tx = v.x;
      o.tz = v.z;
      o.moveV = 4.2;
      return;
    }
    const want = heat.level >= 3 ? 14 : 9;
    if (!o.los || d > want + 4) {
      o.tx = o.lastSeen < 5 ? o.seenX : p.x;
      o.tz = o.lastSeen < 5 ? o.seenZ : p.z;
      o.moveV = 4.2;
    } else if (d < want - 3) {
      o.tx = o.x - (dx / d) * 3;
      o.tz = o.z - (dz / d) * 3;
      o.moveV = 2;
    } else o.moveV = 0;
    const w = WEAPONS[o.arms.weapon];
    if (!o.shooting && o.los && d < w.range && o.burstCool <= 0 && takeSlot(game, o, game.time, 3)) {
      o.shooting = true;
      o.burst = 3 + Math.floor(orng.next() * 3);
    }
  }

  function stepOfficer(o, dt) {
    if (o.lastSeen < 99) o.lastSeen += dt;
    if (o.burstCool > 0) o.burstCool -= dt;
    if (o.life !== 'ok') {
      o.shooting = false;
      o.aimT = 0;
      releaseSlot(game, o);
      o.px = o.x;
      o.pz = o.z;
      if (o.fade >= 1) freeOfficerActor(o);
      return;
    }
    o.think -= dt;
    if (o.think <= 0) {
      o.think += OFFICER_THINK;
      thinkOfficer(o);
    }
    stepFoot(game, o, dt);
    const p = game.player;
    if (o.state === 'return') {
      const v = o.car;
      if (!v || v.removed || Math.hypot(v.x - o.x, v.z - o.z) < (v.radius || 2) * 0.7 + 1.3 || o.stuckT > 3) freeOfficerActor(o);
      else if (o.moving) faceToward(o, o.x + o.vx, o.z + o.vz, dt);
      return;
    }
    if (o.los) {
      o.aimT += dt;
      faceToward(o, p.x, p.z, dt, 12);
      if (o.los) officerSees = true;
    } else {
      o.aimT = 0;
      if (o.moving) faceToward(o, o.x + o.vx, o.z + o.vz, dt);
    }
    if (o.shooting) {
      const d = Math.hypot(p.x - o.x, p.z - o.z);
      if (!o.los || !playerUp(game)) {
        if (o.lastSeen > 0.6) endOfficerBurst(o);
      } else if (!o.arms.reloading) {
        const w = WEAPONS[o.arms.weapon];
        const r = aiShoot(game, o, hitChance(d, w.range, playerSpeedOf(game), o.aimT), orng, null, null);
        if (r) {
          stats.officerShots++;
          if (r === 2) stats.officerHits++;
          if (--o.burst <= 0) endOfficerBurst(o);
        }
      } else endOfficerBurst(o);
    }
  }
  function endOfficerBurst(o) {
    o.shooting = false;
    o.burst = 0;
    o.burstCool = 0.9 + orng.next() * 1.1;
    releaseSlot(game, o);
  }

  function clearOfficers() {
    for (let i = 0; i < bodies.length; i++) if (bodies[i].active) releaseBody(bodies[i]);
    for (let i = 0; i < officers.length; i++) if (officers[i].active) freeOfficerActor(officers[i]);
  }

  // --- Cars. ---
  function release(v) {
    v.ai = null;
    v.cop = null;
    v.police = false;
    v.siren = false;
    v.occ = null;
    v.occDown = null;
    v.role = null;
    v.controls = null;
    if (v.driver !== 'player') v.driver = null;
    if (v.mesh) setVehicleLights(v.mesh, { brake: false, siren: false, time: game.time });
  }

  function dropOfficersOf(v) {
    for (let i = 0; i < officers.length; i++) if (officers[i].active && officers[i].car === v) officers[i].car = null;
  }

  function despawn(i) {
    const v = cars[i];
    dropOfficersOf(v);
    game.removeVehicle(v);
    v.ai = null;
    v.cop = null;
    v.siren = false;
    cars.splice(i, 1);
  }

  function toChase(v) {
    if (!v.cop) v.cop = createCop(city, game.rng);
    v.cop.state = 0;
    v.ai = v.cop;
    v.driver = v.cop;
    v.role = 'chase';
    v.siren = true;
  }

  function toLeave(v) {
    const dr = createDriver(city, game.rng); // attaches to the nearest lane
    v.ai = dr;
    v.driver = dr;
    v.role = 'leave';
    v.siren = false;
    v.leaveTime = 0;
    if (v.cop) v.cop.ram = false;
  }

  function endChase() {
    // Cars waiting for officers on foot leave once they are back in.
    for (let i = 0; i < cars.length; i++) if (cars[i].role !== 'leave' && !cars[i].officers) toLeave(cars[i]);
    patrolDelay = PATROL_DELAY;
  }

  const nearIds = [];
  function refreshNear(px, pz) {
    near.length = 0;
    const ids = city.edgesNear ? city.edgesNear(px, pz, SPAWN_MAX, nearIds).sort(byId) : null;
    const n = ids ? ids.length : city.edges.length;
    for (let j = 0; j < n; j++) {
      const i = ids ? ids[j] : j;
      const e = city.edges[i];
      if (e.causeway) continue;
      const a = city.nodes[e.a], b = city.nodes[e.b];
      const d = segDist(city, e, px, pz);
      const far = Math.max(Math.hypot(a.x - px, a.z - pz), Math.hypot(b.x - px, b.z - pz));
      if (d < SPAWN_MAX && far > SPAWN_MIN) near.push(i);
    }
  }

  function spotClear(qx, qz, r) {
    const vs = game.vehicles;
    for (let i = 0; i < vs.length; i++) {
      const o = vs[i];
      if ((o.y || 0) > 5) continue;
      if ((o.x - qx) * (o.x - qx) + (o.z - qz) * (o.z - qz) < r * r) return false;
    }
    return true;
  }

  function trySpawn(role) {
    if (!near.length) return null;
    const p = game.player, rng = game.rng, col = game.collision;
    let best = -Infinity, be = -1, bf = -1, bd = 0, bl = 0;
    for (let k = 0; k < 10; k++) {
      const e = city.edges[near[rng.int(0, near.length - 1)]];
      const from = rng.next() < 0.5 ? e.a : e.b;
      const to = otherEnd(e, from);
      const d0 = extAt(city.nodes[from], e) + 10, d1 = e.length - extAt(city.nodes[to], e) - 15;
      if (d1 <= d0) continue;
      const d = rng.range(d0, d1);
      const lane = rng.int(0, lanesPerDirection(e) - 1);
      lanePoint(city, e, from, d, lane, LP);
      const qx = LP.x, qz = LP.z;
      const dist = Math.hypot(qx - p.x, qz - p.z);
      if (dist < SPAWN_MIN || dist > SPAWN_MAX) continue;
      if (!spotClear(qx, qz, CLEARANCE)) continue;
      const hidden = col && col.lineClear ? !col.lineClear(p.x, p.z, qx, qz) : false;
      const toward = (Math.cos(LP.heading) * (p.x - qx) + Math.sin(LP.heading) * (p.z - qz)) / dist;
      const score = (hidden ? 2 : 0) + (role === 'chase' ? toward * 0.5 : 0) + rng.next() * 0.3;
      if (score > best) {
        best = score;
        be = e.id; bf = from; bd = d; bl = lane;
      }
    }
    if (be < 0 || !takeSpawn(game)) return null;
    const e = city.edges[be];
    lanePoint(city, e, bf, bd, bl, LP);
    const v = createVehicle('police', LP.x, LP.z, LP.heading, game.rng);
    v.police = true;
    v.controls = { steer: 0, throttle: 0, brake: 0, handbrake: false };
    v.asleep = false;
    v.officers = 0;
    v.outCool = 0;
    crewUp(v);
    let v0;
    if (role === 'chase') {
      toChase(v);
      v0 = rulesFor(heat.level).launch;
    } else {
      const dr = createDriver(city, game.rng);
      placeDriver(dr, v, be, bf, bd, bl);
      v.ai = dr;
      v.driver = dr;
      v.role = 'patrol';
      v.siren = false;
      v0 = (e.avenue ? LANE_SPEED.avenue : LANE_SPEED.street) * 0.9;
    }
    v.vx = Math.cos(v.heading) * v0;
    v.vz = Math.sin(v.heading) * v0;
    v.speed = v0;
    game.addVehicle(v);
    cars.push(v);
    return v;
  }

  // Heat 4: two cars parked across a road the player is heading for.
  const blockIds = [];
  function tryRoadblock() {
    const p = game.player, pv = p.vehicle;
    if (!pv || pv.kind !== 'car') return false;
    const sp = Math.hypot(pv.vx || 0, pv.vz || 0);
    if (sp < 5) return false;
    const fx = pv.vx / sp, fz = pv.vz / sp;
    const nodes = city.nodes, col = game.collision;
    // The road nearest to a point ~140 m ahead (any edge, however long).
    let cx = 0, cz = 0, ux = 1, uz = 0, found = false;
    for (let tries = 0; tries < 3 && !found; tries++) {
      const ahead = 140 + (tries === 1 ? -30 : tries === 2 ? 40 : 0);
      const qx = p.x + fx * ahead, qz = p.z + fz * ahead;
      let bd = 25, be = -1;
      // Only the roads near that point (the edge grid on a real map; ids
      // ascending, so ties go the way a full scan would).
      const ids = city.edgesNear ? city.edgesNear(qx, qz, bd, blockIds).sort(byId) : null;
      const ne = ids ? ids.length : city.edges.length;
      for (let j = 0; j < ne; j++) {
        const i = ids ? ids[j] : j;
        const e = city.edges[i];
        if (e.causeway) continue;
        const d = segDist(city, e, qx, qz);
        if (d < bd) {
          bd = d;
          be = i;
        }
      }
      if (be < 0) continue;
      const e = city.edges[be];
      const a = nodes[e.a], b = nodes[e.b];
      ux = (b.x - a.x) / e.length;
      uz = (b.z - a.z) / e.length;
      const lo = extAt(a, e) + 6, hi = e.length - extAt(b, e) - 6;
      if (hi <= lo) continue;
      const t = clamp((qx - a.x) * ux + (qz - a.z) * uz, lo, hi);
      cx = a.x + ux * t;
      cz = a.z + uz * t;
      const dx = cx - p.x, dz = cz - p.z, d = Math.sqrt(dx * dx + dz * dz);
      if (d < BLOCK_MIN || d > BLOCK_MAX || (dx * fx + dz * fz) / d < 0.75) continue;
      if (col && col.lineClear && col.lineClear(p.x, p.z, cx, cz) && d < 120) continue; // too obvious
      found = true;
    }
    if (!found) {
      stats.blockFail = 'no road ahead';
      return false;
    }
    const nx = -uz, nz = ux;
    const across = Math.atan2(nz, nx);
    for (let k = 0; k < 2; k++) {
      const s = k === 0 ? 1 : -1;
      const x = cx + nx * 2.4 * s, z = cz + nz * 2.4 * s;
      if (col && col.resolveCircle(x, z, 1.2, 0).hit) {
        stats.blockFail = 'wall';
        return false;
      }
      if (!spotClear(x, z, 7)) {
        stats.blockFail = 'cars';
        return false;
      }
    }
    if (!takeSpawn(game, 2)) {
      stats.blockFail = 'spawn gate';
      return false;
    }
    for (let k = 0; k < 2; k++) {
      const s = k === 0 ? 1 : -1;
      const x = cx + nx * 2.4 * s, z = cz + nz * 2.4 * s;
      const v = createVehicle('police', x, z, across + (s > 0 ? 0.2 : Math.PI - 0.2), game.rng);
      v.police = true;
      v.role = 'block';
      v.siren = true;
      v.asleep = false;
      v.officers = 0;
      v.outCool = 0;
      crewUp(v);
      v.cop = createCop(city, game.rng);
      v.ai = v.cop;
      v.driver = v.cop;
      v.controls = { steer: 0, throttle: 0, brake: 0, handbrake: true };
      game.addVehicle(v);
      cars.push(v);
    }
    stats.roadblocks++;
    return true;
  }

  function playerTarget() {
    const p = game.player;
    if (p.vehicle) return p.vehicle;
    const w = p.walker;
    footTarget.x = p.x;
    footTarget.z = p.z;
    footTarget.vx = w ? w.vx || 0 : 0;
    footTarget.vz = w ? w.vz || 0 : 0;
    footTarget.heading = p.heading || 0;
    footTarget.y = 0;
    return footTarget;
  }

  // The player's own siren and lights: a stolen police car (spec.police), later
  // any emergency vehicle (spec.emergency). The SIREN button (input 'siren')
  // toggles v.siren; the flag drives the lights, the audio loop and the traffic
  // and pedestrians that get out of the way (src/core/yield.js). Off by default,
  // and off again when the player leaves the car.
  const sirenEv = { craft: null, on: false, kind: '' };
  let ownSirenCar = null;
  function stepOwnSiren() {
    const pv = game.player.vehicle;
    const can = !!(pv && pv.kind === 'car' && !pv.wrecked && hasSiren(pv.spec));
    if (ownSirenCar && ownSirenCar !== pv) {
      const old = ownSirenCar;
      ownSirenCar = null;
      if (old.siren) {
        old.siren = false;
        sirenEv.craft = old;
        sirenEv.on = false;
        sirenEv.kind = old.spec ? old.spec.id : '';
        if (ev && ev.emit) ev.emit('siren', sirenEv);
      }
    }
    const input = game.input;
    if (can && input && input.consume && input.consume('siren')) {
      pv.siren = !pv.siren;
      pv.onCall = false;
      ownSirenCar = pv.siren ? pv : null;
      sirenEv.craft = pv;
      sirenEv.on = pv.siren;
      sirenEv.kind = pv.spec.id; // which siren sounds (docs/REVAMP.md 6.11 SIRENS)
      if (ev && ev.emit) ev.emit('siren', sirenEv);
    }
    if (game.touch && game.touch.setSiren) game.touch.setSiren(can, can && !!pv.siren);
  }

  function setSiren(on) {
    if (on !== sirenOn) {
      sirenOn = on;
      if (ev && ev.emit) ev.emit('siren', on);
    }
  }

  const hold = (c) => {
    c.steer = 0;
    c.throttle = 0;
    c.brake = 0;
    c.handbrake = true;
  };

  const sys = {
    name: 'police',
    heat,
    cars,
    officers,
    bodies,
    crewUp,
    stats,
    stars: 0,
    fixedUpdate(dt) {
      beginSpawnStep(game, SPAWNER.police);
      warmer.step(game);
      const p = game.player;
      stepOwnSiren();
      const settings = game.progress && game.progress.settings;
      const enabled = !settings || settings.police !== false;
      enabledNow = enabled;
      if (!enabled) {
        if (wasEnabled) {
          clearOfficers();
          for (let i = cars.length - 1; i >= 0; i--) {
            if (cars[i].driver === 'player' || p.vehicle === cars[i]) {
              release(cars[i]);
              cars.splice(i, 1);
            } else despawn(i);
          }
          wasEnabled = false;
        }
        resetHeat(heat);
        callOffHeli();
        if (tankUnit) { dropTank(true); tankWait = TANK_DELAY; }
        sys.stars = 0;
        crashed = startled = false;
        violence = 0;
        p.wanted = 0;
        setSiren(false);
        return;
      }
      wasEnabled = true;
      stepTick++;
      trafficCtx.time = chaseCtx.time = game.time;
      sightNow = SIGHT * fogSightScale(game.weather ? game.weather.fog : 0);
      trafficCtx.vehicles = chaseCtx.vehicles = game.vehicles;
      chaseCtx.collision = game.collision;
      if (pedCool > 0) pedCool -= dt;
      if (blockCool > 0) blockCool -= dt;

      const pv = p.vehicle;
      const target = playerTarget();
      const col = game.collision;

      // Release cars the player took; drop removed ones.
      for (let i = cars.length - 1; i >= 0; i--) {
        const v = cars[i];
        if (v.removed) {
          dropOfficersOf(v);
          cars.splice(i, 1);
        } else if (v.driver === 'player' || pv === v) {
          dropOfficersOf(v);
          release(v);
          cars.splice(i, 1);
        }
      }

      // Officers on foot first (they also tell us whether police see the player).
      officerSees = false;
      for (let i = 0; i < officers.length; i++) if (officers[i].active) stepOfficer(officers[i], dt);
      for (let i = 0; i < bodies.length; i++) {
        const b = bodies[i];
        if (!b.active) continue;
        b.px = b.x;
        b.pz = b.z;
        if (b.fade >= 1) releaseBody(b);
      }

      // Can any police car see the player?
      if (seenTick++ % 4 === 0) {
        let seen = false;
        for (let i = 0; i < cars.length && !seen; i++) {
          const v = cars[i];
          if (v.role === 'leave' || v.role === 'dead') continue;
          const d = Math.hypot(v.x - p.x, v.z - p.z);
          if (d < sightNow && (!col || col.lineClear(v.x, v.z, p.x, p.z))) seen = true;
        }
        facts.seenByPolice = seen;
      }

      facts.inCar = !!pv && pv.kind === 'car';
      facts.atSea = (!!pv && pv.kind === 'boat') || city.shoreDist(p.x, p.z) < -5;
      facts.airborne = !!pv && (pv.kind === 'plane' || pv.kind === 'heli') && (pv.y || 0) > 3;
      facts.speeding = facts.inCar && city.onRoad(p.x, p.z) ? Math.max(0, Math.abs(pv.speed) - TOWN_LIMIT) : 0;
      facts.crashedTraffic = crashed;
      facts.startledPed = startled;
      facts.violence = violence;
      const seenNow = facts.seenByPolice;
      if (officerSees) facts.seenByPolice = true;
      crashed = startled = false;
      violence = 0;
      const before = heat.level;
      const res = updateHeat(heat, dt, facts);
      facts.seenByPolice = seenNow;
      if (res === 'up') {
        const msg = before === 0 ? 'The police want a word!' : heat.level === 2 ? 'Officers on foot!'
          : heat.level === 3 ? 'They mean business now' : heat.level >= 4 ? 'Roadblocks ahead!' : 'More patrol cars on your tail';
        if (game.hud && game.hud.toast) game.hud.toast(msg, 2);
        for (let i = 0; i < cars.length; i++) if (cars[i].role === 'patrol') toChase(cars[i]);
      } else if (res === 'escaped') {
        const r = escapeReward(heat.escapedLevel);
        if (game.score && game.score.add) game.score.add(r, 'Lost the police', p.x, p.z);
        if (game.hud && game.hud.toast) game.hud.toast(`You lost them!  +${r}`, 2.5);
        if (ev && ev.emit) {
          ev.emit('policeEscaped', heat.escapedLevel);
          ev.emit('progress');
        }
        endChase();
      }

      // Pulled over? (Officers on foot count only while it is still an
      // arrest, heat 2 or less; above that it is a shootout.)
      let copDist = Infinity;
      for (let i = 0; i < cars.length; i++) {
        const v = cars[i];
        if (v.role === 'leave' || v.role === 'dead') continue;
        const d = Math.hypot(v.x - p.x, v.z - p.z);
        if (d < copDist) copDist = d;
      }
      if (heat.level <= 2) {
        for (let i = 0; i < officers.length; i++) {
          const o = officers[i];
          if (!o.active || o.life !== 'ok') continue;
          const d = Math.hypot(o.x - p.x, o.z - p.z);
          if (d < copDist) copDist = d;
        }
      }
      bustFacts.copDist = copDist;
      bustFacts.onFoot = !pv;
      bustFacts.inCar = facts.inCar;
      bustFacts.playerSpeed = pv ? pv.speed : 0;
      if (playerUp(game) && updateBust(heat, dt, bustFacts)) {
        resetHeat(heat, 6);
        if (game.hud && game.hud.toast) game.hud.toast('Pulled over! Off with a warning.', 3);
        if (ev && ev.emit) {
          ev.emit('fail', 'Pulled over');
          ev.emit('busted');
          ev.emit('progress');
        }
        endChase();
      }
      p.wanted = heat.level;
      // The top level brings a helicopter (existing pilot code); it leaves
      // when the heat drops. A downed one is replaced after a pause.
      if (heliPilot && (heliPilot.state === 'done' || heliPilot.state === 'crash')) {
        heliPilot = null;
        heliWait = HELI_REPEAT;
      }
      if (heat.level < MAX_HEAT) {
        if (heliPilot) callOffHeli();
        heliWait = HELI_DELAY;
      } else if (!heliPilot && rulesFor(heat.level).heli) {
        heliWait -= dt;
        if (heliWait <= 0 && !facts.atSea && takeSpawn(game)) {
          heliPilot = spawnPoliceHeli(game, { order: 'orbit' });
          heliWait = HELI_REPEAT;
        }
      }
      sys.stars = wantedStars(heat.level, !!heliPilot);
      stepTankUnit(dt, sys.stars >= 5 && !facts.atSea && !facts.airborne, city.shoreDist(p.x, p.z) < -120 || (p.y || 0) > 150);

      // Drive the cars, retire the ones no longer needed.
      const idle = city.shoreDist(p.x, p.z) < -120 || (p.y || 0) > 150;
      const psp = pv ? Math.abs(pv.speed) : 0;
      let chasing = 0, patrols = 0, blocks = 0, anySiren = false, chaseIx = 0;
      for (let i = cars.length - 1; i >= 0; i--) {
        const v = cars[i];
        if (heat.level === 0 && (v.role === 'chase' || v.role === 'out' || v.role === 'block')) {
          if (!v.officers) toLeave(v);
        }
        if (heat.level < MAX_HEAT && v.role === 'block' && !v.officers) toLeave(v);
        if (heat.level > 0 && (v.role === 'chase' || v.role === 'out')) chasing++;
        const d = Math.hypot(v.x - p.x, v.z - p.z);
        if (v.role === 'chase' && chasing > unitsFor(heat.level, max)) {
          toLeave(v);
          chasing--;
        }
        if (v.role === 'leave') {
          v.leaveTime += dt;
          const hidden = !col || !col.lineClear(v.x, v.z, p.x, p.z);
          if (d > 250 || (d > LEAVE_GONE && hidden) || (v.leaveTime > 40 && hidden && d > 40)) {
            despawn(i);
            continue;
          }
        } else if (v.role === 'block') {
          // Passed or left far behind: gone.
          const behind = pv ? ((v.x - p.x) * (pv.vx || 0) + (v.z - p.z) * (pv.vz || 0)) < 0 : false;
          if (d > 260 || (behind && d > 70 && (!col || !col.lineClear(v.x, v.z, p.x, p.z)))) {
            despawn(i);
            continue;
          }
          blocks++;
        } else if (d > (v.role === 'chase' || v.role === 'out' ? CHASE_DESPAWN : PATROL_DESPAWN) ||
          (v.role === 'patrol' && v.ai && (v.ai.stuck || v.ai.dead) && d > 120)) {
          despawn(i);
          if (v.role === 'chase' || v.role === 'out') chasing--;
          continue;
        }
        if (v.role !== 'dead' && v.occ && !v.copsDead && occupantsAlive(v) === 0) {
          // Everyone aboard is dead: the car rolls to a stop and stays.
          v.copsDead = true;
          v.role = 'dead';
          v.siren = false;
          v.ai = null;
          v.cop = null;
          v.driver = null;
        }
        if (v.role === 'dead') {
          if (v.controls) hold(v.controls);
          continue;
        }
        if (v.role === 'patrol') patrols++;
        if (v.outCool > 0) v.outCool -= dt;
        if (idle) {
          hold(v.controls);
          continue;
        }
        // Heat 2 and up: get out and fight when close, or when the player stops.
        if ((v.role === 'chase' || v.role === 'block') && heat.level >= 2 && !v.wrecked && v.outCool <= 0 &&
          stepTick % 15 === i % 15 && playerUp(game) && (p.y || 0) < 3) {
          const reach = v.role === 'block' ? STEP_OUT_BLOCK : STEP_OUT;
          if (d < reach && (!pv || psp < 3 || v.role === 'block' || (d < 12 && Math.abs(v.speed) < 1.5)) && officersOut() < OFFICERS_MAX) {
            v.role = v.role === 'block' ? 'blockOut' : 'out';
            v.outT = 0;
          }
        }
        if (v.role === 'out' || v.role === 'blockOut') {
          anySiren = true;
          const c = v.controls;
          v.outT += dt;
          if (Math.abs(v.speed) > 1.5) {
            c.steer = 0;
            c.throttle = 0;
            c.brake = 1;
            c.handbrake = false;
          } else {
            hold(c);
            if (!v.officers && v.outT < 3 && !v.stepped) {
              v.stepped = stepOut(v) > 0;
              if (!v.stepped) v.outT = 99;
            }
          }
          // Everyone back in: drive on.
          if ((v.stepped && !v.officers) || (v.outT > 3 && !v.officers)) {
            v.stepped = false;
            v.outCool = OUT_COOL;
            if (v.role === 'blockOut') v.role = 'block';
            else if (heat.level > 0) toChase(v);
            else toLeave(v);
          }
          continue;
        }
        if (v.role === 'block') {
          anySiren = true;
          hold(v.controls);
          continue;
        }
        if (v.role === 'chase') {
          anySiren = true;
          // Heat 3: every other car rams for a few seconds at a time.
          if (v.cop) {
            v.cop.ram = heat.level >= 3 && chaseIx % 2 === 0 && (game.time % 7) < 4;
            v.cop.pace = rulesFor(heat.level).pace;
          }
          chaseIx++;
          chaseStep(v.cop, v, dt, target, chaseCtx);
        } else driveStep(v.ai, v, dt, trafficCtx);
      }
      setSiren(anySiren);
      if (idle) return;

      // Spawn what the heat level calls for.
      nearTimer -= dt;
      if (nearTimer <= 0) {
        nearTimer = 1;
        refreshNear(p.x, p.z);
      }
      if (patrolDelay > 0) patrolDelay -= dt;
      spawnTimer -= dt;
      // A spawn waits a step while the shared gate is full (core/spatial.js:
      // at most two vehicles or people a step; a roadblock is two).
      const blockNow = heat.level >= MAX_HEAT && blocks === 0 && blockCool <= 0 && !facts.atSea && !facts.airborne;
      if (spawnTimer <= 0 && spawnsLeft(game) >= (blockNow ? 2 : 1)) {
        spawnTimer = rulesFor(heat.level).every;
        const want = unitsFor(heat.level, max);
        if (blockNow) {
          blockCool = tryRoadblock() ? BLOCK_COOL : 3;
        } else if (heat.level > 0 && chasing < want && !facts.atSea && !facts.airborne) trySpawn('chase');
        else if (heat.level === 0 && patrols === 0 && patrolDelay <= 0 && max > 0 && belowLiveCap(game)) trySpawn('patrol');
      }
    },
    render(alpha) {
      for (let i = 0; i < cars.length; i++) {
        const v = cars[i];
        if (v.mesh) setVehicleLights(v.mesh, { brake: v.brake > 0.1 || v.handbrake, siren: !!v.siren, time: game.time });
      }
      // The player's own siren (game.js draws the player's car with it off first).
      const own = game.player.vehicle;
      if (own && own.siren && own.kind === 'car' && own.mesh) setVehicleLights(own.mesh, { brake: own.brake > 0.1 || own.handbrake, siren: true, time: game.time });
      if (!game.scene) return;
      // Officer bodies built ahead, one every few frames (no mesh building
      // when they first step out).
      if (++renders % 6 === 3 && prebuilt < officers.length + bodies.length) {
        const o = prebuilt < officers.length ? officers[prebuilt] : bodies[prebuilt - officers.length];
        if (!o.mesh) {
          o.mesh = createPersonMesh(OFFICER_LOOK);
          if (o.mesh.rotation) o.mesh.rotation.order = 'YXZ';
          o.mesh.visible = false;
          game.scene.add(o.mesh);
        }
        prebuilt++;
      }
      for (let i = 0; i < officers.length + bodies.length; i++) {
        const o = i < officers.length ? officers[i] : bodies[i - officers.length];
        if (!o.active) {
          if (o.mesh && o.mesh.visible) o.mesh.visible = false;
          continue;
        }
        if (!o.mesh) {
          o.mesh = createPersonMesh(OFFICER_LOOK);
          if (o.mesh.rotation) o.mesh.rotation.order = 'YXZ';
          game.scene.add(o.mesh);
        }
        o.mesh.visible = true;
        updatePersonMesh(o.mesh, o, alpha);
        if (o.life !== 'ok') layDown(o.mesh, o);
        else if (o.mesh.rotation.z !== 0) o.mesh.rotation.z = 0;
      }
    },
  };
  return sys;
}
