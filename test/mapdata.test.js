import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const data = JSON.parse(fs.readFileSync(new URL('../src/world/data/miami.json', import.meta.url), 'utf8'));

function decode(p) {
  const out = [];
  let x = 0, z = 0;
  for (let i = 0; i < p.length; i += 2) { x += p[i]; z += p[i + 1]; out.push([x / 10, z / 10]); }
  return out;
}

test('map data has attribution and sane origin and bounds', () => {
  assert.match(data.attribution, /OpenStreetMap contributors, ODbL/);
  assert.ok(Math.abs(data.origin.lat - 25.78) < 0.1);
  assert.ok(Math.abs(data.origin.lon + 80.18) < 0.1);
  const b = data.bounds;
  const w = b.maxX - b.minX, h = b.maxZ - b.minZ;
  assert.ok(w > 6000 && w < 12000, `width ${w}`);
  assert.ok(h > 6000 && h < 12000, `height ${h}`);
});

test('map data has enough roads and buildings', () => {
  assert.ok(data.roads.length >= 2000);
  assert.ok(data.buildings.length >= 5000);
  assert.ok(data.labels.length > 0);
  assert.ok(data.coastline.length + data.water.length > 0);
});

test('every coordinate is finite and inside the bounds', () => {
  const b = data.bounds, pad = 200000; // long coast and highway ways may run well past the box
  const check = (p) => {
    assert.equal(p.length % 2, 0);
    for (const [x, z] of decode(p)) {
      assert.ok(Number.isFinite(x) && Number.isFinite(z));
      assert.ok(x > b.minX - pad && x < b.maxX + pad && z > b.minZ - pad && z < b.maxZ + pad);
    }
  };
  for (const r of data.roads) { assert.ok(r.class); assert.ok(r.p.length >= 4); check(r.p); }
  for (const f of data.buildings) { assert.ok(Number.isFinite(f.h) && f.h > 0); assert.ok(f.p.length >= 6); check(f.p); }
  for (const k of ['water', 'coastline', 'parks']) for (const f of data[k]) check(f.p);
  for (const l of data.labels) assert.ok(Number.isFinite(l.x) && Number.isFinite(l.z) && l.name);
});
