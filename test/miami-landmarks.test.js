// Miami landmarks (src/world/miami-spots.js): real places drawn on the maps.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createMiamiCity } from '../src/world/miami.js';
import { MIAMI_LANDMARKS } from '../src/world/miami-spots.js';

const data = JSON.parse(fs.readFileSync(new URL('../src/world/data/miami.json', import.meta.url), 'utf8'));
const city = createMiamiCity(data);
const NAMES = new Set();
for (const k of ['labels', 'roads', 'buildings', 'parks', 'water']) for (const r of data[k]) if (r.name) NAMES.add(r.name);

test('Miami landmarks: the owner-requested places are listed, names are unique', () => {
  const have = new Set(MIAMI_LANDMARKS.map((l) => l.name));
  for (const n of ['Kaseya Center', 'Freedom Tower', 'Bayfront Park', 'Adrienne Arsht Center', 'Miami Central Station',
    'Government Center', 'Museum Park', 'Brickell City Centre', 'Miami Design District', 'Little Havana', 'Vizcaya',
    'Port of Miami', 'Watson Island', 'Fisher Island', 'Miami Beach', 'Overtown', 'Wynwood']) assert.ok(have.has(n), n);
  assert.equal(have.size, MIAMI_LANDMARKS.length);
});

test('Miami landmarks: inside the data box, on land, named in the data', () => {
  const b = data.bounds;
  for (const l of MIAMI_LANDMARKS) {
    assert.ok(l.x > b.minX && l.x < b.maxX && l.z > b.minZ && l.z < b.maxZ, `${l.name} inside the data box`);
    assert.ok(city.shoreDist(l.x, l.z) > 0, `${l.name} on land`);
    assert.ok(NAMES.has(l.src), `${l.name}: "${l.src}" is a name in the data`);
  }
});

test('Miami landmarks: the Miami city carries them for the maps', () => {
  assert.equal(city.mapLandmarks, MIAMI_LANDMARKS);
});
