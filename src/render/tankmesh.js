// Rustback tank mesh (original design): faceted hull with a long sloped
// glacis, sponsons, segmented side skirts, engine deck grilles, tools and
// stowage; tracks with road wheels, drive sprocket, idler and return
// rollers that turn with the track, and a link pattern that scrolls (a
// shader offset on a baked distance along the loop); a faceted turret
// with mantlet, a barrel with fume extractor, thermal sleeve bands and a
// muzzle brake, commander cupola with an MG, smoke dischargers, bustle
// basket. One camo skin per tank (hullkit.js), 3 draw calls near: hull
// (with tracks), turret, gun. Far away the hull drops to a coarse LOD.
// Origin at the ground centre, nose along local +x, up +y (docs/CRAFT.md).
// Hierarchy: group (position, yaw, sway) -> hull, turret (yaw) -> gun
// (pitch) -> barrel (recoil).
import * as THREE from 'three';
import { angleDiff } from '../core/rng.js';
import { Kit, RIG, CLS, shade, createSkin, skinLook, buildKit } from './hullkit.js';

const TRACK = 0x34322f;
const RUBBER = 0x1c1c1c;
const METAL = 0x50555c;
const DARK = 0x24272b;
const LAMP = 0xf3ecd2;
const WHITE = 0xeef0f0;
const OLIVE = 0x5a5a3e;
const L = CLS.LIVERY, T = CLS.TRIM, G = CLS.GLASS, R = CLS.RUBBER, A = CLS.ALLOY, GL = CLS.GLOW;
const LOD_FAR = 130;

// ---- tracks ---------------------------------------------------------------------
const IDLER = [3.3, 0.72, 0.34], SPROCKET = [-3.3, 0.74, 0.38];
const WHEELS_X = [-2.55, -1.55, -0.55, 0.45, 1.45, 2.45];
const WHEEL_Y = 0.46, WHEEL_R = 0.36;
const ROLLERS_X = [-1.8, 0.2, 2.0];
const TW = 0.62, TT = 0.08;

// Inner surface of the loop, clockwise seen from +z: top run forward,
// round the idler, bottom run back under the wheels, round the sprocket.
function trackPath(q) {
  const pts = [];
  const top = [[SPROCKET[0], SPROCKET[1] + SPROCKET[2]], [-2.0, 1.07], [-0.4, 1.06], [1.4, 1.06], [2.6, 1.07]];
  for (const p of top) pts.push(p);
  const n = Math.max(4, Math.round(9 * q));
  for (let i = 0; i <= n; i++) {
    const a = Math.PI / 2 - (i / n) * Math.PI;
    pts.push([IDLER[0] + Math.cos(a) * IDLER[2], IDLER[1] + Math.sin(a) * IDLER[2]]);
  }
  pts.push([2.75, WHEEL_Y - WHEEL_R], [-2.75, WHEEL_Y - WHEEL_R]);
  for (let i = 0; i < n; i++) {
    const a = -Math.PI / 2 - (i / n) * Math.PI;
    pts.push([SPROCKET[0] + Math.cos(a) * SPROCKET[2], SPROCKET[1] + Math.sin(a) * SPROCKET[2]]);
  }
  return pts;
}

function band(k, zc, side) {
  const path = trackPath(k.q);
  const n = path.length;
  const dist = [0];
  for (let i = 1; i <= n; i++) {
    const a = path[i - 1], b = path[i % n];
    dist.push(dist[i - 1] + Math.hypot(b[0] - a[0], b[1] - a[1]));
  }
  const nrm = path.map((p, i) => {
    const a = path[(i + n - 1) % n], b = path[(i + 1) % n];
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const l = Math.hypot(dx, dy) || 1;
    return [-dy / l, dx / l];
  });
  const col = [0, 0, 0];
  new THREE.Color(TRACK).toArray(col);
  const code = side < 0 ? RIG.TRACK_L : RIG.TRACK_R;
  k.setRig(code);
  const z0 = zc - TW / 2, z1 = zc + TW / 2;
  const quad = (A, B, C, D, nn, s0, s1) => {
    const a = k.vertTrack(A[0], A[1], A[2], nn[0], nn[1], nn[2], col, R, s0);
    const b = k.vertTrack(B[0], B[1], B[2], nn[0], nn[1], nn[2], col, R, s1);
    const c = k.vertTrack(C[0], C[1], C[2], nn[0], nn[1], nn[2], col, R, s1);
    const d = k.vertTrack(D[0], D[1], D[2], nn[0], nn[1], nn[2], col, R, s0);
    k.i.push(a, b, c, a, c, d);
  };
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const a = path[i], b = path[j], na = nrm[i], nb = nrm[j];
    const ao = [a[0] + na[0] * TT, a[1] + na[1] * TT], bo = [b[0] + nb[0] * TT, b[1] + nb[1] * TT];
    const nm = [(na[0] + nb[0]) / 2, (na[1] + nb[1]) / 2, 0];
    const s0 = dist[i], s1 = dist[i + 1];
    // Outer (ground) face, inner face, then the two edges.
    quad([ao[0], ao[1], z1], [bo[0], bo[1], z1], [bo[0], bo[1], z0], [ao[0], ao[1], z0], nm, s0, s1);
    quad([a[0], a[1], z0], [b[0], b[1], z0], [b[0], b[1], z1], [a[0], a[1], z1], [-nm[0], -nm[1], 0], s0, s1);
    quad([a[0], a[1], z1], [b[0], b[1], z1], [bo[0], bo[1], z1], [ao[0], ao[1], z1], [0, 0, 1], s0, s1);
    quad([ao[0], ao[1], z0], [bo[0], bo[1], z0], [b[0], b[1], z0], [a[0], a[1], z0], [0, 0, -1], s0, s1);
  }
  k.noRig();
}

// A wheel turning with the track: code per side, gain 1 / r.
function roadWheel(k, x, y, zc, r, w, side, hex, teeth = 0) {
  const code = side < 0 ? RIG.WHEEL_L : RIG.WHEEL_R;
  k.setRig(code, [x, y, zc], [0, 0, -1 / r]);
  const half = (z0, dir) => {
    k.lathe([
      { pts: [[0, 0], [0, r * 0.3]], hex: METAL, cls: A },
      { pts: [[0, r * 0.3], [0.03, r * 0.42], [0.05, r * 0.82]], hex, cls: L },
      { pts: [[0.05, r * 0.82], [0.05, r * 0.92], [0.09, r], [w * 0.5, r], [w * 0.5, r * 0.82]], hex: RUBBER, cls: R },
    ], r < 0.15 ? 7 : 12, [x, y, z0], [0, 0, dir]);
  };
  half(zc - w, 1);
  half(zc + w, -1);
  if (teeth) {
    for (let t = 0; t < teeth; t++) {
      const a = (t / teeth) * Math.PI * 2;
      const c = Math.cos(a), s = Math.sin(a);
      const tc = (rr, dz) => [x + c * rr, y + s * rr, zc + dz];
      const pc = (rr, dz) => [x + c * rr - s * 0.05, y + s * rr + c * 0.05, zc + dz];
      k.hexa([tc(r * 0.9, -0.12), pc(r * 0.9, -0.12), pc(r * 0.9, 0.12), tc(r * 0.9, 0.12),
        tc(r * 1.12, -0.1), pc(r * 1.08, -0.1), pc(r * 1.08, 0.1), tc(r * 1.12, 0.1)], METAL, A);
    }
  }
  k.noRig();
}

function buildTracks(k, col) {
  const wheelHex = shade(col, 0.85);
  for (const s of [-1, 1]) {
    const zc = s * 1.42;
    band(k, zc, s);
    for (const x of WHEELS_X) roadWheel(k, x, WHEEL_Y, zc, WHEEL_R, 0.3, s, wheelHex);
    roadWheel(k, SPROCKET[0], SPROCKET[1], zc, SPROCKET[2] - 0.02, 0.26, s, METAL, k.q > 0.8 ? 11 : 0);
    roadWheel(k, IDLER[0], IDLER[1], zc, IDLER[2] - 0.03, 0.28, s, wheelHex);
    if (k.q > 0.8) for (const x of ROLLERS_X) roadWheel(k, x, 0.98, zc, 0.08, 0.18, s, METAL);
  }
}

// ---- hull -------------------------------------------------------------------------
function buildHull(k, spec, col, police) {
  const lower = shade(col, 0.78);
  // Belly between the tracks, lower front plate.
  k.prism([[-3.45, 0.5], [2.9, 0.42], [3.5, 0.92], [3.5, 1.02], [-3.5, 1.02]], -1.08, 1.08, lower, L);
  // Upper hull over the sponsons: long glacis, slightly rising deck.
  k.prism([[-3.58, 1.0], [3.55, 1.0], [3.62, 1.08], [1.7, 1.56], [-3.3, 1.63], [-3.6, 1.42]], -1.74, 1.74, col, L);
  // Fenders over the track ends.
  for (const s of [-1, 1]) {
    k.hexa([[3.55, 1.06, 1.1 * s], [3.95, 0.98, 1.1 * s], [3.95, 0.98, 1.78 * s], [3.55, 1.06, 1.78 * s],
      [3.55, 1.1, 1.1 * s], [3.95, 1.02, 1.1 * s], [3.95, 1.02, 1.78 * s], [3.55, 1.1, 1.78 * s]], col, L);
    k.box(-3.75, 1.02, 1.42 * s, 0.4, 0.04, 0.7, col, L);
    // Side skirts: five plates with a gap, the front one tilted.
    for (let p = 0; p < 5; p++) {
      const x0 = -3.25 + p * 1.28, x1 = x0 + 1.24;
      const f = p === 4;
      k.hexa([[x0, 0.7, 1.77 * s], [f ? x1 + 0.25 : x1, f ? 0.86 : 0.7, 1.77 * s], [f ? x1 + 0.25 : x1, f ? 0.86 : 0.7, 1.83 * s], [x0, 0.7, 1.83 * s],
        [x0, 1.13, 1.77 * s], [x1 + (f ? 0.3 : 0), 1.13, 1.77 * s], [x1 + (f ? 0.3 : 0), 1.13, 1.83 * s], [x0, 1.13, 1.83 * s]], shade(col, 0.95), L);
      if (k.q > 0.8) for (let b = 0; b < 3; b++) k.box(x0 + 0.2 + b * 0.42, 1.07, 1.835 * s, 0.04, 0.04, 0.02, shade(col, 0.7), L);
    }
    if (police) k.box(-0.2, 0.9, 1.84 * s, 5.6, 0.16, 0.02, WHITE, L);
    // Headlights with guards on the glacis corners.
    k.lathe([{ pts: [[0, 0], [0, 0.1]], hex: LAMP, cls: GL }, { pts: [[0, 0.1], [-0.12, 0.11], [-0.12, 0]], hex: DARK, cls: T }], 10, [3.45, 1.2, 1.3 * s], [1, -0.2, 0]);
    if (k.q > 0.8) {
      k.sweep([[3.3, 1.18, 1.14 * s], [3.56, 1.25, 1.14 * s], [3.56, 1.25, 1.46 * s], [3.3, 1.18, 1.46 * s]], 0.015, DARK, T, 4, false);
      // Tow hooks, tools on the side deck, rear stowage boxes.
      k.box(3.62, 0.85, 0.75 * s, 0.14, 0.12, 0.08, DARK, T);
      k.box(-0.6, 1.62, 1.5 * s, 1.5, 0.05, 0.12, 0x6a4a2a, T);
      k.box(-1.55, 1.62, 1.5 * s, 0.4, 0.04, 0.2, METAL, A);
      k.tube([0.6, 1.63, 1.5 * s], [2.0, 1.6, 1.5 * s], 0.025, 0.025, METAL, A, 5);
      k.box(-2.8, 1.75, 1.35 * s, 0.8, 0.26, 0.5, shade(col, 0.88), L);
      k.box(-3.62, 1.2, 1.25 * s, 0.05, 0.1, 0.18, 0xb01010, GL);
    }
  }
  // Glacis: driver hatch and periscopes, spare track links.
  k.lathe([{ pts: [[0, 0.32], [0.05, 0.3], [0.06, 0]], hex: shade(col, 0.9), cls: L }], 12, [2.05, 1.5, 0], [0.26, 0.97, 0]);
  for (const dz of [-0.2, 0, 0.2]) k.box(2.38, 1.46, dz, 0.08, 0.06, 0.12, 0x6f8c9a, G);
  if (k.q > 0.8) for (let i = 0; i < 5; i++) k.box(3.1 - i * 0.02, 1.15 + i * 0.0, -0.55 + i * 0.26, 0.4, 0.06, 0.22, TRACK, R);
  // Engine deck: grille slats, exhaust louvres, tow cable.
  for (let i = 0; i < (k.q > 0.8 ? 9 : 3); i++) k.box(-2.0 - i * 0.14, 1.64, 0, 0.05, 0.03, 1.7, DARK, T);
  k.box(-3.62, 1.32, 0, 0.06, 0.18, 1.8, DARK, T);
  if (k.q > 0.8) {
    k.sweep([[-3.0, 1.66, -0.9], [-3.2, 1.67, -0.2], [-3.2, 1.67, 0.4], [-3.0, 1.66, 0.9], [-2.2, 1.66, 0.9]], 0.03, 0x2a2a28, A, 5, false);
    k.rbox(-3.68, 1.12, -0.4, 0.12, 0.3, 0.2, OLIVE, L, 0.3, 4);
    k.rbox(-3.68, 1.12, -0.65, 0.12, 0.3, 0.2, OLIVE, L, 0.3, 4);
  }
}

// ---- turret and gun (turret frame: origin on the ring at the deck) ----------------
function buildTurret(k, col, police) {
  const bot = [[1.6, -0.5], [1.6, 0.5], [0.9, 1.22], [-1.2, 1.3], [-2.25, 1.08], [-2.25, -1.08], [-1.2, -1.3], [0.9, -1.22]];
  const mid = [[1.3, -0.45], [1.3, 0.45], [0.8, 1.12], [-1.2, 1.2], [-2.15, 1.0], [-2.15, -1.0], [-1.2, -1.2], [0.8, -1.12]];
  const topP = [[1.05, -0.4], [1.05, 0.4], [0.65, 1.0], [-1.15, 1.08], [-2.05, 0.92], [-2.05, -0.92], [-1.15, -1.08], [0.65, -1.0]];
  k.slab(bot, mid, 0.02, 0.56, col, L, { bottom: false });
  k.slab(mid, topP, 0.56, 0.72, shade(col, 0.95), L, { bottom: false });
  k.lathe([{ pts: [[0, 1.25], [0.12, 1.25]], hex: shade(col, 0.6), cls: L }], 20, [-0.35, 0.0, 0], [0, 1, 0]);
  // Commander cupola with vision blocks, hatch and a pintle MG.
  const cx = -0.65, cz = -0.58, cy = 0.72;
  k.lathe([{ pts: [[0, 0.36], [0.16, 0.34], [0.2, 0.3]], hex: shade(col, 0.9), cls: L }, { pts: [[0.2, 0.3], [0.2, 0]], hex: shade(col, 0.85), cls: L }], 14, [cx, cy, cz], [0, 1, 0]);
  for (let i = 0; i < (k.q > 0.8 ? 6 : 0); i++) {
    const a = (i / 6) * Math.PI * 2 + 0.3;
    k.box(cx + Math.cos(a) * 0.33, cy + 0.08, cz + Math.sin(a) * 0.33, 0.06, 0.06, 0.1, 0x6f8c9a, G);
  }
  k.lathe([{ pts: [[0, 0.28], [0.04, 0.27], [0.06, 0]], hex: shade(col, 0.92), cls: L }], 12, [cx - 0.05, cy + 0.2, cz], [0, 1, 0]);
  k.tube([cx + 0.25, cy + 0.2, cz], [cx + 0.25, cy + 0.42, cz], 0.025, 0.025, DARK, T, 5);
  k.box(cx + 0.3, cy + 0.47, cz, 0.36, 0.1, 0.09, DARK, T);
  k.tube([cx + 0.48, cy + 0.47, cz], [cx + 1.25, cy + 0.47, cz], 0.022, 0.018, DARK, A, 6);
  k.box(cx + 0.28, cy + 0.42, cz + 0.1, 0.16, 0.12, 0.1, OLIVE, L);
  // Loader hatch, gunner sight, smoke dischargers, antennas.
  k.lathe([{ pts: [[0, 0.3], [0.04, 0.29], [0.05, 0]], hex: shade(col, 0.92), cls: L }], 12, [-0.6, cy, 0.55], [0, 1, 0]);
  k.box(0.55, cy + 0.12, -0.75, 0.5, 0.26, 0.3, shade(col, 0.9), L);
  k.box(0.81, cy + 0.14, -0.75, 0.02, 0.14, 0.22, 0x26323a, G);
  for (const s of [-1, 1]) {
    for (let i = 0; i < 4; i++) {
      const bx = 0.95 - i * 0.16, bz = (1.12 + i * 0.03) * s;
      k.tube([bx, 0.42, bz], [bx + 0.22, 0.6, bz + 0.1 * s], 0.05, 0.05, shade(col, 0.7), L, 7);
    }
    k.tube([-1.95, 0.72, 0.85 * s], [-1.95, 2.6, 0.85 * s], 0.012, 0.006, DARK, T, 4, false);
  }
  // Bustle basket with a rolled tarp and boxes.
  k.sweep([[-2.2, 0.62, 1.0], [-2.85, 0.62, 0.95], [-2.85, 0.62, -0.95], [-2.2, 0.62, -1.0]], 0.025, DARK, A, 5, false);
  k.sweep([[-2.2, 0.3, 1.0], [-2.85, 0.3, 0.95], [-2.85, 0.3, -0.95], [-2.2, 0.3, -1.0]], 0.025, DARK, A, 5, false);
  if (k.q > 0.8) {
    for (const z of [-0.9, 0, 0.9]) k.tube([-2.85, 0.28, z], [-2.85, 0.64, z], 0.02, 0.02, DARK, A, 4, false);
    k.lathe([{ pts: [[-0.85, 0], [-0.85, 0.16], [0.85, 0.16], [0.85, 0]], hex: OLIVE, cls: R }], 10, [-2.55, 0.55, 0], [0, 0, 1]);
    k.rbox(-2.5, 0.42, 0.55, 0.5, 0.3, 0.4, shade(OLIVE, 1.2), L, 0.2, 4);
    k.rbox(-2.5, 0.42, -0.5, 0.5, 0.3, 0.5, 0x4a4a3a, L, 0.2, 4);
  }
  if (police) {
    for (const s of [-1, 1]) k.box(-0.3, 0.32, 1.27 * s, 2.0, 0.14, 0.04, WHITE, L);
    k.box(-1.5, 0.8, 0, 0.3, 0.14, 0.5, 0x2a6bff, GL);
  }
}

function buildGun(k, spec, col) {
  const len = spec.barrelLen;
  // Mantlet, collar, tube, fume extractor, thermal sleeve bands, brake.
  k.hexa([[1.2, -0.3, -0.42], [1.85, -0.24, -0.34], [1.85, -0.24, 0.34], [1.2, -0.3, 0.42],
    [1.2, 0.3, -0.42], [1.85, 0.24, -0.34], [1.85, 0.24, 0.34], [1.2, 0.3, 0.42]], shade(col, 0.9), L);
  const runs = [
    { pts: [[0, 0.17], [0.22, 0.17], [0.3, 0.1]], hex: shade(col, 0.85), cls: L },
    { pts: [[0.3, 0.095], [0.95, 0.092]], hex: shade(col, 0.95), cls: L },
    { pts: [[0.95, 0.092], [1.05, 0.15], [1.5, 0.15], [1.6, 0.09]], hex: shade(col, 0.9), cls: L },
    { pts: [[1.6, 0.088], [2.4, 0.084]], hex: shade(col, 0.95), cls: L },
  ];
  k.lathe(runs, 12, [1.85, 0, 0], [1, 0, 0]);
  const xb = len - 0.38;
  k.lathe([{ pts: [[0, 0.082], [xb - 4.25, 0.08]], hex: shade(col, 0.95), cls: L }], 12, [4.25, 0, 0], [1, 0, 0]);
  if (k.q > 0.8) for (const bx of [2.6, 3.0, 3.75]) k.tube([bx, 0, 0], [bx + 0.06, 0, 0], 0.1, 0.1, shade(col, 0.75), L, 12, true);
  k.lathe([
    { pts: [[0, 0.08], [0, 0.13]], hex: DARK, cls: T },
    { pts: [[0, 0.13], [0.38, 0.13]], hex: DARK, cls: A },
    { pts: [[0.38, 0.13], [0.38, 0.06]], hex: DARK, cls: A },
    { pts: [[0.38, 0.06], [0.2, 0.06]], hex: 0x050505, cls: T },
  ], 12, [xb, 0, 0], [1, 0, 0]);
  for (const s of [-1, 1]) k.box(xb + 0.19, 0, 0.125 * s, 0.22, 0.12, 0.02, 0x050505, T);
  // Coax MG beside the mantlet.
  k.tube([1.85, 0.08, 0.32], [2.15, 0.08, 0.32], 0.03, 0.03, DARK, A, 6);
}

// ---- geometry cache ---------------------------------------------------------------
const cache = new Map();
function entry(spec, col) {
  const key = spec.id + ':' + col;
  let e = cache.get(key);
  if (e) return e;
  const police = !!spec.police;
  const kh = new Kit(1), kf = new Kit(0.45), kt = new Kit(1), kg = new Kit(1);
  buildHull(kh, spec, col, police);
  buildTracks(kh, col);
  buildHull(kf, spec, col, police);
  buildTracks(kf, col);
  buildTurret(kt, col, police);
  buildGun(kg, spec, col);
  e = { hull: buildKit(kh), far: buildKit(kf), turret: buildKit(kt), gun: buildKit(kg) };
  e.tris = (kh.i.length + kt.i.length + kg.i.length) / 3;
  e.farTris = (kf.i.length + kt.i.length + kg.i.length) / 3;
  cache.set(key, e);
  return e;
}

// Triangle counts of one tank (near, far) for tools and tests.
export function tankStats(spec, color) {
  const e = entry(spec, color == null ? spec.colors[0] : color);
  return { tris: e.tris, farTris: e.farTris };
}

export function createTankMesh(spec, color) {
  const col = color == null ? spec.colors[0] : color;
  const e = entry(spec, col);
  const group = new THREE.Group();
  group.rotation.order = 'YZX';
  const skin = createSkin('tank');
  const hullLod = new THREE.LOD();
  const hull = new THREE.Mesh(e.hull, skin);
  hullLod.addLevel(hull, 0);
  hullLod.addLevel(new THREE.Mesh(e.far, skin), LOD_FAR);
  const turret = new THREE.Group();
  turret.position.set(spec.turretX, 1.62, 0);
  const turretBody = new THREE.Mesh(e.turret, skin);
  const gun = new THREE.Group();
  gun.position.set(0, spec.turretY - 1.62, 0);
  const barrel = new THREE.Mesh(e.gun, skin);
  gun.add(barrel);
  turret.add(turretBody, gun);
  group.add(hullLod, turret);
  group.userData = { spec, color: col, hull, hullLod, skin, tracks: hull, turret, turretBody, gun, barrel, look: -1, tris: e.tris };
  return group;
}

export function updateTankMesh(mesh, t, alpha = 1) {
  const ud = mesh.userData;
  const x = t.px + (t.x - t.px) * alpha;
  const z = t.pz + (t.z - t.pz) * alpha;
  const h = t.pheading + angleDiff(t.heading, t.pheading) * alpha;
  const pp = Number.isFinite(t.ppitch) ? t.ppitch : t.pitch;
  const pr = Number.isFinite(t.proll) ? t.proll : t.roll;
  mesh.position.set(x, Number.isFinite(t.y) ? t.y : 0, z);
  mesh.rotation.set(pr + (t.roll - pr) * alpha, -h, pp + (t.pitch - pp) * alpha);
  const ty = t.pturretYaw + angleDiff(t.turretYaw, t.pturretYaw) * alpha;
  ud.turret.rotation.y = -ty;
  ud.gun.rotation.z = t.pgunPitch + (t.gunPitch - t.pgunPitch) * alpha;
  ud.barrel.position.x = -0.55 * (t.recoil || 0);
  // Track links scroll and the wheels turn with each side's phase.
  ud.skin.userData.rig.r0.set(t.trackPhaseL || 0, t.trackPhaseR || 0, 0, 0);
  const hp = ud.spec.health || 1;
  const wear = Math.min(1, Math.max(0, 1 - (t.health == null ? hp : t.health) / hp)) * 0.8;
  const look = wear * 10 + (t.wrecked ? 100 : 0) + (t.hitT > 0 ? 1000 + t.hitT : 0);
  if (look !== ud.look) {
    ud.look = look;
    skinLook(ud.skin, wear, !!t.wrecked, t.hitT || 0);
    ud.skin.userData.rig.dmg.z = 0.55;
  }
}
