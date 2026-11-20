// Stylised low-poly vehicle meshes. Static body parts are merged into one
// vertex-coloured mesh per vehicle; wheels and lights are separate so they
// can move or change brightness. Materials are shared by every vehicle.
// Origin is the ground centre of the car; the car points along local +x.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { angleDiff } from '../core/rng.js';

// ---- shared materials -----------------------------------------------------
const MAT = {
  body: new THREE.MeshLambertMaterial({ vertexColors: true }),
  wheel: new THREE.MeshLambertMaterial({ color: 0x1a1a1a }),
  head: new THREE.MeshLambertMaterial({ color: 0xfff6d8, emissive: 0xfff2c0, emissiveIntensity: 0.9 }),
  tailDim: new THREE.MeshLambertMaterial({ color: 0x5a0a0a, emissive: 0x900000, emissiveIntensity: 0.5 }),
  tailBright: new THREE.MeshLambertMaterial({ color: 0xff3030, emissive: 0xff1010, emissiveIntensity: 1.6 }),
  redOn: new THREE.MeshLambertMaterial({ color: 0xff2020, emissive: 0xff0000, emissiveIntensity: 2 }),
  redOff: new THREE.MeshLambertMaterial({ color: 0x501010, emissive: 0x200000 }),
  blueOn: new THREE.MeshLambertMaterial({ color: 0x2050ff, emissive: 0x0030ff, emissiveIntensity: 2 }),
  blueOff: new THREE.MeshLambertMaterial({ color: 0x101850, emissive: 0x000020 }),
};

const GLASS = 0x1b2530;
const TRIM = 0x222222;
const CHROME = 0x9a9a9a;

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

function box(parts, hex, sx, sy, sz, x, y, z) {
  const g = new THREE.BoxGeometry(sx, sy, sz);
  g.translate(x, y, z);
  parts.push(finish(g, hex));
}

// A box whose top face is smaller than its bottom (a cabin / greenhouse).
// Bottom spans x in [bx0, bx1], top [tx0, tx1]; half widths bw and tw.
function taper(parts, hex, bx0, bx1, tx0, tx1, y0, y1, bw, tw) {
  const v = [
    [bx0, y0, -bw], [bx1, y0, -bw], [bx1, y0, bw], [bx0, y0, bw],
    [tx0, y1, -tw], [tx1, y1, -tw], [tx1, y1, tw], [tx0, y1, tw],
  ];
  // Faces as quads, counter-clockwise seen from outside.
  const quads = [
    [0, 1, 2, 3], // bottom
    [7, 6, 5, 4], // top
    [3, 2, 6, 7], // +z side
    [1, 0, 4, 5], // -z side
    [2, 1, 5, 6], // front (+x)
    [0, 3, 7, 4], // rear (-x)
  ];
  const pos = [];
  for (const q of quads) {
    const [a, b, c, d] = q;
    pos.push(...v[a], ...v[b], ...v[c], ...v[a], ...v[c], ...v[d]);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  parts.push(finish(g, hex));
}

// ---- body builders per silhouette ----------------------------------------
// Each adds parts for a spec with length L, width W, height H.
function buildBody(spec, color, parts) {
  const L = spec.length, W = spec.width, H = spec.height;
  const hw = W / 2;
  const wr = spec.wheelRadius || 0.33;
  const sill = wr * 0.9; // bottom of the body
  const t = spec.body;

  if (t === 'van') {
    const top = H;
    box(parts, color, L * 0.82, top - sill, W, -L * 0.09, (top + sill) / 2, 0);
    // Sloped nose with windscreen.
    taper(parts, color, L * 0.32, L / 2, L * 0.32, L * 0.36, sill, H * 0.55, hw, hw);
    taper(parts, GLASS, L * 0.31, L * 0.37, L * 0.31, L * 0.32, H * 0.55, top - 0.08, hw * 0.96, hw * 0.96);
    box(parts, GLASS, L * 0.35, H * 0.25, W + 0.02, L * 0.08, H * 0.75, 0);
  } else if (t === 'truck') {
    // Cab at the front, tall cargo box behind.
    const cabL = L * 0.26;
    const cabX = L / 2 - cabL / 2;
    box(parts, color, cabL, H * 0.78 - sill, W, cabX, (H * 0.78 + sill) / 2, 0);
    box(parts, GLASS, cabL * 0.25, H * 0.22, W * 0.92, L / 2 - cabL * 0.12, H * 0.62, 0);
    box(parts, TRIM, L * 0.7, 0.25, W * 0.9, -L * 0.13, sill + 0.12, 0);
    box(parts, 0xe6e6e0, L * 0.7, H - sill - 0.25, W * 1.02, -L * 0.15, (H + sill + 0.25) / 2, 0);
  } else if (t === 'pickup') {
    const bodyTop = H * 0.55;
    box(parts, color, L, bodyTop - sill, W, 0, (bodyTop + sill) / 2, 0);
    // Cab.
    taper(parts, GLASS, -L * 0.12, L * 0.18, -L * 0.1, L * 0.06, bodyTop, H - 0.06, hw * 0.95, hw * 0.88);
    box(parts, color, L * 0.17, 0.07, W * 0.88, -L * 0.02, H - 0.03, 0);
    // Open bed: floor slightly sunk, side walls stand up.
    box(parts, TRIM, L * 0.36, 0.05, W * 0.9, -L * 0.31, bodyTop + 0.01, 0);
    box(parts, color, L * 0.38, 0.28, 0.08, -L * 0.31, bodyTop + 0.14, hw - 0.04);
    box(parts, color, L * 0.38, 0.28, 0.08, -L * 0.31, bodyTop + 0.14, -hw + 0.04);
    box(parts, color, 0.08, 0.28, W, -L / 2 + 0.04, bodyTop + 0.14, 0);
  } else {
    // Cars: sedan, hatch, coupe.
    const beltY = t === 'coupe' ? H * 0.58 : H * 0.6;
    box(parts, color, L, beltY - sill, W, 0, (beltY + sill) / 2, 0);
    // Slight bonnet/boot rise so the side is not a plain slab.
    box(parts, color, L * 0.94, 0.06, W * 0.96, 0, beltY + 0.03, 0);
    let b0, b1, t0, t1;
    if (t === 'hatch') {
      b0 = -L * 0.47; b1 = L * 0.2; t0 = -L * 0.43; t1 = L * 0.02;
    } else if (t === 'coupe') {
      b0 = -L * 0.3; b1 = L * 0.12; t0 = -L * 0.16; t1 = -L * 0.03;
    } else {
      b0 = -L * 0.3; b1 = L * 0.18; t0 = -L * 0.2; t1 = L * 0.03;
    }
    const tw = t === 'coupe' ? hw * 0.8 : hw * 0.86;
    taper(parts, GLASS, b0, b1, t0, t1, beltY + 0.06, H - 0.05, hw * 0.94, tw);
    box(parts, color, (t1 - t0) * 1.02, 0.06, tw * 2.02, (t0 + t1) / 2, H - 0.03, 0);
    if (t === 'coupe') {
      // Small rear lip spoiler.
      box(parts, TRIM, 0.12, 0.08, W * 0.85, -L / 2 + 0.12, beltY + 0.1, 0);
    }
  }

  // Bumpers and grille, shared by all.
  box(parts, TRIM, 0.12, 0.22, W * 1.01, L / 2 - 0.04, sill + 0.08, 0);
  box(parts, TRIM, 0.12, 0.22, W * 1.01, -L / 2 + 0.04, sill + 0.08, 0);
  box(parts, CHROME, 0.04, 0.14, W * 0.4, L / 2 + 0.01, sill + 0.32, 0);
  // Dark wheel arches read as the underside.
  box(parts, 0x111111, L * 0.96, 0.12, W * 0.9, 0, sill - 0.02, 0);

  if (spec.id === 'taxi') {
    box(parts, 0xf8f4e0, 0.5, 0.18, 0.28, -L * 0.08, H + 0.09, 0);
    box(parts, 0x202020, 0.52, 0.04, 0.3, -L * 0.08, H + 0.02, 0);
  }
  if (spec.id === 'police') {
    // White doors band.
    box(parts, 0xf2f2f2, L * 0.36, (beltYFor(spec) - sill) * 0.7, W * 1.005, 0, sill + (beltYFor(spec) - sill) * 0.5, 0);
    box(parts, 0x202020, 0.3, 0.06, W * 0.7, -L * 0.08, H + 0.03, 0);
  }
}

function beltYFor(spec) {
  return spec.body === 'coupe' ? spec.height * 0.58 : spec.height * 0.6;
}

// ---- caches ---------------------------------------------------------------
const bodyCache = new Map();
const wheelGeoCache = new Map();
const lightGeoCache = new Map();

function bodyGeometry(spec, color) {
  const key = spec.id + ':' + color;
  let g = bodyCache.get(key);
  if (!g) {
    const parts = [];
    buildBody(spec, color, parts);
    g = mergeGeometries(parts, false);
    for (const p of parts) p.dispose();
    g.computeBoundingSphere();
    bodyCache.set(key, g);
  }
  return g;
}

function wheelGeometry(r, w) {
  const key = r.toFixed(2) + ':' + w.toFixed(2);
  let g = wheelGeoCache.get(key);
  if (!g) {
    g = new THREE.CylinderGeometry(r, r, w, 10);
    g.rotateX(Math.PI / 2); // axle along z
    wheelGeoCache.set(key, g);
  }
  return g;
}

// Two small boxes at +z and -z, used for head and tail lights.
function lightPairGeometry(spec, front) {
  const key = spec.id + (front ? ':f' : ':r');
  let g = lightGeoCache.get(key);
  if (!g) {
    const L = spec.length, W = spec.width;
    const sill = (spec.wheelRadius || 0.33) * 0.9;
    const y = spec.body === 'truck' && !front ? sill + 0.35 : sill + 0.38;
    const x = front ? L / 2 + 0.01 : -L / 2 - 0.01;
    const a = new THREE.BoxGeometry(0.06, 0.12, W * 0.2);
    a.translate(x, y, W * 0.36);
    const b = new THREE.BoxGeometry(0.06, 0.12, W * 0.2);
    b.translate(x, y, -W * 0.36);
    g = mergeGeometries([a, b], false);
    a.dispose();
    b.dispose();
    lightGeoCache.set(key, g);
  }
  return g;
}

let barGeo = null;
function lightBarGeometry() {
  if (!barGeo) barGeo = new THREE.BoxGeometry(0.22, 0.1, 0.32);
  return barGeo;
}

// ---- public API -----------------------------------------------------------
export function createVehicleMesh(spec, color) {
  const group = new THREE.Group();
  const col = color == null ? spec.colors[0] : color;

  const body = new THREE.Mesh(bodyGeometry(spec, col), MAT.body);
  group.add(body);

  const head = new THREE.Mesh(lightPairGeometry(spec, true), MAT.head);
  const tail = new THREE.Mesh(lightPairGeometry(spec, false), MAT.tailDim);
  group.add(head, tail);

  // Wheels: pivot (steer) -> mesh (spin).
  const wr = spec.wheelRadius || 0.33;
  const wgeo = wheelGeometry(wr, spec.body === 'truck' ? 0.4 : 0.26);
  const wheels = [];
  const frontWheels = [];
  const ax = spec.wheelBase / 2;
  const az = spec.width / 2 - 0.12;
  for (let i = 0; i < 4; i++) {
    const front = i < 2;
    const pivot = new THREE.Group();
    pivot.position.set(front ? ax : -ax, wr, i % 2 === 0 ? az : -az);
    const m = new THREE.Mesh(wgeo, MAT.wheel);
    pivot.add(m);
    group.add(pivot);
    wheels.push(m);
    if (front) frontWheels.push(pivot);
  }

  let barRed = null, barBlue = null;
  if (spec.id === 'police') {
    barRed = new THREE.Mesh(lightBarGeometry(), MAT.redOff);
    barBlue = new THREE.Mesh(lightBarGeometry(), MAT.blueOff);
    const y = spec.height + 0.11;
    barRed.position.set(-spec.length * 0.08, y, 0.2);
    barBlue.position.set(-spec.length * 0.08, y, -0.2);
    group.add(barRed, barBlue);
  }

  group.rotation.order = 'YXZ';
  group.userData = { spec, body, head, tail, wheels, frontWheels, barRed, barBlue };
  return group;
}

// Place the mesh between the previous and current simulation state.
export function updateVehicleMesh(mesh, v, alpha = 1) {
  const x = v.px + (v.x - v.px) * alpha;
  const z = v.pz + (v.z - v.pz) * alpha;
  const h = v.pheading + angleDiff(v.heading, v.pheading) * alpha;
  mesh.position.set(x, 0, z);
  // Euler order YXZ: yaw, then roll about forward (x), then pitch about z.
  mesh.rotation.set(v.roll, -h, v.pitch);
  const ud = mesh.userData;
  for (let i = 0; i < ud.wheels.length; i++) ud.wheels[i].rotation.z = -v.wheelSpin;
  const steer = v.steerAngle != null ? v.steerAngle : v.steer * v.spec.steerMax;
  for (let i = 0; i < ud.frontWheels.length; i++) ud.frontWheels[i].rotation.y = -steer;
}

// Brake lights and police light bar.
export function setVehicleLights(mesh, opts) {
  const ud = mesh.userData;
  ud.tail.material = opts && opts.brake ? MAT.tailBright : MAT.tailDim;
  if (ud.barRed) {
    const on = !!(opts && opts.siren);
    const phase = on ? Math.floor((opts.time || 0) * 6) % 2 : -1;
    ud.barRed.material = phase === 0 ? MAT.redOn : MAT.redOff;
    ud.barBlue.material = phase === 1 ? MAT.blueOn : MAT.blueOff;
  }
}
