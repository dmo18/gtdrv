// On-screen touch controls. Feeds one source on the shared input object.
// Every control tracks its own pointerId so several fingers work at once.
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
  shapeSteer, rampSteer, angleDelta, tiltAngle, tiltToSteer, clampSensitivity,
  STEER_STYLES, WHEEL_LOCK_DEG,
} from '../core/input.js';

const SLIDER_RANGE = 110; // px of drag for full lock
const SLIDER_DEAD = 0.04;
const STICK_RANGE = 56; // px of drag for full stick
const STICK_DEAD = 0.1;
const SPRINT_AT = 0.85;
const WHEEL_CORE = 16; // px around the wheel centre where angle is ignored
const PAD_W = SLIDER_RANGE * 2 + 52, PAD_H = 60;
const STICK_W = 128;
const TILT_WAIT_MS = 2500; // no orientation events by then: no sensor
const TILT_SMOOTH = 0.07; // s, low-pass time constant

// Hand-drawn 24x24 line icons.
const ICONS = {
  handbrake: '<path d="M5 19l9-11"/><circle cx="16" cy="6" r="2.5"/><path d="M4 21h9"/>',
  horn: '<path d="M4 9h4l6-4v14l-6-4H4z"/><path d="M17 9c1.6 1.6 1.6 4.4 0 6"/>',
  exit: '<path d="M10 4H5v16h5"/><path d="M9 12h11M16 8l4 4-4 4"/>',
  camera: '<rect x="3" y="7" width="18" height="12" rx="3"/><circle cx="12" cy="13" r="3.4"/><path d="M9 7l1.5-2h3L15 7"/>',
  enter: '<path d="M3 16v-4l2-5h12l3 5v4z"/><circle cx="7.5" cy="17" r="1.6"/><circle cx="15.5" cy="17" r="1.6"/>',
  run: '<circle cx="14" cy="5" r="2"/><path d="M6 21l4-6 3 2 3-6-3-2-3 3-3-1M13 10l4 2 3-1"/>',
  down: '<path d="M6 9l6 6 6-6"/><path d="M6 4l6 6 6-6"/>',
  pause: '<path d="M8 5v14M16 5v14"/>',
  map: '<path d="M3 6l6-2 6 2 6-2v14l-6 2-6-2-6 2z"/><path d="M9 4v14M15 6v14"/>',
  gas: '<path d="M6 15l6-6 6 6"/><path d="M6 20l6-6 6 6"/>',
  brake: '<rect x="6" y="6" width="12" height="12" rx="2"/>',
  left: '<path d="M15 5l-7 7 7 7"/><path d="M20 5l-7 7 7 7" opacity="0.5"/>',
  right: '<path d="M9 5l7 7-7 7"/><path d="M4 5l7 7-7 7" opacity="0.5"/>',
  fire: '<circle cx="12" cy="12" r="7"/><path d="M12 2v5M12 17v5M2 12h5M17 12h5"/><circle cx="12" cy="12" r="1.2"/>',
  lock: '<path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5"/><circle cx="12" cy="12" r="3"/>',
  swap: '<path d="M4 8h13l-3-3M20 16H7l3 3"/>',
};
// Weapon icons (24x24, original line drawings).
export const WEAPON_ICONS = {
  wrench: '<path d="M14.5 4.5a4 4 0 0 0-4.8 5.3L4 15.5 6.5 18l5.7-5.7a4 4 0 0 0 5.3-4.8l-2.4 2.4-2.3-.5-.5-2.3z"/>',
  pistol: '<path d="M3 8h17v4h-8l-1 2h-3l-1 5H4l1-7H3z"/><path d="M12 12v-1"/>',
  smg: '<path d="M2 9h19v3h-6v2h-3l-1 5H8l1-5H6l-1-2H2z"/><path d="M14 14l1 4h-2"/>',
  scatter: '<path d="M2 10h14l5-1v4l-5-1H8l-2 6H3l2-6H2z"/><path d="M10 10v2"/>',
  lobber: '<rect x="3" y="9" width="15" height="5" rx="2"/><path d="M18 10l3-1v5l-3-1M7 14v4M12 14v3"/>',
  fizz: '<rect x="7" y="7" width="10" height="13" rx="2"/><path d="M9 7V5h6v2M10 4l1-2M7 11h10"/>',
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
  return `<svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[name]}</svg>`;
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
    moveX: 0, moveY: 0, sprint: false, pitch: 0,
  });
  const layer = el('div', 'rw-touch rw-mode-car rw-steer-wheel', root);
  const MODES = ['foot', 'car', 'boat', 'plane', 'heli'];
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
    const end = () => {
      if (id === null) return;
      id = null;
      handlers.up();
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
    const finish = (e) => { if (e.pointerId === id) end(); };
    on(target, 'pointerup', finish);
    on(target, 'pointercancel', finish);
    on(target, 'lostpointercapture', finish);
  }

  function vibrate() {
    if (navigator.vibrate) navigator.vibrate(8);
  }

  // A round/pedal button. onDown/onUp do the actual input work.
  function makeButton(cls, label, icon, text, onDown, onUp, buzz = true) {
    const b = el('button', 'rw-btn ' + cls, layer);
    b.type = 'button';
    b.tabIndex = -1;
    b.setAttribute('aria-label', label);
    b.innerHTML = (icon ? svg(icon) : '') + (text ? `<span>${text}</span>` : '');
    track(b, {
      down() { b.classList.add('rw-down'); if (buzz) vibrate(); onDown(); },
      move() {},
      up() { b.classList.remove('rw-down'); onUp(); },
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
    src.steer = steerMode() ? shapeSteer(raw, sensitivity) : 0;
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
  const stick = gate(el('div', 'rw-stick', layer), 'foot', 'plane', 'heli');
  const stickKnob = el('div', 'rw-knob', stick);
  const origin = { x: 0, y: 0 };
  // Wheel tracking: centre, last touch angle, accumulated wheel angle (deg).
  const wh = { cx: 0, cy: 0, last: 0, angle: 0, have: false };

  function safeInset(name) {
    return parseFloat(getComputedStyle(layer).getPropertyValue(name)) || 0;
  }
  // Rest positions (bottom corner) so the control is visible before touching.
  function restPosition() {
    const r = root.getBoundingClientRect();
    const slider = steerMode();
    const w = slider ? PAD_W : STICK_W;
    const h = slider ? PAD_H : STICK_W;
    const y = r.bottom - 28 - h / 2 - (slider ? 6 : 0);
    if (leftHanded) return { x: r.right - safeInset('--rw-sr') - 24 - w / 2, y };
    return { x: r.left + safeInset('--rw-sl') + 24 + w / 2, y };
  }
  function placeBase(base, cx, cy) {
    const r = root.getBoundingClientRect();
    const w = base === pad ? PAD_W : STICK_W;
    const h = base === pad ? PAD_H : STICK_W;
    base.style.transform = `translate(${Math.round(cx - r.left - w / 2)}px, ${Math.round(cy - r.top - h / 2)}px)`;
  }
  function placeRest() {
    const p = restPosition();
    placeBase(steerMode() ? pad : stick, p.x, p.y);
  }

  function setWheelAngle(deg, spring) {
    wh.angle = clamp(deg, -WHEEL_LOCK_DEG, WHEEL_LOCK_DEG);
    wheel.classList.toggle('rw-spring', !!spring);
    wheelRot.style.transform = wh.angle ? `rotate(${wh.angle.toFixed(1)}deg)` : '';
  }
  function wheelPoint(e) {
    const dx = e.clientX - wh.cx, dy = e.clientY - wh.cy;
    if (dx * dx + dy * dy < WHEEL_CORE * WHEEL_CORE) return false;
    // Screen y grows downward, so atan2 grows clockwise: right turn positive.
    const a = Math.atan2(dy, dx);
    if (wh.have) {
      setWheelAngle(wh.angle + angleDelta(a, wh.last) * 180 / Math.PI, false);
      setRaw(wh.angle / WHEEL_LOCK_DEG);
    }
    wh.last = a;
    wh.have = true;
    return true;
  }

  track(zone, {
    down(e) {
      maybeAskTilt();
      if (steerMode()) {
        if (style === 'wheel') {
          const b = wheel.getBoundingClientRect();
          wh.cx = b.left + b.width / 2;
          wh.cy = b.top + b.height / 2;
          wh.have = false;
          wheel.classList.add('rw-active');
          setWheelAngle(wh.angle, false);
          wheelPoint(e);
        } else if (style === 'slider') {
          const r = root.getBoundingClientRect();
          // Steering is measured from the touch-down point; the drawn base
          // is nudged so it stays fully on screen.
          origin.x = e.clientX;
          origin.y = e.clientY;
          placeBase(pad,
            clamp(e.clientX, r.left + PAD_W / 2 + 6, r.right - PAD_W / 2 - 6),
            clamp(e.clientY, r.top + PAD_H / 2 + 6, r.bottom - PAD_H / 2 - 6));
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
    const v = clamp((x - origin.x) / SLIDER_RANGE, -1, 1);
    const a = Math.abs(v);
    setRaw(a < SLIDER_DEAD ? 0 : Math.sign(v) * (a - SLIDER_DEAD) / (1 - SLIDER_DEAD));
    padKnob.style.transform = `translateX(${(v * SLIDER_RANGE).toFixed(1)}px)`;
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
  const sb = (b) => { b.classList.add('rw-st-buttons'); return gate(b, 'car', 'boat'); };
  sb(makeButton('rw-steerbtn rw-sleft', 'Steer left', 'left', '',
    () => { btn.left = true; btn.last = -1; }, () => { btn.left = false; }, false));
  sb(makeButton('rw-steerbtn rw-sright', 'Steer right', 'right', '',
    () => { btn.right = true; btn.last = 1; }, () => { btn.right = false; }, false));

  // ----- tilt (style 'tilt') -----
  const tiltBar = gate(el('button', 'rw-btn rw-tiltbar rw-st-tilt', layer), 'car', 'boat');
  tiltBar.type = 'button';
  tiltBar.tabIndex = -1;
  tiltBar.setAttribute('aria-label', 'Tilt steering (tap to re-centre)');
  const tiltTrack = el('span', 'rw-tilt-track', tiltBar);
  const tiltDot = el('span', 'rw-tilt-dot', tiltTrack);
  el('span', 'rw-tilt-label', tiltBar).textContent = 'TILT';
  const tilt = {
    listening: false, gotEvent: false, asked: false, timer: 0,
    deg: 0, smooth: 0, zero: 0, onFallback: opts.onSteerFallback || null,
  };
  track(tiltBar, {
    down() { maybeAskTilt(); tilt.zero += tilt.smooth; tilt.smooth = 0; vibrate(); },
    move() {},
    up() {},
  });
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

  // ----- car / boat buttons -----
  const cb = (b) => gate(b, 'car', 'boat');
  cb(makeButton('rw-pedal rw-brake', 'Brake / reverse', 'brake', 'BRAKE',
    () => { src.brake = 1; }, () => { src.brake = 0; }, false));
  cb(makeButton('rw-pedal rw-gas', 'Gas', 'gas', 'GAS',
    () => { src.throttle = 1; }, () => { src.throttle = 0; }, false));
  gate(makeButton('rw-handbrake', 'Handbrake', 'handbrake', 'HAND',
    () => { src.handbrake = true; }, () => { src.handbrake = false; }), 'car');
  cb(nameButton('rw-horn', 'Horn', 'horn', 'HORN', 'horn'));
  cb(nameButton('rw-exit', 'Exit car', 'exit', 'EXIT', 'enter'));
  cb(nameButton('rw-cam', 'Change camera', 'camera', 'VIEW', 'camera'));

  // ----- plane / heli buttons -----
  const pedals = (mode2, cls, label, icon, text, axis, value) => gate(makeButton(
    `rw-pedal ${cls}`, label, icon, text,
    () => { src[axis] = value; }, () => { src[axis] = 0; }, false), mode2);
  pedals('plane', 'rw-brake', 'Plane brake', 'brake', 'BRAKE', 'brake', 1);
  pedals('plane', 'rw-gas', 'Thrust', 'gas', 'THRUST', 'throttle', 1);
  pedals('heli', 'rw-brake rw-tall', 'Descend', 'down', 'DOWN', 'brake', 1);
  pedals('heli', 'rw-gas rw-tall', 'Climb', 'gas', 'UP', 'throttle', 1);
  for (const m of ['plane', 'heli']) {
    gate(nameButton('rw-exit', 'Exit aircraft', 'exit', 'EXIT', 'enter'), m);
    gate(nameButton('rw-cam', 'Change camera (air)', 'camera', 'VIEW', 'camera'), m);
  }

  // ----- foot buttons -----
  gate(nameButton('rw-enter', 'Enter car', 'enter', 'ENTER', 'enter'), 'foot');
  gate(makeButton('rw-run', 'Run', 'run', 'RUN',
    () => { src.sprint = true; }, () => { src.sprint = false; }, false), 'foot');

  // ----- combat (docs/COMBAT.md "Touch controls", "Drive-by") -----
  // FIRE: hold for automatic fire. The same finger may slide to aim:
  // moving it feeds the camera drag like the look area does.
  function fireButton(cls, label, text) {
    const b = el('button', 'rw-btn rw-cmb ' + cls, layer);
    b.type = 'button';
    b.tabIndex = -1;
    b.setAttribute('aria-label', label);
    b.innerHTML = svg('fire') + `<span>${text}</span><b class="rw-fire-mag"></b>`;
    const last = { x: 0, y: 0 };
    track(b, {
      down(e) { b.classList.add('rw-down'); vibrate(); last.x = e.clientX; last.y = e.clientY; input.press('fire'); },
      move(e) {
        input.lookX += e.clientX - last.x;
        input.lookY += e.clientY - last.y;
        last.x = e.clientX;
        last.y = e.clientY;
      },
      up() { b.classList.remove('rw-down'); input.release('fire'); },
    });
    return b;
  }
  const fireFoot = gate(fireButton('rw-fire', 'Fire', 'FIRE'), 'foot');
  const fireCar = gate(fireButton('rw-dbfire', 'Drive-by fire', 'FIRE'), 'car', 'boat');
  const lockBtn = gate(nameButton('rw-cmb rw-lock', 'Lock on', 'lock', 'LOCK', 'lock'), 'foot');
  const swapBtn = gate(nameButton('rw-cmb rw-swap', 'Swap weapon', 'swap', 'SWAP', 'swap'), 'foot');
  // The ammo counter: tap to reload early. Shows the weapon too.
  const ammoBtn = gate(nameButton('rw-cmb rw-ammo', 'Reload', null, '', 'reload'), 'foot', 'car', 'boat');
  ammoBtn.innerHTML = '<i class="rw-ammo-icon"></i><span class="rw-ammo-txt"><b class="rw-ammo-n">-</b><small class="rw-ammo-of"></small></span>'
    + '<em class="rw-ammo-name"></em><i class="rw-ammo-bar"><i></i></i>';
  const ammoIcon = ammoBtn.querySelector('.rw-ammo-icon');
  const ammoN = ammoBtn.querySelector('.rw-ammo-n');
  const ammoOf = ammoBtn.querySelector('.rw-ammo-of');
  const ammoName = ammoBtn.querySelector('.rw-ammo-name');
  const ammoBar = ammoBtn.querySelector('.rw-ammo-bar i');
  const fireMags = [fireFoot.querySelector('.rw-fire-mag'), fireCar.querySelector('.rw-fire-mag')];
  // Last shown values, so per-frame calls only touch the DOM on change.
  const shown = { weapon: '', mag: -2, max: -2, reload: -1, locked: null, show: null, drive: null };

  // ----- both modes -----
  nameButton('rw-pause', 'Pause', 'pause', '', 'pause');
  nameButton('rw-map', 'Map', 'map', '', 'map');

  // ----- global guards -----
  function releaseAll() {
    for (const c of cleanups) c();
    src.steer = 0; src.throttle = 0; src.brake = 0; src.handbrake = false;
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

  return {
    setMode(m) {
      const next = MODES.includes(m) ? m : 'car';
      if (next === mode) return;
      releaseAll();
      mode = next;
      for (const k of MODES) layer.classList.toggle('rw-mode-' + k, k === mode);
      stick.classList.toggle('rw-flight', mode === 'plane' || mode === 'heli');
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
      else setRaw(raw);
      if (st === 'tilt') {
        tilt.asked = false;
        maybeAskTilt();
      }
      return style;
    },
    getSteering: () => ({ style, sensitivity, leftHanded }),
    // Combat panel state, called each frame by the combat HUD (cheap when
    // nothing changed). c: { show, weapon (id), name, mag, max (0 = no
    // magazine), reload (0..1 progress, 0 = not reloading), locked,
    // drive (drive-by available in this craft) }.
    setCombat(c) {
      const show = !!c.show;
      if (show !== shown.show) {
        shown.show = show;
        layer.classList.toggle('rw-nocombat', !show);
      }
      const drive = !!c.drive;
      if (drive !== shown.drive) {
        shown.drive = drive;
        layer.classList.toggle('rw-nodrive', !drive);
      }
      if (c.weapon !== shown.weapon) {
        shown.weapon = c.weapon;
        const ic = WEAPON_ICONS[c.weapon] || ICONS.fire;
        ammoIcon.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${ic}</svg>`;
        swapBtn.querySelector('svg').innerHTML = ic;
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
      const locked = !!c.locked;
      if (locked !== shown.locked) {
        shown.locked = locked;
        lockBtn.classList.toggle('rw-on', locked);
      }
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
      if (!(dt > 0) || !steerMode()) return;
      if (style === 'buttons') {
        setRaw(rampSteer(raw, btnTarget(), dt));
      } else if (style === 'tilt') {
        const k = 1 - Math.exp(-dt / TILT_SMOOTH);
        const target = tilt.gotEvent ? angleDelta(tilt.deg * Math.PI / 180, tilt.zero * Math.PI / 180) * 180 / Math.PI : 0;
        tilt.smooth += (target - tilt.smooth) * k;
        setRaw(tiltToSteer(tilt.smooth));
        drawTilt(raw);
      }
    },
    setVisible(v) {
      if (!v) releaseAll();
      layer.classList.toggle('rw-hidden', !v);
      if (v) placeRest();
    },
    dispose() {
      releaseAll();
      stopTilt();
      for (const [t, type, fn, o] of listeners) t.removeEventListener(type, fn, o);
      listeners.length = 0;
      layer.remove();
    },
  };
}
