// The real-map renderer (world/miami.js cities, docs/MAP.md milestone 3).
// The whole data box (about 9 km by 8 km, 34k building boxes) is far too
// much to build in full detail at start: it took over 1.5 GB of memory
// and 15 s on this machine. So it is drawn at two levels of detail:
//
// - far: at start, one coarse mesh per SUPER x SUPER block of tiles for
//   the whole map (land on a 20 m grid, roads as plain strips, every
//   building as a box with a lit-window pattern worked out in the
//   shader). One draw call per block.
// - near: full detail (citymesh's ground, buildings.js, props.js) for
//   each TILE m square close to the camera, built a slice at a time in
//   the render loop (a few ms per frame, never in the fixed step) and
//   thrown away again when the camera has moved far off. Past MID_R the
//   small stuff of a near tile (paint, decals, contact shadows, street
//   props, signs) is hidden: the middle level.
//
// The far mesh hides the tiles that are shown near in its vertex shader
// (a tiny mask texture, one texel per tile), so the two never overlap.
// Collision, street lamps and traffic-light bulbs are set up once for
// the whole map, whatever is drawn.
import * as THREE from 'three';
import { ChunkedBuilder, MeshBuilder } from './meshbuilder.js';
import { createTextures } from './textures.js';
import { addBuilding, shade } from './buildings.js';
import { addProps } from './props.js';
import { fillCollision } from '../world/collision.js';
import { makeMaterials, COL, addSurfaces, addBlock, realLand, realRoads, orientedQuad, ROAD_PIECE } from './citymesh.js';

export const TILE = 300; // m, a near-detail tile
export const SUPER = 4; // tiles per far block side
export const LOD = { near: 340, mid: 170, build: 520, drop: 860, hyst: 40 };
const FAR_LAND_Y = -0.3, FAR_ROAD_Y = -0.1;
const WINDOW_STYLES = new Set(['glass', 'office', 'brick', 'stucco']);

// Builders that draw nothing (the one-off pass that only wants the side
// effects: collision circles, lamp and glow lists).
const NOOP = () => undefined;
const NULL_MB = new Proxy({}, { get: () => NOOP });
const NULL_B = { at: () => NULL_MB };

// Material for the far blocks: vertex colours, near tiles masked out in
// the vertex shader, windows (darker glass by day, some lit at night)
// from the world position in the fragment shader. emissiveIntensity is
// driven by the day/night system like the facade materials.
function makeFarMaterial(mask, nx, ny) {
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0, emissive: 0xffd2a0, emissiveIntensity: 0 });
  mat.name = 'far';
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uNear = { value: mask };
    shader.uniforms.uNearN = { value: new THREE.Vector2(nx, ny) };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
attribute float aTile;
attribute float aWin;
uniform sampler2D uNear;
uniform vec2 uNearN;
varying vec3 vRwW;
varying vec3 vRwN;
varying float vRwWin;`)
      .replace('#include <project_vertex>', `#include <project_vertex>
	vRwW = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;
	vRwN = normal;
	vRwWin = aWin;
	vec2 rwT = vec2( mod( aTile, uNearN.x ), floor( aTile / uNearN.x ) );
	if ( texture2D( uNear, ( rwT + 0.5 ) / uNearN ).r > 0.5 ) gl_Position = vec4( 2.0, 2.0, 2.0, 1.0 );`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
varying vec3 vRwW;
varying vec3 vRwN;
varying float vRwWin;`)
      .replace('#include <color_fragment>', `#include <color_fragment>
	float rwWin = 0.0, rwLit = 0.0;
	if ( vRwWin > 0.5 && abs( vRwN.y ) < 0.5 ) {
		float rwAlong = abs( vRwN.x ) > 0.5 ? vRwW.z : vRwW.x;
		vec2 rwC = vec2( rwAlong / 3.1, ( vRwW.y - 0.8 ) / 3.4 );
		vec2 rwF = fract( rwC );
		rwWin = step( 0.18, rwF.x ) * step( rwF.x, 0.82 ) * step( 0.28, rwF.y ) * step( rwF.y, 0.86 ) * step( 1.0, rwC.y );
		float rwH = fract( sin( dot( floor( rwC ) + floor( vRwW.xz * 0.05 ), vec2( 12.9898, 78.233 ) ) ) * 43758.5453 );
		// Far off the pattern turns into its average (no shimmer).
		float rwFade = smoothstep( 450.0, 1100.0, length( vRwW - cameraPosition ) );
		rwLit = mix( rwWin * step( 0.6, rwH ), 0.16, rwFade );
		rwWin = mix( rwWin, 0.45, rwFade );
	}
	diffuseColor.rgb *= 1.0 - 0.3 * rwWin;`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
	totalEmissiveRadiance *= rwLit;`);
  };
  mat.customProgramCacheKey = () => 'rw-far';
  return mat;
}

// Grows typed arrays for one far block.
class FarChunks {
  constructor() {
    this.parts = [];
    this.verts = 0;
    this.idx = 0;
  }
  push(mb, tile, win) {
    if (!mb.count) return;
    this.parts.push({ pos: new Float32Array(mb.pos), nor: new Float32Array(mb.nor), col: new Float32Array(mb.col), idx: Uint32Array.from(mb.idx), tile, win, n: mb.count });
    this.verts += mb.count;
    this.idx += mb.idx.length;
  }
  build(material) {
    if (!this.verts) return null;
    const N = this.verts;
    const pos = new Float32Array(N * 3), nor = new Float32Array(N * 3), col = new Float32Array(N * 3);
    const tile = new Float32Array(N), win = new Float32Array(N);
    const idx = N > 65535 ? new Uint32Array(this.idx) : new Uint16Array(this.idx);
    let v = 0, k = 0;
    for (const p of this.parts) {
      pos.set(p.pos, v * 3);
      nor.set(p.nor, v * 3);
      col.set(p.col, v * 3);
      tile.fill(p.tile, v, v + p.n);
      win.fill(p.win, v, v + p.n);
      for (let i = 0; i < p.idx.length; i++) idx[k + i] = p.idx[i] + v;
      v += p.n;
      k += p.idx.length;
    }
    this.parts = null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setAttribute('aTile', new THREE.BufferAttribute(tile, 1));
    g.setAttribute('aWin', new THREE.BufferAttribute(win, 1));
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    g.computeBoundingSphere();
    const m = new THREE.Mesh(g, material);
    m.matrixAutoUpdate = false;
    m.name = 'far';
    return m;
  }
}

// One tile's builders, the same set citymesh uses for the whole map,
// plus street props on their own (hidden at the middle level).
const TILE_KEYS = [
  ['asphalt', true, 8], ['ground', true, 6], ['land', true, 10], ['pavement', true, 4.8], ['grass', true, 10], ['wood', true, 2],
  ['paint', true, 2], ['decal', true, 1], ['ao', false, 1], ['plain', false, 1], ['detail', true, 1], ['glow', false, 1],
  ['glass', true, 1], ['brick', true, 1], ['office', true, 1], ['stucco', true, 1], ['siding', true, 1], ['corrugated', true, 1],
  ['roofing', true, 1], ['shopfront', true, 1], ['props', false, 1], ['propsDetail', true, 1],
];
// key: material, draw options, hidden at the middle level
function tileMeshPlan(M) {
  const ground = { receive: true }, solid = { cast: true, receive: true };
  return [
    ['asphalt', M.asphaltMat, ground], ['ground', M.groundMat, ground], ['land', M.landMat, ground], ['pavement', M.pavementMat, ground],
    ['grass', M.grassMat, ground], ['wood', M.woodMat, ground],
    ['paint', M.paintMat, { order: 1, receive: true }, true], ['decal', M.decalMat, { order: 2, receive: true }, true], ['ao', M.aoMat, { order: 3 }, true],
    ['plain', M.plainMat, solid], ['detail', M.detailMat, solid, true], ['glow', M.glowMat, {}, true],
    ['glass', M.glass, { ...solid, name: 'facade-glass' }], ['brick', M.brick, { ...solid, name: 'facade-brick' }],
    ['office', M.office, { ...solid, name: 'facade-office' }], ['stucco', M.stucco, { ...solid, name: 'facade-stucco' }],
    ['siding', M.siding, { ...solid, name: 'facade-siding' }], ['corrugated', M.corrugated, { ...solid, name: 'facade-corrugated' }],
    ['roofing', M.roofing, { ...solid, name: 'facade-roofing' }], ['shopfront', M.shopfront, { ...solid, name: 'facade-shopfront' }],
    ['props', M.plainMat, { ...solid, name: 'props' }, true], ['propsDetail', M.detailMat, { ...solid, name: 'props-detail' }, true],
  ];
}

export function buildRealCity(city, collision) {
  const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
  const tStart = now();
  const group = new THREE.Group();
  group.name = 'city';
  const S = city.size;
  const names = city.streetNames ? [...city.streetNames.x.slice(0, 16), ...city.streetNames.z.slice(0, 16)] : [];
  const T = createTextures(city.seed + 7, names);
  const M = makeMaterials(T);
  const DR = T.decals.rects, R = T.details.rects;
  const timings = {};
  let tm = tStart;
  const lap = (k) => { const t = now(); timings[k] = Math.round(t - tm); tm = t; };

  // Sea placeholder (the game swaps in the animated sea).
  const water = new THREE.Mesh(
    new THREE.PlaneGeometry(Math.max(9000, S * 5), Math.max(9000, S * 5)).rotateX(-Math.PI / 2),
    new THREE.MeshLambertMaterial({ color: new THREE.Color().setHex(COL.water, THREE.SRGBColorSpace) }),
  );
  water.position.y = -0.5;
  water.name = 'water';
  group.add(water);

  // ---- The tile grid over the city's raster bounds. ----
  const bx0 = city.bounds.x0, bz0 = city.bounds.z0;
  const NX = Math.ceil((city.bounds.x1 - bx0) / TILE), NZ = Math.ceil((city.bounds.z1 - bz0) / TILE);
  const NT = NX * NZ;
  const tileOf = (x, z) => {
    const i = Math.max(0, Math.min(NX - 1, Math.floor((x - bx0) / TILE)));
    const j = Math.max(0, Math.min(NZ - 1, Math.floor((z - bz0) / TILE)));
    return j * NX + i;
  };
  const tiles = [];
  for (let k = 0; k < NT; k++) {
    const i = k % NX, j = (k - i) / NX;
    tiles.push({
      k, x0: bx0 + i * TILE, z0: bz0 + j * TILE, x1: bx0 + (i + 1) * TILE, z1: bz0 + (j + 1) * TILE,
      buildings: [], blocks: [], nodes: [], edges: [], bulbs: [],
      group: null, small: null, shown: false, mid: false, meshes: null,
    });
  }
  for (const b of city.buildings) tiles[tileOf((b.x0 + b.x1) / 2, (b.z0 + b.z1) / 2)].buildings.push(b);
  for (const b of city.blocks) tiles[tileOf((b.x0 + b.x1) / 2, (b.z0 + b.z1) / 2)].blocks.push(b);
  for (const n of city.nodes) tiles[tileOf(n.x, n.z)].nodes.push(n);
  {
    // An edge goes to every tile one of its road pieces (or its middle) is in.
    const mark = new Int32Array(NT).fill(-1);
    for (const e of city.edges) {
      const a = city.nodes[e.a], b = city.nodes[e.b];
      const add = (x, z) => {
        const k = tileOf(x, z);
        if (mark[k] !== e.id) { mark[k] = e.id; tiles[k].edges.push(e); }
      };
      add((a.x + b.x) / 2, (a.z + b.z) / 2);
      const n = Math.max(1, Math.ceil(e.length / (ROAD_PIECE / 3)));
      for (let s = 0; s <= n; s++) add(a.x + ((b.x - a.x) * s) / n, a.z + ((b.z - a.z) * s) / n);
    }
  }
  lap('index');

  // ---- Whole map, once: collision, lamps, bulbs, glows. ----
  fillCollision(city, collision);
  const glows = [];
  const groundY = makeGroundY(city);
  const Cnull = { city, collision, R, DR, glows, groundY };
  for (const k of TILE_KEYS) Cnull[k[0]] = NULL_B;
  // Mast lights on the tall towers (buildings.js adds them as it draws).
  for (const b of city.buildings) if (b.h > 72 && b.style !== 'house' && b.style !== 'container' && b.kind !== 'warehouse') addBuilding(Cnull, b);
  const { lamps, bulbs: allBulbs } = addProps(Cnull, null, true);
  for (const b of allBulbs) tiles[tileOf(b.x, b.z)].bulbs.push(b);
  lap('global');

  // ---- Far blocks: the whole map, coarse. ----
  const mask = new THREE.DataTexture(new Uint8Array(NT), NX, NZ, THREE.RedFormat, THREE.UnsignedByteType);
  mask.magFilter = mask.minFilter = THREE.NearestFilter;
  mask.generateMipmaps = false;
  mask.unpackAlignment = 1;
  mask.needsUpdate = true;
  const farMat = makeFarMaterial(mask, NX, NZ);
  M.farMat = farMat;
  const farRoot = new THREE.Group();
  farRoot.name = 'far';
  group.add(farRoot);
  {
    const G = city.landGrid, s = 4;
    const SX = Math.ceil(NX / SUPER), SZ = Math.ceil(NZ / SUPER);
    const supers = [];
    for (let k = 0; k < SX * SZ; k++) supers.push(new FarChunks());
    const plain = new MeshBuilder(false), win = new MeshBuilder(false);
    const one = { at: () => plain };
    const LB = { land: one, ground: one, pavement: one };
    const nI = Math.floor((G.w - 1) / s), nJ = Math.floor((G.h - 1) / s);
    const coarse = (v, o) => Math.ceil(((v - o) / G.cell - 0.5) / s);
    for (const t of tiles) {
      plain.pos.length = plain.col.length = plain.nor.length = plain.idx.length = 0;
      plain.count = 0;
      win.pos.length = win.col.length = win.nor.length = win.idx.length = 0;
      win.count = 0;
      // Land, one coarse cell over each side (the near tiles cover it).
      const i0 = Math.max(0, coarse(t.x0, G.x0) - 1), i1 = Math.min(nI, coarse(t.x1, G.x0) + 1);
      const j0 = Math.max(0, coarse(t.z0, G.z0) - 1), j1 = Math.min(nJ, coarse(t.z1, G.z0) + 1);
      if (i1 > i0 && j1 > j0) realLand(city, LB, i0, i1, j0, j1, s, FAR_LAND_Y, false);
      // Roads: one strip per piece.
      for (const e of t.edges) {
        const a = city.nodes[e.a], b = city.nodes[e.b];
        const n = Math.max(1, Math.round(e.length / ROAD_PIECE));
        const half = e.width / 2, rx = -e.uz * half, rz = e.ux * half;
        for (let q = 0; q < n; q++) {
          const x0 = a.x + ((b.x - a.x) * q) / n, z0 = a.z + ((b.z - a.z) * q) / n;
          const x1 = a.x + ((b.x - a.x) * (q + 1)) / n, z1 = a.z + ((b.z - a.z) * (q + 1)) / n;
          if (tileOf((x0 + x1) / 2, (z0 + z1) / 2) !== t.k) continue;
          orientedQuad(plain, x0 + rx, z0 + rz, x1 + rx, z1 + rz, x1 - rx, z1 - rz, x0 - rx, z0 - rz, FAR_ROAD_Y, 0x55585d);
        }
      }
      // Runway, aprons and piers.
      for (const r of city.surfaces || []) {
        if (tileOf((r.x0 + r.x1) / 2, (r.z0 + r.z1) / 2) === t.k) plain.flat(r.x0, r.z0, r.x1, r.z1, FAR_ROAD_Y, r.type === 'runway' ? COL.runway : COL.apron);
      }
      for (const r of city.piers || []) {
        if (tileOf((r.x0 + r.x1) / 2, (r.z0 + r.z1) / 2) === t.k) plain.box(r.x0, r.z0, r.x1, r.z1, -0.25, 0.1, 0x8a6b48, 0xb89a72);
      }
      // Buildings: one box each.
      for (const b of t.buildings) {
        const wall = b.style === 'glass' ? shade(b.tint, 0.95) : b.style === 'container' ? b.color : shade(b.color, 0.92);
        const roof = b.style === 'house' ? 0x9a6a58 : shade(b.color, 0.78);
        (WINDOW_STYLES.has(b.style) ? win : plain).box(b.x0, b.z0, b.x1, b.z1, FAR_LAND_Y, b.h, wall, roof, 0.75, 1);
      }
      const sk = Math.floor((t.k % NX) / SUPER) + Math.floor(Math.floor(t.k / NX) / SUPER) * SX;
      supers[sk].push(plain, t.k, 0);
      supers[sk].push(win, t.k, 1);
    }
    for (const sc of supers) {
      const m = sc.build(farMat);
      if (m) farRoot.add(m);
    }
  }
  lap('far');

  // ---- Traffic-light lamps: one instanced mesh holding the bulbs of the
  // near tiles only (graphics.js colours them; `version` tells it the
  // list changed). ----
  const CAP = 4096;
  const sigGeo = new THREE.CircleGeometry(0.115, 6).rotateY(Math.PI / 2);
  const signalMesh = new THREE.InstancedMesh(sigGeo, new THREE.MeshBasicMaterial({ toneMapped: false }), CAP);
  signalMesh.count = 0;
  signalMesh.matrixAutoUpdate = false;
  signalMesh.name = 'signal-lamps';
  {
    const dark = new THREE.Color(0.02, 0.02, 0.02);
    for (let i = 0; i < CAP; i++) signalMesh.setColorAt(i, dark);
    signalMesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    signalMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  }
  group.add(signalMesh);
  const signals = { mesh: signalMesh, bulbs: [], cap: CAP, version: 0 };
  const m4 = new THREE.Matrix4(), q4 = new THREE.Quaternion(), p4 = new THREE.Vector3(), s4 = new THREE.Vector3(1, 1, 1), up = new THREE.Vector3(0, 1, 0);
  function refillBulbs() {
    const list = signals.bulbs;
    list.length = 0;
    for (const t of tiles) {
      if (!t.shown) continue;
      for (const b of t.bulbs) {
        if (list.length >= CAP) break;
        p4.set(b.x, b.y, b.z);
        q4.setFromAxisAngle(up, -b.face);
        m4.compose(p4, q4, s4);
        signalMesh.setMatrixAt(list.length, m4);
        list.push(b);
      }
    }
    signalMesh.count = list.length;
    signalMesh.instanceMatrix.needsUpdate = true;
    signalMesh.computeBoundingSphere();
    signals.version++;
  }

  // ---- Windsock: its own mesh so it can swing with the wind. ----
  let windsock = null;
  const ws = city.landmarks && city.landmarks.windsock;
  if (ws) {
    const g = new THREE.CylinderGeometry(0.42, 0.14, 3.2, 8, 1, true).rotateZ(Math.PI / 2).translate(1.7, 0, 0);
    windsock = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: 0xf06a20, side: THREE.DoubleSide, roughness: 0.8 }));
    windsock.position.set(ws.x, 5.9, ws.z);
    windsock.castShadow = true;
    windsock.name = 'windsock';
    group.add(windsock);
  }

  // ---- Near tiles. ----
  const plan = tileMeshPlan(M);
  const tiered = [];
  const ud = {
    water, materials: M,
    glowMats: [M.glass, M.brick, M.office, M.stucco, M.shopfront, M.detailMat, farMat],
    wet: M.wet, lamps, glows, signals, windsock, tiered, textures: T, buildMs: 0, timings,
  };

  // One tile, built a slice at a time: yields between pieces of work.
  function* tileJob(t) {
    const B = {};
    for (const [key, uv, scale] of TILE_KEYS) B[key] = new ChunkedBuilder(1e7, 1, uv, scale);
    const own = (x, z) => tileOf(x, z) === t.k;
    const C = { city, collision: null, ...B, R, DR, glows: [], groundY };
    const G = city.landGrid;
    const di = (v, o) => Math.max(0, Math.min(G.w - 1, Math.ceil((v - o) / G.cell - 0.5)));
    const dj = (v, o) => Math.max(0, Math.min(G.h - 1, Math.ceil((v - o) / G.cell - 0.5)));
    const i0 = di(t.x0, G.x0), i1 = di(t.x1, G.x0), j0 = dj(t.z0, G.z0), j1 = dj(t.z1, G.z0);
    for (let j = j0; j < j1; j += 10) {
      realLand(city, B, i0, i1, j, Math.min(j1, j + 10));
      yield;
    }
    realRoads(city, B, t.nodes, t.edges, own);
    yield;
    for (const b of t.blocks) addBlock(B, b, DR);
    addSurfaces(city, B, DR, own);
    yield;
    for (let n = 0; n < t.buildings.length; n++) {
      addBuilding(C, t.buildings[n]);
      if (n % 16 === 15) yield;
    }
    yield;
    addProps({ ...C, plain: B.props, detail: B.propsDetail }, own, false);
    yield;
    const g = new THREE.Group();
    g.name = 'tile';
    const small = [], meshes = [];
    for (const [key, mat, opts, isSmall] of plan) {
      const made = B[key].buildInto(g, mat, opts);
      for (const m of made) {
        meshes.push(m);
        if (isSmall) small.push(m);
        if (m.userData.tierCounts) {
          m.geometry.setDrawRange(0, m.userData.tierCounts[ud.tier ?? 1]);
          tiered.push(m);
        }
      }
      B[key] = null;
      yield;
    }
    t.group = g;
    t.small = small;
    t.meshes = meshes;
    t.mid = false;
    g.visible = false;
    group.add(g);
  }

  function dropTile(t) {
    if (!t.group) return;
    group.remove(t.group);
    for (const m of t.meshes) {
      m.geometry.dispose();
      const i = tiered.indexOf(m);
      if (i >= 0) tiered.splice(i, 1);
    }
    t.group = t.small = t.meshes = null;
    if (t.shown) {
      t.shown = false;
      mask.image.data[t.k] = 0;
      mask.needsUpdate = true;
    }
  }

  // ---- The streamer: called every drawn frame with the camera. ----
  let job = null, jobTile = null;
  const stats = { built: 0, dropped: 0, buildMs: 0, worstSliceMs: 0, near: 0 };
  function dist(t, x, z, hy) {
    const dx = x < t.x0 ? t.x0 - x : x > t.x1 ? x - t.x1 : 0;
    const dz = z < t.z0 ? t.z0 - z : z > t.z1 ? z - t.z1 : 0;
    return Math.sqrt(dx * dx + dz * dz + hy * hy);
  }
  // budgetMs: time for tile building this frame (Infinity: finish every
  // tile that should be near now, e.g. at start or for a screenshot).
  function update(camera, budgetMs = 3) {
    const x = camera.position.x, z = camera.position.z, hy = Math.max(0, camera.position.y) * 0.6;
    let changed = false, best = null, bd = Infinity, near = 0;
    for (let k = 0; k < NT; k++) {
      const t = tiles[k];
      const d = dist(t, x, z, hy);
      if (t.group) {
        const show = d < (t.shown ? LOD.near + LOD.hyst : LOD.near);
        if (show !== t.shown) {
          t.shown = show;
          t.group.visible = show;
          mask.image.data[k] = show ? 255 : 0;
          changed = true;
        }
        if (show) {
          near++;
          const mid = d > (t.mid ? LOD.mid - LOD.hyst / 2 : LOD.mid);
          if (mid !== t.mid) {
            t.mid = mid;
            for (const m of t.small) m.visible = !mid;
          }
        } else if (d > LOD.drop && t !== jobTile) {
          dropTile(t);
          stats.dropped++;
        }
      } else if (t !== jobTile && d < LOD.build && d < bd) {
        bd = d;
        best = t;
      }
    }
    stats.near = near;
    // A tile right under the camera that is not ready yet gets more time.
    const urgent = (jobTile && dist(jobTile, x, z, hy) < LOD.near * 0.5) || (best && bd < LOD.near * 0.5);
    const budget = budgetMs === Infinity ? Infinity : urgent ? Math.max(budgetMs, 10) : budgetMs;
    const t0 = now();
    while (now() - t0 < budget) {
      if (!job) {
        if (!best) break;
        if (budgetMs === Infinity && bd >= LOD.near) break;
        jobTile = best;
        job = tileJob(best);
        best = null;
      }
      const s0 = now();
      const r = job.next();
      stats.worstSliceMs = Math.max(stats.worstSliceMs, now() - s0);
      if (r.done) {
        stats.built++;
        const t = jobTile;
        job = jobTile = null;
        const d = dist(t, x, z, hy);
        if (d < LOD.near) {
          t.shown = true;
          t.group.visible = true;
          mask.image.data[t.k] = 255;
          changed = true;
          t.mid = d > LOD.mid;
          for (const m of t.small) m.visible = !t.mid;
        }
        if (budgetMs === Infinity) {
          // Look for the next one that should be near.
          best = null;
          bd = Infinity;
          for (const u of tiles) {
            if (u.group) continue;
            const du = dist(u, x, z, hy);
            if (du < LOD.near && du < bd) { bd = du; best = u; }
          }
        }
      }
    }
    stats.buildMs += now() - t0;
    if (changed) {
      mask.needsUpdate = true;
      refillBulbs();
    }
  }
  // Every tile near the point, now (start, screenshots, tests).
  function flush(camera) {
    update(camera, Infinity);
  }
  ud.stream = { update, flush, stats, tiles, tileOf, NX, NZ, LOD };

  // Start: the tiles round the spawn point.
  flush({ position: { x: city.spawn.x, y: 2, z: city.spawn.z } });
  lap('near');
  ud.buildMs = now() - tStart;
  group.userData = ud;
  return group;
}

// Height of the ground something stands on (as citymesh).
function makeGroundY(city) {
  const blockAt = city.blockAt;
  const onExtra = (x, z) => (city.extraLand || []).some((r) => x >= r.x0 && x <= r.x1 && z >= r.z0 && z <= r.z1);
  return (x, z) => (blockAt(x, z) ? 0.16 : city.mainShore(x, z) > 30 || onExtra(x, z) ? -0.06 : -0.12);
}

