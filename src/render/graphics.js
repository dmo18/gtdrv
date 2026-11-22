// Renderer-level look of the game: filmic tone mapping, one sun/moon
// shadow map that follows the camera, sky reflections (environment map
// rebuilt when the time of day moves on), height-aware haze, optional
// night bloom, live traffic-light lamps and the quality tiers.
// It also owns the adaptive render resolution (see adaptres.js) and the
// shader warm-up on the first draw, so no material compiles mid-play.
// Call createGraphics(game) once, after the city mesh and the day/night
// system exist.
import * as THREE from 'three';
import { signalState } from '../world/citygen.js';
import { createAdaptiveRes, maxRatioFor } from './adaptres.js';
import { vehicleStats } from './vehiclemesh.js';
import { VEHICLE_SPECS } from '../entities/vehicle.js';
import { makeWindowAtlas } from './textures.js';
import { patchWindows, bakeLampLight, patchLampLight, setSpotLight, CARS } from './nightlights.js';
import { setBeamDaylight, BEAM_TAN } from './aircraftmesh.js';

const SKY_VS = `
varying vec3 vDir;
void main() {
  vDir = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;
// A small copy of the sky dome for reflections, with dark ground below.
const SKY_FS = `
uniform vec3 uZenith;
uniform vec3 uHorizon;
uniform vec3 uGround;
uniform vec3 uSunDir;
uniform vec3 uSunCol;
uniform float uGlow;
varying vec3 vDir;
void main() {
  vec3 d = normalize(vDir);
  float up = clamp(d.y, 0.0, 1.0);
  vec3 col = mix(uHorizon, uZenith, pow(up, 0.55));
  float s = max(dot(d, uSunDir), 0.0);
  col += uSunCol * uGlow * (pow(s, 8.0) * 0.5 + pow(s, 96.0) * 3.0) * smoothstep(-0.1, 0.05, d.y);
  col = mix(uGround, col, smoothstep(-0.12, 0.02, d.y));
  gl_FragColor = vec4(col, 1.0);
}`;

const QUAD_VS = `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}`;
const BRIGHT_FS = `
uniform sampler2D tMap;
uniform float uThreshold;
varying vec2 vUv;
void main() {
  vec3 c = texture2D(tMap, vUv).rgb;
  float l = max(c.r, max(c.g, c.b));
  gl_FragColor = vec4(c * smoothstep(uThreshold, 1.0, l), 1.0);
}`;
const BLUR_FS = `
uniform sampler2D tMap;
uniform vec2 uStep;
varying vec2 vUv;
void main() {
  vec3 c = texture2D(tMap, vUv).rgb * 0.294;
  c += texture2D(tMap, vUv + uStep * 1.333).rgb * 0.353;
  c += texture2D(tMap, vUv - uStep * 1.333).rgb * 0.353;
  gl_FragColor = vec4(c, 1.0);
}`;
const ADD_FS = `
uniform sampler2D tMap;
uniform float uStrength;
varying vec2 vUv;
void main() {
  gl_FragColor = vec4(texture2D(tMap, vUv).rgb * uStrength, 1.0);
}`;

let patched = false;
// Applies to every lit material in the game: haze thins with height and
// cast shadows fade out toward the edge of the shadow map.
function patchShaderChunks() {
  if (patched) return;
  patched = true;
  const SC = THREE.ShaderChunk;
  SC.fog_pars_vertex = SC.fog_pars_vertex.replace('varying float vFogDepth;', 'varying float vFogDepth;\n\tvarying float vFogH;');
  SC.fog_vertex = SC.fog_vertex.replace('vFogDepth = - mvPosition.z;',
    'vFogDepth = - mvPosition.z;\n\tvFogH = cameraPosition.y + 0.5 * dot( viewMatrix[ 1 ].xyz, mvPosition.xyz );');
  SC.fog_pars_fragment = SC.fog_pars_fragment.replace('varying float vFogDepth;', 'varying float vFogDepth;\n\tvarying float vFogH;');
  SC.fog_fragment = SC.fog_fragment.replace('float fogFactor = smoothstep( fogNear, fogFar, vFogDepth );',
    'float fogFactor = smoothstep( fogNear, fogFar, vFogDepth );\n\t\tfogFactor *= mix( exp( - max( vFogH, 0.0 ) * 0.006 ), 1.0, fogFactor * fogFactor );');
  SC.shadowmap_pars_fragment = SC.shadowmap_pars_fragment.replace('return mix( 1.0, shadow, shadowIntensity );',
    'vec2 rwEdge = abs( shadowCoord.xy - 0.5 ) * 2.0;\n\t\t\treturn mix( 1.0, shadow, shadowIntensity * ( 1.0 - smoothstep( 0.75, 0.98, max( rwEdge.x, rwEdge.y ) ) ) );');
  // Colour grade folded into the tone curve (no extra pass): ACES filmic,
  // a little more saturation, cool shadows and warm highlights.
  SC.tonemapping_pars_fragment = SC.tonemapping_pars_fragment.replace('vec3 CustomToneMapping( vec3 color ) { return color; }', `vec3 CustomToneMapping( vec3 color ) {
	vec3 c = ACESFilmicToneMapping( color );
	float l = dot( c, vec3( 0.2126, 0.7152, 0.0722 ) );
	c = max( mix( vec3( l ), c, 1.15 ), 0.0 );
	vec3 tint = mix( vec3( 0.95, 0.985, 1.07 ), vec3( 1.0 ), smoothstep( 0.0, 0.05, l ) );
	c *= mix( tint, vec3( 1.07, 1.01, 0.9 ), smoothstep( 0.04, 0.55, l ) );
	return clamp( c, 0.0, 1.0 );
}`);
}

export function createGraphics(game) {
  if (game.graphics) return game.graphics;
  const { renderer, scene, camera } = game;
  const ud = (game.cityMesh && game.cityMesh.userData) || {};
  const sun = game.lights.sun;
  const t0 = performance.now();

  patchShaderChunks();
  renderer.toneMapping = THREE.CustomToneMapping;
  renderer.toneMappingExposure = 1.0;
  // A stronger sun against weaker fill light, so shade reads as shade.
  // At night the fill drops further, so lamps, windows and headlights
  // carry the picture and shade is a deep blue, not a flat grey.
  game.lightScale = { sun: 2.9, moon: 1.3, hemi: 0.26, hemiNight: 0.36, glow: 1.0 };

  // ---- shadows ----
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  sun.castShadow = true;
  sun.shadow.radius = 1.6;
  scene.add(sun.target);
  const sc = sun.shadow.camera;
  let extent = 72, mapSize = 0;
  const dir = new THREE.Vector3(), right = new THREE.Vector3(), upv = new THREE.Vector3(), focus = new THREE.Vector3(), view = new THREE.Vector3();
  const UP = new THREE.Vector3(0, 1, 0);

  function updateShadow(sky) {
    const inten = sky ? sky.shadow : 1;
    // castShadow stays on: switching it would recompile every lit
    // material (a long hitch at each sunrise and sunset). While the light
    // swings over, the map is simply not redrawn and fades to nothing.
    sun.shadow.intensity = inten > 0.03 ? Math.min(1, inten) : 0;
    // Shedding its last step, the shadow map is redrawn every other frame.
    renderer.shadowMap.autoUpdate = inten > 0.03 && !(shedApplied >= 2 && (frame & 1));
    if (inten <= 0.03) return;
    if (sky) dir.copy(sky.lightDir);
    else dir.copy(sun.position).normalize();
    // Cover the ground ahead of the camera; wider from the air.
    const h = Math.max(0, camera.position.y);
    const want = h > 190 ? 280 : h > 110 ? 200 : h > 55 ? 130 : h > 26 ? 96 : 72;
    if (want > extent || want < extent * 0.6 || h < 20) extent = h < 20 ? 72 : want;
    camera.getWorldDirection(view);
    let t = extent * 0.62;
    if (view.y < -0.05) t = Math.min(t + h, h / -view.y);
    focus.copy(camera.position).addScaledVector(view, t);
    focus.y = 0;
    right.crossVectors(UP, dir).normalize();
    upv.crossVectors(dir, right);
    // Snap to whole shadow texels so edges do not crawl as we move.
    const texel = (2 * extent) / mapSize;
    const r = Math.round(focus.dot(right) / texel) * texel, u = Math.round(focus.dot(upv) / texel) * texel, d = Math.round(focus.dot(dir));
    focus.set(0, 0, 0).addScaledVector(right, r).addScaledVector(upv, u).addScaledVector(dir, d);
    const slope = Math.sqrt(Math.max(0, 1 - dir.y * dir.y)) / Math.max(0.15, dir.y);
    const D = Math.min(900, 170 / Math.max(0.15, dir.y) + 60);
    sun.target.position.copy(focus);
    sun.position.copy(focus).addScaledVector(dir, D);
    const far = D + extent * slope + 30;
    if (sc.right !== extent || Math.abs(sc.far - far) > 1) {
      sc.left = -extent; sc.right = extent; sc.top = extent; sc.bottom = -extent;
      sc.near = 1; sc.far = far;
      sc.updateProjectionMatrix();
      sun.shadow.bias = -0.06 / (far - 1);
      sun.shadow.normalBias = texel * 0.9;
    }
  }
  function setShadowSize(size) {
    if (size === mapSize) return;
    mapSize = size;
    sun.shadow.mapSize.set(size, size);
    // Softer edges near the camera: the PCF taps spread over more texels
    // on the big map (2048 over 144 m: about 16 cm of blur).
    sun.shadow.radius = size >= 2048 ? 2.3 : 1.6;
    if (sun.shadow.map) {
      sun.shadow.map.dispose();
      sun.shadow.map = null;
    }
    sc.right = 0; // force a refresh of the bias
  }
  function markCasters() {
    const vs = game.vehicles;
    for (let i = 0; i < vs.length; i++) {
      const m = vs[i].mesh;
      if (!m || m.userData.rwShadow) continue;
      m.userData.rwShadow = true;
      m.traverse((o) => {
        if (o.isMesh && o.material && !o.material.transparent) o.castShadow = true;
      });
    }
  }

  // ---- sky reflections ----
  const pmrem = new THREE.PMREMGenerator(renderer);
  const skyU = {
    uZenith: { value: new THREE.Color() }, uHorizon: { value: new THREE.Color() }, uGround: { value: new THREE.Color() },
    uSunDir: { value: new THREE.Vector3(0, 1, 0) }, uSunCol: { value: new THREE.Color() }, uGlow: { value: 1 },
  };
  const skyScene = new THREE.Scene();
  skyScene.add(new THREE.Mesh(new THREE.SphereGeometry(5, 24, 12), new THREE.ShaderMaterial({ uniforms: skyU, vertexShader: SKY_VS, fragmentShader: SKY_FS, side: THREE.BackSide, depthWrite: false })));
  let envRT = null, envClock = -99, envKey = -1;
  function updateEnv(sky, force) {
    const key = Math.round(sky.overcast * 6) * 100 + Math.round(sky.fogAmount * 6) * 10 + Math.round(sky.rain * 4);
    let dc = Math.abs(game.clock - envClock);
    if (dc > 12) dc = 24 - dc;
    // Dawn and dusk move fast; the middle of the day barely changes.
    const stepH = sky.night > 0.02 && sky.night < 0.98 ? 0.12 : 0.6;
    if (!force && key === envKey && dc < stepH) return;
    envKey = key;
    envClock = game.clock;
    skyU.uZenith.value.copy(sky.zenith);
    skyU.uHorizon.value.copy(sky.horizon);
    // City glow low in the night sky: what wet streets and glass pick up.
    skyU.uHorizon.value.r += 0.09 * sky.lit;
    skyU.uHorizon.value.g += 0.06 * sky.lit;
    skyU.uHorizon.value.b += 0.045 * sky.lit;
    // The ground as the sky sees it: lit streets by day, lamp glow by night.
    skyU.uGround.value.copy(sky.horizon).multiplyScalar(0.3).addScalar(0.012 * sky.lit);
    skyU.uSunDir.value.copy(sky.sunDir);
    skyU.uSunCol.value.copy(sky.sunColor);
    skyU.uGlow.value = sky.glow;
    const tm = renderer.toneMapping;
    renderer.toneMapping = THREE.NoToneMapping;
    const rt = pmrem.fromScene(skyScene, 0, 0.1, 20);
    renderer.toneMapping = tm;
    scene.environment = rt.texture;
    game.envMap = rt.texture;
    if (envRT) envRT.dispose();
    envRT = rt;
  }
  scene.environmentIntensity = 0.5;

  // ---- bloom: lamps, lit windows and the sun bleed a little ----
  const bloom = { on: false, ok: true, fb: null, a: null, b: null, c: null };
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2));
  quad.frustumCulled = false;
  const quadCam = new THREE.Camera();
  const pass = (fs, uniforms, extra = {}) => new THREE.ShaderMaterial({ uniforms, vertexShader: QUAD_VS, fragmentShader: fs, depthTest: false, depthWrite: false, toneMapped: false, ...extra });
  const brightMat = pass(BRIGHT_FS, { tMap: { value: null }, uThreshold: { value: 0.8 } });
  const blurMat = pass(BLUR_FS, { tMap: { value: null }, uStep: { value: new THREE.Vector2() } });
  const addMat = pass(ADD_FS, { tMap: { value: null }, uStrength: { value: 0.5 } }, { blending: THREE.AdditiveBlending, transparent: true });
  const size = new THREE.Vector2();
  function sizeBloom() {
    renderer.getDrawingBufferSize(size);
    const w = Math.max(8, size.x | 0), h = Math.max(8, size.y | 0);
    for (const k of ['fb', 'a', 'b', 'c']) if (bloom[k]) bloom[k].dispose();
    bloom.fb = new THREE.FramebufferTexture(w, h);
    bloom.fb.minFilter = bloom.fb.magFilter = THREE.LinearFilter;
    const rt = (d) => new THREE.WebGLRenderTarget(Math.max(4, (w / d) | 0), Math.max(4, (h / d) | 0), { depthBuffer: false });
    bloom.a = rt(2);
    bloom.b = rt(4);
    bloom.c = rt(4);
  }
  function drawPass(mat, target) {
    quad.material = mat;
    renderer.setRenderTarget(target);
    renderer.render(quad, quadCam);
  }
  function renderFrame() {
    renderer.render(scene, camera);
    sys.calls = renderer.info.render.calls;
    sys.triangles = renderer.info.render.triangles;
    if (!bloom.on) return;
    const sky = game.daynight && game.daynight.sky;
    const lit = sky ? sky.lit : 0;
    renderer.copyFramebufferToTexture(bloom.fb);
    const sm = renderer.shadowMap.autoUpdate;
    renderer.shadowMap.autoUpdate = false;
    brightMat.uniforms.tMap.value = bloom.fb;
    brightMat.uniforms.uThreshold.value = 0.92 - 0.22 * lit;
    drawPass(brightMat, bloom.a);
    blurMat.uniforms.tMap.value = bloom.a.texture;
    blurMat.uniforms.uStep.value.set(1 / bloom.b.width, 0);
    drawPass(blurMat, bloom.b);
    blurMat.uniforms.tMap.value = bloom.b.texture;
    blurMat.uniforms.uStep.value.set(0, 1 / bloom.c.height);
    drawPass(blurMat, bloom.c);
    addMat.uniforms.tMap.value = bloom.c.texture;
    addMat.uniforms.uStrength.value = 0.22 + 0.33 * lit;
    const ac = renderer.autoClear;
    renderer.autoClear = false;
    drawPass(addMat, null);
    renderer.autoClear = ac;
    renderer.shadowMap.autoUpdate = sm;
  }
  game.resizeHooks.push(() => {
    if (bloom.on) sizeBloom();
  });

  // ---- lit windows: per-window rooms from one shared atlas ----
  const win = ud.materials ? patchWindows(ud.materials, makeWindowAtlas(game.city ? game.city.seed + 31 : 31)) : null;

  // ---- street lamp pools, baked into one light map ----
  const baked = ud.materials && ud.lamps ? bakeLampLight(ud.lamps, ud.glows || []) : null;
  let lampU = null;
  if (baked) {
    const M = ud.materials;
    lampU = patchLampLight([M.asphaltMat, M.pavementMat, M.grassMat, M.landMat, M.sandMat, ...(M.lotSandMat ? [M.lotSandMat] : []), M.groundMat, M.paintMat, M.decalMat, M.plainMat, M.woodMat, M.shopfront], baked);
    ud.lampLightBaked = true; // the day/night system drops its pool decals
  }

  // ---- traffic-light lamps ----
  const sig = ud.signals && ud.signals.mesh ? ud.signals : null;
  // A streamed map refills the bulb list as tiles come and go (sig.cap
  // slots, sig.version counts the refills).
  const sigState = sig ? new Uint8Array(sig.cap || sig.bulbs.length).fill(2) : null;
  let sigVersion = sig ? sig.version : 0;
  const ON = [new THREE.Color(1, 0.1, 0.06), new THREE.Color(1, 0.6, 0.04), new THREE.Color(0.1, 1, 0.42)];
  const OFF = [new THREE.Color(0.07, 0.015, 0.012), new THREE.Color(0.07, 0.045, 0.01), new THREE.Color(0.012, 0.06, 0.03)];
  const LAMP = { red: 0, amber: 1, green: 2 };
  function updateSignals() {
    if (!sig) return;
    if (sig.version !== sigVersion) {
      sigVersion = sig.version;
      sigState.fill(2);
    }
    const bulbs = sig.bulbs, nodes = game.city.nodes;
    let dirty = false;
    for (let i = 0; i < bulbs.length; i++) {
      const b = bulbs[i];
      const on = LAMP[signalState(nodes[b.node], b.horizontal, game.time)] === b.lamp ? 1 : 0;
      if (on === sigState[i]) continue;
      sigState[i] = on;
      sig.mesh.setColorAt(i, on ? ON[b.lamp] : OFF[b.lamp]);
      dirty = true;
    }
    if (dirty) sig.mesh.instanceColor.needsUpdate = true;
  }

  // ---- quality tiers ----
  let res = null;
  let quality = -1, shedApplied = 0;
  function applyQuality(q0) {
    quality = q0;
    // The adaptive controller sheds detail when the 1.0 pixel ratio
    // floor cannot hold the frame rate: one step drops to the Low tier's
    // shadow map and draw ranges.
    shedApplied = res ? res.shed : 0;
    const q = shedApplied > 0 ? Math.min(q0, 0.75) : q0;
    const tier = q < 1 ? 0 : q > 1 ? 2 : 1;
    ud.tier = tier; // for tiles a streamed map builds later
    for (const m of ud.tiered || []) {
      const c = m.userData.tierCounts;
      if (c) m.geometry.setDrawRange(0, c[tier]);
    }
    setShadowSize(q < 1 ? 1024 : 2048);
    bloom.on = bloom.ok && sys.bloomEnabled && q >= 1;
    if (bloom.on && !bloom.fb) sizeBloom();
  }

  // ---- adaptive resolution ----
  // The loop's real frame time moves the pixel ratio between 0.6 and the
  // device cap (2 physical pixels per CSS pixel at most, lower for the
  // Normal and Low quality settings).
  res = createAdaptiveRes({ max: maxRatioFor(window.devicePixelRatio || 1, game.quality), start: 1.5 });
  let resApplied = res.scale;

  // ---- shader warm-up ----
  // Compile every material in the scene (hidden ones too: night lamps,
  // rain, effect pools) behind the title screen, instead of the first
  // time each appears. Queued just after start-up so the page shows its
  // title first; the first frame of play runs it if it has not happened.
  let warmed = false;
  if (typeof setTimeout === 'function') setTimeout(() => { if (!warmed) warmUp(); }, 0);
  function warmUp() {
    warmed = true;
    const t = performance.now();
    try {
      // The async form lets the driver compile in parallel where it can
      // (KHR_parallel_shader_compile) instead of stalling this frame.
      if (renderer.compileAsync) renderer.compileAsync(scene, camera).catch(() => {});
      else renderer.compile(scene, camera);
    } catch {
      /* best effort */
    }
    sys.warmMs = performance.now() - t;
    sys.warmPrograms = renderer.info.programs ? renderer.info.programs.length : 0;
  }

  // ---- car shapes ahead of time ----
  // Lofting a car body takes tens of milliseconds the first time each
  // model is seen (the police car at the first wanted star, say). Build
  // any model not built yet, one per idle slot, while the title screen
  // shows, so none of them costs a frame in play.
  const prebuild = Object.keys(VEHICLE_SPECS).sort((a, b) => (a === 'police' ? -1 : b === 'police' ? 1 : 0));
  function prebuildNext() {
    const id = prebuild.shift();
    if (!id) return;
    try {
      vehicleStats(VEHICLE_SPECS[id]);
    } catch {
      /* drawn on first use instead */
    }
    schedule();
  }
  function schedule() {
    if (!prebuild.length || typeof window === 'undefined') return;
    if (window.requestIdleCallback) window.requestIdleCallback(prebuildNext, { timeout: 2000 });
    else setTimeout(prebuildNext, 30);
  }
  schedule();

  let frame = 0, skyVersion = -1;
  const sys = {
    name: 'graphics',
    // Measured at about 300 ms a frame on the software-rendered test
    // machine, far over budget, so bloom stays off unless switched on.
    bloomEnabled: false,
    render(alpha, dt) {
      const sky = game.daynight && game.daynight.sky;
      if (game.quality !== quality || res.shed !== shedApplied) applyQuality(game.quality);
      if (!warmed) warmUp();
      if (sys.adaptive && res.update(dt) !== resApplied && game.resize) {
        resApplied = res.scale;
        game.resize();
      }
      if ((frame & 31) === 0) markCasters();
      if ((frame & 7) === 0) updateSignals();
      frame++;
      if (sky && sky.version !== skyVersion) {
        skyVersion = sky.version;
        updateEnv(sky, false);
        // Brighter eyes at night, as a camera would open up.
        renderer.toneMappingExposure = 1.1 + 0.05 * sky.night;
        scene.environmentIntensity = 0.42 + 0.48 * sky.night;
      }
      updateShadow(sky);
      if (lampU) {
        lampU.uLampK.value = sky ? 4.6 * sky.lit * (0.4 + 0.6 * sky.night) : 0;
        const cl = game.daynight && game.daynight.carLamps;
        const n = cl ? Math.min(cl.n, CARS) : 0;
        const k = sky ? sky.lit : 0;
        for (let i = 0; i < n; i++) {
          const d = cl.data, o = i * 8;
          lampU.uCarA.value[i].set(d[o], d[o + 1], d[o + 2], d[o + 3]);
          lampU.uCarB.value[i].set(d[o + 4] * k, d[o + 5] * k, d[o + 6], 0);
        }
        lampU.uCarN.value = n;
        setSpotLight(lampU, game.vehicles, sky ? 1 - sky.night : 0, BEAM_TAN);
      }
      setBeamDaylight(sky ? 1 - sky.night : 0);
      if (win) {
        win.uniforms.uWinNight.value = sky ? sky.night : 0;
        win.uniforms.uWinTime.value = (game.time || 0) % 1000;
      }
      const w = game.weather;
      if (ud.windsock && w) {
        ud.windsock.rotation.y = -w.windDir + Math.sin(game.time * 2.3) * 0.12;
        ud.windsock.rotation.z = -Math.max(0, 1 - w.wind / 7) * 1.1 + Math.sin(game.time * 3.1) * 0.05;
      }
    },
    setBloom(on) {
      sys.bloomEnabled = !!on;
      quality = -1;
    },
    refreshEnvironment() {
      const sky = game.daynight && game.daynight.sky;
      if (sky) updateEnv(sky, true);
    },
    // Pixel ratio to draw at, for game.resize(): the adaptive scale,
    // bounded by the device and the quality setting.
    resolution(dpr) {
      const max = maxRatioFor(dpr, game.quality);
      res.setMax(max);
      resApplied = res.scale;
      return sys.adaptive ? res.scale : max;
    },
    adaptive: true,
    res,
    warmMs: 0,
    warmPrograms: 0,
    setupMs: 0,
    calls: 0, // draw calls and triangles of the last scene draw
    triangles: 0,
  };
  game.graphics = sys;
  game.renderFrame = renderFrame;
  if (game.daynight && game.daynight.refresh) game.daynight.refresh();
  // Anything compiled before this point needs the new lighting set-up.
  scene.traverse((o) => {
    const m = o.material;
    if (Array.isArray(m)) m.forEach((x) => { x.needsUpdate = true; });
    else if (m) m.needsUpdate = true;
  });
  applyQuality(game.quality);
  sys.setupMs = performance.now() - t0;
  return sys;
}
