// 0.13.5 on-foot review: the defects found walking, fighting and getting
// in and out of craft in the Miami regions (node harnesses on the real
// city, docs/STATUS.md "0.13.5 on-foot review"), one check each.
//  1. Step out: never past a garden fence or hedge beside the car.
//  2. ENTER: never a car on the far side of a fence or a wall.
//  3. Shots and sight: a building behind a bench or a parked (bay) car
//     still stops them.
//  4. Melee: no swing through a wall; a person beside a parked car takes
//     the swing the aim turned toward, not the car.
//  5. Aim assist: a bystander nearer in the cone no longer takes the
//     shots meant for a shooter.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createEvents } from '../src/core/events.js';
import { createCollisionWorld } from '../src/world/collision.js';
import { createVehicle } from '../src/entities/vehicle.js';
import { createBoat } from '../src/entities/boat.js';
import { createWalker, stepWalker, findEnterable, exitPosition, STEP_OVER } from '../src/entities/onfoot.js';
import { createArms } from '../src/core/weapons.js';
import { lineOfSight, pickAssist, ASSIST_BYSTANDER } from '../src/core/aim.js';
import { createCombat, initActor, addActor, trace, createTraceResult, HP } from '../src/systems/combat.js';

const flat = { isGround: () => true, nodes: [], edges: [] };
const picketFence = (col, x0, x1, z, h = 1.5) => {
  for (let x = x0; x <= x1; x += 0.3) col.addCircle(x, z, 0.15, h, 'lot');
};

test('step out: never past a fence or hedge beside the car; a low sea wall or a pier rail is stepped over', () => {
  const col = createCollisionWorld();
  const car = createVehicle('sedan', 0, 0, 0); // left (driver) side is -z
  // A 1.5 m hedge 0.3 m off the car's left side: the old spot (0.8 m out)
  // was clear of it, on the yard side.
  picketFence(col, -4, 4, -(car.spec.width / 2 + 0.3));
  const world = { collision: col, city: flat };
  const out = exitPosition(car, world);
  assert.ok(out.ok);
  assert.ok(out.z > 0, `steps out on the street side, not in the yard (${out.x.toFixed(2)}, ${out.z.toFixed(2)})`);
  assert.ok(col.lineClear(car.x, car.z, out.x, out.z));
  // A sea wall (0.9 m) is not a fence: stepping over it as before.
  const low = createCollisionWorld();
  low.addSegment(-4, -1.15, 4, -1.15, 0.1, 0.9, 'seawall');
  const o2 = exitPosition(car, { collision: low, city: flat });
  assert.ok(o2.ok && o2.z < 0, 'left side over a sea wall');
  assert.ok(STEP_OVER > 0.9);
  // Fenced in on both sides and the ends: no way out, not through a fence.
  picketFence(col, -4, 4, 1.4);
  col.addBox(-6, -2, -3.2, 2, 2);
  col.addBox(3.2, -2, 6, 2, 2);
  assert.equal(exitPosition(car, world).ok, false);
  // From a boat over a 1 m pier rail onto the pier (craft review berths).
  const pier = createCollisionWorld();
  pier.addSegment(-20, 2.6, 20, 2.6, 0.1, 1, 'rail');
  const boat = createBoat('speedboat', 0, 0, Math.PI); // left side is +z
  boat.z = 2.6 - boat.spec.width / 2 - 0.15; // moored as fleet.js mooredBerth
  const ob = exitPosition(boat, { collision: pier, city: { isGround: (x, z) => z > 2.6 } });
  assert.ok(ob.ok && ob.z > 2.6, 'onto the pier');
});

test('ENTER: never a car on the far side of a fence or a wall; the same car in the open is entered', () => {
  const col = createCollisionWorld();
  picketFence(col, -6, 6, 0, 1.5);
  const world = { collision: col, city: flat, crafts: [] };
  const car = createVehicle('sedan', 0, 2.6, 0); // parked behind the hedge
  world.crafts.push(car);
  const w = createWalker(0, -0.6, 0);
  stepWalker(w, null, 1 / 60, world, 0);
  assert.equal(findEnterable(w, world.crafts), null, 'the walker last stepped in this world');
  assert.equal(findEnterable(createWalker(0, -0.6, 0), world.crafts, 3.2, null, col), null, 'explicit world');
  // A low curb post (0.6 m) in between does not stop it.
  const posts = createCollisionWorld();
  posts.addCircle(0, 0, 0.15, 0.6, 'post');
  const w2 = createWalker(0, -0.6, 0);
  stepWalker(w2, null, 1 / 60, { collision: posts, city: flat, crafts: [car] }, 0);
  assert.equal(findEnterable(w2, [car]), car);
  // No world known: as before.
  assert.equal(findEnterable(createWalker(0, -0.6, 0), [car]), car);
});

function makeGame() {
  const collision = createCollisionWorld();
  const nodes = [{ id: 0, x: -100, z: -100 }];
  const city = { nodes, spawn: { x: 0, z: 0, heading: 0 }, isGround: () => true };
  const walker = createWalker(-100, -100, 0);
  const game = {
    events: createEvents(), collision, city, world: { collision, city }, seaY: -0.6,
    vehicles: [], actors: [], time: 0,
    player: { mode: 'foot', vehicle: null, walker, x: walker.x, z: walker.z, y: 0, health: 100, wanted: 0 },
    progress: { money: 0, stats: {} }, input: null,
  };
  createCombat(game, { seed: 3 });
  return game;
}
const person = (game, x, z, team = 'civ') => {
  const a = initActor({ x, z, y: 0, heading: 0, radius: 0.35, px: x, pz: z, vx: 0, vz: 0 }, team);
  addActor(game, a);
  return a;
};

test('shots and sight: a building behind a bench or a bay car still stops them; the open line still hits', () => {
  for (const low of ['bench', 'bay car']) {
    const game = makeGame();
    const col = game.collision;
    if (low === 'bench') col.addBox(4, -1, 4.6, 1, 0.5);
    else col.addBox(4, -1.1, 8.6, 1.1, 1.2); // a parked car's box, 4.6 m long
    col.addBox(10, -6, 20, 6, 12); // the building behind it
    const target = person(game, 22, 0);
    const tr = createTraceResult();
    trace(game, 0, 1.4, 0, 1, 0, 0, 45, null, null, tr);
    assert.equal(tr.kind, 'wall', `${low}: the shot stops at the building`);
    assert.ok(Math.abs(tr.t - 10) < 0.05, `${low}: at its face (${tr.t})`);
    assert.equal(lineOfSight(col, 0, 1.4, 0, 22, 1.1, 0), false, `${low}: no sight through the building`);
    // Without the building: the shot passes over the low solid to the target.
    const g2 = makeGame();
    if (low === 'bench') g2.collision.addBox(4, -1, 4.6, 1, 0.5);
    else g2.collision.addBox(4, -1.1, 8.6, 1.1, 1.2);
    const t2 = person(g2, 22, 0);
    trace(g2, 0, 1.4, 0, 1, 0, 0, 45, null, null, tr);
    assert.equal(tr.kind, 'actor');
    assert.equal(tr.actor, t2);
    assert.equal(lineOfSight(g2.collision, 0, 1.4, 0, 22, 1.1, 0), true);
    assert.equal(target.hp, HP.civ);
  }
});

test('melee: no swing through a wall; a person beside a parked car takes it, the car alone still does', () => {
  const game = makeGame();
  const me = person(game, 0, 0, 'player');
  me.arms = createArms('wrench');
  game.collision.addSegment(0.6, -5, 0.6, 5, 0.1, 2, 'wall');
  const behind = person(game, 1.3, 0);
  game.combat.fire(me, 1, 0, 0);
  assert.equal(behind.hp, HP.civ, 'not through the wall');

  const g2 = makeGame();
  const me2 = person(g2, 0, 0, 'player');
  me2.arms = createArms('wrench');
  const car = createVehicle('sedan', 2.2, 1.6, 0);
  g2.vehicles.push(car);
  const ped = person(g2, 1.2, 0);
  const carHp = car.health;
  g2.combat.fire(me2, 1, 0, 0);
  assert.ok(ped.hp < HP.civ, 'the person is hit');
  assert.equal(car.health, carHp, 'not the car beside them');
  // The car alone: still hit.
  ped.x = 30;
  me2.arms.cool = 0;
  g2.combat.fire(me2, 1, 0.8, 0);
  assert.ok(car.health < carHp, 'the car alone is hit');
});

test('aim assist: a shooter just off center wins over a nearer bystander; a centered bystander alone still bends', () => {
  const eye = { x: 0, y: 1.4, z: 0 }, fwd = { x: 1, y: 0, z: 0 };
  const DEG = Math.PI / 180;
  const self = { x: 0, z: 0, y: 0, hp: 100, team: 'player', life: 'ok', fade: 0 };
  const at = (d, deg, team, extra = {}) => ({ x: Math.cos(deg * DEG) * d, z: Math.sin(deg * DEG) * d, y: 0, hp: 50, team, life: 'ok', fade: 0, ...extra });
  const ctx = (actors, vehicles = []) => ({ actors: [self, ...actors], vehicles, collision: null, self, selfCraft: null, seaY: 0 });
  const civ = at(10, 3, 'civ'), shooter = at(20, 5, 'crew', { attacking: true });
  assert.equal(pickAssist(ctx([civ, shooter]), eye, fwd, eye, { range: 45 }), shooter);
  assert.equal(pickAssist(ctx([civ]), eye, fwd, eye, { range: 45 }), civ);
  // Dead center on the bystander, the shooter at the cone's edge: the bystander.
  const centered = at(10, 0.1, 'civ'), edge = at(20, 7.8, 'crew', { attacking: true });
  assert.equal(pickAssist(ctx([centered, edge]), eye, fwd, eye, { range: 45 }), centered);
  // A traffic car with a civilian at the wheel against a crew gunman.
  const traffic = { x: 9, z: 0.5, y: 0, spec: { height: 1.5 }, health: 100, driver: { civ: true }, kind: 'car' };
  const gun = at(18, 4, 'crew', { attacking: true });
  assert.equal(pickAssist(ctx([gun], [traffic]), eye, fwd, eye, { range: 45 }), gun);
  assert.ok(ASSIST_BYSTANDER > 0 && ASSIST_BYSTANDER < 1);
});
