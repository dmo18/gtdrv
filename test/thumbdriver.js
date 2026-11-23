// The thumb driver (docs/PLAN_V3.md 13, task DRIVE): a model of a coarse,
// slow human thumb on the touch steering, driving the real vehicle step
// function. Test helper (not a test file); test/thumb-driver.test.js runs
// it, and it takes the vehicle module as an argument so the same driver
// can drive an older copy of the model for a before / after table.
//
// The driver:
// - sees the car 180 ms late (a ring of past states),
// - steers by pure pursuit along the car's course (the way it is going,
//   as the eye reads it from the motion; the heading at walking pace): a point lookTime(u) seconds of
//   travel ahead on the path (at least THUMB.lookMin m), the curvature 2 sin(alpha) / distance that
//   reaches it, as a share of the car's full-lock curvature at that speed
//   (a driver who knows the car), through the inverse of the car's input
//   shaping when the module has one (steerShapeExp),
// - moves the thumb no faster than 4 units of input per second,
// - and the widget quantizes the thumb to steps of 0.08, with seeded noise
//   of up to 0.04 (redrawn every 0.1 s) on top.
// Speed is held with the pedals (not part of the steering study).
import { createRng } from '../src/core/rng.js';

export const DT = 1 / 60;
export const MPH = 2.23694;
export const THUMB = { delay: 0.18, rate: 4, quant: 0.08, noise: 0.04, noiseEvery: 6, look0: 0.35, lookPerV: 0.036, lookT: 1.4, lookMin: 5, lookMax: 45 };
// Look-ahead time (s) at speed u: a driver looks further ahead the faster
// he goes, about 0.65 s in town (20 mph), 1.1 s at 45 mph and 1.4 s at 65.
export const lookTime = (u) => Math.min(THUMB.lookT, THUMB.look0 + THUMB.lookPerV * u);
export const LANE = 3.3; // m, a US lane
const PAST = 1.25; // how far past the stop a thumb asking for more pushes

// ---- Paths: dense polylines (x, z) with their arc length. ----
export function polyline(pts) {
  const n = pts.length / 2;
  const s = new Float64Array(n);
  for (let i = 1; i < n; i++) s[i] = s[i - 1] + Math.hypot(pts[2 * i] - pts[2 * i - 2], pts[2 * i + 1] - pts[2 * i - 1]);
  return { pts, s, n, last: 0 };
}
// Straight from (x0, z0) along heading h for len m, then arcs and lines
// given as [{ arc: radius, turn: rad (+ toward +z) } | { line: len }].
export function buildPath(x0, z0, h, parts, step = 0.2) {
  const pts = [x0, z0];
  let x = x0, z = z0, hd = h;
  for (const p of parts) {
    if (p.line) {
      const n = Math.ceil(p.line / step);
      for (let i = 0; i < n; i++) { x += Math.cos(hd) * p.line / n; z += Math.sin(hd) * p.line / n; pts.push(x, z); }
    } else {
      const len = p.arc * Math.abs(p.turn), n = Math.ceil(len / step), dh = p.turn / n, ds = len / n;
      for (let i = 0; i < n; i++) {
        hd += dh / 2; x += Math.cos(hd) * ds; z += Math.sin(hd) * ds; hd += dh / 2; pts.push(x, z);
      }
    }
  }
  return polyline(pts);
}
export function curvePath(fn, x0, x1, step = 0.2) {
  const pts = [];
  for (let x = x0; x <= x1 + 1e-9; x += step) pts.push(x, fn(x));
  return polyline(pts);
}
// Closest point: arc length and signed offset (+ = to the right of the
// path direction, the +z side of a path running along +x).
export function project(path, x, z) {
  const { pts, n } = path;
  let best = Infinity, bi = 0, bt = 0;
  const i0 = Math.max(0, path.last - 60), i1 = Math.min(n - 1, path.last + 200);
  for (let i = i0; i < i1; i++) {
    const ax = pts[2 * i], az = pts[2 * i + 1], dx = pts[2 * i + 2] - ax, dz = pts[2 * i + 3] - az;
    const l2 = dx * dx + dz * dz || 1e-12;
    let t = ((x - ax) * dx + (z - az) * dz) / l2;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const ex = ax + dx * t - x, ez = az + dz * t - z, d2 = ex * ex + ez * ez;
    if (d2 < best) { best = d2; bi = i; bt = t; }
  }
  path.last = bi;
  const ax = pts[2 * bi], az = pts[2 * bi + 1], dx = pts[2 * bi + 2] - ax, dz = pts[2 * bi + 3] - az, l = Math.hypot(dx, dz) || 1e-12;
  const px = ax + dx * bt, pz = az + dz * bt;
  const off = ((x - px) * -dz + (z - pz) * dx) / l;
  return { s: path.s[bi] + bt * l, off, i: bi };
}
export function pointAt(path, s) {
  const { pts, n } = path;
  if (s >= path.s[n - 1]) return [pts[2 * n - 2], pts[2 * n - 1]];
  let i = path.last;
  while (i < n - 2 && path.s[i + 1] < s) i++;
  while (i > 0 && path.s[i] > s) i--;
  const t = (s - path.s[i]) / (path.s[i + 1] - path.s[i] || 1e-12);
  return [pts[2 * i] + (pts[2 * i + 2] - pts[2 * i]) * t, pts[2 * i + 1] + (pts[2 * i + 3] - pts[2 * i + 1]) * t];
}

// ---- The driver. ----
export function createThumb(mod, seed = 7) {
  const rng = createRng(seed);
  const lag = Math.round(THUMB.delay / DT);
  const ring = new Float64Array((lag + 1) * 4);
  let filled = 0, head = 0, thumb = 0, noise = 0, k = 0, seen = null, mine = 0;
  const shapeExp = typeof mod.steerShapeExp === 'function' ? mod.steerShapeExp : () => 1;
  return {
    get thumb() { return thumb; },
    // The steer input for this step, from the car's state 180 ms ago.
    steer(v, path, look = 0) {
      ring[head * 4] = v.x; ring[head * 4 + 1] = v.z; ring[head * 4 + 3] = v.speed;
      // Course above 6 m/s, heading below 3 (in a walking-pace U-turn the
      // eye follows the hood), blended between.
      const w = v.speed <= 3 ? 0 : v.speed >= 6 ? 1 : (v.speed - 3) / 3;
      ring[head * 4 + 2] = w > 0 ? v.heading + w * Math.atan2(Math.sin(Math.atan2(v.vz, v.vx) - v.heading), Math.cos(Math.atan2(v.vz, v.vx) - v.heading)) : v.heading;
      head = (head + 1) % (lag + 1);
      filled = Math.min(lag + 1, filled + 1);
      const o = filled < lag + 1 ? 0 : head; // the oldest sample
      // Pure pursuit along the way the car is going (its course, which the
      // eye reads from the motion; the heading at walking pace).
      const x = ring[o * 4], z = ring[o * 4 + 1], h = ring[o * 4 + 2], u = ring[o * 4 + 3];
      const au = Math.max(1, Math.abs(u));
      const Ld = Math.min(THUMB.lookMax, Math.max(THUMB.lookMin, (look || lookTime(au)) * au));
      // The driver's own place on the path (the caller's search index kept).
      const saved = path.last;
      if (path !== seen) { seen = path; mine = 0; }
      path.last = mine;
      const p = project(path, x, z);
      const [tx, tz] = pointAt(path, p.s + Ld);
      mine = path.last;
      path.last = saved;
      const dx = tx - x, dz = tz - z;
      const alpha = Math.atan2(-Math.sin(h) * dx + Math.cos(h) * dz, Math.cos(h) * dx + Math.sin(h) * dz);
      const kappa = 2 * Math.sin(alpha) / Math.hypot(dx, dz);
      // Asked for more than full lock, the thumb pushes past the widget's
      // stop (full input held, noise and all) rather than stopping at it.
      let share = kappa / mod.fullLockCurvature(v.spec, au);
      share = share > PAST ? PAST : share < -PAST ? -PAST : share;
      const e = shapeExp(au);
      const want = Math.sign(share) * Math.pow(Math.abs(share), 1 / e);
      const step = THUMB.rate * DT;
      thumb += Math.max(-step, Math.min(step, want - thumb));
      if (k++ % THUMB.noiseEvery === 0) noise = rng.range(-THUMB.noise, THUMB.noise);
      const q = Math.round((thumb + noise) / THUMB.quant) * THUMB.quant;
      return q > 1 ? 1 : q < -1 ? -1 : q;
    },
  };
}

// Hold a speed with the pedals.
export function holdSpeed(v, c, u) {
  const e = u - v.speed;
  c.throttle = Math.max(0, Math.min(1, e * 0.8 + 0.15));
  c.brake = e < -0.5 ? Math.min(1, -e * 0.3) : 0;
}
const controls = () => ({ steer: 0, throttle: 0, brake: 0, handbrake: false, steerShape: true });
function startAt(mod, id, x, z, h, u) {
  const v = mod.createVehicle(id, x, z, h);
  v.vx = Math.cos(h) * u; v.vz = Math.sin(h) * u; v.speed = u;
  return v;
}

// Run along a path at speed u. Returns the worst lane use (max |offset| +
// half width, m) over the part of the path in [s0, s1], and the run.
function followPath(mod, id, path, u, s0, s1, seed, maxT = 40) {
  path.last = 0;
  const [x0, z0] = pointAt(path, 0);
  const [x1, z1] = pointAt(path, 1);
  const v = startAt(mod, id, x0, z0, Math.atan2(z1 - z0, x1 - x0), u);
  const c = controls();
  const drv = createThumb(mod, seed);
  let worst = 0, maxSteer = 0, t = 0, lo = 0, hi = 0;
  const end = path.s[path.n - 1] - THUMB.lookMax - 2;
  for (; t < maxT; t += DT) {
    holdSpeed(v, c, u);
    c.steer = drv.steer(v, path);
    mod.stepVehicle(v, c, DT, {});
    const p = project(path, v.x, v.z);
    if (p.s >= s0 && p.s <= s1) { worst = Math.max(worst, Math.abs(p.off)); lo = Math.min(lo, p.off); hi = Math.max(hi, p.off); maxSteer = Math.max(maxSteer, Math.abs(c.steer)); }
    if (p.s > end) break;
  }
  return { worst, lo, hi, edge: worst + v.spec.width / 2, maxSteer, v };
}

// (a), (b): 90 degree turns at 20 mph, 2-lane streets. Lane center arcs:
// right turn radius 12 m (a 10.35 m curb corner), left turn across the
// junction 12 + LANE m.
export const TURN = { mph: 20, right: 12, left: 12 + LANE, lead: 40, tail: 40 };
export function junctionTurn(mod, id, side, seed = 11) {
  const R = side === 'right' ? TURN.right : TURN.left;
  const turn = side === 'right' ? Math.PI / 2 : -Math.PI / 2;
  const path = buildPath(0, LANE / 2, 0, [{ line: TURN.lead }, { arc: R, turn }, { line: TURN.tail }]);
  const r = followPath(mod, id, path, TURN.mph / MPH, 5, TURN.lead + R * Math.PI / 2 + 15, seed);
  return { ...r, inLane: r.edge <= LANE / 2 };
}

// (c): lane change one lane over at speed: the target lane switches at
// t = 1 s; settled = within 0.3 m of the new lane center for good.
export const LANE_CHANGE = { mphs: [45, 65], within: 0.3, settle: 2.5, overshoots: 1, hyst: 0.1, run: 7 };
export function laneChange(mod, id, mph, seed = 13) {
  const u = mph / MPH;
  const v = startAt(mod, id, 0, 0, 0, u);
  const c = controls();
  const drv = createThumb(mod, seed);
  const from = polyline([-100, 0, 3000, 0]), to = polyline([-100, LANE, 3000, LANE]);
  let settled = -1, sign = -1, flips = 0, peak = 0;
  const t0 = 1;
  for (let t = 0; t < t0 + LANE_CHANGE.run; t += DT) {
    holdSpeed(v, c, u);
    c.steer = drv.steer(v, t < t0 ? from : to);
    mod.stepVehicle(v, c, DT, {});
    if (t < t0) continue;
    const e = v.z - LANE;
    if (Math.abs(e) > LANE_CHANGE.within) settled = -1;
    else if (settled < 0) settled = t - t0;
    if (sign < 0 && e > LANE_CHANGE.hyst) { sign = 1; flips++; } else if (sign > 0 && e < -LANE_CHANGE.hyst) { sign = -1; flips++; }
    if (flips > 0) peak = Math.max(peak, Math.abs(e));
  }
  return { settle: settled < 0 ? Infinity : settled, overshoots: flips, peak, heading: v.heading };
}

// (d): a 60 m radius curve (180 degrees) at 40 mph, within 0.5 m.
export const CURVE = { mph: 40, radius: 60, within: 0.5 };
export function curve(mod, id, seed = 17) {
  const path = buildPath(0, 0, 0, [{ line: 60 }, { arc: CURVE.radius, turn: Math.PI }, { line: 60 }]);
  return followPath(mod, id, path, CURVE.mph / MPH, 60, 60 + CURVE.radius * Math.PI, seed);
}

// (e): U-turn in a 12 m street (curbs at z = 0, the right, and z = -12),
// from rest beside the right curb, right tires 0.3 m off it: the driver
// aims at a half circle a little tighter than the car's own walking-pace
// turning radius (he wants the tightest turn, so the thumb holds full
// lock), steers at rest for 0.6 s, then rolls at 2.5 m/s. Every tire
// stays between the curbs.
export const UTURN = { street: 12, gap: 0.3, speed: 2.5, wait: 0.6 };
export function uTurn(mod, id, seed = 19) {
  const s = mod.VEHICLE_SPECS[id], L = s.wheelBase, a = L * (1 - (s.cgFront || 0.55)), b = L * (s.cgFront || 0.55), tr = (s.width - 0.25) / 2;
  const lock = mod.steerMaxOf ? mod.steerMaxOf(s) : s.steerMax;
  const R = 0.85 * Math.hypot(L / Math.tan(lock), b);
  const z0 = -(UTURN.gap + tr + 0.12);
  const path = buildPath(0, z0, 0, [{ line: 0.4 }, { arc: R, turn: -Math.PI }, { line: 30 }], 0.1);
  path.last = 0;
  const v = mod.createVehicle(id, 0, z0, 0);
  const c = controls();
  const drv = createThumb(mod, seed);
  let zMin = Infinity, zMax = -Infinity, turned = 0, last = 0, t = 0;
  for (; t < 30 && turned < Math.PI; t += DT) {
    if (t < UTURN.wait) { c.throttle = 0; c.brake = 0; } else holdSpeed(v, c, UTURN.speed);
    c.steer = drv.steer(v, path, 1.6);
    mod.stepVehicle(v, c, DT, {});
    turned -= Math.atan2(Math.sin(v.heading - last), Math.cos(v.heading - last));
    last = v.heading;
    const ch = Math.cos(v.heading), sh = Math.sin(v.heading);
    for (const lo of [a, -b]) {
      for (const la of [tr, -tr]) {
        const z = v.z + sh * lo + ch * la;
        zMin = Math.min(zMin, z - 0.12);
        zMax = Math.max(zMax, z + 0.12);
      }
    }
  }
  return { used: zMax - zMin, zMin, zMax, turned, ok: turned >= Math.PI - 0.05 && zMax <= 0 && zMin >= -UTURN.street };
}

// (f): six cones on the center line 20 m apart, passed on alternate
// sides at 30 mph; the driver weaves on a line half the car's width plus
// `amp` m out at each cone; the car's side must clear each cone by `clear`.
export const SLALOM = { gap: 20, cones: 6, mph: 30, amp: 0.55, clear: 0.1 };
export function slalom(mod, id, seed = 23) {
  const s = mod.VEHICLE_SPECS[id], A = s.width / 2 + SLALOM.amp, G = SLALOM.gap, N = SLALOM.cones;
  const env = (x) => (x <= 0 ? 0 : x >= G ? 1 : 0.5 - 0.5 * Math.cos(Math.PI * x / G));
  const fall = (x) => (x <= G * N ? 1 : x >= G * (N + 1) ? 0 : 0.5 + 0.5 * Math.cos(Math.PI * (x - G * N) / G));
  const path = curvePath((x) => A * env(x) * fall(x) * Math.cos(Math.PI * (x - G) / G), -40, G * (N + 4));
  path.last = 0;
  const u = SLALOM.mph / MPH;
  const v = startAt(mod, id, -40, 0, 0, u);
  const c = controls();
  const drv = createThumb(mod, seed);
  const clear = [];
  let next = 1;
  for (let t = 0; t < 30 && next <= N; t += DT) {
    holdSpeed(v, c, u);
    c.steer = drv.steer(v, path);
    const x0 = v.x;
    mod.stepVehicle(v, c, DT, {});
    if (x0 < G * next && v.x >= G * next) {
      // Side of the car past the cone (the body's half width off its center).
      clear.push(v.z * (next % 2 ? 1 : -1) - s.width / 2);
      next++;
    }
  }
  const min = clear.length === N ? Math.min(...clear) : -Infinity;
  return { clear, min, ok: min >= SLALOM.clear };
}

// Trail braking (6.3 B4 at 45 mph): a held input of `steer` with brake
// 0.6 against the same input without: the steering response (the path
// curvature as a share of what that input asks at the speed of the
// moment, the mean of the second half-second) kept under the brake.
export function trailBrake(mod, id, steer = 0.5) {
  const turn = (brake) => {
    const v = startAt(mod, id, 0, 0, 0, 20);
    const c = { steer: 0, throttle: 0, brake: 0, handbrake: false };
    for (let i = 0; i < 60; i++) { holdSpeed(v, c, 20); mod.stepVehicle(v, c, DT, {}); }
    c.steer = steer; c.throttle = 0; c.brake = brake;
    let s = 0, n = 0;
    for (let i = 0; i < 60; i++) {
      if (!brake) holdSpeed(v, c, 20);
      mod.stepVehicle(v, c, DT, {});
      if (i >= 30) { s += v.yawRate / Math.max(1, v.speed) / (steer * mod.fullLockCurvature(v.spec, v.speed)); n++; }
    }
    return s / n;
  };
  return turn(0.6) / turn(0);
}

export const CARS = ['sedan', 'suv', 'pickup', 'sports', 'truck'];
export const UTURN_CARS = ['sedan', 'suv', 'pickup', 'sports'];

// The whole table for one module (in its current mode and preset).
export function runAll(mod, ids = CARS) {
  const rows = [];
  for (const id of ids) {
    const r = junctionTurn(mod, id, 'right'), l = junctionTurn(mod, id, 'left');
    const c45 = laneChange(mod, id, 45), c65 = laneChange(mod, id, 65);
    const cv = curve(mod, id), sl = slalom(mod, id);
    const ut = UTURN_CARS.includes(id) ? uTurn(mod, id) : null;
    rows.push({ id, right: r, left: l, c45, c65, curve: cv, uturn: ut, slalom: sl, trail: Math.min(trailBrake(mod, id, 0.5), trailBrake(mod, id, 1)) });
  }
  return rows;
}

const f2 = (x) => (Number.isFinite(x) ? x.toFixed(2) : 'never');
export function formatRows(rows) {
  const out = ['car       right-edge left-edge  lc45 s/ov  lc65 s/ov  curve m  uturn m  slalom m  trail'];
  for (const r of rows) {
    out.push(`${r.id.padEnd(9)} ${f2(r.right.edge).padStart(6)}/1.65 ${f2(r.left.edge).padStart(6)}/1.65 `
      + `${f2(r.c45.settle).padStart(5)}/${r.c45.overshoots} ${f2(r.c65.settle).padStart(6)}/${r.c65.overshoots}  `
      + `${f2(r.curve.worst).padStart(6)}  ${r.uturn ? f2(r.uturn.used).padStart(6) : '     -'}  ${f2(r.slalom.min).padStart(7)}  ${f2(r.trail)}`);
  }
  return out.join('\n');
}
