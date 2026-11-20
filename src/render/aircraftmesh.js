// Stylised low-poly aircraft meshes. Each airframe is one merged,
// vertex-coloured mesh; propellers and rotors are separate so they can
// spin. Materials are shared by every aircraft.
// Origin is the ground-contact centre; the nose points along local +x.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { angleDiff } from '../core/rng.js';

// ---- shared materials -----------------------------------------------------
const MAT = {
  body: new THREE.MeshLambertMaterial({ vertexColors: true }),
  blade: new THREE.MeshLambertMaterial({ color: 0x23262b }),
  disc: new THREE.MeshLambertMaterial({
    color: 0x3a3f46, transparent: true, opacity: 0.14, side: THREE.DoubleSide, depthWrite: false,
  }),
};

const GLASS = 0x1b2a38;
const DARK = 0x24272c;
const TYRE = 0x16171a;
const METAL = 0x8d9399;
const WHITE = 0xf2f1ea;
const NAVY = 0x27395c;

// ---- geometry helpers -----------------------------------------------------
const tmpColor = new THREE.Color();

// Give a geometry a flat vertex colour and a consistent attribute set.
function finish(geo, hex) {
  let g = geo.index ? geo.toNonIndexed() : geo;
  g.deleteAttribute('uv');
  if (!g.attributes.normal) g.computeVertexNormals();
  tmpColor.setHex(hex);
  const n = g.attributes.position.count;
  const col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    col[i * 3] = tmpColor.r;
    col[i * 3 + 1] = tmpColor.g;
    col[i * 3 + 2] = tmpColor.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  if (g !== geo) geo.dispose();
  return g;
}

function fromTriangles(pos, hex) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return finish(g, hex);
}

function box(parts, hex, sx, sy, sz, x, y, z) {
  const g = new THREE.BoxGeometry(sx, sy, sz);
  g.translate(x, y, z);
  parts.push(finish(g, hex));
}

// Cylinder with its axis along 'x', 'y' or 'z', centred on (x, y, z).
function cyl(parts, hex, r0, r1, len, axis, x, y, z, seg = 10) {
  const g = new THREE.CylinderGeometry(r1, r0, len, seg);
  if (axis === 'x') g.rotateZ(-Math.PI / 2); // +y end goes to +x
  else if (axis === 'z') g.rotateX(Math.PI / 2);
  g.translate(x, y, z);
  parts.push(finish(g, hex));
}

function wheel(parts, x, z, r, w = 0.16) {
  cyl(parts, TYRE, r, r, w, 'z', x, r, z, 10);
  cyl(parts, METAL, r * 0.45, r * 0.45, w + 0.02, 'z', x, r, z, 8);
}

// A convex solid from 8 corners: 0-3 one ring, 4-7 the matching ring.
// Triangles are turned to face away from the centre, so callers need not
// care about winding (or about mirroring).
const HEX_QUADS = [[0, 1, 2, 3], [7, 6, 5, 4], [3, 2, 6, 7], [1, 0, 4, 5], [2, 1, 5, 6], [0, 3, 7, 4]];
function hexa(parts, hex, v) {
  let cx = 0, cy = 0, cz = 0;
  for (const p of v) {
    cx += p[0] / 8;
    cy += p[1] / 8;
    cz += p[2] / 8;
  }
  const pos = [];
  const tri = (a, b, c) => {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const wx = c[0] - a[0], wy = c[1] - a[1], wz = c[2] - a[2];
    const nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx;
    if (nx * nx + ny * ny + nz * nz < 1e-12) return;
    const out = nx * (a[0] - cx) + ny * (a[1] - cy) + nz * (a[2] - cz);
    if (out >= 0) pos.push(...a, ...b, ...c);
    else pos.push(...a, ...c, ...b);
  };
  for (const q of HEX_QUADS) {
    tri(v[q[0]], v[q[1]], v[q[2]]);
    tri(v[q[0]], v[q[2]], v[q[3]]);
  }
  parts.push(fromTriangles(pos, hex));
}

// One flying surface between a root and a tip section. Each section is
// { x0 (trailing edge), x1 (leading edge), y, z, t (thickness) }.
function surface(parts, hex, root, tip) {
  const ring = (s) => [
    [s.x0, s.y - s.t * 0.25, s.z], [s.x1, s.y - s.t / 2, s.z],
    [s.x1, s.y + s.t / 2, s.z], [s.x0, s.y + s.t * 0.25, s.z],
  ];
  hexa(parts, hex, [...ring(root), ...ring(tip)]);
}

// Both halves of a wing, with the outer part in a second colour.
function wingPair(parts, hex, tipHex, root, tip, split = 0.82) {
  const mid = {};
  for (const k of ['x0', 'x1', 'y', 'z', 't']) mid[k] = root[k] + (tip[k] - root[k]) * split;
  for (const side of [1, -1]) {
    const r = { ...root, z: root.z * side }, m = { ...mid, z: mid.z * side }, t = { ...tip, z: tip.z * side };
    surface(parts, hex, r, m);
    surface(parts, tipHex, m, t);
  }
}

// Upright fin: base from xb0..xb1 at y0, top from xt0..xt1 at y1.
function fin(parts, hex, xb0, xb1, xt0, xt1, y0, y1, t, z = 0) {
  const h = t / 2, hh = t * 0.3;
  hexa(parts, hex, [
    [xb0, y0, z - h * 0.6], [xb1, y0, z - h], [xb1, y0, z + h], [xb0, y0, z + h * 0.6],
    [xt0, y1, z - hh * 0.6], [xt1, y1, z - hh], [xt1, y1, z + hh], [xt0, y1, z + hh * 0.6],
  ]);
}

// Straight strut between two points, square section of width w.
function strut(parts, hex, ax, ay, az, bx, by, bz, w = 0.07) {
  const h = w / 2;
  // Offsets along x and along whichever of y / z the strut does not follow.
  const flat = Math.abs(by - ay) < Math.abs(bz - az);
  const o = flat ? [0, h, 0] : [0, 0, h];
  const ring = (x, y, z) => [
    [x - h, y - o[1], z - o[2]], [x + h, y - o[1], z - o[2]],
    [x + h, y + o[1], z + o[2]], [x - h, y + o[1], z + o[2]],
  ];
  hexa(parts, hex, [...ring(ax, ay, az), ...ring(bx, by, bz)]);
}

// Greenhouse wedge: a box whose top is shorter than its base and whose
// width may differ front to rear. Used for windscreens.
function wedge(parts, hex, bx0, bx1, tx0, tx1, y0, y1, bwRear, bwFront, twRear, twFront) {
  hexa(parts, hex, [
    [bx0, y0, -bwRear], [bx1, y0, -bwFront], [bx1, y0, bwFront], [bx0, y0, bwRear],
    [tx0, y1, -twRear], [tx1, y1, -twFront], [tx1, y1, twFront], [tx0, y1, twRear],
  ]);
}

// Tapered body lofted through cross-sections. Each station is
// [x, centreY, halfWidth, halfHeight], sorted by ascending x. Sections are
// octagons with flat top, bottom and sides. zOff shifts the whole body.
function loft(parts, hex, stations, zOff = 0, sides = 8) {
  const rings = stations.map(([x, cy, hw, hh]) => {
    const ring = [];
    for (let k = 0; k < sides; k++) {
      const t = ((k + 0.5) / sides) * Math.PI * 2;
      ring.push([x, cy + Math.sin(t) * hh / Math.cos(Math.PI / sides), zOff + Math.cos(t) * hw / Math.cos(Math.PI / sides)]);
    }
    return ring;
  });
  const pos = [];
  for (let i = 0; i < rings.length - 1; i++) {
    const r0 = rings[i], r1 = rings[i + 1];
    for (let k = 0; k < sides; k++) {
      const k1 = (k + 1) % sides;
      const a = r0[k], b = r1[k], c = r1[k1], d = r0[k1];
      pos.push(...a, ...b, ...c, ...a, ...c, ...d);
    }
  }
  // End caps (rear faces -x, front faces +x).
  const first = rings[0], last = rings[rings.length - 1];
  const fc = [stations[0][0], stations[0][1], zOff];
  const lc = [stations[stations.length - 1][0], stations[stations.length - 1][1], zOff];
  for (let k = 0; k < sides; k++) {
    const k1 = (k + 1) % sides;
    pos.push(...fc, ...first[k], ...first[k1]);
    pos.push(...lc, ...last[k1], ...last[k]);
  }
  parts.push(fromTriangles(pos, hex));
}

function trimFor(color) {
  tmpColor.setHex(color);
  const lum = tmpColor.r * 0.3 + tmpColor.g * 0.6 + tmpColor.b * 0.1;
  return lum > 0.45 ? NAVY : WHITE;
}

// ---- airframes --------------------------------------------------------------
// Each returns { prop: [x, y, radius] | null, rotor, tailRotor }.

// Low-wing single-prop trainer with a bubble canopy and tricycle gear.
function buildProp(color, trim, parts) {
  loft(parts, color, [
    [-3.7, 1.45, 0.07, 0.13], [-1.2, 1.3, 0.4, 0.48], [0.4, 1.25, 0.54, 0.58],
    [2.2, 1.22, 0.52, 0.54], [3.15, 1.22, 0.36, 0.38],
  ]);
  loft(parts, DARK, [[3.15, 1.22, 0.3, 0.32], [3.22, 1.22, 0.3, 0.32]]);
  loft(parts, GLASS, [
    [-1.2, 1.74, 0.16, 0.08], [-0.5, 1.88, 0.38, 0.3], [0.6, 1.88, 0.4, 0.3], [1.5, 1.7, 0.26, 0.1],
  ]);
  // Side stripe.
  box(parts, trim, 1.9, 0.1, 1.07, 1.3, 1.28, 0);
  wingPair(parts, color, trim,
    { x0: -0.25, x1: 1.5, y: 0.92, z: 0.3, t: 0.2 },
    { x0: 0.15, x1: 1.2, y: 1.28, z: 5.2, t: 0.1 });
  wingPair(parts, color, trim,
    { x0: -3.7, x1: -2.7, y: 1.5, z: 0, t: 0.1 },
    { x0: -3.6, x1: -3.05, y: 1.5, z: 1.8, t: 0.06 }, 0.8);
  fin(parts, color, -3.75, -2.5, -3.8, -3.25, 1.5, 2.2, 0.1);
  fin(parts, trim, -3.8, -3.25, -3.82, -3.42, 2.2, 2.6, 0.07);
  cyl(parts, trim, 0.22, 0.03, 0.5, 'x', 3.45, 1.22, 0, 8);
  // Gear.
  wheel(parts, 2.3, 0, 0.2);
  strut(parts, METAL, 2.3, 0.2, 0, 2.2, 0.8, 0);
  for (const s of [1, -1]) {
    wheel(parts, 0.3, 1.25 * s, 0.24);
    strut(parts, METAL, 0.3, 0.24, 1.15 * s, 0.4, 0.95, 1.0 * s, 0.09);
  }
  return { prop: [3.5, 1.22, 0.95] };
}

// Aerobatic biplane: two staggered wings, struts, open cockpit, tail wheel.
function buildStunt(color, trim, parts) {
  loft(parts, color, [
    [-2.9, 1.2, 0.06, 0.12], [-1.0, 1.1, 0.34, 0.4], [0.6, 1.05, 0.44, 0.48],
    [1.9, 1.05, 0.44, 0.46], [2.45, 1.05, 0.38, 0.4],
  ]);
  loft(parts, DARK, [[2.45, 1.05, 0.4, 0.42], [2.62, 1.05, 0.36, 0.38]]);
  cyl(parts, trim, 0.2, 0.03, 0.4, 'x', 2.82, 1.05, 0, 8);
  // Headrest fairing, cockpit opening and a small windscreen.
  loft(parts, color, [[-1.7, 1.42, 0.08, 0.06], [-0.75, 1.56, 0.2, 0.14], [-0.6, 1.5, 0.2, 0.1]]);
  box(parts, DARK, 0.7, 0.06, 0.5, -0.25, 1.52, 0);
  wedge(parts, GLASS, 0.1, 0.45, 0.1, 0.16, 1.5, 1.78, 0.26, 0.2, 0.2, 0.16);
  box(parts, trim, 1.4, 0.09, 0.885, 1.2, 1.1, 0);
  // Lower wing, then the upper wing set forward.
  wingPair(parts, color, trim,
    { x0: 0.2, x1: 1.4, y: 0.72, z: 0.25, t: 0.13 },
    { x0: 0.3, x1: 1.35, y: 0.86, z: 3.1, t: 0.09 });
  wingPair(parts, color, trim,
    { x0: 0.75, x1: 2.0, y: 2.05, z: 0, t: 0.13 },
    { x0: 0.85, x1: 1.9, y: 2.1, z: 3.4, t: 0.09 });
  for (const s of [1, -1]) {
    // Interplane and cabane struts.
    strut(parts, DARK, 0.45, 0.85, 2.4 * s, 1.0, 2.05, 2.5 * s, 0.06);
    strut(parts, DARK, 1.2, 0.85, 2.4 * s, 1.75, 2.05, 2.5 * s, 0.06);
    strut(parts, DARK, 0.9, 1.45, 0.32 * s, 1.0, 2.02, 0.42 * s, 0.05);
    strut(parts, DARK, 1.6, 1.45, 0.32 * s, 1.75, 2.02, 0.42 * s, 0.05);
    wheel(parts, 1.45, 0.85 * s, 0.26);
    strut(parts, METAL, 1.45, 0.26, 0.78 * s, 1.2, 0.72, 0.38 * s, 0.08);
    strut(parts, METAL, 1.45, 0.26, 0.78 * s, 1.8, 0.72, 0.38 * s, 0.06);
  }
  wingPair(parts, color, trim,
    { x0: -2.9, x1: -2.15, y: 1.22, z: 0, t: 0.08 },
    { x0: -2.85, x1: -2.4, y: 1.22, z: 1.25, t: 0.05 }, 0.75);
  fin(parts, color, -2.95, -2.05, -2.98, -2.5, 1.25, 1.75, 0.08);
  fin(parts, trim, -2.98, -2.5, -2.98, -2.7, 1.75, 2.1, 0.06);
  wheel(parts, -2.7, 0, 0.1, 0.08);
  strut(parts, METAL, -2.7, 0.1, 0, -2.5, 1.05, 0, 0.05);
  return { prop: [2.72, 1.05, 0.85] };
}

// High-wing cabin plane standing on two floats.
function buildSeaplane(color, trim, parts) {
  loft(parts, color, [
    [-4.1, 2.25, 0.08, 0.14], [-1.6, 2.05, 0.45, 0.52], [0.2, 1.97, 0.62, 0.7],
    [2.1, 1.92, 0.6, 0.62], [3.35, 1.9, 0.4, 0.42],
  ]);
  loft(parts, DARK, [[3.35, 1.9, 0.33, 0.35], [3.42, 1.9, 0.33, 0.35]]);
  cyl(parts, trim, 0.22, 0.03, 0.45, 'x', 3.63, 1.9, 0, 8);
  // Cabin glass band and windscreen under the wing.
  box(parts, GLASS, 1.8, 0.44, 1.2, 1.0, 2.4, 0);
  wedge(parts, GLASS, 1.9, 2.75, 1.9, 2.0, 2.18, 2.62, 0.6, 0.5, 0.6, 0.56);
  box(parts, trim, 1.9, 0.1, 1.23, 1.15, 1.95, 0);
  wingPair(parts, color, trim,
    { x0: 0.25, x1: 2.05, y: 2.72, z: 0, t: 0.24 },
    { x0: 0.6, x1: 1.85, y: 2.72, z: 5.8, t: 0.12 });
  wingPair(parts, color, trim,
    { x0: -4.1, x1: -3.15, y: 2.3, z: 0, t: 0.1 },
    { x0: -4.0, x1: -3.45, y: 2.3, z: 1.9, t: 0.06 }, 0.8);
  fin(parts, color, -4.15, -2.85, -4.2, -3.55, 2.3, 3.05, 0.1);
  fin(parts, trim, -4.2, -3.55, -4.22, -3.75, 3.05, 3.5, 0.07);
  for (const s of [1, -1]) {
    // Wing struts.
    strut(parts, METAL, 1.6, 1.5, 0.55 * s, 1.5, 2.64, 2.7 * s, 0.07);
    strut(parts, METAL, 0.8, 1.5, 0.55 * s, 0.9, 2.64, 2.7 * s, 0.07);
    // Floats, keel just under the waterline.
    loft(parts, WHITE, [
      [-3.1, 0.42, 0.08, 0.12], [-1.2, 0.3, 0.32, 0.4], [1.6, 0.3, 0.36, 0.44],
      [2.9, 0.46, 0.24, 0.22], [3.4, 0.6, 0.05, 0.05],
    ], 1.35 * s);
    box(parts, trim, 3.6, 0.06, 0.5, 0.2, 0.74, 1.35 * s);
    strut(parts, METAL, 1.7, 0.7, 1.3 * s, 1.7, 1.42, 0.5 * s, 0.09);
    strut(parts, METAL, -0.5, 0.7, 1.3 * s, -0.5, 1.5, 0.45 * s, 0.09);
    strut(parts, METAL, -0.5, 0.7, 1.3 * s, 1.7, 1.42, 0.5 * s, 0.06);
  }
  box(parts, METAL, 0.08, 0.08, 2.7, 1.7, 0.74, 0);
  box(parts, METAL, 0.08, 0.08, 2.7, -0.5, 0.74, 0);
  return { prop: [3.7, 1.9, 1.0] };
}

// Small private jet: swept low wing, T-tail, two engines on the rear fuselage.
function buildJet(color, trim, parts) {
  loft(parts, color, [
    [-6.0, 2.05, 0.18, 0.24], [-4.0, 1.88, 0.6, 0.66], [-1.0, 1.75, 0.85, 0.88],
    [3.0, 1.75, 0.85, 0.88], [4.7, 1.66, 0.62, 0.64], [5.8, 1.52, 0.24, 0.24], [6.25, 1.46, 0.04, 0.04],
  ]);
  // Windscreen and cabin windows.
  wedge(parts, GLASS, 3.35, 5.15, 3.4, 4.0, 1.95, 2.5, 0.76, 0.42, 0.52, 0.4);
  for (let i = 0; i < 5; i++) box(parts, GLASS, 0.36, 0.3, 1.74, 2.3 - i * 0.85, 2.02, 0);
  box(parts, trim, 4.0, 0.12, 1.71, 1.0, 1.58, 0);
  wingPair(parts, color, trim,
    { x0: -1.7, x1: 1.3, y: 1.15, z: 0.5, t: 0.3 },
    { x0: -2.7, x1: -1.75, y: 1.5, z: 5.9, t: 0.1 }, 0.9);
  for (const s of [1, -1]) {
    // Winglets.
    hexa(parts, trim, [
      [-2.7, 1.5, 5.86 * s], [-1.8, 1.5, 5.86 * s], [-1.8, 1.5, 5.94 * s], [-2.7, 1.5, 5.94 * s],
      [-2.95, 2.25, 6.02 * s], [-2.5, 2.25, 6.02 * s], [-2.5, 2.25, 6.08 * s], [-2.95, 2.25, 6.08 * s],
    ]);
    // Engine pods with dark intake and exhaust, on short pylons.
    cyl(parts, color, 0.46, 0.46, 1.9, 'x', -3.5, 2.3, 1.42 * s, 10);
    cyl(parts, METAL, 0.47, 0.47, 0.18, 'x', -2.52, 2.3, 1.42 * s, 10);
    cyl(parts, DARK, 0.38, 0.38, 0.06, 'x', -2.41, 2.3, 1.42 * s, 10);
    cyl(parts, DARK, 0.3, 0.46, 0.5, 'x', -4.7, 2.3, 1.42 * s, 10);
    box(parts, color, 1.2, 0.14, 0.6, -3.5, 2.25, 0.85 * s);
    // Main gear.
    wheel(parts, -0.9, 1.35 * s, 0.32, 0.22);
    strut(parts, METAL, -0.9, 0.32, 1.2 * s, -0.8, 1.12, 1.1 * s, 0.11);
  }
  wheel(parts, 4.3, 0.12, 0.24, 0.12);
  wheel(parts, 4.3, -0.12, 0.24, 0.12);
  strut(parts, METAL, 4.3, 0.24, 0, 4.2, 1.15, 0, 0.1);
  // T-tail.
  fin(parts, color, -6.0, -3.9, -6.6, -5.4, 2.4, 3.8, 0.18);
  wingPair(parts, color, trim,
    { x0: -6.75, x1: -5.4, y: 3.82, z: 0, t: 0.12 },
    { x0: -7.0, x1: -6.4, y: 3.86, z: 2.3, t: 0.06 }, 0.8);
  return { prop: null };
}

// Light utility helicopter: glass bubble, slim tail boom, skids.
function buildHeli(color, trim, parts) {
  loft(parts, color, [[-1.5, 1.4, 0.3, 0.42], [-0.6, 1.32, 0.72, 0.8], [0.45, 1.27, 0.78, 0.86]]);
  loft(parts, GLASS, [
    [0.45, 1.27, 0.78, 0.86], [1.35, 1.2, 0.7, 0.76], [1.95, 1.1, 0.46, 0.48], [2.2, 1.04, 0.14, 0.14],
  ]);
  box(parts, color, 1.5, 0.3, 0.9, 0.5, 0.56, 0); // belly pan under the bubble
  // Engine deck and mast.
  loft(parts, DARK, [[-1.5, 2.2, 0.2, 0.16], [-0.8, 2.25, 0.42, 0.22], [0.3, 2.25, 0.42, 0.22], [0.7, 2.18, 0.2, 0.1]]);
  cyl(parts, METAL, 0.08, 0.08, 0.42, 'y', -0.1, 2.62, 0, 8);
  // Tail boom, fin and stabiliser.
  loft(parts, color, [[-5.75, 1.82, 0.07, 0.08], [-1.3, 1.62, 0.2, 0.24]]);
  fin(parts, trim, -5.95, -5.35, -6.15, -5.8, 1.75, 2.6, 0.09);
  fin(parts, trim, -5.75, -5.4, -5.95, -5.65, 1.85, 1.15, 0.08);
  box(parts, trim, 0.4, 0.05, 1.5, -4.6, 1.78, 0);
  cyl(parts, METAL, 0.05, 0.05, 0.3, 'z', -5.7, 1.85, 0.16, 6);
  for (const s of [1, -1]) {
    box(parts, DARK, 3.3, 0.09, 0.09, 0.25, 0.045, 0.98 * s);
    strut(parts, DARK, 1.9, 0.045, 0.98 * s, 2.15, 0.28, 0.98 * s, 0.09);
    strut(parts, DARK, 1.2, 0.08, 0.98 * s, 1.1, 0.62, 0.45 * s, 0.07);
    strut(parts, DARK, -0.6, 0.08, 0.98 * s, -0.5, 0.66, 0.45 * s, 0.07);
  }
  return {
    prop: null,
    rotor: { x: -0.1, y: 2.84, r: 4.2, blades: 2, chord: 0.24 },
    tailRotor: { x: -5.7, y: 1.85, z: 0.33, r: 0.68 },
  };
}

// Heavy transport helicopter: long cabin, engines on the roof, wheels.
function buildHeavyHeli(color, trim, parts) {
  loft(parts, color, [
    [-3.9, 2.25, 0.4, 0.5], [-2.7, 1.8, 1.05, 1.08], [2.4, 1.72, 1.05, 1.12],
    [3.7, 1.5, 0.86, 0.84], [4.6, 1.3, 0.34, 0.36],
  ]);
  // Cockpit glazing, cabin windows, stripe.
  wedge(parts, GLASS, 2.45, 4.35, 2.5, 3.2, 1.9, 2.74, 1.0, 0.55, 0.78, 0.6);
  for (let i = 0; i < 3; i++) box(parts, GLASS, 0.6, 0.42, 2.12, 1.2 - i * 1.3, 2.1, 0);
  box(parts, trim, 5.0, 0.14, 2.12, -0.15, 1.55, 0);
  // Engine housing, exhausts, mast.
  loft(parts, DARK, [[-2.9, 3.05, 0.3, 0.2], [-1.6, 3.1, 0.66, 0.36], [1.0, 3.1, 0.66, 0.36], [2.0, 2.98, 0.4, 0.2]]);
  for (const s of [1, -1]) cyl(parts, METAL, 0.16, 0.2, 0.5, 'x', -2.2, 3.15, 0.75 * s, 8);
  cyl(parts, METAL, 0.13, 0.13, 0.6, 'y', 0.3, 3.72, 0, 8);
  // Tail boom, swept fin, stabiliser.
  loft(parts, color, [[-8.4, 2.9, 0.12, 0.14], [-3.6, 2.35, 0.4, 0.46]]);
  fin(parts, color, -8.6, -7.6, -9.25, -8.6, 2.8, 4.1, 0.16);
  box(parts, trim, 0.7, 0.07, 1.6, -7.7, 2.9, -0.6);
  cyl(parts, METAL, 0.07, 0.07, 0.4, 'z', -8.9, 3.75, 0.2, 6);
  // Gear on stub sponsons.
  for (const s of [1, -1]) {
    box(parts, color, 1.5, 0.3, 0.7, -1.5, 0.8, 1.2 * s);
    wheel(parts, -1.5, 1.45 * s, 0.38, 0.26);
    strut(parts, METAL, -1.5, 0.38, 1.28 * s, -1.5, 0.8, 1.25 * s, 0.12);
    wheel(parts, 3.1, 0.45 * s, 0.28, 0.18);
    strut(parts, METAL, 3.1, 0.28, 0.3 * s, 3.1, 0.9, 0.3 * s, 0.1);
  }
  return {
    prop: null,
    rotor: { x: 0.3, y: 4.04, r: 6.5, blades: 4, chord: 0.42 },
    tailRotor: { x: -8.9, y: 3.75, z: 0.42, r: 1.1 },
  };
}

const BUILDERS = {
  prop: buildProp, stunt: buildStunt, seaplane: buildSeaplane, jet: buildJet,
  heli: buildHeli, heavyheli: buildHeavyHeli,
};

// ---- caches ---------------------------------------------------------------
const bodyCache = new Map();
const spinCache = new Map();

function bodyEntry(spec, color) {
  const key = spec.id + ':' + color;
  let e = bodyCache.get(key);
  if (!e) {
    const parts = [];
    const build = BUILDERS[spec.id] || (spec.kind === 'heli' ? buildHeli : buildProp);
    const layout = build(color, trimFor(color), parts);
    const geometry = mergeGeometries(parts, false);
    for (const p of parts) p.dispose();
    geometry.computeBoundingSphere();
    e = { geometry, layout };
    bodyCache.set(key, e);
  }
  return e;
}

// Blades radiating in the plane normal to `axis`, plus a blur disc.
function spinGeometry(key, axis, r, blades, chord) {
  let e = spinCache.get(key);
  if (e) return e;
  const parts = [];
  for (let i = 0; i < blades; i++) {
    const len = blades === 2 && i === 0 ? r * 2 : r;
    if (blades === 2 && i === 1) break;
    const g = new THREE.BoxGeometry(len, chord * 0.18, chord);
    if (blades !== 2) g.translate(r / 2, 0, 0);
    g.rotateY((i / blades) * Math.PI * 2);
    parts.push(g);
  }
  parts.push(new THREE.CylinderGeometry(chord * 0.6, chord * 0.6, chord * 0.5, 8));
  const bladesGeo = mergeGeometries(parts.map((p) => (p.index ? p.toNonIndexed() : p)), false);
  const disc = new THREE.CircleGeometry(r, 20);
  disc.rotateX(-Math.PI / 2); // now in the x-z plane, like the blades
  for (const g of [bladesGeo, disc]) {
    if (axis === 'x') g.rotateZ(-Math.PI / 2);
    else if (axis === 'z') g.rotateX(Math.PI / 2);
  }
  e = { blades: bladesGeo, disc };
  spinCache.set(key, e);
  return e;
}

function spinner(key, axis, r, blades, chord) {
  const geo = spinGeometry(key, axis, r, blades, chord);
  const pivot = new THREE.Group();
  const bladeMesh = new THREE.Mesh(geo.blades, MAT.blade);
  const disc = new THREE.Mesh(geo.disc, MAT.disc);
  disc.visible = false;
  disc.renderOrder = 2;
  pivot.add(bladeMesh, disc);
  return { pivot, blades: bladeMesh, disc };
}

// ---- public API -----------------------------------------------------------
export function createAircraftMesh(spec, color) {
  const group = new THREE.Group();
  const col = color == null ? spec.colors[0] : color;
  const entry = bodyEntry(spec, col);
  const body = new THREE.Mesh(entry.geometry, MAT.body);
  group.add(body);

  const lay = entry.layout;
  let prop = null, rotor = null, tailRotor = null;
  if (lay.prop) {
    const [x, y, r] = lay.prop;
    prop = spinner(spec.id + ':prop', 'x', r, 2, 0.17);
    prop.pivot.position.set(x, y, 0);
    group.add(prop.pivot);
  }
  if (lay.rotor) {
    const m = lay.rotor;
    rotor = spinner(spec.id + ':rotor', 'y', m.r, m.blades, m.chord);
    rotor.pivot.position.set(m.x, m.y, 0);
    group.add(rotor.pivot);
    const t = lay.tailRotor;
    tailRotor = spinner(spec.id + ':tail', 'z', t.r, 2, 0.14);
    tailRotor.pivot.position.set(t.x, t.y, t.z);
    group.add(tailRotor.pivot);
  }

  // Yaw about world up, then pitch about the wing axis, then roll about
  // the nose axis (the usual aircraft order).
  group.rotation.order = 'YZX';
  group.userData = { spec, body, prop, rotor, tailRotor };
  return group;
}

// Place the mesh between the previous and current simulation state.
// Euler order YZX: rotation.y = -heading, rotation.z = pitch (nose up),
// rotation.x = roll (right side down). `_time` is accepted for interface
// parity; spin comes from the craft's own propSpin so it is deterministic.
export function updateAircraftMesh(mesh, a, alpha = 1, _time = 0) {
  const px = a.px == null ? a.x : a.px, py = a.py == null ? a.y : a.py, pz = a.pz == null ? a.z : a.pz;
  const ph = a.pheading == null ? a.heading : a.pheading;
  const pp = a.ppitch == null ? a.pitch : a.ppitch, pr = a.proll == null ? a.roll : a.proll;
  const ud = mesh.userData;
  const squat = (a.gearCompress || 0) * 0.12;
  mesh.position.set(px + (a.x - px) * alpha, py + (a.y - py) * alpha - squat, pz + (a.z - pz) * alpha);
  mesh.rotation.set(
    pr + (a.roll - pr) * alpha,
    -(ph + angleDiff(a.heading, ph) * alpha),
    pp + (a.pitch - pp) * alpha,
  );
  const spin = a.propSpin || 0;
  if (ud.prop) {
    const fast = !!a.engineOn && !a.wrecked;
    ud.prop.pivot.rotation.x = spin;
    ud.prop.disc.visible = fast;
    ud.prop.blades.visible = !fast;
  }
  if (ud.rotor) {
    const rs = a.wrecked ? 0 : a.rotorSpeed || 0;
    ud.rotor.pivot.rotation.y = spin;
    ud.rotor.disc.visible = rs > 0.5;
    ud.tailRotor.pivot.rotation.z = spin * 4.3;
    ud.tailRotor.disc.visible = rs > 0.5;
    ud.tailRotor.blades.visible = rs <= 0.5;
  }
}
