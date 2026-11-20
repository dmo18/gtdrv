// Stylised low-poly person built from boxes, about 1.8 m tall, facing
// local +x. Head, torso, arms and legs are separate pivoted groups so
// they can swing. Geometries and materials are shared via module caches.
import * as THREE from 'three';
import { angleDiff } from '../core/rng.js';

// Clothing colour sets for the player and future pedestrians.
export const PERSON_PALETTES = [
  { shirt: 0x3a6ea5, trousers: 0x2b2f3a, skin: 0xe0b48c, hair: 0x2a1c12 },
  { shirt: 0xc8553d, trousers: 0x3d3a33, skin: 0x8d5a3b, hair: 0x141010 },
  { shirt: 0x6b8f4e, trousers: 0x4a3b2a, skin: 0xf1c9a5, hair: 0xb07a3a },
  { shirt: 0xe8d36a, trousers: 0x29384d, skin: 0xc68e62, hair: 0x3b2516 },
  { shirt: 0x8a4f8f, trousers: 0x1f1f24, skin: 0x5e3c28, hair: 0x0f0c0a },
  { shirt: 0xeeeeea, trousers: 0x6a6f78, skin: 0xd9a87e, hair: 0x6d6d6d },
  { shirt: 0x2f8f8a, trousers: 0x8a7a5c, skin: 0xa86f4a, hair: 0x1a120c },
  { shirt: 0xd9833b, trousers: 0x2e3b2a, skin: 0xedc3a0, hair: 0xc9a25a },
  { shirt: 0x444b55, trousers: 0x6b4a33, skin: 0x7a4b30, hair: 0x231710 },
  { shirt: 0xb83a5e, trousers: 0x33405a, skin: 0xe6bc96, hair: 0x5a2e1a },
];

// ---- shared caches ---------------------------------------------------------
const MATS = new Map();
function mat(hex) {
  let m = MATS.get(hex);
  if (!m) MATS.set(hex, (m = new THREE.MeshLambertMaterial({ color: hex })));
  return m;
}

// Box geometries hang below (or sit above) their pivot.
let GEO = null;
function geos() {
  if (GEO) return GEO;
  const hang = (sx, sy, sz) => new THREE.BoxGeometry(sx, sy, sz).translate(0, -sy / 2, 0);
  GEO = {
    thigh: hang(0.17, 0.46, 0.17),
    shin: hang(0.15, 0.44, 0.15).translate(0, -0.46, 0),
    shoe: new THREE.BoxGeometry(0.26, 0.08, 0.16).translate(0.04, -0.86, 0),
    torso: new THREE.BoxGeometry(0.26, 0.58, 0.44).translate(0, 0.29, 0),
    hips: new THREE.BoxGeometry(0.24, 0.12, 0.38).translate(0, 0.0, 0),
    neck: new THREE.BoxGeometry(0.09, 0.07, 0.09).translate(0, 0.035, 0),
    head: new THREE.BoxGeometry(0.22, 0.25, 0.2).translate(0, 0.125, 0),
    hair: new THREE.BoxGeometry(0.24, 0.07, 0.22).translate(-0.01, 0.27, 0),
    hairBack: new THREE.BoxGeometry(0.06, 0.16, 0.22).translate(-0.1, 0.17, 0),
    nose: new THREE.BoxGeometry(0.04, 0.05, 0.04).translate(0.12, 0.11, 0),
    upperArm: hang(0.12, 0.32, 0.12),
    forearm: hang(0.11, 0.3, 0.11).translate(0, -0.32, 0),
    hand: hang(0.1, 0.1, 0.09).translate(0, -0.62, 0),
  };
  return GEO;
}

const HIP_Y = 0.9;
const SHOULDER_Y = 1.42;

function limb(parent, x, y, z, parts) {
  const g = new THREE.Group();
  g.position.set(x, y, z);
  for (const [geo, m] of parts) g.add(new THREE.Mesh(geo, m));
  parent.add(g);
  return g;
}

export function createPersonMesh({ shirt, trousers, skin, hair } = {}) {
  const p = PERSON_PALETTES[0];
  const G = geos();
  const mShirt = mat(shirt ?? p.shirt);
  const mTrousers = mat(trousers ?? p.trousers);
  const mSkin = mat(skin ?? p.skin);
  const mHair = mat(hair ?? p.hair);
  const mShoe = mat(0x1c1a18);

  const root = new THREE.Group();
  const body = new THREE.Group(); // bobs up and down
  root.add(body);

  const legL = limb(body, 0, HIP_Y, -0.1, [[G.thigh, mTrousers], [G.shin, mTrousers], [G.shoe, mShoe]]);
  const legR = limb(body, 0, HIP_Y, 0.1, [[G.thigh, mTrousers], [G.shin, mTrousers], [G.shoe, mShoe]]);
  const torso = limb(body, 0, HIP_Y, 0, [[G.hips, mTrousers], [G.torso, mShirt]]);
  const head = limb(torso, 0, 0.58, 0, [[G.neck, mSkin], [G.head, mSkin], [G.nose, mSkin], [G.hair, mHair], [G.hairBack, mHair]]);
  const armL = limb(body, 0, SHOULDER_Y, -0.29, [[G.upperArm, mShirt], [G.forearm, mSkin], [G.hand, mSkin]]);
  const armR = limb(body, 0, SHOULDER_Y, 0.29, [[G.upperArm, mShirt], [G.forearm, mSkin], [G.hand, mSkin]]);

  root.userData.person = { body, torso, head, legL, legR, armL, armR, amp: 0, gun: null, gunId: '', raise: 0, flash: 0, fade: 0, op: 1, own: null };
  return root;
}

// ---- held weapon, hit flash and fade (combat) -----------------------------
// The weapon is one small box mesh on the right hand whose geometry is
// swapped per weapon id (shared, made once). Hits flash the whole person
// white (never red); a person who is out fades away. Materials are
// cloned per mesh the first time they are needed, because the cached
// ones are shared by everybody.
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
  return GUN_MAT[id] || (GUN_MAT[id] = new THREE.MeshLambertMaterial({ color: GUN_DIMS[id][3] }));
}

function ownMaterials(mesh, P) {
  if (P.own) return P.own;
  const list = [];
  mesh.traverse((o) => {
    if (o.isMesh && o !== P.gun) {
      o.material = o.material.clone();
      list.push(o.material);
    }
  });
  P.own = list;
  return list;
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
  const s = Math.sin(w.stride);
  P.legL.rotation.z = s * a;
  P.legR.rotation.z = -s * a;
  P.armL.rotation.z = -s * a * 0.9;
  P.armR.rotation.z = s * a * 0.9;
  // Arms hang slightly away from the body.
  P.armL.rotation.x = 0.06;
  P.armR.rotation.x = -0.06;
  P.body.position.y = Math.abs(Math.cos(w.stride)) * 0.05 * a;
  P.torso.rotation.z = -0.12 * a * a; // lean into a run
  P.head.rotation.z = 0.08 * a * a;
  if (w.arms) applyArms(mesh, P, w);
  if (w.life === 'down' || w.life === 'out') {
    // limbs flung out while lying down
    P.armL.rotation.x = 0.9;
    P.armR.rotation.x = -0.9;
    P.legL.rotation.x = 0.15;
    P.legR.rotation.x = -0.15;
  } else if (P.legL.rotation.x !== 0) {
    P.legL.rotation.x = P.legR.rotation.x = 0;
  }
  if (w.hitT > 0 || P.flash > 0 || w.fade > 0 || P.op < 1) applyLook(mesh, P, w);
}
