// Street life: trees, lamps, traffic lights, benches, signs and the
// island's landmarks. Small things are stamped from a handful of
// template shapes into the per-tile prop meshes, so the whole lot costs
// a few draw calls. Only big things get colliders.
import { MeshBuilder } from './meshbuilder.js';
import { createRng, TAU } from '../core/rng.js';

const GREENS = [0x3f7f3c, 0x4a8a3e, 0x356f38, 0x5a9444, 0x447a4a];
const UMBRELLA = [0xd8452c, 0x2c7fb8, 0xf0c030, 0x2fa88a, 0xf4f0e6, 0xe07aa0];
const BIKE = [0xd8452c, 0x2c7fb8, 0x2f2f33, 0x3f9a5a, 0xe0b030, 0xf2f2f2];
const FLOWERS = [0xd84a6a, 0xf0c030, 0xe8e0f0, 0xd86a2c, 0x9a5ac8];

function hexShade(hex, f) {
  const r = Math.min(255, ((hex >> 16) & 255) * f) | 0;
  const g = Math.min(255, ((hex >> 8) & 255) * f) | 0;
  const b = Math.min(255, (hex & 255) * f) | 0;
  return (r << 16) | (g << 8) | b;
}

// ---- template shapes (built once) ------------------------------------------
function makeTemplates(rng) {
  const T = { trees: [], conifers: [], palms: [] };
  const jit = () => rng.next() - 0.5;
  const bark = 0x6b4a33;
  for (let v = 0; v < 6; v++) {
    const t = new MeshBuilder();
    const g = GREENS[v % GREENS.length];
    if (v % 3 === 0) {
      // Round crown: one big ball and a couple of smaller ones.
      t.cyl(0, 0, 0, 0.45, 0.04, 0.026, 5, bark, false, 0.7, 1);
      t.blob(0, 0.68, 0, 0.26, 0.24, 0.26, g, 6, 4, 0.55, 1.08, jit);
      for (let i = 0; i < 2; i++) {
        const a = rng.range(0, TAU), d = rng.range(0.13, 0.18);
        t.blob(Math.cos(a) * d, rng.range(0.52, 0.62), Math.sin(a) * d, 0.17, 0.15, 0.17, hexShade(g, rng.range(0.85, 1.1)), 5, 3, 0.55, 1.05, jit);
      }
    } else if (v % 3 === 1) {
      // Tall oval crown.
      t.cyl(0, 0, 0, 0.36, 0.035, 0.024, 5, bark, false, 0.7, 1);
      t.blob(0, 0.63, 0, 0.17, 0.36, 0.17, g, 6, 5, 0.55, 1.08, jit);
      t.blob(rng.range(-0.05, 0.05), 0.42, rng.range(-0.05, 0.05), 0.15, 0.14, 0.15, hexShade(g, 0.9), 5, 3, 0.55, 1, jit);
    } else {
      // Wide spreading crown in layers.
      t.cyl(0, 0, 0, 0.5, 0.05, 0.03, 5, bark, false, 0.7, 1);
      t.blob(0, 0.72, 0, 0.3, 0.16, 0.3, g, 7, 3, 0.5, 1.08, jit);
      for (let i = 0; i < 3; i++) {
        const a = (i / 3) * TAU + rng.range(0, 1), d = rng.range(0.14, 0.2);
        t.blob(Math.cos(a) * d, rng.range(0.56, 0.64), Math.sin(a) * d, 0.2, 0.11, 0.2, hexShade(g, rng.range(0.82, 1.05)), 5, 3, 0.5, 1.05, jit);
      }
    }
    T.trees.push(t);
  }
  for (let v = 0; v < 2; v++) {
    const t = new MeshBuilder();
    const g = v ? 0x2f5f3a : 0x35684a;
    t.cyl(0, 0, 0, 0.22, 0.03, 0.025, 5, bark, false, 0.7, 1);
    t.cyl(0, 0, 0.16, 0.56, 0.25, 0.03, 7, g, false, 0.55, 1);
    t.cyl(0, 0, 0.4, 0.8, 0.19, 0.02, 7, g, false, 0.6, 1.05);
    t.cyl(0, 0, 0.66, 1.0, 0.12, 0, 6, g, false, 0.7, 1.1);
    T.conifers.push(t);
  }
  for (let v = 0; v < 3; v++) {
    const t = new MeshBuilder();
    const lean = rng.range(0.03, 0.09), la = rng.range(0, TAU);
    const lx = Math.cos(la) * lean, lz = Math.sin(la) * lean;
    const trunk = 0x8a7458;
    for (let i = 0; i < 4; i++) {
      const k0 = i / 4, k1 = (i + 1) / 4;
      const ox = lx * k1 * k1, oz = lz * k1 * k1;
      t.cyl(ox, oz, k0 * 0.92, k1 * 0.92 + 0.01, 0.03 - k0 * 0.008, 0.03 - k1 * 0.008, 5, hexShade(trunk, i % 2 ? 0.9 : 1.05), false, 0.8, 1);
    }
    const tx = lx, tz = lz, ty = 0.92;
    t.blob(tx, ty - 0.01, tz, 0.035, 0.03, 0.035, 0x4a3a22, 4, 2, 0.8, 1);
    const n = 8;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU + rng.range(-0.2, 0.2);
      const ca = Math.cos(a), sa = Math.sin(a);
      const droop = rng.range(0.08, 0.2), reach = rng.range(0.34, 0.44), up = rng.range(0.03, 0.1);
      const g = GREENS[(i + v) % GREENS.length];
      // Three ribs along the frond: at the crown, at the arch, at the tip.
      const P = [[0.02, 0, 0.035], [reach * 0.5, up, 0.06], [reach, up - droop, 0.012]];
      for (let s = 0; s < 2; s++) {
        const [d0, h0, w0] = P[s], [d1, h1, w1] = P[s + 1];
        const ax = tx + ca * d0 - sa * w0, az = tz + sa * d0 + ca * w0, bx = tx + ca * d0 + sa * w0, bz = tz + sa * d0 - ca * w0;
        const cx = tx + ca * d1 + sa * w1, cz = tz + sa * d1 - ca * w1, dx = tx + ca * d1 - sa * w1, dz = tz + sa * d1 + ca * w1;
        t.quad(ax, ty + h0, az, bx, ty + h0, bz, cx, ty + h1, cz, dx, ty + h1, dz, g, 0, 1, 0, 0, 0, 1, 1, s ? 1.05 : 0.9, s ? 1.05 : 0.9, s ? 0.8 : 1.05, s ? 0.8 : 1.05);
        t.quad(bx, ty + h0, bz, ax, ty + h0, az, dx, ty + h1, dz, cx, ty + h1, cz, hexShade(g, 0.55), 0, -1, 0);
      }
    }
    T.palms.push(t);
  }

  // Street lamp, 7 m tall, arm along +x.
  const lamp = (T.lamp = new MeshBuilder());
  lamp.cyl(0, 0, 0, 0.9, 0.15, 0.11, 6, 0x3a3e42, false, 0.6, 1);
  lamp.cyl(0, 0, 0.9, 6.7, 0.085, 0.06, 5, 0x4a4e52);
  lamp.box(-0.06, -0.05, 2.0, 0.05, 6.62, 6.72, 0x4a4e52);
  lamp.box(1.35, -0.17, 2.12, 0.17, 6.68, 6.82, 0x3a3e42);
  lamp.quad(1.4, 6.675, -0.13, 2.08, 6.675, -0.13, 2.08, 6.675, 0.13, 1.4, 6.675, 0.13, 0xfff2c4, 0, -1, 0);

  // Bench facing +x.
  const bench = (T.bench = new MeshBuilder());
  bench.box(-0.22, -0.8, 0.22, 0.8, 0.4, 0.47, 0x8a6a48, 0x9a7a55);
  bench.box(-0.27, -0.8, -0.21, 0.8, 0.47, 0.92, 0x8a6a48, 0x9a7a55, 0.85, 1);
  bench.box(-0.2, -0.72, 0.2, -0.64, 0, 0.4, 0x33363a);
  bench.box(-0.2, 0.64, 0.2, 0.72, 0, 0.4, 0x33363a);

  const bin = (T.bin = new MeshBuilder());
  bin.cyl(0, 0, 0, 0.92, 0.25, 0.29, 7, 0x2f4a3a, true, 0.6, 1, 0x1c1e20);

  const hyd = (T.hydrant = new MeshBuilder());
  hyd.cyl(0, 0, 0, 0.52, 0.13, 0.12, 6, 0xc8382c, false, 0.65, 1);
  hyd.cyl(0, 0, 0.52, 0.7, 0.15, 0.05, 6, 0xc8382c, true);
  hyd.box(-0.2, -0.06, 0.2, 0.06, 0.3, 0.42, 0xb0b4b8);

  const mail = (T.mailbox = new MeshBuilder());
  mail.box(-0.22, -0.24, 0.22, 0.24, 0.12, 1.1, 0x2c4f8a, 0x3a62a6, 0.7, 1);
  mail.box(-0.18, -0.2, 0.18, 0.2, 0, 0.12, 0x202428);

  const meter = (T.meter = new MeshBuilder());
  meter.box(-0.035, -0.035, 0.035, 0.035, 0, 1.1, 0x55585c);
  meter.box(-0.07, -0.1, 0.07, 0.1, 1.1, 1.38, 0x30343a, 0x50545a);

  const planter = (T.planter = new MeshBuilder());
  planter.box(-0.6, -0.6, 0.6, 0.6, 0, 0.55, 0xa8a49c, 0x4a3a2c, 0.65, 1);
  planter.blob(0, 0.72, 0, 0.58, 0.34, 0.58, 0x4a8a3e, 6, 3, 0.6, 1.1, jit);

  const barrier = (T.barrier = new MeshBuilder());
  barrier.box(-0.3, -1.0, 0.3, 1.0, 0, 0.3, 0xb8b4ac, 0xb8b4ac, 0.6, 0.9);
  barrier.box(-0.16, -1.0, 0.16, 1.0, 0.3, 0.82, 0xd8762c, 0xc8c4bc);

  // Bus shelter facing +x: roof, glazed back, posts and a seat.
  const sh = (T.shelter = new MeshBuilder());
  sh.box(-0.75, -1.75, 0.8, 1.75, 2.45, 2.56, 0x3c4046, 0x5a5e64);
  sh.box(-0.7, -1.65, -0.64, 1.65, 0.25, 2.3, 0x9fb8c6, 0x9fb8c6, 0.85, 1);
  for (const z of [-1.68, 1.6]) {
    sh.box(-0.72, z, -0.62, z + 0.08, 0, 2.45, 0x3c4046);
    sh.box(0.62, z, 0.72, z + 0.08, 0, 2.45, 0x3c4046);
  }
  sh.box(-0.58, -1.2, -0.2, 1.2, 0.42, 0.5, 0x8a6a48, 0x9a7a55);
  sh.box(-0.5, -1.1, -0.3, -1.0, 0, 0.42, 0x33363a);
  sh.box(-0.5, 1.0, -0.3, 1.1, 0, 0.42, 0x33363a);

  const bol = (T.bollard = new MeshBuilder());
  bol.cyl(0, 0, 0, 0.42, 0.16, 0.14, 6, 0x2a2c30, false, 0.7, 1);
  bol.cyl(0, 0, 0.42, 0.55, 0.22, 0.2, 6, 0x2a2c30, true);

  const rack = (T.rack = new MeshBuilder());
  rack.box(-0.03, -1.3, 0.03, 1.3, 0.72, 0.78, 0x9aa0a6);
  for (const z of [-1.3, 0, 1.27]) rack.box(-0.03, z, 0.03, z + 0.05, 0, 0.72, 0x9aa0a6);

  return T;
}

// ---- Miami templates (own random stream: the island is unchanged) --------
const LEAF = [0x3f7a34, 0x4d8a3a, 0x2f6a34, 0x5c9a40, 0x3a7448, 0x6a9c3c, 0x48823c];

// One palm frond as a folded strip with the leaflet picture (atlas
// rect r): from (x, y, z) out along heading a, rising at `elev`
// radians and bending down by `droop` toward the tip.
function frond(B, r, x, y, z, a, elev, len, droop, color) {
  const S = 4, ca = Math.cos(a), sa = Math.sin(a);
  const sx = -sa, sz = ca;
  let px = x, py = y, pz = z;
  const vm = (r.v0 + r.v1) / 2;
  let prev = null;
  for (let k = 0; k <= S; k++) {
    const t = k / S;
    const w = len * 0.2 * Math.sin(Math.PI * Math.min(1, t * 0.95 + 0.12)) + 0.004;
    const fold = w * 0.45;
    const cur = [px, py, pz, w, fold, r.u0 + (r.u1 - r.u0) * t];
    if (prev) {
      const [ax, ay, az, aw, af, au] = prev;
      const [bx, by, bz, bw, bf, bu] = cur;
      const tx = bx - ax, ty = by - ay, tz = bz - az;
      for (const side of [-1, 1]) {
        // Edge points: out to the side and folded down a little.
        const aex = ax + sx * aw * side, aey = ay - af, aez = az + sz * aw * side;
        const bex = bx + sx * bw * side, bey = by - bf, bez = bz + sz * bw * side;
        const ex = sx * side, ey = -0.45, ez = sz * side;
        let nx = ty * ez - tz * ey, ny = tz * ex - tx * ez, nz = tx * ey - ty * ex;
        if (ny < 0) { nx = -nx; ny = -ny; nz = -nz; }
        const l = Math.hypot(nx, ny, nz) || 1;
        const ve = side > 0 ? r.v1 : r.v0;
        B.quadUv(ax, ay, az, bx, by, bz, bex, bey, bez, aex, aey, aez, color, nx / l, ny / l, nz / l, au, vm, bu, vm, bu, ve, au, ve);
      }
    }
    prev = cur;
    const e = elev - droop * t * t;
    const step = len / S;
    px += ca * Math.cos(e) * step;
    pz += sa * Math.cos(e) * step;
    py += Math.sin(e) * step;
  }
}

// A canopy cluster with the foliage picture wrapped round it.
function leafy(B, r, cx, cy, cz, rx, ry, rz, color, segs, rings, jit) {
  const n0 = B.count;
  B.blob(cx, cy, cz, rx, ry, rz, color, segs, rings, 0.5, 1.1, jit);
  const uv = B.uv, du = (r.u1 - r.u0) / segs, dv = (r.v1 - r.v0) / rings;
  for (let j = 0, k = n0 * 2; j <= rings; j++) {
    for (let i = 0; i <= segs; i++, k += 2) {
      uv[k] = r.u0 + du * i;
      uv[k + 1] = r.v1 - dv * j;
    }
  }
}

function makeMiamiTemplates(rng, R) {
  const T = { canopies: [], foliage: [], palmTrunks: [], palmCrowns: [] };
  const jit = () => rng.next() - 0.5;
  for (let v = 0; v < 6; v++) {
    // Rounded canopy of many overlapping clumps in several greens (the
    // foliage picture on them), on a short trunk with two limbs.
    const t = new MeshBuilder(), f = new MeshBuilder(true);
    const bark = hexShade(0x5e4632, rng.range(0.85, 1.15));
    const g = LEAF[v];
    const th = rng.range(0.3, 0.4);
    t.cyl(0, 0, 0, th + 0.12, 0.05, 0.032, 6, bark, false, 0.65, 1);
    for (const a of [rng.range(0, TAU), rng.range(0, TAU)]) {
      t.cyl(Math.cos(a) * 0.05, Math.sin(a) * 0.05, th, th + 0.18, 0.022, 0.012, 4, bark, false, 0.8, 1);
    }
    // A hidden core, then a dome of smaller clumps round it: reads as
    // foliage, not as one ball.
    leafy(f, R.leaves, 0, th + 0.3, 0, 0.2, 0.15, 0.2, hexShade(g, 0.7), 6, 3, jit);
    const n = 8 + (v % 3);
    const rad = rng.range(0.19, 0.24);
    for (let i = 0; i < n; i++) {
      const a = i * 2.39996 + v;
      const up = (i + 0.5) / n;
      const ring = Math.sqrt(1 - up * up * 0.75);
      const r = rng.range(0.1, 0.135) * (1.1 - up * 0.3);
      leafy(f, R.leaves, Math.cos(a) * rad * ring, th + 0.22 + up * 0.24, Math.sin(a) * rad * ring, r, r * 0.8, r, hexShade(LEAF[(v + i) % LEAF.length], rng.range(0.82, 1.14) * (0.88 + up * 0.22)), 6, 3, jit);
    }
    T.canopies.push(t);
    T.foliage.push(f);
  }
  for (let v = 0; v < 4; v++) {
    // Palm: a ringed, slightly leaning trunk (plain mesh) and a crown
    // of leafy fronds (detail mesh, the leaflet picture, see-through).
    const t = new MeshBuilder();
    const lean = rng.range(0.03, 0.1), la = rng.range(0, TAU);
    const lx = Math.cos(la) * lean, lz = Math.sin(la) * lean;
    const SEG = 6, H = 0.95;
    const trunk = v % 2 ? 0x9a8a74 : 0x8c7a62;
    for (let i = 0; i < SEG; i++) {
      const k0 = i / SEG, k1 = (i + 1) / SEG;
      const ox = lx * k1 * k1, oz = lz * k1 * k1;
      const r0 = (i === 0 ? 0.04 : 0.027 - k0 * 0.008), r1 = 0.027 - k1 * 0.008;
      t.cyl(ox, oz, k0 * H, k1 * H + 0.004, r0, r1, 6, hexShade(trunk, i % 2 ? 0.88 : 1.06), false, 0.82, 1);
    }
    // Crown shaft and boot.
    t.cyl(lx, lz, H - 0.01, H + 0.035, 0.021, 0.026, 6, 0x6a7a4a, false, 0.85, 1);
    t.blob(lx, H + 0.03, lz, 0.034, 0.03, 0.034, 0x4a5a30, 5, 3, 0.7, 1);
    for (let i = 0; i < 3; i++) {
      const a = rng.range(0, TAU);
      t.blob(lx + Math.cos(a) * 0.025, H + 0.012, lz + Math.sin(a) * 0.025, 0.012, 0.012, 0.012, 0x6a5228, 4, 2, 0.8, 1);
    }
    T.palmTrunks.push(t);
    const c = new MeshBuilder(true);
    const nF = 11 + (v % 2) * 2;
    for (let i = 0; i < nF; i++) {
      const a = (i / nF) * TAU + rng.range(-0.18, 0.18);
      const tier = i % 3;
      const elev = [0.75, 0.3, -0.15][tier] + rng.range(-0.12, 0.12);
      const len = rng.range(0.3, 0.4) * (tier === 0 ? 0.85 : 1);
      const col = hexShade(0xe8f0d8, rng.range(0.82, 1.05));
      frond(c, R.frond, lx, H + 0.035, lz, a, elev, len, rng.range(1.4, 2.4), col);
    }
    // A couple of old fronds hanging down, browned.
    for (let i = 0; i < 2; i++) {
      frond(c, R.frond, lx, H, lz, rng.range(0, TAU), -1.0, rng.range(0.18, 0.24), 0.6, 0xd8b070);
    }
    T.palmCrowns.push(c);
  }
  return T;
}

// Lighter trees for the lot dressing (there are many more of them than
// street trees): a canopy of four clumps, a palm crown of seven fronds
// and a trunk in three pieces. About a third of the street tree's
// triangles, the same pictures and colours.
function makeLotTemplates(rng, R) {
  const T = { canopies: [], foliage: [], palmTrunks: [], palmCrowns: [] };
  const jit = () => rng.next() - 0.5;
  for (let v = 0; v < 4; v++) {
    const t = new MeshBuilder(), f = new MeshBuilder(true);
    const bark = hexShade(0x5e4632, rng.range(0.85, 1.15));
    const g = LEAF[(v * 2) % LEAF.length];
    const th = rng.range(0.3, 0.4);
    t.cyl(0, 0, 0, th + 0.12, 0.05, 0.032, 5, bark, false, 0.65, 1);
    leafy(f, R.leaves, 0, th + 0.36, 0, 0.21, 0.22, 0.21, hexShade(g, 0.95), 6, 3, jit);
    for (let i = 0; i < 3; i++) {
      const a = i * 2.09 + v;
      const r = rng.range(0.13, 0.16);
      leafy(f, R.leaves, Math.cos(a) * 0.13, th + 0.3 + (i % 2) * 0.16, Math.sin(a) * 0.13, r, r * 1.05, r, hexShade(LEAF[(v + i * 3) % LEAF.length], rng.range(0.95, 1.2)), 5, 3, jit);
    }
    T.canopies.push(t);
    T.foliage.push(f);
  }
  for (let v = 0; v < 3; v++) {
    const t = new MeshBuilder();
    const lean = rng.range(0.03, 0.1), la = rng.range(0, TAU);
    const lx = Math.cos(la) * lean, lz = Math.sin(la) * lean;
    const SEG = 3, H = 0.95;
    const trunk = v % 2 ? 0x9a8a74 : 0x8c7a62;
    for (let i = 0; i < SEG; i++) {
      const k0 = i / SEG, k1 = (i + 1) / SEG;
      t.cyl(lx * k1 * k1, lz * k1 * k1, k0 * H, k1 * H + 0.004, i === 0 ? 0.038 : 0.027 - k0 * 0.008, 0.027 - k1 * 0.008, 5, hexShade(trunk, i % 2 ? 0.88 : 1.06), false, 0.82, 1);
    }
    t.blob(lx, H + 0.03, lz, 0.034, 0.03, 0.034, 0x4a5a30, 4, 2, 0.7, 1);
    T.palmTrunks.push(t);
    const c = new MeshBuilder(true);
    const nF = 7;
    for (let i = 0; i < nF; i++) {
      const a = (i / nF) * TAU + rng.range(-0.2, 0.2);
      const elev = [0.6, 0.15][i % 2] + rng.range(-0.12, 0.12);
      frond(c, R.frond, lx, H + 0.035, lz, a, elev, rng.range(0.32, 0.4), rng.range(1.4, 2.2), hexShade(0xe8f0d8, rng.range(0.82, 1.05)));
    }
    T.palmCrowns.push(c);
  }
  return T;
}
const lotTemplateCache = new WeakMap();

// Which Miami streets get palms (the rest get round shade trees).
const PALM_PLACES = new Set(['Brickell', 'Downtown Miami', 'Brickell Key', 'Bayfront Park', 'Park West', 'Edgewater', 'Margaret Pace Park', 'Museum Park',
  'Miami Beach', 'Watson Island', 'Fisher Island', 'Venetian Islands', 'Hibiscus Island', 'Palm Island', 'Virginia Key', 'Miami']);

// Named boulevards lined with palms whatever their width.
const PALM_STREET = /Southwest 8th Street|Brickell Avenue|Brickell Bay|Biscayne Boulevard|Bayshore|Ocean Drive|Collins Avenue|Alton Road|Venetian|MacArthur|Coral Way|Port Boulevard/;

// Where the extra Miami palms stand (x, z, height triples): down the
// avenues of the palm neighbourhoods and the named palm boulevards, and
// along the seawalls there. Worked out once per city (the whole map is
// scanned) and kept, so a streamed tile only filters the list.
const palmCache = new WeakMap(), templateCache = new WeakMap();
function miamiPalmSpots(city, lamps, hash, blocked) {
  let out = palmCache.get(city);
  if (out) return out;
  out = [];
  const lampNear = new Set();
  for (const l of lamps) lampNear.add(Math.round(l.x / 4) * 100000 + Math.round(l.z / 4));
  const nearLamp = (x, z) => {
    const i = Math.round(x / 4), j = Math.round(z / 4);
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) if (lampNear.has((i + a) * 100000 + j + b)) return true;
    return false;
  };
  for (const e of city.edges) {
    if (e.causeway || e.bridge) continue;
    const named = !!(e.name && PALM_STREET.test(e.name));
    if (e.width < 18 && !named) continue;
    const a = city.nodes[e.a], bn = city.nodes[e.b];
    if (!named && !PALM_PLACES.has(city.placeOf((a.x + bn.x) / 2, (a.z + bn.z) / 2))) continue;
    const half = e.width / 2, rx = -e.uz, rz = e.ux;
    for (const sd of [-1, 1]) {
      for (let d = (a.hx || 0) + 8; d + 8 <= e.length - (bn.hx || 0); d += 13) {
        const x = a.x + e.ux * d + rx * sd * (half + 1.15), z = a.z + e.uz * d + rz * sd * (half + 1.15);
        // Diagonal streets have no block beside them: any open land will do.
        const ground = city.blockAt(x, z) || (city.isLand && city.isLand(x, z) && city.onRoad && !city.onRoad(x, z));
        if (!ground || (city.inBuilding && city.inBuilding(x, z, 1)) || nearLamp(x, z)) continue;
        out.push(x, z, 8 + hash(x, z + 5) * 4);
      }
    }
  }
  if (city.mainShore && city.bounds) {
    const B = city.bounds, st = 15;
    for (let z = B.z0 + 7; z < B.z1; z += st) {
      for (let x = B.x0 + 7; x < B.x1; x += st) {
        const sd = city.mainShore(x, z);
        if (sd < 4 || sd >= 4 + st * 0.7) continue;
        const jx = x + (hash(x, z) - 0.5) * 6, jz = z + (hash(z, x) - 0.5) * 6;
        const s2 = city.mainShore(jx, jz);
        if (s2 < 3.5 || hash(jx + 1, jz) > 0.75) continue;
        if (!PALM_PLACES.has(city.placeOf(jx, jz))) continue;
        if ((city.onRoad && city.onRoad(jx, jz)) || (city.inBuilding && city.inBuilding(jx, jz, 1.5)) || blocked(jx, jz)) continue;
        out.push(jx, jz, 7.5 + hash(jx, jz + 5) * 4.5);
      }
    }
  }
  palmCache.set(city, out);
  return out;
}

// Upright picture centred at (x, z), facing direction `rot`.
function sign(D, x, z, rot, w, y0, y1, r, color = 0xffffff, sh = 1) {
  const dx = Math.sin(rot) * w * 0.5, dz = -Math.cos(rot) * w * 0.5;
  D.wall(x - dx, z - dz, x + dx, z + dz, y0, y1, color, r.u0, r.v0, r.u1, r.v1, sh);
}

// The street templates are built once per city. Their random numbers
// come first from the props stream; later calls skip the same count so
// the rest of the stream (park flower beds) is unchanged.
const baseCache = new WeakMap();
function baseTemplates(city) {
  let base = baseCache.get(city);
  if (base) {
    const rng = createRng(city.seed + 4242);
    for (let i = 0; i < base.n; i++) rng.next();
    return { T: base.T, rng };
  }
  const src = createRng(city.seed + 4242);
  let n = 0;
  const next = () => { n++; return src.next(); };
  const rng = {
    next,
    range: (a, b) => a + (b - a) * next(),
    int: (a, b) => Math.floor(a + (b - a + 1) * next()),
    chance: (p) => next() < p,
    pick: (arr) => arr[Math.floor(next() * arr.length)],
    sign: () => (next() < 0.5 ? -1 : 1),
  };
  const T = makeTemplates(rng);
  baseCache.set(city, { T, n });
  return { T, rng };
}
function miamiTemplates(city, R) {
  let MT = templateCache.get(city);
  if (!MT) templateCache.set(city, (MT = makeMiamiTemplates(createRng(city.seed + 9191), R)));
  return MT;
}
const hash2 = (x, z) => {
  const v = Math.sin(x * 12.9898 + z * 78.233) * 43758.5453;
  return v - Math.floor(v);
};

// Stamps for the lot dressing (lotmesh.js): the same trees, palms, lamps
// and street furniture as the streets, into the builders of C (plain,
// detail, trees, treesDetail, ao, glow). v (0..1) picks a variant.
export function lotStamps(C) {
  const { city } = C;
  const { T } = baseTemplates(city);
  let MT = null;
  if (city.map === 'miami' && C.R && C.R.frond) {
    MT = lotTemplateCache.get(city);
    if (!MT) lotTemplateCache.set(city, (MT = makeLotTemplates(createRng(city.seed + 7373), C.R)));
  }
  const trees = C.trees || C.plain, treesDetail = C.treesDetail || C.detail;
  return {
    tree(x, z, y, h, v) {
      const k = v;
      const s = 0.95 + hash2(x + 3, z) * 0.25;
      if (MT) {
        const w = h * (0.95 + hash2(x, z + 1) * 0.25);
        const i = (k * MT.canopies.length) | 0;
        trees.at(x, z).add(MT.canopies[i], x, y - 0.04, z, k * TAU * 7, w, h, w, s, s, s);
        treesDetail.at(x, z).add(MT.foliage[i], x, y - 0.04, z, k * TAU * 7, w, h, w, s * 0.96, s, s * 0.92);
      } else {
        trees.at(x, z).add(T.trees[(k * T.trees.length) | 0], x, y - 0.04, z, k * TAU * 7, h, h, h, s, s, s);
      }
      C.ao.at(x, z).aoDisc(x, z, h * 0.36, y + 0.012, 0.55, 6);
    },
    palm(x, z, y, h, v) {
      const s = 0.85 + hash2(x + 3, z) * 0.3;
      if (MT) {
        const i = (v * MT.palmTrunks.length) | 0, w = h * (0.9 + hash2(z, x) * 0.2);
        trees.at(x, z).add(MT.palmTrunks[i], x, y - 0.04, z, v * TAU * 7, h, h, h, s, s, s);
        treesDetail.at(x, z).add(MT.palmCrowns[i], x, y - 0.04, z, v * TAU * 7, w, h, w, s, s * 1.02, s * 0.95);
      } else {
        trees.at(x, z).add(T.palms[(v * 3) | 0], x, y - 0.04, z, v * TAU * 7, h * 1.15, h, h * 1.15, s, s, s);
      }
      C.ao.at(x, z).aoDisc(x, z, h * 0.3, y + 0.012, 0.66, 6);
    },
    lamp(x, z, y, rot, h = 7) {
      trees.at(x, z).add(T.lamp, x, y - 0.02, z, rot, 1, h / 7, 1);
      // A small lit head (night): the glow layer.
      if (C.glow) C.glow.at(x, z).box(x + Math.cos(rot) * 1.74 - 0.25, z + Math.sin(rot) * 1.74 - 0.25, x + Math.cos(rot) * 1.74 + 0.25, z + Math.sin(rot) * 1.74 + 0.25, y + (6.6 * h) / 7, y + (6.66 * h) / 7, 0xfff2c4);
    },
    bench(x, z, y, rot) {
      C.plain.at(x, z).add(T.bench, x, y, z, rot);
      C.ao.at(x, z).aoDisc(x, z, 1.0, y + 0.012, 0.7, 6);
    },
    bin(x, z, y, rot, v) {
      C.plain.at(x, z).add(T.bin, x, y, z, rot, 1, 1, 1, v < 0.5 ? 1 : 1.6, v < 0.5 ? 1 : 1.2, 1);
    },
    // A plain post (the street bollard has twice the triangles; lots
    // have many more of them).
    bollard(x, z, y) {
      C.plain.at(x, z).cyl(x, z, y, y + 0.9, 0.11, 0.1, 5, 0x2a2c30, true, 0.7, 1, 0x4a4c50);
    },
    planter(x, z, y, rot, v) {
      const fl = v < 0.35;
      C.plain.at(x, z).add(T.planter, x, y, z, rot, 1, 1, 1, fl ? 1.5 : 1, fl ? 0.9 : 1, fl ? 1.3 : 1);
      C.ao.at(x, z).aoDisc(x, z, 1.15, y + 0.012, 0.68, 6);
    },
    umbrella(x, z, y, v) {
      const col = UMBRELLA[(v * UMBRELLA.length) | 0];
      const P = C.plain.at(x, z);
      P.cyl(x, z, y, y + 2.25, 0.03, 0.03, 4, 0xe8e4dc);
      P.cyl(x, z, y + 1.9, y + 2.35, 1.45, 0.04, 8, col, false, 0.8, 1.1);
      C.ao.at(x, z).aoDisc(x, z, 1.7, y + 0.012, 0.66, 8);
    },
  };
}

// own(x, z): emit geometry only for items it accepts (a streamed tile of
// the real map; null: everything). side: also add the collision circles
// (the real map does that once, for the whole map, with no geometry).
// lists: the items of one streamed tile ({ props, furniture, signals,
// palms }); null: the whole city.
export function addProps(C, own = null, side = true, lists = null) {
  const { city, collision } = C;
  const mine = (x, z) => !own || own(x, z);
  const { T, rng } = baseTemplates(city);
  const R = C.R;
  const miami = city.map === 'miami' && R && R.frond;
  const MT = miami ? miamiTemplates(city, R) : null;
  const L = city.landmarks || { cranes: [], billboards: [], runwayLights: [] };
  const hash = (x, z) => {
    const v = Math.sin(x * 12.9898 + z * 78.233) * 43758.5453;
    return v - Math.floor(v);
  };
  // A Miami street tree that is a palm: most of them in the palm
  // neighbourhoods and by the water, a few elsewhere.
  const streetPalm = (x, z) => {
    const k = hash(z + 7, x);
    const shore = city.mainShore ? city.mainShore(x, z) : 999;
    if (shore < 90) return k < 0.8;
    return k < (PALM_PLACES.has(city.placeOf(x, z)) ? 0.7 : 0.18);
  };
  // Keep trees off the landmarks.
  const blocked = (x, z) => {
    for (const c of L.cranes) if (Math.abs(x - c.x) < 11 && z > c.z - 18 && z < c.z + 42) return true;
    if (L.lighthouse && Math.hypot(x - L.lighthouse.x, z - L.lighthouse.z) < 8) return true;
    return false;
  };

  function tree(x, z, h, q, autumn) {
    const P = C.plain.at(x, z, q);
    const k = hash(x, z);
    if (MT) {
      const v = 0.86 + hash(x + 3, z) * 0.3;
      const gy = C.groundY(x, z);
      const w = h * (1.15 + hash(x, z + 1) * 0.3);
      const i = (k * MT.canopies.length) | 0;
      (C.trees || C.plain).at(x, z, q).add(MT.canopies[i], x, gy - 0.04, z, k * TAU, w, h, w, v, v, v);
      (C.treesDetail || C.detail).at(x, z, q).add(MT.foliage[i], x, gy - 0.04, z, k * TAU, w, h, w, v * 0.96, v, v * 0.92);
      C.ao.at(x, z).aoDisc(x, z, w * 0.32, gy + 0.012, 0.5, 8);
      return;
    }
    const conifer = hash(z, x) < 0.14;
    const t = conifer ? T.conifers[(k * 2) | 0] : T.trees[(k * T.trees.length) | 0];
    const v = 0.82 + hash(x + 3, z) * 0.36;
    const warm = autumn && hash(x, z + 9) < 0.12 ? 1.5 : 1;
    const gy = C.groundY(x, z);
    P.add(t, x, gy - 0.04, z, k * TAU, h, h * (0.9 + hash(x, z + 1) * 0.2), h, v * warm, v * (warm > 1 ? 1.05 : 1), v * (warm > 1 ? 0.55 : 1));
    C.ao.at(x, z).aoDisc(x, z, h * (conifer ? 0.2 : 0.3), gy + 0.012, 0.6, 6);
  }
  function palm(x, z, h, q) {
    const k = hash(x, z);
    const v = 0.85 + hash(x + 3, z) * 0.3;
    const gy = C.groundY(x, z);
    if (MT) {
      const i = (k * MT.palmTrunks.length) | 0, s = h * (0.9 + hash(z, x) * 0.2);
      (C.trees || C.plain).at(x, z, q).add(MT.palmTrunks[i], x, gy - 0.04, z, k * TAU, h, h, h, v, v, v);
      (C.treesDetail || C.detail).at(x, z, q).add(MT.palmCrowns[i], x, gy - 0.04, z, k * TAU, s, h, s, v, v * 1.02, v * 0.95);
      C.ao.at(x, z).aoDisc(x, z, h * 0.3, gy + 0.012, 0.66, 8);
      return;
    }
    C.plain.at(x, z, q).add(T.palms[(k * 3) | 0], x, gy - 0.04, z, k * TAU, h * 1.15, h, h * 1.15, v, v, v);
    C.ao.at(x, z).aoDisc(x, z, h * 0.22, gy + 0.012, 0.72, 6);
  }

  // ---- the original scattered trees, palms and lamps ----
  const lamps = [];
  for (const p of lists ? lists.props : city.props) {
    if (p.type === 'lamp') {
      lamps.push(p);
      if (mine(p.x, p.z)) C.plain.at(p.x, p.z).add(T.lamp, p.x, C.groundY(p.x, p.z) - 0.02, p.z, p.rot || 0, 1, (p.h || 7) / 7, 1);
      continue;
    }
    if (blocked(p.x, p.z)) continue;
    if (p.type === 'tree') {
      if (side) collision.addCircle(p.x, p.z, p.r, p.h, 'tree');
      if (mine(p.x, p.z)) tree(p.x, p.z, p.h, 0, true);
    } else if (p.type === 'palm') {
      if (side) collision.addCircle(p.x, p.z, 0.3, p.h, 'tree');
      if (mine(p.x, p.z)) palm(p.x, p.z, p.h, 0);
    }
  }

  // ---- Miami: palms down the avenues and along the seawalls ----
  if (MT) {
    const spots = lists ? lists.palms : miamiPalmSpots(city, lamps, hash, blocked);
    for (let i = 0; i < spots.length; i += 3) {
      const x = spots[i], z = spots[i + 1], h = spots[i + 2];
      if (side) collision.addCircle(x, z, 0.3, h, 'tree');
      if (mine(x, z)) palm(x, z, h, 0);
    }
  }

  // ---- street furniture ----
  for (const f of lists ? lists.furniture : city.furniture || []) {
    const { x, z, rot, q, v } = f;
    if (side && (f.type === 'streettree' || f.type === 'palmtree')) collision.addCircle(x, z, 0.22, f.type === 'palmtree' ? 6 : 5, 'tree');
    if (!mine(x, z)) continue;
    const P = C.plain.at(x, z, q), D = C.detail.at(x, z, q);
    const y = C.groundY(x, z);
    const ay = y + 0.012;
    switch (f.type) {
      case 'streettree':
        if (MT && streetPalm(x, z)) palm(x, z, 7 + v * 4, 0);
        else tree(x, z, 5 + v * 3, 0, false);
        // Tree pit: a square of bare earth in the pavement.
        if (y > 0) C.decal.at(x, z).flatRect(x - 0.7, z - 0.7, x + 0.7, z + 0.7, y + 0.015, 0x6a5a48, C.DR.stain1);
        break;
      case 'palmtree':
        palm(x, z, 6.5 + v * 3, 0);
        break;
      case 'bench':
        P.add(T.bench, x, y, z, rot);
        C.ao.at(x, z).aoDisc(x, z, 1.0, ay, 0.7, 6);
        break;
      case 'bin':
        P.add(T.bin, x, y, z, rot, 1, 1, 1, v < 0.5 ? 1 : 1.6, v < 0.5 ? 1 : 1.2, 1);
        break;
      case 'hydrant':
        P.add(T.hydrant, x, y, z, rot, 1, 1, 1, 1, v < 0.3 ? 2.6 : 1, 1);
        break;
      case 'mailbox':
        P.add(T.mailbox, x, y, z, rot);
        break;
      case 'meter':
        P.add(T.meter, x, y, z, rot);
        break;
      case 'planter': {
        const fl = v < 0.35;
        P.add(T.planter, x, y, z, rot, 1, 1, 1, fl ? 1.5 : 1, fl ? 0.9 : 1, fl ? 1.3 : 1);
        C.ao.at(x, z).aoDisc(x, z, 1.15, ay, 0.68, 6);
        break;
      }
      case 'barrier':
        P.add(T.barrier, x, y, z, rot + Math.PI / 2);
        break;
      case 'shelter':
        P.add(T.shelter, x, y, z, rot);
        C.ao.at(x, z).aoDisc(x, z, 2.2, ay, 0.66, 8);
        // Advert on the end panel and a stop flag on a post.
        sign(D, x + Math.sin(rot) * 1.72, z - Math.cos(rot) * 1.72, rot + Math.PI / 2, 1.2, y + 0.5, y + 2.2, R['poster' + ((v * 4) | 0)]);
        P.box(x - Math.sin(rot) * 2.3 - 0.04, z + Math.cos(rot) * 2.3 - 0.04, x - Math.sin(rot) * 2.3 + 0.04, z + Math.cos(rot) * 2.3 + 0.04, y, y + 2.7, 0x55585c);
        sign(D, x - Math.sin(rot) * 2.3 + Math.cos(rot) * 0.05, z + Math.cos(rot) * 2.3 + Math.sin(rot) * 0.05, rot, 0.5, y + 2.15, y + 2.65, R.busstop);
        break;
      case 'bikes': {
        P.add(T.rack, x, y, z, rot);
        const n = 1 + ((v * 3) | 0);
        for (let i = 0; i < n; i++) {
          const o = -0.85 + i * 0.75 + (v - 0.5) * 0.2;
          const bx = x - Math.sin(rot) * o, bz = z + Math.cos(rot) * o;
          sign(D, bx, bz, rot + Math.PI / 2 + (i - 1) * 0.12, 1.75, y, y + 0.98, R.bike, BIKE[(i + ((v * 17) | 0)) % BIKE.length]);
        }
        break;
      }
      case 'stopsign': {
        P.box(x - 0.035, z - 0.035, x + 0.035, z + 0.035, y, y + 2.65, 0x8a9096);
        const ox = Math.cos(rot) * 0.045, oz = Math.sin(rot) * 0.045;
        sign(D, x + ox, z + oz, rot, 0.76, y + 1.95, y + 2.71, R.stop);
        sign(D, x - ox * 0.6, z - oz * 0.6, rot + Math.PI, 0.7, y + 1.98, y + 2.68, R.white, 0x8a9096);
        break;
      }
      case 'namesign': {
        P.box(x - 0.04, z - 0.04, x + 0.04, z + 0.04, y, y + 3.4, 0x6a7076);
        // The plate for the north-south road runs north-south, and so on.
        sign(D, x + 0.05, z, 0, 1.0, y + 3.1, y + 3.35, R['plate' + f.nx]);
        sign(D, x - 0.05, z, Math.PI, 1.0, y + 3.1, y + 3.35, R['plate' + f.nx]);
        sign(D, x, z + 0.05, Math.PI / 2, 1.0, y + 2.8, y + 3.05, R['plate' + (16 + f.nz)]);
        sign(D, x, z - 0.05, -Math.PI / 2, 1.0, y + 2.8, y + 3.05, R['plate' + (16 + f.nz)]);
        break;
      }
      case 'streetsign': {
        // A real-map corner sign: one plate along each road (f.ra, f.rb
        // its directions), names f.a and f.b from the plate atlas.
        P.box(x - 0.045, z - 0.045, x + 0.045, z + 0.045, y, y + 3.4, 0x6a7076);
        const plates = [[f.a, f.ra, y + 3.1], [f.b, f.rb, y + 2.78]];
        for (const [k, r, py] of plates) {
          const fx = -Math.sin(r) * 0.05, fz = Math.cos(r) * 0.05;
          sign(D, x + fx, z + fz, r + Math.PI / 2, 1.05, py, py + 0.26, R['plate' + k]);
          sign(D, x - fx, z - fz, r - Math.PI / 2, 1.05, py, py + 0.26, R['plate' + k]);
        }
        break;
      }
      case 'umbrella': {
        const col = UMBRELLA[(v * UMBRELLA.length) | 0];
        const yy = -0.1;
        P.cyl(x, z, yy, yy + 2.15, 0.03, 0.03, 4, 0xe8e4dc);
        P.cyl(x, z, yy + 1.8, yy + 2.25, 1.45, 0.04, 8, col, false, 0.8, 1.1);
        for (const s of [-1, 1]) {
          const lx = x + Math.cos(rot) * 0.2 - Math.sin(rot) * s * 0.75, lz = z + Math.sin(rot) * 0.2 + Math.cos(rot) * s * 0.75;
          P.obox(lx, lz, 0.95, 0.3, yy + 0.05, yy + 0.32, rot, 0xf4f0e6, s > 0 ? col : 0xf4f0e6, 0.7, 1);
        }
        C.ao.at(x, z).aoDisc(x, z, 1.7, -0.1, 0.66, 8);
        break;
      }
      default:
    }
  }

  // ---- traffic lights: poles here, the lamps as one instanced mesh ----
  const bulbs = [];
  for (const s of lists ? lists.signals : city.signals || []) {
    if (!mine(s.x, s.z)) continue;
    const P = C.plain.at(s.x, s.z);
    const y = C.groundY(s.x, s.z);
    P.cyl(s.x, s.z, y, y + 0.8, 0.16, 0.12, 6, 0x2c3034, false, 0.6, 1);
    P.cyl(s.x, s.z, y + 0.8, y + 5.7, 0.09, 0.07, 5, 0x3a3e42);
    const ax = Math.cos(s.armDir), az = Math.sin(s.armDir);
    P.obox(s.x + ax * s.armLen * 0.5, s.z + az * s.armLen * 0.5, s.armLen * 0.5, 0.05, y + 5.4, y + 5.52, s.armDir, 0x3a3e42);
    const fx = Math.cos(s.face), fz = Math.sin(s.face);
    const heads = [
      [s.x + fx * 0.2, s.z + fz * 0.2, y + 3.05],
      [s.x + ax * s.armLen, s.z + az * s.armLen, y + 4.86],
    ];
    for (const [hx, hz, hy] of heads) {
      P.obox(hx, hz, 0.13, 0.18, hy - 0.52, hy + 0.52, s.face, 0x1c1e20, 0x1c1e20);
      P.obox(hx - fx * 0.02, hz - fz * 0.02, 0.02, 0.27, hy - 0.62, hy + 0.62, s.face, 0xd8b030, 0xd8b030);
      for (let k = 0; k < 3; k++) {
        bulbs.push({ x: hx + fx * 0.14, y: hy + 0.33 - k * 0.33, z: hz + fz * 0.14, face: s.face, node: s.node, horizontal: s.horizontal, lamp: k });
      }
    }
  }

  // The rest is drawn once per call set: a streamed tile that hands its
  // items over in pieces passes extras: false for all but one piece.
  if (lists && lists.extras === false) return { lamps, bulbs, palms: [] };

  // ---- parks: a fountain and benches where the paths cross ----
  for (const b of city.blocks) {
    if (b.district !== 'park') continue;
    const cx = (b.x0 + b.x1) / 2, cz = (b.z0 + b.z1) / 2;
    if (!mine(cx, cz)) {
      // Not drawn here: the flower beds' random numbers are still used up,
      // so every park gets the same beds whichever tile draws it.
      for (let i = 0; i < 6; i++) {
        const fx = rng.range(b.x0 + 8, b.x1 - 8), fz = rng.range(b.z0 + 8, b.z1 - 8);
        if (Math.abs(fx - cx) < 6 || Math.abs(fz - cz) < 6) continue;
        rng.pick(FLOWERS);
        rng.range(1, 2);
        rng.range(1, 2);
      }
      continue;
    }
    const P = C.plain.at(cx, cz);
    P.cyl(cx, cz, 0.16, 0.62, 3.3, 3.3, 12, 0xb4b0a6, false, 0.6, 1);
    P.cyl(cx, cz, 0.16, 0.5, 3.0, 3.0, 12, 0x3f8fae, true, 1, 1, 0x4fa6c4);
    P.cyl(cx, cz, 0.5, 0.62, 3.0, 3.3, 12, 0xc4c0b6);
    P.cyl(cx, cz, 0.16, 1.5, 0.45, 0.3, 8, 0xb4b0a6, true, 0.7, 1);
    P.cyl(cx, cz, 1.5, 1.62, 0.9, 1.0, 8, 0xc4c0b6, true);
    C.ao.at(cx, cz).aoDisc(cx, cz, 4.6, 0.172, 0.6, 12);
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * TAU + Math.PI / 4;
      const bx = cx + Math.cos(a) * 5.6, bz = cz + Math.sin(a) * 5.6;
      C.plain.at(bx, bz, i % 2).add(T.bench, bx, 0.16, bz, a + Math.PI);
    }
    // Flower beds.
    for (let i = 0; i < 6; i++) {
      const fx = rng.range(b.x0 + 8, b.x1 - 8), fz = rng.range(b.z0 + 8, b.z1 - 8);
      if (Math.abs(fx - cx) < 6 || Math.abs(fz - cz) < 6) continue;
      const col = rng.pick(FLOWERS);
      C.plain.at(fx, fz, 1).blob(fx, 0.2, fz, rng.range(1, 2), 0.3, rng.range(1, 2), col, 6, 3, 0.7, 1.1);
    }
  }

  // ---- piers: mooring bollards ----
  for (const r of city.piers || []) {
    if (!mine((r.x0 + r.x1) / 2, (r.z0 + r.z1) / 2)) continue;
    const alongX = r.x1 - r.x0 > r.z1 - r.z0;
    const len = alongX ? r.x1 - r.x0 : r.z1 - r.z0;
    for (let d = 6; d < len; d += 8) {
      for (const side of [0, 1]) {
        const bx = alongX ? r.x0 + d : side ? r.x1 - 0.45 : r.x0 + 0.45;
        const bz = alongX ? (side ? r.z1 - 0.45 : r.z0 + 0.45) : r.z0 + d;
        C.plain.at(bx, bz).add(T.bollard, bx, 0.1, bz, 0);
      }
    }
  }

  // ---- dock cranes ----
  for (const c of L.cranes) {
    if (side) for (const ox of [-7, 7]) for (const oz of [-6, 6]) collision.addCircle(c.x + ox, c.z + oz, 0.9, 27, 'crane');
    if (!mine(c.x, c.z)) continue;
    const P = C.plain.at(c.x, c.z);
    const col = c.v < 0.5 ? 0xc8502c : 0xd8a030, dark = hexShade(col, 0.7);
    const H = 27;
    for (const ox of [-7, 7]) {
      for (const oz of [-6, 6]) {
        P.box(c.x + ox - 0.6, c.z + oz - 0.6, c.x + ox + 0.6, c.z + oz + 0.6, -0.3, H, col, col, 0.6, 1);
        C.ao.at(c.x, c.z).aoDisc(c.x + ox, c.z + oz, 2.2, C.groundY(c.x + ox, c.z + oz) + 0.012, 0.6, 6);
      }
      P.box(c.x + ox - 0.4, c.z - 6, c.x + ox + 0.4, c.z + 6, 11.5, 12.5, dark);
      P.box(c.x + ox - 0.5, c.z - 6.6, c.x + ox + 0.5, c.z + 6.6, H - 1.2, H, dark);
    }
    for (const oz of [-6, 6]) P.box(c.x - 7, c.z + oz - 0.4, c.x + 7, c.z + oz + 0.4, H - 1.2, H, dark);
    // Boom out over the water, machinery house, A-frame and cab.
    P.box(c.x - 1.1, c.z - 16, c.x + 1.1, c.z + 40, H, H + 2.2, col, dark, 0.8, 1);
    P.box(c.x - 3.5, c.z - 13, c.x + 3.5, c.z - 5, H + 2.2, H + 6, 0xd8d4c8, 0x9a968c, 0.8, 1);
    P.box(c.x - 0.7, c.z - 0.7, c.x + 0.7, c.z + 0.7, H + 2.2, H + 12, col);
    P.box(c.x - 1.4, c.z + 14, c.x + 1.4, c.z + 17.5, H - 3.2, H, 0xe8e4d8, 0x8a8880, 0.8, 1);
    P.box(c.x - 0.12, c.z + 30, c.x + 0.12, c.z + 30.24, H - 12, H, 0x2a2c30);
    P.box(c.x - 1.3, c.z + 28.9, c.x + 1.3, c.z + 31.3, H - 12.6, H - 12, 0x8a2c22);
    if (side) C.glows.push({ x: c.x, y: H + 12.3, z: c.z, r: 1, g: 0.12, b: 0.08, size: 2.6 });
  }

  // ---- lighthouse ----
  if (L.lighthouse && side) {
    const { x, z } = L.lighthouse;
    C.glows.push({ x, y: 24 + 1.9, z, r: 1, g: 0.92, b: 0.7, size: 7 });
    collision.addCircle(x, z, 3.7, 24 + 5, 'lighthouse');
  }
  if (L.lighthouse && mine(L.lighthouse.x, L.lighthouse.z)) {
    const { x, z } = L.lighthouse;
    const P = C.plain.at(x, z);
    P.cyl(x, z, -0.2, 1.2, 4.6, 4.4, 12, 0x9a968c, true, 0.6, 1);
    const bands = 5, H = 24;
    for (let i = 0; i < bands; i++) {
      const k0 = i / bands, k1 = (i + 1) / bands;
      P.cyl(x, z, 1.2 + k0 * (H - 1.2), 1.2 + k1 * (H - 1.2), 3.4 - k0 * 1.3, 3.4 - k1 * 1.3, 12, i % 2 ? 0xc03a2e : 0xf2efe6, false, i === 0 ? 0.7 : 1, 1);
    }
    P.cyl(x, z, H, H + 0.4, 3.0, 3.0, 12, 0x33363a, true);
    P.cyl(x, z, H + 0.4, H + 1.4, 2.9, 2.9, 12, 0x33363a);
    P.cyl(x, z, H + 0.4, H + 3.2, 1.7, 1.7, 10, 0xa8c4d0);
    P.cyl(x, z, H + 3.2, H + 5.4, 2.0, 0.1, 10, 0xc03a2e);
    C.glow.at(x, z).cyl(x, z, H + 0.9, H + 2.8, 0.7, 0.7, 6, 0xfff0c0);
    C.ao.at(x, z).aoDisc(x, z, 7.5, C.groundY(x, z) + 0.012, 0.55, 12);
  }

  // ---- airfield: runway edge lights and the windsock pole ----
  for (const l of L.runwayLights) {
    if (mine(l.x, l.z)) C.glow.at(l.x, l.z).box(l.x - 0.14, l.z - 0.14, l.x + 0.14, l.z + 0.14, 0.02, 0.3, l.color);
    if (side) C.glows.push({ x: l.x, y: 0.4, z: l.z, r: ((l.color >> 16) & 255) / 255, g: ((l.color >> 8) & 255) / 255, b: (l.color & 255) / 255, size: 1.5 });
  }
  if (L.windsock && mine(L.windsock.x, L.windsock.z)) {
    const { x, z } = L.windsock;
    C.plain.at(x, z).cyl(x, z, -0.1, 6.2, 0.09, 0.06, 5, 0xe8e4dc);
  }

  return { lamps, bulbs, palms: MT ? miamiPalmSpots(city, lamps, hash, blocked) : [] };
}
