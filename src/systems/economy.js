// Money, purchases, saving and the small bits of bookkeeping that go
// with them (distance travelled, first-visit bonuses).
import { loadProgress, saveProgress, defaultProgress } from '../core/save.js';
import { DISTRICTS } from '../world/citygen.js';

// Premium craft: they only appear at their berths once bought.
export const CATALOG = {
  stunt: { price: 1500, label: 'Barrowlark', where: 'Waiting at Gullwing Airfield' },
  heavyheli: { price: 4500, label: 'Oxbarrow', where: 'Waiting at Gullwing Airfield' },
  yacht: { price: 6500, label: 'Marlowen', where: 'Moored at Saltyard Marina' },
  jet: { price: 9000, label: 'Velloria', where: 'Waiting at Gullwing Airfield' },
};
const IDS = Object.keys(CATALOG);
const SAVE_EVERY = 20; // seconds, at most, when something changed
const EXPLORE_BONUS = 40;
const MAX_STEP = 120; // a bigger jump in one step is a teleport, not travel

// Copy `src` into `dst` without replacing `dst` or its nested objects.
function assignInPlace(dst, src) {
  dst.money = src.money;
  dst.owned.length = 0;
  dst.owned.push(...src.owned);
  for (const k of ['medals', 'bestTimes']) {
    for (const key of Object.keys(dst[k])) delete dst[k][key];
    Object.assign(dst[k], src[k]);
  }
  Object.assign(dst.stats, src.stats);
  Object.assign(dst.settings, src.settings);
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
    if (game.audio && game.audio.setVolume) game.audio.setVolume({ master: s.master });
    if (game.input) game.input.invertPitch = s.invertPitch;
    if (game.touch && game.touch.setLeftHanded) game.touch.setLeftHanded(s.leftHanded);
    if (game.quality !== s.quality) {
      game.quality = s.quality;
      if (game.resize) game.resize();
    }
  }

  function save() {
    dirty = false;
    sinceSave = 0;
    return saveProgress(storage, progress);
  }

  assignInPlace(progress, loadProgress(storage, IDS));
  applySettings();

  const price = (id) => (CATALOG[id] ? CATALOG[id].price : Infinity);
  const owns = (id) => progress.owned.includes(id);
  const canAfford = (id) => !!CATALOG[id] && progress.money >= CATALOG[id].price;

  function buy(id) {
    if (!CATALOG[id] || owns(id) || !canAfford(id)) return false;
    progress.money -= CATALOG[id].price;
    progress.owned.push(id);
    save();
    events.emit('purchase', id);
    events.emit('reward', -CATALOG[id].price, 'Bought ' + CATALOG[id].label);
    return true;
  }

  events.on('progress', save);
  events.on('purchase', save);
  events.on('district', (name) => {
    const key = districtKeys[name];
    if (!key) return;
    const flag = 'seen_' + key;
    if (progress.medals[flag]) return;
    progress.medals[flag] = 'bronze';
    progress.money = Math.min(99999999, progress.money + EXPLORE_BONUS);
    if (game.hud && game.hud.toast) game.hud.toast('New area: ' + name + '  +$' + EXPLORE_BONUS, 2.5);
    events.emit('reward', EXPLORE_BONUS, 'Explored ' + name);
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
    buy, price, canAfford, owns, save, applySettings,
    reset() {
      assignInPlace(progress, defaultProgress());
      applySettings();
      save();
      events.emit('progress');
    },
  };
}
