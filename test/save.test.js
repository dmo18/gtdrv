import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SAVE_KEY, defaultProgress, sanitizeProgress, loadProgress, saveProgress,
} from '../src/core/save.js';

const IDS = ['jet', 'stunt', 'heavyheli', 'yacht'];
const memory = (init) => {
  const m = new Map(init ? [[SAVE_KEY, init]] : []);
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)) };
};

test('round trip keeps valid progress', () => {
  const p = defaultProgress();
  p.money = 1234;
  p.owned = ['jet', 'yacht'];
  p.medals = { race1: 'gold', seen_docks: 'bronze' };
  p.bestTimes = { race1: 61.5 };
  p.stats = { distance: 5000.5, flights: 2, races: 3 };
  p.settings = { master: 0.3, invertPitch: true, leftHanded: true, quality: 1.25, police: false };
  const s = memory();
  assert.equal(saveProgress(s, p), true);
  assert.deepEqual(loadProgress(s, IDS), p);
});

test('garbage inputs give valid defaults', () => {
  const huge = 'x'.repeat(2e6);
  const many = {};
  for (let i = 0; i < 10000; i++) many['k' + i] = 'gold';
  let deep = {};
  for (let i = 0; i < 5000; i++) deep = { medals: deep, owned: [deep] };
  const inputs = [null, undefined, 5, NaN, Infinity, 'str', huge, [], [1, 2], true,
    { money: NaN, owned: 3, medals: [], stats: 'a', settings: 7 },
    { money: Infinity }, { money: -50 }, { medals: many, bestTimes: many }, deep];
  for (const x of inputs) {
    const p = sanitizeProgress(x, IDS);
    assert.ok(Number.isInteger(p.money) && p.money >= 0 && p.money <= 99999999);
    assert.ok(Array.isArray(p.owned));
    assert.ok(Object.keys(p.medals).length <= 200);
  }
  assert.deepEqual(sanitizeProgress(null, IDS), defaultProgress());
  assert.equal(sanitizeProgress({ money: -50 }, IDS).money, 0);
  assert.equal(sanitizeProgress({ money: 5e12 }, IDS).money, 99999999);
  assert.equal(sanitizeProgress({ money: '1e999' }, IDS).money, 250);
  assert.equal(Object.keys(sanitizeProgress({ medals: many }, IDS).medals).length, 200);
});

test('field checks', () => {
  const p = sanitizeProgress({
    medals: { a: 'platinum', b: 'gold', 'Bad Key': 'gold' },
    bestTimes: { a: -1, b: 90000, c: 12, d: NaN },
    stats: { distance: -1, flights: 4, races: 'x' },
    settings: { master: 9, invertPitch: 'yes', leftHanded: true, quality: 2, police: 0 },
  }, IDS);
  assert.deepEqual(p.medals, { b: 'gold' });
  assert.deepEqual(p.bestTimes, { c: 12 });
  assert.deepEqual(p.stats, { distance: 0, flights: 4, races: 0 });
  assert.deepEqual(p.settings, { master: 1, invertPitch: false, leftHanded: true, quality: 1, police: true });
});

test('prototype pollution is ignored', () => {
  const s = memory('{"__proto__":{"polluted":1},"medals":{"__proto__":"gold","constructor":"gold","prototype":"gold"},'
    + '"settings":{"__proto__":{"polluted":2}},"constructor":{"prototype":{"polluted":3}}}');
  const p = loadProgress(s, IDS);
  assert.equal(({}).polluted, undefined);
  assert.equal(p.polluted, undefined);
  assert.deepEqual(p.medals, {});
  assert.equal(Object.getPrototypeOf(p.medals), Object.prototype);
});

test('unknown spec ids are dropped, duplicates removed', () => {
  const p = sanitizeProgress({ owned: ['jet', 'jet', 'nope', 5, '<img>', 'yacht'] }, IDS);
  assert.deepEqual(p.owned, ['jet', 'yacht']);
  assert.deepEqual(sanitizeProgress({ owned: ['jet'] }).owned, []);
});

test('unknown fields are not copied', () => {
  const p = sanitizeProgress({ extra: 1, settings: { evil: 1 }, stats: { evil: 1 } }, IDS);
  assert.equal(p.extra, undefined);
  assert.equal(p.settings.evil, undefined);
  assert.equal(p.stats.evil, undefined);
});

test('storage problems are tolerated', () => {
  const thrower = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('quota'); } };
  assert.deepEqual(loadProgress(thrower, IDS), defaultProgress());
  assert.equal(saveProgress(thrower, defaultProgress()), false);
  assert.deepEqual(loadProgress(null, IDS), defaultProgress());
  assert.equal(saveProgress(null, defaultProgress()), false);
  assert.deepEqual(loadProgress(memory('{not json'), IDS), defaultProgress());
  const big = JSON.stringify({ money: 999, pad: 'x'.repeat(100001) });
  assert.deepEqual(loadProgress(memory(big), IDS), defaultProgress());
});
