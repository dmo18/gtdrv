// On-screen touch controls. Feeds one source on the shared input object.
// Every control tracks its own pointerId so several fingers work at once.
//
// HUD modes (setHudMode, settings.hud): 'minimal' (default) keeps the
// primary controls on screen (steering, pedals/thrust, FIRE, LOCK, ENTER,
// EXIT, pause), draws them a little smaller and dimmer while untouched, and
// folds the secondary ones (VIEW, HORN, HAND, SWAP, RELOAD, RUN, MAP) into
// one round "more" button that fans them out for a few seconds. 'full'
// shows everything un-collapsed. docs/UI.md has the layout rules.
//
// Extension point, see registerAction() below and docs/UI.md:
//   const h = touch.registerAction({ id: 'grenade', label: 'Throw grenade',
//     icon: '<path d="..."/>' (24x24 line art) | a built-in icon name,
//     text: 'NADE', group: 'primary' | 'secondary', modes: ['foot'],
//     slot: 'gun' (optional: a fixed arc slot from styles.js instead of the
//     extra-primary stack), press() {}, release() {}, visible() { return true; } });
//   h.remove();
// Modes: foot car boat plane heli tank. Armed-craft buttons are registered
// by src/ui/armsctl.js (docs/ARMS.md "Touch in armed aircraft").
//
// Car and boat steering comes in four styles (setSteering):
//   wheel   an on-screen steering wheel turned by the thumb (default)
//   buttons two arrow pads; holding ramps toward full lock
//   tilt    turn the phone like a wheel (DeviceOrientation)
//   slider  a wide floating horizontal pad
// All of them go through shapeSteer() (src/core/input.js), which applies
// the sensitivity and the response curve. Buttons and tilt are smoothed in
// update(dt), which the game calls once per simulation step.
import { injectStyles } from './styles.js';
import {
  wheelCurve, steerTravel, rampSteer, angleDelta, tiltAngle, tiltToSteer, tiltFilter, sliderRaw,
  clampSensitivity, STEER_STYLES, TILT_WAIT, WHEEL_CORE_PX,
} from '../core/input.js';
import { WEAPONS, WEAPON_IDS } from '../core/weapons.js';
import { HOLD_MS, RING_PX, WHEEL_KEEP, WHEEL_CANCEL, wheelIndex, placeWheel } from './wheel.js';

const STICK_RANGE = 56; // px of drag for full stick
const STICK_DEAD = 0.1;
const SPRINT_AT = 0.85;
const PAD_H = 56; // the slider pad is the steering slot wide (160, or 140 at 780x360; docs/REVAMP.md 6.5)
const PAD_KNOB_RANGE = 56; // px of knob travel drawn inside the pad
const STICK_W = 128;
const TILT_WAIT_MS = TILT_WAIT * 1000; // no orientation events by then: no sensor

// Hand-drawn 24x24 line icons.
const ICONS = {
  boost: '<path d="M13 3L5 13h6l-1 8 8-11h-6z"/>',
  handbrake: '<path d="M5 19l9-11"/><circle cx="16" cy="6" r="2.5"/><path d="M4 21h9"/>',
  horn: '<path d="M4 9h4l6-4v14l-6-4H4z"/><path d="M17 9c1.6 1.6 1.6 4.4 0 6"/>',
  exit: '<path d="M10 4H5v16h5"/><path d="M9 12h11M16 8l4 4-4 4"/>',
  camera: '<rect x="3" y="7" width="18" height="12" rx="3"/><circle cx="12" cy="13" r="3.4"/><path d="M9 7l1.5-2h3L15 7"/>',
  enter: '<path d="M3 16v-4l2-5h12l3 5v4z"/><circle cx="7.5" cy="17" r="1.6"/><circle cx="15.5" cy="17" r="1.6"/>',
  run: '<circle cx="14" cy="5" r="2"/><path d="M6 21l4-6 3 2 3-6-3-2-3 3-3-1M13 10l4 2 3-1"/>',
  down: '<path d="M6 9l6 6 6-6"/><path d="M6 4l6 6 6-6"/>',
  pause: '<path d="M8 5v14M16 5v14"/>',
  map: '<path d="M3 6l6-2 6 2 6-2v14l-6 2-6-2-6 2z"/><path d="M9 4v14M15 6v14"/>',
  radio: '<rect x="3" y="9" width="18" height="11" rx="2"/><path d="M7 9l10-5"/><circle cx="8.5" cy="14.5" r="2.2"/><path d="M14 13h4M14 16.5h4"/>',
  gas: '<path d="M6 15l6-6 6 6"/><path d="M6 20l6-6 6 6"/>',
  brake: '<rect x="6" y="6" width="12" height="12" rx="2"/>',
  left: '<path d="M15 5l-7 7 7 7"/><path d="M20 5l-7 7 7 7" opacity="0.5"/>',
  right: '<path d="M9 5l7 7-7 7"/><path d="M4 5l7 7-7 7" opacity="0.5"/>',
  fire: '<circle cx="12" cy="12" r="7"/><path d="M12 2v5M12 17v5M2 12h5M17 12h5"/><circle cx="12" cy="12" r="1.2"/>',
  lock: '<path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5"/><circle cx="12" cy="12" r="3"/>',
  swap: '<path d="M4 8h13l-3-3M20 16H7l3 3"/>',
  reload: '<path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 4v7h-7"/>',
  respawn: '<circle cx="12" cy="7" r="2.4"/><path d="M8 20v-5a4 4 0 0 1 8 0v5"/><path d="M4 11a8 8 0 0 1 3-6M20 11a8 8 0 0 0-3-6" opacity="0.6"/>',
  more: '<circle cx="6" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="18" cy="12" r="1.6"/>',
  // Armed craft (original line drawings).
  gun: '<path d="M3 10h12l2-2h4v8h-4l-2-2H3z"/><path d="M6 14v3M10 14v3"/>',
  missile: '<path d="M4 18l9-9 4-1-1 4-9 9z"/><path d="M6 14l-3 1 2 2M10 18l-1 3-2-2M17 4l3 3"/>',
  bomb: '<path d="M12 3v3"/><path d="M8 6h8l1 3v5a5 5 0 0 1-10 0V9z"/><path d="M9 21l3-2 3 2"/>',
  detonate: '<rect x="5" y="9" width="14" height="11" rx="2"/><path d="M9 9V6h6v3M12 4V2M8 14h8"/>',
  siren: '<path d="M7 18v-6a5 5 0 0 1 10 0v6"/><path d="M5 18h14v3H5zM12 3v2M4 7l1.5 1M20 7l-1.5 1"/>',
  extra: '<path d="M12 3c3 4 5 6.5 5 10a5 5 0 0 1-10 0c0-2 1-3.6 2-5 .6 1.2 1.2 1.8 2 2 .6-2.4 0-4.6 1-7z"/>',
  cannon: '<circle cx="8" cy="15" r="5"/><path d="M11 12l9-6M12 14l9-5"/>',
};
const FAN_MS = 4000; // the fan folds away this long after the last use
const FAN_ROWS = 2; // fan items per column; at most 3 columns (6 items)
const LOW_AMMO = 0.25; // show the reload chip at or below this magazine fraction
// Weapon icons (24x24, original line drawings).
export const WEAPON_ICONS = {
  wrench: '<path d="M14.5 4.5a4 4 0 0 0-4.8 5.3L4 15.5 6.5 18l5.7-5.7a4 4 0 0 0 5.3-4.8l-2.4 2.4-2.3-.5-.5-2.3z"/>',
  pistol: '<path d="M3 8h17v4h-8l-1 2h-3l-1 5H4l1-7H3z"/><path d="M12 12v-1"/>',
  smg: '<path d="M2 9h19v3h-6v2h-3l-1 5H8l1-5H6l-1-2H2z"/><path d="M14 14l1 4h-2"/>',
  scatter: '<path d="M2 10h14l5-1v4l-5-1H8l-2 6H3l2-6H2z"/><path d="M10 10v2"/>',
  lobber: '<rect x="3" y="9" width="15" height="5" rx="2"/><path d="M18 10l3-1v5l-3-1M7 14v4M12 14v3"/>',
  fizz: '<rect x="7" y="7" width="10" height="13" rx="2"/><path d="M9 7V5h6v2M10 4l1-2M7 11h10"/>',
  sticky: '<path d="M6 12a6 6 0 0 1 12 0v5H6z"/><path d="M4 17h16M9 12h6M12 6V3"/><circle cx="12" cy="3" r="1"/>',
};

// The steering wheel: an original three-spoke design drawn here.
const WHEEL_SVG = '<svg viewBox="0 0 150 150" aria-hidden="true">'
  + '<circle cx="75" cy="75" r="64" class="rw-w-rim"/>'
  + '<path d="M26 52 A56 56 0 0 1 52 26" class="rw-w-grip"/>'
  + '<path d="M98 26 A56 56 0 0 1 124 52" class="rw-w-grip"/>'
  + '<path d="M19 82 L57 78 L75 90 L93 78 L131 82" class="rw-w-spoke"/>'
  + '<path d="M75 90 L75 131" class="rw-w-spoke"/>'
  + '<circle cx="75" cy="78" r="17" class="rw-w-hub"/>'
  + '<path d="M67 76 l8 -7 l8 7" class="rw-w-mark"/>'
  + '<rect x="70" y="5" width="10" height="16" rx="3" class="rw-w-top"/>'
  + '</svg>';

function svg(name) {
  const body = Object.prototype.hasOwnProperty.call(ICONS, name) ? ICONS[name] : ''; // never write an unknown name as markup
  return `<svg viewBox="0 0 24 24" aria-hidden="true">${body}</svg>`;
}

function el(tag, cls, parent) {
  const e = document.createElement(tag);
  e.className = cls;
  if (parent) parent.appendChild(e);
  return e;
}

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

// opts.onSteerFallback(style, reason): tilt was asked for but cannot work
// (no sensor, permission denied); the controls have switched to 'wheel'.
export function createTouchControls(root, input, opts = {}) {
  injectStyles();
  if (getComputedStyle(root).position === 'static') root.style.position = 'relative';

  const src = input.addSource({
    steer: 0, throttle: 0, brake: 0, handbrake: false,
    moveX: 0, moveY: 0, sprint: false, pitch: 0, boost: false,
  });
  const layer = el('div', 'rw-touch rw-mode-car rw-steer-wheel', root);
  const MODES = ['foot', 'car', 'boat', 'plane', 'heli', 'tank'];
  // Gated elements show only in the modes listed by their rw-m-* classes.
  const gate = (b, ...modes) => { b.classList.add('rw-gated', ...modes.map((m) => 'rw-m-' + m)); return b; };
  const cleanups = []; // functions run on releaseAll()
  const listeners = [];

  function on(target, type, fn, o) {
    target.addEventListener(type, fn, o);
    listeners.push([target, type, fn, o]);
  }

  // Generic tracker: one pointer per control, with capture.
  // handlers: { down(e), move(e), up() }
  function track(target, handlers) {
    let id = null;
    const end = (e) => {
      if (id === null) return;
      id = null;
      handlers.up(e);
    };
    cleanups.push(end);
    on(target, 'pointerdown', (e) => {
      if (id !== null) return;
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      e.preventDefault();
      id = e.pointerId;
      try { target.setPointerCapture(id); } catch { /* pointer already gone */ }
      handlers.down(e);
    });
    on(target, 'pointermove', (e) => {
      if (e.pointerId !== id) return;
      e.preventDefault();
      handlers.move(e);
    });
    const finish = (e) => { if (e.pointerId === id) end(e); };
    on(target, 'pointerup', finish);
    on(target, 'pointercancel', finish);
    on(target, 'lostpointercapture', finish);
  }

  function vibrate() {
    if (navigator.vibrate) navigator.vibrate(8);
  }

  // A round/pedal button. onDown/onUp do the actual input work.
  function makeButton(cls, label, icon, text, onDown, onUp, buzz = true, hooks = null) {
    const b = el('button', 'rw-btn ' + cls, layer);
    b.type = 'button';
    b.tabIndex = -1;
    b.setAttribute('aria-label', label);
    // The button box is the hit area and never changes size; the face
    // inside is what shrinks and dims while idle.
    const f = el('span', 'rw-face', b);
    f.innerHTML = (icon ? svg(icon) : '') + (text ? `<span>${text}</span>` : '');
    track(b, {
      down(e) { b.classList.add('rw-down'); if (buzz) vibrate(); onDown(e); },
      move(e) { if (hooks && hooks.move) hooks.move(e); },
      up(e) { b.classList.remove('rw-down'); onUp(e); },
    });
    return b;
  }

  // A button that maps to a named input button.
  function nameButton(cls, label, icon, text, name) {
    return makeButton(cls, label, icon, text, () => input.press(name), () => input.release(name));
  }

  // ----- state -----
  let mode = 'car';
  let style = 'wheel';
  let sensitivity = 1;
  let leftHanded = false;
  let raw = 0; // raw steering -1..1 before the response curve
  const steerMode = () => mode === 'car' || mode === 'boat';
  const setRaw = (x) => {
    raw = clamp(x, -1, 1);
    src.steer = steerMode() ? wheelCurve(raw) : 0; // sensitivity changes the travel, not the curve (docs/REVAMP.md 6.3)
  };

  // ----- camera drag (60% of the screen away from the stick, under the buttons) -----
  const look = el('div', 'rw-zone rw-look', layer);
  const lastLook = { x: 0, y: 0 };
  track(look, {
    down(e) { lastLook.x = e.clientX; lastLook.y = e.clientY; },
    move(e) {
      input.lookX += e.clientX - lastLook.x;
      input.lookY += e.clientY - lastLook.y;
      lastLook.x = e.clientX;
      lastLook.y = e.clientY;
    },
    up() {},
  });

  // ----- steering / stick zone: mode and style decide what it does -----
  const zone = el('div', 'rw-zone rw-stickzone', layer);
  const pad = gate(el('div', 'rw-pad rw-st-slider', layer), 'car', 'boat');
  const padKnob = el('div', 'rw-knob', pad);
  const wheel = gate(el('div', 'rw-wheel rw-st-wheel', layer), 'car', 'boat');
  const wheelRot = el('div', 'rw-wheel-rot', wheel);
  wheelRot.innerHTML = WHEEL_SVG;
  const stick = gate(el('div', 'rw-stick', layer), 'foot', 'plane', 'heli', 'tank');
  const stickKnob = el('div', 'rw-knob', stick);
  const origin = { x: 0, y: 0 };
  // Wheel tracking: center, last touch angle, accumulated wheel angle (deg).
  const wh = { cx: 0, cy: 0, last: 0, angle: 0, have: false };

  // The inset in px. The custom property holds an unevaluated max(env(...)),
  // so a probe element resolves it.
  const insetProbe = el('div', 'rw-inset-probe', layer);
  insetProbe.style.cssText = 'position:absolute;visibility:hidden;pointer-events:none;width:0;height:0';
  function safeInset(name) {
    insetProbe.style.paddingLeft = `var(${name})`;
    return parseFloat(getComputedStyle(insetProbe).paddingLeft) || 0;
  }
  // Rest positions (bottom corner) so the control is visible before touching.
  const slotSize = (r) => (r.height < 380 ? 140 : 160);
  function restPosition() {
    const r = root.getBoundingClientRect();
    const slider = steerMode();
    // The steering slot (docs/REVAMP.md 6.5): 160 square at 915x412, 140 at 780x360.
    const slot = slotSize(r);
    const gap = r.height < 380 ? 16 : 12;
    const h = slider ? PAD_H : STICK_W;
    const y = r.bottom - safeInset('--rw-sb') - gap - (slider ? h / 2 : slot / 2);
    if (leftHanded) return { x: r.right - safeInset('--rw-sr') - 16 - slot / 2, y };
    return { x: r.left + safeInset('--rw-sl') + 16 + slot / 2, y };
  }
  function placeBase(base, cx, cy) {
    const r = root.getBoundingClientRect();
    const w = base === pad ? slotSize(r) : STICK_W;
    const h = base === pad ? PAD_H : STICK_W;
    base.style.transform = `translate(${Math.round(cx - r.left - w / 2)}px, ${Math.round(cy - r.top - h / 2)}px)`;
  }
  function placeRest() {
    const p = restPosition();
    placeBase(steerMode() ? pad : stick, p.x, p.y);
  }

  function setWheelAngle(deg, spring) {
    const lock = steerTravel('wheel', sensitivity);
    wh.angle = clamp(deg, -lock, lock);
    wheel.classList.toggle('rw-spring', !!spring);
    wheelRot.style.transform = wh.angle ? `rotate(${wh.angle.toFixed(1)}deg)` : '';
  }
  function wheelPoint(e) {
    const dx = e.clientX - wh.cx, dy = e.clientY - wh.cy;
    if (dx * dx + dy * dy < WHEEL_CORE_PX * WHEEL_CORE_PX) return false;
    // Screen y grows downward, so atan2 grows clockwise: right turn positive.
    const a = Math.atan2(dy, dx);
    if (wh.have) {
      setWheelAngle(wh.angle + angleDelta(a, wh.last) * 180 / Math.PI, false);
      setRaw(wh.angle / steerTravel('wheel', sensitivity));
    }
    wh.last = a;
    wh.have = true;
    return true;
  }

  track(zone, {
    down(e) {
      maybeAskTilt();
      if (steerMode()) {
        if (style === 'tilt') {
          // A touch in the steering zone re-centers tilt (the bar is a display).
          tilt.zero += tilt.smooth;
          tilt.smooth = 0;
          vibrate();
        } else if (style === 'wheel') {
          const b = wheel.getBoundingClientRect();
          wh.cx = b.left + b.width / 2;
          wh.cy = b.top + b.height / 2;
          wh.have = false;
          wheel.classList.add('rw-active');
          setWheelAngle(wh.angle, false);
          wheelPoint(e);
        } else if (style === 'slider') {
          // Absolute: the bar stays in the steering slot and where the thumb
          // lands is the value (docs/REVAMP.md 6.3).
          const b = pad.getBoundingClientRect();
          origin.x = b.left + b.width / 2;
          pad.classList.add('rw-active');
          applySlider(e.clientX);
        }
        return;
      }
      const r = root.getBoundingClientRect();
      origin.x = e.clientX;
      origin.y = e.clientY;
      const half = STICK_W / 2;
      const zl = leftHanded ? r.left + r.width * 0.6 : r.left;
      const zr = leftHanded ? r.right : r.left + r.width * 0.4;
      placeBase(stick,
        clamp(e.clientX, zl + half + 6, zr - half - 6),
        clamp(e.clientY, r.top + half + 6, r.bottom - half - 6));
      stick.classList.add('rw-active');
      applyStick(e.clientX, e.clientY);
    },
    move(e) {
      if (steerMode()) {
        if (style === 'wheel') wheelPoint(e);
        else if (style === 'slider') applySlider(e.clientX);
        return;
      }
      applyStick(e.clientX, e.clientY);
    },
    up() {
      if (style === 'wheel' || style === 'slider') setRaw(0);
      src.moveX = 0; src.moveY = 0; src.sprint = false; src.pitch = 0;
      if (!steerMode()) src.steer = 0;
      if (mode === 'tank') { src.throttle = 0; src.brake = 0; }
      wh.have = false;
      wheel.classList.remove('rw-active');
      setWheelAngle(0, true);
      padKnob.style.transform = '';
      stickKnob.style.transform = '';
      pad.classList.remove('rw-active');
      stick.classList.remove('rw-active', 'rw-sprint');
      placeRest();
    },
  });

  function applySlider(x) {
    const v = sliderRaw(x, origin.x, sensitivity);
    setRaw(v);
    padKnob.style.transform = `translateX(${(v * PAD_KNOB_RANGE).toFixed(1)}px)`;
  }

  function applyStick(x, y) {
    const dx = x - origin.x;
    const dy = y - origin.y;
    const rawMag = Math.hypot(dx, dy) / STICK_RANGE;
    const k = rawMag > 1 ? 1 / rawMag : 1; // clamp vector to the unit circle
    const nx = dx / STICK_RANGE * k;
    const ny = dy / STICK_RANGE * k;
    const mag = Math.min(rawMag, 1);
    const live = mag >= STICK_DEAD;
    if (mode === 'foot') {
      src.moveX = live ? nx : 0;
      src.moveY = live ? -ny : 0; // screen y grows downward; up is forward
      src.sprint = rawMag > SPRINT_AT;
      stick.classList.toggle('rw-sprint', src.sprint);
    } else if (mode === 'tank') {
      // Twin-stick tank (docs/ARMS.md section 3): up = forward demand,
      // down = brake then reverse, sideways = turn (pivot when |y| < 0.2).
      const fy = live ? -ny : 0;
      src.throttle = fy > 0 ? fy : 0;
      src.brake = fy < 0 ? -fy : 0;
      src.steer = live ? nx : 0;
      src.pitch = 0;
    } else {
      src.steer = live ? nx : 0;
      src.pitch = live ? -ny : 0; // stick up the screen = +1
    }
    stickKnob.style.transform = `translate(${(nx * STICK_RANGE).toFixed(1)}px, ${(ny * STICK_RANGE).toFixed(1)}px)`;
  }

  // ----- steering buttons (style 'buttons') -----
  const btn = { left: false, right: false, last: 0 };
  const btnTarget = () => {
    if (btn.left && btn.right) return btn.last;
    return btn.right ? 1 : btn.left ? -1 : 0;
  };
  const sb = (b) => { b.classList.add('rw-st-buttons', 'rw-pri'); return gate(b, 'car', 'boat'); };
  sb(makeButton('rw-steerbtn rw-sleft', 'Steer left', 'left', '',
    () => { btn.left = true; btn.last = -1; }, () => { btn.left = false; }, false));
  sb(makeButton('rw-steerbtn rw-sright', 'Steer right', 'right', '',
    () => { btn.right = true; btn.last = 1; }, () => { btn.right = false; }, false));

  // ----- tilt (style 'tilt') -----
  const tiltBar = gate(el('button', 'rw-btn rw-tiltbar rw-st-tilt rw-pri', layer), 'car', 'boat');
  tiltBar.type = 'button';
  tiltBar.tabIndex = -1;
  tiltBar.setAttribute('aria-label', 'Tilt steering (tap the steering area to re-center)');
  tiltBar.setAttribute('aria-disabled', 'true');
  const tiltFace = el('span', 'rw-face', tiltBar);
  const tiltTrack = el('span', 'rw-tilt-track', tiltFace);
  const tiltDot = el('span', 'rw-tilt-dot', tiltTrack);
  el('span', 'rw-tilt-label', tiltFace).textContent = 'TILT';
  const tilt = {
    listening: false, gotEvent: false, asked: false, timer: 0,
    deg: 0, smooth: 0, zero: 0, onFallback: opts.onSteerFallback || null,
  };
  function onOrientation(e) {
    if (e.beta == null && e.gamma == null) return;
    tilt.gotEvent = true;
    const so = typeof screen !== 'undefined' && screen.orientation && Number.isFinite(screen.orientation.angle)
      ? screen.orientation.angle : Number(window.orientation) || 0;
    tilt.deg = tiltAngle(e.beta, e.gamma, so);
  }
  function stopTilt() {
    if (tilt.listening) window.removeEventListener('deviceorientation', onOrientation);
    tilt.listening = false;
    clearTimeout(tilt.timer);
  }
  function tiltFails(reason) {
    stopTilt();
    if (style !== 'tilt') return;
    applyStyle('wheel');
    if (tilt.onFallback) tilt.onFallback('wheel', reason);
  }
  function listenTilt() {
    if (tilt.listening) return;
    tilt.listening = true;
    tilt.gotEvent = false;
    window.addEventListener('deviceorientation', onOrientation);
    clearTimeout(tilt.timer);
    tilt.timer = setTimeout(() => { if (!tilt.gotEvent) tiltFails('no-sensor'); }, TILT_WAIT_MS);
  }
  // iOS-style permission needs a user gesture: called from taps and the menu.
  function maybeAskTilt() {
    if (style !== 'tilt' || tilt.listening) return;
    const D = window.DeviceOrientationEvent;
    if (!D) { tiltFails('unsupported'); return; }
    if (typeof D.requestPermission === 'function') {
      if (tilt.asked) return;
      // The browser only shows the question during a tap: wait for one.
      const ua = navigator.userActivation;
      if (ua && !ua.isActive) return;
      tilt.asked = true;
      let p;
      try { p = D.requestPermission(); } catch { tilt.asked = false; return; }
      Promise.resolve(p).then((res) => {
        if (style !== 'tilt') return;
        if (res === 'denied') tiltFails('denied');
        else listenTilt(); // 'granted' or undecided: the event timeout decides
      }, () => { tilt.asked = false; }); // no gesture after all: ask on the next tap
      return;
    }
    listenTilt();
  }
  function drawTilt(x) {
    tiltDot.style.transform = `translateX(${(x * 60).toFixed(1)}px)`;
  }

  // ----- action registry, the "more" fan and the layout slots -----
  // pri: stays on screen. sec: folds into the fan behind the "more" button.
  // Positions come from CSS slots (see styles.js): the code only numbers
  // the fan items (--c column, --r row).
  const pri = (b) => { b.classList.add('rw-pri'); return b; };
  const actions = [];
  let fanOpen = false, fanTimer = 0, fanHeld = 0, hudFull = false;
  let fanDirty = true;
  const more = pri(makeButton('rw-more', 'More controls', 'more', '', () => {
    setFan(!fanOpen);
    armFan();
  }, () => {}, false));
  more.setAttribute('aria-expanded', 'false');
  more.setAttribute('aria-haspopup', 'true');
  function setFan(open) {
    if (open === fanOpen) return;
    fanOpen = open;
    layer.classList.toggle('rw-fan-open', open);
    more.setAttribute('aria-expanded', String(open));
    if (!open) { clearTimeout(fanTimer); fanTimer = 0; }
  }
  // (Re)start the fold-away timer; it waits while a fan button is held.
  function armFan() {
    clearTimeout(fanTimer);
    fanTimer = 0;
    if (fanOpen && !fanHeld) fanTimer = setTimeout(() => setFan(false), FAN_MS);
  }
  // Keyboard users: Enter or Space on the focused more button.
  on(more, 'click', (e) => { if (e.detail === 0) { setFan(!fanOpen); armFan(); } });
  // A touch anywhere else folds the fan; the touch itself still goes through.
  on(document, 'pointerdown', (e) => {
    if (!fanOpen || fanHeld) return; // a held fan button keeps it open
    const t = e.target;
    if (t && t.closest && t.closest('.rw-more, .rw-sec')) return;
    setFan(false);
  }, true);

  // Register a control. Returns { id, el, remove() }. See docs/UI.md.
  function addAction(def) {
    const sec = def.group !== 'primary';
    const named = def.input;
    const press = def.press || (named ? () => input.press(named) : () => {});
    const release = def.release || (named ? () => input.release(named) : () => {});
    const a = {
      id: String(def.id), sec, visible: typeof def.visible === 'function' ? def.visible : null,
      hideWhen: typeof def.hideWhen === 'function' ? def.hideWhen : null, // hidden while this is true (BOOST yields its cell)
      modes: Array.isArray(def.modes) && def.modes.length ? def.modes.filter((m) => MODES.includes(m)) : MODES.slice(),
      vis: true, c: -1, r: -1, el: null,
    };
    // def.pointer { down(e), move(e), up(e) } replaces press/release for
    // fingers (keyboard clicks still use press/release): the SWAP wheel.
    const ptr = def.pointer || null;
    const idc = a.id.replace(/[^a-z0-9_-]/gi, '');
    const slot = !sec && def.slot ? String(def.slot).replace(/[^a-z0-9_-]/gi, '') : '';
    a.slot = slot;
    const b = makeButton(`rw-act ${sec ? 'rw-sec' : slot ? `rw-pri rw-slot rw-slot-${slot}` : 'rw-pri rw-extra'} rw-a-${idc}`,
      def.label || a.id, def.icon || null, def.text || '',
      (e) => { if (sec) { fanHeld++; armFan(); } if (ptr) ptr.down(e); else press(); },
      (e) => {
        if (ptr) ptr.up(e); else release();
        if (sec) { fanHeld = Math.max(0, fanHeld - 1); if (!fanHeld) setFan(false); }
      }, def.buzz !== false, ptr);
    b.dataset.action = a.id;
    gate(b, ...a.modes);
    if (sec) b.tabIndex = 0;
    // Keyboard: Enter or Space is a quick press.
    on(b, 'click', (e) => {
      if (e.detail !== 0) return;
      press();
      setTimeout(release, 60);
      if (sec) setFan(false);
    });
    a.el = b;
    if (a.visible) a.vis = !!a.visible();
    if (a.hideWhen && a.hideWhen()) a.vis = false;
    b.classList.toggle('rw-off', !a.vis);
    actions.push(a);
    fanDirty = true;
    refreshActions(); // BOOST yields its cell at once to a new offer
    return {
      id: a.id,
      el: b,
      remove() {
        const i = actions.indexOf(a);
        if (i < 0) return;
        actions.splice(i, 1);
        b.remove();
        fanDirty = true;
        refreshActions();
      },
    };
  }

  // Re-evaluate visible() callbacks (cheap; allocation free), then renumber.
  // Actions with hideWhen run in a second pass so they see this step's state.
  function refreshActions() {
    for (let pass = 0; pass < 2; pass++) {
      for (let i = 0; i < actions.length; i++) {
        const a = actions[i];
        if ((pass === 1) !== !!a.hideWhen) continue;
        if (!a.visible && !a.hideWhen) continue;
        let v = a.visible ? !!a.visible() : true;
        if (v && a.hideWhen && a.hideWhen()) v = false;
        if (v !== a.vis) {
          a.vis = v;
          a.el.classList.toggle('rw-off', !v);
          fanDirty = true;
        }
      }
    }
    if (fanDirty) layoutActions();
  }

  // An unslotted primary (GARAGE, TALK) is on offer: it takes the BOOST cell.
  function offerShowing() {
    for (let i = 0; i < actions.length; i++) {
      const a = actions[i];
      if (!a.sec && !a.slot && a.vis && a.modes.includes(mode)) return true;
    }
    return false;
  }

  // Number the fan items; unslotted primaries share the one cell above MORE
  // (the BOOST cell, docs/REVAMP.md 6.12): a second one waits, nothing ever
  // uses the cell above it.
  function layoutActions() {
    fanDirty = false;
    let n = 0, e = 0;
    // The fan is 3 columns by 2 rows (docs/REVAMP.md 6.5); slot actions
    // (HAND, SWAP, RUN, the weapon arc) have fixed rectangles of their own.
    for (const a of actions) {
      if (!a.vis || !a.modes.includes(mode) || a.slot) continue;
      if (a.sec) {
        const r = n % FAN_ROWS, c = (n / FAN_ROWS) | 0;
        n++;
        if (c !== a.c) { a.c = c; a.el.style.setProperty('--c', c); }
        if (r !== a.r) { a.r = r; a.el.style.setProperty('--r', r); }
      } else {
        a.el.classList.toggle('rw-spare', e > 0);
        e++;
      }
    }
    more.classList.toggle('rw-off', n === 0);
  }

  // ----- primary: car / boat buttons -----
  const cb = (b) => gate(pri(b), 'car', 'boat');
  cb(makeButton('rw-pedal rw-brake', 'Brake / reverse', 'brake', 'BRAKE',
    () => { src.brake = 1; }, () => { src.brake = 0; }, false));
  cb(makeButton('rw-pedal rw-gas', 'Gas', 'gas', 'GAS',
    () => { src.throttle = 1; }, () => { src.throttle = 0; }, false));
  cb(nameButton('rw-exit', 'Exit car', 'exit', 'EXIT', 'enter'));

  // ----- primary: plane / heli buttons -----
  const pedals = (mode2, cls, label, icon, text, axis, value) => gate(pri(makeButton(
    `rw-pedal ${cls}`, label, icon, text,
    () => { src[axis] = value; }, () => { src[axis] = 0; }, false)), mode2);
  pedals('plane', 'rw-brake', 'Plane brake', 'brake', 'BRAKE', 'brake', 1);
  pedals('plane', 'rw-gas', 'Thrust', 'gas', 'THRUST', 'throttle', 1);
  pedals('heli', 'rw-brake rw-tall', 'Descend', 'down', 'DOWN', 'brake', 1);
  pedals('heli', 'rw-gas rw-tall', 'Climb', 'gas', 'UP', 'throttle', 1);
  for (const m of ['plane', 'heli']) gate(pri(nameButton('rw-exit', 'Exit aircraft', 'exit', 'EXIT', 'enter')), m);
  // Tank: the left stick drives, the right half aims (camera drag); its
  // CANNON, COAX and LOCK come from armsctl.js.
  gate(pri(nameButton('rw-exit rw-texit', 'Exit tank', 'exit', 'EXIT', 'enter')), 'tank');

  // ----- primary: foot -----
  const enterBtn = gate(pri(nameButton('rw-enter', 'Enter car', 'enter', 'ENTER', 'enter')), 'foot');
  let enterReady = null;

  // ----- combat (docs/COMBAT.md "Touch controls", "Drive-by") -----
  // FIRE: hold for automatic fire. The same finger may slide to aim:
  // moving it feeds the camera drag like the look area does.
  function fireButton(cls, label, text) {
    const b = el('button', 'rw-btn rw-cmb rw-pri ' + cls, layer);
    b.type = 'button';
    b.tabIndex = -1;
    b.setAttribute('aria-label', label);
    el('span', 'rw-face', b).innerHTML = svg('fire') + `<span>${text}</span><b class="rw-fire-mag"></b>`;
    const last = { x: 0, y: 0 };
    track(b, {
      down(e) { b.classList.add('rw-down'); vibrate(); last.x = e.clientX; last.y = e.clientY; input.press('fire'); },
      move(e) {
        input.lookX += e.clientX - last.x;
        input.lookY += e.clientY - last.y;
        last.x = e.clientX;
        last.y = e.clientY;
      },
      up(e) {
        b.classList.remove('rw-down');
        // Lifted over the weapon icon (SWAP, or the more button it folds
        // into): cancel a throw being aimed.
        if (e && Number.isFinite(e.clientX) && overCancel(e.clientX, e.clientY)) {
          input.press('cancel');
          input.release('cancel');
        }
        input.release('fire');
      },
    });
    return b;
  }
  function overCancel(x, y) {
    for (const t of cancelTargets) {
      if (!t || !t.offsetParent) continue;
      const r = t.getBoundingClientRect();
      if (r.width > 0 && x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return true;
    }
    return false;
  }
  const cancelTargets = [];
  const fireFoot = gate(fireButton('rw-fire', 'Fire', 'FIRE'), 'foot');
  const fireCar = gate(fireButton('rw-dbfire', 'Drive-by fire', 'FIRE'), 'car', 'boat');
  const lockBtn = gate(pri(nameButton('rw-cmb rw-lock', 'Lock on', 'lock', 'LOCK', 'lock')), 'foot');
  // Reload chip next to FIRE: only while the magazine is low or empty.
  gate(pri(nameButton('rw-cmb rw-chipbtn', 'Reload (magazine low)', 'reload', 'RELOAD', 'reload')), 'foot');
  // The ammo counter (HUD Full only): tap to reload early. Shows the weapon too.
  const ammoBtn = gate(nameButton('rw-cmb rw-ammo', 'Ammo', null, '', 'reload'), 'foot', 'car', 'boat');
  ammoBtn.querySelector('.rw-face').innerHTML = '<i class="rw-ammo-icon"></i><span class="rw-ammo-txt"><b class="rw-ammo-n">-</b><small class="rw-ammo-of"></small></span>'
    + '<em class="rw-ammo-name"></em><i class="rw-ammo-bar"><i></i></i>';
  const ammoIcon = ammoBtn.querySelector('.rw-ammo-icon');
  const ammoN = ammoBtn.querySelector('.rw-ammo-n');
  const ammoOf = ammoBtn.querySelector('.rw-ammo-of');
  const ammoName = ammoBtn.querySelector('.rw-ammo-name');
  const ammoBar = ammoBtn.querySelector('.rw-ammo-bar i');
  const fireMags = [fireFoot.querySelector('.rw-fire-mag'), fireCar.querySelector('.rw-fire-mag')];
  // Last shown values, so per-frame calls only touch the DOM on change.
  const shown = { weapon: '', mag: -2, max: -2, reload: -1, locked: null, show: null, drive: null, chip: null };

  // ----- weapon wheel: hold SWAP, drag to a slice, lift to choose -----
  // A tap (under HOLD_MS) still cycles. The wheel is only open while the
  // SWAP finger is down; docs/UI.md "Weapon wheel".
  const wheelN = WEAPON_IDS.length;
  const wheelEl = el('div', 'rw-ww', layer);
  wheelEl.setAttribute('aria-hidden', 'true');
  el('div', 'rw-ww-disc', wheelEl);
  const wheelSlices = [];
  for (let i = 0; i < wheelN; i++) {
    const id = WEAPON_IDS[i];
    const a = (i * Math.PI * 2) / wheelN;
    const sl = el('div', 'rw-ww-slice', wheelEl);
    sl.setAttribute('role', 'img');
    sl.setAttribute('aria-label', WEAPONS[id].name);
    sl.style.left = `${(RING_PX + Math.sin(a) * 74).toFixed(1)}px`;
    sl.style.top = `${(RING_PX - Math.cos(a) * 74).toFixed(1)}px`;
    sl.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${WEAPON_ICONS[id] || ICONS.fire}</svg><span>${id.toUpperCase()}</span>`;
    wheelSlices.push(sl);
  }
  const wheelLabel = el('div', 'rw-ww-label', wheelEl);
  const wheelCtr = { x: 0, y: 0 }; // ring center in client px
  const wheelPos = { x: 0, y: 0 };
  const wheelAvoid = [{ l: 0, t: 0, r: 0, b: 0 }, { l: 0, t: 0, r: 0, b: 0 }];
  let wheelOpen = false, wheelSel = WHEEL_KEEP, swapTimer = 0, picker = null;
  function wheelText() {
    if (wheelSel === WHEEL_CANCEL) return 'Cancel';
    const id = wheelSel >= 0 ? WEAPON_IDS[wheelSel] : shown.weapon;
    return (WEAPONS[id] && WEAPONS[id].name) || '';
  }
  function wheelPaint() {
    for (let i = 0; i < wheelN; i++) {
      wheelSlices[i].classList.toggle('rw-sel', i === wheelSel);
      wheelSlices[i].classList.toggle('rw-cur', WEAPON_IDS[i] === shown.weapon);
    }
    wheelEl.classList.toggle('rw-ww-cancel', wheelSel === WHEEL_CANCEL);
    wheelLabel.textContent = wheelText();
  }
  function wheelClose() {
    clearTimeout(swapTimer);
    swapTimer = 0;
    if (!wheelOpen) return;
    wheelOpen = false;
    wheelEl.classList.remove('rw-ww-open');
    wheelEl.setAttribute('aria-hidden', 'true');
  }
  function wheelShow() {
    swapTimer = 0;
    if (!swapBtn.offsetParent) return; // SWAP is not on screen: no wheel
    const r = root.getBoundingClientRect();
    const sb = swapBtn.getBoundingClientRect();
    const keep = [layer.querySelector('.rw-fire'), layer.querySelector('.rw-pause')];
    for (let i = 0; i < 2; i++) {
      const q = keep[i] && keep[i].getBoundingClientRect();
      if (!q || !q.width) { wheelAvoid[i].l = wheelAvoid[i].r = -1e4; wheelAvoid[i].t = wheelAvoid[i].b = -1e4; continue; }
      wheelAvoid[i].l = q.left - r.left; wheelAvoid[i].r = q.right - r.left;
      wheelAvoid[i].t = q.top - r.top; wheelAvoid[i].b = q.bottom - r.top;
    }
    placeWheel(sb.left + sb.width / 2 - r.left, sb.top + sb.height / 2 - r.top, RING_PX, r.width, r.height, wheelAvoid, wheelPos);
    wheelCtr.x = wheelPos.x + r.left;
    wheelCtr.y = wheelPos.y + r.top;
    wheelEl.style.transform = `translate(${Math.round(wheelPos.x - RING_PX)}px, ${Math.round(wheelPos.y - RING_PX)}px)`;
    wheelSel = WHEEL_KEEP;
    wheelPaint();
    wheelOpen = true;
    wheelEl.classList.add('rw-ww-open');
    wheelEl.setAttribute('aria-hidden', 'false');
    vibrate();
    // A throw being aimed is canceled; the wheel then picks the weapon.
    input.press('cancel');
    input.release('cancel');
  }
  function swapDown() {
    clearTimeout(swapTimer);
    swapTimer = setTimeout(wheelShow, HOLD_MS);
  }
  function swapMove(e) {
    if (!wheelOpen) return;
    const i = wheelIndex(e.clientX - wheelCtr.x, e.clientY - wheelCtr.y, wheelN);
    if (i === wheelSel) return;
    wheelSel = i;
    wheelPaint();
  }
  // e is undefined when releaseAll closes it (blur, mode change, hidden):
  // that never changes the weapon.
  function swapUp(e) {
    const lifted = !!e && e.type === 'pointerup';
    if (wheelOpen) {
      let i = wheelSel;
      if (lifted && Number.isFinite(e.clientX)) i = wheelIndex(e.clientX - wheelCtr.x, e.clientY - wheelCtr.y, wheelN);
      wheelClose();
      if (lifted && i >= 0 && picker) picker(WEAPON_IDS[i]);
      return;
    }
    const held = swapTimer !== 0;
    wheelClose();
    if (lifted && held) { input.press('swap'); input.release('swap'); } // quick tap: cycle
  }

  // ----- secondary: folded into the fan -----
  const armed = () => shown.show !== false;
  // Handbrake is a primary button: always on screen in a car.
  addAction({ id: 'handbrake', group: 'primary', slot: 'hand', label: 'Handbrake', icon: 'handbrake', text: 'HAND', modes: ['car'],
    press() { src.handbrake = true; }, release() { src.handbrake = false; } });
  // BOOST (turbo, planing surge, afterburner, heli surge): hold. Its own slot
  // above MORE (docs/REVAMP.md 6.12). GARAGE and TALK take this cell while they
  // are offered, so BOOST hides then.
  addAction({ id: 'boost', group: 'primary', slot: 'boost', label: 'Boost', icon: 'boost', text: 'BOOST', modes: ['car', 'boat', 'plane', 'heli'],
    press() { src.boost = true; }, release() { src.boost = false; }, buzz: false, hideWhen: offerShowing });
  // SIREN (a stolen police car, later any emergency vehicle): toggles the siren
  // and lights. Its own slot, 8 px beside the steering slot (docs/REVAMP.md
  // 6.12). src/systems/police.js calls setSiren().
  let sirenCan = false, sirenLit = false;
  const sirenAct = addAction({ id: 'carsiren', group: 'primary', slot: 'siren', label: 'Siren and lights', icon: 'siren', text: 'SIREN',
    modes: ['car'], input: 'siren', visible: () => sirenCan });
  // EXTRA (a service vehicle's one working extra, docs/REVAMP.md 6.11): the
  // LOCK rect in car mode. src/systems/service.js calls setExtra().
  let extraCan = false, extraText = '', extraFill = -1, extraWeak = false;
  const extraAct = addAction({ id: 'extra', group: 'primary', slot: 'extra', label: 'Vehicle extra', icon: 'extra', text: 'EXTRA',
    modes: ['car'], input: 'extra', visible: () => extraCan, buzz: true });
  const extraCap = extraAct.el.querySelector('.rw-face span');
  const extraBar = el('i', 'rw-xbar', extraAct.el.querySelector('.rw-face'));
  extraBar.appendChild(document.createElement('i'));
  addAction({ id: 'horn', label: 'Horn', icon: 'horn', text: 'HORN', modes: ['car', 'boat'], input: 'horn' });
  addAction({ id: 'radio', label: 'Radio station', icon: 'radio', text: 'RADIO', modes: ['car', 'boat'], input: 'radio' });
  addAction({ id: 'view', label: 'Change camera', icon: 'camera', text: 'VIEW', modes: ['car', 'boat', 'plane', 'heli', 'tank'], input: 'camera' });
  addAction({ id: 'swap', group: 'primary', slot: 'hand', label: 'Swap weapon', icon: 'swap', text: 'SWAP', modes: ['foot'], input: 'swap', visible: armed,
    pointer: { down: swapDown, move: swapMove, up: swapUp } });
  addAction({ id: 'reload', label: 'Reload', icon: 'reload', text: 'RELOAD', modes: ['foot', 'car', 'boat'], input: 'reload',
    visible: () => armed() && (mode === 'foot' || shown.drive === true) });
  addAction({ id: 'run', group: 'primary', slot: 'run', label: 'Run', icon: 'run', text: 'RUN', modes: ['foot'],
    press() { src.sprint = true; }, release() { src.sprint = false; }, buzz: false });
  addAction({ id: 'map', label: 'Map', icon: 'map', text: 'MAP', input: 'map' });
  addAction({ id: 'respawn', label: 'Respawn', icon: 'respawn', text: 'RESPAWN', modes: ['foot', 'car', 'boat', 'plane', 'heli', 'tank'], input: 'respawn' });
  const swapBtn = actions.find((a) => a.id === 'swap').el;
  cancelTargets.push(swapBtn, more);

  // ----- pause: always on screen -----
  pri(nameButton('rw-pause', 'Pause', 'pause', '', 'pause'));

  // ----- global guards -----
  function releaseAll() {
    for (const c of cleanups) c();
    src.steer = 0; src.throttle = 0; src.brake = 0; src.handbrake = false; src.boost = false;
    src.moveX = 0; src.moveY = 0; src.sprint = false; src.pitch = 0;
    raw = 0;
    btn.left = false; btn.right = false;
    tilt.smooth = 0;
    setWheelAngle(0, false);
    padKnob.style.transform = '';
    stickKnob.style.transform = '';
    drawTilt(0);
  }
  const stop = (e) => e.preventDefault();
  on(layer, 'contextmenu', stop);
  on(layer, 'touchstart', stop, { passive: false });
  on(layer, 'touchmove', stop, { passive: false });
  on(layer, 'dblclick', stop);
  // Any touch is a user gesture: the moment to ask for tilt permission.
  on(layer, 'pointerdown', maybeAskTilt, true);
  on(window, 'blur', releaseAll);
  on(window, 'resize', placeRest);
  on(document, 'visibilitychange', () => { if (document.hidden) releaseAll(); });

  function applyStyle(next) {
    releaseAll();
    style = next;
    for (const k of STEER_STYLES) layer.classList.toggle('rw-steer-' + k, k === style);
    if (style !== 'tilt') stopTilt();
    placeRest();
  }

  placeRest();
  refreshActions();

  return {
    // ENTER is dimmed and inert until a craft is in reach (game.js sets it).
    setEnterReady(on) {
      const v = !!on;
      if (v === enterReady) return;
      enterReady = v;
      enterBtn.classList.toggle('rw-dim', !v);
      enterBtn.setAttribute('aria-disabled', v ? 'false' : 'true');
    },
    setMode(m) {
      const next = MODES.includes(m) ? m : 'car';
      if (next === mode) return;
      releaseAll();
      mode = next;
      for (const k of MODES) layer.classList.toggle('rw-mode-' + k, k === mode);
      stick.classList.toggle('rw-flight', mode === 'plane' || mode === 'heli' || mode === 'tank');
      setFan(false);
      fanDirty = true;
      refreshActions();
      placeRest();
    },
    // style: 'wheel' | 'buttons' | 'tilt' | 'slider'; sensitivity 0.5..1.5.
    // Returns the style in use: 'wheel' at once if tilt has no API here.
    // A later tilt failure (no sensor events, permission denied) switches
    // to 'wheel' and calls onFallback (or opts.onSteerFallback).
    setSteering(nextStyle, nextSens, onFallback) {
      const st = STEER_STYLES.includes(nextStyle) ? nextStyle : 'wheel';
      if (nextSens !== undefined) sensitivity = clampSensitivity(+nextSens);
      if (typeof onFallback === 'function') tilt.onFallback = onFallback;
      if (st !== style) applyStyle(st);
      else { setWheelAngle(wh.angle, false); setRaw(raw); }
      if (st === 'tilt') {
        tilt.asked = false;
        maybeAskTilt();
      }
      return style;
    },
    getSteering: () => ({ style, sensitivity, leftHanded }),
    registerAction: addAction,
    // fn(weaponId): called when the weapon wheel picks a weapon.
    setWeaponPicker(fn) { picker = typeof fn === 'function' ? fn : null; },
    isWheelOpen: () => wheelOpen,
    // 'minimal' (default): idle-shrunk primaries and the "more" fan.
    // 'full': every control shown, nothing folded or dimmed.
    setHudMode(m) {
      const full = m === 'full';
      if (full === hudFull) return;
      hudFull = full;
      setFan(false);
      layer.classList.toggle('rw-full', full);
    },
    getHudMode: () => (hudFull ? 'full' : 'minimal'),
    // The "more" fan, for the game and tests.
    isFanOpen: () => fanOpen,
    // Combat panel state, called each frame by the combat HUD (cheap when
    // nothing changed). c: { show, weapon (id), name, mag, max (0 = no
    // magazine), reload (0..1 progress, 0 = not reloading), locked,
    // drive (drive-by available in this craft) }.
    setCombat(c) {
      const show = !!c.show;
      let flipped = false;
      if (show !== shown.show) {
        shown.show = show;
        flipped = true;
        layer.classList.toggle('rw-nocombat', !show);
      }
      const drive = !!c.drive;
      if (drive !== shown.drive) {
        shown.drive = drive;
        flipped = true;
        layer.classList.toggle('rw-nodrive', !drive);
      }
      if (flipped) refreshActions();
      if (!show) wheelClose();
      if (c.weapon !== shown.weapon) {
        shown.weapon = c.weapon;
        const ic = WEAPON_ICONS[c.weapon] || ICONS.fire;
        ammoIcon.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${ic}</svg>`;
        swapBtn.querySelector('svg').innerHTML = ic;
        if (wheelOpen) wheelPaint();
        ammoName.textContent = c.name || '';
      }
      const mag = c.max > 0 ? Math.max(0, c.mag | 0) : -1;
      if (mag !== shown.mag || c.max !== shown.max) {
        shown.mag = mag;
        shown.max = c.max;
        const t = mag < 0 ? '' : String(mag);
        ammoN.textContent = mag < 0 ? '\u221e' : t;
        ammoOf.textContent = c.max > 0 ? '/' + c.max : '';
        for (const m of fireMags) m.textContent = t;
        ammoBtn.classList.toggle('rw-empty', mag === 0);
      }
      const r = c.reload > 0 ? Math.round(Math.min(1, c.reload) * 40) / 40 : 0;
      if (r !== shown.reload) {
        shown.reload = r;
        ammoBtn.classList.toggle('rw-reloading', r > 0);
        ammoBar.style.transform = `scaleX(${r.toFixed(3)})`;
      }
      // Reload chip: only when the magazine is low or empty (or reloading).
      const chip = show && c.max > 0 && (c.mag <= c.max * LOW_AMMO || r > 0);
      if (chip !== shown.chip) {
        shown.chip = chip;
        layer.classList.toggle('rw-chip-on', chip);
      }
      const locked = !!c.locked;
      if (locked !== shown.locked) {
        shown.locked = locked;
        lockBtn.classList.toggle('rw-on', locked);
      }
    },
    // The player's car can sound a siren (can) and whether it is on (on).
    setSiren(can, on) {
      can = !!can;
      on = !!on;
      if (can !== sirenCan) { sirenCan = can; refreshActions(); }
      if (on !== sirenLit) {
        sirenLit = on;
        sirenAct.el.classList.toggle('rw-on', on);
        sirenAct.el.setAttribute('aria-pressed', String(on));
      }
    },
    // The player's vehicle has an extra (can) and how it stands: text is the
    // caption (WATER, TREAT, LIFT, HOOK, DROP), fill 0..1 the 4 px bar along the
    // bottom (below 0 hides it), weak dims it to 40 % when it cannot act now.
    setExtra(c) {
      const can = !!(c && c.can);
      if (can !== extraCan) { extraCan = can; refreshActions(); }
      if (!can) return;
      const text = (c.text || 'EXTRA').slice(0, 6);
      if (text !== extraText) { extraText = text; if (extraCap) extraCap.textContent = text; }
      const fill = c.fill >= 0 ? Math.round(Math.min(1, c.fill) * 50) / 50 : -1;
      if (fill !== extraFill) {
        extraFill = fill;
        extraBar.style.display = fill < 0 ? 'none' : '';
        if (fill >= 0) extraBar.firstChild.style.transform = `scaleX(${fill.toFixed(2)})`;
      }
      const weak = !!c.weak;
      if (weak !== extraWeak) { extraWeak = weak; extraAct.el.classList.toggle('rw-weak', weak); extraAct.el.setAttribute('aria-disabled', String(weak)); }
    },
    setLeftHanded(v) {
      const next = !!v;
      if (next === leftHanded) return;
      releaseAll();
      leftHanded = next;
      layer.classList.toggle('rw-lefty', leftHanded);
      placeRest();
    },
    // Once per simulation step: ramps the arrow buttons and smooths tilt.
    update(dt) {
      refreshActions();
      if (!(dt > 0) || !steerMode()) return;
      if (style === 'buttons') {
        setRaw(rampSteer(raw, btnTarget(), dt, sensitivity));
      } else if (style === 'tilt') {
        const target = tilt.gotEvent ? angleDelta(tilt.deg * Math.PI / 180, tilt.zero * Math.PI / 180) * 180 / Math.PI : 0;
        tilt.smooth = tiltFilter(tilt.smooth, target, dt);
        setRaw(tiltToSteer(tilt.smooth, sensitivity));
        drawTilt(raw);
      }
    },
    setVisible(v) {
      if (!v) { releaseAll(); setFan(false); }
      layer.classList.toggle('rw-hidden', !v);
      if (v) placeRest();
    },
    dispose() {
      releaseAll();
      clearTimeout(fanTimer);
      clearTimeout(swapTimer);
      stopTilt();
      for (const [t, type, fn, o] of listeners) t.removeEventListener(type, fn, o);
      listeners.length = 0;
      layer.remove();
    },
  };
}
