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
vec3 rwCol = vColor.rgb;
if (rwC < 0.5) {
  rwCol = diffuse * vColor.rgb;
  rwCC = 1.0;
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
#endif
`;

const FRAG_EMIT = /* glsl */`
#include <emissivemap_fragment>
if (rwC > 7.5) totalEmissiveRadiance += vColor.rgb * (0.15 + 1.6 * uLamp);
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
      .replace('#include <normal_fragment_maps>', FRAG_FLAKE)
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
// Lamp meshes use a lit, glossy material (lenses reflect the sky by day)
// whose emissive map is a tiny 8x1 strip: the geometry's u coordinate picks
// a cell (0 left lens, 1 right lens, 2 DRL / sign / extra, 3 indicator;
// cells 4..7 are dark and hold the number plates), so one mesh shows several
// lamp colours and swapping the material switches state for one car only.
// The colour map is a small atlas: lens base colours in its left half and
// an invented number plate in its right half.
function strip(cells) {
  const data = new Uint8Array(32);
  for (let i = 0; i < 8; i++) data[i * 4 + 3] = 255;
  const t = new THREE.DataTexture(data, 8, 1, THREE.RGBAFormat);
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.NearestFilter;
  setStrip(t, cells);
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

// 5x7 glyphs for the plate text (rows top to bottom, bit 4 = left).
const GLYPHS = {
  R: [30, 17, 17, 30, 20, 18, 17], W: [17, 17, 17, 21, 21, 21, 10], '-': [0, 0, 0, 31, 0, 0, 0],
  4: [2, 6, 10, 18, 31, 2, 2], 8: [14, 17, 17, 14, 17, 17, 14], 2: [14, 17, 1, 2, 4, 8, 31], 1: [4, 12, 4, 4, 4, 4, 14],
};
export const PLATE_TEXT = 'RW-4821';
// RGBA pixels of the lamp atlas (128 x 32), one 16 px column per strip
// cell: lens cells 0..3, housing cell 4, then the plate in cells 5..7
// (x 80..127, rows 8..23). Pure, so tests can read it.
export function lampAtlasPixels(base) {
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
  return d;
}
function atlas(base) {
  const t = new THREE.DataTexture(lampAtlasPixels(base), 128, 32, THREE.RGBAFormat);
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearFilter;
  t.colorSpace = THREE.SRGBColorSpace;
  t.needsUpdate = true;
  return t;
}
const ATLAS = {};
function atlasFor(kind) {
  if (!ATLAS[kind]) {
    ATLAS[kind] = atlas(kind === 'tail' ? [0x8a161a, 0xd8dadc, 0xc08a3a, 0x8a161a, 0x2a0507]
      : kind === 'bar' ? [0x8a1a1e, 0x1a2a8a, 0xe8e8e8, 0x1a1b1e, 0x1a1b1e] : [0xdfe4ea, 0xdfe4ea, 0xeef0f2, 0xd8a050, 0x262b32]);
  }
  return ATLAS[kind];
}

// ColorManagement converts hex to linear; the strip is stored linear and
// read without conversion, so colours here are as authored.
const HEAD_DAY = [0x24282c, 0x24282c, 0xd8e4f0, 0x5a3408];
const HEAD_NIGHT = [0xffffff, 0xffffff, 0xffffff, 0x8a4a0a];
const LAMP = {};
function lampMat(name, cells, kind) {
  const tex = strip(cells);
  const m = new THREE.MeshStandardMaterial({ map: atlasFor(kind), emissiveMap: tex, emissive: 0xffffff, emissiveIntensity: 2.4, metalness: 0.35, roughness: 0.14 });
  m.userData.envScale = 1.4;
  LAMP[name] = m;
  return track(m);
}
// Head: cells L lens, R lens, sign/extra, indicator.
lampMat('head', HEAD_DAY, 'head');
lampMat('headFlickL', [0x101214, HEAD_DAY[1], HEAD_DAY[2], HEAD_DAY[3]], 'head');
lampMat('headOff', [0x000000, 0x000000, 0x000000, 0x000000], 'head');
// Tail: cells red, reverse, indicator, red (inner). One material per
// combination of brake / reverse / hazard.
const TAIL_DIM_DAY = 0x3a0405, TAIL_DIM_NIGHT = 0x8a0c0e, TAIL_BRAKE = 0xff2a22;
const REV_OFF = 0x000000, REV_ON = 0xffffff, IND_OFF = 0x000000, IND_ON = 0xffa424;
for (let s = 0; s < 8; s++) {
  const brake = s & 1, rev = s & 2, haz = s & 4;
  lampMat('tail' + s, [brake ? TAIL_BRAKE : TAIL_DIM_DAY, rev ? REV_ON : REV_OFF, haz ? IND_ON : IND_OFF, brake ? TAIL_BRAKE : TAIL_DIM_DAY], 'tail');
}
lampMat('tailOff', [0x000000, 0x000000, 0x000000, 0x000000], 'tail');
// Light bar: cells red, blue, white, base.
lampMat('bar0', [0x120203, 0x020412, 0x000000, 0x000000], 'bar');
lampMat('bar1', [0xff2a20, 0x020412, 0xffffff, 0x000000], 'bar');
lampMat('bar2', [0x120203, 0x2a5cff, 0xffffff, 0x000000], 'bar');

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
  setStrip(LAMP.head.emissiveMap, h);
  setStrip(LAMP.headFlickL.emissiveMap, [0x101214, h[1], h[2], h[3]]);
  const dim = on ? TAIL_DIM_NIGHT : TAIL_DIM_DAY;
  for (let s = 0; s < 8; s++) {
    const brake = s & 1, rev = s & 2, haz = s & 4;
    setStrip(LAMP['tail' + s].emissiveMap, [brake ? TAIL_BRAKE : dim, rev ? REV_ON : REV_OFF, haz ? IND_ON : IND_OFF, brake ? TAIL_BRAKE : dim]);
  }
}
export function isLampNight() {
  return lampNight > 0.35;
}

export { LAMP };

// Give a merged vertex-coloured geometry an `aCls` attribute by matching
// each vertex colour against a table of { hex: class } (boats, aircraft).
// Unmatched colours stay paint-like gloss (class 1: own colour, clearcoat).
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
