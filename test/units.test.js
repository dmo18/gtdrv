import test from 'node:test';
import assert from 'node:assert/strict';
import { speedMph, formatDistance, formatMiles } from '../src/core/units.js';

test('speed converts from km/h to mph', () => {
  assert.equal(Math.round(speedMph(100)), 62);
  assert.equal(speedMph(0), 0);
  assert.equal(speedMph(NaN), 0);
});

test('short distances show feet, long ones show miles', () => {
  assert.equal(formatDistance(10), '33 ft');
  assert.equal(formatDistance(100), '328 ft');
  assert.equal(formatDistance(1000), '0.6 mi');
  assert.equal(formatDistance(-5), '-');
  assert.equal(formatDistance(Infinity), '-');
});

test('distance travelled is always miles', () => {
  assert.equal(formatMiles(1609.344), '1.0 mi');
  assert.equal(formatMiles(0), '0.0 mi');
  assert.equal(formatMiles(NaN), '-');
});
