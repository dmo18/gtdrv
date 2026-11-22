// Browser harness for scripts/vehicle-shots.mjs: renders line-ups of every
// car (near and far LOD), boat and aircraft under a gradient-sky
// environment, plus action shots made by stepping a fake scene through the
// effects system. window.shot(name) renders one shot into the canvas.
import * as THREE from 'three';
import { VEHICLE_SPECS, createVehicle } from '../src/entities/vehicle.js';
import { BOAT_SPECS, createBoat, stepBoat } from '../src/entities/boat.js';
import { AIRCRAFT_SPECS, createAircraft } from '../src/entities/aircraft.js';
import { createVehicleMesh, updateVehicleMesh, setVehicleLod, setVehicleLights, noteVehicleHit, vehicleStats } from '../src/render/vehiclemesh.js';
import { createBoatMesh, updateBoatMesh } from '../src/render/boatmesh.js';
import { createAircraftMesh, updateAircraftMesh } from '../src/render/aircraftmesh.js';
import { createEffects } from '../src/render/effects.js';
import { createEvents } from '../src/core/events.js';
import { createWater } from '../src/render/water.js';
import { createPersonMesh, updatePersonMesh, PERSON_PALETTES } from '../src/render/personmesh.js';

const qs = new URLSearchParams(location.search);
const W = +qs.get('w') || 1280, H = +qs.get('h') || 720;
const canvas = document.getElementById('c');
canvas.width = W;
canvas.height = H;
canvas.style.width = W + 'px';
canvas.style.height = H + 'px';
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(1);
renderer.setSize(W, H, false);
const scene = new THREE.Scene();
const SKY = 0xa9cde8;
scene.background = new THREE.Color(SKY);
scene.fog = new THREE.Fog(SKY, 220, 1050);
const hemi = new THREE.HemisphereLight(0xe4f1ff, 0x8a8272, 1.9);
const sun = new THREE.DirectionalLight(0xfff0d8, 1.7);
sun.position.set(0.55, 1, 0.35);
scene.add(hemi, sun);
const camera = new THREE.PerspectiveCamera(40, W / H, 0.3, 2000);

// Simple gradient sky PMREM (a stand-in for the game's environment).
function skyEnv() {
  const s = new THREE.Scene();
  const geo = new THREE.SphereGeometry(10, 48, 24);
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    vertexShader: 'varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: `varying vec3 vP; void main(){
      vec3 d = normalize(vP);
      float h = d.y;
      vec3 sky = mix(vec3(0.78, 0.86, 0.93), vec3(0.28, 0.48, 0.78), smoothstep(0.0, 0.6, h));
      vec3 ground = mix(vec3(0.42, 0.4, 0.37), vec3(0.2, 0.2, 0.19), smoothstep(0.0, -0.4, h));
      vec3 c = h > 0.0 ? sky : ground;
      c += vec3(1.0, 0.95, 0.85) * pow(max(0.0, dot(d, normalize(vec3(0.55, 1.0, 0.35)))), 200.0) * 30.0;
      // A few soft cloud / building bands near the horizon for reflections.
      c = mix(c, vec3(0.92), smoothstep(0.02, 0.0, abs(h - 0.08)) * 0.5 * (0.5 + 0.5 * sin(atan(d.z, d.x) * 7.0)));
      c = mix(c, vec3(0.25, 0.27, 0.3), step(0.0, h) * step(h, 0.06) * step(0.3, sin(atan(d.z, d.x) * 23.0)) * 0.6);
      gl_FragColor = vec4(c, 1.0);
    }`,
  });
  s.add(new THREE.Mesh(geo, mat));
  const pm = new THREE.PMREMGenerator(renderer);
  const rt = pm.fromScene(s, 0.01);
  pm.dispose();
  return rt.texture;
}
scene.environment = skyEnv();

// Ground: asphalt with lane marks.
function groundTex() {
  const c = document.createElement('canvas');
  c.width = c.height = 512;
  const g = c.getContext('2d');
  g.fillStyle = '#56585b';
  g.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 4000; i++) {
    const v = 70 + Math.random() * 40;
    g.fillStyle = `rgb(${v},${v},${v + 2})`;
    g.fillRect(Math.random() * 512, Math.random() * 512, 2, 2);
  }
  g.fillStyle = '#d8d6cc';
  g.fillRect(0, 250, 120, 10);
  g.fillRect(256, 250, 120, 10);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(40, 40);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}
const ground = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), new THREE.MeshLambertMaterial({ map: groundTex() }));
ground.rotation.x = -Math.PI / 2;
scene.add(ground);
const sea = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), new THREE.MeshStandardMaterial({ color: 0x1f5a74, roughness: 0.15, metalness: 0 }));
sea.rotation.x = -Math.PI / 2;
sea.visible = false;
scene.add(sea);
const water = createWater({});
water.mesh.visible = false;
scene.add(water.mesh);

const holder = new THREE.Group();
scene.add(holder);

function clear() {
  while (holder.children.length) holder.remove(holder.children[0]);
}

function frame(obj, az, el, dist, ty = 0.7, fov = 32) {
  camera.fov = fov;
  camera.updateProjectionMatrix();
  camera.position.set(Math.cos(az) * Math.cos(el) * dist, ty + Math.sin(el) * dist, Math.sin(az) * Math.cos(el) * dist);
  camera.lookAt(0, ty, 0);
  void obj;
}

// Render tiles: items is a list of { obj, setup(camera) }.
function tiles(items, cols, rows) {
  renderer.setScissorTest(true);
  const tw = W / cols, th = H / rows;
  camera.aspect = tw / th;
  for (const it of items) it.obj.visible = false;
  renderer.setClearColor(SKY);
  renderer.clear();
  let calls = 0, tris = 0;
  items.forEach((it, i) => {
    const cx = i % cols, cy = Math.floor(i / cols);
    const x = cx * tw, y = H - (cy + 1) * th;
    renderer.setViewport(x, y, tw, th);
    renderer.setScissor(x, y, tw, th);
    it.obj.visible = true;
    it.setup();
    camera.updateProjectionMatrix();
    renderer.render(scene, camera);
    calls += renderer.info.render.calls;
    tris += renderer.info.render.triangles;
    it.obj.visible = false;
  });
  renderer.setScissorTest(false);
  renderer.setViewport(0, 0, W, H);
  camera.aspect = W / H;
  camera.updateProjectionMatrix();
  return { calls: calls / items.length, tris: tris / items.length };
}

const CAR_IDS = Object.keys(VEHICLE_SPECS);
function carLine(view, far = false) {
  clear();
  ground.visible = true;
  sea.visible = false;
  const items = CAR_IDS.map((id, k) => {
    const v = createVehicle(id, 0, 0, 0);
    const spec = v.spec;
    const mesh = createVehicleMesh(spec, spec.colors[k % spec.colors.length]);
    v.steerAngle = view === 'front' ? 0.25 : 0;
    v.lodFar = far;
    updateVehicleMesh(mesh, v, 1, 0);
    setVehicleLod(mesh, far);
    holder.add(mesh);
    const L = spec.length;
    return {
      obj: mesh,
      setup() {
        const d = Math.max(L * 1.2, spec.height * 2.6) + 1;
        if (view === 'front') frame(mesh, 0.62, 0.16, d, spec.height * 0.45);
        else if (view === 'rear') frame(mesh, Math.PI + 0.7, 0.2, d, spec.height * 0.45);
        else if (view === 'side') frame(mesh, Math.PI / 2, 0.02, d * 1.05, spec.height * 0.45);
        else if (view === 'top') frame(mesh, -0.9, 0.75, d, spec.height * 0.3);
      },
    };
  });
  return tiles(items, 3, 3);
}

function boatLine() {
  clear();
  ground.visible = false;
  sea.visible = true;
  const ids = Object.keys(BOAT_SPECS);
  const items = ids.map((id, k) => {
    const b = createBoat(id, 0, 0, 0);
    const mesh = createBoatMesh(b.spec, b.spec.colors[k % b.spec.colors.length]);
    b.throttle = 0;
    updateBoatMesh(mesh, b, 1, 0);
    mesh.position.y = 0;
    holder.add(mesh);
    const L = b.spec.length;
    return { obj: mesh, setup() { frame(mesh, 0.75, 0.22, L * 1.5 + 2, b.spec.height * 0.35); } };
  });
  return tiles(items, 3, 2);
}

function airLine(night = false) {
  clear();
  ground.visible = true;
  sea.visible = false;
  const ids = Object.keys(AIRCRAFT_SPECS);
  const items = ids.map((id, k) => {
    const a = createAircraft(id, 0, 0, 0);
    const mesh = createAircraftMesh(a.spec, a.spec.colors[k % a.spec.colors.length]);
    a.engineOn = k % 2 === 0;
    a.rotorSpeed = k % 2 === 0 ? 1 : 0;
    a.propSpin = 0.4;
    updateAircraftMesh(mesh, a, 1, night ? 22 : 0);
    holder.add(mesh);
    const L = Math.max(a.spec.length, a.spec.width);
    return { obj: mesh, setup() { frame(mesh, 0.7, 0.25, L * 1.25 + 2, a.spec.height * 0.45); } };
  });
  return tiles(items, 3, 2);
}

// ---- action shots ---------------------------------------------------------------
function fakeGame() {
  const g = {
    scene, camera, renderer, vehicles: [], events: createEvents(), quality: 1,
    weather: { rain: 0, fog: 0 }, clock: 12, city: { onRoad: () => true, isGround: () => true },
    player: { vehicle: null }, chase: null, seaY: 0, time: 0, paused: false,
  };
  return g;
}
let fxSys = null;
function startFx(g) {
  if (fxSys) fxSys.dispose();
  fxSys = createEffects(g);
  return fxSys;
}
function addCar(g, id, x, z, h, color) {
  const v = createVehicle(id, x, z, h);
  v.mesh = createVehicleMesh(v.spec, color == null ? v.spec.colors[0] : color);
  holder.add(v.mesh);
  g.vehicles.push(v);
  return v;
}
function syncCar(v, t) {
  updateVehicleMesh(v.mesh, v, 1, t);
}
function full() {
  renderer.setViewport(0, 0, W, H);
  camera.aspect = W / H;
  camera.fov = 50;
  camera.updateProjectionMatrix();
}

function drift() {
  clear();
  ground.visible = true; sea.visible = false;
  const g = fakeGame();
  const fx = startFx(g);
  const v = addCar(g, 'sports', 0, 0, 0, 0xd81e2a);
  g.player.vehicle = v;
  const other = addCar(g, 'muscle', -9, 7, 0.4, 0x14213d);
  camera.position.set(0, 4, 0);
  const R = 11, w = 1.25;
  let t = 0;
  const dt = 1 / 60;
  for (let i = 0; i < 260; i++) {
    t += dt;
    const a = t * w - 1.2;
    v.px = v.x; v.pz = v.z; v.pheading = v.heading;
    v.x = Math.cos(a) * R;
    v.z = Math.sin(a) * R;
    v.heading = a + Math.PI / 2 + 0.55; // tangent plus drift angle
    v.vx = -Math.sin(a) * R * w;
    v.vz = Math.cos(a) * R * w;
    v.speed = R * w;
    v.slip = 0.9;
    v.throttle = 1;
    v.wheelSpin += dt * 40;
    v.steerAngle = -0.35;
    v.roll = 0.07;
    other.brake = 1; other.speed = 12; other.vx = 12; other.slip = 0;
    if (i < 200) {
      other.px = other.x; other.x += 12 * dt * Math.cos(0.4); other.z += 12 * dt * Math.sin(0.4);
    }
    fx.fixedUpdate(dt);
  }
  syncCar(v, t);
  syncCar(other, t);
  full();
  camera.position.set(v.x - 9, 3.6, v.z + 6);
  camera.lookAt(v.x, 0.8, v.z);
  fx.render(1, dt);
  renderer.render(scene, camera);
  const sm = scene.getObjectByName('fx-smoke');
  return { ...fx.counts(), vis: sm.visible, ic: sm.geometry.instanceCount, d: Array.from(sm.geometry.attributes.iData.array.slice(0, 8)).map((x) => +x.toFixed(2)), p: Array.from(sm.geometry.attributes.iPos.array.slice(0, 3)).map((x) => +x.toFixed(1)), cam: camera.position.toArray().map((x) => +x.toFixed(1)), calls: renderer.info.render.calls };
}

function damage() {
  clear();
  ground.visible = true; sea.visible = false;
  const g = fakeGame();
  const fx = startFx(g);
  const a = addCar(g, 'sedan', -5.5, 0, 0.3, 0x8a8f96);
  a.health = a.spec.health * 0.55;
  noteVehicleHit(a.mesh, 0.2, 0, 1, 12);
  const b = addCar(g, 'compact', 0, 1, 0.9, 0x3a7bd5);
  b.health = b.spec.health * 0.18;
  noteVehicleHit(b.mesh, 1, 0, 0.1, 30);
  noteVehicleHit(b.mesh, -0.2, 0, -1, 14);
  const c = addCar(g, 'muscle', 5.5, -0.5, -0.4, 0xa31621);
  c.health = 0;
  c.wrecked = true;
  noteVehicleHit(c.mesh, 1, 0, 0, 26);
  camera.position.set(2, 4.5, 11);
  const dt = 1 / 60;
  for (let i = 0; i < 200; i++) fx.fixedUpdate(dt);
  for (const v of g.vehicles) syncCar(v, 3.3);
  full();
  camera.position.set(2, 4.5, 11);
  camera.lookAt(0, 0.8, 0);
  fx.render(1, dt);
  renderer.render(scene, camera);
}

function sparksShot() {
  clear();
  ground.visible = true; sea.visible = false;
  const g = fakeGame();
  const fx = startFx(g);
  const wall = new THREE.Mesh(new THREE.BoxGeometry(60, 1.2, 0.5), new THREE.MeshLambertMaterial({ color: 0x9a9690 }));
  wall.position.set(0, 0.6, 1.25);
  holder.add(wall);
  const v = addCar(g, 'police', -10, 0, 0, 0x1b2433);
  camera.position.set(0, 2.4, -7.5);
  const b = addCar(g, 'pickup', 8, -3.5, Math.PI - 0.5, 0x7a4b2a);
  const dt = 1 / 60;
  let t = 0;
  for (let i = 0; i < 70; i++) {
    t += dt;
    v.px = v.x; v.x += 14 * dt; v.vx = 14; v.vz = 0; v.speed = 14; v.wheelSpin += dt * 42;
    if (i % 2 === 0) {
      v.vz = -0.9;
      g.events.emit('vehicleImpact', v, 7);
    }
    fx.fixedUpdate(dt);
    v.vz = 0;
  }
  // Car-on-car crash flash at the end.
  b.x = v.x + 4; b.z = -1.6;
  g.events.emit('vehicleCrash', v, b, 16);
  for (let i = 0; i < 4; i++) fx.fixedUpdate(dt);
  syncCar(v, t);
  syncCar(b, t);
  full();
  camera.position.set(v.x - 1, 2.4, v.z - 7.5);
  camera.lookAt(v.x + 1.5, 0.6, v.z);
  fx.render(1, dt);
  renderer.render(scene, camera);
}

function boatSpray() {
  clear();
  ground.visible = false; sea.visible = false;
  water.mesh.visible = true;
  const g = fakeGame();
  const fx = startFx(g);
  const world = { time: 0 };
  const dt = 1 / 60;
  const boats = [];
  const setups = [['speedboat', 0, 0, 0xf4f4f0], ['jetski', -6, 10, 0xe8402a], ['yacht', -40, -18, 0xf5f5f2]];
  for (const [id, x, z, col] of setups) {
    const b = createBoat(id, x, z, 0);
    b.mesh = createBoatMesh(b.spec, col);
    holder.add(b.mesh);
    g.vehicles.push(b);
    boats.push(b);
  }
  camera.position.set(0, 3, 0);
  for (let i = 0; i < 360; i++) {
    world.time += dt;
    for (const b of boats) {
      stepBoat(b, b.spec.id === 'yacht' ? { throttle: 0.5, steer: 0, brake: 0 } : { throttle: 1, steer: i > 300 && b.spec.id === 'jetski' ? 0.6 : 0, brake: 0 }, dt, world);
      updateBoatMesh(b.mesh, b, 1, world.time);
    }
    camera.position.set(boats[0].x + 6, 3.2, boats[0].z - 9);
    fx.fixedUpdate(dt);
  }
  const p = boats[0];
  water.update(world.time, camera.position);
  full();
  camera.position.set(p.x + 6, 3.2, p.z - 9);
  camera.lookAt(p.x - 2, 0.6, p.z + 1);
  fx.render(1, dt);
  renderer.render(scene, camera);
  water.mesh.visible = false;
  return { spd: boats.map((b) => +b.speed.toFixed(1)), plan: boats.map((b) => +(b.planing || 0).toFixed(2)), ...fx.counts() };
}

function night() {
  clear();
  ground.visible = true; sea.visible = false;
  const g = fakeGame();
  g.clock = 22.5;
  const fx = startFx(g);
  const env = scene.environment;
  scene.environment = null;
  hemi.intensity = 0.5; sun.intensity = 0.25;
  scene.background = new THREE.Color(0x0d1a38);
  const v = addCar(g, 'sedan', 0, 0, 0, 0x2f3b4c);
  g.player.vehicle = v;
  const b = addCar(g, 'taxi', 9, -4, Math.PI, null);
  b.brake = 1;
  const c = addCar(g, 'police', 14, 4, Math.PI + 0.2, null);
  const dt = 1 / 60;
  for (let i = 0; i < 30; i++) fx.fixedUpdate(dt);
  for (const x of g.vehicles) syncCar(x, 1);
  c.mesh.userData.sirenPhase = 0;
  c.mesh.userData.sirenOn = true;
  full();
  camera.position.set(-7, 2.6, 3.5);
  camera.lookAt(4, 0.6, -0.5);
  for (let k = 0; k < 20; k++) fx.render(1, dt);
  renderer.render(scene, camera);
  scene.environment = env;
  hemi.intensity = 1.9; sun.intensity = 1.7;
  scene.background = new THREE.Color(SKY);
}

function airAction() {
  clear();
  ground.visible = true; sea.visible = false;
  const g = fakeGame();
  const fx = startFx(g);
  const h = createAircraft('heli', 0, 0, 0.3);
  h.mesh = createAircraftMesh(h.spec, h.spec.colors[0]);
  holder.add(h.mesh);
  g.vehicles.push(h);
  h.y = h.py = 4; h.rotorSpeed = 1; h.onGround = false; h.engineOn = true;
  const p = createAircraft('prop', 16, -10, Math.PI * 0.85);
  p.mesh = createAircraftMesh(p.spec, p.spec.colors[1]);
  holder.add(p.mesh);
  g.vehicles.push(p);
  p.engineOn = true; p.throttle = 1; p.onGround = true;
  const dt = 1 / 60;
  for (let i = 0; i < 150; i++) {
    h.propSpin = (h.propSpin + 0.5) % 6.28;
    p.propSpin = (p.propSpin + 0.6) % 6.28;
    fx.fixedUpdate(dt);
  }
  updateAircraftMesh(h.mesh, h, 1, 0);
  updateAircraftMesh(p.mesh, p, 1, 0);
  full();
  camera.position.set(-8, 7, 18);
  camera.lookAt(4, 2, -3);
  fx.render(1, dt);
  renderer.render(scene, camera);
}

function street() {
  // Many cars at mixed distances to check LOD transitions and shadows.
  clear();
  ground.visible = true; sea.visible = false;
  const g = fakeGame();
  const fx = startFx(g);
  let k = 0;
  for (let i = 0; i < 18; i++) {
    const id = CAR_IDS[i % CAR_IDS.length];
    const v = addCar(g, id, i * 9 - 6, (i % 2) * 5 - 2.5, i % 2 ? Math.PI : 0, VEHICLE_SPECS[id].colors[k++ % VEHICLE_SPECS[id].colors.length]);
    v.lodFar = i * 9 > 70;
    syncCar(v, 0);
  }
  full();
  camera.position.set(-14, 3.2, 0.5);
  camera.lookAt(10, 0.9, 0);
  fx.fixedUpdate(1 / 60);
  fx.render(1, 1 / 60);
  renderer.render(scene, camera);
  return { calls: renderer.info.render.calls, tris: renderer.info.render.triangles };
}

// One car from four angles, big.
function detail(id, far = false) {
  clear();
  ground.visible = true;
  sea.visible = false;
  const v = createVehicle(id, 0, 0, 0);
  const spec = v.spec;
  const views = [[0.62, 0.14], [Math.PI + 0.75, 0.2], [Math.PI / 2, 0.03], [-0.5, 0.55]];
  const items = views.map(([az, el], k) => {
    const mesh = createVehicleMesh(spec, spec.colors[(k + 1) % spec.colors.length]);
    v.steerAngle = k === 0 ? 0.3 : 0;
    v.lodFar = far;
    updateVehicleMesh(mesh, v, 1, 0);
    setVehicleLod(mesh, far);
    holder.add(mesh);
    return { obj: mesh, setup() { frame(mesh, az, el, spec.length * 1.25 + 1.2, spec.height * 0.42); } };
  });
  return tiles(items, 2, 2);
}

function ptest() {
  clear();
  ground.visible = true; sea.visible = false;
  const g = fakeGame();
  const fx = startFx(g);
  full();
  camera.position.set(0, 2, 10);
  camera.lookAt(0, 1, 0);
  g.events.emit('splash', 0, 0);
  for (let i = 0; i < 20; i++) fx.fixedUpdate(1 / 60);
  fx.render(1, 1 / 60);
  renderer.render(scene, camera);
  return fx.counts();
}

// One car big in the frame: front three-quarter (or rear), low camera.
function close(id, rearView = false, night = false) {
  clear();
  ground.visible = true;
  sea.visible = false;
  const v = createVehicle(id, 0, 0, 0);
  const spec = v.spec;
  const mesh = createVehicleMesh(spec, spec.colors[1 % spec.colors.length]);
  v.steerAngle = rearView ? 0 : 0.28;
  v.brake = rearView ? 1 : 0;
  updateVehicleMesh(mesh, v, 1, 0);
  if (id === 'police') setVehicleLights(mesh, { siren: true, brake: rearView === true, time: 0 });
  holder.add(mesh);
  full();
  camera.fov = 36;
  camera.updateProjectionMatrix();
  const d = spec.length * 0.95 + 1.6;
  const az = rearView === 'nose' ? 0.05 : rearView ? Math.PI + 0.62 : 0.55;
  camera.position.set(Math.cos(az) * d, spec.height * 0.62 + 0.3, Math.sin(az) * d);
  camera.lookAt(rearView ? -0.3 : 0.4, spec.height * 0.42, 0);
  void night;
  renderer.render(scene, camera);
  return { calls: renderer.info.render.calls, tris: renderer.info.render.triangles };
}

// People line-up: every palette, an officer, a crew member; walking,
// running and lying poses.
function people(closeUp = false) {
  clear();
  ground.visible = true;
  sea.visible = false;
  const looks = [...PERSON_PALETTES, { shirt: 0x26406b, trousers: 0x1a2233, skin: 0xb98060, hair: 0x22180f }, { shirt: 0x6e1f4f, trousers: 0x1c1a2c, skin: 0xc68e62, hair: 0xd4a93a }];
  const list = closeUp ? [looks[10], looks[1], looks[2], looks[11]] : looks;
  let tris = 0;
  list.forEach((look, k) => {
    const m = createPersonMesh(look);
    const n = list.length;
    const w = { x: 0, z: (k - (n - 1) / 2) * (closeUp ? 0.75 : 0.8), px: 0, pz: 0, heading: 0, pheading: 0, moving: k % 3 !== 0, speed: k % 3 === 2 ? 6 : 1.6, stride: k * 0.9 + 0.5, y: 0 };
    w.px = w.x; w.pz = w.z;
    w.heading = w.pheading = closeUp ? 0.35 : 0.15;
    if (!closeUp && k === n - 1) { w.life = 'out'; w.lifeT = 2; m.rotation.order = 'YXZ'; }
    for (let i = 0; i < 30; i++) updatePersonMesh(m, w, 1);
    if (w.life) { m.rotation.z = Math.PI / 2; m.position.y += 0.15; }
    holder.add(m);
    tris += m.userData.person.skin.geometry.index.count / 3;
  });
  full();
  camera.fov = closeUp ? 30 : 38;
  camera.updateProjectionMatrix();
  if (closeUp) {
    camera.position.set(3.6, 1.45, 0.4);
    camera.lookAt(0, 1.0, 0);
  } else {
    camera.position.set(8.5, 2.2, 0);
    camera.lookAt(0, 0.85, 0);
  }
  renderer.render(scene, camera);
  return { calls: renderer.info.render.calls, trisPerPerson: Math.round(tris / list.length) };
}

// People review shots at phone size: close (about 5 m) and street
// distance (about 25 m), day and night, an officer, a crowd.
const NIGHT_LAMPS = [];
function peopleScene(kind, night) {
  clear();
  ground.visible = true;
  sea.visible = false;
  const env = scene.environment;
  if (night) {
    scene.environment = null;
    hemi.intensity = 0.35;
    sun.intensity = 0.12;
    scene.background = new THREE.Color(0x0d1a38);
    if (!NIGHT_LAMPS.length) {
      for (const [x, z] of [[2, -3], [2, 3], [-6, 0]]) {
        const l = new THREE.PointLight(0xffd29a, 9, 16, 1.6);
        l.position.set(x, 4.5, z);
        NIGHT_LAMPS.push(l);
        scene.add(l);
      }
    }
  }
  for (const l of NIGHT_LAMPS) l.visible = night;
  const cop = { shirt: 0x26406b, trousers: 0x1a2233, skin: 0xb98060, hair: 0x22180f };
  const crew = { shirt: 0x6e1f4f, trousers: 0x1c1a2c, skin: 0xc68e62, hair: 0xd4a93a };
  const P = PERSON_PALETTES;
  let list, spread = 0.9;
  if (kind === 'police') list = [cop, cop, crew];
  else if (kind === 'crowd' || kind === 'poses') list = [];
  else if (kind === 'one') list = (window.__oneList || '0,1').split(',').map((i) => (i === 'c' ? cop : i === 'k' ? crew : P[+i]));
  else list = [P[0], P[2], P[1], P[3], P[4], P[5]];
  const put = (look, x, z, h, k, opts = {}) => {
    const m = createPersonMesh(look);
    const w = { x, z, px: x, pz: z, heading: h, pheading: h, moving: opts.moving ?? k % 3 !== 0, speed: opts.speed ?? (k % 4 === 3 ? 5.5 : 1.5), stride: k * 1.3 + 0.5, y: 0 };
    if (opts.weapon) w.arms = { weapon: opts.weapon, cool: 0.3 };
    for (let i = 0; i < 30; i++) updatePersonMesh(m, w, 1);
    holder.add(m);
    return m;
  };
  if (kind === 'poses') {
    // Run, walk, aim, down: knees and elbows bend.
    put(P[3], 0, -1.6, 0.3, 1, { moving: true, speed: 6 });
    put(P[0], 0, -0.5, 0.3, 2, { moving: true, speed: 1.6 });
    put(cop, 0, 0.6, 0.6, 0, { weapon: 'smg', moving: false });
    const m = put(P[1], 0.6, 1.9, 0.2, 0, { moving: false });
    m.rotation.order = 'YXZ';
    const w = { x: 0.6, z: 1.9, px: 0.6, pz: 1.9, heading: 0.2, pheading: 0.2, moving: false, speed: 0, stride: 0, y: 0, life: 'out' };
    updatePersonMesh(m, w, 1);
    m.rotation.z = Math.PI / 2;
    m.position.y += 0.15;
  } else if (kind === 'crowd') {
    let k = 0;
    for (let i = 0; i < 7; i++) for (let j = 0; j < 6; j++) {
      const look = k % 13 === 5 ? cop : k % 11 === 7 ? crew : P[(k * 7) % P.length];
      put(look, -i * 2.2 + Math.sin(k * 3.1) * 0.6, (j - 2.5) * 1.6 + Math.cos(k * 1.7) * 0.5, (k % 2 ? Math.PI : 0) + Math.sin(k) * 0.4, k);
      k++;
    }
  } else {
    list.forEach((look, k) => {
      const n = list.length;
      const opts = kind === 'police' && k < 2 ? { weapon: 'pistol', moving: k === 1, speed: 1.4 } : {};
      put(look, 0, (k - (n - 1) / 2) * spread, kind === 'police' ? 0.5 : 0.35 + (k % 2) * 0.25, k, opts);
    });
  }
  full();
  camera.fov = 40;
  camera.updateProjectionMatrix();
  const far = kind === 'street' || kind === 'crowd';
  if (kind === 'crowd') {
    camera.position.set(18, 7, 9);
    camera.lookAt(-6, 0.6, 0);
  } else if (far) {
    camera.position.set(24, 4.5, 7);
    camera.lookAt(0, 0.9, 0);
  } else if (kind === 'poses') {
    camera.position.set(5.2, 1.7, 0.6);
    camera.lookAt(0, 0.8, 0.2);
  } else if (kind === 'one' && window.__bust) {
    camera.position.set(1.3, 1.45, 0.15);
    camera.lookAt(0, 1.3, 0);
  } else if (kind === 'one') {
    camera.position.set(2.6, 1.3, 0.6);
    camera.lookAt(0, 1.0, 0);
  } else if (kind === 'police') {
    camera.position.set(4.2, 1.6, 1.4);
    camera.lookAt(0, 1.0, 0);
  } else {
    camera.position.set(4.6, 1.65, 1.5);
    camera.lookAt(0, 0.95, 0);
  }
  renderer.render(scene, camera);
  const r = { calls: renderer.info.render.calls, tris: renderer.info.render.triangles };
  scene.environment = env;
  hemi.intensity = 1.9;
  sun.intensity = 1.7;
  scene.background = new THREE.Color(SKY);
  return r;
}

const SHOTS = {
  'people-close-day': () => peopleScene('close', false),
  'people-close-night': () => peopleScene('close', true),
  'people-street-day': () => peopleScene('street', false),
  'people-street-night': () => peopleScene('street', true),
  'people-police': () => peopleScene('police', false),
  'people-crowd': () => peopleScene('crowd', false),
  'people-one': () => peopleScene('one', false),
  'people-poses': () => peopleScene('poses', false),
  people: () => people(false),
  'people-close': () => people(true),
  ptest,
  'cars-front': () => carLine('front'),
  'cars-rear': () => carLine('rear'),
  'cars-side': () => carLine('side'),
  'cars-top': () => carLine('top'),
  'cars-far': () => carLine('front', true),
  boats: () => boatLine(),
  aircraft: () => airLine(),
  drift, damage, sparks: sparksShot, 'boat-spray': boatSpray, night, 'air-fx': airAction, street,
};
for (const id of CAR_IDS) {
  SHOTS['car-' + id] = () => detail(id);
  SHOTS['far-' + id] = () => detail(id, true);
  SHOTS['close-' + id] = () => close(id);
  SHOTS['rear-' + id] = () => close(id, true);
  SHOTS['nose-' + id] = () => close(id, 'nose');
}
window.shotNames = Object.keys(SHOTS).filter((n) => !/^(car|far|close|rear|nose)-/.test(n));
window.shot = (name) => {
  // people-one:<list> shows a close pair (palette indexes, c officer, k crew).
  window.__bust = name.startsWith('people-bust:');
  if (name.startsWith('people-one:') || window.__bust) {
    window.__oneList = name.slice(name.indexOf(':') + 1);
    name = 'people-one';
  }
  const r = SHOTS[name]();
  return r || null;
};
window.stats = () => {
  const out = {};
  for (const id of CAR_IDS) out[id] = vehicleStats(VEHICLE_SPECS[id]);
  return out;
};
window.__scene = scene;
window.__ready = true;
