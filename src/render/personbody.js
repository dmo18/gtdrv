// Person body geometry for render/personmesh.js: a sculpted, clothed human
// figure built from lofted surfaces with smooth normals, coloured per
// vertex (clothing, skin, hair, a little baked shading) and skinned to the
// person skeleton. Two detail levels: near (about 2k triangles, face
// details, thumbs, collars) and far (a few hundred triangles, same
// silhouette). Proportions follow a 1.78 m adult at about 7.5 heads.
// Pure geometry: three.js is used only for the BufferGeometry container.
import * as THREE from 'three';

// ---- skeleton (shared with personmesh.js) ---------------------------------------
export const HIP_Y = 0.9;
export const SHOULDER_Y = 1.42;
export const NECK_Y = 0.56; // head bone above the torso bone
export const KNEE_DY = -0.44; // knee bone below the hip joint
export const ELBOW_DY = -0.3; // elbow bone below the shoulder joint
export const LEG_Z = 0.092;
export const B = { body: 0, torso: 1, head: 2, legL: 3, kneeL: 4, legR: 5, kneeR: 6, armL: 7, elbowL: 8, armR: 9, elbowR: 10 };
// Half the shoulder width (arm joint from the centre line) for a build.
export const armZ = (build) => 0.188 + build * 0.016;

// ---- colour helpers ---------------------------------------------------------------
const cache = new Map();
export function lin(hex) {
  let c = cache.get(hex);
  if (!c) {
    const t = new THREE.Color().setHex(hex);
    c = [t.r, t.g, t.b];
    cache.set(hex, c);
  }
  return c;
}
const mul = (c, k) => [c[0] * k, c[1] * k, c[2] * k];
const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

// ---- mesh builder -------------------------------------------------------------------
class Build {
  constructor(far) {
    this.far = far;
    this.p = [];
    this.n = [];
    this.c = [];
    this.si = [];
    this.sw = [];
    this.i = [];
    this.count = 0;
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
    g.userData.triangles = this.i.length / 3;
    return g;
  }
}

// A closed grid surface: K rows of S points, wrapping around in s. Each
// point { x, y, z, col, b0, b1, w }; each row has a centre { x, y, z }
// used to orient normals outward. Normals come from the grid itself
// (finite differences), so every surface is smooth shaded.
function surface(bd, rows, centres, ao = 0.16) {
  const K = rows.length, S = rows[0].length;
  const base = bd.count;
  for (let k = 0; k < K; k++) {
    const r = rows[k], rp = rows[Math.max(0, k - 1)], rn = rows[Math.min(K - 1, k + 1)];
    const C = centres[k];
    for (let s = 0; s < S; s++) {
      const P = r[s];
      const A = r[(s + 1) % S], Z = r[(s + S - 1) % S];
      const tsx = A.x - Z.x, tsy = A.y - Z.y, tsz = A.z - Z.z;
      const tkx = rn[s].x - rp[s].x, tky = rn[s].y - rp[s].y, tkz = rn[s].z - rp[s].z;
      let nx = tsy * tkz - tsz * tky, ny = tsz * tkx - tsx * tkz, nz = tsx * tky - tsy * tkx;
      let l = Math.hypot(nx, ny, nz);
      const ox = P.x - C.x, oy = P.y - C.y, oz = P.z - C.z;
      if (l < 1e-9) {
        // Degenerate (a pole): point away from the centre.
        nx = ox;
        ny = oy;
        nz = oz;
        l = Math.hypot(nx, ny, nz) || 1;
      } else if (nx * ox + ny * oy + nz * oz < 0) {
        nx = -nx;
        ny = -ny;
        nz = -nz;
      }
      nx /= l;
      ny /= l;
      nz /= l;
      // Baked occlusion: faces turned down get darker, plus the point's own
      // factor (creases, inner limbs).
      const occ = (1 - ao * Math.max(0, -ny)) * (P.occ ?? 1);
      bd.p.push(P.x, P.y, P.z);
      bd.n.push(nx, ny, nz);
      bd.c.push(P.col[0] * occ, P.col[1] * occ, P.col[2] * occ);
      bd.si.push(P.b0, P.b1 || 0, 0, 0);
      bd.sw.push(1 - (P.w || 0), P.w || 0, 0, 0);
      bd.count++;
    }
  }
  const N = bd.n;
  const at = (k, s) => base + k * S + (s % S);
  for (let k = 0; k < K - 1; k++) {
    for (let s = 0; s < S; s++) {
      const a = at(k, s), b = at(k, s + 1), c = at(k + 1, s + 1), d = at(k + 1, s);
      tri(bd, N, a, b, c);
      tri(bd, N, a, c, d);
    }
  }
}
function tri(bd, N, a, b, c) {
  const P = bd.p;
  const ux = P[b * 3] - P[a * 3], uy = P[b * 3 + 1] - P[a * 3 + 1], uz = P[b * 3 + 2] - P[a * 3 + 2];
  const vx = P[c * 3] - P[a * 3], vy = P[c * 3 + 1] - P[a * 3 + 1], vz = P[c * 3 + 2] - P[a * 3 + 2];
  const fx = uy * vz - uz * vy, fy = uz * vx - ux * vz, fz = ux * vy - uy * vx;
  if (fx * fx + fy * fy + fz * fz < 1e-14) return; // degenerate at a pole
  const sx = N[a * 3] + N[b * 3] + N[c * 3], sy = N[a * 3 + 1] + N[b * 3 + 1] + N[c * 3 + 1], sz = N[a * 3 + 2] + N[b * 3 + 2] + N[c * 3 + 2];
  if (fx * sx + fy * sy + fz * sz >= 0) bd.i.push(a, b, c);
  else bd.i.push(a, c, b);
}

// Superellipse coordinate.
const se = (t, p) => Math.sign(t) * Math.pow(Math.abs(t), 2 / p);
// Column angles, denser toward the front (a = 0, +x) where the detail is.
// `cuts` (angles from the front, mirrored to both sides) get a doubled
// column so a colour edge there (a jacket opening, a vest side) is crisp
// instead of a sawtooth across the triangles.
function angles(S, q = 1.25, cuts = null) {
  let out = [];
  for (let s = 0; s < S; s++) {
    const x = (s / S) * 2 - 1;
    out.push(Math.PI * Math.sign(x) * Math.pow(Math.abs(x), q));
  }
  if (cuts) {
    const e = 0.002;
    out = out.filter((a) => cuts.every((c) => Math.abs(Math.abs(a) - c) > 0.09));
    for (const c of cuts) out.push(-c - e, -c + e, c - e, c + e);
    out.sort((a, b) => a - b);
  }
  return out;
}

// Loft along y: rings { y, f (radius toward +x), b (toward -x), w (half
// width along z), cx, p (superellipse power), col (array or fn(ca, sa, y)),
// occ, bones: fn(y) -> [b0, b1, w] }. `cz` is the loft's z centre. Far
// LOD keeps every other ring (plus those marked keep) and half the columns.
function loftY(bd, rings, seg, cz, bones, opt = {}) {
  let list = rings;
  if (bd.far) list = rings.filter((r, k) => r.keep || k % 2 === 0 || k === rings.length - 1);
  const S = bd.far ? Math.max(opt.minFar || 5, Math.round(seg * 0.5)) : seg;
  const A = angles(S, opt.q ?? 1.25, bd.far ? null : opt.cuts);
  const rows = [], centres = [];
  for (const R of list) {
    const row = [];
    const [b0, b1, w] = bones(R.y);
    const p = R.p ?? opt.p ?? 2.2;
    for (let s = 0; s < A.length; s++) {
      const ca = Math.cos(A[s]), sa = Math.sin(A[s]);
      const u = se(ca, p), v = se(sa, p);
      const x = (R.cx || 0) + (ca > 0 ? R.f : R.b) * u;
      const z = cz + (R.dz || 0) + R.w * v;
      const col = typeof R.col === 'function' ? R.col(ca, sa, R.y) : R.col;
      let occ = (R.occ ?? 1) * (opt.grad ? opt.grad(R.y) : 1);
      if (opt.inner) occ *= 1 - opt.inner * Math.max(0, -sa * Math.sign(cz)); // limb side facing the body
      row.push({ x, y: R.y + (R.dy ? R.dy(ca, sa) : 0), z, col, occ, b0, b1, w });
    }
    rows.push(row);
    centres.push({ x: R.cx || 0, y: R.y, z: cz });
  }
  surface(bd, rows, centres, opt.ao);
}

// Ellipsoid-like blob around (cx, cy, cz) with radii rx, ry, rz. `opt`:
// p (superellipse power), seg, rows, v0 (start latitude 0..1), deform(pt,
// nx, ny, nz), col(nx, ny, nz) or colour, bone, occ.
function blob(bd, cx, cy, cz, rx, ry, rz, col, bone, opt = {}) {
  const S = bd.far ? Math.max(5, Math.round((opt.seg || 8) * 0.5)) : opt.seg || 8;
  const R = bd.far ? Math.max(3, Math.round((opt.rows || 6) * 0.5)) : opt.rows || 6;
  const p = opt.p || 2;
  const C = { x: cx, y: cy, z: cz };
  const rows = [], centres = [];
  const pt = { x: 0, y: 0, z: 0 };
  for (let r = 0; r <= R; r++) {
    const th = -Math.PI / 2 + (r / R) * Math.PI;
    const cth = Math.cos(th), sth = Math.sin(th);
    const row = [];
    for (let s = 0; s < S; s++) {
      const a = (s / S) * Math.PI * 2;
      const ca = Math.cos(a), sa = Math.sin(a);
      const nx = cth * ca, ny = sth, nz = cth * sa;
      pt.x = se(cth, p) * se(ca, p) * rx;
      pt.y = se(sth, p) * ry;
      pt.z = se(cth, p) * se(sa, p) * rz;
      if (opt.deform) opt.deform(pt, nx, ny, nz);
      const c = typeof col === 'function' ? col(nx, ny, nz) : col;
      row.push({ x: cx + pt.x, y: cy + pt.y, z: cz + pt.z, col: c, occ: opt.occ ?? 1, b0: bone, b1: 0, w: 0 });
    }
    rows.push(row);
    centres.push(C);
  }
  // Every row uses the blob centre, which keeps normals outward.
  surface(bd, rows, centres, opt.ao ?? 0.1);
}

// Bone weights along y: rigid b0 above yj + band, rigid b1 below yj - band.
const joint = (b0, b1, yj, band) => (y) => {
  if (y >= yj + band) return [b0, 0, 0];
  if (y <= yj - band) return [b1, 0, 0];
  return [b0, b1, (yj + band - y) / (2 * band)];
};
const rigid = (b) => () => [b, 0, 0];

// ---- the head --------------------------------------------------------------------
const HEAD = { x: 0.012, y: HIP_Y + NECK_Y + 0.178, rx: 0.098, ry: 0.118, rz: 0.08 };
// Skull shape: narrower jaw, shallower back of the neck, fuller crown.
function headDeform(pt, nx, ny) {
  if (ny < 0) {
    const t = -ny;
    pt.z *= 1 - 0.3 * Math.pow(t, 1.4);
    if (nx < 0) pt.x *= 1 - 0.45 * t;
    else pt.x *= 1 - 0.08 * t;
  } else if (nx < 0) {
    pt.x *= 1 + 0.08 * ny;
  }
  if (nx > 0.55) pt.x *= 0.97;
}
// Front surface x of the head at height y and side offset z (ellipsoid).
function headFront(y, z) {
  const dy = (y - HEAD.y) / HEAD.ry, dz = z / HEAD.rz;
  return HEAD.x + HEAD.rx * 0.97 * Math.sqrt(Math.max(0, 1 - dy * dy - dz * dz));
}

// A hair or hat shell over the skull: from a hairline (latitude per side:
// front, side, back as ny on the unit sphere) up to the crown, `thick`
// beyond the skin. lift raises the crown (volume on top).
function shell(bd, col, front, side, back, thick, opt = {}) {
  const S = bd.far ? 7 : opt.seg || 14;
  const R = bd.far ? 3 : opt.rows || 6;
  const rows = [], centres = [];
  const pt = { x: 0, y: 0, z: 0 };
  for (let r = 0; r <= R; r++) {
    const row = [];
    const v = r / R;
    for (let s = 0; s < S; s++) {
      const a = (s / S) * Math.PI * 2;
      const ca = Math.cos(a), sa = Math.sin(a);
      const hl = ca >= 0 ? side + (front - side) * Math.pow(ca, 1.3) : side + (back - side) * Math.pow(-ca, 1.1);
      const th0 = Math.asin(Math.max(-0.98, Math.min(0.98, hl)));
      const th = th0 + (Math.PI / 2 - th0) * v;
      const cth = Math.cos(th), sth = Math.sin(th);
      const nx = cth * ca, ny = sth, nz = cth * sa;
      pt.x = nx * HEAD.rx;
      pt.y = ny * HEAD.ry;
      pt.z = nz * HEAD.rz;
      headDeform(pt, nx, ny, nz);
      // The edge row sits on the skin; the rest stands off by `thick`.
      const k = 1 + thick * (r === 0 ? 0.12 : Math.min(1, 0.55 + v * 1.6)) + (opt.lift || 0) * Math.max(0, ny) * ny;
      let y = pt.y * (1 + (opt.lift || 0) * 0.5 * Math.max(0, ny));
      let x = pt.x * k, z = pt.z * k;
      if (opt.backX && ca < 0) x *= 1 + opt.backX * -ca * Math.max(0, 1 - Math.abs(ny));
      y = y * (r === 0 ? 1 : 1 + thick * 0.6);
      const c = typeof col === 'function' ? col(r, v, ca, sa) : col;
      row.push({ x: HEAD.x + x, y: HEAD.y + y, z, col: c, occ: 1, b0: B.head, b1: 0, w: 0 });
    }
    rows.push(row);
    centres.push({ x: HEAD.x, y: HEAD.y, z: 0 });
  }
  surface(bd, rows, centres, 0.12);
}

// ---- the whole figure -------------------------------------------------------------
export function buildPerson(L, far = false) {
  const bd = new Build(far);
  const skin = lin(L.skin), shirt = lin(L.shirt), trousers = lin(L.trousers), shoes = lin(L.shoes), hair = lin(L.hair);
  const inner = lin(L.inner), hat = lin(L.hat), vest = L.vest != null ? lin(L.vest) : null;
  const belt = lin(0x1a191b);
  const o = L.outfit;
  const jacket = o === 'jacket' || o === 'crew';
  const police = o === 'police';
  const tucked = o === 'dress' || o === 'long' || police;
  const longSleeve = o !== 'tee';
  const sneaker = o === 'tee' || o === 'hoodie' || o === 'long';
  const sole = sneaker ? lin(0xdedad2) : lin(0x1f1c1a);
  const bw = 0.93 + L.build * 0.15; // shoulder and chest width
  const hipK = 1.05 - L.build * 0.07; // slimmer builds: relatively wider hips
  const waistK = 0.92 + L.build * 0.1;
  const soft = L.build < 0.35; // a softer, narrower-waisted figure
  const AZ = armZ(L.build);
  const cloth = jacket ? 0.012 : o === 'hoodie' ? 0.01 : 0.004; // garment volume over the body
  const lapel = mul(shirt, 0.62);

  // -- legs: trousers with volume over thigh, knee and calf ----------------------
  for (const side of [-1, 1]) {
    const leg = side < 0 ? B.legL : B.legR, knee = side < 0 ? B.kneeL : B.kneeR;
    const z = side * LEG_Z;
    const tr = trousers;
    const crease = (ca, sa) => (Math.abs(sa) < 0.25 && ca > 0 ? mul(tr, 1.06) : tr);
    loftY(bd, [
      { y: 1.0, f: 0.07, b: 0.075, w: 0.07, cx: 0, col: tr, keep: true },
      { y: 0.93, f: 0.09, b: 0.098, w: 0.09, cx: 0.004, col: tr },
      { y: 0.83, f: 0.092, b: 0.09, w: 0.087, cx: 0.008, col: crease },
      { y: 0.71, f: 0.082, b: 0.078, w: 0.077, cx: 0.01, col: crease },
      { y: 0.59, f: 0.07, b: 0.068, w: 0.068, cx: 0.012, col: crease },
      { y: 0.49, f: 0.066, b: 0.064, w: 0.064, cx: 0.014, col: crease, occ: 0.97 },
      { y: 0.4, f: 0.064, b: 0.07, w: 0.064, cx: 0.006, col: crease },
      { y: 0.28, f: 0.062, b: 0.066, w: 0.06, cx: 0.002, col: crease },
      { y: 0.16, f: 0.062, b: 0.064, w: 0.06, cx: 0, col: crease },
      { y: 0.075, f: 0.066, b: 0.066, w: 0.063, cx: 0.002, col: mul(tr, 0.92), keep: true },
      { y: 0.074, f: 0.035, b: 0.035, w: 0.032, cx: 0.0, col: mul(tr, 0.3) },
    ], 9, z, joint(leg, knee, HIP_Y + KNEE_DY, 0.06), { inner: 0.12, ao: 0.1, grad: (y) => 0.84 + 0.16 * Math.min(1, y / 0.9) });

    // Shoe: lofted along x, flat sole, rounded toe and heel.
    const st = [
      [-0.098, 0.035, 0.012, 0.035, 0.02],
      [-0.09, 0.048, 0.035, 0.048, 0.036],
      [-0.06, 0.05, 0.05, 0.05, 0.045],
      [-0.015, 0.05, 0.058, 0.05, 0.048],
      [0.04, 0.04, 0.042, 0.04, 0.051],
      [0.1, 0.032, 0.032, 0.032, 0.049],
      [0.172, 0.022, 0.012, 0.022, 0.028],
      [0.18, 0.018, 0.002, 0.018, 0.006],
    ];
    const S = far ? 6 : 8;
    const list = far ? st.filter((_, k) => k % 2 === 0) : st;
    const rows = [], centres = [];
    const sz = side * (LEG_Z + 0.008);
    for (const [x, yc, up, down, w] of list) {
      const row = [];
      for (let s = 0; s < S; s++) {
        const a = (s / S) * Math.PI * 2;
        const ca = Math.cos(a), sa = Math.sin(a);
        const u = se(ca, 2.8), v = se(sa, 2.6);
        const y = Math.max(0, yc + (ca > 0 ? up : down) * u);
        const bottom = ca < -0.45;
        const col = bottom ? sole : (ca > 0.2 && x > -0.04 && x < 0.08 && !far ? mul(shoes, 1.25) : shoes);
        row.push({ x, y, z: sz + w * v, col, occ: 1, b0: knee, b1: 0, w: 0 });
      }
      rows.push(row);
      centres.push({ x, y: yc, z: sz });
    }
    surface(bd, rows, centres, 0.2);
  }

  // -- torso: pelvis, waist, chest, shoulders --------------------------------------
  // Colour by height and angle for each outfit.
  const hemY = police || tucked ? 1.0 : jacket ? 0.875 : o === 'hoodie' ? 0.945 : 0.965;
  const torsoCol = (ca, sa, y) => {
    const ang = Math.atan2(Math.abs(sa), ca); // 0 front .. PI back
    if (police) {
      if (y < 1.0) return trousers;
      if (y < 1.065) return belt;
      if (y > 1.07 && y < 1.43 && (ang < 1.0 || ang > Math.PI - 1.0)) return vest;
      return shirt;
    }
    if (jacket) {
      // Open front: a straight band of the inner shirt, lapels beside it
      // on the chest, wider at the collar.
      if (y < hemY) return trousers;
      if (ang < (y > 1.4 ? 0.62 : 0.3)) return inner;
      if (ang < 0.62 && y > 1.15) return lapel;
      return shirt;
    }
    if (o === 'hoodie') {
      if (y < hemY) return trousers;
      if (y < hemY + 0.035) return mul(shirt, 0.82); // ribbed hem
      if (y < 1.13 && ang < 0.75 && y > 0.98) return mul(shirt, 0.88); // front pocket
      return shirt;
    }
    if (tucked) {
      if (y < 1.025) return trousers;
      if (y < 1.055) return belt;
      if (o === 'dress' && ca > 0.94 && y < 1.44) return mul(shirt, 0.9); // button line
      return shirt;
    }
    // tee, untucked
    if (y < hemY) return trousers;
    if (y < hemY + 0.015) return mul(shirt, 0.9);
    return shirt;
  };
  const tb = (y) => (y < 1.0 ? [B.body, 0, 0] : y > 1.1 ? [B.torso, 0, 0] : [B.body, B.torso, (y - 1.0) / 0.1]);
  const outer = (y) => (y >= hemY ? cloth : 0) + (police && y > 1.07 && y < 1.43 ? 0.012 : 0) + (police && y > 1.0 && y < 1.065 ? 0.014 : 0);
  const chest = soft ? 0.012 : 0;
  const T = (y, f, b, w, cx = 0, extra = {}) => {
    const d = outer(y);
    return { y, f: f + d, b: b + d, w: w + d, cx, col: torsoCol, ...extra };
  };
  const rings = [
    T(0.8, 0.03, 0.035, 0.05, 0, { keep: true }),
    T(0.825, 0.07, 0.08, 0.1, 0),
    T(0.86, 0.085, 0.1, 0.14 * hipK),
    T(0.93, 0.098, 0.118, 0.165 * hipK),
    T(0.99, 0.098, 0.112, 0.161 * hipK),
    T(1.045, 0.096, 0.1, 0.15 * waistK),
    T(1.1, 0.095, 0.094, (soft ? 0.13 : 0.142) * waistK),
    T(1.17, 0.103, 0.095, 0.146 * bw),
    T(1.25, 0.115 + chest, 0.1, 0.153 * bw),
    T(1.32, 0.12 + chest, 0.105, 0.158 * bw, 0.002),
    T(1.38, 0.114, 0.108, 0.168 * bw, 0),
    T(1.43, 0.1, 0.1, 0.184 * bw, -0.004),
    T(1.465, 0.076, 0.084, 0.148 * bw, -0.008),
    T(1.495, 0.06, 0.068, 0.11 * bw, -0.01),
    T(1.515, 0.05, 0.054, 0.064, -0.01, { keep: true }),
    T(1.52, 0.02, 0.02, 0.02, -0.01, { keep: true }),
  ];
  // Untucked hems and jackets: a lip where the garment ends.
  if (!tucked && !police) {
    const k = rings.findIndex((r) => r.y > hemY + 0.004);
    const yH = hemY + 0.002;
    const lo = rings[k - 1], hi = rings[k];
    const t = (yH - lo.y) / (hi.y - lo.y);
    const at = (a, b) => a + (b - a) * t;
    rings.splice(k, 0,
      { y: hemY - 0.004, f: at(lo.f, hi.f) - cloth, b: at(lo.b, hi.b) - cloth, w: at(lo.w, hi.w) - cloth, cx: 0, col: trousers, occ: 0.7 },
      { y: yH, f: at(lo.f, hi.f) + 0.004, b: at(lo.b, hi.b) + 0.004, w: at(lo.w, hi.w) + 0.004, cx: 0, col: torsoCol });
  }
  const cuts = jacket ? [0.3, 0.62] : police ? [1.0, Math.PI - 1.0] : null;
  loftY(bd, rings, cuts ? 12 : 16, 0, tb, { p: 2.4, q: 1.2, minFar: 8, ao: 0.1, cuts });

  // -- neck and collar -------------------------------------------------------------
  const nb = joint(B.head, B.torso, 1.5, 0.03);
  loftY(bd, [
    { y: 1.6, f: 0.045, b: 0.05, w: 0.048, cx: 0.004, col: skin },
    { y: 1.53, f: 0.05, b: 0.054, w: 0.052, cx: 0, col: skin },
    { y: 1.46, f: 0.054, b: 0.058, w: 0.056, cx: -0.006, col: mul(skin, 0.92) },
  ], 8, 0, nb, { minFar: 5 });
  if (!far && (o === 'dress' || police || jacket || o === 'long')) {
    loftY(bd, [
      { y: 1.555, f: 0.062, b: 0.066, w: 0.066, cx: -0.008, col: shirt, dy: (ca) => (ca > 0.35 ? -0.05 * (ca - 0.35) / 0.65 : 0) },
      { y: 1.5, f: 0.064, b: 0.07, w: 0.072, cx: -0.01, col: shirt, dy: (ca) => (ca > 0.35 ? -0.03 * (ca - 0.35) / 0.65 : 0) },
      { y: 1.47, f: 0.07, b: 0.074, w: 0.078, cx: -0.01, col: shirt },
    ], 10, 0, rigid(B.torso), { q: 1, ao: 0.1 });
  }
  if (o === 'hoodie') {
    // Hood resting on the shoulders behind the neck.
    blob(bd, -0.075, 1.505, 0, 0.06, 0.06, 0.13, mul(shirt, 0.92), B.torso, { seg: 10, rows: 5, deform: (pt, nx) => { if (nx > 0.3) pt.x *= 0.4; } });
  }
  if (police) {
    // Badge, shoulder radio, holster.
    blob(bd, 0.128, 1.355, -0.075, 0.01, 0.022, 0.018, lin(0xcdb25a), B.torso, { seg: 5, rows: 2 });
    if (!far) blob(bd, 0.06, 1.44, -0.12 * bw, 0.022, 0.035, 0.022, lin(0x111214), B.torso, { seg: 5, rows: 3, p: 3 });
    blob(bd, 0.0, 0.97, 0.175 * hipK + 0.012, 0.05, 0.075, 0.025, lin(0x121214), B.body, { seg: 5, rows: 3, p: 3 });
  }

  // -- head, face, hair ---------------------------------------------------------------
  const H = HEAD;
  const sock = mul(skin, 0.84);
  const faceCol = (nx, ny, nz) => {
    // Eye sockets and a hint of warmth on the cheeks.
    if (!far && nx > 0.62 && ny > 0.02 && ny < 0.3 && Math.abs(nz) > 0.12 && Math.abs(nz) < 0.6) return sock;
    if (nx > 0.55 && ny < -0.05 && ny > -0.45 && Math.abs(nz) > 0.3) return mix(skin, lin(0xc86a5a), 0.08);
    return skin;
  };
  blob(bd, H.x, H.y, 0, H.rx, H.ry, H.rz, faceCol, B.head, { seg: 13, rows: 9, deform: headDeform, ao: 0.12 });
  const hs = L.hairStyle;
  if (!far) {
    // Nose, brows, eyes, mouth, ears.
    const fx = (y, z) => headFront(y, z);
    blob(bd, fx(H.y - 0.01, 0) + 0.004, H.y - 0.012, 0, 0.022, 0.03, 0.015, mul(skin, 1.02), B.head, { seg: 6, rows: 4, deform: (pt, nx, ny) => { if (ny < 0) pt.x *= 1 + 0.4 * -ny; } });
    for (const s of [-1, 1]) {
      const ez = s * 0.034;
      // Eye white with a dark iris in front of it.
      blob(bd, fx(H.y + 0.012, ez) - 0.005, H.y + 0.012, ez, 0.008, 0.009, 0.016, lin(0xd8d0c6), B.head, { seg: 6, rows: 3 });
      blob(bd, fx(H.y + 0.012, ez) + 0.0015, H.y + 0.011, ez * 0.97, 0.005, 0.0075, 0.0075, lin(0x221a15), B.head, { seg: 5, rows: 2 });
      blob(bd, fx(H.y + 0.036, ez) - 0.002, H.y + 0.036, ez * 1.05, 0.008, 0.007, 0.025, mul(hs === 'bald' ? skin : hair, 0.75), B.head, { seg: 6, rows: 3 });
      if (hs !== 'long') blob(bd, H.x - 0.012, H.y - 0.002, s * 0.079, 0.018, 0.03, 0.012, mul(skin, 0.95), B.head, { seg: 5, rows: 3 });
    }
    blob(bd, fx(H.y - 0.058, 0) - 0.006, H.y - 0.058, 0, 0.008, 0.007, 0.022, mix(skin, lin(0x8a3a34), 0.35), B.head, { seg: 6, rows: 3 });
  }
  if (hs === 'short') {
    shell(bd, hair, 0.5, 0.2, -0.42, 0.075, { lift: 0.12 });
  } else if (hs === 'long') {
    shell(bd, hair, 0.52, -0.25, -0.5, 0.1, { lift: 0.1, backX: 0.15 });
    loftY(bd, [
      { y: H.y + 0.06, f: 0.03, b: 0.07, w: 0.085, cx: H.x - 0.05, col: hair },
      { y: H.y - 0.06, f: 0.035, b: 0.08, w: 0.095, cx: H.x - 0.06, col: hair },
      { y: H.y - 0.17, f: 0.03, b: 0.06, w: 0.1, cx: H.x - 0.075, col: hair },
      { y: H.y - 0.25, f: 0.02, b: 0.04, w: 0.09, cx: H.x - 0.085, col: mul(hair, 0.9) },
      { y: H.y - 0.27, f: 0.005, b: 0.01, w: 0.05, cx: H.x - 0.088, col: mul(hair, 0.8) },
    ], 10, 0, rigid(B.head), { q: 1 });
  } else if (hs === 'bun') {
    shell(bd, hair, 0.52, 0.1, -0.4, 0.06, { lift: 0.05 });
    blob(bd, H.x - 0.085, H.y + 0.085, 0, 0.045, 0.045, 0.048, mul(hair, 0.95), B.head, { seg: 8, rows: 5 });
  } else if (hs === 'cap' || hs === 'beanie') {
    shell(bd, hair, 0.35, 0.05, -0.42, 0.05, { rows: 2 }); // only its edge shows under the hat
    if (hs === 'cap') {
      const band = police ? lin(0x0c0d10) : mul(hat, 0.85);
      shell(bd, (r) => (r === 0 && police ? band : hat), 0.42, 0.24, 0.18, 0.11, { lift: police ? 0.0 : 0.04, rows: 4 });
      // Peak over the brow.
      blob(bd, headFront(H.y + 0.06, 0) + 0.035, H.y + 0.06, 0, 0.06, 0.012, 0.082, police ? lin(0x0c0d10) : hat, B.head, { seg: 10, rows: 3, deform: (pt) => { pt.y -= Math.max(0, pt.x) * 0.25; } });
      if (police) blob(bd, headFront(H.y + 0.1, 0) + 0.012, H.y + 0.098, 0, 0.008, 0.016, 0.014, lin(0xcdb25a), B.head, { seg: 5, rows: 3 });
    } else {
      shell(bd, (r) => (r <= 1 ? mul(hat, 1.12) : hat), 0.5, 0.16, 0.0, 0.14, { lift: 0.14, rows: 5 });
    }
  }

  // -- arms: deltoid, sleeve, forearm, wrist, a closed hand ------------------------
  for (const side of [-1, 1]) {
    const arm = side < 0 ? B.armL : B.armR, elbow = side < 0 ? B.elbowL : B.elbowR;
    const z = side * AZ;
    const sy = SHOULDER_Y;
    const sl = shirt;
    const cuff = jacket ? mul(shirt, 0.85) : o === 'hoodie' ? mul(shirt, 0.82) : mul(shirt, 0.92);
    const d = longSleeve ? cloth + 0.006 : 0;
    const vestTop = police ? vest : sl;
    const r = (dy, f, b, w, col, cx = 0, extra = {}) => ({ y: sy + dy, f, b, w, cx, col, ...extra });
    const ring = [
      r(0.046, 0.016, 0.018, 0.018, vestTop, -0.006, { keep: true, dz: -0.014 * side }),
      r(0.032, 0.04, 0.042, 0.042, vestTop, -0.005, { dz: -0.007 * side }),
      r(0.0, 0.056 + d, 0.058 + d, 0.058 + d, sl),
      r(-0.07, 0.054 + d, 0.054 + d, 0.054 + d, sl),
    ];
    if (longSleeve) {
      ring.push(
        r(-0.15, 0.054 + d, 0.052 + d, 0.053 + d, sl),
        r(-0.24, 0.05 + d, 0.05 + d, 0.05 + d, sl, 0.002),
        r(-0.3, 0.048 + d, 0.052 + d, 0.049 + d, sl, -0.002),
        r(-0.37, 0.05 + d, 0.048 + d, 0.05 + d, sl, 0.004),
        r(-0.47, 0.044 + d, 0.042 + d, 0.045 + d, sl, 0.006),
        r(-0.52, 0.042 + d, 0.04 + d, 0.043 + d, cuff, 0.006, { keep: true }),
        r(-0.545, 0.04 + d, 0.038 + d, 0.041 + d, cuff, 0.006),
        r(-0.547, 0.03, 0.03, 0.033, mul(skin, 0.7), 0.006),
        r(-0.565, 0.028, 0.027, 0.032, skin, 0.008, { keep: true }),
      );
    } else {
      ring.push(
        r(-0.155, 0.058, 0.056, 0.058, sl, 0, { keep: true }),
        r(-0.158, 0.049, 0.048, 0.049, mul(skin, 0.75)),
        r(-0.2, 0.049, 0.048, 0.049, skin, 0.002),
        r(-0.27, 0.044, 0.045, 0.044, skin, 0.002),
        r(-0.3, 0.043, 0.047, 0.043, skin, -0.002),
        r(-0.36, 0.047, 0.045, 0.047, skin, 0.004),
        r(-0.46, 0.04, 0.037, 0.04, skin, 0.006),
        r(-0.535, 0.03, 0.028, 0.033, skin, 0.006, { keep: true }),
        r(-0.565, 0.028, 0.027, 0.032, skin, 0.008, { keep: true }),
      );
    }
    loftY(bd, ring, 8, z, joint(arm, elbow, sy + ELBOW_DY, 0.05), { inner: 0.14, ao: 0.12 });
    // Fist: a rounded box with knuckles forward, a thumb over the front.
    const hy = sy - 0.64;
    blob(bd, 0.012, hy, z, 0.044, 0.05, 0.031, skin, elbow, { seg: 8, rows: 4, p: 2.8 });
    if (!far) blob(bd, 0.045, hy + 0.012, z - side * 0.016, 0.014, 0.028, 0.015, mul(skin, 0.97), elbow, { seg: 6, rows: 3 });
  }

  return bd.geometry();
}
