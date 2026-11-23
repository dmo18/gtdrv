// The title camera (docs/REVAMP.md 6.8): while the title shows, the camera
// sits `back` m behind the start spawn along its street, `side` m toward the
// south curb and `height` m up, looking `lookAhead` m ahead at `lookHeight`.
// It dollies `dolly` m forward at `dollySpeed` m/s, eased, and back, for
// ever (not at all under reduced motion). When play begins it blends to the
// chase camera over BLEND_S seconds.
//
// No three.js import: it drives any object with `position.set`, `lookAt`,
// `fov` and `updateProjectionMatrix`, and reads the chase camera's `ray`.
export const BLEND_S = 1.2;

const smooth = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));

// Dolly offset (m, 0..dolly) at time `t` seconds.
export function dollyAt(shot, t) {
  if (!(shot.dolly > 0) || !(shot.dollySpeed > 0)) return 0;
  const period = (2 * shot.dolly) / shot.dollySpeed;
  const p = (((t % period) + period) % period) / period;
  return shot.dolly * smooth(p < 0.5 ? p * 2 : 2 - p * 2);
}

// The shot pose at time `t` for a start view `sv` ({ spawn, camera }) into
// `out` ({ x, y, z, lx, ly, lz, fov }). `still` holds the dolly at 0.
export function titlePose(sv, t, still, out) {
  const c = sv.camera, sp = sv.spawn;
  const fx = Math.cos(sp.heading), fz = Math.sin(sp.heading);
  const d = still ? 0 : dollyAt(c, t);
  // Right of the heading is (-fz, fx): toward the south curb for an east heading.
  out.x = sp.x + fx * (d - c.back) - fz * c.side;
  out.z = sp.z + fz * (d - c.back) + fx * c.side;
  out.y = c.height;
  out.lx = sp.x + fx * (d + c.lookAhead);
  out.lz = sp.z + fz * (d + c.lookAhead);
  out.ly = c.lookHeight;
  out.fov = c.fov;
  return out;
}

export function createTitleCam(camera, chase) {
  let sv = null;
  let state = 'off'; // 'title' | 'blend' | 'off'
  let still = false;
  let blendT = 0;
  let done = null;
  const from = { x: 0, y: 0, z: 0, lx: 0, ly: 0, lz: 0, fov: 55 };
  const pose = { x: 0, y: 0, z: 0, lx: 0, ly: 0, lz: 0, fov: 55 };

  function put(p) {
    camera.position.set(p.x, p.y, p.z);
    camera.lookAt(p.lx, p.ly, p.lz);
    if (Math.abs(camera.fov - p.fov) > 0.01) {
      camera.fov = p.fov;
      camera.updateProjectionMatrix();
    }
  }

  return {
    get state() {
      return state;
    },
    get active() {
      return state !== 'off';
    },
    // Begin the title shot for a start view; `reduced` holds the dolly still.
    start(view, reduced) {
      if (!view || !view.camera || !view.spawn) return false;
      sv = view;
      still = !!reduced;
      state = 'title';
      return true;
    },
    setReduced(on) {
      still = !!on;
    },
    // Blend to the chase camera over BLEND_S seconds; `onDone` runs at the end.
    blend(onDone) {
      if (state !== 'title') {
        if (onDone) onDone();
        return false;
      }
      Object.assign(from, pose);
      state = 'blend';
      blendT = 0;
      done = onDone || null;
      return true;
    },
    // Leave at once (Continue, or no title).
    stop() {
      state = 'off';
      done = null;
    },
    // After the chase camera has placed itself for the frame: `t` is the
    // simulation time (s), `dt` the frame time (s).
    apply(t, dt) {
      if (state === 'title') {
        titlePose(sv, t, still, pose);
        put(pose);
        return;
      }
      if (state !== 'blend') return;
      blendT += dt > 0 ? dt : 0;
      const k = smooth(blendT / BLEND_S);
      // The chase pose is where the chase camera just put the camera.
      const r = chase.ray;
      const cx = camera.position.x, cy = camera.position.y, cz = camera.position.z;
      const cl = 30; // distance of the chase look point
      const lx = r.x + r.dx * cl, ly = r.y + r.dy * cl, lz = r.z + r.dz * cl;
      const chaseFov = camera.fov; // the chase camera has just set it
      pose.x = from.x + (cx - from.x) * k;
      pose.y = from.y + (cy - from.y) * k;
      pose.z = from.z + (cz - from.z) * k;
      pose.lx = from.lx + (lx - from.lx) * k;
      pose.ly = from.ly + (ly - from.ly) * k;
      pose.lz = from.lz + (lz - from.lz) * k;
      pose.fov = from.fov + (chaseFov - from.fov) * k;
      if (k >= 1) {
        state = 'off';
        const f = done;
        done = null;
        // Hand the camera to the chase camera exactly as it placed it.
        if (f) f();
        return;
      }
      put(pose);
    },
  };
}
