// Collects coloured, optionally textured quads/boxes into one big
// geometry so thousands of objects draw in a single call. Vertex colours
// double as baked ambient occlusion: every corner takes a brightness
// factor, so walls can darken toward the pavement at no runtime cost.
import * as THREE from 'three';

const _c = new THREE.Color();

// ---- Scratch buffers ----
// A builder writes into typed arrays that grow by doubling. Released
// builders (a near tile once its meshes are made) hand their arrays back
// to this pool and the next tile takes them again; the near tiles' mesh
// arrays come from the same pool and go back once they are on the GPU or
// disposed (realcity.js). So streaming tiles does not keep making big
// arrays for the garbage collector (big typed arrays are what set off
// its long full collections). Every pooled array is a power of two long
// (at least 256); at most POOL_MAX bytes wait in the pool, the rest is
// left to the collector.
const POOL_MAX = 48 << 20;
const pools = { f: new Map(), u: new Map(), s: new Map() };
let pooled = 0;
const EMPTY_F = new Float32Array(0), EMPTY_U = new Uint32Array(0);
function pow2(n) {
  let c = 256;
  while (c < n) c *= 2;
  return c;
}
function poolOf(a) {
  return a instanceof Float32Array ? pools.f : a instanceof Uint32Array ? pools.u : a instanceof Uint16Array ? pools.s : null;
}
function take(pool, n, Ctor) {
  const len = pow2(n);
  const list = pool.get(len);
  if (list && list.length) {
    pooled -= len * Ctor.BYTES_PER_ELEMENT;
    return list.pop();
  }
  return new Ctor(len);
}
// Pooled arrays of at least n numbers (power-of-two long).
export const takeFloats = (n) => take(pools.f, n, Float32Array);
export const takeIndices = (n, big) => (big ? take(pools.u, n, Uint32Array) : take(pools.s, n, Uint16Array));
// Hands an array from takeFloats or takeIndices back to the pool.
export function giveBack(a) {
  const pool = poolOf(a);
  const n = a.length, bytes = a.byteLength;
  if (!pool || n < 256 || (n & (n - 1)) || a.byteOffset || pooled + bytes > POOL_MAX) return;
  let list = pool.get(n);
  if (!list) pool.set(n, (list = []));
  list.push(a);
  pooled += bytes;
}
// Bytes waiting in the pool (tests, benches).
export function scratchPooledBytes() {
  return pooled;
}
function moveF(old, len, n) {
  const a = takeFloats(n);
  if (len) a.set(old.subarray(0, len));
  giveBack(old);
  return a;
}

// Corner c (0..3) of an atlas cell: u0 v0, u1 v0, u1 v1, u0 v1.
const cellU = (r, c) => ((c + 1) & 2 ? r.u1 : r.u0);
const cellV = (r, c) => (c & 2 ? r.v1 : r.v0);

export class MeshBuilder {
  // uvScale: metres per texture repeat for ground quads made by flat().
  // The data lives in typed arrays (P, C, N, U: 3, 3, 3 and 2 numbers a
  // vertex; I: indices), `count` vertices and `ni` indices long; pos,
  // col, nor, uv and idx are views of exactly the written part.
  constructor(withUv = false, uvScale = 1) {
    this.P = EMPTY_F;
    this.C = EMPTY_F;
    this.N = EMPTY_F;
    this.U = withUv ? EMPTY_F : null;
    this.I = EMPTY_U;
    this.count = 0;
    this.ni = 0;
    this.vcap = 0;
    this.uvScale = uvScale;
    this._v = [null, null, null, null, null];
  }

  _view(k, a, n) {
    const v = this._v[k];
    if (v && v.length === n && v.buffer === a.buffer) return v;
    return (this._v[k] = a.subarray(0, n));
  }
  get pos() { return this._view(0, this.P, this.count * 3); }
  get col() { return this._view(1, this.C, this.count * 3); }
  get nor() { return this._view(2, this.N, this.count * 3); }
  get uv() { return this.U ? this._view(3, this.U, this.count * 2) : null; }
  get idx() { return this._view(4, this.I, this.ni); }

  // Room for nv more vertices and ni more indices.
  ensure(nv, ni) {
    const need = this.count + nv;
    if (need > this.vcap) {
      let cap = this.vcap || 64;
      while (cap < need) cap *= 2;
      const n3 = this.count * 3;
      this.P = moveF(this.P, n3, cap * 3);
      this.C = moveF(this.C, n3, cap * 3);
      this.N = moveF(this.N, n3, cap * 3);
      if (this.U) this.U = moveF(this.U, this.count * 2, cap * 2);
      this.vcap = cap;
    }
    const needI = this.ni + ni;
    if (needI > this.I.length) {
      const a = takeIndices(Math.max(needI, this.I.length * 2), true);
      if (this.ni) a.set(this.I.subarray(0, this.ni));
      giveBack(this.I);
      this.I = a;
    }
  }

  // Empties the builder, keeping its arrays.
  reset() {
    this.count = 0;
    this.ni = 0;
  }

  // Empties the builder and hands its arrays to the scratch pool.
  release() {
    giveBack(this.P);
    giveBack(this.C);
    giveBack(this.N);
    if (this.U) giveBack(this.U);
    giveBack(this.I);
    this.P = this.C = this.N = EMPTY_F;
    if (this.U) this.U = EMPTY_F;
    this.I = EMPTY_U;
    this.count = this.ni = this.vcap = 0;
    this._v[0] = this._v[1] = this._v[2] = this._v[3] = this._v[4] = null;
  }

  // One vertex at index v (room already made).
  _vert(v, x, y, z, r, g, b, nx, ny, nz) {
    const o = v * 3, P = this.P, C = this.C, N = this.N;
    P[o] = x; P[o + 1] = y; P[o + 2] = z;
    C[o] = r; C[o + 1] = g; C[o + 2] = b;
    N[o] = nx; N[o + 1] = ny; N[o + 2] = nz;
  }

  // Four corners in counter-clockwise order seen from the front.
  // sa..sd are brightness factors for the corners a..d.
  quad(ax, ay, az, bx, by, bz, cx, cy, cz, dx, dy, dz, color, nx, ny, nz, u0 = 0, v0 = 0, u1 = 1, v1 = 1, sa = 1, sb = sa, sc = sa, sd = sa) {
    _c.setHex(color, THREE.SRGBColorSpace);
    const r = _c.r, g = _c.g, b = _c.b;
    this.ensure(4, 6);
    const n = this.count;
    this._vert(n, ax, ay, az, r * sa, g * sa, b * sa, nx, ny, nz);
    this._vert(n + 1, bx, by, bz, r * sb, g * sb, b * sb, nx, ny, nz);
    this._vert(n + 2, cx, cy, cz, r * sc, g * sc, b * sc, nx, ny, nz);
    this._vert(n + 3, dx, dy, dz, r * sd, g * sd, b * sd, nx, ny, nz);
    const U = this.U;
    if (U) {
      const o = n * 2;
      U[o] = u0; U[o + 1] = v0; U[o + 2] = u1; U[o + 3] = v0;
      U[o + 4] = u1; U[o + 5] = v1; U[o + 6] = u0; U[o + 7] = v1;
    }
    const I = this.I, k = this.ni;
    I[k] = n; I[k + 1] = n + 1; I[k + 2] = n + 2; I[k + 3] = n; I[k + 4] = n + 2; I[k + 5] = n + 3;
    this.ni += 6;
    this.count += 4;
  }

  // Like quad() but with a texture coordinate for every corner.
  quadUv(ax, ay, az, bx, by, bz, cx, cy, cz, dx, dy, dz, color, nx, ny, nz, ua, va, ub, vb, uc, vc, ud, vd, s = 1) {
    this.quad(ax, ay, az, bx, by, bz, cx, cy, cz, dx, dy, dz, color, nx, ny, nz, 0, 0, 1, 1, s);
    const U = this.U;
    if (U) {
      const o = this.count * 2 - 8;
      U[o] = ua; U[o + 1] = va; U[o + 2] = ub; U[o + 3] = vb; U[o + 4] = uc; U[o + 5] = vc; U[o + 6] = ud; U[o + 7] = vd;
    }
  }

  // Sets the texture coordinates of the last quad's four corners.
  lastQuadUv(ua, va, ub, vb, uc, vc, ud, vd) {
    const U = this.U;
    if (!U) return;
    const o = this.count * 2 - 8;
    U[o] = ua; U[o + 1] = va; U[o + 2] = ub; U[o + 3] = vb; U[o + 4] = uc; U[o + 5] = vc; U[o + 6] = ud; U[o + 7] = vd;
  }

  // Flat rectangle facing up, textured in world space so neighbouring
  // pieces line up and nothing stretches. s = brightness.
  flat(x0, z0, x1, z1, y, color, s = 1) {
    const k = 1 / this.uvScale;
    this.quadUv(x0, y, z1, x1, y, z1, x1, y, z0, x0, y, z0, color, 0, 1, 0, x0 * k, z1 * k, x1 * k, z1 * k, x1 * k, z0 * k, x0 * k, z0 * k, s);
  }

  // Flat rectangle with a brightness for each corner (z1 side first).
  flatShade(x0, z0, x1, z1, y, color, s01, s11, s10, s00) {
    this.flat(x0, z0, x1, z1, y, color);
    const c = this.C, o = this.count * 3 - 12;
    c[o] *= s01; c[o + 1] *= s01; c[o + 2] *= s01;
    c[o + 3] *= s11; c[o + 4] *= s11; c[o + 5] *= s11;
    c[o + 6] *= s10; c[o + 7] *= s10; c[o + 8] *= s10;
    c[o + 9] *= s00; c[o + 10] *= s00; c[o + 11] *= s00;
  }

  // Flat rectangle showing one cell of a texture atlas. rot (0..3)
  // turns the picture in quarter turns.
  flatRect(x0, z0, x1, z1, y, color, r, rot = 0, s = 1) {
    const k = rot & 3, k1 = (k + 1) & 3, k2 = (k + 2) & 3, k3 = (k + 3) & 3;
    this.quadUv(x0, y, z1, x1, y, z1, x1, y, z0, x0, y, z0, color, 0, 1, 0,
      cellU(r, k), cellV(r, k), cellU(r, k1), cellV(r, k1), cellU(r, k2), cellV(r, k2), cellU(r, k3), cellV(r, k3), s);
  }

  // One upright wall from (ax, az) to (bx, bz), seen from its right-hand
  // side. s0/s1 are the brightness at the bottom and the top.
  wall(ax, az, bx, bz, y0, y1, color, u0 = 0, v0 = 0, u1 = 1, v1 = 1, s0 = 1, s1 = s0) {
    const dx = bx - ax, dz = bz - az;
    // sqrt, not Math.hypot: hypot is not inlined and boxes its result.
    const l = Math.sqrt(dx * dx + dz * dz) || 1;
    this.quad(ax, y0, az, bx, y0, bz, bx, y1, bz, ax, y1, az, color, -dz / l, 0, dx / l, u0, v0, u1, v1, s0, s0, s1, s1);
  }

  // The four walls of an upright box. uScale/vScale are metres per
  // texture repeat (only used when this builder has UVs).
  walls(x0, z0, x1, z1, y0, y1, color, uScale = 1, vScale = 1, s0 = 1, s1 = s0) {
    const w = (x1 - x0) / uScale, d = (z1 - z0) / uScale, v0 = y0 / vScale, v1 = y1 / vScale;
    this.wall(x0, z1, x1, z1, y0, y1, color, 0, v0, w, v1, s0, s1); // south
    this.wall(x1, z0, x0, z0, y0, y1, color, w, v0, w + w, v1, s0, s1); // north
    this.wall(x1, z1, x1, z0, y0, y1, color, w + w, v0, w + w + d, v1, s0, s1); // east
    this.wall(x0, z0, x0, z1, y0, y1, color, w + w + d, v0, w + w + d + d, v1, s0, s1); // west
  }

  // The same four walls facing inward (the inside of a parapet).
  innerWalls(x0, z0, x1, z1, y0, y1, color, s0 = 1, s1 = s0) {
    this.wall(x1, z1, x0, z1, y0, y1, color, 0, 0, 1, 1, s0, s1);
    this.wall(x0, z0, x1, z0, y0, y1, color, 0, 0, 1, 1, s0, s1);
    this.wall(x1, z0, x1, z1, y0, y1, color, 0, 0, 1, 1, s0, s1);
    this.wall(x0, z1, x0, z0, y0, y1, color, 0, 0, 1, 1, s0, s1);
  }

  box(x0, z0, x1, z1, y0, y1, color, topColor = color, s0 = 1, s1 = s0) {
    this.walls(x0, z0, x1, z1, y0, y1, color, this.uvScale, this.uvScale, s0, s1);
    this.flat(x0, z0, x1, z1, y1, topColor, s1);
  }

  // A flat rectangular frame (the ground between an outer and an inner
  // rectangle). sOut/sIn are the brightness at the two edges.
  ring(x0, z0, x1, z1, w, y, color, sOut = 1, sIn = sOut) {
    const a0 = x0 + w, c0 = z0 + w, a1 = x1 - w, c1 = z1 - w;
    this._ringQuad(x0, z1, x1, z1, a1, c1, a0, c1, y, color, sOut, sIn); // south
    this._ringQuad(x1, z0, x0, z0, a0, c0, a1, c0, y, color, sOut, sIn); // north
    this._ringQuad(x1, z1, x1, z0, a1, c0, a1, c1, y, color, sOut, sIn); // east
    this._ringQuad(x0, z0, x0, z1, a0, c1, a0, c0, y, color, sOut, sIn); // west
  }
  _ringQuad(px, pz, qx, qz, rx, rz, tx, tz, y, color, sOut, sIn) {
    const k = 1 / this.uvScale;
    this.quadUv(px, y, pz, qx, y, qz, rx, y, rz, tx, y, tz, color, 0, 1, 0, px * k, pz * k, qx * k, qz * k, rx * k, rz * k, tx * k, tz * k);
    const c = this.C, o = this.count * 3 - 12;
    for (let i = 0; i < 6; i++) c[o + i] *= sOut;
    for (let i = 6; i < 12; i++) c[o + i] *= sIn;
  }

  tri(ax, ay, az, bx, by, bz, cx, cy, cz, color, nx, ny, nz, ua = 0, va = 0, ub = 0, vb = 0, uc = 0, vc = 0, s = 1) {
    _c.setHex(color, THREE.SRGBColorSpace);
    const r = _c.r * s, g = _c.g * s, b = _c.b * s;
    this.ensure(3, 3);
    const n = this.count;
    this._vert(n, ax, ay, az, r, g, b, nx, ny, nz);
    this._vert(n + 1, bx, by, bz, r, g, b, nx, ny, nz);
    this._vert(n + 2, cx, cy, cz, r, g, b, nx, ny, nz);
    const U = this.U;
    if (U) {
      const o = n * 2;
      U[o] = ua; U[o + 1] = va; U[o + 2] = ub; U[o + 3] = vb; U[o + 4] = uc; U[o + 5] = vc;
    }
    const I = this.I, k = this.ni;
    I[k] = n; I[k + 1] = n + 1; I[k + 2] = n + 2;
    this.ni += 3;
    this.count += 3;
  }

  // Box turned by `rot` about the vertical axis; hx/hz are half sizes.
  obox(cx, cz, hx, hz, y0, y1, rot, color, topColor = color, s0 = 1, s1 = s0) {
    const c = Math.cos(rot), s = Math.sin(rot);
    // Corners (-hx, hz), (hx, hz), (hx, -hz), (-hx, -hz).
    const x0 = cx - hx * c - hz * s, z0 = cz - hx * s + hz * c;
    const x1 = cx + hx * c - hz * s, z1 = cz + hx * s + hz * c;
    const x2 = cx + hx * c + hz * s, z2 = cz + hx * s - hz * c;
    const x3 = cx - hx * c + hz * s, z3 = cz - hx * s - hz * c;
    this.wall(x0, z0, x1, z1, y0, y1, color, 0, 0, 1, 1, s0, s1);
    this.wall(x1, z1, x2, z2, y0, y1, color, 0, 0, 1, 1, s0, s1);
    this.wall(x2, z2, x3, z3, y0, y1, color, 0, 0, 1, 1, s0, s1);
    this.wall(x3, z3, x0, z0, y0, y1, color, 0, 0, 1, 1, s0, s1);
    this.quad(x0, y1, z0, x1, y1, z1, x2, y1, z2, x3, y1, z3, topColor, 0, 1, 0, 0, 0, 1, 1, s1);
  }

  // Upright tube with smooth sides; r0/r1 are the bottom and top radii.
  cyl(cx, cz, y0, y1, r0, r1, sides, color, cap = false, s0 = 1, s1 = s0, topColor = color) {
    const capped = cap && r1 > 0;
    this.ensure((sides + 1) * 2 + (capped ? sides : 0), sides * 6 + (capped ? Math.max(0, sides - 2) * 3 : 0));
    _c.setHex(color, THREE.SRGBColorSpace);
    const n0 = this.count, U = this.U, I = this.I;
    const slope = (r0 - r1) / Math.max(1e-6, y1 - y0);
    const nl = Math.sqrt(1 + slope * slope);
    for (let i = 0; i <= sides; i++) {
      const a = (i / sides) * Math.PI * 2;
      const ca = Math.cos(a), sa = Math.sin(a);
      const v = n0 + i * 2;
      this._vert(v, cx + ca * r0, y0, cz + sa * r0, _c.r * s0, _c.g * s0, _c.b * s0, ca / nl, slope / nl, sa / nl);
      this._vert(v + 1, cx + ca * r1, y1, cz + sa * r1, _c.r * s1, _c.g * s1, _c.b * s1, ca / nl, slope / nl, sa / nl);
      if (U) { U[v * 2] = i / sides; U[v * 2 + 1] = 0; U[v * 2 + 2] = i / sides; U[v * 2 + 3] = 1; }
    }
    let k = this.ni;
    for (let i = 0; i < sides; i++) {
      const a = n0 + i * 2;
      I[k] = a; I[k + 1] = a + 1; I[k + 2] = a + 3; I[k + 3] = a; I[k + 4] = a + 3; I[k + 5] = a + 2;
      k += 6;
    }
    this.count += (sides + 1) * 2;
    if (capped) {
      _c.setHex(topColor, THREE.SRGBColorSpace);
      const c0 = this.count;
      for (let i = 0; i < sides; i++) {
        const a = (i / sides) * Math.PI * 2;
        this._vert(c0 + i, cx + Math.cos(a) * r1, y1, cz + Math.sin(a) * r1, _c.r * s1, _c.g * s1, _c.b * s1, 0, 1, 0);
        if (U) { U[(c0 + i) * 2] = 0; U[(c0 + i) * 2 + 1] = 0; }
      }
      for (let i = 1; i < sides - 1; i++) {
        I[k] = c0; I[k + 1] = c0 + i + 1; I[k + 2] = c0 + i;
        k += 3;
      }
      this.count += sides;
    }
    this.ni = k;
  }

  // Squashed ball (tree canopy, dome). Darker underneath; `jit` nudges
  // each ring so no two look alike.
  blob(cx, cy, cz, rx, ry, rz, color, segs = 6, rings = 4, lo = 0.6, hi = 1.05, jit = null) {
    const w = segs + 1;
    this.ensure(w * (rings + 1), segs * 6 * Math.max(0, rings - 1));
    _c.setHex(color, THREE.SRGBColorSpace);
    const n0 = this.count, U = this.U, I = this.I;
    let v = n0;
    for (let j = 0; j <= rings; j++) {
      const ph = (j / rings) * Math.PI;
      const y = Math.cos(ph), rr = Math.sin(ph);
      for (let i = 0; i <= segs; i++, v++) {
        const th = (i / segs) * Math.PI * 2 + j * 0.5;
        let k = 1;
        if (jit && j > 0 && j < rings && i < segs) k = 1 + jit() * 0.22;
        if (jit && i === segs) k = this._k0;
        if (i === 0) this._k0 = k;
        const x = Math.cos(th) * rr, z = Math.sin(th) * rr;
        const s = lo + (hi - lo) * (y * 0.5 + 0.5);
        this._vert(v, cx + x * rx * k, cy + y * ry * k, cz + z * rz * k, _c.r * s, _c.g * s, _c.b * s, x, y, z);
        if (U) { U[v * 2] = 0; U[v * 2 + 1] = 0; }
      }
    }
    let q = this.ni;
    for (let j = 0; j < rings; j++) {
      for (let i = 0; i < segs; i++) {
        const a = n0 + j * w + i, b = a + w;
        if (j > 0) { I[q] = a; I[q + 1] = a + 1; I[q + 2] = b; q += 3; }
        if (j < rings - 1) { I[q] = a + 1; I[q + 1] = b + 1; I[q + 2] = b; q += 3; }
      }
    }
    this.ni = q;
    this.count += w * (rings + 1);
  }

  // Soft dark disc on the ground (for the multiply-blended contact
  // shadow layer): `dark` in the middle fading to white at the rim.
  aoDisc(cx, cz, r, y, dark, sides = 8) {
    this.ensure(sides + 1, sides * 3);
    const n0 = this.count, U = this.U, I = this.I;
    this._vert(n0, cx, y, cz, dark, dark, dark, 0, 1, 0);
    for (let i = 0; i < sides; i++) {
      const a = (i / sides) * Math.PI * 2;
      this._vert(n0 + 1 + i, cx + Math.cos(a) * r, y, cz + Math.sin(a) * r, 1, 1, 1, 0, 1, 0);
    }
    if (U) U.fill(0, n0 * 2, (n0 + sides + 1) * 2);
    let k = this.ni;
    for (let i = 0; i < sides; i++) {
      I[k] = n0; I[k + 1] = n0 + 1 + ((i + 1) % sides); I[k + 2] = n0 + 1 + i;
      k += 3;
    }
    this.ni = k;
    this.count += sides + 1;
  }

  // Dark frame on the ground around a rectangle: `dark` at the wall,
  // white `w` metres out.
  aoSkirt(x0, z0, x1, z1, w, y, dark) {
    this.ensure(8, 24);
    const n0 = this.count, U = this.U, I = this.I;
    // Corners z1-side first (x0 z1, x1 z1, x1 z0, x0 z0), each pushed out
    // diagonally by w.
    for (let i = 0; i < 4; i++) {
      const X = i === 0 || i === 3 ? x0 : x1, Z = i < 2 ? z1 : z0;
      const OX = i === 0 || i === 3 ? -1 : 1, OZ = i < 2 ? 1 : -1;
      this._vert(n0 + i * 2, X, y, Z, dark, dark, dark, 0, 1, 0);
      this._vert(n0 + i * 2 + 1, X + OX * w, y, Z + OZ * w, 1, 1, 1, 0, 1, 0);
    }
    if (U) U.fill(0, n0 * 2, (n0 + 8) * 2);
    let k = this.ni;
    for (let i = 0; i < 4; i++) {
      const a = n0 + i * 2, b = n0 + ((i + 1) & 3) * 2;
      I[k] = a; I[k + 1] = a + 1; I[k + 2] = b + 1; I[k + 3] = a; I[k + 4] = b + 1; I[k + 5] = b;
      k += 6;
    }
    this.ni = k;
    this.count += 8;
  }

  // Copy another builder's contents in, moved, turned about the vertical
  // axis, scaled and tinted. Used to stamp out props from templates.
  add(t, x, y, z, rot = 0, sx = 1, sy = sx, sz = sx, tr = 1, tg = tr, tb = tr) {
    const nv = t.count, nti = t.ni;
    this.ensure(nv, nti);
    const c = Math.cos(rot), s = Math.sin(rot);
    const tp = t.P, tn = t.N, tc = t.C;
    const P = this.P, N = this.N, C = this.C;
    const o0 = this.count * 3, e = nv * 3;
    for (let i = 0; i < e; i += 3) {
      const o = o0 + i;
      const lx = tp[i] * sx, lz = tp[i + 2] * sz;
      P[o] = x + lx * c - lz * s; P[o + 1] = y + tp[i + 1] * sy; P[o + 2] = z + lx * s + lz * c;
      const nx = tn[i], nz = tn[i + 2];
      N[o] = nx * c - nz * s; N[o + 1] = tn[i + 1]; N[o + 2] = nx * s + nz * c;
      C[o] = tc[i] * tr; C[o + 1] = tc[i + 1] * tg; C[o + 2] = tc[i + 2] * tb;
    }
    if (this.U) {
      if (t.U) this.U.set(t.U.subarray(0, nv * 2), this.count * 2);
      else this.U.fill(0, this.count * 2, (this.count + nv) * 2);
    }
    const n = this.count, ti = t.I, I = this.I, k0 = this.ni;
    for (let i = 0; i < nti; i++) I[k0 + i] = ti[i] + n;
    this.ni += nti;
    this.count += nv;
  }

  build(material) {
    if (!this.count) return null;
    const n = this.count;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.P.slice(0, n * 3), 3));
    g.setAttribute('color', new THREE.BufferAttribute(this.C.slice(0, n * 3), 3));
    g.setAttribute('normal', new THREE.BufferAttribute(this.N.slice(0, n * 3), 3));
    if (this.U) g.setAttribute('uv', new THREE.BufferAttribute(this.U.slice(0, n * 2), 2));
    const ix = this.I.subarray(0, this.ni);
    g.setIndex(new THREE.BufferAttribute(n > 65535 ? ix.slice() : Uint16Array.from(ix), 1));
    g.computeBoundingSphere();
    g.computeBoundingBox();
    const mesh = new THREE.Mesh(g, material);
    mesh.matrixAutoUpdate = false;
    return mesh;
  }
}

// A set of builders split over a grid of map tiles, so tiles outside
// the camera's view are skipped when drawing. Each tile can hold up to
// three quality tiers (0 always drawn, 1 normal, 2 high): they share one
// mesh and the draw range decides how much of it is shown.
export class ChunkedBuilder {
  constructor(size, tiles, withUv = false, uvScale = 1) {
    this.size = size;
    this.tiles = tiles;
    this.withUv = withUv;
    this.uvScale = uvScale;
    this.map = new Map();
  }

  at(x, z, q = 0) {
    const t = this.tiles, s = this.size;
    const cx = Math.max(0, Math.min(t - 1, Math.floor(((x + s) / (2 * s)) * t)));
    const cz = Math.max(0, Math.min(t - 1, Math.floor(((z + s) / (2 * s)) * t)));
    const k = (cz * t + cx) * 3 + q;
    let b = this.map.get(k);
    if (!b) this.map.set(k, (b = new MeshBuilder(this.withUv, this.uvScale)));
    return b;
  }

  // opts: { order, cast, receive, name }
  buildInto(group, material, opts = 0) {
    const o = typeof opts === 'number' ? { order: opts } : opts;
    const made = [];
    const n = this.tiles * this.tiles;
    for (let k = 0; k < n; k++) {
      const parts = [this.map.get(k * 3), this.map.get(k * 3 + 1), this.map.get(k * 3 + 2)];
      let b = parts[0];
      let counts = null;
      if (parts[1] || parts[2]) {
        b = new MeshBuilder(this.withUv, this.uvScale);
        counts = [];
        for (const p of parts) {
          if (p) b.add(p, 0, 0, 0);
          counts.push(b.ni);
        }
      }
      const m = b ? b.build(material) : null;
      if (counts) b.release();
      if (!m) continue;
      if (counts) {
        m.userData.tierCounts = counts;
        m.geometry.setDrawRange(0, counts[1]);
      }
      m.renderOrder = o.order || 0;
      m.castShadow = !!o.cast;
      m.receiveShadow = !!o.receive;
      if (o.name) m.name = o.name;
      group.add(m);
      made.push(m);
    }
    return made;
  }
}
