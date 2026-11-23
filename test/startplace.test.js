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

test('placeValid on a region: inside its crop only; the whole box has no crop rule', () => {
  const region = { crop: { x0: 1400, z0: -3891, x1: 4505, z1: 3891 } };
  const city = { region, cut: { x0: 500, z0: -4100, x1: 4700, z1: 4100 }, isGround: () => true, isLand: () => false };
  const s = (over) => ({ map: 'miami-beach', mode: 'car', x: 3000, z: 0, ...over });
  assert.equal(placeValid(s(), 'miami-beach', city), true);
  assert.equal(placeValid(s({ x: 1300 }), 'miami-beach', city), false);
  assert.equal(placeValid(s({ map: 'miami' }), 'miami-beach', city), false);
  assert.equal(placeValid(s({ mode: 'plane', x: 1000 }), 'miami-beach', city), true, 'aircraft may be out past the crop');
  assert.equal(placeValid(s({ mode: 'plane', x: 600 }), 'miami-beach', city), false);
  assert.equal(placeValid(s({ map: 'miami', x: 1300 }), 'miami', { ...city, region: null }), true);
});

test('a region game: the session belongs to the region id, travelTo saves target session and map choice, refused while wanted', () => {
  const store = memory();
  const calls = [];
  const g = fakeGame(loadProgress(store), { city: { map: 'miami', mapId: 'miami-downtown', region: { crop: { x0: -2700, z0: -2700, x1: 2450, z1: 1900 } }, travelPads: [] } });
  g.reload = () => calls.push('reload');
  g.hud = { toast: (t) => calls.push(t) };
  const s = createSession(g, store);
  assert.equal(s.mapId, 'miami-downtown');
  g.player.wanted = 2;
  assert.equal(s.travelTo('miami-beach'), 'Lose the police first');
  assert.equal(store.getItem('rustwater.map'), null);
  g.player.wanted = 0;
  assert.equal(s.travelTo('miami-downtown'), '', 'the region being played is not a trip');
  assert.equal(s.travelTo('island'), '', 'the island is picked, not traveled to');
  assert.equal(s.travelTo('miami-beach'), '');
  assert.equal(store.getItem('rustwater.map'), 'miami-beach');
  const saved = loadProgress(store);
  assert.equal(saved.session.map, 'miami-beach');
  // the leaving page may not overwrite what travel wrote
  assert.equal(g.saveSession(), false);
  assert.equal(loadProgress(store).session.map, 'miami-beach');
});
