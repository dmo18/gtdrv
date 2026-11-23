// Third-person chase camera. Follows the target's heading with a spring,
// orbits on drag, eases back behind after a pause and pulls in when a
// building would block the view. The target may carry `y` (height above
// ground/sea), `pitch` and `roll` (aircraft). No allocations per frame.
// Feel: a short shake on impacts (`kick(strength)`), a faint buzz at very
// high speed, a little look into turns and a small FOV kick under hard
// acceleration. All capped; `setShake(0)` turns the shakes off. Cars
// also lean and lag to show weight (LEAN).
// Cars also have two first-person views (docs/PLAN_V3.md 2.8): Hood and
// Cockpit, rigid on the car (no lag, no sideways turn look, level
// horizon), with a drag look that springs back (LOOK) and a 3 cm head
// lean into braking and bumps. The cockpit puts the interior kit of
// carinterior.js into the car and hides the exterior.
import { angleDiff, clamp } from '../core/rng.js';
import { attachInterior, carGeometry, measureCabin, eyePoint, hoodPoint, frontShell } from './carinterior.js';

// follow: position spring rate. turn: heading spring factor.
// pitchShare / rollShare: how much of the craft's climb angle and bank the
// camera copies (planes, so the horizon moves).
const MODES = {
  car: { dist: 7.5, height: 2.6, lookHeight: 1.2, lookAhead: 4, baseFov: 62, follow: 12, turn: 1, pitchShare: 0, rollShare: 0 },
  foot: { dist: 5.6, height: 2.5, lookHeight: 1.15, lookAhead: 0.4, baseFov: 60, follow: 12, turn: 1, pitchShare: 0, rollShare: 0 },
  boat: { dist: 10.5, height: 3.6, lookHeight: 1.4, lookAhead: 5, baseFov: 62, follow: 10, turn: 0.8, pitchShare: 0, rollShare: 0 },
  plane: { dist: 16, height: 3.8, lookHeight: 1.8, lookAhead: 12, baseFov: 64, follow: 18, turn: 1, pitchShare: 0.55, rollShare: 0.22 },
  heli: { dist: 15, height: 6.5, lookHeight: 1.8, lookAhead: 3, baseFov: 62, follow: 6, turn: 0.55, pitchShare: 0, rollShare: 0.1 },
  // Tank: behind the turret's aim (game.js passes tankAim as the target
  // heading and pitch); the drag turns the aim, not an orbit.
  tank: { dist: 11, height: 4.5, lookHeight: 2, lookAhead: 14, baseFov: 62, follow: 14, turn: 8, pitchShare: 1, rollShare: 0 },
};

// Selectable views for the VIEW button. Each view overrides parts of the
// mode above. A negative `dist` puts the camera AHEAD of the target
// (bow or cockpit view); those views skip the building pull-in.
// `fp` marks the car's first-person views: the camera sits at a point of
// the car (FIRST), `near` is the near plane. Hood's FOV 80 is horizontal
// (`fovH`, the vertical one follows the screen: 41 degrees at 915x412),
// the only reading under which the hood fills 10 to 20 percent of the
// frame from the driver's eye height; the cockpit's 78 is the camera's
// own vertical FOV like every other view (122 horizontal at 915x412).
const VIEWS = {
  car: [
    { name: 'Chase' },
    { name: 'Far chase', dist: 12.5, height: 4.8, lookHeight: 1.0, lookAhead: 7, baseFov: 66 },
    { name: 'Hood', fp: 'hood', dist: -1, fovH: 80, near: 0.12 },
    { name: 'Cockpit', fp: 'cockpit', dist: -1, baseFov: 78, near: 0.12 },
  ],
  foot: [
    { name: 'Chase' },
    { name: 'Close', dist: 2.8, height: 1.7, lookHeight: 1.4, lookAhead: 0.4 },
  ],
  boat: [
    { name: 'Chase' },
    { name: 'Far chase', dist: 18, height: 6.5, lookHeight: 1.2, lookAhead: 8, baseFov: 66 },
    { name: 'Bow', dist: -2.4, height: -0.1, lookHeight: -0.2, lookAhead: 40, baseFov: 74, follow: 30, turn: 1.6 },
  ],
  plane: [
    { name: 'Chase' },
    { name: 'Far chase', dist: 28, height: 7, lookHeight: 1.8, lookAhead: 20, baseFov: 66 },
    { name: 'Cockpit', dist: -1.4, height: 0.5, lookHeight: 0.4, lookAhead: 60, baseFov: 78, follow: 40, turn: 1.2, pitchShare: 0.9, rollShare: 0.8 },
  ],
  heli: [
    { name: 'Chase' },
    { name: 'Far chase', dist: 26, height: 10, lookHeight: 2, lookAhead: 6, baseFov: 66 },
    { name: 'Cockpit', dist: -1.8, height: 0.7, lookHeight: 0.3, lookAhead: 50, baseFov: 80, follow: 30, turn: 0.9, rollShare: 0.5 },
  ],
  tank: [
    { name: 'Chase' },
    { name: 'Far chase', dist: 16, height: 6.2, lookHeight: 2, lookAhead: 18, baseFov: 64 },
    { name: 'Gunner', dist: 0.6, height: 3.4, lookHeight: 3.2, lookAhead: 60, baseFov: 50, follow: 40, turn: 30 },
  ],
};

const MIN_CLEAR = 0.6; // camera never gets closer than this to ground/sea
const SAMPLES = 10;
// Feel tuning per mode: turn look (meters of look shift per rad/s at
// speed), accel FOV kick (degrees per m/s^2), speed buzz on or off.
const FEEL = {
  car: { turnLook: 0.9, fovKick: 0.32, buzz: 1 },
  foot: { turnLook: 0, fovKick: 0, buzz: 0 },
  boat: { turnLook: 0.6, fovKick: 0.2, buzz: 0.6 },
  plane: { turnLook: 0.4, fovKick: 0.12, buzz: 0.4 },
  heli: { turnLook: 0.3, fovKick: 0.1, buzz: 0.2 },
  tank: { turnLook: 0, fovKick: 0, buzz: 0 },
};
const MAX_SHAKE_ROT = 0.022; // radians at full trauma
const MAX_SHAKE_POS = 0.06; // meters at full trauma
const MAX_BUZZ = 0.0035; // radians at very high speed
// Aim view (on foot, FIRE held or locked): over the right shoulder.
// The view turns only with the drag (or a lock), never by itself.
export const AIM = {
  dist: 3.2, side: 0.6, pivot: 1.55, fov: 55, ease: 0.2,
  drag: 0.0042, // radians per pixel of drag
  pitchMin: -0.6, pitchMax: 0.7,
};
// Tank aim: drag turns it (radians per pixel as AIM.drag), pitch limits.
export const TANK_AIM = { pitchMin: -0.3, pitchMax: 0.42 };
const smooth01 = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));
// Car weight (docs/REVAMP.md 6.3), the same in both handling modes: the
// chase views lag the car's heading by a 0.12 s time constant (task DRIVE:
// was 0.18; the view shows where the car is going, with no lag that makes
// the player over-correct), roll up to 2 degrees into a turn and pitch
// down up to 1.5 degrees under braking. They look up to `lookDeg` degrees
// into the turn by the steering (smoothed over `lookEase` s), in place of
// the slow sideways look shift from the yaw rate the other kinds use (it
// swayed the view after every correction). These limits are what the
// settings show the player; `setLean(false)` and prefers-reduced-motion
// turn the roll and pitch off.
export const LEAN = {
  yawLag: 0.12, // s
  lookDeg: 4, lookEase: 0.1, // degrees at full steering, s
  rollMaxDeg: 2, rollPerG: 2.2, // degrees of roll per g of cornering, capped
  pitchMaxDeg: 1.5, pitchPerG: 1.6, // degrees of pitch per g of braking, capped
  ease: 0.15, // s, smoothing of the roll and pitch themselves
};
// First-person look (docs/PLAN_V3.md 2.8 item 2): the drag turns the head
// up to yawMax each way and pitchMax up or down; released, it springs
// back with time constant `ret` (s) after `hold` s without drag when the
// input has no `lookHeld` flag (keyboard, tests). Radians per pixel.
export const LOOK = { drag: 0.006, yawMax: (110 * Math.PI) / 180, pitchMax: (25 * Math.PI) / 180, ret: 0.06, hold: 0.08 };
// First-person framing: the hood's front edge sits at `hoodShare` of the
// frame height from the bottom (the plan's 10 to 20 percent) by a small
// camera pitch within `hoodPitch` (degrees); the cockpit looks level.
// The head leans up to `lean` m.
export const FIRST = { hoodShare: 0.15, hoodPitch: [-12, 8], lean: 0.03 };
const BOOST_FOV = 9; // degrees of extra field of view at full boost
const RAD = Math.PI / 180;
function prefersReducedMotion() {
  try {
    return typeof globalThis.matchMedia === 'function' && !!globalThis.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

export function createChaseCamera(camera) {
  let mode = MODES.car;
  let modeKey = 'car';
  const viewIdx = { car: 0, foot: 0, boat: 0, plane: 0, heli: 0, tank: 0 }; // remembered per kind
  let viewName = 'Chase';
  // Build the active mode from the base mode plus the chosen view.
  function applyMode() {
    const base = MODES[modeKey] || MODES.car;
    const list = VIEWS[modeKey] || VIEWS.car;
    const view = list[viewIdx[modeKey] % list.length] || list[0];
    mode = Object.assign({}, base, view);
    if (!view.fp) mode.fp = null;
    viewName = view.name;
    feel = FEEL[modeKey] || FEEL.car;
    curDist = mode.dist;
    wantNear = view.near || baseNear;
    fp.yaw = 0;
    fp.pitch = 0;
    if (!(mode.fp === 'cockpit' && modeKey === 'car') && fp.att) {
      fp.att.detach();
      fp.att = null;
    }
  }
  const baseNear = camera.near || 0.5;
  let wantNear = baseNear;
  // First-person state: look yaw / pitch (rad), seconds since the last
  // drag, head lean (m, car frame), the car whose points are cached, the
  // attached interior.
  const fp = {
    yaw: 0, pitch: 0, since: 99, headX: 0, headY: 0, headVY: 0, lastY: null, lastVY: 0,
    veh: null, vmesh: null, cab: null, eye: null, hood: null, hoodDrop: 0.3, att: null, bias: 0,
  };
  let camHeading = 0; // smoothed follow heading
  let camPitch = 0; // smoothed share of the target's climb angle
  let camRoll = 0; // smoothed share of the target's bank
  let orbitYaw = 0; // drag offset around the target
  let orbitPitch = 0; // drag offset in height (meters)
  let sinceDrag = 99;
  let curDist = mode.dist;
  let curFov = camera.fov || mode.baseFov;
  let px = 0, py = 0, pz = 0; // smoothed camera position
  let feel = FEEL.car;
  let shakeScale = 1;
  let trauma = 0; // 0..1, from impacts
  let shakeT = 0;
  let lastHeading = null, lastSpeed = 0;
  let turnLook = 0; // smoothed sideways look shift (m)
  let steerLook = 0; // car chase views: smoothed look into the turn (rad)
  let accel = 0; // smoothed forward acceleration (m/s^2)
  let fovKick = 0;
  let yawRateEst = 0; // target heading rate (rad/s), last step
  let leanOn = !prefersReducedMotion();
  let leanRoll = 0, leanPitch = 0; // radians, into the turn / nose down
  // Aim view state: `aim.yaw/pitch` is where the crosshair points; the aim
  // controller (combathud.js) may steer it for a lock-on.
  // holdDrag: a lock is steering, the drag does not turn the aim.
  // holdOrbit: drive-by fire is held, the orbit does not ease back.
  const aim = { on: false, k: 0, yaw: 0, pitch: 0, dragScale: 1, holdDrag: false, holdOrbit: false };
  // The crosshair ray of the last placed frame (camera position and the
  // unit view direction before shake).
  const ray = { x: 0, y: 0, z: 0, dx: 1, dy: 0, dz: 0 };
  // Tank mode: world yaw / pitch the turret is asked to aim along. The
  // drag turns it; a lock (systems/armor.js) steers it with holdDrag.
  const tankAim = { yaw: 0, pitch: 0.1, holdDrag: false, dragScale: 1 };
  // Effects hook (systems/cinematic.js): extra yaw (rad), distance and
  // height (m) behind the target, and a FOV zoom fraction. `touched` is set
  // whenever the player drags the camera, so an effect can cancel itself.
  const fx = { yaw: 0, dist: 0, rise: 0, zoom: 0, touched: false };

  // Distance at which the view line from the target back to the camera
  // is first blocked, or `dist` if it is clear. Height-aware: roofs below
  // the view line do not count, so flying high is never pulled in.
  function clearDist(collision, x, y0, z, bx, bz, dist, y1) {
    if (typeof collision.heightAt === 'function') {
      for (let i = 1; i <= SAMPLES; i++) {
        const t = i / SAMPLES;
        const d = dist * t;
        const lineY = y0 + (y1 - y0) * t;
        if (collision.heightAt(x + bx * d, z + bz * d) > lineY - 0.3) {
          // Refine between the last clear sample and this one.
          let lo = d - dist / SAMPLES, hi = d;
          for (let k = 0; k < 4; k++) {
            const m = (lo + hi) / 2;
            if (collision.heightAt(x + bx * m, z + bz * m) > y0 + (y1 - y0) * (m / dist) - 0.3) hi = m;
            else lo = m;
          }
          return lo;
        }
      }
      return dist;
    }
    if (typeof collision.raycast === 'function' && y0 < 6) return collision.raycast(x, z, bx, bz, dist);
    return dist;
  }

  function place(target, dt, collision, snap) {
    const a = camHeading + orbitYaw + (mode.dist > 0.5 ? fx.yaw : 0);
    const cp = Math.cos(camPitch), sp = Math.sin(camPitch);
    const bx = -Math.cos(a) * cp, bz = -Math.sin(a) * cp;
    const baseY = (target.y || 0) + (target.height || 0);
    const fxOn = mode.dist > 0.5; // the effects hook skips bumper and cockpit views
    const rise = mode.height + orbitPitch + (fxOn ? fx.rise : 0);
    // Pull in when something solid is between the target and the camera.
    let want = mode.dist + (fxOn ? fx.dist : 0);
    if (collision && mode.dist > 0.5) {
      const reach = want + 0.5;
      const hit = clearDist(collision, target.x, baseY + mode.lookHeight, target.z, bx, bz, reach, baseY + rise - sp * reach);
      if (hit < reach) want = Math.max(1.2, hit - 0.6);
    }
    // Snap in quickly, ease back out slowly.
    if (snap || want < curDist) curDist = want;
    else curDist += (want - curDist) * Math.min(1, 2 * dt);

    const tx = target.x + bx * curDist;
    const tz = target.z + bz * curDist;
    const ty = baseY + rise - sp * curDist;
    if (snap) {
      px = tx; py = ty; pz = tz;
    } else {
      const k = Math.min(1, mode.follow * dt);
      px += (tx - px) * k;
      py += (ty - py) * k;
      pz += (tz - pz) * k;
    }
    // Stay above the ground or sea, and above a roof the target is over.
    let floor = MIN_CLEAR;
    if (collision && typeof collision.heightAt === 'function') {
      const gh = collision.heightAt(px, pz);
      if (gh > 0 && gh <= baseY + mode.lookHeight) floor = gh + MIN_CLEAR;
    }
    if (!(py >= floor)) py = floor;

    const spd = Math.abs(target.speed || 0);
    const ahead = modeKey === 'tank' ? mode.lookAhead : mode.lookAhead * Math.min(1, 0.3 + spd / 25);
    const ch = Math.cos(target.heading), sh = Math.sin(target.heading);
    // Car chase views: the look point moves sideways so the view turns
    // steerLook into the turn as seen from the camera.
    const side = carChase() ? Math.tan(steerLook) * (curDist + ahead) : turnLook;
    let lx = target.x + ch * ahead - sh * side;
    let ly = baseY + mode.lookHeight + sp * ahead;
    let lz = target.z + sh * ahead + ch * side;
    let cx = px, cy = py, cz = pz;
    const s = smooth01(aim.k);
    if (s > 0) {
      // Over the shoulder: pivot at the shoulder, back along the aim, out
      // to the right. Rigid (no lag) so the crosshair stays put.
      const cy0 = Math.cos(aim.yaw), sy0 = Math.sin(aim.yaw);
      const cpa = Math.cos(aim.pitch), spa = Math.sin(aim.pitch);
      const fx = cy0 * cpa, fy = spa, fz = sy0 * cpa;
      const pivY = (target.y || 0) + AIM.pivot;
      const sx = target.x - sy0 * AIM.side, sz = target.z + cy0 * AIM.side;
      let back = AIM.dist;
      if (collision) {
        const hit = clearDist(collision, sx, pivY, sz, -cy0, -sy0, AIM.dist * cpa + 0.4, pivY - spa * (AIM.dist + 0.4));
        if (hit < AIM.dist * cpa + 0.4) back = Math.max(0.5, (hit - 0.35) / Math.max(0.3, cpa));
      }
      let ax = sx - fx * back, ay = pivY - fy * back, az = sz - fz * back;
      if (!(ay >= MIN_CLEAR)) ay = MIN_CLEAR;
      cx += (ax - cx) * s;
      cy += (ay - cy) * s;
      cz += (az - cz) * s;
      ax += fx * 30;
      ay += fy * 30;
      az += fz * 30;
      lx += (ax - lx) * s;
      ly += (ay - ly) * s;
      lz += (az - lz) * s;
    }
    camera.position.set(cx, cy, cz);
    camera.lookAt(lx, ly, lz);
    const rdx = lx - cx, rdy = ly - cy, rdz = lz - cz;
    const rl = Math.sqrt(rdx * rdx + rdy * rdy + rdz * rdz) || 1;
    ray.x = cx; ray.y = cy; ray.z = cz;
    ray.dx = rdx / rl; ray.dy = rdy / rl; ray.dz = rdz / rl;
    // A little bank with the craft (right side down = clockwise from behind),
    // plus the car's lean into the turn and its pitch under braking.
    const rz = camRoll + leanRoll;
    if (rz > 1e-4 || rz < -1e-4) camera.rotateZ(-rz);
    if (leanPitch > 1e-5) camera.rotateX(-leanPitch);
    applyShake(spd);
  }

  // Smooth pseudo-noise from a few incommensurate sines (no allocation).
  function wobble(t, a, b, c) {
    return Math.sin(t * a) * 0.5 + Math.sin(t * b + 1.3) * 0.3 + Math.sin(t * c + 2.1) * 0.2;
  }
  function applyShake(spd) {
    if (!(shakeScale > 0)) return;
    const k = trauma * trauma * shakeScale;
    let rx = 0, ry = 0, rz = 0;
    if (k > 1e-4) {
      rx = wobble(shakeT, 31, 47, 71) * MAX_SHAKE_ROT * k;
      ry = wobble(shakeT, 27, 53, 67) * MAX_SHAKE_ROT * k;
      rz = wobble(shakeT, 23, 41, 61) * MAX_SHAKE_ROT * 0.6 * k;
      camera.position.x += wobble(shakeT, 37, 59, 83) * MAX_SHAKE_POS * k;
      camera.position.y += wobble(shakeT, 29, 43, 79) * MAX_SHAKE_POS * k;
    }
    // Faint buzz above ~35 m/s (126 km/h), full by ~65 m/s.
    const b = feel.buzz * shakeScale * Math.max(0, Math.min(1, (spd - 35) / 30));
    if (b > 0) {
      rx += wobble(shakeT, 61, 89, 113) * MAX_BUZZ * b;
      ry += wobble(shakeT, 57, 97, 127) * MAX_BUZZ * b * 0.6;
    }
    if (rx || ry || rz) {
      camera.rotateX(rx);
      camera.rotateY(ry);
      camera.rotateZ(rz);
    }
  }

  // Look-into-turn and acceleration estimates from the target's motion.
  function updateFeel(target, dt) {
    if (!(dt > 0)) return;
    shakeT += dt;
    if (shakeT > 1000) shakeT -= 1000;
    trauma = Math.max(0, trauma - dt * 1.7);
    const spd = target.speed || 0;
    if (lastHeading === null) {
      lastHeading = target.heading;
      lastSpeed = spd;
    }
    const yawRate = angleDiff(target.heading, lastHeading) / dt;
    lastHeading = target.heading;
    yawRateEst = yawRate;
    const fwd = Math.max(0, spd);
    if (carChase()) {
      // Look into the turn by the steering (rigid, quick, no sway).
      const v = target.vehicle;
      const st = v && Number.isFinite(v.steer) && fwd > 0.5 ? clamp(v.steer, -1, 1) : 0;
      steerLook += (st * LEAN.lookDeg * RAD - steerLook) * (1 - Math.exp(-dt / LEAN.lookEase));
      turnLook = 0;
    } else {
      steerLook = 0;
      const wantLook = clamp(yawRate * Math.min(fwd, 30) * 0.06 * feel.turnLook, -1.4, 1.4);
      turnLook += (wantLook - turnLook) * Math.min(1, 2.5 * dt);
    }
    const a = clamp((spd - lastSpeed) / dt, -30, 30);
    lastSpeed = spd;
    accel += (a - accel) * Math.min(1, 4 * dt);
    const wantKick = clamp(accel * feel.fovKick, 0, 4);
    fovKick += (wantKick - fovKick) * Math.min(1, (wantKick > fovKick ? 3 : 1.5) * dt);
    // Weight: roll into the turn from the cornering g, pitch from braking.
    let wantRoll = 0, wantPitch = 0;
    if (leanOn && modeKey === 'car' && mode.dist > 0.5 && aim.k <= 0) {
      const latG = (yawRate * fwd) / 9.81;
      wantRoll = clamp(latG * LEAN.rollPerG, -LEAN.rollMaxDeg, LEAN.rollMaxDeg) * RAD;
      wantPitch = clamp((-accel / 9.81) * LEAN.pitchPerG, 0, LEAN.pitchMaxDeg) * RAD;
    }
    const ke = 1 - Math.exp(-dt / LEAN.ease);
    leanRoll += (wantRoll - leanRoll) * ke;
    leanPitch += (wantPitch - leanPitch) * ke;
  }

  // BOOST widens the view by up to BOOST_FOV degrees (not with reduced motion).
  let boostFov = 0;
  function updateFov(spd, dt, snap, boost = 0) {
    const wantB = leanOn ? BOOST_FOV * clamp(boost, 0, 1) : 0;
    boostFov = snap ? wantB : boostFov + (wantB - boostFov) * Math.min(1, 4 * dt);
    const want = mode.baseFov + Math.min(spd, 50) * 0.22 + fovKick + boostFov;
    const next = snap ? want : curFov + (want - curFov) * Math.min(1, 3 * dt);
    curFov = next;
    // The aim view blends its own FOV in with the same 0.2 s ease.
    const s = smooth01(aim.k);
    let fov = s > 0 ? next + (AIM.fov - next) * s : next;
    if (fx.zoom > 0) fov *= 1 - fx.zoom;
    if (Math.abs(fov - camera.fov) > 0.01) {
      camera.fov = fov;
      camera.updateProjectionMatrix();
    }
  }

  function setAim(on, instant = false) {
    const next = !!on && modeKey === 'foot';
    if (next && !aim.on && aim.k <= 0) {
      aim.yaw = Math.atan2(ray.dz, ray.dx);
      aim.pitch = 0;
    }
    if (!next && aim.on) {
      camHeading = aim.yaw;
      orbitYaw = 0;
      orbitPitch = 0;
      sinceDrag = 99;
    }
    aim.on = next;
    if (instant) aim.k = next ? 1 : 0;
  }

  // ---- first person (cars) ----
  // Cache the car's camera points when the car (or its mesh) changes,
  // and attach the interior in the cockpit.
  function syncFirst(v) {
    const mesh = v && v.mesh && v.mesh.userData && v.mesh.userData.rig ? v.mesh : null;
    if (fp.veh !== v || fp.vmesh !== mesh || !fp.eye) {
      fp.veh = v;
      fp.vmesh = mesh;
      const spec = (v && v.spec) || { id: '?', length: 4.6, width: 1.85, height: 1.45 };
      if (mesh) {
        const geo = carGeometry(mesh);
        fp.cab = measureCabin(spec, geo.body, geo.glass);
        fp.eye = eyePoint(spec, fp.cab);
        fp.hood = hoodPoint(fp.cab, fp.eye);
        // The hood's front edge as seen from the hood camera: the least
        // steep drop to any front shell point, as a slope.
        let drop = Infinity;
        if (geo.body) {
          const g = frontShell(geo.body, fp.cab);
          const pa = g.attributes.position.array, ix = g.index.array;
          for (let i = 0; i < ix.length; i++) {
            const k = ix[i] * 3;
            const dx = pa[k] - fp.hood.x;
            if (dx < 0.3 || Math.abs(pa[k + 2]) > 0.5) continue;
            const sl = (fp.hood.y - pa[k + 1]) / dx;
            if (sl < drop) drop = sl;
          }
        }
        fp.hoodDrop = Number.isFinite(drop) ? drop : 0.3;
      } else {
        // No mesh (tests, a car being swapped): points from the spec.
        const e = spec.eye;
        fp.cab = null;
        fp.eye = e && Number.isFinite(e.x) ? { x: e.x, y: e.y, z: e.z } : { x: spec.length * 0.2 - 1.05, y: spec.height * 0.81, z: -spec.width * 0.215 };
        fp.hood = { x: spec.length * 0.2, y: fp.eye.y, z: 0 };
        fp.hoodDrop = 0.3;
      }
      fp.lastY = null;
    }
    const want = mode.fp === 'cockpit' && mesh ? v : null;
    if (fp.att && (fp.att.vehicle !== want || fp.att.mesh !== mesh)) {
      fp.att.detach();
      fp.att = null;
    }
    if (want && !fp.att) fp.att = attachInterior(want);
  }

  // Vertical field of view (degrees) for a horizontal one at the
  // camera's aspect.
  const vfovOf = (h) => (2 * Math.atan(Math.tan((h * RAD) / 2) / Math.max(0.5, camera.aspect || 1))) / RAD;

  function stepFirst(target, dt, input) {
    const lx = input ? input.lookX || 0 : 0, ly = input ? input.lookY || 0 : 0;
    if (lx || ly) {
      fp.yaw = clamp(fp.yaw + lx * LOOK.drag, -LOOK.yawMax, LOOK.yawMax);
      fp.pitch = clamp(fp.pitch - ly * LOOK.drag, -LOOK.pitchMax, LOOK.pitchMax);
      input.lookX = 0;
      input.lookY = 0;
      fp.since = 0;
    } else if (dt > 0) {
      fp.since += dt;
    }
    const held = (input && input.lookHeld === true) || fp.since < LOOK.hold;
    if (!held && dt > 0) {
      const k = 1 - Math.exp(-dt / LOOK.ret);
      fp.yaw -= fp.yaw * k;
      fp.pitch -= fp.pitch * k;
    }
    // Head lean: forward into braking (car frame +x), a damped spring
    // kicked by the car's vertical acceleration (bumps, curbs, landings).
    if (dt > 0) {
      const wantX = clamp(-accel / 9.81, 0, 1) * FIRST.lean;
      fp.headX += (wantX - fp.headX) * (1 - Math.exp(-dt / 0.12));
      const y = target.y || 0;
      if (fp.lastY === null) { fp.lastY = y; fp.lastVY = 0; }
      const vy = (y - fp.lastY) / dt;
      const ay = clamp((vy - fp.lastVY) / dt, -80, 80);
      fp.lastY = y;
      fp.lastVY = vy;
      fp.headVY += (-fp.headY * 300 - fp.headVY * 24 - ay * 0.9) * dt;
      fp.headY = clamp(fp.headY + fp.headVY * dt, -FIRST.lean, FIRST.lean);
      if (fp.headY === FIRST.lean || fp.headY === -FIRST.lean) fp.headVY *= 0.5;
    }
  }

  // Camera at the car's eye (cockpit) or hood point, rigid on the car's
  // ground frame: the yaw and slope of the car, never its body roll, so
  // the horizon stays level.
  function placeFirst(target) {
    const p = mode.fp === 'cockpit' ? fp.eye : fp.hood;
    const lxl = p.x + fp.headX, lyl = p.y + fp.headY, lzl = p.z;
    let cx, cy, cz, yaw, slope;
    const mesh = fp.vmesh;
    if (mesh) {
      const e = mesh.matrix.elements;
      cx = e[0] * lxl + e[4] * lyl + e[8] * lzl + e[12];
      cy = e[1] * lxl + e[5] * lyl + e[9] * lzl + e[13];
      cz = e[2] * lxl + e[6] * lyl + e[10] * lzl + e[14];
      yaw = Math.atan2(e[2], e[0]);
      slope = Math.asin(clamp(e[1], -1, 1));
    } else {
      yaw = target.heading;
      slope = 0;
      const c = Math.cos(yaw), s = Math.sin(yaw);
      cx = target.x + c * lxl - s * lzl;
      cy = (target.y || 0) + lyl;
      cz = target.z + s * lxl + c * lzl;
    }
    // Framing pitch: the hood edge or the gauge cluster where FIRST puts it.
    let bias = 0;
    if (mode.fp === 'hood') {
      const vh = (fovOfFirst() / 2) * RAD;
      bias = Math.atan((1 - 2 * FIRST.hoodShare) * Math.tan(vh)) - Math.atan(fp.hoodDrop);
      bias = clamp(bias, FIRST.hoodPitch[0] * RAD, FIRST.hoodPitch[1] * RAD);
    }
    fp.bias = bias;
    const a = yaw + fp.yaw, pt = slope + bias + fp.pitch;
    const dx = Math.cos(a) * Math.cos(pt), dy = Math.sin(pt), dz = Math.sin(a) * Math.cos(pt);
    camera.position.set(cx, cy, cz);
    camera.lookAt(cx + dx * 10, cy + dy * 10, cz + dz * 10);
    ray.x = cx; ray.y = cy; ray.z = cz;
    ray.dx = dx; ray.dy = dy; ray.dz = dz;
    px = cx; py = cy; pz = cz;
    applyShake(Math.abs(target.speed || 0));
  }

  const fovOfFirst = () => (mode.fovH ? vfovOf(mode.fovH) : mode.baseFov);
  function fovFirst() {
    const fov = fovOfFirst();
    curFov = fov;
    if (Math.abs(fov - camera.fov) > 0.01) {
      camera.fov = fov;
      camera.updateProjectionMatrix();
    }
  }

  function syncNear() {
    if (camera.near !== wantNear) {
      camera.near = wantNear;
      camera.updateProjectionMatrix();
    }
  }
  const firstOn = () => !!mode.fp && modeKey === 'car';
  // A car's chase views (Chase, Far chase): not first person, not aiming.
  const carChase = () => modeKey === 'car' && !mode.fp && mode.dist > 0.5 && aim.k <= 0;

  return {
    update(target, dt, input, collision) {
      syncNear();
      if (firstOn()) {
        if (input && (input.lookX || input.lookY)) fx.touched = true;
        aim.k = 0;
        syncFirst(target.vehicle || null);
        updateFeel(target, dt);
        stepFirst(target, dt, input);
        camHeading = target.heading;
        orbitYaw = 0;
        orbitPitch = 0;
        placeFirst(target);
        fovFirst();
        if (fp.att) fp.att.update(target.vehicle);
        return;
      }
      // Ease the aim view in and out (AIM.ease seconds).
      if (input && (input.lookX || input.lookY)) fx.touched = true;
      if (dt > 0) aim.k = clamp(aim.k + (aim.on ? dt : -dt) / AIM.ease, 0, 1);
      if (aim.on && input && (input.lookX || input.lookY)) {
        // Aiming: the drag turns the aim itself (slower over a target).
        if (!aim.holdDrag) {
          const g = AIM.drag * aim.dragScale;
          aim.yaw = angleDiff(aim.yaw + input.lookX * g, 0);
          aim.pitch = clamp(aim.pitch - input.lookY * g, AIM.pitchMin, AIM.pitchMax);
        }
        input.lookX = 0;
        input.lookY = 0;
        sinceDrag = 0;
      } else if (modeKey === 'tank' && input && (input.lookX || input.lookY)) {
        if (!tankAim.holdDrag) {
          const g = AIM.drag * tankAim.dragScale;
          tankAim.yaw = angleDiff(tankAim.yaw + input.lookX * g, 0);
          tankAim.pitch = clamp(tankAim.pitch - input.lookY * g, TANK_AIM.pitchMin, TANK_AIM.pitchMax);
        }
        input.lookX = 0;
        input.lookY = 0;
        sinceDrag = 0;
      } else if (input && (input.lookX || input.lookY)) {
        orbitYaw += input.lookX * 0.006;
        orbitPitch = clamp(orbitPitch + input.lookY * 0.01, Math.min(0, -mode.height + 0.6), 6);
        input.lookX = 0;
        input.lookY = 0;
        sinceDrag = 0;
      } else {
        sinceDrag += dt;
      }
      orbitYaw = angleDiff(orbitYaw, 0);
      const spd = Math.abs(target.speed || 0);
      // After ~2 s without drag while moving, ease back behind.
      if (sinceDrag > 2 && spd > 1.5 && !aim.holdOrbit) {
        const k = Math.min(1, 1.5 * dt);
        orbitYaw -= orbitYaw * k;
        orbitPitch -= orbitPitch * k;
      }
      // Heading spring, faster at speed. Only follow while moving forward
      // or standing, so reversing does not swing the camera around.
      const rate = (1.5 + Math.min(spd, 60) * 0.12) * mode.turn;
      if (aim.k > 0) {
        // The chase view waits behind the aim, so leaving it is seamless.
        camHeading = aim.yaw;
        orbitYaw = 0;
        orbitPitch = 0;
      } else if (modeKey === 'car' && mode.dist > 0.5 && (target.speed || 0) > -2) {
        // Chase views: a fixed 0.18 s lag, so the car's yaw shows.
        camHeading += angleDiff(target.heading, camHeading) * (1 - Math.exp(-Math.max(0, dt) / LEAN.yawLag));
      } else if ((target.speed || 0) > -2 || modeKey === 'tank') {
        camHeading += angleDiff(target.heading, camHeading) * Math.min(1, rate * dt);
      }
      camHeading = angleDiff(camHeading, 0);
      const ks = Math.min(1, 3 * dt);
      camPitch += (clamp((target.pitch || 0) * mode.pitchShare, -0.6, 0.6) - camPitch) * ks;
      camRoll += (clamp((target.roll || 0) * mode.rollShare, -0.35, 0.35) - camRoll) * ks;
      updateFeel(target, dt);
      place(target, dt, collision, false);
      updateFov(spd, dt, false, target.boost);
    },
    snap(target) {
      camHeading = target.heading;
      camPitch = clamp((target.pitch || 0) * mode.pitchShare, -0.6, 0.6);
      camRoll = clamp((target.roll || 0) * mode.rollShare, -0.35, 0.35);
      orbitYaw = 0;
      orbitPitch = 0;
      sinceDrag = 99;
      lastHeading = null;
      turnLook = 0;
      steerLook = 0;
      leanRoll = 0;
      leanPitch = 0;
      accel = 0;
      fovKick = 0;
      trauma = 0;
      aim.on = false;
      aim.k = 0;
      syncNear();
      if (firstOn()) {
        syncFirst(target.vehicle || null);
        fp.yaw = 0; fp.pitch = 0; fp.headX = 0; fp.headY = 0; fp.headVY = 0; fp.lastY = null;
        placeFirst(target);
        fovFirst();
        if (fp.att) fp.att.update(target.vehicle);
        return;
      }
      place(target, 0, null, true);
      updateFov(Math.abs(target.speed || 0), 0, true, target.boost);
    },
    setMode(m) {
      modeKey = MODES[m] ? m : 'car';
      applyMode();
      if (modeKey !== 'foot') setAim(false, true);
    },
    // Aim view on or off (foot only). Turning it on starts the aim where
    // the camera already looks (level), so nothing jumps.
    setAim,
    aim,
    ray,
    tankAim,
    fx,
    // Where the view points now, as yaw (heading convention).
    viewYaw: () => Math.atan2(ray.dz, ray.dx),
    // The VIEW button: next camera view for the current kind of craft.
    // Returns the new view's name for a toast.
    cycleView() {
      const list = VIEWS[modeKey] || VIEWS.car;
      viewIdx[modeKey] = (viewIdx[modeKey] + 1) % list.length;
      applyMode();
      orbitYaw = 0;
      orbitPitch = 0;
      return viewName;
    },
    getView() {
      return viewName;
    },
    // First person (Hood or Cockpit in a car): true while it is the view.
    isFirstPerson: firstOn,
    // The first-person state for tests and the UI test: look (degrees),
    // the eye and hood points (car local), the framing pitch (degrees),
    // the attached interior (or null).
    getFirst: () => ({
      view: firstOn() ? mode.fp : null, yawDeg: fp.yaw / RAD, pitchDeg: fp.pitch / RAD, biasDeg: (fp.bias || 0) / RAD,
      eye: fp.eye, hood: fp.hood, head: { x: fp.headX, y: fp.headY }, interior: fp.att, near: camera.near, cab: fp.cab,
    }),
    // Pick a view by name (tests, the UI test). Returns false if the kind has none.
    setView(name) {
      const list = VIEWS[modeKey] || VIEWS.car;
      const i = list.findIndex((v) => v.name === name);
      if (i < 0) return false;
      viewIdx[modeKey] = i;
      applyMode();
      orbitYaw = 0;
      orbitPitch = 0;
      return true;
    },
    // Car lean (roll into turns, pitch under braking) on or off; the
    // limits are LEAN. Reduced motion starts it off.
    setLean(on) {
      leanOn = !!on;
      if (!leanOn) { leanRoll = 0; leanPitch = 0; }
    },
    // Current follow heading (rad) and lean (degrees), for tests and the HUD.
    getLean: () => ({ on: leanOn, heading: camHeading, rollDeg: leanRoll / RAD, pitchDeg: leanPitch / RAD, yawRate: yawRateEst, lookDeg: steerLook / RAD }),
    // Impact shake: strength is the closing speed in m/s.
    kick(strength) {
      if (!(strength > 1.5)) return;
      trauma = Math.min(1, trauma + Math.min(0.85, (strength - 1.5) / 18));
    },
    // 0 turns shakes off, 1 is normal (clamped to 0..1.5).
    setShake(scale) {
      shakeScale = clamp(+scale || 0, 0, 1.5);
    },
  };
}
