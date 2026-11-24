// Streetscape fixes (docs/STREETSCAPE.md, 0.12.1): the narrow-gap net is
// drawn as what the physics has (flat or raised), two bridge decks side
// by side are one road with no rails down the middle, fan junctions have
// asphalt along every arm, and no raised sidewalk is drawn on road.
import test from 'node:test';
import assert from 'node:assert/strict';
import { regionCity, REGION_IDS } from './regionfixture.js';
import { groundOf, CURB_H } from '../src/world/ground.js';
import { createEdgeLayer } from '../src/world/edgelines.js';
import { pairGap, curbsAt, inJunctionArea, MEDIAN_GAP } from '../src/world/junctions.js';
import { ChunkedBuilder } from '../src/render/meshbuilder.js';
import { realRoads, netRoads } from '../src/render/citymesh.js';

const KEYS = ['grass', 'asphalt', 'sidewalk', 'land', 'ground', 'sand', 'paint', 'ao', 'props', 'solid', 'detail', 'glow', 'trees', 'treesDetail', 'plain'];
const builders = () => {
  const B = {};
  for (const k of KEYS) B[k] = new ChunkedBuilder(1e7, 1, true, 4);
  return B;
};
// Flat triangles of the builders that hold (x, z), as their mean height.
function heightsAt(B, keys, x, z) {
  const out = [];
  for (const k of keys) {
    for (const mb of B[k].map.values()) {
      const P = mb.pos, I = mb.idx, n = mb.ni ?? I.length;
      for (let t = 0; t + 2 < n; t += 3) {
        const a = I[t] * 3, b = I[t + 1] * 3, c = I[t + 2] * 3;
        if (Math.abs(P[a + 1] - P[b + 1]) > 0.05 || Math.abs(P[a + 1] - P[c + 1]) > 0.05) continue;
        const d1 = (P[b] - P[a]) * (z - P[a + 2]) - (P[b + 2] - P[a + 2]) * (x - P[a]);
        const d2 = (P[c] - P[b]) * (z - P[b + 2]) - (P[c + 2] - P[b + 2]) * (x - P[b]);
        const d3 = (P[a] - P[c]) * (z - P[c + 2]) - (P[a + 2] - P[c + 2]) * (x - P[c]);
        if ((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0)) continue;
        out.push((P[a + 1] + P[b + 1] + P[c + 1]) / 3);
      }
    }
  }
  return out;
}

test('the narrow-gap net: flat beside road, raised between two sidewalks, and drawn as each', () => {
  const city = regionCity('miami-downtown'), G = groundOf(city);
  // S Miami Ave at SW 6th St: two sidewalks back to back with a 1 m gap
  // between (was a slot 15 cm deep, drawn as a green line).
  assert.equal(G.baseAt(-1368.75, 1320), 0);
  assert.equal(G.surfaceAt(-1368.75, 1320), 2);
  assert.equal(G.groundAt(-1368.75, 1320), CURB_H);
  // Every quad netQuads gives is of its kind in its first cell, in a box
  // of each region round its start.
  let flat = 0, raised = 0;
  for (const id of REGION_IDS) {
    const c = regionCity(id), g = groundOf(c), x = c.spawn.x, z = c.spawn.z;
    for (const kind of [1, 2]) {
      const q = g.netQuads(x - 400, z - 400, x + 400, z + 400, [], kind);
      for (let k = 0; k < q.length; k += 4) {
        // (A merged quad's middle can fall between its cells' lattice
        // points; its first cell is certain.)
        assert.equal(g.surfaceAt(q[k] + 0.125, q[k + 1] + 0.125), kind, `${id} quad ${q.slice(k, k + 4)}`);
        if (kind === 1) flat++; else raised++;
      }
    }
  }
  assert.ok(flat > 20, `flat net quads ${flat}`);
  // Drawn: asphalt at the flat net, sidewalk at the raised one.
  const B = builders();
  netRoads(city, B, -1380, 1310, -1356, 1330);
  assert.ok(heightsAt(B, ['sidewalk'], -1368.75, 1320).some((y) => y > CURB_H - 0.01), 'raised net drawn as sidewalk');
  assert.ok(raised > 20, `raised net quads ${raised}`);
});

test('two bridge decks under MEDIAN_GAP apart: no rail down the gap, and the gap is paved', () => {
  let pairs = 0;
  for (const id of REGION_IDS) {
    const city = regionCity(id), layer = createEdgeLayer(city), geo = city.roadGeo;
    for (const e of city.edges) {
      if (!e.bridge || !(e.pair >= 0) || !city.edges[e.pair].bridge || geo.inner[e.id]) continue;
      const lc = (e.off || 0) - e.width / 2;
      const g0 = pairGap(city, e, 0, lc), g1 = pairGap(city, e, e.length, lc);
      if (!(Math.max(g0, g1) < MEDIAN_GAP) || e.length < 8) continue;
      pairs++;
      const a = city.nodes[e.a];
      for (let d = 2; d < e.length - 2; d += 3) {
        const C = curbsAt(geo, e, d), o = C.l - pairGap(city, e, d, C.l) / 2;
        const x = a.x + e.ux * d - e.uz * o, z = a.z + e.uz * d + e.ux * o;
        assert.ok(layer.fieldAt(x, z) > 0, `${id} edge ${e.id} at ${d.toFixed(1)}: gap off the road (${x.toFixed(1)}, ${z.toFixed(1)})`);
      }
    }
  }
  assert.ok(pairs >= 4, `bridge pairs ${pairs}`);
});

test('fan junctions: asphalt along every arm to its mouth', () => {
  let fans = 0;
  for (const id of REGION_IDS) {
    const city = regionCity(id), geo = city.roadGeo;
    for (const J of geo.junctions) {
      if (!J.fan) continue;
      fans++;
      assert.ok(J.tris.length >= 18, `${id} fan ${J.id}`);
      for (const q of J.arms) {
        const e = city.edges[q >> 1], end = q & 1, t = geo.trim[q];
        // Just inside the mouth (0.3 m toward the node), at the middle of the carriageway.
        const d = end ? e.length - t + 0.3 : t - 0.3;
        if (!(t > 0.4)) continue;
        const C = curbsAt(geo, e, d), o = (C.l + C.r) / 2, a = city.nodes[e.a];
        const x = a.x + e.ux * d - e.uz * o, z = a.z + e.uz * d + e.ux * o;
        assert.ok(inJunctionArea(J, x, z), `${id} fan ${J.id} arm ${q}`);
      }
    }
  }
  assert.ok(fans > 10, `fans ${fans}`);
});

test('no raised sidewalk drawn on road: S Miami Ave at SW 6th St and a fan junction', () => {
  const city = regionCity('miami-downtown'), G = groundOf(city);
  for (const [x, z] of [[-1362, 1286], [-1361.3, 1285.8], [-1178.75, 938.25], [-1177.75, 940.25]]) {
    assert.equal(G.surfaceAt(x, z), 1, `road at ${x}, ${z}`);
    const B = builders();
    const near = [];
    city.edgesNear(x, z, 60, near);
    realRoads(city, B, city.nodes.filter((n) => Math.hypot(n.x - x, n.z - z) < 60), near.map((k) => city.edges[k]));
    const raised = heightsAt(B, ['sidewalk', 'grass'], x, z).filter((y) => y > 0.1);
    assert.equal(raised.length, 0, `raised sidewalk on the road at ${x}, ${z}`);
  }
});
