import { createGameSteps } from './game.js';
import { registerServiceWorker } from './pwa.js';
import { createTitle } from './ui/title.js';
import { mapFromSearch, loadMapCity, MAP_CHOICE_KEY } from './world/maps.js';
import { migrateMapChoice } from './core/save.js';
import { takeTravelNote } from './core/travel.js';
import { createQualityBench, neverChosen } from './core/qualitybench.js';
import { continueAfter, failureKind, failureMessage } from './core/launch.js';

const msg = document.getElementById('bootmsg');
const title = createTitle(document);
// Each progress step tells the HTML shell's watchdog the start is alive.
let shellOk = false; // __rwOk was sent: the shell no longer shows failures
const shellCall = (name) => {
  if (name === '__rwOk') shellOk = true;
  if (typeof window[name] === 'function') window[name]();
};
{
  const setProgress = title.setProgress;
  title.setProgress = (...a) => {
    shellCall('__rwTick');
    return setProgress.apply(title, a);
  };
}

const uiRoot = document.getElementById('ui');
const showUi = (on) => {
  if (uiRoot) uiRoot.style.visibility = on ? '' : 'hidden';
};

// Page load to running (the Phone check start field, PLAN_V2 section 4):
// set once, the first time the game is playable: the title is up with
// Start enabled (on Miami the simulation already runs behind it, the
// moment scripts/perf-scenarios.mjs times as the first loop start), or
// play itself began (?autostart).
function markRunning() {
  try {
    if (window.__rwStartMs > 0) return;
    window.__rwStartMs = Math.round(performance.now());
    performance.mark('rw-running');
  } catch {
    // no performance API: the Phone check prints n/a
  }
}

function start(game, blend) {
  title.hide();
  // Play begins: from here the place is autosaved again.
  game.session.hold(false);
  game.resize();
  game.loop.start();
  markRunning();
  // The HUD and controls show when the camera has blended to the chase view
  // (docs/REVAMP.md 6.8); then, on the first visit only, the player may pick
  // how they want to steer. (Skipped for the automated checks, which start
  // with ?autostart.)
  const begin = () => {
    showUi(true);
    if (!new URLSearchParams(location.search).has('autostart')) game.menu.maybeAskSteering();
  };
  if (blend && game.titleCam && game.titleCam.active) game.titleCam.blend(begin);
  else {
    if (game.titleCam) game.titleCam.stop();
    begin();
  }
}

// The real-map city (the default), loaded as its own chunk (the map data
// is bundled, never fetched from elsewhere). ?map=island: the procedural
// island (null: createGame generates it).
function storedMap() {
  try {
    return localStorage.getItem(MAP_CHOICE_KEY);
  } catch {
    return null;
  }
}

// Players of 0.4.0 to 0.6.0 played the whole box: once, their stored choice
// becomes the region that holds their saved place (PLAN_V2 3.5). A map
// named in the URL (tests, links) is left alone.
function migrateStoredMap() {
  try {
    if (new URLSearchParams(location.search).has('map')) return;
    migrateMapChoice(localStorage);
  } catch {
    // no storage: nothing to migrate
  }
}

async function loadCity() {
  migrateStoredMap();
  const id = mapFromSearch(location.search, storedMap());
  if (id === 'island') return null;
  try {
    return await loadMapCity(id);
  } catch (err) {
    // A device that cannot build the real map still gets the game: the island.
    console.error('Miami map failed, using the classic island', err);
    return null;
  }
}

// A black overlay for the short fade into a continued game (0.3 s each way,
// CSS transition; the wait is a real-time UI delay, never game logic).
function fadeVeil() {
  const el = document.createElement('div');
  el.style.cssText = 'position:fixed;inset:0;background:#000;opacity:0;z-index:60;pointer-events:none;transition:opacity .3s linear';
  document.body.appendChild(el);
  return {
    to(v) {
      return new Promise((resolve) => {
        el.getBoundingClientRect();
        el.style.opacity = String(v);
        setTimeout(resolve, 320);
      });
    },
    remove() {
      el.remove();
    },
  };
}

// Best effort: go full screen and lock sideways. Not every browser allows it.
function goFullscreen() {
  Promise.resolve()
    .then(() => document.documentElement.requestFullscreen?.({ navigationUI: 'hide' }))
    .then(() => screen.orientation?.lock?.('landscape'))
    .catch(() => {
      /* fine without */
    });
}

// Gives the browser a turn to paint the progress bar between build stages: the
// next frame, then a task. A page that never paints (hidden tab) moves on after 100 ms.
function yieldToBrowser() {
  return new Promise((resolve) => {
    let done = false;
    const go = () => {
      if (!done) {
        done = true;
        resolve();
      }
    };
    setTimeout(go, 100);
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => setTimeout(go, 0));
  });
}

// The first-run benchmark (core/qualitybench.js): about 3 s of real frames
// behind the title, only when no quality was ever chosen. The result is
// stored with the other settings; a failed or short run leaves things as they are.
function runQualityBench(game) {
  const st = game.progress && game.progress.settings;
  if (!st || !neverChosen(st) || typeof requestAnimationFrame !== 'function') return;
  const bench = createQualityBench();
  let last = 0;
  const tick = (now) => {
    // Not while hidden, paused or still compiling the shaders behind the
    // title (0.13.7: those frames sent fast phones to Low).
    if (document.hidden || game.paused || (game.graphics && game.graphics.warmDone === false)) {
      last = 0;
      requestAnimationFrame(tick);
      return;
    }
    const dt = last ? now - last : 0;
    last = now;
    if (dt > 0 && bench.push(dt)) {
      const r = bench.result();
      if (r) {
        st.quality = r.quality;
        st.qualityBenchmarked = true;
        if (game.economy && game.economy.applySettings) game.economy.applySettings();
        game.events.emit('progress');
      }
      return;
    }
    // Play began: no more measuring (the load changes).
    if (!title.isShown()) return;
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

async function startUp() {
  title.setProgress('Loading the map', 1);
  await yieldToBrowser();
  const city = await loadCity();
  const mapId = (city && city.mapId) || 'island';
  // The build runs in stages; between them the browser paints the bar.
  const steps = createGameSteps({
    canvas: document.getElementById('game'),
    uiRoot: document.getElementById('ui'),
    city,
  });
  let step = steps.next();
  while (!step.done) {
    title.setProgress(step.value.label, step.value.pct);
    await yieldToBrowser();
    step = steps.next();
  }
  const game = step.value;
  window.__rw = game;
  title.setProgress('Starting', 95);
  await yieldToBrowser();
  game.draw(1, 0);
  title.endProgress();
  msg.textContent = (city && city.texts && city.texts.boot) || 'An island of rust, salt and bad ideas.';
  // While the title shows, the saved place is kept as it is.
  const autostart = new URLSearchParams(location.search).has('autostart');
  if (!autostart) game.session.hold(true);
  // The designed first view (6.8): the camera on the start street at 17:30
  // clear, the simulation running behind the title, no HUD.
  const sv = city && city.startView;
  if (sv && !autostart && game.titleCam) {
    const st = game.progress && game.progress.settings;
    const reduced = !!(st && st.reduceMotion) || !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    if (game.daynight && game.daynight.enterTitle) game.daynight.enterTitle(sv);
    game.titleCam.start(sv, reduced);
    showUi(false);
    game.loop.start();
    game.draw(1, 0);
    title.showView(true);
  }
  title.setMap(mapId);
  title.setReady(true);
  shellCall('__rwOk');
  if (!autostart) markRunning();
  title.setCanContinue(game.session.canContinue());
  // Idle work after the title is up: the first-run benchmark, then the map
  // raster (the minimap needs it once play begins; it is not drawn at start).
  if (!autostart) {
    runQualityBench(game);
    setTimeout(() => {
      try {
        if (game.map && game.map.renderer && game.map.renderer.ensure) game.map.renderer.ensure();
      } catch (e) {
        console.error(e);
      }
    }, 3600);
  }
  title.onStart(() => {
    game.audio.unlock();
    // Best effort: go full screen and lock sideways. Not every browser allows it.
    // The camera blend must not wait on this: some browsers never settle it.
    goFullscreen();
    if (game.daynight && game.daynight.leaveTitle) game.daynight.leaveTitle('start');
    game.session.startFresh();
    start(game, true);
  });
  // Continue, and the arrival after travel (a fresh page in the target
  // region: no tap, so no full screen). `link`: the pad the player came
  // through, for the exact arrival pose.
  async function continueGame(tapped, link, traveled = false) {
    game.audio.unlock();
    if (tapped) {
      // Never wait on the browser: a promise that does not settle moves on after 1.5 s.
      await new Promise((resolve) => {
        continueAfter(
          () => Promise.resolve(document.documentElement.requestFullscreen?.({ navigationUI: 'hide' })).then(() => screen.orientation?.lock?.('landscape')),
          resolve,
          setTimeout,
        );
      });
    }
    const veil = fadeVeil();
    await veil.to(1);
    if (game.daynight && game.daynight.leaveTitle) game.daynight.leaveTitle('continue');
    let ok;
    try {
      ok = game.session.continueSaved();
    } catch {
      ok = false;
    }
    if (!ok) game.session.startFresh();
    else if ((link || traveled) && game.session.arrive) game.session.arrive(link);
    start(game);
    if (!ok && game.hud && game.hud.toast) game.hud.toast(link ? 'Arrived at the start place' : 'Could not restore your place', 3);
    await veil.to(0);
    veil.remove();
  }
  title.onContinue(() => continueGame(true, null));
  // Travel reloaded the page: carry on in the new region without the title.
  let note;
  try {
    note = takeTravelNote(sessionStorage, mapId);
  } catch {
    note = null;
  }
  if (note && !autostart) continueGame(false, note.link, true);
  if (autostart) start(game);
}
startUp().catch((err) => {
  console.error(err);
  // Say what failed, so it can be reported (name and message only).
  const why = err && (err.name || err.message) ? ' (' + String(err.name || '') + ': ' + String(err.message || '').slice(0, 120) + ')' : '';
  // After __rwOk the shell ignores a failure: write it to the message line.
  if (typeof window.__rwFail === 'function' && !shellOk) window.__rwFail(failureKind(err), why.slice(2, -1));
  else msg.textContent = failureMessage(failureKind(err)) + why;
});

// Offline support. A new version is applied right away only while the
// title screen is showing; otherwise it waits until the next launch.
registerServiceWorker((apply) => {
  if (title.isShown()) apply();
});

// Called by the Android wrapper when the system Back button is pressed.
// Returns 'paused' when it paused a running game, or 'leave' when the app
// should go to the background (title screen, or game already paused).
window.__rwBack = () => {
  const game = window.__rw;
  if (!game || title.isShown()) return 'leave';
  if (!game.paused) {
    game.paused = true;
    game.events.emit('pause', true);
    return 'paused';
  }
  return 'leave';
};
