import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SAVE_KEY, defaultProgress, sanitizeProgress, loadProgress, saveProgress,
} from '../src/core/save.js';

const memory = (init) => {
  const m = new Map(init ? [[SAVE_KEY, init]] : []);
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)) };
};

test('round trip keeps valid progress', () => {
  const p = defaultProgress();
  p.score.total = 123456;
  p.score.sessionBest = 9000;
  p.score.best = { combo: 3.5, jump: 41.5, airtime: 2.25, drift: 800, nearMiss: 4 };
  p.score.missions = { m1: { best: 4200, time: 181.5, done: true } };
  p.score.courses = { race1: 3500 };
  p.medals = { race1: 'gold', seen_docks: 'bronze', hint_car: 'bronze' };
  p.bestTimes = { race1: 61.5 };
  p.stats = { distance: 5000.5, flights: 2, races: 3 };
  p.settings = { master: 0.3, invertPitch: true, leftHanded: true, quality: 1.25, police: false, steering: 'tilt', steerSensitivity: 1.25, handling: 'sim' };
  const s = memory();
  assert.equal(saveProgress(s, p), true);
  assert.deepEqual(loadProgress(s), p);
  assert.equal(JSON.parse(s.getItem(SAVE_KEY)).version, 2);
});

test('defaults: version 2, no money, no owned', () => {
  const p = defaultProgress();
  assert.equal(p.version, 2);
  assert.equal(p.money, undefined);
  assert.equal(p.owned, undefined);
  assert.equal(p.score.total, 0);
});

test('version 1 save migrates: money x 10 is the total, medals, times, stats, settings kept', () => {
  const v1 = {
    money: 1234, owned: ['jet', 'yacht'],
    medals: { race1: 'gold', 'street-glasswell': 'silver', seen_docks: 'bronze', hint_car: 'bronze', hint_steer: 'bronze' },
    bestTimes: { race1: 61.5, 'street-glasswell': 90.2 },
    stats: { distance: 12345.6, flights: 7, races: 9 },
    settings: { master: 0.3, invertPitch: true, leftHanded: true, quality: 0.75, police: false, steering: 'slider', steerSensitivity: 1.25, handling: 'sim' },
  };
  const p = loadProgress(memory(JSON.stringify(v1)));
  assert.equal(p.version, 2);
  assert.equal(p.score.total, 12340);
  assert.equal(p.money, undefined);
  assert.equal(p.owned, undefined);
  assert.deepEqual(p.medals, v1.medals);
  assert.deepEqual(p.bestTimes, v1.bestTimes);
  assert.deepEqual(p.stats, v1.stats);
  assert.deepEqual(p.settings, v1.settings);
  // Migrated once: saving writes version 2 and loading it again changes nothing.
  const s = memory(JSON.stringify(v1));
  saveProgress(s, loadProgress(s));
  assert.equal(JSON.parse(s.getItem(SAVE_KEY)).money, undefined);
  assert.deepEqual(loadProgress(s), p);
});

test('version 1 money is clamped, and a v1 save without usable money starts at zero', () => {
  assert.equal(sanitizeProgress({ money: 5e12 }).score.total, 99999999 * 10);
  for (const bad of [-50, NaN, '1e999', null, [5], { a: 1 }, Infinity]) {
    assert.equal(sanitizeProgress({ money: bad }).score.total, 0);
  }
  assert.equal(sanitizeProgress({ money: 250.9 }).score.total, 2500);
});

test('a score field on a version 1 save is ignored (only version 2 may set it)', () => {
  const p = sanitizeProgress({ money: 10, score: { total: 777777, best: { combo: 5 } } });
  assert.equal(p.score.total, 100);
  assert.equal(p.score.best.combo, 0);
});

test('version 2 score fields are clamped and sanitised', () => {
  const p = sanitizeProgress({
    version: 2,
    score: {
      total: 5e12, sessionBest: -3,
      best: { combo: 99, jump: 'far', airtime: 7.777, drift: Infinity, nearMiss: 3, evil: 1 },
      missions: { m1: { best: 1e12, time: 99999999, done: 'yes' }, 'Bad Key': { best: 1 }, m2: 5, m3: { best: 10.9, time: 12, done: true } },
      courses: { race1: 2500.7, race2: -1, race3: 'x', 'x y': 5 },
    },
  });
  assert.equal(p.score.total, 1e9);
  assert.equal(p.score.sessionBest, 0);
  assert.deepEqual(p.score.best, { combo: 5, jump: 0, airtime: 7.78, drift: 0, nearMiss: 3 });
  assert.deepEqual(p.score.missions, {
    m1: { best: 1e9, time: 86400, done: false },
    m3: { best: 10, time: 12, done: true },
  });
  assert.deepEqual(p.score.courses, { race1: 2500, race2: 0 });
});

test('garbage inputs give valid defaults', () => {
  const huge = 'x'.repeat(2e6);
  const many = {};
  for (let i = 0; i < 10000; i++) many['k' + i] = 'gold';
  let deep = {};
  for (let i = 0; i < 5000; i++) deep = { medals: deep, score: deep, version: 2 };
  const inputs = [null, undefined, 5, NaN, Infinity, 'str', huge, [], [1, 2], true,
    { money: NaN, owned: 3, medals: [], stats: 'a', settings: 7 },
    { version: 2, score: 'x', medals: 5 }, { version: 2, score: { best: 3, missions: [], courses: 7 } },
    { money: Infinity }, { money: -50 }, { medals: many, bestTimes: many },
    { version: 2, score: { missions: many, courses: many } }, deep];
  for (const x of inputs) {
    const p = sanitizeProgress(x);
    assert.ok(Number.isInteger(p.score.total) && p.score.total >= 0 && p.score.total <= 1e9);
    assert.equal(p.version, 2);
    assert.equal(p.money, undefined);
    assert.ok(Object.keys(p.medals).length <= 200);
    assert.ok(Object.keys(p.score.courses).length <= 200);
    assert.ok(Object.keys(p.score.missions).length <= 200);
  }
  assert.deepEqual(sanitizeProgress(null), defaultProgress());
  assert.deepEqual(sanitizeProgress({ version: 2, score: 'x' }), defaultProgress());
  assert.equal(Object.keys(sanitizeProgress({ medals: many }).medals).length, 200);
});

test('field checks', () => {
  const p = sanitizeProgress({
    medals: { a: 'platinum', b: 'gold', 'Bad Key': 'gold' },
    bestTimes: { a: -1, b: 90000, c: 12, d: NaN },
    stats: { distance: -1, flights: 4, races: 'x' },
    settings: { master: 9, invertPitch: 'yes', leftHanded: true, quality: 2, police: 0, steering: 'joystick', steerSensitivity: 9, handling: 'gt' },
  });
  assert.deepEqual(p.medals, { b: 'gold' });
  assert.deepEqual(p.bestTimes, { c: 12 });
  assert.deepEqual(p.stats, { distance: 0, flights: 4, races: 0 });
  assert.deepEqual(p.settings, { master: 1, invertPitch: false, leftHanded: true, quality: 1, police: true, steering: 'wheel', steerSensitivity: 1.5, handling: 'arcade' });
});

test('prototype pollution is ignored', () => {
  const s = memory('{"__proto__":{"polluted":1},"medals":{"__proto__":"gold","constructor":"gold","prototype":"gold"},'
    + '"settings":{"__proto__":{"polluted":2}},"constructor":{"prototype":{"polluted":3}},'
    + '"version":2,"score":{"__proto__":{"polluted":4},"missions":{"__proto__":{"best":1},"constructor":{"best":1}},"courses":{"__proto__":5,"prototype":5}}}');
  const p = loadProgress(s);
  assert.equal(({}).polluted, undefined);
  assert.equal(p.polluted, undefined);
  assert.deepEqual(p.medals, {});
  assert.deepEqual(p.score.missions, {});
  assert.deepEqual(p.score.courses, {});
  assert.equal(p.score.polluted, undefined);
  assert.equal(Object.getPrototypeOf(p.medals), Object.prototype);
  assert.equal(Object.getPrototypeOf(p.score.missions), Object.prototype);
});

test('unknown fields are not copied', () => {
  const p = sanitizeProgress({ extra: 1, settings: { evil: 1 }, stats: { evil: 1 } });
  assert.equal(p.extra, undefined);
  assert.equal(p.settings.evil, undefined);
  assert.equal(p.stats.evil, undefined);
});

test('storage problems are tolerated', () => {
  const thrower = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('quota'); } };
  assert.deepEqual(loadProgress(thrower), defaultProgress());
  assert.equal(saveProgress(thrower, defaultProgress()), false);
  assert.deepEqual(loadProgress(null), defaultProgress());
  assert.equal(saveProgress(null, defaultProgress()), false);
  assert.deepEqual(loadProgress(memory('{not json')), defaultProgress());
  const big = JSON.stringify({ version: 2, score: { total: 999 }, pad: 'x'.repeat(100001) });
  assert.deepEqual(loadProgress(memory(big)), defaultProgress());
});

test('handling setting: arcade by default, sim kept, anything else falls back', () => {
  assert.equal(defaultProgress().settings.handling, 'arcade');
  const h = (x) => sanitizeProgress({ settings: { handling: x } }).settings.handling;
  assert.equal(h('sim'), 'sim');
  assert.equal(h('arcade'), 'arcade');
  for (const bad of ['SIM', 'realistic', '', 1, null, ['sim'], { sim: 1 }]) assert.equal(h(bad), 'arcade');
});
