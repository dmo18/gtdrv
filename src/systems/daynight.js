// Time of day and weather. `skyAt(hour)` is a pure lookup into a small
// keyframe table (plain numbers, no three.js) so it runs in node tests.
// `createDayNight(game)` advances the clock, picks the weather with a
// slow seeded random walk and drives the sky dome, clouds, stars, rain,
// glowing windows, street lamps and headlight pools. All drawing pieces
// are built once; nothing is allocated per frame.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { createRng, clamp, TAU } from '../core/rng.js';

// ---- keyframes --------------------------------------------------------------
// sky = zenith, horizon = sky just above the horizon, fog = fog colour
// (close to horizon so far terrain melts into the sky). sunColor and
// sunIntensity describe the directional light (the moon at night).
const KEYS = [
  { h: 0, sky: 0x050c24, horizon: 0x1a2a50, fog: 0x15213e, sunColor: 0x9cb2ea, sunIntensity: 0.6, hemiSky: 0x5a74b8, hemiGround: 0x22222c, hemiIntensity: 1.1, night: 1, windowGlow: 1 },
  { h: 4.6, sky: 0x061028, horizon: 0x1c2e54, fog: 0x172442, sunColor: 0x9cb2ea, sunIntensity: 0.6, hemiSky: 0x5a74b8, hemiGround: 0x22222c, hemiIntensity: 1.1, night: 1, windowGlow: 0.85 },
  { h: 5.8, sky: 0x2a3e72, horizon: 0xb48a8a, fog: 0x76708a, sunColor: 0xffb48a, sunIntensity: 0.45, hemiSky: 0x8896c4, hemiGround: 0x4a4246, hemiIntensity: 1.3, night: 0.65, windowGlow: 0.75 },
  { h: 6.8, sky: 0x6a96c8, horizon: 0xf0b88e, fog: 0xc4b8b6, sunColor: 0xffc694, sunIntensity: 1.05, hemiSky: 0xc4d2ee, hemiGround: 0x7a6c5e, hemiIntensity: 1.55, night: 0.12, windowGlow: 0.25 },
  { h: 8.5, sky: 0x4f92dc, horizon: 0xe4e2da, fog: 0xc9d4dc, sunColor: 0xfff0d8, sunIntensity: 1.5, hemiSky: 0xe0eeff, hemiGround: 0x8a8272, hemiIntensity: 1.8, night: 0, windowGlow: 0 },
  { h: 12.5, sky: 0x3a86d8, horizon: 0xdfe3e2, fog: 0xc4d3de, sunColor: 0xfff4e2, sunIntensity: 1.75, hemiSky: 0xe4f1ff, hemiGround: 0x8a8272, hemiIntensity: 1.9, night: 0, windowGlow: 0 },
  { h: 16.5, sky: 0x4a8ed8, horizon: 0xe8e0d2, fog: 0xccd2d6, sunColor: 0xffecd0, sunIntensity: 1.65, hemiSky: 0xe4eefc, hemiGround: 0x8a8070, hemiIntensity: 1.8, night: 0, windowGlow: 0 },
  { h: 18.5, sky: 0x5c88c8, horizon: 0xf8b070, fog: 0xc8b2aa, sunColor: 0xffb466, sunIntensity: 1.6, hemiSky: 0xeed4b8, hemiGround: 0x7a6450, hemiIntensity: 1.55, night: 0, windowGlow: 0.3 },
  { h: 19.6, sky: 0x323e7c, horizon: 0xe0806c, fog: 0x7c6a84, sunColor: 0xff8a5a, sunIntensity: 0.55, hemiSky: 0x9490c0, hemiGround: 0x4c4044, hemiIntensity: 1.3, night: 0.5, windowGlow: 0.85 },
  { h: 20.8, sky: 0x08122e, horizon: 0x1e3058, fog: 0x182644, sunColor: 0x9cb2ea, sunIntensity: 0.6, hemiSky: 0x5a74b8, hemiGround: 0x22222c, hemiIntensity: 1.1, night: 1, windowGlow: 1 },
];
KEYS.push({ ...KEYS[0], h: 24 });
const COLOR_KEYS = ['sky', 'horizon', 'fog', 'sunColor', 'hemiSky', 'hemiGround'];
const NUM_KEYS = ['sunIntensity', 'hemiIntensity', 'night', 'windowGlow'];

const smooth = (t) => t * t * (3 - 2 * t);
const smoothstep = (a, b, x) => smooth(clamp((x - a) / (b - a), 0, 1));

function lerpHex(a, b, t) {
  const r = ((a >> 16) & 255) + (((b >> 16) & 255) - ((a >> 16) & 255)) * t;
  const g = ((a >> 8) & 255) + (((b >> 8) & 255) - ((a >> 8) & 255)) * t;
  const bl = (a & 255) + ((b & 255) - (a & 255)) * t;
  return (Math.round(r) << 16) | (Math.round(g) << 8) | Math.round(bl);
}

function wrapHour(hour) {
  const h = +hour;
  if (!Number.isFinite(h)) return 0;
  return ((h % 24) + 24) % 24;
}

// Segment index and eased blend factor for an hour.
let segK = 0, segT = 0;
function segment(h) {
  let k = 0;
  while (k < KEYS.length - 2 && h >= KEYS[k + 1].h) k++;
  segK = k;
  segT = smooth(clamp((h - KEYS[k].h) / (KEYS[k + 1].h - KEYS[k].h), 0, 1));
}

// How dark it is (0 day .. 1 night), without building a whole sky.
export function nightAt(hour) {
  segment(wrapHour(hour));
  const a = KEYS[segK], b = KEYS[segK + 1];
  return a.night + (b.night - a.night) * segT;
}

// Sky, fog and light settings for an hour (0..24). Pass `out` to reuse
// an object. sunDir* is the direction TOWARD the light (sun by day, moon
// by night, never from below); sunX/Y/Z and moonX/Y/Z are the true disc
// directions for drawing.
export function skyAt(hour, out = {}) {
  const h = wrapHour(hour);
  segment(h);
  const a = KEYS[segK], b = KEYS[segK + 1], t = segT;
  for (let i = 0; i < COLOR_KEYS.length; i++) {
    const k = COLOR_KEYS[i];
    out[k] = lerpHex(a[k], b[k], t);
  }
  for (let i = 0; i < NUM_KEYS.length; i++) {
    const k = NUM_KEYS[i];
    out[k] = a[k] + (b[k] - a[k]) * t;
  }
  // Sun on a tilted daily circle: rises about 6:25, sets about 19:25,
  // east (+x) in the morning, a little to the south (+z).
  const ang = ((h - 12.9) / 24) * TAU;
  let sx = -Math.sin(ang) * 0.9, sy = 0.95 * Math.cos(ang) + 0.12, sz = 0.3;
  let n = Math.hypot(sx, sy, sz);
  sx /= n; sy /= n; sz /= n;
  const mAng = ang + Math.PI + 0.35;
  let mx = -Math.sin(mAng) * 0.9, my = 0.85 * Math.cos(mAng) + 0.1, mz = -0.25;
  n = Math.hypot(mx, my, mz);
  mx /= n; my /= n; mz /= n;
  out.sunX = sx; out.sunY = sy; out.sunZ = sz;
  out.moonX = mx; out.moonY = my; out.moonZ = mz;
  // Light direction: sun by day, moon by night, blended (with a lift so
  // the blend never collapses) around sunrise and sunset.
  const w = smoothstep(-0.08, 0.14, sy);
  const lift = 0.35 * (1 - Math.abs(2 * w - 1));
  const my2 = Math.max(my, 0.25);
  let lx = sx * w + mx * (1 - w), ly = sy * w + my2 * (1 - w) + lift, lz = sz * w + mz * (1 - w);
  if (ly < 0.2) ly = 0.2;
  n = Math.hypot(lx, ly, lz);
  out.sunDirX = lx / n; out.sunDirY = ly / n; out.sunDirZ = lz / n;
  return out;
}

// ---- weather ----------------------------------------------------------------
export const WEATHERS = ['clear', 'overcast', 'rain', 'fog'];
// [overcast, rain, fog, wind m/s] per weather.
const W_TARGET = {
  clear: [0, 0, 0, 3],
  overcast: [1, 0, 0.08, 5],
  rain: [1, 1, 0.3, 8],
  fog: [0.45, 0, 1, 1.2],
};
// Next weather after a spell: rows sum to 1. Mostly clear overall.
const W_NEXT = {
  clear: [['clear', 0.55], ['overcast', 0.3], ['fog', 0.08], ['rain', 0.07]],
  overcast: [['clear', 0.45], ['overcast', 0.2], ['rain', 0.25], ['fog', 0.1]],
  rain: [['overcast', 0.5], ['clear', 0.3], ['rain', 0.2]],
  fog: [['clear', 0.65], ['overcast', 0.3], ['fog', 0.05]],
};
const TRANSITION_S = 20;

// ---- shaders ----------------------------------------------------------------
const DOME_VS = `
varying vec3 vDir;
void main() {
  vDir = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;
const DOME_FS = `
uniform vec3 uZenith;
uniform vec3 uHorizon;
uniform vec3 uFog;
uniform vec3 uSunDir;
uniform vec3 uSunCol;
uniform vec3 uMoonDir;
uniform float uSun;
uniform float uMoon;
uniform float uGlow;
uniform float uAway;
uniform vec3 uCity;
varying vec3 vDir;
void main() {
  vec3 d = normalize(vDir);
  float y = d.y;
  float up = clamp(y, 0.0, 1.0);
  float s = max(dot(d, uSunDir), 0.0);
  // Low sun: the warm horizon only on the sun's side, cooler opposite.
  float face = dot(normalize(d.xz + vec2(1e-4)), normalize(uSunDir.xz + vec2(1e-4))) * 0.5 + 0.5;
  vec3 hor = mix(mix(uHorizon, uZenith * 1.3 + uFog * 0.25, uAway), uHorizon, face * face);
  vec3 col = mix(hor, uZenith, pow(up, 0.55));
  col = mix(mix(uFog, hor, 0.35), col, smoothstep(-0.02, 0.1, y));
  // Warm glow around the sun, wider near the horizon.
  col += uSunCol * uGlow * (pow(s, 8.0) * 0.35 + pow(s, 64.0) * 0.5) * smoothstep(-0.1, 0.05, y);
  // A low sun also lights a band along the whole horizon on its side.
  col += uSunCol * uGlow * uAway * pow(face, 3.0) * exp(-max(y, 0.0) * 9.0) * 0.3 * smoothstep(-0.05, 0.02, y);
  col = mix(col, vec3(1.0, 0.98, 0.9) * 1.4, uSun * smoothstep(0.99955, 0.9997, s));
  // The city's own light scattered low in the night haze.
  col += uCity * (exp(-max(y, 0.0) * 9.0) + 0.25 * exp(-max(y, 0.0) * 2.5)) * smoothstep(-0.06, 0.01, y);
  float m = dot(d, uMoonDir);
  col += vec3(0.75, 0.8, 0.9) * uMoon * (smoothstep(0.99965, 0.9998, m) + pow(max(m, 0.0), 300.0) * 0.12);
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  // Tiny dither so the gradient does not band.
  float n = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);
  gl_FragColor.rgb += (n - 0.5) / 255.0;
}`;

const GLOW_POINTS_VS = `
attribute float size;
uniform float uScale;
uniform float uFadeNear;
uniform float uFadeFar;
varying float vA;
varying vec3 vC;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  float d = max(-mv.z, 0.1);
  float ps = size * uScale / d;
  vA = (1.0 - smoothstep(uFadeNear, uFadeFar, d)) * clamp(ps / 3.0, 0.0, 1.0);
  vC = color;
  gl_PointSize = clamp(ps, 3.0, 220.0);
  gl_Position = projectionMatrix * mv;
}`;
const GLOW_POINTS_FS = `
uniform float uIntensity;
varying float vA;
varying vec3 vC;
void main() {
  vec2 c = gl_PointCoord * 2.0 - 1.0;
  float r = dot(c, c);
  if (r > 1.0) discard;
  float a = exp(-r * 18.0) + exp(-r * 4.0) * 0.3;
  a *= (1.0 - r);
  gl_FragColor = vec4(vC * a * vA * uIntensity, 1.0);
  #include <colorspace_fragment>
}`;

// Soft additive pool on the ground: uv in -1..1, brightest in the middle.
const POOL_VS = `
varying vec3 vC;
varying vec2 vUv;
varying float vD;
void main() {
  vec4 p = vec4(position, 1.0);
  #ifdef USE_INSTANCING
    p = instanceMatrix * p;
  #endif
  vec4 mv = viewMatrix * modelMatrix * p;
  vC = color;
  #ifdef USE_INSTANCING_COLOR
    vC *= instanceColor;
  #endif
  vUv = uv;
  vD = -mv.z;
  gl_Position = projectionMatrix * mv;
}`;
const POOL_FS = `
uniform vec3 uColor;
uniform float uIntensity;
uniform float uFadeNear;
uniform float uFadeFar;
varying vec3 vC;
varying vec2 vUv;
varying float vD;
void main() {
  float d2 = dot(vUv, vUv);
  float r = clamp(1.0 - d2, 0.0, 1.0);
  // Broad soft pool with a brighter core right under the lamp.
  float a = (r * r + 1.6 * exp(-d2 * 9.0) * r) * uIntensity * (1.0 - smoothstep(uFadeNear, uFadeFar, vD));
  gl_FragColor = vec4(uColor * vC * a, 1.0);
}`;
// Headlight throw on the road: a cone that widens away from the car
// (quad local -x end), brightest just ahead of the lamps, two soft lobes.
const HEAD_FS = `
uniform vec3 uColor;
uniform float uIntensity;
uniform float uFadeNear;
uniform float uFadeFar;
varying vec3 vC;
varying vec2 vUv;
varying float vD;
void main() {
  float t = vUv.x * 0.5 + 0.5;
  float w = 0.2 + 0.8 * t;
  float q = abs(vUv.y) / w;
  float across = 1.0 - smoothstep(0.55, 1.0, q);
  float lobes = 0.75 + 0.25 * cos(clamp(q, 0.0, 1.0) * 6.2832);
  float along = smoothstep(0.0, 0.1, t) * pow(1.0 - t, 1.35);
  float a = across * along * mix(1.0, lobes, 1.0 - t) * uIntensity * (1.0 - smoothstep(uFadeNear, uFadeFar, vD));
  gl_FragColor = vec4(uColor * vC * a, 1.0);
}`;

// Wet-street reflections of the lamps: one long soft streak per lamp on
// the ground, running from below the lamp toward the camera (where a
// mirror image would be smeared by a damp, rough road). Turned to face
// the camera in the vertex shader, so the geometry never changes.
const STREAK_VS = `
attribute vec4 aLamp;
varying vec2 vUv;
varying float vD;
void main() {
  vec2 c = aLamp.xz;
  vec2 to = cameraPosition.xz - c;
  float dist = max(length(to), 0.001);
  vec2 f = to / dist;
  vec2 s = vec2(-f.y, f.x);
  float len = min(aLamp.w * 2.4, dist * 0.7);
  vec2 p = c + s * position.x * 0.9 + f * (position.z * len + aLamp.w * 0.15);
  vec4 mv = viewMatrix * vec4(p.x, 0.2, p.y, 1.0);
  vUv = vec2(position.x, position.z);
  vD = -mv.z;
  gl_Position = projectionMatrix * mv;
}`;
const STREAK_FS = `
uniform vec3 uColor;
uniform float uIntensity;
uniform float uFadeNear;
uniform float uFadeFar;
varying vec2 vUv;
varying float vD;
void main() {
  float across = exp(-vUv.x * vUv.x * 5.0);
  float along = smoothstep(0.0, 0.18, vUv.y) * (1.0 - smoothstep(0.35, 1.0, vUv.y));
  float a = across * along * uIntensity * (1.0 - smoothstep(uFadeNear, uFadeFar, vD));
  gl_FragColor = vec4(uColor * a, 1.0);
  #include <colorspace_fragment>
}`;

const RAIN_VS = `
attribute float aEnd;
uniform float uTime;
uniform vec3 uBox;
uniform vec3 uVel;
uniform float uLen;
varying float vA;
void main() {
  vec3 p = position * uBox + uVel * uTime;
  vec3 rel = mod(p - cameraPosition + uBox * 0.5, uBox) - uBox * 0.5;
  vec3 w = cameraPosition + rel - normalize(uVel) * uLen * aEnd;
  float r = length(rel.xz) / (uBox.x * 0.5);
  vA = (1.0 - aEnd * 0.8) * (1.0 - smoothstep(0.55, 1.0, r)) * (1.0 - smoothstep(0.3, 0.5, abs(rel.y) / uBox.y));
  gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.0);
}`;
const RAIN_FS = `
uniform vec3 uColor;
uniform float uOpacity;
varying float vA;
void main() {
  gl_FragColor = vec4(uColor, uOpacity * vA);
  #include <colorspace_fragment>
}`;

// ---- builders ---------------------------------------------------------------
function makeCloudGeometry(rng) {
  const parts = [];
  const n = 6;
  for (let i = 0; i < n; i++) {
    const g = new THREE.IcosahedronGeometry(1, 1);
    const s = i === 0 ? 1 : rng.range(0.5, 0.85);
    const ox = i === 0 ? 0 : rng.range(-1.1, 1.1), oz = i === 0 ? 0 : rng.range(-0.7, 0.7);
    g.scale(s * rng.range(1, 1.3), s * 0.5, s);
    g.translate(ox, s * 0.12, oz);
    parts.push(g);
  }
  const geo = mergeGeometries(parts);
  for (const p of parts) p.dispose();
  geo.computeVertexNormals();
  // Lighter tops, greyer bellies.
  const pos = geo.attributes.position;
  const col = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    const v = 0.72 + 0.28 * clamp((y + 0.3) / 0.8, 0, 1);
    col[i * 3] = v; col[i * 3 + 1] = v; col[i * 3 + 2] = v * 1.02;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return geo;
}

// Axis-aligned unit quad on the ground (y = 0), uv -1..1.
function quadGeometry() {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([-0.5, 0, -0.5, 0.5, 0, -0.5, 0.5, 0, 0.5, -0.5, 0, 0.5], 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute([-1, -1, 1, -1, 1, 1, -1, 1], 2));
  g.setIndex([0, 2, 1, 0, 3, 2]);
  return g;
}

// Lights the ground under it: the picture below times (1 + light), so a
// warm pool takes the colour of the asphalt or paving it falls on, and
// dark ground stays dark instead of turning a flat milky grey.
function poolMaterial(color, fs = POOL_FS) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Color().setHex(color, THREE.SRGBColorSpace) },
      uIntensity: { value: 0 },
      uFadeNear: { value: 160 },
      uFadeFar: { value: 420 },
    },
    vertexShader: POOL_VS,
    fragmentShader: fs,
    vertexColors: true,
    transparent: true,
    depthWrite: false,
    blending: THREE.CustomBlending,
    blendSrc: THREE.DstColorFactor,
    blendDst: THREE.OneFactor,
    polygonOffset: true,
    polygonOffsetFactor: -4,
    polygonOffsetUnits: -4,
  });
}

const MAX_CARS = 10;

export function createDayNight(game, { dayMinutes = 14, seed = 90731 } = {}) {
  const rng = createRng(seed);
  if (!Number.isFinite(game.clock)) game.clock = 9;
  // A time the player chose in Settings survives a restart.
  const savedTime = game.progress && game.progress.settings;
  if (savedTime && savedTime.liveTime === false && Number.isFinite(savedTime.timeOfDay)) {
    game.clock = savedTime.timeOfDay;
    game.timeLocked = true;
  }

  // Day speed: nights pass about twice as fast (rate = base * (1 + night)),
  // and a whole day takes `dayMinutes` real minutes.
  let slow = 0;
  for (let h = 0; h < 24; h += 0.05) slow += 0.05 / (1 + nightAt(h + 0.025));
  const baseRate = slow / (Math.max(0.1, dayMinutes) * 60); // hours per second at full day

  // ---- weather state ----
  const W = (game.weather = { name: 'clear', rain: 0, fog: 0, wind: 3, windDir: 0.6, overcast: 0 });
  const wFrom = [0, 0, 0, 3], wTo = [0, 0, 0, 3];
  let wT = 1; // transition progress 0..1
  let spellLeft = rng.range(3, 6); // game hours until the next change
  let windDirTarget = W.windDir;

  function startWeather(name, instant) {
    if (!W_TARGET[name]) return;
    wFrom[0] = W.overcast; wFrom[1] = W.rain; wFrom[2] = W.fog; wFrom[3] = W.wind;
    const t = W_TARGET[name];
    for (let i = 0; i < 4; i++) wTo[i] = t[i];
    wT = instant ? 1 : 0;
    if (instant) applyWeatherBlend(1);
    windDirTarget = rng.range(0, TAU);
    if (name !== W.name) {
      W.name = name;
      if (game.events && game.events.emit) game.events.emit('weather', name);
    }
  }
  function applyWeatherBlend(e) {
    W.overcast = wFrom[0] + (wTo[0] - wFrom[0]) * e;
    W.rain = wFrom[1] + (wTo[1] - wFrom[1]) * e;
    W.fog = wFrom[2] + (wTo[2] - wFrom[2]) * e;
    W.wind = wFrom[3] + (wTo[3] - wFrom[3]) * e;
  }
  function pickNext() {
    const row = W_NEXT[W.name] || W_NEXT.clear;
    let r = rng.next();
    for (let i = 0; i < row.length; i++) {
      r -= row[i][1];
      if (r <= 0) return row[i][0];
    }
    return row[row.length - 1][0];
  }

  // ---- drawing (only with a scene) ----
  const scene = game.scene || null;
  const V = scene ? buildVisuals() : null;
  const S = {}; // reused skyAt output
  let lastKey = -1;
  let rainTime = 0;
  let cloudDrift = 0;
  let forceApply = true;

  function buildVisuals() {
    const vis = {};
    // Sky dome: inverted sphere following the camera, drawn first.
    const domeMat = new THREE.ShaderMaterial({
      uniforms: {
        uZenith: { value: new THREE.Color() },
        uHorizon: { value: new THREE.Color() },
        uFog: { value: new THREE.Color() },
        uSunDir: { value: new THREE.Vector3(0, 1, 0) },
        uSunCol: { value: new THREE.Color() },
        uMoonDir: { value: new THREE.Vector3(0, 1, 0) },
        uSun: { value: 1 },
        uMoon: { value: 0 },
        uGlow: { value: 1 },
        uAway: { value: 0 },
        uCity: { value: new THREE.Color(0, 0, 0) },
      },
      vertexShader: DOME_VS,
      fragmentShader: DOME_FS,
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
    });
    const dome = new THREE.Mesh(new THREE.SphereGeometry(1400, 32, 16), domeMat);
    dome.name = 'sky-dome';
    dome.renderOrder = -10;
    dome.frustumCulled = false;
    scene.add(dome);
    vis.dome = dome;
    vis.domeU = domeMat.uniforms;

    // Stars: a few hundred points on the upper sky.
    const NS = 420;
    const sp = new Float32Array(NS * 3), sc = new Float32Array(NS * 3);
    for (let i = 0; i < NS; i++) {
      const th = rng.range(0, TAU), y = Math.pow(rng.next(), 0.7) * 0.95 + 0.04;
      const r = Math.sqrt(1 - y * y) * 1300;
      sp[i * 3] = Math.cos(th) * r; sp[i * 3 + 1] = y * 1300; sp[i * 3 + 2] = Math.sin(th) * r;
      const b = rng.range(0.35, 1);
      sc[i * 3] = b * 0.9; sc[i * 3 + 1] = b * 0.93; sc[i * 3 + 2] = b;
    }
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.BufferAttribute(sp, 3));
    sg.setAttribute('color', new THREE.BufferAttribute(sc, 3));
    const starMat = new THREE.PointsMaterial({ size: 2, sizeAttenuation: false, vertexColors: true, transparent: true, opacity: 0, depthWrite: false, fog: false });
    const stars = new THREE.Points(sg, starMat);
    stars.name = 'stars';
    stars.renderOrder = -9;
    stars.frustumCulled = false;
    stars.visible = false;
    scene.add(stars);
    vis.stars = stars;

    // Clouds: one instanced mesh of merged puffs, drifting.
    const NC = 26;
    const cloudMat = new THREE.MeshLambertMaterial({ vertexColors: true, transparent: true, opacity: 0.85, depthWrite: false, fog: false, emissive: new THREE.Color(0x000000) });
    const clouds = new THREE.InstancedMesh(makeCloudGeometry(rng), cloudMat, NC);
    clouds.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    clouds.frustumCulled = false;
    clouds.name = 'clouds';
    clouds.renderOrder = 2;
    scene.add(clouds);
    vis.clouds = clouds;
    vis.cloudX = new Float32Array(NC); vis.cloudY = new Float32Array(NC); vis.cloudZ = new Float32Array(NC);
    vis.cloudS = new Float32Array(NC); vis.cloudR = new Float32Array(NC);
    for (let i = 0; i < NC; i++) {
      vis.cloudX[i] = rng.range(-1150, 1150);
      vis.cloudZ[i] = rng.range(-1150, 1150);
      vis.cloudY[i] = rng.range(250, 400);
      vis.cloudS[i] = rng.range(45, 95);
      vis.cloudR[i] = rng.range(0, TAU);
    }

    // Windows and signs: the city mesh brings its own lit-window maps
    // (one per facade style); we only turn them up at dusk.
    const ud = (game.cityMesh && game.cityMesh.userData) || {};
    const mats = ud.materials || {};
    vis.ud = ud;
    vis.glowMats = ud.glowMats || [];
    vis.wet = ud.wet || null;
    vis.mats = mats;
    vis.dimMats = [mats.plainMat, mats.pavementMat, mats.grassMat, mats.landMat].filter(Boolean);
    vis.dimBase = vis.dimMats.map((m) => m.color.clone());

    // Street lamps, other fixed lights (beacons, runway edge lights) and
    // car headlamp bulbs: one additive points cloud.
    const lamps = ud.lamps || [];
    const extra = ud.glows || [];
    const NL = lamps.length + extra.length, NB = (MAX_CARS + 1) * 4;
    const lp = new Float32Array((NL + NB) * 3), lc = new Float32Array((NL + NB) * 3), ls = new Float32Array(NL + NB);
    const pool = [], poolCol = [], poolUv = [], poolIdx = [];
    for (let i = 0; i < extra.length; i++) {
      const e = extra[i], k = lamps.length + i;
      lp[k * 3] = e.x; lp[k * 3 + 1] = e.y; lp[k * 3 + 2] = e.z;
      lc[k * 3] = e.r; lc[k * 3 + 1] = e.g; lc[k * 3 + 2] = e.b;
      ls[k] = e.size;
    }
    for (let i = 0; i < lamps.length; i++) {
      const l = lamps[i];
      const rot = l.rot || 0, h = l.h || 7;
      const x = l.x + Math.cos(rot) * 1.75, z = l.z + Math.sin(rot) * 1.75;
      lp[i * 3] = x; lp[i * 3 + 1] = h * 0.975 - 0.12; lp[i * 3 + 2] = z;
      lc[i * 3] = 1; lc[i * 3 + 1] = 0.8; lc[i * 3 + 2] = 0.52;
      ls[i] = 2.2;
      // Light pool on the ground below the head.
      const R = 7.5, y = 0.19, n = i * 4;
      pool.push(x - R, y, z - R, x + R, y, z - R, x + R, y, z + R, x - R, y, z + R);
      poolUv.push(-1, -1, 1, -1, 1, 1, -1, 1);
      poolCol.push(1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1);
      poolIdx.push(n, n + 2, n + 1, n, n + 3, n + 2);
    }
    // Car lamps in fours: two headlamps, then two red tail lamps.
    for (let i = NL; i < NL + NB; i++) {
      const tail = (i - NL) % 4 > 1;
      lc[i * 3] = 1; lc[i * 3 + 1] = tail ? 0.08 : 0.96; lc[i * 3 + 2] = tail ? 0.04 : 0.88;
      ls[i] = 0;
    }
    const lg = new THREE.BufferGeometry();
    lg.setAttribute('position', new THREE.BufferAttribute(lp, 3).setUsage(THREE.DynamicDrawUsage));
    lg.setAttribute('color', new THREE.BufferAttribute(lc, 3));
    lg.setAttribute('size', new THREE.BufferAttribute(ls, 1).setUsage(THREE.DynamicDrawUsage));
    const lampMat = new THREE.ShaderMaterial({
      uniforms: { uScale: { value: 600 }, uFadeNear: { value: 300 }, uFadeFar: { value: 900 }, uIntensity: { value: 0 } },
      vertexShader: GLOW_POINTS_VS,
      fragmentShader: GLOW_POINTS_FS,
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const lampPts = new THREE.Points(lg, lampMat);
    lampPts.name = 'lamp-glow';
    lampPts.frustumCulled = false;
    lampPts.visible = false;
    lampPts.renderOrder = 3;
    scene.add(lampPts);
    vis.lampPts = lampPts;
    vis.lampU = lampMat.uniforms;
    vis.NL = NL;
    vis.NB = NB;
    vis.bulbPos = lg.attributes.position;
    vis.bulbSize = lg.attributes.size;

    if (lamps.length) {
      const pg = new THREE.BufferGeometry();
      pg.setAttribute('position', new THREE.Float32BufferAttribute(pool, 3));
      pg.setAttribute('uv', new THREE.Float32BufferAttribute(poolUv, 2));
      pg.setAttribute('color', new THREE.Float32BufferAttribute(poolCol, 3));
      pg.setIndex(poolIdx);
      pg.computeBoundingSphere();
      const poolMat = poolMaterial(0xffc98a);
      const pools = new THREE.Mesh(pg, poolMat);
      pools.name = 'lamp-pools';
      pools.visible = false;
      pools.renderOrder = 1;
      scene.add(pools);
      vis.pools = pools;
      vis.poolU = poolMat.uniforms;

      // Reflection streaks (see STREAK_VS): x across -1..1, z along 0..1.
      const NLm = lamps.length;
      const sp = new Float32Array(NLm * 12), sl = new Float32Array(NLm * 16), si = [];
      for (let i = 0; i < NLm; i++) {
        const x = pool[i * 12], z = pool[i * 12 + 2];
        const cx = x + 7.5, cz = z + 7.5, h = lamps[i].h || 7;
        sp.set([-1, 0, 0, 1, 0, 0, 1, 0, 1, -1, 0, 1], i * 12);
        for (let k = 0; k < 4; k++) sl.set([cx, 0, cz, h], i * 16 + k * 4);
        const n = i * 4;
        si.push(n, n + 2, n + 1, n, n + 3, n + 2);
      }
      const sg = new THREE.BufferGeometry();
      sg.setAttribute('position', new THREE.BufferAttribute(sp, 3));
      sg.setAttribute('aLamp', new THREE.BufferAttribute(sl, 4));
      sg.setIndex(si);
      const streakMat = new THREE.ShaderMaterial({
        uniforms: {
          uColor: { value: new THREE.Color().setHex(0xffc27a, THREE.SRGBColorSpace) },
          uIntensity: { value: 0 }, uFadeNear: { value: 60 }, uFadeFar: { value: 220 },
        },
        vertexShader: STREAK_VS,
        fragmentShader: STREAK_FS,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
      });
      const streaks = new THREE.Mesh(sg, streakMat);
      streaks.name = 'lamp-reflections';
      streaks.frustumCulled = false;
      streaks.visible = false;
      streaks.renderOrder = 2;
      scene.add(streaks);
      vis.streaks = streaks;
      vis.streakU = streakMat.uniforms;
    }

    // Headlight pools: instanced quads in front of lit vehicles.
    const hq = quadGeometry();
    hq.setAttribute('color', new THREE.Float32BufferAttribute([1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1], 3));
    const headMat = poolMaterial(0xfff0d8, HEAD_FS);
    headMat.uniforms.uFadeNear.value = 80;
    headMat.uniforms.uFadeFar.value = 200;
    const NH = MAX_CARS + 1;
    const heads = new THREE.InstancedMesh(hq, headMat, NH);
    heads.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    heads.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(NH * 3), 3);
    heads.instanceColor.setUsage(THREE.DynamicDrawUsage);
    heads.frustumCulled = false;
    heads.visible = false;
    heads.count = 0;
    heads.renderOrder = 1;
    heads.name = 'headlight-pools';
    scene.add(heads);
    vis.heads = heads;
    vis.headU = headMat.uniforms;
    // Red glow on the road behind the same cars (brighter when braking).
    const tailMat = poolMaterial(0xff2a14);
    tailMat.uniforms.uFadeNear.value = 50;
    tailMat.uniforms.uFadeFar.value = 140;
    const tails = new THREE.InstancedMesh(hq, tailMat, NH);
    tails.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    tails.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(NH * 3), 3);
    tails.instanceColor.setUsage(THREE.DynamicDrawUsage);
    tails.frustumCulled = false;
    tails.visible = false;
    tails.count = 0;
    tails.renderOrder = 1;
    tails.name = 'tail-pools';
    scene.add(tails);
    vis.tails = tails;
    vis.tailU = tailMat.uniforms;

    // Rain: pooled streaks wrapped in a box around the camera on the GPU.
    const NR = 1200;
    const rp = new Float32Array(NR * 6), re = new Float32Array(NR * 2);
    for (let i = 0; i < NR; i++) {
      const x = rng.next(), y = rng.next(), z = rng.next();
      rp[i * 6] = rp[i * 6 + 3] = x;
      rp[i * 6 + 1] = rp[i * 6 + 4] = y;
      rp[i * 6 + 2] = rp[i * 6 + 5] = z;
      re[i * 2] = 0; re[i * 2 + 1] = 1;
    }
    const rg = new THREE.BufferGeometry();
    rg.setAttribute('position', new THREE.BufferAttribute(rp, 3));
    rg.setAttribute('aEnd', new THREE.BufferAttribute(re, 1));
    const rainMat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uBox: { value: new THREE.Vector3(70, 40, 70) },
        uVel: { value: new THREE.Vector3(2, -24, 1) },
        uLen: { value: 0.9 },
        uColor: { value: new THREE.Color(0xc8d4e4) },
        uOpacity: { value: 0 },
      },
      vertexShader: RAIN_VS,
      fragmentShader: RAIN_FS,
      transparent: true,
      depthWrite: false,
    });
    const rain = new THREE.LineSegments(rg, rainMat);
    rain.frustumCulled = false;
    rain.visible = false;
    rain.renderOrder = 4;
    rain.name = 'rain';
    scene.add(rain);
    vis.rain = rain;
    vis.rainU = rainMat.uniforms;
    vis.NR = NR;

    vis.c1 = new THREE.Color();
    vis.c2 = new THREE.Color();
    vis.m4 = new THREE.Matrix4();
    vis.q = new THREE.Quaternion();
    vis.p = new THREE.Vector3();
    vis.s = new THREE.Vector3();
    vis.up = new THREE.Vector3(0, 1, 0);
    vis.bg = new THREE.Color();
    vis.near = new Int32Array(MAX_CARS);
    vis.nearD = new Float32Array(MAX_CARS);
    vis.lit = 0;
    vis.night = 0;
    return vis;
  }

  // Desaturate and darken a colour toward grey by k.
  function greyed(c, k, dark) {
    const l = (0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b) * dark;
    c.r += (l - c.r) * k;
    c.g += (l - c.g) * k;
    c.b += (l - c.b) * k;
    return c;
  }
  function setLin(c, hex) {
    return c.setHex(hex, THREE.SRGBColorSpace);
  }

  // Sky, fog, lights and material tints: only when something moved.
  function applySky() {
    const ov = W.overcast, rn = W.rain, fg = W.fog;
    const key = Math.round(game.clock * 150) * 1e6 + Math.round(ov * 60) * 1e4 + Math.round(rn * 60) * 100 + Math.round(fg * 60);
    if (key === lastKey && !forceApply) return;
    lastKey = key;
    forceApply = false;
    skyAt(game.clock, S);
    const grey = clamp(ov * 0.8 + fg * 0.4, 0, 0.9);
    const dark = 1 - 0.18 * ov - 0.12 * rn;
    const U = V.domeU;
    greyed(setLin(U.uZenith.value, S.sky), grey, 1.05).multiplyScalar(dark);
    greyed(setLin(U.uHorizon.value, S.horizon), grey, 1).multiplyScalar(dark);
    const fogC = greyed(setLin(U.uFog.value, S.fog), grey * 0.9, 1).multiplyScalar(dark);
    // Thick fog: the whole sky turns to fog colour.
    const haze = fg * 0.85;
    U.uZenith.value.lerp(fogC, haze);
    U.uHorizon.value.lerp(fogC, Math.min(1, haze * 1.15));
    U.uSunDir.value.set(S.sunX, S.sunY, S.sunZ);
    U.uMoonDir.value.set(S.moonX, S.moonY, S.moonZ);
    setLin(U.uSunCol.value, S.sunColor);
    const clearSky = 1 - clamp(ov * 0.9 + fg * 0.9, 0, 1);
    U.uSun.value = clearSky * smoothstep(-0.04, 0.02, S.sunY);
    U.uGlow.value = (0.35 + 0.65 * clearSky) * smoothstep(-0.15, 0.05, S.sunY);
    U.uAway.value = 0.75 * (1 - smoothstep(0.08, 0.45, S.sunY)) * (1 - S.night) * (1 - 0.7 * grey);
    U.uMoon.value = clearSky * S.night * smoothstep(-0.02, 0.05, S.moonY);
    // City glow on the night horizon (stronger under cloud, which bounces
    // it back), and the same glow in the haze so the far city sinks into
    // a lit night sky rather than into grey.
    const cityK = smoothstep(0.3, 1, S.night) * (1 + 0.6 * ov - 0.5 * fg) * dark;
    U.uCity.value.setRGB(0.05, 0.03, 0.026).multiplyScalar(cityK);
    fogC.r += U.uCity.value.r * 0.7;
    fogC.g += U.uCity.value.g * 0.7;
    fogC.b += U.uCity.value.b * 0.7;

    if (scene.fog) {
      scene.fog.color.copy(fogC);
      scene.fog.near = Math.max(60, 220 + (60 - 220) * fg - 40 * rn);
      scene.fog.far = Math.max(350, (1050 + (350 - 1050) * fg) * (1 - 0.25 * rn));
    }
    if (scene.background && scene.background.isColor) scene.background.copy(fogC);
    else if (!scene.background) scene.background = V.bg.copy(fogC);

    // The graphics module (tone mapping, shadows, sky reflections) asks
    // for a stronger sun and less flat fill light through game.lightScale,
    // so shadows read; without it the plain look is kept.
    const LS = game.lightScale || null;
    const sunK = LS ? LS.sun * (1 - S.night) + LS.moon * S.night : 1;
    const hemiK = LS ? LS.hemi * (1 - S.night) + LS.hemiNight * S.night : 1;
    const L = game.lights;
    if (L && L.sun) {
      setLin(L.sun.color, S.sunColor);
      if (S.night > 0.5) greyed(L.sun.color, ov * 0.5, 1);
      L.sun.intensity = S.sunIntensity * sunK * (1 - 0.68 * ov - 0.1 * rn - 0.2 * fg);
      L.sun.position.set(S.sunDirX * 100, S.sunDirY * 100, S.sunDirZ * 100);
    }
    if (L && L.hemi) {
      greyed(setLin(L.hemi.color, S.hemiSky), ov * 0.6, 1);
      setLin(L.hemi.groundColor, S.hemiGround);
      L.hemi.intensity = S.hemiIntensity * hemiK * (1 + 0.1 * ov - 0.12 * rn);
    }

    const night = S.night;
    V.night = night;
    V.lit = clamp(Math.max(smoothstep(0.15, 0.6, night), rn * 0.6, fg * 0.5), 0, 1);
    const glow = S.windowGlow * (LS ? LS.glow : 0.95);
    // Signs glow harder than rooms; shop windows a little softer.
    const signK = 1 + 0.9 * night, shopK = 1 - 0.3 * night;
    for (let i = 0; i < V.glowMats.length; i++) {
      const m = V.glowMats[i];
      m.emissiveIntensity = glow * (m === V.mats.detailMat ? signK : m === V.mats.shopfront ? shopK : 1);
    }
    // Rain: everything darkens a little, roads and pavements go glossy.
    for (let i = 0; i < V.dimMats.length; i++) V.dimMats[i].color.copy(V.dimBase[i]).multiplyScalar((1 - 0.16 * rn) * (1 - 0.2 * night));
    // Night dew: streets keep a damp sheen after dark, so lamps and the
    // glowing sky show in them (rain makes them fully wet).
    if (V.wet) V.wet.value = Math.max(rn, 0.5 * smoothstep(0.3, 0.9, night));
    if (V.mats.pavementMat) V.mats.pavementMat.roughness = 0.88 - 0.42 * rn;
    if (V.mats.asphaltMat) V.mats.asphaltMat.roughness = 0.93;

    // Shared sky state for the graphics module (reflections, shadows).
    const K = sys.sky;
    K.zenith.copy(U.uZenith.value);
    K.horizon.copy(U.uHorizon.value);
    K.fog.copy(fogC);
    K.sunColor.copy(U.uSunCol.value);
    K.sunDir.set(S.sunX, S.sunY, S.sunZ);
    K.lightDir.set(S.sunDirX, S.sunDirY, S.sunDirZ);
    K.sunDisc = U.uSun.value;
    K.glow = U.uGlow.value;
    K.night = night;
    K.lit = V.lit;
    K.overcast = ov;
    K.rain = rn;
    K.fogAmount = fg;
    // How crisp cast shadows should be: full in clear daylight, soft by
    // moonlight, gone while the light swings from sun to moon and back.
    const sunUp = smoothstep(-0.08, 0.14, S.sunY);
    K.shadow = Math.abs(2 * sunUp - 1) * (sunUp > 0.5 ? 1 : 0.55) * (1 - 0.8 * ov) * (1 - 0.7 * fg);
    K.version++;

    const starA = night * clearSky;
    V.stars.material.opacity = starA;
    V.stars.visible = starA > 0.02;

    // Clouds: lit by the scene lights; a little self-glow so nights are
    // not black blobs, greyer and denser when overcast.
    const cm = V.clouds.material;
    cm.opacity = (0.82 + 0.14 * ov) * (1 - 0.85 * fg);
    setLin(cm.emissive, S.sky).multiplyScalar(0.2 + 0.25 * night);
    cm.emissive.add(setLin(V.c1, S.horizon).multiplyScalar(0.18 * (1 - night)));
    cm.color.setScalar(1 - 0.35 * ov - 0.15 * rn);
    V.clouds.visible = cm.opacity > 0.02;

    V.lampU.uIntensity.value = V.lit;
    V.lampPts.visible = V.lit > 0.01;
    if (V.pools) {
      V.poolU.uIntensity.value = V.lit * (0.9 + 1.5 * night);
      V.pools.visible = V.poolU.uIntensity.value > 0.01 && !V.ud.lampLightBaked;
    }
    if (V.streaks) {
      const wet = V.wet ? V.wet.value : rn;
      V.streakU.uIntensity.value = V.lit * wet * (0.5 + 0.5 * night) * 0.9;
      V.streaks.visible = V.streakU.uIntensity.value > 0.01;
    }
    V.headU.uIntensity.value = V.lit * (3 + 4 * night);
    V.tailU.uIntensity.value = V.lit * (0.8 + 0.8 * night);
    // Additive glows fade out with the fog instead of shining through it.
    const fn = scene.fog ? scene.fog.near : 220, ff = scene.fog ? scene.fog.far : 1050;
    V.lampU.uFadeNear.value = Math.min(300, fn);
    V.lampU.uFadeFar.value = Math.min(900, ff * 0.85);
    if (V.poolU) {
      V.poolU.uFadeNear.value = Math.min(160, fn);
      V.poolU.uFadeFar.value = Math.min(420, ff * 0.7);
    }
  }

  function updateClouds(cam) {
    const C = V.clouds, n = C.count;
    const cx = cam ? cam.position.x : 0, cz = cam ? cam.position.z : 0;
    const B = 1150, wx = Math.cos(W.windDir), wz = Math.sin(W.windDir);
    for (let i = 0; i < n; i++) {
      let dx = V.cloudX[i] + wx * cloudDrift - cx, dz = V.cloudZ[i] + wz * cloudDrift - cz;
      dx = ((((dx + B) % (2 * B)) + 2 * B) % (2 * B)) - B;
      dz = ((((dz + B) % (2 * B)) + 2 * B) % (2 * B)) - B;
      const fade = 1 - smoothstep(820, 1120, Math.max(Math.abs(dx), Math.abs(dz)));
      const s = V.cloudS[i] * (0.15 + 0.85 * fade);
      V.p.set(cx + dx, V.cloudY[i], cz + dz);
      V.q.setFromAxisAngle(V.up, V.cloudR[i]);
      V.s.set(s, s * 0.9, s * 0.8);
      V.m4.compose(V.p, V.q, V.s);
      C.setMatrixAt(i, V.m4);
    }
    C.instanceMatrix.needsUpdate = true;
  }

  // Up to MAX_CARS nearest moving cars plus the player's craft.
  function updateHeadlights(cam, alpha) {
    const H = V.heads;
    if (!(V.lit > 0.01) || !cam) {
      H.visible = false;
      V.tails.visible = false;
      CL.n = 0;
      if (V.NB && V.bulbSize.array[V.NL] !== 0) clearBulbs();
      return;
    }
    const vs = game.vehicles || [];
    const pv = game.player && game.player.vehicle;
    const near = V.near, nearD = V.nearD;
    let cnt = 0;
    const cx = cam.position.x, cz = cam.position.z;
    for (let i = 0; i < vs.length; i++) {
      const v = vs[i];
      if (v === pv || v.kind !== 'car' || v.asleep || !(Math.abs(v.speed) > 0.5 || v.driver || v.controls)) continue;
      const d = (v.x - cx) * (v.x - cx) + (v.z - cz) * (v.z - cz);
      if (d > 180 * 180) continue;
      let j = cnt < MAX_CARS ? cnt++ : MAX_CARS;
      if (j === MAX_CARS) {
        if (d >= nearD[MAX_CARS - 1]) continue;
        j = MAX_CARS - 1;
      }
      while (j > 0 && nearD[j - 1] > d) {
        near[j] = near[j - 1];
        nearD[j] = nearD[j - 1];
        j--;
      }
      near[j] = i;
      nearD[j] = d;
    }
    let k = 0;
    CL.n = 0;
    const bp = V.bulbPos.array, bs = V.bulbSize.array;
    let b = V.NL;
    if (pv) {
      if (placeHead(pv, k, alpha, 1)) {
        k++;
        b = placeBulbs(pv, b, alpha);
      }
    }
    for (let i = 0; i < cnt; i++) {
      const v = vs[near[i]];
      if (placeHead(v, k, alpha, 0.8)) {
        k++;
        b = placeBulbs(v, b, alpha);
      }
    }
    for (; b < V.NL + V.NB; b++) {
      bs[b] = 0;
      bp[b * 3 + 1] = -100;
    }
    H.count = k;
    H.visible = k > 0;
    H.instanceMatrix.needsUpdate = true;
    H.instanceColor.needsUpdate = true;
    const T = V.tails;
    T.count = k;
    T.visible = k > 0;
    T.instanceMatrix.needsUpdate = true;
    T.instanceColor.needsUpdate = true;
    markBulbs();
  }
  function clearBulbs() {
    const bs = V.bulbSize.array;
    for (let b = V.NL; b < V.NL + V.NB; b++) bs[b] = 0;
    markBulbs();
  }
  function markBulbs() {
    markAttr(V.bulbPos);
    markAttr(V.bulbSize);
  }
  function markAttr(attr) {
    attr.clearUpdateRanges();
    attr.addUpdateRange(V.NL * attr.itemSize, V.NB * attr.itemSize);
    attr.needsUpdate = true;
  }
  function interp(v, alpha) {
    const a = alpha == null ? 1 : alpha;
    const px = Number.isFinite(v.px) ? v.px : v.x, pz = Number.isFinite(v.pz) ? v.pz : v.z;
    V.p.set(px + (v.x - px) * a, 0, pz + (v.z - pz) * a);
  }
  function placeHead(v, k, alpha, strength) {
    if (!Number.isFinite(v.x) || !Number.isFinite(v.heading)) return false;
    const air = v.kind === 'plane' || v.kind === 'heli';
    const y = +v.y || 0;
    let f = strength;
    if (air) f *= 1 - smoothstep(10, 45, y);
    if (!(f > 0.02)) return false;
    interp(v, alpha);
    const L = (v.spec && v.spec.length) || 4.5;
    const ch = Math.cos(v.heading), sh = Math.sin(v.heading);
    const len = air ? 26 : 24;
    const gy = v.kind === 'boat' ? (v.mesh ? v.mesh.position.y : -0.6) + 0.25 : 0.06;
    const ax = V.p.x, az = V.p.z;
    // Cars on a city whose ground shaders light themselves (graphics):
    // hand the lamps over instead of drawing pools.
    let skip = false;
    if (v.kind === 'car' && V.ud.lampLightBaked && CL.n < CL.max) {
      const o = CL.n * 8, d = CL.data;
      d[o] = ax; d[o + 1] = az; d[o + 2] = ch; d[o + 3] = sh;
      d[o + 4] = f; d[o + 5] = f * ((v.brake || 0) > 0.1 ? 2.6 : 0.9); d[o + 6] = L / 2;
      CL.n++;
      skip = true;
    }
    // The cone starts at the nose (from the air: below and ahead).
    const start = air ? L / 2 + y * 0.6 : L / 2 - 0.6;
    V.p.x = ax + ch * (start + len / 2);
    V.p.z = az + sh * (start + len / 2);
    V.p.y = air ? 0.06 : gy;
    V.q.setFromAxisAngle(V.up, -v.heading);
    V.s.set(skip ? 0.001 : len, 1, skip ? 0.001 : air ? 14 : 10);
    V.m4.compose(V.p, V.q, V.s);
    V.heads.setMatrixAt(k, V.m4);
    V.heads.instanceColor.setXYZ(k, f, f, f);
    // Tail glow: cars only (none on the water or in the air).
    const tf = v.kind === 'car' && !skip ? f * ((v.brake || 0) > 0.1 ? 1.9 : 0.7) : 0;
    V.p.x = ax - ch * (L / 2 + 1.2);
    V.p.z = az - sh * (L / 2 + 1.2);
    V.p.y = gy;
    V.s.set(tf > 0 ? 3.4 : 0.001, 1, tf > 0 ? 3.6 : 0.001);
    V.m4.compose(V.p, V.q, V.s);
    V.tails.setMatrixAt(k, V.m4);
    V.tails.instanceColor.setXYZ(k, tf, tf, tf);
    return true;
  }
  function placeBulbs(v, b, alpha) {
    if (v.kind !== 'car' || b + 4 > V.NL + V.NB) return b;
    interp(v, alpha);
    const L = (v.spec && v.spec.length) || 4.5, Wd = (v.spec && v.spec.width) || 1.8;
    const ch = Math.cos(v.heading), sh = Math.sin(v.heading);
    const fx = V.p.x + ch * (L / 2 + 0.05), fz = V.p.z + sh * (L / 2 + 0.05);
    const bp = V.bulbPos.array, bs = V.bulbSize.array;
    for (let s = -1; s <= 1; s += 2) {
      const o = Wd * 0.36 * s;
      bp[b * 3] = fx - sh * o;
      bp[b * 3 + 1] = 0.68;
      bp[b * 3 + 2] = fz + ch * o;
      bs[b] = 0.9;
      b++;
    }
    const rx = V.p.x - ch * (L / 2 + 0.05), rz = V.p.z - sh * (L / 2 + 0.05);
    const tk = (v.brake || 0) > 0.1 ? 0.75 : 0.45;
    for (let s = -1; s <= 1; s += 2) {
      const o = Wd * 0.38 * s;
      bp[b * 3] = rx - sh * o;
      bp[b * 3 + 1] = 0.8;
      bp[b * 3 + 2] = rz + ch * o;
      bs[b] = tk;
      b++;
    }
    return b;
  }

  function updateRain(cam, dt) {
    const R = V.rain;
    const rn = W.rain;
    R.visible = rn > 0.01 && !!cam;
    if (!R.visible) return;
    rainTime += dt;
    if (rainTime > 5000) rainTime = 0;
    const U = V.rainU;
    U.uTime.value = rainTime;
    U.uVel.value.set(Math.cos(W.windDir) * W.wind * 0.6, -24, Math.sin(W.windDir) * W.wind * 0.6);
    U.uOpacity.value = 0.32 * rn * (1 - 0.35 * V.night);
    const q = game.progress && game.progress.settings ? game.progress.settings.quality : 1;
    R.geometry.setDrawRange(0, (q != null && q < 1 ? V.NR / 2 : V.NR) * 2);
  }

  // Lamps of the nearest cars for shaders that light the ground with them
  // (graphics.js): per car x, z, cos and sin of heading, headlight, tail
  // glow, half length, spare.
  const CL = { n: 0, max: 6, data: new Float32Array(6 * 8) };
  const sys = {
    name: 'daynight',
    carLamps: CL,
    fixedUpdate(dt) {
      if (!(dt > 0)) return;
      // The player set the time in Settings: the clock stays put.
      if (game.timeLocked) return;
      const h0 = Number.isFinite(game.clock) ? game.clock : 9;
      const dh = dt * baseRate * (1 + nightAt(h0));
      game.clock = (h0 + dh) % 24;
      // Weather spells in game hours, transitions in seconds.
      spellLeft -= dh;
      if (spellLeft <= 0) {
        spellLeft = rng.range(3, 6);
        const next = pickNext();
        if (next !== W.name) startWeather(next, false);
      }
      if (wT < 1) {
        wT = Math.min(1, wT + dt / TRANSITION_S);
        applyWeatherBlend(smooth(wT));
      }
      W.windDir += clamp(((windDirTarget - W.windDir + Math.PI * 3) % TAU) - Math.PI, -1, 1) * dt * 0.01;
      cloudDrift += dt * (W.wind * 1.2 + 1.5);
      if (cloudDrift > 1e6) cloudDrift = 0;
    },
    render(alpha, dt) {
      if (!V) return;
      const cam = game.camera || null;
      applySky();
      if (cam) {
        V.dome.position.copy(cam.position);
        V.stars.position.copy(cam.position);
        const el = game.renderer && game.renderer.domElement;
        const hpx = el && el.height ? el.height : 720;
        V.lampU.uScale.value = hpx / (2 * Math.tan(((cam.fov || 60) * Math.PI) / 360));
      }
      updateClouds(cam);
      updateHeadlights(cam, alpha);
      updateRain(cam, Number.isFinite(dt) ? Math.min(dt, 0.1) : 1 / 60);
    },
    setHour(h) {
      game.clock = wrapHour(h);
      forceApply = true;
    },
    // Force a weather; `instant` skips the 20 s blend (previews, tests).
    setWeather(name, instant = false) {
      if (!W_TARGET[name]) return false;
      startWeather(name, instant);
      spellLeft = rng.range(3, 6);
      forceApply = true;
      return true;
    },
    get weather() {
      return W.name;
    },
    // Current sky colours and light state, refreshed whenever they change
    // (version counts the changes). Colours are linear.
    sky: {
      zenith: new THREE.Color(), horizon: new THREE.Color(), fog: new THREE.Color(), sunColor: new THREE.Color(),
      sunDir: new THREE.Vector3(0, 1, 0), lightDir: new THREE.Vector3(0, 1, 0),
      sunDisc: 1, glow: 1, night: 0, lit: 0, overcast: 0, rain: 0, fogAmount: 0, shadow: 1, version: 0,
    },
    // Re-apply sky and lights on the next frame (after a settings change).
    refresh() {
      forceApply = true;
    },
  };
  return sys;
}
