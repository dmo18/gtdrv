import test from 'node:test';
import assert from 'node:assert/strict';
import {
  defaultLoop, loopOf, recordEvent, recordTry, recordBank, addTotal, noteBest, addDistance, noteVehicle, medalCounts, bestFlow,
  totalDistance, boardRows, closestMedals, MAX_DRIVEN, MAX_EVENTS, REGION_SLUGS, REGION_NAMES, TOTAL_KEYS,
} from '../src/core/records.js';
import { sanitizeLoop, sanitizeProgress, defaultProgress, saveProgress, loadProgress, SAVE_KEY } from '../src/core/save.js';
import { regionSlug } from '../src/world/eventspots.js';

const ev = (tpl, n, slug = 'beach') => ({ id: 'ev_' + slug + '_' + tpl + '_' + n, tpl, name: tpl + ' ' + n, street: 'Ocean Dr', targets: { gold: 3, silver: 2, bronze: 1 } });

test('an event keeps its best medal and best value; tries count', () => {
  const L = defaultLoop();
  const trap = ev('trap', 1);
  let r = recordEvent(L, trap, 70.126, 'silver');
  assert.ok(r.newBest && r.newMedal);
  assert.deepEqual(L.events[trap.id], { m: 'silver', b: 70.13, n: 1 });
  r = recordEvent(L, trap, 60, 'bronze');
  assert.ok(!r.newBest && !r.newMedal);
  assert.equal(r.medal, 'silver', 'a worse run never lowers the medal');
  assert.equal(L.events[trap.id].b, 70.13);
  r = recordEvent(L, trap, 81, 'gold');
  assert.ok(r.newBest && r.newMedal && r.prev === 70.13);
  assert.equal(L.events[trap.id].n, 3);
  // less is better for a rush drop
  const dash = ev('dash', 1);
  recordEvent(L, dash, 50, 'bronze');
  assert.ok(recordEvent(L, dash, 42, 'silver').newBest);
  assert.ok(!recordEvent(L, dash, 48, 'bronze').newBest);
  assert.equal(L.events[dash.id].b, 42);
  recordTry(L, dash);
  assert.equal(L.events[dash.id].n, 4);
  recordTry(L, ev('heat', 2));
  assert.deepEqual(L.events.ev_beach_heat_2, { m: '', b: NaN, n: 1 }, 'a failed first try makes the empty record');
  assert.equal(L.totals.events, 6);
  // a run with no medal stores the value, not a medal
  recordEvent(L, ev('miss', 3), 1, null);
  assert.deepEqual(L.events.ev_beach_miss_3, { m: '', b: 1, n: 1 });
});

test('flow banks, totals, bests, distance and vehicles', () => {
  const L = defaultLoop();
  assert.equal(recordBank(L, 'beach', 1200), true);
  assert.equal(recordBank(L, 'beach', 800), false);
  assert.equal(recordBank(L, 'north', 900), true);
  assert.equal(recordBank(L, 'nowhere', 99999), false);
  assert.equal(recordBank(L, 'beach', 0), false);
  assert.deepEqual(L.flow, { beach: 1200, north: 900 });
  assert.equal(L.totals.banked, 1200 + 800 + 900 + 99999);
  assert.equal(L.totals.runs, 4);
  assert.equal(bestFlow(L), 1200);
  addTotal(L, 'nearMiss', 3);
  addTotal(L, 'bogus', 3);
  assert.equal(L.totals.nearMiss, 3);
  assert.equal(L.totals.bogus, undefined);
  assert.ok(noteBest(L, 'mph', 91.26) && !noteBest(L, 'mph', 80) && !noteBest(L, 'bogus', 5));
  assert.equal(L.best.mph, 91.3);
  addDistance(L, 'beach', 1000);
  addDistance(L, 'beach', 609.344);
  addDistance(L, 'bogus', 50);
  assert.equal(totalDistance(L), 1609.344);
  assert.ok(noteVehicle(L, 'sedan') && !noteVehicle(L, 'sedan') && !noteVehicle(L, 7));
  for (let i = 0; i < 100; i++) noteVehicle(L, 'x' + i);
  assert.equal(L.driven.length, MAX_DRIVEN);
});

test('the board: medal counts by region and overall, rows by template, the closest medals', () => {
  const L = defaultLoop();
  const list = [ev('trap', 1), ev('trap', 2), ev('miss', 1), ev('jump', 1), ev('dash', 1)];
  recordEvent(L, list[0], 80, 'gold');
  recordEvent(L, list[1], 60, 'bronze');
  recordEvent(L, list[2], 0, null);
  recordEvent(L, ev('trap', 1, 'north'), 70, 'silver');
  assert.deepEqual(medalCounts(L), { gold: 1, silver: 1, bronze: 1, any: 3, tried: 4 });
  assert.deepEqual(medalCounts(L, 'beach'), { gold: 1, silver: 0, bronze: 1, any: 2, tried: 3 });
  assert.deepEqual(medalCounts(L, 'west'), { gold: 0, silver: 0, bronze: 0, any: 0, tried: 0 });
  const rows = boardRows(L, list);
  assert.deepEqual(rows.map((r) => [r.tpl, r.total, r.gold, r.silver, r.bronze]), [['trap', 2, 1, 0, 1], ['miss', 1, 0, 0, 0], ['jump', 1, 0, 0, 0], ['dash', 1, 0, 0, 0]]);
  assert.equal(rows[0].items[0].medal, 'gold');
  assert.equal(rows[0].items[0].best, 80);
  assert.ok(Number.isNaN(rows[2].items[0].best));
  // closest: the tried one without a medal, then untried ones, then bronze; gold is done
  assert.deepEqual(closestMedals(L, list, 3).map((e) => e.id), ['ev_beach_miss_1', 'ev_beach_jump_1', 'ev_beach_dash_1']);
  assert.ok(!closestMedals(L, list, 9).some((e) => e.id === 'ev_beach_trap_1'));
  for (const s of REGION_SLUGS) assert.ok(REGION_NAMES[s]);
  assert.equal(regionSlug({ mapId: 'miami-beach' }), 'beach');
  assert.equal(regionSlug({ mapId: 'nope', map: 'miami' }), 'miami');
  assert.equal(regionSlug({}), 'island');
});

test('loopOf makes the record on an old progress object', () => {
  const p = {};
  const L = loopOf(p);
  assert.equal(p.loop, L);
  assert.deepEqual(Object.keys(L.totals), TOTAL_KEYS);
});

test('save: the loop round-trips, and everything read back is rebuilt strictly', () => {
  const p = defaultProgress();
  const L = p.loop;
  recordEvent(L, ev('trap', 1), 81.2, 'gold');
  recordEvent(L, ev('wreck', 12, 'downtown'), 4, null);
  recordBank(L, 'beach', 4321);
  addDistance(L, 'beach', 1234.5);
  noteVehicle(L, 'muscle');
  noteBest(L, 'mph', 97);
  L.daily = { day: 20261123, done: [true, false, true], streak: 4 };
  L.intro = { step: 3, done: false };
  L.looks.sedan = { paint: 2, finish: 1, wheels: 3, tint: 2, decal: 1 };
  const mem = new Map();
  const storage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)) };
  assert.ok(saveProgress(storage, p));
  const q = loadProgress(storage);
  assert.deepEqual(q.loop, JSON.parse(JSON.stringify(L)));
  assert.ok(mem.get(SAVE_KEY).length < 2500);

  // hostile input
  const bad = sanitizeLoop({
    events: {
      ev_beach_trap_1: { m: 'platinum', b: 81, n: 2 },
      ev_beach_trap_2: { m: 'gold', b: 'fast', n: -4 },
      ev_beach_trap_3: { m: 'gold', b: 1e99, n: 1e99 },
      'ev_beach_trap_4<img>': { m: 'gold', b: 1, n: 1 },
      __proto__: { m: 'gold', b: 1, n: 1 },
      constructor: { m: 'gold', b: 1, n: 1 },
      ev_beach_nope_1: { m: 'gold', b: 1, n: 1 },
      ev_beach_trap_5: 'gold',
      ev_beach_trap_6: { m: 'silver', b: 55.555, n: 3.9, extra: 'x' },
    },
    flow: { beach: 5e12, mars: 5, north: -3, west: '9' },
    dist: { beach: 1e15, south: 12.5 },
    totals: { banked: -5, runs: 3.7, nearMiss: 1e15, hack: 9 },
    best: { mph: 1e9, jumpFt: 'far', tier: 3 },
    driven: ['sedan', 'sedan', 'warp-drive', 5, 'jet', 'muscle'],
    daily: { day: 99999999, done: [true, true, true], streak: 1e9 },
    intro: { step: 77, done: 'yes' },
    looks: { sedan: { paint: 999, finish: 1, wheels: -2, tint: 1.5, decal: 1 }, jet: { paint: 1 }, nope: { paint: 1 }, muscle: {} },
    extra: { deep: [1, 2, 3] },
  });
  assert.deepEqual(Object.keys(bad.events).sort(), ['ev_beach_trap_1', 'ev_beach_trap_2', 'ev_beach_trap_3', 'ev_beach_trap_6']);
  assert.deepEqual(bad.events.ev_beach_trap_1, { m: '', b: 81, n: 2 });
  assert.equal(bad.events.ev_beach_trap_2.m, '', 'no best value, no medal');
  assert.equal(bad.events.ev_beach_trap_2.n, 0);
  assert.equal(bad.events.ev_beach_trap_3.m, '');
  assert.equal(bad.events.ev_beach_trap_3.n, 99999);
  assert.deepEqual(bad.events.ev_beach_trap_6, { m: 'silver', b: 55.56, n: 3 });
  assert.deepEqual(bad.flow, { beach: 1e9 });
  assert.deepEqual(bad.dist, { beach: 1e12, south: 12.5 });
  assert.equal(bad.totals.banked, 0);
  assert.equal(bad.totals.runs, 3);
  assert.equal(bad.totals.nearMiss, 1e9);
  assert.equal(bad.totals.hack, undefined);
  assert.deepEqual(bad.best, { mph: 100000, jumpFt: 0, tier: 3, chain: 0 });
  assert.deepEqual(bad.driven, ['sedan', 'jet', 'muscle']);
  assert.deepEqual(bad.daily, { day: 0, done: [false, false, false], streak: 99999 });
  assert.deepEqual(bad.intro, { step: 0, done: false });
  assert.deepEqual(bad.looks, { sedan: { paint: -1, finish: 1, wheels: 0, tint: 0, decal: 1 } });
  assert.equal(bad.extra, undefined);
  assert.equal(Object.prototype.m, undefined);
  for (const junk of [null, 5, 'x', [], { events: [] }, { driven: {} }, { daily: [] }]) assert.deepEqual(sanitizeLoop(junk), defaultLoop());
  // size caps
  const many = { events: {}, driven: [], looks: {} };
  for (let i = 0; i < 99; i++) for (const t of ['trap', 'miss', 'jump', 'dash', 'heat', 'wreck']) for (const s of ['beach', 'north', 'west', 'south', 'downtown']) many.events['ev_' + s + '_' + t + '_' + i] = { m: 'gold', b: 1, n: 1 };
  assert.equal(Object.keys(sanitizeLoop(many).events).length, MAX_EVENTS);
  // an old save without the field loads with an empty loop; other fields are untouched
  const old = sanitizeProgress({ version: 3, score: { total: 50 }, medals: { race_x: 'gold' } });
  assert.deepEqual(old.loop, defaultLoop());
  assert.equal(old.score.total, 50);
  assert.equal(old.medals.race_x, 'gold');
});
