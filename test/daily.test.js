import test from 'node:test';
import assert from 'node:assert/strict';
import { dayKey, validDay, dailyThree, rollDay, completeDaily, GROUPS, TWIST_KINDS, TWIST_CLASSES } from '../src/core/daily.js';
import { createDaily } from '../src/systems/daily.js';
import { defaultProgress } from '../src/core/save.js';
import { createEvents } from '../src/core/events.js';
import { VEHICLE_SPECS } from '../src/entities/vehicle.js';

const list = [];
for (const tpl of ['trap', 'miss', 'jump', 'dash', 'heat', 'wreck']) for (let i = 1; i <= 4; i++) list.push({ id: 'ev_beach_' + tpl + '_' + i, tpl, name: tpl + i, intro: tpl === 'miss' && i === 1 });

test('the day key is the local date, read from a Date', () => {
  assert.equal(dayKey(new Date(2026, 10, 23, 23, 59)), 20261123);
  assert.equal(dayKey(new Date(2027, 0, 1, 0, 0)), 20270101);
  assert.equal(dayKey(new Date('bad')), 20260101);
  assert.equal(dayKey(null), 20260101);
  assert.ok(validDay(20261123) && !validDay(0) && !validDay(2026.5) && !validDay(99999999));
});

test('three picks a day: one of each group, a different twist each, the same all day', () => {
  const a = dailyThree(list, 20261123, 'beach', { muscle: 'Redtail' });
  const b = dailyThree(list, 20261123, 'beach', { muscle: 'Redtail' });
  assert.deepEqual(a, b);
  assert.equal(a.length, 3);
  a.forEach((p, i) => {
    assert.equal(p.slot, i);
    assert.ok(GROUPS[i].includes(p.ev.tpl));
    assert.ok(!p.ev.intro, 'the first gate is never a daily');
    assert.ok(p.twist.text.length > 3);
  });
  assert.deepEqual(a.map((p) => p.twist.kind).sort(), TWIST_KINDS.slice().sort());
  for (const id of TWIST_CLASSES) assert.ok(VEHICLE_SPECS[id], id + ' is a real car class');
  // the days differ, and so do the regions
  const seen = new Set();
  for (let d = 20261101; d <= 20261130; d++) seen.add(dailyThree(list, d, 'beach').map((p) => p.ev.id + p.twist.text).join());
  assert.ok(seen.size >= 25, 'thirty days give at least 25 different sets: ' + seen.size);
  assert.notDeepEqual(dailyThree(list, 20261123, 'north').map((p) => p.ev.id + p.twist.text), a.map((p) => p.ev.id + p.twist.text));
  // a region without a group's templates gets fewer, not an error
  assert.equal(dailyThree(list.filter((e) => e.tpl === 'trap'), 20261123, 'beach').length, 1);
  assert.deepEqual(dailyThree([], 20261123, 'beach'), []);
});

test('the streak counts days played and never falls', () => {
  const st = { day: 0, done: [false, false, false], streak: 0 };
  assert.equal(completeDaily(st, 20261123, 1), 'first');
  assert.equal(st.streak, 1);
  assert.equal(completeDaily(st, 20261123, 1), '', 'once per slot');
  assert.equal(completeDaily(st, 20261123, 0), 'more');
  assert.equal(completeDaily(st, 20261123, 2), 'all');
  assert.equal(st.streak, 1);
  // ten days later (nine missed): the ticks clear, the streak stays and grows
  rollDay(st, 20261203);
  assert.deepEqual(st.done, [false, false, false]);
  assert.equal(st.streak, 1);
  assert.equal(completeDaily(st, 20261203, 2), 'first');
  assert.equal(st.streak, 2);
  assert.equal(completeDaily(st, 20261203, 7), '');
  rollDay(st, NaN);
  assert.equal(st.day, 20261203);
});

test('the system reads the date once, through the injected function', () => {
  let calls = 0;
  const events = createEvents();
  const staged = [];
  const game = {
    events, progress: defaultProgress(), player: { x: 0, z: 0, wanted: 0, vehicle: null }, clock: 12, weather: { name: 'clear' },
    streetEvents: { list, slug: 'beach', stage: (ev, spec) => { staged.push([ev.id, spec]); return true; } },
    daynight: { setWeather(n) { game.weather.name = n; }, setHour(h) { game.clock = h; } },
    hud: { toast() {} },
  };
  const d = createDaily(game, { now: () => { calls++; return new Date(2026, 10, 23, 8, 0); } });
  assert.equal(calls, 1);
  assert.equal(d.day, 20261123);
  assert.equal(d.picks.length, 3);
  // Go sets the twist and stages the car; then the event counts for its slot
  for (const p of d.picks) {
    assert.equal(d.go(p.slot), '');
    const v = { spec: { id: p.twist.kind === 'class' ? p.twist.value : 'sedan' } };
    assert.equal(d.slotFor(p.ev, v), p.slot, p.twist.kind);
    if (p.twist.kind === 'class') {
      assert.equal(d.slotFor(p.ev, { spec: { id: 'truck' } }), -1, 'the wrong class does not count');
      assert.equal(staged[staged.length - 1][1], p.twist.value);
    }
    events.emit('streetEventEnd', { id: p.ev.id, medal: 'bronze', daily: p.slot });
    assert.equal(d.slotFor(p.ev, v), -1, 'done for today');
  }
  assert.equal(d.doneCount, 3);
  assert.equal(game.progress.loop.daily.streak, 1);
  assert.equal(calls, 1, 'never read again');
  // no medal, no tick; wanted: Go is refused
  const g2 = { ...game, progress: defaultProgress(), police: { stars: 2 } };
  const d2 = createDaily(g2, { now: () => new Date(2026, 10, 24) });
  events.emit('streetEventEnd', { id: d2.picks[0].ev.id, medal: null, daily: 0 });
  assert.equal(d2.doneCount, 0);
  assert.equal(d2.go(0), 'Lose the police first');
});

test('refresh follows the date across midnight, never during a run', () => {
  let date = new Date(2026, 10, 23, 23, 50);
  const events = createEvents();
  const se = { list, slug: 'beach', active: null, stage: () => true };
  const game = {
    events, progress: defaultProgress(), player: { x: 0, z: 0, wanted: 0, vehicle: null }, clock: 12, weather: { name: 'clear' },
    streetEvents: se, daynight: {}, hud: { toast() {} },
  };
  const d = createDaily(game, { now: () => date });
  assert.equal(d.day, 20261123);
  const before = d.picks;
  assert.equal(d.refresh(), false, 'same day: nothing changes');
  assert.equal(d.picks, before);
  date = new Date(2026, 10, 24, 0, 5);
  se.active = { id: 'x' };
  assert.equal(d.refresh(), false, 'deferred during a run');
  assert.equal(d.day, 20261123);
  assert.equal(d.picks, before);
  // the in-flight challenge still counts for the day it started
  events.emit('streetEventEnd', { id: before[0].ev.id, medal: 'bronze', daily: before[0].slot });
  assert.equal(d.doneCount, 1);
  se.active = null;
  assert.equal(d.refresh(), true);
  assert.equal(d.day, 20261124);
  assert.equal(d.picks.length, 3);
  assert.equal(d.doneCount, 0, 'a new day starts clean');
  assert.equal(d.refresh(), false);
});
