// Stylised-realistic person, about 1.78 m tall, facing local +x. One
// skinned mesh per person (a single draw call): rounded lofted limbs and
// torso, a shaped head with hair, clothing coloured per vertex. The bones
// keep the old box-man names (body, torso, head, legL / legR, armL / armR)
// so the walk, aim and lying poses drive them the same way; knees and
// elbows are extra bones. Geometry is shared per look (palette + outfit),
// the material is shared by everybody until a hit flash or fade needs a
// private copy.
import * as THREE from 'three';
import { angleDiff } from '../core/rng.js';

// Clothing colour sets for the player and pedestrians. `outfit`: tee,
// long (long sleeves), jacket (open jacket over a shirt), hoodie, dress
// shirt; `hairStyle`: short, long, bun, bald, cap; `build`: 0 slim .. 1
// broad.
export const PERSON_PALETTES = [
  { shirt: 0x3a6ea5, trousers: 0x2b2f3a, skin: 0xe0b48c, hair: 0x2a1c12, outfit: 'tee', hairStyle: 'short', build: 0.6 },
  { shirt: 0xc8553d, trousers: 0x3d3a33, skin: 0x8d5a3b, hair: 0x141010, outfit: 'jacket', inner: 0xe8e4da, hairStyle: 'short', build: 0.8 },
  { shirt: 0x6b8f4e, trousers: 0x4a3b2a, skin: 0xf1c9a5, hair: 0xb07a3a, outfit: 'long', hairStyle: 'long', build: 0.2 },
  { shirt: 0xe8d36a, trousers: 0x29384d, skin: 0xc68e62, hair: 0x3b2516, outfit: 'tee', hairStyle: 'bun', build: 0.25 },
  { shirt: 0x8a4f8f, trousers: 0x1f1f24, skin: 0x5e3c28, hair: 0x0f0c0a, outfit: 'hoodie', hairStyle: 'bald', build: 0.7 },
  { shirt: 0xeeeeea, trousers: 0x6a6f78, skin: 0xd9a87e, hair: 0x6d6d6d, outfit: 'dress', hairStyle: 'short', build: 0.55 },
  { shirt: 0x2f8f8a, trousers: 0x8a7a5c, skin: 0xa86f4a, hair: 0x1a120c, outfit: 'tee', hairStyle: 'cap', hat: 0x24303c, build: 0.5 },
  { shirt: 0xd9833b, trousers: 0x2e3b2a, skin: 0xedc3a0, hair: 0xc9a25a, outfit: 'long', hairStyle: 'long', build: 0.15 },
  { shirt: 0x444b55, trousers: 0x6b4a33, skin: 0x7a4b30, hair: 0x231710, outfit: 'jacket', inner: 0xb8c4cc, hairStyle: 'short', build: 0.9 },
  { shirt: 0xb83a5e, trousers: 0x33405a, skin: 0xe6bc96, hair: 0x5a2e1a, outfit: 'tee', hairStyle: 'bun', build: 0.3 },
];

// Looks the systems pass without an outfit (police officers, the rival
// crew) are recognised by their colours.
const POLICE_SHIRT = 0x26406b;
const CREW_SHIRTS = new Set([0x6e1f4f, 0x7a2a5e, 0x5b1a45]);

// Resolve a palette into a full look description (pure).
export function resolveLook(p = {}) {
  const d = PERSON_PALETTES[0];
  const look = {
    shirt: p.shirt ?? d.shirt, trousers: p.trousers ?? d.trousers, skin: p.skin ?? d.skin, hair: p.hair ?? d.hair,
    outfit: p.outfit || 'tee', hairStyle: p.hairStyle || 'short', build: p.build ?? 0.6, inner: p.inner ?? 0xe6e2d8,
    shoes: p.shoes ?? 0x1c1a18, hat: p.hat ?? 0x1a1c20, vest: null,
  };
  if (p.outfit === 'police' || (!p.outfit && look.shirt === POLICE_SHIRT)) {
    look.outfit = 'police';
    look.hairStyle = 'cap';
    look.hat = 0x182234;
    look.vest = 0x1c232e;
    look.build = 0.75;
  } else if (p.outfit === 'crew' || (!p.outfit && CREW_SHIRTS.has(look.shirt))) {
    look.outfit = 'crew';
    look.inner = 0x18161c;
    look.hairStyle = p.hairStyle || 'beanie';
    look.hat = 0x141218;
    look.build = 0.7;
  }
  return look;
}

// ---- skeleton -----------------------------------------------------------------
const HIP_Y = 0.9;
const SHOULDER_Y = 1.42;
const NECK_Y = 0.56; // head bone above the torso bone
const ARM_Z = 0.178;
// Bone indices.
const B = { body: 0, torso: 1, head: 2, legL: 3, kneeL: 4, legR: 5, kneeR: 6, armL: 7, elbowL: 8, armR: 9, elbowR: 10 };

// ---- geometry ---------------------------------------------------------------------
class Build {
  constructor() {
    this.p = [];
    this.n = [];
    this.c = [];
    this.si = [];
    this.sw = [];
    this.i = [];
    this.count = 0;
  }
  vert(x, y, z, nx, ny, nz, col, b0, b1 = 0, w1 = 0) {
    this.p.push(x, y, z);
    const l = Math.hypot(nx, ny, nz) || 1;
    this.n.push(nx / l, ny / l, nz / l);
    this.c.push(col[0], col[1], col[2]);
    this.si.push(b0, b1, 0, 0);
    this.sw.push(1 - w1, w1, 0, 0);
    return this.count++;
  }
  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3));
    g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(this.si, 4));
    g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(this.sw, 4));
    g.setIndex(this.i);
    g.computeBoundingSphere();
    return g;
  }
}

const cache = new Map();
function lin(hex) {
  let c = cache.get(hex);
  if (!c) {
    const t = new THREE.Color().setHex(hex);
    c = [t.r, t.g, t.b];
    cache.set(hex, c);
  }
  return c;
}

// Loft a closed tube along y through rings: each ring { y, cx, rx, rz,
// col(ang) | col, bone: (y) => [b0, b1, w1] }. Ring points are an
// ellipse (rx along x, rz along z) around (cx, y, cz). Smooth normals.
function tube(bd, rings, seg, cz, bone, capTop, capBottom) {
  const ids = [];
  for (let k = 0; k < rings.length; k++) {
    const R = rings[k];
    const prev = rings[Math.max(0, k - 1)], next = rings[Math.min(rings.length - 1, k + 1)];
    const dy = next.y - prev.y || 1e-4;
    const row = [];
    const [b0, b1, w1] = bone(R.y);
    for (let s = 0; s <= seg; s++) {
      const a = (s / seg) * Math.PI * 2;
      const ca = Math.cos(a), sa = Math.sin(a);
      const x = R.cx + R.rx * ca, z = cz + R.rz * sa;
      // Normal: ellipse normal tilted by the change in radius along y.
      const drx = (next.rx - prev.rx) / dy, drz = (next.rz - prev.rz) / dy, dcx = (next.cx - prev.cx) / dy;
      const nx = ca / R.rx, nz = sa / R.rz;
      const nl = Math.hypot(nx, nz);
      const tilt = -(drx * ca * ca + drz * sa * sa + dcx * ca);
      const col = typeof R.col === 'function' ? R.col(ca, sa) : R.col;
      row.push(bd.vert(x, R.y, z, nx / nl, tilt, nz / nl, col, b0, b1, w1));
    }
    ids.push(row);
  }
  for (let k = 0; k < ids.length - 1; k++) {
    for (let s = 0; s < seg; s++) {
      const a = ids[k][s], b = ids[k][s + 1], c = ids[k + 1][s + 1], d = ids[k + 1][s];
      // Rings run top to bottom or bottom to top; keep faces outward.
      if (rings[k + 1].y > rings[k].y) bd.i.push(a, d, b, b, d, c);
      else bd.i.push(a, b, d, b, c, d);
    }
  }
  const cap = (row, R, up) => {
    const [b0, b1, w1] = bone(R.y);
    const col = typeof R.col === 'function' ? R.col(1, 0) : R.col;
    const c = bd.vert(R.cx, R.y, cz, 0, up ? 1 : -1, 0, col, b0, b1, w1);
    for (let s = 0; s < seg; s++) {
      if (up) bd.i.push(c, row[s + 1], row[s]);
      else bd.i.push(c, row[s], row[s + 1]);
    }
  };
  const topK = rings[0].y > rings[rings.length - 1].y ? 0 : rings.length - 1;
  const botK = topK === 0 ? rings.length - 1 : 0;
  if (capTop) cap(ids[topK], rings[topK], true);
  if (capBottom) cap(ids[botK], rings[botK], false);
}

// Ellipsoid blob (head, hands, hair shells) with an optional profile:
// r(t) scales the radius from the bottom (t 0) to the top (t 1).
function blob(bd, cx, cy, cz, rx, ry, rz, col, b0, seg = 10, rows = 8, shape = null, colFn = null) {
  const ids = [];
  for (let r = 0; r <= rows; r++) {
    const v = r / rows;
    const th = -Math.PI / 2 + v * Math.PI;
    const k = shape ? shape(v) : 1;
    const row = [];
    for (let s = 0; s <= seg; s++) {
      const a = (s / seg) * Math.PI * 2;
      const nx = Math.cos(th) * Math.cos(a), ny = Math.sin(th), nz = Math.cos(th) * Math.sin(a);
      const fx = shape && shape.fx ? shape.fx(v, nx) : 1;
      const x = cx + nx * rx * k * fx, y = cy + ny * ry, z = cz + nz * rz * k;
      const c = colFn ? colFn(nx, ny, nz) : col;
      row.push(bd.vert(x, y, z, nx / rx, ny / ry, nz / rz, c, b0));
    }
    ids.push(row);
  }
  for (let r = 0; r < rows; r++) {
    for (let s = 0; s < seg; s++) {
      const a = ids[r][s], b = ids[r][s + 1], c = ids[r + 1][s + 1], d = ids[r + 1][s];
      bd.i.push(a, d, b, b, d, c);
    }
  }
}

// Weight helper: rigid on b0 above `yj + band`, rigid on b1 below
// `yj - band`, blended between (limbs hang downward).
function joint(b0, b1, yj, band) {
  return (y) => {
    if (y >= yj + band) return [b0, 0, 0];
    if (y <= yj - band) return [b1, 0, 0];
    return [b0, b1, (yj + band - y) / (2 * band)];
  };
}
const rigid = (b) => () => [b, 0, 0];

function buildLook(L) {
  const bd = new Build();
  const skin = lin(L.skin), shirt = lin(L.shirt), trousers = lin(L.trousers), shoes = lin(L.shoes), hair = lin(L.hair);
  const inner = lin(L.inner), hat = lin(L.hat), vest = L.vest != null ? lin(L.vest) : null;
  const sole = lin(0x2c2a28), belt = lin(0x18171a);
  const bw = 0.92 + L.build * 0.16; // shoulder / chest width scale
  const hip = 1.04 - L.build * 0.08; // slimmer builds get relatively wider hips
  const longSleeve = L.outfit !== 'tee';
  const open = L.outfit === 'jacket' || L.outfit === 'crew';
  const torsoCol = (ca, sa) => {
    if (vest && ca > -0.2) return Math.abs(sa) < 0.86 ? vest : shirt;
    if (open && ca > 0.7 && Math.abs(sa) < 0.36) return inner;
    return shirt;
  };

  // Legs: thigh and shin (knee blend), shoes.
  for (const side of [-1, 1]) {
    const leg = side < 0 ? B.legL : B.legR, knee = side < 0 ? B.kneeL : B.kneeR;
    const z = side * 0.095;
    const hy = HIP_Y;
    tube(bd, [
      { y: hy + 0.06, cx: 0, rx: 0.085, rz: 0.08, col: trousers },
      { y: hy - 0.06, cx: 0.005, rx: 0.09, rz: 0.085, col: trousers },
      { y: hy - 0.26, cx: 0.01, rx: 0.074, rz: 0.07, col: trousers },
      { y: hy - 0.44, cx: 0.012, rx: 0.06, rz: 0.058, col: trousers },
      { y: hy - 0.52, cx: 0.008, rx: 0.058, rz: 0.056, col: trousers },
      { y: hy - 0.66, cx: -0.008, rx: 0.06, rz: 0.054, col: trousers },
      { y: hy - 0.8, cx: 0, rx: 0.047, rz: 0.045, col: trousers },
      { y: hy - 0.84, cx: 0, rx: 0.045, rz: 0.043, col: trousers },
    ], 8, z, joint(leg, knee, hy - 0.46, 0.05), false, false);
    // Shoe: a lofted sole-to-toe shape along x.
    const sy = 0.0;
    const rows = [[-0.07, 0.035, 0.04], [-0.03, 0.05, 0.05], [0.04, 0.045, 0.052], [0.11, 0.032, 0.046], [0.15, 0.02, 0.03]];
    const ids = [];
    for (const [x, ry, rz] of rows) {
      const row = [];
      for (let s = 0; s <= 8; s++) {
        const a = (s / 8) * Math.PI * 2;
        const ca = Math.cos(a), sa = Math.sin(a);
        const y = sy + ry + ry * ca * (ca < 0 ? 0.25 : 1);
        row.push(bd.vert(x, Math.max(sy, y), z + rz * sa, 0, ca, sa, ca < -0.3 ? sole : shoes, knee));
      }
      ids.push(row);
    }
    for (let k = 0; k < ids.length - 1; k++) {
      for (let s = 0; s < 8; s++) {
        const a = ids[k][s], b = ids[k][s + 1], c = ids[k + 1][s + 1], d = ids[k + 1][s];
        bd.i.push(a, b, d, b, c, d);
      }
    }
    const cHeel = bd.vert(-0.08, 0.04, z, -1, 0, 0, shoes, knee), cToe = bd.vert(0.155, 0.02, z, 1, 0, 0, shoes, knee);
    for (let s = 0; s < 8; s++) {
      bd.i.push(cHeel, ids[0][s + 1], ids[0][s]);
      bd.i.push(cToe, ids[4][s], ids[4][s + 1]);
    }
  }

  // Torso: pelvis to shoulders (torso bone), rounded shoulder top.
  const ty = HIP_Y;
  const tr = (y, rx, rz, cx, col) => ({ y: ty + y, cx, rx, rz, col });
  const low = L.outfit === 'dress' ? inner : trousers;
  tube(bd, [
    tr(-0.06, 0.1, 0.17 * hip, 0, trousers),
    tr(0.02, 0.11, 0.175 * hip, 0, trousers),
    tr(0.07, 0.105, 0.165 * hip, 0, belt),
    tr(0.1, 0.1, 0.158, 0.003, L.outfit === 'dress' ? shirt : low === inner ? shirt : torsoCol),
    tr(0.22, 0.098, 0.15 * bw, 0.006, torsoCol),
    tr(0.36, 0.112, 0.168 * bw, 0.012, torsoCol),
    tr(0.46, 0.114, 0.168 * bw, 0.01, torsoCol),
    tr(0.515, 0.1, 0.16 * bw, 0.0, torsoCol),
    tr(0.55, 0.082, 0.145 * bw, -0.004, torsoCol),
    tr(0.575, 0.062, 0.1 * bw, -0.005, torsoCol),
    tr(0.595, 0.045, 0.06, -0.005, L.outfit === 'hoodie' ? shirt : skin),
  ], 12, 0, rigid(B.torso), true, true);
  // Neck.
  tube(bd, [
    { y: ty + 0.58, cx: -0.004, rx: 0.042, rz: 0.044, col: skin },
    { y: ty + 0.68, cx: 0.0, rx: 0.04, rz: 0.042, col: skin },
  ], 8, 0, rigid(B.head), false, false);
  if (L.outfit === 'hoodie') {
    // Hood folded behind the neck.
    blob(bd, -0.07, ty + 0.58, 0, 0.06, 0.05, 0.12, shirt, B.torso, 8, 5);
  }
  if (vest) {
    // Reflective band and shoulder patches on the police vest.
    tube(bd, [tr(0.33, 0.118, 0.172 * bw, 0.013, lin(0xb8bcc0)), tr(0.35, 0.119, 0.174 * bw, 0.013, lin(0xb8bcc0))], 12, 0, rigid(B.torso), false, false);
  }

  // Head: egg shape, narrower jaw, nose, ears.
  const hy = HIP_Y + NECK_Y;
  const headShape = (v) => (v < 0.35 ? 0.78 + v * 0.63 : 1 - (v - 0.35) * 0.12);
  blob(bd, 0.005, hy + 0.14, 0, 0.104, 0.13, 0.09, skin, B.head, 12, 9, headShape);
  blob(bd, 0.1, hy + 0.12, 0, 0.022, 0.03, 0.017, skin, B.head, 6, 4);
  for (const s of [-1, 1]) blob(bd, -0.005, hy + 0.135, s * 0.09, 0.018, 0.03, 0.012, skin, B.head, 6, 4);
  // Eyes: small dark dots.
  for (const s of [-1, 1]) blob(bd, 0.092, hy + 0.16, s * 0.035, 0.008, 0.009, 0.014, lin(0x1a1410), B.head, 5, 3);
  // Hair or hat.
  const hs = L.hairStyle;
  if (hs !== 'bald') {
    // Skull cap of hair: upper half of a slightly bigger ellipsoid, a bit
    // further down at the back.
    const shell = (v) => (v < 0.42 ? 0.0001 : 1.0);
    if (hs === 'short' || hs === 'long' || hs === 'bun') {
      blob(bd, -0.004, hy + 0.155, 0, 0.112, 0.126, 0.098, hair, B.head, 12, 7, shell);
      blob(bd, -0.045, hy + 0.125, 0, 0.074, 0.085, 0.093, hair, B.head, 8, 5);
    }
    if (hs === 'long') blob(bd, -0.06, hy + 0.04, 0, 0.055, 0.14, 0.095, hair, B.head, 10, 6);
    if (hs === 'bun') blob(bd, -0.09, hy + 0.21, 0, 0.045, 0.045, 0.045, hair, B.head, 8, 5);
    if (hs === 'cap' || hs === 'beanie') {
      const capCol = hat;
      blob(bd, -0.004, hy + 0.16, 0, 0.114, 0.128, 0.1, capCol, B.head, 12, 7, shell);
      blob(bd, -0.05, hy + 0.115, 0, 0.07, 0.065, 0.092, hair, B.head, 8, 5);
      if (hs === 'cap') {
        // Peak.
        blob(bd, 0.1, hy + 0.205, 0, 0.07, 0.012, 0.085, capCol, B.head, 10, 3);
        if (L.outfit === 'police') blob(bd, 0.096, hy + 0.235, 0, 0.012, 0.016, 0.022, lin(0xc8b060), B.head, 5, 3);
      }
    }
  }

  // Arms: upper arm (sleeve), forearm (skin or sleeve), hand; elbow blend.
  for (const side of [-1, 1]) {
    const arm = side < 0 ? B.armL : B.armR, elbow = side < 0 ? B.elbowL : B.elbowR;
    const z = side * ARM_Z * bw;
    const sy = SHOULDER_Y;
    const sleeve = shirt;
    const fore = longSleeve ? sleeve : skin;
    tube(bd, [
      { y: sy + 0.03, cx: 0, rx: 0.03, rz: 0.026, col: sleeve },
      { y: sy, cx: 0, rx: 0.048, rz: 0.044, col: sleeve },
      { y: sy - 0.05, cx: 0, rx: 0.052, rz: 0.048, col: sleeve },
      { y: sy - 0.14, cx: 0, rx: 0.05, rz: 0.047, col: sleeve },
      { y: sy - 0.24, cx: 0, rx: 0.044, rz: 0.042, col: sleeve },
      { y: sy - 0.27, cx: 0, rx: 0.042, rz: 0.04, col: fore },
      { y: sy - 0.33, cx: 0.004, rx: 0.042, rz: 0.04, col: fore },
      { y: sy - 0.48, cx: 0.006, rx: 0.036, rz: 0.034, col: fore },
      { y: sy - 0.57, cx: 0.004, rx: 0.03, rz: 0.03, col: L.outfit === 'jacket' || L.outfit === 'crew' ? sleeve : longSleeve ? sleeve : skin },
      { y: sy - 0.59, cx: 0.004, rx: 0.026, rz: 0.026, col: skin },
    ], 8, z, joint(arm, elbow, sy - 0.3, 0.04), true, false);
    // Hand.
    blob(bd, 0.01, sy - 0.65, z, 0.034, 0.06, 0.028, skin, elbow, 8, 5);
  }
  const g = bd.geometry();
  g.userData.triangles = bd.i.length / 3;
  return g;
}

const GEO = new Map();
function lookKey(L) {
  return [L.shirt, L.trousers, L.skin, L.hair, L.outfit, L.hairStyle, L.build, L.inner, L.hat, L.vest, L.shoes].join(':');
}
export function personGeometry(look) {
  const L = resolveLook(look);
  const key = lookKey(L);
  let g = GEO.get(key);
  if (!g) {
    g = buildLook(L);
    GEO.set(key, g);
  }
  return g;
}

let MAT = null;
function sharedMaterial() {
  if (!MAT) MAT = new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.82, metalness: 0 });
  return MAT;
}

const BOUND = new THREE.Sphere(new THREE.Vector3(0, 0.9, 0), 1.15);

export function createPersonMesh(palette = {}) {
  const geo = personGeometry(palette);
  const root = new THREE.Group();
  const mk = (parent, x, y, z) => {
    const b = new THREE.Bone();
    b.position.set(x, y, z);
    if (parent) parent.add(b);
    return b;
  };
  const L = resolveLook(palette);
  const bw = 0.92 + L.build * 0.16;
  const body = mk(null, 0, 0, 0);
  const torso = mk(body, 0, HIP_Y, 0);
  const head = mk(torso, 0, NECK_Y, 0);
  const legL = mk(body, 0, HIP_Y, -0.095);
  const kneeL = mk(legL, 0, -0.46, 0);
  const legR = mk(body, 0, HIP_Y, 0.095);
  const kneeR = mk(legR, 0, -0.46, 0);
  const armL = mk(body, 0, SHOULDER_Y, -ARM_Z * bw);
  const elbowL = mk(armL, 0, -0.3, 0);
  const armR = mk(body, 0, SHOULDER_Y, ARM_Z * bw);
  const elbowR = mk(armR, 0, -0.3, 0);
  const bones = [body, torso, head, legL, kneeL, legR, kneeR, armL, elbowL, armR, elbowR];
  root.add(body);
  const mesh = new THREE.SkinnedMesh(geo, sharedMaterial());
  mesh.boundingSphere = BOUND.clone();
  mesh.castShadow = false;
  root.add(mesh);
  root.updateMatrixWorld(true);
  mesh.bind(new THREE.Skeleton(bones));
  root.userData.person = { body, torso, head, legL, legR, armL, armR, kneeL, kneeR, elbowL, elbowR, skin: mesh, amp: 0, gun: null, gunId: '', raise: 0, flash: 0, fade: 0, op: 1, own: null };
  return root;
}

// ---- held weapon, hit flash and fade (combat) -----------------------------
// The weapon is one small box mesh on the right hand whose geometry is
// swapped per weapon id (shared, made once). Hits flash the whole person
// white (never red); a person who is out fades away. The material is
// cloned per person the first time it is needed, because the shared one
// is used by everybody.
const GUN_DIMS = {
  wrench: [0.05, 0.42, 0.05, 0x8a8f96],
  pistol: [0.06, 0.2, 0.09, 0x2a2c30],
  smg: [0.07, 0.34, 0.11, 0x2a2c30],
  scatter: [0.07, 0.72, 0.09, 0x4a3524],
  lobber: [0.14, 0.78, 0.14, 0x5d6b3a],
  fizz: [0.09, 0.14, 0.09, 0xd6a436],
};
const GUN_GEO = {};
function gunGeo(id) {
  let g = GUN_GEO[id];
  if (!g) {
    const d = GUN_DIMS[id];
    // Along the arm (local -y) from the palm, so a raised arm aims it.
    g = GUN_GEO[id] = new THREE.BoxGeometry(d[0], d[1], d[2]).translate(0, -0.64 - d[1] / 2 + 0.04, 0);
  }
  return g;
}
const GUN_MAT = {};
function gunMat(id) {
  return GUN_MAT[id] || (GUN_MAT[id] = new THREE.MeshStandardMaterial({ color: GUN_DIMS[id][3], roughness: 0.5, metalness: 0.4 }));
}

function ownMaterials(mesh, P) {
  if (P.own) return P.own;
  const list = [];
  mesh.traverse((o) => {
    if (o.isMesh && o !== P.gun) {
      o.material = o.material.clone();
      list.push(o.material);
    }
  });
  P.own = list;
  return list;
}

function applyArms(mesh, P, w) {
  const arms = w.arms;
  const alive = !w.life || w.life === 'ok' || w.life === 'getup';
  const id = arms && arms.weapon && GUN_DIMS[arms.weapon] ? arms.weapon : '';
  if (id && alive) {
    if (!P.gun) {
      P.gun = new THREE.Mesh(gunGeo(id), gunMat(id));
      P.armR.add(P.gun);
    }
    if (P.gunId !== id) {
      P.gun.geometry = gunGeo(id);
      P.gun.material = gunMat(id);
      P.gunId = id;
    }
    P.gun.visible = true;
  } else if (P.gun) {
    P.gun.visible = false;
  }
  // Raise the arm to aim while a gun is out and fighting.
  const gun = id && id !== 'wrench' && id !== 'fizz';
  const aiming = gun && alive && (arms.cool > 0.04 || w.aiming || w.firing || w.state === 'engage');
  P.raise += ((aiming ? 1 : 0) - P.raise) * 0.3;
  if (P.raise > 0.01) {
    P.armR.rotation.z = P.armR.rotation.z * (1 - P.raise) + 1.5 * P.raise;
    P.armR.rotation.x *= 1 - P.raise;
    P.torso.rotation.z *= 1 - P.raise;
    P.elbowR.rotation.z *= 1 - P.raise;
  }
}

function applyLook(mesh, P, w) {
  const hit = w.hitT > 0 ? Math.min(1, w.hitT / 0.15) : 0;
  const fade = w.fade > 0 ? Math.min(1, w.fade) : 0;
  const flash = hit > 0 ? hit : 0;
  if (flash === P.flash && (1 - fade) === P.op) return;
  const mats = ownMaterials(mesh, P);
  for (let i = 0; i < mats.length; i++) {
    const m = mats[i];
    m.emissive.setScalar(flash * 0.7);
    if (fade !== P.fade) {
      m.transparent = fade > 0;
      m.opacity = 1 - fade;
      m.depthWrite = fade < 0.5;
    }
  }
  P.fade = fade;
  P.flash = flash;
  P.op = 1 - fade;
}

// Walk cycle pose for a stride phase and swing amount (pure): leg and arm
// swings plus knee and elbow bends, written into `out`.
export function walkPose(stride, amp, out) {
  const s = Math.sin(stride), c = Math.cos(stride);
  out.legL = s * amp;
  out.legR = -s * amp;
  // A knee folds while its leg swings forward and stays nearly straight
  // while it carries the weight.
  out.kneeL = -(Math.max(0, c) * 1.15 + 0.06) * amp;
  out.kneeR = -(Math.max(0, -c) * 1.15 + 0.06) * amp;
  out.armL = -s * amp * 0.9;
  out.armR = s * amp * 0.9;
  out.elbow = 0.12 + amp * 0.55;
  out.bob = Math.abs(c) * 0.05 * amp;
  return out;
}
const POSE = { legL: 0, legR: 0, kneeL: 0, kneeR: 0, armL: 0, armR: 0, elbow: 0, bob: 0 };

// Place and animate. `w` is a walker (see entities/onfoot.js).
export function updatePersonMesh(mesh, w, alpha = 1) {
  const P = mesh.userData.person;
  const x = w.px + (w.x - w.px) * alpha;
  const z = w.pz + (w.z - w.pz) * alpha;
  const h = w.pheading + angleDiff(w.heading, w.pheading) * alpha;
  mesh.position.set(x, w.y || 0, z);
  mesh.rotation.y = -h;

  // Swing amount follows speed, eased so stopping settles into idle.
  const want = w.moving ? Math.min(1, w.speed / 6) * 0.55 + Math.min(1, w.speed / 2.4) * 0.35 : 0;
  P.amp += (want - P.amp) * 0.2;
  const a = P.amp;
  walkPose(w.stride || 0, a, POSE);
  P.legL.rotation.z = POSE.legL;
  P.legR.rotation.z = POSE.legR;
  P.kneeL.rotation.z = POSE.kneeL;
  P.kneeR.rotation.z = POSE.kneeR;
  P.armL.rotation.z = POSE.armL;
  P.armR.rotation.z = POSE.armR;
  P.elbowL.rotation.z = POSE.elbow;
  P.elbowR.rotation.z = POSE.elbow;
  // Arms hang slightly away from the body.
  P.armL.rotation.x = 0.06;
  P.armR.rotation.x = -0.06;
  P.body.position.y = POSE.bob;
  P.torso.rotation.z = -0.12 * a * a; // lean into a run
  P.head.rotation.z = 0.08 * a * a;
  if (w.arms) applyArms(mesh, P, w);
  if (w.life === 'down' || w.life === 'out') {
    // limbs flung out while lying down
    P.armL.rotation.x = 0.9;
    P.armR.rotation.x = -0.9;
    P.legL.rotation.x = 0.15;
    P.legR.rotation.x = -0.15;
    P.kneeL.rotation.z = -0.35;
    P.kneeR.rotation.z = -0.1;
    P.elbowL.rotation.z = 0.5;
    P.elbowR.rotation.z = 0.2;
  } else if (P.legL.rotation.x !== 0) {
    P.legL.rotation.x = P.legR.rotation.x = 0;
  }
  if (w.hitT > 0 || P.flash > 0 || w.fade > 0 || P.op < 1) applyLook(mesh, P, w);
}
