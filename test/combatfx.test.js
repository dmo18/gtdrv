import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCombatFx } from '../src/render/combatfx.js';
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
  events.emit('down', { target, source: null, kind: 'bullet' });
  events.emit('out', { target, source: null });
  events.emit('burning', { craft, on: true });
  events.emit('explosion', { x: 10, y: 0, z: 0, radius: 8, source: null, depth: 0 });
  for (let i = 0; i < 120; i++) fx.fixedUpdate(1 / 60);
  fx.render();
  assert.ok(kicks.length === 1 && kicks[0] > 1.5, 'a nearby blast kicks the camera');
  assert.deepEqual(fx.counts(), { alpha: 0, additive: 0, decals: 0 });
  fx.dispose();
});
