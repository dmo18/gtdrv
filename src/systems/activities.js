// Races, sky courses and timed deliveries: start zones, countdown,
// checkpoints, timing in fixed steps, medals and prize money.
// Drawing goes through src/render/markers.js (only when game.scene
// exists) and a small DOM panel (only when `document` exists), so the
// logic runs in node tests.
import { buildCourses } from '../world/courses.js';
import { createMarkers } from '../render/markers.js';

export const STILL_SPEED = 2; // m/s: slower than this counts as stopped
export const HOLD_TIME = 1.5; // seconds stopped in a start zone to begin
export const COUNTDOWN = 3;
export const STRAY_DIST = 400; // metres from the next checkpoint...
export const STRAY_TIME = 10; // ...for this long abandons the run
export const RESULT_TIME = 10; // result card hides itself after this
export const START_RADIUS = { street: 9, boat: 14, sky: 12, delivery: 9 };
export const MEDALS = ['bronze', 'silver', 'gold'];
const MAX_MONEY = 99999999;
const KIND_NAMES = { car: 'a car', boat: 'a boat', plane: 'a plane', heli: 'a helicopter' };
const MAP_COLORS = { street: '#e2733a', boat: '#45c7dc', sky: '#ffcf5a', delivery: '#8bd66f' };

const rank = (m) => MEDALS.indexOf(m); // -1 for none

// Best medal earned by a finishing time, or null when slower than bronze.
export function medalFor(course, time) {
  const t = course.medalTimes;
  if (time <= t.gold) return 'gold';
  if (time <= t.silver) return 'silver';
  if (time <= t.bronze) return 'bronze';
  return null;
}

// Money paid for earning `medal` when `prev` was the best so far: only
// the improvement is paid, so each medal's prize is earned once.
export function payoutFor(course, prev, medal) {
  if (rank(medal) <= rank(prev)) return 0;
  const before = prev ? course.reward[prev] : 0;
  return Math.max(0, course.reward[medal] - before);
}

export function needsText(kinds) {
  const names = kinds.map((k) => KIND_NAMES[k] || k);
  return 'Needs ' + (names.length > 1 ? names.slice(0, -1).join(', ') + ' or ' + names[names.length - 1] : names[0]);
}

export function formatTime(t) {
  const s = Math.max(0, t);
  const m = Math.floor(s / 60);
  const rest = s - m * 60;
  const whole = Math.floor(rest);
  const tenth = Math.floor((rest - whole) * 10);
  return m + ':' + (whole < 10 ? '0' : '') + whole + '.' + tenth;
}
const formatShort = (t) => {
  const m = Math.floor(t / 60), s = Math.round(t - m * 60);
  return m + ':' + (s < 10 ? '0' : '') + s;
};

// Squared distance from point c to the segment a-b (3D, or 2D when flat).
function segDist2(ax, ay, az, bx, by, bz, cx, cy, cz, flat) {
  if (flat) { ay = by = cy = 0; }
  const dx = bx - ax, dy = by - ay, dz = bz - az;
  const L2 = dx * dx + dy * dy + dz * dz;
  let t = L2 > 1e-9 ? ((cx - ax) * dx + (cy - ay) * dy + (cz - az) * dz) / L2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const px = ax + dx * t - cx, py = ay + dy * t - cy, pz = az + dz * t - cz;
  return px * px + py * py + pz * pz;
}

export function createActivities(game, uiRoot = null) {
  const courses = game.courses || buildCourses(game.city);
  const events = game.events;
  const toast = (text, s = 2.5) => { if (game.hud && game.hud.toast) game.hud.toast(text, s); };
  const radiusOf = (c) => START_RADIUS[c.type] || 9;
  const progress = () => game.progress;

  const markers = game.scene ? createMarkers(game.scene, { seaY: game.seaY ?? 0 }) : null;
  const ui = typeof document !== 'undefined' ? createPanel(uiRoot) : null;

  // --- Idle: start zones. ---
  const startMarks = courses.map((c) => ({ x: c.start.x, z: c.start.z, type: 'race', color: MAP_COLORS[c.type] }));
  function showIdle() {
    if (game.map) for (const m of startMarks) game.map.addMarker(m);
    if (markers) courses.forEach((c, i) => markers.showStart(i, c, radiusOf(c)));
  }
  function hideIdle() {
    if (game.map) for (const m of startMarks) game.map.removeMarker(m);
    if (markers) markers.hideStarts();
  }
  showIdle();

  let zone = -1; // course whose start zone the player is in
  let hold = 0;
  let toldNeed = false, toldHold = false;
  let blocked = -1; // a course just played: ignored until the player leaves its zone

  // --- A run in progress. ---
  let run = null;
  const cpMark = { x: 0, z: 0, type: 'checkpoint', color: '#ffffff' };
  let result = null;
  let resultTimer = 0;
  let passedTimer = 0;
  let markersDirty = false;

  function inZone(c, p) {
    const r = radiusOf(c);
    const dx = p.x - c.start.x, dz = p.z - c.start.z;
    return dx * dx + dz * dz <= r * r && Math.abs((p.y || 0) - (c.start.y || 0)) < 6;
  }

  function start(id) {
    if (run) return false;
    const course = courses.find((c) => c.id === id);
    const v = game.player.vehicle;
    if (!course || !v || game.player.mode === 'foot' || !course.kinds.includes(v.kind)) return false;
    hideIdle();
    run = {
      course, craft: v, phase: 'countdown', count: COUNTDOWN, steps: 0, elapsed: 0,
      index: 0, lap: 1, stray: 0, lx: v.x, ly: v.y || 0, lz: v.z, passed: 0,
    };
    result = null;
    if (game.map) {
      setMapMark();
      game.map.addMarker(cpMark);
    }
    markersDirty = true;
    toast(course.name + (course.timeLimit ? ': deliver within ' + formatShort(course.timeLimit) : ''), 2.5);
    events.emit('ui');
    return true;
  }

  function setMapMark() {
    const cp = run.course.checkpoints[run.index];
    cpMark.x = cp.x;
    cpMark.z = cp.z;
  }

  function endRun() {
    blocked = courses.indexOf(run.course);
    if (game.map) game.map.removeMarker(cpMark);
    run = null;
    zone = -1;
    hold = 0;
    markersDirty = true;
    showIdle();
    events.emit('ui');
  }

  function fail(msg) {
    const id = run.course.id;
    toast(msg, 3);
    events.emit('fail', id, msg);
    endRun();
  }

  function abort() {
    if (!run) return false;
    fail('Race abandoned');
    return true;
  }

  function finishRun() {
    const course = run.course;
    const time = Math.round(run.steps * run.dt * 100) / 100;
    const p = progress();
    const prev = p.medals[course.id] || null;
    const medal = medalFor(course, time);
    const paid = payoutFor(course, prev, medal);
    const oldBest = p.bestTimes[course.id];
    const newBest = !(oldBest > 0) || time < oldBest;
    if (newBest) p.bestTimes[course.id] = time;
    if (rank(medal) > rank(prev)) p.medals[course.id] = medal;
    p.stats.races = (p.stats.races || 0) + 1;
    p.money = Math.min(MAX_MONEY, p.money + paid);
    result = { id: course.id, name: course.name, time, medal, paid, best: p.bestTimes[course.id], newBest, prev };
    resultTimer = RESULT_TIME;
    events.emit('reward', paid, course.name + (medal ? ': ' + medal : ': finished'));
    events.emit('progress');
    endRun();
    if (ui) ui.showResult(result, course);
    return result;
  }

  function advance() {
    const course = run.course;
    const n = course.checkpoints.length;
    run.passed++;
    events.emit('checkpoint', course.id, run.passed, n * course.laps);
    passedTimer = 0.6;
    run.lastPassed = course.checkpoints[run.index];
    run.index++;
    if (run.index >= n) {
      if (run.lap >= course.laps) {
        finishRun();
        return;
      }
      run.lap++;
      run.index = 0;
      toast(run.lap === course.laps ? 'Final lap' : 'Lap ' + run.lap, 1.5);
    }
    run.stray = 0;
    if (game.map) setMapMark();
    markersDirty = true;
  }

  function stepRun(dt) {
    const p = game.player;
    const v = p.vehicle;
    if (!v || v !== run.craft || p.mode === 'foot') return fail('Race abandoned');
    if (v.wrecked || v.removed) return fail('Race abandoned');
    run.dt = dt;
    if (run.phase === 'countdown') {
      run.count -= dt;
      if (run.count <= 0) {
        run.phase = 'running';
        run.count = 0;
      }
      run.lx = v.x; run.ly = v.y || 0; run.lz = v.z;
      return;
    }
    run.steps++;
    run.elapsed = run.steps * dt;
    const cp = run.course.checkpoints[run.index];
    const flat = cp.kind === 'ground' || cp.kind === 'buoy';
    const y = v.y || 0;
    const d2 = segDist2(run.lx, run.ly, run.lz, v.x, y, v.z, cp.x, cp.y || 0, cp.z, flat);
    run.lx = v.x; run.ly = y; run.lz = v.z;
    if (d2 < cp.r * cp.r) {
      advance();
      if (!run) return;
    }
    const nx = run.course.checkpoints[run.index];
    const sx = v.x - nx.x, sz = v.z - nx.z;
    if (sx * sx + sz * sz > STRAY_DIST * STRAY_DIST) {
      run.stray += dt;
      if (run.stray >= STRAY_TIME) return fail('Race abandoned');
    } else run.stray = 0;
    if (run.course.timeLimit && run.elapsed > run.course.timeLimit) fail('Out of time');
  }

  function stepIdle(dt) {
    const p = game.player;
    const v = p.vehicle;
    if (blocked >= 0 && !inZone(courses[blocked], p)) blocked = -1;
    let here = -1;
    for (let i = 0; i < courses.length; i++) {
      if (inZone(courses[i], p)) { here = i; break; }
    }
    if (here !== zone) {
      zone = here;
      hold = 0;
      toldNeed = toldHold = false;
    }
    if (here < 0 || here === blocked || !v || p.mode === 'foot') { hold = 0; return; }
    const c = courses[here];
    if (!c.kinds.includes(v.kind)) {
      if (!toldNeed) toast(needsText(c.kinds), 2.5);
      toldNeed = true;
      return;
    }
    if (Math.abs(v.speed || 0) < STILL_SPEED) {
      if (!toldHold) toast('Hold still to start: ' + c.name, 2);
      toldHold = true;
      hold += dt;
      if (hold >= HOLD_TIME) start(c.id);
    } else hold = 0;
  }

  function fixedUpdate(dt) {
    if (run) stepRun(dt);
    else stepIdle(dt);
    if (resultTimer > 0) {
      resultTimer -= dt;
      if (resultTimer <= 0 && ui) ui.hideResult();
    }
    if (passedTimer > 0) passedTimer -= dt;
  }

  // --- Drawing. ---
  let shownPassed = false;
  function syncMarkers() {
    markersDirty = false;
    markers.hideCheckpoints();
    shownPassed = false;
    if (!run) return;
    const c = run.course;
    const n = c.checkpoints.length;
    const lastLap = run.lap >= c.laps;
    const isFinal = (i, lapEnd) => lapEnd && i === n - 1;
    markers.showCheckpoint(0, c.checkpoints[run.index], isFinal(run.index, lastLap) ? 'finish' : 'next');
    let j = run.index + 1, l2 = lastLap;
    if (j >= n) {
      if (lastLap) j = -1;
      else { j = 0; l2 = run.lap + 1 >= c.laps; }
    }
    if (j >= 0) markers.showCheckpoint(1, c.checkpoints[j], isFinal(j, l2) ? 'finish' : 'after');
    if (run.lastPassed && passedTimer > 0) {
      markers.showCheckpoint(2, run.lastPassed, 'passed');
      shownPassed = true;
    }
  }

  function render(_alpha, _dt) {
    if (markers) {
      if (markersDirty) syncMarkers();
      if (shownPassed && passedTimer <= 0) {
        markers.hideCheckpoint(2);
        shownPassed = false;
      }
      markers.update(game.time || 0, game.camera ? game.camera.position : null);
    }
    if (ui) ui.update(run, result);
  }

  return {
    name: 'activities',
    courses,
    fixedUpdate,
    render,
    start,
    abort,
    get active() {
      if (!run) return null;
      return {
        id: run.course.id, course: run.course, phase: run.phase, countdown: run.count,
        elapsed: run.elapsed, index: run.index, lap: run.lap, total: run.course.checkpoints.length,
      };
    },
    get lastResult() { return result; },
    dismissResult() {
      result = null;
      resultTimer = 0;
      if (ui) ui.hideResult();
    },
  };
}

// ---------------------------------------------------------------------------
// DOM panel (only built when a document exists)
// ---------------------------------------------------------------------------

const CSS = `
.rw-act-panel, .rw-act-count, .rw-act-card {
  --rw-st: env(safe-area-inset-top, 0px);
  font-family: system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  color: #f6efe6; box-sizing: border-box; -webkit-user-select: none; user-select: none;
}
.rw-act-panel {
  position: absolute; left: 50%; top: calc(var(--rw-st) + 54px); transform: translateX(-50%);
  width: min(200px, 26vw); min-width: 168px; z-index: 9; pointer-events: none;
  padding: 5px 10px 6px; border-radius: 14px; text-align: center;
  background: rgba(24, 18, 15, 0.58); border: 1px solid rgba(246, 239, 230, 0.22); border-top: 3px solid #e2733a;
  text-shadow: 0 1px 3px rgba(0, 0, 0, 0.7);
}
.rw-act-panel.rw-act-off, .rw-act-count.rw-act-off, .rw-act-card.rw-act-off { display: none; }
.rw-act-name { font-size: 11px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; color: rgba(246, 239, 230, 0.7);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.rw-act-time { font-size: 24px; font-weight: 800; line-height: 1.1; font-variant-numeric: tabular-nums; color: #ffe2cc; }
.rw-act-time.rw-act-late { color: #ff8a6a; }
.rw-act-row { display: flex; justify-content: center; gap: 10px; font-size: 12px; font-weight: 700; font-variant-numeric: tabular-nums; }
.rw-act-medals { display: flex; justify-content: center; gap: 8px; margin-top: 2px; font-size: 11px; font-variant-numeric: tabular-nums; color: rgba(246, 239, 230, 0.8); }
.rw-act-medals i { display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin-right: 3px; vertical-align: 0; }
.rw-act-g { background: #ffd34d; } .rw-act-s { background: #d4dbe2; } .rw-act-b { background: #c98a52; }
.rw-act-count {
  position: absolute; left: 0; right: 0; top: 26%; z-index: 9; pointer-events: none; text-align: center;
  font-size: 84px; font-weight: 900; line-height: 1; color: #ffe2cc;
  text-shadow: 0 3px 16px rgba(0, 0, 0, 0.8), 0 0 26px rgba(226, 115, 58, 0.75);
}
.rw-act-count.rw-act-pop { animation: rw-act-pop 0.9s ease-out; }
@keyframes rw-act-pop { 0% { transform: scale(1.6); opacity: 0; } 20% { transform: scale(1); opacity: 1; } 100% { opacity: 0.15; } }
.rw-act-card {
  position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%); z-index: 30; pointer-events: auto;
  width: min(300px, 70vw); padding: 14px 18px 12px; border-radius: 18px; text-align: center; cursor: pointer;
  background: rgba(24, 18, 15, 0.86); border: 1px solid rgba(246, 239, 230, 0.25); border-top: 4px solid #e2733a;
  box-shadow: 0 6px 30px rgba(0, 0, 0, 0.55); touch-action: manipulation;
}
.rw-act-card h2 { margin: 0 0 2px; font-size: 15px; letter-spacing: 0.06em; text-transform: uppercase; }
.rw-act-big { font-size: 34px; font-weight: 900; font-variant-numeric: tabular-nums; color: #ffe2cc; }
.rw-act-medal { display: inline-block; margin: 4px 0; padding: 3px 12px; border-radius: 12px; font-weight: 800; font-size: 14px;
  text-transform: uppercase; letter-spacing: 0.08em; color: #24170f; }
.rw-act-medal.rw-act-none { background: rgba(246, 239, 230, 0.25); color: #f6efe6; }
.rw-act-line { font-size: 13px; color: rgba(246, 239, 230, 0.85); margin-top: 2px; }
.rw-act-tap { margin-top: 8px; font-size: 12px; font-weight: 700; letter-spacing: 0.08em; color: #e2733a; text-transform: uppercase; }
@media (max-height: 380px) {
  .rw-act-panel { top: calc(var(--rw-st) + 48px); padding: 3px 8px 4px; }
  .rw-act-time { font-size: 21px; }
  .rw-act-count { font-size: 64px; top: 24%; }
  .rw-act-card { padding: 10px 14px 9px; }
  .rw-act-big { font-size: 28px; }
}
`;

function createPanel(uiRoot) {
  if (!document.getElementById('rw-act-styles')) {
    const st = document.createElement('style');
    st.id = 'rw-act-styles';
    st.textContent = CSS;
    document.head.appendChild(st);
  }
  const root = uiRoot || document.body;
  const el = (tag, cls, parent) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    parent.appendChild(e);
    return e;
  };
  const panel = el('div', 'rw-act-panel rw-act-off', root);
  const nameEl = el('div', 'rw-act-name', panel);
  const timeEl = el('div', 'rw-act-time', panel);
  const row = el('div', 'rw-act-row', panel);
  const cpEl = el('span', '', row);
  const lapEl = el('span', '', row);
  const medalsEl = el('div', 'rw-act-medals', panel);
  const medalSpans = ['g', 's', 'b'].map((k) => {
    const s = el('span', '', medalsEl);
    el('i', 'rw-act-' + k, s);
    return s.appendChild(document.createTextNode(''));
  });
  const count = el('div', 'rw-act-count rw-act-off', root);
  const card = el('div', 'rw-act-card rw-act-off', root);
  card.addEventListener('pointerdown', (e) => {
    e.stopPropagation();
    card.classList.add('rw-act-off');
  });

  const last = { on: false, name: '', time: '', cp: '', lap: '', medals: '', count: '', late: false };
  const set = (key, node, text) => {
    if (last[key] === text) return;
    last[key] = text;
    node.textContent = text;
  };

  function update(run) {
    const on = !!run;
    if (on !== last.on) {
      last.on = on;
      panel.classList.toggle('rw-act-off', !on);
      if (!on) {
        count.classList.add('rw-act-off');
        last.count = '';
      }
    }
    if (!on) return;
    const c = run.course;
    set('name', nameEl, c.name);
    const limit = c.timeLimit;
    const shown = limit ? limit - run.elapsed : run.elapsed;
    set('time', timeEl, formatTime(shown));
    const late = !!limit && shown < 10;
    if (late !== last.late) {
      last.late = late;
      timeEl.classList.toggle('rw-act-late', late);
    }
    const n = c.checkpoints.length;
    set('cp', cpEl, (c.type === 'delivery' ? 'Stop ' : 'CP ') + Math.min(n, run.index + 1) + '/' + n);
    set('lap', lapEl, c.laps > 1 ? 'Lap ' + run.lap + '/' + c.laps : '');
    const mt = c.medalTimes;
    const key = c.id;
    if (last.medals !== key) {
      last.medals = key;
      medalSpans[0].nodeValue = formatShort(mt.gold);
      medalSpans[1].nodeValue = formatShort(mt.silver);
      medalSpans[2].nodeValue = formatShort(mt.bronze);
    }
    let txt = '';
    if (run.phase === 'countdown') txt = String(Math.max(1, Math.ceil(run.count)));
    else if (run.elapsed < 0.8) txt = 'GO!';
    if (txt !== last.count) {
      last.count = txt;
      count.classList.toggle('rw-act-off', !txt);
      if (txt) {
        count.textContent = txt;
        count.classList.remove('rw-act-pop');
        void count.offsetWidth;
        count.classList.add('rw-act-pop');
      }
    }
  }

  const MEDAL_BG = { gold: '#ffd34d', silver: '#d4dbe2', bronze: '#c98a52' };
  function showResult(r, course) {
    card.textContent = '';
    el('h2', '', card).textContent = r.name;
    el('div', 'rw-act-big', card).textContent = formatTime(r.time);
    const m = el('div', 'rw-act-medal' + (r.medal ? '' : ' rw-act-none'), card);
    m.textContent = r.medal ? r.medal + ' medal' : 'No medal';
    if (r.medal) m.style.background = MEDAL_BG[r.medal];
    el('div', 'rw-act-line', card).textContent = r.newBest ? 'New best time!' : 'Best: ' + formatTime(r.best);
    el('div', 'rw-act-line', card).textContent = r.paid > 0 ? 'Prize: +$' + r.paid.toLocaleString('en-US')
      : r.medal ? 'Already earned: beat it for a better medal' : 'Gold in ' + formatShort(course.medalTimes.gold);
    el('div', 'rw-act-tap', card).textContent = 'Tap to continue';
    card.classList.remove('rw-act-off');
  }
  function hideResult() {
    card.classList.add('rw-act-off');
  }

  return { update, showResult, hideResult };
}
