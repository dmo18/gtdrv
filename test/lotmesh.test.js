// Lot ground and dressing for the real-map renderer (src/render/lotmesh.js,
// docs/REVAMP.md 6.2), on the 12-lot fixture (test/fixtures/lots-fixture.js)
// and on the real map's lots round the spawn street.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { ChunkedBuilder, MeshBuilder } from '../src/render/meshbuilder.js';
import { lotGround, lotEdges, drawLotFeatures, lotsByTile, lotJob, DRAWN_T, LOT_GROUND, LOT_TYPES as LT } from '../src/render/lotmesh.js';
import { realLand } from '../src/render/citymesh.js';
import { compactFar, farBuilding } from '../src/render/realcity.js';
import { createCollisionWorld, addLotSolids, fillLotCollision } from '../src/world/collision.js';
import { makeLotsFixture, fixtureDressLot, LOT_TYPES } from './fixtures/lots-fixture.js';
import { createMiamiCity } from '../src/world/miami.js';
import { dressLot } from '../src/world/lots.js';

const KEYS = ['grass', 'asphalt', 'sidewalk', 'land', 'ground', 'sand', 'paint', 'ao', 'props', 'solid', 'detail', 'glow', 'trees', 'treesDetail', 'plain'];
const builders = () => {
  const B = {};
  for (const k of KEYS) B[k] = new ChunkedBuilder(1e7, 1, true, 4);
  return B;
};
// Every quad (4 vertices) of a builder set, as [cx, cz, key].
const quads = (B, keys) => {
  const out = [];
  for (const k of keys) {
    for (const mb of B[k].map.values()) {
      for (let v = 0; v + 3 < mb.count; v += 4) {
        let x = 0, z = 0;
        for (let q = 0; q < 4; q++) { x += mb.pos[(v + q) * 3]; z += mb.pos[(v + q) * 3 + 2]; }
        out.push([x / 4, z / 4, k]);
      }
    }
  }
  return out;
};
const tris = (B) => { let n = 0; for (const k of KEYS) for (const mb of B[k].map.values()) n += mb.idx.length / 3; return n; };

test('the renderer and the fixture use the contract\'s lot types', () => {
  assert.deepEqual(LT, LOT_TYPES);
  for (const t of LOT_TYPES) assert.equal(!!LOT_GROUND[t], t !== 'verge' && t !== 'airfield', t);
  for (let k = 0; k < LOT_TYPES.length; k++) assert.equal(DRAWN_T[k + 1], LOT_GROUND[LOT_TYPES[k]] ? 1 : 0);
  assert.equal(DRAWN_T[0], 0, 'no lot: no lot ground');
});

test('lot ground covers exactly the lot cells, in the material of each type', () => {
  const city = makeLotsFixture();
  const G = city.lotGrid;
  const B = builders();
  lotGround(city, B, 0, G.w, 0, G.h);
  const ground = quads(B, ['grass', 'asphalt', 'sidewalk', 'land', 'ground', 'sand']);
  let area = 0;
  for (const mb of ['grass', 'asphalt', 'sidewalk', 'land', 'ground', 'sand'].flatMap((k) => [...B[k].map.values()])) {
    for (let v = 0; v + 3 < mb.count; v += 4) area += Math.abs(mb.pos[(v + 1) * 3] - mb.pos[v * 3]) * Math.abs(mb.pos[(v + 2) * 3 + 2] - mb.pos[(v + 1) * 3 + 2]);
  }
  let cells = 0;
  for (let k = 0; k < G.w * G.h; k++) if (DRAWN_T[G.type[k]]) cells++;
  assert.equal(Math.round(area), cells * 25, 'drawn area = drawn lot cells');
  for (const [x, z, key] of ground) {
    const lot = city.lotAt(x, z);
    assert.ok(lot, `ground at ${x}, ${z} is in a lot`);
    assert.equal(LOT_GROUND[lot.type].key, key, `${lot.type} in ${key}`);
  }
  // The road band (z 70..80) and the building cells get nothing.
  assert.ok(ground.every(([, z]) => z < 70 || z > 80));
  assert.ok(!ground.some(([x, z]) => x > 10 && x < 20 && z > 10 && z < 20));
  // Lots of one type differ a little in tone (lot seed); types differ.
  const kinds = new Set(ground.map((q) => q[2]));
  assert.ok(kinds.size >= 5, [...kinds].join(' '));
});

test('lot edges: curbed lawns and bordered plazas, inside their own lots only', () => {
  const city = makeLotsFixture();
  const G = city.lotGrid;
  const B = builders();
  const strips = lotEdges(city, B, 0, G.w, 0, G.h);
  const all = quads(B, ['grass', 'asphalt', 'sidewalk', 'land', 'ground', 'sand']);
  assert.ok(strips > 0, 'some edges');
  assert.equal(all.length, strips, 'one quad a strip');
  const kinds = new Set();
  for (const [x, z, key] of all) {
    const lot = city.lotAt(x, z);
    assert.ok(lot, `edge at ${x.toFixed(1)}, ${z.toFixed(1)} is in a lot`);
    assert.ok(['yard', 'park', 'plaza'].includes(lot.type), `${lot.type} gets no edge`);
    kinds.add(`${lot.type === 'plaza' ? 'plaza' : 'lawn'} ${key}`);
  }
  // Lawns: a concrete edging (sidewalk) and a rough grass band (grass).
  for (const k of ['lawn sidewalk', 'lawn grass', 'plaza sidewalk']) assert.ok(kinds.has(k), `${k} (${[...kinds].join(', ')})`);
  // Same answer cut into row bands, as a streamed tile builds it.
  const B2 = builders();
  let n = 0;
  for (let j = 0; j < G.h; j += 7) n += lotEdges(city, B2, 0, G.w, j, Math.min(G.h, j + 7));
  assert.ok(n >= strips && n <= strips + G.w * 4, `${n} strips in bands, ${strips} whole`);
});

test('land under full lot cells is left out; the rest of the land stays', () => {
  const city = makeLotsFixture();
  city.districtOf = () => 'residential';
  const L = city.landGrid;
  const B = builders();
  realLand(city, B, 0, L.w - 1, 0, L.h - 1, 1, -0.06, false);
  const land = quads(B, ['land', 'ground']).concat();
  // Land quads are merged runs; count the drawn length instead.
  let drawn = 0;
  for (const k of ['land', 'ground']) for (const mb of B[k].map.values()) for (let v = 0; v + 3 < mb.count; v += 4) drawn += Math.abs(mb.pos[(v + 1) * 3] - mb.pos[v * 3]) * 5;
  const full = (L.w - 1) * (L.h - 1) * 25;
  assert.ok(land.length > 0, 'the road band and verges keep land');
  assert.ok(drawn < full * 0.5, `most land is under lots now (${drawn} of ${full} m2 drawn)`);
});

test('every lot type is dressed and drawn; solids collide from the city build, drawn or not', () => {
  const city = makeLotsFixture();
  const col = createCollisionWorld();
  const B = builders();
  const C = { city, R: null, ...B, lotStats: { lots: 0, features: 0 } };
  const feats = [];
  const drawnBy = {};
  // The whole job in one go (over() never says stop): no slices.
  for (const step of lotJob(C, city.lots.filter((l) => l.type !== 'verge' && l.type !== 'airfield'), fixtureDressLot, () => false)) assert.fail(step);
  for (const lot of city.lots) {
    feats.length = 0;
    fixtureDressLot(city, lot, feats);
    const B2 = builders();
    drawnBy[lot.type] = (drawnBy[lot.type] || 0) + drawLotFeatures({ ...C, ...B2, collision: null }, lot, feats, feats.length, { tree() {}, palm() {}, lamp() {}, bench() {}, bin() {}, bollard() {}, planter() {}, umbrella() {} });
    assert.ok(feats.length <= 24, `${lot.type}: at most 24 features`);
    assert.ok(feats.filter((f) => f.solid).length <= 12, `${lot.type}: at most 12 solid`);
    for (const f of feats) assert.equal(city.lotAt(f.x, f.z), lot, `${f.kind} of ${lot.type} lies in its lot`);
  }
  for (const t of ['yard', 'carpark', 'plaza', 'grass', 'works', 'beach', 'park', 'wateredge', 'site']) assert.ok(drawnBy[t] > 0, `${t} drew features`);
  assert.equal(drawnBy.verge, 0, 'verge stays bare');
  assert.ok(C.lotStats.lots >= 10 && C.lotStats.features > 40, JSON.stringify(C.lotStats));
  assert.ok(tris(B) > 500, 'geometry made');
  // Bays drew paint lines and parked cars in some of them.
  const cp = city.lots.find((l) => l.type === 'carpark');
  feats.length = 0;
  fixtureDressLot(city, cp, feats);
  assert.ok(feats.some((f) => f.kind === 'bay'));
  const B3 = builders();
  drawLotFeatures({ ...C, ...B3, collision: null }, cp, feats, feats.length, { tree() {}, palm() {}, lamp() {}, bench() {}, bin() {}, bollard() {}, planter() {}, umbrella() {} });
  assert.ok(B3.paint.map.size > 0 && B3.solid.map.size > 0, 'bay lines and parked cars');
  // Drawing adds no collision: the shapes come from fillLotCollision.
  assert.equal(col.boxes.length + col.circles.length, 0, 'lotJob makes no shapes');
  const solid = fillLotCollision(city, col, fixtureDressLot);
  assert.equal(solid.length, col.boxes.length + col.circles.length);
  assert.ok(solid.length > 5, `shapes ${solid.length}`);
  let nSolid = 0;
  for (const lot of city.lots) { if (lot.type === 'verge' || lot.type === 'airfield') continue; feats.length = 0; fixtureDressLot(city, lot, feats); nSolid += feats.filter((f) => f.solid).length; }
  assert.ok(solid.filter((s) => s.tag === 'lot').length >= nSolid, 'a shape for every solid feature');
  const it = solid.find((s) => s.kind === 1) || solid[0];
  const px = it.kind === 1 ? it.x : (it.x0 + it.x1) / 2, pz = it.kind === 1 ? it.z : (it.z0 + it.z1) / 2;
  assert.ok(col.resolveCircle(px + 0.05, pz, 0.5).hit);
  // Same lots, same shapes in the same order (a second world).
  const col2 = createCollisionWorld();
  const again = fillLotCollision(city, col2, fixtureDressLot);
  assert.deepEqual(again.map((s) => [s.kind, s.x, s.z, s.x0, s.z0, s.x1, s.z1, s.r, s.h, s.tag]), solid.map((s) => [s.kind, s.x, s.z, s.x0, s.z0, s.x1, s.z1, s.r, s.h, s.tag]));
});

test('solid shapes: circles, axis boxes and rows of circles for turned walls', () => {
  const col = createCollisionWorld();
  const list = [];
  addLotSolids(col, [
    { kind: 'tree', x: 0, z: 0, r: 0.4, h: 6, solid: true },
    { kind: 'wall', x: 10, z: 0, heading: 0, l: 8, w: 0.3, h: 1.6, solid: true },
    { kind: 'wall', x: 20, z: 0, heading: 0.6, l: 8, w: 0.3, h: 1.6, solid: true },
    { kind: 'towel', x: 30, z: 0, heading: 0, l: 2, w: 1, h: 0, solid: false },
  ], 4, list);
  assert.equal(list[0].kind, 1);
  assert.equal(list[1].kind, 0);
  assert.ok(Math.abs(list[1].x1 - list[1].x0 - 8) < 1e-9);
  assert.ok(list.length > 3 && list.slice(2).every((s) => s.kind === 1), 'turned wall: circles');
  assert.ok(col.resolveCircle(20 + Math.cos(0.6) * 3, Math.sin(0.6) * 3, 0.3).hit);
  assert.ok(!col.resolveCircle(30, 0, 0.3).hit, 'not solid: no shape');
});

test('lots go to the tile of their center; verge and airfield are skipped', () => {
  const city = makeLotsFixture();
  const tileOf = (x, z) => (x < 100 ? 0 : 1) + (z < 75 ? 0 : 2);
  const by = lotsByTile(city, tileOf, 4);
  const all = by.flat();
  assert.equal(all.length, city.lots.filter((l) => l.type !== 'verge' && l.type !== 'airfield').length);
  for (let k = 0; k < 4; k++) for (const l of by[k]) assert.equal(tileOf((l.x0 + l.x1) / 2, (l.z0 + l.z1) / 2), k);
  assert.deepEqual(lotsByTile({}, tileOf, 4), [[], [], [], []], 'no lots (the island)');
});

test('far buildings: hipped house roofs, parapets on the detail level', () => {
  const walls = new MeshBuilder(), plain = new MeshBuilder(), detail = new MeshBuilder();
  farBuilding(walls, plain, { x0: 0, z0: 0, x1: 12, z1: 8, h: 6 }, 0xf0e0c0, 0xb4583c, -0.3, true, detail);
  assert.equal(walls.idx.length / 3, 8, 'four walls');
  assert.equal(plain.idx.length / 3, 6, 'hipped roof: two slopes and two hips');
  let top = 0;
  for (let i = 1; i < plain.pos.length; i += 3) top = Math.max(top, plain.pos[i]);
  assert.ok(top > 7.5 && top < 9.5, `ridge at ${top}`);
  for (let i = 1; i < plain.nor.length; i += 3) assert.ok(plain.nor[i] > 0.5, 'roof faces up');
  const w2 = new MeshBuilder(), p2 = new MeshBuilder(), d2 = new MeshBuilder();
  farBuilding(w2, p2, { x0: 0, z0: 0, x1: 30, z1: 30, h: 40, vseed: 9 }, 0xd0d0d0, 0xb0b0b0, -0.3, false, d2);
  assert.equal(p2.idx.length / 3, 2, 'flat roof on the base level');
  assert.ok(d2.idx.length / 3 >= 24, 'parapet and roof plant on the detail level');
});

test('compactFar leaves out near tiles and far detail', () => {
  const full = Uint16Array.from({ length: 30 }, (_, i) => i);
  const ranges = [{ tile: 0, lvl: 0, start: 0, count: 12 }, { tile: 0, lvl: 1, start: 12, count: 6 }, { tile: 1, lvl: 0, start: 18, count: 12 }];
  let drawn = -1;
  const mesh = {
    visible: true,
    userData: { far: { full, ranges, state: new Uint8Array(3).fill(2) } },
    geometry: { index: { array: new Uint16Array(30), needsUpdate: false }, setDrawRange: (a, n) => { drawn = n; } },
  };
  assert.ok(compactFar(mesh, Uint8Array.of(0, 0), Uint8Array.of(1, 1)));
  assert.equal(drawn, 30);
  assert.ok(!compactFar(mesh, Uint8Array.of(0, 0), Uint8Array.of(1, 1)), 'nothing changed');
  compactFar(mesh, Uint8Array.of(0, 0), Uint8Array.of(0, 0));
  assert.equal(drawn, 24, 'detail off');
  compactFar(mesh, Uint8Array.of(1, 0), Uint8Array.of(0, 0));
  assert.equal(drawn, 12, 'tile 0 near');
  assert.deepEqual([...mesh.geometry.index.array.slice(0, 12)], [...full.slice(18, 30)]);
  compactFar(mesh, Uint8Array.of(1, 1), Uint8Array.of(0, 0));
  assert.equal(drawn, 0);
  assert.equal(mesh.visible, false);
});

test('the real map: the spawn street lots are dressed, fast enough to stream', () => {
  const data = JSON.parse(fs.readFileSync(new URL('../src/world/data/miami.json', import.meta.url), 'utf8'));
  const city = createMiamiCity(data);
  assert.ok(city.lots.length > 1000 && city.lotGrid);
  const s = city.spawn, G = city.lotGrid;
  // The 300 m square round the spawn: lot ground on every typed cell.
  const i0 = Math.floor((s.x - 150 - G.x0) / G.cell), j0 = Math.floor((s.z - 150 - G.z0) / G.cell);
  const B = builders();
  lotGround(city, B, i0, i0 + 60, j0, j0 + 60);
  const ground = quads(B, ['grass', 'asphalt', 'sidewalk', 'land', 'ground', 'sand']);
  assert.ok(ground.length > 20);
  for (const [x, z] of ground) assert.ok(city.lotAt(x, z) && !city.onRoad(x, z), 'lot ground is never on a road');
  // Dressing the lots of that square, slice by slice.
  const lots = city.lots.filter((l) => Math.abs((l.x0 + l.x1) / 2 - s.x) < 150 && Math.abs((l.z0 + l.z1) / 2 - s.z) < 150 && l.type !== 'verge');
  const C = { city, R: null, ...builders(), lotStats: { lots: 0, features: 0 } };
  const t0 = performance.now();
  let slices = 0;
  for (const step of lotJob(C, lots, dressLot, () => true)) { slices++; void step; }
  const ms = performance.now() - t0;
  assert.equal(C.lotStats.lots, lots.length);
  assert.ok(C.lotStats.features > lots.length, `features ${C.lotStats.features} for ${lots.length} lots`);
  assert.ok(slices >= lots.length, 'a slice per lot at least');
  assert.ok(ms / slices < 2, `average slice ${(ms / slices).toFixed(2)} ms`);
});

test('streaming: static matrices, packed far level, no tiles in fast or high flight, trees by distance', async () => {
  const { buildRealCity, FLY_HOLD, TREE_NEAR_R, TREE_FAR_R, TILE } = await import('../src/render/realcity.js');
  const data = JSON.parse(fs.readFileSync(new URL('../src/world/data/miami.json', import.meta.url), 'utf8'));
  const city = createMiamiCity(data);
  const rect = { u0: 0, u1: 1, v0: 0, v1: 1, w: 64, h: 64 };
  const rects = new Proxy({}, { get: (o, k) => (typeof k === 'string' ? rect : undefined) });
  const tex = new Proxy({}, { get: (o, k) => (k === 'decals' || k === 'details' ? { rects } : {}) });
  const warn = console.warn;
  console.warn = () => {};
  let group;
  try {
    group = buildRealCity(city, createCollisionWorld(), { textures: tex });
  } finally {
    console.warn = warn;
  }
  const st = group.userData.stream;
  // The city is left out of the per-frame matrix walk; its parts never
  // recompute their matrices.
  assert.equal(group.matrixWorldAutoUpdate, false);
  let auto = 0;
  group.traverse((o) => { if (o.matrixAutoUpdate && o.name !== 'windsock') auto++; });
  assert.equal(auto, 0, 'static parts');
  // Far level: packed vertex data.
  const far = [];
  group.traverse((o) => { if (o.isMesh && o.name === 'far') far.push(o); });
  assert.ok(far.length > 0);
  for (const m of far) {
    assert.ok(m.geometry.attributes.normal.array instanceof Int8Array && m.geometry.attributes.normal.normalized);
    assert.ok(m.geometry.attributes.color.array instanceof Uint8Array && m.geometry.attributes.color.normalized);
  }
  // Flying high or fast over unbuilt streets: nothing new is started.
  const s = city.spawn;
  const cam = { position: { x: s.x + 3 * TILE, y: FLY_HOLD.height + 20, z: s.z } };
  const built0 = st.stats.built;
  for (let i = 0; i < 40; i++) st.update(cam, 3);
  assert.equal(st.stats.built, built0, 'high: no tiles');
  cam.position.y = 2;
  st.stats.speed = FLY_HOLD.speed + 10;
  for (let i = 0; i < 40; i++) st.update(cam, 3);
  assert.equal(st.stats.built, built0, 'fast: no tiles');
  st.stats.speed = 10;
  for (let i = 0; i < 400 && st.stats.built === built0; i++) st.update(cam, 3);
  assert.ok(st.stats.built > built0, 'slow and low: tiles build again');
  // Tile groups added later are static too.
  for (const t of st.tiles) if (t.group) assert.equal(t.group.matrixAutoUpdate, false);
  // Trees by distance (Normal tier), at the spawn street: every tree of
  // a shown tile is an instance of the tree batch, in its near shape
  // within TREE_NEAR_R, its far shape within TREE_FAR_R, else the
  // distant one (a few meters of hysteresis at each edge).
  cam.position.x = s.x;
  cam.position.z = s.z;
  st.flush(cam);
  st.update(cam, 3);
  const trees = st.trees();
  assert.ok(trees && trees.mesh.isBatchedMesh, 'the tree batch');
  assert.ok(!group.children.some((o) => o.name === 'tile' && o.children.some((m) => m.name === 'trees-detail')), 'no tree meshes in the tiles');
  let near = 0, far2 = 0, distant = 0;
  for (const t of st.tiles) {
    if (!t.group) continue;
    const e = trees.tiles.get(t.k);
    if (!e) continue;
    assert.equal(e.shown, t.shown);
    for (let i = 0; i < e.n; i++) {
      const d = Math.hypot(e.px[i] - cam.position.x, e.pz[i] - cam.position.z);
      const vis = trees.mesh.getVisibleAt(e.ids[i]);
      assert.equal(vis, t.shown, 'drawn while its tile is shown');
      if (!t.shown) continue;
      const lod = e.lod[i];
      if (d < TREE_NEAR_R[1]) { near++; assert.equal(lod, 2, `tree ${d.toFixed(0)} m near`); }
      else if (d > TREE_NEAR_R[1] + 5 && d < TREE_FAR_R[1]) { far2++; assert.equal(lod, 1, `tree ${d.toFixed(0)} m far`); }
      else if (d > TREE_FAR_R[1] + 9) { distant++; assert.equal(lod, 0, `tree ${d.toFixed(0)} m distant`); }
      // The batch draws the shape the tree asks for.
      const geo = trees.mesh.getGeometryIdAt(e.ids[i]);
      assert.equal(geo, e.sp[i] * 3 + lod);
    }
  }
  assert.ok(near > 0 && far2 > 0 && distant > 0, `near ${near}, far ${far2}, distant ${distant}`);
  // Moving off: the trees left behind fall back to their far shapes.
  cam.position.x = s.x + 200;
  st.update(cam, 3);
  for (const e of trees.tiles.values()) {
    if (!e.shown) continue;
    for (let i = 0; i < e.n; i++) if (Math.hypot(e.px[i] - cam.position.x, e.pz[i] - cam.position.z) > TREE_NEAR_R[1] + 5) assert.notEqual(e.lod[i], 2);
  }
});
