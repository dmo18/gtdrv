// Boat meshes: lofted planing and displacement hulls (deadrise V, chine
// flats, flared topsides, raked stem, boot stripe, rubbing strake), open
// cockpits with inner walls and sole, deck furniture, chrome rails and
// cleats, outboards with a spinning prop, nav lights. One rigged skin
// draw call (hullkit.js) plus windshield glass and, under way, one
// additive bow spray / stern wash mesh. Past LOD_FAR a coarse hull only.
// Origin is the waterline center; the bow points along local +x, up +y.
import * as THREE from 'three';
import { angleDiff } from '../core/rng.js';
import { Kit, RIG, CLS, createSkin, skinLook, glassMaterial, buildKit } from './hullkit.js';
import { wrapAngle } from './craftmath.js';

const GLASS = 0x18242e;
const TRIM = 0x26292e;
const TEAK = 0x9a6a3e;
const ANTIFOUL = 0x7a2420;
const ENGINE = 0x2b2e33;
const SEAT = 0xe9e4d6;
const NONSKID = 0xc9c6bd;
const STEEL = 0xc4c8cc;
const RED_L = 0xff2a1a;
const GREEN_L = 0x22ff5a;
const WHITE_L = 0xfff6e0;
const L = CLS.LIVERY, T = CLS.TRIM, G = CLS.GLASS, R = CLS.RUBBER, A = CLS.ALLOY, CH = CLS.CHROME, P = CLS.PLATE, GL = CLS.GLOW;
const LOD_FAR = 140;

const smooth = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

// Hull station at u (0 transom .. 1 stem).
function station(o, u) {
  const xs = -o.L / 2 + u * o.L;
  const xk = -o.L / 2 + u * (o.L - o.rake);
  let f = o.beamStern + (1 - o.beamStern) * smooth(0, 0.42, u);
  if (u > o.bowAt) {
    const t = (u - o.bowAt) / (1 - o.bowAt);
    f *= Math.pow(Math.max(0, 1 - t * t), 0.55);
  }
  const hb = (o.W / 2) * f;
  const hc = hb * o.chineK;
  const ys = o.fb + o.sheer * u * u;
  const yk = -o.D + (o.D + o.fb * 0.55) * Math.pow(Math.max(0, (u - 0.5) / 0.5), 1.7);
  const dr = (o.dr0 + (o.dr1 - o.dr0) * u * u) * (Math.PI / 180);
  const ych = Math.min(yk + hc * Math.tan(dr), ys - 0.12 - o.fb * 0.2);
  const cw = o.chineW * f;
  return { u, xs, xk, hb, hc, ys, yk, ych, cw, dr };
}

// Section points of one side (z >= 0), keel to sheer.
function sectionPts(st) {
  const X = (y) => st.xk + (st.xs - st.xk) * Math.min(1, Math.max(0, (y - st.yk) / Math.max(0.01, st.ys - st.yk)));
  const p = (z, y) => [X(y), y, z];
  const zc = st.hc + st.cw;
  const yb = st.ych + Math.min(0.14, (st.ys - st.ych) * 0.3);
  const bow = st.hb < 0.02;
  return {
    bottom: [p(0, st.yk), p(st.hc * 0.5, st.yk + st.hc * 0.5 * Math.tan(st.dr) * 0.92), p(st.hc, st.ych)],
    chine: [p(st.hc, st.ych), p(zc, st.ych + 0.01)],
    boot: [p(zc, st.ych + 0.01), p(bow ? 0 : zc + (st.hb - zc) * 0.3, yb)],
    top: [p(bow ? 0 : zc + (st.hb - zc) * 0.3, yb), p(zc + (st.hb - zc) * 0.82, yb + (st.ys - yb) * 0.6), p(st.hb, st.ys)],
  };
}

// o: L, W, fb, D, sheer, rake, bowAt, beamStern, chineK, chineW, dr0, dr1,
// bottom, boot, top, deck, cap, cockpit: [ua, ub, inset, wallHex, soleHex].
function hull(k, o) {
  const N = k.seg(26, 10);
  const us = [];
  for (let i = 0; i <= N; i++) us.push(Math.pow(i / N, 0.92));
  const S = us.map((u) => station(o, u));
  const parts = ['bottom', 'chine', 'boot', 'top'];
  const hexOf = { bottom: o.bottom, chine: o.bottom, boot: o.boot, top: o.top };
  for (const side of [1, -1]) {
    for (const part of parts) {
      const G2 = S.map((st) => sectionPts(st)[part].map((q) => [q[0], q[1], q[2] * side]));
      k.grid(G2, hexOf[part], part === 'bottom' || part === 'chine' ? P : L, {
        expect: (i, j, c) => [0, c[1] - (S[i].yk + S[i].ys) / 2, c[2]],
      });
    }
  }
  // Rubbing strake along the sheer.
  if (k.q > 0.8) {
    for (const side of [1, -1]) {
      const pts = S.filter((st) => st.hb > 0.05).map((st) => [st.xs, st.ys - 0.05, (st.hb + 0.025) * side]);
      k.sweep(pts, 0.035, o.cap || STEEL, o.cap ? L : CH, 5);
    }
  }
  // Transom.
  const t0 = sectionPts(S[0]);
  const ring = [];
  for (const part of parts) for (const q of t0[part]) ring.push(q);
  const back = ring.slice().reverse().map((q) => [q[0], q[1], -q[2]]);
  k.cap(ring.concat(back), o.top, L, [S[0].xs + 1, 0, 0]);
  // Deck: gunwale cap all round, deck over the closed parts, cockpit.
  const cw = o.capW || 0.1;
  const ck = o.cockpit;
  const deckAt = (u0, u1) => {
    const D = [];
    const n = Math.max(2, Math.round((u1 - u0) * N));
    for (let i = 0; i <= n; i++) {
      const st = station(o, u0 + (u1 - u0) * (i / n));
      const row = [];
      for (let j = 0; j <= 6; j++) {
        const z = (-1 + (2 * j) / 6) * st.hb;
        row.push([st.xs, st.ys + 0.006 + (o.crown || 0.06) * (1 - (z / Math.max(0.01, st.hb)) ** 2) * Math.min(1, st.hb), z]);
      }
      D.push(row);
    }
    k.grid(D, o.deck, o.deckCls == null ? L : o.deckCls, { expect: () => [0, 1, 0] });
  };
  if (!ck) {
    deckAt(0, 1);
    return S;
  }
  const [ua, ub, inset, wallHex, soleHex] = ck;
  deckAt(0, ua);
  deckAt(ub, 1);
  const n = Math.max(2, Math.round((ub - ua) * N));
  const sts = [];
  for (let i = 0; i <= n; i++) sts.push(station(o, ua + (ub - ua) * (i / n)));
  for (const side of [1, -1]) {
    k.grid(sts.map((st) => [[st.xs, st.ys + 0.01, st.hb * side], [st.xs, st.ys + 0.01, (st.hb - cw) * side]]), o.deck, o.deckCls == null ? L : o.deckCls, { expect: () => [0, 1, 0] });
    k.grid(sts.map((st) => [[st.xs, st.ys + 0.01, (st.hb - cw) * side], [st.xs, st.ys - inset, (st.hb - cw - 0.03) * side]]), wallHex, P, { expect: () => [0, 0, -side] });
  }
  k.grid(sts.map((st) => [[st.xs, st.ys - inset, -(st.hb - cw - 0.03)], [st.xs, st.ys - inset, st.hb - cw - 0.03]]), soleHex, P, { expect: () => [0, 1, 0] });
  for (const [st, dir] of [[sts[0], 1], [sts[sts.length - 1], -1]]) {
    const z = st.hb - cw - 0.03;
    k.fquad([st.xs, st.ys - inset, -z], [st.xs, st.ys - inset, z], [st.xs, st.ys + 0.02, z], [st.xs, st.ys + 0.02, -z], wallHex, P, [st.xs - dir, st.ys, 0]);
  }
  return S;
}

function cleat(k, x, y, z) {
  if (k.q < 0.8) return;
  k.box(x, y + 0.03, z, 0.06, 0.05, 0.04, STEEL, CH);
  k.box(x, y + 0.065, z, 0.2, 0.025, 0.035, STEEL, CH);
}

function navLights(k, bowX, y, z, sternX, sternY) {
  k.box(bowX, y, -z, 0.08, 0.06, 0.05, RED_L, GL);
  k.box(bowX, y, z, 0.08, 0.06, 0.05, GREEN_L, GL);
  if (sternX != null) {
    k.tube([sternX, sternY - 0.6, 0], [sternX, sternY, 0], 0.015, 0.015, STEEL, CH, 5);
    k.box(sternX, sternY + 0.03, 0, 0.06, 0.07, 0.06, WHITE_L, GL);
  }
}

// Bow rail on stanchions along the foredeck edge (u range of the hull).
function bowRail(k, o, u0, h = 0.42) {
  if (k.q < 0.8) return;
  for (const side of [1, -1]) {
    const pts = [];
    for (let i = 0; i <= 8; i++) {
      const st = station(o, u0 + (0.985 - u0) * (i / 8));
      pts.push([st.xs - 0.02, st.ys + h, (st.hb - 0.06) * side]);
      if (i % 3 === 0) k.tube([st.xs, st.ys, (st.hb - 0.06) * side], [st.xs - 0.02, st.ys + h, (st.hb - 0.06) * side], 0.012, 0.012, STEEL, CH, 5);
    }
    k.sweep(pts, 0.016, STEEL, CH, 5);
  }
}

// Outboard motor hung on the transom at x, deck height y, scale s.
function outboard(k, x, y, s, cowl = ENGINE) {
  const top = y + 0.3 * s;
  k.rbox(x - 0.25 * s, top, 0, 0.55 * s, 0.5 * s, 0.38 * s, cowl, L, 0.4, 3);
  if (k.q > 0.8) k.box(x - 0.25 * s, top - 0.02 * s, 0, 0.56 * s, 0.03 * s, 0.39 * s, 0xd8d8d8, CH);
  k.hexa([[x - 0.12 * s, top - 0.2 * s, -0.09 * s], [x - 0.38 * s, top - 0.2 * s, -0.09 * s], [x - 0.38 * s, top - 0.2 * s, 0.09 * s], [x - 0.12 * s, top - 0.2 * s, 0.09 * s],
    [x - 0.16 * s, -0.42 * s, -0.05 * s], [x - 0.34 * s, -0.42 * s, -0.05 * s], [x - 0.34 * s, -0.42 * s, 0.05 * s], [x - 0.16 * s, -0.42 * s, 0.05 * s]], TRIM, T);
  k.box(x - 0.28 * s, -0.12 * s, 0, 0.42 * s, 0.025 * s, 0.24 * s, TRIM, T);
  k.lathe([{ pts: [[0, 0], [0, 0.06 * s], [0.3 * s, 0.065 * s], [0.42 * s, 0.03 * s], [0.48 * s, 0]], hex: TRIM, cls: T }], 8, [x - 0.48 * s, -0.5 * s, 0], [1, 0, 0]);
  const hub = [x - 0.5 * s, -0.5 * s, 0];
  k.setRig(RIG.SPIN, hub, [1, 0, 0]);
  for (let b = 0; b < 3; b++) {
    const a = (b / 3) * Math.PI * 2;
    const c = Math.cos(a), sn = Math.sin(a);
    k.hexa([[hub[0] - 0.03 * s, hub[1] + sn * 0.05 * s, c * 0.05 * s], [hub[0] + 0.03 * s, hub[1] + sn * 0.05 * s + c * 0.04 * s, c * 0.05 * s - sn * 0.04 * s],
      [hub[0] + 0.03 * s, hub[1] + sn * 0.05 * s + c * 0.04 * s + 0.005, c * 0.05 * s - sn * 0.04 * s], [hub[0] - 0.03 * s, hub[1] + sn * 0.05 * s + 0.005, c * 0.05 * s],
      [hub[0] - 0.03 * s, hub[1] + sn * 0.17 * s, c * 0.17 * s], [hub[0] + 0.03 * s, hub[1] + sn * 0.17 * s + c * 0.05 * s, c * 0.17 * s - sn * 0.05 * s],
      [hub[0] + 0.03 * s, hub[1] + sn * 0.17 * s + c * 0.05 * s + 0.005, c * 0.17 * s - sn * 0.05 * s], [hub[0] - 0.03 * s, hub[1] + sn * 0.17 * s + 0.005, c * 0.17 * s]], 0x9aa0a6, A);
  }
  k.noRig();
}

// ---- per-type builders (k body kit, gk glass kit or null) ----------------------
function buildRunabout(k, gk, spec, color) {
  const Ln = spec.length, W = spec.width;
  const white = color === 0xf4f4f0;
  const o = {
    L: Ln, W, fb: 0.62, D: spec.draft, sheer: 0.3, rake: 0.9, bowAt: 0.56, beamStern: 0.93, chineK: 0.84, chineW: 0.07, dr0: 19, dr1: 42,
    bottom: 0xf0efe9, boot: white ? 0x1e5fa8 : 0xf4f4f0, top: color, deck: 0xf4f4f0, cap: null, crown: 0.09,
    cockpit: [0.16, 0.6, 0.42, SEAT, NONSKID],
  };
  hull(k, o);
  const fy = o.fb - 0.42;
  const sa = station(o, 0.6);
  // Wrap-round windshield with a chrome top rail.
  const ws = (t, up) => {
    const a = (t - 0.5) * 2;
    const z = a * sa.hb * 0.9;
    const x = sa.xs - 0.05 - 0.4 * a * a - up * 0.35;
    return [x, o.fb + 0.08 + up * 0.42, z];
  };
  const rows = [];
  for (let i = 0; i <= 10; i++) rows.push([ws(i / 10, 0), ws(i / 10, 1)]);
  if (gk) gk.grid(rows, 0xffffff, L, { expect: () => [1, 0.4, 0] });
  else k.grid(rows, GLASS, G, { expect: () => [1, 0.4, 0] });
  k.sweep(rows.map((r) => r[1]), 0.018, STEEL, CH, 5);
  // Console, wheel, seats, rear bench, engine well.
  const cz = W * 0.2;
  k.rbox(sa.xs - 0.55, fy + 0.36, cz, 0.5, 0.72, 0.62, SEAT, P, 0.3, 4);
  k.box(sa.xs - 0.7, fy + 0.74, cz, 0.22, 0.04, 0.5, 0x1b1d22, T);
  if (k.q > 0.8) {
    k.lathe([{ pts: [[0, 0.17], [0.02, 0.18], [0.04, 0.17]], hex: 0x1b1d22, cls: T }], 14, [sa.xs - 0.88, fy + 0.8, cz], [0.6, 0.8, 0]);
    k.tube([sa.xs - 0.82, fy + 0.72, cz], [sa.xs - 0.88, fy + 0.82, cz], 0.025, 0.025, STEEL, CH, 5);
  }
  for (const zz of [cz, -cz]) {
    k.rbox(-0.55, fy + 0.22, zz, 0.6, 0.18, 0.58, SEAT, P, 0.4, 4);
    k.rbox(-0.86, fy + 0.52, zz, 0.14, 0.55, 0.56, SEAT, P, 0.4, 4);
    k.tube([-0.55, fy, zz], [-0.55, fy + 0.13, zz], 0.05, 0.05, STEEL, CH, 6);
  }
  k.rbox(-Ln * 0.31, fy + 0.2, 0, 0.6, 0.38, W * 0.74, SEAT, P, 0.3, 4);
  k.rbox(-Ln * 0.31 - 0.25, fy + 0.5, 0, 0.14, 0.5, W * 0.72, SEAT, P, 0.3, 4);
  k.box(-Ln / 2 - 0.25, 0.14, 0, 0.5, 0.06, W * 0.7, TEAK, P);
  outboard(k, -Ln / 2 + 0.02, o.fb, 1.35);
  bowRail(k, o, 0.66, 0.3);
  const s0 = station(o, 0.08), s1 = station(o, 0.55), s2 = station(o, 0.9);
  for (const side of [1, -1]) {
    cleat(k, s0.xs, s0.ys, (s0.hb - 0.06) * side);
    cleat(k, s1.xs, s1.ys, (s1.hb - 0.05) * side);
  }
  cleat(k, s2.xs - 0.1, s2.ys + 0.03, 0);
  const sb = station(o, 0.82);
  navLights(k, sb.xs, sb.ys + 0.05, sb.hb - 0.02, -Ln * 0.38, o.fb + 1.0);
  return { spray: { L: Ln, W, bowX: Ln * 0.12, sternX: -Ln / 2 - 0.5, rooster: 1 }, prop: true };
}

function buildJetski(k, gk, spec, color) {
  const Ln = spec.length, W = spec.width;
  const o = {
    L: Ln, W, fb: 0.36, D: spec.draft, sheer: 0.1, rake: 0.5, bowAt: 0.45, beamStern: 0.86, chineK: 0.8, chineW: 0.04, dr0: 20, dr1: 40,
    bottom: 0x2a2d33, boot: 0xf2f2f2, top: color, deck: 0x2a2d33, crown: 0.02,
    cockpit: [0.08, 0.5, 0.12, 0x2a2d33, 0x23262a],
  };
  hull(k, o);
  const fb = o.fb;
  k.loft([[-0.05, fb + 0.08, W * 0.3, 0.12, 0.1, 2.6], [0.45, fb + 0.2, W * 0.34, 0.2, 0.12, 2.8], [Ln * 0.3, fb + 0.12, W * 0.26, 0.12, 0.1, 2.6], [Ln * 0.46, fb, 0.05, 0.03, 0.03, 2]], color, L, { steps: 10, seg: 18, capEnds: true });
  k.loft([[-Ln * 0.45, fb + 0.2, W * 0.17, 0.1, 0.12, 3.2], [-Ln * 0.1, fb + 0.26, W * 0.2, 0.12, 0.14, 3.4], [0.05, fb + 0.3, W * 0.16, 0.1, 0.12, 3]], 0x2a3140, R, { steps: 8, seg: 16, capEnds: true });
  k.tube([0.25, fb + 0.3, 0], [0.12, fb + 0.55, 0], 0.05, 0.05, 0x1b1d22, T, 6);
  k.sweep([[0.12, fb + 0.6, -0.36], [0.1, fb + 0.58, 0], [0.12, fb + 0.6, 0.36]], 0.022, 0x1b1d22, T, 6);
  for (const s of [1, -1]) k.tube([0.12, fb + 0.6, 0.3 * s], [0.12, fb + 0.6, 0.4 * s], 0.035, 0.035, 0x2a2d33, R, 6);
  if (gk) gk.hexa([[0.32, fb + 0.36, -0.2], [0.32, fb + 0.36, 0.2], [0.18, fb + 0.52, 0.16], [0.18, fb + 0.52, -0.16],
    [0.335, fb + 0.36, -0.2], [0.335, fb + 0.36, 0.2], [0.195, fb + 0.52, 0.16], [0.195, fb + 0.52, -0.16]], 0xffffff, L);
  k.lathe([{ pts: [[0, 0.1], [0.2, 0.12]], hex: 0x50555c, cls: A }, { pts: [[0, 0], [0, 0.1]], hex: 0x121314, cls: T }], 10, [-Ln / 2 - 0.12, -0.04, 0], [1, 0, 0]);
  const sb = station(o, 0.7);
  navLights(k, sb.xs, sb.ys + 0.02, sb.hb - 0.01, null, 0);
  return { spray: { L: Ln, W, bowX: Ln * 0.08, sternX: -Ln / 2 - 0.2, rooster: 1.3 } };
}

function buildFisher(k, gk, spec, color) {
  const Ln = spec.length, W = spec.width;
  const o = {
    L: Ln, W, fb: 1.15, D: spec.draft, sheer: 0.6, rake: 1.4, bowAt: 0.52, beamStern: 0.86, chineK: 0.9, chineW: 0.02, dr0: 28, dr1: 50,
    bottom: ANTIFOUL, boot: 0xe8e4d8, top: color, deck: 0x8c8678, deckCls: P, crown: 0.06,
    cockpit: [0.03, 0.52, 0.5, 0xd8d2c0, 0x8c8678],
  };
  hull(k, o);
  const dy = o.fb - 0.5;
  const x0 = 0.15, x1 = 2.6, hw = W * 0.34;
  k.slab([[x0, -hw], [x1, -hw * 0.92], [x1, hw * 0.92], [x0, hw]], [[x0 + 0.05, -hw], [x1 - 0.15, -hw * 0.9], [x1 - 0.15, hw * 0.9], [x0 + 0.05, hw]], dy, dy + 1.15, 0xefeadc, L);
  k.slab([[x0 + 0.02, -hw - 0.01], [x1 - 0.12, -hw * 0.91], [x1 - 0.12, hw * 0.91], [x0 + 0.02, hw + 0.01]], [[x0 + 0.06, -hw - 0.01], [x1 - 0.38, -hw * 0.88], [x1 - 0.38, hw * 0.88], [x0 + 0.06, hw + 0.01]], dy + 1.15, dy + 1.65, GLASS, G);
  k.slab([[x0 - 0.15, -hw - 0.12], [x1 - 0.15, -hw - 0.05], [x1 - 0.15, hw + 0.05], [x0 - 0.15, hw + 0.12]], [[x0 - 0.12, -hw - 0.1], [x1 - 0.2, -hw - 0.04], [x1 - 0.2, hw + 0.04], [x0 - 0.12, hw + 0.1]], dy + 1.65, dy + 1.8, color, L);
  k.tube([1.6, dy + 1.8, 0], [1.6, dy + 4.0, 0], 0.07, 0.05, 0xd8d2c0, L, 8);
  k.tube([1.6, dy + 3.4, -0.75], [1.6, dy + 3.4, 0.75], 0.04, 0.04, 0xd8d2c0, L, 6);
  k.box(1.6, dy + 4.08, 0, 0.12, 0.12, 0.12, WHITE_L, GL);
  if (k.q > 0.8) k.lathe([{ pts: [[0, 0.25], [0.08, 0.25], [0.08, 0]], hex: 0xf0f0f0, cls: L }], 12, [1.9, dy + 1.8, 0], [0, 1, 0]);
  k.sweep([[-Ln / 2 + 0.5, dy, W * 0.36], [-Ln / 2 + 0.5, dy + 1.9, W * 0.36], [-Ln / 2 + 0.6, dy + 2.1, 0], [-Ln / 2 + 0.5, dy + 1.9, -W * 0.36], [-Ln / 2 + 0.5, dy, -W * 0.36]], 0.07, 0xd8862a, L, 8);
  k.lathe([{ pts: [[-0.65, 0.12], [-0.65, 0.42]], hex: 0x3a5f8a, cls: L }, { pts: [[-0.65, 0.42], [0.65, 0.42]], hex: 0x4a7aa8, cls: R }, { pts: [[0.65, 0.42], [0.65, 0.12]], hex: 0x3a5f8a, cls: L }], 14, [-Ln * 0.22, dy + 0.45, 0], [0, 0, 1]);
  k.box(-Ln * 0.33, dy + 0.18, W * 0.27, 0.6, 0.35, 0.5, 0x2f8fd0, P);
  k.box(-Ln * 0.33, dy + 0.18, -W * 0.27, 0.6, 0.35, 0.5, 0xd84a2a, P);
  k.tube([x0 + 0.3, dy + 1.6, hw * 0.6], [x0 + 0.3, dy + 2.6, hw * 0.6], 0.08, 0.08, TRIM, T, 8);
  for (const s of [1, -1]) {
    const st = station(o, 0.35);
    if (k.q > 0.8) {
      k.lathe([{ pts: [[0, 0.24], [0.06, 0.24], [0.06, 0.15], [0, 0.15]], hex: 0xf06020, cls: L }], 12, [st.xs, dy + 0.9, (st.hb + 0.02) * s], [0, 0, s]);
    }
    cleat(k, st.xs, st.ys, (st.hb - 0.08) * s);
    for (let i = 0; i < 3; i++) {
      const tt = station(o, 0.62 + i * 0.12);
      k.tube([tt.xs, tt.ys, (tt.hb - 0.06) * s], [tt.xs, tt.ys + 0.6, (tt.hb - 0.06) * s], 0.03, 0.03, STEEL, CH, 5);
    }
    const rail = [];
    for (let i = 0; i <= 6; i++) {
      const tt = station(o, 0.6 + i * 0.065);
      rail.push([tt.xs, tt.ys + 0.6, (tt.hb - 0.06) * s]);
    }
    k.sweep(rail, 0.03, STEEL, CH, 5);
  }
  navLights(k, x1 - 0.2, dy + 1.72, hw + 0.08, null, 0);
  return { spray: { L: Ln, W, bowX: Ln * 0.42, sternX: -Ln / 2 - 0.3, rooster: 0 } };
}

function buildYacht(k, gk, spec, color) {
  const Ln = spec.length, W = spec.width;
  const o = {
    L: Ln, W, fb: 1.5, D: spec.draft, sheer: 0.55, rake: 1.9, bowAt: 0.5, beamStern: 0.93, chineK: 0.86, chineW: 0.06, dr0: 17, dr1: 45,
    bottom: 0x1c2a44, boot: 0x1c2a44, top: color, deck: TEAK, deckCls: P, crown: 0.05, cap: color,
  };
  hull(k, o);
  const hw = W / 2;
  const fb = o.fb;
  // Saloon, glass band, hardtop, flybridge, radar arch.
  k.slab([[-Ln * 0.34, -hw * 0.84], [Ln * 0.2, -hw * 0.78], [Ln * 0.2, hw * 0.78], [-Ln * 0.34, hw * 0.84]],
    [[-Ln * 0.32, -hw * 0.8], [Ln * 0.12, -hw * 0.74], [Ln * 0.12, hw * 0.74], [-Ln * 0.32, hw * 0.8]], fb, fb + 0.5, color, L);
  k.slab([[-Ln * 0.32, -hw * 0.8], [Ln * 0.12, -hw * 0.74], [Ln * 0.12, hw * 0.74], [-Ln * 0.32, hw * 0.8]],
    [[-Ln * 0.31, -hw * 0.78], [Ln * 0.02, -hw * 0.7], [Ln * 0.02, hw * 0.7], [-Ln * 0.31, hw * 0.78]], fb + 0.5, fb + 1.15, GLASS, G);
  k.slab([[-Ln * 0.35, -hw * 0.84], [Ln * 0.04, -hw * 0.74], [Ln * 0.04, hw * 0.74], [-Ln * 0.35, hw * 0.84]],
    [[-Ln * 0.34, -hw * 0.82], [Ln * 0.02, -hw * 0.72], [Ln * 0.02, hw * 0.72], [-Ln * 0.34, hw * 0.82]], fb + 1.15, fb + 1.3, color, L);
  k.slab([[-Ln * 0.22, -hw * 0.7], [-Ln * 0.02, -hw * 0.66], [-Ln * 0.02, hw * 0.66], [-Ln * 0.22, hw * 0.7]],
    [[-Ln * 0.21, -hw * 0.66], [-Ln * 0.06, -hw * 0.6], [-Ln * 0.06, hw * 0.6], [-Ln * 0.21, hw * 0.66]], fb + 1.3, fb + 1.7, color, L);
  const wsr = [];
  for (let i = 0; i <= 6; i++) {
    const z = (-1 + i / 3) * hw * 0.6;
    wsr.push([[-Ln * 0.06 - 0.05 * Math.abs(z), fb + 1.7, z], [-Ln * 0.06 - 0.3 - 0.05 * Math.abs(z), fb + 2.05, z]]);
  }
  if (gk) gk.grid(wsr, 0xffffff, L, { expect: () => [1, 0.6, 0] });
  for (const s of [1, -1]) {
    k.sweep([[-Ln * 0.2, fb + 1.3, hw * 0.62 * s], [-Ln * 0.21, fb + 2.4, hw * 0.55 * s], [-Ln * 0.215, fb + 2.55, 0]], [0.12, 0.1, 0.09], color, L, 8, false);
    k.box(Ln * 0.02, fb * 0.72, (hw * 0.955) * s, Ln * 0.3, 0.16, 0.06, GLASS, G);
    k.box(-Ln * 0.2, fb + 1.95, hw * 0.62 * s, Ln * 0.14, 0.03, 0.03, STEEL, CH);
  }
  k.box(-Ln * 0.215, fb + 2.62, 0, 0.6, 0.06, 0.14, 0x9a9a9a, CH);
  k.rbox(Ln * 0.3, fb + 0.2, 0, 1.6, 0.2, W * 0.46, SEAT, P, 0.3, 4);
  k.box(-Ln / 2 - 0.45, 0.32, 0, 0.9, 0.1, W * 0.86, TEAK, P);
  k.rbox(-Ln * 0.42, fb + 0.2, 0, 1.0, 0.36, W * 0.64, SEAT, P, 0.3, 4);
  bowRail(k, o, 0.45, 0.55);
  for (const side of [1, -1]) {
    const pts = [];
    for (let i = 0; i <= 6; i++) {
      const st = station(o, 0.05 + i * 0.06);
      pts.push([st.xs, st.ys + 0.6, (st.hb - 0.06) * side]);
      k.tube([st.xs, st.ys, (st.hb - 0.06) * side], [st.xs, st.ys + 0.6, (st.hb - 0.06) * side], 0.015, 0.015, STEEL, CH, 5);
    }
    k.sweep(pts, 0.02, STEEL, CH, 5);
  }
  const sb = station(o, 0.62);
  navLights(k, sb.xs, sb.ys + 0.06, sb.hb - 0.02, null, 0);
  k.box(-Ln * 0.215, fb + 2.72, 0, 0.08, 0.1, 0.08, WHITE_L, GL);
  return { spray: { L: Ln, W, bowX: Ln * 0.3, sternX: -Ln / 2 - 0.6, rooster: 0.3 } };
}

function buildInflatable(k, gk, spec, color) {
  const Ln = spec.length, W = spec.width;
  const tr = 0.23;
  const tz = W / 2 - tr;
  const ty = 0.2;
  const o = {
    L: Ln * 0.9, W: W * 0.78, fb: 0.14, D: spec.draft, sheer: 0.08, rake: 0.5, bowAt: 0.6, beamStern: 1, chineK: 0.85, chineW: 0.03, dr0: 14, dr1: 30,
    bottom: 0x3a3d42, boot: 0x3a3d42, top: 0x3a3d42, deck: 0x6a6e74, deckCls: P,
  };
  hull(k, o);
  // Side tubes round a U through the bow, tapered cones aft.
  const pts = [];
  const bowX = Ln / 2 - tz - tr * 0.6;
  const sx0 = -Ln / 2 - 0.1;
  pts.push([sx0, ty + 0.03, tz]);
  for (let i = 0; i <= 6; i++) pts.push([sx0 + (bowX - sx0) * (i / 6), ty, tz]);
  for (let i = 1; i < 10; i++) {
    const a = (i / 10) * Math.PI;
    pts.push([bowX + Math.sin(a) * tz * 1.05, ty + Math.sin(a) * 0.12, Math.cos(a) * tz]);
  }
  for (let i = 0; i <= 6; i++) pts.push([bowX - (bowX - sx0) * (i / 6), ty, -tz]);
  pts.push([sx0, ty + 0.03, -tz]);
  const rr = pts.map((p, i) => (i === 0 || i === pts.length - 1 ? tr * 0.7 : tr));
  k.sweep(pts, rr, color, R, 12);
  if (k.q > 0.8) {
    k.sweep(pts.slice(2, -2).map((p) => [p[0], p[1] + tr * 0.98, p[2]]), 0.012, 0x2a2d32, T, 4, false);
    for (const s of [1, -1]) k.box(0, ty, (tz + tr * 0.95) * s, Ln * 0.5, 0.06, 0.02, 0x2a2d32, R);
  }
  k.box(-Ln * 0.45, 0.12, 0, 0.08, 0.42, W * 0.68, 0x3a3d42, P);
  k.box(-Ln * 0.05, ty + 0.12, 0, 0.3, 0.05, tz * 2, 0xd8d0b8, P);
  outboard(k, -Ln * 0.45, 0.32, 0.8, 0x3a3d42);
  return { spray: { L: Ln, W, bowX: Ln * 0.2, sternX: -Ln / 2 - 0.3, rooster: 0.4 }, prop: true };
}


const BUILDERS = { runabout: buildRunabout, jetski: buildJetski, fisher: buildFisher, yacht: buildYacht, inflatable: buildInflatable };

// ---- spray: bow sheets and a stern wash, additive, vertex color = strength
function sprayGeometry(sp) {
  const pos = [], col = [], idx = [];
  const quadStrip = (rows, c0, c1) => {
    const base = pos.length / 3;
    const n = rows.length;
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < 2; j++) {
        const p = rows[i][j];
        pos.push(p[0], p[1], p[2]);
        const t = i / (n - 1);
        const c = (j === 0 ? c0 : c1) * 0.32 * Math.sin(Math.PI * Math.min(1, t * 1.15)) * (1 - t * 0.6);
        col.push(c * 0.95, c, c);
      }
    }
    for (let i = 0; i < n - 1; i++) idx.push(base + i * 2, base + i * 2 + 1, base + i * 2 + 2, base + i * 2 + 1, base + i * 2 + 3, base + i * 2 + 2);
  };
  const hw = sp.W / 2;
  for (const s of [1, -1]) {
    // Bow sheet: from the hull side, flaring out and up, falling back.
    const rows = [];
    for (let i = 0; i <= 8; i++) {
      const t = i / 8;
      const x = sp.bowX - t * sp.L * 0.55;
      const z = (hw * 0.75 + t * hw * 1.5) * s;
      rows.push([[x, 0.02, z * 0.95], [x - 0.3, 0.12 + Math.sin(t * Math.PI) * hw * 0.55, z * 1.12]]);
    }
    quadStrip(rows, 0.5, 0);
    // Flat foam fan alongside the hull.
    const fan = [];
    for (let i = 0; i <= 6; i++) {
      const t = i / 6;
      const x = sp.bowX - t * sp.L * 0.9;
      fan.push([[x, 0.04, hw * 0.9 * s], [x - 0.4, 0.04, (hw * 1.0 + t * hw * 1.4) * s]]);
    }
    quadStrip(fan, 0.5, 0);
  }
  // Stern wash and (planing boats) a rooster tail plume.
  for (const s of [1, -1]) {
    const wash = [];
    for (let i = 0; i <= 8; i++) {
      const t = i / 8;
      const x = sp.sternX - t * sp.L * 1.2;
      wash.push([[x, 0.05, 0], [x, 0.05, hw * (0.6 + t * 0.7) * s]]);
    }
    quadStrip(wash, 0.7, 0);
  }
  if (sp.rooster > 0) {
    const rt = [];
    for (let i = 0; i <= 8; i++) {
      const t = i / 8;
      const x = sp.sternX - 0.2 - t * sp.L * 0.7;
      const h = Math.sin(t * Math.PI) * sp.rooster * 0.9;
      rt.push([[x, 0.05 + h * 0.2, -0.12 - t * 0.4], [x, 0.05 + h, 0.12 + t * 0.4]]);
    }
    quadStrip(rt, 0.6, 0.1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeBoundingSphere();
  return g;
}
const SPRAY_MAT = new THREE.MeshBasicMaterial({
  vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
});

// ---- caches -----------------------------------------------------------------------
const geoCache = new Map();
function boatEntry(spec, color) {
  const key = spec.id + ':' + color;
  let e = geoCache.get(key);
  if (!e) {
    const build = BUILDERS[spec.hull] || buildRunabout;
    const k = new Kit(1), gk = new Kit(1), kf = new Kit(0.45);
    const lay = build(k, gk, spec, color);
    build(kf, null, spec, color);
    e = {
      body: buildKit(k), glass: gk.count ? buildKit(gk) : null, far: buildKit(kf), lay,
      spray: sprayGeometry(lay.spray), tris: (k.i.length + gk.i.length) / 3, farTris: kf.i.length / 3,
    };
    geoCache.set(key, e);
  }
  return e;
}

// Triangle counts (near, far) for tools and tests.
export function boatStats(spec, color) {
  const e = boatEntry(spec, color == null ? spec.colors[0] : color);
  return { tris: e.tris, farTris: e.farTris };
}

// ---- public API -------------------------------------------------------------------
export function createBoatMesh(spec, color) {
  const group = new THREE.Group();
  const col = color == null ? spec.colors[0] : color;
  const e = boatEntry(spec, col);
  const skin = createSkin(spec.hull === 'inflatable' ? 'rib' : 'boat');
  const near = new THREE.Group();
  const body = new THREE.Mesh(e.body, skin);
  near.add(body);
  let glass = null;
  if (e.glass) {
    glass = new THREE.Mesh(e.glass, glassMaterial());
    glass.renderOrder = 2;
    near.add(glass);
  }
  const lod = new THREE.LOD();
  lod.addLevel(near, 0);
  lod.addLevel(new THREE.Mesh(e.far, skin), LOD_FAR);
  const spray = new THREE.Mesh(e.spray, SPRAY_MAT);
  spray.visible = false;
  spray.renderOrder = 3;
  group.add(lod, spray);
  // Euler order YZX: yaw about world up, then pitch about the boat's own
  // beam axis (z), then roll about its own (pitched) fore-aft axis (x).
  group.rotation.order = 'YZX';
  group.userData = { spec, body, glass, lod, skin, spray, spin: 0, lastT: NaN, look: -1, tris: e.tris };
  return group;
}

// Place the mesh between the previous and current simulation state.
export function updateBoatMesh(mesh, b, alpha = 1, time = 0) {
  const ud = mesh.userData;
  const x = b.px + (b.x - b.px) * alpha;
  const z = b.pz + (b.z - b.pz) * alpha;
  const py = Number.isFinite(b.py) ? b.py : b.y;
  // A faint engine shiver under throttle.
  const shiver = b.throttle > 0.05 ? Math.sin(time * 70) * 0.006 * b.throttle : 0;
  const y = py + (b.y - py) * alpha + shiver;
  const h = b.pheading + angleDiff(b.heading, b.pheading) * alpha;
  const pp = Number.isFinite(b.ppitch) ? b.ppitch : b.pitch;
  const pr = Number.isFinite(b.proll) ? b.proll : b.roll;
  mesh.position.set(x, y, z);
  // rotation.x = roll (right side, +z, goes down for positive roll),
  // rotation.y = -heading, rotation.z = pitch (nose up positive).
  mesh.rotation.set(pr + (b.roll - pr) * alpha, -h, pp + (b.pitch - pp) * alpha);
  const t = Number.isFinite(time) ? time : 0;
  const dt = Number.isFinite(ud.lastT) ? Math.min(0.1, Math.max(0, t - ud.lastT)) : 0;
  ud.lastT = t;
  const thr = b.wrecked ? 0 : b.throttle || 0;
  ud.spin = wrapAngle(ud.spin + dt * (8 + 90 * thr) * (b.speed < -0.2 ? -1 : 1) * (thr > 0.02 ? 1 : 0));
  ud.skin.userData.rig.r2.set(ud.spin, 0, 0, 0);
  // Spray grows with speed (share of top speed), flickers a little.
  const sp = Math.abs(b.speed || 0) / Math.max(1, ud.spec.maxSpeed || 20);
  const on = !b.wrecked && sp > 0.12;
  ud.spray.visible = on;
  if (on) {
    const k = Math.min(1, sp) * (0.92 + 0.08 * Math.sin(t * 23 + ud.spec.length));
    ud.spray.scale.set(0.6 + 0.4 * k, 0.3 + 0.9 * k, 0.5 + 0.6 * k);
  }
  const hp = ud.spec.health || 1;
  const wear = Math.min(1, Math.max(0, 1 - (b.health == null ? hp : b.health) / hp)) * 0.8;
  const look = wear * 10 + (b.wrecked ? 100 : 0) + (b.hitT > 0 ? 1000 + b.hitT : 0);
  if (look !== ud.look) {
    ud.look = look;
    skinLook(ud.skin, wear, !!b.wrecked, b.hitT || 0);
  }
}

