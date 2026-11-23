import { formatDistance, formatMiles, formatClock12 } from '../core/units.js';
import { createPhoneCheck, SOUNDS, SOUND_NOTES, DRIVE_SECONDS, SOUND_SECONDS } from './phonecheck.js';
import { fillAbout } from './title.js';
// The pause menu (docs/REVAMP.md 6.4): four sections (Resume, Stats,
// Settings, Help), Settings in four groups, destructive actions on their own
// confirm screens, and a registry for screens other systems add.
// All text goes through textContent / DOM APIs, never innerHTML.
import { setHandlingMode } from '../entities/vehicle.js';
import { volumeFromSettings } from '../audio/levels.js';
import { nextStation, stationInfo } from '../core/radio.js';
import { SECRET_DEFS, GARAGE_NAME } from '../world/secrets.js';
import { fillMapPicker, switchMap } from './mappicker.js';
import { mapName, pickerCurrent } from '../core/travel.js';
import { MAP_CHOICE_KEY } from '../world/maps.js';

const STYLE_ID = 'rw-menu-style';
const CREDIT = 'Map data (c) OpenStreetMap contributors, ODbL';

const CSS = `
.rw-menu {
  --rw-accent: #e2733a; --rw-accent-soft: rgba(226,115,58,0.78);
  --rw-text: #f6efe6; --rw-dim: rgba(246,239,230,0.74);
  --rw-panel: rgba(24,18,15,0.88); --rw-panel-edge: rgba(246,239,230,0.22);
  --rw-sl: max(env(safe-area-inset-left, 0px), var(--rw-test-sl, 0px)); --rw-sr: max(env(safe-area-inset-right, 0px), var(--rw-test-sr, 0px));
  --rw-st: max(env(safe-area-inset-top, 0px), var(--rw-test-st, 0px)); --rw-sb: max(env(safe-area-inset-bottom, 0px), var(--rw-test-sb, 0px));
  position: fixed; inset: 0; z-index: 40; display: none;
  padding: calc(4px + var(--rw-st)) calc(8px + var(--rw-sr)) calc(4px + var(--rw-sb)) calc(8px + var(--rw-sl));
  background: rgba(12,9,8,0.8); color: var(--rw-text);
  font-family: system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  font-size: 15px; line-height: 1.3; touch-action: pan-y;
  -webkit-tap-highlight-color: transparent;
}
.rw-menu.rw-menu-open { display: flex; gap: 8px; }
.rw-menu *, .rw-menu *::before, .rw-menu *::after { box-sizing: border-box; }
.rw-menu-side { flex: 0 0 132px; display: flex; flex-direction: column; gap: 8px; min-height: 0; }
.rw-menu-rail { display: flex; flex-direction: column; gap: 4px; }
.rw-menu button { font-family: inherit; color: var(--rw-text); cursor: pointer; touch-action: manipulation; }
.rw-menu-tab, .rw-menu-btn, .rw-menu-seg button, .rw-menu-back {
  min-height: 48px; border-radius: 12px; border: 2px solid transparent;
  background: rgba(246,239,230,0.1); font-weight: 600; font-size: 15px; padding: 0 12px;
}
.rw-menu-tab { text-align: left; width: 100%; flex: 0 0 auto; }
.rw-menu-tab[aria-selected="true"] { background: var(--rw-accent); color: #1b120d; }
.rw-menu-back { width: 48px; height: 48px; min-height: 48px; padding: 0; flex: 0 0 48px; display: flex; align-items: center; justify-content: center; }
.rw-menu-back svg { width: 26px; height: 26px; fill: none; stroke: currentColor; stroke-width: 2.4; stroke-linecap: round; stroke-linejoin: round; }
.rw-menu-btn.rw-menu-primary { background: var(--rw-accent); color: #1b120d; }
.rw-menu-btn.rw-menu-danger { background: #a63a2a; color: #fff; }
.rw-menu-btn:disabled { opacity: 0.55; cursor: default; }
.rw-menu button:focus-visible, .rw-menu input:focus-visible { outline: 3px solid #ffd9a8; outline-offset: 2px; }
.rw-menu-main {
  flex: 1 1 auto; min-width: 0; min-height: 0; display: flex; flex-direction: column; overflow: hidden;
  border-radius: 14px; background: var(--rw-panel); box-shadow: inset 0 0 0 1px var(--rw-panel-edge);
}
.rw-menu-head { flex: 0 0 48px; height: 48px; display: flex; align-items: center; gap: 8px; padding: 0 8px 0 14px; }
.rw-menu-title { margin: 0; font-size: 20px; flex: 1 1 auto; }
.rw-menu-version { font-size: 11px; opacity: 0.8; }
.rw-menu-points { font-weight: 700; color: #ffd08a; font-variant-numeric: tabular-nums; }
.rw-menu-groups { display: flex; gap: 4px; flex: 1 1 auto; }
.rw-menu-groups button { flex: 1 1 0; min-width: 0; height: 48px; min-height: 48px; margin: 0; padding: 0 6px; }
.rw-menu-groups button[aria-selected="true"] { background: var(--rw-accent); color: #1b120d; }
.rw-menu-body { flex: 1 1 auto; min-height: 0; overflow-y: auto; -webkit-overflow-scrolling: touch; overscroll-behavior: contain; padding: 0 12px 4px; }
.rw-menu-body p { margin: 0 0 8px; }
.rw-menu-dim { color: var(--rw-dim); }
.rw-menu-group { margin: 10px 0 4px; font-size: 14px; letter-spacing: 0.06em; text-transform: uppercase; color: var(--rw-accent); }
.rw-menu-row { display: flex; justify-content: space-between; align-items: center; gap: 10px; min-height: 28px; padding: 2px 0; }
.rw-menu-setting {
  display: flex; align-items: center; justify-content: space-between; gap: 10px; height: 48px; padding: 0;
  box-shadow: inset 0 -1px rgba(246,239,230,0.1);
}
.rw-menu-setting > span:first-child { flex: 0 0 auto; min-width: 7.5em; white-space: nowrap; }
.rw-menu-setting input[type=range] { flex: 1 1 120px; min-width: 0; height: 48px; margin: 0; accent-color: var(--rw-accent); }
.rw-menu-setting input[type=range]:disabled { opacity: 0.4; }
.rw-menu-value { flex: 0 0 3em; text-align: right; opacity: 0.9; font-variant-numeric: tabular-nums; }
.rw-menu-switch { min-width: 92px; }
.rw-menu-switch[aria-checked="true"] { background: var(--rw-accent); color: #1b120d; }
.rw-menu-seg { display: flex; gap: 4px; }
.rw-menu-seg button { min-width: 72px; }
.rw-menu-seg button[aria-checked="true"] { background: var(--rw-accent); color: #1b120d; }
.rw-menu-go { display: flex; align-items: center; justify-content: space-between; gap: 8px; min-width: 150px; }
.rw-menu-go::after { content: "\\203A"; font-size: 22px; line-height: 1; }
.rw-menu-confirm { display: flex; gap: 8px; flex: 0 0 auto; }
.rw-menu-confirm .rw-menu-btn { min-width: 112px; }
.rw-menu-confirmrow { display: flex; align-items: center; justify-content: space-between; gap: 12px; min-height: 64px; padding: 8px 0; box-shadow: inset 0 -1px rgba(246,239,230,0.1); }
.rw-menu-confirmrow > span { flex: 1 1 auto; }
.rw-menu-stats { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 8px; margin: 2px 0 8px; }
.rw-menu-stat { padding: 6px 10px; border-radius: 10px; background: rgba(246,239,230,0.08); min-height: 52px; overflow: hidden; }
.rw-menu-stat b { display: block; font-size: 18px; white-space: nowrap; }
.rw-menu-stat span { font-size: 12px; }
.rw-menu ul { margin: 0 0 10px; padding-left: 20px; }
.rw-menu li { margin-bottom: 4px; }
.rw-menu-hub { display: flex; flex-direction: column; gap: 12px; padding-top: 4px; }
.rw-menu-hub .rw-menu-primary { height: 64px; font-size: 22px; }
.rw-menu-tiles { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; }
.rw-menu-tile { min-height: 72px; display: flex; flex-direction: column; justify-content: center; align-items: flex-start; gap: 2px; text-align: left; }
.rw-menu-tile b { font-size: 17px; }
.rw-menu-tile span { font-size: 13px; font-weight: 500; color: var(--rw-dim); }
.rw-menu-steer { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; padding: 6px 0 8px; }
.rw-menu-btn.rw-menu-choice {
  min-height: 70px; display: flex; flex-direction: column; justify-content: center; align-items: flex-start;
  gap: 3px; padding: 8px 14px; text-align: left; line-height: 1.2;
}
.rw-menu-choice b { font-size: 17px; }
.rw-menu-choice span { font-size: 13px; font-weight: 500; color: var(--rw-dim); }
.rw-menu-choice[aria-checked="true"] { background: var(--rw-accent); color: #1b120d; border-color: #ffd9a8; }
.rw-menu-choice[aria-checked="true"] span { color: rgba(27,18,13,0.85); }
.rw-menu-maps { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; padding-top: 4px; }
.rw-menu-card { padding: 10px 12px; border-radius: 12px; background: rgba(246,239,230,0.08); display: flex; flex-direction: column; gap: 8px; min-height: 96px; }
.rw-menu-card[data-current="true"] { box-shadow: inset 0 0 0 2px var(--rw-accent); }
.rw-menu-card b { font-size: 18px; }
.rw-menu-ask {
  position: fixed; inset: 0; z-index: 41; display: flex; align-items: center; justify-content: center;
  padding: calc(8px + var(--rw-st)) calc(10px + var(--rw-sr)) calc(8px + var(--rw-sb)) calc(10px + var(--rw-sl));
  background: rgba(12,9,8,0.8);
}
.rw-menu-askbox {
  width: min(680px, 100%); max-height: 100%; overflow-y: auto; padding: 12px 16px 14px;
  border-radius: 18px; background: var(--rw-panel); box-shadow: inset 0 0 0 1px var(--rw-panel-edge);
}
.rw-menu-askbox h2 { margin: 0 0 2px; font-size: 20px; }
.rw-menu-askbox p { margin: 0; }
@media (max-height: 380px) {
  .rw-menu-btn.rw-menu-choice { min-height: 60px; padding: 6px 12px; }
  .rw-menu-askbox { padding: 8px 14px 10px; }
  .rw-menu-askbox h2 { font-size: 18px; }
}
.rw-about-h { margin: 10px 0 4px; font-size: 14px; letter-spacing: 0.06em; text-transform: uppercase; color: var(--rw-accent); font-weight: 700; }
.rw-menu-body .rw-about-p { margin: 0 0 6px; }
.rw-about-dim { color: var(--rw-dim); }
.rw-about-link { display: inline-flex; align-items: center; min-height: 48px; padding: 0 4px; color: #ffd08a; font-weight: 700; }
.rw-menu-sounds { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); grid-auto-flow: column; grid-template-rows: repeat(4, auto); gap: 4px 12px; margin: 4px 0 6px; padding: 0; list-style: none; }
.rw-menu-sounds li { margin: 0; display: flex; align-items: center; gap: 10px; min-height: 44px; }
.rw-menu-sounds .rw-menu-num { flex: 0 0 36px; height: 36px; border-radius: 18px; background: var(--rw-accent); color: #1b120d; font-weight: 800; display: flex; align-items: center; justify-content: center; }
.rw-menu-sounds b { display: block; font-size: 15px; }
.rw-menu-sounds span.rw-menu-note { display: block; font-size: 12px; color: var(--rw-dim); }
@media (prefers-reduced-motion: no-preference) {
  .rw-menu.rw-menu-open { animation: rw-menu-in 0.15s ease-out; }
}
@keyframes rw-menu-in { from { opacity: 0; } to { opacity: 1; } }
@media (max-height: 380px) {
  .rw-menu { font-size: 14px; }
  .rw-menu-tab, .rw-menu-btn, .rw-menu-seg button { font-size: 14px; }
  .rw-menu-seg button { min-width: 64px; }
  .rw-menu-stat { padding: 4px 8px; min-height: 48px; }
  .rw-menu-stat b { font-size: 16px; }
}
`;

const TABS = [['resume', 'Resume'], ['stats', 'Stats'], ['settings', 'Settings'], ['help', 'Help']];
const GROUPS = [['controls', 'Controls'], ['sound', 'Sound'], ['game', 'Game'], ['display', 'Display']];
const STEER_CHOICES = [
  ['wheel', 'Wheel', 'Turn the on-screen wheel with your thumb.'],
  ['buttons', 'Buttons', 'Hold the left or right arrow; the turn builds up.'],
  ['tilt', 'Tilt', 'Tilt your phone like a steering wheel.'],
  ['slider', 'Slider', 'Slide your thumb left and right on a pad.'],
];
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
const num = (n) => Math.round(n).toLocaleString('en-US');
const isFlag = (k) => k.startsWith('seen_') || k.startsWith('hint_');

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
  const side = h('div', 'rw-menu-side');
  const back = h('button', 'rw-menu-back');
  back.type = 'button';
  back.dataset.role = 'back';
  back.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg>';
  back.addEventListener('click', () => goBack());
  const rail = h('div', 'rw-menu-rail');
  rail.setAttribute('role', 'tablist');
  rail.setAttribute('aria-label', 'Menu sections');
  side.append(back, rail);
  const main = h('div', 'rw-menu-main');
  const head = h('div', 'rw-menu-head');
  const title = h('h2', 'rw-menu-title');
  const groupBar = h('div', 'rw-menu-groups');
  groupBar.setAttribute('role', 'tablist');
  groupBar.setAttribute('aria-label', 'Settings groups');
  const pointsEl = h('span', 'rw-menu-points');
  pointsEl.setAttribute('aria-label', 'Score');
  head.append(title, groupBar, pointsEl);
  const body = h('div', 'rw-menu-body');
  body.tabIndex = -1;
  main.append(head, body);
  el.append(side, main);
  root.appendChild(el);
  // __VERSION__ comes from package.json at build time (scripts/build.mjs).
  /* global __VERSION__ */
  const version = typeof __VERSION__ !== 'undefined' ? 'v' + __VERSION__ : '';

  const tabButtons = {};
  for (const [id, label] of TABS) {
    const b = h('button', 'rw-menu-tab', label);
    b.type = 'button';
    b.setAttribute('role', 'tab');
    b.setAttribute('aria-label', label);
    b.addEventListener('click', () => { parents.delete(id); show(id); });
    rail.appendChild(b);
    tabButtons[id] = b;
  }
  const groupButtons = {};
  for (const [id, label] of GROUPS) {
    const b = h('button', 'rw-menu-btn', label);
    b.type = 'button';
    b.setAttribute('role', 'tab');
    b.dataset.group = id;
    b.addEventListener('click', () => { group = id; armed = null; render(); });
    groupBar.appendChild(b);
    groupButtons[id] = b;
  }

  let active = 'resume';
  let group = 'controls';
  let opened = false;
  let armed = null; // key of the confirm row waiting for its second tap
  let phone = null; // the Phone check (created on first use)
  const parents = new Map(); // screen id -> the screen Back returns to
  const screens = new Map(); // registered screens: id -> { id, title, render }

  const settings = () => game.progress.settings;
  function applySettings() {
    // Time of day: a fixed time locks the clock; live resumes the cycle.
    const st = settings();
    if (game.daynight && game.daynight.setHour) {
      if (st.liveTime === false && Number.isFinite(st.timeOfDay)) {
        game.timeLocked = true;
        game.daynight.setHour(st.timeOfDay);
      } else {
        game.timeLocked = false;
      }
    }
    if (economy && economy.applySettings) { economy.applySettings(); return; }
    const s = settings();
    if (game.audio && game.audio.setVolume) game.audio.setVolume(volumeFromSettings(s));
    if (game.input) game.input.invertPitch = s.invertPitch;
    setHandlingMode(s.handling);
    if (game.touch && game.touch.setLeftHanded) game.touch.setLeftHanded(s.leftHanded);
    if (game.touch && game.touch.setSteering) game.touch.setSteering(s.steering, s.steerSensitivity);
    if (game.touch && game.touch.setHudMode) game.touch.setHudMode(s.hud);
    if (game.hud && game.hud.setHudMode) game.hud.setHudMode(s.hud);
    if (game.quality !== s.quality) {
      game.quality = s.quality;
      if (game.resize) game.resize();
    }
  }
  const commit = () => { applySettings(); game.events.emit('progress'); };
  // The Phone check starts from Settings, Display and from the Sound test screen.
  function startPhoneCheck() {
    if (!phone) phone = createPhoneCheck(game, root);
    close();
    if (!phone.start() && game.hud && game.hud.toast) game.hud.toast(phone.error() || 'The phone check cannot start here', 3, 'info');
  }

  // ---------- the api given to registered screens ----------
  // A row with the confirm rule (docs/REVAMP.md 6.4): the first tap swaps the
  // button for "Cancel" (in the same place, so a double tap cancels) and a red
  // "Yes, ..." beside it. The armed state ends on Cancel, on leaving the
  // screen and on closing the menu. No timer.
  function confirmRow(label, yesText, onYes, opts = {}) {
    const key = opts.id || label;
    const isArmed = armed === key;
    const row = h('div', 'rw-menu-confirmrow');
    row.dataset.confirm = key;
    row.appendChild(h('span', isArmed || !opts.dim ? '' : 'rw-menu-dim', opts.text || label));
    const c = h('div', 'rw-menu-confirm');
    if (!isArmed) {
      const b = button(opts.button || label, opts.danger ? 'rw-menu-danger' : '', () => { armed = key; render(); }, opts.button || label);
      b.dataset.role = opts.role || key;
      c.appendChild(b);
    } else {
      row.setAttribute('role', 'alert');
      const yes = button(yesText, 'rw-menu-danger', () => { armed = null; onYes(); }, yesText);
      yes.dataset.role = (opts.role || key) + '-confirm';
      const cancel = button('Cancel', '', () => { armed = null; render(); }, 'Cancel');
      cancel.dataset.role = (opts.role || key) + '-cancel';
      c.append(yes, cancel);
    }
    row.appendChild(c);
    return row;
  }
  const api = {
    back: () => goBack(),
    close: () => close(),
    go: (id) => go(id),
    confirmRow,
    rerender: () => render(),
    h, button,
    game,
  };

  // ---------- Resume (the hub) ----------
  function renderResume() {
    const box = h('div', 'rw-menu-hub');
    const r = button('Resume', 'rw-menu-primary', close, 'Resume game');
    r.dataset.role = 'resume';
    box.appendChild(r);
    const tiles = h('div', 'rw-menu-tiles');
    const ex = game.explore && game.explore.counts ? game.explore.counts() : null;
    const miami = !!(game.city && game.city.map);
    const tile = (role, name, sub, fn) => {
      const b = button('', 'rw-menu-tile', fn, name + (sub ? ', ' + sub : ''));
      b.dataset.role = role;
      b.append(h('b', '', name), h('span', '', sub));
      tiles.appendChild(b);
    };
    // The first two tiles belong to Miami (the classic island has no garages or adventures).
    if (miami && ex && screens.has('adventures')) tile('adventures', 'Adventures', ex.adventuresDone + ' / ' + ex.adventuresTotal, () => go('adventures'));
    if (miami && ex && screens.has('garages')) tile('garages', 'Garages', ex.garagesFound + ' / ' + ex.garagesTotal, () => go('garages'));
    tile('map', 'Map', 'Open the full map', () => {
      close();
      // The map system opens on the map button (systems/mapui.js).
      if (game.input && game.input.press) { game.input.press('map'); game.input.release('map'); }
    });
    if (game.city && game.city.region && game.session && game.session.travelTo) tile('travel', 'Travel', 'To another part of Miami', () => go('travel'));
    box.appendChild(tiles);
    body.appendChild(box);
  }

  // ---------- Stats: the old Scores and Records on one page ----------
  function renderStats() {
    const p = game.progress;
    const sc = p.score;
    const live = game.score;
    const stats = h('div', 'rw-menu-stats');
    const add = (v, label) => {
      const s = h('div', 'rw-menu-stat');
      s.append(h('b', '', v), h('span', 'rw-menu-dim', label));
      stats.appendChild(s);
    };
    add(num(live ? live.total : sc.total), 'Total score');
    add(num(sc.sessionBest), 'Best session');
    add(sc.best.combo > 0 ? 'x' + sc.best.combo : '-', 'Best combo');
    add(sc.best.jump > 0 ? formatDistance(sc.best.jump) : '-', 'Longest jump');
    add(sc.best.airtime > 0 ? sc.best.airtime.toFixed(1) + ' s' : '-', 'Air time');
    add(sc.best.drift > 0 ? num(sc.best.drift) : '-', 'Best drift');
    add(sc.best.nearMiss > 0 ? String(Math.round(sc.best.nearMiss)) : '-', 'Near misses');
    add(formatMiles(p.stats.distance), 'Distance');
    add(String(Math.floor(p.stats.flights)), 'Flights');
    add(String(Math.floor(p.stats.races)), 'Races');
    const medalIds = Object.keys(p.medals).filter((k) => !isFlag(k));
    add(String(medalIds.length), 'Medals');
    const ex = game.explore && game.explore.counts ? game.explore.counts() : null;
    const seen = Object.keys(p.medals).filter((k) => k.startsWith('seen_')).length;
    add(ex && Number.isFinite(ex.percent) ? Math.round(ex.percent) + ' %' : String(seen), ex && Number.isFinite(ex.percent) ? 'Explored' : 'Areas seen');
    body.appendChild(stats);

    // Hidden spots: a found one shows its name.
    const foundIds = p.secrets && Array.isArray(p.secrets.found) ? p.secrets.found : [];
    const names = SECRET_DEFS.filter((d) => foundIds.includes(d.id)).map((d) => d.name);
    const line = h('p', '', 'Secrets ' + foundIds.length + ' / ' + SECRET_DEFS.length + (names.length ? ': ' + names.join(', ') : ''));
    line.dataset.role = 'secrets';
    body.appendChild(line);
    if (foundIds.length >= SECRET_DEFS.length) body.appendChild(h('p', 'rw-menu-dim', GARAGE_NAME + ' unlocked: look for the lock-up garage on the map.'));
  }

  // ---------- Settings: four groups ----------
  function toggleRow(label, key, dflt = false) {
    const row = h('div', 'rw-menu-setting');
    row.appendChild(h('span', '', label));
    const on = typeof settings()[key] === 'boolean' ? settings()[key] : dflt;
    const b = button(on ? 'On' : 'Off', 'rw-menu-switch', () => {
      settings()[key] = !on;
      commit();
      render();
    }, label);
    b.setAttribute('role', 'switch');
    b.setAttribute('aria-checked', String(on));
    b.dataset.setting = key;
    row.appendChild(b);
    return row;
  }
  // A row of radio buttons: choices are [value, label]; onPick(value).
  function segRow(label, choices, current, attr, onPick) {
    const row = h('div', 'rw-menu-setting');
    row.appendChild(h('span', '', label));
    const seg = h('div', 'rw-menu-seg');
    seg.setAttribute('role', 'radiogroup');
    seg.setAttribute('aria-label', label);
    for (const [val, text] of choices) {
      const b = h('button', '', text);
      b.type = 'button';
      b.setAttribute('role', 'radio');
      b.setAttribute('aria-checked', String(current === val));
      b.dataset[attr] = String(val);
      b.addEventListener('click', () => onPick(val));
      seg.appendChild(b);
    }
    row.appendChild(seg);
    return row;
  }
  function sliderRow(label, key, o) {
    const s = settings();
    const row = h('div', 'rw-menu-setting');
    row.appendChild(h('span', '', label));
    const val = h('span', 'rw-menu-value', '');
    const sl = document.createElement('input');
    sl.type = 'range';
    sl.min = String(o.min); sl.max = String(o.max); sl.step = String(o.step);
    const cur = Number.isFinite(s[key]) ? s[key] : o.dflt;
    sl.value = String(o.toUi(cur));
    val.textContent = o.text(Number(sl.value));
    sl.setAttribute('aria-label', o.aria || label);
    sl.dataset.setting = key;
    if (o.disabled) sl.disabled = true;
    sl.addEventListener('input', () => {
      settings()[key] = o.fromUi(Number(sl.value));
      if (o.after) o.after();
      val.textContent = o.text(Number(sl.value));
      applySettings();
    });
    sl.addEventListener('change', () => commit());
    row.append(sl, val);
    return row;
  }
  const vol = (label, key, dflt) => sliderRow(label, key, {
    min: 0, max: 100, step: 1, dflt, toUi: (v) => Math.round(v * 100), fromUi: (v) => v / 100,
    text: (v) => v + '%', aria: label + ' volume',
  });
  const hourText = (x) => formatClock12(Math.floor(x) * 60 + Math.round((x - Math.floor(x)) * 60));
  // A row that opens another screen (shows an arrow).
  function goRow(label, valueText, role, id) {
    const row = h('div', 'rw-menu-setting');
    row.appendChild(h('span', '', label));
    const b = button(valueText, 'rw-menu-go', () => go(id), label + ': ' + valueText);
    b.dataset.role = role;
    row.appendChild(b);
    return row;
  }
  // The map being played (the city knows it; the island has no id).
  const currentMap = () => {
    const c = game.city;
    if (c) return c.mapId || (c.map ? 'miami' : 'island');
    try {
      return pickerCurrent(localStorage.getItem(MAP_CHOICE_KEY));
    } catch {
      return pickerCurrent(null);
    }
  };

  function renderSettings() {
    const s = settings();
    if (group === 'controls') {
      body.appendChild(segRow('Steering', STEER_CHOICES.map(([id, label]) => [id, label]), s.steering, 'steering', (id) => {
        // setSteering runs inside this tap, which tilt needs for its permission question.
        settings().steering = id; commit(); render();
      }));
      body.appendChild(sliderRow('Steering sensitivity', 'steerSensitivity', {
        min: 50, max: 150, step: 5, dflt: 1, toUi: (v) => Math.round(v * 100),
        fromUi: (v) => Math.max(0.5, Math.min(1.5, v / 100)), text: (v) => v + '%',
      }));
      body.appendChild(segRow('Handling', [['arcade', 'Arcade'], ['sim', 'Sim']], s.handling, 'handling', (id) => { settings().handling = id; commit(); render(); }));
      body.appendChild(toggleRow('Left-handed', 'leftHanded'));
      body.appendChild(toggleRow('Invert flying stick', 'invertPitch'));
    } else if (group === 'sound') {
      if (typeof s.muteAll !== 'boolean') s.muteAll = false;
      // The old music on/off switch is gone: the Music slider at 0 is off.
      if (s.music === false) { s.music = true; s.musicVol = 0; }
      body.appendChild(vol('Master', 'master', 0.8));
      body.appendChild(toggleRow('Mute all', 'muteAll'));
      body.appendChild(vol('Music', 'musicVol', 0.5));
      body.appendChild(vol('Sound effects', 'sfxVol', 1));
      body.appendChild(vol('Ambience', 'ambVol', 1));
      // Car radio: Off and the four stations; a tap steps to the next.
      const row = h('div', 'rw-menu-setting');
      row.appendChild(h('span', '', 'Car radio'));
      const station = game.radio ? game.radio.station : s.station;
      const cur = stationInfo(station);
      const rb = button(cur.name, 'rw-menu-switch', () => {
        if (game.radio) game.radio.setStation(nextStation(game.radio.station, 1), false);
        else s.station = nextStation(s.station, 1);
        commit();
        render();
      }, 'Car radio station: ' + cur.name + '. Tap for the next one.');
      rb.dataset.setting = 'station';
      row.appendChild(rb);
      body.appendChild(row);
    } else if (group === 'game') {
      body.appendChild(toggleRow('Police chases', 'police', true));
      body.appendChild(toggleRow('Hard: you can die', 'mortal'));
      // Blood (red spatters and pools): on unless switched off. Read by render/combatfx.js.
      if (typeof s.blood !== 'boolean') delete s.blood;
      body.appendChild(toggleRow('Blood', 'blood', true));
      body.appendChild(goRow('Map', mapName(currentMap()) || 'Miami', 'map', 'mapchoice'));
      body.appendChild(goRow('New game', 'Open', 'newgame', 'newgame'));
    } else {
      body.appendChild(segRow('HUD', [['minimal', 'Minimal'], ['full', 'Full']], s.hud, 'hud', (v) => { settings().hud = v; commit(); render(); }));
      body.appendChild(segRow('Graphics quality', [[0.75, 'Low'], [1, 'Normal'], [1.25, 'High']], s.quality, 'quality', (v) => { settings().quality = v; settings().qualityChosen = true; commit(); render(); }));
      if (typeof s.liveTime !== 'boolean') s.liveTime = true;
      body.appendChild(toggleRow('Live day and night', 'liveTime', true));
      body.appendChild(sliderRow('Time of day', 'timeOfDay', {
        min: 0, max: 23.5, step: 0.5, dflt: game.clock || 9, toUi: (v) => v, fromUi: (v) => v,
        text: hourText, disabled: s.liveTime, aria: 'Time of day',
      }));
      // Phone check (docs/PLAN_V1.md 4.2): the game drives itself for a minute, then plays eight test sounds.
      const row = h('div', 'rw-menu-setting');
      row.appendChild(h('span', '', 'Phone check'));
      const pb = button('Start', 'rw-menu-go', startPhoneCheck, 'Phone check: a one minute drive and eight test sounds. Start');
      pb.dataset.role = 'phonecheck';
      row.appendChild(pb);
      body.appendChild(row);
      body.appendChild(goRow('Sound test', 'Open', 'soundtest', 'soundtest'));
    }
  }

  // ---------- Sound test: the eight numbered sounds of the Phone check ----------
  function renderSoundTest() {
    body.appendChild(h('p', 'rw-menu-dim', 'The Phone check drives a test car for ' + DRIVE_SECONDS + ' seconds, then plays these ' + SOUNDS.length + ' sounds in order, ' + SOUND_SECONDS + ' seconds each. Tap the number of any that sounds bad.'));
    const list = h('ol', 'rw-menu-sounds');
    list.dataset.role = 'sound-list';
    SOUNDS.forEach((name, i) => {
      const li = h('li');
      li.dataset.sound = String(i + 1);
      const text = h('div');
      text.append(h('b', '', name), h('span', 'rw-menu-note', SOUND_NOTES[i] || ''));
      li.append(h('span', 'rw-menu-num', String(i + 1)), text);
      list.appendChild(li);
    });
    body.appendChild(list);
    const go1 = button('Start the Phone check', 'rw-menu-primary', startPhoneCheck, 'Start the Phone check');
    go1.dataset.role = 'phonecheck-start';
    body.appendChild(go1);
  }

  // ---------- About: version, credits, map license, names, privacy ----------
  function renderAbout() {
    const box = h('div');
    fillAbout(document, box, { version: version || 'dev' });
    body.appendChild(box);
  }

  // ---------- New game and Map choice (their own screens) ----------
  function renderNewGame() {
    body.appendChild(confirmRow('New game', 'Yes, new game', () => {
      const ses = game.session;
      if (ses && ses.newGame) ses.newGame();
      else if (game.newSession) game.newSession();
      close();
    }, { id: 'newgame', role: 'newgame', text: 'New game: back to the start street in your favorite car (the sedan if none is set). Parked cars are cleared. Score, medals and found garages are kept.' }));
    body.appendChild(confirmRow('Erase all progress', 'Yes, erase everything', () => {
      economy.reset();
      render();
    }, { id: 'reset', role: 'reset', danger: true, text: 'Erase all progress: score, medals, secrets, garages, adventures and settings.' }));
  }
  // One tap on a map: the place on this map is saved, then the page reloads
  // behind the loading veil (the region's data loads with the page).
  function renderMapChoice() {
    body.appendChild(h('p', 'rw-menu-dim', 'Pick a map. Your place on each map is kept.'));
    fillMapPicker(document, body, {
      current: currentMap(),
      onPick: (id) => {
        switchMap(document, id, { before: () => { if (game.saveSession) game.saveSession(); commit(); } });
      },
    });
  }
  // Travel: every region, tap to go (refused while wanted).
  function renderTravel() {
    const note = h('p', 'rw-menu-dim', 'Travel keeps your car. On foot, in a boat or a plane you arrive at the start place.');
    body.appendChild(note);
    const msg = h('p', 'rw-menu-dim', '');
    msg.dataset.role = 'travel-msg';
    body.appendChild(msg);
    fillMapPicker(document, body, {
      current: currentMap(), regionsOnly: true, hint: 'Tap to travel',
      onPick: (id) => {
        const why = game.session && game.session.travelTo ? game.session.travelTo(id) : '';
        if (why) msg.textContent = why;
      },
    });
  }

  // ---------- Help ----------
  function renderHelp() {
    const inv = settings().invertPitch;
    const sections = [
      ['Driving', ['Turn the steering wheel on the left with your thumb (or pick buttons, tilt or a slider under Settings). Use the pedals for gas and brake.',
        'Ease off the gas to turn in sharper. Hold the brake when stopped to reverse.',
        'Hold the handbrake to slide round tight corners, then let go to straighten up.']],
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
        'Finish races and challenges for medals and points. Everything is open from the start.']],
      ['Scores', ['Stunts, wrecks and takedowns of the rival crew earn points. Keep scoring within 4 seconds to build a combo. A hard crash or going down loses the points you have not banked yet.',
        (game.city && game.city.texts && game.city.texts.fleet) || 'The jet, stunt plane, heavy helicopter and yacht wait at Gullwing Airfield and Saltyard Marina.']],
    ];
    const aboutRow = goRow('About Rustwater', 'Open', 'about', 'about');
    aboutRow.firstChild.style.minWidth = '0';
    body.appendChild(aboutRow);
    for (const [t, items] of sections) {
      body.appendChild(h('div', 'rw-menu-group', t));
      const ul = h('ul');
      for (const i of items) ul.appendChild(h('li', '', i));
      body.appendChild(ul);
    }
    body.appendChild(h('div', 'rw-menu-group', 'Credits'));
    const credit = h('p', 'rw-menu-dim', CREDIT);
    credit.dataset.role = 'map-credit';
    body.appendChild(credit);
    const ver = h('p', 'rw-menu-dim', 'Rustwater ' + version);
    ver.dataset.role = 'version';
    body.appendChild(ver);
  }

  // ---------- screens ----------
  const BUILTIN = {
    resume: { title: 'Resume', render: renderResume },
    stats: { title: 'Stats', render: renderStats },
    settings: { title: 'Settings', render: renderSettings },
    help: { title: 'Help', render: renderHelp },
    about: { title: 'About', render: renderAbout },
    soundtest: { title: 'Sound test', render: renderSoundTest },
    newgame: { title: 'New game', render: renderNewGame },
    mapchoice: { title: 'Map', render: renderMapChoice },
    travel: { title: 'Travel', render: renderTravel },
  };
  const screenOf = (id) => BUILTIN[id] || screens.get(id) || null;
  const isTop = (id) => TABS.some(([t]) => t === id);

  function render() {
    const top = body.scrollTop;
    body.textContent = '';
    const sc = screenOf(active) || BUILTIN.resume;
    const railId = isTop(active) ? active : (parents.get(active) && isTop(parents.get(active)) ? parents.get(active) : (active === 'newgame' || active === 'mapchoice' || active === 'soundtest' ? 'settings' : (active === 'about' ? 'help' : 'resume')));
    for (const [id] of TABS) {
      tabButtons[id].setAttribute('aria-selected', String(id === railId));
      tabButtons[id].tabIndex = id === railId ? 0 : -1;
    }
    const inSettings = active === 'settings';
    groupBar.style.display = inSettings ? '' : 'none';
    title.style.display = inSettings ? 'none' : '';
    title.textContent = sc.title;
    for (const [id] of GROUPS) {
      groupButtons[id].setAttribute('aria-selected', String(id === group));
      groupButtons[id].tabIndex = id === group ? 0 : -1;
    }
    const atTop = isTop(active) && !parents.has(active);
    back.setAttribute('aria-label', atTop ? 'Resume game' : 'Back');
    back.dataset.mode = atTop ? 'resume' : 'back';
    pointsEl.textContent = num(game.score ? game.score.total : game.progress.score.total) + ' pts';
    if (screenOf(active) === BUILTIN[active]) sc.render();
    else sc.render(body, api);
    body.scrollTop = top;
  }

  function show(id) {
    if (!screenOf(id)) id = 'resume';
    if (id !== active) { body.scrollTop = 0; armed = null; }
    active = id;
    render();
  }
  // Open a screen from another screen: Back returns to where it came from.
  function go(id) {
    if (!screenOf(id)) return;
    const from = active;
    if (id !== from) parents.set(id, from);
    show(id);
  }
  function goBack() {
    const p = parents.get(active);
    if (p && screenOf(p)) { parents.delete(active); show(p); } else close();
  }

  rail.addEventListener('keydown', (e) => {
    const i = TABS.findIndex(([id]) => id === active);
    let n = -1;
    if (e.key === 'ArrowDown' || e.key === 'ArrowRight') n = (i + 1) % TABS.length;
    if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') n = (i + TABS.length - 1) % TABS.length;
    if (n < 0) return;
    e.preventDefault();
    parents.delete(TABS[n][0]);
    show(TABS[n][0]);
    tabButtons[TABS[n][0]].focus();
  });

  function reveal(id) {
    opened = true;
    el.classList.add('rw-menu-open');
    if (game.touch && game.touch.setVisible) game.touch.setVisible(false);
    if (id && id !== active) parents.delete(id);
    show(id || active);
    const f = (isTop(active) ? tabButtons[active] : back);
    f.focus({ preventScroll: true });
  }
  function hide() {
    if (!opened) return;
    opened = false;
    armed = null;
    parents.clear();
    el.classList.remove('rw-menu-open');
    if (game.touch && game.touch.setVisible) game.touch.setVisible(true);
  }
  // open() with no id (or a pause) shows the hub; open(id) any screen by id.
  function open(id) {
    reveal(id || 'resume');
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
  game.events.on('scoreBanked', refresh);

  // First run: ask once how the player wants to steer. Pauses the game
  // while the question is up; remembered in the save. Returns true if shown.
  let ask = null;
  function maybeAskSteering() {
    const medals = game.progress.medals;
    if (medals.hint_steer === 'bronze' || ask || opened) return false;
    const wasPaused = game.paused;
    game.paused = true;
    if (game.touch && game.touch.setVisible) game.touch.setVisible(false);
    ask = h('div', 'rw-menu rw-menu-ask');
    ask.setAttribute('role', 'dialog');
    ask.setAttribute('aria-modal', 'true');
    ask.setAttribute('aria-label', 'Choose steering');
    const box = h('div', 'rw-menu-askbox');
    box.appendChild(h('h2', '', 'How do you want to steer?'));
    box.appendChild(steeringChooser(settings().steering, (id) => {
      medals.hint_steer = 'bronze';
      settings().steering = id;
      commit();
      ask.remove();
      ask = null;
      if (game.touch && game.touch.setVisible) game.touch.setVisible(true);
      if (!wasPaused) game.paused = false;
    }));
    box.appendChild(h('p', 'rw-menu-dim', 'You can change this any time under Settings.'));
    ask.appendChild(box);
    root.appendChild(ask);
    const first = ask.querySelector('[aria-checked="true"]') || ask.querySelector('button');
    if (first) first.focus({ preventScroll: true });
    return true;
  }

  // The four steering styles as big radio buttons; onPick(style) on tap.
  function steeringChooser(current, onPick) {
    const grid = h('div', 'rw-menu-steer');
    grid.setAttribute('role', 'radiogroup');
    grid.setAttribute('aria-label', 'Steering style');
    for (const [id, label, desc] of STEER_CHOICES) {
      const b = h('button', 'rw-menu-btn rw-menu-choice');
      b.type = 'button';
      b.setAttribute('role', 'radio');
      b.setAttribute('aria-checked', String(current === id));
      b.setAttribute('aria-label', label + ' steering: ' + desc);
      b.dataset.steering = id;
      b.append(h('b', '', label), h('span', '', desc));
      b.addEventListener('click', () => onPick(id));
      grid.appendChild(b);
    }
    return grid;
  }

  return {
    open, close, isOpen: () => opened, maybeAskSteering, isAsking: () => !!ask,
    // W11 and others add screens: { id, title, render(body, api) }. Returns a remover.
    registerScreen(def) {
      if (!def || typeof def.id !== 'string' || typeof def.render !== 'function' || BUILTIN[def.id]) return () => {};
      const s = { id: def.id, title: String(def.title || def.id), render: def.render };
      screens.set(s.id, s);
      return () => { if (screens.get(s.id) === s) screens.delete(s.id); };
    },
    screen: () => active,
  };
}
