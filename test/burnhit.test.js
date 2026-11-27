// A burning car held at 1 health that takes a crash hit finishes through the
// combat wreck path (blast, hull), not as a crash wreck.
import test from 'node:test';
import assert from 'node:assert/strict';
import { RULES } from '../src/core/weapons.js';
import { createEvents } from '../src/core/events.js';
import { createCollisionWorld } from '../src/world/collision.js';
import { createVehicle, damageVehicle } from '../src/entities/vehicle.js';
import { createCombat, damage } from '../src/systems/combat.js';

const DT = 1 / 60;

function makeGame() {
  const collision = createCollisionWorld();
  const city = { nodes: [], edges: [], spawn: { x: 0, z: 0, heading: 0 }, isGround: () => true, shoreDist: () => 500 };
  const game = {
    events: createEvents(), collision, city, world: { collision, city, time: 0, crafts: null }, seaY: -0.6,
    vehicles: [], actors: [], time: 0,
    player: { mode: 'foot', vehicle: null, walker: { x: -100, z: -100 }, x: -100, z: -100, y: 0, health: 100, wanted: 0 },
    progress: { money: 0, stats: {} }, input: null,
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

for (const kind of ['crash', 'prop']) {
  test(`burning held car hit by a ${kind} blows through the combat path`, () => {
    const before = RULES.invulnerable;
    RULES.invulnerable = false;
    try {
      const game = makeGame();
      const car = createVehicle('sedan', 10, 0, 0);
      car.traffic = true;
      game.vehicles.push(car);
      const ex = record(game, 'explosion');
      damage(game, car, 1e6, null, 'bullet');
      for (let i = 0; i < 120; i++) game.combat.fixedUpdate(DT);
      assert.ok(car.burning && !car.wrecked && car.health > 0 && car.health <= 1.5, 'held while burning');
      damageVehicle(car, 50, kind);
      assert.ok(!car.crashWreck, 'never a crash wreck');
      for (let i = 0; i < 10; i++) game.combat.fixedUpdate(DT);
      assert.ok(car.wrecked && !car.crashWreck, 'wrecked by the combat path');
      assert.equal(ex.length, 1, 'with a blast');
    } finally {
      RULES.invulnerable = before;
    }
  });
}

test('an unlit car still becomes a crash wreck', () => {
  const car = createVehicle('sedan', 0, 0, 0);
  damageVehicle(car, 1e6, 'crash');
  assert.ok(car.wrecked && car.crashWreck);
});
