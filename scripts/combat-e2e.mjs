// End to end checks for killing cops and for bombs and missiles that must
// visibly hit and destroy targets, in headless Chromium at phone size.
// Uses the debug fixtures (g.debug.spawnCar) and steps the game by hand.
// usage: node scripts/combat-e2e.mjs [cops|missiles|bombs]  (default: all)
import { createRequire } from 'node:module';
import { buildGame, serve } from './build.mjs';

let chromium;
try {
  ({ chromium } = await import('playwright'));
} catch {
  ({ chromium } = createRequire('/opt/node-tools/node_modules/')('playwright'));
}
const only = process.argv[2] || 'all';
await buildGame({ minify: false });
const server = await serve(0);
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 915, height: 412 }, deviceScaleFactor: 1 });
let bad = 0, failed = false;
const check = (ok, label) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}`);
  if (!ok) failed = true;
};
page.on('pageerror', (e) => {
  bad++;
  console.log('pageerror', String(e));
});
page.on('console', (m) => {
  if (m.type() === 'error') {
    bad++;
    console.log('console.error', m.text().slice(0, 300));
  }
});
page.setDefaultNavigationTimeout(180000);
await page.goto(`http://127.0.0.1:${server.address().port}/?autostart`);
await page.waitForFunction(() => window.__rw && window.__rw.loop.running, null, { timeout: 180000 });
await page.waitForTimeout(2500);
await page.evaluate(() => {
  const g = window.__rw;
  g.loop.stop();
  g.daynight.setHour(14);
  g.daynight.setWeather('clear', true);
  window.__run = (n) => { for (let i = 0; i < n; i++) g.step(1 / 60); };
});

if (only === 'all' || only === 'cops') {
  // A patrol car with two officers, in front of the player on foot; shoot the driver.
  const r = await page.evaluate(() => {
    const g = window.__rw;
    const run = window.__run;
    const p = g.player;
    // On foot at a quiet spot on the spawn road.
    if (p.vehicle) {
      p.vehicle.driver = null;
      p.vehicle = null;
      g.setPlayerMode('foot');
    }
    const w = p.walker;
    w.x = w.px = g.city.spawn.x;
    w.z = w.pz = g.city.spawn.z + 6;
    w.heading = w.pheading = 0;
    w.arms.weapon = 'pistol';
    run(30);
    const pol = g.police;
    pol.heat.level = 2;
    pol.heat.points = 2.5;
    let car = null;
    for (let i = 0; i < 1200 && !car; i++) {
      run(1);
      car = pol.cars.find((c) => c.occ);
    }
    if (!car) return { ok: false, why: 'no patrol car' };
    // Park it 14 m ahead of the player, broadside is not needed: any cabin hit counts.
    const park = () => {
      car.x = car.px = w.x + 14;
      car.z = car.pz = w.z;
      car.vx = car.vz = 0;
      car.speed = 0;
      car.heading = car.pheading = Math.PI / 2;
      car.role = car.role === 'dead' ? 'dead' : 'block';
    };
    park();
    const downs = [];
    const off = g.events.on('down', (d) => { if (d.target.team === 'police') downs.push({ kind: d.kind, hp: d.target.hp }); });
    const heat0 = pol.heat.points + pol.heat.level * 10;
    const occ0 = car.occ.slice();
    let shots = 0;
    for (let i = 0; i < 40 && car.occ.some((h) => h > 0); i++) {
      park();
      const ok = g.combat.fire(w, 14, 1.0 - 1.4, 0);
      if (ok) shots++;
      run(14);
    }
    run(40);
    off();
    window.__copCar = car;
    return { ok: true, occ0, occ: car.occ.slice(), shots, downs, role: car.role, carHp: car.health, wrecked: car.wrecked, bodies: pol.bodies.filter((b) => b.active).length, heat: pol.heat.points + pol.heat.level * 10 - heat0, level: pol.heat.level };
  });
  console.log(JSON.stringify(r));
  await page.evaluate(() => { const g = window.__rw; g.draw(1, 1 / 60); });
  check(r.ok && r.occ.every((h) => h <= 0) && r.downs.length === 2 && r.bodies === 2, 'shooting a patrol car kills both officers through the car (driver first)');
  check(r.ok && !r.wrecked && r.carHp > 0, 'the pistol alone does not wreck the car');
  check(r.ok && r.level >= 2, 'killing cops keeps the heat up (level ' + r.level + ')');
  // A second car is blown up: occupants die with it.
  const r2 = await page.evaluate(() => {
    const g = window.__rw;
    const run = window.__run;
    const pol = g.police;
    pol.heat.level = 3;
    pol.heat.points = 3.5;
    let car = null;
    for (let i = 0; i < 1800 && !car; i++) {
      run(1);
      car = pol.cars.find((c) => c.occ && c !== window.__copCar && c.occ.some((h) => h > 0));
    }
    if (!car) return { ok: false, why: 'no second car' };
    const w = g.player.walker;
    const downs = [];
    const off = g.events.on('down', (d) => { if (d.target.team === 'police') downs.push(d.kind); });
    g.combat.explode(car.x, 0.8, car.z, 8, w, 0, 1, null);
    run(30);
    off();
    return { ok: true, downs, wrecked: car.wrecked, occ: car.occ.slice() };
  });
  console.log(JSON.stringify(r2));
  check(r2.ok && r2.downs.length === 2 && r2.occ.every((h) => h <= 0), 'a blast at a patrol car kills the officers inside');
}


if (only === 'all' || only === 'missiles' || only === 'bombs') {
  // Fixture helpers shared by the missile and bomb checks.
  await page.evaluate(() => {
    const g = window.__rw;
    window.__fighter = () => {
      const f = g.vehicles.find((v) => v.kind === 'plane' && v.spec.id === 'fighter');
      if (f) {
        f.wrecked = false;
        f.exploded = false;
        f.burning = false;
        f.removed = false;
        f.health = f.spec.health;
        f.arms = undefined;
      }
      return f;
    };
    // Put the player in the fighter in level flight, `dist` m before (x, z), heading at it.
    window.__fly = (f, tx, tz, dist, alt, sp, ang = 0) => {
      const w = g.player.walker;
      if (g.player.vehicle && g.player.vehicle !== f) g.player.vehicle.driver = null;
      f.driver = 'player';
      g.player.vehicle = f;
      g.setPlayerMode('plane');
      const h = ang;
      f.heading = f.pheading = h;
      f.x = f.px = tx - Math.cos(h) * dist;
      f.z = f.pz = tz - Math.sin(h) * dist;
      f.y = f.py = alt;
      f.onGround = false;
      f.placed = true;
      f.engineOn = true;
      f.speed = f.airspeed = sp;
      f.vx = Math.cos(h) * sp;
      f.vz = Math.sin(h) * sp;
      // Nose down at the target, as a player would line it up.
      const pit = Math.atan2(alt - 1, dist);
      f.pitch = -pit;
      f.vx = Math.cos(h) * sp * Math.cos(pit);
      f.vz = Math.sin(h) * sp * Math.cos(pit);
      f.vy = -Math.sin(pit) * sp;
      f.roll = 0;
      w.x = f.x;
      w.z = f.z;
    };
    // Fly toward the target; once the seeker says 'locked' fire a missile. Returns a report.
    window.__missile = (f, t, opts = {}) => {
      const maxSteps = opts.maxSteps || 900;
      const run = window.__run;
      const ev = { lock: [], boom: [], launch: 0 };
      const offs = [
        g.events.on('lock', (e) => ev.lock.push(e.state)),
        g.events.on('explosion', (e) => ev.boom.push({ x: +e.x.toFixed(1), y: +e.y.toFixed(1), z: +e.z.toFixed(1), r: e.radius, size: e.size, craft: e.craft === t })),
        g.events.on('launch', (e) => { if (e.weapon === 'missile') ev.launch++; }),
      ];
      const h0 = t.health;
      let fired = false, firedAt = -1, dmin = 1e9;
      for (let i = 0; i < maxSteps; i++) {
        g.input.throttle = 1;
        if (!fired) {
          // The pilot keeps the nose on the target until the missile is away.
          const dx = t.x - f.x, dz = t.z - f.z, dy = (t.y || 0) + 1 - f.y;
          const hd = Math.hypot(dx, dz);
          const hh = Math.atan2(dz, dx), pp = Math.atan2(dy, hd);
          const sp = Math.hypot(f.vx, f.vz, f.vy) || 80;
          f.heading = hh;
          f.pitch = pp;
          f.vx = Math.cos(hh) * Math.cos(pp) * sp;
          f.vz = Math.sin(hh) * Math.cos(pp) * sp;
          f.vy = Math.sin(pp) * sp;
        }
        if (!fired && (ev.lock.includes('locked') || (i > 70 && !opts.needLock))) {
          g.input.press('fire2');
          run(1);
          g.input.release('fire2');
          const pr = g.combat.projectiles.find((q) => q.active && q.type === 'missile');
          ev.homing = pr ? (pr.target === t ? 'target' : pr.target ? 'other:' + (pr.target.spec ? pr.target.spec.id : pr.target.team) : 'none') : 'no projectile';
          fired = true;
          firedAt = i;
          continue;
        }
        run(1);
        dmin = Math.min(dmin, Math.hypot(f.x - t.x, f.z - t.z));
        if (fired && (t.wrecked || i > firedAt + 480)) break;
      }
      offs.forEach((o) => o());
      run(20);
      return { locked: ev.lock.includes('locked'), fired, launches: ev.launch, hp0: Math.round(h0), hp: Math.round(t.health), max: t.spec.health, wrecked: !!t.wrecked, homing: ev.homing, booms: ev.boom.length, first: ev.boom[0] || null, steps: firedAt };
    };
  });
}

if (only === 'all' || only === 'missiles') {
  const rwy = await page.evaluate(() => ({ ...window.__rw.city.airfield.runway }));
  const mk = (id, x, z) => page.evaluate(({ id, x, z }) => {
    const g = window.__rw;
    const f = window.__fighter();
    const car = g.debug.spawnCar(id, x, z, 0);
    car.vx = car.vz = car.speed = 0;
    window.__t = car;
    return !!f;
  }, { id, x, z });
  const tx = rwy.x0 + 700, tz = (rwy.z0 + rwy.z1) / 2;
  // 1. Parked car.
  await mk('sedan', tx, tz);
  let r = await page.evaluate(({ tx, tz }) => {
    const f = window.__fighter();
    window.__fly(f, tx, tz, 420, 90, 80);
    return window.__missile(f, window.__t);
  }, { tx, tz });
  console.log('parked', JSON.stringify(r));
  check(r.fired && r.wrecked, `a missile destroys a parked car (${r.hp0} -> ${r.hp})`);
  await page.evaluate(() => { const g = window.__rw; g.draw(1, 1 / 60); });
  // 2. Moving car (about 17 m/s down the runway, heading +x, the fighter comes from behind).
  await mk('sedan', tx - 200, tz);
  r = await page.evaluate(({ tz }) => {
    const f = window.__fighter();
    const t = window.__t;
    t.controls = { steer: 0, throttle: 1, brake: 0, handbrake: false };
    t.asleep = false;
    window.__fly(f, t.x, tz, 420, 90, 80);
    return { ...window.__missile(f, t), speed: +t.speed.toFixed(1) };
  }, { tx, tz });
  console.log('moving', JSON.stringify(r));
  check(r.fired && r.wrecked, `a missile destroys a moving car (${r.speed} m/s)`);
  // 3. Tank: two missiles badly damage or wreck it.
  const tr = await page.evaluate(({ tx, tz }) => {
    const g = window.__rw;
    const f = window.__fighter();
    const tank = g.vehicles.find((v) => v.kind === 'tank' && !v.wrecked && !v.removed);
    if (!tank) return { ok: false };
    tank.x = tank.px = tx + 100;
    tank.z = tank.pz = tz;
    tank.vx = tank.vz = tank.speed = 0;
    tank.health = tank.spec.health;
    window.__t = tank;
    const res = [];
    for (let k = 0; k < 2; k++) {
      window.__fly(f, tank.x, tank.z, 420, 90, 80);
      f.arms = f.arms || undefined;
      res.push(window.__missile(f, tank));
      if (tank.wrecked) break;
    }
    return { ok: true, res, hp: Math.round(tank.health), max: tank.spec.health, wrecked: !!tank.wrecked };
  }, { tx, tz });
  console.log('tank', JSON.stringify(tr));
  check(tr.ok && (tr.wrecked || tr.hp <= tr.max * 0.4), `two missiles badly damage or wreck a tank (${tr.hp}/${tr.max}, wrecked ${tr.wrecked})`);
  // 4. Police heli orbiting the fighter.
  const hr = await page.evaluate(() => {
    const g = window.__rw;
    const f = window.__fighter();
    window.__fly(f, f.x + 500, f.z, 500, 120, 70);
    const pilot = g.helipilot.spawn({ x: f.x + 380, z: f.z + 30, y: 110, order: 'orbit' });
    const heli = pilot.craft || g.vehicles.find((v) => v.kind === 'heli' && v.spec.police);
    window.__t = heli;
    return { ok: !!heli, hp: heli && heli.health };
  });
  if (hr.ok) {
    const r4 = await page.evaluate(() => {
      const f = window.__fighter();
      f.arms = undefined;
      return window.__missile(f, window.__t, { maxSteps: 1500 });
    });
    console.log('heli', JSON.stringify(r4));
    check(r4.locked && r4.fired && r4.wrecked, `a lock-on missile brings down the police heli (${r4.hp0} -> ${r4.hp})`);
  } else check(false, 'police heli fixture');
}

if (only === 'all' || only === 'bombs') {
  const rwy = await page.evaluate(() => ({ ...window.__rw.city.airfield.runway }));
  const tz = (rwy.z0 + rwy.z1) / 2, tx = rwy.x0 + 420;
  const r = await page.evaluate(({ tx, tz }) => {
    const g = window.__rw;
    const run = window.__run;
    const f = window.__fighter();
    const car = g.debug.spawnCar('sedan', tx, tz, 0);
    car.vx = car.vz = car.speed = 0;
    // Three people near the car.
    const people = [];
    for (let k = 0; k < 3; k++) {
      const a = { x: tx + 3 + k * 2, z: tz + 5, y: 0, heading: 0, radius: 0.35, px: tx + 3 + k * 2, pz: tz + 5, vx: 0, vz: 0,
        team: 'civ', maxHp: 30, hp: 30, height: 1.8, arms: null, life: 'ok', lifeT: 0, fade: 0, hitT: 0, kx: 0, kz: 0, lastHitBy: null, sinceHit: 99, bonks: 0 };
      g.combat.addActor(a);
      people.push(a);
    }
    window.__fly(f, tx, tz, 500, 70, 70);
    const booms = [];
    const off = g.events.on('explosion', (e) => booms.push({ x: e.x, z: e.z, r: e.radius, size: e.size }));
    let dropped = false;
    let after = 0;
    for (let i = 0; i < 1500; i++) {
      g.input.throttle = 1;
      if (dropped && ++after > 700) break;
      if (!dropped) {
        const d = g.combat.predictDrop(f, { ok: false, hx: 0, hy: 0, hz: 0, t: 0, kind: 'none' });
        if (d.ok && Math.hypot(d.hx - (tx + 2), d.hz - tz) < 4) {
          g.input.press('drop');
          run(1);
          g.input.release('drop');
          dropped = true;
          window.__dbg = { arms: JSON.stringify(f.arms && { ids: f.arms.ids, mag: f.arms.mag, drop: f.arms.drop }), og: f.onGround, ow: f.onWater, proj: g.combat.projectiles.filter((q) => q.active).length, wreck: f.wrecked };
          continue;
        }
      }
      run(1);
      if (dropped && booms.length) break;
    }
    run(30);
    off();
    const pj = g.combat.projectiles.filter((q) => q.active).map((q) => ({ t: q.type, y: Math.round(q.y), x: Math.round(q.x), z: Math.round(q.z), f: +q.fuse.toFixed(1) }));
    return { dropped, dbg: window.__dbg, pj, fx: Math.round(f.x), fy: Math.round(f.y), mode: g.player.mode, booms, hp: Math.round(car.health), max: car.spec.health, wrecked: !!car.wrecked, people: people.map((a) => a.life) };
  }, { tx, tz });
  console.log('bomb', JSON.stringify(r));
  check(r.dropped && r.booms.length > 0 && r.wrecked, 'a bomb drop wrecks a car');
  check(r.people.every((l) => l !== 'ok'), `a bomb drop kills the people nearby (${r.people.join(',')})`);
}

console.log(bad ? `${bad} page errors` : 'no page errors');
check(bad === 0, 'no page or console errors');
await browser.close();
server.close();
process.exit(failed ? 1 : 0);
