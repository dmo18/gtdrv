// Armour system (docs/ARMS.md section 3): everything around the tank that
// is not its physics. Pure logic at import time (node-testable); the HUD
// overlay is only built when there is a DOM.
// - Player turret aim: the camera ray (or a LOCK target) sets the tank's
//   aimYaw / aimPitch; fire bends to a target in a 6 degree cone. Filled
//   into combat's CRAFT_HOOKS.tank when the system is created.
// - Crush and ram damage recorded by collideTank (game.js pair loop),
//   benches and signs rolled through, the `crush` event.
// - Police / crew tanks under 35% health stop and their crew bail out.
// - tankGunnerStep: the AI gunner core task 34 drives (pure).
import { CRAFT_HOOKS, damage, canBeHit } from './combat.js';
import { MOUNTS } from '../core/weapons.js';
import { angleDiff } from '../core/rng.js';
import {
  pickAssist, pickLock, keepLock, targetPoint, followAngle, lineOfSight, alive,
} from '../core/aim.js';
import { barrelRay, turretWorldYaw, RAM_PER_MS } from '../entities/tank.js';
import { createTankHud } from '../ui/tankhud.js';

const DEG = Math.PI / 180;
export const TANK_ASSIST_CONE = 6 * DEG;
export const TANK_LOCK_RANGE = 300;
export const BAIL_BELOW = 0.35;
export const RAM_GAP = 0.5; // s between ram hits on the same craft
export const SOFT_PROPS = new Set(['bench', 'bin', 'planter', 'bikes', 'meter', 'mailbox', 'hydrant', 'barrier', 'stopsign', 'namesign', 'umbrella']);
export const PROP_CRUSH_R = 1.4; // m from a body circle that rolls a prop over
export const PROP_AGAIN = 8; // s before the same prop crunches again
// AI gunner (task 34): one shell per 6 s, 1.2 s telegraph, never close.
export const GUNNER = { cool: 6, telegraph: 1.2, minDist: 15, maxDist: 220, onTarget: 0.06 };

const SHOT_G = 9.81;

// ---------------------------------------------------------------------
// Aim helpers (pure)
// ---------------------------------------------------------------------
const BR = { x: 0, y: 0, z: 0, dx: 1, dy: 0, dz: 0, px: 0, py: 0, pz: 0 };

// Point the turret (aimYaw / aimPitch) at a world point from the ring.
export function tankAimAt(t, x, y, z) {
  barrelRay(t, BR);
  const dx = x - BR.px, dy = y - BR.py, dz = z - BR.pz;
  const h = Math.sqrt(dx * dx + dz * dz);
  if (!(h > 0.5)) return false;
  t.aimYaw = Math.atan2(dz, dx);
  t.aimPitch = Math.atan2(dy, h);
  t.aimSet = true;
  return true;
}

// Extra rise (m) a shell needs to land on a point d metres away.
export function shellDrop(m, d) {
  if (!m || m.type !== 'shell') return 0;
  const tf = d / (m.speed || 90);
  return 0.5 * SHOT_G * (m.drop || 0) * tf * tf;
}

// Angle between the barrel and the direction to a point.
export function offBarrel(t, x, y, z) {
  barrelRay(t, BR);
  const dx = x - BR.x, dy = y - BR.y, dz = z - BR.z;
  const l = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (!(l > 1e-6)) return 0;
  const c = (dx * BR.dx + dy * BR.dy + dz * BR.dz) / l;
  return Math.acos(c > 1 ? 1 : c < -1 ? -1 : c);
}

// ---------------------------------------------------------------------
// AI gunner core (pure; task 34 calls it each step for a police tank)
// ---------------------------------------------------------------------
export function createGunner() {
  return { cool: 2, tele: 0, aiming: false, fired: 0 };
}

// g: createGunner() state; t: the tank; target: the craft or actor to
// shoot; ctx: { collision, onFoot (target is a person), hurtBy (the
// target hurt this tank) }. Slews the turret onto the target and returns
// 'aim' when the 1.2 s telegraph starts, 'fire' when the shell should
// go now (the caller fires the mount at AI speed), else null.
const TPG = { x: 0, y: 0, z: 0 };
export function tankGunnerStep(g, t, target, ctx, dt) {
  g.cool = Math.max(0, g.cool - dt);
  if (!t || t.wrecked || t.bailed || !target || !alive(target)) return stop(g);
  targetPoint(target, ctx && ctx.seaY, TPG);
  const d = Math.hypot(TPG.x - t.x, TPG.z - t.z);
  if (d < GUNNER.minDist || d > GUNNER.maxDist) return stop(g);
  if (ctx && ctx.onFoot && !ctx.hurtBy) return stop(g);
  barrelRay(t, BR);
  if (!lineOfSight(ctx && ctx.collision, BR.px, BR.py, BR.pz, TPG.x, TPG.y, TPG.z)) return stop(g);
  tankAimAt(t, TPG.x, TPG.y + shellDrop({ type: 'shell', speed: MOUNTS.cannon.aiSpeed, drop: MOUNTS.cannon.drop }, d), TPG.z);
  if (g.cool > 0) return stop(g);
  const on = Math.abs(angleDiff(t.aimYaw, turretWorldYaw(t))) < GUNNER.onTarget;
  if (!on && !g.aiming) return null;
  if (!g.aiming) {
    g.aiming = true;
    g.tele = 0;
    return 'aim';
  }
  g.tele += dt;
  if (g.tele < GUNNER.telegraph) return null;
  g.aiming = false;
  g.tele = 0;
  g.cool = GUNNER.cool;
  g.fired++;
  return 'fire';
}
function stop(g) {
  g.aiming = false;
  g.tele = 0;
  return null;
}

// ---------------------------------------------------------------------
// The system
// ---------------------------------------------------------------------
export function createArmor(game, uiRoot = null) {
  const ctx = { actors: null, vehicles: null, collision: null, self: null, selfCraft: null, seaY: -0.6 };
  const eye = { x: 0, y: 0, z: 0 };
  const fwd = { x: 1, y: 0, z: 0 };
  const muz = { x: 0, y: 0, z: 0 };
  const tp = { x: 0, y: 0, z: 0 };
  const lockSt = { lock: null, lostT: 0 };
  const TRo = { kind: 'none', t: 0, x: 0, y: 0, z: 0, actor: null, craft: null };
  const crushEv = { tank: null, target: null, x: 0, z: 0 };
  const bailEv = { craft: null };
  const aimEv = { craft: null, target: null };
  // The point the player's turret is told to aim at (for the HUD).
  const view = { aimX: 0, aimY: 0, aimZ: 0, have: false, lock: null, assist: null };

  function fillCtx(t) {
    const p = game.player;
    ctx.actors = game.actors;
    ctx.vehicles = game.vehicles;
    ctx.collision = game.collision;
    ctx.self = p ? p.walker : null;
    ctx.selfCraft = t;
    ctx.seaY = Number.isFinite(game.seaY) ? game.seaY : -0.6;
  }

  // ---- hooks (player aboard) ----
  function controls(g, t, input) {
    fillCtx(t);
    barrelRay(t, BR);
    muz.x = BR.px;
    muz.y = BR.py;
    muz.z = BR.pz;
    const chase = g.chase;
    const ta = chase && chase.tankAim;
    if (ta && chase.ray) {
      eye.x = chase.ray.x;
      eye.y = chase.ray.y;
      eye.z = chase.ray.z;
      fwd.x = chase.ray.dx;
      fwd.y = chase.ray.dy;
      fwd.z = chase.ray.dz;
    } else if (g.aim && g.aim.manual) {
      eye.x = muz.x; eye.y = muz.y; eye.z = muz.z;
      fwd.x = g.aim.dx; fwd.y = g.aim.dy; fwd.z = g.aim.dz;
    } else {
      eye.x = muz.x; eye.y = muz.y; eye.z = muz.z;
      fwd.x = BR.dx; fwd.y = BR.dy; fwd.z = BR.dz;
    }
    // LOCK: tap picks (or cycles to the next) target in a 35 degree cone.
    if (input && input.consume && input.consume('lock')) {
      const prev = lockSt.lock;
      lockSt.lock = pickLock(ctx, eye, fwd, muz, TANK_LOCK_RANGE, prev);
      lockSt.lostT = 0;
      if (!lockSt.lock && prev) lockSt.lock = null;
    }
    if (lockSt.lock && !keepLock(lockSt, ctx, muz, TANK_LOCK_RANGE, 1 / 60)) lockSt.lock = null;
    view.lock = lockSt.lock;
    if (lockSt.lock) {
      targetPoint(lockSt.lock, ctx.seaY, tp);
      const d = Math.hypot(tp.x - muz.x, tp.z - muz.z);
      tankAimAt(t, tp.x, tp.y + shellDrop(MOUNTS.cannon, d), tp.z);
      view.aimX = tp.x; view.aimY = tp.y; view.aimZ = tp.z;
      view.have = true;
      // The camera follows the lock, so the right thumb only taps CANNON.
      if (ta) {
        ta.holdDrag = true;
        ta.yaw = followAngle(ta.yaw, Math.atan2(tp.z - eye.z, tp.x - eye.x), 1 / 60);
      }
      return;
    }
    if (ta) ta.holdDrag = false;
    if (!(ta || (g.aim && g.aim.manual))) return; // nothing to aim with: hold
    // The turret aims at what the camera's centre ray reaches.
    const tr = g.combat && g.combat.trace;
    let px = eye.x + fwd.x * TANK_LOCK_RANGE, py = eye.y + fwd.y * TANK_LOCK_RANGE, pz = eye.z + fwd.z * TANK_LOCK_RANGE;
    if (tr) {
      tr(eye.x, eye.y, eye.z, fwd.x, fwd.y, fwd.z, TANK_LOCK_RANGE, ctx.self, t, TRo);
      // Too close (the hull, the ground at the tracks): aim further out.
      if (TRo.kind !== 'none' && TRo.t > 14) {
        px = TRo.x; py = TRo.y; pz = TRo.z;
      } else if (TRo.kind !== 'none') {
        const k = 40;
        px = eye.x + fwd.x * k; py = Math.max(0.5, eye.y + fwd.y * k); pz = eye.z + fwd.z * k;
      }
    }
    const d = Math.hypot(px - muz.x, pz - muz.z);
    tankAimAt(t, px, py + shellDrop(MOUNTS.cannon, d), pz);
    view.aimX = px; view.aimY = py; view.aimZ = pz;
    view.have = true;
  }

  // Fire along the barrel; bend to a target inside a 6 degree cone (the
  // cannon also lifts for its drop).
  function aim(g, t, slot, id, out) {
    fillCtx(t);
    barrelRay(t, BR);
    out.x = BR.dx;
    out.y = BR.dy;
    out.z = BR.dz;
    const m = MOUNTS[id];
    if (!m) return true;
    eye.x = BR.x; eye.y = BR.y; eye.z = BR.z;
    fwd.x = BR.dx; fwd.y = BR.dy; fwd.z = BR.dz;
    const best = pickAssist(ctx, eye, fwd, eye, { range: m.range, cone: TANK_ASSIST_CONE }) || craftAssist(t, m.range);
    view.assist = best;
    if (!best) return true;
    targetPoint(best, ctx.seaY, tp);
    const dx = tp.x - BR.x, dz = tp.z - BR.z;
    const h = Math.sqrt(dx * dx + dz * dz);
    const dy = tp.y + shellDrop(m, h) - BR.y;
    const l = Math.sqrt(h * h + dy * dy);
    if (!(l > 1e-6)) return true;
    out.x = dx / l;
    out.y = dy / l;
    out.z = dz / l;
    return true;
  }

  // Any craft (parked cars too) near the barrel line: big targets.
  function craftAssist(t, range) {
    const vs = game.vehicles;
    if (!vs) return null;
    let best = null, ba = TANK_ASSIST_CONE;
    for (let i = 0; i < vs.length; i++) {
      const c = vs[i];
      if (!c || c === t || c.wrecked || c.removed || !c.spec) continue;
      const dx = c.x - BR.x, dz = c.z - BR.z;
      if (dx * dx + dz * dz > range * range || dx * BR.dx + dz * BR.dz <= 0) continue;
      targetPoint(c, ctx.seaY, tp);
      const a = offBarrel(t, tp.x, tp.y, tp.z);
      if (a >= ba) continue;
      barrelRay(t, BR);
      if (!lineOfSight(ctx.collision, BR.x, BR.y, BR.z, tp.x, tp.y, tp.z)) continue;
      ba = a;
      best = c;
    }
    barrelRay(t, BR);
    return best;
  }

  function muzzle(g, t, slot, id, out) {
    barrelRay(t, BR);
    if (id === 'coax') {
      // Beside the gun mantlet, along the barrel.
      const yaw = t.heading + t.turretYaw;
      const rx = -Math.sin(yaw), rz = Math.cos(yaw);
      out.x = BR.px + BR.dx * 1.6 + rx * 0.42;
      out.y = BR.py + 0.08 + BR.dy * 1.6;
      out.z = BR.pz + BR.dz * 1.6 + rz * 0.42;
      return true;
    }
    out.x = BR.x;
    out.y = BR.y;
    out.z = BR.z;
    return true;
  }

  function fired(g, t, slot, id) {
    if (id !== 'cannon') return;
    t.recoil = 1;
    // A small rock back on the hull and a camera thump.
    barrelRay(t, BR);
    t.swayV = (t.swayV || 0) + 0.25 * Math.cos(t.turretYaw);
    if (g.player && g.player.vehicle === t && g.chase && g.chase.kick) g.chase.kick(9);
  }

  const hooks = CRAFT_HOOKS.tank;
  hooks.controls = controls;
  hooks.aim = aim;
  hooks.muzzle = muzzle;
  hooks.fired = fired;

  // ---- soft props (benches, signs): a spatial grid of the furniture ----
  const CELL = 16;
  const grid = new Map();
  const furn = (game.city && game.city.furniture) || [];
  const propT = new Float32Array(furn.length).fill(-99);
  for (let i = 0; i < furn.length; i++) {
    const f = furn[i];
    if (!SOFT_PROPS.has(f.type)) continue;
    const key = Math.floor(f.x / CELL) * 4096 + Math.floor(f.z / CELL);
    let list = grid.get(key);
    if (!list) grid.set(key, (list = []));
    list.push(i);
  }
  function rollProps(t, time) {
    if (!(Math.abs(t.speed) > 2) || !furn.length) return;
    const s = t.spec;
    const ch = Math.cos(t.heading), sh = Math.sin(t.heading);
    const cx0 = Math.floor(t.x / CELL), cz0 = Math.floor(t.z / CELL);
    const reach = s.length / 2 + PROP_CRUSH_R;
    for (let a = -1; a <= 1; a++) {
      for (let b = -1; b <= 1; b++) {
        const list = grid.get((cx0 + a) * 4096 + (cz0 + b));
        if (!list) continue;
        for (let k = 0; k < list.length; k++) {
          const i = list[k];
          const f = furn[i];
          const dx = f.x - t.x, dz = f.z - t.z;
          if (dx * dx + dz * dz > reach * reach) continue;
          // Inside the hull footprint (plus a little)?
          const lx = dx * ch + dz * sh, lz = -dx * sh + dz * ch;
          if (Math.abs(lx) > s.length / 2 + 0.3 || Math.abs(lz) > s.width / 2 + 0.3) continue;
          if (time - propT[i] < PROP_AGAIN) continue;
          propT[i] = time;
          emitCrush(t, null, f.x, f.z);
        }
      }
    }
  }

  function emitCrush(t, target, x, z) {
    crushEv.tank = t;
    crushEv.target = target;
    crushEv.x = x;
    crushEv.z = z;
    if (game.events && game.events.emit) game.events.emit('crush', crushEv);
  }

  let hud = null;
  if (typeof document !== 'undefined' && uiRoot && typeof uiRoot.appendChild === 'function') hud = createTankHud(uiRoot);

  let time = 0;
  const sys = {
    name: 'armor',
    view,
    lock: lockSt,
    get hudOn() { return !!hud && hud.on; },
    fixedUpdate(dt) {
      time += dt;
      const vs = game.vehicles;
      if (!vs) return;
      const p = game.player;
      for (let i = 0; i < vs.length; i++) {
        const v = vs[i];
        if (!v) continue;
        // Crushed under a tank: wrecked flat, no gore (cars only).
        if (v.crushedBy) {
          const t = v.crushedBy;
          v.crushedBy = null;
          if (!v.crushed) {
            v.crushed = true;
            v.meshDirty = true;
            // Flattened, not blown up: no blast under the tracks.
            v.exploded = true;
            if (!v.wrecked) damage(game, v, (v.spec && v.spec.health) || 1000, t, 'ram');
            v.wrecked = true;
            v.health = 0;
            if (v.wreckT === undefined) v.wreckT = 0; // flattened hulls vanish too
            emitCrush(t, v, v.x, v.z);
          }
        }
        if (v.ramBy) {
          const t = v.ramBy, cv = v.ramV || 0;
          v.ramBy = null;
          v.ramV = 0;
          if (cv > 1.5 && time - (v.ramT || -9) > RAM_GAP) {
            v.ramT = time;
            damage(game, v, RAM_PER_MS * cv, t, 'ram');
            if (v.kind === 'tank') damage(game, t, RAM_PER_MS * cv, v, 'ram');
          }
        }
        if (v.kind !== 'tank') continue;
        if (v === (p && p.vehicle)) rollProps(v, time);
        // Police or crew tanks: under 35% they stop and the crew bails.
        if (!v.bailed && !v.wrecked && (v.crewAI || (v.spec.police && v.driver && v.driver !== 'player')) && v.health < v.spec.health * BAIL_BELOW) {
          v.bailed = true;
          v.crewAI = null;
          if (v.driver !== 'player') v.driver = null;
          v.controls = null;
          bailEv.craft = v;
          if (game.events && game.events.emit) game.events.emit('tankBail', bailEv);
        }
      }
      // A lock only lives while the player sits in a tank.
      const t = p && p.vehicle;
      if (!t || t.kind !== 'tank') {
        lockSt.lock = null;
        view.lock = null;
        view.have = false;
        const ta = game.chase && game.chase.tankAim;
        if (ta) ta.holdDrag = false;
      }
    },
    render() {
      if (!hud) return;
      const p = game.player;
      const t = p && p.vehicle;
      const on = !!t && t.kind === 'tank' && !t.wrecked && !!game.camera && (!p.walker || canBeHit(p.walker));
      hud.update(on ? t : null, view, game.camera, game.combat && game.combat.armsOf ? game.combat.armsOf(t) : null);
    },
    // Telegraph helper for AI gunners (task 34): the `aim` event.
    telegraph(craft, target) {
      aimEv.craft = craft;
      aimEv.target = target;
      if (game.events && game.events.emit) game.events.emit('aim', aimEv);
    },
  };
  // Entering a tank: the camera starts looking where the turret points.
  if (game.events && game.events.on) {
    game.events.on('enter', (v) => {
      if (!v || v.kind !== 'tank') return;
      const ta = game.chase && game.chase.tankAim;
      if (ta) {
        ta.yaw = turretWorldYaw(v);
        ta.pitch = 0.1;
      }
      lockSt.lock = null;
    });
  }
  return sys;
}
