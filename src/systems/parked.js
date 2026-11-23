// Keeps parked cars around the player: cars appear in parking spots a
// little way off and are removed again once far behind, so the city
// feels full without simulating a thousand vehicles.
//
// Cost (docs/PLAN_V2.md 5.3 H1): the spots sit in a grid index
// (core/spatial.js), so a scan looks only at the spots near the player and
// at the ones holding a car, never the whole city list. Spots to fill go on
// a queue that is drained a couple of cars a step through the shared spawn
// gate, so the first fill at the start is spread over the first second
// and no step builds a burst of car meshes.
import { createVehicle } from '../entities/vehicle.js';
import { garageRemove } from '../core/garage.js';
import { createPointIndex, beginSpawnStep, takeSpawn, belowLiveCap, SPAWNER } from '../core/spatial.js';

const SPAWN_R = 135;
const DESPAWN_R = 185;
const MIN_R = 60; // never pop in right next to the player
const FIRST_FILL_S = 1; // the start fill may use spots inside MIN_R for this long
// Room left under the live cap for moving traffic and the police.
export const PARKED_RESERVE = 24;

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
  // The designed start street's kerb spaces (`start`, docs/REVAMP.md 6.8)
  // come first, so the first scan fills them before any other.
  const spots = game.city.parkingSpots.map((s) => ({ ...s, vehicle: null, used: false }));
  spots.sort((a, b) => (b.start ? 1 : 0) - (a.start ? 1 : 0));
  const index = createPointIndex(spots.length, (i) => spots[i].x, (i) => spots[i].z, 64);
  const nearIds = [];
  const live = []; // spots holding a car of ours
  const queue = []; // spot indices waiting for a car, in fill order
  const queued = new Uint8Array(spots.length);
  let qHead = 0;
  let timer = 0;
  let first = true; // the start fill (spots inside MIN_R allowed)
  let firstLeft = FIRST_FILL_S;
  let garageWait = false;
  const stats = { scans: 0, looked: 0, spawned: 0, deferred: 0, evicted: 0 };
  let sortX = 0, sortZ = 0;
  const d2 = (s) => (s.x - sortX) * (s.x - sortX) + (s.z - sortZ) * (s.z - sortZ);
  const byNear = (a, b) => ((spots[b].start ? 1 : 0) - (spots[a].start ? 1 : 0)) || (d2(spots[a]) - d2(spots[b])) || a - b;

  // Under the live cap: the parked car farthest behind (outside the spawn
  // ring) makes way for a spot nearer the player. True when one went.
  function evictFar(px, pz, nearer, beyond = SPAWN_R) {
    let far = -1, fd = beyond;
    for (let i = 0; i < live.length; i++) {
      const s = live[i];
      const d = Math.hypot(s.x - px, s.z - pz);
      if (d > fd && d > nearer + 20) { fd = d; far = i; }
    }
    if (far < 0) return false;
    const s = live[far];
    if (s.vehicle && !s.vehicle.removed) game.removeVehicle(s.vehicle);
    s.vehicle = null;
    live.splice(far, 1);
    stats.evicted++;
    return true;
  }

  // Cars the player left behind (core/garage.js, kept by systems/session.js)
  // are parked exactly where they were left whenever the player is near.
  function scanGarage() {
    const list = game.garage;
    garageWait = false;
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
        // The player's own cars always come back (no live cap), but at
        // most a couple a step like everything else.
        if (!takeSpawn(game)) {
          garageWait = true;
          continue;
        }
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
    stats.scans++;
    scanGarage();
    // The spots holding a car: driven off, shunted, or left far behind.
    for (let i = live.length - 1; i >= 0; i--) {
      const s = live[i];
      const v = s.vehicle;
      if (!v) {
        live.splice(i, 1);
        continue;
      }
      if (v.removed) {
        s.vehicle = null;
        live.splice(i, 1);
      } else if (v.driver || Math.hypot(v.x - s.x, v.z - s.z) > 1.5) {
        // Once somebody has driven or shunted it, it is no longer ours.
        v.parked = false;
        s.vehicle = null;
        s.used = true;
        live.splice(i, 1);
      } else if (Math.hypot(s.x - px, s.z - pz) > DESPAWN_R) {
        game.removeVehicle(v);
        s.vehicle = null;
        live.splice(i, 1);
      }
    }
    // Over the live cap (the berthed craft came in, say): the parked cars
    // farthest behind go first.
    let trims = 4;
    while (trims-- > 0 && !belowLiveCap(game, PARKED_RESERVE - 1) && evictFar(px, pz, 0, MIN_R));
    // Empty spots in reach go on the queue.
    if (qHead > 0 && qHead >= queue.length) {
      queue.length = 0;
      qHead = 0;
    }
    index.near(px, pz, SPAWN_R, nearIds);
    stats.looked += nearIds.length;
    // Nearest first (start kerb spots before all), so the first view is
    // full within a few steps and, under the live cap, the cars stand
    // where the player looks.
    sortX = px;
    sortZ = pz;
    nearIds.sort(byNear);
    for (let j = 0; j < nearIds.length; j++) {
      const i = nearIds[j];
      const s = spots[i];
      if (s.vehicle || s.used || queued[i]) continue;
      queued[i] = 1;
      queue.push(i);
    }
  }

  // A couple of cars a step from the queue; a spot no longer in reach is
  // dropped (it is queued again by a later scan when the player is back).
  function drain() {
    const px = game.player.x, pz = game.player.z;
    while (qHead < queue.length) {
      const i = queue[qHead];
      const s = spots[i];
      const d = Math.hypot(s.x - px, s.z - pz);
      const ok = !s.vehicle && !s.used && d < SPAWN_R && (first || d > MIN_R) && !nearGarage(s.x, s.z);
      if (!ok) {
        queued[i] = 0;
        qHead++;
        continue;
      }
      if (!belowLiveCap(game, PARKED_RESERVE) && !evictFar(px, pz, d)) {
        stats.deferred++;
        return;
      }
      if (!takeSpawn(game)) {
        stats.deferred++;
        return;
      }
      queued[i] = 0;
      qHead++;
      const kinds = MIX[game.city.districtOf(s.x, s.z)] || MIX.midtown;
      const v = createVehicle(game.rng.pick(kinds), s.x, s.z, s.heading, game.rng);
      v.parked = true;
      v.asleep = true;
      s.vehicle = v;
      live.push(s);
      game.addVehicle(v);
      stats.spawned++;
    }
    if (first && qHead >= queue.length) first = false;
  }

  return {
    name: 'parked',
    spots,
    stats,
    // Indices of the spots within r of (x, z), ascending (grid index).
    spotsNear(x, z, r, out = []) {
      return index.near(x, z, r, out);
    },
    get pending() {
      return queue.length - qHead;
    },
    fixedUpdate(dt) {
      beginSpawnStep(game, SPAWNER.parked);
      timer -= dt;
      if (timer <= 0) {
        timer = 0.5;
        scan();
      } else if (garageWait) scanGarage();
      drain();
      if (first) {
        firstLeft -= dt;
        if (firstLeft <= 0) first = false;
      }
    },
  };
}
