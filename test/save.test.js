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
  p.settings = { master: 0.3, invertPitch: true, leftHanded: true, quality: 1.25, police: false, steering: 'tilt', steerSensitivity: 1.25, handling: 'sim', hud: 'full' };
  const s = memory();
  assert.equal(saveProgress(s, p), true);
  assert.deepEqual(loadProgress(s), p);
  assert.equal(JSON.parse(s.getItem(SAVE_KEY)).version, 3);
});

test('defaults: version 3, no money, no owned', () => {
  const p = defaultProgress();
  assert.equal(p.version, 3);
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
    settings: { master: 0.3, invertPitch: true, leftHanded: true, quality: 0.75, police: false, steering: 'slider', steerSensitivity: 1.25, handling: 'sim', hud: 'full' },
  };
  const p = loadProgress(memory(JSON.stringify(v1)));
  assert.equal(p.version, 3);
  assert.equal(p.score.total, 12340);
  assert.equal(p.money, undefined);
  assert.equal(p.owned, undefined);
  assert.deepEqual(p.medals, v1.medals);
  assert.deepEqual(p.bestTimes, v1.bestTimes);
  assert.deepEqual(p.stats, v1.stats);
  assert.deepEqual(p.settings, v1.settings);
  // Migrated once: saving writes version 3 and loading it again changes nothing.
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
    assert.equal(p.version, 3);
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
    settings: { master: 9, invertPitch: 'yes', leftHanded: true, quality: 2, police: 0, steering: 'joystick', steerSensitivity: 9, handling: 'gt', hud: 'huge' },
  });
  assert.deepEqual(p.medals, { b: 'gold' });
  assert.deepEqual(p.bestTimes, { c: 12 });
  assert.deepEqual(p.stats, { distance: 0, flights: 4, races: 0 });
  assert.deepEqual(p.settings, { master: 1, invertPitch: false, leftHanded: true, quality: 1, police: true, steering: 'wheel', steerSensitivity: 1.5, handling: 'arcade', hud: 'minimal' });
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

test('hud setting: minimal by default, only minimal or full accepted', () => {
  assert.equal(defaultProgress().settings.hud, 'minimal');
  const h = (x) => sanitizeProgress({ settings: { hud: x } }).settings.hud;
  assert.equal(h('full'), 'full');
  assert.equal(h('minimal'), 'minimal');
  for (const bad of ['Full', 'busy', 1, null, {}, undefined]) assert.equal(h(bad), 'minimal');
});

test('the Blood setting survives a load only as a real boolean', () => {
  const p = defaultProgress();
  p.settings.blood = false;
  assert.equal(sanitizeProgress(JSON.parse(JSON.stringify(p))).settings.blood, false);
  p.settings.blood = 'no';
  assert.equal(sanitizeProgress(JSON.parse(JSON.stringify(p))).settings.blood, undefined);
});

// ---- Regions (PLAN_V2 3.5) ----
import { migrateMapChoice } from '../src/core/save.js';
import { MAP_CHOICE_KEY } from '../src/world/maps.js';
import { regionOfPoint, inRegion as inRegionOf } from '../src/world/regions.js';

const store = (init = {}) => {
  const m = new Map(Object.entries(init));
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) };
};
const sedan = { spec: 'sedan', color: 0x336699, health: 1 };
const miamiSession = (x, z, mode = 'car') => ({ map: 'miami', mode, x, z, heading: 0, craft: mode === 'car' ? { ...sedan, y: 0, speed: 0 } : null, garage: [] });
const withSession = (session) => JSON.stringify({ version: 3, session });

test('migration: stored miami becomes the region of the saved position, once', () => {
  // ten sample points of the whole box and the region each lands in
  const samples = [
    [0, 0, 'miami-downtown'], [-900, -1200, 'miami-downtown'], [3500, 500, 'miami-beach'], [3000, -3000, 'miami-beach'],
    [-3500, -3000, 'miami-north'], [-3500, 0, 'miami-west'], [-3500, 3000, 'miami-south'], [-1500, 3000, 'miami-south'],
    [2000, 2500, 'miami-beach'], [-2000, -2650, 'miami-downtown'],
  ];
  for (const [x, z, want] of samples) {
    assert.equal(regionOfPoint(x, z), want, `${x},${z}`);
    const st = store({ [SAVE_KEY]: withSession(miamiSession(x, z)), [MAP_CHOICE_KEY]: 'miami' });
    assert.equal(migrateMapChoice(st), want);
    assert.equal(st.getItem(MAP_CHOICE_KEY), want);
    const p = loadProgress(st);
    // the miami session is kept untouched; the region slot holds a copy only when 60 m inside
    assert.equal(p.session.map, 'miami');
    assert.equal(p.session.x, x);
    const copied = p.mapSessions[want];
    if (inRegionOf(want, x, z, 60)) {
      assert.ok(copied, `${want} copy at ${x},${z}`);
      assert.equal(copied.map, want);
      assert.equal(copied.x, x);
      assert.equal(copied.craft.spec, 'sedan');
    } else assert.equal(copied, undefined);
    // done once: the stored id is no longer 'miami'
    assert.equal(migrateMapChoice(st), want);
  }
});

test('migration: no saved position or no choice at all', () => {
  const st = store({ [MAP_CHOICE_KEY]: 'miami' });
  // 0.9.0 re-pin (deliberate): a new game starts in the Beach (DEFAULT_REGION);
  // Downtown stays CORE_REGION, the designed first view.
  assert.equal(migrateMapChoice(st), 'miami-beach');
  assert.equal(st.getItem(MAP_CHOICE_KEY), 'miami-beach');
  // a new player (nothing stored, no Miami session): nothing is written
  const fresh = store();
  assert.equal(migrateMapChoice(fresh), null);
  assert.equal(fresh.getItem(MAP_CHOICE_KEY), null);
  // an old default-map player (no stored choice, a Miami session): moved to its region
  const old = store({ [SAVE_KEY]: withSession(miamiSession(3500, 500)) });
  assert.equal(migrateMapChoice(old), 'miami-beach');
  assert.equal(old.getItem(MAP_CHOICE_KEY), 'miami-beach');
  // the island and region choices are left alone
  assert.equal(migrateMapChoice(store({ [MAP_CHOICE_KEY]: 'island' })), 'island');
  assert.equal(migrateMapChoice(store({ [MAP_CHOICE_KEY]: 'miami-west' })), 'miami-west');
  // a standing region session is never overwritten by the copy
  const both = store({ [SAVE_KEY]: JSON.stringify({ version: 3, session: miamiSession(3500, 500), mapSessions: { 'miami-beach': { map: 'miami-beach', mode: 'foot', x: 3000, z: 0, heading: 0, garage: [] } } }), [MAP_CHOICE_KEY]: 'miami' });
  migrateMapChoice(both);
  assert.equal(loadProgress(both).mapSessions['miami-beach'].mode, 'foot');
  // a start-mode Miami session has nothing to copy
  const startOnly = store({ [SAVE_KEY]: withSession(miamiSession(0, 0, 'start')), [MAP_CHOICE_KEY]: 'miami' });
  // (0.9.0 re-pin, deliberate: no position means the default region, the Beach.)
  assert.equal(migrateMapChoice(startOnly), 'miami-beach');
  assert.equal(loadProgress(startOnly).mapSessions['miami-beach'], undefined);
});

test('migration never throws on broken storage', () => {
  const bad = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } };
  assert.equal(migrateMapChoice(bad), null);
  assert.equal(migrateMapChoice(null), null);
  const half = { getItem: (k) => (k === MAP_CHOICE_KEY ? 'miami' : '{broken'), setItem: () => { throw new Error('full'); } };
  assert.equal(typeof migrateMapChoice(half), 'string');
});

test('saves: region sessions load, an unknown map id falls back to the island record, a session off its crop starts fresh', () => {
  const ok = sanitizeProgress({ version: 3, session: { map: 'miami-beach', mode: 'car', x: 3000, z: 100, heading: 0, craft: { ...sedan, y: 0, speed: 3 }, garage: [] } });
  assert.equal(ok.session.map, 'miami-beach');
  assert.equal(ok.session.mode, 'car');
  const off = sanitizeProgress({ version: 3, session: { map: 'miami-beach', mode: 'car', x: -3000, z: 100, heading: 0, craft: sedan, garage: [{ ...sedan, x: -3000, z: 0, heading: 0 }] } });
  assert.equal(off.session.mode, 'start');
  assert.equal(off.session.garage.length, 1, 'cars left on the road stay in the save');
  const junk = sanitizeProgress({ version: 3, session: { map: 'miami-elsewhere', mode: 'foot', x: 5, z: 5 } });
  assert.equal(junk.session.map, 'island');
  const maps = sanitizeProgress({ version: 3, mapSessions: { 'miami-west': { map: 'miami-west', mode: 'foot', x: -3500, z: 0, heading: 0 }, 'miami-south': { map: 'miami-west', mode: 'foot', x: -3500, z: 0 }, __proto__: { x: 1 } } });
  assert.deepEqual(Object.keys(maps.mapSessions), ['miami-west']);
  // a boat just past the crop is allowed (craft turn back 600 m out); far away is not
  const boat = (x) => sanitizeProgress({ version: 3, session: { map: 'miami-beach', mode: 'boat', x, z: 0, heading: 0, craft: { spec: 'speedboat', color: 1, health: 1, y: 0, speed: 0 }, garage: [] } }).session.mode;
  assert.equal(boat(4800), 'boat');
  assert.equal(boat(-3000), 'start');
});

test('settings.mapNorthUp: a strict boolean is kept, anything else is dropped (absent reads as false)', () => {
  assert.equal(defaultProgress().settings.mapNorthUp, undefined);
  assert.equal(sanitizeProgress({ settings: { mapNorthUp: true } }).settings.mapNorthUp, true);
  assert.equal(sanitizeProgress({ settings: { mapNorthUp: false } }).settings.mapNorthUp, false);
  for (const bad of ['true', 1, 0, null, {}, ['x']]) assert.equal(sanitizeProgress({ settings: { mapNorthUp: bad } }).settings.mapNorthUp, undefined);
});

test('the Street names setting survives a load only as a real boolean', () => {
  const p = defaultProgress();
  p.settings.streetLabel = false;
  assert.equal(sanitizeProgress(JSON.parse(JSON.stringify(p))).settings.streetLabel, false);
  p.settings.streetLabel = 'off';
  assert.equal(sanitizeProgress(JSON.parse(JSON.stringify(p))).settings.streetLabel, undefined);
});
