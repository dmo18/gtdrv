// Keeps parked cars around the player: cars appear in parking spots a
// little way off and are removed again once far behind, so the city
// feels full without simulating a thousand vehicles.
import { createVehicle } from '../entities/vehicle.js';
import { garageRemove } from '../core/garage.js';

const SPAWN_R = 135;
const DESPAWN_R = 185;
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

  // Cars the player left behind (core/garage.js, kept by systems/session.js)
  // are parked exactly where they were left whenever the player is near.
  function scanGarage() {
    const list = game.garage;
    if (!list) return;
    const px = game.player.x, pz = game.player.z;
    for (let i = list.length - 1; i >= 0; i--) {
      const e = list[i];
      const v = e.vehicle;
      if (v && !v.removed) {
        if (v.driver || v.wrecked) {
          // Taken by somebody else, or destroyed: no longer parked here.
          v.garageEntry = null;
          garageRemove(list, e);
        } else {
          e.x = v.x;
          e.z = v.z;
          e.heading = v.heading;
          if (v.spec && v.spec.health > 0) e.health = Math.max(0.05, Math.min(1, v.health / v.spec.health));
          if (v.parked && Math.hypot(v.x - px, v.z - pz) > DESPAWN_R) {
            game.removeVehicle(v);
            e.vehicle = null;
          }
        }
        continue;
      }
      e.vehicle = null;
      const d = Math.hypot(e.x - px, e.z - pz);
      if (d < SPAWN_R && (first || d > MIN_R)) {
        const c = createVehicle(e.spec, e.x, e.z, e.heading, game.rng);
        c.color = e.color;
        c.health = Math.max(1, e.health * c.spec.health);
        c.parked = true;
        c.asleep = true;
        c.garageEntry = e;
        e.vehicle = c;
        game.addVehicle(c);
      }
    }
  }

  function nearGarage(x, z) {
    const list = game.garage;
    if (!list) return false;
    for (let i = 0; i < list.length; i++) {
      if (Math.abs(list[i].x - x) < 3.2 && Math.abs(list[i].z - z) < 3.2) return true;
    }
    return false;
  }

  function scan() {
    const px = game.player.x, pz = game.player.z;
    scanGarage();
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
      } else if (!s.used && d < SPAWN_R && (first || d > MIN_R) && !nearGarage(s.x, s.z)) {
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
