// Helicopter AI pilot (docs/ARMS.md section 4). Pure logic: no three.js,
// no DOM at import time. It flies a real heli craft through stepAircraft by
// writing `craft.controls` (steer = yaw demand, pitch = forward speed
// demand, throttle / brake = climb / sink), so it obeys the same limits as
// the player's helicopter. Game order: vehicles step with the controls
// written by the previous pilot step (one step of lag, 1/60 s).
//
// API for task 34 (police chases) and missions:
//   spawnPoliceHeli(game, opts) -> pilot
//     opts: target (default game.player: anything with x, z and y),
//           x, z, y (default: 350 m from the target behind the camera, 80 m up),
//           dist, angle, order ('orbit'), radius, seed, siren (true).
//     Adds a 'patrolheli' craft (police, driver 'ai', craft.ai = pilot) to
//     game.vehicles and to the pilot list stepped by the system below.
//   setOrder(pilot, order, opts): 'orbit' | 'strafe' | 'hover' | 'retreat'
//     (alias 'evade') | 'leave' | 'land'. opts: target, radius, x, z, y.
//   pilot fields to read: state ('arrive', 'orbit', 'strafe', 'hover',
//     'evade', 'leave', 'land', 'landed', 'ditch' (pilot shot: settles,
//     then left empty), 'crash', 'done'), sees (clear 3D
//     line to the target within SIGHT m, refreshed every 0.25 s), dist,
//     shots, hits. pilot.weaponsFree (default true) lets the caller hold
//     fire (one heavy shooter at a time).
//   createHeliPilots(game): the system (game.helipilot); steps every pilot,
//     ramps police spotlights, and adds the spotlight toggle for the player.
// Rules: orbit 76..106 m around the target (ahead of a moving one, to one
// side, so a chase camera sees it), 16..24 m above the highest roof within
// 40 m, further out over tall roofs (never more than maxElev above the
// target's horizon, never overhead); strafe = orbit plus a straight pass
// every 8..12 s with 1.2 s bursts; evade below 40% health (back off to
// 150 m); leave = climb
// away and despawn 400 m out; crash = spin down, explode on contact.
// Roof avoidance: heightAt ahead, climb to max + 15 m, hold forward speed
// while the way ahead is above the craft.
// Gunner: hit chance 0.25 x (1 - d/120) x 1/(1 + v/10) x aim ramp; never in
// the first 3 s after spawning or at a downed player.
import { createRng, clamp, angleDiff } from '../core/rng.js';
import { createAircraft } from '../entities/aircraft.js';
import { MOUNTS, tryMount, USE_NO } from '../core/weapons.js';
import { damage, canBeHit, craftBase, EVENT_PAYLOADS, craftBlast, CRAFT_HOOKS } from './combat.js';

export const PILOT = {
  orbitR: 90, orbitMin: 76, orbitMax: 106, orbitV: 9,
  altMin: 16, altMax: 24, roofNear: 40,
  // Station keeping: with the target moving faster than leadSpeed the
  // heli swings round (at most leadV across) to a bearing leadSide rad off
  // the target's track, ahead of it: in view of a chase camera, never
  // overhead. Slower targets get a slow circle (orbitV).
  leadSpeed: 4, leadSide: 0.45, leadV: 18, maxElev: 0.6,
  passEvery: [8, 12], burst: 1.2, passV: 30,
  evadeAt: 0.4, evadeR: 150,
  spawnDist: 350, spawnY: 80, leaveDist: 400,
  sight: 160, aimRamp: 1.0, quiet: 3,
  climbOver: 15, crashMax: 9, spin: 2.6,
};
const GUN = 'chingun';
let seedNext = 33033;

// Gunner hit chance (ARMS.md): 0.25 x (1 - d/120) x 1/(1 + v/10) x ramp.
export function gunnerChance(d, playerSpeed, aimT) {
  const range = MOUNTS[GUN].range;
  if (!(d >= 0) || d >= range) return 0;
  const ramp = clamp((aimT || 0) / PILOT.aimRamp, 0, 1);
  return 0.25 * (1 - d / range) * (1 / (1 + (Math.abs(playerSpeed) || 0) / 10)) * ramp;
}

export function createHeliPilot(craft, { target = null, order = 'orbit', radius = PILOT.orbitR, seed = seedNext++ } = {}) {
  const rng = createRng(seed);
  const p = {
    craft, target, rng,
    order, state: order === 'orbit' || order === 'strafe' ? 'arrive' : order,
    radius, alt: rng.range(PILOT.altMin + 4, PILOT.altMax - 4), dir: rng.sign(),
    hx: craft.x, hz: craft.z, hy: craft.y,
    t: 0, passT: rng.range(PILOT.passEvery[0], PILOT.passEvery[1]), passing: 0, burstT: 0, passFired: false,
    roofT: 0, roof: 0, seeT: 0, sees: false, aimT: 0, dist: 0,
    crashT: 0, exploded: false, weaponsFree: true, shots: 0, hits: 0,
    tvx: 0, tvz: 0, ptx: NaN, ptz: NaN, phase: 0, runT: 0, overT: 0,
  };
  if (!craft.controls) craft.controls = { steer: 0, pitch: 0, throttle: 0, brake: 0, handbrake: false };
  return p;
}

export function setOrder(p, order, opts = null) {
  if (!p || p.state === 'crash' || p.state === 'done' || p.state === 'ditch') return;
  if (order === 'evade') order = 'retreat';
  if (opts) {
    if (opts.target !== undefined) p.target = opts.target;
    if (opts.radius > 0) p.radius = opts.radius;
    if (Number.isFinite(opts.x)) p.hx = opts.x;
    if (Number.isFinite(opts.z)) p.hz = opts.z;
    if (Number.isFinite(opts.y)) p.hy = opts.y;
  }
  if (order === 'hover' && !(opts && Number.isFinite(opts.x))) {
    p.hx = p.craft.x;
    p.hz = p.craft.z;
    p.hy = p.craft.y;
  }
  p.order = order;
  p.passing = 0;
  p.state = order === 'retreat' ? 'evade' : order === 'orbit' || order === 'strafe' ? 'orbit' : order;
}

// ---- world helpers -----------------------------------------------------------
function roofAt(game, x, z) {
  const col = game.collision || (game.world && game.world.collision);
  if (!col || typeof col.heightAt !== 'function') return 0;
  const h = col.heightAt(x, z);
  return h > 0 ? h : 0;
}
// Highest roof within r of (x, z): the center and 8 points around it.
function roofNear(game, x, z, r) {
  let m = roofAt(game, x, z);
  for (let k = 0; k < 8; k++) {
    const a = (k * Math.PI) / 4;
    const h = roofAt(game, x + Math.cos(a) * r, z + Math.sin(a) * r);
    if (h > m) m = h;
    const h2 = roofAt(game, x + Math.cos(a) * r * 0.5, z + Math.sin(a) * r * 0.5);
    if (h2 > m) m = h2;
  }
  return m;
}
// Highest roof along a strip from (x, z) in direction (ux, uz), len m
// long and 2 x lat wide, sampled every PATH_STEP m from 3 m out.
const PATH_STEP = 7;
function pathRoof(game, x, z, ux, uz, len, lat) {
  let m = 0;
  const n = Math.min(12, Math.ceil(len / PATH_STEP));
  for (let k = 0; k < n; k++) {
    const d = Math.min(len, 3 + k * PATH_STEP);
    const px = x + ux * d, pz = z + uz * d;
    const h = Math.max(roofAt(game, px, pz), roofAt(game, px - uz * lat, pz + ux * lat), roofAt(game, px + uz * lat, pz - ux * lat));
    if (h > m) m = h;
  }
  return m;
}
// Clear 3D line: the segment stays above every roof under it.
export function clearLine(game, x0, y0, z0, x1, y1, z1) {
  const d = Math.hypot(x1 - x0, z1 - z0);
  const n = Math.min(40, Math.ceil(d / 6));
  for (let i = 1; i < n; i++) {
    const t = i / n;
    const y = y0 + (y1 - y0) * t;
    if (roofAt(game, x0 + (x1 - x0) * t, z0 + (z1 - z0) * t) > y - 0.5) return false;
  }
  return true;
}
function targetY(game, t) {
  if (!t) return 0;
  const p = game.player;
  if (t === p) return (p.y || 0) + (p.vehicle ? ((p.vehicle.spec && p.vehicle.spec.height) || 1.5) * 0.5 : 1.1);
  if (t.spec) return craftBase(game, t) + ((t.spec.height) || 1.5) * 0.5;
  return (t.y || 0) + 1.1;
}
function targetSpeed(game, t) {
  const p = game.player;
  if (t === p) {
    if (p.vehicle) return Math.abs(p.vehicle.speed || 0);
    return p.walker ? Math.abs(p.walker.speed || 0) : 0;
  }
  return Math.abs(t.speed || 0);
}
function targetUp(game, t) {
  if (!t) return false;
  const p = game.player;
  if (t === p) {
    const w = p.walker;
    if (p.vehicle) return !p.vehicle.wrecked;
    return !!w && canBeHit(w) && !(w.fade > 0);
  }
  if (t.spec) return !t.wrecked && !t.removed;
  return canBeHit(t) && !(t.fade > 0);
}
function hitEntity(game, t) {
  const p = game.player;
  if (t === p) return p.walker || p.vehicle;
  return t;
}

// ---- flying ------------------------------------------------------------------
// Fly toward the wanted horizontal velocity (wvx, wvz) and height wy,
// facing `face` when hovering (NaN: keep the heading).
function fly(game, p, wvx, wvz, wy, face, landing = false) {
  const a = p.craft, s = a.spec, c = a.controls;
  let ws = Math.hypot(wvx, wvz);
  const vmax = s.maxSpeed * 0.92;
  if (ws > vmax) {
    wvx *= vmax / ws;
    wvz *= vmax / ws;
    ws = vmax;
  }
  // Roof avoidance: look ahead along the wanted path.
  const sp = Math.hypot(a.vx, a.vz);
  const hx = ws > 0.5 ? wvx / ws : Math.cos(a.heading), hz = ws > 0.5 ? wvz / ws : Math.sin(a.heading);
  // Hovering or settling: only the spot itself (rotor clearance).
  const still = ws < 3 && sp < 3;
  const look = still ? 3 : 14 + Math.max(sp, ws) * 2.6, lat = still ? 2.5 : 5;
  // Near the craft too (a wall within the rotor's reach), then every few
  // meters out, so a narrow tower between samples is not missed.
  let ahead = Math.max(roofAt(game, a.x, a.z), pathRoof(game, a.x, a.z, hx, hz, look, lat));
  // The way the craft is actually drifting (it turns slower than the
  // wanted path does): far enough to stop in.
  let drift = 0;
  if (!still && sp > 2) drift = pathRoof(game, a.x, a.z, a.vx / sp, a.vz / sp, 10 + sp * 2.2, lat);
  if (drift > ahead) ahead = drift;
  if (!landing && wy < ahead + PILOT.climbOver) wy = ahead + PILOT.climbOver;
  // Way ahead still above us: stop going forward and climb first.
  const blocked = ahead > a.y - 6;
  const want = Number.isFinite(face) && ws < 3 ? face : ws > 0.5 ? Math.atan2(wvz, wvx) : a.heading;
  const err = angleDiff(want, a.heading);
  c.steer = clamp(err * 2.2, -1, 1);
  let fwd = ws * Math.max(0, Math.cos(err));
  if (Math.abs(err) > 1.2) fwd = Math.min(fwd, 4);
  if (blocked) fwd = 0;
  c.pitch = clamp(fwd / s.maxSpeed, -1, 1);
  const tv = clamp((wy - a.y) * 0.7, -s.sinkRate, s.climbRate);
  c.throttle = tv > 0 ? tv / s.climbRate : 0;
  c.brake = tv < 0 ? -tv / s.sinkRate : 0;
}

function hold(p) {
  const c = p.craft.controls;
  c.steer = 0;
  c.pitch = 0;
  c.throttle = 0;
  c.brake = 0;
}

function emitShot(game, p, mx, my, mz, hx, hy, hz, kind) {
  const ev = game.events;
  if (!ev || !ev.emit) return;
  const s = EVENT_PAYLOADS.shot;
  let dx = hx - mx, dy = hy - my, dz = hz - mz;
  const d = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
  dx /= d;
  dy /= d;
  dz /= d;
  s.shooter = p.craft;
  s.weapon = GUN;
  s.x = mx;
  s.y = my;
  s.z = mz;
  s.dx = dx;
  s.dy = dy;
  s.dz = dz;
  s.hx = hx;
  s.hy = hy;
  s.hz = hz;
  s.hitKind = kind;
  ev.emit('shot', s);
}
const MISS = { kind: 'none', t: 0, x: 0, y: 0, z: 0, actor: null, craft: null };

// One gunner step: fires the chin gun at its own rate while bursting.
function gunner(game, p) {
  const a = p.craft, t = p.target;
  const sys = game.combat;
  if (!sys || !sys.armsOf || !t || p.t < PILOT.quiet || !p.weaponsFree || !targetUp(game, t)) return;
  const arms = sys.armsOf(a);
  if (!arms || !(GUN in arms.mag)) return;
  if (tryMount(arms, GUN) === USE_NO) return;
  const h = a.heading;
  const mx = a.x + Math.cos(h) * (a.spec.length * 0.3), mz = a.z + Math.sin(h) * (a.spec.length * 0.3);
  const my = craftBase(game, a) + 0.6;
  const tx = t.x, ty = targetY(game, t), tz = t.z;
  const d = Math.sqrt((tx - mx) * (tx - mx) + (ty - my) * (ty - my) + (tz - mz) * (tz - mz));
  p.shots++;
  const chance = gunnerChance(d, targetSpeed(game, t), p.aimT);
  if (p.rng.next() < chance) {
    p.hits++;
    emitShot(game, p, mx, my, mz, tx, ty, tz, t === game.player && !game.player.vehicle ? 'actor' : 'craft');
    damage(game, hitEntity(game, t), MOUNTS[GUN].dmg, a, 'bullet');
    return;
  }
  // A miss lands near the target: tracer to the ground or a wall.
  const side = p.rng.next() < 0.5 ? -1 : 1;
  const off = (1.5 + p.rng.next() * 3) * side;
  const hl = Math.hypot(tx - mx, tz - mz) || 1;
  const ax = tx + (-(tz - mz) / hl) * off, az = tz + ((tx - mx) / hl) * off, ay = ty - 0.8 - p.rng.next();
  let dx = ax - mx, dy = ay - my, dz = az - mz;
  const dl = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
  dx /= dl;
  dy /= dl;
  dz /= dl;
  let hx = mx + dx * dl * 1.3, hy = my + dy * dl * 1.3, hz = mz + dz * dl * 1.3, kind = 'none';
  if (sys.trace) {
    sys.trace(mx, my, mz, dx, dy, dz, Math.min(MOUNTS[GUN].range, dl * 1.5), null, a, MISS);
    if (MISS.kind !== 'none') {
      hx = MISS.x;
      hy = MISS.y;
      hz = MISS.z;
      kind = MISS.kind === 'water' ? 'ground' : MISS.kind === 'actor' || MISS.kind === 'craft' ? 'none' : MISS.kind;
    }
  }
  emitShot(game, p, mx, my, mz, hx, hy, hz, kind);
}

function night(game) {
  const h = game.clock;
  if (!Number.isFinite(h)) return false;
  const d = Math.abs((((h % 24) + 24) % 24) - 12.5);
  return d > 5.8;
}

// One pilot step (after the vehicles have stepped).
export function stepHeliPilot(game, p, dt) {
  const a = p.craft;
  if (p.state === 'done') return;
  if (a.removed) {
    p.state = 'done';
    return;
  }
  p.t += dt;
  // ---- crash: spin down, explode on contact ----
  if (a.wrecked || p.state === 'crash') {
    if (p.state !== 'crash') {
      p.state = 'crash';
      p.crashT = 0;
      a.siren = false;
      a.spotOn = false;
    }
    p.crashT += dt;
    if (!a.onGround) a.heading = angleDiff(a.heading + PILOT.spin * dt, 0);
    if (!p.exploded && (a.onGround || a.onWater || p.crashT > PILOT.crashMax)) {
      p.exploded = true;
      const sys = game.combat;
      if (sys && sys.explode) {
        craftBlast(a, HB);
        sys.explode(a.x, (a.y || 0) + 1.2, a.z, HB.r, a.lastHitBy || null, 0, HB.scale, a);
      }
      a.scorched = true;
      a.ai = null; // the sweep may clear the wreck now
      a.driver = null;
      p.state = 'done';
    }
    return;
  }
  // ---- pilot shot dead (seat 0): the craft autorotates down in one
  // piece, and once down it is an empty police heli anyone can take ----
  if (a.occ && !(a.occ[0] > 0) && p.state !== 'ditch') {
    p.state = 'ditch';
    a.siren = false;
    a.spotOn = false;
  }
  if (p.state === 'ditch') {
    if (a.onGround || a.onWater) {
      hold(p);
      a.driver = null;
      a.ai = null;
      a.pilot = null;
      a.occ = null;
      a.occDown = null;
      p.state = 'done';
      return;
    }
    fly(game, p, -a.vx * 0.5, -a.vz * 0.5, roofAt(game, a.x, a.z) - 10, NaN, true);
    return;
  }
  const t = p.target;
  const tx = t ? t.x : p.hx, tz = t ? t.z : p.hz;
  // Target velocity from its motion (works for any target object).
  if (Number.isFinite(p.ptx) && dt > 0) {
    const k = Math.min(1, dt * 3);
    p.tvx += ((tx - p.ptx) / dt - p.tvx) * k;
    p.tvz += ((tz - p.ptz) / dt - p.tvz) * k;
  }
  p.ptx = tx;
  p.ptz = tz;
  const rx = a.x - tx, rz = a.z - tz;
  const d = Math.hypot(rx, rz) || 1e-6;
  p.dist = d;
  const ux = rx / d, uz = rz / d;
  // Roofs near the target, every 0.5 s.
  p.roofT -= dt;
  if (p.roofT <= 0) {
    p.roofT = 0.5;
    p.roof = roofNear(game, tx, tz, PILOT.roofNear);
  }
  const ty = t ? targetY(game, t) : 0;
  // Sight, every 0.25 s.
  p.seeT -= dt;
  if (p.seeT <= 0) {
    p.seeT = 0.25;
    const d3 = Math.hypot(d, a.y - ty);
    p.sees = !!t && d3 < PILOT.sight && clearLine(game, a.x, a.y, a.z, tx, ty, tz);
  }
  // Too hurt: back off.
  if ((p.state === 'orbit' || p.state === 'strafe' || p.state === 'arrive') && a.health < a.spec.health * PILOT.evadeAt) p.state = 'evade';

  const orbitY = Math.max(p.roof, ty) + p.alt;
  let firing = false;
  switch (p.state) {
    case 'arrive': {
      if (d < p.radius + 45) p.state = 'orbit';
      fly(game, p, -ux * 40 + p.tvx, -uz * 40 + p.tvz, orbitY, NaN);
      break;
    }
    case 'orbit':
    case 'evade': {
      // Over tall roofs it stands further off, so it is never steeply
      // overhead (at most PILOT.maxElev above the target's horizon).
      const R = Math.max(p.state === 'evade' ? PILOT.evadeR : p.radius, (Math.max(orbitY, a.y) - ty) / Math.tan(PILOT.maxElev));
      const corr = clamp((R - d) * 0.9, -16, 16);
      // Across speed: a slow circle, or round to the station ahead of a
      // moving target (bearing measured from the target to the heli).
      let v = PILOT.orbitV * p.dir;
      const ts = Math.hypot(p.tvx, p.tvz);
      if (p.state === 'orbit' && ts > PILOT.leadSpeed) {
        const want = Math.atan2(p.tvz, p.tvx) + PILOT.leadSide * p.dir;
        v = clamp(angleDiff(want, Math.atan2(uz, ux)) * R * 0.6, -PILOT.leadV, PILOT.leadV);
      }
      fly(game, p, p.tvx - uz * v + ux * corr, p.tvz + ux * v + uz * corr, orbitY + (p.state === 'evade' ? 20 : 0), NaN);
      if (p.order === 'strafe' && p.state === 'orbit') {
        p.passT -= dt;
        if (p.passT <= 0 && p.t > PILOT.quiet) {
          p.state = 'strafe';
          p.phase = 0;
          p.passing = 0;
          p.burstT = 0;
          p.passFired = false;
        }
      }
      break;
    }
    case 'strafe': {
      // A straight pass: set up 100+ m out at pass height, run in at the
      // target, burst once in range, carry on past, back to the orbit.
      p.passing += dt;
      const fx = Math.cos(a.heading), fz = Math.sin(a.heading);
      const toT = -(ux * fx + uz * fz); // > 0 while the target is ahead
      const passY = Math.max(roofAt(game, tx, tz), ty) + 22;
      if (p.phase === 0) {
        const corr = clamp((110 - d) * 0.9, -20, 20);
        fly(game, p, p.tvx - uz * 8 * p.dir + ux * corr, p.tvz + ux * 8 * p.dir + uz * corr, passY, NaN);
        if ((d > 95 && a.y < passY + 25) || p.passing > 12) {
          p.phase = 1;
          p.runT = 0;
        }
      } else if (p.phase === 1) {
        p.runT += dt;
        fly(game, p, -ux * PILOT.passV + p.tvx, -uz * PILOT.passV + p.tvz, passY, NaN);
        if (p.runT > 1.5 && (toT < 0.2 || d < 18)) {
          p.phase = 2;
          p.overT = 0;
        }
      } else {
        p.overT += dt;
        fly(game, p, fx * PILOT.passV, fz * PILOT.passV, passY + 6, NaN);
        if (p.overT > 2.5 || p.passing > 30) {
          p.state = 'orbit';
          p.passT = p.rng.range(PILOT.passEvery[0], PILOT.passEvery[1]);
        }
      }
      if (!p.passFired && p.phase === 1 && p.sees && toT > 0.9 && d < 105 && d > 20) {
        p.passFired = true;
        p.burstT = PILOT.burst;
      }
      if (p.burstT > 0) {
        p.burstT -= dt;
        firing = true;
      }
      break;
    }
    case 'hover':
      fly(game, p, p.hx - a.x, p.hz - a.z, Math.max(p.hy, roofAt(game, p.hx, p.hz) + 8), t ? Math.atan2(tz - a.z, tx - a.x) : NaN);
      break;
    case 'leave': {
      fly(game, p, ux * 40, uz * 40, Math.max(a.y, orbitY) + 30, NaN);
      const pl = game.player;
      if (pl && Math.hypot(a.x - pl.x, a.z - pl.z) > PILOT.leaveDist) {
        if (game.removeVehicle) game.removeVehicle(a);
        else a.removed = true;
        p.state = 'done';
      }
      break;
    }
    case 'land': {
      const lx = p.hx - a.x, lz = p.hz - a.z;
      const ld = Math.hypot(lx, lz);
      if (a.onGround) {
        hold(p);
        p.state = 'landed';
        break;
      }
      if (ld > 5) fly(game, p, lx * 0.8, lz * 0.8, roofAt(game, p.hx, p.hz) + 20, NaN);
      else fly(game, p, lx, lz, roofAt(game, p.hx, p.hz) - 10, NaN, true);
      break;
    }
    case 'landed':
      hold(p);
      break;
    default:
      hold(p);
  }
  // Aim ramp: the target held in sight within the gun's swivel.
  if (t && p.sees) {
    const bear = Math.atan2(tz - a.z, tx - a.x);
    if (Math.abs(angleDiff(bear, a.heading)) < MOUNTS[GUN].bend) p.aimT += dt;
    else p.aimT = Math.max(0, p.aimT - dt * 2);
  } else p.aimT = 0;
  if (firing) gunner(game, p);
  // Beam on the target while hunting, and at night.
  const hunting = p.state === 'orbit' || p.state === 'strafe' || p.state === 'evade' || p.state === 'hover';
  a.spotOn = !!t && (hunting || night(game));
  a.spotAim = !!t;
  if (t) {
    a.spotX = tx;
    a.spotY = t === game.player ? game.player.y || 0 : t.y || 0;
    a.spotZ = tz;
  }
}

// Spawn a police helicopter with a pilot. See the API notes at the top.
const HB = { r: 0, scale: 1 };
export function spawnPoliceHeli(game, opts = {}) {
  const target = opts.target !== undefined ? opts.target : game.player;
  const tx = target ? target.x : 0, tz = target ? target.z : 0;
  let x = opts.x, z = opts.z;
  if (!Number.isFinite(x) || !Number.isFinite(z)) {
    const behind = Number.isFinite(game.camHeading) ? game.camHeading + Math.PI : 0;
    const ang = Number.isFinite(opts.angle) ? opts.angle : behind;
    const dist = opts.dist > 0 ? opts.dist : PILOT.spawnDist;
    x = tx + Math.cos(ang) * dist;
    z = tz + Math.sin(ang) * dist;
  }
  const a = createAircraft('patrolheli', x, z, Math.atan2(tz - z, tx - x), null);
  const y = Math.max(Number.isFinite(opts.y) ? opts.y : PILOT.spawnY, roofAt(game, x, z) + 20);
  a.y = a.py = y;
  a.onGround = false;
  a.placed = true;
  a.rotorSpeed = 1;
  a.engineOn = true;
  a.driver = 'ai';
  a.police = true;
  a.siren = opts.siren !== undefined ? !!opts.siren : true;
  // The pilot sets off the wreck's explosion itself when it hits the
  // ground, so combat must not blow it up in mid-air.
  a.exploded = true;
  a.controls = { steer: 0, pitch: 0, throttle: 0, brake: 0, handbrake: false };
  const p = createHeliPilot(a, { target, order: opts.order || 'orbit', radius: opts.radius || PILOT.orbitR, seed: opts.seed });
  a.ai = p;
  a.pilot = p;
  if (game.police && game.police.crewUp) game.police.crewUp(a); // pilot and gunner can be killed
  if (game.addVehicle) game.addVehicle(a);
  else if (game.vehicles) game.vehicles.push(a);
  pilotList(game).push(p);
  return p;
}

function pilotList(game) {
  if (game.helipilot && game.helipilot.pilots) return game.helipilot.pilots;
  if (!game.heliPilots) game.heliPilots = [];
  return game.heliPilots;
}

// Step every pilot (used by the system and by headless tests).
export function stepPilots(game, dt) {
  const list = pilotList(game);
  for (let i = list.length - 1; i >= 0; i--) {
    const p = list[i];
    stepHeliPilot(game, p, dt);
    if (p.state === 'done') list.splice(i, 1);
  }
}

// ---- player's police heli: spotlight toggle -----------------------------------
export function toggleSpot(game, craft) {
  if (!craft || !craft.spec || !craft.spec.police) return false;
  craft.spotOn = !craft.spotOn;
  craft.spotAim = false;
  const ev = game.events;
  if (ev && ev.emit) ev.emit('spotlight', craft, craft.spotOn);
  return true;
}
// SPOT (input 'spot', keyboard L in tests) through the combat craft hook.
CRAFT_HOOKS.patrolheli.controls = (game, craft, input) => {
  if (input && input.consume && input.consume('spot')) toggleSpot(game, craft);
};

// The system: pilots, spotlight ramps, the SPOT button.
export function createHeliPilots(game) {
  const pilots = [];
  if (game.heliPilots) pilots.push(...game.heliPilots);
  const sys = {
    name: 'helipilot',
    pilots,
    spawn: (opts) => spawnPoliceHeli(game, opts),
    setOrder,
    button: null,
    fixedUpdate(dt) {
      stepPilots(game, dt);
      // Spotlights fade in and out.
      const vs = game.vehicles;
      for (let i = 0; i < vs.length; i++) {
        const v = vs[i];
        if (!v.spec || !v.spec.police || v.kind !== 'heli') continue;
        const want = v.spotOn && !v.wrecked ? 1 : 0;
        if (v.spot !== want) v.spot = clamp(v.spot + (want ? 4 : -4) * dt, 0, 1);
      }
    },
  };
  game.helipilot = sys;
  const touch = game.touch;
  if (touch && typeof touch.registerAction === 'function') {
    sys.button = touch.registerAction({
      id: 'spot', label: 'Spotlight', text: 'SPOT', group: 'secondary', modes: ['heli'], input: 'spot',
      icon: '<circle cx="8" cy="8" r="3"/><path d="M10 10l9 9M6 13l-2 7 7-2"/>',
      visible: () => {
        const v = game.player && game.player.vehicle;
        return !!(v && v.spec && v.spec.police);
      },
    });
  }
  return sys;
}
