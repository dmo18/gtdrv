// Explosives and craft weapons (docs/ARMS.md sections 1, 2, 7).
import { RULES as CLASSIC } from '../src/core/weapons.js';
CLASSIC.unlimitedAmmo = false; // these tests check the classic rules
CLASSIC.invulnerable = false;
import test from 'node:test';
import assert from 'node:assert/strict';
import { createEvents } from '../src/core/events.js';
import { createCollisionWorld } from '../src/world/collision.js';
import { createInput } from '../src/core/input.js';
import { createWalker } from '../src/entities/onfoot.js';
import { createVehicle } from '../src/entities/vehicle.js';
import {
  WEAPONS, MOUNTS, createArms, createCraftArms, mountFor, tryMount, stepCraftArms, mountReload,
  USE_OK, USE_LAST, USE_NO,
} from '../src/core/weapons.js';
import {
  createCombat, initActor, addActor, CRAFT_HOOKS, hooksFor, TYPE_CAPS, STICKY_MAX, STICKY_LIFE,
  BLAST_DMG, explosionSize, CAPS,
} from '../src/systems/combat.js';

const DT = 1 / 60;

function makeGame({ seed = 1, input = false } = {}) {
  const collision = createCollisionWorld();
  const nodes = [];
  for (let i = -3; i <= 3; i++) for (let j = -3; j <= 3; j++) nodes.push({ id: nodes.length, x: i * 50, z: j * 50 });
  const city = { nodes, spawn: { x: 0, z: 0, heading: 0 }, isGround: (x) => x < 400 };
  const walker = createWalker(0, 0, 0);
  const game = {
    events: createEvents(), collision, city, world: { collision, city }, seaY: -0.6,
    vehicles: [], actors: [], time: 0,
    player: { mode: 'foot', vehicle: null, walker, x: 0, z: 0, y: 0, health: 100, wanted: 0 },
    input: input ? createInput() : null,
  };
  createCombat(game, { seed });
  return game;
}
const actor = (game, x, z, team = 'civ') => {
  const a = initActor({ x, z, y: 0, heading: 0, radius: 0.35, px: x, pz: z, vx: 0, vz: 0 }, team);
  addActor(game, a);
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
const car = (game, x, z, heading = 0) => {
  const c = createVehicle('sedan', x, z, heading);
  c.vx = c.vx || 0;
  c.vz = c.vz || 0;
  game.vehicles.push(c);
  return c;
};
// A fixture armed aircraft (the real fighter comes with task 33).
const FIGHTER = {
  id: 'testjet', kind: 'plane', length: 12, width: 9, height: 3.4, health: 700, hitRadius: 1.9,
  mounts: ['nosegun', 'missile', 'bomb'],
};
const HELI = { id: 'testheli', kind: 'heli', length: 10, width: 9, height: 3.2, health: 360, mounts: ['drop'] };
const craft = (game, spec, x, y, z, heading = 0, speed = 0) => {
  const c = {
    kind: spec.kind, spec, x, y, z, heading, pitch: 0, roll: 0, vx: Math.cos(heading) * speed, vy: 0,
    vz: Math.sin(heading) * speed, speed, health: spec.health, wrecked: false, radius: 4, onGround: false,
  };
  game.vehicles.push(c);
  return c;
};
const throwDir = (pitch, yaw = 0) => [Math.cos(yaw) * Math.cos(pitch), Math.sin(pitch), Math.sin(yaw) * Math.cos(pitch)];

test('weapons: sticky row, blastScale, mounts table with invented names', () => {
  const s = WEAPONS.sticky;
  assert.deepEqual([s.name, s.type, s.blast, s.blastScale, s.rate, s.rangeMin, s.range, s.mag, s.reload],
    ['Barnacle Charge', 'sticky', 6, 1.4, 1.5, 6, 18, 1, 0.6]);
  assert.deepEqual([WEAPONS.fizz.blastScale, WEAPONS.fizz.rangeMin, WEAPONS.fizz.fuse, WEAPONS.fizz.bounce], [1, 6, 2.2, 0.35]);
  const rows = {
    cannon: ['Thudder', 'shell', 220, 0.4, 300, 1, 2.5], coax: ['Rattlecoax', 'hitscan', 14, 10, 60, 50, 2],
    nosegun: ['Hailbox', 'hitscan', 18, 15, 220, 120, 2], chingun: ['Chatter Pod', 'hitscan', 10, 8, 120, 60, 2],
    missile: ['Gullseeker', 'missile', 900, 1, 600, 2, 3], bomb: ['Pelican Drop', 'bomb', 0, 3, 0, 6, 5],
  };
  for (const id of Object.keys(rows)) {
    const m = MOUNTS[id];
    assert.deepEqual([m.name, m.type, m.dmg, m.rate, m.range, m.mag, m.reload], rows[id], id);
  }
  assert.deepEqual([MOUNTS.missile.speed, MOUNTS.missile.turn, MOUNTS.missile.life, MOUNTS.missile.blast], [95, 2.4, 6, 9]);
  assert.deepEqual([MOUNTS.bomb.blast, MOUNTS.bomb.blastScale, MOUNTS.cannon.aiSpeed], [14, 9, 45]);
  assert.deepEqual(TYPE_CAPS, { missile: 4, bomb: 6, shell: 4, thrown: 6 });
  assert.equal(explosionSize(5), 'small');
  assert.equal(explosionSize(8), 'big');
  assert.equal(explosionSize(11), 'huge');
});

test('craft arms: slots, bomb counts by kind, ammo, cooldown and auto reload', () => {
  assert.equal(createCraftArms({ kind: 'plane' }), null);
  const a = createCraftArms(FIGHTER);
  assert.deepEqual([mountFor(a, 0), mountFor(a, 1), mountFor(a, 'drop')], ['nosegun', 'missile', 'bomb']);
  assert.equal(a.max.bomb, 6);
  const h = createCraftArms(HELI);
  assert.deepEqual([mountFor(h, 0), mountFor(h, 'drop'), h.max.bomb], [null, 'bomb', 4]);
  // Missiles: 2 rounds, 1 s apart, then a 3 s reload, then full again.
  assert.equal(tryMount(a, 'missile'), USE_OK);
  assert.equal(tryMount(a, 'missile'), USE_NO, 'cooling down');
  for (let i = 0; i < 60; i++) stepCraftArms(a, DT);
  assert.equal(tryMount(a, 'missile'), USE_LAST);
  assert.ok(a.reloading.missile && mountReload(a, 'missile') > 0);
  for (let i = 0; i < 179; i++) stepCraftArms(a, DT);
  assert.equal(a.mag.missile, 0, 'still reloading at 2.98 s');
  for (let i = 0; i < 3; i++) stepCraftArms(a, DT);
  assert.equal(a.mag.missile, 2, 'reloaded after 3 s');
  assert.equal(mountReload(a, 'missile'), 0);
});

test('throw preview: the arc lands within 0.5 m of the real can, range follows pitch', () => {
  for (const [pitch, wall] of [[-0.2, false], [0.2, false], [0.6, false], [0.4, true]]) {
    const g = makeGame();
    if (wall) g.collision.addBox(12, -10, 14, 10, 30);
    const w = g.player.walker;
    w.arms = createArms('fizz');
    const [dx, dy, dz] = throwDir(pitch, 0.3);
    const out = { pts: new Float32Array(72), n: 0, hx: 0, hy: 0, hz: 0, kind: 'none' };
    g.combat.predictThrow(w, dx, dy, dz, 'fizz', out);
    assert.ok(out.n >= 3 && out.n <= 24, `points ${out.n}`);
    for (let i = 0; i < out.n * 3; i++) assert.ok(Number.isFinite(out.pts[i]));
    assert.ok(g.combat.fire(w, dx, dy, dz));
    const can = g.combat.projectiles.find((p) => p.active);
    let hit = null;
    const bounces = record(g, 'bounce');
    for (let i = 0; i < 400 && can.active && !hit; i++) {
      steps(g, 1);
      if (bounces.length) hit = bounces[0];
    }
    assert.ok(hit, 'the can bounced');
    const d = Math.hypot(hit.x - out.hx, hit.z - out.hz);
    assert.ok(d < 0.5, `pitch ${pitch}: preview ${out.hx.toFixed(2)},${out.hz.toFixed(2)} real ${hit.x.toFixed(2)},${hit.z.toFixed(2)}`);
    assert.equal(out.kind, wall ? 'wall' : 'ground');
    if (!wall) {
      const reach = Math.hypot(out.hx, out.hz);
      const want = 6 + 19 * Math.max(0, Math.min(1, (pitch + 0.2) / 0.8));
      assert.ok(Math.abs(reach - want) < 2.5, `pitch ${pitch}: reach ${reach.toFixed(1)} want about ${want.toFixed(1)}`);
    }
  }
});

test('grenade: fuse 2.2 s, blast falloff, blastScale, knocks people down, damages a car', () => {
  const g = makeGame();
  const w = g.player.walker;
  w.arms = createArms('fizz');
  const ring = [];
  for (let i = 0; i < 12; i++) ring.push(actor(g, 6 + i * 1.5, 0.5));
  const c = car(g, 11, 3);
  const h0 = c.health;
  const ex = record(g, 'explosion');
  // Land it about 10.7 m out (pitch 0).
  g.combat.fire(w, 1, 0, 0);
  let t = 0;
  while (!ex.length && t < 3) {
    steps(g, 1);
    t += DT;
  }
  assert.ok(Math.abs(t - 2.2) < 0.05, `fuse ${t}`);
  assert.equal(ex[0].radius, 5);
  assert.equal(ex[0].size, 'small');
  let inside = 0;
  let prevLost = Infinity, prevD = -1;
  const byD = ring.map((a) => [Math.hypot(a.x - ex[0].x, a.z - ex[0].z), a]).sort((p, q) => p[0] - q[0]);
  for (const [d, a] of byD) {
    if (d < 4.5) {
      inside++;
      assert.equal(a.life, 'down', `down at ${d.toFixed(1)} m`);
    }
    if (d > 5.2) assert.equal(a.hp, a.maxHp, `untouched at ${d.toFixed(1)} m`);
    const lost = a.maxHp - a.hp;
    if (d > prevD + 0.5 && lost < a.maxHp) assert.ok(lost <= prevLost + 1e-6, 'falloff');
    prevLost = Math.min(prevLost, lost);
    prevD = d;
  }
  assert.ok(inside >= 2, `people inside ${inside}`);
  assert.ok(c.health < h0 || Math.hypot(c.x - ex[0].x, c.z - ex[0].z) - c.radius * 0.5 > 5, `car damaged ${Math.hypot(c.x - ex[0].x, c.z - ex[0].z)} r ${c.radius}`);
  // blastScale: the same spot with a charge's x1.4 hurts more.
  const g2 = makeGame();
  const a1 = actor(g2, 3, 0, 'crew'), a2 = actor(g2, 103, 0, 'crew');
  g2.combat.explode(0, 0.9, 0, 6, null, 0, 1);
  steps(g2, 40);
  g2.combat.explode(100, 0.9, 0, 6, null, 0, 1.4);
  const lost1 = a1.maxHp - a1.hp, lost2 = a2.maxHp - a2.hp;
  assert.ok(Math.abs(lost1 - BLAST_DMG * 0.5) < 1, `x1 ${lost1}`);
  assert.ok(Math.abs(lost2 - Math.min(a2.maxHp, BLAST_DMG * 0.5 * 1.4)) < 1, `x1.4 ${lost2}`);
});

test('cans: 3 in flight per player, the 4th clicks', () => {
  const g = makeGame();
  const w = g.player.walker;
  w.arms = createArms('fizz');
  let thrown = 0;
  for (let i = 0; i < 6; i++) {
    w.arms.cool = 0;
    w.arms.mag.fizz = 1;
    w.arms.reloading = null;
    if (g.combat.fire(w, 1, 0.3, 0)) thrown++;
    steps(g, 2);
  }
  const live = g.combat.projectiles.filter((p) => p.active && p.type === 'thrown').length;
  assert.equal(live, 3);
  assert.equal(thrown, 3);
});

test('sticky: sticks to ground, walls and craft (rides along), bounces off people', () => {
  const g = makeGame();
  const w = g.player.walker;
  w.arms = createArms('sticky');
  const ev = record(g, 'sticky');
  g.combat.fire(w, 1, 0, 0);
  steps(g, 120);
  const st = g.combat.stickies.find((s) => s.active);
  assert.ok(st && st.y < 0.2 && st.x > 8, 'stuck on the ground');
  assert.ok(ev.some((e) => e.on && !e.beep));
  steps(g, 120);
  assert.ok(ev.some((e) => e.beep), 'beeps');
  // On a moving car.
  const g2 = makeGame();
  const w2 = g2.player.walker;
  w2.arms = createArms('sticky');
  const c = car(g2, 9, 0);
  g2.combat.fire(w2, 1, 0, 0);
  for (let i = 0; i < 120; i++) steps(g2, 1);
  const s2 = g2.combat.stickies.find((s) => s.active);
  assert.ok(s2 && s2.craft === c, 'stuck on the car');
  const ox = s2.x - c.x, oz = s2.z - c.z;
  c.x += 30;
  c.heading = Math.PI / 2;
  steps(g2, 1);
  assert.ok(Math.abs(s2.x - c.x - (-oz)) < 0.01 && Math.abs(s2.z - c.z - ox) < 0.01, 'rides along, turning with the hull');
  // A removed craft drops it.
  c.removed = true;
  steps(g2, 1);
  assert.equal(s2.active, false);
  // A person in the way: it bounces off and lands beyond.
  const g3 = makeGame();
  const w3 = g3.player.walker;
  w3.arms = createArms('sticky');
  const a = actor(g3, 4, 0);
  a.height = 3;
  g3.combat.fire(w3, 1, -0.2, 0);
  steps(g3, 200);
  const s3 = g3.combat.stickies.find((s) => s.active);
  assert.ok(!s3 || s3.craft !== a, 'never sticks to a person');
});

test('sticky: 4 placed, the 5th blows the oldest, fizzle after 120 s and on respawn', () => {
  const g = makeGame();
  const w = g.player.walker;
  w.arms = createArms('sticky');
  const ex = record(g, 'explosion');
  for (let i = 0; i < STICKY_MAX; i++) {
    g.combat.fire(w, Math.cos(i), 0.2, Math.sin(i));
    steps(g, 150);
  }
  assert.equal(g.combat.countStickies(w), 4);
  const oldest = g.combat.stickies.reduce((a, b) => (a.seq < b.seq ? a : b));
  const ox = oldest.x;
  g.combat.fire(w, -1, 0.2, 0);
  steps(g, 2);
  assert.equal(ex.length, 1, 'oldest blew');
  assert.ok(Math.abs(ex[0].x - ox) < 0.5);
  steps(g, 150);
  assert.equal(g.combat.countStickies(w), 4);
  steps(g, Math.round(STICKY_LIFE * 60));
  assert.equal(g.combat.countStickies(w), 0, 'fizzled after 120 s');
  g.combat.fire(w, 1, 0.2, 0);
  steps(g, 150);
  assert.equal(g.combat.countStickies(w), 1);
  g.combat.respawn();
  assert.equal(g.combat.countStickies(w), 0, 'fizzles on respawn');
});

test('detonate: all charges blow 0.08 s apart through the queue and the chain cap', () => {
  const g = makeGame();
  const w = g.player.walker;
  w.arms = createArms('sticky');
  const ex = record(g, 'explosion'), det = record(g, 'detonate');
  for (let i = 0; i < 4; i++) {
    g.combat.fire(w, Math.cos(i * 1.5), 0.3, Math.sin(i * 1.5));
    steps(g, 150);
  }
  // Parked cars near the charges, ready to chain.
  for (const s of g.combat.stickies) {
    const c = car(g, s.x + 2, s.z);
    c.health = 50;
  }
  const t0 = g.combat.liveExplosions();
  assert.equal(t0, 0);
  assert.equal(g.combat.detonateStickies(w), 4);
  assert.equal(det[0].count, 4);
  let maxLive = 0;
  const times = [];
  for (let i = 0; i < 240; i++) {
    const n = ex.length;
    steps(g, 1);
    if (ex.length > n) times.push(i);
    maxLive = Math.max(maxLive, g.combat.liveExplosions());
  }
  assert.ok(ex.length >= 4, `explosions ${ex.length}`);
  assert.ok(maxLive <= CAPS.explosions, `live ${maxLive}`);
  assert.ok(times[1] - times[0] >= 4, 'spaced apart');
  assert.ok(ex.every((e) => e.depth <= 2));
  assert.equal(g.combat.countStickies(w), 0);
});

test('bomb: ballistic from the craft velocity, predictDrop within 1 m, huge blast, sea splash', () => {
  const g = makeGame();
  const jet = craft(g, FIGHTER, 0, 120, 0, 0, 60);
  const target = car(g, 200, 0);
  const pd = g.combat.predictDrop(jet, { ok: false, hx: 0, hy: 0, hz: 0, t: 0, kind: 'none' });
  assert.ok(pd.ok && pd.kind === 'ground');
  const fall = Math.sqrt(2 * 119.6 / 9.81);
  assert.ok(Math.abs(pd.hx - 60 * fall) < 3, `impact x ${pd.hx}`);
  const ex = record(g, 'explosion'), launch = record(g, 'launch'), fallEv = record(g, 'bombFall');
  assert.ok(g.combat.fireMount(jet, 'drop', 1, 0, 0));
  assert.equal(launch[0].weapon, 'bomb');
  assert.equal(fallEv.length, 1);
  jet.vx = 0; // the plane flies on; the bomb keeps its own velocity
  for (let i = 0; i < 600 && !ex.length; i++) steps(g, 1);
  assert.equal(ex.length, 1);
  assert.ok(Math.hypot(ex[0].x - pd.hx, ex[0].z - pd.hz) < 1, `hit ${ex[0].x},${ex[0].z} vs ${pd.hx},${pd.hz}`);
  assert.equal(ex[0].radius, 14);
  assert.equal(ex[0].size, 'huge');
  assert.ok(target.health < target.spec.health || Math.abs(target.x - pd.hx) > 11);
  // Over the sea: splash, no explosion.
  const g2 = makeGame();
  const j2 = craft(g2, FIGHTER, 500, 60, 0, 0, 0);
  const sp = record(g2, 'splash'), ex2 = record(g2, 'explosion');
  g2.combat.fireMount(j2, 'drop', 1, 0, 0);
  steps(g2, 400);
  assert.equal(ex2.length, 0);
  assert.ok(sp.length >= 1);
  // On the ground: no drop.
  const g3 = makeGame();
  const j3 = craft(g3, FIGHTER, 0, 0, 0);
  j3.onGround = true;
  assert.equal(g3.combat.fireMount(j3, 'drop', 1, 0, 0), false);
});

test('bomb on a car under the plane: full blast damage (120 x 1.5 x 1.6)', () => {
  const g = makeGame();
  const jet = craft(g, FIGHTER, 0, 40, 0, 0, 0);
  const target = car(g, 0, 0);
  const h0 = target.health;
  g.combat.fireMount(jet, 'drop', 1, 0, 0);
  steps(g, 300);
  assert.ok(h0 - target.health > 250, `lost ${h0 - target.health}`);
});

test('type caps: bombs 6 live, the 7th clicks; ammo is not used on a click', () => {
  const g = makeGame();
  const big = { ...FIGHTER, id: 'bigjet', bombs: 12 };
  const jet = craft(g, big, 0, 3000, 0);
  let n = 0;
  for (let i = 0; i < 9; i++) {
    if (g.combat.fireMount(jet, 'drop', 1, 0, 0)) n++;
    for (let k = 0; k < 21; k++) g.combat.fixedUpdate(DT);
  }
  assert.equal(n, 6);
  assert.equal(g.combat.projectiles.filter((p) => p.active && p.type === 'bomb').length, 6);
  assert.equal(jet.arms.mag.bomb, 6);
});

test('missile: homes on a turning target only when locked; straight without', () => {
  const run = (locked) => {
    const g = makeGame();
    const jet = craft(g, FIGHTER, 0, 60, 0, 0, 50);
    const tgt = craft(g, { ...HELI, id: 'tgtheli', mounts: [], health: 200 }, 250, 60, 40);
    tgt.radius = 3;
    jet.vx = 0;
    const ex = record(g, 'explosion');
    const dir = { x: 1, y: 0, z: 0 };
    assert.ok(g.combat.fireMount(jet, 1, dir.x, dir.y, dir.z, null, locked ? tgt : null));
    let t = 0;
    for (let i = 0; i < 420 && !ex.length; i++) {
      // The target circles.
      t += DT;
      tgt.x = 250 + Math.cos(t) * 30;
      tgt.z = 40 + Math.sin(t) * 30;
      steps(g, 1);
    }
    return { ex, tgt };
  };
  const a = run(true);
  assert.ok(a.ex.length >= 1);
  assert.ok(Math.hypot(a.ex[0].x - a.tgt.x, a.ex[0].z - a.tgt.z) < 4, 'detonated at the target');
  assert.ok(a.tgt.wrecked || a.tgt.health < 200);
  const b = run(false);
  assert.ok(!b.ex.length || Math.abs(b.ex[0].z) < 1, 'unlocked: flies straight');
  assert.equal(b.tgt.health, 200);
});

test('nose gun hitscan through fireMount; armor multipliers', () => {
  const g = makeGame();
  const jet = craft(g, FIGHTER, 0, 0, 0);
  const c = car(g, 40, 0);
  const shot = record(g, 'shot');
  const h0 = c.health;
  assert.ok(g.combat.fireMount(jet, 0, 1, 0, 0));
  assert.equal(shot[0].weapon, 'nosegun');
  assert.ok(c.health < h0);
  const armored = craft(g, { ...HELI, id: 'armored', armor: { bullet: 0.04, blast: 0.6 }, mounts: [] }, 100, 0, 100);
  armored.health = 1000;
  g.combat.damage(armored, 100, null, 'bullet');
  assert.ok(Math.abs(armored.health - (1000 - 100 * 0.5 * 0.04)) < 1e-9);
  g.combat.damage(armored, 100, null, 'blast');
  assert.ok(Math.abs(armored.health - (1000 - 2 - 60)) < 1e-9);
});

test('own blast: x0.25 on the player\'s own craft and never wrecks it', () => {
  const g = makeGame();
  const heli = craft(g, HELI, 0, 0.5, 0);
  heli.onGround = false;
  heli.driver = 'player';
  g.player.vehicle = heli;
  g.player.mode = 'heli';
  const w = g.player.walker;
  heli.health = 30;
  g.combat.explode(0, 1, 0, 11, w, 0, 1.6);
  assert.ok(heli.health >= 1 && !heli.wrecked, `health ${heli.health}`);
  assert.equal(g.player.vehicle, heli);
  heli.health = 360;
  steps(g, 60);
  g.combat.explode(0, 2, 0, 11, w, 0, 1);
  const lost = 360 - heli.health;
  assert.ok(lost > 0 && lost <= BLAST_DMG * 1.5 * 0.25 + 1e-6, `lost ${lost}`);
});

test('player controls: hold FIRE previews, release throws; cancel; armed craft fire, fire2, drop, detonate, siren', () => {
  const g = makeGame({ input: true });
  const w = g.player.walker;
  const inp = g.input;
  w.arms = createArms('fizz');
  inp.press('fire');
  steps(g, 3);
  assert.ok(g.combat.preview.on && g.combat.preview.n > 2, 'preview while held');
  assert.equal(g.combat.projectiles.filter((p) => p.active).length, 0, 'nothing thrown on press');
  inp.release('fire');
  steps(g, 1);
  assert.equal(g.combat.projectiles.filter((p) => p.active).length, 1, 'thrown on release');
  assert.equal(g.combat.preview.on, false);
  steps(g, 60);
  // Cancel by a swap tap while aiming: nothing thrown, weapon kept.
  inp.press('fire');
  steps(g, 2);
  inp.press('swap');
  inp.release('swap');
  steps(g, 1);
  inp.endStep();
  inp.release('fire');
  steps(g, 1);
  assert.equal(g.combat.projectiles.filter((p) => p.active).length, 1);
  assert.equal(w.arms.weapon, 'fizz');
  // Armed craft.
  const jet = craft(g, { ...FIGHTER, police: true }, 0, 80, 0, 0, 40);
  jet.driver = 'player';
  g.player.vehicle = jet;
  const shots = record(g, 'shot'), launches = record(g, 'launch'), sirens = record(g, 'siren');
  inp.press('fire');
  steps(g, 10);
  inp.release('fire');
  assert.ok(shots.filter((s) => s.weapon === 'nosegun').length >= 2, 'GUN held fires');
  inp.press('fire2');
  steps(g, 1);
  inp.release('fire2');
  inp.endStep();
  inp.press('drop');
  steps(g, 1);
  inp.release('drop');
  inp.endStep();
  assert.deepEqual(launches.map((l) => l.weapon), ['missile', 'bomb']);
  assert.ok(g.combat.dropPreview.on, 'bomb ring while aboard');
  inp.press('horn');
  steps(g, 1);
  inp.endStep();
  assert.equal(jet.siren, true);
  assert.equal(sirens[0].on, true);
  // DETONATE from the craft.
  g.combat.stickies[0].active = true;
  g.combat.stickies[0].owner = w;
  g.combat.stickies[0].fuse = -1;
  inp.press('detonate');
  steps(g, 1);
  inp.endStep();
  steps(g, 30);
  assert.equal(g.combat.countStickies(w), 0);
});

test('craft hooks: registered empty for tank, fighter, police heli and called when filled', () => {
  for (const k of ['tank', 'fighter', 'patrolheli']) {
    assert.ok(CRAFT_HOOKS[k], k);
    for (const f of ['controls', 'aim', 'muzzle', 'fired']) assert.ok(f in CRAFT_HOOKS[k] && CRAFT_HOOKS[k][f] === null, `${k}.${f}`);
  }
  assert.equal(hooksFor({ kind: 'tank', spec: { id: 'rustback' } }), CRAFT_HOOKS.tank);
  assert.equal(hooksFor({ kind: 'plane', spec: { id: 'fighter' } }), CRAFT_HOOKS.fighter);
  const g = makeGame({ input: true });
  const calls = [];
  const tank = craft(g, { id: 'fixturetank', kind: 'tank', length: 7, width: 3.6, height: 2.6, health: 1000, mounts: ['cannon', 'coax'] }, 0, 0, 0);
  tank.onGround = true;
  CRAFT_HOOKS.tank.controls = () => calls.push('controls');
  CRAFT_HOOKS.tank.aim = (gm, c, slot, id, out) => { calls.push('aim:' + id); out.x = 0; out.y = 0; out.z = 1; return true; };
  CRAFT_HOOKS.tank.fired = (gm, c, slot, id) => calls.push('fired:' + id);
  try {
    g.player.vehicle = tank;
    g.input.press('fire');
    steps(g, 1);
    assert.ok(calls.includes('controls') && calls.includes('aim:cannon') && calls.includes('fired:cannon'), calls.join());
    const shell = g.combat.projectiles.find((p) => p.active && p.type === 'shell');
    assert.ok(shell && shell.vz > 80 && Math.abs(shell.vx) < 2, 'fired along the hook direction at 90 m/s');
  } finally {
    CRAFT_HOOKS.tank.controls = CRAFT_HOOKS.tank.aim = CRAFT_HOOKS.tank.fired = null;
  }
});

test('determinism and no NaN over thousands of steps of mixed fire', () => {
  const run = () => {
    const g = makeGame({ seed: 7 });
    g.collision.addBox(30, -40, 34, 40, 12);
    const w = g.player.walker;
    const jet = craft(g, FIGHTER, -50, 70, 0, 0, 45);
    const cars = [car(g, 20, 5), car(g, 25, -8), car(g, 40, 20)];
    for (let i = 0; i < 10; i++) actor(g, 10 + i * 2, (i % 3) * 4 - 4, i % 2 ? 'crew' : 'civ');
    const ids = ['fizz', 'sticky', 'lobber', 'smg'];
    for (let i = 0; i < 3000; i++) {
      if (i % 50 === 0) {
        w.arms.weapon = ids[(i / 50) % 4 | 0];
        g.combat.fire(w, Math.cos(i), Math.sin(i * 0.3) * 0.5, Math.sin(i));
      }
      if (i % 90 === 0) g.combat.fireMount(jet, i % 180 ? 'drop' : 1, 1, -0.2, 0.1, null, cars[i % 3]);
      if (i % 200 === 0) g.combat.fireMount(jet, 0, 1, -0.4, 0);
      if (i % 700 === 0) g.combat.detonateStickies(w);
      jet.x += jet.vx * DT;
      if (jet.x > 300) jet.x = -100;
      g.combat.fixedUpdate(DT);
      for (const p of g.combat.projectiles) {
        if (p.active) assert.ok(Number.isFinite(p.x + p.y + p.z + p.vx + p.vy + p.vz), `NaN at ${i}`);
      }
      for (const s of g.combat.stickies) if (s.active) assert.ok(Number.isFinite(s.x + s.y + s.z));
    }
    return [cars.map((c) => +c.health.toFixed(6)), g.actors.map((a) => +a.hp.toFixed(6)), jet.health];
  };
  assert.deepEqual(run(), run());
});

test('bombs and missiles wreck an ordinary car (700 to 1100 health) near the blast centre', () => {
  const car = (k) => 120 * k * 1.5;
  assert.ok(car(0.7) * MOUNTS.bomb.blastScale >= 1100, 'bomb within 30% of the radius');
  assert.ok(MOUNTS.missile.dmg + car(1) * MOUNTS.missile.blastScale >= 1100, 'missile direct hit');
});
