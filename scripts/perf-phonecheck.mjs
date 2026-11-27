// The Phone check drive (src/ui/phonecheck.js), headless, at 4x CPU throttle: the gate-able
// stand-in for the owner's phone run (docs/PERF.md, "Phone check drive").
// Builds the game, opens it in headless Chromium at phone size with the Chrome DevTools
// Protocol CPU throttle, plays the first seconds of play, then starts the Phone check from
// Settings, Display the way a tap does and plays its 60 second drive frame by frame: one
// fixed step and one draw a frame, as the phone runs it at 60 Hz. Only main-thread time is
// measured (the steps, the draw's own JavaScript, its WebGL state, uniform, buffer and texture
// calls and any shader compile it waits for): the software renderer's vertex and raster work
// is not the phone's, so the draw calls themselves are left out (--gpu keeps them). The drive
// is deterministic (seeded, fixed steps), so it is played several times and each frame takes
// its fastest pass: that removes what other work on the machine adds.
// Reports the frames over the calibrated threshold (the phone's frames over 33 ms), the
// worst frame, every slow frame with its cause (the system that cost most, tile streaming,
// new shader programs, geometries or textures, the top functions of a CPU profile with
// --profile), the lowest adaptive resolution those frames lead to (render/adaptres.js fed
// the frame times), the start time and the memory after a forced collection.
// usage: node scripts/perf-phonecheck.mjs [--check] [--profile] [--passes 3] [--rate 4]
//          [--map miami-downtown] [--no-heat] [--seconds 60] [--settle 10] [--quality 1.25]
//          [--root dir] [--out shots/perf-phonecheck.json] [--quiet] [--all] [--gpu]
//   --check    exit 1 when a pinned limit below is missed (not wired into the gate yet)
//   --profile  an unminified build under the CPU profiler: names the functions of each slow frame
//   --alloc    a sampled heap profile of the drive: the top allocating functions
//   --alloc-raw file  with --alloc: also write the raw sampled profile (open it in DevTools)
//   --root     another source tree to build and measure (an older version in a scratch copy)
//   --no-heat  do not hold the wanted level at five stars (the plain drive)
import { createRequire } from 'node:module';
import { writeFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const LAUNCH_ARGS = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-precise-memory-info'];

// Pinned limits of the gate (4x throttle; the calibration is in docs/PERF.md, "Phone check drive").
// This container at 4x is slower than the owner's phone, so a frame is not judged by its own
// time but by its excess over the running level (a slow average of the frames that are not
// hitches). OVER_MS of excess is what cost the phone one refresh (a frame over 33 ms there):
// calibrated on the two versions the owner measured (0.7.0: 4 frames, 0.10.0: 20 frames).
export const LIMITS = {
  overMs: 28, // main-thread ms above the running level: one lost refresh on the phone
  maxOver: 4, // frames over in the drive (the owner's target: at most 4 frames over 33 ms)
  maxWorstPhoneMs: 50, // worst frame in phone terms: 16.7 * (1 + excess / overMs)
  maxNewPrograms: 0, // shader programs compiled during the drive
  maxPrograms: 60, // shader programs in all at the end of the drive (docs/PERF.md programs_start), any --map
};
const REFRESH = 1000 / 60;

// Pure: the statistics of a list of frame times in ms (main thread, one step and one draw each).
// excess[i] is the frame's time above the running level; over counts excess > overMs.
export function driveStats(ms, overMs = LIMITS.overMs) {
  const n = ms.length;
  const excess = new Float64Array(n);
  if (!n) return { frames: 0, median: 0, p99: 0, worst: 0, over: 0, half: 0, worstExcess: 0, phoneWorst: 0, excess };
  let level = ms[0], over = 0, half = 0, worstExcess = 0;
  for (let i = 0; i < n; i++) {
    const e = ms[i] - level;
    excess[i] = e;
    if (e > overMs) over++;
    else level += (ms[i] - level) * 0.05;
    if (e > overMs / 2) half++;
    if (e > worstExcess) worstExcess = e;
  }
  const s = Array.from(ms).sort((a, b) => a - b);
  return {
    frames: n, median: s[n >> 1], p99: s[Math.min(n - 1, Math.floor(n * 0.99))], worst: s[n - 1],
    over, half, worstExcess, phoneWorst: REFRESH * (1 + worstExcess / overMs), excess,
  };
}

// Pure: { key, value, limit, ok } rows of the gate.
export function checkDrive(r, limits = LIMITS) {
  const r1 = (x) => Math.round(x * 10) / 10;
  return [
    { key: `frames over (excess above ${limits.overMs} ms)`, value: r.over, limit: limits.maxOver, ok: r.over <= limits.maxOver },
    { key: 'worst frame, phone ms', value: r1(r.phoneWorst), limit: limits.maxWorstPhoneMs, ok: r.phoneWorst <= limits.maxWorstPhoneMs },
    { key: 'new shader programs in the drive', value: r.newPrograms, limit: limits.maxNewPrograms, ok: r.newPrograms <= limits.maxNewPrograms },
    { key: 'shader programs in all', value: r.programsEnd, limit: limits.maxPrograms, ok: r.programsEnd <= limits.maxPrograms },
  ];
}

// Pure: self time by function over the samples of [t0, t1] (profile clock, microseconds).
// Returns the top `top` entries as 'name ms' strings; gc is the collector's share in ms.
export function profileWindow(index, t0, t1, top = 6) {
  const { times, ids, names } = index;
  let lo = 0, hi = times.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (times[m] < t0) lo = m + 1; else hi = m; }
  const self = new Map();
  let gc = 0;
  for (let i = lo; i < times.length && times[i] <= t1; i++) {
    const d = i + 1 < times.length ? times[i + 1] - times[i] : 0;
    const nm = names.get(ids[i]) || '?';
    if (nm === '(garbage collector)') gc += d;
    self.set(nm, (self.get(nm) || 0) + d);
  }
  const list = [...self.entries()].filter(([k]) => k !== '(idle)').sort((a, b) => b[1] - a[1]).slice(0, top).map(([k, v]) => `${k} ${(v / 1000).toFixed(1)}`);
  return { top: list, gcMs: gc / 1000 };
}

// Pure: the sample index of a CPU profile. names: node id to 'function' or, with `owners`, the
// nearest named ancestor that is not a tiny helper (so Math and array helpers count for their caller).
export function profileIndex(profile) {
  const names = new Map();
  for (const n of profile.nodes) names.set(n.id, n.callFrame.functionName || '(anonymous ' + String(n.callFrame.url).split('/').pop() + ':' + n.callFrame.lineNumber + ')');
  const times = new Float64Array(profile.samples.length);
  let t = profile.startTime;
  for (let i = 0; i < times.length; i++) { t += profile.timeDeltas[i] || 0; times[i] = t; }
  return { times, ids: profile.samples, names };
}

// ---------------------------------------------------------------------------
// In-page code (stringified by Playwright)
// ---------------------------------------------------------------------------
// After the start: stop the loop and wrap every system's calls.
function installTimers(cfg) {
  const g = window.__rw;
  g.loop.stop();
  const names = [];
  const D = (window.__pcr = { names, cur: null, part: new Float64Array(4), error: '' });
  g.systems.forEach((s, i) => {
    names[i] = s.name || 'system' + i;
    for (const key of ['always', 'fixedUpdate', 'render']) {
      const f = s[key];
      if (typeof f !== 'function') continue;
      s[key] = function timed(a, b) {
        const t = performance.now();
        try { return f.call(s, a, b); } finally { D.cur[i] += performance.now() - t; }
      };
    }
  });
  const stream = g.cityMesh.userData.stream;
  if (stream) {
    const u = stream.update;
    stream.update = function timedStream(a, b) {
      const t = performance.now();
      try { return u.call(stream, a, b); } finally { D.part[0] += performance.now() - t; }
    };
  }
  if (g.renderFrame) {
    const rf = g.renderFrame;
    g.renderFrame = function timedFrame(a) {
      const t = performance.now();
      try { return rf.call(g, a); } finally { D.part[1] += performance.now() - t; }
    };
  }
  if (g.hud && g.hud.update) {
    const hu = g.hud.update;
    g.hud.update = function timedHud(a) {
      const t = performance.now();
      try { return hu.call(g.hud, a); } finally { D.part[2] += performance.now() - t; }
    };
  }
  D.cur = new Float64Array(g.systems.length + 1);
  // The software renderer's vertex and raster work is not measured: no draw call reaches it.
  const gl = g.renderer.getContext();
  if (!cfg.gpu) {
    const none = () => {};
    for (const k of ['drawElements', 'drawArrays', 'drawElementsInstanced', 'drawArraysInstanced', 'drawRangeElements']) gl[k] = none;
    const md = gl.getExtension('WEBGL_multi_draw');
    if (md) for (const k of ['multiDrawElementsWEBGL', 'multiDrawArraysWEBGL', 'multiDrawElementsInstancedWEBGL', 'multiDrawArraysInstancedWEBGL']) md[k] = none;
  }
  D.gl = gl;
  // Bytes handed to the GPU each frame (buffers and texture pixels): on the phone an upload
  // is driver work this run cannot time, so it is counted.
  D.up = 0;
  const wrapUp = (k, size) => {
    const f = gl[k];
    if (typeof f !== 'function') return;
    gl[k] = function counted(...a) { try { D.up += size(a) || 0; } catch { /* count only */ } return f.apply(gl, a); };
  };
  const bytes = (x) => (typeof x === 'number' ? x : x && x.byteLength ? x.byteLength : 0);
  const pix = (x) => (x && x.width ? x.width * x.height * 4 : x && x.byteLength ? x.byteLength : 0);
  wrapUp('bufferData', (a) => bytes(a[1]));
  wrapUp('bufferSubData', (a) => bytes(a[2]));
  wrapUp('texImage2D', (a) => (a.length >= 9 ? (a[8] ? a[3] * a[4] * 4 : 0) : pix(a[5])));
  wrapUp('texSubImage2D', (a) => (a.length >= 9 ? (a[8] && a[8].byteLength ? a[4] * a[5] * 4 : pix(a[8])) : pix(a[6])));
  wrapUp('texImage3D', (a) => (a[9] ? a[3] * a[4] * a[5] * 4 : 0));
  wrapUp('texSubImage3D', (a) => (a[10] ? a[5] * a[6] * a[7] * 4 : 0));
  // The owner's phone runs the High tier at a fixed 2.00; the resolution a run would
  // lead to is worked out afterwards from the frame times.
  if (cfg.quality > 0) g.quality = cfg.quality;
  if (g.graphics && 'adaptive' in g.graphics) { g.graphics.adaptive = false; g.resize(); }
  D.heat = false;
  D.frame = 0;
  D.sysWorst = new Float64Array(g.systems.length + 4);
  D.sysWorstAt = new Int32Array(g.systems.length + 4);
  D.sysSum = new Float64Array(g.systems.length + 4);
  D.maxStars = 0; D.liveMax = 0; D.dist = 0;
  return { systems: names.length };
}

// The Phone check, the way a tap starts it: pause, Settings, Display, Start.
function startCheck(cfg) {
  const g = window.__rw, D = window.__pcr, names = D.names;
  g.paused = true;
  g.events.emit('pause', true);
  const click = (sel, text) => {
    const el = [...document.querySelectorAll(sel)].find((e) => !text || e.textContent.trim() === text);
    if (!el) { D.error = D.error || 'no ' + sel + ' ' + (text || ''); return false; }
    el.click();
    return true;
  };
  click('[role="tab"]', 'Settings');
  click('.rw-menu-groups [data-group="display"]');
  const systemsBefore = g.systems.length;
  click('[data-role="phonecheck"]');
  // The check adds its own system at the first start: time it with the others.
  for (let i = systemsBefore; i < g.systems.length; i++) {
    const s = g.systems[i];
    names[i] = s.name || 'system' + i;
    const f = s.fixedUpdate;
    if (typeof f === 'function') s.fixedUpdate = function timed(a) { const t = performance.now(); try { return f.call(s, a); } finally { D.cur[i] += performance.now() - t; } };
  }
  D.cur = new Float64Array(g.systems.length + 1);
  D.started = !!document.querySelector('.rw-pc-on');
  D.heat = !!cfg.heat;
  D.frame = 0;
  D.programs0 = g.renderer.info.programs ? g.renderer.info.programs.length : 0;
  D.newProgs = [];
  D.nProg = D.programs0;
  D.sysWorst.fill(0); D.sysSum.fill(0); D.sysWorstAt.fill(-1);
  D.maxStars = 0; D.liveMax = 0; D.dist = 0;
  return { started: D.started, error: D.error };
}

// A burn the profiler can find: ties performance.now() to the profile's clock.
function syncMark() {
  const t0 = performance.now();
  let x = 0;
  (function __rwSyncMark() { while (performance.now() - t0 < 30) x += Math.sqrt(x + 1); })();
  return { t0, x: x > 0 };
}

// n frames: one fixed step and one draw each, as the phone runs it at 60 Hz.
// Returns compact per-frame rows:
// [ms, stepMs, drawMs, signature, topSystemIndex, topSystemMs, coreMs, streamMs, renderFrameMs, hudMs,
//  programs, geometries, textures, vehicles, stars, t0, t1, bytes uploaded]
function driveFrames(cfg) {
  const g = window.__rw, D = window.__pcr;
  const STEP = 1 / 60;
  const rows = [];
  const info = g.renderer.info;
  let done = false;
  for (let f = 0; f < cfg.n; f++) {
    if (cfg.check && !document.querySelector('.rw-pc-on')) { done = true; break; }
    D.cur.fill(0); D.part.fill(0); D.up = 0;
    if (D.heat && D.frame % 60 === 0 && g.police && g.police.heat) {
      const hh = g.police.heat;
      hh.level = 4; hh.grace = 0; hh.cooldown = 0; hh.unseen = 0;
    }
    const pv = g.player.vehicle, x0 = pv ? pv.x : 0, z0 = pv ? pv.z : 0;
    const t0 = performance.now();
    g.step(STEP);
    const t1 = performance.now();
    let sysStep = 0, bi = -1, bm = 0;
    for (let k = 0; k < D.cur.length - 1; k++) {
      const c = D.cur[k];
      sysStep += c;
      D.sysSum[k] += c;
      if (c > D.sysWorst[k]) { D.sysWorst[k] = c; D.sysWorstAt[k] = D.frame; }
      if (c > bm) { bm = c; bi = k; }
    }
    const core = Math.max(0, t1 - t0 - sysStep);
    D.cur.fill(0);
    g.draw(1, STEP);
    const t2 = performance.now();
    for (let k = 0; k < D.cur.length - 1; k++) { const c = D.cur[k]; D.sysSum[k] += c; if (c > bm) { bm = c; bi = k; } }
    // Let the renderer process catch up outside the measured time.
    D.gl.getError();
    // A shader program compiled in play: which one (its name, the head of its key).
    const progs = info.programs;
    if (progs && progs.length > (D.nProg || 0)) {
      if (D.nProg) {
        for (let k = D.nProg; k < progs.length; k++) {
          // And how its key differs from the nearest program compiled before
          // (field index: new value / old value), to tell which material variant it is.
          const f = String(progs[k].cacheKey).split(',');
          let best = null, bestSame = -1;
          for (let j = 0; j < k; j++) {
            const o = String(progs[j].cacheKey).split(',');
            if (o.length !== f.length) continue;
            let same = 0;
            for (let q = 0; q < f.length; q++) if (o[q] === f[q]) same++;
            if (same > bestSame) { bestSame = same; best = o; }
          }
          const diff = [];
          if (best) for (let q = 0; q < f.length && diff.length < 8; q++) if (best[q] !== f[q]) diff.push(q + ':' + String(f[q]).slice(0, 24) + '/' + String(best[q]).slice(0, 24));
          (D.newProgs || (D.newProgs = [])).push({ frame: D.frame, name: progs[k].name, key: String(progs[k].cacheKey).slice(0, 120), tail: String(progs[k].cacheKey).slice(-40), diff: diff.join(' ') });
        }
      }
      D.nProg = progs.length;
    }
    D.frame++;
    const stars = g.police ? g.police.stars : 0;
    if (stars > D.maxStars) D.maxStars = stars;
    if (g.vehicles.length > D.liveMax) D.liveMax = g.vehicles.length;
    if (pv && g.player.vehicle === pv) D.dist += Math.hypot(pv.x - x0, pv.z - z0);
    // The state of the run, to tell whether two passes played the same drive.
    const sig = Math.round(g.player.x * 100) + Math.round(g.player.z * 100) * 7 + g.vehicles.length * 1000003 + stars * 17;
    const sst = g.cityMesh.userData.stream && g.cityMesh.userData.stream.stats;
    rows.push([t2 - t0, t1 - t0, t2 - t1, sig, bi, bm, core, D.part[0], D.part[1], D.part[2],
      info.programs ? info.programs.length : 0, info.memory.geometries, info.memory.textures, g.vehicles.length, stars, t0, t2, D.up,
      sst && sst.frameSliceMs > 1 ? sst.frameSlice : '']);
  }
  return { rows, done };
}

function driveSummary() {
  const g = window.__rw, D = window.__pcr;
  const pst = g.police && g.police.stats;
  const kinds = {};
  for (const v of g.vehicles) kinds[v.kind] = (kinds[v.kind] || 0) + 1;
  const st = g.cityMesh.userData.stream && g.cityMesh.userData.stream.stats;
  return {
    names: D.names, sysWorst: Array.from(D.sysWorst), sysWorstAt: Array.from(D.sysWorstAt), sysSum: Array.from(D.sysSum), frames: D.frame,
    maxStars: D.maxStars, tanks: pst ? pst.tanks : null,
    liveMax: D.liveMax, kinds, meters: Math.round(D.dist), programs: g.renderer.info.programs ? g.renderer.info.programs.length : 0,
    programs0: D.programs0, newProgs: D.newProgs || [], geometries: g.renderer.info.memory.geometries, textures: g.renderer.info.memory.textures,
    tiles: st ? { built: st.built, worstSliceMs: Math.round(st.worstSliceMs * 10) / 10 } : null,
    errors: g.errors && g.errors.count ? g.errors.count() : null,
    heapMb: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null,
  };
}

// ---------------------------------------------------------------------------
// Pure: the garbage collections between the trace marks `label`-0 and `label`-1.
// events: trace events (MinorGC, MajorGC with args.usedHeapSizeBefore / After, and the marks).
export function gcStats(events, label) {
  const mark = (k) => { const e = events.find((x) => x.name === 'rwpc-' + label + '-' + k); return e ? e.ts : null; };
  const a = mark(0), b = mark(1);
  if (a === null || b === null) return null;
  const gcs = events.filter((e) => (e.name === 'MinorGC' || e.name === 'MajorGC') && e.ph === 'X' && e.ts >= a && e.ts <= b).sort((x, y) => x.ts - y.ts);
  let minor = 0, major = 0, pause = 0, worst = 0, alloc = 0, last = null;
  const majors = [];
  for (const e of gcs) {
    const d = (e.dur || 0) / 1000;
    if (e.name === 'MinorGC') minor++;
    else {
      major++;
      majors.push({ s: +((e.ts - a) / 1e6).toFixed(1), ms: +d.toFixed(1), type: (e.args && e.args.type) || '', beforeMb: Math.round(((e.args && e.args.usedHeapSizeBefore) || 0) / 1048576), afterMb: Math.round(((e.args && e.args.usedHeapSizeAfter) || 0) / 1048576) });
    }
    pause += d;
    if (d > worst) worst = d;
    const before = e.args && e.args.usedHeapSizeBefore, after = e.args && e.args.usedHeapSizeAfter;
    if (last !== null && before > last) alloc += before - last;
    if (after >= 0) last = after;
  }
  const seconds = (b - a) / 1e6;
  return { minor, major, pauseMs: +pause.toFixed(1), worstMs: +worst.toFixed(1), allocMb: +(alloc / 1048576).toFixed(1), seconds: +seconds.toFixed(1), majors };
}

// Pure: the top allocating functions of a sampled heap profile, as 'name file:line KB'.
export function allocTop(profile, top = 20) {
  const self = new Map();
  let total = 0;
  const walk = (node) => {
    const cf = node.callFrame;
    const key = (cf.functionName || '(anonymous)') + ' ' + String(cf.url).split('/').pop() + ':' + (cf.lineNumber + 1);
    const size = node.selfSize || 0;
    total += size;
    self.set(key, (self.get(key) || 0) + size);
    for (const c of node.children || []) walk(c);
  };
  walk(profile.head);
  const list = [...self.entries()].sort((a, b) => b[1] - a[1]).slice(0, top).map(([k, v]) => `${k} ${Math.round(v / 1024)} KB`);
  return { totalMb: +(total / 1048576).toFixed(1), totalKb: Math.round(total / 1024), top: list };
}

// Pure: the fastest pass of each frame. passes: [{ rows }]; frames whose state differs from the
// first pass's (the drive did not repeat) are counted in `mixed` and keep the first pass's row.
export function fastestFrames(passes) {
  const base = passes[0].rows;
  const rows = [], from = [];
  let mixed = 0;
  for (let i = 0; i < base.length; i++) {
    let best = base[i], bp = 0;
    for (let p = 1; p < passes.length; p++) {
      const r = passes[p].rows[i];
      if (!r) continue;
      if (r[3] !== base[i][3]) { mixed++; continue; }
      if (r[0] < best[0]) { best = r; bp = p; }
    }
    rows.push(best);
    from.push(bp);
  }
  return { rows, from, mixed };
}

// Pure: the lowest pixel ratio the adaptive resolution reaches when fed the phone's frame
// times of a run (one refresh, plus one for each overMs of excess). make: createAdaptiveRes.
export function resAfter(make, ms, overMs = LIMITS.overMs, max = 2) {
  const res = make({ max, start: max });
  let level = ms.length ? ms[0] : 0, min = max;
  for (let i = 0; i < ms.length; i++) {
    const e = ms[i] - level;
    const lost = e > overMs ? Math.min(14, Math.floor(e / overMs)) : 0;
    if (!lost) level += (ms[i] - level) * 0.05;
    const sc = res.update((1 + lost) / 60);
    if (sc < min) min = sc;
  }
  return min;
}

async function main() {
  const argv = process.argv.slice(2);
  const has = (f) => argv.includes(f);
  const opt = (f, d) => { const i = argv.indexOf(f); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
  const rate = Number(opt('--rate', 4));
  const seconds = Number(opt('--seconds', 60));
  const settle = Number(opt('--settle', 10));
  const quality = Number(opt('--quality', 1.25));
  const map = opt('--map', 'miami-downtown');
  const srcRoot = resolve(opt('--root', here));
  const outFile = resolve(opt('--out', join(here, 'shots/perf-phonecheck.json')));
  const profileOn = has('--profile');
  const nPass = Math.max(1, Number(opt('--passes', profileOn ? 2 : 3)));
  const heat = !has('--no-heat');
  const quiet = has('--quiet');
  const overMs = Number(opt('--over', LIMITS.overMs));

  let chromium;
  try { ({ chromium } = await import('playwright')); } catch { ({ chromium } = createRequire('/opt/node-tools/node_modules/')('playwright')); }
  const { buildGame, serve } = await import(pathToFileURL(join(srcRoot, 'scripts/build.mjs')).href);
  let makeRes = null;
  try { makeRes = (await import(pathToFileURL(join(srcRoot, 'src/render/adaptres.js')).href)).createAdaptiveRes; } catch { /* an old tree without it */ }
  // Its own folder: other scripts build into dist/ at the same time.
  const dist = await mkdtemp(join(tmpdir(), 'rw-phonecheck-'));
  const allocOn = has('--alloc');
  await buildGame({ minify: !profileOn && !allocOn, prod: true, outDir: dist });
  const server = await serve(0, dist);
  const url = `http://127.0.0.1:${server.address().port}/?autostart&map=${map}`;
  const result = { rate, map, heat, seconds, settle, quality, passes: nPass, profile: profileOn, root: srcRoot === here ? '.' : srcRoot };
  let failed = false;
  const errors = [];
  const t00 = Date.now();

  // One pass: a fresh browser, the start, the first seconds of play, the check's drive.
  async function pass(n) {
    const browser = await chromium.launch({ args: LAUNCH_ARGS });
    try {
      const page = await browser.newPage({ viewport: { width: 915, height: 412 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
      page.on('pageerror', (e) => errors.push(String(e)));
      page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
      const cdp = await page.context().newCDPSession(page);
      if (rate > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate });
      await page.goto(url);
      await page.waitForFunction(() => window.__rw && window.__rw.loop && window.__rw.loop.running, null, { timeout: 180000 });
      const out = { startMs: await page.evaluate(() => Math.round(window.__rwStartMs || performance.now())) };
      await page.evaluate(installTimers, { gpu: has('--gpu'), quality });
      // Garbage collections of the first pass (a trace of the v8 category only).
      const trace = [];
      const tracing = n === 0 && !has('--no-gc');
      if (tracing) {
        cdp.on('Tracing.dataCollected', (e) => { for (const ev of e.value) if (ev.name === 'MinorGC' || ev.name === 'MajorGC' || String(ev.name).startsWith('rwpc-')) trace.push(ev); });
        await cdp.send('Tracing.start', { transferMode: 'ReportEvents', traceConfig: { includedCategories: ['v8', 'devtools.timeline', 'blink.user_timing'] } });
      }
      let sync = null;
      if (profileOn) {
        await cdp.send('Profiler.enable');
        await cdp.send('Profiler.setSamplingInterval', { interval: 250 });
        await cdp.send('Profiler.start');
        sync = await page.evaluate(syncMark);
      }
      const play = async (label, total, check) => {
        const rows = [];
        await page.evaluate((m) => performance.mark(m), 'rwpc-' + label + '-0');
        while (rows.length < total) {
          const r = await page.evaluate(driveFrames, { n: Math.min(120, total - rows.length), check });
          rows.push(...r.rows);
          if (!quiet && process.stdout.isTTY) process.stdout.write(`\r  pass ${n + 1} ${label}: ${rows.length} frames, ${((Date.now() - t00) / 1000).toFixed(0)} s    `);
          if (r.done || !r.rows.length) break;
        }
        await page.evaluate((m) => performance.mark(m), 'rwpc-' + label + '-1');
        return { rows, sum: await page.evaluate(driveSummary) };
      };
      // The first seconds of play (on the phone: behind the title and the menu), then the check.
      out.first = settle > 0 ? await play('first play', Math.round(settle * 60), false) : null;
      await cdp.send('HeapProfiler.enable');
      await cdp.send('HeapProfiler.collectGarbage');
      out.memStartMb = await page.evaluate(() => (performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null));
      const inst = await page.evaluate(startCheck, { heat });
      if (!inst.started) throw new Error('the Phone check did not start: ' + (inst.error || 'no reason given'));
      // --alloc: where the drive allocates (sampled heap profile, objects the collector took too).
      if (allocOn && n === 0) await cdp.send('HeapProfiler.startSampling', { samplingInterval: 8192, includeObjectsCollectedByMajorGC: true, includeObjectsCollectedByMinorGC: true });
      out.drive = await play('drive', Math.round(seconds * 60), true);
      if (allocOn && n === 0) {
        const { profile } = await cdp.send('HeapProfiler.stopSampling');
        out.alloc = allocTop(profile, 25);
        if (has('--alloc-raw')) await writeFile(resolve(opt('--alloc-raw', 'alloc.heapprofile')), JSON.stringify(profile));
      }
      if (profileOn) {
        const { profile } = await cdp.send('Profiler.stop');
        out.index = profileIndex(profile);
        // First sample inside the sync burn: profile time of performance.now() == sync.t0.
        let at = -1;
        for (let i = 0; i < out.index.ids.length; i++) if (out.index.names.get(out.index.ids[i]) === '__rwSyncMark') { at = out.index.times[i]; break; }
        out.offset = at >= 0 ? at - sync.t0 * 1000 : profile.startTime - sync.t0 * 1000;
      }
      if (tracing) {
        const done = new Promise((ok) => cdp.once('Tracing.tracingComplete', ok));
        await cdp.send('Tracing.end');
        await done;
        out.trace = trace;
      }
      await cdp.send('HeapProfiler.collectGarbage');
      out.memEndMb = await page.evaluate(() => (performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null));
      return out;
    } finally {
      await browser.close();
    }
  }

  try {
    const passes = [];
    for (let n = 0; n < nPass; n++) passes.push(await pass(n));
    if (!quiet && process.stdout.isTTY) process.stdout.write('\n');
    result.startMs = Math.min(...passes.map((p) => p.startMs));
    result.memStartMb = passes[0].memStartMb;
    result.memEndMb = passes[0].memEndMb;

    // One phase: statistics, the systems, and every frame a quarter of a refresh or more above
    // the level (on the phone: over 16.7 ms when the level has no slack left) with its cause.
    const describe = (key) => {
      const f = fastestFrames(passes.map((p) => p[key]));
      const rows = f.rows, sum = passes[0][key].sum;
      const ms = rows.map((r) => r[0]);
      const st = driveStats(ms, overMs);
      const excess = st.excess;
      delete st.excess;
      const names = sum.names;
      const out = Object.assign({}, st, {
        gc: passes[0].trace ? gcStats(passes[0].trace, key === 'first' ? 'first play' : 'drive') : null,
        mixed: f.mixed, res: makeRes ? resAfter(makeRes, ms, overMs) : null,
        maxStars: sum.maxStars, tanks: sum.tanks, liveMax: sum.liveMax, kinds: sum.kinds, meters: sum.meters,
        programsStart: rows.length ? rows[0][10] : 0, programsEnd: sum.programs, newProgs: sum.newProgs, geometries: sum.geometries, textures: sum.textures, tiles: sum.tiles,
        meanStepMs: +(rows.reduce((a, r) => a + r[1], 0) / Math.max(1, rows.length)).toFixed(2), meanDrawMs: +(rows.reduce((a, r) => a + r[2], 0) / Math.max(1, rows.length)).toFixed(2),
      });
      // A system's worst call: the lowest of the passes' worsts (each pass saw the same calls),
      // and the frame of each pass's worst (the same frame in every pass: the call's own cost;
      // different frames: something else landed on it, a collection or the machine).
      out.systems = names.map((nm, k) => ({
        name: nm, meanMs: +(sum.sysSum[k] / Math.max(1, sum.frames)).toFixed(3),
        worstMs: +Math.min(...passes.map((p) => p[key].sum.sysWorst[k])).toFixed(2),
        at: passes.map((p) => (p[key].sum.sysWorstAt ? p[key].sum.sysWorstAt[k] : -1)),
      })).sort((a, b) => b.worstMs - a.worstMs).slice(0, 12);
      out.slowsys = out.systems[0] ? `${out.systems[0].name} ${out.systems[0].worstMs.toFixed(1)} ms` : 'n/a';
      const slow = [];
      for (let i = 0; i < rows.length; i++) {
        const r = rows[i];
        if (excess[i] <= overMs / 4 && r[5] <= 4) continue; // slow frames and system calls over 4 ms
        const prev = passes[f.from[i]][key].rows[i - 1] || r;
        const row = {
          frame: i, s: +(i / 60).toFixed(1), ms: +r[0].toFixed(1), excess: +excess[i].toFixed(1), stepMs: +r[1].toFixed(1), drawMs: +r[2].toFixed(1),
          topSystem: r[4] >= 0 ? names[r[4]] : '', topSystemMs: +r[5].toFixed(1), coreMs: +r[6].toFixed(1), streamMs: +r[7].toFixed(1),
          renderMs: +r[8].toFixed(1), hudMs: +r[9].toFixed(1), newPrograms: r[10] - prev[10], newGeometries: r[11] - prev[11], newTextures: r[12] - prev[12],
          vehicles: r[13], stars: r[14], uploadKb: Math.round((r[17] || 0) / 1024), slice: r[18] || '',
        };
        const P = passes[f.from[i]];
        if (P.index) {
          const w = profileWindow(P.index, r[15] * 1000 + P.offset, r[16] * 1000 + P.offset, 8);
          row.top = w.top; row.gcMs = +w.gcMs.toFixed(1);
        }
        slow.push(row);
      }
      out.slow = slow;
      // What reached the GPU in play: frames with new programs or textures, and the largest uploads.
      const r0 = passes[0][key].rows;
      const ev = [];
      for (let i = 1; i < r0.length; i++) {
        const a = r0[i - 1], b = r0[i];
        if (b[10] > a[10] || b[12] > a[12] || (b[17] || 0) > 262144) ev.push({ frame: i, s: +(i / 60).toFixed(1), newPrograms: b[10] - a[10], newTextures: b[12] - a[12], newGeometries: b[11] - a[11], uploadKb: Math.round((b[17] || 0) / 1024), excess: +excess[i].toFixed(1) });
      }
      out.gpuEvents = ev;
      out.uploadMb = +(r0.reduce((a, r) => a + (r[17] || 0), 0) / 1048576).toFixed(1);
      const P0 = passes[0];
      if (P0.index && P0[key].rows.length) {
        const rr = P0[key].rows;
        const w = profileWindow(P0.index, rr[0][15] * 1000 + P0.offset, rr[rr.length - 1][16] * 1000 + P0.offset, 80);
        out.profileTop = w.top; out.gcMsTotal = +w.gcMs.toFixed(0);
      }
      return out;
    };
    const show = (title, d) => {
      console.log(`${title}: ${d.frames} frames, ${d.meters} m, stars ${d.maxStars}, tanks ${d.tanks}, live vehicles up to ${d.liveMax}${d.mixed ? ` (${d.mixed} frames differed between passes)` : ''}`);
      console.log(`  frames over (excess above ${overMs} ms): ${d.over}   worst excess ${d.worstExcess.toFixed(1)} ms = ${d.phoneWorst.toFixed(0)} ms on the phone   over half: ${d.half}   res ${d.res === null ? 'n/a' : d.res.toFixed(2)}`);
      console.log(`  main thread per frame: median ${d.median.toFixed(1)} ms (step ${d.meanStepMs} + draw ${d.meanDrawMs} mean), p99 ${d.p99.toFixed(1)}, worst ${d.worst.toFixed(1)}   programs ${d.programsStart} to ${d.programsEnd}   slowest system call ${d.slowsys}`);
      if (d.gc) console.log(`  garbage collection (first pass, throttled): ${d.gc.minor} minor, ${d.gc.major} major, ${d.gc.pauseMs} ms in all, worst ${d.gc.worstMs} ms; ${d.gc.allocMb} MB allocated = ${(d.gc.allocMb * 1024 / Math.max(1, d.frames)).toFixed(1)} KB a frame`);
      if (d.newProgs && d.newProgs.length) console.log('  programs compiled in play (frame, name, key, tail, differs from the nearest: field new/old): ' + d.newProgs.slice(0, 6).map((p) => `${p.frame} ${p.name} ${p.key} ... ${p.tail || ''} [${p.diff || ''}]`).join('; '));
      if (d.gc && d.gc.majors.length) console.log('  major collections (second, ms, type, MB before to after): ' + d.gc.majors.map((m) => `${m.s}s ${m.ms} ${m.type} ${m.beforeMb}>${m.afterMb}`).join('; '));
      console.log(`  to the GPU in play: ${d.uploadMb} MB uploaded; ${d.gpuEvents.filter((e) => e.newPrograms > 0).length} frames with new programs, ${d.gpuEvents.filter((e) => e.newTextures > 0).length} with new textures, ${d.gpuEvents.filter((e) => e.uploadKb > 256).length} with over 256 KB`);
      console.log('  worst system calls (ms, frame of each pass): ' + d.systems.slice(0, 8).map((x) => `${x.name} ${x.worstMs.toFixed(1)} @${x.at.join('/')}`).join(', '));
      // The ten worst frames in one line: frame, excess, the tile slice or the system that cost
      // most, and with --profile the function with the most samples in that frame.
      const worst10 = d.slow.slice().sort((a, b) => b.excess - a.excess).slice(0, 10);
      console.log('  top 10 frames (frame excess: cause / top function): ' + worst10.map((r) => `${r.frame} ${r.excess}: ${r.streamMs > 4 ? 'tiles ' + (r.slice || '?') : r.topSystemMs > 4 ? r.topSystem : r.coreMs > 4 ? 'core' : 'draw'}${r.top && r.top[0] ? ' / ' + r.top[0].replace(/ [\d.]+$/, '') : ''}`).join(', '));
      if (quiet) return;
      console.log('  slow frames: frame, second, excess, step, draw | cause');
      for (const r of d.slow.slice().sort((a, b) => b.excess - a.excess).slice(0, has('--all') ? 1e9 : 25)) {
        const cause = [];
        if (r.newPrograms) cause.push(`${r.newPrograms} new programs`);
        if (r.newGeometries > 0) cause.push(`${r.newGeometries} new geometries`);
        if (r.newTextures > 0) cause.push(`${r.newTextures} new textures`);
        if (r.uploadKb > 64) cause.push(`upload ${r.uploadKb} KB`);
        if (r.streamMs > 4) cause.push(`tiles ${r.streamMs}${r.slice ? ' (' + r.slice + ')' : ''}`);
        if (r.topSystemMs > 4) cause.push(`${r.topSystem} ${r.topSystemMs}`);
        if (r.coreMs > 4) cause.push(`core ${r.coreMs}`);
        if (r.gcMs > 1) cause.push(`gc ${r.gcMs}`);
        console.log(`   ${String(r.frame).padStart(5)} ${String(r.s).padStart(5)}s ${String(r.excess).padStart(6)} ${String(r.stepMs).padStart(6)} ${String(r.drawMs).padStart(6)} | ${cause.join(', ')}${r.top ? ' | ' + r.top.slice(0, 6).join('; ') : ''}`);
      }
    };
    const d = describe('drive');
    if (passes[0].alloc) { result.alloc = passes[0].alloc; console.log(`Allocated in the drive (sampled): ${result.alloc.totalMb} MB\n  ` + result.alloc.top.join('\n  ')); }
    Object.assign(result, d, { overMs, newPrograms: d.programsEnd - passes[0].drive.sum.programs0, pageErrors: errors.length, errors: errors.slice(0, 5) });
    if (settle > 0) result.firstPlay = describe('first');
    await mkdir(dirname(outFile), { recursive: true });
    await writeFile(outFile, JSON.stringify(result, null, 1));
    console.log(`Start ${(result.startMs / 1000).toFixed(1)} s at ${rate}x throttle, ${map}, quality ${quality}, ${nPass} passes; memory ${result.memStartMb} MB before the check, ${result.memEndMb} MB after (forced collection)`);
    if (result.firstPlay) show(`First ${settle} s of play`, result.firstPlay);
    show(`Phone check drive${heat ? ', five stars held' : ''}`, d);
    if (errors.length) { console.log('FAIL page errors: ' + errors.slice(0, 3).join(' | ')); failed = true; }
    if (has('--check')) {
      for (const c of checkDrive(result)) {
        console.log(`${c.ok ? 'ok  ' : 'FAIL'} ${c.key}: ${c.value} (limit ${c.limit})`);
        if (!c.ok) failed = true;
      }
    }
  } catch (e) {
    console.log('FAIL', e.message);
    failed = true;
  } finally {
    server.close();
    await rm(dist, { recursive: true, force: true });
  }
  process.exit(failed ? 1 : 0);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
