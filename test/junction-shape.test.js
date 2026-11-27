// Junction shapes for paired and offset arms (0.15 WP2, docs/ROADS.md):
// two halves of one street are one arm (no corner or chevrons between
// them, one mouth line), chevron gores only where two different roads
// part, offset crossings stay two T junctions, lanes line up through a
// junction, and no sidewalk corner piece lies on the crossing. The
// 0.14.1 numbers are in the test names (scripts/road-audit.mjs).
import test from 'node:test';
import assert from 'node:assert/strict';
import { regionCity, REGION_IDS } from './regionfixture.js';
import { ringArea, inJunctionArea, oneStreet, curbsAt, OFFSET_MIN } from '../src/world/junctions.js';
import { divideOf } from '../src/world/roadprofile.js';

const near = (c, x, z, r = 3) => c.nodes.find((n) => Math.hypot(n.x - x, n.z - z) < r);
const junctionAt = (c, x, z) => {
  const n = near(c, x, z, 6);
  assert.ok(n, `a node near ${x}, ${z}`);
  return c.roadGeo.junctions[c.roadGeo.nodeJ[n.id]];
};

test('no chevron gore between two arms of one street (0.14.1: 73)', () => {
  for (const id of REGION_IDS) {
    const c = regionCity(id);
    for (const J of c.roadGeo.junctions) {
      for (const G of J.gores) {
        const a = c.edges[G.qa >> 1], b = c.edges[G.qb >> 1];
        assert.ok(!oneStreet(a, b), `${id} gore at ${Math.round(J.x)}, ${Math.round(J.z)} inside ${a.name}`);
      }
    }
  }
});

test('no sidewalk corner triangle on its own junction\'s asphalt (0.14.1: 363 junctions)', () => {
  for (const id of REGION_IDS) {
    const c = regionCity(id);
    for (const J of c.roadGeo.junctions) {
      for (const C of J.corners) {
        const T = C.tris;
        if (!T) continue;
        for (let k = 0; k + 5 < T.length; k += 6) {
          const x = (T[k] + T[k + 2] + T[k + 4]) / 3, z = (T[k + 1] + T[k + 3] + T[k + 5]) / 3;
          assert.ok(!inJunctionArea(J, x, z), `${id} corner at ${Math.round(x)}, ${Math.round(z)}`);
        }
      }
    }
  }
});

test('oversized junctions: far fewer over 800 m2 (0.14.1: 134) and over 1500 m2 (0.14.1: 38)', () => {
  let o800 = 0, o1500 = 0;
  for (const id of REGION_IDS) {
    for (const J of regionCity(id).roadGeo.junctions) {
      const a = Math.abs(ringArea(J.ring));
      if (a > 800) o800++;
      if (a > 1500) o1500++;
    }
  }
  assert.ok(o800 <= 105, `${o800} over 800 m2`);
  assert.ok(o1500 <= 30, `${o1500} over 1500 m2`);
});

test('Washington Avenue at 7th Street (Beach): one compact crossing, no hull, no gore (0.14.1: 1241 m2)', () => {
  const c = regionCity('miami-beach');
  const J = junctionAt(c, 4645, 320);
  const a = Math.abs(ringArea(J.ring));
  assert.ok(a < 650, `area ${Math.round(a)}`);
  assert.ok(!J.hullRing && !J.fan, 'drawn from its arms with curb returns');
  assert.equal(J.gores.length, 0);
  // Every corner between two different streets has a curb return (more
  // than the two ends of a straight chord).
  let returns = 0;
  for (const C of J.corners) if (C.curb.length > 4) returns++;
  assert.ok(returns >= 4, `${returns} curb returns`);
});

test('a street dividing at a junction: its two halves end on one mouth line', () => {
  let pairs = 0, even = 0;
  for (const id of REGION_IDS) {
    const c = regionCity(id), geo = c.roadGeo, E = c.edges, N = c.nodes;
    for (const J of geo.junctions) {
      const arms = Array.from(J.arms, (q) => {
        const e = E[q >> 1], s = q & 1 ? -1 : 1, n = N[s > 0 ? e.a : e.b];
        return { q, e, end: q & 1, n, ux: e.ux * s, uz: e.uz * s };
      });
      for (let i = 0; i < arms.length; i++) {
        for (let j = i + 1; j < arms.length; j++) {
          const A = arms[i], B = arms[j];
          if (!A.e.oneway || !B.e.oneway || A.end === B.end || !oneStreet(A.e, B.e)) continue;
          if (A.ux * B.ux + A.uz * B.uz < Math.cos((15 * Math.PI) / 180) || A.n !== B.n) continue;
          let cx = A.ux + B.ux, cz = A.uz + B.uz;
          const l = Math.hypot(cx, cz);
          cx /= l; cz /= l;
          const along = (X) => {
            const t = geo.trim[X.q];
            return (X.ux * cx + X.uz * cz) * t;
          };
          pairs++;
          if (Math.abs(along(A) - along(B)) < 1.5) even++;
        }
      }
    }
  }
  assert.ok(pairs > 100, `${pairs} pairs`);
  assert.ok(even / pairs > 0.9, `${even} of ${pairs} on one mouth line`);
});

test('offset crossing, NW 27th Street (Downtown): two T junctions with a curbed block between', () => {
  const c = regionCity('miami-downtown'), geo = c.roadGeo;
  // The two T nodes, 21.6 m apart along the north-south street.
  const a = near(c, -2322, -2451, 12), b = c.nodes.find((n) => n !== a && n.edges.length === 3 && Math.hypot(n.x - a.x, n.z - a.z) < 25 && Math.hypot(n.x + 2322, n.z + 2441) < 15);
  assert.ok(a && b, 'both T nodes');
  assert.ok(Math.hypot(a.x - b.x, a.z - b.z) > OFFSET_MIN);
  assert.notEqual(geo.nodeJ[a.id], geo.nodeJ[b.id], 'two junctions');
  const e = c.edges.find((f) => (f.a === a.id && f.b === b.id) || (f.a === b.id && f.b === a.id));
  assert.ok(e && !geo.inner[e.id], 'the block between them is a strip');
});

test('one-way lanes through a junction: few divide jumps the code makes (0.14.1: 102)', () => {
  const RUN = Math.cos((35 * Math.PI) / 180);
  let added = 0, through = 0;
  for (const id of REGION_IDS) {
    const c = regionCity(id), geo = c.roadGeo, E = c.edges, N = c.nodes;
    const mid = (q) => {
      const e = E[q >> 1], d = q & 1 ? e.length - geo.trim[q] : geo.trim[q], C = curbsAt(geo, e, d);
      const base = (e.off || 0) + geo.eoff[e.id] - e.width / 2;
      const o = C.l + ((divideOf(e) + geo.eoff[e.id] - base) * (C.r - C.l)) / e.width, n = N[q & 1 ? e.b : e.a];
      return [n.x - e.uz * o, n.z + e.ux * o];
    };
    for (const J of geo.junctions) {
      for (const p of J.arms) {
        for (const q of J.arms) {
          if (p >= q) continue;
          const e = E[p >> 1], f = E[q >> 1];
          if (!e.oneway || !f.oneway || !e.name || e.name !== f.name || (p & 1) === (q & 1)) continue;
          if (e.lanesF === undefined || e.causeway || e.ped || f.causeway || f.ped) continue;
          const se = p & 1 ? -1 : 1, sf = q & 1 ? -1 : 1;
          if (-(e.ux * se * f.ux * sf + e.uz * se * f.uz * sf) < RUN) continue;
          const rx = -e.uz * se, rz = e.ux * se, na = N[p & 1 ? e.b : e.a], nb = N[q & 1 ? f.b : f.a];
          if (Math.abs((nb.x - na.x) * rx + (nb.z - na.z) * rz) > 1) continue;
          through++;
          const A = mid(p), B = mid(q);
          if (Math.abs((B[0] - A[0]) * rx + (B[1] - A[1]) * rz) > 1) added++;
        }
      }
    }
  }
  assert.ok(through > 300, `${through} through`);
  assert.ok(added <= 60, `${added} divide jumps`);
});
