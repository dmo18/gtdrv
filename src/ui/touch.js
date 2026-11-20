// On-screen touch controls. Feeds one source on the shared input object.
// Every control tracks its own pointerId so several fingers work at once.
import { injectStyles } from './styles.js';

const STEER_RANGE = 60; // px of drag for full lock
const STEER_DEAD = 0.08;
const STICK_RANGE = 56; // px of drag for full stick
const STICK_DEAD = 0.1;
const SPRINT_AT = 0.85;

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
};

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

export function createTouchControls(root, input) {
  injectStyles();
  if (getComputedStyle(root).position === 'static') root.style.position = 'relative';

  const src = input.addSource({
    steer: 0, throttle: 0, brake: 0, handbrake: false,
    moveX: 0, moveY: 0, sprint: false, pitch: 0,
  });
  const layer = el('div', 'rw-touch rw-mode-car', root);
  const MODES = ['foot', 'car', 'boat', 'plane', 'heli'];
  // Gated elements show only in the modes listed by their rw-m-* classes.
  const gate = (b, ...modes) => { b.classList.add('rw-gated', ...modes.map((m) => 'rw-m-' + m)); return b; };
  const cleanups = []; // functions run on releaseAll()
  const listeners = [];

  function on(target, type, fn, opts) {
    target.addEventListener(type, fn, opts);
    listeners.push([target, type, fn, opts]);
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

  // ----- camera drag (right 60% of the screen, under the buttons) -----
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

  // ----- floating stick zone (left side), mode decides the style -----
  const zone = el('div', 'rw-zone rw-stickzone', layer);
  const pad = gate(el('div', 'rw-pad', layer), 'car', 'boat');
  const padKnob = el('div', 'rw-knob', pad);
  const stick = gate(el('div', 'rw-stick', layer), 'foot', 'plane', 'heli');
  const stickKnob = el('div', 'rw-knob', stick);
  const origin = { x: 0, y: 0 };
  let mode = 'car';
  const padMode = () => mode === 'car' || mode === 'boat';

  // Rest positions (bottom-left) so the control is visible before touching.
  function restPosition() {
    const r = root.getBoundingClientRect();
    const w = padMode() ? 176 : 128;
    const h = padMode() ? 60 : 128;
    const sl = parseFloat(getComputedStyle(layer).getPropertyValue('--rw-sl')) || 0;
    return { x: r.left + sl + 24 + w / 2, y: r.bottom - 28 - h / 2 - (padMode() ? 6 : 0) };
  }
  function placeBase(base, cx, cy) {
    const r = root.getBoundingClientRect();
    const w = base === pad ? 176 : 128;
    const h = base === pad ? 60 : 128;
    base.style.transform = `translate(${Math.round(cx - r.left - w / 2)}px, ${Math.round(cy - r.top - h / 2)}px)`;
  }
  function placeRest() {
    const p = restPosition();
    placeBase(padMode() ? pad : stick, p.x, p.y);
  }

  track(zone, {
    down(e) {
      const r = root.getBoundingClientRect();
      // Steering is measured from the touch-down point; the drawn base is
      // nudged so it stays fully on screen.
      origin.x = e.clientX;
      origin.y = e.clientY;
      const halfW = padMode() ? 88 : 64;
      const halfH = padMode() ? 30 : 64;
      const base = padMode() ? pad : stick;
      placeBase(base,
        clamp(e.clientX, r.left + halfW + 6, r.left + r.width * 0.4 - 6),
        clamp(e.clientY, r.top + halfH + 6, r.bottom - halfH - 6));
      base.classList.add('rw-active');
      applyStick(e.clientX, e.clientY);
    },
    move(e) { applyStick(e.clientX, e.clientY); },
    up() {
      src.steer = 0; src.moveX = 0; src.moveY = 0; src.sprint = false; src.pitch = 0;
      padKnob.style.transform = '';
      stickKnob.style.transform = '';
      pad.classList.remove('rw-active');
      stick.classList.remove('rw-active', 'rw-sprint');
      placeRest();
    },
  });

  function applyStick(x, y) {
    const dx = x - origin.x;
    const dy = y - origin.y;
    if (padMode()) {
      const v = clamp(dx / STEER_RANGE, -1, 1);
      const a = Math.abs(v);
      src.steer = a < STEER_DEAD ? 0 : Math.sign(v) * (a - STEER_DEAD) / (1 - STEER_DEAD);
      padKnob.style.transform = `translateX(${(v * STEER_RANGE).toFixed(1)}px)`;
    } else {
      const raw = Math.hypot(dx, dy) / STICK_RANGE;
      const k = raw > 1 ? 1 / raw : 1; // clamp vector to the unit circle
      const nx = dx / STICK_RANGE * k;
      const ny = dy / STICK_RANGE * k;
      const mag = Math.min(raw, 1);
      const live = mag >= STICK_DEAD;
      if (mode === 'foot') {
        src.moveX = live ? nx : 0;
        src.moveY = live ? -ny : 0; // screen y grows downward; up is forward
        src.sprint = raw > SPRINT_AT;
        stick.classList.toggle('rw-sprint', src.sprint);
      } else {
        src.steer = live ? nx : 0;
        src.pitch = live ? -ny : 0; // stick up the screen = +1
      }
      stickKnob.style.transform = `translate(${(nx * STICK_RANGE).toFixed(1)}px, ${(ny * STICK_RANGE).toFixed(1)}px)`;
    }
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

  // ----- both modes -----
  nameButton('rw-pause', 'Pause', 'pause', '', 'pause');
  nameButton('rw-map', 'Map', 'map', '', 'map');

  // ----- global guards -----
  function releaseAll() {
    for (const c of cleanups) c();
    src.steer = 0; src.throttle = 0; src.brake = 0; src.handbrake = false;
    src.moveX = 0; src.moveY = 0; src.sprint = false; src.pitch = 0;
    padKnob.style.transform = '';
    stickKnob.style.transform = '';
  }
  const stop = (e) => e.preventDefault();
  on(layer, 'contextmenu', stop);
  on(layer, 'touchstart', stop, { passive: false });
  on(layer, 'touchmove', stop, { passive: false });
  on(layer, 'dblclick', stop);
  on(window, 'blur', releaseAll);
  on(window, 'resize', placeRest);
  on(document, 'visibilitychange', () => { if (document.hidden) releaseAll(); });

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
    setVisible(v) {
      if (!v) releaseAll();
      layer.classList.toggle('rw-hidden', !v);
      if (v) placeRest();
    },
    dispose() {
      releaseAll();
      for (const [t, type, fn, opts] of listeners) t.removeEventListener(type, fn, opts);
      listeners.length = 0;
      layer.remove();
    },
  };
}
