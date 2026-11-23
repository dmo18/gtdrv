import { createGame } from './game.js';
import { registerServiceWorker } from './pwa.js';
import { createTitle } from './ui/title.js';
import { mapFromSearch, loadMapCity, MAP_CHOICE_KEY } from './world/maps.js';

const msg = document.getElementById('bootmsg');
const title = createTitle(document);

const uiRoot = document.getElementById('ui');
const showUi = (on) => {
  if (uiRoot) uiRoot.style.visibility = on ? '' : 'hidden';
};

function start(game, blend) {
  title.hide();
  // Play begins: from here the place is autosaved again.
  game.session.hold(false);
  game.resize();
  game.loop.start();
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

async function loadCity() {
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

async function startUp() {
  const city = await loadCity();
  const game = createGame({
    canvas: document.getElementById('game'),
    uiRoot: document.getElementById('ui'),
    city,
  });
  window.__rw = game;
  game.draw(1, 0);
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
  title.setReady(true);
  title.setCanContinue(game.session.canContinue());
  title.onStart(() => {
    game.audio.unlock();
    // Best effort: go full screen and lock sideways. Not every browser allows it.
    // The camera blend must not wait on this: some browsers never settle it.
    goFullscreen();
    if (game.daynight && game.daynight.leaveTitle) game.daynight.leaveTitle('start');
    game.session.startFresh();
    start(game, true);
  });
  title.onContinue(async () => {
    game.audio.unlock();
    try {
      await document.documentElement.requestFullscreen?.({ navigationUI: 'hide' });
      await screen.orientation?.lock?.('landscape');
    } catch {
      /* fine without */
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
    start(game);
    if (!ok && game.hud && game.hud.toast) game.hud.toast('Could not restore your place', 3);
    await veil.to(0);
    veil.remove();
  });
  if (autostart) start(game);
}
startUp().catch((err) => {
  console.error(err);
  // Say what failed, so it can be reported (name and message only).
  const why = err && (err.name || err.message) ? ' (' + String(err.name || '') + ': ' + String(err.message || '').slice(0, 120) + ')' : '';
  msg.textContent = 'Sorry, the game could not start on this device.' + why;
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
