// Generates the whole island city from a seed. Pure data, no drawing,
// so it can be tested without a browser.
//
// Coordinates: x = east, z = south, meters. The ground is flat (y = 0).
import { createRng, TAU } from '../core/rng.js';
import { profileLaneOffset } from './roadprofile.js';

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
      ...islandProfile(width),
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
      // An open parking lot.
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
      // Taller toward the very center, with the odd landmark tower.
      const center = 1 - Math.min(1, Math.hypot(cx, cz) / 230);
      h = spec.hMin + (spec.hMax - spec.hMin) * Math.pow(rng.next(), 2.2 - center * 1.4);
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
  // The causeway overlaps both shores so there is no thin seam where
  // it meets them.
  extraLand.push(islet, { x0: anchor.x - 30, z0: anchor.z - roadHalf - 4, x1: islet.x0 + 30, z1: anchor.z + roadHalf + 4 });
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
  // A helipad in the docks and a city one on open ground by the center.
  let dockPad = null;
  {
    const hp = { x: xs[11] + wx[11] / 2 + 14, z: zs[N - 3] };
    if (mainShore(hp.x, hp.z) > 20) {
      helipads.push(hp);
      dockPad = hp;
    }
  }

  // --- Street furniture and curbside parking along every road. ---
  for (const e of edges) {
    const a = nodes[e.a], b = nodes[e.b];
    const half = e.width / 2;
    const startPad = (e.horizontal ? a.hx : a.hz) + 6;
    const endPad = (e.horizontal ? b.hx : b.hz) + 6;
    const usable = e.length - startPad - endPad;
    // Street lamps on both curbs.
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

  // Player start: the middle of a street next to the center of town.
  const center = nodes.reduce((best, n) => (Math.hypot(n.x, n.z) < Math.hypot(best.x, best.z) ? n : best), nodes[0]);
  const spawn = { x: center.x + 30, z: center.z + (wz[center.j] / 2 - 2.6), heading: 0 };


  // --- Extra detail for drawing (facade styles, street furniture,
  // landmarks). Uses its own random stream so nothing above changes. ---
  const dr = createRng(seed ^ 0x5eed51);
  const blockAt = (x, z) => blocks.find((b) => x >= b.x0 && x <= b.x1 && z >= b.z0 && z <= b.z1) || null;
  const GLASS_TINTS = [0x7fa6cc, 0x6fae9f, 0xb89264, 0x9fb2c4, 0x5f7f9c, 0x86b8c8, 0xa8a090];
  for (const b of buildings) {
    const cx = (b.x0 + b.x1) / 2, cz = (b.z0 + b.z1) / 2;
    const blk = blockAt(cx, cz);
    b.block = blk ? blk.id : -1;
    // Which sides look onto a street: 1 north, 2 south, 4 west, 8 east.
    let street = 0;
    if (blk) {
      const lim = b.kind === 'house' ? 12.5 : 9;
      if (b.z0 - blk.z0 < lim) street |= 1;
      if (blk.z1 - b.z1 < lim) street |= 2;
      if (b.x0 - blk.x0 < lim) street |= 4;
      if (blk.x1 - b.x1 < lim) street |= 8;
    }
    b.street = street;
    let style;
    if (b.kind === 'house') style = 'house';
    else if (b.kind === 'container') style = 'container';
    else if (b.kind === 'warehouse') style = !blk ? 'hangar' : dr.chance(0.25) ? 'brick' : 'shed';
    else if (b.district === 'beach') style = 'stucco';
    else if (b.district === 'downtown') style = !blk ? 'office' : b.h > 58 ? (dr.chance(0.85) ? 'glass' : 'office') : dr.chance(0.6) ? 'glass' : 'office';
    else if (b.h >= 24) style = dr.pick(['office', 'office', 'brick', 'glass']);
    else style = dr.chance(0.68) ? 'brick' : 'office';
    b.style = style;
    b.tint = style === 'glass' ? dr.pick(GLASS_TINTS) : b.color;
    b.vseed = dr.int(1, 1e9);
  }

  // Street names: avenues run north-south, numbered streets east-west.
  const AVE = ['Marrow', 'Glasswell', 'Saltyard', 'Fern', 'Cinder', 'Gull', 'Tide', 'Kelp', 'Rust', 'Pale', 'Heron', 'Lantern', 'Brine', 'Otter', 'Pier', 'Ember'];
  const ORD = ['1st', '2nd', '3rd', '4th', '5th', '6th', '7th', '8th', '9th', '10th', '11th', '12th', '13th', '14th', '15th', '16th'];
  const streetNames = {
    x: xs.map((_, i) => `${AVE[i % 16]} ${isAvenue(i) ? 'Ave' : 'St'}`),
    z: zs.map((_, j) => `${ORD[j % 16]} St`),
  };

  // Street furniture: { type, x, z, rot, q, v }. rot is the way it
  // faces; q is the quality tier it appears at (0 always, 1 normal,
  // 2 high); v is a spare random number for variety.
  const furniture = [];
  const tier = () => { const r = dr.next(); return r < 0.35 ? 0 : r < 0.75 ? 1 : 2; };
  const SMALL = {
    downtown: ['bench', 'bin', 'planter', 'bikes', 'planter', 'meter', 'mailbox'],
    midtown: ['bench', 'bin', 'hydrant', 'mailbox', 'bikes', 'meter', 'planter'],
    residential: ['hydrant', 'mailbox', 'bin'],
    beach: ['bench', 'bin', 'bikes', 'planter', 'bench'],
    docks: ['hydrant', 'bin', 'barrier'],
    industrial: ['hydrant', 'bin', 'barrier'],
    park: ['bench', 'bench', 'bin'],
  };
  const TREE_P = { downtown: 0.8, midtown: 0.65, residential: 0.85, beach: 0.85, docks: 0.12, industrial: 0.15, park: 0.75 };
  for (const e of edges) {
    if (e.causeway) continue;
    const a = nodes[e.a], b = nodes[e.b];
    const half = e.width / 2;
    const startPad = (e.horizontal ? a.hx : a.hz) + 6;
    const endPad = (e.horizontal ? b.hx : b.hz) + 6;
    for (const side of [-1, 1]) {
      const at = (d, off) => (e.horizontal ? { x: a.x + d, z: a.z + side * (half + off) } : { x: a.x + side * (half + off), z: a.z + d });
      // Facing away from the road, toward the buildings.
      const away = e.horizontal ? (side > 0 ? Math.PI / 2 : -Math.PI / 2) : (side > 0 ? 0 : Math.PI);
      const probe = at(e.length / 2, 8);
      const blk = blockAt(probe.x, probe.z);
      const district = blk ? blk.district : null;
      const list = district ? SMALL[district] : null;
      const treeP = district ? TREE_P[district] : 0.25;
      let shelter = e.avenue && blk && district !== 'park' && dr.chance(0.3);
      for (let d = startPad; d + 28 <= e.length - endPad + 0.01; d += 28) {
        if (dr.chance(treeP)) {
          const p = at(d + 14, 1.15);
          furniture.push({ type: district === 'beach' ? 'palmtree' : 'streettree', x: p.x, z: p.z, rot: dr.range(0, TAU), q: 0, v: dr.next() });
        }
        if (!list) continue;
        for (const dd of [7, 21]) {
          if (shelter && dd === 7) {
            shelter = false;
            const p = at(d + dd, 1.5);
            furniture.push({ type: 'shelter', x: p.x, z: p.z, rot: away + Math.PI, q: 0, v: dr.next() });
            continue;
          }
          if (!dr.chance(0.5)) continue;
          const type = dr.pick(list);
          const p = at(d + dd + dr.range(-1.5, 1.5), type === 'bench' || type === 'bikes' ? 1.2 : 0.75);
          furniture.push({ type, x: p.x, z: p.z, rot: type === 'bench' ? (district === 'park' ? away : away + Math.PI) : away, q: tier(), v: dr.next() });
        }
      }
    }
  }
  // Junction corners: traffic lights where there are signals, stop
  // signs elsewhere, and a street-name post.
  const signals = []; // { node, x, z, face, armDir, armLen, horizontal }
  for (const n of nodes) {
    if (n.edges.length < 3 || n.i < 0) continue;
    for (const eid of n.edges) {
      const e = edges[eid];
      const o = nodes[e.a === n.id ? e.b : e.a];
      const l = Math.hypot(n.x - o.x, n.z - o.z);
      const tx = (n.x - o.x) / l, tz = (n.z - o.z) / l; // traveling toward the junction
      const rx = -tz, rz = tx; // the driver's right
      const along = e.horizontal ? n.hx : n.hz, across = e.horizontal ? n.hz : n.hx;
      const x = n.x - tx * (along + 0.9) + rx * (across + 0.9);
      const z = n.z - tz * (along + 0.9) + rz * (across + 0.9);
      if (n.signal) {
        signals.push({ node: n.id, x, z, face: Math.atan2(-tz, -tx), armDir: Math.atan2(-rz, -rx), armLen: across * 0.5 + 0.9, horizontal: e.horizontal });
      } else if (!e.avenue) {
        furniture.push({ type: 'stopsign', x, z, rot: Math.atan2(-tz, -tx), q: 0, v: 0 });
      }
    }
    furniture.push({ type: 'namesign', x: n.x + n.hx + 0.7, z: n.z + n.hz + 0.7, rot: 0, q: 0, v: 0, nx: n.i % 16, nz: n.j % 16 });
  }

  // Landmarks.
  const clear = (x, z, r) => !onRoad(x, z) && !buildings.some((b) => x > b.x0 - r && x < b.x1 + r && z > b.z0 - r && z < b.z1 + r);
  const landmarks = { lighthouse: null, cranes: [], billboards: [], windsock: null, runwayLights: [] };
  {
    // Lighthouse on the headland that sticks out furthest, away from piers.
    let best = -1, bestTh = 0;
    for (let k = 0; k < 360; k++) {
      const th = (k / 360) * TAU;
      const r = radiusAt(th);
      const x = Math.cos(th) * (r - 22), z = Math.sin(th) * (r - 22);
      if (piers.some((p) => Math.hypot(x - (p.x0 + p.x1) / 2, z - (p.z0 + p.z1) / 2) < 160)) continue;
      if (Math.abs(z - anchor.z) < 120 && x > 0) continue;
      if (r > best && clear(x, z, 8)) {
        best = r;
        bestTh = th;
      }
    }
    if (best > 0) landmarks.lighthouse = { x: Math.cos(bestTh) * (best - 22), z: Math.sin(bestTh) * (best - 22), h: 30, r: 3.4 };
  }
  // Gantry cranes on the pier east of the marina, booms out to sea.
  for (let k = 0; k < 3; k++) {
    const x = xs[9] + 70 + k * 62;
    let z = 200;
    while (mainShore(x, z) > 13 && z < 900) z += 1;
    if (z < 900 && clear(x, z, 12)) landmarks.cranes.push({ x, z, rot: Math.PI / 2, v: dr.next() });
  }
  // Rooftop billboards on low street-side buildings.
  {
    const cand = buildings.filter((b) => b.kind !== 'house' && b.kind !== 'container' && b.block >= 0 && b.h >= 9 && b.h <= 26 &&
      b.x1 - b.x0 > 13 && b.z1 - b.z0 > 13 && b.street && (b.district === 'midtown' || b.district === 'industrial' || b.district === 'docks'));
    for (let k = 0; k < 9 && cand.length; k++) {
      const b = cand.splice(dr.int(0, cand.length - 1), 1)[0];
      const side = [1, 2, 4, 8].filter((m) => b.street & m)[0];
      b.billboard = { side, ad: k % 4 };
      landmarks.billboards.push({ building: buildings.indexOf(b), side, ad: k % 4 });
    }
  }
  landmarks.windsock = { x: runway.x0 + 70, z: runway.z0 - 14 };
  for (let x = runway.x0; x <= runway.x1 + 0.1; x += 35.5) {
    landmarks.runwayLights.push({ x, z: runway.z0 - 1.4, color: 0xfff2d0 }, { x, z: runway.z1 + 1.4, color: 0xfff2d0 });
  }
  for (let k = 0; k < 6; k++) {
    const z = runway.z0 + 2.5 + k * ((runway.z1 - runway.z0 - 5) / 5);
    landmarks.runwayLights.push({ x: runway.x0 - 1.5, z, color: 0x40ff70 }, { x: runway.x1 + 1.5, z, color: 0xff4030 });
  }
  // Umbrellas on the sand at Pale Shore.
  for (let k = 0; k < 80; k++) {
    const th = Math.PI + dr.range(-0.95, 0.95);
    const r = radiusAt(th) - dr.range(3, 20);
    const x = Math.cos(th) * r, z = Math.sin(th) * r;
    if (x > -330 || piers.some((p) => x > p.x0 - 6 && x < p.x1 + 6 && z > p.z0 - 6 && z < p.z1 + 6)) continue;
    furniture.push({ type: 'umbrella', x, z, rot: dr.range(0, TAU), q: k % 3 === 0 ? 0 : 1, v: dr.next() });
  }

  // --- Military places (docs/ARMS.md section 3). Appended after every
  // random draw, with explicit colors and styles, so the rest of the
  // seeded city is exactly as before. ---
  const tankSpots = []; // { x, z, heading, spec }
  const roofPads = []; // { x, z, y, building }
  let depot;
  {
    // Ironbank Depot: the east end of the airfield islet. A concrete yard
    // fenced by low blast walls on the west, south and east, open to the
    // runway on the north (the flight line), with a 14 m road gate in the
    // west wall, two hangar sheds, a small office and tank bays.
    const D = { x0: islet.x0 + 520, z0: runway.z1 + 12, x1: islet.x1 - 40, z1: islet.z1 - 24 };
    depot = { ...D, gate: { x: D.x0, z: 0 } };
    const WALL = 0xb7b09c, WALL_H = 2.5, T = 1.2;
    const gz = Math.round((D.z0 + D.z1) / 2);
    depot.gate.z = gz;
    const put = (x0, z0, x1, z1, h, kind, style, color) => {
      buildings.push({ x0, z0, x1, z1, h, district: 'airfield', kind, color, style, tint: color, vseed: 32032 + buildings.length, block: -1, street: 0, depot: true });
    };
    const wall = (x0, z0, x1, z1) => put(x0, z0, x1, z1, WALL_H, 'container', 'container', WALL);
    // West wall with the gate, south wall, east wall, short north stubs.
    wall(D.x0, D.z0 + 30, D.x0 + T, gz - 7);
    wall(D.x0, gz + 7, D.x0 + T, D.z1);
    wall(D.x0, D.z1 - T, D.x1, D.z1);
    wall(D.x1 - T, D.z0 + 30, D.x1, D.z1);
    // Gate posts.
    put(D.x0 - 0.6, gz - 8, D.x0 + 1.8, gz - 7, 3.4, 'container', 'container', 0x8e8a7c);
    put(D.x0 - 0.6, gz + 7, D.x0 + 1.8, gz + 8, 3.4, 'container', 'container', 0x8e8a7c);
    // Hangar sheds (big doors face north into the yard) and the office.
    put(D.x0 + 40, D.z1 - 46, D.x0 + 88, D.z1 - 14, 11, 'warehouse', 'hangar', 0x7d8273);
    put(D.x0 + 104, D.z1 - 46, D.x0 + 152, D.z1 - 14, 11, 'warehouse', 'hangar', 0x7d8273);
    put(D.x0 + 12, gz + 18, D.x0 + 28, gz + 30, 5, 'building', 'office', 0xb8b4a6);
    // Tank bays: blast walls between the two parking spots.
    const bayZ = D.z1 - 74;
    for (const bx of [D.x0 + 48, D.x0 + 66, D.x0 + 84]) wall(bx - 0.6, bayZ - 8, bx + 0.6, bayZ + 6);
    // Sandbag-like barrier rows near the gate.
    wall(D.x0 + 8, gz - 22, D.x0 + 20, gz - 21);
    wall(D.x0 + 8, gz + 40, D.x0 + 20, gz + 41);
    for (const bx of [D.x0 + 57, D.x0 + 75]) tankSpots.push({ x: bx, z: bayZ, heading: -Math.PI / 2, spec: 'rustback', place: 'depot' });
    // Two fighters on the flight line facing the runway, a police heli pad.
    for (const fx of [D.x0 + 120, D.x0 + 160]) aircraftSpots.push({ x: fx, z: D.z0 + 34, heading: -Math.PI / 2, spec: 'fighter', depot: true });
    const pad = { x: D.x1 - 30, z: gz + 10 };
    helipads.push(pad);
    aircraftSpots.push({ ...pad, heading: Math.PI, spec: 'patrolheli', depot: true });
    surfaces.push({ x0: D.x0, z0: D.z0, x1: D.x1, z1: D.z1, type: 'apron', depot: true });
    pois.push({ type: 'depot', x: D.x0 + 110, z: gz, label: 'Ironbank Depot' });
  }
  // One Rustback in the easternmost Cinder Row open parking lot (by
  // position, not chance); curb and lot spaces within 6 m are cleared.
  {
    let best = null;
    for (const s of parkingSpots) if (s.lot && districtOf(s.x, s.z) === 'industrial' && (!best || s.x > best.x)) best = s;
    if (best) {
      tankSpots.push({ x: best.x, z: best.z, heading: best.heading, spec: 'rustback', place: 'cinder' });
      for (let i = parkingSpots.length - 1; i >= 0; i--) {
        const s = parkingSpots[i];
        if (Math.hypot(s.x - best.x, s.z - best.z) < 6) parkingSpots.splice(i, 1);
      }
    }
  }
  // Police roof pad: the midtown roof (16 x 16 m or more, 12..30 m high)
  // nearest the center; else the docks helipad.
  {
    let best = null, bd = Infinity;
    for (const b of buildings) {
      if (b.district !== 'midtown' || b.kind !== 'building' || b.x1 - b.x0 < 16 || b.z1 - b.z0 < 16 || b.h < 12 || b.h > 30) continue;
      const cx = (b.x0 + b.x1) / 2, cz = (b.z0 + b.z1) / 2;
      const d = Math.hypot(cx, cz);
      if (d < bd) {
        bd = d;
        best = b;
      }
    }
    if (best) roofPads.push({ x: (best.x0 + best.x1) / 2, z: (best.z0 + best.z1) / 2, y: best.h, building: buildings.indexOf(best) });
    else if (dockPad) roofPads.push({ x: dockPad.x, z: dockPad.z, y: 0, building: -1 });
    for (const r of roofPads) aircraftSpots.push({ x: r.x, z: r.z, heading: 0, spec: 'patrolheli', roof: true });
  }

  // --- Task 33: a Gannetfang on the west apron and a Lampwatch police heli
  // beside the airfield pads. Appended, no rng: the rest is unchanged. ---
  aircraftSpots.push(
    { x: islet.x0 + 90, z: runway.z1 + 34, heading: -Math.PI / 2, spec: 'fighter' },
    { x: islet.x0 + 448, z: runway.z1 + 40, heading: -Math.PI / 2, spec: 'patrolheli' },
  );

  return {
    seed, N, xs, zs, wx, wz, nodes, edges, blocks, buildings,
    props: cleanProps, parkingSpots, spawn,
    furniture, signals, landmarks, streetNames,
    extraLand, piers, pois, surfaces, aircraftSpots, boatSpots, helipads,
    tankSpots, roofPads, depot,
    airfield: { islet, runway, apron, gate },
    radiusAt, shoreDist, mainShore, isLand, isGround, districtOf, nodeAt, onRoad,
    size: BASE_R * 1.25,
    mapHalf: Math.max(BASE_R * 1.6, islet.x1 + 120),
  };
}

// The edge contract's lane fields for an island edge (docs/MAP.md "Edge
// contract"), chosen so the lanes stay exactly where they were: a street
// is 1 + 1 lanes of 4.0 m (centers 2.0 m off the line), an avenue 2 + 2
// lanes of 3.5 m round a 1.7 m painted center (centers 2.6 and 6.1 m).
export function islandProfile(width) {
  if (width === AVENUE_W) return { lanesF: 2, lanesB: 2, laneW: 3.5, parkL: 0.85, parkR: 0.85, median: 0, center: 1.7, oneway: false, name: '' };
  return { lanesF: 1, lanesB: 1, laneW: 4.0, parkL: 1.2, parkR: 1.2, median: 0, center: 0, oneway: false, name: '' };
}

// Center-line offset of a driving lane, measured to the right of the
// node line seen in the direction of travel (docs/MAP.md "Edge
// contract"): lane 0 next to the divide. `forward`: travel a -> b. Edges
// without the contract's fields (old saves, hand-made edges) keep the old
// rule: streets one lane 2.0 m off, avenues 2.6 and 6.1 m.
export function laneOffset(edge, lane = 0, forward = true) {
  if (edge.lanesF === undefined) {
    if (edge.avenue) return lane === 0 ? 2.6 : 6.1;
    return 2.0;
  }
  return profileLaneOffset(edge, lane, forward);
}
// Lanes carrying traffic in one direction (forward: a -> b).
export function lanesPerDirection(edge, forward = true) {
  if (edge.lanesF === undefined) return edge.avenue ? 2 : 1;
  const n = forward ? edge.lanesF : edge.lanesB;
  // Backward on a one-way: the forward lanes (callers check canDrive).
  return n > 0 ? n : edge.lanesF || 1;
}
// False only for a one-way edge entered from its b end.
export const canDrive = (edge, from) => !edge.oneway || from === edge.a;

// World position on a lane. `from` is the node id being driven away
// from, `d` is meters traveled from that node's center.
export function lanePoint(city, edge, from, d, lane = 0, out = { x: 0, z: 0, heading: 0 }) {
  const a = city.nodes[from];
  const b = city.nodes[edge.a === from ? edge.b : edge.a];
  const dx = (b.x - a.x) / edge.length, dz = (b.z - a.z) / edge.length;
  const off = laneOffset(edge, lane, edge.a === from);
  // Right-hand side of travel direction (dx,dz) is (-dz, dx).
  out.x = a.x + dx * d - dz * off;
  out.z = a.z + dz * d + dx * off;
  out.heading = Math.atan2(dz, dx);
  return out;
}

// Traffic-light state for traffic traveling along an edge into a
// signaled junction: 'green', 'amber' or 'red'.
export function signalState(node, horizontal, time) {
  if (!node.signal) return 'green';
  const cycle = 24;
  const t = (time + node.id * 7) % cycle;
  const mine = horizontal ? t : (t + cycle / 2) % cycle;
  if (mine < 9) return 'green';
  if (mine < 11.5) return 'amber';
  return 'red';
}
