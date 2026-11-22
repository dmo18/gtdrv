import { createGame } from './game.js';
import { registerServiceWorker } from './pwa.js';
import { createTitle } from './ui/title.js';
import { mapFromSearch, MAP_CHOICE_KEY } from './world/maps.js';

const msg = document.getElementById('bootmsg');
const title = createTitle(document);

function start(game) {
  title.hide();
  // Play begins: from here the place is autosaved again.
  game.session.hold(false);
  game.resize();
  game.loop.start();
  // First visit only: let the player pick how they want to steer.
  // (Skipped for the automated checks, which start with ?autostart.)
  if (!new URLSearchParams(location.search).has('autostart')) game.menu.maybeAskSteering();
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
  if (mapFromSearch(location.search, storedMap()) !== 'miami') return null;
  try {
    const [{ createMiamiCity }, { default: data }] = await Promise.all([import('./world/miami.js'), import('./world/data/miami.json')]);
    return createMiamiCity(data);
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
  title.setReady(true);
  title.setCanContinue(game.session.canContinue());
  title.onStart(async () => {
    game.audio.unlock();
    // Best effort: go full screen and lock sideways. Not every browser allows it.
    try {
      await document.documentElement.requestFullscreen?.({ navigationUI: 'hide' });
      await screen.orientation?.lock?.('landscape');
    } catch {
      /* fine without */
    }
    game.session.startFresh();
    start(game);
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
