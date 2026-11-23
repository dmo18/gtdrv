// Blast throw (cars launched and flipped, people tumbling), craft blast
// sizes and the explosion event payload. docs/COMBAT.md "Burning and explosions".
import { RULES } from '../src/core/weapons.js';
RULES.invulnerable = false;
import test from 'node:test';
import assert from 'node:assert/strict';
import { initActor, addActor, damage, craftBlast, explosionSize, TOSS_G } from '../src/systems/combat.js';
import { createVehicle } from '../src/entities/vehicle.js';
import { createTank } from '../src/entities/tank.js';
import { makeFightGame, step, yard } from './fightgame.js';
import { BLAST, ROLL_V, fireRadius, smokeReach, shakeAt, blastScale, dustTone } from '../src/render/blastplan.js';

function arena() {
  const { city, collision } = yard();
  city.furniture = [];
  return makeFightGame({ city, collision, seed: 9, px: -60, pz: 0 });
}

test('explosion event carries size, radius and scale for audio and effects', () => {
  const g = arena();
  const seen = [];
  g.events.on('explosion', (e) => seen.push({ r: e.radius, size: e.size, scale: e.scale, y: e.y }));
  g.combat.explode(0, 1, 0, 6);
  step(g, [], 30);
  g.combat.explode(30, 1, 0, 14, null, 0, 9);
  step(g, [], 30);
  assert.deepEqual(seen.map((e) => e.size), ['small', 'huge']);
  assert.equal(seen[1].r, 14);
  assert.equal(seen[1].scale, 9);
});

test('bigger craft explode bigger', () => {
  const out = { r: 0, scale: 0 };
  const car = createVehicle('sedan', 0, 0, 0);
  const tank = createTank('rustback', 0, 0, 0);
  const jet = { kind: 'plane', spec: { id: 'fighter' } };
  const prop = { kind: 'plane', spec: { id: 'prop' } };
  // REVAMP 6.7 scale by craft (was car 8, tank 12).
  assert.equal(craftBlast(car, out).r, 10);
  assert.equal(craftBlast(car, out).scale, 1);
  assert.deepEqual({ ...craftBlast(tank, out) }, { r: 14, scale: 1.5 });
  assert.deepEqual({ ...craftBlast(jet, out) }, { r: 13, scale: 1.3 });
  assert.deepEqual({ ...craftBlast({ kind: 'heli', spec: {} }, out) }, { r: 12, scale: 1.2 });
  assert.deepEqual({ ...craftBlast({ kind: 'car', spec: { mass: 2600 } }, out) }, { r: 11, scale: 1.1 });
  const rc = craftBlast(car, out).r;
  assert.ok(craftBlast(tank, out).r > rc && craftBlast(jet, out).r > rc && craftBlast(prop, out).r > rc);
  assert.equal(explosionSize(craftBlast(tank, out).r), 'huge');
  assert.equal(explosionSize(craftBlast(jet, out).r), 'huge');
});

test('a car near a blast is launched, rocks and lands again; a far car stays put', () => {
  const g = arena();
  const near = g.addVehicle(createVehicle('sedan', 4, 0, 0));
  const far = g.addVehicle(createVehicle('sedan', 60, 0, 0));
  near.health = far.health = 1e6; // survive: it is thrown, not wrecked
  near.spec = { ...near.spec, health: 1e6 };
  let peak = 0;
  g.combat.explode(0, 0.5, 0, 8);
  assert.equal(near.tossing, true);
  assert.ok(near.tvy > 2 && near.tvy < 9, `lift ${near.tvy}`);
  assert.ok(!far.tossing && !(far.y > 0));
  for (let i = 0; i < 200; i++) {
    step(g, [], 1);
    peak = Math.max(peak, near.y);
  }
  assert.ok(peak > 0.5 && peak < 5, `peak ${peak.toFixed(2)} m`);
  assert.equal(near.y, 0);
  assert.equal(near.tossing, false);
  assert.equal(near.tRoll, 0, 'a live car lands level');
  const airtime = (2 * near.tvy) / TOSS_G;
  assert.ok(Number.isFinite(airtime));
});

test('closer means harder: the throw scales with distance', () => {
  const g = arena();
  const a = g.addVehicle(createVehicle('sedan', 2.5, 0, 0));
  const b = g.addVehicle(createVehicle('sedan', 0, 6, 0));
  for (const c of [a, b]) c.spec = { ...c.spec, health: 1e6 };
  a.health = b.health = 1e6;
  g.combat.explode(0, 0.5, 0, 8);
  assert.ok(a.tvy > b.tvy, `${a.tvy} vs ${b.tvy}`);
});

test('a destroyed car pops up and a wreck can flip; a tank only shudders', () => {
  const g = arena();
  const car = g.addVehicle(createVehicle('sedan', 10, 0, 0));
  const flips = new Set();
  damage(g, car, 1e6, null, 'blast');
  step(g, [], 30);
  flips.add(Math.abs(car.tRollEnd));
  assert.equal(car.wrecked, true);
  assert.ok(car.tossing || car.y === 0);
  step(g, [], 200);
  assert.equal(car.y, 0);
  assert.ok(Math.abs(car.tRoll) === Math.abs(car.tRollEnd));
  const tank = g.addVehicle(createTank('rustback', 20, 0, 0));
  g.combat.explode(21, 0.5, 0, 8);
  assert.ok(!tank.tossing || tank.tvy < 2, 'a 42 t tank barely lifts');
});

test('people killed by a blast fly, tumble and land; the player is never thrown', () => {
  const g = arena();
  const ped = initActor({ x: 3, z: 0, y: 0, heading: 0, radius: 0.35, px: 3, pz: 0, vx: 0, vz: 0 }, 'civ');
  addActor(g, ped);
  g.combat.explode(0, 0.5, 0, 8);
  assert.equal(ped.hp, 0);
  assert.ok(ped.ky > 3, `launch ${ped.ky}`);
  let peak = 0, spun = false;
  // A ragdoll (core/ragdoll.js): flight, one small bounce, then it settles.
  for (let i = 0; i < 180; i++) {
    step(g, [], 1);
    peak = Math.max(peak, ped.y);
    if (Math.abs(ped.spin) > 0.5) spun = true;
  }
  assert.ok(peak > 0.4 && spun, `peak ${peak}`);
  assert.equal(ped.y, 0);
  assert.equal(ped.ky, 0);
  assert.equal(ped.spin, 0);
  const w = g.player.walker;
  w.x = w.px = 2;
  w.z = w.pz = 0;
  g.player.x = 2;
  g.combat.explode(0, 0.5, 0, 8);
  assert.equal(w.ky || 0, 0);
});

test('blast look: contract numbers, smoke seen 12 m out by 0.5 s for a car, farther for a tank or jet', () => {
  assert.equal(BLAST.fire.n, 3);
  assert.ok(Math.abs(fireRadius(1, 0) - 2) < 1e-9, 'fireball starts at 2 m');
  assert.ok(Math.abs(fireRadius(1, 0.25) - 7) < 1e-9, 'and is 7 m across by 0.25 s');
  const car = smokeReach(1, 0.5), tank = smokeReach(1.5, 0.5), jet = smokeReach(1.3, 0.5);
  assert.ok(car >= 12, `car smoke reach ${car.toFixed(1)} m`);
  assert.ok(tank > car && jet > car, `tank ${tank.toFixed(1)} m, jet ${jet.toFixed(1)} m`);
  assert.equal(smokeReach(1, 0.05), 0, 'the roll starts at 0.08 s');
  assert.ok(ROLL_V.length >= BLAST.roll.n1);
  // Shake: 1 at the center, straight line to 0 at 60 m.
  assert.equal(shakeAt(1, 0), 1);
  assert.ok(Math.abs(shakeAt(1, 30) - 0.5) < 1e-9);
  assert.equal(shakeAt(1, 60), 0);
  assert.ok(shakeAt(1.5, 60) > 0, 'a tank blast reaches farther');
  // Visual scale: craft scale, else the radius over a car's 10 m.
  assert.equal(blastScale(10, 1.5, true), 1.5);
  assert.equal(blastScale(5, 1, false), 0.5);
  assert.notDeepEqual(dustTone('beach'), dustTone(''));
  assert.notDeepEqual(dustTone('works'), dustTone(''));
});

test('a car blast lays every layer, sized by craft scale', async () => {
  const { createCombatFx } = await import('../src/render/combatfx.js');
  const { createEvents } = await import('../src/core/events.js');
  const events = createEvents();
  const game = {
    events, quality: 1, paused: false, player: { x: 0, z: 0 },
    city: { lotTypeAt: () => 'beach' },
    combat: { decals: { x: new Float32Array(24), z: new Float32Array(24), r: new Float32Array(24), t: new Float32Array(24).fill(-1e9) }, projectiles: [], hulls: [] },
  };
  const fx = createCombatFx(game);
  const car = { kind: 'car', color: 0xc8402e, x: 5, z: 0, y: 0, spec: { length: 4.4, width: 1.8, height: 1.4 } };
  events.emit('explosion', { x: 5, y: 0.7, z: 0, radius: 10, scale: 1, size: 'big', craft: car });
  assert.equal(fx.lastBlast.vs, 1);
  const tankish = { ...car, kind: 'tank' };
  events.emit('explosion', { x: 5, y: 0.7, z: 0, radius: 14, scale: 1.5, size: 'huge', craft: tankish });
  assert.equal(fx.lastBlast.vs, 1.5);
  fx.dispose();
});
