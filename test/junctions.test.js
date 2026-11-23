// Junctions and strip ends (docs/PLAN_V3.md 13, ROADS; world/junctions.js;
// docs/MAP.md "Junctions and strip ends"). For every region, over all
// junctions: (a) no lane paint inside a junction polygon; (b) two
// different road strips overlap outside junction polygons in under 0.5 %
// of samples; (c) every strip end lies on its junction boundary within
// 0.3 m; (d) no road-space sliver under 1.5 m; (e) no lane count step
// without a taper (the curbs of the two edges at a bend meet).
import test from 'node:test';
import assert from 'node:assert/strict';
import { regionCity, REGION_IDS } from './regionfixture.js';
import { createGround } from '../src/world/ground.js';
import {
  buildRoadGeo, edgePaint, edgeStations, curbsAt, inJunctionArea, ringDist, isSimple, triangulate, ringArea,
  walkOf, walkLeftOf, medianBand, stopDistance, STOP_BAR,
} from '../src/world/junctions.js';
import { MEDIAN_PLANT } from '../src/world/roadprofile.js';

// Junctions whose box holds (x, z), from a 32 m grid of their boxes.
function junctionGrid(geo) {
  const G = new Map(), C = 32;
  for (const J of geo.junctions) {
    for (let i = Math.floor(J.x0 / C); i <= Math.floor(J.x1 / C); i++) {
      for (let j = Math.floor(J.z0 / C); j <= Math.floor(J.z1 / C); j++) {
        const k = i * 100003 + j;
        if (!G.has(k)) G.set(k, []);
        G.get(k).push(J);
      }
    }
  }
  return (x, z) => G.get(Math.floor(x / C) * 100003 + Math.floor(z / C)) || [];
}

// Inside some junction polygon, more than `m` m from its boundary.
function inJunction(jAt, x, z, m) {
  for (const J of jAt(x, z)) {
    if (!inJunctionArea(J, x, z)) continue;
    if (m <= 0) return true;
    // m in from the edge: the point and four around it all inside.
    if (inJunctionArea(J, x + m, z) && inJunctionArea(J, x - m, z) && inJunctionArea(J, x, z + m) && inJunctionArea(J, x, z - m)) return true;
  }
  return false;
}

// Is (x, z) on the drawn strip of edge e (between its trimmed, mitered
// ends, within its curbs)? `inset` m in from every side.
function onStrip(city, e, x, z, inset) {
  const geo = city.roadGeo, a = city.nodes[e.a];
  if (geo.inner[e.id]) return false;
  const d = (x - a.x) * e.ux + (z - a.z) * e.uz, s = -(x - a.x) * e.uz + (z - a.z) * e.ux;
  const qa = 2 * e.id, qb = qa + 1;
  if (d < geo.trim[qa] + geo.miter[qa] * s + inset || d > e.length - geo.trim[qb] + geo.miter[qb] * s - inset) return false;
  const C = curbsAt(geo, e, d);
  return s > C.l + inset && s < C.r - inset;
}

const PAINT = [], ST = [], near = [];
function metrics(city) {
  const geo = city.roadGeo, nodes = city.nodes, edges = city.edges;
  const jAt = junctionGrid(geo);
  const ground = createGround(city);
  const m = { paint: 0, paintSamples: 0, overlap: 0, strips: 0, ends: 0, badEnds: 0, slivers: 0, sliverProbes: 0, bends: 0, steps: 0, worstEnd: 0, where: [] };
  for (const e of edges) {
    if (geo.inner[e.id]) continue;
    const a = nodes[e.a];
    const pt = (d, o) => [a.x + e.ux * d - e.uz * o, a.z + e.uz * d + e.ux * o];
    // (a) paint
    edgePaint(city, e, PAINT);
    for (let k = 0; k + 5 < PAINT.length; k += 6) {
      for (const f of [0, 0.5, 1]) {
        const [x, z] = pt(PAINT[k] + (PAINT[k + 2] - PAINT[k]) * f, PAINT[k + 1] + (PAINT[k + 3] - PAINT[k + 1]) * f);
        m.paintSamples++;
        if (inJunction(jAt, x, z, 0.1)) { m.paint++; if (m.where.length < 6) m.where.push(['paint', e.id, Math.round(x), Math.round(z)]); }
      }
    }
    // (b) overlap of strips outside junctions (grade-separated bridges apart)
    edgeStations(geo, e, 2, ST);
    for (let i = 0; i < ST.length; i += 4) {
      const d = ST[i], l = ST[i + 2], r = ST[i + 3];
      for (let f = 0.1; f < 1; f += 0.2) {
        const o = l + (r - l) * f;
        const [x, z] = pt(d + ST[i + 1] * o + (i === 0 ? 0.3 : i + 4 >= ST.length ? -0.3 : 0), o);
        if (inJunction(jAt, x, z, 0)) continue;
        m.strips++;
        city.edgesNear(x, z, 2, near);
        for (const k of near) {
          const o2 = edges[k];
          if (o2 === e || o2.bridge || e.bridge) continue;
          if (onStrip(city, o2, x, z, 0.05)) { m.overlap++; if (m.where.length < 12) m.where.push(['overlap', e.id, k, Math.round(x), Math.round(z)]); break; }
        }
      }
    }
    // (c) strip ends on the junction boundary
    for (let end = 0; end < 2; end++) {
      const q = 2 * e.id + end, J = geo.junctions[geo.jEnd[q]];
      if (!J) continue;
      const d = end ? e.length - geo.trim[q] : geo.trim[q];
      const C = curbsAt(geo, e, d);
      for (const o of [C.l, C.r]) {
        const [x, z] = pt(d, o);
        const dist = ringDist(J.ring, x, z);
        m.ends++;
        if (dist > m.worstEnd) m.worstEnd = dist;
        if (dist > 0.3) m.badEnds++;
      }
    }
    // (d) slivers beside the road space: a strip of non-road ground under
    // 1.5 m between the back of this road's sidewalk (or median) and more
    // road space.
    if (!e.bridge && !e.causeway && !e.ped) {
      const span0 = geo.trim[2 * e.id] + 3, span1 = e.length - geo.trim[2 * e.id + 1] - 3;
      for (let d = span0; d <= span1; d += 4) {
        const C = curbsAt(geo, e, d);
        const wR = walkOf(e), med = medianBand(e), wL = walkLeftOf(e);
        for (const [o0, dir] of [[C.r + wR, 1], [C.l - (med > 0 ? med : wL), -1]]) {
          if (med > 0 && dir < 0 && e.median > 8) continue; // lot ground in a wide median
          const [x0, z0] = pt(d, o0 + dir * 0.25);
          if (ground.surfaceAt(x0, z0) !== 0 || inJunction(jAt, x0, z0, -0.5)) continue;
          m.sliverProbes++;
          for (let g = 0.55; g < 1.5; g += 0.3) {
            const [x, z] = pt(d, o0 + dir * g);
            if (ground.surfaceAt(x, z) !== 0) { m.slivers++; if (m.where.length < 18) m.where.push(['sliver', e.id, Math.round(x), Math.round(z), +g.toFixed(2)]); break; }
          }
        }
      }
    }
  }
  // (e) bends: the curbs of the two edges meet at the node
  for (const e of edges) {
    for (let end = 0; end < 2; end++) {
      const q = 2 * e.id + end, k = geo.nbr[q];
      if (k < 0) continue;
      const o = edges[k];
      const C1 = { ...curbsAt(geo, e, end ? e.length : 0) };
      const oEnd = o.b === (end ? e.b : e.a) ? 1 : 0;
      const C2 = { ...curbsAt(geo, o, oEnd ? o.length : 0) };
      const f = geo.flip[q] ? -1 : 1;
      const l2 = f > 0 ? C2.l : -C2.r, r2 = f > 0 ? C2.r : -C2.l;
      m.bends++;
      if (Math.abs(C1.l - l2) > 0.05 || Math.abs(C1.r - r2) > 0.05) m.steps++;
    }
  }
  return m;
}

const results = {};
for (const id of REGION_IDS) {
  const c = regionCity(id);
  results[id] = metrics(c);
}
if (process.env.RW_JUNCTIONS_LOG) for (const id of REGION_IDS) console.log(id, JSON.stringify(results[id]), JSON.stringify(regionCity(id).roadGeo.stats));

test('junction geometry: every region has junction polygons, simple and triangulated', () => {
  for (const id of REGION_IDS) {
    const geo = regionCity(id).roadGeo;
    let fans = 0;
    assert.ok(geo.junctions.length > 300, id);
    for (const J of geo.junctions) {
      if (J.arms.length < 2) continue;
      fans += J.fan ? 1 : 0;
      if (J.fan) continue;
      assert.ok(isSimple(J.ring), `${id} junction ${J.id} ring`);
      let area = 0;
      for (let k = 0; k < J.tris.length; k += 6) area += Math.abs(ringArea(J.tris.subarray(k, k + 6)));
      assert.ok(Math.abs(area - Math.abs(ringArea(J.ring))) < 0.01 * Math.abs(ringArea(J.ring)) + 0.5, `${id} junction ${J.id} triangles`);
    }
    // Rings that cross themselves (drawn as a fan): a few percent at most.
    assert.ok(fans < 0.04 * geo.junctions.length, `${id}: ${fans} fan junctions`);
  }
});

test('(a) no lane paint inside a junction polygon', () => {
  for (const id of REGION_IDS) assert.equal(results[id].paint, 0, `${id}: ${JSON.stringify(results[id].where.filter((w) => w[0] === 'paint'))}`);
});

test('(b) road strips overlap outside junction polygons in under 0.5 % of samples', () => {
  for (const id of REGION_IDS) {
    const r = results[id];
    assert.ok(r.strips > 20000, id);
    assert.ok(r.overlap / r.strips < 0.005, `${id}: ${r.overlap} of ${r.strips}`);
  }
});

test('(c) every strip end lies on its junction boundary within 0.3 m', () => {
  for (const id of REGION_IDS) {
    const r = results[id];
    assert.ok(r.ends > 1000, id);
    assert.equal(r.badEnds, 0, `${id}: worst ${r.worstEnd.toFixed(2)} m`);
  }
});

test('(d) no road-space sliver under 1.5 m', () => {
  for (const id of REGION_IDS) {
    const r = results[id];
    assert.ok(r.sliverProbes > 5000, id);
    assert.equal(r.slivers, 0, `${id}: ${JSON.stringify(r.where.filter((w) => w[0] === 'sliver'))}`);
  }
  // Medians: none between 0 and the planted minimum.
  for (const id of REGION_IDS) for (const e of regionCity(id).edges) assert.ok(!(e.median > 0 && e.median < MEDIAN_PLANT), `${id} edge ${e.id} median ${e.median}`);
});

test('(e) no lane count step without a taper', () => {
  for (const id of REGION_IDS) {
    const r = results[id];
    assert.ok(r.bends > 300, id);
    assert.equal(r.steps, 0, id);
  }
});

test('stop bars: on controlled approaches only, behind the strip end', () => {
  for (const id of REGION_IDS) {
    const c = regionCity(id), geo = c.roadGeo;
    let bars = 0;
    for (const J of geo.junctions) {
      for (const q of J.arms) {
        const e = c.edges[q >> 1], node = q & 1 ? e.b : e.a;
        const sd = stopDistance(c, e.id, node);
        if (!(J.signal || J.stop)) assert.equal(sd, -1);
        if (sd > 0) { bars++; assert.ok(Math.abs(sd - geo.trim[q] - STOP_BAR) < 0.5); }
      }
    }
    assert.ok(bars > 100, id);
  }
});

test('junction geometry is a pure function of the graph (same twice)', () => {
  const c = regionCity('miami-beach');
  const g2 = buildRoadGeo(c.nodes, c.edges);
  assert.deepEqual(Array.from(g2.trim), Array.from(c.roadGeo.trim));
  assert.equal(g2.junctions.length, c.roadGeo.junctions.length);
  assert.deepEqual(Array.from(g2.junctions[7].ring), Array.from(c.roadGeo.junctions[7].ring));
  assert.ok(triangulate([0, 0, 4, 0, 4, 4, 2, 1, 0, 4]).length === 18);
});
