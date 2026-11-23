import test from 'node:test';
import assert from 'node:assert/strict';
import { mapFromSearch, DEFAULT_MAP, MAP_IDS } from '../src/world/maps.js';
import { REGION_IDS } from '../src/world/regions.js';

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

test('every map id is reachable by the URL and by the stored choice; region ids are maps', () => {
  for (const id of MAP_IDS) {
    assert.equal(mapFromSearch('?map=' + id, null), id);
    assert.equal(mapFromSearch('?autostart&map=' + id, 'island'), id);
    assert.equal(mapFromSearch('', id), id);
  }
  for (const id of REGION_IDS) assert.ok(MAP_IDS.includes(id), id);
  assert.ok(MAP_IDS.includes('island') && MAP_IDS.includes('miami'));
  assert.equal(new Set(MAP_IDS).size, MAP_IDS.length);
  assert.equal(mapFromSearch('?map=miami-elsewhere', 'miami-nowhere'), DEFAULT_MAP);
});
