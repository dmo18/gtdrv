// Draws the hidden secrets (world/secrets.js): a half-sunk container, a
// rooftop lounge, a sea cave, a rusted lighthouse, a graffiti alley, a
// playground with one odd ride, and the lock-up garage with its roller
// door. Everything is built once from a few MeshBuilder pieces, so the
// whole set is a handful of draw calls. Local frame of each piece: +x is
// the spot's heading.
import * as THREE from 'three';
import { MeshBuilder } from './meshbuilder.js';
import { createRng } from '../core/rng.js';
import { GARAGE_DEPTH, GARAGE_HALF } from '../world/secrets.js';

let stdMat = null, glowMat = null;
function mats() {
  if (!stdMat) {
    stdMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0 });
    glowMat = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false });
  }
  return { std: stdMat, glow: glowMat };
}

const jitter = (rng) => () => rng.next() - 0.5;

function place(group, x, y, z, yaw) {
  group.position.set(x, y, z);
  group.rotation.y = -yaw;
  return group;
}

function addPart(group, b, material) {
  const m = b.build(material);
  if (m) group.add(m);
  return m;
}

// ---- the pieces ---------------------------------------------------------------
function buildContainer(spot, seaY, M) {
  const g = place(new THREE.Group(), spot.x, 0, spot.z, spot.heading);
  const c = new THREE.Group();
  // Out in the shallows, nose down and listing: only the top half shows.
  c.position.set(9, seaY + 0.55, 1.5);
  c.rotation.set(0.2, 0.15, 0.1);
  const b = new THREE.Group();
  const k = new MeshBuilder();
  k.box(-6, -1.3, 6, 1.3, -1.3, 1.3, 0xa8472e, 0xb04e34, 0.9, 1.05);
  for (let x = -5.6; x < 5.8; x += 0.7) {
    k.box(x, -1.34, x + 0.12, 1.34, -1.2, 1.2, 0x8c3a26, 0x8c3a26);
  }
  k.box(-6.05, -1.3, -5.9, 1.3, -1.25, 1.25, 0x5c2a1c, 0x5c2a1c); // rear frame
  // Door end with its locking bars, facing the shore.
  k.box(5.95, -1.3, 6.08, 1.3, -1.25, 1.25, 0x7a3322, 0x7a3322);
  for (const z of [-0.7, -0.25, 0.25, 0.7]) k.cyl(6.12, z, -1.1, 1.1, 0.04, 0.04, 5, 0xc9c2b4);
  // Weed and a stripe of the old owner's paint.
  k.box(-6, -1.31, 6, -1.0, 0.5, 0.8, 0xd9d2c0, 0xd9d2c0);
  addPart(b, k, M.std);
  c.add(b);
  g.add(c);
  // A bright buoy on a rope so it can be spotted from a distance.
  const f = new MeshBuilder();
  f.blob(4.5, seaY + 0.1, -4, 0.45, 0.45, 0.45, 0xf0ba26, 8, 5, 0.7, 1.1);
  addPart(g, f, M.std);
  // Wet sand where the rope is tied.
  const s = new MeshBuilder();
  s.cyl(1, 0, 0.02, 0.06, 2.2, 2, 10, 0xb3a37e, true);
  addPart(g, s, M.std);
  return g;
}

function buildRooftop(spot, M) {
  const g = place(new THREE.Group(), spot.x, spot.roofY, spot.z, spot.heading);
  const rng = createRng(1357), j = jitter(rng);
  const k = new MeshBuilder();
  // A deck of boards, two loungers, a parasol and pots of green.
  k.box(-3.5, -2.5, 3.5, 2.5, 0.02, 0.18, 0xa87c52, 0xb88d5d);
  for (const z of [-1.2, 1.2]) {
    k.box(-2.4, z - 0.4, -0.6, z + 0.4, 0.2, 0.5, 0xf2eadb, 0xf7f0e2);
    k.box(-0.6, z - 0.4, 0.2, z + 0.4, 0.45, 0.62, 0xf2eadb, 0xf7f0e2);
  }
  k.cyl(1.8, 0.6, 0.18, 2.6, 0.06, 0.05, 6, 0x6a6258);
  k.blob(1.8, 2.55, 0.6, 1.7, 0.45, 1.7, 0x20a69a, 10, 4, 0.6, 1.1);
  for (const [x, z] of [[3.1, -2.1], [-3.1, 2.1], [3.1, 2.1]]) {
    k.cyl(x, z, 0.18, 0.7, 0.34, 0.28, 8, 0xb45c3c, true);
    k.blob(x, 1.05, z, 0.5, 0.45, 0.5, 0x3f8f45, 7, 4, 0.55, 1.1, j);
  }
  // A tall slim mast with a lamp: a beacon from the street, seen from afar.
  k.cyl(-3.3, -2.3, 0.18, 6.5, 0.07, 0.05, 6, 0x4a4d52);
  const s = new MeshBuilder();
  s.blob(-3.3, 6.7, -2.3, 0.28, 0.28, 0.28, 0x7ff6e6, 8, 5, 1, 1);
  for (const [x, z] of [[-3.4, -2.4], [3.4, -2.4], [3.4, 2.4], [-3.4, 2.4]]) s.blob(x, 1.9, z, 0.09, 0.09, 0.09, 0xffe3a0, 5, 3, 1, 1);
  addPart(g, k, M.std);
  addPart(g, s, M.glow);
  return g;
}

function buildCave(spot, M) {
  const g = place(new THREE.Group(), spot.x, 0, spot.z, spot.heading);
  const rng = createRng(2468), j = jitter(rng);
  const k = new MeshBuilder();
  const rock = [0x76716a, 0x6a665f, 0x85807a, 0x5f5b55];
  // A cliff face behind the beach, cut by an arch that opens to the sea.
  for (let i = 0; i < 9; i++) {
    const z = -9 + i * 2.3;
    if (Math.abs(z) < 3.4) continue;
    k.blob(-3.5 + (i % 2) * 0.8, 3.2 + (i % 3) * 0.6, z, 4.2, 5.2 + (i % 3), 2.6, rock[i % 4], 7, 5, 0.55, 1.05, j);
  }
  // Pillars and the lintel of the arch.
  k.blob(-0.5, 2.6, -3.6, 3.0, 3.6, 1.9, rock[0], 8, 5, 0.55, 1.05, j);
  k.blob(-0.5, 2.6, 3.6, 3.0, 3.6, 1.9, rock[2], 8, 5, 0.55, 1.05, j);
  k.blob(-0.8, 5.1, 0, 3.4, 1.7, 4.2, rock[1], 8, 5, 0.55, 1.05, j);
  // The dark inside and a few rocks fallen at the mouth.
  k.box(-9, -2.6, -0.5, 2.6, 0, 3.4, 0x14161a, 0x14161a);
  k.blob(3.4, 0.3, -2.4, 1.1, 0.7, 1.0, rock[3], 6, 4, 0.5, 1.0, j);
  k.blob(4.2, 0.2, 2.6, 0.9, 0.55, 0.9, rock[0], 6, 4, 0.5, 1.0, j);
  addPart(g, k, M.std);
  // A dim blue-green glow deep inside: the first clue from the water.
  const s = new MeshBuilder();
  s.blob(-4.5, 0.9, 0.3, 0.22, 0.22, 0.22, 0x3fe0c8, 6, 4, 1, 1);
  addPart(g, s, M.glow);
  return g;
}

function buildLighthouse(spot, M) {
  const g = place(new THREE.Group(), spot.x, 0, spot.z, spot.heading);
  const rng = createRng(9753), j = jitter(rng);
  const k = new MeshBuilder();
  const rock = [0x6d6a64, 0x7c7870, 0x58554f];
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2;
    k.blob(Math.cos(a) * 3.4, 0.5, Math.sin(a) * 3.4, 2.4, 1.6, 2.4, rock[i % 3], 7, 4, 0.55, 1.05, j);
  }
  k.blob(0, 0.9, 0, 3.4, 1.4, 3.4, rock[1], 8, 4, 0.55, 1.05, j);
  // Tower: faded stripes in rust red and bone.
  const bands = [0x9b4f35, 0xb9b09a, 0x8f4630, 0xb3aa94, 0x8a4430];
  for (let i = 0; i < bands.length; i++) {
    const y0 = 1.2 + i * 2.3;
    const r0 = 2.1 - i * 0.16, r1 = 2.1 - (i + 1) * 0.16;
    k.cyl(0, 0, y0, y0 + 2.3, r0, r1, 10, bands[i]);
  }
  // Rust-run streaks, the gallery and a cap on the lantern room.
  for (let i = 0; i < 6; i++) {
    const a = i * 1.1;
    k.cyl(Math.cos(a) * 1.7, Math.sin(a) * 1.7, 2.5 + (i % 3), 5 + (i % 4) * 1.4, 0.07, 0.04, 4, 0x4a2a1c);
  }
  k.cyl(0, 0, 12.7, 13.0, 2.0, 2.0, 12, 0x3d3f44, true);
  k.cyl(0, 0, 13.0, 14.8, 1.05, 0.95, 10, 0x2d3a3d); // glass room, dull and green
  k.cyl(0, 0, 14.8, 15.9, 1.35, 0.15, 10, 0x7a3b28, true);
  k.cyl(0, 0, 15.9, 16.8, 0.05, 0.05, 4, 0x2d2f33);
  addPart(g, k, M.std);
  // The lamp has been dead for years, but something still glows up there.
  const s = new MeshBuilder();
  s.blob(0, 13.9, 0, 0.35, 0.35, 0.35, 0x7ff6e6, 8, 5, 1, 1);
  addPart(g, s, M.glow);
  return g;
}

function tagTexture() {
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 256;
  const g = c.getContext('2d');
  g.clearRect(0, 0, 512, 256);
  g.lineJoin = 'round';
  g.font = 'italic 900 150px Impact, "Arial Black", sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.lineWidth = 22;
  g.strokeStyle = '#0b0d0e';
  g.strokeText('WAKE', 256, 120);
  g.lineWidth = 8;
  g.strokeStyle = '#ff5fa8';
  g.strokeText('WAKE', 252, 116);
  const grad = g.createLinearGradient(0, 40, 0, 200);
  grad.addColorStop(0, '#5ff7e6');
  grad.addColorStop(1, '#0f9e92');
  g.fillStyle = grad;
  g.fillText('WAKE', 252, 116);
  // A swoosh underline and a small ghost.
  g.lineCap = 'round';
  g.strokeStyle = '#0b0d0e';
  g.lineWidth = 14;
  g.beginPath();
  g.moveTo(40, 214);
  g.quadraticCurveTo(250, 170, 470, 222);
  g.stroke();
  g.strokeStyle = '#5ff7e6';
  g.lineWidth = 7;
  g.stroke();
  g.fillStyle = '#f4f2ea';
  g.strokeStyle = '#0b0d0e';
  g.lineWidth = 5;
  g.beginPath();
  g.moveTo(436, 66);
  g.arc(448, 46, 18, Math.PI, 0);
  g.lineTo(466, 78);
  g.lineTo(457, 70);
  g.lineTo(448, 78);
  g.lineTo(439, 70);
  g.lineTo(430, 78);
  g.closePath();
  g.fill();
  g.stroke();
  g.fillStyle = '#0b0d0e';
  g.fillRect(441, 42, 4, 7);
  g.fillRect(452, 42, 4, 7);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function buildAlley(spot, M) {
  const t = spot.tag;
  const g = place(new THREE.Group(), t.x, 0, t.z, Math.atan2(t.nz, t.nx));
  const k = new MeshBuilder();
  // Dumpster, crates and a puddle's worth of litter by the wall.
  k.box(0.2, 3.2, 1.5, 5.4, 0, 1.15, 0x2f5d44, 0x3a6d51);
  k.box(0.2, 3.2, 1.5, 5.4, 1.15, 1.27, 0x1d3a2b, 0x1d3a2b);
  k.box(0.3, -4.6, 1.1, -3.8, 0, 0.8, 0x9a7a4d, 0xa88858);
  k.box(0.3, -4.0, 1.1, -3.2, 0, 0.8, 0x8c6d44, 0x9a7a4d);
  k.box(0.35, -4.4, 1.05, -3.6, 0.8, 1.6, 0x9a7a4d, 0xa88858);
  addPart(g, k, M.std);
  const tex = tagTexture();
  if (tex) {
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(5.6, 2.8),
      new THREE.MeshStandardMaterial({ map: tex, transparent: true, roughness: 0.95, polygonOffset: true, polygonOffsetFactor: -2 }),
    );
    m.position.set(0.04, 2.6, 0);
    m.rotation.y = Math.PI / 2;
    g.add(m);
  } else {
    const f = new MeshBuilder();
    f.box(0.02, -2.4, 0.06, 2.4, 1.4, 3.6, 0x3fe0c8, 0x3fe0c8);
    addPart(g, f, M.std);
  }
  return g;
}

function buildPlayground(spot, M) {
  const g = place(new THREE.Group(), spot.x, 0, spot.z, spot.heading);
  const k = new MeshBuilder();
  k.cyl(0, 0, 0.01, 0.07, 11, 11, 18, 0xd9c58f, true);
  // Swing set.
  const bar = 0x5a6b78;
  for (const z of [-2.2, 2.2]) {
    k.cyl(-5.5, z - 0.5, 0, 2.6, 0.07, 0.06, 5, bar);
    k.cyl(-5.5, z + 0.5, 0, 2.6, 0.07, 0.06, 5, bar);
  }
  k.box(-5.6, -2.7, -5.4, 2.7, 2.55, 2.7, bar, bar);
  for (const z of [-1, 1]) {
    k.box(-5.57, z - 0.01, -5.55, z + 0.01, 0.6, 2.55, 0x2a2a2d, 0x2a2a2d);
    k.box(-5.75, z - 0.25, -5.35, z + 0.25, 0.55, 0.62, 0xe0572f, 0xe0572f);
  }
  // Slide: a ladder, a platform and a ramp.
  k.box(5.2, 3.2, 6.4, 4.4, 1.3, 1.45, 0xe2b629, 0xe2b629);
  for (const [x, z] of [[5.3, 3.3], [6.3, 3.3], [5.3, 4.3], [6.3, 4.3]]) k.cyl(x, z, 0, 1.4, 0.06, 0.06, 5, bar);
  k.box(6.4, 3.4, 9.2, 4.2, 0.2, 0.28, 0x2c8fcf, 0x2c8fcf);
  // Seesaw.
  k.box(-2.6, -7.4, 2.6, -7.1, 0.5, 0.58, 0x4aa05a, 0x4aa05a);
  k.cyl(0, -7.25, 0, 0.5, 0.3, 0.1, 6, bar);
  // The one-off ride: a mast with a turning arm and two pods.
  k.cyl(0, 0, 0.07, 0.4, 1.4, 1.2, 10, 0x6d6e73, true);
  k.cyl(0, 0, 0.4, 4.4, 0.18, 0.12, 8, 0xd9d9dc);
  addPart(g, k, M.std);
  const spin = new THREE.Group();
  spin.position.y = 3.6;
  const a = new MeshBuilder();
  a.box(-4.6, -0.12, 4.6, 0.12, 0, 0.2, 0xe8e4da, 0xe8e4da);
  a.cyl(0, 0, -0.1, 0.4, 0.3, 0.3, 8, 0xd0402f, true);
  // Two pods hang from the arm ends, a rocket and a teacup.
  for (const [x, c, c2] of [[4.4, 0xd0402f, 0xf2d24a], [-4.4, 0x2fa8b8, 0xf4f0e6]]) {
    a.cyl(x, 0, -1.7, 0, 0.04, 0.04, 4, 0x4a4a4f);
    a.cyl(x, 0, -2.7, -1.7, 0.65, 0.7, 10, c, true);
    a.cyl(x, 0, -3.3, -2.7, 0.0, 0.65, 10, c2);
  }
  addPart(spin, a, M.std);
  g.add(spin);
  g.userData.spin = spin;
  return g;
}

// ---- the garage ---------------------------------------------------------------
function buildGarage(garage, M) {
  const g = place(new THREE.Group(), garage.ox, 0, garage.oz, garage.heading);
  const D = GARAGE_DEPTH, H = GARAGE_HALF, T = 0.4;
  const k = new MeshBuilder();
  const wall = 0x8a877e, wall2 = 0x77756e, roof = 0x45484c;
  k.box(-D - T, -H - T, -D, H + T, 0, 3.4, wall, wall);
  k.box(-D, -H - T, 0, -H, 0, 3.4, wall2, wall2);
  k.box(-D, H, 0, H + T, 0, 3.4, wall2, wall2);
  // Front: a beam over the door, door posts and a roof slab.
  k.box(-0.3, -H - T, 0.4, H + T, 2.7, 3.4, wall, wall);
  for (const s of [-1, 1]) k.box(-0.3, s > 0 ? H : -H - T, 0.4, s > 0 ? H + T : -H, 0, 2.7, wall, wall);
  k.box(-D - 0.6, -H - 0.9, 0.9, H + 0.9, 3.4, 3.65, roof, roof);
  // Floor: darker concrete with an oil patch.
  k.box(-D, -H, 0, H, 0.01, 0.03, 0x4c4b48, 0x4c4b48);
  k.box(-5.2, -0.8, -3.2, 0.8, 0.03, 0.04, 0x2f2e2c, 0x2f2e2c);
  // Faded stencil band along the front beam.
  k.box(0.38, -H, 0.43, H, 2.95, 3.05, 0xd9a521, 0xd9a521);
  addPart(g, k, M.std);
  // Dim teal strip light along the ceiling inside.
  const s = new MeshBuilder();
  s.box(-7.6, -0.08, -1.4, 0.08, 3.37, 3.4, 0x7ff6e6, 0x7ff6e6);
  addPart(g, s, M.glow);
  // Roller door: slats hanging from the top of the opening.
  const door = new THREE.Group();
  door.position.set(0.05, 2.7, 0);
  const d = new MeshBuilder();
  for (let i = 0; i < 9; i++) {
    const y1 = -i * 0.3;
    const c = i % 2 ? 0xb9b6ac : 0xaaa79d;
    d.box(-0.04, -H, 0.04, H, y1 - 0.3, y1, c, c);
  }
  d.box(-0.07, -H, 0.07, H, -2.7, -2.6, 0x55575b, 0x55575b);
  d.box(-0.1, -0.3, 0.1, 0.3, -1.4, -1.25, 0x3a3b3e, 0x3a3b3e);
  addPart(door, d, M.std);
  g.add(door);
  g.userData.door = door;
  return g;
}

// Builds every piece into `scene`. Returns { update(dt), setDoor(open 0..1) }.
export function createSecretsMeshes(scene, spots, garage, seaY = -0.6) {
  const M = mats();
  const root = new THREE.Group();
  root.name = 'secrets';
  let ride = null, door = null;
  for (const s of spots) {
    let m = null;
    if (s.kind === 'container') m = buildContainer(s, seaY, M);
    else if (s.kind === 'rooftop') m = buildRooftop(s, M);
    else if (s.kind === 'cave') m = buildCave(s, M);
    else if (s.kind === 'lighthouse') m = buildLighthouse(s, M);
    else if (s.kind === 'alley') m = buildAlley(s, M);
    else if (s.kind === 'playground') {
      m = buildPlayground(s, M);
      ride = m.userData.spin;
    }
    if (m) root.add(m);
  }
  if (garage) {
    const gm = buildGarage(garage, M);
    door = gm.userData.door;
    root.add(gm);
  }
  scene.add(root);
  return {
    root,
    update(dt) {
      if (ride) ride.rotation.y += dt * 0.9;
    },
    setDoor(open) {
      if (door) door.scale.y = Math.max(0.05, 1 - open * 0.95);
    },
  };
}
