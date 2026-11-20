// Collects coloured, optionally textured quads/boxes into one big
// geometry so thousands of objects draw in a single call. Vertex colours
// double as baked ambient occlusion: every corner takes a brightness
// factor, so walls can darken toward the pavement at no runtime cost.
import * as THREE from 'three';

const _c = new THREE.Color();

export class MeshBuilder {
  // uvScale: metres per texture repeat for ground quads made by flat().
  constructor(withUv = false, uvScale = 1) {
    this.pos = [];
    this.col = [];
    this.nor = [];
    this.uv = withUv ? [] : null;
    this.idx = [];
    this.count = 0;
    this.uvScale = uvScale;
  }

  // Four corners in counter-clockwise order seen from the front.
  // sa..sd are brightness factors for the corners a..d.
  quad(ax, ay, az, bx, by, bz, cx, cy, cz, dx, dy, dz, color, nx, ny, nz, u0 = 0, v0 = 0, u1 = 1, v1 = 1, sa = 1, sb = sa, sc = sa, sd = sa) {
    _c.setHex(color, THREE.SRGBColorSpace);
    const r = _c.r, g = _c.g, b = _c.b;
    this.pos.push(ax, ay, az, bx, by, bz, cx, cy, cz, dx, dy, dz);
    this.col.push(r * sa, g * sa, b * sa, r * sb, g * sb, b * sb, r * sc, g * sc, b * sc, r * sd, g * sd, b * sd);
    this.nor.push(nx, ny, nz, nx, ny, nz, nx, ny, nz, nx, ny, nz);
    if (this.uv) this.uv.push(u0, v0, u1, v0, u1, v1, u0, v1);
    const n = this.count;
    this.idx.push(n, n + 1, n + 2, n, n + 2, n + 3);
    this.count += 4;
  }

  // Like quad() but with a texture coordinate for every corner.
  quadUv(ax, ay, az, bx, by, bz, cx, cy, cz, dx, dy, dz, color, nx, ny, nz, ua, va, ub, vb, uc, vc, ud, vd, s = 1) {
    this.quad(ax, ay, az, bx, by, bz, cx, cy, cz, dx, dy, dz, color, nx, ny, nz, 0, 0, 1, 1, s);
    if (this.uv) {
      const u = this.uv, o = u.length - 8;
      u[o] = ua; u[o + 1] = va; u[o + 2] = ub; u[o + 3] = vb; u[o + 4] = uc; u[o + 5] = vc; u[o + 6] = ud; u[o + 7] = vd;
    }
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
    const c = this.col, o = c.length - 12;
    const f = [s01, s11, s10, s00];
    for (let i = 0; i < 4; i++) {
      c[o + i * 3] *= f[i]; c[o + i * 3 + 1] *= f[i]; c[o + i * 3 + 2] *= f[i];
    }
  }

  // Flat rectangle showing one cell of a texture atlas. rot (0..3)
  // turns the picture in quarter turns.
  flatRect(x0, z0, x1, z1, y, color, r, rot = 0, s = 1) {
    const us = [r.u0, r.u1, r.u1, r.u0], vs = [r.v0, r.v0, r.v1, r.v1];
    const k = rot & 3;
    this.quadUv(x0, y, z1, x1, y, z1, x1, y, z0, x0, y, z0, color, 0, 1, 0,
      us[k], vs[k], us[(k + 1) & 3], vs[(k + 1) & 3], us[(k + 2) & 3], vs[(k + 2) & 3], us[(k + 3) & 3], vs[(k + 3) & 3], s);
  }

  // One upright wall from (ax, az) to (bx, bz), seen from its right-hand
  // side. s0/s1 are the brightness at the bottom and the top.
  wall(ax, az, bx, bz, y0, y1, color, u0 = 0, v0 = 0, u1 = 1, v1 = 1, s0 = 1, s1 = s0) {
    const dx = bx - ax, dz = bz - az;
    const l = Math.hypot(dx, dz) || 1;
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
    const k = 1 / this.uvScale;
    const q = (px, pz, qx, qz, rx, rz, tx, tz) => {
      this.quadUv(px, y, pz, qx, y, qz, rx, y, rz, tx, y, tz, color, 0, 1, 0, px * k, pz * k, qx * k, qz * k, rx * k, rz * k, tx * k, tz * k);
      const c = this.col, o = c.length - 12;
      for (let i = 0; i < 6; i++) c[o + i] *= sOut;
      for (let i = 6; i < 12; i++) c[o + i] *= sIn;
    };
    q(x0, z1, x1, z1, a1, c1, a0, c1); // south
    q(x1, z0, x0, z0, a0, c0, a1, c0); // north
    q(x1, z1, x1, z0, a1, c0, a1, c1); // east
    q(x0, z0, x0, z1, a0, c1, a0, c0); // west
  }

  tri(ax, ay, az, bx, by, bz, cx, cy, cz, color, nx, ny, nz, ua = 0, va = 0, ub = 0, vb = 0, uc = 0, vc = 0, s = 1) {
    _c.setHex(color, THREE.SRGBColorSpace);
    this.pos.push(ax, ay, az, bx, by, bz, cx, cy, cz);
    for (let i = 0; i < 3; i++) {
      this.col.push(_c.r * s, _c.g * s, _c.b * s);
      this.nor.push(nx, ny, nz);
    }
    if (this.uv) this.uv.push(ua, va, ub, vb, uc, vc);
    const n = this.count;
    this.idx.push(n, n + 1, n + 2);
    this.count += 3;
  }

  // Box turned by `rot` about the vertical axis; hx/hz are half sizes.
  obox(cx, cz, hx, hz, y0, y1, rot, color, topColor = color, s0 = 1, s1 = s0) {
    const c = Math.cos(rot), s = Math.sin(rot);
    const px = (lx, lz) => cx + lx * c - lz * s;
    const pz = (lx, lz) => cz + lx * s + lz * c;
    const X = [px(-hx, hz), px(hx, hz), px(hx, -hz), px(-hx, -hz)];
    const Z = [pz(-hx, hz), pz(hx, hz), pz(hx, -hz), pz(-hx, -hz)];
    for (let i = 0; i < 4; i++) {
      const j = (i + 1) & 3;
      this.wall(X[i], Z[i], X[j], Z[j], y0, y1, color, 0, 0, 1, 1, s0, s1);
    }
    this.quad(X[0], y1, Z[0], X[1], y1, Z[1], X[2], y1, Z[2], X[3], y1, Z[3], topColor, 0, 1, 0, 0, 0, 1, 1, s1);
  }

  // Upright tube with smooth sides; r0/r1 are the bottom and top radii.
  cyl(cx, cz, y0, y1, r0, r1, sides, color, cap = false, s0 = 1, s1 = s0, topColor = color) {
    _c.setHex(color, THREE.SRGBColorSpace);
    const n0 = this.count;
    const slope = (r0 - r1) / Math.max(1e-6, y1 - y0);
    const nl = Math.hypot(1, slope);
    for (let i = 0; i <= sides; i++) {
      const a = (i / sides) * Math.PI * 2;
      const ca = Math.cos(a), sa = Math.sin(a);
      this.pos.push(cx + ca * r0, y0, cz + sa * r0, cx + ca * r1, y1, cz + sa * r1);
      this.col.push(_c.r * s0, _c.g * s0, _c.b * s0, _c.r * s1, _c.g * s1, _c.b * s1);
      this.nor.push(ca / nl, slope / nl, sa / nl, ca / nl, slope / nl, sa / nl);
      if (this.uv) this.uv.push(i / sides, 0, i / sides, 1);
    }
    for (let i = 0; i < sides; i++) {
      const a = n0 + i * 2;
      this.idx.push(a, a + 1, a + 3, a, a + 3, a + 2);
    }
    this.count += (sides + 1) * 2;
    if (cap && r1 > 0) {
      _c.setHex(topColor, THREE.SRGBColorSpace);
      const c0 = this.count;
      for (let i = 0; i < sides; i++) {
        const a = (i / sides) * Math.PI * 2;
        this.pos.push(cx + Math.cos(a) * r1, y1, cz + Math.sin(a) * r1);
        this.col.push(_c.r * s1, _c.g * s1, _c.b * s1);
        this.nor.push(0, 1, 0);
        if (this.uv) this.uv.push(0, 0);
      }
      for (let i = 1; i < sides - 1; i++) this.idx.push(c0, c0 + i + 1, c0 + i);
      this.count += sides;
    }
  }

  // Squashed ball (tree canopy, dome). Darker underneath; `jit` nudges
  // each ring so no two look alike.
  blob(cx, cy, cz, rx, ry, rz, color, segs = 6, rings = 4, lo = 0.6, hi = 1.05, jit = null) {
    _c.setHex(color, THREE.SRGBColorSpace);
    const n0 = this.count;
    for (let j = 0; j <= rings; j++) {
      const ph = (j / rings) * Math.PI;
      const y = Math.cos(ph), rr = Math.sin(ph);
      for (let i = 0; i <= segs; i++) {
        const th = (i / segs) * Math.PI * 2 + j * 0.5;
        let k = 1;
        if (jit && j > 0 && j < rings && i < segs) k = 1 + jit() * 0.22;
        if (jit && i === segs) k = this._k0;
        if (i === 0) this._k0 = k;
        const x = Math.cos(th) * rr, z = Math.sin(th) * rr;
        this.pos.push(cx + x * rx * k, cy + y * ry * k, cz + z * rz * k);
        const s = lo + (hi - lo) * (y * 0.5 + 0.5);
        this.col.push(_c.r * s, _c.g * s, _c.b * s);
        this.nor.push(x, y, z);
        if (this.uv) this.uv.push(0, 0);
      }
    }
    const w = segs + 1;
    for (let j = 0; j < rings; j++) {
      for (let i = 0; i < segs; i++) {
        const a = n0 + j * w + i, b = a + w;
        if (j > 0) this.idx.push(a, a + 1, b);
        if (j < rings - 1) this.idx.push(a + 1, b + 1, b);
      }
    }
    this.count += w * (rings + 1);
  }

  // Soft dark disc on the ground (for the multiply-blended contact
  // shadow layer): `dark` in the middle fading to white at the rim.
  aoDisc(cx, cz, r, y, dark, sides = 8) {
    const n0 = this.count;
    this.pos.push(cx, y, cz);
    this.col.push(dark, dark, dark);
    this.nor.push(0, 1, 0);
    for (let i = 0; i < sides; i++) {
      const a = (i / sides) * Math.PI * 2;
      this.pos.push(cx + Math.cos(a) * r, y, cz + Math.sin(a) * r);
      this.col.push(1, 1, 1);
      this.nor.push(0, 1, 0);
    }
    for (let i = 0; i < sides; i++) this.idx.push(n0, n0 + 1 + ((i + 1) % sides), n0 + 1 + i);
    this.count += sides + 1;
  }

  // Dark frame on the ground around a rectangle: `dark` at the wall,
  // white `w` metres out.
  aoSkirt(x0, z0, x1, z1, w, y, dark) {
    const n0 = this.count;
    const X = [x0, x1, x1, x0], Z = [z1, z1, z0, z0];
    const OX = [-1, 1, 1, -1], OZ = [1, 1, -1, -1];
    for (let i = 0; i < 4; i++) {
      this.pos.push(X[i], y, Z[i], X[i] + OX[i] * w, y, Z[i] + OZ[i] * w);
      this.col.push(dark, dark, dark, 1, 1, 1);
      this.nor.push(0, 1, 0, 0, 1, 0);
    }
    for (let i = 0; i < 4; i++) {
      const a = n0 + i * 2, b = n0 + ((i + 1) & 3) * 2;
      this.idx.push(a, a + 1, b + 1, a, b + 1, b);
    }
    this.count += 8;
  }

  // Copy another builder's contents in, moved, turned about the vertical
  // axis, scaled and tinted. Used to stamp out props from templates.
  add(t, x, y, z, rot = 0, sx = 1, sy = sx, sz = sx, tr = 1, tg = tr, tb = tr) {
    const c = Math.cos(rot), s = Math.sin(rot);
    const tp = t.pos, tn = t.nor, tc = t.col;
    const P = this.pos, N = this.nor, C = this.col;
    for (let i = 0; i < tp.length; i += 3) {
      const lx = tp[i] * sx, lz = tp[i + 2] * sz;
      P.push(x + lx * c - lz * s, y + tp[i + 1] * sy, z + lx * s + lz * c);
      const nx = tn[i], nz = tn[i + 2];
      N.push(nx * c - nz * s, tn[i + 1], nx * s + nz * c);
      C.push(tc[i] * tr, tc[i + 1] * tg, tc[i + 2] * tb);
    }
    if (this.uv) {
      if (t.uv) for (let i = 0; i < t.uv.length; i++) this.uv.push(t.uv[i]);
      else for (let i = 0; i < t.count * 2; i++) this.uv.push(0);
    }
    const n = this.count, ti = t.idx, I = this.idx;
    for (let i = 0; i < ti.length; i++) I.push(ti[i] + n);
    this.count += t.count;
  }

  build(material) {
    if (!this.count) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    if (this.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setIndex(this.count > 65535 ? new THREE.Uint32BufferAttribute(this.idx, 1) : new THREE.Uint16BufferAttribute(this.idx, 1));
    g.computeBoundingSphere();
    g.computeBoundingBox();
    const mesh = new THREE.Mesh(g, material);
    mesh.matrixAutoUpdate = false;
    return mesh;
  }
}

// A set of builders split over a grid of map tiles, so tiles outside
// the camera's view are skipped when drawing.
export class ChunkedBuilder {
  constructor(size, tiles, withUv = false, uvScale = 1) {
    this.size = size;
    this.tiles = tiles;
    this.withUv = withUv;
    this.uvScale = uvScale;
    this.map = new Map();
  }

  at(x, z) {
    const t = this.tiles, s = this.size;
    const cx = Math.max(0, Math.min(t - 1, Math.floor(((x + s) / (2 * s)) * t)));
    const cz = Math.max(0, Math.min(t - 1, Math.floor(((z + s) / (2 * s)) * t)));
    const k = cz * t + cx;
    let b = this.map.get(k);
    if (!b) this.map.set(k, (b = new MeshBuilder(this.withUv, this.uvScale)));
    return b;
  }

  // opts: { order, cast, receive, name }
  buildInto(group, material, opts = 0) {
    const o = typeof opts === 'number' ? { order: opts } : opts;
    const made = [];
    for (const b of this.map.values()) {
      const m = b.build(material);
      if (m) {
        m.renderOrder = o.order || 0;
        m.castShadow = !!o.cast;
        m.receiveShadow = !!o.receive;
        if (o.name) m.name = o.name;
        group.add(m);
        made.push(m);
      }
    }
    return made;
  }
}
