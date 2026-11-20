// Cops are killable every way: on foot, in a car (driver shot through the
// body, car wrecked, car blasted) and a car full of cops. docs/COMBAT.md.
import { RULES } from '../src/core/weapons.js';
RULES.unlimitedAmmo = false;
RULES.invulnerable = false;
import test from 'node:test';
import assert from 'node:assert/strict';
import { createPolice } from '../src/systems/police.js';
import { damage, occupantsAlive, canBeHit } from '../src/systems/combat.js';
import { makeFightGame, step, cityAndCollision } from './fightgame.js';

function setup() {
  const { city } = cityAndCollision();
  const game = makeFightGame({ seed: 5, px: city.spawn.x, pz: city.spawn.z });
  const police = createPolice(game);
  // Heat 2 so cops are active: a fixture patrol car right here.
  police.heat.level = 2;
  const log = { down: [], hit: [], take: [] };
  game.events.on('down', (d) => log.down.push({ t: d.target, kind: d.kind, hp: d.target.hp }));
  game.events.on('hit', (h) => log.hit.push(h.kind));
  game.events.on('takedown', (d) => log.take.push(d.target));
  return { game, police, log, city };
}

function copCar(game, police, x, z) {
  // Ask the system for a chase car and move it to where the test wants it.
  for (let k = 0; k < 600 && !police.cars.length; k++) {
    police.heat.points = Math.max(police.heat.points, 2);
    step(game, [police], 1);
  }
  assert.ok(police.cars.length, 'a patrol car spawned');
  const v = police.cars[0];
  v.x = x;
  v.z = z;
  v.vx = v.vz = v.speed = 0;
  return v;
}

test('a cop on foot dies to one bullet, with blood events', () => {
  const { game, police, log } = setup();
  const w = game.player.walker;
  const v = copCar(game, police, w.x + 20, w.z);
  v.role = 'out';
  v.outT = 0;
  let o = null;
  for (let k = 0; k < 200 && !o; k++) {
    step(game, [police], 3);
    o = police.officers.find((q) => q.active && q.life === 'ok');
  }
  assert.ok(o, 'an officer stepped out');
  assert.equal(o.team, 'police');
  const before = log.down.length;
  const applied = damage(game, o, 25, w, 'bullet');
  assert.ok(applied > 0);
  assert.equal(o.hp, 0);
  assert.equal(o.life, 'down');
  assert.ok(log.down.length > before);
  assert.ok(log.hit.includes('bullet'));
  assert.ok(police.heat.points > 0 || police.heat.level >= 2);
});

test('a cop on foot dies to a blast', () => {
  const { game, police } = setup();
  const w = game.player.walker;
  const v = copCar(game, police, w.x + 20, w.z);
  v.role = 'out';
  v.outT = 0;
  let o = null;
  for (let k = 0; k < 200 && !o; k++) {
    step(game, [police], 3);
    o = police.officers.find((q) => q.active && q.life === 'ok');
  }
  assert.ok(o, 'an officer on foot');
  game.combat.explode(o.x + 1, 0.5, o.z, 6, w);
  assert.equal(o.life === 'ok', false);
  assert.equal(o.hp, 0);
});

test('shooting a patrol car driver through the body kills him and stops the car', () => {
  const { game, police, log } = setup();
  const w = game.player.walker;
  const v = copCar(game, police, w.x + 15, w.z);
  assert.equal(occupantsAlive(v), 2);
  const car0 = v.health;
  // Fire a real pistol at the cabin until the seats are empty.
  let shots = 0;
  w.heading = 0;
  for (let k = 0; k < 40 && occupantsAlive(v) > 0; k++) {
    v.x = w.x + 15;
    v.z = w.z;
    v.vx = v.vz = v.speed = 0;
    const dy = (v.y || 0) + 1.0 - 1.4;
    game.combat.fire(w, 15, dy, 0);
    shots++;
    step(game, [police], 30);
  }
  assert.equal(occupantsAlive(v), 0, `both officers dead after ${shots} shots`);
  assert.equal(log.down.filter((d) => d.t.team === 'police' && d.hp === 0).length, 2);
  assert.ok(log.take.length >= 2, 'takedowns reach the score');
  assert.ok(v.health > 0 && v.health <= car0, 'the car itself survived pistol fire');
  step(game, [police], 20);
  assert.equal(v.role, 'dead');
  assert.equal(v.ai, null);
  const bodies = police.bodies.filter((b) => b.active);
  assert.equal(bodies.length, 2);
  for (const b of bodies) assert.equal(canBeHit(b), false);
  assert.ok(police.heat.level >= 2, 'heat stays up');
});

test('low shots at the wheels do not hurt the driver', () => {
  const { game, police } = setup();
  const w = game.player.walker;
  const v = copCar(game, police, w.x + 15, w.z);
  const hp0 = v.occ[0];
  game.combat.fire(w, 15, -1.56, 0); // enters the car about 0.05 m up
  assert.equal(v.occ[0], hp0);
});

test('a wrecked patrol car kills every officer inside', () => {
  const { game, police, log } = setup();
  const w = game.player.walker;
  const v = copCar(game, police, w.x + 25, w.z);
  assert.equal(occupantsAlive(v), 2);
  damage(game, v, 1e6, w, 'blast');
  step(game, [police], 5);
  assert.equal(v.wrecked, true);
  assert.equal(occupantsAlive(v), 0);
  assert.equal(log.down.filter((d) => d.t.team === 'police' && d.hp === 0).length, 2);
  assert.ok(police.bodies.filter((b) => b.active && b.life !== 'ok').length === 2);
});

test('a blast near a patrol car hurts the cops even before the hull gives', () => {
  const { game, police } = setup();
  const w = game.player.walker;
  const v = copCar(game, police, w.x + 25, w.z);
  v.health = 5000;
  v.occ[0] = 20;
  v.occ[1] = 20;
  game.combat.explode(v.x + 1, 0.5, v.z, 8, w);
  step(game, [police], 5);
  assert.equal(occupantsAlive(v), 0);
});

test('a car full of cops: killing them one by one keeps the rest driving', () => {
  const { game, police } = setup();
  const w = game.player.walker;
  const v = copCar(game, police, w.x + 25, w.z);
  damage(game, v, 1, w, 'bullet');
  v.occ[0] = 1;
  damage(game, v, 10, w, 'bullet');
  assert.equal(occupantsAlive(v), 1);
  step(game, [police], 5);
  assert.notEqual(v.role, 'dead');
  v.occ[1] = 1;
  damage(game, v, 10, w, 'bullet');
  step(game, [police], 5);
  assert.equal(v.role, 'dead');
});

test('shooting down the police heli kills the crew, heat rises, the force keeps coming', async () => {
  const { spawnPoliceHeli } = await import('../src/systems/helipilot.js');
  const { game, police, log } = setup();
  game.police = police;
  const w = game.player.walker;
  const pilot = spawnPoliceHeli(game, { x: w.x + 60, z: w.z, y: 40, order: 'orbit' });
  const heli = pilot.craft || game.vehicles.find((c) => c.spec && c.spec.police && c.kind === 'heli');
  assert.ok(heli && heli.occ, 'the heli carries a crew');
  const p0 = police.heat.points;
  damage(game, heli, 1e6, w, 'blast');
  assert.equal(occupantsAlive(heli), 0);
  assert.equal(log.down.filter((d) => d.t.team === 'police' && d.hp === 0).length, 2);
  step(game, [police], 10);
  assert.ok(police.heat.points > p0 || police.heat.level > 2, 'killing cops raises heat');
});
