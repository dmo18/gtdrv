// Puts boats at the piers and aircraft at the airfield, and quietly
// puts a fresh one back when its spot has been empty for a while and
// the player is far away, so there is always something to ride.
import { createBoat } from '../entities/boat.js';
import { createAircraft } from '../entities/aircraft.js';
import { createTank } from '../entities/tank.js';

const RESPAWN_DIST = 260;
// The special craft. Nothing is bought any more: they sit at their
// berths from the start like every other craft.
export const PREMIUM = ['jet', 'stunt', 'heavyheli', 'yacht'];

export function createFleet(game) {
  const spots = [];
  for (const s of game.city.boatSpots) spots.push({ ...s, make: createBoat, craft: null });
  for (const s of game.city.aircraftSpots) spots.push({ ...s, make: createAircraft, craft: null });
  // Tanks wait at the depot and in Cinder Row (docs/ARMS.md section 3).
  for (const s of game.city.tankSpots || []) spots.push({ ...s, make: createTank, craft: null });
  let timer = 0;

  function fill(s) {
    const c = s.make(s.spec, s.x, s.z, s.heading, game.rng);
    if (!game.kinds[c.kind]) return;
    c.home = s;
    s.craft = c;
    game.addVehicle(c);
  }
  for (const s of spots) fill(s);

  return {
    name: 'fleet',
    spots,
    fixedUpdate(dt) {
      timer -= dt;
      if (timer > 0) return;
      timer = 2;
      const p = game.player;
      for (const s of spots) {
        const c = s.craft;
        const away = !c || c.removed || Math.hypot(c.x - s.x, c.z - s.z) > 25 || c.wrecked;
        if (!away) continue;
        if (c && c === p.vehicle) continue;
        if (Math.hypot(p.x - s.x, p.z - s.z) < RESPAWN_DIST) continue;
        // Clear away a wreck or abandoned craft that is also far from the player.
        if (c && !c.removed && Math.hypot(p.x - c.x, p.z - c.z) > RESPAWN_DIST) game.removeVehicle(c);
        if (!c || c.removed) fill(s);
        else s.craft = null;
      }
    },
  };
}
