import test from 'node:test';
import assert from 'node:assert/strict';
import { generateCity } from '../src/world/citygen.js';
import { createCollisionWorld } from '../src/world/collision.js';
import { createEvents } from '../src/core/events.js';
import {
  buildCourses, roadDistance, avenueAt, tallestNear, REF_SPEED, MEDAL_FACTOR, CANYON_RING_R, START_SPOT_CLEAR,
} from '../src/world/courses.js';
import {
  createActivities, medalFor, payoutFor, COUNTDOWN, STRAY_TIME,
} from '../src/systems/activities.js';

const DT = 1 / 60;
const city = generateCity();
const courses = buildCourses(city);
const byId = Object.fromEntries(courses.map((c) => [c.id, c]));
const KINDS = ['car', 'boat', 'plane', 'heli'];
const fin = (v) => typeof v === 'number' && Number.isFinite(v);

const collision = createCollisionWorld();
for (const b of city.buildings) collision.addBox(b.x0, b.z0, b.x1, b.z1, b.h);

function pierDist(x, z) {
  let best = Infinity;
  for (const p of city.piers) {
    const dx = Math.max(p.x0 - x, 0, x - p.x1), dz = Math.max(p.z0 - z, 0, z - p.z1);
    best = Math.min(best, Math.hypot(dx, dz));
  }
  return best;
}

test('the right mix of activities, unique ids, valid numbers', () => {
  const count = (t) => courses.filter((c) => c.type === t).length;
  assert.equal(count('street'), 4);
  assert.equal(count('boat'), 3);
  assert.equal(count('sky'), 3);
  assert.equal(count('delivery'), 4);
  assert.equal(new Set(courses.map((c) => c.id)).size, courses.length);
  assert.equal(new Set(courses.map((c) => c.name)).size, courses.length);
  assert.ok(courses.length <= 20);
  for (const c of courses) {
    assert.match(c.id, /^[a-z0-9_-]{1,40}$/);
    assert.ok(typeof c.name === 'string' && c.name.length > 2, c.id);
    assert.ok(typeof c.blurb === 'string' && c.blurb.length > 10, c.id);
    assert.ok(c.kinds.length > 0 && c.kinds.every((k) => KINDS.includes(k)), c.id);
    assert.ok(Number.isInteger(c.laps) && c.laps >= 1, c.id);
    for (const k of ['x', 'z', 'y', 'heading']) assert.ok(fin(c.start[k]), `${c.id} start.${k}`);
    assert.ok(c.checkpoints.length >= 1, c.id);
    for (const cp of c.checkpoints) {
      for (const k of ['x', 'z', 'y', 'r', 'dir']) assert.ok(fin(cp[k]), `${c.id} cp.${k}`);
      assert.ok(cp.r > 0 && cp.y >= 0, c.id);
      assert.ok(['ground', 'buoy', 'ring', 'pad'].includes(cp.kind), c.id);
    }
    const m = c.medalTimes, r = c.reward;
    assert.ok(fin(m.gold) && m.gold > 0, c.id);
    assert.ok(m.gold < m.silver && m.silver < m.bronze, `${c.id} medal times ${JSON.stringify(m)}`);
    assert.ok(r.gold > r.silver && r.silver > r.bronze && r.bronze > 0, `${c.id} rewards`);
    // Gold needs a decent pace, but no faster than the reference speed.
    assert.ok(c.length / m.gold <= REF_SPEED[c.kinds[0]] + 1e-9, c.id);
    assert.ok(m.bronze >= m.gold * MEDAL_FACTOR.bronze - 1e-9, c.id);
    if (c.type === 'delivery') {
      assert.equal(c.laps, 1);
      assert.equal(c.timeLimit, m.bronze);
    }
    if (c.type === 'street') {
      assert.deepEqual(c.kinds, ['car']);
      assert.ok(c.checkpoints.length >= 8 && c.checkpoints.length <= 16, `${c.id}: ${c.checkpoints.length}`);
    }
    if (c.type === 'boat') assert.deepEqual(c.kinds, ['boat']);
  }
  assert.deepEqual(byId['sky-rooftop'].kinds, ['heli']);
  assert.deepEqual(byId['sky-gull'].kinds, ['plane']);
});

test('deterministic from the city', () => {
  assert.equal(JSON.stringify(buildCourses(generateCity())), JSON.stringify(courses));
});

test('street checkpoints sit on road junctions joined through the graph', () => {
  for (const c of courses) {
    const cps = c.checkpoints.filter((cp) => cp.kind === 'ground');
    if (!cps.length) continue;
    assert.equal(cps.length, c.checkpoints.length, `${c.id} mixes ground and other checkpoints`);
    assert.ok(city.onRoad(c.start.x, c.start.z), `${c.id} start off road`);
    const closed = c.type === 'street';
    for (let k = 0; k < cps.length; k++) {
      const cp = cps[k];
      assert.ok(city.onRoad(cp.x, cp.z), `${c.id} cp ${k} off road`);
      assert.equal(collision.heightAt(cp.x, cp.z), 0, `${c.id} cp ${k} in a building`);
      const node = city.nodes[cp.node];
      assert.ok(node && Math.hypot(node.x - cp.x, node.z - cp.z) < 0.2, `${c.id} cp ${k} not a junction`);
      if (k === 0 && !closed) continue;
      const prev = cps[(k + cps.length - 1) % cps.length];
      if (prev === cp) continue;
      const straight = Math.hypot(cp.x - prev.x, cp.z - prev.z);
      const road = roadDistance(city, prev.node, cp.node);
      assert.ok(straight > 1, `${c.id} cp ${k} repeats the previous one`);
      assert.ok(road < 4 * straight, `${c.id} cp ${k}: road ${road} vs straight ${straight}`);
    }
  }
  // The causeway race really goes to the airfield gate.
  const gate = city.airfield.gate;
  assert.ok(byId['street-causeway'].checkpoints.some((cp) => cp.node === gate.id));
  for (const c of courses) {
    if (c.id === 'street-causeway') continue;
    assert.ok(!c.checkpoints.some((cp) => cp.kind === 'ground' && cp.node === gate.id), c.id);
  }
  // The island loop reaches out toward the shore all round.
  const rim = byId['street-rim'];
  const angles = rim.checkpoints.map((cp) => Math.atan2(cp.z, cp.x));
  const quads = new Set(angles.map((a) => Math.floor(((a + Math.PI) / (2 * Math.PI)) * 4) % 4));
  assert.equal(quads.size, 4);
  for (const cp of rim.checkpoints) assert.ok(city.shoreDist(cp.x, cp.z) < 260, 'rim checkpoint too far inland');
});

test('boat gates are at sea with clear water between them', () => {
  for (const c of courses) {
    const cps = c.checkpoints.filter((cp) => cp.kind === 'buoy');
    if (!cps.length) continue;
    assert.equal(cps.length, c.checkpoints.length, c.id);
    assert.ok(city.shoreDist(c.start.x, c.start.z) < -10, `${c.id} start not at sea`);
    let px = c.start.x, pz = c.start.z;
    for (let k = 0; k < cps.length; k++) {
      const cp = cps[k];
      assert.ok(city.shoreDist(cp.x, cp.z) < -25, `${c.id} gate ${k} too near the shore`);
      assert.ok(pierDist(cp.x, cp.z) > 20, `${c.id} gate ${k} too near a pier`);
      // The gate's buoys are in the water too.
      const ox = -Math.sin(cp.dir) * cp.r, oz = Math.cos(cp.dir) * cp.r;
      assert.ok(city.shoreDist(cp.x + ox, cp.z + oz) < -3 && city.shoreDist(cp.x - ox, cp.z - oz) < -3, `${c.id} buoy ${k}`);
      const L = Math.hypot(cp.x - px, cp.z - pz);
      const n = Math.max(1, Math.ceil(L / 5));
      for (let i = 0; i <= n; i++) {
        const x = px + ((cp.x - px) * i) / n, z = pz + ((cp.z - pz) * i) / n;
        assert.ok(city.shoreDist(x, z) < -3, `${c.id} leg to gate ${k} crosses land at ${x.toFixed(0)},${z.toFixed(0)}`);
      }
      px = cp.x;
      pz = cp.z;
    }
  }
  // The island lap goes right round: every direction from the centre, and
  // round the far (east) side of the airfield islet.
  const lap = byId['boat-island'];
  const isl = city.airfield.islet;
  assert.ok(lap.checkpoints.some((cp) => cp.x > isl.x1));
  const first = lap.checkpoints[0], last = lap.checkpoints[lap.checkpoints.length - 1];
  assert.ok(Math.hypot(first.x - last.x, first.z - last.z) < 1, 'island lap ends where it began');
  let turned = 0;
  for (let k = 1; k < lap.checkpoints.length; k++) {
    const a = lap.checkpoints[k - 1], b = lap.checkpoints[k];
    let d = Math.atan2(b.z, b.x) - Math.atan2(a.z, a.x);
    while (d > Math.PI) d -= 2 * Math.PI;
    while (d < -Math.PI) d += 2 * Math.PI;
    turned += d;
  }
  assert.ok(Math.abs(Math.abs(turned) - 2 * Math.PI) < 0.3, `lap turns ${turned}`);
});

test('sky rings are above ground and clear of buildings', () => {
  let canyon = 0;
  for (const c of courses) {
    for (let k = 0; k < c.checkpoints.length; k++) {
      const cp = c.checkpoints[k];
      if (cp.kind === 'pad') {
        const roof = collision.heightAt(cp.x, cp.z);
        assert.ok(Math.abs(cp.y - (roof + 1)) < 0.6, `${c.id} pad ${k} not on its roof`);
        assert.ok(cp.r >= 5, c.id);
        continue;
      }
      if (cp.kind !== 'ring') continue;
      assert.ok(cp.y - cp.r > 5, `${c.id} ring ${k} too close to the ground`);
      if (cp.canyon) {
        canyon++;
        assert.ok(city.onRoad(cp.x, cp.z) && avenueAt(city, cp.x, cp.z), `${c.id} canyon ring ${k} not over an avenue`);
        assert.ok(cp.r >= CANYON_RING_R, c.id);
        // Its full width fits between the buildings either side.
        const e = avenueAt(city, cp.x, cp.z);
        for (const s of [-1, -0.5, 0, 0.5, 1]) {
          const x = e.horizontal ? cp.x : cp.x + s * cp.r;
          const z = e.horizontal ? cp.z + s * cp.r : cp.z;
          assert.equal(collision.heightAt(x, z), 0, `${c.id} canyon ring ${k} touches a building`);
        }
        continue;
      }
      // Sample the ring's footprint: bottom 10 m above every roof under it,
      // and 25 m above anything within 40 m.
      for (let a = 0; a < 8; a++) {
        for (const f of [0, 0.5, 1]) {
          const x = cp.x + Math.cos((a * Math.PI) / 4) * cp.r * f, z = cp.z + Math.sin((a * Math.PI) / 4) * cp.r * f;
          assert.ok(cp.y - cp.r > collision.heightAt(x, z) + 10, `${c.id} ring ${k} over a roof`);
        }
      }
      const tall = tallestNear(city, cp.x, cp.z, 40);
      if (tall > 0) assert.ok(cp.y - cp.r >= tall + 25, `${c.id} ring ${k} too near a tower`);
    }
  }
  assert.ok(canyon >= 4, 'the downtown course threads some street canyons');
  const rooftop = byId['sky-rooftop'];
  assert.ok(rooftop.checkpoints.filter((cp) => cp.kind === 'pad' && cp.y > 5).length >= 3, 'three rooftop touch points');
  // The easy plane course starts lined up on the runway.
  const rw = city.airfield.runway, s = byId['sky-gull'].start;
  assert.ok(s.x > rw.x0 && s.x < rw.x1 && s.z > rw.z0 && s.z < rw.z1);
  // Air mail ends on a helipad.
  const am = byId['deliver-airmail'].checkpoints.at(-1);
  assert.ok(city.helipads.some((h) => Math.hypot(h.x - am.x, h.z - am.z) < 1));
});

test('start zones do not overlap', () => {
  for (let i = 0; i < courses.length; i++) {
    for (let j = i + 1; j < courses.length; j++) {
      const a = courses[i].start, b = courses[j].start;
      assert.ok(Math.hypot(a.x - b.x, a.z - b.z) > 30, `${courses[i].id} vs ${courses[j].id}`);
    }
  }
});

test('start zones keep clear of parked aircraft and boats (except the runway course)', () => {
  const spots = [...city.aircraftSpots, ...city.boatSpots];
  assert.ok(spots.length > 0);
  for (const c of courses) {
    if (c.id === 'sky-gull') continue; // First Feathers starts on the runway on purpose
    for (const q of spots) {
      const d = Math.hypot(q.x - c.start.x, q.z - c.start.z);
      assert.ok(d >= 14, `${c.id} start is ${d.toFixed(1)} m from a ${q.spec} spawn`);
    }
  }
  assert.ok(START_SPOT_CLEAR >= 14);
});

test('medal and payout rules', () => {
  const c = byId['street-glasswell'];
  assert.equal(medalFor(c, c.medalTimes.gold), 'gold');
  assert.equal(medalFor(c, c.medalTimes.gold + 0.01), 'silver');
  assert.equal(medalFor(c, c.medalTimes.bronze), 'bronze');
  assert.equal(medalFor(c, c.medalTimes.bronze + 1), null);
  assert.equal(payoutFor(c, null, 'silver'), c.reward.silver);
  assert.equal(payoutFor(c, 'silver', 'silver'), 0);
  assert.equal(payoutFor(c, 'silver', 'bronze'), 0);
  assert.equal(payoutFor(c, 'silver', 'gold'), c.reward.gold - c.reward.silver);
  assert.equal(payoutFor(c, 'gold', null), 0);
});

// ---------------------------------------------------------------------------
// Driving the activities system with a fake game
// ---------------------------------------------------------------------------

function fakeGame() {
  const toasts = [];
  const fired = [];
  const events = createEvents();
  for (const n of ['reward', 'fail', 'checkpoint', 'progress', 'ui']) events.on(n, (a, b, c) => fired.push([n, a, b, c]));
  const markers = [];
  const game = {
    city, events, toasts, fired, time: 0,
    hud: { toast: (t) => toasts.push(t) },
    map: { addMarker: (m) => markers.push(m), removeMarker: (m) => { const i = markers.indexOf(m); if (i >= 0) markers.splice(i, 1); } },
    mapMarkers: markers,
    progress: { money: 0, owned: [], medals: {}, bestTimes: {}, stats: { distance: 0, flights: 0, races: 0 } },
    player: { mode: 'foot', vehicle: null, x: 0, z: 0, y: 0 },
  };
  return game;
}
const craftOf = (kind) => ({ kind, x: 0, z: 0, y: 0, speed: 0, wrecked: false });
function board(game, craft) {
  game.player.vehicle = craft;
  game.player.mode = craft ? craft.kind : 'foot';
}
function put(game, sys, x, z, y = 0, steps = 1) {
  const v = game.player.vehicle;
  if (v) { v.x = x; v.z = z; v.y = y; }
  game.player.x = x;
  game.player.z = z;
  game.player.y = y;
  for (let i = 0; i < steps; i++) {
    game.time += DT;
    sys.fixedUpdate(DT);
  }
}
const secs = (s) => Math.round(s / DT);

// Stands on the start (stopped), takes the offer like a tap on START, and
// lets the sim run `after` more steps.
function begin(game, sys, course, after = 1) {
  const s = course.start;
  put(game, sys, s.x, s.z, s.y, 2);
  assert.equal(sys.offer, course.id, 'offered');
  assert.equal(sys.acceptOffer(), true);
  put(game, sys, s.x, s.z, s.y, after);
}

// Starts `course` and runs it in `time` seconds by teleporting through the
// checkpoints (waiting just outside the last one).
function runCourse(game, sys, course, time) {
  const s = course.start;
  begin(game, sys, course);
  assert.equal(sys.active && sys.active.id, course.id, 'started');
  assert.equal(sys.active.phase, 'countdown');
  put(game, sys, s.x, s.z, s.y, secs(COUNTDOWN) + 1);
  assert.equal(sys.active.phase, 'running');
  const cps = course.checkpoints;
  const total = cps.length * course.laps;
  let n = 0;
  for (let lap = 0; lap < course.laps; lap++) {
    for (let k = 0; k < cps.length; k++) {
      const cp = cps[k];
      n++;
      if (n === total) {
        const left = secs(time) - Math.round(sys.active.elapsed / DT) - 1;
        assert.ok(left > 0, 'time to spare');
        put(game, sys, cp.x + cp.r + 3, cp.z, cp.y, left);
      }
      put(game, sys, cp.x, cp.z, cp.y);
    }
  }
}

test('activities: start only via the offer in an allowed craft, never on foot', () => {
  const game = fakeGame();
  const sys = createActivities(game);
  assert.equal(sys.name, 'activities');
  assert.equal(sys.courses.length, courses.length);
  assert.equal(game.mapMarkers.length, courses.length, 'a map marker per start');
  for (const c of courses) {
    const m = game.mapMarkers.find((q) => q.x === c.start.x && q.z === c.start.z);
    assert.ok(m && m.type === c.type && m.label === c.name, `${c.id} marker has type and label`);
  }
  const boatRace = byId['boat-saltyard'];
  const bs = boatRace.start;
  // On foot: nothing, not even a hint.
  put(game, sys, bs.x, bs.z, 0, secs(3));
  assert.equal(sys.active, null);
  assert.equal(sys.offer, null);
  assert.equal(sys.note, null);
  assert.equal(game.toasts.length, 0);
  assert.equal(sys.acceptOffer(), false);
  // In a car: a note about what is needed, once per visit; no offer.
  board(game, craftOf('car'));
  put(game, sys, bs.x, bs.z, 0, 2);
  assert.equal(sys.note, 'Needs a boat');
  assert.equal(sys.offer, null);
  put(game, sys, bs.x, bs.z, 0, secs(5));
  assert.equal(sys.note, null, 'the note goes away by itself');
  assert.equal(sys.acceptOffer(), false);
  assert.equal(sys.active, null);
  // Moving boat: no offer yet.
  board(game, craftOf('boat'));
  put(game, sys, 0, 0);
  game.player.vehicle.speed = 6;
  put(game, sys, bs.x, bs.z, 0, secs(3));
  assert.equal(sys.offer, null);
  assert.equal(sys.acceptOffer(), false);
  // Slow down: offered. It never starts by itself, however long we wait.
  game.player.vehicle.speed = 0.5;
  put(game, sys, bs.x, bs.z, 0, secs(5));
  assert.equal(sys.offer, boatRace.id);
  assert.equal(sys.active, null, 'no auto-start after standing still');
  // Speeding up to 4 m/s keeps the offer; over 6 m/s withdraws it.
  game.player.vehicle.speed = 4;
  put(game, sys, bs.x, bs.z, 0, 2);
  assert.equal(sys.offer, boatRace.id);
  game.player.vehicle.speed = 6.5;
  put(game, sys, bs.x, bs.z, 0, 2);
  assert.equal(sys.offer, null);
  game.player.vehicle.speed = 1;
  put(game, sys, bs.x, bs.z, 0, 2);
  assert.equal(sys.offer, boatRace.id);
  // Leaving the zone withdraws it.
  put(game, sys, bs.x + 100, bs.z, 0, 2);
  assert.equal(sys.offer, null);
  put(game, sys, bs.x, bs.z, 0, 2);
  assert.equal(sys.acceptOffer(), true);
  assert.equal(sys.active.id, boatRace.id);
  assert.equal(sys.offer, null);
  assert.equal(game.mapMarkers.length, 1, 'only the next checkpoint on the map while racing');
  assert.equal(sys.start('street-rim'), false, 'one at a time');
  assert.equal(sys.abort(), true);
  assert.equal(sys.active, null);
  assert.equal(game.mapMarkers.length, courses.length);
  // start(id) still works directly, but only in an allowed craft.
  assert.equal(sys.start('street-rim'), false, 'a boat cannot do a street race');
  assert.equal(sys.start(boatRace.id), true);
});

test('activities: medals, pay once, pay only the improvement', () => {
  const game = fakeGame();
  const sys = createActivities(game);
  board(game, craftOf('car'));
  const c = byId['street-glasswell'];
  const checks = game.fired.length;
  const away = () => put(game, sys, c.start.x + 200, c.start.z + 200, 0, 3);

  runCourse(game, sys, c, c.medalTimes.gold + 5);
  assert.equal(sys.active, null, 'finished');
  assert.equal(game.fired.slice(checks).filter((f) => f[0] === 'checkpoint').length, c.checkpoints.length * c.laps);
  assert.equal(sys.lastResult.medal, 'silver');
  assert.ok(Math.abs(sys.lastResult.time - (c.medalTimes.gold + 5)) < 0.05, `time ${sys.lastResult.time}`);
  assert.equal(game.progress.money, c.reward.silver);
  assert.equal(game.progress.medals[c.id], 'silver');
  assert.equal(game.progress.stats.races, 1);
  const best1 = game.progress.bestTimes[c.id];
  assert.ok(game.fired.some((f) => f[0] === 'reward' && f[1] === c.reward.silver));
  assert.ok(game.fired.some((f) => f[0] === 'progress'));

  // Standing on the start again does not restart until the player leaves.
  put(game, sys, c.start.x, c.start.z, 0, secs(3));
  assert.equal(sys.active, null);

  // Same medal again: nothing paid, slower time is not a best.
  away();
  runCourse(game, sys, c, c.medalTimes.gold + 8);
  assert.equal(sys.lastResult.medal, 'silver');
  assert.equal(sys.lastResult.paid, 0);
  assert.equal(game.progress.money, c.reward.silver);
  assert.equal(game.progress.bestTimes[c.id], best1);

  // Gold: only the difference is paid.
  away();
  runCourse(game, sys, c, c.medalTimes.gold - 2);
  assert.equal(sys.lastResult.medal, 'gold');
  assert.equal(game.progress.money, c.reward.gold);
  assert.equal(game.progress.medals[c.id], 'gold');
  assert.ok(game.progress.bestTimes[c.id] < best1);
  assert.equal(game.progress.stats.races, 3);

  // Slower than bronze: finished, no medal lost, nothing paid.
  away();
  runCourse(game, sys, c, c.medalTimes.bronze + 4);
  assert.equal(sys.lastResult.medal, null);
  assert.equal(game.progress.medals[c.id], 'gold');
  assert.equal(game.progress.money, c.reward.gold);
});

test('activities: abort on leaving the craft, wrecking, straying, running late', () => {
  const game = fakeGame();
  const sys = createActivities(game);
  const car = craftOf('car');
  board(game, car);
  const c = byId['street-fernside'];
  const go = () => {
    put(game, sys, c.start.x + 300, c.start.z, 0, 2);
    begin(game, sys, c, secs(COUNTDOWN) + 4);
    assert.equal(sys.active.phase, 'running');
  };
  const fails = () => game.fired.filter((f) => f[0] === 'fail').length;

  go();
  board(game, null);
  put(game, sys, c.start.x, c.start.z, 0, 1);
  assert.equal(sys.active, null);
  assert.equal(fails(), 1);
  assert.ok(game.toasts.includes('Race abandoned'));
  assert.equal(game.progress.stats.races, 0);

  board(game, car);
  go();
  car.wrecked = true;
  put(game, sys, c.start.x, c.start.z, 0, 1);
  assert.equal(sys.active, null);
  assert.equal(fails(), 2);
  car.wrecked = false;

  go();
  const cp = c.checkpoints[0];
  put(game, sys, cp.x + 450, cp.z, 0, secs(STRAY_TIME) - 10);
  assert.ok(sys.active, 'still racing just before the stray limit');
  put(game, sys, cp.x + 450, cp.z, 0, 12);
  assert.equal(sys.active, null);
  assert.equal(fails(), 3);

  // Deliveries have a time limit.
  const d = byId['deliver-courier'];
  begin(game, sys, d, secs(COUNTDOWN) + 4);
  assert.equal(sys.active.id, d.id);
  const B = d.checkpoints[0];
  put(game, sys, B.x, B.z - 300, 0, secs(d.timeLimit) + 2);
  assert.equal(sys.active, null);
  assert.ok(game.toasts.includes('Out of time'));
  assert.equal(game.progress.money, 0);
});

test('activities: sky rings count in 3D', () => {
  const game = fakeGame();
  const sys = createActivities(game);
  board(game, craftOf('heli'));
  const c = byId['sky-rooftop'];
  begin(game, sys, c, secs(COUNTDOWN) + 4);
  assert.equal(sys.active.id, c.id);
  const cp = c.checkpoints[0];
  put(game, sys, cp.x, cp.z, cp.y + cp.r + 4);
  assert.equal(sys.active.index, 0, 'flying over a ring does not count');
  put(game, sys, cp.x, cp.z, cp.y);
  assert.equal(sys.active.index, 1);
});
