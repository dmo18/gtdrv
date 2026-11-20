// Turns the generated city data into three.js objects: textured ground
// and roads, buildings (see buildings.js) and street life (props.js),
// all merged into a few meshes per map tile.
import * as THREE from 'three';
import { ChunkedBuilder } from './meshbuilder.js';
import { createRng, TAU } from '../core/rng.js';
import { SIDEWALK } from '../world/citygen.js';
import { createTextures } from './textures.js';
import { addBuilding, shade } from './buildings.js';
import { addProps } from './props.js';

// Vertex tints. Textures are painted pale, so these set the real tone.
const COL = {
  asphalt: 0x5a5d62,
  junction: 0x56595e,
  runway: 0x4a4c50,
  apron: 0x8c8e90,
  line: 0xf0eee4,
  yellow: 0xe8b23a,
  sidewalk: 0xb4b1aa,
  kerb: 0xc6c3bc,
  plaza: 0xc2bdb2,
  yard: 0x85878a,
  grass: 0x86b060,
  parkGrass: 0x8cc064,
  lawn: 0x94c26a,
  sand: 0xf2e2b6,
  water: 0x2a7c9e,
};

// Brightness across a road: dark gutters, oil-darkened lane centres.
const PROFILE_STREET = [[-5.5, 0.66], [-5.1, 0.9], [-3.5, 1], [-2, 0.86], [-0.5, 0.97], [0.5, 0.97], [2, 0.86], [3.5, 1], [5.1, 0.9], [5.5, 0.66]];
const PROFILE_AVENUE = [[-9, 0.66], [-8.6, 0.92], [-6.1, 0.86], [-4.35, 1], [-2.6, 0.86], [-0.7, 0.97], [0.7, 0.97], [2.6, 0.86], [4.35, 1], [6.1, 0.86], [8.6, 0.92], [9, 0.66]];

// Multiply-blended contact shadows: vertex colour is the darkening
// factor, faded out with the fog so distant ground is not smudged.
function makeAoMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uStrength: { value: 1 } }]),
    vertexShader: `
      varying vec3 vAo;
      varying float vDepth;
      void main() {
        vAo = color;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vDepth = -mv.z;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      uniform float fogNear;
      uniform float fogFar;
      uniform float uStrength;
      varying vec3 vAo;
      varying float vDepth;
      void main() {
        float f = smoothstep(fogNear * 0.5, fogFar * 0.6, vDepth);
        gl_FragColor = vec4(mix(vec3(1.0), vAo, uStrength * (1.0 - f)), 1.0);
      }`,
    vertexColors: true,
    fog: true,
    transparent: true,
    depthWrite: false,
    blending: THREE.MultiplyBlending,
    premultipliedAlpha: true,
    toneMapped: false,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  });
}

function makeMaterials(T) {
  const std = (o) => new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0, ...o });
  const ns = (v) => new THREE.Vector2(v, v);
  const M = {
    asphaltMat: std({ map: T.asphalt.map, normalMap: T.asphalt.normalMap, normalScale: ns(0.7), roughnessMap: T.asphalt.wetMap, roughness: 0.93 }),
    pavementMat: std({ map: T.pavement.map, normalMap: T.pavement.normalMap, normalScale: ns(0.6), roughness: 0.88 }),
    grassMat: std({ map: T.grass.map, roughness: 1 }),
    woodMat: std({ map: T.wood.map, roughness: 0.85 }),
    paintMat: std({ map: T.paint.map, roughness: 0.6, alphaTest: 0.5, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
    decalMat: std({ map: T.decals.map, roughness: 0.82, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 }),
    aoMat: makeAoMaterial(),
    plainMat: std({ roughness: 0.82 }),
    detailMat: std({ map: T.details.map, emissiveMap: T.details.emissiveMap, emissive: 0xffffff, emissiveIntensity: 0, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.7 }),
    glowMat: new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false }),
    glass: std({ map: T.glass.map, emissiveMap: T.glass.emissiveMap, roughnessMap: T.glass.roughnessMap, metalnessMap: T.glass.metalnessMap, roughness: 1, metalness: 0.6, emissive: 0xffffff, emissiveIntensity: 0, envMapIntensity: 1.7 }),
    brick: std({ map: T.brick.map, emissiveMap: T.brick.emissiveMap, normalMap: T.brick.normalMap, normalScale: ns(0.5), emissive: 0xffffff, emissiveIntensity: 0, roughness: 0.9 }),
    office: std({ map: T.office.map, emissiveMap: T.office.emissiveMap, roughnessMap: T.office.roughnessMap, metalnessMap: T.office.metalnessMap, roughness: 1, metalness: 1, emissive: 0xffffff, emissiveIntensity: 0 }),
    stucco: std({ map: T.stucco.map, emissiveMap: T.stucco.emissiveMap, emissive: 0xffffff, emissiveIntensity: 0, roughness: 0.92 }),
    siding: std({ map: T.siding.map, roughness: 0.8 }),
    corrugated: std({ map: T.corrugated.map, roughness: 0.55, metalness: 0.35 }),
    roofing: std({ map: T.roofing.map, roughness: 0.9 }),
    shopfront: std({ map: T.shopfront.map, emissiveMap: T.shopfront.emissiveMap, roughnessMap: T.shopfront.roughnessMap, metalnessMap: T.shopfront.metalnessMap, roughness: 1, metalness: 1, emissive: 0xffffff, emissiveIntensity: 0 }),
  };
  M.paintMat.alphaToCoverage = true;
  // Land under everything: pushed back a touch so roads sit on top.
  M.landMat = std({ map: T.grass.map, roughness: 1, polygonOffset: true, polygonOffsetFactor: 2, polygonOffsetUnits: 2 });
  M.landRimMat = std({ map: T.grass.map, roughness: 1, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 });
  M.sandMat = std({ map: T.sand.map, roughness: 0.95, polygonOffset: true, polygonOffsetFactor: 3, polygonOffsetUnits: 3 });

  // Wet roads: in the rain the asphalt goes dark and glossy, with
  // standing water where the puddle mask says so.
  const wet = { value: 0 };
  M.asphaltMat.onBeforeCompile = (shader) => {
    shader.uniforms.uWet = wet;
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <roughnessmap_pars_fragment>', '#include <roughnessmap_pars_fragment>\nuniform float uWet;')
      .replace('#include <roughnessmap_fragment>', `
        float roughnessFactor = roughness;
        #ifdef USE_ROUGHNESSMAP
          float rwPuddle = texture2D( roughnessMap, vRoughnessMapUv ).g;
          roughnessFactor *= mix( 1.0, mix( 0.62, 0.1, 1.0 - rwPuddle ), uWet );
          diffuseColor.rgb *= mix( 1.0, mix( 0.62, 0.4, 1.0 - rwPuddle ), uWet );
        #endif`)
      .replace('#include <normal_fragment_maps>', `
        #include <normal_fragment_maps>
        #ifdef USE_ROUGHNESSMAP
          normal = normalize( mix( normal, nonPerturbedNormal, uWet * ( 1.0 - rwPuddle ) * 0.9 ) );
        #endif`);
  };
  M.wet = wet;
  return M;
}

export function buildCityMesh(city, collision) {
  const tStart = typeof performance !== 'undefined' ? performance.now() : 0;
  const rng = createRng(city.seed + 99);
  const group = new THREE.Group();
  group.name = 'city';
  const S = city.size;
  const TILES = 5, GT = 3;

  const names = city.streetNames ? [...city.streetNames.x.slice(0, 16), ...city.streetNames.z.slice(0, 16)] : [];
  const T = createTextures(city.seed + 7, names);
  const M = makeMaterials(T);

  // --- Sea placeholder (the game swaps in the animated sea). ---
  const water = new THREE.Mesh(
    new THREE.PlaneGeometry(9000, 9000).rotateX(-Math.PI / 2),
    new THREE.MeshLambertMaterial({ color: new THREE.Color().setHex(COL.water, THREE.SRGBColorSpace) }),
  );
  water.position.y = -0.5;
  water.name = 'water';
  group.add(water);

  // --- The island itself: a beach sloping into the sea, grass inland. ---
  {
    const SEG = 200;
    const c = new THREE.Color();
    const ring = (insets, ys, cols, alphas, uvScale) => {
      const pos = [], col = [], uv = [], idx = [];
      const rows = insets.length;
      for (let i = 0; i < SEG; i++) {
        const th = (i / SEG) * TAU;
        const r0 = city.radiusAt(th);
        const wob = 1 + 0.06 * Math.sin(th * 23) + 0.04 * Math.sin(th * 51 + 1);
        for (let k = 0; k < rows; k++) {
          const r = Math.max(0, r0 - insets[k] * (insets[k] > 0 && insets[k] < 100 ? wob : 1));
          const x = Math.cos(th) * r, z = Math.sin(th) * r;
          pos.push(x, ys[k], z);
          c.setHex(cols[k], THREE.SRGBColorSpace);
          col.push(c.r, c.g, c.b);
          if (alphas) col.push(alphas[k]);
          uv.push(x / uvScale, z / uvScale);
        }
      }
      for (let i = 0; i < SEG; i++) {
        const a = i * rows, b = ((i + 1) % SEG) * rows;
        for (let k = 0; k < rows - 1; k++) idx.push(a + k, b + k + 1, b + k, a + k, a + k + 1, b + k + 1);
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('color', new THREE.Float32BufferAttribute(col, alphas ? 4 : 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      g.setIndex(idx);
      g.computeVertexNormals();
      return g;
    };
    const add = (g, mat, order = 0) => {
      const m = new THREE.Mesh(g, mat);
      m.matrixAutoUpdate = false;
      m.receiveShadow = true;
      m.renderOrder = order;
      group.add(m);
      return m;
    };
    // Sand: wet and dark at the waterline, dry further up. Rows run
    // from the sea bed inward to the island centre.
    add(ring([-22, -9, -3, 4, 30, 700], [-2.2, -0.75, -0.3, -0.12, -0.12, -0.12], [0x8a7a58, 0xb8a47a, 0xd9c698, COL.sand, COL.sand, COL.sand], null, 6), M.sandMat);
    add(ring([33, 60, 700], [-0.06, -0.06, -0.06], [COL.grass, COL.grass, COL.grass], null, 10), M.landMat);
    add(ring([23, 28, 33], [-0.06, -0.06, -0.06], [0xa8b070, 0x98b068, COL.grass], [0, 0.7, 1], 10), M.landRimMat, 1);
  }

  // Shared builders. Ground pieces use big tiles; buildings and props
  // use smaller ones so more of them can be skipped when out of view.
  const B = {
    asphalt: new ChunkedBuilder(S, GT, true, 8),
    pavement: new ChunkedBuilder(S, GT, true, 4.8),
    grass: new ChunkedBuilder(S, GT, true, 10),
    wood: new ChunkedBuilder(S, GT, true, 2),
    paint: new ChunkedBuilder(S, GT, true, 2),
    decal: new ChunkedBuilder(S, GT, true),
    ao: new ChunkedBuilder(S, GT),
    plain: new ChunkedBuilder(S, TILES),
    detail: new ChunkedBuilder(S, TILES, true),
    glow: new ChunkedBuilder(S, GT),
    glass: new ChunkedBuilder(S, TILES, true),
    brick: new ChunkedBuilder(S, TILES, true),
    office: new ChunkedBuilder(S, TILES, true),
    stucco: new ChunkedBuilder(S, TILES, true),
    siding: new ChunkedBuilder(S, TILES, true),
    corrugated: new ChunkedBuilder(S, TILES, true),
    roofing: new ChunkedBuilder(S, TILES, true),
    shopfront: new ChunkedBuilder(S, TILES, true),
  };
  const DR = T.decals.rects;
  const blockAt = (x, z) => {
    for (const b of city.blocks) if (x >= b.x0 && x <= b.x1 && z >= b.z0 && z <= b.z1) return b;
    return null;
  };
  const onExtra = (x, z) => (city.extraLand || []).some((r) => x >= r.x0 && x <= r.x1 && z >= r.z0 && z <= r.z1);
  const C = {
    city, collision, ...B, R: T.details.rects, DR, glows: [],
    // Height of the ground something stands on.
    groundY: (x, z) => (blockAt(x, z) ? 0.16 : city.mainShore(x, z) > 30 || onExtra(x, z) ? -0.06 : -0.12),
  };
  const LY = 0.015, DY = 0.02;

  // --- Extra land (airfield islet, causeway), piers, aprons, runway. ---
  for (const r of city.extraLand || []) {
    const cx = (r.x0 + r.x1) / 2, cz = (r.z0 + r.z1) / 2;
    B.pavement.at(cx, cz).walls(r.x0, r.z0, r.x1, r.z1, -3, -0.06, 0x9a968c, 4.8, 4.8, 0.45, 1);
    B.grass.at(cx, cz).flat(r.x0, r.z0, r.x1, r.z1, -0.06, COL.grass);
  }
  for (const r of city.piers || []) {
    const cx = (r.x0 + r.x1) / 2, cz = (r.z0 + r.z1) / 2;
    const w = B.wood.at(cx, cz);
    const alongX = r.x1 - r.x0 > r.z1 - r.z0;
    w.walls(r.x0, r.z0, r.x1, r.z1, -0.25, 0.1, 0x8a6b48, 2, 2, 0.6, 0.9);
    // Planks run across the pier.
    if (alongX) w.flat(r.x0, r.z0, r.x1, r.z1, 0.1, 0xb89a72);
    else w.quadUv(r.x0, 0.1, r.z1, r.x1, 0.1, r.z1, r.x1, 0.1, r.z0, r.x0, 0.1, r.z0, 0xb89a72, 0, 1, 0, r.z1 / 2, r.x0 / 2, r.z1 / 2, r.x1 / 2, r.z0 / 2, r.x1 / 2, r.z0 / 2, r.x0 / 2);
    const p = B.plain.at(cx, cz);
    const len = alongX ? r.x1 - r.x0 : r.z1 - r.z0;
    for (let d = 2; d < len; d += 8) {
      for (const side of [0, 1]) {
        const px = alongX ? r.x0 + d : side ? r.x1 : r.x0;
        const pz = alongX ? (side ? r.z1 : r.z0) : r.z0 + d;
        p.cyl(px, pz, -3, 0.75, 0.22, 0.2, 6, 0x5a4530, true, 0.5, 1, 0x7a6248);
      }
    }
  }
  for (const r of city.surfaces || []) {
    const cx = (r.x0 + r.x1) / 2, cz = (r.z0 + r.z1) / 2;
    if (r.type === 'runway') {
      // Runway: darker down the middle where the tyres land.
      const a = B.asphalt.at(cx, cz);
      const zs = [r.z0, r.z0 + 4, cz - 5, cz + 5, r.z1 - 4, r.z1], sh = [0.95, 1, 0.82, 0.82, 1, 0.95];
      for (let x = r.x0; x < r.x1 - 1; x += 71) {
        const xe = Math.min(r.x1, x + 71);
        for (let k = 0; k < 5; k++) a.flatShade(x, zs[k], xe, zs[k + 1], 0, COL.runway, sh[k + 1], sh[k + 1], sh[k], sh[k]);
      }
      const m = B.paint.at(cx, cz);
      for (let x = r.x0 + 40; x < r.x1 - 50; x += 30) m.flat(x, cz - 0.3, x + 15, cz + 0.3, LY, COL.line);
      for (let k = 0; k < 6; k++) {
        const z = r.z0 + 3 + k * ((r.z1 - r.z0 - 6) / 5.6);
        m.flat(r.x0 + 6, z, r.x0 + 26, z + 1.6, LY, COL.line);
        m.flat(r.x1 - 26, z, r.x1 - 6, z + 1.6, LY, COL.line);
      }
      m.flat(r.x0, r.z0 + 0.4, r.x1, r.z0 + 0.8, LY, COL.line);
      m.flat(r.x0, r.z1 - 0.8, r.x1, r.z1 - 0.4, LY, COL.line);
      // Touchdown rubber at both ends.
      const d = B.decal.at(cx, cz);
      for (const x0 of [r.x0 + 60, r.x0 + 100, r.x1 - 140, r.x1 - 100]) {
        for (const oz of [-4.2, 4.2]) d.flatRect(x0, cz + oz - 3.2, x0 + 40, cz + oz + 3.2, DY, 0xffffff, DR.rubber, 1);
      }
    } else {
      // Concrete apron with a painted taxi line.
      const pv = B.pavement.at(cx, cz);
      for (let x = r.x0; x < r.x1 - 1; x += 86) pv.flat(x, r.z0, Math.min(r.x1, x + 86), r.z1, 0, COL.apron);
      B.paint.at(cx, cz).flat(r.x0 + 20, r.z0 + 14.9, r.x1 - 20, r.z0 + 15.2, LY, COL.yellow);
    }
  }
  for (const h of city.helipads || []) {
    const m = B.paint.at(h.x, h.z);
    B.asphalt.at(h.x, h.z).flat(h.x - 9, h.z - 9, h.x + 9, h.z + 9, 0.006, COL.junction);
    m.flat(h.x - 8, h.z - 8, h.x + 8, h.z - 7.4, DY, COL.yellow);
    m.flat(h.x - 8, h.z + 7.4, h.x + 8, h.z + 8, DY, COL.yellow);
    m.flat(h.x - 8, h.z - 8, h.x - 7.4, h.z + 8, DY, COL.yellow);
    m.flat(h.x + 7.4, h.z - 8, h.x + 8, h.z + 8, DY, COL.yellow);
    m.flat(h.x - 3, h.z - 4, h.x - 2, h.z + 4, DY, COL.line);
    m.flat(h.x + 2, h.z - 4, h.x + 3, h.z + 4, DY, COL.line);
    m.flat(h.x - 2, h.z - 0.5, h.x + 2, h.z + 0.5, DY, COL.line);
  }

  // --- Roads, painted lines and the wear and tear on them. ---
  for (const n of city.nodes) {
    const hx = n.hx, hz = n.hz;
    B.asphalt.at(n.x, n.z).flat(n.x - hx, n.z - hz, n.x + hx, n.z + hz, 0, COL.junction, 0.94);
    if (n.edges.length < 3 || n.i < 0) continue;
    // Crossings: a pair of lines round the box, zebra bars at signals.
    const lb = B.paint.at(n.x, n.z);
    for (const eid of n.edges) {
      const e = city.edges[eid];
      const o = city.nodes[e.a === n.id ? e.b : e.a];
      if (e.horizontal) {
        const sgn = o.x > n.x ? 1 : -1;
        for (const d of [0.35, 2.75]) {
          const xa = n.x + sgn * (hx - d - 0.22), xb = n.x + sgn * (hx - d);
          lb.flat(Math.min(xa, xb), n.z - hz + 0.25, Math.max(xa, xb), n.z + hz - 0.25, LY, COL.line);
        }
        if (n.signal) {
          const xa = n.x + sgn * (hx - 2.5), xb = n.x + sgn * (hx - 0.6);
          for (let z = n.z - hz + 3.3; z < n.z + hz - 3.6; z += 1.1) lb.flat(Math.min(xa, xb), z, Math.max(xa, xb), z + 0.55, LY, COL.line);
        }
      } else {
        const sgn = o.z > n.z ? 1 : -1;
        for (const d of [0.35, 2.75]) {
          const za = n.z + sgn * (hz - d - 0.22), zb = n.z + sgn * (hz - d);
          lb.flat(n.x - hx + 0.25, Math.min(za, zb), n.x + hx - 0.25, Math.max(za, zb), LY, COL.line);
        }
        if (n.signal) {
          const za = n.z + sgn * (hz - 2.5), zb = n.z + sgn * (hz - 0.6);
          for (let x = n.x - hx + 3.3; x < n.x + hx - 3.6; x += 1.1) lb.flat(x, Math.min(za, zb), x + 0.55, Math.max(za, zb), LY, COL.line);
        }
      }
    }
  }
  for (const e of city.edges) {
    const a = city.nodes[e.a], b = city.nodes[e.b];
    const half = e.width / 2;
    const mx = (a.x + b.x) / 2, mz = (a.z + b.z) / 2;
    const rb = B.asphalt.at(mx, mz), lb = B.paint.at(mx, mz), db = B.decal.at(mx, mz);
    const prof = e.avenue ? PROFILE_AVENUE : PROFILE_STREET;
    const tone = shade(COL.asphalt, rng.range(0.88, 1.08));
    const H = e.horizontal;
    // Along-road start and end, and helpers that turn (along, across)
    // into world rectangles for either orientation.
    const s0 = H ? a.x + a.hx : a.z + a.hz, s1 = H ? b.x - b.hx : b.z - b.hz;
    const c0 = H ? a.z : a.x;
    const rect = (bld, d0, d1, o0, o1, y, col) => {
      if (H) bld.flat(d0, c0 + o0, d1, c0 + o1, y, col);
      else bld.flat(c0 + o0, d0, c0 + o1, d1, y, col);
    };
    // Split long roads so tiles stay reasonably tight.
    const segs = Math.max(1, Math.round((s1 - s0) / 90));
    for (let sg = 0; sg < segs; sg++) {
      const d0 = s0 + ((s1 - s0) * sg) / segs, d1 = s0 + ((s1 - s0) * (sg + 1)) / segs;
      for (let k = 0; k < prof.length - 1; k++) {
        const o0 = prof[k][0], o1 = prof[k + 1][0], sa = prof[k][1], sb = prof[k + 1][1];
        if (H) rb.flatShade(d0, c0 + o0, d1, c0 + o1, 0, tone, sb, sb, sa, sa);
        else rb.flatShade(c0 + o0, d0, c0 + o1, d1, 0, tone, sa, sb, sb, sa);
      }
    }
    // Stop lines (traffic keeps right).
    if (H) {
      lb.flat(s0 + 0.6, c0 - half + 0.3, s0 + 1.1, c0 - 0.2, LY, COL.line);
      lb.flat(s1 - 1.1, c0 + 0.2, s1 - 0.6, c0 + half - 0.3, LY, COL.line);
    } else {
      lb.flat(c0 + 0.2, s0 + 0.6, c0 + half - 0.3, s0 + 1.1, LY, COL.line);
      lb.flat(c0 - half + 0.3, s1 - 1.1, c0 - 0.2, s1 - 0.6, LY, COL.line);
    }
    if (e.avenue) {
      rect(lb, s0 + 2, s1 - 2, -0.35, -0.15, LY, COL.yellow);
      rect(lb, s0 + 2, s1 - 2, 0.15, 0.35, LY, COL.yellow);
      for (let d = s0 + 4; d < s1 - 6; d += 9) {
        rect(lb, d, d + 3, -4.42, -4.28, LY, COL.line);
        rect(lb, d, d + 3, 4.28, 4.42, LY, COL.line);
      }
      // Lane arrows on the way in to each junction.
      if (!e.causeway && s1 - s0 > 50) {
        for (const lane of [2.6, 6.1]) {
          // Travelling toward b on the +across side (keep right), toward a on the other.
          if (H) {
            db.flatRect(s1 - 16, c0 + lane - 0.7, s1 - 12.4, c0 + lane + 0.7, DY, 0xffffff, DR.arrow, 1);
            db.flatRect(s0 + 12.4, c0 - lane - 0.7, s0 + 16, c0 - lane + 0.7, DY, 0xffffff, DR.arrow, 3);
          } else {
            db.flatRect(c0 - lane - 0.7, s1 - 16, c0 - lane + 0.7, s1 - 12.4, DY, 0xffffff, DR.arrow, 2);
            db.flatRect(c0 + lane - 0.7, s0 + 12.4, c0 + lane + 0.7, s0 + 16, DY, 0xffffff, DR.arrow, 0);
          }
        }
      }
    } else {
      for (let d = s0 + 4; d < s1 - 6; d += 9) rect(lb, d, d + 3, -0.08, 0.08, LY, COL.yellow);
      // Kerbside parking bays.
      const startPad = (H ? a.x : a.z) + (H ? a.hx : a.hz) + 6, endPad = (H ? b.x : b.z) - (H ? b.hx : b.hz) - 6;
      if (!e.causeway && endPad - startPad > 14) {
        for (const side of [-1, 1]) {
          for (let d = startPad - 0.25; d < endPad + 0.3; d += 6.5) {
            const oa = side * (half - 2.5), ob = side * (half - 0.3);
            rect(lb, d - 0.06, d + 0.06, Math.min(oa, ob), Math.max(oa, ob), LY, COL.line);
          }
          const o = side * (half - 2.5);
          rect(lb, startPad - 0.25, endPad + 0.3, o - 0.05, o + 0.05, LY, COL.line);
        }
      }
    }
    // Scuffs: manholes, drains, stains, repairs, cracks, skid marks.
    const len = s1 - s0;
    const lanes = e.avenue ? [-6.1, -2.6, 2.6, 6.1] : [-2, 2];
    const spot = (r, w, l, d, o, col = 0xffffff, rot = rng.int(0, 3)) => {
      if (d < s0 + 2 || d > s1 - 2) return;
      if (H) db.flatRect(d - l / 2, c0 + o - w / 2, d + l / 2, c0 + o + w / 2, DY, col, r, rot);
      else db.flatRect(c0 + o - w / 2, d - l / 2, c0 + o + w / 2, d + l / 2, DY, col, r, rot);
    };
    if (rng.chance(0.6)) spot(DR.manhole, 0.9, 0.9, s0 + rng.range(8, len - 8), rng.pick(lanes) + rng.range(-0.4, 0.4));
    for (let k = 0; k < 2; k++) spot(DR.grate, 0.5, 0.75, s0 + 5 + k * (len - 10), (k ? 1 : -1) * (half - 0.35), 0xffffff, H ? 0 : 1);
    const nStain = Math.round(len / 26);
    for (let k = 0; k < nStain; k++) {
      const sz = rng.range(1.6, 3.6);
      spot(rng.chance(0.5) ? DR.stain1 : DR.stain2, sz, sz * rng.range(1, 1.6), s0 + rng.range(4, len - 4), rng.pick(lanes) + rng.range(-0.3, 0.3));
    }
    if (rng.chance(0.5)) spot(rng.chance(0.5) ? DR.patch1 : DR.patch2, rng.range(2, 3.4), rng.range(3, 7), s0 + rng.range(8, len - 8), rng.pick(lanes));
    if (rng.chance(0.7)) spot(DR.crack, rng.range(3, 5), rng.range(3, 5), s0 + rng.range(6, len - 6), rng.range(-half + 2, half - 2));
    if (rng.chance(0.3)) {
      // Braking marks on the way in to a junction.
      const toB = rng.chance(0.5);
      const lane = (e.avenue ? rng.pick([2.6, 6.1]) : 2) * (toB ? 1 : -1) * (H ? 1 : -1);
      spot(DR.skid, 1.9, 9, toB ? s1 - 8 : s0 + 8, lane, 0xffffff, H ? 1 : 0);
    }
  }

  // --- City blocks: kerb, pavement and whatever fills the middle. ---
  for (const b of city.blocks) {
    const cx = (b.x0 + b.x1) / 2, cz = (b.z0 + b.z1) / 2;
    const pv = B.pavement.at(cx, cz);
    const Y = 0.16, KW = 0.3;
    pv.walls(b.x0, b.z0, b.x1, b.z1, -0.05, Y, COL.kerb, 4.8, 4.8, 0.6, 0.95);
    pv.ring(b.x0, b.z0, b.x1, b.z1, KW, Y, COL.kerb);
    const tone = shade(COL.sidewalk, 0.94 + ((b.id * 37) % 10) * 0.012);
    pv.ring(b.x0 + KW, b.z0 + KW, b.x1 - KW, b.z1 - KW, SIDEWALK - KW, Y, tone, 0.97, 1);
    const ix0 = b.x0 + SIDEWALK, iz0 = b.z0 + SIDEWALK, ix1 = b.x1 - SIDEWALK, iz1 = b.z1 - SIDEWALK;
    const d = b.district;
    if (d === 'park') {
      // Lawns in the four corners, paths crossing at a round plaza.
      const g = B.grass.at(cx, cz);
      const pw = 1.6, pl = 5.2;
      g.flat(ix0, iz0, cx - pw, cz - pw, Y, COL.parkGrass);
      g.flat(cx + pw, iz0, ix1, cz - pw, Y, COL.parkGrass);
      g.flat(ix0, cz + pw, cx - pw, iz1, Y, COL.parkGrass);
      g.flat(cx + pw, cz + pw, ix1, iz1, Y, COL.parkGrass);
      pv.flat(cx - pw, iz0, cx + pw, iz1, Y, COL.plaza);
      pv.flat(ix0, cz - pw, cx - pw, cz + pw, Y, COL.plaza);
      pv.flat(cx + pw, cz - pw, ix1, cz + pw, Y, COL.plaza);
      B.decal.at(cx, cz).flatRect(cx - pl, cz - pl, cx + pl, cz + pl, Y + 0.012, COL.plaza, DR.slab);
    } else if (d === 'residential') {
      B.grass.at(cx, cz).flat(ix0, iz0, ix1, iz1, Y, COL.lawn);
    } else if (d === 'docks' || d === 'industrial') {
      B.asphalt.at(cx, cz).flat(ix0, iz0, ix1, iz1, Y, COL.yard);
    } else {
      pv.flat(ix0, iz0, ix1, iz1, Y, d === 'beach' ? 0xcfc4ac : COL.plaza);
    }
  }

  // --- Buildings. ---
  for (const b of city.buildings) {
    collision.addBox(b.x0, b.z0, b.x1, b.z1, b.h, b.kind);
    addBuilding(C, b);
  }

  // --- Street life and landmarks. ---
  const { lamps, bulbs } = addProps(C);

  // --- Turn the builders into meshes. ---
  const ground = { receive: true };
  const solid = { cast: true, receive: true };
  B.asphalt.buildInto(group, M.asphaltMat, ground);
  B.pavement.buildInto(group, M.pavementMat, ground);
  B.grass.buildInto(group, M.grassMat, ground);
  B.wood.buildInto(group, M.woodMat, ground);
  B.paint.buildInto(group, M.paintMat, { order: 1, receive: true });
  B.decal.buildInto(group, M.decalMat, { order: 2, receive: true });
  B.ao.buildInto(group, M.aoMat, { order: 3 });
  const tiered = [...B.plain.buildInto(group, M.plainMat, solid), ...B.detail.buildInto(group, M.detailMat, solid)];
  B.glow.buildInto(group, M.glowMat, {});
  for (const k of ['glass', 'brick', 'office', 'stucco', 'siding', 'corrugated', 'roofing', 'shopfront']) B[k].buildInto(group, M[k], { ...solid, name: 'facade-' + k });

  // --- Traffic-light lamps: one instanced mesh, coloured per lamp. ---
  let signalMesh = null;
  if (bulbs.length) {
    const g = new THREE.CircleGeometry(0.115, 8).rotateY(Math.PI / 2);
    signalMesh = new THREE.InstancedMesh(g, new THREE.MeshBasicMaterial({ toneMapped: false }), bulbs.length);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), s = new THREE.Vector3(1, 1, 1), up = new THREE.Vector3(0, 1, 0);
    const dark = new THREE.Color(0.02, 0.02, 0.02);
    bulbs.forEach((bl, i) => {
      p.set(bl.x, bl.y, bl.z);
      q.setFromAxisAngle(up, -bl.face);
      m4.compose(p, q, s);
      signalMesh.setMatrixAt(i, m4);
      signalMesh.setColorAt(i, dark);
    });
    signalMesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    signalMesh.computeBoundingSphere();
    signalMesh.matrixAutoUpdate = false;
    signalMesh.name = 'signal-lamps';
    group.add(signalMesh);
  }

  // --- Windsock: its own little mesh so it can swing with the wind. ---
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

  group.userData = {
    water,
    materials: M,
    // Materials whose lit windows and signs come on at night.
    glowMats: [M.glass, M.brick, M.office, M.stucco, M.shopfront, M.detailMat],
    wet: M.wet,
    lamps,
    glows: C.glows,
    signals: { mesh: signalMesh, bulbs },
    windsock,
    tiered,
    textures: T,
    buildMs: (typeof performance !== 'undefined' ? performance.now() : 0) - tStart,
  };
  return group;
}
