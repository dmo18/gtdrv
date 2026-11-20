// The pause menu: Resume, Showroom, Records, Settings and How to play.
// All text goes through textContent / DOM APIs, never innerHTML.
import { AIRCRAFT_SPECS } from '../entities/aircraft.js';
import { BOAT_SPECS } from '../entities/boat.js';
import { CATALOG } from '../systems/economy.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const STYLE_ID = 'rw-menu-style';

const CSS = `
.rw-menu {
  --rw-accent: #e2733a; --rw-accent-soft: rgba(226,115,58,0.78);
  --rw-text: #f6efe6; --rw-dim: rgba(246,239,230,0.66);
  --rw-panel: rgba(24,18,15,0.82); --rw-panel-edge: rgba(246,239,230,0.22);
  --rw-sl: env(safe-area-inset-left, 0px); --rw-sr: env(safe-area-inset-right, 0px);
  --rw-st: env(safe-area-inset-top, 0px); --rw-sb: env(safe-area-inset-bottom, 0px);
  position: fixed; inset: 0; z-index: 40; display: none;
  padding: calc(8px + var(--rw-st)) calc(10px + var(--rw-sr)) calc(8px + var(--rw-sb)) calc(10px + var(--rw-sl));
  background: rgba(12,9,8,0.72); color: var(--rw-text);
  font-family: system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  font-size: 15px; line-height: 1.35; touch-action: pan-y;
  -webkit-tap-highlight-color: transparent;
}
.rw-menu.rw-menu-open { display: flex; gap: 10px; }
.rw-menu *, .rw-menu *::before, .rw-menu *::after { box-sizing: border-box; }
.rw-menu-rail {
  flex: 0 0 150px; display: flex; flex-direction: column; gap: 4px; overflow-y: auto;
  padding: 6px; border-radius: 18px; background: var(--rw-panel); border: 1px solid var(--rw-panel-edge);
}
.rw-menu-tab, .rw-menu-btn, .rw-menu-seg button {
  min-height: 56px; border-radius: 14px; border: 2px solid transparent; color: var(--rw-text);
  background: rgba(246,239,230,0.08); font: inherit; font-weight: 600; font-size: 16px;
  padding: 0 14px; cursor: pointer; touch-action: manipulation;
}
.rw-menu-tab { text-align: left; width: 100%; flex: 0 0 auto; }
.rw-menu-tab[aria-selected="true"] { background: var(--rw-accent); color: #1b120d; }
.rw-menu-btn.rw-menu-primary { background: var(--rw-accent); color: #1b120d; }
.rw-menu-btn.rw-menu-danger { background: #a63a2a; }
.rw-menu-btn:disabled { opacity: 0.55; cursor: default; }
.rw-menu button:focus-visible, .rw-menu input:focus-visible { outline: 3px solid #ffd9a8; outline-offset: 2px; }
.rw-menu-main {
  flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column;
  border-radius: 18px; background: var(--rw-panel); border: 1px solid var(--rw-panel-edge);
}
.rw-menu-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 10px 16px 4px; }
.rw-menu-title { margin: 0; font-size: 20px; }
.rw-menu-money { font-weight: 700; color: #ffd08a; font-variant-numeric: tabular-nums; }
.rw-menu-body { flex: 1 1 auto; overflow-y: auto; -webkit-overflow-scrolling: touch; overscroll-behavior: contain; padding: 8px 16px 16px; }
.rw-menu-body p { margin: 0 0 8px; }
.rw-menu-dim { color: var(--rw-dim); }
.rw-menu-cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap: 10px; }
.rw-menu-card { padding: 10px 12px; border-radius: 14px; background: rgba(246,239,230,0.07); border: 1px solid var(--rw-panel-edge); display: flex; flex-direction: column; gap: 6px; }
.rw-menu-card h3 { margin: 0; font-size: 17px; }
.rw-menu-card svg { width: 100%; max-width: 150px; height: 56px; color: var(--rw-accent); }
.rw-menu-cardtop { display: flex; align-items: center; gap: 10px; }
.rw-menu-bar { display: grid; grid-template-columns: 84px 1fr; align-items: center; gap: 8px; font-size: 13px; color: var(--rw-dim); }
.rw-menu-track { height: 8px; border-radius: 4px; background: rgba(246,239,230,0.14); overflow: hidden; }
.rw-menu-fill { height: 100%; background: var(--rw-accent); border-radius: 4px; }
.rw-menu-price { font-weight: 700; font-size: 18px; }
.rw-menu-group { margin: 10px 0 4px; font-size: 14px; letter-spacing: 0.06em; text-transform: uppercase; color: var(--rw-accent); }
.rw-menu-row { display: flex; justify-content: space-between; align-items: center; gap: 10px; min-height: 40px; padding: 4px 0; border-bottom: 1px solid rgba(246,239,230,0.1); }
.rw-menu-medal { display: inline-block; width: 12px; height: 12px; border-radius: 50%; margin-right: 6px; vertical-align: -1px; }
.rw-menu-stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(130px, 1fr)); gap: 8px; margin-bottom: 6px; }
.rw-menu-stat { padding: 8px 12px; border-radius: 12px; background: rgba(246,239,230,0.07); }
.rw-menu-stat b { display: block; font-size: 20px; }
.rw-menu-setting { display: flex; align-items: center; justify-content: space-between; gap: 12px; min-height: 56px; padding: 4px 0; border-bottom: 1px solid rgba(246,239,230,0.1); flex-wrap: wrap; }
.rw-menu-setting input[type=range] { flex: 1 1 160px; min-height: 56px; accent-color: var(--rw-accent); }
.rw-menu-switch { min-width: 92px; }
.rw-menu-switch[aria-checked="true"] { background: var(--rw-accent); color: #1b120d; }
.rw-menu-seg { display: flex; gap: 6px; }
.rw-menu-seg button[aria-checked="true"] { background: var(--rw-accent); color: #1b120d; }
.rw-menu-confirm { display: flex; gap: 8px; flex-wrap: wrap; }
.rw-menu ul { margin: 0 0 10px; padding-left: 20px; }
.rw-menu li { margin-bottom: 4px; }
.rw-menu-resume { display: flex; flex-direction: column; gap: 12px; align-items: flex-start; }
.rw-menu-resume .rw-menu-btn { min-width: 220px; font-size: 20px; }
@media (prefers-reduced-motion: no-preference) {
  .rw-menu.rw-menu-open { animation: rw-menu-in 0.15s ease-out; }
  .rw-menu-fill { transition: width 0.3s; }
}
@keyframes rw-menu-in { from { opacity: 0; } to { opacity: 1; } }
@media (max-height: 380px) {
  .rw-menu { font-size: 14px; }
  .rw-menu-rail { flex-basis: 132px; }
  .rw-menu-card svg { height: 44px; }
}
`;

const TABS = [
  ['resume', 'Resume'], ['showroom', 'Showroom'], ['records', 'Records'],
  ['settings', 'Settings'], ['howto', 'How to play'],
];
const MEDAL_COLORS = { bronze: '#c9803f', silver: '#c4cbd2', gold: '#f0c24a' };
const MAX_BY_KIND = {
  plane: { speed: 130, tough: 1000, handle: 6 },
  heli: { speed: 50, tough: 1000, handle: 1.6 },
  boat: { speed: 30, tough: 2500, handle: 2.3 },
};
// Silhouettes: plain path data written here, never taken from outside.
const ICONS = {
  jet: 'M4 30 L40 26 L58 4 L70 4 L64 26 L100 24 L116 30 L100 36 L64 34 L70 56 L58 56 L40 34 Z',
  stunt: 'M6 30 L30 27 L34 12 L44 12 L44 27 L88 25 L96 14 L104 14 L102 28 L114 30 L102 33 L100 46 L92 46 L88 35 L44 33 L44 48 L34 48 L30 33 Z',
  heavyheli: 'M4 22 L116 22 M60 22 L60 28 M16 36 Q18 28 40 28 L84 28 Q100 28 104 36 L112 30 L116 34 L106 44 Q96 46 60 46 L24 46 Q12 46 16 36 Z M26 50 L90 50',
  yacht: 'M4 38 L116 38 L100 54 L18 54 Z M26 38 L34 26 L82 26 L90 38 M44 26 L48 14 L72 14 L76 26',
};

const h = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
};
function button(text, cls, onClick, label) {
  const b = h('button', 'rw-menu-btn' + (cls ? ' ' + cls : ''), text);
  b.type = 'button';
  if (label) b.setAttribute('aria-label', label);
  b.addEventListener('click', onClick);
  return b;
}
function icon(id) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 120 60');
  svg.setAttribute('aria-hidden', 'true');
  const p = document.createElementNS(SVG_NS, 'path');
  p.setAttribute('d', ICONS[id]);
  p.setAttribute('fill', 'currentColor');
  p.setAttribute('stroke', 'currentColor');
  p.setAttribute('stroke-width', id === 'heavyheli' ? '3' : '2');
  p.setAttribute('stroke-linejoin', 'round');
  svg.appendChild(p);
  return svg;
}
const pretty = (id) => String(id).replace(/[_-]+/g, ' ').trim().replace(/\b[a-z]/g, (c) => c.toUpperCase());
const fmtTime = (s) => {
  const m = Math.floor(s / 60);
  return m + ':' + (s - m * 60).toFixed(1).padStart(4, '0');
};
const money = (n) => '$' + Math.round(n).toLocaleString('en-US');

export function createMenu(root, game, economy) {
  if (!document.getElementById(STYLE_ID)) {
    const st = document.createElement('style');
    st.id = STYLE_ID;
    st.textContent = CSS;
    document.head.appendChild(st);
  }
  const el = h('div', 'rw-menu');
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-modal', 'true');
  el.setAttribute('aria-label', 'Game menu');
  const rail = h('div', 'rw-menu-rail');
  rail.setAttribute('role', 'tablist');
  rail.setAttribute('aria-label', 'Menu sections');
  const main = h('div', 'rw-menu-main');
  const head = h('div', 'rw-menu-head');
  const title = h('h2', 'rw-menu-title');
  const moneyEl = h('span', 'rw-menu-money');
  moneyEl.setAttribute('aria-label', 'Money');
  head.append(title, moneyEl);
  const body = h('div', 'rw-menu-body');
  body.tabIndex = -1;
  main.append(head, body);
  el.append(rail, main);
  root.appendChild(el);

  const tabButtons = {};
  for (const [id, label] of TABS) {
    const b = h('button', 'rw-menu-tab', label);
    b.type = 'button';
    b.setAttribute('role', 'tab');
    b.setAttribute('aria-label', label);
    b.addEventListener('click', () => show(id));
    rail.appendChild(b);
    tabButtons[id] = b;
  }

  let active = 'resume';
  let opened = false;
  let confirmReset = false;

  const settings = () => game.progress.settings;
  function applySettings() {
    if (economy && economy.applySettings) { economy.applySettings(); return; }
    const s = settings();
    if (game.audio && game.audio.setVolume) game.audio.setVolume({ master: s.master });
    if (game.input) game.input.invertPitch = s.invertPitch;
    if (game.touch && game.touch.setLeftHanded) game.touch.setLeftHanded(s.leftHanded);
    if (game.quality !== s.quality) {
      game.quality = s.quality;
      if (game.resize) game.resize();
    }
  }
  const commit = () => { applySettings(); game.events.emit('progress'); };

  // ---------- tab renderers ----------
  function renderResume() {
    const box = h('div', 'rw-menu-resume');
    box.appendChild(h('p', 'rw-menu-dim', 'The game is paused. Your progress is saved automatically.'));
    const r = button('Resume', 'rw-menu-primary', close, 'Resume game');
    r.dataset.role = 'resume';
    box.appendChild(r);
    body.appendChild(box);
  }

  function bar(label, frac) {
    const row = h('div', 'rw-menu-bar');
    row.appendChild(h('span', '', label));
    const track = h('div', 'rw-menu-track');
    const fill = h('div', 'rw-menu-fill');
    fill.style.width = Math.round(Math.max(0.05, Math.min(1, frac)) * 100) + '%';
    track.appendChild(fill);
    row.appendChild(track);
    return row;
  }

  function renderShowroom() {
    const cards = h('div', 'rw-menu-cards');
    for (const id of Object.keys(CATALOG)) {
      const info = CATALOG[id];
      const spec = AIRCRAFT_SPECS[id] || BOAT_SPECS[id];
      if (!spec) continue;
      const kind = BOAT_SPECS[id] ? 'boat' : spec.kind;
      const cap = MAX_BY_KIND[kind];
      const handle = kind === 'plane' ? spec.rollRate : kind === 'heli' ? spec.yawRate : spec.turnRate;
      const card = h('div', 'rw-menu-card');
      card.dataset.spec = id;
      const top = h('div', 'rw-menu-cardtop');
      const names = h('div');
      names.append(h('h3', '', spec.label), h('div', 'rw-menu-dim', info.where));
      top.append(icon(id), names);
      card.append(top,
        bar(Math.round(spec.maxSpeed * 3.6) + ' km/h', spec.maxSpeed / cap.speed),
        bar('Handling', handle / cap.handle),
        bar('Toughness', spec.health / cap.tough));
      const foot = h('div', 'rw-menu-setting');
      foot.style.borderBottom = '0';
      foot.appendChild(h('span', 'rw-menu-price', money(info.price)));
      const owned = economy.owns(id);
      const need = info.price - game.progress.money;
      let b;
      if (owned) {
        b = button('Owned', '', () => {}, spec.label + ' owned');
        b.disabled = true;
      } else if (need > 0) {
        b = button('Need ' + money(need) + ' more', '', () => {}, 'Cannot buy ' + spec.label + ', need ' + money(need) + ' more');
        b.disabled = true;
      } else {
        b = button('Buy', 'rw-menu-primary', () => {
          if (economy.buy(id) && game.hud && game.hud.toast) game.hud.toast(spec.label + ' bought', 2);
          render();
        }, 'Buy ' + spec.label + ' for ' + money(info.price));
      }
      b.dataset.buy = id;
      foot.appendChild(b);
      card.appendChild(foot);
      cards.appendChild(card);
    }
    body.appendChild(cards);
  }

  function renderRecords() {
    const p = game.progress;
    const stats = h('div', 'rw-menu-stats');
    const add = (v, label) => {
      const s = h('div', 'rw-menu-stat');
      s.append(h('b', '', v), h('span', 'rw-menu-dim', label));
      stats.appendChild(s);
    };
    add((p.stats.distance / 1000).toFixed(1) + ' km', 'Distance travelled');
    add(String(Math.floor(p.stats.races)), 'Races');
    add(String(Math.floor(p.stats.flights)), 'Flights');
    body.appendChild(stats);

    const courses = (game.activities && Array.isArray(game.activities.courses)) ? game.activities.courses : [];
    const names = new Map();
    for (const c of courses) if (c && typeof c.id === 'string') names.set(c.id, String(c.name || ''));
    const ids = new Set();
    for (const k of Object.keys(p.medals)) if (!k.startsWith('seen_')) ids.add(k);
    for (const k of Object.keys(p.bestTimes)) ids.add(k);
    const seen = Object.keys(p.medals).filter((k) => k.startsWith('seen_')).length;
    body.appendChild(h('p', 'rw-menu-dim', 'Areas explored: ' + seen));
    if (!ids.size) {
      body.appendChild(h('p', '', 'No records yet. Try a race or a flying challenge!'));
      return;
    }
    const groups = new Map();
    for (const id of [...ids].sort()) {
      const g = id.split(/[_-]/)[0];
      if (!groups.has(g)) groups.set(g, []);
      groups.get(g).push(id);
    }
    for (const [g, list] of groups) {
      body.appendChild(h('div', 'rw-menu-group', pretty(g)));
      for (const id of list) {
        const row = h('div', 'rw-menu-row');
        row.appendChild(h('span', '', names.get(id) || pretty(id)));
        const right = h('span', 'rw-menu-dim');
        const medal = p.medals[id];
        if (medal) {
          const dot = h('span', 'rw-menu-medal');
          dot.style.background = MEDAL_COLORS[medal];
          right.append(dot, medal + ' ');
        }
        if (p.bestTimes[id]) right.appendChild(document.createTextNode(fmtTime(p.bestTimes[id])));
        row.appendChild(right);
        body.appendChild(row);
      }
    }
  }

  function toggleRow(label, key) {
    const row = h('div', 'rw-menu-setting');
    row.appendChild(h('span', '', label));
    const on = settings()[key];
    const b = button(on ? 'On' : 'Off', 'rw-menu-switch', () => {
      settings()[key] = !settings()[key];
      commit();
      render();
    }, label);
    b.setAttribute('role', 'switch');
    b.setAttribute('aria-checked', String(on));
    b.dataset.setting = key;
    row.appendChild(b);
    return row;
  }

  function renderSettings() {
    const s = settings();
    const vol = h('div', 'rw-menu-setting');
    vol.appendChild(h('span', '', 'Master volume'));
    const slider = document.createElement('input');
    slider.type = 'range';
    slider.min = '0'; slider.max = '100'; slider.step = '1';
    slider.value = String(Math.round(s.master * 100));
    slider.setAttribute('aria-label', 'Master volume');
    slider.dataset.setting = 'master';
    slider.addEventListener('input', () => {
      settings().master = Number(slider.value) / 100;
      applySettings();
    });
    slider.addEventListener('change', () => commit());
    vol.appendChild(slider);
    body.appendChild(vol);

    body.appendChild(toggleRow('Invert flying stick', 'invertPitch'));
    body.appendChild(toggleRow('Left-handed layout', 'leftHanded'));
    body.appendChild(toggleRow('Police chases', 'police'));

    const q = h('div', 'rw-menu-setting');
    q.appendChild(h('span', '', 'Graphics quality'));
    const seg = h('div', 'rw-menu-seg');
    seg.setAttribute('role', 'radiogroup');
    seg.setAttribute('aria-label', 'Graphics quality');
    for (const [label, val] of [['Low', 0.75], ['Normal', 1], ['High', 1.25]]) {
      const b = h('button', '', label);
      b.type = 'button';
      b.setAttribute('role', 'radio');
      b.setAttribute('aria-checked', String(s.quality === val));
      b.dataset.quality = String(val);
      b.addEventListener('click', () => { settings().quality = val; commit(); render(); });
      seg.appendChild(b);
    }
    q.appendChild(seg);
    body.appendChild(q);

    const reset = h('div', 'rw-menu-setting');
    reset.style.borderBottom = '0';
    if (!confirmReset) {
      reset.appendChild(h('span', 'rw-menu-dim', 'Erase money, craft, records and settings.'));
      const b = button('Reset progress', 'rw-menu-danger', () => { confirmReset = true; render(); }, 'Reset progress');
      b.dataset.role = 'reset';
      reset.appendChild(b);
    } else {
      reset.setAttribute('role', 'alert');
      reset.appendChild(h('span', '', 'Really erase everything? This cannot be undone.'));
      const c = h('div', 'rw-menu-confirm');
      const yes = button('Yes, erase', 'rw-menu-danger', () => {
        confirmReset = false;
        economy.reset();
        render();
      }, 'Confirm reset progress');
      yes.dataset.role = 'reset-confirm';
      c.append(yes, button('Keep my game', '', () => { confirmReset = false; render(); }, 'Cancel reset'));
      reset.appendChild(c);
    }
    body.appendChild(reset);
  }

  function renderHowto() {
    const inv = settings().invertPitch;
    const sections = [
      ['Driving', ['Drag the steering pad on the left to turn. Use the pedals for gas and brake.',
        'Tap the handbrake to slide round tight corners.']],
      ['Boating', ['Throttle up to plane across the water. Steer gently; boats keep sliding after you turn.',
        'Pull up to a pier to get out.']],
      ['Flying a plane', ['Hold THRUST to speed up. Pick up speed on the runway before you climb.',
        inv ? 'Pull the stick down to climb and push it up to dive (the inverted stick setting is on).'
          : 'Push the stick up to climb and pull it down to dive (change this under Settings).',
        'Push the stick left or right to bank and turn. Ease off before landing and touch down gently.']],
      ['Helicopter', ['Raise the lift to take off and lower it to land. The stick moves you around and turns the nose.',
        'Heavy helicopters are slower to turn, so plan ahead.']],
      ['Getting in and out', ['Walk up to any craft and tap ENTER. Tap ENTER again to get out once you are slow enough.']],
      ['Map and races', ['Open the map to place a waypoint and see race starts.',
        'Finish races and challenges to earn medals and money, then spend it in the Showroom.']],
    ];
    for (const [t, items] of sections) {
      body.appendChild(h('div', 'rw-menu-group', t));
      const ul = h('ul');
      for (const i of items) ul.appendChild(h('li', '', i));
      body.appendChild(ul);
    }
  }

  const RENDERERS = { resume: renderResume, showroom: renderShowroom, records: renderRecords, settings: renderSettings, howto: renderHowto };

  function render() {
    const top = body.scrollTop;
    body.textContent = '';
    for (const [id, label] of TABS) {
      tabButtons[id].setAttribute('aria-selected', String(id === active));
      tabButtons[id].tabIndex = id === active ? 0 : -1;
      if (id === active) title.textContent = label;
    }
    moneyEl.textContent = money(game.progress.money);
    RENDERERS[active]();
    body.scrollTop = top;
  }

  function show(id) {
    if (!RENDERERS[id]) id = 'resume';
    if (id !== active) body.scrollTop = 0;
    active = id;
    if (id !== 'settings') confirmReset = false;
    render();
  }

  rail.addEventListener('keydown', (e) => {
    const i = TABS.findIndex(([id]) => id === active);
    let n = -1;
    if (e.key === 'ArrowDown' || e.key === 'ArrowRight') n = (i + 1) % TABS.length;
    if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') n = (i + TABS.length - 1) % TABS.length;
    if (n < 0) return;
    e.preventDefault();
    show(TABS[n][0]);
    tabButtons[TABS[n][0]].focus();
  });

  function reveal(tab) {
    opened = true;
    el.classList.add('rw-menu-open');
    if (game.touch && game.touch.setVisible) game.touch.setVisible(false);
    show(tab || active);
    tabButtons[active].focus({ preventScroll: true });
  }
  function hide() {
    if (!opened) return;
    opened = false;
    confirmReset = false;
    el.classList.remove('rw-menu-open');
    if (game.touch && game.touch.setVisible) game.touch.setVisible(true);
  }
  function open(tab) {
    reveal(tab);
    if (!game.paused) {
      game.paused = true;
      game.events.emit('pause', true);
    }
  }
  function close() {
    hide();
    if (game.paused) {
      game.paused = false;
      game.events.emit('pause', false);
    }
  }

  game.events.on('pause', (v) => {
    if (v) { if (!opened) reveal('resume'); } else hide();
  });
  const refresh = () => { if (opened) render(); };
  game.events.on('progress', refresh);
  game.events.on('purchase', refresh);

  return { open, close, isOpen: () => opened };
}
