import test from 'node:test';
import assert from 'node:assert/strict';
import {
  JACK, canJack, isOccupied, occupantTeam, jackHeat, createJack, stepJack, dragPose,
  createVictimState, stepVictim, FLEE,
} from '../src/core/carjack.js';
import { createVehicle } from '../src/entities/vehicle.js';

const car = (o = {}) => Object.assign(createVehicle('sedan', 0, 0, 0), { driver: { ai: true } }, o);

test('occupied cars can be jacked only when slow, upright and alive', () => {
  assert.equal(isOccupied(car()), true);
  assert.equal(isOccupied(car({ driver: null })), false);
  assert.equal(isOccupied(car({ driver: 'player' })), false);
  assert.equal(canJack(car()), true);
  assert.equal(canJack(car({ speed: 2.9 })), true);
  assert.equal(canJack(car({ speed: -2.9 })), true);
  assert.equal(canJack(car({ speed: 3.1 })), false, 'a fast car cannot be entered on foot');
  assert.equal(canJack(car({ speed: NaN })), false);
  assert.equal(canJack(car({ wrecked: true })), false);
  assert.equal(canJack(car({ removed: true })), false);
  assert.equal(canJack(car({ y: 5 })), false, 'airborne');
  assert.equal(canJack(car({ driver: null })), false, 'empty cars use the plain entry');
  assert.equal(canJack(car({ kind: 'tank' })), false);
  assert.equal(canJack(car({ kind: 'heli' })), true);
});

test('occupant team and heat', () => {
  assert.equal(occupantTeam(car()), 'civ');
  assert.equal(occupantTeam(car({ police: true })), 'police');
  assert.equal(occupantTeam(car({ crewGroup: {} })), 'crew');
  assert.equal(occupantTeam(car({ occupantTeam: 'crew' })), 'crew');
  assert.equal(jackHeat('civ', false, false), 0);
  assert.ok(jackHeat('civ', false, true) > 0 && jackHeat('civ', false, true) < 0.5);
  assert.ok(jackHeat('civ', true, true) <= 0.6, 'small for a civilian');
  assert.ok(jackHeat('police', false, false) >= 1, 'a police car is a big crime');
  assert.equal(jackHeat('crew', false, false), 0);
});

// Runs a jack to its end, returning the events in order with their times.
function run(j, dist = 0, dt = 1 / 60, ok = () => true) {
  const log = [];
  let t = 0;
  for (let i = 0; i < 600 && j.phase !== 'done' && j.phase !== 'aborted'; i++) {
    t += dt;
    const ev = stepJack(j, dt, dist, ok(t));
    if (ev) log.push([ev, +t.toFixed(3)]);
  }
  return log;
}

test('jack timeline: open, drag, throw, then the player enters after 0.5 to 0.8 s', () => {
  const j = createJack(car(), 1, 1, 0, 0, 2, 2);
  const log = run(j, 0);
  assert.deepEqual(log.map((e) => e[0]), ['open', 'throw', 'enter']);
  const open = log[0][1], thr = log[1][1], enter = log[2][1];
  assert.ok(thr - open >= 0.45 && thr - open <= 0.55);
  assert.ok(enter - open >= 0.5 && enter - open <= 0.8, `enter ${enter - open}`);
  assert.equal(j.phase, 'done');
  assert.equal(j.open, 1);
  assert.equal(j.drag, 1);
});

test('the player first runs to the door, and gives up waiting after 3 s', () => {
  const j = createJack(car(), 1, 1, 0, 0, 2, 2);
  let far = 5;
  const events = [];
  for (let i = 0; i < 60 && j.phase === 'approach'; i++) {
    far = Math.max(0, far - 0.1);
    const e = stepJack(j, 1 / 60, far, true);
    if (e) events.push(e);
  }
  assert.ok(j.phase === 'approach' || j.phase === 'open');
  // Never arrives: opens anyway once the time limit is up.
  const k = createJack(car(), 1, 1, 0, 0, 2, 2);
  const log = run(k, 9);
  assert.equal(log[0][0], 'open');
  assert.ok(log[0][1] >= JACK.APPROACH_MAX - 0.05 && log[0][1] <= JACK.APPROACH_MAX + 0.05);
});

test('aborts: car speeds away, car removed, player knocked down', () => {
  let j = createJack(car(), 1, 1, 0, 0, 2, 2);
  j.car.speed = JACK.ABORT_SPEED + 1;
  assert.equal(stepJack(j, 1 / 60, 3, true), 'abort');
  assert.equal(j.phase, 'aborted');
  assert.equal(stepJack(j, 1 / 60, 3, true), null, 'finished jacks stay finished');
  j = createJack(car(), 1, 1, 0, 0, 2, 2);
  assert.equal(stepJack(j, 1 / 60, 3, false), 'abort');
  j = createJack(car(), 1, 1, 0, 0, 2, 2);
  j.car.removed = true;
  assert.equal(stepJack(j, 1 / 60, 0, true), 'abort');
  j = createJack(car(), 1, 1, 0, 0, 2, 2);
  j.car.wrecked = true;
  assert.equal(stepJack(j, 1 / 60, 0, true), 'abort');
  // The driver left on their own (somebody else took the car).
  j = createJack(car(), 1, 1, 0, 0, 2, 2);
  j.car.driver = null;
  assert.equal(stepJack(j, 1 / 60, 0, true), 'abort');
});

test('player knocked down after the throw does not enter', () => {
  const j = createJack(car(), 1, 1, 0, 0, 2, 2);
  const log = run(j, 0, 1 / 60, (t) => t < 0.6);
  assert.equal(log[log.length - 1][0], 'abort');
  assert.ok(log.some((e) => e[0] === 'throw'));
});

test('drag pose moves from the seat toward the door with a small hop', () => {
  const j = createJack(car(), 4, 0, 0, 0, 5, 1);
  const out = { x: 0, z: 0, y: 0 };
  j.drag = 0;
  dragPose(j, out);
  assert.deepEqual([out.x, out.z, out.y], [0, 0, 0]);
  j.drag = 0.5;
  dragPose(j, out);
  assert.ok(out.x > 0 && out.x < 4 && out.y > 0);
  j.drag = 1;
  dragPose(j, out);
  assert.ok(Number.isFinite(out.x) && Math.abs(out.y) < 1e-9);
});

// A minimal actor: what combat expects of a person.
const actor = (o = {}) => ({ x: 0, z: 0, radius: 0.35, hp: 30, life: 'ok', fade: 0, speed: 0, heading: 0, stride: 0, ...o });
const THREAT = { x: -3, z: 0 };

test('victim: lies down while combat has them, then flees, then fades and is gone', () => {
  const a = actor({ life: 'down' });
  const cj = createVictimState('civ');
  cj.phase = 'down';
  assert.equal(stepVictim(cj, a, 1 / 60, THREAT, null), 'down');
  a.life = 'getup';
  assert.equal(stepVictim(cj, a, 1 / 60, THREAT, null), 'down');
  a.life = 'ok';
  assert.equal(stepVictim(cj, a, 1 / 60, THREAT, null), 'flee');
  const x0 = a.x;
  for (let i = 0; i < 60; i++) stepVictim(cj, a, 1 / 60, THREAT, null);
  assert.ok(a.x - x0 > FLEE.SPEED * 0.9, 'runs away from the thief');
  assert.ok(a.moving && a.speed > 4);
  let phase = 'flee';
  for (let i = 0; i < 60 * 20 && phase !== 'gone'; i++) phase = stepVictim(cj, a, 1 / 60, { x: -3, z: 0 }, null);
  assert.equal(phase, 'gone');
  assert.equal(a.fade, 1);
  assert.ok(Number.isFinite(a.x) && Number.isFinite(a.z));
});

test('victim: a wall turns them, a hit while fleeing is left to combat, death is cleaned up', () => {
  const a = actor();
  const cj = createVictimState('police');
  cj.phase = 'flee';
  cj.fdx = 1;
  cj.fdz = 0;
  const wall = (nx, nz) => ({ x: Math.min(nx, 1), z: nz }); // wall at x = 1
  for (let i = 0; i < 30; i++) stepVictim(cj, a, 1 / 60, THREAT, wall);
  assert.ok(Math.abs(cj.fdz) > 0.5, 'turned along the wall');
  assert.ok(a.x <= 1 + 1e-9);
  a.life = 'down';
  const z0 = a.z;
  stepVictim(cj, a, 1 / 60, THREAT, wall);
  assert.equal(a.z, z0);
  a.life = 'out';
  a.hp = 0;
  assert.equal(stepVictim(cj, a, 1 / 60, THREAT, wall), 'dead');
  a.fade = 1;
  assert.equal(stepVictim(cj, a, 1 / 60, THREAT, wall), 'gone');
});

test('victim: non-finite collision answers never produce NaN', () => {
  const a = actor();
  const cj = createVictimState('civ');
  cj.phase = 'flee';
  for (let i = 0; i < 20; i++) stepVictim(cj, a, 1 / 60, THREAT, () => ({ x: NaN, z: NaN }));
  assert.ok(Number.isFinite(a.x) && Number.isFinite(a.z));
});
