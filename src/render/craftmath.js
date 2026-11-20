// Pure maths for the craft meshes (no three.js, no DOM): airfoil and
// hull section shapes, the shared detail texture and rotor blur pixels,
// and the visual-only rig state (control surfaces, landing gear) that the
// mesh update functions read. Everything here runs in node tests.
import { createRng, clamp } from '../core/rng.js';

// Half thickness of a symmetric 4-digit style airfoil at chord share u
// (0 leading edge .. 1 trailing edge) for thickness ratio t.
export function airfoilHalf(u, t) {
  const x = clamp(u, 0, 1);
  return 5 * t * (0.2969 * Math.sqrt(x) - 0.126 * x - 0.3516 * x * x + 0.2843 * x * x * x - 0.1036 * x * x * x * x);
}

// n + 1 chord shares from 0 to 1, bunched at both edges (cosine spacing),
// optionally clipped to [u0, u1] (the ends are always included).
export function chordShares(n, u0 = 0, u1 = 1) {
  const out = [u0];
  for (let k = 1; k < n; k++) {
    const u = (1 - Math.cos((Math.PI * k) / n)) / 2;
    if (u > u0 + 0.01 && u < u1 - 0.01) out.push(u);
  }
  out.push(u1);
  return out;
}

// A superellipse section point: angle a (0 = +z side, pi/2 = top), half
// width hw, top and bottom half heights, exponent e (2 ellipse, larger is
// boxier). Writes [z, dy] into out.
export function superPoint(a, hw, top, bot, e, out) {
  const c = Math.cos(a), s = Math.sin(a);
  const p = 2 / e;
  out[0] = hw * Math.sign(c) * Math.pow(Math.abs(c), p);
  out[1] = (s >= 0 ? top : bot) * Math.sign(s) * Math.pow(Math.abs(s), p);
  return out;
}

// Monotone cubic through [[t, v], ...] sorted by t (clamped outside).
export function monotone(pts) {
  const n = pts.length;
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  if (n === 1) return () => ys[0];
  const d = [], m = new Array(n);
  for (let i = 0; i < n - 1; i++) d.push((ys[i + 1] - ys[i]) / (xs[i + 1] - xs[i] || 1e-9));
  m[0] = d[0];
  m[n - 1] = d[n - 2];
  for (let i = 1; i < n - 1; i++) m[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2;
  for (let i = 0; i < n - 1; i++) {
    if (d[i] === 0) {
      m[i] = 0;
      m[i + 1] = 0;
      continue;
    }
    const a = m[i] / d[i], b = m[i + 1] / d[i];
    const s = a * a + b * b;
    if (s > 9) {
      const k = 3 / Math.sqrt(s);
      m[i] = k * a * d[i];
      m[i + 1] = k * b * d[i];
    }
  }
  return (x) => {
    if (x <= xs[0]) return ys[0];
    if (x >= xs[n - 1]) return ys[n - 1];
    let i = 0;
    while (i < n - 2 && x > xs[i + 1]) i++;
    const h = xs[i + 1] - xs[i];
    const t = (x - xs[i]) / h;
    const t2 = t * t, t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * ys[i] + (t3 - 2 * t2 + t) * h * m[i] + (-2 * t3 + 3 * t2) * ys[i + 1] + (t3 - t2) * h * m[i + 1];
  };
}

// Tileable value noise on a period x period lattice, sampled at (x, y) in
// lattice units.
function lattice(rng, period) {
  const v = new Float32Array(period * period);
  for (let i = 0; i < v.length; i++) v[i] = rng.next();
  return (x, y) => {
    const xi = Math.floor(x), yi = Math.floor(y);
    let fx = x - xi, fy = y - yi;
    fx = fx * fx * (3 - 2 * fx);
    fy = fy * fy * (3 - 2 * fy);
    const x0 = ((xi % period) + period) % period, y0 = ((yi % period) + period) % period;
    const x1 = (x0 + 1) % period, y1 = (y0 + 1) % period;
    const a = v[y0 * period + x0], b = v[y0 * period + x1], c = v[y1 * period + x0], d = v[y1 * period + x1];
    return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
  };
}

// The shared craft detail texture, RGBA bytes, size x size, tiling:
// R panel seams, G rivet dots, B grime (0.5 = neutral), A large soft
// blobs for camouflage. Panels come from a seeded split of a 4 x 4 grid.
export function detailPixels(size = 512, seed = 7) {
  const rng = createRng(seed);
  const px = new Uint8Array(size * size * 4);
  const seam = new Float32Array(size * size);
  const rivet = new Float32Array(size * size);
  const cell = size / 4;
  const rects = [];
  for (let gy = 0; gy < 4; gy++) {
    for (let gx = 0; gx < 4; gx++) {
      const split = (x, y, w, h, depth) => {
        if (depth < 2 && rng.chance(0.7) && Math.max(w, h) > 40) {
          if (w > h ? rng.chance(0.8) : rng.chance(0.2)) {
            const s = Math.round(w * rng.range(0.35, 0.65));
            split(x, y, s, h, depth + 1);
            split(x + s, y, w - s, h, depth + 1);
          } else {
            const s = Math.round(h * rng.range(0.35, 0.65));
            split(x, y, w, s, depth + 1);
            split(x, y + s, w, h - s, depth + 1);
          }
        } else rects.push([x, y, w, h, rng.chance(0.55)]);
      };
      split(gx * cell, gy * cell, cell, cell, 0);
    }
  }
  const put = (arr, x, y, v) => {
    const i = (((y % size) + size) % size) * size + (((x % size) + size) % size);
    if (v > arr[i]) arr[i] = v;
  };
  for (const [x, y, w, h, riv] of rects) {
    for (let k = 0; k <= w; k++) {
      put(seam, x + k, y, 1);
      put(seam, x + k, y + 1, 0.35);
      put(seam, x + k, y + h, 1);
    }
    for (let k = 0; k <= h; k++) {
      put(seam, x, y + k, 1);
      put(seam, x + 1, y + k, 0.35);
      put(seam, x + w, y + k, 1);
    }
    if (riv) {
      for (let k = 5; k < w - 3; k += 7) {
        put(rivet, x + k, y + 4, 1);
        put(rivet, x + k, y + h - 4, 1);
      }
      for (let k = 5; k < h - 3; k += 7) {
        put(rivet, x + 4, y + k, 1);
        put(rivet, x + w - 4, y + k, 1);
      }
    }
  }
  const n1 = lattice(rng, 8), n2 = lattice(rng, 16), n3 = lattice(rng, 32), n4 = lattice(rng, 64);
  const c1 = lattice(rng, 3), c2 = lattice(rng, 6);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      const u = x / size, v = y / size;
      const g = n1(u * 8, v * 8) * 0.45 + n2(u * 16, v * 16) * 0.28 + n3(u * 32, v * 32) * 0.17 + n4(u * 64, v * 64) * 0.1;
      // Soft dot for rivets: spread the single pixel a little.
      let r = rivet[i];
      if (!r) {
        const l = rivet[y * size + ((x + 1) % size)] + rivet[y * size + ((x + size - 1) % size)];
        const t = rivet[((y + 1) % size) * size + x] + rivet[((y + size - 1) % size) * size + x];
        r = Math.min(1, (l + t) * 0.35);
      }
      const camo = c1(u * 3, v * 3) * 0.65 + c2(u * 6, v * 6) * 0.35;
      px[i * 4] = Math.round(seam[i] * 255);
      px[i * 4 + 1] = Math.round(r * 255);
      px[i * 4 + 2] = Math.round(clamp(0.5 + (g - 0.5) * 1.6, 0, 1) * 255);
      px[i * 4 + 3] = Math.round(clamp(camo, 0, 1) * 255);
    }
  }
  return px;
}

// Rotor / propeller blur disc: RGBA bytes, a faint swept-blade haze with
// streak bands, a brighter tip ring and a dark hub.
export function blurPixels(size = 128, blades = 4) {
  const px = new Uint8Array(size * size * 4);
  const h = size / 2;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (x + 0.5 - h) / h, dy = (y + 0.5 - h) / h;
      const r = Math.hypot(dx, dy);
      const a = Math.atan2(dy, dx);
      const i = (y * size + x) * 4;
      let al = 0;
      let lum = 40;
      if (r < 1) {
        const streak = 0.5 + 0.5 * Math.cos(a * blades * 2 + r * 3);
        al = 0.16 + 0.1 * streak * r;
        if (r > 0.9) {
          al += 0.22 * (1 - Math.abs(r - 0.95) / 0.05);
          lum = 200;
        }
        if (r < 0.12) al = 0.5;
        al *= clamp((1 - r) / 0.02, 0, 1);
      }
      px[i] = px[i + 1] = px[i + 2] = lum;
      px[i + 3] = Math.round(clamp(al, 0, 1) * 255);
    }
  }
  return px;
}

const approach = (v, t, step) => (v < t ? Math.min(t, v + step) : Math.max(t, v - step));

// Visual rig of an aircraft: control surface deflections (-1..1), flap
// (0..1) and gear (0 down .. 1 up), eased toward what the craft is doing.
// `st` is the mesh's own state { ail, elev, rud, flap, gear, pitch }.
export function stepAircraftRig(st, a, dt) {
  const d = clamp(Number.isFinite(dt) ? dt : 0, 0, 0.1);
  const spec = a.spec || {};
  const steer = clamp(Number.isFinite(a.steer) ? a.steer : 0, -1, 1);
  const pitch = Number.isFinite(a.pitch) ? a.pitch : 0;
  const prate = d > 0 && Number.isFinite(st.pitch) ? (pitch - st.pitch) / d : 0;
  st.pitch = pitch;
  const live = !a.wrecked && !!a.driver;
  const elevT = live ? clamp(prate / Math.max(0.5, spec.pitchRate || 2) * 2.2, -1, 1) : 0;
  st.ail = approach(st.ail, live ? steer : 0, 6 * d);
  st.elev = approach(st.elev, elevT, 5 * d);
  st.rud = approach(st.rud, live ? steer * (a.onGround ? 1 : 0.35) : 0, 5 * d);
  const stall = spec.stallSpeed || 20;
  const slow = (a.airspeed == null ? Math.abs(a.speed || 0) : a.airspeed) < stall * 1.7;
  st.flap = approach(st.flap, slow && !a.onWater ? 1 : 0, 0.6 * d);
  // Gear: up once clear of the ground and flying, down when slow or low.
  const y = Number.isFinite(a.y) ? a.y : 0;
  const up = !a.onGround && y > 8 && !slow;
  st.gear = approach(st.gear, up ? 1 : 0, (up ? 0.35 : 0.5) * d);
  if (a.onGround) st.gear = 0;
  return st;
}

// Wrap an angle into [0, 2 pi) so shader sin / cos stay precise.
export function wrapAngle(a) {
  const t = Math.PI * 2;
  if (!Number.isFinite(a)) return 0;
  return ((a % t) + t) % t;
}

// How many of `slots` stores are still on the craft for a mount.
export function storesLeft(craft, mountId, slots) {
  const arms = craft && craft.arms;
  if (!arms || !arms.mag || !(mountId in arms.mag)) return slots;
  return clamp(Math.floor(arms.mag[mountId]), 0, slots);
}
