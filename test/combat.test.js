import { RULES as CLASSIC } from '../src/core/weapons.js';
CLASSIC.unlimitedAmmo = false; // these tests check the classic rules
CLASSIC.invulnerable = false;
import test from 'node:test';
import assert from 'node:assert/strict';
import { createEvents } from '../src/core/events.js';
import { createCollisionWorld } from '../src/world/collision.js';
import { createRng } from '../src/core/rng.js';
import { createVehicle } from '../src/entities/vehicle.js';
import { createWalker, stepWalker } from '../src/entities/onfoot.js';
import { createPed, stepPed, scarePed } from '../src/systems/peds.js';
import {
  WEAPONS, WEAPON_IDS, createArms, tryUse, stepArms, nextWeapon, USE_NO, USE_OK, USE_LAST,
} from '../src/core/weapons.js';
import {
  createCombat, damage, initActor, addActor, trace, createTraceResult, cylinderT,
  CAPS, HP, DOWN_T, OUT_LIE_T, FADE_T, PLAYER_DOWN_T, PLAYER_FADE_T, WRECK_T,
  WRECK_LIE_T, WRECK_FADE_T, WRECK_MAX, WRECK_FLAME_T, BODY_LIE_T, BODY_MAX,
} from '../src/systems/combat.js';

const DT = 1 / 60;

// A small flat test world: land for x < 400 (sea beyond), a road-node
// grid, no buildings unless a test adds them.
function makeGame({ seed = 1 } = {}) {
  const collision = createCollisionWorld();
  const nodes = [];
  for (let i = -3; i <= 3; i++) for (let j = -3; j <= 3; j++) nodes.push({ id: nodes.length, x: i * 50, z: j * 50 });
  const city = { nodes, spawn: { x: 0, z: 0, heading: 0 }, isGround: (x) => x < 400 };
  const walker = createWalker(-100, -100, 0);
  const game = {
    events: createEvents(), collision, city, world: { collision, city }, seaY: -0.6,
    vehicles: [], actors: [], time: 0,
    player: { mode: 'foot', vehicle: null, walker, x: walker.x, z: walker.z, y: 0, health: 100, wanted: 0 },
    progress: { money: 250, medals: { a: 'gold' }, bestTimes: { a: 12.5 }, stats: { distance: 3 } },
    input: null,
  };
  createCombat(game, { seed });
  return game;
}
const civ = (game, x, z) => {
  const a = initActor({ x, z, y: 0, heading: 0, radius: 0.35, px: x, pz: z, vx: 0, vz: 0 }, 'civ');
  addActor(game, a);
  return a;
};
const shooter = (game, x, z, weapon = 'pistol', team = 'crew') => {
  const a = civ(game, x, z);
  a.team = team;
  a.arms = createArms(weapon);
  return a;
};
const steps = (game, n) => {
  for (let i = 0; i < n; i++) game.combat.fixedUpdate(DT);
};
const record = (game, name) => {
  const list = [];
  game.events.on(name, (e) => list.push(e && typeof e === 'object' ? { ...e } : e));
  return list;
};

test('weapons table: seven invented weapons with the contract numbers', () => {
  assert.deepEqual(WEAPON_IDS, ['wrench', 'pistol', 'smg', 'scatter', 'lobber', 'fizz', 'sticky']);
  const rows = {
    wrench: ['Pipe Wrench', 'melee', 34, 1.6, 1.8, 0], pistol: ['Pocket Rattler', 'hitscan', 25, 4, 45, 12],
    smg: ['Buzzbox', 'hitscan', 12, 12, 35, 30], scatter: ['Barnyard Thumper', 'hitscan', 9, 1.2, 18, 6],
    lobber: ['Gull Lobber', 'rocket', 100, 0.6, 150, 1], fizz: ['Fizzpop Can', 'thrown', 0, 1, 25, 1],
    sticky: ['Barnacle Charge', 'sticky', 0, 1.5, 18, 1],
  };
  for (const id of WEAPON_IDS) {
    const w = WEAPONS[id], r = rows[id];
    assert.deepEqual([w.name, w.type, w.dmg, w.rate, w.range, w.mag], r, id);
  }
  assert.equal(WEAPONS.scatter.pellets, 8);
  assert.equal(WEAPONS.lobber.speed, 40);
  assert.equal(WEAPONS.lobber.blast, 6);
  assert.equal(WEAPONS.fizz.blast, 5);
  assert.equal(WEAPONS.fizz.fuse, 2.2);
});

test('arms: rate limit, magazine, auto reload, swap', () => {
  const arms = createArms('pistol');
  assert.equal(tryUse(arms), USE_OK);
  assert.equal(tryUse(arms), USE_NO, 'cooling down');
  let fired = 1;
  for (let i = 0; i < 60 * 10 && fired < 12; i++) {
    stepArms(arms, DT);
    const r = tryUse(arms);
    if (r !== USE_NO) fired++;
    if (fired === 12) assert.equal(r, USE_LAST);
  }
  assert.equal(arms.mag.pistol, 0);
  assert.equal(arms.reloading, 'pistol');
  let t = 0;
  while (arms.reloading) {
    stepArms(arms, DT);
    t += DT;
  }
  assert.ok(Math.abs(t - 1.1) < 0.03, `reload took ${t}`);
  assert.equal(arms.mag.pistol, 12);
  assert.equal(nextWeapon(arms), 'smg');
  assert.equal(arms.lastGun, 'smg');
  nextWeapon(arms);
  assert.equal(arms.lastGun, 'smg', 'drive-by keeps the last of pistol and SMG');
});

test('cylinder test: side, top and miss', () => {
  assert.ok(Math.abs(cylinderT(0, 1, 0, 1, 0, 0, 50, 10, 0, 0.5, 0, 1.8) - 9.5) < 1e-9);
  assert.equal(cylinderT(0, 2, 0, 1, 0, 0, 50, 10, 0, 0.5, 0, 1.8), Infinity, 'over the head');
  const d = Math.SQRT1_2;
  assert.ok(Number.isFinite(cylinderT(9, 3, 0, d, -d, 0, 50, 10, 0, 0.5, 0, 1.8)), 'down through the top');
  assert.equal(cylinderT(0, 1, 0, 1, 0, 0, 5, 10, 0, 0.5, 0, 1.8), Infinity, 'out of range');
});

test('hitscan: building, low wall passed over, ground, water, nearest wins', () => {
  const game = makeGame();
  const out = createTraceResult();
  game.collision.addBox(20, -5, 30, 5, 10);
  trace(game, 0, 1.4, 0, 1, 0, 0, 45, null, null, out);
  assert.equal(out.kind, 'wall');
  assert.ok(Math.abs(out.t - 20) < 1e-6);
  const g2 = makeGame();
  g2.collision.addBox(20, -5, 30, 5, 1);
  trace(g2, 0, 1.4, 0, 1, 0, 0, 45, null, null, out);
  assert.equal(out.kind, 'none', 'shoots over a low wall');
  const s = Math.sin(0.1), c = Math.cos(0.1);
  trace(g2, 0, 1.4, 0, c, -s, 0, 45, null, null, out);
  assert.equal(out.kind, 'ground');
  assert.ok(Math.abs(out.y) < 1e-6);
  trace(g2, 395, 1.4, 0, c, -s, 0, 45, null, null, out);
  assert.equal(out.kind, 'water', 'over the sea the ray meets the water');
  // Person in front of the wall wins; person behind is shielded.
  const front = civ(game, 15, 0), behind = civ(game, 35, 0);
  trace(game, 0, 1.4, 0, 1, 0, 0, 45, null, null, out);
  assert.equal(out.kind, 'actor');
  assert.equal(out.actor, front);
  front.life = 'out';
  trace(game, 0, 1.4, 0, 1, 0, 0, 45, null, null, out);
  assert.equal(out.kind, 'wall', 'down and out people do not stop shots');
  assert.notEqual(out.actor, behind);
});

test('hitscan: craft by radius and height; shooter and the player in a craft are skipped', () => {
  const game = makeGame();
  const car = createVehicle('sedan', 12, 0, 0, null);
  game.vehicles.push(car);
  const out = createTraceResult();
  trace(game, 0, 1, 0, 1, 0, 0, 45, null, null, out);
  assert.equal(out.kind, 'craft');
  assert.equal(out.craft, car);
  assert.ok(Math.abs(out.t - (12 - car.radius)) < 1e-6);
  trace(game, 0, 2, 0, 1, 0, 0, 45, null, null, out);
  assert.equal(out.kind, 'none', 'over the roof');
  trace(game, 12, 1, 0, 1, 0, 0, 45, null, car, out);
  assert.equal(out.kind, 'none', 'own craft skipped');
  // Player walker standing in the line, but riding: not hittable.
  const w = game.player.walker;
  w.x = 5;
  w.z = 0;
  game.player.vehicle = car;
  trace(game, 0, 1, 0, 1, 0, 0, 45, null, null, out);
  assert.equal(out.kind, 'craft');
});

test('pistol shot: shared shot and hit payloads, damage, down and out', () => {
  const game = makeGame();
  const shots = record(game, 'shot'), hits = record(game, 'hit'), downs = record(game, 'down'), outs = record(game, 'out');
  const ped = civ(game, 10, 0);
  const a = shooter(game, 0, 0, 'pistol');
  game.combat.rng = createRng(1);
  let tries = 0;
  while (ped.life === 'ok' && tries++ < 60) {
    game.combat.fire(a, 1, 0, 0);
    steps(game, 15);
  }
  assert.equal(shots.length, 1, 'one pistol bullet is lethal');
  assert.equal(hits.length, 1);
  assert.equal(shots[0].weapon, 'pistol');
  assert.equal(shots[0].hitKind, 'actor');
  assert.ok(Math.abs(shots[0].y - 1.4) < 1e-9, 'muzzle at actor y + 1.4');
  assert.equal(hits[0].amount, 25);
  assert.equal(hits[0].kind, 'bullet');
  assert.equal(downs.length, 1);
  assert.equal(ped.hp, 0);
  assert.ok(ped.life === 'down' && ped.lifeT < DOWN_T);
  let n = 0;
  while (ped.life === 'down') {
    steps(game, 1);
    n++;
  }
  assert.ok(n < DOWN_T * 60 + 2);
  assert.equal(ped.life, 'out');
  assert.equal(outs.length, 1);
  assert.equal(game.combat.damage(ped, 50, a, 'bullet'), 0, 'out people ignore hits');
  steps(game, Math.ceil(OUT_LIE_T * 60) - 2);
  assert.equal(ped.fade, 0);
  steps(game, Math.ceil(FADE_T * 60) + 4);
  assert.equal(ped.fade, 1);
});

test('state machine: any blast or bullet kills outright and nobody gets up; melee kills on the 2nd hit', () => {
  const game = makeGame();
  const a = civ(game, 0, 0);
  a.maxHp = a.hp = 200;
  assert.ok(damage(game, a, 10, null, 'blast') === 10);
  assert.equal(a.life, 'down');
  assert.equal(a.hp, 0, 'a small blast on a tough person is still lethal');
  assert.ok(a.hitT > 0);
  assert.equal(damage(game, a, 10, null, 'bullet'), 0, 'down people ignore hits');
  steps(game, Math.ceil(DOWN_T * 60) + 1);
  assert.equal(a.life, 'out', 'never a get-up');
  steps(game, Math.ceil((OUT_LIE_T + FADE_T) * 60) + 30);
  assert.equal(a.life, 'out');
  assert.equal(a.hp, 0);
  assert.equal(a.fade, 1);
  const b = civ(game, 3, 0);
  b.maxHp = b.hp = 200;
  const m = shooter(game, 2, 0, 'wrench');
  m.heading = 0;
  game.combat.fire(m, 1, 0, 0);
  assert.equal(b.hp, 166);
  assert.equal(b.life, 'ok');
  steps(game, 40);
  game.combat.fire(m, 1, 0, 0);
  assert.equal(b.life, 'down', 'second wrench hit kills');
  assert.equal(b.hp, 0);
  steps(game, Math.ceil(DOWN_T * 60) + 1);
  assert.equal(b.life, 'out');
  // Knock-back decays at 6 m/s^2.
  const c = civ(game, -50, 0);
  c.kx = 3;
  steps(game, 30);
  assert.ok(Math.abs(c.kx - 0) < 1e-9 || c.kx < 3 - 6 * 0.5 + 1e-6);
  assert.ok(c.x > -50);
});

test('melee hits the nearest target inside its arc only', () => {
  const game = makeGame();
  const m = shooter(game, 0, 0, 'wrench');
  const side = civ(game, 0, 1.2); // 90 degrees off the swing
  const ahead = civ(game, 1.5, 0.2);
  side.maxHp = side.hp = ahead.maxHp = ahead.hp = 30;
  game.combat.fire(m, 1, 0, 0);
  assert.equal(side.hp, HP.civ);
  assert.equal(ahead.hp, 0);
  assert.equal(ahead.life, 'down');
});

test('run over above 4 m/s: down, 4 x closing speed', () => {
  const game = makeGame();
  const ped = createPed(createRng(3));
  ped.active = true;
  ped.block = { x0: -50, z0: -50, x1: 50, z1: 50, id: 0 };
  ped.x = ped.px = 0;
  ped.z = ped.pz = 0;
  addActor(game, ped);
  const car = createVehicle('sedan', -1, 0, 0, null);
  car.vx = 8;
  car.speed = 8;
  game.vehicles.push(car);
  stepPed(ped, DT, { collision: game.collision, vehicles: game.vehicles, player: game.player });
  assert.equal(ped.bumpBy, car);
  steps(game, 1);
  assert.equal(ped.life, 'down');
  assert.ok(Math.abs(ped.hp - Math.max(0, 30 - 4 * 8)) < 1e-6);
  // Slow nudge: no harm.
  const p2 = createPed(createRng(4));
  p2.active = true;
  p2.block = ped.block;
  p2.x = p2.px = 20;
  p2.z = p2.pz = 0;
  addActor(game, p2);
  const slow = createVehicle('sedan', 19, 0, 0, null);
  slow.vx = 2;
  game.vehicles.push(slow);
  stepPed(p2, DT, { collision: game.collision, vehicles: game.vehicles, player: game.player });
  steps(game, 1);
  assert.equal(p2.life, 'ok');
  assert.equal(p2.hp, 30);
});

test('peds: down peds stay put, gunfire makes peds run away', () => {
  const ped = createPed(createRng(9));
  ped.active = true;
  ped.block = { x0: -50, z0: -50, x1: 50, z1: 50, id: 0 };
  ped.x = ped.px = 5;
  ped.z = ped.pz = 0;
  const ctx = { collision: createCollisionWorld(), vehicles: [], player: null };
  assert.equal(ped.team, 'civ');
  assert.equal(ped.hp, 30);
  ped.life = 'down';
  for (let i = 0; i < 60; i++) stepPed(ped, DT, ctx);
  assert.equal(ped.x, 5);
  ped.life = 'ok';
  assert.ok(scarePed(ped, 0, 0));
  for (let i = 0; i < 120; i++) stepPed(ped, DT, ctx);
  assert.ok(ped.x > 12, `ran away: ${ped.x}`);
  assert.equal(ped.state, 'fleeing');
  for (let i = 0; i < 60 * 5; i++) stepPed(ped, DT, ctx);
  assert.notEqual(ped.state, 'fleeing', 'calms down after 6 s');
});

test('walker: a down player does not walk', () => {
  const w = createWalker(0, 0, 0);
  w.life = 'down';
  stepWalker(w, { moveX: 0, moveY: 1, sprint: true }, DT, { collision: createCollisionWorld() }, 0);
  assert.equal(w.x, 0);
});

test('blast radius and falloff: actors and craft (x1.5), everyone inside goes down', () => {
  const game = makeGame();
  const near = civ(game, 0, 0), mid = civ(game, 3, 0), edge = civ(game, 5.9, 0), far = civ(game, 7, 0);
  for (const a of [near, mid, edge, far]) a.maxHp = a.hp = 1000;
  const car = createVehicle('sedan', 0, 4, 0, null);
  car.health = 5000; // stays alive
  game.vehicles.push(car);
  const ex = record(game, 'explosion');
  const bh = record(game, 'hit');
  game.combat.explode(0, 0.9, 0, 6, null, 0);
  assert.equal(ex.length, 1);
  assert.equal(ex[0].radius, 6);
  const amt = (t) => bh.find((h) => h.target === t).amount;
  assert.ok(Math.abs(amt(near) - 120) < 1e-6);
  assert.ok(Math.abs(amt(mid) - 60) < 1e-6);
  assert.ok(amt(edge) > 0 && amt(edge) < 3);
  for (const a of [near, mid, edge]) assert.equal(a.hp, 0, 'everyone in range dies');
  assert.equal(far.hp, 1000);
  for (const a of [near, mid, edge]) assert.equal(a.life, 'down');
  assert.equal(far.life, 'ok');
  assert.ok(mid.kx > 0, 'pushed away from the blast');
  const cy = car.spec.height * 0.5;
  const d = Math.max(0, Math.hypot(0, cy - 0.9, 4) - car.radius * 0.5);
  assert.ok(Math.abs(5000 - car.health - 120 * (1 - d / 6) * 1.5) < 1e-6);
  assert.ok(car.vz > 0, 'craft shoved away');
});

test('rocket flies straight at 40 m/s, detonates on a wall or at range; fizz arcs, bounces, fuses', () => {
  const game = makeGame();
  game.collision.addBox(60, -10, 70, 10, 20);
  const a = shooter(game, 0, 0, 'lobber');
  const ex = record(game, 'explosion');
  assert.ok(game.combat.fire(a, 1, 0, 0));
  steps(game, 30);
  const pr = game.combat.projectiles.find((p) => p.active);
  assert.ok(pr && Math.abs(pr.x - (0.3 + 20)) < 0.01, 'rocket at 40 m/s');
  steps(game, 60);
  assert.equal(ex.length, 1);
  assert.ok(Math.abs(ex[0].x - 60) < 0.01, 'detonates on the wall');
  // Open air: detonates at 150 m.
  const g2 = makeGame();
  const b = shooter(g2, 0, 0, 'lobber');
  const ex2 = record(g2, 'explosion');
  g2.combat.fire(b, 0, 0, 1);
  steps(g2, 60 * 5);
  assert.equal(ex2.length, 1);
  assert.ok(Math.abs(ex2[0].z - 150) < 1.5, `range ${ex2[0].z}`);
  // Fizzpop: lands around its range, bounces, blows up on its fuse.
  const g3 = makeGame();
  const c = shooter(g3, 0, 0, 'fizz');
  const ex3 = record(g3, 'explosion');
  // Aim pitch 0.6 rad (ARMS.md: top of the pitch span) = full 25 m reach.
  g3.combat.fire(c, Math.cos(0.6), Math.sin(0.6), 0);
  const can = g3.combat.projectiles.find((p) => p.active);
  let first = null, maxY = 0, t = 0;
  while (can.active && t < 5) {
    const vy = can.vy;
    steps(g3, 1);
    t += DT;
    maxY = Math.max(maxY, can.y);
    if (first === null && vy < 0 && can.vy > 0) first = can.x;
  }
  assert.ok(maxY > 3, 'arcs');
  assert.ok(first > 18 && first < 30, `first bounce at ${first}`);
  assert.equal(ex3.length, 1);
  assert.ok(Math.abs(t - 2.2) < 0.05, `fuse ${t}`);
  assert.equal(ex3[0].radius, 5);
  // Thrown into the sea: splash, dud.
  const g4 = makeGame();
  const d = shooter(g4, 390, 0, 'fizz');
  const splash = [], ex4 = record(g4, 'explosion');
  g4.events.on('splash', (x, z) => splash.push([x, z]));
  g4.combat.fire(d, 1, 0, 0);
  steps(g4, 60 * 3);
  assert.equal(splash.length, 1);
  assert.equal(ex4.length, 0);
});

test('craft: damage multipliers, burning below 25%, explodes after 6 s', () => {
  const game = makeGame();
  const car = createVehicle('sedan', 0, 0, 0, null);
  game.vehicles.push(car);
  const max = car.spec.health;
  assert.equal(damage(game, car, 100, null, 'bullet'), 50);
  assert.equal(damage(game, car, 100, null, 'melee'), 10);
  assert.equal(damage(game, car, 100, null, 'ram'), 100);
  const burning = record(game, 'burning'), ex = record(game, 'explosion');
  car.health = max * 0.24;
  steps(game, 1);
  assert.equal(car.burning, true);
  assert.equal(car.onFire, true);
  assert.equal(burning[0].on, true);
  const h0 = car.health;
  steps(game, 60);
  assert.ok(Math.abs(h0 - car.health - max * 0.03) < 1, 'loses 3% of max per s');
  steps(game, 60 * 5 + 5);
  assert.equal(ex.length, 1);
  assert.equal(ex[0].radius, 10, 'a car blast is 10 m (REVAMP 6.7; was 8)');
  assert.equal(car.wrecked, true);
  assert.equal(car.burning, false);
  // Crash damage alone (not from combat) does not set craft on fire.
  const other = createVehicle('sedan', 100, 100, 0, null);
  other.health = 10;
  game.vehicles.push(other);
  steps(game, 10);
  assert.ok(!other.burning);
});

test('burning craft cap: at most 4 at once', () => {
  const game = makeGame();
  for (let i = 0; i < 8; i++) {
    const c = createVehicle('sedan', i * 30, 0, 0, null);
    game.vehicles.push(c);
    damage(game, c, c.spec.health * 0.8 * 2, null, 'bullet');
  }
  steps(game, 1);
  assert.equal(game.vehicles.filter((c) => c.burning).length, CAPS.burning);
});

test('explosion chain: depth at most 2, at most 3 per 0.5 s, extras queued', () => {
  const game = makeGame();
  // A tight row of fragile cars: each explosion can reach the next.
  for (let i = 0; i < 8; i++) {
    const c = createVehicle('compact', i * 4, 0, 0, null);
    c.health = 1;
    game.vehicles.push(c);
  }
  const ex = [];
  let t = 0;
  game.events.on('explosion', (e) => ex.push({ t, depth: e.depth, x: e.x }));
  damage(game, game.vehicles[0], 1000, game.player.walker, 'bullet');
  for (let i = 0; i < 60 * 6; i++) {
    t += DT;
    game.combat.fixedUpdate(DT);
  }
  assert.ok(ex.length >= 3, `chain happened: ${ex.length}`);
  for (const e of ex) assert.ok(e.depth <= 2, `depth ${e.depth}`);
  for (let i = 0; i < ex.length; i++) {
    const n = ex.filter((e) => e.t > ex[i].t - 0.5 + 1e-9 && e.t <= ex[i].t).length;
    assert.ok(n <= 3, `rate cap: ${n} in 0.5 s`);
  }
  // Many blasts at once: never more than 3 per 0.5 s; the rest wait.
  const g2 = makeGame();
  const ex2 = [];
  let t2 = 0;
  g2.events.on('explosion', () => ex2.push(t2));
  for (let i = 0; i < 6; i++) g2.combat.explode(i * 50, 1, 0, 5);
  assert.equal(ex2.length, 3);
  for (let i = 0; i < 60 * 3; i++) {
    t2 += DT;
    g2.combat.fixedUpdate(DT);
  }
  assert.equal(ex2.length, 6, 'queued ones go off later');
  assert.ok(ex2[3] >= 0.3 - 1e-6);
});

test('caps: live actors 36, projectiles 24, decals 24', () => {
  const game = makeGame();
  // The player is already an actor.
  let added = 0;
  for (let i = 0; i < 50; i++) if (addActor(game, initActor({ x: i, z: 50, y: 0, radius: 0.35 }, 'civ'))) added++;
  assert.equal(game.actors.length, CAPS.actors);
  assert.equal(added, CAPS.actors - 1);
  const g2 = makeGame();
  const shooters = [];
  for (let i = 0; i < 30; i++) {
    const a = initActor({ x: -300, z: i * 3, y: 0, radius: 0.35 }, 'crew');
    a.arms = createArms('lobber');
    g2.actors.push(a); // bypass the actor cap: this test is about projectiles
    shooters.push(a);
  }
  let fired = 0;
  for (const a of shooters) if (g2.combat.fire(a, 0, 1, 0)) fired++;
  assert.equal(fired, CAPS.projectiles);
  assert.equal(g2.combat.projectiles.filter((p) => p.active).length, CAPS.projectiles);
  const g3 = makeGame();
  for (let i = 0; i < 40; i++) {
    g3.combat.explode(i * 30 - 600, 0.5, 200, 5);
    g3.combat.fixedUpdate(1);
  }
  assert.equal(g3.combat.decals.count, CAPS.decals);
  assert.ok(g3.combat.liveExplosions() <= CAPS.explosions);
});

test('player: hit in a craft hurts the craft; downed, fades, respawns away from hostiles with nothing lost', () => {
  const game = makeGame();
  const w = game.player.walker;
  const car = createVehicle('sedan', w.x, w.z, 0, null);
  game.vehicles.push(car);
  game.player.vehicle = car;
  car.driver = 'player';
  const h0 = car.health;
  damage(game, w, 40, null, 'bullet');
  assert.equal(w.hp, 100);
  assert.equal(car.health, h0 - 20);
  game.player.vehicle = null;
  car.driver = null;
  // A police officer stands at the nearest node.
  const cop = civ(game, -100, -100);
  cop.team = 'police';
  const before = JSON.stringify(game.progress);
  const pd = record(game, 'playerDown'), rs = record(game, 'respawn');
  damage(game, w, 150, cop, 'bullet');
  assert.equal(w.life, 'down');
  assert.equal(pd.length, 1);
  steps(game, Math.round(PLAYER_DOWN_T * 60) + 30);
  assert.ok(w.fade > 0.4 && w.fade < 0.6, `fading ${w.fade}`);
  steps(game, Math.round(PLAYER_FADE_T * 60));
  assert.equal(rs.length, 1);
  assert.equal(w.life, 'ok');
  assert.equal(w.hp, 100);
  assert.equal(w.fade, 0);
  assert.ok(Math.hypot(rs[0].x - cop.x, rs[0].z - cop.z) > 60);
  assert.ok(game.city.nodes.some((n) => n.x === rs[0].x && n.z === rs[0].z), 'at a road node');
  assert.equal(JSON.stringify(game.progress), before, 'nothing lost');
  // Regenerates 10/s after 5 s without damage.
  w.hp = 50;
  w.sinceHit = 0;
  steps(game, 60 * 4);
  assert.equal(w.hp, 50);
  steps(game, 60 * 2);
  assert.ok(w.hp > 55 && w.hp < 70, `regen ${w.hp}`);
});

test('player: a craft exploding with the player inside downs the player', () => {
  const game = makeGame();
  const w = game.player.walker;
  const car = createVehicle('sedan', w.x, w.z, 0, null);
  game.vehicles.push(car);
  game.player.vehicle = car;
  car.driver = 'player';
  const pd = record(game, 'down');
  damage(game, car, 1e6, null, 'blast');
  assert.equal(car.wrecked, true);
  assert.equal(game.player.vehicle, null);
  assert.equal(game.player.mode, 'foot');
  assert.equal(w.life, 'down');
  assert.ok(pd.some((d) => d.target === w));
});

test('takedown only for the player as source', () => {
  const game = makeGame();
  const td = record(game, 'takedown');
  const a = civ(game, 10, 0), b = civ(game, 20, 0);
  damage(game, a, 100, game.player.walker, 'bullet');
  damage(game, b, 100, null, 'bullet');
  assert.equal(td.length, 1);
  assert.equal(td[0].target, a);
});

function fight(seed) {
  const game = makeGame({ seed });
  const rng = createRng(seed + 7);
  const fighters = [];
  for (let i = 0; i < 20; i++) {
    const a = shooter(game, rng.range(-40, 40), rng.range(-40, 40), rng.pick(WEAPON_IDS));
    a.maxHp = a.hp = 400;
    fighters.push(a);
  }
  for (let i = 0; i < 6; i++) game.vehicles.push(createVehicle('sedan', rng.range(-40, 40), rng.range(-40, 40), rng.range(0, 6), null));
  game.collision.addBox(-10, -10, 0, 0, 8);
  return { game, rng, fighters };
}
function runFight(f, n) {
  const { game, rng, fighters } = f;
  for (let i = 0; i < n; i++) {
    const a = fighters[rng.int(0, fighters.length - 1)];
    const ang = rng.range(0, Math.PI * 2);
    if (rng.chance(0.02)) a.arms.weapon = rng.pick(WEAPON_IDS);
    game.combat.fire(a, Math.cos(ang), rng.range(-0.3, 0.3), Math.sin(ang));
    if (rng.chance(0.005)) game.combat.explode(rng.range(-40, 40), rng.range(0, 3), rng.range(-40, 40), rng.range(1, 8));
    if (rng.chance(0.01)) for (const v of game.vehicles) if (v.wrecked) { v.wrecked = false; v.exploded = false; v.health = v.spec.health; }
    if (rng.chance(0.01)) for (const b of fighters) if (b.life === 'out') { b.life = 'ok'; b.hp = b.maxHp; b.fade = 0; }
    game.combat.fixedUpdate(DT);
  }
}
const signature = (f) => JSON.stringify([
  f.fighters.map((a) => [a.x, a.z, a.hp, a.life, a.kx]),
  f.game.vehicles.map((v) => [v.health, v.wrecked, v.vx, v.vz]),
  f.game.combat.projectiles.map((p) => [p.active, p.x, p.y, p.z]),
]);

test('determinism: same seed, same fight', () => {
  const a = fight(42), b = fight(42);
  runFight(a, 3000);
  runFight(b, 3000);
  assert.equal(signature(a), signature(b));
  const c = fight(43);
  runFight(c, 3000);
  assert.notEqual(signature(a), signature(c));
});

test('no NaN over thousands of random steps', () => {
  const f = fight(7);
  runFight(f, 6000);
  const bad = (v) => !Number.isFinite(v);
  for (const a of f.game.actors) for (const k of ['x', 'z', 'hp', 'kx', 'kz', 'lifeT', 'fade']) assert.ok(!bad(a[k]), `actor ${k}`);
  for (const v of f.game.vehicles) for (const k of ['health', 'vx', 'vz', 'x', 'z']) assert.ok(!bad(v[k]), `craft ${k}`);
  for (const p of f.game.combat.projectiles) for (const k of ['x', 'y', 'z', 'vx', 'vy', 'vz']) assert.ok(!bad(p[k]), `projectile ${k}`);
  assert.ok(f.game.actors.length <= CAPS.actors);
});

test('people die outright: one bullet, one blast or one ram, and they never get up', () => {
  for (const kind of ['bullet', 'blast', 'ram']) {
    const game = makeGame();
    const crew = shooter(game, 0, 0, 'pistol', 'crew');
    crew.maxHp = crew.hp = 60;
    assert.ok(damage(game, crew, 1, null, kind) > 0);
    assert.equal(crew.hp, 0, `${kind} kills a full-health person`);
    assert.equal(crew.life, 'down');
    // Was 12 s (bodies faded after 3 s); bodies now lie BODY_LIE_T = 30 s.
    steps(game, Math.round((DOWN_T + OUT_LIE_T + FADE_T) * 60) + 30);
    assert.equal(crew.life, 'out', `${kind}: lies there, no get-up`);
    assert.equal(crew.fade, 1, 'then fades');
    assert.equal(crew.hp, 0);
  }
});

test('the player cannot be killed while RULES.invulnerable is on', () => {
  CLASSIC.invulnerable = true;
  try {
    const game = makeGame();
    const w = game.player.walker;
    initActor(w, 'player');
    addActor(game, w);
    assert.equal(damage(game, w, 500, null, 'blast'), 0);
    assert.equal(w.life, 'ok');
    assert.equal(w.hp, 100);
  } finally {
    CLASSIC.invulnerable = false;
  }
});

// Slice 1 of W6 (REVAMP 6.7 layer 9): the hull now lies WRECK_LIE_T = 60 s and
// fades WRECK_FADE_T = 2 s (WRECK_T is the sum); it was 3 s in all.
test('a destroyed car explodes, its hull lies 60 s, then sinks away and is removed', () => {
  const game = makeGame();
  const car = createVehicle('sedan', 30, 0, 0, null);
  game.vehicles.push(car);
  const ex = record(game, 'explosion');
  damage(game, car, 1e5, null, 'blast');
  steps(game, 2);
  assert.ok(car.wrecked);
  assert.equal(ex.length, 1);
  assert.equal(ex[0].craft, car, 'the blast names the craft so debris can fly');
  steps(game, 30 * 60);
  assert.ok(!car.removed && game.vehicles.includes(car), 'the hull is still there 30 s after the blast');
  assert.equal(car.wreckFade, 0, 'and not fading yet');
  assert.ok(game.combat.hulls.includes(car));
  steps(game, Math.round((WRECK_LIE_T - 30 + WRECK_FADE_T * 0.5) * 60));
  assert.ok(car.wreckFade > 0.3 && car.wreckFade < 0.7 && car.y < -0.2, `sinking as it fades (${car.wreckFade}, y ${car.y})`);
  assert.ok(!car.removed);
  steps(game, Math.round(WRECK_FADE_T * 60));
  assert.ok(car.removed, 'removed');
  assert.ok(!game.vehicles.includes(car), 'gone from game.vehicles');
});

test('wrecks go through game.removeVehicle when the game has it', () => {
  const game = makeGame();
  const seen = [];
  game.removeVehicle = (v) => {
    seen.push(v);
    game.vehicles.splice(game.vehicles.indexOf(v), 1);
    v.removed = true;
  };
  const car = createVehicle('sedan', 30, 0, 0, null);
  game.vehicles.push(car);
  damage(game, car, 1e5, null, 'blast');
  steps(game, Math.round((WRECK_T + 1) * 60));
  assert.deepEqual(seen, [car]);
});

test('the player is ejected from a destroyed car and never left stuck in a removed wreck', () => {
  const game = makeGame();
  const car = createVehicle('sedan', 30, 0, 0, null);
  game.vehicles.push(car);
  car.driver = 'player';
  game.player.vehicle = car;
  game.player.mode = 'car';
  game.combat.damage(car, 1e5, null, 'blast');
  steps(game, 2);
  assert.equal(game.player.vehicle, null, 'ejected at the blast');
  steps(game, Math.round((WRECK_T + 1) * 60));
  assert.ok(car.removed);
  const w = game.player.walker;
  assert.ok(Number.isFinite(w.x) && Number.isFinite(w.z));
  assert.equal(car.driver, null);
  // A wreck the blast never ejected the player from (chain limit): ejected, then removed.
  const car2 = createVehicle('sedan', 60, 0, 0, null);
  game.vehicles.push(car2);
  car2.driver = 'player';
  car2.wrecked = true;
  car2.wreckT = 0;
  game.player.vehicle = car2;
  steps(game, Math.round((WRECK_T + 0.5) * 60));
  assert.equal(game.player.vehicle, null);
  assert.ok(car2.removed);
});

test('explosions kill and throw people in range, and chain blasts stay capped', () => {
  const game = makeGame();
  const a = civ(game, 3, 0);
  game.combat.explode(0, 0.9, 0, 8, null, 0);
  assert.equal(a.hp, 0);
  assert.ok(a.kx > 0, 'thrown away from the blast');
  const cars = [];
  for (let i = 0; i < 12; i++) {
    const c = createVehicle('sedan', 40 + i * 3, 0, 0, null);
    c.health = 60; // brittle, so the blasts chain
    game.vehicles.push(c);
    cars.push(c);
  }
  const ex = record(game, 'explosion');
  damage(game, cars[0], 1e5, null, 'blast');
  steps(game, 60 * 10);
  assert.ok(ex.length >= 2 && ex.length <= cars.length + 1, `${ex.length} blasts`);
  // Hulls stay now, but never more than WRECK_MAX standing (not fading) at once.
  const standing = cars.filter((c) => c.wrecked && !c.removed && c.wreckT !== undefined && c.wreckT < WRECK_LIE_T).length;
  assert.ok(standing <= WRECK_MAX, `${standing} standing hulls`);
  steps(game, Math.round((WRECK_T + 1) * 60));
  assert.ok(cars.every((c) => c.removed || !c.wrecked), cars.map((c) => [c.wrecked, c.removed, c.wreckT, c.exploded, c.health].join()).join(' | '));
});

test('hull cap: never more than 6 standing hulls; a seventh makes the oldest fade at once', () => {
  const game = makeGame();
  const removed = [];
  game.removeVehicle = (v) => {
    removed.push(v);
    game.vehicles.splice(game.vehicles.indexOf(v), 1);
    v.removed = true;
  };
  const flames = record(game, 'hullBurn');
  const made = [];
  let worst = 0;
  for (let i = 0; i < 10; i++) {
    const c = createVehicle('sedan', -200 + i * 40, 150, 0, null);
    game.vehicles.push(c);
    made.push(c);
    damage(game, c, 1e5, null, 'blast');
    for (let k = 0; k < 90; k++) {
      steps(game, 1);
      const n = game.vehicles.filter((v) => v.wrecked && v.wreckT !== undefined && v.wreckT < WRECK_LIE_T).length;
      worst = Math.max(worst, n);
    }
  }
  assert.ok(worst <= WRECK_MAX, `at most ${WRECK_MAX} standing hulls (saw ${worst})`);
  assert.equal(worst, WRECK_MAX, 'the cap is reached');
  assert.ok(removed[0] === made[0], 'the oldest went first');
  assert.ok(!made[9].removed && made[9].wreckFade === 0, 'the newest stands');
  // Flames on, then off after WRECK_FLAME_T s.
  assert.ok(flames.some((e) => e.on && e.id === made[0].id));
  steps(game, Math.round(WRECK_FLAME_T * 60) + 2);
  assert.equal(made[9].hullFlame, false, 'flames die down after 12 s');
});

test('body cap: bodies lie 30 s, never more than 12 at once, the oldest fades early', () => {
  assert.equal(BODY_LIE_T, 30);
  assert.equal(OUT_LIE_T, BODY_LIE_T);
  const game = makeGame();
  const bodies = [];
  let worst = 0;
  for (let i = 0; i < 16; i++) {
    const a = civ(game, i * 3, 40);
    bodies.push(a);
    damage(game, a, 100, null, 'bullet');
    for (let k = 0; k < 60; k++) {
      steps(game, 1);
      const n = game.actors.filter((x) => x.life === 'out' && x.fade === 0 && x.team !== 'player').length;
      worst = Math.max(worst, n);
    }
  }
  assert.ok(worst <= BODY_MAX, `at most ${BODY_MAX} lying bodies (saw ${worst})`);
  assert.equal(worst, BODY_MAX);
  assert.ok(bodies[0].fade > 0, 'the oldest started fading early');
  assert.equal(bodies[15].fade, 0, 'the newest still lies');
  // A lone body lies the full 30 s.
  const g2 = makeGame();
  const b = civ(g2, 0, 0);
  damage(g2, b, 100, null, 'bullet');
  steps(g2, Math.round((DOWN_T + 29) * 60));
  assert.equal(b.life, 'out');
  assert.equal(b.fade, 0, 'still there 29 s after it went down');
  steps(g2, Math.round((BODY_LIE_T - 29 + FADE_T) * 60) + 4);
  assert.equal(b.fade, 1);
});

test('determinism: the same seed gives the same fight', () => {
  const run = () => {
    const game = makeGame({ seed: 77 });
    const out = [];
    const people = [];
    for (let i = 0; i < 6; i++) people.push(civ(game, 4 + i * 2, (i % 3) - 1));
    const a = shooter(game, -10, 0, 'smg', 'crew');
    const car = createVehicle('sedan', 12, 3, 0, null);
    game.vehicles.push(car);
    for (let k = 0; k < 240; k++) {
      if (k % 3 === 0) game.combat.fire(a, 1, 0, 0);
      if (k === 60) damage(game, car, 1e5, null, 'blast');
      steps(game, 1);
    }
    for (const p of people) out.push(p.life, p.x.toFixed(4), p.z.toFixed(4), (p.y || 0).toFixed(4), p.ragYaw.toFixed(4));
    out.push(car.x.toFixed(4), car.z.toFixed(4), car.y.toFixed(4), car.tRoll.toFixed(4));
    return out.join('|');
  };
  assert.equal(run(), run());
});
