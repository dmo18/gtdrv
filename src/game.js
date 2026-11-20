// The game itself: owns the world, the vehicles, the player and the
// list of systems, and runs them each step.
import * as THREE from 'three';
import { generateCity, DISTRICTS } from './world/citygen.js';
import { createCollisionWorld } from './world/collision.js';
import { buildCityMesh } from './render/citymesh.js';
import { createInput, attachKeyboard } from './core/input.js';
import { createLoop } from './core/loop.js';
import { createEvents } from './core/events.js';
import { createRng } from './core/rng.js';
import { createVehicle, stepVehicle, collideVehicles } from './entities/vehicle.js';
import { createVehicleMesh, updateVehicleMesh, setVehicleLights } from './render/vehiclemesh.js';
import { createChaseCamera } from './render/chasecam.js';
import { createTouchControls } from './ui/touch.js';
import { createHud } from './ui/hud.js';
import { injectStyles } from './ui/styles.js';
import { createParkedCars } from './systems/parked.js';

const SKY = 0x9fc8e8;

export function createGame({ canvas, uiRoot }) {
  const rng = createRng(77123);
  const city = generateCity();
  const collision = createCollisionWorld();
  const events = createEvents();
  const input = createInput();

  // --- Drawing setup. ---
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
  const scene = new THREE.Scene();
  scene.background = new THREE.Color().setHex(SKY, THREE.SRGBColorSpace);
  scene.fog = new THREE.Fog(scene.background.getHex(), 220, 1050);
  const camera = new THREE.PerspectiveCamera(62, 1, 0.5, 1800);
  const hemi = new THREE.HemisphereLight(0xe4f1ff, 0x8a8272, 1.9);
  const sun = new THREE.DirectionalLight(0xfff0d8, 1.7);
  sun.position.set(0.55, 1, 0.35);
  scene.add(hemi, sun);
  scene.add(buildCityMesh(city, collision));

  const game = {
    city, collision, events, input, rng, renderer, scene, camera,
    lights: { hemi, sun },
    world: { collision, city },
    vehicles: [],
    systems: [],
    time: 0, // simulated seconds since start
    paused: false,
    quality: 1,
    player: {
      mode: 'car', // 'car' or 'foot'
      vehicle: null,
      x: city.spawn.x, z: city.spawn.z, heading: city.spawn.heading,
      health: 100, armor: 0, money: 250, wanted: 0,
    },
    hudState: {
      mode: 'car', speedKmh: 0, health: 100, armor: 0, money: 0, wanted: 0,
      district: '', time: 9, vehicleHealth: 1, weapon: null, ammo: null,
    },
    addSystem(sys) {
      game.systems.push(sys);
      return sys;
    },
    addVehicle(v) {
      v.mesh = createVehicleMesh(v.spec, v.color);
      v.meshDirty = true;
      scene.add(v.mesh);
      game.vehicles.push(v);
      updateVehicleMesh(v.mesh, v, 1);
      return v;
    },
    removeVehicle(v) {
      const i = game.vehicles.indexOf(v);
      if (i >= 0) game.vehicles.splice(i, 1);
      if (v.mesh) scene.remove(v.mesh);
      v.mesh = null;
      v.removed = true;
      events.emit('vehicleRemoved', v);
    },
  };

  // --- Player starts in a car on the street. ---
  const car = createVehicle('sedan', city.spawn.x, city.spawn.z, city.spawn.heading, rng);
  car.driver = 'player';
  game.addVehicle(car);
  game.player.vehicle = car;

  const chase = createChaseCamera(camera);
  game.chase = chase;
  const camTarget = { x: car.x, z: car.z, heading: car.heading, speed: 0, height: 1.2 };
  game.camTarget = camTarget;
  chase.snap(camTarget);

  injectStyles();
  const touch = createTouchControls(uiRoot, input);
  const hud = createHud(uiRoot);
  game.touch = touch;
  game.hud = hud;
  attachKeyboard(input);
  touch.setMode('car');

  game.addSystem(createParkedCars(game));

  // --- Simulation step. ---
  function fixedUpdate(dt) {
    input.poll();
    if (input.consume('pause')) {
      game.paused = !game.paused;
      events.emit('pause', game.paused);
    }
    if (game.paused) {
      input.endStep();
      return;
    }
    game.time += dt;
    const p = game.player;
    const vs = game.vehicles;

    for (let i = 0; i < vs.length; i++) {
      const v = vs[i];
      if (v.asleep) continue;
      v.px = v.x;
      v.pz = v.z;
      v.pheading = v.heading;
      const controls = v === p.vehicle && p.mode === 'car' ? input : v.controls || null;
      stepVehicle(v, controls, dt, game.world);
      if (v.impact > 0) events.emit('vehicleImpact', v, v.impact);
      // A parked car that has settled goes back to sleep.
      if (!v.driver && !v.controls && Math.abs(v.speed) < 0.02 && Math.abs(v.yawRate) < 0.02) {
        v.asleep = true;
        v.meshDirty = true;
      }
    }
    for (let i = 0; i < vs.length; i++) {
      const a = vs[i];
      for (let j = i + 1; j < vs.length; j++) {
        const b = vs[j];
        if (a.asleep && b.asleep) continue;
        if (collideVehicles(a, b)) {
          a.asleep = false;
          b.asleep = false;
          events.emit('vehicleCrash', a, b, Math.max(a.impact, b.impact));
        }
      }
    }

    if (p.mode === 'car' && p.vehicle) {
      p.x = p.vehicle.x;
      p.z = p.vehicle.z;
      p.heading = p.vehicle.heading;
    }
    for (let i = 0; i < game.systems.length; i++) {
      const s = game.systems[i];
      if (s.fixedUpdate) s.fixedUpdate(dt);
    }
    input.endStep();
  }

  // --- Drawing step. ---
  let lastDistrict = '';
  function render(alpha, dt) {
    const p = game.player;
    const vs = game.vehicles;
    for (let i = 0; i < vs.length; i++) {
      const v = vs[i];
      if (v.asleep && !v.meshDirty) continue;
      updateVehicleMesh(v.mesh, v, v.asleep ? 1 : alpha);
      v.meshDirty = false;
    }
    if (p.mode === 'car' && p.vehicle) {
      const v = p.vehicle;
      setVehicleLights(v.mesh, { brake: v.brake > 0.1 || v.handbrake, siren: false, time: game.time });
      camTarget.x = v.px + (v.x - v.px) * alpha;
      camTarget.z = v.pz + (v.z - v.pz) * alpha;
      camTarget.heading = v.heading;
      camTarget.speed = v.speed;
      camTarget.height = 1.2;
    }
    chase.update(camTarget, dt, input, collision);

    for (let i = 0; i < game.systems.length; i++) {
      const s = game.systems[i];
      if (s.render) s.render(alpha, dt);
    }

    const h = game.hudState;
    h.mode = p.mode;
    h.speedKmh = p.mode === 'car' && p.vehicle ? Math.abs(p.vehicle.speed) * 3.6 : 0;
    h.health = p.health;
    h.armor = p.armor;
    h.money = p.money;
    h.wanted = p.wanted;
    h.vehicleHealth = p.mode === 'car' && p.vehicle ? Math.max(0, p.vehicle.health / p.vehicle.spec.health) : null;
    const dKey = city.shoreDist(p.x, p.z) < 34 && !city.onRoad(p.x, p.z) ? 'shore' : city.districtOf(p.x, p.z);
    h.district = dKey === 'shore' ? 'The Strand' : DISTRICTS[dKey].name;
    if (h.district !== lastDistrict) {
      lastDistrict = h.district;
      events.emit('district', h.district);
    }
    hud.update(h);
    renderer.render(scene, camera);
  }

  function resize() {
    const w = window.innerWidth, h = window.innerHeight;
    // Phones report very high pixel densities; cap the drawn height so
    // the frame rate stays smooth.
    const cap = (900 * game.quality) / Math.max(1, h);
    renderer.setPixelRatio(Math.max(0.75, Math.min(window.devicePixelRatio || 1, cap)));
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  window.addEventListener('resize', resize);
  window.addEventListener('orientationchange', resize);
  resize();

  // Pause automatically when the page is hidden.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && !game.paused) {
      game.paused = true;
      events.emit('pause', true);
    }
  });

  game.loop = createLoop({ fixedUpdate, render });
  game.resize = resize;
  game.step = fixedUpdate; // for tests
  game.draw = render;
  return game;
}
