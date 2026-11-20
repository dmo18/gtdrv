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
const FAR_Y = -0.3; // just under the deepest trough (waves are +-0.24)

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
uniform vec2 uCentre;
varying float vRwH;
varying vec2 vRwP;
float rwWave(vec2 p, float t) { return 0.0${h}; }
vec2 rwGrad(vec2 p, float t) { return vec2(0.0${gx}, 0.0${gz}); }
// 1 in the middle of the patch, 0 at its rim, so the edge meets the
// flat far plane without a step.
float rwFade(vec2 p) {
  vec2 d = abs(p - uCentre) / ${glslFloat(NEAR_SIZE / 2)};
  float m = max(d.x, d.y);
  return 1.0 - smoothstep(0.65, 0.98, m);
}
`;
}

function makeNearMaterial(color, uniforms) {
  const mat = new THREE.MeshLambertMaterial({ color });
  mat.onBeforeCompile = (shader) => {
    try {
      const vs = shader.vertexShader;
      const fs = shader.fragmentShader;
      if (!vs.includes('#include <beginnormal_vertex>') || !vs.includes('#include <begin_vertex>') ||
          !fs.includes('#include <color_fragment>')) return;
      shader.uniforms.uTime = uniforms.uTime;
      shader.uniforms.uCentre = uniforms.uCentre;
      shader.vertexShader = waveGlsl() + vs
        .replace('#include <beginnormal_vertex>', `
          vec2 rwXZ = (modelMatrix * vec4(position, 1.0)).xz;
          float rwF = rwFade(rwXZ);
          vec2 rwG = rwGrad(rwXZ, uTime) * rwF;
          vec3 objectNormal = normalize(vec3(-rwG.x, 1.0, -rwG.y));
          #ifdef USE_TANGENT
            vec3 objectTangent = vec3(tangent.xyz);
          #endif`)
        .replace('#include <begin_vertex>', `
          vec3 transformed = vec3(position);
          float rwRaw = rwWave(rwXZ, uTime);
          vRwH = rwRaw;
          vRwP = rwXZ;
          transformed.y += mix(${glslFloat(FAR_Y)}, rwRaw, rwF);`);
      shader.fragmentShader = `
varying float vRwH;
varying vec2 vRwP;
` + fs.replace('#include <color_fragment>', `
          #include <color_fragment>
          {
            // Darker troughs, lighter crests with a hint of foam, and
            // broad slow patches so the sea is not one flat colour.
            float rwT = clamp(vRwH / 0.24 * 0.5 + 0.5, 0.0, 1.0);
            diffuseColor.rgb *= mix(0.8, 1.12, rwT);
            float rwPatch = sin(vRwP.x * 0.013 + sin(vRwP.y * 0.011) * 1.7) * sin(vRwP.y * 0.017 - vRwP.x * 0.004);
            diffuseColor.rgb *= 1.0 + 0.06 * rwPatch;
            float rwFoam = smoothstep(0.19, 0.24, vRwH);
            diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.86, 0.93, 0.95), rwFoam * 0.35);
          }`);
    } catch {
      // Leave the stock Lambert shader: a flat coloured plane.
    }
  };
  mat.customProgramCacheKey = () => 'rustwater-sea-v1';
  return mat;
}

export function createWater({ size = 9000, color = 0x2a7c9e } = {}) {
  const col = new THREE.Color().setHex(color, THREE.SRGBColorSpace);
  const group = new THREE.Group();
  group.name = 'sea';

  const farGeo = new THREE.PlaneGeometry(size, size, 1, 1);
  farGeo.rotateX(-Math.PI / 2);
  // Slightly darker than the near patch average so the hand-off is soft.
  const farCol = col.clone().multiplyScalar(0.92);
  const far = new THREE.Mesh(farGeo, new THREE.MeshLambertMaterial({ color: farCol }));
  far.position.y = FAR_Y;
  far.name = 'sea-far';
  far.renderOrder = -2;
  group.add(far);

  const uniforms = { uTime: { value: 0 }, uCentre: { value: new THREE.Vector2() } };
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
    uniforms.uCentre.value.set(sx, sz);
    // The far plane only needs coarse following.
    const fs = 500;
    far.position.set(Math.round(cameraPos.x / fs) * fs, FAR_Y, Math.round(cameraPos.z / fs) * fs);
  }

  return { mesh: group, near, far, update };
}

// ---- wake foam ------------------------------------------------------------
// Soft oval: white centre fading to black at the rim, drawn additively,
// so black adds nothing and fading the instance colour fades the foam.
function foamGeometry() {
  const seg = 12;
  const pos = [0, 0, 0];
  const colr = [1, 1, 1];
  for (let i = 0; i < seg; i++) {
    const a = (i / seg) * Math.PI * 2;
    pos.push(Math.cos(a) * 0.5, 0, Math.sin(a) * 0.5);
    colr.push(0, 0, 0);
  }
  const idx = [];
  for (let i = 0; i < seg; i++) idx.push(0, 1 + ((i + 1) % seg), 1 + i);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(colr, 3));
  g.setIndex(idx);
  return g;
}

export function createWakeTrail(scene, max = 64) {
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
    life[i] = 1.6 + 2.4 * s;
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
        const c = 0.45 * str[i] * k * k;
        colors[i * 3] = c * 0.92;
        colors[i * 3 + 1] = c;
        colors[i * 3 + 2] = c;
        // Long along the track, spreading sideways as it ages.
        sc.set(3 + 2 * t, 1, (0.8 + 3.2 * t) * (0.5 + 0.5 * str[i]));
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
