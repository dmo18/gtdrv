// Props off the road (0.13.7, docs/STREETSCAPE.md "props off the road").
// The owner drove the live game and found light poles in the middle of the
// road. In 0.13.6, 841 lamps, 420 palms, 185 signal masts, 45 street-name
// posts, 39 stop signs, 6 street trees and 150 lot features (hedges,
// fences, walls, beds) of the five regions had part of their solid on the
// drivable surface: a strip, the paved gap between two carriageways, a
// junction's area or a crosswalk (world/ground.js surfaceAt 1). Now none
// does, by more than TOL, in any region; lamps on a median stand in its
// middle; a signaled junction keeps its masts. (Held to the surface
// without the narrow-gap net, ground.js baseAt: the strips, lanes, paved
// gaps, junction areas with crosswalks and fans, and gores. The net, the
// asphalt filled into slivers under 2 m between two roads, is left out:
// 35 street props of the five regions stand on it, docs/STATUS.md 0.13.7.)
import test from 'node:test';
import assert from 'node:assert/strict';
import { regionCity, REGION_IDS } from './regionfixture.js';
import { groundOf } from '../src/world/ground.js';
import { eachStreetProp, propShapes, PROP_SOLIDS } from '../src/world/propsolid.js';
import { dressLot } from '../src/world/lots.js';
import { curbSpot, footClear, MEDIAN_LAMP } from '../src/world/streetscape.js';
import { curbsAt, pairGap, medianAt, junctionsInBox } from '../src/world/junctions.js';

const TOL = 0.03; // m a footprint may touch the drivable surface
const C8 = [], S8 = [];
for (let k = 0; k < 8; k++) { C8.push(Math.cos((k * Math.PI) / 4)); S8.push(Math.sin((k * Math.PI) / 4)); }
// The first point of a collision shape (circle or box), shrunk by TOL,
// on the drivable surface; null when none is.
function onRoad(G, sh, at = G.surfaceAt) {
  if (sh.kind === 1) {
    const r = Math.max(0, sh.r - TOL);
    if (at(sh.x, sh.z) === 1) return [sh.x, sh.z];
    for (let k = 0; k < 8; k++) if (at(sh.x + C8[k] * r, sh.z + S8[k] * r) === 1) return [sh.x + C8[k] * r, sh.z + S8[k] * r];
    return null;
  }
  const x0 = sh.x0 + TOL, x1 = sh.x1 - TOL, z0 = sh.z0 + TOL, z1 = sh.z1 - TOL;
  const ni = Math.max(2, Math.ceil((x1 - x0) / 0.5)), nj = Math.max(2, Math.ceil((z1 - z0) / 0.5));
  for (let i = 0; i <= ni; i++) {
    for (let j = 0; j <= nj; j++) {
      const x = x0 + ((x1 - x0) * i) / ni, z = z0 + ((z1 - z0) * j) / nj;
      if (at(x, z) === 1) return [x, z];
    }
  }
  return null;
}

test('no solid street prop stands on the drivable surface in any region', () => {
  const bad = [], counts = [];
  const list = [];
  for (const id of REGION_IDS) {
    const city = regionCity(id), G = groundOf(city);
    const n = {};
    eachStreetProp(city, (type, x, z, rot, h) => {
      list.length = 0;
      if (!propShapes(type, x, z, rot, h, list)) return;
      n[type] = (n[type] || 0) + 1;
      for (const sh of list) {
        const p = onRoad(G, sh, G.baseAt);
        if (p) { bad.push(`${id} ${type} at ${x.toFixed(1)}, ${z.toFixed(1)} (road at ${p[0].toFixed(2)}, ${p[1].toFixed(2)})`); break; }
      }
    });
    counts.push(`${id}: ${Object.entries(n).map(([k, v]) => `${v} ${k}`).join(', ')}`);
  }
  assert.deepEqual(bad.slice(0, 20), [], `${bad.length} street props on the road (${counts.join('; ')})`);
});

test('no solid lot feature stands on the drivable surface in any region', () => {
  const bad = [];
  const feats = [], list = [], near = [];
  let n = 0;
  for (const id of REGION_IDS) {
    const city = regionCity(id), G = groundOf(city);
    for (const lot of city.lots) {
      if (!lot || lot.type === 'verge' || lot.type === 'airfield') continue;
      dressLot(city, lot, feats);
      for (const f of feats) {
        const e = PROP_SOLIDS[f.kind];
        if (e ? e.mode === 'flat' : !f.solid) continue;
        list.length = 0;
        if (!propShapes(f.kind, f.x, f.z, 0, 0, list, f)) continue;
        n++;
        // (Only a feature with a strip or a junction within 9 m can reach
        // the road: edgesNear counts each strip's half width.)
        const reach = f.r > 0 ? f.r : Math.hypot(f.l || 0, f.w || 0) / 2;
        if (!city.edgesNear(f.x, f.z, reach + 9, near).length && !junctionsInBox(city.roadGeo, f.x - reach - 9, f.z - reach - 9, f.x + reach + 9, f.z + reach + 9)) continue;
        for (const sh of list) {
          const p = onRoad(G, sh, G.baseAt);
          if (p) { bad.push(`${id} lot ${lot.id} (${lot.type}) ${f.kind} at ${f.x}, ${f.z}`); break; }
        }
      }
    }
  }
  assert.ok(n > 300000, `${n} solid lot features`);
  assert.deepEqual(bad.slice(0, 20), [], `${bad.length} lot features on the road`);
});

test('the 0.13.6 defect places: no lamp in the paved gap or the shifted strip', () => {
  // Downtown, where lamps stood in the road in 0.13.6 (all surface 1).
  const city = regionCity('miami-downtown'), G = groundOf(city);
  const PLACES = [[-1578.4, -141.3], [-1988.7, 629.0], [-1404.3, 1014.4], [-729.6, 870.4], [-926.6, 927.6], [-841.7, 921.5]];
  for (const [x, z] of PLACES) {
    assert.equal(G.surfaceAt(x, z), 1, `${x}, ${z} is road`);
    for (const p of city.props) assert.ok(Math.hypot(p.x - x, p.z - z) > 0.5, `a ${p.type} still near ${x}, ${z}`);
  }
});

test('placement rules: a median takes a lamp only when wide enough, in its middle; the far side of a paved gap takes nothing', () => {
  const P = { x: 0, z: 0, o: 0, on: '' };
  let medians = 0, narrow = 0, gaps = 0;
  for (const id of ['miami-downtown', 'miami-beach']) {
    const city = regionCity(id), G = groundOf(city), geo = city.roadGeo;
    for (const e of city.edges) {
      if (!(e.median > 0) || !(e.pair > e.id) || geo.inner[e.id] || e.bridge) continue;
      for (let d = 5; d < e.length - 5; d += 7) {
        const cl = curbsAt(geo, e, d).l;
        const ok = curbSpot(city, G, e, d, -1, 0.8, 0.18, 'lamp', P);
        const full = pairGap(city, e, d, cl);
        if (ok) {
          assert.equal(P.on, 'median');
          // Centered: as far from this curb as from the partner's.
          assert.ok(Math.abs((cl - P.o) - full / 2) < 0.01, `${id} edge ${e.id} at ${d}: ${cl - P.o} of ${full}`);
          assert.ok(full >= MEDIAN_LAMP && medianAt(city, e, d, cl) > 0);
          assert.ok(footClear(city, G, P.x, P.z, 0.18, false));
          medians++;
        } else if (full < MEDIAN_LAMP) narrow++;
        // A street prop other than a lamp or tree never goes on a median.
        assert.equal(curbSpot(city, G, e, d, -1, 0.7, 0.08, '', P), false);
      }
    }
    for (const e of city.edges) {
      if (geo.inner[e.id]) continue;
      for (let d = 5; d < e.length - 5; d += 9) {
        for (const side of [1, -1]) {
          if (!(G.gapAt(e.id, side > 0 ? 0 : 1, d) > 0)) continue;
          gaps++;
          assert.equal(curbSpot(city, G, e, d, side, 0.8, 0.18, 'lamp', P), false, `${id} edge ${e.id} at ${d}`);
        }
      }
    }
  }
  assert.ok(medians > 50 && gaps > 50, `${medians} median lamps, ${narrow} too narrow, ${gaps} gap stations`);
});

test('streets keep their lamps and signaled junctions their masts', () => {
  for (const id of REGION_IDS) {
    const city = regionCity(id), st = city.graphStats.streetProps;
    // (Dropped: no room off the road at the place or 3 m along; 0.13.6
    // had stood 4 to 9 % of them on the road.)
    assert.ok(st && st.dropped < 0.12 * (st.kept + st.moved + st.dropped), `${id} ${JSON.stringify(st)}`);
    const has = new Set(city.signals.map((s) => s.node));
    let nodes = 0, bare = 0;
    for (const n of city.nodes) {
      if (!n.signal || n.i < 0 || !n.edges.some((eid) => !city.roadGeo.inner[eid])) continue;
      nodes++;
      if (!has.has(n.id)) bare++;
    }
    // (0.13.6 had 13 such junctions in the five regions, the same ones.)
    assert.ok(bare <= Math.max(1, nodes * 0.04), `${id}: ${bare} of ${nodes} signaled junctions with no mast`);
  }
});
