// Weapons table and per-actor weapon state ("arms"). Pure logic: no
// three.js, no DOM. Names are invented for Rustwater. Every weapon is
// carried at once and reserves are unlimited: magazines only set the
// rhythm (fire, run dry, reload). See docs/COMBAT.md.
const DEG = Math.PI / 180;

// type: 'melee' | 'hitscan' | 'rocket' | 'thrown' | 'sticky'
// spread: half-angle in radians (melee: half of the hit arc)
// rate: uses per second; mag 0 = no magazine; reload in seconds
// blastScale: blast damage multiplier (docs/ARMS.md; missing = 1)
// rangeMin..range: thrown reach span, picked by the aim pitch
export const WEAPONS = {
  wrench: {
    id: 'wrench', name: 'Pipe Wrench', type: 'melee', dmg: 34, rate: 1.6,
    spread: 30 * DEG, range: 1.8, mag: 0, reload: 0, pellets: 1, driveBy: false,
    knockHits: 2, // knock-down on the 2nd hit
  },
  pistol: {
    id: 'pistol', name: 'Pocket Rattler', type: 'hitscan', dmg: 25, rate: 4,
    spread: 1.5 * DEG, range: 45, mag: 12, reload: 1.1, pellets: 1, driveBy: true,
  },
  smg: {
    id: 'smg', name: 'Buzzbox', type: 'hitscan', dmg: 12, rate: 12,
    spread: 4 * DEG, range: 35, mag: 30, reload: 1.6, pellets: 1, driveBy: true,
  },
  scatter: {
    id: 'scatter', name: 'Barnyard Thumper', type: 'hitscan', dmg: 9, rate: 1.2,
    spread: 9 * DEG, range: 18, mag: 6, reload: 2.2, pellets: 8, driveBy: false,
    push: 1.2, // knock-back m/s per pellet that lands
  },
  lobber: {
    id: 'lobber', name: 'Gull Lobber', type: 'rocket', dmg: 100, rate: 0.6,
    spread: 0, range: 150, mag: 1, reload: 2.0, pellets: 1, driveBy: false,
    speed: 40, blast: 6,
  },
  fizz: {
    id: 'fizz', name: 'Fizzpop Can', type: 'thrown', dmg: 0, rate: 1,
    spread: 0, range: 25, mag: 1, reload: 0.8, pellets: 1, driveBy: false,
    fuse: 2.2, blast: 5, bounce: 0.35, blastScale: 1, rangeMin: 6,
  },
  sticky: {
    id: 'sticky', name: 'Barnacle Charge', type: 'sticky', dmg: 0, rate: 1.5,
    spread: 0, range: 18, mag: 1, reload: 0.6, pellets: 1, driveBy: false,
    blast: 6, blastScale: 1.4, bounce: 0.35, rangeMin: 6,
  },
};

export const WEAPON_IDS = ['wrench', 'pistol', 'smg', 'scatter', 'lobber', 'fizz', 'sticky'];
export const isThrown = (w) => !!w && (w.type === 'thrown' || w.type === 'sticky');

// ---------------------------------------------------------------------
// Craft weapons (mounts). Not in the on-foot cycle. A spec lists them
// as `spec.mounts` (ids below; 'drop' is accepted for 'bomb'). Slot 0
// and 1 are the non-bomb mounts in list order; slot 'drop' is the bomb
// mount. docs/ARMS.md section 2.
// type: 'shell' (rocket with drop) | 'hitscan' | 'missile' | 'bomb'
// ---------------------------------------------------------------------
export const MOUNTS = {
  cannon: {
    id: 'cannon', name: 'Thudder', type: 'shell', dmg: 220, rate: 0.4, spread: 0.3 * DEG,
    range: 300, mag: 1, reload: 2.5, speed: 90, aiSpeed: 45, drop: 0.3, blast: 6, blastScale: 1.3,
  },
  coax: {
    id: 'coax', name: 'Rattlecoax', type: 'hitscan', dmg: 14, rate: 10, spread: 2.5 * DEG,
    range: 60, mag: 50, reload: 2.0,
  },
  nosegun: {
    id: 'nosegun', name: 'Hailbox', type: 'hitscan', dmg: 18, rate: 15, spread: 1.5 * DEG,
    range: 220, mag: 120, reload: 2.0, bend: 6 * DEG,
  },
  chingun: {
    id: 'chingun', name: 'Chatter Pod', type: 'hitscan', dmg: 10, rate: 8, spread: 3 * DEG,
    range: 120, mag: 60, reload: 2.0, bend: 40 * DEG,
  },
  missile: {
    id: 'missile', name: 'Gullseeker', type: 'missile', dmg: 260, rate: 1, spread: 0,
    range: 600, mag: 2, reload: 3.0, speed: 95, turn: 2.4, life: 6, blast: 7, blastScale: 1.3,
  },
  bomb: {
    id: 'bomb', name: 'Pelican Drop', type: 'bomb', dmg: 0, rate: 3, spread: 0,
    range: 0, mag: 6, magHeli: 4, reload: 5.0, blast: 11, blastScale: 1.6,
  },
};
export const MOUNT_IDS = Object.keys(MOUNTS);
const mountId = (id) => (id === 'drop' ? 'bomb' : id);

// Per-craft mount state: { ids, slots: [slot0, slot1], drop, mag, cool,
// reloadT, reloading } with one entry per mount id. Unlimited reserves,
// auto-reload when a magazine runs dry. Null when the spec has no mounts.
export function createCraftArms(spec) {
  const list = spec && Array.isArray(spec.mounts) ? spec.mounts : null;
  if (!list || !list.length) return null;
  const arms = { ids: [], slots: [null, null], drop: null, mag: {}, max: {}, cool: {}, reloadT: {}, reloading: {} };
  for (let i = 0; i < list.length; i++) {
    const id = mountId(list[i]);
    const m = MOUNTS[id];
    if (!m || arms.ids.indexOf(id) >= 0) continue;
    arms.ids.push(id);
    const max = m.type === 'bomb' ? ((spec.bombs | 0) || (spec.kind === 'heli' ? m.magHeli : m.mag)) : m.mag;
    arms.max[id] = max;
    arms.mag[id] = max;
    arms.cool[id] = 0;
    arms.reloadT[id] = 0;
    arms.reloading[id] = false;
    if (m.type === 'bomb') arms.drop = arms.drop || id;
    else if (!arms.slots[0]) arms.slots[0] = id;
    else if (!arms.slots[1]) arms.slots[1] = id;
  }
  return arms.ids.length ? arms : null;
}

// Mount id for slot 0, 1 or 'drop' (null when the craft has none).
export function mountFor(arms, slot) {
  if (!arms) return null;
  if (slot === 'drop') return arms.drop;
  return arms.slots[slot === 1 ? 1 : 0] || null;
}

export function stepCraftArms(arms, dt) {
  if (!arms) return;
  const ids = arms.ids;
  for (let i = 0; i < ids.length; i++) {
    const id = ids[i];
    if (arms.cool[id] > 0) arms.cool[id] = Math.max(0, arms.cool[id] - dt);
    if (arms.reloading[id]) {
      arms.reloadT[id] -= dt;
      if (arms.reloadT[id] <= 0) {
        arms.reloadT[id] = 0;
        arms.reloading[id] = false;
        arms.mag[id] = arms.max[id];
      }
    } else if (!(arms.mag[id] > 0)) {
      arms.reloading[id] = true;
      arms.reloadT[id] = MOUNTS[id].reload;
    }
  }
}

// Ready to fire this mount now (no ammo used)?
export function mountReady(arms, id) {
  return !!arms && !!MOUNTS[id] && arms.max[id] !== undefined && !(arms.cool[id] > 0)
    && !arms.reloading[id] && arms.mag[id] > 0;
}

// Use one round. Returns USE_NO, USE_OK or USE_LAST (reload started).
export function tryMount(arms, id) {
  if (!mountReady(arms, id)) return USE_NO;
  arms.cool[id] = 1 / MOUNTS[id].rate;
  arms.mag[id]--;
  if (arms.mag[id] <= 0) {
    arms.mag[id] = 0;
    arms.reloading[id] = true;
    arms.reloadT[id] = MOUNTS[id].reload;
    return USE_LAST;
  }
  return USE_OK;
}

// Reload progress 0..1 (0 = not reloading).
export function mountReload(arms, id) {
  if (!arms || !arms.reloading[id]) return 0;
  const r = MOUNTS[id].reload;
  return r > 0 ? Math.max(0.01, 1 - arms.reloadT[id] / r) : 0;
}

// Results of tryUse.
export const USE_NO = 0; // not ready (cooling down or reloading)
export const USE_OK = 1; // used
export const USE_LAST = 2; // used the last round; a reload has started

export function createArms(start = 'pistol') {
  const mag = {};
  for (let i = 0; i < WEAPON_IDS.length; i++) mag[WEAPON_IDS[i]] = WEAPONS[WEAPON_IDS[i]].mag;
  return {
    weapon: WEAPONS[start] ? start : 'pistol',
    lastGun: start === 'smg' ? 'smg' : 'pistol', // drive-by uses the last of these two
    mag,
    cool: 0, // seconds until the next use
    reloadT: 0, // seconds of reload left
    reloading: null, // weapon id being reloaded
  };
}

export function selectWeapon(arms, id) {
  if (!WEAPONS[id] || arms.weapon === id) return false;
  arms.weapon = id;
  arms.reloadT = 0;
  arms.reloading = null;
  if (id === 'pistol' || id === 'smg') arms.lastGun = id;
  return true;
}

export function nextWeapon(arms) {
  const i = WEAPON_IDS.indexOf(arms.weapon);
  selectWeapon(arms, WEAPON_IDS[(i + 1) % WEAPON_IDS.length]);
  return arms.weapon;
}

export function startReload(arms, id = arms.weapon) {
  const w = WEAPONS[id];
  if (!w || !(w.mag > 0) || arms.mag[id] >= w.mag || arms.reloading === id) return false;
  arms.reloading = id;
  arms.reloadT = w.reload;
  return true;
}

// Advance timers. Returns the id of a weapon whose reload just finished,
// else null.
export function stepArms(arms, dt) {
  if (arms.cool > 0) arms.cool = Math.max(0, arms.cool - dt);
  if (arms.reloading) {
    arms.reloadT -= dt;
    if (arms.reloadT <= 0) {
      const id = arms.reloading;
      arms.mag[id] = WEAPONS[id].mag;
      arms.reloading = null;
      arms.reloadT = 0;
      return id;
    }
  }
  return null;
}

// Pull the trigger once. id defaults to the held weapon (drive-by passes
// the last gun instead).
export function tryUse(arms, id = arms.weapon) {
  const w = WEAPONS[id];
  if (!w || arms.cool > 0 || arms.reloading === id) return USE_NO;
  if (w.mag > 0 && !(arms.mag[id] > 0)) {
    startReload(arms, id);
    return USE_NO;
  }
  arms.cool = 1 / w.rate;
  if (id === 'pistol' || id === 'smg') arms.lastGun = id;
  if (w.mag > 0) {
    arms.mag[id]--;
    if (arms.mag[id] <= 0) {
      arms.mag[id] = 0;
      startReload(arms, id);
      return USE_LAST;
    }
  }
  return USE_OK;
}
