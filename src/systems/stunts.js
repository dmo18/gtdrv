// Stunt jumps: ramps on quiet streets and at the airfield dock
// (world/stunts.js). A car or boat that crests a ramp fast enough flies:
// ballistic flight with pitch and roll kept on the vehicle (`air`,
// `airPitch`, `airRoll`), brake for a backflip and steer for a barrel
// roll. On landing the jump is judged (core/stunt.js): air time,
// distance, height, flips and rolls make points and a medal (bronze,
// silver, gold) for that ramp in game.progress.medals. A wreck, a crash
// into a wall, or landing sideways or on the roof scores nothing.
// No money: points and medals only.
//
// Logic runs in node tests. The ramp meshes, map icons and start
// markers are made only when game.scene / game.map exist.
// Docs: docs/SPEC.md "Stunt jumps".
import * as THREE from 'three';
import { generateStuntSpots, rampAt, rampHeight, groundUnder } from '../world/stunts.js';
import { createAirState, beginAir, stepAir, judgeLanding, medalRank } from '../core/stunt.js';
import { createMarkers } from '../render/markers.js';

export const LAUNCH_VY = 1.6; // m/s climb rate at the crest that throws a craft into the air (about 23 km/h)
export const BAD_LANDING_DAMAGE = 0.3; // share of full health
const MAX_FLIGHT = 12; // s: safety net
const CENTRE_Y = 0.7; // m: the craft turns about this height in the air
const MAP_COLOR = '#b48cff';

const cap = (m) => m.charAt(0).toUpperCase() + m.slice(1);

// opts.spots: use these ramps instead of the city's (tests).
export function createStunts(game, opts = {}) {
  const spots = Array.isArray(opts.spots) ? opts.spots : game.city ? generateStuntSpots(game.city) : [];
  const events = game.events;
  const EV = { spot: null, points: 0, medal: null, air: 0, dist: 0, flips: 0, rolls: 0, ok: false, best: false };

  // ---- map icons, start markers and ramp meshes (browser only) ----
  const marks = spots.map((s) => ({ x: s.x, z: s.z, type: 'stunt', color: MAP_COLOR, label: s.name }));
  if (game.map && game.map.addMarker) for (const m of marks) game.map.addMarker(m);
  let markers = null, root = null;
  if (game.scene) {
    const seaY = game.seaY ?? -0.6;
    markers = createMarkers(game.scene, { seaY, maxStarts: spots.length, slots: 0 });
    const C = { type: 'stunt', start: { x: 0, z: 0, y: 0 } };
    spots.forEach((s, i) => {
      // Beside the ramp, so the pillar never hides the jump.
      const side = s.width / 2 + 2.5;
      C.start.x = s.x - s.az * side;
      C.start.z = s.z + s.ax * side;
      C.start.y = s.water ? seaY + 0.1 : 0;
      markers.showStart(i, C, 1.8);
    });
    root = buildRamps(game.scene, spots, seaY);
  }

  const toast = (text, t = 2.2) => { if (game.hud && game.hud.toast) game.hud.toast(text, t); };

  function award(v, r, spot) {
    const prog = game.progress;
    let best = false;
    if (r.medal && prog && prog.medals) {
      const prev = prog.medals[spot.id] || null;
      if (medalRank(r.medal) > medalRank(prev)) {
        prog.medals[spot.id] = r.medal;
        best = true;
      }
    }
    let label = spot.name + (r.medal ? '  ' + cap(r.medal) : '') + '  ' + r.air.toFixed(1) + ' s';
    if (r.flips) label += r.flips > 1 ? '  ' + r.flips + ' flips' : '  flip';
    if (r.rolls) label += r.rolls > 1 ? '  ' + r.rolls + ' rolls' : '  roll';
    const sc = game.score;
    if (sc && sc.add) {
      sc.add(r.points, label, v.x, v.z, true);
      if (sc.recordCourse) sc.recordCourse(spot.id, r.points);
    } else toast(label + '  +' + r.points);
    EV.best = best;
    if (best && events) events.emit('progress');
  }

  function land(v, ground) {
    const st = v.air;
    st.on = false;
    const r = judgeLanding(st, !!v.wrecked);
    v.y = ground;
    v.vy = 0;
    v.airPitch = 0;
    v.airRoll = 0;
    v.heading = st.heading;
    v.rampH = ground;
    v.stuntRamp = ground > 0;
    v.meshDirty = true;
    // A jolt in the springs on touchdown.
    if (Number.isFinite(v.pitchV)) v.pitchV -= Math.min(2, 0.4 + Math.abs(st.vy) * 0.15);
    if (v.suspension !== undefined) v.suspension = Math.max(v.suspension || 0, Math.min(1, Math.abs(st.vy) / 10));
    const player = !!game.player && v === game.player.vehicle;
    if (!r.ok) {
      v.vx *= 0.35;
      v.vz *= 0.35;
      const hp = (v.spec && v.spec.health) || 0;
      if (game.combat && game.combat.damage && hp > 0 && !v.wrecked) game.combat.damage(v, hp * BAD_LANDING_DAMAGE, null, 'ram');
      if (player) toast(r.upsideDown ? 'Landed on the roof: no points' : 'Bad landing: no points', 1.8);
    } else if (player && r.points > 0) {
      award(v, r, st.spot);
    }
    if (events) {
      EV.spot = st.spot;
      EV.points = r.points;
      EV.medal = r.medal;
      EV.air = r.air;
      EV.dist = r.dist;
      EV.flips = r.flips;
      EV.rolls = r.rolls;
      EV.ok = r.ok;
      if (!player) EV.best = false;
      events.emit('stunt', EV);
      EV.best = false;
    }
  }

  function launch(v, spot, vy) {
    if (!v.air) v.air = createAirState();
    const st = v.air;
    const dir = v.vx * spot.ax + v.vz * spot.az;
    const fwd = v.vx * Math.cos(v.heading) + v.vz * Math.sin(v.heading);
    // Nose up the slope; a car going up backwards tips the other way.
    beginAir(st, v.x, v.y || 0, v.z, v.vx, vy, v.vz, fwd >= 0 ? spot.angle : -spot.angle, 0);
    st.spot = spot;
    st.heading = v.heading;
    st.dir = dir;
    v.stuntRamp = true;
  }

  function stepFlight(v, dt) {
    const st = v.air;
    const p = game.player;
    let inP = 0, inR = 0;
    if (p && v === p.vehicle && game.input) {
      const inp = game.input;
      if ((+inp.brake || 0) > 0.3) inP = 1;
      const s = +inp.steer || 0;
      if (s > 0.35) inR = 1;
      else if (s < -0.35) inR = -1;
    }
    stepAir(st, dt, inP, inR);
    // Walls and buildings taller than the craft's height stop it.
    const col = v.kind === 'boat' ? game.waterCollision : game.collision;
    if (col && col.resolveCircle) {
      const res = col.resolveCircle(st.x, st.z, (v.radius || 2) * 0.5, st.y);
      if (res.x !== st.x || res.z !== st.z) {
        st.x = res.x;
        st.z = res.z;
        st.vx *= 0.2;
        st.vz *= 0.2;
        st.crashed = true;
      }
    }
    v.x = st.x;
    v.z = st.z;
    v.y = st.y;
    v.vy = st.vy;
    v.vx = st.vx;
    v.vz = st.vz;
    v.heading = st.heading;
    v.yawRate = 0;
    v.speed = st.vx * Math.cos(st.heading) + st.vz * Math.sin(st.heading);
    v.airPitch = st.pitch;
    v.airRoll = st.roll;
    v.asleep = false;
    v.meshDirty = true;
    const ground = groundUnder(spots, st.x, st.z, v.kind === 'boat');
    if ((st.y <= ground && st.vy < 0) || st.t > MAX_FLIGHT) land(v, ground);
  }

  function stepCraft(v, dt) {
    if (v.air && v.air.on) {
      stepFlight(v, dt);
      return;
    }
    const water = v.kind === 'boat';
    const spot = rampAt(spots, v.x, v.z, water);
    if (!spot) {
      if (v.stuntRamp) {
        // Rolled off the end (or the side) of a ramp: back on the ground.
        if (v.rampH > 0 && !water) v.y = 0;
        v.rampH = 0;
        v.stuntRamp = false;
        v.airPitch = 0;
        v.meshDirty = true;
      }
      return;
    }
    const t2 = spot.top / 2;
    const uNow = (v.x - spot.x) * spot.ax + (v.z - spot.z) * spot.az;
    const px = Number.isFinite(v.px) ? v.px : v.x, pz = Number.isFinite(v.pz) ? v.pz : v.z;
    const uPrev = (px - spot.x) * spot.ax + (pz - spot.z) * spot.az;
    const aNow = Math.abs(uNow), aPrev = Math.abs(uPrev);
    // Cresting the slope onto the top: fast enough, it flies.
    if (aPrev > t2 && aNow <= t2 && !v.wrecked) {
      const along = Math.abs(v.vx * spot.ax + v.vz * spot.az);
      const vy = along * Math.tan(spot.angle);
      if (vy >= LAUNCH_VY) {
        v.y = spot.height;
        launch(v, spot, vy);
        return;
      }
    }
    // Riding the ramp: the craft follows its surface and tilts on the slopes.
    const h = rampHeight(spot, v.x, v.z);
    v.y = h;
    v.rampH = h;
    v.stuntRamp = true;
    let tilt = 0;
    if (aNow > t2 && h > 0) {
      const toCentre = uNow < 0 ? 1 : -1;
      tilt = spot.angle * toCentre * (Math.cos(v.heading) * spot.ax + Math.sin(v.heading) * spot.az);
    }
    v.airPitch = tilt;
    v.airRoll = 0;
    v.meshDirty = true;
  }

  const sys = {
    name: 'stunts',
    spots,
    markers: marks,
    fixedUpdate(dt) {
      const vs = game.vehicles;
      if (!vs || !spots.length) return;
      for (let i = 0; i < vs.length; i++) {
        const v = vs[i];
        if (!v || v.removed || v.tossing || (v.kind !== 'car' && v.kind !== 'boat')) continue;
        if (v.asleep && !(v.air && v.air.on)) continue;
        stepCraft(v, dt);
      }
    },
    // After the vehicle meshes are placed (game.js draws them first):
    // turn a flying craft about its centre by its air pitch and roll.
    render() {
      if (markers) markers.update(game.time || 0, game.camera ? game.camera.position : null);
      const vs = game.vehicles;
      if (!vs) return;
      for (let i = 0; i < vs.length; i++) {
        const v = vs[i];
        const m = v && v.mesh;
        if (!m) continue;
        if (v.airPitch || v.airRoll) tiltMesh(m, v.heading, v.airPitch || 0, v.airRoll || 0);
        else if (m.rotation.order === 'YZX') m.rotation.order = 'XYZ'; // back to the mesh's own order
      }
    },
    dispose() {
      if (game.map && game.map.removeMarker) for (const m of marks) game.map.removeMarker(m);
      if (root && root.parent) root.parent.remove(root);
    },
  };
  return sys;
}

// Mesh rotation R = Ry(-heading) Rz(pitch) Rx(roll) (order 'YZX'), and
// the position shifted so it turns about a point CENTRE_Y up.
export function tiltMesh(m, heading, pitch, roll) {
  if (m.rotation.order !== 'YZX') m.rotation.order = 'YZX';
  m.rotation.set(roll, -heading, pitch);
  const cr = Math.cos(roll), sr = Math.sin(roll), cp = Math.cos(pitch), sp = Math.sin(pitch);
  // Up vector after Rz(pitch) Rx(roll): (-cr sp, cr cp, sr), then yaw.
  const lx = -cr * sp, ly = cr * cp, lz = sr;
  const ch = Math.cos(heading), sh = Math.sin(heading);
  m.position.x -= (lx * ch - lz * sh) * CENTRE_Y;
  m.position.y += CENTRE_Y - ly * CENTRE_Y;
  m.position.z -= (lx * sh + lz * ch) * CENTRE_Y;
}

// Tabletop ramp meshes: one shared geometry per shape, rust-orange deck
// with pale chevrons, a dark frame. Water ramps sit on floats.
function buildRamps(scene, spots, seaY) {
  const root = new THREE.Group();
  root.name = 'stunt-ramps';
  const deck = new THREE.MeshStandardMaterial({ color: 0xb8612f, roughness: 0.75, metalness: 0.15 });
  const frame = new THREE.MeshStandardMaterial({ color: 0x3a3330, roughness: 0.8, metalness: 0.3 });
  const stripe = new THREE.MeshStandardMaterial({ color: 0xf2e6c8, roughness: 0.7 });
  const geos = new Map();
  for (const s of spots) {
    const key = [s.slope, s.top, s.height, s.width, s.water].join(':');
    let g = geos.get(key);
    if (!g) {
      const t2 = s.top / 2, half = s.half, base = s.water ? -0.7 : 0;
      const sh = new THREE.Shape();
      sh.moveTo(-half, base);
      if (base < 0) sh.lineTo(-half, 0);
      sh.lineTo(-t2, s.height);
      sh.lineTo(t2, s.height);
      sh.lineTo(half, 0);
      if (base < 0) sh.lineTo(half, base);
      sh.closePath();
      const body = new THREE.ExtrudeGeometry(sh, { depth: s.width, bevelEnabled: false });
      body.translate(0, 0, -s.width / 2);
      const chev = new THREE.BoxGeometry(0.7, 0.04, s.width * 0.8);
      g = { body, chev };
      geos.set(key, g);
    }
    const grp = new THREE.Group();
    grp.position.set(s.x, s.water ? seaY : 0, s.z);
    grp.rotation.y = -s.heading;
    const body = new THREE.Mesh(g.body, deck);
    body.receiveShadow = true;
    grp.add(body);
    // Chevrons on both slopes and dark side rails.
    for (const side of [-1, 1]) {
      for (let k = 0; k < 2; k++) {
        const u = side * (s.top / 2 + s.slope * (0.3 + k * 0.35));
        const y = s.height * (1 - (Math.abs(u) - s.top / 2) / s.slope) + 0.03;
        const c = new THREE.Mesh(g.chev, stripe);
        c.position.set(u, y, 0);
        c.rotation.z = side * s.angle;
        grp.add(c);
      }
      const rail = new THREE.Mesh(new THREE.BoxGeometry(s.half * 2, 0.25, 0.2), frame);
      rail.position.set(0, (s.water ? -0.6 : 0.12), side * (s.width / 2 + 0.05));
      grp.add(rail);
    }
    root.add(grp);
  }
  scene.add(root);
  return root;
}
