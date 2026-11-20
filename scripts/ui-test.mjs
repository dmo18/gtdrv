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
      import { createInput } from './src/core/input.js';
      import { createTouchControls } from './src/ui/touch.js';
      import { createHud } from './src/ui/hud.js';
      const root = document.createElement('div');
      root.style.cssText = 'position:fixed;inset:0';
      document.body.appendChild(root);
      const input = createInput();
      const touch = createTouchControls(root, input);
      const hud = createHud(root);
      window.rw = { input, touch, hud };
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

  // ---- car: steering ----
  await down(1, 120, 330);
  await drag(1, 120, 330, 200, 330);
  check('steer right ~+1', (await read('rw.input.steer')) > 0.95);
  await drag(1, 200, 330, 40, 330, 16);
  check('steer left ~-1', (await read('rw.input.steer')) < -0.95);
  await move(1, 120, 330);
  check('steer centre ~0', Math.abs(await read('rw.input.steer')) < 0.01);
  await up(1);

  // ---- gas + simultaneous steer ----
  await down(2, gas.x, gas.y);
  check('gas held -> throttle 1', (await read('rw.input.throttle')) === 1);
  await down(1, 120, 330);
  await drag(1, 120, 330, 190, 330);
  const both = await read('[rw.input.throttle, rw.input.steer]');
  check('throttle 1 while steering', both[0] === 1 && both[1] > 0.95, JSON.stringify(both));
  await shot('car-active-915x412.png');
  await up(1);
  const rel = await read('[rw.input.steer, rw.input.throttle]');
  check('steer released -> 0, gas still 1', rel[0] === 0 && rel[1] === 1, JSON.stringify(rel));
  await up(2);
  check('gas released -> 0', (await read('rw.input.throttle')) === 0);

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
    rw.hud.update({ mode: 'car', speedKmh: 87.4, health: 80, armor: 40, money: 12345, wanted: 3,
      district: 'Cinder Flats', time: 13.5, vehicleHealth: 0.7, weapon: null, ammo: null });
    rw.hud.setPrompt('Tap ENTER to get in');
    rw.hud.toast('Welcome to Rustwater', 30);
  });
  check('money text', (await page.textContent('.rw-money')) === '$12,345');
  check('3 wanted badges lit', (await page.locator('.rw-badge.rw-on').count()) === 3);
  check('wanted row visible', await page.locator('.rw-wanted').isVisible());
  check('speed text', (await page.textContent('.rw-speed')).startsWith('87'));
  check('clock text', (await page.textContent('.rw-clock')) === '13:30');
  check('minimap canvas 176', await page.evaluate(() => rw.hud.minimapCanvas.width === 176));
  await page.evaluate(() => rw.hud.update({ mode: 'car', speedKmh: 0, health: 80, armor: 40, money: 1, wanted: 0,
    district: 'Cinder Flats', time: 13.5, vehicleHealth: 0.7, weapon: null, ammo: null }));
  check('wanted hidden at 0', !(await page.locator('.rw-wanted').isVisible()));
  await page.evaluate(() => rw.hud.update({ mode: 'car', speedKmh: 87.4, health: 80, armor: 40, money: 12345, wanted: 3,
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
  check('car pedals hidden', !(await page.locator('.rw-gas').isVisible()));
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
  const atk = await center('Attack');
  await down(7, atk.x, atk.y);
  check('attack held', (await read("rw.input.held('attack')")) === true);
  await up(7);
  await page.evaluate(() => {
    rw.hud.update({ mode: 'foot', speedKmh: 0, health: 20, armor: 0, money: 12345, wanted: 5,
      district: 'Saltmarsh Docks', time: 22.25, vehicleHealth: null, weapon: 'Revolver', ammo: 24 });
    rw.hud.setPrompt('Tap ENTER to get in');
  });
  check('speed hidden on foot', !(await page.locator('.rw-speedbox').isVisible()));
  check('weapon text', (await page.textContent('.rw-weapon')).includes('Revolver'));
  await page.waitForTimeout(3300);
  await shot('foot-915x412.png');
  await page.setViewportSize({ width: 780, height: 360 });
  await page.waitForTimeout(200);
  await shot('foot-780x360.png');

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
