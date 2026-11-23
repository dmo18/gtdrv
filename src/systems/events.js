// Street events in the game (docs/LOOP.md section b): the gates of
// world/eventspots.js, the run of core/streetevents.js, medals and records,
// the instant retry, and the gate meshes (three instanced draws, built only
// when game.scene exists). Driving through a gate starts its event at once;
// the status is one line in the prompt strip (hud.setEvent), the start and
// the result are one line each in the top stack. No menu, no card.
import * as THREE from 'three';
import { placeEvents, eventRamps, regionSlug } from '../world/eventspots.js';
import {
  createEventRun, statusKey, statusLine, startLine, resultLine, eventPoints, TEMPLATE_INFO, GATE_MIN_SPEED, WRECK_POINTS, cap,
} from '../core/streetevents.js';
import { loopOf, recordEvent, recordTry, noteBest } from '../core/records.js';
import { resetHeat } from './police.js';
import { createVehicle, VEHICLE_SPECS } from '../entities/vehicle.js';

export const RETRY_S = 9; // seconds the RETRY button stays after an event
export const GATE_H = 5; // m, the posts
export const TRACK_NEAR = 32; // m: this close to a tracked gate the GPS lets go (it would call the gate "arrived")
const CURTAIN_OPACITY = 0.2;

export function createStreetEvents(game, opts = {}) {
  const city = game.city;
  const list = Array.isArray(opts.events) ? opts.events : placeEvents(city);
  const slug = regionSlug(city);
  const bus = game.events;
  // The jump ramps join the city's ramps before the stunt system is built
  // (game.js makes it after the missions system): it flies them, draws
  // them and keeps their own stunt medals like every other ramp.
  if (city && Array.isArray(city.rampSpots)) {
    for (const r of eventRamps(list)) if (!city.rampSpots.some((s) => s.id === r.id)) city.rampSpots.push(r);
  }
  const run = createEventRun();
  const loop = () => loopOf(game.progress);
  const toast = (text, s, kind) => { if (game.hud && game.hud.toast) game.hud.toast(text, s, kind); };

  let last = null; // the event last run (for RETRY)
  let lastResult = null; // { id, tpl, result, medal, value, points, newBest, newMedal, why }
  const RESULT = { id: '', tpl: '', result: '', medal: null, value: NaN, points: 0, newBest: false, newMedal: false, why: '' };
  let retryT = 0;
  let tracked = null; // an event the player is being led to (intro, records, daily)
  let trackLabel = '';
  let passes0 = 0, smash0 = 0; // flow counters when the run began
  let jumpSeen = 0, escaped = false, busted = false;
  let lineKey = -2, shownLine = null;
  let px = NaN, pz = NaN;
  let nearGate = false;
  const F = { x: 0, z: 0, px: 0, pz: 0, speed: 0, inCar: false, wrecked: false, passes: 0, smashes: 0, jump: 0, escaped: false, busted: false, stars: 0 };
  const OBJ = { x: 0, z: 0, label: '' };

  const smashCount = () => {
    const f = game.flow;
    return f ? f.smashes * WRECK_POINTS.prop + f.rams * WRECK_POINTS.ram + f.wrecks * WRECK_POINTS.craft : 0;
  };
  const policeOn = () => !!game.police && !(game.progress && game.progress.settings && game.progress.settings.police === false);

  function begin(ev) {
    if (run.on) return false;
    const v = game.player.vehicle;
    if (!v || v.kind !== 'car' || v.wrecked) return false;
    if (ev.tpl === 'heat' && !policeOn()) { toast('Police chases are off in Settings', 2.5, 'info'); return false; }
    run.start(ev);
    last = ev;
    retryT = 0;
    if (tracked === ev) { tracked = null; trackLabel = ''; }
    passes0 = game.flow ? game.flow.passes : 0;
    smash0 = smashCount();
    jumpSeen = 0;
    escaped = busted = false;
    lineKey = -2;
    if (game.flow) game.flow.setEvent(true);
    if (ev.tpl === 'heat') {
      // One step below, with a full point pending: the police system raises
      // it on its next step, with its own line and its cars turned to chase.
      const h = game.police.heat;
      if (h.level < ev.level) {
        h.level = ev.level - 1;
        h.points = 1;
        h.grace = 0;
        h.unseen = 0;
        h.cooldown = 0;
      }
    }
    run.daily = game.daily ? game.daily.slotFor(ev, v) : -1;
    toast(startLine(ev), 4, 'objective');
    if (bus) {
      bus.emit('checkpoint', 'event');
      bus.emit('streetEventStart', ev);
    }
    markTarget(ev);
    return true;
  }

  function finish(result) {
    const ev = run.ev;
    const L = loop();
    const r = RESULT;
    r.id = ev.id; r.tpl = ev.tpl; r.result = result; r.medal = run.medal; r.value = run.value; r.why = run.why;
    r.points = 0; r.newBest = false; r.newMedal = false; r.daily = -1;
    if (result === 'done') {
      const rec = recordEvent(L, ev, run.value, run.medal);
      r.newBest = rec.newBest;
      r.newMedal = rec.newMedal;
      r.points = eventPoints(run.medal, rec.newBest);
      if (ev.tpl === 'jump') noteBest(L, 'jumpFt', run.value);
      // Straight into the score, quietly: the result line says the medal.
      if (r.points > 0 && game.score && game.score.bankFlow) game.score.bankFlow(r.points);
      if (run.medal) r.daily = run.daily;
    } else recordTry(L, ev);
    lastResult = r;
    retryT = RETRY_S;
    if (game.flow) {
      game.flow.setEvent(false);
      // Finishing an event banks the run (with the tier bonus).
      if (result === 'done') game.flow.bank('event');
    }
    toast(resultLine(run) + (r.newBest && run.medal ? '  New best!' : ''), 4.5, 'objective');
    if (game.hud && game.hud.flowPop && run.medal) game.hud.flowPop('medal', 1);
    const calm = !!(game.progress && game.progress.settings && game.progress.settings.reduceMotion);
    if (run.medal && !calm) {
      if (game.hitStop) game.hitStop(3);
      if (run.medal === 'gold' && game.slowmo && game.slowmo.trigger) game.slowmo.trigger();
    }
    if (bus) {
      // 'reward' is the chime, 'fail' the low tone (systems/audio.js).
      if (run.medal) bus.emit('reward', r.points, 'event'); else bus.emit('fail', ev.id, run.why || 'No medal');
      bus.emit('streetEventEnd', r);
      bus.emit('progress');
    }
    markTarget(null);
    if (game.hud && game.hud.setEvent) game.hud.setEvent(null);
    shownLine = null;
  }

  // Put the player's car `back` m before the gate, facing it, standing
  // still. With `specId`, in a fresh car of that class (the daily twist).
  // Refused while the police are after the player (not for a retry of a
  // heat escape) or on foot without a class to give.
  function stage(ev, specId = null) {
    const p = game.player;
    if (!ev || run.on) return false;
    if (p.vehicle && p.vehicle.kind !== 'car' && !specId) return false;
    if (!p.vehicle && !specId) specId = 'sedan';
    if (game.carjack && game.carjack.busy) return false;
    const rx = -ev.dz, rz = ev.dx; // right of the gate direction
    let back = ev.back || 30;
    let x = ev.x - ev.dx * back + rx * (ev.side || 0), z = ev.z - ev.dz * back + rz * (ev.side || 0);
    // Traffic standing on the spot makes room.
    const vs = game.vehicles;
    for (let i = vs.length - 1; i >= 0; i--) {
      const o = vs[i];
      if (o === p.vehicle || o.kind !== 'car') continue;
      const dx = o.x - x, dz = o.z - z;
      const along = dx * ev.dx + dz * ev.dz;
      if (Math.abs(-dx * ev.dz + dz * ev.dx) < 3.2 && along > -8 && along < back + 6) {
        if (o.ai || o.parked) game.removeVehicle(o);
        else if (along < 7 && along > -7) { back = Math.max(8, back - 8); x += ev.dx * 8; z += ev.dz * 8; }
      }
    }
    let v = p.vehicle;
    if (specId && (!v || v.spec.id !== specId || v.wrecked) && Object.hasOwn(VEHICLE_SPECS, specId)) {
      const nv = createVehicle(specId, x, z, ev.heading, game.rng);
      game.addVehicle(nv);
      if (v) { v.driver = null; p.vehicle = null; if (bus) bus.emit('exit', v); }
      game.enterVehicle(nv);
      v = nv;
    }
    if (!v || v.wrecked) return false;
    v.x = v.px = x;
    v.z = v.pz = z;
    v.heading = v.pheading = ev.heading;
    v.vx = v.vz = 0;
    v.speed = 0;
    v.yawRate = 0;
    if (v.air) v.air.on = false;
    v.airPitch = v.airRoll = 0;
    v.asleep = false;
    v.meshDirty = true;
    p.x = x;
    p.z = z;
    p.heading = ev.heading;
    px = x;
    pz = z;
    if (game.police && game.police.heat) resetHeat(game.police.heat, 2);
    p.wanted = 0;
    if (game.flow) game.flow.setEvent(false);
    if (game.snapCam) game.snapCam();
    retryT = 0;
    tracked = ev;
    trackLabel = '';
    if (bus) bus.emit('ui', 'event');
    return true;
  }
  function retry() {
    if (!last || run.on) return false;
    return stage(last);
  }

  // ---- events from the rest of the game ----
  if (bus) {
    bus.on('stunt', (e) => {
      if (!run.on || run.ev.tpl !== 'jump' || !e || e.spot !== run.ev.ramp) return;
      const v = game.player.vehicle;
      if (!v || !v.air || v.air.spot !== e.spot || v.air.on) return;
      jumpSeen = e.ok ? e.dist : -1;
    });
    bus.on('policeEscaped', () => { escaped = true; });
    bus.on('busted', () => { busted = true; });
    bus.on('progressReset', () => { if (run.on) { run.abort('Reset'); markTarget(null); } last = null; lastResult = null; retryT = 0; tracked = null; });
  }
  // RETRY: the offer cell above MORE, for a few seconds after an event.
  let action = null;
  if (game.touch && game.touch.registerAction) {
    action = game.touch.registerAction({
      id: 'eventretry', label: 'Retry the event', text: 'RETRY', group: 'primary', modes: ['car', 'foot'],
      icon: '<path d="M4 12a8 8 0 1 0 3-6.2"/><path d="M4 4v5h5"/>',
      press() { retry(); },
      visible: () => retryT > 0 && !!last && !run.on,
    });
  }

  // ---- gate meshes (browser only) ----
  let gates = null;
  function buildGates() {
    const n = list.length + 1; // the last instance is the target line of a running event
    const postGeo = new THREE.BoxGeometry(0.34, GATE_H, 0.34).translate(0, GATE_H / 2, 0);
    const beamGeo = new THREE.BoxGeometry(0.3, 0.55, 1).translate(0, GATE_H - 0.28, 0);
    const curtainGeo = new THREE.PlaneGeometry(1, GATE_H - 0.6).rotateY(Math.PI / 2).translate(0, (GATE_H - 0.6) / 2, 0);
    const solid = new THREE.MeshBasicMaterial({ fog: true });
    const veil = new THREE.MeshBasicMaterial({ transparent: true, opacity: CURTAIN_OPACITY, depthWrite: false, side: THREE.DoubleSide, fog: true });
    const posts = new THREE.InstancedMesh(postGeo, solid, n * 2);
    const beams = new THREE.InstancedMesh(beamGeo, solid, n);
    const veils = new THREE.InstancedMesh(curtainGeo, veil, n);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), t = new THREE.Vector3(), c = new THREE.Color();
    const up = new THREE.Vector3(0, 1, 0);
    const ground = city && city.groundAt ? city.groundAt : null;
    const place = (i, x, z, heading, w, color, show = true) => {
      const y = ground ? ground(x, z) || 0 : 0;
      const k = show ? 1 : 0;
      const half = w + 0.5;
      q.setFromAxisAngle(up, -heading);
      const rx = -Math.sin(heading), rz = Math.cos(heading); // across the street
      c.set(color);
      for (let side = 0; side < 2; side++) {
        const d = side ? half : -half;
        t.set(x + rx * d, y, z + rz * d);
        s.set(k, k, k);
        m.compose(t, q, s);
        posts.setMatrixAt(i * 2 + side, m);
        posts.setColorAt(i * 2 + side, c);
      }
      t.set(x, y, z);
      s.set(k, k, k * half * 2);
      m.compose(t, q, s);
      beams.setMatrixAt(i, m);
      beams.setColorAt(i, c);
      veils.setMatrixAt(i, m);
      veils.setColorAt(i, c);
      posts.instanceMatrix.needsUpdate = beams.instanceMatrix.needsUpdate = veils.instanceMatrix.needsUpdate = true;
      posts.instanceColor.needsUpdate = beams.instanceColor.needsUpdate = veils.instanceColor.needsUpdate = true;
    };
    list.forEach((ev, i) => place(i, ev.x, ev.z, ev.heading, ev.w, TEMPLATE_INFO[ev.tpl].color));
    place(list.length, 0, 0, 0, 1, '#ffffff', false);
    for (const mesh of [posts, beams, veils]) {
      mesh.frustumCulled = false;
      mesh.matrixAutoUpdate = false;
      mesh.name = 'event-gates';
      game.scene.add(mesh);
    }
    veils.renderOrder = 2;
    return { place, veil, n: list.length };
  }
  if (game.scene && typeof document !== 'undefined') gates = buildGates();
  // The white line of a running trap, the beacon gate of a drop.
  function markTarget(ev) {
    if (!gates) return;
    if (ev && ev.tpl === 'trap') gates.place(gates.n, ev.tx, ev.tz, Math.atan2(ev.tdz, ev.tdx), ev.tw || ev.w, '#ffffff');
    else if (ev && ev.tpl === 'dash') gates.place(gates.n, ev.tx, ev.tz, ev.heading, 5, '#8bd66f');
    else gates.place(gates.n, 0, 0, 0, 1, '#ffffff', false);
  }
  // Map icons (both maps).
  const marks = list.map((ev) => ({ x: ev.x, z: ev.z, type: TEMPLATE_INFO[ev.tpl].icon, color: TEMPLATE_INFO[ev.tpl].color, label: ev.name }));
  if (game.map && game.map.addMarker) for (const mk of marks) game.map.addMarker(mk);

  function targetDist(ev, p) {
    if (ev.tpl === 'trap' || ev.tpl === 'jump' || ev.tpl === 'dash') return Math.hypot(ev.tx - p.x, ev.tz - p.z);
    return 0;
  }

  const sys = {
    name: 'streetEvents',
    list,
    slug,
    run,
    begin,
    stage,
    retry,
    // Lead the player to a gate (GPS turn by turn through game.missions.objective).
    // `ev`: an event, or any { x, z, name } (the intro's garage). `label`:
    // the line the objective shows instead of the event's name (the intro's line).
    track(ev, label = '') { tracked = ev || null; trackLabel = label || ''; },
    // Stopped traffic in the lane ahead of the player makes room (the start
    // of the intro: the first gate must be reachable without a queue).
    clearAhead(dist = 90) {
      const p = game.player, v = p.vehicle;
      if (!v) return 0;
      const fx = Math.cos(v.heading), fz = Math.sin(v.heading);
      let n = 0;
      const vs = game.vehicles;
      for (let i = vs.length - 1; i >= 0; i--) {
        const o = vs[i];
        if (o === v || o.kind !== 'car' || !o.ai) continue;
        const dx = o.x - v.x, dz = o.z - v.z;
        const al = dx * fx + dz * fz;
        // anything within 35 m, and whatever stands still farther on
        if (al > 2 && al < dist && Math.abs(-dx * fz + dz * fx) < 3 && (al < 35 || Math.abs(o.speed || 0) < 2)) { game.removeVehicle(o); n++; }
      }
      return n;
    },
    get tracked() { return tracked; },
    // Give up the running event (it counts as a try; RETRY is offered).
    cancel(why = 'Given up') {
      if (!run.on) return false;
      run.abort(why);
      finish('fail');
      return true;
    },
    dismissRetry() { retryT = 0; },
    get active() { return run.on ? run : null; },
    get lastResult() { return lastResult; },
    get retryLeft() { return retryT; },
    get retryAction() { return action; },
    byId: (id) => list.find((e) => e.id === id) || null,
    // Where the objective arrow and the GPS point: the drop of a running
    // rush drop, else the gate the player is being led to.
    get objective() {
      if (run.on) {
        if (run.ev.tpl !== 'dash') return null;
        OBJ.x = run.ev.tx; OBJ.z = run.ev.tz; OBJ.label = 'Drop on ' + run.ev.to;
        return OBJ;
      }
      if (tracked) {
        // Not for the last few meters: the gate is in view, and the GPS would call the gate "arrived" before it is crossed.
        const p = game.player;
        const d = Math.hypot(tracked.x - p.x, tracked.z - p.z);
        if (d < TRACK_NEAR) nearGate = true; else if (d > TRACK_NEAR + 14) nearGate = false;
        if (nearGate) return null;
        OBJ.x = tracked.x; OBJ.z = tracked.z; OBJ.label = trackLabel || cap(tracked.name);
        return OBJ;
      }
      return null;
    },
    fixedUpdate(dt) {
      const p = game.player;
      const v = p.vehicle;
      if (retryT > 0) retryT -= dt;
      const inCar = !!v && v.kind === 'car';
      if (run.on) {
        F.x = p.x; F.z = p.z; F.px = Number.isFinite(px) ? px : p.x; F.pz = Number.isFinite(pz) ? pz : p.z;
        F.speed = v ? Math.abs(v.speed || 0) : 0;
        F.inCar = inCar;
        F.wrecked = !!(v && v.wrecked);
        const f = game.flow;
        const pn = f ? f.passes : 0, sn = smashCount();
        F.passes = pn - passes0; passes0 = pn;
        F.smashes = sn - smash0; smash0 = sn;
        F.jump = jumpSeen; jumpSeen = 0;
        F.escaped = escaped; F.busted = busted;
        escaped = busted = false;
        F.stars = game.police ? game.police.heat.level : 0;
        const res = run.step(dt, F);
        if (res) finish(res);
      } else if (inCar && !v.wrecked && Number.isFinite(px)) {
        // Through a gate, the right way, at more than a crawl: the event starts.
        const sp = Math.abs(v.speed || 0);
        if (sp >= GATE_MIN_SPEED) {
          for (let i = 0; i < list.length; i++) {
            const ev = list[i];
            const dx = p.x - ev.x, dz = p.z - ev.z;
            if (dx > 40 || dx < -40 || dz > 40 || dz < -40) continue;
            const a1 = dx * ev.dx + dz * ev.dz;
            const a0 = (px - ev.x) * ev.dx + (pz - ev.z) * ev.dz;
            if (a0 < 0 && a1 >= 0 && a1 - a0 < 6 && Math.abs(-dx * ev.dz + dz * ev.dx) <= ev.w + 1.2) {
              begin(ev);
              break;
            }
          }
        }
      }
      px = p.x;
      pz = p.z;
    },
    render() {
      if (gates) gates.veil.opacity = CURTAIN_OPACITY + 0.08 * Math.sin((game.time || 0) * 3);
      const hud = game.hud;
      if (!hud || !hud.setEvent) return;
      if (!run.on) {
        if (shownLine !== null) { shownLine = null; hud.setEvent(null); }
        return;
      }
      const d = targetDist(run.ev, game.player);
      const k = statusKey(run, d);
      if (k !== lineKey) {
        lineKey = k;
        shownLine = statusLine(run, d);
        hud.setEvent(shownLine);
      }
    },
  };
  return sys;
}
