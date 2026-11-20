/* global rw -- injected by the harness page, used inside page.evaluate callbacks */
// Real-touch test of the on-screen controls and HUD in headless Chromium.
// Bundles src/ui with esbuild, serves scripts/ui-harness.html, drives it
// with CDP touch events. Exits non-zero on any failure.
import { build } from 'esbuild';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { readFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '..');
const out = path.join(repo, 'dist', 'ui-harness');

async function loadChromium() {
  try {
    return (await import('playwright')).chromium;
  } catch {
    const require = createRequire(import.meta.url);
    return require('/opt/node-tools/node_modules/playwright').chromium;
  }
}

await mkdir(out, { recursive: true });
await build({
  stdin: {
    resolveDir: repo,
    sourcefile: 'harness-entry.js',
    contents: `
      import { createInput, shapeSteer, tiltAngle, tiltToSteer } from './src/core/input.js';
      import { createTouchControls } from './src/ui/touch.js';
      import { createHud } from './src/ui/hud.js';
      const root = document.createElement('div');
      root.style.cssText = 'position:fixed;inset:0';
      document.body.appendChild(root);
      const input = createInput();
      const fallbacks = [];
      const touch = createTouchControls(root, input, { onSteerFallback: (s, why) => fallbacks.push(why) });
      const hud = createHud(root);
      window.rw = { input, touch, hud, shapeSteer, tiltAngle, tiltToSteer, fallbacks };
    `,
  },
  bundle: true, platform: 'browser', format: 'esm', outfile: path.join(out, 'harness.js'),
});

const html = await readFile(path.join(here, 'ui-harness.html'));
const js = await readFile(path.join(out, 'harness.js'));
const server = createServer((req, res) => {
  if (req.url === '/harness.js') {
    res.writeHead(200, { 'content-type': 'text/javascript' }).end(js);
  } else {
    res.writeHead(200, { 'content-type': 'text/html' }).end(html);
  }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const url = `http://127.0.0.1:${server.address().port}/`;

let checks = 0;
const failures = [];
function check(name, ok, detail = '') {
  checks++;
  if (!ok) failures.push(`${name} ${detail}`);
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name} ${detail}`);
}

const chromium = await loadChromium();
const browser = await chromium.launch();
try {
  const ctx = await browser.newContext({
    viewport: { width: 915, height: 412 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2,
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(url);
  await page.waitForFunction(() => window.rw);
  const cdp = await ctx.newCDPSession(page);

  // ---- helpers ----
  const fingers = new Map(); // id -> {x, y}
  const send = (type) => cdp.send('Input.dispatchTouchEvent', {
    type,
    touchPoints: [...fingers].map(([id, p]) => ({ x: p.x, y: p.y, id })),
  });
  const down = async (id, x, y) => { fingers.set(id, { x, y }); await send('touchStart'); };
  const move = async (id, x, y) => { fingers.set(id, { x, y }); await send('touchMove'); };
  // touchEnd lists only the points being lifted; the others stay down.
  const up = async (id) => {
    const p = fingers.get(id);
    fingers.delete(id);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [{ x: p.x, y: p.y, id }] });
  };
  // Drag in small steps so pointermove fires like a real thumb.
  const drag = async (id, x0, y0, x1, y1, steps = 8) => {
    for (let i = 1; i <= steps; i++) await move(id, x0 + (x1 - x0) * i / steps, y0 + (y1 - y0) * i / steps);
  };
  const read = (expr) => page.evaluate(`(() => { rw.input.poll(); return ${expr}; })()`);
  const center = (label) => page.evaluate((l) => {
    const r = document.querySelector(`[aria-label="${l}"]`).getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height };
  }, label);
  const shot = (name) => page.screenshot({ path: path.join(out, name) });

  // Static layout: sizes and labels.
  const gas = await center('Gas');
  const brake = await center('Brake / reverse');
  check('gas pedal ~84x110', Math.abs(gas.w - 84) < 2 && Math.abs(gas.h - 110) < 2, `${gas.w}x${gas.h}`);
  check('brake pedal left of gas', brake.x < gas.x);
  const small = await page.evaluate(() => [...document.querySelectorAll('.rw-btn')]
    .filter((b) => b.offsetParent).map((b) => Math.min(b.offsetWidth, b.offsetHeight)));
  check('all visible buttons >= 56px', Math.min(...small) >= 56, `min ${Math.min(...small)}`);

  // Wheel helpers: touch the rim at an angle (0 = top, clockwise +) and turn.
  const wheelBox = () => page.evaluate(() => {
    const r = document.querySelector('.rw-wheel').getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, vis: r.width > 0 };
  });
  const rimPt = (w, deg, rad = 62) => ({
    x: w.x + Math.sin(deg * Math.PI / 180) * rad, y: w.y - Math.cos(deg * Math.PI / 180) * rad,
  });
  const turn = async (id, w, from, to, step = 6) => {
    const n = Math.max(1, Math.ceil(Math.abs(to - from) / step));
    for (let i = 1; i <= n; i++) {
      const p = rimPt(w, from + (to - from) * i / n);
      await move(id, p.x, p.y);
    }
  };
  const wheelRot = () => page.evaluate(() => document.querySelector('.rw-wheel-rot').style.transform);
  const shape = (x, s = 1) => page.evaluate(([a, b]) => rw.shapeSteer(a, b), [x, s]);
  const tick = (n, dt = 1 / 60) => page.evaluate(([k, d]) => { for (let i = 0; i < k; i++) rw.touch.update(d); }, [n, dt]);
  const near = (a, b, tol = 0.02) => Math.abs(a - b) <= tol;

  // ---- car: steering wheel (default style) ----
  check('default steering style is wheel', (await page.evaluate(() => rw.touch.getSteering().style)) === 'wheel');
  const wb = await wheelBox();
  check('wheel ~150px bottom-left', wb.vis && Math.abs(wb.w - 150) < 2 && wb.x < 200 && wb.y > 412 - 140, JSON.stringify(wb));
  let p0 = rimPt(wb, 0);
  await down(1, p0.x, p0.y);
  check('touching the wheel alone does not steer', (await read('rw.input.steer')) === 0);
  await turn(1, wb, 0, 60);
  let st60 = await read('rw.input.steer');
  check('wheel 60 deg -> half input through the curve', near(st60, await shape(0.5)), `${st60}`);
  check('wheel graphic rotates', /rotate\(6\d(\.\d)?deg\)|rotate\(59\.\ddeg\)/.test(await wheelRot()), await wheelRot());
  await turn(1, wb, 60, 150);
  check('wheel past 120 deg -> full right', (await read('rw.input.steer')) === 1);
  await turn(1, wb, 150, -150, 8);
  check('wheel turned back past centre -> full left', (await read('rw.input.steer')) === -1);
  // The finger went 30 deg past the stop; turning back moves the wheel at once.
  await turn(1, wb, -150, -60);
  const stm30 = await read('rw.input.steer');
  check('wheel back to -30 deg -> proportional left', near(stm30, await shape(-0.25)), `${stm30}`);
  await shot('car-wheel-active-915x412.png');
  await up(1);
  check('wheel released -> steer 0', (await read('rw.input.steer')) === 0);
  check('wheel springs back to centre', (await wheelRot()) === '' && await page.evaluate(() => document.querySelector('.rw-wheel').classList.contains('rw-spring')));
  // Grabbing the wheel off-centre (anywhere in the zone) is relative to the touch.
  await down(1, wb.x + 120, wb.y - 20);
  check('grab away from the rim: no jump', (await read('rw.input.steer')) === 0);
  await move(1, wb.x + 115, wb.y + 30);
  check('drag down on the right side turns right', (await read('rw.input.steer')) > 0.05);
  await up(1);

  // ---- gas + simultaneous steer ----
  await down(2, gas.x, gas.y);
  check('gas held -> throttle 1', (await read('rw.input.throttle')) === 1);
  p0 = rimPt(wb, 0);
  await down(1, p0.x, p0.y);
  await turn(1, wb, 0, 130);
  const both = await read('[rw.input.throttle, rw.input.steer]');
  check('throttle 1 while steering', both[0] === 1 && both[1] === 1, JSON.stringify(both));
  await shot('car-active-915x412.png');
  await up(1);
  const rel = await read('[rw.input.steer, rw.input.throttle]');
  check('steer released -> 0, gas still 1', rel[0] === 0 && rel[1] === 1, JSON.stringify(rel));
  await up(2);
  check('gas released -> 0', (await read('rw.input.throttle')) === 0);

  // ---- steering style: buttons (ramped in update(dt)) ----
  check('setSteering returns style', (await page.evaluate(() => rw.touch.setSteering('buttons', 1))) === 'buttons');
  check('wheel hidden for buttons', !(await wheelBox()).vis);
  const sr = await center('Steer right');
  const sl = await center('Steer left');
  check('arrow pads large', sr.w >= 88 && sr.h >= 100 && sl.x < sr.x, JSON.stringify([sl, sr]));
  await down(3, sr.x, sr.y);
  check('button: no steer before update', (await read('rw.input.steer')) === 0);
  await tick(6);
  const b1 = await read('rw.input.steer');
  check('button ramp 0.1 s -> 0.4 raw', near(b1, await shape(0.4)), `${b1}`);
  await tick(9);
  check('button ramp 0.25 s -> full lock', (await read('rw.input.steer')) === 1);
  await up(3);
  await tick(5);
  const b2 = await read('rw.input.steer');
  check('button release returns over 0.15 s', b2 > 0.05 && b2 < 0.4, `${b2}`);
  await tick(5);
  check('button back at centre', (await read('rw.input.steer')) === 0);
  await tick(15, 1 / 30); // frame-rate independent: 0.25 s at 30 Hz
  await down(3, sl.x, sl.y);
  await tick(8, 1 / 30);
  check('button ramp same at 30 Hz', (await read('rw.input.steer')) === -1);
  await up(3);
  await tick(10);
  await shot('car-buttons-915x412.png');
  await page.setViewportSize({ width: 780, height: 360 });
  await page.waitForTimeout(150);
  await shot('car-buttons-780x360.png');
  await page.setViewportSize({ width: 915, height: 412 });

  // ---- steering style: slider (110 px throw, curved) ----
  await page.evaluate(() => rw.touch.setSteering('slider', 1));
  await down(1, 140, 330);
  await drag(1, 140, 330, 195, 330);
  const s55 = await read('rw.input.steer');
  check('slider 55 px -> curved half', near(s55, await shape((0.5 - 0.04) / 0.96)), `${s55}`);
  await drag(1, 195, 330, 260, 330);
  check('slider 110+ px -> full right', (await read('rw.input.steer')) === 1);
  await drag(1, 260, 330, 20, 330, 16);
  check('slider far left -> full left', (await read('rw.input.steer')) === -1);
  await move(1, 140, 330);
  check('slider centre -> 0', (await read('rw.input.steer')) === 0);
  await page.evaluate(() => rw.touch.setSteering('slider', 1.5));
  await move(1, 195, 330);
  const s55b = await read('rw.input.steer');
  check('higher sensitivity -> more steer', s55b > s55 + 0.1 && near(s55b, await shape((0.5 - 0.04) / 0.96, 1.5)), `${s55b} vs ${s55}`);
  await up(1);
  check('slider released -> 0', (await read('rw.input.steer')) === 0);
  await down(1, 140, 330);
  await drag(1, 140, 330, 200, 330);
  await shot('car-slider-active-915x412.png');
  await up(1);
  await page.evaluate(() => rw.touch.setSteering('slider', 1));
  await shot('car-slider-915x412.png');
  await page.setViewportSize({ width: 780, height: 360 });
  await page.waitForTimeout(150);
  await shot('car-slider-780x360.png');
  await page.setViewportSize({ width: 915, height: 412 });

  // ---- steering style: tilt ----
  check('tilt accepted when the API exists', (await page.evaluate(() => rw.touch.setSteering('tilt', 1))) === 'tilt');
  const tb = await center('Tilt steering (tap to re-centre)');
  check('tilt indicator where the wheel was', tb.x < 200 && tb.y > 300, JSON.stringify(tb));
  const tiltNow = async (beta, gamma) => {
    await page.evaluate(([b, g]) => window.dispatchEvent(new DeviceOrientationEvent('deviceorientation', { beta: b, gamma: g, alpha: 0 })), [beta, gamma]);
    await tick(40);
    return page.evaluate(([b, g]) => {
      const so = screen.orientation && Number.isFinite(screen.orientation.angle) ? screen.orientation.angle : 0;
      rw.input.poll();
      return { steer: rw.input.steer, want: rw.shapeSteer(rw.tiltToSteer(rw.tiltAngle(b, g, so)), 1), deg: rw.tiltAngle(b, g, so) };
    }, [beta, gamma]);
  };
  const so = await page.evaluate(() => (screen.orientation ? screen.orientation.angle : 0));
  // A pose about 12 deg right of upright for whichever way the screen is.
  const pose = so === 90 ? [12, -80] : so === 270 ? [-12, 80] : [80, 14];
  const t1 = await tiltNow(...pose);
  check('tilt steers smoothly toward the pose', t1.steer > 0.1 && near(t1.steer, t1.want, 0.03), JSON.stringify({ so, ...t1 }));
  const t0 = await tiltNow(so === 90 ? 0.5 : so === 270 ? -0.5 : 90, so === 90 ? -89 : so === 270 ? 89 : 0.5);
  check('tilt dead zone near upright', t0.steer === 0, JSON.stringify(t0));
  await tiltNow(...pose);
  await shot('car-tilt-915x412.png');
  await page.setViewportSize({ width: 780, height: 360 });
  await page.waitForTimeout(150);
  await shot('car-tilt-780x360.png');
  await page.setViewportSize({ width: 915, height: 412 });
  // Tap the bar to re-centre on the current pose.
  await down(3, tb.x, tb.y);
  await up(3);
  const tc = await tiltNow(...pose);
  check('tap re-centres tilt', Math.abs(tc.steer) < 0.02, JSON.stringify(tc));
  // No sensor events: falls back to the wheel and reports it.
  await page.evaluate(() => { rw.touch.setSteering('wheel'); rw.fallbacks.length = 0; rw.touch.setSteering('tilt'); });
  await page.waitForTimeout(2800);
  check('no tilt events -> wheel + callback', (await page.evaluate(() => rw.touch.getSteering().style)) === 'wheel'
    && (await page.evaluate(() => rw.fallbacks.join())) === 'no-sensor', await page.evaluate(() => rw.fallbacks.join()));
  // API missing entirely: immediate fallback.
  const miss = await page.evaluate(() => {
    const keep = window.DeviceOrientationEvent;
    delete window.DeviceOrientationEvent;
    window.DeviceOrientationEvent = undefined;
    rw.fallbacks.length = 0;
    const got = rw.touch.setSteering('tilt', 1);
    window.DeviceOrientationEvent = keep;
    return { got, why: rw.fallbacks.join(), now: rw.touch.getSteering().style };
  });
  check('tilt API missing -> wheel at once', miss.got === 'wheel' && miss.why === 'unsupported' && miss.now === 'wheel', JSON.stringify(miss));
  // Permission denied (iOS style): fallback too.
  const denied = await page.evaluate(async () => {
    const D = window.DeviceOrientationEvent;
    D.requestPermission = () => Promise.resolve('denied');
    rw.fallbacks.length = 0;
    rw.touch.setSteering('tilt', 1);
    await new Promise((r) => setTimeout(r, 50));
    delete D.requestPermission;
    return { why: rw.fallbacks.join(), now: rw.touch.getSteering().style };
  });
  check('tilt permission denied -> wheel', denied.why === 'denied' && denied.now === 'wheel', JSON.stringify(denied));
  await page.evaluate(() => rw.touch.setSteering('wheel', 1));

  // ---- left-handed layout mirrors every mode ----
  await page.evaluate(() => rw.touch.setLeftHanded(true));
  const lg = await center('Gas');
  const lbk = await center('Brake / reverse');
  const lw = await wheelBox();
  check('lefty: pedals on the left', lg.x < 150 && lbk.x > lg.x && lbk.x < 260, JSON.stringify([lg.x, lbk.x]));
  check('lefty: wheel on the right', lw.x > 915 - 200, JSON.stringify(lw));
  const lh = await center('Handbrake');
  check('lefty: handbrake on the left', lh.x < 150);
  p0 = rimPt(lw, 0);
  await down(1, p0.x, p0.y);
  await turn(1, lw, 0, 60);
  check('lefty: wheel steers', near(await read('rw.input.steer'), await shape(0.5)));
  await up(1);
  await read('(rw.input.lookX = 0, rw.input.lookY = 0)');
  await down(4, 420, 120);
  await drag(4, 420, 120, 480, 120, 4);
  await up(4);
  check('lefty: look drag on the left side', Math.abs((await read('rw.input.lookX')) - 60) < 3);
  await shot('car-lefty-915x412.png');
  await page.setViewportSize({ width: 780, height: 360 });
  await page.waitForTimeout(150);
  await shot('car-lefty-780x360.png');
  await page.setViewportSize({ width: 915, height: 412 });
  await page.evaluate(() => rw.touch.setSteering('buttons'));
  const lsr = await center('Steer right'), lsl = await center('Steer left');
  check('lefty: arrow pads on the right', lsl.x > 600 && lsr.x > lsl.x, JSON.stringify([lsl.x, lsr.x]));
  await shot('car-lefty-buttons-915x412.png');
  await page.evaluate(() => rw.touch.setSteering('wheel'));
  for (const [m, label] of [['foot', 'Enter car'], ['plane', 'Thrust'], ['heli', 'Climb']]) {
    await page.evaluate((mm) => rw.touch.setMode(mm), m);
    const b = await center(label);
    check(`lefty ${m}: ${label} on the left`, b.x < 250, `${b.x}`);
    await down(6, 760, 320);
    await drag(6, 760, 320, 760, 250);
    const ax = await read(m === 'foot' ? 'rw.input.moveY' : 'rw.input.pitch');
    check(`lefty ${m}: stick on the right`, ax > 0.9, `${ax}`);
    await up(6);
  }
  await page.evaluate(() => rw.touch.setMode('foot'));
  await shot('foot-lefty-915x412.png');
  await page.evaluate(() => { rw.touch.setMode('car'); rw.touch.setLeftHanded(false); });
  check('right-handed again: gas on the right', (await center('Gas')).x > 800);

  // ---- brake + handbrake ----
  await down(3, brake.x, brake.y);
  check('brake held -> 1', (await read('rw.input.brake')) === 1);
  await up(3);
  const hb = await center('Handbrake');
  await down(3, hb.x, hb.y);
  check('handbrake true while held', (await read('rw.input.handbrake')) === true);
  await up(3);
  check('handbrake released', (await read('rw.input.handbrake')) === false);

  // ---- camera drag on empty right side ----
  await read('(rw.input.lookX = 0, rw.input.lookY = 0)');
  await down(4, 520, 120);
  await drag(4, 520, 120, 640, 160, 6);
  await up(4);
  const lk = await read('[rw.input.lookX, rw.input.lookY]');
  check('look drag accumulates', Math.abs(lk[0] - 120) < 3 && Math.abs(lk[1] - 40) < 3, JSON.stringify(lk));

  // ---- button tap ----
  const exit = await center('Exit car');
  await down(5, exit.x, exit.y);
  await up(5);
  check('enter pressed after tap', (await read("rw.input.pressed('enter')")) === true);
  check('enter consumed once', (await read("[rw.input.consume('enter'), rw.input.consume('enter')]")).join() === 'true,false');
  check('enter not held after release', (await read("rw.input.held('enter')")) === false);

  // ---- HUD (car) ----
  await page.evaluate(() => {
    rw.hud.update({ mode: 'car', speedKmh: 87.4, health: 80, armor: 40, score: 12345, pending: 450, combo: 2.5, wanted: 3,
      district: 'Cinder Flats', time: 13.5, vehicleHealth: 0.7, weapon: null, ammo: null });
    rw.hud.setPrompt('Tap ENTER to get in');
    rw.hud.toast('Welcome to Rustwater', 30);
  });
  check('score text', (await page.textContent('.rw-score')) === '12,345');
  check('pending combo text', (await page.textContent('.rw-combo')).replace(/\s+/g, ' ') === '+450 x2.5');
  check('3 wanted badges lit', (await page.locator('.rw-badge.rw-on').count()) === 3);
  check('wanted row visible', await page.locator('.rw-wanted').isVisible());
  check('speed text', (await page.textContent('.rw-speed')).startsWith('87'));
  check('clock text', (await page.textContent('.rw-clock')) === '13:30');
  check('minimap canvas 176', await page.evaluate(() => rw.hud.minimapCanvas.width === 176));
  await page.evaluate(() => rw.hud.update({ mode: 'car', speedKmh: 0, health: 80, armor: 40, score: 1, pending: 0, combo: 1, wanted: 0,
    district: 'Cinder Flats', time: 13.5, vehicleHealth: 0.7, weapon: null, ammo: null }));
  check('wanted hidden at 0', !(await page.locator('.rw-wanted').isVisible()));
  await page.evaluate(() => rw.hud.update({ mode: 'car', speedKmh: 87.4, health: 80, armor: 40, score: 12345, pending: 450, combo: 2.5, wanted: 3,
    district: 'Cinder Flats', time: 13.5, vehicleHealth: 0.7, weapon: null, ammo: null }));
  await page.waitForTimeout(3300); // let the district title fade
  await shot('car-915x412.png');
  await page.setViewportSize({ width: 780, height: 360 });
  await page.waitForTimeout(200);
  await shot('car-780x360.png');
  await page.setViewportSize({ width: 915, height: 412 });

  // ---- foot mode ----
  await page.evaluate(() => rw.touch.setMode('foot'));
  check('foot stick zone present', await page.evaluate(() => !!document.querySelector('.rw-stick').offsetParent));
  check('car pedals hidden', !(await page.locator('[aria-label="Gas"]').isVisible()));
  await down(6, 120, 320);
  await drag(6, 120, 320, 122, 240);
  const st = await read('[rw.input.moveX, rw.input.moveY, rw.input.sprint]');
  check('stick up -> moveY ~+1, sprint', st[1] > 0.95 && Math.abs(st[0]) < 0.1 && st[2] === true, JSON.stringify(st));
  await shot('foot-active-915x412.png');
  await move(6, 140, 305);
  const st2 = await read('[rw.input.moveX, rw.input.moveY, rw.input.sprint]');
  check('half push -> no sprint', st2[1] > 0.2 && st2[1] < 0.85 && st2[2] === false, JSON.stringify(st2));
  await up(6);
  check('stick released -> 0', (await read('[rw.input.moveX, rw.input.moveY, rw.input.sprint]')).join() === '0,0,false');
  const gone = await page.evaluate(() => ['Attack', 'Switch weapon', 'Jump'].map((l) => {
    const e = document.querySelector(`[aria-label="${l}"]`);
    return !!e && !!e.offsetParent;
  }));
  check('foot: no attack/weapon/jump buttons', gone.every((v) => !v), JSON.stringify(gone));
  const run = await center('Run');
  const ent = await center('Enter car');
  check('foot: ENTER large', ent.w >= 90, `${ent.w}`);
  await down(7, run.x, run.y);
  check('foot: RUN sets sprint', (await read('rw.input.sprint')) === true);
  await up(7);
  check('foot: RUN release clears sprint', (await read('rw.input.sprint')) === false);
  await down(7, ent.x, ent.y);
  check('foot: ENTER held', (await read("rw.input.held('enter')")) === true);
  await up(7);
  await page.evaluate(() => {
    rw.hud.update({ mode: 'foot', speedKmh: 0, health: 20, armor: 0, score: 12345, pending: 450, combo: 2.5, wanted: 5,
      district: 'Saltmarsh Docks', time: 22.25, vehicleHealth: null, weapon: 'Revolver', ammo: 24 });
    rw.hud.setPrompt('Tap ENTER to get in');
  });
  check('speed hidden on foot', !(await page.locator('.rw-speedbox').isVisible()));
  check('no weapon HUD (combat removed)', (await page.locator('.rw-weapon').count()) === 0);
  await page.waitForTimeout(3300);
  await shot('foot-915x412.png');
  await page.setViewportSize({ width: 780, height: 360 });
  await page.waitForTimeout(200);
  await shot('foot-780x360.png');

  // ---- plane ----
  await page.setViewportSize({ width: 915, height: 412 });
  await page.evaluate(() => rw.touch.setMode('plane'));
  const thr = await center('Thrust');
  const pbr = await center('Plane brake');
  const pex = await center('Exit aircraft');
  check('plane: THRUST/BRAKE labels', (await page.locator('.rw-pedal:visible').allTextContents()).join() === 'BRAKE,THRUST');
  check('plane: car buttons hidden', !(await page.locator('[aria-label="Handbrake"]').isVisible()) && !(await page.locator('[aria-label="Gas"]').isVisible()));
  await down(10, thr.x, thr.y);
  await down(11, 120, 320);
  await drag(11, 120, 320, 180, 260);
  const pl = await read('[rw.input.throttle, rw.input.pitch, rw.input.steer]');
  check('plane: stick up+right with thrust', pl[0] === 1 && pl[1] > 0.5 && pl[2] > 0.5, JSON.stringify(pl));
  await move(11, 120, 250);
  const pl2 = await read('[rw.input.pitch, rw.input.steer]');
  check('plane: stick straight up pitch ~+1', pl2[0] > 0.95 && Math.abs(pl2[1]) < 0.1, JSON.stringify(pl2));
  await move(11, 175, 320);
  const pl3 = await read('[rw.input.pitch, rw.input.steer]');
  check('plane: stick right steer ~+1', pl3[1] > 0.95 && Math.abs(pl3[0]) < 0.1, JSON.stringify(pl3));
  await move(11, 120, 390);
  check('plane: stick down pitch ~-1', (await read('rw.input.pitch')) < -0.9);
  await shot('plane-active-915x412.png');
  await up(11);
  check('plane: stick released -> 0', (await read('[rw.input.pitch, rw.input.steer, rw.input.throttle]')).join() === '0,0,1');
  await up(10);
  await down(10, pbr.x, pbr.y);
  check('plane: BRAKE sets brake', (await read('rw.input.brake')) === 1);
  await up(10);
  await down(10, pex.x, pex.y);
  check('plane: EXIT presses enter', (await read("rw.input.held('enter')")) === true);
  await up(10);
  await page.evaluate(() => rw.hud.update({ mode: 'plane', speedKmh: 210, health: 80, armor: 0, score: 1, pending: 0, combo: 1, wanted: 0,
    district: 'Cinder Flats', time: 13.5, vehicleHealth: 0.7, weapon: null, ammo: null }));
  await page.waitForTimeout(3300);
  await shot('plane-915x412.png');
  await page.setViewportSize({ width: 780, height: 360 });
  await page.waitForTimeout(200);
  await shot('plane-780x360.png');
  await page.setViewportSize({ width: 915, height: 412 });

  // ---- heli ----
  await page.evaluate(() => rw.touch.setMode('heli'));
  check('heli: UP/DOWN labels', (await page.locator('.rw-pedal:visible').allTextContents()).join() === 'DOWN,UP');
  const up2 = await center('Climb');
  const dn2 = await center('Descend');
  await down(12, up2.x, up2.y);
  check('heli: UP -> throttle', (await read('[rw.input.throttle, rw.input.brake]')).join() === '1,0');
  await down(13, 120, 320);
  await drag(13, 120, 320, 120, 250);
  check('heli: stick pitch with UP held', (await read('[rw.input.pitch, rw.input.throttle]')).join() === '1,1');
  await shot('heli-active-915x412.png');
  await up(13);
  await up(12);
  await down(12, dn2.x, dn2.y);
  check('heli: DOWN -> brake', (await read('[rw.input.throttle, rw.input.brake]')).join() === '0,1');
  await up(12);
  await page.waitForTimeout(100);
  await shot('heli-915x412.png');
  await page.setViewportSize({ width: 780, height: 360 });
  await page.waitForTimeout(200);
  await shot('heli-780x360.png');
  await page.setViewportSize({ width: 915, height: 412 });

  // ---- boat ----
  await page.evaluate(() => rw.touch.setMode('boat'));
  check('boat: no handbrake button', !(await page.locator('[aria-label="Handbrake"]').isVisible()));
  check('boat: gas, exit visible', (await page.locator('[aria-label="Gas"]').isVisible()) && (await page.locator('[aria-label="Exit car"]').isVisible()));
  const bw = await wheelBox();
  check('boat: same steering wheel', bw.vis);
  const bp = rimPt(bw, 0);
  await down(14, bp.x, bp.y);
  await turn(14, bw, 0, 130);
  check('boat: steer right', (await read('rw.input.steer')) === 1);
  await shot('boat-active-915x412.png');
  await up(14);
  await page.waitForTimeout(100);
  await shot('boat-915x412.png');
  await page.setViewportSize({ width: 780, height: 360 });
  await page.waitForTimeout(200);
  await shot('boat-780x360.png');
  await page.setViewportSize({ width: 915, height: 412 });

  // ---- mode switch mid-touch zeroes axes; look + pause + map still work ----
  await page.evaluate(() => rw.touch.setMode('plane'));
  const thr2 = await center('Thrust');
  await down(15, thr2.x, thr2.y);
  await down(16, 120, 320);
  await drag(16, 120, 320, 180, 260);
  await page.evaluate(() => rw.touch.setMode('foot'));
  const zeros = await read('[rw.input.steer, rw.input.throttle, rw.input.brake, rw.input.pitch, rw.input.moveX, rw.input.moveY, rw.input.sprint, rw.input.handbrake]');
  check('mode switch mid-touch zeroes axes', zeros.join() === '0,0,0,0,0,0,false,false', zeros.join());
  await up(16);
  await up(15);
  await page.evaluate(() => { rw.input.lookX = 0; rw.input.lookY = 0; });
  await down(17, 520, 120);
  await drag(17, 520, 120, 600, 150, 5);
  await up(17);
  check('look drag works in foot mode', Math.abs((await read('rw.input.lookX')) - 80) < 3);
  const pz = await center('Pause');
  await down(17, pz.x, pz.y);
  check('pause works', (await read("rw.input.held('pause')")) === true);
  await up(17);
  const mp = await center('Map');
  await down(17, mp.x, mp.y);
  check('map works', (await read("rw.input.held('map')")) === true);
  await up(17);
  await page.evaluate(() => rw.touch.setMode('plane'));
  await page.evaluate(() => rw.touch.setMode('car'));

  // ---- cancel / blur release ----
  await page.setViewportSize({ width: 915, height: 412 });
  await page.evaluate(() => rw.touch.setMode('car'));
  const g2 = await center('Gas');
  await down(8, g2.x, g2.y);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
  fingers.clear();
  await page.waitForTimeout(50);
  check('touchcancel releases gas', (await read('rw.input.throttle')) === 0);
  await down(9, g2.x, g2.y);
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  check('blur releases gas', (await read('rw.input.throttle')) === 0);
  await up(9);

  check('no page errors', errors.length === 0, errors.join(' | '));
} finally {
  await browser.close();
  server.close();
}

console.log(failures.length ? `\nFAILED ${failures.length}/${checks}: ${failures.join('; ')}` : `\nPASSED ${checks}/${checks} checks`);
process.exit(failures.length ? 1 : 0);
