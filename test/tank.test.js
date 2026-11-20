// Rustback tank (task 32, docs/ARMS.md section 3): tracked physics, the
// turret, cannon and coax through the combat core, crush and ram rules,
// armour, the AI gunner core, fleet respawn and determinism.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createTank, stepTank, collideTank, TANK_SPECS, TANK_ID0, barrelRay, turretWorldYaw } from '../src/entities/tank.js';
import { createVehicle, stepVehicle } from '../src/entities/vehicle.js';
import { createArmor, createGunner, tankGunnerStep, GUNNER, BAIL_BELOW } from '../src/systems/armor.js';
import { createFleet } from '../src/systems/fleet.js';
import { CRAFT_HOOKS, initActor, canBeHit } from '../src/systems/combat.js';
import { createInput } from '../src/core/input.js';
import { createRng, angleDiff } from '../src/core/rng.js';
import { createCollisionWorld } from '../src/world/collision.js';
import { makeFightGame, yard, step, cityAndCollision, DT } from './fightgame.js';

const ctl = (throttle = 0, brake = 0, steer = 0) => ({ throttle, brake, steer });
const world = (boxes = [], shoreDist = null) => {
  const collision = createCollisionWorld();
  for (const b of boxes) collision.addBox(b[0], b[1], b[2], b[3], b[4] ?? 5, 'building');
  return { collision, city: shoreDist ? { shoreDist, isGround: (x, z) => shoreDist(x, z) > 0 } : null, time: 0 };
};
const run = (t, c, n, w = null) => {
  for (let i = 0; i < n; i++) stepTank(t, c, DT, w);
};
const lateral = (t) => -t.vx * Math.sin(t.heading) + t.vz * Math.cos(t.heading);

// A combat game on a flat yard with the armour system and a tank aboard.
function tankGame({ boxes = [], seed = 3 } = {}) {
  const { city, collision } = yard(boxes);
  city.furniture = [];
  const g = makeFightGame({ city, collision, seed });
  g.input = createInput();
  g.armor = createArmor(g);
  const t = createTank('rustback', 0, 0, 0);
  g.addVehicle(t);
  return { g, t };
}
// Step the craft (tank with controls, cars parked), the pair rule, the
// armour system and combat, in game.js order.
function sim(g, n, controls = null, each = null) {
  const tankSys = {
    fixedUpdate(dt) {
      const vs = g.vehicles;
      for (const v of vs) {
        if (v.kind === 'tank') stepTank(v, v === g.player.vehicle ? controls : v.controls || null, dt, g.world);
        else if (v.kind === 'car') stepVehicle(v, null, dt, g.world);
      }
      for (let i = 0; i < vs.length; i++) {
        for (let j = i + 1; j < vs.length; j++) {
          const a = vs[i], b = vs[j];
          if (a.kind === 'tank') collideTank(a, b);
          else if (b.kind === 'tank') collideTank(b, a);
        }
      }
    },
  };
  step(g, [tankSys, g.armor], n, each);
}
const board = (g, t) => {
  g.player.vehicle = t;
  t.driver = 'player';
};

test('spec and state: original names, ids from 300000, shared craft fields plus turret and tracks', () => {
  const s = TANK_SPECS.rustback;
  assert.equal(s.label, 'Rustback');
  assert.deepEqual([s.length, s.width, s.height, s.health, s.maxSpeed, s.reverseSpeed], [7.2, 3.6, 2.6, 1000, 13, 5]);
  assert.deepEqual(s.mounts, ['cannon', 'coax']);
  assert.deepEqual(s.armor, { bullet: 0.04, melee: 0, ram: 0.15, blast: 0.6, fire: 0.3 });
  assert.equal(s.engine, 'tracks');
  const t = createTank('rustback', 5, 6, 1);
  assert.ok(t.id >= TANK_ID0);
  for (const f of ['x', 'z', 'y', 'heading', 'pitch', 'roll', 'px', 'pz', 'py', 'pheading', 'ppitch', 'proll', 'vx', 'vz', 'vy', 'speed',
    'throttle', 'brake', 'health', 'wrecked', 'impact', 'driver', 'radius', 'color', 'turretYaw', 'gunPitch', 'pturretYaw', 'pgunPitch',
    'aimYaw', 'aimPitch', 'aimSet', 'trackL', 'trackR', 'trackPhase', 'yawRate', 'recoil', 'crewAI', 'bailed']) {
    assert.ok(f in t, f);
  }
  assert.equal(t.kind, 'tank');
  assert.ok(TANK_SPECS.rustbackpolice.police && TANK_SPECS.rustbackpolice.colors[0] === 0x5d6670);
});

test('tracks: accelerates to 13 m/s, brakes, reverses to 5 m/s, coasts to a stop', () => {
  const t = createTank('rustback', 0, 0, 0);
  run(t, ctl(1), 60 * 3);
  assert.ok(t.speed > 6 && t.speed < 10, `3 s: ${t.speed.toFixed(2)}`);
  run(t, ctl(1), 60 * 12);
  assert.ok(t.speed > 12.5 && t.speed <= 13.01, `top ${t.speed.toFixed(2)}`);
  let n = 0;
  while (t.speed > 0.05 && n < 600) {
    stepTank(t, ctl(0, 1), DT, null);
    n++;
  }
  assert.ok(n < 60 * 3, `stops from 13 m/s within 3 s (${n} steps)`);
  run(t, ctl(0, 1), 60 * 6);
  assert.ok(t.speed < -4.8 && t.speed >= -5.01, `reverse ${t.speed.toFixed(2)}`);
  run(t, ctl(), 60 * 6);
  assert.ok(Math.abs(t.speed) < 0.01, 'coasts to a stop');
  run(t, null, 10);
  assert.equal(t.throttle, 0);
});

test('pivot turn on the spot; turns slower at speed; no sideways slip', () => {
  const t = createTank('rustback', 10, 20, 0);
  run(t, ctl(0, 0, 1), 120);
  assert.ok(Math.hypot(t.x - 10, t.z - 20) < 0.02, 'stays in place');
  assert.ok(Math.abs(t.yawRate - 0.9) < 0.01, `pivot rate ${t.yawRate.toFixed(3)}`);
  assert.ok(t.trackL > 0 && t.trackR < 0, 'tracks run opposite ways');
  const fast = createTank('rustback', 0, 0, 0);
  run(fast, ctl(1), 60 * 12);
  run(fast, ctl(1, 0, 1), 120);
  assert.ok(Math.abs(fast.yawRate - 0.55) < 0.03, `rate at speed ${fast.yawRate.toFixed(3)}`);
  for (let i = 0; i < 240; i++) {
    stepTank(fast, ctl(1, 0, i % 120 < 60 ? 1 : -1), DT, null);
    assert.ok(Math.abs(lateral(fast)) < 0.15, `no slip (${lateral(fast).toFixed(3)})`);
  }
  // A blast shove sideways bleeds off at 8 m/s^2.
  const b = createTank('rustback', 0, 0, 0);
  b.vz = 8;
  run(b, ctl(), 30);
  assert.ok(Math.abs(lateral(b) - 4) < 0.2, `half a second later ${lateral(b).toFixed(2)}`);
  run(b, ctl(), 40);
  assert.ok(Math.abs(lateral(b)) < 1e-9);
});

test('walls and the shore stop it; it climbs over kerbs and low walls under 1 m', () => {
  const w = world([[20, -20, 24, 20, 6], [-40, -20, -36, 20, 0.6]]);
  const t = createTank('rustback', 0, 0, 0);
  run(t, ctl(1), 60 * 8, w);
  assert.ok(t.x < 20 - 1.7, `blocked by the wall (${t.x.toFixed(2)})`);
  assert.ok(Math.abs(t.speed) < 1, 'stopped against it');
  const k = createTank('rustback', 0, 0, Math.PI);
  run(k, ctl(1), 60 * 9, w);
  assert.ok(k.x < -45, `rolled over the 0.6 m wall (${k.x.toFixed(1)})`);
  // Sea beyond x = 30.
  const s = world([], (x) => 30 - x);
  const t2 = createTank('rustback', 0, 0, 0);
  run(t2, ctl(1), 60 * 10, s);
  assert.ok(s.city.shoreDist(t2.x, t2.z) > 1, `stays on land (${t2.x.toFixed(1)})`);
});

test('no NaN over thousands of random steps (controls, aims, shoves, walls)', () => {
  const rng = createRng(99);
  const w = world([[30, -30, 34, 30, 5], [-34, -30, -30, 30, 5], [-30, 30, 30, 34, 5], [-30, -34, 30, -30, 5]]);
  const t = createTank('rustback', 0, 0, 0);
  const c = ctl();
  for (let i = 0; i < 8000; i++) {
    if (i % 20 === 0) {
      c.throttle = rng.next() < 0.6 ? rng.next() : 0;
      c.brake = rng.next() < 0.3 ? rng.next() : 0;
      c.steer = rng.range(-1, 1);
      t.aimYaw = rng.range(-10, 10);
      t.aimPitch = rng.range(-2, 2);
      t.aimSet = rng.next() < 0.8;
    }
    if (i % 333 === 0) {
      t.vx += rng.range(-12, 12);
      t.vz += rng.range(-12, 12);
    }
    if (i === 5000) c.throttle = NaN;
    stepTank(t, i % 977 === 0 ? null : c, DT, w);
    for (const f of ['x', 'z', 'heading', 'vx', 'vz', 'speed', 'turretYaw', 'gunPitch', 'pitch', 'roll', 'trackPhase', 'yawRate']) {
      assert.ok(Number.isFinite(t[f]), `${f} at ${i}`);
    }
    assert.ok(Math.abs(t.x) < 31 && Math.abs(t.z) < 31, 'inside the walls');
  }
});

test('turret: holds the world aim while the hull pivots; traverse and gun limits', () => {
  const t = createTank('rustback', 0, 0, 0);
  t.aimYaw = 1.2;
  t.aimPitch = 0.1;
  t.aimSet = true;
  run(t, ctl(), 30);
  assert.ok(t.turretYaw <= 1.6 * 0.5 + 1e-9, 'traverse is at most 1.6 rad/s');
  run(t, ctl(), 60);
  assert.ok(Math.abs(angleDiff(turretWorldYaw(t), 1.2)) < 1e-6, 'on the aim');
  // Pivot the hull for two seconds: the turret keeps pointing at 1.2.
  for (let i = 0; i < 120; i++) {
    stepTank(t, ctl(0, 0, 1), DT, null);
    if (i > 10) assert.ok(Math.abs(angleDiff(turretWorldYaw(t), 1.2)) < 0.02, `holds while turning (${i})`);
  }
  t.aimPitch = 1;
  run(t, ctl(), 120);
  assert.ok(Math.abs(t.gunPitch - 0.35) < 1e-9, 'gun elevation tops out at 0.35');
  t.aimPitch = -1;
  run(t, ctl(), 120);
  assert.ok(Math.abs(t.gunPitch + 0.14) < 1e-9, 'gun depression stops at -0.14');
  const g0 = t.gunPitch;
  t.aimPitch = 0.3;
  run(t, ctl(), 30);
  assert.ok(t.gunPitch - g0 <= 0.8 * 0.5 + 1e-9, 'gun moves at most 0.8 rad/s');
  // aimSet false holds the current angle relative to the hull.
  t.aimSet = false;
  const rel = t.turretYaw;
  run(t, ctl(0, 0, 1), 60);
  assert.ok(Math.abs(t.turretYaw - rel) < 1e-9);
});

test('cannon: slow reload, 90 m/s shell with drop, a big blast: two hits finish a car', () => {
  const { g, t } = tankGame();
  board(g, t);
  const car = g.addVehicle(createVehicle('sedan', 60, 0, Math.PI / 2));
  const evs = [];
  for (const n of ['launch', 'explosion']) g.events.on(n, (e) => evs.push([n, e.weapon || e.size, e.x]));
  g.input.press('fire');
  sim(g, 1);
  g.input.release('fire');
  const shell = g.combat.projectiles.find((p) => p.active && p.type === 'shell');
  assert.ok(shell, 'a shell is in flight');
  assert.ok(Math.abs(Math.hypot(shell.vx, shell.vy, shell.vz) - 90) < 1, '90 m/s');
  assert.ok(t.recoil > 0.9, 'barrel recoils');
  sim(g, 60);
  assert.ok(evs.some((e) => e[0] === 'launch' && e[1] === 'cannon'));
  assert.ok(evs.some((e) => e[0] === 'explosion'), 'blast');
  assert.ok(car.health < 900 - 300, `car badly hurt (${car.health.toFixed(0)})`);
  // Ready again only after 2.5 s.
  g.input.press('fire');
  sim(g, 60);
  assert.equal(g.combat.projectiles.filter((p) => p.active && p.type === 'shell').length, 0, 'still reloading');
  sim(g, 60 * 1.6);
  g.input.release('fire');
  sim(g, 90);
  assert.ok(car.health < 900 * 0.25 && car.burning, 'second shell sets it burning');
  sim(g, 60 * 7);
  assert.ok(car.wrecked, 'and it goes up');
  // Drop: a level shot at an empty range lands about where gravity x 0.3 says.
  const r = tankGame();
  board(r.g, r.t);
  r.g.input.press('fire');
  sim(r.g, 1);
  r.g.input.release('fire');
  let land = null;
  r.g.events.on('explosion', (e) => { land = land || { x: e.x, y: e.y }; });
  sim(r.g, 180);
  const muzzleY = TANK_SPECS.rustback.turretY;
  const tFall = Math.sqrt((2 * muzzleY) / (9.81 * 0.3));
  assert.ok(land && Math.abs(land.x - (4.15 + 90 * tFall)) < 14, `lands at ${land && land.x.toFixed(1)} (expected ${(4.15 + 90 * tFall).toFixed(1)})`);
});

test('coax: rapid hitscan along the gun; the hooks aim the barrel', () => {
  const { g, t } = tankGame();
  board(g, t);
  assert.ok(CRAFT_HOOKS.tank.controls && CRAFT_HOOKS.tank.aim && CRAFT_HOOKS.tank.muzzle && CRAFT_HOOKS.tank.fired, 'hooks filled');
  const target = { x: 30, z: 0, y: 0, radius: 0.4, heading: 0, px: 30, pz: 0 };
  initActor(target, 'crew');
  g.actors.push(target);
  let shots = 0;
  g.events.on('shot', (e) => { if (e.weapon === 'coax') shots++; });
  g.input.press('fire2');
  sim(g, 60);
  g.input.release('fire2');
  assert.ok(shots >= 8 && shots <= 11, `about 10 rounds a second (${shots})`);
  assert.ok(target.hp < 60 || target.life !== 'ok', 'the crew target is hit');
  // Manual aim (no camera): the turret follows game.aim.
  g.aim.manual = true;
  g.aim.dx = 0;
  g.aim.dy = 0;
  g.aim.dz = 1;
  sim(g, 90);
  assert.ok(Math.abs(angleDiff(turretWorldYaw(t), Math.PI / 2)) < 0.05, 'turret swung to the aim');
});

test('LOCK picks a hostile in the cone and the turret slews to it by itself', () => {
  const { g, t } = tankGame();
  board(g, t);
  const a = { x: 40, z: 22, y: 0, radius: 0.4, heading: 0, px: 40, pz: 22 };
  initActor(a, 'crew');
  g.actors.push(a);
  g.aim.manual = true;
  g.aim.dx = 1;
  g.aim.dy = 0;
  g.aim.dz = 0;
  g.input.press('lock');
  sim(g, 1);
  g.input.release('lock');
  assert.equal(g.armor.lock.lock, a);
  sim(g, 60);
  assert.ok(Math.abs(angleDiff(turretWorldYaw(t), Math.atan2(22, 40 + 0.45))) < 0.03, 'turret on the lock');
});

test('crush: a sedan above 2 m/s is flattened and wrecked; a slow push and a truck only shove', () => {
  const { g, t } = tankGame();
  board(g, t);
  const car = g.addVehicle(createVehicle('sedan', 14, 0, Math.PI / 2));
  const crush = [];
  g.events.on('crush', (e) => crush.push(e.target));
  sim(g, 60 * 4, ctl(1));
  assert.ok(car.crushed && car.wrecked, 'flattened');
  assert.equal(crush[0], car, 'crush event with the car');
  assert.ok(t.x > 14, 'the tank rolled over it');
  // A slow push at walking pace: shoved, not crushed.
  const s = tankGame();
  board(s.g, s.t);
  const c2 = s.g.addVehicle(createVehicle('sedan', 5.0, 0, Math.PI / 2));
  sim(s.g, 60 * 2.5, ctl(0.2));
  assert.ok(Math.abs(s.t.speed) < 2);
  assert.ok(!c2.crushed && c2.x > 5.5, `pushed along (${c2.x.toFixed(2)})`);
  // A truck (7.5 m) is only pushed, with ram damage.
  const b = tankGame();
  board(b.g, b.t);
  const tr = b.g.addVehicle(createVehicle('truck', 16, 0, Math.PI / 2));
  sim(b.g, 60 * 4, ctl(1));
  assert.ok(!tr.crushed, 'too big to crush');
  assert.ok(tr.x > 17, 'shoved');
  assert.ok(tr.health < 2000, 'rammed');
});

test('people are knocked down by a moving tank, never crushed (they get up)', () => {
  const { g, t } = tankGame();
  board(g, t);
  const p = { x: 8, z: 0, y: 0, radius: 0.35, heading: 0, px: 8, pz: 0, vx: 0, vz: 0 };
  initActor(p, 'civ');
  g.actors.push(p);
  t.vx = 5.5;
  // The ped system records the bump (closing speed) like for any craft.
  sim(g, 1, ctl(1), () => {
    p.bumpBy = t;
    p.bumpV = 5.5;
  });
  assert.equal(p.life, 'down');
  assert.ok(p.hp > 0, 'not out');
  sim(g, 60 * 3);
  assert.ok(canBeHit(p), `back up (${p.life})`);
});

test('benches and signs: the tank rolls through with a crush event (no target)', () => {
  const { g, t } = tankGame();
  g.city.furniture.push({ type: 'bench', x: 12, z: 0.5 }, { type: 'stopsign', x: 20, z: -1 }, { type: 'bench', x: 12, z: 9 });
  g.armor = createArmor(g); // rebuild the prop grid
  board(g, t);
  const ev = [];
  g.events.on('crush', (e) => ev.push([e.target, e.x]));
  sim(g, 60 * 5, ctl(1));
  assert.deepEqual(ev.map((e) => e[1]), [12, 20]);
  assert.ok(ev.every((e) => e[0] === null));
});

test('armour: small arms bounce off, explosives and other tanks hurt', () => {
  const { g, t } = tankGame();
  const w = g.player.walker;
  w.x = -20;
  w.z = 0;
  for (let i = 0; i < 200; i++) g.combat.damage(t, 12, w, 'bullet');
  assert.ok(t.health > 940, `200 Buzzbox hits barely scratch it (${t.health.toFixed(1)})`);
  const h0 = t.health;
  g.combat.damage(t, 50, w, 'melee');
  assert.equal(t.health, h0, 'wrench does nothing');
  // Six rockets wreck it (direct 100 + blast r 6 each).
  let rockets = 0;
  while (!t.wrecked && rockets < 12) {
    g.combat.damage(t, 100, w, 'blast');
    g.combat.explode(t.x, 1, t.z, 6, w, 0, 1);
    sim(g, 40);
    rockets++;
  }
  assert.ok(t.wrecked && rockets <= 6, `wrecked by ${rockets} rockets`);
  // A second tank's cannon: a handful of hits.
  const r = tankGame();
  const enemy = r.g.addVehicle(createTank('rustback', 50, 0, Math.PI));
  board(r.g, r.t);
  let hits = 0;
  while (!enemy.wrecked && hits < 10) {
    r.g.input.press('fire');
    sim(r.g, 2);
    r.g.input.release('fire');
    sim(r.g, 60 * 2.6);
    hits++;
  }
  assert.ok(enemy.wrecked && hits >= 3 && hits <= 6, `enemy tank wrecked by ${hits} shells`);
});

test('police tank: under 35% the crew bails and it can be stolen', () => {
  const { g } = tankGame();
  const pt = g.addVehicle(createTank('rustbackpolice', 30, 0, 0));
  pt.driver = { cop: true };
  const bails = [];
  g.events.on('tankBail', (e) => bails.push(e.craft));
  pt.health = 1000 * BAIL_BELOW + 5;
  sim(g, 1);
  assert.ok(!pt.bailed);
  pt.health = 1000 * BAIL_BELOW - 5;
  sim(g, 1);
  assert.ok(pt.bailed && pt.driver === null && bails[0] === pt);
  pt.controls = ctl(1);
  sim(g, 60);
  assert.ok(Math.abs(pt.speed) < 0.01, 'a bailed tank does not drive');
});

test('AI gunner core: telegraph, cadence, minimum range, sight and on-foot rules', () => {
  const { city, collision } = cityAndCollision();
  void city;
  const col = createCollisionWorld();
  col.addBox(40, -5, 44, 5, 10);
  const t = createTank('rustback', 0, 0, 0);
  const tgt = { x: 80, z: 30, y: 0, spec: { height: 1.5 }, health: 900, wrecked: false, kind: 'car' };
  const g = createGunner();
  const ctx = { collision: null, onFoot: false, hurtBy: false, seaY: -0.6 };
  let fires = [], aims = [];
  for (let i = 0; i < 60 * 20; i++) {
    const r = tankGunnerStep(g, t, tgt, ctx, DT);
    stepTank(t, null, DT, null);
    if (r === 'fire') fires.push(i * DT);
    if (r === 'aim') aims.push(i * DT);
  }
  assert.ok(fires.length >= 2, `fires (${fires.length})`);
  for (let k = 1; k < fires.length; k++) assert.ok(fires[k] - fires[k - 1] >= GUNNER.cool - 1e-6, 'one shell per 6 s');
  for (const f of fires) assert.ok(aims.some((a) => f - a >= GUNNER.telegraph - 0.02 && f - a < GUNNER.telegraph + 0.05), '1.2 s telegraph first');
  // Too close: never fires (it rams instead).
  const near = { ...tgt, x: 12, z: 0 };
  const g2 = createGunner();
  for (let i = 0; i < 60 * 15; i++) assert.notEqual(tankGunnerStep(g2, t, near, ctx, DT), 'fire');
  // A person who has not hurt it: never.
  const foot = { x: 60, z: 0, y: 0, hp: 100, life: 'ok', fade: 0, height: 1.8 };
  const g3 = createGunner();
  for (let i = 0; i < 60 * 15; i++) assert.notEqual(tankGunnerStep(g3, t, foot, { ...ctx, onFoot: true }, DT), 'fire');
  // No line of sight through a building.
  const hidden = { ...tgt, x: 70, z: 0 };
  const g4 = createGunner();
  for (let i = 0; i < 60 * 15; i++) assert.notEqual(tankGunnerStep(g4, t, hidden, { ...ctx, collision: col }, DT), 'fire');
});

test('fleet: tanks wait at their spots and respawn there when far from the player', () => {
  const { city } = cityAndCollision();
  const vehicles = [];
  const game = {
    city, rng: createRng(4), vehicles,
    kinds: { tank: {}, boat: {}, plane: {}, heli: {} },
    player: { x: 0, z: 0, vehicle: null },
    addVehicle(v) { vehicles.push(v); return v; },
    removeVehicle(v) { const i = vehicles.indexOf(v); if (i >= 0) vehicles.splice(i, 1); v.removed = true; },
  };
  const fleet = createFleet(game);
  const tanks = vehicles.filter((v) => v.kind === 'tank');
  assert.equal(tanks.length, city.tankSpots.length);
  assert.ok(tanks.length >= 3);
  const tk = tanks[0];
  const spot = tk.home;
  // Driven away and wrecked, player near: stays.
  tk.x += 60;
  tk.wrecked = true;
  game.player.x = spot.x;
  game.player.z = spot.z;
  for (let i = 0; i < 5; i++) fleet.fixedUpdate(2.1);
  assert.ok(!tk.removed && spot.craft === tk);
  // Player far away: the wreck goes, a fresh tank waits at the spot.
  game.player.x = spot.x + 2000;
  for (let i = 0; i < 3; i++) fleet.fixedUpdate(2.1);
  assert.ok(tk.removed, 'wreck cleared');
  const fresh = spot.craft;
  assert.ok(fresh && fresh !== tk && fresh.kind === 'tank' && !fresh.wrecked);
  assert.ok(Math.hypot(fresh.x - spot.x, fresh.z - spot.z) < 1e-9);
});

test('determinism: the same inputs give the same tank, every step', () => {
  const go = () => {
    const { g, t } = tankGame({ boxes: [[40, -10, 44, 10, 6]] });
    board(g, t);
    g.addVehicle(createVehicle('sedan', 18, 2, 1));
    const rng = createRng(12);
    const c = ctl();
    const out = [];
    for (let k = 0; k < 40; k++) {
      c.throttle = rng.next();
      c.steer = rng.range(-1, 1);
      if (k % 9 === 0) g.input.press('fire');
      sim(g, 15, c);
      g.input.release('fire');
      out.push(t.x.toFixed(6), t.z.toFixed(6), t.heading.toFixed(6), t.turretYaw.toFixed(6), t.health.toFixed(4));
    }
    return out.join(',');
  };
  assert.equal(go(), go());
});

test('barrel ray: muzzle at the barrel tip along turret yaw and gun pitch', () => {
  const t = createTank('rustback', 0, 0, 0);
  t.turretYaw = Math.PI / 2;
  t.gunPitch = 0.2;
  const r = barrelRay(t, {});
  assert.ok(Math.abs(r.dz - Math.cos(0.2)) < 1e-9 && Math.abs(r.dy - Math.sin(0.2)) < 1e-9);
  assert.ok(Math.abs(r.x - TANK_SPECS.rustback.turretX) < 1e-9 && r.z > 4);
});
