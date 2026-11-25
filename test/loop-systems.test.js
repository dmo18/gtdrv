// The loop in the game (docs/LOOP.md): Flow fed from play, street events
// through their gates, the intro's beats. Fake game, fixed 1/60 s steps.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createEvents } from '../src/core/events.js';
import { defaultProgress } from '../src/core/save.js';
import { createScore, POINTS, SHAVE_GAP } from '../src/systems/score.js';
import { createMissions } from '../src/systems/missions.js';
import { createStreetEvents, RETRY_S, TRACK_NEAR } from '../src/systems/events.js';
import { markMedal } from '../src/core/streetevents.js';
import { createTutorial, INTRO_LINES, INTRO_MAX_WORDS, INTRO_STEPS, STAGE_AT, STAGE_SPEED } from '../src/systems/tutorial.js';
import { createHeat, updateHeat } from '../src/systems/police.js';
import { PASS_POINTS, SMASH_POINTS, SMASH_CHAIN_BONUS, RAM_POINTS } from '../src/systems/flow.js';
import { BANK_STILL_S, BANK_BONUS, CRASH_LOSS } from '../src/core/flow.js';
import { trapTargets, missTargets, jumpTargets, dashTargets, dashLimit, heatTargets, wreckTargets, mph } from '../src/core/streetevents.js';
import { regionCity } from './regionfixture.js';
import { placeEvents } from '../src/world/eventspots.js';

const DT = 1 / 60;
const car = (o = {}) => ({ kind: 'car', spec: { id: 'sedan', width: 1.85, label: 'Brigham' }, x: 0, z: 0, px: 0, pz: 0, y: 0, heading: 0, speed: 0, vx: 0, vz: 0, driver: null, ...o });
const EV = (tpl, o = {}) => ({ id: 'ev_beach_' + tpl + '_1', tpl, name: 'Ocean Dr ' + tpl, street: 'Ocean Dr', x: 100, z: 0, heading: 0, dx: 1, dz: 0, w: 5, back: 30, side: 0, limit: 30, targets: { gold: 3, silver: 2, bronze: 1 }, tx: NaN, tz: NaN, ...o });
const LIST = () => [
  EV('miss', { intro: true, limit: 45, targets: missTargets(45, 0.75) }),
  EV('trap', { x: 100, z: 400, tx: 400, tz: 400, tdx: 1, tdz: 0, tw: 5, run: 300, targets: trapTargets(300) }),
  EV('jump', { x: 100, z: 800, tx: 195, tz: 800, ramp: { id: 'stunt_beach_jump_1', x: 195, z: 800, event: 'ev_beach_jump_1' }, limit: 25, targets: jumpTargets(95, 0.245, 1.5) }),
  EV('dash', { x: 100, z: 1200, tx: 600, tz: 1300, to: 'Lincoln Rd', limit: dashLimit(dashTargets(600)), targets: dashTargets(600) }),
  EV('heat', { x: 100, z: 1600, level: 1, limit: 90, targets: heatTargets(1) }),
  EV('wreck', { x: 100, z: 2000, limit: 40, targets: wreckTargets(40, 1) }),
];

function world(opts = {}) {
  const events = createEvents();
  const toasts = [];
  const game = {
    events, progress: defaultProgress(), time: 0, rng: { next: () => 0.5 },
    city: { mapId: 'miami-beach', garages: [{ x: 900, z: 900, door: { x: 905, z: 900 } }] },
    player: { x: 0, z: 0, y: 0, heading: 0, mode: 'car', vehicle: null, walker: { speed: 0 }, wanted: 0 },
    vehicles: [], hudState: {},
    hud: { toast: (t, s, k) => toasts.push([k || '', String(t)]), setEvent(t) { game.eventLine = t; }, flowPop() {}, canHint: () => true },
    police: { heat: createHeat(), stars: 0 },
    removeVehicle(v) { const i = game.vehicles.indexOf(v); if (i >= 0) game.vehicles.splice(i, 1); v.removed = true; },
    addVehicle(v) { game.vehicles.push(v); return v; },
    enterVehicle(v) { v.driver = 'player'; game.player.vehicle = v; game.player.mode = 'car'; events.emit('enter', v); return true; },
    snaps: 0,
    snapCam() { game.snaps++; },
  };
  game.missions = createMissions(game, null);
  if (opts.events !== false) {
    game.streetEvents = createStreetEvents(game, { events: opts.list || LIST() });
    game.missions.parts.push(game.streetEvents);
  }
  game.score = createScore(game);
  game.tutorialSys = createTutorial(game);
  if (opts.intro !== true && game.streetEvents) game.tutorialSys.skip();
  const v = car({ driver: 'player' });
  game.vehicles.push(v);
  game.player.vehicle = v;
  // One step: move the player's car `dx, dz`, then the systems in the game's order.
  game.tick = (dx = 0, dz = 0) => {
    const pv = game.player.vehicle;
    if (pv) {
      pv.px = pv.x; pv.pz = pv.z;
      pv.x += dx; pv.z += dz;
      pv.speed = Math.hypot(dx, dz) / DT;
      game.player.x = pv.x; game.player.z = pv.z;
    }
    game.time += DT;
    game.missions.fixedUpdate(DT);
    game.score.fixedUpdate(DT);
    game.tutorialSys.fixedUpdate(DT);
    game.missions.render(1, DT);
  };
  game.run = (seconds, dx = 0, dz = 0) => { for (let i = 0, n = Math.round(seconds / DT); i < n; i++) game.tick(dx, dz); };
  game.toasts = toasts;
  game.place = (x, z) => { const pv = game.player.vehicle; pv.x = pv.px = x; pv.z = pv.pz = z; game.player.x = x; game.player.z = z; game.tick(); };
  return game;
}

test('the host makes game.flow before the score; score.add feeds the run, a bank goes into the total', () => {
  const g = world({ events: false });
  assert.ok(g.flow && g.custom && !g.streetEvents);
  assert.equal(g.score.add(150, 'Near miss', 0, 0, false, 'nearMiss'), 150);
  assert.equal(g.score.pending, 0, 'the old combo is not used with Flow');
  assert.equal(g.flow.run, 150);
  assert.equal(g.score.total, 0);
  // other systems call add() with a reason only
  g.score.add(1000, 'Lost the police', 0, 0);
  assert.equal(g.flow.tier, 2, 'an escape is a whole tier');
  g.score.add(250, 'Wrecked', 0, 0);
  assert.equal(g.flow.run, 150 + 1000 + 500);
  // an award (race medal) still banks straight
  g.score.add(3000, 'Race: gold', 0, 0, true);
  assert.equal(g.score.total, 3000);
  // stop: banked with the tier bonus, recorded as the region's best run
  const run = g.flow.run;
  g.run(BANK_STILL_S + 0.1);
  const want = run + Math.round(run * BANK_BONUS);
  assert.equal(g.score.total, 3000 + want);
  assert.equal(g.flow.run, 0);
  assert.equal(g.progress.loop.flow.beach, want);
  assert.equal(g.progress.loop.totals.banked, want);
  assert.equal(g.progress.score.total, 3000 + want);
  assert.ok(g.toasts.some((t) => /^Best flow run!/.test(t[1])));
  assert.deepEqual([g.hudState.pending, g.hudState.combo, g.hudState.flowTier], [0, 1, 1]);
});

test('clean pass: a moving car ahead ends up behind; a parked car or a bumped car does not count', () => {
  const g = world({ events: false });
  const other = car({ x: 12, z: 3, speed: 8, driver: {}, heading: 0 });
  const parked = car({ x: 40, z: -3, speed: 0, driver: null });
  g.vehicles.push(other, parked);
  // 20 m/s past both; the other car rolls on at 8 m/s
  for (let i = 0; i < 150; i++) { other.x += 8 * DT; g.tick(20 * DT, 0); }
  assert.equal(g.flow.passes, 1);
  assert.equal(g.flow.run, PASS_POINTS);
  assert.equal(g.progress.loop.totals.passes, 1);
  assert.ok(g.toasts.some((t) => t[1].startsWith('Clean pass')));
  // again, but they touch first: no pass for 2 s after contact
  const g2 = world({ events: false });
  const o2 = car({ x: 10, z: 3, speed: 8, driver: {} });
  g2.vehicles.push(o2);
  g2.tick(20 * DT, 0);
  g2.events.emit('vehicleCrash', g2.player.vehicle, o2, 2);
  for (let i = 0; i < 60; i++) { o2.x += 8 * DT; g2.tick(20 * DT, 0); }
  assert.equal(g2.flow.passes, 0);
});

test('close shave: a parked car passed within 0.6 m at speed (Flow only), near misses as before', () => {
  const g = world({ events: false });
  const side = 1.85 + SHAVE_GAP - 0.2; // flank to flank 0.4 m
  g.vehicles.push(car({ x: 30, z: side }), car({ x: 60, z: side + 0.5 }), car({ x: 90, z: -side }));
  g.run(5, 22 * DT, 0);
  assert.equal(g.flow.passes, 2, 'the car 0.9 m away is not a shave');
  assert.equal(g.flow.run, POINTS.shave * 2);
  assert.ok(g.toasts.some((t) => t[1].startsWith('Close shave')));
  // slower than 45 mph: nothing
  const slow = world({ events: false });
  slow.vehicles.push(car({ x: 30, z: side }));
  slow.run(5, 15 * DT, 0);
  assert.equal(slow.flow.passes, 0);
});

test('smash chain, ram, and the crash rule (a hard stop, not a scrape)', () => {
  const g = world({ events: false });
  const prop = { byPlayer: true };
  g.events.emit('propBreak', prop);
  g.tick(10 * DT, 0);
  g.events.emit('propBreak', prop);
  g.events.emit('propBreak', { byPlayer: false });
  assert.equal(g.flow.smashes, 2);
  assert.equal(g.flow.run, SMASH_POINTS * 2 + SMASH_CHAIN_BONUS);
  assert.equal(g.progress.loop.best.chain, 2);
  const o = car({ x: 5, driver: {} });
  g.vehicles.push(o);
  g.events.emit('vehicleCrash', g.player.vehicle, o, 6);
  g.events.emit('vehicleCrash', g.player.vehicle, o, 6);
  assert.equal(g.flow.rams, 1, 'once per car per 4 s');
  const before = g.flow.run;
  assert.equal(before, SMASH_POINTS * 2 + SMASH_CHAIN_BONUS + RAM_POINTS);
  // a scrape at speed: the car keeps most of its speed, no penalty
  g.run(0.5, 20 * DT, 0);
  g.player.vehicle.speed = 18;
  g.events.emit('vehicleImpact', g.player.vehicle, 9);
  assert.equal(g.flow.run, before);
  // into a wall: stopped dead
  g.player.vehicle.speed = 1;
  g.events.emit('vehicleImpact', g.player.vehicle, 12);
  assert.equal(g.flow.run, before - Math.round(before * CRASH_LOSS));
  assert.equal(g.progress.loop.totals.crashes, 1);
  // busted: the run is gone, the banked score is not
  g.score.add(5000, 'Race', 0, 0, true);
  g.events.emit('busted');
  assert.equal(g.flow.run, 0);
  assert.equal(g.score.total, 5000);
});

test('driving through a gate the right way starts its event; the result is recorded and RETRY offered', () => {
  const g = world();
  const se = g.streetEvents;
  const trap = se.list[1];
  // the wrong way first: nothing but a hint
  g.place(105, 400);
  g.run(0.5, -20 * DT, 0);
  assert.equal(se.active, null);
  assert.ok(g.toasts.some((t) => /Wrong way/.test(t[1])));
  // too slow: nothing
  g.place(99, 400);
  g.run(1, 1 * DT, 0);
  assert.equal(se.active, null);
  // beside the street: nothing
  g.place(90, 420);
  g.run(1, 20 * DT, 0);
  assert.equal(se.active, null);
  g.place(90, 400);
  g.run(0.6, 20 * DT, 0);
  assert.ok(se.active && se.active.ev === trap);
  assert.ok(g.toasts.some((t) => t[0] === 'objective' && /Speed trap ahead/.test(t[1])));
  // the line shows the mark of the next medal above the speed the car is doing
  const mark = markMedal(se.active);
  assert.equal(mark, mph(20) < trap.targets.bronze ? 'bronze' : mph(20) < trap.targets.silver ? 'silver' : 'gold');
  assert.match(g.eventLine, new RegExp('^Trap \\d+ ft · ' + mark + ' ' + trap.targets[mark] + ' mph$'));
  // no bank while it runs, even standing still with points
  g.flow.feed('nearMiss', 150);
  g.run(1.5, 0, 0);
  assert.equal(g.flow.run, 150);
  // through the line at 30 m/s
  g.run(11, 30 * DT, 0);
  assert.equal(se.active, null);
  const r = se.lastResult;
  assert.equal(r.result, 'done');
  assert.equal(Math.round(r.value), Math.round(mph(30)));
  assert.equal(r.medal, 'bronze');
  assert.ok(r.newBest && r.newMedal);
  assert.equal(g.progress.loop.events[trap.id].m, 'bronze');
  assert.equal(g.score.total, 1000 + 500 + 150, 'bronze, a new best, and the flow run banked by the event');
  assert.equal(g.flow.run, 0);
  assert.equal(g.eventLine, null);
  assert.ok(g.toasts.some((t) => /^Bronze! 67 mph \(silver \d+ mph\) {2}New best!$/.test(t[1])), JSON.stringify(g.toasts.slice(-3)));
  assert.ok(se.retryLeft > RETRY_S - 2);
  // RETRY: back before the gate, standing still, facing it; stars cleared
  g.police.heat.level = 2;
  assert.ok(se.retry());
  const v = g.player.vehicle;
  assert.deepEqual([v.x, v.z, v.speed, v.heading], [trap.x - trap.back, 400, 0, 0]);
  assert.equal(g.police.heat.level, 0);
  assert.equal(g.snaps, 1);
  assert.equal(se.retryLeft, 0);
  g.run(2, 20 * DT, 0);
  assert.ok(se.active && se.active.ev === trap, 'three seconds from RETRY to the run');
  g.run(31, 0, 0);
  assert.equal(se.lastResult.result, 'fail');
  assert.equal(se.lastResult.why, 'Out of time');
  assert.equal(g.progress.loop.events[trap.id].n, 2);
  assert.equal(g.progress.loop.events[trap.id].m, 'bronze', 'a failed run costs nothing');
});

test('each template runs on the game: passes, a jump, a drop with the GPS, stars, smashes', () => {
  const g = world();
  const se = g.streetEvents;
  const [miss, , jump, dash, heat, wreck] = se.list;
  const through = (ev) => { g.place(ev.x - 10, ev.z); g.run(0.6, 20 * DT, 0); assert.ok(se.active && se.active.ev === ev, ev.id); };
  // near-miss run: three sources that count as passes
  through(miss);
  g.flow.feed('nearMiss', 150);
  g.flow.feed('overtake', 60);
  g.flow.feed('shave', 50);
  g.flow.feed('drift', 100); // not a pass
  g.tick(20 * DT, 0);
  assert.equal(se.active.count, 3);
  assert.match(g.eventLine, /^Passes 3\/5 · 0:\d\d$/);
  g.flow.feed('nearMiss', 150);
  g.flow.feed('nearMiss', 150);
  g.run(1, 20 * DT, 0);
  assert.equal(se.lastResult.medal, 'gold', 'ends at gold without waiting for the clock');
  // jump: the stunt system's landing on this event's ramp, in feet
  through(jump);
  g.player.vehicle.air = { on: false, spot: jump.ramp, t: 1.2 };
  g.events.emit('stunt', { spot: { id: 'another' }, ok: true, dist: 99, air: 1.2 });
  g.tick(20 * DT, 0);
  assert.ok(se.active, 'another ramp does not count');
  g.events.emit('stunt', { spot: jump.ramp, ok: true, dist: 30, air: 1.2 });
  g.tick(20 * DT, 0);
  assert.equal(Math.round(se.lastResult.value), 98);
  assert.equal(g.progress.loop.best.jumpFt, 98.4);
  // rush drop: the objective is the drop (the GPS reads game.missions.objective)
  through(dash);
  assert.deepEqual([g.missions.objective.x, g.missions.objective.z, g.missions.objective.label], [600, 1300, 'Drop on Lincoln Rd']);
  g.place(590, 1295);
  assert.equal(se.lastResult.result, 'done');
  assert.equal(se.lastResult.medal, 'gold');
  assert.equal(g.missions.objective, null);
  // heat escape: the gate raises the stars through the police rules; an escape ends it
  g.police.heat.calm = 60; // a minute without trouble before the gate
  through(heat);
  assert.equal(g.police.heat.level, 0);
  assert.equal(g.police.heat.points, 1, 'one level pending: the police system raises it on its next step');
  {
    // the real heat rules after a long calm spell: the pending point is not faded below the step
    const h = createHeat();
    Object.assign(h, { level: g.police.heat.level, points: g.police.heat.points, calm: g.police.heat.calm, grace: g.police.heat.grace });
    assert.equal(updateHeat(h, DT, { inCar: true, seenByPolice: true }), 'up');
    assert.equal(h.level, 1);
  }
  g.police.heat.level = 1;
  g.run(20, 20 * DT, 0);
  assert.ok(se.active);
  g.police.heat.level = 0;
  g.events.emit('policeEscaped', 1);
  g.tick(20 * DT, 0);
  assert.equal(se.lastResult.result, 'done');
  assert.equal(se.lastResult.medal, 'gold');
  // with the police switched off in Settings the heat gate says so and does not start
  g.progress.settings.police = false;
  g.place(heat.x - 10, heat.z);
  g.run(0.6, 20 * DT, 0);
  assert.equal(se.active, null);
  assert.ok(g.toasts.some((t) => /Police chases are off/.test(t[1])));
  g.progress.settings.police = true;
  // wrecking spree: a prop 1, a ram 2, a wreck 3
  through(wreck);
  g.events.emit('propBreak', { byPlayer: true });
  const o = car({ x: 9999, driver: {} });
  g.events.emit('vehicleCrash', g.player.vehicle, o, 7);
  g.events.emit('takedown', { target: car({ x: 9999 }), kind: 'ram', depth: 0 });
  g.tick(20 * DT, 0);
  assert.equal(se.active.count, 6);
  // leaving the car ends it
  g.player.vehicle = null;
  g.tick();
  assert.equal(se.lastResult.result, 'fail');
  assert.equal(se.lastResult.why, 'Left the car');
  const tried = Object.keys(g.progress.loop.events).map((id) => id.split('_')[2]).sort();
  assert.deepEqual(tried, ['dash', 'heat', 'jump', 'miss']);
});

test('a tracked gate: the GPS leads to a point before it and lets go close by', () => {
  const g = world();
  const se = g.streetEvents;
  const trap = se.list[1];
  se.track(trap);
  g.place(-500, 400);
  const o = g.missions.objective;
  assert.deepEqual([o.x, o.z, o.label], [trap.x - 18, 400, 'Ocean Dr trap']);
  se.track(trap, 'Purple gate: hit the ramp fast.');
  assert.equal(g.missions.objective.label, 'Purple gate: hit the ramp fast.');
  g.place(trap.x - 18 - TRACK_NEAR + 2, 400);
  assert.equal(g.missions.objective, null, 'no "arrived" before the gate is crossed');
  g.run(3, 20 * DT, 0);
  assert.ok(se.active);
  assert.equal(se.tracked, null);
});

test('the first five minutes: five beats, one line each, any order, skippable and replayable', () => {
  for (const line of Object.values(INTRO_LINES)) assert.ok(line.split(/\s+/).length <= 9, line);
  assert.ok(INTRO_MAX_WORDS <= 9);
  assert.deepEqual(INTRO_STEPS, ['run', 'medal', 'police', 'ramp', 'garage']);
  const g = world({ intro: true });
  const se = g.streetEvents, t = g.tutorialSys, intro = () => g.progress.loop.intro;
  const [miss, , jump, , heat] = se.list;
  const lines = () => g.toasts.filter((x) => x[0] === 'objective').map((x) => x[1]);
  g.run(0.1);
  assert.equal(t.introStep, 'run');
  assert.equal(t.lastLine, INTRO_LINES.run);
  assert.equal(se.tracked, miss, 'the GPS is on the blue gate');
  assert.equal(g.missions.objective.label, INTRO_LINES.run, 'the line rides on the GPS goal');
  // through the gate: the run starts within the first seconds
  g.place(miss.x - 10, miss.z);
  g.run(0.6, 20 * DT, 0);
  assert.equal(t.introStep, 'medal');
  // no medal: RETRY is suggested; a medal moves on
  g.run(46, 20 * DT, 0);
  assert.equal(se.lastResult.medal, null);
  g.run(6, 20 * DT, 0);
  assert.ok(lines().includes(INTRO_LINES.medalMiss));
  assert.ok(se.retry());
  g.run(3, 20 * DT, 0);
  for (let i = 0; i < 5; i++) g.flow.feed('nearMiss', 150);
  g.run(1, 20 * DT, 0);
  assert.equal(se.lastResult.medal, 'gold');
  assert.equal(t.introStep, 'police');
  g.run(14, 20 * DT, 0);
  assert.ok(lines().includes(INTRO_LINES.medal));
  assert.equal(t.lastLine, INTRO_LINES.police);
  assert.equal(se.tracked, heat, 'the GPS is on the one-star red gate');
  // the police found the player some other way: an escape still counts
  g.police.stars = 1;
  g.run(6, 20 * DT, 0);
  assert.ok(lines().includes(INTRO_LINES.wanted));
  g.police.stars = 0;
  g.events.emit('policeEscaped', 1);
  g.run(12, 20 * DT, 0);
  assert.equal(t.introStep, 'ramp');
  assert.ok(lines().includes(INTRO_LINES.escaped));
  assert.equal(se.tracked, jump);
  // any ramp flown by the player
  g.player.vehicle.air = { on: false, spot: jump.ramp, t: 1 };
  g.events.emit('stunt', { spot: jump.ramp, ok: true, dist: 20, air: 1 });
  g.run(12, 20 * DT, 0);
  assert.equal(t.introStep, 'garage');
  assert.ok(lines().includes(INTRO_LINES.air));
  assert.deepEqual([se.tracked.x, se.tracked.z], [905, 900], 'the GPS is on the nearest garage door');
  g.place(880, 900);
  g.run(1);
  assert.equal(t.introOn, false);
  assert.deepEqual(intro(), { step: 5, done: true });
  g.run(6);
  assert.equal(t.lastLine, INTRO_LINES.done);
  assert.equal(se.tracked, null);
  // replay from Pause, then skip
  t.replay();
  g.run(0.1);
  assert.equal(t.introStep, 'run');
  assert.equal(t.lastLine, INTRO_LINES.run);
  t.skip();
  assert.equal(t.introOn, false);
  assert.equal(se.tracked, null);
  const n = g.toasts.length;
  g.run(60, 5 * DT, 0);
  assert.ok(!g.toasts.slice(n).some((x) => Object.values(INTRO_LINES).includes(x[1])), 'no more lines after a skip');
});

test('on a real region the host adds the jump ramps to the city once', () => {
  const city = regionCity('miami-south');
  const before = city.rampSpots.filter((r) => !r.event).length;
  const mk = () => {
    const events = createEvents();
    const g = { events, progress: defaultProgress(), city, player: { x: 0, z: 0, vehicle: null, walker: { speed: 0 }, wanted: 0 }, vehicles: [], hudState: {} };
    g.missions = createMissions(g, null);
    return g;
  };
  const a = mk(), b = mk();
  assert.equal(a.streetEvents.list.length, 30);
  assert.deepEqual(a.streetEvents.list.map((e) => e.id), placeEvents(city).map((e) => e.id));
  assert.equal(city.rampSpots.length, before + 4);
  assert.equal(new Set(city.rampSpots.map((r) => r.id)).size, city.rampSpots.length);
  assert.ok(a.daily && a.daily.picks.length === 3 && b.daily.day === a.daily.day);
  assert.equal(a.missions.objective, null);
  // the ramp objects the events hold are the ones in the city (the stunt system reports landings by them)
  for (const e of b.streetEvents.list.filter((x) => x.ramp)) assert.ok(city.rampSpots.some((r) => r.id === e.ramp.id));
  city.rampSpots.length = before;
});

test('the first run does not call the police for a bump or speed; the police beat on does', () => {
  const g = world({ intro: true });
  const t = g.tutorialSys, heat = g.police.heat;
  g.run(0.1);
  assert.equal(t.introStep, 'run');
  heat.points = 1; heat.speedTime = 2;
  g.tick();
  assert.equal(heat.points, 0, 'a bump before the police beat is forgiven');
  assert.equal(heat.speedTime, 0);
  assert.ok(heat.grace > 0, 'the police step that comes first cannot raise a star either');
  g.tutorialSys.skip();
  heat.points = 1;
  g.tick();
  assert.equal(heat.points, 1, 'without the intro the police rules are as always');
});

test('the first run: a queue standing at a light ahead in the lane is taken away, moving cars near by stay', () => {
  const g = world({ intro: true });
  g.run(0.1);
  const stopped = car({ x: 55, z: 0, ai: {}, driver: {}, speed: 0 });
  const rolling = car({ x: 50, z: 0.5, ai: {}, driver: {}, speed: 8 });
  const parked = car({ x: 60, z: 2.9, parked: true });
  g.vehicles.push(stopped, rolling, parked);
  g.run(0.5);
  assert.ok(stopped.removed, 'the queue goes before the player reaches it');
  assert.ok(!rolling.removed, 'a car driving on near by stays (a pass to make)');
  assert.ok(!parked.removed, 'parked cars stay: they are the close shaves');
});

test('a car driving into the player standing still is neither a ram nor a crash', () => {
  const g = world({ events: false });
  g.flow.feed('nearMiss', 150);
  g.tick();
  const run = g.flow.run;
  const o = car({ x: -4, driver: {}, speed: 9 });
  g.vehicles.push(o);
  g.events.emit('vehicleCrash', o, g.player.vehicle, 9);
  g.events.emit('vehicleImpact', g.player.vehicle, 9);
  assert.equal(g.flow.rams, 0);
  assert.equal(g.flow.run, run);
  assert.equal(g.progress.loop.totals.crashes, 0);
});

test('the first run: slow cars are staged in the lane past the gate as the player comes up to it, and the lane clearing keeps them', () => {
  const g = world({ intro: true });
  const calls = [];
  g.traffic = {
    stageAhead(x, z, dx, dz, dists, speed) {
      calls.push([x, z, dx, dz, dists.slice(), speed]);
      for (const d of dists) g.vehicles.push(car({ x: x + dx * d, z: z + dz * d, ai: {}, driver: {}, speed, staged: true }));
      return dists.length;
    },
  };
  const miss = g.streetEvents.list[0];
  g.run(0.5);
  assert.equal(calls.length, 0, 'not from the start place, 100 m back');
  g.place(miss.x - 60, 0);
  g.run(0.1);
  assert.equal(calls.length, 0, 'not yet 60 m back');
  g.place(miss.x - 42, 0);
  g.run(0.1);
  assert.equal(calls.length, 1, 'once the player is coming up to the gate from behind');
  assert.ok(STAGE_AT[0] + 42 >= 90, 'no nearer the player than traffic spawns');
  assert.deepEqual(calls[0], [miss.x, miss.z, miss.dx, miss.dz, STAGE_AT, STAGE_SPEED]);
  assert.ok(STAGE_AT[0] >= 40 && STAGE_SPEED * 2.237 <= 20, 'slow cars a good way past the gate');
  const staged = g.vehicles.filter((v) => v.staged);
  const other = car({ x: miss.x - 42 + 120, z: 0.4, ai: {}, driver: {}, speed: 9 });
  g.vehicles.push(other);
  g.run(1);
  assert.ok(other.removed, 'other moving traffic far ahead in the lane is still cleared');
  assert.ok(staged.every((v) => !v.removed), 'the staged cars stay');
  // the run starts at the gate: its sweep of the lane keeps the staged cars that move
  g.run(2.4, 20 * DT, 0);
  assert.ok(g.streetEvents.active && g.streetEvents.active.ev === miss);
  assert.ok(staged.every((v) => !v.removed), 'still there once the run is on');
  assert.equal(calls.length, 1, 'staged once per approach');
  // one stopped in the lane ahead (a queue at a light) goes like any queue
  const first = staged[0];
  first.speed = 0;
  first.x = g.player.x + 55;
  g.run(0.5, 0, 0);
  assert.ok(first.removed, 'a staged car standing in the lane is a queue and goes');
});

test('a tier up plays its own bigger chime (flowTier with the tier), not the plain reward chime', () => {
  const g = world();
  const heard = [];
  g.events.on('flowTier', (t) => heard.push(['flowTier', t]));
  g.events.on('reward', (a, why) => heard.push(['reward', why]));
  g.run(0.1);
  for (let i = 0; i < 4; i++) g.flow.feed('nearMiss', 150, 'Near miss');
  assert.equal(g.flow.tier, 2);
  assert.deepEqual(heard, [['flowTier', 2]]);
});
