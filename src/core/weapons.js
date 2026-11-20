// Weapons table and per-actor weapon state ("arms"). Pure logic: no
// three.js, no DOM. Names are invented for Rustwater. Every weapon is
// carried at once and reserves are unlimited: magazines only set the
// rhythm (fire, run dry, reload). See docs/COMBAT.md.
const DEG = Math.PI / 180;

// type: 'melee' | 'hitscan' | 'rocket' | 'thrown'
// spread: half-angle in radians (melee: half of the hit arc)
// rate: uses per second; mag 0 = no magazine; reload in seconds
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
    fuse: 2.2, blast: 5, bounce: 0.35,
  },
};

export const WEAPON_IDS = ['wrench', 'pistol', 'smg', 'scatter', 'lobber', 'fizz'];

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
