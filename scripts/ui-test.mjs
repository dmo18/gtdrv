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
      import { createCombatHud } from './src/ui/combathud.js';
      import { createChaseCamera } from './src/render/chasecam.js';
      import { createCollisionWorld } from './src/world/collision.js';
      import { createArms } from './src/core/weapons.js';
      import { createEvents } from './src/core/events.js';
      import * as THREE from 'three';
      const root = document.createElement('div');
      root.style.cssText = 'position:fixed;inset:0';
      document.body.appendChild(root);
      const input = createInput();
      const fallbacks = [];
      const touch = createTouchControls(root, input, { onSteerFallback: (s, why) => fallbacks.push(why) });
      const hud = createHud(root);
      // A small arena for the aiming tests: the real chase camera, aim
      // controller and combat HUD, plain boxes for people and walls.
      const camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.3, 800);
      const chase = createChaseCamera(camera);
      const collision = createCollisionWorld();
      const events = createEvents();
      const scene = new THREE.Scene();
      scene.background = new THREE.Color(0x8fb0cc);
      scene.add(new THREE.HemisphereLight(0xffffff, 0x554433, 2.2));
      const ground = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), new THREE.MeshLambertMaterial({ color: 0x6f6a60 }));
      ground.rotation.x = -Math.PI / 2;
      scene.add(ground);
      const walker = { x: 0, z: 0, y: 0, px: 0, pz: 0, heading: 0, speed: 0, hp: 100, maxHp: 100, team: 'player',
        life: 'ok', fade: 0, radius: 0.35, height: 1.8, arms: createArms('pistol') };
      const game = { input, touch, hud, chase, camera, events, collision, actors: [walker], vehicles: [], seaY: 0,
        aim: { dx: 1, dy: 0, dz: 0, manual: false }, player: { walker, vehicle: null, mode: 'foot', x: 0, z: 0 } };
      const chud = createCombatHud(game, root);
      const meshes = new Map();
      const personMesh = (color) => {
        const m = new THREE.Mesh(new THREE.BoxGeometry(0.6, 1.8, 0.5), new THREE.MeshLambertMaterial({ color }));
        scene.add(m);
        return m;
      };
      const me = personMesh(0xe2733a);
      const addActor = (x, z, team, extra = {}) => {
        const a = { x, z, y: 0, hp: 60, maxHp: 60, team, life: 'ok', fade: 0, radius: 0.35, height: 1.8, ...extra };
        game.actors.push(a);
        meshes.set(a, personMesh(team === 'crew' ? 0x7a2a8c : team === 'police' ? 0x2a4c9a : 0x6a9a5a));
        return a;
      };
      const addWall = (x0, z0, x1, z1, h) => {
        collision.addBox(x0, z0, x1, z1, h);
        const m = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0, h, z1 - z0), new THREE.MeshLambertMaterial({ color: 0x9a8a78 }));
        m.position.set((x0 + x1) / 2, h / 2, (z0 + z1) / 2);
        scene.add(m);
      };
      const clear = () => {
        for (const [a, m] of meshes) { scene.remove(m); game.actors.splice(game.actors.indexOf(a), 1); }
        meshes.clear();
      };
      let renderer = null;
      const camTarget = { x: 0, z: 0, y: 0, heading: 0, pitch: 0, roll: 0, speed: 0, height: 1.5 };
      const arena = (on) => {
        if (on && !renderer) {
          renderer = new THREE.WebGLRenderer({ antialias: true });
          renderer.domElement.style.cssText = 'position:fixed;inset:0;width:100%;height:100%';
          document.body.insertBefore(renderer.domElement, root);
        }
        if (renderer) renderer.domElement.style.display = on ? 'block' : 'none';
        input.lookX = 0;
        input.lookY = 0;
        walker.heading = 0;
        camTarget.heading = 0;
        chase.setMode('foot');
        chase.snap(camTarget);
      };
      const frame = (n = 1, dt = 1 / 60) => {
        for (let i = 0; i < n; i++) {
          touch.update(dt);
          input.poll();
          chud.always(dt);
          chud.fixedUpdate(dt);
          camTarget.x = walker.x; camTarget.z = walker.z; camTarget.heading = walker.heading;
          chase.update(camTarget, dt, input, collision);
          chud.render(1, dt);
          input.endStep();
        }
        me.position.set(walker.x, 0.9, walker.z);
        me.rotation.y = -walker.heading;
        for (const [a, m] of meshes) m.position.set(a.x, 0.9, a.z);
        if (renderer) {
          renderer.setSize(innerWidth, innerHeight, false);
          camera.aspect = innerWidth / innerHeight;
          camera.updateProjectionMatrix();
          renderer.render(scene, camera);
        }
      };
      window.rw = { input, touch, hud, shapeSteer, tiltAngle, tiltToSteer, fallbacks,
        game, chud, chase, walker, addActor, addWall, clear, arena, frame };
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
  // The "more" button toggles on a real tap; wait out the 160 ms ease.
  const tapMore = async () => {
    const m = await center('More controls');
    await down(30, m.x, m.y);
    await up(30);
    await page.waitForTimeout(240);
  };
  const fanIsOpen = () => page.evaluate(() => document.querySelector('.rw-more').getAttribute('aria-expanded') === 'true'
    && rw.touch.isFanOpen());
  const openFan = async () => { if (!(await fanIsOpen())) await tapMore(); };

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
  await openFan();
  const lh = await center('Handbrake');
  const lmore = await center('More controls');
  check('lefty: more button and fan on the left, fan grows upward from it', lh.x < 420 && lmore.x < 300 && Math.abs(lh.x - lmore.x) < 70 && lh.y < lmore.y, JSON.stringify([lh.x, lmore.x]));
  await tapMore();
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
  await openFan();
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
  await openFan();
  const run = await center('Run');
  const ent = await center('Enter car');
  check('foot: ENTER still large', ent.w >= 64, `${ent.w}`);
  await down(7, run.x, run.y);
  check('foot: RUN sets sprint', (await read('rw.input.sprint')) === true);
  await up(7);
  check('fan folds after using RUN', !(await fanIsOpen()));
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
  await openFan();
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

  // ======== combat controls (task 26) ========
  await page.setViewportSize({ width: 915, height: 412 });
  await page.evaluate(() => {
    rw.touch.setLeftHanded(false);
    rw.touch.setSteering('wheel', 1);
    rw.touch.setCombat({ show: true, weapon: 'pistol', name: 'Pocket Rattler', mag: 9, max: 12, reload: 0, locked: false, drive: true });
  });
  const hudFor = (m) => page.evaluate((mm) => {
    try {
      rw.hud.update({ mode: mm === 'foot' ? 'foot' : 'car', speedKmh: mm === 'foot' ? 0 : 87, health: 80, armor: 0, money: 12345, wanted: 3,
        pending: 450, combo: 2.5, district: 'Cinder Flats', time: 13.5, vehicleHealth: mm === 'foot' ? null : 0.7, weapon: null, ammo: null, score: 12345, heat: 3 });
      rw.hud.setPrompt(mm === 'foot' ? 'Tap ENTER: Sedan' : null);
    } catch { /* hud shape owned by another task */ }
  }, m);
  // Every visible control and HUD block: inside the screen, no overlaps.
  const layoutOf = () => page.evaluate(() => {
    const out = [];
    const add = (e, name) => {
      const r = e.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) out.push({ name, l: r.left, t: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height, btn: e.classList.contains('rw-btn') });
    };
    for (const e of document.querySelectorAll('.rw-touch .rw-btn')) {
      if (e.offsetParent && getComputedStyle(e).visibility !== 'hidden') add(e, e.getAttribute('aria-label'));
    }
    for (const sel of ['.rw-wheel', '.rw-stick', '.rw-pad', '.rw-hud .rw-tl', '.rw-hud .rw-tr', '.rw-prompt', '.rw-speedbox', '.rw-chp']) {
      for (const e of document.querySelectorAll(sel)) if (e.offsetParent && getComputedStyle(e).display !== 'none') add(e, sel);
    }
    return { out, W: innerWidth, H: innerHeight };
  });
  const checkLayout = async (label) => {
    const { out, W, H } = await layoutOf();
    const bad = [];
    for (const b of out) {
      if (b.l < -0.5 || b.t < -0.5 || b.r > W + 0.5 || b.b > H + 0.5) bad.push(`${b.name} off-screen`);
      if (b.btn && Math.min(b.w, b.h) < 56) bad.push(`${b.name} ${b.w}x${b.h} < 56`);
    }
    for (let i = 0; i < out.length; i++) {
      for (let j = i + 1; j < out.length; j++) {
        const a = out[i], b = out[j];
        const ox = Math.min(a.r, b.r) - Math.max(a.l, b.l), oy = Math.min(a.b, b.b) - Math.max(a.t, b.t);
        if (ox > 1 && oy > 1) bad.push(`${a.name} x ${b.name}`);
      }
    }
    check(`layout ${label}: ${out.length} blocks in view, >=56px, no overlaps`, bad.length === 0, bad.join(', '));
  };
  // Visible controls (buttons) right now, not counting folded ones.
  const buttonCount = () => page.evaluate(() => [...document.querySelectorAll('.rw-touch .rw-btn')]
    .filter((e) => e.offsetParent && getComputedStyle(e).visibility !== 'hidden').length);
  const counts = {};
  for (const [vw, vh] of [[915, 412], [780, 360]]) {
    await page.setViewportSize({ width: vw, height: vh });
    await page.waitForTimeout(120);
    for (const lefty of [false, true]) {
      await page.evaluate((l) => rw.touch.setLeftHanded(l), lefty);
      for (const m of ['foot', 'car', 'boat', 'plane', 'heli']) {
        const tag = `${m} ${vw}x${vh}${lefty ? ' lefty' : ''}`;
        const fileTag = `${m}${lefty ? '-lefty' : ''}-${vw}x${vh}`;
        await page.evaluate((mm) => {
          rw.touch.setHudMode('minimal');
          rw.hud.setHudMode('minimal');
          rw.touch.setMode(mm);
          rw.touch.setCombat({ show: true, weapon: 'pistol', name: 'Pocket Rattler', mag: 2, max: 12, reload: 0, locked: false, drive: true });
        }, m);
        await hudFor(m);
        await page.waitForTimeout(260);
        await checkLayout(`minimal ${tag}`);
        const n = await buttonCount();
        counts[m] = Math.max(counts[m] || 0, n);
        check(`minimal ${tag}: at most 6 buttons at once (${n})`, n <= 6, String(n));
        await shot(`min-${fileTag}-idle.png`);
        await tapMore();
        check(`minimal ${tag}: more button opens the fan`, await fanIsOpen());
        await checkLayout(`minimal ${tag} fan open`);
        if (!lefty || m === 'foot' || m === 'car') await shot(`min-${fileTag}-fan.png`);
        await tapMore();
        check(`minimal ${tag}: more button folds the fan`, !(await fanIsOpen()));
        await page.evaluate(() => { rw.touch.setHudMode('full'); rw.hud.setHudMode('full'); });
        await hudFor(m);
        await page.waitForTimeout(320);
        await checkLayout(`full ${tag}`);
        check(`full ${tag}: nothing folded, more button gone`, await page.evaluate(() => !document.querySelector('.rw-more').offsetParent
          && [...document.querySelectorAll('.rw-sec')].every((e) => getComputedStyle(e).visibility === 'visible' && getComputedStyle(e).opacity === '1')));
        if (!lefty || m === 'foot' || m === 'car') await shot(`full-${fileTag}.png`);
      }
      await page.evaluate(() => { rw.touch.setHudMode('minimal'); rw.hud.setHudMode('minimal'); rw.touch.setMode('car'); rw.touch.setSteering('buttons'); });
      await checkLayout(`car buttons-style ${vw}x${vh}${lefty ? ' lefty' : ''}`);
      await page.evaluate(() => rw.touch.setSteering('slider'));
      await checkLayout(`car slider-style ${vw}x${vh}${lefty ? ' lefty' : ''}`);
      await page.evaluate(() => rw.touch.setSteering('wheel'));
    }
  }
  console.log('simultaneous buttons in Minimal (max over sizes, idle):', JSON.stringify(counts));
  await page.setViewportSize({ width: 915, height: 412 });
  await page.evaluate(() => { rw.touch.setLeftHanded(false); rw.touch.setMode('car'); });
  await page.waitForTimeout(100);

  // ======== task: calmer UI (more button, idle shrink, small map, fading text) ========
  check('HUD is Minimal by default', (await page.evaluate(() => [rw.touch.getHudMode(), rw.hud.getHudMode()])).join() === 'minimal,minimal');
  await page.evaluate(() => rw.touch.setCombat({ show: true, weapon: 'pistol', name: 'Pocket Rattler', mag: 9, max: 12, reload: 0, locked: false, drive: true }));
  await page.waitForTimeout(350);
  check('fan folded at rest: every secondary control hidden',
    await page.evaluate(() => [...document.querySelectorAll('.rw-sec')].every((e) => getComputedStyle(e).visibility === 'hidden'))
    && !(await fanIsOpen()));
  check('more button label and aria-expanded', await page.evaluate(() => {
    const m = document.querySelector('.rw-more');
    return m.getAttribute('aria-label') === 'More controls' && m.getAttribute('aria-expanded') === 'false' && m.offsetWidth >= 56;
  }));
  // Open, check the ease length, let it fold by itself 4 s after the last use.
  const tOpen = Date.now();
  await tapMore();
  check('tap opens the fan, items visible', await fanIsOpen() && (await page.locator('[aria-label="Horn"]').isVisible()));
  check('fan ease is about 160 ms', await page.evaluate(() => getComputedStyle(document.querySelector('.rw-sec')).transitionDuration.startsWith('0.16')));
  await page.waitForTimeout(3000 - (Date.now() - tOpen));
  check('fan still open at about 3 s', await fanIsOpen());
  await page.waitForTimeout(1500);
  check('fan folded by itself after 4 s', !(await fanIsOpen()));
  // Using one control folds it at once.
  await tapMore();
  const hornB = await center('Horn');
  await down(31, hornB.x, hornB.y);
  await up(31);
  await page.waitForTimeout(40);
  check('horn tap pressed horn', (await read("[rw.input.consume('horn'), rw.input.held('horn')]")).join() === 'true,false');
  check('fan folds right after using one control', !(await fanIsOpen()));
  // A touch outside folds it too (and still reaches what it hit).
  await tapMore();
  await down(31, 500, 100);
  await up(31);
  check('touch outside folds the fan', !(await fanIsOpen()));
  // Reduced motion: no ease.
  await page.emulateMedia({ reducedMotion: 'reduce' });
  check('prefers-reduced-motion removes the ease', await page.evaluate(() => getComputedStyle(document.querySelector('.rw-sec')).transitionDuration === '0s'));
  await page.emulateMedia({ reducedMotion: 'no-preference' });

  // Handbrake held while steering and on the gas: the fan stays open until release.
  await tapMore();
  const hb2 = await center('Handbrake');
  const wbh = await wheelBox();
  const gs = await center('Gas');
  await down(1, hb2.x, hb2.y);
  const ph = rimPt(wbh, 0);
  await down(2, ph.x, ph.y);
  await turn(2, wbh, 0, 130);
  await down(3, gs.x, gs.y);
  await page.waitForTimeout(4600);
  check('hold HAND + steer + gas together past 4 s: fan still open', await fanIsOpen());
  const trio = await read('[rw.input.handbrake, rw.input.steer, rw.input.throttle]');
  check('handbrake, steer 1 and gas all held', trio.join() === 'true,1,1', trio.join());
  await shot('car-handbrake-hold-915x412.png');
  await up(1);
  await page.waitForTimeout(40);
  check('releasing HAND folds the fan, steer and gas stay', !(await fanIsOpen())
    && (await read('[rw.input.handbrake, rw.input.steer, rw.input.throttle]')).join() === 'false,1,1');
  await up(2); await up(3);
  check('steer and gas released', (await read('[rw.input.steer, rw.input.throttle]')).join() === '0,0');

  // Idle shrink: ~85 percent and ~70 percent opacity, full under a finger within 120 ms.
  await page.waitForTimeout(200);
  const face = (label) => page.evaluate((l) => {
    const b = document.querySelector(`[aria-label="${l}"]`);
    const f = b.querySelector('.rw-face');
    const r = f.getBoundingClientRect();
    return { ratio: r.width / b.offsetWidth, op: parseFloat(getComputedStyle(f).opacity), hit: Math.min(b.offsetWidth, b.offsetHeight) };
  }, label);
  for (const label of ['Gas', 'Brake / reverse', 'Exit car', 'Drive-by fire', 'Pause', 'More controls']) {
    const f = await face(label);
    check(`idle ${label}: ~85% size, ~70% opacity, hit area >= 56`, Math.abs(f.ratio - 0.85) < 0.02 && Math.abs(f.op - 0.7) < 0.03 && f.hit >= 56, JSON.stringify(f));
  }
  const gc = await center('Gas');
  await down(32, gc.x, gc.y);
  await page.waitForTimeout(140);
  const fg = await face('Gas');
  check('Gas grows to full size and opacity within 140 ms of a touch', fg.ratio > 0.99 && fg.op > 0.99, JSON.stringify(fg));
  await up(32);
  await page.waitForTimeout(160);
  const fg2 = await face('Gas');
  check('Gas shrinks back when the finger lifts', Math.abs(fg2.ratio - 0.85) < 0.02, JSON.stringify(fg2));

  // Mini-map: small, tap to expand, shrinks after 5 s without a touch.
  const mmSize = () => page.evaluate(() => Math.round(rw.hud.minimapCanvas.getBoundingClientRect().width));
  check('mini-map about 84 px by default', Math.abs((await mmSize()) - 84) <= 2, String(await mmSize()));
  check('no clock text under the map in Minimal', !(await page.locator('.rw-clock').isVisible()));
  const mmc = await page.evaluate(() => { const r = rw.hud.minimapCanvas.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
  await down(33, mmc.x, mmc.y);
  await up(33);
  await page.waitForTimeout(260);
  check('tap expands the mini-map to about 170 px', Math.abs((await mmSize()) - 170) <= 3, String(await mmSize()));
  check('mini-map aria-expanded true', (await page.getAttribute('canvas.rw-minimap', 'aria-expanded')) === 'true');
  await shot('minimap-expanded-915x412.png');
  await page.waitForTimeout(4000);
  check('still expanded at about 4.3 s', (await mmSize()) > 160);
  await page.waitForTimeout(1300);
  check('shrinks back after 5 s without touch', Math.abs((await mmSize()) - 84) <= 2, String(await mmSize()));
  await down(33, mmc.x, mmc.y);
  await up(33);
  await page.waitForTimeout(260);
  await down(33, mmc.x, mmc.y);
  await up(33);
  await page.waitForTimeout(260);
  check('second tap shrinks it again at once', Math.abs((await mmSize()) - 84) <= 2, String(await mmSize()));
  // District: small text for 3 s after a change.
  await page.evaluate(() => rw.hud.update({ mode: 'car', speedKmh: 40, health: 80, score: 5, pending: 0, combo: 1, wanted: 0, district: 'Saltmarsh Docks', time: 9, vehicleHealth: 0.7 }));
  await page.waitForTimeout(500);
  const dOp = () => page.evaluate(() => parseFloat(getComputedStyle(document.querySelector('.rw-district')).opacity));
  check('district name shows as small text after a change', (await dOp()) > 0.5);
  await page.waitForTimeout(3000);
  check('district text gone after 3 s', (await dOp()) < 0.05);

  // Score, combo and heat: dim to ~35 percent after 4 s, back on change or when hurt.
  const trOp = () => page.evaluate(() => parseFloat(getComputedStyle(document.querySelector('.rw-tr')).opacity));
  const hudNow = (o) => page.evaluate((x) => rw.hud.update({ mode: 'car', speedKmh: 40, health: 80, score: 5, pending: 0, combo: 1, wanted: 0,
    district: 'Saltmarsh Docks', time: 9, vehicleHealth: 0.7, ...x }), o);
  await page.waitForTimeout(1400);
  check('score block dimmed to about 35% when nothing changed', Math.abs((await trOp()) - 0.35) < 0.03, String(await trOp()));
  await hudNow({ score: 50 });
  await page.waitForTimeout(500);
  check('score change brings it back to full', (await trOp()) > 0.97);
  await page.waitForTimeout(4900);
  check('dims again after 4 s', (await trOp()) < 0.4);
  await hudNow({ score: 50, health: 60 });
  await page.waitForTimeout(500);
  check('being hurt brings it back to full', (await trOp()) > 0.97);
  check('speed readout small, bottom-centre, in a craft only', await page.evaluate(() => {
    const e = document.querySelector('.rw-speed');
    const r = e.getBoundingClientRect();
    return parseFloat(getComputedStyle(e).fontSize) <= 24 && Math.abs(r.left + r.width / 2 - innerWidth / 2) < 40 && r.top > innerHeight * 0.7;
  }));
  await page.waitForTimeout(4500);

  // HUD Full: everything shown, nothing dim.
  await page.evaluate(() => { rw.touch.setHudMode('full'); rw.hud.setHudMode('full'); });
  await page.waitForTimeout(500);
  check('Full: score block stays at full strength', (await trOp()) > 0.97);
  check('Full: clock and district text shown', await page.locator('.rw-clock').isVisible() && (await dOp()) > 0.95);
  check('Full: idle buttons not shrunk or dimmed', await (async () => { const f = await face('Gas'); return f.ratio > 0.99 && f.op > 0.99; })());
  check('Full: all secondary controls visible, more button gone',
    (await page.locator('[aria-label="Handbrake"]').isVisible()) && (await page.locator('[aria-label="Horn"]').isVisible())
    && (await page.locator('[aria-label="Change camera"]').isVisible()) && (await page.locator('[aria-label="Map"]').isVisible())
    && !(await page.locator('[aria-label="More controls"]').isVisible()));
  check('Full: ammo panel shown, no reload chip', await page.locator('.rw-ammo').isVisible() && !(await page.locator('[aria-label="Reload (magazine low)"]').isVisible()));
  check('Full: mini-map 116 px', Math.abs((await mmSize()) - 116) <= 2, String(await mmSize()));
  const hbF = await center('Handbrake');
  await down(34, hbF.x, hbF.y);
  check('Full: handbrake works without opening anything', (await read('rw.input.handbrake')) === true);
  await up(34);
  await shot('full-car-915x412-live.png');
  await page.evaluate(() => { rw.touch.setHudMode('minimal'); rw.hud.setHudMode('minimal'); });
  await page.waitForTimeout(300);

  // Reload chip: foot, only when the magazine is low or empty.
  await page.evaluate(() => { rw.touch.setMode('foot'); rw.touch.setCombat({ show: true, weapon: 'smg', name: 'Buzzbox', mag: 30, max: 30, reload: 0, locked: false, drive: false }); });
  check('foot: chip hidden with a full magazine', !(await page.locator('[aria-label="Reload (magazine low)"]').isVisible()));
  await page.evaluate(() => rw.touch.setCombat({ show: true, weapon: 'smg', name: 'Buzzbox', mag: 5, max: 30, reload: 0, locked: false, drive: false }));
  check('foot: chip shown when the magazine is low', await page.locator('[aria-label="Reload (magazine low)"]').isVisible());
  const chip = await center('Reload (magazine low)');
  const fireB = await center('Fire');
  check('chip sits next to FIRE and is >= 56 px', chip.w >= 56 && Math.abs(chip.x - fireB.x) < 140 && chip.x < fireB.x, JSON.stringify([chip, fireB]));
  await down(35, chip.x, chip.y);
  await up(35);
  check('chip tap presses reload', (await read("[rw.input.consume('reload'), rw.input.held('reload')]")).join() === 'true,false');
  check('foot: Minimal shows <= 6 buttons', (await buttonCount()) <= 6, String(await buttonCount()));
  await page.evaluate(() => rw.touch.setCombat({ show: true, weapon: 'smg', name: 'Buzzbox', mag: 0, max: 30, reload: 0.4, locked: false, drive: false }));
  check('foot: chip stays while reloading', await page.locator('[aria-label="Reload (magazine low)"]').isVisible());

  // Extension point: register actions without touching the layout code.
  const reg = await page.evaluate(() => {
    window.__reg = { press: 0, release: 0, on: true };
    const sec = rw.touch.registerAction({ id: 'grenade', label: 'Throw grenade', icon: 'fire', text: 'NADE', group: 'secondary', modes: ['foot'],
      press() { window.__reg.press++; }, release() { window.__reg.release++; }, visible: () => window.__reg.on });
    const pri = rw.touch.registerAction({ id: 'bomb', label: 'Drop bomb', icon: 'down', text: 'BOMB', group: 'primary', modes: ['plane'],
      press() { window.__reg.bomb = true; }, release() { window.__reg.bomb = false; } });
    window.__regH = [sec, pri];
    return !!sec.el && !!pri.el;
  });
  check('registerAction returns handles', reg);
  await page.evaluate(() => rw.touch.update(1 / 60));
  check('registered secondary joins the fan (foot only)', !(await page.locator('[aria-label="Throw grenade"]').isVisible()));
  await tapMore();
  check('registered secondary visible once the fan opens', await page.locator('[aria-label="Throw grenade"]').isVisible());
  await checkLayout('foot fan with a registered action');
  const gb = await center('Throw grenade');
  await down(36, gb.x, gb.y);
  const gPress = await page.evaluate(() => window.__reg.press);
  await up(36);
  check('registered action press and release called', gPress === 1 && (await page.evaluate(() => window.__reg.release)) === 1);
  await page.evaluate(() => { window.__reg.on = false; rw.touch.update(1 / 60); });
  check('visible() false hides it', !(await page.locator('[aria-label="Throw grenade"]').count() && await page.locator('[aria-label="Throw grenade"]').isVisible()));
  await page.evaluate(() => rw.touch.setMode('plane'));
  await checkLayout('plane with a registered primary action');
  await page.waitForTimeout(350);
  check('registered primary shows only in its mode, >= 56 px', await page.evaluate(() => {
    const b = document.querySelector('[aria-label="Drop bomb"]');
    return !!b.offsetParent && Math.min(b.offsetWidth, b.offsetHeight) >= 56;
  }));
  const bb = await center('Drop bomb');
  await down(37, bb.x, bb.y);
  const bombDown = await page.evaluate(() => window.__reg.bomb);
  await up(37);
  check('registered primary press and release', bombDown === true && (await page.evaluate(() => window.__reg.bomb)) === false);
  await page.waitForTimeout(250);
  await checkLayout('plane with a registered primary action (settled)');
  await page.evaluate(() => { for (const h of window.__regH) h.remove(); rw.touch.setMode('car'); });
  check('remove() takes the buttons away', (await page.locator('[aria-label="Drop bomb"]').count()) === 0 && (await page.locator('[aria-label="Throw grenade"]').count()) === 0);
  await page.setViewportSize({ width: 780, height: 360 });
  await page.evaluate(() => { rw.touch.setMode('plane'); window.__mslH = rw.touch.registerAction({ id: 'missile', label: 'Fire missile', icon: 'fire', text: 'MSL', group: 'primary', modes: ['plane'] }); });
  await page.waitForTimeout(350);
  await checkLayout('plane 780x360 with a registered primary action');
  await page.evaluate(() => { rw.touch.setLeftHanded(true); });
  await checkLayout('plane 780x360 lefty with a registered primary action');
  await page.evaluate(() => { rw.touch.setLeftHanded(false); });
  await page.setViewportSize({ width: 915, height: 412 });
  await page.evaluate(() => {
    rw.touch.setMode('car');
    rw.touch.setCombat({ show: true, weapon: 'pistol', name: 'Pocket Rattler', mag: 9, max: 12, reload: 0, locked: false, drive: true });
  });
  await page.waitForTimeout(350);

  // ---- drive-by: steer, gas and fire with three fingers at once ----
  const dbf = await center('Drive-by fire');
  const g3 = await center('Gas');
  check('drive-by FIRE above the pedals', dbf.y < g3.y - 60 && Math.abs(dbf.x - g3.x) < 30 && dbf.w >= 56, JSON.stringify([dbf, g3]));
  const wb3 = await wheelBox();
  p0 = rimPt(wb3, 0);
  await down(1, p0.x, p0.y);
  await turn(1, wb3, 0, 130);
  await down(2, g3.x, g3.y);
  await down(3, dbf.x, dbf.y);
  const three = await read("[rw.input.steer, rw.input.throttle, rw.input.held('fire')]");
  check('three fingers: steer 1, gas 1, fire held', three.join() === '1,1,true', three.join());
  await shot('driveby-three-fingers-915x412.png');
  await read('(rw.input.lookX = 0, rw.input.lookY = 0)');
  await drag(3, dbf.x, dbf.y, dbf.x - 80, dbf.y, 6);
  const dl = await read("[rw.input.lookX, rw.input.held('fire'), rw.input.steer, rw.input.throttle]");
  check('sliding the held FIRE orbits the camera, nothing else changes', Math.abs(dl[0] + 80) < 3 && dl[1] === true && dl[2] === 1 && dl[3] === 1, dl.join());
  await up(3);
  const after = await read("[rw.input.steer, rw.input.throttle, rw.input.held('fire')]");
  check('fire released, steer and gas still held', after.join() === '1,1,false', after.join());
  await down(3, dbf.x, dbf.y);
  await page.evaluate(() => rw.touch.setMode('boat'));
  const sw = await read("[rw.input.steer, rw.input.throttle, rw.input.held('fire')]");
  check('mode switch with three fingers down zeroes everything', sw.join() === '0,0,false', sw.join());
  await up(3); await up(2); await up(1);
  // Boat: the same scheme.
  const bf = await center('Drive-by fire');
  const bg = await center('Gas');
  const bw2 = await wheelBox();
  p0 = rimPt(bw2, 0);
  await down(1, p0.x, p0.y);
  await turn(1, bw2, 0, -130);
  await down(2, bg.x, bg.y);
  await down(3, bf.x, bf.y);
  const bthree = await read("[rw.input.steer, rw.input.throttle, rw.input.held('fire')]");
  check('boat: steer, gas, fire together', bthree.join() === '-1,1,true', bthree.join());
  await up(3); await up(2); await up(1);
  await page.evaluate(() => rw.touch.setMode('plane'));
  check('plane: no combat buttons', !(await page.locator('[aria-label="Drive-by fire"]').isVisible()) && !(await page.locator('[aria-label="Fire"]').isVisible()));

  // ---- foot: walk, fire and look at once; taps ----
  await page.evaluate(() => rw.touch.setMode('foot'));
  const ff = await center('Fire');
  check('foot FIRE big, under the right thumb', ff.w >= 90 && ff.x > 915 - 150 && ff.y > 412 - 150, JSON.stringify(ff));
  await down(1, 120, 320);
  await drag(1, 120, 320, 121, 270);
  await down(2, ff.x, ff.y);
  await read('(rw.input.lookX = 0, rw.input.lookY = 0)');
  await down(3, 560, 150);
  await drag(3, 560, 150, 620, 150, 4);
  const fw = await read("[rw.input.moveY, rw.input.held('fire'), rw.input.lookX]");
  check('foot: stick, FIRE and look drag together', fw[0] > 0.6 && fw[1] === true && Math.abs(fw[2] - 60) < 3, fw.join());
  await up(3); await up(2); await up(1);
  check('foot: all released', (await read("[rw.input.moveY, rw.input.held('fire')]")).join() === '0,false');
  for (const [label, name, fan] of [['Lock on', 'lock', false], ['Swap weapon', 'swap', true], ['Reload', 'reload', true]]) {
    if (fan) await openFan();
    const b = await center(label);
    await down(4, b.x, b.y);
    await up(4);
    check(`foot: ${label} tap presses '${name}'`, (await read(`[rw.input.consume('${name}'), rw.input.held('${name}')]`)).join() === 'true,false');
  }
  await page.evaluate(() => rw.touch.setCombat({ show: true, weapon: 'smg', name: 'Buzzbox', mag: 0, max: 30, reload: 0.5, locked: true, drive: false }));
  check('ammo panel (Full only) holds weapon, count and reload', (await page.textContent('.rw-ammo')).includes('Buzzbox')
    && (await page.textContent('.rw-ammo-n')) === '0' && await page.locator('.rw-ammo.rw-reloading').count() === 1
    && await page.locator('.rw-lock.rw-on').count() === 1);
  check('Minimal: ammo panel hidden, reload chip shown for an empty magazine',
    !(await page.locator('.rw-ammo').isVisible()) && await page.locator('[aria-label="Reload (magazine low)"]').isVisible());
  // Left-handed: every combat control mirrors and still works.
  await page.evaluate(() => rw.touch.setLeftHanded(true));
  await openFan();
  const lf = await center('Fire'), ll = await center('Lock on'), ls = await center('Swap weapon'), la = await center('Reload (magazine low)');
  check('lefty: FIRE, LOCK, chip, SWAP on the left', lf.x < 150 && ll.x < 300 && ls.x < 500 && la.x < 300, JSON.stringify([lf.x, ll.x, ls.x, la.x]));
  await tapMore();
  await down(1, 780, 320);
  await drag(1, 780, 320, 780, 260);
  await down(2, lf.x, lf.y);
  const lfw = await read("[rw.input.moveY, rw.input.held('fire')]");
  check('lefty: stick right + FIRE left together', lfw[0] > 0.9 && lfw[1] === true, lfw.join());
  await up(2); await up(1);
  await page.evaluate(() => rw.touch.setMode('car'));
  const ldb = await center('Drive-by fire');
  check('lefty: drive-by FIRE on the left beside the pedals', ldb.x < 300, `${ldb.x}`);
  await page.evaluate(() => { rw.touch.setLeftHanded(false); rw.touch.setMode('foot'); });

  // ---- the aim itself: real camera, assist, walls, lock-on ----
  await page.evaluate(() => {
    rw.arena(true);
    rw.addWall(7, -1.5, 8, 0.8, 4);
    window.__A = rw.addActor(14, 2.2, 'crew');
    window.__B = rw.addActor(14, 0, 'crew'); // dead ahead, behind the wall
    rw.frame(5);
  });
  const fire2 = await center('Fire');
  await down(2, fire2.x, fire2.y);
  await page.evaluate(() => rw.frame(20));
  const as = await page.evaluate(() => {
    const a = rw.game.aim, t = window.__A;
    const dx = t.x - rw.walker.x, dy = 1.1 - 1.4, dz = t.z - rw.walker.z;
    const l = Math.hypot(dx, dy, dz);
    return { aiming: rw.chud.aiming, k: rw.chase.aim.k, fov: rw.camera ? 0 : rw.game.camera.fov, onA: rw.chud.target === window.__A,
      onB: rw.chud.target === window.__B, dot: (a.dx * dx + a.dy * dy + a.dz * dz) / l,
      hot: !!document.querySelector('.rw-xhair.rw-on.rw-hot'), brackets: !!document.querySelector('.rw-tgt.rw-on') };
  });
  check('FIRE held: aim view on (FOV 55)', as.aiming && as.k === 1 && Math.abs(as.fov - 55) < 0.5, JSON.stringify(as));
  check('assist ignores the target behind the wall, bends to the visible one', as.onA && !as.onB && as.dot > 0.9999, JSON.stringify(as));
  check('crosshair red with target brackets', as.hot && as.brackets);
  await shot('aim-assist-915x412.png');
  await page.evaluate(() => {
    rw.clear();
    window.__C = rw.addActor(30, 4.5, 'crew');
    window.__D = rw.addActor(12, 2.0, 'crew');
    rw.frame(2);
  });
  const nearest = await page.evaluate(() => ({ d: rw.chud.target === window.__D, c: rw.chud.target === window.__C, yaw: rw.chase.aim.yaw, n: rw.game.actors.length, aiming: rw.chud.aiming }));
  check('assist picks the nearest target in the cone', nearest.d, JSON.stringify(nearest));
  // Dragging while FIRE is held turns the aim (slower over a target).
  const y0 = await page.evaluate(() => rw.chase.aim.yaw);
  await down(3, 560, 150);
  for (let i = 1; i <= 6; i++) {
    await move(3, 560 + i * 20, 150);
    await page.evaluate(() => rw.frame(1));
  }
  await up(3);
  const y1 = await page.evaluate(() => rw.chase.aim.yaw);
  check('look drag turns the aim while firing', y1 - y0 > 0.2 && y1 - y0 < 0.55, `${y0} -> ${y1}`);
  await up(2);
  await page.evaluate(() => rw.frame(100));
  check('aim view leaves after FIRE is let go', await page.evaluate(() => !rw.chud.aiming && rw.chase.aim.k === 0));
  // Lock-on follows a moving target.
  await page.evaluate(() => {
    rw.clear();
    window.__E = rw.addActor(20, 6, 'crew');
    rw.frame(2);
  });
  const lk2 = await center('Lock on');
  await down(4, lk2.x, lk2.y);
  await page.evaluate(() => rw.frame(1));
  await up(4);
  check('LOCK tap locks the crew member', await page.evaluate(() => rw.chud.lock === window.__E));
  const follow = await page.evaluate(() => {
    rw.frame(30);
    for (let i = 0; i < 120; i++) { window.__E.z += 0.06; rw.frame(1); }
    const r = rw.chase.ray, e = window.__E;
    const dx = e.x - r.x, dy = 1.1 - r.y, dz = e.z - r.z, l = Math.hypot(dx, dy, dz);
    return { deg: Math.acos((dx * r.dx + dy * r.dy + dz * r.dz) / l) * 180 / Math.PI, lock: rw.chud.lock === e,
      ring: !!document.querySelector('.rw-tgt.rw-locked'), btn: !!document.querySelector('.rw-lock.rw-on') };
  });
  check('lock-on keeps a moving target near the centre', follow.lock && follow.deg < 6, JSON.stringify(follow));
  check('lock ring and LOCK button lit', follow.ring && follow.btn);
  await shot('aim-lock-915x412.png');
  // A swipe flicks to the next target on that side.
  await page.evaluate(() => { window.__F = rw.addActor(15, -4, 'crew'); rw.frame(1); });
  await down(3, 700, 150);
  for (let i = 1; i <= 5; i++) {
    await move(3, 700 - i * 30, 150);
    await page.evaluate(() => rw.frame(1));
  }
  await up(3);
  check('swipe left flicks the lock to the target on the left', await page.evaluate(() => rw.chud.lock === window.__F));
  await page.evaluate(() => { rw.addWall(6, -3.5, 8, -1, 5); rw.frame(100); });
  check('lock breaks 1.5 s after the target is out of sight', await page.evaluate(() => rw.chud.lock === null));
  await page.setViewportSize({ width: 780, height: 360 });
  await page.evaluate(() => {
    rw.clear();
    window.__G = rw.addActor(16, 1.5, 'crew');
    rw.input.press('lock');
    rw.frame(40);
    rw.input.release('lock');
  });
  await page.waitForTimeout(100);
  await page.evaluate(() => rw.frame(2));
  await shot('aim-lock-780x360.png');
  await checkLayout('foot aiming 780x360');
  await page.evaluate(() => { rw.input.press('lock'); rw.frame(2); rw.input.release('lock'); rw.frame(100); rw.arena(false); });
  await page.setViewportSize({ width: 915, height: 412 });

  // ======== armed craft and explosives controls (task 31, docs/ARMS.md) ========
  {
    await page.setViewportSize({ width: 915, height: 412 });
    await page.evaluate(() => {
      if (window.__mslH) window.__mslH.remove();
      rw.touch.setLeftHanded(false);
      rw.touch.setHudMode('minimal');
      rw.hud.setHudMode('minimal');
      // Fixture craft (the real fighter, police heli and tank come in tasks 32 and 33).
      const mk = (id, kind, mounts, extra = {}) => ({ id: 900 + mounts.length, kind, x: 0, y: 40, z: 0, heading: 0, pitch: 0,
        vx: 0, vy: 0, vz: 0, health: 500, spec: { id, kind, length: 12, width: 9, height: 3, health: 500, mounts, ...extra } });
      window.__CR = {
        fighter: mk('fx-fighter', 'plane', ['nosegun', 'missile', 'bomb']),
        police: mk('fx-patrol', 'heli', ['chingun'], { police: true }),
        heavy: mk('fx-heavy', 'heli', ['drop']),
        tank: mk('fx-tank', 'tank', ['cannon', 'coax']),
        prop: mk('fx-prop', 'plane', []),
      };
      window.__ST = { n: 0 };
      rw.game.combat = {
        seeker: { target: null, state: 'idle', progress: 0 },
        countStickies: () => window.__ST.n,
        armsOf: null,
      };
      rw.game.combat.armsOf = undefined;
    });
    const ids = await page.evaluate(() => [...document.querySelectorAll('.rw-act')].map((e) => e.dataset.action));
    check('arms actions registered (gun msl bomb alock cannon coax tlock detonate siren)',
      ['gun', 'msl', 'bomb', 'alock', 'cannon', 'coax', 'tlock', 'detonate', 'siren'].every((k) => ids.includes(k)), ids.join());
    const setCraft = (key, mode, charges = 0) => page.evaluate(([k, m, n]) => {
      const p = rw.game.player;
      p.vehicle = k ? window.__CR[k] : null;
      window.__ST.n = n;
      rw.touch.setMode(m);
      rw.touch.setCombat({ show: true, weapon: n ? 'sticky' : 'fizz', name: 'Fizzpop Can', mag: 1, max: 1, reload: 0, locked: false, drive: false });
      rw.touch.update(1 / 60);
      rw.chud.render(1, 1 / 60);
    }, [key, mode, charges]);
    const visibleActions = () => page.evaluate(() => [...document.querySelectorAll('.rw-touch .rw-act')]
      .filter((e) => e.offsetParent && getComputedStyle(e).visibility !== 'hidden').map((e) => e.dataset.action).sort().join());
    // [craft, mode, charges, max buttons, wanted actions]. Minimal: 6 at most, except the
    // armed-aircraft arc (ARMS.md: GUN MSL BOMB LOCK, up to 9) and DETONATE (+1).
    const cases = [
      ['fighter', 'plane', 0, 9, 'alock,bomb,gun,msl'],
      ['fighter', 'plane', 2, 10, 'alock,bomb,detonate,gun,msl'],
      ['police', 'heli', 0, 6, 'gun'],
      ['heavy', 'heli', 0, 6, 'bomb'],
      ['tank', 'tank', 0, 6, 'cannon,coax,tlock'],
      ['tank', 'tank', 1, 7, 'cannon,coax,detonate,tlock'],
      ['prop', 'plane', 0, 6, ''],
      [null, 'foot', 0, 6, ''],
      [null, 'foot', 3, 7, 'detonate'],
    ];
    const armsCounts = {};
    for (const [vw, vh] of [[915, 412], [780, 360]]) {
      await page.setViewportSize({ width: vw, height: vh });
      await page.waitForTimeout(80);
      for (const lefty of [false, true]) {
        await page.evaluate((l) => rw.touch.setLeftHanded(l), lefty);
        for (const [key, mode, charges, max, want] of cases) {
          const tag = `${key || 'walker'}${charges ? '+charges' : ''} ${mode} ${vw}x${vh}${lefty ? ' lefty' : ''}`;
          await page.evaluate(() => { rw.touch.setHudMode('minimal'); rw.hud.setHudMode('minimal'); });
          await setCraft(key, mode, charges);
          await hudFor(mode === 'foot' ? 'foot' : 'car');
          await page.waitForTimeout(200);
          check(`arms ${tag}: actions ${want || '(none)'}`, (await visibleActions()) === want, await visibleActions());
          const n = await buttonCount();
          armsCounts[tag.split(' ')[0]] = Math.max(armsCounts[tag.split(' ')[0]] || 0, n);
          check(`arms ${tag}: ${n} buttons <= ${max}`, n <= max, String(n));
          await checkLayout(`arms ${tag}`);
          if (!lefty && (key === 'fighter' || key === 'tank' || (mode === 'foot' && charges))) await shot(`arms-${key || 'foot'}${charges ? '-charges' : ''}-${vw}x${vh}.png`);
          if (lefty && key === 'fighter' && charges) await shot(`arms-fighter-lefty-${vw}x${vh}.png`);
          await tapMore();
          await checkLayout(`arms ${tag} fan open`);
          await tapMore();
          await page.evaluate(() => { rw.touch.setHudMode('full'); rw.hud.setHudMode('full'); });
          await page.waitForTimeout(260);
          await checkLayout(`arms full ${tag}`);
        }
      }
    }
    console.log('arms buttons in Minimal (max):', JSON.stringify(armsCounts));
    await page.setViewportSize({ width: 915, height: 412 });
    await page.evaluate(() => { rw.touch.setLeftHanded(false); rw.touch.setHudMode('minimal'); rw.hud.setHudMode('minimal'); });
    await setCraft('fighter', 'plane', 0);
    await page.waitForTimeout(200);
    const at = (a) => page.evaluate((k) => {
      const r = document.querySelector(`[data-action="${k}"]`).getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height };
    }, a);
    // Hit areas and fire-type actions primary.
    const sizes = await page.evaluate(() => ['gun', 'msl', 'bomb', 'alock'].map((k) => {
      const e = document.querySelector(`[data-action="${k}"]`);
      return [k, e.offsetWidth, e.classList.contains('rw-pri')];
    }));
    check('arc buttons >= 56 px and primary', sizes.every(([, w, p]) => w >= 56 && p), JSON.stringify(sizes));
    const gun = await at('gun');
    check('GUN is the big one (>= 80 px)', gun.w >= 80, String(gun.w));
    // Real multi-touch while flying: stick, GUN held, BOMB tapped, MSL held.
    await down(41, 140, 300);
    await drag(41, 140, 300, 190, 260, 5);
    await down(42, gun.x, gun.y);
    let st = await read('({ fire: rw.input.held("fire"), steer: rw.input.steer, pitch: rw.input.pitch })');
    check('flying: stick and GUN at once', st.fire && st.steer > 0.3 && st.pitch > 0.3, JSON.stringify(st));
    const bomb = await at('bomb');
    await down(43, bomb.x, bomb.y);
    check('flying: BOMB tap while holding GUN and the stick', await read('rw.input.pressed("drop") && rw.input.held("fire")'));
    await up(43);
    const msl = await at('msl');
    await down(44, msl.x, msl.y);
    check('flying: MSL holds fire2', await read('rw.input.held("fire2")'));
    await up(44);
    await up(42);
    await up(41);
    await page.evaluate(() => rw.frame(1));
    check('flying: all released', await read('!rw.input.held("fire") && !rw.input.held("fire2") && rw.input.steer === 0'));
    const lock = await at('alock');
    await down(45, lock.x, lock.y);
    await up(45);
    check('LOCK tap presses lock', await read('rw.input.pressed("lock")'));
    await page.evaluate(() => rw.frame(1));
    // Seeker ring and lock state on MSL; pips show the magazine.
    const ring = await page.evaluate(() => {
      const sk = rw.game.combat.seeker;
      sk.target = window.__CR.police;
      sk.state = 'seek';
      sk.progress = 0.5;
      rw.chud.render(1, 1 / 60);
      const m = document.querySelector('[data-action="msl"]');
      const a = m.classList.contains('rw-ringon') && !m.classList.contains('rw-on');
      sk.state = 'locked';
      sk.progress = 1;
      rw.chud.render(1, 1 / 60);
      const b = m.classList.contains('rw-on');
      const pip = document.querySelector('[data-action="bomb"] .rw-pip').textContent;
      sk.target = null;
      sk.state = 'idle';
      rw.chud.render(1, 1 / 60);
      return { a, b, pip };
    });
    check('MSL ring fills while seeking, solid when locked; BOMB pip shows 6', ring.a && ring.b && ring.pip === '6', JSON.stringify(ring));
    // Left-handed: the arc moves to the left thumb.
    await page.evaluate(() => rw.touch.setLeftHanded(true));
    await page.waitForTimeout(60);
    const gl = await at('gun');
    check('left-handed: GUN mirrors to the left side', gl.x < 915 / 2 && Math.abs((915 - gl.x) - gun.x) < 2, `${gl.x} vs ${gun.x}`);
    await page.evaluate(() => rw.touch.setLeftHanded(false));
    // Tank: the stick drives (up = throttle, down = brake, sideways = steer).
    await setCraft('tank', 'tank', 0);
    await down(46, 140, 300);
    await drag(46, 140, 300, 140, 240, 5);
    const tk = await read('({ t: rw.input.throttle, b: rw.input.brake })');
    await drag(46, 140, 240, 200, 360, 6);
    const tk2 = await read('({ t: rw.input.throttle, b: rw.input.brake, s: rw.input.steer })');
    await up(46);
    check('tank stick: up = throttle, down-right = brake + steer', tk.t > 0.6 && tk.b === 0 && tk2.b > 0.3 && tk2.s > 0.3 && tk2.t === 0,
      JSON.stringify([tk, tk2]));
    // On foot: hold FIRE to aim a throw (slide to aim), a second finger walks,
    // lifting over the more button (where SWAP folds) cancels.
    await setCraft(null, 'foot', 0);
    await page.waitForTimeout(100);
    const fireF = await center('Fire');
    await down(47, fireF.x, fireF.y);
    await down(48, 140, 300);
    await drag(48, 140, 300, 140, 250, 4);
    await page.evaluate(() => { rw.input.lookX = 0; });
    await drag(47, fireF.x, fireF.y, fireF.x - 60, fireF.y - 40, 6);
    st = await read('({ fire: rw.input.held("fire"), look: rw.input.lookX, walk: rw.input.moveY })');
    check('throwing: FIRE held, slide aims, the other thumb walks', st.fire && st.look < -30 && st.walk > 0.5, JSON.stringify(st));
    const moreB = await center('More controls');
    await drag(47, fireF.x - 60, fireF.y - 40, moreB.x, moreB.y, 6);
    await up(47);
    await up(48);
    check('throwing: lift over the more/SWAP button = cancel', await read('rw.input.pressed("cancel") && !rw.input.held("fire")'));
    await page.evaluate(() => rw.frame(1));
    await down(49, fireF.x, fireF.y);
    await up(49);
    check('throwing: a normal release does not cancel', await read('!rw.input.pressed("cancel")'));
    // DETONATE: pulsing, primary, >= 56 px.
    await setCraft(null, 'foot', 2);
    await page.waitForTimeout(100);
    const det = await page.evaluate(() => {
      const e = document.querySelector('[data-action="detonate"]');
      return { w: e.offsetWidth, pri: e.classList.contains('rw-pri'), anim: getComputedStyle(e.querySelector('.rw-face')).animationName };
    });
    check('DETONATE shown with charges: primary, pulsing, >= 56 px', det.w >= 56 && det.pri && det.anim === 'rw-pulse', JSON.stringify(det));
    const db = await at('detonate');
    await down(50, db.x, db.y);
    await up(50);
    check('DETONATE tap presses detonate', await read('rw.input.pressed("detonate")'));
    await page.evaluate(() => { rw.frame(1); rw.game.player.vehicle = null; window.__ST.n = 0; rw.game.combat = undefined; rw.touch.setMode('car'); rw.touch.update(1 / 60); });
  }

  check('no page errors', errors.length === 0, errors.join(' | '));
} finally {
  await browser.close();
  server.close();
}

console.log(failures.length ? `\nFAILED ${failures.length}/${checks}: ${failures.join('; ')}` : `\nPASSED ${checks}/${checks} checks`);
process.exit(failures.length ? 1 : 0);
