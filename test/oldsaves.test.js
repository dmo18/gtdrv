// Saves written by released builds 0.3.1 to 0.8.0 (PLAN_V2 5.6) must load in
// this build without error and come out sanitized. The fixtures in
// test/fixtures/save-<version>.json were produced by each release's own
// core/save.js and core/explore.js (from git history) with non-default
// values, so they are the real on-disk shapes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadProgress, saveProgress, sanitizeProgress, defaultProgress, SAVE_KEY, SAVE_VERSION, migrateMapChoice } from '../src/core/save.js';
import { loadExplore, EXPLORE_KEY, EXPLORE_VERSION } from '../src/core/explore.js';
import { MAP_CHOICE_KEY } from '../src/world/maps.js';

const VERSIONS = ['0.3.1', '0.4.0', '0.5.0', '0.6.0', '0.7.0', '0.8.0'];
const fixture = (v) => JSON.parse(readFileSync(new URL(`./fixtures/save-${v}.json`, import.meta.url), 'utf8'));
function memory(entries) {
  const m = new Map(Object.entries(entries));
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), m };
}
const stored = (f) => Object.fromEntries(Object.entries(f).filter(([k]) => k.startsWith('rustwater.')));

for (const v of VERSIONS) {
  test(`save from ${v} loads and is sanitized`, () => {
    const f = fixture(v);
    assert.equal(f.version, v);
    const st = memory(stored(f));
    const raw = JSON.parse(f[SAVE_KEY]);
    const p = loadProgress(st);
    // Same shape as a fresh save: every current field is present.
    assert.deepEqual(Object.keys(p).sort(), Object.keys(defaultProgress()).sort());
    assert.equal(p.version, SAVE_VERSION);
    // Real progress carried over, not reset to defaults.
    assert.equal(p.score.total, raw.score.total);
    assert.equal(p.score.best.jump, 33);
    assert.equal(p.medals['stunt-1'], 'gold');
    assert.equal(p.bestTimes['race-1'], 61.5);
    assert.equal(p.stats.distance, 12345);
    assert.equal(p.settings.quality, 1.25);
    assert.equal(p.settings.steering, 'tilt');
    // Fields added after this version read as their defaults.
    assert.deepEqual(p.loop, defaultProgress().loop);
    assert.deepEqual(p.secrets, defaultProgress().secrets);
    // Sanitizing is idempotent and a save/load round trip is stable.
    assert.deepEqual(sanitizeProgress(JSON.parse(JSON.stringify(p))), p);
    assert.equal(saveProgress(st, p), true);
    assert.deepEqual(loadProgress(st), p);
  });

  test(`explore and map choice from ${v}`, () => {
    const f = fixture(v);
    const st = memory(stored(f));
    const hasExplore = Object.hasOwn(f, EXPLORE_KEY);
    const { state, newer } = loadExplore(st);
    assert.equal(newer, false);
    assert.equal(state.version, EXPLORE_VERSION);
    if (hasExplore) {
      assert.ok(state.garages.found.length >= 1, 'found garages kept');
      assert.ok(state.adventures.done.length >= 1, 'finished adventures kept');
      assert.ok(state.cells.length > 0, 'explore cells kept');
    } else {
      assert.equal(state.garages.found.length, 0);
    }
    // The map choice migration (plan 3.5) never throws and leaves a known map id.
    const id = migrateMapChoice(st);
    assert.ok(id === null || /^[a-z-]+$/.test(id));
    if (st.getItem(MAP_CHOICE_KEY) === null) assert.equal(v, '0.3.1');
    assert.doesNotThrow(() => loadProgress(st));
  });
}

test('0.4.0 to 0.6.0 whole-box map choice becomes a region', () => {
  for (const v of ['0.4.0', '0.5.0', '0.6.0']) {
    const st = memory(stored(fixture(v)));
    assert.equal(st.getItem(MAP_CHOICE_KEY), 'miami');
    assert.equal(migrateMapChoice(st), 'miami-downtown');
    assert.equal(st.getItem(MAP_CHOICE_KEY), 'miami-downtown');
  }
});

test('0.3.1 save has no explore key and loads default explore', () => {
  const f = fixture('0.3.1');
  assert.equal(Object.hasOwn(f, EXPLORE_KEY), false);
});

test('tampered old save text is rejected field by field', () => {
  const f = fixture('0.8.0');
  const raw = JSON.parse(f[SAVE_KEY]);
  raw.score.total = 'NaN';
  raw.settings.quality = 99;
  raw.settings.steering = '<script>';
  raw.medals = { a: 'platinum', __proto__: 'x' };
  raw.stats.distance = -5;
  const p = sanitizeProgress(raw);
  assert.equal(p.score.total, 0);
  assert.equal(p.settings.quality, defaultProgress().settings.quality);
  assert.equal(p.settings.steering, 'wheel');
  assert.deepEqual(p.medals, {});
  assert.equal(p.stats.distance, 0);
});
