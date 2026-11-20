// The car radio: which station is chosen, the RADIO button and the pause
// menu setting both go through here, and the small caption strip for the
// talk station (docs/AUDIO.md, "Radio"). The audio side (generation and
// playback) is audio/radioplayer.js. The talk station has no speech: the
// captions are the words, shown while a stylised vowel-blip texture plays.
// Logic here runs in node tests when `document` is missing.
import { STATIONS, sanitizeStation, nextStation, stationInfo, canListen } from '../core/radio.js';

const CSS = `
.rw-radiocap {
  position: absolute; left: calc(var(--rw-sl, 0px) + 10px); top: calc(var(--rw-st, 0px) + 8px); z-index: 22;
  max-width: min(46vw, 380px); box-sizing: border-box; padding: 4px 9px 5px; border-radius: 6px;
  background: rgba(20, 14, 11, 0.78); border-left: 3px solid var(--rw-accent, #e2733a);
  color: #fff; font: 600 12px/1.25 system-ui, sans-serif; text-shadow: 0 1px 2px rgba(0, 0, 0, 0.8);
  pointer-events: none; opacity: 0; transition: opacity 0.18s ease;
}
.rw-radiocap.rw-on { opacity: 1; }
.rw-radiocap b { display: block; font-size: 9px; letter-spacing: 0.08em; text-transform: uppercase; color: var(--rw-accent, #e2733a); }
@media (prefers-reduced-motion: reduce) { .rw-radiocap { transition: none; } }
`;

export function createRadio(game, root) {
  const settings = () => (game.progress && game.progress.settings) || {};
  let station = sanitizeStation(settings().station);
  let capLeft = 0; // seconds the shown caption still has
  let strip = null;
  let textEl = null;
  let nameEl = null;
  let placeFn = null;

  if (typeof document !== 'undefined' && root) {
    if (!document.getElementById('rw-radio-css')) {
      const st = document.createElement('style');
      st.id = 'rw-radio-css';
      st.textContent = CSS;
      document.head.appendChild(st);
    }
    // under the minimap column: in landscape there is no room above it
    const tl = root.querySelector ? root.querySelector('.rw-tl') : null;
    strip = document.createElement('div');
    strip.className = 'rw-radiocap';
    strip.setAttribute('role', 'status');
    strip.setAttribute('aria-live', 'polite');
    nameEl = document.createElement('b');
    textEl = document.createElement('span');
    strip.append(nameEl, textEl);
    (tl ? tl.parentNode : root).appendChild(strip);
    if (tl) {
      // sit just below the minimap block
      placeFn = () => { strip.style.top = `calc(var(--rw-st, 0px) + 8px + ${Math.round(tl.offsetHeight) + 6}px)`; };
    }
  }

  function show(text, dur) {
    if (!strip) return;
    if (!text) {
      capLeft = 0;
      strip.classList.remove('rw-on');
      return;
    }
    if (placeFn) placeFn();
    nameEl.textContent = stationInfo(station).name;
    textEl.textContent = text;
    capLeft = Math.max(1.5, Number.isFinite(dur) ? dur : 4);
    strip.classList.add('rw-on');
  }

  function push() {
    if (game.audio && game.audio.setStation) game.audio.setStation(station);
    show(null);
  }

  function toastFor(id) {
    const s = settings();
    const info = stationInfo(id);
    let text = id === 'off' ? 'Radio off' : `Radio: ${info.name} (${info.tag})`;
    if (id !== 'off' && s.music === false) text += '. Music is off in settings.';
    if (game.hud && game.hud.toast) game.hud.toast(text, 2);
    return text;
  }

  const sys = {
    name: 'radio',
    get station() {
      return station;
    },
    stations: STATIONS,
    // Choose a station; saved with the settings. announce: show a toast.
    setStation(id, announce = false) {
      const next = sanitizeStation(id);
      const changed = next !== station;
      station = next;
      const s = settings();
      if (s && s.station !== next) {
        s.station = next;
        if (game.events && game.events.emit) game.events.emit('progress');
      }
      if (changed) push();
      if (announce) toastFor(next);
      return next;
    },
    // The RADIO button: the next station, wrapping to off.
    cycle() {
      const m = game.player ? game.player.mode : 'foot';
      if (!canListen(m)) return station;
      return sys.setStation(nextStation(station, 1), true);
    },
    // Re-read the saved setting (after a reset or a loaded save).
    sync() {
      const id = sanitizeStation(settings().station);
      if (id !== station) {
        station = id;
        push();
      }
    },
    // fixed step: counts the caption down (never the wall clock)
    update(dt) {
      if (capLeft > 0) {
        capLeft -= dt;
        if (capLeft <= 0) show(null);
      }
    },
    dispose() {
      if (strip && strip.parentNode) strip.parentNode.removeChild(strip);
      if (game.audio && game.audio.onCaption === onCaption) game.audio.onCaption = null;
    },
  };
  function onCaption(text, dur) {
    show(text, dur);
  }
  if (game.audio) {
    game.audio.onCaption = onCaption;
    if (station !== 'off' && game.audio.setStation) game.audio.setStation(station);
  }
  return sys;
}
