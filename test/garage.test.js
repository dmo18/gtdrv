import test from 'node:test';
import assert from 'node:assert/strict';
import {
  GARAGE_MAX, MAP_LIMIT, kindOfSpec, sanitizeSession, sanitizeGarage, sanitizeCraft,
  buildSession, garageAdd, garageRemove, savable, craftRecord, wrapAngle, selectMapSession, SESSION_MAPS,
} from '../src/core/garage.js';
import { createSession } from '../src/systems/session.js';
import { createVehicle } from '../src/entities/vehicle.js';
import { createBoat } from '../src/entities/boat.js';
import { createAircraft } from '../src/entities/aircraft.js';
import { defaultProgress, sanitizeProgress, loadProgress, saveProgress, SAVE_KEY } from '../src/core/save.js';

const memory = (init) => {
  const m = new Map(init ? [[SAVE_KEY, init]] : []);
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), raw: () => m.get(SAVE_KEY) };
};
const rec = (spec, x, z, o = {}) => ({ spec, color: 0xc8402e, health: 1, x, z, heading: 0, ...o });

test('spec kinds are known across all craft families', () => {
  assert.equal(kindOfSpec('sedan'), 'car');
  assert.equal(kindOfSpec('prop'), 'plane');
  assert.equal(kindOfSpec('heli'), 'heli');
  assert.equal(kindOfSpec('rustback'), 'tank');
  assert.equal(kindOfSpec('nope'), null);
  for (const bad of ['__proto__', 'constructor', 'toString', 'hasOwnProperty', '', 5, null, {}, [], 'x'.repeat(100)]) {
    assert.equal(kindOfSpec(bad), null, String(bad));
  }
});

test('garbage sessions are rejected or reduced to a safe start', () => {
  for (const bad of [null, undefined, 5, 'x', [], true, NaN]) assert.equal(sanitizeSession(bad), null);
  const s = sanitizeSession({});
  // No map field: an older save, made on the island.
  assert.deepEqual(s, { map: 'island', mode: 'start', x: 0, z: 0, heading: 0, craft: null, garage: [] });
  // Position fields that are not finite numbers fall back to a start.
  for (const x of [NaN, Infinity, '12', null, {}, [5], -Infinity]) {
    const r = sanitizeSession({ mode: 'foot', x, z: 5 });
    assert.equal(r.mode, 'start', String(x));
  }
  assert.equal(sanitizeSession({ mode: 'spaceship', x: 1, z: 1 }).mode, 'start');
  assert.equal(sanitizeSession({ mode: 7, x: 1, z: 1 }).mode, 'start');
});

test('foot sessions clamp coordinates and wrap headings', () => {
  const s = sanitizeSession({ mode: 'foot', x: 1e12, z: -1e12, heading: 7 + 2 * Math.PI });
  assert.equal(s.mode, 'foot');
  assert.equal(s.x, MAP_LIMIT);
  assert.equal(s.z, -MAP_LIMIT);
  assert.ok(Math.abs(s.heading - wrapAngle(7)) < 1e-9 && Math.abs(s.heading) <= Math.PI);
  assert.equal(sanitizeSession({ mode: 'foot', x: 1, z: 2, heading: 'east' }).heading, 0);
  assert.equal(sanitizeSession({ mode: 'foot', x: 1, z: 2, heading: Infinity }).heading, 0);
});

test('craft sessions: spec ids, colours and health are validated', () => {
  const ok = sanitizeSession({ mode: 'car', x: 10, z: 20, heading: 1, craft: { spec: 'muscle', color: 0xff0000, health: 0.5 } });
  assert.equal(ok.mode, 'car');
  assert.deepEqual(ok.craft, { spec: 'muscle', color: 0xff0000, health: 0.5, y: 0, speed: 0, airborne: false });
  const unknown = sanitizeSession({ mode: 'car', x: 10, z: 20, craft: { spec: 'doesnotexist', color: 1, health: 1 } });
  assert.equal(unknown.mode, 'start');
  assert.equal(unknown.craft, null);
  // Craft of one family under another family's mode is not trusted.
  assert.equal(sanitizeSession({ mode: 'boat', x: 1, z: 1, craft: { spec: 'sedan' } }).mode, 'start');
  assert.equal(sanitizeSession({ mode: 'car', x: 1, z: 1 }).mode, 'start');
  const c = sanitizeCraft({ spec: 'sedan', color: 'red', health: 99 });
  assert.equal(c.health, 1);
  assert.ok(Number.isInteger(c.color) && c.color >= 0 && c.color <= 0xffffff, 'a bad colour falls back to a spec colour');
  assert.equal(sanitizeCraft({ spec: 'sedan', color: 1.5 }).color !== 1.5, true);
  assert.equal(sanitizeCraft({ spec: 'sedan', color: -1 }).color !== -1, true);
  assert.equal(sanitizeCraft({ spec: 'sedan', color: 0x1000000 }).color !== 0x1000000, true);
  assert.equal(sanitizeCraft({ spec: 'sedan', health: -5 }).health, 0.05, 'a nearly dead craft is not a zero health craft');
  assert.equal(sanitizeCraft({ spec: 'sedan', health: NaN }).health, 1);
  assert.equal(sanitizeCraft({ spec: 'sedan', health: '0.2' }).health, 1);
});

test('airborne only counts for aircraft that were really high', () => {
  const air = sanitizeSession({ mode: 'plane', x: 0, z: 0, craft: { spec: 'prop', color: 1, health: 1, y: 300, speed: 50, airborne: true } });
  assert.equal(air.craft.airborne, true);
  assert.equal(air.craft.y, 300);
  const low = sanitizeSession({ mode: 'plane', x: 0, z: 0, craft: { spec: 'prop', y: 2, airborne: true } });
  assert.equal(low.craft.airborne, false);
  const car = sanitizeSession({ mode: 'car', x: 0, z: 0, craft: { spec: 'sedan', y: 500, airborne: true } });
  assert.equal(car.craft.airborne, false, 'cars are never airborne');
  const huge = sanitizeSession({ mode: 'heli', x: 0, z: 0, craft: { spec: 'heli', y: 1e9, speed: 1e9, airborne: true } });
  assert.ok(huge.craft.y <= 1500 && huge.craft.speed <= 200);
  const str = sanitizeSession({ mode: 'plane', x: 0, z: 0, craft: { spec: 'prop', y: '300', speed: '50', airborne: 'yes' } });
  assert.equal(str.craft.y, 0);
  assert.equal(str.craft.airborne, false);
});

test('garage: at most 8 cars, cars only, strict fields, most recent first', () => {
  const many = [];
  for (let i = 0; i < 40; i++) many.push(rec(i % 2 ? 'sedan' : 'taxi', i * 10, i));
  many.push(rec('prop', 0, 0), rec('doesnotexist', 0, 0), rec('sedan', NaN, 0), rec('sedan', 0, '5'), null, 7, 'x', [], rec('boat', 1, 1));
  const g = sanitizeGarage(many);
  assert.equal(g.length, GARAGE_MAX);
  assert.equal(g[0].x, 0);
  assert.equal(g[7].x, 70);
  for (const e of g) assert.equal(kindOfSpec(e.spec), 'car');
  assert.deepEqual(sanitizeGarage('nope'), []);
  assert.deepEqual(sanitizeGarage({ length: 5, 0: rec('sedan', 1, 1) }), []);
  const far = sanitizeGarage([rec('sedan', 1e15, -1e15)]);
  assert.equal(far[0].x, MAP_LIMIT);
  assert.equal(far[0].z, -MAP_LIMIT);
  // A huge sparse array is not scanned beyond a small bound.
  const sparse = [];
  sparse.length = 1e7;
  sparse[1e6] = rec('sedan', 1, 1);
  assert.deepEqual(sanitizeGarage(sparse), []);
});

test('garage list: add replaces the same car, keeps 8, remove works', () => {
  const list = [];
  garageAdd(list, rec('sedan', 0, 0));
  garageAdd(list, rec('taxi', 50, 50, { color: 0xf2d21b }));
  assert.equal(list.length, 2);
  assert.equal(list[0].spec, 'taxi');
  // The same car moved a little replaces its old entry.
  garageAdd(list, rec('sedan', 1, 1));
  assert.equal(list.length, 2);
  assert.equal(list[0].spec, 'sedan');
  // Same spec, different colour or place is a different car.
  garageAdd(list, rec('sedan', 1, 1, { color: 0x111111 }));
  garageAdd(list, rec('sedan', 100, 100));
  assert.equal(list.length, 4);
  for (let i = 0; i < 20; i++) garageAdd(list, rec('van', 200 + i * 10, 0, { color: i }));
  assert.equal(list.length, GARAGE_MAX);
  assert.equal(list[0].color, 19, 'most recent first');
  // Not a car, or garbage: ignored.
  const n = list.length;
  garageAdd(list, rec('prop', 0, 0));
  garageAdd(list, null);
  garageAdd(list, rec('sedan', NaN, 0));
  assert.equal(list.length, n);
  const first = list[0];
  garageRemove(list, first);
  assert.equal(list.includes(first), false);
  garageRemove(list, first);
  assert.equal(list.length, n - 1);
});

test('buildSession: live car, damage, wreck and foot', () => {
  const car = createVehicle('pickup', 120.123, -40, 3.5);
  car.health = car.spec.health * 0.5;
  car.color = 0x123456;
  const s = buildSession({ mode: 'car', x: 0, z: 0, heading: 0 }, car, []);
  assert.equal(s.mode, 'car');
  assert.deepEqual([s.x, s.z], [120.12, -40]);
  assert.equal(s.craft.spec, 'pickup');
  assert.equal(s.craft.color, 0x123456);
  assert.equal(s.craft.health, 0.5);
  assert.ok(Math.abs(s.heading) <= Math.PI);
  car.wrecked = true;
  assert.equal(savable(car), false);
  const w = buildSession(null, car, [rec('sedan', 1, 1)]);
  assert.equal(w.mode, 'start', 'a wrecked craft is never saved');
  assert.equal(w.garage.length, 1);
  const foot = buildSession({ mode: 'foot', x: 5, z: 6, heading: 1 }, null, []);
  assert.deepEqual([foot.mode, foot.x, foot.z, foot.heading], ['foot', 5, 6, 1]);
  const dead = createVehicle('sedan', 0, 0, 0);
  dead.health = 0;
  assert.equal(savable(dead), false);
  const burning = createVehicle('sedan', 0, 0, 0);
  burning.onFire = true;
  assert.equal(savable(burning), false);
  assert.equal(savable(null), false);
});

test('buildSession: aircraft flags airborne only when off the ground and high', () => {
  const p = createAircraft('prop', 5, 5, 0);
  p.y = 200;
  p.onGround = false;
  p.speed = 40;
  assert.equal(buildSession(null, p, []).craft.airborne, true);
  p.onGround = true;
  p.y = 0;
  assert.equal(buildSession(null, p, []).craft.airborne, false);
  const b = createBoat('runabout', 10, 10, 0);
  assert.equal(buildSession(null, b, []).mode, 'boat');
});

test('craftRecord reads spec id, colour and health fraction', () => {
  const v = createVehicle('van', 3, 4, 1);
  v.health = v.spec.health / 4;
  const r = craftRecord(v);
  assert.equal(r.spec, 'van');
  assert.equal(r.health, 0.25);
});

test('save: session round trip, v2 migration and prototype pollution', () => {
  const p = defaultProgress();
  assert.equal(p.session, null);
  p.session = buildSession({ mode: 'foot', x: 12, z: -7, heading: 1.2 }, null, [rec('taxi', 40, 40, { color: 0xf2d21b, health: 0.8 })]);
  const s = memory();
  assert.equal(saveProgress(s, p), true);
  const back = loadProgress(s);
  assert.deepEqual(back.session, p.session);
  assert.equal(JSON.parse(s.raw()).version, 3);
  // A version 2 save (no session) loads with the score kept and no session.
  const v2 = { version: 2, score: { total: 777 }, medals: { a: 'gold' }, stats: { distance: 5, flights: 1, races: 0 } };
  const m = loadProgress(memory(JSON.stringify(v2)));
  assert.equal(m.score.total, 777);
  assert.equal(m.session, null);
  assert.deepEqual(m.medals, { a: 'gold' });
  // Version 1 saves still migrate and have no session.
  const m1 = loadProgress(memory(JSON.stringify({ money: 50, medals: {} })));
  assert.equal(m1.score.total, 500);
  assert.equal(m1.session, null);
  // Hostile text.
  const evil = '{"version":3,"session":{"__proto__":{"polluted":1},"constructor":{"prototype":{"p":1}},"mode":"foot","x":1,"z":2,'
    + '"garage":[{"__proto__":{"spec":"sedan"},"spec":"sedan","x":1,"z":1}]}}';
  const e = loadProgress(memory(evil));
  assert.equal({}.polluted, undefined);
  assert.equal(e.session.mode, 'foot');
  assert.equal(e.session.garage.length, 1);
  assert.equal(Object.prototype.hasOwnProperty.call(e.session, 'polluted'), false);
  for (const junk of [null, 5, 'x', [], { mode: [] }, { garage: 'x' }, { mode: 'car', craft: 'sedan', x: 1, z: 1 }]) {
    const r = sanitizeProgress({ version: 3, session: junk });
    assert.ok(r.session === null || (typeof r.session.mode === 'string' && Array.isArray(r.session.garage)));
  }
  // Deep nesting does not blow the stack.
  let deep = {};
  for (let i = 0; i < 5000; i++) deep = { craft: deep, garage: [deep], mode: 'car' };
  assert.doesNotThrow(() => sanitizeProgress({ version: 3, session: deep }));
});

test('a wrecked saved craft is never restored: saved sessions carry no wreck', () => {
  const s = sanitizeSession({ mode: 'car', x: 1, z: 1, craft: { spec: 'sedan', color: 1, health: 0, wrecked: true } });
  // Health is raised to the floor; the wrecked flag has no field to live in.
  assert.equal(s.craft.health, 0.05);
  assert.equal('wrecked' in s.craft, false);
});

test('map limit is 6 km: Miami positions survive a save, the bound stays strict', () => {
  assert.equal(MAP_LIMIT, 6000);
  // A foot session and a parked car far out on the Miami map round trip exactly.
  const p = defaultProgress();
  p.session = buildSession({ mode: 'foot', x: 4000, z: 1000, heading: 0.5 }, null, [rec('sedan', -4400, 3800)]);
  const s = memory();
  assert.equal(saveProgress(s, p), true);
  const back = loadProgress(s);
  assert.equal(back.session.x, 4000);
  assert.equal(back.session.z, 1000);
  assert.equal(back.session.garage[0].x, -4400);
  assert.equal(back.session.garage[0].z, 3800);
  // Still clamped beyond 6 km, and non-numbers are still refused.
  const far = sanitizeSession({ mode: 'foot', x: 7000.5, z: -9e9 });
  assert.equal(far.x, MAP_LIMIT);
  assert.equal(far.z, -MAP_LIMIT);
  assert.equal(sanitizeGarage([rec('sedan', 6500, -6500)])[0].x, MAP_LIMIT);
  for (const bad of [NaN, Infinity, -Infinity, '4000', null, [4000], { v: 1 }]) {
    assert.equal(sanitizeSession({ mode: 'foot', x: bad, z: 1 }).mode, 'start', String(bad));
    assert.deepEqual(sanitizeGarage([rec('sedan', bad, 1)]), [], String(bad));
  }
});

test('sessions carry their map: an island save stays on the island, a Miami save on Miami', () => {
  // An older save (no map field) is the island's.
  const old = sanitizeProgress({ version: 3, session: { mode: 'foot', x: 120, z: -40, heading: 1 } });
  assert.equal(old.session.map, 'island');
  // Opened on Miami: the island place is put aside, not moved to Miami.
  assert.equal(selectMapSession(old, 'miami'), null);
  assert.equal(old.session, null);
  assert.equal(old.mapSessions.island.x, 120);
  // A Miami session is made and saved; the island one survives the round trip.
  old.session = buildSession({ mode: 'foot', x: 3900, z: -500, heading: 0.2 }, null, [rec('sedan', 3950, -480)], 'miami');
  const s = memory();
  assert.equal(saveProgress(s, old), true);
  const back = loadProgress(s);
  assert.equal(back.session.map, 'miami');
  assert.equal(back.session.x, 3900);
  assert.equal(back.mapSessions.island.map, 'island');
  // Back on the island: its own place again, Miami's put aside.
  const isl = selectMapSession(back, 'island');
  assert.equal(isl.map, 'island');
  assert.equal(isl.x, 120);
  assert.equal(back.mapSessions.miami.x, 3900);
  assert.equal(back.mapSessions.island, undefined);
  // And to Miami once more.
  assert.equal(selectMapSession(back, 'miami').x, 3900);
  assert.equal(back.mapSessions.island.x, 120);
  // Same map: nothing moves.
  assert.equal(selectMapSession(back, 'miami').x, 3900);
  // Garbage in mapSessions is dropped; a session filed under the wrong map is too.
  const g = sanitizeProgress({ version: 3, mapSessions: { miami: { map: 'island', mode: 'foot', x: 1, z: 1 }, island: 5, mars: {}, __proto__: { p: 1 } } });
  assert.deepEqual(g.mapSessions, {});
  assert.deepEqual(sanitizeProgress({ version: 3, mapSessions: [1, 2] }).mapSessions, {});
  assert.equal(sanitizeSession({ map: 'atlantis', mode: 'foot', x: 1, z: 1 }).map, 'island');
  assert.ok(SESSION_MAPS.includes('miami') && SESSION_MAPS.includes('island'));
});

test('the session system picks the session of the map being played, both ways', () => {
  const fakeGame = (map, progress) => {
    const handlers = {};
    return {
      city: { map, nodes: [], spawn: { x: 0, z: 0, heading: 0 } }, collision: null, progress,
      events: { on: (k, f) => (handlers[k] = f), emit: () => {} },
      player: { mode: 'foot', x: map === 'miami' ? 3900 : 120, z: map === 'miami' ? -500 : -40, heading: 0, vehicle: null },
    };
  };
  const store = memory();
  // Played on the island first (the old default), saved.
  let p = loadProgress(store);
  let g = fakeGame(undefined, p);
  createSession(g, store);
  assert.equal(g.saveSession(), true);
  assert.equal(loadProgress(store).session.map, 'island');
  // Now Miami (the default): starts fresh, the island save is kept aside.
  p = loadProgress(store);
  g = fakeGame('miami', p);
  createSession(g, store);
  assert.equal(p.session, null);
  assert.equal(p.mapSessions.island.x, 120);
  assert.equal(g.saveSession(), true);
  let back = loadProgress(store);
  assert.equal(back.session.map, 'miami');
  assert.equal(back.session.x, 3900);
  assert.equal(back.mapSessions.island.x, 120);
  // Back to ?map=island: the island place, Miami's kept.
  p = loadProgress(store);
  g = fakeGame(undefined, p);
  createSession(g, store);
  assert.equal(p.session.map, 'island');
  assert.equal(p.session.x, 120);
  assert.equal(p.mapSessions.miami.x, 3900);
  g.saveSession();
  back = loadProgress(store);
  assert.equal(back.session.map, 'island');
  assert.equal(back.mapSessions.miami.x, 3900);
});

// ---- Region ids (PLAN_V2 3.5 rule 1) ----
import { SESSION_MAPS as MAPS2, sanitizeSession as sanitizeSession2, sanitizeMapSessions as sanitizeMapSessions2 } from '../src/core/garage.js';
import { REGION_IDS } from '../src/world/regions.js';

test('SESSION_MAPS holds the island, miami and every region id', () => {
  for (const id of ['island', 'miami', ...REGION_IDS]) assert.ok(MAPS2.includes(id), id);
  assert.equal(new Set(MAPS2).size, MAPS2.length);
});

test('a region session is kept with its map id; a place off the crop is the start place', () => {
  const s = sanitizeSession2({ map: 'miami-north', mode: 'foot', x: -2600, z: -3300, heading: 1 });
  assert.equal(s.map, 'miami-north');
  assert.equal(s.mode, 'foot');
  const far = sanitizeSession2({ map: 'miami-north', mode: 'foot', x: 3000, z: 3000, heading: 1 });
  assert.equal(far.mode, 'start');
  assert.deepEqual(Object.keys(sanitizeMapSessions2({ 'miami-north': s, 'miami-west': s })), ['miami-north']);
});
