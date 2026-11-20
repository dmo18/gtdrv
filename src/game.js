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
import { createMapUi } from './systems/mapui.js';
import { createAudio } from './systems/audio.js';
import { createPeds } from './systems/peds.js';
import { createFleet } from './systems/fleet.js';
import { stepBoat, collideBoats } from './entities/boat.js';
import { createBoatMesh, updateBoatMesh } from './render/boatmesh.js';
import { createWater, createWakeTrail } from './render/water.js';
import { createWalker, stepWalker, findEnterable, exitPosition } from './entities/onfoot.js';
import { createPersonMesh, updatePersonMesh } from './render/personmesh.js';

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
  const cityMesh = buildCityMesh(city, collision);
  scene.add(cityMesh);
  // Animated sea in place of the flat placeholder. Sea level sits a
  // little below the land so waves never wash over the beach.
  const SEA_Y = -0.6;
  cityMesh.remove(cityMesh.userData.water);
  const water = createWater({});
  const sea = new THREE.Group();
  sea.position.y = SEA_Y;
  sea.add(water.mesh);
  scene.add(sea);
  const wake = createWakeTrail(sea);

  const waterCollision = createCollisionWorld();
  for (const r of city.piers) waterCollision.addBox(r.x0, r.z0, r.x1, r.z1, 2, 'pier');

  const game = {
    city, collision, waterCollision, events, input, rng, renderer, scene, camera,
    lights: { hemi, sun },
    world: { collision, waterCollision, city, time: 0, crafts: null },
    // How each kind of craft is simulated and drawn. Boats and aircraft
    // register themselves here.
    kinds: {
      car: { step: stepVehicle, createMesh: createVehicleMesh, updateMesh: updateVehicleMesh },
      boat: { step: stepBoat, createMesh: createBoatMesh, updateMesh: updateBoatMesh },
    },
    vehicles: [],
    systems: [],
    time: 0, // simulated seconds since start
    paused: false,
    quality: 1,
    player: {
      mode: 'car', // 'foot', or the kind of craft being driven
      vehicle: null,
      walker: null,
      y: 0,
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
      const kind = game.kinds[v.kind];
      v.mesh = kind.createMesh(v.spec, v.color);
      v.meshDirty = true;
      scene.add(v.mesh);
      game.vehicles.push(v);
      kind.updateMesh(v.mesh, v, 1, game.time);
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
  const camTarget = { x: car.x, z: car.z, y: 0, heading: car.heading, pitch: 0, roll: 0, speed: 0, height: 1.2 };
  game.camHeading = car.heading;
  game.camTarget = camTarget;
  chase.snap(camTarget);

  injectStyles();
  const touch = createTouchControls(uiRoot, input);
  const hud = createHud(uiRoot);
  game.touch = touch;
  game.hud = hud;
  attachKeyboard(input);
  touch.setMode('car');

  game.world.crafts = game.vehicles;

  // --- The player on foot. ---
  const p0 = game.player;
  p0.walker = createWalker(p0.x, p0.z, p0.heading);
  const personMesh = createPersonMesh({ shirt: 0xe2733a, trousers: 0x2b3440, skin: 0xc68e62, hair: 0x2a1c14 });
  personMesh.visible = false;
  scene.add(personMesh);
  const exitSpot = { x: 0, z: 0, ok: false };
  const uiModeFor = (kind) => kind;

  game.setPlayerMode = (mode) => {
    const p = game.player;
    p.mode = mode;
    touch.setMode(uiModeFor(mode));
    chase.setMode(mode);
    personMesh.visible = mode === 'foot';
    events.emit('mode', mode);
  };
  game.enterVehicle = (v) => {
    const p = game.player;
    v.driver = 'player';
    v.asleep = false;
    v.parked = false;
    p.vehicle = v;
    game.setPlayerMode(v.kind);
    events.emit('enter', v);
  };
  game.exitVehicle = () => {
    const p = game.player;
    const v = p.vehicle;
    if (!v) return false;
    if (Math.abs(v.speed) > 3 || v.y > 0.6) {
      hud.toast(v.y > 0.6 ? 'Land first' : 'Slow down to get out', 1.5);
      return false;
    }
    exitPosition(v, game.world, exitSpot);
    if (!exitSpot.ok) {
      hud.toast(v.kind === 'boat' ? 'Pull up to a pier to get out' : 'No room to get out here', 2);
      return false;
    }
    v.driver = null;
    const w = p.walker;
    w.x = w.px = exitSpot.x;
    w.z = w.pz = exitSpot.z;
    w.heading = w.pheading = v.heading;
    w.vx = w.vz = 0;
    p.vehicle = null;
    game.setPlayerMode('foot');
    events.emit('exit', v);
    return true;
  };

  game.addSystem(createParkedCars(game));
  game.map = game.addSystem(createMapUi(game, uiRoot));
  game.audio = game.addSystem(createAudio(game));
  game.peds = game.addSystem(createPeds(game));
  game.fleet = game.addSystem(createFleet(game));

  // --- Simulation step. ---
  function fixedUpdate(dt) {
    input.poll();
    if (input.consume('pause')) {
      game.paused = !game.paused;
      events.emit('pause', game.paused);
    }
    for (let i = 0; i < game.systems.length; i++) {
      const s = game.systems[i];
      if (s.always) s.always(dt);
    }
    if (game.paused) {
      input.endStep();
      return;
    }
    game.time += dt;
    game.world.time = game.time;
    const p = game.player;
    const vs = game.vehicles;

    for (let i = 0; i < vs.length; i++) {
      const v = vs[i];
      if (v.asleep) continue;
      v.px = v.x;
      v.pz = v.z;
      v.pheading = v.heading;
      const controls = v === p.vehicle ? input : v.controls || null;
      game.kinds[v.kind].step(v, controls, dt, game.world);
      if (v.impact > 0) events.emit('vehicleImpact', v, v.impact);
      // A parked car that has settled goes back to sleep.
      if (v.kind === 'car' && !v.driver && !v.controls && Math.abs(v.speed) < 0.02 && Math.abs(v.yawRate) < 0.02) {
        v.asleep = true;
        v.meshDirty = true;
      }
    }
    for (let i = 0; i < vs.length; i++) {
      const a = vs[i];
      for (let j = i + 1; j < vs.length; j++) {
        const b = vs[j];
        if (a.asleep && b.asleep) continue;
        if (a.kind !== b.kind) continue;
        if (a.kind === 'boat') {
          if (collideBoats(a, b)) events.emit('vehicleCrash', a, b, Math.max(a.impact, b.impact));
          continue;
        }
        if (a.kind !== 'car') continue;
        if (collideVehicles(a, b)) {
          a.asleep = false;
          b.asleep = false;
          events.emit('vehicleCrash', a, b, Math.max(a.impact, b.impact));
        }
      }
    }

    if (p.vehicle) {
      p.x = p.vehicle.x;
      p.z = p.vehicle.z;
      p.y = p.vehicle.y || 0;
      p.heading = p.vehicle.heading;
      if (input.consume('enter')) game.exitVehicle();
    } else {
      const w = p.walker;
      w.px = w.x;
      w.pz = w.z;
      w.pheading = w.heading;
      stepWalker(w, input, dt, game.world, game.camHeading);
      p.x = w.x;
      p.z = w.z;
      p.y = 0;
      p.heading = w.heading;
      p.near = findEnterable(w, vs);
      if (input.consume('enter') && p.near) game.enterVehicle(p.near);
    }
    for (let i = 0; i < game.systems.length; i++) {
      const s = game.systems[i];
      if (s.fixedUpdate) s.fixedUpdate(dt);
    }
    input.endStep();
  }

  // --- Drawing step. ---
  let lastDistrict = '';
  let promptFor = null;
  let wakeTick = 0;
  function render(alpha, dt) {
    const p = game.player;
    const vs = game.vehicles;
    for (let i = 0; i < vs.length; i++) {
      const v = vs[i];
      if (v.asleep && !v.meshDirty) continue;
      game.kinds[v.kind].updateMesh(v.mesh, v, v.asleep ? 1 : alpha, game.time);
      if (v.kind === 'boat') {
        v.mesh.position.y += SEA_Y;
        if (v.wake > 0.15 && (wakeTick + v.id) % 4 === 0) wake.emit(v.x - Math.cos(v.heading) * v.spec.length * 0.45, v.z - Math.sin(v.heading) * v.spec.length * 0.45, v.heading, v.wake);
      }
      v.meshDirty = false;
    }
    wakeTick++;
    water.update(game.time, camera.position);
    wake.update(dt, game.time);
    if (p.vehicle) {
      const v = p.vehicle;
      if (v.kind === 'car') setVehicleLights(v.mesh, { brake: v.brake > 0.1 || v.handbrake, siren: false, time: game.time });
      camTarget.x = v.px + (v.x - v.px) * alpha;
      camTarget.z = v.pz + (v.z - v.pz) * alpha;
      camTarget.y = v.py + (v.y - v.py) * alpha;
      camTarget.heading = v.heading;
      camTarget.pitch = v.kind === 'car' ? 0 : v.pitch;
      camTarget.roll = v.kind === 'car' ? 0 : v.roll;
      camTarget.speed = v.speed;
      camTarget.height = 1.2;
      hud.setPrompt(null);
    } else {
      const w = p.walker;
      updatePersonMesh(personMesh, w, alpha);
      camTarget.x = w.px + (w.x - w.px) * alpha;
      camTarget.z = w.pz + (w.z - w.pz) * alpha;
      camTarget.y = 0;
      camTarget.heading = w.heading;
      camTarget.pitch = 0;
      camTarget.roll = 0;
      camTarget.speed = w.speed;
      camTarget.height = 1.5;
      if (p.near !== promptFor) {
        promptFor = p.near;
        hud.setPrompt(p.near ? `Tap ENTER: ${p.near.spec.label}` : null);
      }
    }
    chase.update(camTarget, dt, input, collision);
    game.camHeading = Math.atan2(camTarget.z - camera.position.z, camTarget.x - camera.position.x);

    for (let i = 0; i < game.systems.length; i++) {
      const s = game.systems[i];
      if (s.render) s.render(alpha, dt);
    }

    const h = game.hudState;
    h.mode = p.mode === 'foot' ? 'foot' : 'car';
    h.speedKmh = p.vehicle ? Math.abs(p.vehicle.speed) * 3.6 : 0;
    h.health = p.health;
    h.armor = p.armor;
    h.money = p.money;
    h.wanted = p.wanted;
    h.vehicleHealth = p.vehicle ? Math.max(0, p.vehicle.health / p.vehicle.spec.health) : null;
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
