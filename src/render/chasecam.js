// Third-person chase camera. Follows the target's heading with a spring,
// orbits on drag, eases back behind after a pause and pulls in when a
// building would block the view. The target may carry `y` (height above
// ground/sea), `pitch` and `roll` (aircraft). No allocations per frame.
import { angleDiff, clamp } from '../core/rng.js';

// follow: position spring rate. turn: heading spring factor.
// pitchShare / rollShare: how much of the craft's climb angle and bank the
// camera copies (planes, so the horizon moves).
const MODES = {
  car: { dist: 7.5, height: 2.6, lookHeight: 1.2, lookAhead: 4, baseFov: 62, follow: 12, turn: 1, pitchShare: 0, rollShare: 0 },
  foot: { dist: 4.2, height: 1.9, lookHeight: 1.5, lookAhead: 1.5, baseFov: 60, follow: 12, turn: 1, pitchShare: 0, rollShare: 0 },
  boat: { dist: 10.5, height: 3.6, lookHeight: 1.4, lookAhead: 5, baseFov: 62, follow: 10, turn: 0.8, pitchShare: 0, rollShare: 0 },
  plane: { dist: 16, height: 3.8, lookHeight: 1.8, lookAhead: 12, baseFov: 64, follow: 18, turn: 1, pitchShare: 0.55, rollShare: 0.22 },
  heli: { dist: 15, height: 6.5, lookHeight: 1.8, lookAhead: 3, baseFov: 62, follow: 6, turn: 0.55, pitchShare: 0, rollShare: 0.1 },
};

const MIN_CLEAR = 0.6; // camera never gets closer than this to ground/sea
const SAMPLES = 10;

export function createChaseCamera(camera) {
  let mode = MODES.car;
  let camHeading = 0; // smoothed follow heading
  let camPitch = 0; // smoothed share of the target's climb angle
  let camRoll = 0; // smoothed share of the target's bank
  let orbitYaw = 0; // drag offset around the target
  let orbitPitch = 0; // drag offset in height (metres)
  let sinceDrag = 99;
  let curDist = mode.dist;
  let curFov = camera.fov || mode.baseFov;
  let px = 0, py = 0, pz = 0; // smoothed camera position

  // Distance at which the view line from the target back to the camera
  // is first blocked, or `dist` if it is clear. Height-aware: roofs below
  // the view line do not count, so flying high is never pulled in.
  function clearDist(collision, x, y0, z, bx, bz, dist, y1) {
    if (typeof collision.heightAt === 'function') {
      for (let i = 1; i <= SAMPLES; i++) {
        const t = i / SAMPLES;
        const d = dist * t;
        const lineY = y0 + (y1 - y0) * t;
        if (collision.heightAt(x + bx * d, z + bz * d) > lineY - 0.3) return d - dist / SAMPLES;
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
    if (collision) {
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
    camera.lookAt(
      target.x + Math.cos(target.heading) * ahead,
      baseY + mode.lookHeight + sp * ahead,
      target.z + Math.sin(target.heading) * ahead,
    );
    // A little bank with the craft (right side down = clockwise from behind).
    if (camRoll > 1e-4 || camRoll < -1e-4) camera.rotateZ(-camRoll);
  }

  function updateFov(spd, dt, snap) {
    const want = mode.baseFov + Math.min(spd, 50) * 0.22;
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
        orbitPitch = clamp(orbitPitch + input.lookY * 0.01, -mode.height + 0.6, 6);
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
      place(target, 0, null, true);
      updateFov(Math.abs(target.speed || 0), 0, true);
    },
    setMode(m) {
      mode = MODES[m] || MODES.car;
    },
  };
}
