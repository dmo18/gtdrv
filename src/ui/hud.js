import { speedMph } from '../core/units.js';
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

const pad2 = (n) => (n < 10 ? '0' + n : '' + n);

export const MAP_SHRINK_MS = 5000; // the expanded minimap shrinks after this long untouched

// ---------------------------------------------------------------------------
// The top centre stack (docs/REVAMP.md 6.12). Pure logic, no DOM: two message
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

  // top-centre stack (docs/REVAMP.md 6.12): status row (stars, objective arrow
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

  // top-centre: police attention (stars, then the escape meter), only while wanted
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

  let fullMode = false;

  // cached last values (undefined forces the first write)
  const last = {
    mode: undefined, speed: undefined,
    score: undefined, pending: undefined, combo: undefined, wanted: undefined, cool: undefined, district: undefined, clock: undefined,
    veh: undefined, prompt: null, health: undefined, meter: undefined, meterOn: undefined, meterCraft: undefined,
    fx: undefined, boost: undefined, boostOn: undefined, boostLock: undefined,
    objOn: undefined, objAngle: 1e9, objDist: undefined,
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
      clockEl.textContent = pad2(Math.floor(minutes / 60)) + ':' + pad2(minutes % 60);
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
  // pass none get a kind from the text. Nobody places their own top centre text.
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
    if (distText !== last.objDist) { last.objDist = distText; objText.textContent = distText; }
  }

  function setPrompt(text) {
    const v = text || null;
    if (v === last.prompt) return;
    last.prompt = v;
    promptEl.classList.toggle('rw-none', !v);
    if (v) promptEl.textContent = v;
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

  return { update, toast, tick, setObjective, canHint: stack.canHint, stack, setPrompt, setHudMode, dispose, minimapCanvas, getHudMode: () => (fullMode ? 'full' : 'minimal') };
}
