// Service vehicle bodies (docs/REVAMP.md 6.11, V1), built from the shared
// car kit: the cab of each is a lofted car style registered with
// addCarStyle (carbody.js), so it gets the kit's paint, glass with its
// cabin, lamps, wheels and damage like every car; the working body behind
// it (the fire truck's locker body and ladder, the ambulance box, the
// garbage hopper and side lift, the tow truck's deck and boom) is merged
// into the same body geometry, so a service vehicle is still 4 draw
// calls plus its light bar (src/render/lightbar.js). Far model: one light
// body of boxes (under 400 triangles).
//
// attachServiceLook(game, sys) hooks the look into the running game: the
// car mesh factory fits service bodies and the new police light bar, and
// sys.render drives the bars, the water jet (40 pooled particles and one
// splash ring), the bin on the garbage truck's arm and dropped bins.
// Everything here is three.js; the rules live in src/systems/service.js.
import * as THREE from 'three';
import { Acc } from './loft.js';
import { addCarStyle, styleFor } from './carbody.js';
import { CLS } from './vehiclemats.js';
import { lightbarGeometry, lightbarState, lastPhase } from './lightbar.js';
import { EXTRAS } from '../entities/servicevehicles.js';
import { createRng } from '../core/rng.js';

const WHITE = 0xffffff;
const TRIM = 0x151618;
const DARK = 0x222326;
const CHROME = 0xd4d7dc;
const ALLOY = 0xa9aeb4;
const SEAM = 0x060607;
const GLASS = 0x0d141a;

// ---- cab styles (the kit's range style, as the truck's cab) ---------------------
// Lengths in metres along the vehicle from the cab's rear wall (m = 0) to
// the nose (m = len); heights as shares of the spec height.
function cabStyle(L, len, o) {
  const x0 = L / 2 - len;
  const t = (m) => (x0 + m) / L;
  const sh = o.shell, nose = o.nose, drop = o.drop;
  const ws = o.ws; // windscreen base, metres behind the nose
  return {
    range: [t(0), 0.5], pF: o.pF || 12, pR: 14, flare: 0.02, q: 5, lean: o.lean || [0.06, 0.03, 0, 0], face: o.face || 'truck',
    top: [[t(0), sh], [t(len - nose), sh], [t(len - nose * 0.35), sh - drop * 0.55], [t(len), sh - drop]],
    belt: [[t(0), sh - 0.02], [t(len - nose), sh - 0.02], [t(len - nose * 0.35), sh - 0.02 - drop * 0.55], [t(len), sh - 0.02 - drop]],
    bottom: [[t(0), o.bottom], [t(len), o.bottom]],
    gh: {
      xC: t(0.04), xR0: t(0.1), xR1: t(len - ws - o.rake), xA: t(len - ws), roof: o.roof, base: 0.95, tumble: 0.06, crown: 0.02,
      side: [t(o.side0), t(len - ws - o.rake - 0.04)], b: o.b != null ? [t(o.b), t(o.b + 0.12)] : null, rear: false,
    },
    seams: o.seams.map(t), hood: null, boot: null, exhaust: null,
  };
}
// Cab length per vehicle (m) and where the working body starts.
export const CAB = { firetruck: 3.1, ambulance: 2.05, garbage: 2.35, towtruck: 3.0 };
addCarStyle('firetruck', cabStyle(9.0, CAB.firetruck, { shell: 0.43, nose: 0.25, drop: 0.08, bottom: 0.2, ws: 0.12, rake: 0.18, roof: 0.88, side0: 0.25, b: 1.38, seams: [1.3, 2.75] }));
addCarStyle('ambulance', cabStyle(6.2, CAB.ambulance, { shell: 0.42, nose: 0.75, drop: 0.13, bottom: 0.2, ws: 0.85, rake: 0.55, roof: 0.82, side0: 0.2, b: null, seams: [1.05], face: 'van', pF: 5, lean: [0.12, 0.05, 0, 0] }));
addCarStyle('garbage', cabStyle(8.2, CAB.garbage, { shell: 0.38, nose: 0.25, drop: 0.07, bottom: 0.17, ws: 0.1, rake: 0.2, roof: 0.8, side0: 0.3, b: null, seams: [2.0] }));
addCarStyle('towtruck', cabStyle(6.8, CAB.towtruck, { shell: 0.5, nose: 1.45, drop: 0.07, bottom: 0.22, ws: 1.5, rake: 0.32, roof: 0.92, side0: 0.15, b: null, seams: [1.2], pF: 8, lean: [0.08, 0.04, 0, 0] }));

// ---- part helpers ---------------------------------------------------------------
const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), E = new THREE.Euler(), P = new THREE.Vector3(), S = new THREE.Vector3();
function place(x, y, z, rx = 0, ry = 0, rz = 0) {
  E.set(rx, ry, rz);
  Q.setFromEuler(E);
  P.set(x, y, z);
  S.set(1, 1, 1);
  return M.compose(P, Q, S);
}
// place() with a scale (sx, sy, sz applied before the rotation).
function placeS(x, y, z, rx, ry, rz, sx, sy, sz) {
  E.set(rx, ry, rz);
  Q.setFromEuler(E);
  P.set(x, y, z);
  S.set(sx, sy, sz);
  return M.compose(P, Q, S);
}
const box = (a, hex, cls, sx, sy, sz, x, y, z, rx = 0, ry = 0, rz = 0) => a.geo(new THREE.BoxGeometry(sx, sy, sz), hex, cls, place(x, y, z, rx, ry, rz));
// Box from x0 to x1, y0 to y1, full width w centred on z.
const slab = (a, hex, cls, x0, x1, y0, y1, w, z = 0) => box(a, hex, cls, x1 - x0, y1 - y0, w, (x0 + x1) / 2, (y0 + y1) / 2, z);
const cylX = (a, hex, cls, r, len, x, y, z, seg = 10) => a.geo(new THREE.CylinderGeometry(r, r, len, seg, 1), hex, cls, place(x, y, z, 0, 0, -Math.PI / 2));
const cylY = (a, hex, cls, r, h, x, y, z, seg = 10) => a.geo(new THREE.CylinderGeometry(r, r, h, seg, 1), hex, cls, place(x, y, z));
const cylZ = (a, hex, cls, r, len, x, y, z, seg = 10) => a.geo(new THREE.CylinderGeometry(r, r, len, seg, 1), hex, cls, place(x, y, z, Math.PI / 2, 0, 0));

// A body skirt from x0 to x1 at y0..y1 on both sides, cut round the
// rear wheel arch at axle x = ax (wheel radius wr).
function skirt(a, hex, cls, x0, x1, y0, y1, w, ax, wr) {
  const cut0 = ax - wr - 0.14, cut1 = ax + wr + 0.14;
  for (const s of [1, -1]) {
    const z = s * (w / 2 - 0.04);
    if (cut0 > x0) slab(a, hex, cls, x0, cut0, y0, y1, 0.08, z);
    if (x1 > cut1) slab(a, hex, cls, cut1, x1, y0, y1, 0.08, z);
    // The arch: a dark wheel well and a lip over it.
    slab(a, TRIM, CLS.TRIM, cut0, cut1, wr * 2 + 0.08, y1, 0.08, z);
    box(a, DARK, CLS.TRIM, cut1 - cut0 + 0.06, 0.05, 0.14, ax, wr * 2 + 0.1, z);
  }
}
// Big truck mirrors on arms, a sun visor and steps (cab-over trucks).
function truckCabBits(a, spec, cabX0, near) {
  const L = spec.length, W = spec.width, H = spec.height;
  const x1 = L / 2;
  for (const s of [1, -1]) {
    const mx = x1 - 0.35, my = Math.min(2.2, H * 0.66);
    box(a, TRIM, CLS.TRIM, 0.04, 0.04, 0.34, mx, my, s * (W / 2 + 0.13));
    box(a, TRIM, CLS.TRIM, 0.07, 0.46, 0.18, mx - 0.02, my - 0.05, s * (W / 2 + 0.31));
    if (near) box(a, CHROME, CLS.CHROME, 0.01, 0.4, 0.15, mx - 0.06, my - 0.05, s * (W / 2 + 0.31));
    box(a, DARK, CLS.TRIM, 0.5, 0.04, 0.22, x1 - 0.95, 0.62, s * (W / 2 - 0.08));
    if (near) box(a, DARK, CLS.TRIM, 0.5, 0.04, 0.2, x1 - 0.95, 0.95, s * (W / 2 - 0.06));
  }
  // Front bumper, tucked under the cab's nose.
  box(a, DARK, CLS.TRIM, 0.2, 0.24, W * 0.97, x1 - 0.14, 0.5, 0);
  if (near) box(a, CHROME, CLS.CHROME, 0.02, 0.05, W * 0.9, x1 - 0.03, 0.56, 0);
  void cabX0;
}
// Rear lamp clusters go in the lamp mesh (see tailLamps); the rear wall
// carries their dark housings.
function rearWall(a, spec, x, y0, y1, hex, cls) {
  slab(a, hex, cls, x - 0.04, x, y0, y1, spec.width * 0.99);
  for (const s of [1, -1]) box(a, TRIM, CLS.TRIM, 0.03, 0.2, 0.5, x - 0.03, 0.55, s * (spec.width / 2 - 0.3));
}

// ---- the working bodies -------------------------------------------------------
// lod 0 near, 1 mid. Returns an Acc of extra body parts (car local frame).
function workBody(spec, lod) {
  const a = new Acc();
  const near = lod === 0;
  const L = spec.length, W = spec.width, H = spec.height, wr = spec.wheelRadius;
  const ax = -spec.wheelBase / 2; // rear axle x
  const xr = -L / 2;
  const cab0 = L / 2 - CAB[spec.id];
  if (spec.id === 'firetruck') {
    const y0 = 1.12, y1 = 2.72, xb1 = cab0 - 0.1;
    // Locker body (paint) with a white stripe and roller-shutter lockers.
    slab(a, WHITE, CLS.PAINT, xr + 0.05, xb1, y0, y1, W * 0.98);
    skirt(a, WHITE, CLS.PAINT, xr + 0.05, xb1, 0.62, y0, W * 0.98, ax, wr);
    slab(a, WHITE, CLS.PAINT, xr + 0.05, xb1, 0.62, y0, W * 0.6);
    for (const s of [1, -1]) {
      const z = s * (W * 0.49 + 0.006);
      box(a, 0xf2f2ee, CLS.LIVERY, xb1 - xr, 0.14, 0.012, (xr + xb1) / 2, 1.0, z);
      box(a, 0xf2f2ee, CLS.LIVERY, CAB.firetruck - 0.05, 0.14, 0.012, cab0 + CAB.firetruck / 2, 1.0, s * (W / 2 + 0.004));
      const lockers = [[xr + 0.25, ax - wr - 0.3], [ax + wr + 0.3, -0.7], [-0.6, xb1 - 0.15]];
      for (const [l0, l1] of lockers) {
        if (l1 - l0 < 0.4) continue;
        box(a, ALLOY, CLS.ALLOY, l1 - l0, y1 - y0 - 0.2, 0.012, (l0 + l1) / 2, (y0 + y1) / 2 + 0.03, z * 1.003);
        if (near) {
          for (let k = 1; k < 10; k++) box(a, 0x7c8188, CLS.TRIM, l1 - l0, 0.012, 0.016, (l0 + l1) / 2, y0 + 0.13 + k * 0.14, z * 1.004);
          box(a, DARK, CLS.TRIM, 0.24, 0.05, 0.03, (l0 + l1) / 2, y0 + 0.16, z * 1.006);
        }
      }
    }
    // Ladder on the roof (two rails, rungs), on brackets.
    const lx0 = xr - 0.25, lx1 = cab0 + 1.4, ly = H + 0.02;
    for (const s of [1, -1]) {
      box(a, CHROME, CLS.CHROME, lx1 - lx0, 0.09, 0.06, (lx0 + lx1) / 2, ly, s * 0.42);
      for (const bx of [xr + 0.4, cab0 - 0.3, cab0 + 1.2]) box(a, DARK, CLS.TRIM, 0.08, ly - y1 + 0.05, 0.08, bx, (ly + y1) / 2, s * 0.42);
    }
    const nr = near ? 18 : 6;
    for (let k = 0; k <= nr; k++) box(a, CHROME, CLS.CHROME, 0.04, 0.04, 0.8, lx0 + 0.1 + (lx1 - lx0 - 0.2) * k / nr, ly, 0);
    // Hose bed and the roof monitor (the water cannon) at the body front.
    slab(a, DARK, CLS.TRIM, -2.4, cab0 - 0.4, y1, y1 + 0.12, W * 0.7);
    cylY(a, ALLOY, CLS.ALLOY, 0.09, 0.45, cab0 - 0.45, y1 + 0.22, 0, near ? 12 : 6);
    cylX(a, WHITE, CLS.PAINT, 0.07, 0.6, cab0 - 0.15, y1 + 0.44, 0, near ? 12 : 6);
    cylX(a, CHROME, CLS.CHROME, 0.05, 0.14, cab0 + 0.2, y1 + 0.44, 0, near ? 10 : 6);
    // Rear: step, wall, hose reel.
    rearWall(a, spec, xr + 0.06, 0.62, y1, ALLOY, CLS.ALLOY);
    box(a, DARK, CLS.TRIM, 0.45, 0.06, W * 0.96, xr - 0.1, 0.62, 0);
    if (near) {
      cylZ(a, 0xc8c2a0, CLS.TRIM, 0.32, 1.1, xr - 0.06, 1.9, 0, 14);
      for (const s of [1, -1]) box(a, CHROME, CLS.CHROME, 0.04, 1.4, 0.04, xr - 0.02, 1.7, s * (W / 2 - 0.12));
    }
    // Pump panel behind the cab, between cab and body.
    slab(a, ALLOY, CLS.CHROME, xb1, cab0 + 0.02, 0.62, y1 - 0.1, W * 0.94);
    truckCabBits(a, spec, cab0, near);
  } else if (spec.id === 'ambulance') {
    const y0 = 0.96, y1 = H, xb1 = cab0 + 0.08;
    // The patient box: white paint, rounded-off corners (posts), a red band.
    slab(a, WHITE, CLS.PAINT, xr + 0.05, xb1, y0, y1, W);
    skirt(a, WHITE, CLS.PAINT, xr + 0.05, xb1, 0.55, y0, W * 0.98, ax, wr);
    for (const s of [1, -1]) {
      const z = s * (W / 2 + 0.006);
      box(a, 0xd0121a, CLS.LIVERY, xb1 - xr - 0.1, 0.34, 0.012, (xr + xb1) / 2, 1.38, z);
      box(a, 0x1d4fa8, CLS.LIVERY, xb1 - xr - 0.1, 0.06, 0.012, (xr + xb1) / 2, 1.62, z);
      box(a, 0xd0121a, CLS.LIVERY, CAB.ambulance - 0.9, 0.16, 0.012, cab0 + 0.55, 1.1, s * (W / 2 - 0.02));
      // The invented Careline mark on the box side: a blue disc with a
      // white wave through it (no cross, no real emblem).
      if (near) {
        a.geo(new THREE.CircleGeometry(0.32, 18), 0x1d4fa8, CLS.LIVERY, place(-1.7, 2.12, z * 1.002, 0, s > 0 ? 0 : Math.PI, 0));
        for (let k = 0; k < 4; k++) box(a, 0xffffff, CLS.LIVERY, 0.16, 0.05, 0.012, -1.92 + k * 0.15, 2.12 + (k % 2 ? 0.05 : -0.05), z * 1.004, 0, 0, k % 2 ? -0.6 : 0.6);
      }
      // Corner posts.
      for (const x of [xr + 0.06, xb1 - 0.02]) box(a, 0xe2e2de, CLS.LIVERY, 0.06, y1 - y0, 0.06, x, (y0 + y1) / 2, s * (W / 2 - 0.02));
    }
    // Kerb-side door with a window, a small window on the other side.
    box(a, GLASS, CLS.GLASS, 0.6, 0.45, 0.014, -0.15, 2.12, W / 2 + 0.008);
    box(a, SEAM, CLS.TRIM, 0.012, y1 - y0 - 0.3, 0.016, 0.35, (y0 + y1) / 2 + 0.05, W / 2 + 0.008);
    box(a, SEAM, CLS.TRIM, 0.012, y1 - y0 - 0.3, 0.016, -0.65, (y0 + y1) / 2 + 0.05, W / 2 + 0.008);
    box(a, GLASS, CLS.GLASS, 0.7, 0.4, 0.014, -1.6, 2.15, -W / 2 - 0.008);
    // Rear doors with windows, grab rails, step.
    rearWall(a, spec, xr + 0.06, 0.55, y1, 0xeeeeea, CLS.LIVERY);
    box(a, SEAM, CLS.TRIM, 0.016, y1 - y0 - 0.2, 0.02, xr + 0.02, (y0 + y1) / 2, 0);
    for (const s of [1, -1]) {
      box(a, GLASS, CLS.GLASS, 0.014, 0.42, 0.62, xr + 0.015, 2.15, s * 0.45);
      box(a, 0xd0121a, CLS.LIVERY, 0.014, 0.3, 0.9, xr + 0.015, 1.38, s * 0.5);
      if (near) box(a, CHROME, CLS.CHROME, 0.04, 0.9, 0.04, xr - 0.02, 1.6, s * (W / 2 - 0.08));
    }
    box(a, DARK, CLS.TRIM, 0.3, 0.06, W * 0.9, xr - 0.08, 0.55, 0);
    // Roof air unit and the cab-to-box step.
    slab(a, ALLOY, CLS.ALLOY, -1.4, -0.4, y1, y1 + 0.16, 0.9);
    slab(a, WHITE, CLS.PAINT, xb1 - 0.05, xb1 + 0.25, H * 0.82 - 0.05, y1 - 0.05, W * 0.9);
    for (const s of [1, -1]) {
      box(a, TRIM, CLS.TRIM, 0.04, 0.3, 0.18, L / 2 - 1.05, 1.62, s * (W / 2 + 0.16));
      if (near) box(a, CHROME, CLS.CHROME, 0.01, 0.26, 0.15, L / 2 - 1.08, 1.62, s * (W / 2 + 0.16));
      box(a, TRIM, CLS.TRIM, 0.04, 0.04, 0.16, L / 2 - 1.0, 1.62, s * (W / 2 + 0.05));
    }
    box(a, DARK, CLS.TRIM, 0.14, 0.24, W * 0.94, L / 2 - 0.1, 0.46, 0);
  } else if (spec.id === 'garbage') {
    const y0 = 1.12, y1 = H - 0.08, xb1 = cab0 - 0.12;
    // Hopper body (paint) with ribs, a rear tailgate, a top lip.
    slab(a, WHITE, CLS.PAINT, xr + 0.75, xb1, y0, y1, W * 0.98);
    skirt(a, DARK, CLS.TRIM, xr + 0.05, xb1, 0.62, y0, W * 0.98, ax, wr);
    slab(a, DARK, CLS.TRIM, xr + 0.05, xb1, 0.62, y0, W * 0.6);
    const nr = near ? 16 : 4;
    for (const s of [1, -1]) {
      for (let k = 0; k <= nr; k++) {
        const x = xr + 0.85 + (xb1 - xr - 1.0) * k / nr;
        box(a, 0x1f5a28, CLS.LIVERY, 0.08, y1 - y0, 0.05, x, (y0 + y1) / 2, s * (W * 0.49 + 0.02));
      }
      box(a, 0xe8e8e2, CLS.LIVERY, xb1 - xr - 0.85, 0.22, 0.012, (xr + 0.75 + xb1) / 2, 1.5, s * (W * 0.49 + 0.05));
    }
    // The hopper's rounded roof and the hazard chevrons on the tailgate.
    a.geo(new THREE.CylinderGeometry(W * 0.49, W * 0.49, xb1 - xr - 0.75, near ? 32 : 8, 1, false, 0, Math.PI), WHITE, CLS.PAINT,
      placeS((xr + 0.75 + xb1) / 2, y1 - 0.02, 0, 0, 0, Math.PI / 2, 0.32, 1, 1));
    if (near) {
      for (let k = 0; k < 6; k++) {
        box(a, k % 2 ? 0x18181a : 0xe8b818, CLS.LIVERY, 0.012, 0.16, 0.5, xr + 0.04, 0.7 + k * 0.001, (k - 2.5) * 0.36, 0.7, 0, 0);
      }
    }
    // Tailgate: the sloping back with its packer.
    const tg = new THREE.BoxGeometry(0.85, y1 - 0.6, W * 0.97);
    a.geo(tg, ALLOY, CLS.ALLOY, place(xr + 0.45, (y1 + 0.6) / 2, 0, 0, 0, -0.16));
    if (near) {
      box(a, DARK, CLS.TRIM, 0.06, 0.9, W * 0.8, xr + 0.08, 1.1, 0, 0, 0, -0.16);
      for (const s of [1, -1]) box(a, CHROME, CLS.CHROME, 0.1, 1.6, 0.1, xr + 0.35, 1.9, s * (W / 2 - 0.1), 0, 0, -0.16);
    }
    // Side loader on the kerb side (+z) behind the cab: its mast and the
    // hopper mouth above it (the arm with the bin is drawn while it runs).
    const lx = cab0 - 0.75;
    box(a, DARK, CLS.TRIM, 0.5, 1.6, 0.18, lx, 1.55, W / 2 + 0.08);
    box(a, 0xe8b818, CLS.LIVERY, 0.52, 0.12, 0.2, lx, 0.8, W / 2 + 0.09);
    slab(a, DARK, CLS.TRIM, lx - 0.55, lx + 0.55, y1 - 0.02, y1 + 0.12, 0.6, W / 2 - 0.35);
    rearWall(a, spec, xr + 0.06, 0.62, 1.0, DARK, CLS.TRIM);
    box(a, DARK, CLS.TRIM, 0.3, 0.06, W * 0.96, xr - 0.06, 0.6, 0);
    if (near) {
      // Packer rams on the tailgate, riding steps and grab rails at the
      // back, side marker lamps, the arm's folded claws, a fuel tank.
      for (const sd of [1, -1]) {
        a.geo(new THREE.CylinderGeometry(0.07, 0.07, 1.5, 20, 1), CHROME, CLS.CHROME, place(xr + 0.95, 2.2, sd * (W / 2 - 0.05), 0, 0, 0.7));
        a.geo(new THREE.CylinderGeometry(0.1, 0.1, 0.9, 20, 1), DARK, CLS.TRIM, place(xr + 1.25, 2.6, sd * (W / 2 - 0.05), 0, 0, 0.7));
        box(a, ALLOY, CLS.ALLOY, 0.35, 0.05, 0.5, xr - 0.12, 0.45, sd * (W / 2 - 0.35));
        a.geo(new THREE.CylinderGeometry(0.025, 0.025, 1.0, 10, 1), CHROME, CLS.CHROME, place(xr - 0.02, 1.4, sd * (W / 2 - 0.2)));
        for (let k = 0; k < 4; k++) box(a, 0xe8a020, CLS.LIVERY, 0.12, 0.06, 0.02, xr + 1.2 + k * 1.5, 1.05, sd * (W * 0.49 + 0.03));
      }
      for (const dz of [-0.25, 0.25]) box(a, 0xe8b818, CLS.LIVERY, 0.08, 0.55, 0.06, lx + 0.1, 1.05, W / 2 + 0.2 + dz * 0.2, 0.3 * Math.sign(dz), 0, 0);
      a.geo(new THREE.CylinderGeometry(0.28, 0.28, 1.2, 28, 1), ALLOY, CLS.CHROME, place(lx - 1.6, 0.85, -(W / 2 - 0.35), 0, 0, Math.PI / 2));
    }
    truckCabBits(a, spec, cab0, near);
  } else if (spec.id === 'towtruck') {
    const yd = 1.12, xb1 = cab0 - 0.06;
    // Deck, side tool lockers, the boom on its base, cable and hook, the
    // underlift with its cross bar at the back.
    slab(a, DARK, CLS.TRIM, xr + 0.3, xb1, 0.9, yd, W * 0.96);
    skirt(a, DARK, CLS.TRIM, xr + 0.3, xb1, 0.62, 0.9, W * 0.96, ax, wr);
    for (const s of [1, -1]) {
      const z = s * (W / 2 - 0.3);
      slab(a, ALLOY, CLS.ALLOY, -0.9, xb1 - 0.05, yd, yd + 0.6, 0.55, z);
      slab(a, ALLOY, CLS.ALLOY, xr + 0.35, ax - wr - 0.2, yd, yd + 0.6, 0.55, z);
      if (near) {
        for (const [l0, l1] of [[-0.9, xb1 - 0.05], [xr + 0.35, ax - wr - 0.2]]) {
          box(a, SEAM, CLS.TRIM, 0.012, 0.5, 0.012, (l0 + l1) / 2, yd + 0.3, s * (W / 2 - 0.02));
          box(a, CHROME, CLS.CHROME, 0.14, 0.03, 0.02, (l0 + l1) / 2 - 0.2, yd + 0.45, s * (W / 2 - 0.02));
        }
      }
      // Mudguards over the rear wheels.
      box(a, TRIM, CLS.TRIM, wr * 2.6, 0.05, 0.42, ax, wr * 2 + 0.08, s * (W / 2 - 0.25));
      // Stabiliser legs at the back.
      box(a, 0xe8b818, CLS.LIVERY, 0.12, 0.5, 0.12, xr + 0.5, 0.65, s * (W / 2 - 0.2));
    }
    // Boom: a yellow arm from the base to the back, with a sheave and cable.
    const bx0 = -0.6, by0 = yd + 0.5, bx1 = xr + 0.2, by1 = 2.55;
    const bl = Math.hypot(bx0 - bx1, by1 - by0), ba = Math.atan2(by1 - by0, bx1 - bx0);
    slab(a, DARK, CLS.TRIM, bx0 - 0.4, bx0 + 0.4, yd, by0 + 0.1, 0.7);
    a.geo(new THREE.BoxGeometry(bl, 0.24, 0.3), WHITE, CLS.PAINT, place((bx0 + bx1) / 2, (by0 + by1) / 2, 0, 0, 0, ba));
    if (near) a.geo(new THREE.BoxGeometry(bl, 0.05, 0.31), 0x1a1a1a, CLS.TRIM, place((bx0 + bx1) / 2, (by0 + by1) / 2 + 0.06, 0, 0, 0, ba));
    cylZ(a, CHROME, CLS.CHROME, 0.18, 0.12, bx1, by1, 0, near ? 14 : 8);
    box(a, 0x303030, CLS.TRIM, 0.02, by1 - 1.0, 0.02, bx1 - 0.18, (by1 + 1.0) / 2, 0);
    box(a, CHROME, CLS.CHROME, 0.12, 0.18, 0.06, bx1 - 0.18, 0.95, 0);
    // Underlift: a low arm reaching back to the hitch, a cross bar and forks.
    slab(a, DARK, CLS.TRIM, xr - 0.9, xr + 0.4, 0.42, 0.58, 0.26);
    box(a, 0xe8b818, CLS.LIVERY, 0.16, 0.14, 1.6, xr - 0.85, 0.5, 0);
    for (const s of [1, -1]) box(a, DARK, CLS.TRIM, 0.5, 0.1, 0.12, xr - 1.05, 0.48, s * 0.62);
    rearWall(a, spec, xr + 0.32, 0.62, yd, DARK, CLS.TRIM);
    // A conventional cab: mirrors on the doors, a front bumper, a grille guard.
    for (const s of [1, -1]) {
      box(a, TRIM, CLS.TRIM, 0.04, 0.42, 0.16, cab0 + 1.38, 1.8, s * (W / 2 + 0.24));
      box(a, TRIM, CLS.TRIM, 0.04, 0.04, 0.26, cab0 + 1.4, 1.8, s * (W / 2 + 0.1));
      if (near) box(a, CHROME, CLS.CHROME, 0.01, 0.38, 0.13, cab0 + 1.35, 1.8, s * (W / 2 + 0.24));
      box(a, DARK, CLS.TRIM, 0.45, 0.04, 0.2, cab0 + 0.9, 0.62, s * (W / 2 - 0.06));
    }
    box(a, CHROME, CLS.CHROME, 0.14, 0.26, W * 0.96, L / 2 - 0.08, 0.55, 0);
    if (near) for (const zz of [-0.45, 0, 0.45]) box(a, DARK, CLS.TRIM, 0.05, 0.5, 0.05, L / 2 - 0.02, 0.9, zz);
    // Exhaust stack behind the cab.
    cylY(a, CHROME, CLS.CHROME, 0.06, 1.2, cab0 - 0.12, 2.05, -(W / 2 - 0.3), near ? 10 : 6);
  }
  return a;
}

// Far model: a few boxes and simple tyres, baked lamp blocks (one call).
function farBody(spec) {
  const a = new Acc();
  const L = spec.length, W = spec.width, H = spec.height, wr = spec.wheelRadius;
  const cab = CAB[spec.id], cab0 = L / 2 - cab;
  const S = styleFor(spec);
  const roofH = S.gh.roof * H;
  // Cab.
  slab(a, WHITE, CLS.PAINT, cab0, L / 2, 0.45, roofH, W * 0.96);
  box(a, GLASS, CLS.GLASS, 0.03, roofH * 0.3, W * 0.85, L / 2 + 0.005, roofH * 0.78, 0);
  const work = { firetruck: [WHITE, CLS.PAINT, 0.62, 2.72], ambulance: [WHITE, CLS.PAINT, 0.6, H], garbage: [WHITE, CLS.PAINT, 0.62, H - 0.08], towtruck: [DARK, CLS.TRIM, 0.6, 1.2] }[spec.id];
  slab(a, work[0], work[1], -L / 2, cab0, work[2], work[3], W * 0.98);
  if (spec.id === 'ambulance') for (const s of [1, -1]) box(a, 0xd0121a, CLS.LIVERY, cab0 + L / 2 - 0.1, 0.32, 0.01, (cab0 - L / 2) / 2, 1.38, s * (W / 2 + 0.006));
  if (spec.id === 'firetruck') box(a, CHROME, CLS.TRIM, L * 0.7, 0.1, 0.9, -0.6, H + 0.02, 0);
  if (spec.id === 'towtruck') a.geo(new THREE.BoxGeometry(2.6, 0.24, 0.3), WHITE, CLS.PAINT, place(-2.0, 2.0, 0, 0, 0, Math.atan2(0.9, -2.5)));
  for (const wx of [spec.wheelBase / 2, -spec.wheelBase / 2]) {
    for (const s of [1, -1]) a.geo(new THREE.CylinderGeometry(wr, wr, 0.36, 8, 1), 0x151516, CLS.RUBBER, place(wx, wr, s * (W / 2 - 0.22), Math.PI / 2, 0, 0));
  }
  for (const s of [1, -1]) {
    box(a, 0xdfe6ee, CLS.GLOW, 0.04, 0.14, 0.3, L / 2 + 0.03, 0.75, s * (W / 2 - 0.35));
    box(a, 0xd01818, CLS.GLOW, 0.04, 0.16, 0.24, -L / 2 - 0.02, 0.6, s * (W / 2 - 0.25));
  }
  return a;
}

// Tail lamps (the kit's tail half of the lamp strip: cells 8 red left,
// 9 reverse, 10 indicator, 11 red right). Appended to the cab's lamps.
function tailLamps(spec, lite) {
  const a = new Acc();
  const L = spec.length, W = spec.width;
  const x = -L / 2 - (spec.id === 'towtruck' ? -0.27 : 0.01);
  const ys = spec.id === 'ambulance' ? [0.62, 2.55] : [0.55];
  const cell = (c) => 0.5 + (c + 0.5) / 16;
  for (const y of ys) {
    for (const s of [1, -1]) {
      const z = s * (W / 2 - 0.22);
      const tall = y > 1;
      a.geo(new THREE.BoxGeometry(0.04, tall ? 0.22 : 0.13, tall ? 0.12 : 0.22), WHITE, 0, place(x, y, z), cell(s > 0 ? 11 : 8), 0.5);
      if (lite || tall) continue;
      a.geo(new THREE.BoxGeometry(0.04, 0.1, 0.1), WHITE, 0, place(x, y, z - s * 0.18), cell(9), 0.5);
      a.geo(new THREE.BoxGeometry(0.04, 0.1, 0.1), WHITE, 0, place(x, y, z + s * 0.17), cell(10), 0.5);
    }
  }
  return a;
}

// ---- merging into the kit's geometries ---------------------------------------
function concat(base, acc) {
  const ex = acc.build();
  const g = new THREE.BufferGeometry();
  const names = ['position', 'normal', 'color', 'aCls', 'uv'];
  const n0 = base.attributes.position.count, n1 = ex.attributes.position.count;
  for (const k of names) {
    const A = base.attributes[k], B = ex.attributes[k];
    if (!A || !B) continue;
    const arr = new Float32Array((n0 + n1) * A.itemSize);
    arr.set(A.array.subarray(0, n0 * A.itemSize), 0);
    arr.set(B.array.subarray(0, n1 * B.itemSize), n0 * A.itemSize);
    g.setAttribute(k, new THREE.BufferAttribute(arr, A.itemSize));
  }
  const ia = base.index.array, ib = ex.index.array;
  const n = n0 + n1;
  const idx = n > 65535 ? new Uint32Array(ia.length + ib.length) : new Uint16Array(ia.length + ib.length);
  idx.set(ia, 0);
  for (let i = 0; i < ib.length; i++) idx[ia.length + i] = ib[i] + n0;
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  // Lamp geometries carry two relative morph targets (crumple): the new
  // lamps simply do not move.
  if (base.morphAttributes && base.morphAttributes.position) {
    g.morphAttributes.position = base.morphAttributes.position.map((m) => {
      const arr = new Float32Array(n * 3);
      arr.set(m.array.subarray(0, n0 * 3), 0);
      return new THREE.BufferAttribute(arr, 3);
    });
    g.morphTargetsRelative = true;
  }
  ex.dispose();
  g.computeBoundingSphere();
  g.computeBoundingBox();
  return g;
}

const fitted = new Map();
function fittedFor(spec, ud) {
  let f = fitted.get(spec.id);
  if (f) return f;
  const near = concat(ud.body.geometry, workBody(spec, 0));
  const mid = concat(ud.bodyMid.geometry, workBody(spec, 1));
  const far = farBody(spec).build();
  const lampNear = concat(ud.lampLevels[0].geometry, tailLamps(spec, false));
  const lampMid = concat(ud.lampLevels[1].geometry, tailLamps(spec, true));
  const W = spec.width, H = spec.height, L = spec.length;
  const cab0 = L / 2 - CAB[spec.id];
  const roofY = styleFor(spec).gh.roof * H + 0.02;
  const cabX = cab0 + CAB[spec.id] * (spec.id === 'towtruck' ? 0.32 : 0.55);
  let barMount;
  if (spec.id === 'ambulance') barMount = { W, H, boxX0: -L / 2 + 0.05, boxX1: cab0 + 0.08, cabX: cab0 + 0.45, cabY: roofY, noseX: L / 2 + 0.03, noseY: 0.82 };
  else if (spec.id === 'firetruck') barMount = { W, cabX, cabY: roofY, sideX0: cab0 - 0.4, sideX1: -L / 2 + 0.35, sideY: 2.45, rearX: -L / 2 - 0.02, rearY: 2.4 };
  else if (spec.id === 'garbage') barMount = { W, cabX, cabY: roofY, rearX: -L / 2 + 0.02, rearY: H - 0.3 };
  else barMount = { W, cabX, cabY: roofY };
  f = { near, mid, far, lampNear, lampMid, bar: lightbarGeometry(spec.id, barMount) };
  fitted.set(spec.id, f);
  return f;
}

let policeBar = null;
// Fit a car mesh made by createVehicleMesh: a service body, or the new
// police light bar in place of the old one (same mesh, same LOD link).
export function fitServiceMesh(mesh, spec) {
  const ud = mesh && mesh.userData;
  if (!ud || !spec) return mesh;
  if (spec.id === 'police' && ud.bar) {
    if (!policeBar) {
      const a = ud.anchors;
      policeBar = lightbarGeometry('police', { head: a.head, roofX: a.roofX, roofY: a.roofY - 0.01 });
    }
    ud.bar.geometry = policeBar;
    ud.svcBar = ud.bar;
    ud.svcBarId = 'police';
    return mesh;
  }
  if (!spec.service) return mesh;
  const f = fittedFor(spec, ud);
  ud.body.geometry = f.near;
  ud.bodyMid.geometry = f.mid;
  ud.far.geometry = f.far;
  ud.lampLevels[0].geometry = f.lampNear;
  ud.lampLevels[1].geometry = f.lampMid;
  const bar = new THREE.Mesh(f.bar, lightbarState(spec.id, { siren: false, beacon: false }, 0, false));
  bar.name = 'rw-svcbar';
  ud.rig.add(bar);
  ud.svcBar = bar;
  ud.svcBarId = spec.id;
  // The kit's LOD switch shows the near parts or the far body; the bar
  // goes with the near parts (render() reads ud.lodFar).
  return mesh;
}

// Triangle counts of a service vehicle as drawn (SV-M1): near and mid
// whole vehicle (body, glass, lamps, four wheels), far body, light bar.
export function serviceStats(mesh) {
  const ud = mesh.userData;
  const t = (g) => (g && g.index ? g.index.count / 3 : 0);
  const wheel = t(ud.wheelLevels[0].geometry), wheelMid = t(ud.wheelLevels[1].geometry);
  return {
    near: t(ud.body.geometry) + t(ud.glassLevels[0].geometry) + t(ud.lampLevels[0].geometry) + 4 * wheel,
    mid: t(ud.bodyMid.geometry) + t(ud.glassLevels[1].geometry) + t(ud.lampLevels[1].geometry) + 4 * wheelMid,
    far: t(ud.far.geometry),
    bar: t(ud.svcBar && ud.svcBar.geometry),
  };
}

// ---- the running look -----------------------------------------------------------
const JET_N = EXTRAS.cannon.particles;
export function attachServiceLook(game, sys) {
  const car = game.kinds && game.kinds.car;
  if (car && !car.serviceFitted) {
    const make = car.createMesh;
    car.createMesh = (spec, color) => fitServiceMesh(make(spec, color), spec);
    car.serviceFitted = true;
  }
  const scene = game.scene;
  const rng = createRng(4471);
  // Water jet: pooled droplets in one instanced mesh, a splash ring.
  const dropMat = new THREE.MeshStandardMaterial({ color: 0xe2f2fb, transparent: true, opacity: 0.82, roughness: 0.08, metalness: 0, emissive: 0x6a8fa8, emissiveIntensity: 0.55 });
  const drops = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(0.22, 1), dropMat, JET_N);
  drops.frustumCulled = false;
  drops.visible = false;
  drops.name = 'rw-jet';
  drops.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  const jit = new Float32Array(JET_N * 3);
  for (let i = 0; i < jit.length; i++) jit[i] = rng.next() * 2 - 1;
  const splash = new THREE.Mesh(new THREE.RingGeometry(0.4, 1.0, 20), new THREE.MeshBasicMaterial({ color: 0xe8f4fa, transparent: true, opacity: 0.55, depthWrite: false, side: THREE.DoubleSide }));
  splash.rotation.x = -Math.PI / 2;
  splash.visible = false;
  splash.name = 'rw-splash';
  // The bin on the side lift (arm, bin, lid) and dropped bins: unit boxes.
  const unit = new THREE.BoxGeometry(1, 1, 1);
  const armMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.6, metalness: 0.1 });
  const arm = new THREE.InstancedMesh(unit, armMat, 3);
  arm.frustumCulled = false;
  arm.visible = false;
  arm.name = 'rw-binlift';
  arm.setColorAt(0, new THREE.Color(0x1d1e20));
  arm.setColorAt(1, new THREE.Color(0x3a6ea5));
  arm.setColorAt(2, new THREE.Color(0x24486e));
  const fallen = new THREE.InstancedMesh(unit, armMat, 6);
  fallen.frustumCulled = false;
  fallen.count = 0;
  fallen.name = 'rw-bins';
  for (let i = 0; i < 6; i++) fallen.setColorAt(i, new THREE.Color(0x3a6ea5));
  scene.add(drops, splash, arm, fallen);
  sys.look = { drops, splash, arm, fallen };

  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), p = new THREE.Vector3(), s = new THREE.Vector3();
  const p2 = new THREE.Vector3(), UP = new THREE.Vector3(0, 1, 0);
  let reducedMedia = false;
  try {
    reducedMedia = typeof window !== 'undefined' && !!window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch { reducedMedia = false; }
  let jetT = 0;

  function drawJet(v, dt) {
    const sv = v.svc;
    if (!sv || !sv.spray || !(sv.jetLen > 0.5) || !v.mesh) {
      drops.visible = false;
      splash.visible = false;
      return;
    }
    jetT += dt;
    const a = v.heading + sv.jetYaw;
    const dx = Math.cos(a), dz = Math.sin(a);
    const ch = Math.cos(v.heading), sh = Math.sin(v.heading);
    const nx = v.x + ch * (v.spec.length / 2 - CAB.firetruck + 0.35), nz = v.z + sh * (v.spec.length / 2 - CAB.firetruck + 0.35);
    const ny = 2.72 + 0.44;
    const len = sv.jetLen;
    // A ballistic arc that lands at the jet's reach.
    const T = len / 24;
    const vy = (0.4 - ny + 0.5 * 9.8 * T * T) / T;
    for (let i = 0; i < JET_N; i++) {
      const u = ((jetT * 1.6 + i / JET_N) % 1);
      const t = u * T;
      const spread = 0.05 + u * 0.5;
      p.set(nx + dx * 24 * t - dz * jit[i * 3] * spread, ny + vy * t - 4.9 * t * t + jit[i * 3 + 1] * spread * 0.5, nz + dz * 24 * t + dx * jit[i * 3] * spread);
      const k = 0.7 + u * 1.9;
      s.set(k * 2.6, k, k);
      e.set(0, -a, 0);
      q.setFromEuler(e);
      m4.compose(p, q, s);
      drops.setMatrixAt(i, m4);
    }
    drops.instanceMatrix.needsUpdate = true;
    drops.visible = true;
    splash.position.set(nx + dx * len, 0.06, nz + dz * len);
    const pulse = 1 + 0.25 * Math.sin(jetT * 17);
    splash.scale.set(1.6 * pulse, 1.6 * pulse, 1);
    splash.visible = true;
  }

  function drawLift(v) {
    const sv = v.svc;
    if (!sv || !(sv.lift > 0) || sv.liftMode !== 1) {
      arm.visible = false;
      return;
    }
    const W = v.spec.width, H = v.spec.height;
    const ch = Math.cos(v.heading), sh = Math.sin(v.heading);
    const lx = v.spec.length / 2 - CAB.garbage - 0.75;
    // The bin's ground place in the truck's frame, then up the side, over the top.
    const bx = sv.binX - v.x, bz = sv.binZ - v.z;
    const gx = bx * ch + bz * sh, gz = -bx * sh + bz * ch;
    const t = sv.lift, L = EXTRAS.lift;
    let x, y, z, tip;
    const smooth = (k) => k * k * (3 - 2 * k);
    if (t < L.raise) {
      const k = smooth(t / L.raise);
      x = gx + (lx - gx) * k; z = gz + (W / 2 + 0.45 - gz) * k; y = 0.55 + (H - 0.6) * k; tip = 0;
    } else if (t < L.raise + L.tip) {
      const k = (t - L.raise) / L.tip;
      x = lx; z = W / 2 + 0.45 - 0.5 * Math.sin(Math.PI * k); y = H - 0.05 + 0.35 * Math.sin(Math.PI * k); tip = 2.3 * Math.sin(Math.PI * k);
    } else {
      const k = smooth((t - L.raise - L.tip) / L.lower);
      x = lx + (gx - lx) * k; z = W / 2 + 0.45 + (gz - W / 2 - 0.45) * k; y = H - 0.05 - (H - 0.6) * k; tip = 0;
    }
    const wx = v.x + x * ch - z * sh, wz = v.z + x * sh + z * ch;
    // Bin body and lid (tipped about the truck's long axis, toward the hopper).
    e.set(-tip, -v.heading, 0, 'YXZ');
    q.setFromEuler(e);
    p.set(wx, y, wz);
    s.set(0.62, 1.05, 0.62);
    m4.compose(p, q, s);
    arm.setMatrixAt(1, m4);
    p2.set(0, 0.56, 0).applyQuaternion(q);
    p.set(wx + p2.x, y + p2.y, wz + p2.z);
    s.set(0.66, 0.07, 0.66);
    m4.compose(p, q, s);
    arm.setMatrixAt(2, m4);
    // Arm from the mast to the bin.
    const mx = v.x + lx * ch - (W / 2 + 0.1) * sh, mz = v.z + lx * sh + (W / 2 + 0.1) * ch, my = 1.4;
    const ax = wx - mx, ay = y - my, az = wz - mz, al = Math.hypot(ax, ay, az) || 0.01;
    p.set((wx + mx) / 2, (y + my) / 2, (wz + mz) / 2);
    q.setFromUnitVectors(UP, p2.set(ax / al, ay / al, az / al));
    s.set(0.14, al, 0.14);
    m4.compose(p, q, s);
    arm.setMatrixAt(0, m4);
    arm.instanceMatrix.needsUpdate = true;
    arm.visible = true;
  }

  function drawFallen() {
    const list = sys.tipped;
    fallen.count = list.length;
    for (let i = 0; i < list.length; i++) {
      const b = list[i];
      e.set(Math.PI / 2, -b.h, 0, 'YXZ');
      q.setFromEuler(e);
      p.set(b.x, 0.31, b.z);
      s.set(0.62, 1.05, 0.62);
      m4.compose(p, q, s);
      fallen.setMatrixAt(i, m4);
    }
    fallen.instanceMatrix.needsUpdate = true;
  }

  sys.render = (alpha, dt) => {
    const vs = game.vehicles;
    const reduced = reducedMedia || !!(game.progress && game.progress.settings && game.progress.settings.reduceMotion === true);
    const t = game.time || 0;
    let jetDone = false, liftDone = false;
    for (let i = 0; i < vs.length; i++) {
      const v = vs[i];
      const ud = v.mesh && v.mesh.userData;
      if (!ud || !ud.svcBar) continue;
      const bar = ud.svcBar;
      bar.material = lightbarState(ud.svcBarId, v, t, reduced);
      if (ud.svcBarId === 'police') {
        // The effects glow (render/effects.js) follows the lit half.
        const on = !v.wrecked && !!v.siren;
        ud.sirenPhase = !on ? -1 : lastPhase.mask & 1 ? 0 : lastPhase.mask & 2 ? 1 : -1;
      } else bar.visible = !ud.lodFar;
      if (!jetDone && v.svc && v.svc.spray) { drawJet(v, dt || 0); jetDone = true; }
      if (!liftDone && v.svc && v.svc.lift > 0 && v.svc.liftMode === 1) { drawLift(v); liftDone = true; }
    }
    if (!jetDone) { drops.visible = false; splash.visible = false; }
    if (!liftDone) arm.visible = false;
    drawFallen();
    void alpha;
  };
  return sys;
}
