// No slivers (0.15, docs/ROADS.md WP3). A strip of non-road under 2 m wide
// between a curb and more road beyond it (lawn, sidewalk or median left
// between two carriageways, or a carriageway and a junction) is paved: the
// ground's sliver gap (world/ground.js sliverGap, read through gapAt like
// the facing gaps). Measured as scripts/road-audit.mjs does, every 2 m
// along each strip, both curbs, on the ground without the narrow-gap net.
import test from 'node:test';
import assert from 'node:assert/strict';
import { regionCity } from './regionfixture.js';
import { createGround, groundOf, SLIVER_MAX, FILL_STEP } from '../src/world/ground.js';
import { curbsAt } from '../src/world/junctions.js';

const skip = (e) => e.lanesF === undefined || e.causeway || e.ped;

// Meters of curb with a sliver beside it, by what the sliver is (0 land,
// 2 sidewalk, 3 median).
function slivers(city, G) {
  const geo = city.roadGeo, N = city.nodes;
  const out = { m: 0, land: 0, walk: 0, median: 0 };
  for (const e of city.edges) {
    if (skip(e) || geo.inner[e.id]) continue;
    const a = N[e.a], t0 = geo.trim[2 * e.id], t1 = e.length - geo.trim[2 * e.id + 1];
    for (let d = t0 + 1; d < t1 - 1; d += 2) {
      const C = curbsAt(geo, e, d);
      for (let side = 0; side < 2; side++) {
        const o0 = side ? C.r : C.l, s = side ? 1 : -1;
        let kind = -1, back = false;
        for (let k = 1; k <= 8; k++) {
          const o = o0 + s * 0.25 * k;
          const g = G.baseAt(a.x + e.ux * d - e.uz * o, a.z + e.uz * d + e.ux * o);
          if (g === 1) { back = kind >= 0; break; }
          if (kind < 0) kind = g;
        }
        if (!back) continue;
        out.m += 2;
        if (kind === 0) out.land += 2; else if (kind === 2) out.walk += 2; else out.median += 2;
      }
    }
  }
  return out;
}

test('slivers under 2 m between road and road are paved (downtown and south, 996 m before WP3)', () => {
  let total = 0, land = 0;
  for (const id of ['miami-downtown', 'miami-south']) {
    const city = regionCity(id);
    const s = slivers(city, groundOf(city));
    total += s.m;
    land += s.land;
  }
  // (Measured 84 m, 16 m of it lawn; 996 m, 350 m of it lawn, before.)
  assert.ok(total <= 150, `${total} m of sliver curb`);
  assert.ok(land <= 40, `${land} m of lawn sliver`);
});

test('a paved sliver gap is road in the ground, and is at most SLIVER_MAX past the facing-gap range', () => {
  const city = regionCity('miami-downtown'), G = groundOf(city), geo = city.roadGeo;
  let stations = 0, wide = 0;
  for (const e of city.edges) {
    if (skip(e) || geo.inner[e.id]) continue;
    const a = city.nodes[e.a], f = G.gapOf(e.id);
    const t0 = geo.trim[2 * e.id], t1 = e.length - geo.trim[2 * e.id + 1];
    for (let i = 1; i < f.length / 2 - 1; i++) {
      const d = Math.min(t1, t0 + i * FILL_STEP), C = curbsAt(geo, e, d);
      for (let side = 0; side < 2; side++) {
        const w = f[2 * i + side];
        if (!(w > 0)) continue;
        stations++;
        if (w > SLIVER_MAX + 0.06) { wide++; continue; }
        // Just past the curb, inside the gap: road, never sidewalk or lawn.
        const o = side ? C.l - Math.min(w * 0.5, 0.3) : C.r + Math.min(w * 0.5, 0.3);
        assert.equal(G.baseAt(a.x + e.ux * d - e.uz * o, a.z + e.uz * d + e.ux * o), 1, `edge ${e.id} at ${d.toFixed(1)} side ${side}`);
      }
    }
  }
  assert.ok(stations > 1000, `${stations} gap stations (${wide} facing gaps)`);
});

test('the gaps do not depend on the order they are asked in (a fresh ground, spot checks first)', () => {
  const city = regionCity('miami-south'), geo = city.roadGeo;
  const A = createGround(city), B = createGround(city);
  const ids = [];
  for (const e of city.edges) if (!skip(e) && !geo.inner[e.id] && e.id % 7 === 0) ids.push(e.id);
  // A asks station by station, backwards; B asks whole edges forwards.
  for (let q = ids.length - 1; q >= 0; q--) {
    const e = city.edges[ids[q]];
    for (let d = e.length - 1; d > 0; d -= 3) { A.gapAt(e.id, 0, d); A.gapAt(e.id, 1, d); }
  }
  for (const id of ids) {
    const fa = A.gapOf(id), fb = B.gapOf(id);
    assert.equal(fa.length, fb.length);
    for (let i = 0; i < fa.length; i++) assert.equal(fa[i], fb[i], `edge ${id} sample ${i}`);
  }
});
