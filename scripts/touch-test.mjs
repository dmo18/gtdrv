// Multi-touch steering test on the BUILT game (docs/UI.md "Steering styles").
// Real touches through the Chrome DevTools Protocol (Input.dispatchTouchEvent,
// two and three fingers at once) in headless Chromium at the owner's phone
// sizes: 748x360 (fullscreen) and 748x285 (browser bars showing), plus 915x412.
// For each steering style (wheel, buttons, tilt fallback, slider) it holds GAS
// with one finger and steers with another, then BRAKE plus steer, FIRE plus
// steer, a look drag beside the steering, a third finger in the steering zone,
// a touchcancel and a finger that slides off the screen edge. The steering the
// game receives (window.__rw.input.steer after poll) is recorded against the
// finger path; the test fails on any lost, stolen, reversed, jumping or stuck
// steer. It also holds SWAP in a car and picks a drive-by weapon.
// Usage: node scripts/touch-test.mjs [--no-build] [--size 748x285]
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildGame, serve } from './build.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.join(here, '..', 'dist', 'touch-test');
const args = process.argv.slice(2);
const sizeArg = args.includes('--size') ? args[args.indexOf('--size') + 1] : null;
const SIZES = sizeArg ? [sizeArg.split('x').map(Number)] : [[748, 360], [748, 285], [915, 412]];
let chromium;
try { ({ chromium } = await import('playwright')); } catch { ({ chromium } = createRequire('/opt/node-tools/node_modules/')('playwright')); }

if (!args.includes('--no-build')) await buildGame({ outDir: out });
const srv = await serve(0, out);
const base = `http://127.0.0.1:${srv.address().port}/`;
const br = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
let checks = 0;
const failures = [];
const check = (name, ok, detail = '') => {
  checks++;
  if (!ok) failures.push(name);
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok || !detail ? '' : '  ' + detail}`);
};
const f2 = (v) => (Math.round(v * 100) / 100).toFixed(2);

try {
  for (const [W, H] of SIZES) {
    const ctx = await br.newContext({ viewport: { width: W, height: H }, hasTouch: true, isMobile: true, deviceScaleFactor: 1 });
    const pg = await ctx.newPage();
    const errs = [];
    pg.on('pageerror', (e) => errs.push(String(e)));
    await pg.goto(`${base}?autostart&map=miami-downtown`);
    await pg.waitForFunction(() => window.__rw && window.__rw.loop.running, null, { timeout: 120000 });
    await pg.waitForTimeout(1200);
    // Freeze the simulation: the test reads the touch source through input.poll() itself.
    await pg.evaluate(() => {
      const g = window.__rw;
      g.loop.stop();
      const v = g.vehicles.find((x) => x.kind === 'car' && !(x.spec && x.spec.extra));
      if (g.player.vehicle !== v) g.enterVehicle(v);
      g.chase.setView('Chase');
      g.touch.setHudMode('minimal');
      g.touch.setLeftHanded(false);
      g.touch.update(1 / 60);
    });
    const cdp = await ctx.newCDPSession(pg);
    const fingers = new Map();
    const send = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts || [...fingers].map(([id, p]) => ({ x: p.x, y: p.y, id })) });
    const down = async (id, x, y) => { fingers.set(id, { x, y }); await send('touchStart'); };
    const move = async (id, x, y) => { fingers.set(id, { x, y }); await send('touchMove'); };
    const up = async (id) => { const p = fingers.get(id); fingers.delete(id); await send('touchEnd', [{ x: p.x, y: p.y, id }]); };
    const cancelAll = async () => { fingers.clear(); await send('touchCancel', []); };
    // One simulation step's worth of touch update (buttons ramp, tilt smooths), then the merged input.
    const read = (steps = 1) => pg.evaluate((n) => {
      const g = window.__rw, i = g.input;
      for (let k = 0; k < n; k++) g.touch.update(1 / 60);
      i.poll();
      return { s: i.steer, t: i.throttle, b: i.brake, f: i.held('fire'), lx: i.lookX };
    }, steps);
    const rect = (sel) => pg.evaluate((s) => {
      const e = [...document.querySelectorAll(s)].find((q) => q.getBoundingClientRect().width > 0);
      if (!e) return null;
      const r = e.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2, l: r.left, t: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height };
    }, sel);
    const setStyle = (st) => pg.evaluate((s) => { window.__rw.touch.setSteering(s, 1); window.__rw.touch.update(1 / 60); }, st);
    const tag = `${W}x${H}`;
    const zone = await rect('.rw-stickzone');
    const map = await rect('.rw-minimap');
    check(`${tag}: the steering zone is the left 40 percent below the minimap`, zone && Math.abs(zone.l) < 1 && Math.abs(zone.r - W * 0.4) < 1.5 && zone.t <= map.b + 24 && zone.t >= map.b - 0.5 && Math.abs(zone.b - H) < 1,
      JSON.stringify({ zone, mapBottom: map.b }));
    const gas = await rect('.rw-touch .rw-gas');
    const brake = await rect('.rw-touch .rw-brake');
    const fire = await rect('.rw-touch .rw-dbfire');

    // The steering finger's path: right A px in steps of 10, back 2A, back to the start (A = 100).
    // Task PLANTED: the wheel's full input is at 80 px of travel (was 55), so its sweeps reach 100
    // px and must be full within 85. Returns the steer read after every step.
    const sweep = async (id, x0, y0, opts = {}) => {
      const A = opts.amp || 100, n = A / 10;
      const rows = [];
      await down(id, x0, y0);
      rows.push({ x: x0, ...(await read(opts.steps || 1)) });
      const path = [];
      for (let i = 1; i <= n; i++) path.push(x0 + i * 10);
      for (let i = 1; i <= 2 * n; i++) path.push(x0 + A - i * 10);
      for (let i = 1; i <= n; i++) path.push(x0 - A + i * 10);
      for (const x of path) {
        await move(id, x, y0 + (opts.dy || 0));
        rows.push({ x, ...(await read(opts.steps || 1)) });
      }
      await up(id);
      const after = await read(opts.steps || 1);
      return { rows, after };
    };
    // A sweep is good when: no steer at touch-down; every step moves the steer the way the finger
    // moved (right: up, left: down, or held at full lock), never the other way and never by more
    // than a small step (no jumps); full lock right within `fullPx` of travel from the start, full
    // lock left on the way back; and the steer is 0 after the finger lifts.
    const judge = (name, res, o = {}) => {
      const { rows, after } = res;
      const x0 = rows[0].x;
      const trace = rows.map((r) => f2(r.s)).join(' ');
      const atDown = rows[0].s;
      const maxStep = o.maxStep || 0.34;
      let wrong = 0, jump = 0;
      for (let i = 1; i < rows.length; i++) {
        const dx = rows[i].x - rows[i - 1].x, ds = rows[i].s - rows[i - 1].s;
        if ((dx > 0 && ds < -1e-6) || (dx < 0 && ds > 1e-6)) wrong++;
        if (Math.abs(ds) > maxStep) jump++;
      }
      const fullR = rows.find((r) => r.x - x0 <= (o.fullPx || 60) && r.x - x0 > 0 && r.s >= 0.999);
      const fullL = rows.some((r) => r.s <= -0.999);
      const ok = Math.abs(atDown) < 0.001 && wrong === 0 && jump === 0 && (o.noFull || (fullR && fullL)) && after.s === 0;
      check(`${tag} ${name}: no steer at touch-down, follows the finger both ways, no jump, full lock within ${o.fullPx || 60} px, 0 after lift`, ok,
        `down ${f2(atDown)} wrong ${wrong} jumps ${jump} fullR ${!!fullR} fullL ${fullL} after ${after.s} | ${trace}`);
      if (o.held) check(`${tag} ${name}: ${o.held} stays held the whole time`, rows.every((r) => o.heldOk(r)) && o.heldOk(after), trace);
      return ok;
    };

    const W0 = await rect('.rw-wheel');
    for (const style of ['wheel', 'slider', 'buttons', 'tilt']) {
      await setStyle(style);
      if (style === 'tilt') {
        // No orientation events in headless Chromium: tilt falls back to the wheel after 1 s.
        await pg.waitForTimeout(1300);
        const now = await pg.evaluate(() => window.__rw.touch.getSteering().style);
        check(`${tag} tilt without a sensor falls back to the wheel`, now === 'wheel', now);
      }
      const st = style === 'tilt' ? 'tilt-fallback' : style;
      const opts = style === 'buttons' ? { noFull: true, steps: 3 } : style === 'slider' ? { fullPx: 95, amp: 100 } : { fullPx: 85 };
      const wb = style === 'buttons' ? await rect('.rw-steerbtn.rw-sright') : null;
      // Starting points across the whole zone: below the wheel center, on it, at 3 o'clock, up near
      // the minimap, at the far right of the zone, at the bottom edge.
      const starts = style === 'buttons' ? [] : [
        ['below the wheel center', W0.x - 10, W0.y + 40], ['on the wheel center', W0.x - 40, W0.y + 2], ['at 3 o\'clock', W0.r - 4, W0.y],
        ['under the minimap', 40 + 80, zone.t + 12], ['far right of the zone', zone.r - 90, (zone.t + zone.b) / 2], ['bottom edge', W0.x, H - 6],
      ];
      await down(1, gas.x, gas.y);
      for (const [where, x, y] of starts) {
        judge(`${st}, GAS held, start ${where}`, await sweep(2, x, y, opts), { ...opts, held: 'GAS', heldOk: (r) => r.t === 1 });
      }
      if (style === 'buttons') {
        // The arrow pads ramp; a thumb anywhere else in the zone steers by its side of the slot.
        await down(2, wb.x, wb.y);
        const r1 = await read(20);
        await up(2);
        const r0 = await read(1);
        check(`${tag} buttons, GAS held: right pad ramps to full right, 0 on lift, GAS kept`, r1.s === 1 && r0.s === 0 && r1.t === 1 && r0.t === 1, JSON.stringify([r1, r0]));
        await down(2, zone.r - 20, (zone.t + zone.b) / 2);
        const z1 = await read(20);
        await move(2, 30, zone.b - 30);
        const z2 = await read(40);
        await up(2);
        const z0 = await read(1);
        check(`${tag} buttons: a thumb on the zone right of the slot steers right, slid left steers left, 0 on lift`, z1.s === 1 && z2.s === -1 && z0.s === 0, JSON.stringify([z1.s, z2.s, z0.s]));
      }
      await up(1);
      check(`${tag} ${st}: GAS released -> throttle 0`, (await read()).t === 0);
      if (style === 'buttons') continue;
      const sx = W0.x - 10, sy = W0.y - 55;
      // BRAKE plus steer.
      await down(1, brake.x, brake.y);
      judge(`${st}, BRAKE held`, await sweep(2, sx, sy, opts), { ...opts, held: 'BRAKE', heldOk: (r) => r.b === 1 });
      await up(1);
      // FIRE plus steer (the drive-by FIRE; its finger feeds the look drag).
      if (fire) {
        await down(1, fire.x, fire.y);
        judge(`${st}, FIRE held`, await sweep(2, sx, sy, opts), { ...opts, held: 'FIRE', heldOk: (r) => r.f === true });
        await up(1);
      }
      // A look drag on the right side while steering: steer is not lost or changed by it.
      await down(1, gas.x, gas.y);
      await down(2, sx, sy);
      await move(2, sx + 30, sy);
      const before = await read();
      await down(3, W * 0.62, H * 0.3);
      for (let i = 1; i <= 5; i++) await move(3, W * 0.62 - i * 15, H * 0.3);
      const during = await read();
      await up(3);
      const afterLook = await read();
      check(`${tag} ${st}: a look drag beside the steering finger moves the camera, the steer stays`,
        before.s > 0.2 && Math.abs(during.s - before.s) < 1e-6 && Math.abs(afterLook.s - before.s) < 1e-6 && during.lx !== before.lx && during.t === 1,
        JSON.stringify([before, during, afterLook]));
      // A third finger in the steering zone does not steal or cancel the steering finger.
      await down(4, zone.r - 30, zone.b - 30);
      await move(4, zone.r - 120, zone.b - 30);
      const third = await read();
      await up(4);
      const afterThird = await read();
      check(`${tag} ${st}: a second finger in the zone does not steal the steer`, Math.abs(third.s - before.s) < 1e-6 && Math.abs(afterThird.s - before.s) < 1e-6, JSON.stringify([before.s, third.s, afterThird.s]));
      // The steering finger slides to the left screen edge and past it, then back: still steering
      // (left, never released or reset at the edge), back right steers right, 0 on lift.
      await move(2, 4, sy);
      const edge = await read();
      await move(2, -10, sy);
      const offEdge = await read();
      await move(2, 44, sy);
      const back = await read();
      await up(2);
      const lift = await read();
      check(`${tag} ${st}: to the screen edge and past it the finger keeps steering left, back right steers right, 0 on lift`,
        edge.s < -0.5 && offEdge.s <= edge.s + 1e-6 && back.s > offEdge.s + 0.3 && lift.s === 0 && lift.t === 1, JSON.stringify([edge.s, offEdge.s, back.s, lift.s]));
      // touchcancel (an incoming call, a system gesture): nothing stays held; the next touch steers.
      await down(2, sx, sy);
      await move(2, sx + 40, sy);
      const pre = await read();
      await cancelAll();
      const canc = await read();
      await down(2, sx, sy);
      await move(2, sx + 40, sy);
      const again = await read();
      await up(2);
      const fin = await read();
      check(`${tag} ${st}: touchcancel clears steer and gas, the next touch steers again`, pre.s > 0.2 && canc.s === 0 && canc.t === 0 && again.s > 0.2 && fin.s === 0, JSON.stringify([pre.s, canc, again.s, fin.s]));
      if (style === 'wheel') {
        // The drawn wheel shows the input; it springs back on release.
        await down(2, W0.x - 10, W0.y + 10);
        await move(2, W0.x + 30, W0.y + 10);
        const half = await read();
        const rot = await pg.evaluate(() => document.querySelector('.rw-wheel-rot').style.transform);
        await up(2);
        const rotUp = await pg.evaluate(() => document.querySelector('.rw-wheel-rot').style.transform);
        check(`${tag} wheel: 40 px of travel is about half input and the drawn wheel turns right; back to center on release`,
          half.s > 0.4 && half.s < 0.6 && /rotate\(\d/.test(rot) && rotUp === '', JSON.stringify([half.s, rot, rotUp]));
        // Rotation about the center: dragging down the right side turns right.
        await down(2, W0.r - 8, W0.y - 20);
        for (let i = 1; i <= 6; i++) await move(2, W0.r - 8 - i, W0.y - 20 + i * 10);
        const rotR = await read();
        await up(2);
        check(`${tag} wheel: dragging down the right side of the wheel turns right`, rotR.s > 0.5, f2(rotR.s));
      }
    }
    // Left-handed: the zone and wheel mirror and steer the same way.
    await pg.evaluate(() => { window.__rw.touch.setLeftHanded(true); window.__rw.touch.setSteering('wheel', 1); window.__rw.touch.update(1 / 60); });
    const lz = await rect('.rw-stickzone');
    const lg = await rect('.rw-touch .rw-gas');
    await down(1, lg.x, lg.y);
    judge('left-handed wheel, GAS held', await sweep(2, (lz.l + lz.r) / 2, (lz.t + lz.b) / 2), { fullPx: 85, held: 'GAS', heldOk: (r) => r.t === 1 });
    await up(1);
    await pg.evaluate(() => { window.__rw.touch.setLeftHanded(false); window.__rw.touch.update(1 / 60); });
    // Sensitivity: 1.5 needs less travel, 0.5 more (full input at 80 / sensitivity px).
    for (const [sens, px] of [[1.5, 55], [0.5, 165]]) {
      await pg.evaluate((s) => window.__rw.touch.setSteering('wheel', s), sens);
      const x0 = W0.x - 20, y0 = W0.y + 10;
      await down(2, x0, y0);
      await move(2, x0 + px * 0.5, y0);
      const halfway = await read();
      await move(2, x0 + px, y0);
      const full = await read();
      await up(2);
      check(`${tag} wheel at sensitivity ${sens}: full input at about ${px} px`, full.s >= 0.999 && halfway.s < 0.6 && halfway.s > 0.3, JSON.stringify([halfway.s, full.s]));
    }
    await pg.evaluate(() => window.__rw.touch.setSteering('wheel', 1));

    // SWAP while driving: tap cycles the drive-by gun, hold opens the wheel of drive-by weapons, lift picks.
    const sw = await rect('.rw-touch .rw-a-carswap');
    check(`${tag} SWAP shows in a car`, !!sw, JSON.stringify(sw));
    if (sw) {
      const gun = () => pg.evaluate(() => window.__rw.player.walker.arms.lastGun);
      const g0 = await gun();
      await down(5, sw.x, sw.y);
      await pg.waitForTimeout(60);
      await up(5);
      const g1 = await gun();
      check(`${tag} SWAP tap in a car switches the drive-by gun`, g1 !== g0 && ['pistol', 'smg'].includes(g1), `${g0} -> ${g1}`);
      // hold with GAS and steering held: the wheel opens, a drag picks the other gun
      await down(1, gas.x, gas.y);
      await down(2, W0.x, W0.y - 30);
      await move(2, W0.x + 30, W0.y - 30);
      await down(5, sw.x, sw.y);
      await pg.waitForTimeout(400);
      const ww = await pg.evaluate(() => {
        const e = document.querySelector('.rw-ww');
        const sl = [...e.querySelectorAll('.rw-ww-slice')].filter((q) => getComputedStyle(q).display !== 'none').map((q) => q.dataset.weapon);
        const r = e.getBoundingClientRect();
        return { open: e.classList.contains('rw-ww-open'), slices: sl, cx: r.left + r.width / 2, cy: r.top + r.height / 2 };
      });
      check(`${tag} SWAP hold in a car opens the wheel with the drive-by weapons only`, ww.open && ww.slices.length === 2, JSON.stringify(ww));
      const want = g1 === 'pistol' ? 'smg' : 'pistol';
      const idx = ww.slices.indexOf(want);
      const ang = idx * Math.PI; // two slices: 0 up, 1 down
      await move(5, ww.cx + Math.sin(ang) * 70, ww.cy - Math.cos(ang) * 70);
      const mid = await read();
      const label = await pg.evaluate(() => document.querySelector('.rw-ww-label').textContent);
      await up(5);
      const g2 = await gun();
      const after = await read();
      check(`${tag} SWAP drag and lift in a car picks ${want}; steer and gas stay held`, g2 === want && mid.s > 0.3 && after.s > 0.3 && after.t === 1, `${g2} ${label} ${JSON.stringify([ww, mid, after])}`);
      await up(2);
      await up(1);
      check(`${tag} after SWAP: steer and gas released`, (await read()).s === 0 && (await read()).t === 0);
    }
    check(`${tag}: no page errors`, errs.length === 0, errs.slice(0, 3).join(' | '));
    await ctx.close();
  }
} finally {
  await br.close();
  srv.close();
}
console.log(failures.length ? `\nFAILED ${failures.length}/${checks}: ${failures.slice(0, 12).join('; ')}` : `\nPASSED ${checks}/${checks} checks`);
process.exit(failures.length ? 1 : 0);
