// Aim assist and lock-on maths for the player's guns. Pure logic: no
// three.js, no DOM, no allocation per call (results go into `out`
// objects the caller owns). Contract: docs/COMBAT.md "Touch controls",
// "Drive-by" and "Camera".
//
// Directions are unit vectors in world space (x east, y up, z south).
// Yaw 0 faces +x and grows toward +z; pitch is up-positive.
import { angleDiff } from './rng.js';

const DEG = Math.PI / 180;
export const ASSIST_CONE = 8 * DEG; // half-angle of the bend cone
export const ASSIST_CONE_NEAR = 14 * DEG; // ... for targets within NEAR_DIST
export const NEAR_DIST = 8;
export const DRIVE_CONE = 20 * DEG; // drive-by cone and range
export const DRIVE_RANGE = 35;
export const LOCK_CONE = 35 * DEG; // where a LOCK tap looks for targets
export const LOCK_RANGE_MIN = 30; // lock reach for short-range weapons
export const LOCK_LOSE_T = 1.5; // s out of range or sight before a lock breaks
export const LOCK_TAU = 0.25; // s, soft camera follow of a locked target
export const DRAG_SLOW = 0.6; // drag speed while the crosshair is over a target
export const FLICK_PX = 70; // px of drag within FLICK_WINDOW that flicks the lock
export const FLICK_WINDOW = 0.3;
export const FLICK_CONE = 70 * DEG;
export const CHEST = 1.1; // m above an actor's feet that shots go for
export const PITCH_MIN = -0.6, PITCH_MAX = 0.7;

// Lock-on tiers (lower is picked first).
export const TIER_ATTACKER = 0, TIER_CREW = 1, TIER_POLICE = 2, TIER_CRAFT = 3, TIER_CIV = 4;

export const isActor = (t) => !!t && typeof t.hp === 'number';
export const isCraft = (t) => !!t && !!t.spec && typeof t.health === 'number' && t.hp === undefined;

// Open sky: a hand gun's bullet carries far further up at a helicopter or
// a plane than its street range (buildings, people, cars), so guns reach
// craft in the air out to AIR_REACH m. Used by aim assist, LOCK and the
// combat trace (combat.js).
export const AIR_REACH = 130;
export function airborne(t) {
  return isCraft(t) && (t.kind === 'heli' || t.kind === 'plane') && !t.onGround && (t.y || 0) > 3;
}
export const reachFor = (t, range) => (range < AIR_REACH && airborne(t) ? AIR_REACH : range);

// Is this a person or craft that can still be shot?
export function alive(t) {
  if (!t) return false;
  if (isActor(t)) return (t.life === 'ok' || t.life === 'getup' || t.life === undefined) && !(t.fade > 0) && t.active !== false;
  return !t.removed && !t.wrecked && !(t.health <= 0);
}

// Someone shooting at, or set on attacking, the player.
export function isAttacker(a, self) {
  return !!a && (a.attacking === true || a.hostile === true || a.state === 'engage'
    || (self && (a.target === self || a.attackTarget === self)));
}

// A craft driven by someone other than the player (crew, police, traffic).
export function crewedCraft(c) {
  return !!c && !!c.driver && c.driver !== 'player';
}

// Point a shot goes for: an actor's chest, a craft's cabin.
export function targetPoint(t, seaY, out) {
  if (isActor(t)) {
    out.x = t.x;
    out.y = (t.y || 0) + Math.min(CHEST, (t.height || 1.8) * 0.62);
    out.z = t.z;
  } else {
    const base = (t.y || 0) + (t.kind === 'boat' ? (seaY || 0) : 0);
    out.x = t.x;
    out.y = base + ((t.spec && t.spec.height) || 1.5) * 0.6;
    out.z = t.z;
  }
  return out;
}

// Unit forward vector from yaw and pitch.
export function forward(yaw, pitch, out) {
  const cp = Math.cos(pitch);
  out.x = Math.cos(yaw) * cp;
  out.y = Math.sin(pitch);
  out.z = Math.sin(yaw) * cp;
  return out;
}

// Angle (radians) between unit vector f and the direction o -> t.
export function angleTo(ox, oy, oz, fx, fy, fz, tx, ty, tz) {
  const dx = tx - ox, dy = ty - oy, dz = tz - oz;
  const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (!(d > 1e-6)) return 0;
  let c = (dx * fx + dy * fy + dz * fz) / d;
  if (c > 1) c = 1;
  else if (c < -1) c = -1;
  return Math.acos(c);
}

// True when nothing static stands between the two points. A wall only
// counts where the line at that distance is below the wall's top, so a
// target on the far side of a low wall or a roof below the line is fine.
export function lineOfSight(collision, x0, y0, z0, x1, y1, z1) {
  if (!collision || typeof collision.raycast !== 'function') return true;
  const dx = x1 - x0, dz = z1 - z0;
  const hl = Math.sqrt(dx * dx + dz * dz);
  if (hl < 1e-6) return true;
  const ux = dx / hl, uz = dz / hl;
  let from = 0;
  // Step past walls the line clears over (at most a few).
  for (let k = 0; k < 4; k++) {
    const d = collision.raycast(x0 + ux * from, z0 + uz * from, ux, uz, hl - from);
    if (!(d < hl - from - 0.05)) return true;
    const at = from + d;
    const yy = y0 + (y1 - y0) * (at / hl);
    const top = typeof collision.heightAt === 'function' ? collision.heightAt(x0 + ux * (at + 0.05), z0 + uz * (at + 0.05)) : Infinity;
    if (yy < top) return false;
    from = at + 0.3;
    if (from >= hl) return true;
  }
  return true;
}

const TP = { x: 0, y: 0, z: 0 };

// Candidate check shared by assist and lock. Returns the angle from the
// eye's forward, or -1 when the target is not usable. Writes the target
// point into TP.
function usable(ctx, t, eye, fwd, muzzle, range) {
  if (t === ctx.self || t === ctx.selfCraft || !alive(t)) return -1;
  if (isActor(t) && ctx.self && t.team === ctx.self.team && t.team === 'player') return -1;
  targetPoint(t, ctx.seaY, TP);
  const mx = TP.x - muzzle.x, my = TP.y - muzzle.y, mz = TP.z - muzzle.z;
  const d2 = mx * mx + my * my + mz * mz;
  const r = reachFor(t, range);
  if (d2 > r * r || d2 < 0.04) return -1;
  // In front of the eye at all?
  const ex = TP.x - eye.x, ey = TP.y - eye.y, ez = TP.z - eye.z;
  if (ex * fwd.x + ey * fwd.y + ez * fwd.z <= 0) return -1;
  return angleTo(eye.x, eye.y, eye.z, fwd.x, fwd.y, fwd.z, TP.x, TP.y, TP.z);
}

// Cone half-angle for a target at distance d (on foot).
export const assistCone = (d) => (d < NEAR_DIST ? ASSIST_CONE_NEAR : ASSIST_CONE);

function dist3(a, b) {
  const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

// Search state shared by the pickers below (no closures, no allocation).
const Q = { mode: 0, range: 0, cone: 0, skip: null, side: 0, curYaw: 0, best: null, tier: 99, score: Infinity };
const Q_ASSIST = 0, Q_LOCK = 1, Q_FLICK = 2;

function consider(ctx, t, eye, fwd, muzzle) {
  if (Q.mode === Q_FLICK) {
    if (t === Q.skip || t === ctx.self || t === ctx.selfCraft || !alive(t)) return;
    if (isCraft(t) && !crewedCraft(t)) return;
    if (isActor(t) && lockTier(t, ctx.self) === TIER_CIV) return;
    targetPoint(t, ctx.seaY, TP);
    const mx = TP.x - muzzle.x, mz = TP.z - muzzle.z, r = reachFor(t, Q.range);
    if (mx * mx + mz * mz > r * r) return;
    // Screen right is +yaw (heading grows toward +z, which is to the right).
    const a = angleDiff(Math.atan2(TP.z - eye.z, TP.x - eye.x), Q.curYaw);
    if (a * Q.side <= 0.01 || Math.abs(a) > FLICK_CONE || Math.abs(a) >= Q.score) return;
    if (!lineOfSight(ctx.collision, muzzle.x, muzzle.y, muzzle.z, TP.x, TP.y, TP.z)) return;
    Q.best = t;
    Q.score = Math.abs(a);
    return;
  }
  if (t === Q.skip) return;
  const ang = usable(ctx, t, eye, fwd, muzzle, Q.range);
  if (ang < 0) return;
  const d = dist3(muzzle, TP);
  if (Q.mode === Q_ASSIST) {
    const cone = Q.cone || assistCone(d);
    if (ang > cone) return;
    const score = ang / cone + 0.8 * (d / Q.range);
    if (score >= Q.score) return;
    if (!lineOfSight(ctx.collision, muzzle.x, muzzle.y, muzzle.z, TP.x, TP.y, TP.z)) return;
    Q.best = t;
    Q.score = score;
    return;
  }
  if (ang > LOCK_CONE) return;
  const tier = lockTier(t, ctx.self);
  if (tier === TIER_CIV && ang > assistCone(d)) return;
  if (isCraft(t) && !(t.police || t.cop || t.crew)) return;
  const score = ang / LOCK_CONE + 0.5 * (d / Q.range);
  if (tier > Q.tier || (tier === Q.tier && score >= Q.score)) return;
  if (!lineOfSight(ctx.collision, muzzle.x, muzzle.y, muzzle.z, TP.x, TP.y, TP.z)) return;
  Q.best = t;
  Q.tier = tier;
  Q.score = score;
}

function search(ctx, eye, fwd, muzzle, craft) {
  const actors = ctx.actors;
  if (actors) for (let i = 0; i < actors.length; i++) consider(ctx, actors[i], eye, fwd, muzzle);
  const vs = ctx.vehicles;
  if (vs && craft) for (let i = 0; i < vs.length; i++) if (crewedCraft(vs[i])) consider(ctx, vs[i], eye, fwd, muzzle);
  const best = Q.best;
  Q.best = null;
  Q.skip = null;
  return best;
}

function begin(mode, range) {
  Q.mode = mode;
  Q.range = range > 0 ? range : 1;
  Q.cone = 0;
  Q.skip = null;
  Q.best = null;
  Q.tier = 99;
  Q.score = Infinity;
}

// Best target to bend shots toward, or null.
// ctx: { actors, vehicles, collision, self, selfCraft, seaY }
// eye / fwd: the crosshair ray. muzzle: where the shot starts.
// opts: { range, cone (fixed half-angle; else the foot cone by distance),
//         craft (include crewed craft, default true) }
// Score: share of the cone used plus 0.8 x share of the range, so the
// nearer of two targets in the cone wins unless it is far off-centre.
export function pickAssist(ctx, eye, fwd, muzzle, opts) {
  begin(Q_ASSIST, opts.range);
  Q.cone = opts.cone || 0;
  return search(ctx, eye, fwd, muzzle, opts.craft !== false);
}

export function lockTier(t, self) {
  if (isCraft(t)) return TIER_CRAFT;
  if (isAttacker(t, self)) return TIER_ATTACKER;
  if (t.team === 'crew') return TIER_CREW;
  if (t.team === 'police') return TIER_POLICE;
  return TIER_CIV;
}

// Target for a LOCK tap, or null: attackers first, then crew, police,
// crewed craft; civilians only when already under the crosshair.
// `skip` (optional) is left out.
export function pickLock(ctx, eye, fwd, muzzle, range, skip = null) {
  begin(Q_LOCK, range);
  Q.skip = skip;
  return search(ctx, eye, fwd, muzzle, true);
}

// Next lock target to the left (side < 0) or right (side > 0) of the
// current one, as seen from `eye`. Nearest in angle on that side wins.
export function pickFlick(ctx, eye, muzzle, cur, side, range) {
  if (!cur) return null;
  begin(Q_FLICK, range);
  targetPoint(cur, ctx.seaY, TP);
  Q.curYaw = Math.atan2(TP.z - eye.z, TP.x - eye.x);
  Q.side = side;
  Q.skip = cur;
  return search(ctx, eye, null, muzzle, true);
}

// Unit direction from `from` to point (x, y, z), into out. Falls back to
// `fb` (a unit vector) when the points coincide.
export function dirTo(from, x, y, z, fb, out) {
  const dx = x - from.x, dy = y - from.y, dz = z - from.z;
  const l = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (!(l > 1e-6) || !Number.isFinite(l)) {
    out.x = fb.x; out.y = fb.y; out.z = fb.z;
    return out;
  }
  out.x = dx / l; out.y = dy / l; out.z = dz / l;
  return out;
}

// Yaw and pitch from `eye` to the point.
export function yawPitchTo(eye, x, y, z, out) {
  const dx = x - eye.x, dy = y - eye.y, dz = z - eye.z;
  out.yaw = Math.atan2(dz, dx);
  out.pitch = Math.atan2(dy, Math.sqrt(dx * dx + dz * dz) || 1e-6);
  return out;
}

// Frame-rate independent soft follow of an angle (time constant tau).
export function followAngle(cur, want, dt, tau = LOCK_TAU) {
  if (!Number.isFinite(want)) return cur;
  if (!(dt > 0)) return cur;
  const k = 1 - Math.exp(-dt / tau);
  return angleDiff(cur + angleDiff(want, cur) * k, 0);
}

// Lock bookkeeping, one call per step. Returns false when the lock
// breaks (target gone, or out of range/sight for LOCK_LOSE_T).
// st: { lock, lostT }.
export function keepLock(st, ctx, muzzle, range, dt) {
  const t = st.lock;
  if (!t || !alive(t)) {
    st.lock = null;
    st.lostT = 0;
    return false;
  }
  targetPoint(t, ctx.seaY, TP);
  const dx = TP.x - muzzle.x, dy = TP.y - muzzle.y, dz = TP.z - muzzle.z;
  const r = reachFor(t, range);
  const ok = dx * dx + dy * dy + dz * dz <= r * r
    && lineOfSight(ctx.collision, muzzle.x, muzzle.y, muzzle.z, TP.x, TP.y, TP.z);
  st.lostT = ok ? 0 : st.lostT + dt;
  if (st.lostT >= LOCK_LOSE_T) {
    st.lock = null;
    st.lostT = 0;
    return false;
  }
  return true;
}

// Where an unassisted shot goes: the muzzle aims at the point the
// crosshair ray reaches (`dist` along it), so the bullet lands under
// the crosshair even with the camera behind the shoulder.
export function convergeDir(eye, fwd, muzzle, dist, out) {
  const d = dist > 0.5 ? dist : 0.5;
  return dirTo(muzzle, eye.x + fwd.x * d, eye.y + fwd.y * d, eye.z + fwd.z * d, fwd, out);
}
