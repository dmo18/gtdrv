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
// - After every change it lets a few frames settle before judging again.
// All times are sums of the dt values given, never wall-clock reads.

export const BUDGET = 1 / 60;

export const DEFAULTS = {
  min: 0.6, // lowest pixel ratio it will go to
  max: 2, // highest (the device and quality cap, see maxRatioFor)
  start: 1.5, // first guess, clamped to [min, max]
  budget: BUDGET,
  downAt: 1.11, // smoothed frame time over budget * downAt: step down
  upAt: 1.045, // smoothed frame time under budget * upAt: may step up
  stepDown: 0.1,
  stepUp: 0.05,
  settle: 0.5, // seconds to wait after any change
  upWait: 3, // seconds of calm before the first probe up
  upWaitMax: 60,
  probeFail: 2.5, // a drop this soon after a probe counts against it
  calm: 30, // seconds without a drop that halve the probe wait
  smooth: 0.05, // weight of each new sample in the average
  roomAt: 0.8, // under budget * roomAt (a fast screen with room): bigger, quicker steps up
};

export function createAdaptiveRes(opts = {}) {
  const o = { ...DEFAULTS, ...opts };
  const st = {
    scale: 0, avg: o.budget, sinceChange: 0, sinceUp: 1e9, sinceDrop: 0,
    wait: o.upWait, samples: 0, changes: 0,
  };
  const q = (x) => Math.round(x * 20) / 20; // keep to steps of 0.05
  const clampS = (x) => Math.min(o.max, Math.max(Math.min(o.min, o.max), x));
  st.scale = clampS(q(o.start));

  function set(x) {
    const n = clampS(q(x));
    if (n === st.scale) return false;
    st.scale = n;
    st.sinceChange = 0;
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
      st.sinceUp += dt;
      st.sinceDrop += dt;
      const sample = Math.min(dt, o.budget * 2);
      st.avg += (sample - st.avg) * o.smooth;
      st.samples++;
      if (st.sinceDrop > o.calm && st.wait > o.upWait) {
        st.wait = Math.max(o.upWait, st.wait / 2);
        st.sinceDrop = 0;
      }
      if (st.sinceChange < o.settle || st.samples < 12) return st.scale;
      if (st.avg > o.budget * o.downAt && st.scale > Math.min(o.min, o.max)) {
        const far = st.avg > o.budget * 1.5;
        if (st.sinceUp < o.probeFail) st.wait = Math.min(o.upWaitMax, st.wait * 2);
        st.sinceDrop = 0;
        set(st.scale - (far ? o.stepDown * 2 : o.stepDown));
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

// Multisampling is cheap at low pixel ratios and wasted above 1.5, where
// the pixels are already small; decided once when the context is made.
export function wantsAntialias(devicePixelRatio) {
  const dpr = devicePixelRatio > 0 ? devicePixelRatio : 1;
  return Math.min(dpr, 2) <= 1.5;
}
