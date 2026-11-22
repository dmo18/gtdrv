import test from 'node:test';
import assert from 'node:assert/strict';
import { mapFromSearch, DEFAULT_MAP } from '../src/world/maps.js';

test('the URL parameter wins over the stored choice', () => {
  assert.equal(mapFromSearch('?map=island', 'miami'), 'island');
  assert.equal(mapFromSearch('?map=miami', 'island'), 'miami');
});

test('without a parameter the stored choice is used, then Miami', () => {
  assert.equal(mapFromSearch('', 'island'), 'island');
  assert.equal(mapFromSearch('', 'miami'), 'miami');
  assert.equal(mapFromSearch('', null), DEFAULT_MAP);
  assert.equal(DEFAULT_MAP, 'miami');
});

test('junk values are ignored (allow-list only)', () => {
  assert.equal(mapFromSearch('?map=__proto__', 'constructor'), DEFAULT_MAP);
  assert.equal(mapFromSearch('?map=<script>', '<b>'), DEFAULT_MAP);
  assert.equal(mapFromSearch('?map=', 'island'), 'island');
});
