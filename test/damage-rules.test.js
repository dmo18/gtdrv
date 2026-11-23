// Damage and death (docs/PLAN_V3.md 2.3, section 6 item 7): in the default
// "cannot die" mode 50 crashes at 60 mph leave the player's car driveable;
// Hard mode keeps crash damage (none under 11 mph) and a crash wreck lets
// the player out without a blast; crash damage alone never starts a fire;
// no car explodes without 8 s of fire; people and cars meet by the car's
// speed only (a nudge, a stumble, a knock-down over 15 mph); a person never
// hurts a car; no star for contact under 11 mph.
import test from 'node:test';
import assert from 'node:assert/strict';
import { RULES } from '../src/core/weapons.js';
import { createEvents } from '../src/core/events.js';
import { createCollisionWorld } from '../src/world/collision.js';
import { createVehicle, stepVehicle, collideVehicles, impactDamage, CRASH_MIN, MASS_SHARE, PROP_BREAK_DAMAGE } from '../src/entities/vehicle.js';
import { createWalker, stepWalker } from '../src/entities/onfoot.js';
import { propShapes } from '../src/world/propsolid.js';
import {
  createCombat, damage, initActor, addActor, BURN_T, BURN_BELOW, CRASH_FLOOR, KNOCK_MPH, NUDGE_MPH, RAM_DMG_PER_MPH,
} from '../src/systems/combat.js';
import { isRam, RAM_SPEED, STAR_CONTACT_MPH } from '../src/systems/police.js';

const DT = 1 / 60, MPH = 2.23694;

function makeGame() {
  const collision = createCollisionWorld();
  collision.addBox(20, -40, 30, 40, 4, 'building'); // a wall to crash into
  const nodes = [{ id: 0, x: -50, z: 0 }, { id: 1, x: 50, z: 50 }];
  const city = { nodes, edges: [], spawn: { x: 0, z: 0, heading: 0 }, isGround: () => true, shoreDist: () => 500 };
  const walker = createWalker(-100, -100, 0);
  const game = {
    events: createEvents(), collision, city, world: { collision, city, time: 0, crafts: null }, seaY: -0.6,
    vehicles: [], actors: [], time: 0,
    player: { mode: 'foot', vehicle: null, walker, x: walker.x, z: walker.z, y: 0, health: 100, wanted: 0 },
    progress: { money: 0, stats: {} },
    input: null,
  };
  createCombat(game, { seed: 3 });
  game.world.crafts = game.vehicles;
  return game;
}
const record = (game, name) => {
  const list = [];
  game.events.on(name, (e) => list.push(e && typeof e === 'object' ? { ...e } : e));
  return list;
};
const withRules = (invulnerable, fn) => {
  const before = RULES.invulnerable;
  RULES.invulnerable = invulnerable;
  try { return fn(); } finally { RULES.invulnerable = before; }
};
// One run into the wall at `mph`, head on; returns the closing speed met.
function crash(game, car, mph) {
  car.x = car.px = 10;
  car.z = car.pz = 0;
  car.heading = 0;
  car.yawRate = 0;
  car.vx = mph / MPH;
  car.vz = 0;
  let close = 0;
  for (let i = 0; i < 40; i++) {
    stepVehicle(car, { throttle: 0 }, DT, game.world);
    close = Math.max(close, car.impact);
    game.combat.fixedUpdate(DT);
  }
  return close;
}
function seat(game, car) {
  game.vehicles.push(car);
  game.player.vehicle = car;
  game.player.mode = 'car';
  car.driver = 'player';
}

test('default mode: 50 crashes at 60 mph leave the player\'s car driveable (never under 15 percent, never wrecked)', () => withRules(true, () => {
  const game = makeGame();
  const car = createVehicle('sedan', 10, 0, 0);
  seat(game, car);
  const max = car.spec.health;
  const ex = record(game, 'explosion'), burn = record(game, 'burning');
  const h0 = car.health;
  const c0 = crash(game, car, 60);
  const lost = h0 - car.health;
  console.log(`# default mode, one 60 mph crash (closing ${(c0 * MPH).toFixed(0)} mph): ${lost.toFixed(0)} of ${max} health lost (${((lost / max) * 100).toFixed(0)} %)`);
  for (let k = 1; k < 50; k++) crash(game, car, 60);
  console.log(`# default mode, after 50 crashes at 60 mph: ${((car.health / max) * 100).toFixed(1)} % health, wrecked ${car.wrecked}`);
  assert.ok(car.health >= max * CRASH_FLOOR - 1e-9, `health ${car.health}`);
  assert.equal(car.wrecked, false);
  assert.equal(game.player.vehicle, car, 'still in it');
  assert.equal(ex.length + burn.length, 0, 'no fire, no blast');
  // It still drives.
  car.x = 0; car.vx = 0;
  for (let i = 0; i < 120; i++) stepVehicle(car, { throttle: 1 }, DT, game.world);
  assert.ok(car.speed > 3, `drives (${car.speed.toFixed(1)} m/s)`);
}));

test('Hard mode: crash damage as before, none under 11 mph; a crash wreck lets the player out and never explodes', () => withRules(false, () => {
  const game = makeGame();
  const car = createVehicle('sedan', 10, 0, 0);
  seat(game, car);
  const h0 = car.health;
  crash(game, car, 10);
  assert.equal(car.health, h0, 'no damage at 10 mph');
  assert.ok(CRASH_MIN * MPH > 10.99 && CRASH_MIN * MPH < 11.01);
  assert.equal(impactDamage(CRASH_MIN), 0);
  const c = crash(game, car, 60);
  assert.ok(Math.abs(h0 - car.health - impactDamage(c)) < 1e-6, 'the impact table');
  const ex = record(game, 'explosion'), burn = record(game, 'burning');
  let n = 0;
  while (!car.wrecked && n++ < 20) crash(game, car, 60);
  assert.ok(car.wrecked && car.crashWreck, 'wrecked by crashes');
  for (let i = 0; i < 60 * (BURN_T + 2); i++) game.combat.fixedUpdate(DT);
  assert.equal(game.player.vehicle, null, 'the player got out');
  assert.equal(ex.length, 0, 'no blast');
  assert.equal(burn.length, 0, 'no fire');
}));

test('crash damage alone never lights a car; a weapon under 20 percent does, and it burns 8 s before it explodes', () => withRules(false, () => {
  const game = makeGame();
  const car = createVehicle('sedan', 10, 0, 0);
  game.vehicles.push(car);
  car.traffic = true;
  const max = car.spec.health;
  let n = 0;
  while (car.health > max * 0.1 && n++ < 20) crash(game, car, 45);
  assert.ok(car.health < max * BURN_BELOW && !car.wrecked, `crashed down to ${car.health.toFixed(0)}`);
  for (let i = 0; i < 60 * 10; i++) game.combat.fixedUpdate(DT);
  assert.ok(!car.burning, 'crashes alone: no fire');
  const ex = record(game, 'explosion');
  damage(game, car, 1e6, null, 'bullet');
  assert.ok(!car.wrecked && car.health > 0, 'a weapon at 0: alight first');
  let t = 0;
  while (!car.wrecked && t < 60 * 12) { game.combat.fixedUpdate(DT); t++; }
  assert.ok(car.wrecked && ex.length === 1, 'then it blows');
  assert.ok(t / 60 >= BURN_T - 0.02, `after ${(t / 60).toFixed(2)} s of fire`);
  // A full-health car hit by a huge blast: still fire first.
  const other = createVehicle('sedan', -30, 30, 0);
  game.vehicles.push(other);
  damage(game, other, 1e6, null, 'blast');
  assert.ok(!other.wrecked);
  for (let i = 0; i < 60 * 2; i++) game.combat.fixedUpdate(DT);
  assert.ok(other.burning && !other.wrecked, 'burning, not yet blown');
}));

// People and cars: a car at `mph` moving at the actor, contact made by the
// walker's own step (it records the car's speed toward it).
function carInto(game, a, mph, parked = false) {
  const car = createVehicle('sedan', a.x - 1.5, a.z, 0);
  car.vx = parked ? 0 : mph / MPH;
  if (!parked) car.driver = 'ai';
  game.vehicles.push(car);
  return car;
}
function bumpStep(game, w, car) {
  // The walker's own step finds the car overlapping it (as each frame).
  stepWalker(w, { moveX: 0, moveY: 0 }, DT, game.world);
  game.combat.fixedUpdate(DT);
  game.vehicles.splice(game.vehicles.indexOf(car), 1);
}

test('a walker sprinting into a parked car: no fall, no damage, the car unhurt, in both modes', () => {
  for (const inv of [true, false]) withRules(inv, () => {
    const game = makeGame();
    const w = game.player.walker;
    w.x = w.px = 0; w.z = w.pz = 0;
    const car = createVehicle('sedan', 4, 0, 0);
    car.health = 1; // even a wreck-to-be
    game.vehicles.push(car);
    for (let i = 0; i < 90; i++) {
      stepWalker(w, { moveX: 0, moveY: 1, sprint: true }, DT, game.world, 0);
      game.combat.fixedUpdate(DT);
    }
    assert.ok(w.x > 1.5, 'ran up to it');
    assert.equal(w.life, 'ok', `mode ${inv}: no fall`);
    assert.equal(w.hp, 100, 'no damage');
    assert.equal(car.health, 1, 'a person never hurts a car');
    assert.equal(car.wrecked, false);
  });
});

test('a car at 10 mph into the player: no fall in either mode; Hard mode table of 2.3 item 5', () => {
  assert.equal(NUDGE_MPH, 5);
  assert.equal(KNOCK_MPH, 15);
  for (const inv of [true, false]) withRules(inv, () => {
    const game = makeGame();
    const w = game.player.walker;
    w.x = w.px = 0; w.z = w.pz = 0;
    const car = carInto(game, w, 10);
    bumpStep(game, w, car);
    assert.ok(w.stumbleT > 0, 'the contact was made (a stumble)');
    for (let i = 0; i < 30; i++) game.combat.fixedUpdate(DT);
    assert.equal(w.life, 'ok', `invulnerable ${inv}: a 10 mph car does not knock the player down`);
    assert.equal(w.hp, 100);
  });
  // The table, Hard mode, the player: mph -> [down, damage].
  withRules(false, () => {
    const rows = [[3, false, 0], [10, false, 0], [14, false, 0], [20, true, (20 - 15) * RAM_DMG_PER_MPH], [30, true, (30 - 15) * RAM_DMG_PER_MPH]];
    for (const [mph, down, dmg] of rows) {
      const game = makeGame();
      const w = game.player.walker;
      w.x = w.px = 0; w.z = w.pz = 0;
      const car = carInto(game, w, mph);
      bumpStep(game, w, car);
      assert.equal(w.life !== 'ok', down, `${mph} mph: down ${down}`);
      assert.ok(Math.abs(100 - w.hp - dmg) < 0.5, `${mph} mph: damage ${100 - w.hp}, want ${dmg}`);
      console.log(`# Hard mode, a car at ${mph} mph into the player: ${down ? 'knocked down' : 'stays up'}, ${(100 - w.hp).toFixed(0)} damage`);
    }
  });
  // Default mode: never hurt, even at 30 mph.
  withRules(true, () => {
    const game = makeGame();
    const w = game.player.walker;
    w.x = w.px = 0; w.z = w.pz = 0;
    bumpStep(game, w, carInto(game, w, 30));
    assert.equal(w.life, 'ok');
    assert.equal(w.hp, 100);
  });
});

test('a pedestrian: a nudge under 5 mph, a stumble (no damage) to 15 mph, knocked down over it; a parked car hurts nobody', () => withRules(true, () => {
  const ped = (game) => {
    const a = initActor({ x: 0, z: 0, y: 0, heading: 0, radius: 0.35, px: 0, pz: 0, vx: 0, vz: 0 }, 'civ');
    addActor(game, a);
    return a;
  };
  const hit = (mph, parked = false) => {
    const game = makeGame();
    const a = ped(game);
    const car = carInto(game, a, mph, parked);
    a.bumpBy = car;
    a.bumpV = car.vx;
    game.combat.fixedUpdate(DT);
    return a;
  };
  const a4 = hit(4);
  assert.ok(a4.life === 'ok' && a4.hp === a4.maxHp && !a4.stumbleT, 'a nudge');
  const a10 = hit(10);
  assert.ok(a10.life === 'ok' && a10.hp === a10.maxHp && a10.stumbleT > 0, 'a stumble');
  const a20 = hit(20);
  assert.ok(a20.life !== 'ok', 'knocked down');
  const ap = hit(30, true);
  assert.ok(ap.life === 'ok' && ap.hp === ap.maxHp, 'a parked car');
}));

test('car on car: by the closing speed, the lighter car at most 1.3 times an even share', () => {
  const a = createVehicle('compact', 0, 0, 0), b = createVehicle('truck', 5.4, 0, Math.PI);
  a.vx = 10;
  b.vx = -10;
  assert.ok(collideVehicles(a, b));
  const close = Math.max(a.impact, b.impact);
  const even = impactDamage(close);
  const la = a.spec.health - a.health, lb = b.spec.health - b.health;
  assert.ok(la <= even * MASS_SHARE[1] + 1e-6 && lb >= even * MASS_SHARE[0] - 1e-6, `${la.toFixed(0)} / ${lb.toFixed(0)} of ${even.toFixed(0)}`);
});

test('props: shearing one costs nothing in the default mode, a small knock in Hard mode', () => {
  for (const [inv, want] of [[true, 0], [false, PROP_BREAK_DAMAGE]]) withRules(inv, () => {
    const game = makeGame();
    const list = [];
    propShapes('lamp', 0, 0, 0, 0, list);
    game.collision.addLayer({ name: 'lamp', cell: () => list });
    const car = createVehicle('sedan', -14, 0, 0);
    seat(game, car);
    car.vx = 30 / MPH;
    const ev = record(game, 'propBreak');
    for (let i = 0; i < 90; i++) {
      stepVehicle(car, { throttle: 1 }, DT, game.world);
      game.combat.fixedUpdate(DT);
    }
    assert.equal(ev.length, 1, 'one propBreak event');
    assert.equal(ev[0].type, 'lamp');
    assert.equal(ev[0].byPlayer, true);
    assert.equal(car.spec.health - car.health, want, `invulnerable ${inv}`);
  });
});

test('wanted stars: no star for contact under 11 mph, none for breaking props', () => {
  assert.equal(STAR_CONTACT_MPH, 11);
  assert.ok(RAM_SPEED * MPH >= STAR_CONTACT_MPH, 'the ram threshold is above 11 mph');
  const p = { x: 0, z: 0, px: -10.9 / MPH / 60, pz: 0 };
  const o = { x: 5, z: 0, px: 5, pz: 0, traffic: true };
  assert.equal(isRam(p, o, 10.9 / MPH), false, 'a 10.9 mph contact');
  p.px = -20 / MPH / 60;
  assert.equal(isRam(p, o, 20 / MPH), true, 'a 20 mph ram counts');
  // Breaking props emits only 'propBreak', which the police never hear.
  const src = (f) => import('node:fs').then((fs) => fs.readFileSync(new URL(`../src/systems/${f}`, import.meta.url), 'utf8'));
  return src('police.js').then((s) => assert.ok(!/propBreak/.test(s), 'police do not listen to prop breaks'));
});
