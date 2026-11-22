// Combat core: the unified actor state, the one damage() entry point,
// hitscan and projectile hits against buildings, ground, actors and
// craft, blasts, burning craft with a capped explosion chain, the
// player going down and coming back with nothing lost.
//
// Pure logic: no three.js and no DOM, so it runs in node tests. The
// look (combatfx.js), sound (audio.js) and buttons (touch.js) listen to
// the events below. Contract: docs/COMBAT.md.
//
// Wiring for later tasks:
// - Actors: `game.actors` holds every live person; owners call
//   addActor/removeActor. Every actor gets its fields from initActor.
// - Aiming: write a unit direction to `game.aim` (dx, dy, dz) and set
//   `game.aim.manual = true`; otherwise the player shoots along the
//   walker's heading (on foot) or the camera heading (drive-by).
// - Input actions read here: held 'fire', tapped 'swap', 'reload'; and
//   (docs/ARMS.md) held 'fire2', tapped 'drop', 'detonate', 'lock' (in
//   armed aircraft), 'horn' (police craft siren), 'cancel' (throw).
// - AI shooters call `game.combat.fire(actor, dx, dy, dz, craft?, weaponId?)`
//   and craft weapons `game.combat.fireMount(craft, slot, dx, dy, dz, shooter?, target?)`.
// - Anything that hurts calls `damage(game, target, amount, source, kind)`.
// - Craft-specific weapon logic (tank turret, fighter, police heli) plugs
//   into CRAFT_HOOKS below (tasks 32 and 33 fill them).
import { createRng } from '../core/rng.js';
import { exitPosition } from '../entities/onfoot.js';
import {
  RULES, WEAPONS, MOUNTS, createArms, nextWeapon, selectWeapon, startReload, stepArms, tryUse, USE_NO, USE_LAST,
  isThrown, createCraftArms, mountFor, stepCraftArms, tryMount,
} from '../core/weapons.js';
import { createSeeker, resetSeeker, stepSeeker, noseRay } from '../core/seeker.js';
import { targetPoint, angleTo, lineOfSight, AIR_REACH, airborne } from '../core/aim.js';
import { createRagdolls, startRagdoll, kickRagdoll, directRagdoll, stepRagdolls, RAGDOLL_MAX } from '../core/ragdoll.js';
import { poseRagdoll } from '../render/ragdoll.js';

// ---------------------------------------------------------------------
// Tunables (COMBAT.md)
// ---------------------------------------------------------------------
export const HP = { player: 100, civ: 30, crew: 60, police: 70 };
export const CRAFT_MULT = { bullet: 0.5, melee: 0.1, blast: 1, ram: 1, fire: 1 };
export const HIT_FLASH = 0.15;
export const KNOCK_DECAY = 6; // m/s^2
export const ACTOR_HEIGHT = 1.8;
export const MUZZLE_Y = 1.4;
// Bodies stay (REVAMP 6.7, decision D5): a dead person lies BODY_LIE_T s,
// then fades over FADE_T s. At most BODY_MAX lie at once: one more makes
// the oldest start its fade at once. (Was 3 s: nothing you killed stayed.)
export const BODY_LIE_T = 30, BODY_MAX = 12;
export const DOWN_T = 1.6, GETUP_T = 0.6, OUT_LIE_T = BODY_LIE_T, FADE_T = 1;
export const PLAYER_DOWN_T = 2.5, PLAYER_FADE_T = 1;
export const REGEN_DELAY = 5, REGEN_RATE = 10;
export const RAM_MIN = 4; // m/s closing speed that knocks a person down
export const RAM_DMG = 4; // damage per m/s of closing speed
export const BLAST_DMG = 120, BLAST_CRAFT_MULT = 1.5;
export const CRAFT_BLAST_R = 10, CRAFT_PUSH = 12, CRAFT_PUSH_MAX = 14;
// Bigger craft blow up bigger (REVAMP 6.7 "Scale by craft"): damage radius
// car 10 m, heavy car (2,500 kg or more) 11, heli 12, plane 12 (fighter 13),
// tank 14; visual scale 1, 1.1, 1.2, 1.3, 1.5. (Was car 8, tank 12: a pop
// on a 20 m street.)
export function craftBlast(c, out) {
  const m = (c && c.spec && c.spec.mass) || 0;
  if (c && c.kind === 'tank') { out.r = 14; out.scale = 1.5; }
  else if (c && c.kind === 'plane') { out.r = (c.spec && c.spec.id === 'fighter') ? 13 : 12; out.scale = 1.3; }
  else if (c && c.kind === 'heli') { out.r = 12; out.scale = 1.2; }
  else if (c && c.kind === 'car' && m >= 2500) { out.r = 11; out.scale = 1.1; }
  else { out.r = CRAFT_BLAST_R; out.scale = 1; }
  return out;
}
// Shove on craft at the centre: 12 m/s for a car blast up to 14 for a tank.
export const craftPush = (scale) => Math.min(CRAFT_PUSH_MAX, CRAFT_PUSH + Math.max(0, (scale || 1) - 1) * 4);
const CB = { r: CRAFT_BLAST_R, scale: 1 };
// Blast throw: cars are launched (and flipped), people ragdoll.
export const TOSS_G = 9.81;
export const BURN_BELOW = 0.25, BURN_RATE = 0.03, BURN_T = 6;
export const MAX_DEPTH = 2;
export const RATE_WINDOW = 0.5, RATE_MAX = 3, QUEUE_DELAY = 0.3, CHAIN_DELAY = 0.25;
export const LIVE_T = 1.2; // seconds an explosion counts as "live"
export const RESPAWN_CLEAR = 60;
export const GRAVITY = 9.81;
// Burnt hulls stay (REVAMP 6.7 layer 9): a wreck lies WRECK_LIE_T s after
// its blast (flames for WRECK_FLAME_T s, smoke the whole time), then sinks
// and fades over WRECK_FADE_T s and is removed. At most WRECK_MAX hulls: a
// seventh makes the oldest start its fade at once. (Was 3 s in all.)
export const WRECK_LIE_T = 60, WRECK_FADE_T = 2, WRECK_FLAME_T = 12, WRECK_MAX = 6;
export const WRECK_T = WRECK_LIE_T + WRECK_FADE_T; // s from the blast until the hull is removed
// Scorch under a craft blast: 9 m across at scale 1 (layer 8); combatfx keeps it 120 s.
export const SCORCH_CRAFT_D = 9;
export const CAPS = { actors: 40, projectiles: 24, explosions: 4, burning: 4, decals: 24, queue: 8 };
// docs/ARMS.md: live projectiles by type, stickies, throwing, mounts.
export const TYPE_CAPS = { missile: 4, bomb: 6, shell: 4, thrown: 6 };
export const THROWN_PER_PLAYER = 3;
export const STICKY_MAX = 4, STICKY_LIFE = 120, STICKY_FAR = 400, STICKY_GAP = 0.08;
export const STICKY_BEEP_SLOW = 1.1, STICKY_BEEP_FAST = 0.25; // s between beeps, speeding up
export const MISSILE_PROX = 3.5;
export const MISSILE_ASSIST = 18 * Math.PI / 180; // unlocked missile: homes on whatever is this close to the nose
export const OWN_BLAST = 0.25; // own munition vs own craft
export const THROW_PITCH_LO = -0.2, THROW_PITCH_HI = 0.6, THROW_EL = 0.6; // rad: low enough to land before the fuse
export const PREVIEW_PTS = 24, PREVIEW_EVERY = 6, PREVIEW_STEPS = 300;
export const SIM_DT = 1 / 60;
export const explosionSize = (r) => (r < 7 ? 'small' : r < 10 ? 'big' : 'huge');

// Craft-specific weapon hooks, looked up by spec id, then craft kind.
// Every function is optional (null = the default behaviour):
//   controls(game, craft, input, dt)  each step the player is aboard, before firing
//                                     (e.g. tank turret aim from the camera)
//   aim(game, craft, slot, mountId, out) -> true when it wrote the unit fire
//                                     direction into out.x/y/z (default: the nose,
//                                     bent toward the seeker target by `bend`)
//   muzzle(game, craft, slot, mountId, out) -> true when it wrote the world
//                                     muzzle point (default: nose tip; bombs: belly)
//   fired(game, craft, slot, mountId) after each shot (recoil, sound cues)
// The three entries below are registered empty on purpose: task 32 fills
// `tank`, task 33 `fighter` and `patrolheli`. See docs/ARMS.md section 2.
export const CRAFT_HOOKS = {
  tank: { controls: null, aim: null, muzzle: null, fired: null },
  fighter: { controls: null, aim: null, muzzle: null, fired: null },
  patrolheli: { controls: null, aim: null, muzzle: null, fired: null },
};
const NO_HOOKS = { controls: null, aim: null, muzzle: null, fired: null };
export function hooksFor(c) {
  if (!c) return NO_HOOKS;
  return (c.spec && CRAFT_HOOKS[c.spec.id]) || CRAFT_HOOKS[c.kind] || NO_HOOKS;
}

// ---------------------------------------------------------------------
// Shared event payloads: one object per name, filled before each emit.
// Listeners read them during the call and must not keep them.
// ---------------------------------------------------------------------
const EV = {
  shot: { shooter: null, weapon: null, x: 0, y: 0, z: 0, dx: 0, dy: 0, dz: 0, hx: 0, hy: 0, hz: 0, hitKind: 'none' },
  hit: { target: null, source: null, amount: 0, kind: 'bullet', x: 0, y: 0, z: 0, mat: 'flesh', byPlayer: false },
  kill: { target: null, x: 0, z: 0, cause: 'bullet', byPlayer: false, dx: 0, dz: 0 },
  bodyLand: { target: null, x: 0, z: 0 },
  down: { target: null, source: null, kind: 'bullet' },
  out: { target: null, source: null },
  explosion: { x: 0, y: 0, z: 0, radius: 0, source: null, depth: 0, size: 'small', puff: false, craft: null, scale: 1 },
  launch: { shooter: null, craft: null, weapon: null, x: 0, y: 0, z: 0 },
  bombFall: { index: 0, x: 0, y: 0, z: 0, vy: 0 },
  lock: { craft: null, target: null, state: 'seek' },
  sticky: { x: 0, y: 0, z: 0, on: false, beep: false, index: 0 },
  detonate: { count: 0 },
  siren: { craft: null, on: false },
  bounce: { x: 0, y: 0, z: 0, v: 0, weapon: null },
  burning: { craft: null, on: false },
  hullBurn: { craft: null, id: -1, on: false, x: 0, z: 0 },
  reload: { actor: null, weapon: null },
  weaponSwitch: { actor: null, weapon: null },
  empty: { actor: null, weapon: null },
  playerDown: { target: null, source: null, kind: 'bullet' },
  respawn: { x: 0, z: 0 },
  takedown: { target: null, source: null, kind: 'bullet', depth: 0 },
};
export const EVENT_PAYLOADS = EV;

function emit(game, name) {
  const ev = game && game.events;
  if (ev && ev.emit) ev.emit(name, EV[name]);
}

// ---------------------------------------------------------------------
// Actors
// ---------------------------------------------------------------------
// Adds the combat fields to a walker or ped (keeps x, z, y, heading,
// radius, px, pz as they are).
export function initActor(a, team = 'civ') {
  a.team = team;
  a.maxHp = HP[team] || HP.civ;
  a.height = ACTOR_HEIGHT;
  a.arms = a.arms || null;
  resetActor(a);
  return a;
}

export function resetActor(a) {
  a.hp = a.maxHp || HP.civ;
  a.life = 'ok';
  a.lifeT = 0;
  a.fade = 0;
  a.hitT = 0;
  a.kx = 0;
  a.kz = 0;
  a.lastHitBy = null;
  a.sinceHit = 99;
  a.bonks = 0;
  a.bumpBy = null;
  a.bumpV = 0;
  a.ky = 0;
  a.spin = 0;
  a.spinV = 0;
  a.rag = null; // live ragdoll slot (core/ragdoll.js), or null
  a.ragDone = false; // settled ragdoll pose kept in ragYaw / ragPitch
  a.ragYaw = 0;
  a.ragPitch = 0;
  a.ragRoll = 0;
  return a;
}

export function addActor(game, a) {
  const list = game.actors;
  if (!list) return false;
  if (list.indexOf(a) >= 0) return true;
  if (list.length >= CAPS.actors) return false;
  list.push(a);
  return true;
}

export function removeActor(game, a) {
  const list = game.actors;
  if (!list) return;
  const i = list.indexOf(a);
  if (i >= 0) list.splice(i, 1);
}

export const isCraft = (t) => !!(t && t.spec && typeof t.health === 'number' && t.hp === undefined);
export const canBeHit = (a) => a.life === 'ok' || a.life === 'getup';

export function isPlayerSource(game, s) {
  if (!s || !game || !game.player) return false;
  const p = game.player;
  return s === p.walker || s === p.vehicle || s.team === 'player' || s.driver === 'player';
}

// ---------------------------------------------------------------------
// Damage
// ---------------------------------------------------------------------
// Knock-back for the next damage() call (cleared by it). Lets blasts,
// pellets and wrench swings push without an extra argument.
const PUSH = { x: 0, z: 0 };
export function setPush(x, z) {
  PUSH.x = Number.isFinite(x) ? x : 0;
  PUSH.z = Number.isFinite(z) ? z : 0;
}
// Depth of the explosion being applied right now (chain bookkeeping).
let curDepth = -1;

// Falls (REVAMP 6.7 "Body fall direction rule"). Every killing hit has
// one unit ground vector d: a gunshot the way the shot travelled, a blast
// from its centre to the victim, a vehicle the way it was moving. The body
// is thrown along d (a ragdoll from a pool of RAGDOLL_MAX) and ends lying
// along it: on the back when hit from the front, on the face from behind,
// on that side from the side (core/ragdoll.js directRagdoll). Start speed
// along d: bullet 1.5 m/s (shotgun 4), vehicle 0.6 x the closing speed up
// to 14, blast 6 + 10 (1 - distance / radius) with 3 to 6 m/s up.
export const FALL_BULLET = 1.5, FALL_SHOTGUN = 4, FALL_MELEE = 2;
export const FALL_RAM_K = 0.6, FALL_RAM_MAX = 14;
export const FALL_BLAST_V0 = 6, FALL_BLAST_V1 = 10, FALL_BLAST_UP0 = 3, FALL_BLAST_UP1 = 3;
// A car at speed also throws them up over the bonnet.
export const RAM_THROW_UP = 1.2, RAM_THROW_PER = 0.32, RAM_THROW_MAX = 8; // m/s up: base + per m/s of car speed
export const RAM_CARRY = FALL_RAM_K; // share of the car's speed the body keeps
// The fall for the next damage() call (cleared by it), like PUSH.
const FALL = { x: 0, z: 0, v: 0, up: 0, set: false };
export function setFall(dx, dz, v, up = 0) {
  const l = Math.sqrt(dx * dx + dz * dz);
  if (!(l > 1e-6) || !Number.isFinite(l)) return;
  FALL.x = dx / l;
  FALL.z = dz / l;
  FALL.v = v > 0 ? v : 0;
  FALL.up = up > 0 ? up : 0;
  FALL.set = true;
}
// The fall of the hit being applied now (damage() moves FALL here).
const HIT_FALL = { x: 0, z: 0, v: 0, up: 0, set: false };
function startTumble(game, a, source, kind) {
  const pool = game.ragdolls;
  if (!pool || a.team === 'player' || kind === 'fire') return;
  const rng = pool.rng || null;
  let dx = HIT_FALL.x, dz = HIT_FALL.z, v = HIT_FALL.v, up = HIT_FALL.up;
  if (!HIT_FALL.set) {
    // No direction given: the push, else away from the source, else backwards.
    dx = a.kx || 0;
    dz = a.kz || 0;
    if (!(dx * dx + dz * dz > 1e-6) && source && Number.isFinite(source.x)) {
      dx = a.x - source.x;
      dz = a.z - source.z;
    }
    if (!(dx * dx + dz * dz > 1e-6)) {
      dx = -Math.cos(a.heading || 0);
      dz = -Math.sin(a.heading || 0);
    }
    const l = Math.sqrt(dx * dx + dz * dz);
    dx /= l;
    dz /= l;
    v = kind === 'blast' ? FALL_BLAST_V0 : kind === 'melee' ? FALL_MELEE : kind === 'ram' ? 4 : FALL_BULLET;
    up = kind === 'blast' ? FALL_BLAST_UP0 : 0;
  }
  if (kind === 'ram' && source && Number.isFinite(source.vx) && !HIT_FALL.set) {
    const sp = Math.sqrt(source.vx * source.vx + source.vz * source.vz);
    if (sp > 0.5) {
      dx = source.vx / sp;
      dz = source.vz / sp;
      v = Math.min(FALL_RAM_MAX, FALL_RAM_K * sp);
      up = Math.min(RAM_THROW_MAX, RAM_THROW_UP + RAM_THROW_PER * sp);
    }
  }
  const s = startRagdoll(pool, a, dx * v, up, dz * v, rng);
  if (!s) return;
  // Tip over toward the lying pose; harder hits turn faster.
  directRagdoll(s, dx, dz, Math.min(6.5, 2.2 + v * 0.35));
}

function knockDown(game, a, source, kind) {
  a.life = 'down';
  a.lifeT = 0;
  if (a.vx !== undefined) a.vx = a.vz = 0;
  startTumble(game, a, source, kind);
  const d = EV.down;
  d.target = a;
  d.source = source;
  d.kind = kind;
  emit(game, 'down');
  if (a.hp > 0) return;
  if (a.team !== 'player') {
    // A death: its fall direction for the sound and the kill freeze.
    const k = EV.kill;
    k.target = a;
    k.x = a.x;
    k.z = a.z;
    k.cause = kind === 'ram' ? 'vehicle' : kind;
    k.byPlayer = isPlayerSource(game, source);
    const s = a.rag;
    const v = s ? Math.sqrt(s.vx * s.vx + s.vz * s.vz) : 0;
    k.dx = v > 1e-6 ? s.vx / v : 0;
    k.dz = v > 1e-6 ? s.vz / v : 0;
    emit(game, 'kill');
    k.target = null;
  }
  if (a.team === 'player') {
    const pd = EV.playerDown;
    pd.target = a;
    pd.source = source;
    pd.kind = kind;
    emit(game, 'playerDown');
  } else if (isPlayerSource(game, source)) {
    const t = EV.takedown;
    t.target = a;
    t.source = source;
    t.kind = kind;
    t.depth = curDepth < 0 ? 0 : curDepth;
    emit(game, 'takedown');
  }
}

function emitHit(game, target, source, amount, kind, y) {
  const h = EV.hit;
  h.target = target;
  h.source = source;
  h.amount = amount;
  h.kind = kind;
  h.x = target.x;
  h.y = y;
  h.z = target.z;
  h.mat = isCraft(target) ? 'metal' : 'flesh';
  h.byPlayer = isPlayerSource(game, source);
  emit(game, 'hit');
}

// Height of the bullet hit on the craft being damaged (NaN = unknown, counts
// as a cabin hit). Set by the hitscan sites right before damage().
let HIT_Y = NaN;
export function setHitY(y) {
  HIT_Y = y;
}

// Occupants: a craft may carry `occ` (hp per seat, seat 0 = driver) and
// `occDown(craft, seat, source, kind)`, set by its owner (police). A bullet
// into the cabin hurts the first live seat, a blast hurts every seat, a
// wreck kills all. The owner turns a dead seat into a body and events.
const OCC_BLAST = 0.6;
export function occupantsAlive(c) {
  let n = 0;
  if (c && c.occ) for (let i = 0; i < c.occ.length; i++) if (c.occ[i] > 0) n++;
  return n;
}
function seatDown(game, c, seat, source, kind) {
  c.occ[seat] = 0;
  if (c.occDown) c.occDown(c, seat, source, kind);
}
export function killOccupants(game, c, source, kind) {
  if (!c || !c.occ) return 0;
  let n = 0;
  for (let i = 0; i < c.occ.length; i++) {
    if (c.occ[i] > 0) {
      seatDown(game, c, i, source, kind);
      n++;
    }
  }
  return n;
}
function hurtOccupants(game, c, amount, source, kind, hitY) {
  if (kind === 'bullet') {
    const h = (c.spec && c.spec.height) || 1.5;
    if (Number.isFinite(hitY) && hitY - craftBase(game, c) < h * 0.3) return; // low: engine, wheels
    for (let i = 0; i < c.occ.length; i++) {
      if (!(c.occ[i] > 0)) continue;
      c.occ[i] -= amount;
      if (c.occ[i] <= 0) seatDown(game, c, i, source, kind);
      return;
    }
  } else if (kind === 'blast') {
    for (let i = 0; i < c.occ.length; i++) {
      if (!(c.occ[i] > 0)) continue;
      c.occ[i] -= amount * OCC_BLAST;
      if (c.occ[i] <= 0) seatDown(game, c, i, source, kind);
    }
  }
}

function damageCraft(game, c, amount, source, kind, px, pz) {
  if (c.wrecked || c.removed) return 0;
  const hitY = HIT_Y;
  HIT_Y = NaN;
  const armor = c.spec && c.spec.armor;
  const applied = amount * (CRAFT_MULT[kind] ?? 1) * (armor && armor[kind] !== undefined ? armor[kind] : 1);
  if (!(applied > 0)) return 0;
  c.health -= applied;
  c.lastHitBy = source;
  c.lastKind = kind;
  c.combatHit = true;
  if (c.occ) hurtOccupants(game, c, amount, source, kind, hitY);
  c.hitT = HIT_FLASH;
  // Depth an explosion of this craft would have (blast chains count up).
  c.chainDepth = kind === 'blast' && curDepth >= 0 ? curDepth + 1 : kind === 'fire' ? (c.chainDepth || 0) : 0;
  if (px || pz) {
    c.vx += px;
    c.vz += pz;
    c.asleep = false;
    c.meshDirty = true;
  }
  emitHit(game, c, source, applied, kind, (c.y || 0) + (c.spec.height || 1.5) * 0.5);
  if (c.health <= 0) {
    c.health = 0;
    c.wrecked = true;
    if (isPlayerSource(game, source) && c !== game.player.vehicle) {
      const t = EV.takedown;
      t.target = c;
      t.source = source;
      t.kind = kind;
      t.depth = curDepth < 0 ? 0 : curDepth;
      emit(game, 'takedown');
    }
    const sys = game.combat;
    if (sys && sys.craftDestroyed) sys.craftDestroyed(c, c.chainDepth || 0);
  }
  return applied;
}

// The only way to hurt anything. Returns the damage applied.
export function damage(game, target, amount, source = null, kind = 'bullet') {
  const px = PUSH.x, pz = PUSH.z;
  PUSH.x = PUSH.z = 0;
  HIT_FALL.set = FALL.set;
  HIT_FALL.x = FALL.x;
  HIT_FALL.z = FALL.z;
  HIT_FALL.v = FALL.v;
  HIT_FALL.up = FALL.up;
  FALL.set = false;
  if (!target || !(amount > 0) || !Number.isFinite(amount)) return 0;
  const p = game && game.player;
  // The player cannot die: nothing that hurts them, or the craft they sit in, counts.
  if (RULES.invulnerable && p && (target === p.walker || (p.vehicle && target === p.vehicle))) return 0;
  // The player in a craft is not hit directly: the craft takes it.
  if (p && target === p.walker && p.vehicle) {
    PUSH.x = px;
    PUSH.z = pz;
    FALL.set = false;
    return damage(game, p.vehicle, amount, source, kind);
  }
  if (isCraft(target)) return damageCraft(game, target, amount, source, kind, px, pz);
  if (typeof target.hp !== 'number' || !canBeHit(target) || target.fade > 0) return 0;
  const applied = Math.min(amount, Math.max(0, target.hp));
  target.hp = Math.max(0, target.hp - amount);
  target.hitT = HIT_FLASH;
  target.lastHitBy = source;
  target.sinceHit = 0;
  target.kx += px;
  target.kz += pz;
  let goDown = target.hp <= 0;
  if (kind === 'melee') {
    target.bonks = (target.bonks || 0) + 1;
    if (target.bonks >= WEAPONS.wrench.knockHits) goDown = true;
  } else if (kind !== 'fire' && (target.team !== 'player' || kind === 'blast' || kind === 'ram')) {
    goDown = true; // guns, blasts and rams are lethal outright (the player keeps hp rules)
  }
  // Anyone but the player who falls is dead: no getting back up.
  if (goDown && target.team !== 'player') target.hp = 0;
  emitHit(game, target, source, applied, kind, (target.y || 0) + 1.1);
  if (goDown) knockDown(game, target, source, kind);
  return applied;
}

// ---------------------------------------------------------------------
// Ray and segment tests
// ---------------------------------------------------------------------
// Shared trace result: kind 'actor' | 'craft' | 'wall' | 'ground' |
// 'water' | 'none', t = distance along the unit direction.
export function createTraceResult() {
  return { kind: 'none', t: 0, x: 0, y: 0, z: 0, actor: null, craft: null };
}

// Entry distance of a ray (unit dir) into an upright cylinder, or Infinity.
export function cylinderT(x, y, z, dx, dy, dz, len, cx, cz, r, y0, y1) {
  const ox = x - cx, oz = z - cz;
  const a = dx * dx + dz * dz;
  let t0, t1;
  if (a < 1e-12) {
    if (ox * ox + oz * oz > r * r) return Infinity;
    t0 = 0;
    t1 = len;
  } else {
    const b = ox * dx + oz * dz;
    const c = ox * ox + oz * oz - r * r;
    const disc = b * b - a * c;
    if (disc < 0) return Infinity;
    const s = Math.sqrt(disc);
    t0 = (-b - s) / a;
    t1 = (-b + s) / a;
  }
  if (t1 < 0 || t0 > len) return Infinity;
  if (t0 < 0) t0 = 0;
  if (t1 > len) t1 = len;
  if (Math.abs(dy) < 1e-9) {
    if (y < y0 || y > y1) return Infinity;
  } else {
    let ya = (y0 - y) / dy, yb = (y1 - y) / dy;
    if (ya > yb) {
      const k = ya;
      ya = yb;
      yb = k;
    }
    if (ya > t0) t0 = ya;
    if (yb < t1) t1 = yb;
  }
  return t0 <= t1 ? t0 : Infinity;
}

const seaYOf = (game) => (game && Number.isFinite(game.seaY) ? game.seaY : -0.6);
function isLand(game, x, z) {
  const city = game && game.city;
  return !city || !city.isGround || city.isGround(x, z);
}
export function craftBase(game, c) {
  return (c.y || 0) + (c.kind === 'boat' ? seaYOf(game) : 0);
}

// Nearest hit along (x,y,z) + t*(dx,dy,dz) for t in 0..len. The
// direction must be a unit vector. Writes and returns `out`.
// Turn a trace result into a miss at distance len along d.
function missAt(out, x, y, z, d, len) {
  out.kind = 'none';
  out.t = len;
  out.actor = null;
  out.craft = null;
  out.x = x + d.x * len;
  out.y = y + d.y * len;
  out.z = z + d.z * len;
}

export function trace(game, x, y, z, dx, dy, dz, len, skipActor, skipCraft, out) {
  out.kind = 'none';
  out.t = len;
  out.actor = null;
  out.craft = null;
  // Ground (y = 0 on land) or sea surface.
  if (dy < -1e-9) {
    const t = -y / dy;
    if (t >= 0 && t < out.t && isLand(game, x + dx * t, z + dz * t)) {
      out.kind = 'ground';
      out.t = t;
    } else {
      const ts = (seaYOf(game) - y) / dy;
      if (ts >= 0 && ts < out.t && !isLand(game, x + dx * ts, z + dz * ts)) {
        out.kind = 'water';
        out.t = ts;
      }
    }
  }
  // Buildings and trees (2D raycast, then the ray's height there).
  const col = game && game.collision;
  const hl = Math.sqrt(dx * dx + dz * dz);
  if (col && hl > 1e-6) {
    const d2 = col.raycast(x, z, dx, dz, out.t * hl);
    if (d2 < out.t * hl) {
      const t = d2 / hl;
      const yy = y + dy * t;
      const hx = x + dx * t + (dx / hl) * 0.05, hz = z + dz * t + (dz / hl) * 0.05;
      if (yy < col.heightAt(hx, hz)) {
        out.kind = 'wall';
        out.t = t;
      }
    }
  }
  // People.
  const p = game && game.player;
  const actors = game && game.actors;
  if (actors) {
    for (let i = 0; i < actors.length; i++) {
      const a = actors[i];
      if (a === skipActor || !canBeHit(a) || a.fade > 0) continue;
      if (p && a === p.walker && p.vehicle) continue;
      const ay = a.y || 0;
      const t = cylinderT(x, y, z, dx, dy, dz, out.t, a.x, a.z, a.radius || 0.35, ay, ay + (a.height || ACTOR_HEIGHT));
      if (t < out.t) {
        out.kind = 'actor';
        out.t = t;
        out.actor = a;
      }
    }
  }
  // Craft.
  const vs = game && game.vehicles;
  if (vs) {
    for (let i = 0; i < vs.length; i++) {
      const c = vs[i];
      if (!c || c === skipCraft || c.removed) continue;
      const r = c.radius || 2;
      const ex = c.x - x, ez = c.z - z, lim = out.t + r;
      if (ex > lim || ex < -lim || ez > lim || ez < -lim) continue;
      const by = craftBase(game, c);
      const t = cylinderT(x, y, z, dx, dy, dz, out.t, c.x, c.z, r, by, by + ((c.spec && c.spec.height) || 1.5));
      if (t < out.t) {
        out.kind = 'craft';
        out.t = t;
        out.craft = c;
        out.actor = null;
      }
    }
  }
  out.x = x + dx * out.t;
  out.y = y + dy * out.t;
  out.z = z + dz * out.t;
  return out;
}

// ---------------------------------------------------------------------
// Drawing helper (no three.js import): lays a person mesh down and sinks
// it while fading. The mesh must use rotation order 'YXZ'.
// ---------------------------------------------------------------------
export function downAmount(a) {
  if (!a || !a.life || a.life === 'ok') return 0;
  if (a.life === 'getup') return Math.max(0, 1 - a.lifeT / GETUP_T);
  if (a.life === 'down') return Math.min(1, a.lifeT / 0.25);
  return 1;
}
export function layDown(mesh, a) {
  if (!mesh || !a) return;
  if (poseRagdoll(mesh, a)) return; // tumbling or settled ragdoll
  const k = downAmount(a);
  mesh.rotation.z = k * Math.PI * 0.5;
  mesh.rotation.x = a.spin || 0; // tumbling through the air after a blast
  mesh.position.y += k * 0.15 - (a.fade || 0) * 0.5;
  mesh.visible = !(a.fade >= 1);
}

// ---------------------------------------------------------------------
// The system
// ---------------------------------------------------------------------
export function createCombat(game, { seed = 23023 } = {}) {
  const rng = createRng(seed);
  const tossRng = createRng(seed ^ 0x7055); // separate stream: blast throws never shift the fight's dice
  const ragdolls = createRagdolls(RAGDOLL_MAX);
  ragdolls.rng = createRng(seed ^ 0x2a6d); // own stream too: tumbles never shift other dice
  game.ragdolls = ragdolls;
  if (!game.actors) game.actors = [];
  if (!game.aim) game.aim = { dx: 1, dy: 0, dz: 0, manual: false };
  const TR = createTraceResult();
  const EXIT = { x: 0, z: 0, ok: false };
  const DIR = { x: 0, y: 0, z: 0 };

  // Projectile pool.
  const projectiles = [];
  for (let i = 0; i < CAPS.projectiles; i++) {
    projectiles.push({
      active: false, weapon: null, def: null, type: null, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0,
      travelled: 0, fuse: 0, source: null, craft: null, rest: false, target: null, index: i,
    });
  }
  // Placed sticky charges (docs/ARMS.md section 1).
  const stickies = [];
  for (let i = 0; i < STICKY_MAX; i++) {
    stickies.push({
      active: false, x: 0, y: 0, z: 0, craft: null, ox: 0, oy: 0, oz: 0, owner: null,
      age: 0, beepT: 0, fuse: -1, seq: 0, index: i,
    });
  }
  let stickySeq = 0;
  // Throw preview (filled while FIRE is held with a thrown weapon) and
  // the bomb impact preview (while aboard a craft with bombs).
  const preview = { on: false, pts: new Float32Array(PREVIEW_PTS * 3), n: 0, hx: 0, hy: 0, hz: 0, kind: 'none', weapon: null };
  const dropPreview = { on: false, ok: false, hx: 0, hy: 0, hz: 0, t: 0, kind: 'none' };
  const seeker = createSeeker();
  const seekCtx = { actors: null, vehicles: null, collision: null, seaY: 0, self: null, range: 600 };
  const SIM = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, source: null, craft: null };
  const THROW = { x: 0, y: 0, z: 0 };
  let throwAim = false, throwCancel = false;
  // Explosion queue and recent start times (for the rate and live caps).
  const queue = [];
  for (let i = 0; i < CAPS.queue; i++) {
    queue.push({ active: false, x: 0, y: 0, z: 0, r: 0, source: null, depth: 0, craft: null, delay: 0, direct: null, scale: 1 });
  }
  const starts = new Float64Array(CAPS.explosions).fill(-1e9);
  let startHead = 0;
  // Scorch decals (data only; combatfx draws them as one instanced mesh).
  const decals = {
    x: new Float32Array(CAPS.decals), z: new Float32Array(CAPS.decals),
    r: new Float32Array(CAPS.decals), t: new Float32Array(CAPS.decals).fill(-1e9),
    head: 0, count: 0,
  };
  let time = 0;
  let burningCount = 0;
  let dropped = 0; // explosions dropped because the queue was full

  function addDecal(x, z, r) {
    const i = decals.head;
    decals.x[i] = x;
    decals.z[i] = z;
    decals.r[i] = r;
    decals.t[i] = time;
    decals.head = (i + 1) % CAPS.decals;
    if (decals.count < CAPS.decals) decals.count++;
  }

  function countSince(window) {
    let n = 0;
    for (let i = 0; i < starts.length; i++) if (time - starts[i] < window) n++;
    return n;
  }
  const canStart = () => countSince(RATE_WINDOW) < RATE_MAX && countSince(LIVE_T) < CAPS.explosions;

  function requestExplosion(x, y, z, r, source, depth, craft = null, delay = 0, scale = 1) {
    if (delay <= 0 && curDepth < 0 && canStart()) {
      detonate(x, y, z, r, source, depth, craft, scale);
      return true;
    }
    for (let i = 0; i < queue.length; i++) {
      const q = queue[i];
      if (q.active) continue;
      q.active = true;
      q.x = x;
      q.y = y;
      q.z = z;
      q.r = r;
      q.source = source;
      q.depth = depth;
      q.craft = craft;
      q.scale = scale > 0 ? scale : 1;
      q.delay = delay > 0 ? delay : QUEUE_DELAY;
      return true;
    }
    dropped++;
    return false;
  }

  function stopBurning(c) {
    if (!c.burning) return;
    c.burning = false;
    c.onFire = false;
    const b = EV.burning;
    b.craft = c;
    b.on = false;
    emit(game, 'burning');
  }

  // A craft reached 0 health through damage(): it blows up (if the
  // chain depth allows) after a short beat.
  function craftDestroyed(c, depth) {
    stopBurning(c);
    if (c.occ) killOccupants(game, c, c.lastHitBy, c.lastKind || 'blast');
    c.scorched = true;
    if (depth > MAX_DEPTH) {
      // Chain limit: no blast, but the hull still goes away.
      if (c.wreckT === undefined) c.wreckT = 0;
      return;
    }
    if (c.exploded) return;
    c.exploded = true;
    const h = (c.spec && c.spec.height) || 1.5;
    // A blast the full queue drops still leaves a wreck that must go away.
    craftBlast(c, CB);
    if (!requestExplosion(c.x, craftBase(game, c) + h * 0.5, c.z, CB.r, c.lastHitBy, depth, c, depth > 0 ? CHAIN_DELAY : 0, CB.scale) && c.wreckT === undefined) c.wreckT = 0;
  }

  function ejectPlayer(c) {
    const p = game.player;
    const w = p && p.walker;
    if (!w || p.vehicle !== c) return;
    if (c.spec && c.spec.width) exitPosition(c, game.world, EXIT);
    else EXIT.ok = false;
    if (!EXIT.ok && game.findRescueSpot && game.city && game.city.shoreDist(c.x, c.z) < 1) {
      game.findRescueSpot(c.x, c.z, EXIT);
    }
    const x = EXIT.ok ? EXIT.x : c.x, z = EXIT.ok ? EXIT.z : c.z;
    w.x = w.px = x;
    w.z = w.pz = z;
    w.vx = w.vz = 0;
    c.driver = null;
    p.vehicle = null;
    if (game.setPlayerMode) game.setPlayerMode('foot');
    else p.mode = 'foot';
  }

  // A harmless little puff (a bomb that found the explosion queue full).
  function puff(x, y, z, source) {
    const e = EV.explosion;
    e.x = x;
    e.y = y;
    e.z = z;
    e.radius = 2;
    e.source = source;
    e.depth = 0;
    e.size = 'small';
    e.scale = 1;
    e.puff = true;
    e.craft = null;
    emit(game, 'explosion');
  }

  function detonate(x, y, z, r, source, depth, craft, scale = 1) {
    starts[startHead] = time;
    startHead = (startHead + 1) % starts.length;
    const e = EV.explosion;
    e.x = x;
    e.y = y;
    e.z = z;
    e.radius = r;
    e.source = source;
    e.depth = depth;
    e.size = explosionSize(r);
    e.scale = scale;
    e.puff = false;
    e.craft = craft || null;
    emit(game, 'explosion');
    e.craft = null;
    if (craft) craft.wreckT = 0;
    if (y < 3 && isLand(game, x, z)) addDecal(x, z, craft ? (SCORCH_CRAFT_D / 2.5) * scale : r * 0.45); // drawn 2.5 r across
    const prev = curDepth;
    curDepth = depth;
    if (craft) {
      craft.wrecked = true;
      craft.health = 0;
      craft.scorched = true;
      stopBurning(craft);
      if (craft.occ) killOccupants(game, craft, source, 'blast');
      if (game.player && game.player.vehicle === craft) ejectPlayer(craft);
    }
    // People: damage with falloff; everyone inside goes down.
    const actors = game.actors;
    for (let i = 0; i < actors.length; i++) {
      const a = actors[i];
      if (!canBeHit(a) || a.fade > 0) continue;
      if (game.player && a === game.player.walker && game.player.vehicle) continue;
      const ex = a.x - x, ey = (a.y || 0) + 0.9 - y, ez = a.z - z;
      const d = Math.sqrt(ex * ex + ey * ey + ez * ez);
      if (d >= r) continue;
      const k = 1 - d / r;
      const hd = Math.sqrt(ex * ex + ez * ez);
      const push = 3 + 9 * k;
      // Fall away from the centre (a seeded direction when right on top of it).
      let fx = ex, fz = ez;
      if (hd < 0.2) {
        const an = tossRng.next() * Math.PI * 2;
        fx = Math.cos(an);
        fz = Math.sin(an);
      }
      const fl = Math.sqrt(fx * fx + fz * fz);
      setPush((fx / fl) * push, (fz / fl) * push);
      setFall(fx, fz, FALL_BLAST_V0 + FALL_BLAST_V1 * k, FALL_BLAST_UP0 + FALL_BLAST_UP1 * k);
      damage(game, a, BLAST_DMG * k * scale, source, 'blast');
      if (a.hp <= 0 && a.team !== 'player') launchActor(a, k);
    }
    const pv = game.player && game.player.vehicle;
    const own = !!pv && isPlayerSource(game, source);
    // Craft: damage x1.5, a shove away from the centre.
    const vs = game.vehicles;
    for (let i = 0; i < vs.length; i++) {
      const c = vs[i];
      if (!c || c === craft || c.removed) continue;
      const cy = craftBase(game, c) + ((c.spec && c.spec.height) || 1.5) * 0.5;
      const ex = c.x - x, ey = cy - y, ez = c.z - z;
      const d = Math.max(0, Math.sqrt(ex * ex + ey * ey + ez * ez) - (c.radius || 2) * 0.5);
      if (d >= r) continue;
      const k = 1 - d / r;
      const hd = Math.sqrt(ex * ex + ez * ez);
      let amount = BLAST_DMG * k * BLAST_CRAFT_MULT * scale;
      if (own && c === pv) {
        // Own munition: a quarter, and never enough to wreck the craft
        // the player sits in.
        const mult = (CRAFT_MULT.blast ?? 1) * ((c.spec && c.spec.armor && c.spec.armor.blast) ?? 1);
        amount = Math.min(amount * OWN_BLAST, Math.max(0, (c.health - 1) / (mult || 1)));
        if (!(amount > 0)) continue;
      }
      if (hd > 1e-3 && !c.wrecked) setPush((ex / hd) * craftPush(scale) * k, (ez / hd) * craftPush(scale) * k);
      damage(game, c, amount, source, 'blast');
      if (c !== pv) tossCraft(c, hd > 1e-3 ? ex / hd : 0, hd > 1e-3 ? ez / hd : 0, k, false);
    }
    // The blown-up craft pops up out of its own fireball.
    if (craft && craft !== (game.player && game.player.vehicle)) tossCraft(craft, 0, 0, 1, true);
    curDepth = prev;
  }

  // A person killed by a blast flies and tumbles.
  function launchActor(a, k) {
    a.spinV = (tossRng.next() < 0.5 ? -1 : 1) * (4 + 6 * k);
    a.spin = 0;
    if (!(a.y > 0)) a.y = 0;
    if (a.rag) {
      // The ragdoll flies it (thrown up 3 to 6 m/s by setFall); a tumble on top.
      kickRagdoll(a.rag, 0, a.spinV);
      a.ky = a.rag.vy;
    } else a.ky = FALL_BLAST_UP0 + FALL_BLAST_UP1 * k;
  }

  // Launch a car (or lighter craft) from a blast at (nx, nz) unit direction,
  // k = 1 - d/r. Live cars hop and rock; wrecks may flip right over.
  function tossCraft(c, nx, nz, k, own) {
    if (!c || c.removed || c.kind === 'plane' || c.kind === 'heli' || c.kind === 'boat') return;
    if (c.tossing && !own) return;
    const m = (c.spec && c.spec.mass) || 1500;
    const heavy = c.kind === 'tank' || m > 6000;
    const f = heavy ? 0.12 : Math.max(0.45, Math.min(1.3, 1500 / m));
    const kk = own ? 0.9 : k;
    c.tvy = (2.5 + 5.5 * kk) * f;
    if (c.tvy < 1.2) return;
    c.tT = Math.max(0.3, (2 * c.tvy) / TOSS_G);
    c.tt = 0;
    c.tossing = true;
    c.asleep = false;
    c.meshDirty = true;
    const side = tossRng.next() < 0.5 ? -1 : 1;
    const flip = c.wrecked && !heavy && kk > 0.45;
    // Roll about the car's own axis: a full or half turn for wrecks, a rock for live cars.
    c.tRollEnd = flip ? side * Math.PI * (tossRng.next() < 0.5 ? 1 : 2) : 0;
    c.tRollAmp = flip ? 0 : side * (0.25 + 0.5 * kk) * (heavy ? 0.1 : 1);
    c.tPitchAmp = (tossRng.next() < 0.5 ? -1 : 1) * (0.1 + 0.3 * kk) * (heavy ? 0.1 : 1);
    c.tRoll = 0;
    c.tPitch = 0;
  }

  function stepToss(dt) {
    const vs = game.vehicles;
    if (!vs) return;
    for (let i = 0; i < vs.length; i++) {
      const c = vs[i];
      if (!c || !c.tossing) continue;
      if (c.removed) {
        c.tossing = false;
        continue;
      }
      c.tt += dt;
      c.tvy -= TOSS_G * dt;
      c.y = (c.y || 0) + c.tvy * dt;
      const u = Math.min(1, c.tt / c.tT);
      const sm = u * u * (3 - 2 * u);
      c.tRoll = c.tRollEnd * sm + c.tRollAmp * Math.sin(Math.PI * u);
      c.tPitch = c.tPitchAmp * Math.sin(Math.PI * u);
      c.asleep = false;
      c.meshDirty = true;
      if (c.y <= 0 && c.tvy < 0) {
        c.y = 0;
        c.tvy = 0;
        c.tossing = false;
        c.tPitch = 0;
        c.tRoll = c.tRollEnd; // a flipped wreck stays flipped
        c.vx *= 0.6;
        c.vz *= 0.6;
      }
    }
  }

  function stepQueue(dt) {
    for (let i = 0; i < queue.length; i++) {
      const q = queue[i];
      if (!q.active) continue;
      q.delay -= dt;
      if (q.delay > 0) continue;
      if (!canStart()) {
        q.delay = QUEUE_DELAY;
        continue;
      }
      q.active = false;
      const c = q.craft;
      if (c && c.removed) {
        q.craft = null;
        continue;
      }
      // A queued craft explosion follows the craft if it rolled on.
      if (c) {
        q.x = c.x;
        q.z = c.z;
      }
      // Free the slot first: detonate() can queue chain blasts into it.
      const qx = q.x, qy = q.y, qz = q.z, qr = q.r, qs = q.source, qd = q.depth, qk = q.scale;
      q.scale = 1;
      q.craft = null;
      q.source = null;
      detonate(qx, qy, qz, qr, qs, qd, c, qk);
    }
  }

  // --- Firing ---
  function muzzleFor(actor, craft, dx, dz, out) {
    if (craft) {
      const h = craft.heading || 0;
      const rx = -Math.sin(h), rz = Math.cos(h);
      const side = dx * rx + dz * rz >= 0 ? 1 : -1;
      const off = ((craft.spec && craft.spec.width) || 1.8) * 0.5 + 0.3;
      out.x = craft.x + rx * off * side;
      out.z = craft.z + rz * off * side;
      out.y = craftBase(game, craft) + ((craft.spec && craft.spec.height) || 1.5) * 0.8;
    } else {
      const hl = Math.sqrt(dx * dx + dz * dz) || 1;
      out.x = actor.x + (dx / hl) * 0.3;
      out.z = actor.z + (dz / hl) * 0.3;
      out.y = (actor.y || 0) + MUZZLE_Y;
    }
    return out;
  }
  const MZ = { x: 0, y: 0, z: 0 };

  function emitShot(shooter, weapon, mx, my, mz, dx, dy, dz, hx, hy, hz, kind) {
    const s = EV.shot;
    s.shooter = shooter;
    s.weapon = weapon;
    s.x = mx;
    s.y = my;
    s.z = mz;
    s.dx = dx;
    s.dy = dy;
    s.dz = dz;
    s.hx = hx;
    s.hy = hy;
    s.hz = hz;
    s.hitKind = kind === 'water' ? 'ground' : kind;
    emit(game, 'shot');
  }

  // Direction with random spread (half-angle s) into DIR.
  function spreadDir(dx, dy, dz, s) {
    if (!(s > 0)) {
      DIR.x = dx;
      DIR.y = dy;
      DIR.z = dz;
      return DIR;
    }
    const yaw = Math.atan2(dz, dx) + rng.range(-s, s);
    const pitch = Math.asin(Math.max(-1, Math.min(1, dy))) + rng.range(-s, s) * 0.6;
    const cp = Math.cos(pitch);
    DIR.x = Math.cos(yaw) * cp;
    DIR.y = Math.sin(pitch);
    DIR.z = Math.sin(yaw) * cp;
    return DIR;
  }

  function melee(actor, w, dx, dz) {
    const hl = Math.sqrt(dx * dx + dz * dz) || 1;
    const ux = dx / hl, uz = dz / hl;
    const cosArc = Math.cos(w.spread);
    let best = null, bestD = w.range;
    const p = game.player;
    const actors = game.actors;
    for (let i = 0; i < actors.length; i++) {
      const a = actors[i];
      if (a === actor || !canBeHit(a) || a.fade > 0) continue;
      if (p && a === p.walker && p.vehicle) continue;
      if (Math.abs((a.y || 0) - (actor.y || 0)) > 1.5) continue;
      const ex = a.x - actor.x, ez = a.z - actor.z;
      const c = Math.sqrt(ex * ex + ez * ez);
      const d = c - (a.radius || 0.35);
      if (d > bestD) continue;
      if (c > 0.3 && (ex * ux + ez * uz) / c < cosArc) continue;
      best = a;
      bestD = d;
    }
    const vs = game.vehicles;
    for (let i = 0; i < vs.length; i++) {
      const c = vs[i];
      if (!c || c.removed || craftBase(game, c) - (actor.y || 0) > 1.5) continue;
      const ex = c.x - actor.x, ez = c.z - actor.z;
      const cl = Math.sqrt(ex * ex + ez * ez);
      const d = cl - (c.radius || 2) * 0.7;
      if (d > bestD) continue;
      if (cl > 0.3 && (ex * ux + ez * uz) / cl < Math.cos(w.spread * 2)) continue;
      best = c;
      bestD = d;
    }
    const my = (actor.y || 0) + 1.1;
    if (best) {
      setPush(ux * 2, uz * 2);
      damage(game, best, w.dmg, actor, 'melee');
      emitShot(actor, w.id, actor.x, my, actor.z, ux, 0, uz, best.x, my, best.z, isCraft(best) ? 'craft' : 'actor');
    } else {
      emitShot(actor, w.id, actor.x, my, actor.z, ux, 0, uz, actor.x + ux * w.range, my, actor.z + uz * w.range, 'none');
    }
  }

  // Live projectiles of one cap group ('thrown' covers cans and charges),
  // optionally only those of one source.
  function liveOf(group, source = null) {
    let n = 0;
    for (let i = 0; i < projectiles.length; i++) {
      const p = projectiles[i];
      if (!p.active) continue;
      const g = p.type === 'sticky' ? 'thrown' : p.type;
      if (g === group && (!source || p.source === source)) n++;
    }
    return n;
  }
  const capGroup = (type) => (type === 'sticky' ? 'thrown' : type === 'rocket' ? null : type);
  // Would launching a projectile of this type be refused (type cap, the
  // per-player can cap, or a full pool)?
  function launchBlocked(type, source) {
    const g = capGroup(type);
    if (g && TYPE_CAPS[g] !== undefined && liveOf(g) >= TYPE_CAPS[g]) return true;
    if (type === 'thrown' && source && source.team === 'player' && liveOf('thrown', source) - liveStickyFlying(source) >= THROWN_PER_PLAYER) return true;
    for (let i = 0; i < projectiles.length; i++) if (!projectiles[i].active) return false;
    return true;
  }
  function liveStickyFlying(source) {
    let n = 0;
    for (let i = 0; i < projectiles.length; i++) {
      const p = projectiles[i];
      if (p.active && p.type === 'sticky' && p.source === source) n++;
    }
    return n;
  }

  // Thrown velocity: THROW_EL elevation, flat reach picked by the aim pitch
  // (THROW_PITCH_LO..HI maps to rangeMin..range). Writes vx, vy, vz.
  function throwVelocity(w, dx, dy, dz, out) {
    const pitch = Math.asin(Math.max(-1, Math.min(1, dy)));
    const f = Math.max(0, Math.min(1, (pitch - THROW_PITCH_LO) / (THROW_PITCH_HI - THROW_PITCH_LO)));
    const lo = w.rangeMin || w.range * 0.25;
    const reach = lo + (w.range - lo) * f;
    const v = Math.sqrt(GRAVITY * reach / Math.sin(2 * THROW_EL));
    const hl = Math.sqrt(dx * dx + dz * dz);
    const ux = hl > 1e-6 ? dx / hl : 1, uz = hl > 1e-6 ? dz / hl : 0;
    out.vx = ux * v * Math.cos(THROW_EL);
    out.vz = uz * v * Math.cos(THROW_EL);
    out.vy = v * Math.sin(THROW_EL);
    return out;
  }

  function freeProjectile() {
    for (let i = 0; i < projectiles.length; i++) if (!projectiles[i].active) return projectiles[i];
    return null;
  }

  function launch(actor, craft, w, mx, my, mz, dx, dy, dz) {
    if (launchBlocked(w.type, actor)) return false; // the trigger still clicks
    const pr = freeProjectile();
    if (!pr) return false;
    pr.active = true;
    pr.weapon = w.id;
    pr.def = w;
    pr.type = w.type;
    pr.x = mx;
    pr.y = my;
    pr.z = mz;
    pr.travelled = 0;
    pr.source = actor;
    pr.craft = craft;
    pr.rest = false;
    pr.target = null;
    if (w.type === 'rocket') {
      pr.vx = dx * w.speed;
      pr.vy = dy * w.speed;
      pr.vz = dz * w.speed;
      pr.fuse = w.range / w.speed + 1;
    } else {
      throwVelocity(w, dx, dy, dz, pr);
      pr.fuse = w.type === 'sticky' ? 8 : w.fuse;
    }
    return true;
  }

  // Use the actor's weapon toward unit direction (dx, dy, dz). `craft`
  // is the craft fired from (drive-by), `weaponId` overrides the held
  // weapon. Returns true when something was fired.
  function fire(actor, dx, dy, dz, craft = null, weaponId = null) {
    if (!actor || !actor.arms || !canBeHit(actor)) return false;
    const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (!(len > 1e-6)) return false;
    dx /= len;
    dy /= len;
    dz /= len;
    const arms = actor.arms;
    const id = weaponId || arms.weapon;
    const w = WEAPONS[id];
    if (!w) return false;
    if (craft && !w.driveBy) return false;
    const was = arms.reloading;
    if (w.type !== 'hitscan' && w.type !== 'melee' && !(arms.cool > 0) && arms.reloading !== id && !(w.mag > 0 && !(arms.mag[id] > 0))) {
      // A 5th charge replaces the oldest placed one (it blows).
      if (w.type === 'sticky' && countStickies(actor) + liveStickyFlying(actor) >= STICKY_MAX) blowOldest(actor);
      if (launchBlocked(w.type, actor)) {
        // A full cap: the trigger clicks, nothing is used.
        arms.cool = 1 / w.rate;
        const e = EV.empty;
        e.actor = actor;
        e.weapon = id;
        emit(game, 'empty');
        return false;
      }
    }
    const r = tryUse(arms, id);
    if (r === USE_NO) {
      if (arms.reloading && !was) emitReload(actor, id);
      return false;
    }
    if (r === USE_LAST) {
      const e = EV.empty;
      e.actor = actor;
      e.weapon = id;
      emit(game, 'empty');
      emitReload(actor, id);
    }
    if (w.type === 'melee') {
      melee(actor, w, dx, dz);
      return true;
    }
    muzzleFor(actor, craft, dx, dz, MZ);
    const mx = MZ.x, my = MZ.y, mz = MZ.z;
    if (w.type === 'hitscan') {
      for (let k = 0; k < w.pellets; k++) {
        const d = spreadDir(dx, dy, dz, w.spread);
        // Out to AIR_REACH for craft in the air (aim.js); anything else
        // past the gun's own range is a miss.
        trace(game, mx, my, mz, d.x, d.y, d.z, Math.max(w.range, AIR_REACH), actor, craft, TR);
        if (TR.t > w.range && !(TR.kind === 'craft' && airborne(TR.craft))) missAt(TR, mx, my, mz, d, w.range);
        const kind = TR.kind;
        const hx = TR.x, hy = TR.y, hz = TR.z;
        const target = TR.actor || TR.craft;
        if (target) {
          if (w.push && TR.actor) setPush(d.x * w.push, d.z * w.push);
          if (TR.actor) setFall(d.x, d.z, w.pellets > 1 ? FALL_SHOTGUN : FALL_BULLET);
          if (TR.craft) setHitY(hy);
          damage(game, target, w.dmg, actor, 'bullet');
        }
        emitShot(actor, id, mx, my, mz, d.x, d.y, d.z, hx, hy, hz, kind);
      }
      return true;
    }
    const ok = launch(actor, craft, w, mx, my, mz, dx, dy, dz);
    emitShot(actor, id, mx, my, mz, dx, dy, dz, mx, my, mz, 'none');
    return ok;
  }

  function emitReload(actor, id) {
    const e = EV.reload;
    e.actor = actor;
    e.weapon = id;
    emit(game, 'reload');
  }

  // --- Craft weapons (mounts) ---
  function ensureArms(c) {
    if (!c || !c.spec) return null;
    if (c.arms === undefined || (c.arms === null && c.spec.mounts && c.spec.mounts.length)) c.arms = createCraftArms(c.spec);
    return c.arms;
  }
  const NOSE = { x: 0, y: 0, z: 0 };
  function noseDir(c, out) {
    const pitch = c.kind === 'plane' ? (c.pitch || 0) : c.kind === 'heli' ? -0.12 : 0;
    const cp = Math.cos(pitch), h = c.heading || 0;
    out.x = Math.cos(h) * cp;
    out.y = Math.sin(pitch);
    out.z = Math.sin(h) * cp;
    return out;
  }
  function mountMuzzle(c, slot, id, m, out) {
    const hk = hooksFor(c);
    if (hk.muzzle && hk.muzzle(game, c, slot, id, out)) return out;
    const base = craftBase(game, c);
    const h = (c.spec && c.spec.height) || 1.5;
    if (m.type === 'bomb') {
      out.x = c.x;
      out.y = base - 0.4;
      out.z = c.z;
      return out;
    }
    noseDir(c, NOSE);
    const reach = ((c.spec && c.spec.length) || 4) * 0.5 + 0.6;
    out.x = c.x + NOSE.x * reach;
    out.y = base + h * 0.45 + NOSE.y * reach;
    out.z = c.z + NOSE.z * reach;
    return out;
  }

  function emitLaunch(shooter, c, id, x, y, z) {
    const e = EV.launch;
    e.shooter = shooter;
    e.craft = c;
    e.weapon = id;
    e.x = x;
    e.y = y;
    e.z = z;
    emit(game, 'launch');
  }

  // Fire a craft mount (slot 0, 1 or 'drop') toward unit (dx, dy, dz).
  // shooter: the actor credited (null = the craft). target: a homing
  // missile's target. Returns true when fired. docs/ARMS.md section 2.
  function fireMount(c, slot, dx, dy, dz, shooter = null, target = null) {
    if (!c || c.wrecked || c.removed) return false;
    const arms = ensureArms(c);
    const id = mountFor(arms, slot);
    if (!id) return false;
    const m = MOUNTS[id];
    if (!(arms.cool[id] > 0) && !arms.reloading[id] && arms.mag[id] > 0) {
      // Refused without using ammo: a full type cap, or a bomb on the ground.
      const stop = (m.type !== 'hitscan' && launchBlocked(m.type, null)) || (m.type === 'bomb' && (c.onGround || c.onWater));
      if (stop) {
        arms.cool[id] = 1 / m.rate;
        const e = EV.empty;
        e.actor = shooter;
        e.weapon = id;
        emit(game, 'empty');
        return false;
      }
    }
    const r = tryMount(arms, id);
    if (r === USE_NO) return false;
    const src = shooter || c;
    mountMuzzle(c, slot, id, m, MZ);
    const mx = MZ.x, my = MZ.y, mz = MZ.z;
    let len = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (!(len > 1e-6)) {
      noseDir(c, NOSE);
      dx = NOSE.x;
      dy = NOSE.y;
      dz = NOSE.z;
      len = 1;
    }
    dx /= len;
    dy /= len;
    dz /= len;
    if (m.type === 'hitscan') {
      const d = spreadDir(dx, dy, dz, m.spread);
      trace(game, mx, my, mz, d.x, d.y, d.z, m.range, shooter, c, TR);
      const t = TR.actor || TR.craft;
      const kind = TR.kind, hx = TR.x, hy = TR.y, hz = TR.z;
      if (t) {
        if (TR.craft) setHitY(hy);
        if (TR.actor) setFall(d.x, d.z, FALL_BULLET);
        damage(game, t, m.dmg, src, 'bullet');
      }
      emitShot(src, id, mx, my, mz, d.x, d.y, d.z, hx, hy, hz, kind);
    } else {
      const pr = freeProjectile();
      if (!pr) return false;
      pr.active = true;
      pr.weapon = id;
      pr.def = m;
      pr.type = m.type;
      pr.x = mx;
      pr.y = my;
      pr.z = mz;
      pr.travelled = 0;
      pr.source = src;
      pr.craft = c;
      pr.rest = false;
      pr.target = null;
      if (m.type === 'bomb') {
        pr.vx = c.vx || 0;
        pr.vy = Math.min(0, c.vy || 0);
        pr.vz = c.vz || 0;
        pr.fuse = 30;
      } else {
        const d = spreadDir(dx, dy, dz, m.spread);
        const ai = !!shooter && !isPlayerSource(game, shooter);
        const sp = ai && m.aiSpeed ? m.aiSpeed : m.speed;
        pr.vx = d.x * sp + (m.type === 'missile' ? (c.vx || 0) * 0.3 : 0);
        pr.vy = d.y * sp;
        pr.vz = d.z * sp + (m.type === 'missile' ? (c.vz || 0) * 0.3 : 0);
        pr.fuse = m.type === 'missile' ? m.life : m.range / sp + 1;
        pr.target = m.type === 'missile' ? target : null;
      }
      emitShot(src, id, mx, my, mz, dx, dy, dz, mx, my, mz, 'none');
      emitLaunch(src, c, id, mx, my, mz);
      if (m.type === 'bomb') {
        const b = EV.bombFall;
        b.index = pr.index;
        b.x = mx;
        b.y = my;
        b.z = mz;
        b.vy = pr.vy;
        emit(game, 'bombFall');
      }
    }
    const hk = hooksFor(c);
    if (hk.fired) hk.fired(game, c, slot, id);
    return true;
  }

  // One ballistic step of a projectile-like object (gravity g, then a
  // trace along the move). Shared by the real step and the previews, so
  // a preview lands where the real thing does. Leaves the result in TR.
  function ballistic(p, dt, g) {
    p.vy -= g * dt;
    const sx = p.vx * dt, sy = p.vy * dt, sz = p.vz * dt;
    const len = Math.sqrt(sx * sx + sy * sy + sz * sz);
    if (!(len > 1e-9)) {
      TR.kind = 'none';
      TR.t = 0;
      TR.x = p.x;
      TR.y = p.y;
      TR.z = p.z;
      TR.actor = TR.craft = null;
      return 0;
    }
    trace(game, p.x, p.y, p.z, sx / len, sy / len, sz / len, len, p.source, p.craft, TR);
    return len;
  }

  // Arc preview for a throw: out.pts (Float32Array 3 x 24), out.n, landing
  // out.hx, hy, hz and contact out.kind. Same integrator as the real can.
  function predictThrow(actor, dx, dy, dz, weaponId, out = preview) {
    out.n = 0;
    out.kind = 'none';
    const w = WEAPONS[weaponId || (actor && actor.arms && actor.arms.weapon)];
    if (!actor || !w || !isThrown(w)) return out;
    const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (!(len > 1e-6)) return out;
    dx /= len;
    dy /= len;
    dz /= len;
    muzzleFor(actor, null, dx, dz, MZ);
    SIM.x = MZ.x;
    SIM.y = MZ.y;
    SIM.z = MZ.z;
    throwVelocity(w, dx, dy, dz, SIM);
    SIM.source = actor;
    SIM.craft = null;
    const pts = out.pts, max = (pts.length / 3) | 0;
    pts[0] = SIM.x;
    pts[1] = SIM.y;
    pts[2] = SIM.z;
    let n = 1;
    for (let i = 1; i <= PREVIEW_STEPS; i++) {
      ballistic(SIM, SIM_DT, GRAVITY);
      SIM.x = TR.x;
      SIM.y = TR.y;
      SIM.z = TR.z;
      if (TR.kind !== 'none') break;
      if (i % PREVIEW_EVERY === 0 && n < max - 1) {
        pts[n * 3] = SIM.x;
        pts[n * 3 + 1] = SIM.y;
        pts[n * 3 + 2] = SIM.z;
        n++;
      }
    }
    pts[n * 3] = SIM.x;
    pts[n * 3 + 1] = SIM.y;
    pts[n * 3 + 2] = SIM.z;
    out.n = n + 1;
    out.hx = SIM.x;
    out.hy = SIM.y;
    out.hz = SIM.z;
    out.kind = TR.kind;
    out.weapon = w.id;
    return out;
  }

  // Impact point of a bomb released now (same integrator as the bomb).
  function predictDrop(c, out = dropPreview) {
    out.ok = false;
    if (!c) return out;
    const m = MOUNTS.bomb;
    mountMuzzle(c, 'drop', 'bomb', m, MZ);
    SIM.x = MZ.x;
    SIM.y = MZ.y;
    SIM.z = MZ.z;
    SIM.vx = c.vx || 0;
    SIM.vy = Math.min(0, c.vy || 0);
    SIM.vz = c.vz || 0;
    SIM.source = null;
    SIM.craft = c;
    let t = 0;
    for (let i = 0; i < 1800; i++) {
      ballistic(SIM, SIM_DT, GRAVITY);
      t += SIM_DT;
      SIM.x = TR.x;
      SIM.y = TR.y;
      SIM.z = TR.z;
      if (TR.kind !== 'none') {
        out.ok = true;
        break;
      }
    }
    out.hx = SIM.x;
    out.hy = SIM.y;
    out.hz = SIM.z;
    out.t = t;
    out.kind = TR.kind;
    return out;
  }

  // --- Sticky charges ---
  function countStickies(owner) {
    let n = 0;
    for (let i = 0; i < stickies.length; i++) if (stickies[i].active && (!owner || stickies[i].owner === owner)) n++;
    return n;
  }
  function emitSticky(st, on, beep) {
    const e = EV.sticky;
    e.x = st.x;
    e.y = st.y;
    e.z = st.z;
    e.on = on;
    e.beep = beep;
    e.index = st.index;
    emit(game, 'sticky');
  }
  function fizzle(st) {
    if (!st.active) return;
    st.active = false;
    emitSticky(st, false, false);
    st.craft = null;
    st.owner = null;
  }
  function blowSticky(st) {
    const w = WEAPONS.sticky;
    const owner = st.owner;
    st.active = false;
    emitSticky(st, false, false);
    st.craft = null;
    st.owner = null;
    requestExplosion(st.x, st.y + 0.2, st.z, w.blast, owner, 0, null, 0, w.blastScale);
  }
  function blowOldest(owner) {
    let best = null;
    for (let i = 0; i < stickies.length; i++) {
      const st = stickies[i];
      if (st.active && st.owner === owner && st.fuse < 0 && (!best || st.seq < best.seq)) best = st;
    }
    if (best) blowSticky(best);
  }
  // Stick a flying charge where it touched (ground, wall or craft).
  function stick(pr, kind, craft) {
    let st = null;
    for (let i = 0; i < stickies.length; i++) {
      if (!stickies[i].active) {
        st = stickies[i];
        break;
      }
    }
    if (!st) {
      blowOldest(pr.source);
      for (let i = 0; i < stickies.length && !st; i++) if (!stickies[i].active) st = stickies[i];
    }
    const x = TR.x, y = TR.y, z = TR.z;
    pr.active = false;
    const owner = pr.source;
    pr.source = null;
    pr.craft = null;
    if (!st) return;
    st.active = true;
    st.x = x;
    st.y = kind === 'ground' ? Math.max(0, y) + 0.04 : y;
    st.z = z;
    st.owner = owner;
    st.age = 0;
    st.beepT = 0.3;
    st.fuse = -1;
    st.seq = ++stickySeq;
    st.craft = null;
    if (craft) {
      const h = craft.heading || 0, ch = Math.cos(h), sh = Math.sin(h);
      const ex = x - craft.x, ez = z - craft.z;
      st.craft = craft;
      st.ox = ex * ch + ez * sh;
      st.oz = -ex * sh + ez * ch;
      st.oy = y - craftBase(game, craft);
    }
    emitSticky(st, true, false);
  }
  // Blow every charge the owner placed, STICKY_GAP s apart, through the
  // normal explosion queue. Returns the count.
  function detonateStickies(owner) {
    let count = 0;
    for (;;) {
      let best = null;
      for (let i = 0; i < stickies.length; i++) {
        const st = stickies[i];
        if (st.active && st.fuse < 0 && (!owner || st.owner === owner) && (!best || st.seq < best.seq)) best = st;
      }
      if (!best) break;
      best.fuse = count * STICKY_GAP;
      count++;
    }
    if (count > 0) {
      EV.detonate.count = count;
      emit(game, 'detonate');
    }
    return count;
  }
  function stepStickies(dt) {
    const p = game.player;
    for (let i = 0; i < stickies.length; i++) {
      const st = stickies[i];
      if (!st.active) continue;
      const c = st.craft;
      if (c) {
        if (c.removed) {
          fizzle(st);
          continue;
        }
        const h = c.heading || 0, ch = Math.cos(h), sh = Math.sin(h);
        st.x = c.x + st.ox * ch - st.oz * sh;
        st.z = c.z + st.ox * sh + st.oz * ch;
        st.y = craftBase(game, c) + st.oy;
      }
      if (st.fuse >= 0) {
        st.fuse -= dt;
        if (st.fuse <= 0) blowSticky(st);
        continue;
      }
      st.age += dt;
      const o = st.owner;
      const ox = o && Number.isFinite(o.x) ? o.x : p ? p.x : st.x, oz = o && Number.isFinite(o.z) ? o.z : p ? p.z : st.z;
      const far = (st.x - ox) * (st.x - ox) + (st.z - oz) * (st.z - oz) > STICKY_FAR * STICKY_FAR;
      if (st.age >= STICKY_LIFE || far || !Number.isFinite(st.x)) {
        fizzle(st);
        continue;
      }
      st.beepT -= dt;
      if (st.beepT <= 0) {
        st.beepT = Math.max(STICKY_BEEP_FAST, STICKY_BEEP_SLOW - st.age * 0.04);
        emitSticky(st, true, true);
      }
    }
  }

  // --- Projectiles ---
  function detonateProjectile(pr, x, y, z, direct) {
    const w = pr.def || WEAPONS[pr.weapon];
    pr.active = false;
    if (direct && w.dmg > 0) damage(game, direct, w.dmg, pr.source, 'blast');
    const ok = requestExplosion(x, y, z, w.blast, pr.source, 0, null, 0, w.blastScale || 1);
    if (!ok && pr.type === 'bomb') puff(x, y, z, pr.source);
    pr.source = null;
    pr.craft = null;
    pr.target = null;
  }

  const TGT = { x: 0, y: 0, z: 0 };
  function targetAlive(t) {
    if (!t || t.removed) return false;
    if (isCraft(t)) return !t.wrecked;
    return canBeHit(t) && !(t.fade > 0);
  }
  function targetCentre(t, out) {
    out.x = t.x;
    out.z = t.z;
    out.y = isCraft(t) ? craftBase(game, t) + ((t.spec && t.spec.height) || 1.5) * 0.5 : (t.y || 0) + 1;
    return out;
  }
  // Turn a missile's velocity toward its target by at most turn*dt.
  function steerMissile(pr, w, dt) {
    const t = pr.target;
    if (!t) return;
    if (!targetAlive(t)) {
      pr.target = null;
      return;
    }
    targetCentre(t, TGT);
    const sp = Math.sqrt(pr.vx * pr.vx + pr.vy * pr.vy + pr.vz * pr.vz);
    if (!(sp > 1e-6)) return;
    let ex = TGT.x - pr.x, ey = TGT.y - pr.y, ez = TGT.z - pr.z;
    const el = Math.sqrt(ex * ex + ey * ey + ez * ez);
    if (!(el > 1e-6)) return;
    ex /= el;
    ey /= el;
    ez /= el;
    const ux = pr.vx / sp, uy = pr.vy / sp, uz = pr.vz / sp;
    const dot = Math.max(-1, Math.min(1, ux * ex + uy * ey + uz * ez));
    const ang = Math.acos(dot);
    const maxA = w.turn * dt;
    let nx = ex, ny = ey, nz = ez;
    if (ang > maxA) {
      const s = Math.sin(ang);
      if (s < 1e-6) {
        // Straight away: turn about any sideways axis.
        nx = ux * Math.cos(maxA) - uz * Math.sin(maxA);
        ny = uy;
        nz = uz * Math.cos(maxA) + ux * Math.sin(maxA);
      } else {
        const a = Math.sin(ang - maxA) / s, b = Math.sin(maxA) / s;
        nx = ux * a + ex * b;
        ny = uy * a + ey * b;
        nz = uz * a + ez * b;
      }
    }
    const nl = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
    pr.vx = (nx / nl) * sp;
    pr.vy = (ny / nl) * sp;
    pr.vz = (nz / nl) * sp;
  }

  function splashOut(pr, x, z, strength) {
    pr.active = false;
    pr.source = null;
    pr.craft = null;
    pr.target = null;
    if (game.events) game.events.emit('splash', x, z, strength);
  }

  function stepProjectiles(dt) {
    for (let i = 0; i < projectiles.length; i++) {
      const pr = projectiles[i];
      if (!pr.active) continue;
      const w = pr.def || WEAPONS[pr.weapon];
      const type = pr.type || w.type;
      pr.fuse -= dt;
      if (type === 'thrown' || type === 'sticky') {
        if (pr.fuse <= 0) {
          if (type === 'sticky') splashOut(pr, pr.x, pr.z, 0); // a charge that never stuck fizzles
          else detonateProjectile(pr, pr.x, pr.y + 0.2, pr.z, null);
          continue;
        }
        if (pr.rest) continue;
      }
      if (type === 'missile') {
        if (pr.fuse <= 0) {
          detonateProjectile(pr, pr.x, pr.y, pr.z, null);
          continue;
        }
        steerMissile(pr, w, dt);
      }
      const g = type === 'thrown' || type === 'sticky' || type === 'bomb' ? GRAVITY : type === 'shell' ? GRAVITY * (w.drop || 0) : 0;
      const len = ballistic(pr, dt, g);
      if (!(len > 0)) continue;
      const ux = (pr.vx * dt) / len, uz = (pr.vz * dt) / len;
      if (TR.kind === 'water') {
        splashOut(pr, TR.x, TR.z, type === 'bomb' ? 3 : 1);
        continue;
      }
      if (type === 'rocket' || type === 'shell' || type === 'missile' || type === 'bomb') {
        pr.travelled += TR.t;
        if (TR.kind !== 'none') {
          detonateProjectile(pr, TR.x, TR.y, TR.z, TR.actor || TR.craft);
          continue;
        }
        pr.x = TR.x;
        pr.y = TR.y;
        pr.z = TR.z;
        if (type === 'missile' && pr.target) {
          targetCentre(pr.target, TGT);
          const ex = TGT.x - pr.x, ey = TGT.y - pr.y, ez = TGT.z - pr.z;
          if (ex * ex + ey * ey + ez * ez < MISSILE_PROX * MISSILE_PROX) {
            detonateProjectile(pr, pr.x, pr.y, pr.z, pr.target);
            continue;
          }
        }
        if (type === 'bomb') {
          if (!Number.isFinite(pr.y) || pr.fuse <= 0) detonateProjectile(pr, pr.x, Math.max(0, pr.y), pr.z, null);
          continue;
        }
        if (pr.travelled >= w.range || pr.fuse <= 0) detonateProjectile(pr, pr.x, pr.y, pr.z, null);
        continue;
      }
      // Thrown can or charge in flight.
      if (TR.kind === 'none') {
        pr.x = TR.x;
        pr.y = TR.y;
        pr.z = TR.z;
        continue;
      }
      if (type === 'sticky' && TR.kind !== 'actor') {
        stick(pr, TR.kind, TR.kind === 'craft' ? TR.craft : null);
        continue;
      }
      const e = w.bounce || 0.35;
      const v0 = Math.sqrt(pr.vx * pr.vx + pr.vy * pr.vy + pr.vz * pr.vz);
      if (TR.kind === 'ground') {
        pr.x = TR.x;
        pr.y = Math.max(0, TR.y) + 0.01;
        pr.z = TR.z;
        pr.vy = -pr.vy * e;
        pr.vx *= 0.7;
        pr.vz *= 0.7;
        if (Math.abs(pr.vy) < 0.6) {
          pr.vy = 0;
          pr.y = 0.05;
          if (pr.vx * pr.vx + pr.vz * pr.vz < 0.25) pr.rest = true;
        }
      } else {
        // Wall, person or craft: back off a little and reverse the
        // horizontal motion.
        pr.x = TR.x - ux * 0.05;
        pr.y = TR.y;
        pr.z = TR.z - uz * 0.05;
        pr.vx = -pr.vx * e;
        pr.vz = -pr.vz * e;
      }
      if (v0 > 2) {
        const b = EV.bounce;
        b.x = pr.x;
        b.y = pr.y;
        b.z = pr.z;
        b.v = v0;
        b.weapon = pr.weapon;
        emit(game, 'bounce');
      }
    }
  }

  // --- Burning craft ---
  function stepBurning(dt) {
    const vs = game.vehicles;
    burningCount = 0;
    for (let i = 0; i < vs.length; i++) if (vs[i] && vs[i].burning) burningCount++;
    for (let i = 0; i < vs.length; i++) {
      const c = vs[i];
      if (!c) continue;
      if (c.hitT > 0) c.hitT = Math.max(0, c.hitT - dt);
      if (c.burning) {
        if (c.wrecked || c.removed) {
          stopBurning(c);
          continue;
        }
        c.burnT += dt;
        const max = (c.spec && c.spec.health) || 1000;
        damage(game, c, max * BURN_RATE * dt, c.lastHitBy, 'fire');
        if (c.burning && c.burnT >= BURN_T && !c.wrecked) {
          c.health = 0;
          c.wrecked = true;
          craftDestroyed(c, c.chainDepth || 0);
        }
        continue;
      }
      if (c.wrecked || c.removed || !(c.combatHit || sys.burnAll)) continue;
      const max = (c.spec && c.spec.health) || 1000;
      if (c.health < max * BURN_BELOW && burningCount < CAPS.burning && (c.chainDepth || 0) <= MAX_DEPTH && !c.doused) {
        c.burning = true;
        c.burnT = 0;
        if (c.kind === 'car') c.onFire = true;
        burningCount++;
        const b = EV.burning;
        b.craft = c;
        b.on = true;
        emit(game, 'burning');
      }
    }
  }

  // --- Wrecks: burnt hulls stay WRECK_LIE_T s (at most WRECK_MAX), then
  // sink and fade over WRECK_FADE_T s and go (debris is drawn by combatfx) ---
  function queuedFor(c) {
    for (let i = 0; i < queue.length; i++) if (queue[i].active && queue[i].craft === c) return true;
    return false;
  }
  const hulls = []; // wrecks lying or fading now (combatfx smokes them); refilled each step
  function hullFlame(c, on) {
    if (!!c.hullFlame === on) return;
    c.hullFlame = on;
    const e = EV.hullBurn;
    e.craft = c;
    e.id = c.id === undefined ? -1 : c.id;
    e.on = on;
    e.x = c.x;
    e.z = c.z;
    emit(game, 'hullBurn');
    e.craft = null;
  }
  function stepWrecks(dt) {
    const vs = game.vehicles;
    hulls.length = 0;
    if (!vs) return;
    const p = game.player;
    let standing = 0;
    for (let i = 0; i < vs.length; i++) {
      const c = vs[i];
      if (!c || !c.wrecked || c.removed || c.wreckT === undefined) continue;
      c.wreckT += dt;
      if (c.wreckT < WRECK_LIE_T) standing++;
    }
    // Too many hulls: the oldest standing ones start their fade now.
    while (standing > WRECK_MAX) {
      let old = null;
      for (let i = 0; i < vs.length; i++) {
        const c = vs[i];
        if (!c || !c.wrecked || c.removed || c.wreckT === undefined || c.wreckT >= WRECK_LIE_T) continue;
        if (!old || c.wreckT > old.wreckT) old = c;
      }
      if (!old) break;
      old.wreckT = WRECK_LIE_T;
      standing--;
    }
    for (let i = vs.length - 1; i >= 0; i--) {
      const c = vs[i];
      if (!c || !c.wrecked || c.removed) continue;
      if (c.wreckT === undefined) continue; // the blast has not happened yet
      hullFlame(c, c.wreckT < WRECK_FLAME_T && !c.doused); // doused: put out by a fire truck (src/systems/service.js)
      const fade = c.wreckT <= WRECK_LIE_T ? 0 : Math.min(1, (c.wreckT - WRECK_LIE_T) / WRECK_FADE_T);
      if (fade > 0 && !(p && p.vehicle === c) && !c.tossing) {
        // Sink into the ground as it fades (cheaper than see-through paint).
        const h = (c.spec && c.spec.height) || 1.5;
        c.y = -fade * h * 1.1;
        c.asleep = false;
        c.meshDirty = true;
      }
      c.wreckFade = fade;
      if (c.wreckT < WRECK_T || queuedFor(c)) {
        hulls.push(c);
        continue;
      }
      // Never leave the player inside a hull that is about to go.
      if (p && p.vehicle === c) ejectPlayer(c);
      if (p && p.vehicle === c) {
        hulls.push(c);
        continue;
      }
      hullFlame(c, false);
      if (game.removeVehicle) game.removeVehicle(c);
      else {
        vs.splice(i, 1);
        c.removed = true;
      }
    }
  }
  // Hulls removed by someone else (traffic, sweeps) while still burning.
  function onVehicleRemoved(v) {
    if (v && v.hullFlame) hullFlame(v, false);
  }
  if (game.events && game.events.on) game.events.on('vehicleRemoved', onVehicleRemoved);

  // A tumbling body touches the ground for the first time: a thud there.
  function bodyLands() {
    const sl = ragdolls.slots;
    for (let i = 0; i < sl.length; i++) {
      const s = sl[i];
      if (!s.on || s.touchT < 0 || s.thud === s.t0) continue;
      s.thud = s.t0;
      const e = EV.bodyLand;
      e.target = s.actor;
      e.x = s.x;
      e.z = s.z;
      emit(game, 'bodyLand');
      e.target = null;
    }
  }

  // Bodies: at most BODY_MAX lie at once; the oldest starts its fade early.
  function capBodies() {
    const actors = game.actors;
    let n = 0;
    for (let i = 0; i < actors.length; i++) {
      const a = actors[i];
      if (a.life === 'out' && a.team !== 'player' && a.lifeT < OUT_LIE_T) n++;
    }
    while (n > BODY_MAX) {
      let old = null;
      for (let i = 0; i < actors.length; i++) {
        const a = actors[i];
        if (a.life !== 'out' || a.team === 'player' || a.lifeT >= OUT_LIE_T) continue;
        if (!old || a.lifeT > old.lifeT) old = a;
      }
      if (!old) break;
      old.lifeT = OUT_LIE_T;
      old.fade = Math.max(old.fade || 0, 1e-3); // fading from now on
      n--;
    }
  }

  // --- People ---
  // Ragdolls bump into walls and stop at the shoreline.
  const ragFix = (s) => {
    if (game.collision) {
      const r = game.collision.resolveCircle(s.x, s.z, 0.3, 0);
      if (r.x !== s.x || r.z !== s.z) {
        s.x = r.x;
        s.z = r.z;
        s.vx *= 0.3;
        s.vz *= 0.3;
      }
    }
    if (!isLand(game, s.x, s.z) && isLand(game, s.px, s.pz)) {
      s.x = s.px;
      s.z = s.pz;
      s.vx = s.vz = 0;
    }
  };
  function stepActor(a, dt) {
    if (a.hitT > 0) a.hitT = Math.max(0, a.hitT - dt);
    a.sinceHit = (a.sinceHit || 0) + dt;
    const ragged = !!a.rag || a.ragDone; // a ragdoll moves this body
    if (ragged && (a.kx || a.kz)) {
      const sp = Math.sqrt(a.kx * a.kx + a.kz * a.kz);
      const k = sp > KNOCK_DECAY * dt ? (sp - KNOCK_DECAY * dt) / sp : 0;
      a.kx *= k;
      a.kz *= k;
    }
    // Knock-back slide.
    if (!ragged && (a.kx || a.kz)) {
      const sp = Math.sqrt(a.kx * a.kx + a.kz * a.kz);
      const dec = KNOCK_DECAY * dt;
      if (!(sp > dec)) {
        a.kx = a.kz = 0;
      } else {
        const k = (sp - dec) / sp;
        a.kx *= k;
        a.kz *= k;
        const ox = a.x, oz = a.z;
        let nx = ox + a.kx * dt, nz = oz + a.kz * dt;
        if (game.collision) {
          const r = game.collision.resolveCircle(nx, nz, a.radius || 0.35, 0);
          nx = r.x;
          nz = r.z;
        }
        if (!isLand(game, nx, nz) && isLand(game, ox, oz)) {
          nx = ox;
          nz = oz;
          a.kx = a.kz = 0;
        }
        if (Number.isFinite(nx) && Number.isFinite(nz)) {
          a.x = nx;
          a.z = nz;
        } else a.kx = a.kz = 0;
      }
    }
    if (a.ky && !ragged) {
      // Launched by a blast: a short flight, tumbling, then it lies where it lands.
      a.ky -= TOSS_G * dt;
      a.y += a.ky * dt;
      a.spin += a.spinV * dt;
      if (a.y <= 0 && a.ky < 0) {
        a.y = 0;
        a.ky = 0;
        a.spin = 0;
        a.spinV = 0;
        a.kx *= 0.5;
        a.kz *= 0.5;
      }
    }
    a.lifeT += dt;
    const player = a.team === 'player';
    if (a.life === 'down') {
      if (a.hp > 0) {
        if (a.lifeT >= DOWN_T) {
          a.life = 'getup';
          a.lifeT = 0;
        }
      } else if (player) {
        a.fade = Math.min(1, Math.max(0, (a.lifeT - PLAYER_DOWN_T) / PLAYER_FADE_T));
        if (a.lifeT >= PLAYER_DOWN_T + PLAYER_FADE_T) respawn();
      } else if (a.lifeT >= DOWN_T) {
        a.life = 'out';
        a.lifeT = 0;
        const o = EV.out;
        o.target = a;
        o.source = a.lastHitBy;
        emit(game, 'out');
      }
    } else if (a.life === 'getup') {
      if (a.lifeT >= GETUP_T) {
        a.life = 'ok';
        a.lifeT = 0;
        a.bonks = 0;
      }
    } else if (a.life === 'out') {
      a.fade = Math.min(1, Math.max(0, (a.lifeT - OUT_LIE_T) / FADE_T));
    } else if (player && a.sinceHit > REGEN_DELAY && a.hp < a.maxHp) {
      a.hp = Math.min(a.maxHp, a.hp + REGEN_RATE * dt);
    }
    if (a.arms) {
      const done = stepArms(a.arms, dt);
      if (done === null && a.arms.weapon && !a.arms.reloading) {
        const w = WEAPONS[a.arms.weapon];
        if (w.mag > 0 && a.arms.mag[w.id] <= 0 && startReload(a.arms)) emitReload(a, w.id);
      }
    }
  }

  // Nearest road node more than RESPAWN_CLEAR m from every hostile.
  function respawnSpot(x, z, out) {
    const city = game.city;
    const nodes = city && city.nodes;
    out.x = city && city.spawn ? city.spawn.x : x;
    out.z = city && city.spawn ? city.spawn.z : z;
    if (!nodes || !nodes.length) return out;
    let best = Infinity, any = Infinity;
    const actors = game.actors, vs = game.vehicles;
    const R2 = RESPAWN_CLEAR * RESPAWN_CLEAR;
    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i];
      const d = (n.x - x) * (n.x - x) + (n.z - z) * (n.z - z);
      if (d < any) {
        any = d;
        if (best === Infinity) {
          out.x = n.x;
          out.z = n.z;
        }
      }
      if (d >= best) continue;
      let clear = true;
      for (let k = 0; k < actors.length && clear; k++) {
        const a = actors[k];
        if ((a.team !== 'crew' && a.team !== 'police') || !canBeHit(a)) continue;
        if ((a.x - n.x) * (a.x - n.x) + (a.z - n.z) * (a.z - n.z) < R2) clear = false;
      }
      for (let k = 0; k < vs.length && clear; k++) {
        const v = vs[k];
        if (!v || !(v.police || v.hostile) || v.wrecked) continue;
        if ((v.x - n.x) * (v.x - n.x) + (v.z - n.z) * (v.z - n.z) < R2) clear = false;
      }
      if (!clear) continue;
      best = d;
      out.x = n.x;
      out.z = n.z;
    }
    return out;
  }
  const SPOT = { x: 0, z: 0 };

  function respawn() {
    const w = game.player && game.player.walker;
    if (!w) return;
    respawnSpot(w.x, w.z, SPOT);
    reviveAt(SPOT.x, SPOT.z);
  }

  // Stand the player up at (x, z) with full health and clear weapon cooldowns.
  function reviveAt(x, z) {
    const p = game.player;
    const w = p && p.walker;
    if (!w) return;
    SPOT.x = x;
    SPOT.z = z;
    w.x = w.px = SPOT.x;
    w.z = w.pz = SPOT.z;
    w.vx = w.vz = 0;
    if (w.speed !== undefined) w.speed = 0;
    resetActor(w);
    if (w.arms) {
      w.arms.cool = 0;
      w.arms.reloadT = 0;
      w.arms.reloading = null;
    }
    if (w.stamina !== undefined) w.stamina = 1;
    // Placed charges fizzle when the player comes back.
    for (let i = 0; i < stickies.length; i++) if (stickies[i].owner === w) fizzle(stickies[i]);
    throwAim = false;
    throwCancel = false;
    p.x = SPOT.x;
    p.z = SPOT.z;
    p.health = w.hp;
    const r = EV.respawn;
    r.x = SPOT.x;
    r.z = SPOT.z;
    emit(game, 'respawn');
  }

  // Throw direction from the camera (yaw and pitch) while aiming a throw.
  function throwDir(w, out) {
    const c = game.chase;
    const aim = game.aim;
    if (c && c.aim && c.aim.on && Number.isFinite(c.aim.yaw)) {
      const cp = Math.cos(c.aim.pitch || 0);
      out.x = Math.cos(c.aim.yaw) * cp;
      out.y = Math.sin(c.aim.pitch || 0);
      out.z = Math.sin(c.aim.yaw) * cp;
    } else if (aim && aim.manual) {
      out.x = aim.dx;
      out.y = aim.dy;
      out.z = aim.dz;
    } else {
      out.x = Math.cos(w.heading);
      out.y = 0;
      out.z = Math.sin(w.heading);
    }
    return out;
  }

  // Seeker of the player's armed aircraft and the lock events.
  function emitLock(c, t, state) {
    const e = EV.lock;
    e.craft = c;
    e.target = t;
    e.state = state;
    emit(game, 'lock');
  }
  function stepPlayerSeeker(v, input, dt) {
    const arms = v.arms;
    const s1 = mountFor(arms, 1), s0 = mountFor(arms, 0);
    const m = MOUNTS[s1] || MOUNTS[s0];
    seekCtx.actors = game.actors;
    seekCtx.vehicles = game.vehicles;
    seekCtx.collision = game.collision;
    seekCtx.seaY = seaYOf(game);
    seekCtx.self = game.player.walker;
    seekCtx.range = m ? m.range : 300;
    const cycle = !!(input.consume && input.consume('lock'));
    const prev = seeker.target;
    const ev = stepSeeker(seeker, v, seekCtx, dt, cycle);
    if (ev === 'lost') emitLock(v, prev, 'lost');
    else if (ev) emitLock(v, seeker.target, ev);
  }

  // Fire direction for a mount: the craft hook, else the nose bent
  // toward the seeker target by the mount's `bend` angle.
  function mountAim(v, slot, id, out) {
    const hk = hooksFor(v);
    if (hk.aim && hk.aim(game, v, slot, id, out)) return out;
    noseDir(v, out);
    const m = MOUNTS[id];
    const t = seeker.target;
    if (!m || !m.bend || !t || !targetAlive(t)) return out;
    mountMuzzle(v, slot, id, m, MZ2);
    targetCentre(t, TGT);
    let ex = TGT.x - MZ2.x, ey = TGT.y - MZ2.y, ez = TGT.z - MZ2.z;
    const el = Math.sqrt(ex * ex + ey * ey + ez * ez);
    if (!(el > 1e-6)) return out;
    ex /= el;
    ey /= el;
    ez /= el;
    const dot = Math.max(-1, Math.min(1, out.x * ex + out.y * ey + out.z * ez));
    const ang = Math.acos(dot);
    if (ang > m.bend) return out; // too far off: straight along the nose
    out.x = ex;
    out.y = ey;
    out.z = ez;
    return out;
  }
  const MZ2 = { x: 0, y: 0, z: 0 };
  const AIMV = { x: 0, y: 0, z: 0 };

  // Best craft (or person) within MISSILE_ASSIST of the fire direction.
  const ATP = { x: 0, y: 0, z: 0 };
  function assistTarget(v, dir) {
    const ray = noseRay(v, game.seaY || 0);
    let best = null, bA = MISSILE_ASSIST;
    const vs = game.vehicles;
    const sea = game.seaY || 0;
    for (let pass = 0; pass < 2; pass++) {
      const list = pass === 0 ? vs : game.actors;
      if (!list) continue;
      for (let i = 0; i < list.length; i++) {
        const t = list[i];
        if (!t || t === v || !targetAlive(t) || (pass === 1 && t.team === 'player')) continue;
        targetPoint(t, sea, ATP);
        const dx = ATP.x - ray.x, dy = ATP.y - ray.y, dz = ATP.z - ray.z;
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 < 100 || d2 > 600 * 600) continue;
        const a = angleTo(ray.x, ray.y, ray.z, dir.x, dir.y, dir.z, ATP.x, ATP.y, ATP.z);
        if (a >= bA || !lineOfSight(game.collision, ray.x, ray.y, ray.z, ATP.x, ATP.y, ATP.z)) continue;
        best = t;
        bA = a;
      }
    }
    return best;
  }

  function craftControls(w, v, input, dt) {
    const hk = hooksFor(v);
    if (hk.controls) hk.controls(game, v, input, dt);
    const arms = ensureArms(v);
    if (!arms) return false;
    if (v.kind === 'plane' || v.kind === 'heli') stepPlayerSeeker(v, input, dt);
    if (input.held && input.held('fire') && mountFor(arms, 0)) {
      mountAim(v, 0, mountFor(arms, 0), AIMV);
      fireMount(v, 0, AIMV.x, AIMV.y, AIMV.z, w, null);
    }
    if (input.held && input.held('fire2') && mountFor(arms, 1)) {
      const id = mountFor(arms, 1);
      mountAim(v, 1, id, AIMV);
      const isMsl = MOUNTS[id].type === 'missile';
      let t = isMsl && seeker.state === 'locked' ? seeker.target : null;
      // No lock yet: the missile still homes on what the nose points at.
      if (isMsl && !t) t = assistTarget(v, AIMV);
      fireMount(v, 1, AIMV.x, AIMV.y, AIMV.z, w, t);
    }
    if (input.consume && input.consume('drop') && arms.drop) {
      noseDir(v, AIMV);
      fireMount(v, 'drop', AIMV.x, AIMV.y, AIMV.z, w, null);
    }
    return true;
  }

  function playerControls(dt) {
    const p = game.player, input = game.input;
    const w = p && p.walker;
    preview.on = false;
    dropPreview.on = false;
    if (!w || !w.arms || !input) return;
    const v = p.vehicle;
    // DETONATE works in every mode while charges exist.
    if (input.consume && input.consume('detonate')) detonateStickies(w);
    // Police craft: the horn action toggles siren and light bar.
    if (v && v.spec && v.spec.police && input.consume && input.consume('horn')) {
      v.siren = !v.siren;
      const e = EV.siren;
      e.craft = v;
      e.on = v.siren;
      emit(game, 'siren');
    }
    if (!canBeHit(w)) {
      if (input.consume) {
        input.consume('swap');
        input.consume('reload');
        input.consume('cancel');
      }
      throwAim = false;
      return;
    }
    if (v && v !== seekCtx.craft) {
      resetSeeker(seeker);
      seekCtx.craft = v;
    } else if (!v) seekCtx.craft = null;
    const held = !!(input.held && input.held('fire'));
    const cancel = !!(input.consume && input.consume('cancel'));
    const wpn = WEAPONS[w.arms.weapon];
    const throwing = !v && isThrown(wpn);
    if (input.consume && input.consume('swap') && !v) {
      if (throwing && throwAim) throwCancel = true; // a swap tap while aiming cancels the throw
      else {
        nextWeapon(w.arms);
        const e = EV.weaponSwitch;
        e.actor = w;
        e.weapon = w.arms.weapon;
        emit(game, 'weaponSwitch');
      }
    }
    if (input.consume && input.consume('reload')) {
      const id = v ? w.arms.lastGun : w.arms.weapon;
      if (startReload(w.arms, id)) emitReload(w, id);
    }
    if (v && v.spec && (v.arms || (v.spec.mounts && v.spec.mounts.length)) && v.kind !== 'car' && v.kind !== 'boat') {
      craftControls(w, v, input, dt);
      if (v.arms && v.arms.drop) {
        predictDrop(v, dropPreview);
        dropPreview.on = dropPreview.ok && !v.onGround;
      }
      return;
    }
    if (throwing) {
      // Hold = aim with the arc preview, release = throw.
      if (cancel) throwCancel = true;
      if (held && !throwCancel) {
        throwAim = true;
        throwDir(w, THROW);
        predictThrow(w, THROW.x, THROW.y, THROW.z, wpn.id, preview);
        preview.on = preview.n > 1;
        return;
      }
      if (!held) {
        if (throwAim && !throwCancel) {
          throwDir(w, THROW);
          fire(w, THROW.x, THROW.y, THROW.z, null, null);
        }
        throwAim = false;
        throwCancel = false;
      }
      return;
    }
    throwAim = false;
    throwCancel = false;
    if (!held) return;
    const aim = game.aim;
    let dx, dy, dz;
    if (aim && aim.manual) {
      dx = aim.dx;
      dy = aim.dy;
      dz = aim.dz;
    } else {
      const h = v ? (game.camHeading ?? v.heading) : w.heading;
      dx = Math.cos(h);
      dy = 0;
      dz = Math.sin(h);
    }
    if (!v) fire(w, dx, dy, dz, null, null);
    else if (v.kind === 'car' || v.kind === 'boat') fire(w, dx, dy, dz, v, w.arms.lastGun);
  }

  function stepBumps() {
    const actors = game.actors;
    for (let i = 0; i < actors.length; i++) {
      const a = actors[i];
      const c = a.bumpBy;
      if (!c) continue;
      a.bumpBy = null;
      const v = a.bumpV;
      a.bumpV = 0;
      if (!(v > RAM_MIN) || !canBeHit(a)) continue;
      const sp = Math.sqrt(c.vx * c.vx + c.vz * c.vz) || 1;
      setPush((c.vx / sp) * v * 0.5, (c.vz / sp) * v * 0.5);
      setFall(c.vx, c.vz, Math.min(FALL_RAM_MAX, FALL_RAM_K * v), Math.min(RAM_THROW_MAX, RAM_THROW_UP + RAM_THROW_PER * v));
      damage(game, a, RAM_DMG * v, c, 'ram');
    }
  }

  const sys = {
    name: 'combat',
    rng,
    projectiles,
    decals,
    hulls,
    queue,
    stickies,
    preview,
    dropPreview,
    seeker,
    ragdolls,
    hooks: CRAFT_HOOKS,
    burnAll: false, // true: every craft under 25% burns, not only ones combat hurt
    get burningCount() { return burningCount; },
    get dropped() { return dropped; },
    liveExplosions: () => countSince(LIVE_T),
    damage: (target, amount, source, kind) => damage(game, target, amount, source, kind),
    fire,
    fireMount,
    predictThrow,
    predictDrop,
    detonateStickies,
    countStickies,
    armsOf: ensureArms,
    get throwAiming() { return throwAim; },
    // The touch weapon wheel: pick a weapon by id on foot. Same event as a
    // SWAP tap (the HUD toasts the name); a throw being aimed is cancelled.
    pickWeapon(id) {
      const w = game.player && game.player.walker;
      if (!w || !w.arms || !WEAPONS[id] || game.player.vehicle) return false;
      if (throwAim) throwCancel = true;
      selectWeapon(w.arms, id);
      const e = EV.weaponSwitch;
      e.actor = w;
      e.weapon = w.arms.weapon;
      emit(game, 'weaponSwitch');
      return true;
    },
    trace: (x, y, z, dx, dy, dz, len, skipActor, skipCraft, out = TR) => trace(game, x, y, z, dx, dy, dz, len, skipActor, skipCraft, out),
    explode: (x, y, z, r, source = null, depth = 0, scale = 1, craft = null) => requestExplosion(x, y, z, r, source, depth, craft, 0, scale),
    craftDestroyed,
    respawn,
    reviveAt,
    respawnSpot,
    addActor: (a) => addActor(game, a),
    removeActor: (a) => removeActor(game, a),
    fixedUpdate(dt) {
      time += dt;
      const vs = game.vehicles;
      if (vs) for (let i = 0; i < vs.length; i++) if (vs[i] && vs[i].arms) stepCraftArms(vs[i].arms, dt);
      playerControls(dt);
      stepBumps();
      stepProjectiles(dt);
      stepStickies(dt);
      stepQueue(dt);
      stepToss(dt);
      stepBurning(dt);
      stepWrecks(dt);
      stepRagdolls(ragdolls, dt, ragFix);
      bodyLands();
      const actors = game.actors;
      for (let i = 0; i < actors.length; i++) stepActor(actors[i], dt);
      capBodies();
      const p = game.player;
      if (p && p.walker && typeof p.walker.hp === 'number') p.health = p.walker.hp;
    },
  };
  game.combat = sys;

  // The player is always an actor (skipped by hits while in a craft).
  const pw = game.player && game.player.walker;
  if (pw) {
    if (pw.team !== 'player') initActor(pw, 'player');
    if (!pw.arms) pw.arms = createArms('pistol');
    addActor(game, pw);
  }
  return sys;
}
