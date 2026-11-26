// Shared vehicle materials. One patched PBR material draws a whole car
// body: a per-vertex class attribute (`aCls`) picks paint, glass, chrome,
// plastic trim, rubber, alloy or plate behavior, so body + glass + trim
// is a single draw call. Damage (wear, scuffs on the struck side, soot,
// dirt, front/rear crumple) is done in the shader from a few uniforms, so
// it costs nothing per frame and needs no per-car geometry.
// Undamaged cars of one color share one material; a car gets its own
// clone only once it is damaged (released again when it is removed).
import * as THREE from 'three';
import { FINISHES, WHEELS, TINTS, DECALS, PAINTS, paintCode, codeRgb, codeFinish, codeDecal } from '../core/custom.js';

// Surface classes stored in the `aCls` vertex attribute.
export const CLS = { PAINT: 0, LIVERY: 1, TRIM: 2, CHROME: 3, GLASS: 4, RUBBER: 5, ALLOY: 6, PLATE: 7, GLOW: 8, SHADOW: 9, CABIN: 10 };

// Lamp level shared by every patched material (0 day .. 1 night): far
// LOD models light their baked lamp quads (class GLOW) with it.
// uRim (the alloy tint of a wheel look) and uDecal (stripe color and kind
// of a paint look) are white and none for every material without a look.
const shared = { uLamp: { value: 0 }, uRim: { value: new THREE.Color(1, 1, 1) }, uDecal: { value: new THREE.Vector4(0, 0, 0, 0) } };
export function setLampUniform(v) {
  shared.uLamp.value = v;
}

const VERT_HEAD = /* glsl */`
attribute float aCls;
varying float vCls;
varying vec3 vObj;
varying vec3 vObjN;
#ifdef RW_STREET
varying vec3 vRwW;
#endif
#ifdef RW_DAMAGE
uniform vec4 uCrush;
#endif
`;

const VERT_BODY = /* glsl */`
#include <begin_vertex>
vCls = aCls;
#ifdef RW_DAMAGE
{
  float cf = uCrush.x * smoothstep(uCrush.z - 1.2, uCrush.z, transformed.x);
  float cr = uCrush.y * smoothstep(uCrush.w + 1.2, uCrush.w, transformed.x);
  float wob = sin(transformed.z * 9.0 + transformed.y * 13.0) * 0.6 + sin(transformed.z * 23.0 + transformed.x * 5.0) * 0.4;
  transformed.x += cr - cf;
  transformed.y += (cf + cr) * 0.16 * wob;
  transformed.z *= 1.0 + (cf + cr) * 0.05 * wob;
}
#endif
vObj = transformed;
vObjN = objectNormal;
#ifdef RW_STREET
vRwW = (modelMatrix * vec4(transformed, 1.0)).xyz;
#endif
`;

const FRAG_HEAD = /* glsl */`
varying float vCls;
varying vec3 vObj;
varying vec3 vObjN;
uniform float uLamp;
uniform vec3 uRim;
uniform vec4 uDecal;
#ifdef RW_STREET
varying vec3 vRwW;
#endif
#ifdef RW_DAMAGE
uniform vec4 uDmg;
uniform vec4 uHit0;
uniform vec4 uHit1;
uniform vec4 uBox;
#endif
float rwHash(vec3 p) {
  p = fract(p * 0.3183099 + vec3(0.71, 0.113, 0.419));
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}
float rwNoise(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(rwHash(i), rwHash(i + vec3(1.0, 0.0, 0.0)), f.x), mix(rwHash(i + vec3(0.0, 1.0, 0.0)), rwHash(i + vec3(1.0, 1.0, 0.0)), f.x), f.y),
    mix(mix(rwHash(i + vec3(0.0, 0.0, 1.0)), rwHash(i + vec3(1.0, 0.0, 1.0)), f.x), mix(rwHash(i + vec3(0.0, 1.0, 1.0)), rwHash(i + vec3(1.0, 1.0, 1.0)), f.x), f.y),
    f.z);
}
#ifdef RW_STREET
// A cheap stand-in for the street in reflections: a skyline of blocks
// with windows around the horizon (lit at night) over the sky the
// environment map gives. r: world reflection direction; w: world
// position (the blocks slide past as the car moves). m: coverage.
vec3 rwStreet(vec3 r, vec3 w, float night, out float m) {
  m = 0.0;
  float h = r.y;
  if (h < -0.02) {
    // The road: dark asphalt, a touch lighter toward the horizon.
    m = smoothstep(-0.02, -0.08, h) * 0.85;
    return mix(vec3(0.05, 0.05, 0.052), vec3(0.008), night) * (1.0 + 0.6 * smoothstep(-0.3, -0.02, h));
  }
  if (h > 0.36) return vec3(0.0);
  float u = atan(r.z, r.x) * 3.2 + w.x * 0.09 + w.z * 0.07;
  float cell = floor(u);
  float hs = fract(sin(cell * 91.7) * 4375.85);
  float top = 0.05 + 0.27 * hs * hs;
  float fu = fract(u);
  m = smoothstep(top + 0.006, top - 0.006, h) * smoothstep(0.0, 0.03, fu) * smoothstep(1.0, 0.94, fu);
  vec3 fac = mix(vec3(0.42, 0.38, 0.33), vec3(0.26, 0.3, 0.35), fract(hs * 7.3));
  float wu = u * 10.0, wh = h * 95.0;
  float aa = clamp(1.6 - 0.9 * max(fwidth(wu), fwidth(wh)), 0.0, 1.0);
  float win = mix(0.3, step(0.42, fract(wu)) * step(0.35, fract(wh)), aa);
  vec3 day = mix(fac, vec3(0.18, 0.22, 0.27), win * 0.25);
  float lit = step(0.6, fract(sin(dot(floor(vec2(wu, wh)), vec2(12.9898, 78.233))) * 43758.55));
  vec3 nite = mix(vec3(0.006, 0.007, 0.01), vec3(0.95, 0.6, 0.3) * 0.32, win * mix(0.4, lit, aa));
  return mix(day, nite, night);
}
#endif
`;

// Runs after metalnessmap_fragment: sets color, roughness, metalness and
// a clearcoat weight per class, then applies damage.
const FRAG_BODY = /* glsl */`
float rwC = floor(vCls + 0.5);
float rwCC = 0.0;
vec3 rwCol = vColor.rgb;
if (rwC < 0.5) {
  rwCol = diffuse * vColor.rgb;
  rwCC = 1.0;
  // A look's stripes on the top faces: kind 1 twin, kind 2 one down the center.
  if (uDecal.w > 0.5 && vObjN.y > 0.35) {
    float rwZ = abs(vObj.z);
    float rwS = uDecal.w < 1.5 ? step(0.14, rwZ) * step(rwZ, 0.4) : step(rwZ, 0.27);
    rwCol = mix(rwCol, uDecal.rgb, rwS);
  }
} else if (rwC < 1.5) {
  rwCC = 1.0;
} else if (rwC < 2.5) {
  roughnessFactor = 0.62; metalnessFactor = 0.0; rwCC = 0.08;
} else if (rwC < 3.5) {
  roughnessFactor = 0.14; metalnessFactor = 1.0;
} else if (rwC < 4.5) {
  roughnessFactor = 0.04; metalnessFactor = 0.3; rwCC = 1.0;
} else if (rwC < 5.5) {
  roughnessFactor = 0.92; metalnessFactor = 0.0;
} else if (rwC < 6.5) {
  roughnessFactor = 0.3; metalnessFactor = 0.85;
  rwCol *= uRim;
} else if (rwC < 7.5) {
  roughnessFactor = 0.5; metalnessFactor = 0.0;
} else if (rwC < 8.5) {
  roughnessFactor = 0.4; metalnessFactor = 0.0;
} else {
  roughnessFactor = 0.85; metalnessFactor = 0.0;
}
#ifdef RW_DAMAGE
{
  float paintLike = rwC < 1.5 ? 1.0 : 0.0;
  float wear = uDmg.x;
  float n1 = rwNoise(vObj * 6.0 + uDmg.w);
  float n2 = rwNoise(vObj * vec3(1.3, 38.0, 9.0) + uDmg.w * 3.0);
  // Overall dulling and a little grime with wear.
  rwCol *= 1.0 - 0.22 * wear * paintLike;
  roughnessFactor = mix(roughnessFactor, max(roughnessFactor, 0.55), wear * 0.75 * paintLike);
  rwCC *= 1.0 - 0.65 * wear * paintLike;
  // Road dirt on the lower body.
  float dirt = (1.0 - smoothstep(0.12, 0.62, vObj.y)) * uDmg.z * (0.6 + 0.4 * n1);
  rwCol = mix(rwCol, vec3(0.075, 0.064, 0.052), dirt * 0.75);
  roughnessFactor = mix(roughnessFactor, 0.85, dirt);
  // Scuffs and scrapes on the struck sides.
  vec3 q = vec3(vObj.x / uBox.x, (vObj.y - uBox.z * 0.45) / uBox.z, vObj.z / uBox.y);
  vec3 qd = normalize(q + vec3(0.0001));
  float h0 = smoothstep(0.35, 0.9, dot(qd, uHit0.xyz)) * smoothstep(0.15, 0.65, dot(vObjN, uHit0.xyz)) * uHit0.w;
  float h1 = smoothstep(0.35, 0.9, dot(qd, uHit1.xyz)) * smoothstep(0.15, 0.65, dot(vObjN, uHit1.xyz)) * uHit1.w;
  float hit = clamp(h0 + h1, 0.0, 1.0);
  float scuff = smoothstep(0.42, 0.62, n1 * 0.7 + n2 * 0.45 + hit * 0.55 - 0.25) * hit;
  float metal = smoothstep(0.75, 0.95, n2) * scuff;
  rwCol = mix(rwCol, vec3(0.055, 0.05, 0.048), scuff * (rwC < 3.5 ? 0.85 : 0.3));
  rwCol = mix(rwCol, vec3(0.2, 0.2, 0.21), metal * paintLike);
  roughnessFactor = mix(roughnessFactor, 0.8, scuff);
  metalnessFactor = mix(metalnessFactor, 0.7, metal * paintLike);
  rwCC *= 1.0 - scuff;
  // Crazed glass on the struck side.
  if (rwC > 3.5 && rwC < 4.5) rwCol = mix(rwCol, vec3(0.12, 0.13, 0.14), hit * smoothstep(0.5, 0.75, n2) * 0.6);
  // Soot from a fire: everything goes near black and matte.
  float soot = uDmg.y * (0.9 + 0.1 * n1);
  rwCol = mix(rwCol, vec3(0.016, 0.015, 0.014) + vec3(0.025, 0.02, 0.016) * n2, soot);
  roughnessFactor = mix(roughnessFactor, 0.95, uDmg.y);
  metalnessFactor *= 1.0 - uDmg.y;
  rwCC *= 1.0 - uDmg.y;
}
#endif
diffuseColor.rgb = rwCol;
`;

// Metallic flake: a faint per-texel tilt of the base normal on paint, faded
// out with distance so it never shimmers. The clearcoat keeps the smooth
// normal, so the sky reflection stays sharp on top of the sparkle.
const FRAG_FLAKE = /* glsl */`
#include <normal_fragment_maps>
if (rwC < 1.5) {
  vec3 rwFc = floor(vObj * 360.0);
  float rwK = 1.0 - smoothstep(3.0, 11.0, length(vViewPosition));
  if (rwK > 0.0) {
    vec3 rwJ = vec3(rwHash(rwFc), rwHash(rwFc + 7.31), rwHash(rwFc + 3.17)) - 0.5;
    normal = normalize(normal + rwJ * 0.07 * rwK);
  }
}
`;

const FRAG_CC = /* glsl */`
#include <lights_physical_fragment>
#ifdef USE_CLEARCOAT
material.clearcoat *= rwCC;
#ifdef RW_STREET
// A slightly hotter clear coat than physical: the sky and street read on
// the panels at every angle, as they do in car games.
material.clearcoatF0 = vec3(0.075);
#endif
#endif
`;

// Street reflection on paint and glass: the skyline is mixed into the
// sharp clearcoat reflection and, softer, into the base layer.
const FRAG_REFL = /* glsl */`
#include <lights_fragment_maps>
#ifdef RW_STREET
{
  float rwM;
  #ifdef USE_ENVMAP
  float rwEi = envMapIntensity;
  #else
  float rwEi = 1.0;
  #endif
  vec3 rwR = inverseTransformDirection(reflect(-geometryViewDir, geometryNormal), viewMatrix);
  vec3 rwS = rwStreet(rwR, vRwW, uLamp, rwM) * rwEi;
  // Flat tops (hood, roof, trunk) take little of the skyline: one block
  // filled the whole hood as a hard striped rectangle (0.13.7); the sides
  // and the glass keep it.
  float rwTop = 1.0 - 0.85 * smoothstep(0.6, 0.92, inverseTransformDirection(geometryNormal, viewMatrix).y);
  rwM *= rwTop;
  float rwSharp = 1.0 - smoothstep(0.2, 0.7, roughnessFactor);
  radiance = mix(radiance, rwS, rwM * rwSharp * (rwC < 1.5 || (rwC > 3.5 && rwC < 4.5) ? 0.8 : 0.4));
  #ifdef USE_CLEARCOAT
  vec3 rwRc = inverseTransformDirection(reflect(-geometryViewDir, geometryClearcoatNormal), viewMatrix);
  float rwMc;
  vec3 rwSc = rwStreet(rwRc, vRwW, uLamp, rwMc) * rwEi;
  clearcoatRadiance = mix(clearcoatRadiance, rwSc, rwMc * rwTop);
  #endif
}
#endif
`;

const FRAG_EMIT = /* glsl */`
#include <emissivemap_fragment>
if (rwC > 7.5 && rwC < 8.5) totalEmissiveRadiance += vColor.rgb * (0.15 + 1.6 * uLamp);
`;

function patch(mat, damage, street = false) {
  const u = mat.userData.rw;
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uLamp = shared.uLamp;
    shader.uniforms.uRim = u.uRim || shared.uRim;
    shader.uniforms.uDecal = u.uDecal || shared.uDecal;
    if (damage) {
      shader.uniforms.uDmg = u.uDmg;
      shader.uniforms.uHit0 = u.uHit0;
      shader.uniforms.uHit1 = u.uHit1;
      shader.uniforms.uBox = u.uBox;
      shader.uniforms.uCrush = u.uCrush;
    }
    const def = (damage ? '#define RW_DAMAGE\n' : '') + (street ? '#define RW_STREET\n' : '');
    shader.vertexShader = def + VERT_HEAD + shader.vertexShader.replace('#include <begin_vertex>', VERT_BODY);
    shader.fragmentShader = def + FRAG_HEAD + shader.fragmentShader
      .replace('#include <color_fragment>', '')
      .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\n' + FRAG_BODY)
      .replace('#include <normal_fragment_maps>', FRAG_FLAKE)
      .replace('#include <lights_physical_fragment>', FRAG_CC)
      .replace('#include <lights_fragment_maps>', FRAG_REFL)
      .replace('#include <emissivemap_fragment>', FRAG_EMIT);
  };
  const key = 'rwveh' + (damage ? 'D' : '') + (street ? 'R' : '') + (mat.isMeshPhysicalMaterial ? 'P' : 'S');
  mat.customProgramCacheKey = () => key;
}

function damageUniforms() {
  return {
    uDmg: { value: new THREE.Vector4(0, 0, 0, 0) },
    uHit0: { value: new THREE.Vector4(1, 0, 0, 0) },
    uHit1: { value: new THREE.Vector4(-1, 0, 0, 0) },
    uBox: { value: new THREE.Vector4(2.3, 0.9, 1.4, 0) },
    uCrush: { value: new THREE.Vector4(0, 0, 2.3, -2.3) },
  };
}

// Every material that should follow the vehicle environment map.
const envUsers = new Set();
let envTex = null;
let envIntensity = 1;
function track(mat) {
  envUsers.add(mat);
  if (envTex) {
    mat.envMap = envTex;
    mat.envMapIntensity = envIntensity * (mat.userData.envScale || 1);
  }
  return mat;
}

// Use `tex` as the reflection map for all vehicle materials (null: fall
// back to scene.environment). Intensity scales reflections (night).
export function setVehicleEnvMap(tex, intensity = 1) {
  const changed = tex !== envTex;
  envTex = tex;
  envIntensity = intensity;
  for (const m of envUsers) {
    if (changed) {
      m.envMap = tex;
      m.needsUpdate = true;
    }
    m.envMapIntensity = intensity * (m.userData.envScale || 1);
  }
}

const tmp = new THREE.Color();
function paintParams(hex) {
  tmp.setHex(hex);
  const lum = tmp.r * 0.3 + tmp.g * 0.6 + tmp.b * 0.1;
  // Dark and mid colors read best as metallic; pale ones as solid gloss.
  return { metalness: lum < 0.05 ? 0.55 : lum < 0.3 ? 0.4 : 0.12, roughness: lum < 0.05 ? 0.32 : 0.38 };
}

// Car paint: clearcoated physical material (the clearcoat gives the
// sharp sky reflection on top of a softer metallic base).
// `code`: a plain 24 bit color, or a look's paint code (core/custom.js
// paintCode: the color with a finish and a decal in the bits above). The
// finishes only change material numbers (the clearcoat is never 0), so
// they share the one paint program.
const PAINT_MAX = 0.68;
function makePaint(code, damage, physical) {
  const hex = codeRgb(code), fin = FINISHES[codeFinish(code)] || FINISHES[0], dec = DECALS[codeDecal(code)] || DECALS[0];
  const stock = codeFinish(code) === 0;
  const p = stock ? paintParams(hex) : { metalness: fin[1], roughness: fin[2] };
  // White paints held a little under paper white: in the noon sun with
  // the clear coat on top the roof, hood and trunk burnt out to one flat
  // white shape (0.13.7).
  const col = new THREE.Color(hex);
  const hi = Math.max(col.r, col.g, col.b);
  if (hi > PAINT_MAX) col.multiplyScalar(PAINT_MAX / hi);
  const opts = { color: col, vertexColors: true, metalness: p.metalness, roughness: p.roughness };
  const mat = physical
    ? new THREE.MeshPhysicalMaterial({ ...opts, clearcoat: stock ? 1 : fin[3], clearcoatRoughness: stock ? 0.06 : fin[4] })
    : new THREE.MeshStandardMaterial(opts);
  mat.userData.rw = damage ? damageUniforms() : {};
  if (dec[2] > 0) {
    tmp.setHex(dec[1], THREE.SRGBColorSpace);
    mat.userData.rw.uDecal = { value: new THREE.Vector4(tmp.r, tmp.g, tmp.b, dec[2]) };
  }
  patch(mat, damage, true);
  return track(mat);
}

let usePhysical = true;
// Quality switch: false uses MeshStandard (no clearcoat) for new cars.
export function setPaintQuality(physical) {
  usePhysical = !!physical;
}

const paintCache = new Map();
export function paintMaterial(hex) {
  const key = hex + (usePhysical ? 'p' : 's');
  let m = paintCache.get(key);
  if (!m) {
    // Shared paints use the damage variant too (all zeros), so a car that
    // gets damaged keeps the same shader program.
    m = makePaint(hex, true, usePhysical);
    paintCache.set(key, m);
  }
  return m;
}

// A private paint for one damaged car. Caller disposes it.
export function ownPaintMaterial(hex, box) {
  const m = makePaint(hex, true, usePhysical);
  m.userData.rw.uBox.value.copy(box);
  m.userData.own = true;
  return m;
}

export function releaseMaterial(m) {
  if (m && m.userData.own) {
    envUsers.delete(m);
    m.dispose();
  }
}

const farCache = new Map();
// Far LOD: plain standard material, same class patch (no clearcoat).
export function farMaterial(code, sooty = false) {
  const hex = codeRgb(code);
  const key = hex + (sooty ? 's' : '');
  let m = farCache.get(key);
  if (!m) {
    const p = paintParams(hex);
    m = new THREE.MeshStandardMaterial({ color: hex, vertexColors: true, metalness: p.metalness * 0.6, roughness: 0.42 });
    m.userData.rw = damageUniforms();
    if (sooty) m.userData.rw.uDmg.value.set(0.6, 1, 0.5, 3);
    patch(m, true, true);
    track(m);
    farCache.set(key, m);
  }
  return m;
}

let wheelMat = null;
let wheelSoot = null;
export function wheelMaterial(sooty = false) {
  if (sooty) {
    if (!wheelSoot) {
      wheelSoot = new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.9, metalness: 0 });
      wheelSoot.userData.rw = damageUniforms();
      wheelSoot.userData.rw.uDmg.value.set(1, 1, 1, 7);
      patch(wheelSoot, true);
      track(wheelSoot);
    }
    return wheelSoot;
  }
  if (!wheelMat) {
    wheelMat = new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.5, metalness: 0 });
    wheelMat.userData.rw = {};
    patch(wheelMat, false);
    track(wheelMat);
  }
  return wheelMat;
}

// Generic hull / airframe material for boats and aircraft: same class
// patch on a physical material (gelcoat and paint get the clearcoat).
const craftCache = new Map();
export function craftMaterial(kind = 'gloss') {
  let m = craftCache.get(kind);
  if (!m) {
    const physical = usePhysical;
    const opts = { color: 0xffffff, vertexColors: true, metalness: 0.08, roughness: kind === 'matte' ? 0.6 : 0.34 };
    m = physical ? new THREE.MeshPhysicalMaterial({ ...opts, clearcoat: kind === 'matte' ? 0.2 : 0.85, clearcoatRoughness: 0.08 })
      : new THREE.MeshStandardMaterial(opts);
    m.userData.rw = damageUniforms();
    patch(m, true);
    track(m);
    craftCache.set(kind, m);
  }
  return m;
}

// Static parked fleet shells (L2, docs/FLEET.md): one instanced mesh per
// model, the paint color per instance. A cheap diffuse material (sun and
// sky only, no reflections) where the instance color tints the paint
// faces (class PAINT) only; glass, trim and wheels keep their vertex
// color and the lamp dots (class GLOW) light up at night with the shared
// lamp level.
let shellMat = null;
export function lotShellMaterial() {
  if (shellMat) return shellMat;
  shellMat = new THREE.MeshLambertMaterial({ vertexColors: true });
  shellMat.onBeforeCompile = (shader) => {
    shader.uniforms.uLamp = shared.uLamp;
    shader.vertexShader = 'attribute float aCls;\nvarying float vCls;\n' + shader.vertexShader.replace('#include <color_vertex>', `
      vColor = vec4(1.0);
      vColor.rgb *= color;
      vCls = aCls;
      #ifdef USE_INSTANCING_COLOR
      if (aCls < 0.5) vColor.rgb *= instanceColor.rgb;
      #endif`);
    shader.fragmentShader = 'uniform float uLamp;\nvarying float vCls;\n' + shader.fragmentShader.replace('#include <emissivemap_fragment>',
      '#include <emissivemap_fragment>\nif (vCls > 7.5 && vCls < 8.5) totalEmissiveRadiance += vColor.rgb * (0.15 + 1.6 * uLamp);');
  };
  shellMat.customProgramCacheKey = () => 'rwshell';
  return shellMat;
}

// ---- lamps ------------------------------------------------------------------
// One lamp mesh per car holds the head and the tail lamps. Its lit,
// glossy material (lenses reflect the sky by day) has an emissive map that
// is a tiny 16x1 strip: the geometry's u coordinate picks a cell. Cells
// 0..7 are the front half (0 left lens, 1 right lens, 2 DRL / sign /
// extra, 3 indicator, 4 housing, 5..7 plate), cells 8..15 the rear half
// (8 red left, 9 reverse, 10 indicator, 11 red right, 12 housing, 13..15
// plate). Swapping the material switches the lamp state of one car only.
// The color map is a matching atlas: lens base colors and an invented
// number plate per half. The police light bar keeps its own 8-cell strip.
function strip(cells) {
  const n = cells.length <= 4 ? 8 : 16;
  const data = new Uint8Array(n * 4);
  for (let i = 0; i < n; i++) data[i * 4 + 3] = 255;
  const t = new THREE.DataTexture(data, n, 1, THREE.RGBAFormat);
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.NearestFilter;
  setStrip(t, cells);
  return t;
}
function setStrip(tex, cells) {
  const d = tex.image.data;
  const half = tex.image.width / 2;
  for (let i = 0; i < cells.length; i++) {
    tmp.setHex(cells[i]);
    const o = (i < 4 ? i : half + i - 4) * 4;
    d[o] = Math.round(tmp.r * 255);
    d[o + 1] = Math.round(tmp.g * 255);
    d[o + 2] = Math.round(tmp.b * 255);
  }
  tex.needsUpdate = true;
}

// 5x7 glyphs for the plate text (rows top to bottom, bit 4 = left).
const GLYPHS = {
  R: [30, 17, 17, 30, 20, 18, 17], W: [17, 17, 17, 21, 21, 21, 10], '-': [0, 0, 0, 31, 0, 0, 0],
  4: [2, 6, 10, 18, 31, 2, 2], 8: [14, 17, 17, 14, 17, 17, 14], 2: [14, 17, 1, 2, 4, 8, 31], 1: [4, 12, 4, 4, 4, 4, 14],
  T: [31, 4, 4, 4, 4, 4, 4], A: [14, 17, 17, 31, 17, 17, 17], X: [17, 17, 10, 4, 10, 17, 17], I: [14, 4, 4, 4, 4, 4, 14],
  S: [15, 16, 16, 14, 1, 1, 30], C: [14, 17, 16, 16, 16, 17, 14], H: [17, 17, 17, 31, 17, 17, 17], O: [14, 17, 17, 17, 17, 17, 14],
  L: [16, 16, 16, 16, 16, 16, 31], B: [30, 17, 17, 30, 17, 17, 30], U: [17, 17, 17, 17, 17, 17, 14], P: [30, 17, 17, 30, 16, 16, 16],
};
export const PLATE_TEXT = 'RWT H82';
// Sign words in the free rows of each atlas half, over the plate's
// columns (x 80..127): rows 0..7 ('top') and 24..31 ('low'); half 0 is the
// front (head) half, 1 the rear (tail) half. Background and letter colors.
export const SIGN_TEXT = {
  taxi: { half: 0, row: 'top', text: 'TAXI', bg: 0xf4c81c, fg: 0x141414 },
  school: { half: 0, row: 'low', text: 'SCHOOL', bg: 0xf2b400, fg: 0x141414 },
  bus: { half: 1, row: 'top', text: 'BUS', bg: 0xf2b400, fg: 0x141414 },
  stop: { half: 1, row: 'low', text: 'STOP', bg: 0xc4121c, fg: 0xf4f4f4 },
};
// The atlas rectangle (u, v within one half, 0..1) of a sign word, inset
// half a texel so linear filtering never reaches the next row.
export function signUV(key) {
  const t = SIGN_TEXT[key];
  const x0 = 80 + Math.floor((48 - t.text.length * 6 + 1) / 2) - 1;
  const x1 = x0 + t.text.length * 6 + 1;
  const y0 = t.row === 'top' ? 0 : 24;
  return { u0: (x0 + 0.5) / 128, u1: (x1 - 0.5) / 128, v0: (y0 + 0.5) / 32, v1: (y0 + 7.5) / 32, half: t.half, bg: t.bg };
}
// RGBA pixels of one half of the lamp atlas (128 x 32), one 16 px column
// per strip cell: lens cells 0..3, housing cell 4, then the plate in
// cells 5..7 (x 80..127, rows 8..23). Pure, so tests can read it.
export function lampAtlasPixels(base, half = -1) {
  const Wd = 128, Hd = 32;
  const d = new Uint8Array(Wd * Hd * 4);
  const put = (x, y, hex) => {
    const i = (y * Wd + x) * 4;
    d[i] = (hex >> 16) & 255;
    d[i + 1] = (hex >> 8) & 255;
    d[i + 2] = hex & 255;
    d[i + 3] = 255;
  };
  for (let y = 0; y < Hd; y++) {
    for (let x = 0; x < 80; x++) put(x, y, base[x >> 4]);
    for (let x = 80; x < Wd; x++) {
      const edge = y === 8 || y === 23 || x === 80 || x === 127;
      put(x, y, y < 8 || y > 23 ? 0x202224 : edge ? 0x2a2c30 : 0xe9e7dc);
    }
  }
  let cx = 80 + Math.floor((48 - PLATE_TEXT.length * 6 + 1) / 2);
  for (const ch of PLATE_TEXT) {
    const g = GLYPHS[ch];
    if (g) {
      for (let r = 0; r < 7; r++) {
        for (let c = 0; c < 5; c++) if (g[r] & (16 >> c)) put(cx + c, 19 - r, 0x16181c);
      }
    }
    cx += 6;
  }
  // Sign words of this half (none on the light bar's atlas).
  for (const k in SIGN_TEXT) {
    const t = SIGN_TEXT[k];
    if (t.half !== half) continue;
    const y0 = t.row === 'top' ? 0 : 24;
    for (let y = y0; y < y0 + 8; y++) for (let x = 80; x < Wd; x++) put(x, y, t.bg);
    let tx = 80 + Math.floor((48 - t.text.length * 6 + 1) / 2);
    for (const ch of t.text) {
      const g = GLYPHS[ch];
      for (let r = 0; r < 7; r++) for (let c = 0; c < 5; c++) if (g[r] & (16 >> c)) put(tx + c, y0 + 7 - r, t.fg);
      tx += 6;
    }
  }
  return d;
}
function atlasTex(pixels, w) {
  const t = new THREE.DataTexture(pixels, w, 32, THREE.RGBAFormat);
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearFilter;
  t.colorSpace = THREE.SRGBColorSpace;
  t.needsUpdate = true;
  return t;
}
const HEAD_BASE = [0xdfe4ea, 0xdfe4ea, 0xeef0f2, 0xd8a050, 0x50565e];
const TAIL_BASE = [0x8a161a, 0x8a7e80, 0xc08a3a, 0x8a161a, 0x2a0507];
const BAR_BASE = [0x8a1a1e, 0x1a2a8a, 0xe8e8e8, 0x1a1b1e, 0x1a1b1e];
// Front half and rear half side by side (256 x 32).
export function lampPairPixels() {
  const a = lampAtlasPixels(HEAD_BASE, 0), b = lampAtlasPixels(TAIL_BASE, 1);
  const d = new Uint8Array(256 * 32 * 4);
  for (let y = 0; y < 32; y++) {
    d.set(a.subarray(y * 512, y * 512 + 512), y * 1024);
    d.set(b.subarray(y * 512, y * 512 + 512), y * 1024 + 512);
  }
  return d;
}
const ATLAS = {};
function atlasFor(kind) {
  if (!ATLAS[kind]) ATLAS[kind] = kind === 'bar' ? atlasTex(lampAtlasPixels(BAR_BASE), 128) : atlasTex(lampPairPixels(), 256);
  return ATLAS[kind];
}

// ColorManagement converts hex to linear; the strip is stored linear and
// read without conversion, so colors here are as authored.
const HEAD_DAY = [0x24282c, 0x24282c, 0xd8e4f0, 0x5a3408];
const HEAD_NIGHT = [0xffffff, 0xffffff, 0xffffff, 0x8a4a0a];
const TAIL_DIM_DAY = 0x3a0405, TAIL_DIM_NIGHT = 0x5a0303, TAIL_BRAKE = 0xb00604;
const REV_OFF = 0x000000, REV_ON = 0xffffff, IND_OFF = 0x000000, IND_ON = 0xffa424;
const LAMP = { pair: [] };
function lampMat(cells, kind) {
  const tex = strip(cells);
  const m = new THREE.MeshStandardMaterial({ map: atlasFor(kind), emissiveMap: tex, emissive: 0xffffff, emissiveIntensity: 2.4, metalness: 0.35, roughness: 0.14 });
  m.userData.envScale = 1.4;
  return track(m);
}
// Strip cells of a lamp state: head 0 normal / 1 left lamp out, tail bits
// 1 brake, 2 reverse, 4 hazard.
function pairCells(h, t, night) {
  const hc = night ? HEAD_NIGHT : HEAD_DAY;
  const dim = night ? TAIL_DIM_NIGHT : TAIL_DIM_DAY;
  const brake = t & 1, rev = t & 2, haz = t & 4;
  return [h ? 0x101214 : hc[0], hc[1], hc[2], haz ? IND_ON : hc[3],
    brake ? TAIL_BRAKE : dim, rev ? REV_ON : REV_OFF, haz ? IND_ON : IND_OFF, brake ? TAIL_BRAKE : dim];
}
for (let h = 0; h < 2; h++) for (let t = 0; t < 8; t++) LAMP.pair[h * 8 + t] = lampMat(pairCells(h, t, false), 'pair');
LAMP.off = lampMat([0, 0, 0, 0, 0, 0, 0, 0], 'pair');
// Burnt-out lamps: sooty lenses.
LAMP.off.color.setHex(0x1a1816);
LAMP.off.roughness = 0.7;
// Light bar: cells red, blue, white, base.
LAMP.bar0 = lampMat([0x120203, 0x020412, 0x000000, 0x000000], 'bar');
LAMP.bar1 = lampMat([0xff2a20, 0x020412, 0xffffff, 0x000000], 'bar');
LAMP.bar2 = lampMat([0x120203, 0x2a5cff, 0xffffff, 0x000000], 'bar');

// Lamp material for a state (shared by every car in that state).
export function lampMaterial(headOut, tailBits, off = false) {
  return off ? LAMP.off : LAMP.pair[(headOut ? 8 : 0) + (tailBits & 7)];
}

let lampNight = -1;
// Night level 0..1 brightens head and tail lamps for every car.
export function setLampNight(n) {
  const on = n > 0.35;
  setLampUniform(n);
  if (on === (lampNight > 0.35)) {
    lampNight = n;
    return;
  }
  lampNight = n;
  for (let h = 0; h < 2; h++) for (let t = 0; t < 8; t++) setStrip(LAMP.pair[h * 8 + t].emissiveMap, pairCells(h, t, on));
}
export function isLampNight() {
  return lampNight > 0.35;
}

// ---- glass and contact shadow ------------------------------------------------
// Tinted see-through glass (one transparent draw per car) that also holds
// the car's contact shadow: vertices of class SHADOW are pressed flat onto
// the ground under the car whatever the body's lean, and draw as black
// with their u coordinate as opacity. Premultiplied alpha keeps the sky
// and street reflections bright on the glass while the cabin shows through.
const GLASS_VERT = /* glsl */`
#include <project_vertex>
vRwA = uv.x;
if (aCls > 8.5) {
  // The morph target lifted the vertex by the car's clearance over the
  // surface under it (carbody.js shadowLift): the shadow stays on that
  // surface, shrinks a little and fades out from 0.3 to 1.5 m up.
  float rwClr = max(transformed.y - 0.02, 0.0);
  float rwFade = smoothstep(0.3, 1.5, rwClr);
  vec4 rwG = modelMatrix * vec4(transformed.x, 0.02, transformed.z, 1.0);
  rwG.xz = mix(rwG.xz, modelMatrix[3].xz, rwFade * 0.45);
  rwG.y = modelMatrix[3].y + 0.02 - rwClr;
  vRwA *= 1.0 - rwFade;
  mvPosition = viewMatrix * rwG;
  gl_Position = projectionMatrix * mvPosition;
}
`;
const GLASS_FRAG = /* glsl */`
#include <metalnessmap_fragment>
float rwC = floor(vCls + 0.5);
roughnessFactor = 0.05;
metalnessFactor = 0.0;
diffuseColor.rgb *= 1.0 - 0.85 * uRwGlass.z;
float rwK = 0.0;
if (uRwGlass.x > 0.5) {
  float m = smoothstep(0.32, 0.5, rwNoise(vObj * 2.3));
  float c1 = 1.0 - smoothstep(0.0, 0.05, abs(rwNoise(vObj * 11.0) - 0.5));
  float c2 = 1.0 - smoothstep(0.0, 0.06, abs(rwNoise(vObj * 29.0 + 3.1) - 0.5));
  rwK = m * max(c1, c2 * 0.85);
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.5, 0.52, 0.54), max(rwK, m * 0.35));
  roughnessFactor = mix(0.05, 0.6, m);
}
`;
const GLASS_OUT = /* glsl */`
float rwNV = saturate(dot(normal, normalize(vViewPosition)));
float rwAl = mix(mix(0.7, 0.98, uRwGlass.z), 0.97, pow(1.0 - rwNV, 3.0));
if (uRwGlass.x > 0.5) rwAl = max(rwAl, 0.55 + 0.4 * rwK);
gl_FragColor = vec4(totalDiffuse * rwAl + totalSpecular, rwAl);
if (rwC > 8.5) gl_FragColor = vec4(0.0, 0.0, 0.0, vRwA);
else if (uRwGlass.y > 0.5) discard;
`;
const GLASS_FOG = /* glsl */`
#include <fog_fragment>
#ifdef USE_FOG
gl_FragColor.rgb -= fogFactor * fogColor * (1.0 - gl_FragColor.a);
#endif
`;
const glassCache = {};
// state: 'clean', 'crack' (crazed, cloudy) or 'gone' (blown out: only the
// contact shadow draws). tint: 0 (as built) to 1 (a look's window tint).
export function carGlassMaterial(state = 'clean', tint = 0) {
  const gkey = tint > 0 && state !== 'gone' ? state + tint : state;
  let m = glassCache[gkey];
  if (m) return m;
  m = new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.05, metalness: 0, transparent: true, depthWrite: false, premultipliedAlpha: true });
  // One shader program for all three states (no compile on first damage):
  // the state is a uniform (x crazed, y blown out).
  const def = '#define RW_STREET\n';
  const uRwGlass = { value: new THREE.Vector3(state === 'crack' ? 1 : 0, state === 'gone' ? 1 : 0, gkey === state ? 0 : tint) };
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uLamp = shared.uLamp;
    shader.uniforms.uRwGlass = uRwGlass;
    shader.vertexShader = def + VERT_HEAD + 'varying float vRwA;\n' + shader.vertexShader
      .replace('#include <begin_vertex>', VERT_BODY)
      .replace('#include <project_vertex>', GLASS_VERT);
    shader.fragmentShader = def + FRAG_HEAD + 'varying float vRwA;\nuniform vec3 uRwGlass;\n' + shader.fragmentShader
      .replace('#include <metalnessmap_fragment>', GLASS_FRAG)
      .replace('#include <lights_fragment_maps>', FRAG_REFL)
      .replace('#include <opaque_fragment>', GLASS_OUT)
      .replace('#include <fog_fragment>', GLASS_FOG)
      .replace('#include <premultiplied_alpha_fragment>', '');
  };
  m.customProgramCacheKey = () => 'rwglass';
  m.userData.envScale = 1.3;
  glassCache[gkey] = track(m);
  return m;
}

// ---- looks (docs/LOOP.md section f; rules in core/custom.js) ----------------
const wheelLooks = [];
// The wheel material of a look: the shared wheel material with its alloy tinted.
export function wheelLookMaterial(style) {
  const w = WHEELS[style];
  if (!w || style === 0) return wheelMaterial();
  let m = wheelLooks[style];
  if (!m) {
    m = new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.5, metalness: 0 });
    m.userData.rw = { uRim: { value: new THREE.Color().setHex(w[1], THREE.SRGBColorSpace) } };
    patch(m, false);
    wheelLooks[style] = track(m);
  }
  return m;
}
// Put a look on a car mesh (render/vehiclemesh.js createVehicleMesh):
// look { paint, finish, wheels, tint, decal } as indexes into the tables,
// `base` the color the car came in (paint -1 keeps it). The mesh keeps the
// paint code as its color, so damage and the far model follow the look.
export function applyLook(mesh, look, base) {
  const ud = mesh && mesh.userData;
  if (!ud || !ud.body || !ud.wheelLevels) return false;
  const rgb = look.paint >= 0 && PAINTS[look.paint] ? PAINTS[look.paint][1] : codeRgb(base);
  const code = paintCode(rgb, look.finish, look.decal);
  if (code !== ud.color) {
    ud.color = code;
    if (ud.ownPaint) {
      const old = ud.ownPaint;
      ud.ownPaint = ownPaintMaterial(code, ud.box);
      const a = old.userData.rw, b = ud.ownPaint.userData.rw;
      b.uDmg.value.copy(a.uDmg.value); b.uHit0.value.copy(a.uHit0.value); b.uHit1.value.copy(a.uHit1.value); b.uCrush.value.copy(a.uCrush.value);
      ud.body.material = ud.bodyMid.material = ud.ownPaint;
      releaseMaterial(old);
    } else ud.body.material = ud.bodyMid.material = paintMaterial(code);
    if (ud.far) ud.far.material = farMaterial(code, !!ud.wrecked);
  }
  ud.look = { wheels: look.wheels | 0, tint: (TINTS[look.tint] || TINTS[0])[1] };
  keepLook(mesh);
  return true;
}
// The wheel and glass materials of a look, put back after damage swapped them.
export function keepLook(mesh) {
  const ud = mesh.userData, lk = ud.look;
  if (!lk || ud.wrecked) return;
  const wl = ud.wheelLevels;
  if (!wl || !wl.length) return;
  const wm = wheelLookMaterial(lk.wheels);
  if (wl[0].material !== wm) for (let i = 0; i < wl.length; i++) wl[i].material = wm;
  const gl = ud.glassLevels;
  if (gl && gl.length) {
    const gm = carGlassMaterial(ud.glassState || 'clean', lk.tint);
    if (gl[0].material !== gm) for (let i = 0; i < gl.length; i++) gl[i].material = gm;
  }
}

export { LAMP };

// Give a merged vertex-colored geometry an `aCls` attribute by matching
// each vertex color against a table of { hex: class } (boats, aircraft).
// Unmatched colors stay paint-like gloss (class 1: own color, clearcoat).
export function classifyByColor(geo, table) {
  const col = geo.attributes.color;
  const n = col.count;
  const cls = new Float32Array(n).fill(CLS.LIVERY);
  const keys = [];
  for (const hex in table) {
    tmp.setHex(+hex);
    keys.push([tmp.r, tmp.g, tmp.b, table[hex]]);
  }
  for (let i = 0; i < n; i++) {
    const r = col.getX(i), g = col.getY(i), b = col.getZ(i);
    for (const k of keys) {
      if (Math.abs(r - k[0]) + Math.abs(g - k[1]) + Math.abs(b - k[2]) < 0.004) {
        cls[i] = k[3];
        break;
      }
    }
  }
  geo.setAttribute('aCls', new THREE.BufferAttribute(cls, 1));
  return geo;
}
