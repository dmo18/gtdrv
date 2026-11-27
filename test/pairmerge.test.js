// One street, one cross section (0.15 roads, docs/ROADS.md WP1):
// world/pairmerge.js collapsePairs on small hand-made graphs, then the
// regions (no fake divided streets, no dead end made, the graph whole).
import test from 'node:test';
import assert from 'node:assert/strict';
import { collapsePairs, COLLAPSE_GAP, BUBBLE_LEN } from '../src/world/pairmerge.js';
import { roadProfile, harmonizeStreets, PARK_W } from '../src/world/roadprofile.js';
import { REGION_IDS, regionCity } from './regionfixture.js';

// A graph builder with the edge fields of miami.js addEdge.
function graph() {
  const nodes = [], edges = [];
  const node = (x, z) => { const n = { id: nodes.length, x, z, edges: [] }; nodes.push(n); return n.id; };
  const edge = (a, b, way) => {
    const P = roadProfile(way), A = nodes[a], B = nodes[b];
    const dx = B.x - A.x, dz = B.z - A.z, length = Math.hypot(dx, dz);
    const e = {
      id: edges.length, a, b, horizontal: Math.abs(dx) >= Math.abs(dz), width: P.width, avenue: false, length,
      ux: dx / length, uz: dz / length, bridge: !!way.bridge, oneway: P.oneway, cls: way.class, name: way.name || '',
      lanesF: P.lanesF, lanesB: P.lanesB, laneW: P.laneW, parkL: P.parkL, parkR: P.parkR, median: 0, center: P.center,
      off: 0, sidewalk: P.sidewalk, ped: P.ped, divided: false, pair: -1, mph: 0, lanesTag: way.lanes || 0,
    };
    edges.push(e);
    A.edges.push(e.id);
    B.edges.push(e.id);
    return e;
  };
  return { nodes, edges, node, edge };
}
// Every edge's ends list it, its length and direction are its nodes'.
function whole(nodes, edges) {
  edges.forEach((e, i) => {
    assert.equal(e.id, i);
    const a = nodes[e.a], b = nodes[e.b];
    assert.ok(a.edges.includes(e.id) && b.edges.includes(e.id), `edge ${i} listed at its nodes`);
    assert.ok(Math.abs(Math.hypot(b.x - a.x, b.z - a.z) - e.length) < 1e-9 && e.length > 0.4, `edge ${i} length`);
    assert.ok(Math.abs(e.ux - (b.x - a.x) / e.length) < 1e-9 && Math.abs(e.uz - (b.z - a.z) / e.length) < 1e-9);
  });
  for (const n of nodes) for (const k of n.edges) assert.ok(edges[k] && (edges[k].a === n.id || edges[k].b === n.id), `node ${n.id} edge ${k}`);
}
const AVE = { class: 'secondary', name: 'Test Avenue' };
const HALF = { class: 'secondary', name: 'Test Avenue', oneway: 1 };
const CROSS = { class: 'residential', name: 'Cross Street' };

// A two-way avenue along x (south of it z +) that splits into two one-way
// halves `gap` m apart (center to center) between x = 0 and x = len, with
// short angled legs at both ends and a cross street meeting each half in
// the middle. Eastbound on the south half (traffic keeps right).
function split(gap, len) {
  const g = graph();
  const w0 = g.node(-100, 0), t0 = g.node(0, 0), t1 = g.node(len, 0), e0 = g.node(len + 100, 0);
  const s0 = g.node(10, gap / 2), sm = g.node(len / 2, gap / 2), s1 = g.node(len - 10, gap / 2);
  const n1 = g.node(len - 10, -gap / 2), nm = g.node(len / 2, -gap / 2), n0 = g.node(10, -gap / 2);
  const cs = g.node(len / 2, 80), cn = g.node(len / 2, -80);
  g.edge(w0, t0, AVE);
  g.edge(t1, e0, AVE);
  g.edge(t0, s0, HALF); g.edge(s0, sm, HALF); g.edge(sm, s1, HALF); g.edge(s1, t1, HALF);
  g.edge(t1, n1, HALF); g.edge(n1, nm, HALF); g.edge(nm, n0, HALF); g.edge(n0, t0, HALF);
  g.edge(sm, cs, CROSS);
  g.edge(nm, cn, CROSS);
  g.edge(sm, nm, CROSS); // the cross street over the median
  return { ...g, t0, t1, sm, nm, cs, cn };
}

test('a short split (a refuge island) is one two-way street; the cross street meets it at one node', () => {
  const g = split(9, 60);
  const st = collapsePairs(g.nodes, g.edges);
  assert.deepEqual([st.runs, st.collapsed], [1, 1]);
  whole(g.nodes, g.edges);
  // No one-way of the avenue is left; the avenue runs t0 -> mid -> t1.
  const ave = g.edges.filter((e) => e.name === 'Test Avenue');
  assert.ok(ave.every((e) => !e.oneway && e.merged !== false), 'two-way');
  assert.equal(ave.length, 4, ave.map((e) => `${e.a}-${e.b}`).join(' '));
  // One node in the middle carries the avenue and both cross street arms,
  // on the avenue's middle line; the median crossing is gone.
  const mid = g.nodes.find((n) => n.edges.length === 4);
  assert.ok(mid && Math.abs(mid.z) < 1e-9 && Math.abs(mid.x - 30) < 1e-9, 'the cross street meets the middle line');
  assert.equal(g.edges.filter((e) => e.name === 'Cross Street').length, 2);
  // Lanes: each half's lanes each way, the class kept.
  for (const e of ave) assert.deepEqual([e.cls, e.lanesF, e.lanesB, e.oneway], ['secondary', 2, 2, false]);
});

test('a true divided road (a wide median over a long run) is kept as it is', () => {
  const g = split(20, 400);
  const before = g.edges.length;
  const st = collapsePairs(g.nodes, g.edges);
  assert.deepEqual([st.runs, st.collapsed, st.kept], [1, 0, 1]);
  assert.equal(g.edges.length, before);
  assert.equal(g.edges.filter((e) => e.oneway).length, 8);
});

test('a tight pair (curb gap under COLLAPSE_GAP m) is one street however long', () => {
  // 7.2 m halves 9 m apart: a 1.8 m gap.
  assert.ok(9 - 7.2 < COLLAPSE_GAP);
  const g = split(9, 3 * BUBBLE_LEN);
  const st = collapsePairs(g.nodes, g.edges);
  assert.equal(st.collapsed, 1);
  whole(g.nodes, g.edges);
  assert.equal(g.edges.filter((e) => e.oneway).length, 0);
});

test('a street that ends in a one-way loop round an island keeps its loop (no dead end made)', () => {
  const g = graph();
  const w0 = g.node(-100, 0), t0 = g.node(0, 0);
  const s0 = g.node(10, 4), s1 = g.node(40, 4), n1 = g.node(40, -4), n0 = g.node(10, -4);
  g.edge(w0, t0, AVE);
  g.edge(t0, s0, HALF); g.edge(s0, s1, HALF); g.edge(s1, n1, { class: 'secondary', name: '', oneway: 1 }); g.edge(n1, n0, HALF); g.edge(n0, t0, HALF);
  const st = collapsePairs(g.nodes, g.edges);
  assert.equal(st.collapsed, 0);
  assert.equal(g.edges.length, 6);
});

test('a street that splits round a triangle island where it meets a cross street ends in one node', () => {
  // A residential street from the north meets a cross street along x in
  // two one-way legs 16 m apart at their ends.
  const R = { class: 'residential', name: 'Leg Road' }, RL = { ...R, oneway: 1 };
  const g = graph();
  const n = g.node(0, -150), t = g.node(0, -30), p = g.node(8, 0), q = g.node(-8, 0);
  const w = g.node(-150, 0), e = g.node(150, 0);
  g.edge(n, t, R);
  g.edge(t, p, RL); // down to the east end
  g.edge(q, t, RL); // back up from the west end
  g.edge(w, q, CROSS); g.edge(q, p, CROSS); g.edge(p, e, CROSS);
  const st = collapsePairs(g.nodes, g.edges);
  assert.equal(st.collapsed, 1);
  whole(g.nodes, g.edges);
  const leg = g.edges.filter((x) => x.name === 'Leg Road');
  assert.ok(leg.every((x) => !x.oneway));
  const end = g.nodes.find((m) => m.edges.length === 3);
  assert.ok(end && Math.abs(end.x) < 1e-9 && Math.abs(end.z) < 1e-9, 'one node where the legs met the cross street');
});

test('harmonizeStreets: a local two-way street parks on one curb, the same side along it; a collector on both', () => {
  const g = graph();
  const a = g.node(0, 0), b = g.node(100, 0), c = g.node(200, 0), d = g.node(300, 0);
  // Edges drawn both ways round: the side must follow the street, not the edge.
  g.edge(a, b, CROSS); g.edge(c, b, CROSS); g.edge(c, d, { class: 'living_street', name: 'Cross Street' });
  harmonizeStreets(g.nodes, g.edges);
  const side = (e) => (e.parkR ? 1 : -1) * (e.ux > 0 ? 1 : -1); // +1: the south curb
  assert.ok(g.edges.every((e) => (e.parkL > 0) + (e.parkR > 0) === 1 && e.width === 9.6), 'one curb, 9.6 m, across the class change');
  assert.equal(new Set(g.edges.map(side)).size, 1, 'one side');
  const t = roadProfile({ class: 'tertiary' });
  assert.deepEqual([t.parkL, t.parkR], [PARK_W, PARK_W]);
});

test('harmonizeStreets: a divided half takes the lanes per direction of the two-way street it splits from', () => {
  const g = graph();
  const a = g.node(-100, 0), t = g.node(0, 0), s = g.node(100, 5), n = g.node(100, -5);
  // A 1 + 1 block (tagged) that splits into untagged halves (2 lanes by
  // class): the halves take 1.
  g.edge(a, t, { class: 'primary', name: 'Wide Way', lanes: 2 });
  g.edge(t, s, { class: 'primary', name: 'Wide Way', oneway: 1 });
  g.edge(n, t, { class: 'primary', name: 'Wide Way', oneway: 1 });
  assert.deepEqual(g.edges.map((e) => e.lanesF), [1, 2, 2]);
  harmonizeStreets(g.nodes, g.edges);
  assert.deepEqual(g.edges.map((e) => e.lanesF), [1, 1, 1]);
  // Halves the data tags keep their own section (the tag says so).
  const h = graph();
  const a2 = h.node(-100, 0), t2 = h.node(0, 0), s2 = h.node(100, 5), n2 = h.node(100, -5);
  h.edge(a2, t2, { class: 'primary', name: 'Wide Way', lanes: 2 });
  h.edge(t2, s2, { class: 'primary', name: 'Wide Way', oneway: 1, lanes: 3 });
  h.edge(n2, t2, { class: 'primary', name: 'Wide Way', oneway: 1, lanes: 3 });
  harmonizeStreets(h.nodes, h.edges);
  assert.deepEqual(h.edges.map((e) => e.lanesF), [1, 3, 3]);
});

test('every region: pairs collapsed, every edge listed at its nodes, few short split legs', () => {
  for (const id of REGION_IDS) {
    const c = regionCity(id);
    const pm = c.graphStats.pairMerge;
    assert.ok(pm && pm.collapsed >= 10, `${id}: ${JSON.stringify(pm)}`);
    for (const e of c.edges) assert.ok(c.nodes[e.a].edges.includes(e.id) && c.nodes[e.b].edges.includes(e.id), `${id} edge ${e.id}`);
    // Short split legs: a one-way under 30 m, paired with nothing, meeting
    // the two-way street of its name (0.14: 30 to 131 a region).
    let legs = 0;
    for (const e of c.edges) {
      if (!e.oneway || e.pair >= 0 || !e.name || e.length >= 30 || e.causeway || e.ped) continue;
      if ([e.a, e.b].some((n) => c.nodes[n].edges.some((k) => !c.edges[k].oneway && c.edges[k].name === e.name))) legs++;
    }
    assert.ok(legs <= 45, `${id}: ${legs} short split legs`);
  }
});
