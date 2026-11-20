import { createGame } from './game.js';
import { registerServiceWorker } from './pwa.js';

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

try {
  const game = createGame({
    canvas: document.getElementById('game'),
    uiRoot: document.getElementById('ui'),
  });
  window.__rw = game;
  game.draw(1, 0);
  msg.textContent = 'An island of rust, salt and bad ideas.';
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
} catch (err) {
  console.error(err);
  msg.textContent = 'Sorry, the game could not start on this device.';
}

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
