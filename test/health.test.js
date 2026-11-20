import test from 'node:test';
import assert from 'node:assert/strict';
import { healthFraction, meterPercent, respawnPlacement } from '../src/core/health.js';
import { sanitizeProgress, defaultProgress } from '../src/core/save.js';

test('healthFraction clamps to 0..1 and treats bad input as empty', () => {
  assert.equal(healthFraction(50, 100), 0.5);
  assert.equal(healthFraction(150, 100), 1);
  assert.equal(healthFraction(-5, 100), 0);
  assert.equal(healthFraction(NaN, 100), 0);
  assert.equal(healthFraction(10, 0), 0);
  assert.equal(healthFraction(10, undefined), 0);
});

test('meterPercent shows craft health aboard, walker hp otherwise', () => {
  assert.equal(meterPercent(40, 100, null), 40);
  assert.equal(meterPercent(40, 100, undefined), 40);
  assert.equal(meterPercent(40, 100, 0.8), 80);
  assert.equal(meterPercent(100, 100, 0), 0);
  assert.equal(meterPercent(33.4, 100, null), 33);
});

test('respawnPlacement: a craft uses the rescue spot beside it, with the fallback when it fails', () => {
  const calls = [];
  const rescue = (x, z, out) => { calls.push(['rescue', x, z]); out.ok = true; out.x = 7; out.z = 9; };
  const fallback = (x, z, out) => { calls.push(['fallback', x, z]); out.x = 1; out.z = 2; };
  const out = { x: 0, z: 0, ok: false };
  respawnPlacement(true, 100, 50, 0, rescue, fallback, out);
  assert.deepEqual([out.x, out.z, out.craftSide], [7, 9, true]);
  assert.deepEqual(calls, [['rescue', 100, 54]]); // heading 0 faces +x, right side is +z
  calls.length = 0;
  const bad = (x, z, o) => { o.ok = false; o.x = NaN; o.z = NaN; };
  respawnPlacement(true, 100, 50, 0, bad, fallback, out);
  assert.deepEqual([out.x, out.z, out.craftSide, out.ok], [1, 2, false, true]);
  respawnPlacement(true, 0, 0, 0, null, fallback, out);
  assert.deepEqual([out.x, out.z], [1, 2]);
});

test('respawnPlacement: on foot goes straight to the road-node fallback', () => {
  let rescued = false;
  const out = { x: 0, z: 0, ok: false };
  respawnPlacement(false, 5, 5, 0, () => { rescued = true; }, (x, z, o) => { o.x = 3; o.z = 4; }, out);
  assert.equal(rescued, false);
  assert.deepEqual([out.x, out.z, out.craftSide], [3, 4, false]);
});

test('save: settings.mortal is a boolean, absent by default, junk is dropped', () => {
  assert.equal('mortal' in defaultProgress().settings, false);
  assert.equal(sanitizeProgress({ version: 3, settings: { mortal: true } }).settings.mortal, true);
  assert.equal(sanitizeProgress({ version: 3, settings: { mortal: false } }).settings.mortal, false);
  assert.equal('mortal' in sanitizeProgress({ version: 3, settings: { mortal: 'yes' } }).settings, false);
  assert.equal('mortal' in sanitizeProgress({ version: 2, settings: { master: 0.5 } }).settings, false);
});
