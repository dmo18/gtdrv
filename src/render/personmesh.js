// Realistic clothed person, about 1.78 m tall, facing local +x. The body
// (render/personbody.js) is a sculpted, smooth-shaded figure: shoulders,
// chest, waist, hips, tapered limbs, fists, shoes, a face and hair, with
// clothes in volume. Near the camera it is about 2k triangles, past
// PERSON_LOD_M a coarse copy; a THREE.LOD shows one of the two, both
// skinned to one skeleton, so a person is a single draw call. The bones
// keep the old box-man names (body, torso, head, legL / legR, armL / armR)
// so the walk, aim and lying poses drive them the same way; knees and
// elbows are extra bones. Geometry is shared per look (palette + outfit),
// the material is shared by everybody until a hit flash or fade needs a
// private copy.
import * as THREE from 'three';
import { angleDiff } from '../core/rng.js';
import { buildPerson, HIP_Y, SHOULDER_Y, NECK_Y, KNEE_DY, ELBOW_DY, LEG_Z, armZ } from './personbody.js';

// Clothing color sets for the player and pedestrians. `outfit`: tee,
// long (long sleeves), jacket (open jacket over a shirt), hoodie, dress
// shirt; `hairStyle`: short, long, bun, bald, cap; `build`: 0 slim .. 1
// broad.
export const PERSON_PALETTES = [
  { shirt: 0x3a6ea5, trousers: 0x2b2f3a, skin: 0xe0b48c, hair: 0x2a1c12, outfit: 'tee', hairStyle: 'short', build: 0.6 },
  { shirt: 0xc8553d, trousers: 0x3d3a33, skin: 0x8d5a3b, hair: 0x141010, outfit: 'jacket', inner: 0xe8e4da, hairStyle: 'short', build: 0.8 },
  { shirt: 0x6b8f4e, trousers: 0x4a3b2a, skin: 0xf1c9a5, hair: 0xb07a3a, outfit: 'long', hairStyle: 'long', build: 0.2 },
  { shirt: 0xe8d36a, trousers: 0x29384d, skin: 0xc68e62, hair: 0x3b2516, outfit: 'tee', hairStyle: 'bun', build: 0.25 },
  { shirt: 0x8a4f8f, trousers: 0x1f1f24, skin: 0x5e3c28, hair: 0x0f0c0a, outfit: 'hoodie', hairStyle: 'bald', build: 0.7 },
  { shirt: 0xeeeeea, trousers: 0x6a6f78, skin: 0xd9a87e, hair: 0x6d6d6d, outfit: 'dress', hairStyle: 'short', build: 0.55 },
  { shirt: 0x2f8f8a, trousers: 0x8a7a5c, skin: 0xa86f4a, hair: 0x1a120c, outfit: 'tee', hairStyle: 'cap', hat: 0x24303c, build: 0.5 },
  { shirt: 0xd9833b, trousers: 0x2e3b2a, skin: 0xedc3a0, hair: 0xc9a25a, outfit: 'long', hairStyle: 'long', build: 0.15 },
  { shirt: 0x444b55, trousers: 0x6b4a33, skin: 0x7a4b30, hair: 0x231710, outfit: 'jacket', inner: 0xb8c4cc, hairStyle: 'short', build: 0.9 },
  { shirt: 0xb83a5e, trousers: 0x33405a, skin: 0xe6bc96, hair: 0x5a2e1a, outfit: 'tee', hairStyle: 'bun', build: 0.3 },
];

// Looks the systems pass without an outfit (police officers, the rival
// crew) are recognized by their colors.
const POLICE_SHIRT = 0x26406b;
const CREW_SHIRTS = new Set([0x6e1f4f, 0x7a2a5e, 0x5b1a45]);

// Resolve a palette into a full look description (pure).
export function resolveLook(p = {}) {
  const d = PERSON_PALETTES[0];
  const look = {
    shirt: p.shirt ?? d.shirt, trousers: p.trousers ?? d.trousers, skin: p.skin ?? d.skin, hair: p.hair ?? d.hair,
    outfit: p.outfit || 'tee', hairStyle: p.hairStyle || 'short', build: p.build ?? 0.6, inner: p.inner ?? 0xe6e2d8,
    shoes: p.shoes ?? 0x1c1a18, hat: p.hat ?? 0x1a1c20, vest: null,
  };
  if (p.outfit === 'police' || (!p.outfit && look.shirt === POLICE_SHIRT)) {
    look.outfit = 'police';
    look.hairStyle = 'cap';
    look.hat = 0x182234;
    look.vest = 0x1c232e;
    look.build = 0.75;
  } else if (p.outfit === 'crew' || (!p.outfit && CREW_SHIRTS.has(look.shirt))) {
    look.outfit = 'crew';
    look.inner = 0x18161c;
    look.hairStyle = p.hairStyle || 'beanie';
    look.hat = 0x141218;
    look.build = 0.7;
  }
  return look;
}

// ---- skeleton and geometry ---------------------------------------------------------
// The body itself is built in render/personbody.js.
export const PERSON_LOD_M = 40; // past this the coarse body is drawn

const GEO = new Map();
function lookKey(L) {
  return [L.shirt, L.trousers, L.skin, L.hair, L.outfit, L.hairStyle, L.build, L.inner, L.hat, L.vest, L.shoes].join(':');
}
// Shared body geometry for a look; lod 0 near (about 2k triangles), 1 far.
export function personGeometry(look, lod = 0) {
  const L = resolveLook(look);
  const key = lookKey(L) + ':' + lod;
  let g = GEO.get(key);
  if (!g) {
    g = buildPerson(L, lod === 1);
    GEO.set(key, g);
  }
  return g;
}

let MAT = null;
function sharedMaterial() {
  if (!MAT) MAT = new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.82, metalness: 0 });
  return MAT;
}

const BOUND = new THREE.Sphere(new THREE.Vector3(0, 0.9, 0), 1.15);

export function createPersonMesh(palette = {}) {
  const root = new THREE.Group();
  const mk = (parent, x, y, z) => {
    const b = new THREE.Bone();
    b.position.set(x, y, z);
    if (parent) parent.add(b);
    return b;
  };
  const L = resolveLook(palette);
  const az = armZ(L.build);
  const body = mk(null, 0, 0, 0);
  const torso = mk(body, 0, HIP_Y, 0);
  const head = mk(torso, 0, NECK_Y, 0);
  const legL = mk(body, 0, HIP_Y, -LEG_Z);
  const kneeL = mk(legL, 0, KNEE_DY, 0);
  const legR = mk(body, 0, HIP_Y, LEG_Z);
  const kneeR = mk(legR, 0, KNEE_DY, 0);
  const armL = mk(body, 0, SHOULDER_Y, -az);
  const elbowL = mk(armL, 0, ELBOW_DY, 0);
  const armR = mk(body, 0, SHOULDER_Y, az);
  const elbowR = mk(armR, 0, ELBOW_DY, 0);
  const bones = [body, torso, head, legL, kneeL, legR, kneeR, armL, elbowL, armR, elbowR];
  root.add(body);
  // Near and far bodies share one skeleton; the LOD shows exactly one of
  // them, so a person is a single draw call (plus a held weapon).
  const skeleton = new THREE.Skeleton(bones);
  const lod = new THREE.LOD();
  const mk2 = (lv) => {
    const m = new THREE.SkinnedMesh(personGeometry(palette, lv), sharedMaterial());
    m.boundingSphere = BOUND.clone();
    m.castShadow = false;
    return m;
  };
  const mesh = mk2(0), far = mk2(1);
  lod.addLevel(mesh, 0, 0.1);
  lod.addLevel(far, PERSON_LOD_M, 0.1);
  root.add(lod);
  root.updateMatrixWorld(true);
  mesh.bind(skeleton);
  far.bind(skeleton);
  root.userData.person = { body, torso, head, legL, legR, armL, armR, kneeL, kneeR, elbowL, elbowR, skin: mesh, far, lod, amp: 0, gun: null, gunId: '', raise: 0, flash: 0, fade: 0, op: 1, own: null };
  return root;
}

// ---- held weapon, hit flash and fade (combat) -----------------------------
// The weapon is one small box mesh on the right hand whose geometry is
// swapped per weapon id (shared, made once). Hits flash the whole person
// white (never red); a person who is out fades away. The material is
// cloned per person the first time it is needed, because the shared one
// is used by everybody.
const GUN_DIMS = {
  wrench: [0.05, 0.42, 0.05, 0x8a8f96],
  pistol: [0.06, 0.2, 0.09, 0x2a2c30],
  smg: [0.07, 0.34, 0.11, 0x2a2c30],
  scatter: [0.07, 0.72, 0.09, 0x4a3524],
  lobber: [0.14, 0.78, 0.14, 0x5d6b3a],
  fizz: [0.09, 0.14, 0.09, 0xd6a436],
};
const GUN_GEO = {};
function gunGeo(id) {
  let g = GUN_GEO[id];
  if (!g) {
    const d = GUN_DIMS[id];
    // Along the arm (local -y) from the palm, so a raised arm aims it.
    g = GUN_GEO[id] = new THREE.BoxGeometry(d[0], d[1], d[2]).translate(0, -0.64 - d[1] / 2 + 0.04, 0);
  }
  return g;
}
const GUN_MAT = {};
function gunMat(id) {
  return GUN_MAT[id] || (GUN_MAT[id] = new THREE.MeshStandardMaterial({ color: GUN_DIMS[id][3], roughness: 0.5, metalness: 0.4 }));
}

// One private copy shared by the near and far bodies.
function ownMaterials(mesh, P) {
  if (P.own) return P.own;
  const m = P.skin.material.clone();
  P.skin.material = m;
  P.far.material = m;
  P.own = [m];
  return P.own;
}

function applyArms(mesh, P, w) {
  const arms = w.arms;
  const alive = !w.life || w.life === 'ok' || w.life === 'getup';
  const id = arms && arms.weapon && GUN_DIMS[arms.weapon] ? arms.weapon : '';
  if (id && alive) {
    if (!P.gun) {
      P.gun = new THREE.Mesh(gunGeo(id), gunMat(id));
      P.armR.add(P.gun);
    }
    if (P.gunId !== id) {
      P.gun.geometry = gunGeo(id);
      P.gun.material = gunMat(id);
      P.gunId = id;
    }
    P.gun.visible = true;
  } else if (P.gun) {
    P.gun.visible = false;
  }
  // Raise the arm to aim while a gun is out and fighting.
  const gun = id && id !== 'wrench' && id !== 'fizz';
  const aiming = gun && alive && (arms.cool > 0.04 || w.aiming || w.firing || w.state === 'engage');
  P.raise += ((aiming ? 1 : 0) - P.raise) * 0.3;
  if (P.raise > 0.01) {
    P.armR.rotation.z = P.armR.rotation.z * (1 - P.raise) + 1.5 * P.raise;
    P.armR.rotation.x *= 1 - P.raise;
    P.torso.rotation.z *= 1 - P.raise;
    P.elbowR.rotation.z *= 1 - P.raise;
  }
}

function applyLook(mesh, P, w) {
  const hit = w.hitT > 0 ? Math.min(1, w.hitT / 0.15) : 0;
  const fade = w.fade > 0 ? Math.min(1, w.fade) : 0;
  const flash = hit > 0 ? hit : 0;
  if (flash === P.flash && (1 - fade) === P.op) return;
  const mats = ownMaterials(mesh, P);
  for (let i = 0; i < mats.length; i++) {
    const m = mats[i];
    m.emissive.setScalar(flash * 0.7);
    if (fade !== P.fade) {
      m.transparent = fade > 0;
      m.opacity = 1 - fade;
      m.depthWrite = fade < 0.5;
    }
  }
  P.fade = fade;
  P.flash = flash;
  P.op = 1 - fade;
}

// Walk cycle pose for a stride phase and swing amount (pure): leg and arm
// swings plus knee and elbow bends, written into `out`.
export function walkPose(stride, amp, out) {
  const s = Math.sin(stride), c = Math.cos(stride);
  out.legL = s * amp;
  out.legR = -s * amp;
  // A knee folds while its leg swings forward and stays nearly straight
  // while it carries the weight.
  out.kneeL = -(Math.max(0, c) * 1.15 + 0.06) * amp;
  out.kneeR = -(Math.max(0, -c) * 1.15 + 0.06) * amp;
  out.armL = -s * amp * 0.9;
  out.armR = s * amp * 0.9;
  out.elbow = 0.12 + amp * 0.55;
  out.bob = Math.abs(c) * 0.05 * amp;
  return out;
}
const POSE = { legL: 0, legR: 0, kneeL: 0, kneeR: 0, armL: 0, armR: 0, elbow: 0, bob: 0 };

// Place and animate. `w` is a walker (see entities/onfoot.js).
export function updatePersonMesh(mesh, w, alpha = 1) {
  const P = mesh.userData.person;
  const x = w.px + (w.x - w.px) * alpha;
  const z = w.pz + (w.z - w.pz) * alpha;
  const h = w.pheading + angleDiff(w.heading, w.pheading) * alpha;
  mesh.position.set(x, w.y || 0, z);
  mesh.rotation.y = -h;

  // Swing amount follows speed, eased so stopping settles into idle.
  const want = w.moving ? Math.min(1, w.speed / 6) * 0.55 + Math.min(1, w.speed / 2.4) * 0.35 : 0;
  P.amp += (want - P.amp) * 0.2;
  const a = P.amp;
  walkPose(w.stride || 0, a, POSE);
  P.legL.rotation.z = POSE.legL;
  P.legR.rotation.z = POSE.legR;
  P.kneeL.rotation.z = POSE.kneeL;
  P.kneeR.rotation.z = POSE.kneeR;
  P.armL.rotation.z = POSE.armL;
  P.armR.rotation.z = POSE.armR;
  P.elbowL.rotation.z = POSE.elbow;
  P.elbowR.rotation.z = POSE.elbow;
  // Arms hang slightly away from the body.
  P.armL.rotation.x = 0.08;
  P.armR.rotation.x = -0.08;
  P.body.position.y = POSE.bob;
  P.torso.rotation.z = -0.12 * a * a; // lean into a run
  P.head.rotation.z = 0.08 * a * a;
  if (w.arms) applyArms(mesh, P, w);
  if (w.life === 'down' || w.life === 'out') {
    // limbs flung out while lying down
    P.armL.rotation.x = 0.9;
    P.armR.rotation.x = -0.9;
    P.legL.rotation.x = 0.15;
    P.legR.rotation.x = -0.15;
    P.kneeL.rotation.z = -0.35;
    P.kneeR.rotation.z = -0.1;
    P.elbowL.rotation.z = 0.5;
    P.elbowR.rotation.z = 0.2;
  } else if (P.legL.rotation.x !== 0) {
    P.legL.rotation.x = P.legR.rotation.x = 0;
  }
  if (w.hitT > 0 || P.flash > 0 || w.fade > 0 || P.op < 1) applyLook(mesh, P, w);
}
