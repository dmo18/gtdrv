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

  // From here on the test steps the simulation by hand: stop the page's
  // real-time loop so world state does not depend on machine speed.
  await page.evaluate(() => window.__rw.loop.stop());
  const frame = () => page.evaluate(() => window.__rw.draw(1, 1 / 60));
  // A healthy, unwanted player with no cooldowns, whatever came before.
  const resetPlayer = () => page.evaluate(() => {
    const g = window.__rw;
    const w = g.player.walker;
    w.hp = w.maxHp || 100;
    w.life = 'ok';
    w.lifeT = 0;
    w.fade = 0;
    w.vx = w.vz = 0;
    g.player.health = 100;
    g.player.wanted = 0;
    const h = g.police && g.police.heat;
    if (h) {
      h.level = 0;
      h.points = 0;
      h.calm = 0;
      h.grace = 0;
      h.unseen = 0;
      h.cooldown = 0;
      h.speedTime = 0;
      h.bustTime = 0;
    }
    const a = w.arms;
    if (a && a.cool && typeof a.cool === 'object') for (const k of Object.keys(a.cool)) a.cool[k] = 0;
    else if (a) a.cool = 0;
  });

  // Combat core: on foot, hold fire at the nearest ped until it goes
  // dead (one bullet is lethal, blood on the street), then it lies there
  // and fades; it never gets up.
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
    const blood0 = g.combatFx.counts().blood;
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
    return { ok: ped.life !== 'ok', life: ped.life, hp: ped.hp, steps, events, actors: g.actors.length,
      blood0, blood1: g.combatFx.counts().blood };
  });
  await page.waitForTimeout(400);
  await page.screenshot({ path: 'shots/combat-down.png' });
  check(fight.ok, `holding fire downs a ped (${fight.life}, hp ${fight.hp}, ${fight.steps} steps, ${JSON.stringify(fight.events)})`);
  check(fight.hp === 0 && fight.blood1 > fight.blood0, `the shot ped is dead and blood decals rise (${fight.blood0} -> ${fight.blood1})`);
  check(fight.actors > 1 && fight.actors <= 36, `combat actors registered (${fight.actors})`);
  const later = await page.evaluate(() => {
    const g = window.__rw;
    const p = window.__downed;
    let out = false, maxFade = 0, freed = false, gotUp = false;
    for (let i = 0; i < 60 * 6 && !freed; i++) {
      g.step(1 / 60);
      // A ped that faded out and then shows up alive again was recycled (its slot
      // was freed and refilled out of view at once: actor cap 40); getting up
      // before the fade is what must never happen.
      if ((p.life === 'ok' || p.life === 'getup') && maxFade < 1) gotUp = true;
      if (p.life === 'out') out = true;
      if (p.fade > maxFade) maxFade = p.fade;
      if (!p.active || !g.actors.includes(p) || (maxFade >= 1 && p.life === 'ok' && p.fade === 0)) freed = true;
    }
    return { out, maxFade: +maxFade.toFixed(2), freed, gotUp };
  });
  check(later.out && later.maxFade > 0.9 && later.freed && !later.gotUp, `downed ped lies out, fades and its slot is freed (${JSON.stringify(later)})`);

  // ---- Explosives and craft weapons (docs/ARMS.md, task 31) ----
  // Fixture: the open, flat airfield runway, so buildings, props and
  // traffic cannot get in the way of the arcs. The player stands there
  // facing +x (the runway's long axis), healthy and unwanted.
  await resetPlayer();
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
    const rw = g.city.airfield.runway;
    const w = g.player.walker;
    w.x = w.px = rw.x0 + 191;
    w.z = w.pz = (rw.z0 + rw.z1) / 2;
    w.heading = w.pheading = 0;
    g.player.x = w.x;
    g.player.z = w.z;
  });
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
  await frame();
  await page.screenshot({ path: 'shots/arms-throw-preview.png' });
  const rel = await page.evaluate(() => {
    const g = window.__rw;
    g.input.release('fire');
    for (let i = 0; i < 2; i++) g.step(1 / 60);
    return g.combat.projectiles.filter((p) => p.active && p.type === 'thrown').length;
  });
  check(pre.on && pre.n > 3 && pre.live === 0 && rel === 1, `hold FIRE previews the arc, release throws (${JSON.stringify(pre)}, thrown ${rel})`);
  // Throw a can at a parked car: the car takes blast damage.
  await sim(3.4); // the first can has burst and settled
  await resetPlayer();
  const nade = await page.evaluate(() => {
    const g = window.__rw;
    const run = (n) => { for (let i = 0; i < n; i++) g.step(1 / 60); };
    const w = g.player.walker;
    const rw = g.city.airfield.runway;
    const rz = (rw.z0 + rw.z1) / 2;
    // A fixture sedan on the runway in front of the player.
    const car = g.debug.spawnCar('sedan', rw.x0 + 200, rz, 0);
    if (!car) return { ok: false, why: 'no car' };
    car.vx = car.vz = 0;
    car.speed = 0;
    car.asleep = false;
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
    // The parked prop plane, repaired (an earlier check flew it).
    const plane = g.vehicles.find((v) => v.kind === 'plane' && v.spec.id === 'prop');
    if (plane) {
      plane.wrecked = false;
      plane.exploded = false;
      plane.burning = false;
      plane.health = plane.spec.health;
    }
    if (!plane) return { ok: false, why: 'no plane' };
    plane.spec = { ...plane.spec, mounts: ['nosegun', 'missile', 'bomb'] };
    plane.arms = undefined;
    // Same open runway fixture as the can test: no building or water in the
    // predicted drop path. A fresh sedan stands in for the target and is
    // moved onto the predicted impact spot.
    const rwy = g.city.airfield.runway;
    const car = g.debug.spawnCar('sedan', rwy.x0 + 420, (rwy.z0 + rwy.z1) / 2, 0);
    window.__nadeCar = car;
    car.vx = car.vz = 0;
    car.speed = 0;
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
        // Park the fixture sedan right on the predicted spot.
        car.x = car.px = d.hx + 1;
        car.z = car.pz = d.hz;
        car.health = car.spec.health;
        g.input.press('drop');
        run(1);
        g.input.release('drop');
      } else run(1);
    }
    window.__bombPd = pd;
    offs.forEach((f) => f());
    const c2 = window.__nadeCar;
    return { launches, pd, h0, booms, dbg: { spec: c2 && c2.spec.id, removed: !!(c2 && c2.removed), inList: g.vehicles.includes(c2), x: c2 && +c2.x.toFixed(1), z: c2 && +c2.z.toFixed(1), parked: !!(c2 && c2.parked), armor: c2 && c2.spec.armor, hp: c2 && c2.health, nCars: g.vehicles.filter((v) => v.kind === 'car').length } };
  });
  await frame();
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
  await frame();
  await page.screenshot({ path: 'shots/arms-bomb-blast.png' });
  const hitNear = bomb2.booms.length && bomb.pd && Math.hypot(bomb2.booms[0].x - bomb.pd.x, bomb2.booms[0].z - bomb.pd.z) < 3;
  check(bomb.launches && bomb.launches.includes('bomb') && hitNear && bomb2.booms[0].size === 'huge' && bomb2.health < bomb2.max,
    `a bomb dropped from a plane lands on the predicted spot and damages the car (${JSON.stringify({ l: bomb.launches, pd: bomb.pd, b: bomb2.booms[0], hp: bomb2.health, max: bomb2.max, dbg: bomb.dbg })})`);
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
  await frame();
  await page.screenshot({ path: 'shots/arms-missile.png' });
  check(msl, 'a missile launches from the fixture plane');

  // ---- Task 32: the Rustback at Ironbank Depot, stepped by hand. ----
  const tankFrame = () => page.evaluate(() => {
    const g = window.__rw;
    g.draw(1, 1 / 60);
    g.chase.snap(g.camTarget);
    for (let i = 0; i < 3; i++) g.draw(1, 1 / 60);
  });
  // Enter the parked tank, drive it, aim and fire the cannon at a car,
  // then roll over a second car. Cars are copies of a nearby car's state
  // (the depot has no parking), placed in the open yard.
  await resetPlayer();
  const tk = await page.evaluate(() => {
    const g = window.__rw;
    const t = g.vehicles.find((v) => v.kind === 'tank' && v.home && v.home.place === 'depot' && !v.wrecked);
    if (!t) return { ok: false, t: false };
    // A compact car next to the depot's tank is the template for the targets.
    const src = g.debug.spawnCar('compact', t.x + 10, t.z + 14, 0);
    if (!src) return { ok: false, t: true, src: false };
    window.__src32 = g.input.addSource({ steer: 0, throttle: 0, brake: 0 });
    window.__carSrc = src;
    if (g.player.vehicle) {
      const v = g.player.vehicle;
      v.vx = v.vz = 0;
      v.speed = 0;
      v.driver = null;
      g.player.vehicle = null;
      g.setPlayerMode('foot');
    }
    const w = g.player.walker;
    w.x = w.px = t.x - 4;
    w.z = w.pz = t.z;
    g.player.x = w.x;
    g.player.z = w.z;
    for (let i = 0; i < 10; i++) g.step(1 / 60);
    g.input.press('enter');
    g.step(1 / 60);
    g.input.release('enter');
    window.__tk = t;
    return { ok: true, mode: g.player.mode, x: t.x, z: t.z };
  });
  check(tk.ok && tk.mode === 'tank', `enters the Rustback at Ironbank Depot (${JSON.stringify(tk)})`);
  if (tk.ok) {
    const drive = await page.evaluate(() => {
      const g = window.__rw;
      const t = window.__tk;
      const x0 = t.x, z0 = t.z;
      for (let i = 0; i < 60 * 3; i++) {
        window.__src32.throttle = 1;
        g.step(1 / 60);
      }
      const sp = t.speed;
      window.__src32.throttle = 0;
      for (let i = 0; i < 60 * 3 && t.speed > 0.2; i++) {
        window.__src32.brake = 1; // brake to a stop (held longer, it reverses)
        g.step(1 / 60);
      }
      window.__src32.brake = 0;
      g.step(1 / 60);
      return { d: +Math.hypot(t.x - x0, t.z - z0).toFixed(1), sp: +sp.toFixed(1), end: +t.speed.toFixed(2) };
    });
    check(drive.d > 8 && drive.sp > 6 && Math.abs(drive.end) < 0.3, `the tank drives and stops (${JSON.stringify(drive)})`);
    // A car 38 m ahead; the camera (and so the turret) aims along the hull.
    const placeCar = (d) => page.evaluate((dist) => {
      const g = window.__rw;
      const t = window.__tk, s = window.__carSrc;
      const c = { ...s, mesh: null, id: 990000 + Math.round(dist), driver: null, controls: null, ai: null, parked: false, home: undefined, removed: false,
        wrecked: false, crushed: false, health: s.spec.health, vx: 0, vz: 0, speed: 0, yawRate: 0, asleep: false, burning: false, exploded: false, combatHit: false };
      c.x = c.px = t.x + Math.cos(t.heading) * dist;
      c.z = c.pz = t.z + Math.sin(t.heading) * dist;
      c.heading = c.pheading = t.heading + Math.PI / 2;
      g.addVehicle(c);
      return c.id;
    }, d);
    await placeCar(38);
    await page.evaluate(() => {
      const g = window.__rw;
      g.chase.tankAim.yaw = window.__tk.heading;
      g.chase.tankAim.pitch = 0.02;
      // The turret follows the camera ray (drawn frames), at 1.6 rad/s.
      for (let i = 0; i < 120; i++) {
        g.step(1 / 60);
        g.draw(1, 1 / 60);
      }
    });
    await tankFrame();
    await page.screenshot({ path: 'shots/tank-aim.png' });
    const fire = await page.evaluate(() => {
      const g = window.__rw;
      const c = g.vehicles.find((v) => v.id === 990038);
      const ev = [];
      const offs = [g.events.on('launch', (e) => ev.push(e.weapon)), g.events.on('explosion', (e) => ev.push('boom:' + e.size + '@' + Math.round(e.x - c.x) + ',' + Math.round(e.z - c.z)))];
      const t = window.__tk;
      ev.push('aim:' + (t.heading + t.turretYaw - Math.atan2(c.z - t.z, c.x - t.x)).toFixed(3) + '/' + t.gunPitch.toFixed(3) + '/' + Math.round(Math.hypot(c.x - t.x, c.z - t.z)));
      g.input.press('fire');
      g.step(1 / 60);
      g.input.release('fire');
      for (let i = 0; i < 5; i++) g.step(1 / 60);
      g.draw(1, 1 / 60);
      for (let i = 0; i < 40; i++) g.step(1 / 60);
      offs.forEach((f) => f());
      return { ev, hp: Math.round(c.health), max: c.spec.health, recoil: window.__tk.recoil };
    });
    await tankFrame();
    await page.screenshot({ path: 'shots/tank-fire.png' });
    check(fire.ev.includes('cannon') && fire.ev.some((e) => e.startsWith('boom')) && fire.hp < fire.max * 0.7,
      `the cannon fires a shell that blasts the car (${JSON.stringify(fire)})`);
    // Roll over a second car 12 m ahead: flattened (no gore, no blast).
    await placeCar(12);
    const crush = await page.evaluate(() => {
      const g = window.__rw;
      const c = g.vehicles.find((v) => v.id === 990012);
      const ev = [];
      const off = g.events.on('crush', (e) => ev.push(e.target === c));
      for (let i = 0; i < 60 * 3; i++) {
        window.__src32.throttle = 1;
        g.step(1 / 60);
      }
      window.__src32.throttle = 0;
      off();
      return { crushed: !!c.crushed, wrecked: c.wrecked, ev };
    });
    await tankFrame();
    await page.screenshot({ path: 'shots/tank-crush.png' });
    check(crush.crushed && crush.wrecked && crush.ev.includes(true), `the tank crushes a car in its path (${JSON.stringify(crush)})`);
    await page.evaluate(() => {
      const g = window.__rw;
      const t = window.__tk;
      for (let i = 0; i < 60 * 3 && t.speed > 0.2; i++) {
        window.__src32.brake = 1;
        g.step(1 / 60);
      }
      window.__src32.brake = 0;
      g.input.press('enter');
      g.step(1 / 60);
      g.input.release('enter');
      g.step(1 / 60);
    });
    check(await page.evaluate(() => window.__rw.player.mode === 'foot'), 'gets out of the tank');
  }

  // ---- Task 33: the Gannetfang and the Lampwatch, flown through the real
  // controls (input actions), stepped by hand. ----
  // A control source like the touch pedals and stick (input.poll reads it).
  await page.evaluate(() => {
    window.__src33 = window.__rw.input.addSource({ steer: 0, throttle: 0, brake: 0, pitch: 0 });
  });
  // Camera caught up with the craft (hand stepping skips the chase smoothing).
  const snapFrame = () => page.evaluate(() => {
    const g = window.__rw;
    g.draw(1, 1 / 60);
    g.chase.snap(g.camTarget);
    for (let i = 0; i < 3; i++) g.draw(1, 1 / 60);
  });
  const boardCraft = (spec) => page.evaluate((id) => {
    const g = window.__rw;
    const c = g.vehicles.find((v) => v.spec.id === id && !v.wrecked && v.home);
    if (!c) return null;
    if (g.player.vehicle) {
      g.player.vehicle.driver = null;
      g.player.vehicle = null;
      g.setPlayerMode('foot');
    }
    const w = g.player.walker;
    w.x = w.px = c.x + 3;
    w.z = w.pz = c.z + 3;
    g.player.x = w.x;
    g.player.z = w.z;
    g.chase.snap(g.camTarget);
    g.enterVehicle(c);
    return { id: c.id, x: c.x, z: c.z, mode: g.player.mode };
  }, spec);
  await resetPlayer();
  const jetIn = await boardCraft('fighter');
  check(jetIn && jetIn.mode === 'plane', `boards the parked Gannetfang (${JSON.stringify(jetIn)})`);
  await page.evaluate(() => { for (let i = 0; i < 30; i++) window.__rw.step(1 / 60); });
  await snapFrame();
  await page.screenshot({ path: 'shots/fighter-apron.png' });
  const jet = await page.evaluate(() => {
    const g = window.__rw;
    const f = g.player.vehicle;
    // Taxi out: the parked fighter faces the runway (north), turn west along it.
    f.heading = f.pheading = 0;
    f.z = f.pz = (g.city.airfield.runway.z0 + g.city.airfield.runway.z1) / 2;
    f.x = f.px = g.city.airfield.runway.x0 + 40;
    let lift = -1;
    for (let i = 0; i < 60 * 8; i++) {
      window.__src33.throttle = 1;
      window.__src33.pitch = i > 60 ? 0.35 : 0;
      g.step(1 / 60);
      if (lift < 0 && !f.onGround) lift = i / 60;
    }
    window.__src33.pitch = 0;
    return { lift: +lift.toFixed(2), y: +f.y.toFixed(1), v: +f.airspeed.toFixed(1), ab: +f.afterburner.toFixed(2), wrecked: f.wrecked };
  });
  check(jet.lift > 0 && jet.lift < 4 && jet.y > 30 && !jet.wrecked && jet.ab > 0.9, `the fighter takes off on afterburner (${JSON.stringify(jet)})`);
  await snapFrame();
  await page.screenshot({ path: 'shots/fighter-flight.png' });
  const jetMsl = await page.evaluate(() => {
    const g = window.__rw;
    const f = g.player.vehicle;
    const launches = [];
    const off = g.events.on('launch', (e) => launches.push(e.weapon));
    g.input.press('fire2');
    for (let i = 0; i < 6; i++) g.step(1 / 60);
    g.input.release('fire2');
    g.input.press('fire');
    for (let i = 0; i < 20; i++) g.step(1 / 60);
    g.input.release('fire');
    window.__src33.throttle = 0;
    off();
    return { launches, mag: f.arms && f.arms.mag };
  });
  check(jetMsl.launches.includes('missile') && jetMsl.mag && jetMsl.mag.nosegun === 120 && jetMsl.mag.missile === 2,
    `the fighter fires a missile (MSL) and the nose gun, with unlimited ammo (${JSON.stringify(jetMsl)})`);
  await snapFrame();
  await page.screenshot({ path: 'shots/fighter-missile.png' });

  const heliIn = await boardCraft('patrolheli');
  check(heliIn && heliIn.mode === 'heli', `boards the parked Lampwatch (${JSON.stringify(heliIn)})`);
  const heli = await page.evaluate(() => {
    const g = window.__rw;
    const h = g.player.vehicle;
    const sirens = [];
    const off = g.events.on('siren', (e) => sirens.push(e && e.on));
    g.clock = 22.5; // night, so the beam shows
    g.input.press('horn');
    g.step(1 / 60);
    g.input.release('horn');
    g.input.press('spot');
    g.step(1 / 60);
    g.input.release('spot');
    for (let i = 0; i < 60 * 9; i++) {
      window.__src33.throttle = 1;
      g.step(1 / 60);
    }
    window.__src33.throttle = 0;
    for (let i = 0; i < 60; i++) g.step(1 / 60);
    off();
    return { y: +h.y.toFixed(1), ground: h.onGround, siren: h.siren, spot: h.spot, sirens };
  });
  check(!heli.ground && heli.y > 15 && heli.siren && heli.spot === 1, `the police heli lifts off with siren and spotlight (${JSON.stringify(heli)})`);
  await snapFrame();
  await page.screenshot({ path: 'shots/patrolheli-night.png' });
  // An AI police heli: spawn, orbit the player for a while.
  const ai = await page.evaluate(() => {
    const g = window.__rw;
    const p = g.helipilot.spawn({ dist: 200, angle: 0 });
    for (let i = 0; i < 60 * 20; i++) g.step(1 / 60);
    const r = { state: p.state, d: +p.dist.toFixed(1), wrecked: p.craft.wrecked, listed: g.vehicles.includes(p.craft) };
    window.__aiHeli = p;
    return r;
  });
  check(ai.listed && !ai.wrecked && (ai.state === 'orbit' || ai.state === 'arrive') && ai.d < 120, `an AI police heli arrives and orbits (${JSON.stringify(ai)})`);
  await snapFrame();
  await page.screenshot({ path: 'shots/patrolheli-ai.png' });
  await page.evaluate(() => {
    const g = window.__rw;
    window.__aiHeli.craft.removed || g.removeVehicle(window.__aiHeli.craft);
    g.clock = 12;
  });

  // ---- Stuck-player regressions: a wrecked craft must never leave the
  // player stranded on a roof or on the water. Stepped by hand. ----
  await resetPlayer();
  const spawnAndBoard = (specId, where) => page.evaluate(([id, at]) => {
    const g = window.__rw;
    if (g.player.vehicle) {
      g.player.vehicle.driver = null;
      g.player.vehicle = null;
      g.setPlayerMode('foot');
    }
    // An existing craft of that type, repaired and moved to the spot
    // (spawnCar makes cars only).
    const c = g.vehicles.find((v) => v.spec.id === id && v.home && !v.driver);
    if (!c) return false;
    c.wrecked = false;
    c.exploded = false;
    c.burning = false;
    c.health = c.spec.health;
    c.x = c.px = at.x;
    c.z = c.pz = at.z;
    c.y = c.py = at.y || 0;
    c.vx = c.vz = c.vy = 0;
    c.speed = 0;
    c.onGround = !at.y;
    c.placed = true;
    g.enterVehicle(c);
    window.__stuckCraft = c;
    return true;
  }, [specId, where]);
  const exitState = () => page.evaluate(() => {
    const g = window.__rw;
    const ok = g.exitVehicle();
    for (let i = 0; i < 30; i++) g.step(1 / 60);
    const w = g.player.walker;
    const inside = g.collision.boxes.some((b) => w.x >= b.x0 && w.x <= b.x1 && w.z >= b.z0 && w.z <= b.z1);
    return { ok, mode: g.player.mode, onFoot: !g.player.vehicle, x: +w.x.toFixed(1), z: +w.z.toFixed(1), inside, shore: +g.city.shoreDist(w.x, w.z).toFixed(1) };
  });
  const roof = await page.evaluate(() => {
    const boxes = window.__rw.collision.boxes.filter((b) => b.h >= 30);
    boxes.sort((a, b) => b.h - a.h);
    const b = boxes[0];
    return b ? { x: (b.x0 + b.x1) / 2, z: (b.z0 + b.z1) / 2, y: b.h } : null;
  });
  check(!!roof, `a building 30 m or taller exists (${JSON.stringify(roof)})`);
  if (roof) {
    for (const [id, label] of [['heli', 'helicopter'], ['prop', 'plane']]) {
      const boarded = await spawnAndBoard(id, roof);
      await page.evaluate(() => { window.__stuckCraft.wrecked = true; });
      const ex = await exitState();
      check(boarded && ex.ok && ex.mode === 'foot' && ex.onFoot && !ex.inside,
        `a wrecked ${label} on a ${roof.y} m roof lets the player out onto open ground (${JSON.stringify(ex)})`);
    }
  }
  const sea = await page.evaluate(() => {
    const g = window.__rw;
    let best = null;
    for (let x = -3000; x <= 3000; x += 250) {
      for (let z = -3000; z <= 3000; z += 250) {
        const d = g.city.shoreDist(x, z);
        if (d < -150 && (!best || d < best.d)) best = { x, z, d };
      }
    }
    return best;
  });
  check(!!sea, `open sea found (${JSON.stringify(sea)})`);
  if (sea) {
    const boarded = await spawnAndBoard('speedboat', { x: sea.x, z: sea.z });
    await page.evaluate(() => { window.__stuckCraft.wrecked = true; });
    const ex = await exitState();
    check(boarded && ex.ok && ex.onFoot && ex.shore > 0, `a wrecked boat far out at sea lets the player out on land (${JSON.stringify(ex)})`);
    // A craft that explodes over the sea with the player aboard.
    const boarded2 = await spawnAndBoard('heli', { x: sea.x, z: sea.z, y: 25 });
    const boom = await page.evaluate(() => {
      const g = window.__rw;
      const c = window.__stuckCraft;
      c.health = 1;
      g.combat.explode(c.x, c.y, c.z, 20);
      for (let i = 0; i < 90; i++) g.step(1 / 60);
      const w = g.player.walker;
      return { wrecked: !!c.wrecked, onFoot: !g.player.vehicle && g.player.mode === 'foot', shore: +g.city.shoreDist(w.x, w.z).toFixed(1) };
    });
    check(boarded2 && !boom.wrecked && !boom.onFoot, `the player cannot die: a blast over the sea leaves the craft and pilot unharmed (${JSON.stringify(boom)})`);
  }

  // ---- Wrecks break apart and vanish (docs/COMBAT.md) ----
  // A fixture sedan on the open runway is destroyed: it explodes, throws
  // debris, and the hull leaves game.vehicles within 6 simulated seconds.
  const wreck = await page.evaluate(() => {
    const g = window.__rw;
    const rw = g.city.airfield.runway;
    const car = g.debug.spawnCar('sedan', rw.x0 + 330, (rw.z0 + rw.z1) / 2, 0);
    car.vx = car.vz = 0;
    car.speed = 0;
    let booms = 0, maxDebris = 0, removedAt = -1, wreckedAt = -1;
    const off = g.events.on('explosion', () => booms++);
    g.combat.damage(car, 1e5, null, 'blast');
    const listedAfterBlast = g.vehicles.includes(car);
    for (let i = 0; i < 60 * 6; i++) {
      g.step(1 / 60);
      if (car.wrecked && wreckedAt < 0) wreckedAt = i;
      maxDebris = Math.max(maxDebris, g.combatFx.counts().debris);
      if (car.removed && removedAt < 0) removedAt = i;
    }
    off();
    return { booms, maxDebris, wreckedAt, removedAt, listedAfterBlast, listed: g.vehicles.includes(car), meshGone: !car.mesh,
      player: g.player.mode };
  });
  check(wreck.booms >= 1 && wreck.wreckedAt >= 0 && wreck.listedAfterBlast, `a destroyed car explodes and is wrecked (${JSON.stringify(wreck)})`);
  check(wreck.maxDebris >= 6 && wreck.maxDebris <= 48, `the wreck throws 6 to 48 debris chunks (${wreck.maxDebris})`);
  check(wreck.removedAt > 60 && wreck.removedAt < 60 * 6 && !wreck.listed && wreck.meshGone, `the wreck is removed from game.vehicles within 6 s (${wreck.removedAt} steps)`);

  // ---- Cops are killable; missiles and blasts hit what they should (docs/COMBAT.md) ----
  // Shoot the officers of a patrol car through the car; then a missile from the
  // fighter on a fixture sedan; a blast throws a nearby fixture sedan.
  const copKill = await page.evaluate(() => {
    const g = window.__rw;
    const run = (n) => { for (let i = 0; i < n; i++) g.step(1 / 60); };
    const p = g.player;
    if (p.vehicle) {
      p.vehicle.driver = null;
      p.vehicle = null;
    }
    g.setPlayerMode('foot');
    const w = p.walker;
    w.x = w.px = g.city.spawn.x;
    w.z = w.pz = g.city.spawn.z + 6;
    w.heading = w.pheading = 0;
    w.hp = w.maxHp || 100;
    w.life = 'ok';
    w.arms.weapon = 'pistol';
    run(30);
    g.police.heat.level = 2;
    g.police.heat.points = 2.5;
    let car = null;
    for (let i = 0; i < 1500 && !car; i++) {
      run(1);
      car = g.police.cars.find((c) => c.occ && c.role !== 'dead');
    }
    if (!car) return { ok: false, why: 'no patrol car' };
    const downs = [];
    const off = g.events.on('down', (d) => { if (d.target.team === 'police' && d.target.hp <= 0) downs.push(d.kind); });
    for (let i = 0; i < 40 && car.occ.some((h) => h > 0); i++) {
      car.x = car.px = w.x + 14;
      car.z = car.pz = w.z;
      car.vx = car.vz = car.speed = 0;
      g.combat.fire(w, 14, 1.0 - 1.4, 0);
      run(14);
    }
    run(30);
    off();
    return { ok: true, downs, occ: car.occ.slice(), role: car.role, wrecked: !!car.wrecked, level: g.police.heat.level };
  });
  check(copKill.ok && copKill.downs.length === 2 && copKill.occ.every((h) => h <= 0) && copKill.role === 'dead' && !copKill.wrecked && copKill.level >= 2,
    `shooting a patrol car kills both officers through the car (${JSON.stringify(copKill)})`);
  const blastToss = await page.evaluate(() => {
    const g = window.__rw;
    const rw = g.city.airfield.runway;
    const car = g.debug.spawnCar('sedan', rw.x0 + 300, (rw.z0 + rw.z1) / 2, 0);
    car.vx = car.vz = car.speed = 0;
    car.spec = { ...car.spec, health: 1e6 };
    car.health = 1e6;
    g.combat.explode(car.x + 4, 0.5, car.z, 8, null);
    let peak = 0;
    for (let i = 0; i < 120; i++) {
      g.step(1 / 60);
      peak = Math.max(peak, car.y);
    }
    g.draw(1, 1 / 60);
    return { peak: +peak.toFixed(2), y: car.y, size: 'ok' };
  });
  check(blastToss.peak > 0.4 && blastToss.y === 0, `a blast throws a nearby car into the air and it lands again (${JSON.stringify(blastToss)})`);

  // --- Carjacking: ENTER on an occupied car (docs/STATUS.md) -------------
  // A civilian sits in a damaged coloured muscle car. The player on foot
  // taps ENTER: runs to the door, the driver is dragged out and thrown, the
  // player takes the seat. Then: the driver lies on the ground, gets up and
  // runs, and is removed cleanly; the stolen car keeps colour and damage.
  const jackRun = await page.evaluate(() => {
    const g = window.__rw;
    const p = g.player;
    if (p.vehicle) {
      p.vehicle.driver = null;
      p.vehicle = null;
    }
    g.setPlayerMode('foot');
    const sp = g.city.spawn;
    // First leave an empty van where it can be found again (garage check below).
    const van = g.debug.spawnCar('van', sp.x - 30, sp.z - 6, 0.3);
    van.parked = false;
    const w = p.walker;
    w.x = w.px = van.x - 4;
    w.z = w.pz = van.z;
    for (let i = 0; i < 5; i++) g.step(1 / 60);
    g.tryEnterVehicle(van);
    g.step(1 / 60);
    van.vx = van.vz = van.speed = 0;
    const left = g.exitVehicle();
    window.__van = { x: van.x, z: van.z, color: van.color };
    // The target car and its driver.
    const car = g.debug.spawnOccupied('muscle', sp.x + 30, sp.z + 4, 0.4, 'civ');
    car.health = car.spec.health * 0.6;
    const want = { color: car.color, health: car.health, id: car.id };
    w.x = w.px = car.x - 4.2;
    w.z = w.pz = car.z - 1.5;
    w.heading = w.pheading = 0.3;
    for (let i = 0; i < 10; i++) g.step(1 / 60);
    const nearBefore = p.near === car;
    g.input.press('enter');
    g.step(1 / 60);
    g.input.release('enter');
    const started = g.carjack.busy;
    let events = 0, downEv = 0;
    const offs = [g.events.on('carjack', (e) => { if (e.car === car && e.victim && e.thief === p) events++; }), g.events.on('down', () => downEv++)];
    let steps = 0;
    while (g.carjack.busy && steps < 600) {
      g.step(1 / 60);
      steps++;
    }
    offs.forEach((f) => f());
    const victim = g.carjack.victims[0] || null;
    const vs = victim ? { life: victim.life, actor: g.actors.includes(victim), d: Math.hypot(victim.x - car.x, victim.z - car.z) } : null;
    return { left, nearBefore, started, steps, events, downEv, mode: p.mode, inCar: p.vehicle === car, want, color: car.color, health: car.health, driver: car.driver, victim: vs };
  });
  check(jackRun.left && jackRun.nearBefore && jackRun.started, `ENTER on an occupied car starts a carjack (${JSON.stringify({ l: jackRun.left, n: jackRun.nearBefore, s: jackRun.started })})`);
  check(jackRun.steps > 20 && jackRun.steps < 200 && jackRun.mode === 'car' && jackRun.inCar && jackRun.driver === 'player', `the player ends up driving the jacked car (mode ${jackRun.mode}, ${jackRun.steps} steps)`);
  check(jackRun.events === 1 && jackRun.downEv >= 1, `'carjack' and 'down' events fired (${jackRun.events}, ${jackRun.downEv})`);
  check(jackRun.victim && jackRun.victim.actor && jackRun.victim.life === 'down' && jackRun.victim.d > 0.5, `the driver is out, a real actor, on the ground (${JSON.stringify(jackRun.victim)})`);
  check(jackRun.color === jackRun.want.color && jackRun.health === jackRun.want.health, 'the stolen car keeps its colour and damage');
  const after = await page.evaluate(() => {
    const g = window.__rw;
    const v = g.carjack.victims[0];
    const log = [];
    let upAt = -1, x0 = v.x, z0 = v.z, maxFlee = 0;
    for (let i = 0; i < 60 * 25 && !v.removedFlag; i++) {
      g.step(1 / 60);
      if (v.life === 'ok' && upAt < 0) upAt = i;
      maxFlee = Math.max(maxFlee, Math.hypot(v.x - x0, v.z - z0));
      if (!g.actors.includes(v)) break;
      if (!Number.isFinite(v.x) || !Number.isFinite(v.z)) log.push('nan');
      if (!Number.isFinite(g.player.x)) log.push('player nan');
    }
    return { upAt, maxFlee, gone: !g.actors.includes(v), left: g.carjack.victims.length, log, mode: g.player.mode };
  });
  check(after.upAt > 60 && after.upAt < 60 * 4 && after.maxFlee > 8, `the driver gets up and runs (up at ${after.upAt}, ran ${after.maxFlee.toFixed(1)} m)`);
  check(after.gone && after.left === 0 && after.log.length === 0, `the driver is removed cleanly (${JSON.stringify(after)})`);
  // A fast car cannot be entered on foot.
  const fast = await page.evaluate(() => {
    const g = window.__rw;
    const p = g.player;
    p.vehicle.vx = p.vehicle.vz = p.vehicle.speed = 0;
    g.exitVehicle();
    const sp = g.city.spawn;
    const car = g.debug.spawnOccupied('sedan', sp.x + 60, sp.z + 4, 0, 'civ');
    car.speed = 6;
    const w = p.walker;
    w.x = w.px = car.x - 3;
    w.z = w.pz = car.z - 1.5;
    car.asleep = true; // keep it from moving: only the speed field matters here
    g.step(1 / 60);
    const hidden = p.near !== car;
    car.speed = 1;
    g.step(1 / 60);
    return { hidden, shown: p.near === car };
  });
  check(fast.hidden && fast.shown, `a fast occupied car cannot be entered, a slow one can (${JSON.stringify(fast)})`);

  // --- Persistent car and place -----------------------------------------
  // Steal a car, save, reload the page with the same storage and expect to
  // be in the same stolen car; the van left earlier is parked where it was.
  // The van is left on a junction, where police and traffic may nudge it
  // before the save. Compare with the garage entry as saved, not with where
  // it stood when the player got out.
  const saved = await page.evaluate(() => {
    const g = window.__rw;
    const p = g.player;
    const sp = g.city.spawn;
    // A road junction near the start: always open ground.
    let node = g.city.nodes[0];
    for (const n of g.city.nodes) if (Math.hypot(n.x - sp.x - 90, n.z - sp.z) < Math.hypot(node.x - sp.x - 90, node.z - sp.z)) node = n;
    const car = g.debug.spawnOccupied('pickup', node.x, node.z, 0, 'civ');
    car.health = car.spec.health * 0.7;
    const w = p.walker;
    w.x = w.px = car.x - 3.4;
    w.z = w.pz = car.z - 1.2;
    for (let i = 0; i < 5; i++) g.step(1 / 60);
    g.input.press('enter');
    g.step(1 / 60);
    g.input.release('enter');
    for (let i = 0; i < 200; i++) g.step(1 / 60);
    const ok = p.vehicle === car;
    if (!ok) return { ok, mode: p.mode, near: !!p.near, busy: g.carjack.busy };
    car.vx = car.vz = car.speed = 0;
    g.saveSession();
    const raw = JSON.parse(localStorage.getItem('rustwater.save.v1'));
    return { ok, spec: car.spec.id, color: car.color, x: car.x, z: car.z, health: car.health / car.spec.health, raw: raw.session, ver: raw.version, van: (raw.session.garage.find((e) => e.spec === 'van') || window.__van), garage: g.garage.length };
  });
  check(saved.ok && saved.ver === 3 && saved.raw && saved.raw.mode === 'car' && saved.raw.craft.spec === 'pickup', `the stolen car is saved (${JSON.stringify(saved.raw ? saved.raw.craft : saved)})`);
  check(saved.raw && saved.raw.garage.some((e) => e.spec === 'van'), 'the van left earlier is in the saved garage');
  await page.reload();
  await page.waitForFunction(() => window.__rw && window.__rw.loop.running, null, { timeout: 30000 });
  await page.waitForTimeout(500);
  const back = await page.evaluate(() => {
    const g = window.__rw;
    const p = g.player, v = p.vehicle;
    for (let i = 0; i < 90; i++) g.step(1 / 60);
    return {
      mode: p.mode, spec: v && v.spec.id, color: v && v.color, x: v && v.x, z: v && v.z, hp: v && v.health / v.spec.health,
      wanted: p.wanted, finite: !!v && Number.isFinite(v.x) && Number.isFinite(v.z) && Number.isFinite(v.heading),
      vans: g.vehicles.filter((c) => c.spec.id === 'van' && c.parked).map((c) => ({ x: c.x, z: c.z, color: c.color })),
      cars: g.vehicles.filter((c) => c.kind === 'car' && c.driver === 'player').length,
    };
  });
  check(back.mode === 'car' && back.spec === saved.spec && back.color === saved.color, `reload resumes in the same car (${back.mode} ${back.spec} ${back.color}, want ${saved.spec} ${saved.color})`);
  check(back.finite && Math.hypot(back.x - saved.x, back.z - saved.z) < 6 && Math.abs(back.hp - saved.health) < 0.02 && back.cars === 1, `resumed near the same spot with the same damage (${back.x && back.x.toFixed(1)}, ${back.z && back.z.toFixed(1)} vs ${saved.x.toFixed(1)}, ${saved.z.toFixed(1)}; hp ${back.hp})`);
  check(back.wanted === 0, 'wanted level is not restored');
  check(back.vans.some((c) => Math.hypot(c.x - saved.van.x, c.z - saved.van.z) < 2.5 && c.color === saved.van.color), `the previous car is parked where it was left (${JSON.stringify(back.vans)} vs ${JSON.stringify(saved.van)})`);
  // On foot is remembered too, and "New game" forgets place and car only.
  const foot = await page.evaluate(() => {
    const g = window.__rw;
    g.player.vehicle.vx = g.player.vehicle.vz = g.player.vehicle.speed = 0;
    g.exitVehicle();
    g.saveSession();
    const s = JSON.parse(localStorage.getItem('rustwater.save.v1'));
    const total = g.progress.score.total;
    g.progress.score.total = 4321;
    g.newSession();
    const s2 = JSON.parse(localStorage.getItem('rustwater.save.v1'));
    return { mode: s.session.mode, after: s2.session, mode2: g.player.mode, spec: g.player.vehicle && g.player.vehicle.spec.id, score: s2.score.total, total };
  });
  check(foot.mode === 'foot', 'leaving the car saves "on foot"');
  check(foot.after === null && foot.mode2 === 'car' && foot.spec === 'sedan' && foot.score === 4321, `New game resets the car and place but keeps scores (${JSON.stringify(foot)})`);

  // Hard mode (settings.mortal): the player can die, a health meter shows,
  // and RESPAWN works from a craft and on foot.
  const hard = await page.evaluate(() => {
    const g = window.__rw;
    g.progress.settings.mortal = true;
    g.economy.applySettings();
    const out = {};
    const w = g.player.walker;
    // In the car: shots hurt the car, and the player is not dead.
    out.inCar = g.player.mode === 'car';
    const meterEl = document.querySelector('.rw-hpmeter');
    g.draw(1, 1 / 60);
    out.meterShown = !!meterEl && meterEl.offsetParent !== null;
    // RESPAWN from the car: out of it, on foot, full health.
    const car = g.player.vehicle;
    const cx = car.x, cz = car.z;
    g.input.press('respawn');
    g.step(1 / 60);
    g.input.release('respawn');
    out.afterRespawn = { mode: g.player.mode, vehicle: !!g.player.vehicle, hp: w.hp, carMoved: Math.hypot(car.x - cx, car.z - cz) < 1.5, driver: car.driver };
    // Kill the walker: down, fade, back up elsewhere with full health.
    g.combat.damage(w, 500, null, 'bullet');
    out.dead = w.life;
    for (let i = 0; i < 60 * 12 && !(w.life === 'ok' && w.hp > 0); i++) g.step(1 / 60);
    out.revived = { life: w.life, hp: w.hp, mode: g.player.mode };
    // Hurt, then RESPAWN on foot restores health.
    g.combat.damage(w, 40, null, 'fire');
    out.hurt = w.hp;
    g.input.press('respawn');
    g.step(1 / 60);
    g.input.release('respawn');
    out.healed = w.hp;
    g.draw(1, 1 / 60);
    out.text = document.querySelector('.rw-hptext').textContent;
    // Back to the default.
    g.progress.settings.mortal = false;
    g.economy.applySettings();
    g.draw(1, 1 / 60);
    out.meterHidden = meterEl.offsetParent === null;
    return out;
  });
  check(hard.inCar && hard.meterShown, 'hard mode shows the health meter');
  check(hard.afterRespawn.mode === 'foot' && !hard.afterRespawn.vehicle && hard.afterRespawn.hp > 99 && hard.afterRespawn.carMoved && hard.afterRespawn.driver === null, `RESPAWN in a car leaves it where it is and stands the player up (${JSON.stringify(hard.afterRespawn)})`);
  check(hard.dead === 'down' && hard.revived.life === 'ok' && hard.revived.hp > 99, `in hard mode the player can die and comes back with full health (${hard.dead}, ${JSON.stringify(hard.revived)})`);
  check(hard.hurt < 100 && hard.healed > 99 && hard.text === 'HP 100', `RESPAWN on foot restores health (${hard.hurt} -> ${hard.healed}, ${hard.text})`);
  check(hard.meterHidden, 'the health meter hides again with hard mode off');

  // ---- The Miami map (docs/MAP.md milestone 1): the same page reloads
  // with ?map=miami (every island check is done by now), drives for 300
  // steps with zero page errors. ----
  {
    const url = new URL(page.url());
    url.search = '?autostart&map=miami';
    const mp = page;
    const errs = [];
    mp.on('pageerror', (e) => errs.push(String(e)));
    mp.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
    const outside = [];
    mp.on('request', (r) => { if (!r.url().startsWith(url.origin + '/') && !r.url().startsWith('data:') && !r.url().startsWith('blob:')) outside.push(r.url()); });
    let ok = true;
    try {
      await mp.goto(url.href);
      await mp.waitForFunction(() => window.__rw && window.__rw.loop.running && window.__rw.city.map === 'miami', null, { timeout: 180000 });
    } catch (e) {
      ok = false;
      errs.push(String(e));
    }
    let m = null;
    if (ok) {
      await mp.keyboard.down('ArrowUp');
      await mp.waitForTimeout(200);
      m = await mp.evaluate(() => {
        const g = window.__rw;
        g.loop.stop();
        const c = g.city;
        const x0 = g.player.x, z0 = g.player.z;
        let finite = true;
        for (let i = 0; i < 300; i++) {
          g.step(1 / 60);
          for (const v of g.vehicles) if (!Number.isFinite(v.x + v.z + v.heading)) finite = false;
        }
        g.draw(1, 1 / 60);
        return {
          map: c.map, buildMs: c.buildMs, meshMs: Math.round(g.cityMesh.userData.buildMs), finite,
          moved: Math.hypot(g.player.x - x0, g.player.z - z0), cars: g.vehicles.length,
          traffic: g.traffic.count, peds: g.peds.count, onLand: c.shoreDist(g.player.x, g.player.z) > 0,
          calls: g.renderer.info.render.calls, tris: g.renderer.info.render.triangles,
        };
      });
      await mp.keyboard.up('ArrowUp');
      await mp.screenshot({ path: 'shots/miami.png' });
    }
    check(ok && m && m.map === 'miami', `?map=miami starts the Miami map (city ${m && m.buildMs} ms, mesh ${m && m.meshMs} ms)`);
    check(!!m && m.finite && m.onLand && m.moved > 3 && m.cars > 3, `Miami: 300 steps, the car drives on land (${m && m.moved.toFixed(1)} m, ${m && m.cars} vehicles, ${m && m.traffic} traffic, ${m && m.peds} peds, ${m && m.calls} draw calls, ${m && m.tris} triangles)`);

    // Milestone 2: on Miami, start one land race, one boat course and one
    // sky course through the start offer (stopped in the zone, START), run
    // each to the finish, and drive a street stunt ramp. All simulated
    // steps (the page loop is stopped), so nothing depends on frame rate.
    let acts = null;
    if (ok) {
      acts = await mp.evaluate(() => {
        const g = window.__rw;
        const run = (n) => { for (let i = 0; i < n; i++) g.step(1 / 60); };
        const leave = () => {
          const v = g.player.vehicle;
          if (!v) return;
          v.vx = v.vz = 0;
          v.speed = 0;
          v.driver = null;
          g.player.vehicle = null;
          g.setPlayerMode('foot');
        };
        const place = (c, p, y = 0) => {
          c.x = c.px = p.x;
          c.z = c.pz = p.z;
          c.y = c.py = y;
          c.vx = c.vz = 0;
          if ('vy' in c) c.vy = 0;
          c.speed = 0;
          if (Number.isFinite(p.heading)) c.heading = p.heading;
          if ('onGround' in c) c.onGround = !(y > 0); // an aircraft put in the air is flying
        };
        const board = (pick) => {
          leave();
          const c = g.vehicles.find(pick);
          if (!c) return null;
          c.wrecked = false;
          c.health = c.spec.health;
          const w = g.player.walker;
          w.x = w.px = c.x;
          w.z = w.pz = c.z;
          g.enterVehicle(c);
          return g.player.vehicle === c ? c : null;
        };
        const race = (id, pick) => {
          const course = g.activities.courses.find((c) => c.id === id);
          const craft = board(pick);
          if (!course || !craft) return { id, error: 'no ' + (course ? 'craft' : 'course') };
          const score0 = g.progress.score.total;
          place(craft, course.start);
          run(30);
          const offered = g.activities.offer;
          const accepted = g.activities.acceptOffer();
          run(240); // countdown
          const running = !!g.activities.active && g.activities.active.phase === 'running';
          for (let lap = 0; lap < (course.laps || 1); lap++) {
            for (const cp of course.checkpoints) {
              place(craft, cp, cp.y || 0);
              run(cp.kind === 'pad' ? 30 : 12);
            }
          }
          run(30);
          return {
            id, name: course.name, offered: offered === id, accepted, running, done: !g.activities.active,
            medal: g.progress.medals[id] || null, gained: g.progress.score.total - score0,
          };
        };
        const out = {};
        // First a street ramp, in the car from the drive above: 30 m short
        // of the Wynwood Kicker at 25 m/s along the street, it flies off
        // the ramp and lands.
        const ramp = g.city.rampSpots.find((s) => s.id === 'stunt_wynwood_kicker');
        const car = g.player.vehicle && g.player.vehicle.kind === 'car' ? g.player.vehicle : board((v) => v.kind === 'car' && !v.ai && !v.wrecked && v.spec.id !== 'ghostwake');
        const jumps = [];
        g.events.on('stunt', (e) => jumps.push({ id: e.spot && e.spot.id, ok: e.ok, air: Math.round(e.air * 100) / 100, points: e.points }));
        let airborne = false, peak = 0;
        if (ramp && car) {
          if (g.traffic && g.traffic.clear) g.traffic.clear();
          place(car, { x: ramp.x - ramp.ax * 30, z: ramp.z - ramp.az * 30, heading: Math.atan2(ramp.az, ramp.ax) });
          car.vx = ramp.ax * 25;
          car.vz = ramp.az * 25;
          car.speed = 25;
          for (let i = 0; i < 240; i++) {
            g.step(1 / 60);
            if (car.air && car.air.on) airborne = true;
            peak = Math.max(peak, car.y);
          }
        }
        out.ramp = { name: ramp && ramp.name, airborne, peak: Math.round(peak * 10) / 10, jumps };
        out.street = race('street-glasswell', (v) => v.kind === 'car' && !v.ai && !v.wrecked && v.spec.id !== 'ghostwake');
        out.boat = race('boat-slalom', (v) => v.kind === 'boat' && v.spec.id === 'speedboat');
        out.sky = race('sky-gull', (v) => v.kind === 'plane' && v.spec.id === 'prop');
        g.draw(1, 1 / 60);
        return out;
      });
    }
    const raceOk = (r) => !!r && r.offered && r.accepted && r.running && r.done && !!r.medal && r.gained > 0;
    for (const k of ['street', 'boat', 'sky']) {
      const r = acts && acts[k];
      check(raceOk(r), `Miami: the ${k} course "${r && r.name}" is offered at its start, runs and finishes (${JSON.stringify(r)})`);
    }
    const rj = acts && acts.ramp;
    check(!!rj && rj.airborne && rj.peak > 2 && rj.jumps.length >= 1 && rj.jumps[0].ok, `Miami: a car flies off the ${rj && rj.name} stunt ramp and lands (${JSON.stringify(rj)})`);
    check(outside.length === 0, `Miami: no outside network requests (${outside.length})`);
    check(errs.length === 0, `Miami: no page errors (${errs.length})`);
    for (const e of errs.slice(0, 10)) console.log('   ', e);
  }
}
