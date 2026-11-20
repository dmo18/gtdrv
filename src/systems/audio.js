// Audio system. Every sound is synthesised in the browser (no files, no
// network): at unlock a bank of sample buffers is generated a few
// milliseconds at a time (src/audio/banks.js), then everything plays
// from AudioBufferSourceNodes with playbackRate, gains and crossfades.
//
// - Engines: firing-pulse loops at four rpm points with on-load and
//   off-load layers (src/audio/engines.js), crossfaded by rpm/throttle.
// - Tyres and road, boat wash and hull slaps, prop/jet/rotor rigs.
// - Impacts, doors, starter, horns, police siren as pooled voices.
// - A generated street impulse response for reverb, ambience beds that
//   follow place, time and weather, and quiet UI sounds.
// - Buses (engine, tyres, world, effects, ui) into a gentle compressor
//   and a limiter. Silent no-op until unlock(), and when the browser has
//   no AudioContext. render() never throws.

import { createRng } from '../core/rng.js';
import { createBank } from '../audio/banks.js';
import { WEAPONS } from '../core/weapons.js';
import { ENGINES, engineFor, isJet, pitchFor, pointsFor } from '../audio/engines.js';
import { createVoices } from '../audio/voices.js';

const HEARING = 70; // metres for crash sounds
const OTHER_RANGE = 70; // metres for other craft engines
const OTHERS = 4;
const UPDATE_EVERY = 1 / 30; // seconds between parameter pushes
const PLACE_EVERY = 0.5; // seconds between place/enclosure probes
const SOUND_SPEED = 343;
const SLICE_MS = 5; // generation budget per slice

// Default bus levels (the master is set separately). Engines sit under
// the world so the city still reads.
const BUS = { engine: 0.42, tyres: 0.5, world: 0.6, effects: 0.75, ui: 0.4 };

const URBAN = { downtown: 1, midtown: 0.85, industrial: 0.8, docks: 0.6, residential: 0.45, park: 0.35, beach: 0.3, airfield: 0.25, shore: 0.3 };
const CRICKET = { residential: 1, park: 1, beach: 0.6, airfield: 0.7, shore: 0.5, midtown: 0.25 };

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const fin = (v, d = 0) => (Number.isFinite(v) ? v : d);

function hashId(id) {
  let h = 7;
  const s = String(id == null ? '' : id);
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

// 0 by day, 1 at night, from the clock in hours.
function nightOf(h) {
  if (!Number.isFinite(h)) return 0;
  const d = Math.abs((((h % 24) + 24) % 24) - 12.5);
  return clamp((d - 6) / 1.5, 0, 1);
}

export function createAudio(game) {
  const Ctor = typeof window !== 'undefined' ? window.AudioContext || window.webkitAudioContext : null;
  const rng = createRng(0xa0d10);
  let ctx = null;
  let master = null;
  let comp = null;
  let limiter = null;
  let shaper = null;
  const bus = {};
  const send = {};
  let duck = null; // world-bus ducking at speed
  let convolver = null;
  let ret = null;
  let bank = null;
  let voices = null;
  let ready = false;
  let muted = false;
  let hidden = typeof document !== 'undefined' && document.hidden === true;
  let wantRunning = true;
  const vol = { master: 0.8, engine: 1, tyres: 1, world: 1, effects: 1, ui: 1 };
  let disposed = false;
  const unsubs = [];
  const gen = { startMs: 0, wallMs: 0, fullMs: 0, cpuMs: 0, lazyMs: 0, maxSliceMs: 0, slices: 0 };

  let acc = 0;
  let placeAcc = PLACE_EVERY;
  let lastUpdate = 0;

  // ---- small node helpers ----
  function gainNode(v, dest) {
    const g = ctx.createGain();
    g.gain.value = v;
    if (dest) g.connect(dest);
    return g;
  }
  function biq(type, f, q, dest) {
    const b = ctx.createBiquadFilter();
    b.type = type;
    b.frequency.value = f;
    b.Q.value = q;
    if (dest) b.connect(dest);
    return b;
  }
  function panNode(dest, v = 0) {
    if (!ctx.createStereoPanner) return null;
    const p = ctx.createStereoPanner();
    p.pan.value = v;
    p.connect(dest);
    return p;
  }
  function set(param, v, now, tc = 0.05) {
    if (Number.isFinite(v)) param.setTargetAtTime(v, now, tc);
  }
  function buf(name) {
    return bank ? bank.buffers[name] || null : null;
  }
  // A looping source of a bank buffer, started at a random point.
  function loopSrc(name, dest, rate = 1) {
    const b = buf(name);
    if (!b) return null;
    const s = ctx.createBufferSource();
    s.buffer = b;
    s.loop = true;
    s.playbackRate.value = rate;
    s.connect(dest);
    s.start(0, rng.next() * b.duration);
    return s;
  }
  // A persistent loop: source -> [filter] -> gain -> dest.
  function bed(name, dest, { filterType = null, f = 1000, q = 0.7, stereo = false } = {}) {
    const g = gainNode(0, dest);
    const f0 = filterType ? biq(filterType, f, q, g) : null;
    const into = f0 || g;
    const srcs = [];
    if (stereo) {
      const l = panNode(into, -0.65);
      const r = panNode(into, 0.65);
      srcs.push(loopSrc(name, l || into), loopSrc(name, r || into));
    } else {
      srcs.push(loopSrc(name, into));
    }
    return { g, f: f0, srcs, s: srcs[0] };
  }

  // Stereo pan and distance gain for a world position, from the player.
  const sp = { gain: 1, pan: 0, d: 0, nx: 0, nz: 0 };
  function spatial(x, z, range) {
    const p = game.player;
    const dx = fin(x) - fin(p.x);
    const dz = fin(z) - fin(p.z);
    const d = Math.sqrt(dx * dx + dz * dz);
    const e = game.camera && game.camera.matrixWorld && game.camera.matrixWorld.elements;
    let rx = 1;
    let rz = 0;
    if (e) {
      rx = fin(e[0], 1);
      rz = fin(e[2], 0);
    }
    sp.d = d;
    sp.nx = d > 0.01 ? dx / d : 0;
    sp.nz = d > 0.01 ? dz / d : 0;
    sp.gain = d >= range ? 0 : Math.pow(1 - d / range, 1.6) * Math.min(1, 10 / Math.max(1, d));
    sp.pan = d > 0.5 ? clamp((dx * rx + dz * rz) / d, -1, 1) * 0.8 : 0;
    return sp;
  }
  function playerVel(out) {
    const v = game.player.mode !== 'foot' ? game.player.vehicle : null;
    out.vx = v ? fin(v.vx) : 0;
    out.vz = v ? fin(v.vz) : 0;
    return out;
  }
  const pvel = { vx: 0, vz: 0 };
  // Doppler factor for a source moving at (vx, vz), with sp filled in.
  function doppler(vx, vz) {
    const rel = (fin(vx) - pvel.vx) * sp.nx + (fin(vz) - pvel.vz) * sp.nz; // + = receding
    return clamp(SOUND_SPEED / (SOUND_SPEED + clamp(rel, -80, 80)), 0.8, 1.25);
  }

  // ---- engine rigs ----
  // An engine loop set: 4 rpm points x (on, off) layers, crossfaded.
  function engineRig(ch, dest, withOff = true) {
    const pts = pointsFor(ch);
    const out = gainNode(0, dest);
    const on = [];
    const off = [];
    for (let i = 0; i < pts.length; i++) {
      const g1 = gainNode(0, out);
      on.push({ g: g1, s: loopSrc(`eng:${ch}:${i}:on`, g1) });
      if (withOff) {
        const g2 = gainNode(0, out);
        off.push({ g: g2, s: loopSrc(`eng:${ch}:${i}:off`, g2) });
      }
    }
    return { ch, pts, out, on, off };
  }
  function setEngine(r, rpm, load, level, mul, now, tc = 0.04) {
    const pts = r.pts;
    const n = pts.length;
    let i = 0;
    while (i < n - 2 && rpm > pts[i + 1]) i++;
    const x = clamp((rpm - pts[i]) / (pts[i + 1] - pts[i]), 0, 1);
    const wA = Math.cos((x * Math.PI) / 2);
    const wB = Math.sin((x * Math.PI) / 2);
    const lOn = r.off.length ? Math.sqrt(clamp(load, 0, 1)) : 1;
    const lOff = r.off.length ? Math.sqrt(1 - clamp(load, 0, 1)) : 0;
    for (let j = 0; j < n; j++) {
      const w = j === i ? wA : j === i + 1 ? wB : 0;
      const rate = clamp((Math.max(0.02, rpm) / pts[j]) * mul, 0.2, 3.2);
      const a = r.on[j];
      if (a.s) set(a.s.playbackRate, rate, now, tc);
      set(a.g.gain, w * lOn, now, tc);
      const b = r.off[j];
      if (b) {
        if (b.s) set(b.s.playbackRate, rate, now, tc);
        set(b.g.gain, w * lOff, now, tc);
      }
    }
    set(r.out.gain, level, now, tc * 1.5);
  }
  // Stop a rig with a short wind-down (engine shutdown).
  function stopSources(list, out, now, windDown) {
    set(out.gain, 0, now, windDown ? 0.25 : 0.06);
    for (let i = 0; i < list.length; i++) {
      const s = list[i];
      if (!s) continue;
      try {
        if (windDown) s.playbackRate.setTargetAtTime(s.playbackRate.value * 0.45, now, 0.35);
        s.stop(now + (windDown ? 1.4 : 0.4));
      } catch {
        /* already stopped */
      }
    }
    const first = list.find((s) => s);
    if (first) {
      first.onended = () => {
        try {
          out.disconnect();
        } catch {
          /* gone */
        }
      };
    }
  }
  function rigSources(r) {
    const list = [];
    if (r.on) for (const a of r.on) list.push(a.s);
    if (r.off) for (const a of r.off) list.push(a.s);
    if (r.srcs) for (const s of r.srcs) list.push(s);
    return list;
  }

  // Simulated revs: from v.rpm/v.gear when the craft has them, else a
  // gearbox model from speed and throttle.
  function simRpm(st, c, ch, dt) {
    const e = ENGINES[ch];
    const idle = e.idle / e.red;
    const th = clamp(fin(c.throttle), 0, 1);
    const sp0 = Math.abs(fin(c.speed));
    const maxS = (c.spec && c.spec.maxSpeed) || 40;
    const ratio = sp0 / maxS;
    let target;
    let rate;
    if (Number.isFinite(c.rpm)) {
      target = clamp(c.rpm, 0, 1.05);
      if (Number.isFinite(c.gear) && c.gear !== st.gear) {
        if (st.gear > 0 && c.gear > st.gear) st.shiftT = 0.14;
        st.gear = c.gear;
      }
      // the gearbox reports its own shift: cut the load layer meanwhile
      if (Number.isFinite(c.shiftT) && c.shiftT > 0 && st.shiftT <= 0) st.shiftT = Math.min(0.2, c.shiftT);
      rate = 10;
    } else if (c.kind === 'car') {
      const G = e.gears || 5;
      const inGear = (g) => (ratio / (Math.pow(g / G, 0.85) * 1.02)) * 0.92 + idle * 0.4;
      let g = st.gear > 0 ? st.gear : 1;
      const upAt = 0.48 + 0.4 * th;
      if (inGear(g) > upAt && g < G) {
        g++;
        st.shiftT = 0.16;
      } else if (g > 1 && inGear(g) < 0.3) {
        g--;
      }
      st.gear = g;
      target = Math.max(idle + th * 0.05, inGear(g));
      if (sp0 < 2.5) target = Math.max(target, idle + th * 0.42 * (1 - sp0 / 5));
      const slip = fin(c.slip);
      if (slip > 0.5 && th > 0.5) target += 0.14 * (slip - 0.5);
      rate = st.shiftT > 0 ? 16 : target > st.rpm ? 3 + 5 * th : 4;
    } else if (c.kind === 'boat') {
      target = idle + (0.84 - idle) * Math.pow(th, 0.8) + ratio * 0.1;
      rate = target > st.rpm ? 2.4 : 1.6;
    } else {
      target = th > 0.02 || ratio > 0.2 ? 0.32 + 0.6 * th + 0.1 * ratio : idle;
      rate = 2;
    }
    if (!Number.isFinite(st.rpm)) st.rpm = idle;
    st.rpm += (clamp(target, 0, 1.08) - st.rpm) * Math.min(1, rate * dt);
    let lt = th > 0.04 ? 0.35 + 0.65 * th : 0;
    if (st.shiftT > 0) {
      st.shiftT -= dt;
      lt = 0;
    }
    const prev = st.load;
    st.load += (lt - st.load) * Math.min(1, 12 * dt);
    if (prev > 0.45 && st.load <= 0.45) st.liftT = st.t;
    st.t += dt;
    return st.rpm;
  }
  const newSim = () => ({ rpm: NaN, gear: 0, shiftT: 0, load: 0, liftT: -9, t: 0 });

  // ---- the player's craft ----
  const pv = {
    key: '', craft: null, rig: null, ch: null, sim: newSim(), startT: 0, started: true,
    spool: 0, prevY: 0, prevVy: 0, slapT: 0, popT: 0, offRoad: false, pending: false,
  };
  let enterT = -9;
  let enterCrank = false;
  let fx = null; // persistent craft loops (tyres, wind, wash ...)

  function buildFx() {
    fx = {
      road: bed('road', bus.tyres),
      gravel: bed('gravel', bus.tyres),
      squeal: bed('squeal', bus.tyres),
      wet: bed('wet', bus.tyres),
      rush: bed('wind', bus.tyres, { filterType: 'bandpass', f: 600, q: 0.6 }),
      wash: bed('wash', bus.tyres),
      buffet: bed('buffet', bus.tyres),
      scrape: bed('scrape', bus.effects),
      cabin: bed('wind', bus.world, { filterType: 'lowpass', f: 500, q: 0.6 }),
    };
  }

  function buildPlayerRig(c) {
    const kind = c.kind;
    const ch = engineFor(c);
    if (ch) {
      const r = engineRig(ch, bus.engine, true);
      r.kind = 'engine';
      return r;
    }
    if (kind === 'plane') {
      // jet: two turbine whines and a broadband roar
      const out = gainNode(0, bus.engine);
      const tg = gainNode(0.5, out);
      const t2 = gainNode(0.25, out);
      const lp = biq('lowpass', 800, 0.5, null);
      const rg = gainNode(0, out);
      lp.connect(rg);
      const s1 = loopSrc('turbine', tg, 0.6);
      const s2 = loopSrc('turbine', t2, 0.6);
      const s3 = loopSrc('jetroar', lp, 1);
      return { kind: 'jet', out, tg, t2, lp, rg, srcs: [s1, s2, s3], s1, s2, s3 };
    }
    if (kind === 'heli') {
      const out = gainNode(0, bus.engine);
      const rotG = gainNode(0, out);
      const tailG = gainNode(0, out);
      const turG = gainNode(0, out);
      const s1 = loopSrc('rotor', rotG, 0.1);
      const s2 = loopSrc('tail', tailG, 0.5);
      const s3 = loopSrc('turbine', turG, 0.4);
      const blades = (c.spec && c.spec.blades) || 2;
      const bladeHz = (blades * (blades > 2 ? 250 : 390)) / 60;
      return { kind: 'heli', out, rotG, tailG, turG, srcs: [s1, s2, s3], s1, s2, s3, bladeHz };
    }
    return null;
  }

  function updatePlayer(now, dt) {
    const p = game.player;
    const c = p.mode === 'foot' ? null : p.vehicle;
    const key = c && c.spec ? `${c.kind}:${c.spec.id}:${c.id}` : '';
    if (key !== pv.key) {
      if (pv.rig) stopSources(rigSources(pv.rig), pv.rig.out, now, true);
      pv.rig = null;
      pv.key = key;
      pv.craft = c;
      pv.sim = newSim();
      pv.spool = 0;
      pv.prevY = c ? fin(c.y) : 0;
      pv.prevVy = 0;
      pv.pending = !!(c && c.spec);
      if (c && c.spec) {
        pv.ch = engineFor(c);
        const fresh = now - enterT < 0.6;
        pv.startT = fresh && enterCrank ? enterT + 1.55 : now;
        pv.started = !(fresh && enterCrank);
      }
    }
    if (pv.pending && engineReady(pv.ch)) {
      pv.pending = false;
      pv.rig = buildPlayerRig(c);
      if (now > pv.startT) pv.startT = now;
    }
    updateHorn(c, now);
    const r = pv.rig;
    const speed = c ? Math.abs(fin(c.speed)) : 0;
    const maxS = c && c.spec && c.spec.maxSpeed ? c.spec.maxSpeed : 40;
    const th = c ? clamp(fin(c.throttle), 0, 1) : 0;

    // engine
    if (r && r.kind === 'engine') {
      const rpm = simRpm(pv.sim, c, r.ch, dt);
      let level = 0;
      if (now >= pv.startT) {
        if (!pv.started) {
          // the engine catches: a flare above idle
          pv.started = true;
          pv.sim.rpm = rpm + 0.22;
          pop(0.5);
        }
        level = 0.75 * (0.5 + 0.5 * Math.min(1, pv.sim.rpm)) * (0.72 + 0.28 * pv.sim.load);
      }
      setEngine(r, pv.sim.rpm, pv.sim.load, level, pitchFor(c), now);
      // overrun burble on lift-off for the V8 and sports engines
      const e = ENGINES[r.ch];
      if (e.burble >= 0.3 && pv.sim.load < 0.12 && pv.sim.rpm > 0.42 && pv.sim.t - pv.sim.liftT < 1.6 && now > pv.popT) {
        pop(0.25 + 0.35 * rng.next());
        pv.popT = now + 0.05 + rng.next() * 0.22;
      }
    } else if (r && r.kind === 'jet') {
      pv.spool += (th - pv.spool) * Math.min(1, dt * 0.8);
      const s = pv.spool;
      const air = clamp(speed / maxS, 0, 1.3);
      if (r.s1) set(r.s1.playbackRate, 0.55 + 0.8 * s + 0.05 * air, now, 0.08);
      if (r.s2) set(r.s2.playbackRate, (0.55 + 0.8 * s) * 0.71, now, 0.08);
      set(r.lp.frequency, 450 + 3800 * s, now, 0.1);
      set(r.rg.gain, 0.25 + 0.75 * s, now, 0.1);
      set(r.tg.gain, 0.22 + 0.25 * s, now, 0.1);
      set(r.out.gain, 0.7, now, 0.2);
    } else if (r && r.kind === 'heli') {
      const rs = clamp(fin(c.rotorSpeed), 0, 1.2);
      if (r.s1) set(r.s1.playbackRate, Math.max(0.05, rs) * (r.bladeHz / 14), now, 0.1);
      if (r.s2) set(r.s2.playbackRate, Math.max(0.05, rs), now, 0.1);
      if (r.s3) set(r.s3.playbackRate, 0.4 + 0.45 * rs, now, 0.1);
      set(r.rotG.gain, Math.pow(rs, 1.5) * (0.8 + 0.25 * th), now, 0.1);
      set(r.tailG.gain, 0.22 * rs, now, 0.1);
      set(r.turG.gain, 0.18 * rs, now, 0.1);
      set(r.out.gain, 0.85, now, 0.2);
    }

    // tyres, wind, water
    const isCar = !!c && c.kind === 'car';
    const isBoat = !!c && c.kind === 'boat';
    const isAir = !!c && (c.kind === 'plane' || c.kind === 'heli');
    const sf = clamp(speed / 35, 0, 1.4);
    const rain = game.weather ? clamp(fin(game.weather.rain), 0, 1) : 0;
    const off = isCar && pv.offRoad;
    set(fx.road.g.gain, isCar ? 0.55 * Math.pow(sf, 1.2) * (off ? 0.35 : 1) : 0, now);
    if (fx.road.s) set(fx.road.s.playbackRate, 0.7 + 0.55 * sf, now);
    set(fx.gravel.g.gain, off ? 0.6 * clamp(speed / 18, 0, 1) : 0, now);
    if (fx.gravel.s) set(fx.gravel.s.playbackRate, 0.8 + 0.4 * sf, now);
    const slip = isCar ? fin(c.slip) : 0;
    const sq = clamp((slip - 0.22) / 0.6, 0, 1) * clamp(Math.max(speed, th * 8) / 5, 0, 1) * (off ? 0.15 : 1);
    set(fx.squeal.g.gain, 0.45 * sq, now, 0.04);
    if (fx.squeal.s) set(fx.squeal.s.playbackRate, 0.93 + 0.05 * sf + 0.05 * (rng.next() - 0.5), now, 0.08);
    set(fx.wet.g.gain, isCar ? 0.5 * rain * clamp(speed / 22, 0, 1) : 0, now, 0.2);
    let rush = 0;
    if (isCar) rush = 0.3 * Math.pow(clamp(speed / 45, 0, 1.3), 2);
    else if (isBoat) rush = 0.15 * Math.pow(sf, 2);
    else if (isAir) rush = 0.5 * Math.pow(clamp(speed / maxS, 0, 1.3), 2);
    set(fx.rush.g.gain, rush, now, 0.1);
    set(fx.rush.f.frequency, 380 + speed * (isAir ? 14 : 24), now, 0.1);
    set(fx.wash.g.gain, isBoat ? 0.5 * clamp(fin(c.wake), 0, 1) + 0.25 * sf : 0, now, 0.1);
    if (fx.wash.s) set(fx.wash.s.playbackRate, 0.8 + 0.4 * sf, now);
    set(fx.buffet.g.gain, isAir && c.stalled ? 0.55 : 0, now, 0.08);
    const alt = isAir ? clamp((fin(c.y) - 30) / 150, 0, 1) : 0;
    set(fx.cabin.g.gain, alt * (0.12 + 0.2 * clamp(speed / maxS, 0, 1)), now, 0.4);

    // hull slaps from the boat's bounce
    if (isBoat && dt > 0) {
      const y = fin(c.y);
      const vy = (y - pv.prevY) / dt;
      if (pv.prevVy < -0.35 && vy - pv.prevVy > 0.5 && now > pv.slapT) {
        const s = clamp((vy - pv.prevVy) / 2.5, 0.15, 1);
        slap(c, s);
        pv.slapT = now + 0.18;
      }
      pv.prevY = y;
      pv.prevVy = vy;
    }

    // scrape loop while impacts keep coming
    const scraping = now - scrapeT < 0.16;
    set(fx.scrape.g.gain, scraping ? scrapeLevel * clamp(speed / 8, 0.25, 1) : 0, now, scraping ? 0.03 : 0.08);
    if (fx.scrape.s) set(fx.scrape.s.playbackRate, 0.85 + 0.3 * sf, now);
  }

  function pop(g) {
    const r = pv.rig;
    if (!r || !r.out) return;
    const name = `pop${Math.floor(rng.next() * 3)}`;
    voices.raw(name, bus.engine, g * 0.5, 0.85 + rng.next() * 0.35);
  }

  function slap(c, s) {
    voices.raw(`slap${Math.floor(rng.next() * 3)}`, bus.effects, 0.25 + 0.5 * s, 0.85 + 0.3 * rng.next());
    if (s > 0.6) voices.raw('splash', bus.effects, 0.15 * s, 1.1 + 0.2 * rng.next());
  }

  // ---- horn (while held) ----
  let horn = null;
  function updateHorn(c, now) {
    const want = !!(c && (c.kind === 'car' || c.kind === 'boat') && game.input && game.input.held && game.input.held('horn'));
    if (want && !horn) {
      const id = c.spec && c.spec.id;
      const h = hashId(id);
      const deep = c.kind === 'boat' || id === 'truck' || id === 'van';
      const rate = c.kind === 'boat' ? 0.78 : deep ? 0.96 + (h % 5) * 0.03 : 0.9 + (h % 7) * 0.035;
      const g = gainNode(0, bus.effects);
      const s = loopSrc(deep ? 'hornB' : 'hornA', g, rate);
      if (!s) return;
      g.gain.setTargetAtTime(0.42, now, 0.008);
      horn = { g, s };
    } else if (!want && horn) {
      const hn = horn;
      horn = null;
      hn.g.gain.setTargetAtTime(0, now, 0.025);
      hn.s.stop(now + 0.2);
      hn.s.onended = () => hn.g.disconnect();
    }
  }

  // ---- other craft (up to 4 nearest moving) ----
  const slots = [];
  const near = new Array(OTHERS).fill(null);
  const nearD = new Array(OTHERS).fill(0);
  function buildSlots() {
    for (let i = 0; i < OTHERS; i++) {
      const pan = panNode(bus.engine);
      const g = gainNode(0, pan || bus.engine);
      const lp = biq('lowpass', 1500, 0.6, g);
      slots.push({ v: null, rig: null, rigKey: '', lp, g, pan, sim: newSim(), passT: 0, lastD: 999 });
    }
  }
  function slotRig(v) {
    const ch = engineFor(v);
    if (ch) return { key: ch, rig: Object.assign(engineRig(ch, null, false), { kind: 'engine' }) };
    if (v.kind === 'heli') {
      const out = gainNode(0, null);
      return { key: 'heli', rig: { kind: 'heli', out, srcs: [loopSrc('rotor', out, 1)] } };
    }
    const out = gainNode(0, null);
    return { key: 'jet', rig: { kind: 'jet', out, srcs: [loopSrc('jetroar', out, 1)] } };
  }
  function updateOthers(now, dt) {
    for (let i = 0; i < OTHERS; i++) near[i] = null;
    const vs = game.vehicles || [];
    const pl = game.player;
    const own = pl.mode === 'foot' ? null : pl.vehicle;
    for (let i = 0; i < vs.length; i++) {
      const v = vs[i];
      if (!v || v === own || v.wrecked || !v.spec) continue;
      const moving = Math.abs(fin(v.speed)) > 1.5 || (v.kind === 'heli' && fin(v.rotorSpeed) > 0.2) || (v.driver && v.kind === 'car');
      if (!moving) continue;
      const dx = fin(v.x) - fin(pl.x);
      const dz = fin(v.z) - fin(pl.z);
      const d = Math.sqrt(dx * dx + dz * dz);
      if (d > OTHER_RANGE) continue;
      let k = OTHERS;
      while (k > 0 && (near[k - 1] === null || nearD[k - 1] > d)) k--;
      if (k >= OTHERS) continue;
      for (let m = OTHERS - 1; m > k; m--) {
        near[m] = near[m - 1];
        nearD[m] = nearD[m - 1];
      }
      near[k] = v;
      nearD[k] = d;
    }
    // keep slots whose craft is still near; free the others
    for (const s of slots) {
      if (s.v && !near.includes(s.v)) s.v = null;
    }
    for (let i = 0; i < OTHERS; i++) {
      const v = near[i];
      if (!v || slots.some((s) => s.v === v) || !engineReady(engineFor(v))) continue;
      const s = slots.find((q) => !q.v);
      if (!s) break;
      s.v = v;
      s.sim = newSim();
      s.lastD = 999;
      const want = engineFor(v) || (v.kind === 'heli' ? 'heli' : 'jet');
      if (want !== s.rigKey) {
        if (s.rig) stopSources(rigSources(s.rig), s.rig.out, now, false);
        const made = slotRig(v);
        s.rig = made.rig;
        s.rigKey = made.key;
        s.rig.out.connect(s.lp);
      }
    }
    for (const s of slots) {
      if (!s.v || !s.rig) {
        set(s.g.gain, 0, now, 0.15);
        continue;
      }
      const v = s.v;
      spatial(v.x, v.z, OTHER_RANGE);
      const dop = doppler(v.vx, v.vz);
      const close = 1 - sp.d / OTHER_RANGE;
      set(s.lp.frequency, 500 + 4200 * close * close, now, 0.1);
      if (s.pan) set(s.pan.pan, sp.pan, now, 0.08);
      const spd = Math.abs(fin(v.speed));
      if (s.rig.kind === 'engine') {
        simRpm(s.sim, v, s.rig.ch, dt);
        setEngine(s.rig, s.sim.rpm, 1, 1, pitchFor(v) * (0.97 + (hashId(v.id) % 7) * 0.01) * dop, now, 0.06);
        set(s.g.gain, 0.7 * sp.gain * (0.6 + 0.4 * s.sim.load), now, 0.08);
      } else if (s.rig.kind === 'heli') {
        const rs = clamp(fin(v.rotorSpeed), 0, 1.2);
        const src = s.rig.srcs[0];
        if (src) set(src.playbackRate, Math.max(0.05, rs) * dop, now, 0.1);
        set(s.rig.out.gain, 1, now, 0.1);
        set(s.g.gain, 0.8 * sp.gain * rs, now, 0.1);
      } else {
        const src = s.rig.srcs[0];
        if (src) set(src.playbackRate, (0.8 + 0.3 * clamp(fin(v.throttle), 0, 1)) * dop, now, 0.1);
        set(s.rig.out.gain, 1, now, 0.1);
        set(s.g.gain, 0.8 * sp.gain, now, 0.1);
      }
      // a whoosh when a fast car goes by close
      if (v.kind === 'car' && sp.d < 9 && s.lastD >= 9 && spd > 12 && now > s.passT) {
        voices.spot(`whoosh${Math.floor(rng.next() * 2)}`, 0.18 * clamp(spd / 30, 0.4, 1), sp.pan, 1.2 + rng.next() * 0.2);
        s.passT = now + 2;
      }
      s.lastD = sp.d;
    }
  }

  // ---- police siren ----
  let siren = null;
  let sirenOn = false;
  function buildSiren() {
    const pan = panNode(bus.effects);
    const out = gainNode(0, pan || bus.effects);
    const lp = biq('lowpass', 6000, 0.5, out);
    const gw = gainNode(1, lp);
    const gy = gainNode(0, lp);
    const sw = loopSrc('sirenWail', gw, 1);
    const sy = loopSrc('sirenYelp', gy, 1);
    siren = { pan, out, lp, gw, gy, sw, sy, phase: 0 };
  }
  function updateSiren(now, dt) {
    if (!siren) return;
    if (!sirenOn) {
      set(siren.out.gain, 0, now, 0.06);
      return;
    }
    // nearest police car, preferring one with its siren on
    const vs = game.vehicles || [];
    let best = null;
    let bd = Infinity;
    for (let i = 0; i < vs.length; i++) {
      const v = vs[i];
      if (!v || !v.police || v.wrecked) continue;
      const dx = fin(v.x) - fin(game.player.x);
      const dz = fin(v.z) - fin(game.player.z);
      const d = dx * dx + dz * dz - (v.siren ? 1e6 : 0);
      if (d < bd) {
        bd = d;
        best = v;
      }
    }
    let g = 0.55;
    let dop = 1;
    if (best) {
      spatial(best.x, best.z, 320);
      dop = doppler(best.vx, best.vz);
      g = 0.6 * Math.pow(Math.max(0, 1 - sp.d / 320), 1.4) * Math.min(1, 25 / Math.max(1, sp.d));
      set(siren.lp.frequency, 1500 + 6000 * Math.max(0, 1 - sp.d / 200), now, 0.1);
      if (siren.pan) set(siren.pan.pan, sp.pan, now, 0.1);
    } else if (siren.pan) {
      set(siren.pan.pan, 0, now, 0.1);
    }
    // original pattern: long wail, then a burst of yelp
    siren.phase = (siren.phase + dt) % 11;
    const yelp = siren.phase > 7.2 ? 1 : 0;
    set(siren.gw.gain, 1 - yelp, now, 0.08);
    set(siren.gy.gain, yelp, now, 0.08);
    if (siren.sw) set(siren.sw.playbackRate, dop, now, 0.1);
    if (siren.sy) set(siren.sy.playbackRate, dop, now, 0.1);
    set(siren.out.gain, g, now, 0.1);
  }

  // ---- world ambience ----
  let amb = null;
  const place = { district: 'midtown', urban: 0.8, cricket: 0.2, shore: 50, enclosure: 0, park: false };
  let gullT = 3;
  let clankT = 2;
  let hornT = 12;
  let whooshT = 5;
  function buildAmbience() {
    amb = {
      city: bed('city', duck, { filterType: 'lowpass', f: 1800, q: 0.5, stereo: true }),
      crickets: bed('crickets', duck, { stereo: true }),
      surf: bed('surf', duck, { stereo: true }),
      lap: bed('lap', duck, { stereo: true }),
      wind: bed('wind', duck, { filterType: 'bandpass', f: 500, q: 0.5, stereo: true }),
      rain: bed('rain', duck, { filterType: 'lowpass', f: 8000, q: 0.5, stereo: true }),
    };
  }
  function probePlace() {
    const p = game.player;
    const city = game.city;
    const x = fin(p.x);
    const z = fin(p.z);
    let district = 'midtown';
    if (city && city.districtOf) district = city.districtOf(x, z) || district;
    place.shore = city && city.shoreDist ? fin(city.shoreDist(x, z), 50) : 50;
    place.park = false;
    if (city && city.blocks && city.blocks.length) {
      const bl = city.blocks;
      for (let i = 0; i < bl.length; i++) {
        const b = bl[i];
        if (b.district === 'park' && x >= b.x0 && x <= b.x1 && z >= b.z0 && z <= b.z1) {
          place.park = true;
          break;
        }
      }
    }
    if (place.park) district = 'park';
    place.district = district;
    place.urban = URBAN[district] != null ? URBAN[district] : 0.6;
    place.cricket = CRICKET[district] || 0.1;
    // off-road check for the player's car
    const c = p.mode === 'foot' ? null : p.vehicle;
    pv.offRoad = !!(c && c.kind === 'car' && city && city.onRoad && !city.onRoad(fin(c.x), fin(c.z)));
    // enclosure: four short rays to nearby walls
    let enc = 0;
    const col = game.collision;
    const y = c ? fin(c.y) : fin(p.y);
    if (col && col.raycast && y < 25) {
      const R = 45;
      const dirs = [1, 0, 0, 1, -1, 0, 0, -1];
      for (let k = 0; k < 8; k += 2) {
        const d = fin(col.raycast(x, z, dirs[k], dirs[k + 1], R), R);
        if (d < R) enc += 1 - d / R;
      }
      enc /= 4;
    }
    place.enclosure += (enc - place.enclosure) * 0.5;
  }
  function updateAmbience(now) {
    if (!amb) return;
    const p = game.player;
    const c = p.mode === 'foot' ? null : p.vehicle;
    const W = game.weather || null;
    const night = nightOf(game.clock);
    const sd = place.shore;
    const land = clamp((sd + 10) / 40, 0, 1);
    const nearShore = clamp(1 - Math.abs(sd) / 70, 0, 1);
    const y = c ? fin(c.y) : fin(p.y);
    const alt = clamp(y / 120, 0, 1);
    const rain = W ? clamp(fin(W.rain), 0, 1) : 0;
    const wind = W ? fin(W.wind, 3) : 3;
    const inCar = !!c && c.kind === 'car';
    const speed = c ? Math.abs(fin(c.speed)) : 0;

    set(amb.city.g.gain, 0.3 * land * place.urban * (1 - 0.6 * night) * (1 - 0.8 * alt), now, 0.8);
    set(amb.city.f.frequency, 500 + 1400 * (1 - night), now, 1);
    set(amb.crickets.g.gain, 0.16 * night * land * place.cricket * (1 - alt) * (1 - 0.8 * rain), now, 1.2);
    set(amb.surf.g.gain, 0.34 * nearShore * (place.district === 'beach' ? 1.3 : 1) * (1 - 0.8 * alt), now, 1);
    const harbour = place.district === 'docks' ? 0.22 : sd < -20 ? 0.14 * (1 - alt) : 0;
    set(amb.lap.g.gain, harbour, now, 1);
    const wb = clamp((wind - 1) / 12, 0, 1);
    set(amb.wind.g.gain, 0.04 + 0.26 * Math.pow(wb, 1.2) + 0.1 * alt, now, 1);
    set(amb.wind.f.frequency, 320 + 45 * wind, now, 1);
    set(amb.rain.g.gain, 0.36 * rain, now, 0.8);
    set(amb.rain.f.frequency, inCar ? 1800 : 8000, now, 0.3);
    // duck the ambience a little at speed
    set(duck.gain, 1 - 0.35 * clamp(speed / 40, 0, 1), now, 0.5);

    // reverb sends follow the street's enclosure
    const enc = clamp(place.enclosure, 0, 1) * (1 - alt);
    set(send.engine.gain, 0.04 + 0.22 * enc, now, 0.5);
    set(send.tyres.gain, 0.03 + 0.18 * enc, now, 0.5);
    set(send.effects.gain, 0.16 + 0.45 * enc, now, 0.5);
    set(send.world.gain, 0.12 + 0.12 * enc, now, 0.5);

    // occasional spot sounds
    const t = now;
    if (nearShore > 0.15 && night < 0.5 && t > gullT) {
      voices.spot(`gull${Math.floor(rng.next() * 3)}`, 0.2 * nearShore * (1 - alt), rng.next() * 1.6 - 0.8, 0.9 + rng.next() * 0.25);
      gullT = t + 4 + rng.next() * 9;
    }
    if (place.district === 'docks' && land > 0.3 && t > clankT) {
      voices.spot(`clank${Math.floor(rng.next() * 2)}`, 0.12 + 0.08 * rng.next(), rng.next() * 1.6 - 0.8, 0.8 + rng.next() * 0.4, 2600);
      clankT = t + 3 + rng.next() * 6;
    }
    if (place.urban > 0.6 && night < 0.6 && land > 0.5 && alt < 0.3 && t > hornT) {
      voices.spot(rng.next() < 0.7 ? 'hornA' : 'hornB', 0.045, rng.next() * 1.6 - 0.8, 0.85 + rng.next() * 0.25, 900, 0.18 + rng.next() * 0.35);
      hornT = t + 18 + rng.next() * 25;
    }
    if (place.urban > 0.5 && land > 0.5 && alt < 0.3 && t > whooshT) {
      voices.spot(`whoosh${Math.floor(rng.next() * 2)}`, 0.07 * (1 - 0.6 * night), rng.next() * 1.6 - 0.8, 0.8 + rng.next() * 0.3, 1800);
      whooshT = t + 5 + rng.next() * 9;
    }
  }

  // ---- event sounds ----
  let lastCrash = -1;
  let scrapeT = -9;
  let scrapeLevel = 0;
  function crashAt(x, z, strength) {
    if (!ready) return;
    const now = ctx.currentTime;
    if (now - lastCrash < 0.1 || strength < 1.5) return;
    spatial(x, z, HEARING);
    const s = clamp(strength / 18, 0.08, 1);
    const vg = sp.gain * (0.4 + 0.6 * s);
    if (vg <= 0.01) return;
    lastCrash = now;
    voices.play(bus.effects, vg, sp.pan, (v, t) => {
      v.add(`thud${Math.floor(rng.next() * 3)}`, t, 0.9, 0.85 + 0.3 * rng.next());
      if (strength > 3.5) {
        // metal: the crunch through a few resonances picked per hit
        const bands = [];
        for (let k = 0; k < 3; k++) bands.push([400 + rng.next() * 3400, 3 + rng.next() * 6, 1.4]);
        v.add(`crunch${Math.floor(rng.next() * 2)}`, t + 0.004, 0.25 + 0.55 * s, 0.85 + 0.3 * rng.next(), bands);
      }
      if (strength > 11) v.add(`glass${Math.floor(rng.next() * 2)}`, t + 0.01, 0.5 * s, 0.9 + 0.2 * rng.next());
    });
  }
  function posOf(c) {
    return c && Number.isFinite(c.x) ? c : game.player;
  }
  function onImpact(c, strength) {
    if (!ready) return;
    const st = fin(strength);
    const own = game.player.mode !== 'foot' && c === game.player.vehicle;
    if (own) {
      scrapeT = ctx.currentTime;
      scrapeLevel = clamp(0.15 + st / 10, 0.15, 0.55);
    }
    const q = posOf(c);
    crashAt(q.x, q.z, st);
  }
  function onCrash(a, b, strength) {
    if (!ready) return;
    const ca = posOf(a);
    const cb = posOf(b);
    crashAt((fin(ca.x) + fin(cb.x)) / 2, (fin(ca.z) + fin(cb.z)) / 2, fin(strength));
  }
  function onEnter(v) {
    if (!ready) return;
    const now = ctx.currentTime;
    const crank = !!v && (v.kind === 'car' || v.kind === 'boat' || (v.kind === 'plane' && !isJet(v)));
    enterT = now;
    enterCrank = crank;
    voices.play(bus.effects, 0.7, 0, (vc, t) => {
      vc.add('doorOpen', t, 0.8, 1);
      vc.add('doorClose', t + 0.5, 1, v && v.kind === 'boat' ? 1.3 : 1);
      if (crank) vc.add('crank', t + 0.8, 0.55, v.kind === 'boat' ? 1.2 : v.kind === 'plane' ? 0.85 : 1);
    });
  }
  function onExit(v) {
    if (!ready) return;
    voices.play(bus.effects, 0.7, 0, (vc, t) => {
      vc.add('doorOpen', t + 0.25, 0.8, 1);
      vc.add('doorClose', t + 0.75, 0.9, v && v.kind === 'boat' ? 1.3 : 1);
    });
  }
  function uiShot(name, g) {
    if (!ready) return;
    voices.play(bus.ui, g, 0, (v, t) => v.add(name, t, 1, 1));
  }
  function onSplash(a, b) {
    if (!ready) return;
    let x = fin(game.player.x);
    let z = fin(game.player.z);
    if (a && typeof a === 'object' && Number.isFinite(a.x)) {
      x = a.x;
      z = a.z;
    } else if (Number.isFinite(a) && Number.isFinite(b)) {
      x = a;
      z = b;
    }
    spatial(x, z, HEARING);
    voices.play(bus.effects, sp.gain * 0.7, sp.pan, (v, t) => v.add('splash', t, 1, 0.9 + 0.2 * rng.next()));
  }

  // ---- combat sounds (docs/COMBAT.md events) ----
  // Weapon sounds are single shots; rattle comes from the fire rate.
  // Everything is positioned: distance falloff, stereo pan, and a delay
  // for sound travel. Quiet detail sounds give way when voices run low.
  const GUNS = {
    pistol: { buf: 'gunPistol', n: 2, g: 0.8, range: 160, gap: 0.03, last: -9 },
    smg: { buf: 'gunSmg', n: 2, g: 0.62, range: 160, gap: 0.05, last: -9 },
    scatter: { buf: 'gunScatter', n: 1, g: 1, range: 220, gap: 0.2, last: -9 },
    lobber: { buf: 'gunLobber', n: 1, g: 0.9, range: 220, gap: 0.2, last: -9 },
  };
  const lastC = { impact: -9, hit: -9, down: -9, whiz: -9, reload: -9, melee: -9 };
  const lowPriority = () => voices.count >= 6;
  const SOUND_V = 340;
  function combatGate(key, gap) {
    const now = ctx.currentTime;
    if (now - lastC[key] < gap) return false;
    lastC[key] = now;
    return true;
  }
  function ownShot(shooter) {
    const pl = game.player;
    return !!pl && (shooter === pl.walker || shooter === pl);
  }
  function onShot(e) {
    if (!ready || !e) return;
    const w = e.weapon;
    const x = fin(e.x);
    const z = fin(e.z);
    if (w === 'wrench') {
      if (e.hitKind === 'none' && combatGate('melee', 0.1)) {
        spatial(x, z, 50);
        voices.play(bus.effects, sp.gain * 0.35, sp.pan, (v, t) => v.add(`whoosh${Math.floor(rng.next() * 2)}`, t, 1, 1.5 + rng.next() * 0.3));
      }
      return;
    }
    if (w === 'fizz') {
      spatial(x, z, 60);
      voices.play(bus.effects, sp.gain * 0.5, sp.pan, (v, t) => v.add(`pop${Math.floor(rng.next() * 3)}`, t, 1, 0.8 + rng.next() * 0.2));
      return;
    }
    const def = GUNS[w];
    if (!def) return;
    const own = ownShot(e.shooter);
    const now = ctx.currentTime;
    if (now - def.last >= def.gap && (own || !lowPriority())) {
      def.last = now;
      spatial(x, z, def.range);
      const delay = own ? 0 : Math.min(0.35, sp.d / SOUND_V);
      const name = def.n > 1 ? `${def.buf}${Math.floor(rng.next() * def.n)}` : def.buf;
      voices.play(bus.effects, sp.gain * def.g, sp.pan, (v, t) => v.add(name, t + delay, 1, 0.95 + rng.next() * 0.1));
    }
    if (w === 'lobber') return;
    // A bullet passing close to the player (not their own).
    const hx = fin(e.hx, x);
    const hz = fin(e.hz, z);
    const pl = game.player;
    if (!own && pl && !lowPriority()) {
      const sx = hx - x;
      const sz = hz - z;
      const l2 = sx * sx + sz * sz;
      if (l2 > 4) {
        const t = clamp(((fin(pl.x) - x) * sx + (fin(pl.z) - z) * sz) / l2, 0, 1);
        const cx = x + sx * t;
        const cz = z + sz * t;
        const dd = Math.hypot(cx - fin(pl.x), cz - fin(pl.z));
        if (dd < 3.5 && t > 0.02 && combatGate('whiz', 0.08)) {
          spatial(cx, cz, 60);
          voices.play(bus.effects, 0.6 * (1 - dd / 3.5), sp.pan, (v, tt) => v.add(`whiz${Math.floor(rng.next() * 2)}`, tt, 1, 0.9 + rng.next() * 0.3));
        }
      }
    }
    // Strikes on walls and ground (people and craft sound from `hit`).
    if ((e.hitKind === 'wall' || e.hitKind === 'ground') && !lowPriority() && combatGate('impact', 0.045)) {
      spatial(hx, hz, 55);
      const rico = rng.next() < 0.3;
      voices.play(bus.effects, sp.gain * (rico ? 0.5 : 0.55), sp.pan, (v, t) => {
        if (rico) v.add(`ricochet${Math.floor(rng.next() * 2)}`, t, 1, 0.9 + rng.next() * 0.3);
        else v.add(`impact${Math.floor(rng.next() * 2)}`, t, 1, 0.85 + rng.next() * 0.3);
      });
    }
  }
  function onHit(e) {
    if (!ready || !e || !e.target) return;
    const k = e.kind;
    if (k !== 'bullet' && k !== 'melee') return;
    if (lowPriority() && !ownShot(e.source)) return;
    if (!combatGate('hit', 0.035)) return;
    const craft = !!(e.target.spec && e.target.hp === undefined);
    spatial(fin(e.x), fin(e.z), 70);
    const g = sp.gain;
    voices.play(bus.effects, g * (k === 'melee' ? 1 : 0.7), sp.pan, (v, t) => {
      if (k === 'melee') {
        v.add(`thwack${Math.floor(rng.next() * 2)}`, t, 1, 0.9 + rng.next() * 0.2);
        if (craft) v.add(`clank${Math.floor(rng.next() * 2)}`, t, 0.6, 0.8);
      } else if (craft) {
        v.add(`clank${Math.floor(rng.next() * 2)}`, t, 0.8, 1.1 + rng.next() * 0.3);
        if (rng.next() < 0.3) v.add(`ricochet${Math.floor(rng.next() * 2)}`, t + 0.01, 0.5, 1);
      } else {
        v.add(`bodyHit${Math.floor(rng.next() * 2)}`, t, 1, 0.9 + rng.next() * 0.25);
      }
    });
  }
  function onDown(e) {
    if (!ready || !e || !e.target || (e.target.spec && e.target.hp === undefined)) return;
    if (lowPriority() || !combatGate('down', 0.08)) return;
    spatial(fin(e.target.x), fin(e.target.z), 60);
    voices.play(bus.effects, sp.gain * 0.6, sp.pan, (v, t) => v.add(`thud${Math.floor(rng.next() * 3)}`, t + 0.05, 1, 1.1));
  }
  function onExplosion(e) {
    if (!ready || !e) return;
    spatial(fin(e.x), fin(e.z), 400);
    const k = clamp(fin(e.radius, 8) / 8, 0.6, 1.5);
    const d = sp.d;
    const g = Math.pow(Math.max(0, 1 - d / 400), 1.3) * (0.3 + 0.7 * Math.min(1, 30 / Math.max(1, d))) * (0.75 + 0.25 * k);
    if (g < 0.01) return;
    const delay = Math.min(1.2, d / SOUND_V);
    const pan = sp.pan * (d < 6 ? d / 6 : 1);
    const rate = 1.12 - 0.15 * k + rng.next() * 0.08;
    voices.play(bus.effects, g, pan, (v, t) => {
      v.add(`blast${Math.floor(rng.next() * 2)}`, t + delay, 1, rate);
      if (d > 120) v.add('thud0', t + delay, 0.2, 0.6);
    });
  }
  function onBurning(e) {
    if (!ready || !e || !e.on || !e.craft) return;
    spatial(fin(e.craft.x), fin(e.craft.z), 90);
    voices.play(bus.effects, sp.gain * 0.45, sp.pan, (v, t) => v.add('whoosh0', t, 1, 0.55));
  }
  function onReload(e) {
    if (!ready || !e || !e.actor || lowPriority() || !combatGate('reload', 0.05)) return;
    const def = WEAPONS[e.weapon];
    if (!def || !def.reload) return;
    spatial(fin(e.actor.x), fin(e.actor.z), 45);
    const g = sp.gain * 0.55;
    const tEnd = Math.max(0.25, def.reload * 0.75);
    voices.play(bus.effects, g, sp.pan, (v, t) => {
      v.add('reloadA', t + 0.12, 1, 0.95 + rng.next() * 0.1);
      v.add('reloadB', t + tEnd, 1, 0.95 + rng.next() * 0.1);
    });
  }
  function onEmpty(e) {
    if (!ready || !e || !e.actor || lowPriority()) return;
    spatial(fin(e.actor.x), fin(e.actor.z), 35);
    voices.play(bus.effects, sp.gain * 0.35, sp.pan, (v, t) => v.add('emptyClick', t + 0.1, 1, 1));
  }
  function onSwitch(e) {
    if (!ready || !e || !e.actor || !ownShot(e.actor)) return;
    voices.play(bus.effects, 0.3, 0, (v, t) => v.add('reloadA', t, 1, 1.25));
  }
  function onPlayerDown() {
    if (!ready) return;
    voices.play(bus.effects, 0.7, 0, (v, t) => {
      v.add('thud0', t, 1, 0.8);
      v.add('bodyHit0', t + 0.02, 0.8, 0.8);
    });
  }
  function guard(fn) {
    return (a, b, c) => {
      try {
        if (ctx && !disposed) fn(a, b, c);
      } catch {
        /* never let audio break the game */
      }
    };
  }

  // ---- context life cycle ----
  function applyBus() {
    if (!ctx) return;
    const now = ctx.currentTime;
    master.gain.setTargetAtTime(muted ? 0 : vol.master, now, 0.03);
    for (const k of Object.keys(BUS)) bus[k].gain.setTargetAtTime(BUS[k] * vol[k], now, 0.05);
  }

  function syncRunState() {
    if (!ctx) return;
    const want = !(game.paused || hidden);
    if (want === wantRunning && (!want || ctx.state === 'running')) return;
    wantRunning = want;
    const p = want ? ctx.resume() : ctx.suspend();
    if (p && p.catch) p.catch(() => {});
  }

  function onVisibility() {
    hidden = document.hidden === true;
    syncRunState();
  }

  function schedule(fn) {
    if (typeof MessageChannel !== 'undefined') {
      const ch = new MessageChannel();
      ch.port1.onmessage = () => {
        ch.port1.close();
        fn();
      };
      ch.port2.postMessage(0);
    } else {
      setTimeout(fn, 0);
    }
  }
  const nowMs = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

  let pumping = false;
  let extrasBuilt = false;
  function ensurePump() {
    if (!pumping && bank && !disposed) {
      pumping = true;
      schedule(pump);
    }
  }
  // An engine character's loops, generating them on first use.
  function engineReady(ch) {
    if (!ch) return true;
    if (buf(`eng:${ch}:0:off`)) return true;
    if (bank && bank.request(ch)) ensurePump();
    return false;
  }

  function pump() {
    if (disposed || !ctx || !bank) {
      pumping = false;
      return;
    }
    const t0 = nowMs();
    let r;
    try {
      r = bank.step(SLICE_MS);
    } catch {
      bank = null;
      return;
    }
    const e = nowMs() - t0;
    if (ready) gen.lazyMs += e;
    else gen.cpuMs += e;
    gen.slices++;
    if (e > gen.maxSliceMs) gen.maxSliceMs = e;
    if (r && typeof r.then === 'function') {
      // waiting for offline renders on the audio thread
      r.then(() => schedule(pump));
      return;
    }
    try {
      if (!ready && bank.essential) {
        gen.wallMs = nowMs() - gen.startMs;
        onBankReady();
      }
      if (ready && !extrasBuilt && bank.extras) {
        extrasBuilt = true;
        gen.fullMs = nowMs() - gen.startMs;
        buildSiren();
        buildAmbience();
      }
    } catch {
      /* keep going without the failed part */
    }
    if (!r) {
      schedule(pump);
      return;
    }
    pumping = false;
  }

  function onBankReady() {
    if (convolver && bank.buffers.ir) convolver.buffer = bank.buffers.ir;
    buildFx();
    buildSlots();
    ready = true;
  }

  function unlock() {
    if (disposed || !Ctor) return;
    if (ctx) {
      if (ctx.state !== 'running' && !game.paused && !hidden) {
        const p = ctx.resume();
        if (p && p.catch) p.catch(() => {});
      }
      return;
    }
    try {
      ctx = new Ctor();
      master = gainNode(0, null);
      // gentle glue compression, then a fast limiter and a soft clip
      comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -20;
      comp.knee.value = 10;
      comp.ratio.value = 3;
      comp.attack.value = 0.01;
      comp.release.value = 0.25;
      limiter = ctx.createDynamicsCompressor();
      limiter.threshold.value = -4;
      limiter.knee.value = 0;
      limiter.ratio.value = 20;
      limiter.attack.value = 0.002;
      limiter.release.value = 0.12;
      shaper = ctx.createWaveShaper();
      const curve = new Float32Array(1024);
      for (let i = 0; i < curve.length; i++) curve[i] = (Math.tanh(((i / (curve.length - 1)) * 2 - 1) * 1.2) / Math.tanh(1.2)) * 0.98;
      shaper.curve = curve;
      // the compressors add make-up gain; trim it back so the mix sits
      // around -20 dBFS instead of shouting
      const trim = gainNode(0.42, limiter);
      master.connect(comp);
      comp.connect(trim);
      limiter.connect(shaper);
      shaper.connect(ctx.destination);
      // reverb shared by all buses through per-bus sends
      ret = gainNode(0.55, master);
      if (ctx.createConvolver) {
        convolver = ctx.createConvolver();
        convolver.connect(ret);
      }
      for (const k of Object.keys(BUS)) {
        bus[k] = gainNode(BUS[k], master);
        if (k !== 'ui') {
          send[k] = gainNode(0.1, convolver || null);
          bus[k].connect(send[k]);
        }
      }
      duck = gainNode(1, bus.world);
      voices = createVoices(ctx, () => bank && bank.buffers, rng, duck);
    } catch {
      ctx = null;
      return;
    }
    applyBus();
    wantRunning = true;
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisibility);
    const p = ctx.resume();
    if (p && p.catch) p.catch(() => {});
    syncRunState();

    // generate the sound bank a few milliseconds at a time
    const c = game.player && game.player.mode !== 'foot' ? game.player.vehicle : null;
    try {
      bank = createBank(ctx, { first: engineFor(c) });
    } catch {
      bank = null;
    }
    gen.startMs = nowMs();
    ensurePump();

    const ev = game.events;
    if (ev && !unsubs.length) {
      unsubs.push(
        ev.on('vehicleImpact', guard(onImpact)),
        ev.on('vehicleCrash', guard(onCrash)),
        ev.on('enter', guard(onEnter)),
        ev.on('exit', guard(onExit)),
        ev.on('ui', guard(() => uiShot('click', 0.5))),
        ev.on('reward', guard(() => uiShot('chime', 0.6))),
        ev.on('fail', guard(() => uiShot('fail', 0.6))),
        ev.on('checkpoint', guard(() => uiShot('checkpoint', 0.5))),
        ev.on('splash', guard(onSplash)),
        ev.on('shot', guard(onShot)),
        ev.on('hit', guard(onHit)),
        ev.on('down', guard(onDown)),
        ev.on('explosion', guard(onExplosion)),
        ev.on('burning', guard(onBurning)),
        ev.on('reload', guard(onReload)),
        ev.on('empty', guard(onEmpty)),
        ev.on('weaponSwitch', guard(onSwitch)),
        ev.on('playerDown', guard(onPlayerDown)),
        ev.on('siren', guard((on) => {
          sirenOn = !!on;
        })),
        ev.on('pause', guard(() => syncRunState())),
      );
    }
  }

  function render(_alpha, dt) {
    if (!ctx || disposed) return;
    try {
      syncRunState();
      if (!wantRunning || !ready) return;
      const step = clamp(fin(dt, 1 / 60), 0, 0.25);
      acc += step;
      placeAcc += step;
      if (acc < UPDATE_EVERY) return;
      const now = ctx.currentTime;
      const udt = clamp(lastUpdate > 0 ? now - lastUpdate : acc, 1 / 120, 0.25);
      lastUpdate = now;
      acc = 0;
      playerVel(pvel);
      if (placeAcc >= PLACE_EVERY) {
        placeAcc = 0;
        probePlace();
      }
      updatePlayer(now, udt);
      updateOthers(now, udt);
      updateSiren(now, udt);
      updateAmbience(now);
      voices.tick(now);
    } catch {
      /* never throw from render */
    }
  }

  function setVolume(v) {
    if (!v) return;
    for (const k of ['master', 'engine', 'tyres', 'world', 'effects', 'ui']) {
      if (Number.isFinite(v[k])) vol[k] = clamp(v[k], 0, 1);
    }
    if (Number.isFinite(v.music)) vol.ui = clamp(v.music, 0, 1);
    try {
      applyBus();
    } catch {
      /* ignore */
    }
  }

  function setMuted(m) {
    muted = !!m;
    try {
      applyBus();
    } catch {
      /* ignore */
    }
  }

  function dispose() {
    disposed = true;
    for (let i = 0; i < unsubs.length; i++) unsubs[i]();
    unsubs.length = 0;
    if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisibility);
    if (ctx) {
      const c = ctx;
      ctx = null;
      ready = false;
      c.close().catch(() => {});
    }
  }

  return {
    name: 'audio',
    unlock,
    render,
    setVolume,
    setMuted,
    dispose,
    get output() {
      return shaper;
    },
    get activeVoices() {
      return voices ? voices.count : 0;
    },
    // For tests and tuning: generation stats, buffers and bus taps.
    get debug() {
      return {
        ready,
        genWallMs: gen.wallMs,
        genCpuMs: gen.cpuMs,
        lazyMs: gen.lazyMs,
        fullMs: gen.fullMs,
        maxSliceMs: gen.maxSliceMs,
        slices: gen.slices,
        bankStats: bank ? bank.stats : null,
        bytes: bank ? bank.bytes : 0,
        buffers: bank ? bank.buffers : null,
        loops: bank ? bank.loops : [],
        buses: bus,
        reverb: ret,
        master,
        sirenOn,
        siren: siren ? siren.out : null,
        rpm: pv.sim.rpm,
        gear: pv.sim.gear,
      };
    },
  };
}
