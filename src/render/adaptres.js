// Adaptive render resolution: a pure controller (no three.js, no DOM, no
// clock). Feed it the real frame time `dt` (seconds) the loop measured for
// each drawn frame; it answers with the pixel ratio to draw at.
//
// How it decides:
// - A smoothed frame time (exponential average, single spikes clipped so
//   one garbage-collection pause does not drop the resolution).
// - Over budget (slower than about 54 fps): step down at once, bigger
//   steps when far over.
// - At budget (vsync-locked 60 fps, or faster on a 120 Hz screen): after
//   a calm wait, probe one small step up. If that probe soon has to be
//   undone, the wait before the next probe doubles (up to a minute of
//   play), so a level the device cannot hold is not retried every few
//   seconds. Long calm spells halve the wait again. Frames well under
//   budget (a 120 Hz screen with room to spare) climb faster.
// - After every change it lets a few frames settle before judging again,
//   and the resolution changes at most once in `minGap` seconds (each
//   change resizes every render target, a hitch of its own).
// - `good` is the highest level that held its budget for `goodAfter`
//   seconds: the caller keeps it and passes it back as `start` next time,
//   so a phone that holds 60 starts (and stays) at its full resolution
//   and one that cannot starts where it settled, without probing again.
// - The floor is 1.0 (one physical pixel per CSS pixel; below that the
//   picture goes soft and stair-stepped, docs/REVAMP.md section 2). When
//   the floor is reached and frames are still over budget for `shedAfter`
//   seconds, `shed` goes up by one (at most 2): the caller then drops
//   detail instead (graphics.js: smaller shadow map, lower draw tier).
//   It comes down one step after `shedCalm` seconds well under budget.
// All times are sums of the dt values given, never wall-clock reads.

export const BUDGET = 1 / 60;

export const DEFAULTS = {
  min: 1, // lowest pixel ratio it will go to (edge smoothing needs 1)
  max: 2, // highest (the device and quality cap, see maxRatioFor)
  start: 1.5, // first guess, clamped to [min, max]
  budget: BUDGET,
  downAt: 1.11, // smoothed frame time over budget * downAt: step down
  upAt: 1.045, // smoothed frame time under budget * upAt: may step up
  stepDown: 0.1,
  stepUp: 0.05,
  settle: 0.5, // seconds to wait after any change
  upWait: 5, // seconds of calm before the first probe up (at least minGap)
  upWaitMax: 60,
  probeFail: 2.5, // a drop this soon after a probe may first change (minGap) counts against it
  calm: 30, // seconds without a drop that halve the probe wait
  smooth: 0.05, // weight of each new sample in the average
  roomAt: 0.8, // under budget * roomAt (a fast screen with room): bigger, quicker steps up
  shedAfter: 2, // seconds over budget at the floor before shedding detail
  shedCalm: 12, // seconds under budget * roomAt before taking one step back
  shedMax: 2,
  minGap: 5, // seconds at least between two resolution changes
  goodAfter: 10, // seconds a level must hold to count as good
  firstWait: 0, // probe wait to begin with (0: upWait); longer when start is a level known good
};

export function createAdaptiveRes(opts = {}) {
  const o = { ...DEFAULTS, ...opts };
  const st = {
    scale: 0, avg: o.budget, sinceChange: 0, sinceUp: 1e9, sinceDrop: 0,
    wait: o.firstWait > 0 ? Math.min(o.upWaitMax, o.firstWait) : o.upWait, samples: 0, changes: 0, shed: 0, overFloor: 0, calmFloor: 0,
    sinceScale: 1e9, held: 0, good: 0,
  };
  const q = (x) => Math.round(x * 20) / 20; // keep to steps of 0.05
  const clampS = (x) => Math.min(o.max, Math.max(Math.min(o.min, o.max), x));
  st.scale = clampS(q(o.start));

  function set(x) {
    const n = clampS(q(x));
    if (n === st.scale) return false;
    st.scale = n;
    st.sinceChange = 0;
    st.sinceScale = 0;
    st.held = 0;
    st.changes++;
    // Judge the new level on fresh samples.
    st.avg = o.budget;
    st.samples = 0;
    return true;
  }

  return {
    get scale() { return st.scale; },
    get average() { return st.avg; },
    get probeWait() { return st.wait; },
    get changes() { return st.changes; },
    // Detail to shed (0 none, 1, 2): set while the floor cannot hold.
    get shed() { return st.shed; },
    // Highest level that held for goodAfter seconds (0: none yet).
    get good() { return st.good; },
    get max() { return o.max; },
    // New upper bound (device or quality setting changed).
    setMax(max) {
      o.max = Math.max(0.25, max);
      const n = clampS(st.scale);
      if (n !== st.scale) set(n);
      return st.scale;
    },
    // One drawn frame of `dt` seconds. Returns the scale to use.
    update(dt) {
      // Pauses, hidden tabs and loading stalls tell nothing about load.
      if (!(dt > 0) || dt > 0.25) return st.scale;
      st.sinceChange += dt;
      st.sinceScale += dt;
      st.sinceUp += dt;
      st.sinceDrop += dt;
      const sample = Math.min(dt, o.budget * 2);
      st.avg += (sample - st.avg) * o.smooth;
      st.samples++;
      // A level that holds its budget for a while (nothing shed) is good.
      if (st.shed === 0 && st.avg <= o.budget * o.downAt) {
        st.held += dt;
        if (st.held >= o.goodAfter && st.scale !== st.good) st.good = st.scale;
      } else st.held = 0;
      if (st.sinceDrop > o.calm && st.wait > o.upWait) {
        st.wait = Math.max(o.upWait, st.wait / 2);
        st.sinceDrop = 0;
      }
      if (st.sinceChange < o.settle || st.samples < 12) return st.scale;
      const floor = Math.min(o.min, o.max);
      if (st.scale <= floor) {
        // At the floor: shed detail when it cannot hold, give it back
        // after a long calm spell.
        if (st.avg > o.budget * o.downAt) {
          st.overFloor += dt;
          st.calmFloor = 0;
          if (st.overFloor >= o.shedAfter && st.shed < o.shedMax) {
            st.shed++;
            st.overFloor = 0;
            st.sinceChange = 0;
            st.avg = o.budget;
            st.samples = 0;
            st.changes++;
            return st.scale;
          }
        } else {
          st.overFloor = 0;
          st.calmFloor = st.avg < o.budget * o.roomAt ? st.calmFloor + dt : 0;
          if (st.shed > 0 && st.calmFloor >= o.shedCalm) {
            st.shed--;
            st.calmFloor = 0;
            st.sinceChange = 0;
            st.avg = o.budget;
            st.samples = 0;
            st.changes++;
            return st.scale;
          }
        }
        // Resolution goes up again only with all detail back.
        if (st.shed > 0) return st.scale;
      }
      if (st.sinceScale < o.minGap) return st.scale;
      if (st.avg > o.budget * o.downAt && st.scale > floor) {
        const far = st.avg > o.budget * 1.5;
        if (st.sinceUp < o.minGap + o.probeFail) st.wait = Math.min(o.upWaitMax, st.wait * 2);
        st.sinceDrop = 0;
        set(st.scale - (far ? o.stepDown * 2 : o.stepDown));
        // The level it had to leave is not good any more.
        if (st.good > st.scale) st.good = st.scale;
      } else if (st.avg < o.budget * o.roomAt && st.sinceChange >= o.settle * 2 && st.scale < o.max) {
        // Clear headroom (frames well under budget): climb faster.
        if (set(st.scale + o.stepDown)) st.sinceUp = 0;
      } else if (st.avg < o.budget * o.upAt && st.sinceChange >= st.wait && st.scale < o.max) {
        if (set(st.scale + o.stepUp)) st.sinceUp = 0;
      }
      return st.scale;
    },
  };
}

// Highest pixel ratio for a device and the Settings quality option
// (0.75 Low, 1 Normal, 1.25 High). Phones get at most 2 physical pixels
// per CSS pixel; High allows the full 2, Normal 1.6, Low 1.2.
export function maxRatioFor(devicePixelRatio, quality = 1) {
  const dpr = devicePixelRatio > 0 ? devicePixelRatio : 1;
  const q = Number.isFinite(quality) ? quality : 1;
  const cap = 2 * Math.min(1, Math.max(0.5, q / 1.25));
  return Math.round(Math.min(dpr, cap) * 20) / 20;
}

// Multisampling (MSAA) on every device: the drawing pixel ratio runs
// from the 1.0 floor to at most 2 (maxRatioFor), where 4x MSAA is what
// smooths the edges, and on the phone's tile-based GPU the extra samples
// stay in on-chip tile memory (resolved once per frame), so the cost is
// small next to raising the resolution. Decided once when the context
// is made; the argument is kept for the caller.
export function wantsAntialias(devicePixelRatio) {
  void devicePixelRatio;
  return true;
}
