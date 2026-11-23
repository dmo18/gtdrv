import test from 'node:test';
import assert from 'node:assert/strict';
import { speedMph, formatDistance, formatMiles, formatClock12 } from '../src/core/units.js';

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

test('distance traveled is always miles', () => {
  assert.equal(formatMiles(1609.344), '1.0 mi');
  assert.equal(formatMiles(0), '0.0 mi');
  assert.equal(formatMiles(NaN), '-');
});

test('the clock is 12-hour with AM and PM', () => {
  assert.equal(formatClock12(0), '12:00 AM');
  assert.equal(formatClock12(9 * 60 + 5), '9:05 AM');
  assert.equal(formatClock12(12 * 60), '12:00 PM');
  assert.equal(formatClock12(13 * 60 + 30), '1:30 PM');
  assert.equal(formatClock12(23 * 60 + 59), '11:59 PM');
  assert.equal(formatClock12(1440 + 60), '1:00 AM');
  assert.equal(formatClock12(NaN), '12:00 AM');
});
