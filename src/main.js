import { createGame } from './game.js';
import { registerServiceWorker } from './pwa.js';
import { mapFromSearch, MAP_CHOICE_KEY } from './world/maps.js';

const boot = document.getElementById('boot');
const msg = document.getElementById('bootmsg');
const play = document.getElementById('play');

function start(game) {
  boot.style.display = 'none';
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
  play.disabled = false;
  play.addEventListener('click', async () => {
    game.audio.unlock();
    // Best effort: go full screen and lock sideways. Not every browser allows it.
    try {
      await document.documentElement.requestFullscreen?.({ navigationUI: 'hide' });
      await screen.orientation?.lock?.('landscape');
    } catch {
      /* fine without */
    }
    start(game);
  });
  if (new URLSearchParams(location.search).has('autostart')) start(game);
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
  if (boot.style.display !== 'none') apply();
});

// Called by the Android wrapper when the system Back button is pressed.
// Returns 'paused' when it paused a running game, or 'leave' when the app
// should go to the background (title screen, or game already paused).
window.__rwBack = () => {
  const game = window.__rw;
  if (!game || boot.style.display !== 'none') return 'leave';
  if (!game.paused) {
    game.paused = true;
    game.events.emit('pause', true);
    return 'paused';
  }
  return 'leave';
};
