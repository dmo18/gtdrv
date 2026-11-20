// Audio system: everything is synthesised with the Web Audio API (no files,
// no network). Engine loops for the player's craft, pooled one-shots for
// events, a very quiet ambient bed and drive-by drones for nearby craft.
// Silent no-op until unlock() is called from a user gesture, and also when
// the browser has no AudioContext.

const MAX_VOICES = 8;
const HEARING = 60; // metres for crash sounds
const DRONE_RANGE = 50;
const DRONES = 3;
const UPDATE_EVERY = 0.03; // seconds between parameter pushes

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const fin = (v, d = 0) => (Number.isFinite(v) ? v : d);

// Base engine pitch (Hz at idle) per car spec id.
const CAR_BASE = {
  truck: 38, pickup: 46, van: 50, muscle: 52, sedan: 58, taxi: 58, police: 58, compact: 66, sports: 76,
};

function hashId(id) {
  let h = 7;
  const s = String(id || '');
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

export function createAudio(game) {
  const Ctor = typeof window !== 'undefined' ? window.AudioContext || window.webkitAudioContext : null;
  let ctx = null;
  let master = null;
  let limiter = null;
  let shaper = null;
  let engineBus = null;
  let fxBus = null;
  let musicBus = null;
  let noiseBuf = null;
  let muted = false;
  let hidden = typeof document !== 'undefined' && document.hidden === true;
  let wantRunning = true;
  const vol = { master: 0.8, engine: 1, effects: 1, music: 1 };
  let voices = 0;
  let disposed = false;

  let rig = null;
  let rigKey = '';
  let amb = null;
  let drones = null;
  let horn = null;
  let acc = 0;
  let lastCrash = -1;
  const unsubs = [];
  const near = new Array(DRONES).fill(null);
  const nearD = new Array(DRONES).fill(0);

  // ---- building blocks ----
  function makeNoise() {
    const n = Math.floor(ctx.sampleRate * 2);
    const buf = ctx.createBuffer(1, n, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let s = 12345;
    for (let i = 0; i < n; i++) {
      s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
      d[i] = (s / 4294967296) * 2 - 1;
    }
    return buf;
  }

  function noiseSrc() {
    const s = ctx.createBufferSource();
    s.buffer = noiseBuf;
    s.loop = true;
    s.start(0, (hashId(String(ctx.currentTime)) % 100) / 50);
    return s;
  }

  function osc(type, freq, dest) {
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    if (dest) o.connect(dest);
    o.start();
    return o;
  }

  function gainNode(v, dest) {
    const g = ctx.createGain();
    g.gain.value = v;
    if (dest) g.connect(dest);
    return g;
  }

  function filter(type, f, q, src, dest) {
    const b = ctx.createBiquadFilter();
    b.type = type;
    b.frequency.value = f;
    b.Q.value = q;
    if (src) src.connect(b);
    if (dest) b.connect(dest);
    return b;
  }

  function panner(dest) {
    if (ctx.createStereoPanner) {
      const p = ctx.createStereoPanner();
      p.connect(dest);
      return p;
    }
    return null;
  }

  // Stereo pan and distance gain for a world position, from the camera.
  const tmp = { gain: 1, pan: 0 };
  function spatial(x, z, range) {
    const p = game.player;
    const dx = x - fin(p.x);
    const dz = z - fin(p.z);
    const d = Math.sqrt(dx * dx + dz * dz);
    const e = game.camera && game.camera.matrixWorld && game.camera.matrixWorld.elements;
    let rx = 1;
    let rz = 0;
    if (e) {
      rx = e[0];
      rz = e[2];
    }
    tmp.gain = d >= range ? 0 : Math.pow(1 - d / range, 1.5);
    tmp.pan = d > 0.5 ? clamp((dx * rx + dz * rz) / d, -1, 1) * 0.8 : 0;
    return tmp;
  }

  // ---- engine rigs ----
  function newRig() {
    const out = gainNode(0, engineBus);
    return { out, srcs: [], update: null };
  }
  function track(r, s) {
    r.srcs.push(s);
    return s;
  }

  function buildCar(spec) {
    const r = newRig();
    const base = CAR_BASE[spec.id] || 56;
    const lp = filter('lowpass', 400, 0.8, null, r.out);
    const mix = gainNode(0.3, lp);
    const o1 = track(r, osc('sawtooth', base, mix));
    const o2 = track(r, osc('square', base, mix));
    o2.detune.value = 14;
    const sub = track(r, osc('sine', base / 2, mix));
    const sq = track(r, noiseSrc());
    const sqf = filter('bandpass', 1900, 7, sq, null);
    const sqg = gainNode(0, engineBus);
    sqf.connect(sqg);
    r.extra = sqg;
    r.update = (c, now) => {
      const ratio = clamp(Math.abs(fin(c.speed)) / (spec.maxSpeed || 40), 0, 1.2);
      const th = clamp(fin(c.throttle), 0, 1);
      const GEARS = 5;
      const gp = Math.pow(Math.min(ratio, 1), 0.75) * GEARS;
      const gear = Math.min(GEARS - 1, Math.floor(gp));
      const frac = gp - gear;
      const rpm = clamp(0.12 + 0.88 * (frac * 0.78 + th * 0.22), 0, 1);
      const f = base * (1 + rpm * 3.1);
      o1.frequency.setTargetAtTime(f, now, 0.045);
      o2.frequency.setTargetAtTime(f * 1.004, now, 0.045);
      sub.frequency.setTargetAtTime(f * 0.5, now, 0.045);
      lp.frequency.setTargetAtTime(260 + rpm * 1300 + th * 900, now, 0.06);
      r.out.gain.setTargetAtTime(0.1 + 0.06 * rpm + 0.14 * th, now, 0.08);
      const slip = fin(c.slip);
      sqg.gain.setTargetAtTime(clamp((slip - 0.2) * 0.5, 0, 0.14), now, 0.05);
    };
    return r;
  }

  function buildBoat(spec) {
    const r = newRig();
    const lp = filter('lowpass', 420, 1, null, r.out);
    const amp = gainNode(0.6, lp);
    const mix = gainNode(0.5, amp);
    const o1 = track(r, osc('sawtooth', 30, mix));
    const o2 = track(r, osc('triangle', 15, mix));
    const lfo = track(r, osc('sine', 8, null));
    const lfoDepth = gainNode(0.4, amp.gain);
    lfo.connect(lfoDepth);
    const nz = track(r, noiseSrc());
    const bp = filter('bandpass', 700, 0.6, nz, null);
    const wg = gainNode(0, r.out);
    bp.connect(wg);
    r.update = (c, now) => {
      const ratio = clamp(Math.abs(fin(c.speed)) / (spec.maxSpeed || 20), 0, 1.2);
      const th = clamp(fin(c.throttle), 0, 1);
      const f = 28 + th * 26 + ratio * 18;
      o1.frequency.setTargetAtTime(f, now, 0.08);
      o2.frequency.setTargetAtTime(f * 0.5, now, 0.08);
      lfo.frequency.setTargetAtTime(6 + th * 8, now, 0.1);
      lp.frequency.setTargetAtTime(280 + th * 500, now, 0.1);
      wg.gain.setTargetAtTime(ratio * 1.6, now, 0.2);
      bp.frequency.setTargetAtTime(500 + ratio * 900, now, 0.2);
      r.out.gain.setTargetAtTime(0.12 + 0.1 * th, now, 0.1);
    };
    return r;
  }

  function buildPlane(spec) {
    const r = newRig();
    const jet = spec.jet === true || spec.engine === 'jet' || /jet/i.test(String(spec.id));
    const wnz = track(r, noiseSrc());
    const wbp = filter('bandpass', 1000, 0.5, wnz, null);
    const wg = gainNode(0, r.out);
    wbp.connect(wg);
    let o1;
    let o2;
    let lp;
    let nbp;
    let ng;
    let whine;
    let wh;
    if (jet) {
      const nz = track(r, noiseSrc());
      nbp = filter('bandpass', 1600, 0.9, nz, null);
      ng = gainNode(0.1, r.out);
      nbp.connect(ng);
      whine = track(r, osc('sine', 1600, null));
      wh = gainNode(0.02, r.out);
      whine.connect(wh);
    } else {
      lp = filter('lowpass', 800, 0.7, null, r.out);
      const mix = gainNode(0.3, lp);
      o1 = track(r, osc('sawtooth', 60, mix));
      o2 = track(r, osc('square', 60, mix));
      o2.detune.value = 18;
    }
    r.update = (c, now) => {
      const ratio = clamp(Math.abs(fin(c.speed)) / (spec.maxSpeed || 80), 0, 1.3);
      const th = clamp(fin(c.throttle), 0, 1);
      wg.gain.setTargetAtTime(ratio * 1.2, now, 0.2);
      wbp.frequency.setTargetAtTime(600 + ratio * 1400, now, 0.2);
      if (jet) {
        nbp.frequency.setTargetAtTime(1100 + th * 1800 + ratio * 600, now, 0.12);
        ng.gain.setTargetAtTime(0.1 + 0.4 * th, now, 0.12);
        whine.frequency.setTargetAtTime(1400 + th * 2400, now, 0.12);
        wh.gain.setTargetAtTime(0.01 + 0.03 * th, now, 0.12);
        r.out.gain.setTargetAtTime(0.4, now, 0.1);
      } else {
        const f = 52 + th * 70 + ratio * 30;
        o1.frequency.setTargetAtTime(f, now, 0.1);
        o2.frequency.setTargetAtTime(f * 1.003, now, 0.1);
        lp.frequency.setTargetAtTime(600 + th * 700, now, 0.1);
        r.out.gain.setTargetAtTime(0.08 + 0.12 * th, now, 0.1);
      }
    };
    return r;
  }

  function buildHeli() {
    const r = newRig();
    const nz = track(r, noiseSrc());
    const lp = filter('lowpass', 600, 0.8, nz, null);
    const am = gainNode(0.5, r.out);
    lp.connect(am);
    const lfo = track(r, osc('sine', 12, null));
    const depth = gainNode(0.5, am.gain);
    lfo.connect(depth);
    const whine = track(r, osc('sine', 800, null));
    const wg = gainNode(0, r.out);
    whine.connect(wg);
    r.update = (c, now) => {
      const rs = clamp(fin(c.rotorSpeed), 0, 1.3);
      lfo.frequency.setTargetAtTime(Math.max(1.5, 12 * rs), now, 0.15);
      lp.frequency.setTargetAtTime(350 + rs * 500, now, 0.15);
      r.out.gain.setTargetAtTime(rs * 0.9, now, 0.15);
      whine.frequency.setTargetAtTime(600 + rs * 1400, now, 0.15);
      wg.gain.setTargetAtTime(rs * 0.025, now, 0.15);
    };
    return r;
  }

  function stopRig(r) {
    if (!r) return;
    const now = ctx.currentTime;
    r.out.gain.cancelScheduledValues(now);
    r.out.gain.setTargetAtTime(0, now, 0.05);
    if (r.extra) r.extra.gain.setTargetAtTime(0, now, 0.05);
    for (let i = 0; i < r.srcs.length; i++) {
      try {
        r.srcs[i].stop(now + 0.4);
      } catch {
        /* already stopped */
      }
    }
    const first = r.srcs[0];
    if (first) {
      first.onended = () => {
        r.out.disconnect();
        if (r.extra) r.extra.disconnect();
      };
    }
  }

  function updateEngine(now) {
    const p = game.player;
    const craft = p.mode === 'foot' ? null : p.vehicle;
    const key = craft && craft.spec ? `${craft.kind}:${craft.spec.id}` : '';
    if (key !== rigKey) {
      stopRig(rig);
      rig = null;
      rigKey = key;
      if (craft && craft.spec) {
        const spec = craft.spec;
        if (craft.kind === 'car') rig = buildCar(spec);
        else if (craft.kind === 'boat') rig = buildBoat(spec);
        else if (craft.kind === 'plane') rig = buildPlane(spec);
        else if (craft.kind === 'heli') rig = buildHeli(spec);
      }
    }
    if (rig) rig.update(craft, now);
    updateHorn(craft, now);
  }

  // ---- horn (while held) ----
  function updateHorn(craft, now) {
    const want = !!(craft && (craft.kind === 'car' || craft.kind === 'boat') &&
      game.input && game.input.held && game.input.held('horn'));
    if (want && !horn) {
      const h = hashId(craft.spec && craft.spec.id);
      const f1 = (craft.kind === 'boat' ? 150 : 330) + (h % 6) * 22;
      const ratio = [1.25, 1.2, 1.335, 1.5, 1.26, 1.18][(h >> 3) % 6];
      const lp = filter('lowpass', 2200, 0.5, null, fxBus);
      const g = gainNode(0, lp);
      const a = osc('square', f1, g);
      const b = osc('square', f1 * ratio, g);
      g.gain.setTargetAtTime(0.1, now, 0.01);
      horn = { g, lp, a, b };
    } else if (!want && horn) {
      const hn = horn;
      horn = null;
      hn.g.gain.setTargetAtTime(0, now, 0.015);
      hn.a.stop(now + 0.15);
      hn.b.stop(now + 0.15);
      hn.a.onended = () => {
        hn.g.disconnect();
        hn.lp.disconnect();
      };
    }
  }

  // ---- one-shots ----
  // build(g, t) receives the voice's output gain and start time and returns
  // the list of sources it created; all are stopped at t + dur.
  function oneShot(dur, bus, vgain, pan, build) {
    if (!ctx || voices >= MAX_VOICES || vgain <= 0.001) return;
    const t = ctx.currentTime;
    const g = gainNode(vgain, null);
    const p = panner(bus);
    if (p) {
      p.pan.value = pan;
      g.connect(p);
    } else {
      g.connect(bus);
    }
    const srcs = build(g, t);
    voices++;
    let done = false;
    const end = () => {
      if (done) return;
      done = true;
      voices--;
      g.disconnect();
      if (p) p.disconnect();
    };
    for (let i = 0; i < srcs.length; i++) srcs[i].stop(t + dur);
    srcs[0].onended = end;
  }

  function envOn(param, t, peak, attack, dur) {
    param.setValueAtTime(0.0001, t);
    param.linearRampToValueAtTime(peak, t + attack);
    param.exponentialRampToValueAtTime(0.0001, t + dur);
  }

  function tone(type, f0, f1, dur, peak, g, t, attack = 0.004) {
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const e = gainNode(0, g);
    envOn(e.gain, t, peak, attack, dur);
    o.connect(e);
    o.start(t);
    return o;
  }

  function burst(ftype, f0, f1, q, dur, peak, g, t, attack = 0.003) {
    const s = ctx.createBufferSource();
    s.buffer = noiseBuf;
    s.start(t, (t * 7) % 1.5);
    const f = filter(ftype, f0, q, s, null);
    if (f1 !== f0) f.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const e = gainNode(0, g);
    envOn(e.gain, t, peak, attack, dur);
    f.connect(e);
    return s;
  }

  function crashAt(x, z, strength) {
    const now = ctx.currentTime;
    if (now - lastCrash < 0.1 || strength < 1.5) return;
    const sp = spatial(x, z, HEARING);
    const s = clamp(strength / 18, 0.1, 1);
    const vg = sp.gain * (0.35 + 0.65 * s);
    if (vg <= 0.01) return;
    lastCrash = now;
    oneShot(0.7, fxBus, vg, sp.pan, (g, t) => [
      tone('sine', 120, 38, 0.35, 1, g, t),
      burst('lowpass', 900 + s * 1500, 200, 0.7, 0.3 + s * 0.3, 0.9, g, t),
      burst('bandpass', 2200, 1200, 1.2, 0.18 + s * 0.2, 0.4 * s, g, t),
    ]);
  }

  function nearPlayer(c) {
    return c && Number.isFinite(c.x) ? c : game.player;
  }

  function onImpact(craft, strength) {
    if (!ctx) return;
    const c = nearPlayer(craft);
    crashAt(c.x, c.z, fin(strength));
  }

  function onCrash(a, b, strength) {
    if (!ctx) return;
    const ca = nearPlayer(a);
    const cb = nearPlayer(b);
    crashAt((ca.x + cb.x) / 2, (ca.z + cb.z) / 2, fin(strength));
  }

  function thunk() {
    if (!ctx) return;
    oneShot(0.25, fxBus, 0.5, 0, (g, t) => [
      tone('sine', 140, 55, 0.14, 1, g, t),
      burst('lowpass', 1200, 300, 0.7, 0.1, 0.6, g, t),
    ]);
  }

  function click() {
    if (!ctx) return;
    oneShot(0.06, fxBus, 0.25, 0, (g, t) => [tone('triangle', 1700, 1300, 0.04, 1, g, t, 0.002)]);
  }

  function reward() {
    if (!ctx) return;
    const notes = [523.25, 659.25, 783.99, 1046.5];
    oneShot(0.7, musicBus, 0.3, 0, (g, t) => {
      const list = [];
      for (let i = 0; i < notes.length; i++) {
        list.push(tone('triangle', notes[i], notes[i], 0.22, 0.7, g, t + i * 0.075, 0.01));
      }
      return list;
    });
  }

  function fail() {
    if (!ctx) return;
    oneShot(0.4, musicBus, 0.3, 0, (g, t) => {
      const lp = filter('lowpass', 500, 0.7, null, g);
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.setValueAtTime(75, t);
      o.frequency.linearRampToValueAtTime(58, t + 0.35);
      const e = gainNode(0, lp);
      envOn(e.gain, t, 1, 0.02, 0.35);
      o.connect(e);
      o.start(t);
      return [o];
    });
  }

  function checkpoint() {
    if (!ctx) return;
    oneShot(0.1, musicBus, 0.2, 0, (g, t) => [tone('sine', 1250, 1250, 0.07, 1, g, t, 0.002)]);
  }

  function splash(a, b) {
    if (!ctx) return;
    let x = fin(game.player.x);
    let z = fin(game.player.z);
    if (a && typeof a === 'object' && Number.isFinite(a.x)) {
      x = a.x;
      z = a.z;
    } else if (Number.isFinite(a) && Number.isFinite(b)) {
      x = a;
      z = b;
    }
    const sp = spatial(x, z, HEARING);
    oneShot(0.6, fxBus, sp.gain * 0.6, sp.pan, (g, t) => [
      burst('lowpass', 3500, 400, 0.6, 0.55, 1, g, t, 0.02),
      burst('bandpass', 1200, 500, 0.8, 0.4, 0.4, g, t, 0.03),
    ]);
  }

  // ---- ambient bed ----
  function buildAmbient() {
    const hum = noiseSrc();
    const humLp = filter('lowpass', 220, 0.7, hum, null);
    const humG = gainNode(0, fxBus);
    humLp.connect(humG);
    const wav = noiseSrc();
    const wavBp = filter('bandpass', 520, 0.5, wav, null);
    const wavG = gainNode(0, fxBus);
    const wavMod = gainNode(0.5, null);
    const wavLfo = osc('sine', 0.13, wavMod);
    wavMod.connect(wavG.gain);
    wavBp.connect(wavG);
    const wnd = noiseSrc();
    const wndBp = filter('bandpass', 900, 0.4, wnd, null);
    const wndG = gainNode(0, fxBus);
    wndBp.connect(wndG);
    return { humG, wavG, wavMod, wndG, wndBp, srcs: [hum, wav, wnd, wavLfo] };
  }

  function updateAmbient(now) {
    const p = game.player;
    const sd = game.city && game.city.shoreDist ? fin(game.city.shoreDist(p.x, p.z)) : 50;
    const land = clamp((sd + 15) / 50, 0, 1);
    const y = fin(p.y);
    const h = p.vehicle && p.mode !== 'foot' ? fin(p.vehicle.y, y) : y;
    amb.humG.gain.setTargetAtTime(0.045 * land, now, 0.5);
    const wv = 0.05 * (1 - land);
    amb.wavG.gain.setTargetAtTime(wv * 0.5, now, 0.5);
    amb.wavMod.gain.setTargetAtTime(wv * 0.5, now, 0.5);
    amb.wndG.gain.setTargetAtTime(0.012 + 0.07 * clamp(h / 90, 0, 1), now, 0.4);
    amb.wndBp.frequency.setTargetAtTime(700 + clamp(h / 90, 0, 1) * 900, now, 0.4);
  }

  // ---- drive-by drones ----
  function buildDrones() {
    const list = [];
    for (let i = 0; i < DRONES; i++) {
      const lp = filter('lowpass', 500, 0.7, null, null);
      const g = gainNode(0, null);
      lp.connect(g);
      const p = panner(fxBus);
      if (p) g.connect(p);
      else g.connect(fxBus);
      const o = osc('sawtooth', 60, lp);
      list.push({ o, lp, g, p });
    }
    return list;
  }

  function updateDrones(now) {
    for (let i = 0; i < DRONES; i++) near[i] = null;
    const vs = game.vehicles || [];
    const pl = game.player;
    const own = pl.vehicle;
    for (let i = 0; i < vs.length; i++) {
      const v = vs[i];
      if (v === own || Math.abs(fin(v.speed)) <= 2) continue;
      const dx = v.x - fin(pl.x);
      const dz = v.z - fin(pl.z);
      const d = Math.sqrt(dx * dx + dz * dz);
      if (d > DRONE_RANGE) continue;
      // Insert into the (sorted) nearest list.
      let k = DRONES;
      while (k > 0 && (near[k - 1] === null || nearD[k - 1] > d)) k--;
      if (k >= DRONES) continue;
      for (let m = DRONES - 1; m > k; m--) {
        near[m] = near[m - 1];
        nearD[m] = nearD[m - 1];
      }
      near[k] = v;
      nearD[k] = d;
    }
    for (let i = 0; i < DRONES; i++) {
      const dr = drones[i];
      const v = near[i];
      if (!v) {
        dr.g.gain.setTargetAtTime(0, now, 0.15);
        continue;
      }
      const sp = spatial(v.x, v.z, DRONE_RANGE);
      const spd = Math.abs(fin(v.speed));
      const k = v.kind === 'boat' ? 0.6 : v.kind === 'plane' || v.kind === 'heli' ? 0.8 : 1;
      dr.o.frequency.setTargetAtTime((38 + spd * 3.2) * k, now, 0.1);
      dr.lp.frequency.setTargetAtTime(260 + spd * 25, now, 0.1);
      dr.g.gain.setTargetAtTime(0.05 * sp.gain * sp.gain, now, 0.1);
      if (dr.p) dr.p.pan.setTargetAtTime(sp.pan, now, 0.1);
    }
  }

  // ---- context life cycle ----
  function applyBus() {
    if (!ctx) return;
    const now = ctx.currentTime;
    master.gain.setTargetAtTime(muted ? 0 : vol.master, now, 0.03);
    engineBus.gain.setTargetAtTime(vol.engine, now, 0.03);
    fxBus.gain.setTargetAtTime(vol.effects, now, 0.03);
    musicBus.gain.setTargetAtTime(vol.music, now, 0.03);
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
    } catch {
      ctx = null;
      return;
    }
    master = gainNode(0, null);
    limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -8;
    limiter.knee.value = 4;
    limiter.ratio.value = 16;
    limiter.attack.value = 0.003;
    limiter.release.value = 0.15;
    // A gentle tanh curve after the compressor guarantees |sample| < 1.
    shaper = ctx.createWaveShaper();
    const curve = new Float32Array(1024);
    for (let i = 0; i < curve.length; i++) curve[i] = Math.tanh(((i / (curve.length - 1)) * 2 - 1) * 1.2) / Math.tanh(1.2) * 0.98;
    shaper.curve = curve;
    master.connect(limiter);
    limiter.connect(shaper);
    shaper.connect(ctx.destination);
    engineBus = gainNode(1, master);
    fxBus = gainNode(1, master);
    musicBus = gainNode(1, master);
    noiseBuf = makeNoise();
    amb = buildAmbient();
    drones = buildDrones();
    applyBus();
    wantRunning = true;
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisibility);
    const p = ctx.resume();
    if (p && p.catch) p.catch(() => {});
    syncRunState();

    const ev = game.events;
    if (ev && !unsubs.length) {
      unsubs.push(
        ev.on('vehicleImpact', onImpact),
        ev.on('vehicleCrash', onCrash),
        ev.on('enter', thunk),
        ev.on('exit', thunk),
        ev.on('ui', click),
        ev.on('reward', reward),
        ev.on('fail', fail),
        ev.on('checkpoint', checkpoint),
        ev.on('splash', splash),
      );
    }
  }

  function render(_alpha, dt) {
    if (!ctx || disposed) return;
    syncRunState();
    if (!wantRunning) return;
    acc += fin(dt, 0.016);
    if (acc < UPDATE_EVERY) return;
    acc = 0;
    const now = ctx.currentTime;
    updateEngine(now);
    updateAmbient(now);
    updateDrones(now);
  }

  function setVolume(v) {
    if (!v) return;
    for (const k of ['master', 'engine', 'effects', 'music']) {
      if (Number.isFinite(v[k])) vol[k] = clamp(v[k], 0, 1);
    }
    applyBus();
  }

  function setMuted(m) {
    muted = !!m;
    applyBus();
  }

  function dispose() {
    disposed = true;
    for (let i = 0; i < unsubs.length; i++) unsubs[i]();
    unsubs.length = 0;
    if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisibility);
    if (ctx) {
      const c = ctx;
      ctx = null;
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
      return voices;
    },
  };
}
