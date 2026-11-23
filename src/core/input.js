// One shared input state that every control method (keyboard, touch,
// gamepad) feeds. Game code only ever reads from here.
//
// Axes:    steer (-1 left .. 1 right), throttle (0..1), brake (0..1),
//          handbrake (bool), moveX (-1 left .. 1 right),
//          moveY (-1 back .. 1 forward), sprint (bool), boost (bool,
//          the BOOST button: turbo, surge or afterburner in a craft),
//          pitch (-1..1, flying: stick pushed up the screen = +1)
// Look:    lookX / lookY accumulate camera drag in pixels; the camera
//          reads them and sets them back to 0.
// Buttons: 'enter' (get in/out), 'attack', 'horn', 'camera', 'map',
//          'pause', 'weapon', 'jump', and for combat 'fire' (held =
//          automatic), 'lock' (tap toggles lock-on), 'swap' (next weapon),
//          'reload'; armed craft (docs/ARMS.md) 'fire2' (held, slot 1),
//          'drop' (tap, one bomb), 'detonate' (tap, blow placed charges),
//          'cancel' (cancel a throw being aimed). Use pressed(name) for "was
//          tapped this step" and held(name) for "is down now".
// Keyboard (desktop testing): F/Enter enter, G fire, T lock, X swap,
//          R reload, Z fire2, B drop, V detonate, H horn (police siren).
//
// `steerMode: 'proportional'` is kept for older readers: every steer value
// (player or AI) is now a share of the car's speed-dependent lock.
// `steerShape: true` marks this as the player's input: a car shapes its
// steer by speed (src/entities/vehicle.js shapeSteerBySpeed, task DRIVE:
// small thumb moves give small corrections on the highway, full input is
// still full lock). AI controls do not carry it and are not shaped.
// A source may carry `steerKey` (-1, 0 or 1, the keyboard): poll() ramps
// its steer like the steering buttons, one fixed 1/60 s step per poll.
const STEP = 1 / 60; // the fixed simulation step

export function createInput() {
  const sources = [];
  const heldSet = new Set();
  const pressedSet = new Set();
  const input = {
    steerMode: 'proportional',
    steerShape: true,
    steer: 0, throttle: 0, brake: 0, handbrake: false,
    moveX: 0, moveY: 0, sprint: false, pitch: 0, boost: false,
    lookX: 0, lookY: 0,
    // A source is a plain object with any of the axis fields above.
    addSource(src) {
      sources.push(src);
      return src;
    },
    press(name) {
      if (!heldSet.has(name)) pressedSet.add(name);
      heldSet.add(name);
    },
    release(name) {
      heldSet.delete(name);
    },
    held: (name) => heldSet.has(name),
    pressed: (name) => pressedSet.has(name),
    // Returns true once per tap, then forgets it.
    consume(name) {
      return pressedSet.delete(name);
    },
    // Call once per simulation step before reading axes.
    poll() {
      let steer = 0, throttle = 0, brake = 0, moveX = 0, moveY = 0, pitch = 0;
      let handbrake = false, sprint = false, boost = false;
      for (const s of sources) {
        if (s.steerKey !== undefined) s.steer = rampSteer(s.steer || 0, s.steerKey, STEP);
        if (Math.abs(s.steer || 0) > Math.abs(steer)) steer = s.steer;
        if ((s.throttle || 0) > throttle) throttle = s.throttle;
        if ((s.brake || 0) > brake) brake = s.brake;
        if (Math.abs(s.moveX || 0) > Math.abs(moveX)) moveX = s.moveX;
        if (Math.abs(s.moveY || 0) > Math.abs(moveY)) moveY = s.moveY;
        if (Math.abs(s.pitch || 0) > Math.abs(pitch)) pitch = s.pitch;
        handbrake = handbrake || !!s.handbrake;
        sprint = sprint || !!s.sprint;
        boost = boost || !!s.boost;
      }
      input.steer = steer;
      input.throttle = throttle;
      input.brake = brake;
      input.moveX = moveX;
      input.moveY = moveY;
      input.pitch = pitch;
      input.handbrake = handbrake;
      input.sprint = sprint;
      input.boost = boost;
    },
    // Call once per simulation step after everything has read input.
    endStep() {
      pressedSet.clear();
    },
  };
  return input;
}

// Keyboard controls, mainly for testing on a computer.
export function attachKeyboard(input, target = window) {
  const src = input.addSource({ steer: 0, steerKey: 0, throttle: 0, brake: 0, handbrake: false, moveX: 0, moveY: 0, sprint: false, pitch: 0, boost: false });
  const down = new Set();
  const buttons = { KeyF: 'enter', Enter: 'enter', KeyE: 'attack', KeyH: 'horn', KeyC: 'camera', KeyM: 'map', Escape: 'pause', KeyQ: 'weapon', KeyJ: 'jump',
    // Combat (F stays 'enter'): G fire, T lock-on, X swap, R reload.
    KeyG: 'fire', KeyT: 'lock', KeyX: 'swap', KeyR: 'reload',
    // docs/ARMS.md: craft slot 1, bomb drop, sticky detonate (H horn = police siren).
    KeyZ: 'fire2', KeyB: 'drop', KeyV: 'detonate' };
  const refresh = () => {
    const l = down.has('ArrowLeft') || down.has('KeyA');
    const r = down.has('ArrowRight') || down.has('KeyD');
    const u = down.has('ArrowUp') || down.has('KeyW');
    const d = down.has('ArrowDown') || down.has('KeyS');
    // Both held: target 0, as with the touch buttons.
    src.steerKey = (r ? 1 : 0) - (l ? 1 : 0);
    if (src.steerKey === 0) src.steer = 0;
    src.throttle = u ? 1 : 0;
    src.brake = d ? 1 : 0;
    src.moveX = src.steerKey;
    src.moveY = (u ? 1 : 0) - (d ? 1 : 0);
    src.pitch = (down.has('KeyI') ? 1 : 0) - (down.has('KeyK') ? 1 : 0);
    src.handbrake = down.has('Space');
    src.sprint = down.has('ShiftLeft') || down.has('ShiftRight');
    src.boost = down.has('KeyN') || src.sprint; // BOOST: N, or Shift in a craft
  };
  const onDown = (e) => {
    if (e.repeat) return;
    down.add(e.code);
    if (buttons[e.code]) input.press(buttons[e.code]);
    refresh();
  };
  const onUp = (e) => {
    down.delete(e.code);
    if (buttons[e.code]) input.release(buttons[e.code]);
    refresh();
  };
  // Losing focus with a key held would otherwise leave it stuck down.
  const onBlur = () => {
    for (const code of down) if (buttons[code]) input.release(buttons[code]);
    down.clear();
    refresh();
  };
  target.addEventListener('blur', onBlur);
  target.addEventListener('keydown', onDown);
  target.addEventListener('keyup', onUp);
  return () => {
    target.removeEventListener('keydown', onDown);
    target.removeEventListener('keyup', onUp);
    target.removeEventListener('blur', onBlur);
  };
}

// ---------------------------------------------------------------------
// Steering maths, shared by every steering style (pure functions so they
// run in node tests), docs/REVAMP.md 6.3. Raw input is -1..1 (right
// positive). A style produces a target; the car's lockRate and returnRate
// (src/entities/vehicle.js) are the only rate limit. The two allowed input
// filters are the button ramp and the tilt low-pass below.
export const STEER_STYLES = ['wheel', 'buttons', 'tilt', 'slider'];
export const CURVE_LINEAR = 0.85;
// Travel for full lock at sensitivity 1: wheel degrees, slider CSS px from
// the bar center, tilt degrees of phone roll past the dead zone, buttons
// seconds from center to a full target.
export const STEER_TRAVEL = { wheel: 110, slider: 90, tilt: 22, buttons: 0.3 };
export const WHEEL_CORE_PX = 16; // inside this radius the wheel holds its angle
export const SLIDER_W = 180; // CSS px, the slider bar width
export const TILT_DEAD_DEG = 1.5;
export const TILT_SMOOTH = 0.08; // s, tilt low-pass time constant
export const TILT_WAIT = 1.0; // s without an orientation event before falling back to the wheel
// Older names (touch.js until W4 moves it over): full lock at sensitivity 1.
export const WHEEL_LOCK_DEG = STEER_TRAVEL.wheel;
export const TILT_LOCK_DEG = TILT_DEAD_DEG + STEER_TRAVEL.tilt;

export const clampSensitivity = (s) => (Number.isFinite(s) ? Math.max(0.5, Math.min(1.5, s)) : 1);

const clamp1 = (x) => (x > 1 ? 1 : x < -1 ? -1 : x);

// Raw input x in -1..1 to the steering target in -1..1: odd, strictly
// rising, wheelCurve(0) = 0, wheelCurve(1) = 1, wheelCurve(0.5) = 0.44375,
// slope 0.85 at the center (a gentle curve, nearly linear).
export function wheelCurve(x) {
  const a = clamp1(+x || 0);
  return CURVE_LINEAR * a + (1 - CURVE_LINEAR) * a * a * a;
}

// How much thumb or phone travel is full lock for a style. More
// sensitivity means less travel; sensitivity never changes the curve.
export function steerTravel(style, sensitivity = 1) {
  const t = STEER_TRAVEL[style] || STEER_TRAVEL.wheel;
  return t / clampSensitivity(+sensitivity);
}

export function rawFromTravel(style, travel, sensitivity = 1) {
  return clamp1((+travel || 0) / steerTravel(style, sensitivity));
}

// Thin alias of wheelCurve until touch.js has moved over (sensitivity is
// ignored: it changes travel only).
export function shapeSteer(x) {
  return wheelCurve(x);
}

// Buttons: while one is held (target -1 or 1) the value ramps from where it
// is toward the target over steerTravel('buttons') seconds; on release or
// with both held (target 0) it is 0 at once. Frame-rate independent.
export function rampSteer(cur, target, dt, sensitivity = 1) {
  if (target === 0) return 0;
  if (!(dt > 0)) return cur;
  const step = dt / steerTravel('buttons', sensitivity);
  const t = target > 0 ? 1 : -1;
  const n = cur + t * step;
  if (Math.abs(t - n) < 1e-9) return t; // float dust at the end
  return t > 0 ? Math.min(1, n) : Math.max(-1, n);
}

// Touch wheel tracking (one per control, no allocation per event). The
// thumb's angle about the wheel center is summed from one pointer event to
// the next, starting at 0 where the thumb lands, so a touch never jumps the
// wheel. Inside WHEEL_CORE_PX of the center the sum holds and tracking is
// kept; the first point outside the core again starts a fresh angle. The
// sum is clamped to full lock, so winding past it does not need unwinding.
export function createWheelTracker() {
  const w = {
    cx: 0, cy: 0, last: 0, have: false, active: false, deg: 0, sensitivity: 1,
    // Thumb down at (x, y) on a wheel centered at (cx, cy).
    down(x, y, cx, cy, sensitivity = 1) {
      w.cx = cx; w.cy = cy; w.deg = 0; w.have = false; w.active = true;
      w.sensitivity = clampSensitivity(+sensitivity);
      w.move(x, y);
      return w.raw();
    },
    move(x, y) {
      if (!w.active) return 0;
      const dx = x - w.cx, dy = y - w.cy;
      if (dx * dx + dy * dy < WHEEL_CORE_PX * WHEEL_CORE_PX) {
        w.have = false;
        return w.raw();
      }
      // Screen y grows downward, so atan2 grows clockwise: right turn positive.
      const a = Math.atan2(dy, dx);
      if (w.have) {
        const lim = steerTravel('wheel', w.sensitivity);
        const d = w.deg + angleDelta(a, w.last) * 180 / Math.PI;
        w.deg = d > lim ? lim : d < -lim ? -lim : d;
      }
      w.last = a;
      w.have = true;
      return w.raw();
    },
    up() {
      w.active = false;
      w.have = false;
      w.deg = 0;
      return 0;
    },
    raw: () => (w.active ? rawFromTravel('wheel', w.deg, w.sensitivity) : 0),
    target: () => wheelCurve(w.raw()),
  };
  return w;
}

// Slider: absolute, raw from the pointer's distance to the bar center (the
// pointer is tracked by id until it lifts, even off the bar).
export function sliderRaw(pointerX, centerX, sensitivity = 1) {
  return rawFromTravel('slider', (+pointerX || 0) - (+centerX || 0), sensitivity);
}

// Shortest signed difference a - b of two angles in radians.
export function angleDelta(a, b) {
  let d = a - b;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

// How far the phone is turned like a steering wheel, in degrees (right
// positive), from DeviceOrientation beta/gamma (degrees) and the screen
// orientation angle (0, 90, 180, 270). Works for both landscapes.
export function tiltAngle(beta, gamma, screenAngle = 90) {
  const b = (+beta || 0) * Math.PI / 180, g = (+gamma || 0) * Math.PI / 180;
  // Gravity in device coordinates.
  const dx = Math.cos(b) * Math.sin(g), dy = -Math.sin(b);
  let sx, sy; // gravity in screen coordinates (x right, y down)
  const ang = ((Math.round((+screenAngle || 0) / 90) * 90) % 360 + 360) % 360;
  if (ang === 90) { sx = -dy; sy = -dx; } else if (ang === 270) { sx = dy; sy = dx; } else if (ang === 180) { sx = -dx; sy = dy; } else { sx = dx; sy = -dy; }
  if (Math.hypot(sx, sy) < 0.08) return 0; // lying flat: no usable tilt
  return Math.atan2(sx, sy) * 180 / Math.PI;
}

// Tilt degrees (from tiltAngle, right positive) to a raw steer value:
// a 1.5 degree dead zone, then steerTravel('tilt') degrees to full lock.
export function tiltToSteer(deg, sensitivity = 1) {
  const a = Math.abs(+deg || 0);
  if (a <= TILT_DEAD_DEG) return 0;
  const v = Math.min(1, (a - TILT_DEAD_DEG) / steerTravel('tilt', sensitivity));
  return deg < 0 ? -v : v;
}

// The one tilt filter: a low-pass with a TILT_SMOOTH time constant.
export function tiltFilter(cur, target, dt) {
  if (!(dt > 0)) return cur;
  return cur + (target - cur) * (1 - Math.exp(-dt / TILT_SMOOTH));
}

// Tilt fallback: true when the wheel should stand in for this run (no
// orientation event within TILT_WAIT seconds of choosing tilt, or the
// permission was refused). The saved setting stays tilt.
export function tiltFallback(sinceChosen, gotEvent, refused = false) {
  if (refused) return true;
  return !gotEvent && sinceChosen >= TILT_WAIT;
}
