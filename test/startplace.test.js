import test from 'node:test';
import assert from 'node:assert/strict';
import { createSession } from '../src/systems/session.js';
import { placeValid, startSpot } from '../src/core/startplace.js';
import { loadProgress, saveProgress, SAVE_KEY } from '../src/core/save.js';
import { buildSession } from '../src/core/garage.js';
import { createRng } from '../src/core/rng.js';

const memory = (text) => {
  const m = new Map();
  if (text !== undefined) m.set(SAVE_KEY, text);
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)) };
};

function fakeGame(progress, over = {}) {
  const handlers = {};
  const g = {
    city: {
      map: 'miami', nodes: [], edges: [], spawn: { x: 0, z: 0, heading: 0 },
      cut: { x0: -5000, z0: -5000, x1: 5000, z1: 5000 }, isGround: (x) => x < 3000, isLand: (x) => x < 3000, ...over.city,
    },
    collision: { resolveCircle: () => ({ hit: false }) },
    progress,
    vehicles: [],
    rng: createRng(7),
    events: { on: (k, f) => (handlers[k] = f), emit: () => {} },
    player: { mode: 'car', x: 0, z: 0, heading: 0, vehicle: null, walker: { x: 0, z: 0 } },
    setPlayerMode(m) { this.player.mode = m; },
    findRescueSpot(x, z, out) { out.x = x; out.z = z; return out; },
    addVehicle(v) { this.vehicles.push(v); },
    removeVehicle(v) { v.removed = true; this.vehicles = this.vehicles.filter((o) => o !== v); },
    enterVehicle(v) { v.driver = 'player'; this.player.vehicle = v; this.player.mode = v.kind; },
  };
  return g;
}

const footSession = (x, z) => buildSession({ mode: 'foot', x, z, heading: 0.5 }, null, [], 'miami');

test('empty save: nothing to continue, no throw', () => {
  const store = memory();
  const g = fakeGame(loadProgress(store));
  const s = createSession(g, store);
  assert.equal(s.canContinue(), false);
  assert.equal(s.continueSaved(), false);
});

test('valid save: canContinue is true and continueSaved puts the player back', () => {
  const store = memory();
  const p = loadProgress(store);
  p.session = footSession(1200, -300);
  saveProgress(store, p);
  const g = fakeGame(loadProgress(store));
  const s = createSession(g, store);
  assert.equal(s.canContinue(), true);
  assert.equal(s.continueSaved(), true);
  assert.equal(g.player.mode, 'foot');
  assert.equal(g.player.x, 1200);
  assert.equal(g.player.z, -300);
});

test('a saved place outside the cut, on bad ground or on another map is not continuable', () => {
  const g = fakeGame(loadProgress(memory()));
  const city = g.city;
  assert.equal(placeValid(footSession(1200, -300), 'miami', city), true);
  assert.equal(placeValid(footSession(5600, 0), 'miami', city), false, 'outside cut');
  assert.equal(placeValid(footSession(3500, 0), 'miami', city), false, 'water for a walker');
  assert.equal(placeValid(footSession(100, 0), 'island', city), false, 'other map');
  assert.equal(placeValid({ ...footSession(100, 0), mode: 'start' }, 'miami', city), false);
  assert.equal(placeValid({ ...footSession(3500, 0), mode: 'boat', craft: null }, 'miami', city), true, 'water for a boat');
  assert.equal(placeValid({ ...footSession(100, 0), mode: 'plane' }, 'miami', city), true, 'aircraft go anywhere');
});

test('corrupt saves: false, never a throw', () => {
  for (const text of ['{not json', '[]', 'null', '{"version":3,"session":"x"}', '{"version":3,"session":{"mode":"car","x":"a","z":1}}']) {
    const store = memory(text);
    const g = fakeGame(loadProgress(store));
    const s = createSession(g, store);
    assert.equal(s.canContinue(), false, text);
    assert.equal(s.continueSaved(), false, text);
  }
  // A session object damaged after loading is refused the same way.
  for (const bad of [5, 'x', [], { mode: 'foot', x: NaN, z: 0 }, { mode: 'foot', x: 1, z: 1, map: 'miami', garage: 7 }, { mode: 'car', map: 'miami', x: 1, z: 1, craft: 3 }]) {
    const p = loadProgress(memory());
    const g = fakeGame(p);
    const s = createSession(g, memory());
    p.session = bad;
    assert.doesNotThrow(() => s.canContinue());
    assert.doesNotThrow(() => s.continueSaved());
    assert.equal(s.continueSaved(), false, JSON.stringify(bad));
  }
});

test('hold keeps the saved place while the title shows', () => {
  const store = memory();
  const p = loadProgress(store);
  p.session = footSession(1200, -300);
  saveProgress(store, p);
  const g = fakeGame(loadProgress(store));
  const s = createSession(g, store);
  s.hold(true);
  assert.equal(g.saveSession(), false);
  assert.equal(loadProgress(store).session.x, 1200);
  assert.equal(s.continueSaved(), true);
  assert.equal(g.saveSession(), true);
});

test('startFresh: the starter car at the designed start, the old car left behind', () => {
  const store = memory();
  const g = fakeGame(loadProgress(store), { city: { startView: { spawn: { x: -1100, z: 780, heading: 0 } } } });
  const s = createSession(g, store);
  assert.deepEqual(startSpot(g.city, {}), { x: -1100, z: 780, heading: 0 });
  assert.equal(s.startFresh(), true);
  const v = g.player.vehicle;
  assert.equal(v.spec.id, 'sedan');
  assert.equal(v.x, -1100);
  assert.equal(v.z, 780);
  // Again: the unused starter car is removed, not left behind.
  assert.equal(s.startFresh(), true);
  assert.equal(g.vehicles.length, 1);
  assert.equal(s.garage.length, 0);
});

test('startFresh without a designed view uses the map spawn (island)', () => {
  const g = fakeGame(loadProgress(memory()), { city: { startView: null, spawn: { x: 12, z: 34, heading: 1 } } });
  const s = createSession(g, memory());
  s.startFresh();
  assert.equal(g.player.vehicle.x, 12);
  assert.equal(g.player.vehicle.z, 34);
});
