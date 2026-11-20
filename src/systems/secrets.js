// Hidden secrets: watches the player, fires the discovery toast and score
// bonus the first time each secret is reached, and runs the reward at the
// end of the chain: finding all six unlocks the Ghostwake, parked in a
// lock-up garage whose roller door opens as you come near.
//
// The rules and the spot finder are pure (world/secrets.js, tested in
// test/secrets.test.js). Meshes are optional: without game.scene the
// logic still runs. Saved in progress.secrets (core/save.js).
//
//   game.secrets.spots     the six spots        game.secrets.garage  the garage
//   game.secrets.found()   ids found so far     game.secrets.unlocked()
//   game.secrets.count()   number found
import {
  findSecrets, discover, hintFor, secretsDone, SECRET_DEFS, SECRET_BONUS, FINALE_BONUS, GARAGE_NAME,
} from '../world/secrets.js';
import { createVehicle } from '../entities/vehicle.js';
import { createSecretsMeshes } from '../render/secretsmesh.js';

const CHECK_EVERY = 0.2; // s between looks at the player's position
const DOOR_R = 15; // m from the roller door that opens it
const DOOR_TIME = 1.4; // s to open or close
const RESPAWN_FAR = 160; // m: a missing Ghostwake reappears only this far from the garage

export function createSecrets(game) {
  const city = game.city;
  const events = game.events;
  const layout = findSecrets(city);
  const spots = layout.spots;
  const garage = layout.garage;
  const total = SECRET_DEFS.length;

  const state = () => game.progress.secrets;
  const unlocked = () => !!state() && state().ghostwake === true && secretsDone(state());

  // Solid parts: the lighthouse and the garage walls. The door box is
  // lowered to nothing while the door is up.
  let doorBox = null;
  if (game.collision) {
    for (const s of spots) if (s.kind === 'lighthouse') game.collision.addCircle(s.x, s.z, 2.6, 17, 'lighthouse');
    if (garage) {
      for (const w of garage.walls) game.collision.addBox(w.x0, w.z0, w.x1, w.z1, w.h, 'garage');
      doorBox = game.collision.addBox(garage.door.x0, garage.door.z0, garage.door.x1, garage.door.z1, garage.door.h, 'garage');
    }
  }
  const meshes = game.scene ? createSecretsMeshes(game.scene, spots, garage, game.seaY) : null;

  // ---- the map hint -----------------------------------------------------------
  // One faint dot, only after the first find, pointing at a neighbourhood;
  // once everything is found, a teal dot marks the garage.
  const hintMarker = { x: 0, z: 0, type: 'secret', color: 'rgba(255, 255, 255, 0.35)' };
  const garageMarker = { x: garage ? garage.ox : 0, z: garage ? garage.oz : 0, type: 'secret', color: '#3ff0dc' };
  let hintOn = false, garageOn = false;
  function refreshMarkers() {
    const map = game.map;
    if (!map || !map.addMarker) return;
    const h = state() ? hintFor(state(), spots) : null;
    if (h) {
      hintMarker.x = h.x;
      hintMarker.z = h.z;
    }
    if (!!h !== hintOn) {
      hintOn = !!h;
      if (h) map.addMarker(hintMarker);
      else map.removeMarker(hintMarker);
    }
    const g = !!garage && unlocked();
    if (g !== garageOn) {
      garageOn = g;
      if (g) map.addMarker(garageMarker);
      else map.removeMarker(garageMarker);
    }
  }

  // ---- the car ---------------------------------------------------------------
  let carFirst = true;
  const isGhost = (v) => !!v && !v.removed && !v.wrecked && v.spec && v.spec.id === 'ghostwake';
  function hasGhost() {
    const vs = game.vehicles;
    for (let i = 0; i < vs.length; i++) if (isGhost(vs[i])) return true;
    const list = game.garage;
    if (list) for (let i = 0; i < list.length; i++) if (list[i].spec === 'ghostwake') return true;
    return false;
  }
  function parkGhost(force) {
    if (!garage || !unlocked() || hasGhost()) return;
    const p = game.player;
    if (!force && Math.hypot(p.x - garage.x, p.z - garage.z) < RESPAWN_FAR) return;
    const v = createVehicle('ghostwake', garage.carX, garage.carZ, garage.heading, game.rng);
    v.parked = true;
    v.asleep = true;
    v.home = { craft: v };
    game.addVehicle(v);
  }

  // ---- discovery ---------------------------------------------------------------
  function found(spot) {
    const s = state();
    const n = s.found.length;
    const done = secretsDone(s);
    const hud = game.hud;
    if (hud && hud.toast) hud.toast('Secret found: ' + spot.name + '  ' + n + ' of ' + total + '  +' + SECRET_BONUS, 3.2);
    if (game.score && game.score.add) game.score.add(SECRET_BONUS, 'Secret: ' + spot.name, spot.x, spot.z, true);
    if (done) {
      if (game.score && game.score.add) game.score.add(FINALE_BONUS, 'All secrets', spot.x, spot.z, true);
      if (hud && hud.toast) hud.toast(GARAGE_NAME + ' unlocked. A lock-up garage is marked on your map.', 5);
      parkGhost(true);
    }
    refreshMarkers();
    events.emit('secret', spot);
    events.emit('progress');
  }

  let timer = 0;
  let doorT = 0;
  let carTimer = 0;
  let marked = false;

  const api = {
    name: 'secrets',
    spots,
    garage,
    total,
    found: () => state().found,
    count: () => state().found.length,
    unlocked,
    // Test hook: pretend the player stands at (x, y, z).
    probe(x, y, z) {
      const s = discover(state(), spots, x, y, z);
      if (s) found(s);
      return s;
    },
    get doorOpen() { return doorT; },
    fixedUpdate(dt) {
      if (!marked) {
        // The save is loaded by now: show what it already knows.
        marked = true;
        refreshMarkers();
      }
      timer -= dt;
      if (timer <= 0) {
        timer = CHECK_EVERY;
        const p = game.player;
        const s = discover(state(), spots, p.x, p.y || 0, p.z);
        if (s) found(s);
      }
      carTimer -= dt;
      if (carTimer <= 0) {
        carTimer = 1;
        if (unlocked()) {
          parkGhost(carFirst);
          carFirst = false;
        }
      }
      if (garage) {
        const p = game.player;
        const want = unlocked() && Math.hypot(p.x - garage.ox, p.z - garage.oz) < DOOR_R ? 1 : 0;
        if (doorT < want) doorT = Math.min(want, doorT + dt / DOOR_TIME);
        else if (doorT > want) doorT = Math.max(want, doorT - dt / DOOR_TIME);
        if (doorBox) doorBox.h = doorT > 0.6 ? 0 : garage.door.h;
      }
    },
    render(_alpha, dt) {
      if (!meshes) return;
      meshes.update(dt);
      meshes.setDoor(doorT);
    },
  };
  return api;
}
