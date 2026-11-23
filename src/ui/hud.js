import { speedMph, formatClock12 } from '../core/units.js';
// Heads-up display. update() runs every frame, so it only touches the DOM
// when a displayed value changed and allocates nothing when nothing did.
import { injectStyles } from './styles.js';
import { meterPercent } from '../core/health.js';

function el(tag, cls, parent) {
  const e = document.createElement(tag);
  e.className = cls;
  if (parent) parent.appendChild(e);
  return e;
}

function bar(cls, parent) {
  const b = el('div', 'rw-bar ' + cls, parent);
  const fill = el('div', 'rw-fill', b);
  return { box: b, fill };
}



// The GPS turn pill, the street label and the red alert prompt (docs/PLAN_V3.md
// 13, CONTROLS). Own style element (styles.js is the HUD grid's file).
// Turn pill: one line in the top center stack's second row (y 40, 28 high),
// arrow icon, distance and street ("200 ft · SW 1st Ave"); while it shows,
// the row 1 messages use row 2 (and win over row 2's own). It never reaches
// the middle of the screen. At 300 px high or less the objective distance
// merges into it (the objective cell hides). Street label: a small line under
// the minimap (11 px), hidden while the minimap is grown or switched off.
const NAV_CSS = `
.rw-nav {
  position: absolute; left: 0; right: 0; margin: 0 auto; top: 32px;
  width: fit-content; max-width: 100%; height: 28px; padding: 0 10px 0 3px;
  display: flex; align-items: center; gap: 6px; border-radius: 6px;
  background: rgba(8, 22, 44, 0.86); border: 1px solid #3d8bff; color: #fff; pointer-events: none;
  font-size: 13px; font-weight: 800; line-height: 26px; white-space: nowrap;
}
.rw-nav.rw-none { display: none; }
.rw-nav.rw-soon { border-color: #ffd34d; }
.rw-navicon { flex: 0 0 22px; width: 22px; height: 22px; border-radius: 5px; background: #2a6fe0; display: flex; align-items: center; justify-content: center; }
.rw-navicon svg { width: 18px; height: 18px; display: block; }
.rw-nav.rw-soon .rw-navicon { background: #c98a00; }
.rw-navtext { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
.rw-navrem { display: none; flex: 0 0 auto; font-size: 11px; font-weight: 700; color: #ffe08a; }
.rw-navon .rw-m1 { top: 64px; }
.rw-navon .rw-m1:not([hidden]) ~ .rw-m2 { display: none; }
.rw-street {
  position: absolute; left: calc(var(--rw-sl) + 8px); top: calc(var(--rw-st) + 14px + var(--map)); max-width: 168px; height: 16px;
  padding: 0 6px; font-size: 11px; font-weight: 700; line-height: 16px; overflow: hidden; text-overflow: ellipsis; border-radius: 4px;
  pointer-events: none;
}
.rw-full .rw-street { top: calc(var(--rw-st) + 104px); }
.rw-street.rw-none, .rw-mapbig .rw-street, .rw-nostreet .rw-street { display: none; }
/* left-handed the cell under the minimap is BOOST's: the label goes under the speed readout (its width),
   below the boost and health meters; in Full (the fan stays open there) it is not shown */
.rw-touch.rw-lefty ~ .rw-hud .rw-street { left: calc(var(--rw-sl) + 16px + var(--map)); top: calc(var(--rw-st) + 66px); max-width: var(--spw); }
.rw-touch.rw-lefty ~ .rw-hud .rw-hpmeter:not(.rw-none) ~ .rw-street,
.rw-touch.rw-lefty ~ .rw-hud .rw-boostbar.rw-hp:not(.rw-none) ~ .rw-street { top: calc(var(--rw-st) + 82px); }
.rw-touch.rw-lefty.rw-full ~ .rw-hud .rw-street { display: none; }
.rw-prompt.rw-alert { background: #b3261e; border-color: #ffb4a8; color: #fff; font-size: 16px; font-weight: 900; letter-spacing: 0.04em; }
.rw-prompt.rw-alert.rw-in { animation: rw-alert-in 0.5s ease-out 2; }
@keyframes rw-alert-in { 0% { transform: scale(1.12); } 100% { transform: none; } }
@media (prefers-reduced-motion: reduce) { .rw-prompt.rw-alert.rw-in { animation: none; } }
@media (max-height: 380px) {
  .rw-full .rw-street { top: calc(var(--rw-st) + 96px); }
  .rw-touch.rw-lefty ~ .rw-hud .rw-street { top: calc(var(--rw-st) + 62px); }
  .rw-touch.rw-lefty ~ .rw-hud .rw-hpmeter:not(.rw-none) ~ .rw-street,
  .rw-touch.rw-lefty ~ .rw-hud .rw-boostbar.rw-hp:not(.rw-none) ~ .rw-street { top: calc(var(--rw-st) + 78px); }
}
@media (max-height: 300px) {
  .rw-navon .rw-objcell { display: none; }
  .rw-navon .rw-navrem { display: block; }
}
`;
function injectNavStyles() {
  if (document.getElementById('rw-nav-styles')) return;
  const st = document.createElement('style');
  st.id = 'rw-nav-styles';
  st.textContent = NAV_CSS;
  document.head.appendChild(st);
}

// Turn arrows for the strip (24 x 24, white strokes), by turn kind.
const ARROW = {
  right: 'M8 21V11h9M13 7l4 4-4 4',
  left: 'M16 21V11H7M11 7l-4 4 4 4',
  'slight-right': 'M9 21v-7l7-7M11 6h5v5',
  'slight-left': 'M15 21v-7L8 7M13 6H8v5',
  'sharp-right': 'M8 21V6l9 9M17 9v6h-6',
  'sharp-left': 'M16 21V6l-9 9M7 9v6h6',
  uturn: 'M16 21V9a4 4 0 0 0-8 0v7M4 13l4 4 4-4',
  merge: 'M7 21c0-6 5-8 5-12V4M17 21c0-6-5-8-5-12M8 8l4-4 4 4',
  exit: 'M8 21V3M8 15l8-8M11 6h5v5',
  depart: 'M12 21V4M7 9l5-5 5 5',
  arrive: 'M12 21c-5-6-6-9-6-11a6 6 0 0 1 12 0c0 2-1 5-6 11zM12 8.5v.1',
};
export const NAV_KINDS = Object.keys(ARROW);

export const MAP_SHRINK_MS = 5000; // the expanded minimap shrinks after this long untouched

// ---------------------------------------------------------------------------
// The top center stack (docs/REVAMP.md 6.12). Pure logic, no DOM: two message
// rows with fixed priorities. Row 1: police toast, then objective text, then
// the district banner. Row 2: a tutorial hint, then score or other toasts.
// Lower items are dropped or wait a few seconds, never queued for long.
// ---------------------------------------------------------------------------
export const KINDS = ['police', 'objective', 'district', 'hint', 'score', 'info'];
const ROW_OF = { police: 0, objective: 0, district: 0, hint: 1, score: 1, info: 1 };
const PRIO1 = { police: 3, objective: 2, district: 1 };
export const WAIT1_S = 3; // an objective line waits this long behind a police toast
export const WAIT2_S = 5; // a toast waits this long behind a hint
export const TOAST_MIN_S = 0.6; // a toast stays at least this long before a newer one replaces it
export const HINT_GAP_S = 3; // no hint starts within this long of a police toast

// Text to kind for callers that predate the third argument of toast().
const POLICE_RE = /^(The police|Officers on foot|They mean business|Roadblocks ahead|More patrol cars|You lost them|Pulled over)/;
const SCORE_RE = /\s\+[\d,]+(\s+x[\d.]+)?$/;
export function toastKind(text, kind) {
  if (kind && Object.hasOwn(ROW_OF, kind)) return kind;
  const t = String(text);
  if (POLICE_RE.test(t)) return 'police';
  if (t.length <= 40 && SCORE_RE.test(t)) return 'score';
  return 'info';
}

function slot() { return { kind: '', text: '', left: 0, age: 0, wait: 0, rev: 0 }; }
function put(s, kind, text, sec) { s.kind = kind; s.text = text; s.left = sec; s.age = 0; s.rev++; }
function clear(s) { if (s.kind) { s.kind = ''; s.rev++; } }

export function createTopStack() {
  const rows = [slot(), slot()];
  const wait = [slot(), slot()]; // at most one waiting item per row (kind '' = none)
  const st = { rows, wanted: false, sincePolice: 99 };

  function park(i, kind, text, left, waitS) {
    const w = wait[i];
    w.kind = kind; w.text = text; w.left = left; w.wait = waitS; w.age = 0;
  }
  function promote(i) {
    const w = wait[i];
    if (!w.kind) return;
    put(rows[i], w.kind, w.text, w.left);
    w.kind = '';
  }

  st.add = function add(kind, text, seconds) {
    const sec = Math.max(0.2, +seconds || 3);
    const i = ROW_OF[kind];
    const r = rows[i];
    if (i === 0) {
      if (kind === 'district' && st.wanted) return; // never while wanted
      const have = r.kind ? PRIO1[r.kind] : 0;
      const mine = PRIO1[kind];
      if (mine >= have) {
        // a displaced objective line waits; a displaced banner is dropped
        if (r.kind === 'objective' && kind === 'police') park(0, 'objective', r.text, r.left, WAIT1_S);
        if (kind === 'police') st.sincePolice = 0;
        put(r, kind, text, sec);
      } else if (kind === 'objective') park(0, kind, text, sec, WAIT1_S);
      return; // a banner under a higher item is dropped, never shown late
    }
    if (kind === 'hint') {
      if (r.kind === 'info') park(1, 'info', r.text, r.left, WAIT2_S);
      put(r, kind, text, sec);
      return;
    }
    if (r.kind === 'hint') { // score toasts are dropped, other toasts wait (the newest)
      if (kind === 'info') park(1, kind, text, sec, WAIT2_S);
      return;
    }
    if (!r.kind || r.age >= TOAST_MIN_S) put(r, kind, text, sec);
    else park(1, kind, text, sec, WAIT2_S);
  };

  st.tick = function tick(dt) {
    if (st.sincePolice < 99) st.sincePolice += dt;
    for (let i = 0; i < 2; i++) {
      const r = rows[i], w = wait[i];
      if (r.kind) {
        r.age += dt;
        r.left -= dt;
        if (r.left <= 0) clear(r);
      }
      if (w.kind) {
        const freeNow = !r.kind || (i === 1 && r.kind !== 'hint' && r.age >= TOAST_MIN_S);
        if (freeNow) promote(i);
        else {
          w.wait -= dt;
          if (w.wait <= 0) w.kind = '';
        }
      }
    }
    if (st.wanted && rows[0].kind === 'district') clear(rows[0]);
  };

  st.setWanted = (on) => { st.wanted = !!on; if (on && rows[0].kind === 'district') clear(rows[0]); };
  // The tutorial asks first: no hint while wanted or just after a police toast.
  st.canHint = () => !st.wanted && st.sincePolice >= HINT_GAP_S && rows[0].kind !== 'police';
  st.reset = () => { for (let i = 0; i < 2; i++) { clear(rows[i]); wait[i].kind = ''; } st.sincePolice = 99; };
  return st;
}

export function createHud(root) {
  injectStyles();
  injectNavStyles();
  if (getComputedStyle(root).position === 'static') root.style.position = 'relative';

  const hud = el('div', 'rw-hud', root);
  // Speed lines while boosting: thin streaks round the edges (opacity follows s.boostFx; off with reduced motion).
  const lines = el('div', 'rw-speedlines', hud);
  const timers = new Set();
  const later = (fn, ms) => {
    const t = setTimeout(() => { timers.delete(t); fn(); }, ms);
    timers.add(t);
    return t;
  };
  const stop = (t) => { if (t) { clearTimeout(t); timers.delete(t); } };

  // top-left: the minimap (tap to grow). Speed, health and the clock sit 8 px
  // right of it and follow its width (rw-mapbig on the HUD root).
  const tl = el('div', 'rw-tl', hud);
  const minimapCanvas = el('canvas', 'rw-minimap', tl);
  minimapCanvas.width = 176;
  minimapCanvas.height = 176;
  minimapCanvas.tabIndex = -1;
  minimapCanvas.setAttribute('role', 'button');
  minimapCanvas.setAttribute('aria-label', 'Mini-map (tap to enlarge)');
  minimapCanvas.setAttribute('aria-expanded', 'false');
  const clockEl = el('div', 'rw-clock rw-pill', hud);
  // Hard mode only: health under the speed (walker hp, or the craft's health aboard).
  const meter = el('div', 'rw-hpmeter rw-none', hud);
  meter.setAttribute('role', 'meter');
  meter.setAttribute('aria-label', 'Health');
  meter.setAttribute('aria-valuemin', '0');
  meter.setAttribute('aria-valuemax', '100');
  const meterFill = el('div', 'rw-hpfill', meter);
  const meterText = el('span', 'rw-hptext', meter);
  let mapBig = false;
  let mapTimer = 0;
  function setMapBig(on) {
    stop(mapTimer);
    mapTimer = 0;
    if (on !== mapBig) {
      mapBig = on;
      tl.classList.toggle('rw-big', on);
      hud.classList.toggle('rw-mapbig', on);
      minimapCanvas.setAttribute('aria-expanded', String(on));
      minimapCanvas.setAttribute('aria-label', on ? 'Mini-map (tap to shrink)' : 'Mini-map (tap to enlarge)');
    }
    if (on) mapTimer = later(() => setMapBig(false), MAP_SHRINK_MS);
  }
  // A tap grows it; another tap while grown shrinks it; either way it
  // shrinks by itself after MAP_SHRINK_MS without a touch.
  minimapCanvas.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.preventDefault();
    setMapBig(!mapBig);
  });
  minimapCanvas.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setMapBig(!mapBig); }
  });

  // top-center stack (docs/REVAMP.md 6.12): status row (stars, objective arrow
  // and distance), then two one-line message rows. Rows never move.
  const stackEl = el('div', 'rw-stack', hud);
  const stack = createTopStack();
  // The wrapper has no box (display: contents); old screenshot scripts still find .rw-toasts, .rw-toast and .rw-title.
  const toastsEl = el('div', 'rw-toasts', stackEl);
  const msgEls = [el('div', 'rw-msg rw-m1 rw-pill', toastsEl), el('div', 'rw-msg rw-m2 rw-pill', toastsEl)];
  const msgRev = [-1, -1];
  const msgOut = [false, false];
  for (const m of msgEls) m.hidden = true;

  // top-right: score and the points waiting on the combo, left of the pause button
  const tr = el('div', 'rw-tr', hud);
  const scoreEl = el('div', 'rw-money rw-score rw-pill', tr);
  const comboEl = el('div', 'rw-combo rw-pill', tr);
  comboEl.style.display = 'none';

  // top-center: police attention (stars, then the escape meter), only while wanted
  const wantedEl = el('div', 'rw-wanted rw-pill rw-none', stackEl);
  wantedEl.setAttribute('role', 'img');
  wantedEl.setAttribute('aria-label', 'Police attention: none');
  const BADGES = 5;
  const starRow = el('div', 'rw-stars', wantedEl);
  const badges = [];
  for (let i = 0; i < BADGES; i++) badges.push(el('span', 'rw-badge', starRow));
  const coolBar = el('div', 'rw-cool', wantedEl);
  const coolFill = el('div', 'rw-coolfill', coolBar);
  // The objective arrow and its distance sit beside the stars (the objective
  // system calls setObjective each frame).
  const objEl = el('div', 'rw-objcell rw-pill rw-none', stackEl);
  objEl.setAttribute('aria-hidden', 'true');
  const objArrow = el('i', 'rw-objarrow', objEl);
  objArrow.innerHTML = '<svg viewBox="0 0 24 24"><path d="M12 2 L21 21 L12 16 L3 21 Z" fill="#ffd34d" stroke="#1a120d" stroke-width="2" stroke-linejoin="round"/></svg>';
  const objText = el('span', 'rw-objdist', objEl);

  // speed (a craft only) beside the minimap, and the prompt strip at the bottom
  const speedBox = el('div', 'rw-speedbox rw-pill rw-none', hud);
  const speedEl = el('div', 'rw-speed', speedBox);
  const speedNum = document.createTextNode('0');
  speedEl.appendChild(speedNum);
  el('small', 'rw-unit', speedEl).textContent = 'mph';
  const vehBar = bar('rw-vehbar', speedBox);
  // Boost meter (src/entities/boost.js): a thin bar under the speed readout,
  // in a craft that can boost only. It moves down past the health slot and the clock.
  const boostEl = el('div', 'rw-boostbar rw-none', hud);
  boostEl.setAttribute('role', 'meter');
  boostEl.setAttribute('aria-label', 'Boost');
  boostEl.setAttribute('aria-valuemin', '0');
  boostEl.setAttribute('aria-valuemax', '100');
  const boostFill = el('div', 'rw-boostfill', boostEl);
  const promptEl = el('div', 'rw-prompt rw-pill rw-none', hud);
  // The street label (city.streetAt): one small line under the minimap.
  const streetEl = el('div', 'rw-street rw-pill rw-none', hud);
  const streetName = document.createTextNode('');
  streetEl.appendChild(streetName);
  // GPS turn pill in the stack's second row: arrow, "200 ft · SW 1st Ave".
  const navEl = el('div', 'rw-nav rw-none', stackEl);
  navEl.setAttribute('role', 'status');
  const navIcon = el('i', 'rw-navicon', navEl);
  navIcon.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d=""/></svg>';
  const navPath = navIcon.querySelector('path');
  const navText = el('span', 'rw-navtext', navEl);
  const navTextNode = document.createTextNode('');
  navText.appendChild(navTextNode);
  const navRem = el('span', 'rw-navrem', navEl);

  let fullMode = false;

  // cached last values (undefined forces the first write)
  const last = {
    mode: undefined, speed: undefined,
    score: undefined, pending: undefined, combo: undefined, wanted: undefined, cool: undefined, district: undefined, clock: undefined,
    veh: undefined, prompt: null, health: undefined, meter: undefined, meterOn: undefined, meterCraft: undefined,
    fx: undefined, boost: undefined, boostOn: undefined, boostLock: undefined,
    objOn: undefined, objAngle: 1e9, objDist: undefined,
    navOn: false, navKind: '', navText: '', navSoon: false, street: '', streetOn: false, alert: null, streetLabel: true,
  };
  // The stack timers run on UI time, 10 times a second (never game logic).
  let clockMs = typeof performance !== 'undefined' ? performance.now() : 0;
  const clockTimer = setInterval(() => {
    const now = typeof performance !== 'undefined' ? performance.now() : clockMs + 100;
    const dt = Math.min(0.25, (now - clockMs) / 1000);
    clockMs = now;
    tick(dt);
  }, 100);

  function setBar(b, pct) {
    b.fill.style.width = pct + '%';
    b.box.classList.toggle('rw-low', pct <= 25);
  }

  function update(s) {
    if (s.mode !== last.mode) {
      last.mode = s.mode;
      speedBox.classList.toggle('rw-none', s.mode === 'foot');
    }
    const speed = Math.round(speedMph(s.speedKmh));
    if (speed !== last.speed) {
      last.speed = speed;
      speedNum.nodeValue = String(speed);
    }
    const score = s.score > 0 ? Math.floor(s.score) : 0;
    if (score !== last.score) {
      last.score = score;
      scoreEl.textContent = score.toLocaleString('en-US');
    }
    const pending = s.pending > 0 ? Math.floor(s.pending) : 0;
    const combo = s.combo > 1 ? s.combo : 1;
    if (pending !== last.pending || combo !== last.combo) {
      last.pending = pending;
      last.combo = combo;
      comboEl.style.display = pending > 0 ? '' : 'none';
      if (pending > 0) comboEl.textContent = '+' + pending.toLocaleString('en-US') + (combo > 1 ? '  x' + combo : '');
    }
    // Stars 0..5 (s.stars, else the heat level); shown only while wanted.
    const stars = s.stars !== undefined ? s.stars : s.wanted;
    if (stars !== last.wanted) {
      last.wanted = stars;
      wantedEl.classList.toggle('rw-none', !(stars > 0));
      wantedEl.classList.toggle('rw-hot', stars >= 3);
      for (let i = 0; i < BADGES; i++) badges[i].classList.toggle('rw-on', i < stars);
      wantedEl.setAttribute('aria-label', 'Police attention: ' + (stars > 0 ? stars + ' of ' + BADGES + ' stars' : 'none'));
      stack.setWanted(stars > 0);
    }
    const cool = stars > 0 && s.cooling > 0 ? Math.round(Math.min(1, s.cooling) * 50) : 0;
    if (cool !== last.cool) {
      last.cool = cool;
      coolFill.style.transform = 'scaleX(' + (cool / 50).toFixed(2) + ')';
      wantedEl.classList.toggle('rw-cooling', cool > 0);
    }
    if (s.health !== last.health) {
      last.health = s.health;
    }
    if (s.district !== last.district) {
      last.district = s.district;
      if (s.district) stack.add('district', s.district, 3);
    }
    const minutes = Math.floor(s.time * 60) % 1440;
    if (minutes !== last.clock) {
      last.clock = minutes;
      clockEl.textContent = formatClock12(minutes);
    }
    const meterOn = s.mortal === true;
    if (meterOn !== last.meterOn) {
      last.meterOn = meterOn;
      meter.classList.toggle('rw-none', !meterOn);
      boostEl.classList.toggle('rw-hp', meterOn);
    }
    if (meterOn) {
      const pct = meterPercent(s.health, s.maxHealth || 100, s.vehicleHealth);
      const craft = s.vehicleHealth !== null && s.vehicleHealth !== undefined;
      if (pct !== last.meter || craft !== last.meterCraft) {
        last.meter = pct;
        last.meterCraft = craft;
        meterFill.style.transform = 'scaleX(' + (pct / 100).toFixed(2) + ')';
        meterFill.style.background = 'hsl(' + Math.round(pct * 1.2) + ', 70%, 48%)';
        meterText.textContent = (craft ? 'CRAFT ' : 'HP ') + pct;
        meter.classList.toggle('rw-low', pct <= 25);
        meter.setAttribute('aria-valuenow', String(pct));
      }
    }
    // s.boost: the meter 0..1, or below 0 / missing when the craft cannot boost.
    const bp = s.boost >= 0 ? Math.round(Math.min(1, s.boost) * 100) : -1;
    if (bp !== last.boost) {
      last.boost = bp;
      boostEl.classList.toggle('rw-none', bp < 0);
      if (bp >= 0) {
        boostFill.style.transform = 'scaleX(' + (bp / 100).toFixed(2) + ')';
        boostEl.setAttribute('aria-valuenow', String(bp));
      }
    }
    const fx = s.boostFx > 0 ? Math.round(Math.min(1, s.boostFx) * 20) : 0;
    if (fx !== last.fx) { last.fx = fx; lines.style.opacity = fx === 0 ? '' : (fx * 0.03).toFixed(2); }
    const bon = s.boostOn === true, block = s.boostLock === true;
    if (bon !== last.boostOn) { last.boostOn = bon; boostEl.classList.toggle('rw-on', bon); }
    if (block !== last.boostLock) { last.boostLock = block; boostEl.classList.toggle('rw-spent', block); }
    const veh = s.vehicleHealth === null ? -1 : Math.round(s.vehicleHealth * 100);
    if (veh !== last.veh) {
      last.veh = veh;
      vehBar.box.classList.toggle('rw-empty', veh < 0);
      if (veh >= 0) setBar(vehBar, veh);
    }
  }

  // Paint the two message rows from the stack state (only on change).
  function paintRows() {
    for (let i = 0; i < 2; i++) {
      const r = stack.rows[i], m = msgEls[i];
      if (r.rev !== msgRev[i]) {
        msgRev[i] = r.rev;
        msgOut[i] = false;
        m.classList.remove('rw-out');
        if (r.kind) {
          m.textContent = r.text;
          m.className = 'rw-msg rw-m' + (i + 1) + ' rw-pill rw-k-' + r.kind + (r.kind === 'district' ? ' rw-title' : ' rw-toast');
          m.hidden = false;
          // restart the slide-in
          void m.offsetWidth;
          m.classList.add('rw-in');
        } else {
          m.hidden = true;
          m.classList.remove('rw-in');
        }
      }
      const out = !!r.kind && r.left < 0.3;
      if (out !== msgOut[i]) { msgOut[i] = out; m.classList.toggle('rw-out', out); }
    }
  }

  // Advance the stack timers: seconds of UI time (the game calls update every frame).
  function tick(dt) {
    if (!(dt > 0)) return;
    stack.tick(dt);
    paintRows();
  }

  // hud.toast(text, seconds, kind): kind picks the row and the priority
  // ('police', 'objective', 'district', 'hint', 'score', 'info'); callers that
  // pass none get a kind from the text. Nobody places their own top center text.
  function toast(text, seconds = 3, kind) {
    stack.add(toastKind(text, kind), String(text), seconds);
    paintRows();
  }

  // Objective arrow and distance (status row), driven by systems/objective.js.
  function setObjective(on, angle, distText) {
    const v = !!on;
    if (v !== last.objOn) { last.objOn = v; objEl.classList.toggle('rw-none', !v); }
    if (!v) return;
    const a = Math.round(angle || 0);
    if (a !== last.objAngle) { last.objAngle = a; objArrow.style.transform = 'rotate(' + a + 'deg)'; }
    if (distText !== last.objDist) { last.objDist = distText; objText.textContent = distText; navRem.textContent = distText; }
  }

  // The bottom prompt. A red alert (setAlert) takes the strip over while it
  // lasts; the normal prompt comes back after it.
  function paintPrompt() {
    const v = last.alert || last.prompt;
    promptEl.classList.toggle('rw-none', !v);
    promptEl.classList.toggle('rw-alert', !!last.alert);
    if (v) promptEl.textContent = v;
  }
  function setPrompt(text) {
    const v = text || null;
    if (v === last.prompt) return;
    last.prompt = v;
    paintPrompt();
  }
  // A short red prompt ("Get out!" in a burning car), or null to clear it.
  function setAlert(text) {
    const v = text || null;
    if (v === last.alert) return;
    last.alert = v;
    promptEl.classList.remove('rw-in');
    paintPrompt();
    if (v) { void promptEl.offsetWidth; promptEl.classList.add('rw-in'); }
  }

  // GPS turn pill: on, the turn kind (NAV_KINDS), the one line ("200 ft ·
  // SW 1st Ave"), soon (the turn is near: amber). The older call with two
  // lines (l1, l2) still works: they are joined with " · ". Called every
  // frame; touches the DOM only on change.
  function setNav(on, kind, text, l2, soon) {
    const v = !!on;
    if (v !== last.navOn) { last.navOn = v; navEl.classList.toggle('rw-none', !v); stackEl.classList.toggle('rw-navon', v); }
    if (!v) return;
    if (kind !== last.navKind) { last.navKind = kind; navPath.setAttribute('d', ARROW[kind] || ARROW.depart); }
    const t = l2 ? (text || '') + ' \u00b7 ' + l2 : (text || '');
    if (t !== last.navText) { last.navText = t; navTextNode.nodeValue = t; }
    const sn = !!soon;
    if (sn !== last.navSoon) { last.navSoon = sn; navEl.classList.toggle('rw-soon', sn); }
  }
  // The street label under the minimap: "Alton Rd" (the cross street is not shown).
  function setStreet(name) {
    const n = name || '';
    const on = !!n;
    if (on !== last.streetOn) { last.streetOn = on; streetEl.classList.toggle('rw-none', !on); }
    if (n !== last.street) { last.street = n; streetName.nodeValue = n; }
  }
  // Settings, Game, "Street names": the label under the minimap on (default) or off.
  function setStreetLabel(on) {
    const v = on !== false;
    if (v === last.streetLabel) return;
    last.streetLabel = v;
    hud.classList.toggle('rw-nostreet', !v);
  }

  // 'minimal' (default) or 'full': Full shows the clock (and the touch layer keeps its fan open).
  function setHudMode(mode) {
    const full = mode === 'full';
    if (full === fullMode) return;
    fullMode = full;
    hud.classList.toggle('rw-full', full);
  }

  function dispose() {
    clearInterval(clockTimer);
    for (const t of timers) clearTimeout(t);
    timers.clear();
    hud.remove();
  }

  return { update, toast, tick, setObjective, canHint: stack.canHint, stack, setPrompt, setAlert, setNav, setStreet, setStreetLabel, setHudMode, dispose, minimapCanvas, getHudMode: () => (fullMode ? 'full' : 'minimal') };
}
