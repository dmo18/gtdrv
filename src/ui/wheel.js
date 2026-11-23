// Weapon wheel maths. Pure: no DOM, no three.js. touch.js draws it.
// Hold SWAP about a quarter of a second, drag to a slice, lift to choose.
// Slice 0 is straight up; slices run clockwise. Screen y points down.

export const HOLD_MS = 250; // a press this long (or longer) is a hold, not a tap
export const DEAD_PX = 24; // inside this radius: no change
export const RING_PX = 108; // drawn outer radius of the ring
export const CANCEL_PX = 128; // dragged farther than this: lifting cancels
export const WHEEL_KEEP = -1; // dead zone
export const WHEEL_CANCEL = -2; // past the outer ring

// Tap or hold, from how long the finger has been down (ms).
export const isHold = (ms) => ms >= HOLD_MS;

// Slice for a drag offset (dx, dy) from the ring center, n slices.
// Returns 0..n-1, WHEEL_KEEP in the dead zone, WHEEL_CANCEL past the ring.
export function wheelIndex(dx, dy, n, dead = DEAD_PX, cancel = CANCEL_PX) {
  if (!(n > 0) || !Number.isFinite(dx) || !Number.isFinite(dy)) return WHEEL_KEEP;
  const d2 = dx * dx + dy * dy;
  if (d2 <= dead * dead) return WHEEL_KEEP;
  if (d2 > cancel * cancel) return WHEEL_CANCEL;
  const step = (Math.PI * 2) / n;
  let a = Math.atan2(dx, -dy); // 0 = up, clockwise positive
  if (a < 0) a += Math.PI * 2;
  return Math.floor((a + step / 2) / step) % n;
}

// Place the ring: wanted center (cx, cy), radius r, screen w x h, and
// rectangles to keep clear of (FIRE, pause): { l, t, r, b } each.
// Writes the result into out.x / out.y and returns out.
export function placeWheel(cx, cy, r, w, h, rects, out, margin = 6) {
  const lim = r + margin;
  const fit = () => {
    out.x = w > 2 * lim ? Math.min(w - lim, Math.max(lim, out.x)) : w / 2;
    out.y = h > 2 * lim ? Math.min(h - lim, Math.max(lim, out.y)) : h / 2;
  };
  out.x = cx;
  out.y = cy;
  fit();
  for (let i = 0; i < rects.length; i++) {
    const q = rects[i];
    const nx = Math.min(q.r, Math.max(q.l, out.x));
    const ny = Math.min(q.b, Math.max(q.t, out.y));
    const dx = out.x - nx, dy = out.y - ny;
    if (dx * dx + dy * dy >= lim * lim) continue;
    // Slide sideways, away from the rectangle, until the circle clears it.
    const hx = Math.sqrt(Math.max(0, lim * lim - dy * dy));
    out.x = out.x < (q.l + q.r) / 2 ? q.l - hx : q.r + hx;
  }
  fit();
  return out;
}

// ---------------------------------------------------------------------------
// Touch steering maths for the wheel style (0.10.1, docs/UI.md "Steering
// styles"). Pure: no DOM. The wheel is a RELATIVE control: the input is built
// from how the thumb moves after it touches down, never from where it is, so
// touching down anywhere gives no steer. Each move adds the larger of two
// measures of that move:
//   - horizontal travel: DRAG_FULL_PX of travel is full input at sensitivity 1;
//   - rotation about the drawn wheel's center (outside ROT_CORE_PX of it):
//     ROT_FULL_DEG of rotation is full input.
// Rotation only counts when it turns the same way as the horizontal travel,
// or when the move is mostly up or down (dragging down the right side of the
// wheel turns right). A thumb below the center that slides right therefore
// steers right, never left, and crossing the center never jumps. The sum is
// clamped to full input, so turning back answers at once.
// ---------------------------------------------------------------------------
export const DRAG_FULL_PX = 55;
export const ROT_FULL_DEG = 60;
export const ROT_CORE_PX = 40;
export const WHEEL_SHOW_DEG = 100; // the drawn wheel's angle at full input

const sens = (s) => (Number.isFinite(s) ? Math.max(0.5, Math.min(1.5, s)) : 1);
const clamp1 = (v) => (v > 1 ? 1 : v < -1 ? -1 : v);

// The steering change of one move: horizontal travel dx (px, right +), the
// rotation about the wheel center rotDeg (clockwise +), the vertical travel
// dy (px), at a sensitivity. In -2..2 (the caller clamps the sum).
export function dragSteer(dx, rotDeg, dy = 0, sensitivity = 1) {
  const s = sens(sensitivity);
  const h = (+dx || 0) * s / DRAG_FULL_PX;
  const r = (+rotDeg || 0) * s / ROT_FULL_DEG;
  if (Math.abs(r) > Math.abs(h)) {
    const agree = h !== 0 && (r > 0) === (h > 0);
    const vertical = Math.abs(dx) * 2 <= Math.abs(dy);
    if (agree || vertical) return r;
  }
  return h;
}

// Shortest signed difference of two angles (radians).
function angDiff(a, b) {
  let d = a - b;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

// One tracker per steering finger. Allocation free after creation.
export function createDragSteer() {
  const t = {
    x: 0, y: 0, cx: 0, cy: 0, last: 0, have: false, raw: 0, active: false,
    // Finger down at (x, y); the drawn wheel's center is (cx, cy). No steer yet.
    down(x, y, cx, cy) {
      t.x = x; t.y = y; t.cx = cx; t.cy = cy;
      t.raw = 0; t.active = true;
      t.have = t.angle(x, y);
      return 0;
    },
    // Angle of (x, y) about the center into t.last; false inside the core.
    angle(x, y) {
      const dx = x - t.cx, dy = y - t.cy;
      if (dx * dx + dy * dy < ROT_CORE_PX * ROT_CORE_PX) return false;
      t.last = Math.atan2(dy, dx); // screen y grows down: clockwise is +
      return true;
    },
    // The finger moved to (x, y): returns the raw steer -1..1.
    move(x, y, sensitivity = 1) {
      if (!t.active) return 0;
      const prev = t.last, had = t.have;
      t.have = t.angle(x, y);
      const rot = had && t.have ? angDiff(t.last, prev) * 180 / Math.PI : 0;
      t.raw = clamp1(t.raw + dragSteer(x - t.x, rot, y - t.y, sensitivity));
      t.x = x; t.y = y;
      return t.raw;
    },
    up() { t.active = false; t.have = false; t.raw = 0; return 0; },
  };
  return t;
}

// Weapons the drive-by can use (a car or boat): the ones marked driveBy.
export function driveWeapons(weapons, ids, out = []) {
  out.length = 0;
  for (let i = 0; i < ids.length; i++) if (weapons[ids[i]] && weapons[ids[i]].driveBy) out.push(ids[i]);
  return out;
}

// The next weapon in a list after `cur` (wraps; the first when cur is not in it).
export function nextInList(list, cur) {
  if (!list.length) return null;
  const i = list.indexOf(cur);
  return list[(i + 1) % list.length];
}
