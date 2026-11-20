// Carjacking rules and the timeline of one jack. Pure logic (no three.js,
// no DOM): the system in systems/carjack.js owns the actors and meshes.
//
// Timeline, in seconds after the player reaches the door:
//   0.00 open   the door swings open
//   0.20 drag   the driver lurches out of the seat toward the door
//   0.50 throw  the driver is thrown to the ground (one-shot event)
//   0.70 enter  the player takes the seat (one-shot event)
// Before that the player runs to the door ('approach', at most 3 s).
import { clamp } from './rng.js';

export const JACK = {
  MAX_SPEED: 3, // m/s: a car faster than this cannot be entered on foot
  ABORT_SPEED: 5, // an approached car that speeds up past this is lost
  REACH: 0.7, // m from the door spot counts as arrived
  APPROACH_MAX: 3, // s
  OPEN_T: 0.2,
  THROW_AT: 0.5,
  ENTER_AT: 0.7,
  WALK: 5.5, // m/s while running to the door
  LIE_T: 1.6, // combat's DOWN_T, for documentation and tests
};

export const PHASES = ['approach', 'open', 'drag', 'thrown', 'done', 'aborted'];

// Is somebody (not the player) sitting at the controls?
export function isOccupied(v) {
  return !!(v && v.driver && v.driver !== 'player');
}

const JACKABLE_KINDS = { car: true, boat: true, plane: true, heli: true };

// Can the player on foot take over this occupied craft right now?
export function canJack(v) {
  if (!isOccupied(v) || v.wrecked || v.removed) return false;
  if (!JACKABLE_KINDS[v.kind]) return false;
  if (!(Math.abs(v.speed) < JACK.MAX_SPEED)) return false;
  if (!((v.y || 0) < 1.5)) return false;
  return true;
}

// 'police', 'crew' or 'civ': who is sitting in the craft.
export function occupantTeam(v) {
  if (v.occupantTeam) return v.occupantTeam;
  if (v.police || v.cop || (v.spec && v.spec.police)) return 'police';
  if (v.crewGroup || v.crewAI) return 'crew';
  return 'civ';
}

// Heat points a jack adds. `cop` and `civ` say who saw it. Small for a
// civilian, big for a police car, little for a crew car.
export function jackHeat(team, cop, civ) {
  if (team === 'police') return 1.5;
  if (team === 'crew') return cop ? 0.3 : 0;
  if (cop) return 0.6;
  return civ ? 0.3 : 0;
}

export function createJack(car, doorX, doorZ, seatX, seatZ, landX, landZ) {
  return {
    phase: 'approach',
    t: 0, // seconds since the door opened (or since the run began)
    car,
    door: { x: doorX, z: doorZ }, // where the player stands
    seat: { x: seatX, z: seatZ }, // where the driver sits
    land: { x: landX, z: landZ }, // where the driver ends up on the ground
    open: 0, // door angle, 0..1
    drag: 0, // driver progress from seat to door, 0..1
  };
}

const ease = (k) => k * k * (3 - 2 * k);

// Advance the jack. `dist` is how far the player still is from the door.
// `ok` is false when the player was knocked down. Returns the one-shot
// event that happened this step: 'open', 'throw', 'enter', 'abort', or null.
export function stepJack(j, dt, dist, ok = true) {
  if (j.phase === 'done' || j.phase === 'aborted') return null;
  const v = j.car;
  if (!v || v.removed || v.wrecked) {
    j.phase = 'aborted';
    return 'abort';
  }
  j.t += dt;
  if (j.phase === 'approach') {
    if (!ok || !isOccupied(v) || Math.abs(v.speed || 0) > JACK.ABORT_SPEED) {
      j.phase = 'aborted';
      return 'abort';
    }
    if (dist <= JACK.REACH || j.t >= JACK.APPROACH_MAX) {
      j.phase = 'open';
      j.t = 0;
      return 'open';
    }
    return null;
  }
  j.open = clamp(j.t / JACK.OPEN_T, 0, 1);
  j.drag = ease(clamp((j.t - JACK.OPEN_T) / (JACK.THROW_AT - JACK.OPEN_T), 0, 1));
  if (j.phase === 'open') {
    if (j.t >= JACK.OPEN_T) j.phase = 'drag';
    return null;
  }
  if (j.phase === 'drag') {
    if (j.t >= JACK.THROW_AT) {
      j.phase = 'thrown';
      return 'throw';
    }
    return null;
  }
  // thrown: wait for the player to climb in.
  if (j.t >= JACK.ENTER_AT) {
    j.phase = ok ? 'done' : 'aborted';
    return ok ? 'enter' : 'abort';
  }
  return null;
}

// Where the driver is while being dragged: seat -> door, with a lurch
// (a small hop). Writes x, z, y to out.
export function dragPose(j, out) {
  const k = j.drag;
  out.x = j.seat.x + (j.door.x - j.seat.x) * k * 0.7;
  out.z = j.seat.z + (j.door.z - j.seat.z) * k * 0.7;
  out.y = Math.sin(k * Math.PI) * 0.18;
  return out;
}

// --- The victim after the throw ---------------------------------------
export const FLEE = { SPEED: 5.6, TIME: 14, FAR: 70, FADE_T: 1 };

// Starts the flee state on a victim record `cj`.
export function createVictimState(team) {
  return { phase: 'drag', team, t: 0, fleeT: 0, fdx: 1, fdz: 0, blocked: 0, dir: 1 };
}

// One step of the victim's own brain. `a` is the actor (life, x, z,
// heading, speed...), `threat` the position to run from. `resolve(x, z, r)`
// returns the collision-corrected point as { x, z } (or null for none).
// Returns the new phase: 'down' | 'flee' | 'fade' | 'gone'.
export function stepVictim(cj, a, dt, threat, resolve) {
  cj.t += dt;
  if (cj.phase === 'drag') return cj.phase;
  if (a.hp <= 0 || a.life === 'out') {
    cj.phase = a.fade >= 1 ? 'gone' : 'dead';
    return cj.phase;
  }
  if (cj.phase === 'down') {
    if (a.life === 'ok') {
      cj.phase = 'flee';
      cj.fleeT = 0;
      let dx = a.x - threat.x, dz = a.z - threat.z;
      const d = Math.hypot(dx, dz) || 1;
      dx /= d;
      dz /= d;
      cj.fdx = dx;
      cj.fdz = dz;
    }
    return cj.phase;
  }
  if (cj.phase === 'flee') {
    if (a.life !== 'ok') {
      a.speed = 0;
      a.moving = false;
      return cj.phase; // knocked down again: combat has them
    }
    cj.fleeT += dt;
    const far = Math.hypot(a.x - threat.x, a.z - threat.z);
    if (cj.fleeT > FLEE.TIME || far > FLEE.FAR) {
      cj.phase = 'fade';
      cj.t = 0;
      a.speed = 0;
      a.moving = false;
      return cj.phase;
    }
    const sp = FLEE.SPEED;
    const ox = a.x, oz = a.z;
    let nx = ox + cj.fdx * sp * dt, nz = oz + cj.fdz * sp * dt;
    if (resolve) {
      const r = resolve(nx, nz, a.radius || 0.35);
      if (r) {
        nx = r.x;
        nz = r.z;
      }
    }
    if (!Number.isFinite(nx) || !Number.isFinite(nz)) {
      nx = ox;
      nz = oz;
    }
    const moved = Math.hypot(nx - ox, nz - oz);
    if (moved < sp * dt * 0.3) {
      // Blocked: turn a quarter away and keep running.
      const t = cj.fdx;
      cj.fdx = -cj.fdz * cj.dir;
      cj.fdz = t * cj.dir;
    }
    a.x = nx;
    a.z = nz;
    a.speed = dt > 0 ? moved / dt : 0;
    a.moving = a.speed > 0.2;
    a.stride = ((a.stride || 0) + (moved / 1.5) * Math.PI * 2) % (Math.PI * 2);
    if (moved > 1e-4) a.heading = Math.atan2(nz - oz, nx - ox);
    return cj.phase;
  }
  if (cj.phase === 'fade') {
    a.fade = clamp(cj.t / FLEE.FADE_T, 0, 1);
    if (a.fade >= 1) cj.phase = 'gone';
    return cj.phase;
  }
  if (cj.phase === 'dead') {
    if (a.fade >= 1) cj.phase = 'gone';
    return cj.phase;
  }
  return cj.phase;
}
