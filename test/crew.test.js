import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createCrew, hitChance, chooseCover, takeSlot, slotsInUse, releaseSlot,
  CREW_MAX, ATTACK_SLOTS, LOS_PER_STEP, PLAYER_DMG_MULT, createFootActor, placeFootActor,
} from '../src/systems/crew.js';
import { damage, CAPS, initActor, addActor } from '../src/systems/combat.js';
import { createRng } from '../src/core/rng.js';
import { createVehicle, stepVehicle } from '../src/entities/vehicle.js';
import { DT, yard, makeFightGame, step, playerShoots, cityAndCollision } from './fightgame.js';

const finite = (...v) => v.every(Number.isFinite);

test('hit chance follows the contract formula and falls off with distance and speed', () => {
  // 0.55 x (1 - d/range) x 1/(1 + v/8) x ramp x 0.8
  assert.ok(Math.abs(hitChance(0, 45, 0, 1) - 0.44) < 1e-9);
  assert.ok(Math.abs(hitChance(22.5, 45, 0, 1) - 0.22) < 1e-9);
  assert.ok(Math.abs(hitChance(10, 45, 8, 1) - 0.55 * (1 - 10 / 45) * 0.5 * 0.8) < 1e-9);
  assert.equal(hitChance(45, 45, 0, 1), 0, 'out of range');
  assert.equal(hitChance(60, 45, 0, 1), 0);
  assert.equal(hitChance(10, 45, 0, 0), 0, 'no aim yet');
  assert.ok(Math.abs(hitChance(10, 45, 0, 0.4) - hitChance(10, 45, 0, 1) / 2) < 1e-9, 'ramp over 0.8 s');
  let last = 1;
  for (let d = 0; d < 45; d += 5) {
    const c = hitChance(d, 45, 3, 1);
    assert.ok(c < last && c >= 0);
    last = c;
  }
  assert.ok(hitChance(10, 45, 20, 1) < hitChance(10, 45, 5, 1));
  assert.equal(hitChance(NaN, 45, 0, 1), 0);
});

test('crew spot a hostile player in the open within 35 m, not through a wall', () => {
  // Open yard.
  {
    const { city, collision } = yard();
    const game = makeFightGame({ city, collision, px: 20, pz: 0 });
    const crew = createCrew(game, { ambient: false });
    const g = crew.spawnGroup({ x: 0, z: 0, n: 2, hostile: true, tag: 'a' });
    step(game, [crew], 60);
    assert.ok(g.members.every((m) => m.state === 'engage'), g.members.map((m) => m.state).join());
  }
  // A wall between: they stay calm (no shot heard).
  {
    const { city, collision } = yard([[8, -15, 10, 15, 6]]);
    const game = makeFightGame({ city, collision, px: 20, pz: 0 });
    const crew = createCrew(game, { ambient: false });
    const g = crew.spawnGroup({ x: 0, z: 0, n: 2, hostile: true });
    step(game, [crew], 120);
    assert.ok(g.members.every((m) => m.state === 'patrol' && !m.los), g.members.map((m) => m.state).join());
  }
  // Not hostile (outside a mission, not attacked): no fight even in the open.
  {
    const { city, collision } = yard();
    const game = makeFightGame({ city, collision, px: 15, pz: 0 });
    const crew = createCrew(game, { ambient: false });
    const g = crew.spawnGroup({ x: 0, z: 0, n: 2 });
    let shots = 0;
    game.events.on('shot', (s) => { if (s.shooter.team === 'crew') shots++; });
    step(game, [crew], 180);
    assert.equal(shots, 0);
    assert.ok(g.members.every((m) => m.state === 'patrol'));
    // The player shoots one: the whole group turns hostile and engages.
    game.combat.fire(game.player.walker, -1, -0.03, 0);
    damage(game, g.members[0], 5, game.player.walker, 'bullet');
    step(game, [crew], 30);
    assert.equal(g.hostile, true);
    assert.ok(g.members.every((m) => m.state === 'engage' || m.state === 'flee'));
  }
});

test('a shot heard within 50 m alerts the crew; far away it does not', () => {
  const { city, collision } = yard([[8, -30, 10, 30, 6]]);
  const game = makeFightGame({ city, collision, px: 200, pz: 0 });
  const crew = createCrew(game, { ambient: false });
  const near = crew.spawnGroup({ x: 0, z: 0, n: 1 });
  const far = crew.spawnGroup({ x: 0, z: 120, n: 1 });
  const shot = { shooter: game.player.walker, x: 30, y: 1.4, z: 0, weapon: 'pistol' };
  game.events.emit('shot', shot);
  assert.equal(near.members[0].state, 'alert');
  assert.equal(far.members[0].state, 'patrol');
  // Not hostile: settles down again.
  step(game, [crew], 60 * 7);
  assert.equal(near.members[0].state, 'patrol');
});

test('cover: the chosen spot hides the actor from the player behind a wall', () => {
  const { city, collision } = yard([[4, -3, 6, 3, 4]]);
  const game = makeFightGame({ city, collision, px: 25, pz: 0 });
  const a = placeFootActor(createFootActor('crew', createRng(2)), 0, 4);
  const out = {};
  chooseCover(game, a, 25, 0, out);
  assert.ok(out.found && out.covered, JSON.stringify(out));
  assert.equal(collision.lineClear(out.x, out.z, 25, 0), false, 'cover blocks the line');
  assert.ok(Math.hypot(out.x - a.x, out.z - a.z) < 7.5);
  // From the peek spot (a few steps sideways) the player can be seen.
  assert.ok(Math.hypot(out.px - out.x, out.pz - out.z) <= 5.01);
  assert.ok(collision.lineClear(out.px, out.pz, 25, 0), "the peek spot sees the player");
  // Open ground: a spot is found but it is not cover.
  const open = yard();
  const g2 = makeFightGame({ ...open, px: 25, pz: 0 });
  const o2 = {};
  chooseCover(g2, a, 25, 0, o2);
  assert.ok(o2.found && !o2.covered);
});

test('an engaged member moves into cover, then peeks out and fires bursts', () => {
  const { city, collision } = yard([[4, -3, 6, 3, 4]]);
  const game = makeFightGame({ city, collision, px: 22, pz: 6 });
  const crew = createCrew(game, { ambient: false, seed: 5 });
  const g = crew.spawnGroup({ x: 0, z: 6, n: 1, hostile: true, weapon: 'pistol' });
  const m = g.members[0];
  let hidden = 0, bursts = 0, shooting = false;
  step(game, [crew], 60 * 12, () => {
    if (m.hasCover && m.covered && !collision.lineClear(m.x, m.z, game.player.x, game.player.z)) hidden++;
    if (m.shooting && !shooting) bursts++;
    shooting = m.shooting;
  });
  assert.ok(hidden > 60, `hidden for ${hidden} steps`);
  assert.ok(bursts >= 2, `${bursts} bursts`);
  assert.ok(m.shots >= 6, `${m.shots} shots`);
});

test('the last one standing flees when outnumbered; low hp may flee too', () => {
  const { city, collision } = yard();
  const game = makeFightGame({ city, collision, px: 18, pz: 0 });
  const crew = createCrew(game, { ambient: false });
  const g = crew.spawnGroup({ x: 0, z: 0, n: 3, hostile: true, tag: 't' });
  step(game, [crew], 60);
  assert.ok(g.members.every((m) => m.state === 'engage'));
  damage(game, g.members[0], 999, game.player.walker, 'bullet');
  step(game, [crew], 30);
  assert.equal(g.members[1].state, 'engage', 'two still fight one');
  damage(game, g.members[1], 999, game.player.walker, 'bullet');
  const last = g.members[2];
  const d0 = Math.hypot(last.x - game.player.x, last.z - game.player.z);
  step(game, [crew], 60 * 3);
  assert.equal(last.state, 'flee');
  const d1 = Math.hypot(last.x - game.player.x, last.z - game.player.z);
  assert.ok(d1 > d0 + 8, `ran from ${d0.toFixed(1)} to ${d1.toFixed(1)} m`);
  const st = crew.status('t');
  assert.equal(st.total, 3);
  assert.equal(st.fled, 1);
  assert.equal(st.out, 2);

  // Low hp: about a quarter of hurt members run (seeded).
  let fled = 0;
  for (let s = 0; s < 40; s++) {
    const g2 = makeFightGame({ city, collision, px: 18, pz: 0, seed: s });
    const c2 = createCrew(g2, { ambient: false, seed: 100 + s });
    const gr = c2.spawnGroup({ x: 0, z: 0, n: 3, hostile: true });
    damage(g2, gr.members[0], 50, g2.player.walker, 'bullet');
    if (gr.members[0].state === 'flee') fled++;
  }
  assert.ok(fled >= 4 && fled <= 18, `${fled} of 40 fled`);
});

// Six crew against the player, 120 simulated seconds on the real city.
function sixVersusOne(seed) {
  const { city, collision } = cityAndCollision();
  // An open-ish street point near the spawn.
  const sx = city.spawn.x, sz = city.spawn.z;
  const game = makeFightGame({ city, collision, px: sx, pz: sz, seed });
  const crew = createCrew(game, { ambient: false, seed });
  const h = city.spawn.heading;
  const g = crew.spawnGroup({ x: sx + Math.cos(h) * 25, z: sz + Math.sin(h) * 25, n: 6, hostile: true, tag: 'six' });
  let playerDowns = 0, takedowns = 0, shots = 0, hits = 0, maxSlots = 0, steps = 0;
  game.events.on('playerDown', () => playerDowns++);
  game.events.on('takedown', () => takedowns++);
  game.events.on('shot', (s) => { if (s.shooter.team === 'crew') shots++; });
  game.events.on('hit', (e) => { if (e.target === game.player.walker) hits++; });
  const t0 = process.hrtime.bigint();
  step(game, [crew], 60 * 120, (gm, k) => {
    steps++;
    if (k % 6 === 0) playerShoots(gm, 35);
    maxSlots = Math.max(maxSlots, slotsInUse(gm, gm.time));
    for (const m of crew.members) assert.ok(finite(m.x, m.z, m.hp, m.vx, m.vz, m.aimT), 'finite member');
    assert.ok(finite(gm.player.walker.x, gm.player.walker.z, gm.player.walker.hp));
  });
  const ms = Number(process.hrtime.bigint() - t0) / 1e6 / steps;
  return {
    game, crew, g, playerDowns, takedowns, shots, hits, maxSlots, ms, steps,
    summary: g.members.map((m) => [m.x.toFixed(3), m.z.toFixed(3), m.hp.toFixed(2), m.life, m.state].join(',')).join('|') +
      `|p${game.player.walker.x.toFixed(3)},${game.player.walker.hp.toFixed(2)}|${shots}|${hits}|${takedowns}|${playerDowns}`,
  };
}

test('six versus one: 120 s resolve with no NaN, slots and LOS budget held', () => {
  const r = sixVersusOne(11);
  assert.equal(r.steps, 7200);
  assert.ok(r.shots > 20, `${r.shots} crew shots`);
  assert.ok(r.hits > 0 && r.hits < r.shots, `${r.hits} hits of ${r.shots}`);
  assert.ok(r.takedowns + r.playerDowns > 0, `takedowns ${r.takedowns}, player downs ${r.playerDowns}`);
  assert.ok(r.maxSlots <= ATTACK_SLOTS, `${r.maxSlots} slots`);
  assert.ok(r.game.losBudget.peak <= LOS_PER_STEP, `LOS peak ${r.game.losBudget.peak}`);
  assert.ok(r.ms < 2, `${r.ms.toFixed(3)} ms per step in node`);
  console.log(`# 6v1: ${r.summary}; ${r.ms.toFixed(3)} ms/step`);
});

test('determinism: the same seed gives the same fight', () => {
  const a = sixVersusOne(4), b = sixVersusOne(4);
  assert.equal(a.summary, b.summary);
});

test('caps: at most 8 crew, actor cap respected, freed slots are reused', () => {
  const { city, collision } = yard();
  const game = makeFightGame({ city, collision, px: 100, pz: 100 });
  const crew = createCrew(game, { ambient: false });
  for (let i = 0; i < 5; i++) crew.spawnGroup({ x: i * 5, z: 0, n: 3 });
  assert.equal(crew.members.length, CREW_MAX);
  assert.equal(game.actors.filter((a) => a.team === 'crew').length, CREW_MAX);
  assert.equal(crew.spawnGroup({ x: 0, z: 0, n: 2 }), null, 'pool empty');
  crew.despawn(crew.groups[0]);
  assert.equal(crew.members.length, CREW_MAX - 3);
  const g = crew.spawnGroup({ x: 0, z: 0, n: 2 });
  assert.equal(g.members.length, 2);
  // Actor cap (36) reached: spawning stops there.
  crew.clear();
  assert.equal(crew.members.length, 0);
  while (game.actors.length < CAPS.actors - 2) addActor(game, initActor({ x: 900, z: 900, y: 0, radius: 0.35 }, 'civ'));
  const g2 = crew.spawnGroup({ x: 0, z: 0, n: 5 });
  assert.equal(g2.members.length, 2);
  assert.equal(game.actors.length, CAPS.actors);
  // Attack slots: never more than three holders.
  const rng = createRng(1);
  const as = [0, 1, 2, 3, 4].map(() => placeFootActor(Object.assign(createFootActor('crew', rng), { active: true }), 0, 0));
  const got = as.map((a) => takeSlot(game, a, 10, 3));
  assert.deepEqual(got, [true, true, true, false, false]);
  releaseSlot(game, as[1]);
  assert.equal(takeSlot(game, as[3], 10, 3), true);
  assert.equal(takeSlot(game, as[4], 14, 3), true, 'expired holds free up');
  assert.ok(slotsInUse(game, 14) <= ATTACK_SLOTS);
});

test('crew hits on the player are scaled by 0.6', () => {
  const { city, collision } = yard();
  const game = makeFightGame({ city, collision, px: 3, pz: 0 });
  const crew = createCrew(game, { ambient: false, seed: 3 });
  const g = crew.spawnGroup({ x: 0, z: 0, n: 1, hostile: true, weapon: 'pistol' });
  const amounts = [];
  game.events.on('hit', (h) => { if (h.target === game.player.walker) amounts.push(h.amount); });
  step(game, [crew], 60 * 8);
  assert.ok(g.members[0].shots > 0);
  assert.ok(amounts.length > 0, 'hit at 3 m');
  assert.ok(amounts.every((a) => Math.abs(a - 25 * PLAYER_DMG_MULT) < 1e-9 || a < 15), amounts.join());
});

test('mission API: tags, orders and status; despawn frees everything', () => {
  const { city, collision } = yard();
  const game = makeFightGame({ city, collision, px: 60, pz: 0 });
  const crew = createCrew(game, { ambient: false });
  const g = crew.spawnGroup({ x: 0, z: 0, n: 3, tag: 'van' });
  assert.equal(crew.status('van').alive, 3);
  assert.equal(crew.byTag('van').length, 3);
  crew.order('van', 'attack');
  assert.equal(g.hostile, true);
  step(game, [crew], 30);
  assert.equal(crew.status('van').engaged, 3);
  crew.order('van', 'flee');
  assert.equal(crew.status('van').fled, 3);
  crew.order('van', 'patrol');
  assert.equal(crew.status('van').fled, 0);
  assert.equal(crew.despawn('van'), 1);
  assert.equal(crew.members.length, 0);
  assert.equal(game.actors.filter((a) => a.team === 'crew').length, 0);
});

test('crew car: chases a player in a car and shoots from it; gets out to fight on foot', () => {
  const { city, collision } = cityAndCollision();
  const e = city.edges.find((x) => x.avenue && x.length > 160);
  const a = city.nodes[e.a], b = city.nodes[e.b];
  const ux = (b.x - a.x) / e.length, uz = (b.z - a.z) / e.length;
  const h = Math.atan2(uz, ux);
  const game = makeFightGame({ city, collision, px: a.x + ux * 120, pz: a.z + uz * 120 });
  const car = createVehicle('sedan', game.player.x, game.player.z, h);
  car.driver = 'player';
  game.addVehicle(car);
  game.player.vehicle = car;
  const crew = createCrew(game, { ambient: false, seed: 9 });
  const g = crew.spawnGroup({ x: a.x + ux * 60, z: a.z + uz * 60, heading: h, n: 2, car: 'sedan', drive: 'chase', hostile: true });
  assert.ok(g && g.car && g.members.every((m) => m.inCar === g.car));
  let minD = Infinity, carShots = 0;
  game.events.on('shot', (s) => { if (s.shooter.team === 'crew') carShots++; });
  step(game, [crew], 60 * 25, (gm) => {
    for (const v of gm.vehicles) stepVehicle(v, v === car ? { steer: 0, throttle: 0, brake: 1, handbrake: true } : v.controls, DT, gm.world);
    minD = Math.min(minD, Math.hypot(g.car.x - car.x, g.car.z - car.z));
  });
  assert.ok(minD < 15, `closest ${minD.toFixed(1)} m`);
  assert.ok(carShots > 0, 'drive-by shots');
  // The player gets out: the crew stop and get out too.
  game.player.vehicle = null;
  car.driver = null;
  game.player.walker.x = car.x + 3;
  game.player.walker.z = car.z + 3;
  step(game, [crew], 60 * 2, (gm) => {
    for (const v of gm.vehicles) stepVehicle(v, v.controls, DT, gm.world);
  });
  assert.ok(g.members.every((m) => !m.inCar), g.members.map((m) => m.state).join());
  assert.ok(g.members.some((m) => m.state === 'engage'), g.members.map((m) => m.state + ':' + m.life).join());
});
