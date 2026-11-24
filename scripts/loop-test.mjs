// Plays the loop (docs/LOOP.md) in headless Chromium at the owner's phone
// size (748x360): a new game, the first five minutes with simulated input
// (a steering, gas and brake source like a thumb would give), one event of
// each template, then the medals, the records and the save. Screenshots of
// every beat go to --shots (default shots/loop). The game is built into
// --dist (default: a folder in the system temp directory), never into dist/.
//   node scripts/loop-test.mjs [--dist dir] [--shots dir] [--map miami-beach]
import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { buildGame, serve } from './build.mjs';

let chromium;
try {
  ({ chromium } = await import('playwright'));
} catch {
  ({ chromium } = createRequire('/opt/node-tools/node_modules/')('playwright'));
}
const arg = (name, dflt) => {
  const i = process.argv.indexOf('--' + name);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : dflt;
};
const dist = resolve(arg('dist', join(tmpdir(), 'rustwater-loop-test')));
const shots = resolve(arg('shots', 'shots/loop'));
const map = arg('map', '');
await mkdir(shots, { recursive: true });
await buildGame({ minify: false, outDir: dist });
const server = await serve(0, dist);
const port = server.address().port;
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 748, height: 360 }, hasTouch: true, isMobile: true, deviceScaleFactor: 1 });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

let failed = false;
const check = (ok, label) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}`);
  if (!ok) failed = true;
};
const url = `http://127.0.0.1:${port}/` + (map ? `?map=${map}` : '');

// The in-page driver: a source of steer, gas and brake that follows the GPS
// line (or heads for a point), passes or rams traffic, and backs out when stuck.
const installDriver = () => {
  const g = window.__rw;
  const src = g.input.addSource({ steer: 0, throttle: 0, brake: 0, handbrake: false });
  const st = { stuck: 0, rev: 0, revSteer: 0, revs: 0, stucks: 0, lx: 0, lz: 0, lt: 0, toasts: [], steps: 0, ms: 0, worst: 0 };
  const toast0 = g.hud.toast;
  g.hud.toast = (t, s, k) => { st.toasts.push([Math.round(g.time * 10) / 10, k || '', String(t)]); toast0(t, s, k); };
  function ahead(dist) {
    const tr = g.objective.tracker, r = tr.route;
    if (!tr.active || !r.ok || r.n < 2) return null;
    const want = Math.min(r.length, tr.along + dist);
    let i = Math.max(0, tr.seg);
    while (i + 2 < r.n && r.cum[i + 1] < want) i++;
    const l = r.cum[i + 1] - r.cum[i] || 1;
    const t = Math.max(0, Math.min(1, (want - r.cum[i]) / l));
    return { x: r.x[i] + (r.x[i + 1] - r.x[i]) * t, z: r.z[i] + (r.z[i + 1] - r.z[i]) * t };
  }
  // o: { to: {x, z} (when there is no GPS line), cruise (m/s), pass, ram, line: {x, z, dx, dz} (hold a straight line) }
  function drive(o) {
    const v = g.player.vehicle;
    if (!v) { src.throttle = 0; src.brake = 0; src.steer = 0; return; }
    const sp = Math.abs(v.speed);
    const fx = Math.cos(v.heading), fz = Math.sin(v.heading);
    let pt;
    if (o.line) {
      const a = (v.x - o.line.x) * o.line.dx + (v.z - o.line.z) * o.line.dz + 14 + sp * 0.7;
      const h = o.hug || 0; // m to the right of the line: toward the parked row
      pt = { x: o.line.x + o.line.dx * a - o.line.dz * h, z: o.line.z + o.line.dz * a + o.line.dx * h };
    } else pt = ahead(Math.max(7, Math.min(20, 5 + sp * 0.6))) || o.to || null;
    let cruise = o.cruise || 19;
    // Slow down for the next turn of the GPS line.
    const tr = g.objective.tracker;
    if (!o.line && tr.active && tr.route.ok) {
      const t = tr.next();
      if (t && t.kind !== 'arrive' && t.kind !== 'depart' && tr.toTurn < 14 + sp * 1.6) cruise = Math.min(cruise, 7);
    }
    let side = 0;
    if (o.ram) {
      let best = null, bd = 90;
      for (const c of g.vehicles) {
        if (c === v || c.kind !== 'car' || !c.driver || c.wrecked) continue;
        const d = Math.hypot(c.x - v.x, c.z - v.z);
        if (d < bd && (c.x - v.x) * fx + (c.z - v.z) * fz > -4) { bd = d; best = c; }
      }
      if (best) pt = { x: best.x, z: best.z };
    } else {
      // Traffic ahead in the way: go round it (pass) or hold back behind it.
      for (const c of g.vehicles) {
        if (c === v || c.kind !== 'car' || c.wrecked) continue;
        const dx = c.x - v.x, dz = c.z - v.z;
        const al = dx * fx + dz * fz, lat = -dx * fz + dz * fx;
        if (al < 2 || al > 10 + sp * 1.3 || Math.abs(lat) > 2.3) continue;
        if (o.pass || !c.driver) side = lat >= 0 ? -3.3 : 3.3;
        else cruise = Math.min(cruise, Math.max(3, Math.abs(c.speed || 0) + (al - 9) * 0.5));
      }
    }
    if (!pt) { src.throttle = 0; src.brake = 0.4; src.steer = 0; return; }
    if (side) { pt = { x: pt.x - fz * side, z: pt.z + fx * side }; }
    let err = Math.atan2(pt.z - v.z, pt.x - v.x) - v.heading;
    err = Math.atan2(Math.sin(err), Math.cos(err));
    const want = Math.max(5, cruise - cruise * 0.75 * Math.min(1, Math.abs(err) / 0.7));
    if (st.rev > 0) {
      st.rev -= 1 / 60;
      src.throttle = 0; src.brake = 1; src.steer = st.revSteer;
      return;
    }
    src.steer = Math.max(-1, Math.min(1, err * 2.4));
    src.throttle = sp < want ? 1 : 0;
    src.brake = sp > want + 4 ? 0.8 : 0;
    // Stuck (standing, or no ground made in four seconds): back out, the other way each time.
    st.lt += 1 / 60;
    if (st.lt >= 4) {
      if (Math.hypot(v.x - st.lx, v.z - st.lz) < 4) st.stuck = 9;
      st.lt = 0; st.lx = v.x; st.lz = v.z;
    }
    if (sp < 0.8) st.stuck += 1 / 60;
    else if (st.stuck < 9) st.stuck = 0;
    if (st.stuck > 1.6) {
      st.stuck = 0;
      st.revs++;
      st.stucks++;
      st.rev = 1.6 + (st.revs % 3) * 0.6;
      st.revSteer = (st.revs % 2 ? -1 : 1) * Math.sign(err || 1) * 0.9;
    }
  }
  // Stop and stand (the brake held at a standstill would reverse the car).
  function idle() {
    const v = g.player.vehicle;
    const moving = !!v && Math.abs(v.speed) > 0.4;
    src.throttle = 0; src.brake = moving ? 1 : 0; src.handbrake = !moving; src.steer = 0;
  }
  // Run the simulation: `o` as drive(), o.until(g) ends it, o.seconds caps it.
  function run(o) {
    const n = Math.round((o.seconds || 10) * 60);
    let i = 0;
    const v0 = g.player.vehicle;
    st.stuck = 0; st.rev = 0; st.lt = 0; st.lx = v0 ? v0.x : 0; st.lz = v0 ? v0.z : 0; st.stucks = 0;
    src.handbrake = false;
    for (; i < n; i++) {
      if (o.brake) idle(); else drive(o);
      const a = performance.now();
      g.step(1 / 60);
      const d = performance.now() - a;
      st.ms += d; st.steps++;
      if (d > st.worst) st.worst = d;
      if (o.until && o.until(g)) break;
    }
    return i / 60;
  }
  const draw = () => { for (let i = 0; i < 10; i++) g.draw(1, 0.1); };
  // A point 30 m past the gate (or the place) the GPS is on: where to head once the GPS lets go near it.
  const beyond = () => {
    const t = g.streetEvents.tracked;
    return t ? { x: t.x + (t.dx || 0) * 30, z: t.z + (t.dz || 0) * 30 } : null;
  };
  window.__lt = { st, drive, run, draw, src, beyond };
  return true;
};

// A screenshot of the moment (the camera is settled first). Software
// rendering at night can take very long: a shot that cannot be taken is
// reported and the run goes on.
const snap = async (name) => {
  try {
    await page.screenshot({ path: join(shots, name + '.png'), timeout: 180000 });
  } catch (e) {
    console.log('   (no screenshot ' + name + ': ' + String(e.message).split('\n')[0] + ')');
  }
};
const shot = async (name) => {
  await page.evaluate(() => window.__lt.draw());
  await page.waitForTimeout(250);
  await snap(name);
};
const state = () => page.evaluate(() => {
  const g = window.__rw, se = g.streetEvents, f = g.flow;
  const r = se.lastResult;
  return {
    t: Math.round(g.time * 10) / 10, step: g.tutorial.introStep, on: g.tutorial.introOn, line: g.tutorial.lastLine,
    active: se.active ? se.active.ev.id : '', count: se.active ? se.active.count : 0,
    last: r ? { id: r.id, tpl: r.tpl, result: r.result, medal: r.medal, value: Math.round(r.value * 10) / 10, why: r.why, daily: r.daily } : null,
    run: f.run, tier: f.tier, stars: g.police.stars, score: g.score.total, x: Math.round(g.player.x), z: Math.round(g.player.z),
    mph: g.player.vehicle ? Math.round(Math.abs(g.player.vehicle.speed) * 2.237) : -1, prompt: document.querySelector('.rw-prompt').textContent,
    retry: !document.querySelector('.rw-a-eventretry').classList.contains('rw-off'), errs: g.errors.count || 0,
  };
});

try {
  // ---- a new game through the title ----
  await page.goto(url);
  await page.evaluate(() => localStorage.clear());
  await page.goto(url);
  await page.waitForFunction(() => window.__rw && document.getElementById('play') && !document.getElementById('play').disabled, null, { timeout: 120000 });
  await snap('00-title');
  await page.tap('#play');
  await page.waitForFunction(() => window.__rw.loop.running && !(window.__rw.titleCam && window.__rw.titleCam.active), null, { timeout: 30000 });
  // First run: the steering question (take the wheel).
  await page.waitForTimeout(400);
  if (await page.evaluate(() => window.__rw.menu.isAsking())) await page.tap('.rw-menu-ask [data-steering="wheel"]');
  await page.evaluate(() => window.__rw.loop.stop());
  await page.evaluate(installDriver);
  const info = await page.evaluate(() => {
    const g = window.__rw, se = g.streetEvents;
    const n = {};
    for (const e of se.list) n[e.tpl] = (n[e.tpl] || 0) + 1;
    return { map: g.city.mapId, events: se.list.length, n, first: se.list[0].id, street: se.list[0].street, parked: Math.abs(g.player.vehicle.speed) < 0.5, daily: g.daily.picks.map((p) => p.ev.id + ' ' + p.twist.text) };
  });
  console.log('map', info.map, 'events', info.events, JSON.stringify(info.n), 'daily', JSON.stringify(info.daily));
  check(info.events >= 20 && info.events <= 40, `20 to 40 street events in the region (${info.events})`);
  check(Object.keys(info.n).length === 6, 'all six templates are placed');
  check(info.parked, 'a new game starts in a parked car');

  // ---- beat 1: the first line and the gate ahead ----
  await page.evaluate(() => window.__lt.run({ brake: true, seconds: 1.2 }));
  let s = await state();
  check(s.on && s.step === 'run' && /GAS/.test(s.line), `intro line 1 is up within 2 s: "${s.line}"`);
  await shot('01-start-line');
  const t0 = s.t;
  await page.evaluate(() => { const e = window.__rw.streetEvents.list[0]; window.__lt.run({ seconds: 30, cruise: 20, pass: true, line: { x: e.x, z: e.z, dx: e.dx, dz: e.dz }, until: (g) => !!g.streetEvents.active }); });
  s = await state();
  check(s.active === info.first && s.t - t0 <= 20, `pulled into the first near-miss run within 20 s (${(s.t - t0).toFixed(1)} s, ${s.active})`);
  await shot('02-traffic-run');

  // ---- beat 2: a first medal within 2 minutes (RETRY when it takes two goes) ----
  const gate = await page.evaluate(() => { const e = window.__rw.streetEvents.list[0]; return { x: e.x, z: e.z, dx: e.dx, dz: e.dz }; });
  let medal = null;
  for (let go = 0; go < 4 && !medal; go++) {
    await page.evaluate((line) => window.__lt.run({ seconds: 50, cruise: 22, pass: true, line, hug: 0.55, until: (g) => !g.streetEvents.active }), gate);
    s = await state();
    medal = s.last && s.last.medal;
    console.log(`   run ${go + 1}: ${JSON.stringify(s.last)} at ${s.t} s`);
    if (!medal) {
      await page.evaluate(() => window.__lt.run({ brake: true, seconds: 0.1 }));
      s = await state();
      check(s.retry, 'RETRY is offered after a run without a medal');
      if (go === 0) await shot('03-no-medal-retry');
      await page.tap('.rw-a-eventretry');
      await page.evaluate((line) => window.__lt.run({ seconds: 8, cruise: 17, pass: true, line, until: (g) => !!g.streetEvents.active }), gate);
    }
  }
  check(!!medal, `a first medal (${medal}) at ${s.t} s`);
  check(s.t - t0 <= 120, `the first medal comes within 2 minutes (${(s.t - t0).toFixed(1)} s)`);
  await shot('03-first-medal');

  // ---- beat 3: the police, and an escape ----
  await page.evaluate(() => window.__lt.run({ brake: true, seconds: 7 }));
  s = await state();
  check(s.step === 'police', `the intro moves on to the police beat (${s.step}): "${s.line}"`);
  await shot('04-to-red-gate');
  let escaped = false;
  for (let go = 0; go < 3 && !escaped; go++) {
    await page.evaluate(() => window.__lt.run({ seconds: 120, cruise: 18, to: window.__lt.beyond(), until: (g) => !!g.streetEvents.active || g.tutorial.introStep !== 'police' }));
    s = await state();
    if (go === 0) { console.log(`   toward the red gate: ${s.active || s.step} at ${s.t} s, stars ${s.stars}`); await shot('05-police'); }
    // Away from them: a far corner of the region by GPS, as fast as the car goes.
    await page.evaluate(() => {
      const g = window.__rw, p = g.player, c = g.city.crop;
      const far = [[c.x0 + 400, c.z0 + 400], [c.x1 - 400, c.z1 - 400], [c.x0 + 400, c.z1 - 400], [c.x1 - 400, c.z0 + 400]]
        .sort((a, b) => Math.hypot(b[0] - p.x, b[1] - p.z) - Math.hypot(a[0] - p.x, a[1] - p.z))[1];
      g.waypoint = { x: far[0], z: far[1] };
      window.__lt.run({ seconds: 100, cruise: 24, until: (g2) => g2.tutorial.introStep !== 'police' });
      g.waypoint = null;
    });
    s = await state();
    escaped = s.step !== 'police';
    console.log(`   escape ${go + 1}: step ${s.step}, last ${JSON.stringify(s.last)} at ${s.t} s, stars ${s.stars}`);
  }
  check(escaped, `met the police and escaped (${s.t} s)`);
  await shot('06-escaped');

  // ---- beat 4: the ramp ----
  await page.evaluate(() => window.__lt.run({ brake: true, seconds: 6 }));
  s = await state();
  check(s.step === 'ramp', `the intro points at a ramp (${s.step}): "${s.line}"`);
  let jumped = false;
  for (let go = 0; go < 3 && !jumped; go++) {
    const drove = await page.evaluate(() => {
      const g = window.__rw, lt = window.__lt, se = g.streetEvents;
      lt.run({ seconds: 150, cruise: 18, to: lt.beyond(), until: () => !!se.active || g.tutorial.introStep !== 'ramp' || lt.st.stucks >= 4 });
      // The simple driver can wedge itself against a wall. A player would back out; it takes the RETRY kind of help.
      if (!se.active && g.tutorial.introStep === 'ramp' && se.tracked && se.tracked.id) {
        const ev = se.tracked;
        se.stage(ev);
        lt.run({ seconds: 12, cruise: 20, line: { x: ev.x, z: ev.z, dx: ev.dx, dz: ev.dz }, until: () => !!se.active });
        return 'staged at the gate after ' + lt.st.stucks + ' stucks';
      }
      return 'drove there';
    });
    s = await state();
    console.log('   to the purple gate: ' + drove + ' (' + s.t + ' s)');
    if (go === 0) await shot('07-purple-gate');
    await page.evaluate(() => {
      const g = window.__rw, ev = g.streetEvents.active ? g.streetEvents.active.ev : null;
      if (!ev) return;
      const line = { x: ev.x, z: ev.z, dx: ev.dx, dz: ev.dz };
      window.__lt.run({ seconds: 20, cruise: 40, line, until: (g2) => !!(g2.player.vehicle && g2.player.vehicle.air && g2.player.vehicle.air.on && g2.player.vehicle.air.t > 0.35) || !g2.streetEvents.active });
    });
    if (go === 0) await shot('08-air');
    await page.evaluate(() => window.__lt.run({ seconds: 8, cruise: 12, until: (g) => !g.streetEvents.active }));
    s = await state();
    jumped = s.step !== 'ramp';
    console.log(`   jump ${go + 1}: ${JSON.stringify(s.last)} step ${s.step}`);
    if (!jumped && s.retry) await page.tap('.rw-a-eventretry');
  }
  check(jumped, `found a ramp and flew it (${s.last && s.last.value} ft, ${s.last && s.last.medal})`);

  // ---- beat 5: the nearest garage ----
  await page.evaluate(() => window.__lt.run({ brake: true, seconds: 6 }));
  s = await state();
  check(s.step === 'garage', `the intro points at the nearest garage (${s.step}): "${s.line}"`);
  await shot('09-to-garage');
  const toGarage = await page.evaluate(() => {
    const g = window.__rw, lt = window.__lt;
    let how = 'drove there';
    for (let k = 0; k < 3 && g.tutorial.introOn; k++) {
      lt.run({ seconds: 150, cruise: 18, to: lt.beyond(), until: () => !g.tutorial.introOn || lt.st.stucks >= 4 });
      if (g.tutorial.introOn && lt.st.stucks >= 4) {
        // Wedged: RESPAWN (the game's own button), then the nearest car, as a player would.
        g.respawnPlayer();
        lt.run({ brake: true, seconds: 1 });
        const p = g.player;
        const near = g.vehicles.filter((c) => c.kind === 'car' && !c.wrecked && !c.driver).sort((a, b) => Math.hypot(a.x - p.x, a.z - p.z) - Math.hypot(b.x - p.x, b.z - p.z))[0];
        if (near) g.enterVehicle(near);
        how = 'respawned and took the nearest car';
      }
    }
    return how;
  });
  s = await state();
  console.log('   to the garage: ' + toGarage + ' (' + s.t + ' s)');
  check(!s.on, `the intro ends at the garage (${s.t} s, ${((s.t - t0) / 60).toFixed(1)} min from the start)`);
  await shot('10-garage-done');

  // ---- one event of each template (the ones not played yet), staged like a retry ----
  const played = await page.evaluate(() => Object.keys(window.__rw.progress.loop.events));
  const done = new Set(played.map((id) => id.split('_')[2]));
  for (const tpl of ['trap', 'miss', 'jump', 'dash', 'heat', 'wreck']) {
    if (done.has(tpl) && tpl !== 'trap') continue;
    const r = await page.evaluate((tpl) => {
      const g = window.__rw, se = g.streetEvents, lt = window.__lt;
      const out = [];
      const list = se.list.filter((e) => e.tpl === tpl && !e.intro);
      for (let k = 0; k < Math.min(3, list.length); k++) {
        const ev = list[k];
        lt.run({ brake: true, seconds: 1.5 });
        if (!se.stage(ev)) { out.push('stage refused'); continue; }
        const line = { x: ev.x, z: ev.z, dx: ev.dx, dz: ev.dz };
        lt.run({ seconds: 12, cruise: 20, line, until: () => !!se.active });
        if (!se.active) { out.push('no start'); continue; }
        const o = { seconds: ev.limit + 5, until: () => !se.active };
        if (tpl === 'trap' || tpl === 'jump') { o.line = line; o.cruise = 45; } else if (tpl === 'wreck') { o.ram = true; o.cruise = 20; o.to = { x: ev.x + ev.dx * 300, z: ev.z + ev.dz * 300 }; } else if (tpl === 'miss') { o.line = line; o.pass = true; o.cruise = 22; } else { o.cruise = tpl === 'heat' ? 28 : 21; o.pass = true; }
        if (tpl === 'heat') { const c = g.city.crop; g.waypoint = { x: (c.x0 + c.x1) / 2, z: (c.z0 + c.z1) / 2 }; }
        lt.run(o);
        g.waypoint = null;
        const res = se.lastResult;
        out.push(ev.id + ' ' + res.result + ' ' + (res.medal || 'no medal') + ' ' + (Math.round(res.value * 10) / 10) + ' ' + (res.why || '') + ' targets ' + JSON.stringify(ev.targets));
        if (res.result === 'done') break;
      }
      return out;
    }, tpl);
    console.log('   ' + tpl + ': ' + r.join(' | '));
    check(r.some((x) => / done /.test(x)), `a ${tpl} event was completed`);
    if (tpl === 'trap') await shot('11-speed-trap-result');
    if (tpl === 'dash') await shot('12-rush-drop-result');
    if (tpl === 'wreck') await shot('13-wrecking-result');
  }

  // ---- flow: build a run, then stop to bank it ----
  const bank = await page.evaluate(() => {
    const g = window.__rw;
    const before = g.score.total;
    g.flow.feed('nearMiss', 150, 'Near miss');
    g.flow.feed('nearMiss', 150, 'Near miss x2');
    g.flow.feed('nearMiss', 150, 'Near miss x3');
    g.flow.feed('nearMiss', 150, 'Near miss x4');
    g.flow.feed('nearMiss', 150, 'Near miss x5');
    const tier = g.flow.tier, run = g.flow.run;
    g.hudState.pending = run; g.hudState.combo = tier; g.hudState.flow = g.flow.meter; g.hudState.flowTier = tier;
    return { before, tier, run };
  });
  await shot('14-flow-x2');
  const banked = await page.evaluate(() => {
    const g = window.__rw;
    if (g.police.heat.level > 0) { g.police.heat.level = 0; g.police.heat.points = 0; }
    window.__lt.run({ brake: true, seconds: 6, until: (g2) => g2.flow.run === 0 });
    return { total: g.score.total, run: g.flow.run, tier: g.flow.tier, best: g.progress.loop.flow };
  });
  check(bank.tier >= 2 && bank.run > 0, `five near misses raise the multiplier (x${bank.tier}, run ${bank.run})`);
  check(banked.run === 0 && banked.total >= bank.before + bank.run, `stopping banks the run with the tier bonus (${bank.before} + ${bank.run} -> ${banked.total})`);
  await shot('15-banked');

  // ---- records, save ----
  const rec = await page.evaluate(() => {
    const g = window.__rw;
    g.economy.save();
    const saved = JSON.parse(localStorage.getItem('rustwater.save.v1'));
    const L = saved.loop;
    const byTpl = {};
    for (const id of Object.keys(L.events)) { const t = id.split('_')[2]; byTpl[t] = byTpl[t] || L.events[id].m || 'tried'; if (L.events[id].m) byTpl[t] = L.events[id].m; }
    return { byTpl, intro: L.intro, flow: L.flow, totals: L.totals, driven: L.driven, dist: L.dist, best: L.best, score: saved.score.total, size: JSON.stringify(saved).length };
  });
  console.log('   saved', JSON.stringify(rec));
  check(Object.keys(rec.byTpl).length === 6, `the save holds a result for all six templates (${JSON.stringify(rec.byTpl)})`);
  check(Object.values(rec.byTpl).filter((m) => m !== 'tried').length >= 4, 'medals on at least four templates');
  check(rec.intro.done === true, 'the save remembers the intro is done');
  check(Object.values(rec.flow).some((v) => v > 0) && rec.totals.banked > 0, 'the best flow run and the banked total are saved');
  check(rec.driven.length >= 1 && Object.values(rec.dist).some((v) => v > 500), 'vehicles driven and the distance are saved');
  check(rec.size < 20000, `the save stays small (${rec.size} bytes)`);

  // ---- the screens: Records (two taps from play), Daily, Customize ----
  await page.evaluate(() => window.__rw.loop.start());
  await page.tap('.rw-pause');
  await page.waitForTimeout(300);
  await shot('16-pause-hub');
  await page.tap('[data-role="records"]');
  await page.waitForTimeout(200);
  const board = await page.evaluate(() => ({ title: document.querySelector('.rw-menu-title').textContent, stats: document.querySelectorAll('[data-role="records-stats"] .rw-menu-stat').length, rows: document.querySelectorAll('.rw-lp-row').length, regions: document.querySelectorAll('[data-role="records-regions"] tr').length }));
  check(board.title === 'Records' && board.stats >= 8 && board.rows >= 20 && board.regions >= 6, `Records: two taps from play (${JSON.stringify(board)})`);
  await snap('17-records');
  await page.tap('[data-role="back"]');
  await page.tap('[data-role="daily"]');
  await page.waitForTimeout(200);
  const dly = await page.evaluate(() => ({ cards: document.querySelectorAll('.rw-lp-card').length, text: document.querySelector('.rw-menu-body').innerText.slice(0, 300) }));
  check(dly.cards === 3, `Daily Three shows three events (${dly.text.replace(/\n/g, ' | ')})`);
  await snap('18-daily');
  // Go: the first daily puts the car at its gate with the twist set.
  await page.tap('.rw-lp-card [data-role="daily-go"]');
  await page.waitForTimeout(600);
  const went = await page.evaluate(() => { const g = window.__rw, p = g.daily.picks[0]; return { open: g.menu.isOpen(), d: Math.round(Math.hypot(g.player.x - p.ev.x, g.player.z - p.ev.z)), spec: g.player.vehicle && g.player.vehicle.spec.id, twist: p.twist, weather: g.weather.name, clock: Math.round(g.clock * 10) / 10 }; });
  check(!went.open && went.d < 60, `Daily Go puts the car before its gate (${JSON.stringify(went)})`);
  await shot('19-daily-go');
  // Play that daily with the driver.
  await page.evaluate(() => window.__rw.loop.stop());
  const dres = await page.evaluate(() => {
    const g = window.__rw, se = g.streetEvents, lt = window.__lt, ev = g.daily.picks[0].ev;
    const line = { x: ev.x, z: ev.z, dx: ev.dx, dz: ev.dz };
    lt.run({ seconds: 12, cruise: 20, line, until: () => !!se.active });
    lt.run({ seconds: ev.limit + 5, cruise: 45, line, until: () => !se.active });
    return { res: se.lastResult && { medal: se.lastResult.medal, daily: se.lastResult.daily, value: se.lastResult.value }, state: g.daily.state };
  });
  console.log('   daily', JSON.stringify(dres));
  check(!dres.res.medal || (dres.state.done[0] && dres.state.streak === 1), 'a daily finished with a medal ticks its box and starts the streak');
  await page.evaluate(() => window.__rw.loop.start());
  await page.tap('.rw-pause');
  await page.waitForTimeout(300);
  await page.tap('[data-role="customize"]');
  await page.waitForTimeout(300);
  await page.tap('[data-look="paint"] [data-opt="0"]');
  await page.tap('[data-look="finish"] [data-opt="1"]');
  await page.tap('[data-look="wheels"] [data-opt="1"]');
  await page.tap('[data-look="decal"] [data-opt="1"]');
  await page.waitForTimeout(500);
  const look = await page.evaluate(() => { const g = window.__rw, v = g.player.vehicle; return { look: g.progress.loop.looks[v.spec.id], code: v.mesh.userData.color, spec: v.spec.id }; });
  check(look.look && look.look.paint === 0 && look.look.finish === 1 && look.look.wheels === 1, `Customize saves the look for the class (${JSON.stringify(look)})`);
  await snap('20-customize');
  await page.tap('[data-role="customize-done"]');
  await page.tap('[data-role="resume"]');
  await page.waitForTimeout(400);
  await shot('21-custom-car');

  // ---- reload: Continue keeps everything ----
  await page.evaluate(() => window.__rw.economy.save());
  await page.goto(url + (map ? '&' : '?') + 'autostart');
  await page.waitForFunction(() => window.__rw && window.__rw.loop.running, null, { timeout: 120000 });
  const again = await page.evaluate(() => { const g = window.__rw, L = g.progress.loop; return { events: Object.keys(L.events).length, intro: g.tutorial.introOn, looks: Object.keys(L.looks).length, daily: L.daily }; });
  check(again.events >= 6 && !again.intro && again.looks >= 1, `a reload keeps medals, the finished intro and the look (${JSON.stringify(again)})`);

  const perf = await page.evaluate(() => (window.__lt ? window.__lt.st : null));
  void perf;
  const errs = await page.evaluate(() => window.__rw.errors.count || 0);
  check(errs === 0, `no caught exceptions in the game (${errs})`);
  check(errors.length === 0, `no page errors (${errors.length})`);
  for (const e of errors.slice(0, 10)) console.log('   ', e);
} catch (e) {
  console.log('FAIL', e.stack || e.message);
  for (const er of errors.slice(0, 10)) console.log('   ', er);
  failed = true;
} finally {
  try {
    const lines = await page.evaluate(() => (window.__lt ? window.__lt.st.toasts : []));
    console.log('   lines shown: ' + lines.length);
    if (process.argv.includes('--lines')) for (const l of lines) console.log('     ', l.join(' | '));
  } catch { /* the page is gone */ }
  await browser.close();
  server.close();
}
process.exit(failed ? 1 : 0);
