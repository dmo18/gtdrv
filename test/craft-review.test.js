// 0.13.4 craft review (boats, aircraft, tanks, the fleet, the chase camera):
// the defects found by driving each craft in the Miami regions, one check
// each.
//  1. "Cannot die" floor: crash damage to the player's boat, tank or
//     aircraft goes through the damage rule like a car's (combat.js
//     CRASH_FLOOR); others and Hard mode keep the full damage.
//  2. A heli settling onto a parked car or a bench drifts off it and
//     lands on the ground (it perched 1.4 m up, where game.js refuses
//     the exit); roofs are landed on as before.
//  3. Boat berths: the fleet moors each boat alongside its pier, so the
//     player can step out where the boat was found.
//  4. Chase camera: the eased position never stays inside a building
//     (snap beside a tower, a heli's slow follow).
import test from 'node:test';
import assert from 'node:assert/strict';
import { RULES } from '../src/core/weapons.js';
import { createEvents } from '../src/core/events.js';
import { createCollisionWorld } from '../src/world/collision.js';
import { createWalker, exitPosition } from '../src/entities/onfoot.js';
import { createCombat, CRASH_FLOOR } from '../src/systems/combat.js';
import { createBoat, stepBoat, BOAT_SPECS } from '../src/entities/boat.js';
import { createTank, stepTank } from '../src/entities/tank.js';
import { createAircraft, stepAircraft, PERCH_MIN } from '../src/entities/aircraft.js';
import { mooredBerth, BERTH_GAP } from '../src/systems/fleet.js';
import { createChaseCamera } from '../src/render/chasecam.js';

const DT = 1 / 60;

// Ground craft: land everywhere, a wall box at x 20..30. Boats (sea):
// water west of x = 60, land east of it. createCombat sets the damage rule.
function makeGame(sea = false) {
  const collision = createCollisionWorld();
  if (!sea) collision.addBox(20, -40, 30, 40, 4, 'building');
  const city = sea
    ? { nodes: [], edges: [], spawn: { x: 0, z: 0, heading: 0 }, isGround: (x) => x > 60, shoreDist: (x) => x - 60 }
    : { nodes: [], edges: [], spawn: { x: 0, z: 0, heading: 0 }, isGround: () => true, shoreDist: () => 500 };
  const walker = createWalker(-500, -500, 0);
  const game = {
    events: createEvents(), collision, city, world: { collision, city, time: 0, crafts: null }, seaY: -0.6,
    vehicles: [], actors: [], time: 0,
    player: { mode: 'foot', vehicle: null, walker, x: walker.x, z: walker.z, y: 0, health: 100, wanted: 0 },
    progress: { money: 0, stats: {} }, input: null,
  };
  createCombat(game, { seed: 5 });
  game.world.crafts = game.vehicles;
  return game;
}
const withRules = (invulnerable, fn) => {
  const before = RULES.invulnerable;
  RULES.invulnerable = invulnerable;
  try { return fn(); } finally { RULES.invulnerable = before; }
};
const seat = (game, c) => {
  game.vehicles.push(c);
  game.player.vehicle = c;
  game.player.mode = c.kind;
  c.driver = 'player';
};

// A boat at full speed into the shore (x = 60), `n` times.
function ramShore(game, b, n) {
  for (let k = 0; k < n; k++) {
    b.x = b.px = 30; b.z = b.pz = 0; b.heading = 0; b.yawRate = 0;
    b.vx = b.spec.maxSpeed; b.vz = 0;
    for (let i = 0; i < 120; i++) stepBoat(b, { throttle: 1, steer: 0, brake: 0 }, DT, game.world);
  }
}

test('cannot-die floor: the player\'s boat rammed into the shore 40 times keeps CRASH_FLOOR and drives; another boat and Hard mode still wreck', () => {
  withRules(true, () => {
    const game = makeGame(true);
    const b = createBoat('jetski', 30, 0, 0);
    seat(game, b);
    const h0 = b.health;
    ramShore(game, b, 1);
    assert.ok(b.health < h0, 'a crash still dents it');
    ramShore(game, b, 39);
    assert.ok(b.health >= b.spec.health * CRASH_FLOOR - 1e-9, `health ${b.health}`);
    assert.equal(b.wrecked, false);
    // Not the player's: full damage.
    const other = createBoat('jetski', 30, 0, 0);
    ramShore(game, other, 40);
    assert.equal(other.wrecked, true, 'a boat nobody drives is wrecked');
  });
  withRules(false, () => {
    const game = makeGame(true);
    const b = createBoat('jetski', 30, 0, 0);
    seat(game, b);
    ramShore(game, b, 40);
    assert.equal(b.wrecked, true, 'Hard mode wrecks it');
  });
});

test('cannot-die floor: the player\'s tank into a wall 300 times at top speed is never wrecked; Hard mode wrecks it', () => {
  for (const inv of [true, false]) {
    withRules(inv, () => {
      const game = makeGame();
      const t = createTank('rustback', 0, 0, 0);
      seat(game, t);
      for (let k = 0; k < 300; k++) {
        t.x = t.px = 12; t.z = t.pz = 0; t.heading = 0; t.yawRate = 0;
        t.vx = t.spec.maxSpeed; t.vz = 0;
        for (let i = 0; i < 40; i++) stepTank(t, { throttle: 1, brake: 0, steer: 0 }, DT, game.world);
      }
      if (inv) {
        assert.ok(t.health >= t.spec.health * CRASH_FLOOR - 1e-9, `health ${t.health}`);
        assert.equal(t.wrecked, false);
      } else assert.equal(t.wrecked, true);
    });
  }
});

test('cannot-die floor: taxi bumps never wreck the player\'s plane; a real crash still does', () => {
  withRules(true, () => {
    const game = makeGame();
    const a = createAircraft('prop', 0, 0, 0);
    seat(game, a);
    for (let k = 0; k < 40; k++) {
      a.x = a.px = 12; a.z = a.pz = 0; a.heading = 0; a.speed = 7.5; a.onGround = true; a.y = 0;
      for (let i = 0; i < 90; i++) stepAircraft(a, { throttle: 0, brake: 0, steer: 0, pitch: 0 }, DT, game.world);
    }
    assert.ok(a.health < a.spec.health, 'the bumps still cost');
    assert.ok(a.health >= a.spec.health * CRASH_FLOOR - 1e-9, `health ${a.health}`);
    assert.equal(a.wrecked, false);
    // Over CRASH_CLOSE it is a crash, cannot-die or not.
    a.x = a.px = 12; a.speed = 20; a.health = a.spec.health;
    for (let i = 0; i < 90; i++) stepAircraft(a, { throttle: 0, brake: 0, steer: 0, pitch: 0 }, DT, game.world);
    assert.equal(a.wrecked, true);
  });
  withRules(false, () => {
    const game = makeGame();
    const a = createAircraft('prop', 0, 0, 0);
    seat(game, a);
    for (let k = 0; k < 40 && !a.wrecked; k++) {
      a.x = a.px = 12; a.z = a.pz = 0; a.heading = 0; a.speed = 7.5; a.onGround = true; a.y = 0;
      for (let i = 0; i < 90; i++) stepAircraft(a, { throttle: 0, brake: 0, steer: 0, pitch: 0 }, DT, game.world);
    }
    assert.equal(a.wrecked, true, 'Hard mode: the bumps add up');
  });
});

// A heli coming straight down with the brake held over (x, z).
function settle(world, x, z, spec = 'heli') {
  const h = createAircraft(spec, x, z, 0);
  h.driver = 'player';
  h.onGround = false;
  h.placed = true;
  h.y = 25;
  h.rotorSpeed = 1;
  for (let i = 0; i < 60 * 30 && !h.onGround; i++) stepAircraft(h, { steer: 0, pitch: 0, throttle: 0, brake: 1 }, DT, world);
  return h;
}

test('a heli settling onto a parked car or a bench drifts off it and lands on the ground; roofs and pads as before', () => {
  const world = { collision: createCollisionWorld() };
  world.collision.addBox(-2.3, -0.9, 2.3, 0.9, 1.4, 'car'); // a bay car, center under the heli
  world.collision.addBox(9, -0.3, 11, 0.3, 0.9, 'bench');
  world.collision.addBox(40, -10, 60, 10, PERCH_MIN + 1, 'kiosk roof');
  for (const [x, z] of [[0, 0], [1.5, 0.4], [-2, -0.5], [10, 0]]) {
    const h = settle(world, x, z);
    assert.ok(h.onGround && !h.wrecked, `landed at ${x},${z}`);
    assert.equal(h.y, 0, `on the ground beside it, not perched (${x},${z}: y ${h.y})`);
    assert.ok(Math.hypot(h.x - x, h.z - z) < 4, 'a short drift');
    assert.equal(h.health, h.spec.health, 'no damage from the drift');
  }
  // Clear ground: straight down, not moved.
  const g = settle(world, -30, 20);
  assert.equal(g.x, -30);
  assert.equal(g.z, 20);
  // A roof above PERCH_MIN is a pad.
  const r = settle(world, 50, 0);
  assert.equal(r.y, PERCH_MIN + 1);
  assert.equal(r.x, 50);
});

test('boat berths: the fleet moors every boat type alongside its pier, so the player can step out there', () => {
  // A pier along +x, 5.2 m wide, with its edge rail as the game has it.
  const pier = { x0: 0, x1: 72, z0: -2.6, z1: 2.6 };
  const collision = createCollisionWorld();
  collision.addSegment(0, -2.6, 72, -2.6, 0.1, 1, 'rail');
  collision.addSegment(0, 2.6, 72, 2.6, 0.1, 1, 'rail');
  const city = { isGround: (x, z) => x >= pier.x0 && x <= pier.x1 && z >= pier.z0 && z <= pier.z1 };
  const world = { collision, city };
  for (const spec of Object.keys(BOAT_SPECS)) {
    for (const side of [-1, 1]) {
      const berth = { x: 30, z: side * 5.8, heading: 0, spec }; // as world/miami.js addPier
      const m = mooredBerth(berth, [pier]);
      const b = createBoat(spec, m.x, m.z, 0);
      const gap = Math.abs(m.z) - BOAT_SPECS[spec].width / 2 - 2.6;
      assert.ok(Math.abs(gap - BERTH_GAP) < 1e-9, `${spec} gap ${gap}`);
      assert.equal(m.x, 30, 'slides sideways only');
      assert.ok(exitPosition(b, world).ok, `${spec} on side ${side}: the step out lands on the pier`);
      assert.equal(exitPosition(createBoat(spec, berth.x, berth.z, 0), world).ok, false, 'the old berth had no way out');
    }
  }
  // Far from any pier (an open water berth): unchanged.
  const lone = mooredBerth({ x: 30, z: 40, spec: 'speedboat' }, [pier]);
  assert.equal(lone.z, 40);
});

function fakeCamera() {
  const position = { x: 0, y: 0, z: 0, set(x, y, z) { this.x = x; this.y = y; this.z = z; } };
  const noop = () => {};
  return { fov: 62, near: 0.5, aspect: 2.2, position, lookAt: noop, rotateX: noop, rotateY: noop, rotateZ: noop, updateProjectionMatrix: noop };
}

test('chase camera: never left inside a tower beside the craft (heli snap, slow follow), still clear in the open', () => {
  const collision = createCollisionWorld();
  collision.addBox(-40, -20, -6, 20, 59, 'tower'); // its wall 6 m behind a heli facing +x
  const cam = fakeCamera();
  const chase = createChaseCamera(cam);
  chase.setMode('heli');
  const tgt = { x: 0, z: 0, y: 16, heading: 0, pitch: 0, roll: 0, speed: 0, height: 1.2 };
  const inside = () => collision.heightAt(cam.position.x, cam.position.z) > cam.position.y;
  // The first frame: snap (no world yet), then the updates pull it out at once.
  chase.snap(tgt);
  for (let i = 0; i < 60; i++) {
    chase.update(tgt, DT, null, collision);
    assert.equal(inside(), false, `frame ${i}: camera at ${cam.position.x.toFixed(1)}, ${cam.position.y.toFixed(1)}`);
  }
  // A snap now knows the world too.
  chase.snap(tgt);
  assert.equal(inside(), false, 'snap');
  // Turning round past the tower: the eased point lags, never inside.
  for (let i = 0; i < 240; i++) {
    tgt.heading = Math.sin(i / 40) * 2.5;
    chase.update(tgt, DT, null, collision);
    assert.equal(inside(), false, `turn frame ${i}`);
  }
  // In the open the camera sits at its full distance as before.
  tgt.x = 200; tgt.heading = 0;
  chase.snap(tgt);
  for (let i = 0; i < 120; i++) chase.update(tgt, DT, null, collision);
  assert.ok(Math.abs(Math.hypot(cam.position.x - tgt.x, cam.position.z - tgt.z) - 15) < 0.3);
});
