// Rival crew AI: the Velvet Anchors. Members are combat actors (team
// 'crew') on foot or riding in crew cars. States (docs/COMBAT.md "Rival
// crew"): patrol -> alert -> engage (from cover, bursts of 3 to 5) ->
// chase (crew car, police pursuit driver, drive-by shots) -> flee.
//
// The first half is shared fighting logic that police.js uses too:
// hit chance, attack slots, a per-step line-of-sight budget, an AI shot
// and a cheap foot mover. The second half is the crew system with the
// mission API (spawnGroup / order / setHostile / status / despawn).
//
// Pure logic at import: meshes are made only when game.scene exists.
import { createRng, clamp, angleDiff, TAU } from '../core/rng.js';
import { createVehicle } from '../entities/vehicle.js';
import { exitPosition } from '../entities/onfoot.js';
import { createDriver, driveStep } from './traffic.js';
import { createCop, chaseStep } from './police.js';
import { createPersonMesh, updatePersonMesh } from '../render/personmesh.js';
import { lanePoint, lanesPerDirection } from '../world/citygen.js';
import {
  initActor, resetActor, addActor, removeActor, layDown, damage, canBeHit,
  isPlayerSource, EVENT_PAYLOADS, MUZZLE_Y, craftBase,
} from './combat.js';
import { WEAPONS, createArms, tryUse, USE_NO, USE_LAST, selectWeapon } from '../core/weapons.js';

// ---------------------------------------------------------------------
// Tunables
// ---------------------------------------------------------------------
export const CREW_MAX = 8;
export const SPOT_DIST = 35; // sees a hostile player this far, with a clear line
export const HEAR_DIST = 50; // hears shots this far
export const CHASE_DIST = 30; // player further than this in a craft: chase
export const COVER_RING = 6;
export const DIFFICULTY = 0.8;
export const AIM_RAMP_T = 0.8;
export const PLAYER_DMG_MULT = 0.6;
export const ATTACK_SLOTS = 3;
export const LOS_PER_STEP = 6; // line-of-sight rays per 1/60 s step, crew and officers together
export const COVERS_PER_STEP = 1; // cover searches (8 rays each) per step
export const THINK_T = 0.2; // seconds between decisions per actor (staggered)
const WALK_V = 1.8, RUN_V = 4.4, FLEE_V = 5.6;
const FLEE_HP = 0.25, FLEE_CHANCE = 0.25;
const ALLY_CALL = 50; // other groups this close join in
const MORALE_DIST = 40;
const BOARD_DIST = 25; // a crew car this close is worth running to
const EXIT_DIST = 22; // in a car: stop and get out when the player on foot is this close
const DRIVEBY_DIST = 30;
const DESPAWN = 230;

// ---------------------------------------------------------------------
// Hit chance (COMBAT.md): 0.55 x (1 - d/range) x 1/(1 + v/8) x aim ramp x difficulty
// ---------------------------------------------------------------------
export function hitChance(d, range, playerSpeed, aimT, difficulty = DIFFICULTY) {
  if (!(d >= 0) || !(range > 0) || d >= range) return 0;
  const ramp = clamp((aimT || 0) / AIM_RAMP_T, 0, 1);
  const sp = Math.abs(playerSpeed) || 0;
  return 0.55 * (1 - d / range) * (1 / (1 + sp / 8)) * ramp * difficulty;
}

// ---------------------------------------------------------------------
// Attack slots: at most ATTACK_SLOTS shooters at once (crew + officers).
// ---------------------------------------------------------------------
export function attackSlots(game) {
  let s = game.attackSlots;
  if (!s) {
    s = game.attackSlots = { holder: [], until: new Float64Array(ATTACK_SLOTS) };
    for (let i = 0; i < ATTACK_SLOTS; i++) s.holder.push(null);
  }
  return s;
}
const slotDead = (a, until, time) => !a || until < time || a.active === false || !canBeHit(a);

export function takeSlot(game, a, time, hold = 2.5) {
  const s = attackSlots(game);
  let free = -1;
  for (let i = 0; i < ATTACK_SLOTS; i++) {
    if (s.holder[i] === a && s.until[i] >= time) return true;
    if (free < 0 && slotDead(s.holder[i], s.until[i], time)) free = i;
  }
  if (free < 0) return false;
  s.holder[free] = a;
  s.until[free] = time + hold;
  return true;
}

export function releaseSlot(game, a) {
  const s = game.attackSlots;
  if (!s) return;
  for (let i = 0; i < ATTACK_SLOTS; i++) if (s.holder[i] === a) s.holder[i] = null;
}

export function slotsInUse(game, time) {
  const s = game.attackSlots;
  if (!s) return 0;
  let n = 0;
  for (let i = 0; i < ATTACK_SLOTS; i++) if (!slotDead(s.holder[i], s.until[i], time)) n++;
  return n;
}

// ---------------------------------------------------------------------
// Line of sight budget: returns 1 clear, 0 blocked, -1 out of budget.
// ---------------------------------------------------------------------
function budget(game) {
  let b = game.losBudget;
  if (!b) b = game.losBudget = { stamp: NaN, left: 0, covers: 0, used: 0, peak: 0 };
  if (b.stamp !== game.time) {
    b.stamp = game.time;
    const spent = LOS_PER_STEP - b.left;
    if (spent > b.peak) b.peak = spent;
    b.left = LOS_PER_STEP;
    b.covers = COVERS_PER_STEP;
  }
  return b;
}

export function losRay(game, x0, z0, x1, z1) {
  const b = budget(game);
  if (b.left <= 0) return -1;
  b.left--;
  b.used++;
  const col = game.collision;
  return !col || col.lineClear(x0, z0, x1, z1) ? 1 : 0;
}

// ---------------------------------------------------------------------
// Where the player is, as a target.
// ---------------------------------------------------------------------
export function playerSpeedOf(game) {
  const p = game.player;
  if (!p) return 0;
  if (p.vehicle) return Math.abs(p.vehicle.speed || 0);
  return p.walker ? p.walker.speed || 0 : 0;
}
export function playerUp(game) {
  const p = game.player;
  const w = p && p.walker;
  return !!p && (!w || !w.life || canBeHit(w)) && !(w && w.fade > 0);
}
// Height of the player's centre (a craft: its middle).
function playerAimY(game) {
  const p = game.player, v = p.vehicle;
  if (v) return craftBase(game, v) + ((v.spec && v.spec.height) || 1.5) * 0.5;
  return (p.y || 0) + 1.1;
}

// ---------------------------------------------------------------------
// One AI shot at the player. The rng roll decides hit or miss (COMBAT.md
// hit chance); a hit damages the player (x PLAYER_DMG_MULT), a miss draws
// a tracer that passes close by. Returns 0 not fired, 1 miss, 2 hit.
// ---------------------------------------------------------------------
const MISS_TR = { kind: 'none', t: 0, x: 0, y: 0, z: 0, actor: null, craft: null };
export function aiShoot(game, a, chance, rng, craft = null, weaponId = null) {
  const arms = a.arms;
  const p = game.player;
  if (!arms || !p || !canBeHit(a)) return 0;
  const id = weaponId || arms.weapon;
  const w = WEAPONS[id];
  if (!w || w.type !== 'hitscan') return 0;
  const r = tryUse(arms, id);
  const ev = game.events;
  if (r === USE_NO) return 0;
  if (r === USE_LAST && ev && ev.emit) {
    const e = EVENT_PAYLOADS.reload;
    e.actor = a;
    e.weapon = id;
    ev.emit('reload', e);
  }
  // Muzzle.
  let mx, my, mz;
  const tx = p.x, tz = p.z, ty = playerAimY(game);
  if (craft) {
    const h = craft.heading || 0;
    const rx = -Math.sin(h), rz = Math.cos(h);
    const side = (tx - craft.x) * rx + (tz - craft.z) * rz >= 0 ? 1 : -1;
    const off = ((craft.spec && craft.spec.width) || 1.8) * 0.5 + 0.3;
    mx = craft.x + rx * off * side;
    mz = craft.z + rz * off * side;
    my = craftBase(game, craft) + ((craft.spec && craft.spec.height) || 1.5) * 0.8;
  } else {
    const ex = tx - a.x, ez = tz - a.z;
    const el = Math.sqrt(ex * ex + ez * ez) || 1;
    mx = a.x + (ex / el) * 0.3;
    mz = a.z + (ez / el) * 0.3;
    my = (a.y || 0) + MUZZLE_Y;
  }
  let dx = tx - mx, dy = ty - my, dz = tz - mz;
  let d = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (!(d > 1e-6)) return 0;
  const hit = rng.next() < chance;
  let hx, hy, hz, kind;
  if (hit) {
    hx = tx;
    hy = ty;
    hz = tz;
    kind = p.vehicle ? 'craft' : 'actor';
  } else {
    // Aim past the player: sideways 0.8..2.2 m, a little high or low.
    const hl = Math.sqrt(dx * dx + dz * dz) || 1;
    const side = rng.next() < 0.5 ? -1 : 1;
    const off = (0.8 + rng.next() * 1.4) * side;
    const ax = tx + (-dz / hl) * off, az = tz + (dx / hl) * off, ay = ty + (rng.next() - 0.4) * 1.2;
    dx = ax - mx;
    dy = ay - my;
    dz = az - mz;
    d = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
    dx /= d;
    dy /= d;
    dz /= d;
    const len = Math.min(w.range, d + 8);
    const sys = game.combat;
    if (sys && sys.trace) {
      sys.trace(mx, my, mz, dx, dy, dz, len, a, craft, MISS_TR);
      hx = MISS_TR.x;
      hy = MISS_TR.y;
      hz = MISS_TR.z;
      kind = MISS_TR.kind === 'wall' || MISS_TR.kind === 'ground' || MISS_TR.kind === 'water' ? MISS_TR.kind : 'none';
      if (kind === 'water') kind = 'ground';
    } else {
      hx = mx + dx * len;
      hy = my + dy * len;
      hz = mz + dz * len;
      kind = 'none';
    }
    d = 1;
  }
  if (hit) {
    dx /= d;
    dy /= d;
    dz /= d;
  }
  if (ev && ev.emit) {
    const s = EVENT_PAYLOADS.shot;
    s.shooter = a;
    s.weapon = id;
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
  if (hit) {
    const target = p.walker || p.vehicle;
    if (target) damage(game, target, w.dmg * PLAYER_DMG_MULT, a, 'bullet');
  }
  return hit ? 2 : 1;
}

// ---------------------------------------------------------------------
// Foot actors (crew and officers share this body).
// ---------------------------------------------------------------------
export function createFootActor(team, rng, weapon = 'pistol') {
  const a = {
    active: false,
    x: 0, z: 0, y: 0, heading: 0, px: 0, pz: 0, pheading: 0,
    vx: 0, vz: 0, speed: 0, moving: false, stride: 0, radius: 0.35,
    state: 'patrol', group: null, car: null, inCar: null, seat: 0,
    homeX: 0, homeZ: 0, tx: 0, tz: 0, moveV: 0,
    think: rng.next() * THINK_T, los: false, aimT: 0, lastSeen: 99,
    seenX: 0, seenZ: 0, alertT: 0,
    burst: 0, burstCool: 0, shooting: false,
    coverX: 0, coverZ: 0, peekX: 0, peekZ: 0, hasCover: false, coverT: 0, peeking: false,
    coverFromX: 0, coverFromZ: 0, coverAge: 99, coverPhase: rng.next() * TAU,
    stuckT: 0, fleeT: 0, fleeRolled: false, idleT: 0, flee: false,
    detourT: 0, dtx: 0, dtz: 0, detourSide: 1, peekT: 0, covered: false, coverGood: false,
    mesh: null, tag: null, shots: 0, hits: 0,
  };
  initActor(a, team);
  a.arms = createArms(weapon);
  return a;
}

export function placeFootActor(a, x, z, heading = 0) {
  a.x = a.px = x;
  a.z = a.pz = z;
  a.y = 0;
  a.heading = a.pheading = heading;
  a.vx = a.vz = a.speed = 0;
  a.moving = false;
  a.homeX = a.tx = x;
  a.homeZ = a.tz = z;
  a.moveV = 0;
  a.los = false;
  a.aimT = 0;
  a.lastSeen = 99;
  a.burst = 0;
  a.burstCool = 0;
  a.hasCover = false;
  a.peeking = false;
  a.coverAge = 99;
  a.stuckT = 0;
  a.detourT = 0;
  a.fleeT = 0;
  a.fleeRolled = false;
  a.flee = false;
  a.inCar = null;
  a.alertT = 0;
  a.shots = a.hits = 0;
  resetActor(a);
  if (a.arms) {
    const w = WEAPONS[a.arms.weapon];
    if (w && w.mag > 0) a.arms.mag[w.id] = w.mag;
    a.arms.reloading = null;
    a.arms.cool = 0;
  }
  return a;
}

const isGroundAt = (game, x, z) => {
  const c = game.city;
  return !c || !c.isGround || c.isGround(x, z);
};

// Move toward (a.tx, a.tz) at a.moveV, sliding on walls, craft and the
// shore. Also records a hard hit by a craft for combat (bumpBy/bumpV).
export function stepFoot(game, a, dt) {
  a.px = a.x;
  a.pz = a.z;
  a.pheading = a.heading;
  if (a.life !== 'ok') {
    a.vx = a.vz = a.speed = 0;
    a.moving = false;
    return;
  }
  let wvx = 0, wvz = 0;
  // Stuck against a wall on the way: walk round it for a moment.
  if (a.detourT > 0) a.detourT -= dt;
  else if (a.stuckT > 0.5) startDetour(game, a);
  const gx = a.detourT > 0 ? a.dtx : a.tx, gz = a.detourT > 0 ? a.dtz : a.tz;
  const ex = gx - a.x, ez = gz - a.z;
  const d = Math.sqrt(ex * ex + ez * ez);
  if (d > 0.25 && a.moveV > 0) {
    const sp = d < 1 ? a.moveV * d : a.moveV;
    wvx = (ex / d) * sp;
    wvz = (ez / d) * sp;
  }
  const k = Math.min(1, 10 * dt);
  a.vx += (wvx - a.vx) * k;
  a.vz += (wvz - a.vz) * k;
  const ox = a.x, oz = a.z;
  let nx = ox + a.vx * dt, nz = oz + a.vz * dt;
  const vs = game.vehicles;
  if (vs) {
    for (let i = 0; i < vs.length; i++) {
      const c = vs[i];
      if (!c || c.removed || (c.y || 0) > 3) continue;
      const qx = nx - c.x, qz = nz - c.z;
      if (qx > 8 || qx < -8 || qz > 8 || qz < -8) continue;
      const rr = (c.radius || 2) * 0.6 + a.radius;
      const d2 = qx * qx + qz * qz;
      if (d2 >= rr * rr) continue;
      const dd = Math.sqrt(d2);
      if (dd > 1e-6) {
        const closing = ((c.vx || 0) - a.vx) * (qx / dd) + ((c.vz || 0) - a.vz) * (qz / dd);
        if (closing > (a.bumpV || 0)) {
          a.bumpBy = c;
          a.bumpV = closing;
        }
        const push = Math.min(rr - dd, 6 * dt + Math.max(0, closing) * dt);
        nx += (qx / dd) * push;
        nz += (qz / dd) * push;
      } else nx += 0.05;
    }
  }
  const col = game.collision;
  if (col) {
    const r = col.resolveCircle(nx, nz, a.radius, 0);
    nx = r.x;
    nz = r.z;
  }
  if (!isGroundAt(game, nx, nz) && isGroundAt(game, ox, oz)) {
    nx = ox;
    nz = oz;
  }
  if (!Number.isFinite(nx) || !Number.isFinite(nz)) {
    nx = ox;
    nz = oz;
    a.vx = a.vz = 0;
  }
  a.x = nx;
  a.z = nz;
  const dist = Math.sqrt((nx - ox) * (nx - ox) + (nz - oz) * (nz - oz));
  a.speed = dt > 0 ? dist / dt : 0;
  a.moving = a.speed > 0.2;
  if (dt > 0) {
    a.vx = (nx - ox) / dt;
    a.vz = (nz - oz) / dt;
  }
  a.stride = (a.stride + (dist / 1.5) * TAU) % TAU;
  // Stuck against something while trying to move.
  if (a.moveV > 0.5 && d > 1 && a.speed < a.moveV * 0.25) a.stuckT += dt;
  else a.stuckT = Math.max(0, a.stuckT - dt);
}

function startDetour(game, a) {
  a.stuckT = 0;
  const col = game.collision;
  let ux = a.tx - a.x, uz = a.tz - a.z;
  const l = Math.sqrt(ux * ux + uz * uz) || 1;
  ux /= l;
  uz /= l;
  const left = col ? col.raycast(a.x, a.z, -uz, ux, 6) : 6, right = col ? col.raycast(a.x, a.z, uz, -ux, 6) : 6;
  a.detourSide = left === right ? -(a.detourSide || 1) : left > right ? 1 : -1;
  const s = a.detourSide, r = Math.min(4, Math.max(1, (s > 0 ? left : right) - 0.5));
  a.dtx = a.x - uz * r * s + ux * 0.8;
  a.dtz = a.z + ux * r * s + uz * 0.8;
  a.detourT = 1.4;
}

// Face the travel direction, or a point while standing (aiming).
export function faceToward(a, x, z, dt, rate = 10) {
  const want = Math.atan2(z - a.z, x - a.x);
  a.heading = angleDiff(a.heading + angleDiff(want, a.heading) * Math.min(1, rate * dt), 0);
}

// ---------------------------------------------------------------------
// Cover choice: 8 directions on a COVER_RING m ring around the actor;
// a point counts as cover when the 2D ray from it to the threat hits a
// wall. Writes { found, covered, x, z, px, pz } (px, pz: peek spot).
// ---------------------------------------------------------------------
export function chooseCover(game, a, tx, tz, out) {
  out.found = false;
  out.covered = false;
  const col = game.collision;
  if (!col) return out;
  let best = -Infinity;
  for (let k = 0; k < 8; k++) {
    const ang = a.coverPhase + (k * TAU) / 8;
    let cx = a.x + Math.cos(ang) * COVER_RING, cz = a.z + Math.sin(ang) * COVER_RING;
    const r = col.resolveCircle(cx, cz, 0.45, 0);
    cx = r.x;
    cz = r.z;
    if (!isGroundAt(game, cx, cz)) continue;
    const dx = tx - cx, dz = tz - cz;
    const d = Math.sqrt(dx * dx + dz * dz);
    if (d < 5) continue;
    const ux = dx / d, uz = dz / d;
    const wallD = col.raycast(cx, cz, ux, uz, d);
    const covered = wallD < d - 0.6;
    let s = covered ? 10 : 0;
    if (covered && wallD < 3) s += 2; // hugging the wall: can peek out
    s -= Math.abs(d - 16) * 0.12; // like mid range
    s += (a.x - tx) * (a.x - tx) + (a.z - tz) * (a.z - tz) > (cx - tx) * (cx - tx) + (cz - tz) * (cz - tz) ? 0.5 : 0;
    if (s > best) {
      best = s;
      out.found = true;
      out.covered = covered;
      out.x = cx;
      out.z = cz;
      out.d = d;
      out.ux = ux;
      out.uz = uz;
    }
  }
  if (out.found) findPeek(col, out, tx, tz);
  return out;
}

// Peek spot for a cover point: slide sideways (1 to 5 m, either side,
// never through a wall) until the line to the threat clears.
function findPeek(col, out, tx, tz) {
  const cx = out.x, cz = out.z;
  out.px = cx;
  out.pz = cz;
  if (!out.covered) return;
  const pxv = -out.uz, pzv = out.ux;
  const left = col.raycast(cx, cz, pxv, pzv, 5.5), right = col.raycast(cx, cz, -pxv, -pzv, 5.5);
  for (let step = 1; step <= 5; step++) {
    for (let k = 0; k < 2; k++) {
      const sgn = k === 0 ? 1 : -1;
      if ((sgn > 0 ? left : right) < step + 0.4) continue;
      const qx = cx + pxv * sgn * step, qz = cz + pzv * sgn * step;
      if (col.lineClear(qx, qz, tx, tz)) {
        out.px = qx;
        out.pz = qz;
        return;
      }
    }
  }
  // Nowhere clear close by: step out as far as there is room.
  const sgn = left >= right ? 1 : -1, reach = Math.max(0, Math.min(2, Math.max(left, right) - 0.4));
  out.px = cx + pxv * sgn * reach;
  out.pz = cz + pzv * sgn * reach;
}

// ---------------------------------------------------------------------
// The crew system
// ---------------------------------------------------------------------
const CREW_PALETTES = [
  { shirt: 0x6e1f4f, trousers: 0x1c1a2c, skin: 0xc68e62, hair: 0xd4a93a },
  { shirt: 0x7a2a5e, trousers: 0x202036, skin: 0x8d5a3b, hair: 0x1b1410 },
  { shirt: 0x5b1a45, trousers: 0x1a1a24, skin: 0xe0b48c, hair: 0x6b3a1e },
];
const HANGOUT_DISTRICTS = { docks: 3, industrial: 2.5, midtown: 1, beach: 1, downtown: 0.6, residential: 0.4 };
const COVER = { found: false, covered: false, x: 0, z: 0, px: 0, pz: 0, d: 0, ux: 1, uz: 0 };
const EXIT = { x: 0, z: 0, ok: false };
const LP = { x: 0, z: 0, heading: 0 };

function createStatus() {
  return { total: 0, ok: 0, down: 0, out: 0, fled: 0, inCar: 0, alive: 0, engaged: 0 };
}

export function createCrew(game, { seed = 27027, ambient = true, max = CREW_MAX } = {}) {
  const rng = createRng(seed);
  const pool = [];
  for (let i = 0; i < max; i++) pool.push(createFootActor('crew', rng, 'pistol'));
  const members = []; // active members
  const groups = [];
  let nextGroupId = 1;
  let ambientTimer = 4;
  const status = createStatus();
  const driveCtx = { time: 0, vehicles: game.vehicles };
  const chaseCtx = { collision: game.collision, vehicles: game.vehicles, time: 0 };
  const footTarget = { x: 0, z: 0, vx: 0, vz: 0, heading: 0, y: 0, spec: null };
  let stepCount = 0;
  const stats = { shots: 0, hits: 0, thinks: 0, covers: 0 };

  // --- Groups ---
  function freeMember() {
    for (let i = 0; i < pool.length; i++) if (!pool[i].active) return pool[i];
    return null;
  }

  function makeCar(spec, x, z, heading) {
    const v = createVehicle(spec || 'sedan', x, z, heading, rng);
    v.controls = { steer: 0, throttle: 0, brake: 0, handbrake: true };
    v.asleep = false;
    v.crew = true;
    if (game.addVehicle) game.addVehicle(v);
    else if (game.vehicles) game.vehicles.push(v);
    return v;
  }

  // Spawn a group. opts: { x, z, heading, n, tag, hostile, car: spec |
  // vehicle | null, drive: 'patrol'|'chase'|'flee'|'route'|null,
  // weapon: 'pistol'|'smg'|'mixed', ambient }. Returns the group or null.
  function spawnGroup(opts = {}) {
    const n = Math.max(1, Math.min(opts.n || 3, max));
    let free = 0;
    for (let i = 0; i < pool.length; i++) if (!pool[i].active) free++;
    if (free < 1) return null;
    const x = +opts.x || 0, z = +opts.z || 0, heading = +opts.heading || 0;
    const g = {
      id: nextGroupId++, tag: opts.tag || null, hostile: !!opts.hostile,
      ambient: !!opts.ambient, members: [], car: null, cop: null, driver: null,
      order: opts.drive ? 'drive' : 'patrol', drive: opts.drive || null,
      allyDowns: 0, alertT: 0, x, z, exitT: 0,
    };
    if (opts.car) {
      const v = typeof opts.car === 'object' ? opts.car : makeCar(opts.car, x, z, heading);
      v.crew = true;
      v.hostile = g.hostile;
      v.crewGroup = g;
      g.car = v;
      g.driver = createDriver(game.city, rng);
      if (opts.drive === 'flee') g.driver.speedFactor = 1.4;
      g.cop = createCop(game.city, rng);
      v.ai = opts.drive === 'chase' ? g.cop : g.driver;
      v.driver = v.ai;
      v.controls = v.controls || { steer: 0, throttle: 0, brake: 0, handbrake: false };
      if (opts.drive === 'chase') g.order = 'chase';
    }
    for (let k = 0; k < n; k++) {
      const m = freeMember();
      if (!m) break;
      const ang = (k / n) * TAU + rng.next() * 0.5;
      const rr = n > 1 ? 1.4 : 0;
      let mx = x + Math.cos(ang) * rr, mz = z + Math.sin(ang) * rr;
      if (game.collision) {
        const r = game.collision.resolveCircle(mx, mz, 0.35, 0);
        mx = r.x;
        mz = r.z;
      }
      placeFootActor(m, mx, mz, ang + Math.PI);
      const wpn = opts.weapon === 'smg' ? 'smg' : opts.weapon === 'pistol' ? 'pistol' : rng.next() < 0.3 ? 'smg' : 'pistol';
      selectWeapon(m.arms, wpn);
      m.arms.mag[wpn] = WEAPONS[wpn].mag;
      if (game.actors && !addActor(game, m)) break; // actor cap reached
      m.active = true;
      m.group = g;
      m.tag = g.tag;
      m.state = 'patrol';
      m.think = (members.length * THINK_T) / max; // stagger decisions
      m.coverPhase = rng.next() * TAU;
      if (g.car && k < 2 && g.drive) {
        m.inCar = g.car;
        m.seat = k;
        m.x = m.px = g.car.x;
        m.z = m.pz = g.car.z;
        m.state = g.order === 'chase' ? 'chase' : 'patrol';
      }
      g.members.push(m);
      members.push(m);
    }
    if (!g.members.length) {
      if (g.car) releaseCar(g, typeof opts.car !== 'object');
      return null;
    }
    groups.push(g);
    if (g.hostile && g.order === 'chase') for (let i = 0; i < g.members.length; i++) g.members[i].state = 'chase';
    return g;
  }

  function groupsOf(ref, out) {
    out.length = 0;
    for (let i = 0; i < groups.length; i++) {
      const g = groups[i];
      if (ref === g || (typeof ref === 'string' && g.tag === ref) || ref === undefined || ref === null) out.push(g);
    }
    return out;
  }
  const REF = [];

  function setHostile(ref, on = true) {
    groupsOf(ref, REF);
    for (let i = 0; i < REF.length; i++) {
      REF[i].hostile = !!on;
      if (REF[i].car) REF[i].car.hostile = !!on;
    }
    return REF.length;
  }

  // Orders: 'patrol' (calm, back to idling), 'hold' (stay, fight from
  // here), 'attack' (hostile, engage now), 'chase' (hostile, get in the
  // car and pursue), 'flee', 'drive' (car: wander the roads).
  function order(ref, what) {
    groupsOf(ref, REF);
    for (let i = 0; i < REF.length; i++) {
      const g = REF[i];
      g.order = what;
      for (let k = 0; k < g.members.length; k++) {
        const m = g.members[k];
        if (!m.active || m.life !== 'ok') continue;
        if (what === 'attack' || what === 'chase') {
          g.hostile = true;
          if (g.car) g.car.hostile = true;
          m.state = what === 'chase' ? 'chase' : 'engage';
        } else if (what === 'flee') startFlee(m);
        else if (what === 'patrol' || what === 'hold') {
          m.state = 'patrol';
          m.homeX = m.x;
          m.homeZ = m.z;
          m.flee = false;
          releaseSlot(game, m);
        }
      }
    }
    return REF.length;
  }

  function statusOf(ref) {
    const s = status;
    s.total = s.ok = s.down = s.out = s.fled = s.inCar = s.alive = s.engaged = 0;
    for (let i = 0; i < groups.length; i++) {
      const g = groups[i];
      if (!(ref === undefined || ref === null || ref === g || g.tag === ref)) continue;
      for (let k = 0; k < g.members.length; k++) {
        const m = g.members[k];
        s.total++;
        if (!m.active || m.group !== g) {
          s.out++;
          continue;
        }
        if (m.life === 'out') s.out++;
        else if (m.life === 'down' && m.hp <= 0) s.out++;
        else {
          s.alive++;
          if (m.life === 'ok') s.ok++;
          else s.down++;
          if (m.state === 'flee') s.fled++;
          if (m.inCar) s.inCar++;
          if (m.state === 'engage' || m.state === 'chase') s.engaged++;
        }
      }
    }
    return s;
  }

  function freeMemberSlot(m) {
    releaseSlot(game, m);
    removeActor(game, m);
    m.active = false;
    m.inCar = null;
    m.state = 'patrol';
    if (m.mesh) m.mesh.visible = false;
    const i = members.indexOf(m);
    if (i >= 0) members.splice(i, 1);
  }

  function releaseCar(g, remove) {
    const v = g.car;
    if (!v) return;
    g.car = null;
    v.crewGroup = null;
    if (v.driver !== 'player') {
      v.ai = null;
      v.driver = null;
      v.controls = null;
      if (remove && game.removeVehicle && !v.removed) game.removeVehicle(v);
    }
  }

  function despawn(ref) {
    groupsOf(ref, REF);
    for (let i = 0; i < REF.length; i++) {
      const g = REF[i];
      for (let k = 0; k < g.members.length; k++) if (g.members[k].active && g.members[k].group === g) freeMemberSlot(g.members[k]);
      releaseCar(g, true);
      const j = groups.indexOf(g);
      if (j >= 0) groups.splice(j, 1);
    }
    return REF.length;
  }

  // --- Behaviour helpers ---
  function startFlee(m) {
    if (m.inCar) return;
    m.state = 'flee';
    m.flee = true;
    m.fleeT = 0;
    releaseSlot(game, m);
  }

  function engage(m) {
    if (m.state === 'flee' || m.life !== 'ok') return;
    if (m.state !== 'engage' && m.state !== 'chase') {
      m.state = 'engage';
      m.hasCover = false;
      m.coverAge = 99;
    }
  }

  // A member saw or was hit by the player: the group and nearby groups join.
  function callAllies(g) {
    if (!g) return;
    for (let k = 0; k < g.members.length; k++) {
      const o = g.members[k];
      if (o.active && o.group === g) engage(o);
    }
    for (let i = 0; i < groups.length; i++) {
      const h = groups[i];
      if (h === g) continue;
      const dx = h.members.length ? h.members[0].x - g.members[0].x : 1e9;
      const dz = h.members.length ? h.members[0].z - g.members[0].z : 1e9;
      if (dx * dx + dz * dz > ALLY_CALL * ALLY_CALL) continue;
      if (g.hostile && !h.hostile) {
        h.hostile = true;
        if (h.car) h.car.hostile = true;
      }
      for (let k = 0; k < h.members.length; k++) {
        const o = h.members[k];
        if (o.active && o.group === h && o.state === 'patrol') {
          o.state = h.hostile ? 'engage' : 'alert';
          o.alertT = 0;
        }
      }
    }
  }

  function morale(m, threat) {
    const g = m.group;
    if (!g || g.allyDowns <= 0) return false;
    let friends = 0;
    for (let i = 0; i < members.length; i++) {
      const o = members[i];
      if (o.life !== 'ok' || o.state === 'flee') continue;
      const dx = o.x - m.x, dz = o.z - m.z;
      if (dx * dx + dz * dz < MORALE_DIST * MORALE_DIST) friends++;
    }
    return friends < threat;
  }

  // Nearest crew car of this group (or any unused crew car) within reach.
  function carFor(m) {
    const g = m.group;
    if (g && g.car && !g.car.wrecked && !g.car.removed && g.car.driver !== 'player') return g.car;
    return null;
  }

  function boardCar(m, v) {
    m.inCar = v;
    let seat = 0;
    for (let i = 0; i < members.length; i++) if (members[i] !== m && members[i].inCar === v) seat++;
    m.seat = seat;
    m.vx = m.vz = m.speed = 0;
    m.moving = false;
    releaseSlot(game, m);
  }

  function leaveCar(m) {
    const v = m.inCar;
    m.inCar = null;
    if (!v) return;
    if (v.spec && v.spec.width) exitPosition(v, game.world || { collision: game.collision, city: game.city }, EXIT);
    else EXIT.ok = false;
    const off = m.seat ? 1.2 : 0;
    const x = EXIT.ok ? EXIT.x : v.x + 2, z = EXIT.ok ? EXIT.z : v.z;
    m.x = m.px = x + Math.cos(v.heading) * off;
    m.z = m.pz = z + Math.sin(v.heading) * off;
    m.tx = m.x;
    m.tz = m.z;
    m.hasCover = false;
    m.coverAge = 99;
  }

  // --- Thinking (every THINK_T s per member, staggered) ---
  function think(m) {
    stats.thinks++;
    const p = game.player;
    const g = m.group;
    const dx = p.x - m.x, dz = p.z - m.z;
    const d = Math.sqrt(dx * dx + dz * dz);
    const up = playerUp(game);
    const inCraft = !!p.vehicle;
    const high = (p.y || 0) > 6;
    // Line of sight to the player (budgeted; keeps the old value if none left).
    if (d < 70 && !high) {
      const r = losRay(game, m.x, m.z, p.x, p.z);
      if (r >= 0) m.los = r === 1;
    } else m.los = false;
    if (m.los) {
      m.lastSeen = 0;
      m.seenX = p.x;
      m.seenZ = p.z;
    }
    const hostile = !!(g && g.hostile) && up;

    // Riding: the car does the work; spotting the player starts a pursuit.
    if (m.inCar) {
      if (hostile && (m.state === 'engage' || m.state === 'alert' || (m.los && d < SPOT_DIST))) {
        if (m.state !== 'chase') {
          m.state = 'chase';
          callAllies(g);
        }
      } else if (!hostile && m.state !== 'patrol') m.state = 'patrol';
      return;
    }

    switch (m.state) {
      case 'patrol': {
        m.moveV = WALK_V * 0.6;
        m.idleT -= THINK_T;
        if (m.idleT <= 0) {
          m.idleT = 3 + rng.next() * 4;
          const a = rng.next() * TAU, r = rng.next() * 3;
          m.tx = m.homeX + Math.cos(a) * r;
          m.tz = m.homeZ + Math.sin(a) * r;
        }
        if (hostile && m.los && d < SPOT_DIST) {
          engage(m);
          callAllies(g);
        }
        break;
      }
      case 'alert': {
        m.alertT += THINK_T;
        m.moveV = 0;
        if (hostile && (m.los && d < SPOT_DIST + 10)) {
          engage(m);
          callAllies(g);
        } else if (hostile && m.alertT > 1.5) {
          // Go and look where it came from.
          m.tx = m.seenX;
          m.tz = m.seenZ;
          m.moveV = WALK_V;
          if (m.alertT > 10) m.state = 'patrol';
        } else if (!hostile && m.alertT > 5) m.state = 'patrol';
        break;
      }
      case 'engage': {
        if (!hostile) {
          m.state = 'patrol';
          m.homeX = m.x;
          m.homeZ = m.z;
          releaseSlot(game, m);
          break;
        }
        if (morale(m, 1.5 + (inCraft ? 1 : 0))) {
          startFlee(m);
          break;
        }
        const car = carFor(m);
        if (inCraft && d > CHASE_DIST && car && !high) {
          m.state = 'chase';
          releaseSlot(game, m);
          break;
        }
        engageThink(m, d);
        break;
      }
      case 'chase': {
        const car = carFor(m);
        if (!hostile) {
          m.state = 'patrol';
          break;
        }
        if (!car) {
          m.state = 'engage';
          break;
        }
        if (!m.inCar) {
          const cx = car.x - m.x, cz = car.z - m.z;
          const cd = Math.sqrt(cx * cx + cz * cz);
          if (cd > BOARD_DIST * 2 || (!inCraft && d < EXIT_DIST)) {
            m.state = 'engage';
            break;
          }
          m.tx = car.x;
          m.tz = car.z;
          m.moveV = RUN_V;
          if (cd < (car.radius || 2) * 0.7 + 1.2 && Math.abs(car.speed) < 3) boardCar(m, car);
        }
        break;
      }
      case 'flee': {
        m.fleeT += THINK_T;
        const l = d || 1;
        m.tx = m.x - (dx / l) * 8;
        m.tz = m.z - (dz / l) * 8;
        if (m.stuckT > 0.6) {
          // Blocked: turn a quarter and keep going.
          const t = m.tx - m.x;
          m.tx = m.x - (m.tz - m.z);
          m.tz = m.z + t;
          m.stuckT = 0;
        }
        m.moveV = FLEE_V;
        if (m.fleeT > 12 && d > 70) {
          m.moveV = 0;
          m.homeX = m.x;
          m.homeZ = m.z;
        }
        break;
      }
      default:
        m.state = 'patrol';
    }
  }

  // Engage: cover cycle and bursts.
  function engageThink(m, d) {
    const p = game.player;
    const w = WEAPONS[m.arms.weapon];
    const range = w ? w.range : 40;
    m.coverAge += THINK_T;
    // Too far to shoot or never seen for a while: close in on the last sighting.
    if (d > range * 0.95 || (!m.los && m.lastSeen > 3)) {
      m.hasCover = false;
      m.peeking = false;
      m.tx = m.lastSeen < 6 ? m.seenX : p.x;
      m.tz = m.lastSeen < 6 ? m.seenZ : p.z;
      m.moveV = RUN_V;
      if (d < range * 0.7 && m.los) m.moveV = 0;
      releaseSlot(game, m);
      return;
    }
    // (Re)pick cover when there is none, the player moved a lot, or this
    // one has not let us shoot for a while.
    const moved = (p.x - m.coverFromX) * (p.x - m.coverFromX) + (p.z - m.coverFromZ) * (p.z - m.coverFromZ) > 64;
    if ((!m.hasCover || moved || (m.coverAge > 8 && !m.coverGood)) && !m.shooting) {
      const b = budget(game);
      if (b.covers > 0) {
        b.covers--;
        stats.covers++;
        chooseCover(game, m, p.x, p.z, COVER);
        m.coverAge = 0;
        m.coverGood = false;
        m.coverFromX = p.x;
        m.coverFromZ = p.z;
        if (COVER.found) {
          m.hasCover = true;
          m.coverX = COVER.covered ? COVER.x : m.x;
          m.coverZ = COVER.covered ? COVER.z : m.z;
          m.peekX = COVER.covered ? COVER.px : COVER.x;
          m.peekZ = COVER.covered ? COVER.pz : COVER.z;
          m.covered = COVER.covered;
          m.peeking = false;
          m.coverT = 0.4 + rng.next() * 0.8;
        }
      }
    }
    // Cover cycle: hide (reload, wait), then peek out to fire.
    if (m.hasCover && m.covered) {
      if (!m.peeking) {
        m.tx = m.coverX;
        m.tz = m.coverZ;
        m.moveV = RUN_V;
        const atCover = (m.x - m.coverX) * (m.x - m.coverX) + (m.z - m.coverZ) * (m.z - m.coverZ) < 1.2;
        if (atCover || m.stuckT > 0.5) m.coverT -= THINK_T;
        if (m.coverT <= 0 && !m.arms.reloading && m.burstCool <= 0) {
          m.peeking = true;
          m.peekT = 0;
        }
      } else {
        m.tx = m.peekX;
        m.tz = m.peekZ;
        const atPeek = (m.x - m.peekX) * (m.x - m.peekX) + (m.z - m.peekZ) * (m.z - m.peekZ) < 0.7;
        m.moveV = atPeek ? 0 : RUN_V * 0.7;
        m.peekT += atPeek ? THINK_T : THINK_T * 0.3;
        // Nothing to see from here: try somewhere else.
        if (!m.los && m.peekT > 1.6) {
          m.hasCover = false;
          m.peeking = false;
          m.coverAge = 99;
        }
      }
    } else {
      // No real cover: hold at mid range.
      m.moveV = d > 20 ? WALK_V : 0;
      m.tx = p.x;
      m.tz = p.z;
    }
    // A clear line and a free attack slot: a burst of 3 to 5.
    if (m.burst <= 0 && !m.shooting && m.los && m.burstCool <= 0 && !m.arms.reloading && takeSlot(game, m, game.time, 3)) {
      m.burst = 3 + Math.floor(rng.next() * 3);
      m.shooting = true;
      if (m.peeking) m.coverGood = true;
      if (m.hasCover && m.covered && !m.peeking) m.moveV = 0; // stop and shoot
    }
    if (m.shooting && !(m.hasCover && m.covered && !m.peeking)) m.moveV = Math.min(m.moveV, WALK_V * 0.5);
  }

  function endBurst(m) {
    m.shooting = false;
    m.burst = 0;
    m.burstCool = 0.8 + rng.next() * 1.0;
    releaseSlot(game, m);
    if (m.hasCover) {
      m.peeking = false;
      m.coverT = 0.8 + rng.next() * 1.4;
    }
  }

  // --- Per-step member update ---
  function stepMember(m, dt) {
    const p = game.player;
    if (m.lastSeen < 99) m.lastSeen += dt;
    if (m.burstCool > 0) m.burstCool -= dt;
    if (m.life !== 'ok') {
      m.shooting = false;
      m.burst = 0;
      m.aimT = 0;
      if (m.inCar) leaveCar(m);
      releaseSlot(game, m);
      m.px = m.x;
      m.pz = m.z;
      return;
    }
    m.think -= dt;
    if (m.think <= 0) {
      m.think += THINK_T;
      think(m);
    }
    if (m.inCar) {
      const v = m.inCar;
      m.px = m.x;
      m.pz = m.z;
      m.x = v.x;
      m.z = v.z;
      m.heading = v.heading;
      m.speed = 0;
      m.moving = false;
      // Drive-by from the passenger side (or the driver if alone).
      const d = Math.hypot(p.x - v.x, p.z - v.z);
      if (m.group && m.group.hostile && m.los && d < DRIVEBY_DIST && playerUp(game)) {
        m.aimT += dt;
        if (takeSlot(game, m, game.time, 1.5)) {
          const wid = m.arms.lastGun || 'pistol';
          const ch = hitChance(d, WEAPONS[wid].range, playerSpeedOf(game), m.aimT) * 0.7;
          const r = aiShoot(game, m, ch, rng, v, wid);
          if (r) {
            stats.shots++;
            m.shots++;
            if (r === 2) {
              stats.hits++;
              m.hits++;
            }
          }
        }
      } else m.aimT = 0;
      return;
    }
    stepFoot(game, m, dt);
    // Shooting.
    const dx = p.x - m.x, dz = p.z - m.z;
    const d = Math.sqrt(dx * dx + dz * dz);
    const engaged = m.state === 'engage' && m.los;
    if (engaged) {
      m.aimT += dt;
      faceToward(m, p.x, p.z, dt, 12);
    } else {
      m.aimT = Math.max(0, m.aimT - dt * 2);
      if (m.moving) faceToward(m, m.x + m.vx, m.z + m.vz, dt);
      else if (m.state === 'alert') faceToward(m, m.seenX, m.seenZ, dt, 4);
    }
    if (m.shooting) {
      if (!engaged || !playerUp(game)) {
        if (!engaged && m.lastSeen > 0.6) endBurst(m);
      } else if (m.burst > 0 && !m.arms.reloading) {
        const w = WEAPONS[m.arms.weapon];
        const ch = hitChance(d, w.range, playerSpeedOf(game), m.aimT);
        const r = aiShoot(game, m, ch, rng, null, null);
        if (r) {
          m.burst--;
          stats.shots++;
          m.shots++;
          if (r === 2) {
            stats.hits++;
            m.hits++;
          }
          if (m.burst <= 0) endBurst(m);
        }
      } else if (m.arms.reloading) endBurst(m);
    }
  }

  // --- Crew car per group ---
  function stepCar(g, dt) {
    const v = g.car;
    if (!v) return;
    if (v.removed) {
      g.car = null;
      return;
    }
    if (v.driver === 'player' || game.player.vehicle === v) {
      // Hijacked: anyone inside gets pulled out and fights.
      for (let i = 0; i < g.members.length; i++) {
        const m = g.members[i];
        if (m.inCar === v) {
          leaveCar(m);
          if (m.life === 'ok') {
            g.hostile = true;
            engage(m);
          }
        }
      }
      v.crewGroup = null;
      v.ai = null;
      g.car = null;
      return;
    }
    v.hostile = g.hostile;
    let riders = 0, chasing = 0;
    for (let i = 0; i < g.members.length; i++) {
      const m = g.members[i];
      if (m.inCar === v) {
        riders++;
        if (m.state === 'chase') chasing++;
      }
    }
    const c = v.controls || (v.controls = { steer: 0, throttle: 0, brake: 0, handbrake: false });
    if (v.wrecked || v.burning) {
      for (let i = 0; i < g.members.length; i++) if (g.members[i].inCar === v) leaveCar(g.members[i]);
      c.steer = c.throttle = 0;
      c.brake = 1;
      c.handbrake = true;
      return;
    }
    if (riders === 0) {
      v.driver = null;
      c.steer = c.throttle = c.brake = 0;
      c.handbrake = true;
      return;
    }
    const p = game.player;
    const d = Math.hypot(p.x - v.x, p.z - v.z);
    // Get out to fight a player on foot nearby.
    if (g.hostile && chasing > 0 && !p.vehicle && d < EXIT_DIST && playerUp(game)) {
      c.steer = c.throttle = 0;
      c.brake = Math.abs(v.speed) > 1 ? 1 : 0;
      c.handbrake = Math.abs(v.speed) < 1;
      if (Math.abs(v.speed) < 2.5) {
        for (let i = 0; i < g.members.length; i++) {
          const m = g.members[i];
          if (m.inCar === v) {
            leaveCar(m);
            m.state = 'engage';
          }
        }
      }
      return;
    }
    if (chasing > 0 && g.hostile) {
      v.ai = g.cop;
      v.driver = g.cop;
      v.siren = false;
      chaseCtx.vehicles = game.vehicles;
      chaseCtx.collision = game.collision;
      chaseCtx.time = game.time;
      let target = p.vehicle;
      if (!target) {
        footTarget.x = p.x;
        footTarget.z = p.z;
        footTarget.vx = p.walker ? p.walker.vx || 0 : 0;
        footTarget.vz = p.walker ? p.walker.vz || 0 : 0;
        footTarget.heading = p.heading || 0;
        target = footTarget;
      }
      chaseStep(g.cop, v, dt, target, chaseCtx);
    } else {
      if (v.ai !== g.driver) {
        g.driver = createDriver(game.city, rng); // re-attaches to the nearest lane
        v.ai = g.driver;
      }
      v.driver = g.driver;
      driveCtx.time = game.time;
      driveCtx.vehicles = game.vehicles;
      driveStep(g.driver, v, dt, driveCtx);
    }
  }

  // --- Ambient hangouts and crew cars ---
  function hiddenFromPlayer(x, z) {
    const p = game.player, col = game.collision;
    return col && col.lineClear ? !col.lineClear(p.x, p.z, x, z) : true;
  }

  function ambientSpawn() {
    const city = game.city, p = game.player;
    if (!city || !city.blocks) return;
    let free = 0;
    for (let i = 0; i < pool.length; i++) if (!pool[i].active) free++;
    if (free < 3) return;
    // Mostly a hangout on foot; sometimes a crew car cruising.
    if (rng.next() < 0.3 && city.edges && city.nodes) {
      for (let tries = 0; tries < 12; tries++) {
        const e = city.edges[Math.floor(rng.next() * city.edges.length)];
        if (e.causeway) continue;
        const a = city.nodes[e.a];
        const dx = a.x - p.x, dz = a.z - p.z;
        const d = Math.sqrt(dx * dx + dz * dz);
        if (d < 100 || d > 170) continue;
        const dist = rng.range(15, Math.max(16, e.length - 15));
        lanePoint(city, e, e.a, dist, Math.floor(rng.next() * lanesPerDirection(e)), LP);
        if (!hiddenFromPlayer(LP.x, LP.z)) continue;
        if (!clearOfCars(LP.x, LP.z, 12)) continue;
        spawnGroup({ x: LP.x, z: LP.z, heading: LP.heading, n: 2, car: 'sedan', drive: 'patrol', ambient: true });
        return;
      }
      return;
    }
    let best = null, bestS = -Infinity;
    for (let tries = 0; tries < 14; tries++) {
      const b = city.blocks[Math.floor(rng.next() * city.blocks.length)];
      const wgt = HANGOUT_DISTRICTS[b.district] || 0;
      if (wgt <= 0) continue;
      const corner = Math.floor(rng.next() * 4);
      const x = corner & 1 ? b.x1 - 2.5 : b.x0 + 2.5;
      const z = corner & 2 ? b.z1 - 2.5 : b.z0 + 2.5;
      const d = Math.hypot(x - p.x, z - p.z);
      if (d < 70 || d > 150) continue;
      if (game.collision && game.collision.resolveCircle(x, z, 0.6, 0).hit) continue;
      const s = wgt + (hiddenFromPlayer(x, z) ? 2 : 0) + rng.next();
      if (s > bestS) {
        bestS = s;
        best = b;
        COVER.x = x;
        COVER.z = z;
      }
    }
    if (best) spawnGroup({ x: COVER.x, z: COVER.z, n: 3, ambient: true });
  }

  function clearOfCars(x, z, r) {
    const vs = game.vehicles;
    for (let i = 0; i < vs.length; i++) {
      const o = vs[i];
      if ((o.x - x) * (o.x - x) + (o.z - z) * (o.z - z) < r * r) return false;
    }
    return true;
  }

  // Remove groups whose members are all gone, and far ambient ones.
  function sweepGroups() {
    const p = game.player;
    for (let i = groups.length - 1; i >= 0; i--) {
      const g = groups[i];
      let live = 0, near = false;
      for (let k = 0; k < g.members.length; k++) {
        const m = g.members[k];
        if (!m.active || m.group !== g) continue;
        if (m.fade >= 1) {
          freeMemberSlot(m);
          continue;
        }
        live++;
        if (Math.hypot(m.x - p.x, m.z - p.z) < DESPAWN) near = true;
      }
      if (g.ambient && (live === 0 || !near)) {
        despawn(g);
        continue;
      }
      if (live === 0 && !g.tag) despawn(g);
    }
  }

  // --- Events: hearing shots, being attacked ---
  const ev = game.events;
  if (ev && ev.on) {
    ev.on('shot', (s) => {
      if (!s || !s.shooter || s.shooter.team === 'crew') return;
      const fromPlayer = isPlayerSource(game, s.shooter);
      for (let i = 0; i < members.length; i++) {
        const m = members[i];
        if (m.life !== 'ok' || m.inCar) continue;
        const dx = m.x - s.x, dz = m.z - s.z;
        if (dx * dx + dz * dz > HEAR_DIST * HEAR_DIST) continue;
        if (m.state === 'patrol') {
          m.state = 'alert';
          m.alertT = 0;
          m.seenX = s.x;
          m.seenZ = s.z;
        }
        if (fromPlayer && m.group && m.group.hostile && m.state === 'alert') {
          m.lastSeen = Math.min(m.lastSeen, 1);
          engage(m);
        }
      }
    });
    ev.on('hit', (h) => {
      const t = h && h.target;
      if (!t || t.team !== 'crew' || !t.group) return;
      const g = t.group;
      if (isPlayerSource(game, h.source)) {
        if (!g.hostile) {
          g.hostile = true;
          if (g.car) g.car.hostile = true;
        }
        t.seenX = game.player.x;
        t.seenZ = game.player.z;
        t.lastSeen = Math.min(t.lastSeen, 0.5);
        engage(t);
        callAllies(g);
      }
      if (t.life === 'ok' && t.hp > 0 && t.hp < t.maxHp * FLEE_HP && !t.fleeRolled) {
        t.fleeRolled = true;
        if (rng.next() < FLEE_CHANCE) startFlee(t);
      }
    });
    ev.on('down', (d) => {
      const t = d && d.target;
      if (!t || t.team !== 'crew' || !t.group || t.hp > 0) return;
      t.group.allyDowns++;
      // Neighbours feel it too.
      for (let i = 0; i < groups.length; i++) {
        const h = groups[i];
        if (h === t.group || !h.members.length) continue;
        const m0 = h.members[0];
        if ((m0.x - t.x) * (m0.x - t.x) + (m0.z - t.z) * (m0.z - t.z) < MORALE_DIST * MORALE_DIST) h.allyDowns++;
      }
    });
  }

  const sys = {
    name: 'crew',
    game,
    rng,
    members,
    groups,
    pool,
    stats,
    ambient,
    spawnGroup,
    order,
    setHostile,
    status: statusOf,
    despawn,
    clear: () => despawn(null),
    byTag(tag, out = []) {
      out.length = 0;
      for (let i = 0; i < members.length; i++) if (members[i].tag === tag) out.push(members[i]);
      return out;
    },
    fixedUpdate(dt) {
      if (!game.player || !(dt > 0)) return;
      stepCount++;
      for (let i = 0; i < groups.length; i++) stepCar(groups[i], dt);
      for (let i = 0; i < members.length; i++) stepMember(members[i], dt);
      // Housekeeping twice a second.
      if (stepCount % 30 === 0) sweepGroups();
      if (sys.ambient && game.city && game.city.blocks) {
        ambientTimer -= dt;
        if (ambientTimer <= 0) {
          ambientTimer = 6;
          const p = game.player;
          let amb = 0;
          for (let i = 0; i < groups.length; i++) if (groups[i].ambient) amb++;
          const away = (p.y || 0) > 40 || (game.city.shoreDist && game.city.shoreDist(p.x, p.z) < -40);
          if (amb < 1 && !away) ambientSpawn();
        }
      }
    },
    render(alpha) {
      if (!game.scene) return;
      for (let i = 0; i < pool.length; i++) {
        const m = pool[i];
        if (!m.active) {
          if (m.mesh && m.mesh.visible) m.mesh.visible = false;
          continue;
        }
        if (!m.mesh) {
          m.mesh = createPersonMesh(CREW_PALETTES[i % CREW_PALETTES.length]);
          if (m.mesh.rotation) m.mesh.rotation.order = 'YXZ';
          game.scene.add(m.mesh);
        }
        if (m.inCar) {
          m.mesh.visible = false;
          continue;
        }
        m.mesh.visible = true;
        updatePersonMesh(m.mesh, m, alpha);
        if (m.life !== 'ok') layDown(m.mesh, m);
        else if (m.mesh.rotation.z !== 0) m.mesh.rotation.z = 0;
      }
    },
  };
  return sys;
}
