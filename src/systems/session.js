// Remembers where the player was and what they were driving, and brings
// them back to it. The saved record (core/garage.js) rides in the normal
// save (progress.session); this system takes snapshots, saves them and
// restores them. Wanted level and chases are never saved.
//
//   game.garage          the cars left parked (entries: spec, color, health,
//                        x, z, heading, plus a runtime `vehicle` link)
//   game.snapshotSession()  refresh progress.session from the live game
//   game.saveSession()      snapshot and write to storage
//   game.restoreSession()   put the player back (returns true if it did)
//   game.newSession()       forget place and car (scores and settings stay)
// Travel between regions (docs/PLAN_V2.md 3.4, 3.5): on game.session,
//   travelTo(regionId, linkId)  save the target region's session and the map
//                    choice in one call, then reload behind a veil; returns
//                    the plain refusal text (wanted) or '' when it goes
//   arrive(linkId)   after the reload: the exact pose of that pad's arrival
// Title screen (docs/REVAMP.md 6.8), on game.session:
//   canContinue()    a saved place exists and is valid for this map
//   continueSaved()  restore it (true if it worked, never throws)
//   startFresh()     the first view: the designed start spot, player in the
//                    favourite or starter car; the car held before is left
//                    behind; place and garage are kept
//   newGame()        game.newSession()
//   hold(on)         while on (the title is showing) nothing is autosaved,
//                    so the saved place survives until play begins
import { saveProgress } from '../core/save.js';
import {
  buildSession, garageAdd, garageRemove, savable, craftRecord, kindOfSpec, specOf,
  sanitizeGarage, selectMapSession, GARAGE_MAX, SAFE_ALT,
} from '../core/garage.js';
import { placeValid, startSpot } from '../core/startplace.js';
import {
  padNear, padHint, travelRefusal, travelSave, arrivalApprox, writeTravelNote, mapName, PAD_STOP,
} from '../core/travel.js';
import { regionFor, REGIONS } from '../world/regions.js';
import { createTravelMarkers } from '../render/markers.js';
import { createTravelPrompt } from '../ui/travelprompt.js';
import { showVeil } from '../ui/mappicker.js';
import { createVehicle } from '../entities/vehicle.js';
import { createBoat } from '../entities/boat.js';
import { createAircraft } from '../entities/aircraft.js';
import { createTank } from '../entities/tank.js';
import { resetHeat } from './police.js';

const AUTOSAVE_EVERY = 10; // seconds of simulated time
const FACTORY = { car: createVehicle, boat: createBoat, plane: createAircraft, heli: createAircraft, tank: createTank };
const NEAR_FLEET = 40; // m: reuse a berthed craft of the same kind this close

export function createSession(game, storage) {
  const city = game.city, collision = game.collision;
  // Sessions belong to a map: this map's comes out of the save, another
  // map's is kept aside (never moved here).
  const mapId = city.mapId || city.map || 'island';
  selectMapSession(game.progress, mapId);
  const garage = [];
  game.garage = garage;
  let timer = AUTOSAVE_EVERY;
  let restoring = false;
  const SPOT = { x: 0, z: 0, ok: true };
  const POSE = { x: 0, z: 0, heading: 0 };

  function loadGarage(list) {
    garage.length = 0;
    for (const g of list) garage.push({ ...g, vehicle: null });
  }

  function snapshot() {
    const p = game.player;
    // Keep the entries' poses and health fresh before they are written.
    for (let i = garage.length - 1; i >= 0; i--) {
      const e = garage[i], v = e.vehicle;
      if (!v || v.removed) continue;
      if (v.wrecked) {
        garageRemove(garage, e);
        continue;
      }
      e.x = v.x;
      e.z = v.z;
      e.heading = v.heading;
      e.health = Math.max(0.05, Math.min(1, v.health / v.spec.health));
    }
    const craft = p.vehicle && savable(p.vehicle) ? p.vehicle : null;
    const wrecked = !!(p.vehicle && !craft);
    const s = buildSession(wrecked ? null : p, craft, garage, mapId);
    game.progress.session = s;
    return s;
  }

  let held = false;
  function save() {
    if (restoring || held) return false;
    snapshot();
    return saveProgress(storage, game.progress);
  }

  // --- Where can the player stand / park? --------------------------------
  function groundFree(x, z, r) {
    if (city.isGround && !city.isGround(x, z)) return false;
    return !collision.resolveCircle(x, z, r, 0).hit;
  }

  function nearestRoad(x, z, out) {
    const nodes = city.nodes;
    let best = -1, bd = Infinity;
    for (let i = 0; i < nodes.length; i++) {
      const d = (nodes[i].x - x) * (nodes[i].x - x) + (nodes[i].z - z) * (nodes[i].z - z);
      if (d < bd) {
        bd = d;
        best = i;
      }
    }
    if (best < 0) {
      out.x = city.spawn.x;
      out.z = city.spawn.z;
      out.heading = city.spawn.heading;
      return out;
    }
    const n = nodes[best];
    out.x = n.x;
    out.z = n.z;
    out.heading = 0;
    for (let i = 0; i < city.edges.length; i++) {
      const e = city.edges[i];
      if (e.a === best || e.b === best) {
        const o = nodes[e.a === best ? e.b : e.a];
        out.heading = Math.atan2(o.z - n.z, o.x - n.x);
        break;
      }
    }
    return out;
  }

  function nearestSpot(list, specId, kind, x, z, out) {
    let best = null, bd = Infinity;
    for (const s of list || []) {
      const spec = specOf(s.spec);
      if (!spec) continue;
      const match = s.spec === specId ? 0 : kindOfSpec(s.spec) === kind ? 1e8 : 1e10;
      const d = match + (s.x - x) * (s.x - x) + (s.z - z) * (s.z - z);
      if (d < bd) {
        bd = d;
        best = s;
      }
    }
    if (!best) return false;
    out.x = best.x;
    out.z = best.z;
    out.heading = best.heading || 0;
    return true;
  }

  // The pose a restored craft will really get. Writes POSE-like out.
  function placeCraft(kind, spec, x, z, heading, airborne, out) {
    out.x = x;
    out.z = z;
    out.heading = heading;
    const r = (spec.width || 2) / 2 + 0.3;
    if (kind === 'car' || kind === 'tank') {
      if (!groundFree(x, z, r + (kind === 'tank' ? 1 : 0))) nearestRoad(x, z, out);
    } else if (kind === 'boat') {
      const water = !city.isLand(x, z) && city.shoreDist(x, z) < -3 && !game.waterCollision.resolveCircle(x, z, r + 1, 0).hit;
      if (!water && !nearestSpot(city.boatSpots, spec.id, 'boat', x, z, out)) nearestRoad(x, z, out);
    } else if (!airborne) {
      // Aircraft on the ground: a clear spot on land or water for a floatplane.
      const ok = spec.floats ? !collision.resolveCircle(x, z, r + 2, 0).hit : groundFree(x, z, r + 2);
      if (!ok && !nearestSpot(city.aircraftSpots, spec.id, kind, x, z, out)) nearestRoad(x, z, out);
    }
    return out;
  }

  // A craft of the same spec parked near the target pose (fleet berths:
  // jets and tanks at the depot, boats at piers) is reused, so the world
  // never holds two of the same berthed craft.
  function reusable(specId, x, z) {
    for (const v of game.vehicles) {
      if (v.removed || v.wrecked || v.driver || !v.home || v.spec.id !== specId) continue;
      if (Math.hypot(v.x - x, v.z - z) < NEAR_FLEET) return v;
    }
    return null;
  }

  function placePlayerOnFoot(x, z, heading) {
    const p = game.player, w = p.walker;
    SPOT.x = x;
    SPOT.z = z;
    if (!groundFree(x, z, 0.6)) game.findRescueSpot(x, z, SPOT);
    w.x = w.px = SPOT.x;
    w.z = w.pz = SPOT.z;
    w.heading = w.pheading = heading;
    w.vx = w.vz = w.speed = 0;
    p.vehicle = null;
    p.x = w.x;
    p.z = w.z;
    p.y = 0;
    game.setPlayerMode('foot');
  }

  function dropStarter() {
    const p = game.player, v = p.vehicle;
    if (v) {
      v.driver = null;
      p.vehicle = null;
      game.removeVehicle(v);
    }
  }

  function restore() {
    const s = game.progress.session;
    if (!s) return false;
    loadGarage(s.garage || []);
    if (s.mode === 'start') return false;
    restoring = true;
    try {
      const p = game.player;
      if (s.mode === 'foot') {
        dropStarter();
        placePlayerOnFoot(s.x, s.z, s.heading);
      } else if (s.craft) {
        const c = s.craft;
        const kind = kindOfSpec(c.spec);
        const spec = specOf(c.spec);
        const air = (kind === 'plane' || kind === 'heli') && c.airborne;
        placeCraft(kind, spec, s.x, s.z, s.heading, air, POSE);
        const moved = Math.hypot(POSE.x - s.x, POSE.z - s.z) > 0.5;
        dropStarter();
        let v = reusable(c.spec, POSE.x, POSE.z);
        if (v) {
          v.x = v.px = POSE.x;
          v.z = v.pz = POSE.z;
          v.heading = v.pheading = POSE.heading;
        } else {
          v = FACTORY[kind](c.spec, POSE.x, POSE.z, POSE.heading, game.rng);
          v.color = c.color;
          game.addVehicle(v);
        }
        v.color = c.color;
        v.health = Math.max(1, c.health * spec.health);
        v.wrecked = false;
        v.asleep = false;
        if (air && !moved) {
          const a = v;
          a.onGround = false;
          a.y = a.py = Math.max(c.y, SAFE_ALT);
          const sp = kind === 'plane' ? Math.max(c.speed, spec.stallSpeed * 1.5) : Math.min(c.speed, 10);
          a.speed = a.airspeed = sp;
          a.vx = Math.cos(a.heading) * sp;
          a.vz = Math.sin(a.heading) * sp;
          if (kind === 'heli') a.rotorSpeed = 1;
          a.placed = true;
        }
        // Not in a garage list while being driven.
        if (v.garageEntry) garageRemove(garage, v.garageEntry);
        game.enterVehicle(v);
        p.x = v.x;
        p.z = v.z;
        p.heading = v.heading;
        const w = p.walker;
        w.x = w.px = v.x;
        w.z = w.pz = v.z;
      }
    } finally {
      restoring = false;
    }
    if (game.snapCam) game.snapCam();
    return true;
  }

  function newSession() {
    const p = game.player;
    const old = p.vehicle;
    // The favourite car from the garages (docs/REVAMP.md 6.6), else the
    // sedan; read before the old car goes (it may be the favourite).
    const fav = game.favouriteCar ? game.favouriteCar() : null;
    // Cars from the old garage are forgotten (and removed if parked ones).
    for (const e of garage) {
      if (e.vehicle && !e.vehicle.removed && e.vehicle !== old && !e.vehicle.driver) {
        e.vehicle.garageEntry = null;
        game.removeVehicle(e.vehicle);
      }
    }
    garage.length = 0;
    if (old) {
      old.driver = null;
      p.vehicle = null;
      game.removeVehicle(old);
    }
    const favOk = !!(fav && specOf(fav.spec) && kindOfSpec(fav.spec) === 'car');
    const car = createVehicle(favOk ? fav.spec : 'sedan', city.spawn.x, city.spawn.z, city.spawn.heading, game.rng);
    if (favOk && typeof fav.color === 'number') car.color = fav.color;
    game.addVehicle(car);
    const w = p.walker;
    w.x = w.px = car.x;
    w.z = w.pz = car.z;
    game.enterVehicle(car);
    p.x = car.x;
    p.z = car.z;
    p.heading = car.heading;
    p.wanted = 0;
    if (game.police && game.police.heat) resetHeat(game.police.heat, 3);
    game.progress.session = null;
    saveProgress(storage, game.progress);
    if (game.snapCam) game.snapCam();
    if (game.hud && game.hud.toast) game.hud.toast('New game: back at the start', 2.5);
    return true;
  }

  // --- Title screen -------------------------------------------------------
  function canContinue() {
    try {
      return placeValid(game.progress.session, mapId, city);
    } catch {
      return false;
    }
  }

  function continueSaved() {
    held = false;
    if (!canContinue()) return false;
    try {
      return restore() === true;
    } catch {
      restoring = false;
      return false;
    }
  }

  // The car being driven is left where it is (parked, in the garage list if
  // it can be saved), exactly as leaving a car does; the untouched starter
  // car is simply removed.
  function leaveCar() {
    const p = game.player, v = p.vehicle;
    if (!v) return;
    v.driver = null;
    p.vehicle = null;
    if (!v.starter && v.kind === 'car' && savable(v)) {
      garageAdd(garage, craftRecord(v));
      const e = garage[0];
      if (e && e.spec === v.spec.id) {
        e.vehicle = v;
        v.garageEntry = e;
      }
      while (garage.length > GARAGE_MAX) garage.pop();
    } else {
      game.removeVehicle(v);
    }
  }

  function startFresh() {
    held = false;
    const p = game.player;
    const at = startSpot(city, POSE);
    restoring = true;
    try {
      leaveCar();
      // The favourite car (docs/REVAMP.md 6.6), when the garage screen offers one.
      const fav = game.favouriteCar ? game.favouriteCar() : null;
      const favSpec = fav && specOf(fav.spec) && kindOfSpec(fav.spec) === 'car' ? fav : null;
      const car = createVehicle(favSpec ? favSpec.spec : 'sedan', at.x, at.z, at.heading, game.rng);
      if (favSpec) {
        if (typeof favSpec.color === 'number') car.color = favSpec.color;
      } else {
        car.starter = true;
      }
      game.addVehicle(car);
      const w = p.walker;
      w.x = w.px = car.x;
      w.z = w.pz = car.z;
      game.enterVehicle(car);
      p.x = car.x;
      p.z = car.z;
      p.heading = car.heading;
      p.wanted = 0;
      if (game.police && game.police.heat) resetHeat(game.police.heat, 3);
      // A time the player fixed in Settings applies when play begins.
      const st = game.progress.settings;
      if (st && st.liveTime === false && isFinite(st.timeOfDay)) {
        if (game.daynight && game.daynight.setHour) game.daynight.setHour(st.timeOfDay);
        else game.clock = st.timeOfDay;
      }
    } finally {
      restoring = false;
    }
    if (game.snapCam) game.snapCam();
    save();
    return true;
  }

  // --- Travel ----------------------------------------------------------------
  const toast = (t, secs = 3, kind = 'info') => { if (game.hud && game.hud.toast) game.hud.toast(t, secs, kind); };
  const noteStore = () => {
    try {
      return typeof sessionStorage !== 'undefined' ? sessionStorage : null;
    } catch {
      return null;
    }
  };
  let travelling = false;
  function travelTo(toId, linkId = null) {
    if (travelling || !regionFor(toId) || toId === mapId) return '';
    const p = game.player;
    const why = travelRefusal(p.wanted || 0);
    if (why) return why;
    snapshot();
    const car = p.vehicle && savable(p.vehicle) ? p.vehicle : null;
    const pose = linkId ? arrivalApprox(toId, linkId) : null;
    // One save call: the target's session and the map choice (PLAN_V2 3.5 rule 9).
    travelSave(storage, game.progress, mapId, toId, car, p, pose);
    travelling = true;
    held = true; // no autosave or page-hide save may overwrite what was just written
    const ns = noteStore();
    if (ns) writeTravelNote(ns, toId, linkId);
    if (typeof document !== 'undefined' && document.body) showVeil(document, 'Travelling to ' + mapName(toId) + '...');
    const go = game.reload || (() => { if (typeof location !== 'undefined' && location.reload) location.reload(); });
    if (typeof setTimeout === 'function') setTimeout(go, 120);
    else go();
    return '';
  }

  // The exact arrival pose of a travel pad of this region (the twin link);
  // with no link (the Travel list), the region's start place as built
  // (core/travel.js regionStart is the table point the save was written
  // at; Downtown's table point lies 42 m off its street).
  const ARRIVE = { x: 0, z: 0, heading: 0 };
  function arrive(linkId) {
    let a = null;
    if (linkId) {
      const pad = (city.travelPads || []).find((q) => q.id === linkId);
      a = pad && pad.arrive ? pad.arrive : null;
    } else if (city.region) a = startSpot(city, ARRIVE);
    if (!a) return false;
    const p = game.player, v = p.vehicle, w = p.walker;
    if (v) {
      v.x = v.px = a.x;
      v.z = v.pz = a.z;
      v.heading = v.pheading = a.heading;
      v.vx = v.vz = 0;
      v.speed = 0;
    }
    if (w) {
      w.x = w.px = a.x;
      w.z = w.pz = a.z;
      w.heading = w.pheading = a.heading;
    }
    p.x = a.x;
    p.z = a.z;
    p.heading = a.heading;
    if (game.snapCam) game.snapCam();
    return true;
  }

  // The pad prompt and the hint lines, checked four times a second of
  // simulated time (never wall-clock time).
  const NEAR = { pad: null, d: 0, on: false };
  let padTimer = 0, edgeTimer = 0, clock = 0, hintAt = -99, edgeAt = -99, declined = null, paused = false;
  const prompt = typeof document !== 'undefined'
    ? createTravelPrompt(document, {
      onYes() {
        const pad = prompt.pad;
        if (paused) game.paused = false;
        paused = false;
        const msg = pad ? travelTo(pad.to, pad.id) : '';
        if (msg) toast(msg, 3, 'police');
      },
      onStay() {
        if (paused) game.paused = false;
        paused = false;
        declined = prompt.pad ? prompt.pad.id : null;
      },
    })
    : null;
  function padCheck() {
    const p = game.player;
    const pads = city.travelPads;
    if (!pads || !pads.length || game.paused || travelling || held) return;
    if (p.mode !== 'car' && p.mode !== 'tank' && p.mode !== 'foot') return;
    padNear(city, p.x, p.z, NEAR);
    if (!NEAR.pad) {
      declined = null;
      return;
    }
    const pad = NEAR.pad;
    const refused = travelRefusal(p.wanted || 0);
    const speed = p.vehicle ? Math.abs(p.vehicle.speed || 0) : 0;
    if (NEAR.on && !refused && declined !== pad.id && speed <= PAD_STOP && prompt) {
      prompt.pad = pad;
      prompt.show('Drive on to ' + mapName(pad.to) + '?');
      if (prompt.isOpen()) {
        paused = !game.paused;
        game.paused = true;
      }
      return;
    }
    if (declined === pad.id && NEAR.d > 15) declined = null;
    if (declined !== pad.id && clock - hintAt > 8) {
      hintAt = clock;
      toast(padHint(pad, p.wanted || 0), 3, refused ? 'police' : 'info');
    }
  }
  // Boats and aircraft are turned back 600 m past the crop (entities/aircraft.js):
  // from 400 m out the HUD says where the edge is.
  function edgeCheck() {
    const c = city.region ? city.crop : null;
    const p = game.player, v = p.vehicle;
    if (!c || !v || (v.kind !== 'boat' && v.kind !== 'plane' && v.kind !== 'heli')) return;
    const out = Math.max(c.x0 - v.x, v.x - c.x1, c.z0 - v.z, v.z - c.z1, 0);
    if (out > 400 && clock - edgeAt > 10) {
      edgeAt = clock;
      toast('Edge of this map. Open the map to travel.', 4);
    }
  }

  // --- Hooks ----------------------------------------------------------------
  game.events.on('enter', (v) => {
    if (restoring) return;
    if (v && v.garageEntry) {
      garageRemove(garage, v.garageEntry);
      v.garageEntry = null;
    }
    save();
  });
  game.events.on('exit', (v) => {
    if (v && v.kind === 'car' && savable(v)) {
      garageAdd(garage, craftRecord(v));
      const e = garage[0];
      if (e && e.spec === v.spec.id) {
        e.vehicle = v;
        v.garageEntry = e;
      }
      while (garage.length > GARAGE_MAX) garage.pop();
    }
    save();
  });
  // A wrecked or removed craft is never restored: snapshots skip it.
  game.events.on('progressReset', () => {
    garage.length = 0;
    game.progress.session = null;
  });
  if (typeof document !== 'undefined' && document.addEventListener) {
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) save();
    });
  }
  if (typeof window !== 'undefined' && window.addEventListener) {
    window.addEventListener('pagehide', save);
    window.addEventListener('beforeunload', save);
  }

  game.snapshotSession = snapshot;
  game.saveSession = save;
  game.restoreSession = restore;
  game.newSession = newSession;
  game.travelTo = travelTo;
  // The glow and "To Miami Beach" label over each travel pad (render/markers.js;
  // null in node, without a scene or on a map with no pads).
  let padMarks = null;
  if (game.scene && city.travelPads && city.travelPads.length) {
    const names = {};
    for (const r of REGIONS) names[r.id] = r.name;
    try {
      padMarks = createTravelMarkers(game.scene, city, names);
    } catch (e) {
      padMarks = null;
      if (game.errors && game.errors.report) game.errors.report('session.travelMarkers', e);
    }
  }
  // The garage as loaded from storage, before the player is put back.
  loadGarage(game.progress.session ? sanitizeGarage(game.progress.session.garage) : []);

  return {
    name: 'session',
    garage,
    canContinue,
    continueSaved,
    startFresh,
    newGame: newSession,
    travelTo,
    arrive,
    mapId,
    hold(on) {
      held = !!on;
    },
    travelMarkers: () => padMarks,
    render() {
      if (!padMarks) return;
      const p = game.player;
      padMarks.update(p.x, p.z, game.time || 0);
    },
    fixedUpdate(dt) {
      clock += dt;
      padTimer -= dt;
      if (padTimer <= 0) {
        padTimer = 0.25;
        padCheck();
      }
      edgeTimer -= dt;
      if (edgeTimer <= 0) {
        edgeTimer = 0.5;
        edgeCheck();
      }
      timer -= dt;
      if (timer <= 0) {
        timer = AUTOSAVE_EVERY;
        if (!game.paused) save();
      }
    },
  };
}
