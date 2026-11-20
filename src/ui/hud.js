// Heads-up display. update() runs every frame, so it only touches the DOM
// when a displayed value changed and allocates nothing when nothing did.
import { injectStyles } from './styles.js';

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

export function createHud(root) {
  injectStyles();
  if (getComputedStyle(root).position === 'static') root.style.position = 'relative';

  const hud = el('div', 'rw-hud', root);

  // top-left: minimap placeholder, district, clock
  const tl = el('div', 'rw-tl', hud);
  const minimapCanvas = el('canvas', 'rw-minimap', tl);
  minimapCanvas.width = 176;
  minimapCanvas.height = 176;
  const districtEl = el('div', 'rw-district', tl);
  const clockEl = el('div', 'rw-clock', tl);

  // top-centre: toasts
  const toasts = el('div', 'rw-toasts', hud);

  // top-right: money and police attention (nobody can be hurt in this game)
  const tr = el('div', 'rw-tr', hud);
  const moneyEl = el('div', 'rw-money', tr);
  const wantedEl = el('div', 'rw-wanted rw-none', tr);
  wantedEl.setAttribute('aria-label', 'Police attention');
  const BADGES = 3;
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

  // cached last values (undefined forces the first write)
  const last = {
    mode: undefined, speed: undefined,
    money: undefined, wanted: undefined, district: undefined, clock: undefined,
    veh: undefined, prompt: null,
  };
  const timers = new Set();

  function setBar(b, pct) {
    b.fill.style.width = pct + '%';
    b.box.classList.toggle('rw-low', pct <= 25);
  }

  function update(s) {
    if (s.mode !== last.mode) {
      last.mode = s.mode;
      speedBox.classList.toggle('rw-none', s.mode !== 'car');
    }
    const speed = Math.round(s.speedKmh);
    if (speed !== last.speed) {
      last.speed = speed;
      speedNum.nodeValue = String(speed);
    }
    if (s.money !== last.money) {
      last.money = s.money;
      moneyEl.textContent = '$' + s.money.toLocaleString('en-US');
    }
    if (s.wanted !== last.wanted) {
      last.wanted = s.wanted;
      wantedEl.classList.toggle('rw-none', s.wanted <= 0);
      for (let i = 0; i < BADGES; i++) badges[i].classList.toggle('rw-on', i < s.wanted);
    }
    if (s.district !== last.district) {
      last.district = s.district;
      districtEl.textContent = s.district;
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

  function dispose() {
    for (const t of timers) clearTimeout(t);
    timers.clear();
    hud.remove();
  }

  return { update, toast, setPrompt, dispose, minimapCanvas };
}
