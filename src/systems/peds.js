// Pedestrians: townsfolk who stroll the pavements, chat, jog in parks
// and try to jump clear of anything coming their way. They are combat
// actors (team 'civ'): a hit or a car at speed knocks them down
// (cartoon style, no gore), and they run from gunfire and blasts.
//
// The first half of this file is a pure core (createPed / stepPed) that
// runs in node tests. The second half is the game system that spawns,
// recycles and draws them.
import { angleDiff, clamp, TAU } from '../core/rng.js';
import { createPersonMesh, updatePersonMesh, PERSON_PALETTES } from '../render/personmesh.js';
import { asideNeed, collectSirens, ASIDE_WALK, ASIDE_HOLD } from '../core/yield.js';
import { initActor, resetActor, addActor, removeActor, layDown } from './combat.js';

const INSET = 2; // walking line, metres inside the block edge
const RADIUS = 0.35;
const STRIDE_LEN = 1.5;
const FLEE_SPEED = 7;
const LOOKAHEAD_T = 1.2; // seconds
const THREAT_DIST = 3.5; // metres (plus a share of the craft's size)
const HYSTERESIS = 1.5;
const MOVING = 3; // m/s: faster craft are dodged, slower ones sidestepped

// Scratch results (no allocation per step).
const PT = { x: 0, z: 0 };
const TH = { found: false, dx: 0, dz: 0, ox: 0, oz: 0, thr: 0 };
const AS = { active: false, need: 0, dx: 0, dz: 0 };

// ---------------------------------------------------------------------
// Loop geometry
// ---------------------------------------------------------------------
function loopDims(b) {
  const w = b.x1 - b.x0 - INSET * 2;
  const h = b.z1 - b.z0 - INSET * 2;
  return { w, h, p: 2 * (w + h) };
}

// Point on the walking rectangle at arc length s (clockwise as seen on a
// map with x east, z south). Writes to PT.
function pointAt(b, s) {
  const w = b.x1 - b.x0 - INSET * 2, h = b.z1 - b.z0 - INSET * 2;
  const p = 2 * (w + h);
  s %= p;
  if (s < 0) s += p;
  const x0 = b.x0 + INSET, z0 = b.z0 + INSET, x1 = b.x1 - INSET, z1 = b.z1 - INSET;
  if (s < w) { PT.x = x0 + s; PT.z = z0; }
  else if (s < w + h) { PT.x = x1; PT.z = z0 + (s - w); }
  else if (s < 2 * w + h) { PT.x = x1 - (s - w - h); PT.z = z1; }
  else { PT.x = x0; PT.z = z1 - (s - 2 * w - h); }
  return PT;
}

// Arc length of the loop point nearest to (x, z).
function nearestS(b, x, z) {
  const x0 = b.x0 + INSET, z0 = b.z0 + INSET, x1 = b.x1 - INSET, z1 = b.z1 - INSET;
  const w = x1 - x0, h = z1 - z0;
  const cx = clamp(x, x0, x1), cz = clamp(z, z0, z1);
  const dT = cz - z0, dB = z1 - cz, dL = cx - x0, dR = x1 - cx;
  const m = Math.min(dT, dB, dL, dR);
  if (m === dT) return cx - x0;
  if (m === dR) return w + (cz - z0);
  if (m === dB) return w + h + (x1 - cx);
  return 2 * w + h + (z1 - cz);
}

// ---------------------------------------------------------------------
// Creation and placement
// ---------------------------------------------------------------------
export const PANIC_T = 6; // seconds a ped runs from gunfire or a blast
export const SHOT_SCARE = 40, DOWN_SCARE = 25; // metres

export function createPed(rng) {
  const ped = {
    rng,
    active: false,
    state: 'walking', // walking | jogging | paused | chatting | fleeing
    kind: 'loop', // loop | jog | chat
    startled: false,
    x: 0, z: 0, y: 0, heading: 0,
    px: 0, pz: 0, pheading: 0,
    vx: 0, vz: 0, speed: 0, moving: false, stride: 0,
    radius: RADIUS,
    block: null,
    s: 0, travel: 0, dir: rng.chance(0.5) ? 1 : -1,
    pace: rng.range(1.1, 1.7),
    jogPace: rng.range(2.4, 3.2),
    tx: 0, tz: 0,
    nextPause: rng.range(6, 22),
    timer: 0, // pause / chat time left
    fleeT: 0, fdx: 0, fdz: 0, fleeSpeed: FLEE_SPEED,
    stuckT: 0,
    panicT: 0, // running away from gunfire (seconds left)
    asideT: 0, atx: 0, atz: 0, // stepping off the road for a siren vehicle (src/core/yield.js)
  };
  return initActor(ped, 'civ');
}

// Run away from (x, z) for `time` seconds (gunfire, someone downed).
export function scarePed(ped, x, z, time = PANIC_T) {
  if (!ped.active || (ped.life && ped.life !== 'ok')) return false;
  let dx = ped.x - x, dz = ped.z - z;
  const d = Math.sqrt(dx * dx + dz * dz);
  if (d > 1e-3) {
    dx /= d;
    dz /= d;
  } else {
    dx = Math.cos(ped.heading);
    dz = Math.sin(ped.heading);
  }
  ped.panicT = Math.max(ped.panicT, time);
  ped.fdx = dx;
  ped.fdz = dz;
  ped.fleeSpeed = FLEE_SPEED - ped.rng.next() * 1.5;
  ped.state = 'fleeing';
  ped.fleeT = 0;
  ped.timer = 0;
  return true;
}

function setPos(ped, x, z) {
  ped.x = ped.px = x;
  ped.z = ped.pz = z;
  ped.vx = ped.vz = ped.speed = 0;
  ped.moving = false;
  ped.startled = false;
  ped.fleeT = 0;
  ped.stuckT = 0;
  ped.panicT = 0;
  resetActor(ped);
}

function pickJogTarget(ped) {
  const b = ped.block, r = ped.rng;
  ped.tx = r.range(b.x0 + 6, b.x1 - 6);
  ped.tz = r.range(b.z0 + 6, b.z1 - 6);
}

// Put a ped on a block. kind: 'loop' (default), 'jog' (inside the block,
// meant for parks) or 'chat' (standing still on the loop).
export function placePed(ped, block, rng = ped.rng, kind = 'loop') {
  ped.block = block;
  ped.active = true;
  ped.kind = kind;
  ped.travel = 0;
  ped.timer = 0;
  if (kind === 'jog') {
    ped.state = 'jogging';
    const x = rng.range(block.x0 + 6, block.x1 - 6), z = rng.range(block.z0 + 6, block.z1 - 6);
    setPos(ped, x, z);
    pickJogTarget(ped);
    ped.heading = ped.pheading = Math.atan2(ped.tz - z, ped.tx - x);
    return ped;
  }
  const { p } = loopDims(block);
  ped.s = rng.range(0, p);
  const q = pointAt(block, ped.s);
  setPos(ped, q.x, q.z);
  ped.state = kind === 'chat' ? 'chatting' : 'walking';
  if (kind === 'chat') ped.timer = rng.range(15, 45);
  const a = pointAt(block, ped.s + ped.dir * 2);
  ped.heading = ped.pheading = Math.atan2(a.z - q.z, a.x - q.x);
  return ped;
}

// Stand `b` next to the chatting ped `a`, the two facing each other.
export function pairWith(a, b) {
  const block = a.block;
  placePed(b, block, a.rng, 'chat');
  const q = pointAt(block, a.s + 0.5);
  const dx = q.x - a.x, dz = q.z - a.z;
  const l = Math.hypot(dx, dz) || 1;
  const ux = dx / l, uz = dz / l; // along the pavement
  b.s = a.s;
  b.timer = a.timer;
  setPos(b, a.x + ux * 0.9, a.z + uz * 0.9);
  a.heading = a.pheading = Math.atan2(uz, ux);
  b.heading = b.pheading = Math.atan2(-uz, -ux);
  return b;
}

// ---------------------------------------------------------------------
// Threat detection
// ---------------------------------------------------------------------
// Finds a moving craft that will pass within `extra + threshold` of the
// ped in the next LOOKAHEAD_T seconds. Result in TH.
function scanThreat(ped, vehicles, extra) {
  TH.found = false;
  if (!vehicles) return;
  const px = ped.x, pz = ped.z;
  let best = Infinity;
  for (let i = 0; i < vehicles.length; i++) {
    const c = vehicles[i];
    if (!c || c.wrecked || c.y > 3) continue;
    const rx = px - c.x, rz = pz - c.z;
    if (rx > 50 || rx < -50 || rz > 50 || rz < -50) continue;
    const vx = c.vx, vz = c.vz;
    const sp2 = vx * vx + vz * vz;
    if (!(sp2 > MOVING * MOVING)) continue;
    let t = (rx * vx + rz * vz) / sp2;
    if (t < 0) t = 0;
    else if (t > LOOKAHEAD_T) t = LOOKAHEAD_T;
    const dx = rx - vx * t, dz = rz - vz * t;
    const d = Math.sqrt(dx * dx + dz * dz);
    const thr = THREAT_DIST + (c.radius || 2) * 0.4 + extra;
    if (d >= thr) continue;
    if (t < best) {
      best = t;
      const sp = Math.sqrt(sp2);
      TH.found = true;
      TH.thr = thr;
      // Unit normal to the craft's path, and the ped's offset along it.
      TH.dx = -vz / sp;
      TH.dz = vx / sp;
      TH.ox = rx * TH.dx + rz * TH.dz;
      TH.oz = d;
    }
  }
}

function startFlee(ped, ctx) {
  const { city, collision } = ctx;
  // Choose the side to jump: natural side of the path, not into a wall,
  // not onto the road if the pavement is free.
  let bestSide = 1, bestScore = -Infinity;
  for (let k = 0; k < 2; k++) {
    const side = k === 0 ? 1 : -1;
    const x = ped.x + TH.dx * side * 2.6, z = ped.z + TH.dz * side * 2.6;
    let score = TH.ox * side > 0.4 ? 0.5 : 0;
    if (collision && collision.resolveCircle(x, z, RADIUS, 0).hit) score -= 10;
    if (city && city.isGround && !city.isGround(x, z)) score -= 10;
    if (city && city.onRoad && city.onRoad(x, z)) score -= 1;
    if (score > bestScore) { bestScore = score; bestSide = side; }
  }
  ped.fdx = TH.dx * bestSide;
  ped.fdz = TH.dz * bestSide;
  ped.fleeSpeed = FLEE_SPEED - ped.rng.next();
  ped.state = 'fleeing';
  ped.fleeT = 0;
  ped.startled = true;
  ped.timer = 0;
}

function resumeWalking(ped) {
  if (ped.kind === 'jog') {
    ped.state = 'jogging';
    return;
  }
  ped.kind = 'loop';
  ped.state = 'walking';
  ped.s = nearestS(ped.block, ped.x, ped.z);
}

// ---------------------------------------------------------------------
// Step
// ---------------------------------------------------------------------
export function stepPed(ped, dt, ctx) {
  ped.px = ped.x;
  ped.pz = ped.z;
  ped.pheading = ped.heading;
  ped.startled = false;
  if (!ped.active || !(dt > 0)) return ped;
  // Knocked down, out or getting up: combat moves them, not their legs.
  if (ped.life && ped.life !== 'ok') {
    ped.vx = ped.vz = ped.speed = 0;
    ped.moving = false;
    return ped;
  }
  const { city, collision, vehicles, player } = ctx;

  // --- Decide what to do. ---
  if (ped.panicT > 0) {
    ped.panicT -= dt;
    ped.state = 'fleeing';
    if (ped.panicT <= 0) {
      ped.panicT = 0;
      resumeWalking(ped);
    }
  } else if (ped.state === 'fleeing') {
    ped.fleeT += dt;
    scanThreat(ped, vehicles, HYSTERESIS);
    if (!TH.found && ped.fleeT > 0.4) resumeWalking(ped);
  } else {
    scanThreat(ped, vehicles, 0);
    if (TH.found) startFlee(ped, ctx);
  }

  // A siren vehicle coming up the road: step to the kerb side and wait.
  // This is not a scare: no panic, no heat, nobody runs into traffic.
  if (ped.asideT > 0) ped.asideT -= dt;
  const sirens = ctx.sirens;
  if (sirens && sirens.length && ped.panicT <= 0 && ped.state !== 'fleeing') {
    for (let i = 0; i < sirens.length; i++) {
      if (!asideNeed(ped, sirens[i], AS)) continue;
      const was = ped.asideT > 0;
      ped.asideT = ASIDE_HOLD;
      if (AS.need > 0) {
        ped.atx = ped.x + AS.dx * (AS.need + 0.3);
        ped.atz = ped.z + AS.dz * (AS.need + 0.3);
      } else if (!was) {
        ped.atx = ped.x;
        ped.atz = ped.z;
      }
    }
  }

  // --- Wanted velocity. ---
  let wvx = 0, wvz = 0, accel = 8;
  const st = ped.state;
  if (st === 'fleeing' && ped.panicT > 0) {
    accel = 12;
    // Running from gunfire: away from the source, sliding along walls.
    wvx = ped.fdx * ped.fleeSpeed;
    wvz = ped.fdz * ped.fleeSpeed;
    if (ped.speed < 1 && ped.fleeT > 0.3) {
      // Blocked: turn a quarter away and keep going.
      const t = ped.fdx;
      ped.fdx = -ped.fdz * ped.dir;
      ped.fdz = t * ped.dir;
      ped.fleeT = 0;
    }
    ped.fleeT += dt;
  } else if (st === 'fleeing') {
    accel = 40;
    // Keep jumping until clear of the path; then stand still.
    scanThreat(ped, vehicles, 0);
    if (TH.found) {
      wvx = ped.fdx * ped.fleeSpeed;
      wvz = ped.fdz * ped.fleeSpeed;
    }
  } else if (st === 'paused' || st === 'chatting') {
    ped.timer -= dt;
    if (ped.timer <= 0) {
      if (st === 'chatting') resumeWalking(ped);
      else ped.state = ped.kind === 'jog' ? 'jogging' : 'walking';
    }
  } else {
    let tx, tz, pace;
    if (st === 'jogging') {
      tx = ped.tx;
      tz = ped.tz;
      pace = ped.jogPace;
      if ((tx - ped.x) * (tx - ped.x) + (tz - ped.z) * (tz - ped.z) < 1.44) {
        pickJogTarget(ped);
        tx = ped.tx;
        tz = ped.tz;
      }
    } else {
      pace = ped.pace;
      const q = pointAt(ped.block, ped.s);
      tx = q.x;
      tz = q.z;
      const ex = tx - ped.x, ez = tz - ped.z;
      if (ex * ex + ez * ez < 1) {
        // Close enough to the carrot: it moves on.
        ped.s += ped.dir * pace * dt;
        ped.travel += pace * dt;
      }
      ped.nextPause -= dt;
      if (ped.nextPause <= 0) {
        ped.nextPause = ped.rng.range(8, 25);
        ped.state = 'paused';
        ped.timer = ped.rng.range(1.5, 5);
      }
    }
    const ex = tx - ped.x, ez = tz - ped.z;
    const d = Math.sqrt(ex * ex + ez * ez);
    if (d > 0.05) {
      const sp = d < 0.3 ? pace * (d / 0.3) : pace;
      wvx = (ex / d) * sp;
      wvz = (ez / d) * sp;
    }
    // Stuck behind something? Skip the target ahead (or choose another).
    if (ped.speed < pace * 0.3) {
      ped.stuckT += dt;
      if (ped.stuckT > 1.2) {
        ped.stuckT = 0;
        if (st === 'jogging') pickJogTarget(ped);
        else ped.s += ped.dir * 3;
      }
    } else ped.stuckT = 0;
  }

  if (ped.asideT > 0 && st !== 'fleeing') {
    const ex = ped.atx - ped.x, ez = ped.atz - ped.z;
    const d = Math.sqrt(ex * ex + ez * ez);
    accel = 12;
    wvx = wvz = 0;
    if (d > 0.1) {
      wvx = (ex / d) * ASIDE_WALK;
      wvz = (ez / d) * ASIDE_WALK;
    }
  }

  // --- Move. ---
  const k = Math.min(1, accel * dt);
  ped.vx += (wvx - ped.vx) * k;
  ped.vz += (wvz - ped.vz) * k;
  const ox = ped.x, oz = ped.z;
  let nx = ox + ped.vx * dt, nz = oz + ped.vz * dt;

  // Step out of the way of the player on foot.
  if (player && !player.vehicle && !(player.y > 2)) {
    const ex = nx - player.x, ez = nz - player.z;
    const rr = 1.0;
    const d2 = ex * ex + ez * ez;
    if (d2 < rr * rr) {
      const d = Math.sqrt(d2);
      const push = Math.min(rr - d, 3 * dt);
      if (d > 1e-6) {
        nx += (ex / d) * push;
        nz += (ez / d) * push;
      } else nx += push;
    }
  }

  // Craft bodies: never stand inside one. Slow ones push gently, fast
  // ones (a last resort, the dodge should have worked) at once.
  if (vehicles) {
    for (let i = 0; i < vehicles.length; i++) {
      const c = vehicles[i];
      if (!c || c.y > 3) continue;
      const ex = nx - c.x, ez = nz - c.z;
      if (ex > 12 || ex < -12 || ez > 12 || ez < -12) continue;
      const rr = (c.radius || 2) * 0.6 + RADIUS;
      const d2 = ex * ex + ez * ez;
      if (d2 >= rr * rr) continue;
      const d = Math.sqrt(d2);
      const fast = c.vx * c.vx + c.vz * c.vz > MOVING * MOVING;
      const push = fast ? rr - d : Math.min(rr - d, 5 * dt);
      if (d > 1e-6) {
        // Remember a hard hit for combat (closing speed along the push).
        const closing = ((c.vx || 0) - ped.vx) * (ex / d) + ((c.vz || 0) - ped.vz) * (ez / d);
        if (closing > (ped.bumpV || 0)) {
          ped.bumpBy = c;
          ped.bumpV = closing;
        }
        nx += (ex / d) * push;
        nz += (ez / d) * push;
      } else nx += push;
    }
  }

  // Buildings and trees.
  if (collision) {
    const r = collision.resolveCircle(nx, nz, RADIUS, 0);
    nx = r.x;
    nz = r.z;
  }
  // Stay on the island.
  if (city && city.isGround && !city.isGround(nx, nz) && city.isGround(ox, oz)) {
    nx = ox;
    nz = oz;
  }
  if (!Number.isFinite(nx) || !Number.isFinite(nz)) {
    nx = ox;
    nz = oz;
    ped.vx = ped.vz = 0;
  }
  ped.x = nx;
  ped.z = nz;

  const dist = Math.hypot(nx - ox, nz - oz);
  ped.speed = dist / dt;
  ped.moving = ped.speed > 0.2;
  ped.vx = (nx - ox) / dt;
  ped.vz = (nz - oz) / dt;
  ped.stride = (ped.stride + (dist / STRIDE_LEN) * TAU) % TAU;
  if (ped.speed > 0.3) {
    const want = Math.atan2(nz - oz, nx - ox);
    ped.heading = angleDiff(ped.heading + angleDiff(want, ped.heading) * Math.min(1, 10 * dt), 0);
  }
  return ped;
}

// ---------------------------------------------------------------------
// System
// ---------------------------------------------------------------------
// How busy each kind of place is through the day (hour 0..23, linear
// between hours): town centres peak at lunch and in the evening, beach
// and parks in the afternoon, homes in the morning and evening, docks
// and works in working hours (docs/PLAN_V1.md W8).
const PROFILES = {
  city: [0.1, 0.08, 0.06, 0.05, 0.06, 0.1, 0.25, 0.5, 0.75, 0.8, 0.85, 0.95, 1, 1, 1, 0.95, 0.95, 1, 0.95, 0.85, 0.7, 0.55, 0.35, 0.2],
  leisure: [0.03, 0.02, 0.02, 0.02, 0.03, 0.08, 0.2, 0.35, 0.5, 0.7, 0.9, 1, 1, 1, 1, 1, 0.95, 0.85, 0.7, 0.5, 0.3, 0.15, 0.08, 0.05],
  home: [0.05, 0.03, 0.03, 0.03, 0.05, 0.15, 0.4, 0.7, 0.6, 0.45, 0.45, 0.5, 0.55, 0.55, 0.5, 0.5, 0.6, 0.8, 0.85, 0.8, 0.6, 0.35, 0.15, 0.08],
  work: [0.03, 0.03, 0.03, 0.03, 0.05, 0.2, 0.5, 0.85, 0.95, 0.95, 0.95, 0.8, 0.8, 0.95, 0.95, 0.9, 0.7, 0.4, 0.2, 0.1, 0.05, 0.04, 0.03, 0.03],
};
const PROFILE_OF = {
  downtown: PROFILES.city, midtown: PROFILES.city, beach: PROFILES.leisure, park: PROFILES.leisure,
  residential: PROFILES.home, docks: PROFILES.work, industrial: PROFILES.work,
};
// Walkers per 100 m of pavement loop at the busiest hour.
export const DENSITY = {
  downtown: 2.4, midtown: 1.8, beach: 2.2, park: 1.6, residential: 0.9, docks: 0.4, industrial: 0.3, airfield: 0,
};
const BLOCK_MAX = 10; // most walkers on one block or plaza
export function crowdAt(district, clock) {
  const prof = PROFILE_OF[district];
  if (!prof) return 0;
  const h = (((clock % 24) + 24) % 24);
  const i = Math.floor(h), f = h - i;
  return prof[i] + (prof[(i + 1) % 24] - prof[i]) * f;
}
// Walkers a block or plaza holds at this hour.
export function blockCapacity(b, clock) {
  const d = DENSITY[b.district] || 0;
  if (!(d > 0)) return 0;
  const per = 2 * (b.x1 - b.x0 + b.z1 - b.z0 - INSET * 4);
  return Math.min(BLOCK_MAX, Math.round((per / 100) * d * crowdAt(b.district, clock)));
}
const NEAR = 25, FAR = 110, RECYCLE = 150;
const NEAR_FIRST = 8, FAR_FIRST = 80; // first fill and after a jump: people close around the camera
const JUMP = 150; // m moved between two scans that counts as a teleport
const SKY = 120; // above this altitude nobody is simulated
const SEA = -150; // this far out at sea nobody is simulated
const CELL = 128;
const LOT_WALK = new Set(['plaza', 'park', 'grass', 'beach']);

// Walkable places: the city blocks plus plazas, parks and lawns from the
// lot list (real maps), each with the same x0..z1 / district / id fields
// a block has. Indexed by a coarse grid so a scan only looks near.
function buildAreas(city) {
  const areas = city.blocks.slice();
  const lots = city.lots;
  if (lots && lots.length) {
    for (let i = 0; i < lots.length; i++) {
      const l = lots[i];
      if (!LOT_WALK.has(l.type) || l.area < 300 || !l.core) continue;
      const w = l.x1 - l.x0, h = l.z1 - l.z0;
      if (Math.min(w, h) < 14 || Math.max(w, h) > 340 || l.area < w * h * 0.15) continue;
      const district = l.type === 'park' || l.type === 'grass' ? 'park' : l.type === 'beach' ? 'beach' : l.district;
      areas.push({ id: areas.length, x0: l.x0, z0: l.z0, x1: l.x1, z1: l.z1, district, lot: true, ok: 0 });
    }
  }
  const grid = new Map();
  for (let i = 0; i < areas.length; i++) {
    const b = areas[i];
    if (!(DENSITY[b.district] > 0)) continue;
    for (let cx = Math.floor(b.x0 / CELL); cx <= Math.floor(b.x1 / CELL); cx++) {
      for (let cz = Math.floor(b.z0 / CELL); cz <= Math.floor(b.z1 / CELL); cz++) {
        const key = cx * 8192 + cz;
        let list = grid.get(key);
        if (!list) grid.set(key, (list = []));
        list.push(i);
      }
    }
  }
  return { areas, grid };
}

// A lot is used once its walking loop is checked clear of buildings and
// roads (done on first use, so the city start pays nothing).
function lotUsable(city, b) {
  if (b.ok) return b.ok === 1;
  let bad = 0, n = 0;
  const per = 2 * (b.x1 - b.x0 + b.z1 - b.z0 - INSET * 4);
  for (let s = 0; s < per; s += 6, n++) {
    pointAt(b, s);
    if ((city.inBuilding && city.inBuilding(PT.x, PT.z, 0.6)) || (city.onRoad && city.onRoad(PT.x, PT.z))) bad++;
  }
  b.ok = bad <= n * 0.1 ? 1 : 2;
  return b.ok === 1;
}

export function createPeds(game, { max = 30 } = {}) {
  const city = game.city;
  const slots = []; // { ped, mesh }
  const ctx = { city, collision: game.collision, vehicles: game.vehicles, player: game.player, sirens: [] };
  const { areas: blocks, grid } = buildAreas(city);
  const onBlock = new Int16Array(blocks.length); // active peds per block or plaza
  const cand = new Int32Array(blocks.length);
  const candW = new Float32Array(blocks.length);
  const seenScan = new Int32Array(blocks.length);
  let scanNo = 0, lastX = NaN, lastZ = NaN;
  const clockNow = () => (Number.isFinite(game.clock) ? game.clock : 12);
  let timer = 0;
  let active = 0;
  let first = true;
  let hidden = false;

  function freeSlot() {
    for (let i = 0; i < slots.length; i++) if (!slots[i].ped.active) return slots[i];
    if (slots.length >= max) return null;
    const mesh = createPersonMesh(game.rng.pick(PERSON_PALETTES));
    mesh.visible = false;
    if (mesh.rotation) mesh.rotation.order = 'YXZ'; // lets layDown tip it over
    if (game.scene) game.scene.add(mesh);
    const slot = { ped: createPed(game.rng), mesh };
    slots.push(slot);
    return slot;
  }

  function deactivate(slot) {
    const p = slot.ped;
    if (p.block) onBlock[p.block.id]--;
    removeActor(game, p);
    p.active = false;
    p.block = null;
    slot.mesh.visible = false;
  }

  function hideAll() {
    for (let i = 0; i < slots.length; i++) if (slots[i].ped.active) deactivate(slots[i]);
    active = 0;
    hidden = true;
  }

  function cap() {
    const q = game.quality === undefined ? 1 : clamp(+game.quality || 1, 0.25, 1);
    // Fewer people at night and where the place is quiet at this hour.
    const busy = crowdAt(city.districtOf ? city.districtOf(game.player.x, game.player.z) : 'downtown', clockNow());
    return Math.max(1, Math.round(max * q * (0.3 + 0.7 * busy)));
  }

  // Is the point probably hidden from the player?
  function unseen(px, pz, x, z) {
    if (!collision_lineClear(px, pz, x, z)) return true;
    if (game.camHeading === undefined) return false;
    const a = Math.atan2(z - pz, x - px);
    return Math.abs(angleDiff(a, game.camHeading)) > 1.1;
  }
  function collision_lineClear(x0, z0, x1, z1) {
    return game.collision.lineClear(x0, z0, x1, z1);
  }

  // Pick a block or plaza near the player by weight (busier places at
  // this hour and closer ones first). Returns it or null.
  function pickBlock(px, pz, nearMin, farMax) {
    let n = 0, total = 0;
    const clock = clockNow();
    scanNo++;
    const c0x = Math.floor((px - farMax) / CELL), c1x = Math.floor((px + farMax) / CELL);
    const c0z = Math.floor((pz - farMax) / CELL), c1z = Math.floor((pz + farMax) / CELL);
    for (let cx = c0x; cx <= c1x; cx++) {
      for (let cz = c0z; cz <= c1z; cz++) {
        const list = grid.get(cx * 8192 + cz);
        if (!list) continue;
        for (let k = 0; k < list.length; k++) {
          const i = list[k];
          if (seenScan[i] === scanNo) continue;
          seenScan[i] = scanNo;
          const b = blocks[i];
          if (onBlock[i] >= blockCapacity(b, clock)) continue;
          const dx = px < b.x0 ? b.x0 - px : px > b.x1 ? px - b.x1 : 0;
          const dz = pz < b.z0 ? b.z0 - pz : pz > b.z1 ? pz - b.z1 : 0;
          const d = Math.hypot(dx, dz);
          if (d > farMax) continue;
          // Farthest corner must reach into the band too.
          const fx = Math.max(Math.abs(px - b.x0), Math.abs(px - b.x1));
          const fz = Math.max(Math.abs(pz - b.z0), Math.abs(pz - b.z1));
          if (Math.hypot(fx, fz) < nearMin) continue;
          if (b.lot && !lotUsable(city, b)) continue;
          cand[n] = i;
          candW[n] = DENSITY[b.district] * (d < 40 ? 3 : d < 80 ? 2 : 1);
          total += candW[n];
          n++;
        }
      }
    }
    if (n === 0) return null;
    let r = game.rng.next() * total;
    for (let i = 0; i < n; i++) {
      r -= candW[i];
      if (r <= 0) return blocks[cand[i]];
    }
    return blocks[cand[n - 1]];
  }

  function spawnOne(px, pz, anywhere) {
    const slot = freeSlot();
    if (!slot) return false;
    const nearMin = anywhere ? NEAR_FIRST : NEAR, farMax = anywhere ? FAR_FIRST : FAR;
    const block = pickBlock(px, pz, nearMin, farMax);
    if (!block) return false;
    const ped = slot.ped;
    const rng = game.rng;
    const park = block.district === 'park';
    const kind = park ? (rng.chance(0.5) ? 'jog' : 'loop') : rng.chance(0.14) && active + 1 < cap() ? 'chat' : 'loop';
    let fallback = false;
    let ok = false;
    for (let tries = 0; tries < 10 && !ok; tries++) {
      placePed(ped, block, rng, kind);
      const d = Math.hypot(ped.x - px, ped.z - pz);
      if (d < nearMin || d > farMax) continue;
      if (unseen(px, pz, ped.x, ped.z) || anywhere) ok = true;
      else if (d > 60) fallback = true; // visible but far: acceptable last resort
      if (!ok && fallback && tries === 9) ok = true;
    }
    ped.active = ok;
    if (!ok) return false;
    if (game.actors && !addActor(game, ped)) {
      ped.active = false;
      return false;
    }
    if (kind === 'jog') {
      const r = game.collision.resolveCircle(ped.x, ped.z, RADIUS, 0);
      setPos(ped, r.x, r.z);
    }
    onBlock[block.id]++;
    active++;
    if (kind === 'chat') {
      const other = freeSlot();
      if (other && (!game.actors || addActor(game, other.ped))) {
        pairWith(ped, other.ped);
        onBlock[block.id]++;
        active++;
        other.mesh.visible = true;
      } else ped.kind = 'loop', ped.state = 'walking';
    }
    slot.mesh.visible = true;
    return true;
  }

  function scan() {
    const px = game.player.x, pz = game.player.z;
    // A teleport or respawn: fill again around the new place at once.
    if (Number.isFinite(lastX) && Math.hypot(px - lastX, pz - lastZ) > JUMP) first = true;
    lastX = px;
    lastZ = pz;
    // Recycle the far ones and count.
    active = 0;
    for (let i = 0; i < slots.length; i++) {
      const p = slots[i].ped;
      if (!p.active) continue;
      if (Math.hypot(p.x - px, p.z - pz) > RECYCLE || p.fade >= 1) deactivate(slots[i]);
      else active++;
    }
    const limit = cap();
    // Too many after a quality drop: let the farthest go.
    while (active > limit) {
      let far = -1, fd = -1;
      for (let i = 0; i < slots.length; i++) {
        const p = slots[i].ped;
        if (!p.active) continue;
        const d = Math.hypot(p.x - px, p.z - pz);
        if (d > fd) { fd = d; far = i; }
      }
      if (far < 0) break;
      deactivate(slots[far]);
      active--;
    }
    let budget = first ? limit + 6 : active < limit * 0.6 ? 3 : 1;
    let misses = 0;
    while (active < limit && budget-- > 0) {
      if (!spawnOne(px, pz, first) && ++misses > 3) break;
    }
    first = false;
  }

  // Nearest block that has a pavement loop (for a ped placed off-loop).
  function nearestBlock(x, z) {
    let best = null, bd = Infinity;
    for (let i = 0; i < blocks.length; i++) {
      const b = blocks[i];
      if (b.lot || b.district === 'airfield' || b.x1 - b.x0 < INSET * 2 + 2 || b.z1 - b.z0 < INSET * 2 + 2) continue;
      const dx = x < b.x0 ? b.x0 - x : x > b.x1 ? x - b.x1 : 0;
      const dz = z < b.z0 ? b.z0 - z : z > b.z1 ? z - b.z1 : 0;
      const d = dx * dx + dz * dz;
      if (d < bd) {
        bd = d;
        best = b;
      }
    }
    return best;
  }

  // A driver who bailed out of a car (task 27): a ped at (x, z) running
  // from (fx, fz). Takes a free slot, else recycles the farthest ped.
  // Returns the ped or null.
  function spawnFleeing(x, z, fx, fz, time = PANIC_T + 2) {
    if (hidden || !Number.isFinite(x) || !Number.isFinite(z)) return null;
    let slot = freeSlot();
    const px = game.player.x, pz = game.player.z;
    if (!slot) {
      let far = -1, fd = -1;
      for (let i = 0; i < slots.length; i++) {
        const p = slots[i].ped;
        if (!p.active) continue;
        const d = (p.x - px) * (p.x - px) + (p.z - pz) * (p.z - pz);
        if (d > fd) { fd = d; far = i; }
      }
      if (far < 0) return null;
      deactivate(slots[far]);
      active--;
      slot = slots[far];
    }
    const block = nearestBlock(x, z);
    if (!block) return null;
    const ped = slot.ped;
    placePed(ped, block, game.rng, 'loop');
    setPos(ped, x, z);
    ped.s = nearestS(block, x, z);
    if (game.actors && !addActor(game, ped)) {
      ped.active = false;
      ped.block = null;
      return null;
    }
    onBlock[block.id]++;
    active++;
    scarePed(ped, fx, fz, time);
    slot.mesh.visible = true;
    return ped;
  }

  // Gunfire nearby or someone knocked down: everyone close runs.
  function scareAround(x, z, r) {
    const r2 = r * r;
    for (let i = 0; i < slots.length; i++) {
      const p = slots[i].ped;
      if (!p.active) continue;
      const dx = p.x - x, dz = p.z - z;
      if (dx * dx + dz * dz < r2) scarePed(p, x, z);
    }
  }
  if (game.events && game.events.on) {
    game.events.on('shot', (s) => scareAround(s.x, s.z, SHOT_SCARE));
    game.events.on('down', (d) => {
      if (d && d.target) scareAround(d.target.x, d.target.z, DOWN_SCARE);
    });
    game.events.on('explosion', (e) => scareAround(e.x, e.z, SHOT_SCARE));
  }

  return {
    name: 'peds',
    get count() { return active; },
    slots,
    spawnFleeing,
    fixedUpdate(dt) {
      const p = game.player;
      if (p.y > SKY || (city.shoreDist && city.shoreDist(p.x, p.z) < SEA)) {
        if (!hidden) hideAll();
        return;
      }
      if (hidden) {
        hidden = false;
        first = true;
        timer = 0;
      }
      timer -= dt;
      if (timer <= 0) {
        timer = 0.5;
        scan();
      }
      ctx.vehicles = game.vehicles;
      ctx.player = p;
      collectSirens(game.vehicles, ctx.sirens);
      for (let i = 0; i < slots.length; i++) {
        const ped = slots[i].ped;
        if (!ped.active) continue;
        stepPed(ped, dt, ctx);
        if (ped.startled) game.events.emit('pedStartled', ped);
        // Faded out after a knock-out: free the slot (respawns out of view).
        if (ped.fade >= 1) deactivate(slots[i]);
      }
    },
    render(alpha) {
      if (hidden) return;
      for (let i = 0; i < slots.length; i++) {
        const s = slots[i];
        if (!s.ped.active) continue;
        updatePersonMesh(s.mesh, s.ped, alpha);
        if (s.ped.life !== 'ok') layDown(s.mesh, s.ped);
        else if (s.mesh.rotation.z !== 0) s.mesh.rotation.z = 0;
      }
    },
  };
}
