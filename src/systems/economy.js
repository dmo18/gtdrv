// Saving and the small bits of bookkeeping that go with it (distance
// travelled, first-visit flags). There is no money, shop or purchase any
// more: everything is available from the start and the only progression
// is score (src/systems/score.js).
import { loadProgress, saveProgress, defaultProgress } from '../core/save.js';
import { setHandlingMode } from '../entities/vehicle.js';
import { RULES } from '../core/weapons.js';
import { DISTRICTS } from '../world/citygen.js';

const SAVE_EVERY = 20; // seconds, at most, when something changed
const MAX_STEP = 120; // a bigger jump in one step is a teleport, not travel

const isPlain = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

// Make `dst` hold what `src` holds without replacing `dst` or its nested
// objects (other systems keep references to them). Keys that `src` lacks
// are removed, which also clears the old money and owned fields.
function assignInPlace(dst, src) {
  for (const key of Object.keys(dst)) if (!Object.hasOwn(src, key)) delete dst[key];
  for (const key of Object.keys(src)) {
    if (isPlain(src[key]) && isPlain(dst[key])) assignInPlace(dst[key], src[key]);
    else dst[key] = src[key];
  }
}

export function createEconomy(game, storage) {
  const events = game.events;
  const progress = game.progress;
  const districtKeys = { 'The Strand': 'shore' };
  for (const k of Object.keys(DISTRICTS)) districtKeys[DISTRICTS[k].name] = k;

  let dirty = false;
  let sinceSave = 0;
  let lastX = NaN, lastZ = NaN;

  function applySettings() {
    const s = progress.settings;
    if (game.audio && game.audio.setVolume) game.audio.setVolume({ master: s.master, musicOn: s.music !== false, music: Number.isFinite(s.musicVol) ? s.musicVol : 0.5 });
    if (game.input) game.input.invertPitch = s.invertPitch;
    setHandlingMode(s.handling);
    // Hard mode: the player can be hurt and killed (the death flow is combat.js).
    RULES.invulnerable = s.mortal !== true;
    if (game.touch && game.touch.setLeftHanded) game.touch.setLeftHanded(s.leftHanded);
    if (game.touch && game.touch.setSteering) {
      const used = game.touch.setSteering(s.steering, s.steerSensitivity, steerFallback);
      if (used && used !== s.steering) steerFallback(used);
    }
    if (game.touch && game.touch.setHudMode) game.touch.setHudMode(s.hud);
    if (game.hud && game.hud.setHudMode) game.hud.setHudMode(s.hud);
    if (game.combatHud && game.combatHud.setHudMode) game.combatHud.setHudMode(s.hud);
    if (game.quality !== s.quality) {
      game.quality = s.quality;
      if (game.resize) game.resize();
    }
  }

  // Tilt asked for but the phone cannot do it: remember the wheel instead.
  function steerFallback(style) {
    const s = progress.settings;
    if (s.steering !== 'tilt' || style === 'tilt') return;
    s.steering = style || 'wheel';
    if (game.hud && game.hud.toast) game.hud.toast('Tilt steering is not available here, using the wheel', 3);
    save();
    events.emit('progress');
  }

  function save() {
    dirty = false;
    sinceSave = 0;
    return saveProgress(storage, progress);
  }

  assignInPlace(progress, loadProgress(storage));
  applySettings();

  events.on('progress', save);
  events.on('district', (name) => {
    const key = districtKeys[name];
    if (!key) return;
    const flag = 'seen_' + key;
    if (progress.medals[flag]) return;
    progress.medals[flag] = 'bronze';
    if (game.hud && game.hud.toast) game.hud.toast('New area: ' + name, 2.5);
    dirty = true;
  });
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', () => { if (document.hidden) save(); });
    window.addEventListener('pagehide', save);
  }

  return {
    name: 'economy',
    fixedUpdate(dt) {
      const p = game.player;
      if (Number.isFinite(lastX)) {
        const d = Math.hypot(p.x - lastX, p.z - lastZ);
        if (d > 0 && d < MAX_STEP) {
          progress.stats.distance += d;
          dirty = true;
        }
      }
      lastX = p.x;
      lastZ = p.z;
      if (dirty && (sinceSave += dt) >= SAVE_EVERY) save();
    },
    save, applySettings,
    reset() {
      assignInPlace(progress, defaultProgress());
      applySettings();
      save();
      events.emit('progressReset');
      events.emit('progress');
    },
  };
}
