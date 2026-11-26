// Miami Beach familiarity (docs/PLAN_V4.md task 9): about 50 real streets
// and places of Miami Beach checked against the OSM data in the repo by
// scripts/beach-checklist.mjs. Each street pins its name, the streets it
// meets, lanes, one-way status, width in feet, median, sidewalk, curb
// parking and the order of its numbered cross streets.
import test from 'node:test';
import assert from 'node:assert/strict';
import { runChecklist, facts, STREETS, PLACES } from '../scripts/beach-checklist.mjs';
import { roadProfile } from '../src/world/roadprofile.js';

const R = runChecklist();
const by = (n) => R.streets.find((s) => s.spec.name === n);

test('the checklist has about 50 items and every one passes', () => {
  assert.ok(STREETS.length + PLACES.length >= 50, `${STREETS.length + PLACES.length} items`);
  const bad = [...R.streets, ...R.places].filter((r) => r.fails.length).map((r) => `${r.spec.name}: ${r.fails.join('; ')}`);
  assert.deepEqual(bad, []);
});

test('Ocean Drive: curb parking on both sides, 26 to 44 ft, no median, meets 5th and 15th Streets in order', () => {
  const { f, fails } = by('Ocean Drive');
  assert.deepEqual(fails, []);
  assert.ok(f.parkShare > 0.95 && f.medianShare === 0);
  assert.ok(f.ft >= 26 && f.ft <= 44);
});

test('Lincoln Road: pedestrian paving with 3 m walks, and the avenues cross it in order Alton to Collins', () => {
  const { f, fails } = by('Lincoln Road');
  assert.deepEqual(fails, []);
  assert.ok(f.pedShare > 0.1 && f.sidewalk === 3 && f.parkShare === 0);
  assert.ok(by('Española Way').f.pedShare > 0.5);
});

test('Collins and Washington Avenues are not drawn wider than a Beach avenue and carry no median', () => {
  for (const n of ['Collins Avenue', 'Washington Avenue']) {
    const { f } = by(n);
    assert.ok(f.ft <= 60 && f.medianShare <= 0.1, n);
  }
  // Washington is mostly one-way in the data, Collins two-way.
  assert.ok(by('Washington Avenue').f.onewayShare > 0.6);
  assert.ok(by('Collins Avenue').f.onewayShare < 0.5);
});

test('the numbered streets 6th to 20th are mapped, run 22 to 90 ft, and 5th and 41st Streets are long', () => {
  for (let k = 6; k <= 20; k++) {
    const r = by(`${k}th Street`);
    assert.ok(r.f.len > 300, `${k}th Street is mapped`);
    assert.ok(r.f.ft >= 22 && r.f.ft <= 90, `${k}th Street ${r.f.ft} ft`);
  }
  assert.ok(by('5th Street').f.len > 1000 && by('41st Street').f.len > 1000);
});

test('a two-way road tagged 2 + 1 or 3 + 2 lanes keeps equal lanes each way and a center turn lane (Collins, Alton)', () => {
  // (0.13.7: the rule holds everywhere, `turnLane` or not.)
  const plain = roadProfile({ class: 'primary', lanes: 3, lf: 2, lb: 1 });
  assert.deepEqual([plain.lanesF, plain.lanesB, plain.center], [1, 1, 3.3]);
  const w = roadProfile({ class: 'primary', lanes: 3, lf: 2, lb: 1 }, { turnLane: true });
  assert.deepEqual([w.lanesF, w.lanesB, w.center, w.width], [1, 1, 3.3, plain.width]);
  const w5 = roadProfile({ class: 'trunk', lanes: 5, lf: 3, lb: 2 }, { turnLane: true });
  assert.deepEqual([w5.lanesF, w5.lanesB, w5.center, w5.width], [2, 2, 3.6, 18.6]);
  // Not touched: a one-way, a 2 + 2 road. A 4 + 1 approach is 2 + 2 and
  // the turn lane (0.13.7: equal each way).
  assert.equal(roadProfile({ class: 'primary', oneway: 1, lanes: 3 }, { turnLane: true }).lanesF, 3);
  assert.deepEqual((({ lanesF, lanesB, center }) => [lanesF, lanesB, center])(roadProfile({ class: 'primary', lanes: 4, lf: 2, lb: 2 }, { turnLane: true })), [2, 2, 0]);
  assert.deepEqual((({ lanesF, lanesB, center }) => [lanesF, lanesB, center])(roadProfile({ class: 'primary', lanes: 5, lf: 4, lb: 1 }, { turnLane: true })), [2, 2, 3.3]);
});

test('no Beach street keeps unequal lanes each way over a large share of a two-way street', () => {
  for (const name of ['Collins Avenue', 'Alton Road', '17th Street', '41st Street', 'Dade Boulevard']) {
    assert.ok(facts(R.city, name).lopsided <= 0.15, name);
  }
});
