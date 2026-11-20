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
// - Input actions read here: held 'fire', tapped 'swap', 'reload'.
// - AI shooters call `game.combat.fire(actor, dx, dy, dz, craft?, weaponId?)`.
// - Anything that hurts calls `damage(game, target, amount, source, kind)`.
import { createRng } from '../core/rng.js';
import { exitPosition } from '../entities/onfoot.js';
import {
  WEAPONS, createArms, nextWeapon, startReload, stepArms, tryUse, USE_NO, USE_LAST,
} from '../core/weapons.js';

// ---------------------------------------------------------------------
// Tunables (COMBAT.md)
// ---------------------------------------------------------------------
export const HP = { player: 100, civ: 30, crew: 60, police: 70 };
export const CRAFT_MULT = { bullet: 0.5, melee: 0.1, blast: 1, ram: 1, fire: 1 };
export const HIT_FLASH = 0.15;
export const KNOCK_DECAY = 6; // m/s^2
export const ACTOR_HEIGHT = 1.8;
export const MUZZLE_Y = 1.4;
export const DOWN_T = 1.6, GETUP_T = 0.6, OUT_LIE_T = 3, FADE_T = 1;
export const PLAYER_DOWN_T = 2.5, PLAYER_FADE_T = 1;
export const REGEN_DELAY = 5, REGEN_RATE = 10;
export const RAM_MIN = 4; // m/s closing speed that knocks a person down
export const RAM_DMG = 4; // damage per m/s of closing speed
export const BLAST_DMG = 120, BLAST_CRAFT_MULT = 1.5;
export const CRAFT_BLAST_R = 8, CRAFT_PUSH = 12;
export const BURN_BELOW = 0.25, BURN_RATE = 0.03, BURN_T = 6;
export const MAX_DEPTH = 2;
export const RATE_WINDOW = 0.5, RATE_MAX = 3, QUEUE_DELAY = 0.3, CHAIN_DELAY = 0.25;
export const LIVE_T = 1.2; // seconds an explosion counts as "live"
export const RESPAWN_CLEAR = 60;
export const GRAVITY = 9.81;
export const CAPS = { actors: 36, projectiles: 24, explosions: 4, burning: 4, decals: 24, queue: 8 };

// ---------------------------------------------------------------------
// Shared event payloads: one object per name, filled before each emit.
// Listeners read them during the call and must not keep them.
// ---------------------------------------------------------------------
const EV = {
  shot: { shooter: null, weapon: null, x: 0, y: 0, z: 0, dx: 0, dy: 0, dz: 0, hx: 0, hy: 0, hz: 0, hitKind: 'none' },
  hit: { target: null, source: null, amount: 0, kind: 'bullet', x: 0, y: 0, z: 0 },
  down: { target: null, source: null, kind: 'bullet' },
  out: { target: null, source: null },
  explosion: { x: 0, y: 0, z: 0, radius: 0, source: null, depth: 0 },
  burning: { craft: null, on: false },
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

function knockDown(game, a, source, kind) {
  a.life = 'down';
  a.lifeT = 0;
  if (a.vx !== undefined) a.vx = a.vz = 0;
  const d = EV.down;
  d.target = a;
  d.source = source;
  d.kind = kind;
  emit(game, 'down');
  if (a.hp > 0) return;
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
  emit(game, 'hit');
}

function damageCraft(game, c, amount, source, kind, px, pz) {
  if (c.wrecked || c.removed) return 0;
  const applied = amount * (CRAFT_MULT[kind] ?? 1);
  if (!(applied > 0)) return 0;
  c.health -= applied;
  c.lastHitBy = source;
  c.combatHit = true;
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
  if (!target || !(amount > 0) || !Number.isFinite(amount)) return 0;
  const p = game && game.player;
  // The player in a craft is not hit directly: the craft takes it.
  if (p && target === p.walker && p.vehicle) {
    PUSH.x = px;
    PUSH.z = pz;
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
  emitHit(game, target, source, applied, kind, (target.y || 0) + 1.1);
  let goDown = target.hp <= 0 || kind === 'blast' || kind === 'ram';
  if (kind === 'melee') {
    target.bonks = (target.bonks || 0) + 1;
    if (target.bonks >= WEAPONS.wrench.knockHits) goDown = true;
  }
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
  const k = downAmount(a);
  mesh.rotation.z = k * Math.PI * 0.5;
  mesh.position.y += k * 0.15 - (a.fade || 0) * 0.5;
  mesh.visible = !(a.fade >= 1);
}

// ---------------------------------------------------------------------
// The system
// ---------------------------------------------------------------------
export function createCombat(game, { seed = 23023 } = {}) {
  const rng = createRng(seed);
  if (!game.actors) game.actors = [];
  if (!game.aim) game.aim = { dx: 1, dy: 0, dz: 0, manual: false };
  const TR = createTraceResult();
  const EXIT = { x: 0, z: 0, ok: false };
  const DIR = { x: 0, y: 0, z: 0 };

  // Projectile pool.
  const projectiles = [];
  for (let i = 0; i < CAPS.projectiles; i++) {
    projectiles.push({
      active: false, weapon: null, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0,
      travelled: 0, fuse: 0, source: null, craft: null, rest: false,
    });
  }
  // Explosion queue and recent start times (for the rate and live caps).
  const queue = [];
  for (let i = 0; i < CAPS.queue; i++) {
    queue.push({ active: false, x: 0, y: 0, z: 0, r: 0, source: null, depth: 0, craft: null, delay: 0, direct: null });
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

  function requestExplosion(x, y, z, r, source, depth, craft = null, delay = 0) {
    if (delay <= 0 && curDepth < 0 && canStart()) {
      detonate(x, y, z, r, source, depth, craft);
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
    c.scorched = true;
    if (depth > MAX_DEPTH || c.exploded) return;
    c.exploded = true;
    const h = (c.spec && c.spec.height) || 1.5;
    requestExplosion(c.x, craftBase(game, c) + h * 0.5, c.z, CRAFT_BLAST_R, c.lastHitBy, depth, c, depth > 0 ? CHAIN_DELAY : 0);
  }

  function ejectPlayer(c) {
    const p = game.player;
    const w = p && p.walker;
    if (!w || p.vehicle !== c) return;
    if (c.spec && c.spec.width) exitPosition(c, game.world, EXIT);
    else EXIT.ok = false;
    const x = EXIT.ok ? EXIT.x : c.x, z = EXIT.ok ? EXIT.z : c.z;
    w.x = w.px = x;
    w.z = w.pz = z;
    w.vx = w.vz = 0;
    c.driver = null;
    p.vehicle = null;
    if (game.setPlayerMode) game.setPlayerMode('foot');
    else p.mode = 'foot';
  }

  function detonate(x, y, z, r, source, depth, craft) {
    starts[startHead] = time;
    startHead = (startHead + 1) % starts.length;
    const e = EV.explosion;
    e.x = x;
    e.y = y;
    e.z = z;
    e.radius = r;
    e.source = source;
    e.depth = depth;
    emit(game, 'explosion');
    if (y < 3 && isLand(game, x, z)) addDecal(x, z, r * 0.45);
    const prev = curDepth;
    curDepth = depth;
    if (craft) {
      craft.wrecked = true;
      craft.health = 0;
      craft.scorched = true;
      stopBurning(craft);
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
      const push = 2 + 6 * k;
      if (hd > 1e-3) setPush((ex / hd) * push, (ez / hd) * push);
      damage(game, a, BLAST_DMG * k, source, 'blast');
    }
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
      if (hd > 1e-3 && !c.wrecked) setPush((ex / hd) * CRAFT_PUSH * k, (ez / hd) * CRAFT_PUSH * k);
      damage(game, c, BLAST_DMG * k * BLAST_CRAFT_MULT, source, 'blast');
    }
    curDepth = prev;
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
      detonate(q.x, q.y, q.z, q.r, q.source, q.depth, c);
      q.craft = null;
      q.source = null;
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

  function launch(actor, craft, w, mx, my, mz, dx, dy, dz) {
    let pr = null;
    for (let i = 0; i < projectiles.length; i++) {
      if (!projectiles[i].active) {
        pr = projectiles[i];
        break;
      }
    }
    if (!pr) return false; // pool full: the trigger still clicks
    pr.active = true;
    pr.weapon = w.id;
    pr.x = mx;
    pr.y = my;
    pr.z = mz;
    pr.travelled = 0;
    pr.source = actor;
    pr.craft = craft;
    pr.rest = false;
    if (w.type === 'rocket') {
      pr.vx = dx * w.speed;
      pr.vy = dy * w.speed;
      pr.vz = dz * w.speed;
      pr.fuse = w.range / w.speed + 1;
    } else {
      // Thrown: about 45 degrees plus the aim's own pitch, reaching
      // `range` metres on flat ground.
      const v = Math.sqrt(GRAVITY * w.range);
      const hl = Math.sqrt(dx * dx + dz * dz) || 1;
      const el = Math.max(0.2, Math.min(1.2, 0.6 + Math.asin(Math.max(-1, Math.min(1, dy)))));
      pr.vx = (dx / hl) * v * Math.cos(el);
      pr.vz = (dz / hl) * v * Math.cos(el);
      pr.vy = v * Math.sin(el);
      pr.fuse = w.fuse;
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
        trace(game, mx, my, mz, d.x, d.y, d.z, w.range, actor, craft, TR);
        const kind = TR.kind;
        const hx = TR.x, hy = TR.y, hz = TR.z;
        const target = TR.actor || TR.craft;
        if (target) {
          if (w.push && TR.actor) setPush(d.x * w.push, d.z * w.push);
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

  // --- Projectiles ---
  function detonateProjectile(pr, x, y, z, direct) {
    const w = WEAPONS[pr.weapon];
    pr.active = false;
    if (direct && w.dmg > 0) damage(game, direct, w.dmg, pr.source, 'blast');
    requestExplosion(x, y, z, w.blast, pr.source, 0, null, 0);
    pr.source = null;
    pr.craft = null;
  }

  function stepProjectiles(dt) {
    for (let i = 0; i < projectiles.length; i++) {
      const pr = projectiles[i];
      if (!pr.active) continue;
      const w = WEAPONS[pr.weapon];
      pr.fuse -= dt;
      if (w.type === 'thrown') {
        if (pr.fuse <= 0) {
          detonateProjectile(pr, pr.x, pr.y + 0.2, pr.z, null);
          continue;
        }
        if (pr.rest) continue;
        pr.vy -= GRAVITY * dt;
      }
      const sx = pr.vx * dt, sy = pr.vy * dt, sz = pr.vz * dt;
      const len = Math.sqrt(sx * sx + sy * sy + sz * sz);
      if (!(len > 1e-9)) continue;
      const ux = sx / len, uy = sy / len, uz = sz / len;
      trace(game, pr.x, pr.y, pr.z, ux, uy, uz, len, pr.source, pr.craft, TR);
      if (TR.kind === 'water') {
        pr.active = false;
        pr.source = null;
        pr.craft = null;
        if (game.events) game.events.emit('splash', TR.x, TR.z);
        continue;
      }
      if (w.type === 'rocket') {
        pr.travelled += TR.t;
        if (TR.kind !== 'none') {
          detonateProjectile(pr, TR.x, TR.y, TR.z, TR.actor || TR.craft);
          continue;
        }
        pr.x = TR.x;
        pr.y = TR.y;
        pr.z = TR.z;
        if (pr.travelled >= w.range || pr.fuse <= 0) detonateProjectile(pr, pr.x, pr.y, pr.z, null);
        continue;
      }
      // Thrown can: bounce off whatever it meets.
      if (TR.kind === 'none') {
        pr.x = TR.x;
        pr.y = TR.y;
        pr.z = TR.z;
        continue;
      }
      const e = w.bounce;
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
      if (c.health < max * BURN_BELOW && burningCount < CAPS.burning && (c.chainDepth || 0) <= MAX_DEPTH) {
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

  // --- People ---
  function stepActor(a, dt) {
    if (a.hitT > 0) a.hitT = Math.max(0, a.hitT - dt);
    a.sinceHit = (a.sinceHit || 0) + dt;
    // Knock-back slide.
    if (a.kx || a.kz) {
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
    const p = game.player;
    const w = p && p.walker;
    if (!w) return;
    respawnSpot(w.x, w.z, SPOT);
    w.x = w.px = SPOT.x;
    w.z = w.pz = SPOT.z;
    w.vx = w.vz = 0;
    if (w.speed !== undefined) w.speed = 0;
    resetActor(w);
    if (w.stamina !== undefined) w.stamina = 1;
    p.x = SPOT.x;
    p.z = SPOT.z;
    p.health = w.hp;
    const r = EV.respawn;
    r.x = SPOT.x;
    r.z = SPOT.z;
    emit(game, 'respawn');
  }

  function playerControls() {
    const p = game.player, input = game.input;
    const w = p && p.walker;
    if (!w || !w.arms || !input) return;
    if (!canBeHit(w)) {
      if (input.consume) {
        input.consume('swap');
        input.consume('reload');
      }
      return;
    }
    const v = p.vehicle;
    if (input.consume && input.consume('swap') && !v) {
      nextWeapon(w.arms);
      const e = EV.weaponSwitch;
      e.actor = w;
      e.weapon = w.arms.weapon;
      emit(game, 'weaponSwitch');
    }
    if (input.consume && input.consume('reload')) {
      const id = v ? w.arms.lastGun : w.arms.weapon;
      if (startReload(w.arms, id)) emitReload(w, id);
    }
    if (!(input.held && input.held('fire'))) return;
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
      damage(game, a, RAM_DMG * v, c, 'ram');
    }
  }

  const sys = {
    name: 'combat',
    rng,
    projectiles,
    decals,
    queue,
    burnAll: false, // true: every craft under 25% burns, not only ones combat hurt
    get burningCount() { return burningCount; },
    get dropped() { return dropped; },
    liveExplosions: () => countSince(LIVE_T),
    damage: (target, amount, source, kind) => damage(game, target, amount, source, kind),
    fire,
    trace: (x, y, z, dx, dy, dz, len, skipActor, skipCraft, out = TR) => trace(game, x, y, z, dx, dy, dz, len, skipActor, skipCraft, out),
    explode: (x, y, z, r, source = null, depth = 0) => requestExplosion(x, y, z, r, source, depth, null, 0),
    craftDestroyed,
    respawn,
    respawnSpot,
    addActor: (a) => addActor(game, a),
    removeActor: (a) => removeActor(game, a),
    fixedUpdate(dt) {
      time += dt;
      playerControls();
      stepBumps();
      stepProjectiles(dt);
      stepQueue(dt);
      stepBurning(dt);
      const actors = game.actors;
      for (let i = 0; i < actors.length; i++) stepActor(actors[i], dt);
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
