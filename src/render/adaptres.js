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
// - Frames the main thread itself made late (the optional `work`, the
//   frame's JavaScript time before the draw is issued) are not the
//   resolution's fault: drawing fewer pixels would not have saved them, so
//   they count as on budget here (0.13.7: a fast phone with an occasional
//   slow step was walked down to the floor and never came back, a soft
//   picture that stayed laggy). Such a frame needs work of budget * cpuAt
//   or more AND at least cpuShare of the frame: a frame with some
//   JavaScript but mostly a GPU wait is the pixels' (0.13.7 render safety:
//   `work` used to run to the end of the draw calls, so a GPU stall inside
//   them, the bloom copy, counted as JavaScript and a GPU-bound phone
//   never stepped down).
// - The floor is 1.0 by default (one physical pixel per CSS pixel; below
//   that the picture goes soft and stair-stepped, docs/REVAMP.md section
//   2); a dense phone screen passes a higher one (floorFor, at most 1.25,
//   under the Low cap so Low can adapt too). When
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
  stepUp: 0.1, // (0.13.7: was 0.05, a lost level took a minute to come back)
  settle: 0.5, // seconds to wait after any change
  upWait: 5, // seconds of calm before the first probe up (at least minGap)
  upWaitMax: 20, // (0.13.7: was 60, a level lost to a busy spell came back too slowly)
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
  cpuAt: 0.8, // a late frame whose own work took budget * cpuAt or more was the main thread's
  cpuShare: 0.5, // ... and at least this share of the frame (else mostly a GPU wait)
};

export function createAdaptiveRes(opts = {}) {
  const o = { ...DEFAULTS, ...opts };
  const st = {
    scale: 0, avg: o.budget, sinceChange: 0, sinceUp: 1e9, sinceDrop: 0,
    wait: o.firstWait > 0 ? o.firstWait : o.upWait, samples: 0, changes: 0, shed: 0, overFloor: 0, calmFloor: 0,
    sinceScale: 1e9, held: 0, good: 0, cpuFrames: 0,
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
    // Frames counted as the main thread's (late, with work over budget * cpuAt).
    get cpuFrames() { return st.cpuFrames; },
    // One drawn frame of `dt` seconds; `work` (optional, seconds): the
    // frame's own JavaScript time up to issuing its draw (the steps and
    // the systems' updates, never the draw calls, where a GPU-bound phone
    // waits). Returns the scale to use.
    update(dt, work) {
      // Pauses, hidden tabs and loading stalls tell nothing about load.
      if (!(dt > 0) || dt > 0.25) return st.scale;
      // Late because of its own JavaScript (a slow step, a tile build, a
      // collection): the pixels were not the cause.
      if (work >= o.budget * o.cpuAt && work >= dt * o.cpuShare && dt > o.budget * 1.2) {
        st.cpuFrames++;
        dt = o.budget;
      }
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
// (0.75 Low, 1 Normal, 1.25 High), never over the device's own ratio:
// High 2.5, Normal 2.25, Low 1.5 physical pixels per CSS pixel.
// (0.13.7: Normal was 1.6 and Low 1.2. A 3.5 ratio phone such as a
// 1440p flagship then showed each drawn pixel 2.2 times wide (Low: 2.9),
// a soft, smeared picture; about 2.25 is where it looks sharp.)
export const RATIO_CAPS = { low: 1.5, normal: 2.25, high: 2.5 };
export function maxRatioFor(devicePixelRatio, quality = 1) {
  const dpr = devicePixelRatio > 0 ? devicePixelRatio : 1;
  const q = Number.isFinite(quality) ? quality : 1;
  const cap = q >= 1.25 ? RATIO_CAPS.high : q >= 1 ? RATIO_CAPS.normal : RATIO_CAPS.low;
  return Math.round(Math.min(dpr, cap) * 20) / 20;
}

// The lowest pixel ratio the adaptive resolution may use on a screen:
// 1.0 on ordinary screens, more on dense ones (1.25 at a 3 ratio or over),
// where one drawn pixel to a CSS pixel is blown up three times or more and
// the picture turns to mush. Below it the controller sheds detail instead.
// (0.13.7 render safety: it was 1.5 at a 3.5 ratio, the Low cap itself, so
// Low could never step down there.)
export const FLOOR_MAX = 1.25;
export function floorFor(devicePixelRatio) {
  const dpr = devicePixelRatio > 0 ? devicePixelRatio : 1;
  return Math.round(Math.max(1, Math.min(FLOOR_MAX, dpr * 0.43)) * 20) / 20;
}

// Drawing-buffer budget (pixels) by Settings quality: about 2.6 million
// at Normal and Low (the canvas drawing buffer then stays under about
// 60 MB), 3.2 million at High. A phone at
// 915x412 CSS px and 2.25 draws 1.9 million; a tablet or a desktop window
// would otherwise ask for 5 to 10 million.
export const PIXEL_BUDGET = { normal: 2.6e6, high: 3.2e6 };
export function pixelBudgetFor(quality = 1) {
  return Number.isFinite(quality) && quality >= 1.25 ? PIXEL_BUDGET.high : PIXEL_BUDGET.normal;
}

// The GPU's own size limits, read once from a WebGL context (any object
// with getParameter and the constants); missing or odd values read as
// "no limit" (Infinity), so a test or a broken driver never blocks a draw.
export function contextLimits(gl) {
  const lim = { renderbuffer: Infinity, viewportW: Infinity, viewportH: Infinity, texture: Infinity };
  if (!gl || typeof gl.getParameter !== 'function') return lim;
  const num = (v) => (Number.isFinite(v) && v > 0 ? v : Infinity);
  try {
    lim.renderbuffer = num(gl.getParameter(gl.MAX_RENDERBUFFER_SIZE));
    lim.texture = num(gl.getParameter(gl.MAX_TEXTURE_SIZE));
    const vp = gl.getParameter(gl.MAX_VIEWPORT_DIMS);
    if (vp && vp.length >= 2) {
      lim.viewportW = num(vp[0]);
      lim.viewportH = num(vp[1]);
    }
  } catch {
    /* a lost context answers nothing: no limit known */
  }
  return lim;
}

// Highest pixel ratio a canvas of w x h CSS px may draw at: the drawing
// buffer (w * ratio by h * ratio) within the renderbuffer, viewport and
// texture sizes (bloom copies the frame into a texture of that size) and
// within `budget` pixels. Rounded down to a 0.05 step, at least 0.25.
export function sizeCapFor(w, h, limits, budget = PIXEL_BUDGET.normal) {
  if (!(w > 0 && h > 0)) return Infinity;
  const l = limits || {};
  const side = Math.min(l.renderbuffer || Infinity, l.texture || Infinity);
  let r = Math.sqrt(budget / (w * h));
  r = Math.min(r, side / w, side / h, (l.viewportW || Infinity) / w, (l.viewportH || Infinity) / h);
  return Math.max(0.25, Math.floor(r * 20 + 1e-9) / 20);
}

// The WebGL context lost and restored events of a canvas (any object
// with addEventListener). A lost context is claimed (preventDefault, so
// the browser may restore it) and onLost runs; onRestored runs when it
// comes back. Returns { lost, losses, restores, detach }.
export function watchContext(canvas, { onLost = null, onRestored = null } = {}) {
  const st = { lost: false, losses: 0, restores: 0, detach: () => {} };
  if (!canvas || typeof canvas.addEventListener !== 'function') return st;
  const lost = (e) => {
    if (e && typeof e.preventDefault === 'function') e.preventDefault();
    st.lost = true;
    st.losses++;
    if (onLost) onLost(e);
  };
  const restored = (e) => {
    st.lost = false;
    st.restores++;
    if (onRestored) onRestored(e);
  };
  canvas.addEventListener('webglcontextlost', lost, false);
  canvas.addEventListener('webglcontextrestored', restored, false);
  st.detach = () => {
    if (typeof canvas.removeEventListener !== 'function') return;
    canvas.removeEventListener('webglcontextlost', lost, false);
    canvas.removeEventListener('webglcontextrestored', restored, false);
  };
  return st;
}

// Multisampling (MSAA) on every device: the drawing pixel ratio runs
// from the 1.0 floor to at most 2.5 (maxRatioFor), where 4x MSAA is what
// smooths the edges, and on the phone's tile-based GPU the extra samples
// stay in on-chip tile memory (resolved once per frame), so the cost is
// small next to raising the resolution. Decided once when the context
// is made; the argument is kept for the caller.
export function wantsAntialias(devicePixelRatio) {
  void devicePixelRatio;
  return true;
}
