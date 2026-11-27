// A browser with no storage gets its own travel message, with no reload (0.14.1).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createSession } from '../src/systems/session.js';
import { defaultProgress } from '../src/core/save.js';
import { createRng } from '../src/core/rng.js';
import { TRAVEL_NO_STORAGE, TRAVEL_SAVE_FAILED } from '../src/core/travel.js';

function fakeGame() {
  return {
    city: {
      map: 'miami', mapId: 'miami-downtown', nodes: [], edges: [], spawn: { x: 0, z: 0, heading: 0 },
      region: { crop: { x0: -2700, z0: -2700, x1: 2450, z1: 1900 } }, travelPads: [],
      cut: { x0: -5000, z0: -5000, x1: 5000, z1: 5000 }, isGround: () => true, isLand: () => true,
    },
    collision: { resolveCircle: () => ({ hit: false }) },
    progress: defaultProgress(),
    vehicles: [],
    rng: createRng(7),
    events: { on: () => {}, emit: () => {} },
    player: { mode: 'car', x: 0, z: 0, heading: 0, vehicle: null, walker: { x: 0, z: 0 }, wanted: 0 },
    setPlayerMode(m) { this.player.mode = m; },
    findRescueSpot(x, z, out) { out.x = x; out.z = z; return out; },
    addVehicle() {}, removeVehicle() {}, enterVehicle() {},
  };
}

test('travel without storage says saving is blocked and does not reload', () => {
  const g = fakeGame();
  const calls = [];
  g.reload = () => calls.push('reload');
  const s = createSession(g, null);
  assert.equal(s.travelTo('miami-beach'), TRAVEL_NO_STORAGE);
  assert.equal(TRAVEL_NO_STORAGE, 'Saving is blocked in this browser. Turn on site data to travel.');
  assert.notEqual(TRAVEL_NO_STORAGE, TRAVEL_SAVE_FAILED);
  assert.deepEqual(calls, []);
  // police still come first
  g.player.wanted = 2;
  assert.equal(s.travelTo('miami-beach'), 'Lose the police first');
});

test('storage that refuses writes still gets the try-again message', () => {
  const g = fakeGame();
  const calls = [];
  g.reload = () => calls.push('reload');
  const bad = { getItem: () => null, setItem: () => { throw new Error('quota'); }, removeItem: () => {} };
  const s = createSession(g, bad);
  assert.equal(s.travelTo('miami-beach'), TRAVEL_SAVE_FAILED);
  assert.deepEqual(calls, []);
});
