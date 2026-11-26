// Road cross sections (docs/PLAN_V3.md 2.1 items 3 to 7, acceptance item 3
// of section 6; the edge contract in docs/MAP.md): world/roadprofile.js on
// its own, then every edge of every Miami region.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  roadProfile, profileWidth, profileLaneOffset, divideOf, paintLines, pairDivided, laneCaps,
  LANE_W, LANE_W_FAST, PARK_W, GUTTER, MAX_UNTAGGED_W, MEDIAN_MIN,
} from '../src/world/roadprofile.js';
import { laneOffset, lanesPerDirection, lanePoint, canDrive, generateCity } from '../src/world/citygen.js';
import { createMiamiCity } from '../src/world/miami.js';
import { REGION_IDS } from '../src/world/regions.js';

const near = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps;

test('the profile of a way: US lane widths, parking, gutters (the plan\'s worked examples)', () => {
  // A two-way residential street: 2 x 3.3 + 2 x 2.4 + 0.6 = 12.0 m.
  const res = roadProfile({ class: 'residential' });
  assert.deepEqual([res.lanesF, res.lanesB, res.laneW, res.parkL, res.parkR, res.width], [1, 1, LANE_W, PARK_W, PARK_W, 12]);
  assert.equal(res.sidewalk, 1.8);
  // Without parking (a bridge): 7.2 m.
  assert.equal(roadProfile({ class: 'residential', bridge: 1 }).width, 7.2);
  // A one-way downtown street of 3 lanes: 10.5 m.
  const dt = roadProfile({ class: 'primary', oneway: 1, lanes: 3 }, { district: 'downtown' });
  assert.deepEqual([dt.lanesF, dt.lanesB, dt.width, dt.sidewalk], [3, 0, 10.5, 3]);
  // By class when untagged.
  assert.deepEqual(['tertiary', 'secondary', 'primary', 'trunk', 'motorway', 'living_street', 'unclassified'].map((c) => {
    const p = roadProfile({ class: c });
    return [p.lanesF, p.lanesB];
  }), [[1, 1], [2, 2], [2, 2], [2, 2], [3, 3], [1, 1], [1, 1]]);
  assert.equal(roadProfile({ class: 'residential', oneway: 1 }).lanesF, 1);
  assert.equal(roadProfile({ class: 'secondary', oneway: 1 }).lanesF, 2);
  assert.equal(roadProfile({ class: 'motorway', oneway: 1 }).lanesF, 3);
  assert.equal(roadProfile({ class: 'primary_link', oneway: 1 }).lanesF, 1);
  // 3.6 m (12 ft) on trunk and motorway, 3.3 m (11 ft) elsewhere.
  assert.equal(roadProfile({ class: 'trunk' }).laneW, LANE_W_FAST);
  assert.equal(roadProfile({ class: 'motorway_link', oneway: 1 }).laneW, LANE_W_FAST);
  assert.equal(roadProfile({ class: 'secondary' }).laneW, LANE_W);
  // Parking only on residential and tertiary streets.
  for (const c of ['secondary', 'primary', 'trunk', 'unclassified']) assert.equal(roadProfile({ class: c }).parkL, 0, c);
  assert.equal(roadProfile({ class: 'tertiary' }).parkR, PARK_W);
  // The tag wins: lanes, lanes:forward and lanes:backward; an odd count
  // on a two-way road is a center turn lane.
  assert.deepEqual((({ lanesF, lanesB, center }) => [lanesF, lanesB, center])(roadProfile({ class: 'primary', lanes: 4 })), [2, 2, 0]);
  assert.deepEqual((({ lanesF, lanesB, center }) => [lanesF, lanesB, center])(roadProfile({ class: 'primary', lanes: 5 })), [2, 2, LANE_W]);
  // (0.13.7: a two-way road is equal each way; the odd lane of 2 + 1 is the
  // center turn lane, everywhere, not only on the Beach.)
  assert.deepEqual((({ lanesF, lanesB, center }) => [lanesF, lanesB, center])(roadProfile({ class: 'primary', lanes: 3, lf: 2, lb: 1 })), [1, 1, LANE_W]);
  assert.equal(roadProfile({ class: 'secondary', oneway: 1, lanes: 4 }).lanesF, 3); // 0.13.7: an arterial one-way has 3 at most
  assert.equal(roadProfile({ class: 'trunk', oneway: 1, lanes: 4 }).lanesF, 4);
  // Pedestrian streets (Lincoln Road Mall, Espanola Way): paving, wide walks.
  const mall = roadProfile({ class: 'pedestrian', name: 'Lincoln Road', mall: 1 });
  assert.ok(mall.ped && mall.parkL === 0 && mall.sidewalk === 3);
  assert.ok(roadProfile({ class: 'residential', name: 'Española Way' }).ped);
});

test('lane offsets: right of the divide, inner lane first; one-ways centered on their line', () => {
  const two = { ...roadProfile({ class: 'secondary' }), off: 0 };
  assert.ok(near(divideOf(two), 0));
  assert.ok(near(profileLaneOffset(two, 0, true), LANE_W / 2) && near(profileLaneOffset(two, 1, true), LANE_W * 1.5));
  assert.ok(near(profileLaneOffset(two, 0, false), LANE_W / 2));
  const one = { ...roadProfile({ class: 'residential', oneway: 1, lanes: 2 }), off: 0 };
  // Centered: the lanes span the middle of the curb-to-curb width.
  assert.ok(near(profileLaneOffset(one, 0, true) + profileLaneOffset(one, 1, true), 0, 1e-9));
  // An island edge keeps its old lanes exactly (2.0, 2.6, 6.1 m).
  const island = generateCity();
  const st = island.edges.find((e) => !e.avenue), av = island.edges.find((e) => e.avenue);
  assert.ok(near(laneOffset(st, 0), 2.0, 1e-9) && near(laneOffset(av, 0), 2.6, 1e-9) && near(laneOffset(av, 1), 6.1, 1e-9));
  assert.ok(near(laneOffset(av, 0, false), 2.6, 1e-9) && lanesPerDirection(av) === 2 && lanesPerDirection(st, false) === 1);
  for (const e of island.edges) assert.ok(near(profileWidth(e), e.width, 1e-9), 'island width = profile sum');
  // Old edges without the fields keep the old rule.
  assert.equal(laneOffset({ avenue: true }, 1), 6.1);
  assert.equal(laneOffset({ avenue: false }), 2.0);
  // canDrive: one-ways only from a.
  assert.ok(canDrive({ oneway: true, a: 1, b: 2 }, 1) && !canDrive({ oneway: true, a: 1, b: 2 }, 2) && canDrive({ oneway: false, a: 1, b: 2 }, 2));
});

test('US paint: double yellow on two-way roads, yellow left and white right on one-ways', () => {
  const out = [];
  const kinds = (p) => { paintLines({ ...p, off: 0 }, out); const k = []; for (let i = 1; i < out.length; i += 2) k.push(out[i]); return k; };
  assert.deepEqual(kinds(roadProfile({ class: 'residential' })).sort(), ['park', 'park', 'yellow2']);
  assert.deepEqual(kinds(roadProfile({ class: 'secondary' })).sort(), ['dash', 'dash', 'white', 'white', 'yellow2']);
  assert.deepEqual(kinds(roadProfile({ class: 'primary', oneway: 1, lanes: 3 })).sort(), ['dash', 'dash', 'white', 'yellow']);
  assert.deepEqual(kinds(roadProfile({ class: 'primary', lanes: 5 })).filter((k) => k === 'turn').length, 2);
  assert.deepEqual(kinds(roadProfile({ class: 'pedestrian', name: 'Lincoln Road', mall: 1 })), []);
  // The double yellow sits on the divide, right of it is the forward traffic.
  const p = { ...roadProfile({ class: 'tertiary' }), off: 0 };
  paintLines(p, out);
  assert.equal(out[out.indexOf('yellow2') - 1], divideOf(p));
});

test('divided roads: opposite one-ways of one name pair up; a gap under 1 m is one road', () => {
  // Two east-west carriageways, westbound on the north (z -), eastbound south.
  const mk = (gapZ) => {
    const nodes = [{ x: 0, z: 0 }, { x: 200, z: 0 }, { x: 200, z: -gapZ }, { x: 0, z: -gapZ }];
    const P = roadProfile({ class: 'secondary', oneway: 1 });
    const e = (id, a, b, ux) => ({ id, a, b, ux, uz: 0, length: 200, name: 'Fifth', ...P, off: 0, median: 0 });
    const edges = [e(0, 0, 1, 1), e(1, 2, 3, -1)];
    const all = (x, z, r, out) => { out.length = 0; out.push(0, 1); return out; };
    pairDivided(nodes, edges, all);
    return edges;
  };
  const wide = mk(16);
  assert.ok(wide[0].divided && wide[0].pair === 1 && wide[1].pair === 0);
  assert.ok(near(wide[0].median, 16 - 7.2, 1e-6) && wide[0].median >= MEDIAN_MIN && wide[0].off === 0);
  const tight = mk(7.6);
  assert.equal(tight[0].median, 0);
  // Left curbs on the middle line: off - w / 2 = -gap / 2.
  assert.ok(near(tight[0].off - tight[0].width / 2, -3.8, 0.011));
  // Right-hand traffic: a partner on the right is not paired.
  const wrong = mk(-16);
  assert.ok(!wrong[0].divided && !wrong[1].divided);
});

// Every region, built from its own file.
const cities = {};
for (const id of REGION_IDS) {
  cities[id] = createMiamiCity(JSON.parse(fs.readFileSync(new URL(`../src/world/data/${id}.json`, import.meta.url), 'utf8')), { region: id });
}

test('every edge: width = profile sum, lanes from the tag, no wide untagged road, medians only on pairs', () => {
  const stats = [];
  for (const id of REGION_IDS) {
    const c = cities[id];
    let wide = 0, tagged = 0, median = 0;
    for (const e of c.edges) {
      assert.ok(near(e.width, profileWidth(e), 0.011), `${id} edge ${e.id} width ${e.width} vs ${profileWidth(e)}`);
      assert.ok(e.laneW === LANE_W || e.laneW === LANE_W_FAST, `${id} edge ${e.id} lane width`);
      assert.ok(e.lanesF >= 1 && (e.oneway ? e.lanesB === 0 : e.lanesB >= 1), `${id} edge ${e.id} lanes`);
      // Lanes from the tag (a merged pair carries both carriageways' tags)
      // inside the class's lanes (0.13.7 road logic, laneCaps): a two-way
      // road equal each way, a turn lane only where the class has one.
      const tag = e.lanesTag * (e.merged ? 2 : 1);
      const cap = laneCaps(e.cls);
      if (e.oneway) assert.ok(e.lanesF <= cap[3] && !e.center, `${id} edge ${e.id} ${e.name} ${e.cls}: ${e.lanesF} lanes one-way`);
      else if (!e.causeway) assert.ok(e.lanesF === e.lanesB && e.lanesF <= cap[1] && (!e.center || cap[4]), `${id} edge ${e.id} ${e.name} ${e.cls}: ${e.lanesF} + ${e.lanesB}`);
      if (tag) tagged++;
      if (e.width > MAX_UNTAGGED_W) {
        wide++;
        assert.ok(tag >= 4, `${id} edge ${e.id} ${e.name} ${e.width} m wide, tag ${tag}`);
      }
      if (e.median > 0) {
        median++;
        assert.ok(e.oneway && e.divided && e.pair >= 0 && e.median >= MEDIAN_MIN, `${id} edge ${e.id} median`);
        const o = c.edges[e.pair];
        assert.ok(o.oneway && o.name === e.name && e.ux * o.ux + e.uz * o.uz < -0.85, `${id} edge ${e.id} partner`);
      }
      if (e.off) assert.ok(e.divided && e.median === 0, `${id} edge ${e.id} off only on tight pairs`);
      assert.ok(e.parkL === 0 || e.parkL === PARK_W);
    }
    stats.push(`${id}: ${c.edges.length} edges, ${tagged} tagged, ${wide} over 15 m, ${median} with a median`);
  }
  console.log(stats.join('\n'));
});

test('drivable surfaces do not overlap outside junctions (bridges over roads aside)', () => {
  const out = [];
  for (const id of REGION_IDS) {
    const c = cities[id];
    let samples = 0, bad = 0;
    for (const e of c.edges) {
      const a = c.nodes[e.a], half = e.width / 2, o = e.off || 0;
      for (let d = 25; d < e.length - 25; d += 10) {
        for (const side of [-1, 1]) {
          // 0.5 m inside this strip's curb.
          const lat = o + side * (half - 0.5);
          const x = a.x + e.ux * d - e.uz * lat, z = a.z + e.uz * d + e.ux * lat;
          samples++;
          for (const fid of c.edgesNear(x, z, 0, out)) {
            const f = c.edges[fid];
            if (f === e || f.a === e.a || f.a === e.b || f.b === e.a || f.b === e.b || f.bridge !== e.bridge) continue;
            const fa = c.nodes[f.a], fb = c.nodes[f.b];
            if (Math.hypot(x - fa.x, z - fa.z) < 25 || Math.hypot(x - fb.x, z - fb.z) < 25) continue;
            const t = Math.max(0, Math.min(f.length, (x - fa.x) * f.ux + (z - fa.z) * f.uz));
            const fx = fa.x + f.ux * t - f.uz * (f.off || 0), fz = fa.z + f.uz * t + f.ux * (f.off || 0);
            if (Math.hypot(x - fx, z - fz) <= f.width / 2) { bad++; break; }
          }
        }
      }
    }
    // Measured 2026-11-23: Downtown 0.5 % (the port's one-way service
    // roads on Dodge Island, a slip of Southeast 2nd Street), the others
    // under 0.05 %.
    const share = bad / samples;
    assert.ok(share < (id === 'miami-downtown' ? 0.006 : 0.001), `${id}: ${bad} of ${samples} curb samples inside another road`);
  }
});

test('lanePoint: every lane of every edge lies inside its strip, right of the center line', () => {
  const P = { x: 0, z: 0, heading: 0 };
  for (const id of REGION_IDS) {
    const c = cities[id];
    for (const e of c.edges) {
      for (const fwd of [true, false]) {
        if (!fwd && e.oneway) continue;
        const from = fwd ? e.a : e.b;
        for (let l = 0; l < lanesPerDirection(e, fwd); l++) {
          lanePoint(c, e, from, e.length / 2, l, P);
          const a = c.nodes[e.a];
          const lat = (P.x - a.x) * -e.uz + (P.z - a.z) * e.ux; // right of a -> b
          const off = e.off || 0;
          assert.ok(Math.abs(lat - off) <= e.width / 2 - GUTTER - e.laneW / 2 + 1e-6, `${id} edge ${e.id} lane ${l}`);
          // Right of the divide in the direction of travel.
          const s = divideOf(e);
          if (!e.oneway) assert.ok(fwd ? lat > s : lat < s, `${id} edge ${e.id} keeps right`);
        }
      }
    }
  }
});

test('city.streetAt: the street under a point, the cross street ahead', () => {
  const c = cities['miami-beach'];
  const s = c.streetAt(c.spawn.x, c.spawn.z, undefined, c.spawn.heading);
  assert.equal(s.name, 'Ocean Drive');
  assert.equal(s.cross, '10th Street');
  const out = { edge: -1, name: '', cross: '', d: 0, side: 1 };
  assert.equal(c.streetAt(c.spawn.x, c.spawn.z, out), out, 'fills the given object');
  assert.equal(c.streetAt(6400, 0), null, 'the ocean');
  // Every named edge answers with its own name at its middle.
  let n = 0;
  for (const e of c.edges) {
    if (!e.name || e.length < 20) continue;
    const a = c.nodes[e.a], m = e.length / 2;
    const r = c.streetAt(a.x + e.ux * m - e.uz * (e.off || 0), a.z + e.uz * m + e.ux * (e.off || 0));
    if (r && r.name === e.name) n++;
  }
  const named = c.edges.filter((e) => e.name && e.length >= 20).length;
  assert.ok(n / named > 0.97, `${n} of ${named}`);
});
