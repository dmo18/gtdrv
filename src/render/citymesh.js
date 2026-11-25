// Turns the generated city data into three.js objects: textured ground
// and roads, buildings (see buildings.js) and street life (props.js),
// all merged into a few meshes per map tile.
import * as THREE from 'three';
import { ChunkedBuilder, freezeStatic } from './meshbuilder.js';
import { createRng, TAU } from '../core/rng.js';
import { SIDEWALK } from '../world/citygen.js';
import { createTextures } from './textures.js';
import { addBuilding, shade } from './buildings.js';
import { addProps } from './props.js';
import { fillCollision } from '../world/collision.js';
import { DRAWN_T, FAR_LOT_COL } from './lotmesh.js';
import { CURB_H, MEDIAN_PLANT } from '../world/roadprofile.js';
import { buildRoadGeo, edgeStations, edgePaint, edgePoint, walkOf, walkLeftOf, medianBand, medianAt, pairGap, MEDIAN_GAP, curbsAt, supAt, onJunction, inJunctionArea, fanMouthHull, pointInRing } from '../world/junctions.js';
import { groundFn, groundOf, FILL_STEP } from '../world/ground.js';

// Vertex tints. Textures are painted pale, so these set the real tone.
export const COL = {
  asphalt: 0x5a5d62,
  junction: 0x56595e,
  runway: 0x4a4c50,
  apron: 0x8c8e90,
  apronPatch: 0xa29f96,
  joint: 0x4c4c4a,
  line: 0xf0eee4,
  yellow: 0xe8b23a,
  sidewalk: 0xb4b1aa,
  curb: 0xc6c3bc,
  plaza: 0xc2bdb2,
  yard: 0x85878a,
  grass: 0x7ea85a,
  parkGrass: 0x82b45c,
  lawn: 0x8ab864,
  sand: 0xf2e2b6,
  water: 0x2a7c9e,
};

// Brightness across a road: dark gutters, oil-darkened lane centers.
const PROFILE_STREET = [[-5.5, 0.66], [-5.1, 0.9], [-3.5, 1], [-2, 0.86], [-0.5, 0.97], [0.5, 0.97], [2, 0.86], [3.5, 1], [5.1, 0.9], [5.5, 0.66]];
const PROFILE_AVENUE = [[-9, 0.66], [-8.6, 0.92], [-6.1, 0.86], [-4.35, 1], [-2.6, 0.86], [-0.7, 0.97], [0.7, 0.97], [2.6, 0.86], [4.35, 1], [6.1, 0.86], [8.6, 0.92], [9, 0.66]];

// Multiply-blended contact shadows: vertex color is the darkening
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

// 1 by 1 stand-in maps (docs/PERF.md, shader programs): a material given
// the same set of maps as another compiles to the same program, so
// these neutral ones let materials share: a flat normal, and white
// roughness and metalness (the material's own values stand).
let neutral = null;
function neutralMaps() {
  if (neutral) return neutral;
  const tex = (r, g, b) => {
    const t = new THREE.DataTexture(new Uint8Array([r, g, b, 255]), 1, 1);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.needsUpdate = true;
    return t;
  };
  neutral = { normal: tex(128, 128, 255), white: tex(255, 255, 255) };
  return neutral;
}

export function makeMaterials(T) {
  const std = (o) => new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0, ...o });
  const N = neutralMaps();
  const ns = (v) => new THREE.Vector2(v, v);
  const M = {
    asphaltMat: std({ map: T.asphalt.map, normalMap: T.asphalt.normalMap, normalScale: ns(0.7), roughnessMap: T.asphalt.wetMap, roughness: 0.93 }),
    sidewalkMat: std({ map: T.sidewalk.map, normalMap: T.sidewalk.normalMap, normalScale: ns(0.6), roughness: 0.88 }),
    grassMat: std({ map: T.grass.map, roughness: 1 }),
    // A flat normal map: wood, ground and sand share the sidewalk's program.
    woodMat: std({ map: T.wood.map, normalMap: N.normal, roughness: 0.85 }),
    paintMat: std({ map: T.paint.map, roughness: 0.6, alphaTest: 0.5, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
    decalMat: std({ map: T.decals.map, roughness: 0.82, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 }),
    aoMat: makeAoMaterial(),
    plainMat: std({ roughness: 0.82 }),
    detailMat: std({ map: T.details.map, emissiveMap: T.details.emissiveMap, emissive: 0xffffff, emissiveIntensity: 0, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.7 }),
    glowMat: new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false }),
    glass: std({ map: T.glass.map, emissiveMap: T.glass.emissiveMap, roughnessMap: T.glass.roughnessMap, metalnessMap: T.glass.metalnessMap, normalMap: T.glass.normalMap, normalScale: ns(0.6), roughness: 1, metalness: 0.6, emissive: 0xffffff, emissiveIntensity: 0, envMapIntensity: 1.7 }),
    // Brick, stucco and havana take neutral roughness and metalness maps:
    // one program with glass and office.
    brick: std({ map: T.brick.map, emissiveMap: T.brick.emissiveMap, normalMap: T.brick.normalMap, normalScale: ns(0.5), roughnessMap: N.white, metalnessMap: N.white, emissive: 0xffffff, emissiveIntensity: 0, roughness: 0.9 }),
    office: std({ map: T.office.map, emissiveMap: T.office.emissiveMap, roughnessMap: T.office.roughnessMap, metalnessMap: T.office.metalnessMap, normalMap: T.office.normalMap, normalScale: ns(0.7), roughness: 1, metalness: 1, emissive: 0xffffff, emissiveIntensity: 0 }),
    stucco: std({ map: T.stucco.map, emissiveMap: T.stucco.emissiveMap, normalMap: T.stucco.normalMap, normalScale: ns(0.8), roughnessMap: N.white, metalnessMap: N.white, emissive: 0xffffff, emissiveIntensity: 0, roughness: 0.92 }),
    havana: std({ map: T.havana.map, emissiveMap: T.havana.emissiveMap, normalMap: T.havana.normalMap, normalScale: ns(0.9), roughnessMap: N.white, metalnessMap: N.white, emissive: 0xffffff, emissiveIntensity: 0, roughness: 0.92 }),
    siding: std({ map: T.siding.map, roughness: 0.8 }),
    corrugated: std({ map: T.corrugated.map, roughness: 0.55, metalness: 0.35 }),
    roofing: std({ map: T.roofing.map, roughness: 0.9 }),
    shopfront: std({ map: T.shopfront.map, emissiveMap: T.shopfront.emissiveMap, roughnessMap: T.shopfront.roughnessMap, metalnessMap: T.shopfront.metalnessMap, roughness: 1, metalness: 1, emissive: 0xffffff, emissiveIntensity: 0 }),
  };
  M.paintMat.alphaToCoverage = true;
  // Land under everything: pushed back a touch so roads sit on top.
  M.landMat = std({ map: T.grass.map, roughness: 1, polygonOffset: true, polygonOffsetFactor: 2, polygonOffsetUnits: 2 });
  M.landRimMat = std({ map: T.grass.map, roughness: 1, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 });
  M.groundMat = std({ map: T.sidewalk.map, normalMap: N.normal, roughness: 0.95, polygonOffset: true, polygonOffsetFactor: 2, polygonOffsetUnits: 2 });
  M.sandMat = std({ map: T.sand.map, normalMap: N.normal, roughness: 0.95, polygonOffset: true, polygonOffsetFactor: 3, polygonOffsetUnits: 3 });

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
  // Grass and open land: slow patches of lusher and drier, yellower
  // grass over tens of meters, so a park or a verge is never one flat
  // color field (the texture only varies within its 10 m repeat).
  for (const m of [M.grassMat, M.landMat, M.landRimMat]) {
    m.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec2 vRwG;')
        .replace('#include <project_vertex>', '#include <project_vertex>\n\tvRwG = ( modelMatrix * vec4( transformed, 1.0 ) ).xz;');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying vec2 vRwG;')
        .replace('#include <color_fragment>', `#include <color_fragment>
	{
		float rwA = sin( vRwG.x * 0.043 + sin( vRwG.y * 0.031 ) * 2.0 ) * sin( vRwG.y * 0.037 - vRwG.x * 0.011 );
		float rwB = sin( vRwG.x * 0.13 + vRwG.y * 0.09 ) * sin( vRwG.y * 0.15 - 1.3 );
		float rwC = sin( vRwG.x * 0.71 + sin( vRwG.y * 0.53 ) * 1.6 ) * sin( vRwG.y * 0.67 + sin( vRwG.x * 0.47 ) * 1.3 );
		float rwDry = smoothstep( 0.15, 0.85, rwA * 0.7 + rwB * 0.3 );
		float rwLush = smoothstep( 0.25, 0.85, - rwA * 0.75 + rwC * 0.25 );
		diffuseColor.rgb *= ( 0.86 + 0.18 * rwB ) * ( 1.0 + 0.08 * rwC );
		diffuseColor.rgb = mix( diffuseColor.rgb, diffuseColor.rgb * vec3( 1.14, 1.02, 0.66 ), rwDry * 0.65 );
		diffuseColor.rgb = mix( diffuseColor.rgb, diffuseColor.rgb * vec3( 0.74, 0.87, 0.8 ), rwLush * 0.7 );
	}`);
    };
    m.customProgramCacheKey = () => 'rw-grass';
  }
  // Ambient occlusion lite on every facade: darker where walls meet the
  // ground, a faint lift toward the top of tall buildings, so blocks do
  // not read as flat cut-outs. Worked out per pixel from the world
  // height: no extra vertices, textures or passes.
  for (const k of ['glass', 'brick', 'office', 'stucco', 'havana', 'siding', 'corrugated', 'roofing', 'shopfront']) facadeShade(M[k]);
  return M;
}

function facadeShade(mat) {
  mat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying float vRwY;\nvarying vec3 vRwP;')
      .replace('#include <project_vertex>', '#include <project_vertex>\n\tvRwP = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;\n\tvRwY = vRwP.y;');
    // Wear: a darker, dirtier band near the sidewalk, rain streaks
    // running down from each floor line in a few columns, and a slow
    // patchy tone change over the wall. The streaks fade out with
    // distance (no shimmer far off).
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vRwY;\nvarying vec3 vRwP;')
      .replace('#include <color_fragment>', `#include <color_fragment>
	diffuseColor.rgb *= mix( 0.58, 1.0, smoothstep( 0.0, 1.8, vRwY ) ) * mix( 0.93, 1.05, smoothstep( 3.0, 60.0, vRwY ) );
	{
		float rwAlong = vRwP.x + vRwP.z;
		float rwCol = fract( sin( floor( rwAlong * 1.35 ) * 91.17 ) * 4375.85 );
		float rwRun = 1.0 - fract( vRwY / 3.4 + rwCol * 0.5 );
		float rwFar = 1.0 - smoothstep( 60.0, 150.0, length( vRwP - cameraPosition ) );
		float rwStreak = step( 0.62, rwCol ) * rwRun * rwRun * 0.16 * rwFar;
		float rwPatch = sin( rwAlong * 0.21 + vRwY * 0.13 ) * sin( rwAlong * 0.067 - vRwY * 0.05 + 1.7 );
		diffuseColor.rgb *= ( 1.0 - rwStreak ) * ( 1.0 + 0.045 * rwPatch ) * mix( 0.86, 1.0, smoothstep( 0.4, 3.2, vRwY ) );
	}`);
  };
  mat.customProgramCacheKey = () => 'rw-facade';
}

// Piers, runway and aprons, helipads. own(x, z): only the pieces whose
// center it accepts (a streamed tile); null for all.
export function addSurfaces(city, B, DR, own = null) {
  const LY = 0.015, DY = 0.02;
  for (const r of city.piers || []) {
    const cx = (r.x0 + r.x1) / 2, cz = (r.z0 + r.z1) / 2;
    if (own && !own(cx, cz)) continue;
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
    if (own && !own(cx, cz)) continue;
    if (r.type === 'runway') {
      // Runway: darker down the middle where the tires land.
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
      // Concrete apron in poured panels (docs/PLAN_V1.md W2b): each
      // panel its own tone, a few patched or oil-darkened, sealed joints
      // between them, and a painted taxi line.
      const pv = B.sidewalk.at(cx, cz);
      const P = 15, m = B.paint.at(cx, cz);
      for (let x = r.x0; x < r.x1 - 1; x += P) {
        const xe = Math.min(r.x1, x + P);
        for (let z = r.z0; z < r.z1 - 1; z += P) {
          const ze = Math.min(r.z1, z + P);
          const hsh = edgeHash(Math.round(x * 7.3) * 9176 + Math.round(z * 3.1));
          const tone = hsh < 0.08 ? 0.84 : hsh > 0.93 ? 1.07 : 0.95 + 0.07 * hsh;
          const col = hsh < 0.04 ? COL.apronPatch : COL.apron;
          pv.flatShade(x, z, xe, ze, 0, col, tone, tone * 0.985, tone, tone * 1.01);
          // The slab picture at 7.5 m a slab: two by two per panel.
          if (pv.lastQuadUv) pv.lastQuadUv(x / 30, ze / 30, xe / 30, ze / 30, xe / 30, z / 30, x / 30, z / 30);
        }
        if (x > r.x0) m.flat(x - 0.06, r.z0, x + 0.06, r.z1, LY, COL.joint);
      }
      for (let z = r.z0 + P; z < r.z1 - 1; z += P) m.flat(r.x0, z - 0.06, r.x1, z + 0.06, LY, COL.joint);
      m.flat(r.x0 + 20, r.z0 + 14.9, r.x1 - 20, r.z0 + 15.2, LY, COL.yellow);
      // Oil and tire stains where aircraft stand and turn.
      const d = B.decal.at(cx, cz);
      for (let x = r.x0 + 24; x < r.x1 - 24; x += 37) {
        const hsh = edgeHash(Math.round(x) * 31 + Math.round(r.z0));
        const z = r.z0 + 30 + hsh * (r.z1 - r.z0 - 60);
        d.flatRect(x - 3, z - 3, x + 3, z + 3, DY, 0xffffff, hsh < 0.5 ? DR.stain1 : DR.stain2, (hsh * 8) | 0, 0.9);
      }
    }
  }
  for (const h of city.helipads || []) {
    if (own && !own(h.x, h.z)) continue;
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
}

// Height of the drawn ground something stands on: the physics ground
// (world/ground.js groundAt) where it is raised or on a block, else the
// drawn open land (LAND_Y by the water, lower further out).
export function drawnGroundY(city, ground, blockAt, onExtra) {
  return (x, z) => {
    const g = ground(x, z);
    if (blockAt(x, z)) return g > BLOCK_Y ? g : BLOCK_Y;
    if (g > 0) return g;
    return city.mainShore(x, z) > 30 || onExtra(x, z) ? -0.06 : -0.12;
  };
}

// A city block: curb, sidewalk and whatever fills the middle, drawn on
// the ground the physics stands on (world/ground.js groundAt, `ground`):
// the island's sidewalk ring at the curb height its edges' sidewalk gives,
// the middle at the ground there (0: the lawn, plaza or yard a car drives
// onto from the curb). `ring` false (a real map, whose edges draw their
// own sidewalks) draws only the middle. Without `ground`, the old raised
// block (+0.16).
export const BLOCK_Y = 0.004; // just over the lot and land surfaces
export function addBlock(B, b, DR, ground = null, ring = true) {
  const cx = (b.x0 + b.x1) / 2, cz = (b.z0 + b.z1) / 2;
  const pv = B.sidewalk.at(cx, cz);
  const KW = 0.3;
  const ringY = ground ? Math.max(BLOCK_Y, ground(b.x0 + SIDEWALK / 2, cz)) : 0.16;
  const Y = ground ? Math.max(BLOCK_Y, ground(cx, cz)) : 0.16;
  if (ring) {
    pv.walls(b.x0, b.z0, b.x1, b.z1, -0.05, ringY, COL.curb, 4.8, 4.8, 0.6, 0.95);
    pv.ring(b.x0, b.z0, b.x1, b.z1, KW, ringY, COL.curb);
    const tone = shade(COL.sidewalk, 0.94 + ((b.id * 37) % 10) * 0.012);
    pv.ring(b.x0 + KW, b.z0 + KW, b.x1 - KW, b.z1 - KW, SIDEWALK - KW, ringY, tone, 0.97, 1);
    // The step down from the sidewalk to a lower middle.
    if (ringY > Y + 0.01) pv.innerWalls(b.x0 + SIDEWALK, b.z0 + SIDEWALK, b.x1 - SIDEWALK, b.z1 - SIDEWALK, Y, ringY, COL.curb, 0.6, 0.95);
  }
  const ix0 = b.x0 + (ring ? SIDEWALK : 0), iz0 = b.z0 + (ring ? SIDEWALK : 0), ix1 = b.x1 - (ring ? SIDEWALK : 0), iz1 = b.z1 - (ring ? SIDEWALK : 0);
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

export function buildCityMesh(city, collision) {
  const tStart = typeof performance !== 'undefined' ? performance.now() : 0;
  const rng = createRng(city.seed + 99);
  const group = new THREE.Group();
  group.name = 'city';
  const S = city.size;
  // A real map (city.map) is far bigger: about 450 m building tiles.
  const TILES = city.map ? Math.max(5, Math.ceil((2 * S) / 450)) : 5, GT = city.map ? Math.max(3, Math.ceil((2 * S) / 700)) : 3;

  const names = city.streetNames ? [...city.streetNames.x.slice(0, 16), ...city.streetNames.z.slice(0, 16)] : [];
  const T = createTextures(city.seed + 7, names);
  const M = makeMaterials(T);

  // --- Sea placeholder (the game swaps in the animated sea). ---
  const water = new THREE.Mesh(
    new THREE.PlaneGeometry(Math.max(9000, S * 5), Math.max(9000, S * 5)).rotateX(-Math.PI / 2),
    new THREE.MeshLambertMaterial({ color: new THREE.Color().setHex(COL.water, THREE.SRGBColorSpace) }),
  );
  water.position.y = -0.5;
  water.name = 'water';
  group.add(water);

  // --- The island itself: a beach sloping into the sea, grass inland. ---
  if (city.radiusAt) {
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
    // from the sea bed inward to the island center.
    add(ring([-22, -9, -3, 4, 30, 700], [-2.2, -0.75, -0.3, -0.12, -0.12, -0.12], [0x8a7a58, 0xb8a47a, 0xd9c698, COL.sand, COL.sand, COL.sand], null, 6), M.sandMat);
    add(ring([33, 60, 700], [-0.06, -0.06, -0.06], [COL.grass, COL.grass, COL.grass], null, 10), M.landMat);
    add(ring([23, 28, 33], [-0.06, -0.06, -0.06], [0xa8b070, 0x98b068, COL.grass], [0, 0.7, 1], 10), M.landRimMat, 1);
  }

  // Shared builders. Ground pieces use big tiles; buildings and props
  // use smaller ones so more of them can be skipped when out of view.
  const B = {
    asphalt: new ChunkedBuilder(S, GT, true, 8),
    ground: new ChunkedBuilder(S, GT, true, 6),
    land: new ChunkedBuilder(S, GT, true, 10),
    sidewalk: new ChunkedBuilder(S, GT, true, 4.8),
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
  const blockAt = city.blockAt || ((x, z) => {
    for (const b of city.blocks) if (x >= b.x0 && x <= b.x1 && z >= b.z0 && z <= b.z1) return b;
    return null;
  });
  const onExtra = (x, z) => (city.extraLand || []).some((r) => x >= r.x0 && x <= r.x1 && z >= r.z0 && z <= r.z1);
  const groundAt = groundFn(city);
  const C = {
    city, collision, ...B, R: T.details.rects, DR, glows: [],
    // Height of the ground something stands on (drawnGroundY).
    groundY: drawnGroundY(city, groundAt, blockAt, onExtra),
  };
  const LY = 0.015, DY = 0.02;

  // --- A real map: land from its raster, roads along any direction. ---
  if (city.landGrid) {
    buildRealGround(city, B);
  }

  // --- Extra land (airfield islet, causeway), piers, aprons, runway. ---
  // (Already part of a real map's land raster.)
  for (const r of city.landGrid ? [] : city.extraLand || []) {
    const cx = (r.x0 + r.x1) / 2, cz = (r.z0 + r.z1) / 2;
    B.sidewalk.at(cx, cz).walls(r.x0, r.z0, r.x1, r.z1, -3, -0.06, 0x9a968c, 4.8, 4.8, 0.45, 1);
    B.grass.at(cx, cz).flat(r.x0, r.z0, r.x1, r.z1, -0.06, COL.grass);
  }
  addSurfaces(city, B, DR);

  // --- Roads, painted lines and the wear and tear on them. ---
  for (const n of city.landGrid ? [] : city.nodes) {
    const hx = n.hx, hz = n.hz;
    B.asphalt.at(n.x, n.z).flat(n.x - hx, n.z - hz, n.x + hx, n.z + hz, 0, COL.junction, 0.94);
    if (n.edges.length < 3 || n.i < 0) continue;
    // Crossings: a pair of lines round the box, crosswalk bars at signals.
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
  for (const e of city.landGrid ? [] : city.edges) {
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
          // Traveling toward b on the +across side (keep right), toward a on the other.
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
      // Curbside parking bays.
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

  // --- City blocks: curb, sidewalk and whatever fills the middle. ---
  for (const b of city.blocks) addBlock(B, b, DR, groundAt, true);

  // --- Buildings (their collision boxes come from world/collision.js). ---
  fillCollision(city, collision);
  for (const b of city.buildings) addBuilding(C, b);

  // --- Street life and landmarks. ---
  const { lamps, bulbs } = addProps(C);

  // --- Turn the builders into meshes. ---
  const ground = { receive: true };
  const solid = { cast: true, receive: true };
  B.asphalt.buildInto(group, M.asphaltMat, ground);
  B.ground.buildInto(group, M.groundMat, ground);
  B.land.buildInto(group, M.landMat, ground);
  B.sidewalk.buildInto(group, M.sidewalkMat, ground);
  B.grass.buildInto(group, M.grassMat, ground);
  B.wood.buildInto(group, M.woodMat, ground);
  B.paint.buildInto(group, M.paintMat, { order: 1, receive: true });
  B.decal.buildInto(group, M.decalMat, { order: 2, receive: true });
  B.ao.buildInto(group, M.aoMat, { order: 3 });
  const tiered = [...B.plain.buildInto(group, M.plainMat, solid), ...B.detail.buildInto(group, M.detailMat, solid)];
  B.glow.buildInto(group, M.glowMat, {});
  for (const k of ['glass', 'brick', 'office', 'stucco', 'siding', 'corrugated', 'roofing', 'shopfront']) B[k].buildInto(group, M[k], { ...solid, name: 'facade-' + k });

  // --- Traffic-light lamps: one instanced mesh, colored per lamp. ---
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
  freezeStatic(group, windsock ? [windsock] : []);
  return group;
}

// ---------------------------------------------------------------------
// Real-map ground (world/miami.js): land from the city's land raster
// (marching squares, so the shore is chamfered rather than stepped),
// a seawall along every shore, and roads as quads along each edge.
// ---------------------------------------------------------------------
export const LAND_Y = -0.06;
export const PAVE = 0xb2aea4, PARK = 0x82ae5e;

export function orientedQuad(bld, ax, az, bx, bz, cx, cz, dx, dz, y, color, sa = 1, sb = sa, sc = sa, sd = sa) {
  bld.quad(ax, y, az, bx, y, bz, cx, y, cz, dx, y, dz, color, 0, 1, 0, 0, 0, 1, 1, sa, sb, sc, sd);
  if (bld.uv) {
    const k = 1 / bld.uvScale, u = bld.uv, o = u.length - 8;
    u[o] = ax * k; u[o + 1] = az * k; u[o + 2] = bx * k; u[o + 3] = bz * k;
    u[o + 4] = cx * k; u[o + 5] = cz * k; u[o + 6] = dx * k; u[o + 7] = dz * k;
  }
}

// A filled polygon (x, z pairs), any winding, fan from the first point.
export function flatPoly(bld, pts, y, color) {
  let area = 0;
  const n = pts.length / 2;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    area += pts[2 * i] * pts[2 * j + 1] - pts[2 * j] * pts[2 * i + 1];
  }
  const k = 1 / bld.uvScale;
  for (let i = 1; i + 1 < n; i++) {
    let b = i, c = i + 1;
    if (area > 0) { b = i + 1; c = i; } // front faces are clockwise in x, z
    bld.tri(pts[0], y, pts[1], pts[2 * b], y, pts[2 * b + 1], pts[2 * c], y, pts[2 * c + 1], color, 0, 1, 0,
      pts[0] * k, pts[1] * k, pts[2 * b] * k, pts[2 * b + 1] * k, pts[2 * c] * k, pts[2 * c + 1] * k);
  }
}

function buildRealGround(city, B) {
  const G = city.landGrid;
  realLand(city, B, 0, G.w - 1, 0, G.h - 1);
  realRoads(city, B, city.nodes, city.edges);
}

// Land from the raster: dual cells between four raster centers, over
// the dual-cell range i0..i1 x j0..j1 (end exclusive), every `s`-th
// raster cell (s > 1: the coarse far copy). Full cells merge into runs
// (never past the range, so a streamed tile owns exactly its cells).
// walls: a seawall along every shore.
export function realLand(city, B, i0, i1, j0, j1, s = 1, y = LAND_Y, walls = true) {
  const G = city.landGrid;
  const { x0, z0, cell, w, h, data } = G;
  const at = (i, j) => {
    const ri = i * s, rj = j * s;
    return ri >= 0 && rj >= 0 && ri < w && rj < h ? data[rj * w + ri] : 0;
  };
  const cx = (i) => x0 + (i * s + 0.5) * cell, cz = (j) => z0 + (j * s + 0.5) * cell;
  const parkAt = (x, z) => { const d = city.districtOf(x, z); return d === 'park' || d === 'airfield'; };
  // Lots (docs/REVAMP.md 6.2): near, a cell whose four corners are all
  // lot ground is left to lotmesh.js (no land drawn under it); far, the
  // land takes the color of the lot under each coarse cell.
  const LG = city.lots && city.lotGrid ? city.lotGrid.ground || city.lotGrid.type : null;
  const lotOwns = (i, j) => {
    const k = j * w + i;
    return DRAWN_T[LG[k]] && DRAWN_T[LG[k + 1]] && DRAWN_T[LG[k + w]] && DRAWN_T[LG[k + w + 1]];
  };
  const WALL = 0x9a968c;
  const P = [[0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (let j = j0; j < j1; j++) {
    const za = cz(j), zb = cz(j + 1);
    let run = -1, runPark = false, runCol = 0;
    const flush = (iEnd) => {
      if (run < 0) return;
      const xa = cx(run), xb = cx(iEnd);
      const bld = runPark ? B.land : B.ground;
      bld.at((xa + xb) / 2, za).flat(xa, za, xb, zb, y, runCol);
      run = -1;
    };
    for (let i = i0; i < i1; i++) {
      const a = at(i, j), b = at(i + 1, j), c = at(i + 1, j + 1), d = at(i, j + 1);
      const sum = a + b + c + d;
      const xa = cx(i), xb = cx(i + 1);
      if (sum === 4) {
        if (LG && s === 1 && i + 1 < w && j + 1 < h && lotOwns(i, j)) { flush(i); continue; }
        const pk = parkAt(xa, za);
        const col = LG && s > 1 ? FAR_LOT_COL[LG[j * s * w + i * s]] || (pk ? PARK : PAVE) : pk ? PARK : PAVE;
        if (run >= 0 && (pk !== runPark || col !== runCol || i - run >= 24)) flush(i);
        if (run < 0) { run = i; runPark = pk; runCol = col; }
        continue;
      }
      flush(i);
      if (sum === 0) continue;
      // Corners clockwise from north-west: a (xa, za), b (xb, za), c (xb, zb), d (xa, zb).
      P[0][0] = xa; P[0][1] = za; P[0][2] = a;
      P[1][0] = xb; P[1][1] = za; P[1][2] = b;
      P[2][0] = xb; P[2][1] = zb; P[2][2] = c;
      P[3][0] = xa; P[3][1] = zb; P[3][2] = d;
      const bld = parkAt(xa, za) ? B.land : B.ground;
      const col = bld === B.land ? PARK : PAVE;
      const saddle = sum === 2 && a === c;
      const pieces = [];
      if (saddle) {
        // Two opposite land corners: a corner triangle at each.
        for (let k = 0; k < 4; k++) {
          if (!P[k][2]) continue;
          const pv = P[(k + 3) % 4], nx = P[(k + 1) % 4];
          pieces.push([P[k][0], P[k][1], (P[k][0] + nx[0]) / 2, (P[k][1] + nx[1]) / 2, (P[k][0] + pv[0]) / 2, (P[k][1] + pv[1]) / 2]);
        }
      } else {
        const poly = [];
        for (let k = 0; k < 4; k++) {
          const p = P[k], q = P[(k + 1) % 4];
          if (p[2]) poly.push(p[0], p[1]);
          if (p[2] !== q[2]) poly.push((p[0] + q[0]) / 2, (p[1] + q[1]) / 2);
        }
        pieces.push(poly);
      }
      const mid = bld.at((xa + xb) / 2, za);
      for (const poly of pieces) flatPoly(mid, poly, y, col);
      if (!walls) continue;
      // Seawall along the shore line through this cell, facing the water.
      const mids = [];
      for (let k = 0; k < 4; k++) {
        const p = P[k], q = P[(k + 1) % 4];
        mids.push(p[2] !== q[2] ? [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2] : null);
      }
      const lines = [];
      if (saddle) {
        for (let k = 0; k < 4; k++) if (P[k][2]) lines.push([mids[(k + 3) % 4], mids[k]]);
      } else {
        const m = mids.filter(Boolean);
        if (m.length === 2) lines.push(m);
      }
      const wb = B.sidewalk.at((xa + xb) / 2, za);
      for (const [s0, s1] of lines) {
        // A wall is seen from its right; water must be on that side.
        const mx = (s0[0] + s1[0]) / 2, mz = (s0[1] + s1[1]) / 2;
        const ex = s1[0] - s0[0], ez = s1[1] - s0[1];
        const len = Math.hypot(ex, ez) || 1;
        const landRight = city.mainShore(mx - (ez / len) * 1.2, mz + (ex / len) * 1.2) > 0;
        if (landRight) wb.wall(s1[0], s1[1], s0[0], s0[1], -3, y + 0.01, WALL, 0, -0.6, len / 4.8, 0, 0.45, 1);
        else wb.wall(s0[0], s0[1], s1[0], s1[1], -3, y + 0.01, WALL, 0, -0.6, len / 4.8, 0, 0.45, 1);
      }
    }
    flush(i1);
  }
}

// A road piece is up to this long (m): pieces are owned by the tile of
// their middle.
export const ROAD_PIECE = 90;

// Scratch (no garbage while tiles stream).
const ST = [], PAINT6 = [], PT = { x: 0, z: 0 }, PT2 = { x: 0, z: 0 }, NOSE = [], TRI6 = [0, 0, 0, 0, 0, 0];

// Flat triangles (x, z triples) at height y, front faces up.
function flatTris(bld, tris, y, color) {
  const k = 1 / bld.uvScale;
  for (let i = 0; i + 5 < tris.length; i += 6) {
    let ax = tris[i], az = tris[i + 1], bx = tris[i + 2], bz = tris[i + 3];
    const cx = tris[i + 4], cz = tris[i + 5];
    // Front faces are clockwise in x, z.
    if ((bx - ax) * (cz - az) - (bz - az) * (cx - ax) > 0) { const tx = ax, tz = az; ax = bx; az = bz; bx = tx; bz = tz; }
    bld.tri(ax, y, az, bx, y, bz, cx, y, cz, color, 0, 1, 0, ax * k, az * k, bx * k, bz * k, cx * k, cz * k);
  }
}

// A corner triangle of junction J where the ground has it raised: whole
// when its middle, its three corners and the middles of its three sides
// (each a quarter of the way in) are off road, left out when all are on road, else cut in four at the
// mid points and each judged again (down to CORNER_CUT m, three cuts at
// most), so a sliver across the asphalt is not drawn as a raised strip
// and a corner that only touches the road keeps its sidewalk.
const CORNER_CUT = 1.5;
function cornerTri(wb, G, J, ax, az, bx, bz, cx, cz, depth) {
  const mx = (ax + bx + cx) / 3, mz = (az + bz + cz) / 3;
  const onRoad = (x, z) => (J.fan && inJunctionArea(J, x, z)) || G.surfaceAt(x, z) === 1;
  let n = onRoad(mx, mz) ? 1 : 0;
  n += onRoad(ax * 0.75 + mx * 0.25, az * 0.75 + mz * 0.25) ? 1 : 0;
  n += onRoad(bx * 0.75 + mx * 0.25, bz * 0.75 + mz * 0.25) ? 1 : 0;
  n += onRoad(cx * 0.75 + mx * 0.25, cz * 0.75 + mz * 0.25) ? 1 : 0;
  n += onRoad((ax + bx) * 0.375 + mx * 0.25, (az + bz) * 0.375 + mz * 0.25) ? 1 : 0;
  n += onRoad((bx + cx) * 0.375 + mx * 0.25, (bz + cz) * 0.375 + mz * 0.25) ? 1 : 0;
  n += onRoad((cx + ax) * 0.375 + mx * 0.25, (cz + az) * 0.375 + mz * 0.25) ? 1 : 0;
  if (n === 7) return;
  const lab = Math.hypot(bx - ax, bz - az), lbc = Math.hypot(cx - bx, cz - bz), lca = Math.hypot(ax - cx, az - cz);
  const long = Math.max(lab, lbc, lca);
  if (n === 0 && long > 2 * CORNER_CUT && depth < 3) {
    // (A long sliver can cross a narrow band of road that no sample above
    // meets: its longest side, a quarter of the way in, every meter.)
    const px = long === lab ? ax : long === lbc ? bx : cx, pz = long === lab ? az : long === lbc ? bz : cz;
    const qx = long === lab ? bx : long === lbc ? cx : ax, qz = long === lab ? bz : long === lbc ? cz : az;
    for (let t = 1; t < long && !n; t += 1) {
      const f = t / long;
      if (onRoad((px + (qx - px) * f) * 0.75 + mx * 0.25, (pz + (qz - pz) * f) * 0.75 + mz * 0.25)) n = 1;
    }
  }
  if (n === 0 || depth >= 3 || long < CORNER_CUT) {
    if (n > 0 && onRoad(mx, mz)) return;
    TRI6[0] = ax; TRI6[1] = az; TRI6[2] = bx; TRI6[3] = bz; TRI6[4] = cx; TRI6[5] = cz;
    flatTris(wb, TRI6, CURB_H, COL.sidewalk);
    return;
  }
  const abx = (ax + bx) / 2, abz = (az + bz) / 2, bcx = (bx + cx) / 2, bcz = (bz + cz) / 2, cax = (cx + ax) / 2, caz = (cz + az) / 2;
  cornerTri(wb, G, J, ax, az, abx, abz, cax, caz, depth + 1);
  cornerTri(wb, G, J, abx, abz, bx, bz, bcx, bcz, depth + 1);
  cornerTri(wb, G, J, cax, caz, bcx, bcz, cx, cz, depth + 1);
  cornerTri(wb, G, J, abx, abz, bcx, bcz, cax, caz, depth + 1);
}

// A junction where a pedestrian street meets two or more streets.
function mallJunction(city, J) {
  let ped = 0, streets = 0;
  for (let m = 0; m < J.arms.length; m++) { if (city.edges[J.arms[m] >> 1].ped) ped++; else streets++; }
  return ped > 0 && streets >= 2;
}
// One triangle of such a junction's ring: asphalt inside the hull of its
// streets' mouths, the mall's flush paving outside; a triangle across the
// hull's edge cut in four, five cuts at most.
function mallTri(B, J, hull, ax, az, bx, bz, cx, cz, depth) {
  const ia = pointInRing(hull, ax, az), ib = pointInRing(hull, bx, bz), ic = pointInRing(hull, cx, cz);
  const im = pointInRing(hull, (ax + bx + cx) / 3, (az + bz + cz) / 3);
  if ((ia === ib && ib === ic && ic === im) || depth >= 5) {
    TRI6[0] = ax; TRI6[1] = az; TRI6[2] = bx; TRI6[3] = bz; TRI6[4] = cx; TRI6[5] = cz;
    if (im) flatTris(B.asphalt.at(J.x, J.z), TRI6, -0.004, COL.junction);
    else flatTris(B.sidewalk.at(J.x, J.z), TRI6, 0.005, COL.plaza);
    return;
  }
  const abx = (ax + bx) / 2, abz = (az + bz) / 2, bcx = (bx + cx) / 2, bcz = (bz + cz) / 2, cax = (cx + ax) / 2, caz = (cz + az) / 2;
  mallTri(B, J, hull, ax, az, abx, abz, cax, caz, depth + 1);
  mallTri(B, J, hull, abx, abz, bx, bz, bcx, bcz, depth + 1);
  mallTri(B, J, hull, cax, caz, bcx, bcz, cx, cz, depth + 1);
  mallTri(B, J, hull, abx, abz, bcx, bcz, cax, caz, depth + 1);
}

// Is the side (0 right, 1 left) of edge end q bare just outside its
// junction: no sidewalk there (kept clear by a gore or a median nose, or
// asphalt up to a facing strip)?
function bareEnd(geo, G, edges, q, side) {
  const e = edges[q >> 1];
  if (!e || e.ped) return false;
  const span = e.length - geo.trim[q | 1] - geo.trim[q & ~1];
  // (Just outside the junction, and where the strip's first piece is
  // judged: its middle, up to 5 m out.)
  for (const t of [Math.min(1, span / 2), Math.min(5, span / 2)]) {
    const d = q & 1 ? e.length - geo.trim[q] - t : geo.trim[q] + t;
    if (supAt(geo, e, side, d) || G.gapAt(e.id, side, d) > 0) return true;
  }
  return false;
}

// Roads (docs/PLAN_V3.md 13, ROADS; world/junctions.js): one asphalt
// polygon per junction with its sidewalk corners and curb returns, and
// per edge a strip trimmed to the junction boundary (mitered at bends,
// tapered where the cross section changes), sidewalks and the median
// along its curbs, and its paint. own(x, z): only junctions (by their
// lead node), pieces and per-edge paint whose point it accepts (a
// streamed tile); null for all.
export function realRoads(city, B, nodes, edges, own = null) {
  if (!city.roadGeo) city.roadGeo = buildRoadGeo(city.nodes, city.edges, city.edgesNear);
  const geo = city.roadGeo;
  for (const n of nodes) {
    const J = geo.junctions[geo.nodeJ[n.id]];
    if (!J || J.lead !== n.id || (own && !own(n.x, n.z))) continue;
    // (Where a pedestrian street meets two or more streets, the ring past
    // the streets' mouths is the mall's paving, not asphalt: no wedge of
    // road out to the mall's end, Lincoln Road.)
    if (!J.fan && mallJunction(city, J)) {
      const hull = fanMouthHull(city, J, true), t = J.tris;
      for (let k = 0; k + 5 < t.length; k += 6) mallTri(B, J, hull, t[k], t[k + 1], t[k + 2], t[k + 3], t[k + 4], t[k + 5], 0);
    } else flatTris(B.asphalt.at(J.x, J.z), J.tris, -0.004, COL.junction);
    // Fork and merge gores: asphalt with white edge lines and chevrons.
    for (const G of J.gores) {
      flatTris(B.asphalt.at(J.x, J.z), G.tris, -0.004, COL.junction);
      const lb = B.paint.at(J.x, J.z), P = G.paint;
      for (let k = 0; k + 4 < P.length; k += 5) {
        const dx = P[k + 2] - P[k], dz = P[k + 3] - P[k + 1], L = Math.hypot(dx, dz);
        if (L < 0.05) continue;
        const nx = (-dz / L) * P[k + 4], nz = (dx / L) * P[k + 4];
        orientedQuad(lb, P[k] + nx, P[k + 1] + nz, P[k + 2] + nx, P[k + 3] + nz, P[k + 2] - nx, P[k + 3] - nz, P[k] - nx, P[k + 1] - nz, 0.015, COL.line);
      }
    }
    // A fan junction: its mouth hull paved under the arms, so no lot or
    // land shows in the crossing where an arm's sidewalk no longer runs
    // on past its mouth (world/junctions.js fanMouthHull).
    if (J.fan) flatPoly(B.asphalt.at(J.x, J.z), fanMouthHull(city, J), -0.007, COL.junction);
    const wb = B.sidewalk.at(J.x, J.z);
    const GJ = groundOf(city);
    for (const c of J.corners) {
      // A corner between two bare sides (a gore, a gap to a facing strip:
      // no sidewalk along either arm, flat in world/ground.js) is asphalt,
      // not a raised pad standing alone in the road.
      if (c.qa !== undefined && bareEnd(geo, GJ, city.edges, c.qa, c.sideA) && bareEnd(geo, GJ, city.edges, c.qb, c.sideB)) {
        if (c.tris) flatTris(B.asphalt.at(J.x, J.z), c.tris, -0.004, COL.junction);
        continue;
      }
      // Only the corner triangles the ground has raised: one that lies on
      // road (the junction area, another strip's asphalt; road first in
      // world/ground.js) is left to the asphalt under it, not drawn as a
      // pad a car drives through. A fan junction (its ring crosses
      // itself) draws no curb through the crossing.
      if (c.tris) {
        const t = c.tris;
        for (let k = 0; k + 5 < t.length; k += 6) cornerTri(wb, GJ, J, t[k], t[k + 1], t[k + 2], t[k + 3], t[k + 4], t[k + 5], 0);
      }
      if (J.fan) continue;
      const p = c.curb;
      for (let k = 0; k + 3 < p.length; k += 2) {
        const dx = p[k + 2] - p[k], dz = p[k + 3] - p[k + 1], L = Math.hypot(dx, dz);
        // (A curb under 0.6 m long, where the return meets the strip's
        // own curb, is not drawn: under a pixel past a few meters. Nor a
        // curb with road on both sides.)
        if (!(L > 0.6)) continue;
        const mx = (p[k] + p[k + 2]) / 2, mz = (p[k + 1] + p[k + 3]) / 2, nx = (-dz / L) * 0.4, nz = (dx / L) * 0.4;
        if (GJ.surfaceAt(mx + nx, mz + nz) === 1 && GJ.surfaceAt(mx - nx, mz - nz) === 1) continue;
        wb.wall(p[k], p[k + 1], p[k + 2], p[k + 3], -0.02, CURB_H, COL.curb, 0, 0, L / 4.8, 0.05, 1, 1);
      }
    }
  }
  for (const e of edges) {
    const a = city.nodes[e.a], b = city.nodes[e.b];
    const ux = e.ux ?? (b.x - a.x) / e.length, uz = e.uz ?? (b.z - a.z) / e.length;
    const rx = -uz, rz = ux;
    const prof = e.avenue ? PROFILE_AVENUE : PROFILE_STREET;
    const pw = prof[prof.length - 1][0];
    // A tone of its own per edge (from its id, so every tile agrees).
    const t = shade(COL.asphalt, 0.9 + 0.16 * edgeHash(e.id));
    // World x, z of (d, o) on the edge.
    const wx = (d, o) => a.x + ux * d + rx * o, wz = (d, o) => a.z + uz * d + rz * o;
    // Half a disc of radius m / 2 on the median band (lateral l - m .. l)
    // at along d, bulging toward dir (-1: node a), with its curb.
    const nose = (mb, wb, d, l, m, dir, col) => {
      const r = m / 2, oc = l - r;
      if (!(r > 0.05)) return;
      NOSE.length = 0;
      for (let k = 0; k <= 6; k++) {
        const t = (k / 6) * Math.PI;
        NOSE.push(wx(d + dir * r * Math.sin(t), oc + r * Math.cos(t)), wz(d + dir * r * Math.sin(t), oc + r * Math.cos(t)));
      }
      const cx = wx(d, oc), cz = wz(d, oc);
      for (let k = 0; k + 3 < NOSE.length; k += 2) {
        TRI6[0] = cx; TRI6[1] = cz; TRI6[2] = NOSE[k]; TRI6[3] = NOSE[k + 1]; TRI6[4] = NOSE[k + 2]; TRI6[5] = NOSE[k + 3];
        flatTris(mb, TRI6, CURB_H, col);
        let ax = NOSE[k], az = NOSE[k + 1], bx = NOSE[k + 2], bz = NOSE[k + 3];
        if (-(bz - az) * ((ax + bx) / 2 - cx) + (bx - ax) * ((az + bz) / 2 - cz) < 0) { const tx = ax, tz = az; ax = bx; az = bz; bx = tx; bz = tz; }
        wb.wall(ax, az, bx, bz, -0.02, CURB_H, COL.curb, 0, 0, 0.2, 0.05, 1, 1);
      }
    };
    // Gaps to facing strips under 6 m (world/ground.js gapOf): asphalt,
    // and no sidewalk, median or fill on that side there.
    const G = groundOf(city), gaps = e.ped ? null : G.gapOf(e.id);
    let gapped = false;
    if (gaps) for (let k = 0; k < gaps.length; k++) if (gaps[k] > 0) { gapped = true; break; }
    edgeStations(geo, e, gapped ? 10 : medianBand(e) > 0 && e.median <= 8 ? 4 : ROAD_PIECE, ST);
    if (gapped) {
      const n = gaps.length / 2, f0 = geo.trim[2 * e.id], f1 = e.length - geo.trim[2 * e.id + 1];
      for (let i = 0; i + 1 < n; i++) {
        const d0 = Math.min(f1, f0 + i * FILL_STEP), d1 = i + 1 === n - 1 ? f1 : Math.min(f1, f0 + (i + 1) * FILL_STEP);
        if (d1 - d0 < 0.05) continue;
        for (let side = 0; side < 2; side++) {
          const w = Math.max(gaps[2 * i + side], gaps[2 * i + 2 + side]);
          if (!(w > 0)) continue;
          const c0 = curbsAt(geo, e, d0), a0 = side ? c0.l : c0.r;
          const c1 = curbsAt(geo, e, d1), a1 = side ? c1.l : c1.r;
          const mx = wx((d0 + d1) / 2, a0), mz = wz((d0 + d1) / 2, a0);
          if (own && !own(mx, mz)) continue;
          const b0 = side ? a0 - w : a0 + w, b1 = side ? a1 - w : a1 + w;
          const lo0 = Math.min(a0, b0), hi0 = Math.max(a0, b0), lo1 = Math.min(a1, b1), hi1 = Math.max(a1, b1);
          orientedQuad(B.asphalt.at(mx, mz), wx(d0, hi0), wz(d0, hi0), wx(d1, hi1), wz(d1, hi1), wx(d1, lo1), wz(d1, lo1), wx(d0, lo0), wz(d0, lo0), 0.008, COL.junction); // (over lot ground, BLOCK_Y)
          // A white edge line along the strip where the gap is wide.
          if (w > 1.5) {
            const p0 = side ? a0 + 0.25 : a0 - 0.25, p1 = side ? a1 + 0.25 : a1 - 0.25;
            orientedQuad(B.paint.at(mx, mz), wx(d0, p0 + 0.07), wz(d0, p0 + 0.07), wx(d1, p1 + 0.07), wz(d1, p1 + 0.07), wx(d1, p1 - 0.07), wz(d1, p1 - 0.07), wx(d0, p0 - 0.07), wz(d0, p0 - 0.07), 0.015, COL.line);
          }
        }
      }
    }
    // Raised strips beside the road (2.1 item 7): sidewalks with a 0.15 m
    // curb on streets with a profile, and the median half a paired
    // one-way owns along its left curb (planted from 1.5 m).
    const wR = walkOf(e), wL = walkLeftOf(e);
    // (A median wider than 8 m is lot ground in its middle: the raised
    // strip covers the 4 m band along each curb, world/miami.js LOT_SETBACK.)
    const med = medianBand(e);
    for (let i = 0; i + 7 < ST.length; i += 4) {
      const d0 = ST[i], k0 = ST[i + 1], l0 = ST[i + 2], r0 = ST[i + 3];
      const d1 = ST[i + 4], k1 = ST[i + 5], l1 = ST[i + 6], r1 = ST[i + 7];
      const mo = (l0 + r0 + l1 + r1) / 4, mx = wx((d0 + d1) / 2, mo), mz = wz((d0 + d1) / 2, mo);
      if (own && !own(mx, mz)) continue;
      // The band from lateral o = lo..hi at both stations, as one quad.
      const band = (bld, lo0, hi0, lo1, hi1, y, col) => orientedQuad(bld,
        wx(d0 + k0 * hi0, hi0), wz(d0 + k0 * hi0, hi0), wx(d1 + k1 * hi1, hi1), wz(d1 + k1 * hi1, hi1),
        wx(d1 + k1 * lo1, lo1), wz(d1 + k1 * lo1, lo1), wx(d0 + k0 * lo0, lo0), wz(d0 + k0 * lo0, lo0), y, col);
      const curb = (bld, o0, o1, fwd) => {
        const ax = wx(d0 + k0 * o0, o0), az = wz(d0 + k0 * o0, o0), bx = wx(d1 + k1 * o1, o1), bz = wz(d1 + k1 * o1, o1);
        const L = Math.hypot(bx - ax, bz - az);
        if (fwd) bld.wall(ax, az, bx, bz, -0.02, CURB_H, COL.curb, 0, 0, L / 4.8, 0.05, 1, 1);
        else bld.wall(bx, bz, ax, az, -0.02, CURB_H, COL.curb, 0, 0, L / 4.8, 0.05, 1, 1);
      };
      if (e.ped) {
        // A pedestrian street: one paving of pavers curb to curb, flush.
        const w = e.sidewalk || 0;
        band(B.sidewalk.at(mx, mz), l0 - w, r0 + w, l1 - w, r1 + w, 0.005, COL.plaza);
        continue;
      }
      const bld = B.asphalt.at(mx, mz);
      for (let k = 0; k < prof.length - 1; k++) {
        const f0 = (prof[k][0] / pw + 1) / 2, f1 = (prof[k + 1][0] / pw + 1) / 2, sa = prof[k][1], sb = prof[k + 1][1];
        const a0 = l0 + (r0 - l0) * f0, b0 = l0 + (r0 - l0) * f1, a1 = l1 + (r1 - l1) * f0, b1 = l1 + (r1 - l1) * f1;
        orientedQuad(bld, wx(d0 + k0 * b0, b0), wz(d0 + k0 * b0, b0), wx(d1 + k1 * b1, b1), wz(d1 + k1 * b1, b1),
          wx(d1 + k1 * a1, a1), wz(d1 + k1 * a1, a1), wx(d0 + k0 * a0, a0), wz(d0 + k0 * a0, a0), 0, t, sb, sb, sa, sa);
      }
      // The halves of a divided road under MEDIAN_GAP apart (no median
      // there: a bridge, a narrow pair): this half's share of the gap is
      // asphalt, so the two read as one road with a painted middle.
      if (e.divided && e.pair >= 0 && !(e.median > 8) && !geo.inner[e.pair]) {
        const g0 = pairGap(city, e, d0 + k0 * l0, l0), g1 = pairGap(city, e, d1 + k1 * l1, l1);
        if (g0 < MEDIAN_GAP && g1 < MEDIAN_GAP && (g0 > 0.05 || g1 > 0.05) && !(medianAt(city, e, d0, l0) > 0 && medianAt(city, e, d1, l1) > 0)) {
          band(bld, l0 - g0 / 2 - 0.3, l0, l1 - g1 / 2 - 0.3, l1, 0.008, COL.junction);
        }
      }
      if (wR > 0 || med > 0) {
        const wb = B.sidewalk.at(mx, mz);
        // (Bare where a gore or a median nose keeps the side clear.)
        const dm = (d0 + d1) / 2, bareR = supAt(geo, e, 0, dm) || G.gapAt(e.id, 0, dm) > 0, bareL = supAt(geo, e, 1, dm) || G.gapAt(e.id, 1, dm) > 0;
        // (Nor where the side lies on another carriageway's asphalt: two
        // strips that overlap, road first in world/ground.js, so a
        // sidewalk drawn there was a raised strip a car drove through.)
        const rm = (r0 + r1) / 2 + wR / 2, lm = (l0 + l1) / 2 - wL / 2;
        if (wR > 0 && !bareR && G.surfaceAt(wx(dm, rm), wz(dm, rm)) !== 1) {
          band(wb, r0, r0 + wR, r1, r1 + wR, CURB_H, COL.sidewalk);
          curb(wb, r0, r1, false);
        }
        if (wL > 0 && !bareL && G.surfaceAt(wx(dm, lm), wz(dm, lm)) !== 1) {
          band(wb, l0 - wL, l0, l1 - wL, l1, CURB_H, COL.sidewalk);
          curb(wb, l0, l1, true);
        }
        if (med > 0 && !bareL) {
          const mb = e.median > MEDIAN_PLANT ? B.grass.at(mx, mz) : wb;
          const m0 = medianAt(city, e, d0, l0), m1 = medianAt(city, e, d1, l1);
          if (m0 > 0 && m1 > 0) {
          band(mb, l0 - m0, l0, l1 - m1, l1, CURB_H, e.median > MEDIAN_PLANT ? COL.lawn : COL.curb);
          curb(wb, l0, l1, true);
          // A round nose where the median starts or stops.
          const before = d0 - 4, after = d1 + 4;
          if (before > geo.trim[2 * e.id] && !(medianAt(city, e, before, curbsAt(geo, e, before).l) > 0)) nose(mb, wb, d0, l0, m0, -1, e.median > MEDIAN_PLANT ? COL.lawn : COL.curb);
          if (after < e.length - geo.trim[2 * e.id + 1] && !(medianAt(city, e, after, curbsAt(geo, e, after).l) > 0)) nose(mb, wb, d1, l1, m1, 1, e.median > MEDIAN_PLANT ? COL.lawn : COL.curb);
          }
          if (m0 > 0 && m1 > 0 && (supAt(geo, e, 1, d0 - 0.05) || G.gapAt(e.id, 1, d0 - 0.05) > 0)) nose(mb, wb, d0, l0, m0, -1, e.median > MEDIAN_PLANT ? COL.lawn : COL.curb);
          if (m0 > 0 && m1 > 0 && (supAt(geo, e, 1, d1 + 0.05) || G.gapAt(e.id, 1, d1 + 0.05) > 0)) nose(mb, wb, d1, l1, m1, 1, e.median > MEDIAN_PLANT ? COL.lawn : COL.curb);
        }
      }
    }
    // The median carried through a junction that nothing crosses it at
    // (world/junctions.js mthru): from the strip end to the node, along
    // the curb line the junction's asphalt ends on.
    if (med > 0 && !geo.inner[e.id]) {
      for (let end = 0; end < 2; end++) {
        const q = 2 * e.id + end;
        if (!geo.mthru[q] || geo.jEnd[q] < 0 || !(geo.trim[q] > 0.05)) continue;
        const da = end ? e.length - geo.trim[q] : 0, db = end ? e.length : geo.trim[q];
        const mx = wx((da + db) / 2, 0), mz = wz((da + db) / 2, 0);
        if (own && !own(mx, mz)) continue;
        const lc = curbsAt(geo, e, end ? da : db).l;
        const m0 = medianAt(city, e, da, lc), m1 = medianAt(city, e, db, lc);
        if (!(m0 > 0 && m1 > 0)) continue;
        const planted = e.median > MEDIAN_PLANT;
        orientedQuad((planted ? B.grass : B.sidewalk).at(mx, mz), wx(da, lc), wz(da, lc), wx(db, lc), wz(db, lc), wx(db, lc - m1), wz(db, lc - m1), wx(da, lc - m0), wz(da, lc - m0), CURB_H, planted ? COL.lawn : COL.curb);
        B.sidewalk.at(mx, mz).wall(wx(da, lc), wz(da, lc), wx(db, lc), wz(db, lc), -0.02, CURB_H, COL.curb, 0, 0, (db - da) / 4.8, 0.05, 1, 1);
      }
    }
    // Where a street crosses a divided road its median stops short of the
    // junction (sup): from the node to the nose this half's share of the
    // gap is asphalt, so the crossing is one paved area between the two
    // halves' junctions, not a band of the block's ground.
    if (e.divided && e.pair >= 0 && !geo.inner[e.id] && !geo.inner[e.pair] && !e.bridge) {
      for (let end = 0; end < 2; end++) {
        const q = 2 * e.id + end;
        if (geo.mthru[q] || geo.jEnd[q] < 0) continue;
        const reach = Math.min(e.length / 2, Math.max(geo.trim[q], geo.sup[2 * q + 1]));
        if (!(reach > 0.5)) continue;
        const da = end ? e.length - reach : 0, db = end ? e.length : reach;
        const mx = wx((da + db) / 2, 0), mz = wz((da + db) / 2, 0);
        if (own && !own(mx, mz)) continue;
        const la = curbsAt(geo, e, da).l, lb = curbsAt(geo, e, db).l;
        const ga = Math.min(16, pairGap(city, e, da, la)), gb = Math.min(16, pairGap(city, e, db, lb));
        if (!(ga > 0.05 || gb > 0.05)) continue;
        orientedQuad(B.asphalt.at(mx, mz), wx(da, la), wz(da, la), wx(db, lb), wz(db, lb), wx(db, lb - gb / 2 - 0.3), wz(db, lb - gb / 2 - 0.3), wx(da, la - ga / 2 - 0.3), wz(da, la - ga / 2 - 0.3), -0.006, COL.junction);
      }
    }
    // Sliver fills (world/ground.js fillOf): raised concrete over gaps
    // under 1.5 m between this road's back of sidewalk and more road.
    const fill = e.ped ? null : G.fillOf(e.id);
    if (fill && fill.length) {
      const n = fill.length / 2, f0 = geo.trim[2 * e.id], f1 = e.length - geo.trim[2 * e.id + 1];
      const backAt = (d, side) => {
        const C = curbsAt(geo, e, d);
        return side ? C.l - (med > 0 ? medianAt(city, e, d, C.l) : wL) : C.r + wR;
      };
      for (let i = 0; i + 1 < n; i++) {
        const d0 = Math.min(f1, f0 + i * FILL_STEP), d1 = i + 1 === n - 1 ? f1 : Math.min(f1, f0 + (i + 1) * FILL_STEP);
        for (let side = 0; side < 2; side++) {
          const w0 = Math.max(fill[2 * i + side], fill[2 * i + 2 + side]), w1 = w0;
          if (!(w0 > 0 || w1 > 0)) continue;
          const b0 = backAt(d0, side), b1 = backAt(d1, side);
          const mx = wx((d0 + d1) / 2, b0), mz = wz((d0 + d1) / 2, b0);
          if (own && !own(mx, mz)) continue;
          // (Never on a junction's asphalt, nor beside a gore.)
          if (supAt(geo, e, side, (d0 + d1) / 2) || G.gapAt(e.id, side, (d0 + d1) / 2) > 0 || onJunction(geo, mx + (wx(0, side ? -1 : 1) - wx(0, 0)) * 0.5, mz + (wz(0, side ? -1 : 1) - wz(0, 0)) * 0.5)) continue;
          const lo0 = side ? b0 - w0 : b0, hi0 = side ? b0 : b0 + w0, lo1 = side ? b1 - w1 : b1, hi1 = side ? b1 : b1 + w1;
          orientedQuad(B.sidewalk.at(mx, mz), wx(d0, hi0), wz(d0, hi0), wx(d1, hi1), wz(d1, hi1), wx(d1, lo1), wz(d1, lo1), wx(d0, lo0), wz(d0, lo0), CURB_H, COL.sidewalk);
        }
      }
    }
    if (own && !own((a.x + b.x) / 2, (a.z + b.z) / 2)) continue;
    if (e.ped) continue;
    // Painted lines (world/junctions.js edgePaint): US paint from the
    // profile (double yellow center, white dashed lane lines, yellow left
    // edge on one-ways), stopping at the junction boundary; two-line
    // crosswalk and stop bar on approaches with a signal or stop sign.
    const lb = B.paint.at((a.x + b.x) / 2, (a.z + b.z) / 2);
    edgePaint(city, e, PAINT6);
    for (let k = 0; k + 5 < PAINT6.length; k += 6) {
      edgePoint(city, e, PAINT6[k], PAINT6[k + 1], PT);
      edgePoint(city, e, PAINT6[k + 2], PAINT6[k + 3], PT2);
      const dx = PT2.x - PT.x, dz = PT2.z - PT.z, L = Math.hypot(dx, dz);
      if (L < 0.05) continue;
      const hw = PAINT6[k + 4], nx = (-dz / L) * hw, nz = (dx / L) * hw;
      orientedQuad(lb, PT.x + nx, PT.z + nz, PT2.x + nx, PT2.z + nz, PT2.x - nx, PT2.z - nz, PT.x - nx, PT.z - nz, 0.015, PAINT6[k + 5] ? COL.yellow : COL.line);
    }
    // Bridges and the causeway over water: concrete deck sides.
    if (e.bridge || e.causeway) {
      const wb = B.sidewalk.at((a.x + b.x) / 2, (a.z + b.z) / 2);
      const L = e.length;
      const off = e.off || 0, half = e.width / 2;
      const hr = half + off, hl = half - off;
      wb.wall(a.x + rx * hr, a.z + rz * hr, b.x + rx * hr, b.z + rz * hr, -1.4, 0.02, 0xa8a49a, 0, 0, L / 4.8, 0.3, 0.6, 1);
      // (No left side where the partner deck is under MEDIAN_GAP away:
      // the gap is paved, world/edgelines.js.)
      const lc = off - half;
      if (!(e.pair >= 0 && Math.max(pairGap(city, e, 0, lc), pairGap(city, e, L, lc)) < MEDIAN_GAP)) {
        wb.wall(b.x - rx * hl, b.z - rz * hl, a.x - rx * hl, a.z - rz * hl, -1.4, 0.02, 0xa8a49a, 0, 0, L / 4.8, 0.3, 0.6, 1);
      }
    }
  }
}

// The narrow-gap net of world/ground.js (ground between two road spaces
// under 2 m apart) over the box x0..x1, z0..z1, from the same lattice the
// physics reads, so the picture and the ground agree: flat net (road on a
// side) as asphalt just under the strips and junctions, over the lot
// ground and its edging; raised net (between two sidewalks or medians,
// one island) as sidewalk just under the sidewalks' top. Returns the quads
// drawn.
export const NET_Y = -0.008;
const NETQ = [];
export function netRoads(city, B, x0, z0, x1, z1) {
  const G = groundOf(city);
  if (!G || !G.netQuads) return 0;
  let n = 0;
  for (let kind = 1; kind <= 2; kind++) {
    NETQ.length = 0;
    G.netQuads(x0, z0, x1, z1, NETQ, kind);
    for (let k = 0; k + 3 < NETQ.length; k += 4) {
      const xa = NETQ[k], za = NETQ[k + 1], xb = NETQ[k + 2], zb = NETQ[k + 3], mx = (xa + xb) / 2, mz = (za + zb) / 2;
      if (kind === 1) B.asphalt.at(mx, mz).flat(xa, za, xb, zb, NET_Y, COL.junction);
      else B.sidewalk.at(mx, mz).flat(xa, za, xb, zb, CURB_H - 0.004, COL.sidewalk);
      n++;
    }
  }
  return n;
}

function edgeHash(id) {
  let h = Math.imul(id + 1, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  return ((h ^ (h >>> 13)) >>> 0) / 4294967296;
}
