// Procedural car bodies lofted from a few control curves per style.
// A body is a lower shell (plan-view superellipse, side profile curves,
// wheel arches cut into the sill line, a rounded shoulder and top) and a
// greenhouse lofted on top of it (windscreen, roof, rear glass, side
// glass between pillars). Panel details (lamps, grille, seams, livery)
// are picked per face from the same grid, so nothing floats or cracks.
// All styles are invented; none copies a real vehicle.
import * as THREE from 'three';
import { Acc, emitGrid, curve, uniqSorted, lin, spow, lathe } from './loft.js';
import { CLS } from './vehiclemats.js';

const WHITE = 0xffffff;
const SEAM = 0x0a0a0b;
const TRIM = 0x151618;
const GRILLE = 0x0e0f10;
const GLASS = 0x0b1116;
const LINER = 0x262626;
const CHROME = 0xd8dade;
const PLATE = 0xe6e4da;
const ARCH = 0x0b0b0b;

// ---- styles -------------------------------------------------------------------
// Curves are over t = x / L (rear -0.5 .. front 0.5); heights are
// fractions of H. gh: greenhouse stations (t) xC rear base, xR0 roof
// rear, xR1 roof front, xA windscreen base; side: side-glass span; b:
// B-pillar span. seams: door shut lines (t).
const STYLES = {
  sedan: {
    pF: 5, pR: 5.5, flare: 0.015, drop: 0.075,
    top: [[-0.5, 0.47], [-0.485, 0.56], [-0.45, 0.63], [-0.39, 0.66], [-0.3, 0.665], [-0.2, 0.66], [0.2, 0.63], [0.3, 0.61], [0.4, 0.578], [0.46, 0.545], [0.49, 0.51], [0.5, 0.47]],
    bottom: [[-0.5, 0.22], [-0.46, 0.13], [0.44, 0.13], [0.5, 0.2]],
    gh: { xC: -0.345, xR0: -0.175, xR1: 0.055, xA: 0.235, roof: 1, base: 0.9, tumble: 0.16, crown: 0.03, side: [-0.275, 0.15], b: [-0.075, -0.05], rear: true },
    seams: [0.205, -0.062, -0.205], hood: 0.22, boot: -0.36,
    head: { bands: [3], z: [0.46, 0.96], ind: 0.88 }, tail: { bands: [3, 4], z: [0.42, 0.97], rev: 0.56 },
    grille: { bands: [1, 2], z: 0.46 }, intake: 0.75, exhaust: { n: 1, z: 0.3 },
  },
  hatch: {
    pF: 4.6, pR: 7, flare: 0.02, drop: 0.07,
    top: [[-0.5, 0.56], [-0.485, 0.64], [-0.45, 0.665], [-0.3, 0.665], [0.15, 0.64], [0.26, 0.615], [0.36, 0.585], [0.45, 0.545], [0.49, 0.505], [0.5, 0.47]],
    bottom: [[-0.5, 0.2], [-0.46, 0.12], [0.44, 0.12], [0.5, 0.19]],
    gh: { xC: -0.478, xR0: -0.43, xR1: 0.03, xA: 0.205, roof: 1, base: 0.9, tumble: 0.15, crown: 0.03, side: [-0.395, 0.125], b: [-0.095, -0.07], rear: true },
    seams: [0.185, -0.085, -0.215], hood: 0.19, boot: null,
    head: { bands: [3], z: [0.46, 0.96], ind: 0.88 }, tail: { bands: [3, 4], z: [0.55, 0.98], rev: 0.68 },
    grille: { bands: [2], z: 0.46 }, intake: 0.75, exhaust: { n: 1, z: 0.32 }, roofSpoiler: true,
  },
  sports: {
    pF: 4, pR: 5.5, flare: 0.05, drop: 0.085,
    top: [[-0.5, 0.52], [-0.485, 0.6], [-0.45, 0.66], [-0.38, 0.69], [-0.3, 0.685], [-0.12, 0.65], [0.1, 0.62], [0.24, 0.6], [0.36, 0.56], [0.45, 0.48], [0.49, 0.42], [0.5, 0.38]],
    bottom: [[-0.5, 0.2], [-0.46, 0.11], [0.44, 0.11], [0.5, 0.13]],
    gh: { xC: -0.34, xR0: -0.115, xR1: -0.01, xA: 0.175, roof: 1, base: 0.85, tumble: 0.2, crown: 0.025, side: [-0.25, 0.135], b: null, rear: true },
    seams: [0.15, -0.19], hood: 0.165, boot: -0.37,
    head: { bands: [3], z: [0.46, 0.94], ind: 0.86 }, tail: { bands: [3], z: [0.3, 0.97], rev: 0.4 },
    grille: { bands: [1, 2], z: 0.46 }, intake: 0.75, exhaust: { n: 2, z: 0.2 }, wing: true, skirt: true,
  },
  muscle: {
    pF: 7, pR: 7, flare: 0.05, drop: 0.085,
    top: [[-0.5, 0.5], [-0.485, 0.58], [-0.45, 0.63], [-0.4, 0.645], [-0.3, 0.645], [-0.1, 0.632], [0.1, 0.605], [0.3, 0.6], [0.43, 0.585], [0.48, 0.56], [0.5, 0.52]],
    bottom: [[-0.5, 0.21], [-0.46, 0.12], [0.44, 0.12], [0.5, 0.18]],
    gh: { xC: -0.335, xR0: -0.19, xR1: -0.04, xA: 0.105, roof: 1, base: 0.88, tumble: 0.18, crown: 0.025, side: [-0.26, 0.075], b: null, rear: true },
    seams: [0.085, -0.225], hood: 0.09, boot: -0.37,
    head: { bands: [3], z: [0.46, 0.9], ind: 2 }, tail: { bands: [3], z: [0.2, 0.96], rev: 0.32 },
    grille: { bands: [2], z: 0.46 }, intake: 0.75, exhaust: { n: 2, z: 0.36 }, scoop: true, ducktail: true,
  },
  pickup: {
    pF: 6.5, pR: 10, flare: 0.035, drop: 0.07,
    top: [[-0.5, 0.6], [-0.495, 0.615], [-0.48, 0.62], [-0.1, 0.62], [0.1, 0.612], [0.24, 0.59], [0.38, 0.565], [0.46, 0.54], [0.49, 0.51], [0.5, 0.48]],
    bottom: [[-0.5, 0.25], [-0.47, 0.2], [0.44, 0.2], [0.5, 0.24]],
    bed: [-0.478, -0.112], floor: 0.45,
    gh: { xC: -0.106, xR0: -0.096, xR1: 0.07, xA: 0.205, roof: 1, base: 0.92, tumble: 0.1, crown: 0.025, side: [-0.085, 0.145], b: [0.015, 0.035], rear: true },
    seams: [0.15, 0.025, -0.095], hood: 0.19, boot: null,
    head: { bands: [2, 3], z: [0.46, 0.95], ind: 0.88 }, tail: { bands: [2, 3], z: [0.78, 0.99], rev: 0.86 },
    grille: { bands: [1, 2, 3], z: 0.46 }, intake: 0.75, exhaust: { n: 1, z: 0.5 }, skirt: true,
  },
  van: {
    pF: 4.5, pR: 11, flare: 0.012, drop: 0.05,
    top: [[-0.5, 0.48], [-0.495, 0.5], [0.3, 0.5], [0.36, 0.48], [0.42, 0.44], [0.47, 0.39], [0.5, 0.35]],
    bottom: [[-0.5, 0.17], [-0.47, 0.14], [0.44, 0.14], [0.5, 0.19]],
    gh: { xC: -0.495, xR0: -0.485, xR1: 0.19, xA: 0.37, roof: 1, base: 0.94, tumble: 0.07, crown: 0.02, side: [0.15, 0.33], b: null, rear: true, rearSide: [-0.46, -0.24] },
    seams: [0.15, 0.1, -0.2], hood: 0.355, boot: null,
    head: { bands: [3], z: [0.46, 0.95], ind: 0.86 }, tail: { bands: [2, 3], z: [0.8, 0.99], rev: 0.88 },
    grille: { bands: [2, 3], z: 0.46 }, intake: 0.75, exhaust: { n: 1, z: 0.5 },
  },
  truck: {
    range: [0.2, 0.5], pF: 12, pR: 14, flare: 0.02, drop: 0.035,
    top: [[0.2, 0.47], [0.45, 0.47], [0.48, 0.455], [0.5, 0.42]],
    bottom: [[0.2, 0.22], [0.5, 0.22]],
    gh: { xC: 0.207, xR0: 0.213, xR1: 0.44, xA: 0.487, roof: 0.88, base: 0.95, tumble: 0.06, crown: 0.02, side: [0.36, 0.445], b: null, rear: false },
    seams: [0.36, 0.265], hood: null, boot: null,
    head: { bands: [1], z: [0.46, 0.94], ind: 0.86 }, tail: null,
    grille: { bands: [2, 3], z: 0.61 }, intake: 0.75, exhaust: null,
  },
};
STYLES.compact = STYLES.hatch;
STYLES.coupe = STYLES.sports;
STYLES.taxi = STYLES.sedan;
STYLES.police = STYLES.sedan;

export function styleFor(spec) {
  return STYLES[spec.id] || STYLES[spec.body] || STYLES.sedan;
}

// Tyre width per spec.
export function tyreWidth(spec) {
  if (spec.body === 'truck') return 0.4;
  if (spec.id === 'sports' || spec.id === 'muscle') return 0.3;
  if (spec.body === 'pickup' || spec.body === 'van') return 0.28;
  return 0.25;
}

export function wheelLayout(spec) {
  const wr = spec.wheelRadius || 0.33;
  const tw = tyreWidth(spec);
  const ax = spec.wheelBase / 2;
  const az = spec.width / 2 - tw / 2 - 0.03;
  return { wr, tw, ax, az };
}

// Resolve a style against a spec into absolute functions of x.
function shape(spec) {
  const S = styleFor(spec);
  const L = spec.length, W = spec.width, H = spec.height;
  const hw = W / 2;
  const { wr, ax } = wheelLayout(spec);
  const range = S.range || [-0.5, 0.5];
  const x0 = range[0] * L, x1 = range[1] * L;
  const mid = (x0 + x1) / 2;
  const hf = x1 - mid, hr = mid - x0;
  const topC = curve(S.top), botC = curve(S.bottom);
  const R = wr * 1.06 + 0.03; // arch radius: hugs the tyre
  const wheels = [ax, -ax].filter((wx) => wx - R > x0 + 0.05 && wx + R < x1 - 0.05);
  const bed = S.bed ? [S.bed[0] * L, S.bed[1] * L] : null;
  const planW = (x) => {
    const t = x >= mid ? (x - mid) / hf : (mid - x) / hr;
    const p = x >= mid ? S.pF : S.pR;
    let w = hw * Math.pow(Math.max(0, 1 - Math.pow(Math.min(1, t), p)), 1 / p);
    for (const wx of wheels) {
      const u = (x - wx) / (R * 1.6);
      if (Math.abs(u) < 1) w += S.flare * W * (1 - u * u) * (1 - u * u) * (w / hw);
    }
    return w;
  };
  const drop = S.drop * H;
  // Fenders rise over the wheels where the body is lower than the arch.
  const archTop = wr + R;
  const need = (x) => {
    let n = 0;
    for (const wx of wheels) {
      const u = Math.abs(x - wx) / (R * 1.7);
      if (u < 1) {
        const f = Math.max(0, (u - 0.3) / 0.7);
        const k = 1 - f * f * (3 - 2 * f);
        n = Math.max(n, (archTop + 0.05) * k);
      }
    }
    return n;
  };
  const ycBase = (x) => topC(x / L) * H - drop * Math.min(1, 0.4 + 0.6 * Math.min(1, planW(x) / (hw * 0.5)));
  const yc = (x) => Math.max(ycBase(x), need(x));
  const top = (x) => Math.max(topC(x / L) * H, yc(x) - 0.1);
  const bottom = (x) => {
    let y = botC(x / L) * H;
    for (const wx of wheels) {
      const d = x - wx;
      if (Math.abs(d) <= R) y = Math.max(y, wr + Math.sqrt(Math.max(0, R * R - d * d)));
    }
    return Math.min(y, yc(x) - 0.06);
  };
  // Inverse of the plan superellipse: x where w = f * hw (front/rear).
  const tipX = (f, front) => {
    const p = front ? S.pF : S.pR;
    const e = Math.pow(Math.max(0, 1 - Math.pow(f, p)), 1 / p);
    return front ? mid + hf * e : mid - hr * e;
  };
  return { S, L, W, H, hw, wr, R, wheels, x0, x1, mid, planW, top, yc, bottom, tipX, bed, inBed: (x) => bed && x > bed[0] && x < bed[1] };
}

const Q = 2.6; // superellipse exponent of the body shoulder / top
// Side section (fraction of the sill-to-shoulder height, fraction of the
// plan half width): tucked-under sill, a full lower door, a small step
// that reads as a character line, then the shoulder.
const SIDE_NEAR = [[0, 0.92], [0.07, 0.96], [0.18, 0.985], [0.36, 0.997], [0.54, 1], [0.7, 0.998], [0.735, 0.986], [0.86, 0.988], [1, 0.972]];
const SIDE_FAR = [[0, 0.96], [1, 0.985]];

// Half ring of the lower body at x: [[z, y], ...] bottom to top centre.
function lowerHalf(sh, x, near) {
  const w = sh.planW(x);
  const top = sh.top(x);
  const c = sh.yc(x);
  const y0 = sh.bottom(x);
  const out = [];
  for (const [f, k] of near ? SIDE_NEAR : SIDE_FAR) out.push([w * k, y0 + (c - y0) * f]);
  const ws = w * 0.985;
  const K = near ? 8 : 3;
  if (sh.inBed(x)) {
    const floor = sh.S.floor * sh.H;
    const ww = Math.max(0.01, ws - 0.07);
    if (near) {
      out.push([ws * 0.975, top], [ww, top], [ww, floor + 0.04], [Math.max(0.005, ws - 0.1), floor], [0, floor]);
    } else {
      out.push([ws * 0.975, top], [0, top - 0.06]);
    }
    return out;
  }
  for (let k = 1; k <= K; k++) {
    const a = (k / K) * Math.PI / 2;
    out.push([ws * spow(Math.cos(a), 2 / Q), c + (top - c) * spow(Math.sin(a), 2 / Q)]);
  }
  out[out.length - 1][0] = 0;
  return out;
}

// Height of the lower body's top surface at (x, z).
function surfY(sh, x, z) {
  const ws = sh.planW(x) * 0.985;
  const top = sh.top(x), c = sh.yc(x);
  const u = Math.min(1, Math.abs(z) / Math.max(ws, 1e-4));
  return c + (top - c) * Math.pow(Math.max(0, 1 - Math.pow(u, Q)), 1 / Q);
}

function mirror(half, x) {
  const J = half.length;
  const ring = [];
  for (let r = 0; r <= 2 * (J - 1); r++) {
    if (r <= J - 1) ring.push([x, half[r][1], half[r][0]]);
    else {
      const h = half[2 * (J - 1) - r];
      ring.push([x, h[1], -h[0]]);
    }
  }
  return ring;
}
// Half-ring band of face r in a mirrored ring of J half points.
function bandOf(r, J) {
  return r < J - 1 ? r : 2 * (J - 1) - r - 1;
}

function lowerStations(sh, near) {
  const xs = [];
  const tips = near ? [0, 0.15, 0.3, 0.45, 0.58, 0.7, 0.8, 0.88, 0.94, 0.975, 0.993] : [0, 0.45, 0.75, 0.93];
  for (const f of tips) {
    xs.push(sh.tipX(f, true), sh.tipX(f, false));
  }
  const fill = near ? 0.17 : 0.55;
  const n = Math.max(2, Math.ceil((sh.x1 - sh.x0) / fill));
  for (let i = 1; i < n; i++) xs.push(sh.x0 + ((sh.x1 - sh.x0) * i) / n);
  if (near) {
    for (const wx of sh.wheels) {
      xs.push(wx + sh.R + 0.004, wx + sh.R - 0.002, wx - sh.R + 0.002, wx - sh.R - 0.004);
      for (let k = 1; k < 12; k++) xs.push(wx + sh.R * Math.cos((k / 12) * Math.PI));
    }
    const S = sh.S;
    for (const s of S.seams || []) xs.push(s * sh.L, s * sh.L + 0.012);
    if (S.hood != null) xs.push(S.hood * sh.L, S.hood * sh.L + 0.012);
    if (S.boot != null) xs.push(S.boot * sh.L, S.boot * sh.L - 0.012);
    if (sh.bed) xs.push(sh.bed[0], sh.bed[0] - 0.006, sh.bed[1], sh.bed[1] + 0.006);
  } else {
    for (const wx of sh.wheels) {
      for (let k = 0; k <= 4; k++) xs.push(wx + sh.R * Math.cos((k / 4) * Math.PI));
    }
  }
  const inside = xs.filter((x) => x >= sh.x0 - 1e-6 && x <= sh.x1 + 1e-6);
  return uniqSorted(inside, 0.0012);
}

// ---- greenhouse --------------------------------------------------------------
function ghShape(sh) {
  const g = sh.S.gh;
  const L = sh.L;
  const xC = g.xC * L, xR0 = g.xR0 * L, xR1 = g.xR1 * L, xA = g.xA * L;
  const crown = g.crown * sh.H;
  const roofY = g.roof * sh.H - crown;
  const baseW = (x) => sh.planW(x) * 0.985 * g.base;
  const baseY = (x) => surfY(sh, x, baseW(x)) - 0.03;
  const yA = baseY(xA), yC = baseY(xC);
  const roofC = curve([
    [xC, yC], [xC + (xR0 - xC) * 0.5, yC + (roofY - yC) * 0.62], [xR0, roofY - 0.012],
    [(xR0 + xR1) / 2, roofY], [xR1, roofY - 0.01], [xR1 + (xA - xR1) * 0.5, yA + (roofY - yA) * 0.55], [xA, yA],
  ]);
  return { g, xC, xR0, xR1, xA, crown, roofY, baseW, baseY, roof: roofC };
}

function ghHalf(sh, gs, x, near) {
  const wb = gs.baseW(x);
  const gb = gs.baseY(x);
  const R = Math.max(gb, gs.roof(x));
  const h = R - gb;
  const hmax = gs.roofY - gb;
  const wt = wb - gs.g.tumble * Math.max(0, Math.min(1, h / Math.max(0.05, hmax))) * (hmax);
  const seal = Math.min(h, 0.06);
  const rail = Math.min(h * 0.18, 0.06);
  const crown = gs.crown * Math.min(1, h / Math.max(0.05, hmax));
  const out = [];
  out.push([wb, gb]);
  if (near) {
    out.push([wb + (wt - wb) * (seal / Math.max(h, 1e-4)), gb + seal]);
    const yg = gb + seal + (h - seal - rail) * 0.5;
    out.push([wb + (wt - wb) * ((yg - gb) / Math.max(h, 1e-4)), yg]);
    out.push([wb + (wt - wb) * ((h - rail) / Math.max(h, 1e-4)), R - rail]);
  }
  out.push([wt, R - rail * 0.25]);
  const K = near ? 6 : 2;
  for (let k = 1; k <= K; k++) {
    const a = (k / K) * Math.PI / 2;
    out.push([wt * 0.97 * spow(Math.cos(a), 0.55), R + crown * spow(Math.sin(a), 0.8)]);
  }
  out[out.length - 1][0] = 0;
  return out;
}

function ghStations(sh, gs, near) {
  const g = gs.g, L = sh.L;
  const xs = [gs.xC, gs.xR0, gs.xR1, gs.xA];
  const n = near ? 18 : 5;
  for (let i = 1; i < n; i++) xs.push(gs.xC + ((gs.xA - gs.xC) * i) / n);
  if (near) {
    for (const v of g.side) xs.push(v * L);
    if (g.b) xs.push(g.b[0] * L, g.b[1] * L);
    if (g.rearSide) xs.push(g.rearSide[0] * L, g.rearSide[1] * L);
    // Extra stations on the windscreen and rear glass curves.
    for (const f of [0.25, 0.5, 0.75]) {
      xs.push(gs.xR1 + (gs.xA - gs.xR1) * f, gs.xC + (gs.xR0 - gs.xC) * f);
    }
  } else {
    for (const v of g.side) xs.push(v * L);
  }
  return uniqSorted(xs.filter((x) => x >= gs.xC && x <= gs.xA), 0.002);
}

// ---- parts -----------------------------------------------------------------------
const M = new THREE.Matrix4();
const E = new THREE.Euler();
const Qn = new THREE.Quaternion();
const V1 = new THREE.Vector3(), V2 = new THREE.Vector3();
function place(x, y, z, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) {
  E.set(rx, ry, rz);
  Qn.setFromEuler(E);
  V1.set(x, y, z);
  V2.set(sx, sy, sz);
  return M.compose(V1, Qn, V2);
}
function box(acc, hex, cls, sx, sy, sz, x, y, z, rx = 0, ry = 0, rz = 0) {
  acc.geo(new THREE.BoxGeometry(sx, sy, sz), hex, cls, place(x, y, z, rx, ry, rz));
}
// Rounded little blob (mirror housings, lamps).
function blob(acc, hex, cls, sx, sy, sz, x, y, z, seg = 8) {
  acc.geo(new THREE.SphereGeometry(0.5, seg, Math.max(4, seg - 2)), hex, cls, place(x, y, z, 0, 0, 0, sx, sy, sz));
}
function cylX(acc, hex, cls, r, len, x, y, z, seg = 10, open = false) {
  acc.geo(new THREE.CylinderGeometry(r, r, len, seg, 1, open), hex, cls, place(x, y, z, 0, 0, -Math.PI / 2));
}

// Wheel-well liners: an upside-down U tube inside each arch plus an
// inner wall, so you never see through the body.
function archLiners(acc, sh) {
  const R = sh.R + 0.01;
  const col = lin(ARCH);
  for (const wx of sh.wheels) {
    for (const s of [1, -1]) {
      const zi = (sh.hw - 0.42) * s;
      const yb = Math.min(sh.wr * 0.5, sh.bottom(wx + R + 0.02));
      // Profile around the arch, rear foot -> over the top -> front foot.
      const prof = [[wx - R, yb]];
      const N = 10;
      for (let k = 0; k <= N; k++) {
        const a = Math.PI - (k / N) * Math.PI;
        prof.push([wx + Math.cos(a) * R, sh.wr + Math.sin(a) * R]);
      }
      prof.push([wx + R, yb]);
      // Inner tube faces point toward the wheel (down / inward).
      for (let k = 0; k < prof.length - 1; k++) {
        const [ax_, ay] = prof[k], [bx, by] = prof[k + 1];
        let nx = -(by - ay), ny = bx - ax_; // left normal of the path (points to arch centre)
        const l = Math.hypot(nx, ny) || 1;
        nx /= l; ny /= l;
        const za = s * (sh.planW(ax_) * 0.965), zb = s * (sh.planW(bx) * 0.965);
        const a = acc.vert(ax_, ay, za, nx, ny, 0, col, CLS.TRIM);
        const b = acc.vert(bx, by, zb, nx, ny, 0, col, CLS.TRIM);
        const c = acc.vert(bx, by, zi, nx, ny, 0, col, CLS.TRIM);
        const d = acc.vert(ax_, ay, zi, nx, ny, 0, col, CLS.TRIM);
        if (s > 0) { acc.tri(a, c, b); acc.tri(a, d, c); } else { acc.tri(a, b, c); acc.tri(a, c, d); }
      }
      // Inner wall facing outward (fan from the axle point).
      const cIdx = acc.vert(wx, sh.wr, zi, 0, 0, s, col, CLS.TRIM);
      const ids = prof.map(([px, py]) => acc.vert(px, py, zi, 0, 0, s, col, CLS.TRIM));
      for (let k = 0; k < ids.length - 1; k++) {
        if (s > 0) acc.tri(cIdx, ids[k], ids[k + 1]);
        else acc.tri(cIdx, ids[k + 1], ids[k]);
      }
    }
  }
}

// Flat dark underside.
function underside(acc, sh, xs) {
  const col = lin(ARCH);
  const y = sh.S.bottom ? curve(sh.S.bottom)(0) * sh.H + 0.02 : 0.2;
  const ids = [];
  for (const x of [xs[1], xs[xs.length - 2]]) {
    const w = sh.planW(x) * 0.9;
    ids.push(acc.vert(x, y, -w, 0, -1, 0, col, CLS.TRIM), acc.vert(x, y, w, 0, -1, 0, col, CLS.TRIM));
  }
  acc.tri(ids[0], ids[2], ids[3]);
  acc.tri(ids[0], ids[3], ids[1]);
}

function plate(acc, sh, front) {
  const S = sh.S;
  const xTip = front ? sh.x1 : sh.x0;
  const y0 = sh.bottom(xTip), c = sh.yc(xTip);
  const y = y0 + (c - y0) * (front ? 0.33 : 0.4);
  const sx = front ? 1 : -1;
  if (S.range) return;
  box(acc, PLATE, CLS.PLATE, 0.02, 0.12, 0.5, xTip + sx * 0.012, y, 0);
  box(acc, TRIM, CLS.TRIM, 0.012, 0.14, 0.53, xTip + sx * 0.003, y, 0);
}

// ---- main builder ------------------------------------------------------------
// Returns { body, head, tail, info } geometries for the near model, or
// { body } for the far one.
export function buildCar(spec, near = true) {
  const sh = shape(spec);
  const S = sh.S;
  const L = sh.L, hw = sh.hw;
  const acc = new Acc();
  const headAcc = near ? new Acc() : null;
  const tailAcc = near ? new Acc() : null;
  const id = spec.id;
  const paint = lin(WHITE);

  // Lower shell.
  const xs = lowerStations(sh, near);
  const P = xs.map((x) => mirror(lowerHalf(sh, x, near), x));
  const J = (P[0].length + 1) / 2;
  const nSide = near ? SIDE_NEAR.length - 1 : 1; // bands 0..nSide-1 are the side
  const seamAt = (x) => {
    for (const s of S.seams || []) if (x > s * L && x < s * L + 0.012) return true;
    return false;
  };
  const hoodSeam = (x) => (S.hood != null && x > S.hood * L && x < S.hood * L + 0.012) || (S.boot != null && x < S.boot * L && x > S.boot * L - 0.012);
  const bedGap = (x) => sh.bed && ((x > sh.bed[0] - 0.007 && x < sh.bed[0] + 0.001) || (x > sh.bed[1] - 0.001 && x < sh.bed[1] + 0.007));
  const out = { col: paint, cls: CLS.PAINT };
  const pick = (col, cls) => {
    out.col = lin(col);
    out.cls = cls;
    return out;
  };
  const front = (n, x) => n[0] > 0.55 && x > sh.mid;
  const rear = (n, x) => n[0] < -0.55 && x < sh.mid;
  emitGrid(acc, P, (i, r, c, n) => {
    const jj = bandOf(r, J);
    const x = c[0], az = Math.abs(c[2]);
    out.col = paint;
    out.cls = CLS.PAINT;
    if (!near) {
      if (jj === 0 && Math.abs(n[1]) < 0.7 && c[1] < sh.bottom(x) + 0.08) return pick(TRIM, CLS.TRIM);
      if (front(n, x) && jj === 1 && az < hw * 0.55) return pick(GRILLE, CLS.TRIM);
      if (front(n, x) && jj === 2 && az > hw * 0.45) return pick(0xdfe6ee, CLS.GLOW);
      if (rear(n, x) && jj === 2 && az > hw * 0.4) return pick(0xc01414, CLS.GLOW);
      return out;
    }
    if (sh.inBed(x) || bedGap(x)) {
      if (jj >= nSide + 2) return pick(LINER, CLS.TRIM);
    }
    if (jj < nSide + 1 && seamAt(x) && c[1] > sh.bottom(x) + 0.02) return pick(SEAM, CLS.TRIM);
    if (jj >= nSide + 1 && hoodSeam(x)) return pick(SEAM, CLS.TRIM);
    // Dark lower sill and bumper lip all round.
    if (jj === 0) return pick(TRIM, CLS.TRIM);
    if (S.skirt && jj === 1 && Math.abs(n[2]) > 0.3) return pick(TRIM, CLS.TRIM);
    if (id === 'police' && jj >= 2 && jj <= 5 && Math.abs(n[2]) > 0.3 && x > -0.205 * L && x < 0.205 * L) return pick(0xf4f4f2, CLS.LIVERY);
    if (id === 'taxi' && jj === 5 && Math.abs(n[2]) > 0.3 && x > -0.205 * L && x < 0.205 * L) return pick(0x161616, CLS.LIVERY);
    return out;
  });
  out.u = 0;
  out.v = 0;

  // Greenhouse.
  const gs = ghShape(sh);
  const gx = ghStations(sh, gs, near);
  const G = gx.map((x) => mirror(ghHalf(sh, gs, x, near), x));
  const GJ = (G[0].length + 1) / 2;
  const g = S.gh;
  const inSpan = (x, s) => s && x > s[0] * L && x < s[1] * L;
  emitGrid(acc, G, (i, r, c) => {
    const jj = bandOf(r, GJ);
    const x = c[0];
    out.col = paint;
    out.cls = CLS.PAINT;
    const sideBand = near ? jj >= 1 && jj <= 2 : jj === 0;
    const topBand = near ? jj >= 4 : jj >= 1;
    if (near && jj === 0) return pick(TRIM, CLS.TRIM);
    if (sideBand) {
      if (inSpan(x, g.b)) return pick(TRIM, CLS.TRIM);
      if (inSpan(x, g.side) || inSpan(x, g.rearSide)) return pick(GLASS, CLS.GLASS);
      return out;
    }
    if (topBand) {
      if (x > gs.xR1 + 0.005) return pick(GLASS, CLS.GLASS);
      if (x < gs.xR0 - 0.005 && g.rear) return pick(GLASS, CLS.GLASS);
    }
    return out;
  });

  if (near) {
    archLiners(acc, sh);
    underside(acc, sh, xs);
    plate(acc, sh, true);
    plate(acc, sh, false);
    details(acc, headAcc, tailAcc, sh, gs, spec);
  } else {
    farDetails(acc, sh, spec);
  }

  const res = { body: acc.build(), shape: sh, gh: gs };
  if (near) {
    res.head = headAcc.count ? headAcc.build() : null;
    res.tail = tailAcc.count ? tailAcc.build() : null;
  }
  return res;
}

function details(acc, headAcc, tailAcc, sh, gs, spec) {
  const S = sh.S;
  const L = sh.L;
  const id = spec.id;
  // Mirrors at the base of the A pillar.
  if (!S.range) {
    const mx = gs.xA - 0.16;
    for (const s of [1, -1]) {
      const w = sh.planW(mx);
      const y = gs.baseY(mx) + 0.1;
      box(acc, TRIM, CLS.TRIM, 0.07, 0.035, 0.1, mx + 0.03, y - 0.02, (w + 0.02) * s);
      blob(acc, WHITE, CLS.PAINT, 0.14, 0.11, 0.2, mx, y, (w + 0.1) * s);
      box(acc, CHROME, CLS.CHROME, 0.01, 0.085, 0.15, mx - 0.072, y, (w + 0.105) * s);
    }
  }
  // Door handles.
  for (const s of S.seams || []) {
    const x = s * L - 0.12;
    if (x < sh.x0 + 0.4 || x > sh.x1 - 0.6) continue;
    for (const side of [1, -1]) {
      const w = sh.planW(x);
      box(acc, CHROME, CLS.CHROME, 0.13, 0.025, 0.02, x, sh.yc(x) - 0.055, (w + 0.002) * side);
    }
  }
  // Wipers at the windscreen base.
  if (!S.range || id === 'truck') {
    const wx = gs.xA - 0.06;
    const y = gs.baseY(wx) + 0.06;
    for (const s of [0.18, -0.32]) box(acc, SEAM, CLS.TRIM, 0.02, 0.015, sh.hw * 0.55, wx, y, s * sh.hw * 0.9, 0, 0.12, 0);
  }
  // Exhaust tips.
  if (S.exhaust) {
    const x = sh.x0 + 0.02;
    const y = sh.bottom(sh.x0 + 0.3) + 0.04;
    const zs = S.exhaust.n === 2 ? [S.exhaust.z, -S.exhaust.z] : [-S.exhaust.z];
    for (const zf of zs) {
      const z = zf * sh.hw * 2;
      for (const dz of id === 'sports' ? [-0.055, 0.055] : [0]) {
        cylX(acc, CHROME, CLS.CHROME, 0.042, 0.14, x, y, z + dz, 10, true);
        cylX(acc, 0x050505, CLS.TRIM, 0.034, 0.02, x + 0.02, y, z + dz, 10);
      }
    }
  }
  // Style extras.
  if (S.wing) {
    const x = sh.x0 + 0.2;
    const y = sh.top(x) + 0.17;
    box(acc, TRIM, CLS.TRIM, 0.3, 0.035, sh.W * 0.92, x, y, 0, 0, 0, 0.12);
    for (const s of [1, -1]) {
      box(acc, TRIM, CLS.TRIM, 0.08, 0.17, 0.03, x + 0.04, y - 0.085, s * sh.hw * 0.62);
      box(acc, TRIM, CLS.TRIM, 0.32, 0.12, 0.012, x, y + 0.02, s * sh.W * 0.46);
    }
  }
  if (S.ducktail) {
    const x = sh.x0 + 0.1;
    box(acc, WHITE, CLS.PAINT, 0.12, 0.045, sh.W * 0.86, x, sh.top(x) + 0.015, 0, 0, 0, 0.25);
  }
  if (S.roofSpoiler) {
    const x = gs.xR0 - 0.02;
    box(acc, WHITE, CLS.PAINT, 0.22, 0.04, gs.baseW(x) * 1.6, x - 0.06, gs.roofY + gs.crown * 0.6, 0, 0, 0, 0.08);
  }
  if (S.scoop) {
    const x = 0.27 * L;
    const y = sh.top(x);
    acc.geo(new THREE.BoxGeometry(0.7, 0.09, 0.62), WHITE, CLS.PAINT, place(x, y + 0.02, 0, 0, 0, -0.03));
    box(acc, GRILLE, CLS.TRIM, 0.02, 0.06, 0.5, x + 0.352, y + 0.03, 0);
  }
  if (id === 'pickup') {
    // Roll bar behind the cab and a tailgate handle.
    const bx = sh.bed[1] - 0.12;
    const top = sh.top(bx);
    for (const s of [1, -1]) box(acc, TRIM, CLS.TRIM, 0.07, 0.36, 0.07, bx, top + 0.18, s * (sh.hw - 0.12));
    box(acc, TRIM, CLS.TRIM, 0.07, 0.07, sh.W - 0.2, bx, top + 0.36, 0);
    box(acc, TRIM, CLS.TRIM, 0.015, 0.05, 0.26, sh.x0 - 0.002, sh.top(sh.x0) - 0.12, 0);
    // Step bars.
    for (const s of [1, -1]) box(acc, CHROME, CLS.CHROME, 1.3, 0.05, 0.1, 0.02 * L, sh.bottom(0) - 0.05, s * (sh.hw - 0.02));
  }
  if (id === 'van') {
    // Sliding-door rail and a roof rack.
    for (const s of [1, -1]) box(acc, TRIM, CLS.TRIM, 2.0, 0.03, 0.02, -0.06 * L, gs.baseY(-0.06 * L) + 0.02, (gs.baseW(-0.06 * L) + 0.01) * s);
    for (const s of [1, -1]) box(acc, TRIM, CLS.TRIM, 2.6, 0.04, 0.05, -0.12 * L, gs.roofY + gs.crown + 0.05, s * sh.hw * 0.7);
    for (const xx of [-0.35, -0.12, 0.1]) box(acc, TRIM, CLS.TRIM, 0.05, 0.04, sh.hw * 1.45, xx * L, gs.roofY + gs.crown + 0.08, 0);
  }
  if (id === 'taxi') {
    const x = -0.08 * L;
    const y = gs.roofY + gs.crown;
    box(acc, TRIM, CLS.TRIM, 0.56, 0.04, 0.3, x, y + 0.02, 0);
    // The lit sign itself lives in the head-lamp mesh (cell 2) so it glows.
    headAcc.geo(new THREE.BoxGeometry(0.5, 0.17, 0.26), WHITE, 0, place(x, y + 0.12, 0), (2 + 0.5) / 4, 0.5);
  }
  if (id === 'truck') truckParts(acc, tailAcc, sh, spec);
}

function truckParts(acc, tailAcc, sh, spec) {
  const L = sh.L, W = sh.W, H = sh.H;
  const xb0 = -L / 2, xb1 = sh.x0 - 0.12;
  const y0 = 1.08, y1 = H;
  const len = xb1 - xb0;
  const bw = W * 0.995;
  // Cargo box: slightly bevelled panels, corner posts, rib seams, doors.
  box(acc, 0xe9e8e2, CLS.LIVERY, len, y1 - y0, bw, xb0 + len / 2, (y0 + y1) / 2, 0);
  for (const s of [1, -1]) {
    for (let i = 0; i <= 8; i++) {
      const x = xb0 + 0.05 + (len - 0.1) * (i / 8);
      box(acc, 0xbdbcb6, CLS.TRIM, 0.05, y1 - y0 - 0.04, 0.012, x, (y0 + y1) / 2, s * (bw / 2 + 0.004));
    }
    box(acc, 0x9a9a96, CLS.CHROME, len, 0.08, 0.02, xb0 + len / 2, y0 + 0.04, s * (bw / 2 + 0.006));
    box(acc, 0x9a9a96, CLS.CHROME, len, 0.06, 0.02, xb0 + len / 2, y1 - 0.03, s * (bw / 2 + 0.006));
  }
  // Rear doors with hinges and a lamp bar.
  box(acc, 0xd5d4ce, CLS.LIVERY, 0.02, y1 - y0 - 0.1, bw - 0.12, xb0 - 0.01, (y0 + y1) / 2, 0);
  box(acc, SEAM, CLS.TRIM, 0.025, y1 - y0 - 0.1, 0.02, xb0 - 0.012, (y0 + y1) / 2, 0);
  for (const s of [1, -1]) {
    box(acc, CHROME, CLS.CHROME, 0.03, 1.5, 0.04, xb0 - 0.03, (y0 + y1) / 2, s * 0.18);
    for (const yy of [y0 + 0.35, y1 - 0.35]) box(acc, TRIM, CLS.TRIM, 0.03, 0.06, 0.14, xb0 - 0.02, yy, s * (bw / 2 - 0.1));
  }
  // Chassis rails, rear bumper, mudguards over the rear wheels.
  for (const s of [1, -1]) box(acc, 0x1a1a1a, CLS.TRIM, L * 0.9, 0.26, 0.12, -0.02 * L, 0.78, s * 0.45);
  box(acc, 0x1a1a1a, CLS.TRIM, 0.14, 0.18, W * 0.96, xb0 + 0.12, 0.55, 0);
  const ax = spec.wheelBase / 2;
  const { wr, tw, az } = wheelLayout(spec);
  for (const s of [1, -1]) {
    box(acc, 0x141414, CLS.TRIM, wr * 2.6, 0.05, tw + 0.16, -ax, wr * 2 + 0.08, s * az);
    box(acc, 0x141414, CLS.TRIM, 0.03, 0.4, tw + 0.1, -ax - wr * 1.25, wr * 1.6, s * az);
    // Fuel tank and side guard.
    cylX(acc, 0xb8bcc2, CLS.CHROME, 0.26, 1.1, 0.4, 0.62, s * (W / 2 - 0.42), 12);
    box(acc, 0x2a2a2a, CLS.TRIM, 1.8, 0.06, 0.04, -0.8, 0.55, s * (W / 2 - 0.08));
  }
  // Cab roof deflector, sun visor and a horn.
  const cx = sh.x0 + 0.5;
  acc.geo(new THREE.BoxGeometry(1.0, 0.3, W * 0.86), WHITE, CLS.PAINT, place(cx + 0.2, H * 0.88 + 0.12, 0, 0, 0, 0.18));
  box(acc, TRIM, CLS.TRIM, 0.22, 0.05, W * 0.84, sh.x1 - 0.1, H * 0.88 - 0.04, 0, 0, 0, -0.15);
  for (const s of [1, -1]) {
    // Big truck mirrors on arms.
    const mx = sh.x1 - 0.35, my = 2.1;
    box(acc, TRIM, CLS.TRIM, 0.04, 0.04, 0.32, mx, my, s * (W / 2 + 0.12));
    box(acc, TRIM, CLS.TRIM, 0.07, 0.42, 0.18, mx - 0.02, my - 0.05, s * (W / 2 + 0.3));
    box(acc, CHROME, CLS.CHROME, 0.01, 0.38, 0.15, mx - 0.06, my - 0.05, s * (W / 2 + 0.3));
    // Step below the door.
    box(acc, 0x2a2a2a, CLS.TRIM, 0.5, 0.04, 0.22, sh.x1 - 0.85, 0.62, s * (W / 2 - 0.08));
  }
  // Rear lamps on the bumper ends (tail mesh: red, reverse, indicator).
  for (const s of [1, -1]) {
    const z = s * (W / 2 - 0.22);
    tailAcc.geo(new THREE.BoxGeometry(0.04, 0.12, 0.2), WHITE, 0, place(xb0 + 0.04, 0.55, z), (s > 0 ? 3.5 : 0.5) / 4, 0.5);
    tailAcc.geo(new THREE.BoxGeometry(0.04, 0.1, 0.1), WHITE, 0, place(xb0 + 0.04, 0.55, z - s * 0.17), 1.5 / 4, 0.5);
    tailAcc.geo(new THREE.BoxGeometry(0.04, 0.1, 0.1), WHITE, 0, place(xb0 + 0.04, 0.55, z + s * 0.16), 2.5 / 4, 0.5);
    // Clearance lamps on the box top corners.
    tailAcc.geo(new THREE.BoxGeometry(0.03, 0.06, 0.08), WHITE, 0, place(xb0 - 0.02, H - 0.08, s * (W / 2 - 0.08)), 0.5 / 4, 0.5);
  }
}

function farDetails(acc, sh, spec) {
  const { wr, tw, ax, az } = wheelLayout(spec);
  // One dark prism per axle spanning the track: reads as two wheels.
  for (const wx of [ax, -ax]) {
    acc.geo(new THREE.CylinderGeometry(wr, wr, az * 2 + tw, 6, 1, false), 0x121212, CLS.RUBBER, place(wx, wr, 0, Math.PI / 2, 0, 0));
  }
  // Tail lamp blocks (glow at night through the shared lamp uniform).
  if (spec.body !== 'truck') {
    const x = sh.x0 + 0.03;
    const y = sh.yc(sh.x0 + 0.1) - 0.06;
    for (const s of [1, -1]) box(acc, 0xd01818, CLS.GLOW, 0.06, 0.1, sh.W * 0.22, x, y, s * sh.hw * 0.66);
  } else {
    box(acc, 0xe9e8e2, CLS.LIVERY, sh.L / 2 + sh.x0 - 0.12, sh.H - 1.08, sh.W, (-sh.L / 2 + sh.x0 - 0.12) / 2, (sh.H + 1.08) / 2, 0);
  }
}

// ---- wheels -----------------------------------------------------------------------
// Tyre (tread blocks alternate shade so spin is visible) with an alloy
// or steel rim. Axle along local z; the outer face looks toward +z.
export function buildWheel(wr, tw, spokes = 5, rimHex = 0xc9cdd2) {
  const acc = new Acc();
  const rimR = wr * 0.64;
  const seg = 14;
  const tread = [lin(0x1d1d1e), lin(0x0f0f10)];
  const wall = lin(0x1f1f21), wallHi = lin(0x2c2c2e);
  const o = { col: wall, cls: CLS.RUBBER };
  lathe(acc, [[rimR, -tw / 2], [wr * 0.94, -tw / 2], [wr, -tw * 0.3], [wr, tw * 0.3], [wr * 0.94, tw / 2], [rimR, tw / 2]], seg, (i, r) => {
    o.cls = CLS.RUBBER;
    if (r === 0 || r === 4) o.col = r === 4 && i % 4 < 2 ? wallHi : wall;
    else o.col = tread[(i + (r === 2 ? 1 : 0)) % 2];
    return o;
  }, { crease: 0.3 });
  const rimC = lin(rimHex), dark = lin(0x2a2b2e);
  // Barrel (faces inward), outer lip, recessed dark dish.
  lathe(acc, [[rimR, tw * 0.42], [rimR, -tw / 2 + 0.01]], seg, () => ({ col: dark, cls: CLS.ALLOY }));
  lathe(acc, [[rimR * 1.02, tw / 2 + 0.002], [rimR * 0.9, tw / 2 - 0.01], [rimR * 0.86, tw * 0.3]], seg, () => ({ col: rimC, cls: CLS.ALLOY }), { crease: 0.4 });
  lathe(acc, [[rimR * 0.9, tw * 0.02], [rimR * 0.3, tw * 0.02]], 10, () => ({ col: lin(0x3c3d40), cls: CLS.ALLOY }));
  // Spokes and hub.
  const zs = tw * 0.36;
  const len = rimR * 0.66;
  for (let k = 0; k < spokes; k++) {
    const a = (k / spokes) * Math.PI * 2;
    const rm = rimR * 0.24 + len / 2;
    const width = spokes > 6 ? rimR * 0.13 : rimR * 0.22;
    acc.geo(new THREE.BoxGeometry(len, width, tw * 0.22), rimHex, CLS.ALLOY, place(Math.cos(a) * rm, Math.sin(a) * rm, zs, 0, 0, a));
  }
  acc.geo(new THREE.CylinderGeometry(rimR * 0.3, rimR * 0.34, tw * 0.2, 8, 1, true), rimHex, CLS.ALLOY, place(0, 0, tw * 0.38, Math.PI / 2, 0, 0));
  acc.geo(new THREE.CylinderGeometry(rimR * 0.12, rimR * 0.12, 0.012, 8), 0x2a2a2a, CLS.CHROME, place(0, 0, tw * 0.49, Math.PI / 2, 0, 0));
  return acc.build();
}
