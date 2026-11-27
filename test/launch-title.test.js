// A portrait start must not pause (and open the pause menu) behind the title (0.14.1).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRotationGate } from '../src/core/launch.js';

test('game.js skips the rotation gate while the title shows', () => {
  const src = readFileSync(new URL('../src/game.js', import.meta.url), 'utf8');
  const a = src.indexOf('const checkRotation = () => {');
  const b = src.indexOf('rotation.update(', a);
  assert.ok(a > 0 && b > a);
  const body = src.slice(a, b);
  assert.match(body, /portrait && titleUp\(\)/);
  assert.match(body, /clearHeld\(\);\s*return;/, 'held input is still cleared, no pause emit');
  assert.match(src, /getElementById\('boot'\)/);
  assert.match(src.slice(src.indexOf('const titleUp')), /typeof document !== 'undefined'/, 'guarded for no document');
});

test('the gate rule: title up means no pause emit; play pauses on portrait and resumes', () => {
  // The same wrapper game.js uses, with a fake title flag.
  const game = { paused: false };
  const emits = [];
  let cleared = 0;
  let title = true;
  const gate = createRotationGate();
  const check = (portrait) => {
    if (portrait && title) { cleared++; return; }
    gate.update(portrait, game, (p) => emits.push(p), () => cleared++);
  };
  check(true);
  assert.equal(game.paused, false);
  assert.deepEqual(emits, []);
  assert.equal(cleared, 1);
  check(false);
  title = false;
  check(true);
  assert.equal(game.paused, true);
  check(false);
  assert.deepEqual(emits, [true, false]);
});
