// Police: a light, optional cat-and-mouse chase. Reckless driving (ramming
// traffic, making pedestrians dive, heavy speeding in sight of a patrol
// car) raises "heat" 0..3. Patrol cars then give chase with their light
// bars on; slip out of sight long enough and they give up. Stop next to
// one and you are pulled over for a small fine. Nobody is hurt and
// wrecking the player's car is never a goal.
//
// The heat rules (createHeat / updateHeat / updateBust) and the pursuit
// driver (createCop / chaseStep) are pure logic, tested in node.
// createPolice is the game system that spawns and removes police cars.
import { lanePoint, lanesPerDirection } from '../world/citygen.js';
import { createVehicle } from '../entities/vehicle.js';
import { createDriver, placeDriver, driveStep, LANE_SPEED } from './traffic.js';
import { setVehicleLights } from '../render/vehiclemesh.js';
import { clamp } from '../core/rng.js';

// --- Heat rules. ---

export const TOWN_LIMIT = 22; // m/s
export const HEAVY_SPEEDING = 6; // m/s over the limit that counts
export const RAM_SPEED = 6; // closing speed (m/s) that counts as ramming
export const MAX_HEAT = 3;
export const SIGHT = 90; // police see this far, given a clear line
export const COOLDOWN = [0, 12, 18, 25]; // seconds out of sight to escape
export const FINE_PER_LEVEL = 60;
export const ESCAPE_REWARD_PER_LEVEL = 30;
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
//          atSea, airborne, enabled }
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

// Pulled over? facts: { playerSpeed, copDist (nearest police car centre,
// metres), onFoot, inCar }. Returns true on the step the bust happens.
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
// cars count, and only when the player was the faster one into the hit.
export function isRam(player, other, strength, dt = 1 / 60) {
  if (!player || !other || player === other) return false;
  if (!(other.traffic || other.police)) return false;
  if (!(strength >= RAM_SPEED)) return false;
  const ps = Math.hypot(player.x - player.px, player.z - player.pz) / dt;
  const os = Math.hypot(other.x - other.px, other.z - other.pz) / dt;
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

function attach(cop, v, tx, tz) {
  const city = cop.city;
  let best = Infinity, be = -1;
  for (let i = 0; i < city.edges.length; i++) {
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
  let lat = (v.x - F.x) * -uz + (v.z - F.z) * ux;
  if (Math.abs(lat) > 14 || d < -15 || d > E.length + 25) {
    attach(cop, v, tx, tz);
    return roadAim2(cop, v, tx, tz);
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
      lat = (v.x - F.x) * -uz + (v.z - F.z) * ux;
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
  return roadAim2(cop, v, tx, tz);
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
    cop.los = dist < SIGHT && (target.y || 0) < 4 && (!col || col.lineClear(v.x, v.z, tx, tz));
  }
  if (cop.tick % 3 === 0 && ctx.vehicles) scanAhead(cop, v, target, ctx.vehicles);
  else if (cop.obsGap < Infinity) cop.obsGap -= (sp - cop.obsSpeed) * dt;
  cop.tick++;
  if (cop.los) cop.lostTime = 0;
  else cop.lostTime += dt;

  const direct = cop.lostTime < 1 && dist < (cop.state === DIRECT ? DIRECT_OUT : DIRECT_IN);
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
    if (cop.blocked) {
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
    if (tsp < 1.5) {
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
  vt = Math.min(vt, V_AVENUE);

  // Never ram the target: hold back when it is right in front.
  {
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
  const maxAng = spec.steerMax / (1 + Math.abs(sp) / 20);
  let steer;
  if (lx < 0.5) steer = ly >= 0 ? 1 : -1;
  else steer = Math.atan(((2 * ly) / (lx * lx + ly * ly)) * spec.wheelBase) / maxAng;
  const cosA = lx / (Math.hypot(lx, ly) || 1);
  vt = Math.min(vt, 5 + 31 * Math.max(0, cosA) * Math.max(0, cosA));

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
    if (vt > 2.5 && Math.abs(sp) < 1.2) cop.stuckTime += dt;
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
const extAt = (node, e) => (e.horizontal ? node.hx : node.hz);

export function createPolice(game, { max = 3 } = {}) {
  const city = game.city;
  const heat = createHeat();
  const cars = []; // managed police vehicles (v.role: 'patrol' | 'chase' | 'leave')
  const near = [];
  const facts = {
    speeding: 0, crashedTraffic: false, startledPed: false, seenByPolice: false,
    inCar: false, atSea: false, airborne: false, enabled: true,
  };
  const bustFacts = { playerSpeed: 0, copDist: Infinity, onFoot: false, inCar: false };
  const trafficCtx = { time: 0, vehicles: game.vehicles };
  const chaseCtx = { collision: game.collision, vehicles: game.vehicles, time: 0 };
  const footTarget = { x: 0, z: 0, vx: 0, vz: 0, heading: 0, y: 0, spec: null };
  let crashed = false, startled = false, pedCool = 0;
  let nearTimer = 0, spawnTimer = 0, patrolDelay = 3, seenTick = 0;
  let sirenOn = false, wasEnabled = true;

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
      if (!pv || pv.kind !== 'car' || Math.abs(pv.speed) < 3 || !ped) return;
      if (Math.hypot(ped.x - p.x, ped.z - p.z) < 16 && pedCool <= 0) {
        startled = true;
        pedCool = 1.5;
      }
    });
  }

  function release(v) {
    v.ai = null;
    v.cop = null;
    v.police = false;
    v.siren = false;
    v.role = null;
    v.controls = null;
    if (v.driver !== 'player') v.driver = null;
  }

  function despawn(i) {
    const v = cars[i];
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
  }

  function endChase() {
    for (let i = 0; i < cars.length; i++) if (cars[i].role !== 'leave') toLeave(cars[i]);
    patrolDelay = PATROL_DELAY;
  }

  function refreshNear(px, pz) {
    near.length = 0;
    for (let i = 0; i < city.edges.length; i++) {
      const e = city.edges[i];
      if (e.causeway) continue;
      const a = city.nodes[e.a], b = city.nodes[e.b];
      const d = segDist(city, e, px, pz);
      const far = Math.max(Math.hypot(a.x - px, a.z - pz), Math.hypot(b.x - px, b.z - pz));
      if (d < SPAWN_MAX && far > SPAWN_MIN) near.push(i);
    }
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
      let clear = true;
      const vs = game.vehicles;
      for (let i = 0; i < vs.length; i++) {
        const o = vs[i];
        if ((o.y || 0) > 5) continue;
        if ((o.x - qx) * (o.x - qx) + (o.z - qz) * (o.z - qz) < CLEARANCE * CLEARANCE) {
          clear = false;
          break;
        }
      }
      if (!clear) continue;
      const hidden = col && col.lineClear ? !col.lineClear(p.x, p.z, qx, qz) : false;
      const toward = (Math.cos(LP.heading) * (p.x - qx) + Math.sin(LP.heading) * (p.z - qz)) / dist;
      const score = (hidden ? 2 : 0) + (role === 'chase' ? toward * 0.5 : 0) + rng.next() * 0.3;
      if (score > best) {
        best = score;
        be = e.id; bf = from; bd = d; bl = lane;
      }
    }
    if (be < 0) return null;
    const e = city.edges[be];
    lanePoint(city, e, bf, bd, bl, LP);
    const v = createVehicle('police', LP.x, LP.z, LP.heading, game.rng);
    v.police = true;
    v.controls = { steer: 0, throttle: 0, brake: 0, handbrake: false };
    v.asleep = false;
    let v0;
    if (role === 'chase') {
      toChase(v);
      v0 = 12;
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

  function setSiren(on) {
    if (on !== sirenOn) {
      sirenOn = on;
      if (ev && ev.emit) ev.emit('siren', on);
    }
  }

  const sys = {
    name: 'police',
    heat,
    cars,
    fixedUpdate(dt) {
      const p = game.player;
      const settings = game.progress && game.progress.settings;
      const enabled = !settings || settings.police !== false;
      if (!enabled) {
        if (wasEnabled) {
          for (let i = cars.length - 1; i >= 0; i--) {
            if (cars[i].driver === 'player' || p.vehicle === cars[i]) {
              release(cars[i]);
              cars.splice(i, 1);
            } else despawn(i);
          }
          wasEnabled = false;
        }
        resetHeat(heat);
        crashed = startled = false;
        p.wanted = 0;
        setSiren(false);
        return;
      }
      wasEnabled = true;
      trafficCtx.time = chaseCtx.time = game.time;
      trafficCtx.vehicles = chaseCtx.vehicles = game.vehicles;
      chaseCtx.collision = game.collision;
      if (pedCool > 0) pedCool -= dt;

      const pv = p.vehicle;
      const target = playerTarget();
      const col = game.collision;

      // Release cars the player took; drop removed ones.
      for (let i = cars.length - 1; i >= 0; i--) {
        const v = cars[i];
        if (v.removed) {
          cars.splice(i, 1);
        } else if (v.driver === 'player' || pv === v) {
          release(v);
          cars.splice(i, 1);
        }
      }

      // Can any police car see the player?
      if (seenTick++ % 4 === 0) {
        let seen = false;
        for (let i = 0; i < cars.length && !seen; i++) {
          const v = cars[i];
          if (v.role === 'leave') continue;
          const d = Math.hypot(v.x - p.x, v.z - p.z);
          if (d < SIGHT && (!col || col.lineClear(v.x, v.z, p.x, p.z))) seen = true;
        }
        facts.seenByPolice = seen;
      }

      facts.inCar = !!pv && pv.kind === 'car';
      facts.atSea = (!!pv && pv.kind === 'boat') || city.shoreDist(p.x, p.z) < -5;
      facts.airborne = !!pv && (pv.kind === 'plane' || pv.kind === 'heli') && (pv.y || 0) > 3;
      facts.speeding = facts.inCar && city.onRoad(p.x, p.z) ? Math.max(0, Math.abs(pv.speed) - TOWN_LIMIT) : 0;
      facts.crashedTraffic = crashed;
      facts.startledPed = startled;
      crashed = startled = false;
      const before = heat.level;
      const res = updateHeat(heat, dt, facts);
      if (res === 'up') {
        if (game.hud && game.hud.toast) game.hud.toast(before === 0 ? 'The police want a word!' : 'More patrol cars on your tail', 2);
        for (let i = 0; i < cars.length; i++) if (cars[i].role === 'patrol') toChase(cars[i]);
      } else if (res === 'escaped') {
        const r = escapeReward(heat.escapedLevel);
        game.progress.money = Math.min(99999999, game.progress.money + r);
        if (game.hud && game.hud.toast) game.hud.toast(`You lost them!  +$${r}`, 2.5);
        if (ev && ev.emit) {
          ev.emit('reward', r, 'Lost the police');
          ev.emit('progress');
        }
        endChase();
      }

      // Pulled over?
      let copDist = Infinity;
      for (let i = 0; i < cars.length; i++) {
        const v = cars[i];
        if (v.role === 'leave') continue;
        const d = Math.hypot(v.x - p.x, v.z - p.z);
        if (d < copDist) copDist = d;
      }
      bustFacts.copDist = copDist;
      bustFacts.onFoot = !pv;
      bustFacts.inCar = facts.inCar;
      bustFacts.playerSpeed = pv ? pv.speed : 0;
      if (updateBust(heat, dt, bustFacts)) {
        const fine = bustFine(heat.level, game.progress.money);
        game.progress.money -= fine;
        resetHeat(heat, 6);
        if (game.hud && game.hud.toast) game.hud.toast(`Pulled over! Fine $${fine}`, 3);
        if (ev && ev.emit) {
          ev.emit('fail', 'Pulled over');
          ev.emit('progress');
        }
        endChase();
      }
      p.wanted = heat.level;

      // Drive the cars, retire the ones no longer needed.
      const idle = city.shoreDist(p.x, p.z) < -120 || (p.y || 0) > 150;
      let chasing = 0, patrols = 0, anySiren = false;
      for (let i = cars.length - 1; i >= 0; i--) {
        const v = cars[i];
        if (heat.level === 0 && v.role === 'chase') toLeave(v);
        if (heat.level > 0 && v.role === 'chase') chasing++;
        const d = Math.hypot(v.x - p.x, v.z - p.z);
        if (v.role === 'chase' && chasing > Math.min(heat.level, max)) {
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
        } else if (d > (v.role === 'chase' ? CHASE_DESPAWN : PATROL_DESPAWN) ||
          (v.role === 'patrol' && v.ai && (v.ai.stuck || v.ai.dead) && d > 120)) {
          despawn(i);
          if (v.role === 'chase') chasing--;
          continue;
        }
        if (v.role === 'patrol') patrols++;
        if (idle) {
          const c = v.controls;
          c.steer = 0;
          c.throttle = 0;
          c.brake = 0;
          c.handbrake = true;
          continue;
        }
        if (v.role === 'chase') {
          anySiren = true;
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
      if (spawnTimer <= 0) {
        spawnTimer = 1.2;
        const want = Math.min(heat.level, max);
        if (heat.level > 0 && chasing < want && !facts.atSea && !facts.airborne) trySpawn('chase');
        else if (heat.level === 0 && patrols === 0 && patrolDelay <= 0 && max > 0) trySpawn('patrol');
      }
    },
    render() {
      for (let i = 0; i < cars.length; i++) {
        const v = cars[i];
        if (v.mesh) setVehicleLights(v.mesh, { brake: v.brake > 0.1 || v.handbrake, siren: !!v.siren, time: game.time });
      }
    },
  };
  return sys;
}
