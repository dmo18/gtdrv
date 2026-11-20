// Geometry helpers for smooth procedural vehicles: an accumulator that
// collects vertices with colour, surface class and uv, a lofted grid
// emitter with crease-aware smooth normals, and a monotone curve.
import * as THREE from 'three';

const linCache = new Map();
// Linear RGB triple for an sRGB hex colour (cached).
export function lin(hex) {
  let c = linCache.get(hex);
  if (!c) {
    const t = new THREE.Color().setHex(hex);
    c = [t.r, t.g, t.b];
    linCache.set(hex, c);
  }
  return c;
}

export class Acc {
  constructor() {
    this.p = [];
    this.n = [];
    this.c = [];
    this.k = [];
    this.uv = [];
    this.i = [];
    this.count = 0;
  }

  vert(x, y, z, nx, ny, nz, col, cls, u = 0, v = 0) {
    this.p.push(x, y, z);
    this.n.push(nx, ny, nz);
    this.c.push(col[0], col[1], col[2]);
    this.k.push(cls);
    this.uv.push(u, v);
    return this.count++;
  }

  tri(a, b, c) {
    this.i.push(a, b, c);
  }

  // Append a three.js geometry with one colour and class. `m` is an
  // optional Matrix4 applied first. Flat normals are recomputed when the
  // geometry has none.
  geo(g, hex, cls, m = null, u = 0, v = 0) {
    if (m) g.applyMatrix4(m);
    if (!g.attributes.normal) g.computeVertexNormals();
    const col = lin(hex);
    const P = g.attributes.position, N = g.attributes.normal;
    const base = this.count;
    for (let j = 0; j < P.count; j++) {
      this.vert(P.getX(j), P.getY(j), P.getZ(j), N.getX(j), N.getY(j), N.getZ(j), col, cls, u, v);
    }
    if (g.index) {
      const I = g.index.array;
      for (let j = 0; j < I.length; j++) this.i.push(base + I[j]);
    } else {
      for (let j = 0; j < P.count; j++) this.i.push(base + j);
    }
    g.dispose();
  }

  get triangles() {
    return this.i.length / 3;
  }

  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3));
    g.setAttribute('aCls', new THREE.Float32BufferAttribute(this.k, 1));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setIndex(this.count > 65535 ? new THREE.Uint32BufferAttribute(this.i, 1) : new THREE.Uint16BufferAttribute(this.i, 1));
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }
}

// Emit a lofted grid. P[i][r] = [x, y, z]: stations i (any order along
// the body) by ring points r. Face (i, r) spans i..i+1, r..r+1. `fn(i, r,
// c, n)` gets the face centre and unit normal and returns null (skip) or
// { col, cls, u, v }. Vertex normals average neighbouring faces within
// the crease angle, so curved panels are smooth and sharp edges stay
// sharp. `offset` pushes vertices out along their normals (lamp lenses).
// `flip` reverses the winding (for grids built inside out).
export function emitGrid(acc, P, fn, opts = {}) {
  const crease = opts.crease == null ? 0.62 : opts.crease;
  const offset = opts.offset || 0;
  const flip = !!opts.flip;
  const wrap = !!opts.wrap; // stations form a closed loop (last = first)
  const S = P.length, R = P[0].length;
  const FS = S - 1, FR = R - 1;
  const fnx = new Float64Array(FS * FR), fny = new Float64Array(FS * FR), fnz = new Float64Array(FS * FR);
  const flen = new Float64Array(FS * FR);
  for (let i = 0; i < FS; i++) {
    for (let r = 0; r < FR; r++) {
      const a = P[i][r], b = P[i + 1][r], c = P[i + 1][r + 1], d = P[i][r + 1];
      const ux = c[0] - a[0], uy = c[1] - a[1], uz = c[2] - a[2];
      const vx = d[0] - b[0], vy = d[1] - b[1], vz = d[2] - b[2];
      let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      if (flip) { nx = -nx; ny = -ny; nz = -nz; }
      const k = i * FR + r;
      const l = Math.hypot(nx, ny, nz);
      fnx[k] = nx; fny[k] = ny; fnz[k] = nz;
      flen[k] = l;
    }
  }
  const EPS = 1e-9;
  const c = [0, 0, 0], n = [0, 0, 0];
  const vn = [0, 0, 0];
  function vertexNormal(vi, vr, k) {
    const ux = fnx[k] / flen[k], uy = fny[k] / flen[k], uz = fnz[k] / flen[k];
    let sx = 0, sy = 0, sz = 0;
    for (let fj = vi - 1; fj <= vi; fj++) {
      let fi = fj;
      if (wrap) fi = (fj + FS) % FS;
      else if (fi < 0 || fi >= FS) continue;
      for (let fr = vr - 1; fr <= vr; fr++) {
        if (fr < 0 || fr >= FR) continue;
        const q = fi * FR + fr;
        const l = flen[q];
        if (l < EPS) continue;
        if ((fnx[q] * ux + fny[q] * uy + fnz[q] * uz) / l < crease) continue;
        sx += fnx[q]; sy += fny[q]; sz += fnz[q];
      }
    }
    const l = Math.hypot(sx, sy, sz) || 1;
    vn[0] = sx / l; vn[1] = sy / l; vn[2] = sz / l;
    return vn;
  }
  for (let i = 0; i < FS; i++) {
    for (let r = 0; r < FR; r++) {
      const k = i * FR + r;
      const l = flen[k];
      if (l < 1e-7) continue;
      const a = P[i][r], b = P[i + 1][r], cc = P[i + 1][r + 1], d = P[i][r + 1];
      c[0] = (a[0] + b[0] + cc[0] + d[0]) / 4;
      c[1] = (a[1] + b[1] + cc[1] + d[1]) / 4;
      c[2] = (a[2] + b[2] + cc[2] + d[2]) / 4;
      n[0] = fnx[k] / l; n[1] = fny[k] / l; n[2] = fnz[k] / l;
      const f = fn(i, r, c, n);
      if (!f) continue;
      const corners = [[a, i, r], [b, i + 1, r], [cc, i + 1, r + 1], [d, i, r + 1]];
      const ids = [];
      for (const [p, vi, vr] of corners) {
        const nn = vertexNormal(vi, vr, k);
        ids.push(acc.vert(p[0] + nn[0] * offset, p[1] + nn[1] * offset, p[2] + nn[2] * offset, nn[0], nn[1], nn[2], f.col, f.cls, f.u || 0, f.v || 0));
      }
      if (flip) {
        acc.tri(ids[0], ids[2], ids[1]);
        acc.tri(ids[0], ids[3], ids[2]);
      } else {
        acc.tri(ids[0], ids[1], ids[2]);
        acc.tri(ids[0], ids[2], ids[3]);
      }
    }
  }
}

// Monotone cubic through [[t, v], ...] (sorted by t); clamps outside.
export function curve(pts) {
  const n = pts.length;
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  if (n === 1) return () => ys[0];
  const d = [], m = new Array(n);
  for (let i = 0; i < n - 1; i++) d.push((ys[i + 1] - ys[i]) / (xs[i + 1] - xs[i]));
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
      const t = 3 / Math.sqrt(s);
      m[i] = t * a * d[i];
      m[i + 1] = t * b * d[i];
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

// Sorted unique values (merging those closer than eps).
export function uniqSorted(xs, eps = 0.0015) {
  xs.sort((a, b) => a - b);
  const out = [];
  for (const x of xs) if (!out.length || x - out[out.length - 1] > eps) out.push(x);
  return out;
}

// Superellipse quarter exponent helper: |c|^e keeping sign.
export function spow(c, e) {
  return Math.sign(c) * Math.pow(Math.abs(c), e);
}

// A lathe (surface of revolution about the local z axis) from a profile
// of [radius, z] points, `seg` segments, with per-face colour callback
// fn(segIndex, profileIndex) -> { col, cls } | null. Smooth normals
// along the ring, crease-aware along the profile.
export function lathe(acc, profile, seg, fn, opts = {}) {
  const P = [];
  const a0 = opts.phase || 0;
  for (let s = 0; s <= seg; s++) {
    const a = a0 + (s / seg) * Math.PI * 2;
    const ca = Math.cos(a), sa = Math.sin(a);
    P.push(profile.map(([r, z]) => [r * ca, r * sa, z]));
  }
  // Stations are angles, ring points the profile: faces point away from
  // the axis where the profile runs toward +z (pass flip for the reverse).
  emitGrid(acc, P, (i, r) => fn(i, r), { crease: opts.crease == null ? 0.5 : opts.crease, flip: !!opts.flip, wrap: true });
}
