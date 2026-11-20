// Vehicle effects: tyre smoke, skid marks, sparks, dust, exhaust puffs,
// rain spray, damage smoke and flames, lamp glows, the player's headlight
// beams, contact shadows, boat spray / rooster tails / landing rings and
// aircraft vapour, prop wash, rotor downwash and touchdown puffs.
// Everything is pooled: two instanced billboard systems (alpha-blended
// and additive), one skid-mark ring buffer, one instanced shadow layer
// and one beam mesh, so the whole system adds five draw calls. Nothing is
// allocated per frame; counts scale with game.quality.
//
// Usage: game.addSystem(createEffects(game));
import * as THREE from 'three';
import { noteVehicleHit, releaseVehicleMesh } from './vehiclemesh.js';
import { setLampNight, setVehicleEnvMap } from './vehiclemats.js';

const MAX_ALPHA = 1400;
const MAX_ADD = 700;
const MAX_SKID = 600;
const MAX_SHADOW = 96;
const FX_RANGE = 95; // metres from the camera where craft emit effects

function clamp(v, a, b) {
  return v < a ? a : v > b ? b : v;
}
function smooth(a, b, x) {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
}

// Deterministic-enough fast random for visuals (not game logic).
let seed = 1234567;
function rnd() {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed / 4294967296;
}
function rs() {
  return rnd() * 2 - 1;
}

// ---- textures ------------------------------------------------------------------
// 2x2 atlas: 0 soft noisy puff, 1 ring, 2 spark streak, 3 round glow.
function makeAtlas() {
  const S = 128;
  const c = document.createElement('canvas');
  c.width = c.height = S * 2;
  const g = c.getContext('2d');
  g.clearRect(0, 0, S * 2, S * 2);
  // Puff: a few overlapping soft blobs for a billowy edge.
  g.save();
  g.beginPath();
  g.rect(0, 0, S, S);
  g.clip();
  for (let k = 0; k < 9; k++) {
    const a = (k / 9) * Math.PI * 2;
    const r = k === 0 ? 0 : S * 0.16;
    const x = S / 2 + Math.cos(a) * r, y = S / 2 + Math.sin(a) * r;
    const rad = k === 0 ? S * 0.42 : S * 0.26;
    const gr = g.createRadialGradient(x, y, 0, x, y, rad);
    gr.addColorStop(0, 'rgba(255,255,255,0.55)');
    gr.addColorStop(0.5, 'rgba(255,255,255,0.28)');
    gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr;
    g.fillRect(0, 0, S, S);
  }
  g.restore();
  // Ring.
  {
    const x = S * 1.5, y = S / 2;
    const gr = g.createRadialGradient(x, y, S * 0.2, x, y, S * 0.48);
    gr.addColorStop(0, 'rgba(255,255,255,0)');
    gr.addColorStop(0.55, 'rgba(255,255,255,0.9)');
    gr.addColorStop(0.75, 'rgba(255,255,255,0.35)');
    gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr;
    g.fillRect(S, 0, S, S);
  }
  // Spark streak: a radial glow squashed into a horizontal line.
  {
    g.save();
    g.beginPath();
    g.rect(0, S, S, S);
    g.clip();
    g.translate(S / 2, S * 1.5);
    g.scale(1, 0.14);
    const gr = g.createRadialGradient(0, 0, 0, 0, 0, S * 0.46);
    gr.addColorStop(0, 'rgba(255,255,255,1)');
    gr.addColorStop(0.5, 'rgba(255,255,255,0.6)');
    gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr;
    g.fillRect(-S / 2, -S * 3.5, S, S * 7);
    g.restore();
  }
  // Glow.
  {
    const x = S * 1.5, y = S * 1.5;
    const gr = g.createRadialGradient(x, y, 0, x, y, S * 0.5);
    gr.addColorStop(0, 'rgba(255,255,255,1)');
    gr.addColorStop(0.15, 'rgba(255,255,255,0.75)');
    gr.addColorStop(0.45, 'rgba(255,255,255,0.18)');
    gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr;
    g.fillRect(S, S, S, S);
  }
  return toData(g, S * 2);
}

// Copy a canvas into a DataTexture (row 0 = canvas top, no flip), which
// uploads reliably everywhere.
function toData(g, S) {
  const img = g.getImageData(0, 0, S, S);
  const t = new THREE.DataTexture(new Uint8Array(img.data.buffer.slice(0)), S, S, THREE.RGBAFormat);
  t.colorSpace = THREE.NoColorSpace;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.needsUpdate = true;
  return t;
}

function makeShadowTex() {
  const S = 64;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  g.filter = 'blur(6px)';
  g.fillStyle = '#fff';
  const m = 12;
  g.beginPath();
  if (g.roundRect) g.roundRect(m, m, S - 2 * m, S - 2 * m, 10);
  else g.rect(m, m, S - 2 * m, S - 2 * m);
  g.fill();
  return toData(g, S);
}

// ---- billboard particle system ---------------------------------------------------
const VERT = /* glsl */`
attribute vec3 iPos;
attribute vec4 iData; // size, alpha, rotation, cell (+4 flat, +8 stretched)
attribute vec3 iCol;
attribute vec3 iVel;
varying vec2 vUv;
varying vec4 vCol;
void main() {
  float size = iData.x;
  float rot = iData.z;
  float mode = floor(iData.w / 4.0);
  float cell = iData.w - mode * 4.0;
  vec2 c = position.xy;
  float cs = cos(rot), sn = sin(rot);
  vec2 r = vec2(c.x * cs - c.y * sn, c.x * sn + c.y * cs) * size;
  vec4 mv;
  if (mode > 1.5) {
    mv = viewMatrix * vec4(iPos, 1.0);
    vec3 vv = (viewMatrix * vec4(iVel, 0.0)).xyz;
    vec2 d = vv.xy;
    float l = length(d);
    d = l > 1e-4 ? d / l : vec2(1.0, 0.0);
    vec2 p = vec2(-d.y, d.x);
    mv.xy += d * c.x * (size + l * 0.06) + p * c.y * size * 0.35;
  } else if (mode > 0.5) {
    mv = viewMatrix * vec4(iPos + vec3(r.x, 0.0, r.y), 1.0);
  } else {
    mv = viewMatrix * vec4(iPos, 1.0);
    mv.xy += r;
  }
  gl_Position = projectionMatrix * mv;
  vUv = vec2(c.x + 0.5, 0.5 - c.y) * 0.5 + vec2(mod(cell, 2.0), floor(cell / 2.0)) * 0.5;
  vCol = vec4(iCol, iData.y);
}
`;
const FRAG_ALPHA = /* glsl */`
uniform sampler2D map;
uniform float uLight;
varying vec2 vUv;
varying vec4 vCol;
void main() {
  vec4 t = texture2D(map, vUv);
  float a = t.a * vCol.a;
  if (a < 0.004) discard;
  gl_FragColor = vec4(vCol.rgb * uLight, a);
}
`;
const FRAG_ADD = /* glsl */`
uniform sampler2D map;
varying vec2 vUv;
varying vec4 vCol;
void main() {
  vec4 t = texture2D(map, vUv);
  float a = t.a * vCol.a;
  gl_FragColor = vec4(vCol.rgb * a, 1.0);
}
`;

function createPool(max, additive, atlas, scene) {
  const geo = new THREE.InstancedBufferGeometry();
  const quad = new THREE.PlaneGeometry(1, 1);
  geo.index = quad.index;
  geo.setAttribute('position', quad.attributes.position);
  const iPos = new THREE.InstancedBufferAttribute(new Float32Array(max * 3), 3);
  const iData = new THREE.InstancedBufferAttribute(new Float32Array(max * 4), 4);
  const iCol = new THREE.InstancedBufferAttribute(new Float32Array(max * 3), 3);
  const iVel = new THREE.InstancedBufferAttribute(new Float32Array(max * 3), 3);
  for (const a of [iPos, iData, iCol, iVel]) a.setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('iPos', iPos);
  geo.setAttribute('iData', iData);
  geo.setAttribute('iCol', iCol);
  geo.setAttribute('iVel', iVel);
  geo.instanceCount = 0;
  const mat = new THREE.ShaderMaterial({
    uniforms: { map: { value: atlas }, uLight: { value: 1 } },
    vertexShader: VERT,
    fragmentShader: additive ? FRAG_ADD : FRAG_ALPHA,
    transparent: true,
    depthWrite: false,
    blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
  });
  if (additive) {
    mat.blending = THREE.CustomBlending;
    mat.blendSrc = THREE.OneFactor;
    mat.blendDst = THREE.OneFactor;
  }
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = additive ? 6 : 5;
  mesh.name = additive ? 'fx-additive' : 'fx-smoke';
  scene.add(mesh);
  // Particle state (structure of arrays).
  const P = {
    max, n: 0, mesh, geo, iPos, iData, iCol, iVel,
    x: new Float32Array(max), y: new Float32Array(max), z: new Float32Array(max),
    vx: new Float32Array(max), vy: new Float32Array(max), vz: new Float32Array(max),
    age: new Float32Array(max), life: new Float32Array(max),
    s0: new Float32Array(max), s1: new Float32Array(max), a0: new Float32Array(max),
    rot: new Float32Array(max), rotV: new Float32Array(max),
    r: new Float32Array(max), g: new Float32Array(max), b: new Float32Array(max),
    cell: new Float32Array(max), grav: new Float32Array(max), drag: new Float32Array(max),
    fadeIn: new Float32Array(max), floor: new Float32Array(max),
    depth: new Float32Array(max), order: new Uint16Array(max), bucketCount: new Uint16Array(65), cap: max,
    attrs: [iPos, iData, iCol, iVel],
  };
  return P;
}

function emitP(P, x, y, z, vx, vy, vz, life, s0, s1, a0, r, g, b, cell, grav, drag) {
  if (P.n >= P.cap) return -1;
  const i = P.n++;
  P.x[i] = x; P.y[i] = y; P.z[i] = z;
  P.vx[i] = vx; P.vy[i] = vy; P.vz[i] = vz;
  P.age[i] = 0; P.life[i] = life;
  P.s0[i] = s0; P.s1[i] = s1; P.a0[i] = a0;
  P.rot[i] = rnd() * 6.283; P.rotV[i] = rs() * 0.8;
  P.r[i] = r; P.g[i] = g; P.b[i] = b;
  P.cell[i] = cell; P.grav[i] = grav; P.drag[i] = drag;
  P.fadeIn[i] = 0.12; P.floor[i] = -1000;
  return i;
}

function stepPool(P, dt) {
  let i = 0;
  while (i < P.n) {
    P.age[i] += dt;
    if (P.age[i] >= P.life[i]) {
      const j = --P.n;
      if (i !== j) {
        P.x[i] = P.x[j]; P.y[i] = P.y[j]; P.z[i] = P.z[j];
        P.vx[i] = P.vx[j]; P.vy[i] = P.vy[j]; P.vz[i] = P.vz[j];
        P.age[i] = P.age[j]; P.life[i] = P.life[j];
        P.s0[i] = P.s0[j]; P.s1[i] = P.s1[j]; P.a0[i] = P.a0[j];
        P.rot[i] = P.rot[j]; P.rotV[i] = P.rotV[j];
        P.r[i] = P.r[j]; P.g[i] = P.g[j]; P.b[i] = P.b[j];
        P.cell[i] = P.cell[j]; P.grav[i] = P.grav[j]; P.drag[i] = P.drag[j];
        P.fadeIn[i] = P.fadeIn[j]; P.floor[i] = P.floor[j];
      }
      continue;
    }
    const k = Math.max(0, 1 - P.drag[i] * dt);
    P.vx[i] *= k; P.vz[i] *= k;
    P.vy[i] = P.vy[i] * k - P.grav[i] * dt;
    P.x[i] += P.vx[i] * dt;
    P.y[i] += P.vy[i] * dt;
    P.z[i] += P.vz[i] * dt;
    if (P.y[i] < P.floor[i]) {
      P.y[i] = P.floor[i];
      if (P.vy[i] < 0) P.vy[i] *= -0.3;
      P.vx[i] *= 0.6; P.vz[i] *= 0.6;
    }
    P.rot[i] += P.rotV[i] * dt;
    i++;
  }
}

// Write instance buffers, optionally sorted back to front (bucketed).
function writePool(P, cam, sort, extra) {
  const n = P.n;
  const pos = P.iPos.array, dat = P.iData.array, col = P.iCol.array, vel = P.iVel.array;
  const ord = P.order;
  if (sort && n > 1) {
    const e = cam.matrixWorldInverse.elements;
    let dmin = 1e9, dmax = -1e9;
    for (let i = 0; i < n; i++) {
      const d = -(e[2] * P.x[i] + e[6] * P.y[i] + e[10] * P.z[i] + e[14]);
      P.depth[i] = d;
      if (d < dmin) dmin = d;
      if (d > dmax) dmax = d;
    }
    const bc = P.bucketCount;
    bc.fill(0);
    const span = Math.max(1e-3, dmax - dmin);
    for (let i = 0; i < n; i++) {
      const b = 63 - Math.min(63, Math.floor(((P.depth[i] - dmin) / span) * 63.999));
      P.depth[i] = b;
      bc[b + 1]++;
    }
    for (let b = 1; b < 65; b++) bc[b] += bc[b - 1];
    for (let i = 0; i < n; i++) ord[bc[P.depth[i]]++] = i;
  } else {
    for (let i = 0; i < n; i++) ord[i] = i;
  }
  for (let k = 0; k < n; k++) {
    const i = ord[k];
    const t = P.age[i] / P.life[i];
    const fi = P.fadeIn[i] > 0 ? Math.min(1, P.age[i] / (P.life[i] * P.fadeIn[i])) : 1;
    const a = P.a0[i] * fi * (1 - t) * (1 - t * 0.3);
    pos[k * 3] = P.x[i]; pos[k * 3 + 1] = P.y[i]; pos[k * 3 + 2] = P.z[i];
    dat[k * 4] = P.s0[i] + (P.s1[i] - P.s0[i]) * Math.sqrt(t);
    dat[k * 4 + 1] = a;
    dat[k * 4 + 2] = P.rot[i];
    dat[k * 4 + 3] = P.cell[i];
    col[k * 3] = P.r[i]; col[k * 3 + 1] = P.g[i]; col[k * 3 + 2] = P.b[i];
    vel[k * 3] = P.vx[i]; vel[k * 3 + 1] = P.vy[i]; vel[k * 3 + 2] = P.vz[i];
  }
  let m = n;
  if (extra) m = extra(m, pos, dat, col, vel);
  P.geo.instanceCount = m;
  P.mesh.visible = m > 0;
  if (m > 0) {
    for (let j = 0; j < 4; j++) {
      const a = P.attrs[j];
      a.clearUpdateRanges();
      a.addUpdateRange(0, m * a.itemSize);
      a.needsUpdate = true;
    }
  }
}

// ---- skid marks -------------------------------------------------------------------
const SKID_VERT = /* glsl */`
attribute float aBirth;
attribute vec2 aEdge;
uniform float uTime;
uniform float uLife;
varying float vA;
varying float vE;
void main() {
  float age = uTime - aBirth;
  vA = aEdge.y * (1.0 - smoothstep(uLife * 0.6, uLife, age));
  vE = aEdge.x;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;
const SKID_FRAG = /* glsl */`
uniform vec3 uColor;
varying float vA;
varying float vE;
void main() {
  float e = 1.0 - abs(vE * 2.0 - 1.0);
  float a = vA * smoothstep(0.0, 0.45, e);
  if (a < 0.003) discard;
  gl_FragColor = vec4(uColor, a);
}
`;

function createSkids(scene) {
  const N = MAX_SKID;
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(N * 4 * 3);
  const birth = new Float32Array(N * 4).fill(-1e6);
  const edge = new Float32Array(N * 4 * 2);
  const idx = new Uint16Array(N * 6);
  for (let i = 0; i < N; i++) {
    idx.set([i * 4, i * 4 + 2, i * 4 + 1, i * 4, i * 4 + 3, i * 4 + 2], i * 6);
  }
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute('aBirth', new THREE.BufferAttribute(birth, 1).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute('aEdge', new THREE.BufferAttribute(edge, 2).setUsage(THREE.DynamicDrawUsage));
  geo.setIndex(new THREE.BufferAttribute(idx, 1));
  const mat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uLife: { value: 26 }, uColor: { value: new THREE.Color(0.018, 0.017, 0.016) } },
    vertexShader: SKID_VERT,
    fragmentShader: SKID_FRAG,
    transparent: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -3,
    polygonOffsetUnits: -6,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = 2;
  mesh.name = 'fx-skids';
  scene.add(mesh);
  const at = geo.attributes;
  return { mesh, geo, pos, birth, edge, head: 0, lo: N, hi: -1, mat, used: 0, attrs: [at.position, at.aBirth, at.aEdge], sizes: [12, 4, 8] };
}

// ---- contact shadows --------------------------------------------------------------
const SH_VERT = /* glsl */`
attribute float iOp;
varying vec2 vUv;
varying float vOp;
void main() {
  vUv = uv;
  vOp = iOp;
  gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
}
`;
const SH_FRAG = /* glsl */`
uniform sampler2D map;
varying vec2 vUv;
varying float vOp;
void main() {
  float a = texture2D(map, vUv).r * vOp;
  if (a < 0.004) discard;
  gl_FragColor = vec4(0.0, 0.0, 0.0, a);
}
`;

// ---- headlight beams ----------------------------------------------------------------
const BEAM_VERT = /* glsl */`
attribute float aT;
varying float vT;
varying vec3 vN;
varying vec3 vV;
void main() {
  vT = aT;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vN = normalize(normalMatrix * normal);
  vV = normalize(-mv.xyz);
  gl_Position = projectionMatrix * mv;
}
`;
const BEAM_FRAG = /* glsl */`
uniform float uI;
varying float vT;
varying vec3 vN;
varying vec3 vV;
void main() {
  float edge = abs(dot(vN, vV));
  float a = uI * pow(1.0 - vT, 1.6) * smoothstep(0.0, 0.08, vT) * edge * edge;
  gl_FragColor = vec4(vec3(1.0, 0.95, 0.82) * a, 1.0);
}
`;

function beamGeometry() {
  // Two open cones from the lamps forward, slightly down.
  const pos = [], nor = [], tt = [], idx = [];
  const seg = 14, rings = 6;
  for (const side of [1, -1]) {
    const base = pos.length / 3;
    for (let r = 0; r <= rings; r++) {
      const t = r / rings;
      const len = t * 22;
      const rad = 0.12 + t * 3.4;
      for (let s = 0; s <= seg; s++) {
        const a = (s / seg) * Math.PI * 2;
        const cy = Math.cos(a), cz = Math.sin(a);
        pos.push(len, -t * 1.5 + cy * rad * 0.55, side * (0.68 + t * 0.6) + cz * rad);
        nor.push(-0.15, cy, cz);
        tt.push(t);
      }
    }
    for (let r = 0; r < rings; r++) {
      for (let s = 0; s < seg; s++) {
        const a = base + r * (seg + 1) + s, b = a + seg + 1;
        idx.push(a, b, a + 1, a + 1, b, b + 1);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('aT', new THREE.Float32BufferAttribute(tt, 1));
  g.setIndex(idx);
  return g;
}

// Small gradient-sky reflection map, used when the game has none yet.
function fallbackEnv(renderer) {
  const scene = new THREE.Scene();
  const geo = new THREE.SphereGeometry(10, 32, 16);
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    vertexShader: 'varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: `varying vec3 vP; void main(){
      float h = normalize(vP).y;
      vec3 sky = mix(vec3(0.62, 0.74, 0.86), vec3(0.24, 0.42, 0.72), smoothstep(0.0, 0.7, h));
      vec3 ground = mix(vec3(0.34, 0.33, 0.31), vec3(0.16, 0.16, 0.15), smoothstep(0.0, -0.5, h));
      vec3 c = h > 0.0 ? sky : ground;
      c += vec3(1.0, 0.95, 0.85) * pow(max(0.0, dot(normalize(vP), normalize(vec3(0.5, 0.75, 0.35)))), 64.0) * 6.0;
      c += vec3(0.95) * smoothstep(0.06, 0.0, abs(h)) * 0.35;
      gl_FragColor = vec4(c, 1.0);
    }`,
  });
  scene.add(new THREE.Mesh(geo, mat));
  const pm = new THREE.PMREMGenerator(renderer);
  const rt = pm.fromScene(scene, 0.02);
  pm.dispose();
  geo.dispose();
  mat.dispose();
  return rt.texture;
}

// Day/night level from the hour, matching the day/night system's table.
function nightAt(h) {
  if (h < 4.6 || h >= 20.8) return 1;
  if (h < 5.8) return 1 - 0.35 * ((h - 4.6) / 1.2);
  if (h < 6.8) return 0.65 - 0.53 * ((h - 5.8) / 1.0);
  if (h < 8.5) return 0.12 * (1 - (h - 6.8) / 1.7);
  if (h < 18.5) return 0;
  if (h < 19.6) return 0.5 * ((h - 18.5) / 1.1);
  return 0.5 + 0.5 * ((h - 19.6) / 1.2);
}

export function createEffects(game) {
  const scene = game.scene;
  const camera = game.camera;
  const atlas = makeAtlas();
  const A = createPool(MAX_ALPHA, false, atlas, scene);
  const B = createPool(MAX_ADD, true, atlas, scene);
  const skids = createSkids(scene);

  // Contact shadows.
  const shTex = makeShadowTex();
  const shGeo = new THREE.PlaneGeometry(1, 1);
  shGeo.rotateX(-Math.PI / 2);
  const shOp = new THREE.InstancedBufferAttribute(new Float32Array(MAX_SHADOW), 1);
  shOp.setUsage(THREE.DynamicDrawUsage);
  shGeo.setAttribute('iOp', shOp);
  const shMat = new THREE.ShaderMaterial({
    uniforms: { map: { value: shTex } },
    vertexShader: SH_VERT,
    fragmentShader: SH_FRAG,
    transparent: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -4,
  });
  const shadows = new THREE.InstancedMesh(shGeo, shMat, MAX_SHADOW);
  shadows.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  shadows.frustumCulled = false;
  shadows.renderOrder = 1;
  shadows.count = 0;
  shadows.name = 'fx-shadows';
  scene.add(shadows);

  // Player headlight beams.
  const beamMat = new THREE.ShaderMaterial({
    uniforms: { uI: { value: 0 } },
    vertexShader: BEAM_VERT,
    fragmentShader: BEAM_FRAG,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.CustomBlending,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneFactor,
  });
  const beams = new THREE.Mesh(beamGeometry(), beamMat);
  beams.visible = false;
  beams.frustumCulled = false;
  beams.renderOrder = 7;
  beams.name = 'fx-beams';
  scene.add(beams);

  const fx = { enabled: true, shadows: true, beams: true, shake: 1 };
  let envFallback = null;
  let night = 0;
  let lit = 0;
  let time = 0;
  const state = new Map(); // craft -> per-craft effect state

  function st(v) {
    let s = state.get(v);
    if (!s) {
      s = {
        pvx: v.vx || 0, pvz: v.vz || 0, pvy: v.vy || 0, ph: v.heading || 0, pp: v.pitch || 0,
        hop: 0, hopV: 0, touch: !!v.touchdown, acc: 0, ring: 0, smoke: 0, puff: 0, spray: 0,
        marks: [{ on: false, x: 0, z: 0, lx: 0, lz: 0, rx: 0, rz: 0 }, { on: false, x: 0, z: 0, lx: 0, lz: 0, rx: 0, rz: 0 }],
        g: 1,
      };
      state.set(v, s);
    }
    return s;
  }

  const q = () => clamp(game.quality == null ? 1 : +game.quality || 1, 0.25, 1);
  const seaY = () => (Number.isFinite(game.seaY) ? game.seaY : -0.6);
  const city = game.city;
  const onRoad = (x, z) => (city && city.onRoad ? city.onRoad(x, z) : true);
  const isGround = (x, z) => (city && city.isGround ? city.isGround(x, z) : true);

  // Local (forward, right) offset to world.
  const W = { x: 0, z: 0 };
  function toWorld(v, lx, lz) {
    const c = Math.cos(v.heading), s = Math.sin(v.heading);
    W.x = v.x + c * lx - s * lz;
    W.z = v.z + s * lx + c * lz;
    return W;
  }

  // ---- emitters ----
  function smoke(x, y, z, vx, vy, vz, life, s0, s1, a, r, g, b, rise = 0.3, drag = 1.6) {
    const i = emitP(A, x, y, z, vx, vy, vz, life, s0, s1, a, r, g, b, 0, -rise, drag);
    if (i >= 0) A.floor[i] = y - 0.3;
    return i;
  }
  function spray(x, y, z, vx, vy, vz, life, s0, s1, a) {
    const i = emitP(A, x, y, z, vx, vy, vz, life, s0, s1, a, 0.93, 0.96, 0.98, 0, 9.8, 0.6);
    if (i >= 0) A.fadeIn[i] = 0.05;
    return i;
  }
  function ring(x, y, z, s0, s1, life, a, r = 0.95, g = 0.97, b = 1) {
    const i = emitP(A, x, y, z, 0, 0, 0, life, s0, s1, a, r, g, b, 1 + 4, 0, 0);
    if (i >= 0) {
      A.fadeIn[i] = 0.04;
      A.rotV[i] = 0;
    }
    return i;
  }
  function sparks(x, y, z, nx, nz, n, speed) {
    const k = Math.round(n * q());
    for (let i = 0; i < k; i++) {
      const sp = speed * (0.3 + rnd() * 0.8);
      const vx = nx * sp * 0.5 + rs() * sp, vz = nz * sp * 0.5 + rs() * sp;
      const j = emitP(B, x + rs() * 0.15, y + rnd() * 0.25, z + rs() * 0.15, vx, 1 + rnd() * sp * 0.6, vz, 0.3 + rnd() * 0.5, 0.16, 0.08, 3, 1, 0.62 + rnd() * 0.25, 0.25, 2 + 8, 9.8, 0.4);
      if (j >= 0) {
        B.fadeIn[j] = 0;
        B.floor[j] = 0.02;
      }
    }
    // A brief flash.
    const f = emitP(B, x, y + 0.2, z, 0, 0, 0, 0.12, 0.9, 1.6, 0.9, 1, 0.75, 0.4, 3, 0, 0);
    if (f >= 0) B.fadeIn[f] = 0;
  }

  // Craft-relative impact direction from the change of velocity.
  function onImpact(v, strength) {
    if (!fx.enabled || !v || v.removed) return;
    const s = st(v);
    let dvx = (v.vx || 0) - s.pvx, dvz = (v.vz || 0) - s.pvz;
    let l = Math.hypot(dvx, dvz);
    if (l < 0.05) {
      // No clear push: assume a frontal hit.
      dvx = -Math.cos(v.heading);
      dvz = -Math.sin(v.heading);
      l = 1;
    }
    // The struck point is opposite the push.
    const hx = -dvx / l, hz = -dvz / l;
    const c = Math.cos(v.heading), sn = Math.sin(v.heading);
    const lx = hx * c + hz * sn, lz = -hx * sn + hz * c;
    if (v.kind === 'car' && v.mesh) noteVehicleHit(v.mesh, lx, 0, lz, strength);
    if (v === playerCraft() && game.chase && game.chase.kick) game.chase.kick(strength);
    const dx = camera.position.x - v.x, dz = camera.position.z - v.z;
    if (dx * dx + dz * dz > FX_RANGE * FX_RANGE) return;
    const L = (v.spec && v.spec.length) || 4, Wd = (v.spec && v.spec.width) || 1.8;
    // Contact point on the body box toward the struck side.
    const ex = clamp(lx * 10, -1, 1) * L * 0.5, ez = clamp(lz * 10, -1, 1) * Wd * 0.5;
    const p = toWorld(v, ex, ez);
    if (v.kind === 'boat') {
      for (let i = 0; i < 10 * q(); i++) spray(p.x, (v.mesh ? v.mesh.position.y : seaY()) + 0.3, p.z, hx * 2 + rs() * 2, 2 + rnd() * 3, hz * 2 + rs() * 2, 0.8, 0.3, 1.2, 0.5);
      return;
    }
    if (strength > 2.5) sparks(p.x, 0.25 + rnd() * 0.3 + (v.y || 0), p.z, -hx, -hz, Math.min(36, 4 + strength * 2), 2 + strength * 0.35);
    if (strength > 9) {
      for (let i = 0; i < 4 * q(); i++) smoke(p.x, 0.5 + (v.y || 0), p.z, rs() * 1.5, 0.6, rs() * 1.5, 1.4, 0.6, 2.4, 0.25, 0.55, 0.53, 0.5);
    }
  }
  function onCrash(a, b, strength) {
    if (!fx.enabled || !a || !b) return;
    const mx = (a.x + b.x) / 2, mz = (a.z + b.z) / 2;
    for (let k = 0; k < 2; k++) {
      const v = k === 0 ? a : b, o = k === 0 ? b : a;
      if (v.kind !== 'car' || !v.mesh) continue;
      const dx = o.x - v.x, dz = o.z - v.z;
      const l = Math.hypot(dx, dz) || 1;
      const c = Math.cos(v.heading), sn = Math.sin(v.heading);
      noteVehicleHit(v.mesh, (dx * c + dz * sn) / l, 0, (-dx * sn + dz * c) / l, strength || 0);
      if (v === playerCraft() && game.chase && game.chase.kick) game.chase.kick(strength || 0);
    }
    if (a.kind === 'car' && b.kind === 'car' && (strength || 0) > 2) {
      const dx = camera.position.x - mx, dz = camera.position.z - mz;
      if (dx * dx + dz * dz < FX_RANGE * FX_RANGE) {
        const nx = b.x - a.x, nz = b.z - a.z, l = Math.hypot(nx, nz) || 1;
        sparks(mx, 0.45, mz, -nz / l, nx / l, Math.min(40, 6 + strength * 2.2), 2.5 + strength * 0.3);
      }
    }
  }
  function playerCraft() {
    return game.player && game.player.vehicle;
  }

  const offs = [];
  if (game.events && game.events.on) {
    offs.push(game.events.on('vehicleImpact', onImpact));
    offs.push(game.events.on('vehicleCrash', onCrash));
    offs.push(game.events.on('vehicleRemoved', (v) => {
      if (v && v.kind === 'car' && v.mesh) releaseVehicleMesh(v.mesh);
      state.delete(v);
    }));
    offs.push(game.events.on('splash', (a, b) => {
      // Accept (craft) or (x, z).
      if (a && typeof a === 'object' && Number.isFinite(a.x)) ringBurst(a.x, a.z, 1);
      else if (Number.isFinite(a) && Number.isFinite(b)) ringBurst(a, b, 1);
    }));
  }
  function ringBurst(x, z, k) {
    const y = seaY() + 0.12;
    ring(x, y, z, 1.2 * k, 6 * k, 1.4, 0.55);
    for (let i = 0; i < 14 * q() * k; i++) {
      const a = rnd() * 6.283, sp = 1.5 + rnd() * 3;
      spray(x + Math.cos(a) * 0.6, y, z + Math.sin(a) * 0.6, Math.cos(a) * sp, 2.5 + rnd() * 3.5 * k, Math.sin(a) * sp, 0.9, 0.25, 1.1, 0.55);
    }
  }

  // ---- per-kind updates (fixed step) ----
  function carFx(v, s, dt, qq, d2) {
    const spec = v.spec;
    const ud = v.mesh && v.mesh.userData;
    const an = ud && ud.anchors;
    const spd = Math.abs(v.speed || 0);
    const ax = an ? an.ax : spec.wheelBase / 2, az = an ? an.az : spec.width / 2 - 0.15;
    const road = onRoad(v.x, v.z);
    const slip = v.slip || 0;
    const braking = (v.brake || 0) > 0.6 && spd > 7;
    const sliding = slip > 0.28 && spd > 2.5;
    const hand = !!v.handbrake && spd > 3;
    const mark = road && (sliding || braking || hand) && d2 < 80 * 80;
    const fwdx = Math.cos(v.heading), fwdz = Math.sin(v.heading);
    for (let k = 0; k < 2; k++) {
      const side = k === 0 ? 1 : -1;
      const p = toWorld(v, -ax, side * az);
      const m = s.marks[k];
      // Skid marks under the rear wheels.
      if (mark) {
        const strength = clamp(Math.max(slip, braking ? 0.55 : 0, hand ? 0.7 : 0), 0, 1);
        if (!m.on) {
          m.on = true;
          m.x = p.x; m.z = p.z;
          m.lx = NaN;
        } else {
          const dx = p.x - m.x, dz = p.z - m.z;
          const l2 = dx * dx + dz * dz;
          if (l2 > 0.16) {
            addSkid(m, p.x, p.z, dx, dz, Math.sqrt(l2), (an ? 0.13 : 0.12) + (spec.body === 'truck' ? 0.08 : 0), 0.5 * strength + 0.12);
          }
        }
      } else {
        m.on = false;
      }
      // Tyre smoke from sliding / burnouts on tarmac, dust off it.
      if (d2 < FX_RANGE * FX_RANGE) {
        if (road && (sliding || hand) && rnd() < (slip * 1.3 + (hand ? 0.4 : 0)) * qq * 0.9) {
          smoke(p.x + rs() * 0.2, 0.3, p.z + rs() * 0.2, (v.vx || 0) * 0.25 + rs() * 0.7, 0.9 + rnd() * 1.1, (v.vz || 0) * 0.25 + rs() * 0.7,
            1.6 + rnd() * 1.4, 0.5, 3.6 + slip * 1.8, 0.2, 0.88, 0.88, 0.9, 0.7, 1.3);
        }
        if (!road && spd > 4 && rnd() < clamp(spd / 22, 0, 1) * qq * 0.7) {
          smoke(p.x + rs() * 0.3, 0.2, p.z + rs() * 0.3, -fwdx * spd * 0.2 + rs(), 0.6 + rnd() * 0.6, -fwdz * spd * 0.2 + rs(),
            1.6 + rnd(), 0.6, 3.2, 0.3, 0.62, 0.54, 0.42, 0.15, 1.4);
        }
        if (game.weather && game.weather.rain > 0.3 && road && spd > 7 && rnd() < game.weather.rain * clamp(spd / 30, 0, 1) * qq * 0.9) {
          const w = toWorld(v, k === 0 ? -ax - 0.3 : ax - 0.3, side * az);
          smoke(w.x, 0.2, w.z, -fwdx * spd * 0.3 + rs() * 0.5, 0.4 + rnd() * 0.5, -fwdz * spd * 0.3 + rs() * 0.5,
            0.7 + rnd() * 0.4, 0.4, 2.0, 0.2, 0.8, 0.83, 0.86, 0.05, 2.2);
        }
      }
    }
    if (d2 > FX_RANGE * FX_RANGE || !an) return;
    // Exhaust puffs on launch (and a little at idle when cold-ish).
    const launching = (v.throttle || 0) > 0.6 && spd < 8 && !v.wrecked;
    s.puff += dt * (launching ? 14 : v.driver ? 0.8 : 0);
    while (s.puff > 1) {
      s.puff -= 1;
      for (let ei = 0; ei < 2; ei++) {
        const e = ei === 0 ? an.exhaust : an.exhaust2;
        if (!e) continue;
        const p = toWorld(v, e[0], e[2]);
        const back = spec.body === 'truck' ? 0 : -1.2 - rnd();
        smoke(p.x, e[1], p.z, fwdx * back + rs() * 0.3, spec.body === 'truck' ? 1.6 : 0.2 + rnd() * 0.3, fwdz * back + rs() * 0.3,
          0.9 + rnd() * 0.6, 0.18, launching ? 1.1 : 0.6, launching ? 0.3 : 0.12, 0.48, 0.48, 0.5, 0.25, 1.8);
      }
    }
    // Damage smoke and fire from the bonnet.
    const hf = Math.max(0, (v.health || 0) / (spec.health || 1));
    if (hf < 0.35 || v.wrecked) {
      const heavy = v.wrecked || hf < 0.12;
      s.smoke += dt * (heavy ? 16 : 5 + (0.35 - hf) * 30) * qq;
      while (s.smoke > 1) {
        s.smoke -= 1;
        const p = toWorld(v, an.bonnet[0] + rs() * 0.3, rs() * 0.3);
        const grey = heavy ? 0.07 + rnd() * 0.05 : 0.42 + hf * 0.8;
        smoke(p.x, an.bonnet[1], p.z, (v.vx || 0) * 0.3 + rs() * 0.3, 1.2 + rnd() * (heavy ? 1.6 : 0.8), (v.vz || 0) * 0.3 + rs() * 0.3,
          heavy ? 2.6 + rnd() * 1.4 : 1.8 + rnd(), 0.5, heavy ? 3.6 : 2.4, heavy ? 0.6 : 0.4, grey, grey, grey * 1.02, heavy ? 1.3 : 0.9, 0.9);
      }
      if (v.wrecked || v.onFire) {
        if (rnd() < 0.7 * qq) {
          const p = toWorld(v, an.bonnet[0] + rs() * 0.4, rs() * 0.5);
          const j = emitP(B, p.x, an.bonnet[1] + 0.05, p.z, rs() * 0.2, 1.4 + rnd(), rs() * 0.2, 0.35 + rnd() * 0.3, 0.5 + rnd() * 0.3, 0.12, 0.8, 1, 0.45 + rnd() * 0.2, 0.12, 3, -1.5, 0.5);
          if (j >= 0) B.fadeIn[j] = 0.15;
        }
      }
    }
  }

  function boatFx(v, s, dt, qq, d2) {
    if (d2 > FX_RANGE * FX_RANGE) return;
    const spec = v.spec;
    const L = spec.length, Wd = spec.width;
    const spd = Math.abs(v.speed || 0);
    const wy = (v.mesh ? v.mesh.position.y : seaY()) - (v.hop || 0);
    const fwdx = Math.cos(v.heading), fwdz = Math.sin(v.heading);
    // Bow spray to both sides.
    if (spd > 4) {
      s.spray += dt * clamp(spd / 14, 0, 1.6) * 55 * qq * (1 - 0.5 * (v.planing || 0) + 0.2);
      while (s.spray > 1) {
        s.spray -= 1;
        const side = rnd() < 0.5 ? 1 : -1;
        const fx_ = L * (0.18 + (v.planing || 0) * -0.1) + rnd() * L * 0.12;
        const p = toWorld(v, fx_, side * Wd * 0.48);
        const out = 1.2 + spd * 0.12;
        const rx = -Math.sin(v.heading) * side, rz = Math.cos(v.heading) * side;
        spray(p.x, wy + 0.1, p.z, rx * out + fwdx * spd * 0.7, 0.8 + rnd() * 1.0 + spd * 0.03, rz * out + fwdz * spd * 0.7,
          0.35 + rnd() * 0.3, 0.25 + L * 0.02, 1.0 + L * 0.07, 0.6);
      }
    }
    // Rooster tail behind fast small boats.
    const small = spec.hull === 'jetski' || spec.hull === 'runabout' || spec.hull === 'inflatable';
    if (small && (v.planing || 0) > 0.4 && spd > 9 && (v.throttle || 0) > 0.3) {
      s.acc += dt * 75 * qq * (v.planing || 0);
      while (s.acc > 1) {
        s.acc -= 1;
        const p = toWorld(v, -L * 0.5 - 0.2, rs() * 0.15);
        const up = 3 + rnd() * 3 + spd * 0.08;
        const back = spd * 0.6 - 2 - rnd() * 4;
        spray(p.x, wy + 0.1, p.z, fwdx * back + rs() * 1.4, up, fwdz * back + rs() * 1.4,
          0.7 + rnd() * 0.6, 0.45, 2.4, 0.38);
      }
    }
    // Landing after a hop.
    if (s.hop > 0.15 && !(v.hop > 0)) {
      const k = clamp(Math.abs(s.hopV) / 4, 0.4, 1.5);
      const p = toWorld(v, 0, 0);
      ring(p.x, wy + 0.12, p.z, L * 0.6, L * 2 * k, 1.3, 0.6);
      for (let i = 0; i < 22 * qq * k; i++) {
        const side = rnd() < 0.5 ? 1 : -1;
        const q2 = toWorld(v, rs() * L * 0.4, side * Wd * 0.5);
        const rx = -Math.sin(v.heading) * side, rz = Math.cos(v.heading) * side;
        spray(q2.x, wy + 0.1, q2.z, rx * (2 + rnd() * 3) + (v.vx || 0) * 0.4, 2 + rnd() * 3 * k, rz * (2 + rnd() * 3) + (v.vz || 0) * 0.4, 0.9, 0.3, 1.4, 0.6);
      }
    }
    s.hop = v.hop || 0;
    s.hopV = v.hopV || 0;
    // Damage smoke.
    const hf = Math.max(0, (v.health || 0) / (spec.health || 1));
    if (hf < 0.35 || v.wrecked) {
      s.smoke += dt * (v.wrecked ? 12 : 5) * qq;
      while (s.smoke > 1) {
        s.smoke -= 1;
        const p = toWorld(v, -L * 0.2, 0);
        const grey = v.wrecked ? 0.08 : 0.45;
        smoke(p.x, wy + (spec.height || 1.5) * 0.7, p.z, rs() * 0.3, 1.4 + rnd(), rs() * 0.3, 2.4, 0.6, 3.2, 0.5, grey, grey, grey, 1.2, 0.9);
      }
    }
  }

  function airFx(v, s, dt, qq, d2) {
    if (d2 > (FX_RANGE + 40) * (FX_RANGE + 40)) return;
    const spec = v.spec;
    const spd = Math.abs(v.speed || 0);
    const y = v.y || 0;
    const overGround = isGround(v.x, v.z);
    const gy = overGround ? 0.05 : seaY() + 0.12;
    const fwdx = Math.cos(v.heading), fwdz = Math.sin(v.heading);
    const heli = v.kind === 'heli';
    // Load factor from turn rate and pitch rate.
    const dh = Math.abs(((v.heading - s.ph + Math.PI * 3) % (Math.PI * 2)) - Math.PI) / dt;
    const dp = ((v.pitch || 0) - s.pp) / dt;
    const g = Math.hypot(1, (spd * dh) / 9.81) + Math.max(0, dp * spd / 9.81);
    s.g += (g - s.g) * Math.min(1, dt * 6);
    if (!heli && !v.onGround && spd > 30 && s.g > 2.1) {
      const k = clamp((s.g - 2.1) / 2, 0, 1);
      const span = (spec.width || 10) / 2 - 0.15;
      for (let si = 0; si < 2; si++) {
        const side = si === 0 ? 1 : -1;
        if (rnd() > 0.9 * qq) continue;
        const p = toWorld(v, 0.2, side * span);
        const wy = y + (v.mesh ? v.mesh.position.y - y : 0) + 1.2 - Math.sin(v.roll || 0) * side * span;
        const j = emitP(A, p.x, wy, p.z, 0, 0, 0, 0.5 + k * 0.6, 0.18, 0.5, 0.3 * k + 0.1, 0.95, 0.97, 1, 0, 0, 0);
        if (j >= 0) A.fadeIn[j] = 0.02;
      }
    }
    // Prop wash on the ground / water.
    const prop = spec.kind === 'plane' && v.engineOn && !v.wrecked && spec.id !== 'jet';
    if ((prop || spec.id === 'jet') && v.onGround && (v.throttle || 0) > 0.35) {
      s.acc += dt * (v.throttle || 0) * 22 * qq;
      while (s.acc > 1) {
        s.acc -= 1;
        const p = toWorld(v, -(spec.length || 7) * 0.35, rs() * 1.5);
        if (overGround) smoke(p.x, 0.15, p.z, -fwdx * (6 + rnd() * 6) + rs(), 0.3 + rnd() * 0.5, -fwdz * (6 + rnd() * 6) + rs(), 1.1 + rnd(), 0.4, 2.4, 0.2, 0.66, 0.6, 0.52, 0.05, 1.3);
        else spray(p.x, gy, p.z, -fwdx * (5 + rnd() * 5) + rs(), 0.6 + rnd(), -fwdz * (5 + rnd() * 5) + rs(), 0.7, 0.3, 1.2, 0.4);
      }
    }
    // Helicopter downwash: rings and dust / spray thrown outward.
    if (heli && (v.rotorSpeed || 0) > 0.5 && !v.wrecked && y < 22) {
      const k = (1 - y / 22) * clamp(v.rotorSpeed, 0, 1);
      const R = (spec.rotorRadius || 4) * 1.1;
      s.ring += dt * 3.2 * k;
      if (s.ring > 1) {
        s.ring -= 1;
        if (overGround) ring(v.x, gy, v.z, R * 0.5, R * 2.6, 1.0, 0.18 * k, 0.72, 0.66, 0.56);
        else ring(v.x, gy, v.z, R * 0.4, R * 2.4, 1.1, 0.55 * k);
      }
      s.acc += dt * 40 * k * qq;
      while (s.acc > 1) {
        s.acc -= 1;
        const a = rnd() * 6.283, r0 = R * (0.4 + rnd() * 0.6);
        const ox = Math.cos(a), oz = Math.sin(a);
        const sp = 5 + rnd() * 6;
        if (overGround) smoke(v.x + ox * r0, 0.2, v.z + oz * r0, ox * sp, 0.3 + rnd() * 0.6, oz * sp, 1.0 + rnd(), 0.5, 2.6, 0.24 * k, 0.68, 0.62, 0.54, 0.05, 1.4);
        else spray(v.x + ox * r0, gy, v.z + oz * r0, ox * sp, 0.8 + rnd() * 1.4, oz * sp, 0.7, 0.3, 1.3, 0.45 * k);
      }
    }
    // Touchdown puffs at the main gear.
    if (v.touchdown && !s.touch) {
      const sink = Math.abs(v.touchdownSpeed || 1);
      for (let si = 0; si < 2; si++) {
        const side = si === 0 ? 1 : -1;
        const p = toWorld(v, heli ? 0 : -0.5, side * 1.3);
        for (let i = 0; i < 5 * qq + sink; i++) {
          if (overGround) smoke(p.x + rs() * 0.3, 0.2, p.z + rs() * 0.3, (v.vx || 0) * 0.4 + rs() * 0.8, 0.4 + rnd() * 0.5, (v.vz || 0) * 0.4 + rs() * 0.8, 1.4 + rnd(), 0.4, 2.2, 0.4, 0.85, 0.85, 0.86, 0.2, 1.5);
          else spray(p.x, gy, p.z, (v.vx || 0) * 0.4 + rs() * 2, 1 + rnd() * 2, (v.vz || 0) * 0.4 + rs() * 2, 0.8, 0.3, 1.2, 0.55);
        }
      }
    }
    s.touch = !!v.touchdown;
    s.ph = v.heading;
    s.pp = v.pitch || 0;
    // Damage smoke.
    const hf = Math.max(0, (v.health || 0) / (spec.health || 1));
    if (hf < 0.35 || v.wrecked) {
      s.smoke += dt * (v.wrecked ? 12 : 6) * qq;
      while (s.smoke > 1) {
        s.smoke -= 1;
        const p = toWorld(v, (spec.length || 7) * 0.2, 0);
        const grey = v.wrecked ? 0.08 : 0.45;
        smoke(p.x, (v.mesh ? v.mesh.position.y : y) + 1.6, p.z, -fwdx * spd * 0.1 + rs() * 0.3, 1 + rnd(), -fwdz * spd * 0.1 + rs() * 0.3, 2.2, 0.5, 3, 0.5, grey, grey, grey, 1.1, 0.9);
      }
    }
  }

  // Lay one skid quad from the mark's last point to (x, z).
  function addSkid(m, x, z, dx, dz, len, hw, alpha) {
    const S = skids;
    const nx = -dz / len * hw, nz = dx / len * hw;
    const i = S.head;
    S.head = (S.head + 1) % MAX_SKID;
    const lx0 = Number.isFinite(m.lx) ? m.lx : m.x + nx, lz0 = Number.isFinite(m.lx) ? m.lz : m.z + nz;
    const rx0 = Number.isFinite(m.lx) ? m.rx : m.x - nx, rz0 = Number.isFinite(m.lx) ? m.rz : m.z - nz;
    const y = 0.03;
    const p = S.pos;
    const o = i * 12;
    p[o] = lx0; p[o + 1] = y; p[o + 2] = lz0;
    p[o + 3] = rx0; p[o + 4] = y; p[o + 5] = rz0;
    p[o + 6] = x - nx; p[o + 7] = y; p[o + 8] = z - nz;
    p[o + 9] = x + nx; p[o + 10] = y; p[o + 11] = z + nz;
    for (let k = 0; k < 4; k++) S.birth[i * 4 + k] = time;
    const e = S.edge;
    const prevA = Number.isFinite(m.a) ? m.a : alpha * 0.5;
    e[i * 8] = 0; e[i * 8 + 1] = prevA;
    e[i * 8 + 2] = 1; e[i * 8 + 3] = prevA;
    e[i * 8 + 4] = 1; e[i * 8 + 5] = alpha;
    e[i * 8 + 6] = 0; e[i * 8 + 7] = alpha;
    m.a = alpha;
    m.lx = x + nx; m.lz = z + nz;
    m.rx = x - nx; m.rz = z - nz;
    m.x = x; m.z = z;
    if (i < S.lo) S.lo = i;
    if (i > S.hi) S.hi = i;
    S.used = Math.min(MAX_SKID, S.used + 1);
  }

  // Transient glow sprites for lamps (rebuilt every frame).
  function lampGlows(m, pos, dat, col, vel) {
    if (!fx.enabled) return m;
    const vs = game.vehicles;
    const cx = camera.position.x, cz = camera.position.z;
    const max = B.max;
    for (let i = 0; i < vs.length && m < max - 4; i++) {
      const v = vs[i];
      if (v.kind !== 'car' || !v.mesh || v.wrecked) continue;
      const dx = v.x - cx, dz = v.z - cz;
      const d2 = dx * dx + dz * dz;
      if (d2 > 70 * 70) continue;
      const ud = v.mesh.userData;
      const an = ud.anchors;
      if (!an) continue;
      const brake = ud.brakeOn;
      const fade = 1 - smooth(45 * 45, 70 * 70, d2);
      const p = v.mesh.position;
      const c = Math.cos(v.heading), s = Math.sin(v.heading);
      // Tail / brake glows.
      const ta = (lit * 0.5 + (brake ? 0.55 + lit * 0.4 : 0)) * fade;
      if (ta > 0.03) {
        for (let si = 0; si < 2; si++) {
          const side = si === 0 ? 1 : -1;
          const lx = an.tail[0] - 0.05 + ud.tail.position.x, lz = an.tail[2] * side;
          const k = m * 3, k4 = m * 4;
          pos[k] = p.x + c * lx - s * lz; pos[k + 1] = an.tail[1]; pos[k + 2] = p.z + s * lx + c * lz;
          dat[k4] = brake ? 0.9 : 0.6; dat[k4 + 1] = ta; dat[k4 + 2] = 0; dat[k4 + 3] = 3;
          col[k] = 1; col[k + 1] = 0.12; col[k + 2] = 0.08;
          vel[k] = 0; vel[k + 1] = 0; vel[k + 2] = 0;
          m++;
        }
      }
      if (ud.reverseOn && fade > 0.05) {
        const lx = an.tail[0] - 0.05, k = m * 3, k4 = m * 4;
        pos[k] = p.x + c * lx; pos[k + 1] = an.tail[1]; pos[k + 2] = p.z + s * lx;
        dat[k4] = 0.9; dat[k4 + 1] = 0.5 * fade; dat[k4 + 2] = 0; dat[k4 + 3] = 3;
        col[k] = 1; col[k + 1] = 1; col[k + 2] = 1;
        vel[k] = 0; vel[k + 1] = 0; vel[k + 2] = 0;
        m++;
      }
      // Police light bar flashes.
      if (ud.bar && ud.sirenPhase >= 0 && m < max - 1) {
        const lz = ud.sirenPhase === 0 ? 0.27 : -0.27;
        const bx = ud.bar.position.x, by = ud.bar.position.y + 0.08;
        const k = m * 3, k4 = m * 4;
        pos[k] = p.x + c * bx - s * lz; pos[k + 1] = by; pos[k + 2] = p.z + s * bx + c * lz;
        dat[k4] = 1.6 + lit * 1.6; dat[k4 + 1] = 0.8 * fade; dat[k4 + 2] = 0; dat[k4 + 3] = 3;
        if (ud.sirenPhase === 0) { col[k] = 1; col[k + 1] = 0.12; col[k + 2] = 0.1; } else { col[k] = 0.15; col[k + 1] = 0.3; col[k + 2] = 1; }
        vel[k] = 0; vel[k + 1] = 0; vel[k + 2] = 0;
        m++;
      }
    }
    return m;
  }

  function updateShadows() {
    let n = 0;
    if (fx.shadows) {
      const vs = game.vehicles;
      const cx = camera.position.x, cz = camera.position.z;
      const M4 = shadows.instanceMatrix.array;
      for (let i = 0; i < vs.length && n < MAX_SHADOW; i++) {
        const v = vs[i];
        if (!v.mesh || v.kind === 'boat') continue;
        const dx = v.x - cx, dz = v.z - cz;
        const d2 = dx * dx + dz * dz;
        if (d2 > 110 * 110) continue;
        const air = v.kind === 'plane' || v.kind === 'heli';
        const y = air ? v.mesh.position.y : 0;
        if (air && (y > 12 || !isGround(v.x, v.z))) continue;
        const spec = v.spec;
        let L = spec.length * 1.08, Wd = spec.width * 1.2;
        if (air) {
          L = spec.length * 0.9;
          Wd = v.kind === 'heli' ? spec.length * 0.35 : spec.width * 0.6;
        }
        const op = (air ? 0.4 * (1 - y / 12) : 0.62) * (1 - smooth(80 * 80, 110 * 110, d2));
        const h = v.mesh.rotation.y;
        const c = Math.cos(h), s = Math.sin(h);
        const o = n * 16;
        // Matrix: rotate about y by h, scale (L, 1, W), translate.
        M4[o] = c * L; M4[o + 1] = 0; M4[o + 2] = -s * L; M4[o + 3] = 0;
        M4[o + 4] = 0; M4[o + 5] = 1; M4[o + 6] = 0; M4[o + 7] = 0;
        M4[o + 8] = s * Wd; M4[o + 9] = 0; M4[o + 10] = c * Wd; M4[o + 11] = 0;
        M4[o + 12] = v.mesh.position.x; M4[o + 13] = 0.025; M4[o + 14] = v.mesh.position.z; M4[o + 15] = 1;
        shOp.array[n] = op;
        n++;
      }
    }
    shadows.count = n;
    shadows.visible = n > 0;
    if (n > 0) {
      shadows.instanceMatrix.clearUpdateRanges();
      shadows.instanceMatrix.addUpdateRange(0, n * 16);
      shadows.instanceMatrix.needsUpdate = true;
      shOp.clearUpdateRanges();
      shOp.addUpdateRange(0, n);
      shOp.needsUpdate = true;
    }
  }

  function updateBeams() {
    const v = playerCraft();
    const on = fx.beams && lit > 0.05 && v && v.kind === 'car' && v.mesh && !v.wrecked;
    beams.visible = !!on;
    if (!on) return;
    beams.position.copy(v.mesh.position);
    beams.position.y = (v.mesh.userData.anchors.head[1] || 0.7);
    beams.rotation.set(0, v.mesh.rotation.y, 0);
    const an = v.mesh.userData.anchors;
    beams.position.x += Math.cos(v.heading) * an.head[0];
    beams.position.z += Math.sin(v.heading) * an.head[0];
    beams.scale.set(1, 1, (an.head[2] / 0.68));
    beamMat.uniforms.uI.value = 0.075 * lit * (v.mesh.userData.hf < 0.5 ? 0.6 : 1);
  }

  function updateEnv() {
    const env = game.envMap || null;
    if (scene.environment) {
      setVehicleEnvMap(null, 1);
      return;
    }
    if (env) {
      setVehicleEnvMap(env, 1);
      return;
    }
    if (!envFallback && game.renderer) {
      try {
        envFallback = fallbackEnv(game.renderer);
      } catch {
        envFallback = null;
      }
    }
    if (envFallback) setVehicleEnvMap(envFallback, 0.12 + 0.88 * (1 - night));
  }

  let envTick = 0;
  const sys = {
    name: 'effects',
    fx,
    // Turn the camera shake (impacts / speed) up or down; 0 disables.
    setShake(k) {
      fx.shake = k;
      if (game.chase && game.chase.setShake) game.chase.setShake(k);
    },
    counts() {
      return { alpha: A.n, additive: B.n, skids: skids.used, shadows: shadows.count };
    },
    fixedUpdate(dt) {
      if (!(dt > 0) || game.paused) return;
      time += dt;
      const qq = q();
      A.cap = Math.floor(MAX_ALPHA * qq);
      B.cap = Math.floor(MAX_ADD * qq);
      if (fx.enabled) {
        const vs = game.vehicles;
        const cx = camera.position.x, cz = camera.position.z;
        for (let i = 0; i < vs.length; i++) {
          const v = vs[i];
          if (!v.mesh || v.removed) continue;
          const dx = v.x - cx, dz = v.z - cz;
          const d2 = dx * dx + dz * dz;
          if (d2 > 160 * 160 || (v.asleep && !v.wrecked)) {
            const s0 = state.get(v);
            if (s0) {
              s0.pvx = v.vx || 0;
              s0.pvz = v.vz || 0;
              s0.marks[0].on = s0.marks[1].on = false;
            }
            continue;
          }
          const s = st(v);
          if (v.kind === 'car') carFx(v, s, dt, qq, d2);
          else if (v.kind === 'boat') boatFx(v, s, dt, qq, d2);
          else airFx(v, s, dt, qq, d2);
          s.pvx = v.vx || 0;
          s.pvz = v.vz || 0;
        }
      }
      stepPool(A, dt);
      stepPool(B, dt);
    },
    render() {
      const h = Number.isFinite(game.clock) ? game.clock : 12;
      night = nightAt(h);
      const w = game.weather || {};
      lit = clamp(Math.max(smooth(0.15, 0.6, night), (w.rain || 0) * 0.6, (w.fog || 0) * 0.5), 0, 1);
      setLampNight(Math.max(night, lit * 0.8));
      if ((envTick++ & 15) === 0) updateEnv();
      camera.updateMatrixWorld();
      A.mesh.material.uniforms.uLight.value = 0.3 + 0.7 * (1 - night * 0.85);
      writePool(A, camera, true, null);
      writePool(B, camera, false, lampGlows);
      // Skid marks: upload the touched range.
      const S = skids;
      S.mat.uniforms.uTime.value = time;
      if (S.hi >= S.lo) {
        for (let j = 0; j < 3; j++) {
          const a = S.attrs[j], size = S.sizes[j];
          a.clearUpdateRanges();
          a.addUpdateRange(S.lo * size, (S.hi - S.lo + 1) * size);
          a.needsUpdate = true;
        }
        S.lo = MAX_SKID;
        S.hi = -1;
      }
      S.mesh.visible = S.used > 0;
      updateShadows();
      updateBeams();
    },
    dispose() {
      for (const off of offs) off();
      for (const m of [A.mesh, B.mesh, skids.mesh, shadows, beams]) {
        scene.remove(m);
        m.geometry.dispose();
        m.material.dispose();
      }
      atlas.dispose();
      shTex.dispose();
    },
  };
  return sys;
}
