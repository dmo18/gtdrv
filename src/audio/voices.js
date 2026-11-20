// Pooled one-shot voices. A voice is a gain + stereo pan slot that plays
// one or more bank buffers (layers of one sound event); at most 8 run at
// once and each frees itself when its last layer ends. Two lighter paths
// share the same idea without counting as voices: `raw` for engine pops
// and `spot` for distant ambient calls (gulls, clanks, far horns).

const MAX_VOICES = 8;
const MAX_RAW = 6;
const MAX_SPOTS = 4;

export function createVoices(ctx, getBuffers, rng, spotBus) {
  const slots = [];
  let count = 0;
  let raws = 0;
  let spots = 0;

  for (let i = 0; i < MAX_VOICES; i++) {
    const g = ctx.createGain();
    let p = null;
    if (ctx.createStereoPanner) {
      p = ctx.createStereoPanner();
      g.connect(p);
    }
    slots.push({ g, p, busy: false, endT: 0, nodes: [], bus: null });
  }

  function free(slot) {
    if (!slot.busy) return;
    slot.busy = false;
    count--;
    for (let i = 0; i < slot.nodes.length; i++) {
      try {
        slot.nodes[i].disconnect();
      } catch {
        /* already gone */
      }
    }
    slot.nodes.length = 0;
  }

  // build(v, t) calls v.add(name, when, gain, rate, bands?) per layer;
  // bands = [[freq, q, gain], ...] routes that layer through band-passes.
  function play(bus, gain, pan, build) {
    if (count >= MAX_VOICES || !(gain > 0.001)) return false;
    const buffers = getBuffers();
    if (!buffers) return false;
    const slot = slots.find((s) => !s.busy);
    if (!slot) return false;
    const t = ctx.currentTime;
    slot.g.gain.cancelScheduledValues(t);
    slot.g.gain.setValueAtTime(gain, t);
    const out = slot.p || slot.g;
    if (slot.bus !== bus) {
      try {
        out.disconnect();
      } catch {
        /* not connected yet */
      }
      out.connect(bus);
      slot.bus = bus;
    }
    if (slot.p) slot.p.pan.setValueAtTime(Number.isFinite(pan) ? pan : 0, t);
    let last = null;
    let lastEnd = 0;
    const v = {
      add(name, when, g, rate = 1, bands = null) {
        const b = buffers[name];
        if (!b) return;
        const s = ctx.createBufferSource();
        s.buffer = b;
        s.playbackRate.value = rate;
        const gn = ctx.createGain();
        gn.gain.value = g;
        gn.connect(slot.g);
        slot.nodes.push(s, gn);
        if (bands) {
          const dry = ctx.createGain();
          dry.gain.value = 0.35;
          s.connect(dry);
          dry.connect(gn);
          slot.nodes.push(dry);
          for (const [f, q, bg] of bands) {
            const bp = ctx.createBiquadFilter();
            bp.type = 'bandpass';
            bp.frequency.value = f;
            bp.Q.value = q;
            const bgn = ctx.createGain();
            bgn.gain.value = bg;
            s.connect(bp);
            bp.connect(bgn);
            bgn.connect(gn);
            slot.nodes.push(bp, bgn);
          }
        } else {
          s.connect(gn);
        }
        s.start(when);
        const end = when + b.duration / rate;
        if (end > lastEnd) {
          lastEnd = end;
          last = s;
        }
      },
    };
    build(v, t);
    if (!last) {
      for (const n of slot.nodes) n.disconnect();
      slot.nodes.length = 0;
      return false;
    }
    slot.busy = true;
    slot.endT = lastEnd;
    count++;
    last.onended = () => free(slot);
    return true;
  }

  function raw(name, dest, gain, rate = 1) {
    const buffers = getBuffers();
    const b = buffers && buffers[name];
    if (!b || raws >= MAX_RAW) return;
    const s = ctx.createBufferSource();
    s.buffer = b;
    s.playbackRate.value = rate;
    const g = ctx.createGain();
    g.gain.value = gain;
    s.connect(g);
    g.connect(dest);
    raws++;
    s.onended = () => {
      raws--;
      g.disconnect();
    };
    s.start();
  }

  // Ambient spot: optional low-pass (lp Hz) and, for loop buffers such as
  // horns, a duration in seconds.
  function spot(name, gain, pan, rate = 1, lp = 0, dur = 0) {
    const buffers = getBuffers();
    const b = buffers && buffers[name];
    if (!b || spots >= MAX_SPOTS || !(gain > 0.001)) return;
    const t = ctx.currentTime;
    const s = ctx.createBufferSource();
    s.buffer = b;
    s.playbackRate.value = rate;
    const g = ctx.createGain();
    let head = g;
    let f = null;
    if (lp > 0) {
      f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = lp;
      f.connect(g);
      head = f;
    }
    s.connect(head);
    let p = null;
    if (ctx.createStereoPanner) {
      p = ctx.createStereoPanner();
      p.pan.value = Number.isFinite(pan) ? pan : 0;
      g.connect(p);
      p.connect(spotBus);
    } else {
      g.connect(spotBus);
    }
    if (dur > 0) {
      s.loop = true;
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(gain, t + 0.02);
      g.gain.setValueAtTime(gain, t + dur);
      g.gain.linearRampToValueAtTime(0, t + dur + 0.05);
      s.start(t, rng.next() * b.duration);
      s.stop(t + dur + 0.08);
    } else {
      g.gain.value = gain;
      s.start(t);
    }
    spots++;
    s.onended = () => {
      spots--;
      g.disconnect();
      if (f) f.disconnect();
      if (p) p.disconnect();
    };
  }

  // Safety net: free voices whose end time passed long ago.
  function tick(now) {
    for (let i = 0; i < slots.length; i++) {
      const s = slots[i];
      if (s.busy && now > s.endT + 1) free(s);
    }
  }

  return {
    play,
    raw,
    spot,
    tick,
    get count() {
      return count;
    },
  };
}
