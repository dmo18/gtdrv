import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tierText } from '../src/ui/menu.js';
import { maxRatioFor, floorFor } from '../src/render/adaptres.js';

test('the Settings graphics row names the tier drawn now', () => {
  assert.equal(tierText({ name: 'Normal', ratio: 2.25, max: 2.25, shed: 0 }), 'Now Normal at 2.25x');
  assert.equal(tierText({ name: 'Normal', ratio: 1.8, max: 2.25, shed: 0 }), 'Now Normal at 1.8x of 2.25x');
  assert.equal(tierText({ name: 'Low', ratio: 1.5, max: 2.25, shed: 1 }), 'Now Low at 1.5x of 2.25x, detail shed');
});

test('a 3.5 ratio phone (1440p, landscape 915x412 CSS px) draws sharp on Normal', () => {
  const max = maxRatioFor(3.5, 1), floor = floorFor(3.5);
  // Drawn pixels per screen pixel along an axis: 0.46 before 0.13.7 (1.6), now 0.64.
  assert.ok(max / 3.5 > 0.6, `${max}`);
  assert.ok(floor >= 1.5);
  // The drawing buffer at 915x412 CSS px.
  assert.deepEqual([Math.floor(915 * max), Math.floor(412 * max)], [2058, 927]);
});
