// The first-run benchmark (PLAN_V2 5.3 ST1): for about 3 s behind the title
// the frame times are collected and one graphics quality is picked, only when
// the player has never chosen one. Pure logic: main.js feeds frame times in
// milliseconds (measured by the browser); nothing here reads a clock.
//
//   const bench = createQualityBench();
//   if (bench.push(frameMs)) { const q = bench.result(); ... }

export const BENCH_MS = 3000; // length of the run
export const WARMUP_MS = 500; // shader compiles and the first draws are not counted
export const MIN_FRAMES = 60; // fewer counted frames than this: no verdict, except sustained slowness
export const MIN_SLOW_FRAMES = 20; // a slow device gets fewer frames in 3 s (50 ms: 50, 100 ms: 25)
const MAX_FRAMES = 1024;
const STALL_MS = 250; // a frame this long was a hidden page or a pause, not the load

// Quality values as stored in settings (core/save.js QUALITIES).
export const LOW = 0.75, NORMAL = 1, HIGH = 1.25;

// The setting has never been chosen: neither by the player (the menu sets
// qualityChosen), nor by an earlier benchmark, nor by any move away from Normal.
// A benchmark that moved away from Normal (and the player never chose) is
// measured again at each start (0.13.7): a run spoiled by the start-up work
// (shader compiles, the map raster) left a fast phone on Low, drawn soft.
export function neverChosen(settings) {
  if (!settings || typeof settings !== 'object') return false;
  if (settings.qualityChosen === true) return false;
  if (settings.qualityBenchmarked === true) return settings.quality === LOW || settings.quality === HIGH;
  return settings.quality === undefined || settings.quality === NORMAL;
}

// median and 95th percentile (ms) to a quality. A phone holding 60 fps keeps
// full resolution (Normal); only a phone clearly short of it drops to Low,
// and only a display that is far ahead of 60 fps is offered High.
export function pickQuality(medianMs, p95Ms) {
  if (!(medianMs > 0) || !(p95Ms > 0)) return NORMAL;
  if (medianMs > 24 || p95Ms > 45) return LOW;
  if (medianMs < 9.5 && p95Ms < 13) return HIGH;
  return NORMAL;
}

export function createQualityBench() {
  const frames = new Float32Array(MAX_FRAMES);
  const sorted = new Float32Array(MAX_FRAMES);
  let n = 0, elapsed = 0, done = false;
  return {
    // One frame time; returns true once the run is over.
    push(ms) {
      if (done) return true;
      if (!(ms > 0) || !Number.isFinite(ms)) return false;
      if (ms > STALL_MS) {
        elapsed += ms; // the clock moves on, the sample is dropped
      } else {
        elapsed += ms;
        if (elapsed > WARMUP_MS && n < MAX_FRAMES) frames[n++] = ms;
      }
      if (elapsed >= BENCH_MS) done = true;
      return done;
    },
    get done() { return done; },
    get frames() { return n; },
    // { quality, median, p95, frames } or null (too few frames to say).
    result() {
      if (n < MIN_SLOW_FRAMES) return null;
      for (let i = 0; i < n; i++) sorted[i] = frames[i];
      const view = sorted.subarray(0, n).sort();
      const median = view[Math.floor(n / 2)];
      const p95 = view[Math.min(n - 1, Math.floor(n * 0.95))];
      // 20 to 59 frames: only a sustained slow run (median over 24 ms; stalls
      // were already dropped) gives a verdict.
      if (n < MIN_FRAMES && !(median > 24)) return null;
      return { quality: pickQuality(median, p95), median, p95, frames: n };
    },
  };
}
