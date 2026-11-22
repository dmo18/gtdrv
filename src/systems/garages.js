// The twelve Miami garages in play (docs/REVAMP.md 6.6): collision for
// the sheds, the roller doors that open as the player comes within 15 m,
// the GARAGE offer at the door (slow, within 7 m), the first-visit bonus,
// "Word at the garage", and the store / take out / repaint / favourite /
// release actions the Garage screen (ui/explore.js) calls. Everything is
// free. The collection rules are pure (core/explore.js); this file moves
// the real cars. Needs game.explore (systems/adventures.js) first.
//
//   game.garages.current      the garage the screen is open for (or null)
//   game.garages.arrived()    the car the player came in with (or null)
//   game.garages.store() / takeOut(i) / repaint(i | 'arrived', colour) /
//     favourite(i) / release(i) / word()
import {
  storeCar, takeOut as takeOutRule, repaint as repaintRule, toggleFavourite, release as releaseRule,
  markGarageFound, markGarageSeen, markAdventureSeen, garageOpen, paintAllowed,
} from '../core/explore.js';
import { kindOfSpec, savable, garageRemove } from '../core/garage.js';
import { GARAGE_DOOR_R, GARAGE_BONUS, GARAGE_CARS_MAX, atDoor } from '../world/garages.js';
import { createVehicle } from '../entities/vehicle.js';

const DOOR_TIME = 1.2; // s to roll the door up or down
const ARRIVED_R = 20; // m: a car the player just left this close to the door counts as arrived in

export function createGarages(game) {
  const events = game.events;
  const list = game.explore && game.explore.active ? game.explore.garages : [];
  const on = list.length > 0;
  const ex = () => game.explore.state;
  const toast = (t, s = 2.5) => { if (game.hud && game.hud.toast) game.hud.toast(t, s); };

  // ---- collision: walls, and a door box lowered to nothing while open ----------
  const doorBoxes = [];
  if (on && game.collision) {
    for (const g of list) {
      for (const w of g.walls) game.collision.addBox(w.x0, w.z0, w.x1, w.z1, w.h, 'garage');
      doorBoxes.push(game.collision.addBox(g.doorBox.x0, g.doorBox.z0, g.doorBox.x1, g.doorBox.z1, g.doorBox.h, 'garage'));
    }
  }
  const doorT = new Float32Array(list.length);
  let meshes = null; // shared with the adventures system's explore meshes

  // ---- the car the player came in with ---------------------------------------------
  let lastLeft = null;
  events.on('exit', (v) => { lastLeft = v; });
  function arrived() {
    const p = game.player;
    const g = current;
    const ok = (v) => !!v && v.kind === 'car' && savable(v) && kindOfSpec(v.spec.id) === 'car' && v.spec.id !== 'ghostwake';
    if (p.vehicle) return ok(p.vehicle) ? p.vehicle : null;
    if (g && ok(lastLeft) && !lastLeft.driver && Math.hypot(lastLeft.x - g.door.x, lastLeft.z - g.door.z) < ARRIVED_R) return lastLeft;
    return null;
  }
  const arrivedKind = () => {
    const v = game.player.vehicle;
    return v && v.kind !== 'car' ? v.kind : null;
  };

  // A car leaves the world for the collection: never left behind as well.
  function takeFromWorld(v) {
    const p = game.player;
    if (v.garageEntry && game.garage) garageRemove(game.garage, v.garageEntry);
    v.garageEntry = null;
    if (p.vehicle === v) {
      v.driver = null;
      p.vehicle = null;
      const g = current;
      const w = p.walker;
      const ux = Math.cos(g.heading), uz = Math.sin(g.heading);
      w.x = w.px = g.door.x + ux * 2;
      w.z = w.pz = g.door.z + uz * 2;
      w.heading = w.pheading = g.heading;
      w.vx = w.vz = 0;
      w.speed = 0;
      p.x = w.x;
      p.z = w.z;
      game.setPlayerMode('foot');
    }
    if (lastLeft === v) lastLeft = null;
    game.removeVehicle(v);
  }

  // ---- the actions (the Garage screen calls these) ---------------------------------------
  function store() {
    const v = arrived();
    if (!current || !v) return { ok: false, reason: 'no-car' };
    const r = storeCar(ex(), v);
    if (!r.ok) {
      if (r.reason === 'full') toast('The collection is full (' + GARAGE_CARS_MAX + '). Release a car first.', 3);
      return r;
    }
    takeFromWorld(v);
    events.emit('garageUsed', { id: current.id, action: 'store' });
    game.explore.changed();
    return r;
  }

  function takeOut(index) {
    if (!current) return { ok: false, reason: 'no-garage' };
    const g = current;
    const v = arrived();
    const r = takeOutRule(ex(), index, v);
    if (!r.ok) return r;
    const p = game.player;
    if (v && r.stored) takeFromWorld(v);
    else if (v && r.left) {
      // Full: the car stays outside, moved to the side of the forecourt.
      const px = -Math.sin(g.heading), pz = Math.cos(g.heading);
      if (p.vehicle === v) {
        v.driver = null;
        p.vehicle = null;
        events.emit('exit', v);
      }
      v.x = v.px = g.bay.x + px * 5;
      v.z = v.pz = g.bay.z + pz * 5;
      v.speed = 0;
      v.asleep = false;
      toast('The collection is full: your car is parked outside.', 3);
    }
    const car = createVehicle(r.car.spec, g.bay.x, g.bay.z, g.bay.heading, game.rng);
    car.color = r.car.color;
    car.fav = r.car.fav === true;
    car.meshDirty = true;
    game.addVehicle(car);
    const w = p.walker;
    w.x = w.px = car.x;
    w.z = w.pz = car.z;
    if (p.vehicle) {
      // A boat or aircraft is never stored: it stays where it is.
      const old = p.vehicle;
      old.driver = null;
      p.vehicle = null;
      events.emit('exit', old);
    }
    game.enterVehicle(car);
    p.x = car.x;
    p.z = car.z;
    p.heading = car.heading;
    if (game.snapCam) game.snapCam();
    events.emit('garageUsed', { id: g.id, action: 'take' });
    game.explore.changed();
    return { ok: true, vehicle: car, stored: r.stored, left: r.left };
  }

  // Repaint a stored car (index) or the one driven in ('arrived'). The
  // live car changes colour at once.
  function repaint(target, color) {
    if (target === 'arrived') {
      const v = arrived();
      if (!v || !paintAllowed(v.spec.id, color)) return { ok: false, reason: 'colour' };
      v.color = color;
      if (game.kinds && game.kinds.car && v.mesh) {
        game.scene.remove(v.mesh);
        v.mesh = game.kinds.car.createMesh(v.spec, v.color);
        game.scene.add(v.mesh);
        v.meshDirty = true;
      }
      if (current) events.emit('garageUsed', { id: current.id, action: 'repaint' });
      return { ok: true };
    }
    const r = repaintRule(ex(), target, color);
    if (r.ok) {
      if (current) events.emit('garageUsed', { id: current.id, action: 'repaint' });
      game.explore.changed();
    }
    return r;
  }
  function favourite(index) {
    const r = toggleFavourite(ex(), index);
    if (r.ok) {
      // A favourite out on the road loses its star when another is picked.
      for (const v of game.vehicles) if (v.fav) v.fav = false;
      if (current) events.emit('garageUsed', { id: current.id, action: 'favourite' });
      game.explore.changed();
    }
    return r;
  }
  function release(index) {
    const r = releaseRule(ex(), index);
    if (r.ok) {
      if (current) events.emit('garageUsed', { id: current.id, action: 'release' });
      game.explore.changed();
    }
    return r;
  }

  // "Word at the garage": the nearest thing not found yet (an open garage
  // not visited, or an adventure not yet seen), by distance from this
  // garage, so it is the same for every player. Puts it on the map.
  let word = null;
  function pickWord(g) {
    const e = ex();
    let best = null, bd = Infinity;
    for (const o of list) {
      if (o === g || e.garages.found.includes(o.id) || !garageOpen(e, o.id)) continue;
      const d = Math.hypot(o.door.x - g.door.x, o.door.z - g.door.z);
      if (d < bd) { bd = d; best = { kind: 'garage', id: o.id, text: 'Word at the garage: there is a lock-up called ' + o.name + ' in ' + o.place + '.' }; }
    }
    for (const a of game.explore.adventures) {
      if (e.adventures.seen.includes(a.id)) continue;
      const d = Math.hypot(a.giver.x - g.door.x, a.giver.z - g.door.z);
      if (d < bd) { bd = d; best = { kind: 'adventure', id: a.id, text: 'Word at the garage: people talk about ' + a.name + ' over in ' + a.place + '.' }; }
    }
    if (!best) return { kind: null, id: null, text: 'Word at the garage: you have heard everything this town has to say.' };
    if (best.kind === 'garage') markGarageSeen(e, best.id);
    else {
      if (markAdventureSeen(e, best.id)) events.emit('adventureSeen', { id: best.id });
    }
    return best;
  }

  // ---- open the Garage screen ------------------------------------------------------------
  let current = null;
  let offer = -1;
  function open(i = offer) {
    const g = list[i];
    if (!g || !garageOpen(ex(), g.id)) return false;
    current = g;
    const e = ex();
    if (markGarageFound(e, g.id)) {
      if (game.score && game.score.add) game.score.add(GARAGE_BONUS, 'Garage found: ' + g.name, g.x, g.z, true);
      events.emit('garageFound', { id: g.id });
    }
    e.garages.last = g.id;
    // Adventures given at this garage are heard here.
    for (const a of game.explore.adventures) {
      if (a.giver.type === 'garage' && a.giver.garage === g.id && markAdventureSeen(e, a.id)) {
        events.emit('adventureSeen', { id: a.id });
        if (!e.adventures.tracked) e.adventures.tracked = a.id;
      }
    }
    word = pickWord(g);
    game.explore.changed();
    if (game.menu && game.menu.open) game.menu.open('garage');
    return true;
  }

  if (on && game.touch && game.touch.registerAction) {
    game.touch.registerAction({
      id: 'garage', label: 'Use garage', text: 'GARAGE', group: 'primary', modes: ['foot', 'car'],
      icon: '<path d="M3 11l9-7 9 7v9H3z"/><path d="M7 20v-7h10v7M7 16h10"/>',
      press: () => open(),
      visible: () => offer >= 0,
    });
  }

  let prompted = -1;
  let checkTimer = 0;
  const api = {
    name: 'garages',
    list,
    get current() { return current; },
    get offer() { return offer; },
    get word() { return word; },
    doorOpen: (i) => doorT[i] || 0,
    arrived,
    arrivedKind,
    open,
    store, takeOut, repaint, favourite, release,
    close() { current = null; },
    setMeshes(m) { meshes = m; },
    fixedUpdate(dt) {
      if (!on) return;
      const p = game.player;
      const e = ex();
      checkTimer -= dt;
      if (checkTimer <= 0) {
        checkTimer = 0.1;
        let o = -1;
        const sp = p.vehicle ? Math.abs(p.vehicle.speed || 0) : 0;
        for (let i = 0; i < list.length; i++) {
          if (atDoor(list[i], p.x, p.z, sp) && garageOpen(e, list[i].id) && (p.mode === 'foot' || p.mode === 'car')) { o = i; break; }
        }
        offer = o;
        if (offer !== prompted && game.hud && game.hud.setPrompt) {
          if (offer >= 0) game.hud.setPrompt('Tap GARAGE: ' + list[offer].name);
          else if (prompted >= 0) game.hud.setPrompt(null);
          prompted = offer;
        }
      }
      for (let i = 0; i < list.length; i++) {
        const g = list[i];
        const dx = p.x - g.door.x, dz = p.z - g.door.z;
        const want = dx * dx + dz * dz < GARAGE_DOOR_R * GARAGE_DOOR_R && garageOpen(e, g.id) ? 1 : 0;
        const t = doorT[i];
        if (t < want) doorT[i] = Math.min(want, t + dt / DOOR_TIME);
        else if (t > want) doorT[i] = Math.max(want, t - dt / DOOR_TIME);
        if (doorBoxes[i]) doorBoxes[i].h = doorT[i] > 0.6 ? 0 : g.doorBox.h;
      }
    },
    render() {
      if (!meshes && game.adventures && game.adventures.meshes) meshes = game.adventures.meshes;
      if (!meshes) return;
      for (let i = 0; i < list.length; i++) meshes.setDoor(i, doorT[i]);
    },
  };
  events.on('pause', (paused) => { if (!paused) current = null; });
  return api;
}

// The car the player starts in on Start and after New game (6.6, 6.8):
// the favourite in the collection, or a favourite out on the road.
export function favouriteCar(game) {
  const f = game.explore && game.explore.favourite ? game.explore.favourite() : null;
  if (f) return f;
  const vs = game.vehicles || [];
  for (let i = 0; i < vs.length; i++) {
    const v = vs[i];
    if (v.fav && !v.removed && v.spec && kindOfSpec(v.spec.id) === 'car') return { spec: v.spec.id, color: v.color, health: 1, reward: false };
  }
  return null;
}
