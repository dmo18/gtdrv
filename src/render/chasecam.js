// Third-person chase camera. Follows the target's heading with a spring,
// orbits on drag, eases back behind after a pause and pulls in when a
// building would block the view. The target may carry `y` (height above
// ground/sea), `pitch` and `roll` (aircraft). No allocations per frame.
// Feel: a short shake on impacts (`kick(strength)`), a faint buzz at very
// high speed, a little look into turns and a small FOV kick under hard
// acceleration. All capped; `setShake(0)` turns the shakes off.
import { angleDiff, clamp } from '../core/rng.js';

// follow: position spring rate. turn: heading spring factor.
// pitchShare / rollShare: how much of the craft's climb angle and bank the
// camera copies (planes, so the horizon moves).
const MODES = {
  car: { dist: 7.5, height: 2.6, lookHeight: 1.2, lookAhead: 4, baseFov: 62, follow: 12, turn: 1, pitchShare: 0, rollShare: 0 },
  foot: { dist: 5.6, height: 2.5, lookHeight: 1.15, lookAhead: 0.4, baseFov: 60, follow: 12, turn: 1, pitchShare: 0, rollShare: 0 },
  boat: { dist: 10.5, height: 3.6, lookHeight: 1.4, lookAhead: 5, baseFov: 62, follow: 10, turn: 0.8, pitchShare: 0, rollShare: 0 },
  plane: { dist: 16, height: 3.8, lookHeight: 1.8, lookAhead: 12, baseFov: 64, follow: 18, turn: 1, pitchShare: 0.55, rollShare: 0.22 },
  heli: { dist: 15, height: 6.5, lookHeight: 1.8, lookAhead: 3, baseFov: 62, follow: 6, turn: 0.55, pitchShare: 0, rollShare: 0.1 },
};

// Selectable views for the VIEW button. Each view overrides parts of the
// mode above. A negative `dist` puts the camera AHEAD of the target (bumper
// or cockpit view); those views skip the building pull-in.
const VIEWS = {
  car: [
    { name: 'Chase' },
    { name: 'Far chase', dist: 12.5, height: 4.8, lookHeight: 1.0, lookAhead: 7, baseFov: 66 },
    { name: 'Bumper', dist: -2.2, height: -0.55, lookHeight: -0.45, lookAhead: 40, baseFov: 74, follow: 40, turn: 2.4 },
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
};

const MIN_CLEAR = 0.6; // camera never gets closer than this to ground/sea
const SAMPLES = 10;
// Feel tuning per mode: turn look (metres of look shift per rad/s at
// speed), accel FOV kick (degrees per m/s^2), speed buzz on or off.
const FEEL = {
  car: { turnLook: 0.9, fovKick: 0.32, buzz: 1 },
  foot: { turnLook: 0, fovKick: 0, buzz: 0 },
  boat: { turnLook: 0.6, fovKick: 0.2, buzz: 0.6 },
  plane: { turnLook: 0.4, fovKick: 0.12, buzz: 0.4 },
  heli: { turnLook: 0.3, fovKick: 0.1, buzz: 0.2 },
};
const MAX_SHAKE_ROT = 0.022; // radians at full trauma
const MAX_SHAKE_POS = 0.06; // metres at full trauma
const MAX_BUZZ = 0.0035; // radians at very high speed

export function createChaseCamera(camera) {
  let mode = MODES.car;
  let modeKey = 'car';
  const viewIdx = { car: 0, foot: 0, boat: 0, plane: 0, heli: 0 }; // remembered per kind
  let viewName = 'Chase';
  // Build the active mode from the base mode plus the chosen view.
  function applyMode() {
    const base = MODES[modeKey] || MODES.car;
    const list = VIEWS[modeKey] || VIEWS.car;
    const view = list[viewIdx[modeKey] % list.length] || list[0];
    mode = Object.assign({}, base, view);
    viewName = view.name;
    feel = FEEL[modeKey] || FEEL.car;
    curDist = mode.dist;
  }
  let camHeading = 0; // smoothed follow heading
  let camPitch = 0; // smoothed share of the target's climb angle
  let camRoll = 0; // smoothed share of the target's bank
  let orbitYaw = 0; // drag offset around the target
  let orbitPitch = 0; // drag offset in height (metres)
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
  let accel = 0; // smoothed forward acceleration (m/s^2)
  let fovKick = 0;

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
    const a = camHeading + orbitYaw;
    const cp = Math.cos(camPitch), sp = Math.sin(camPitch);
    const bx = -Math.cos(a) * cp, bz = -Math.sin(a) * cp;
    const baseY = (target.y || 0) + (target.height || 0);
    const rise = mode.height + orbitPitch;
    // Pull in when something solid is between the target and the camera.
    let want = mode.dist;
    if (collision && mode.dist > 0.5) {
      const reach = mode.dist + 0.5;
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
    camera.position.set(px, py, pz);

    const spd = Math.abs(target.speed || 0);
    const ahead = mode.lookAhead * Math.min(1, 0.3 + spd / 25);
    const ch = Math.cos(target.heading), sh = Math.sin(target.heading);
    camera.lookAt(
      target.x + ch * ahead - sh * turnLook,
      baseY + mode.lookHeight + sp * ahead,
      target.z + sh * ahead + ch * turnLook,
    );
    // A little bank with the craft (right side down = clockwise from behind).
    if (camRoll > 1e-4 || camRoll < -1e-4) camera.rotateZ(-camRoll);
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
    const fwd = Math.max(0, spd);
    const wantLook = clamp(yawRate * Math.min(fwd, 30) * 0.06 * feel.turnLook, -1.4, 1.4);
    turnLook += (wantLook - turnLook) * Math.min(1, 2.5 * dt);
    const a = clamp((spd - lastSpeed) / dt, -30, 30);
    lastSpeed = spd;
    accel += (a - accel) * Math.min(1, 4 * dt);
    const wantKick = clamp(accel * feel.fovKick, 0, 4);
    fovKick += (wantKick - fovKick) * Math.min(1, (wantKick > fovKick ? 3 : 1.5) * dt);
  }

  function updateFov(spd, dt, snap) {
    const want = mode.baseFov + Math.min(spd, 50) * 0.22 + fovKick;
    const next = snap ? want : curFov + (want - curFov) * Math.min(1, 3 * dt);
    if (Math.abs(next - camera.fov) > 0.01) {
      camera.fov = next;
      camera.updateProjectionMatrix();
    }
    curFov = next;
  }

  return {
    update(target, dt, input, collision) {
      // Drag to orbit.
      if (input && (input.lookX || input.lookY)) {
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
      if (sinceDrag > 2 && spd > 1.5) {
        const k = Math.min(1, 1.5 * dt);
        orbitYaw -= orbitYaw * k;
        orbitPitch -= orbitPitch * k;
      }
      // Heading spring, faster at speed. Only follow while moving forward
      // or standing, so reversing does not swing the camera around.
      const rate = (1.5 + Math.min(spd, 60) * 0.12) * mode.turn;
      if ((target.speed || 0) > -2) {
        camHeading += angleDiff(target.heading, camHeading) * Math.min(1, rate * dt);
      }
      camHeading = angleDiff(camHeading, 0);
      const ks = Math.min(1, 3 * dt);
      camPitch += (clamp((target.pitch || 0) * mode.pitchShare, -0.6, 0.6) - camPitch) * ks;
      camRoll += (clamp((target.roll || 0) * mode.rollShare, -0.35, 0.35) - camRoll) * ks;
      updateFeel(target, dt);
      place(target, dt, collision, false);
      updateFov(spd, dt, false);
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
      accel = 0;
      fovKick = 0;
      trauma = 0;
      place(target, 0, null, true);
      updateFov(Math.abs(target.speed || 0), 0, true);
    },
    setMode(m) {
      modeKey = MODES[m] ? m : 'car';
      applyMode();
    },
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
