import test from 'node:test';
import assert from 'node:assert/strict';
import { CITY_U, patchCityMaterials } from '../src/render/citypatch.js';

test('patchCityMaterials keeps the shared uWet object and follows the weather value', () => {
  const shared = CITY_U.uWet;
  const wet = { value: 0.25 };
  patchCityMaterials({ wet });
  assert.equal(CITY_U.uWet, shared);
  assert.equal(shared.value, 0.25);
  wet.value = 0.8;
  assert.equal(shared.value, 0.8);
  shared.value = 0.1;
  assert.equal(wet.value, 0.1);
});
