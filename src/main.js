import { createGame } from './game.js';

const boot = document.getElementById('boot');
const msg = document.getElementById('bootmsg');
const play = document.getElementById('play');

function start(game) {
  boot.style.display = 'none';
  game.resize();
  game.loop.start();
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
