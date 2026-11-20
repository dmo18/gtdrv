// Plays the car radio stations through Web Audio (docs/AUDIO.md, "Radio").
// The composers (audio/radio.js, audio/music.js) write one bar at a time;
// this schedules each bar's notes a little ahead of the audio clock, like
// the background music does. Every tuned-in station has its own gain bus
// under the music bus; switching fades the old bus out and the new one in
// over FADE seconds with gain ramps (no click, no pop) and the old bus is
// disconnected once it is silent. Only the station on air is scheduled, so
// the cost is one bar of notes every couple of seconds.
// Nothing here runs unless a station is chosen, and nothing throws.
import { createRng } from '../core/rng.js';
import { sanitizeStation } from '../core/radio.js';
import { createStation } from './radio.js';

export const FADE = 0.6; // seconds of crossfade between stations
const AHEAD = 0.5; // schedule the next bar when it is this close
const CAP_RING = 8;

// How each instrument name maps to a bank buffer. p: pitched (playbackRate
// from the semitone offset), w: fold the pitch into one octave (bass),
// l: level, pan: alternate left and right a little.
export const INST = {
  pad: { b: 'm:pad', p: 1, w: 1, l: 0.16 },
  bass: { b: 'm:bass', p: 1, w: 1, l: 0.55 },
  pluck: { b: 'm:pluck', p: 1, l: 0.2, pan: 1 },
  kick: { b: 'm:kick', l: 0.6 },
  snare: { b: 'm:snare', l: 0.32 },
  hat: { b: 'm:hat', l: 0.18, pan: 1 },
  stab: { b: 'r:stab', p: 1, l: 0.2, pan: 1 },
  sub: { b: 'r:sub', p: 1, w: 1, l: 0.6 },
  clap: { b: 'r:clap', l: 0.34, pan: 1 },
  keys: { b: 'r:keys', p: 1, l: 0.24, pan: 1 },
  dbass: { b: 'r:dbass', p: 1, w: 1, l: 0.62 },
  brush: { b: 'r:brush', l: 0.3, pan: 1 },
  ride: { b: 'r:ride', l: 0.2, pan: 1 },
  feather: { b: 'r:feather', l: 0.5 },
  vocA: { b: 'r:vocA', p: 1, l: 0.5 },
  vocE: { b: 'r:vocE', p: 1, l: 0.5 },
  vocO: { b: 'r:vocO', p: 1, l: 0.5 },
  vocI: { b: 'r:vocI', p: 1, l: 0.5 },
};
export const RADIO_BUFFERS = ['m:kick', 'r:stab', 'r:sub', 'r:clap', 'r:keys', 'r:dbass', 'r:brush', 'r:ride', 'r:feather', 'r:vocA', 'r:vocE', 'r:vocO', 'r:vocI'];

// Level of each station against the others (set from measurements).
export const STATION_TRIM = { chill: 1, dance: 1.45, jazz: 1.25, talk: 2.3 };

// Schedule one bar of notes. st: { bus, panL, panR, flip }. Used by the
// background music (audio.js) and by every station. Captions go to
// onCap(text, dur, atTime). Returns the number of sources started.
export function scheduleBar(ctx, getBuf, notes, t0, barS, st, onCap, trim = 1) {
  let n = 0;
  for (let i = 0; i < notes.length; i++) {
    const nt = notes[i];
    const at = t0 + (nt.beat * barS) / 4;
    if (nt.inst === 'cap') {
      if (onCap) onCap(nt.text, nt.dur, at);
      continue;
    }
    const def = INST[nt.inst];
    const b = def ? getBuf(def.b) : null;
    if (!b) continue;
    let semi = nt.semi;
    if (def.w) semi = ((((semi + 5) % 12) + 12) % 12) - 5;
    const src = ctx.createBufferSource();
    src.buffer = b;
    if (def.p) src.playbackRate.value = Math.pow(2, semi / 12);
    const g = ctx.createGain();
    g.gain.value = nt.vel * def.l * trim;
    src.connect(g);
    let dest = st.bus;
    if (def.pan) {
      st.flip = !st.flip;
      dest = st.flip ? st.panL : st.panR;
    }
    g.connect(dest);
    src.onended = () => g.disconnect();
    src.start(at);
    n++;
  }
  return n;
}

// o: { ctx, out (music bus), bg (gain of the background music), getBuf,
//      seed, caption(text|null, dur), now() -> ms for stats }
export function createRadioPlayer(o) {
  const { ctx, out, bg, getBuf } = o;
  const nowMs = o.nowMs || (() => 0);
  let want = 'off';
  let cur = null; // { id, bus, panL, panR, comp, bar, nextT, flip, trim }
  const retiring = [];
  let ready = false;
  // captions waiting for their time on the audio clock
  const capT = new Float64Array(CAP_RING);
  const capDur = new Float64Array(CAP_RING);
  const capText = new Array(CAP_RING).fill('');
  let capHead = 0;
  let capN = 0;
  const stats = { bars: 0, ms: 0, maxMs: 0, notes: 0, maxNotes: 0, tunes: 0 };

  const panner = (dest, v) => {
    if (!ctx.createStereoPanner) return dest;
    const p = ctx.createStereoPanner();
    p.pan.value = v;
    p.connect(dest);
    return p;
  };
  function ramp(param, to, now, secs) {
    try {
      if (param.cancelAndHoldAtTime) param.cancelAndHoldAtTime(now);
      else {
        const v = param.value;
        param.cancelScheduledValues(now);
        param.setValueAtTime(v, now);
      }
      param.linearRampToValueAtTime(to, now + secs);
    } catch {
      param.value = to;
    }
  }
  function onCap(text, dur, at) {
    if (capN >= CAP_RING) return;
    const i = (capHead + capN) % CAP_RING;
    capT[i] = at;
    capDur[i] = dur;
    capText[i] = text;
    capN++;
  }
  function clearCaps() {
    capN = 0;
    capHead = 0;
  }

  function tune(id, now) {
    // the old station fades out on its own bus; the bus is dropped later
    if (cur) {
      ramp(cur.bus.gain, 0, now, FADE);
      retiring.push({ bus: cur.bus, killAt: now + FADE + 0.25 });
      cur = null;
    }
    clearCaps();
    if (o.caption) o.caption(null, 0);
    stats.tunes++;
    if (id === 'off') {
      ramp(bg.gain, 1, now, FADE);
      return;
    }
    ramp(bg.gain, 0, now, FADE);
    const bus = ctx.createGain();
    bus.gain.value = 0;
    bus.connect(out);
    ramp(bus.gain, 1, now, FADE);
    // every tune-in starts the station from its beginning, from its own seed
    const rng = createRng((((o.seed >>> 0) ^ (id.charCodeAt(0) * 2654435761)) >>> 0) + id.length * 7);
    cur = {
      id, bus, panL: panner(bus, -0.35), panR: panner(bus, 0.35), comp: createStation(id, rng),
      bar: 0, nextT: 0, flip: false, trim: STATION_TRIM[id] || 1,
    };
  }

  // Called every render. listen: the player is in a car or boat.
  // play: music is audible at all (on, volume up, not muted).
  function tick(now, listen, play) {
    if (!ready) {
      let ok = true;
      for (let i = 0; i < RADIO_BUFFERS.length && ok; i++) ok = !!getBuf(RADIO_BUFFERS[i]);
      ready = ok;
    }
    const eff = listen && ready ? want : 'off';
    if ((cur ? cur.id : 'off') !== eff) tune(eff, now);
    for (let i = retiring.length - 1; i >= 0; i--) {
      if (now > retiring[i].killAt) {
        try { retiring[i].bus.disconnect(); } catch { /* already gone */ }
        retiring.splice(i, 1);
      }
    }
    // captions whose time has come
    while (capN > 0 && capT[capHead] <= now) {
      if (o.caption && cur) o.caption(capText[capHead], capDur[capHead]);
      capHead = (capHead + 1) % CAP_RING;
      capN--;
    }
    if (!cur) return;
    if (!play) {
      cur.nextT = 0;
      clearCaps();
      return;
    }
    const barS = 240 / cur.comp.tempo;
    if (cur.nextT < now + 0.05) cur.nextT = now + 0.15;
    if (cur.nextT < now + AHEAD) {
      const t0 = nowMs();
      const notes = cur.comp.bar(cur.bar++);
      const n = scheduleBar(ctx, getBuf, notes, cur.nextT, barS, cur, onCap, cur.trim);
      cur.nextT += barS;
      const ms = nowMs() - t0;
      stats.bars++;
      stats.ms += ms;
      stats.notes += n;
      if (ms > stats.maxMs) stats.maxMs = ms;
      if (n > stats.maxNotes) stats.maxNotes = n;
    }
  }

  return {
    setStation(id) { want = sanitizeStation(id); },
    tick,
    get want() { return want; },
    get station() { return cur ? cur.id : 'off'; },
    get onAir() { return !!cur; },
    get stats() { return stats; },
    get buses() { return (cur ? 1 : 0) + retiring.length; },
    get ready() { return ready; },
    get currentBus() { return cur ? cur.bus : null; },
  };
}
