// Stylised low-poly boat meshes. Every boat is one merged, vertex-coloured
// mesh: a V-bottomed hull built from cross-sections plus deck furniture.
// Materials and geometries are shared. Origin is the waterline centre;
// the bow points along local +x, up is +y.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { angleDiff } from '../core/rng.js';

const MAT = {
  body: new THREE.MeshLambertMaterial({ vertexColors: true }),
};

const GLASS = 0x22364a;
const TRIM = 0x26292e;
const TEAK = 0x9a6a3e;
const ANTIFOUL = 0x7a2420;
const ENGINE = 0x2b2e33;
const SEAT = 0xe9e4d6;

const tmpColor = new THREE.Color();

// ---- geometry helpers -----------------------------------------------------
function colorize(g, hex) {
  tmpColor.setHex(hex);
  const n = g.attributes.position.count;
  const col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    col[i * 3] = tmpColor.r;
    col[i * 3 + 1] = tmpColor.g;
    col[i * 3 + 2] = tmpColor.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}

// Non-indexed, position + normal + colour only, so parts merge.
function finish(geo, hex) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  if (g.attributes.uv) g.deleteAttribute('uv');
  if (!g.attributes.normal) g.computeVertexNormals();
  colorize(g, hex);
  if (g !== geo) geo.dispose();
  return g;
}

function box(parts, hex, sx, sy, sz, x, y, z, rz = 0) {
  const g = new THREE.BoxGeometry(sx, sy, sz);
  if (rz) g.rotateZ(rz);
  g.translate(x, y, z);
  parts.push(finish(g, hex));
}

// Cylinder along local x (rx = true) or upright.
function cyl(parts, hex, r, len, x, y, z, along = 'x', seg = 8) {
  const g = new THREE.CylinderGeometry(r, r, len, seg);
  if (along === 'x') g.rotateZ(Math.PI / 2);
  else if (along === 'z') g.rotateX(Math.PI / 2);
  g.translate(x, y, z);
  parts.push(finish(g, hex));
}

// Flat-shaded triangle soup with each face oriented away from an inside
// reference point, so winding mistakes cannot turn faces inside out.
class Soup {
  constructor() {
    this.pos = [];
    this.nor = [];
    this.col = [];
  }

  tri(a, b, c, hex, ref) {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz);
    if (len < 1e-9) return; // degenerate (hull points meet at the bow)
    nx /= len; ny /= len; nz /= len;
    const cx = (a[0] + b[0] + c[0]) / 3 - ref[0];
    const cy = (a[1] + b[1] + c[1]) / 3 - ref[1];
    const cz = (a[2] + b[2] + c[2]) / 3 - ref[2];
    if (nx * cx + ny * cy + nz * cz < 0) {
      const t = b; b = c; c = t;
      nx = -nx; ny = -ny; nz = -nz;
    }
    this.pos.push(...a, ...b, ...c);
    tmpColor.setHex(hex);
    for (let i = 0; i < 3; i++) {
      this.nor.push(nx, ny, nz);
      this.col.push(tmpColor.r, tmpColor.g, tmpColor.b);
    }
  }

  quad(a, b, c, d, hex, ref) {
    this.tri(a, b, c, hex, ref);
    this.tri(a, c, d, hex, ref);
  }

  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    return g;
  }
}

// V-bottomed hull from cross-sections, stern (u = 0) to bow (u = 1).
// o: { L, W, fb (deck height at stern), D (keel depth), sheer (extra deck
// height at the bow), bowAt (where the plan view starts to narrow),
// beamStern (stern width factor), top, stripe, bottom, deck colours,
// deckInset: if set, the deck is drawn this far below the gunwale with a
// thin rail (an open cockpit look) }
function hull(parts, o) {
  const N = 12;
  const S = new Soup();
  const st = [];
  for (let i = 0; i <= N; i++) {
    const u = i / N;
    const x = -o.L / 2 + u * o.L;
    let f = o.beamStern + (1 - o.beamStern) * Math.min(1, u / Math.max(0.01, o.bowAt * 0.6));
    if (u > o.bowAt) {
      const t = (u - o.bowAt) / (1 - o.bowAt);
      f *= Math.pow(Math.max(0, 1 - t * t), 0.6);
    }
    const hw = (o.W / 2) * f;
    const yd = o.fb + o.sheer * u * u;
    const kt = Math.max(0, (u - 0.62) / 0.38);
    const yk = -o.D + (o.D + o.fb * 0.55) * Math.pow(kt, 1.6);
    const yc = yk + (yd - yk) * 0.28;
    const ys = yk + (yd - yk) * 0.62; // top of the stripe band
    st.push({ x, hw, yd, yk, yc, ys, wc: hw * 0.86, wsx: hw * 0.97 });
  }
  for (let i = 0; i < N; i++) {
    const a = st[i], b = st[i + 1];
    const ref = [(a.x + b.x) / 2, (a.yd + a.yk) / 2, 0];
    for (const s of [-1, 1]) {
      const a0 = [a.x, a.yd, s * a.hw], b0 = [b.x, b.yd, s * b.hw];
      const a1 = [a.x, a.ys, s * a.wsx], b1 = [b.x, b.ys, s * b.wsx];
      const a2 = [a.x, a.yc, s * a.wc], b2 = [b.x, b.yc, s * b.wc];
      const a3 = [a.x, a.yk, 0], b3 = [b.x, b.yk, 0];
      S.quad(a0, b0, b1, a1, o.top, ref);
      S.quad(a1, b1, b2, a2, o.stripe, ref);
      S.quad(a2, b2, b3, a3, o.bottom, ref);
    }
    // Deck.
    const dy = o.deckInset || 0;
    const up = [(a.x + b.x) / 2, Math.min(a.yd, b.yd) - 5, 0];
    S.quad([a.x, a.yd - dy, -a.hw], [b.x, b.yd - dy, -b.hw], [b.x, b.yd - dy, b.hw], [a.x, a.yd - dy, a.hw], o.deck, up);
    if (dy > 0) {
      // Inner faces of the gunwale above the sunk deck, and its top rail.
      for (const s of [-1, 1]) {
        const inner = [(a.x + b.x) / 2, a.yd, 0];
        const r0 = [a.x, a.yd, s * a.hw * 0.94], r1 = [b.x, b.yd, s * b.hw * 0.94];
        const d0 = [a.x, a.yd - dy, s * a.hw * 0.94], d1 = [b.x, b.yd - dy, s * b.hw * 0.94];
        // Normal faces the centre line: use a reference outside the hull.
        S.quad(r0, r1, d1, d0, o.inner || o.deck, [inner[0], inner[1], s * o.W * 2]);
        S.quad([a.x, a.yd, s * a.hw], [b.x, b.yd, s * b.hw], r1, r0, o.rail || o.top, up);
      }
    }
  }
  // Transom.
  const t = st[0];
  const ref = [t.x + 1, (t.yd + t.yk) / 2, 0];
  const L0 = [t.x, t.yd, -t.hw], L1 = [t.x, t.ys, -t.wsx], L2 = [t.x, t.yc, -t.wc];
  const R0 = [t.x, t.yd, t.hw], R1 = [t.x, t.ys, t.wsx], R2 = [t.x, t.yc, t.wc];
  const K = [t.x, t.yk, 0];
  S.quad(L0, R0, R1, L1, o.top, ref);
  S.quad(L1, R1, R2, L2, o.stripe, ref);
  S.tri(L2, R2, K, o.bottom, ref);
  parts.push(S.build());
  return st;
}

// Box with a smaller top than bottom (cabins, consoles).
function taper(parts, hex, bx0, bx1, tx0, tx1, y0, y1, bw, tw) {
  const S = new Soup();
  const v = [
    [bx0, y0, -bw], [bx1, y0, -bw], [bx1, y0, bw], [bx0, y0, bw],
    [tx0, y1, -tw], [tx1, y1, -tw], [tx1, y1, tw], [tx0, y1, tw],
  ];
  const ref = [(bx0 + bx1 + tx0 + tx1) / 4, (y0 + y1) / 2, 0];
  const quads = [[0, 1, 2, 3], [7, 6, 5, 4], [3, 2, 6, 7], [1, 0, 4, 5], [2, 1, 5, 6], [0, 3, 7, 4]];
  for (const q of quads) S.quad(v[q[0]], v[q[1]], v[q[2]], v[q[3]], hex, ref);
  parts.push(S.build());
}

function outboard(parts, x, deckY, scale, cowl = ENGINE) {
  const s = scale;
  box(parts, cowl, 0.42 * s, 0.5 * s, 0.36 * s, x - 0.2 * s, deckY + 0.15 * s, 0);
  box(parts, 0xd8d8d8, 0.44 * s, 0.06 * s, 0.38 * s, x - 0.2 * s, deckY - 0.08 * s, 0);
  box(parts, TRIM, 0.16 * s, deckY + 0.5 * s, 0.1 * s, x - 0.22 * s, deckY / 2 - 0.3 * s, 0);
  box(parts, TRIM, 0.3 * s, 0.06 * s, 0.14 * s, x - 0.22 * s, -0.5 * s, 0);
}

// ---- per-type builders ----------------------------------------------------
function buildRunabout(spec, color, parts) {
  const L = spec.length, W = spec.width;
  const fb = 0.62;
  hull(parts, {
    L, W, fb, D: spec.draft, sheer: 0.28, bowAt: 0.55, beamStern: 0.9,
    top: color, stripe: color === 0xf4f4f0 ? 0x1e5fa8 : 0xf4f4f0, bottom: 0xeeeeea, deck: 0x8a8f96,
    deckInset: 0.32, inner: SEAT, rail: 0xf4f4f0,
  });
  const fy = fb - 0.32;
  // Bow deck cover in front of the windscreen.
  taper(parts, color, 0.55, L * 0.43, 0.55, L * 0.3, fb, fb + 0.1, W * 0.44, W * 0.25);
  // Windscreen, leaning back.
  box(parts, GLASS, 0.05, 0.42, W * 0.82, 0.48, fb + 0.28, 0, 0.75);
  box(parts, TRIM, 0.07, 0.04, W * 0.84, 0.36, fb + 0.45, 0, 0.75);
  // Console with dash and wheel.
  box(parts, SEAT, 0.5, 0.55, 0.6, 0.1, fy + 0.27, W * 0.22);
  box(parts, TRIM, 0.06, 0.24, 0.24, -0.15, fy + 0.6, W * 0.22, 0.4);
  // Seats.
  for (const zz of [W * 0.22, -W * 0.22]) {
    box(parts, SEAT, 0.5, 0.3, 0.55, -0.6, fy + 0.15, zz);
    box(parts, SEAT, 0.12, 0.45, 0.55, -0.88, fy + 0.4, zz, 0.15);
  }
  box(parts, SEAT, 0.6, 0.32, W * 0.8, -L * 0.36, fy + 0.16, 0);
  outboard(parts, -L / 2, fb, 1.25);
}

function buildJetski(spec, color, parts) {
  const L = spec.length, W = spec.width;
  const fb = 0.38;
  hull(parts, {
    L, W, fb, D: spec.draft, sheer: 0.12, bowAt: 0.4, beamStern: 0.85,
    top: color, stripe: 0xf2f2f2, bottom: 0x2a2d33, deck: 0x8a8f96,
  });
  // Front hood rising toward the handlebars.
  taper(parts, color, -0.05, L * 0.42, 0.0, 0.5, fb, fb + 0.36, W * 0.36, W * 0.2);
  // Seat, long and raised.
  taper(parts, 0x2a3140, -L * 0.42, 0.02, -L * 0.39, -0.02, fb, fb + 0.3, W * 0.19, W * 0.16);
  // Short column and handlebars just above the hood.
  box(parts, 0x1b1d22, 0.12, 0.16, 0.12, 0.08, fb + 0.42, 0, 0.4);
  box(parts, 0x1b1d22, 0.06, 0.05, 0.72, 0.04, fb + 0.5, 0);
  box(parts, 0x50555c, 0.08, 0.08, 0.12, 0.04, fb + 0.5, 0.36);
  box(parts, 0x50555c, 0.08, 0.08, 0.12, 0.04, fb + 0.5, -0.36);
  // Small tinted visor on the hood.
  box(parts, GLASS, 0.04, 0.1, 0.34, 0.24, fb + 0.4, 0, 0.9);
  // Foot-well rails and the jet nozzle.
  box(parts, 0x1b1d22, L * 0.55, 0.05, 0.07, -0.25, fb + 0.02, W * 0.44);
  box(parts, 0x1b1d22, L * 0.55, 0.05, 0.07, -0.25, fb + 0.02, -W * 0.44);
  cyl(parts, 0x50555c, 0.08, 0.2, -L / 2 - 0.05, -0.05, 0);
}

function buildFisher(spec, color, parts) {
  const L = spec.length, W = spec.width;
  const fb = 1.1;
  hull(parts, {
    L, W, fb, D: spec.draft, sheer: 0.55, bowAt: 0.58, beamStern: 0.88,
    top: color, stripe: 0xe8e4d8, bottom: ANTIFOUL, deck: 0x8c8678,
    deckInset: 0.45, inner: 0xd8d2c0, rail: 0xe8e4d8,
  });
  const dy = fb - 0.45;
  // Wheelhouse forward of midships.
  const x0 = 0.1, x1 = 2.6, hw = W * 0.34;
  box(parts, 0xefeadc, x1 - x0, 1.7, hw * 2, (x0 + x1) / 2, dy + 0.85, 0);
  // Window band all round.
  box(parts, GLASS, x1 - x0 + 0.04, 0.5, hw * 2 + 0.04, (x0 + x1) / 2, dy + 1.35, 0);
  taper(parts, color, x0 - 0.15, x1 + 0.25, x0, x1 + 0.1, dy + 1.7, dy + 1.9, hw + 0.12, hw + 0.05);
  // Mast with crosstree and a lamp.
  box(parts, 0xd8d2c0, 0.12, 2.2, 0.12, 1.6, dy + 3.0, 0);
  box(parts, 0xd8d2c0, 0.08, 0.08, 1.4, 1.6, dy + 3.5, 0);
  box(parts, 0xf2c230, 0.14, 0.14, 0.14, 1.6, dy + 4.15, 0);
  // Stern gantry for nets.
  box(parts, 0xd8862a, 0.14, 1.9, 0.14, -L / 2 + 0.5, dy + 0.95, W * 0.36);
  box(parts, 0xd8862a, 0.14, 1.9, 0.14, -L / 2 + 0.5, dy + 0.95, -W * 0.36);
  box(parts, 0xd8862a, 0.16, 0.16, W * 0.8, -L / 2 + 0.5, dy + 1.9, 0);
  // Net drum, fish boxes, life ring.
  cyl(parts, 0x3a5f8a, 0.38, 1.3, -L * 0.22, dy + 0.42, 0, 'z');
  box(parts, 0x2f8fd0, 0.6, 0.35, 0.5, -L * 0.33, dy + 0.18, W * 0.27);
  box(parts, 0xd84a2a, 0.6, 0.35, 0.5, -L * 0.33, dy + 0.18, -W * 0.27);
  box(parts, 0xf0f0f0, 0.06, 0.35, 0.35, x1 + 0.03, dy + 0.8, 0);
  // Exhaust stack behind the wheelhouse.
  cyl(parts, TRIM, 0.1, 0.9, x0 + 0.3, dy + 2.2, hw * 0.6, 'y', 6);
}

function buildYacht(spec, color, parts) {
  const L = spec.length, W = spec.width;
  const fb = 1.45;
  hull(parts, {
    L, W, fb, D: spec.draft, sheer: 0.5, bowAt: 0.5, beamStern: 0.92,
    top: color, stripe: 0x1c2a44, bottom: 0x1c2a44, deck: TEAK,
  });
  const hw = W / 2;
  // Main saloon: tapered, glass band, then flybridge on top.
  taper(parts, color, -L * 0.33, L * 0.2, -L * 0.3, L * 0.08, fb, fb + 1.25, hw * 0.82, hw * 0.75);
  taper(parts, GLASS, -L * 0.31, L * 0.17, -L * 0.29, L * 0.1, fb + 0.45, fb + 1.0, hw * 0.83, hw * 0.79);
  taper(parts, color, -L * 0.2, L * 0.02, -L * 0.17, -L * 0.03, fb + 1.25, fb + 1.65, hw * 0.72, hw * 0.66);
  // Flybridge windscreen and rails.
  box(parts, GLASS, 0.05, 0.4, W * 0.62, -L * 0.03 + 0.08, fb + 1.85, 0, 0.6);
  box(parts, 0xd0d0d0, L * 0.15, 0.04, 0.04, -L * 0.13, fb + 2.05, hw * 0.66);
  box(parts, 0xd0d0d0, L * 0.15, 0.04, 0.04, -L * 0.13, fb + 2.05, -hw * 0.66);
  // Radar arch and mast.
  box(parts, color, 0.25, 0.9, 0.18, -L * 0.18, fb + 2.05, hw * 0.55, -0.25);
  box(parts, color, 0.25, 0.9, 0.18, -L * 0.18, fb + 2.05, -hw * 0.55, -0.25);
  box(parts, color, 0.32, 0.16, W * 0.62, -L * 0.2, fb + 2.5, 0);
  box(parts, 0x9a9a9a, 0.5, 0.06, 0.12, -L * 0.2, fb + 2.62, 0);
  // Sun loungers on the foredeck, swim platform at the stern.
  box(parts, SEAT, 1.4, 0.18, W * 0.42, L * 0.3, fb + 0.29, 0);
  box(parts, TEAK, 0.9, 0.12, W * 0.86, -L / 2 - 0.42, 0.35, 0);
  box(parts, SEAT, 1.0, 0.3, W * 0.6, -L * 0.42, fb + 0.15, 0);
  // Porthole strip on the hull side.
  for (const zz of [hw * 0.97, -hw * 0.97]) {
    box(parts, GLASS, L * 0.28, 0.14, 0.04, L * 0.02, fb * 0.72, zz);
  }
}

function buildInflatable(spec, color, parts) {
  const L = spec.length, W = spec.width;
  const tr = 0.24; // tube radius
  const tz = W / 2 - tr;
  const ty = 0.18;
  // Shallow rigid floor shell.
  hull(parts, {
    L: L * 0.92, W: W * 0.8, fb: 0.12, D: spec.draft, sheer: 0.08, bowAt: 0.6, beamStern: 1,
    top: 0x55595f, stripe: 0x55595f, bottom: 0x3a3d42, deck: 0x6a6e74,
  });
  // Side tubes, ending a little past the transom, and a curved bow tube.
  const bowX = L / 2 - tz - tr;
  const sx0 = -L / 2 - 0.1;
  const len = bowX - sx0;
  cyl(parts, color, tr, len, sx0 + len / 2, ty, tz, 'x', 10);
  cyl(parts, color, tr, len, sx0 + len / 2, ty, -tz, 'x', 10);
  const g = new THREE.TorusGeometry(tz, tr, 8, 10, Math.PI);
  g.rotateX(Math.PI / 2);
  g.rotateY(Math.PI / 2);
  g.translate(bowX, ty, 0);
  parts.push(finish(g, color));
  // End caps and grab line.
  for (const zz of [tz, -tz]) {
    const cap = new THREE.SphereGeometry(tr, 8, 6);
    cap.scale(0.5, 1, 1);
    cap.translate(sx0, ty, zz);
    parts.push(finish(cap, 0x3a3d42));
    box(parts, 0x2a2d32, len * 0.8, 0.03, 0.03, sx0 + len / 2, ty + tr + 0.01, zz);
  }
  // Transom board, thwart seat, small outboard.
  box(parts, 0x3a3d42, 0.08, 0.42, W * 0.72, -L * 0.46 + 0.04, 0.08, 0);
  box(parts, 0xd8d0b8, 0.3, 0.06, tz * 2, -L * 0.05, ty + 0.12, 0);
  outboard(parts, -L * 0.46, 0.3, 0.75, 0x3a3d42);
}

const BUILDERS = {
  runabout: buildRunabout,
  jetski: buildJetski,
  fisher: buildFisher,
  yacht: buildYacht,
  inflatable: buildInflatable,
};

// ---- caches ---------------------------------------------------------------
const geoCache = new Map();

function boatGeometry(spec, color) {
  const key = spec.id + ':' + color;
  let g = geoCache.get(key);
  if (!g) {
    const parts = [];
    (BUILDERS[spec.hull] || buildRunabout)(spec, color, parts);
    g = mergeGeometries(parts, false);
    for (const p of parts) p.dispose();
    g.computeBoundingSphere();
    geoCache.set(key, g);
  }
  return g;
}

// ---- public API -----------------------------------------------------------
export function createBoatMesh(spec, color) {
  const group = new THREE.Group();
  const col = color == null ? spec.colors[0] : color;
  const body = new THREE.Mesh(boatGeometry(spec, col), MAT.body);
  group.add(body);
  // Euler order YZX: yaw about world up, then pitch about the boat's own
  // beam axis (z), then roll about its own (pitched) fore-aft axis (x).
  group.rotation.order = 'YZX';
  group.userData = { spec, body };
  return group;
}

// Place the mesh between the previous and current simulation state.
export function updateBoatMesh(mesh, b, alpha = 1, time = 0) {
  const x = b.px + (b.x - b.px) * alpha;
  const z = b.pz + (b.z - b.pz) * alpha;
  const py = Number.isFinite(b.py) ? b.py : b.y;
  // A faint engine shiver under throttle.
  const shiver = b.throttle > 0.05 ? Math.sin(time * 70) * 0.006 * b.throttle : 0;
  const y = py + (b.y - py) * alpha + shiver;
  const h = b.pheading + angleDiff(b.heading, b.pheading) * alpha;
  const pp = Number.isFinite(b.ppitch) ? b.ppitch : b.pitch;
  const pr = Number.isFinite(b.proll) ? b.proll : b.roll;
  const pitch = pp + (b.pitch - pp) * alpha;
  const roll = pr + (b.roll - pr) * alpha;
  mesh.position.set(x, y, z);
  // rotation.x = roll (right side, +z, goes down for positive roll),
  // rotation.y = -heading, rotation.z = pitch (nose up positive).
  mesh.rotation.set(roll, -h, pitch);
}
