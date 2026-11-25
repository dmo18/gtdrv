// The player on foot: a small circle that walks, sprints, slides along
// walls and shorelines, and can find a craft to climb into. Pure logic.
import { angleDiff, clamp, TAU } from '../core/rng.js';
import { groundFn } from '../world/ground.js';

const WALK = 2.4; // m/s at full stick
const SPRINT = 6; // m/s at full stick
const ACCEL = 10; // 1/s, how quickly velocity follows the stick
const TURN = 10; // 1/s, how quickly the body faces the travel direction
const DRAIN = 1 / 8; // stamina per second of sprint (about 8 s from full)
const REGEN = 1 / 5; // stamina per second while not sprinting
const WINDED_UNTIL = 0.25; // after running dry, sprint again above this
const STRIDE_LEN = 1.5; // meters per full walk cycle (two steps)

export function createWalker(x, z, heading = 0) {
  return {
    x, z, y: 0, heading,
    px: x, pz: z, pheading: heading,
    vx: 0, vz: 0, speed: 0,
    moving: false, sprinting: false,
    stride: 0, radius: 0.35, stamina: 1,
    winded: false,
    // Combat actor fields (docs/COMBAT.md; systems/combat.js runs them).
    team: 'player', hp: 100, maxHp: 100, height: 1.8,
    life: 'ok', lifeT: 0, fade: 0, hitT: 0, kx: 0, kz: 0,
    lastHitBy: null, sinceHit: 99, bonks: 0, bumpBy: null, bumpV: 0,
    arms: null,
    // The rest of combat.js resetActor's fields, declared up front so a
    // respawn, a blast or a stumble never gives the walker a new shape.
    ky: 0, spin: 0, spinV: 0, rag: null, ragDone: false, ragYaw: 0, ragPitch: 0, ragRoll: 0, stumbleT: 0,
  };
}

function groundAt(world, x, z) {
  const city = world && world.city;
  return !city || !city.isGround || city.isGround(x, z);
}

export function stepWalker(w, controls, dt, world, camHeading = 0) {
  w.px = w.x;
  w.pz = w.z;
  w.pheading = w.heading;

  // Knocked down (or getting up): no walking of our own.
  if (w.life && w.life !== 'ok') {
    w.vx = w.vz = w.speed = 0;
    w.moving = false;
    w.sprinting = false;
    return w;
  }

  // Stick to a world direction, relative to the camera.
  let mx = 0, my = 0;
  if (controls) {
    mx = clamp(+controls.moveX || 0, -1, 1);
    my = clamp(+controls.moveY || 0, -1, 1);
  }
  let mag = Math.hypot(mx, my);
  let dx = 0, dz = 0;
  if (mag > 0.05) {
    const c = Math.cos(camHeading), s = Math.sin(camHeading);
    // forward (c, s) * my + right (-s, c) * mx
    dx = (c * my - s * mx) / mag;
    dz = (s * my + c * mx) / mag;
    if (mag > 1) mag = 1;
  } else mag = 0;

  // Sprint and stamina.
  if (w.winded && w.stamina >= WINDED_UNTIL) w.winded = false;
  const wantSprint = !!(controls && controls.sprint) && mag > 0.1;
  w.sprinting = wantSprint && !w.winded && w.stamina > 0;
  if (w.sprinting) {
    w.stamina -= DRAIN * dt;
    if (w.stamina <= 0) {
      w.stamina = 0;
      w.winded = true;
    }
  } else {
    w.stamina = Math.min(1, w.stamina + REGEN * dt);
  }
  const target = (w.sprinting ? SPRINT : WALK) * mag;

  // Smooth acceleration toward the wanted velocity.
  const k = Math.min(1, ACCEL * dt);
  w.vx += (dx * target - w.vx) * k;
  w.vz += (dz * target - w.vz) * k;

  const ox = w.x, oz = w.z;
  let nx = ox + w.vx * dt, nz = oz + w.vz * dt;

  // Static obstacles.
  const col = world && world.collision;
  if (col) {
    const r = col.resolveCircle(nx, nz, w.radius, 0);
    nx = r.x;
    nz = r.z;
  }

  // Craft bodies (only ones near the ground and nearby).
  const crafts = world && world.crafts;
  if (crafts) {
    for (let i = 0; i < crafts.length; i++) {
      const c = crafts[i];
      if (!c || !(c.y < 2)) continue;
      const ex = nx - c.x, ez = nz - c.z;
      if (ex > 8 || ex < -8 || ez > 8 || ez < -8) continue;
      const rr = c.radius * 0.6 + w.radius;
      const d2 = ex * ex + ez * ez;
      if (d2 >= rr * rr) continue;
      const d = Math.sqrt(d2);
      if (d > 1e-6) {
        // Remember a hit for combat: the car's own speed toward the walker
        // (never the walker's, docs/PLAN_V3.md 2.3 item 5).
        const closing = (c.vx || 0) * (ex / d) + (c.vz || 0) * (ez / d);
        if (closing > w.bumpV) {
          w.bumpBy = c;
          w.bumpV = closing;
        }
        nx = c.x + (ex / d) * rr;
        nz = c.z + (ez / d) * rr;
      } else {
        nx = c.x + rr;
      }
    }
  }

  // Walkable ground: slide along edges component-wise. If we already
  // stand off the ground (spawned badly), let any move through.
  if (!groundAt(world, nx, nz) && groundAt(world, ox, oz)) {
    if (groundAt(world, nx, oz)) nz = oz;
    else if (groundAt(world, ox, nz)) nx = ox;
    else {
      nx = ox;
      nz = oz;
    }
  }

  if (!Number.isFinite(nx) || !Number.isFinite(nz)) {
    nx = ox;
    nz = oz;
  }
  w.x = nx;
  w.z = nz;
  // Feet on the ground (curbs, the sea floor at a beach).
  const city = world && world.city;
  const g = city ? groundFn(city) : null;
  if (g) w.y = g(nx, nz);

  // Velocity is what actually happened, so walls stop the walk cycle.
  if (dt > 0) {
    w.vx = (nx - ox) / dt;
    w.vz = (nz - oz) / dt;
  }
  const dist = Math.hypot(nx - ox, nz - oz);
  w.speed = dt > 0 ? dist / dt : 0;
  w.moving = w.speed > 0.2;
  w.stride = (w.stride + (dist / STRIDE_LEN) * TAU) % TAU;

  // Body turns toward the travel direction.
  if (mag > 0) {
    const want = Math.atan2(dz, dx);
    const diff = angleDiff(want, w.heading);
    w.heading = angleDiff(w.heading + diff * Math.min(1, TURN * dt), 0);
  }
  return w;
}

// Nearest craft the walker can reach and climb into, or null.
export function findEnterable(w, crafts, maxDist = 3.2, accept = null) {
  let best = null, bestD = maxDist;
  if (!crafts) return null;
  for (let i = 0; i < crafts.length; i++) {
    const c = crafts[i];
    if (!c || c.wrecked || !(Math.abs(c.speed) < 4) || !(c.y < 1.5)) continue;
    if (accept && !accept(c)) continue;
    const d = Math.hypot(c.x - w.x, c.z - w.z) - c.radius * 0.7;
    if (d < bestD) {
      bestD = d;
      best = c;
    }
  }
  return best;
}

// Where someone stepping out of `craft` should stand. Tries the left
// (driver) side, then right, rear and front. Writes { x, z, ok } to out.
export function exitPosition(craft, world, out = { x: 0, z: 0, ok: false }) {
  const c = Math.cos(craft.heading), s = Math.sin(craft.heading);
  const side = craft.spec.width / 2 + 0.8;
  const end = craft.spec.length / 2 + 0.8;
  const col = world && world.collision;
  for (let i = 0; i < 4; i++) {
    let ax, az;
    if (i === 0) { ax = s * side; az = -c * side; } // left
    else if (i === 1) { ax = -s * side; az = c * side; } // right
    else if (i === 2) { ax = -c * end; az = -s * end; } // rear
    else { ax = c * end; az = s * end; } // front
    const x = craft.x + ax, z = craft.z + az;
    if (!groundAt(world, x, z)) continue;
    if (col && col.resolveCircle(x, z, 0.35, 0).hit) continue;
    out.x = x;
    out.z = z;
    out.ok = true;
    return out;
  }
  out.x = craft.x;
  out.z = craft.z;
  out.ok = false;
  return out;
}
