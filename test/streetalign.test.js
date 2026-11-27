// Street alignment (0.13.8, docs/STATUS.md "0.13.8 street alignment"):
// the owner drove 0.13.7 and found streets that do not line up. Measured
// over all five regions with test/streetaudit.js and test/junctionaudit.js
// (scripts/street-align.mjs prints the same numbers). Each threshold below
// failed on 0.13.7 (numbers in the comments) and holds now.
import test from 'node:test';
import assert from 'node:assert/strict';
import { regionCity, REGION_IDS } from './regionfixture.js';
import { auditStreets } from './streetaudit.js';
import { auditJunctions } from './junctionaudit.js';
import { CURB_R_MAX, inJunctionArea, curbsAt } from '../src/world/junctions.js';
import { groundOf } from '../src/world/ground.js';

const S = {}, J = {};
const streets = (id) => S[id] || (S[id] = auditStreets(regionCity(id)));
const junctions = (id) => J[id] || (J[id] = auditJunctions(regionCity(id)));

test('the owner\'s junction, SW 20th Road at SW 5th Avenue (South): four arms, no stubs, symmetric, all road inside', () => {
  const c = regionCity('miami-south'), geo = c.roadGeo, G = groundOf(c);
  // The node where both streets meet (a small traffic circle in the data,
  // merged into one node).
  const n = c.nodes.find((q) => Math.hypot(q.x + 2521.6, q.z - 2080.3) < 3);
  assert.ok(n, 'the junction node');
  const Jn = geo.junctions[geo.nodeJ[n.id]];
  // 0.13.7: eight arms, four of them 8 m dead-end stubs 12 m wide (the
  // circle's ring folded out of the node): wedges of road, lawn and
  // slanted sidewalk across the crossing.
  assert.equal(Jn.arms.length, 4, 'four arms');
  for (const q of Jn.arms) {
    const e = c.edges[q >> 1];
    assert.ok(/Southwest (20th Road|5th Avenue)/.test(e.name), `arm ${e.id} is one of the two streets (${e.name || 'unnamed'})`);
    assert.ok(e.length > 20, `arm ${e.id} is no stub`);
  }
  // The asphalt reaches no farther from the arms' carriageways than a
  // curb return does, on any side.
  let reach = 0;
  for (let k = 0; k < Jn.ring.length; k += 2) {
    let best = Infinity;
    for (const q of Jn.arms) {
      const e = c.edges[q >> 1], m = c.nodes[q & 1 ? e.b : e.a];
      const lat = -(Jn.ring[k] - m.x) * e.uz + (Jn.ring[k + 1] - m.z) * e.ux - (e.off || 0);
      best = Math.min(best, Math.max(0, Math.abs(lat) - e.width / 2));
    }
    reach = Math.max(reach, best);
  }
  assert.ok(reach <= CURB_R_MAX + 1.5, `reach ${reach.toFixed(2)} m`);
  // Every point of the junction's asphalt is road in the ground (no lawn
  // or sidewalk inside the hull), every arm mouth is road edge to edge,
  // and no corner's sidewalk lies on the asphalt.
  for (let x = Jn.x0; x <= Jn.x1; x += 0.5) for (let z = Jn.z0; z <= Jn.z1; z += 0.5) {
    if (inJunctionArea(Jn, x, z)) assert.equal(G.surfaceAt(x, z), 1, `road at ${x.toFixed(1)}, ${z.toFixed(1)}`);
  }
  for (const q of Jn.arms) {
    const e = c.edges[q >> 1], a = c.nodes[e.a], d = q & 1 ? e.length - geo.trim[q] - 0.3 : geo.trim[q] + 0.3;
    const C = curbsAt(geo, e, d), l = C.l, r = C.r;
    for (let t = 0.05; t < 1; t += 0.1) {
      const o = l + (r - l) * t;
      assert.equal(G.surfaceAt(a.x + e.ux * d - e.uz * o, a.z + e.uz * d + e.ux * o), 1, `arm ${e.id} mouth`);
    }
  }
  for (const C of Jn.corners) {
    const T = C.tris;
    if (!T) continue;
    for (let k = 0; k + 5 < T.length; k += 6) {
      const cx = (T[k] + T[k + 2] + T[k + 4]) / 3, cz = (T[k + 1] + T[k + 3] + T[k + 5]) / 3;
      assert.ok(!inJunctionArea(Jn, cx, cz), 'corner sidewalk off the asphalt');
    }
  }
});

test('no junction keeps the stubs of a folded traffic circle (five regions)', () => {
  // 0.13.7: 28 junctions with a dead-end arm under 12 m (South 14,
  // Beach 5, West 4, Downtown 3, North 2); now 6, all real short stubs.
  let stubs = 0;
  for (const id of REGION_IDS) stubs += junctions(id).stub;
  assert.ok(stubs <= 8, `${stubs} junctions with a stub arm`);
});

test('the two halves of a pair drawn as one road paint one double yellow, not two lines that part and cross', () => {
  // 0.13.7: 64 to 79 percent of the samples over 0.6 m apart (Beach
  // 3408 of 4336); 0.13.8: 5 to 12 percent (data halves that part for a
  // block, where each line keeps to its own curb), 187, 300, 98, 49 and 132
  // samples apart. 0.15 WP1: most of those pairs are one two-way road now
  // (world/pairmerge.js: no yellow edge lines to sample, 193 to 2104
  // samples a region left), so the bound is on the samples apart: fewer
  // than 0.13.8 left in every region, under half of its 766 in all (353).
  const WAS = { 'miami-downtown': 187, 'miami-beach': 300, 'miami-north': 98, 'miami-west': 49, 'miami-south': 132 };
  let apart = 0;
  for (const id of REGION_IDS) {
    const r = streets(id);
    assert.ok(r.yellowApart < WAS[id], `${id}: ${r.yellowApart} of ${r.yellowSamples} yellow samples apart`);
    apart += r.yellowApart;
  }
  assert.ok(apart < 383, `${apart} yellow samples apart`);
});

test('curb parking spots stand in the drawn parking lane; borders do not step at a joint; arm mouths meet their junction', () => {
  for (const id of REGION_IDS) {
    const r = streets(id);
    // 0.13.7: 47 curb spots over 0.4 m off the lane as drawn (tapers and
    // side shifts), up to 3.9 m (Downtown SE 3rd Street).
    assert.ok(r.curbSpots > 2000 && r.curbSpotOff === 0, `${id}: ${r.curbSpotOff} curb spots off the lane, worst ${JSON.stringify(r.curbWorst)}`);
    // A drawn curb steps at no joint of two edges (0.2 m at most), and
    // both curbs of every arm reach their junction's asphalt.
    assert.ok(r.bends > 200 && r.bendStep === 0, `${id}: ${r.bendStep} joints with a step, worst ${r.bendDrawnMax}`);
    assert.ok(r.arms > 1500 && r.mouthMiss === 0, `${id}: ${r.mouthMiss} arm mouths off the junction`);
  }
});
