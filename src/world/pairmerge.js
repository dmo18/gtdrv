// One street, one cross section (0.15 roads, docs/ROADS.md WP1 item 1).
// OpenStreetMap splits a street into two one-way ways for a refuge
// island, a turn bay or a narrow median, often for 25 to 80 m; drawn as
// it is, each split is two one-way roads with chevrons, stop bars and
// crosswalks mid-street. collapsePairs turns such a pair back into one
// two-way street before anything else reads the graph (harmonizeStreets,
// signals, pairDivided, the junctions):
// - a run of two halves (same name, opposite ways, the other on the left
//   within PAIR_MAX m, as pairDivided pairs them) with its split legs,
//   whose curb gap is under COLLAPSE_GAP m along COLLAPSE_SHARE of it
//   and nowhere MEDIAN_KEEP m or more, or a bubble (both ends on the
//   two-way street of its name) under BUBBLE_LEN m with no stretch of
//   median BUBBLE_GAP m or wider;
// - a leg pair: a two-way street that ends in two short one-way legs of
//   its name round a triangle island at a cross street.
// A true divided road (a wider median over most of a longer run) is kept,
// and so is a run whose collapse would leave a dead end (a street that
// ends in a one-way loop round an island: no U-turn at a dead end) or that
// the graph does not let cut cleanly. Pure logic: runs in node tests.
import { roadProfile, PAIR_MAX } from './roadprofile.js';

// A run whose curb gap is under COLLAPSE_GAP m along COLLAPSE_SHARE of its
// length is one street (today's `off` pairs and sliver medians).
export const COLLAPSE_GAP = 4;
export const COLLAPSE_SHARE = 0.4;
// A bubble (both ends meet the two-way street of its name) shorter than
// BUBBLE_LEN m is one street while its curb gap stays under BUBBLE_GAP m;
// a run of tight halves while its gap stays under MEDIAN_KEEP m (a real
// median, a block-sized island, an interchange).
export const BUBBLE_LEN = 120;
export const BUBBLE_GAP = 8;
export const MEDIAN_KEEP = 11;
// Split legs: unpaired one-way pieces of the same name between a paired
// run and the two-way street (or the other half's leg), this long at most.
export const LEG_MAX = 40;
// Nodes of the two halves this close along the street become one node
// (the two ends of a cross street crossing the median).
export const STATION_TOL = 4;
const PAIR_DOT = -0.85;
const RUN_DOT = Math.cos((50 * Math.PI) / 180);
const LEG_DOT = Math.cos((65 * Math.PI) / 180);
// An outside node this close to the street's new node joins it (up to
// three a run; else the run is kept).
const MIN_EXT = 3;
// A cross street linking two nodes of a run further apart than this along
// it is not a median crossing: the run is kept.
// (An unnamed road or a link across the median, a turn-around, goes with
// the median instead.)
const LINK_SPAN = 15;
const LINKCLS = /_link$/;
const GRID_M = 64;
// A dead end shorter than this left where two one-ways became one road.
const STUB_MAX = 20;
// A bend of a half joins a node this close along the street.
const SHAPE_TOL = 10;
// The far ends of a leg pair at most this far apart.
export const LEG_SPREAD = 25;

const RANK = ['service', 'road', 'living_street', 'unclassified', 'residential', 'tertiary_link', 'tertiary', 'secondary_link', 'secondary', 'primary_link', 'primary', 'trunk_link', 'trunk', 'motorway_link', 'motorway'];
const rankOf = (c) => RANK.indexOf(c);
const isAvenue = (p) => (p.oneway ? p.lanesF >= 3 : Math.min(p.lanesF, p.lanesB) >= 2);
const cand = (e) => !!(e.oneway && e.name && !e.causeway && !e.ped && e.lanesF !== undefined);

// Foot of (x, z) on the polyline of node ids H (cumulative arc S): the
// station, the distance, the foot point and the segment, into FOOT.
const FOOT = { s: 0, d: 0, x: 0, z: 0, k: 0 };
function footOn(nodes, H, S, x, z) {
  let bd = Infinity;
  for (let k = 0; k + 1 < H.length; k++) {
    const a = nodes[H[k]], b = nodes[H[k + 1]];
    const dx = b.x - a.x, dz = b.z - a.z, L = S[k + 1] - S[k];
    let t = L > 0 ? ((x - a.x) * dx + (z - a.z) * dz) / (L * L) : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const fx = a.x + dx * t, fz = a.z + dz * t, d = Math.hypot(x - fx, z - fz);
    if (d < bd) { bd = d; FOOT.s = S[k] + t * L; FOOT.d = d; FOOT.x = fx; FOOT.z = fz; FOOT.k = k; }
  }
  return FOOT;
}

// nodes, edges: the road graph as walkChains made it (miami.js), before
// harmonizeStreets. opts.curb: street names that park on both curbs
// (miami.js bothCurbs). Mutates the graph: the edges of every
// collapsed run are replaced by one two-way chain along the mean of the two
// halves; the nodes of both halves are merged into the chain's nodes by
// station (the cross streets that met either half end on the chain); the
// edge and node arrays are compacted (ids renumbered, node lists
// rewritten; the nodes a collapse left with no edge go).
// Returns { runs, collapsed, kept, legs, made } (made: 1 per edge id on
// the edges a collapse made, after a collapse).
export function collapsePairs(nodes, edges, opts = {}) {
  const curb = opts.curb || [];
  const NE = edges.length;
  const stats = { runs: 0, collapsed: 0, kept: 0, legs: 0 };
  // (Edges a collapse adds get ids from NE on, in newEdges.)
  const newEdges = [];
  const edgeAt = (id) => (id < NE ? edges[id] : newEdges[id - NE]);
  // ---- Edge partners (as pairDivided: same name, opposite, on the left).
  const byName = new Map();
  for (let k = 0; k < NE; k++) {
    const e = edges[k];
    if (!cand(e)) continue;
    let l = byName.get(e.name);
    if (!l) byName.set(e.name, (l = []));
    l.push(k);
  }
  // A grid of the edges (GRID_M m cells, by their boxes), for the near
  // queries below.
  const grid = new Map();
  for (let k = 0; k < NE; k++) {
    const e = edges[k], a = nodes[e.a], b = nodes[e.b];
    const i0 = Math.floor(Math.min(a.x, b.x) / GRID_M), i1 = Math.floor(Math.max(a.x, b.x) / GRID_M);
    const j0 = Math.floor(Math.min(a.z, b.z) / GRID_M), j1 = Math.floor(Math.max(a.z, b.z) / GRID_M);
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const key = i * 100003 + j;
        let l = grid.get(key);
        if (!l) grid.set(key, (l = []));
        l.push(k);
      }
    }
  }
  // The edge ids whose cells lie within r m of (x, z), each once, into out.
  const seenQ = new Int32Array(NE);
  let qMark = 0;
  const nearIds = (x, z, r, out) => {
    out.length = 0;
    qMark++;
    for (let j = Math.floor((z - r) / GRID_M); j <= Math.floor((z + r) / GRID_M); j++) {
      for (let i = Math.floor((x - r) / GRID_M); i <= Math.floor((x + r) / GRID_M); i++) {
        const l = grid.get(i * 100003 + j);
        if (!l) continue;
        for (let q = 0; q < l.length; q++) if (seenQ[l[q]] !== qMark) { seenQ[l[q]] = qMark; out.push(l[q]); }
      }
    }
    return out;
  };
  const NEAR = [];
  const partner = new Int32Array(NE).fill(-1);
  for (const list of byName.values()) {
    if (list.length < 2) continue;
    for (let i = 0; i < list.length; i++) {
      const e = edges[list[i]], a = nodes[e.a], b = nodes[e.b];
      const mx = (a.x + b.x) / 2, mz = (a.z + b.z) / 2;
      let best = -1, bd = Infinity;
      nearIds(mx, mz, PAIR_MAX, NEAR);
      for (let j = 0; j < NEAR.length; j++) {
        const o = edges[NEAR[j]];
        if (o === e || !cand(o) || o.name !== e.name) continue;
        if (e.ux * o.ux + e.uz * o.uz > PAIR_DOT) continue;
        const oa = nodes[o.a];
        const t = (mx - oa.x) * o.ux + (mz - oa.z) * o.uz;
        if (t < -2 || t > o.length + 2) continue;
        const lat = (oa.x + o.ux * t - mx) * -e.uz + (oa.z + o.uz * t - mz) * e.ux;
        if (lat >= 0 || -lat > PAIR_MAX) continue;
        if (-lat < bd || (-lat === bd && o.id < best)) { bd = -lat; best = o.id; }
      }
      partner[list[i]] = best;
    }
  }
  // ---- Chain continuity: the straightest one-way of the name leaving
  // where an edge arrives (mutual).
  const nextOf = new Int32Array(NE).fill(-1), prevOf = new Int32Array(NE).fill(-1);
  const turnDot = new Float64Array(NE);
  for (let k = 0; k < NE; k++) {
    const e = edges[k];
    if (!cand(e)) continue;
    const n = nodes[e.b];
    let best = -1, bc = LEG_DOT;
    for (let q = 0; q < n.edges.length; q++) {
      const f = edges[n.edges[q]];
      if (f === e || !cand(f) || f.a !== e.b || f.name !== e.name) continue;
      const c = e.ux * f.ux + e.uz * f.uz;
      if (c >= bc) { bc = c; best = f.id; }
    }
    if (best >= 0) { nextOf[k] = best; turnDot[k] = bc; }
  }
  for (let k = 0; k < NE; k++) {
    const f = nextOf[k];
    if (f < 0) continue;
    if (prevOf[f] < 0) prevOf[f] = k;
    else nextOf[k] = -1; // two edges run into one: neither continues (a merge, not a street)
  }
  for (let k = 0; k < NE; k++) if (nextOf[k] >= 0 && prevOf[nextOf[k]] !== k) nextOf[k] = -1;
  // ---- Runs: paired edges joined to their partners and along their chain.
  const uf = new Int32Array(NE);
  for (let k = 0; k < NE; k++) uf[k] = k;
  const find = (v) => { while (uf[v] !== v) { uf[v] = uf[uf[v]]; v = uf[v]; } return v; };
  const join = (p, q) => { const a = find(p), b = find(q); if (a !== b) uf[a] = b; };
  const inRun = new Uint8Array(NE);
  for (let k = 0; k < NE; k++) {
    if (partner[k] < 0) continue;
    inRun[k] = 1;
    join(k, partner[k]);
    const f = nextOf[k];
    if (f >= 0 && partner[f] >= 0 && turnDot[k] >= RUN_DOT) join(k, f);
  }
  // Split legs: from a paired edge back (or on) through unpaired one-ways
  // of the name, under LEG_MAX m in all, to a node with the two-way street
  // of the name or the other half's leg.
  const sameTwoWay = (nid, name) => {
    const l = nodes[nid].edges;
    for (let q = 0; q < l.length; q++) { const f = edgeAt(l[q]); if (!f.oneway && f.name === name && !f.causeway) return true; }
    return false;
  };
  // Another one-way of the name at node nid running the other sense (into
  // it when out is true: the other half's leg arriving where this one leaves).
  const otherLeg = (nid, e, out) => {
    const l = nodes[nid].edges;
    for (let q = 0; q < l.length; q++) {
      const f = edgeAt(l[q]);
      if (f === e || !cand(f) || f.name !== e.name) continue;
      if (out ? f.b === nid : f.a === nid) return true;
    }
    return false;
  };
  const legBuf = [];
  for (let k = 0; k < NE; k++) {
    if (partner[k] < 0) continue;
    for (let dir = 0; dir < 2; dir++) {
      legBuf.length = 0;
      let len = 0, cur = dir ? nextOf[k] : prevOf[k], ok = false;
      while (cur >= 0 && partner[cur] < 0 && !inRun[cur]) {
        const c = edges[cur];
        len += c.length;
        if (len >= LEG_MAX) break;
        legBuf.push(cur);
        const T = dir ? c.b : c.a;
        if (sameTwoWay(T, c.name) || otherLeg(T, c, !dir)) { ok = true; break; }
        cur = dir ? nextOf[cur] : prevOf[cur];
      }
      if (!ok) continue;
      for (const q of legBuf) { inRun[q] = 2; join(q, k); stats.legs++; }
    }
  }
  // Leg pairs: a two-way street that ends in two short one-way legs of its
  // name, one out and one back, whose far ends lie close (a triangle island
  // where it meets a cross street).
  const legMate = new Int32Array(NE).fill(-1);
  const freeLeg = (e) => cand(e) && !inRun[e.id] && partner[e.id] < 0 && e.length < LEG_MAX;
  for (const n of nodes) {
    const l = n.edges;
    for (let q = 0; q < l.length; q++) {
      const e = edges[l[q]];
      if (!freeLeg(e) || e.a !== n.id || nextOf[e.id] >= 0 || legMate[e.id] >= 0 || !sameTwoWay(n.id, e.name)) continue;
      let best = -1, bc = LEG_DOT;
      for (let r = 0; r < l.length; r++) {
        const f = edges[l[r]];
        if (f === e || !freeLeg(f) || f.b !== n.id || f.name !== e.name || prevOf[f.id] >= 0 || legMate[f.id] >= 0) continue;
        const P = nodes[e.b], Q = nodes[f.a];
        if (P === Q || Math.hypot(P.x - Q.x, P.z - Q.z) > LEG_SPREAD) continue;
        const c = -(e.ux * f.ux + e.uz * f.uz);
        if (c > bc) { bc = c; best = f.id; }
      }
      if (best < 0) continue;
      legMate[e.id] = best;
      legMate[best] = e.id;
      inRun[e.id] = inRun[best] = 2;
      join(e.id, best);
      stats.legs += 2;
    }
  }
  // Two runs meeting at a node are one run (the halves of one street that
  // cross or touch), unless the node is on the two-way street of the name
  // (two bubbles in a row meet at the two-way node between them).
  for (const n of nodes) {
    const l = n.edges;
    let first = -1;
    for (let q = 0; q < l.length; q++) {
      const k = l[q];
      if (!inRun[k]) continue;
      if (first < 0) { first = k; continue; }
      if (find(k) !== find(first) && edges[k].name === edges[first].name && !sameTwoWay(n.id, edges[k].name)) join(k, first);
    }
  }
  // ---- Each run: two halves (parity along partners), each one path.
  const members = new Map();
  for (let k = 0; k < NE; k++) {
    if (!inRun[k]) continue;
    const r = find(k);
    let l = members.get(r);
    if (!l) members.set(r, (l = []));
    l.push(k);
  }
  const dead = new Uint8Array(2 * NE + 16);
  const half = new Int8Array(NE).fill(-1);
  const itemOf = new Int32Array(nodes.length).fill(-1);
  const moved = new Uint8Array(nodes.length);
  const deg0 = new Int32Array(nodes.length);
  for (let k = 0; k < nodes.length; k++) deg0[k] = nodes[k].edges.length;
  for (const list of members.values()) {
    stats.runs++;
    if (collapseRun(list)) stats.collapsed++;
    else stats.kept++;
  }
  function collapseRun(list) {
    // Halves by parity: partners opposite, chain neighbors alike.
    half[list[0]] = 0;
    const queue = [list[0]];
    for (let qi = 0; qi < queue.length; qi++) {
      const k = queue[qi], h = half[k];
      const nb = [partner[k], 1 - h, nextOf[k], h, prevOf[k], h, legMate[k], 1 - h];
      for (let t = 0; t < 8; t += 2) {
        const o = nb[t];
        if (o < 0 || !inRun[o] || find(o) !== find(k)) continue;
        if (half[o] < 0) { half[o] = nb[t + 1]; queue.push(o); } else if (half[o] !== nb[t + 1]) return false;
      }
    }
    if (queue.length !== list.length) return false;
    const H = [[], []];
    for (const k of list) H[half[k]].push(k);
    if (!H[0].length || !H[1].length) return false;
    // Each half one path, in its own direction (edges, then nodes).
    const P = [null, null], S = [null, null], EH = [null, null];
    for (let h = 0; h < 2; h++) {
      let start = -1;
      for (const k of H[h]) {
        const p = prevOf[k];
        if (p < 0 || !inRun[p] || find(p) !== find(k)) { if (start >= 0) return false; start = k; }
      }
      if (start < 0) return false;
      const path = [start];
      for (let k = nextOf[start]; k >= 0 && inRun[k] && find(k) === find(start) && path.length <= H[h].length; k = nextOf[k]) path.push(k);
      if (path.length !== H[h].length) return false;
      const ns = [edges[path[0]].a], arc = [0];
      for (const k of path) { ns.push(edges[k].b); arc.push(arc[arc.length - 1] + edges[k].length); }
      P[h] = ns; S[h] = arc; EH[h] = path;
    }
    // Half 0 is the forward half (A), half 1 runs the other way (B).
    const A = P[0], B = P[1], SA = S[0], SB = S[1];
    // A run whose inner nodes an earlier collapse moved is kept as it is
    // (its ends may have moved: two streets' splits meeting at one place).
    for (let h = 0; h < 2; h++) for (let i = 1; i + 1 < P[h].length; i++) if (moved[P[h][i]]) return false;
    const lenA = SA[SA.length - 1], lenB = SB[SB.length - 1];
    // ---- Gap along the run (curb to curb, the inner parking lane left out
    // as pairDivided leaves it out).
    const wIn = (e) => e.width - e.parkL;
    let near = 0, all = 0, maxGap = 0;
    for (let h = 0; h < 2; h++) {
      const own = EH[h], O = P[1 - h], OS = S[1 - h], OE = EH[1 - h];
      for (const k of own) {
        const e = edges[k], a = nodes[e.a], b = nodes[e.b];
        const f = footOn(nodes, O, OS, (a.x + b.x) / 2, (a.z + b.z) / 2);
        const gap = f.d - (wIn(e) + wIn(edges[OE[f.k]])) / 2;
        all += e.length;
        if (gap < COLLAPSE_GAP) near += e.length;
        if (inRun[k] === 1 && gap > maxGap) maxGap = gap;
      }
    }
    const closed = (p, q) => p === q || (sameTwoWay(p, edges[list[0]].name) && sameTwoWay(q, edges[list[0]].name));
    const bubble = closed(A[0], B[B.length - 1]) && closed(A[A.length - 1], B[0]) && (lenA + lenB) / 2 < BUBBLE_LEN;
    let legsOnly = true;
    for (const k of list) if (partner[k] >= 0) legsOnly = false;
    // (A bubble with no stretch of median BUBBLE_GAP m or wider; a run of
    // mostly tight halves with none MEDIAN_KEEP m or wider: a real median.)
    if (!(legsOnly || (bubble && maxGap < BUBBLE_GAP) || (near >= COLLAPSE_SHARE * all && maxGap < MEDIAN_KEEP))) return false;
    // ---- Stations: every node of both halves on half A's line, at the
    // middle between it and its foot on the other half.
    const inA = new Set(A), itN = [], itS = [], itX = [], itZ = [], itShared = [];
    for (let i = 0; i < A.length; i++) {
      const n = nodes[A[i]];
      const shared = B.includes(A[i]);
      const f = footOn(nodes, B, SB, n.x, n.z);
      itN.push(A[i]); itS.push(SA[i]); itShared.push(shared);
      itX.push(shared ? n.x : (n.x + f.x) / 2); itZ.push(shared ? n.z : (n.z + f.z) / 2);
    }
    for (let i = 0; i < B.length; i++) {
      if (inA.has(B[i])) continue;
      const n = nodes[B[i]];
      const f = footOn(nodes, A, SA, n.x, n.z);
      itN.push(B[i]); itS.push(f.s); itShared.push(false);
      itX.push((n.x + f.x) / 2); itZ.push((n.z + f.z) / 2);
    }
    const m = itN.length;
    // (A node twice: a loop; kept as it is.)
    if (new Set(itN).size !== m) return false;
    for (let i = 0; i < m; i++) itemOf[itN[i]] = i;
    const clear = () => { for (let i = 0; i < itN.length; i++) itemOf[itN[i]] = -1; };
    const order = Array.from({ length: m }, (_, i) => i).sort((p, q) => itS[p] - itS[q] || itN[p] - itN[q]);
    const pos = new Int32Array(m);
    for (let p = 0; p < m; p++) pos[order[p]] = p;
    const cu = new Int32Array(m);
    for (let i = 0; i < m; i++) cu[i] = i;
    const cf = (v) => { while (cu[v] !== v) { cu[v] = cu[cu[v]]; v = cu[v]; } return v; };
    const cj = (p, q) => { const a = cf(p), b = cf(q); if (a !== b) cu[a] = b; };
    const runEdge = (g) => g < NE && inRun[g] && find(g) === find(list[0]);
    const drop = [];
    // A shape node (a bend of a half: no edge but the run's) joins a node
    // within SHAPE_TOL m of it along the street.
    const shape = new Uint8Array(m);
    for (let i = 0; i < m; i++) {
      let only = 1;
      for (const k of nodes[itN[i]].edges) if (!runEdge(k)) only = 0;
      shape[i] = only;
    }
    for (let p = 1; p < m; p++) {
      const i = order[p], j = order[p - 1];
      if (itS[i] - itS[j] < (shape[i] || shape[j] ? SHAPE_TOL : STATION_TOL)) cj(i, j);
    }
    // The two ends of the halves are one end of the street.
    const endA0 = itemOf[A[0]], endA1 = itemOf[A[A.length - 1]], endB0 = itemOf[B[0]], endB1 = itemOf[B[B.length - 1]];
    if (legsOnly || Math.abs(itS[endA0] - itS[endB1]) < 2 * STATION_TOL) cj(endA0, endB1);
    if (legsOnly || Math.abs(itS[endA1] - itS[endB0]) < 2 * STATION_TOL) cj(endA1, endB0);
    for (let i = 0; i < m; i++) {
      const l = nodes[itN[i]].edges;
      for (let q = 0; q < l.length; q++) {
        const g = edgeAt(l[q]);
        if (runEdge(g.id)) continue;
        const o = itemOf[g.a === itN[i] ? g.b : g.a];
        if (o < 0) continue;
        if (Math.abs(itS[o] - itS[i]) > LINK_SPAN) {
          // An unnamed link or ramp across the median from one half to the
          // other (a turn-around): it goes with the median.
          const crosses = inA.has(itN[i]) !== inA.has(itN[o]) && !itShared[i] && !itShared[o];
          if (crosses && (!g.name || LINKCLS.test(g.cls))) { if (!drop.includes(g.id)) drop.push(g.id); continue; }
          clear();
          return false;
        }
        cj(i, o);
      }
    }
    // Clusters contiguous along the street.
    const maxPos = new Int32Array(m).fill(-1);
    for (let i = 0; i < m; i++) { const r = cf(i); if (pos[i] > maxPos[r]) maxPos[r] = pos[i]; }
    const clusterOf = new Array(m).fill(0);
    let nc = -1, reach = -1;
    for (let p = 0; p < m; p++) {
      if (p > reach) nc++;
      clusterOf[order[p]] = nc;
      const r = maxPos[cf(order[p])];
      if (r > reach) reach = r;
    }
    nc++;
    // Each cluster: its node (a node both halves share, else the lowest id)
    // and its point (that node's, else the mean of the middles).
    // (Rank of a member: 2 shared by both halves, 1 a node with outside
    // edges, 0 a shape node; the cluster takes its highest-ranked members.)
    const rep = new Int32Array(nc).fill(-1), cx = new Float64Array(nc), cz = new Float64Array(nc), cnt = new Int32Array(nc), top = new Int8Array(nc).fill(-1);
    for (let i = 0; i < m; i++) {
      const c = clusterOf[i], r = itShared[i] ? 2 : shape[i] ? 0 : 1;
      if (r > top[c]) { top[c] = r; rep[c] = itN[i]; cx[c] = 0; cz[c] = 0; cnt[c] = 0; }
      if (r < top[c]) continue;
      if (r < 2 && itN[i] < rep[c]) rep[c] = itN[i];
      cx[c] += itX[i]; cz[c] += itZ[i]; cnt[c]++;
    }
    for (let c = 0; c < nc; c++) { cx[c] /= cnt[c]; cz[c] /= cnt[c]; }
    // An end where the two halves meet a cross street at two nodes: the
    // node between them, on the cross street.
    for (let t = 0; t < 2; t++) {
      const i = t ? endA1 : endA0, j = t ? endB0 : endB1, c = clusterOf[i];
      if (i === j || c !== clusterOf[j] || top[c] === 2) continue;
      const a = nodes[itN[i]], b = nodes[itN[j]];
      cx[c] = (a.x + b.x) / 2;
      cz[c] = (a.z + b.z) / 2;
    }
    // ---- Check the outside edges before changing anything: none left
    // under MIN_EXT m, no two between the same nodes.
    const ext = [], seenPair = new Map(), twin = [];
    const endOf = (nid) => { const i = itemOf[nid]; return i < 0 ? nid : rep[clusterOf[i]]; };
    const xOf = (nid) => { const i = itemOf[nid]; return i < 0 ? nodes[nid].x : cx[clusterOf[i]]; };
    const zOf = (nid) => { const i = itemOf[nid]; return i < 0 ? nodes[nid].z : cz[clusterOf[i]]; };
    let absorbed = 0;
    for (let i = 0; i < itN.length; i++) {
      const l = nodes[itN[i]].edges;
      for (let q = 0; q < l.length; q++) {
        const g = edgeAt(l[q]);
        if (runEdge(g.id) || dead[g.id] || ext.includes(g.id) || drop.includes(g.id)) continue;
        const na = endOf(g.a), nb = endOf(g.b);
        if (na === nb) { ext.push(g.id); continue; } // a median crossing: dropped
        const L = Math.hypot(xOf(g.b) - xOf(g.a), zOf(g.b) - zOf(g.a));
        const key = na < nb ? na * 1e7 + nb : nb * 1e7 + na;
        if (L < MIN_EXT) {
          // A node just off the street ends up on its node: it joins the
          // node (its edges with it), and the check starts again.
          const out = itemOf[g.a] < 0 ? g.a : itemOf[g.b] < 0 ? g.b : -1;
          if (out < 0 || ++absorbed > 3 || nodes[out].edges.some((k) => k < NE && inRun[k])) { clear(); return false; }
          itemOf[out] = itN.length;
          clusterOf.push(clusterOf[itemOf[g.a === out ? g.b : g.a]]);
          itN.push(out);
          ext.length = 0;
          seenPair.clear();
          twin.length = 0;
          i = -1;
          break;
        }
        if (seenPair.has(key)) {
          // The two one-ways of a cross street (its own split) now between
          // the same two nodes, opposite: one two-way road (as addEdge).
          const h = edgeAt(seenPair.get(key));
          if (!g.oneway || !h.oneway || g.name !== h.name || endOf(g.a) !== endOf(h.b) || twin.includes(h.id)) { clear(); return false; }
          twin.push(h.id, g.id);
        } else seenPair.set(key, g.id);
        ext.push(g.id);
      }
    }
    for (let c = 0; c + 1 < nc; c++) {
      const key = rep[c] < rep[c + 1] ? rep[c] * 1e7 + rep[c + 1] : rep[c + 1] * 1e7 + rep[c];
      if (seenPair.has(key) || Math.hypot(cx[c + 1] - cx[c], cz[c + 1] - cz[c]) < 0.5) { clear(); return false; }
    }
    // No dead end made: a street that ends in a one-way loop round an
    // island (a turnaround) keeps its loop (no U-turn at a dead end).
    const deg = new Int32Array(nc);
    for (let c = 0; c + 1 < nc; c++) { deg[c]++; deg[c + 1]++; }
    for (const id of ext) {
      const g = edgeAt(id), na = endOf(g.a), nb = endOf(g.b);
      if (na === nb || twin.indexOf(id) % 2 === 1) continue;
      if (itemOf[g.a] >= 0) deg[clusterOf[itemOf[g.a]]]++;
      if (itemOf[g.b] >= 0) deg[clusterOf[itemOf[g.b]]]++;
    }
    // (Where the halves ended in dead ends already, at the edge of the
    // crop, one road end is fine.)
    const wasEnd = new Uint8Array(nc).fill(1);
    for (let i = 0; i < m; i++) if (deg0[itN[i]] !== 1) wasEnd[clusterOf[i]] = 0;
    for (let c = 0; c < nc; c++) if (deg[c] < 2 && !wasEnd[c]) { clear(); return false; }
    // No other road under the new one: a road (a ramp, a link) running
    // along the street within its width keeps the pair as it is.
    for (let c = 0; c + 1 < nc; c++) {
      const dx = cx[c + 1] - cx[c], dz = cz[c + 1] - cz[c], L = Math.hypot(dx, dz);
      for (let t = 0.25; t < 1; t += 0.25) {
        const px = cx[c] + dx * t, pz = cz[c] + dz * t;
        nearIds(px, pz, 30, NEAR);
        for (let q = 0; q < NEAR.length; q++) {
          const k = NEAR[q], g = edges[k], a = nodes[g.a], b = nodes[g.b];
          if ((px < a.x - 30 && px < b.x - 30) || (px > a.x + 30 && px > b.x + 30) || (pz < a.z - 30 && pz < b.z - 30) || (pz > a.z + 30 && pz > b.z + 30)) continue;
          if (dead[k] || runEdge(k) || ext.includes(k)) continue;
          const u = (px - a.x) * g.ux + (pz - a.z) * g.uz;
          if (u < 0 || u > g.length) continue;
          const lat = Math.abs(-(px - a.x) * g.uz + (pz - a.z) * g.ux);
          if (lat < (g.width + edges[list[0]].width) / 2 && Math.abs(g.ux * dx + g.uz * dz) > 0.9 * L) { clear(); return false; }
        }
      }
    }
    // ---- The street's one cross section: each half's lanes (most of its
    // length), the higher class of the two, two-way.
    const lanesOf = (path) => {
      const L = new Map();
      for (const k of path) L.set(edges[k].lanesF, (L.get(edges[k].lanesF) || 0) + edges[k].length);
      let best = 1, bl = -1;
      for (const [v, len] of L) if (len > bl || (len === bl && v > best)) { best = v; bl = len; }
      return best;
    };
    const clsOf = (path) => {
      const L = new Map();
      for (const k of path) L.set(edges[k].cls, (L.get(edges[k].cls) || 0) + edges[k].length);
      let best = '', bl = -1;
      for (const [v, len] of L) if (len > bl) { best = v; bl = len; }
      return best;
    };
    const c0 = clsOf(EH[0]), c1 = clsOf(EH[1]);
    const cls = rankOf(c1) > rankOf(c0) ? c1 : c0;
    const name = edges[list[0]].name;
    let sidewalk = 0, mph = 0, lanesTag = 0;
    for (const k of list) {
      const e = edges[k];
      if (e.sidewalk > sidewalk) sidewalk = e.sidewalk;
      if (e.mph > mph) mph = e.mph;
      if ((e.lanesTag || 0) > lanesTag) lanesTag = e.lanesTag;
    }
    const way = { class: cls, name, lanes: lanesOf(EH[0]) + lanesOf(EH[1]), bridge: 0 };
    const prof = roadProfile(way, { curbParking: curb.includes(name) });
    way.bridge = 1;
    const profBridge = roadProfile(way, { curbParking: curb.includes(name) });
    // ---- Apply.
    for (const k of list) dead[k] = 1;
    for (const k of drop) dead[k] = 1;
    for (const id of ext) {
      const g = edgeAt(id);
      const na = endOf(g.a), nb = endOf(g.b);
      if (na === nb) { dead[id] = 1; continue; }
      g.a = na;
      g.b = nb;
    }
    for (let t = 0; t < twin.length; t += 2) {
      const h = edgeAt(twin[t]), g = edgeAt(twin[t + 1]);
      h.oneway = false;
      h.lanesB = g.lanesF;
      h.parkL = g.parkR;
      h.width = Math.round(((h.lanesF + h.lanesB) * h.laneW + h.center + h.parkL + h.parkR + 0.6) * 100) / 100;
      h.avenue = isAvenue(h);
      h.merged = true;
      dead[g.id] = 1;
      // (A short dead end left by it, the far corner of a triangle island:
      // dropped.)
      const far = nodes[itemOf[h.a] >= 0 ? h.b : h.a];
      let alive = 0;
      for (const k of far.edges) if (!dead[k]) alive++;
      if (alive === 1 && h.length < STUB_MAX) dead[h.id] = 1;
    }
    for (let i = 0; i < itN.length; i++) {
      nodes[itN[i]].edges.length = 0;
      const c = clusterOf[i];
      if (rep[c] !== itN[i] || top[c] < 2) moved[itN[i]] = 1;
    }
    for (let c = 0; c < nc; c++) { const n = nodes[rep[c]]; n.x = cx[c]; n.z = cz[c]; }
    for (const id of ext) {
      if (dead[id]) continue;
      const g = edgeAt(id), a = nodes[g.a], b = nodes[g.b];
      const dx = b.x - a.x, dz = b.z - a.z, L = Math.hypot(dx, dz);
      g.length = L;
      g.ux = dx / L;
      g.uz = dz / L;
      g.horizontal = Math.abs(dx) >= Math.abs(dz);
      if (itemOf[g.a] >= 0 && !a.edges.includes(id)) a.edges.push(id);
      if (itemOf[g.b] >= 0 && !b.edges.includes(id)) b.edges.push(id);
    }
    // (Mean station of each cluster: a new edge is a bridge where half A's
    // edge at its middle is one.)
    const cs = new Float64Array(nc), cn = new Int32Array(nc);
    for (let i = 0; i < m; i++) { cs[clusterOf[i]] += itS[i]; cn[clusterOf[i]]++; }
    for (let c = 0; c + 1 < nc; c++) {
      const mid = (cs[c] / cn[c] + cs[c + 1] / cn[c + 1]) / 2;
      let k = 0;
      while (k + 1 < EH[0].length && SA[k + 1] <= mid) k++;
      const br = !!edges[EH[0][k]].bridge;
      const e = makeEdge(NE + newEdges.length, rep[c], rep[c + 1], nodes, br ? profBridge : prof, cls, name, br ? 0 : sidewalk, mph, lanesTag, br);
      newEdges.push(e);
      nodes[rep[c]].edges.push(e.id);
      nodes[rep[c + 1]].edges.push(e.id);
    }
    clear();
    return true;
  }
  if (!stats.collapsed) return stats;
  // ---- Compact: the dead edges out, ids renumbered, node lists rewritten.
  const remap = new Int32Array(NE + newEdges.length).fill(-1);
  let w = 0;
  for (let k = 0; k < NE; k++) {
    if (dead[k]) continue;
    remap[k] = w;
    edges[w] = edges[k];
    edges[w].id = w;
    w++;
  }
  for (let k = 0; k < newEdges.length; k++) {
    remap[NE + k] = w;
    newEdges[k].id = w;
    edges[w++] = newEdges[k];
  }
  edges.length = w;
  for (const n of nodes) {
    const l = n.edges;
    let j = 0;
    for (let q = 0; q < l.length; q++) { const v = remap[l[q]]; if (v >= 0) l[j++] = v; }
    l.length = j;
  }
  // The nodes a collapse left with no edge out too (ids renumbered).
  const nmap = new Int32Array(nodes.length);
  let nw = 0;
  for (let k = 0; k < nodes.length; k++) {
    const n = nodes[k];
    if (!n.edges.length && (moved[k] || deg0[k] > 0)) { nmap[k] = -1; continue; }
    nmap[k] = nw;
    n.id = nw;
    nodes[nw++] = n;
  }
  nodes.length = nw;
  for (let k = 0; k < edges.length; k++) {
    edges[k].a = nmap[edges[k].a];
    edges[k].b = nmap[edges[k].b];
  }
  stats.made = new Uint8Array(edges.length);
  for (let k = 0; k < newEdges.length; k++) if (remap[NE + k] >= 0) stats.made[remap[NE + k]] = 1;
  return stats;
}

// A two-way edge from node a to b with profile P (the field order of
// miami.js addEdge, so every edge object has one shape).
function makeEdge(id, na, nb, nodes, P, cls, name, sidewalk, mph, lanesTag, bridge) {
  const A = nodes[na], B = nodes[nb];
  const dx = B.x - A.x, dz = B.z - A.z, length = Math.hypot(dx, dz);
  const ed = {
    id, a: na, b: nb, horizontal: Math.abs(dx) >= Math.abs(dz), width: P.width, avenue: isAvenue(P), length,
    ux: dx / length, uz: dz / length, bridge, oneway: false, cls, name,
    lanesF: P.lanesF, lanesB: P.lanesB, laneW: P.laneW, parkL: P.parkL, parkR: P.parkR, median: 0.5, center: P.center,
    off: 0.5, sidewalk, ped: false, divided: false, pair: -1, mph, lanesTag,
  };
  ed.median = 0;
  ed.off = 0;
  ed.merged = true;
  return ed;
}
