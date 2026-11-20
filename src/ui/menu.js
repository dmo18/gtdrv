// The pause menu: Resume, Scores, Records, Settings and How to play.
// All text goes through textContent / DOM APIs, never innerHTML.
import { setHandlingMode } from '../entities/vehicle.js';
import { nextStation, stationInfo } from '../core/radio.js';
import { SECRET_DEFS, GARAGE_NAME } from '../world/secrets.js';

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
.rw-menu-version { margin-left: 8px; font-size: 11px; opacity: 0.6; align-self: center; }
.rw-menu-points { font-weight: 700; color: #ffd08a; font-variant-numeric: tabular-nums; }
.rw-menu-body { flex: 1 1 auto; overflow-y: auto; -webkit-overflow-scrolling: touch; overscroll-behavior: contain; padding: 8px 16px 16px; }
.rw-menu-body p { margin: 0 0 8px; }
.rw-menu-dim { color: var(--rw-dim); }
.rw-menu-group { margin: 10px 0 4px; font-size: 14px; letter-spacing: 0.06em; text-transform: uppercase; color: var(--rw-accent); }
.rw-menu-row { display: flex; justify-content: space-between; align-items: center; gap: 10px; min-height: 40px; padding: 4px 0; border-bottom: 1px solid rgba(246,239,230,0.1); }
.rw-menu-medal { display: inline-block; width: 12px; height: 12px; border-radius: 50%; margin-right: 6px; vertical-align: -1px; }
.rw-menu-secrets .rw-menu-row { min-height: 26px; padding: 2px 0; font-size: 13px; }
.rw-menu-secrets .rw-menu-row span:last-child { font-size: 12px; text-align: right; }
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
.rw-menu-steer { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; padding: 6px 0 8px; }
.rw-menu-btn.rw-menu-choice {
  min-height: 70px; display: flex; flex-direction: column; justify-content: center; align-items: flex-start;
  gap: 3px; padding: 8px 14px; text-align: left; line-height: 1.2;
}
.rw-menu-choice b { font-size: 17px; }
.rw-menu-choice span { font-size: 13px; font-weight: 500; color: var(--rw-dim); }
.rw-menu-choice[aria-checked="true"] { background: var(--rw-accent); color: #1b120d; border-color: #ffd9a8; }
.rw-menu-choice[aria-checked="true"] span { color: rgba(27,18,13,0.8); }
.rw-menu-sens { font-variant-numeric: tabular-nums; min-width: 44px; text-align: right; }
.rw-menu-ask {
  position: fixed; inset: 0; z-index: 41; display: flex; align-items: center; justify-content: center;
  padding: calc(8px + var(--rw-st)) calc(10px + var(--rw-sr)) calc(8px + var(--rw-sb)) calc(10px + var(--rw-sl));
  background: rgba(12,9,8,0.72);
}
.rw-menu-askbox {
  width: min(680px, 100%); max-height: 100%; overflow-y: auto; padding: 12px 16px 14px;
  border-radius: 18px; background: var(--rw-panel); border: 1px solid var(--rw-panel-edge);
}
.rw-menu-askbox h2 { margin: 0 0 2px; font-size: 20px; }
.rw-menu-askbox p { margin: 0; }
@media (max-height: 380px) {
  .rw-menu-btn.rw-menu-choice { min-height: 60px; padding: 6px 12px; }
  .rw-menu-askbox { padding: 8px 14px 10px; }
  .rw-menu-askbox h2 { font-size: 18px; }
}
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
  ['resume', 'Resume'], ['scores', 'Scores'], ['records', 'Records'],
  ['settings', 'Settings'], ['howto', 'How to play'],
];
const STEER_CHOICES = [
  ['wheel', 'Wheel', 'Turn the on-screen wheel with your thumb.'],
  ['buttons', 'Buttons', 'Hold the left or right arrow; the turn builds up.'],
  ['tilt', 'Tilt', 'Tilt your phone like a steering wheel.'],
  ['slider', 'Slider', 'Slide your thumb left and right on a pad.'],
];
const HANDLING_CHOICES = [
  ['arcade', 'Arcade', 'Tight and forgiving.'],
  ['sim', 'Realistic', 'Heavier, more grip-limited.'],
];
const MEDAL_COLORS = { bronze: '#c9803f', silver: '#c4cbd2', gold: '#f0c24a' };
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
const pretty = (id) => String(id).replace(/[_-]+/g, ' ').trim().replace(/\b[a-z]/g, (c) => c.toUpperCase());
const fmtTime = (s) => {
  const m = Math.floor(s / 60);
  return m + ':' + (s - m * 60).toFixed(1).padStart(4, '0');
};
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
  const rail = h('div', 'rw-menu-rail');
  rail.setAttribute('role', 'tablist');
  rail.setAttribute('aria-label', 'Menu sections');
  const main = h('div', 'rw-menu-main');
  const head = h('div', 'rw-menu-head');
  const title = h('h2', 'rw-menu-title');
  const verEl = h('span', 'rw-menu-version');
  // __VERSION__ comes from package.json at build time (scripts/build.mjs).
  /* global __VERSION__ */
  if (typeof __VERSION__ !== 'undefined') verEl.textContent = 'v' + __VERSION__;
  const pointsEl = h('span', 'rw-menu-points');
  pointsEl.setAttribute('aria-label', 'Score');
  head.append(title, pointsEl, verEl);
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
  let confirmNew = false;

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
    if (game.audio && game.audio.setVolume) game.audio.setVolume({ master: s.master, musicOn: s.music !== false, music: Number.isFinite(s.musicVol) ? s.musicVol : 0.5 });
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

  // ---------- tab renderers ----------
  function renderResume() {
    const box = h('div', 'rw-menu-resume');
    box.appendChild(h('p', 'rw-menu-dim', 'The game is paused. Your progress is saved automatically.'));
    const r = button('Resume', 'rw-menu-primary', close, 'Resume game');
    r.dataset.role = 'resume';
    box.appendChild(r);
    body.appendChild(box);
  }

  // Scores: the high scores, then every race and challenge with its
  // best time, best score and medal (medals are the achievements).
  function renderScores() {
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
    add(sc.best.jump > 0 ? Math.round(sc.best.jump) + ' m' : '-', 'Longest jump');
    add(sc.best.airtime > 0 ? sc.best.airtime.toFixed(1) + ' s' : '-', 'Longest airtime');
    add(sc.best.drift > 0 ? num(sc.best.drift) : '-', 'Best drift');
    add(sc.best.nearMiss > 0 ? String(Math.round(sc.best.nearMiss)) : '-', 'Near misses in a row');
    body.appendChild(stats);

    const courses = (game.activities && Array.isArray(game.activities.courses)) ? game.activities.courses : [];
    const names = new Map();
    for (const c of courses) if (c && typeof c.id === 'string') names.set(c.id, String(c.name || ''));
    const medalIds = Object.keys(p.medals).filter((k) => !isFlag(k));
    const ids = new Set(medalIds);
    for (const k of Object.keys(p.bestTimes)) ids.add(k);
    for (const k of Object.keys(sc.courses)) ids.add(k);
    const count = (m) => medalIds.filter((k) => p.medals[k] === m).length;
    body.appendChild(h('div', 'rw-menu-group', 'Achievements'));
    body.appendChild(h('p', 'rw-menu-dim', medalIds.length
      ? 'Medals: ' + count('gold') + ' gold, ' + count('silver') + ' silver, ' + count('bronze') + ' bronze'
      : 'No medals yet. Finish a race or a flying challenge!'));

    const missionIds = Object.keys(sc.missions);
    if (missionIds.length) {
      body.appendChild(h('div', 'rw-menu-group', 'Missions'));
      for (const id of missionIds.sort()) {
        const m = sc.missions[id];
        const row = h('div', 'rw-menu-row');
        row.appendChild(h('span', '', pretty(id)));
        row.appendChild(h('span', 'rw-menu-dim', (m.done ? 'Done ' : '') + num(m.best) + (m.time > 0 ? '  ' + fmtTime(m.time) : '')));
        body.appendChild(row);
      }
    }
    if (!ids.size) return;
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
        row.dataset.course = id;
        row.appendChild(h('span', '', names.get(id) || pretty(id)));
        const right = h('span', 'rw-menu-dim');
        const medal = p.medals[id];
        if (medal) {
          const dot = h('span', 'rw-menu-medal');
          dot.style.background = MEDAL_COLORS[medal];
          right.append(dot, medal + '  ');
        }
        if (p.bestTimes[id]) right.appendChild(document.createTextNode(fmtTime(p.bestTimes[id]) + '  '));
        if (sc.courses[id]) right.appendChild(document.createTextNode(num(sc.courses[id]) + ' pts'));
        row.appendChild(right);
        body.appendChild(row);
      }
    }
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
    const foundIds = p.secrets && Array.isArray(p.secrets.found) ? p.secrets.found : [];
    add(foundIds.length + ' / ' + SECRET_DEFS.length, 'Secrets found');
    body.appendChild(stats);

    // Hidden spots: a found one shows its name, the rest stay a question.
    const list = h('div', 'rw-menu-secrets');
    for (const d of SECRET_DEFS) {
      const got = foundIds.includes(d.id);
      const row = h('div', 'rw-menu-row' + (got ? '' : ' rw-menu-dim'));
      row.append(h('span', '', got ? d.name : '???'), h('span', 'rw-menu-dim', got ? d.note : 'Not found yet'));
      list.appendChild(row);
    }
    body.appendChild(list);
    const all = foundIds.length >= SECRET_DEFS.length;
    body.appendChild(h('p', 'rw-menu-dim', all ? GARAGE_NAME + ' unlocked: look for the lock-up garage on the map.' : 'Find all ' + SECRET_DEFS.length + ' to unlock something special.'));

    const seen = Object.keys(p.medals).filter((k) => k.startsWith('seen_')).length;
    body.appendChild(h('p', 'rw-menu-dim', 'Areas explored: ' + seen));
    body.appendChild(h('p', 'rw-menu-dim', 'Scores, best times and medals are under Scores.'));
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
  // Apply a steering style now (setSteering runs inside this tap, which
  // tilt needs for its permission question).
  function pickSteering(id) {
    settings().steering = id;
    commit();
  }

  function renderSteering() {
    const s = settings();
    body.appendChild(h('div', 'rw-menu-group', 'Steering'));
    body.appendChild(steeringChooser(s.steering, (id) => { pickSteering(id); render(); }));
    const row = h('div', 'rw-menu-setting');
    row.appendChild(h('span', '', 'Steering sensitivity'));
    const val = h('span', 'rw-menu-sens', Math.round(s.steerSensitivity * 100) + '%');
    const slider = document.createElement('input');
    slider.type = 'range';
    slider.min = '50'; slider.max = '150'; slider.step = '5';
    slider.value = String(Math.round(s.steerSensitivity * 100));
    slider.setAttribute('aria-label', 'Steering sensitivity');
    slider.dataset.setting = 'steerSensitivity';
    slider.addEventListener('input', () => {
      settings().steerSensitivity = Math.max(0.5, Math.min(1.5, Number(slider.value) / 100));
      val.textContent = slider.value + '%';
      applySettings();
    });
    slider.addEventListener('change', () => commit());
    row.append(slider, val);
    body.appendChild(row);
    renderHandling();
    body.appendChild(h('div', 'rw-menu-group', 'Other'));
  }

  // Car handling: two big radio buttons (applies to every car at once).
  function renderHandling() {
    const current = settings().handling;
    body.appendChild(h('div', 'rw-menu-group', 'Handling'));
    const grid = h('div', 'rw-menu-steer');
    grid.setAttribute('role', 'radiogroup');
    grid.setAttribute('aria-label', 'Car handling');
    for (const [id, label, desc] of HANDLING_CHOICES) {
      const b = h('button', 'rw-menu-btn rw-menu-choice');
      b.type = 'button';
      b.setAttribute('role', 'radio');
      b.setAttribute('aria-checked', String(current === id));
      b.setAttribute('aria-label', 'Handling: ' + label + ', ' + desc);
      b.dataset.handling = id;
      b.append(h('b', '', label), h('span', '', desc));
      b.addEventListener('click', () => { settings().handling = id; commit(); render(); });
      grid.appendChild(b);
    }
    body.appendChild(grid);
  }

  function renderSettings() {
    const s = settings();
    renderSteering();
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

    // Music: on/off and its level against the effects (audio.js). Older
    // saves have neither; music starts on at half level.
    if (typeof s.music !== 'boolean') s.music = true;
    body.appendChild(toggleRow('Music', 'music'));
    const mv = h('div', 'rw-menu-setting');
    mv.appendChild(h('span', '', 'Music volume'));
    const ms = document.createElement('input');
    ms.type = 'range';
    ms.min = '0'; ms.max = '100'; ms.step = '1';
    ms.value = String(Math.round((Number.isFinite(s.musicVol) ? s.musicVol : 0.5) * 100));
    ms.setAttribute('aria-label', 'Music volume');
    ms.dataset.setting = 'musicVol';
    ms.addEventListener('input', () => { settings().musicVol = Number(ms.value) / 100; applySettings(); });
    ms.addEventListener('change', () => commit());
    mv.appendChild(ms);
    body.appendChild(mv);

    // Car radio: the station that plays in cars and boats (src/systems/radio.js).
    // Tap to step through Off, Lagoon Drive, Pulse Harbour, Lamplight Keys, Gullspeak.
    if (game.radio) {
      const row = h('div', 'rw-menu-setting');
      row.appendChild(h('span', '', 'Car radio'));
      const cur = stationInfo(game.radio.station);
      const rb = button(cur.name, 'rw-menu-switch', () => {
        game.radio.setStation(nextStation(game.radio.station, 1), false);
        commit();
        render();
      }, 'Car radio station: ' + cur.name + '. Tap for the next one.');
      rb.dataset.setting = 'station';
      row.appendChild(rb);
      body.appendChild(row);
    }

    // Time of day: live cycle, or a fixed time the player picks.
    if (typeof s.liveTime !== 'boolean') s.liveTime = true;
    body.appendChild(toggleRow('Live day and night', 'liveTime'));
    const tv = h('div', 'rw-menu-setting');
    const tlabel = h('span', '', 'Time of day');
    const tshow = h('span', 'rw-menu-value', '');
    const hourText = (x) => { const hh = Math.floor(x), mm = Math.round((x - hh) * 60); return String(hh).padStart(2, '0') + ':' + String(mm).padStart(2, '0'); };
    const ts = document.createElement('input');
    ts.type = 'range';
    ts.min = '0'; ts.max = '23.5'; ts.step = '0.5';
    ts.value = String(Number.isFinite(s.timeOfDay) ? s.timeOfDay : (game.clock || 9));
    ts.setAttribute('aria-label', 'Time of day');
    ts.dataset.setting = 'timeOfDay';
    tshow.textContent = hourText(Number(ts.value));
    ts.addEventListener('input', () => {
      settings().timeOfDay = Number(ts.value);
      settings().liveTime = false;
      tshow.textContent = hourText(Number(ts.value));
      applySettings();
    });
    ts.addEventListener('change', () => commit());
    tv.append(tlabel, ts, tshow);
    body.appendChild(tv);

    body.appendChild(toggleRow('Invert flying stick', 'invertPitch'));
    body.appendChild(toggleRow('Left-handed layout', 'leftHanded'));
    body.appendChild(toggleRow('Police chases', 'police'));
    body.appendChild(toggleRow('Hard: you can die', 'mortal'));

    const hudRow = h('div', 'rw-menu-setting');
    hudRow.appendChild(h('span', '', 'HUD'));
    const hudSeg = h('div', 'rw-menu-seg');
    hudSeg.setAttribute('role', 'radiogroup');
    hudSeg.setAttribute('aria-label', 'HUD: Minimal folds extra buttons away, Full shows everything');
    for (const [label, val] of [['Minimal', 'minimal'], ['Full', 'full']]) {
      const b = h('button', '', label);
      b.type = 'button';
      b.setAttribute('role', 'radio');
      b.setAttribute('aria-checked', String(s.hud === val));
      b.dataset.hud = val;
      b.addEventListener('click', () => { settings().hud = val; commit(); render(); });
      hudSeg.appendChild(b);
    }
    hudRow.appendChild(hudSeg);
    body.appendChild(hudRow);

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

    // New game: forget the saved car and place only (scores and settings stay).
    const fresh = h('div', 'rw-menu-setting');
    if (!confirmNew) {
      fresh.appendChild(h('span', 'rw-menu-dim', 'Start again in the starter car. Scores and settings stay.'));
      const b = button('New game (reset car and place)', '', () => { confirmNew = true; render(); }, 'New game');
      b.dataset.role = 'newgame';
      fresh.appendChild(b);
    } else {
      fresh.setAttribute('role', 'alert');
      fresh.appendChild(h('span', '', 'Leave this car and place behind? Your scores stay.'));
      const c = h('div', 'rw-menu-confirm');
      const yes = button('Yes, new game', 'rw-menu-danger', () => {
        confirmNew = false;
        if (game.newSession) game.newSession();
        close();
      }, 'Confirm new game');
      yes.dataset.role = 'newgame-confirm';
      c.append(yes, button('Keep playing', '', () => { confirmNew = false; render(); }, 'Cancel new game'));
      fresh.appendChild(c);
    }
    body.appendChild(fresh);

    const reset = h('div', 'rw-menu-setting');
    reset.style.borderBottom = '0';
    if (!confirmReset) {
      reset.appendChild(h('span', 'rw-menu-dim', 'Erase scores, medals, records and settings.'));
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
        'The jet, stunt plane, heavy helicopter and yacht wait at Gullwing Airfield and Saltyard Marina.']],
    ];
    for (const [t, items] of sections) {
      body.appendChild(h('div', 'rw-menu-group', t));
      const ul = h('ul');
      for (const i of items) ul.appendChild(h('li', '', i));
      body.appendChild(ul);
    }
  }

  const RENDERERS = { resume: renderResume, scores: renderScores, records: renderRecords, settings: renderSettings, howto: renderHowto };

  function render() {
    const top = body.scrollTop;
    body.textContent = '';
    for (const [id, label] of TABS) {
      tabButtons[id].setAttribute('aria-selected', String(id === active));
      tabButtons[id].tabIndex = id === active ? 0 : -1;
      if (id === active) title.textContent = label;
    }
    pointsEl.textContent = num(game.score ? game.score.total : game.progress.score.total) + ' pts';
    RENDERERS[active]();
    body.scrollTop = top;
  }

  function show(id) {
    if (!RENDERERS[id]) id = 'resume';
    if (id !== active) body.scrollTop = 0;
    active = id;
    if (id !== 'settings') confirmReset = confirmNew = false;
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
      pickSteering(id);
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

  return { open, close, isOpen: () => opened, maybeAskSteering, isAsking: () => !!ask };
}
