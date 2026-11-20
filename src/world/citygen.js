// Generates the whole island city from a seed. Pure data, no drawing,
// so it can be tested without a browser.
//
// Coordinates: x = east, z = south, metres. The ground is flat (y = 0).
import { createRng, TAU } from '../core/rng.js';

export const SIDEWALK = 4;
export const STREET_W = 11;
export const AVENUE_W = 18;

export const DISTRICTS = {
  downtown: { name: 'Glasswell', min: 22, max: 46, hMin: 30, hMax: 140, gap: 1.5 },
  midtown: { name: 'Marrow Street', min: 16, max: 34, hMin: 10, hMax: 38, gap: 1.5 },
  residential: { name: 'Fernside', min: 12, max: 20, hMin: 5, hMax: 9, gap: 4 },
  docks: { name: 'Saltyard', min: 22, max: 48, hMin: 8, hMax: 14, gap: 3 },
  industrial: { name: 'Cinder Row', min: 20, max: 44, hMin: 7, hMax: 18, gap: 3 },
  beach: { name: 'Pale Shore', min: 16, max: 30, hMin: 8, hMax: 30, gap: 2.5 },
  airfield: { name: 'Gullwing Airfield', min: 0, max: 0, hMin: 0, hMax: 0, gap: 0 },
  park: { name: 'Greenmere', min: 0, max: 0, hMin: 0, hMax: 0, gap: 0 },
};

const PALETTES = {
  downtown: [0x8fa3b8, 0x6f8196, 0xa9b6c4, 0x57697d, 0xb9c4cc, 0x7a8c8f],
  midtown: [0xb0806a, 0xa89684, 0x8c5f4e, 0xc2ab8f, 0x8a8f96, 0xa66a52],
  residential: [0xe6d9c3, 0xd9b99b, 0xc9d6c2, 0xe3c7b4, 0xbfd0dc, 0xf0e4d0],
  docks: [0x7d8a8c, 0x9a6b4b, 0x6b7780, 0xa8a08f],
  industrial: [0x8c8478, 0x73706c, 0x9c8f7c, 0x6a625a],
  beach: [0xf2e2c4, 0xf5c9a8, 0xa8dcd4, 0xf7efe0, 0xf0b9a0, 0xc8e4f0],
};
const CONTAINER_COLORS = [0xb5482f, 0x2f6fb5, 0x3d8f5a, 0xd09a2a, 0x7a4fa0, 0xd8d8d8];

export function generateCity(seed = 20261) {
  const rng = createRng(seed);

  // --- Island outline: a wobbly circle. ---
  const BASE_R = 640;
  const p1 = rng.range(0, TAU), p2 = rng.range(0, TAU), p3 = rng.range(0, TAU);
  const radiusAt = (theta) =>
    BASE_R * (1 + 0.1 * Math.sin(2 * theta + p1) + 0.07 * Math.sin(3 * theta + p2) + 0.04 * Math.sin(5 * theta + p3));
  // How far inside the shoreline a point is (negative = in the sea).
  // Extra rectangles of land (airfield islet, causeway) are added later.
  const extraLand = [];
  const piers = [];
  const mainShore = (x, z) => radiusAt(Math.atan2(z, x)) - Math.hypot(x, z);
  const rectDist = (r, x, z) => {
    const ix = Math.min(x - r.x0, r.x1 - x), iz = Math.min(z - r.z0, r.z1 - z);
    if (ix >= 0 && iz >= 0) return Math.min(ix, iz);
    return -Math.hypot(Math.max(0, -ix), Math.max(0, -iz));
  };
  const shoreDist = (x, z) => {
    let d = mainShore(x, z);
    for (let i = 0; i < extraLand.length; i++) {
      const e = rectDist(extraLand[i], x, z);
      if (e > d) d = e;
    }
    return d;
  };
  // Land, or a pier you can walk along.
  const isGround = (x, z) => {
    if (shoreDist(x, z) > 0) return true;
    for (let i = 0; i < piers.length; i++) {
      const r = piers[i];
      if (x >= r.x0 && x <= r.x1 && z >= r.z0 && z <= r.z1) return true;
    }
    return false;
  };
  const isLand = (x, z) => shoreDist(x, z) > 0;

  // --- Street grid lines with uneven spacing. ---
  const N = 17;
  function makeLines() {
    const gaps = [];
    for (let i = 0; i < N - 1; i++) gaps.push(rng.range(72, 104));
    const total = gaps.reduce((a, b) => a + b, 0);
    const lines = [-total / 2];
    for (let i = 0; i < N - 1; i++) lines.push(lines[i] + gaps[i]);
    return lines;
  }
  const xs = makeLines();
  const zs = makeLines();
  const isAvenue = (i) => i % 4 === 0;
  const wx = xs.map((_, i) => (isAvenue(i) ? AVENUE_W : STREET_W));
  const wz = zs.map((_, j) => (isAvenue(j) ? AVENUE_W : STREET_W));

  // --- Intersections (nodes) and road segments (edges). ---
  const grid = new Array(N * N).fill(null);
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      if (shoreDist(xs[i], zs[j]) > 55) {
        grid[j * N + i] = { id: -1, i, j, x: xs[i], z: zs[j], hx: wx[i] / 2, hz: wz[j] / 2, edges: [], signal: false };
      }
    }
  }
  // Keep only the largest connected group of intersections.
  const seen = new Set();
  let bestGroup = [];
  for (let k = 0; k < grid.length; k++) {
    if (!grid[k] || seen.has(k)) continue;
    const group = [];
    const stack = [k];
    seen.add(k);
    while (stack.length) {
      const c = stack.pop();
      group.push(c);
      const ci = c % N, cj = (c / N) | 0;
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const ni = ci + di, nj = cj + dj;
        if (ni < 0 || nj < 0 || ni >= N || nj >= N) continue;
        const nk = nj * N + ni;
        if (grid[nk] && !seen.has(nk)) {
          seen.add(nk);
          stack.push(nk);
        }
      }
    }
    if (group.length > bestGroup.length) bestGroup = group;
  }
  const keep = new Set(bestGroup);
  for (let k = 0; k < grid.length; k++) if (!keep.has(k)) grid[k] = null;

  const nodes = [];
  for (const n of grid) {
    if (!n) continue;
    n.id = nodes.length;
    nodes.push(n);
  }
  const nodeAt = (i, j) => (i < 0 || j < 0 || i >= N || j >= N ? null : grid[j * N + i]);

  const edges = [];
  function addEdge(a, b, horizontal, width) {
    const e = {
      id: edges.length,
      a: a.id,
      b: b.id,
      horizontal,
      width,
      avenue: width === AVENUE_W,
      length: Math.hypot(b.x - a.x, b.z - a.z),
    };
    edges.push(e);
    a.edges.push(e.id);
    b.edges.push(e.id);
  }
  for (const n of nodes) {
    const east = nodeAt(n.i + 1, n.j);
    if (east) addEdge(n, east, true, wz[n.j]);
    const south = nodeAt(n.i, n.j + 1);
    if (south) addEdge(n, south, false, wx[n.i]);
  }
  for (const n of nodes) {
    n.signal = n.edges.length >= 3 && (isAvenue(n.i) || isAvenue(n.j));
  }

  // --- City blocks. ---
  function districtOf(x, z) {
    const d = Math.hypot(x, z);
    if (extraLand.length && mainShore(x, z) < -60) return 'airfield';
    if (d < 215) return 'downtown';
    if (x < -330 && shoreDist(x, z) < 260) return 'beach';
    if (z > 250 && x > -120) return 'docks';
    if (x > 320) return 'industrial';
    if (z < -230 || d > 470) return 'residential';
    return 'midtown';
  }

  const blocks = [];
  const buildings = [];
  const props = []; // { type, x, z, r, h, rot, color }
  const parkingSpots = []; // { x, z, heading }

  function addBuilding(x0, z0, x1, z1, h, district, kind = 'building', color = null) {
    buildings.push({
      x0, z0, x1, z1, h, district, kind,
      color: color ?? rng.pick(PALETTES[district] ?? PALETTES.midtown),
    });
  }

  function fillLot(x0, z0, x1, z1, district) {
    const spec = DISTRICTS[district];
    const w = x1 - x0, d = z1 - z0;
    const longest = Math.max(w, d);
    if (longest > spec.max || (longest > spec.min * 2 && rng.chance(0.55))) {
      const t = rng.range(0.38, 0.62);
      if (w >= d) {
        const m = x0 + w * t;
        fillLot(x0, z0, m, z1, district);
        fillLot(m, z0, x1, z1, district);
      } else {
        const m = z0 + d * t;
        fillLot(x0, z0, x1, m, district);
        fillLot(x0, m, x1, z1, district);
      }
      return;
    }
    const g = spec.gap;
    const bx0 = x0 + g, bz0 = z0 + g, bx1 = x1 - g, bz1 = z1 - g;
    if (bx1 - bx0 < 6 || bz1 - bz0 < 6) return;
    const cx = (bx0 + bx1) / 2, cz = (bz0 + bz1) / 2;

    if (district === 'docks' && rng.chance(0.45)) {
      // A yard of stacked shipping containers.
      const alongX = bx1 - bx0 > bz1 - bz0;
      const len = 12, wid = 2.6;
      const rows = Math.floor(((alongX ? bz1 - bz0 : bx1 - bx0) - 2) / (wid + 1.6));
      const cols = Math.floor(((alongX ? bx1 - bx0 : bz1 - bz0) - 2) / (len + 1.5));
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          if (rng.chance(0.3)) continue;
          const stack = rng.int(1, 3);
          const a = (alongX ? bx0 : bz0) + 1 + c * (len + 1.5);
          const b = (alongX ? bz0 : bx0) + 1 + r * (wid + 1.6);
          const col = rng.pick(CONTAINER_COLORS);
          if (alongX) addBuilding(a, b, a + len, b + wid, stack * 2.6, district, 'container', col);
          else addBuilding(b, a, b + wid, a + len, stack * 2.6, district, 'container', col);
        }
      }
      return;
    }
    if ((district === 'midtown' || district === 'industrial' || district === 'beach') && rng.chance(0.08)) {
      // An open car park.
      const alongX = bx1 - bx0 > bz1 - bz0;
      const n = Math.floor(((alongX ? bx1 - bx0 : bz1 - bz0) - 2) / 3);
      for (let k = 0; k < n; k++) {
        if (rng.chance(0.45)) continue;
        const a = (alongX ? bx0 : bz0) + 2.5 + k * 3;
        if (alongX) parkingSpots.push({ x: a, z: cz, heading: rng.chance(0.5) ? 0 : Math.PI, lot: true });
        else parkingSpots.push({ x: cx, z: a, heading: rng.chance(0.5) ? Math.PI / 2 : -Math.PI / 2, lot: true });
      }
      return;
    }
    let h = rng.range(spec.hMin, spec.hMax);
    if (district === 'downtown') {
      // Taller toward the very centre, with the odd landmark tower.
      const centre = 1 - Math.min(1, Math.hypot(cx, cz) / 230);
      h = spec.hMin + (spec.hMax - spec.hMin) * Math.pow(rng.next(), 2.2 - centre * 1.4);
    }
    if (district === 'residential') {
      // Houses sit back from the street with a tree or two in the yard.
      const s = rng.range(1, 3);
      addBuilding(bx0 + s, bz0 + s, bx1 - s, bz1 - s, h, district, 'house');
      if (rng.chance(0.7)) {
        props.push({ type: 'tree', x: bx0 + 0.3, z: bz0 + 0.3, r: 0.45, h: rng.range(5, 8) });
      }
      return;
    }
    addBuilding(bx0, bz0, bx1, bz1, h, district, district === 'docks' || district === 'industrial' ? 'warehouse' : 'building');
  }

  for (let j = 0; j < N - 1; j++) {
    for (let i = 0; i < N - 1; i++) {
      if (!nodeAt(i, j) || !nodeAt(i + 1, j) || !nodeAt(i, j + 1) || !nodeAt(i + 1, j + 1)) continue;
      const x0 = xs[i] + wx[i] / 2, x1 = xs[i + 1] - wx[i + 1] / 2;
      const z0 = zs[j] + wz[j] / 2, z1 = zs[j + 1] - wz[j + 1] / 2;
      const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
      let district = districtOf(cx, cz);
      if (district !== 'docks' && rng.chance(district === 'downtown' ? 0.06 : 0.09)) district = 'park';
      const block = { id: blocks.length, i, j, x0, z0, x1, z1, district };
      blocks.push(block);
      if (district === 'park') {
        const count = Math.floor(((x1 - x0) * (z1 - z0)) / 260);
        for (let k = 0; k < count; k++) {
          props.push({
            type: 'tree',
            x: rng.range(x0 + 6, x1 - 6),
            z: rng.range(z0 + 6, z1 - 6),
            r: 0.5,
            h: rng.range(6, 11),
          });
        }
        continue;
      }
      fillLot(x0 + SIDEWALK, z0 + SIDEWALK, x1 - SIDEWALK, z1 - SIDEWALK, district);
    }
  }

  // --- Airfield islet, joined to the east shore by a causeway. ---
  const pois = [];
  const aircraftSpots = []; // { x, z, heading, spec }
  const boatSpots = []; // { x, z, heading, spec }
  const surfaces = []; // extra flat ground to draw: { x0, z0, x1, z1, type }
  const helipads = [];
  let anchor = null;
  for (const n of nodes) {
    if (nodeAt(n.i + 1, n.j)) continue; // want the east end of a row
    if (!anchor || Math.abs(n.z) < Math.abs(anchor.z) || (Math.abs(n.z) === Math.abs(anchor.z) && n.x > anchor.x)) anchor = n;
  }
  let shoreX = anchor.x;
  while (mainShore(shoreX, anchor.z) > 0) shoreX += 2;
  const IL = 780, IW = 300;
  const islet = { x0: shoreX + 170, z0: anchor.z - 205, x1: shoreX + 170 + IL, z1: anchor.z - 205 + IW };
  const roadHalf = wz[anchor.j] / 2;
  extraLand.push(islet, { x0: anchor.x, z0: anchor.z - roadHalf - 4, x1: islet.x0 + 1, z1: anchor.z + roadHalf + 4 });
  const gate = {
    id: nodes.length, i: -1, j: -1, x: islet.x0 + 60, z: anchor.z,
    hx: roadHalf, hz: roadHalf, edges: [], signal: false,
  };
  nodes.push(gate);
  addEdge(anchor, gate, true, wz[anchor.j]);
  edges[edges.length - 1].causeway = true;

  const runway = { x0: islet.x0 + 40, z0: islet.z0 + 40, x1: islet.x1 - 30, z1: islet.z0 + 70, type: 'runway' };
  const apron = { x0: islet.x0 + 40, z0: runway.z1, x1: islet.x0 + 470, z1: anchor.z + roadHalf + 30, type: 'apron' };
  surfaces.push(apron, runway);
  // Hangars and a control tower along the south edge.
  for (let k = 0; k < 5; k++) {
    const hx0 = islet.x0 + 110 + k * 70;
    addBuilding(hx0, islet.z1 - 50, hx0 + 52, islet.z1 - 14, rng.range(11, 14), 'industrial', 'warehouse');
  }
  addBuilding(islet.x0 + 480, islet.z1 - 44, islet.x0 + 494, islet.z1 - 30, 34, 'downtown', 'building', 0xcfd6dc);
  // Aircraft: one lined up on the runway, the rest parked facing it.
  const rz = (runway.z0 + runway.z1) / 2;
  aircraftSpots.push({ x: runway.x0 + 30, z: rz, heading: 0, spec: 'prop' });
  ['stunt', 'jet', 'prop'].forEach((spec, k) => {
    aircraftSpots.push({ x: islet.x0 + 150 + k * 60, z: runway.z1 + 34, heading: -Math.PI / 2, spec });
  });
  ['heli', 'heavyheli'].forEach((spec, k) => {
    const hp = { x: islet.x0 + 360 + k * 50, z: runway.z1 + 40 };
    helipads.push(hp);
    aircraftSpots.push({ ...hp, heading: -Math.PI / 2, spec });
  });
  pois.push({ type: 'airfield', x: islet.x0 + 250, z: anchor.z - 60, label: 'Gullwing Airfield' });

  // --- Piers with moored boats around the coast. ---
  // Each pier sticks straight out to sea along x or z from the shore.
  function addPier(label, dirX, dirZ, along, boats, shoreFn = mainShore) {
    // March out from the island along the chosen grid line to the shore.
    let x = dirX ? 0 : along, z = dirZ ? 0 : along;
    if (shoreFn !== mainShore) {
      x = along.x;
      z = along.z;
    }
    while (shoreFn(x, z) > 0) {
      x += dirX * 2;
      z += dirZ * 2;
    }
    const LEN = 64, HALF = 2.6;
    const ex = x + dirX * LEN, ez = z + dirZ * LEN;
    const bx = x - dirX * 8, bz = z - dirZ * 8;
    const pier = dirX
      ? { x0: Math.min(bx, ex), x1: Math.max(bx, ex), z0: z - HALF, z1: z + HALF }
      : { x0: x - HALF, x1: x + HALF, z0: Math.min(bz, ez), z1: Math.max(bz, ez) };
    piers.push(pier);
    boats.forEach((spec, k) => {
      const side = k % 2 ? 1 : -1;
      const d = 22 + Math.floor(k / 2) * 18;
      const off = HALF + 3.2;
      const sx = dirX ? x + dirX * d : x + side * off;
      const sz = dirX ? z + side * off : z + dirZ * d;
      boatSpots.push({ x: sx, z: sz, heading: Math.atan2(dirZ, dirX), spec });
    });
    pois.push({ type: 'marina', x: x + dirX * 20, z: z + dirZ * 20, label });
    return pier;
  }
  addPier('Saltyard Marina', 0, 1, xs[9], ['speedboat', 'fisher', 'jetski', 'yacht', 'dinghy', 'speedboat']);
  addPier('Pale Shore Pier', -1, 0, zs[8], ['jetski', 'speedboat', 'jetski', 'dinghy']);
  addPier('Northpoint Jetty', 0, -1, xs[7], ['fisher', 'dinghy', 'speedboat', 'jetski']);
  addPier('Airfield Dock', 0, 1, { x: islet.x0 + 600, z: islet.z1 - 2 }, ['speedboat', 'jetski'], (x, z) => rectDist(islet, x, z));
  // A seaplane floats beside the airfield dock.
  {
    const dock = piers[piers.length - 1];
    aircraftSpots.push({ x: dock.x1 + 14, z: dock.z1 - 12, heading: Math.PI / 2, spec: 'seaplane' });
  }
  // A helipad in the docks and a city one on open ground by the centre.
  {
    const hp = { x: xs[11] + wx[11] / 2 + 14, z: zs[N - 3] };
    if (mainShore(hp.x, hp.z) > 20) helipads.push(hp);
  }

  // --- Street furniture and kerbside parking along every road. ---
  for (const e of edges) {
    const a = nodes[e.a], b = nodes[e.b];
    const half = e.width / 2;
    const startPad = (e.horizontal ? a.hx : a.hz) + 6;
    const endPad = (e.horizontal ? b.hx : b.hz) + 6;
    const usable = e.length - startPad - endPad;
    // Street lamps on both kerbs.
    for (let d = startPad; d <= e.length - endPad; d += 28) {
      for (const side of [-1, 1]) {
        const off = side * (half + 0.8);
        const x = e.horizontal ? a.x + d : a.x + off;
        const z = e.horizontal ? a.z + off : a.z + d;
        props.push({ type: 'lamp', x, z, r: 0.18, h: 7, rot: e.horizontal ? (side > 0 ? Math.PI : 0) : (side > 0 ? -Math.PI / 2 : Math.PI / 2) });
      }
    }
    // Parked cars on ordinary streets only.
    if (!e.avenue && !e.causeway && usable > 14) {
      for (const side of [-1, 1]) {
        for (let d = startPad + 3; d < e.length - endPad - 3; d += 6.5) {
          if (!rng.chance(0.22)) continue;
          const off = side * (half - 1.25);
          // Traffic drives on the right, so parked cars face that way.
          const x = e.horizontal ? a.x + d : a.x + off;
          const z = e.horizontal ? a.z + off : a.z + d;
          const heading = e.horizontal ? (side > 0 ? 0 : Math.PI) : (side > 0 ? -Math.PI / 2 : Math.PI / 2);
          parkingSpots.push({ x, z, heading, lot: false });
        }
      }
    }
  }

  // Palms along the shore and trees on spare coastal ground.
  for (let k = 0; k < 520; k++) {
    const th = rng.range(0, TAU);
    const inset = rng.range(8, 46);
    const r = radiusAt(th) - inset;
    const x = Math.cos(th) * r, z = Math.sin(th) * r;
    props.push({ type: inset < 26 ? 'palm' : 'tree', x, z, r: 0.4, h: rng.range(6, 10) });
  }

  // Drop props that ended up on a road or inside a building.
  const lineHit = (v, lines, widths) => lines.some((l, i) => Math.abs(v - l) < widths[i] / 2 + 0.3);
  const onRoad = (x, z) => {
    // Only counts where a road really exists near that grid line.
    for (const e of edges) {
      const a = nodes[e.a], b = nodes[e.b];
      const h = e.width / 2 + 0.3;
      if (e.horizontal) {
        if (Math.abs(z - a.z) < h && x > a.x - h && x < b.x + h) return true;
      } else if (Math.abs(x - a.x) < h && z > a.z - h && z < b.z + h) return true;
    }
    return false;
  };
  const cleanProps = props.filter((p) => {
    if (p.type === 'lamp') return true;
    if (lineHit(p.x, xs, wx) || lineHit(p.z, zs, wz)) {
      if (onRoad(p.x, p.z)) return false;
    }
    return !buildings.some((b) => p.x > b.x0 - 1 && p.x < b.x1 + 1 && p.z > b.z0 - 1 && p.z < b.z1 + 1);
  });

  // Player start: the middle of a street next to the centre of town.
  const centre = nodes.reduce((best, n) => (Math.hypot(n.x, n.z) < Math.hypot(best.x, best.z) ? n : best), nodes[0]);
  const spawn = { x: centre.x + 30, z: centre.z + (wz[centre.j] / 2 - 2.6), heading: 0 };

  return {
    seed, N, xs, zs, wx, wz, nodes, edges, blocks, buildings,
    props: cleanProps, parkingSpots, spawn,
    extraLand, piers, pois, surfaces, aircraftSpots, boatSpots, helipads,
    airfield: { islet, runway, apron, gate },
    radiusAt, shoreDist, mainShore, isLand, isGround, districtOf, nodeAt, onRoad,
    size: BASE_R * 1.25,
  };
}

// Centre-line offset of a driving lane, measured to the right of the
// direction of travel. Streets have one lane each way, avenues two.
export function laneOffset(edge, lane = 0) {
  if (edge.avenue) return lane === 0 ? 2.6 : 6.1;
  return 2.0;
}
export const lanesPerDirection = (edge) => (edge.avenue ? 2 : 1);

// World position on a lane. `from` is the node id being driven away
// from, `d` is metres travelled from that node's centre.
export function lanePoint(city, edge, from, d, lane = 0, out = { x: 0, z: 0, heading: 0 }) {
  const a = city.nodes[from];
  const b = city.nodes[edge.a === from ? edge.b : edge.a];
  const dx = (b.x - a.x) / edge.length, dz = (b.z - a.z) / edge.length;
  const off = laneOffset(edge, lane);
  // Right-hand side of travel direction (dx,dz) is (-dz, dx).
  out.x = a.x + dx * d - dz * off;
  out.z = a.z + dz * d + dx * off;
  out.heading = Math.atan2(dz, dx);
  return out;
}

// Traffic-light state for traffic travelling along an edge into a
// signalled junction: 'green', 'amber' or 'red'.
export function signalState(node, horizontal, time) {
  if (!node.signal) return 'green';
  const cycle = 24;
  const t = (time + node.id * 7) % cycle;
  const mine = horizontal ? t : (t + cycle / 2) % cycle;
  if (mine < 9) return 'green';
  if (mine < 11.5) return 'amber';
  return 'red';
}
