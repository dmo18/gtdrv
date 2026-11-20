// Shared vehicle materials. One patched PBR material draws a whole car
// body: a per-vertex class attribute (`aCls`) picks paint, glass, chrome,
// plastic trim, rubber, alloy or plate behaviour, so body + glass + trim
// is a single draw call. Damage (wear, scuffs on the struck side, soot,
// dirt, front/rear crumple) is done in the shader from a few uniforms, so
// it costs nothing per frame and needs no per-car geometry.
// Undamaged cars of one colour share one material; a car gets its own
// clone only once it is damaged (released again when it is removed).
import * as THREE from 'three';

// Surface classes stored in the `aCls` vertex attribute.
export const CLS = { PAINT: 0, LIVERY: 1, TRIM: 2, CHROME: 3, GLASS: 4, RUBBER: 5, ALLOY: 6, PLATE: 7, GLOW: 8 };

// Lamp level shared by every patched material (0 day .. 1 night): far
// LOD models light their baked lamp quads (class GLOW) with it.
const shared = { uLamp: { value: 0 } };
export function setLampUniform(v) {
  shared.uLamp.value = v;
}

const VERT_HEAD = /* glsl */`
attribute float aCls;
varying float vCls;
varying vec3 vObj;
varying vec3 vObjN;
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
`;

const FRAG_HEAD = /* glsl */`
varying float vCls;
varying vec3 vObj;
varying vec3 vObjN;
uniform float uLamp;
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
`;

// Runs after metalnessmap_fragment: sets colour, roughness, metalness and
// a clearcoat weight per class, then applies damage.
const FRAG_BODY = /* glsl */`
float rwC = floor(vCls + 0.5);
float rwCC = 0.0;
vec3 rwCol = vColor;
if (rwC < 0.5) {
  rwCol = diffuse * vColor;
  rwCC = 1.0;
} else if (rwC < 1.5) {
  rwCC = 1.0;
} else if (rwC < 2.5) {
  roughnessFactor = 0.62; metalnessFactor = 0.0; rwCC = 0.08;
} else if (rwC < 3.5) {
  roughnessFactor = 0.14; metalnessFactor = 1.0;
} else if (rwC < 4.5) {
  roughnessFactor = 0.05; metalnessFactor = 0.0; rwCC = 1.0;
} else if (rwC < 5.5) {
  roughnessFactor = 0.92; metalnessFactor = 0.0;
} else if (rwC < 6.5) {
  roughnessFactor = 0.3; metalnessFactor = 0.85;
} else if (rwC < 7.5) {
  roughnessFactor = 0.5; metalnessFactor = 0.0;
} else {
  roughnessFactor = 0.4; metalnessFactor = 0.0;
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
  float h0 = smoothstep(0.35, 0.9, dot(qd, uHit0.xyz)) * smoothstep(-0.2, 0.5, dot(vObjN, uHit0.xyz)) * uHit0.w;
  float h1 = smoothstep(0.35, 0.9, dot(qd, uHit1.xyz)) * smoothstep(-0.2, 0.5, dot(vObjN, uHit1.xyz)) * uHit1.w;
  float hit = clamp(h0 + h1, 0.0, 1.0);
  float scuff = smoothstep(0.42, 0.62, n1 * 0.7 + n2 * 0.45 + hit * 0.55 - 0.25) * hit;
  float metal = smoothstep(0.75, 0.95, n2) * scuff;
  rwCol = mix(rwCol, vec3(0.055, 0.05, 0.048), scuff * (rwC < 3.5 ? 0.85 : 0.3));
  rwCol = mix(rwCol, vec3(0.42, 0.42, 0.43), metal * paintLike);
  roughnessFactor = mix(roughnessFactor, 0.8, scuff);
  metalnessFactor = mix(metalnessFactor, 0.7, metal * paintLike);
  rwCC *= 1.0 - scuff;
  // Crazed glass on the struck side.
  if (rwC > 3.5 && rwC < 4.5) rwCol = mix(rwCol, vec3(0.2, 0.22, 0.24), hit * smoothstep(0.45, 0.7, n2) * 0.8);
  // Soot from a fire: everything goes near black and matte.
  float soot = uDmg.y * (0.8 + 0.2 * n1);
  rwCol = mix(rwCol, vec3(0.022, 0.02, 0.019) + vec3(0.03) * n2, soot);
  roughnessFactor = mix(roughnessFactor, 0.95, uDmg.y);
  metalnessFactor *= 1.0 - uDmg.y;
  rwCC *= 1.0 - uDmg.y;
}
#endif
diffuseColor.rgb = rwCol;
`;

const FRAG_CC = /* glsl */`
#include <lights_physical_fragment>
#ifdef USE_CLEARCOAT
material.clearcoat *= rwCC;
#endif
`;

const FRAG_EMIT = /* glsl */`
#include <emissivemap_fragment>
if (rwC > 7.5) totalEmissiveRadiance += vColor * (0.15 + 1.6 * uLamp);
`;

function patch(mat, damage) {
  const u = mat.userData.rw;
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uLamp = shared.uLamp;
    if (damage) {
      shader.uniforms.uDmg = u.uDmg;
      shader.uniforms.uHit0 = u.uHit0;
      shader.uniforms.uHit1 = u.uHit1;
      shader.uniforms.uBox = u.uBox;
      shader.uniforms.uCrush = u.uCrush;
    }
    const def = damage ? '#define RW_DAMAGE\n' : '';
    shader.vertexShader = def + VERT_HEAD + shader.vertexShader.replace('#include <begin_vertex>', VERT_BODY);
    shader.fragmentShader = def + FRAG_HEAD + shader.fragmentShader
      .replace('#include <color_fragment>', '')
      .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\n' + FRAG_BODY)
      .replace('#include <lights_physical_fragment>', FRAG_CC)
      .replace('#include <emissivemap_fragment>', FRAG_EMIT);
  };
  const key = 'rwveh' + (damage ? 'D' : '') + (mat.isMeshPhysicalMaterial ? 'P' : 'S');
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
  // Dark and mid colours read best as metallic; pale ones as solid gloss.
  return { metalness: lum < 0.05 ? 0.55 : lum < 0.3 ? 0.4 : 0.12, roughness: lum < 0.05 ? 0.32 : 0.38 };
}

// Car paint: clearcoated physical material (the clearcoat gives the
// sharp sky reflection on top of a softer metallic base).
function makePaint(hex, damage, physical) {
  const p = paintParams(hex);
  const opts = { color: hex, vertexColors: true, metalness: p.metalness, roughness: p.roughness };
  const mat = physical
    ? new THREE.MeshPhysicalMaterial({ ...opts, clearcoat: 1, clearcoatRoughness: 0.06 })
    : new THREE.MeshStandardMaterial(opts);
  mat.userData.rw = damage ? damageUniforms() : {};
  patch(mat, damage);
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
export function farMaterial(hex, sooty = false) {
  const key = hex + (sooty ? 's' : '');
  let m = farCache.get(key);
  if (!m) {
    const p = paintParams(hex);
    m = new THREE.MeshStandardMaterial({ color: hex, vertexColors: true, metalness: p.metalness * 0.6, roughness: 0.42 });
    m.userData.rw = damageUniforms();
    if (sooty) m.userData.rw.uDmg.value.set(0.6, 1, 0.5, 3);
    patch(m, true);
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

// ---- lamps ------------------------------------------------------------------
// Lamps are unlit materials reading a tiny 4x1 colour strip: the lamp
// geometry's u coordinate picks a cell (left lens, right lens, extra,
// indicator), so one mesh shows several lamp colours and swapping the
// material switches state for one car only.
function strip(cells) {
  const data = new Uint8Array(16);
  for (let i = 0; i < 4; i++) {
    tmp.setHex(cells[i]);
    data[i * 4] = Math.round(tmp.r * 255);
    data[i * 4 + 1] = Math.round(tmp.g * 255);
    data[i * 4 + 2] = Math.round(tmp.b * 255);
    data[i * 4 + 3] = 255;
  }
  const t = new THREE.DataTexture(data, 4, 1, THREE.RGBAFormat);
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.NearestFilter;
  t.needsUpdate = true;
  return t;
}
function setStrip(tex, cells) {
  const d = tex.image.data;
  for (let i = 0; i < 4; i++) {
    tmp.setHex(cells[i]);
    d[i * 4] = Math.round(tmp.r * 255);
    d[i * 4 + 1] = Math.round(tmp.g * 255);
    d[i * 4 + 2] = Math.round(tmp.b * 255);
  }
  tex.needsUpdate = true;
}

// ColorManagement converts hex to linear; the strip is stored linear and
// read without conversion, so colours here are as authored.
const HEAD_DAY = [0xc9d2da, 0xc9d2da, 0xf4f1e6, 0xc07a1c];
const HEAD_NIGHT = [0xffffff, 0xffffff, 0xfff8e0, 0xc07a1c];
const LAMP = {};
function lampMat(name, cells) {
  const tex = strip(cells);
  const m = new THREE.MeshBasicMaterial({ map: tex, toneMapped: false });
  LAMP[name] = m;
  return m;
}
// Head: cells L lens, R lens, sign/extra, indicator.
lampMat('head', HEAD_DAY);
lampMat('headFlickL', [0x30343a, HEAD_DAY[1], HEAD_DAY[2], HEAD_DAY[3]]);
lampMat('headOff', [0x2a2e33, 0x2a2e33, 0x3a3a36, 0x4a3010]);
// Tail: cells red, reverse, indicator, red (inner). One material per
// combination of brake / reverse / hazard.
const TAIL_DIM_DAY = 0x6e0c0e, TAIL_DIM_NIGHT = 0xc4161a, TAIL_BRAKE = 0xff3a30;
const REV_OFF = 0xb9bec4, REV_ON = 0xffffff, IND_OFF = 0x9a5a12, IND_ON = 0xffa424;
for (let s = 0; s < 8; s++) {
  const brake = s & 1, rev = s & 2, haz = s & 4;
  lampMat('tail' + s, [brake ? TAIL_BRAKE : TAIL_DIM_DAY, rev ? REV_ON : REV_OFF, haz ? IND_ON : IND_OFF, brake ? TAIL_BRAKE : TAIL_DIM_DAY]);
}
lampMat('tailOff', [0x2c0607, 0x50545a, 0x3a2408, 0x2c0607]);
// Light bar: cells red, blue (u 0.125 / 0.375).
lampMat('bar0', [0x3a0a0c, 0x0a1440, 0x606060, 0x606060]);
lampMat('bar1', [0xff2a20, 0x0a1440, 0xffffff, 0x606060]);
lampMat('bar2', [0x3a0a0c, 0x2a5cff, 0xffffff, 0x606060]);

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
  const h = on ? HEAD_NIGHT : HEAD_DAY;
  setStrip(LAMP.head.map, h);
  setStrip(LAMP.headFlickL.map, [0x30343a, h[1], h[2], h[3]]);
  const dim = on ? TAIL_DIM_NIGHT : TAIL_DIM_DAY;
  for (let s = 0; s < 8; s++) {
    const brake = s & 1, rev = s & 2, haz = s & 4;
    setStrip(LAMP['tail' + s].map, [brake ? TAIL_BRAKE : dim, rev ? REV_ON : REV_OFF, haz ? IND_ON : IND_OFF, brake ? TAIL_BRAKE : dim]);
  }
}
export function isLampNight() {
  return lampNight > 0.35;
}

export { LAMP };
