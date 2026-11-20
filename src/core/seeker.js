// Missile seeker and lock-on for armed craft (docs/ARMS.md "Seeker and
// lock-on in flight"). Pure logic: no three.js, no DOM.
//
// const s = createSeeker();
// each step: const ev = stepSeeker(s, craft, ctx, dt, wantCycle);
//   ctx = { actors, vehicles, collision, seaY, self, range }
//   ev  = 'seek' | 'locked' | 'lost' | null (state change this step)
// s.target, s.state ('idle' | 'seek' | 'locked'), s.progress (0..1).
import { targetPoint, angleTo, lineOfSight, alive, isActor, isAttacker } from './aim.js';

const DEG = Math.PI / 180;
export const SEEK_CONE = 18 * DEG;
export const CIV_CONE = 4 * DEG;
export const LOCK_T = 0.8; // s in the cone to lock
export const BREAK_T = 1.0; // s outside the cone or sight to lose it
export const HELI_LOOK = -0.12; // rad: a helicopter's seeker looks a little down

export function createSeeker() {
  return { target: null, state: 'idle', t: 0, outT: 0, progress: 0 };
}

export function resetSeeker(s) {
  s.target = null;
  s.state = 'idle';
  s.t = 0;
  s.outT = 0;
  s.progress = 0;
  return s;
}

// Nose ray of a craft: origin and unit forward.
const NOSE = { x: 0, y: 0, z: 0, fx: 1, fy: 0, fz: 0 };
export function noseRay(c, seaY = 0, out = NOSE) {
  const pitch = c.kind === 'plane' ? (c.pitch || 0) : c.kind === 'heli' ? HELI_LOOK : (c.aimPitch || 0);
  const yaw = c.kind === 'tank' && Number.isFinite(c.aimYaw) ? c.aimYaw : (c.heading || 0);
  const cp = Math.cos(pitch);
  out.fx = Math.cos(yaw) * cp;
  out.fy = Math.sin(pitch);
  out.fz = Math.sin(yaw) * cp;
  const base = (c.y || 0) + (c.kind === 'boat' ? seaY : 0);
  out.x = c.x;
  out.y = base + ((c.spec && c.spec.height) || 1.5) * 0.5;
  out.z = c.z;
  return out;
}

// Lock tier: 0 attackers, 1 crew, 2 police (police helis too), 3 crewed
// craft, 4 civilians (only within CIV_CONE of the nose).
export function seekTier(t, self) {
  if (isActor(t)) {
    if (isAttacker(t, self)) return 0;
    if (t.team === 'crew') return 1;
    if (t.team === 'police') return 2;
    return 4;
  }
  if (t.hostile || t.attacking) return 0;
  if (t.crew) return 1;
  // A police craft nobody drives (parked at the depot) is just a craft.
  if (t.police || (t.spec && t.spec.police)) return t.driver ? 2 : 4;
  if (t.driver && t.driver !== 'player' && t.driver !== 'traffic' && !t.traffic && !t.ai) return 3;
  return 4;
}

const TP = { x: 0, y: 0, z: 0 };
// Angle off the nose when t is a usable candidate, else -1.
function coneAngle(t, c, ctx, ray, range) {
  if (!t || t === c || t === ctx.self || !alive(t)) return -1;
  if (isActor(t) && t.team === 'player') return -1;
  targetPoint(t, ctx.seaY || 0, TP);
  const dx = TP.x - ray.x, dy = TP.y - ray.y, dz = TP.z - ray.z;
  const d2 = dx * dx + dy * dy + dz * dz;
  if (d2 > range * range || d2 < 4) return -1;
  if (dx * ray.fx + dy * ray.fy + dz * ray.fz <= 0) return -1;
  const a = angleTo(ray.x, ray.y, ray.z, ray.fx, ray.fy, ray.fz, TP.x, TP.y, TP.z);
  if (a > SEEK_CONE) return -1;
  if (!lineOfSight(ctx.collision, ray.x, ray.y, ray.z, TP.x, TP.y, TP.z)) return -1;
  return a;
}

function usableAngle(t, c, ctx, ray, range) {
  const a = coneAngle(t, c, ctx, ray, range);
  if (a < 0) return -1;
  if (seekTier(t, ctx.self) === 4 && a > CIV_CONE) return -1;
  return a;
}

// Best candidate (lowest tier, then nearest the nose). With `after`, the
// next candidate in that order after it (wrapping), for LOCK cycling.
function pick(c, ctx, ray, range, after) {
  let best = null, bTier = 9, bA = 9;
  let next = null, nTier = 9, nA = 9;
  const aTier = after ? seekTier(after, ctx.self) : 0;
  const aA = after ? coneAngle(after, c, ctx, ray, range) : 0;
  const lists = [ctx.vehicles, ctx.actors];
  for (let l = 0; l < 2; l++) {
    const list = lists[l];
    if (!list) continue;
    for (let i = 0; i < list.length; i++) {
      const t = list[i];
      if (t === after) continue;
      const a = usableAngle(t, c, ctx, ray, range);
      if (a < 0) continue;
      const tier = seekTier(t, ctx.self);
      if (tier < bTier || (tier === bTier && a < bA)) {
        best = t;
        bTier = tier;
        bA = a;
      }
      if (after && (tier > aTier || (tier === aTier && a > aA)) && (tier < nTier || (tier === nTier && a < nA))) {
        next = t;
        nTier = tier;
        nA = a;
      }
    }
  }
  return after ? (next || best) : best;
}

export function stepSeeker(s, craft, ctx, dt, wantCycle = false) {
  if (!s || !craft) return null;
  const range = ctx.range || 600;
  const ray = noseRay(craft, ctx.seaY || 0);
  let ev = null;
  if (s.target && !alive(s.target)) {
    resetSeeker(s);
    ev = 'lost';
  }
  if (wantCycle) {
    const n = pick(craft, ctx, ray, range, s.target);
    if (n && n !== s.target) {
      s.target = n;
      s.state = 'seek';
      s.t = 0;
      s.outT = 0;
      s.progress = 0;
      return 'seek';
    }
    if (s.target) {
      // Only one candidate: restart the lock on it.
      s.state = 'seek';
      s.t = 0;
      s.progress = 0;
      return 'seek';
    }
  }
  if (!s.target) {
    const n = pick(craft, ctx, ray, range, null);
    if (!n) return ev;
    s.target = n;
    s.state = 'seek';
    s.t = 0;
    s.outT = 0;
    s.progress = 0;
    return 'seek';
  }
  const inside = usableAngle(s.target, craft, ctx, ray, range) >= 0;
  if (inside) {
    s.outT = 0;
    if (s.state === 'seek') {
      s.t += dt;
      s.progress = Math.min(1, s.t / LOCK_T);
      if (s.t >= LOCK_T) {
        s.state = 'locked';
        s.progress = 1;
        return 'locked';
      }
    }
    return ev;
  }
  s.outT += dt;
  if (s.outT >= BREAK_T) {
    resetSeeker(s);
    return 'lost';
  }
  return ev;
}
