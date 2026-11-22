// The explore save (docs/REVAMP.md 6.6): its own key, strict sanitiser,
// derived unlocks, the car collection rules and the explore cells.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  EXPLORE_KEY, EXPLORE_VERSION, CELL_BYTES, EXPLORE_CELLS, defaultExplore, sanitizeExplore, readExplore, loadExplore,
  saveExplore, clearExplore, bytesToB64, b64ToBytes, cellIndex, setCellBit, cellBit, cellsFrom, explorePercent,
  unlocks, garageOpen, routeOpen, counts, storeCar, takeOut, repaint, toggleFavourite, release, favourite,
  markGarageSeen, markGarageFound, markAdventureSeen, completeStep, nextStep, stepsDone, track, paintAllowed,
  isRewardSpec, deriveExplore, EXPLORE_MAX_TEXT,
} from '../src/core/explore.js';
import { GARAGE_IDS, LOCKED_GARAGES, GARAGE_CARS_MAX, PAINT_COLORS, GARAGE_DEFS } from '../src/world/garages.js';
import { ADVENTURE_DEFS, ADVENTURE_IDS, REWARD_CARS, ROUTE_IDS } from '../src/world/adventures.js';
import { SAVE_KEY } from '../src/core/save.js';
import { VEHICLE_SPECS } from '../src/entities/vehicle.js';

const memory = (init = {}) => {
  const m = new Map(Object.entries(init));
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), map: m };
};
const def = (id) => ADVENTURE_DEFS.find((d) => d.id === id);
const car = (spec, o = {}) => ({ spec, color: VEHICLE_SPECS[spec].colors[0], health: 1, ...o });

test('its own key and version; the main save key is never used', () => {
  assert.equal(EXPLORE_KEY, 'rustwater.explore.v1');
  assert.notEqual(EXPLORE_KEY, SAVE_KEY);
  assert.equal(EXPLORE_VERSION, 1);
  const st = memory();
  saveExplore(st, defaultExplore());
  assert.deepEqual([...st.map.keys()], [EXPLORE_KEY]);
  assert.deepEqual(loadExplore(st).state, defaultExplore());
});

test('garbage of every shape gives the defaults', () => {
  const d = defaultExplore();
  for (const bad of [null, undefined, 0, 1, 'x', true, [], [1, 2], () => 1, { version: '1' }, { version: 1.5 }, { version: -3 },
    { version: 0 }, { version: NaN }, { version: 1, garages: 'x', adventures: 7, cells: 9 }]) {
    assert.deepEqual(sanitizeExplore(bad), d, JSON.stringify(bad));
  }
  // Text over the limit, broken JSON: defaults.
  assert.deepEqual(loadExplore(memory({ [EXPLORE_KEY]: '{' })).state, d);
  const big = JSON.stringify({ version: 1, pad: 'x'.repeat(EXPLORE_MAX_TEXT) });
  assert.deepEqual(loadExplore(memory({ [EXPLORE_KEY]: big })).state, d);
  // A throwing storage.
  const boom = { getItem() { throw new Error('no'); }, setItem() { throw new Error('no'); }, removeItem() { throw new Error('no'); } };
  assert.deepEqual(loadExplore(boom).state, d);
  assert.equal(saveExplore(boom, d), false);
  assert.doesNotThrow(() => clearExplore(boom));
  assert.equal(saveExplore(null, d), false);
});

test('hostile input: prototype keys, getters, huge arrays, unknown ids, wrong types', () => {
  const raw = JSON.parse(`{"version":1,"__proto__":{"polluted":true},"constructor":{"x":1},
    "garages":{"found":["g-downtown","__proto__","g-downtown",5,null,"g-nope"],"seen":["toString","g-wynwood"],
      "cars":[{"spec":"__proto__"},{"spec":"sedan","color":"red","health":"9"},{"spec":"jet"},{"spec":"rustback"},{"spec":"ghostwake"}],
      "last":"constructor"},
    "adventures":{"seen":["a-first-light","hasOwnProperty"],"done":["a-first-light","a-sandbar"],"step":{"__proto__":3,"a-roads-end":2},"tracked":"__proto__"},
    "cells":"!!!!"}`);
  const ex = sanitizeExplore(raw);
  assert.equal({}.polluted, undefined);
  assert.equal(Object.getPrototypeOf(ex), Object.prototype);
  assert.deepEqual(ex.garages.found, ['g-downtown']);
  assert.deepEqual(ex.garages.seen.sort(), ['g-downtown', 'g-wynwood']);
  assert.equal(ex.garages.cars.length, 1, 'only the sedan is a car (no tank, jet, ghostwake or bad id)');
  assert.equal(ex.garages.cars[0].spec, 'sedan');
  assert.ok(paintAllowed('sedan', ex.garages.cars[0].color));
  assert.equal(ex.garages.cars[0].health, 1);
  assert.equal(ex.garages.last, null);
  assert.deepEqual(ex.adventures.seen, ['a-first-light']);
  assert.deepEqual(ex.adventures.done, ['a-first-light'], 'done must be a subset of seen');
  assert.deepEqual(ex.adventures.step, {}, 'steps only for seen and not done');
  assert.equal(ex.adventures.tracked, null);
  assert.equal(ex.cells, '');
  // Huge arrays: at most 64 entries are looked at, 24 cars kept.
  const many = { version: 1, garages: { cars: Array.from({ length: 100000 }, () => car('sedan')), found: Array(100000).fill('g-downtown') } };
  const t0 = Date.now();
  const m = sanitizeExplore(many);
  assert.ok(Date.now() - t0 < 200);
  assert.equal(m.garages.cars.length, GARAGE_CARS_MAX);
  assert.deepEqual(m.garages.found, ['g-downtown']);
  // Getters never run (JSON has none, but a live object might).
  let ran = false;
  const sneaky = { version: 1, garages: { get found() { ran = true; return []; } } };
  assert.doesNotThrow(() => sanitizeExplore(sneaky));
  void ran;
  // Non-finite and out-of-range numbers.
  const n = sanitizeExplore({ version: 1, garages: { cars: [{ spec: 'sedan', color: Infinity, health: -5 }, { spec: 'sedan', color: 0x123456, health: NaN }] } });
  for (const c of n.garages.cars) {
    assert.ok(Number.isInteger(c.color) && paintAllowed('sedan', c.color));
    assert.ok(c.health >= 0.05 && c.health <= 1);
  }
});

test('a save from a newer build is left alone and not written over', () => {
  const text = JSON.stringify({ version: EXPLORE_VERSION + 1, future: true, garages: { found: ['g-downtown'] } });
  const st = memory({ [EXPLORE_KEY]: text });
  const r = loadExplore(st);
  assert.equal(r.newer, true);
  assert.deepEqual(r.state, defaultExplore());
  assert.equal(st.map.get(EXPLORE_KEY), text);
  assert.equal(readExplore({ version: 1 }).newer, false);
});

test('derived, never trusted: locked garages, reward cars, step clamps, favourite', () => {
  // A locked garage needs its adventure done.
  const raw = { version: 1, garages: { found: [...GARAGE_IDS], seen: [...GARAGE_IDS], cars: [car('sunchaser'), car('tidewinder', { fav: true }), car('sedan', { fav: true })] },
    adventures: { seen: ['a-roads-end', 'a-sunchaser', 'a-sandbar'], done: ['a-roads-end'], step: { 'a-sunchaser': 99, 'a-sandbar': 0xff }, tracked: 'a-roads-end' } };
  const ex = sanitizeExplore(raw);
  for (const g of LOCKED_GARAGES) {
    const adv = GARAGE_DEFS.find((d) => d.id === g).locked;
    assert.equal(ex.garages.found.includes(g), adv === 'a-roads-end', g);
    assert.equal(ex.garages.seen.includes(g), adv === 'a-roads-end', g);
  }
  // Reward cars only for done adventures: sunchaser and tidewinder dropped.
  assert.deepEqual(ex.garages.cars.map((c) => c.spec), ['sedan']);
  assert.equal(ex.garages.cars[0].fav, true, 'the first remaining favourite wins');
  assert.equal(ex.adventures.step['a-sunchaser'], def('a-sunchaser').steps.length - 1, 'seq steps clamped below the count');
  assert.equal(ex.adventures.step['a-sandbar'], 0b111, 'tour bits masked to the step count');
  assert.equal(ex.adventures.tracked, null, 'a done adventure is not tracked');
  // A reward car missing from the collection is added when its adventure is done.
  const ex2 = sanitizeExplore({ version: 1, adventures: { seen: ['a-tidewinder', 'a-nightheron'], done: ['a-tidewinder', 'a-nightheron'] },
    garages: { cars: [car('sedan', { fav: true }), car('nightheron', { fav: true }), car('nightheron')] } });
  const specs = ex2.garages.cars.map((c) => c.spec);
  assert.deepEqual(specs.sort(), ['nightheron', 'sedan', 'tidewinder']);
  assert.ok(ex2.garages.cars.filter((c) => c.reward).every((c) => isRewardSpec(c.spec)));
  assert.equal(ex2.garages.cars.filter((c) => c.fav).length, 1);
  // At most one of each reward car even when stored twice.
  assert.equal(specs.filter((s) => s === 'nightheron').length, 1);
});

test('round trip of a full state', () => {
  const ex = defaultExplore();
  for (const id of GARAGE_IDS) markGarageSeen(ex, id);
  ex.adventures.seen.push(...ADVENTURE_IDS);
  ex.adventures.done.push(...ADVENTURE_IDS.slice(0, 10));
  deriveExplore(ex);
  for (const id of GARAGE_IDS) markGarageFound(ex, id);
  while (ex.garages.cars.length < GARAGE_CARS_MAX) storeCar(ex, car('muscle', { color: PAINT_COLORS[ex.garages.cars.length % 16] }));
  toggleFavourite(ex, 4);
  ex.adventures.step['a-port-quay'] = 0;
  ex.adventures.step['a-hammock-trail'] = 0b101;
  ex.adventures.tracked = 'a-hammock-trail';
  ex.garages.last = 'g-key';
  const b = new Uint8Array(CELL_BYTES);
  for (let c = 0; c < EXPLORE_CELLS; c += 7) setCellBit(b, c);
  ex.cells = bytesToB64(b);
  const st = memory();
  assert.equal(saveExplore(st, ex), true);
  const back = loadExplore(st).state;
  const want = sanitizeExplore(JSON.parse(JSON.stringify(ex)));
  assert.deepEqual(back, want);
  assert.equal(back.garages.cars.length, GARAGE_CARS_MAX);
  assert.equal(back.garages.found.length, 12);
  assert.equal(back.adventures.tracked, 'a-hammock-trail');
  assert.equal(back.adventures.step['a-hammock-trail'], 0b101);
  assert.deepEqual([...cellsFrom(back)], [...b]);
  // And once more: stable.
  saveExplore(st, back);
  assert.deepEqual(loadExplore(st).state, back);
});

test('cells: 144 bytes as base64, anything else is empty', () => {
  const b = new Uint8Array(CELL_BYTES);
  setCellBit(b, 0);
  setCellBit(b, 1151);
  const s = bytesToB64(b);
  assert.equal(s.length, 192);
  assert.deepEqual([...b64ToBytes(s)], [...b]);
  assert.equal(cellBit(b64ToBytes(s), 1151), 1);
  for (const bad of ['', 'AAAA', 'A'.repeat(191), s + 'AAAA', s.replace('A', '*'), 5, null]) {
    assert.equal(sanitizeExplore({ version: 1, cells: bad }).cells, '', String(bad).slice(0, 12));
  }
  assert.equal(sanitizeExplore({ version: 1, cells: s }).cells, s);
  // The grid covers the box: 36 by 32 cells of 250 m.
  assert.equal(cellIndex(-4500, -4000), 0);
  assert.equal(cellIndex(4499, 3999), 1151);
  assert.equal(cellIndex(4600, 0), -1);
  const land = new Uint8Array(EXPLORE_CELLS).fill(1);
  assert.equal(explorePercent(b, land), (2 * 100) / 1152);
  assert.equal(explorePercent(b, new Uint8Array(EXPLORE_CELLS)), 0);
});

test('unlock rule: garages, cars and routes come from the done list only', () => {
  const ex = defaultExplore();
  assert.deepEqual(unlocks(ex), { garages: [], cars: [], routes: [] });
  for (const g of LOCKED_GARAGES) assert.equal(garageOpen(ex, g), false);
  for (const r of ROUTE_IDS) assert.equal(routeOpen(ex, ADVENTURE_DEFS.find((d) => d.reward.route === r).id), false);
  // A locked garage cannot be seen or found before its adventure.
  assert.equal(markGarageSeen(ex, 'g-roads'), false);
  assert.equal(markGarageFound(ex, 'g-roads'), false);
  ex.adventures.seen.push(...ADVENTURE_IDS);
  ex.adventures.done.push(...ADVENTURE_IDS);
  deriveExplore(ex);
  const u = unlocks(ex);
  assert.deepEqual(u.garages.sort(), ['g-beach', 'g-key', 'g-roads']);
  assert.deepEqual(u.cars.sort(), Object.values(REWARD_CARS).sort());
  assert.deepEqual(u.routes.sort(), [...ROUTE_IDS].sort());
  assert.equal(markGarageFound(ex, 'g-roads'), true);
  assert.deepEqual(ex.garages.cars.filter((c) => c.reward).map((c) => c.spec).sort(), ['nightheron', 'sunchaser', 'tidewinder']);
  // Storage that claims unlocks without the adventure gets none.
  const fake = sanitizeExplore({ version: 1, garages: { found: ['g-key'], seen: ['g-key'], cars: [car('sunchaser')] } });
  assert.deepEqual(fake.garages.found, []);
  assert.deepEqual(fake.garages.cars, []);
  const c = counts(ex, 41.5);
  assert.deepEqual(c, { garagesFound: 1, garagesTotal: 12, adventuresDone: 16, adventuresTotal: 16, percent: 41.5 });
  assert.equal(counts(ex, NaN).percent, 0);
});

test('collection rules: store, take out, repaint, favourite, release, full', () => {
  const ex = defaultExplore();
  const live = { spec: VEHICLE_SPECS.muscle, color: VEHICLE_SPECS.muscle.colors[1], health: VEHICLE_SPECS.muscle.health / 2 };
  assert.deepEqual(storeCar(ex, live), { ok: true, index: 0 });
  assert.equal(ex.garages.cars[0].spec, 'muscle');
  assert.equal(ex.garages.cars[0].health, 0.5);
  assert.equal(storeCar(ex, { spec: 'jet', color: 0 }).ok, false, 'aircraft are never stored');
  assert.equal(storeCar(ex, { spec: 'rustback', color: 0 }).ok, false, 'tanks are never stored');
  assert.equal(storeCar(ex, { spec: 'speedboat', color: 0 }).ok, false, 'boats are never stored');
  storeCar(ex, car('sedan'));
  // Repaint: the paint grid or the model's own colours only.
  assert.equal(repaint(ex, 1, PAINT_COLORS[3]).ok, true);
  assert.equal(ex.garages.cars[1].color, PAINT_COLORS[3]);
  assert.equal(repaint(ex, 1, 0x010203).ok, false);
  assert.equal(repaint(ex, 9, PAINT_COLORS[0]).ok, false);
  // Favourite: a star toggle, at most one.
  assert.equal(toggleFavourite(ex, 0).fav, true);
  assert.equal(toggleFavourite(ex, 1).fav, true);
  assert.deepEqual(ex.garages.cars.map((c) => c.fav), [false, true]);
  assert.equal(favourite(ex).spec, 'sedan');
  assert.equal(toggleFavourite(ex, 1).fav, false);
  assert.equal(favourite(ex), null);
  // Take out: the arriving car is stored first, the picked one leaves.
  const arriving = { spec: VEHICLE_SPECS.van || VEHICLE_SPECS.sedan, color: (VEHICLE_SPECS.van || VEHICLE_SPECS.sedan).colors[0], health: 1 };
  const r = takeOut(ex, 0, arriving);
  assert.equal(r.ok, true);
  assert.equal(r.car.spec, 'muscle');
  assert.equal(r.car.health, 1, 'out at full health');
  assert.equal(r.stored, true);
  assert.equal(ex.garages.cars.length, 2);
  assert.equal(takeOut(ex, 5).ok, false);
  // Full: storing asks for a release; taking out leaves the arriving car outside.
  while (ex.garages.cars.length < GARAGE_CARS_MAX) storeCar(ex, car('sedan'));
  assert.deepEqual(storeCar(ex, car('sedan')), { ok: false, reason: 'full' });
  const r2 = takeOut(ex, 3, car('sedan'));
  assert.equal(r2.ok, true);
  assert.equal(r2.stored, true, 'taking one out made room');
  const r3 = takeOut(ex, 3, null);
  assert.equal(r3.ok && r3.stored, false);
  storeCar(ex, car('sedan'));
  assert.equal(ex.garages.cars.length, GARAGE_CARS_MAX);
  // Release: removes; reward cars cannot be released.
  assert.equal(release(ex, 0).ok, true);
  assert.equal(ex.garages.cars.length, GARAGE_CARS_MAX - 1);
  ex.adventures.seen.push('a-sunchaser');
  ex.adventures.done.push('a-sunchaser');
  deriveExplore(ex);
  const ri = ex.garages.cars.findIndex((c) => c.spec === 'sunchaser');
  assert.ok(ri >= 0 && ex.garages.cars[ri].reward);
  assert.deepEqual(release(ex, ri), { ok: false, reason: 'reward' });
  // A reward car taken out stays in the collection.
  const n = ex.garages.cars.length;
  assert.equal(takeOut(ex, ri).car.spec, 'sunchaser');
  assert.equal(ex.garages.cars.length, n);
  // A favourite taken out keeps its star on the live car and gets it back when stored.
  const fi = ex.garages.cars.findIndex((c) => !c.reward);
  toggleFavourite(ex, fi);
  const out = takeOut(ex, fi).car;
  assert.equal(out.fav, true);
  storeCar(ex, { spec: VEHICLE_SPECS[out.spec], color: out.color, health: 900, fav: true });
  assert.equal(favourite(ex).spec, out.spec);
});

test('adventure steps: seq in order, tour in any order, once each, needs first', () => {
  const ex = defaultExplore();
  const roads = def('a-roads-end'), tour = def('a-sandbar'), mile = def('a-beach-mile');
  assert.equal(completeStep(ex, roads, 0), null, 'not seen yet');
  markAdventureSeen(ex, roads.id);
  assert.equal(markAdventureSeen(ex, roads.id), false, 'seen once');
  assert.equal(completeStep(ex, roads, 1), null, 'out of order');
  assert.equal(completeStep(ex, roads, 0), 'step');
  assert.equal(completeStep(ex, roads, 0), null, 'once');
  assert.equal(nextStep(ex, roads), 1);
  assert.equal(completeStep(ex, roads, 1), 'step');
  assert.equal(stepsDone(ex, roads), 2);
  assert.equal(track(ex, roads.id), true);
  assert.equal(completeStep(ex, roads, 2), 'done');
  assert.ok(ex.adventures.done.includes(roads.id));
  assert.equal(ex.adventures.tracked, null);
  assert.equal(nextStep(ex, roads), -1);
  assert.equal(completeStep(ex, roads, 2), null);
  assert.equal(markGarageFound(ex, 'g-roads'), true, 'the unlock is live at once');
  // Tour: any order.
  markAdventureSeen(ex, mile.id);
  assert.equal(completeStep(ex, mile, 0), null, 'Beach Mile needs the Sandbar Walk');
  markAdventureSeen(ex, tour.id);
  assert.equal(completeStep(ex, tour, 2), 'step');
  assert.equal(nextStep(ex, tour), 0);
  assert.equal(completeStep(ex, tour, 0), 'step');
  assert.equal(completeStep(ex, tour, 2), null);
  assert.equal(completeStep(ex, tour, 1), 'done');
  assert.equal(completeStep(ex, mile, 1), 'step');
  assert.equal(track(ex, 'a-first-light'), false, 'only a seen adventure can be tracked');
});
