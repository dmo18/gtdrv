// Turns the generated city data into three.js objects.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { ChunkedBuilder } from './meshbuilder.js';
import { createRng, TAU } from '../core/rng.js';

const COL = {
  asphalt: 0x3a3d42,
  junction: 0x36393e,
  line: 0xd8d4c8,
  yellow: 0xd9a833,
  sidewalk: 0x9c9a94,
  kerb: 0x7f7d78,
  grass: 0x5d8f4e,
  parkGrass: 0x5f9a50,
  sand: 0xe3d2a4,
  water: 0x2a7c9e,
};

function shade(hex, f) {
  const r = Math.min(255, ((hex >> 16) & 255) * f) | 0;
  const g = Math.min(255, ((hex >> 8) & 255) * f) | 0;
  const b = Math.min(255, (hex & 255) * f) | 0;
  return (r << 16) | (g << 8) | b;
}

// A tileable facade: 4 window bays by 4 floors.
function makeWindowTexture(rng) {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = '#f2f2f2';
  g.fillRect(0, 0, 128, 128);
  for (let fy = 0; fy < 4; fy++) {
    for (let fx = 0; fx < 4; fx++) {
      const lum = rng.chance(0.2) ? 150 : rng.int(52, 84);
      g.fillStyle = `rgb(${lum - 12},${lum},${lum + 22})`;
      g.fillRect(fx * 32 + 6, fy * 32 + 7, 20, 19);
      g.fillStyle = 'rgba(255,255,255,0.18)';
      g.fillRect(fx * 32 + 6, fy * 32 + 7, 20, 4);
    }
    g.fillStyle = 'rgba(0,0,0,0.10)';
    g.fillRect(0, fy * 32 + 30, 128, 2);
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

function colored(geom, hex) {
  const c = new THREE.Color().setHex(hex, THREE.SRGBColorSpace);
  const n = geom.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    arr[i * 3] = c.r;
    arr[i * 3 + 1] = c.g;
    arr[i * 3 + 2] = c.b;
  }
  geom.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  geom.deleteAttribute('uv');
  return geom.index ? geom.toNonIndexed() : geom;
}

function instanced(geom, material, items, place) {
  if (!items.length) return null;
  const mesh = new THREE.InstancedMesh(geom, material, items.length);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const s = new THREE.Vector3();
  const p = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);
  items.forEach((it, i) => {
    place(it, p, q, s, up);
    m.compose(p, q, s);
    mesh.setMatrixAt(i, m);
  });
  mesh.instanceMatrix.needsUpdate = true;
  mesh.computeBoundingSphere();
  mesh.matrixAutoUpdate = false;
  return mesh;
}

export function buildCityMesh(city, collision) {
  const rng = createRng(city.seed + 99);
  const group = new THREE.Group();
  group.name = 'city';
  const S = city.size;
  const TILES = 5;

  const plainMat = new THREE.MeshLambertMaterial({ vertexColors: true });
  const windowMat = new THREE.MeshLambertMaterial({ vertexColors: true, map: makeWindowTexture(rng) });
  const lineMat = new THREE.MeshBasicMaterial({ vertexColors: true, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  const groundMat = new THREE.MeshLambertMaterial({ vertexColors: true, polygonOffset: true, polygonOffsetFactor: 2, polygonOffsetUnits: 2 });

  // --- Sea, sand and grass. ---
  const water = new THREE.Mesh(
    new THREE.PlaneGeometry(9000, 9000).rotateX(-Math.PI / 2),
    new THREE.MeshLambertMaterial({ color: new THREE.Color().setHex(COL.water, THREE.SRGBColorSpace) }),
  );
  water.position.y = -0.5;
  water.name = 'water';
  group.add(water);

  function landDisc(inset, y, hex) {
    const SEG = 160;
    const pos = [0, y, 0];
    const idx = [];
    for (let i = 0; i < SEG; i++) {
      const th = (i / SEG) * TAU;
      const r = city.radiusAt(th) - inset;
      pos.push(Math.cos(th) * r, y, Math.sin(th) * r);
      idx.push(0, 1 + ((i + 1) % SEG), 1 + i);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    const mesh = new THREE.Mesh(colored(g, hex), groundMat);
    mesh.matrixAutoUpdate = false;
    return mesh;
  }
  group.add(landDisc(-14, -0.12, COL.sand));
  group.add(landDisc(30, -0.06, COL.grass));

  // --- Extra land (airfield islet, causeway), piers and aprons. ---
  {
    const eb = new ChunkedBuilder(S * 2.4, 4);
    for (const r of city.extraLand || []) {
      eb.at((r.x0 + r.x1) / 2, (r.z0 + r.z1) / 2).box(r.x0, r.z0, r.x1, r.z1, -3, -0.06, COL.kerb, COL.grass);
    }
    for (const r of city.piers || []) {
      const b = eb.at((r.x0 + r.x1) / 2, (r.z0 + r.z1) / 2);
      b.box(r.x0, r.z0, r.x1, r.z1, -0.25, 0.1, 0x6b5136, 0x8a6b48);
      // Posts along both long sides.
      const alongX = r.x1 - r.x0 > r.z1 - r.z0;
      const len = alongX ? r.x1 - r.x0 : r.z1 - r.z0;
      for (let d = 2; d < len; d += 8) {
        for (const side of [0, 1]) {
          const px = alongX ? r.x0 + d : side ? r.x1 : r.x0;
          const pz = alongX ? (side ? r.z1 : r.z0) : r.z0 + d;
          b.box(px - 0.2, pz - 0.2, px + 0.2, pz + 0.2, -3, 0.7, 0x4f3b28);
        }
      }
    }
    eb.buildInto(group, groundMat);
    const sb = new ChunkedBuilder(S * 2.4, 4);
    const mb = new ChunkedBuilder(S * 2.4, 4);
    for (const r of city.surfaces || []) {
      const cx = (r.x0 + r.x1) / 2, cz = (r.z0 + r.z1) / 2;
      sb.at(cx, cz).flat(r.x0, r.z0, r.x1, r.z1, 0, r.type === 'runway' ? 0x2f3236 : 0x4a4d52);
      if (r.type === 'runway') {
        const m = mb.at(cx, cz);
        for (let x = r.x0 + 40; x < r.x1 - 50; x += 30) m.flat(x, cz - 0.3, x + 15, cz + 0.3, 0.015, COL.line);
        for (let k = 0; k < 6; k++) {
          const z = r.z0 + 3 + k * ((r.z1 - r.z0 - 6) / 5.6);
          m.flat(r.x0 + 6, z, r.x0 + 26, z + 1.6, 0.015, COL.line);
          m.flat(r.x1 - 26, z, r.x1 - 6, z + 1.6, 0.015, COL.line);
        }
        m.flat(r.x0, r.z0 + 0.4, r.x1, r.z0 + 0.8, 0.015, COL.line);
        m.flat(r.x0, r.z1 - 0.8, r.x1, r.z1 - 0.4, 0.015, COL.line);
      }
    }
    for (const h of city.helipads || []) {
      const m = mb.at(h.x, h.z);
      sb.at(h.x, h.z).flat(h.x - 9, h.z - 9, h.x + 9, h.z + 9, 0.005, 0x3a3d42);
      m.flat(h.x - 8, h.z - 8, h.x + 8, h.z - 7.4, 0.02, COL.yellow);
      m.flat(h.x - 8, h.z + 7.4, h.x + 8, h.z + 8, 0.02, COL.yellow);
      m.flat(h.x - 8, h.z - 8, h.x - 7.4, h.z + 8, 0.02, COL.yellow);
      m.flat(h.x + 7.4, h.z - 8, h.x + 8, h.z + 8, 0.02, COL.yellow);
      m.flat(h.x - 3, h.z - 4, h.x - 2, h.z + 4, 0.02, COL.line);
      m.flat(h.x + 2, h.z - 4, h.x + 3, h.z + 4, 0.02, COL.line);
      m.flat(h.x - 2, h.z - 0.5, h.x + 2, h.z + 0.5, 0.02, COL.line);
    }
    sb.buildInto(group, plainMat);
    mb.buildInto(group, lineMat, 1);
  }

  // --- Roads and painted lines. ---
  const roads = new ChunkedBuilder(S, TILES);
  const lines = new ChunkedBuilder(S, TILES);
  const LY = 0.015;
  for (const n of city.nodes) {
    const hx = n.hx, hz = n.hz;
    roads.at(n.x, n.z).flat(n.x - hx, n.z - hz, n.x + hx, n.z + hz, 0, COL.junction);
  }
  for (const e of city.edges) {
    const a = city.nodes[e.a], b = city.nodes[e.b];
    const half = e.width / 2;
    const mx = (a.x + b.x) / 2, mz = (a.z + b.z) / 2;
    const rb = roads.at(mx, mz), lb = lines.at(mx, mz);
    if (e.horizontal) {
      const x0 = a.x + a.hx, x1 = b.x - b.hx;
      rb.flat(x0, a.z - half, x1, a.z + half, 0, COL.asphalt);
      // Stop lines.
      lb.flat(x0 + 0.6, a.z - half + 0.3, x0 + 1.1, a.z - 0.2, LY, COL.line);
      lb.flat(x1 - 1.1, a.z + 0.2, x1 - 0.6, a.z + half - 0.3, LY, COL.line);
      if (e.avenue) {
        lb.flat(x0 + 2, a.z - 0.35, x1 - 2, a.z - 0.15, LY, COL.yellow);
        lb.flat(x0 + 2, a.z + 0.15, x1 - 2, a.z + 0.35, LY, COL.yellow);
        for (let x = x0 + 4; x < x1 - 6; x += 9) {
          lb.flat(x, a.z - 4.42, x + 3, a.z - 4.28, LY, COL.line);
          lb.flat(x, a.z + 4.28, x + 3, a.z + 4.42, LY, COL.line);
        }
      } else {
        for (let x = x0 + 4; x < x1 - 6; x += 9) lb.flat(x, a.z - 0.08, x + 3, a.z + 0.08, LY, COL.yellow);
      }
    } else {
      const z0 = a.z + a.hz, z1 = b.z - b.hz;
      rb.flat(a.x - half, z0, a.x + half, z1, 0, COL.asphalt);
      lb.flat(a.x + 0.2, z0 + 0.6, a.x + half - 0.3, z0 + 1.1, LY, COL.line);
      lb.flat(a.x - half + 0.3, z1 - 1.1, a.x - 0.2, z1 - 0.6, LY, COL.line);
      if (e.avenue) {
        lb.flat(a.x - 0.35, z0 + 2, a.x - 0.15, z1 - 2, LY, COL.yellow);
        lb.flat(a.x + 0.15, z0 + 2, a.x + 0.35, z1 - 2, LY, COL.yellow);
        for (let z = z0 + 4; z < z1 - 6; z += 9) {
          lb.flat(a.x - 4.42, z, a.x - 4.28, z + 3, LY, COL.line);
          lb.flat(a.x + 4.28, z, a.x + 4.42, z + 3, LY, COL.line);
        }
      } else {
        for (let z = z0 + 4; z < z1 - 6; z += 9) lb.flat(a.x - 0.08, z, a.x + 0.08, z + 3, LY, COL.yellow);
      }
    }
  }
  roads.buildInto(group, plainMat);
  lines.buildInto(group, lineMat, 1);

  // --- Pavements (raised block bases) and buildings. ---
  const plain = new ChunkedBuilder(S, TILES);
  const windows = new ChunkedBuilder(S, TILES, true);
  for (const b of city.blocks) {
    const top = b.district === 'park' ? COL.parkGrass : COL.sidewalk;
    plain.at((b.x0 + b.x1) / 2, (b.z0 + b.z1) / 2).box(b.x0, b.z0, b.x1, b.z1, -0.05, 0.16, COL.kerb, top);
  }
  for (const b of city.buildings) {
    const cx = (b.x0 + b.x1) / 2, cz = (b.z0 + b.z1) / 2;
    const pb = plain.at(cx, cz);
    collision.addBox(b.x0, b.z0, b.x1, b.z1, b.h, b.kind);
    if (b.kind === 'container') {
      pb.box(b.x0, b.z0, b.x1, b.z1, 0.16, 0.16 + b.h, b.color, shade(b.color, 0.8));
    } else if (b.kind === 'warehouse') {
      pb.box(b.x0, b.z0, b.x1, b.z1, 0.16, b.h, b.color, shade(b.color, 0.65));
      // A darker loading-door band along the base.
      pb.walls(b.x0 - 0.05, b.z0 - 0.05, b.x1 + 0.05, b.z1 + 0.05, 0.16, 1.2, shade(b.color, 0.55));
    } else if (b.kind === 'house') {
      pb.walls(b.x0, b.z0, b.x1, b.z1, 0.16, b.h, b.color);
      // Pitched roof along the longer side.
      const roof = rng.pick([0x8a4b3a, 0x5c5f66, 0x70523c, 0x4d5f6e]);
      const rh = 2.4, e = 0.5;
      const x0 = b.x0 - e, x1 = b.x1 + e, z0 = b.z0 - e, z1 = b.z1 + e;
      if (b.x1 - b.x0 >= b.z1 - b.z0) {
        const mz = (z0 + z1) / 2, k = Math.hypot(rh, mz - z0);
        pb.quad(x0, b.h, z1, x1, b.h, z1, x1, b.h + rh, mz, x0, b.h + rh, mz, roof, 0, (mz - z0) / k, rh / k);
        pb.quad(x1, b.h, z0, x0, b.h, z0, x0, b.h + rh, mz, x1, b.h + rh, mz, roof, 0, (mz - z0) / k, -rh / k);
        pb.tri(x1, b.h, z1, x1, b.h, z0, x1, b.h + rh, mz, b.color, 1, 0, 0);
        pb.tri(x0, b.h, z0, x0, b.h, z1, x0, b.h + rh, mz, b.color, -1, 0, 0);
      } else {
        const mx = (x0 + x1) / 2, k = Math.hypot(rh, mx - x0);
        pb.quad(x1, b.h, z1, x1, b.h, z0, mx, b.h + rh, z0, mx, b.h + rh, z1, roof, rh / k, (mx - x0) / k, 0);
        pb.quad(x0, b.h, z0, x0, b.h, z1, mx, b.h + rh, z1, mx, b.h + rh, z0, roof, -rh / k, (mx - x0) / k, 0);
        pb.tri(x0, b.h, z1, x1, b.h, z1, mx, b.h + rh, z1, b.color, 0, 0, 1);
        pb.tri(x1, b.h, z0, x0, b.h, z0, mx, b.h + rh, z0, b.color, 0, 0, -1);
      }
      // Front door hint.
      pb.walls(cx - 0.6, b.z1, cx + 0.6, b.z1 + 0.06, 0.16, 2.2, shade(roof, 0.8));
    } else {
      const wb = windows.at(cx, cz);
      // Shopfront base, then the windowed tower above it.
      const base = Math.min(4, b.h * 0.3);
      pb.walls(b.x0, b.z0, b.x1, b.z1, 0.16, base, shade(b.color, 0.6));
      wb.walls(b.x0, b.z0, b.x1, b.z1, base, b.h, b.color, 12, 14);
      pb.flat(b.x0, b.z0, b.x1, b.z1, b.h, shade(b.color, 0.5));
      // Roof clutter on bigger buildings.
      if (b.h > 25 && b.x1 - b.x0 > 12 && b.z1 - b.z0 > 12) {
        const rx = rng.range(b.x0 + 2, b.x1 - 7), rz = rng.range(b.z0 + 2, b.z1 - 7);
        pb.box(rx, rz, rx + 5, rz + 5, b.h, b.h + rng.range(2, 5), shade(b.color, 0.7));
      }
    }
  }
  plain.buildInto(group, plainMat);
  windows.buildInto(group, windowMat);

  // --- Trees, palms and street lamps (instanced). ---
  const trunk = colored(new THREE.CylinderGeometry(0.07, 0.11, 1, 5).translate(0, 0.5, 0), 0x6b4a33);
  const crown = colored(new THREE.IcosahedronGeometry(1, 0).scale(1, 0.42, 1).translate(0, 0.95, 0), 0x3f7f3c);
  const treeGeom = mergeGeometries([trunk, crown]);
  const palmTrunk = colored(new THREE.CylinderGeometry(0.025, 0.04, 1, 5).translate(0, 0.5, 0), 0x8a6a4a);
  const fronds = colored(new THREE.ConeGeometry(0.38, 0.14, 6).translate(0, 1.0, 0), 0x4c9a52);
  const palmGeom = mergeGeometries([palmTrunk, fronds]);
  const pole = colored(new THREE.BoxGeometry(0.16, 1, 0.16).translate(0, 0.5, 0), 0x4a4d52);
  const arm = colored(new THREE.BoxGeometry(2, 0.018, 0.12).translate(1, 0.99, 0), 0x4a4d52);
  const lampHead = colored(new THREE.BoxGeometry(0.7, 0.012, 0.3).translate(1.75, 0.975, 0), 0xfff2c4);
  const lampGeom = mergeGeometries([pole, arm, lampHead]);

  const trees = city.props.filter((p) => p.type === 'tree');
  const palms = city.props.filter((p) => p.type === 'palm');
  const lamps = city.props.filter((p) => p.type === 'lamp');
  for (const p of trees) collision.addCircle(p.x, p.z, p.r, p.h, 'tree');
  for (const p of palms) collision.addCircle(p.x, p.z, 0.3, p.h, 'tree');

  const placeTree = (it, p, q, s, up) => {
    p.set(it.x, 0, it.z);
    q.setFromAxisAngle(up, (it.x * 12.9898 + it.z * 78.233) % TAU);
    s.set(it.h * 0.33, it.h, it.h * 0.33);
  };
  const treeMesh = instanced(treeGeom, plainMat, trees, placeTree);
  const palmMesh = instanced(palmGeom, plainMat, palms, (it, p, q, s, up) => {
    placeTree(it, p, q, s, up);
    s.set(it.h * 1.1, it.h, it.h * 1.1);
  });
  const lampMesh = instanced(lampGeom, plainMat, lamps, (it, p, q, s, up) => {
    p.set(it.x, 0, it.z);
    q.setFromAxisAngle(up, -(it.rot || 0));
    s.set(1, it.h, 1);
  });
  for (const m of [treeMesh, palmMesh, lampMesh]) if (m) group.add(m);

  group.userData = { water, materials: { plainMat, windowMat, lineMat, groundMat }, lamps };
  return group;
}
