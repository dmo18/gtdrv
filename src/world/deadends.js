// Dead ends inside a region (0.13.2, docs/STREETSCAPE.md "wastelands"):
// a road whose last node joins nothing (one edge) and is not one of the
// generated road ends at a crop edge (city.roadEnds) used to stop as a
// square cut of asphalt in the lawn. Each one gets a low striped barricade
// across the end, just past the last node, drawn by render/props.js and
// solid in world/collision.js (the same posts as a road end). Derived from
// the graph only: no city field changes, nothing random. Pure (no three.js).
//
// deadEnds(city) -> [{ node, edge, x, z, heading, w }] (barricade middle,
// heading along the road out of the end, width across), cached per city.

export const DEAD_END_GAP = 0.8; // m past the node
const cache = new WeakMap();
const NEAR = [];

// (qx, qz) within the carriageway (plus 1 m) of an edge other than `own`.
function onOther(city, own, qx, qz) {
  if (!city.edgesNear) return false;
  city.edgesNear(qx, qz, 20, NEAR);
  for (let i = 0; i < NEAR.length; i++) {
    const q = city.edges[NEAR[i]];
    if (!q || q.id === own) continue;
    const a = city.nodes[q.a], b = city.nodes[q.b];
    const dx = b.x - a.x, dz = b.z - a.z, L2 = dx * dx + dz * dz || 1;
    let t = ((qx - a.x) * dx + (qz - a.z) * dz) / L2;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    if (Math.hypot(a.x + dx * t - qx, a.z + dz * t - qz) < q.width / 2 + 1) return true;
  }
  return false;
}

export function deadEnds(city) {
  let out = cache.get(city);
  if (out) return out;
  out = [];
  cache.set(city, out);
  const N = city.nodes || [], E = city.edges || [];
  // (The real map only: the island's roads have their own ends.)
  if (!N.length || !E.length || !city.roadGeo) return out;
  const deg = new Int32Array(N.length), last = new Int32Array(N.length).fill(-1);
  for (let k = 0; k < E.length; k++) {
    const e = E[k];
    deg[e.a]++; deg[e.b]++;
    last[e.a] = k; last[e.b] = k;
  }
  const ends = new Set();
  for (const re of city.roadEnds || []) ends.add(re.node);
  for (let n = 0; n < N.length; n++) {
    if (deg[n] !== 1 || ends.has(n)) continue;
    const e = E[last[n]];
    if (!e || e.ped || e.bridge || e.length < 8) continue;
    const o = N[e.a === n ? e.b : e.a], p = N[n];
    const l = Math.hypot(p.x - o.x, p.z - o.z);
    if (l < 1) continue;
    const ux = (p.x - o.x) / l, uz = (p.z - o.z) / l, px = -uz, pz = ux;
    const w = e.width + 1;
    const x = p.x + ux * DEAD_END_GAP, z = p.z + uz * DEAD_END_GAP;
    // Not on another road (the end runs on into a road the graph does not
    // join), not into a building, on land.
    let clear = true;
    for (let k = -2; k <= 2 && clear; k++) {
      const qx = x + px * (w / 4) * k + ux * 0.6, qz = z + pz * (w / 4) * k + uz * 0.6;
      if (onOther(city, e.id, qx, qz)) clear = false;
      else if (city.inBuilding && city.inBuilding(qx, qz)) clear = false;
      else if (city.isLand && !city.isLand(qx, qz)) clear = false;
    }
    if (!clear) continue;
    out.push({ node: n, edge: e.id, x, z, heading: Math.atan2(uz, ux), w });
  }
  return out;
}
