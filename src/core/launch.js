// Small pure helpers for launch and rotation (0.14.0). No DOM, no clock:
// main.js, game.js and the index.html shell feed them plain values.

export const STARTUP_TIMEOUT_MS = 25000; // no progress for this long: show the failed state

// Runs `done` exactly once: when `step` settles (either way), when it is
// absent or throws, or after `waitMs` if it never settles. `later` is the
// timer (setTimeout in the browser, a fake in tests).
export function continueAfter(step, done, later, waitMs = 1500) {
  let fired = false;
  const go = () => {
    if (fired) return;
    fired = true;
    done();
  };
  let p;
  try {
    p = step ? step() : null;
  } catch {
    p = null;
  }
  if (!p || typeof p.then !== 'function') {
    go();
    return;
  }
  later(go, waitMs);
  p.then(go, go);
}

// Which plain guidance fits a launch error: 'graphics' (WebGL, the renderer),
// 'download' (a script or chunk that did not load), else 'other'.
export function failureKind(err) {
  const text = (String((err && err.name) || '') + ' ' + String((err && err.message) || err || '')).toLowerCase();
  if (/webgl|context|gpu|renderer|shader/.test(text)) return 'graphics';
  if (/fetch|import|network|load|chunk|script|module|failed to/.test(text)) return 'download';
  return 'other';
}

export function failureMessage(kind) {
  if (kind === 'graphics') return 'Graphics failed to start. Try closing other tabs or apps, or open the game in another browser.';
  if (kind === 'download') return 'The game did not finish downloading. Check your connection and try again.';
  return 'The game could not start on this device. Try again, or use another browser.';
}

// The portrait cover hides the game: the simulation pauses and held controls
// are cleared. Only a pause this gate made is undone on return.
export function createRotationGate() {
  let owned = false;
  return {
    get owned() { return owned; },
    // portrait: the cover is showing. game: { paused }. Returns 'paused', 'resumed' or ''.
    update(portrait, game, emit, clearInput) {
      if (portrait) {
        clearInput();
        if (!owned && !game.paused) {
          game.paused = true;
          owned = true;
          emit(true);
          return 'paused';
        }
        return '';
      }
      if (owned) {
        owned = false;
        if (game.paused) {
          game.paused = false;
          emit(false);
          return 'resumed';
        }
      }
      return '';
    },
  };
}
