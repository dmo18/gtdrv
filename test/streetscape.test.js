// Streetscape fixes (docs/STREETSCAPE.md, 0.12.1): the narrow-gap net is
// drawn as what the physics has (flat or raised), two bridge decks side
// by side are one road with no rails down the middle, fan junctions have
// asphalt along every arm, and no raised sidewalk is drawn on road.
import test from 'node:test';
import assert from 'node:assert/strict';
import { regionCity, REGION_IDS } from './regionfixture.js';
import { groundOf, CURB_H } from '../src/world/ground.js';
import { createEdgeLayer } from '../src/world/edgelines.js';
import { pairGap, curbsAt, inJunctionArea, MEDIAN_GAP, fanMouthHull, pointInRing, ringDist, edgePaint } from '../src/world/junctions.js';
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

// 0.13.1 (docs/PLAN_V4.md task 11): fan sidewalk, crossing paint, Lincoln Road.

test('fan junction: an arm\'s sidewalk stops at its mouth, the crossing paved (fan1, S 1st Ave at SE 4th St)', () => {
  const city = regionCity('miami-downtown'), G = groundOf(city), geo = city.roadGeo;
  const J = geo.junctions.filter((j) => j.fan).sort((a, b) => Math.hypot(a.x + 1187, a.z - 953) - Math.hypot(b.x + 1187, b.z - 953))[0];
  const hull = fanMouthHull(city, J);
  assert.ok(hull.length >= 6);
  const B = builders();
  const near = [];
  city.edgesNear(J.x, J.z, 80, near);
  realRoads(city, B, city.nodes.filter((n) => Math.hypot(n.x - J.x, n.z - J.z) < 80), near.map((k) => city.edges[k]));
  // The slip lane's left sidewalk ran on past its mouth across the
  // crossing (raised there in physics).
  for (const [x, z] of [[-1180, 942.4], [-1179, 943.4]]) {
    assert.equal(G.groundAt(x, z), 0, `flat at ${x}, ${z}`);
    assert.ok(heightsAt(B, ['asphalt'], x, z).length > 0, `asphalt drawn at ${x}, ${z}`);
    assert.equal(heightsAt(B, ['sidewalk', 'grass'], x, z).filter((y) => y > 0.1).length, 0, `nothing raised drawn at ${x}, ${z}`);
  }
  // No point of the mouth hull is left without asphalt or a raised side.
  let bare = 0, n = 0;
  for (let z = J.z0; z <= J.z1; z += 1) {
    for (let x = J.x0; x <= J.x1; x += 1) {
      if (!pointInRing(hull, x, z)) continue;
      n++;
      if (!heightsAt(B, ['asphalt', 'sidewalk', 'grass'], x, z).length) bare++;
    }
  }
  assert.ok(n > 100 && bare === 0, `${bare} of ${n} points bare`);
});

test('two overlapping carriageways: only one paints its lane lines there (S Miami Ave at SW 6th St)', () => {
  const P = [], near = [];
  for (const id of ['miami-downtown', 'miami-beach']) {
    const city = regionCity(id), geo = city.roadGeo;
    let points = 0, crossed = 0;
    for (const e of city.edges) {
      edgePaint(city, e, P);
      const a = city.nodes[e.a];
      for (let k = 0; k + 5 < P.length; k += 6) {
        if (P[k] === P[k + 2]) continue; // across: crosswalks, stop bars
        const n = Math.ceil(Math.hypot(P[k + 2] - P[k], P[k + 3] - P[k + 1]) / 2);
        for (let m = 0; m <= n; m++) {
          const d = P[k] + ((P[k + 2] - P[k]) * m) / n, o = P[k + 1] + ((P[k + 3] - P[k + 1]) * m) / n;
          const x = a.x + e.ux * d - e.uz * o, z = a.z + e.uz * d + e.ux * o;
          points++;
          near.length = 0;
          city.edgesNear(x, z, 20, near);
          for (const q of near) {
            const f = city.edges[q];
            if (f === e || f.id === e.pair || geo.inner[f.id] || f.ped || f.lanesF === undefined) continue;
            if (f.a === e.a || f.a === e.b || f.b === e.a || f.b === e.b) continue;
            if (!(f.width > e.width || (f.width === e.width && f.id < e.id))) continue;
            const fa = city.nodes[f.a], fd = (x - fa.x) * f.ux + (z - fa.z) * f.uz;
            if (fd < geo.trim[2 * f.id] || fd > f.length - geo.trim[2 * f.id + 1]) continue;
            const s = -(x - fa.x) * f.uz + (z - fa.z) * f.ux, C = curbsAt(geo, f, fd);
            if (s > C.l + 0.3 && s < C.r - 0.3) crossed++;
          }
        }
      }
    }
    assert.ok(points > 10000, `${id} paint points ${points}`);
    // (Were 425 points in Downtown, 43 in Beach.)
    assert.equal(crossed, 0, `${id}: paint on another painted carriageway`);
  }
});

test('Lincoln Road: no asphalt wedge out to the mall, the ring past the streets paved as the mall', () => {
  const city = regionCity('miami-beach'), geo = city.roadGeo;
  let checked = 0, paved = 0;
  for (const J of geo.junctions) {
    const arms = [...J.arms];
    if (J.fan || !arms.some((q) => /^Lincoln Road/.test(city.edges[q >> 1].name || '') && city.edges[q >> 1].ped)) continue;
    if (arms.filter((q) => !city.edges[q >> 1].ped).length < 2) continue;
    const hull = fanMouthHull(city, J, true);
    const B = builders();
    realRoads(city, B, [city.nodes[J.lead]], []);
    for (let z = J.z0; z <= J.z1; z += 0.5) {
      for (let x = J.x0; x <= J.x1; x += 0.5) {
        if (!inJunctionArea(J, x, z) || ringDist(J.ring, x, z) < 0.3) continue;
        const inside = pointInRing(hull, x, z), d = ringDist(hull, x, z);
        if (d < 0.6) continue; // (the hull's edge: cut in 1.5 m triangles)
        const asphalt = heightsAt(B, ['asphalt'], x, z).length > 0, paving = heightsAt(B, ['sidewalk'], x, z).length > 0;
        assert.equal(asphalt, inside, `junction ${J.id} at ${x}, ${z}: asphalt ${asphalt}`);
        if (!inside) { assert.ok(paving, `junction ${J.id} at ${x}, ${z}: paved`); paved++; }
      }
    }
    checked++;
  }
  assert.ok(checked >= 10 && paved > 50, `Lincoln Road junctions ${checked}, paved points ${paved}`);
});
