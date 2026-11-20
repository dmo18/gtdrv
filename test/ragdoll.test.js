// Ragdoll tumbling (core/ragdoll.js) and its hook in combat: people hit
// hard by a blast or a car tumble, settle flat on the ground, the same
// seed gives the same tumble, and at most RAGDOLL_MAX tumble at once.
// docs/COMBAT.md "Ragdolls".
import { RULES } from '../src/core/weapons.js';
RULES.invulnerable = false;
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createRagdolls, startRagdoll, kickRagdoll, stepRagdolls, ragOrigin, ragReach, flatPitch,
  RAGDOLL_MAX, RAG_T, RAG_MAX_T, RAG_THICK, RAG_CENTRE, LIMB_REST, LIMB_COUNT,
} from '../src/core/ragdoll.js';
import { createRng } from '../src/core/rng.js';
import { poseRagdoll } from '../src/render/ragdoll.js';
import { initActor, addActor, damage, setPush, RAM_THROW_UP, RAM_THROW_PER } from '../src/systems/combat.js';
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

test('mesh origin keeps the body centre fixed while it rotates', () => {
  const o = { x: 0, y: 0, z: 0 };
  ragOrigin(5, RAG_CENTRE, 7, 0.3, 0, 0, o);
  assert.deepEqual([o.x, o.y, o.z].map((v) => +v.toFixed(9)), [5, 0, 7]);
  // On its back facing +x: the feet are RAG_CENTRE in front of the centre.
  ragOrigin(0, RAG_THICK, 0, 0, Math.PI / 2, 0, o);
  assert.ok(Math.abs(o.x - RAG_CENTRE) < 1e-9 && Math.abs(o.y - RAG_THICK) < 1e-9);
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

test('combat: a car at speed throws a person up over the bonnet in an arc', () => {
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

test('combat: bullets keep the plain fall; the player never ragdolls', () => {
  const g = arena();
  const ped = initActor({ x: 5, z: 5, y: 0, heading: 0, radius: 0.35, px: 5, pz: 5, vx: 0, vz: 0 }, 'civ');
  addActor(g, ped);
  damage(g, ped, 50, null, 'bullet');
  assert.equal(ped.life, 'down');
  assert.equal(ped.rag, null);
  const w = g.player.walker;
  g.combat.explode(w.x + 1, 0.5, w.z, 6);
  assert.ok(!w.rag);
  assert.equal(g.ragdolls.max, RAGDOLL_MAX);
});
