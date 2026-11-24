// Looks in the game (docs/LOOP.md section f): the player's saved look for a
// vehicle class goes on whatever car of that class they get into. Free, no
// currency. The rules are core/custom.js; the materials render/vehiclemats.js
// (only touched when a mesh exists, so the logic runs in node tests).
import { defaultLook, sanitizeLook, isDefaultLook, unlocked, LOOK_KEYS, LOOK_SIZE, MAX_LOOKS } from '../core/custom.js';
import { loopOf, medalCounts } from '../core/records.js';
import { kindOfSpec } from '../core/garage.js';
import { applyLook, keepLook } from '../render/vehiclemats.js';

export function createCustom(game) {
  const looks = () => loopOf(game.progress).looks;
  const lookFor = (specId) => (Object.hasOwn(looks(), specId) ? sanitizeLook(looks()[specId]) : defaultLook());
  function apply(v) {
    if (!v || v.kind !== 'car' || !v.mesh || !v.spec) return false;
    const look = lookFor(v.spec.id);
    if (isDefaultLook(look) && !v.mesh.userData.look) return false;
    applyLook(v.mesh, look, v.color == null ? v.spec.colors[0] : v.color);
    v.meshDirty = true;
    return true;
  }
  // Is option `i` of `key` open to the player now?
  function open(key, i) {
    const c = medalCounts(loopOf(game.progress));
    return unlocked(key, i, c.any, c.gold);
  }
  // Set one part of the look of a class. Returns false for a locked or bad option.
  function set(specId, key, i) {
    if (kindOfSpec(specId) !== 'car' || !LOOK_KEYS.includes(key) || !Number.isInteger(i) || i < (key === 'paint' ? -1 : 0) || i >= LOOK_SIZE[key] || !open(key, i)) return false;
    const all = looks();
    const look = lookFor(specId);
    look[key] = i;
    if (isDefaultLook(look)) delete all[specId];
    else if (Object.hasOwn(all, specId) || Object.keys(all).length < MAX_LOOKS) all[specId] = look;
    else return false;
    const v = game.player && game.player.vehicle;
    if (v && v.spec && v.spec.id === specId) apply(v);
    if (game.events) game.events.emit('progress');
    return true;
  }
  if (game.events) {
    game.events.on('enter', (v) => apply(v));
    game.events.on('progressReset', () => { const v = game.player && game.player.vehicle; if (v) apply(v); });
  }
  return {
    name: 'custom',
    lookFor,
    set,
    open,
    apply,
    reset(specId) { if (kindOfSpec(specId) !== 'car') return; delete looks()[specId]; const v = game.player.vehicle; if (v && v.spec.id === specId) apply(v); if (game.events) game.events.emit('progress'); },
    // Damage swaps the wheel and glass materials back: put the look's on again (one check a frame, the player's car only).
    render() {
      const v = game.player && game.player.vehicle;
      if (v && v.mesh && v.mesh.userData.look) keepLook(v.mesh);
    },
  };
}
