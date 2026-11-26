// Junction audit (0.13.8, docs/STATUS.md "0.13.8 street alignment"):
// the owner's junction defects counted over a city, shared by
// test/streetalign.test.js and scripts/street-align.mjs. Not a test file.
// - stub: an arm that is a short dead end out of the junction (under
//   12 m, its far node of degree 1): the remains of a traffic circle
//   merged into the junction node, a wedge of road out of the crossing.
// - reach: the junction's asphalt reaching farther from every arm's
//   carriageway (its node line and half width, carried through the
//   junction) than a curb return can (CURB_R_MAX + 1.5 m): a lopsided
//   junction, wider on one side of the road than the other.
// - walk: a corner's sidewalk triangle whose middle lies on the
//   junction's asphalt (an unclipped sidewalk piece across the road).
// - grass: points on the junction's asphalt that the ground does not
//   call road (lawn or sidewalk inside the hull), on a 1 m lattice; a
//   junction counts when over 1 m2 of it is not road.
import { inJunctionArea, CURB_R_MAX } from '../src/world/junctions.js';
import { groundOf } from '../src/world/ground.js';

export function auditJunctions(city) {
  const geo = city.roadGeo, N = city.nodes, E = city.edges, G = groundOf(city);
  const r = { junctions: 0, stub: 0, reach: 0, reachMax: 0, walk: 0, grass: 0, worst: null };
  const bad = new Set();
  for (const J of geo.junctions) {
    r.junctions++;
    const arms = [];
    let stub = false;
    for (const q of J.arms) {
      const e = E[q >> 1], end = q & 1, n = N[end ? e.b : e.a], s = end ? -1 : 1;
      const far = N[end ? e.a : e.b];
      if (far.edges.length === 1 && e.length < 12) stub = true;
      arms.push({ e, nx: n.x, nz: n.z, ux: e.ux * s, uz: e.uz * s, o: ((e.off || 0) + geo.eoff[e.id]) * s, h: e.width / 2 });
    }
    if (stub) { r.stub++; bad.add(J); }
    // Reach of the asphalt past the arms.
    let worst = 0;
    const R = J.ring;
    for (let k = 0; k < R.length; k += 2) {
      let best = Infinity;
      for (const A of arms) {
        const dx = R[k] - A.nx, dz = R[k + 1] - A.nz;
        const lat = -dx * A.uz + dz * A.ux - A.o;
        const d = Math.max(0, Math.abs(lat) - A.h);
        if (d < best) best = d;
      }
      if (best > worst) worst = best;
    }
    if (arms.length >= 2 && worst > CURB_R_MAX + 1.5) { r.reach++; bad.add(J); }
    if (worst > r.reachMax && arms.length >= 2) { r.reachMax = +worst.toFixed(2); r.worst = { x: Math.round(J.x), z: Math.round(J.z), reach: r.reachMax }; }
    // Sidewalk triangles on the asphalt.
    let walk = false;
    for (const C of J.corners) {
      const T = C.tris;
      if (!T) continue;
      for (let k = 0; k + 5 < T.length && !walk; k += 6) {
        const cx = (T[k] + T[k + 2] + T[k + 4]) / 3, cz = (T[k + 1] + T[k + 3] + T[k + 5]) / 3;
        const area = Math.abs((T[k + 2] - T[k]) * (T[k + 5] - T[k + 1]) - (T[k + 4] - T[k]) * (T[k + 3] - T[k + 1])) / 2;
        if (area > 0.25 && inJunctionArea(J, cx, cz) && G.surfaceAt(cx, cz) === 1) walk = true;
      }
    }
    if (walk) { r.walk++; bad.add(J); }
    // Not road on the junction's asphalt.
    let off = 0;
    for (let x = Math.floor(J.x0) + 0.5; x < J.x1; x += 1) {
      for (let z = Math.floor(J.z0) + 0.5; z < J.z1; z += 1) {
        if (inJunctionArea(J, x, z) && G.surfaceAt(x, z) !== 1) off++;
      }
    }
    if (off > 1) { r.grass++; bad.add(J); }
  }
  r.any = bad.size;
  return r;
}
