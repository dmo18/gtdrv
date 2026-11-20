import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCombatFx, BLOOD_POOLS, BLOOD_SPLATS, DEBRIS_MAX } from '../src/render/combatfx.js';
import { createEvents } from '../src/core/events.js';

// With no scene (node) the effect system must still take every combat
// event without throwing and keep stepping.
test('combatfx survives every event without a scene', () => {
  const events = createEvents();
  const kicks = [];
  const game = {
    events, quality: 0.5, paused: false,
    player: { x: 0, z: 0 },
    chase: { kick: (s) => kicks.push(s) },
    combat: { decals: { x: new Float32Array(24), z: new Float32Array(24), r: new Float32Array(24), t: new Float32Array(24).fill(-1e9) }, projectiles: [] },
  };
  const fx = createCombatFx(game);
  const target = { x: 3, z: 0, hp: 10 };
  const craft = { x: 5, z: 0, spec: { length: 4 }, health: 10, burning: true, heading: 0 };
  const shot = { shooter: target, weapon: 'smg', x: 0, y: 1.4, z: 0, dx: 1, dy: 0, dz: 0, hx: 20, hy: 1, hz: 0, hitKind: 'wall' };
  for (const w of ['wrench', 'pistol', 'smg', 'scatter', 'lobber', 'fizz']) {
    events.emit('shot', { ...shot, weapon: w });
  }
  events.emit('hit', { target, source: null, amount: 5, kind: 'bullet', x: 3, y: 1, z: 0 });
  events.emit('hit', { target: craft, source: null, amount: 5, kind: 'bullet', x: 5, y: 1, z: 0 });
  events.emit('down', { target: { ...target, hp: 5 }, source: null, kind: 'bullet' }); // hurt, not dead: no blood pool
  events.emit('out', { target, source: null });
  events.emit('burning', { craft, on: true });
  events.emit('explosion', { x: 10, y: 0, z: 0, radius: 8, source: null, depth: 0 });
  for (let i = 0; i < 120; i++) fx.fixedUpdate(1 / 60);
  fx.render();
  assert.ok(kicks.length === 1 && kicks[0] > 1.5, 'a nearby blast kicks the camera');
  assert.deepEqual(fx.counts(), { alpha: 0, additive: 0, decals: 0, blood: 1, debris: 0 }, 'only the bullet hit spatter is left');
  fx.dispose();
});

function fxGame() {
  const events = createEvents();
  const game = {
    events, quality: 1, paused: false, player: { x: 0, z: 0 },
    combat: { decals: { x: new Float32Array(24), z: new Float32Array(24), r: new Float32Array(24), t: new Float32Array(24).fill(-1e9) }, projectiles: [] },
  };
  const fx = createCombatFx(game);
  const run = (s) => { for (let i = 0; i < Math.round(s * 60); i++) fx.fixedUpdate(1 / 60); };
  return { events, game, fx, run };
}

test('blood: a hit spatters, a death leaves a pool that fades after about 20 s', () => {
  const { events, fx, run } = fxGame();
  const t = { x: 4, z: 1, y: 0, hp: 0, team: 'civ' };
  events.emit('hit', { target: t, source: null, amount: 25, kind: 'bullet', x: 4, y: 1.1, z: 1 });
  assert.equal(fx.counts().blood, 1, 'one spatter on a hit');
  events.emit('down', { target: t, source: null, kind: 'bullet' });
  assert.ok(fx.counts().blood >= 3, 'pool plus spatters on death');
  run(10);
  assert.ok(fx.counts().blood >= 1, 'still there at 10 s');
  run(12);
  assert.equal(fx.counts().blood, 0, 'gone after about 20 s');
});

test('blood decals are a hard-capped ring buffer', () => {
  const { events, fx, run } = fxGame();
  for (let i = 0; i < 300; i++) {
    const t = { x: i, z: -i, y: 0, hp: 0, team: 'civ' };
    events.emit('hit', { target: t, source: null, amount: 25, kind: 'bullet', x: i, y: 1, z: -i });
    events.emit('down', { target: t, source: null, kind: i % 2 ? 'blast' : 'bullet' });
    if (i % 20 === 0) run(0.1);
    assert.ok(fx.counts().blood <= BLOOD_POOLS + BLOOD_SPLATS, `${fx.counts().blood} blood decals`);
  }
  assert.equal(fx.counts().blood, BLOOD_POOLS + BLOOD_SPLATS, 'ring is full and reuses its slots');
});

test('wreck debris: 6 to 10 chunks per vehicle, pooled with a hard cap, gone in a few seconds', () => {
  const { events, fx, run } = fxGame();
  const car = { kind: 'car', color: 0xc8402e, x: 5, z: 0, y: 0, spec: { length: 4.4, width: 1.8, height: 1.4 } };
  events.emit('explosion', { x: 5, y: 0.7, z: 0, radius: 8, source: null, depth: 0, size: 'small', craft: car });
  const n = fx.counts().debris;
  assert.ok(n >= 6 && n <= 10, `${n} chunks`);
  run(1);
  assert.equal(fx.counts().debris, n, 'still flying');
  run(4);
  assert.equal(fx.counts().debris, 0, 'faded away');
  for (let i = 0; i < 40; i++) {
    events.emit('explosion', { x: i, y: 0.7, z: 0, radius: 8, source: null, depth: 2, size: 'small', craft: car });
    assert.ok(fx.counts().debris <= DEBRIS_MAX);
  }
  assert.equal(fx.counts().debris, DEBRIS_MAX);
  events.emit('explosion', { x: 1, y: 0.7, z: 0, radius: 8, source: null, depth: 0, size: 'small', craft: null });
  assert.equal(fx.counts().debris, DEBRIS_MAX, 'blasts without a craft add no chunks');
});
