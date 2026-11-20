// Ragdoll tumbling for people knocked down hard (blast, car hit). A
// cheap fake: one rigid body (a capsule from the feet to the head, its
// centre at the hips) that flies, spins and lands under gravity with a
// ground clamp, plus ten loose limb angles on damped springs that lag
// behind the body's spin and get kicked on impact. On the ground the
// body topples flat (on its back or front) and settles in about RAG_T
// seconds after first touching down; then the final pose is written to
// the actor (`ragDone`, `ragYaw`, `ragPitch`) and the slot is freed.
//
// Pure logic: no three.js, no DOM. A fixed pool (RAGDOLL_MAX slots) is
// allocated once; stepping allocates nothing. Randomness only through
// the rng passed to startRagdoll (seeded by the caller).
//
// Angles follow the person mesh (rotation order 'YXZ'):
//   yaw   = heading (mesh rotation.y = -yaw)
//   pitch = tip about the body's side axis: +PI/2 lies on the back,
//           -PI/2 on the face (mesh rotation.z)
//   roll  = tip toward the right side, a cartwheel (mesh rotation.x)
// Docs: docs/COMBAT.md "Ragdolls".

export const RAGDOLL_MAX = 12; // tumbling at once; the rest use the plain fall pose
export const RAG_G = 9.81;
export const RAG_T = 0.8; // s from first touching the ground to settled
export const RAG_MAX_T = 3; // s: settles no matter what after this long
export const RAG_CENTRE = 0.9; // m from the feet to the body centre (hips)
export const RAG_HALF = 0.75; // m from the centre to the head or feet (upright reach = RAG_CENTRE)
export const RAG_THICK = 0.15; // m: centre height when lying flat
const BOUNCE = 0.25;
const SPIN_MAX = 9; // rad/s: fastest tumble
const clampSpin = (w) => (w > SPIN_MAX ? SPIN_MAX : w < -SPIN_MAX ? -SPIN_MAX : w);
const BOUNCE_MIN = 2.5; // m/s downward speed that bounces
const FRICTION = 5; // 1/s horizontal slowdown while touching the ground
const TOPPLE_K = 70, TOPPLE_D = 13; // spring that lays the body flat
const YAW_DAMP = 6;
const LIMB_K = 70, LIMB_D = 7; // floppy: under-damped on purpose
const LAG = 0.06; // limb lag per rad/s change of body spin
const SETTLE_V = 0.4, SETTLE_W = 0.6;
const TAU = Math.PI * 2;
const HALF_PI = Math.PI / 2;

// Limb channels (bone rotations of the person mesh, radians).
export const LIMB = {
  armLx: 0, armRx: 1, armLz: 2, armRz: 3,
  legLx: 4, legRx: 5, legLz: 6, legRz: 7,
  head: 8, bend: 9, // bend: elbows and knees
};
export const LIMB_COUNT = 10;
// The lying pose the limbs settle into (the same as the plain fall pose
// in render/personmesh.js: arms flung out, legs a little apart).
export const LIMB_REST = [0.9, -0.9, 0.2, -0.15, 0.15, -0.15, 0.1, -0.08, 0, 0.35];
const LIMB_LO = [-0.4, -2.6, -2.4, -2.4, -0.3, -1.2, -1.4, -1.4, -0.8, 0];
const LIMB_HI = [2.6, 0.4, 2.4, 2.4, 1.2, 0.3, 1.4, 1.4, 0.8, 1.5];
// Which body spin each limb lags behind: 0 = pitch (swing), 1 = roll (spread).
const LIMB_AXIS = [1, 1, 0, 0, 1, 1, 0, 0, 0, 0];
const LIMB_SIGN = [1, -1, 1, 1, 1, -1, -1, -1, 1, 1];

function makeSlot(i) {
  return {
    index: i, on: false, actor: null,
    t: 0, touchT: -1, ground: 0,
    x: 0, y: 0, z: 0, px: 0, pz: 0,
    vx: 0, vy: 0, vz: 0,
    yaw: 0, pitch: 0, roll: 0,
    wy: 0, wp: 0, wr: 0, lwp: 0, lwr: 0,
    contact: false, bounced: false,
    ang: new Float64Array(LIMB_COUNT),
    vel: new Float64Array(LIMB_COUNT),
  };
}

export function createRagdolls(max = RAGDOLL_MAX) {
  const n = Math.max(0, Math.min(64, max | 0));
  const slots = [];
  for (let i = 0; i < n; i++) slots.push(makeSlot(i));
  return { max: n, slots, active: 0, started: 0, refused: 0 };
}

// Height of the body's lowest point below its centre for a pitch and roll.
export function ragReach(pitch, roll) {
  return RAG_HALF * Math.abs(Math.cos(pitch) * Math.cos(roll)) + RAG_THICK;
}

// The nearest "lying flat" pitch (PI/2 + k PI) and roll (k PI).
export const flatPitch = (p) => Math.round((p - HALF_PI) / Math.PI) * Math.PI + HALF_PI;
export const flatRoll = (r) => Math.round(r / Math.PI) * Math.PI;

// Start tumbling actor `a` (fields x, z, y, heading) with velocity
// (vx, vy, vz). Returns the slot, or null when all slots are busy.
export function startRagdoll(pool, a, vx, vy, vz, rng) {
  if (!pool || !a) return null;
  if (a.rag && a.rag.on && a.rag.actor === a) {
    const s = a.rag;
    s.vx += vx; s.vy += vy; s.vz += vz;
    return s;
  }
  let s = null;
  for (let i = 0; i < pool.slots.length; i++) {
    if (!pool.slots[i].on) {
      s = pool.slots[i];
      break;
    }
  }
  if (!s) {
    pool.refused++;
    return null;
  }
  const r = () => (rng ? rng.next() : 0.5);
  s.on = true;
  s.actor = a;
  s.t = 0;
  s.touchT = -1;
  s.ground = Number.isFinite(a.y) && a.y > 0 ? a.y : 0;
  s.x = s.px = a.x;
  s.z = s.pz = a.z;
  s.y = s.ground + RAG_CENTRE;
  s.vx = vx; s.vy = vy; s.vz = vz;
  const h = Number.isFinite(a.heading) ? a.heading : 0;
  s.yaw = h;
  s.pitch = 0;
  s.roll = 0;
  // Spin from the push in the body's own frame: pushed backwards tips
  // onto the back (+pitch), pushed to the right cartwheels right (+roll).
  const ch = Math.cos(h), sh = Math.sin(h);
  const fwd = vx * ch + vz * sh, side = -vx * sh + vz * ch;
  s.wp = clampSpin(-fwd * 0.9 + (r() - 0.5) * 2);
  s.wr = clampSpin(side * 0.9 + (r() - 0.5) * 2);
  s.wy = (r() - 0.5) * 3;
  s.lwp = s.wp;
  s.lwr = s.wr;
  s.contact = false;
  s.bounced = false;
  for (let i = 0; i < LIMB_COUNT; i++) {
    s.ang[i] = i === LIMB.bend ? 0.1 : 0;
    s.vel[i] = (r() - 0.5) * 12;
  }
  a.rag = s;
  a.ragDone = false;
  pool.active++;
  pool.started++;
  return s;
}

// Extra launch (blast): upward speed and a tumble about the side axis.
// The spin adds to the tumble the push already started (same direction).
export function kickRagdoll(s, vy, spin) {
  if (!s || !s.on) return;
  s.vy += vy;
  const m = Math.abs(spin);
  const dir = Math.abs(s.wp) > 0.5 ? (s.wp > 0 ? 1 : -1) : (spin < 0 ? -1 : 1);
  s.wp = dir * Math.min(SPIN_MAX, Math.max(Math.abs(s.wp), m));
  s.lwp = s.wp;
}

function releaseSlot(pool, s) {
  s.on = false;
  s.actor = null;
  pool.active = Math.max(0, pool.active - 1);
}

// Bake the settled pose into the actor and free the slot. A body that
// ended face down (roll PI) is stored as the same rotation with roll 0:
// pitch -PI/2 and the yaw turned half round.
function settle(pool, s) {
  const a = s.actor;
  let p = flatPitch(s.pitch), r = flatRoll(s.roll), y = s.yaw;
  if (Math.abs(Math.sin(r * 0.5)) > 0.5) { // roll is an odd multiple of PI
    p = -p;
    y += Math.PI;
  }
  // Keep the angles small and tidy.
  p = Math.sin(p) >= 0 ? HALF_PI : -HALF_PI;
  y = ((y % TAU) + TAU) % TAU;
  if (a && a.rag === s) {
    a.rag = null;
    a.ragDone = true;
    a.ragYaw = y;
    a.ragPitch = p;
    a.x = s.x;
    a.z = s.z;
    a.y = s.ground;
    a.ky = 0;
    a.spin = 0;
  }
  releaseSlot(pool, s);
}

// One fixed step for every tumbling body. Writes the actor's x, z (body
// centre), y (height of the lowest point), ky (vertical speed in the
// air) and spin (pitch in the air, 0 once it has landed). `fix(slot)`,
// if given, runs after each body moves (walls, shoreline) and may
// change slot x, z, vx, vz; px, pz hold the position before the step.
export function stepRagdolls(pool, dt, fix = null) {
  if (!pool || !(dt > 0)) return;
  const slots = pool.slots;
  for (let i = 0; i < slots.length; i++) {
    const s = slots[i];
    if (!s.on) continue;
    const a = s.actor;
    // The owner reset or recycled the actor: let the slot go.
    if (!a || a.rag !== s) {
      releaseSlot(pool, s);
      continue;
    }
    stepOne(s, dt);
    if (fix) fix(s);
    if (s.touchT >= 0 && ((s.t - s.touchT >= RAG_T && calm(s)) || s.t - s.touchT >= RAG_T * 2)) settle(pool, s);
    else if (s.t >= RAG_MAX_T) settle(pool, s);
    else writeActor(s, a);
  }
}

function calm(s) {
  const hv = s.vx * s.vx + s.vz * s.vz + s.vy * s.vy;
  return hv < SETTLE_V * SETTLE_V && Math.abs(s.wp) < SETTLE_W && Math.abs(s.wr) < SETTLE_W;
}

function writeActor(s, a) {
  a.x = s.x;
  a.z = s.z;
  const low = s.y - ragReach(s.pitch, s.roll);
  a.y = s.contact ? s.ground : Math.max(s.ground, low);
  a.ky = s.contact ? 0 : s.vy;
  a.spin = s.touchT >= 0 ? 0 : s.pitch;
}

function stepOne(s, dt) {
  s.t += dt;
  s.px = s.x;
  s.pz = s.z;
  s.vy -= RAG_G * dt;
  s.x += s.vx * dt;
  s.y += s.vy * dt;
  s.z += s.vz * dt;
  s.yaw += s.wy * dt;
  s.pitch += s.wp * dt;
  s.roll += s.wr * dt;
  const floor = s.ground + ragReach(s.pitch, s.roll);
  let impact = 0;
  const was = s.contact;
  s.contact = false;
  // Lying on the ground while it tips over: stay down on the floor.
  if (was && s.vy <= 0 && s.y > floor) s.y = floor;
  if (s.y <= floor) {
    s.y = floor;
    s.contact = true;
    if (s.touchT < 0) s.touchT = s.t;
    if (s.vy < 0) {
      impact = -s.vy;
      if (!s.bounced && impact > BOUNCE_MIN) {
        s.vy = impact * BOUNCE;
        s.bounced = true;
        s.wp *= 0.6;
        s.wr *= 0.6;
      } else s.vy = 0;
    }
    const f = Math.exp(-FRICTION * dt);
    s.vx *= f;
    s.vz *= f;
    // Topple flat: the body falls onto its back or front.
    s.wp += (TOPPLE_K * (flatPitch(s.pitch) - s.pitch) - TOPPLE_D * s.wp) * dt;
    s.wr += (TOPPLE_K * (flatRoll(s.roll) - s.roll) - TOPPLE_D * s.wr) * dt;
    s.wy *= Math.exp(-YAW_DAMP * dt);
  }
  // Limbs: springs toward the lying pose that lag behind the body's spin.
  const dwp = s.wp - s.lwp, dwr = s.wr - s.lwr;
  s.lwp = s.wp;
  s.lwr = s.wr;
  const kick = impact > 1 ? Math.min(14, impact * 2.2) : 0;
  const ang = s.ang, vel = s.vel;
  for (let k = 0; k < LIMB_COUNT; k++) {
    const lag = (LIMB_AXIS[k] ? dwr : dwp) * LIMB_SIGN[k] * LAG / dt;
    vel[k] += (LIMB_K * (LIMB_REST[k] - ang[k]) - LIMB_D * vel[k] - lag) * dt;
    if (kick) vel[k] += kick * LIMB_SIGN[k] * (k & 1 ? -1 : 1);
    ang[k] += vel[k] * dt;
    if (ang[k] < LIMB_LO[k]) {
      ang[k] = LIMB_LO[k];
      if (vel[k] < 0) vel[k] *= -0.3;
    } else if (ang[k] > LIMB_HI[k]) {
      ang[k] = LIMB_HI[k];
      if (vel[k] > 0) vel[k] *= -0.3;
    }
  }
}

// World position of the mesh origin (the feet) for a body centre and
// angles, written into out {x, y, z}. Rotation R = Ry(-yaw) Rx(roll) Rz(pitch)
// applied to the centre offset (0, RAG_CENTRE, 0), subtracted from the centre.
export function ragOrigin(cx, cy, cz, yaw, pitch, roll, out) {
  const c = RAG_CENTRE;
  const sp = Math.sin(pitch), cp = Math.cos(pitch), sr = Math.sin(roll), cr = Math.cos(roll);
  const lx = -c * sp, ly = c * cp * cr, lz = c * cp * sr;
  const cyw = Math.cos(yaw), syw = Math.sin(yaw);
  out.x = cx - (lx * cyw - lz * syw);
  out.y = cy - ly;
  out.z = cz - (lx * syw + lz * cyw);
  return out;
}

// How many tumbling bodies are live right now.
export const ragdollsActive = (pool) => (pool ? pool.active : 0);
