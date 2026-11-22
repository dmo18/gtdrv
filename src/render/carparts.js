// Thrown parts of a blown-up vehicle (docs/REVAMP.md 6.7 layer 7): 14 to
// 18 per car from a pool of 96, always four that read as what they are (a
// door, a wheel, the bonnet, a bumper; a second door and wheel when the
// pool has room), launched at 6 to 16 m/s, 35 to 75 degrees up, spinning;
// one bounce that keeps 0.3 of the speed, then they lie flat for 20 s and
// shrink away over 1 s. Seeded from the vehicle id, so the same car always
// comes apart the same way.
//
// Pure: no three.js, no DOM. Structure of arrays allocated once; stepping
// allocates nothing. combatfx.js draws the pool (instanced boxes, doors
// and wheels) and makes the sparks and the `partLand` sound event.
import { createRng } from '../core/rng.js';

export const PARTS_MAX = 96;
export const PART_LIE_T = 20, PART_FADE_T = 1, PART_KEEP = 0.3;
export const PART_V0 = 6, PART_V1 = 16; // m/s launch speed
export const PART_EL0 = 35 * Math.PI / 180, PART_EL1 = 75 * Math.PI / 180; // launch angle up
export const PARTS_MIN = 14, PARTS_MAXPER = 18;
// Kinds. Every size has its thin axis on local y, so a part lies flat with
// its rotation about x and z back at 0.
export const PART = { chunk: 0, door: 1, wheel: 2, bonnet: 3, bumper: 4, panel: 5 };
const G = 9.8;
const DRAG_GROUND = 6; // 1/s sliding to a stop
const LAY_K = 10; // 1/s easing to lie flat

export function createParts(max = PARTS_MAX) {
  const f = () => new Float32Array(max);
  return {
    max, head: 0, seq: 0,
    kind: new Uint8Array(max), col: new Uint32Array(max), blast: new Int32Array(max).fill(-1),
    x: f(), y: f(), z: f(), vx: f(), vy: f(), vz: f(),
    rx: f(), ry: f(), rz: f(), wx: f(), wy: f(), wz: f(),
    sx: f(), sy: f(), sz: f(),
    age: new Float32Array(max).fill(-1), // < 0: free
    hits: new Uint8Array(max), // ground contacts so far (0, 1 = bounced, 2 = lying)
  };
}

// A free slot, else the oldest one.
function slot(P) {
  let best = -1, bestAge = -1;
  for (let k = 0; k < P.max; k++) {
    const i = (P.head + k) % P.max;
    if (P.age[i] < 0) {
      P.head = (i + 1) % P.max;
      return i;
    }
    if (P.age[i] > bestAge) {
      bestAge = P.age[i];
      best = i;
    }
  }
  P.head = (best + 1) % P.max;
  return best;
}
export const freeParts = (P) => {
  let n = 0;
  for (let i = 0; i < P.max; i++) if (P.age[i] < 0) n++;
  return n;
};
export const liveParts = (P) => P.max - freeParts(P);

// One part: from (x, y, z), speed sp at elevation el toward azimuth az.
export function addPart(P, kind, x, y, z, sp, el, az, sx, sy, sz, hex, rng, blast = -1) {
  const i = slot(P);
  const h = sp * Math.cos(el);
  P.kind[i] = kind;
  P.col[i] = hex >>> 0;
  P.blast[i] = blast;
  P.x[i] = x; P.y[i] = y; P.z[i] = z;
  P.vx[i] = Math.cos(az) * h; P.vy[i] = sp * Math.sin(el); P.vz[i] = Math.sin(az) * h;
  P.rx[i] = rng.next() * 6.283; P.ry[i] = rng.next() * 6.283; P.rz[i] = rng.next() * 6.283;
  const spin = kind === PART.chunk ? 12 : 7;
  P.wx[i] = (rng.next() * 2 - 1) * spin; P.wy[i] = (rng.next() * 2 - 1) * spin; P.wz[i] = (rng.next() * 2 - 1) * spin;
  P.sx[i] = sx; P.sy[i] = sy; P.sz[i] = sz;
  P.age[i] = 0;
  P.hits[i] = 0;
  return i;
}

// Darken a hex colour by k (scorched paint).
export function burnt(hex, k) {
  const r = (hex >> 16) & 255, g = (hex >> 8) & 255, b = hex & 255;
  return ((Math.round(r * k) << 16) | (Math.round(g * k) << 8) | Math.round(b * k)) >>> 0;
}

const METAL = [0x2b2d31, 0x3a3c40, 0x1d1e20, 0x4a4540];
// Throw a car's parts. c: { id, kind, color, spec { length, width, height } }.
// Returns the number of parts thrown; `out.door`, `out.wheel`, ... count the
// recognisable ones (tests).
export function launchCarParts(P, c, x, y, z, out = null) {
  const sp = (c && c.spec) || {};
  const L = sp.length || 4.4, W = sp.width || 1.8, H = sp.height || 1.4;
  const id = c && Number.isFinite(c.id) ? c.id : 0;
  const rng = createRng((Math.imul(id + 1, 0x9e3779b1) ^ 0x5bd1e995) >>> 0);
  const paint = typeof (c && c.color) === 'number' ? c.color : 0x884433;
  const skin = burnt(paint, 0.8);
  const blast = P.seq++;
  const n = PARTS_MIN + Math.floor(rng.next() * (PARTS_MAXPER - PARTS_MIN + 1));
  // The pool has room for the extras when a whole car's worth is free.
  const room = freeParts(P) >= PARTS_MAXPER;
  const y0 = Math.max(0.5, y);
  const wr = Math.max(0.3, Math.min(0.42, H * 0.24)), tw = 0.22;
  if (out) out.door = out.wheel = out.bonnet = out.bumper = out.n = 0;
  for (let k = 0; k < n; k++) {
    const az = (k / n) * 6.283 + rng.next() * 0.9;
    const v = PART_V0 + rng.next() * (PART_V1 - PART_V0);
    const el = PART_EL0 + rng.next() * (PART_EL1 - PART_EL0);
    const ox = Math.cos(az) * L * 0.25, oz = Math.sin(az) * W * 0.25;
    let kind = PART.chunk, sx, sy, sz, hex;
    if (k === 0 || (k === 4 && room)) {
      kind = PART.door; sx = L * 0.26; sy = 0.07; sz = H * 0.6; hex = skin;
    } else if (k === 1 || (k === 5 && room)) {
      kind = PART.wheel; sx = sz = wr * 2; sy = tw; hex = 0xffffff;
    } else if (k === 2) {
      kind = PART.bonnet; sx = L * 0.3; sy = 0.06; sz = W * 0.82; hex = skin;
    } else if (k === 3) {
      kind = PART.bumper; sx = W * 0.95; sy = 0.22; sz = 0.26; hex = rng.next() < 0.5 ? 0x26272a : skin;
    } else if (k % 3 === 0) {
      kind = PART.panel; sx = 0.4 + rng.next() * 0.6; sy = 0.05; sz = 0.3 + rng.next() * 0.5; hex = skin;
    } else {
      const s = 0.18 + rng.next() * 0.42;
      sx = s * (0.8 + rng.next() * 0.8); sy = s * (0.5 + rng.next() * 0.6); sz = s * (0.8 + rng.next() * 0.6);
      hex = METAL[Math.floor(rng.next() * METAL.length)];
    }
    addPart(P, kind, x + ox, y0, z + oz, v, el, az, sx, sy, sz, hex, rng, blast);
    if (out) {
      out.n++;
      if (kind === PART.door) out.door++;
      else if (kind === PART.wheel) out.wheel++;
      else if (kind === PART.bonnet) out.bonnet++;
      else if (kind === PART.bumper) out.bumper++;
    }
  }
  return n;
}

// Scale 1 while lying, shrinking to 0 over the last PART_FADE_T s.
export function partScale(P, i) {
  const a = P.age[i];
  if (a < 0) return 0;
  const left = PART_LIE_T + PART_FADE_T - a;
  return left >= PART_FADE_T ? 1 : left > 0 ? left / PART_FADE_T : 0;
}

const wrap = (a) => {
  const t = a % 6.283185307179586;
  return t > Math.PI ? t - 6.283185307179586 : t < -Math.PI ? t + 6.283185307179586 : t;
};
// One fixed step. onLand(i, speed) is called at a part's first ground hit.
export function stepParts(P, dt, onLand = null) {
  for (let i = 0; i < P.max; i++) {
    if (P.age[i] < 0) continue;
    P.age[i] += dt;
    if (P.age[i] >= PART_LIE_T + PART_FADE_T) {
      P.age[i] = -1;
      continue;
    }
    if (P.hits[i] >= 2) {
      // Lying: slide to a stop and settle flat.
      const f = Math.exp(-DRAG_GROUND * dt);
      P.vx[i] *= f;
      P.vz[i] *= f;
      P.x[i] += P.vx[i] * dt;
      P.z[i] += P.vz[i] * dt;
      const e = 1 - Math.exp(-LAY_K * dt);
      P.rx[i] -= wrap(P.rx[i]) * e;
      P.rz[i] -= wrap(P.rz[i]) * e;
      P.y[i] += (P.sy[i] * 0.5 - P.y[i]) * e;
      continue;
    }
    P.vy[i] -= G * dt;
    P.x[i] += P.vx[i] * dt;
    P.y[i] += P.vy[i] * dt;
    P.z[i] += P.vz[i] * dt;
    P.rx[i] += P.wx[i] * dt;
    P.ry[i] += P.wy[i] * dt;
    P.rz[i] += P.wz[i] * dt;
    const floor = Math.max(P.sx[i], P.sy[i], P.sz[i]) * 0.3;
    if (P.y[i] < floor && P.vy[i] < 0) {
      const sp = Math.sqrt(P.vx[i] * P.vx[i] + P.vy[i] * P.vy[i] + P.vz[i] * P.vz[i]);
      P.y[i] = floor;
      if (P.hits[i] === 0 && P.vy[i] < -1.5) {
        // The one bounce: 0.3 of the speed kept.
        P.hits[i] = 1;
        P.vy[i] = -P.vy[i] * PART_KEEP;
        P.vx[i] *= PART_KEEP;
        P.vz[i] *= PART_KEEP;
        P.wx[i] *= 0.5; P.wy[i] *= 0.5; P.wz[i] *= 0.5;
        if (onLand) onLand(i, sp);
      } else {
        if (P.hits[i] === 0 && onLand) onLand(i, sp);
        P.hits[i] = 2;
        P.vy[i] = 0;
        P.wx[i] = P.wy[i] = P.wz[i] = 0;
      }
    }
  }
}
