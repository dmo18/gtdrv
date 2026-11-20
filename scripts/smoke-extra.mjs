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
    const money0 = g.progress.money;
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
    return { id: course.id, name: course.name, medal: g.progress.medals[course.id] || null, gained: g.progress.money - money0, courses: g.activities.courses.length };
  });
  await page.screenshot({ path: 'shots/race.png' });
  check(race.courses >= 10, `activities loaded (${race.courses})`);
  check(!!race.medal && race.gained > 0, `finishing "${race.name}" awards a medal (${race.medal}) and $${race.gained}`);

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
}
