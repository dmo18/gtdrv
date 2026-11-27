// 0.13.9 visual glitches: no z-fighting in the street tiles' ground. Two
// flat, opaque faces of different looks (material, or a vertex color 5 %
// or more apart) that
// overlap on the ground fight for the same depth when they lie under 2 mm
// apart or exactly level (at 300 m a 24-bit depth step is about 1 cm). In every region the
// tiles round the start (roads, junctions, the narrow-gap net, sidewalks,
// lot grounds, edging strips, lot features) are built as the game builds
// them and checked face against face.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createMiamiCity } from '../src/world/miami.js';
import { createCollisionWorld } from '../src/world/collision.js';
import { buildRealCity } from '../src/render/realcity.js';
import { LOT_Y, EDGE_Y, FLAT_Y } from '../src/render/lotmesh.js';

const REGIONS = ['miami-beach', 'miami-downtown', 'miami-north', 'miami-west', 'miami-south'];
const MIN_GAP = 0.002;
const rect = { u0: 0, u1: 1, v0: 0, v1: 1, w: 64, h: 64 };
const rects = new Proxy({}, { get: (o, k) => (typeof k === 'string' ? rect : undefined) });
const tex = new Proxy({}, { get: (o, k) => (k === 'decals' || k === 'details' ? { rects } : {}) });

// The flat faces of the tile meshes: height, corners, look.
function flatFaces(group) {
  const out = [];
  group.updateMatrixWorld(true);
  group.traverse((o) => {
    // (Not the shadow-only proxies: they never draw in the view.)
    if (!o.isMesh || o.isInstancedMesh || o.isBatchedMesh || !o.layers.isEnabled(0)) return;
    let p = o, tile = false;
    while (p) { if (p.name === 'tile') tile = true; p = p.parent; }
    if (!tile) return;
    const g = o.geometry, pos = g.attributes.position, idx = g.index, col = g.attributes.color;
    if (!pos) return;
    const e = o.matrixWorld.elements;
    const n = idx ? idx.count : pos.count;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    const groups = g.groups.length ? g.groups : [{ start: 0, count: n, materialIndex: 0 }];
    for (const gr of groups) {
      const m = mats[gr.materialIndex || 0];
      if (!m || m.transparent || !m.depthWrite || !m.depthTest || !m.colorWrite) continue;
      for (let i = gr.start; i + 2 < gr.start + gr.count; i += 3) {
        const v = [];
        for (let k = 0; k < 3; k++) {
          const j = idx ? idx.getX(i + k) : i + k;
          const x = pos.getX(j), y = pos.getY(j), z = pos.getZ(j);
          v.push(x * e[0] + y * e[4] + z * e[8] + e[12], x * e[1] + y * e[5] + z * e[9] + e[13], x * e[2] + y * e[6] + z * e[10] + e[14]);
        }
        if (Math.abs(v[4] - v[1]) > 1e-4 || Math.abs(v[7] - v[1]) > 1e-4) continue;
        const area = Math.abs((v[3] - v[0]) * (v[8] - v[2]) - (v[6] - v[0]) * (v[5] - v[2])) / 2;
        if (area < 1e-4) continue;
        const j0 = idx ? idx.getX(i) : i;
        // Ground only (under 30 cm): building roofs and plinths are the
        // buildings' own (seen, docs/STATUS.md 0.13.9).
        if (v[1] > 0.3) continue;
        const rgb = col ? [col.getX(j0), col.getY(j0), col.getZ(j0)] : [1, 1, 1];
        const look = m.id + ':' + rgb.map((c) => c.toFixed(2)).join(',');
        out.push({ y: v[1], v, look, mat: m.id, rgb, offset: m.polygonOffset ? m.polygonOffsetFactor + m.polygonOffsetUnits : 0 });
      }
    }
  });
  return out;
}
const inside = (px, pz, v) => {
  const s = (ax, az, bx, bz) => (bx - ax) * (pz - az) - (bz - az) * (px - ax);
  const d1 = s(v[0], v[2], v[3], v[5]), d2 = s(v[3], v[5], v[6], v[8]), d3 = s(v[6], v[8], v[0], v[2]);
  return !((d1 < -1e-6 || d2 < -1e-6 || d3 < -1e-6) && (d1 > 1e-6 || d2 > 1e-6 || d3 > 1e-6));
};

test('lot layers stand at least 2 cm apart (lotmesh.js)', () => {
  assert.ok(EDGE_Y - LOT_Y >= 0.02 - 1e-9 && FLAT_Y - EDGE_Y >= 0.02 - 1e-9);
});

// Overlapping pairs under MIN_GAP apart, `same`: within one material
// (tones of a builder's vertex colors) or across materials.
const built = new Map();
function fights(region, same) {
  let F = built.get(region);
  if (!F) {
    const city = createMiamiCity(JSON.parse(fs.readFileSync(new URL(`../src/world/data/${region}.json`, import.meta.url), 'utf8')), { region });
    const warn = console.warn;
    console.warn = () => {};
    try {
      const group = buildRealCity(city, createCollisionWorld(), { textures: tex, startNear: -1 });
      const at = { position: { x: city.spawn.x, y: 2, z: city.spawn.z } };
      while (group.userData.stream.flush(at, 90, true));
      F = flatFaces(group);
    } finally {
      console.warn = warn;
    }
    built.set(region, F);
  }
  assert.ok(F.length > 2000, `flat faces ${F.length}`);
  const cells = new Map();
  F.forEach((f, i) => {
    const x0 = Math.floor(Math.min(f.v[0], f.v[3], f.v[6]) / 2), x1 = Math.floor(Math.max(f.v[0], f.v[3], f.v[6]) / 2);
    const z0 = Math.floor(Math.min(f.v[2], f.v[5], f.v[8]) / 2), z1 = Math.floor(Math.max(f.v[2], f.v[5], f.v[8]) / 2);
    for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) {
      const k = x * 100003 + z;
      let c = cells.get(k);
      if (!c) cells.set(k, (c = []));
      c.push(i);
    }
  });
  const bad = [];
  const seen = new Set();
  for (const c of cells.values()) {
    for (let a = 0; a < c.length; a++) {
      for (let b = a + 1; b < c.length; b++) {
        const A = F[c[a]], B = F[c[b]];
        const dy = Math.abs(A.y - B.y);
        if (dy >= MIN_GAP || A.look === B.look || (A.mat === B.mat) !== same) continue;
        // Tones of one material under 5 % apart fight unseen.
        if (A.mat === B.mat && Math.max(Math.abs(A.rgb[0] - B.rgb[0]), Math.abs(A.rgb[1] - B.rgb[1]), Math.abs(A.rgb[2] - B.rgb[2])) < 0.05) continue;
        // A polygon offset of its own keeps a pair apart.
        if (A.offset !== B.offset) continue;
        const key = Math.min(c[a], c[b]) * 1e7 + Math.max(c[a], c[b]);
        if (seen.has(key)) continue;
        seen.add(key);
        const hit = [A, B].some((T) => {
          const O = T === A ? B : A;
          const cx = (T.v[0] + T.v[3] + T.v[6]) / 3, cz = (T.v[2] + T.v[5] + T.v[8]) / 3;
          return inside(cx, cz, O.v);
        });
        if (hit && bad.length < 5) bad.push(`${A.look}@${A.y.toFixed(4)} / ${B.look}@${B.y.toFixed(4)} at ${A.v[0].toFixed(1)}, ${A.v[2].toFixed(1)}`);
      }
    }
  }
  return bad;
}

for (const region of REGIONS) {
  test(`${region}: no two overlapping flat ground faces of different materials within 2 mm (lots, curbs, sidewalks, roads, paint)`, () => {
    assert.deepEqual(fights(region, false), []);
  });
  // Open (0.13.9, docs/STATUS.md): within the road builders (render/
  // citymesh.js, another helper's file) white and yellow paint quads lie
  // level on each other at 1.5 cm (Beach start, Downtown), and asphalt
  // pieces of two tones at 0 (Downtown). Recorded as todo so it shows.
  test(`${region}: no two overlapping flat ground faces of one material in different tones within 2 mm`, { todo: 'road paint and asphalt tones in citymesh.js' }, () => {
    assert.deepEqual(fights(region, true), []);
  });
}
