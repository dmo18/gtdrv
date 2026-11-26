// 0.13.5 AI behavior review (docs/STATUS.md): traffic at dead ends, at
// merges and in the box; walkers on the streets of every region.
import test from 'node:test';
import assert from 'node:assert/strict';
import { regionCity } from './regionfixture.js';
import { createCollisionWorld, fillCollision } from '../src/world/collision.js';
import { deadEnds } from '../src/world/deadends.js';
import { createVehicle, stepVehicle, collideVehicles } from '../src/entities/vehicle.js';
import { createRng } from '../src/core/rng.js';
import { createDriver, placeDriver, driveStep, deadEndAhead } from '../src/systems/traffic.js';
import { createPeds } from '../src/systems/peds.js';
import { canDrive } from '../src/world/citygen.js';

const DT = 1 / 60;
const worlds = new Map();
function world(id) {
  let w = worlds.get(id);
  if (!w) {
    const city = regionCity(id);
    const collision = fillCollision(city, createCollisionWorld());
    w = { city, collision, time: 0 };
    worlds.set(id, w);
  }
  return w;
}
const otherEnd = (e, n) => (e.a === n ? e.b : e.a);

// Dead ends with room to turn: a two-way street of 45 m or more off a junction.
function turnableEnds(city, n) {
  const out = [];
  for (const de of deadEnds(city)) {
    const e = city.edges[de.edge];
    if (e.oneway || e.length < 45 || city.nodes[otherEnd(e, de.node)].edges.length < 3) continue;
    out.push(de);
    if (out.length >= n) break;
  }
  return out;
}

test('a car driven into a dead end turns round short of the barricade and drives out', () => {
  for (const id of ['miami-beach', 'miami-west', 'miami-north']) {
    const W = world(id);
    const ends = turnableEnds(W.city, 4);
    assert.ok(ends.length >= 2, `${id}: ${ends.length} dead ends to try`);
    for (const de of ends) {
      const e = W.city.edges[de.edge];
      const from = otherEnd(e, de.node);
      const rng = createRng(de.node);
      const v = createVehicle('sedan', 0, 0, 0, rng);
      const dr = createDriver(W.city, rng);
      placeDriver(dr, v, e.id, from, Math.min(25, e.length * 0.4));
      v.ai = v.driver = dr;
      assert.equal(dr.e1, e.id, 'the only way on is back');
      const ctx = { time: 0, vehicles: [v] };
      const hx = Math.cos(de.heading), hz = Math.sin(de.heading);
      let closest = Infinity, out = false;
      for (let k = 0; k < 60 * 45 && !out; k++) {
        W.time += DT;
        ctx.time += DT;
        driveStep(dr, v, DT, ctx);
        stepVehicle(v, v.controls, DT, W);
        // How far short of the barricade line is the car's nearest corner?
        const al = (v.x - de.x) * hx + (v.z - de.z) * hz;
        const reach = Math.abs(Math.cos(v.heading - de.heading)) * v.spec.length / 2 + Math.abs(Math.sin(v.heading - de.heading)) * v.spec.width / 2;
        closest = Math.min(closest, -(al + reach));
        if (dr.junctions >= 1 && Math.hypot(v.x - de.x, v.z - de.z) > 30) out = true; // turned and on its way out
      }
      assert.ok(out, `${id} dead end at node ${de.node}: still there after 45 s (stuck ${dr.stuck}, ${closest.toFixed(1)} m short)`);
      assert.ok(closest > 0.3, `${id} node ${de.node}: ${closest.toFixed(2)} m short of the barricade`);
    }
  }
});

test('through traffic does not turn into a dead end street', () => {
  const W = world('miami-beach');
  const city = W.city;
  let tried = 0, into = 0;
  for (const de of turnableEnds(city, 12)) {
    const e = city.edges[de.edge];
    const j = otherEnd(e, de.node);
    assert.equal(deadEndAhead(city, e.id, j), 1);
    assert.equal(deadEndAhead(city, e.id, de.node), 0);
    for (const ei of city.nodes[j].edges) {
      if (ei === e.id) continue;
      const a = city.edges[ei];
      const f = otherEnd(a, j);
      if (a.oneway && a.a !== f) continue;
      // Another legal way on from j (else the dead end is the only way).
      let other = false;
      for (const bi of city.nodes[j].edges) {
        const b = city.edges[bi];
        if (bi !== ei && bi !== e.id && canDrive(b, j) && !b.causeway && !deadEndAhead(city, bi, j)) other = true;
      }
      if (!other) continue;
      for (let s = 0; s < 20; s++) {
        const dr = createDriver(city, createRng(1000 * s + ei));
        placeDriver(dr, null, ei, f, 1);
        tried++;
        if (dr.e1 === e.id) into++;
      }
    }
  }
  assert.ok(tried > 100, `${tried} drivers`);
  assert.equal(into, 0, `${into} of ${tried} drivers headed into a dead end`);
});

// Two cars from different approaches into the same lane of one exit, timed
// to meet there: one gives way, they never touch.
test('two cars merging into the same exit lane do not touch', () => {
  const W = world('miami-west');
  const city = W.city;
  let cases = 0, touched = 0;
  const lanesFrom = (e, n) => (e.a === n ? e.lanesF : e.lanesB || e.lanesF);
  for (const n of city.nodes) {
    if (cases >= 10) break;
    if (n.signal || n.bend || n.edges.length < 3) continue;
    const ins = [], outs = [];
    for (const ei of n.edges) {
      const e = city.edges[ei];
      if (e.length < 60 || e.causeway) continue;
      const far = otherEnd(e, n.id);
      if (canDrive(e, far)) ins.push([e, far]);
      if (canDrive(e, n.id) && lanesFrom(e, n.id) === 1) outs.push(e);
    }
    if (ins.length < 2 || !outs.length) continue;
    const ex = outs[0];
    const pair = ins.filter(([e]) => e !== ex).slice(0, 2);
    if (pair.length < 2) continue;
    const cars = [];
    for (let k = 0; k < 2; k++) {
      const [e, far] = pair[k];
      let v = null;
      for (let s = 0; s < 60 && !v; s++) {
        const rng = createRng(1 + s * 13 + k * 7 + n.id);
        const c = createVehicle('sedan', 0, 0, 0, rng);
        const dr = createDriver(city, rng);
        placeDriver(dr, c, e.id, far, e.length - 40 - k * 1.5);
        if (dr.e1 === ex.id) { c.ai = c.driver = dr; v = c; }
      }
      if (!v) break;
      v.vx = Math.cos(v.heading) * 8; v.vz = Math.sin(v.heading) * 8; v.speed = 8;
      cars.push(v);
    }
    if (cars.length < 2) continue;
    cases++;
    const ctx = { time: 0, vehicles: cars };
    let hit = false;
    for (let k = 0; k < 60 * 20; k++) {
      W.time += DT;
      ctx.time += DT;
      for (const v of cars) driveStep(v.ai, v, DT, ctx);
      for (const v of cars) stepVehicle(v, v.controls, DT, W);
      if (collideVehicles(cars[0], cars[1]) && Math.max(cars[0].impact, cars[1].impact) > 1) hit = true;
    }
    if (hit) touched++;
  }
  assert.ok(cases >= 6, `${cases} merges tried`);
  assert.equal(touched, 0, `${touched} of ${cases} merges touched`);
});

test('walkers on the sidewalks of every region, the Beach start street too', () => {
  // Before 0.13.5 the Beach and South starts had none (the whole map's core box).
  const least = { 'miami-beach': 8, 'miami-north': 8, 'miami-west': 4, 'miami-south': 1 };
  for (const id of Object.keys(least)) {
    const W = world(id);
    const sp = W.city.startView ? W.city.startView.spawn : W.city.spawn;
    const g = {
      city: W.city, collision: W.collision, rng: createRng(5), vehicles: [], actors: [], time: 0, clock: 14, quality: 1,
      player: { x: sp.x, z: sp.z, y: 0, heading: 0, vehicle: null }, events: { emit() {}, on() {} },
    };
    const peds = createPeds(g);
    for (let i = 0; i < 300; i++) peds.fixedUpdate(DT);
    let n = 0;
    for (const s of peds.slots) if (s.ped.active && Math.hypot(s.ped.x - sp.x, s.ped.z - sp.z) < 80) n++;
    assert.ok(n >= least[id], `${id}: ${n} walkers within 80 m of the start`);
  }
});

test('a patrol car swiping a faster player from the side or from behind is not the player ramming', async () => {
  const { isRam } = await import('../src/systems/police.js');
  const s = 1 / 60;
  // The player east at 15 m/s; the police car 2.4 m to its right, closing at 5 m/s.
  const p = { x: 0, z: 0, px: -15 * s, pz: 0 };
  const side = { x: 0.5, z: 2.4, px: 0.5, pz: 2.4 + 5 * s, police: true };
  assert.equal(isRam(p, side, 8), false, 'swiped from the side');
  // From behind, the police car faster than the player.
  const behind = { x: -4.6, z: 0, px: -4.6 - 20 * s, pz: 0, police: true };
  assert.equal(isRam(p, behind, 8), false, 'hit from behind');
  // The player into the side of a crossing car is still a ram.
  const cross = { x: 4.4, z: 0, px: 4.4, pz: -10 * s, traffic: true };
  assert.equal(isRam(p, cross, 12), true, 'T-boned by the player');
});
