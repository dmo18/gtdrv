import test from 'node:test';
import assert from 'node:assert/strict';
import { makeFightGame, yard, DT } from './fightgame.js';
import {
  spawnPoliceHeli, stepPilots, setOrder, gunnerChance, createHeliPilots, toggleSpot, PILOT,
} from '../src/systems/helipilot.js';
import { stepAircraft } from '../src/entities/aircraft.js';
import { damage, HP } from '../src/systems/combat.js';
import { createArms, WEAPONS } from '../src/core/weapons.js';
import { AIR_REACH } from '../src/core/aim.js';
import { findEnterable } from '../src/entities/onfoot.js';
import { canJack, isOccupied } from '../src/core/carjack.js';

// The tallest Glasswell (downtown) tower, and a point beside it.
function glasswell(g) {
  let best = null;
  for (const b of g.city.buildings) {
    if (g.city.districtOf((b.x0 + b.x1) / 2, (b.z0 + b.z1) / 2) !== 'downtown') continue;
    if (!best || b.h > best.h) best = b;
  }
  return { b: best, x: (best.x0 + best.x1) / 2 + 30, z: (best.z0 + best.z1) / 2 };
}

// Game order: vehicles step, then the pilots, then combat.
function run(g, pilot, steps, each = null) {
  const a = pilot.craft;
  for (let i = 0; i < steps; i++) {
    g.time += DT;
    g.world.time = g.time;
    if (each) each(i);
    if (!a.removed) stepAircraft(a, a.controls, DT, g.world);
    stepPilots(g, DT);
    g.combat.fixedUpdate(DT);
  }
}
const movePlayer = (g, x, z) => {
  const w = g.player.walker;
  w.x = x;
  w.z = z;
  g.player.x = x;
  g.player.z = z;
};

test('gunner formula: 0.25 x (1 - d/120) x 1/(1 + v/10) x ramp', () => {
  assert.equal(gunnerChance(0, 0, 5), 0.25);
  assert.ok(Math.abs(gunnerChance(60, 0, 5) - 0.125) < 1e-9);
  assert.ok(Math.abs(gunnerChance(60, 10, 5) - 0.0625) < 1e-9);
  assert.equal(gunnerChance(130, 0, 5), 0);
  assert.equal(gunnerChance(30, 0, 0), 0);
  assert.ok(gunnerChance(30, 0, PILOT.aimRamp / 2) < gunnerChance(30, 0, PILOT.aimRamp));
});

test('spawn: a flying police Lampwatch 350 m out, 80 m up, with a pilot', () => {
  const g = makeFightGame({ px: 0, pz: 0 });
  const p = spawnPoliceHeli(g, { angle: 0 });
  const a = p.craft;
  assert.equal(a.spec.id, 'patrolheli');
  assert.ok(a.police && a.spec.police && a.driver === 'ai' && a.ai === p);
  assert.ok(Math.abs(Math.hypot(a.x, a.z) - 350) < 1);
  assert.ok(a.y >= 80 && !a.onGround && a.rotorSpeed === 1);
  assert.ok(g.vehicles.includes(a));
  assert.equal(p.state, 'arrive');
});

test('orbits a moving target over Glasswell for 60 s: never closer than the ring, never steeply overhead, never touching a roof', () => {
  const g = makeFightGame({});
  const c = glasswell(g);
  assert.ok(c.b.h > 60, 'a real tower');
  const tgt = { x: c.x, z: c.z, y: 0 };
  const p = spawnPoliceHeli(g, { target: tgt, dist: 200, angle: 0, seed: 5 });
  const a = p.craft;
  let impacts = 0, out = 0, n = 0, minClear = Infinity;
  run(g, p, 60 * 75, (i) => {
    tgt.x = c.x + Math.cos(i * DT * 0.08) * 60;
    tgt.z = c.z + Math.sin(i * DT * 0.08) * 60;
    if (a.impact > 0) impacts++;
    if (i > 60 * 15) {
      const r = Math.hypot(a.x - tgt.x, a.z - tgt.z);
      n++;
      // Over the towers it stands further off (elevation capped, a little lag).
      if (r < PILOT.orbitMin || Math.atan2(a.y, r) > PILOT.maxElev + 0.15) out++;
      minClear = Math.min(minClear, a.y - g.collision.heightAt(a.x, a.z));
    }
  });
  assert.equal(p.state, 'orbit');
  assert.equal(impacts, 0);
  assert.equal(out, 0, `${out} of ${n} samples outside the ring`);
  assert.ok(minClear > 8, `clearance ${minClear}`);
  assert.ok(!a.wrecked);
  assert.ok(a.spotOn && a.spotAim, 'beam on the target');
});

// A junction with open sky around it (no roof within 9 m).
function openNode(g, skip = 0) {
  const col = g.collision;
  const open = (x, z) => [0, 1, 2, 3, 4, 5, 6, 7].every((k) => col.heightAt(x + Math.cos(k * 0.785) * 9, z + Math.sin(k * 0.785) * 9) === 0);
  return g.city.nodes.filter((q) => open(q.x, q.z)).sort((u, v) => Math.hypot(u.x, u.z) - Math.hypot(v.x, v.z))[skip];
}

test('over open streets: the ring, low enough to see, and ahead of a moving target (in view, not overhead)', () => {
  const { city, collision } = yard();
  const g = makeFightGame({ city, collision });
  const tgt = { x: 0, z: 0, y: 0 };
  const p = spawnPoliceHeli(g, { target: tgt, dist: 200, angle: 2, seed: 7 });
  const a = p.craft;
  let n = 0, ring = 0, ahead = 0, over = 0, elevSum = 0;
  run(g, p, 60 * 70, (i) => {
    if (i < 60 * 30) return; // parked, then driving east at 14 m/s
    tgt.x += 14 * DT;
    if (i < 60 * 45) return;
    const r = Math.hypot(a.x - tgt.x, a.z - tgt.z), e = Math.atan2(a.y, r);
    n++;
    elevSum += e;
    if (r >= PILOT.orbitMin - 4 && r <= PILOT.orbitMax + 6) ring++;
    if (Math.abs(Math.atan2(a.z - tgt.z, a.x - tgt.x)) < 1.1) ahead++;
    if (e > 1.0) over++;
  });
  assert.ok(ring / n > 0.9, `in the ring ${ring} of ${n}`);
  assert.ok(ahead / n > 0.9, `ahead of the target ${ahead} of ${n}`);
  assert.equal(over, 0, 'never steeply overhead');
  const mean = elevSum / n;
  assert.ok(mean > 0.12 && mean < 0.4, `mean elevation ${mean}`);
});

test('strafe: passes every 8..12 s with bursts at the player; hold fire works', () => {
  const g = makeFightGame({});
  const c = openNode(g, 3); // a street with sky over it (among towers the heli stays above the roofs)
  movePlayer(g, c.x, c.z);
  const p = spawnPoliceHeli(g, { dist: 160, angle: 0, order: 'strafe', seed: 9 });
  let firstShot = -1, passes = 0, was = '';
  run(g, p, 60 * 60, (i) => {
    g.player.walker.hp = 100;
    if (firstShot < 0 && p.shots > 0) firstShot = i * DT;
    if (p.state === 'strafe' && was !== 'strafe') passes++;
    was = p.state;
  });
  assert.ok(passes >= 2 && passes <= 5, `passes ${passes}`);
  assert.ok(p.shots >= 8, `shots ${p.shots}`);
  assert.ok(firstShot >= PILOT.quiet, 'never in the first 3 s');
  const g2 = makeFightGame({});
  movePlayer(g2, c.x, c.z);
  const q = spawnPoliceHeli(g2, { dist: 160, angle: 0, order: 'strafe', seed: 9 });
  q.weaponsFree = false;
  run(g2, q, 60 * 60, () => { g2.player.walker.hp = 100; });
  assert.equal(q.shots, 0);
});

test('evades when hurt, retreats on order, leaves and despawns', () => {
  const g = makeFightGame({});
  const p = spawnPoliceHeli(g, { dist: 120, angle: 1, seed: 3 });
  const a = p.craft;
  run(g, p, 60 * 15);
  a.health = a.spec.health * 0.3;
  run(g, p, 60 * 20);
  assert.equal(p.state, 'evade');
  assert.ok(p.dist > 95, `backed off to ${p.dist}`);
  setOrder(p, 'leave');
  run(g, p, 60 * 40);
  assert.equal(p.state, 'done');
  assert.ok(a.removed && !g.vehicles.includes(a));
});

test('hover holds a point; land puts it down', () => {
  const g = makeFightGame({});
  // A junction with open sky around it.
  const col = g.collision;
  const open = (x, z) => [0, 1, 2, 3, 4, 5, 6, 7].every((k) => col.heightAt(x + Math.cos(k * 0.785) * 9, z + Math.sin(k * 0.785) * 9) === 0);
  const n = g.city.nodes.filter((q) => open(q.x, q.z)).sort((u, v) => Math.hypot(u.x, u.z) - Math.hypot(v.x, v.z))[0];
  const p = spawnPoliceHeli(g, { x: n.x - 80, z: n.z, y: 60, seed: 4 });
  const a = p.craft;
  setOrder(p, 'hover', { x: n.x, z: n.z, y: 50 });
  run(g, p, 60 * 30);
  assert.ok(Math.hypot(a.x - n.x, a.z - n.z) < 4, `off by ${Math.hypot(a.x - n.x, a.z - n.z)}`);
  assert.ok(Math.abs(a.y - 50) < 20, `hover height ${a.y}`);
  setOrder(p, 'land', { x: n.x, z: n.z });
  run(g, p, 60 * 30);
  assert.equal(p.state, 'landed');
  assert.ok(a.onGround && !a.wrecked);
});

test('shot down: spins down, explodes on the ground, wreck released', () => {
  const g = makeFightGame({});
  const booms = [];
  g.events.on('explosion', (e) => booms.push({ y: e.y, r: e.radius }));
  const p = spawnPoliceHeli(g, { dist: 80, angle: 0, seed: 2 });
  const a = p.craft;
  run(g, p, 60 * 4);
  damage(g, a, 10000, g.player.walker, 'blast');
  assert.ok(a.wrecked);
  run(g, p, 60);
  assert.equal(booms.length, 0, 'no mid-air blast');
  assert.equal(p.state, 'crash');
  run(g, p, 60 * 10);
  assert.equal(p.state, 'done');
  assert.ok(a.onGround || a.onWater);
  assert.equal(booms.length, 1);
  // On whatever is under it: the ground or a roof.
  assert.ok(Math.abs(booms[0].y - 1.2 - g.collision.heightAt(a.x, a.z)) < 3, `blast at ${booms[0].y}`);
  assert.equal(a.ai, null);
});

test('no NaN over thousands of steps, and deterministic', () => {
  const trace = () => {
    const g = makeFightGame({});
    const c = glasswell(g);
    movePlayer(g, c.x, c.z);
    const p = spawnPoliceHeli(g, { dist: 300, angle: 2.5, order: 'strafe', seed: 11 });
    const orders = ['orbit', 'strafe', 'retreat', 'hover', 'orbit'];
    let k = 0;
    run(g, p, 60 * 100, (i) => {
      g.player.walker.hp = 100;
      if (i % 1200 === 1199) setOrder(p, orders[k++ % orders.length]);
      movePlayer(g, c.x + Math.sin(i * 0.004) * 80, c.z + Math.cos(i * 0.003) * 80);
    });
    const a = p.craft;
    assert.ok(Number.isFinite(a.x + a.y + a.z + a.heading + a.vx + a.vy + a.vz));
    return [a.x, a.y, a.z, a.heading, p.shots, p.hits, p.state].join(',');
  };
  assert.equal(trace(), trace());
});

test('system: spotlight ramps; player toggle', () => {
  const g = makeFightGame({});
  const sys = createHeliPilots(g);
  assert.equal(g.helipilot, sys);
  const p = sys.spawn({ dist: 100, angle: 0 });
  sys.fixedUpdate(DT);
  assert.equal(sys.pilots.length, 1);
  p.craft.spotOn = true;
  for (let i = 0; i < 30; i++) sys.fixedUpdate(DT);
  assert.equal(p.craft.spot, 1);
  const own = { spec: { police: true }, spotOn: false };
  assert.ok(toggleSpot(g, own) && own.spotOn);
  assert.ok(!toggleSpot(g, { spec: {} }));
});

test('pistol from the street reaches the heli in the air; the pilot dies, it settles in one piece, ENTER takes it and it flies', () => {
  const { city, collision } = yard();
  const g = makeFightGame({ city, collision });
  const w = g.player.walker;
  w.arms = createArms('pistol');
  const p = spawnPoliceHeli(g, { dist: 200, angle: 0.4, seed: 3 });
  const a = p.craft;
  a.occ = [HP.police, HP.police]; // police.crewUp in the game
  run(g, p, 60 * 25);
  assert.equal(p.state, 'orbit');
  const d3 = () => Math.hypot(a.x - w.x, a.y + 1.6 - 1.4, a.z - w.z);
  const far = d3();
  assert.ok(far > WEAPONS.pistol.range + 20 && far < AIR_REACH, `heli ${far} m away`);
  let hits = 0;
  g.events.on('shot', (e) => { if (e.hitKind === 'craft' && e.shooter === w) hits++; });
  run(g, p, 60 * 30, () => {
    if (p.state !== 'orbit' && p.state !== 'evade') return;
    w.hp = 100;
    g.combat.fire(w, a.x - w.x, a.y + 1.6 - 1.4, a.z - w.z, null, null);
  });
  assert.ok(hits > 0, 'bullets reach it');
  assert.ok(!a.wrecked, 'came down in one piece');
  assert.equal(p.state, 'done');
  assert.ok(a.onGround && a.driver === null && a.ai === null && !a.siren);
  // Walk up to it: the ENTER prompt finds it.
  w.x = a.x + 6;
  w.z = a.z;
  assert.equal(findEnterable(w, g.vehicles), a);
  // The player's controls lift it.
  a.driver = 'player';
  const ctl = { steer: 0, pitch: 0, throttle: 1, brake: 0, handbrake: false };
  for (let i = 0; i < 60 * 6; i++) stepAircraft(a, ctl, DT, g.world);
  assert.ok(!a.onGround && a.y > 8, `climbed to ${a.y}`);
});

test('a police heli on the ground with its crew aboard can be taken (carjack), one in the air cannot', () => {
  const g = makeFightGame({});
  const p = spawnPoliceHeli(g, { dist: 60, angle: 0, seed: 8 });
  const a = p.craft;
  assert.ok(!canJack(a), 'flying');
  a.y = 0;
  a.onGround = true;
  a.vx = a.vz = a.speed = 0;
  assert.ok(canJack(a));
  const w = g.player.walker;
  w.x = a.x + 6;
  w.z = a.z;
  assert.equal(findEnterable(w, g.vehicles, 3.2, (v) => !isOccupied(v) || canJack(v)), a);
});
