// Phone check (docs/PLAN_V1.md section 4.2): Settings, Display, "Phone check".
// The game drives itself for 60 s along a fixed route with a fight and a blast,
// then plays eight numbered test sounds; the owner taps any number that sounds
// bad and copies one line of result. Everything stays on the phone: nothing is
// sent anywhere, the line is copied with the clipboard (or selected by hand).
//
// Pure parts first (node tests): frame statistics, the result line, the route
// and the driver. The runner and the panel come after; the runner works on a
// game object and a scripted input source and never changes a game rule: it
// uses game.debug.spawnCar / spawnOccupied, game.combat.explode and the
// existing audio events.
import { nextStation } from '../core/radio.js';
import { validPreset, validVerdict, VERDICTS, VERDICT_LABELS } from '../core/handlingpreset.js';

export const DRIVE_SECONDS = 60;
export const SOUND_SECONDS = 3.2; // each of the eight sounds
export const SOUNDS = ['Engine', 'Tire squeal', 'Gunshot', 'Blast', 'Siren', 'Music', 'Radio', 'Boost whoosh'];
// What to listen for in each of the eight sounds (shown by Settings, Display, Sound test).
export const SOUND_NOTES = [
  'Your car revving up',
  'Tires sliding in a turn',
  'A few shots',
  'A big explosion ahead',
  'A police siren',
  'The music track',
  'The car radio, switched on and back',
  'The boost whoosh',
];
const LONG_FRAME_MS = 33;

// ---------------------------------------------------------------------------
// Frame statistics and the result line
// ---------------------------------------------------------------------------
export function frameStats(ms) {
  const n = ms.length;
  if (!n) return { median: 0, worst: 0, over33: 0, frames: 0 };
  const s = Array.from(ms).sort((a, b) => a - b);
  const median = n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
  let over = 0;
  for (let i = 0; i < n; i++) if (ms[i] > LONG_FRAME_MS) over++;
  return { median, worst: s[n - 1], over33: over, frames: n };
}

// One line, plain ASCII: version, screen size and insets, median and worst frame
// time, frames over 33 ms, the lowest adaptive resolution scale, the start time
// (page load to running), the map id, script heap in MB, the system with the
// slowest single step, fullscreen, bad sounds, the handling preset and the last
// one-tap verdict of the Handling lab (none until tapped). A field that is not known prints n/a.
const ID_CLEAN = /[^A-Za-z0-9_.]/g;
const MAP_CLEAN = /[^A-Za-z0-9_.-]/g; // region ids have hyphens: miami-downtown
export function formatResult(r) {
  const ins = r.insets || { l: 0, r: 0, t: 0, b: 0 };
  const bad = r.bad && r.bad.length ? r.bad.slice().sort((a, b) => a - b).join(',') : 'none';
  const start = r.startMs > 0 ? `${(r.startMs / 1000).toFixed(1)} s` : 'n/a';
  const map = String(r.map || '').replace(MAP_CLEAN, '') || 'n/a';
  const mem = r.memMb > 0 ? `${Math.round(r.memMb)} MB` : 'n/a';
  const sysName = String((r.worstSystem && r.worstSystem.name) || '').replace(ID_CLEAN, '');
  const sys = sysName ? `${sysName} ${(r.worstSystem.ms || 0).toFixed(1)} ms` : 'n/a';
  return `RW ${r.version || 'dev'} | ${Math.round(r.w)}x${Math.round(r.h)} inset L${Math.round(ins.l)} R${Math.round(ins.r)} T${Math.round(ins.t)} B${Math.round(ins.b)}`
    + ` | median ${r.median.toFixed(1)} ms worst ${r.worst.toFixed(1)} ms | over33 ${r.over33} | res ${r.scale.toFixed(2)}`
    + ` | start ${start} | map ${map} | mem ${mem} | slowsys ${sys}`
    + ` | fullscreen ${r.fullscreen ? 'yes' : 'no'} | bad ${bad}`
    + ` | handling ${validPreset(r.handlingPreset)} ${validVerdict(r.handlingVerdict)}`;
}
export const RESULT_RE = /^RW \S+ \| \d+x\d+ inset L\d+ R\d+ T\d+ B\d+ \| median \d+\.\d ms worst \d+\.\d ms \| over33 \d+ \| res \d+\.\d\d \| start (\d+\.\d s|n\/a) \| map ([A-Za-z0-9_.-]+|n\/a) \| mem (\d+ MB|n\/a) \| slowsys ([A-Za-z0-9_.]+ \d+\.\d ms|n\/a) \| fullscreen (yes|no) \| bad (none|[1-8](,[1-8])*) \| handling (standard|relaxed|sharp) (none|right|twitchy|heavy|wide)$/;

// Times each system's own calls (fixedUpdate and always) while a check runs and
// remembers the slowest single call. It wraps the methods in place at start()
// and puts them back at stop(); the wrappers allocate nothing per call.
export function createSystemTimer(systems, now) {
  const clock = now || (() => (typeof performance !== 'undefined' ? performance.now() : 0));
  const saved = [];
  const worst = { name: '', ms: 0 };
  return {
    start() {
      if (saved.length || !systems) return;
      for (const s of systems) {
        if (!s || !s.name || s.name === 'phonecheck') continue;
        for (const key of ['fixedUpdate', 'always']) {
          const f = s[key];
          if (typeof f !== 'function') continue;
          saved.push([s, key, f]);
          s[key] = function timed(dt) {
            const t = clock();
            try { return f.call(s, dt); } finally {
              const d = clock() - t;
              if (d > worst.ms) { worst.ms = d; worst.name = s.name; }
            }
          };
        }
      }
    },
    stop() {
      for (let i = saved.length - 1; i >= 0; i--) saved[i][0][saved[i][1]] = saved[i][2];
      saved.length = 0;
    },
    worst: () => ({ name: worst.name, ms: worst.ms }),
  };
}

// ---------------------------------------------------------------------------
// The route: from the node nearest the start, always the edge that turns least
// (ties: the lowest edge id), until it is `meters` long. No randomness.
// ---------------------------------------------------------------------------
const angleDiff = (a, b) => Math.atan2(Math.sin(a - b), Math.cos(a - b));
export function buildRoute(city, x, z, meters = 1100) {
  const nodes = city.nodes, edges = city.edges;
  const route = [];
  if (!nodes || !nodes.length) return route;
  let cur = 0, best = Infinity;
  for (let i = 0; i < nodes.length; i++) {
    const d = Math.hypot(nodes[i].x - x, nodes[i].z - z);
    if (d < best) { best = d; cur = i; }
  }
  route.push({ x: nodes[cur].x, z: nodes[cur].z });
  let prev = -1, heading = NaN, total = 0;
  for (let guard = 0; guard < 600 && total < meters; guard++) {
    const n = nodes[cur];
    let pick = -1, pickScore = Infinity;
    for (const pass of [0, 1]) {
      for (const id of n.edges || []) {
        if (pass === 0 && id === prev) continue;
        const e = edges[id];
        const o = nodes[e.a === cur ? e.b : e.a];
        const bearing = Math.atan2(o.z - n.z, o.x - n.x);
        const score = Number.isNaN(heading) ? 0 : Math.abs(angleDiff(bearing, heading));
        if (score < pickScore - 1e-9 || (Math.abs(score - pickScore) <= 1e-9 && id < pick)) { pick = id; pickScore = score; }
      }
      if (pick >= 0) break; // a dead end: the second pass allows the way back
    }
    if (pick < 0) break;
    const e = edges[pick];
    const next = e.a === cur ? e.b : e.a;
    const o = nodes[next];
    total += Math.hypot(o.x - n.x, o.z - n.z);
    heading = Math.atan2(o.z - n.z, o.x - n.x);
    route.push({ x: o.x, z: o.z });
    prev = pick;
    cur = next;
  }
  return route;
}

// A pure-pursuit driver over the route. step() fills out { steer, throttle, brake }
// for a car with { x, z, heading, speed }. Fixed numbers, no clock.
export function createDriver(route) {
  let idx = 0, stuck = 0, reverse = 0;
  const st = { get index() { return idx; }, done: false };
  st.heading = () => (route.length > 1 ? Math.atan2(route[1].z - route[0].z, route[1].x - route[0].x) : 0);
  st.step = (car, out, dt) => {
    if (idx >= route.length - 1) { st.done = true; out.steer = 0; out.throttle = 0; out.brake = 1; return out; }
    while (idx < route.length - 2 && Math.hypot(route[idx + 1].x - car.x, route[idx + 1].z - car.z) < 12) idx++;
    const t = route[idx + 1];
    if (Math.hypot(t.x - car.x, t.z - car.z) < 8) idx++;
    const err = angleDiff(Math.atan2(t.z - car.z, t.x - car.x), car.heading);
    const v = Math.abs(car.speed || 0);
    const want = 12 - 7 * Math.min(1, Math.abs(err) / 0.9);
    // Stuck against something: back up for a moment, then try again.
    if (v < 0.6 && !reverse) { stuck += dt; if (stuck > 2.5) { reverse = 1.4; stuck = 0; } } else if (v >= 0.6) stuck = 0;
    if (reverse > 0) {
      reverse -= dt;
      out.steer = Math.max(-1, Math.min(1, -err * 2));
      out.throttle = 0;
      out.brake = 1;
      return out;
    }
    out.steer = Math.max(-1, Math.min(1, err * 2));
    out.throttle = Math.max(0, Math.min(1, (want - v) * 0.4));
    out.brake = v > want + 1.5 ? Math.min(0.7, (v - want) * 0.25) : 0;
    return out;
  };
  return st;
}

// ---------------------------------------------------------------------------
// The run: a timeline of fixed steps. game: the real game (or the test double).
// ---------------------------------------------------------------------------
export function createCheckRun(game, opts = {}) {
  const driveS = opts.driveSeconds ?? DRIVE_SECONDS;
  const slotS = opts.soundSeconds ?? SOUND_SECONDS;
  const frames = [];
  const bad = new Set();
  const out = { steer: 0, throttle: 0, brake: 0 };
  const src = opts.source || { steer: 0, throttle: 0, brake: 0, handbrake: false, moveX: 0, moveY: 0, sprint: false, pitch: 0, boost: false };
  const run = {
    phase: 'idle', t: 0, sound: -1, car: null, frames, bad, source: src, minScale: 99, fullscreen: false, error: '', fixtures: 0,
  };
  let saved = null, sysTimer = null, driver = null, fixtureCars = null, firing = 0, fought = false, blasted = false, prevStation = null, lastSound = -1;
  const ev = () => game.events;
  const emit = (name, payload) => { try { if (ev() && ev().emit) ev().emit(name, payload); } catch { /* a missing hook is fine */ } };
  const safe = (fn) => { try { return fn(); } catch { return undefined; } };

  run.start = function start() {
    const p = game.player;
    if (!p || (p.mode !== 'foot' && p.mode !== 'car')) { run.error = 'Get out of the boat or aircraft first.'; return false; }
    const city = game.city;
    if (!city || !city.nodes || !city.nodes.length) { run.error = 'No road map here.'; return false; }
    saved = { x: p.x, z: p.z, mode: p.mode, vehicle: p.vehicle || null };
    if (p.vehicle && game.exitVehicle) game.exitVehicle();
    const route = buildRoute(city, saved.x, saved.z);
    driver = createDriver(route);
    const a = route[0], h = driver.heading();
    const car = game.debug && game.debug.spawnCar ? game.debug.spawnCar('sedan', a.x, a.z, h) : null;
    if (!car) { run.error = 'Cannot place the test car.'; return false; }
    car.driver = 'player';
    run.car = car;
    p.walker.x = p.walker.px = a.x;
    p.walker.z = p.walker.pz = a.z;
    if (game.enterVehicle) game.enterVehicle(car);
    p.x = a.x; p.z = a.z;
    prevStation = game.audio && game.audio.station !== undefined ? game.audio.station : null;
    fixtureCars = [];
    run.route = route;
    run.phase = 'drive';
    run.t = 0;
    sysTimer = createSystemTimer(game.systems);
    sysTimer.start();
    run.fullscreen = typeof document !== 'undefined' && !!document.fullscreenElement;
    game.phoneCheckRunning = true; // objective.js: no turn by turn while the check drives
    return true;
  };

  // The point `d` meters ahead of the car along its heading, nudged to the route side.
  const ahead = (d, side = 0) => {
    const c = run.car;
    return { x: c.x + Math.cos(c.heading) * d - Math.sin(c.heading) * side, z: c.z + Math.sin(c.heading) * d + Math.cos(c.heading) * side, h: c.heading };
  };

  function fixtureFight() {
    // A parked crew car on the road ahead, shot at with the car's own gun for a few seconds.
    const a = ahead(30, 7); // beside the road, not in the way
    const v = safe(() => game.debug.spawnOccupied('sedan', a.x, a.z, a.h, 'crew'));
    if (v) { fixtureCars.push(v); run.fixtures++; }
    firing = 4;
    if (game.input) game.input.press('fire');
  }
  function fixtureBlast() {
    const a = ahead(40, 6);
    if (game.combat && game.combat.explode) { safe(() => game.combat.explode(a.x, 0.5, a.z, 9)); run.fixtures++; }
    else emit('explosion', { x: a.x, z: a.z, radius: 9, size: 'big' });
  }

  // The eight sounds, through the audio hooks the game already has (docs/AUDIO.md).
  function playSound(i) {
    const c = run.car, p = game.player;
    const x = c.x, z = c.z;
    if (i === 2) { for (let k = 0; k < 3; k++) emit('shot', { weapon: 'pistol', x, z, shooter: p.walker, hitKind: 'none', k }); }
    else if (i === 3) { const a = ahead(30); emit('explosion', { x: a.x, z: a.z, radius: 8, size: 'big' }); }
    else if (i === 4) {
      emit('siren', true);
      // the test car is not a police car: ask the audio for a siren nearby
      if (game.audio && game.audio.testSiren) game.audio.testSiren(true);
    }
    else if (i === 6 && game.audio && game.audio.setStation) game.audio.setStation(nextStation(prevStation || 'off', 1) === 'off' ? 'chill' : nextStation(prevStation || 'off', 1));
    else if (i === 7) emit('boost', { vehicle: c, craft: 'car', on: true });
  }
  function endSound(i) {
    const c = run.car;
    if (i === 4) {
      emit('siren', false);
      if (game.audio && game.audio.testSiren) game.audio.testSiren(false);
    }
    else if (i === 6 && game.audio && game.audio.setStation) game.audio.setStation(prevStation || 'off');
    else if (i === 7) emit('boost', { vehicle: c, craft: 'car', on: false });
  }

  // One fixed step (1/60 s).
  run.step = function step(dt) {
    if (run.phase !== 'drive' && run.phase !== 'sounds') return;
    run.t += dt;
    const c = run.car;
    if (!c) return;
    driver.step(c, out, dt);
    src.steer = out.steer; src.throttle = out.throttle; src.brake = out.brake; src.handbrake = false;
    if (run.phase === 'drive') {
      if (!fought && run.t >= driveS * 0.3) { fought = true; fixtureFight(); }
      if (!blasted && run.t >= driveS * 0.65) { blasted = true; fixtureBlast(); }
      if (firing > 0) { firing -= dt; if (firing <= 0 && game.input) game.input.release('fire'); }
      if (run.t >= driveS) { run.phase = 'sounds'; run.t = 0; run.sound = -1; }
      return;
    }
    // sounds: slot k runs from k * slotS to (k + 1) * slotS
    const k = Math.floor(run.t / slotS);
    const into = run.t - k * slotS;
    if (k !== lastSound && k < SOUNDS.length) {
      if (lastSound >= 0) endSound(lastSound);
      lastSound = k;
      run.sound = k;
      playSound(k);
    }
    if (run.sound === 0) src.throttle = 1; // engine: floor it
    if (run.sound === 1 && into > 0.3 && into < 1.5) { src.steer = 1; src.handbrake = true; src.throttle = 1; } // tires: a slide
    // from the gunshot on, the car rolls to a stop and idles, so each test
    // sound is heard on its own and not under engine and road roar
    // (brake only while rolling: held at a standstill it would reverse)
    if (run.sound >= 2) { src.throttle = 0; src.brake = Math.abs(c.speed || 0) > 0.5 ? 1 : 0; src.steer = 0; }
    if (k >= SOUNDS.length) {
      endSound(SOUNDS.length - 1);
      run.phase = 'done';
    }
  };

  // Real frame times in milliseconds (the panel feeds them from requestAnimationFrame).
  run.feedFrame = function feedFrame(ms) {
    if (run.phase !== 'drive' && run.phase !== 'sounds') return;
    if (ms > 0 && ms < 2000) frames.push(ms);
    const g = game.graphics;
    if (g && g.res && g.res.scale < run.minScale) run.minScale = g.res.scale;
  };

  run.mark = (n, on) => { if (on) bad.add(n); else bad.delete(n); };
  run.result = function result(env = {}) {
    const st = frameStats(frames);
    return {
      version: env.version || 'dev', w: env.w ?? 0, h: env.h ?? 0, insets: env.insets,
      median: st.median, worst: st.worst, over33: st.over33,
      scale: run.minScale === 99 ? (env.scale ?? 1) : run.minScale,
      fullscreen: run.fullscreen || !!env.fullscreen, bad: [...bad],
      startMs: env.startMs, map: env.map, memMb: env.memMb,
      worstSystem: sysTimer ? sysTimer.worst() : (run.lastWorst || null),
      handlingPreset: env.handlingPreset, handlingVerdict: env.handlingVerdict,
    };
  };

  // Put everything back: the test car and its fixtures go, the player returns.
  run.finish = function finish() {
    if (run.phase === 'idle') return;
    if (sysTimer) { run.lastWorst = sysTimer.worst(); sysTimer.stop(); sysTimer = null; }
    src.steer = src.throttle = src.brake = 0; src.handbrake = false;
    if (game.input) game.input.release('fire');
    if (lastSound >= 0 && lastSound < SOUNDS.length) endSound(lastSound);
    const p = game.player;
    if (p && p.vehicle === run.car && game.exitVehicle) game.exitVehicle();
    for (const v of fixtureCars || []) safe(() => game.removeVehicle(v));
    if (run.car) safe(() => game.removeVehicle(run.car));
    if (saved && p) {
      p.walker.x = p.walker.px = saved.x;
      p.walker.z = p.walker.pz = saved.z;
      p.x = saved.x; p.z = saved.z;
      // The car left at the start may have been cleared away while the
      // check drove far off (removed, no mesh): then stay on foot.
      const back = saved.vehicle;
      if (back && !back.wrecked && !back.removed && game.enterVehicle) safe(() => game.enterVehicle(back));
    }
    run.phase = 'idle';
    run.car = null;
    game.phoneCheckRunning = false;
  };
  run.cancel = run.finish;
  return run;
}

// ---------------------------------------------------------------------------
// The panel (browser only). Created once by the menu; start() runs the check.
// ---------------------------------------------------------------------------
const CSS = `
.rw-pc { z-index: 45; pointer-events: none; }
/* While the check runs its bar owns the bottom edge: the prompt strip (and any red alert) waits. */
.rw-pc-on .rw-prompt { display: none !important; }
.rw-pc button, .rw-pc textarea { pointer-events: auto; font: 700 14px system-ui, sans-serif; touch-action: manipulation; }
.rw-pc-bar { position: absolute; left: 50%; bottom: calc(var(--rw-sb) + 8px); transform: translateX(-50%); display: flex; align-items: center; gap: 8px;
  max-width: calc(100vw - var(--rw-sl) - var(--rw-sr) - 16px); padding: 6px 8px; border-radius: 8px; background: rgba(0, 0, 0, 0.7); color: #fff; font: 700 14px system-ui, sans-serif; }
.rw-pc-bar span { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.rw-pc-btn { min-width: 48px; height: 48px; padding: 0 14px; border-radius: 10px; border: 2px solid rgba(255, 255, 255, 0.35); background: rgba(40, 32, 28, 0.9); color: #fff; }
.rw-pc-btn[aria-pressed="true"] { background: #b3261e; border-color: #ffb4a8; }
.rw-pc-btn.rw-pc-main { background: #e2733a; border-color: #ffd0b5; }
.rw-pc-sounds { display: flex; gap: 6px; }
.rw-pc-sounds .rw-pc-btn { min-width: 48px; padding: 0; }
.rw-pc-card { position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%); width: min(560px, calc(100vw - var(--rw-sl) - var(--rw-sr) - 24px));
  padding: 12px 14px; border-radius: 12px; background: rgba(18, 14, 12, 0.94); color: #fff; font: 14px system-ui, sans-serif; border: 1px solid rgba(255, 255, 255, 0.25); }
.rw-pc-card h3 { margin: 0 0 4px; font-size: 18px; }
.rw-pc-card p { margin: 0 0 8px; font-size: 13px; opacity: 0.85; }
.rw-pc-card .rw-pc-sounds { justify-content: space-between; margin-bottom: 4px; }
.rw-pc-legend { font-size: 11px; opacity: 0.75; margin-bottom: 8px; }
.rw-pc-card textarea { box-sizing: border-box; width: 100%; height: 64px; resize: none; padding: 6px 8px; border-radius: 8px; background: #fff; color: #111; border: 0; font: 12px/1.3 ui-monospace, monospace; user-select: text; -webkit-user-select: text; }
.rw-pc-actions { display: flex; gap: 8px; margin-top: 8px; align-items: center; }
.rw-pc-actions .rw-pc-note { flex: 1; font-size: 12px; opacity: 0.85; }
.rw-pc-labbar { bottom: auto; top: calc(var(--rw-st) + 8px); }
.rw-pc-labcard { width: min(460px, calc(100vw - var(--rw-sl) - var(--rw-sr) - 24px)); }
.rw-pc-labgrid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-bottom: 8px; }
.rw-pc-labcard > .rw-pc-btn { width: 100%; }
`;

export function createPhoneCheck(game, root, opts = {}) {
  const state = { run: null, raf: 0, panel: null, last: 0, lastScale: 0, onEnd: null };
  const hasDom = typeof document !== 'undefined' && !!root;
  let src = null, sys = null;

  function version() {
    /* global __VERSION__ */
    return typeof __VERSION__ !== 'undefined' ? __VERSION__ : 'dev';
  }
  function insets() {
    const probe = document.createElement('div');
    probe.className = 'rw-hud rw-pc-probe';
    probe.style.cssText = 'visibility:hidden;pointer-events:none;width:0;height:0;padding:var(--rw-st) var(--rw-sr) var(--rw-sb) var(--rw-sl)';
    root.appendChild(probe);
    const cs = getComputedStyle(probe);
    const o = { l: parseFloat(cs.paddingLeft) || 0, r: parseFloat(cs.paddingRight) || 0, t: parseFloat(cs.paddingTop) || 0, b: parseFloat(cs.paddingBottom) || 0 };
    probe.remove();
    return o;
  }
  // Page load to running: game.startMs or window.__rwStartMs when main.js sets one,
  // else the 'rw-running' performance mark. 0 when none exists (printed as n/a).
  function startMs() {
    if (game.startMs > 0) return game.startMs;
    if (typeof window !== 'undefined' && window.__rwStartMs > 0) return window.__rwStartMs;
    try {
      const m = performance.getEntriesByName('rw-running', 'mark');
      if (m.length) return m[0].startTime;
    } catch { /* not available */ }
    return 0;
  }
  function memoryMb() {
    const m = typeof performance !== 'undefined' ? performance.memory : null;
    return m && m.usedJSHeapSize > 0 ? m.usedJSHeapSize / 1048576 : 0;
  }
  const env = () => ({
    version: version(), w: window.innerWidth, h: window.innerHeight, insets: insets(),
    scale: game.graphics && game.graphics.res ? game.graphics.res.scale : 1, fullscreen: !!document.fullscreenElement,
    startMs: startMs(), map: game.city && (game.city.mapId || game.city.map), memMb: memoryMb(),
    handlingPreset: game.progress && game.progress.settings ? game.progress.settings.handlingPreset : undefined,
    handlingVerdict: game.progress && game.progress.settings ? game.progress.settings.handlingVerdict : undefined,
  });
  const el = (tag, cls, parent, text) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    if (parent) parent.appendChild(e);
    return e;
  };

  function injectCss() {
    if (document.getElementById('rw-pc-css')) return;
    const s = el('style', '', document.head, CSS);
    s.id = 'rw-pc-css';
  }

  function soundButtons(parent, run) {
    const row = el('div', 'rw-pc-sounds', parent);
    SOUNDS.forEach((name, i) => {
      const b = el('button', 'rw-pc-btn', row, String(i + 1));
      b.type = 'button';
      b.setAttribute('aria-label', `Sound ${i + 1}, ${name}: tap if it sounds bad`);
      b.setAttribute('aria-pressed', String(run.bad.has(i + 1)));
      b.addEventListener('click', () => {
        const on = !run.bad.has(i + 1);
        run.mark(i + 1, on);
        b.setAttribute('aria-pressed', String(on));
        if (state.refreshLine) state.refreshLine();
      });
    });
    return row;
  }

  function showBar(run) {
    clearPanel();
    const panel = el('div', 'rw-hud rw-pc', root);
    state.panel = panel;
    const bar = el('div', 'rw-pc-bar', panel);
    const text = el('span', '', bar);
    const stop = el('button', 'rw-pc-btn', bar, 'Stop');
    stop.type = 'button';
    stop.addEventListener('click', () => end(true));
    state.bar = { text, sounds: null, bar };
    state.barRun = run;
  }
  function updateBar(run) {
    const b = state.bar;
    if (!b) return;
    if (run.phase === 'drive') b.text.textContent = `Phone check: driving by itself, ${Math.max(0, Math.ceil(opts.driveSeconds ?? DRIVE_SECONDS) - Math.floor(run.t))} s left`;
    else if (run.phase === 'sounds') {
      b.text.textContent = `Sound ${Math.min(run.sound + 1, SOUNDS.length)} of 8: ${SOUNDS[Math.max(0, Math.min(run.sound, SOUNDS.length - 1))]}. Tap bad ones`;
      if (!b.sounds) b.sounds = soundButtons(b.bar, run);
    }
  }

  function clearPanel() {
    if (state.panel) state.panel.remove();
    state.panel = null;
    state.bar = null;
  }

  function showResult(run) {
    clearPanel();
    const panel = el('div', 'rw-hud rw-pc', root);
    state.panel = panel;
    const card = el('div', 'rw-pc-card', panel);
    card.setAttribute('role', 'dialog');
    card.setAttribute('aria-label', 'Phone check result');
    el('h3', '', card, 'Phone check done');
    el('p', '', card, 'Tap any number that sounded bad, then copy the result and paste it into the chat.');
    soundButtons(card, run);
    el('div', 'rw-pc-legend', card, SOUNDS.map((n, i) => `${i + 1} ${n}`).join('   '));
    const box = el('textarea', '', card);
    box.readOnly = true;
    box.setAttribute('aria-label', 'Result line');
    const refresh = () => { state.e = env(); box.value = formatResult(run.result(state.e)); };
    state.refreshLine = refresh;
    refresh();
    const actions = el('div', 'rw-pc-actions', card);
    const copy = el('button', 'rw-pc-btn rw-pc-main', actions, 'Copy result');
    copy.type = 'button';
    const note = el('span', 'rw-pc-note', actions, '');
    const done = el('button', 'rw-pc-btn', actions, 'Done');
    done.type = 'button';
    copy.addEventListener('click', () => {
      refresh();
      const fallback = () => {
        box.focus();
        box.select();
        let ok;
        try { ok = document.execCommand && document.execCommand('copy'); } catch { ok = false; }
        note.textContent = ok ? 'Copied.' : 'Press and hold the text above, then choose Copy.';
      };
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(box.value).then(() => { note.textContent = 'Copied.'; }, fallback);
      else fallback();
    });
    done.addEventListener('click', () => { clearPanel(); state.refreshLine = null; });
    state.result = box;
  }

  function frame(now) {
    const run = state.run;
    if (!run) return;
    if (state.last) run.feedFrame(now - state.last);
    state.last = now;
    updateBar(run);
    if (run.phase === 'done') { end(false); return; }
    state.raf = requestAnimationFrame(frame);
  }

  function end(canceled) {
    const run = state.run;
    if (!run) return;
    cancelAnimationFrame(state.raf);
    const had = run.phase === 'done';
    state.run = null;
    run.finish();
    if (game.touch && game.touch.setVisible) game.touch.setVisible(true);
    root.classList.remove('rw-pc-on');
    if (had && !canceled) { state.finished = run; showResult(run); } else clearPanel();
    if (state.onEnd) state.onEnd(!canceled);
  }

  function start() {
    if (!hasDom || state.run) return false;
    injectCss();
    if (!src) src = game.input.addSource({ steer: 0, throttle: 0, brake: 0, handbrake: false, moveX: 0, moveY: 0, sprint: false, pitch: 0, boost: false });
    const run = createCheckRun(game, { ...opts, source: src });
    if (!run.start()) {
      state.error = run.error;
      return false;
    }
    state.run = run;
    state.last = 0;
    if (!sys && game.addSystem) sys = game.addSystem({ name: 'phonecheck', fixedUpdate(dt) { if (state.run) state.run.step(dt); } });
    // Best effort: ask for fullscreen on this tap (the check reports whether it was granted).
    Promise.resolve().then(() => document.documentElement.requestFullscreen && !document.fullscreenElement && document.documentElement.requestFullscreen({ navigationUI: 'hide' })).catch(() => {});
    if (game.touch && game.touch.setVisible) game.touch.setVisible(false);
    root.classList.add('rw-pc-on');
    showBar(run);
    updateBar(run);
    state.raf = requestAnimationFrame(frame);
    return true;
  }

  return {
    start,
    cancel: () => end(true),
    isRunning: () => !!state.run,
    error: () => state.error || '',
    onEnd(fn) { state.onEnd = fn; },
    // For tests: the line the panel would copy.
    resultLine: () => (state.finished ? formatResult(state.finished.result(env())) : ''),
    get run() { return state.run; },
  };
}

// ---------------------------------------------------------------------------
// Handling lab test drive (docs/PLAN_V3.md 2.4 item 5): the player in the sedan
// on a long straight street near the start, no traffic, then back where they
// were. Pure part first: the street is the nearest straight edge of 120 m or
// more that is not a bridge or causeway.
// ---------------------------------------------------------------------------
export const LAB_MIN_EDGE = 120;
export const LAB_FALLBACK_EDGE = 80;
export const LAB_CLEAR_RADIUS = 160;
export function findLabStreet(city, x, z) {
  if (!city || !city.nodes || !city.edges) return null;
  let best = null, bestD = Infinity;
  for (const minLen of [LAB_MIN_EDGE, LAB_FALLBACK_EDGE]) { // short blocks only when no long street exists
    for (const e of city.edges) {
      if (!(e.length >= minLen) || e.bridge || e.causeway) continue;
      const a = city.nodes[e.a], b = city.nodes[e.b];
      if (!a || !b) continue;
      const d = Math.hypot((a.x + b.x) / 2 - x, (a.z + b.z) / 2 - z);
      if (d < bestD - 1e-9 || (Math.abs(d - bestD) <= 1e-9 && best && e.id < best.id)) { bestD = d; best = e; }
    }
    if (best) break;
  }
  if (!best) return null;
  const a = city.nodes[best.a], b = city.nodes[best.b];
  const heading = Math.atan2(b.z - a.z, b.x - a.x);
  const along = Math.min(20, best.length * 0.15); // start a little past the crossing, a long run ahead
  return { edge: best.id, x: a.x + Math.cos(heading) * along, z: a.z + Math.sin(heading) * along, heading, run: best.length - along };
}

export function createLabDrive(game, root, opts = {}) {
  const st = { active: false, car: null, saved: null, panel: null, sys: null, street: null };
  const hasDom = typeof document !== 'undefined' && !!root;
  const safe = (fn) => { try { return fn(); } catch { return undefined; } };
  const api = {
    isActive: () => st.active,
    error: '',
    get car() { return st.car; },
    start() {
      const p = game.player;
      api.error = '';
      if (st.active) return true;
      if (!p || (p.mode !== 'foot' && p.mode !== 'car')) { api.error = 'Get out of the boat or aircraft first.'; return false; }
      if (!game.debug || !game.debug.spawnCar) { api.error = 'Cannot place the test car.'; return false; }
      const street = findLabStreet(game.city, p.x, p.z);
      if (!street) { api.error = 'No straight street here.'; return false; }
      st.saved = { x: p.x, z: p.z, vehicle: p.vehicle || null };
      if (p.vehicle && game.exitVehicle) game.exitVehicle();
      const car = game.debug.spawnCar('sedan', street.x, street.z, street.heading);
      if (!car) { api.error = 'Cannot place the test car.'; return false; }
      car.driver = 'player';
      st.car = car;
      st.street = street;
      p.walker.x = p.walker.px = street.x;
      p.walker.z = p.walker.pz = street.z;
      if (game.enterVehicle) game.enterVehicle(car);
      p.x = street.x; p.z = street.z;
      st.active = true;
      clearTraffic();
      if (!st.sys && game.addSystem) st.sys = game.addSystem({ name: 'handlinglab', fixedUpdate() { if (st.active) clearTraffic(); } });
      if (hasDom) showPanel();
      return true;
    },
    // Put everything back: the test car goes, the player returns on foot or into the car they left.
    finish() {
      if (!st.active) return;
      st.active = false;
      if (st.panel) { st.panel.remove(); st.panel = null; }
      const p = game.player;
      if (p && p.vehicle === st.car && game.exitVehicle) safe(() => game.exitVehicle());
      if (st.car) safe(() => game.removeVehicle(st.car));
      if (st.saved && p) {
        p.walker.x = p.walker.px = st.saved.x;
        p.walker.z = p.walker.pz = st.saved.z;
        p.x = st.saved.x; p.z = st.saved.z;
        const back = st.saved.vehicle;
        if (back && !back.wrecked && !back.removed && game.enterVehicle) safe(() => game.enterVehicle(back));
      }
      st.car = null;
      if (st.panel) { st.panel.remove(); st.panel = null; }
      if (opts.onEnd) opts.onEnd();
    },
  };
  // No traffic on the street: traffic cars near the test car are removed (no allocation).
  function clearTraffic() {
    const c = st.car, list = game.vehicles;
    if (!c || !list) return;
    for (let i = list.length - 1; i >= 0; i--) {
      const v = list[i];
      if (v === c || !v.traffic || v.driver === 'player') continue;
      if (Math.hypot(v.x - c.x, v.z - c.z) < LAB_CLEAR_RADIUS) safe(() => game.removeVehicle(v));
    }
  }
  // While driving: one small button at the top center ("Finish"). It opens the
  // verdict card: one tap on a verdict saves it and ends the drive.
  function showPanel() {
    injectPcCss();
    const panel = document.createElement('div');
    panel.className = 'rw-hud rw-pc rw-pc-lab';
    root.appendChild(panel);
    st.panel = panel;
    const bar = document.createElement('div');
    bar.className = 'rw-pc-bar rw-pc-labbar';
    panel.appendChild(bar);
    const text = document.createElement('span');
    text.textContent = 'Test drive';
    const fin = document.createElement('button');
    fin.type = 'button';
    fin.className = 'rw-pc-btn rw-pc-main';
    fin.textContent = 'Finish';
    fin.dataset.role = 'labdrive-finish';
    fin.addEventListener('click', () => { bar.remove(); showVerdict(panel); });
    bar.append(text, fin);
  }
  function showVerdict(panel) {
    const card = document.createElement('div');
    card.className = 'rw-pc-card rw-pc-labcard';
    card.setAttribute('role', 'dialog');
    card.setAttribute('aria-label', 'How did it feel?');
    panel.appendChild(card);
    const h3 = document.createElement('h3');
    h3.textContent = 'How did it feel?';
    card.appendChild(h3);
    const grid = document.createElement('div');
    grid.className = 'rw-pc-labgrid';
    card.appendChild(grid);
    for (const id of VERDICTS) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'rw-pc-btn' + (id === 'right' ? ' rw-pc-main' : '');
      b.textContent = VERDICT_LABELS[id];
      b.dataset.verdict = id;
      b.addEventListener('click', () => { if (opts.onVerdict) opts.onVerdict(id); api.finish(); });
      grid.appendChild(b);
    }
    const skip = document.createElement('button');
    skip.type = 'button';
    skip.className = 'rw-pc-btn';
    skip.textContent = 'Back, no verdict';
    skip.dataset.role = 'labdrive-skip';
    skip.addEventListener('click', () => api.finish());
    card.appendChild(skip);
  }
  return api;
}

function injectPcCss() {
  if (typeof document === 'undefined' || document.getElementById('rw-pc-css')) return;
  const s = document.createElement('style');
  s.id = 'rw-pc-css';
  s.textContent = CSS;
  document.head.appendChild(s);
}
