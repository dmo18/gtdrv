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

export const FADE_MS = 4000; // score, combo and heat dim after this long unchanged
export const MAP_SHRINK_MS = 5000; // the expanded minimap shrinks after this long untouched

export function createHud(root) {
  injectStyles();
  if (getComputedStyle(root).position === 'static') root.style.position = 'relative';

  const hud = el('div', 'rw-hud', root);
  const timers = new Set();
  const later = (fn, ms) => {
    const t = setTimeout(() => { timers.delete(t); fn(); }, ms);
    timers.add(t);
    return t;
  };
  const stop = (t) => { if (t) { clearTimeout(t); timers.delete(t); } };

  // top-left: minimap (tap to grow), district name, clock (Full only)
  const tl = el('div', 'rw-tl', hud);
  const minimapCanvas = el('canvas', 'rw-minimap', tl);
  minimapCanvas.width = 176;
  minimapCanvas.height = 176;
  minimapCanvas.tabIndex = -1;
  minimapCanvas.setAttribute('role', 'button');
  minimapCanvas.setAttribute('aria-label', 'Mini-map (tap to enlarge)');
  minimapCanvas.setAttribute('aria-expanded', 'false');
  const districtEl = el('div', 'rw-district', tl);
  const clockEl = el('div', 'rw-clock', tl);
  // Hard mode only: health under the minimap (walker hp, or the craft's health aboard).
  const meter = el('div', 'rw-hpmeter rw-none', tl);
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

  // top-centre: toasts
  const toasts = el('div', 'rw-toasts', hud);

  // top-right: score, the points waiting on the combo, and police attention
  const tr = el('div', 'rw-tr', hud);
  let fadeTimer = 0;
  let fullMode = false;
  // Back to full strength now, dim again after FADE_MS without a change.
  function bump() {
    stop(fadeTimer);
    fadeTimer = 0;
    tr.classList.remove('rw-faded');
    if (!fullMode) fadeTimer = later(() => tr.classList.add('rw-faded'), FADE_MS);
  }
  const scoreEl = el('div', 'rw-money rw-score', tr);
  const comboEl = el('div', 'rw-combo', tr);
  comboEl.style.display = 'none';
  const wantedEl = el('div', 'rw-wanted rw-none', tr);
  wantedEl.setAttribute('role', 'img');
  wantedEl.setAttribute('aria-label', 'Police attention: none');
  const BADGES = 4;
  const badges = [];
  for (let i = 0; i < BADGES; i++) badges.push(el('span', 'rw-badge', wantedEl));

  // bottom-centre: speed (car) and prompt
  const bottom = el('div', 'rw-bottom', hud);
  const speedBox = el('div', 'rw-speedbox rw-none', bottom);
  const speedEl = el('div', 'rw-speed', speedBox);
  const speedNum = document.createTextNode('0');
  speedEl.appendChild(speedNum);
  el('small', 'rw-unit', speedEl).textContent = 'km/h';
  const vehBar = bar('rw-vehbar', speedBox);
  const promptEl = el('div', 'rw-prompt rw-none', bottom);

  const titleEl = el('div', 'rw-title', hud);
  bump();

  // cached last values (undefined forces the first write)
  const last = {
    mode: undefined, speed: undefined,
    score: undefined, pending: undefined, combo: undefined, wanted: undefined, district: undefined, clock: undefined,
    veh: undefined, prompt: null, health: undefined, meter: undefined, meterOn: undefined, meterCraft: undefined,
  };

  function setBar(b, pct) {
    b.fill.style.width = pct + '%';
    b.box.classList.toggle('rw-low', pct <= 25);
  }

  function update(s) {
    if (s.mode !== last.mode) {
      last.mode = s.mode;
      speedBox.classList.toggle('rw-none', s.mode === 'foot');
    }
    const speed = Math.round(s.speedKmh);
    if (speed !== last.speed) {
      last.speed = speed;
      speedNum.nodeValue = String(speed);
    }
    const score = s.score > 0 ? Math.floor(s.score) : 0;
    if (score !== last.score) {
      const first = last.score === undefined;
      last.score = score;
      scoreEl.textContent = score.toLocaleString('en-US');
      if (!first) bump();
    }
    const pending = s.pending > 0 ? Math.floor(s.pending) : 0;
    const combo = s.combo > 1 ? s.combo : 1;
    if (pending !== last.pending || combo !== last.combo) {
      last.pending = pending;
      last.combo = combo;
      comboEl.style.display = pending > 0 ? '' : 'none';
      if (pending > 0) comboEl.textContent = '+' + pending.toLocaleString('en-US') + (combo > 1 ? '  x' + combo : '');
      bump();
    }
    if (s.wanted !== last.wanted) {
      last.wanted = s.wanted;
      wantedEl.classList.toggle('rw-none', s.wanted <= 0);
      for (let i = 0; i < BADGES; i++) badges[i].classList.toggle('rw-on', i < s.wanted);
      wantedEl.setAttribute('aria-label', 'Police attention: ' + (s.wanted > 0 ? s.wanted + ' of ' + BADGES : 'none'));
      bump();
    }
    if (s.health !== last.health) {
      if (last.health !== undefined && s.health < last.health) bump(); // hurt
      last.health = s.health;
    }
    if (s.district !== last.district) {
      last.district = s.district;
      districtEl.textContent = s.district;
      districtEl.classList.remove('rw-show');
      void districtEl.offsetWidth;
      districtEl.classList.add('rw-show');
      titleEl.textContent = s.district;
      // restart the CSS animation
      titleEl.classList.remove('rw-show');
      void titleEl.offsetWidth;
      titleEl.classList.add('rw-show');
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
    const veh = s.vehicleHealth === null ? -1 : Math.round(s.vehicleHealth * 100);
    if (veh !== last.veh) {
      last.veh = veh;
      vehBar.box.classList.toggle('rw-empty', veh < 0);
      if (veh >= 0) setBar(vehBar, veh);
    }
  }

  function toast(text, seconds = 3) {
    const t = el('div', 'rw-toast', toasts);
    t.textContent = text;
    while (toasts.children.length > 2) toasts.firstChild.remove();
    const fade = setTimeout(() => {
      timers.delete(fade);
      t.classList.add('rw-out');
      const gone = setTimeout(() => { timers.delete(gone); t.remove(); }, 320);
      timers.add(gone);
    }, Math.max(0.2, seconds) * 1000);
    timers.add(fade);
  }

  function setPrompt(text) {
    const v = text || null;
    if (v === last.prompt) return;
    last.prompt = v;
    promptEl.classList.toggle('rw-none', !v);
    if (v) promptEl.textContent = v;
  }

  // 'minimal' (default) or 'full': Full never fades and shows the clock.
  function setHudMode(mode) {
    const full = mode === 'full';
    if (full === fullMode) return;
    fullMode = full;
    hud.classList.toggle('rw-full', full);
    bump();
  }

  function dispose() {
    for (const t of timers) clearTimeout(t);
    timers.clear();
    hud.remove();
  }

  return { update, toast, setPrompt, setHudMode, dispose, minimapCanvas, getHudMode: () => (fullMode ? 'full' : 'minimal') };
}
