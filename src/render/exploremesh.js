// Draws what the explore systems place in the world (docs/REVAMP.md 6.6):
// the twelve garages (a corrugated shed with a roller door that rolls up),
// notice boards for the sign givers, up to two talker figures, and a
// helipad on the roof an air step asks for. Built once from MeshBuilder
// pieces, so it is a handful of draw calls. Local frame of a garage: the
// group sits on the door line and +x is the way the door faces.
import * as THREE from 'three';
import { MeshBuilder } from './meshbuilder.js';
import { createPersonMesh, updatePersonMesh, PERSON_PALETTES } from './personmesh.js';
import { SHED_W, SHED_D, SHED_H } from '../world/garages.js';
import { ADV_TALKERS_MAX } from '../world/adventures.js';
import { specOf } from '../core/garage.js';

let stdMat = null, glowMat = null;
function mats() {
  if (!stdMat) {
    stdMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0.05 });
    glowMat = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false });
  }
  return { std: stdMat, glow: glowMat };
}

const DOOR_TOP = 3.6;
// Where stored cars stand inside a shed: [x along the door axis (negative =
// inside), z across, extra heading]. Shed interior is 9.2 m wide, 13.6 deep.
const STORE_SLOTS = [[-5.2, -2.2, 0.08], [-5.2, 2.2, -0.06], [-10.2, -2.2, -0.04], [-10.2, 2.2, 0.05]];
// Wall and trim colors, one of a few per garage (by its index).
const SKINS = [
  [0x8e8a80, 0x6f6c66, 0xc2452d], [0x7b8794, 0x5d6772, 0xe0a526], [0x9b8f7a, 0x77705f, 0x2c7a7b],
  [0x8a7f86, 0x6c6369, 0x3a7bd5],
];

function buildShed(g, k, idx) {
  const [wall, wall2, trim] = SKINS[idx % SKINS.length];
  const D = SHED_D, H = SHED_W / 2, T = 0.4, Y = SHED_H;
  // Back and side walls, a beam over the door and the posts beside it.
  k.box(-D, -H, -D + T, H, 0, Y, wall, wall);
  k.box(-D, -H, 0, -H + T, 0, Y, wall2, wall2);
  k.box(-D, H - T, 0, H, 0, Y, wall2, wall2);
  k.box(-0.3, -H, 0.1, H, DOOR_TOP, Y, wall, wall);
  // Ribs on the side walls (corrugation read from a distance).
  for (let f = -D + 1.5; f < -0.5; f += 1.5) {
    k.box(f - 0.06, -H - 0.06, f + 0.06, -H, 0.2, Y - 0.1, wall2, wall2);
    k.box(f - 0.06, H, f + 0.06, H + 0.06, 0.2, Y - 0.1, wall2, wall2);
  }
  // A pitched-look roof slab with an overhang at the front.
  k.box(-D - 0.4, -H - 0.5, 0.8, H + 0.5, Y, Y + 0.25, 0x3f4246, 0x4a4e53);
  // Colored trim band and a sign board over the door.
  k.box(0.1, -H, 0.16, H, DOOR_TOP + 0.05, DOOR_TOP + 0.3, trim, trim);
  k.box(0.12, -2.6, 0.22, 2.6, DOOR_TOP + 0.35, Y - 0.1, 0xf1ead8, 0xf1ead8);
  k.box(0.22, -2.3, 0.26, 2.3, DOOR_TOP + 0.5, Y - 0.25, trim, trim);
  // Floor inside, the forecourt slab with two paint lines.
  k.box(-D + T, -H + T, 0, H - T, 0.01, 0.04, 0x4d4c49, 0x4d4c49);
  k.box(0, -8, 8, 8, 0.01, 0.035, 0x7a7872, 0x7a7872);
  for (const s of [-3.2, 3.2]) k.box(0.6, s - 0.08, 7.4, s + 0.08, 0.035, 0.05, 0xe8e2c8, 0xe8e2c8);
}

function buildDoor(M) {
  const door = new THREE.Group();
  door.position.set(0.02, DOOR_TOP, 0);
  const d = new MeshBuilder();
  const H = SHED_W / 2 - 0.4;
  for (let i = 0; i < 12; i++) {
    const y1 = -i * 0.3;
    const c = i % 2 ? 0xbdb9ae : 0xaeaa9f;
    d.box(-0.04, -H, 0.04, H, y1 - 0.3, y1, c, c);
  }
  d.box(-0.07, -H, 0.07, H, -DOOR_TOP, -DOOR_TOP + 0.12, 0x55575b, 0x55575b);
  d.box(-0.1, -0.35, 0.1, 0.35, -1.6, -1.45, 0x3a3b3e, 0x3a3b3e);
  const m = d.build(M.std);
  if (m) door.add(m);
  return door;
}

function buildSign(a, k) {
  const x = a.giver.x, z = a.giver.z;
  // Two posts and a cork board facing south (readable from the road).
  k.box(x - 0.9, z - 0.06, x - 0.78, z + 0.06, 0, 2.1, 0x5a3e2a, 0x5a3e2a);
  k.box(x + 0.78, z - 0.06, x + 0.9, z + 0.06, 0, 2.1, 0x5a3e2a, 0x5a3e2a);
  k.box(x - 1.0, z - 0.05, x + 1.0, z + 0.05, 1.0, 2.0, 0xa77b4f, 0x6d4f33);
  k.box(x - 0.8, z + 0.05, x - 0.1, z + 0.07, 1.25, 1.85, 0xf3efe2, 0xf3efe2);
  k.box(x + 0.05, z + 0.05, x + 0.75, z + 0.07, 1.15, 1.6, 0xffe08a, 0xffe08a);
  k.box(x - 1.05, z - 0.1, x + 1.05, z + 0.1, 2.0, 2.12, 0x3c2a1d, 0x3c2a1d);
}

function buildPad(s, k, g) {
  // A painted pad on the roof: dark disc, yellow ring and an H.
  const y = s.minY + 1.02;
  k.box(s.x - 7, s.z - 7, s.x + 7, s.z + 7, y, y + 0.04, 0x2f3236, 0x2f3236);
  g.box(s.x - 6, s.z - 6, s.x + 6, s.z - 5.5, y + 0.04, y + 0.07, 0xffd34d, 0xffd34d);
  g.box(s.x - 6, s.z + 5.5, s.x + 6, s.z + 6, y + 0.04, y + 0.07, 0xffd34d, 0xffd34d);
  g.box(s.x - 6, s.z - 6, s.x - 5.5, s.z + 6, y + 0.04, y + 0.07, 0xffd34d, 0xffd34d);
  g.box(s.x + 5.5, s.z - 6, s.x + 6, s.z + 6, y + 0.04, y + 0.07, 0xffd34d, 0xffd34d);
  k.box(s.x - 2.4, s.z - 3, s.x - 1.5, s.z + 3, y + 0.04, y + 0.07, 0xf5f5f0, 0xf5f5f0);
  k.box(s.x + 1.5, s.z - 3, s.x + 2.4, s.z + 3, y + 0.04, y + 0.07, 0xf5f5f0, 0xf5f5f0);
  k.box(s.x - 1.5, s.z - 0.45, s.x + 1.5, s.z + 0.45, y + 0.04, y + 0.07, 0xf5f5f0, 0xf5f5f0);
}

// Returns { root, setDoor(index, open 0..1), update(dt, talkers, time) }.
// `makeCar(spec, color)` builds one car mesh (the public create function of
// the car kind); without it no stored cars are drawn.
export function createExploreMeshes(scene, { garages = [], adventures = [], makeCar = null }) {
  const M = mats();
  const root = new THREE.Group();
  root.name = 'explore';
  const doors = [];
  garages.forEach((g, i) => {
    const grp = new THREE.Group();
    grp.position.set(g.door.x, 0, g.door.z);
    grp.rotation.y = -g.heading;
    const k = new MeshBuilder();
    buildShed(g, k, i);
    const m = k.build(M.std);
    if (m) grp.add(m);
    // A dim strip light inside so the open door shows a lit bay.
    const s = new MeshBuilder();
    s.box(-SHED_D + 2, -0.08, -1.5, 0.08, SHED_H - 0.05, SHED_H - 0.02, 0xfff2c8, 0xfff2c8);
    const sm = s.build(M.glow);
    if (sm) grp.add(sm);
    const door = buildDoor(M);
    grp.add(door);
    doors.push(door);
    root.add(grp);
  });
  const k = new MeshBuilder(), gl = new MeshBuilder();
  for (const a of adventures) {
    if (a.giver.type === 'sign') buildSign(a, k);
    for (const s of a.steps) if (s.mode === 'air' && s.minY != null && s.minY > 5) buildPad(s, k, gl);
  }
  const km = k.build(M.std);
  if (km) root.add(km);
  const gm = gl.build(M.glow);
  if (gm) root.add(gm);
  // Talkers: a few figures moved to the nearest talker givers.
  const people = [];
  const pose = { x: 0, z: 0, px: 0, pz: 0, heading: 0, pheading: 0, speed: 0, vx: 0, vz: 0, stride: 0, life: 'ok' };
  for (let i = 0; i < ADV_TALKERS_MAX; i++) {
    const mesh = createPersonMesh(PERSON_PALETTES[(i * 3 + 1) % PERSON_PALETTES.length]);
    mesh.visible = false;
    root.add(mesh);
    people.push(mesh);
  }
  scene.add(root);
  // Stored cars inside the open garage: at most STORE_MAX, in two rows
  // facing the door. Built when the list or the garage changes, never per frame.
  const bay = new THREE.Group();
  bay.name = 'garage-cars';
  bay.visible = false;
  root.add(bay);
  const bayMeshes = [];
  const clearBay = () => {
    for (const m of bayMeshes) bay.remove(m);
    bayMeshes.length = 0;
    bay.visible = false;
  };
  return {
    root,
    bay,
    // Garage `i` (or -1 for none) shows `n` of `cars` ({ spec, color }).
    setStored(i, cars, n) {
      clearBay();
      const g = garages[i];
      if (!g || !makeCar || n <= 0) return;
      const ux = Math.cos(g.heading), uz = Math.sin(g.heading);
      const px = -uz, pz = ux;
      const count = Math.min(n, STORE_SLOTS.length);
      // Two cars sit side by side in the front row; more go behind them.
      for (let k = 0; k < count; k++) {
        const spec = specOf(cars[k].spec);
        if (!spec) continue;
        const slot = STORE_SLOTS[k];
        const m = makeCar(spec, cars[k].color);
        if (!m) continue;
        const lx = slot[0], lz = slot[1];
        m.position.set(g.door.x + ux * lx + px * lz, 0, g.door.z + uz * lx + pz * lz);
        m.rotation.set(0, -(g.heading + slot[2]), 0);
        bay.add(m);
        bayMeshes.push(m);
      }
      bay.visible = bayMeshes.length > 0;
    },
    setDoor(i, open) {
      const d = doors[i];
      if (d) d.scale.y = Math.max(0.04, 1 - open * 0.96);
    },
    update(_dt, talkers, time) {
      for (let i = 0; i < people.length; i++) {
        const mesh = people[i];
        const a = talkers && talkers[i];
        if (!a) { if (mesh.visible) mesh.visible = false; continue; }
        mesh.visible = true;
        pose.x = pose.px = a.giver.x;
        pose.z = pose.pz = a.giver.z;
        // Turns a little from side to side while waiting.
        pose.heading = pose.pheading = Math.PI / 2 + Math.sin(time * 0.4 + i) * 0.6;
        updatePersonMesh(mesh, pose, 1);
      }
    },
  };
}
