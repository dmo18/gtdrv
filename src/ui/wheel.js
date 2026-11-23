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
