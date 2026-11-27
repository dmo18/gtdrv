// Combat HUD and the player's aim controller. docs/COMBAT.md "Touch
// controls", "Drive-by" and "Camera".
//
// Controller (fixedUpdate, after the combat system has fired this step):
// works out where the next shot goes and writes it to `game.aim`
// (dx, dy, dz unit vector, manual = true). On foot the crosshair is the
// camera's center: the aim view (chasecam `setAim`) turns with the drag,
// shots bend toward the best target in the assist cone, LOCK tracks a
// target with a soft camera follow and a swipe flicks to the next one.
// In cars and boats (drive-by) shots follow the camera's look direction
// with a wider cone. The maths lives in src/core/aim.js (node tested).
//
// HUD (render): crosshair (red over a target, ring when locked), target
// brackets, reload ring, hit markers, damage direction hints, a slim
// health bar while hurt or fighting, and the downed / respawn fade. The
// weapon, ammo and reload controls live in touch.js (`setCombat`).
//
// Armed craft (docs/ARMS.md): registers every armed-craft button once
// (src/ui/armsctl.js) and draws the nose pipper, the seeker box (shrinks
// over the 0.8 s lock, red with LOCK when locked) and an off-screen arrow
// toward the seeker target. Magazine pips and reload rings sit on the
// buttons themselves; the bomb impact ring is drawn in the world by
// combatfx.
//
// Logic works without a DOM or a camera (node tests): every DOM part
// is guarded.
import { WEAPONS, mountFor } from '../core/weapons.js';
import { registerArmsControls } from './armsctl.js';
import { noseRay } from '../core/seeker.js';
import {
  pickAssist, pickLock, pickFlick, keepLock, targetPoint, forward, dirTo, convergeDir,
  yawPitchTo, followAngle, alive, isActor,
  DRIVE_CONE, DRIVE_RANGE, LOCK_RANGE_MIN, DRAG_SLOW, FLICK_PX, FLICK_WINDOW, PITCH_MIN, PITCH_MAX,
} from '../core/aim.js';
import { AIM } from '../render/chasecam.js';
import { createTraceResult } from '../systems/combat.js';
import { angleDiff } from '../core/rng.js';

// Shows or hides an element for everyone: the visible state and the
// accessibility tree change together (hidden + aria-hidden). Safe on null.
export function setShown(el, on) {
  if (!el) return;
  el.hidden = !on;
  if (el.setAttribute) el.setAttribute('aria-hidden', on ? 'false' : 'true');
}

export const AIM_HOLD = 1.2; // s the aim view stays after FIRE is let go
export const FIGHT_T = 6; // s the health bar stays after the last shot or hit
export const MUZZLE_Y = 1.4;
const MELEE_REACH = 2.6;
const MELEE_CONE = 65 * Math.PI / 180;
const HIT_MARK_T = 0.2;
const DMG_T = 1.1;
const NO_TARGET_T = 0.9;

// The weapon wheel's pick (touch.js). On foot through the combat system. In
// a car or boat the drive-by fires the last gun (arms.lastGun), so a pick of
// a drive-by weapon sets that and announces it with the same weaponSwitch
// event a SWAP tap sends (the HUD toasts the name). Returns true on a change.
const SWITCH = { actor: null, weapon: null };
export function pickWeapon(game, id) {
  const p = game && game.player;
  const w = p && p.walker;
  const wpn = WEAPONS[id];
  if (!w || !w.arms || !wpn) return false;
  const v = p.vehicle;
  if (!v) return !!(game.combat && game.combat.pickWeapon && game.combat.pickWeapon(id));
  if ((v.kind !== 'car' && v.kind !== 'boat') || !wpn.driveBy || w.arms.lastGun === id) return false;
  w.arms.lastGun = id;
  SWITCH.actor = w;
  SWITCH.weapon = id;
  if (game.events && game.events.emit) game.events.emit('weaponSwitch', SWITCH);
  return true;
}

export function createCombatHud(game, uiRoot) {
  // ---------------- controller state ----------------
  const st = {
    mode: '', lock: null, lostT: 0, hold: 0, aiming: false, target: null, melee: false,
    fightT: 0, flickAcc: 0, flickT: 0, noTargetT: 0, driveT: 0, conv: 30,
    hitMarkT: 0, downT: -1, upT: -1,
  };
  const ctx = { actors: null, vehicles: null, collision: null, self: null, selfCraft: null, seaY: 0 };
  const eye = { x: 0, y: 0, z: 0 };
  const fwd = { x: 1, y: 0, z: 0 };
  const muzzle = { x: 0, y: 0, z: 0 };
  const dir = { x: 1, y: 0, z: 0 };
  const tp = { x: 0, y: 0, z: 0 };
  const yp = { yaw: 0, pitch: 0 };
  const aimPt = { x: 0, y: 0, z: 0 };
  const tr = createTraceResult();
  const dmg = [{ t: 0, a: 0 }, { t: 0, a: 0 }, { t: 0, a: 0 }];
  let dmgNext = 0;

  const chase = () => game.chase || null;
  const setAimView = (on) => {
    const c = chase();
    if (c && c.setAim) c.setAim(on);
  };

  // The crosshair ray and muzzle on foot.
  function footRay(w) {
    muzzle.x = w.x;
    muzzle.y = (w.y || 0) + MUZZLE_Y;
    muzzle.z = w.z;
    const c = chase();
    if (c && c.aim && c.aim.on) {
      // Ideal over-the-shoulder camera (what chasecam draws).
      forward(c.aim.yaw, c.aim.pitch, fwd);
      const sy = Math.sin(c.aim.yaw), cy = Math.cos(c.aim.yaw);
      const py = (w.y || 0) + AIM.pivot;
      eye.x = w.x - sy * AIM.side - fwd.x * AIM.dist;
      eye.y = py - fwd.y * AIM.dist;
      eye.z = w.z + cy * AIM.side - fwd.z * AIM.dist;
      return true;
    }
    const yaw = c && c.viewYaw ? c.viewYaw() : w.heading;
    fwd.x = Math.cos(yaw);
    fwd.y = 0;
    fwd.z = Math.sin(yaw);
    eye.x = muzzle.x;
    eye.y = muzzle.y;
    eye.z = muzzle.z;
    return false;
  }

  function writeAim(manual) {
    const a = game.aim;
    if (!a) return;
    if (!(Number.isFinite(dir.x) && Number.isFinite(dir.y) && Number.isFinite(dir.z))) {
      dir.x = fwd.x; dir.y = fwd.y; dir.z = fwd.z;
    }
    a.dx = dir.x;
    a.dy = dir.y;
    a.dz = dir.z;
    a.manual = manual;
    a.target = st.target;
    a.locked = !!st.lock;
  }

  // What the crosshair ray reaches first (distance), and the actor or
  // craft under it, if any.
  function underCrosshair(w, range) {
    const cb = game.combat;
    st.conv = range;
    if (!cb || !cb.trace) return null;
    cb.trace(eye.x, eye.y, eye.z, fwd.x, fwd.y, fwd.z, range + AIM.dist, w, game.player.vehicle, tr);
    st.conv = Math.max(1, tr.t);
    const hit = tr.kind === 'actor' ? tr.actor : tr.kind === 'craft' ? tr.craft : null;
    if (!hit || !alive(hit)) return null;
    if (!isActor(hit) && !(hit.driver && hit.driver !== 'player')) return null;
    return hit;
  }

  function footAim(w, input, dt) {
    const arms = w.arms;
    const wpn = WEAPONS[arms.weapon] || WEAPONS.pistol;
    const melee = wpn.type === 'melee';
    st.melee = melee;
    const firing = input.held('fire');
    if (firing) {
      st.hold = AIM_HOLD;
      st.fightT = FIGHT_T;
    } else st.hold = Math.max(0, st.hold - dt);
    const lockRange = Math.max(wpn.range, LOCK_RANGE_MIN);
    const c = chase();

    if (input.consume('lock')) {
      if (st.lock) st.lock = null;
      else {
        footRay(w);
        const t = pickLock(ctx, eye, fwd, muzzle, lockRange);
        if (t) {
          st.lock = t;
          st.lostT = 0;
          st.fightT = FIGHT_T;
        } else st.noTargetT = NO_TARGET_T;
      }
    }
    if (st.lock) {
      muzzle.x = w.x; muzzle.y = (w.y || 0) + MUZZLE_Y; muzzle.z = w.z;
      keepLock(st, ctx, muzzle, lockRange, dt);
    }
    st.aiming = !melee && (firing || !!st.lock || st.hold > 0);
    setAimView(st.aiming);
    const view = footRay(w);

    if (melee) {
      // No aim needed: the nearest person in reach in front, else ahead.
      fwd.x = Math.cos(w.heading); fwd.y = 0; fwd.z = Math.sin(w.heading);
      const t = st.lock || pickAssist(ctx, muzzle, fwd, muzzle, { range: MELEE_REACH, cone: MELEE_CONE, craft: false });
      st.target = t;
      if (t) {
        targetPoint(t, ctx.seaY, tp);
        dirTo(muzzle, tp.x, tp.y, tp.z, fwd, dir);
        if (firing) w.heading = Math.atan2(dir.z, dir.x);
      } else {
        dir.x = fwd.x; dir.y = 0; dir.z = fwd.z;
      }
      st.conv = 3;
      writeAim(true);
      return;
    }

    if (st.lock && c && c.aim) {
      // Soft follow keeps the target near the center.
      targetPoint(st.lock, ctx.seaY, tp);
      yawPitchTo(view ? eye : muzzle, tp.x, tp.y, tp.z, yp);
      if (c.aim.on) {
        c.aim.yaw = followAngle(c.aim.yaw, yp.yaw, dt);
        const pt = followAngle(c.aim.pitch, yp.pitch, dt);
        c.aim.pitch = pt < PITCH_MIN ? PITCH_MIN : pt > PITCH_MAX ? PITCH_MAX : pt;
      }
      c.aim.holdDrag = true;
      // A swipe flicks the lock to the next target that way.
      st.flickT += dt;
      if (st.flickT > FLICK_WINDOW) {
        st.flickT = 0;
        st.flickAcc = 0;
      }
      st.flickAcc += input.lookX || 0;
      input.lookX = 0;
      input.lookY = 0;
      if (Math.abs(st.flickAcc) > FLICK_PX) {
        const next = pickFlick(ctx, eye, muzzle, st.lock, Math.sign(st.flickAcc), lockRange);
        if (next) {
          st.lock = next;
          st.lostT = 0;
        }
        st.flickAcc = 0;
        st.flickT = 0;
      }
      footRay(w);
    } else if (c && c.aim) {
      c.aim.holdDrag = false;
      st.flickAcc = 0;
    }

    const under = underCrosshair(w, wpn.range);
    const t = st.lock || under || pickAssist(ctx, eye, fwd, muzzle, { range: wpn.range });
    st.target = t;
    if (t) {
      targetPoint(t, ctx.seaY, tp);
      dirTo(muzzle, tp.x, tp.y, tp.z, fwd, dir);
    } else convergeDir(eye, fwd, muzzle, st.conv, dir);
    if (c && c.aim) c.aim.dragScale = t && !st.lock ? DRAG_SLOW : 1;
    if (st.aiming && c && c.aim && c.aim.on) w.heading = c.aim.yaw;
    else if (st.aiming) w.heading = Math.atan2(dir.z, dir.x);
    writeAim(true);
  }

  function driveAim(w, v, input, dt) {
    const arms = w.arms;
    const wpn = WEAPONS[arms.lastGun] || WEAPONS.pistol;
    input.consume('lock');
    st.lock = null;
    st.aiming = false;
    st.melee = false;
    const firing = input.held('fire');
    if (firing) {
      st.driveT = AIM_HOLD;
      st.fightT = FIGHT_T;
    } else st.driveT = Math.max(0, st.driveT - dt);
    const c = chase();
    if (c && c.aim) c.aim.holdOrbit = firing;
    const base = (v.y || 0) + (v.kind === 'boat' ? ctx.seaY : 0);
    muzzle.x = v.x;
    muzzle.y = base + Math.min(1.3, ((v.spec && v.spec.height) || 1.4) * 0.85);
    muzzle.z = v.z;
    const yaw = c && c.viewYaw ? c.viewYaw() : (game.camHeading ?? v.heading);
    fwd.x = Math.cos(yaw);
    fwd.y = 0;
    fwd.z = Math.sin(yaw);
    const range = Math.min(wpn.range, DRIVE_RANGE);
    const t = pickAssist(ctx, muzzle, fwd, muzzle, { range, cone: DRIVE_CONE });
    st.target = t;
    if (t) {
      targetPoint(t, ctx.seaY, tp);
      dirTo(muzzle, tp.x, tp.y, tp.z, fwd, dir);
    } else {
      dir.x = fwd.x; dir.y = 0; dir.z = fwd.z;
    }
    st.conv = range * 0.6;
    eye.x = muzzle.x; eye.y = muzzle.y; eye.z = muzzle.z;
    writeAim(true);
  }

  function clearAim() {
    st.lock = null;
    st.target = null;
    st.aiming = false;
    st.hold = 0;
    setAimView(false);
    const c = chase();
    if (c && c.aim) {
      c.aim.holdDrag = false;
      c.aim.holdOrbit = false;
      c.aim.dragScale = 1;
    }
    if (game.aim) {
      game.aim.manual = false;
      game.aim.target = null;
      game.aim.locked = false;
    }
  }

  function step(dt) {
    const p = game.player, input = game.input;
    const w = p && p.walker;
    if (!w || !input) return;
    ctx.actors = game.actors;
    ctx.vehicles = game.vehicles;
    ctx.collision = game.collision;
    ctx.self = w;
    ctx.selfCraft = p.vehicle || null;
    ctx.seaY = game.seaY || 0;
    const v = p.vehicle;
    const mode = v ? v.kind : 'foot';
    if (mode !== st.mode) {
      st.mode = mode;
      clearAim();
      st.driveT = 0;
    }
    st.fightT = Math.max(0, st.fightT - dt);
    st.noTargetT = Math.max(0, st.noTargetT - dt);
    const up = !w.life || w.life === 'ok' || w.life === 'getup';
    if (!w.arms || !up || !input.held) {
      if (input.consume) input.consume('lock');
      clearAim();
      return;
    }
    if (mode === 'foot') footAim(w, input, dt);
    else if (mode === 'car' || mode === 'boat') driveAim(w, v, input, dt);
    else {
      input.consume('lock');
      clearAim();
    }
  }

  // ---------------- events ----------------
  const offs = [];
  const ev = game.events;
  const isMine = (s) => {
    const p = game.player;
    return !!s && !!p && (s === p.walker || (p.vehicle && s === p.vehicle));
  };
  if (ev && ev.on) {
    offs.push(ev.on('hit', (h) => {
      if (!h) return;
      const p = game.player;
      if (isMine(h.source)) {
        st.hitMarkT = HIT_MARK_T;
        st.fightT = FIGHT_T;
      }
      if (p && (h.target === p.walker || (p.vehicle && h.target === p.vehicle))) {
        st.fightT = FIGHT_T;
        const s = h.source;
        const sx = s && Number.isFinite(s.x) ? s.x : h.x, sz = s && Number.isFinite(s.z) ? s.z : h.z;
        const d = dmg[dmgNext];
        dmgNext = (dmgNext + 1) % dmg.length;
        d.t = DMG_T;
        d.a = Math.atan2(sz - p.z, sx - p.x); // world yaw of the source
      }
    }));
    offs.push(ev.on('playerDown', () => {
      st.downT = 0;
      st.upT = -1;
      clearAim();
    }));
    offs.push(ev.on('respawn', () => {
      st.downT = -1;
      st.upT = 0;
      clearAim();
    }));
    offs.push(ev.on('weaponSwitch', (e) => {
      const p = game.player;
      if (!e || !p || e.actor !== p.walker) return;
      const wpn = WEAPONS[e.weapon];
      if (wpn && game.hud && game.hud.toast) game.hud.toast(wpn.name, 1);
      st.lock = st.lock && wpn && wpn.type !== 'melee' ? st.lock : null;
    }));
  }

  // ---------------- DOM ----------------
  const hasDom = typeof document !== 'undefined' && !!uiRoot && typeof uiRoot.appendChild === 'function';
  let ui = null;
  if (hasDom) ui = buildDom(uiRoot);

  // World point to screen pixels using the camera of the last frame.
  const scr = { x: 0, y: 0, depth: 0, ok: false };
  function project(cam, x, y, z, W, H) {
    const m = cam.matrixWorldInverse.elements, pm = cam.projectionMatrix.elements;
    const vx = m[0] * x + m[4] * y + m[8] * z + m[12];
    const vy = m[1] * x + m[5] * y + m[9] * z + m[13];
    const vz = m[2] * x + m[6] * y + m[10] * z + m[14];
    scr.depth = -vz;
    scr.ok = scr.depth > 0.2;
    if (!scr.ok) return scr;
    const cx = pm[0] * vx + pm[4] * vy + pm[8] * vz + pm[12];
    const cy = pm[1] * vx + pm[5] * vy + pm[9] * vz + pm[13];
    const cw = pm[3] * vx + pm[7] * vy + pm[11] * vz + pm[15];
    scr.x = (cx / cw * 0.5 + 0.5) * W;
    scr.y = (0.5 - cy / cw * 0.5) * H;
    return scr;
  }

  // HUD mode: 'minimal' shows the health bar only when hurt or fighting,
  // 'full' keeps it up. Follows settings.hud (also set by setHudMode).
  let fullHud = false;
  const setHudMode = (m) => { fullHud = m === 'full'; };

  const view = {
    xhair: false, xx: -1, xy: -1, hot: null, lock: null, tgt: false, tx: -1, ty: -1, ts: -1,
    hp: null, hpw: -1, mark: -1, ring: -1, down: -1, downText: null, noT: null,
    dmg: [-1, -1, -1], dmgA: [0, 0, 0],
  };
  const combatState = { show: false, weapon: '', name: '', mag: 0, max: 0, reload: 0, locked: false, drive: false };
  const armsCtl = game.touch ? registerArmsControls(game, game.touch) : null;
  // Hold SWAP for the weapon wheel: the touch layer hands back a weapon id.
  if (game.touch && game.touch.setWeaponPicker) {
    game.touch.setWeaponPicker((id) => pickWeapon(game, id));
  }
  const cview = { pip: false, px: -1, py: -1, box: false, bx: -1, by: -1, bs: -1, locked: null, arrow: false, aa: 99 };
  const ray = { x: 0, y: 0, z: 0, fx: 1, fy: 0, fz: 0 };

  // Pipper, seeker box and arrow while aboard an armed craft.
  function renderCraft(v, cam, W, H) {
    const cb = game.combat;
    const arms = cb && cb.armsOf ? cb.armsOf(v) : v.arms;
    const armed = !!arms && !!cam && !!cam.matrixWorldInverse && (v.kind === 'plane' || v.kind === 'heli');
    let pip = false, px = -1, py = -1;
    if (armed && mountFor(arms, 0)) {
      noseRay(v, ctx.seaY, ray);
      const d = 120;
      project(cam, ray.x + ray.fx * d, ray.y + ray.fy * d, ray.z + ray.fz * d, W, H);
      if (scr.ok && scr.x >= 0 && scr.x <= W && scr.y >= 0 && scr.y <= H) {
        pip = true;
        px = Math.round(scr.x);
        py = Math.round(scr.y);
      }
    }
    if (pip !== cview.pip) {
      cview.pip = pip;
      ui.pipper.classList.toggle('rw-on', pip);
    }
    if (pip && (px !== cview.px || py !== cview.py)) {
      cview.px = px;
      cview.py = py;
      ui.pipper.style.transform = `translate(${px}px, ${py}px)`;
    }
    const sk = cb && cb.seeker;
    const t = armed && sk ? sk.target : null;
    let box = false, arrow = false, bx = -1, by = -1, bs = -1, aa = cview.aa;
    if (t) {
      targetPoint(t, ctx.seaY, tp);
      project(cam, tp.x, tp.y, tp.z, W, H);
      if (scr.ok && scr.x > 0 && scr.x < W && scr.y > 0 && scr.y < H) {
        box = true;
        bx = Math.round(scr.x);
        by = Math.round(scr.y);
        bs = Math.round(34 + (1 - sk.progress) * 50);
      } else {
        // Off screen (or behind): an arrow at the edge toward it.
        arrow = true;
        const sx = scr.ok ? scr.x - W / 2 : -(scr.x - W / 2), sy = scr.ok ? scr.y - H / 2 : -(scr.y - H / 2);
        aa = Math.round(Math.atan2(sy, sx) * 30) / 30;
      }
    }
    if (box !== cview.box) {
      cview.box = box;
      ui.seek.classList.toggle('rw-on', box);
    }
    if (box && (bx !== cview.bx || by !== cview.by || bs !== cview.bs)) {
      cview.bx = bx;
      cview.by = by;
      cview.bs = bs;
      ui.seek.style.transform = `translate(${bx}px, ${by}px)`;
      ui.seek.style.width = ui.seek.style.height = bs + 'px';
      ui.seek.style.margin = `${-bs / 2}px 0 0 ${-bs / 2}px`;
    }
    const locked = !!t && sk.state === 'locked';
    if (locked !== cview.locked) {
      cview.locked = locked;
      ui.seek.classList.toggle('rw-locked', locked);
    }
    if (arrow !== cview.arrow) {
      cview.arrow = arrow;
      ui.sarrow.classList.toggle('rw-on', arrow);
    }
    if (arrow && aa !== cview.aa) {
      cview.aa = aa;
      ui.sarrow.style.transform = `rotate(${aa.toFixed(3)}rad)`;
    }
  }

  function render(alpha, dt) {
    const p = game.player;
    const w = p && p.walker;
    const d = dt > 0 ? dt : 0;
    const cfg = game.progress && game.progress.settings;
    if (cfg && (cfg.hud === 'full') !== fullHud) fullHud = cfg.hud === 'full';
    st.hitMarkT = Math.max(0, st.hitMarkT - d);
    if (st.downT >= 0) st.downT += d;
    if (st.upT >= 0) {
      st.upT += d;
      if (st.upT > 1) st.upT = -1;
    }
    for (let i = 0; i < dmg.length; i++) dmg[i].t = Math.max(0, dmg[i].t - d);
    // Touch panel: weapon, ammo, reload, lock state.
    const touch = game.touch;
    if (touch && touch.setCombat && w) {
      const arms = w.arms;
      const v = p.vehicle;
      const id = arms ? (v ? arms.lastGun : arms.weapon) : '';
      const wpn = WEAPONS[id];
      combatState.show = !!arms && !!wpn;
      combatState.drive = !!v && (v.kind === 'car' || v.kind === 'boat');
      combatState.weapon = id;
      combatState.name = wpn ? wpn.name : '';
      combatState.max = wpn ? wpn.mag : 0;
      combatState.mag = arms && wpn ? arms.mag[id] : 0;
      combatState.reload = arms && arms.reloading === id && wpn && wpn.reload > 0 ? 1 - arms.reloadT / wpn.reload : 0;
      combatState.locked = !!st.lock;
      touch.setCombat(combatState);
    }
    if (armsCtl) armsCtl.update();
    if (!ui || !w) return;
    const cam = game.camera;
    const W = window.innerWidth || 1, H = window.innerHeight || 1;
    if (cam && cam.updateMatrixWorld) cam.updateMatrixWorld();
    if (p.vehicle && p.vehicle.spec) renderCraft(p.vehicle, cam, W, H);
    else if (cview.pip || cview.box || cview.arrow) renderCraft(p.vehicle || w, null, W, H);
    const c = chase();
    const k = c && c.aim ? c.aim.k : 0;
    const v = p.vehicle;
    const drive = !!v && (v.kind === 'car' || v.kind === 'boat');
    const showX = !!cam && cam.matrixWorldInverse && w.arms && (
      (!v && !st.melee && (k > 0 || !!st.lock)) || (drive && (st.driveT > 0 || st.fightT > 0)));

    // Crosshair at the point the next shot goes for.
    let xx = -1, xy = -1;
    if (showX) {
      aimPt.x = eye.x + fwd.x * st.conv;
      aimPt.y = eye.y + fwd.y * st.conv;
      aimPt.z = eye.z + fwd.z * st.conv;
      if (drive && st.target) targetPoint(st.target, ctx.seaY, aimPt);
      project(cam, aimPt.x, aimPt.y, aimPt.z, W, H);
      if (scr.ok) {
        xx = Math.round(scr.x);
        xy = Math.round(scr.y);
      }
    }
    const xOn = xx >= 0 && xx <= W && xy >= 0 && xy <= H;
    if (xOn !== view.xhair) {
      view.xhair = xOn;
      ui.xhair.classList.toggle('rw-on', xOn);
    }
    if (xOn && (xx !== view.xx || xy !== view.xy)) {
      view.xx = xx;
      view.xy = xy;
      ui.xhair.style.transform = `translate(${xx}px, ${xy}px)`;
    }
    const hot = !!st.target && showX;
    if (hot !== view.hot) {
      view.hot = hot;
      ui.xhair.classList.toggle('rw-hot', hot);
    }
    // Reload ring around the crosshair.
    let ring = 0;
    const arms = w.arms;
    if (arms && showX) {
      const id = v ? arms.lastGun : arms.weapon;
      const wpn = WEAPONS[id];
      if (arms.reloading === id && wpn && wpn.reload > 0) ring = Math.max(0.01, 1 - arms.reloadT / wpn.reload);
    }
    ring = Math.round(ring * 50) / 50;
    if (ring !== view.ring) {
      view.ring = ring;
      ui.ring.classList.toggle('rw-on', ring > 0);
      ui.ringArc.style.strokeDashoffset = (100 - ring * 100).toFixed(1);
    }
    // Hit marker.
    const mark = st.hitMarkT > 0 && xOn ? 1 : 0;
    if (mark !== view.mark) {
      view.mark = mark;
      ui.xhair.classList.toggle('rw-hit', !!mark);
    }
    // Target brackets (and the lock ring).
    let tOn = false;
    const tgt = st.target;
    if (tgt && showX) {
      targetPoint(tgt, ctx.seaY, tp);
      project(cam, tp.x, tp.y, tp.z, W, H);
      if (scr.ok && scr.x > -40 && scr.x < W + 40 && scr.y > -40 && scr.y < H + 40) {
        tOn = true;
        const f = H / 2 / Math.tan((cam.fov || 60) * Math.PI / 360);
        const size = Math.round(Math.max(26, Math.min(140, (isActor(tgt) ? 1.9 : 3.2) * f / scr.depth)));
        const tx = Math.round(scr.x), ty = Math.round(scr.y);
        if (tx !== view.tx || ty !== view.ty || size !== view.ts) {
          view.tx = tx;
          view.ty = ty;
          view.ts = size;
          ui.tgt.style.transform = `translate(${tx}px, ${ty}px)`;
          ui.tgt.style.width = ui.tgt.style.height = size + 'px';
          ui.tgt.style.margin = `${-size / 2}px 0 0 ${-size / 2}px`;
        }
      }
    }
    if (tOn !== view.tgt) {
      view.tgt = tOn;
      ui.tgt.classList.toggle('rw-on', tOn);
    }
    const lock = !!st.lock && tOn;
    if (lock !== view.lock) {
      view.lock = lock;
      ui.tgt.classList.toggle('rw-locked', lock);
      ui.xhair.classList.toggle('rw-locked', lock);
    }
    const noT = st.noTargetT > 0;
    if (noT !== view.noT) {
      view.noT = noT;
      ui.noTarget.classList.toggle('rw-on', noT);
    }
    // Health bar: only while hurt or in a fight.
    const maxHp = w.maxHp || 100;
    const hp = Math.max(0, Number.isFinite(w.hp) ? w.hp : (p.health ?? maxHp));
    const hpOn = (fullHud || hp < maxHp - 0.5 || st.fightT > 0 || !!st.lock) && !(v && !drive);
    if (hpOn !== view.hp) {
      view.hp = hpOn;
      ui.hp.classList.toggle('rw-on', hpOn);
    }
    const frac = Math.round(Math.max(0, Math.min(1, hp / maxHp)) * 100);
    if (frac !== view.hpw) {
      view.hpw = frac;
      ui.hpFill.style.transform = `scaleX(${(frac / 100).toFixed(2)})`;
      ui.hp.classList.toggle('rw-low', frac < 30);
    }
    // Damage direction hints: the edge of the screen toward the source.
    const camYaw = c && c.viewYaw ? c.viewYaw() : (game.camHeading || 0);
    for (let i = 0; i < dmg.length; i++) {
      const dd = dmg[i];
      const o = dd.t > 0 ? Math.round(Math.min(1, dd.t / 0.4) * 20) / 20 : 0;
      const a = dd.t > 0 ? Math.round(angleDiff(dd.a, camYaw) * 30) / 30 : view.dmgA[i];
      if (o !== view.dmg[i] || a !== view.dmgA[i]) {
        view.dmg[i] = o;
        view.dmgA[i] = a;
        const el = ui.dmg[i];
        el.style.opacity = String(o);
        el.style.transform = `rotate(${a.toFixed(3)}rad)`;
      }
    }
    // Downed: a short beat, then fade out; fade back in on respawn.
    let fade = 0;
    if (st.downT >= 0) fade = Math.max(0, Math.min(1, (st.downT - 1.8) / 1.0));
    else if (st.upT >= 0) fade = Math.max(0, 1 - st.upT / 0.8);
    fade = Math.round(fade * 40) / 40;
    const downText = st.downT >= 0.3;
    if (fade !== view.down || downText !== view.downText) {
      view.down = fade;
      view.downText = downText;
      ui.fade.style.opacity = String(fade);
      ui.fade.classList.toggle('rw-on', fade > 0);
      ui.fadeText.classList.toggle('rw-on', downText);
      setShown(ui.fadeText, downText);
    }
  }

  function buildDom(root) {
    const mk = (cls, parent, html) => {
      const e = document.createElement('div');
      e.className = cls;
      if (html) e.innerHTML = html;
      parent.appendChild(e);
      return e;
    };
    const layer = mk('rw-chud', root);
    const fade = mk('rw-cfade', layer);
    const fadeText = mk('rw-cfade-text', layer);
    fadeText.textContent = 'Knocked out';
    setShown(fadeText, false);
    const dmgEls = [];
    for (let i = 0; i < 3; i++) dmgEls.push(mk('rw-dmg', layer, '<i></i>'));
    const tgt = mk('rw-tgt', layer, '<i></i><i></i><i></i><i></i>');
    const xhair = mk('rw-xhair', layer,
      '<svg viewBox="-30 -30 60 60" aria-hidden="true">'
      + '<path class="rw-x-ticks" d="M0 -14v7M0 14v-7M-14 0h7M14 0h-7"/>'
      + '<circle class="rw-x-dot" r="1.6"/>'
      + '<path class="rw-x-hit" d="M-11 -11l5 5M11 -11l-5 5M-11 11l5 -5M11 11l-5 -5"/>'
      + '<circle class="rw-x-lock" r="19"/>'
      + '</svg>');
    const ring = mk('rw-xring', xhair,
      '<svg viewBox="-30 -30 60 60" aria-hidden="true"><circle class="rw-x-ringbg" r="23"/>'
      + '<circle class="rw-x-ringarc" r="23" pathLength="100"/></svg>');
    const noTarget = mk('rw-notarget', layer);
    noTarget.textContent = 'No target';
    const hp = mk('rw-chp', layer, '<i></i>');
    const pipper = mk('rw-pipper', layer, '<svg viewBox="-20 -20 40 40" aria-hidden="true"><circle r="9"/><path d="M-16 0h5M11 0h5M0 -16v5"/><circle r="1.5" class="rw-pdot"/></svg>');
    const seek = mk('rw-seek', layer, '<i></i><i></i><i></i><i></i><b>LOCK</b>');
    const sarrow = mk('rw-sarrow', layer, '<i></i>');
    return {
      layer, xhair, ring, ringArc: ring.querySelector('.rw-x-ringarc'), tgt, hp, hpFill: hp.firstChild,
      dmg: dmgEls, fade, fadeText, noTarget, pipper, seek, sarrow,
    };
  }

  return {
    name: 'combathud',
    game,
    root: uiRoot || null,
    state: st,
    // Before the walker moves: aiming walks (no sprint) relative to the aim.
    always() {
      if (game.paused || !st.aiming) return;
      const input = game.input, c = chase();
      if (input) input.sprint = false;
      if (c && c.aim && c.aim.on) game.camHeading = c.aim.yaw;
    },
    fixedUpdate: step,
    render,
    setHudMode,
    // For tests: what the controller decided last step.
    get target() { return st.target; },
    get lock() { return st.lock; },
    get aiming() { return st.aiming; },
    armsCtl,
    dispose() {
      for (const f of offs) f();
      offs.length = 0;
      if (armsCtl) armsCtl.remove();
      if (ui) ui.layer.remove();
    },
  };
}
