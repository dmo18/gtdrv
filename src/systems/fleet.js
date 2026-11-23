// Puts boats at the piers and aircraft at the airfield, and quietly
// puts a fresh one back when its spot has been empty for a while and
// the player is far away, so there is always something to ride.
//
// Nothing is built at the start (docs/PLAN_V2.md 5.3 H1): the craft are
// made in play, nearest berth first, one in a step through the shared spawn
// gate (core/spatial.js): the berths near the player at once, the far ones
// a few steps apart, so every craft is waiting within a few seconds and no
// step builds a burst of meshes.
import { createBoat } from '../entities/boat.js';
import { createAircraft } from '../entities/aircraft.js';
import { createTank } from '../entities/tank.js';
import { beginSpawnStep, takeSpawn, belowLiveCap, SPAWNER } from '../core/spatial.js';

const RESPAWN_DIST = 260;
// Berths within this of the player are filled one a step; farther ones one
// every FAR_EVERY steps (nearest first).
export const FLEET_NEAR = 1200;
const FAR_EVERY = 6;
const ADOPT_R = 40; // m: as session.js NEAR_FLEET
// The special craft. Nothing is bought any more: they sit at their
// berths from the start like every other craft.
export const PREMIUM = ['jet', 'stunt', 'heavyheli', 'yacht'];

export function createFleet(game) {
  const spots = [];
  for (const s of game.city.boatSpots) spots.push({ ...s, make: createBoat, craft: null, made: false });
  for (const s of game.city.aircraftSpots) spots.push({ ...s, make: createAircraft, craft: null, made: false });
  // Tanks wait at the depot and in Cinder Row (docs/ARMS.md section 3).
  for (const s of game.city.tankSpots || []) spots.push({ ...s, make: createTank, craft: null, made: false });
  let timer = 0;
  let order = null; // spot indices, nearest the player first (set on the first step)
  let next = 0, wait = 0;

  function fill(s) {
    s.made = true;
    const c = s.make(s.spec, s.x, s.z, s.heading, game.rng);
    if (!game.kinds[c.kind]) return;
    c.home = s;
    s.craft = c;
    game.addVehicle(c);
  }

  // The first fill, by distance from the player. Returns true when done.
  function stepFirstFill() {
    const p = game.player;
    if (!order) {
      const px = p ? p.x : 0, pz = p ? p.z : 0;
      const d = spots.map((s) => Math.hypot(s.x - px, s.z - pz));
      order = spots.map((s, i) => i).sort((a, b) => d[a] - d[b] || a - b);
    }
    while (next < order.length && spots[order[next]].made) next++;
    if (next >= order.length) return true;
    const s = spots[order[next]];
    const far = !p || Math.hypot(s.x - p.x, s.z - p.z) > FLEET_NEAR;
    if (far && wait > 0) {
      wait--;
      return false;
    }
    // A craft of this spec already by the berth (a restored save made it
    // before the berth was filled) becomes the berth's own: never two.
    const vs = game.vehicles || [];
    let own = null;
    for (let i = 0; i < vs.length && !own; i++) {
      const v = vs[i];
      if (!v.removed && !v.home && v.spec && v.spec.id === s.spec && Math.hypot(v.x - s.x, v.z - s.z) < ADOPT_R) own = v;
    }
    if (own) {
      own.home = s;
      s.craft = own;
      s.made = true;
      next++;
      return next >= order.length;
    }
    // Under the live cap (the parked cars make room within a scan).
    if (!belowLiveCap(game) || !takeSpawn(game)) return false;
    fill(s);
    next++;
    wait = far ? FAR_EVERY - 1 : 0;
    return next >= order.length;
  }

  let filled = false;
  const sys = {
    name: 'fleet',
    spots,
    get ready() {
      return filled;
    },
    // Every berth filled now (tests and tools; skips the spawn gate).
    fillAll() {
      for (const s of spots) if (!s.made) fill(s);
      filled = true;
    },
    fixedUpdate(dt) {
      beginSpawnStep(game, SPAWNER.fleet);
      if (!filled) filled = stepFirstFill();
      timer -= dt;
      if (timer > 0) return;
      timer = 2;
      const p = game.player;
      for (const s of spots) {
        if (!s.made) continue;
        const c = s.craft;
        const away = !c || c.removed || Math.hypot(c.x - s.x, c.z - s.z) > 25 || c.wrecked;
        if (!away) continue;
        if (c && c === p.vehicle) continue;
        if (Math.hypot(p.x - s.x, p.z - s.z) < RESPAWN_DIST) continue;
        // Clear away a wreck or abandoned craft that is also far from the player.
        if (c && !c.removed && Math.hypot(p.x - c.x, p.z - c.z) > RESPAWN_DIST) game.removeVehicle(c);
        if (!c || c.removed) {
          if (takeSpawn(game)) fill(s);
          else timer = 0; // gate full this step: try again next step
        } else s.craft = null;
      }
    },
  };
  return sys;
}
