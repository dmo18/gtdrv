// The one ground height function (docs/PLAN_V3.md 2.2 item 5): meshes and
// physics both stand on groundAt(x, z). Road 0, sidewalk and raised median
// +CURB_H, lots and open land 0, the sea floor slopes down from the water
// line (a beach is waded into, not floated over). Bridges are flat in
// 0.9.0; raised decks come through this same function in 0.11.0.
//
// Pure and deterministic. The edges and junctions that can reach a 32 m
// cell are listed the first time a point in it is asked for (lazy, by edge
// id), so a call costs a handful of segment distances and allocates nothing.
// The answer is a pure function of the city and the point.

export const CURB_H = 0.15; // m, curb step (docs/MAP.md edge contract)
export const SIDEWALK_W = 2.0; // m, sidewalk on an edge without `sidewalk`
export const SEA_LEVEL = -0.6; // m, the water surface (game.js SEA_Y)
export const SEA_SLOPE = 0.4; // m of drop per m out from the water line
export const SEA_FLOOR = -2.2; // m, deepest the shallows go
const CELL = 32;

function sidewalkOf(e) {
  if (Number.isFinite(e.sidewalk)) return e.sidewalk;
  return e.bridge || e.causeway ? 0 : SIDEWALK_W;
}

// The center offset of an edge's raised median (to the right of the node
// line, docs/MAP.md "The divide"), NaN when it has none.
function medianOffset(e) {
  if (!(e.median > 0) || !(e.laneW > 0)) return NaN;
  return -e.width / 2 + 0.3 + (e.parkL || 0) + (e.lanesB || 0) * e.laneW + e.median / 2;
}

export function createGround(city) {
  const nodes = city.nodes || [], edges = city.edges || [];
  // Grid extent: the city bounds, else the road graph plus a margin.
  let x0, z0, x1, z1;
  if (city.bounds) ({ x0, z0, x1, z1 } = city.bounds);
  else {
    x0 = z0 = Infinity; x1 = z1 = -Infinity;
    for (const n of nodes) { x0 = Math.min(x0, n.x); x1 = Math.max(x1, n.x); z0 = Math.min(z0, n.z); z1 = Math.max(z1, n.z); }
    if (!(x1 >= x0)) { x0 = z0 = -1; x1 = z1 = 1; }
    x0 -= 200; z0 -= 200; x1 += 200; z1 += 200;
  }
  const gx0 = Math.floor(x0 / CELL), gz0 = Math.floor(z0 / CELL);
  const W = Math.floor(x1 / CELL) - gx0 + 1, H = Math.floor(z1 / CELL) - gz0 + 1;
  const cellE = new Array(W * H).fill(null); // Int32Array of edge ids, per cell
  const cellN = new Array(W * H).fill(null); // Int32Array of node ids
  const EMPTY = new Int32Array(0);
  // Per edge, precomputed: node a, unit direction, length, half width,
  // outer reach (half width + sidewalk), median offset and half width.
  const NE = edges.length;
  const ax = new Float64Array(NE), az = new Float64Array(NE), ux = new Float64Array(NE), uz = new Float64Array(NE);
  const len = new Float64Array(NE), hw = new Float64Array(NE), reach = new Float64Array(NE);
  const mo = new Float64Array(NE), mh = new Float64Array(NE);
  let maxReach = 0;
  for (let k = 0; k < NE; k++) {
    const e = edges[k], a = nodes[e.a], b = nodes[e.b];
    const dx = b.x - a.x, dz = b.z - a.z, L = Math.hypot(dx, dz) || 1e-6;
    ax[k] = a.x; az[k] = a.z; ux[k] = dx / L; uz[k] = dz / L; len[k] = L;
    hw[k] = e.width / 2;
    reach[k] = hw[k] + sidewalkOf(e);
    mo[k] = medianOffset(e);
    mh[k] = (e.median || 0) / 2;
    if (reach[k] > maxReach) maxReach = reach[k];
  }
  const scratch = [];
  const segD2 = (px, pz, k) => {
    let t = (px - ax[k]) * ux[k] + (pz - az[k]) * uz[k];
    if (t < 0) t = 0; else if (t > len[k]) t = len[k];
    const qx = ax[k] + ux[k] * t - px, qz = az[k] + uz[k] * t - pz;
    return qx * qx + qz * qz;
  };
  function build(c, cx, cz) {
    const mx = (cx + 0.5) * CELL, mz = (cz + 0.5) * CELL;
    scratch.length = 0;
    if (city.edgesNear && NE > 400) city.edgesNear(mx, mz, CELL * 0.7072 + 0.5 + maxReach, scratch);
    else for (let k = 0; k < NE; k++) scratch.push(k);
    const keep = [];
    for (let q = 0; q < scratch.length; q++) {
      const k = scratch[q];
      const r = CELL * 0.7072 + reach[k] + 0.5;
      if (segD2(mx, mz, k) <= r * r) keep.push(k);
    }
    keep.sort((a, b) => a - b);
    cellE[c] = keep.length ? Int32Array.from(keep) : EMPTY;
    // Junction boxes: the ends of those edges that reach the cell.
    const nk = [];
    const h = CELL / 2 + 0.5;
    for (let q = 0; q < keep.length; q++) {
      const e = edges[keep[q]];
      for (const id of [e.a, e.b]) {
        const n = nodes[id];
        if (!(n.hx > 0) && !(n.hz > 0)) continue;
        if (Math.abs(n.x - mx) <= h + (n.hx || 0) && Math.abs(n.z - mz) <= h + (n.hz || 0) && !nk.includes(id)) nk.push(id);
      }
    }
    nk.sort((a, b) => a - b);
    cellN[c] = nk.length ? Int32Array.from(nk) : EMPTY;
    return cellE[c];
  }
  const shore = typeof city.shoreDist === 'function' ? city.shoreDist : null;

  // Kind of ground at (x, z): 0 off any road, 1 road, 2 sidewalk, 3 median.
  function surfaceAt(x, z) {
    const cx = Math.floor(x / CELL), cz = Math.floor(z / CELL);
    const i = cx - gx0, j = cz - gz0;
    if (i < 0 || j < 0 || i >= W || j >= H) return 0;
    const c = j * W + i;
    const es = cellE[c] || build(c, cx, cz);
    const ns = cellN[c];
    let side = false;
    for (let q = 0; q < ns.length; q++) {
      const n = nodes[ns[q]];
      const ex = Math.abs(x - n.x) - (n.hx || 0), ez = Math.abs(z - n.z) - (n.hz || 0);
      if (ex <= 0 && ez <= 0) return 1;
    }
    let road = false;
    for (let q = 0; q < es.length; q++) {
      const k = es[q];
      const d2 = segD2(x, z, k);
      const r = reach[k];
      if (d2 > r * r) continue;
      const h = hw[k];
      if (d2 <= h * h) {
        if (mh[k] > 0) {
          // Signed offset to the right of the node line.
          const s = -(x - ax[k]) * uz[k] + (z - az[k]) * ux[k];
          if (Math.abs(s - mo[k]) < mh[k]) return 3;
        }
        road = true;
      } else side = true;
    }
    return road ? 1 : side ? 2 : 0;
  }

  function groundAt(x, z) {
    const s = surfaceAt(x, z);
    if (s === 2 || s === 3) return CURB_H;
    if (s === 1) return 0;
    if (shore) {
      const d = shore(x, z);
      if (d < 0) {
        const g = d * SEA_SLOPE;
        return g < SEA_FLOOR ? SEA_FLOOR : g;
      }
    }
    return 0;
  }
  return { groundAt, surfaceAt, stats: () => ({ cells: cellE.filter(Boolean).length, W, H }) };
}

// The ground of a city, made once and kept (city.groundAt when the city
// already has one).
const cache = new WeakMap();
export function groundOf(city) {
  if (!city) return null;
  let g = cache.get(city);
  if (!g) {
    g = createGround(city);
    cache.set(city, g);
  }
  return g;
}

// city.groundAt(x, z) and city.surfaceAt(x, z), attached once (no-op when
// the city has them).
export function attachGround(city) {
  if (!city || typeof city.groundAt === 'function') return city;
  const g = groundOf(city);
  city.groundAt = g.groundAt;
  city.surfaceAt = g.surfaceAt;
  return city;
}

// The ground height function for a city (city.groundAt or the made one).
export function groundFn(city) {
  if (!city) return null;
  if (typeof city.groundAt === 'function') return city.groundAt;
  return groundOf(city).groundAt;
}
