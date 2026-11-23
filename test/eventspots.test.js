import test from 'node:test';
import assert from 'node:assert/strict';
import { allRegionCities } from './regionfixture.js';
import { placeEvents, eventRamps, nearestEvent, regionSlug, QUOTA, GATE_APART, EDGE_MARGIN, INTRO_AHEAD, TRAP_RUN, DASH_RANGE } from '../src/world/eventspots.js';
import { TEMPLATES, medalFor } from '../src/core/streetevents.js';
import { EVENT_ID, REGION_SLUGS } from '../src/core/records.js';
import { generateCity } from '../src/world/citygen.js';

const cities = allRegionCities();
const placed = new Map(cities.map(([id, c]) => [id, placeEvents(c)]));

test('every region has 20 to 40 events from all six templates (30 here)', () => {
  for (const [id] of cities) {
    const ev = placed.get(id);
    assert.ok(ev.length >= 20 && ev.length <= 40, id + ': ' + ev.length);
    const n = {};
    for (const e of ev) n[e.tpl] = (n[e.tpl] || 0) + 1;
    for (const t of TEMPLATES) assert.ok(n[t] >= 3, id + ' ' + t + ': ' + n[t]);
    assert.equal(ev.length, 30, id + ' ' + JSON.stringify(n));
    for (const t of TEMPLATES) assert.ok(n[t] <= QUOTA[t] + (t === 'miss' ? 1 : 0));
  }
});

test('placement is the same every time and ids are unique and savable', () => {
  const all = new Set();
  for (const [id, c] of cities) {
    const again = placeEvents(c);
    assert.deepEqual(again.map((e) => [e.id, e.x, e.z, e.targets]), placed.get(id).map((e) => [e.id, e.x, e.z, e.targets]));
    for (const e of placed.get(id)) {
      assert.ok(EVENT_ID.test(e.id), e.id);
      assert.ok(!all.has(e.id), 'duplicate ' + e.id);
      all.add(e.id);
      assert.ok(e.id.startsWith('ev_' + regionSlug(c) + '_'));
    }
    assert.ok(REGION_SLUGS.includes(regionSlug(c)));
  }
  assert.equal(all.size, 150);
});

test('gates stand on a street, on land, inside the region, apart from each other', () => {
  for (const [id, c] of cities) {
    const ev = placed.get(id);
    for (const e of ev) {
      const st = c.streetAt(e.x, e.z);
      assert.ok(st && st.name, id + ' ' + e.id + ' is not on a street');
      assert.ok(c.isLand(e.x, e.z));
      const m = e.intro ? 60 : EDGE_MARGIN;
      assert.ok(e.x > c.crop.x0 + m && e.x < c.crop.x1 - m && e.z > c.crop.z0 + m && e.z < c.crop.z1 - m, e.id + ' near the edge');
      assert.ok(Math.abs(Math.hypot(e.dx, e.dz) - 1) < 1e-6);
      assert.ok(e.w >= 2.5 && e.w <= 20, e.id + ' width ' + e.w);
      assert.ok(e.back >= 14 && e.back <= 40);
      // the staging spot of a retry is on the road too
      const sx = e.x - e.dx * e.back - e.dz * e.side, sz = e.z - e.dz * e.back + e.dx * e.side;
      assert.ok(c.onRoad(sx, sz), e.id + ' retry spot off the road');
      assert.ok(!c.inBuilding(sx, sz, 1));
    }
    for (let i = 0; i < ev.length; i++) {
      for (let j = i + 1; j < ev.length; j++) {
        assert.ok(Math.hypot(ev[i].x - ev[j].x, ev[i].z - ev[j].z) >= GATE_APART - 1, id + ': ' + ev[i].id + ' and ' + ev[j].id + ' too close');
      }
    }
  }
});

test('the first gate is a traffic run on the start street, just ahead of the start place', () => {
  for (const [id, c] of cities) {
    const e = placed.get(id)[0];
    assert.equal(e.tpl, 'miss', id);
    assert.ok(e.intro);
    const dx = e.x - c.spawn.x, dz = e.z - c.spawn.z;
    const ahead = dx * Math.cos(c.spawn.heading) + dz * Math.sin(c.spawn.heading);
    assert.ok(ahead >= INTRO_AHEAD - 6 && ahead <= INTRO_AHEAD + 90, id + ' ahead ' + ahead);
    assert.ok(Math.cos(e.heading - c.spawn.heading) > 0.9, 'the gate faces the way the car points');
    // 20 seconds is enough at a town pace
    assert.ok(Math.hypot(dx, dz) / 11 < 20);
    assert.ok(e.targets.bronze <= 2);
  }
});

test('each template keeps its rule', () => {
  for (const [id, c] of cities) {
    const ev = placed.get(id);
    for (const e of ev) {
      const t = e.targets;
      assert.ok(t && Number.isFinite(t.gold) && Number.isFinite(t.silver) && Number.isFinite(t.bronze), e.id);
      assert.ok(e.limit >= 20 && e.limit <= 90, e.id + ' limit ' + e.limit);
      if (e.tpl === 'trap') {
        assert.ok(e.run >= TRAP_RUN[0] && e.run <= TRAP_RUN[1]);
        assert.ok(Math.abs(Math.hypot(e.tx - e.x, e.tz - e.z) - e.run) < 25, 'the line is down the same straight street');
        assert.ok(c.streetAt(e.tx, e.tz), 'the line is on a street');
        assert.ok(t.gold >= 60 && t.gold <= 90 && t.bronze >= 40, JSON.stringify(t));
      } else if (e.tpl === 'jump') {
        assert.ok(e.ramp && e.ramp.id.startsWith('stunt_') && e.ramp.event === e.id);
        const along = (e.ramp.x - e.x) * e.dx + (e.ramp.z - e.z) * e.dz;
        assert.ok(along >= 90 && along <= 160, 'the ramp is ahead of the gate: ' + along);
        assert.ok(Math.cos(e.ramp.heading - e.heading) > 0.95);
        assert.ok(!c.inBuilding(e.ramp.x, e.ramp.z, 4));
        assert.ok(t.bronze >= 35 && t.gold <= 180, JSON.stringify(t));
      } else if (e.tpl === 'dash') {
        const m = Math.abs(e.tx - e.x) + Math.abs(e.tz - e.z);
        assert.ok(m >= DASH_RANGE[0] && m <= DASH_RANGE[1]);
        assert.ok(c.streetAt(e.tx, e.tz) && e.to);
        assert.ok(t.bronze <= 90 && e.limit <= 90);
      } else if (e.tpl === 'heat') {
        assert.ok(e.level >= 1 && e.level <= 3);
      }
      // gold is reachable in principle, bronze is below it
      assert.ok(medalFor(e, t.gold) === 'gold' && medalFor(e, t.bronze) === 'bronze');
    }
    const heats = ev.filter((e) => e.tpl === 'heat');
    assert.deepEqual(heats.map((e) => e.level), [1, 2, 3]);
    // the first heat escape and the first jump are a short drive from the start
    const jump = ev.find((e) => e.tpl === 'jump');
    for (const e of [heats[0], jump]) assert.ok(Math.hypot(e.x - c.spawn.x, e.z - c.spawn.z) < 800, id + ' ' + e.id + ' far from the start');
    assert.equal(eventRamps(ev).length, ev.filter((e) => e.tpl === 'jump').length);
    for (const r of eventRamps(ev)) for (const o of c.rampSpots.filter((s) => !s.event)) assert.ok(Math.hypot(r.x - o.x, r.z - o.z) > 100);
  }
});

test('nearestEvent, and a city with no usable streets places nothing', () => {
  const [, c] = cities[0];
  const ev = placed.get(cities[0][0]);
  const e = nearestEvent(ev, c.spawn.x, c.spawn.z);
  assert.equal(e, ev[0]);
  assert.equal(nearestEvent(ev, c.spawn.x, c.spawn.z, 'heat').tpl, 'heat');
  assert.equal(nearestEvent([], 0, 0), null);
  assert.deepEqual(placeEvents(null), []);
  assert.deepEqual(placeEvents({ nodes: [], edges: [] }), []);
  // the procedural island: whatever it gives is well formed
  const isl = placeEvents(generateCity());
  for (const x of isl) assert.ok(TEMPLATES.includes(x.tpl) && x.targets);
});
