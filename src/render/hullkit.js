// Shared kit for the boat, aircraft and tank meshes: a geometry builder
// (smooth lofts, lathes, swept tubes, airfoil panels, flat plates) that
// writes position, normal, colour, surface class (aCls, see vehiclemats)
// and a small rig attribute, plus one PBR skin material per craft.
//
// Rig: every vertex carries aHng = (code, pivot xyz) and aHax (axis whose
// length is the gain). The skin's vertex shader turns tagged vertices
// about their hinge by a uniform (control surfaces, gear, wheels, rotor
// blades) or collapses them (fired stores, blurred blades, strobe off),
// so a whole airframe stays one draw call. Codes are in RIG below.
//
// Skin: the vehiclemats class patch (glass, chrome, rubber, damage, soot)
// plus a triplanar detail texture (panel seams, rivets, grime, camo),
// a seam bump, track link pattern and a hit flash. One texture shared.
import * as THREE from 'three';
import { craftMaterial, CLS } from './vehiclemats.js';
import { airfoilHalf, chordShares, superPoint, monotone, detailPixels, blurPixels } from './craftmath.js';

export { CLS };

export const RIG = {
  NONE: 0, AILERON: 1, ELEVATOR: 2, RUDDER: 3, FLAP: 4, GEAR: 5, TAIL_R: 6, TAIL_L: 7,
  WHEEL_L: 8, WHEEL_R: 9, MISSILE: 10, BOMB: 20, STROBE: 30, SPIN: 31, SPIN2: 32, TRACK_L: 40, TRACK_R: 41,
};

const linCache = new Map();
const tc = new THREE.Color();
function lin(hex) {
  let c = linCache.get(hex);
  if (!c) {
    tc.setHex(hex);
    c = [tc.r, tc.g, tc.b];
    linCache.set(hex, c);
  }
  return c;
}

// Scale an sRGB hex colour's brightness.
export function shade(hex, k) {
  tc.setHex(hex);
  tc.r = Math.min(1, tc.r * k);
  tc.g = Math.min(1, tc.g * k);
  tc.b = Math.min(1, tc.b * k);
  return tc.getHex();
}

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm = (a) => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};
const scl = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];

// Two unit vectors perpendicular to unit d.
function basis(d) {
  const ref = Math.abs(d[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  const u = norm(cross(d, ref));
  const v = cross(d, u);
  return [u, v];
}

export class Kit {
  constructor(q = 1) {
    this.q = q; // quality: 1 near, about 0.5 for the far LOD
    this.p = [];
    this.n = [];
    this.c = [];
    this.k = [];
    this.h = [];
    this.a = [];
    this.i = [];
    this.count = 0;
    this.rig = [0, 0, 0, 0, 0, 0, 0];
  }

  // Segments scaled by quality, never below lo.
  seg(n, lo = 3) {
    return Math.max(lo, Math.round(n * this.q));
  }

  setRig(code, pivot = [0, 0, 0], axis = [0, 0, 0]) {
    const r = this.rig;
    r[0] = code;
    r[1] = pivot[0]; r[2] = pivot[1]; r[3] = pivot[2];
    r[4] = axis[0]; r[5] = axis[1]; r[6] = axis[2];
    return this;
  }

  noRig() {
    this.rig.fill(0);
    return this;
  }

  vert(x, y, z, nx, ny, nz, col, cls) {
    const r = this.rig;
    this.p.push(x, y, z);
    this.n.push(nx, ny, nz);
    this.c.push(col[0], col[1], col[2]);
    this.k.push(cls);
    this.h.push(r[0], r[1], r[2], r[3]);
    this.a.push(r[4], r[5], r[6]);
    return this.count++;
  }

  // Track vertices carry their distance along the loop in aHax.x.
  vertTrack(x, y, z, nx, ny, nz, col, cls, dist) {
    const id = this.vert(x, y, z, nx, ny, nz, col, cls);
    this.a[id * 3] = dist;
    return id;
  }

  // Flat triangle facing away from `inside` (or as wound if null).
  ftri(A, B, C, hex, cls, inside = null) {
    let n = cross(sub(B, A), sub(C, A));
    const l = Math.hypot(n[0], n[1], n[2]);
    if (l < 1e-10) return;
    n = scl(n, 1 / l);
    if (inside) {
      const c = [(A[0] + B[0] + C[0]) / 3 - inside[0], (A[1] + B[1] + C[1]) / 3 - inside[1], (A[2] + B[2] + C[2]) / 3 - inside[2]];
      if (dot(n, c) < 0) {
        const t = B; B = C; C = t;
        n = scl(n, -1);
      }
    }
    const col = lin(hex);
    const a = this.vert(A[0], A[1], A[2], n[0], n[1], n[2], col, cls);
    const b = this.vert(B[0], B[1], B[2], n[0], n[1], n[2], col, cls);
    const c = this.vert(C[0], C[1], C[2], n[0], n[1], n[2], col, cls);
    this.i.push(a, b, c);
  }

  fquad(A, B, C, D, hex, cls, inside = null) {
    this.ftri(A, B, C, hex, cls, inside);
    this.ftri(A, C, D, hex, cls, inside);
  }

  // Smooth grid P[i][j] (stations i, ring j). opts: wrap (ring closed),
  // expect(i, j, c) -> wanted outward direction of face (i, j) at centre c
  // (default: away from the centroid of rings i and i + 1), col(i, j) ->
  // [hex, cls] per vertex (default hex, cls).
  grid(P, hex, cls, opts = {}) {
    const S = P.length, R = P[0].length;
    const wrap = !!opts.wrap;
    const FR = wrap ? R : R - 1;
    const base = this.count;
    const nrm = new Float64Array(S * R * 3);
    const cent = [];
    for (let i = 0; i < S; i++) {
      let x = 0, y = 0, z = 0;
      for (let j = 0; j < R; j++) {
        x += P[i][j][0]; y += P[i][j][1]; z += P[i][j][2];
      }
      cent.push([x / R, y / R, z / R]);
    }
    const tris = [];
    for (let i = 0; i < S - 1; i++) {
      for (let j = 0; j < FR; j++) {
        const j1 = (j + 1) % R;
        const a = P[i][j], b = P[i + 1][j], c = P[i + 1][j1], d = P[i][j1];
        let n = cross(sub(c, a), sub(d, b));
        const l = Math.hypot(n[0], n[1], n[2]);
        if (l < 1e-12) continue;
        const fc = [(a[0] + b[0] + c[0] + d[0]) / 4, (a[1] + b[1] + c[1] + d[1]) / 4, (a[2] + b[2] + c[2] + d[2]) / 4];
        const e = opts.expect ? opts.expect(i, j, fc) : sub(fc, scl(add(cent[i], cent[i + 1]), 0.5));
        const flip = dot(n, e) < 0;
        if (flip) n = scl(n, -1);
        const ids = [i * R + j, (i + 1) * R + j, (i + 1) * R + j1, i * R + j1];
        for (const v of ids) {
          nrm[v * 3] += n[0]; nrm[v * 3 + 1] += n[1]; nrm[v * 3 + 2] += n[2];
        }
        if (flip) tris.push(ids[0], ids[2], ids[1], ids[0], ids[3], ids[2]);
        else tris.push(ids[0], ids[1], ids[2], ids[0], ids[2], ids[3]);
      }
    }
    for (let i = 0; i < S; i++) {
      for (let j = 0; j < R; j++) {
        const v = i * R + j;
        const n = norm([nrm[v * 3], nrm[v * 3 + 1], nrm[v * 3 + 2]]);
        let h = hex, k = cls;
        if (opts.col) [h, k] = opts.col(i, j, P[i][j]);
        this.vert(P[i][j][0], P[i][j][1], P[i][j][2], n[0], n[1], n[2], lin(h), k);
      }
    }
    for (const t of tris) this.i.push(base + t);
  }

  // Flat fan cap over a ring of points, facing away from `inside`.
  cap(ring, hex, cls, inside) {
    const c = [0, 0, 0];
    for (const p of ring) {
      c[0] += p[0] / ring.length; c[1] += p[1] / ring.length; c[2] += p[2] / ring.length;
    }
    for (let j = 0; j < ring.length; j++) this.ftri(c, ring[j], ring[(j + 1) % ring.length], hex, cls, inside);
  }

  // Body of revolution-like loft along x through key stations
  // [x, cy, hw, top, bot, e]: values are eased between keys, `steps`
  // stations, `seg` ring points. opts.z offsets it sideways, opts.col(x,
  // a, p) -> [hex, cls] per vertex, opts.capEnds caps both ends.
  loft(keys, hex, cls, opts = {}) {
    const steps = this.seg(opts.steps || 16, 3), seg = this.seg(opts.seg || 16, 6);
    const ks = keys.map((k) => k.slice()).sort((a, b) => a[0] - b[0]);
    const f = [1, 2, 3, 4, 5].map((c) => monotone(ks.map((k) => [k[0], k[c] == null ? 2 : k[c]])));
    const x0 = ks[0][0], x1 = ks[ks.length - 1][0];
    const zo = opts.z || 0;
    const P = [];
    const xs = [];
    // Stations: the keys plus evenly spaced ones.
    for (let s = 0; s <= steps; s++) xs.push(x0 + (x1 - x0) * (s / steps));
    for (const k of ks) xs.push(k[0]);
    xs.sort((a, b) => a - b);
    const ux = xs.filter((x, i) => i === 0 || x - xs[i - 1] > 1e-3);
    const sp = [0, 0];
    for (const x of ux) {
      const cy = f[0](x), hw = Math.max(0.001, f[1](x)), top = Math.max(0.001, f[2](x)), bot = Math.max(0.001, f[3](x)), e = f[4](x);
      const ring = [];
      for (let j = 0; j < seg; j++) {
        const a = (j / seg) * Math.PI * 2;
        superPoint(a, hw, top, bot, e, sp);
        ring.push([x, cy + sp[1], zo + sp[0]]);
      }
      P.push(ring);
    }
    const col = opts.col ? (i, j, p) => opts.col(p[0], (j / seg) * Math.PI * 2, p) : null;
    this.grid(P, hex, cls, { wrap: true, col });
    if (opts.capEnds) {
      this.cap(P[0], hex, cls, [x0 + 1, f[0](x0), zo]);
      const last = P[P.length - 1];
      this.cap(last, hex, cls, [x1 - 1, f[0](x1), zo]);
    }
    return P;
  }

  // Surface of revolution along unit axis d from origin o: runs is a list
  // of { pts: [[along, r], ...], hex, cls }; each run is smooth, the
  // joints between runs are creases. Facing follows the profile: moving
  // +along faces out, moving to larger r faces -along.
  lathe(runs, seg, o, d, opts = {}) {
    const sg = this.seg(seg, 5);
    const [u, v] = basis(norm(d));
    const dd = norm(d);
    const ph = opts.phase || 0;
    for (const run of runs) {
      const pts = run.pts;
      if (pts.length < 2) continue;
      const P = [];
      for (const [al, r] of pts) {
        const ring = [];
        for (let j = 0; j < sg; j++) {
          const a = ph + (j / sg) * Math.PI * 2;
          const ca = Math.cos(a) * r, sa = Math.sin(a) * r;
          ring.push([o[0] + dd[0] * al + u[0] * ca + v[0] * sa, o[1] + dd[1] * al + u[1] * ca + v[1] * sa, o[2] + dd[2] * al + u[2] * ca + v[2] * sa]);
        }
        P.push(ring);
      }
      this.grid(P, run.hex, run.cls, {
        wrap: true,
        expect: (i, j) => {
          const dA = pts[i + 1][0] - pts[i][0], dR = pts[i + 1][1] - pts[i][1];
          const a = ph + ((j + 0.5) / sg) * Math.PI * 2;
          const rad = add(scl(u, Math.cos(a)), scl(v, Math.sin(a)));
          return add(scl(dd, -dR), scl(rad, dA));
        },
      });
    }
  }

  // Closed cylinder / cone between points A and B.
  tube(A, B, r0, r1, hex, cls, seg = 8, capped = true) {
    const d = sub(B, A);
    const len = Math.hypot(d[0], d[1], d[2]);
    if (len < 1e-6) return;
    const runs = [{ pts: [[0, r0], [len, r1]], hex, cls }];
    if (capped) {
      runs.push({ pts: [[0, 0], [0, r0]], hex, cls });
      runs.push({ pts: [[len, r1], [len, 0]], hex, cls });
    }
    this.lathe(runs, seg, A, d);
  }

  // Tube swept along a polyline (parallel transported frame).
  sweep(pts, r, hex, cls, seg = 6, capped = true) {
    if (pts.length < 2) return;
    const sg = this.seg(seg, 4);
    let t0 = norm(sub(pts[1], pts[0]));
    let [u] = basis(t0);
    const P = [];
    for (let i = 0; i < pts.length; i++) {
      const t = i === 0 ? t0 : i === pts.length - 1 ? norm(sub(pts[i], pts[i - 1])) : norm(sub(pts[i + 1], pts[i - 1]));
      u = norm(sub(u, scl(t, dot(u, t))));
      const v = cross(t, u);
      const rr = Array.isArray(r) ? r[i] : r;
      const ring = [];
      for (let j = 0; j < sg; j++) {
        const a = (j / sg) * Math.PI * 2;
        ring.push(add(pts[i], add(scl(u, Math.cos(a) * rr), scl(v, Math.sin(a) * rr))));
      }
      P.push(ring);
      t0 = t;
    }
    this.grid(P, hex, cls, {
      wrap: true,
      expect: (i, j, c) => {
        const m = scl(add(pts[i], pts[i + 1]), 0.5);
        return sub(c, m);
      },
    });
    if (capped) {
      this.cap(P[0], hex, cls, pts[1]);
      this.cap(P[P.length - 1], hex, cls, pts[pts.length - 2]);
    }
  }

  // Convex solid from 8 corners (0-3 one face ring, 4-7 the other).
  hexa(v, hex, cls) {
    const c = [0, 0, 0];
    for (const p of v) {
      c[0] += p[0] / 8; c[1] += p[1] / 8; c[2] += p[2] / 8;
    }
    const Q = [[0, 1, 2, 3], [7, 6, 5, 4], [3, 2, 6, 7], [1, 0, 4, 5], [2, 1, 5, 6], [0, 3, 7, 4]];
    for (const q of Q) this.fquad(v[q[0]], v[q[1]], v[q[2]], v[q[3]], hex, cls, c);
  }

  box(cx, cy, cz, sx, sy, sz, hex, cls) {
    const x0 = cx - sx / 2, x1 = cx + sx / 2, y0 = cy - sy / 2, y1 = cy + sy / 2, z0 = cz - sz / 2, z1 = cz + sz / 2;
    this.hexa([[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], [x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1]], hex, cls);
  }

  // Faceted convex slab: bottom polygon at y0 and top polygon at y1 (same
  // count, [x, z] points in order), flat faces.
  slab(bot, top, y0, y1, hex, cls, opts = {}) {
    const n = bot.length;
    const B = bot.map((p) => [p[0], y0, p[1]]), T = top.map((p) => [p[0], y1, p[1]]);
    const c = [0, (y0 + y1) / 2, 0];
    for (const p of bot) {
      c[0] += p[0] / n; c[2] += p[1] / n;
    }
    for (let j = 0; j < n; j++) {
      const j1 = (j + 1) % n;
      this.fquad(B[j], B[j1], T[j1], T[j], opts.sideHex || hex, cls, c);
    }
    if (opts.top !== false) this.cap(T, hex, cls, c);
    if (opts.bottom !== false) this.cap(B, hex, cls, c);
  }

  // Side profile [[x, y], ...] (convex) extruded across z0..z1.
  prism(pts, z0, z1, hex, cls) {
    const n = pts.length;
    const c = [0, 0, (z0 + z1) / 2];
    for (const p of pts) {
      c[0] += p[0] / n; c[1] += p[1] / n;
    }
    const A = pts.map((p) => [p[0], p[1], z0]), B = pts.map((p) => [p[0], p[1], z1]);
    for (let j = 0; j < n; j++) {
      const j1 = (j + 1) % n;
      this.fquad(A[j], A[j1], B[j1], B[j], hex, cls, c);
    }
    this.cap(A, hex, cls, c);
    this.cap(B, hex, cls, c);
  }

  // Rounded box (cushions, cowls): a superellipse loft with eased ends.
  rbox(cx, cy, cz, sx, sy, sz, hex, cls, r = 0.25, e = 4) {
    const hx = sx / 2, hw = sz / 2, hh = sy / 2;
    const k = Math.min(r, 0.45);
    this.loft([
      [cx - hx, cy, hw * 0.55, hh * 0.55, hh * 0.55, e],
      [cx - hx * (1 - k * 0.6), cy, hw * 0.94, hh * 0.94, hh * 0.94, e],
      [cx - hx * (1 - k * 1.6), cy, hw, hh, hh, e],
      [cx + hx * (1 - k * 1.6), cy, hw, hh, hh, e],
      [cx + hx * (1 - k * 0.6), cy, hw * 0.94, hh * 0.94, hh * 0.94, e],
      [cx + hx, cy, hw * 0.55, hh * 0.55, hh * 0.55, e],
    ], hex, cls, { steps: 2, seg: 12, capEnds: true });
  }

  // Airfoil panel between a root and a tip section. Sections are
  // { le: [x, y, z], c (chord, along -x), t (thickness ratio) }; up is the
  // thickness direction (default +y). u0..u1 is the chord share covered
  // (control surfaces). Returns a surface lookup (s, u) -> point on top.
  wing(root, tip, hex, cls, opts = {}) {
    const up = norm(opts.up || [0, 1, 0]);
    const u0 = opts.u0 || 0, u1 = opts.u1 == null ? 1 : opts.u1;
    const us = chordShares(this.seg(opts.n || 9, 4), u0, u1);
    const camber = opts.camber == null ? 0.015 : opts.camber;
    const sect = (s, sign, u) => {
      const le = add(root.le, scl(sub(tip.le, root.le), s));
      const c = root.c + (tip.c - root.c) * s;
      const t = root.t + (tip.t - root.t) * s;
      const cam = camber * 4 * u * (1 - u) * c;
      return add(add(le, [-c * u, 0, 0]), scl(up, sign * airfoilHalf(u, t) * c + cam));
    };
    const ring = (s) => {
      const r = [];
      for (let k = us.length - 1; k >= 0; k--) r.push(sect(s, 1, us[k]));
      for (let k = u0 > 0.001 ? 0 : 1; k < us.length; k++) r.push(sect(s, -1, us[k]));
      if (u1 < 0.999) r.push(sect(s, 1, u1));
      return r;
    };
    const steps = Math.max(1, opts.steps || 1);
    const P = [];
    for (let s = 0; s <= steps; s++) P.push(ring(s / steps));
    const mid = scl(add(add(root.le, [-root.c * (u0 + u1) / 2, 0, 0]), add(tip.le, [-tip.c * (u0 + u1) / 2, 0, 0])), 0.5);
    this.grid(P, hex, cls, {
      expect: (i, j, c) => {
        const le = add(root.le, scl(sub(tip.le, root.le), (i + 0.5) / steps));
        const cc = root.c + (tip.c - root.c) * ((i + 0.5) / steps);
        const ax = add(le, [-cc * (u0 + u1) / 2, 0, 0]);
        const off = sub(c, ax);
        // Mostly up / down, but the nose faces forward.
        return add(scl(up, dot(off, up) * 4), [off[0], 0, 0]);
      },
    });
    if (opts.capTip !== false) this.cap(P[P.length - 1], hex, cls, mid);
    if (opts.capRoot) this.cap(P[0], hex, cls, mid);
    return (s, u) => sect(s, 1, u);
  }
}

// Analytic surface of a loft (same keys): (x, a, out) -> point at station
// x and ring angle a (0 = +z side, pi/2 = top), pushed out by `lift`.
export function loftSurface(keys, z = 0) {
  keys = keys.slice().sort((a, b) => a[0] - b[0]);
  const f = [1, 2, 3, 4, 5].map((c) => monotone(keys.map((k) => [k[0], k[c] == null ? 2 : k[c]])));
  const sp = [0, 0];
  return (x, a, lift = 0) => {
    const cy = f[0](x), hw = f[1](x), top = f[2](x), bot = f[3](x), e = f[4](x);
    superPoint(a, hw + lift, top + lift, bot + lift, e, sp);
    return [x, cy + sp[1], z + sp[0]];
  };
}

// A flat-ish patch on a loft surface (windows, decals): x0..x1 along,
// a0..a1 round the ring, lifted off the skin.
export function surfacePatch(k, surf, x0, x1, a0, a1, hex, cls, lift = 0.012, nx = 2, na = 2) {
  const P = [];
  for (let i = 0; i <= nx; i++) {
    const row = [];
    for (let j = 0; j <= na; j++) row.push(surf(x0 + (x1 - x0) * (i / nx), a0 + (a1 - a0) * (j / na), lift));
    P.push(row);
  }
  const mid = surf((x0 + x1) / 2, (a0 + a1) / 2, -0.3);
  k.grid(P, hex, cls, { expect: (i, j, c) => sub(c, mid) });
}

// ---- materials ----------------------------------------------------------------
let detailTex = null;
export function detailTexture() {
  if (!detailTex) {
    const S = 512;
    detailTex = new THREE.DataTexture(detailPixels(S, 7), S, S, THREE.RGBAFormat);
    detailTex.wrapS = detailTex.wrapT = THREE.RepeatWrapping;
    detailTex.magFilter = THREE.LinearFilter;
    detailTex.minFilter = THREE.LinearMipmapLinearFilter;
    detailTex.generateMipmaps = true;
    detailTex.anisotropy = 4;
    detailTex.needsUpdate = true;
  }
  return detailTex;
}

const RIG_VERT_HEAD = /* glsl */`
attribute vec4 aHng;
attribute vec3 aHax;
uniform vec4 uR0;
uniform vec4 uR1;
uniform vec4 uR2;
varying vec2 vTrd;
vec3 rgRot(vec3 v, vec3 a, float s, float c) { return v * c + cross(a, v) * s + a * dot(a, v) * (1.0 - c); }
`;
const RIG_CORE = /* glsl */`
float rgCode = floor(aHng.x + 0.5);
float rgAng = 0.0;
float rgHide = 0.0;
float rgGain = length(aHax);
vTrd = vec2(0.0);
if (rgCode < 0.5) rgGain = 0.0;
else if (rgCode < 1.5) rgAng = uR0.x;
else if (rgCode < 2.5) rgAng = uR0.y;
else if (rgCode < 3.5) rgAng = uR0.z;
else if (rgCode < 4.5) rgAng = uR0.w;
else if (rgCode < 5.5) { rgAng = uR1.x; rgHide = step(0.985, uR1.x); }
else if (rgCode < 6.5) rgAng = uR0.y + uR0.x;
else if (rgCode < 7.5) rgAng = uR0.y - uR0.x;
else if (rgCode < 8.5) rgAng = uR0.x;
else if (rgCode < 9.5) rgAng = uR0.y;
else if (rgCode < 19.5) { rgHide = step(uR1.y, rgCode - 10.0); rgGain = 0.0; }
else if (rgCode < 29.5) { rgHide = step(uR1.z, rgCode - 20.0); rgGain = 0.0; }
else if (rgCode < 30.5) { rgHide = 1.0 - step(0.5, uR1.w); rgGain = 0.0; }
else if (rgCode < 31.5) { rgAng = uR2.x; rgHide = step(0.5, uR2.z); }
else if (rgCode < 32.5) { rgAng = uR2.y; rgHide = step(0.5, uR2.z); }
else if (rgCode < 40.5) { vTrd = vec2(aHax.x - uR0.x, 1.0); rgGain = 0.0; }
else { vTrd = vec2(aHax.x - uR0.y, 1.0); rgGain = 0.0; }
vec3 rgU = rgGain > 0.0 ? aHax / max(rgGain, 1e-6) : vec3(0.0, 1.0, 0.0);
float rgS = sin(rgAng * rgGain);
float rgC = cos(rgAng * rgGain);
`;
const RIG_NORMAL = '#include <beginnormal_vertex>\n' + RIG_CORE + 'if (rgGain > 0.0) objectNormal = rgRot(objectNormal, rgU, rgS, rgC);\n';
const RIG_POS = /* glsl */`
#include <begin_vertex>
if (rgGain > 0.0) transformed = aHng.yzw + rgRot(transformed - aHng.yzw, rgU, rgS, rgC);
if (rgHide > 0.5) transformed = aHng.yzw;
`;
const DETAIL_HEAD = /* glsl */`
uniform sampler2D uDetailMap;
uniform vec4 uDetail;
uniform vec4 uCamo;
uniform vec3 uCamoA;
uniform vec3 uCamoB;
varying vec2 vTrd;
vec3 rgBump(vec3 p, vec3 n, float h) {
  vec3 sx = dFdx(p), sy = dFdy(p);
  vec3 r1 = cross(sy, n), r2 = cross(n, sx);
  float det = dot(sx, r1);
  vec2 dh = vec2(dFdx(h), dFdy(h));
  vec3 g = sign(det) * (dh.x * r1 + dh.y * r2);
  return normalize(abs(det) * n - g);
}
`;
const DETAIL_BODY = /* glsl */`
#include <normal_fragment_maps>
{
  float dC = floor(vCls + 0.5);
  float dPaint = dC < 1.5 ? 1.0 : (dC < 2.5 ? 0.55 : ((dC > 5.5 && dC < 7.5) ? 0.45 : 0.0));
  float dFade = 1.0 - smoothstep(uDetail.w * 0.45, uDetail.w, length(vViewPosition));
  vec3 dW = abs(normalize(vObjN + vec3(1e-4)));
  dW = dW * dW; dW = dW * dW;
  dW /= (dW.x + dW.y + dW.z);
  vec3 dq = vObj * uDetail.z;
  vec4 dT = texture2D(uDetailMap, dq.zy) * dW.x + texture2D(uDetailMap, dq.xz) * dW.y + texture2D(uDetailMap, dq.xy) * dW.z;
  float dLine = dT.r * dPaint * uDetail.x * dFade;
  float dRiv = dT.g * dPaint * uDetail.x * dFade;
  float dGr = (dT.b - 0.5) * 2.0 * uDetail.y;
#ifdef RW_CAMO
  if (dC < 1.5) {
    float cm = texture2D(uDetailMap, (vObj.xz + vObj.y * vec2(0.55, -0.35)) * uCamo.x + 0.37).a;
    float m1 = smoothstep(uCamo.y - 0.015, uCamo.y + 0.015, cm);
    float m2 = smoothstep(uCamo.z - 0.015, uCamo.z + 0.015, cm);
    diffuseColor.rgb *= mix(mix(vec3(1.0), uCamoA, m1), uCamoB, m2);
  }
#endif
  diffuseColor.rgb *= (1.0 - dLine * 0.55) * (1.0 - dRiv * 0.25) * (1.0 + dGr * (0.35 + 0.65 * dPaint));
  roughnessFactor = clamp(roughnessFactor + dLine * 0.25 + dGr * 0.5 * dPaint, 0.03, 1.0);
  float dH = dRiv * 0.6 - dLine;
  if (vTrd.y > 0.5) {
    float s = fract(vTrd.x * 6.5);
    float plate = smoothstep(0.0, 0.07, s) * (1.0 - smoothstep(0.84, 0.92, s));
    float gr = smoothstep(0.28, 0.34, s) * (1.0 - smoothstep(0.52, 0.58, s));
    diffuseColor.rgb *= 0.3 + 0.6 * plate + 0.55 * gr;
    roughnessFactor = mix(0.85, 0.42, gr);
    metalnessFactor = mix(0.25, 0.75, gr);
    dH = plate * 0.6 + gr * 0.8;
    dFade = 1.0 - smoothstep(30.0, 70.0, length(vViewPosition));
  }
  normal = rgBump(-vViewPosition, normal, dH * uCamo.w * dFade);
}
`;

// Presets: physical (clearcoat), roughness / metalness of paint, detail
// (seams, grime, texture scale per metre, fade distance), bump height,
// camo (scale, two thresholds) and its tints.
const PRESETS = {
  air: { rough: 0.38, metal: 0.18, cc: 0.35, detail: [1, 0.22, 0.42, 60], bump: 0.0035 },
  jet: { rough: 0.55, metal: 0.22, cc: 0, detail: [1, 0.3, 0.42, 70], bump: 0.004, camo: [0.09, 0.48, 0.62], camoA: [0.8, 0.82, 0.85], camoB: [1.1, 1.1, 1.1] },
  boat: { rough: 0.22, metal: 0.04, cc: 0.9, detail: [0.12, 0.12, 0.35, 35], bump: 0.002 },
  rib: { rough: 0.7, metal: 0, cc: 0.15, detail: [0.1, 0.25, 0.35, 30], bump: 0.002 },
  tank: { rough: 0.78, metal: 0.15, cc: 0, detail: [0.7, 0.75, 0.35, 70], bump: 0.006, camo: [0.07, 0.42, 0.62], camoA: [0.5, 0.56, 0.4], camoB: [0.36, 0.3, 0.25] },
};

// A skin for one craft: its own uniforms (rig, damage), shared program.
// Rig uniforms: userData.r0 (aileron, elevator, rudder, flap | wheel
// phase L, R), r1 (gear, missiles, bombs, strobe), r2 (spin, spin2, blur).
export function createSkin(preset = 'air') {
  const P = PRESETS[preset] || PRESETS.air;
  const base = craftMaterial('gloss');
  const physical = !!base.isMeshPhysicalMaterial && P.cc > 0;
  const opts = { color: 0xffffff, vertexColors: true, roughness: P.rough, metalness: P.metal };
  const m = physical ? new THREE.MeshPhysicalMaterial({ ...opts, clearcoat: P.cc, clearcoatRoughness: 0.12 })
    : new THREE.MeshStandardMaterial(opts);
  const u = {
    uR0: { value: new THREE.Vector4() },
    uR1: { value: new THREE.Vector4(0, 9, 9, 0) },
    uR2: { value: new THREE.Vector4() },
    uDmg: { value: new THREE.Vector4(0, 0, preset === 'tank' ? 0.55 : 0, 0) },
    uHit0: { value: new THREE.Vector4(1, 0, 0, 0) },
    uHit1: { value: new THREE.Vector4(-1, 0, 0, 0) },
    uBox: { value: new THREE.Vector4(4, 2, 2, 0) },
    uCrush: { value: new THREE.Vector4(0, 0, 9, -9) },
    uDetailMap: { value: detailTexture() },
    uDetail: { value: new THREE.Vector4(...P.detail) },
    uCamo: { value: new THREE.Vector4(...(P.camo || [0, 0, 0]), P.bump) },
    uCamoA: { value: new THREE.Vector3(...(P.camoA || [1, 1, 1])) },
    uCamoB: { value: new THREE.Vector3(...(P.camoB || [1, 1, 1])) },
  };
  const camo = !!P.camo;
  m.onBeforeCompile = (sh, r) => {
    base.onBeforeCompile(sh, r);
    Object.assign(sh.uniforms, u);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\n' + RIG_VERT_HEAD)
      .replace('#include <beginnormal_vertex>', RIG_NORMAL)
      .replace('#include <begin_vertex>', RIG_POS);
    sh.fragmentShader = (camo ? '#define RW_CAMO\n' : '') + sh.fragmentShader
      .replace('#include <common>', '#include <common>\n' + DETAIL_HEAD)
      .replace('#include <normal_fragment_maps>', DETAIL_BODY);
  };
  const key = 'rwskin' + (physical ? 'P' : 'S') + (camo ? 'C' : '');
  m.customProgramCacheKey = () => key;
  m.userData.rig = { r0: u.uR0.value, r1: u.uR1.value, r2: u.uR2.value, dmg: u.uDmg.value };
  m.userData.preset = preset;
  m.userData.uniforms = u;
  return m;
}

// Shadow depth material that applies the same rig (hidden blades and
// stores cast no shadow, gear shadows follow the gear).
export function skinDepth(skin) {
  const m = new THREE.MeshDepthMaterial();
  const u = skin.userData.uniforms;
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uR0 = u.uR0;
    sh.uniforms.uR1 = u.uR1;
    sh.uniforms.uR2 = u.uR2;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\n' + RIG_VERT_HEAD)
      .replace('#include <begin_vertex>', RIG_CORE + RIG_POS);
  };
  m.customProgramCacheKey = () => 'rwskindepth';
  return m;
}

// Wreck and hit look of a skin: wear 0..1, soot on wreck, red-hot flash.
export function skinLook(m, wear, wrecked, hit) {
  const d = m.userData.rig.dmg;
  d.x = wear;
  d.y = wrecked ? 1 : 0;
  d.w = 3;
  const f = hit > 0 ? Math.min(1, hit / 0.15) : 0;
  m.emissive.setRGB(f * 0.55, f * 0.22, f * 0.12);
}

// Shared see-through canopy / windscreen glass.
let glassMat = null;
export function glassMaterial() {
  if (!glassMat) {
    glassMat = new THREE.MeshPhysicalMaterial({
      color: 0x8fa4b4, metalness: 0, roughness: 0.04, transparent: true, opacity: 0.32,
      envMapIntensity: 1.6, specularIntensity: 1, depthWrite: false,
    });
  }
  return glassMat;
}

// Shared rotor / propeller blur disc material (alpha texture, unlit).
let discMat = null;
export function discMaterial() {
  if (!discMat) {
    const S = 128;
    const t = new THREE.DataTexture(blurPixels(S, 4), S, S, THREE.RGBAFormat);
    t.magFilter = THREE.LinearFilter;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    t.generateMipmaps = true;
    t.needsUpdate = true;
    discMat = new THREE.MeshBasicMaterial({ map: t, transparent: true, depthWrite: false, side: THREE.DoubleSide });
  }
  return discMat;
}

// BufferGeometry from a kit (indexed, with the rig attributes).
export function buildKit(k) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(k.p, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(k.n, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(k.c, 3));
  g.setAttribute('aCls', new THREE.Float32BufferAttribute(k.k, 1));
  g.setAttribute('aHng', new THREE.Float32BufferAttribute(k.h, 4));
  g.setAttribute('aHax', new THREE.Float32BufferAttribute(k.a, 3));
  g.setIndex(k.count > 65535 ? new THREE.Uint32BufferAttribute(k.i, 1) : new THREE.Uint16BufferAttribute(k.i, 1));
  g.computeBoundingSphere();
  g.computeBoundingBox();
  return g;
}

// A disc in the plane normal to axis d (unit), centre o, radius r, for
// the blur material (uv from the plane).
export function discGeometry(list) {
  const pos = [], uv = [], idx = [];
  for (const { o, d, r } of list) {
    const [u, v] = basis(norm(d));
    const base = pos.length / 3;
    const n = 24;
    pos.push(o[0], o[1], o[2]);
    uv.push(0.5, 0.5);
    for (let j = 0; j <= n; j++) {
      const a = (j / n) * Math.PI * 2;
      const c = Math.cos(a), s = Math.sin(a);
      pos.push(o[0] + (u[0] * c + v[0] * s) * r, o[1] + (u[1] * c + v[1] * s) * r, o[2] + (u[2] * c + v[2] * s) * r);
      uv.push(0.5 + c * 0.5, 0.5 + s * 0.5);
      if (j > 0) idx.push(base, base + j, base + j + 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  g.computeBoundingSphere();
  return g;
}

export const V = { sub, cross, dot, norm, scl, add };
