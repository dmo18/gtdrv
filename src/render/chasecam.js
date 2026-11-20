// Third-person chase camera. Follows the target's heading with a spring,
// orbits on drag, eases back behind after a pause and pulls in when a
// building would block the view. No allocations per frame.
import { angleDiff, clamp } from '../core/rng.js';

const MODES = {
  car: { dist: 7.5, height: 2.6, lookHeight: 1.2, lookAhead: 4, baseFov: 62 },
  foot: { dist: 4.2, height: 1.9, lookHeight: 1.5, lookAhead: 1.5, baseFov: 60 },
};

export function createChaseCamera(camera) {
  let mode = MODES.car;
  let camHeading = 0; // smoothed follow heading
  let orbitYaw = 0; // drag offset around the target
  let orbitPitch = 0; // drag offset in height (metres)
  let sinceDrag = 99;
  let curDist = mode.dist;
  let curFov = camera.fov || mode.baseFov;
  let px = 0, py = 0, pz = 0; // smoothed camera position

  function place(target, dt, collision, snap) {
    const a = camHeading + orbitYaw;
    const bx = -Math.cos(a), bz = -Math.sin(a);
    // Pull in when something solid is between the target and the camera.
    let want = mode.dist;
    if (collision && collision.raycast) {
      const hit = collision.raycast(target.x, target.z, bx, bz, mode.dist + 0.5);
      if (hit < mode.dist + 0.5) want = Math.max(1.2, hit - 0.6);
    }
    // Snap in quickly, ease back out slowly.
    if (snap || want < curDist) curDist = want;
    else curDist += (want - curDist) * Math.min(1, 2 * dt);

    const baseY = target.height || 0;
    const tx = target.x + bx * curDist;
    const tz = target.z + bz * curDist;
    const ty = baseY + mode.height + orbitPitch;
    if (snap) {
      px = tx; py = ty; pz = tz;
    } else {
      const k = Math.min(1, 12 * dt);
      px += (tx - px) * k;
      py += (ty - py) * k;
      pz += (tz - pz) * k;
    }
    camera.position.set(px, py, pz);

    const spd = Math.abs(target.speed || 0);
    const ahead = mode.lookAhead * Math.min(1, 0.3 + spd / 25);
    camera.lookAt(
      target.x + Math.cos(target.heading) * ahead,
      baseY + mode.lookHeight,
      target.z + Math.sin(target.heading) * ahead,
    );
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
      const rate = 1.5 + spd * 0.12;
      if ((target.speed || 0) > -2) {
        camHeading += angleDiff(target.heading, camHeading) * Math.min(1, rate * dt);
      }
      camHeading = angleDiff(camHeading, 0);
      place(target, dt, collision, false);
      updateFov(spd, dt, false);
    },
    snap(target) {
      camHeading = target.heading;
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
