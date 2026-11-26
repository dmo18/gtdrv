// 0.13.8 stutter and start (docs/PERF.md "Stutter and start (0.13.8)"):
// the street tiles of the first view are built in stages of one tile, the
// rest stream; the narrow-gap net is kept per box and asked for one kind a
// slice; props quarters and the near level go by distance and tier.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createMiamiCity } from '../src/world/miami.js';
import { createCollisionWorld } from '../src/world/collision.js';
import { ChunkedBuilder } from '../src/render/meshbuilder.js';
import { netRoads } from '../src/render/citymesh.js';
import { buildRealCity, NEAR_BY_TIER, PROPS_R, LOD } from '../src/render/realcity.js';

const region = 'miami-downtown';
const city = createMiamiCity(JSON.parse(fs.readFileSync(new URL(`../src/world/data/${region}.json`, import.meta.url), 'utf8')), { region });
const rect = { u0: 0, u1: 1, v0: 0, v1: 1, w: 64, h: 64 };
const rects = new Proxy({}, { get: (o, k) => (typeof k === 'string' ? rect : undefined) });
const tex = new Proxy({}, { get: (o, k) => (k === 'decals' || k === 'details' ? { rects } : {}) });
function build(opts) {
  const warn = console.warn;
  console.warn = () => {};
  try {
    return buildRealCity(city, createCollisionWorld(), { textures: tex, ...opts });
  } finally {
    console.warn = warn;
  }
}
const KEYS = ['asphalt', 'sidewalk', 'grass'];
const builders = () => {
  const B = {};
  for (const k of KEYS) B[k] = new ChunkedBuilder(1e7, 1, true, 4);
  return B;
};
// Every number the builders hold, in order.
function dump(B) {
  const out = [];
  for (const k of KEYS) for (const mb of B[k].map.values()) out.push(k, mb.count, ...mb.pos.subarray(0, mb.count * 3), ...mb.col.subarray(0, mb.count * 3), ...mb.idx);
  return out;
}

test('the narrow-gap net: one kind at a time and from the cache, the same quads as both at once', () => {
  const x = Math.floor(city.spawn.x / 60) * 60 - 120, z = Math.floor(city.spawn.z / 60) * 60 - 120;
  let quads = 0;
  for (let k = 0; k < 9; k++) {
    const x0 = x + (k % 3) * 60, z0 = z + Math.floor(k / 3) * 60;
    const A = builders(), B = builders(), C = builders(), cache = new Map();
    quads += netRoads(city, A, x0, z0, x0 + 60, z0 + 60);
    netRoads(city, B, x0, z0, x0 + 60, z0 + 60, 1, cache);
    netRoads(city, B, x0, z0, x0 + 60, z0 + 60, 2, cache);
    // Second time: every box from the cache.
    const size = cache.size;
    netRoads(city, C, x0, z0, x0 + 60, z0 + 60, 3, cache);
    assert.equal(cache.size, size);
    assert.deepEqual(dump(B), dump(A));
    assert.deepEqual(dump(C), dump(A));
  }
  assert.ok(quads > 0, 'some net drawn round the spawn');
});

test('start: no tiles at build with startNear -1, then one tile a stage near the start, the rest stream', () => {
  const group = build({ startNear: -1 });
  const st = group.userData.stream;
  assert.equal(st.tiles.filter((t) => t.group).length, 0);
  const at = { position: { x: city.spawn.x, y: 2, z: city.spawn.z } };
  let n = 0;
  while (st.flush(at, 60, true)) {
    n++;
    assert.equal(st.tiles.filter((t) => t.group).length, n, 'one tile a call');
  }
  assert.ok(n >= 1 && n <= 4, `tiles within 60 m of the start: ${n}`);
  for (const t of st.tiles) if (t.group) assert.equal(t.shown, true);
  // The rest of the near tiles come in a slice at a time.
  for (let i = 0; i < 4000 && st.tiles.some((t) => !t.group && Math.hypot(Math.max(t.x0 - at.position.x, 0, at.position.x - t.x1), Math.max(t.z0 - at.position.z, 0, at.position.z - t.z1)) < NEAR_BY_TIER[1] - 1); i++) st.update(at, 3);
  const shown = st.tiles.filter((t) => t.shown).length;
  assert.ok(shown > n, 'streamed near tiles shown');
  // Normal draws tiles out to NEAR_BY_TIER[1], High to LOD.near.
  assert.ok(NEAR_BY_TIER[1] < LOD.near && NEAR_BY_TIER[2] === LOD.near && NEAR_BY_TIER[0] <= NEAR_BY_TIER[1]);
  for (const t of st.tiles) {
    if (!t.shown) continue;
    const d = Math.hypot(Math.max(t.x0 - at.position.x, 0, at.position.x - t.x1), Math.max(t.z0 - at.position.z, 0, at.position.z - t.z1), 1.2);
    assert.ok(d < NEAR_BY_TIER[1] + LOD.hyst, `tile ${t.k} shown at ${d.toFixed(0)} m`);
  }
  // Street props by quarter: on near the camera, off past PROPS_R (and
  // all off at the middle level); every quarter of a near tile is a mesh.
  let on = 0, off = 0;
  for (const t of st.tiles) {
    if (!t.shown || !t.props) continue;
    for (const m of t.props) {
      const bb = m.geometry.boundingBox;
      const dx = Math.max(bb.min.x - at.position.x, 0, at.position.x - bb.max.x), dz = Math.max(bb.min.z - at.position.z, 0, at.position.z - bb.max.z);
      const d = Math.hypot(dx, dz);
      if (t.mid || d > PROPS_R[1] + 15) assert.equal(m.visible, false, `props at ${d.toFixed(0)} m, mid ${t.mid}`);
      else if (d < PROPS_R[1]) assert.equal(m.visible, true, `props at ${d.toFixed(0)} m`);
      if (m.visible) on++;
      else off++;
    }
  }
  assert.ok(on > 0 && off > 0, `props quarters on ${on}, off ${off}`);
  // Signal lamps: only the tiles short of the middle level.
  const bulbs = group.userData.signals.bulbs;
  for (const b of bulbs) assert.equal(st.tiles[st.tileOf(b.x, b.z)].mid, false);
});
