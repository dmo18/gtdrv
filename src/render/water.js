// Animated sea. A moderately tessellated patch follows the camera in
// snapped steps and is displaced in the vertex shader by the same wave
// table the boat physics uses, so boats sit on the visible waves. A big
// flat far plane sits just below the lowest trough and covers the rest
// of the sea; if the shader path fails it alone still reads as water.
// Also a pooled foam trail for boat wakes.
import * as THREE from 'three';
import { WAVES, waveHeight } from '../entities/boat.js';

const NEAR_SIZE = 400;
const NEAR_CELLS = 64;
const CELL = NEAR_SIZE / NEAR_CELLS;
const SHORE_N = 128; // texels per side of the shore map
const SHORE_CELL = 4; // meters per texel
const SHORE_SPAN = SHORE_N * SHORE_CELL;
const SHORE_NEG = 16; // the map holds distances from -16 m (land) ...
const SHORE_RANGE = 64; // ... to +48 m (sea)
const FAR_Y = -0.3; // just under the deepest trough (waves are +-0.24)
// The far plane stands FAR_DROP under the near patch's rim (0.13.9): the
// rim fades down to FAR_Y, and with the far plane at FAR_Y too the last
// meters of the patch, 200 m out, lay on it and fought for depth (a
// flickering square round the camera from a boat or the air).
export const FAR_DROP = 0.1;
export const FAR_PLANE_Y = FAR_Y - FAR_DROP, NEAR_RIM_Y = FAR_Y;

function glslFloat(v) {
  const s = String(+v);
  return /[.e]/.test(s) ? s : s + '.0';
}

// GLSL for the wave height and its gradient, generated from WAVES.
function waveGlsl() {
  let h = '';
  let gx = '';
  let gz = '';
  for (const w of WAVES) {
    const ph = `(${glslFloat(w.kx)} * p.x + ${glslFloat(w.kz)} * p.y + ${glslFloat(w.w)} * t)`;
    h += ` + ${glslFloat(w.a)} * sin${ph}`;
    gx += ` + ${glslFloat(w.a * w.kx)} * cos${ph}`;
    gz += ` + ${glslFloat(w.a * w.kz)} * cos${ph}`;
  }
  return `
uniform float uTime;
uniform vec2 uCenter;
varying float vRwH;
varying vec2 vRwP;
float rwWave(vec2 p, float t) { return 0.0${h}; }
vec2 rwGrad(vec2 p, float t) { return vec2(0.0${gx}, 0.0${gz}); }
// 1 in the middle of the patch, 0 at its rim, so the edge meets the
// flat far plane without a step.
float rwFade(vec2 p) {
  vec2 d = abs(p - uCenter) / ${glslFloat(NEAR_SIZE / 2)};
  float m = max(d.x, d.y);
  return 1.0 - smoothstep(0.65, 0.98, m);
}
`;
}

// Sea color with depth and light: looking steeply down you see into
// the water (deeper, greener); toward a glancing view it turns paler and
// bluer before the sky reflection (the environment map) takes over;
// slow large patches of lighter and darker water. Runs after the normal
// is known; vRwP is the world position on the sea.
const SEA_TONE = `
          {
            vec3 rwV = normalize(vViewPosition);
            float rwNdv = clamp(dot(normal, rwV), 0.0, 1.0);
            vec3 rwDeep = diffuseColor.rgb * vec3(0.55, 0.78, 0.8);
            vec3 rwPale = diffuseColor.rgb * vec3(1.05, 1.12, 1.12);
            diffuseColor.rgb = mix(rwPale, rwDeep, smoothstep(0.15, 0.85, rwNdv));
            float rwBig = sin(vRwP.x * 0.0041 + 1.3) * sin(vRwP.y * 0.0053 - 0.7) + 0.5 * sin((vRwP.x + vRwP.y) * 0.0097);
            diffuseColor.rgb *= 1.0 + 0.08 * rwBig;
          }`;

// Shore: a small scrolling distance map (see createShoreMap) gives the
// distance from the shoreline to every point of the sea near the camera.
// Shallow water turns lighter and greener, a bright lapping foam line
// runs along the seawall and the beach.
const SHORE_TONE = `
          {
            vec2 rwSu = (vRwP - uShoreOrg) / ${glslFloat(SHORE_SPAN)};
            // Fades out over the last tenth of the window: a hard cut drew a
            // straight seam across the shallows and the foam far out.
            vec2 rwE = min(rwSu, 1.0 - rwSu);
            float rwIn = smoothstep(0.01, 0.1, min(rwE.x, rwE.y)) * uShoreOn;
            float rwSd = texture2D(uShore, rwSu).r * ${glslFloat(SHORE_RANGE)} - ${glslFloat(SHORE_NEG)};
            float rwShallow = (1.0 - smoothstep(1.0, 26.0, rwSd)) * rwIn;
            diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.03, 0.3, 0.32), rwShallow * 0.3);
            float rwN = 0.5 + 0.5 * sin(vRwP.x * 0.8 + uTime * 0.5) * sin(vRwP.y * 1.1 - uTime * 0.3);
            float rwLap = 0.5 + 0.5 * sin(rwSd * 1.5 - uTime * 1.4 + rwN * 2.0);
            float rwFoamL = smoothstep(5.0, 0.0, rwSd) * (0.4 + 0.7 * rwLap) * (0.6 + 0.6 * rwN)
              + smoothstep(1.4, 0.1, rwSd) * 0.8;
            rwFoamL *= rwIn * step(-0.6, rwSd);
            diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.92, 0.97, 0.97), clamp(rwFoamL, 0.0, 0.9));
          }`;

// The near patch (waves, ripples, shore) and the far plane (the same tone,
// no waves) are one program: uRwNear (per material) switches the near
// parts on, so the far plane runs its old code and nothing else.
function makeSeaMaterial(params, uniforms, nearOn) {
  const mat = new THREE.MeshStandardMaterial(params);
  const uNear = { value: nearOn ? 1 : 0 };
  mat.onBeforeCompile = (shader) => {
    try {
      const vs = shader.vertexShader;
      const fs = shader.fragmentShader;
      if (!vs.includes('#include <beginnormal_vertex>') || !vs.includes('#include <begin_vertex>') ||
          !fs.includes('#include <color_fragment>') || !fs.includes('#include <normal_fragment_maps>')) return;
      shader.uniforms.uTime = uniforms.uTime;
      shader.uniforms.uCenter = uniforms.uCenter;
      shader.uniforms.uShore = uniforms.uShore;
      shader.uniforms.uShoreOrg = uniforms.uShoreOrg;
      shader.uniforms.uShoreOn = uniforms.uShoreOn;
      shader.uniforms.uRwNear = uNear;
      shader.vertexShader = 'uniform float uRwNear;\n' + waveGlsl() + vs
        .replace('#include <beginnormal_vertex>', `
          vec2 rwXZ = vec2(0.0);
          float rwF = 0.0;
          vec3 objectNormal;
          if (uRwNear > 0.5) {
            rwXZ = (modelMatrix * vec4(position, 1.0)).xz;
            rwF = rwFade(rwXZ);
            vec2 rwG = rwGrad(rwXZ, uTime) * rwF;
            objectNormal = normalize(vec3(-rwG.x, 1.0, -rwG.y));
          } else {
            objectNormal = vec3(normal);
          }
          #ifdef USE_TANGENT
            vec3 objectTangent = vec3(tangent.xyz);
          #endif`)
        .replace('#include <begin_vertex>', `
          vec3 transformed = vec3(position);
          vRwH = 0.0;
          if (uRwNear > 0.5) {
            float rwRaw = rwWave(rwXZ, uTime);
            vRwH = rwRaw;
            vRwP = rwXZ;
            transformed.y += mix(${glslFloat(FAR_Y)}, rwRaw, rwF);
          }`)
        .replace('#include <project_vertex>', '#include <project_vertex>\n  if (uRwNear < 0.5) vRwP = (modelMatrix * vec4(transformed, 1.0)).xz;');
      shader.fragmentShader = `
uniform float uTime;
uniform sampler2D uShore;
uniform vec2 uShoreOrg;
uniform float uShoreOn;
uniform float uRwNear;
varying float vRwH;
varying vec2 vRwP;
` + fs.replace('#include <color_fragment>', `
          #include <color_fragment>
          if (uRwNear > 0.5) {
            // Darker troughs, lighter crests with a hint of foam, and
            // broad slow patches so the sea is not one flat color.
            float rwT = clamp(vRwH / 0.24 * 0.5 + 0.5, 0.0, 1.0);
            diffuseColor.rgb *= mix(0.8, 1.12, rwT);
            float rwPatch = sin(vRwP.x * 0.013 + sin(vRwP.y * 0.011) * 1.7) * sin(vRwP.y * 0.017 - vRwP.x * 0.004);
            diffuseColor.rgb *= 1.0 + 0.06 * rwPatch;
            float rwFoam = smoothstep(0.19, 0.24, vRwH);
            diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.86, 0.93, 0.95), rwFoam * 0.35);
          }`).replace('#include <normal_fragment_maps>', `
          #include <normal_fragment_maps>
          if (uRwNear > 0.5) {
            float rwD = length(vViewPosition);
            // Gone by 75 m: further out the 1 to 4 m ripples are under a
            // pixel at phone size and alias into rings (0.13.5).
            float rwK = 1.0 - smoothstep(18.0, 75.0, rwD);
            vec2 q = vRwP;
            float t = uTime;
            vec2 g = vec2(0.0);
            g += vec2(0.9, 0.4) * cos(dot(q, vec2(0.9, 0.4)) * 1.7 + t * 2.1) * 0.05;
            g += vec2(-0.3, 1.0) * cos(dot(q, vec2(-0.3, 1.0)) * 2.9 + t * 2.7) * 0.035;
            g += vec2(0.7, -0.7) * cos(dot(q, vec2(0.7, -0.7)) * 4.3 + t * 3.3) * 0.025;
            g += vec2(-0.95, -0.2) * cos(dot(q, vec2(-0.95, -0.2)) * 6.1 + t * 4.1) * 0.018;
            vec3 rwOff = (viewMatrix * vec4(-g.x, 0.0, -g.y, 0.0)).xyz;
            normal = normalize(normal + rwOff * rwK);
          }
          ${SEA_TONE}
          if (uRwNear > 0.5) ${SHORE_TONE}`);
    } catch {
      // Leave the stock shader: a flat colored plane.
    }
  };
  mat.customProgramCacheKey = () => 'rustwater-sea-v5';
  return mat;
}

// PBR so the sea mirrors the sky (scene.environment) with a Fresnel edge
// and a sun glint; a few small ripples perturb the normal near the camera.
function makeNearMaterial(color, uniforms) {
  return makeSeaMaterial({ color, roughness: 0.16, metalness: 0, envMapIntensity: 1.15 }, uniforms, true);
}

// The far sea: a plain plane with the same tone (no waves).
function makeFarMaterial(color, uniforms) {
  return makeSeaMaterial({ color, roughness: 0.2, metalness: 0, envMapIntensity: 1.1 }, uniforms, false);
}

// A scrolling window (SHORE_SPAN meters) of distance-to-shore round the
// camera, in two textures: one is shown while the other is filled a few
// rows a frame, then they swap. Nothing is allocated after creation.
function createShoreMap(uniforms) {
  const tex = [0, 1].map(() => {
    const t = new THREE.DataTexture(new Uint8Array(SHORE_N * SHORE_N), SHORE_N, SHORE_N, THREE.RedFormat, THREE.UnsignedByteType);
    t.magFilter = THREE.LinearFilter;
    t.minFilter = THREE.LinearFilter;
    t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
    t.generateMipmaps = false;
    t.needsUpdate = true;
    return t;
  });
  let shown = 0;
  let fn = null;
  let ox = 0, oz = 0; // origin of the shown map
  let tx = 0, tz = 0, row = -1; // target origin and next row (-1 = idle)
  let have = false;
  uniforms.uShore.value = tex[0];
  function begin(x, z) {
    tx = Math.round((x - SHORE_SPAN / 2) / 16) * 16;
    tz = Math.round((z - SHORE_SPAN / 2) / 16) * 16;
    row = 0;
  }
  function update(camX, camZ, shoreDist) {
    if (shoreDist !== fn) {
      fn = shoreDist;
      have = false;
      uniforms.uShoreOn.value = 0;
      row = -1;
    }
    if (!fn) return;
    if (row < 0 && (!have || Math.abs(camX - (ox + SHORE_SPAN / 2)) > 90 || Math.abs(camZ - (oz + SHORE_SPAN / 2)) > 90)) begin(camX, camZ);
    if (row < 0) return;
    const back = tex[1 - shown];
    const data = back.image.data;
    const end = Math.min(SHORE_N, row + (have ? 16 : 64));
    for (; row < end; row++) {
      const z = tz + (row + 0.5) * SHORE_CELL;
      for (let i = 0; i < SHORE_N; i++) {
        const d = -fn(tx + (i + 0.5) * SHORE_CELL, z);
        const v = (d + SHORE_NEG) / SHORE_RANGE;
        data[row * SHORE_N + i] = (v < 0 ? 0 : v > 1 ? 255 : v * 255) | 0;
      }
    }
    if (row >= SHORE_N) {
      back.needsUpdate = true;
      shown = 1 - shown;
      ox = tx; oz = tz; have = true; row = -1;
      uniforms.uShore.value = back;
      uniforms.uShoreOrg.value.set(ox, oz);
      uniforms.uShoreOn.value = 1;
    }
  }
  return { update };
}

export function createWater({ size = 9000, color = 0x1f8aa0, shoreDist = null } = {}) {
  const col = new THREE.Color().setHex(color, THREE.SRGBColorSpace);
  const group = new THREE.Group();
  group.name = 'sea';

  const farGeo = new THREE.PlaneGeometry(size, size, 1, 1);
  farGeo.rotateX(-Math.PI / 2);
  // Slightly darker than the near patch average so the hand-off is soft.
  const farCol = col.clone().multiplyScalar(0.92);
  const uniforms = {
    uTime: { value: 0 }, uCenter: { value: new THREE.Vector2() },
    uShore: { value: null }, uShoreOrg: { value: new THREE.Vector2() }, uShoreOn: { value: 0 },
  };
  const far = new THREE.Mesh(farGeo, makeFarMaterial(farCol, uniforms));
  far.position.y = FAR_PLANE_Y;
  far.name = 'sea-far';
  far.renderOrder = -2;
  group.add(far);

  const shore = createShoreMap(uniforms);
  const nearGeo = new THREE.PlaneGeometry(NEAR_SIZE, NEAR_SIZE, NEAR_CELLS, NEAR_CELLS);
  nearGeo.rotateX(-Math.PI / 2);
  if (nearGeo.attributes.uv) nearGeo.deleteAttribute('uv');
  // Generous bounds: the patch moves with the camera and is displaced.
  nearGeo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), NEAR_SIZE * 0.75);
  const near = new THREE.Mesh(nearGeo, makeNearMaterial(col, uniforms));
  near.name = 'sea-near';
  near.renderOrder = -1;
  group.add(near);

  function update(time, cameraPos) {
    uniforms.uTime.value = Number.isFinite(time) ? time : 0;
    if (!cameraPos) return;
    // Snap to whole cells so vertices do not swim across the waves.
    const sx = Math.round(cameraPos.x / CELL) * CELL;
    const sz = Math.round(cameraPos.z / CELL) * CELL;
    near.position.set(sx, 0, sz);
    uniforms.uCenter.value.set(sx, sz);
    // The far plane only needs coarse following.
    // The city's shore function: given, or found on the running game.
    let sd = shoreDist;
    if (!sd) {
      const g = typeof globalThis !== 'undefined' ? globalThis.__rw : null;
      if (g && g.city && typeof g.city.shoreDist === 'function') sd = g.city.shoreDist;
    }
    shore.update(cameraPos.x, cameraPos.z, sd);
    const fs = 500;
    far.position.set(Math.round(cameraPos.x / fs) * fs, FAR_PLANE_Y, Math.round(cameraPos.z / fs) * fs);
  }

  return { mesh: group, near, far, update };
}

// ---- wake foam ------------------------------------------------------------
// One wake slice: a soft oval of churned water on the track plus two
// foam crests at z = +-1 (the arms of the V). Instances are scaled
// sideways as they age, so consecutive slices fan out into a V wake.
// White centers fade to black at the rims, drawn additively, so black
// adds nothing and fading the instance color fades the foam.
function foamGeometry() {
  const seg = 12;
  const pos = [];
  const colr = [];
  const idx = [];
  const blob = (cz, rx, rz, c) => {
    const base = pos.length / 3;
    pos.push(0, 0, cz);
    colr.push(c, c, c);
    for (let i = 0; i < seg; i++) {
      const a = (i / seg) * Math.PI * 2;
      pos.push(Math.cos(a) * rx, 0, cz + Math.sin(a) * rz);
      colr.push(0, 0, 0);
    }
    for (let i = 0; i < seg; i++) idx.push(base, base + 1 + ((i + 1) % seg), base + 1 + i);
  };
  blob(0, 0.5, 0.5, 1);
  blob(1, 0.5, 0.12, 0.7);
  blob(-1, 0.5, 0.12, 0.7);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(colr, 3));
  g.setIndex(idx);
  return g;
}

export function createWakeTrail(scene, max = 160) {
  const mat = new THREE.MeshBasicMaterial({
    vertexColors: true, transparent: true, depthWrite: false,
    blending: THREE.AdditiveBlending, fog: false,
  });
  const mesh = new THREE.InstancedMesh(foamGeometry(), mat, max);
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.frustumCulled = false;
  mesh.renderOrder = 1;
  mesh.name = 'wake';
  const colors = new Float32Array(max * 3);
  mesh.instanceColor = new THREE.InstancedBufferAttribute(colors, 3);
  mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
  if (scene) scene.add(mesh);

  const px = new Float32Array(max), pz = new Float32Array(max), ph = new Float32Array(max);
  const age = new Float32Array(max), life = new Float32Array(max), str = new Float32Array(max);
  for (let i = 0; i < max; i++) age[i] = life[i] = 1;
  let head = 0;
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const p = new THREE.Vector3();
  const sc = new THREE.Vector3();

  function emit(x, z, heading, strength = 1) {
    const s = Math.min(1, Math.max(0, +strength || 0));
    if (!(s > 0.01) || !Number.isFinite(x + z + heading)) return;
    const i = head;
    head = (head + 1) % max;
    px[i] = x;
    pz[i] = z;
    ph[i] = heading;
    str[i] = s;
    age[i] = 0;
    life[i] = 2.2 + 3.6 * s;
  }

  function update(dt, time) {
    for (let i = 0; i < max; i++) {
      if (age[i] < life[i]) age[i] += dt;
      const t = age[i] / life[i];
      if (t >= 1) {
        sc.set(0, 0, 0);
        colors[i * 3] = colors[i * 3 + 1] = colors[i * 3 + 2] = 0;
      } else {
        const k = 1 - t;
        const c = 0.3 * str[i] * k * k;
        colors[i * 3] = c * 0.92;
        colors[i * 3 + 1] = c;
        colors[i * 3 + 2] = c;
        // Long along the track; the crests run out sideways as it ages
        // (about the Kelvin angle behind a boat moving at full wake).
        sc.set(5.5 + 3 * t, 1, (1.2 + 14 * t * life[i] * 0.35) * (0.4 + 0.6 * str[i]));
      }
      q.setFromAxisAngle(up, -ph[i]);
      p.set(px[i], waveHeight(px[i], pz[i], time) + 0.08, pz[i]);
      m4.compose(p, q, sc);
      mesh.setMatrixAt(i, m4);
    }
    mesh.instanceMatrix.needsUpdate = true;
    mesh.instanceColor.needsUpdate = true;
  }

  update(0, 0);
  return { mesh, emit, update };
}
