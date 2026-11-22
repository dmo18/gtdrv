// Aircraft meshes: smooth lofted fuselages, airfoil wings with moving
// control surfaces, retracting gear, spinning rotors and propellers,
// stores that vanish when fired, nav lights and a strobe. Each airframe
// is one rigged mesh (hullkit.js: the skin's vertex shader moves the
// tagged parts) plus see-through canopy glass and a blur disc, so a
// near aircraft is 2..4 draw calls; past LOD_FAR a coarse body only.
// Origin is the ground-contact centre; the nose points along local +x.
import * as THREE from 'three';
import { angleDiff } from '../core/rng.js';
import { Kit, RIG, CLS, shade, createSkin, skinDepth, skinLook, glassMaterial, discMaterial, buildKit, discGeometry, loftSurface, surfacePatch, V } from './hullkit.js';
import { stepAircraftRig, wrapAngle, storesLeft } from './craftmath.js';

const GLASS = 0x18222c;
const DARK = 0x2a2d31;
const TYRE = 0x161719;
const METAL = 0x8d9399;
const STEEL = 0x5f646b;
const WHITE = 0xf2f1ea;
const NAVY = 0x1f3354;
const ORANGE = 0xe8782a;
const SAND = 0xc8b88a;
const RED_L = 0xff2a1a;
const GREEN_L = 0x22ff5a;
const WHITE_L = 0xfff6e0;
const L = CLS.LIVERY, T = CLS.TRIM, G = CLS.GLASS, R = CLS.RUBBER, A = CLS.ALLOY, CH = CLS.CHROME, GL = CLS.GLOW;
const LOD_FAR = 150;

const tc = new THREE.Color();
function trimFor(color) {
  tc.setHex(color);
  const lum = tc.r * 0.3 + tc.g * 0.6 + tc.b * 0.1;
  return lum > 0.35 ? NAVY : WHITE;
}

// ---- part helpers -------------------------------------------------------------
function wheel(k, x, y, z, r, w) {
  k.lathe([
    { pts: [[0, 0], [0, r * 0.58]], hex: METAL, cls: A },
    { pts: [[0, r * 0.58], [0, r * 0.8], [w * 0.12, r * 0.97], [w * 0.5, r], [w * 0.88, r * 0.97], [w, r * 0.8], [w, r * 0.58]], hex: TYRE, cls: R },
    { pts: [[w, r * 0.58], [w, 0]], hex: METAL, cls: A },
  ], 14, [x, y, z - w / 2], [0, 0, 1]);
}

function pilot(k, x, y, z) {
  if (k.q < 0.8) return;
  k.rbox(x - 0.05, y - 0.32, z, 0.34, 0.3, 0.5, 0x3d4436, T, 0.4, 3);
  k.rbox(x, y, z, 0.27, 0.26, 0.24, 0xd9d6cc, L, 0.45, 2.2);
  k.rbox(x + 0.1, y - 0.02, z, 0.08, 0.13, 0.2, GLASS, G, 0.4, 2.4);
}

function navLights(k, left, right, tail, strobe) {
  const s = 0.07;
  k.box(left[0], left[1], left[2], s, s * 0.8, s, RED_L, GL);
  k.box(right[0], right[1], right[2], s, s * 0.8, s, GREEN_L, GL);
  if (tail) k.box(tail[0], tail[1], tail[2], s, s * 0.8, s, WHITE_L, GL);
  if (strobe) {
    k.setRig(RIG.STROBE, strobe);
    k.box(strobe[0], strobe[1] + 0.03, strobe[2], 0.11, 0.08, 0.11, WHITE_L, GL);
    k.noRig();
  }
}

const lerp3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
function sectAt(root, tip, s) {
  return { le: lerp3(root.le, tip.le, s), c: root.c + (tip.c - root.c) * s, t: root.t + (tip.t - root.t) * s };
}
const hingeAt = (sec, u) => [sec.le[0] - sec.c * u, sec.le[1], sec.le[2]];

// One wing (or tail) half with optional moving surfaces. o: { root, tip,
// hex, tipHex, tipAt, up, surfaces: [{ s0, s1, u, code, gain, sign,
// rudder }] }. Lift axis: points along the hinge with -z, so a positive
// angle raises the trailing edge.
function wingHalf(k, o) {
  const cuts = [0, 1];
  const surfs = o.surfaces || [];
  for (const s of surfs) cuts.push(s.s0, s.s1);
  if (o.tipAt) cuts.push(o.tipAt);
  const xs = [...new Set(cuts)].sort((a, b) => a - b);
  let top = null;
  for (let i = 0; i < xs.length - 1; i++) {
    const sa = xs[i], sb = xs[i + 1];
    if (sb - sa < 1e-4) continue;
    const ra = sectAt(o.root, o.tip, sa), rb = sectAt(o.root, o.tip, sb);
    const hex = o.tipAt && sa >= o.tipAt - 1e-6 ? o.tipHex : o.hex;
    const surf = surfs.find((s) => sa >= s.s0 - 1e-6 && sb <= s.s1 + 1e-6);
    const opt = { up: o.up, capTip: sb > 0.999 || !!surf, capRoot: sa > 0.001 && !!surf, camber: o.camber };
    if (surf) {
      top = k.wing(ra, rb, hex, L, { ...opt, u1: surf.u - 0.005 });
      const h0 = hingeAt(ra, surf.u), h1 = hingeAt(rb, surf.u);
      let ax = V.norm(V.sub(h1, h0));
      if (!surf.rudder && ax[2] > 0) ax = V.scl(ax, -1);
      k.setRig(surf.code, h0, V.scl(ax, surf.gain * (surf.sign || 1)));
      k.wing(ra, rb, hex, L, { ...opt, u0: surf.u + 0.005 });
      k.noRig();
    } else {
      const f = k.wing(ra, rb, hex, L, opt);
      if (sa < 0.5 && sb > 0.5) top = f;
    }
  }
  return top;
}

// Mirror a half-wing description to the left side (z -> -z).
function mirrorSec(s) {
  return { le: [s.le[0], s.le[1], -s.le[2]], c: s.c, t: s.t };
}

// Wing pair with ailerons (and flaps): right then left.
function wingPair(k, o) {
  for (const side of [1, -1]) {
    const surfaces = [];
    if (o.flap) surfaces.push({ s0: o.flap[0], s1: o.flap[1], u: o.flap[2], code: RIG.FLAP, gain: 0.55, sign: -1 });
    if (o.ail) surfaces.push({ s0: o.ail[0], s1: o.ail[1], u: o.ail[2], code: RIG.AILERON, gain: 0.35, sign: side });
    if (o.elev) surfaces.push({ s0: o.elev[0], s1: o.elev[1], u: o.elev[2], code: o.elevCode || RIG.ELEVATOR, gain: 0.35, sign: 1 });
    wingHalf(k, {
      root: side > 0 ? o.root : mirrorSec(o.root), tip: side > 0 ? o.tip : mirrorSec(o.tip),
      hex: o.hex, tipHex: o.tipHex || o.hex, tipAt: o.tipAt, up: o.up, camber: o.camber, surfaces,
    });
  }
}

// Fin: span along up (canted when the tip z differs), optional rudder.
function finPanel(k, root, tip, hex, rud, tipHex, tipAt) {
  const span = V.norm(V.sub(tip.le, root.le));
  const up = V.norm(V.cross([1, 0, 0], span));
  const surfaces = rud ? [{ s0: rud[0], s1: rud[1], u: rud[2], code: RIG.RUDDER, gain: 0.4, sign: 1, rudder: true }] : [];
  wingHalf(k, { root, tip, hex, tipHex: tipHex || hex, tipAt, up, camber: 0, surfaces });
}

// Rotor or propeller blades about axis d through hub o (rig code spins
// them); coning lifts the tips along d.
function blades(k, o, d, n, r, chord, code, hex, tipHex, cone = 0, r0 = 0.18) {
  const dd = V.norm(d);
  const ref = Math.abs(dd[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0];
  const u0 = V.norm(V.cross(dd, ref));
  const v0 = V.cross(dd, u0);
  k.setRig(code, o, dd);
  for (let b = 0; b < n; b++) {
    const a = (b / n) * Math.PI * 2;
    const ra = V.add(V.scl(u0, Math.cos(a)), V.scl(v0, Math.sin(a)));
    const ch = V.cross(dd, ra);
    const th = chord * 0.12;
    const pt = (rr, c, side, lift) => V.add(V.add(V.add(o, V.scl(ra, rr)), V.scl(ch, c * side)), V.scl(dd, lift + rr * cone));
    const body = (ra0, ra1, c0, c1, hx) => k.hexa([
      pt(ra0, c0 * 0.5, 1, th), pt(ra0, c0 * 0.5, -1, th * 0.3), pt(ra0, c0 * 0.5, -1, -th * 0.3), pt(ra0, c0 * 0.5, 1, -th),
      pt(ra1, c1 * 0.5, 1, th * 0.7), pt(ra1, c1 * 0.5, -1, th * 0.2), pt(ra1, c1 * 0.5, -1, -th * 0.2), pt(ra1, c1 * 0.5, 1, -th * 0.7),
    ], hx, T);
    body(r0, r * 0.88, chord, chord * 0.85, hex);
    body(r * 0.88, r, chord * 0.85, chord * 0.75, tipHex);
  }
  k.noRig();
}

// Missile on a rail / pylon: body along x centred at c, length len.
function missile(k, c, len, r, slot) {
  k.setRig(RIG.MISSILE + slot, c);
  const o = [c[0] - len / 2, c[1], c[2]];
  k.lathe([
    { pts: [[0, 0], [0, r * 0.8]], hex: DARK, cls: T },
    { pts: [[0, r * 0.8], [0.1, r], [len * 0.82, r]], hex: WHITE, cls: L },
    { pts: [[len * 0.82, r], [len * 0.93, r * 0.7], [len, 0.01]], hex: 0x8a8070, cls: T },
  ], 10, o, [1, 0, 0]);
  for (let f = 0; f < 4; f++) {
    const a = Math.PI / 4 + (f * Math.PI) / 2;
    const dz = Math.cos(a), dy = Math.sin(a);
    const fin = (x0, x1, h) => k.hexa([
      [x0, c[1] + dy * r, c[2] + dz * r], [x1, c[1] + dy * r, c[2] + dz * r], [x1, c[1] + dy * r + 0.005, c[2] + dz * r + 0.005], [x0, c[1] + dy * r + 0.005, c[2] + dz * r + 0.005],
      [x0 + h * 0.4, c[1] + dy * (r + h), c[2] + dz * (r + h)], [x1, c[1] + dy * (r + h), c[2] + dz * (r + h)], [x1, c[1] + dy * (r + h) + 0.005, c[2] + dz * (r + h) + 0.005], [x0 + h * 0.4, c[1] + dy * (r + h) + 0.005, c[2] + dz * (r + h) + 0.005],
    ], DARK, T);
    fin(o[0] + 0.02, o[0] + 0.3, r * 1.6);
    if (k.q > 0.8) fin(o[0] + len * 0.6, o[0] + len * 0.72, r * 0.8);
  }
  k.noRig();
}

function bomb(k, c, len, r, slot, hex = 0x5a6150) {
  k.setRig(RIG.BOMB + slot, c);
  const o = [c[0] - len / 2, c[1], c[2]];
  k.lathe([
    { pts: [[0, 0], [0, r * 0.35]], hex: DARK, cls: T },
    { pts: [[0, r * 0.35], [len * 0.25, r * 0.85], [len * 0.45, r], [len * 0.8, r * 0.95], [len, 0.02]], hex, cls: L },
  ], 10, o, [1, 0, 0]);
  k.box(o[0] + 0.12, c[1], c[2], 0.22, r * 2.4, 0.02, DARK, T);
  k.box(o[0] + 0.12, c[1], c[2], 0.22, 0.02, r * 2.4, DARK, T);
  k.box(o[0] + len * 0.82, c[1] + r * 0.6, c[2], 0.2, 0.05, 0.04, ORANGE, T);
  k.noRig();
}

// Gear leg + wheel, retracting about `axis` (length = travel in rad).
function gearLeg(k, pivot, wheelC, r, w, axis, twin = false) {
  k.setRig(RIG.GEAR, pivot, axis);
  k.tube(pivot, [wheelC[0], wheelC[1] + r * 0.4, wheelC[2]], 0.055, 0.045, METAL, CH, 8);
  k.tube([pivot[0], pivot[1] - 0.1, pivot[2]], [wheelC[0], wheelC[1] + r * 1.4, wheelC[2]], 0.075, 0.07, STEEL, A, 8);
  if (twin) {
    wheel(k, wheelC[0], wheelC[1], wheelC[2] + w * 0.6, r, w);
    wheel(k, wheelC[0], wheelC[1], wheelC[2] - w * 0.6, r, w);
  } else wheel(k, wheelC[0], wheelC[1], wheelC[2], r, w);
  k.noRig();
}

// Flat insignia: concentric polygons on a surface point (normal up).
function roundel(k, c, nrm, r, cols) {
  const n = 6;
  cols.forEach((hex, i) => {
    const rr = r * (1 - i * 0.32);
    const lift = 0.006 + i * 0.002;
    const cc = V.add(c, V.scl(nrm, lift));
    for (let j = 0; j < n; j++) {
      const a0 = (j / n) * Math.PI * 2 + Math.PI / 6, a1 = ((j + 1) / n) * Math.PI * 2 + Math.PI / 6;
      k.ftri(cc, [cc[0] + Math.cos(a0) * rr, cc[1], cc[2] + Math.sin(a0) * rr], [cc[0] + Math.cos(a1) * rr, cc[1], cc[2] + Math.sin(a1) * rr], hex, L, V.sub(cc, nrm));
    }
  });
}

// ---- airframes ------------------------------------------------------------------
// Each builder(k, gk, color, trim) fills the body kit k and the glass kit
// gk (null on the far LOD: glass then goes into k as dark glass) and
// returns the layout { prop, rotor, tailRotor, nozzle, discs, ... }.
function glassLoft(k, gk, keys) {
  if (gk) gk.loft(keys, 0xffffff, L, { steps: 10, seg: 18 });
  else k.loft(keys, GLASS, G, { steps: 6, seg: 10 });
}

function buildFighter(k, gk, color, trim) {
  const keys = [
    [6.75, 1.7, 0.015, 0.015, 0.015, 2], [6.2, 1.72, 0.17, 0.17, 0.15, 2], [5.2, 1.75, 0.37, 0.37, 0.33, 2.1],
    [4.2, 1.78, 0.5, 0.49, 0.43, 2.2], [3.2, 1.8, 0.58, 0.56, 0.48, 2.3], [2.2, 1.8, 0.68, 0.6, 0.52, 2.6],
    [1.0, 1.8, 0.92, 0.58, 0.56, 3.0], [-1.0, 1.8, 1.08, 0.56, 0.56, 3.4], [-3.5, 1.8, 1.1, 0.52, 0.54, 3.4],
    [-5.2, 1.8, 1.02, 0.46, 0.48, 3.2], [-6.15, 1.8, 0.98, 0.43, 0.44, 3.0],
  ];
  const belly = shade(color, 1.12), radome = shade(color, 0.8);
  k.loft(keys, color, L, {
    steps: 30, seg: 28, capEnds: true,
    col: (x, a, p) => {
      if (x > 5.85) return [radome, L];
      if (x > 1.0 && x < 3.95 && p[1] > 2.28) return [DARK, T];
      if (x > 3.9 && x < 5.0 && p[1] > 2.2 && Math.abs(p[2]) < 0.25) return [0x3a3e44, T];
      return [p[1] < 1.62 ? belly : color, L];
    },
  });
  const surf = loftSurface(keys);
  // Canopy, frame, cockpit.
  glassLoft(k, gk, [[4.45, 2.3, 0.04, 0.02, 0.02, 2], [3.9, 2.34, 0.33, 0.25, 0.05, 2], [3.0, 2.32, 0.43, 0.4, 0.05, 2],
    [2.0, 2.32, 0.42, 0.37, 0.05, 2], [1.2, 2.3, 0.3, 0.22, 0.05, 2], [0.75, 2.28, 0.08, 0.05, 0.03, 2]]);
  k.sweep([[3.82, 2.3, -0.33], [3.76, 2.52, -0.25], [3.72, 2.6, 0], [3.76, 2.52, 0.25], [3.82, 2.3, 0.33]], 0.025, DARK, T, 6);
  k.sweep([[1.25, 2.28, -0.3], [1.9, 2.3, -0.42], [3.0, 2.3, -0.43], [3.82, 2.3, -0.33]], 0.018, DARK, T, 5, false);
  k.sweep([[1.25, 2.28, 0.3], [1.9, 2.3, 0.42], [3.0, 2.3, 0.43], [3.82, 2.3, 0.33]], 0.018, DARK, T, 5, false);
  pilot(k, 2.65, 2.6, 0);
  if (k.q > 0.8) {
    k.rbox(2.25, 2.45, 0, 0.3, 0.55, 0.42, 0x33363a, T, 0.3, 4);
    k.box(3.55, 2.42, 0, 0.06, 0.12, 0.2, 0x76a090, G);
  }
  // Intakes with a dark mouth, LERX blending into the wing root.
  for (const s of [1, -1]) {
    k.hexa([[2.4, 1.92, 0.6 * s], [2.4, 1.92, 1.1 * s], [2.4, 1.28, 1.1 * s], [2.4, 1.28, 0.6 * s],
      [-1.4, 1.9, 0.75 * s], [-1.4, 1.9, 1.02 * s], [-1.4, 1.36, 1.02 * s], [-1.4, 1.36, 0.75 * s]], color, L);
    k.box(2.405, 1.6, 0.86 * s, 0.012, 0.54, 0.4, 0x0b0c0d, T);
    k.hexa([[3.5, 1.84, 0.56 * s], [0.2, 1.84, 0.62 * s], [0.2, 1.84, 1.4 * s], [1.0, 1.84, 1.32 * s],
      [3.5, 1.9, 0.56 * s], [0.2, 1.91, 0.62 * s], [0.2, 1.9, 1.4 * s], [1.0, 1.9, 1.32 * s]], color, L);
  }
  // Wings, tailerons, canted twin fins.
  const wr = { le: [0.9, 1.68, 0.95], c: 5.4, t: 0.045 }, wt = { le: [-3.3, 1.6, 4.75], c: 1.35, t: 0.035 };
  wingPair(k, { root: wr, tip: wt, hex: color, flap: [0.03, 0.42, 0.74], ail: [0.47, 0.9, 0.76] });
  for (const s of [1, -1]) {
    const tr = { le: [-4.7, 1.74, 1.02 * s], c: 2.2, t: 0.04 }, tt = { le: [-6.1, 1.7, 3.05 * s], c: 0.9, t: 0.03 };
    k.setRig(s > 0 ? RIG.TAIL_R : RIG.TAIL_L, [-5.6, 1.74, 0], [0, 0, -0.3]);
    k.wing(tr, tt, color, L, {});
    k.noRig();
    const fr = { le: [-3.85, 2.25, 0.7 * s], c: 2.7, t: 0.045 }, ft = { le: [-5.75, 3.58, 1.15 * s], c: 1.15, t: 0.035 };
    finPanel(k, fr, ft, color, [0.08, 0.84, 0.72], trim, 0.86);
  }
  // Nozzles (titanium, sooty liner, burner face) and their glow anchor.
  for (const s of [1, -1]) {
    k.lathe([
      { pts: [[0, 0.35], [0.3, 0.37], [0.36, 0.385], [0.42, 0.37], [0.8, 0.4], [1.05, 0.42]], hex: 0x8b857b, cls: A },
      { pts: [[0, 0.31], [0, 0.35]], hex: 0x55514c, cls: A },
      { pts: [[0.5, 0.27], [0, 0.31]], hex: 0x26221f, cls: T },
      { pts: [[0.5, 0], [0.5, 0.27]], hex: 0x7a3414, cls: GL },
    ], 20, [-6.9, 1.78, 0.48 * s], [1, 0, 0]);
  }
  // Pylons, wingtip missiles, bombs on inner pylons and the centreline.
  const mt = [-3.25, 1.52, 4.85];
  for (const s of [1, -1]) {
    k.box(mt[0] - 0.4, 1.56, mt[2] * s, 1.5, 0.06, 0.07, DARK, T);
    missile(k, [mt[0] - 0.4, 1.45, mt[2] * s], 2.9, 0.085, s > 0 ? 0 : 1);
    k.hexa([[-1.2, 1.56, 2.0 * s], [-2.6, 1.56, 2.0 * s], [-2.6, 1.56, 2.06 * s], [-1.2, 1.56, 2.06 * s],
      [-1.4, 1.28, 2.0 * s], [-2.4, 1.28, 2.0 * s], [-2.4, 1.28, 2.06 * s], [-1.4, 1.28, 2.06 * s]], color, L);
    k.box(-1.9, 1.25, 2.03 * s, 1.2, 0.07, 0.5, DARK, T);
    bomb(k, [-1.9, 1.05, 2.03 * s + 0.21], 1.55, 0.16, s > 0 ? 0 : 2);
    bomb(k, [-1.9, 1.05, 2.03 * s - 0.21], 1.55, 0.16, s > 0 ? 1 : 3);
  }
  k.box(-0.8, 1.2, 0, 3.4, 0.08, 0.12, DARK, T);
  bomb(k, [0.2, 1.0, 0], 1.55, 0.16, 4);
  bomb(k, [-1.8, 1.0, 0], 1.55, 0.16, 5);
  // Gear: nose folds forward, mains fold inward.
  gearLeg(k, [4.5, 1.36, 0], [4.56, 0.26, 0], 0.26, 0.15, [0, 0, 1.75], true);
  for (const s of [1, -1]) gearLeg(k, [-0.9, 1.3, 1.0 * s], [-1.0, 0.34, 1.22 * s], 0.34, 0.22, [1.6 * s, 0, 0]);
  // Probe, gun port, antennae, lights, insignia.
  k.tube([6.7, 1.7, 0], [7.4, 1.7, 0], 0.025, 0.012, METAL, CH, 6);
  k.box(3.7, 2.0, -0.5, 0.35, 0.06, 0.05, 0x111214, T);
  if (k.q > 0.8) {
    k.hexa([[-0.6, 2.35, -0.01], [-0.9, 2.35, -0.01], [-0.9, 2.35, 0.01], [-0.6, 2.35, 0.01],
      [-0.85, 2.55, -0.008], [-0.95, 2.55, -0.008], [-0.95, 2.55, 0.008], [-0.85, 2.55, 0.008]], DARK, T);
    for (const s of [1, -1]) surfacePatch(k, surf, 4.5, 5.0, s > 0 ? -0.2 : Math.PI + 0.2, s > 0 ? 0.25 : Math.PI - 0.25, trim, L, 0.008, 1, 1);
  }
  navLights(k, [-3.32, 1.6, -4.68], [-3.32, 1.6, 4.68], [-6.5, 1.85, 0], [-5.9, 3.62, 1.17]);
  for (const s of [1, -1]) {
    const sec = sectAt(wr, wt, 0.68);
    roundel(k, [sec.le[0] - sec.c * 0.45, 1.64, sec.le[2] * s], [0, 1, 0], 0.36, [trim === WHITE ? SAND : trim, DARK, ORANGE]);
  }
  return { nozzle: [-6.91, 1.78, 0.3], nozzleZ: 0.48, discs: [] };
}

function buildProp(k, gk, color, trim) {
  const keys = [[3.25, 1.25, 0.3, 0.32, 0.3, 2.2], [2.6, 1.25, 0.5, 0.52, 0.48, 2.4], [1.5, 1.28, 0.56, 0.6, 0.54, 2.5],
    [0.2, 1.32, 0.55, 0.6, 0.5, 2.4], [-1.3, 1.42, 0.38, 0.4, 0.36, 2.2], [-3.0, 1.53, 0.15, 0.2, 0.15, 2], [-3.8, 1.57, 0.05, 0.08, 0.05, 2]];
  k.loft(keys, color, L, {
    steps: 24, seg: 22, capEnds: true,
    col: (x, a, p) => (x > 2.35 ? [trim, L] : Math.abs(p[1] - 1.18) < 0.07 ? [trim, L] : x > -0.9 && x < 1.5 && p[1] > 1.86 ? [DARK, T] : [color, L]),
  });
  k.lathe([{ pts: [[0, 0.26], [0.12, 0.25], [0.32, 0.15], [0.46, 0.0]], hex: trim, cls: L }], 14, [3.24, 1.25, 0], [1, 0, 0]);
  glassLoft(k, gk, [[1.7, 1.82, 0.08, 0.03, 0.02, 2], [1.2, 1.84, 0.42, 0.28, 0.05, 2], [0.1, 1.86, 0.46, 0.38, 0.05, 2],
    [-0.9, 1.82, 0.38, 0.24, 0.05, 2], [-1.5, 1.79, 0.12, 0.06, 0.03, 2]]);
  pilot(k, 0.45, 2.02, 0);
  for (const s of [1, -1]) {
    k.tube([2.45, 1.0, 0.45 * s], [2.15, 0.95, 0.52 * s], 0.035, 0.035, 0x3a3532, A, 6);
  }
  k.box(2.75, 0.85, 0, 0.4, 0.06, 0.3, 0x111214, T);
  wingPair(k, { root: { le: [1.4, 0.95, 0.45], c: 1.75, t: 0.15 }, tip: { le: [1.05, 1.27, 5.2], c: 1.0, t: 0.12 }, hex: color, tipHex: trim, tipAt: 0.93,
    flap: [0.05, 0.45, 0.74], ail: [0.5, 0.9, 0.74] });
  wingPair(k, { root: { le: [-2.85, 1.5, 0.08], c: 0.85, t: 0.09 }, tip: { le: [-3.2, 1.52, 1.8], c: 0.5, t: 0.08 }, hex: color, elev: [0, 1, 0.6] });
  finPanel(k, { le: [-2.55, 1.62, 0], c: 1.25, t: 0.09 }, { le: [-3.35, 2.55, 0], c: 0.55, t: 0.08 }, color, [0, 0.95, 0.62], trim, 0.7);
  // Fixed gear with wheel pants.
  k.tube([2.3, 0.95, 0], [2.36, 0.22, 0], 0.04, 0.04, METAL, CH, 6);
  wheel(k, 2.36, 0.2, 0, 0.2, 0.12);
  for (const s of [1, -1]) {
    k.tube([0.4, 0.95, 0.65 * s], [0.3, 0.3, 1.25 * s], 0.05, 0.04, METAL, CH, 6);
    wheel(k, 0.3, 0.24, 1.25 * s, 0.24, 0.13);
    k.rbox(0.3, 0.3, 1.25 * s, 0.72, 0.34, 0.22, color, L, 0.5, 2.6);
  }
  navLights(k, [1.0, 1.28, -5.22], [1.0, 1.28, 5.22], [-3.82, 1.6, 0], [-3.3, 2.58, 0]);
  blades(k, [3.5, 1.25, 0], [1, 0, 0], 2, 0.95, 0.15, RIG.SPIN, 0x23262b, ORANGE, 0, 0.12);
  return { discs: [{ o: [3.52, 1.25, 0], d: [1, 0, 0], r: 0.95 }], prop: true };
}

function buildStunt(k, gk, color, trim) {
  const keys = [[2.45, 1.05, 0.42, 0.44, 0.42, 2], [2.1, 1.05, 0.46, 0.48, 0.46, 2.2], [0.8, 1.08, 0.44, 0.46, 0.46, 2.6],
    [-0.6, 1.14, 0.36, 0.4, 0.38, 2.6], [-2.2, 1.2, 0.14, 0.18, 0.14, 2.2], [-2.95, 1.22, 0.05, 0.08, 0.05, 2]];
  k.loft(keys, color, L, {
    steps: 20, seg: 20, capEnds: true,
    col: (x, a, p) => (x > 1.9 ? [METAL, A] : Math.abs(p[1] - 1.0) < 0.06 ? [trim, L] : x > -0.75 && x < 0.15 && p[1] > 1.45 ? [0x1a1714, T] : [color, L]),
  });
  // Radial engine front: dark face, cylinder heads, spinner.
  k.lathe([{ pts: [[0, 0], [0, 0.4]], hex: 0x1e1f21, cls: T }], 16, [2.46, 1.05, 0], [1, 0, 0]);
  if (k.q > 0.8) {
    for (let c = 0; c < 7; c++) {
      const a = (c / 7) * Math.PI * 2;
      k.tube([2.4, 1.05 + Math.sin(a) * 0.28, Math.cos(a) * 0.28], [2.4, 1.05 + Math.sin(a) * 0.42, Math.cos(a) * 0.42], 0.06, 0.05, STEEL, A, 6);
    }
  }
  k.lathe([{ pts: [[0, 0.17], [0.15, 0.15], [0.3, 0.06], [0.38, 0]], hex: trim, cls: L }], 12, [2.5, 1.05, 0], [1, 0, 0]);
  if (gk) gk.hexa([[0.25, 1.48, -0.24], [0.25, 1.48, 0.24], [0.1, 1.74, 0.17], [0.1, 1.74, -0.17],
    [0.27, 1.48, -0.24], [0.27, 1.48, 0.24], [0.12, 1.74, 0.17], [0.12, 1.74, -0.17]], 0xffffff, L);
  pilot(k, -0.35, 1.68, 0);
  k.rbox(-1.2, 1.46, 0, 1.1, 0.2, 0.36, color, L, 0.4, 2.4);
  const wcol = color;
  wingPair(k, { root: { le: [1.4, 0.72, 0.25], c: 1.2, t: 0.12 }, tip: { le: [1.35, 0.88, 3.1], c: 1.1, t: 0.1 }, hex: wcol, tipHex: trim, tipAt: 0.9, ail: [0.45, 0.9, 0.75] });
  wingPair(k, { root: { le: [2.0, 2.05, 0.02], c: 1.25, t: 0.12 }, tip: { le: [1.9, 2.1, 3.4], c: 1.12, t: 0.1 }, hex: wcol, tipHex: trim, tipAt: 0.9, ail: [0.45, 0.9, 0.75] });
  for (const s of [1, -1]) {
    k.tube([0.55, 0.86, 2.45 * s], [1.0, 2.07, 2.55 * s], 0.035, 0.035, DARK, T, 6);
    k.tube([1.3, 0.86, 2.45 * s], [1.75, 2.07, 2.55 * s], 0.035, 0.035, DARK, T, 6);
    k.tube([0.95, 1.45, 0.3 * s], [1.05, 2.04, 0.42 * s], 0.03, 0.03, DARK, T, 6);
    k.tube([1.55, 1.42, 0.3 * s], [1.7, 2.04, 0.42 * s], 0.03, 0.03, DARK, T, 6);
    if (k.q > 0.8) {
      k.tube([0.6, 0.9, 0.5 * s], [1.05, 2.05, 2.5 * s], 0.008, 0.008, METAL, CH, 4, false);
      k.tube([1.35, 0.9, 0.5 * s], [1.75, 2.05, 2.5 * s], 0.008, 0.008, METAL, CH, 4, false);
    }
    wheel(k, 1.45, 0.27, 0.85 * s, 0.27, 0.12);
    k.tube([1.45, 0.27, 0.78 * s], [1.15, 0.75, 0.32 * s], 0.035, 0.035, METAL, CH, 6);
    k.tube([1.45, 0.27, 0.78 * s], [1.8, 0.75, 0.32 * s], 0.03, 0.03, METAL, CH, 6);
  }
  wingPair(k, { root: { le: [-2.25, 1.22, 0.04], c: 0.72, t: 0.08 }, tip: { le: [-2.45, 1.22, 1.25], c: 0.45, t: 0.07 }, hex: color, elev: [0, 1, 0.58] });
  finPanel(k, { le: [-2.1, 1.3, 0], c: 0.9, t: 0.08 }, { le: [-2.7, 2.05, 0], c: 0.42, t: 0.07 }, color, [0, 0.95, 0.6], trim, 0.75);
  wheel(k, -2.7, 0.1, 0, 0.1, 0.06);
  k.tube([-2.7, 0.1, 0], [-2.5, 1.1, 0], 0.025, 0.025, METAL, CH, 5);
  navLights(k, [1.3, 2.12, -3.42], [1.3, 2.12, 3.42], [-2.98, 1.26, 0], null);
  blades(k, [2.72, 1.05, 0], [1, 0, 0], 2, 0.85, 0.14, RIG.SPIN, 0x5a3a22, trim, 0, 0.1);
  return { discs: [{ o: [2.74, 1.05, 0], d: [1, 0, 0], r: 0.85 }], prop: true };
}

function buildSeaplane(k, gk, color, trim) {
  const keys = [[3.4, 1.9, 0.36, 0.38, 0.36, 2.2], [2.6, 1.93, 0.58, 0.6, 0.56, 2.6], [1.2, 1.98, 0.64, 0.72, 0.66, 3],
    [-0.6, 2.04, 0.58, 0.66, 0.56, 2.8], [-2.4, 2.18, 0.3, 0.36, 0.28, 2.2], [-4.2, 2.3, 0.07, 0.12, 0.07, 2]];
  k.loft(keys, color, L, { steps: 24, seg: 22, capEnds: true, col: (x, a, p) => (x > 2.65 ? [trim, L] : Math.abs(p[1] - 1.82) < 0.06 ? [trim, L] : [color, L]) });
  const surf = loftSurface(keys);
  // Cabin windows (dark glass patches), windscreen glass.
  for (const s of [1, -1]) {
    const a0 = s > 0 ? 0.25 : Math.PI - 0.25, a1 = s > 0 ? 0.95 : Math.PI - 0.95;
    surfacePatch(k, surf, 1.75, 2.45, a0, a1, GLASS, G, 0.01, 2, 2);
    surfacePatch(k, surf, 0.55, 1.6, a0, a1, GLASS, G, 0.01, 2, 2);
    surfacePatch(k, surf, -0.5, 0.4, a0, a1 * 0.92 + a0 * 0.08, GLASS, G, 0.01, 2, 2);
  }
  surfacePatch(k, surf, 2.35, 2.75, 1.0, Math.PI - 1.0, GLASS, G, 0.012, 2, 3);
  k.lathe([{ pts: [[0, 0.26], [0.14, 0.24], [0.3, 0.14], [0.42, 0]], hex: trim, cls: L }], 12, [3.38, 1.9, 0], [1, 0, 0]);
  wingPair(k, { root: { le: [2.1, 2.74, 0.02], c: 1.85, t: 0.15 }, tip: { le: [1.85, 2.76, 5.8], c: 1.25, t: 0.12 }, hex: color, tipHex: trim, tipAt: 0.94,
    flap: [0.04, 0.45, 0.74], ail: [0.5, 0.9, 0.74] });
  wingPair(k, { root: { le: [-3.15, 2.32, 0.05], c: 0.95, t: 0.09 }, tip: { le: [-3.45, 2.32, 1.9], c: 0.55, t: 0.08 }, hex: color, elev: [0, 1, 0.6] });
  finPanel(k, { le: [-2.85, 2.4, 0], c: 1.35, t: 0.09 }, { le: [-3.75, 3.5, 0], c: 0.5, t: 0.08 }, color, [0, 0.95, 0.62], trim, 0.7);
  for (const s of [1, -1]) {
    k.tube([1.6, 1.55, 0.55 * s], [1.5, 2.66, 2.7 * s], 0.04, 0.04, METAL, CH, 6);
    k.tube([0.8, 1.55, 0.55 * s], [0.9, 2.66, 2.7 * s], 0.04, 0.04, METAL, CH, 6);
    // Floats with a chine, step and a water rudder.
    k.loft([[-3.1, 0.42, 0.06, 0.08, 0.04, 2.5], [-1.0, 0.32, 0.34, 0.24, 0.3, 3.2], [1.4, 0.3, 0.36, 0.26, 0.36, 3.4],
      [2.8, 0.44, 0.24, 0.2, 0.14, 3], [3.45, 0.58, 0.04, 0.04, 0.03, 2]], WHITE, L, { steps: 14, seg: 14, z: 1.35 * s, capEnds: true,
      col: (x, a, p) => [p[1] < 0.22 ? 0x7a2420 : WHITE, L] });
    k.box(0.2, 0.57, 1.35 * s, 3.4, 0.03, 0.12, trim, L);
    k.tube([1.7, 0.55, 1.3 * s], [1.7, 1.42, 0.5 * s], 0.045, 0.045, METAL, CH, 6);
    k.tube([-0.5, 0.55, 1.3 * s], [-0.5, 1.5, 0.45 * s], 0.045, 0.045, METAL, CH, 6);
    k.tube([-0.5, 0.55, 1.3 * s], [1.7, 1.42, 0.5 * s], 0.03, 0.03, METAL, CH, 6);
  }
  k.tube([1.7, 0.6, -1.3], [1.7, 0.6, 1.3], 0.04, 0.04, METAL, CH, 6);
  k.tube([-0.5, 0.6, -1.3], [-0.5, 0.6, 1.3], 0.04, 0.04, METAL, CH, 6);
  navLights(k, [1.3, 2.78, -5.82], [1.3, 2.78, 5.82], [-4.22, 2.34, 0], [-3.7, 3.53, 0]);
  blades(k, [3.72, 1.9, 0], [1, 0, 0], 3, 1.0, 0.16, RIG.SPIN, 0x23262b, ORANGE, 0, 0.12);
  return { discs: [{ o: [3.74, 1.9, 0], d: [1, 0, 0], r: 1.0 }], prop: true };
}

function buildJet(k, gk, color, trim) {
  const keys = [[6.3, 1.48, 0.03, 0.03, 0.03, 2], [5.6, 1.56, 0.36, 0.4, 0.3, 2], [4.4, 1.7, 0.72, 0.76, 0.66, 2.1],
    [3.0, 1.76, 0.86, 0.9, 0.86, 2.15], [-2.5, 1.78, 0.86, 0.9, 0.86, 2.15], [-4.4, 1.92, 0.62, 0.66, 0.56, 2.1],
    [-5.9, 2.1, 0.22, 0.28, 0.18, 2], [-6.4, 2.16, 0.06, 0.08, 0.05, 2]];
  k.loft(keys, color, L, { steps: 34, seg: 26, capEnds: true, col: (x, a, p) => (Math.abs(p[1] - 1.55) < 0.08 && x < 4.8 ? [trim, L] : p[1] < 1.2 ? [shade(color, 0.9), L] : [color, L]) });
  const surf = loftSurface(keys);
  // Windscreen and cabin windows (dark glass on the skin).
  surfacePatch(k, surf, 4.35, 4.95, 0.55, Math.PI - 0.55, GLASS, G, 0.012, 2, 4);
  for (const s of [1, -1]) {
    surfacePatch(k, surf, 4.0, 4.45, s > 0 ? 0.35 : Math.PI - 0.35, s > 0 ? 0.75 : Math.PI - 0.75, GLASS, G, 0.012, 1, 1);
    for (let i = 0; i < 6; i++) {
      const x = 2.6 - i * 0.82;
      surfacePatch(k, surf, x - 0.17, x + 0.17, s > 0 ? 0.2 : Math.PI - 0.2, s > 0 ? 0.48 : Math.PI - 0.48, GLASS, G, 0.01, 1, 1);
    }
    if (k.q > 0.8) surfacePatch(k, surf, 3.15, 3.75, s > 0 ? -0.3 : Math.PI + 0.3, s > 0 ? 0.5 : Math.PI - 0.5, shade(color, 0.86), L, 0.006, 1, 2);
  }
  wingPair(k, { root: { le: [1.4, 1.15, 0.5], c: 3.1, t: 0.12 }, tip: { le: [-1.75, 1.5, 5.9], c: 1.0, t: 0.09 }, hex: color, flap: [0.05, 0.5, 0.74], ail: [0.55, 0.92, 0.74] });
  for (const s of [1, -1]) {
    k.hexa([[-1.72, 1.5, 5.86 * s], [-2.7, 1.5, 5.86 * s], [-2.7, 1.5, 5.93 * s], [-1.72, 1.5, 5.93 * s],
      [-2.4, 2.3, 6.05 * s], [-2.95, 2.3, 6.05 * s], [-2.95, 2.3, 6.1 * s], [-2.4, 2.3, 6.1 * s]], trim, L);
    // Engine nacelle: chrome intake lip, body, exhaust cone, pylon.
    k.lathe([
      { pts: [[-0.02, 0.0], [-0.02, 0.33]], hex: 0x202226, cls: T },
      { pts: [[-0.02, 0.33], [0.03, 0.43], [0.12, 0.47]], hex: 0xc8ccd0, cls: CH },
      { pts: [[0.12, 0.47], [0.8, 0.49], [1.6, 0.44], [2.05, 0.36]], hex: color, cls: L },
      { pts: [[2.05, 0.36], [2.05, 0.3]], hex: STEEL, cls: A },
      { pts: [[2.05, 0.3], [2.3, 0.15], [2.4, 0.0]], hex: 0x3a3632, cls: A },
    ], 18, [-2.45, 2.3, 1.42 * s], [-1, 0, 0]);
    k.hexa([[-3.0, 2.2, 0.75 * s], [-4.2, 2.2, 0.75 * s], [-4.2, 2.36, 0.75 * s], [-3.0, 2.36, 0.75 * s],
      [-3.1, 2.24, 1.1 * s], [-4.1, 2.24, 1.1 * s], [-4.1, 2.34, 1.1 * s], [-3.1, 2.34, 1.1 * s]], color, L);
    gearLeg(k, [-0.7, 1.2, 1.1 * s], [-0.85, 0.32, 1.35 * s], 0.32, 0.2, [1.5 * s, 0, 0]);
  }
  gearLeg(k, [4.35, 1.2, 0], [4.35, 0.24, 0], 0.24, 0.12, [0, 0, -1.6], true);
  finPanel(k, { le: [-3.9, 2.55, 0], c: 2.2, t: 0.1 }, { le: [-5.5, 3.8, 0], c: 1.25, t: 0.09 }, color, [0.05, 0.95, 0.7], trim, 0.75);
  wingPair(k, { root: { le: [-5.35, 3.82, 0.02], c: 1.35, t: 0.08 }, tip: { le: [-6.4, 3.88, 2.3], c: 0.65, t: 0.07 }, hex: color, elev: [0, 1, 0.66] });
  navLights(k, [-1.75, 1.52, -5.88], [-1.75, 1.52, 5.88], [-6.42, 2.18, 0], [-6.3, 3.9, 0]);
  if (k.q > 0.8) k.box(-0.5, 2.71, 0, 0.18, 0.08, 0.1, RED_L, GL);
  return { discs: [] };
}

// Frame bars over a glass loft: a centre bar and side bars, plus a door
// pillar ring at the rear of the glass.
function canopyFrame(k, gkeys, x0, x1) {
  if (k.q < 0.8) return;
  const surf = loftSurface(gkeys);
  for (const a of [Math.PI / 2, 0.35, Math.PI - 0.35, -0.25, Math.PI + 0.25]) {
    const pts = [];
    for (let i = 0; i <= 8; i++) pts.push(surf(x0 + (x1 - x0) * (i / 8), a, 0.01));
    k.sweep(pts, 0.022, DARK, T, 5, false);
  }
  const ring = [];
  for (let j = 0; j <= 16; j++) ring.push(surf(x0 + 0.04, -0.6 + (j / 16) * (Math.PI + 1.2), 0.015));
  k.sweep(ring, 0.04, DARK, T, 5, false);
}

// Helicopter parts: skids, rotor hub + blades, tail rotor.
function skids(k, x0, x1, z, y, legs) {
  for (const s of [1, -1]) {
    k.sweep([[x0, y, z * s], [x1, y, z * s], [x1 + 0.25, y + 0.1, z * s], [x1 + 0.38, y + 0.28, z * s]], 0.045, DARK, T, 6);
    for (const [lx, ly] of legs) k.sweep([[lx, y, z * s], [lx + 0.04, y + 0.3, z * s * 0.9], [lx + 0.1, ly, z * s * 0.5]], 0.04, DARK, T, 6, false);
  }
}

function rotorHead(k, o, n, r, chord, bladeHex, tipHex, cone) {
  k.tube([o[0], o[1] - 0.5, o[2]], [o[0], o[1], o[2]], 0.09, 0.07, STEEL, A, 8);
  k.setRig(RIG.SPIN, o, [0, 1, 0]);
  k.lathe([{ pts: [[0, 0.2], [0.12, 0.22], [0.2, 0.08]], hex: STEEL, cls: A }, { pts: [[0, 0], [0, 0.2]], hex: STEEL, cls: A }], 10, [o[0], o[1] - 0.06, o[2]], [0, 1, 0]);
  for (let b = 0; b < n; b++) {
    const a = (b / n) * Math.PI * 2;
    k.tube([o[0], o[1] + 0.04, o[2]], [o[0] + Math.cos(a) * 0.42, o[1] + 0.05, o[2] + Math.sin(a) * 0.42], 0.06, 0.05, DARK, T, 6);
  }
  k.noRig();
  blades(k, [o[0], o[1] + 0.05, o[2]], [0, 1, 0], n, r, chord, RIG.SPIN, bladeHex, tipHex, cone, 0.4);
}

function tailRotor(k, o, r, n, side) {
  k.setRig(RIG.SPIN2, o, [0, 0, side]);
  k.lathe([{ pts: [[0, 0.07], [0.12, 0.07], [0.12, 0]], hex: STEEL, cls: A }], 8, [o[0], o[1], o[2] - 0.06 * side], [0, 0, side]);
  k.noRig();
  blades(k, o, [0, 0, side], n, r, 0.13, RIG.SPIN2, 0x24272b, WHITE, 0, 0.08);
}

function buildHeli(k, gk, color, trim) {
  const keys = [[0.6, 1.32, 0.82, 0.84, 0.64, 2.4], [-0.8, 1.42, 0.78, 0.82, 0.62, 2.6], [-1.6, 1.62, 0.38, 0.5, 0.3, 2.2]];
  k.loft(keys, color, L, { steps: 10, seg: 22, capEnds: true, col: (x, a, p) => (p[1] < 0.95 ? [shade(color, 0.6), L] : Math.abs(p[1] - 1.12) < 0.08 ? [trim, L] : [color, L]) });
  const gkeys = [[0.6, 1.32, 0.82, 0.84, 0.64, 2.4], [1.5, 1.28, 0.72, 0.72, 0.56, 2.2], [2.1, 1.2, 0.42, 0.42, 0.34, 2.1], [2.35, 1.14, 0.06, 0.06, 0.05, 2]];
  glassLoft(k, gk, gkeys);
  canopyFrame(k, gkeys, 0.6, 2.3);
  k.loft([[0.55, 0.86, 0.76, 0.2, 0.2, 3], [1.6, 0.84, 0.6, 0.18, 0.18, 3], [2.25, 0.96, 0.22, 0.1, 0.1, 2.5]], shade(color, 0.6), L, { steps: 6, seg: 14, capEnds: true });
  if (k.q > 0.8) {
    pilot(k, 1.05, 1.62, 0.32);
    k.rbox(0.95, 1.2, 0.32, 0.5, 0.5, 0.48, 0x2b2e33, T, 0.3, 3);
    k.rbox(0.95, 1.2, -0.32, 0.5, 0.5, 0.48, 0x2b2e33, T, 0.3, 3);
    k.box(1.65, 1.38, 0, 0.3, 0.2, 0.9, 0x1d1f22, T);
  }
  k.loft([[-1.8, 2.18, 0.22, 0.16, 0.05, 2.6], [-0.9, 2.26, 0.48, 0.26, 0.05, 3], [0.3, 2.26, 0.48, 0.24, 0.05, 3], [0.8, 2.18, 0.2, 0.1, 0.05, 2.6]], color, L, { steps: 8, seg: 14, capEnds: true });
  k.box(-0.4, 2.4, 0.5, 0.6, 0.12, 0.02, 0x111214, T);
  k.loft([[-5.8, 1.84, 0.07, 0.09, 0.07, 2], [-1.4, 1.66, 0.22, 0.26, 0.22, 2]], color, L, { steps: 6, seg: 12 });
  finPanel(k, { le: [-5.25, 1.8, 0], c: 0.7, t: 0.12 }, { le: [-5.95, 2.75, 0], c: 0.45, t: 0.1 }, trim, null);
  finPanel(k, { le: [-5.35, 1.86, 0], c: 0.55, t: 0.12 }, { le: [-5.7, 1.2, 0], c: 0.38, t: 0.1 }, trim, null);
  wingPair(k, { root: { le: [-4.4, 1.78, 0.05], c: 0.5, t: 0.1 }, tip: { le: [-4.5, 1.78, 0.75], c: 0.4, t: 0.1 }, hex: color });
  skids(k, -1.3, 1.9, 0.98, 0.045, [[1.1, 0.75], [-0.6, 0.8]]);
  navLights(k, [-4.5, 1.8, -0.78], [-4.5, 1.8, 0.78], [-5.82, 1.88, 0], [-0.4, 2.52, 0]);
  rotorHead(k, [-0.1, 2.86, 0], 2, 4.2, 0.24, 0x23262b, WHITE, 0.03);
  tailRotor(k, [-5.72, 1.86, 0.2], 0.68, 2, 1);
  return { discs: [{ o: [-0.1, 2.93, 0], d: [0, 1, 0], r: 4.2 }, { o: [-5.72, 1.86, 0.22], d: [0, 0, 1], r: 0.68 }], rotor: true };
}

function buildHeavyHeli(k, gk, color, trim) {
  const keys = [[4.6, 1.35, 0.3, 0.3, 0.28, 2], [3.9, 1.5, 0.82, 0.86, 0.72, 2.3], [2.6, 1.72, 1.05, 1.1, 0.9, 2.8],
    [-2.4, 1.78, 1.05, 1.12, 0.92, 3], [-3.6, 2.15, 0.6, 0.62, 0.4, 2.6], [-4.0, 2.3, 0.4, 0.45, 0.28, 2.4]];
  k.loft(keys, color, L, { steps: 28, seg: 26, capEnds: true, col: (x, a, p) => (Math.abs(p[1] - 1.42) < 0.08 ? [trim, L] : p[1] < 1.0 ? [shade(color, 0.78), L] : [color, L]) });
  const surf = loftSurface(keys);
  surfacePatch(k, surf, 3.55, 4.35, 0.5, Math.PI - 0.5, GLASS, G, 0.012, 2, 4);
  for (const s of [1, -1]) {
    surfacePatch(k, surf, 3.0, 3.85, s > 0 ? -0.15 : Math.PI + 0.15, s > 0 ? 0.5 : Math.PI - 0.5, GLASS, G, 0.012, 2, 2);
    for (let i = 0; i < 4; i++) {
      const x = 1.6 - i * 1.15;
      surfacePatch(k, surf, x - 0.3, x + 0.3, s > 0 ? 0.1 : Math.PI - 0.1, s > 0 ? 0.55 : Math.PI - 0.55, GLASS, G, 0.012, 1, 1);
    }
    if (k.q > 0.8) surfacePatch(k, surf, -2.0, -0.2, s > 0 ? -0.5 : Math.PI + 0.5, s > 0 ? 0.62 : Math.PI - 0.62, shade(color, 0.85), L, 0.006, 1, 2);
    // Engine pods with dark intakes and exhausts.
    k.lathe([
      { pts: [[0, 0], [0, 0.26]], hex: 0x15161a, cls: T },
      { pts: [[0, 0.26], [0.1, 0.34], [1.6, 0.36], [2.4, 0.3]], hex: color, cls: L },
      { pts: [[2.4, 0.3], [2.4, 0]], hex: 0x2a2624, cls: T },
    ], 14, [1.2, 3.05, 0.62 * s], [-1, 0, 0]);
    k.tube([-1.25, 3.05, 0.62 * s], [-1.6, 3.15, 0.95 * s], 0.18, 0.2, 0x3a3632, A, 10);
    // Sponsons, gear, bomb pylons.
    k.rbox(-0.9, 0.85, 1.2 * s, 2.4, 0.4, 0.75, color, L, 0.4, 3);
    k.tube([-1.4, 0.85, 1.3 * s], [-1.4, 0.38, 1.45 * s], 0.08, 0.07, METAL, CH, 6);
    wheel(k, -1.4, 0.38, 1.45 * s, 0.38, 0.26);
    k.tube([3.1, 0.95, 0.35 * s], [3.1, 0.28, 0.42 * s], 0.06, 0.06, METAL, CH, 6);
    wheel(k, 3.1, 0.28, 0.45 * s, 0.28, 0.18);
    k.box(-0.6, 0.62, 1.42 * s, 1.0, 0.1, 0.08, DARK, T);
    bomb(k, [-0.1, 0.42, 1.45 * s], 1.3, 0.15, s > 0 ? 0 : 1);
    bomb(k, [-1.2, 0.42, 1.45 * s], 1.3, 0.15, s > 0 ? 2 : 3);
  }
  k.loft([[-3.9, 2.95, 0.3, 0.2, 0.05, 2.6], [-2.4, 3.05, 0.95, 0.38, 0.05, 3], [1.5, 3.05, 0.95, 0.36, 0.05, 3], [2.4, 2.9, 0.4, 0.2, 0.05, 2.6]], color, L, { steps: 8, seg: 16, capEnds: true });
  k.loft([[-8.6, 2.92, 0.12, 0.14, 0.1, 2], [-3.7, 2.4, 0.42, 0.48, 0.32, 2.2]], color, L, { steps: 8, seg: 14 });
  finPanel(k, { le: [-7.6, 2.85, 0], c: 1.2, t: 0.14 }, { le: [-9.1, 4.25, 0], c: 0.85, t: 0.12 }, color, [0.05, 0.9, 0.7], trim, 0.85);
  wingPair(k, { root: { le: [-7.3, 2.9, 0.08], c: 0.85, t: 0.1 }, tip: { le: [-7.55, 2.95, 1.6], c: 0.6, t: 0.09 }, hex: color });
  navLights(k, [-7.6, 2.95, -1.6], [-7.6, 2.95, 1.6], [-8.62, 2.95, 0], [-1.0, 3.48, 0]);
  rotorHead(k, [0.3, 3.95, 0], 4, 6.5, 0.42, 0x23262b, ORANGE, 0.035);
  tailRotor(k, [-8.9, 3.75, 0.25], 1.1, 4, 1);
  return { discs: [{ o: [0.3, 4.02, 0], d: [0, 1, 0], r: 6.5 }, { o: [-8.9, 3.75, 0.27], d: [0, 0, 1], r: 1.1 }], rotor: true };
}

// Police livery: white all over (it is mostly seen from below, against a
// dark city or a night sky), a bold blue band, blue tail band and fin.
const POLICE_BLUE = 0x1d56d0;
function buildPatrolHeli(k, gk, color) {
  const keys = [[0.6, 1.38, 0.94, 0.96, 0.72, 2.5], [-0.9, 1.46, 0.9, 0.94, 0.7, 2.7], [-2.1, 1.68, 0.4, 0.52, 0.32, 2.2]];
  k.loft(keys, color, L, {
    steps: 12, seg: 24, capEnds: true,
    col: (x, a, p) => (p[1] < 0.98 || p[1] > 1.26 ? [color, L] : [POLICE_BLUE, L]),
  });
  const gkeys = [[0.6, 1.38, 0.94, 0.96, 0.72, 2.5], [1.6, 1.3, 0.86, 0.86, 0.64, 2.3], [2.4, 1.2, 0.56, 0.58, 0.45, 2.2], [2.8, 1.12, 0.1, 0.1, 0.08, 2]];
  glassLoft(k, gk, gkeys);
  canopyFrame(k, gkeys, 0.6, 2.75);
  k.loft([[0.55, 0.88, 0.9, 0.22, 0.24, 3], [1.8, 0.86, 0.72, 0.2, 0.22, 3], [2.6, 0.98, 0.32, 0.12, 0.12, 2.5]], color, L, { steps: 6, seg: 14, capEnds: true });
  if (k.q > 0.8) {
    pilot(k, 1.45, 1.74, 0.38);
    pilot(k, 1.45, 1.74, -0.38);
    k.box(2.1, 1.45, 0, 0.32, 0.22, 1.1, 0x1d1f22, T);
  }
  k.loft([[-2.0, 2.4, 0.26, 0.18, 0.05, 2.6], [-1.0, 2.5, 0.55, 0.28, 0.05, 3], [0.5, 2.5, 0.55, 0.26, 0.05, 3], [1.0, 2.42, 0.24, 0.12, 0.05, 2.6]], color, L, { steps: 8, seg: 14, capEnds: true });
  k.loft([[-6.4, 2.0, 0.09, 0.11, 0.09, 2], [-1.8, 1.78, 0.27, 0.32, 0.25, 2.2]], color, L, {
    steps: 8, seg: 14, col: (x) => (x > -4.4 && x < -2.6 ? [POLICE_BLUE, L] : [color, L]),
  });
  // Shrouded tail fan in the fin.
  k.lathe([
    { pts: [[0, 0.62], [0.3, 0.62]], hex: 0x15171a, cls: T },
    { pts: [[0.3, 0.62], [0.3, 0.78]], hex: color, cls: L },
    { pts: [[0.3, 0.78], [0, 0.78]], hex: color, cls: L },
    { pts: [[0, 0.78], [0, 0.62]], hex: color, cls: L },
  ], 18, [-6.85, 2.15, -0.15], [0, 0, 1]);
  finPanel(k, { le: [-6.0, 2.4, 0], c: 1.4, t: 0.2 }, { le: [-7.2, 3.35, 0], c: 0.7, t: 0.12 }, POLICE_BLUE, null, color, 0.8);
  wingPair(k, { root: { le: [-4.9, 1.93, 0.08], c: 0.55, t: 0.1 }, tip: { le: [-5.0, 1.93, 0.95], c: 0.42, t: 0.1 }, hex: color });
  // Chin gun pod and the gimballed searchlight.
  k.lathe([{ pts: [[0, 0], [0, 0.17], [0.55, 0.17], [0.7, 0.08], [0.72, 0]], hex: DARK, cls: T }], 10, [1.75, 0.6, 0.45], [1, 0, 0]);
  k.tube([2.45, 0.6, 0.45], [3.0, 0.6, 0.45], 0.035, 0.03, 0x1a1b1d, A, 6);
  k.tube([2.35, 0.82, -0.3], [2.35, 0.66, -0.3], 0.05, 0.05, DARK, T, 6);
  k.lathe([{ pts: [[0, 0], [0, 0.18], [0.3, 0.2]], hex: DARK, cls: T }, { pts: [[0.3, 0.2], [0.3, 0]], hex: 0xfff4d8, cls: GL }], 12, [2.2, 0.5, -0.3], [0.5, -0.86, 0]);
  skids(k, -1.4, 2.25, 1.1, 0.05, [[1.3, 0.82], [-0.8, 0.86]]);
  navLights(k, [-5.0, 1.95, -0.98], [-5.0, 1.95, 0.98], [-7.4, 3.38, 0], [-0.4, 2.8, 0]);
  rotorHead(k, [-0.2, 3.12, 0], 4, 4.8, 0.28, 0x23262b, WHITE, 0.03);
  tailRotor(k, [-6.85, 2.15, -0.02], 0.58, 6, 1);
  return {
    discs: [{ o: [-0.2, 3.2, 0], d: [0, 1, 0], r: 4.8 }], rotor: true,
    lightbar: [-2.9, 2.18, 0], spot: [2.37, 0.34, -0.3],
  };
}

const BUILDERS = {
  prop: buildProp, stunt: buildStunt, seaplane: buildSeaplane, jet: buildJet,
  heli: buildHeli, heavyheli: buildHeavyHeli, fighter: buildFighter, patrolheli: buildPatrolHeli,
};

// ---- extras: afterburner glow, light bar, spotlight beam ----------------------
const EXTRA_MAT = {
  glow: new THREE.MeshBasicMaterial({
    vertexColors: true, transparent: true, depthWrite: false, toneMapped: false, side: THREE.DoubleSide, fog: false,
  }),
  lamp: new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false }),
};

// The searchlight beam: a faint lit volume, not a solid cone. The cone
// mesh only marks which pixels the beam can touch (its back faces: one
// fragment per pixel, from outside or inside); each pixel then takes the
// light along its view ray from how close that ray passes to the beam's
// axis (a soft round falloff, no hard rim), brightest near the lamp, and
// none near the camera (the beam is usually aimed at the player, so the
// camera often sits in it) or at the far end (the light pool on the ground
// takes over there; nightlights.js). Additive, one thin pass.
// uK: strength (spot ramp x day/night); uA / uD: apex and unit direction
// in world space; uL: (length, half-angle tangent).
const BEAM_VS = `
varying vec3 vW;
void main() {
	vec4 w = modelMatrix * vec4( position, 1.0 );
	vW = w.xyz;
	gl_Position = projectionMatrix * viewMatrix * w;
}`;
const BEAM_FS = `
uniform float uK;
uniform vec3 uCol;
uniform vec3 uA;
uniform vec3 uD;
uniform vec2 uL;
varying vec3 vW;
void main() {
	vec3 rd = vW - cameraPosition;
	float tMax = length( rd );
	rd /= tMax;
	vec3 w0 = cameraPosition - uA;
	float b = dot( rd, uD ), d = dot( rd, w0 ), e = dot( uD, w0 );
	float den = max( 1.0 - b * b, 1e-4 );
	float tr = clamp( ( b * e - d ) / den, 0.0, tMax );
	vec3 p = cameraPosition + rd * tr;
	float s = clamp( dot( p - uA, uD ), 0.0, uL.x );
	float q = length( p - ( uA + uD * s ) ) / ( 0.2 + s * uL.y );
	float u = s / uL.x;
	float along = mix( 1.0, 0.22, sqrt( u ) ) * smoothstep( 0.0, 0.03, u ) * ( 1.0 - smoothstep( 0.8, 1.0, u ) );
	float near = smoothstep( 3.0, 12.0, tr );
	gl_FragColor = vec4( uCol, uK * exp( - q * q * 3.5 ) * along * near );
}`;
function beamMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: {
      uK: { value: 0 }, uCol: { value: new THREE.Color(1, 0.93, 0.8) },
      uA: { value: new THREE.Vector3() }, uD: { value: new THREE.Vector3(0, -1, 0) }, uL: { value: new THREE.Vector2(1, 0.06) },
    },
    vertexShader: BEAM_VS, fragmentShader: BEAM_FS,
    transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.BackSide, fog: false, toneMapped: false,
  });
}
// Beam half-angle (tangent): a narrow searchlight. The ground pool
// (nightlights.js, spotUniforms) uses the same cone.
export const BEAM_TAN = 0.06;

// Small soft glows: light bar flashes and the searchlight lens. A fixed
// size on screen (about 14 px on a 412 px tall view for the bar), so they
// read at 120 m and never cover the screen up close.
let glowTex = null;
function glowTexture() {
  if (glowTex) return glowTex;
  const S = 32, px = new Uint8Array(S * S * 4);
  for (let j = 0; j < S; j++) {
    for (let i = 0; i < S; i++) {
      const x = (i + 0.5) / S * 2 - 1, y = (j + 0.5) / S * 2 - 1;
      const r = Math.min(1, Math.sqrt(x * x + y * y));
      const a = Math.pow(1 - r, 2.2) * 0.85 + Math.max(0, 1 - r * 4) * 0.15;
      const o = (j * S + i) * 4;
      px[o] = px[o + 1] = px[o + 2] = 255;
      px[o + 3] = Math.round(255 * Math.min(1, a));
    }
  }
  glowTex = new THREE.DataTexture(px, S, S, THREE.RGBAFormat);
  glowTex.magFilter = THREE.LinearFilter;
  glowTex.minFilter = THREE.LinearFilter;
  glowTex.needsUpdate = true;
  return glowTex;
}
function glowSprite(hex, size) {
  const m = new THREE.SpriteMaterial({
    map: glowTexture(), color: hex, transparent: true, blending: THREE.AdditiveBlending,
    depthWrite: false, sizeAttenuation: false, toneMapped: false, fog: false,
  });
  const sp = new THREE.Sprite(m);
  sp.scale.set(size, size, 1);
  sp.renderOrder = 7;
  sp.visible = false;
  sp.userData.size = size;
  return sp;
}
let extraGeo = null;
// Unit afterburner plume along -x: an outer orange cone, an inner white
// core and shock diamonds, vertex colours fading to black (additive).
function plumeGeometry() {
  const pos = [], col = [], idx = [];
  const seg = 14;
  const add = (len, r0, r1, c0, c1, x0 = 0) => {
    const base = pos.length / 3;
    for (let i = 0; i <= 1; i++) {
      const x = x0 - len * i, r = i ? r1 : r0, c = i ? c1 : c0;
      for (let j = 0; j <= seg; j++) {
        const a = (j / seg) * Math.PI * 2;
        pos.push(x, Math.sin(a) * r, Math.cos(a) * r);
        col.push(c[0], c[1], c[2], c[3]);
      }
    }
    for (let j = 0; j < seg; j++) idx.push(base + j, base + seg + 1 + j, base + j + 1, base + j + 1, base + seg + 1 + j, base + seg + 2 + j);
  };
  add(1, 0.95, 0.15, [1, 0.5, 0.16, 0.42], [1, 0.3, 0.08, 0]);
  add(0.45, 0.6, 0.05, [1, 0.92, 0.75, 0.75], [1, 0.6, 0.3, 0]);
  for (let d = 0; d < 3; d++) add(0.07, 0.42 - d * 0.08, 0.3 - d * 0.06, [1, 0.8, 0.55, 0.55], [1, 0.7, 0.4, 0.45], -0.16 - d * 0.18);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 4));
  g.setIndex(idx);
  return g;
}
function extraGeometry() {
  if (extraGeo) return extraGeo;
  // Light bar: housing with dark lenses (always there), and one lit lens
  // per side shown while that side flashes.
  const lk = new Kit(1);
  lk.box(0, 0, 0, 0.34, 0.08, 1.3, 0x202226, T);
  lk.box(0, 0.1, -0.33, 0.3, 0.14, 0.56, 0x4a1414, T);
  lk.box(0, 0.1, 0.33, 0.3, 0.14, 0.56, 0x14224a, T);
  const rk = new Kit(1);
  rk.box(0, 0.1, -0.33, 0.31, 0.15, 0.57, 0xff2418, GL);
  const bk = new Kit(1);
  bk.box(0, 0.1, 0.33, 0.31, 0.15, 0.57, 0x2a66ff, GL);
  // Open cone (no end cap: a cap drew a flat white disc on the ground).
  const beam = new THREE.CylinderGeometry(0.02, 1, 1, 24, 1, true);
  beam.translate(0, -0.5, 0);
  extraGeo = { glow: plumeGeometry(), lightbar: buildKit(lk), lensR: buildKit(rk), lensB: buildKit(bk), beam };
  return extraGeo;
}
const Q1 = new THREE.Quaternion();
const Q2 = new THREE.Quaternion();
const V1 = new THREE.Vector3();
const V2 = new THREE.Vector3();
const DOWN = new THREE.Vector3(0, -1, 0);
const BEAM_TILT = 0.55; // rad forward of straight down when not aimed
const BEAM_MAX = 170; // metres

// Light bar flash pattern at 6 Hz: red side, off, blue side, off.
export function lightbarPhase(time) {
  const k = Math.floor((Number.isFinite(time) ? time : 0) * 6) & 3;
  return k;
}
// Flash levels 0..1 of the red and blue sides at `time`: each side
// double-flashes in its half of a 0.8 s cycle, with soft edges (no
// one-frame pops), so the two colours read clearly and never mix.
const FLASH = { r: 0, b: 0 };
export function lightbarLevels(time, out = FLASH) {
  const u = (((Number.isFinite(time) ? time : 0) / 0.8) % 1 + 1) % 1;
  const side = u < 0.5 ? 0 : 1, w = (u - side * 0.5) * 4; // two flashes per half
  const f = w % 1;
  const lvl = f < 0.7 ? Math.sin((f / 0.7) * Math.PI) : 0;
  out.r = side === 0 ? lvl : 0;
  out.b = side === 1 ? lvl : 0;
  return out;
}

// ---- caches ---------------------------------------------------------------------
const bodyCache = new Map();

function bodyEntry(spec, color) {
  const key = spec.id + ':' + color;
  let e = bodyCache.get(key);
  if (!e) {
    const build = BUILDERS[spec.id] || (spec.kind === 'heli' ? buildHeli : buildProp);
    const trim = trimFor(color);
    const k = new Kit(1), gk = new Kit(1);
    const layout = build(k, gk, color, trim);
    const kf = new Kit(0.45);
    build(kf, null, color, trim);
    e = {
      geometry: buildKit(k), glass: gk.count ? buildKit(gk) : null, far: buildKit(kf), layout,
      discs: layout.discs && layout.discs.length ? discGeometry(layout.discs) : null,
      tris: k.i.length / 3 + gk.i.length / 3, farTris: kf.i.length / 3,
    };
    bodyCache.set(key, e);
  }
  return e;
}

// Triangle counts of one aircraft (near, far) for tools and tests.
export function aircraftStats(spec, color) {
  const e = bodyEntry(spec, color == null ? spec.colors[0] : color);
  return { tris: e.tris, farTris: e.farTris };
}

// ---- public API -------------------------------------------------------------------
export function createAircraftMesh(spec, color) {
  const group = new THREE.Group();
  const col = color == null ? spec.colors[0] : color;
  const entry = bodyEntry(spec, col);
  const skin = createSkin(spec.id === 'fighter' ? 'jet' : 'air');
  const near = new THREE.Group();
  const body = new THREE.Mesh(entry.geometry, skin);
  const depth = skinDepth(skin);
  body.customDepthMaterial = depth;
  near.add(body);
  let glass = null, disc = null;
  if (entry.glass) {
    glass = new THREE.Mesh(entry.glass, glassMaterial());
    glass.renderOrder = 2;
    near.add(glass);
  }
  if (entry.discs) {
    disc = new THREE.Mesh(entry.discs, discMaterial());
    disc.visible = false;
    disc.renderOrder = 3;
    near.add(disc);
  }
  const lod = new THREE.LOD();
  lod.addLevel(near, 0);
  const farMesh = new THREE.Mesh(entry.far, skin);
  farMesh.customDepthMaterial = depth;
  lod.addLevel(farMesh, LOD_FAR);
  group.add(lod);

  const lay = entry.layout;
  let glow = null, lightbar = null, beam = null, bar = null, lensGlow = null;
  if (lay.nozzle || lay.lightbar || lay.spot) {
    const xg = extraGeometry();
    if (lay.nozzle) {
      glow = new THREE.Group();
      for (const s of [1, -1]) {
        const m = new THREE.Mesh(xg.glow, EXTRA_MAT.glow);
        m.position.set(0, 0, lay.nozzleZ * s);
        glow.add(m);
      }
      glow.position.set(lay.nozzle[0], lay.nozzle[1], 0);
      glow.visible = false;
      glow.renderOrder = 4;
      glow.userData.r = lay.nozzle[2];
      group.add(glow);
    }
    if (lay.lightbar) {
      // `lightbar` is the group (shown while the siren runs); its lit
      // lenses and glows flash by side (lightbarLevels).
      lightbar = new THREE.Group();
      lightbar.position.set(lay.lightbar[0], lay.lightbar[1], lay.lightbar[2]);
      lightbar.add(new THREE.Mesh(xg.lightbar, EXTRA_MAT.lamp));
      const lr = new THREE.Mesh(xg.lensR, EXTRA_MAT.lamp), lb = new THREE.Mesh(xg.lensB, EXTRA_MAT.lamp);
      const gr = glowSprite(0xff2a1e, 0.04), gb = glowSprite(0x3a72ff, 0.04);
      gr.position.set(0, 0.16, -0.36);
      gb.position.set(0, 0.16, 0.36);
      lr.visible = lb.visible = false;
      lightbar.add(lr, lb, gr, gb);
      lightbar.visible = false;
      bar = { lr, lb, gr, gb };
      group.add(lightbar);
    }
    if (lay.spot) {
      beam = new THREE.Mesh(xg.beam, beamMaterial());
      beam.position.set(lay.spot[0], lay.spot[1], lay.spot[2]);
      beam.visible = false;
      beam.frustumCulled = false;
      beam.renderOrder = 6;
      group.add(beam);
      lensGlow = glowSprite(0xfff0d2, 0.05);
      lensGlow.position.set(lay.spot[0], lay.spot[1] - 0.05, lay.spot[2]);
      group.add(lensGlow);
    }
  }

  // Yaw about world up, then pitch about the wing axis, then roll about
  // the nose axis (the usual aircraft order).
  group.rotation.order = 'YZX';
  group.userData = {
    spec, body, glass, disc, lod, skin, glow, lightbar, bar, beam, lensGlow, layout: lay, tris: entry.tris,
    // World searchlight cone while lit (for the ground pool): apex, unit
    // direction, length, strength 0..1.
    spotW: beam ? { on: false, x: 0, y: 0, z: 0, dx: 0, dy: -1, dz: 0, len: 0, k: 0 } : null,
    rig: { ail: 0, elev: 0, rud: 0, flap: 0, gear: 0, pitch: NaN }, lastT: NaN, look: -1,
    // Kept for callers that look for these parts.
    prop: lay.prop ? body : null, rotor: lay.rotor ? body : null, rack: null,
  };
  return group;
}

// Place the mesh between the previous and current simulation state.
// Euler order YZX: rotation.y = -heading, rotation.z = pitch (nose up),
// rotation.x = roll (right side down). `time` drives the rig easing and
// the strobe; spin comes from the craft's own propSpin.
export function updateAircraftMesh(mesh, a, alpha = 1, time = 0) {
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
  const t = Number.isFinite(time) ? time : 0;
  const dt = Number.isFinite(ud.lastT) ? t - ud.lastT : 1;
  ud.lastT = t;
  const st = stepAircraftRig(ud.rig, a, dt);
  const rig = ud.skin.userData.rig;
  rig.r0.set(st.ail, st.elev, st.rud, st.flap);
  const spec = ud.spec;
  rig.r1.set(st.gear, storesLeft(a, 'missile', 2), storesLeft(a, 'bomb', spec.id === 'fighter' ? 6 : 4),
    !a.wrecked && (a.engineOn || a.driver) && (t * 1.1) % 1 < 0.08 ? 1 : 0);
  const spin = a.propSpin || 0;
  const fast = ud.layout.rotor ? !a.wrecked && (a.rotorSpeed || 0) > 0.5 : !!a.engineOn && !a.wrecked;
  rig.r2.set(wrapAngle(spin), wrapAngle(spin * 4.3), fast ? 1 : 0, 0);
  if (ud.disc) ud.disc.visible = fast;
  // Wear with damage, soot when wrecked, a flash on hits.
  const hp = spec.health || 1;
  const wear = Math.min(1, Math.max(0, 1 - (a.health == null ? hp : a.health) / hp)) * 0.8;
  const look = wear * 10 + (a.wrecked ? 100 : 0) + (a.hitT > 0 ? 1000 + a.hitT : 0);
  if (look !== ud.look) {
    ud.look = look;
    skinLook(ud.skin, wear, !!a.wrecked, a.hitT || 0);
  }
  if (ud.glow) {
    const ab = a.wrecked ? 0 : a.afterburner || 0;
    ud.glow.visible = ab > 0.04;
    if (ud.glow.visible) {
      const r = ud.glow.userData.r;
      const flick = 0.92 + 0.08 * Math.sin(spin * 7.3);
      ud.glow.scale.set((0.9 + 2.4 * ab) * flick, r * (0.7 + 0.3 * ab), r * (0.7 + 0.3 * ab));
    }
  }
  // Night readability for the police livery: the craft flies above the
  // street lamps' reach, so lift its response to the dim night light
  // (white body and blue band still read; by day it is unchanged).
  if (spec.police) {
    const n = a.wrecked ? 1 : 1 + 0.7 * (1 - daylight);
    if (ud.skin.color.r !== n) ud.skin.color.setScalar(n);
  }
  if (ud.lightbar) {
    const on = !!a.siren && !a.wrecked;
    ud.lightbar.visible = on;
    if (on) {
      const f = lightbarLevels(time);
      const b = ud.bar;
      b.lr.visible = f.r > 0.3;
      b.lb.visible = f.b > 0.3;
      flash(b.gr, f.r);
      flash(b.gb, f.b);
    }
  }
  if (ud.beam) aimBeam(mesh, ud, a);
}
function flash(sp, k) {
  sp.visible = k > 0.02;
  if (!sp.visible) return;
  const s = sp.userData.size * (0.75 + 0.25 * k);
  sp.scale.set(s, s, 1);
  sp.material.opacity = 0.9 * k;
}

// Daylight 0..1 for the searchlight's strength (graphics.js sets it each
// frame from the sky; night until then).
let daylight = 0;
export function setBeamDaylight(k) {
  daylight = k > 0 ? Math.min(1, k) : 0;
}

// Point the fake spotlight cone at (spotX, spotY, spotZ) when the craft
// has an aim point (spotAim), else forward and down. Length reaches the
// ground below (sea level when unknown), capped.
function aimBeam(mesh, ud, a) {
  const beam = ud.beam, sw = ud.spotW;
  const on = (a.spot || 0) > 0.05 && !a.wrecked;
  beam.visible = on;
  ud.lensGlow.visible = on;
  sw.on = false;
  if (!on) return;
  mesh.updateMatrixWorld();
  beam.getWorldPosition(V1);
  let dx, dy, dz;
  if (a.spotAim && Number.isFinite(a.spotX)) {
    dx = a.spotX - V1.x;
    dy = (a.spotY || 0) - V1.y;
    dz = a.spotZ - V1.z;
  } else {
    const h = a.heading || 0;
    const t = Math.tan(BEAM_TILT);
    const down = Math.max(1, V1.y);
    dx = Math.cos(h) * t * down;
    dy = -down;
    dz = Math.sin(h) * t * down;
  }
  let len = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (!(len > 0.5)) {
    beam.visible = false;
    ud.lensGlow.visible = false;
    return;
  }
  // World rotation that takes -y to the beam direction, then into the
  // craft's local frame.
  V1.set(dx / len, dy / len, dz / len);
  Q1.setFromUnitVectors(DOWN, V1);
  mesh.getWorldQuaternion(Q2).invert();
  beam.quaternion.copy(Q2.multiply(Q1));
  len = Math.min(len, BEAM_MAX);
  const k = Math.min(1, a.spot);
  const r = 0.2 + len * BEAM_TAN;
  beam.scale.set(r, len, r);
  // Faint by day (a searchlight barely shows in sunlight), clear at night.
  const day = daylight;
  const bu = beam.material.uniforms;
  bu.uK.value = k * (0.34 - 0.27 * day);
  const lg = ud.lensGlow, gs = lg.userData.size * (0.6 + 0.4 * k);
  lg.scale.set(gs, gs, 1);
  lg.material.opacity = k * (0.95 - 0.45 * day);
  sw.on = true;
  sw.dx = V1.x;
  sw.dy = V1.y;
  sw.dz = V1.z;
  beam.getWorldPosition(V2);
  bu.uA.value.copy(V2);
  bu.uD.value.copy(V1);
  bu.uL.value.set(len, BEAM_TAN);
  sw.x = V2.x;
  sw.y = V2.y;
  sw.z = V2.z;
  sw.len = len;
  sw.k = k;
}
