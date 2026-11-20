// Extra end-to-end checks run by `npm run smoke -- --extra`.
export default async function extra(page, check) {
  // Advance the game by simulated seconds, independent of how fast the
  // test machine can draw frames.
  const sim = (seconds) => page.evaluate((n) => {
    const g = window.__rw;
    for (let i = 0; i < n; i++) g.step(1 / 60);
  }, Math.round(seconds * 60));
  const tap = async (name) => {
    await page.evaluate((n) => {
      window.__rw.input.press(n);
      setTimeout(() => window.__rw.input.release(n), 60);
    }, name);
    await page.waitForTimeout(250);
  };
  // Stop, get out, walk, get back in.
  await page.evaluate(() => {
    const v = window.__rw.player.vehicle;
    v.vx = v.vz = 0;
    v.speed = 0;
  });
  await page.waitForTimeout(300);
  await tap('enter');
  let s = await page.evaluate(() => ({ mode: window.__rw.player.mode, x: window.__rw.player.x, z: window.__rw.player.z }));
  check(s.mode === 'foot', `player gets out of the car (${s.mode})`);
  await page.keyboard.down('KeyW');
  await sim(1.2);
  await page.keyboard.up('KeyW');
  const s2 = await page.evaluate(() => ({ x: window.__rw.player.x, z: window.__rw.player.z }));
  check(Math.hypot(s2.x - s.x, s2.z - s.z) > 1, 'player walks on foot');
  await page.screenshot({ path: 'shots/foot.png' });
  // Walk back to the car and get in.
  await page.evaluate(() => {
    const g = window.__rw;
    const v = g.vehicles[0];
    g.player.walker.x = v.x - Math.sin(v.heading) * -2.2;
    g.player.walker.z = v.z + Math.cos(v.heading) * -2.2;
  });
  await page.waitForTimeout(300);
  await tap('enter');
  s = await page.evaluate(() => ({ mode: window.__rw.player.mode }));
  check(s.mode === 'car', `player gets back in (${s.mode})`);

  // Get out again, then try a boat and a plane.
  const board = async (kind, specId) => {
    await page.evaluate(() => {
      const g = window.__rw;
      if (g.player.vehicle) {
        const v = g.player.vehicle;
        v.vx = v.vz = 0;
        v.speed = 0;
        v.driver = null;
        g.player.vehicle = null;
        g.setPlayerMode('foot');
      }
    });
    const found = await page.evaluate(([k, id]) => {
      const g = window.__rw;
      const c = g.vehicles.find((v) => v.kind === k && (!id || v.spec.id === id));
      if (!c) return false;
      const w = g.player.walker;
      w.x = w.px = c.x;
      w.z = w.pz = c.z;
      g.enterVehicle(c);
      return true;
    }, [kind, specId]);
    return found;
  };
  check(await board('boat', 'speedboat'), 'a speedboat exists to board');
  let b0 = await page.evaluate(() => ({ x: window.__rw.player.x, z: window.__rw.player.z }));
  await page.keyboard.down('KeyW');
  await sim(4);
  await page.waitForTimeout(300);
  await page.screenshot({ path: 'shots/boat.png' });
  await page.keyboard.up('KeyW');
  let b1 = await page.evaluate(() => ({ x: window.__rw.player.x, z: window.__rw.player.z, sd: window.__rw.city.shoreDist(window.__rw.player.x, window.__rw.player.z), mode: window.__rw.player.mode }));
  check(b1.mode === 'boat' && Math.hypot(b1.x - b0.x, b1.z - b0.z) > 10, `boat moves under power (${Math.hypot(b1.x - b0.x, b1.z - b0.z).toFixed(0)} m)`);
  check(b1.sd < 0, 'boat stays on the water');

  check(await board('plane', 'prop'), 'a prop plane exists to board');
  await page.keyboard.down('KeyW');
  await page.keyboard.down('KeyI');
  await sim(9);
  await page.waitForTimeout(300);
  await page.screenshot({ path: 'shots/plane.png' });
  const f = await page.evaluate(() => ({ y: window.__rw.player.y, mode: window.__rw.player.mode, sp: window.__rw.player.vehicle.speed }));
  await page.keyboard.up('KeyW');
  await page.keyboard.up('KeyI');
  check(f.mode === 'plane' && f.y > 5, `plane takes off (height ${f.y.toFixed(0)} m, ${f.sp.toFixed(0)} m/s)`);

  check(await board('heli', 'heli'), 'a helicopter exists to board');
  await page.keyboard.down('KeyW');
  await sim(7);
  await page.waitForTimeout(300);
  await page.screenshot({ path: 'shots/heli.png' });
  const h = await page.evaluate(() => ({ y: window.__rw.player.y, mode: window.__rw.player.mode }));
  await page.keyboard.up('KeyW');
  check(h.mode === 'heli' && h.y > 3, `helicopter lifts off (height ${h.y.toFixed(0)} m)`);

  // Run a street race end to end by hopping the car between checkpoints.
  await page.evaluate(() => {
    const g = window.__rw;
    const v = g.player.vehicle;
    v.driver = null;
    g.player.vehicle = null;
    g.setPlayerMode('foot');
    const w = g.player.walker;
    w.x = w.px = g.city.spawn.x;
    w.z = w.pz = g.city.spawn.z + 6;
  });
  // Back in town, parked cars appear within a moment.
  await page.waitForFunction(() => window.__rw.vehicles.some((c) => c.kind === 'car' && !c.ai), null, { timeout: 10000 });
  await page.evaluate(() => {
    const g = window.__rw;
    g.enterVehicle(g.vehicles.find((c) => c.kind === 'car' && !c.ai));
  });
  const race = await page.evaluate(async () => {
    const g = window.__rw;
    const course = g.activities.courses.find((c) => c.type === 'street');
    const score0 = g.progress.score.total;
    const car = g.player.vehicle;
    const put = (p) => {
      car.x = car.px = p.x;
      car.z = car.pz = p.z;
      car.vx = car.vz = 0;
      car.speed = 0;
    };
    put(course.start);
    g.activities.start(course.id);
    // Advance the simulation directly so this does not depend on how
    // fast the test machine draws frames.
    const run = (steps) => {
      for (let i = 0; i < steps; i++) g.step(1 / 60);
    };
    run(300);
    for (let lap = 0; lap < (course.laps || 1); lap++) {
      for (const cp of course.checkpoints) {
        put(cp);
        run(12);
      }
    }
    run(30);
    return { id: course.id, name: course.name, medal: g.progress.medals[course.id] || null, gained: g.progress.score.total - score0, courses: g.activities.courses.length };
  });
  await page.screenshot({ path: 'shots/race.png' });
  check(race.courses >= 10, `activities loaded (${race.courses})`);
  check(!!race.medal && race.gained > 0, `finishing "${race.name}" awards a medal (${race.medal}) and ${race.gained} points`);

  // Combat core: on foot, hold fire at the nearest ped until it goes
  // down (cartoon knock-down, no gore), then it lies there and fades.
  // The 'fire' action is pressed directly: the F key binding is task 26.
  const fight = await page.evaluate(() => {
    const g = window.__rw;
    const run = (n) => {
      for (let i = 0; i < n; i++) g.step(1 / 60);
    };
    if (g.player.vehicle) {
      const v = g.player.vehicle;
      v.vx = v.vz = 0;
      v.speed = 0;
      v.driver = null;
      g.player.vehicle = null;
      g.setPlayerMode('foot');
    }
    run(60);
    const w = g.player.walker;
    const peds = g.peds.slots.map((s) => s.ped).filter((p) => p.active && p.life === 'ok');
    if (!peds.length) return { ok: false, why: 'no peds' };
    peds.sort((a, b) => Math.hypot(a.x - w.x, a.z - w.z) - Math.hypot(b.x - w.x, b.z - w.z));
    const ped = peds[0];
    // Stand 6 m from the ped.
    w.x = w.px = ped.x - 6;
    w.z = w.pz = ped.z;
    w.heading = w.pheading = 0;
    const events = { shot: 0, hit: 0, down: 0 };
    const offs = ['shot', 'hit', 'down'].map((n) => g.events.on(n, () => events[n]++));
    g.input.press('fire');
    let steps = 0;
    while (ped.life === 'ok' && steps < 240) {
      const dx = ped.x - w.x, dz = ped.z - w.z, dy = 1.0 - 1.4;
      const l = Math.hypot(dx, dy, dz) || 1;
      g.aim.dx = dx / l;
      g.aim.dy = dy / l;
      g.aim.dz = dz / l;
      g.aim.manual = true;
      w.heading = Math.atan2(dz, dx);
      run(1);
      steps++;
    }
    g.input.release('fire');
    g.aim.manual = false;
    run(30);
    offs.forEach((f) => f());
    window.__downed = ped;
    return { ok: ped.life !== 'ok', life: ped.life, hp: ped.hp, steps, events, actors: g.actors.length };
  });
  await page.waitForTimeout(400);
  await page.screenshot({ path: 'shots/combat-down.png' });
  check(fight.ok, `holding fire downs a ped (${fight.life}, hp ${fight.hp}, ${fight.steps} steps, ${JSON.stringify(fight.events)})`);
  check(fight.actors > 1 && fight.actors <= 36, `combat actors registered (${fight.actors})`);
  const later = await page.evaluate(() => {
    const g = window.__rw;
    const p = window.__downed;
    let out = false, maxFade = 0, freed = false;
    for (let i = 0; i < 60 * 6 && !freed; i++) {
      g.step(1 / 60);
      if (p.life === 'out') out = true;
      if (p.fade > maxFade) maxFade = p.fade;
      if (!p.active || !g.actors.includes(p)) freed = true;
    }
    return { out, maxFade: +maxFade.toFixed(2), freed };
  });
  check(later.out && later.maxFade > 0.9 && later.freed, `downed ped lies out, fades and its slot is freed (${JSON.stringify(later)})`);

  // ---- Explosives and craft weapons (docs/ARMS.md, task 31) ----
  // Hold FIRE with a Fizzpop Can: the arc preview shows, nothing is thrown
  // until release.
  const pre = await page.evaluate(() => {
    const g = window.__rw;
    const w = g.player.walker;
    w.arms.weapon = 'fizz';
    w.arms.cool = 0;
    g.input.press('fire');
    for (let i = 0; i < 20; i++) g.step(1 / 60);
    const live = g.combat.projectiles.filter((p) => p.active).length;
    return { on: g.combat.preview.on, n: g.combat.preview.n, live };
  });
  await page.waitForTimeout(500);
  await page.screenshot({ path: 'shots/arms-throw-preview.png' });
  const rel = await page.evaluate(() => {
    const g = window.__rw;
    g.input.release('fire');
    for (let i = 0; i < 2; i++) g.step(1 / 60);
    return g.combat.projectiles.filter((p) => p.active && p.type === 'thrown').length;
  });
  check(pre.on && pre.n > 3 && pre.live === 0 && rel === 1, `hold FIRE previews the arc, release throws (${JSON.stringify(pre)}, thrown ${rel})`);
  // Throw a can at a parked car: the car takes blast damage.
  const nade = await page.evaluate(() => {
    const g = window.__rw;
    const run = (n) => { for (let i = 0; i < n; i++) g.step(1 / 60); };
    run(200);
    const w = g.player.walker;
    const cars = g.vehicles.filter((v) => v.kind === 'car' && !v.driver && !v.wrecked && v !== g.player.vehicle);
    cars.sort((a, b) => Math.hypot(a.x - w.x, a.z - w.z) - Math.hypot(b.x - w.x, b.z - w.z));
    const car = cars[0];
    if (!car) return { ok: false, why: 'no car' };
    // Stand 9 m away; aim pitch picks the reach (6..25 m over -0.2..0.6 rad).
    const ang = Math.atan2(w.z - car.z, w.x - car.x);
    w.x = w.px = car.x + Math.cos(ang) * 9;
    w.z = w.pz = car.z + Math.sin(ang) * 9;
    const h0 = car.health;
    const yaw = ang + Math.PI;
    // Land about 2 m short of the car: a bounce off it stays in the blast.
    const pitch = -0.2 + ((7 - 6) / 19) * 0.8;
    w.arms.weapon = 'fizz';
    w.arms.cool = 0;
    const thrown = g.combat.fire(w, Math.cos(yaw) * Math.cos(pitch), Math.sin(pitch), Math.sin(yaw) * Math.cos(pitch));
    let boom = 0, at = null;
    const off = g.events.on('explosion', (e) => { boom++; at = at || { d: +Math.hypot(e.x - car.x, e.z - car.z).toFixed(1), y: +e.y.toFixed(1) }; });
    run(200);
    off();
    window.__nadeCar = car;
    return { ok: thrown && boom > 0 && car.health < h0, thrown, boom, at, lost: +(h0 - car.health).toFixed(1),
      removed: !!car.removed, listed: g.vehicles.includes(car), r: car.radius };
  });
  check(nade.ok, `a thrown can damages a car (${JSON.stringify(nade)})`);
  // Fly a plane fitted with a fixture bomb mount (the real fighter is task 33)
  // over a car and drop a bomb with the 'drop' action.
  const bomb = await page.evaluate(() => {
    const g = window.__rw;
    const run = (n) => { for (let i = 0; i < n; i++) g.step(1 / 60); };
    const plane = g.vehicles.find((v) => v.kind === 'plane' && !v.wrecked);
    if (!plane) return { ok: false, why: 'no plane' };
    plane.spec = { ...plane.spec, mounts: ['nosegun', 'missile', 'bomb'] };
    plane.arms = undefined;
    const car = window.__nadeCar;
    car.health = car.spec.health;
    car.wrecked = false;
    const w = g.player.walker;
    if (g.player.vehicle) g.player.vehicle.driver = null;
    plane.driver = 'player';
    g.player.vehicle = plane;
    g.setPlayerMode('plane');
    // Level flight at 60 m, 40 m/s, heading for the car.
    const sp = 40;
    plane.heading = plane.pheading = 0;
    plane.x = plane.px = car.x - 80;
    plane.z = plane.pz = car.z;
    plane.y = plane.py = 60;
    plane.onGround = false;
    plane.placed = true;
    plane.engineOn = true;
    plane.speed = plane.airspeed = sp;
    plane.vx = sp;
    plane.vz = 0;
    plane.vy = 0;
    plane.pitch = 0;
    w.x = plane.x;
    w.z = plane.z;
    const launches = [];
    const booms = [];
    const offs = [g.events.on('launch', (e) => launches.push(e.weapon)), g.events.on('explosion', (e) => booms.push({ x: e.x, z: e.z, r: e.radius, size: e.size }))];
    let pd = null;
    const h0 = car.health;
    for (let i = 0; i < 240 && !launches.length; i++) {
      g.input.throttle = 1;
      const d = g.combat.predictDrop(plane, { ok: false, hx: 0, hy: 0, hz: 0, t: 0, kind: 'none' });
      if (d.ok && d.hx >= car.x - 1) {
        pd = { x: d.hx, z: d.hz };
        // Park a live car right on the predicted spot (parked cars far from
        // the player may have been recycled meanwhile).
        const live = g.vehicles.filter((v) => v.kind === 'car' && !v.driver && !v.wrecked);
        live.sort((a, b) => Math.hypot(a.x - d.hx, a.z - d.hz) - Math.hypot(b.x - d.hx, b.z - d.hz));
        if (live[0]) {
          window.__nadeCar = live[0];
          live[0].x = live[0].px = d.hx + 1;
          live[0].z = live[0].pz = d.hz;
          live[0].health = live[0].spec.health;
        }
        g.input.press('drop');
        run(1);
        g.input.release('drop');
      } else run(1);
    }
    window.__bombPd = pd;
    offs.forEach((f) => f());
    return { launches, pd, h0, booms };
  });
  await page.waitForTimeout(700);
  await page.screenshot({ path: 'shots/arms-bomb-drop.png' });
  const bomb2 = await page.evaluate(() => {
    const g = window.__rw;
    const car = window.__nadeCar;
    const booms = [];
    const off = g.events.on('explosion', (e) => booms.push({ x: e.x, z: e.z, r: e.radius, size: e.size }));
    for (let i = 0; i < 300 && !booms.length; i++) g.step(1 / 60);
    off();
    return { booms, health: car.health, max: car.spec.health };
  });
  await page.waitForTimeout(150);
  await page.screenshot({ path: 'shots/arms-bomb-blast.png' });
  const hitNear = bomb2.booms.length && bomb.pd && Math.hypot(bomb2.booms[0].x - bomb.pd.x, bomb2.booms[0].z - bomb.pd.z) < 3;
  check(bomb.launches && bomb.launches.includes('bomb') && hitNear && bomb2.booms[0].size === 'huge' && bomb2.health < bomb2.max,
    `a bomb dropped from a plane lands on the predicted spot and damages the car (${JSON.stringify({ l: bomb.launches, pd: bomb.pd, b: bomb2.booms[0], hp: bomb2.health })})`);
  // A missile in flight (for the screenshot), then back on foot.
  const msl = await page.evaluate(() => {
    const g = window.__rw;
    const plane = g.player.vehicle;
    if (!plane) return false;
    plane.arms.cool.missile = 0;
    const ok = g.combat.fireMount(plane, 1, Math.cos(plane.heading), -0.05, Math.sin(plane.heading), g.player.walker, null);
    for (let i = 0; i < 12; i++) g.step(1 / 60);
    return ok;
  });
  await page.waitForTimeout(300);
  await page.screenshot({ path: 'shots/arms-missile.png' });
  check(msl, 'a missile launches from the fixture plane');
}
