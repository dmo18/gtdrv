// The game itself: owns the world, the vehicles, the player and the
// list of systems, and runs them each step.
import * as THREE from 'three';
import { generateCity } from './world/citygen.js';
import { hudPlace } from './world/maps.js';
import { createCollisionWorld } from './world/collision.js';
import { buildCityMesh } from './render/citymesh.js';
import { buildRealCity } from './render/realcity.js';
import { createTextures } from './render/textures.js';
import { createInput, attachKeyboard } from './core/input.js';
import { defaultProgress } from './core/save.js';
import { respawnPlacement } from './core/health.js';
import { createLoop } from './core/loop.js';
import { createErrorLog, consoleLog } from './core/errorlog.js';
import { createEvents } from './core/events.js';
import { createRng } from './core/rng.js';
import { createVehicle, stepVehicle, collideVehicles } from './entities/vehicle.js';
import { createVehicleMesh, updateVehicleMesh, setVehicleLights, FLEET_L2_M } from './render/vehiclemesh.js';
import { createChaseCamera } from './render/chasecam.js';
import { createTitleCam, titlePose } from './render/titlecam.js';
import { createTouchControls } from './ui/touch.js';
import { createHud } from './ui/hud.js';
import { injectStyles } from './ui/styles.js';
import { createParkedCars } from './systems/parked.js';
import { createMapUi } from './systems/mapui.js';
import { createAudio } from './systems/audio.js';
import { createRadio } from './systems/radio.js';
import { createPeds } from './systems/peds.js';
import { createFleet } from './systems/fleet.js';
import { createEconomy } from './systems/economy.js';
import { createTraffic } from './systems/traffic.js';
import { createDayNight } from './systems/daynight.js';
import { createActivities } from './systems/activities.js';
import { createPolice, resetHeat } from './systems/police.js';
import { createCombat, layDown, warmCombat } from './systems/combat.js';
import { createCrew } from './systems/crew.js';
import { createMissions } from './systems/missions.js';
import { createScore } from './systems/score.js';
import { createStunts } from './systems/stunts.js';
import { createCombatFx } from './render/combatfx.js';
import { createCombatHud } from './ui/combathud.js';
import { createCinematic } from './systems/cinematic.js';
import { createTutorial } from './systems/tutorial.js';
import { createObjective } from './systems/objective.js';
import { createEffects } from './render/effects.js';
import { createGraphics } from './render/graphics.js';
import { wantsAntialias } from './render/adaptres.js';
import { createMenu } from './ui/menu.js';
import { stepBoat, collideBoats } from './entities/boat.js';
import { createBoatMesh, updateBoatMesh } from './render/boatmesh.js';
import { createWater, createWakeTrail } from './render/water.js';
import { stepAircraft, collideAircraft } from './entities/aircraft.js';
import { createAircraftMesh, updateAircraftMesh } from './render/aircraftmesh.js';
import { createWalker, stepWalker, findEnterable, exitPosition } from './entities/onfoot.js';
// Tank (task 32): tracked craft, its mesh and the armor system.
import { stepTank, collideTank } from './entities/tank.js';
import { createTankMesh, updateTankMesh } from './render/tankmesh.js';
import { createArmor } from './systems/armor.js';
import { createPersonMesh, updatePersonMesh } from './render/personmesh.js';
// Police helicopter pilots and the fighter's shock ring (task 33).
import { createHeliPilots } from './systems/helipilot.js';
import { createJetFx } from './render/jetfx.js';
// Carjacking (core/carjack.js) and the saved place, craft and garage.
import { createCarjack } from './systems/carjack.js';
// Service vehicles: extras, beacons, homes and their look (docs/REVAMP.md 6.11).
import { createService } from './systems/service.js';
import { createSession } from './systems/session.js';
import { createSecrets } from './systems/secrets.js';
// Garages, adventures and exploring on the Miami map (docs/REVAMP.md 6.6).
import { attachExplore } from './world/adventures.js';
import { createAdventures } from './systems/adventures.js';
import { createGarages, favoriteCar } from './systems/garages.js';
import { registerExploreScreens } from './ui/explore.js';
import { SEA_LEVEL } from './world/ground.js';
import { createRotationGate } from './core/launch.js';

const SKY = 0x9fc8e8;
// Street tiles built before the first frame (docs/PERF.md, 0.13.8
// start): pairs of (m ahead of the first view's camera along its view,
// reach m; a tile's distance counts the camera height): the tiles round
// the camera and two points down the view. The other near tiles stream
// in round the camera (behind the title on a phone).
export const START_AT = [0, 40, 80, 5, 160, 5];
// Tile building time a frame (ms): while the title shows (nothing to
// steer yet) the streamer gets more, so the near tiles are done sooner.
const STREAM_MS = 3, STREAM_TITLE_MS = 6;
// Cars past this (m) are drawn as a body only (no wheels or lamps; a fleet
// body as its L2 shell): FLEET_L2_M, where the fleet's own levels put it
// (was 75 m, 0.13.8).
const CAR_FAR_M = FLEET_L2_M;
// The wake trail's foam lives under 5.8 s (render/water.js).
const WAKE_IDLE = 6;

// city: a ready-made city object (the Miami map, see world/maps.js);
// left out, the procedural island is generated as before.
//
// The build runs as a generator (createGameSteps) that yields { label, pct }
// between stages, so main.js can give the browser a turn and draw a real
// progress bar; createGame runs it straight through (tests, tools).
export function createGame(opts) {
  const it = createGameSteps(opts);
  let r = it.next();
  while (!r.done) r = it.next();
  return r.value;
}

export function* createGameSteps({ canvas, uiRoot, city: givenCity = null }) {
  yield { label: 'Preparing', pct: 2 };
  const rng = createRng(77123);
  const city = givenCity || generateCity();
  const collision = createCollisionWorld();
  const events = createEvents();
  const input = createInput();

  // --- Drawing setup. ---
  // Multisampling only where pixels are big (ratio <= 1.5); on denser
  // phone screens the adaptive resolution keeps edges clean instead.
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: wantsAntialias(window.devicePixelRatio || 1), powerPreference: 'high-performance' });
  const scene = new THREE.Scene();
  scene.background = new THREE.Color().setHex(SKY, THREE.SRGBColorSpace);
  scene.fog = new THREE.Fog(scene.background.getHex(), 220, 1050);
  const camera = new THREE.PerspectiveCamera(62, 1, 0.5, 1800);
  const hemi = new THREE.HemisphereLight(0xe4f1ff, 0x8a8272, 1.9);
  const sun = new THREE.DirectionalLight(0xfff0d8, 1.7);
  sun.position.set(0.55, 1, 0.35);
  scene.add(hemi, sun);
  // Garages, adventures and locked routes go on a real map before its
  // tiles are dressed (lot dressing skips the garage rects).
  attachExplore(city);
  yield { label: 'Painting textures', pct: 8 };
  // A real map (city.landGrid) is streamed in tiles round the camera. Its
  // textures are drawn in their own stage (the same set buildRealCity makes).
  let textures = null;
  if (city.landGrid && typeof document !== 'undefined') {
    const sn = city.streetNames;
    const names = sn ? sn.plates || [...sn.x.slice(0, 16), ...sn.z.slice(0, 16)] : [];
    textures = createTextures(city.seed + 7, names);
  }
  yield { label: 'Building streets', pct: 20 };
  // A real map: the far level and the whole map's collision here, then only
  // the street tiles the first view stands on, one stage each (the rest
  // stream in round the camera, behind the title on a phone).
  const cityMesh = city.landGrid ? buildRealCity(city, collision, { ...(textures ? { textures } : {}), startNear: -1 }) : buildCityMesh(city, collision);
  const stream0 = cityMesh.userData.stream;
  if (stream0) {
    // The tiles the first view sees close: round the title shot's camera
    // (the designed start view) or the start, and two points ahead.
    const sv = city.startView, sp = city.spawn;
    const pose = sv && sv.camera ? titlePose(sv, 0, true, { x: 0, y: 0, z: 0, lx: 0, ly: 0, lz: 0, fov: 0 }) : null;
    const x0 = pose ? pose.x : sp.x, z0 = pose ? pose.z : sp.z;
    const h = pose ? Math.atan2(pose.lz - pose.z, pose.lx - pose.x) : sp.heading || 0;
    const at = { position: { x: 0, y: 2, z: 0 } };
    let n = 0;
    for (let k = 0; k < START_AT.length; k += 2) {
      at.position.x = x0 + Math.cos(h) * START_AT[k];
      at.position.z = z0 + Math.sin(h) * START_AT[k];
      while (n < 6 && stream0.flush(at, START_AT[k + 1], true)) yield { label: 'Building streets', pct: 26 + 2 * n++ };
    }
    // The spawn itself, when the title shot looks from elsewhere: a quick
    // tap on Play must not stand on unbuilt ground.
    if (pose) {
      at.position.x = sp.x;
      at.position.z = sp.z;
      while (n < 8 && stream0.flush(at, 40, true)) yield { label: 'Building streets', pct: 26 + 2 * n++ };
    }
  }
  yield { label: 'Building streets', pct: 40 };
  scene.add(cityMesh);
  // Animated sea in place of the flat placeholder. Sea level sits a
  // little below the land so waves never wash over the beach.
  const SEA_Y = SEA_LEVEL; // world/ground.js: the one water surface
  cityMesh.remove(cityMesh.userData.water);
  const water = createWater({});
  // Draw the sea "behind" the land wherever the two nearly touch, so
  // distant shorelines do not flicker.
  for (const m of [water.near, water.far]) {
    if (m && m.material) {
      m.material.polygonOffset = true;
      m.material.polygonOffsetFactor = 6;
      m.material.polygonOffsetUnits = 6;
    }
  }
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
      plane: { step: stepAircraft, createMesh: createAircraftMesh, updateMesh: updateAircraftMesh },
      heli: { step: stepAircraft, createMesh: createAircraftMesh, updateMesh: updateAircraftMesh },
      tank: { step: stepTank, createMesh: createTankMesh, updateMesh: updateTankMesh },
    },
    vehicles: [],
    actors: [], // every live person (combat actors, see docs/COMBAT.md)
    aim: { dx: 1, dy: 0, dz: 0, manual: false }, // set by the aiming controls
    systems: [],
    resizeHooks: [], // functions (width, height, pixelRatio) called on resize
    renderFrame: null, // optional replacement for the final draw call
    // performance.now() (ms) at the first step of the frame being drawn, -1
    // when not known: the graphics module times the frame's JavaScript from
    // it to the draw (adaptive resolution); never read by game logic.
    frameStartMs: -1,
    // Errors caught round each system and at the frame loop (shown once each).
    errors: createErrorLog({ log: consoleLog }),
    time: 0, // simulated seconds since start
    clock: 9, // time of day in hours, 0..24 (the day/night system advances it)
    cityMesh,
    waypoint: null,
    // A map with its own activity list (Miami: none yet); null builds the
    // procedural courses (systems/activities.js).
    courses: Array.isArray(city.courses) ? city.courses : null,
    // Everything that is saved between sessions lives here.
    // Score, medals, best times and settings (no money: everything is
    // available from the start). The economy system loads a saved copy
    // into this same object when the game starts.
    progress: defaultProgress(),
    paused: false,
    quality: 1,
    player: {
      mode: 'car', // 'foot', or the kind of craft being driven
      vehicle: null,
      walker: null,
      y: 0,
      x: city.spawn.x, z: city.spawn.z, heading: city.spawn.heading,
      health: 100, armor: 0, wanted: 0,
    },
    hudState: {
      mode: 'car', speedKmh: 0, health: 100, armor: 0, wanted: 0,
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
      // Never leave the player sitting in a craft that is gone (its mesh is
      // dropped below): out onto the spot where it was.
      if (v && v === game.player.vehicle) {
        const p = game.player, w = p.walker;
        v.driver = null;
        p.vehicle = null;
        if (w) {
          w.x = w.px = v.x;
          w.z = w.pz = v.z;
          w.heading = w.pheading = v.heading;
          w.vx = w.vz = 0;
        }
        if (game.setPlayerMode) game.setPlayerMode('foot');
        events.emit('exit', v);
      }
      const i = game.vehicles.indexOf(v);
      if (i >= 0) game.vehicles.splice(i, 1);
      if (v.mesh) scene.remove(v.mesh);
      v.mesh = null;
      v.removed = true;
      events.emit('vehicleRemoved', v);
    },
  };

  // Work the first view does not need, done after the first frames of
  // play, one job a drawn frame (game.later(fn), in the order given):
  // what it makes is never read by the simulation's answers, only its
  // cost moves out of the start (0.13.9 hitches and start).
  const laterJobs = [];
  let drawnFrames = 0;
  game.later = (fn) => { laterJobs.push(fn); };
  function runLater() {
    const f = laterJobs.shift();
    try {
      f();
    } catch (e) {
      game.errors.report('later', e);
    }
  }

  // --- Player starts in a car on the street. ---
  const car = createVehicle('sedan', city.spawn.x, city.spawn.z, city.spawn.heading, rng);
  car.driver = 'player';
  car.starter = true; // the untouched first car: Start (session.startFresh) removes it
  game.addVehicle(car);
  game.player.vehicle = car;

  const chase = createChaseCamera(camera);
  game.chase = chase;
  // The title shot (6.8) and the blend from it to the chase camera.
  const titleCam = createTitleCam(camera, chase);
  game.titleCam = titleCam;
  const camTarget = { x: car.x, z: car.z, y: 0, heading: car.heading, pitch: 0, roll: 0, speed: 0, height: 1.2, vehicle: null };
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
  personMesh.rotation.order = 'YXZ'; // lets the knock-down pose tip it over
  scene.add(personMesh);
  const exitSpot = { x: 0, z: 0, ok: false };
  const uiModeFor = (kind) => kind;

  // Nearest safe standing spot on land: walk a line from the given
  // point toward the closer of the main island and the airfield.
  const landAim = { x: 0, z: 0 };
  function findRescueSpot(x, z, out) {
    const islet = city.airfield && city.airfield.islet;
    const ix = islet ? (islet.x0 + islet.x1) / 2 : 0, iz = islet ? (islet.z0 + islet.z1) / 2 : 0;
    const toIslet = !!islet && Math.hypot(x - ix, z - iz) < Math.hypot(x, z) - 500;
    let tx = toIslet ? ix : 0, tz = toIslet ? iz : 0;
    // A real map has no land at the origin: aim for the nearest dry land.
    if (city.landTarget) {
      city.landTarget(x, z, landAim);
      tx = landAim.x;
      tz = landAim.z;
    }
    const d = Math.hypot(tx - x, tz - z) || 1;
    const ux = (tx - x) / d, uz = (tz - z) / d;
    out.x = tx;
    out.z = tz;
    out.ok = true;
    for (let t = 0; t < d; t += 3) {
      const px = x + ux * t, pz = z + uz * t;
      if (city.shoreDist(px, pz) > 4 && !collision.resolveCircle(px, pz, 0.6, 0).hit) {
        out.x = px;
        out.z = pz;
        break;
      }
    }
    return out;
  }

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
    // A craft already taken off the map (swept, towed in, a hull gone) has
    // no mesh any more: driving it would break every draw.
    if (!v || v.removed || !v.mesh) return false;
    v.driver = 'player';
    v.asleep = false;
    v.parked = false;
    p.vehicle = v;
    game.setPlayerMode(v.kind);
    events.emit('enter', v);
    return true;
  };
  game.findRescueSpot = findRescueSpot;
  // ENTER on a craft: empty ones are entered at once, occupied ones are
  // carjacked (systems/carjack.js runs the sequence and enters at the end).
  game.tryEnterVehicle = (v) => {
    if (v.driver && v.driver !== 'player' && game.carjack) return game.carjack.start(v);
    game.enterVehicle(v);
    return true;
  };
  // Test hook: put a fresh car on the map and keep it from being swept away.
  game.debug = {
    spawnCar(specId, x, z, heading = 0) {
      const v = createVehicle(specId, x, z, heading, rng);
      v.home = { craft: v };
      return game.addVehicle(v);
    },
    // A parked car with somebody at the wheel (team: 'civ' | 'police' | 'crew').
    spawnOccupied(specId, x, z, heading = 0, team = 'civ') {
      const v = game.debug.spawnCar(specId, x, z, heading);
      v.driver = { dead: false, debug: true };
      v.ai = v.driver;
      v.occupantTeam = team;
      v.controls = { steer: 0, throttle: 0, brake: 1, handbrake: true };
      return v;
    },
  };
  game.exitVehicle = () => {
    const p = game.player;
    const v = p.vehicle;
    if (!v) return false;
    // Cars and boats: jump out at any speed (the car keeps going). Aircraft must land first.
    const aircraft = v.kind === 'plane' || v.kind === 'heli';
    if (!v.wrecked && aircraft && (v.y > 0.6 || Math.abs(v.speed) > 3)) {
      hud.toast(v.y > 0.6 ? 'Land first' : 'Slow down to get out', 1.5);
      return false;
    }
    const rolling = Math.abs(v.speed) > 1;
    exitPosition(v, game.world, exitSpot);
    if (!exitSpot.ok && (v.wrecked || v.kind === 'plane' || v.kind === 'heli')) {
      // Stranded (ditched at sea, wrecked boat): a rescue back to dry land.
      findRescueSpot(v.x, v.z, exitSpot);
      hud.toast('Rescued! Back on dry land.', 2.5);
    }
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
    if (rolling) {
      // Hop out in the car's direction of travel, with a bit of its speed.
      const sp = v.speed, h = v.heading;
      w.vx = Math.cos(h) * sp * 0.5;
      w.vz = Math.sin(h) * sp * 0.5;
    }
    p.vehicle = null;
    game.setPlayerMode('foot');
    events.emit('exit', v);
    return true;
  };

  yield { label: 'Placing traffic', pct: 50 };
  game.addSystem(createParkedCars(game));
  game.map = game.addSystem(createMapUi(game, uiRoot));
  game.audio = game.addSystem(createAudio(game));
  game.radio = game.addSystem(createRadio(game, uiRoot));
  game.peds = game.addSystem(createPeds(game));
  // Saved progress (score, medals, best times, settings) lives in the
  // browser's own storage on this device. Some private modes forbid it.
  let storage;
  try {
    storage = window.localStorage;
  } catch {
    storage = null;
  }
  game.economy = game.addSystem(createEconomy(game, storage));
  game.session = game.addSystem(createSession(game, storage));
  yield { label: 'Placing traffic', pct: 60 };
  game.fleet = game.addSystem(createFleet(game));
  game.traffic = game.addSystem(createTraffic(game));
  // The designed first view: moving cars on the start street (6.8).
  if (city.startView) game.traffic.seedStart(city.startView.traffic);
  game.daynight = game.addSystem(createDayNight(game));
  game.seaY = SEA_Y;
  game.activities = game.addSystem(createActivities(game, uiRoot));
  game.police = game.addSystem(createPolice(game));
  // Combat core and the systems built on it. Registered once here; the
  // later combat tasks fill these files without touching this one.
  yield { label: 'Setting the scene', pct: 70 };
  game.combat = game.addSystem(createCombat(game));
  // The first hit rehearsed on a stand-in (systems/combat.js warmCombat:
  // nothing of the game changes), so the first real one costs no
  // first-run code (11 to 15 ms at 4x).
  game.later(() => warmCombat(city, city.spawn.x, city.spawn.z, city.spawn.heading || 0));
  game.crew = game.addSystem(createCrew(game));
  game.carjack = game.addSystem(createCarjack(game)); // after traffic, police and crew: it holds the car still
  game.service = game.addSystem(createService(game)); // after combat: water-downed people, hulls put out, the tow
  game.armor = game.addSystem(createArmor(game, uiRoot));
  game.helipilot = game.addSystem(createHeliPilots(game));
  game.missions = game.addSystem(createMissions(game, uiRoot));
  game.score = game.addSystem(createScore(game));
  game.stunts = game.addSystem(createStunts(game, Array.isArray(city.rampSpots) ? { spots: city.rampSpots } : {})); // ramps, jumps and stunt medals (after score)
  game.secrets = game.addSystem(createSecrets(game));
  // Exploring (after score and stunts): game.explore, then the garages on it.
  yield { label: 'Setting the scene', pct: 80 };
  game.adventures = game.addSystem(createAdventures(game, storage));
  game.garages = game.addSystem(createGarages(game));
  game.favoriteCar = () => favoriteCar(game);
  // Downed and back: fresh at a quiet road, police lose interest, nothing lost.
  let snapCam = false;
  game.snapCam = () => { snapCam = true; };
  // A broken prop leaves its street tile (drawn again without it).
  events.on('propBreak', (b) => {
    const st = cityMesh.userData.stream;
    if (st && st.propBreak) st.propBreak(b.x, b.z);
  });
  events.on('respawn', () => {
    if (game.police && game.police.heat) resetHeat(game.police.heat, 3);
    game.player.wanted = 0;
    snapCam = true;
  });
  // RESPAWN button: out of any craft (it stays where it is), onto dry land, full health.
  const spawnSpot = { x: 0, z: 0, ok: false, craftSide: false };
  game.respawnPlayer = () => {
    const p = game.player;
    const w = p.walker;
    if (game.carjack && game.carjack.cancel) game.carjack.cancel();
    const v = p.vehicle;
    const combat = game.combat;
    respawnPlacement(!!v, p.x, p.z, p.heading, findRescueSpot, (x, z, out) => combat.respawnSpot(x, z, out), spawnSpot);
    if (v) {
      v.driver = null;
      p.vehicle = null;
      w.heading = w.pheading = v.heading;
      game.setPlayerMode('foot');
      events.emit('exit', v);
    }
    combat.reviveAt(spawnSpot.x, spawnSpot.z);
    hud.toast('Respawned', 1.5);
  };
  game.addSystem(createTutorial(game));
  game.objective = game.addSystem(createObjective(game, uiRoot));
  yield { label: 'Lighting', pct: 90 };
  game.graphics = game.addSystem(createGraphics(game));
  game.effects = game.addSystem(createEffects(game));
  game.combatFx = game.addSystem(createCombatFx(game));
  game.jetFx = game.addSystem(createJetFx(game));
  game.combatHud = game.addSystem(createCombatHud(game, uiRoot));
  // Slow motion on big kills, pull-back camera on blasts (game.timeScale).
  game.cinematic = game.addSystem(createCinematic(game, uiRoot));
  game.menu = createMenu(uiRoot, game, game.economy);
  registerExploreScreens(game);

  // --- Simulation step. ---
  function fixedUpdate(dt) {
    // Lets button and tilt steering ramp smoothly, independent of frame rate.
    touch.update(dt);
    input.poll();
    if (input.consume('pause') && !(game.map && game.map.fullMap.isOpen())) {
      game.paused = !game.paused;
      events.emit('pause', game.paused);
    }
    for (let i = 0; i < game.systems.length; i++) {
      const s = game.systems[i];
      if (!s.always) continue;
      try {
        s.always(dt);
      } catch (e) {
        game.errors.report(s.name + '.always', e);
      }
    }
    if (game.paused) {
      input.endStep();
      return;
    }
    game.time += dt;
    game.world.time = game.time;
    game.world.weather = game.weather || null;
    if (input.consume('respawn')) game.respawnPlayer();
    if (input.consume('radio') && game.radio) game.radio.cycle();
    if (input.consume('camera')) {
      hud.toast('Camera: ' + chase.cycleView(), 1.2);
    }
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
      if (v.boostOn !== undefined && v.boostOn !== !!v.boostSeen) {
        v.boostSeen = v.boostOn;
        events.emit('boost', { craft: v.kind, on: v.boostOn, vehicle: v });
      }
      if (v.impact > 0) events.emit('vehicleImpact', v, v.impact);
      // A parked car that has settled goes back to sleep.
      if ((v.kind === 'car' || v.kind === 'tank') && !v.driver && !v.controls && Math.abs(v.speed) < 0.02 && Math.abs(v.yawRate) < 0.02) {
        v.asleep = true;
        v.meshDirty = true;
      }
    }
    for (let i = 0; i < vs.length; i++) {
      const a = vs[i];
      for (let j = i + 1; j < vs.length; j++) {
        const b = vs[j];
        if (a.asleep && b.asleep) continue;
        const aAir = a.kind === 'plane' || a.kind === 'heli';
        const bAir = b.kind === 'plane' || b.kind === 'heli';
        if (aAir || bAir) {
          // Only aircraft that are moving need checking against others.
          if (aAir && (a.driver || Math.abs(a.speed) > 1) && collideAircraft(a, b)) {
            b.asleep = false;
            events.emit('vehicleCrash', a, b, Math.max(a.impact, b.impact));
          } else if (bAir && (b.driver || Math.abs(b.speed) > 1) && collideAircraft(b, a)) {
            a.asleep = false;
            events.emit('vehicleCrash', a, b, Math.max(a.impact, b.impact));
          }
          continue;
        }
        // Tanks shove, ram and crush any ground craft (docs/ARMS.md section 3).
        if (a.kind === 'tank' || b.kind === 'tank') {
          if ((a.kind === 'tank' ? collideTank(a, b) : collideTank(b, a)) && Math.max(a.impact, b.impact) > 1) events.emit('vehicleCrash', a, b, Math.max(a.impact, b.impact));
          continue;
        }
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
      // Count take-offs for the records screen.
      const flying = (p.vehicle.kind === 'plane' || p.vehicle.kind === 'heli') && p.y > 8;
      if (flying && !wasFlying) {
        game.progress.stats.flights++;
        events.emit('progress');
      }
      wasFlying = flying;
      if (input.consume('enter')) game.exitVehicle();
    } else {
      const w = p.walker;
      w.px = w.x;
      w.pz = w.z;
      w.pheading = w.heading;
      const jacking = !!(game.carjack && game.carjack.busy);
      if (jacking) game.carjack.stepPlayer(dt);
      else stepWalker(w, input, dt, game.world, game.camHeading);
      p.x = w.x;
      p.z = w.z;
      p.y = 0;
      p.heading = w.heading;
      const up = !w.life || w.life === 'ok';
      p.near = up && !jacking && !p.vehicle ? findEnterable(w, vs, 3.2, game.carjack ? game.carjack.canEnter : null) : null;
      if (game.touch && game.touch.setEnterReady) game.touch.setEnterReady(!!p.near);
      if (input.consume('enter') && p.near) game.tryEnterVehicle(p.near);
    }
    // Every few seconds, clear away craft nobody is using or tracking
    // once they are far behind, so the world never fills up.
    sweepTimer -= dt;
    if (sweepTimer <= 0) {
      sweepTimer = 3;
      for (let i = vs.length - 1; i >= 0; i--) {
        const v = vs[i];
        if (v.driver || v.parked || v.ai || (v.home && v.home.craft === v)) continue;
        const dx = v.x - p.x, dz = v.z - p.z;
        if (dx * dx + dz * dz > 300 * 300) game.removeVehicle(v);
      }
    }
    for (let i = 0; i < game.systems.length; i++) {
      const s = game.systems[i];
      if (!s.fixedUpdate) continue;
      try {
        s.fixedUpdate(dt);
      } catch (e) {
        game.errors.report(s.name + '.fixedUpdate', e);
      }
    }
    input.endStep();
  }

  // --- Drawing step. ---
  let sweepTimer = 3;
  let wasFlying = false;
  let lastDistrict = '', lastDistrictKey = '';
  const placeNow = { key: '', name: '' };
  let promptFor = null;
  let wakeTick = 0;
  let wakeLast = -1e9;
  // The loop's frame timing (for the adaptive resolution only): the first
  // step of a frame, or its draw when it has no step, opens the frame.
  let frameOpen = false;
  function loopStep(dt) {
    if (!frameOpen) {
      frameOpen = true;
      game.frameStartMs = performance.now();
    }
    fixedUpdate(dt);
  }
  function loopRender(alpha, dt) {
    if (!frameOpen) game.frameStartMs = performance.now();
    frameOpen = false;
    render(alpha, dt);
  }

  function render(alpha, dt) {
    if (laterJobs.length && ++drawnFrames > 2) runLater();
    const p = game.player;
    const vs = game.vehicles;
    for (let i = 0; i < vs.length; i++) {
      const v = vs[i];
      if (v.asleep && !v.meshDirty) continue;
      game.kinds[v.kind].updateMesh(v.mesh, v, v.asleep ? 1 : alpha, game.time);
      if (v.kind === 'boat') {
        v.mesh.position.y += SEA_Y;
        if (v.wake > 0.15 && (wakeTick + v.id) % 4 === 0) {
          wakeLast = game.time;
          wake.emit(v.x - Math.cos(v.heading) * v.spec.length * 0.45, v.z - Math.sin(v.heading) * v.spec.length * 0.45, v.heading, v.wake);
        }
      }
      v.meshDirty = false;
    }
    wakeTick++;
    // Far-away cars are drawn as a body only (no wheels or lamps): a
    // big saving in draw calls that nobody can see. Checked in slices.
    for (let i = wakeTick % 8; i < vs.length; i += 8) {
      const v = vs[i];
      if (v.kind !== 'car' || !v.mesh) continue;
      const dx = v.x - camera.position.x, dz = v.z - camera.position.z;
      const far = dx * dx + dz * dz > CAR_FAR_M * CAR_FAR_M;
      if (v.lodFar === far) continue;
      v.lodFar = far;
      const ud = v.mesh.userData;
      for (let k = 0; k < ud.wheels.length; k++) ud.wheels[k].visible = !far;
      if (ud.head) ud.head.visible = !far;
      if (ud.tail) ud.tail.visible = !far;
    }
    water.update(game.time, camera.position);
    // The wake trail only while some foam lives (its longest life is
    // under WAKE_IDLE s): 160 instances drawn, moved and uploaded every
    // frame for nothing otherwise (0.13.8).
    const wakeOn = game.time - wakeLast < WAKE_IDLE;
    if (wakeOn || wake.mesh.visible) {
      wake.update(dt, game.time);
      wake.mesh.visible = wakeOn;
    }
    if (p.vehicle) {
      const v = p.vehicle;
      if (v.kind === 'car' && v.mesh) setVehicleLights(v.mesh, { brake: v.brake > 0.1 || v.handbrake, siren: false, time: game.time });
      camTarget.x = v.px + (v.x - v.px) * alpha;
      camTarget.z = v.pz + (v.z - v.pz) * alpha;
      camTarget.y = v.py + (v.y - v.py) * alpha;
      camTarget.heading = v.heading;
      camTarget.pitch = v.kind === 'car' ? 0 : v.pitch;
      camTarget.roll = v.kind === 'car' ? 0 : v.roll;
      camTarget.speed = v.speed;
      camTarget.height = 1.2;
      camTarget.vehicle = v; // first-person views sit on the car's own mesh (chasecam.js)
      camTarget.boost = game.progress.settings.reduceMotion === true ? 0 : v.boostLevel || 0; // FOV widening and speed lines
      if (v.kind === 'tank' && chase.tankAim) {
        // Behind the turret's wanted aim, not the hull (docs/ARMS.md).
        camTarget.heading = chase.tankAim.yaw;
        camTarget.pitch = chase.tankAim.pitch;
        camTarget.roll = 0;
        camTarget.height = 0;
      }
      const want = v.wrecked ? 'wreck' : null;
      if (promptFor !== want) {
        promptFor = want;
        hud.setPrompt(want ? 'Wrecked. Tap EXIT to get out.' : null);
      }
    } else {
      const w = p.walker;
      updatePersonMesh(personMesh, w, alpha);
      if (w.life && w.life !== 'ok') layDown(personMesh, w);
      else if (personMesh.rotation.z !== 0 || !personMesh.visible) {
        personMesh.rotation.z = 0;
        personMesh.visible = true;
      }
      camTarget.x = w.px + (w.x - w.px) * alpha;
      camTarget.z = w.pz + (w.z - w.pz) * alpha;
      camTarget.y = 0;
      camTarget.heading = w.heading;
      camTarget.pitch = 0;
      camTarget.roll = 0;
      camTarget.speed = w.speed;
      camTarget.height = 1.5;
      camTarget.vehicle = null;
      camTarget.boost = 0;
      if (p.near !== promptFor) {
        promptFor = p.near;
        hud.setPrompt(p.near ? `Tap ENTER: ${p.near.driver && p.near.driver !== 'player' ? 'take ' : ''}${p.near.spec.label}` : null);
      }
    }
    if (snapCam) {
      snapCam = false;
      chase.snap(camTarget);
    }
    chase.update(camTarget, dt, input, collision);
    if (titleCam.active) titleCam.apply(game.time, dt);
    // In the Hood and Cockpit views the camera sits ahead of the car's center: use where it looks.
    game.camHeading = chase.isFirstPerson() ? chase.viewYaw() : Math.atan2(camTarget.z - camera.position.z, camTarget.x - camera.position.x);

    for (let i = 0; i < game.systems.length; i++) {
      const s = game.systems[i];
      if (!s.render) continue;
      try {
        s.render(alpha, dt);
      } catch (e) {
        game.errors.report(s.name + '.render', e);
      }
    }

    const h = game.hudState;
    h.mode = p.mode === 'foot' ? 'foot' : 'car';
    h.speedKmh = p.vehicle ? Math.abs(p.vehicle.speed) * 3.6 : 0;
    h.health = p.health;
    h.maxHealth = p.walker.maxHp || 100;
    h.mortal = game.progress.settings.mortal === true;
    h.armor = p.armor;
    h.time = game.clock;
    h.wanted = p.wanted;
    h.stars = game.police ? game.police.stars : p.wanted;
    h.cooling = game.police ? game.police.heat.cooldown : 0;
    h.boost = p.vehicle && p.vehicle.kind !== 'tank' && p.vehicle.boostMeter >= 0 ? p.vehicle.boostMeter : -1;
    h.boostFx = camTarget.boost;
    h.boostOn = !!(p.vehicle && p.vehicle.boostOn);
    h.boostLock = !!(p.vehicle && p.vehicle.boostLock);
    h.vehicleHealth = p.vehicle ? Math.max(0, p.vehicle.health / p.vehicle.spec.health) : null;
    // Name on the HUD; the key goes with it for the first-visit flags.
    hudPlace(city, p.x, p.z, placeNow);
    h.district = placeNow.name;
    if (h.district !== lastDistrict || placeNow.key !== lastDistrictKey) {
      lastDistrict = h.district;
      lastDistrictKey = placeNow.key;
      events.emit('district', h.district, placeNow.key);
    }
    hud.update(h);
    // Real map: build and swap detail tiles round the camera.
    if (cityMesh.userData.stream) cityMesh.userData.stream.update(camera, titleCam.active ? STREAM_TITLE_MS : STREAM_MS);
    // A graphics module may take over the final draw (post effects).
    try {
      if (game.renderFrame) game.renderFrame(dt);
      else renderer.render(scene, camera);
    } catch (e) {
      game.errors.report('renderFrame', e);
    }
  }

  function resize() {
    const w = window.innerWidth, h = window.innerHeight;
    if (!(w > 0 && h > 0)) return;
    // The graphics module picks the pixel ratio (adaptive, bounded by the
    // device and the quality setting); otherwise cap the drawn height.
    const dpr = window.devicePixelRatio || 1;
    // The drawing buffer stays within the GPU's sizes and a pixel budget.
    const ratio = game.graphics && game.graphics.resolution ? game.graphics.resolution(dpr, w, h) : Math.max(0.75, Math.min(dpr, (1440 * game.quality) / Math.max(1, h)));
    if (ratio !== renderer.getPixelRatio()) renderer.setPixelRatio(ratio);
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    for (let i = 0; i < game.resizeHooks.length; i++) game.resizeHooks[i](w, h, renderer.getPixelRatio());
  }
  window.addEventListener('resize', resize);
  window.addEventListener('orientationchange', resize);
  resize();

  // The portrait cover (index.html #rotate, the same media query) hides the
  // game: pause under it and let go of held controls. A manual pause stays.
  const rotation = createRotationGate();
  const portraitQuery = typeof window.matchMedia === 'function' ? window.matchMedia('(orientation: portrait) and (pointer: coarse)') : null;
  const clearHeld = () => {
    // The touch layer lets go of everything on a window blur.
    try {
      window.dispatchEvent(new Event('blur'));
    } catch {
      /* no events: nothing to clear */
    }
  };
  const checkRotation = () => {
    const portrait = portraitQuery ? portraitQuery.matches : false;
    rotation.update(portrait, game, (p) => events.emit('pause', p), clearHeld);
  };
  window.addEventListener('resize', checkRotation);
  window.addEventListener('orientationchange', checkRotation);
  if (portraitQuery && portraitQuery.addEventListener) portraitQuery.addEventListener('change', checkRotation);
  checkRotation();

  // Pause automatically when the page is hidden.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && !game.paused) {
      game.paused = true;
      events.emit('pause', true);
    }
  });

  // Pick up where the player left off on this map (a no-op on a new
  // game; a session saved on another map stays with that map).
  game.restoreSession();

  game.loop = createLoop({ fixedUpdate: loopStep, render: loopRender, getScale: () => game.timeScale || 1, errors: game.errors });
  game.resize = resize;
  game.step = fixedUpdate; // for tests
  game.draw = render;
  return game;
}
