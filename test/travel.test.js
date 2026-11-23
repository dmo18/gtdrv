// Regions: the picker list, pads, refusal, arrival, the travel save, the
// arrival note and the adventure shown from another region (PLAN_V2 3.4, 3.5).
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PICKER, mapName, pickerCurrent, travelRefusal, padNear, padHint, arrivalApprox, regionStart, travelSession, travelSave,
  writeTravelNote, takeTravelNote, TRAVEL_NOTE_KEY, REFUSED_WANTED, ARRIVE_IN, trackedElsewhere, adventureRegion,
} from '../src/core/travel.js';
import { REGIONS, REGION_IDS, inRegion, regionFor } from '../src/world/regions.js';
import { loadProgress, defaultProgress, SAVE_KEY } from '../src/core/save.js';
import { buildSession } from '../src/core/garage.js';
import { MAP_CHOICE_KEY, MAP_IDS } from '../src/world/maps.js';
import { ADVENTURE_DEFS } from '../src/world/adventures.js';

const memory = () => {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), map: m };
};
const car = (over = {}) => ({
  kind: 'car', spec: { id: 'sedan', health: 100 }, color: 0x336699, health: 80, x: 10, z: 20, heading: 1, y: 0, speed: 12, ...over,
});

test('picker: five regions and the classic island, clear names, all valid map ids', () => {
  assert.deepEqual(PICKER.map((p) => p.id), [...REGION_IDS, 'island']);
  for (const p of PICKER) {
    assert.ok(MAP_IDS.includes(p.id));
    assert.ok(p.name.length > 5 && mapName(p.id) === p.name);
  }
  assert.equal(mapName('island'), 'Classic island');
  assert.equal(mapName('nonsense'), '');
  // 0.9.0 re-pin (deliberate): a new game starts in the Beach (DEFAULT_REGION);
  // Downtown stays CORE_REGION, the designed first view.
  assert.equal(pickerCurrent('junk'), 'miami-beach');
  assert.equal(pickerCurrent('island'), 'island');
  assert.equal(pickerCurrent('miami-west'), 'miami-west');
});

test('refused while wanted, with a plain message', () => {
  assert.equal(travelRefusal(0), null);
  assert.equal(travelRefusal(2), REFUSED_WANTED);
  assert.match(padHint({ to: 'miami-beach' }, 0), /^Drive onto the pad to travel to Miami Beach and the Islands$/);
  assert.match(padHint({ to: 'miami-beach' }, 3), /Lose the police first/);
});

test('padNear: nearest pad within range, on the pad inside its radius, no allocation', () => {
  const city = { travelPads: [{ id: 'a', to: 'miami-beach', x: 100, z: 0, r: 8 }, { id: 'b', to: 'miami-north', x: 500, z: 0, r: 8 }] };
  const out = { pad: null, d: 0, on: false };
  assert.equal(padNear(city, 100, 3, out), out);
  assert.equal(out.pad.id, 'a');
  assert.ok(out.on);
  padNear(city, 100, 40, out);
  assert.ok(out.pad && !out.on);
  padNear(city, 100, 200, out);
  assert.equal(out.pad, null);
  assert.equal(padNear({}, 0, 0, out).pad, null);
});

test('every link has a twin and an approximate arrival 30 m inside the other crop', () => {
  for (const r of REGIONS) {
    assert.ok(r.links.length <= 7);
    for (const lk of r.links) {
      const twin = regionFor(lk.to).links.find((l) => l.id === lk.id);
      assert.ok(twin, lk.id + ' has a twin in ' + lk.to);
      assert.equal(twin.to, r.id);
      const a = arrivalApprox(lk.to, lk.id);
      assert.ok(a && inRegion(lk.to, a.x, a.z, 20), lk.id + ' arrives inside ' + lk.to);
      assert.ok(Number.isFinite(a.heading));
      // facing in: a step along the heading goes further inside
      assert.ok(inRegion(lk.to, a.x + Math.cos(a.heading) * 5, a.z + Math.sin(a.heading) * 5, ARRIVE_IN - 6));
    }
  }
  assert.equal(arrivalApprox('miami-west', 'nope'), null);
  assert.equal(arrivalApprox('island', 'x'), null);
});

test('region start places are inside their crops, 300 m from the edge', () => {
  for (const id of REGION_IDS) {
    const s = regionStart(id);
    assert.ok(inRegion(id, s.x, s.z, 300), id);
  }
});

test('travelSession: the car goes with the player, the left region keeps only its garage', () => {
  const p = defaultProgress();
  const garageHere = [{ spec: 'sedan', color: 1, health: 1, x: 5, z: 5, heading: 0 }];
  p.session = buildSession(null, car(), garageHere, 'miami-downtown');
  const pose = arrivalApprox('miami-beach', 'downtown-beach-macarthur');
  const s = travelSession(p, 'miami-downtown', 'miami-beach', car(), { mode: 'car' }, pose);
  assert.equal(s.map, 'miami-beach');
  assert.equal(s.mode, 'car');
  assert.equal(s.craft.spec, 'sedan');
  assert.equal(s.craft.color, 0x336699);
  assert.ok(Math.abs(s.x - Math.round(pose.x * 100) / 100) < 0.01);
  assert.equal(s.craft.speed, 0);
  assert.equal(p.session, s);
  const left = p.mapSessions['miami-downtown'];
  assert.equal(left.mode, 'start');
  assert.equal(left.craft, null);
  assert.deepEqual(left.garage.map((g) => g.spec), ['sedan']);
});

test('travelSession: a plane, a boat or the list (no pose) arrives at the start place', () => {
  const p = defaultProgress();
  const plane = { kind: 'plane', spec: { id: 'seaplane', health: 100 }, color: 1, health: 100, x: 0, z: 0, heading: 0 };
  let s = travelSession(p, 'miami-downtown', 'miami-west', plane, { mode: 'plane' }, null);
  assert.equal(s.mode, 'start');
  assert.equal(s.map, 'miami-west');
  s = travelSession(defaultProgress(), 'miami-downtown', 'miami-west', car(), { mode: 'car' }, null);
  const st = regionStart('miami-west');
  assert.equal(s.mode, 'car');
  assert.ok(Math.abs(s.x - st.x) < 0.01 && Math.abs(s.z - st.z) < 0.01);
  // on foot at a pad: stays on foot
  s = travelSession(defaultProgress(), 'miami-downtown', 'miami-north', null, { mode: 'foot' }, arrivalApprox('miami-north', 'downtown-north-biscayne'));
  assert.equal(s.mode, 'foot');
});

test('travelSession keeps the target region garage and the other sessions', () => {
  const p = defaultProgress();
  p.session = buildSession(null, car(), [], 'miami-downtown');
  p.mapSessions['miami-beach'] = buildSession(null, car({ x: 3000, z: 0 }), [{ spec: 'compact', color: 5, health: 1, x: 2000, z: 100, heading: 0 }], 'miami-beach');
  p.mapSessions.island = buildSession(null, null, [], 'island');
  const s = travelSession(p, 'miami-downtown', 'miami-beach', car(), { mode: 'car' }, arrivalApprox('miami-beach', 'downtown-beach-macarthur'));
  assert.deepEqual(s.garage.map((g) => g.spec), ['compact']);
  assert.ok(p.mapSessions.island);
  assert.ok(p.mapSessions['miami-downtown']);
});

test('travelSave writes the session and the map choice together; both survive a reload', () => {
  const st = memory();
  const p = defaultProgress();
  p.session = buildSession(null, car(), [], 'miami-downtown');
  const ok = travelSave(st, p, 'miami-downtown', 'miami-south', car(), { mode: 'car' }, arrivalApprox('miami-south', 'downtown-south-brickell'));
  assert.equal(ok, true);
  assert.equal(st.getItem(MAP_CHOICE_KEY), 'miami-south');
  const back = loadProgress(st);
  assert.equal(back.session.map, 'miami-south');
  assert.equal(back.session.mode, 'car');
  assert.equal(back.mapSessions['miami-downtown'].mode, 'start');
  assert.ok(st.getItem(SAVE_KEY));
  // storage that refuses writes does not throw
  const bad = { getItem: () => null, setItem: () => { throw new Error('full'); } };
  assert.equal(travelSave(bad, defaultProgress(), 'miami-downtown', 'miami-west', null, { mode: 'foot' }, null), false);
});

test('arrival note: allow-listed ids only, cleared when read, must match the loaded map', () => {
  const ss = memory();
  assert.equal(writeTravelNote(ss, 'miami-beach', 'downtown-beach-macarthur'), true);
  assert.deepEqual(takeTravelNote(ss, 'miami-beach'), { to: 'miami-beach', link: 'downtown-beach-macarthur' });
  assert.equal(ss.getItem(TRAVEL_NOTE_KEY), null);
  writeTravelNote(ss, 'miami-beach', 'downtown-beach-macarthur');
  assert.equal(takeTravelNote(ss, 'miami-west'), null);
  assert.equal(ss.getItem(TRAVEL_NOTE_KEY), null);
  ss.setItem(TRAVEL_NOTE_KEY, JSON.stringify({ to: 'miami-beach', link: '<script>' }));
  assert.deepEqual(takeTravelNote(ss, 'miami-beach'), { to: 'miami-beach', link: null });
  ss.setItem(TRAVEL_NOTE_KEY, '{not json');
  assert.equal(takeTravelNote(ss, 'miami-beach'), null);
  ss.setItem(TRAVEL_NOTE_KEY, JSON.stringify({ to: '__proto__' }));
  assert.equal(takeTravelNote(ss, '__proto__'), null);
  assert.equal(takeTravelNote(null, 'miami-beach'), null);
});

test('an adventure tracked in another region shows where it is', () => {
  const def = ADVENTURE_DEFS.find((d) => d.id === 'a-sandbar');
  assert.equal(adventureRegion(def), 'miami-beach');
  const e = trackedElsewhere('a-sandbar', 'miami-downtown', ['a-first-light']);
  assert.equal(e.id, 'a-sandbar');
  assert.match(e.where, /Miami Beach/);
  assert.equal(trackedElsewhere('a-sandbar', 'miami-beach', []), null);
  assert.equal(trackedElsewhere('a-sandbar', 'miami-downtown', ['a-sandbar']), null);
  assert.equal(trackedElsewhere('nonsense', 'miami-downtown', []), null);
  assert.equal(trackedElsewhere(null, 'miami-downtown', []), null);
});

import { mapFromSearch, DEFAULT_MAP } from '../src/world/maps.js';
test('mapFromSearch: every id by URL and by stored choice, unknown falls back to the Beach', () => {
  for (const id of MAP_IDS) {
    assert.equal(mapFromSearch('?map=' + id), id);
    assert.equal(mapFromSearch('', id), id);
  }
  // 0.9.0 re-pin (deliberate): a new game starts in the Beach (DEFAULT_REGION);
  // Downtown stays CORE_REGION, the designed first view.
  assert.equal(DEFAULT_MAP, 'miami-beach');
  assert.equal(mapFromSearch('', 'miami-nowhere'), 'miami-beach');
  assert.equal(mapFromSearch('?map=miami-beach', 'island'), 'miami-beach', 'the URL wins');
});
