// Keeps parked cars around the player: cars appear in parking spots a
// little way off and are removed again once far behind, so the city
// feels full without simulating a thousand vehicles.
import { createVehicle } from '../entities/vehicle.js';

const SPAWN_R = 170;
const DESPAWN_R = 230;
const MIN_R = 60; // never pop in right next to the player

const MIX = {
  downtown: ['sedan', 'sedan', 'taxi', 'sports', 'compact', 'van'],
  midtown: ['sedan', 'compact', 'compact', 'pickup', 'van', 'muscle'],
  residential: ['compact', 'sedan', 'pickup', 'sedan', 'muscle'],
  docks: ['pickup', 'van', 'truck', 'sedan'],
  industrial: ['pickup', 'van', 'truck', 'compact'],
  beach: ['sports', 'compact', 'muscle', 'sedan', 'sports'],
  park: ['compact', 'sedan'],
};

export function createParkedCars(game) {
  const spots = game.city.parkingSpots.map((s) => ({ ...s, vehicle: null, used: false }));
  let timer = 0;
  let first = true;

  function scan() {
    const px = game.player.x, pz = game.player.z;
    for (const s of spots) {
      const d = Math.hypot(s.x - px, s.z - pz);
      if (s.vehicle) {
        const v = s.vehicle;
        // Once somebody has driven or shunted it, it is no longer ours.
        if (v.driver || Math.hypot(v.x - s.x, v.z - s.z) > 1.5) {
          v.parked = false;
          s.vehicle = null;
          s.used = true;
        } else if (d > DESPAWN_R) {
          game.removeVehicle(v);
          s.vehicle = null;
        }
      } else if (!s.used && d < SPAWN_R && (first || d > MIN_R)) {
        const kinds = MIX[game.city.districtOf(s.x, s.z)] || MIX.midtown;
        const v = createVehicle(game.rng.pick(kinds), s.x, s.z, s.heading, game.rng);
        v.parked = true;
        v.asleep = true;
        s.vehicle = v;
        game.addVehicle(v);
      }
    }
    first = false;
  }

  return {
    name: 'parked',
    spots,
    fixedUpdate(dt) {
      timer -= dt;
      if (timer <= 0) {
        timer = 0.5;
        scan();
      }
    },
  };
}
