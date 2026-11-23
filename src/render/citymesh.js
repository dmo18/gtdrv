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
import { paintLines, divideOf, CURB_H, MEDIAN_PLANT } from '../world/roadprofile.js';
import { groundFn } from '../world/ground.js';

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

export function makeMaterials(T) {
  const std = (o) => new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0, ...o });
  const ns = (v) => new THREE.Vector2(v, v);
  const M = {
    asphaltMat: std({ map: T.asphalt.map, normalMap: T.asphalt.normalMap, normalScale: ns(0.7), roughnessMap: T.asphalt.wetMap, roughness: 0.93 }),
    sidewalkMat: std({ map: T.sidewalk.map, normalMap: T.sidewalk.normalMap, normalScale: ns(0.6), roughness: 0.88 }),
    grassMat: std({ map: T.grass.map, roughness: 1 }),
    woodMat: std({ map: T.wood.map, roughness: 0.85 }),
    paintMat: std({ map: T.paint.map, roughness: 0.6, alphaTest: 0.5, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
    decalMat: std({ map: T.decals.map, roughness: 0.82, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 }),
    aoMat: makeAoMaterial(),
    plainMat: std({ roughness: 0.82 }),
    detailMat: std({ map: T.details.map, emissiveMap: T.details.emissiveMap, emissive: 0xffffff, emissiveIntensity: 0, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.7 }),
    glowMat: new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false }),
    glass: std({ map: T.glass.map, emissiveMap: T.glass.emissiveMap, roughnessMap: T.glass.roughnessMap, metalnessMap: T.glass.metalnessMap, normalMap: T.glass.normalMap, normalScale: ns(0.6), roughness: 1, metalness: 0.6, emissive: 0xffffff, emissiveIntensity: 0, envMapIntensity: 1.7 }),
    brick: std({ map: T.brick.map, emissiveMap: T.brick.emissiveMap, normalMap: T.brick.normalMap, normalScale: ns(0.5), emissive: 0xffffff, emissiveIntensity: 0, roughness: 0.9 }),
    office: std({ map: T.office.map, emissiveMap: T.office.emissiveMap, roughnessMap: T.office.roughnessMap, metalnessMap: T.office.metalnessMap, normalMap: T.office.normalMap, normalScale: ns(0.7), roughness: 1, metalness: 1, emissive: 0xffffff, emissiveIntensity: 0 }),
    stucco: std({ map: T.stucco.map, emissiveMap: T.stucco.emissiveMap, normalMap: T.stucco.normalMap, normalScale: ns(0.8), emissive: 0xffffff, emissiveIntensity: 0, roughness: 0.92 }),
    havana: std({ map: T.havana.map, emissiveMap: T.havana.emissiveMap, normalMap: T.havana.normalMap, normalScale: ns(0.9), emissive: 0xffffff, emissiveIntensity: 0, roughness: 0.92 }),
    siding: std({ map: T.siding.map, roughness: 0.8 }),
    corrugated: std({ map: T.corrugated.map, roughness: 0.55, metalness: 0.35 }),
    roofing: std({ map: T.roofing.map, roughness: 0.9 }),
    shopfront: std({ map: T.shopfront.map, emissiveMap: T.shopfront.emissiveMap, roughnessMap: T.shopfront.roughnessMap, metalnessMap: T.shopfront.metalnessMap, roughness: 1, metalness: 1, emissive: 0xffffff, emissiveIntensity: 0 }),
  };
  M.paintMat.alphaToCoverage = true;
  // Land under everything: pushed back a touch so roads sit on top.
  M.landMat = std({ map: T.grass.map, roughness: 1, polygonOffset: true, polygonOffsetFactor: 2, polygonOffsetUnits: 2 });
  M.landRimMat = std({ map: T.grass.map, roughness: 1, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 });
  M.groundMat = std({ map: T.sidewalk.map, roughness: 0.95, polygonOffset: true, polygonOffsetFactor: 2, polygonOffsetUnits: 2 });
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
  const LG = city.lots && city.lotGrid ? city.lotGrid.type : null;
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

// The junction disc's corners, reused (no garbage while tiles stream).
const DISC = new Array(20).fill(0);

// Roads: discs at nodes cover joins and bends; quads along each edge.
// own(x, z): only nodes, pieces and per-edge paint whose point it
// accepts (a streamed tile); null for all.
export function realRoads(city, B, nodes, edges, own = null) {
  for (const n of nodes) {
    if (own && !own(n.x, n.z)) continue;
    let r = 2;
    for (const eid of n.edges) r = Math.max(r, city.edges[eid].width / 2);
    const bld = B.asphalt.at(n.x, n.z);
    const pts = DISC;
    for (let k = 0; k < 10; k++) {
      const a = (k / 10) * TAU;
      pts[2 * k] = n.x + Math.cos(a) * r;
      pts[2 * k + 1] = n.z + Math.sin(a) * r;
    }
    flatPoly(bld, pts, -0.012, COL.junction);
  }
  for (const e of edges) {
    const a = city.nodes[e.a], b = city.nodes[e.b];
    const ux = e.ux ?? (b.x - a.x) / e.length, uz = e.uz ?? (b.z - a.z) / e.length;
    const rx = -uz, rz = ux;
    const half = e.width / 2;
    // The cross section's middle lies `off` right of the node line (a
    // paired one-way pulled against its partner; docs/MAP.md).
    const off = e.off || 0;
    const prof = e.avenue ? PROFILE_AVENUE : PROFILE_STREET;
    const scale = half / prof[prof.length - 1][0];
    // A tone of its own per edge (from its id, so every tile agrees).
    const t = shade(COL.asphalt, 0.9 + 0.16 * edgeHash(e.id));
    const s0 = Math.min(a.hx, e.length * 0.3), s1 = e.length - Math.min(b.hx, e.length * 0.3);
    const segs = Math.max(1, Math.round((s1 - s0) / ROAD_PIECE));
    // Raised strips beside the road (2.1 item 7): sidewalks with a 0.15 m
    // curb on streets with a profile, and the median half a paired
    // one-way owns along its left curb (planted from 1.5 m).
    const walk = e.lanesF !== undefined && !e.bridge && !e.causeway && !e.ped ? e.sidewalk || 0 : 0;
    // (A median wider than 8 m is lot ground in its middle: the raised
    // strip covers the 4 m band along each curb, world/miami.js LOT_SETBACK.)
    const med = e.median > 0 && !e.bridge ? Math.min(e.median / 2, 4) : 0;
    for (let sg = 0; sg < segs; sg++) {
      const d0 = s0 + ((s1 - s0) * sg) / segs, d1 = s0 + ((s1 - s0) * (sg + 1)) / segs;
      const px0 = a.x + ux * d0 + rx * off, pz0 = a.z + uz * d0 + rz * off, px1 = a.x + ux * d1 + rx * off, pz1 = a.z + uz * d1 + rz * off;
      if (own && !own((px0 + px1) / 2, (pz0 + pz1) / 2)) continue;
      if (e.ped) {
        // A pedestrian street: one paving of pavers curb to curb, flush.
        const pb = B.sidewalk.at((px0 + px1) / 2, (pz0 + pz1) / 2);
        const w = half + (e.sidewalk || 0);
        orientedQuad(pb, px0 + rx * w, pz0 + rz * w, px1 + rx * w, pz1 + rz * w, px1 - rx * w, pz1 - rz * w, px0 - rx * w, pz0 - rz * w, 0.005, COL.plaza);
        continue;
      }
      const bld = B.asphalt.at((px0 + px1) / 2, (pz0 + pz1) / 2);
      for (let k = 0; k < prof.length - 1; k++) {
        const o0 = prof[k][0] * scale, o1 = prof[k + 1][0] * scale, sa = prof[k][1], sb = prof[k + 1][1];
        orientedQuad(bld, px0 + rx * o1, pz0 + rz * o1, px1 + rx * o1, pz1 + rz * o1, px1 + rx * o0, pz1 + rz * o0, px0 + rx * o0, pz0 + rz * o0, 0, t, sb, sb, sa, sa);
      }
      if (walk > 0 || med > 0) {
        const wb = B.sidewalk.at((px0 + px1) / 2, (pz0 + pz1) / 2);
        const L = d1 - d0;
        const strip = (lo, hi, sb2, col) => orientedQuad(sb2, px0 + rx * hi, pz0 + rz * hi, px1 + rx * hi, pz1 + rz * hi, px1 + rx * lo, pz1 + rz * lo, px0 + rx * lo, pz0 + rz * lo, CURB_H, col);
        if (walk > 0) {
          strip(half, half + walk, wb, COL.sidewalk);
          wb.wall(px1 + rx * half, pz1 + rz * half, px0 + rx * half, pz0 + rz * half, -0.02, CURB_H, COL.curb, 0, 0, L / 4.8, 0.05, 1, 1);
          if (med <= 0) {
            strip(-half - walk, -half, wb, COL.sidewalk);
            wb.wall(px0 - rx * half, pz0 - rz * half, px1 - rx * half, pz1 - rz * half, -0.02, CURB_H, COL.curb, 0, 0, L / 4.8, 0.05, 1, 1);
          }
        }
        if (med > 0) {
          const mb = e.median > MEDIAN_PLANT ? B.grass.at((px0 + px1) / 2, (pz0 + pz1) / 2) : wb;
          strip(-half - med, -half, mb, e.median > MEDIAN_PLANT ? COL.lawn : COL.curb);
          wb.wall(px0 - rx * half, pz0 - rz * half, px1 - rx * half, pz1 - rz * half, -0.02, CURB_H, COL.curb, 0, 0, L / 4.8, 0.05, 1, 1);
        }
      }
    }
    if (own && !own((a.x + b.x) / 2, (a.z + b.z) / 2)) continue;
    if (e.ped) continue;
    // Painted lines.
    const lb = B.paint.at((a.x + b.x) / 2, (a.z + b.z) / 2);
    const line = (d0, d1, o0, o1, col) => {
      orientedQuad(lb, a.x + ux * d0 + rx * o1, a.z + uz * d0 + rz * o1, a.x + ux * d1 + rx * o1, a.z + uz * d1 + rz * o1,
        a.x + ux * d1 + rx * o0, a.z + uz * d1 + rz * o0, a.x + ux * d0 + rx * o0, a.z + uz * d0 + rz * o0, 0.015, col);
    };
    if (e.lanesF !== undefined && city.map === 'miami') {
      // US paint from the profile (world/roadprofile.js paintLines):
      // double yellow center, white dashed lane lines (10 ft dash, 30 ft
      // gap), yellow left edge on one-ways and divided roads, parking lane
      // lines; crosswalks are two lines, never striped bars.
      paintLines(e, PAINT);
      const ds0 = s0 + 1, ds1 = s1 - 1;
      for (let k = 0; k < PAINT.length; k += 2) {
        const o = PAINT[k], kind = PAINT[k + 1];
        if (kind === 'yellow2') {
          line(ds0, ds1, o - 0.27, o - 0.12, COL.yellow);
          line(ds0, ds1, o + 0.12, o + 0.27, COL.yellow);
        } else if (kind === 'yellow' || kind === 'turn') {
          line(ds0, ds1, o - 0.07, o + 0.07, COL.yellow);
          if (kind === 'turn') {
            const inner = o < 0 ? o + 0.3 : o - 0.3;
            for (let d = s0 + 4; d < s1 - 6; d += 12) line(d, d + 3, inner - 0.07, inner + 0.07, COL.yellow);
          }
        } else if (kind === 'white') {
          line(ds0, ds1, o - 0.07, o + 0.07, COL.line);
        } else if (kind === 'park') {
          line(ds0, ds1, o - 0.05, o + 0.05, COL.line);
        } else {
          for (let d = s0 + 4; d < s1 - 6; d += 12) line(d, d + 3, o - 0.07, o + 0.07, COL.line);
        }
      }
      // A white stop bar across the lanes coming in and a two-line
      // crosswalk at each end with a signal or a stop sign.
      if (s1 - s0 > 14 && !e.causeway) {
        const sdiv = divideOf(e), L0 = off - half + 0.3, R0 = off + half - 0.3;
        for (const [n, d, dir] of [[a, s0, 1], [b, s1, -1]]) {
          if (!n.edges || n.edges.length < 3 || !(n.signal || n.stop)) continue;
          // Crosswalk: two 0.3 m lines 3 m apart, curb to curb.
          const c0 = d + dir * 0.6, c1 = d + dir * 3.6;
          line(Math.min(c0, c0 + dir * 0.3), Math.max(c0, c0 + dir * 0.3), L0, R0, COL.line);
          line(Math.min(c1, c1 - dir * 0.3), Math.max(c1, c1 - dir * 0.3), L0, R0, COL.line);
          // Stop bar on the incoming lanes (into b: the forward half).
          const incoming = dir < 0 ? true : !e.oneway;
          if (!incoming) continue;
          const sb0 = d + dir * 4.4;
          const lo = dir < 0 ? (e.oneway ? L0 + e.parkL : sdiv) : L0 + e.parkL, hi = dir < 0 ? R0 - e.parkR : sdiv;
          line(Math.min(sb0, sb0 + dir * 0.45), Math.max(sb0, sb0 + dir * 0.45), Math.min(lo, hi), Math.max(lo, hi), COL.line);
        }
      }
    } else if (e.avenue) {
      line(s0 + 2, s1 - 2, -0.35, -0.15, COL.yellow);
      line(s0 + 2, s1 - 2, 0.15, 0.35, COL.yellow);
      for (let d = s0 + 4; d < s1 - 6; d += 9) {
        line(d, d + 3, -4.42, -4.28, COL.line);
        line(d, d + 3, 4.28, 4.42, COL.line);
      }
    } else if (!e.oneway) {
      for (let d = s0 + 4; d < s1 - 6; d += 9) line(d, d + 3, -0.08, 0.08, COL.yellow);
    } else {
      for (let d = s0 + 4; d < s1 - 6; d += 9) line(d, d + 3, -0.08, 0.08, COL.line);
    }
    // Bridges and the causeway over water: concrete deck sides.
    if (e.bridge || e.causeway) {
      const wb = B.sidewalk.at((a.x + b.x) / 2, (a.z + b.z) / 2);
      const L = e.length;
      const hr = half + off, hl = half - off;
      wb.wall(a.x + rx * hr, a.z + rz * hr, b.x + rx * hr, b.z + rz * hr, -1.4, 0.02, 0xa8a49a, 0, 0, L / 4.8, 0.3, 0.6, 1);
      wb.wall(b.x - rx * hl, b.z - rz * hl, a.x - rx * hl, a.z - rz * hl, -1.4, 0.02, 0xa8a49a, 0, 0, L / 4.8, 0.3, 0.6, 1);
    }
  }
}

// Paint scratch (paintLines output), reused.
const PAINT = [];

function edgeHash(id) {
  let h = Math.imul(id + 1, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  return ((h ^ (h >>> 13)) >>> 0) / 4294967296;
}
