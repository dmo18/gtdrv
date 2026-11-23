// Ragdoll tumbling (core/ragdoll.js) and its hook in combat: people hit
// hard by a blast or a car tumble, settle flat on the ground, the same
// seed gives the same tumble, and at most RAGDOLL_MAX tumble at once.
// docs/COMBAT.md "Ragdolls".
import { RULES } from '../src/core/weapons.js';
RULES.invulnerable = false;
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createRagdolls, startRagdoll, kickRagdoll, stepRagdolls, ragOrigin, ragReach, flatPitch, headDir,
  RAGDOLL_MAX, RAG_T, RAG_MAX_T, RAG_THICK, RAG_CENTER, LIMB_REST, LIMB_COUNT,
} from '../src/core/ragdoll.js';
import { createRng } from '../src/core/rng.js';
import { poseRagdoll } from '../src/render/ragdoll.js';
import { initActor, addActor, removeActor, damage, setPush, setFall, FALL_BULLET, FALL_SHOTGUN, RAM_THROW_UP, RAM_THROW_PER } from '../src/systems/combat.js';
import { createArms } from '../src/core/weapons.js';
import { createVehicle } from '../src/entities/vehicle.js';
import { makeFightGame, step, yard } from './fightgame.js';

const DT = 1 / 60;
const person = (x = 0, z = 0, heading = 0) => ({ x, z, y: 0, heading, px: x, pz: z });

function run(pool, n) {
  for (let i = 0; i < n; i++) stepRagdolls(pool, DT);
}

test('a tumbling body flies, lands, settles flat on the ground and frees its slot', () => {
  const pool = createRagdolls();
  const a = person();
  const s = startRagdoll(pool, a, 6, 5, 0, createRng(3));
  assert.ok(s && s.on && a.rag === s);
  assert.equal(pool.active, 1);
  let peak = 0, steps = 0;
  while (a.rag && steps < RAG_MAX_T * 60 + 5) {
    stepRagdolls(pool, DT);
    peak = Math.max(peak, a.y);
    steps++;
    // Never through the floor.
    if (a.rag) assert.ok(a.rag.y >= ragReach(a.rag.pitch, a.rag.roll) - 1e-9);
  }
  assert.equal(a.rag, null, 'settled');
  assert.equal(pool.active, 0);
  assert.ok(a.ragDone);
  assert.ok(peak > 0.5, `peak ${peak}`);
  assert.equal(a.y, 0);
  assert.equal(Math.abs(a.ragPitch), Math.PI / 2, 'lying flat');
  assert.ok(a.x > 2, `thrown forward ${a.x}`);
  assert.ok(steps <= RAG_MAX_T * 60);
});

test('a push alone topples a standing body within about RAG_T and it settles at rest height', () => {
  const pool = createRagdolls();
  const a = person(0, 0, 0);
  startRagdoll(pool, a, -3, 0, 0, createRng(9)); // pushed backwards
  const s = a.rag;
  run(pool, 5);
  assert.ok(s.pitch > 0, 'tips onto its back');
  let n = 5;
  while (a.rag) {
    stepRagdolls(pool, DT);
    n++;
  }
  assert.ok(n / 60 >= RAG_T && n / 60 <= RAG_T * 2 + 0.5, `settled after ${n / 60} s`);
  assert.equal(a.ragPitch, Math.PI / 2);
  // The baked pose is drawn lying on the ground.
  const mesh = fakeMesh();
  a.life = 'out';
  mesh.position.x = a.x;
  mesh.position.z = a.z;
  assert.ok(poseRagdoll(mesh, a));
  assert.ok(Math.abs(mesh.rotation.z - Math.PI / 2) < 1e-9);
  assert.ok(Math.abs(mesh.position.y - RAG_THICK) < 1e-9, 'lying on the ground (as the plain fall pose)');
  assert.equal(mesh.userData.person.armL.rotation.x, LIMB_REST[0]);
});

test('the same seed tumbles the same way; another seed differs', () => {
  const sig = (seed) => {
    const pool = createRagdolls();
    const rng = createRng(seed);
    const bodies = [];
    for (let i = 0; i < 5; i++) {
      const a = person(i * 3, 0, i);
      startRagdoll(pool, a, 4 - i, 3, i * 0.5, rng);
      kickRagdoll(a.rag, 2, 6);
      bodies.push(a);
    }
    const trace = [];
    for (let k = 0; k < 90; k++) {
      stepRagdolls(pool, DT);
      if (k % 15 === 0) for (const a of bodies) if (a.rag) trace.push(a.rag.pitch.toFixed(6), a.rag.roll.toFixed(6), a.rag.ang[2].toFixed(6));
    }
    run(pool, 300);
    for (const a of bodies) trace.push(a.x.toFixed(6), a.z.toFixed(6), a.ragYaw.toFixed(6), a.ragPitch);
    return trace.join(',');
  };
  assert.equal(sig(11), sig(11));
  assert.notEqual(sig(11), sig(12));
});

test('at most RAGDOLL_MAX tumble at once; the rest are refused and keep the plain fall', () => {
  assert.equal(RAGDOLL_MAX, 12);
  const pool = createRagdolls();
  const bodies = [];
  for (let i = 0; i < 20; i++) bodies.push(person(i * 2, 0));
  let got = 0;
  for (const a of bodies) if (startRagdoll(pool, a, 2, 4, 0, createRng(1))) got++;
  assert.equal(got, RAGDOLL_MAX);
  assert.equal(pool.active, RAGDOLL_MAX);
  assert.equal(pool.refused, 8);
  assert.ok(!bodies[15].rag);
  // A slot frees up when its body settles, and can be used again.
  run(pool, RAG_MAX_T * 60 + 2);
  assert.equal(pool.active, 0);
  assert.ok(startRagdoll(pool, bodies[15], 1, 1, 0, null));
});

test('a reset actor gives its slot back at once', () => {
  const pool = createRagdolls(2);
  const a = person();
  startRagdoll(pool, a, 1, 1, 0, null);
  a.rag = null; // what combat resetActor does
  stepRagdolls(pool, DT);
  assert.equal(pool.active, 0);
});

test('mesh origin keeps the body center fixed while it rotates', () => {
  const o = { x: 0, y: 0, z: 0 };
  ragOrigin(5, RAG_CENTER, 7, 0.3, 0, 0, o);
  assert.deepEqual([o.x, o.y, o.z].map((v) => +v.toFixed(9)), [5, 0, 7]);
  // On its back facing +x: the feet are RAG_CENTER in front of the center.
  ragOrigin(0, RAG_THICK, 0, 0, Math.PI / 2, 0, o);
  assert.ok(Math.abs(o.x - RAG_CENTER) < 1e-9 && Math.abs(o.y - RAG_THICK) < 1e-9);
  assert.equal(flatPitch(0.2), Math.PI / 2);
  assert.equal(flatPitch(-0.2), -Math.PI / 2);
  assert.equal(LIMB_REST.length, LIMB_COUNT);
});

function fakeMesh() {
  const bone = () => ({ rotation: { x: 0, y: 0, z: 0 }, position: { x: 0, y: 0, z: 0 } });
  const P = {};
  for (const k of ['body', 'torso', 'head', 'legL', 'legR', 'armL', 'armR', 'kneeL', 'kneeR', 'elbowL', 'elbowR']) P[k] = bone();
  const v3 = () => ({ x: 0, y: 0, z: 0, set(x, y, z) { this.x = x; this.y = y; this.z = z; } });
  return { position: v3(), rotation: Object.assign(v3(), { order: 'XYZ' }), visible: true, userData: { person: P } };
}

function arena() {
  const { city, collision } = yard();
  city.furniture = [];
  return makeFightGame({ city, collision, seed: 9, px: -60, pz: 0 });
}

test('combat: a car at speed throws a person up over the hood in an arc', () => {
  const g = arena();
  const ped = initActor({ x: 0, z: 0, y: 0, heading: Math.PI, radius: 0.35, px: 0, pz: 0, vx: 0, vz: 0 }, 'civ');
  addActor(g, ped);
  const car = { kind: 'car', spec: { health: 1000, height: 1.45 }, health: 1000, vx: 15, vz: 0, x: -2, z: 0 };
  setPush(7.5, 0);
  damage(g, ped, 60, car, 'ram');
  assert.equal(ped.life, 'down');
  const s = ped.rag;
  assert.ok(s, 'ragdolled');
  assert.ok(Math.abs(s.vy - (RAM_THROW_UP + RAM_THROW_PER * 15)) < 1e-9, 'thrown up by the car speed');
  assert.ok(s.vx > 5 && s.vx < 15, 'carried forward, slower than the car');
  let peak = 0, x0 = ped.x;
  for (let i = 0; i < 60 && ped.rag; i++) {
    step(g, [], 1);
    peak = Math.max(peak, ped.y);
  }
  assert.ok(peak > 1.2, `arc peak ${peak}`);
  assert.ok(ped.x - x0 > 4);
  step(g, [], 200);
  assert.ok(!ped.rag && ped.ragDone && ped.y === 0, 'settled on the ground');
});

// W6 slice 4: bullets used to keep the plain fall pose; now every killing
// hit throws the body along its fall direction (REVAMP 6.7).
test('combat: a bullet kill falls away from the shot; the player never ragdolls', () => {
  const g = arena();
  const ped = initActor({ x: 5, z: 5, y: 0, heading: 0, radius: 0.35, px: 5, pz: 5, vx: 0, vz: 0 }, 'civ');
  addActor(g, ped);
  damage(g, ped, 50, null, 'bullet');
  assert.equal(ped.life, 'down');
  assert.ok(ped.rag && ped.rag.dir, 'a directed ragdoll');
  const w = g.player.walker;
  g.combat.explode(w.x + 1, 0.5, w.z, 6);
  assert.ok(!w.rag);
  assert.equal(g.ragdolls.max, RAGDOLL_MAX);
});

// The fall direction rule, 16 directions for each cause: the body travels
// along d and ends lying along it (feet to head within 25 degrees of d);
// hit from the front it lies on its back, from behind on its face.
const HD = { x: 0, y: 0, z: 0 };
function fallCase(cause, k, heading = 0.3) {
  const g = arena();
  const an = (k / 16) * Math.PI * 2;
  const dx = Math.cos(an), dz = Math.sin(an);
  const ped = initActor({ x: 0, z: 0, y: 0, heading, radius: 0.35, px: 0, pz: 0, vx: 0, vz: 0 }, 'civ');
  addActor(g, ped);
  if (cause === 'bullet' || cause === 'shotgun') {
    const r = cause === 'bullet' ? 6 : 2; // point blank for the wide shotgun spread
    const sh = initActor({ x: -dx * r, z: -dz * r, y: 0, heading: an, radius: 0.35, px: -dx * r, pz: -dz * r, vx: 0, vz: 0 }, 'crew');
    addActor(g, sh);
    sh.arms = createArms(cause === 'bullet' ? 'pistol' : 'scatter');
    g.combat.fire(sh, dx, (1.0 - 1.4) / r, dz);
    removeActor(g, sh);
  } else if (cause === 'blast') {
    g.combat.explode(-dx * 3, 0.6, -dz * 3, 8);
  } else {
    const car = g.addVehicle(createVehicle('sedan', -dx * 3, -dz * 3, an));
    car.vx = dx * 12;
    car.vz = dz * 12;
    ped.bumpBy = car;
    ped.bumpV = 12;
  }
  step(g, [], 1);
  assert.equal(ped.hp, 0, `${cause} ${k}: killed`);
  for (let i = 0; i < 60 * 4 && !ped.ragDone; i++) step(g, [], 1);
  assert.ok(ped.ragDone, `${cause} ${k}: settled`);
  const travel = ped.x * dx + ped.z * dz;
  headDir(ped.ragYaw, ped.ragPitch, ped.ragRoll, HD);
  const hl = Math.hypot(HD.x, HD.z);
  const cos = (HD.x * dx + HD.z * dz) / hl;
  return { travel, deg: Math.acos(Math.min(1, cos)) * 180 / Math.PI, flat: Math.abs(HD.y) < 0.05, pitch: ped.ragPitch, roll: ped.ragRoll, an };
}
for (const cause of ['bullet', 'shotgun', 'blast', 'vehicle']) {
  test(`fall direction: ${cause}, 16 directions: travels along d and lies along it`, () => {
    for (let k = 0; k < 16; k++) {
      const r = fallCase(cause, k);
      assert.ok(r.travel > 0, `${cause} ${k}: moved ${r.travel.toFixed(2)} m along d`);
      assert.ok(r.deg <= 25, `${cause} ${k}: lying ${r.deg.toFixed(1)} deg off d`);
      assert.ok(r.flat, `${cause} ${k}: flat on the ground`);
    }
  });
}
test('fall direction: shot from the front lands on the back, from behind on the face, from the side on that side', () => {
  // The victim faces +x (heading 0); d is the way the shot travels.
  const front = fallCase('bullet', 8, 0); // d = -x: hit in the chest
  const behind = fallCase('bullet', 0, 0); // d = +x: hit in the back
  const side = fallCase('bullet', 4, 0); // d = +z
  assert.ok(front.pitch > 1.5, `on the back (pitch ${front.pitch})`);
  assert.ok(behind.pitch < -1.5, `on the face (pitch ${behind.pitch})`);
  assert.ok(Math.abs(side.pitch) < 0.01 && Math.abs(Math.abs(side.roll) - Math.PI / 2) < 0.01, `on the side (roll ${side.roll})`);
});
test('fall speed along d: bullet 1.5, shotgun 4, blast 6 + 10 (1 - d/r) with 3 to 6 up, car 0.6 x speed', () => {
  const g = arena();
  const mk = (x, z) => {
    const a = initActor({ x, z, y: 0, heading: 0, radius: 0.35, px: x, pz: z, vx: 0, vz: 0 }, 'civ');
    addActor(g, a);
    return a;
  };
  const a = mk(0, 0);
  setFall(1, 0, FALL_BULLET);
  damage(g, a, 50, null, 'bullet');
  assert.ok(Math.abs(a.rag.vx - 1.5) < 1e-9 && Math.abs(a.rag.vz) < 1e-9);
  const b = mk(0, 20);
  setFall(0, 1, FALL_SHOTGUN);
  damage(g, b, 50, null, 'bullet');
  assert.ok(Math.abs(b.rag.vz - 4) < 1e-9);
  const c = mk(40, 0);
  g.combat.explode(36, 0.9, 0, 8);
  assert.ok(Math.abs(c.rag.vx - (6 + 10 * 0.5)) < 1e-6, `blast ${c.rag.vx}`);
  assert.ok(c.rag.vy >= 3 && c.rag.vy <= 6, `up ${c.rag.vy}`);
});

