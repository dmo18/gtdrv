import test from 'node:test';
import assert from 'node:assert/strict';
import { BOAT_SPECS, createBoat } from '../src/entities/boat.js';
import { boatStats } from '../src/render/boatmesh.js';
import { createRng } from '../src/core/rng.js';

test('the easter-egg submarine is a registered boat with a sane body', () => {
  const s = BOAT_SPECS.submarine;
  assert.ok(s, 'spec exists');
  assert.equal(s.hull, 'submarine');
  assert.ok(s.length > s.width * 3, 'long hull');
  assert.ok(s.draft > 0 && s.draft < s.height, 'draft below deck');
  const b = createBoat('submarine', 10, 20, 0, createRng(1));
  assert.equal(b.spec.id, 'submarine');
  assert.ok(Number.isFinite(b.x) && Number.isFinite(b.z));
});

test('the submarine mesh stays inside the boat triangle budget', () => {
  const st = boatStats(BOAT_SPECS.submarine, BOAT_SPECS.submarine.colors[0]);
  assert.ok(st.tris > 500, 'has real geometry');
  assert.ok(st.tris < 12000, `near triangles ${st.tris}`);
  assert.ok(st.farTris < st.tris, 'far model is coarser');
});
