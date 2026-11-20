// Carjacking: ENTER on a craft with somebody at the controls. The player
// runs to the door, the door opens, the driver is dragged out and thrown
// to the ground, then the player climbs in. The driver is a real combat
// actor (game.actors): it lies down, gets up and runs, and can be shot or
// run over like anybody else. Timeline and rules: core/carjack.js.
//
// Events: 'carjack' { car, victim, thief } and 'down' { target, source:
// null, kind: 'carjack' } at the throw, 'carDoor' { car, open } when the
// door opens. Police hear 'down' with no source so there is no automatic
// violence heat; heat for the jack itself is added here.
import { createRng, angleDiff } from '../core/rng.js';
import {
  JACK, canJack, isOccupied, occupantTeam, jackHeat, createJack, stepJack, dragPose,
  createVictimState, stepVictim,
} from '../core/carjack.js';
import { createWalker, exitPosition } from '../entities/onfoot.js';
import { initActor, addActor, removeActor, layDown } from './combat.js';
import { createPersonMesh, updatePersonMesh, PERSON_PALETTES } from '../render/personmesh.js';

const MAX_VICTIMS = 6;
const WITNESS_COP = 45;
const WITNESS_CIV = 22;
const KNOCK_DECAY = 6; // matches combat's knock-back decay (m/s^2)
const COP_LOOK = { shirt: 0x2b4a7a, trousers: 0x1c2433, skin: 0xd9a87e, hair: 0x1a120c };
const NO_CONTROLS = { steer: 0, throttle: 0, brake: 1, handbrake: true };

export function createCarjack(game) {
  const rng = createRng(40811);
  const EXIT = { x: 0, z: 0, ok: false };
  const POSE = { x: 0, y: 0, z: 0 };
  const THREAT = { x: 0, z: 0 };
  const CJ = { car: null, victim: null, thief: null };
  const DOWN = { target: null, source: null, kind: 'carjack' };
  const DOOR = { car: null, open: true };
  const victims = [];
  const spare = []; // unused person meshes
  let jack = null;
  let victim = null; // the actor being dragged in the current jack

  const world = () => game.world || { collision: game.collision, city: game.city };
  const emit = (name, a) => {
    if (game.events && game.events.emit) game.events.emit(name, a);
  };

  function resolve(x, z, r) {
    const col = game.collision;
    if (!col) return null;
    const res = col.resolveCircle(x, z, r, 0);
    const city = game.city;
    if (city && city.isGround && !city.isGround(res.x, res.z)) return null;
    return res;
  }

  const clearSpot = (x, z) => {
    const col = game.collision;
    return !col || !col.resolveCircle(x, z, 0.4, 0).hit;
  };

  // --- The victim -----------------------------------------------------
  function makeVictim(v, team) {
    if (victims.length >= MAX_VICTIMS) retire(victims[0]);
    const a = createWalker(jack.seat.x, jack.seat.z, v.heading);
    initActor(a, team === 'police' ? 'police' : 'civ');
    a.y = 0.45; // sitting
    a.cj = createVictimState(team);
    a.look = team === 'police' ? COP_LOOK : PERSON_PALETTES[rng.int(0, PERSON_PALETTES.length - 1)];
    a.mesh = null;
    if (!addActor(game, a)) return null;
    victims.push(a);
    return a;
  }

  function meshFor(a) {
    if (a.mesh || !game.scene) return a.mesh;
    let m = spare.pop();
    if (!m) {
      m = createPersonMesh(a.look);
      m.rotation.order = 'YXZ';
      game.scene.add(m);
    }
    a.mesh = m;
    return m;
  }

  function retire(a) {
    removeActor(game, a);
    const i = victims.indexOf(a);
    if (i >= 0) victims.splice(i, 1);
    if (a.mesh) {
      a.mesh.visible = false;
      spare.push(a.mesh);
      a.mesh = null;
    }
    if (a === victim) victim = null;
  }

  // --- Witnesses and heat ----------------------------------------------
  function witnesses(v) {
    let cop = false, civ = false;
    const pol = game.police;
    if (pol) {
      const cars = pol.cars || [];
      for (let i = 0; i < cars.length && !cop; i++) {
        const c = cars[i];
        if (c === v || c.removed || c.wrecked) continue;
        const dx = c.x - v.x, dz = c.z - v.z;
        if (dx * dx + dz * dz < WITNESS_COP * WITNESS_COP) cop = true;
      }
      const offs = pol.officers || [];
      for (let i = 0; i < offs.length && !cop; i++) {
        const o = offs[i];
        if (!o.active) continue;
        const dx = o.x - v.x, dz = o.z - v.z;
        if (dx * dx + dz * dz < WITNESS_COP * WITNESS_COP) cop = true;
      }
    }
    const acts = game.actors || [];
    for (let i = 0; i < acts.length && !civ; i++) {
      const a = acts[i];
      if (a === victim || a.team !== 'civ' || a.life !== 'ok') continue;
      const dx = a.x - v.x, dz = a.z - v.z;
      if (dx * dx + dz * dz < WITNESS_CIV * WITNESS_CIV) civ = true;
    }
    return { cop, civ };
  }

  function addHeat(v, team) {
    const pol = game.police;
    const st = game.progress && game.progress.settings;
    if (!pol || !pol.heat || (st && st.police === false)) return;
    const w = witnesses(v);
    const add = jackHeat(team, w.cop, w.civ);
    if (add > 0) {
      pol.heat.points = Math.min(1.5, pol.heat.points + add);
      pol.heat.calm = 0;
    }
  }

  // --- Starting a jack --------------------------------------------------
  // Returns true when the sequence began.
  function start(v) {
    const p = game.player;
    const w = p.walker;
    if (jack || p.vehicle || !w || (w.life && w.life !== 'ok') || !canJack(v)) return false;
    exitPosition(v, world(), EXIT);
    if (!EXIT.ok) {
      if (game.hud && game.hud.toast) game.hud.toast('No room to get out here', 1.5);
      return false;
    }
    const c = Math.cos(v.heading), s = Math.sin(v.heading);
    const dx = EXIT.x, dz = EXIT.z;
    // The player waits a little ahead of the door, the driver lands behind it.
    let px = dx + c * 0.7, pz = dz + s * 0.7;
    let lx = dx - c * 0.9, lz = dz - s * 0.9;
    if (!clearSpot(px, pz)) {
      px = dx;
      pz = dz;
    }
    if (!clearSpot(lx, lz)) {
      lx = dx;
      lz = dz;
    }
    const sx = v.x + (dx - v.x) * 0.3, sz = v.z + (dz - v.z) * 0.3;
    jack = createJack(v, px, pz, sx, sz, lx, lz);
    jack.team = occupantTeam(v);
    jack.dist = Math.hypot(px - w.x, pz - w.z);
    victim = null;
    p.near = null;
    return true;
  }

  function holdCar(v) {
    let c = v.controls;
    if (!c) c = v.controls = { steer: 0, throttle: 0, brake: 1, handbrake: true };
    c.steer = NO_CONTROLS.steer;
    c.throttle = 0;
    c.brake = 1;
    c.handbrake = true;
  }

  function onOpen() {
    const v = jack.car;
    DOOR.car = v;
    v.doorOpen = 1;
    emit('carDoor', DOOR);
    // Crew cars: the gang members inside are real actors; the crew system
    // pulls them out and has them fight once the player is in.
    if (jack.team !== 'crew') victim = makeVictim(v, jack.team);
  }

  function onThrow() {
    const v = jack.car;
    const a = victim;
    if (a) {
      a.cj.phase = 'down';
      a.cj.t = 0;
      a.life = 'down';
      a.lifeT = 0;
      a.y = 0;
      a.vx = a.vz = 0;
      // Slide to the landing spot: v^2 / (2 decel) = distance.
      const dx = jack.land.x - a.x, dz = jack.land.z - a.z;
      const d = Math.hypot(dx, dz);
      if (d > 0.05) {
        const sp = Math.sqrt(2 * KNOCK_DECAY * d);
        a.kx = (dx / d) * sp;
        a.kz = (dz / d) * sp;
      }
      a.heading = Math.atan2(dz, dx);
      DOWN.target = a;
      emit('down', DOWN);
      DOWN.target = null;
    }
    CJ.car = v;
    CJ.victim = a;
    CJ.thief = game.player;
    emit('carjack', CJ);
    CJ.car = CJ.victim = CJ.thief = null;
    addHeat(v, jack.team);
    // Traffic: this driver is gone; do not spawn a second runner later.
    if (jack.team === 'civ' && v.ai) v.ai.dead = true;
    v.doorOpen = 1;
  }

  function finish(entered) {
    const v = jack.car;
    v.doorOpen = 0;
    if (entered) game.enterVehicle(v);
    if (victim && victim.cj.phase === 'drag') victim.cj.phase = 'down';
    jack = null;
    victim = null;
  }

  // The player's whole step while a jack runs (replaces stepWalker).
  function stepPlayer(dt) {
    const p = game.player, w = p.walker, j = jack;
    if (!j) return;
    const ok = !w.life || w.life === 'ok';
    // Run to the door.
    let dist = 0;
    if (j.phase === 'approach') {
      const dx = j.door.x - w.x, dz = j.door.z - w.z;
      dist = Math.hypot(dx, dz);
      if (dist > 0.05) {
        const step = Math.min(dist, JACK.WALK * dt);
        let nx = w.x + (dx / dist) * step, nz = w.z + (dz / dist) * step;
        if (game.collision) {
          const r = game.collision.resolveCircle(nx, nz, w.radius, 0);
          nx = r.x;
          nz = r.z;
        }
        const moved = Math.hypot(nx - w.x, nz - w.z);
        w.x = nx;
        w.z = nz;
        w.speed = dt > 0 ? moved / dt : 0;
        w.vx = dt > 0 ? (dx / dist) * w.speed : 0;
        w.vz = dt > 0 ? (dz / dist) * w.speed : 0;
        w.moving = w.speed > 0.2;
        w.stride = (w.stride + (moved / 1.5) * Math.PI * 2) % (Math.PI * 2);
        const want = Math.atan2(dz, dx);
        w.heading = angleDiff(w.heading + angleDiff(want, w.heading) * Math.min(1, 14 * dt), 0);
      }
    } else {
      w.vx = w.vz = w.speed = 0;
      w.moving = false;
      const want = Math.atan2(j.car.z - w.z, j.car.x - w.x);
      w.heading = angleDiff(w.heading + angleDiff(want, w.heading) * Math.min(1, 14 * dt), 0);
    }
    const ev = stepJack(j, dt, dist, ok);
    if (ev === 'open') onOpen();
    else if (ev === 'throw') onThrow();
    else if (ev === 'enter') finish(true);
    else if (ev === 'abort') finish(false);
    // Driver follows the drag.
    if (jack && victim && victim.cj.phase === 'drag' && j.phase !== 'open') {
      dragPose(j, POSE);
      victim.px = victim.x;
      victim.pz = victim.z;
      victim.x = POSE.x;
      victim.z = POSE.z;
      victim.y = POSE.y;
      victim.heading = j.car.heading + 2.4 * j.drag;
    }
  }

  return {
    name: 'carjack',
    victims,
    start,
    stepPlayer,
    canJack,
    isOccupied,
    get busy() { return !!jack; },
    cancel() { if (jack) finish(false); },
    get jack() { return jack; },
    // For the ENTER prompt and the foot-search filter.
    canEnter: (v) => !isOccupied(v) || canJack(v),
    fixedUpdate(dt) {
      if (jack && jack.car) holdCar(jack.car);
      const p = game.player;
      THREAT.x = p.x;
      THREAT.z = p.z;
      for (let i = victims.length - 1; i >= 0; i--) {
        const a = victims[i];
        if (a.cj.phase !== 'drag') {
          a.px = a.x;
          a.pz = a.z;
          a.pheading = a.heading;
        }
        const ph = stepVictim(a.cj, a, dt, THREAT, resolve);
        if (ph === 'gone') retire(a);
      }
    },
    render(alpha) {
      for (let i = 0; i < victims.length; i++) {
        const a = victims[i];
        if (a.cj.phase === 'drag' && (!jack || jack.phase === 'open' || jack.phase === 'approach')) {
          if (a.mesh) a.mesh.visible = false;
          continue;
        }
        const m = meshFor(a);
        if (!m) continue;
        m.visible = true;
        updatePersonMesh(m, a, alpha);
        if (a.life !== 'ok') layDown(m, a);
        else if (m.rotation.z !== 0) m.rotation.z = 0;
      }
    },
  };
}
