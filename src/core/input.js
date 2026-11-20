// One shared input state that every control method (keyboard, touch,
// gamepad) feeds. Game code only ever reads from here.
//
// Axes:    steer (-1 left .. 1 right), throttle (0..1), brake (0..1),
//          handbrake (bool), moveX (-1 left .. 1 right),
//          moveY (-1 back .. 1 forward), sprint (bool),
//          pitch (-1..1, flying: stick pushed up the screen = +1)
// Look:    lookX / lookY accumulate camera drag in pixels; the camera
//          reads them and sets them back to 0.
// Buttons: 'enter' (get in/out), 'attack', 'horn', 'camera', 'map',
//          'pause', 'weapon', 'jump', and for combat 'fire' (held =
//          automatic), 'lock' (tap toggles lock-on), 'swap' (next weapon),
//          'reload'. Use pressed(name) for "was tapped this step" and
//          held(name) for "is down now".
// Keyboard (desktop testing): F/Enter enter, G fire, T lock, X swap,
//          R reload.
//
// `steerMode: 'proportional'` tells stepVehicle that steer is a share of
// the speed-dependent lock (the player); AI controls leave it out.
export function createInput() {
  const sources = [];
  const heldSet = new Set();
  const pressedSet = new Set();
  const input = {
    steerMode: 'proportional',
    steer: 0, throttle: 0, brake: 0, handbrake: false,
    moveX: 0, moveY: 0, sprint: false, pitch: 0,
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
      let handbrake = false, sprint = false;
      for (const s of sources) {
        if (Math.abs(s.steer || 0) > Math.abs(steer)) steer = s.steer;
        if ((s.throttle || 0) > throttle) throttle = s.throttle;
        if ((s.brake || 0) > brake) brake = s.brake;
        if (Math.abs(s.moveX || 0) > Math.abs(moveX)) moveX = s.moveX;
        if (Math.abs(s.moveY || 0) > Math.abs(moveY)) moveY = s.moveY;
        if (Math.abs(s.pitch || 0) > Math.abs(pitch)) pitch = s.pitch;
        handbrake = handbrake || !!s.handbrake;
        sprint = sprint || !!s.sprint;
      }
      input.steer = steer;
      input.throttle = throttle;
      input.brake = brake;
      input.moveX = moveX;
      input.moveY = moveY;
      input.pitch = pitch;
      input.handbrake = handbrake;
      input.sprint = sprint;
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
  const src = input.addSource({ steer: 0, throttle: 0, brake: 0, handbrake: false, moveX: 0, moveY: 0, sprint: false, pitch: 0 });
  const down = new Set();
  const buttons = { KeyF: 'enter', Enter: 'enter', KeyE: 'attack', KeyH: 'horn', KeyC: 'camera', KeyM: 'map', Escape: 'pause', KeyQ: 'weapon', KeyJ: 'jump',
    // Combat (F stays 'enter'): G fire, T lock-on, X swap, R reload.
    KeyG: 'fire', KeyT: 'lock', KeyX: 'swap', KeyR: 'reload' };
  const refresh = () => {
    const l = down.has('ArrowLeft') || down.has('KeyA');
    const r = down.has('ArrowRight') || down.has('KeyD');
    const u = down.has('ArrowUp') || down.has('KeyW');
    const d = down.has('ArrowDown') || down.has('KeyS');
    src.steer = (r ? 1 : 0) - (l ? 1 : 0);
    src.throttle = u ? 1 : 0;
    src.brake = d ? 1 : 0;
    src.moveX = src.steer;
    src.moveY = (u ? 1 : 0) - (d ? 1 : 0);
    src.pitch = (down.has('KeyI') ? 1 : 0) - (down.has('KeyK') ? 1 : 0);
    src.handbrake = down.has('Space');
    src.sprint = down.has('ShiftLeft') || down.has('ShiftRight');
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
// Touch steering maths, shared by every steering style (pure functions so
// they run in node tests). Raw input is -1..1 (right positive).
export const STEER_STYLES = ['wheel', 'buttons', 'tilt', 'slider'];
export const WHEEL_LOCK_DEG = 120; // on-screen wheel turned this far = full lock
export const TILT_LOCK_DEG = 25; // phone tilted this far = full lock
export const TILT_DEAD_DEG = 1.5;
export const BUTTON_RAMP_UP = 0.25; // s from centre to full lock while held
export const BUTTON_RAMP_DOWN = 0.15; // s from full lock back to centre

export const clampSensitivity = (s) => (Number.isFinite(s) ? Math.max(0.5, Math.min(1.5, s)) : 1);

// The one response curve: fine control near the centre, full lock at the
// end. Lower sensitivity = more curve (finer near centre); higher = less
// curve and a little extra gain, so full lock comes before the end.
export function shapeSteer(x, sensitivity = 1) {
  const sens = clampSensitivity(sensitivity);
  const a = Math.min(1, Math.abs(+x || 0));
  if (a === 0) return 0;
  const e = 1 + 0.6 / sens; // 1.6 at the default, 2.2 at 0.5, 1.4 at 1.5
  const gain = 1 + Math.max(0, sens - 1) * 0.5; // 1 .. 1.25: full lock is always reachable
  const y = Math.min(1, gain * Math.pow(a, e));
  return x < 0 ? -y : y;
}

// Frame-rate independent ramp toward target (-1, 0 or 1): reaches full
// lock in `up` seconds and comes back to centre in `down` seconds.
export function rampSteer(cur, target, dt, up = BUTTON_RAMP_UP, down = BUTTON_RAMP_DOWN) {
  if (!(dt > 0)) return cur;
  const toward = target !== 0 && (cur === 0 || Math.sign(cur) === Math.sign(target));
  if (toward) {
    const n = cur + Math.sign(target) * dt / up;
    if (Math.abs(target - n) < 1e-6) return target; // float dust at the end
    return target > 0 ? Math.min(target, n) : Math.max(target, n);
  }
  const step = dt / down;
  if (Math.abs(cur) <= step + 1e-6) return 0;
  return cur > 0 ? cur - step : cur + step;
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

// Tilt degrees to a raw steer value, with a small dead zone.
export function tiltToSteer(deg, lock = TILT_LOCK_DEG, dead = TILT_DEAD_DEG) {
  const a = Math.abs(+deg || 0);
  if (a <= dead) return 0;
  const v = Math.min(1, (a - dead) / (lock - dead));
  return deg < 0 ? -v : v;
}
