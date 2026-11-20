import test from 'node:test';
import assert from 'node:assert/strict';
import { createPolice, createHeat, updateHeat, COOLDOWN, MAX_HEAT, OFFICERS_MAX, VIOLENCE } from '../src/systems/police.js';
import { createCrew, ATTACK_SLOTS, slotsInUse } from '../src/systems/crew.js';
import { initActor, addActor, damage } from '../src/systems/combat.js';
import { createVehicle, stepVehicle } from '../src/entities/vehicle.js';
import { DT, makeFightGame, step, cityAndCollision } from './fightgame.js';

const civAt = (game, x, z) => {
  const a = initActor({ x, z, y: 0, heading: 0, radius: 0.35, px: x, pz: z, vx: 0, vz: 0 }, 'civ');
  addActor(game, a);
  return a;
};
const shotBy = (game, x, z) => game.events.emit('shot', { shooter: game.player.walker, weapon: 'pistol', x, y: 1.4, z });

// A quiet street spot: the city spawn.
function streetGame(seed = 1) {
  const { city } = cityAndCollision();
  return makeFightGame({ seed, px: city.spawn.x, pz: city.spawn.z });
}

test('heat rules: violence points add up to level 4 at most, each step after the grace', () => {
  const heat = createHeat();
  const f = { violence: 0, seenByPolice: true, inCar: false };
  updateHeat(heat, DT, { ...f, violence: VIOLENCE.officerDown });
  assert.equal(heat.level, 1);
  for (let k = 0; k < 60 * 40; k++) updateHeat(heat, DT, { ...f, violence: k % 30 === 0 ? 1 : 0 });
  assert.equal(heat.level, MAX_HEAT);
  assert.equal(COOLDOWN[4], 32);
  assert.equal(updateHeat(heat, DT, { ...f, violence: NaN }), null);
});

test('witness rules: a shot with nobody around is free; near a civilian it counts', () => {
  const game = streetGame();
  const police = createPolice(game);
  const p = game.player;
  // Nobody near, no police: no heat however many shots.
  for (let k = 0; k < 120; k++) {
    if (k % 10 === 0) shotBy(game, p.x, p.z);
    step(game, [police], 1);
  }
  assert.equal(police.heat.level, 0);
  assert.ok(police.heat.points < 1e-9);
  // A civilian 30 m away hears it: 0.3 each; pellets in one step count once.
  civAt(game, p.x + 30, p.z);
  shotBy(game, p.x, p.z);
  shotBy(game, p.x, p.z);
  step(game, [police], 1);
  assert.ok(Math.abs(police.heat.points - VIOLENCE.shot) < 1e-6, `${police.heat.points}`);
  shotBy(game, p.x, p.z);
  step(game, [police], 1);
  shotBy(game, p.x, p.z);
  step(game, [police], 1);
  shotBy(game, p.x, p.z);
  step(game, [police], 1);
  assert.equal(police.heat.level, 1, 'four witnessed shots');
});

test('hurting people: civilians and officers always count, crew only when police see it', () => {
  const game = streetGame();
  const police = createPolice(game);
  const p = game.player, w = p.walker;
  const crew = createCrew(game, { ambient: false });
  const g = crew.spawnGroup({ x: p.x + 200, z: p.z, n: 1 });
  damage(game, g.members[0], 10, w, 'bullet');
  step(game, [police], 1);
  assert.equal(police.heat.points, 0, 'crew hurt, unseen');
  const civ = civAt(game, p.x + 300, p.z);
  damage(game, civ, 10, w, 'bullet');
  step(game, [police], 1);
  assert.ok(Math.abs(police.heat.points - VIOLENCE.civHit) < 1e-6);
  damage(game, civ, 100, w, 'bullet'); // hit + down
  step(game, [police], 1);
  assert.equal(police.heat.level, 1);
  assert.ok(Math.abs(police.heat.points - 0.5) < 1e-6, `pending points capped at 1.5 before the step: ${police.heat.points}`);
});

test('escalation: heat 2 officers step out with pistols, heat 3 smgs and ramming, cooldown escapes', () => {
  const game = streetGame(3);
  const police = createPolice(game);
  const p = game.player;
  police.heat.level = 2;
  police.heat.grace = 99;
  // Let a chase car come; the player stands still on foot.
  let out = 0, officerShots = 0, maxSlots = 0;
  game.events.on('shot', (s) => { if (s.shooter.team === 'police') officerShots++; });
  step(game, [police], 60 * 40, (gm) => {
    police.heat.unseen = 0; // keep the chase alive
    for (const v of gm.vehicles) if (v.police) stepVehicle(v, v.controls, DT, gm.world);
    out = Math.max(out, police.officers.filter((o) => o.active).length);
    maxSlots = Math.max(maxSlots, slotsInUse(gm, gm.time));
    if (gm.player.walker.life !== 'ok' || gm.player.walker.fade > 0) gm.player.walker.hp = 100;
  });
  assert.ok(out >= 1 && out <= OFFICERS_MAX, `${out} officers out`);
  assert.ok(police.stats.stepOuts >= 1);
  assert.ok(officerShots > 0, 'officers fire');
  assert.ok(maxSlots <= ATTACK_SLOTS);
  const active = police.officers.filter((o) => o.active);
  assert.ok(active.every((o) => o.arms.weapon === 'pistol'));
  // Heat 3: new officers carry SMGs; chase cars take turns ramming a craft.
  police.heat.level = 3;
  for (const o of police.officers) if (o.active) o.state = 'return';
  const car = createVehicle('sedan', p.x, p.z, 0);
  car.driver = 'player';
  game.addVehicle(car);
  game.player.vehicle = car;
  step(game, [police], 60 * 10, (gm) => {
    police.heat.unseen = 0;
    for (const v of gm.vehicles) if (v.police) stepVehicle(v, v.controls, DT, gm.world);
  });
  const chasers = police.cars.filter((v) => v.role === 'chase');
  assert.ok(chasers.length >= 1);
  // Ramming is on for about 4 of every 7 s on the first car.
  game.time = Math.ceil(game.time / 7) * 7 + 1;
  step(game, [police], 1);
  assert.ok(police.cars.some((v) => v.cop && v.cop.ram), 'a car rams');
  game.player.vehicle = null;
  car.driver = null;
  for (const v of police.cars) v.outCool = 0;
  step(game, [police], 60 * 8, (gm) => {
    police.heat.unseen = 0;
    for (const v of gm.vehicles) if (v.police) stepVehicle(v, v.controls, DT, gm.world);
    if (gm.player.walker.life !== 'ok') gm.player.walker.hp = 100;
  });
  const smg = police.officers.filter((o) => o.active && o.state === 'fight');
  assert.ok(smg.length === 0 || smg.every((o) => o.arms.weapon === 'smg'), smg.map((o) => o.arms.weapon).join());
  // Out of sight for the level-3 cooldown: escape, worth 1500 points.
  police.heat.level = 3;
  game.player.walker.x = game.player.x = p.x + 5000; // far away and hidden
  let escaped = 0;
  game.events.on('policeEscaped', () => escaped++);
  step(game, [police], Math.ceil(60 * (COOLDOWN[3] + 2)));
  assert.equal(escaped, 1);
  assert.equal(police.heat.level, 0);
  assert.deepEqual(game.scoreLog.at(-1), [1500, 'Lost the police']);
});

test('settings.police off: no cars, no officers, no heat from violence', () => {
  const game = streetGame(5);
  game.progress.settings.police = false;
  const police = createPolice(game);
  const p = game.player;
  civAt(game, p.x + 5, p.z);
  step(game, [police], 60 * 20, (gm, k) => {
    if (k % 20 === 0) shotBy(gm, p.x, p.z);
    if (k % 120 === 0) gm.events.emit('explosion', { x: p.x, y: 0, z: p.z, radius: 6, source: p.walker, depth: 0 });
  });
  assert.equal(police.heat.level, 0);
  assert.equal(game.player.wanted, 0);
  assert.equal(game.vehicles.filter((v) => v.police).length, 0);
  assert.equal(police.officers.filter((o) => o.active).length, 0);
  // Turned off mid-shootout: everything goes at once.
  game.progress.settings.police = true;
  police.heat.level = 3;
  step(game, [police], 60 * 30, (gm) => {
    police.heat.unseen = 0;
    for (const v of gm.vehicles) if (v.police) stepVehicle(v, v.controls, DT, gm.world);
    if (gm.player.walker.life !== 'ok') gm.player.walker.hp = 100;
  });
  assert.ok(game.vehicles.some((v) => v.police));
  game.progress.settings.police = false;
  step(game, [police], 1);
  assert.equal(game.vehicles.filter((v) => v.police).length, 0);
  assert.equal(police.officers.filter((o) => o.active).length, 0);
  assert.equal(game.actors.filter((a) => a.team === 'police').length, 0);
});

test('heat 4: a roadblock of two cars appears across the road ahead', () => {
  const { city } = cityAndCollision();
  const e = city.edges.filter((x) => x.avenue && !x.causeway && x.length > 90).sort((a, b) => b.length - a.length)[0];
  const a = city.nodes[e.a], b = city.nodes[e.b];
  const ux = (b.x - a.x) / e.length, uz = (b.z - a.z) / e.length;
  const game = makeFightGame({ px: a.x + ux * 10, pz: a.z + uz * 10 });
  const car = createVehicle('sedan', game.player.x, game.player.z, Math.atan2(uz, ux));
  car.driver = 'player';
  car.vx = ux * 25;
  car.vz = uz * 25;
  car.speed = 25;
  game.addVehicle(car);
  game.player.vehicle = car;
  const police = createPolice(game);
  police.heat.level = 4;
  police.heat.grace = 99;
  step(game, [police], 60 * 4, () => {
    police.heat.unseen = 0;
    car.x += car.vx * DT * 0.2; // creeping on, still heading the same way
    car.z += car.vz * DT * 0.2;
  });
  const blocks = police.cars.filter((v) => v.role === 'block' || v.role === 'blockOut');
  assert.equal(blocks.length, 2, police.cars.map((v) => v.role).join() + ' ' + police.stats.blockFail);
  assert.equal(police.stats.roadblocks, 1);
  for (const v of blocks) {
    const d = Math.hypot(v.x - car.x, v.z - car.z);
    assert.ok(d > 60 && d < 200, `${d.toFixed(0)} m away`);
    assert.ok((v.x - car.x) * ux + (v.z - car.z) * uz > 0, 'ahead');
    assert.ok(v.siren && v.controls.handbrake);
  }
  // Below heat 4 they pack up.
  police.heat.level = 2;
  step(game, [police], 2);
  assert.equal(police.cars.filter((v) => v.role === 'block').length, 0);
});
