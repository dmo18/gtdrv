// Corrupt, truncated, future-version and oversized values under the three
// storage keys must load as defaults (or sanitized) and never throw.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadProgress, saveProgress, defaultProgress, SAVE_KEY, SAVE_VERSION, migrateMapChoice } from '../src/core/save.js';
import { loadExplore, saveExplore, EXPLORE_KEY, EXPLORE_VERSION, EXPLORE_MAX_TEXT, defaultExplore } from '../src/core/explore.js';
import { MAP_CHOICE_KEY } from '../src/world/maps.js';

function memory(entries = {}) {
  const m = new Map(Object.entries(entries));
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), m };
}
const throwing = () => ({ getItem() { throw new Error('blocked'); }, setItem() { throw new Error('quota'); }, removeItem() { throw new Error('blocked'); } });

const good = JSON.stringify({ version: SAVE_VERSION, score: { total: 5000, best: { jump: 9 } }, medals: { a: 'gold' }, stats: { distance: 10 } });
const BAD = {
  empty: '',
  garbage: '{{{{ not json',
  truncated: good.slice(0, Math.floor(good.length / 2)),
  nullText: 'null',
  number: '42',
  array: '[1,2,3]',
  string: '"hello"',
  futureVersion: JSON.stringify({ version: 99, score: { total: 7 }, newThing: { a: 1 }, settings: { quality: 'ultra', steering: 'teleport' } }),
  wrongTypes: JSON.stringify({ version: 3, score: 'x', medals: 5, bestTimes: [], stats: { distance: 'far' }, session: 7, mapSessions: [], secrets: 'y', loop: 3, settings: 9 }),
  protoKeys: '{"version":3,"medals":{"__proto__":"gold","constructor":"gold"},"score":{"missions":{"__proto__":{"best":1}}}}',
  huge: '{"version":3,"pad":"' + 'x'.repeat(300000) + '"}',
  deep: '['.repeat(50000) + ']'.repeat(50000),
};

for (const [name, text] of Object.entries(BAD)) {
  test(`main save: ${name} does not throw and stays usable`, () => {
    const st = memory({ [SAVE_KEY]: text });
    const p = loadProgress(st);
    assert.equal(p.version, SAVE_VERSION);
    assert.deepEqual(Object.keys(p).sort(), Object.keys(defaultProgress()).sort());
    assert.equal(Object.getPrototypeOf(p.medals), Object.prototype);
    assert.equal(({}).gold, undefined);
    // it can be saved over and then reads back
    assert.equal(saveProgress(st, p), true);
    assert.deepEqual(loadProgress(st), p);
  });
}

test('future version keeps what it understands', () => {
  const p = loadProgress(memory({ [SAVE_KEY]: BAD.futureVersion }));
  assert.equal(p.score.total, 7);
  assert.equal(p.settings.quality, 1);
  assert.equal(p.settings.steering, 'wheel');
});

test('blocked storage: load gives defaults, save returns false', () => {
  assert.deepEqual(loadProgress(throwing()), defaultProgress());
  assert.equal(saveProgress(throwing(), defaultProgress()), false);
  assert.deepEqual(loadProgress(null), defaultProgress());
  assert.equal(saveProgress(null, defaultProgress()), false);
  assert.equal(loadExplore(throwing()).state.version, EXPLORE_VERSION);
  assert.equal(saveExplore(throwing(), defaultExplore()), false);
});

const goodEx = JSON.stringify(defaultExplore());
const BAD_EX = {
  empty: '',
  garbage: 'nope{',
  truncated: goodEx.slice(0, 20),
  nullText: 'null',
  array: '[]',
  future: JSON.stringify({ version: 99, garages: { found: ['x'] }, adventures: 5, cells: 12 }),
  wrongTypes: JSON.stringify({ version: 1, garages: 'a', adventures: [], cells: { a: 1 } }),
  oversized: JSON.stringify({ version: 1, cells: 'A'.repeat(EXPLORE_MAX_TEXT + 10) }),
};
for (const [name, text] of Object.entries(BAD_EX)) {
  test(`explore save: ${name} does not throw and stays usable`, () => {
    const st = memory({ [EXPLORE_KEY]: text });
    const { state } = loadExplore(st);
    assert.equal(state.version, EXPLORE_VERSION);
    assert.ok(Array.isArray(state.garages.found));
    assert.ok(Array.isArray(state.adventures.done));
    assert.equal(typeof state.cells, 'string');
    assert.equal(saveExplore(st, state), true);
    assert.equal(loadExplore(st).newer, false);
  });
}

const MAP_VALUES = ['', 'null', '../../etc', '<b>x</b>', 'miami', 'MIAMI', 'x'.repeat(100000), '\u0000', 'island', 'unknown-region', '{"a":1}'];
for (const v of MAP_VALUES) {
  test(`map choice ${JSON.stringify(v.slice(0, 20))} migrates without throwing`, () => {
    const st = memory({ [MAP_CHOICE_KEY]: v, [SAVE_KEY]: good });
    const r = migrateMapChoice(st);
    assert.ok(r === null || (typeof r === 'string' && r.length < 40));
    // running it again must not throw either
    assert.doesNotThrow(() => migrateMapChoice(st));
  });
}

test('map choice with blocked storage', () => {
  assert.equal(migrateMapChoice(throwing()), null);
  assert.equal(migrateMapChoice(null), null);
});
