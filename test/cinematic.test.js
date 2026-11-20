import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createLoop, STEP } from '../src/core/loop.js';
import { createChaseCamera } from '../src/render/chasecam.js';
import {
  SLOWMO, PULL, createSlowMo, createPullback, pullCurve, isBigKill, createCinematic,
} from '../src/systems/cinematic.js';
import { wantedStars, unitsFor, LEVEL_RULES, COOLDOWN, createHeat, updateHeat } from '../src/systems/police.js';
import { createEvents } from '../src/core/events.js';

test('wanted stars: one per heat level, a fifth when the helicopter is up', () => {
  assert.deepEqual([0, 1, 2, 3, 4].map((l) => wantedStars(l, false)), [0, 1, 2, 3, 4]);
  assert.equal(wantedStars(4, true), 5);
  assert.equal(wantedStars(3, true), 3, 'no fifth star below the top level');
  assert.equal(wantedStars(9, false), 4);
  assert.equal(wantedStars(-1, true), 0);
});

test('each heat level is harsher: more units, quicker response, faster cars, heli only at the top', () => {
  for (let l = 1; l <= 4; l++) {
    const a = LEVEL_RULES[l - 1], b = LEVEL_RULES[l];
    assert.ok(b.units >= a.units && b.every <= a.every && b.launch >= a.launch && b.pace >= a.pace);
  }
  assert.ok(unitsFor(4, 3) > unitsFor(3, 3));
  assert.deepEqual(LEVEL_RULES.map((r) => r.heli), [false, false, false, false, true]);
});

test('heat cooldown fills while unseen and the level resets when it is full', () => {
  const heat = createHeat();
  heat.level = 2;
  const facts = { speeding: 0, crashedTraffic: false, startledPed: false, seenByPolice: false, inCar: true, atSea: false, airborne: false };
  let prev = 0, res = null;
  for (let i = 0; i < Math.ceil((COOLDOWN[2] + 1) * 60) && !res; i++) {
    res = updateHeat(heat, STEP, facts);
    if (!res) {
      assert.ok(heat.cooldown >= prev, 'meter never drops while unseen');
      prev = heat.cooldown;
    }
  }
  assert.equal(res, 'escaped');
  assert.equal(heat.level, 0);
  // Seen again: the meter empties at once.
  heat.level = 2;
  heat.unseen = 5;
  updateHeat(heat, STEP, { ...facts, seenByPolice: true });
  assert.equal(heat.unseen, 0);
  assert.equal(heat.cooldown, 0);
});

function run(loopScale, frames) {
  let steps = 0;

  let cb = null;
  globalThis.requestAnimationFrame = (f) => { cb = f; return 1; };
  globalThis.cancelAnimationFrame = () => {};
  globalThis.performance = globalThis.performance || { now: () => 0 };
  const loop = createLoop({ fixedUpdate: () => { steps++; }, render: () => {}, getScale: () => loopScale });
  loop.start();
  let nowMs = performance.now();
  for (let i = 0; i < frames; i++) {
    nowMs += 1000 / 60;
    cb(nowMs);
  }
  loop.stop();
  return steps;
}

test('time scale: scaled real time advances fewer fixed steps, steps stay 1/60', () => {
  const full = run(1, 300);
  const slow = run(0.35, 300);
  assert.ok(Math.abs(full - 300) <= 2, `full speed ~300 steps, got ${full}`);
  assert.ok(slow < full * 0.45 && slow > full * 0.25, `35% scale gives ~105 steps, got ${slow}`);
  assert.equal(STEP, 1 / 60);
});

test('slow motion: 0.8 s at 35 percent, one per 6 s, eased in and out', () => {
  const s = createSlowMo();
  assert.equal(s.trigger(), true);
  assert.equal(s.trigger(), false, 'already running');
  let min = 1, simTime = 0, t = 0;
  while (s.active && t < 2) {
    const sc = s.update(1 / 60);
    min = Math.min(min, sc);
    simTime += sc / 60;
    t += 1 / 60;
  }
  assert.ok(Math.abs(t - SLOWMO.duration) < 0.03, `lasts ${t}`);
  assert.ok(Math.abs(min - SLOWMO.scale) < 0.01, `deepest ${min}`);
  assert.ok(simTime < t * 0.7, 'game time advanced less than real time');
  assert.equal(s.update(1 / 60), 1);
  assert.equal(s.trigger(), false, 'inside the 6 s gap');
  for (let i = 0; i < 6 * 60; i++) s.update(1 / 60);
  assert.equal(s.trigger(), true, 'allowed again after the gap');
  assert.equal(s.count, 2);
});

test('which kills trigger slow motion', () => {
  assert.equal(isBigKill('bullet', { team: 'crew' }, false, 0), true, 'last enemy');
  assert.equal(isBigKill('bullet', { team: 'crew' }, false, 2), false, 'others remain');
  assert.equal(isBigKill('bullet', { team: 'police' }, false, 3), true, 'officer takedown');
  assert.equal(isBigKill('blast', { spec: {} }, true, 0), true, 'blasted vehicle');
  assert.equal(isBigKill('bullet', { spec: {} }, true, 0), false, 'shot vehicle');
  assert.equal(isBigKill('bullet', { team: 'civ' }, false, 0), false);
});

test('pull-back curve starts and ends at zero, peaks in between and is smooth', () => {
  assert.equal(pullCurve(0), 0);
  assert.equal(pullCurve(1), 0);
  assert.equal(pullCurve(-1), 0);
  assert.ok(pullCurve(0.3) > 0.99);
  let prev = 0, maxStep = 0;
  for (let i = 1; i <= 100; i++) {
    const v = pullCurve(i / 100);
    assert.ok(v >= 0 && v <= 1);
    maxStep = Math.max(maxStep, Math.abs(v - prev));
    prev = v;
  }
  assert.ok(maxStep < 0.1, 'no jumps');
  const p = createPullback();
  p.start(-1);
  let peak = 0, t = 0;
  while (p.active && t < 3) {
    p.update(1 / 60);
    peak = Math.max(peak, p.dist);
    t += 1 / 60;
  }
  assert.ok(Math.abs(t - PULL.duration) < 0.03);
  assert.ok(Math.abs(peak - PULL.dist) < 0.01);
  assert.ok(p.yaw === 0 && p.dist === 0 && p.rise === 0, 'ends home');
  p.start(-1);
  p.update(0.4);
  assert.ok(p.yaw < 0, 'swings to the chosen side');
  p.update(0.1, true);
  assert.ok(!p.active && p.dist === 0, 'cancelled at once');
});

test('chase camera honours the fx hook and reports a drag', () => {
  const cam = new THREE.PerspectiveCamera(62, 2, 0.5, 1800);
  const chase = createChaseCamera(cam);
  const target = { x: 0, z: 0, y: 0, heading: 0, pitch: 0, roll: 0, speed: 10, height: 1.2 };
  chase.snap(target);
  const settle = () => { for (let i = 0; i < 120; i++) chase.update(target, 1 / 60, null, null); return cam.position.clone(); };
  const a = settle();
  const fov0 = cam.fov;
  chase.fx.dist = 5;
  chase.fx.zoom = 0.04;
  const b = settle();
  assert.ok(Math.hypot(b.x, b.z) > Math.hypot(a.x, a.z) + 3, 'further back');
  assert.ok(cam.fov < fov0 * 0.98, 'zoomed in');
  chase.fx.dist = 0;
  chase.fx.zoom = 0;
  assert.equal(chase.fx.touched, false);
  chase.update(target, 1 / 60, { lookX: 3, lookY: 0 }, null);
  assert.equal(chase.fx.touched, true);
});

test('cinematic system: events drive slow motion and pull-back, reduce motion turns both off', () => {
  const events = createEvents();
  const fx = { yaw: 0, dist: 0, rise: 0, zoom: 0, touched: false };
  const game = {
    events, paused: false, camHeading: 0, chase: { fx }, progress: { settings: {} },
    player: { x: 0, z: 0 }, actors: [],
  };
  const cin = createCinematic(game, null);
  const craft = { spec: {}, health: 0 };
  events.emit('takedown', { target: craft, source: null, kind: 'blast' });
  cin.render(0, 1 / 60);
  assert.ok(game.timeScale < 1 && fx.zoom > 0);
  events.emit('explosion', { x: 20, y: 0, z: 0, radius: 8, craft, puff: false });
  for (let i = 0; i < 30; i++) cin.render(0, 1 / 60);
  assert.ok(fx.dist > 0, 'camera pulled back');
  fx.touched = true;
  cin.render(0, 1 / 60);
  assert.equal(fx.dist, 0, 'cancelled by the player moving the camera');
  events.emit('explosion', { x: 90, y: 0, z: 0, radius: 8, craft, puff: false });
  assert.equal(cin.pull.active, false, 'too far away');
  game.progress.settings.reduceMotion = true;
  const ev2 = createEvents();
  game.events = ev2;
  const cin2 = createCinematic(game, null);
  ev2.emit('takedown', { target: { team: 'police', hp: 0 }, source: null, kind: 'bullet' });
  cin2.render(0, 1 / 60);
  assert.equal(game.timeScale, 1);
});
