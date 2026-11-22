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
import { lookOf } from './miamilook.js';
import { addProps } from './props.js';
import { fillCollision } from '../world/collision.js';
import { makeMaterials, COL, addSurfaces, addBlock, realLand, realRoads, orientedQuad, ROAD_PIECE } from './citymesh.js';
import { lotGround, lotJob, lotsByTile, setSolids } from './lotmesh.js';
import { dressLot } from '../world/lots.js';

export const TILE = 300; // m, a near-detail tile
export const SUPER = 4; // tiles per far block side
export const LOD = { near: 340, mid: 170, build: 520, drop: 860, hyst: 40 };
const FAR_LAND_Y = -0.3, FAR_ROAD_Y = -0.1;
const WINDOW_STYLES = new Set(['glass', 'office', 'brick', 'stucco', 'havana']);
// Longest piece of tile work between two yields (ms): a slice ends at
// the first break point past this, so slices stay well under 5 ms.
export const SLICE_MS = 2;
const PROP_PIECE = 16;

function releaseArray() {
  this.array = null;
}

// A tile builder (one ChunkedBuilder cell, up to three quality tiers)
// turned into one mesh a slice at a time: the vertex arrays are copied
// into typed arrays in pieces, so a big tile never costs one long frame.
// The mesh (or nothing) is left in out[0]. Same result as buildInto.
const COPY = 120000; // numbers per piece
function* copyInto(dst, src, at, over, add = 0) {
  for (let i = 0; i < src.length; i += COPY) {
    const e = Math.min(src.length, i + COPY);
    if (add) for (let k = i; k < e; k++) dst[at + k] = src[k] + add;
    else for (let k = i; k < e; k++) dst[at + k] = src[k];
    if (over()) yield 'mesh';
  }
}
function* buildSliced(cb, material, o, over, out, sub = 0) {
  const parts = [cb.map.get(sub * 3), cb.map.get(sub * 3 + 1), cb.map.get(sub * 3 + 2)];
  let nv = 0, ni = 0;
  for (const p of parts) if (p) { nv += p.count; ni += p.idx.length; }
  if (!nv) return;
  const uv = cb.withUv;
  const pos = new Float32Array(nv * 3), col = new Float32Array(nv * 3), nor = new Float32Array(nv * 3), uvs = uv ? new Float32Array(nv * 2) : null;
  const idx = nv > 65535 ? new Uint32Array(ni) : new Uint16Array(ni);
  const tiered = !!(parts[1] || parts[2]);
  const counts = [];
  let v = 0, k = 0;
  for (const p of parts) {
    if (p) {
      yield* copyInto(pos, p.pos, v * 3, over);
      yield* copyInto(col, p.col, v * 3, over);
      yield* copyInto(nor, p.nor, v * 3, over);
      if (uvs) {
        if (p.uv) yield* copyInto(uvs, p.uv, v * 2, over);
      }
      yield* copyInto(idx, p.idx, k, over, v);
      v += p.count;
      k += p.idx.length;
    }
    counts.push(k);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  if (uvs) geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geo.setIndex(new THREE.BufferAttribute(idx, 1));
  if (over()) yield 'mesh';
  geo.computeBoundingSphere();
  const m = new THREE.Mesh(geo, material);
  m.matrixAutoUpdate = false;
  if (tiered) {
    m.userData.tierCounts = counts;
    geo.setDrawRange(0, counts[1]);
  }
  m.renderOrder = o.order || 0;
  m.castShadow = !!o.cast;
  m.receiveShadow = !!o.receive;
  if (o.name) m.name = o.name;
  out[0] = m;
}

// A tile builder split in 2 by 2 quarters (150 m): the heavy meshes of a
// tile (trees, lot dressing, props) so the camera and the shadow map
// each draw only the quarters they see. Same interface as a one-cell
// ChunkedBuilder; map keys are quarter * 3 + tier.
class QuarterBuilder {
  constructor(t, withUv, uvScale) {
    this.cx = (t.x0 + t.x1) / 2;
    this.cz = (t.z0 + t.z1) / 2;
    this.withUv = withUv;
    this.uvScale = uvScale;
    this.subs = 4;
    this.map = new Map();
  }
  at(x, z, q = 0) {
    const k = ((z < this.cz ? 0 : 2) + (x < this.cx ? 0 : 1)) * 3 + q;
    let b = this.map.get(k);
    if (!b) this.map.set(k, (b = new MeshBuilder(this.withUv, this.uvScale)));
    return b;
  }
}
const QUARTERED = new Set(['plain', 'treeDetail', 'props', 'ao']);

// Builders that draw nothing (the one-off pass that only wants the side
// effects: collision circles, lamp and glow lists).
const NOOP = () => undefined;
const NULL_MB = new Proxy({}, { get: () => NOOP });
const NULL_B = { at: () => NULL_MB };

// Material for the far blocks: vertex colours, near tiles masked out in
// the vertex shader, windows (darker glass by day, some lit at night)
// from the world position in the fragment shader. emissiveIntensity is
// driven by the day/night system like the facade materials.
// aWin: 0 no windows, 1 a tower or block grid (3.1 by 3.4 m), 2 small
// house and shop windows (4 by 3 m, sparser, fewer lit). The near tiles
// are left out of the index buffers (FarChunks.compact), not masked.
function makeFarMaterial() {
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0, emissive: 0xffd2a0, emissiveIntensity: 0 });
  mat.name = 'far';
  mat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
attribute float aWin;
varying vec3 vRwW;
varying vec3 vRwN;
varying float vRwWin;`)
      .replace('#include <project_vertex>', `#include <project_vertex>
	vRwW = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;
	vRwN = normal;
	vRwWin = aWin;`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
varying vec3 vRwW;
varying vec3 vRwN;
varying float vRwWin;`)
      .replace('#include <color_fragment>', `#include <color_fragment>
	float rwWin = 0.0, rwLit = 0.0;
	if ( vRwWin > 0.5 && abs( vRwN.y ) < 0.5 ) {
		float rwAlong = abs( vRwN.x ) > 0.5 ? vRwW.z : vRwW.x;
		bool rwSmall = vRwWin > 1.5;
		vec2 rwC = rwSmall ? vec2( rwAlong / 4.0, ( vRwW.y - 0.2 ) / 3.0 ) : vec2( rwAlong / 3.1, ( vRwW.y - 0.8 ) / 3.4 );
		vec2 rwF = fract( rwC );
		rwWin = rwSmall
			? step( 0.3, rwF.x ) * step( rwF.x, 0.7 ) * step( 0.32, rwF.y ) * step( rwF.y, 0.78 )
			: step( 0.18, rwF.x ) * step( rwF.x, 0.82 ) * step( 0.28, rwF.y ) * step( rwF.y, 0.86 ) * step( 1.0, rwC.y );
		float rwH = fract( sin( dot( floor( rwC ) + floor( vRwW.xz * 0.05 ), vec2( 12.9898, 78.233 ) ) ) * 43758.5453 );
		// Far off the pattern turns into its average (no shimmer).
		float rwFade = smoothstep( 450.0, 1100.0, length( vRwW - cameraPosition ) );
		rwLit = mix( rwWin * step( rwSmall ? 0.7 : 0.6, rwH ), 0.16, rwFade );
		rwWin = mix( rwWin, rwSmall ? 0.2 : 0.45, rwFade );
		// A darker shop or lobby band at street level.
		if ( !rwSmall ) diffuseColor.rgb *= mix( 0.78, 1.0, step( 4.0, vRwW.y ) );
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
  // lvl 0: always drawn; 1: only while the block is near (FAR_DETAIL).
  push(mb, tile, win, lvl = 0) {
    if (!mb.count) return;
    this.parts.push({ pos: new Float32Array(mb.pos), nor: new Float32Array(mb.nor), col: new Float32Array(mb.col), idx: Uint32Array.from(mb.idx), tile, win, lvl, n: mb.count });
    this.verts += mb.count;
    this.idx += mb.idx.length;
  }
  build(material) {
    if (!this.verts) return null;
    const N = this.verts;
    const pos = new Float32Array(N * 3), nor = new Float32Array(N * 3), col = new Float32Array(N * 3);
    const win = new Float32Array(N);
    const idx = N > 65535 ? new Uint32Array(this.idx) : new Uint16Array(this.idx);
    // Index ranges per tile (parts of one tile are pushed together).
    const ranges = [];
    let v = 0, k = 0;
    for (const p of this.parts) {
      pos.set(p.pos, v * 3);
      nor.set(p.nor, v * 3);
      col.set(p.col, v * 3);
      win.fill(p.win, v, v + p.n);
      for (let i = 0; i < p.idx.length; i++) idx[k + i] = p.idx[i] + v;
      const last = ranges.length ? ranges[ranges.length - 1] : null;
      if (last && last.tile === p.tile && last.lvl === p.lvl && last.start + last.count === k) last.count += p.idx.length;
      else ranges.push({ tile: p.tile, lvl: p.lvl, start: k, count: p.idx.length });
      v += p.n;
      k += p.idx.length;
    }
    this.parts = null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setAttribute('aWin', new THREE.BufferAttribute(win, 1));
    // The drawn index is a copy with the near tiles' ranges left out.
    g.setIndex(new THREE.BufferAttribute(idx.slice(), 1));
    g.index.setUsage(THREE.DynamicDrawUsage);
    g.computeBoundingSphere();
    const m = new THREE.Mesh(g, material);
    m.matrixAutoUpdate = false;
    m.name = 'far';
    m.userData.far = { full: idx, ranges, state: new Uint8Array(ranges.length).fill(2) };
    return m;
  }
}

// Rebuilds a far block's drawn index without the tiles shown near
// (near[k] 1), and without the detail level (small buildings, parapets,
// roof plant) of tiles far off (detail[k] 0). Returns true when
// something changed.
export function compactFar(mesh, near, detail) {
  const F = mesh.userData.far;
  let dirty = false;
  const on = (R) => (near[R.tile] || (R.lvl && !detail[R.tile]) ? 0 : 1);
  for (let r = 0; r < F.ranges.length; r++) if (F.state[r] !== on(F.ranges[r])) { dirty = true; break; }
  if (!dirty) return false;
  const out = mesh.geometry.index.array, full = F.full;
  let n = 0;
  for (let r = 0; r < F.ranges.length; r++) {
    const R = F.ranges[r];
    F.state[r] = on(R);
    if (!F.state[r]) continue;
    out.set(full.subarray(R.start, R.start + R.count), n);
    n += R.count;
  }
  mesh.geometry.setDrawRange(0, n);
  mesh.geometry.index.needsUpdate = true;
  mesh.visible = n > 0;
  return true;
}

// One building of the far level: walls (with the window pattern when
// its builder is the window one), and a roof that reads at a distance:
// a hipped roof on houses, a parapet and roof plant on flat roofs.
const FAR_PARAPET = 0.8;
// Small buildings (lower than this) are far detail: off past FAR_DETAIL.
export const FAR_SMALL_H = 9;
export const FAR_DETAIL = 900; // m from the camera to a tile's edge
// walls, plain: the always-drawn level; detail: parapets and roof plant.
// The caller passes detail-level builders as walls and plain for a
// small building.
export function farBuilding(walls, plain, b, wall, roof, y0, house, detail = plain) {
  const { x0, z0, x1, z1, h } = b;
  const dx = x1 - x0, dz = z1 - z0;
  if (house) {
    walls.walls(x0, z0, x1, z1, y0, h, wall, 1, 1, 0.75, 1);
    const along = dx >= dz, rh = Math.min(3.2, 0.32 * Math.min(dx, dz));
    const e = 0.35;
    if (along) {
      const mz = (z0 + z1) / 2, ia = x0 + dz / 2, ib = x1 - dz / 2;
      const ra = Math.min(ia, (x0 + x1) / 2), rb = Math.max(ib, (x0 + x1) / 2);
      plain.quad(x0 - e, h, z1 + e, x1 + e, h, z1 + e, rb, h + rh, mz, ra, h + rh, mz, roof, 0, 0.8, 0.6);
      plain.quad(x1 + e, h, z0 - e, x0 - e, h, z0 - e, ra, h + rh, mz, rb, h + rh, mz, roof, 0, 0.8, -0.6, 0, 0, 1, 1, 0.82);
      plain.tri(x1 + e, h, z1 + e, x1 + e, h, z0 - e, rb, h + rh, mz, roof, 0.6, 0.8, 0, 0, 0, 0, 0, 0, 0, 0.9);
      plain.tri(x0 - e, h, z0 - e, x0 - e, h, z1 + e, ra, h + rh, mz, roof, -0.6, 0.8, 0, 0, 0, 0, 0, 0, 0, 0.9);
    } else {
      const mx = (x0 + x1) / 2, ia = z0 + dx / 2, ib = z1 - dx / 2;
      const ra = Math.min(ia, (z0 + z1) / 2), rb = Math.max(ib, (z0 + z1) / 2);
      plain.quad(x1 + e, h, z1 + e, x1 + e, h, z0 - e, mx, h + rh, ra, mx, h + rh, rb, roof, 0.6, 0.8, 0);
      plain.quad(x0 - e, h, z0 - e, x0 - e, h, z1 + e, mx, h + rh, rb, mx, h + rh, ra, roof, -0.6, 0.8, 0, 0, 0, 1, 1, 0.82);
      plain.tri(x0 - e, h, z1 + e, x1 + e, h, z1 + e, mx, h + rh, rb, roof, 0, 0.8, 0.6, 0, 0, 0, 0, 0, 0, 0.9);
      plain.tri(x1 + e, h, z0 - e, x0 - e, h, z0 - e, mx, h + rh, ra, roof, 0, 0.8, -0.6, 0, 0, 0, 0, 0, 0, 0.9);
    }
    return;
  }
  if (h < 9 || dx < 6 || dz < 6) {
    walls.walls(x0, z0, x1, z1, y0, h, wall, 1, 1, 0.75, 1);
    plain.flat(x0, z0, x1, z1, h, roof);
    return;
  }
  // Parapet: the walls go on up past the roof, a lighter cap on top.
  const top = h + FAR_PARAPET, inset = 0.45;
  walls.walls(x0, z0, x1, z1, y0, h, wall, 1, 1, 0.75, 1);
  plain.flat(x0, z0, x1, z1, h, roof);
  detail.walls(x0, z0, x1, z1, h, top, wall, 1, 1, 1, 1.04);
  detail.ring(x0, z0, x1, z1, inset, top, shadeHexF(wall, 1.12));
  detail.innerWalls(x0 + inset, z0 + inset, x1 - inset, z1 - inset, h, top, shadeHexF(roof, 0.8), 0.7, 0.9);
  // Roof plant on bigger roofs: a lift room or cooling units.
  if (h >= 20 && dx * dz >= 400) {
    const u = ((b.vseed | 0) >>> 3) % 7;
    const w = Math.min(dx, dz) * (0.22 + u * 0.02);
    const cx = (x0 + x1) / 2 + (u - 3) * dx * 0.04, cz = (z0 + z1) / 2 - (u - 3) * dz * 0.03;
    detail.box(cx - w, cz - w * 0.7, cx + w, cz + w * 0.7, h, h + 2.6 + (u % 3), 0xb8b6b0, 0x8e8c88, 0.75, 1);
  }
}
function shadeHexF(hex, f) {
  const r = Math.min(255, ((hex >> 16) & 255) * f) | 0;
  const g = Math.min(255, ((hex >> 8) & 255) * f) | 0;
  const c = Math.min(255, (hex & 255) * f) | 0;
  return (r << 16) | (g << 8) | c;
}

// One tile's builders, the same set citymesh uses for the whole map,
// plus street props on their own (hidden at the middle level).
const TILE_KEYS = [
  ['asphalt', true, 8], ['ground', true, 6], ['land', true, 10], ['pavement', true, 4.8], ['grass', true, 10], ['wood', true, 2],
  ['paint', true, 2], ['decal', true, 1], ['ao', false, 1], ['plain', false, 1], ['detail', true, 1], ['glow', false, 1],
  ['glass', true, 1], ['brick', true, 1], ['office', true, 1], ['stucco', true, 1], ['siding', true, 1], ['corrugated', true, 1],
  ['roofing', true, 1], ['shopfront', true, 1], ['props', false, 1], ['propsDetail', true, 1], ['havana', true, 1], ['treeDetail', true, 1],
  ['sand', true, 6],
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
    ['havana', M.havana, { ...solid, name: 'facade-havana' }],
    // Trees and palms stay drawn at the middle level (no pop-in): trunks
    // and canopies go in 'plain', palm fronds here.
    ['treeDetail', M.detailMat, { ...solid, name: 'trees-detail' }],
    // Lot ground in sand and dirt (beaches, building sites).
    ['sand', M.lotSandMat, ground],
  ];
}

export function buildRealCity(city, collision, opts = {}) {
  const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
  const tStart = now();
  const group = new THREE.Group();
  group.name = 'city';
  const S = city.size;
  // Sign plates: the short forms of the street names (city.streetNames.plates).
  const sn = city.streetNames;
  const names = sn ? sn.plates || [...sn.x.slice(0, 16), ...sn.z.slice(0, 16)] : [];
  // opts.textures: a stand-in set (node timing runs have no canvas).
  const T = opts.textures || createTextures(city.seed + 7, names);
  const M = makeMaterials(T);
  // Sand and dirt lots sit over the land: no push back (sandMat has one).
  M.lotSandMat = M.sandMat.clone();
  M.lotSandMat.polygonOffset = false;
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
  const { lamps, bulbs: allBulbs, palms } = addProps(Cnull, null, true);
  for (const b of allBulbs) tiles[tileOf(b.x, b.z)].bulbs.push(b);
  // Street items by tile, so a tile's prop pass looks only at its own.
  for (const t of tiles) t.lists = { props: [], furniture: [], signals: [], palms: [] };
  for (const p of city.props) tiles[tileOf(p.x, p.z)].lists.props.push(p);
  for (const f of city.furniture || []) tiles[tileOf(f.x, f.z)].lists.furniture.push(f);
  for (const sg of city.signals || []) tiles[tileOf(sg.x, sg.z)].lists.signals.push(sg);
  for (let i = 0; i < palms.length; i += 3) tiles[tileOf(palms[i], palms[i + 1])].lists.palms.push(palms[i], palms[i + 1], palms[i + 2]);
  lap('global');

  // ---- Far blocks: the whole map, coarse. ----
  // 1 where a tile is shown near (its far copy is left out).
  const nearMask = new Uint8Array(NT);
  // 1 where a tile's far copy shows its detail level (FAR_DETAIL).
  const farDetail = new Uint8Array(NT);
  let farChanged = false;
  const farMeshes = [];
  const farMat = makeFarMaterial();
  M.farMat = farMat;
  const farRoot = new THREE.Group();
  farRoot.name = 'far';
  group.add(farRoot);
  // Built at start, and again when the city's lots change (dev scripts).
  function buildFar() {
    for (const m of farMeshes) { farRoot.remove(m); m.geometry.dispose(); }
    farMeshes.length = 0;
    const G = city.landGrid, s = 4;
    const SX = Math.ceil(NX / SUPER), SZ = Math.ceil(NZ / SUPER);
    const supers = [];
    for (let k = 0; k < SX * SZ; k++) supers.push(new FarChunks());
    const plain = new MeshBuilder(false), win = new MeshBuilder(false), small = new MeshBuilder(false);
    const plainD = new MeshBuilder(false), winD = new MeshBuilder(false), smallD = new MeshBuilder(false);
    const all = [plain, win, small, plainD, winD, smallD];
    const one = { at: () => plain };
    const LB = { land: one, ground: one, pavement: one };
    const nI = Math.floor((G.w - 1) / s), nJ = Math.floor((G.h - 1) / s);
    const coarse = (v, o) => Math.ceil(((v - o) / G.cell - 0.5) / s);
    for (const t of tiles) {
      for (const mb of all) {
        mb.pos.length = mb.col.length = mb.nor.length = mb.idx.length = 0;
        mb.count = 0;
      }
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
        const L = lookOf(city, b);
        const st = L ? L.style : b.style;
        const wall = L ? (st === 'glass' ? shade(L.tint, 0.9) : shade(L.wall, 0.9)) : b.style === 'glass' ? shade(b.tint, 0.95) : b.style === 'container' ? b.color : shade(b.color, 0.92);
        const roof = L ? (st === 'house' || L.tile ? L.roof : shade(L.roof, 0.85)) : b.style === 'house' ? 0x9a6a58 : shade(b.color, 0.78);
        const house = st === 'house';
        const lo = b.h < FAR_SMALL_H;
        const smallW = WINDOW_STYLES.has(st) ? b.h <= 12 && st !== 'glass' && st !== 'office' : house;
        const walls = WINDOW_STYLES.has(st) || house ? (smallW ? (lo ? smallD : small) : lo ? winD : win) : lo ? plainD : plain;
        farBuilding(walls, lo ? plainD : plain, b, wall, roof, FAR_LAND_Y, house, plainD);
      }
      const sk = Math.floor((t.k % NX) / SUPER) + Math.floor(Math.floor(t.k / NX) / SUPER) * SX;
      supers[sk].push(plain, t.k, 0);
      supers[sk].push(win, t.k, 1);
      supers[sk].push(small, t.k, 2);
      supers[sk].push(plainD, t.k, 0, 1);
      supers[sk].push(winD, t.k, 1, 1);
      supers[sk].push(smallD, t.k, 2, 1);
    }
    for (const sc of supers) {
      const m = sc.build(farMat);
      if (m) { farRoot.add(m); farMeshes.push(m); }
    }
    for (const m of farMeshes) compactFar(m, nearMask, farDetail);
  }
  buildFar();
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
    glowMats: [M.glass, M.brick, M.office, M.stucco, M.havana, M.shopfront, M.detailMat, farMat],
    wet: M.wet, lamps, glows, signals, windsock, tiered, textures: T, buildMs: 0, timings,
  };

  // Lots by tile (docs/REVAMP.md 6.2), worked out the first time a tile
  // needs them and again if the city's lot list is replaced.
  let lotTiles = null, lotSrc = null;
  const lotStats = { lots: 0, features: 0, tris: {} };
  function lotsOf(t) {
    if (!city.lots) return [];
    if (lotSrc !== city.lots) { lotSrc = city.lots; lotTiles = lotsByTile(city, tileOf, NT); }
    return lotTiles[t.k];
  }
  // dressLot (src/world/lots.js), or another one with the same contract
  // passed in by the caller (tests, fixtures).
  const dress = opts.dressLot || dressLot;
  const dressOf = () => dress;

  // One tile, built a slice at a time: yields between pieces of work,
  // at the first break point after SLICE_MS of work.
  function* tileJob(t) {
    let ts = now();
    const over = () => now() - ts > SLICE_MS;
    const B = {};
    for (const [key, uv, scale] of TILE_KEYS) B[key] = QUARTERED.has(key) ? new QuarterBuilder(t, uv, scale) : new ChunkedBuilder(1e7, 1, uv, scale);
    const own = (x, z) => tileOf(x, z) === t.k;
    const C = { city, collision: null, ...B, R, DR, glows: [], groundY };
    const G = city.landGrid;
    const di = (v, o) => Math.max(0, Math.min(G.w - 1, Math.ceil((v - o) / G.cell - 0.5)));
    const dj = (v, o) => Math.max(0, Math.min(G.h - 1, Math.ceil((v - o) / G.cell - 0.5)));
    const i0 = di(t.x0, G.x0), i1 = di(t.x1, G.x0), j0 = dj(t.z0, G.z0), j1 = dj(t.z1, G.z0);
    // Lot cells of this tile (the lot grid shares the land raster).
    const ci = (v, o, n) => Math.max(0, Math.min(n, Math.round((v - o) / G.cell)));
    const li0 = ci(t.x0, G.x0, G.w), li1 = ci(t.x1, G.x0, G.w), lj0 = ci(t.z0, G.z0, G.h), lj1 = ci(t.z1, G.z0, G.h);
    for (let j = j0; j < j1; j += 10) {
      realLand(city, B, i0, i1, j, Math.min(j1, j + 10));
      if (over()) { yield 'land'; ts = now(); }
    }
    for (let j = lj0; j < lj1; j += 20) {
      lotGround(city, B, li0, li1, j, Math.min(lj1, j + 20));
      if (over()) { yield 'lotGround'; ts = now(); }
    }
    realRoads(city, B, t.nodes, [], own);
    for (let a = 0; a < t.edges.length; a += 12) {
      realRoads(city, B, [], t.edges.slice(a, a + 12), own);
      if (over()) { yield 'roads'; ts = now(); }
    }
    for (const b of t.blocks) addBlock(B, b, DR);
    addSurfaces(city, B, DR, own);
    for (let n = 0; n < t.buildings.length; n++) {
      addBuilding(C, t.buildings[n]);
      if (over()) { yield 'buildings'; ts = now(); }
    }
    yield 'buildings';
    ts = now();
    // Street props: the one-off pieces first, then the tile's items in
    // pieces of PROP_PIECE.
    const PC = { ...C, plain: B.props, detail: B.propsDetail, trees: B.plain, treesDetail: B.treeDetail };
    const TL = t.lists;
    addProps(PC, own, false, { props: [], furniture: [], signals: [], palms: [] });
    if (over()) { yield 'props'; ts = now(); }
    const nItems = Math.max(TL.props.length, TL.furniture.length, TL.signals.length, TL.palms.length / 3);
    for (let a = 0; a < nItems; a += PROP_PIECE) {
      const e = a + PROP_PIECE;
      addProps(PC, own, false, { props: TL.props.slice(a, e), furniture: TL.furniture.slice(a, e), signals: TL.signals.slice(a, e), palms: TL.palms.slice(a * 3, e * 3), extras: false });
      if (over()) { yield 'props'; ts = now(); }
    }
    // Lot dressing: solids and trees stay drawn at the middle level,
    // small things (bins, paint, fences, towels) hide with the props.
    // Collision shapes are made the first time and switched on and off
    // with the tile after that (dressLot gives the same list each time).
    const firstSolids = !t.solids;
    if (firstSolids) t.solids = [];
    else setSolids(t.solids, true);
    const LC = {
      city, R, DR, groundY, collision: firstSolids ? collision : null, solids: firstSolids ? t.solids : null, lotStats,
      props: B.props, solid: B.plain, detail: B.propsDetail, paint: B.paint, pavement: B.pavement, ao: B.ao, glow: B.glow,
      plain: B.props, trees: B.plain, treesDetail: B.treeDetail,
    };
    const idxOf = (k) => { let n = 0; for (const mb of B[k].map.values()) n += mb.idx.length; return n; };
    const before = {};
    for (const [k] of TILE_KEYS) before[k] = idxOf(k);
    for (const step of lotJob(LC, lotsOf(t), dressOf(), over)) { yield step; ts = now(); }
    // Triangles the lots added, by builder (perf.mjs reports them).
    for (const [k] of TILE_KEYS) {
      const d = (idxOf(k) - before[k]) / 3;
      if (d) lotStats.tris[k] = (lotStats.tris[k] || 0) + d;
    }
    const tileTris = {};
    for (const [k] of TILE_KEYS) tileTris[k] = idxOf(k) / 3;
    t.tris = tileTris;
    const g = new THREE.Group();
    g.name = 'tile';
    const small = [], meshes = [];
    for (const [key, mat, opts, isSmall] of plan) {
      for (let sub = 0; sub < (B[key].subs || 1); sub++) {
      const holder = [];
      for (const step of buildSliced(B[key], mat, opts, over, holder, sub)) { yield step; ts = now(); }
      const m = holder[0];
      if (m) {
        g.add(m);
        // Once on the GPU the vertex arrays are not needed in memory
        // (nothing reads tile geometry back; bounds are already set).
        for (const k in m.geometry.attributes) m.geometry.attributes[k].onUpload(releaseArray);
        if (m.geometry.index) m.geometry.index.onUpload(releaseArray);
        meshes.push(m);
        if (isSmall) small.push(m);
        if (m.userData.tierCounts) {
          m.geometry.setDrawRange(0, m.userData.tierCounts[ud.tier ?? 1]);
          tiered.push(m);
        }
      }
      }
      B[key] = null;
      if (over()) { yield 'mesh'; ts = now(); }
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
    if (t.solids) setSolids(t.solids, false);
    group.remove(t.group);
    for (const m of t.meshes) {
      m.geometry.dispose();
      const i = tiered.indexOf(m);
      if (i >= 0) tiered.splice(i, 1);
    }
    t.group = t.small = t.meshes = null;
    if (t.shown) {
      t.shown = false;
      nearMask[t.k] = 0;
      for (const m of farMeshes) compactFar(m, nearMask, farDetail);
    }
  }

  // ---- The streamer: called every drawn frame with the camera. ----
  let job = null, jobTile = null;
  const stats = { built: 0, dropped: 0, buildMs: 0, worstSliceMs: 0, near: 0, worst: {} };
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
      // The far copy's detail level (small buildings, roofs) near by.
      const fd = d < (farDetail[k] ? FAR_DETAIL + LOD.hyst : FAR_DETAIL) ? 1 : 0;
      if (fd !== farDetail[k]) { farDetail[k] = fd; farChanged = true; }
      if (t.group) {
        const show = d < (t.shown ? LOD.near + LOD.hyst : LOD.near);
        if (show !== t.shown) {
          t.shown = show;
          t.group.visible = show;
          nearMask[k] = show ? 1 : 0;
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
    if (farChanged) {
      farChanged = false;
      if (!changed) for (const m of farMeshes) compactFar(m, nearMask, farDetail);
    }
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
      const ds = now() - s0;
      if (ds > stats.worstSliceMs) stats.worstSliceMs = ds;
      if (r.value && !(stats.worst[r.value] >= ds)) stats.worst[r.value] = Math.round(ds * 10) / 10;
      if (r.done) {
        stats.built++;
        const t = jobTile;
        job = jobTile = null;
        const d = dist(t, x, z, hy);
        if (d < LOD.near) {
          t.shown = true;
          t.group.visible = true;
          nearMask[t.k] = 1;
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
      for (const m of farMeshes) compactFar(m, nearMask, farDetail);
      refillBulbs();
    }
  }
  // Every tile near the point, now (start, screenshots, tests).
  function flush(camera) {
    update(camera, Infinity);
  }
  // Throws every near tile away (they build again as needed): after the
  // city's lots were replaced, for the stand-in lots of the dev scripts.
  function reset() {
    if (job) { job = null; jobTile = null; }
    for (const t of tiles) {
      if (t.group) dropTile(t);
      if (t.solids) setSolids(t.solids, false);
      t.solids = null;
    }
    lotSrc = null;
    buildFar();
  }
  ud.stream = { update, flush, reset, tileJob, stats, lotStats, tiles, tileOf, NX, NZ, LOD };

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

