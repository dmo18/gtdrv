// Developer helper (0.13.5 on-foot review): the player on foot in the real
// game at phone size (748x360 landscape, touch, headless Chromium). In each
// region: stop the start car and step out (largest camera jump a frame),
// walk, then every on-foot weapon in turn by the SWAP action (held FIRE
// for 1 s: shots fired, the weapon it ended on), RELOAD, LOCK on a crew
// gunman, a wrench swing at a person, and back into the car with ENTER
// (camera jump again). Prints one JSON line a region and any page errors.
//   node scripts/foot-review.mjs [--only=miami-beach,...] [--no-build]
// The game is built into FOOT_BUILD (default: a folder under the OS temp
// dir), never into dist/.
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildGame, serve } from './build.mjs';

let chromium;
try {
  ({ chromium } = await import('playwright'));
} catch {
  ({ chromium } = createRequire('/opt/node-tools/node_modules/')('playwright'));
}
const flag = (n) => process.argv.includes('--' + n);
const onlyArg = process.argv.find((a) => a.startsWith('--only='));
const REGIONS = onlyArg ? onlyArg.slice(7).split(',') : ['miami-beach', 'miami-downtown', 'miami-north', 'miami-west', 'miami-south'];
const priv = process.env.FOOT_BUILD || join(tmpdir(), 'rustwater-foot-build');
if (!flag('no-build')) await buildGame({ outDir: priv });
const server = await serve(0, priv);
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const errors = [];
let bad = 0;

for (const id of REGIONS) {
  const page = await browser.newPage({ viewport: { width: 748, height: 360 }, hasTouch: true, isMobile: true, deviceScaleFactor: 1 });
  page.setDefaultTimeout(300000);
  page.on('pageerror', (e) => errors.push(`${id}: ${String(e)}`));
  await page.goto(`http://127.0.0.1:${server.address().port}/?autostart&map=${id}`);
  await page.waitForFunction(() => window.__rw && window.__rw.loop.running, null, { timeout: 200000 });
  await page.evaluate(() => window.__rw.loop.stop());
  // Steps the game by hand (the machine may draw 2 frames a second): `n`
  // fixed steps, a draw after each when `draw`; returns the largest
  // camera move between two drawn frames.
  await page.evaluate(() => {
    const g = window.__rw;
    g.__foot = { shots: 0 };
    g.events.on('shot', (s) => { if (s && s.shooter === g.player.walker) g.__foot.shots++; });
    g.__run = (n, draw, hold) => {
      const c = g.camera.position;
      let jump = 0, px = c.x, py = c.y, pz = c.z;
      for (let i = 0; i < n; i++) {
        if (hold && i === 0) g.input.press(hold);
        g.step(1 / 60);
        if (hold && i === 0 && hold !== 'fire') g.input.release(hold);
        if (draw || i === n - 1) {
          g.draw(1, 1 / 60);
          jump = Math.max(jump, Math.hypot(c.x - px, c.y - py, c.z - pz));
          px = c.x; py = c.y; pz = c.z;
        }
      }
      if (hold === 'fire') g.input.release('fire');
      return +jump.toFixed(2);
    };
  });
  const run = (n, draw = false, hold = null) => page.evaluate(([a, b, c]) => window.__rw.__run(a, b, c), [n, draw, hold]);
  const out = { region: id };

  // Stop and step out.
  await page.evaluate(() => { const v = window.__rw.player.vehicle; v.vx = v.vz = 0; v.speed = 0; });
  await run(30, true);
  out.exitJump = await run(60, true, 'enter');
  out.mode = await page.evaluate(() => window.__rw.player.mode);
  if (out.mode !== 'foot') bad++;
  out.exitClear = await page.evaluate(() => {
    const g = window.__rw, w = g.player.walker, v = g.vehicles.find((c) => c.starter) || g.vehicles[0];
    return g.collision.lineClear(v.x, v.z, w.x, w.z) && !g.collision.resolveCircle(w.x, w.z, 0.3, 0).hit;
  });
  // Walk: the stick ahead for 2 s.
  const p0 = await page.evaluate(() => ({ x: window.__rw.player.x, z: window.__rw.player.z }));
  await page.keyboard.down('KeyW');
  await run(120);
  await page.keyboard.up('KeyW');
  const p1 = await page.evaluate(() => ({ x: window.__rw.player.x, z: window.__rw.player.z }));
  out.walked = +Math.hypot(p1.x - p0.x, p1.z - p0.z).toFixed(1);

  // Every weapon by SWAP, FIRE held 1 s each (thrown: released after).
  out.weapons = {};
  for (let k = 0; k < 7; k++) {
    await run(2, false, 'swap');
    const before = await page.evaluate(() => window.__rw.__foot.shots);
    await run(60, false, 'fire');
    await run(20);
    const r = await page.evaluate(() => ({ w: window.__rw.player.walker.arms.weapon, n: window.__rw.__foot.shots }));
    out.weapons[r.w] = r.n - before;
    if (!(r.n - before > 0)) bad++;
  }
  await run(10, false, 'reload');

  // LOCK with nothing about, twice: no lock left on.
  await run(5, false, 'lock');
  await run(5, false, 'lock');
  out.lockStuck = await page.evaluate(() => !!(window.__rw.aim && window.__rw.aim.locked));
  if (out.lockStuck) bad++;

  // Back into the car: stand by its door and ENTER.
  await page.evaluate(() => {
    const g = window.__rw;
    const v = g.vehicles.find((c) => c.starter) || g.vehicles[0];
    const w = g.player.walker;
    const s = Math.sin(v.heading), c = Math.cos(v.heading), side = v.spec.width / 2 + 0.6;
    let x = v.x + s * side, z = v.z - c * side;
    if (g.collision.resolveCircle(x, z, 0.35, 0).hit) { x = v.x - s * side; z = v.z + c * side; }
    w.x = w.px = x; w.z = w.pz = z;
  });
  await run(90, true); // let the camera settle after the teleport
  out.enterJump = await run(60, true, 'enter');
  out.mode2 = await page.evaluate(() => window.__rw.player.mode);
  if (out.mode2 === 'foot') bad++;
  await page.close();
  console.log(JSON.stringify(out));
}
console.log(errors.length ? errors.join('\n') : 'no page errors');
await browser.close();
server.close();
process.exit(bad || errors.length ? 1 : 0);
