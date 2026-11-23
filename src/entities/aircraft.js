// Aircraft simulation: forgiving arcade planes and helicopters flown with
// two thumbs. Pure logic (no three.js, no DOM). Follows docs/CRAFT.md:
// heading 0 faces +x, forward is (cos h, sin h) in (x, z), y is the height
// of the ground-contact point, pitch is nose up, roll is right side down.
import { clamp, angleDiff } from '../core/rng.js';
import { stepBoost, PLANE_BOOST, HELI_BOOST } from './boost.js';

const G = 9.81;
const TAU = Math.PI * 2;
const CEILING = 600; // meters, soft
const EDGE = 2600; // meters from the origin, craft are turned back beyond
const CRASH_CLOSE = 8; // m/s closing speed against a wall that wrecks
const DEG = Math.PI / 180;

// Original generic aircraft. Names are invented.
// width is the wing span (planes) or the rotor diameter (helicopters).
export const AIRCRAFT_SPECS = {
  prop: {
    id: 'prop', label: 'Pipwick', kind: 'plane',
    length: 7.6, width: 10.4, height: 2.6, mass: 900, health: 400,
    maxSpeed: 65, stallSpeed: 22, thrust: 6.5, groundBrake: 9,
    maxBank: 55 * DEG, maxClimb: 35 * DEG, rollRate: 3.2, pitchRate: 2.2, turnGain: 2.6,
    floats: false, hitRadius: 1.6,
    colors: [0xe8e2d0, 0xd9542b, 0x2f6fb5, 0xf0b429, 0x4f9d69],
  },
  stunt: {
    id: 'stunt', label: 'Barrowlark', kind: 'plane',
    length: 6.0, width: 6.8, height: 2.3, mass: 650, health: 350,
    maxSpeed: 72, stallSpeed: 20, thrust: 9, groundBrake: 9,
    maxBank: 80 * DEG, maxClimb: 60 * DEG, rollRate: 5.5, pitchRate: 3.4, turnGain: 2.2,
    floats: false, hitRadius: 1.4,
    colors: [0xd81e2a, 0xf2d21b, 0x1c2f5e, 0x18a0a0, 0xf5f5f5],
  },
  seaplane: {
    id: 'seaplane', label: 'Ottermere', kind: 'plane',
    length: 8.4, width: 11.6, height: 3.5, mass: 1300, health: 500,
    maxSpeed: 58, stallSpeed: 24, thrust: 6.8, groundBrake: 7,
    maxBank: 50 * DEG, maxClimb: 32 * DEG, rollRate: 2.6, pitchRate: 1.9, turnGain: 2.5,
    floats: true, hitRadius: 1.8,
    colors: [0xf2efe6, 0xe07a1f, 0x2a9d8f, 0x3a5fa8, 0xc9c13a],
  },
  jet: {
    id: 'jet', label: 'Velloria', kind: 'plane',
    length: 12.5, width: 12.2, height: 3.9, mass: 4200, health: 600,
    maxSpeed: 120, stallSpeed: 40, thrust: 7, groundBrake: 11,
    maxBank: 62 * DEG, maxClimb: 45 * DEG, rollRate: 3.0, pitchRate: 2.0, turnGain: 3.2,
    floats: false, hitRadius: 2.0,
    colors: [0xf4f4f0, 0x23272e, 0x7a1f2b, 0x1f4e79, 0xb8a36a],
  },
  heli: {
    id: 'heli', label: 'Midgefly', kind: 'heli',
    length: 8.6, width: 8.4, height: 2.9, mass: 1000, health: 450,
    maxSpeed: 42, climbRate: 9, sinkRate: 7, accel: 9, yawRate: 1.5,
    spoolUp: 0.3, spoolDown: 0.12, rotorRadius: 4.2, blades: 2,
    floats: false, hitRadius: 1.6,
    colors: [0xd9a521, 0xc2392b, 0x2d6a8f, 0xf0f0ea, 0x2f4f3a],
  },
  heavyheli: {
    id: 'heavyheli', label: 'Oxbarrow', kind: 'heli',
    length: 14.0, width: 13.0, height: 4.3, mass: 4500, health: 900,
    maxSpeed: 32, climbRate: 6, sinkRate: 5, accel: 5, yawRate: 0.95,
    spoolUp: 0.2, spoolDown: 0.1, rotorRadius: 6.5, blades: 4,
    floats: false, hitRadius: 2.4,
    colors: [0x55624a, 0xd6d6d0, 0xb5651d, 0x2b3a55, 0xa32020],
    mounts: ['drop'], // 4 bombs (docs/ARMS.md section 4)
  },
  // Single-seat fighter (docs/ARMS.md section 4). Arcade assists read by
  // stepPlane: noStall (never stalls: below 1.1 x stallSpeed the nose eases
  // down and thrust rises), cruise (airborne throttle floor with THRUST
  // released), autoLevel (rad/s of extra roll leveling with the stick
  // centered), afterburner (extra thrust share with THRUST above 0.9).
  fighter: {
    id: 'fighter', label: 'Gannetfang', kind: 'plane',
    length: 13.4, width: 9.6, height: 3.6, mass: 9000, health: 700,
    maxSpeed: 130, stallSpeed: 30, thrust: 14, groundBrake: 14,
    maxBank: 85 * DEG, maxClimb: 70 * DEG, rollRate: 4.6, pitchRate: 3.1, turnGain: 3.4,
    floats: false, hitRadius: 1.9,
    noStall: true, cruise: 0.45, autoLevel: 1.5, afterburner: 0.6,
    mounts: ['nosegun', 'missile', 'bomb'], armor: { bullet: 0.3 }, engine: 'turbine',
    colors: [0x9aa3ab, 0x2f4d6b, 0xc8b88a, 0x2a2d33],
  },
  // Police helicopter: siren and light bar (craft.siren), spotlight
  // (craft.spotOn wanted, craft.spot 0..1 drawn), chin gun.
  patrolheli: {
    id: 'patrolheli', label: 'Lampwatch', kind: 'heli',
    length: 10.2, width: 9.6, height: 3.2, mass: 1400, health: 360,
    maxSpeed: 46, climbRate: 10, sinkRate: 8, accel: 10, yawRate: 1.6,
    spoolUp: 0.35, spoolDown: 0.12, rotorRadius: 4.8, blades: 4,
    floats: false, hitRadius: 1.7,
    mounts: ['chingun'], police: true,
    colors: [0xeef1f4], // white with a blue band (aircraftmesh.js)
  },
};

let nextId = 200000;

export function createAircraft(specId, x, z, heading = 0, rng = null) {
  const spec = AIRCRAFT_SPECS[specId] || AIRCRAFT_SPECS.prop;
  const color = rng ? rng.pick(spec.colors) : spec.colors[0];
  return {
    id: nextId++,
    kind: spec.kind,
    spec,
    x, z, y: 0, heading, pitch: 0, roll: 0,
    px: x, pz: z, py: 0, pheading: heading, ppitch: 0, proll: 0,
    vx: 0, vz: 0, vy: 0, speed: 0, airspeed: 0,
    steer: 0,
    throttle: 0, brake: 0,
    health: spec.health,
    wrecked: false,
    impact: 0,
    driver: null,
    radius: Math.hypot(spec.length / 2, spec.width / 2),
    color,
    // Aircraft extras.
    onGround: true,
    onWater: false,
    placed: false, // false until the first step has put it on the surface
    stalled: false,
    propSpin: 0,
    rotorSpeed: 0,
    gearCompress: 0,
    engineOn: false,
    touchdown: false,
    touchdownSpeed: 0,
    crashed: false,
    turningBack: false,
    afterburner: 0, // 0..1, fighter afterburner (sound, glow), driven by the BOOST button
    boostMeter: 1, boostLevel: 0, boostLock: false, boostOn: false,
    // Police craft: siren and light bar, spotlight wanted (spotOn) and drawn (spot).
    siren: false,
    spotOn: false,
    spot: 0,
  };
}

export function damageAircraft(a, amount) {
  if (!(amount > 0)) return;
  a.health -= amount;
  if (a.health <= 0) {
    a.health = 0;
    a.wrecked = true;
  }
}

function impactDamage(c) {
  if (c <= 2) return 0;
  const e = c - 2;
  return e * 14 + e * e * 0.6;
}

function approach(v, target, step) {
  if (v < target) return Math.min(target, v + step);
  return Math.max(target, v - step);
}

// ---- world queries ----------------------------------------------------------
let surfWater = false;

// Height of the surface under a point (roofs count); sets surfWater.
function surfaceAt(world, x, z) {
  surfWater = false;
  if (!world) return 0;
  const col = world.collision;
  let h = 0;
  if (col && typeof col.heightAt === 'function') {
    h = col.heightAt(x, z);
    if (!(h > 0)) h = 0;
  }
  if (h === 0) {
    const city = world.city;
    if (city) {
      if (typeof city.isGround === 'function') surfWater = !city.isGround(x, z);
      else if (typeof city.shoreDist === 'function') surfWater = city.shoreDist(x, z) < 0;
    }
  }
  return h;
}

// Push a craft back over the shoreline. side = 1 keeps it on land,
// side = -1 keeps it on the water. Adjusts position and velocity.
function keepShoreSide(a, city, side, margin) {
  const d = city.shoreDist(a.x, a.z) * side;
  if (!(d < margin)) return;
  const e = 1;
  let gx = (city.shoreDist(a.x + e, a.z) - city.shoreDist(a.x - e, a.z)) * side;
  let gz = (city.shoreDist(a.x, a.z + e) - city.shoreDist(a.x, a.z - e)) * side;
  const gl = Math.hypot(gx, gz);
  if (!(gl > 1e-9)) return;
  gx /= gl;
  gz /= gl;
  const push = Math.min(margin - d, 4) * 0.5;
  a.x += gx * push;
  a.z += gz * push;
  const vin = a.vx * gx + a.vz * gz;
  if (vin < 0) {
    a.vx -= vin * gx;
    a.vz -= vin * gz;
  }
}

// ---- shared movement ---------------------------------------------------------
let mvClose = 0; // largest closing speed against a wall this step
let mvGround = false; // touched the surface this step
let mvSurface = 0;
let mvWater = false;

// Integrate position in sub-steps: walls first (sliding along them), then
// the surface below. Stops at the first surface contact.
function move(a, dt, world, checkGround) {
  mvClose = 0;
  mvGround = false;
  mvSurface = 0;
  mvWater = false;
  const col = world && world.collision;
  const hasCol = !!(col && typeof col.resolveCircle === 'function');
  const dist = Math.hypot(a.vx, a.vz) * dt;
  const n = Math.min(12, Math.max(1, Math.ceil(dist)));
  const h = dt / n;
  const r = a.spec.hitRadius;
  for (let k = 0; k < n; k++) {
    const nx0 = a.x + a.vx * h, nz0 = a.z + a.vz * h;
    const y0 = a.y;
    a.x = nx0;
    a.z = nz0;
    a.y += a.vy * h;
    if (checkGround) {
      // Coming down onto a surface from above (ground, sea or a roof).
      const s = surfaceAt(world, nx0, nz0);
      if (a.y <= s && y0 >= s) {
        mvGround = true;
        mvSurface = s;
        mvWater = surfWater;
        return;
      }
    }
    if (hasCol) {
      const res = col.resolveCircle(nx0, nz0, r, a.y < 0 ? 0 : a.y);
      if (res.hit) {
        const dx = res.x - nx0, dz = res.z - nz0;
        const d = Math.hypot(dx, dz);
        a.x = res.x;
        a.z = res.z;
        if (d > 1e-9) {
          const nx = dx / d, nz = dz / d;
          const vn = a.vx * nx + a.vz * nz;
          if (vn < 0) {
            if (-vn > mvClose) mvClose = -vn;
            a.vx -= vn * nx;
            a.vz -= vn * nz;
          }
        }
      }
    }
    if (checkGround) {
      const s = surfaceAt(world, a.x, a.z);
      if (a.y <= s) {
        mvGround = true;
        mvSurface = s;
        mvWater = surfWater;
        return;
      }
    }
  }
}

function stopDead(a) {
  a.vx = 0;
  a.vz = 0;
  a.vy = 0;
  a.speed = 0;
  a.airspeed = 0;
}

function crash(a, close) {
  a.crashed = true;
  a.wrecked = true;
  a.health = 0;
  a.stalled = false;
  if (close > a.impact) a.impact = close;
  a.vx = 0;
  a.vz = 0;
  a.speed = 0;
  a.airspeed = 0;
  if (a.onGround) a.vy = 0;
}

// Came down on water without floats: wrecked, afloat, waiting for a respawn.
function ditch(a, sink) {
  a.wrecked = true;
  a.health = 0;
  if (sink > 9) a.crashed = true;
  if (sink > a.impact) a.impact = sink;
  a.onGround = true;
  a.onWater = true;
  a.y = 0;
  a.stalled = false;
  stopDead(a);
}

// A wreck: falls if it is in the air, slides to a stop, then stays put.
function stepWreck(a, dt, world) {
  a.throttle = 0;
  a.brake = 0;
  a.engineOn = false;
  a.stalled = false;
  a.turningBack = false;
  a.rotorSpeed = approach(a.rotorSpeed, 0, 0.5 * dt);
  a.propSpin = (a.propSpin + a.rotorSpeed * 30 * dt) % TAU;
  a.gearCompress = approach(a.gearCompress, 0, 2 * dt);
  if (a.onGround) {
    const sp = Math.hypot(a.vx, a.vz);
    if (sp > 0.01) {
      const k = Math.max(0, sp - 12 * dt) / sp;
      a.vx *= k;
      a.vz *= k;
      a.vy = 0;
      move(a, dt, world, false);
    } else {
      stopDead(a);
    }
    a.roll = approach(a.roll, a.kind === 'plane' && !a.onWater ? 0.14 : 0, 1.5 * dt);
    a.pitch = approach(a.pitch, 0, 1.5 * dt);
    a.speed = a.vx * Math.cos(a.heading) + a.vz * Math.sin(a.heading);
    a.airspeed = Math.abs(a.speed);
    return;
  }
  const drag = Math.max(0, 1 - 1.2 * dt);
  a.vx *= drag;
  a.vz *= drag;
  a.vy = Math.max(-45, a.vy - G * dt);
  a.pitch = approach(a.pitch, -0.5, 0.8 * dt);
  a.roll += 0.6 * dt * (a.roll >= 0 ? 1 : -1);
  a.roll = clamp(a.roll, -1.2, 1.2);
  move(a, dt, world, true);
  if (mvGround) {
    const sink = -a.vy;
    if (sink > a.impact) a.impact = sink;
    a.y = mvWater ? 0 : mvSurface;
    a.onGround = true;
    a.onWater = mvWater;
    stopDead(a);
  }
  a.airspeed = Math.hypot(a.vx, a.vz, a.vy);
}

// Beyond the world edge the craft is steered back toward the island.
// Returns the steer input to use.
// A map with a land box (the real map is about 9 by 8 km) turns craft
// back EDGE_OUT m past the box; others (the island) EDGE m from the origin.
const EDGE_OUT = 600;
function edgeSteer(a, steerIn, world) {
  const box = world && world.city && world.city.crop;
  let cx = 0, cz = 0;
  if (box) {
    cx = (box.x0 + box.x1) / 2;
    cz = (box.z0 + box.z1) / 2;
    const ox = Math.max(box.x0 - a.x, a.x - box.x1, 0), oz = Math.max(box.z0 - a.z, a.z - box.z1, 0);
    const out = Math.max(ox, oz);
    if (out > EDGE_OUT) a.turningBack = true;
    else if (out < EDGE_OUT - 100) a.turningBack = false;
  } else {
    const d2 = a.x * a.x + a.z * a.z;
    if (d2 > EDGE * EDGE) a.turningBack = true;
    else if (d2 < (EDGE - 100) * (EDGE - 100)) a.turningBack = false;
  }
  if (!a.turningBack) return steerIn;
  const want = Math.atan2(cz - a.z, cx - a.x);
  return clamp(angleDiff(want, a.heading) * 1.5, -0.75, 0.75);
}

// First step: sit the parked craft on whatever is under it.
function place(a, world) {
  a.placed = true;
  if (!a.onGround) return;
  const s = surfaceAt(world, a.x, a.z);
  a.y = s;
  a.py = s;
  a.onWater = surfWater;
}

// ---- planes --------------------------------------------------------------------
function stepPlane(a, controls, dt, world) {
  const s = a.spec;
  let steerIn = 0, pitchIn = 0, throttle = 0, brake = 0;
  if (controls) {
    steerIn = clamp(+controls.steer || 0, -1, 1);
    pitchIn = clamp(+controls.pitch || 0, -1, 1);
    if (controls.invertPitch) pitchIn = -pitchIn;
    throttle = clamp(+controls.throttle || 0, 0, 1);
    brake = clamp(+controls.brake || 0, 0, 1);
  }
  a.throttle = throttle;
  a.brake = brake;
  a.engineOn = controls != null;
  // BOOST button (the player's input carries a boolean `boost`): the
  // afterburner on jets that have one, a short thrust surge on the rest.
  // AI pilots send no such field, so they keep the old rule: afterburner
  // at full throttle, no surge.
  const own = controls != null && typeof controls.boost === 'boolean';
  stepBoost(a, own && controls.boost && !a.wrecked, dt);
  const abTarget = own ? (a.boostOn ? 1 : 0) : controls && throttle > 0.9 ? 1 : 0;
  if (s.afterburner && (a.onGround || !controls)) a.afterburner = approach(a.afterburner, abTarget, 2.5 * dt);
  const parked = controls == null && a.onGround;
  if (parked) a.turningBack = false;
  else steerIn = edgeSteer(a, steerIn, world);
  a.steer = approach(a.steer, steerIn, (steerIn === 0 ? 6 : 4) * dt);

  if (a.onGround) planeGround(a, s, controls != null, pitchIn, throttle, brake, dt, world);
  else planeAir(a, s, pitchIn, throttle, brake, dt, world, abTarget);

  const spin = a.engineOn && !a.wrecked ? 14 + 40 * throttle : Math.min(a.airspeed * 0.25, 10);
  a.propSpin = (a.propSpin + spin * dt) % TAU;
}

// Thrust multiplier: the jet's afterburner share, or the short surge the
// other planes get while BOOST is held.
function thrustK(a, s) {
  return 1 + (s.afterburner ? s.afterburner * a.afterburner : PLANE_BOOST.force * a.boostLevel);
}

function planeGround(a, s, manned, pitchIn, throttle, brake, dt, world) {
  let surf = surfaceAt(world, a.x, a.z);
  if (surfWater) {
    if (!s.floats) {
      ditch(a, 0);
      return;
    }
    a.onWater = true;
  }
  const onWater = a.onWater;
  const vto = s.stallSpeed * 1.1;
  let vf = a.speed;

  if (throttle > 0.02) {
    if (vf > -0.5) {
      const r = clamp(vf / s.maxSpeed, 0, 1);
      vf += s.thrust * throttle * thrustK(a, s) * (1 - r * r) * dt;
    } else {
      vf = approach(vf, 0, s.groundBrake * throttle * dt);
    }
  }
  if (brake > 0.02) {
    if (vf > 0.5) {
      vf = approach(vf, 0, s.groundBrake * (onWater ? 0.5 : 1) * brake * dt);
    } else if (throttle <= 0.02 && manned) {
      // At a standstill the brake backs the plane up slowly.
      const r = clamp(-vf / 3.5, 0, 1);
      vf -= 2.5 * brake * (1 - r * r) * dt;
    }
  }
  // Rolling (or water) resistance; idle bleeds speed, parked holds still.
  const av = Math.abs(vf);
  let decel = onWater ? 1.0 + 0.09 * av : 0.4 + 0.012 * av;
  if (throttle <= 0.02 && !(brake > 0.02 && vf <= 0.5)) decel += onWater ? 1.2 : 1.4;
  if (!manned) decel += 8;
  vf = approach(vf, 0, decel * dt);

  // Nose wheel (or water rudder) steering.
  let auth = clamp(vf / (onWater ? 3 : 5), -1, 1);
  if (onWater && vf >= 0 && auth < 0.3 && manned) auth = 0.3;
  const yaw = a.steer * (onWater ? 0.55 : 0.95) * auth / (1 + Math.abs(vf) / 25);
  a.heading = angleDiff(a.heading + yaw * dt, 0);

  const ch = Math.cos(a.heading), sh = Math.sin(a.heading);
  a.vx = vf * ch;
  a.vz = vf * sh;
  a.vy = 0;
  if (vf !== 0) {
    move(a, dt, world, false);
    const city = world && world.city;
    if (city && typeof city.shoreDist === 'function') {
      if (onWater) keepShoreSide(a, city, -1, 3);
      else if (!s.floats) keepShoreSide(a, city, 1, 2);
    }
    vf = a.vx * ch + a.vz * sh;
    if (mvClose > 0) {
      if (mvClose > CRASH_CLOSE) {
        crash(a, mvClose);
        return;
      }
      a.impact = mvClose;
      damageAircraft(a, impactDamage(mvClose));
      vf *= 0.8;
    }
    surf = surfaceAt(world, a.x, a.z);
  }
  a.speed = vf;
  a.airspeed = Math.abs(vf);
  a.stalled = false;
  a.roll = approach(a.roll, 0, 2.5 * dt);
  const rot = pitchIn > 0 && vf > vto * 0.75 ? 0.09 * pitchIn : 0;
  a.pitch += (rot - a.pitch) * Math.min(1, 5 * dt);
  a.gearCompress = approach(a.gearCompress, 0, 2.5 * dt);

  if (surf < a.y - 0.3) {
    // Rolled off an edge (a roof): it is flying now, like it or not.
    a.onGround = false;
    a.onWater = false;
    return;
  }
  a.y = onWater ? 0 : surf;

  // Lift off with up-stick at take-off speed, or by itself a bit above.
  if (throttle > 0.3 && vf >= vto && (pitchIn > 0.1 || vf >= s.stallSpeed * 1.3)) {
    a.onGround = false;
    a.onWater = false;
    a.y += 0.05;
    a.pitch = Math.max(a.pitch, 0.05);
  }
}

function planeAir(a, s, pitchIn, throttle, brake, dt, world, abTarget) {
  const vs = s.stallSpeed;
  let v = a.airspeed;

  // Bank follows the stick and levels by itself; bank makes the turn.
  a.roll += (a.steer * s.maxBank - a.roll) * Math.min(1, s.rollRate * dt);
  if (s.autoLevel && Math.abs(a.steer) < 0.05) a.roll = approach(a.roll, 0, s.autoLevel * dt);
  // Arcade jets: a throttle floor while flying, afterburner at full THRUST.
  if (s.cruise && a.engineOn && throttle < s.cruise && !(brake > 0.02)) {
    throttle = s.cruise;
    a.throttle = throttle;
  }
  if (s.afterburner) a.afterburner = approach(a.afterburner, abTarget, 2.5 * dt);
  const turn = clamp(s.turnGain * G * clamp(Math.tan(a.roll), -2.4, 2.4) / Math.max(v, vs), -1.1, 1.1);
  a.heading = angleDiff(a.heading + turn * dt, 0);

  // Stall: soft, the nose drops until speed returns. noStall craft never
  // stall: the nose eases down and thrust rises below 1.1 x stall speed.
  if (s.noStall) a.stalled = false;
  else if (v < vs) a.stalled = true;
  else if (v > vs * 1.08) a.stalled = false;
  const slow = s.noStall ? clamp((1.1 * vs - v) / (0.3 * vs), 0, 1.5) : clamp((1.35 * vs - v) / (0.35 * vs), 0, 2);

  const surf = surfaceAt(world, a.x, a.z);
  const h = a.y - surf;
  let want = pitchIn * s.maxClimb - slow * 0.3;
  if (a.stalled) want = Math.min(want, -0.25);
  if (pitchIn > -0.2 && h < 10 && want < 0.06) {
    // Near the ground: power on climbs away, power off flares for landing.
    if (throttle > 0.3) want = a.stalled ? want : 0.06;
    else want = Math.max(want, -(0.03 + h * 0.02));
  }
  if (a.y > CEILING - 60) want = Math.min(want, (CEILING - a.y) * 0.01);
  want = clamp(want, -s.maxClimb - 0.3, s.maxClimb);
  a.pitch += (want - a.pitch) * Math.min(1, s.pitchRate * dt);

  // Speed: thrust, drag, and the trade with climbing or diving.
  const r = v / s.maxSpeed;
  // A boosted craft pulls full thrust (the jet's afterburner needs it).
  let acc = s.thrust * (a.boostLevel > throttle ? a.boostLevel : throttle) * thrustK(a, s) - s.thrust * r * r - G * Math.sin(a.pitch);
  acc -= Math.abs(Math.sin(a.roll)) * 0.6;
  // The air brake cannot drag the plane into a stall.
  if (brake > 0.02) acc -= 9 * brake * clamp((v - 1.1 * vs) / (0.3 * vs), 0, 1);
  if (s.noStall && slow > 0) acc = Math.max(acc, 0) + s.thrust * slow;
  v = clamp(v + acc * dt, s.noStall ? vs : 0, s.maxSpeed * 1.35);
  a.airspeed = v;

  const cp = Math.cos(a.pitch);
  const short = v < vs ? 1 - (v * v) / (vs * vs) : 0; // lift shortfall
  a.vx = v * cp * Math.cos(a.heading);
  a.vz = v * cp * Math.sin(a.heading);
  a.vy = v * Math.sin(a.pitch) - short * 14;
  a.speed = v;
  a.gearCompress = approach(a.gearCompress, 0, 2.5 * dt);

  move(a, dt, world, true);
  if (mvClose > 0) {
    if (mvClose > CRASH_CLOSE) {
      crash(a, mvClose);
      return;
    }
    a.impact = mvClose;
    damageAircraft(a, impactDamage(mvClose));
    a.airspeed *= 0.7;
    a.speed = a.airspeed;
  }
  if (mvGround) planeTouchdown(a, s);
}

function planeTouchdown(a, s) {
  const sink = Math.max(0, -a.vy);
  const bank = Math.abs(a.roll);
  if (mvWater && !s.floats) {
    ditch(a, sink);
    return;
  }
  a.y = mvWater ? 0 : mvSurface;
  a.onGround = true;
  a.onWater = mvWater;
  a.stalled = false;
  a.vy = 0;
  if (sink > 9 || bank > 45 * DEG || a.pitch < -26 * DEG) {
    crash(a, Math.max(sink, a.airspeed * 0.5));
    return;
  }
  a.touchdown = true;
  a.touchdownSpeed = sink;
  a.gearCompress = clamp(sink / 6, 0.1, 1);
  let vf = a.airspeed * Math.cos(a.pitch);
  if (sink > 5 || bank > 25 * DEG) {
    // Hard landing: it holds together, at a price.
    a.impact = sink;
    damageAircraft(a, 30 + Math.max(0, sink - 5) * 40 + Math.max(0, bank - 25 * DEG) * 300);
    vf *= 0.8;
  }
  a.speed = vf;
  a.airspeed = vf;
  a.vx = vf * Math.cos(a.heading);
  a.vz = vf * Math.sin(a.heading);
}

// ---- helicopters -----------------------------------------------------------------
function stepHeli(a, controls, dt, world) {
  const s = a.spec;
  let steerIn = 0, pitchIn = 0, throttle = 0, brake = 0;
  if (controls) {
    steerIn = clamp(+controls.steer || 0, -1, 1);
    pitchIn = clamp(+controls.pitch || 0, -1, 1);
    if (controls.invertPitch) pitchIn = -pitchIn;
    throttle = clamp(+controls.throttle || 0, 0, 1);
    brake = clamp(+controls.brake || 0, 0, 1);
  }
  a.throttle = throttle;
  a.brake = brake;
  // BOOST: a short forward speed surge (player only, and only while flying forward).
  stepBoost(a, controls != null && controls.boost === true && pitchIn > 0.1 && !a.onGround && !a.wrecked, dt);
  const surge = a.boostLevel;
  const aboard = a.driver != null;
  a.engineOn = aboard;
  a.rotorSpeed = approach(a.rotorSpeed, aboard ? 1 : 0, (aboard ? s.spoolUp : s.spoolDown) * dt);
  a.propSpin = (a.propSpin + a.rotorSpeed * 30 * dt) % TAU;
  const lift = a.rotorSpeed >= 0.8;
  a.stalled = false;
  a.gearCompress = approach(a.gearCompress, 0, 2.5 * dt);

  if (a.onGround) {
    a.turningBack = false;
    a.steer = 0;
    stopDead(a);
    a.pitch = approach(a.pitch, 0, 1.5 * dt);
    a.roll = approach(a.roll, 0, 1.5 * dt);
    const surf = surfaceAt(world, a.x, a.z);
    if (surfWater) {
      ditch(a, 0);
      return;
    }
    if (surf < a.y - 0.3) {
      a.onGround = false;
      return;
    }
    a.y = surf;
    if (lift && controls && throttle > 0.1) {
      a.onGround = false;
      a.vy = 0.6;
    }
    return;
  }

  steerIn = edgeSteer(a, steerIn, world);
  if (a.turningBack && pitchIn < 0.6) pitchIn = 0.6;
  a.steer = approach(a.steer, steerIn, (steerIn === 0 ? 6 : 4) * dt);

  const ch = Math.cos(a.heading), sh = Math.sin(a.heading);
  let vf = a.vx * ch + a.vz * sh;
  let vl = -a.vx * sh + a.vz * ch;
  let wantVf;
  if (lift) {
    a.heading = angleDiff(a.heading + a.steer * s.yawRate * dt, 0);
    wantVf = pitchIn * s.maxSpeed * (pitchIn < 0 ? 0.45 : 1 + HELI_BOOST.top * surge);
    vf = approach(vf, wantVf, s.accel * (1 + (HELI_BOOST.force - 1) * surge) * dt);
    vl = approach(vl, 0, s.accel * 0.7 * dt);
  } else {
    const k = Math.max(0, 1 - 0.4 * dt);
    vf *= k;
    vl *= k;
    wantVf = vf;
  }
  const nch = Math.cos(a.heading), nsh = Math.sin(a.heading);
  a.vx = vf * nch - vl * nsh;
  a.vz = vf * nsh + vl * nch;

  // Collective: hold altitude unless asked to climb or descend.
  if (lift) {
    let tv = throttle * s.climbRate - brake * s.sinkRate;
    if (a.y > CEILING - 60) tv = Math.min(tv, (CEILING - a.y) * 0.1);
    if (tv < 0) {
      // Ground effect: the last few meters are always slow.
      const h = a.y - surfaceAt(world, a.x, a.z);
      if (h < 8) tv = Math.max(tv, -(1.2 + (s.sinkRate - 1.2) * Math.max(0, h) / 8));
    }
    a.vy = approach(a.vy, tv, 10 * dt);
  } else {
    // Rotor winding down: it sinks, faster as the rotor slows.
    const frac = a.rotorSpeed / 0.8;
    a.vy = Math.max(a.vy - G * (1 - frac * 0.7) * dt, -(5 + 25 * (1 - frac)));
  }

  // Visual attitude: nose down when flying forward, lean into turns.
  const wp = clamp(-(vf / s.maxSpeed) * 0.2 - ((wantVf - vf) / s.maxSpeed) * 0.22, -0.4, 0.4);
  const wr = clamp(a.steer * 0.28 * (0.35 + Math.abs(vf) / s.maxSpeed) + vl * 0.02, -0.5, 0.5);
  a.pitch += (wp - a.pitch) * Math.min(1, 4 * dt);
  a.roll += (wr - a.roll) * Math.min(1, 4 * dt);

  move(a, dt, world, true);
  if (mvClose > 0) {
    if (mvClose > CRASH_CLOSE) {
      crash(a, mvClose);
      return;
    }
    a.impact = mvClose;
    damageAircraft(a, impactDamage(mvClose));
  }
  if (mvGround) {
    const sink = Math.max(0, -a.vy);
    if (mvWater) {
      ditch(a, sink);
      return;
    }
    const slide = Math.hypot(a.vx, a.vz);
    a.y = mvSurface;
    a.onGround = true;
    if (sink > 8) {
      crash(a, sink);
      a.vy = 0;
      return;
    }
    a.touchdown = true;
    a.touchdownSpeed = sink;
    a.gearCompress = clamp(sink / 5, 0.1, 1);
    if (sink > 4 || slide > 12) {
      a.impact = Math.max(sink, slide * 0.4);
      damageAircraft(a, Math.max(0, sink - 4) * 45 + Math.max(0, slide - 12) * 10);
    }
    stopDead(a);
    return;
  }
  a.speed = a.vx * nch + a.vz * nsh;
  a.airspeed = Math.hypot(a.vx, a.vz);
}

// ---- public step -----------------------------------------------------------------
export function stepAircraft(a, controls, dt, world) {
  a.px = a.x;
  a.pz = a.z;
  a.py = a.y;
  a.pheading = a.heading;
  a.ppitch = a.pitch;
  a.proll = a.roll;
  a.impact = 0;
  a.touchdown = false;
  if (!(dt > 0)) return;
  if (!a.placed) place(a, world);

  if (a.wrecked) stepWreck(a, dt, world);
  else if (a.kind === 'heli') stepHeli(a, controls, dt, world);
  else stepPlane(a, controls, dt, world);

  if (a.y < 0) a.y = 0;
  // Safety net: never let a NaN escape.
  if (!Number.isFinite(a.x + a.y + a.z + a.heading + a.pitch + a.roll + a.vx + a.vy + a.vz + a.speed + a.airspeed)) {
    a.x = a.px; a.y = a.py; a.z = a.pz;
    a.heading = a.pheading; a.pitch = a.ppitch; a.roll = a.proll;
    if (!Number.isFinite(a.x + a.y + a.z + a.heading + a.pitch + a.roll)) {
      a.x = 0; a.y = 0; a.z = 0; a.heading = 0; a.pitch = 0; a.roll = 0;
    }
    stopDead(a);
  }
}

// ---- craft vs craft --------------------------------------------------------------
const isAircraft = (c) => c.kind === 'plane' || c.kind === 'heli';
const HIT_SCALE = 0.6; // bounding spheres are generous (wing tips), shrink them

function afterHit(c, close) {
  if (close > c.impact) c.impact = close;
  if (!isAircraft(c)) {
    const dmg = impactDamage(close);
    if (dmg > 0 && typeof c.health === 'number') {
      c.health -= dmg;
      if (c.health <= 0) {
        c.health = 0;
        c.wrecked = true;
      }
    }
    return;
  }
  if (!c.onGround && close > CRASH_CLOSE) {
    crash(c, close);
    return;
  }
  damageAircraft(c, impactDamage(close));
  const f = c.vx * Math.cos(c.heading) + c.vz * Math.sin(c.heading);
  if (c.kind === 'plane') {
    c.speed = c.onGround ? f : Math.max(0, f);
    c.airspeed = Math.abs(c.speed);
  } else {
    c.speed = f;
  }
}

// Cheap sphere test between an aircraft and any other craft (car, boat,
// aircraft). Separates them, exchanges an impulse and applies damage.
export function collideAircraft(a, other) {
  if (a === other) return false;
  const ay = a.y || 0, oy = other.y || 0;
  let dx = other.x - a.x, dy = oy - ay, dz = other.z - a.z;
  const rr = (a.radius + other.radius) * HIT_SCALE;
  const d2 = dx * dx + dy * dy + dz * dz;
  if (!(d2 < rr * rr)) return false;
  const d = Math.sqrt(d2);
  if (d > 1e-6) {
    dx /= d;
    dy /= d;
    dz /= d;
  } else {
    dx = 1;
    dy = 0;
    dz = 0;
  }
  const depth = rr - d;
  const ima = 1 / (a.spec && a.spec.mass || 1200), imb = 1 / (other.spec && other.spec.mass || 1200);
  const sum = ima + imb;
  // Only craft that are flying may be moved vertically.
  const aFly = a.onGround === false, oFly = other.onGround === false;
  const ka = depth * ima / sum, kb = depth * imb / sum;
  a.x -= dx * ka;
  a.z -= dz * ka;
  other.x += dx * kb;
  other.z += dz * kb;
  if (aFly) a.y = Math.max(0, ay - dy * ka);
  if (oFly) other.y = Math.max(0, oy + dy * kb);

  const avy = a.vy || 0, ovy = other.vy || 0;
  const rvn = (other.vx - a.vx) * dx + (ovy - avy) * dy + (other.vz - a.vz) * dz;
  if (rvn < 0) {
    const j = -1.2 * rvn / sum;
    a.vx -= j * dx * ima;
    a.vz -= j * dz * ima;
    other.vx += j * dx * imb;
    other.vz += j * dz * imb;
    if (aFly) a.vy = avy - j * dy * ima;
    if (oFly) other.vy = ovy + j * dy * imb;
    const close = -rvn;
    afterHit(a, close);
    afterHit(other, close);
  }
  return true;
}
