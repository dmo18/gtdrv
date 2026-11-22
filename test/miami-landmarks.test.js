// Miami landmarks (src/world/miami-spots.js): real places drawn on the maps,
// and the invented landmarks with their own shapes (docs/REVAMP.md D1).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createMiamiCity } from '../src/world/miami.js';
import { MIAMI_LANDMARKS, MIAMI_SPOTS } from '../src/world/miami-spots.js';

const data = JSON.parse(fs.readFileSync(new URL('../src/world/data/miami.json', import.meta.url), 'utf8'));
const city = createMiamiCity(data);
const NAMES = new Set();
for (const k of ['labels', 'roads', 'buildings', 'parks', 'water']) for (const r of data[k]) if (r.name) NAMES.add(r.name);

test('Miami landmarks: the owner-requested places are listed (brand venues under invented names), names are unique', () => {
  const have = new Set(MIAMI_LANDMARKS.map((l) => l.name));
  // The real names the owner asked for that are not venue brands.
  for (const n of ['Freedom Tower', 'Bayfront Park', 'Government Center', 'Museum Park', 'Little Havana', 'Vizcaya',
    'Port of Miami', 'Watson Island', 'Fisher Island', 'Miami Beach', 'Overtown', 'Wynwood']) assert.ok(have.has(n), n);
  // Decision D1 (2026-11-22): a venue brand is printed under the invented
  // name of the landmark that stands there, or a plain description; the
  // data name it was found by stays in `src`.
  const renamed = {
    'Kaseya Center': 'Tidewater Arena', 'Adrienne Arsht Center': 'Opal Opera House', 'Miami Central': 'Downtown Rail Hub',
    'Brickell City Centre': 'Brickell Twin Spires', 'Miami Design District': 'Design District',
    'Olympia Theater at Gusman Center': 'Flagler Street Theatre', 'James L. Knight Center Theater': 'Riverfront Hall',
  };
  for (const [src, name] of Object.entries(renamed)) {
    const l = MIAMI_LANDMARKS.find((m) => m.src === src);
    assert.ok(l && l.name === name, `${src} is shown as ${name}`);
  }
  for (const bad of ['Kaseya', 'Arsht', 'Gusman', 'Knight Center', 'City Centre', 'Miami Central']) {
    assert.ok(!MIAMI_LANDMARKS.some((l) => l.name.includes(bad)), `no "${bad}" on the map`);
  }
  assert.equal(have.size, MIAMI_LANDMARKS.length);
});

test('Miami landmarks: inside the data box, on land, named in the data', () => {
  const b = data.bounds;
  for (const l of MIAMI_LANDMARKS) {
    assert.ok(l.x > b.minX && l.x < b.maxX && l.z > b.minZ && l.z < b.maxZ, `${l.name} inside the data box`);
    assert.ok(city.shoreDist(l.x, l.z) > 0, `${l.name} on land`);
    assert.ok(NAMES.has(l.src), `${l.name}: "${l.src}" is a name in the data`);
    if (l.landmark) assert.ok(MIAMI_SPOTS.landmarks.some((t) => t.id === l.landmark), `${l.name}: landmark ${l.landmark}`);
  }
});

test('Miami landmarks: the city carries the real places, then the invented landmarks, for the maps', () => {
  assert.deepEqual(city.mapLandmarks.slice(0, MIAMI_LANDMARKS.length), MIAMI_LANDMARKS);
  for (const s of city.landmarkSites) assert.ok(city.mapLandmarks.some((m) => m.landmark === s.id), s.name);
  const names = city.mapLandmarks.map((m) => m.name);
  assert.equal(new Set(names).size, names.length, 'no name twice');
});
