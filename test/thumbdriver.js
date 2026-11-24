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
//   (a driver who knows the car: the player's own, playerLockCurvature, where
//   the module has one, task GRIP), through the inverse of the car's input
//   shaping when the module has one (steerShapeExp),
// - moves the thumb no faster than 4 units of input per second,
// - and the widget quantizes the thumb to steps of 0.08, with seeded noise
//   of up to 0.04 (redrawn every 0.1 s) on top.
// Speed is held with the pedals (not part of the steering study).
import { createRng } from '../src/core/rng.js';

export const DT = 1 / 60;
export const MPH = 2.23694;
export const THUMB = { delay: 0.18, rate: 4, quant: 0.08, noise: 0.04, noiseEvery: 6, look0: 0.2, lookPerV: 0.03, lookT: 1.4, lookMin: 5, lookMax: 45 };
// Look-ahead time (s) at speed u: a driver looks further ahead the faster
// he goes, about 0.47 s in town (20 mph), 0.8 s at 45 mph and 1.07 s at 65.
// (Task PLANTED: was 0.35 + 0.036 u. A driver who knows the car previews
// as far as the car's own lag asks; the planted car answers about 0.15 s
// sooner, and with the old preview the driver turned in early everywhere.
// The thumb itself, delay, rate, steps and noise, is unchanged, and the
// before / after table drives both cars with this one driver.)
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
      let share = kappa / (mod.playerLockCurvature || mod.fullLockCurvature)(v.spec, au);
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

// The slide: the slip angle at the rear axle, degrees (the angle between the
// way the car points and the way its rear axle travels). The body slip at
// the center of mass also holds the plain geometry of a tight turn (the
// nose of a car on full lock at walking pace points 20 degrees inside its
// center's path with no tire sliding at all), so the rear axle is where a
// fishtail is measured. 0 under 3 m/s.
export function rearSlipDeg(v) {
  const s = v.spec, cg = Math.min(0.7, Math.max(0.3, s.cgFront || 0.55)), b = s.wheelBase * cg;
  const ch = Math.cos(v.heading), sh = Math.sin(v.heading);
  const vf = v.vx * ch + v.vz * sh, vl = -v.vx * sh + v.vz * ch;
  if (Math.abs(vf) < 3) return 0;
  return Math.atan2(Math.abs(vl - b * v.yawRate), Math.abs(vf)) * 180 / Math.PI;
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
  let worst = 0, maxSteer = 0, t = 0, lo = 0, hi = 0, slip = 0;
  const end = path.s[path.n - 1] - THUMB.lookMax - 2;
  for (; t < maxT; t += DT) {
    holdSpeed(v, c, u);
    c.steer = drv.steer(v, path);
    mod.stepVehicle(v, c, DT, {});
    slip = Math.max(slip, rearSlipDeg(v));
    const p = project(path, v.x, v.z);
    if (p.s >= s0 && p.s <= s1) { worst = Math.max(worst, Math.abs(p.off)); lo = Math.min(lo, p.off); hi = Math.max(hi, p.off); maxSteer = Math.max(maxSteer, Math.abs(c.steer)); }
    if (p.s > end) break;
  }
  return { worst, lo, hi, edge: worst + v.spec.width / 2, maxSteer, v, slip };
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
// Task PLANTED: 90 degree turns at 30 mph. Lane center arcs of FAST.right
// m (right turn) and FAST.right + LANE (left). The driver takes the corner
// as people do at speed, on a line that uses the lane (out, in to the apex,
// out): `use` of the room between the body and the lane edge, which is the
// arc of radius R + use * room * (1 + cos 45) / (1 - cos 45) through the
// same corner. The body is measured against the lane center's own path.
// The box truck (0.99 g in town; the 15 m corner at 30 mph asks 1.2 g)
// takes them at `truckMph`.
export const FAST = { mph: 30, truckMph: 25, right: 15, lead: 40, tail: 40, use: 0.4 };
export function fastTurn(mod, id, side, seed = 11, mph = id === 'truck' ? FAST.truckMph : FAST.mph) {
  const R = side === 'right' ? FAST.right : FAST.right + LANE;
  const turn = side === 'right' ? Math.PI / 2 : -Math.PI / 2, sg = side === 'right' ? 1 : -1;
  const lane = buildPath(0, 0, 0, [{ line: FAST.lead }, { arc: R, turn }, { line: FAST.tail }]);
  const d = FAST.use * (LANE - mod.VEHICLE_SPECS[id].width) / 2;
  const Rl = R + d * (1 + Math.SQRT1_2) / (1 - Math.SQRT1_2), back = Rl - R - d;
  const line = buildPath(0, -sg * d, 0, [{ line: FAST.lead - back }, { arc: Rl, turn }, { line: FAST.tail + back }]);
  lane.last = 0; line.last = 0;
  const u = mph / MPH;
  const v = startAt(mod, id, 0, -sg * d, 0, u);
  const c = controls();
  const drv = createThumb(mod, seed);
  const s1 = FAST.lead + R * Math.PI / 2 + 15;
  let worst = 0, slip = 0, vMin = u;
  for (let t = 0; t < 20; t += DT) {
    holdSpeed(v, c, u);
    c.steer = drv.steer(v, line);
    mod.stepVehicle(v, c, DT, {});
    slip = Math.max(slip, rearSlipDeg(v));
    const p = project(lane, v.x, v.z);
    if (p.s >= 5 && p.s <= s1) { worst = Math.max(worst, Math.abs(p.off)); vMin = Math.min(vMin, v.speed); }
    if (p.s > s1) break;
  }
  const edge = worst + v.spec.width / 2;
  return { worst, edge, slip, inLane: edge <= LANE / 2, keep: vMin / u, mph };
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
  let settled = -1, sign = -1, flips = 0, peak = 0, slip = 0;
  const t0 = 1;
  for (let t = 0; t < t0 + LANE_CHANGE.run; t += DT) {
    holdSpeed(v, c, u);
    c.steer = drv.steer(v, t < t0 ? from : to);
    mod.stepVehicle(v, c, DT, {});
    slip = Math.max(slip, rearSlipDeg(v));
    if (t < t0) continue;
    const e = v.z - LANE;
    if (Math.abs(e) > LANE_CHANGE.within) settled = -1;
    else if (settled < 0) settled = t - t0;
    if (sign < 0 && e > LANE_CHANGE.hyst) { sign = 1; flips++; } else if (sign > 0 && e < -LANE_CHANGE.hyst) { sign = -1; flips++; }
    if (flips > 0) peak = Math.max(peak, Math.abs(e));
  }
  return { settle: settled < 0 ? Infinity : settled, overshoots: flips, peak, heading: v.heading, slip };
}

// (d): a 60 m radius curve (180 degrees) at 45 mph (task PLANTED: was
// 40 mph), within 0.5 m.
export const CURVE = { mph: 45, radius: 60, within: 0.5 };
export function curve(mod, id, seed = 17) {
  const path = buildPath(0, 0, 0, [{ line: 60 }, { arc: CURVE.radius, turn: Math.PI }, { line: 60 }]);
  return followPath(mod, id, path, CURVE.mph / MPH, 60, 60 + CURVE.radius * Math.PI, seed);
}

// (e): U-turn in a street `street` m wide (task PLANTED: 10.5 m, was 12;
// curbs at z = 0, the right, and z = -street), from rest beside the right
// curb, right tires 0.3 m off it: the driver aims at a half circle a
// little tighter than the car's own walking-pace turning radius (he wants
// the tightest turn, so the thumb holds full lock), steers at rest for
// 0.6 s, then rolls at 2.5 m/s. Every tire stays between the curbs.
// The SUV and the pickup (the heavy classes of handlingbands.js, longer and
// wider) get `wide` m.
export const UTURN = { street: 10.5, wide: 11, wideCars: ['suv', 'pickup'], gap: 0.3, speed: 2.5, wait: 0.6 };
export function uTurn(mod, id, seed = 19, street = UTURN.wideCars.includes(id) ? UTURN.wide : UTURN.street) {
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
  return { used: zMax - zMin, zMin, zMax, turned, street, ok: turned >= Math.PI - 0.05 && zMax <= 0 && zMin >= -street };
}

// (f): six cones on the center line 20 m apart, passed on alternate
// sides at 35 mph (task PLANTED: was 30); the driver weaves on a line half
// the car's width plus `amp` m out at each cone (0.7 at 35 mph, was 0.55 at
// 30: the preview of a faster weave cuts more of it off); the car's side
// must clear each cone by `clear`.
// The box truck keeps 30 mph (`truckMph`): its weave of 1.75 m asks more
// than its grip at 35.
export const SLALOM = { gap: 20, cones: 6, mph: 35, truckMph: 30, amp: 0.7, clear: 0.1 };
export function slalom(mod, id, seed = 23) {
  const s = mod.VEHICLE_SPECS[id], A = s.width / 2 + SLALOM.amp, G = SLALOM.gap, N = SLALOM.cones;
  const env = (x) => (x <= 0 ? 0 : x >= G ? 1 : 0.5 - 0.5 * Math.cos(Math.PI * x / G));
  const fall = (x) => (x <= G * N ? 1 : x >= G * (N + 1) ? 0 : 0.5 + 0.5 * Math.cos(Math.PI * (x - G * N) / G));
  const path = curvePath((x) => A * env(x) * fall(x) * Math.cos(Math.PI * (x - G) / G), -40, G * (N + 4));
  path.last = 0;
  const u = (id === 'truck' ? SLALOM.truckMph : SLALOM.mph) / MPH;
  const v = startAt(mod, id, -40, 0, 0, u);
  const c = controls();
  const drv = createThumb(mod, seed);
  const clear = [];
  let next = 1, slip = 0;
  for (let t = 0; t < 30 && next <= N; t += DT) {
    holdSpeed(v, c, u);
    c.steer = drv.steer(v, path);
    const x0 = v.x;
    mod.stepVehicle(v, c, DT, {});
    slip = Math.max(slip, rearSlipDeg(v));
    if (x0 < G * next && v.x >= G * next) {
      // Side of the car past the cone (the body's half width off its center).
      clear.push(v.z * (next % 2 ? 1 : -1) - s.width / 2);
      next++;
    }
  }
  const min = clear.length === N ? Math.min(...clear) : -Infinity;
  return { clear, min, ok: min >= SLALOM.clear, slip };
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

// ---- Abuse (task PLANTED): six ways to make a car fishtail, none with
// the handbrake. Each returns the peak slip angle at the rear axle, deg.
// A scripted input (no thumb model: the worst a player can do).
function run(mod, v, c, secs, world, fn) {
  let slip = 0;
  for (let i = 0; i < Math.round(secs / DT); i++) {
    if (fn) fn(i * DT);
    mod.stepVehicle(v, c, DT, world);
    slip = Math.max(slip, rearSlipDeg(v));
  }
  return slip;
}
const CURB_WORLD = { city: { groundAt: (x) => (Math.floor(x / 20) % 2 ? 0.15 : 0) } }; // a curb step every 20 m
export const ABUSE = ['launch', 'lift', 'brake', 'flick', 'curb', 'rain'];
export const ABUSE_MPH = { corner: 50, flick: 60, curb: 30, rain: 45 };
export function abuse(mod, id) {
  const top = mod.VEHICLE_SPECS[id].maxSpeed * 0.9;
  const at = (mph) => Math.min(mph / MPH, top);
  const out = {};
  // Full throttle from a standstill on full lock, 5 s.
  let v = mod.createVehicle(id, 0, 0, 0), c = controls();
  c.steer = 1; c.throttle = 1;
  out.launch = run(mod, v, c, 5, {});
  // Lifting off mid-corner at 50 mph (full input, then no pedals).
  const corner = (after) => {
    const u = at(ABUSE_MPH.corner);
    v = startAt(mod, id, 0, 0, 0, u); c = controls();
    let s = run(mod, v, c, 2.5, {}, (t) => { holdSpeed(v, c, u); c.steer = t > 0.5 ? 1 : 0; });
    after(c);
    s = Math.max(s, run(mod, v, c, 3, {}));
    return s;
  };
  out.lift = corner((k) => { k.throttle = 0; k.brake = 0; });
  // Braking hard mid-corner.
  out.brake = corner((k) => { k.throttle = 0; k.brake = 1; });
  // A quick left-right flick at 60 mph: full left 0.35 s, full right 0.35 s, let go.
  {
    const u = at(ABUSE_MPH.flick);
    v = startAt(mod, id, 0, 0, 0, u); c = controls();
    out.flick = run(mod, v, c, 3.5, {}, (t) => { holdSpeed(v, c, u); c.steer = t < 0.5 ? 0 : t < 0.85 ? -1 : t < 1.2 ? 1 : 0; });
  }
  // Over curbs mid-turn at 30 mph (a 15 cm step every 20 m, crossed at an angle).
  {
    const u = at(ABUSE_MPH.curb);
    v = startAt(mod, id, 0, 0, 0, u); c = controls();
    out.curb = run(mod, v, c, 5, CURB_WORLD, (t) => { holdSpeed(v, c, u); c.steer = t > 0.3 ? 0.7 : 0; });
    out.jolts = v.jolts || 0;
  }
  // Heavy rain: full input at 45 mph, a flick, then full throttle.
  {
    const u = at(ABUSE_MPH.rain), wet = { weather: { rain: 1, wind: 0 } };
    v = startAt(mod, id, 0, 0, 0, u); c = controls();
    out.rain = run(mod, v, c, 5, wet, (t) => { holdSpeed(v, c, u); c.steer = t < 0.3 ? 0 : t < 2 ? 1 : t < 2.4 ? -1 : 1; if (t > 3.5) { c.throttle = 1; c.brake = 0; } });
  }
  out.worst = Math.max(...ABUSE.map((k) => out[k]));
  return out;
}

// ---- The slide the player asks for: a handbrake turn at 25 mph into a
// cross street (full input and the handbrake until the nose has come round
// `release` degrees, then the thumb steers for the new street and the
// throttle goes down). Returns how far along the old street the car's
// center went (m), the peak slip (deg), the time from the release until
// the slip is under 3 degrees for good (s), the largest yaw rate the other
// way after the release (rad/s, a snap), the speed at the release and 2 s
// later (m/s), and whether drift points would run (v.slip over 0.35 above
// 12 m/s is score.js's rule; here the share of the slide v.slip is over 0.35).
export const HB = { mph: 25, release: 70, quiet: 3 };
export function handbrakeTurn(mod, id, mph = HB.mph) {
  const u = mph / MPH;
  const v = startAt(mod, id, 0, 0, 0, u), c = controls();
  for (let i = 0; i < 30; i++) { holdSpeed(v, c, u); mod.stepVehicle(v, c, DT, {}); }
  const x0 = v.x;
  let peak = 0, along = 0, tRel = -1, lastLoud = 0, snap = 0, vRel = 0, loud = 0, n = 0, t = 0, t90 = -1;
  for (; t < 6; t += DT) {
    if (tRel < 0) {
      c.steer = 1; c.handbrake = true; c.throttle = 0; c.brake = 0;
      if (v.heading * 180 / Math.PI >= HB.release) { tRel = t; vRel = v.speed; }
    }
    if (tRel >= 0) {
      c.handbrake = false; c.throttle = 0.7;
      c.steer = Math.max(-1, Math.min(1, (Math.PI / 2 - v.heading) * 2.5));
    }
    mod.stepVehicle(v, c, DT, {});
    const sl = rearSlipDeg(v);
    peak = Math.max(peak, sl);
    along = Math.max(along, v.x - x0);
    if (t90 < 0 && v.heading >= Math.PI / 2 - 0.26) t90 = t;
    if (tRel < 0) { n++; if ((v.slip || 0) > 0.35) loud++; } else {
      if (sl > HB.quiet) lastLoud = t + DT - tRel;
      if (v.yawRate < 0) snap = Math.max(snap, -v.yawRate);
      if (t - tRel > 2) break;
    }
  }
  return { along, peak, recover: tRel < 0 ? Infinity : lastLoud, snap, vRel, vEnd: v.speed, t90, endDeg: Math.abs(v.heading * 180 / Math.PI - 90), drift: n ? loud / n : 0 };
}

// ---- Input to yaw rate delay: a full step of the thumb at speed; the
// time until the yaw rate is 63 % of what it settles at (1.2 to 1.5 s on).
export const DELAY_MPH = [10, 30, 50, 70];
export function yawDelay(mod, id, mph, steer = 1) {
  const u = Math.min(mph / MPH, mod.VEHICLE_SPECS[id].maxSpeed * 0.9);
  const v = startAt(mod, id, 0, 0, 0, u), c = controls();
  for (let i = 0; i < 30; i++) { holdSpeed(v, c, u); mod.stepVehicle(v, c, DT, {}); }
  c.steer = steer;
  const r = [];
  for (let i = 0; i < 90; i++) { holdSpeed(v, c, u); mod.stepVehicle(v, c, DT, {}); r.push(v.yawRate); }
  let fin = 0;
  for (let i = 72; i < 90; i++) fin += r[i] / 18;
  // The first step counts as 1/60 s: the answer to an input cannot be seen sooner.
  for (let i = 0; i < 90; i++) if (r[i] >= 0.63 * fin) return (i + 1) * DT;
  return Infinity;
}

// ---- Full wheel (task GRIP): full input held for 1 s from straight at a
// held speed (0.98 of the top speed when that is lower). Heading change
// (deg), the yaw rate, lateral g and radius at the end of the second, and
// the peak rear slip.
export function fullWheel(mod, id, mph, secs = 1) {
  const u = Math.min(mph / MPH, mod.VEHICLE_SPECS[id].maxSpeed * 0.98);
  const v = startAt(mod, id, 0, 0, 0, u), c = controls();
  for (let i = 0; i < 30; i++) { holdSpeed(v, c, u); mod.stepVehicle(v, c, DT, {}); }
  c.steer = 1;
  let head = 0, last = v.heading, slip = 0;
  for (let i = 0; i < Math.round(secs / DT); i++) {
    holdSpeed(v, c, u);
    mod.stepVehicle(v, c, DT, {});
    head += Math.atan2(Math.sin(v.heading - last), Math.cos(v.heading - last));
    last = v.heading;
    slip = Math.max(slip, rearSlipDeg(v));
  }
  const r = v.yawRate, sp = v.speed;
  return { id, mph: sp * MPH, head: head * 180 / Math.PI, yaw: r, g: sp * r / 9.81, radius: sp / Math.max(1e-6, Math.abs(r)), slip };
}

export const CARS = ['sedan', 'suv', 'pickup', 'sports', 'muscle', 'truck'];
export const UTURN_CARS = ['sedan', 'suv', 'pickup', 'sports', 'muscle'];

// The whole table for one module (in its current mode and preset).
// `quick`: the thumb scenarios only (the presets).
export function runAll(mod, ids = CARS, quick = false) {
  const rows = [];
  for (const id of ids) {
    const r = junctionTurn(mod, id, 'right'), l = junctionTurn(mod, id, 'left');
    const fr = fastTurn(mod, id, 'right'), fl = fastTurn(mod, id, 'left');
    const c45 = laneChange(mod, id, 45), c65 = laneChange(mod, id, 65);
    const cv = curve(mod, id), sl = slalom(mod, id);
    const ut = UTURN_CARS.includes(id) ? uTurn(mod, id) : null;
    const row = { id, right: r, left: l, fastRight: fr, fastLeft: fl, c45, c65, curve: cv, uturn: ut, slalom: sl, trail: Math.min(trailBrake(mod, id, 0.5), trailBrake(mod, id, 1)) };
    row.slip = Math.max(r.slip, l.slip, fr.slip, fl.slip, c45.slip, c65.slip, cv.slip, sl.slip);
    if (!quick) {
      row.abuse = abuse(mod, id);
      row.hb = id === 'truck' ? null : handbrakeTurn(mod, id);
      row.delay = Math.max(...DELAY_MPH.map((mph) => yawDelay(mod, id, mph)));
    }
    rows.push(row);
  }
  return rows;
}

const f2 = (x) => (Number.isFinite(x) ? x.toFixed(2) : 'never');
const f1 = (x) => (Number.isFinite(x) ? x.toFixed(1) : 'never');
export function formatRows(rows) {
  const out = ['car     20mph R/L edge  30mph R/L edge  lc45 s/ov lc65 s/ov curve m uturn m slalom m trail  slip deg'];
  for (const r of rows) {
    out.push(`${r.id.padEnd(7)} ${f2(r.right.edge)}/${f2(r.left.edge)}/1.65 ${f2(r.fastRight.edge)}/${f2(r.fastLeft.edge)}/1.65 `
      + `${f2(r.c45.settle).padStart(6)}/${r.c45.overshoots} ${f2(r.c65.settle).padStart(6)}/${r.c65.overshoots} `
      + `${f2(r.curve.worst).padStart(6)}  ${r.uturn ? f2(r.uturn.used).padStart(6) : '     -'}  ${f2(r.slalom.min).padStart(7)}  ${f2(r.trail)}  ${f1(r.slip).padStart(6)}`);
  }
  if (rows[0] && rows[0].abuse) {
    out.push('car     abuse slip deg: launch lift brake flick curb rain | handbrake 25 mph: along m, peak deg, recover s, snap rad/s, v m/s rel>2s | delay s');
    for (const r of rows) {
      const a = r.abuse, h = r.hb;
      out.push(`${r.id.padEnd(7)} ${ABUSE.map((k) => f1(a[k]).padStart(5)).join(' ')} | `
        + (h ? `${f1(h.along).padStart(5)} ${f1(h.peak).padStart(5)} ${f2(h.recover).padStart(5)} ${f2(h.snap)} ${f1(h.vRel)}>${f1(h.vEnd)}` : '    - (no handbrake turn)') + ` | ${f2(r.delay)}`);
    }
  }
  return out.join('\n');
}
