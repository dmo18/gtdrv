// Performance scenarios (docs/PLAN_V2.md section 4 and 5.3 T1; budgets in docs/PERF.md).
// Builds the game, runs it in headless Chromium (software renderer) at phone size and reports:
//  - the start: page load to running at 1x and 4x CPU throttle (Chrome DevTools Protocol), the
//    first draw, shader programs, memory after a forced collection, and a CPU-profile breakdown
//    (city build, tile renderer, textures, fleet, shader programs) of an unminified build
//  - per-step time by system for cruise, fast drive 50 m/s, heat 5 with the police tank and
//    helicopter, and a jet crossing
//  - first-use probes: first blast, first shot on foot, first boat, helicopter, plane
// Writes a JSON file and prints short tables. With --check the budgets of the current
// milestone column in docs/PERF.md must hold, or the exit code is 1.
// usage: node scripts/perf-scenarios.mjs [--check] [--quick] [--no-4x] [--no-profile]
//          [--milestone 0.7.0] [--out shots/perf-scenarios.json] [--draw-every 15]
//          [--from result.json]   (no browser: only print and check an earlier result)
import { createRequire } from 'node:module';
import { readFile, writeFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildGame, serve } from './build.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const LAUNCH_ARGS = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-precise-memory-info'];

// ---------------------------------------------------------------------------
// Budgets (pure; docs/PERF.md is the data)
// ---------------------------------------------------------------------------
export function parseBudgets(md) {
  const m = /^Current milestone:\s*(\S+)/m.exec(md);
  const current = m ? m[1] : null;
  const milestones = [];
  const rows = [];
  for (const line of md.split('\n')) {
    if (!line.startsWith('|')) continue;
    const cells = line.split('|').slice(1, -1).map((c) => c.trim());
    if (cells[0] === 'key') { milestones.push(...cells.slice(3)); continue; }
    const k = /^`([a-z0-9_]+)`$/.exec(cells[0] || '');
    if (!k || (cells[2] !== 'max' && cells[2] !== 'min') || !milestones.length) continue;
    const limits = {};
    cells.slice(3).forEach((c, i) => { if (milestones[i] && c !== '-') limits[milestones[i]] = Number(c); });
    rows.push({ key: k[1], what: cells[1], check: cells[2], limits });
  }
  return { current, milestones, rows };
}

// Results: { key, value, limit, ok } for each budget row with a limit at the milestone.
// A budget whose metric was not measured fails (it is not silently skipped).
export function checkBudgets(budgets, metrics, milestone) {
  const out = [];
  for (const r of budgets.rows) {
    const limit = r.limits[milestone];
    if (!(limit >= 0)) continue;
    const v = metrics[r.key];
    const have = typeof v === 'number' && Number.isFinite(v);
    const ok = have && (r.check === 'max' ? v <= limit : v >= limit);
    out.push({ key: r.key, check: r.check, value: have ? v : null, limit, ok });
  }
  return out;
}

// ---------------------------------------------------------------------------
// CPU profile: inclusive time of the outermost call of each group
// ---------------------------------------------------------------------------
export const PROFILE_GROUPS = {
  city: [/^createMiamiCity$/, /^createIslandCity$/],
  tiles: [/^buildRealCity$/],
  textures: [/^createTextures$/, /^detailTexture$/, /^makeWindowAtlas$/],
  fleet: [/^createFleet$/],
  explore: [/^attachExplore$/],
  mapui: [/^createMapUi$/],
  programs: [/^WebGLProgram\d*$/],
  game: [/^createGame(Steps)?$/],
};

export function profileGroups(profile) {
  const nodes = new Map();
  for (const n of profile.nodes) nodes.set(n.id, n);
  const self = new Map();
  const dts = profile.timeDeltas;
  for (let i = 0; i < profile.samples.length; i++) self.set(profile.samples[i], (self.get(profile.samples[i]) || 0) + (dts[i] || 0));
  const groupOf = (name) => {
    for (const g of Object.keys(PROFILE_GROUPS)) if (PROFILE_GROUPS[g].some((re) => re.test(name))) return g;
    return null;
  };
  const totals = {};
  for (const g of Object.keys(PROFILE_GROUPS)) totals[g] = 0;
  const rootNode = profile.nodes[0];
  // Iterative walk: carries the set of groups already open above, adds a node's
  // inclusive time to its group only when no ancestor belongs to the same group.
  const incl = (id, open) => {
    const n = nodes.get(id);
    const g = groupOf(n.callFrame.functionName || '');
    const opened = g && !open.has(g);
    if (opened) open.add(g);
    let t = self.get(id) || 0;
    for (const c of n.children || []) t += incl(c, open);
    if (opened) { open.delete(g); totals[g] += t; }
    return t;
  };
  incl(rootNode.id, new Set());
  const out = {};
  for (const g of Object.keys(totals)) out[g] = Math.round(totals[g] / 1000);
  return out;
}

// ---------------------------------------------------------------------------
// In-page code (stringified by Playwright; no access to this module's scope)
// ---------------------------------------------------------------------------
// Runs before the game: records when the loop starts and the first draw, and (cfg.sys) wraps
// every system's calls so each step's time can be split by system.
function initHook(cfg) {
  const P = (window.__rwProf = { startMs: 0, firstDrawMs: 0, programsAtFirstDraw: 0, names: [], cur: null, curDraw: null, first: null, firstStep: 0 });
  let game;
  Object.defineProperty(window, '__rw', {
    configurable: true,
    get: () => game,
    set(g) {
      game = g;
      if (!g || !g.loop) return;
      const ls = g.loop.start;
      g.loop.start = function start(...a) {
        if (!P.startMs) P.startMs = performance.now();
        return ls.apply(this, a);
      };
      const draw = g.draw;
      let first = true;
      g.draw = function drawHook(...a) {
        if (!first) return draw.apply(this, a);
        first = false;
        const t = performance.now();
        const r = draw.apply(this, a);
        P.firstDrawMs = performance.now() - t;
        P.programsAtFirstDraw = g.renderer.info.programs ? g.renderer.info.programs.length : 0;
        return r;
      };
      if (!cfg.sys) return;
      const n = g.systems.length;
      P.cur = new Float64Array(n);
      P.curDraw = new Float64Array(n);
      P.first = new Float64Array(n).fill(-1);
      const seen = {};
      g.systems.forEach((s, i) => {
        let nm = s.name || 'system' + i;
        if (seen[nm]) nm += '#' + seen[nm];
        seen[s.name || 'system' + i] = (seen[s.name || 'system' + i] || 0) + 1;
        P.names[i] = nm;
        for (const key of ['always', 'fixedUpdate']) {
          const f = s[key];
          if (typeof f !== 'function') continue;
          s[key] = function timed(a) {
            const t = performance.now();
            try { return f.call(s, a); } finally {
              const d = performance.now() - t;
              P.cur[i] += d;
              if (P.first[i] < 0 && key === 'fixedUpdate') { P.first[i] = d; P.firstStep += d; }
            }
          };
        }
        const r = s.render;
        if (typeof r === 'function') {
          s.render = function timedRender(a, b) {
            const t = performance.now();
            try { return r.call(s, a, b); } finally { P.curDraw[i] += performance.now() - t; }
          };
        }
      });
    },
  });
}

// Installed after the start: helpers the scenarios and probes use. The loop is stopped.
function installHelpers() {
  const g = window.__rw, P = window.__rwProf;
  g.loop.stop();
  for (const k of ['car', 'foot', 'boat', 'plane', 'heli', 'first']) g.progress.medals['hint_' + k] = 'bronze';
  if (g.graphics && 'adaptive' in g.graphics) { g.graphics.adaptive = false; g.resize(); }
  const src = g.input.addSource({ steer: 0, throttle: 0, brake: 0, handbrake: false, moveX: 0, moveY: 0, sprint: false, pitch: 0, boost: false });
  const H = (window.__pf = { src });
  const now = () => performance.now();
  const dt = 1 / 60;
  const med = (a) => { const s = a.slice().sort((x, y) => x - y); return s.length ? s[s.length >> 1] : 0; };
  const r1 = (x) => Math.round(x * 10) / 10;
  const r2 = (x) => Math.round(x * 100) / 100;
  const programs = () => (g.renderer.info.programs ? g.renderer.info.programs.length : 0);

  H.leave = () => {
    const p = g.player;
    if (p.vehicle) { const o = p.vehicle; o.driver = null; o.speed = o.vx = o.vz = 0; p.vehicle = null; g.setPlayerMode('foot'); }
  };
  H.toSpawnCar = (spec) => {
    H.leave();
    const c = g.city, p = g.player;
    const v = g.debug.spawnCar(spec || 'sedan', c.spawn.x, c.spawn.z, c.spawn.heading);
    p.walker.x = p.walker.px = v.x; p.walker.z = p.walker.pz = v.z;
    g.enterVehicle(v);
    g.snapCam();
    return v;
  };
  H.enterKind = (kind, specId) => {
    const p = g.player;
    const c = g.vehicles.find((v) => v.kind === kind && !v.wrecked && !v.removed && (!specId || v.spec.id === specId))
      || g.vehicles.find((v) => v.kind === kind && !v.wrecked && !v.removed);
    if (!c) return null;
    H.leave();
    p.walker.x = p.walker.px = c.x; p.walker.z = p.walker.pz = c.z;
    g.enterVehicle(c);
    g.snapCam();
    return c;
  };
  // A chain of roads from the node nearest the car, most straight-on edge each time.
  H.chain = (v, length) => {
    const c = g.city;
    let n = c.nodes.reduce((b, q) => (Math.hypot(q.x - v.x, q.z - v.z) < Math.hypot(b.x - v.x, b.z - v.z) ? q : b), c.nodes[0]);
    const pts = [n.x, n.z], seen = new Set([n.id]);
    let hx = Math.cos(v.heading), hz = Math.sin(v.heading), len = 0, back = -1;
    for (let hop = 0; hop < 600 && len < length; hop++) {
      let best = null, bs = -Infinity;
      for (const eid of n.edges) {
        const e = c.edges[eid], o = c.nodes[e.a === n.id ? e.b : e.a];
        if (o.id === back || e.causeway) continue;
        const l = Math.hypot(o.x - n.x, o.z - n.z) || 1;
        const sc = ((o.x - n.x) * hx + (o.z - n.z) * hz) / l - (seen.has(o.id) ? 4 : 0);
        if (sc > bs) { bs = sc; best = o; }
      }
      back = n.id;
      if (!best) break;
      const l = Math.hypot(best.x - n.x, best.z - n.z) || 1;
      hx = (best.x - n.x) / l; hz = (best.z - n.z) / l;
      len += l;
      pts.push(best.x, best.z);
      seen.add(best.id);
      n = best;
    }
    return pts;
  };

  // The street view at the start place: draw calls and triangles.
  H.street = () => {
    const v = H.toSpawnCar('sedan');
    if (g.daynight && g.daynight.setHour) g.daynight.setHour(13);
    for (let i = 0; i < 120; i++) g.step(dt);
    g.draw(1, dt); g.draw(1, dt);
    const info = g.renderer.info;
    return { calls: info.render.calls, tris: info.render.triangles, programs: programs(), vehicles: g.vehicles.length, car: v.spec.id };
  };

  // One scenario: n steps of the real game step, a draw every drawEvery steps.
  // cfg: { seconds, speed, drawEvery, jet, heat }
  H.run = (cfg) => {
    const names = P.names, ns = names.length;
    const n = Math.round(cfg.seconds * 60);
    const stream = g.cityMesh.userData.stream;
    const st = stream && stream.stats;
    const built0 = st ? st.built : 0, dropped0 = st ? st.dropped : 0, prog0 = programs();
    if (st) { st.worstSliceMs = 0; st.worst = {}; }
    const stepMs = new Float64Array(n);
    const draws = new Float64Array(Math.ceil(n / cfg.drawEvery) + 1);
    const sysSum = new Float64Array(ns), sysWorst = new Float64Array(ns), blame = new Int32Array(ns + 1);
    const drawSys = new Float64Array(ns);
    let coreSum = 0, nd = 0, over4 = 0, liveMax = 0, steps = 0;
    // Heat: what the police fielded during the run (stats.tanks counts every
    // tank spawned), not only what is still out at the end (a tank is taken
    // away when the helicopter, and with it the fifth star, is lost).
    const pst = g.police && g.police.stats;
    const tanks0 = pst ? pst.tanks : 0;
    let maxStars = 0, tankAt = -1;
    const v = cfg.jet ? H.enterKind('plane', 'jet') : H.toSpawnCar('sedan');
    if (!v) return { skipped: 'no craft' };
    const b = g.city.bounds || { x0: -3000, z0: -3000, x1: 3000, z1: 3000 };
    let pts = null, seg = 0, along = 0, jx = 0, jz = 0;
    if (cfg.jet) {
      jx = b.x0 + 250; jz = (b.z0 + b.z1) / 2;
      v.heading = v.pheading = 0; v.y = v.py = 90;
    } else pts = H.chain(v, cfg.speed * cfg.seconds * 1.05 + 50);
    for (let i = 0; i < n; i++) {
      if (cfg.jet) {
        jx += cfg.speed * dt;
        if (jx > b.x1 - 250) break;
        v.x = v.px = jx; v.z = v.pz = jz; v.y = v.py = 90; v.heading = v.pheading = 0;
        v.vx = cfg.speed; v.vz = 0; v.speed = cfg.speed;
      } else {
        if (seg + 3 >= pts.length) { seg = 0; along = 0; }
        let l = Math.hypot(pts[seg + 2] - pts[seg], pts[seg + 3] - pts[seg + 1]) || 1;
        while (along > l && seg + 5 < pts.length) { along -= l; seg += 2; l = Math.hypot(pts[seg + 2] - pts[seg], pts[seg + 3] - pts[seg + 1]) || 1; }
        const h = Math.atan2(pts[seg + 3] - pts[seg + 1], pts[seg + 2] - pts[seg]);
        v.x = v.px = pts[seg] + ((pts[seg + 2] - pts[seg]) * along) / l; v.z = v.pz = pts[seg + 1] + ((pts[seg + 3] - pts[seg + 1]) * along) / l;
        v.heading = v.pheading = h;
        v.vx = Math.cos(h) * cfg.speed; v.vz = Math.sin(h) * cfg.speed; v.speed = cfg.speed;
        along += cfg.speed * dt;
      }
      if (cfg.heat && i % 60 === 0) {
        const hh = g.police.heat;
        hh.level = 4; hh.grace = 0; hh.cooldown = 0; hh.unseen = 0;
      }
      P.cur.fill(0);
      const t0 = now();
      g.step(dt);
      const ms = now() - t0;
      stepMs[i] = ms;
      steps++;
      let sum = 0, bi = -1, bm = 0;
      for (let k = 0; k < ns; k++) {
        const c = P.cur[k];
        sysSum[k] += c; sum += c;
        if (c > sysWorst[k]) sysWorst[k] = c;
        if (c > bm) { bm = c; bi = k; }
      }
      coreSum += Math.max(0, ms - sum);
      if (i >= 120 && ms > 4) { over4++; blame[bm >= ms * 0.3 ? bi : ns]++; }
      if (i % cfg.drawEvery === 0) {
        P.curDraw.fill(0);
        const t1 = now();
        g.draw(1, cfg.drawEvery / 60);
        draws[nd++] = now() - t1;
        for (let k = 0; k < ns; k++) drawSys[k] += P.curDraw[k];
      }
      if (i % 30 === 0 && g.vehicles.length > liveMax) liveMax = g.vehicles.length;
      if (cfg.heat && g.police) {
        if (g.police.stars > maxStars) maxStars = g.police.stars;
        if (tankAt < 0 && pst && pst.tanks > tanks0) tankAt = r1(i / 60);
      }
    }
    // Summaries (allocation is fine here: the run is over).
    const sorted = Array.from(stepMs.subarray(0, steps)).sort((x, y) => x - y);
    const mean = sorted.reduce((s, x) => s + x, 0) / Math.max(1, sorted.length);
    const dr = Array.from(draws.subarray(0, nd));
    const seconds = steps / 60;
    const rows = names.map((nm, k) => ({ name: nm, meanMs: r2(sysSum[k] / steps), worstMs: r2(sysWorst[k]), blame: blame[k], drawMeanMs: r2(drawSys[k] / Math.max(1, nd)) }));
    rows.push({ name: 'core', meanMs: r2(coreSum / steps), worstMs: 0, blame: blame[ns], drawMeanMs: 0 });
    rows.sort((a, c) => c.meanMs - a.meanMs);
    const heatInfo = cfg.heat ? {
      stars: g.police.stars,
      tanks: g.vehicles.filter((o) => o.kind === 'tank' && !o.removed && o.spec.police).length,
      maxStars, tanksSpawned: pst ? pst.tanks - tanks0 : 0, firstTankS: tankAt,
      helis: g.vehicles.filter((o) => o.kind === 'heli' && !o.removed && (o.spec.police || o.spec.id === 'patrolheli')).length,
      cars: g.vehicles.filter((o) => o.kind === 'car' && !o.removed).length,
    } : null;
    return {
      seconds: r1(seconds), steps, meanMs: r2(mean), p99Ms: r2(sorted[Math.floor(sorted.length * 0.99)] || 0), worstMs: r2(sorted[sorted.length - 1] || 0),
      over4, over4PerMin: seconds > 2 ? r1((over4 / (seconds - 2)) * 60) : 0,
      drawMedianMs: r1(med(dr)), drawWorstMs: r1(Math.max(0, ...dr)), draws: nd,
      tilesBuilt: st ? st.built - built0 : 0, tilesDropped: st ? st.dropped - dropped0 : 0,
      worstSliceMs: st ? r1(st.worstSliceMs) : 0, newPrograms: programs() - prog0, liveVehicles: liveMax, heat: heatInfo,
      systems: rows.slice(0, 12),
    };
  };

  // A first-use probe: baseline draws, the action, then 48 steps with a draw every 8.
  H.probe = (name, action, during) => {
    const info = g.renderer.info;
    const base = [];
    for (let i = 0; i < 3; i++) { const t = now(); g.draw(1, dt); base.push(now() - t); }
    const p0 = programs(), geo0 = info.memory.geometries, tex0 = info.memory.textures;
    const t0 = now();
    const ok = action();
    const actionMs = now() - t0;
    if (ok === false) return { name, skipped: true };
    const steps = [], draws = [];
    for (let i = 0; i < 48; i++) {
      if (during) during(i);
      const ts = now(); g.step(dt); steps.push(now() - ts);
      if (i % 8 === 0) { const td = now(); g.draw(1, 8 * dt); draws.push(now() - td); }
    }
    const bm = med(base);
    return {
      name, newPrograms: programs() - p0, newGeometries: info.memory.geometries - geo0, newTextures: info.memory.textures - tex0,
      actionMs: r1(actionMs), baselineDrawMs: r1(bm), worstDrawMs: r1(Math.max(...draws)), firstDrawMs: r1(draws[0]),
      drawsOver16: draws.filter((d) => d > 16).length, draws: draws.length, worstStepMs: r1(Math.max(...steps)), stepsOver16: steps.filter((s) => s > 16).length,
    };
  };
  H.probes = () => {
    const out = [];
    H.toSpawnCar('sedan');
    const p = g.player;
    out.push(H.probe('first blast', () => { const h = p.heading; g.combat.explode(p.x + Math.cos(h) * 14, 0.5, p.z + Math.sin(h) * 14, 9); return true; }));
    out.push(H.probe('first shot on foot', () => {
      H.leave();
      const w = p.walker;
      w.x = w.px = p.x; w.z = w.pz = p.z;
      return !!w.arms;
    }, (i) => { if (i < 6 && p.walker.arms) g.combat.fire(p.walker, Math.cos(p.walker.heading || 0), 0, Math.sin(p.walker.heading || 0)); }));
    for (const [nm, kind] of [['first boat', 'boat'], ['first helicopter', 'heli'], ['first plane', 'plane']]) {
      out.push(H.probe(nm, () => !!H.enterKind(kind), () => { src.throttle = 1; }));
      src.throttle = 0;
    }
    return out;
  };
}

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------
const args = process.argv.slice(2);
const flag = (k) => args.includes(k);
const opt = (k, d) => {
  const i = args.indexOf(k);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : d;
};

async function loadChromium() {
  try {
    return (await import('playwright')).chromium;
  } catch {
    return createRequire('/opt/node-tools/node_modules/')('playwright').chromium;
  }
}

async function openPage(browser, url, { throttle = 1, sys = false, profile = false } = {}) {
  const page = await browser.newPage({ viewport: { width: 915, height: 412 }, hasTouch: true, isMobile: true, deviceScaleFactor: 1 });
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  await page.addInitScript(initHook, { sys });
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: throttle });
  if (profile) {
    await cdp.send('Profiler.enable');
    await cdp.send('Profiler.setSamplingInterval', { interval: 500 });
    await cdp.send('Profiler.start');
  }
  await page.goto(url);
  await page.waitForFunction(() => window.__rw && window.__rw.loop.running, null, { timeout: 300000, polling: 50 });
  return { page, cdp, errors };
}

async function measureStart(browser, url, throttle, sys) {
  const { page, cdp, errors } = await openPage(browser, url, { throttle, sys });
  await page.waitForTimeout(3000 * Math.min(throttle, 2));
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
  await cdp.send('HeapProfiler.collectGarbage');
  await cdp.send('HeapProfiler.collectGarbage');
  const info = await page.evaluate(() => {
    const g = window.__rw, P = window.__rwProf;
    const m = performance.memory;
    return {
      startMs: Math.round(P.startMs), firstDrawMs: Math.round(P.firstDrawMs), programsAtFirstDraw: P.programsAtFirstDraw,
      programs: g.renderer.info.programs ? g.renderer.info.programs.length : 0,
      cityMs: g.city.buildMs, tileMs: Math.round(g.cityMesh.userData.buildMs || 0), tileTimings: g.cityMesh.userData.timings || null,
      memMb: m ? Math.round((m.usedJSHeapSize / 1048576) * 10) / 10 : null, memTotalMb: m ? Math.round(m.totalJSHeapSize / 1048576) : null,
      firstStepMs: Math.round(P.firstStep * 10) / 10, map: g.city.map, vehicles: g.vehicles.length,
    };
  });
  const metrics = await cdp.send('Performance.getMetrics').catch(() => null);
  if (metrics) {
    const hu = metrics.metrics.find((x) => x.name === 'JSHeapUsedSize');
    if (hu) info.cdpHeapMb = Math.round((hu.value / 1048576) * 10) / 10;
  }
  return { page, info, errors };
}

async function profileStart(browser, url, throttle) {
  const { page, cdp, errors } = await openPage(browser, url, { throttle, profile: true });
  await page.waitForTimeout(2000 * throttle);
  const { profile } = await cdp.send('Profiler.stop');
  const startMs = await page.evaluate(() => Math.round(window.__rwProf.startMs));
  await page.close();
  return { groups: profileGroups(profile), startMs, errors };
}

function fmt(v, d = 0) {
  return v === null || v === undefined || Number.isNaN(v) ? 'n/a' : Number(v).toFixed(d);
}
function table(rows, head) {
  const all = [head, ...rows].map((r) => r.map((c) => String(c)));
  const w = head.map((_, i) => Math.max(...all.map((r) => r[i].length)));
  return all.map((r, k) => r.map((c, i) => (i === 0 ? c.padEnd(w[i]) : c.padStart(w[i]))).join('  ') + (k === 0 ? '\n' + w.map((x) => '-'.repeat(x)).join('  ') : '')).join('\n');
}

function printReport(res) {
  const s1 = res.start.x1, s4 = res.start.x4;
  console.log('\nStart (page load to running)');
  const prof1 = res.profile && res.profile.x1, prof4 = res.profile && res.profile.x4;
  const rows = [['page load to running, ms', s1.startMs, s4 ? s4.startMs : 'n/a'],
    ['first draw (compile), ms', s1.firstDrawMs, s4 ? s4.firstDrawMs : 'n/a'],
    ['shader programs at first draw / now', `${s1.programsAtFirstDraw} / ${s1.programs}`, s4 ? `${s4.programsAtFirstDraw} / ${s4.programs}` : 'n/a'],
    ['city build, ms', s1.cityMs, s4 ? s4.cityMs : 'n/a'],
    ['tile renderer build, ms', s1.tileMs, s4 ? s4.tileMs : 'n/a'],
    ['first step of play, ms', s1.firstStepMs, s4 ? s4.firstStepMs : 'n/a'],
    ['memory after collection, MB', fmt(s1.memMb, 1), s4 ? fmt(s4.memMb, 1) : 'n/a']];
  if (prof1) {
    const g = (p, k) => (p ? p.groups[k] : 'n/a');
    for (const [k, label] of [['city', 'profile: city build, ms'], ['tiles', 'profile: tile renderer, ms'], ['textures', 'profile: textures (in tiles), ms'], ['fleet', 'profile: createFleet, ms'], ['explore', 'profile: attachExplore, ms'], ['mapui', 'profile: map UI, ms'], ['programs', 'profile: shader programs, ms']]) rows.push([label, g(prof1, k), g(prof4, k)]);
  }
  console.log(table(rows, ['measure', '1x', '4x']));
  console.log('\nFirst-use probes (software renderer: draws are slow, so look at programs and step time)');
  console.log(table(res.probes.map((p) => (p.skipped ? [p.name, 'skipped', '', '', '', '', ''] : [p.name, p.newPrograms, p.newGeometries, p.baselineDrawMs, p.worstDrawMs, p.worstStepMs, `${p.drawsOver16}/${p.draws}, ${p.stepsOver16}/48`])),
    ['probe', 'new prog', 'new geom', 'base draw', 'worst draw', 'worst step', 'over 16ms (draws, steps)']));
  console.log('\nScenarios (ms per step; wrappers add a few microseconds a call)');
  const sc = Object.entries(res.scenarios);
  console.log(table(sc.map(([k, r]) => (r.skipped ? [k, r.skipped] : [k, r.seconds, r.meanMs, r.p99Ms, r.worstMs, r.over4PerMin, r.drawMedianMs, r.tilesBuilt, r.tilesDropped, r.worstSliceMs, r.liveVehicles])),
    ['scenario', 'sim s', 'mean', 'p99', 'worst', '>4ms/min', 'draw med', 'built', 'dropped', 'slice', 'vehicles']));
  for (const [k, r] of sc) {
    if (r.skipped) continue;
    const top = r.systems.slice(0, 5).map((x) => `${x.name} ${x.meanMs}${x.blame ? ` (blamed ${x.blame})` : ''}`).join(', ');
    console.log(`  ${k}: ${top}${r.heat ? `; heat: ${r.heat.stars} stars at the end (best ${r.heat.maxStars}), ${r.heat.tanksSpawned} tanks spawned (first at ${r.heat.firstTankS} s, ${r.heat.tanks} out at the end), ${r.heat.helis} helis` : ''}`);
  }
  console.log(`\nStreet view at the start place: ${res.street.calls} calls, ${res.street.tris} triangles, ${res.street.programs} programs, ${res.street.vehicles} vehicles`);
}

function buildMetrics(res) {
  const m = {};
  const s1 = res.start.x1, s4 = res.start.x4;
  m.start_ms_1x = s1.startMs;
  if (s4) m.start_ms_4x = s4.startMs;
  m.build_ms_1x = s1.cityMs + s1.tileMs;
  if (s1.memMb !== null) m.mem_mb_1x = s1.memMb;
  m.programs_start = s1.programs;
  m.first_step_ms = s1.firstStepMs;
  m.programs_new_in_play = res.probes.reduce((a, p) => a + (p.newPrograms || 0), 0);
  const scs = Object.values(res.scenarios).filter((r) => !r.skipped);
  m.over4_per_min = Math.max(0, ...scs.map((r) => r.over4PerMin));
  m.worst_tile_slice_ms = Math.max(0, ...scs.map((r) => r.worstSliceMs));
  if (res.scenarios.jet && !res.scenarios.jet.skipped) m.jet_tiles_built = res.scenarios.jet.tilesBuilt;
  if (res.scenarios.cruise && !res.scenarios.cruise.skipped) m.live_vehicles = res.scenarios.cruise.liveVehicles;
  m.street_calls = res.street.calls;
  m.street_tris = res.street.tris;
  return m;
}

function printChecks(results, milestone) {
  console.log(`\nBudgets for ${milestone}`);
  console.log(table(results.map((r) => [r.key, r.check, r.value === null ? 'not measured' : r.value, r.limit, r.ok ? 'ok' : 'FAIL']), ['budget', 'check', 'value', 'limit', '']));
  const bad = results.filter((r) => !r.ok);
  console.log(bad.length ? `${bad.length} budget(s) missed: ${bad.map((r) => r.key).join(', ')}` : 'all budgets met');
  return bad.length === 0;
}

async function main() {
  const check = flag('--check');
  const budgets = parseBudgets(await readFile(join(root, 'docs/PERF.md'), 'utf8'));
  const milestone = opt('--milestone', budgets.current);
  if (!milestone || !budgets.milestones.includes(milestone)) throw new Error(`no budget column for milestone ${milestone} in docs/PERF.md`);
  const from = opt('--from', null);
  let res;
  if (from) {
    res = JSON.parse(await readFile(resolve(from), 'utf8'));
  } else {
    res = await measure();
    const out = resolve(opt('--out', join(root, 'shots/perf-scenarios.json')));
    await mkdir(dirname(out), { recursive: true });
    await writeFile(out, JSON.stringify(res, null, 1));
    console.log(`\nwrote ${out}`);
  }
  printReport(res);
  const results = checkBudgets(budgets, res.metrics, milestone);
  const ok = printChecks(results, milestone);
  const errs = res.errors || [];
  if (errs.length) console.log(`\n${errs.length} page error(s):\n  ${errs.slice(0, 5).join('\n  ')}`);
  if (check && (!ok || errs.length)) process.exitCode = 1;
}

async function measure() {
  const quick = flag('--quick');
  const drawEvery = Number(opt('--draw-every', 15));
  const chromium = await loadChromium();
  const tmp = await mkdtemp(join(tmpdir(), 'rw-perf-'));
  const minDir = join(tmp, 'min'), devDir = join(tmp, 'dev');
  await buildGame({ minify: true, outDir: minDir });
  const servers = [await serve(0, minDir)];
  if (!flag('--no-profile')) {
    await buildGame({ minify: false, outDir: devDir });
    servers.push(await serve(0, devDir));
  }
  const minUrl = `http://127.0.0.1:${servers[0].address().port}/?autostart`;
  const devUrl = servers[1] ? `http://127.0.0.1:${servers[1].address().port}/?autostart` : null;
  const browser = await chromium.launch({ args: LAUNCH_ARGS });
  const errors = [];
  const res = { start: {}, profile: null, probes: [], scenarios: {}, street: null, metrics: {}, errors };
  try {
    // 1. The start at 4x first (separate load), then the 1x load that also runs everything else.
    if (!flag('--no-4x')) {
      console.log('start at 4x throttle ...');
      const r4 = await measureStart(browser, minUrl, 4, true);
      res.start.x4 = r4.info;
      errors.push(...r4.errors);
      await r4.page.close();
    }
    console.log('start at 1x ...');
    const r1 = await measureStart(browser, minUrl, 1, true);
    res.start.x1 = r1.info;
    const page = r1.page;
    await page.evaluate(installHelpers);
    res.street = await page.evaluate(() => window.__pf.street());
    console.log('first-use probes ...');
    res.probes = await page.evaluate(() => window.__pf.probes());
    // 2. Scenarios.
    const dur = quick ? { cruise: 12, fast: 12, heat: 30, jet: 100 } : { cruise: 30, fast: 30, heat: 60, jet: 100 };
    const defs = {
      cruise: { seconds: dur.cruise, speed: 20 },
      fast: { seconds: dur.fast, speed: 50 },
      heat: { seconds: dur.heat, speed: 20, heat: true },
      jet: { seconds: dur.jet, speed: 220, jet: true },
    };
    for (const [name, d] of Object.entries(defs)) {
      console.log(`scenario ${name} ...`);
      res.scenarios[name] = await page.evaluate((cfg) => window.__pf.run(cfg), { ...d, drawEvery: name === 'jet' ? Math.min(drawEvery, 12) : drawEvery });
    }
    errors.push(...r1.errors);
    await page.close();
    // 3. The CPU-profile breakdown of the start (unminified build).
    if (devUrl) {
      res.profile = { x1: null, x4: null };
      console.log('profile at 1x ...');
      res.profile.x1 = await profileStart(browser, devUrl, 1);
      errors.push(...res.profile.x1.errors);
      if (!flag('--no-4x')) {
        console.log('profile at 4x ...');
        res.profile.x4 = await profileStart(browser, devUrl, 4);
        errors.push(...res.profile.x4.errors);
      }
    }
  } finally {
    await browser.close();
    for (const s of servers) s.close();
    await rm(tmp, { recursive: true, force: true });
  }
  res.errors = [...new Set(errors)];
  res.metrics = buildMetrics(res);
  return res;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().then(() => process.exit(process.exitCode || 0), (e) => { console.error(e); process.exit(1); });
}
