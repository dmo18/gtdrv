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
      import { AIRCRAFT_SPECS } from './src/entities/aircraft.js';
      import { TANK_SPECS } from './src/entities/tank.js'; // the real Rustback (task 32)
      import { createHeliPilots } from './src/systems/helipilot.js';
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
      createHeliPilots(game); // the police heli's SPOT button (task 33)
      window.__SPECS = AIRCRAFT_SPECS;
      window.__TANKS = TANK_SPECS;
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

// ---------------------------------------------------------------------------
// The running game (docs/REVAMP.md 6.5 acceptance). Loads the BUILT game, not
// the harness page, at 915x412 and 780x360, each with a left inset of 0 and 40,
// in every craft mode, fan open and closed, HUD Minimal and Full, right and
// left handed. Reads getBoundingClientRect of every HUD element and checks:
// overlaps, gaps under 8 between hit boxes, hit boxes under 48, anything in
// the keep-out rect or an inset strip, rects that differ from the table by
// more than 2 px, text contrast under 4.5, and the world drawing under the
// cut-out.
// ---------------------------------------------------------------------------
const GRID = {
  A: {
    V: 915, H: 412,
    minimap: [8, 8, 84, 84], speed: [100, 8, 88, 44], health: [100, 56, 88, 12], stars: [383, 8, 150, 24],
    stack: [290, 8, 335, 92], objcell: [541, 8, 84, 24], cool: [383, 33, 150, 4], m1: [290, 40, 335, 28], m2: [290, 72, 335, 28],
    boost: [843, 116, 56, 56], boostbar: [100, 56, 88, 6], siren: [184, 292, 56, 56], extra: [675, 272, 56, 56],
    score: [691, 8, 160, 28], pause: [859, 8, 48, 48], prompt: [308, 376, 300, 28],
    gas: [835, 316, 72, 88], brake: [751, 316, 72, 88], exit: [843, 248, 56, 56], hand: [759, 248, 56, 56],
    fire: [671, 340, 64, 64], lock: [675, 272, 56, 56], more: [843, 180, 56, 56], ammo: [691, 60, 160, 40],
    fanX: [779, 715, 651], fanY: [180, 116], fanS: 56, slot: [16, 240, 160, 160],
  },
  B: {
    V: 780, H: 360,
    minimap: [8, 8, 72, 72], speed: [92, 8, 80, 40], health: [92, 52, 80, 12], stars: [315, 8, 150, 24],
    stack: [240, 8, 300, 92], objcell: [473, 8, 67, 24], cool: [315, 33, 150, 4], m1: [240, 40, 300, 28], m2: [240, 72, 300, 28],
    boost: [716, 88, 56, 56], boostbar: [92, 52, 80, 6], siren: [164, 246, 56, 56], extra: [564, 224, 56, 56],
    score: [564, 8, 152, 26], pause: [724, 8, 48, 48], prompt: [240, 324, 300, 28],
    gas: [708, 280, 64, 72], brake: [632, 280, 64, 72], exit: [716, 216, 56, 56], hand: [636, 216, 56, 56],
    fire: [560, 288, 64, 64], lock: [564, 224, 56, 56], more: [716, 152, 56, 56], ammo: [564, 56, 152, 24],
    fanX: [660, 604, 548], fanY: [156, 100], fanS: 48, slot: [16, 204, 140, 140],
  },
};
const lum = ([r, g, b]) => {
  const f = (c) => { const s = c / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};
const contrast = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
const inter = (a, b) => Math.min(a.r, b.r) - Math.max(a.x, b.x) > 0.5 && Math.min(a.b, b.b) - Math.max(a.y, b.y) > 0.5;
const gapOf = (a, b) => Math.max(Math.max(a.x, b.x) - Math.min(a.r, b.r), Math.max(a.y, b.y) - Math.min(a.b, b.b));

async function liveLayout(check) {
  const { buildGame, serve } = await import('./build.mjs');
  await buildGame();
  const srv = await serve(0);
  const base = `http://127.0.0.1:${srv.address().port}/`;
  const br = await (await loadChromium()).launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  try {
    const pg = await (await br.newContext({ viewport: { width: 915, height: 412 }, hasTouch: true, isMobile: true, deviceScaleFactor: 1 })).newPage();
    const errs = [];
    pg.on('pageerror', (e) => errs.push(String(e)));
    pg.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
    await pg.goto(`${base}?autostart`);
    await pg.waitForFunction(() => window.__rw && window.__rw.loop.running, null, { timeout: 120000 });
    await pg.waitForTimeout(1500);
    // Stop the simulation clock from moving things (crafts, camera) while we measure.
    await pg.evaluate(() => { window.__rw.loop.stop && window.__rw.loop.stop(); });
    const problems = [];
    let states = 0, elements = 0;
    // [name, craft, armed]. 'car-garage' and 'foot-talk' have a GARAGE or TALK offer showing (docs/REVAMP.md 6.12 HG-2).
    const MODES = [['foot', 'foot', null], ['foot-talk', 'foot', null], ['car', 'car', null], ['car-garage', 'car', null], ['boat', 'boat', null],
      ['plane-armed', 'plane', true], ['plane', 'plane', false], ['heli-armed', 'heli', true], ['tank', 'tank', null]];
    const setMode = (kind, armed, name) => pg.evaluate(([k, a, nm]) => {
      const g = window.__rw;
      // a test GARAGE button, the kind garages.js and adventures.js register (unslotted primary)
      if (!window.__offerBtn) {
        window.__offerBtn = g.touch.registerAction({ id: 'testgarage', label: 'Use garage', text: 'GARAGE', group: 'primary', modes: ['foot', 'car'],
          icon: '<path d="M3 11l9-7 9 7v9H3z"/>', visible: () => !!window.__offer });
      }
      window.__offer = nm === 'car-garage' || nm === 'foot-talk';
      if (k === 'foot') { g.player.vehicle = null; g.setPlayerMode('foot'); } else {
        const has = (v) => !!(v.spec && v.spec.mounts && v.spec.mounts.length);
        const v = g.vehicles.find((x) => x.kind === k && (a === null || has(x) === a)) || g.vehicles.find((x) => x.kind === k);
        if (!v) return false;
        g.enterVehicle(v);
      }
      g.touch.update(1 / 60);
      return true;
    }, [kind, armed, name]).then((ok) => { if (!ok) problems.push(`no ${name} craft in the world`); return ok; });
    // Force the transient HUD pieces on so they are measured: stars with the escape bar, health, prompt, combo,
    // the objective cell, a police toast (row 1) and a hint (row 2), the siren and the extra of a service vehicle.
    const force = (mortal = true) => pg.evaluate((mortal) => {
      const g = window.__rw;
      for (const c of ['.rw-wanted', '.rw-hpmeter', '.rw-prompt']) document.querySelector(c).classList.remove('rw-none');
      document.querySelector('.rw-wanted').classList.add('rw-cooling');
      document.querySelector('.rw-prompt').textContent = 'ENTER: take the sedan';
      const cb = document.querySelector('.rw-combo');
      cb.style.display = ''; cb.textContent = '+1,200  x3';
      g.hud.setObjective(true, 40, '0.4 mi');
      if (!document.querySelector('.rw-m1:not([hidden])')) {
        g.hud.stack.reset();
        g.hud.stack.setWanted(true);
        g.hud.toast('Pulled over! Off with a warning.', 3600, 'police');
        g.hud.toast('Tap EXIT to get out. Walk up to anything and tap ENTER.', 3600, 'hint');
      }
      g.touch.setSiren(true, false);
      g.touch.setExtra({ can: true, text: 'WATER', fill: 0.6 });
      // the speed readout, the health meter (hard mode) and the boost meter, through the real update
      const mode = g.player.mode;
      g.hud.update({ ...g.hudState, mode: mode === 'foot' ? 'foot' : 'car', speedKmh: 60, mortal: mortal, health: 80, maxHealth: 100,
        boost: ['car', 'boat', 'plane', 'heli'].includes(mode) ? 0.8 : -1 });
      for (const c of ['.rw-wanted']) document.querySelector(c).classList.remove('rw-none');
      document.querySelector('.rw-hpmeter').classList.toggle('rw-none', !mortal);
    }, mortal);
    // Wait until every finite transition and animation has finished.
    const settle = () => pg.evaluate(async () => {
      const running = () => document.getAnimations().filter((a) => a.effect && a.effect.getComputedTiming().iterations !== Infinity && a.playState === 'running');
      for (let i = 0; i < 6 && running().length; i++) await Promise.allSettled(running().map((a) => a.finished));
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    });
    const measure = (grid, L, hand, hud, name) => pg.evaluate(() => {
      const g = window.__rw;
      const vis = (e) => {
        const cs = getComputedStyle(e);
        if (cs.display === 'none' || cs.visibility === 'hidden') return false;
        for (let p = e; p && p !== document.body; p = p.parentElement) if (getComputedStyle(p).display === 'none') return false;
        const r = e.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      };
      const R = (e) => { const r = e.getBoundingClientRect(); return { x: r.left, y: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height }; };
      const out = [];
      const add = (key, e, hit, extra = {}) => { if (e && vis(e)) out.push({ key, hit, name: e.className.toString().replace(/rw-/g, '').slice(0, 40), ...R(e), ...extra }); };
      // hit boxes: every touch button (the ammo panel and the tilt bar are displays)
      for (const e of document.querySelectorAll('.rw-touch .rw-btn')) {
        const c = e.className;
        const display = c.includes('rw-ammo') || c.includes('rw-tiltbar');
        let key = null;
        if (c.includes('rw-pause')) key = 'pause';
        else if (c.includes('rw-slot-boost') || /\brw-extra\b/.test(c)) key = 'boost'; // BOOST, or GARAGE and TALK in its cell
        else if (c.includes('rw-slot-siren')) key = 'siren';
        else if (c.includes('rw-slot-extra')) key = 'extra';
        else if (c.includes('rw-more')) key = 'more';
        else if (/\brw-gas\b/.test(c) || /\brw-fire\b/.test(c)) key = 'gas';
        else if (/\brw-brake\b/.test(c) || c.includes('rw-slot-run')) key = 'brake';
        else if (c.includes('rw-exit') || c.includes('rw-enter')) key = 'exit';
        else if (c.includes('rw-slot-hand') || c.includes('rw-slot-bomb')) key = 'hand';
        else if (c.includes('rw-dbfire') || c.includes('rw-slot-gun') || c.includes('rw-slot-cannon')) key = 'fire';
        else if (c.includes('rw-lock') || c.includes('rw-chipbtn') || c.includes('rw-slot-alock') || c.includes('rw-slot-tlock')) key = 'lock';
        else if (c.includes('rw-sec')) key = 'fan:' + (e.style.getPropertyValue('--c') || 0) + ':' + (e.style.getPropertyValue('--r') || 0);
        else if (c.includes('rw-steerbtn') || c.includes('rw-tiltbar')) key = 'steer';
        else if (c.includes('rw-ammo')) key = 'ammo';
        add(key || 'other', e, !display, { label: e.getAttribute('aria-label') });
      }
      add('minimap', document.querySelector('.rw-minimap'), true);
      add('speed', document.querySelector('.rw-speedbox'), false);
      add('health', document.querySelector('.rw-hpmeter'), false);
      add('clock', document.querySelector('.rw-clock'), false);
      add('stars', document.querySelector('.rw-wanted'), false);
      add('stack', document.querySelector('.rw-stack'), false);
      add('objcell', document.querySelector('.rw-objcell'), false);
      add('cool', document.querySelector('.rw-cool'), false);
      add('m1', document.querySelector('.rw-m1'), false, { kind: document.querySelector('.rw-m1').className });
      add('m2', document.querySelector('.rw-m2'), false, { kind: document.querySelector('.rw-m2').className });
      add('boostbar', document.querySelector('.rw-boostbar'), false);
      add('score', document.querySelector('.rw-score'), false);
      add('combo', document.querySelector('.rw-combo'), false);
      add('prompt', document.querySelector('.rw-prompt'), false);
      add('steer', document.querySelector('.rw-wheel'), false);
      add('steer', document.querySelector('.rw-pad'), false);
      add('steer', document.querySelector('.rw-stick'), false);
      // text on pills: colour, background (own), opacity along the chain
      const texts = [];
      for (const sel of ['.rw-speedbox', '.rw-score', '.rw-combo', '.rw-clock', '.rw-m1', '.rw-m2', '.rw-objcell', '.rw-wanted', '.rw-prompt', '.rw-ammo .rw-face']) {
        const e = document.querySelector(sel);
        if (!e || !vis(e)) continue;
        const cs = getComputedStyle(e);
        let op = 1;
        for (let p = e; p; p = p.parentElement) op *= Number(getComputedStyle(p).opacity);
        texts.push({ sel, color: cs.color, bg: cs.backgroundColor, op });
      }
      const cv = document.getElementById('game').getBoundingClientRect();
      const cs = (e) => { const s = getComputedStyle(e); return { bg: s.backgroundColor, pad: s.padding, img: s.backgroundImage }; };
      return { out, texts, mode: g.player.mode, mortal: !document.querySelector('.rw-hpmeter').classList.contains('rw-none'), canvas: { x: cv.left, y: cv.top, w: cv.width, h: cv.height },
        page: { html: cs(document.documentElement), body: cs(document.body), ui: cs(document.getElementById('ui')) },
        boot: getComputedStyle(document.getElementById('boot')).display, vw: innerWidth, vh: innerHeight };
    }).then((m) => ({ ...m, grid, L, hand, hud, name }));

    const checkState = (m) => {
      const { grid, L, hand, hud, name } = m;
      const tag = `${grid.V}x${grid.H} L${L} ${hand ? 'left' : 'right'}-handed ${hud} ${name}${m.fan ? ' fan' : ''}${m.style ? ' ' + m.style : ''}`;
      const bad = (what) => problems.push(`${tag}: ${what}`);
      states++;
      elements += m.out.length;
      if (m.vw !== grid.V || m.vh !== grid.H) bad(`viewport ${m.vw}x${m.vh}`);
      const el = m.out;
      const kRect = [0.36 * grid.V, 0.40 * grid.H, 0.64 * grid.V, 0.90 * grid.H];
      const expect = (key, e, tol = 2) => {
        let t = grid[key];
        if (!t) return;
        if (key === 'boostbar') { // 6.12: under the speed; 16 lower with the health meter, under the clock in Full
          const lo = grid.V === 915;
          t = [t[0], hud === 'full' ? (lo ? 91 : 85) : (m.mortal === false ? t[1] : (lo ? 72 : 68)), t[2], t[3]];
        }
        let x = t[0];
        const left = ['minimap', 'speed', 'health', 'clock', 'boostbar'].includes(key);
        const mirror = hand && ['gas', 'brake', 'exit', 'hand', 'fire', 'lock', 'more', 'boost', 'extra'].includes(key);
        if (left) x += L;
        if (mirror) x = grid.V - t[0] - t[2] + L;
        // SIREN sits beside the steering slot: it moves with the left inset and mirrors to the right edge (no inset there)
        if (key === 'siren') x = hand ? grid.V - t[0] - t[2] : t[0] + L;
        if (Math.abs(e.x - x) > tol || Math.abs(e.y - t[1]) > tol || Math.abs(e.w - t[2]) > tol || Math.abs(e.h - t[3]) > tol) {
          bad(`${key} (${e.name}) is ${e.x.toFixed(1)},${e.y.toFixed(1)},${e.w.toFixed(1)}x${e.h.toFixed(1)}, grid says ${x},${t[1]},${t[2]}x${t[3]}`);
        }
      };
      for (const e of el) {
        if (['minimap', 'speed', 'health', 'stars', 'stack', 'objcell', 'cool', 'score', 'pause', 'prompt', 'gas', 'brake', 'exit', 'hand', 'fire', 'lock', 'more',
          'boost', 'boostbar', 'siren', 'extra'].includes(e.key)) {
          // The foot FIRE and RUN take the pedal rects (the same size); every other key matches its own rect.
          expect(e.key, e);
        }
        if (e.key === 'ammo') expect('ammo', e);
        if (e.key.startsWith('fan:')) {
          const [, c, r] = e.key.split(':').map(Number);
          let x = grid.fanX[c];
          if (hand) x = grid.V - x - grid.fanS + L;
          const y = grid.fanY[r];
          if (Math.abs(e.x - x) > 2 || Math.abs(e.y - y) > 2 || Math.abs(e.w - grid.fanS) > 2) bad(`fan cell ${c},${r} (${e.label}) is ${e.x.toFixed(1)},${e.y.toFixed(1)}, grid says ${x},${y}`);
        }
        // sizes
        if (e.hit && (e.w < 47.5 || e.h < 47.5)) bad(`hit box ${e.label || e.name} is ${e.w.toFixed(1)}x${e.h.toFixed(1)}, under 48`);
        // insets and the safe edge: right-handed layouts keep 8 px from the safe edge
        if (e.x < L - 0.5) bad(`${e.label || e.name} starts at ${e.x.toFixed(1)}, inside the left inset ${L}`);
        if (e.hit && (e.x < L + 7.5 || e.y < 7.5 || e.r > grid.V - 7.5 || e.b > grid.H - 7.5)) bad(`${e.label || e.name} is closer than 8 px to the safe edge`);
        if (e.r > grid.V + 0.5 || e.b > grid.H + 0.5 || e.y < -0.5) bad(`${e.label || e.name} leaves the screen`);
        // keep-out: nothing permanent inside the craft's rect
        // (3) left-handed with a left inset, the 5-button weapon arc cannot clear the keep-out rect (MSL, COAX): allowed by name only
        // (the 780x360 fan column that used to be allowed here is fixed by 6.12: 48 px cells, third column at x 548)
        if (hand && L > 0 && /slot-(msl|coax)/.test(e.name)) continue;
        if (e.x < kRect[2] && e.r > kRect[0] && e.y < kRect[3] && e.b > kRect[1]) bad(`${e.label || e.key} (${e.name}) is inside the keep-out rect`);
      }
      // steering widget inside the steering slot (mirrored when left-handed)
      for (const e of el.filter((q) => q.key === 'steer' && !q.hit)) {
        const s = grid.slot;
        const sx = hand ? grid.V - s[0] - s[2] : s[0] + L;
        if (e.x < sx - 3 || e.r > sx + s[2] + 3 || e.y < s[1] - 3 || e.b > s[1] + s[3] + 3) bad(`steering widget ${e.name} ${e.x.toFixed(0)},${e.y.toFixed(0)},${e.w.toFixed(0)}x${e.h.toFixed(0)} is outside the slot ${sx},${s[1]},${s[2]}x${s[3]}`);
      }
      for (const e of el.filter((q) => q.key === 'steer' && q.hit)) {
        const s = grid.slot;
        const sx = hand ? grid.V - s[0] - s[2] : s[0] + L;
        if (e.x < sx - 3 || e.r > sx + s[2] + 3 || e.y < s[1] - 3 || e.b > s[1] + s[3] + 3) bad(`steering button ${e.label} is outside the slot`);
      }
      // overlaps (everything) and gaps (hit boxes). The strip is a reserved box
      // (checked against the grid above): what can overlap is its content, the
      // title and the toasts. docs/REVAMP.md 6.5 conflicts, reported to W0 and
      // allowed here by name only: (1) with a left-handed layout and a left
      // inset the fan reaches 14 px (56 px at 780x360) into the strip box;
      // (2) at 780x360 left-handed the fan's top row is 4 px from the minimap.
      const items = el.filter((q) => q.key !== 'stack');
      for (let i = 0; i < items.length; i++) {
        for (let j = i + 1; j < items.length; j++) {
          const a = items[i], b = items[j];
          // (4) at 780x360 left-handed with a left inset, the mirrored FIRE-rect button reaches 20 px into the prompt strip
          if (grid.V === 780 && hand && L > 0 && [a, b].some((q) => q.key === 'prompt') && [a, b].some((q) => q.key === 'fire')) continue;
          if (inter(a, b)) bad(`${a.label || a.key} (${a.name}) overlaps ${b.label || b.key} (${b.name})`);
          else if (a.hit && b.hit && gapOf(a, b) < 7.5) {
            bad(`gap ${gapOf(a, b).toFixed(1)} between ${a.label || a.key} and ${b.label || b.key}`);
          }
        }
      }
      // the stack holds its content; its two message rows are one line of 28 px each and never go past y = 100 + T
      const st = el.find((q) => q.key === 'stack');
      for (const k of el.filter((q) => ['stars', 'objcell', 'cool', 'm1', 'm2'].includes(q.key))) {
        if (st && (k.b > st.b + 0.5 || k.y < st.y - 0.5 || k.x < st.x - 0.5 || k.r > st.r + 0.5)) bad(`${k.key} spills out of the top centre stack`);
        if ((k.key === 'm1' || k.key === 'm2') && Math.abs(k.h - 28) > 0.5) bad(`${k.key} is ${k.h.toFixed(1)} high, not one 28 px line`);
        if (k.b > 100.5) bad(`${k.key} ends at ${k.b.toFixed(1)}, past y 100`);
      }
      // a message pill is centred in its row
      for (const k of el.filter((q) => q.key === 'm1' || q.key === 'm2')) {
        const row = grid[k.key];
        if (Math.abs((k.x + k.r) / 2 - (row[0] + row[2] / 2)) > 2) bad(`${k.key} is not centred in its row`);
      }
      // HG-2: at most one control in the BOOST cell (BOOST, or GARAGE and TALK); BOOST hides while an offer shows
      const cell = el.filter((q) => q.key === 'boost');
      if (cell.length > 1) bad('more than one control in the BOOST cell');
      if (m.name.endsWith('garage') || m.name.endsWith('talk')) {
        if (!cell.length || /Boost/.test(cell[0].label || '') || !/garage/i.test(cell[0].label || '')) bad(`the offer does not take the BOOST cell (${cell.map((q) => q.label)})`);
      } else if (['car', 'boat', 'plane', 'plane-armed', 'heli-armed'].includes(m.name) && !(cell.length === 1 && /Boost/.test(cell[0].label || ''))) bad('BOOST is missing');
      if (['foot', 'tank'].includes(m.name) && cell.length) bad(`${m.name} has a control in the BOOST cell`);
      // SIREN in a car only, EXTRA in a car only; boost meter where BOOST shows
      for (const [key, want] of [['siren', 'car'], ['extra', 'car']]) {
        const have = el.filter((q) => q.key === key).length;
        if ((m.name.startsWith(want) && have !== 1) || (!m.name.startsWith(want) && have)) bad(`${key} count ${have} in ${m.name}`);
      }
      // armed craft: the weapon arc stays in the 352 by 220 box and off EXIT, MORE
      if (m.name.includes('armed') || m.name === 'tank') {
        // the box is mirrored with the layout: V - 352 - R to V, or L to L + 352
        // BOOST, SIREN and EXTRA are slots too but not part of the arc; the arc must not cover BOOST (6.12, checked by the overlap test)
        for (const e of el.filter((q) => q.name.includes('slot') && !/slot-(boost|siren|extra)/.test(q.name))) {
          const outX = hand ? e.r > L + 352.5 : e.x < grid.V - 352 - 0.5;
          if (outX || e.y < grid.H - 220 - 0.5) bad(`${e.label} leaves the arc box`);
        }
      }
      // contrast on the pills
      for (const t of m.texts) {
        const parse = (s) => (s.match(/[\d.]+/g) || []).map(Number);
        const fg = parse(t.color).slice(0, 3);
        const bg = parse(t.bg);
        const a = (bg.length === 4 ? bg[3] : (bg.length === 3 ? 1 : 0)) * t.op;
        if (a < 0.55) { bad(`${t.sel} text has no dark pill (alpha ${a.toFixed(2)})`); continue; }
        const mix = [0, 1, 2].map((i) => bg[i] * a + 255 * (1 - a)); // over a white sky, the worst case for white text
        const cr = contrast(fg, mix);
        if (cr < 4.5) bad(`${t.sel} contrast ${cr.toFixed(2)} is under 4.5`);
      }
      // the world draws under the cut-out
      const c = m.canvas;
      if (c.x !== 0 || c.y !== 0 || Math.abs(c.w - grid.V) > 0.5 || Math.abs(c.h - grid.H) > 0.5) bad('the canvas does not cover the whole viewport');
      for (const k of ['html', 'body', 'ui']) {
        const p = m.page[k];
        if (!/rgba\(0, 0, 0, 0\)|transparent/.test(p.bg) || p.img !== 'none' || !/^0px/.test(p.pad)) bad(`${k} has a background or padding (${p.bg} ${p.pad})`);
      }
      if (m.boot !== 'none') bad('the title screen is still showing');
    };

    for (const grid of [GRID.A, GRID.B]) {
      await pg.setViewportSize({ width: grid.V, height: grid.H });
      for (const L of [0, 40]) {
        await pg.evaluate((l) => { document.documentElement.style.setProperty('--rw-test-sl', l + 'px'); window.dispatchEvent(new Event('resize')); }, L);
        for (const hand of [false, true]) {
          await pg.evaluate((h) => window.__rw.touch.setLeftHanded(h), hand);
          for (const [name, kind, armed] of MODES) {
            if (!(await setMode(kind, armed, name))) continue;
            for (const hud of ['minimal', 'full']) {
              await pg.evaluate((m) => { window.__rw.touch.setHudMode(m); window.__rw.hud.setHudMode(m); window.__rw.touch.update(1 / 60); }, hud);
              for (const fan of hud === 'full' ? [false] : [false, true]) {
                const open = await pg.evaluate(() => window.__rw.touch.isFanOpen());
                if (open !== fan) {
                  const mp = await pg.evaluate(() => { const r = document.querySelector('.rw-more').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
                  await pg.touchscreen.tap(mp.x, mp.y);
                }
                await force();
                await pg.waitForTimeout(states === 0 ? 500 : 60);
                await settle();
                const m = await measure(grid, L, hand, hud, name);
                m.fan = fan;
                checkState(m);
              }
            }
          }
          // the four steering styles in a car
          await setMode('car', null, 'car');
          await pg.evaluate(() => { window.__rw.touch.setHudMode('minimal'); window.__rw.hud.setHudMode('minimal'); });
          for (const style of ['wheel', 'buttons', 'slider', 'tilt']) {
            await pg.evaluate((s) => { window.__rw.touch.setSteering(s, 1); window.__rw.touch.update(1 / 60); }, style);
            await force();
            await pg.waitForTimeout(60);
            await settle();
            const m = await measure(grid, L, hand, 'minimal', 'car');
            m.style = style;
            checkState(m);
          }
          await pg.evaluate(() => window.__rw.touch.setSteering('wheel', 1));
        }
      }
    }
    // HG-3 to HG-5 (docs/REVAMP.md 6.12): the top centre stack with every item forced on in the same frame,
    // a 200 character toast, and the stack against the speed readout with the minimap grown.
    let hgStates = 0;
    const hgProblems = [];
    const stackItems = () => pg.evaluate(() => {
      const out = [];
      for (const [key, sel] of [['stars', '.rw-wanted'], ['objcell', '.rw-objcell'], ['cool', '.rw-cool'], ['m1', '.rw-m1'], ['m2', '.rw-m2']]) {
        const e = document.querySelector(sel);
        const cs = getComputedStyle(e);
        const r = e.getBoundingClientRect();
        let shown = cs.display !== 'none' && r.width > 0 && r.height > 0;
        for (let p = e.parentElement; shown && p && p !== document.body; p = p.parentElement) if (getComputedStyle(p).display === 'none') shown = false;
        if (shown) out.push({ key, text: e.textContent, kind: e.className, x: r.left, y: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height,
          over: e.scrollWidth > e.clientWidth, ell: cs.textOverflow, ws: cs.whiteSpace });
      }
      return out;
    });
    for (const grid of [GRID.A, GRID.B]) {
      await pg.setViewportSize({ width: grid.V, height: grid.H });
      for (const L of [0, 40]) {
        await pg.evaluate((l) => { document.documentElement.style.setProperty('--rw-test-sl', l + 'px'); window.dispatchEvent(new Event('resize')); }, L);
        for (const hand of [false, true]) {
          await pg.evaluate((h) => window.__rw.touch.setLeftHanded(h), hand);
          await setMode('car', null, 'car');
          for (const hud of ['minimal', 'full']) {
            await pg.evaluate((m) => { window.__rw.touch.setHudMode(m); window.__rw.hud.setHudMode(m); window.__rw.touch.update(1 / 60); }, hud);
            if (hud === 'minimal') {
              const open = await pg.evaluate(() => window.__rw.touch.isFanOpen());
              if (!open) {
                const mp = await pg.evaluate(() => { const r = document.querySelector('.rw-more').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
                await pg.touchscreen.tap(mp.x, mp.y);
              }
            }
            const tag = `${grid.V}x${grid.H} L${L} ${hand ? 'left' : 'right'}-handed ${hud}${hud === 'minimal' ? ' fan' : ''}`;
            const bad = (w) => hgProblems.push(`${tag}: ${w}`);
            hgStates++;
            // HG-3: everything on in one frame
            await pg.evaluate(() => {
              const g = window.__rw;
              const q = (c) => document.querySelector(c);
              g.hud.stack.reset();
              g.hud.setObjective(false, 0, '');
              q('.rw-wanted').classList.add('rw-none');
              q('.rw-wanted').classList.remove('rw-cooling');
              g.hud.update({ ...g.hudState, mode: 'car', speedKmh: 50, stars: 0, wanted: 0, cooling: 0, district: 'Little Havana ' + Math.random(), boost: 0.8, mortal: false });
              g.hud.setObjective(true, 40, '0.4 mi');
              g.hud.toast('First Light', 4, 'objective');
              g.hud.update({ ...g.hudState, mode: 'car', speedKmh: 50, stars: 5, wanted: 5, cooling: 0.5, district: 'Allapattah ' + Math.random(), boost: 0.8, mortal: false });
              g.hud.toast('Pulled over! Off with a warning.', 1.5, 'police');
              g.hud.toast('Wrecked  +250', 1.6, 'score');
              g.hud.toast('Tap EXIT to get out. Walk up to anything and tap ENTER.', 4.5, 'hint');
              g.hud.toast('Camera: far', 1, 'info');
            });
            await settle();
            let items = await stackItems();
            const keys = items.map((i) => i.key).sort().join();
            if (keys !== 'cool,m1,m2,objcell,stars') bad(`HG-3 visible set is ${keys}, want stars, objective cell, escape bar, one message in each row`);
            const m1 = items.find((i) => i.key === 'm1'), m2 = items.find((i) => i.key === 'm2');
            if (!m1 || !/rw-k-police/.test(m1.kind)) bad('HG-3 row 1 is not the police toast');
            if (!m2 || !/rw-k-hint/.test(m2.kind)) bad('HG-3 row 2 is not the hint');
            const box = { x: grid.stack[0], y: grid.stack[1] + 0, r: grid.stack[0] + grid.stack[2], b: grid.stack[1] + grid.stack[3] };
            for (const it of items) {
              if (it.x < box.x - 0.5 || it.r > box.r + 0.5 || it.y < box.y - 0.5 || it.b > box.b + 0.5) bad(`HG-3 ${it.key} ${it.x.toFixed(0)},${it.y.toFixed(0)},${it.r.toFixed(0)},${it.b.toFixed(0)} is outside the stack box`);
            }
            for (let i = 0; i < items.length; i++) for (let j = i + 1; j < items.length; j++) if (inter(items[i], items[j])) bad(`HG-3 ${items[i].key} overlaps ${items[j].key}`);
            // and against everything else on screen (speed, score, combo, pause, the open fan, the ammo panel, the minimap)
            const mm = await measure(grid, L, hand, hud, 'car');
            for (const it of items) for (const o of mm.out) {
              if (['stack', 'stars', 'objcell', 'cool', 'm1', 'm2'].includes(o.key)) continue;
              if (inter(it, o)) bad(`HG-3 ${it.key} overlaps ${o.label || o.key}`);
            }
            // after the police toast ends the objective line takes row 1; the score and info toasts were dropped or waited
            await pg.evaluate(() => window.__rw.hud.tick(1.6));
            await settle();
            items = await stackItems();
            const n1 = items.find((i) => i.key === 'm1');
            if (!n1 || !/rw-k-objective/.test(n1.kind) || n1.text !== 'First Light') bad(`HG-3 after the police toast row 1 is ${n1 ? n1.text : 'empty'}, want the objective line`);
            // HG-4: a 200 character toast stays one line, inside its row, ending in an ellipsis
            await pg.evaluate(() => {
              const g = window.__rw;
              g.hud.stack.reset();
              g.hud.toast('Long police message '.repeat(10).slice(0, 200), 5, 'police');
              g.hud.toast('A very long toast that should never wrap onto a second line '.repeat(4).slice(0, 200), 5, 'info');
            });
            await settle();
            items = await stackItems();
            for (const k of ['m1', 'm2']) {
              const it = items.find((i) => i.key === k);
              const row = grid[k];
              if (!it) { bad(`HG-4 ${k} is empty`); continue; }
              if (Math.abs(it.h - 28) > 0.5 || it.x < row[0] - 0.5 || it.r > row[0] + row[2] + 0.5) bad(`HG-4 ${k} is ${it.w.toFixed(0)}x${it.h.toFixed(0)}, not one line inside its row`);
              if (!it.over || it.ell !== 'ellipsis' || it.ws !== 'nowrap') bad(`HG-4 ${k} does not end in an ellipsis (overflow ${it.over}, ${it.ell}, ${it.ws})`);
            }
            // HG-5: the grown minimap pushes the speed readout right; the long lines keep clear of it
            await pg.evaluate(() => {
              const c = window.__rw.hud.minimapCanvas;
              c.dispatchEvent(new PointerEvent('pointerdown', { pointerType: 'touch', bubbles: true, cancelable: true }));
            });
            await pg.waitForTimeout(260);
            await settle();
            items = await stackItems();
            const mg = await measure(grid, L, hand, hud, 'car');
            const sp = mg.out.find((o) => o.key === 'speed');
            if (!sp) bad('HG-5 no speed readout to check against');
            else {
              for (const it of items) if (inter(it, sp)) bad(`HG-5 ${it.key} overlaps the speed readout with the minimap grown`);
              if (L === 0 && inter({ x: box.x, y: box.y, r: box.r, b: box.b }, sp)) bad('HG-5 the stack box overlaps the speed readout with the minimap grown');
            }
            for (const o of mg.out) {
              if (!['score', 'combo', 'pause', 'ammo', 'minimap'].includes(o.key) && !o.key.startsWith('fan:')) continue;
              for (const it of items) if (inter(it, o)) bad(`HG-5 ${it.key} overlaps ${o.label || o.key}`);
            }
            await pg.evaluate(() => {
              const c = window.__rw.hud.minimapCanvas;
              c.dispatchEvent(new PointerEvent('pointerdown', { pointerType: 'touch', bubbles: true, cancelable: true }));
              window.__rw.hud.stack.reset();
              window.__rw.hud.setObjective(false, 0, '');
              window.__rw.hud.update({ ...window.__rw.hudState, mode: 'car', stars: 0, wanted: 0, cooling: 0, boost: -1, mortal: false });
            });
            await pg.waitForTimeout(220);
          }
          await pg.evaluate(() => { window.__rw.touch.setHudMode('minimal'); window.__rw.hud.setHudMode('minimal'); });
        }
      }
    }
    for (const p of hgProblems.slice(0, 40)) console.log('   ', p);
    check(`top centre stack: ${hgStates} states: HG-3 everything on at once, HG-4 long toast, HG-5 clear of the speed readout, score, fan and ammo panel`, hgProblems.length === 0, `(${hgProblems.length} problems)`);
    // The title screen (docs/REVAMP.md 6.8): name, Start (Loading until ready), Continue only when offered, credit, version.
    for (const [w, h] of [[915, 412], [780, 360]]) {
      const tc = await br.newContext({ viewport: { width: w, height: h }, hasTouch: true, isMobile: true, deviceScaleFactor: 1 });
      const tp = await tc.newPage();
      await tp.goto(base);
      const loading = await tp.evaluate(() => getComputedStyle(document.getElementById('play'), '::after').content + ':' + document.getElementById('play').disabled);
      await tp.waitForFunction(() => !document.getElementById('play').disabled, null, { timeout: 120000 });
      for (const L of [0, 40]) {
        await tp.evaluate((l) => document.documentElement.style.setProperty('--rw-test-sl', l + 'px'), L);
        const r = await tp.evaluate(() => {
          const q = (s) => { const e = document.querySelector(s); const b = e.getBoundingClientRect(); return { x: b.left, y: b.top, w: b.width, h: b.height, r: b.right, b: b.bottom, hidden: e.hidden, text: e.textContent, after: getComputedStyle(e, '::after').content }; };
          const c = document.getElementById('continue');
          const before = c.hidden;
          c.hidden = false;
          const out = { h1: q('#boot h1'), play: q('#play'), cont: q('#continue'), credit: q('#bootcredit'), ver: q('#bootver'), before };
          c.hidden = before;
          return out;
        });
        const tag = `title ${w}x${h} L${L}`;
        check(`${tag}: Loading while the city builds, then Start (180x56), bottom edge 24 up`, loading.startsWith('"Loading"') && /Start/.test(r.play.after) && r.play.w === 180 && r.play.h === 56 && Math.abs(r.play.b - (h - 24)) < 1.5, JSON.stringify([loading, r.play]));
        check(`${tag}: Continue (180x56) hidden on a fresh profile, left of Start with 16 between`, r.before === true && r.cont.w === 180 && r.cont.h === 56 && Math.abs(r.play.x - r.cont.r - 16) < 1.5 && r.cont.x < r.play.x, JSON.stringify([r.cont, r.play]));
        check(`${tag}: name at 24 + inset, 20, 40 high; credit bottom left; version bottom right`, Math.abs(r.h1.x - (24 + L)) < 1.5 && Math.abs(r.h1.y - 20) < 1.5 && Math.abs(r.h1.h - 40) < 1.5
          && /OpenStreetMap contributors, ODbL/.test(r.credit.text) && r.credit.x >= L + 7.5 && /^v\d+\.\d+\.\d+/.test(r.ver.text) && r.ver.r <= w - 7.5, JSON.stringify([r.h1, r.credit, r.ver]));
      }
      await tc.close();
    }
    for (const p of problems.slice(0, 400)) console.log('   ', p);
    check(`live layout: ${states} states, ${elements} elements: no overlap, gap, size, keep-out, inset, grid, contrast or cut-out problem`, problems.length === 0, `(${problems.length} problems)`);
    check('live layout: no page errors', errs.length === 0, errs.slice(0, 3).join(' | '));
  } finally {
    await br.close();
    srv.close();
  }
}

if (process.env.UI_LIVE_ONLY) { // quick runs while working on the grid: only the built game
  await liveLayout(check);
  console.log(failures.length ? `\nFAILED ${failures.length}/${checks}: ${failures.join('; ')}` : `\nPASSED ${checks}/${checks} checks`);
  process.exit(failures.length ? 1 : 0);
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
  // Wait until every finite CSS transition and animation has finished (the
  // secondary buttons hide with a 0.16 s transition plus a delayed
  // visibility), whatever the machine speed. Endless pulses are skipped.
  const settleCss = () => page.evaluate(async () => {
    const running = () => document.getAnimations().filter((a) => a.effect && a.effect.getComputedTiming().iterations !== Infinity && a.playState === 'running');
    for (let i = 0; i < 5 && running().length; i++) await Promise.allSettled(running().map((a) => a.finished));
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  });
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
  check('gas pedal 72x88 (docs/REVAMP.md 6.5)', Math.abs(gas.w - 72) < 2 && Math.abs(gas.h - 88) < 2, `${gas.w}x${gas.h}`);
  check('brake pedal left of gas', brake.x < gas.x);
  const small = await page.evaluate(() => [...document.querySelectorAll('.rw-btn')]
    .filter((b) => b.offsetParent).map((b) => Math.min(b.offsetWidth, b.offsetHeight)));
  check('all visible buttons >= 48px', Math.min(...small) >= 48, `min ${Math.min(...small)}`);

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
  check('wheel 60 deg -> 0.545 of 110 deg lock through the curve', near(st60, await shape(60 / 110)), `${st60}`);
  check('wheel graphic rotates', /rotate\(6\d(\.\d)?deg\)|rotate\(59\.\ddeg\)/.test(await wheelRot()), await wheelRot());
  await turn(1, wb, 60, 150);
  check('wheel past 120 deg -> full right', (await read('rw.input.steer')) === 1);
  await turn(1, wb, 150, -150, 8);
  check('wheel turned back past centre -> full left', (await read('rw.input.steer')) === -1);
  // The finger went 30 deg past the stop; turning back moves the wheel at once.
  await turn(1, wb, -150, -60);
  const stm30 = await read('rw.input.steer');
  check('wheel back to -20 deg -> proportional left (110 deg lock)', near(stm30, await shape(-20 / 110)), `${stm30}`);
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
  check('arrow pads 72 square', sr.w >= 72 && sr.h >= 72 && sl.x < sr.x, JSON.stringify([sl, sr]));
  await down(3, sr.x, sr.y);
  check('button: no steer before update', (await read('rw.input.steer')) === 0);
  await tick(6);
  const b1 = await read('rw.input.steer');
  check('button ramp 0.1 s -> 1/3 raw (0.3 s to full lock)', near(b1, await shape(1 / 3)), `${b1}`);
  await tick(12);
  check('button ramp 0.3 s -> full lock', (await read('rw.input.steer')) === 1);
  await up(3);
  await tick(5);
  const b2 = await read('rw.input.steer');
  check('button release: target 0 at once (the car returns the wheel)', b2 === 0, `${b2}`);
  await tick(5);
  check('button back at centre', (await read('rw.input.steer')) === 0);
  await tick(15, 1 / 30); // frame-rate independent: 0.3 s at 30 Hz
  await down(3, sl.x, sl.y);
  await tick(10, 1 / 30);
  check('button ramp same at 30 Hz', (await read('rw.input.steer')) === -1);
  await up(3);
  await tick(10);
  await shot('car-buttons-915x412.png');
  await page.setViewportSize({ width: 780, height: 360 });
  await page.waitForTimeout(150);
  await shot('car-buttons-780x360.png');
  await page.setViewportSize({ width: 915, height: 412 });

  // ---- steering style: slider (absolute, 90 px from the bar centre is full lock, docs/REVAMP.md 6.3) ----
  await page.evaluate(() => rw.touch.setSteering('slider', 1));
  const pb = await page.evaluate(() => { const r = document.querySelector('.rw-pad').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
  await down(1, pb.x + 45, pb.y);
  const s55 = await read('rw.input.steer');
  check('slider: where the thumb lands is the value (45 px -> raw 0.5, curved)', near(s55, await shape(0.5)) && s55 > 0.4 && s55 < 0.5, `${s55}`);
  await drag(1, pb.x + 45, pb.y, pb.x + 120, pb.y);
  check('slider 90+ px -> full right', (await read('rw.input.steer')) === 1);
  await drag(1, pb.x + 120, pb.y, pb.x - 300, pb.y, 16);
  check('slider far left (off the bar) still steers full left', (await read('rw.input.steer')) === -1);
  await move(1, pb.x, pb.y);
  check('slider centre -> 0', (await read('rw.input.steer')) === 0);
  await page.evaluate(() => rw.touch.setSteering('slider', 1.5));
  await move(1, pb.x + 45, pb.y);
  const s55b = await read('rw.input.steer');
  check('higher sensitivity -> more steer', s55b > s55 + 0.1 && near(s55b, await shape(45 / 60)), `${s55b} vs ${s55}`);
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
  const tb = await center('Tilt steering (tap the steering area to re-centre)');
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
  const lh = await center('Horn');
  const lmore = await center('More controls');
  check('lefty: more button and fan on the left, the fan opens beside and above it', lh.x < 420 && lmore.x < 300 && Math.abs(lh.x - lmore.x) < 70 && lh.y <= lmore.y + 1, JSON.stringify([lh.x, lmore.x]));
  await tapMore();
  p0 = rimPt(lw, 0);
  await down(1, p0.x, p0.y);
  await turn(1, lw, 0, 60);
  check('lefty: wheel steers', near(await read('rw.input.steer'), await shape(60 / 110)));
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
  const hb = await center('Handbrake'); // a main button now, no fan needed
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
  check('speed text (87.4 km/h shown as 54 mph)', (await page.textContent('.rw-speed')).startsWith('54'));
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
  const run = await center('Run'); // a primary on the BRAKE rect now, no fan needed
  const ent = await center('Enter car');
  check('foot: ENTER is a 56 px primary', ent.w >= 56, `${ent.w}`);
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
      if (r.width > 0 && r.height > 0) out.push({ name, l: r.left, t: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height, btn: e.classList.contains('rw-btn') && !e.classList.contains('rw-ammo') });
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
    await settleCss();
    const { out, W, H } = await layoutOf();
    const bad = [];
    for (const b of out) {
      if (b.l < -0.5 || b.t < -0.5 || b.r > W + 0.5 || b.b > H + 0.5) bad.push(`${b.name} off-screen`);
      if (b.btn && Math.min(b.w, b.h) < 48) bad.push(`${b.name} ${b.w}x${b.h} < 48`);
    }
    for (let i = 0; i < out.length; i++) {
      for (let j = i + 1; j < out.length; j++) {
        const a = out[i], b = out[j];
        const ox = Math.min(a.r, b.r) - Math.max(a.l, b.l), oy = Math.min(a.b, b.b) - Math.max(a.t, b.t);
        if (ox > 1 && oy > 1) bad.push(`${a.name} x ${b.name}`);
      }
    }
    check(`layout ${label}: ${out.length} blocks in view, >=48px, no overlaps`, bad.length === 0, bad.join(', '));
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
        // 6.12 adds BOOST to the boat (7); a car with a siren or an extra shows up to 2 more, forced separately by the live layout test
        check(`minimal ${tag}: at most 8 buttons at once on foot or in a car (HAND, SWAP, RUN are slots now), 7 in a boat, 6 elsewhere (${n})`, n <= (m === 'car' || m === 'foot' ? 8 : m === 'boat' ? 7 : 6), String(n));
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
        await settleCss();
        await checkLayout(`full ${tag}`);
        check(`full ${tag}: nothing folded, more button gone`, await page.evaluate(() => !document.querySelector('.rw-more').offsetParent
          && [...document.querySelectorAll('.rw-sec')].every((e) => getComputedStyle(e).visibility === 'visible' && getComputedStyle(e).opacity === '1')));
        if (!lefty || m === 'foot' || m === 'car') await shot(`full-${fileTag}.png`);
      }
      await page.evaluate(() => { rw.touch.setHudMode('minimal'); rw.hud.setHudMode('minimal'); rw.touch.setMode('car'); rw.touch.setSteering('buttons'); });
      await page.waitForTimeout(260); // let the folded fan finish its 0.16 s fold
      await settleCss();
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
  await settleCss();
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
  const hb2 = await center('Handbrake');
  const wbh = await wheelBox();
  const gs = await center('Gas');
  await down(1, hb2.x, hb2.y);
  const ph = rimPt(wbh, 0);
  await down(2, ph.x, ph.y);
  await turn(2, wbh, 0, 130);
  await down(3, gs.x, gs.y);
  await page.waitForTimeout(4600);
  check('hold HAND + steer + gas together past 4 s: HAND is a main button, always visible', await page.locator('[aria-label="Handbrake"]').isVisible());
  const trio = await read('[rw.input.handbrake, rw.input.steer, rw.input.throttle]');
  check('handbrake, steer 1 and gas all held', trio.join() === 'true,1,1', trio.join());
  await shot('car-handbrake-hold-915x412.png');
  await up(1);
  await page.waitForTimeout(40);
  check('releasing HAND: steer and gas stay', (await read('[rw.input.handbrake, rw.input.steer, rw.input.throttle]')).join() === 'false,1,1');
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
    check(`idle ${label}: ~85% size, ~70% opacity, hit area >= 48`, Math.abs(f.ratio - 0.85) < 0.02 && Math.abs(f.op - 0.7) < 0.03 && f.hit >= 48, JSON.stringify(f));
  }
  const gc = await center('Gas');
  await down(32, gc.x, gc.y);
  // Machine-speed independent: wait for the transition to finish, then check
  // the end state and that the transition itself lasts at most 140 ms.
  await settleCss();
  const fg = await face('Gas');
  const fdur = await page.evaluate(() => {
    const cs = getComputedStyle(document.querySelector('[aria-label="Gas"] .rw-face'));
    const secs = (t) => t.split(',').map((x) => parseFloat(x) * (x.trim().endsWith('ms') ? 0.001 : 1));
    const d = secs(cs.transitionDuration), dl = secs(cs.transitionDelay);
    return Math.max(...d.map((v, i) => v + (dl[i % dl.length] || 0)));
  });
  check('Gas grows to full size and opacity within 140 ms of a touch', fg.ratio > 0.99 && fg.op > 0.99 && fdur <= 0.14, JSON.stringify({ ...fg, fdur }));
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
  // District: the title pill in the strip for 3 s after a change.
  await page.evaluate(() => rw.hud.update({ mode: 'car', speedKmh: 40, health: 80, score: 5, pending: 0, combo: 1, wanted: 0, district: 'Saltmarsh Docks', time: 9, vehicleHealth: 0.7 }));
  await page.waitForTimeout(500);
  const dOp = () => page.evaluate(() => { const e = document.querySelector('.rw-m1.rw-title'); return !e || getComputedStyle(e).display === 'none' ? 0 : parseFloat(getComputedStyle(e).opacity); });
  check('district name shows as a banner pill in message row 1 after a change', (await dOp()) > 0.5 && (await page.textContent('.rw-m1.rw-title')) === 'Saltmarsh Docks');
  await page.waitForTimeout(3200);
  check('district title gone after 3 s, taking no room', (await dOp()) === 0);

  // Score, combo: always at full strength on their own pill (contrast), never dimmed.
  const trOp = () => page.evaluate(() => parseFloat(getComputedStyle(document.querySelector('.rw-tr')).opacity));
  const hudNow = (o) => page.evaluate((x) => rw.hud.update({ mode: 'car', speedKmh: 40, health: 80, score: 5, pending: 0, combo: 1, wanted: 0,
    district: 'Saltmarsh Docks', time: 9, vehicleHealth: 0.7, ...x }), o);
  await page.waitForTimeout(4600);
  check('score block never dims (white on a dark pill, contrast 4.5 or better)', (await trOp()) > 0.97);
  await hudNow({ score: 50 });
  await page.waitForTimeout(300);
  check('score change keeps it at full strength', (await trOp()) > 0.97);
  check('speed readout in a pill beside the mini-map, top left, in a craft only', await page.evaluate(() => {
    const e = document.querySelector('.rw-speedbox');
    const r = e.getBoundingClientRect();
    return Math.abs(r.left - 100) < 2 && Math.abs(r.top - 8) < 2 && Math.abs(r.width - 88) < 2 && parseFloat(getComputedStyle(e.querySelector('.rw-speed')).fontSize) === 28;
  }));

  // HUD Full: the clock shows and the fan stays open; nothing dim.
  await page.evaluate(() => { rw.touch.setHudMode('full'); rw.hud.setHudMode('full'); });
  await page.waitForTimeout(500);
  check('Full: score block stays at full strength', (await trOp()) > 0.97);
  check('Full: clock shown', await page.locator('.rw-clock').isVisible());
  check('Full: idle buttons not shrunk or dimmed', await (async () => { const f = await face('Gas'); return f.ratio > 0.99 && f.op > 0.99; })());
  check('Full: all secondary controls visible, more button gone',
    (await page.locator('[aria-label="Handbrake"]').isVisible()) && (await page.locator('[aria-label="Horn"]').isVisible())
    && (await page.locator('[aria-label="Change camera"]').isVisible()) && (await page.locator('[aria-label="Map"]').isVisible())
    && !(await page.locator('[aria-label="More controls"]').isVisible()));
  check('Full: ammo panel shown, no reload chip', await page.locator('.rw-ammo').isVisible() && !(await page.locator('[aria-label="Reload (magazine low)"]').isVisible()));
  check('Full: mini-map stays 84 px', Math.abs((await mmSize()) - 84) <= 2, String(await mmSize()));
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
  check('chip takes the LOCK rect, left of and above FIRE, and is >= 56 px', chip.w >= 56 && Math.abs(chip.x - fireB.x) < 200 && chip.x < fireB.x && chip.y < fireB.y, JSON.stringify([chip, fireB]));
  await down(35, chip.x, chip.y);
  await up(35);
  check('chip tap presses reload', (await read("[rw.input.consume('reload'), rw.input.held('reload')]")).join() === 'true,false');
  check('foot: Minimal shows <= 8 buttons', (await buttonCount()) <= 8, String(await buttonCount()));
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
  check('drive-by FIRE on the FIRE rect, left of the pedals, bottom row', dbf.x < g3.x - 120 && Math.abs(dbf.y - g3.y) < 40 && dbf.w >= 56, JSON.stringify([dbf, g3]));
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
  check('foot FIRE takes the GAS rect, under the right thumb', ff.w >= 72 && ff.x > 915 - 150 && ff.y > 412 - 150, JSON.stringify(ff));
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
      // The real Gannetfang and Lampwatch (task 33).
      const real = (id) => ({ ...mk(id, window.__SPECS[id].kind, []), spec: window.__SPECS[id], siren: false, spotOn: false, spot: 0 });
      window.__CR.gannet = real('fighter');
      window.__CR.lamp = real('patrolheli');
      // The real Rustback (task 32).
      window.__CR.rtank = { ...mk('rustback', 'tank', []), y: 0, spec: window.__TANKS.rustback, turretYaw: 0, gunPitch: 0 };
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
    const visibleActions = async () => {
      await settleCss();
      return page.evaluate(() => [...document.querySelectorAll('.rw-touch .rw-act')]
      .filter((e) => e.offsetParent && getComputedStyle(e).visibility !== 'hidden').map((e) => e.dataset.action).sort().join());
    };
    // [craft, mode, charges, max buttons, wanted actions]. Minimal: 6 at most, except the
    // armed-aircraft arc (ARMS.md: GUN MSL BOMB LOCK, up to 9) and DETONATE (+1). From 0.5.0 every
    // plane and heli also has BOOST (docs/REVAMP.md 6.12): one more primary and 'boost' in the list.
    const cases = [
      ['fighter', 'plane', 0, 10, 'alock,bomb,boost,gun,msl'],
      ['fighter', 'plane', 2, 11, 'alock,bomb,boost,detonate,gun,msl'],
      ['police', 'heli', 0, 7, 'boost,gun'],
      ['heavy', 'heli', 0, 7, 'bomb,boost'],
      ['tank', 'tank', 0, 6, 'cannon,coax,tlock'],
      ['tank', 'tank', 1, 7, 'cannon,coax,detonate,tlock'],
      ['rtank', 'tank', 0, 6, 'cannon,coax,tlock'],
      ['rtank', 'tank', 2, 7, 'cannon,coax,detonate,tlock'],
      ['prop', 'plane', 0, 7, 'boost'],
      ['gannet', 'plane', 0, 10, 'alock,bomb,boost,gun,msl'],
      ['gannet', 'plane', 2, 11, 'alock,bomb,boost,detonate,gun,msl'],
      ['lamp', 'heli', 0, 7, 'boost,gun'],
      [null, 'foot', 0, 7, 'run,swap'],
      [null, 'foot', 3, 8, 'detonate,run,swap'],
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
          if ((!lefty || key === 'rtank') && (key === 'fighter' || key === 'tank' || key === 'rtank' || key === 'gannet' || key === 'lamp' || (mode === 'foot' && charges))) await shot(`arms-${key || 'foot'}${charges ? '-charges' : ''}${lefty ? '-lefty' : ''}-${vw}x${vh}.png`);
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
    check('GUN is the FIRE rect (64 px)', gun.w >= 64, String(gun.w));
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
    // Lampwatch: SIREN and SPOT in the more fan; real multi-touch: the stick
    // and UP held, GUN held, then SPOT tapped from the fan.
    for (const lefty of [false, true]) {
      await page.evaluate((l) => rw.touch.setLeftHanded(l), lefty);
      await setCraft('lamp', 'heli', 0);
      await page.waitForTimeout(150);
      const lgun = await at('gun');
      const sx = lefty ? 915 - 140 : 140;
      await down(51, sx, 300);
      await drag(51, sx, 300, sx, 250, 4);
      const upB = await center('Climb');
      await down(52, upB.x, upB.y);
      await down(53, lgun.x, lgun.y);
      const fl = await read('({ fire: rw.input.held("fire"), pitch: rw.input.pitch, th: rw.input.throttle })');
      check(`police heli${lefty ? ' lefty' : ''}: stick, UP and GUN at once`, fl.fire && fl.pitch > 0.3 && fl.th > 0.5, JSON.stringify(fl));
      await tapMore();
      await page.waitForTimeout(220);
      const fan = await visibleActions();
      check(`police heli${lefty ? ' lefty' : ''}: fan has SIREN and SPOT`, fan.includes('siren') && fan.includes('spot'), fan);
      await checkLayout(`police heli fan${lefty ? ' lefty' : ''}`);
      if (!lefty) await shot('arms-lamp-fan-915x412.png');
      const sp = await at('spot');
      await down(54, sp.x, sp.y);
      await up(54);
      check(`police heli${lefty ? ' lefty' : ''}: SPOT tap presses spot while flying and firing`,
        await read('rw.input.pressed("spot") && rw.input.held("fire")'));
      await up(53);
      await up(52);
      await up(51);
      await page.evaluate(() => rw.frame(1));
    }
    await page.evaluate(() => rw.touch.setLeftHanded(false));
    await setCraft('gannet', 'plane', 0);
    check('SPOT hidden in the fighter', !(await visibleActions()).includes('spot'));
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
    // The real Rustback (task 32): real multi-touch while driving, aiming
    // and firing: the stick held forward-left (pivoting), the right half
    // dragged to turn the turret, COAX held and CANNON tapped at once;
    // mirrored for left hands. Buttons within the 6-button Minimal limit.
    for (const [vw, vh] of [[915, 412], [780, 360]]) {
      await page.setViewportSize({ width: vw, height: vh });
      for (const lefty of [false, true]) {
        await page.evaluate((l) => rw.touch.setLeftHanded(l), lefty);
        await setCraft('rtank', 'tank', 0);
        await page.waitForTimeout(150);
        const tag = `rustback ${vw}x${vh}${lefty ? ' lefty' : ''}`;
        const cn = await at('cannon'), cx = await at('coax'), lk = await at('tlock');
        check(`${tag}: CANNON on the FIRE rect (64 px), COAX and LOCK >= 56 px`, cn.w >= 64 && cx.w >= 56 && lk.w >= 56, JSON.stringify([cn.w, cx.w, lk.w]));
        check(`${tag}: fire buttons on the ${lefty ? 'left' : 'right'} thumb`, lefty ? cn.x < vw / 2 && cx.x < vw / 2 : cn.x > vw / 2 && cx.x > vw / 2);
        const n = await buttonCount();
        check(`${tag}: ${n} buttons <= 6`, n <= 6, String(n));
        const sx = lefty ? vw - 140 : 140;
        await down(61, sx, vh - 110);
        await drag(61, sx, vh - 110, sx - 45, vh - 170, 5);
        await page.evaluate(() => { rw.input.lookX = 0; rw.input.lookY = 0; });
        // The look drag starts in the open middle of the aiming side.
        const lx = lefty ? vw * 0.3 : vw * 0.62, ly = vh * 0.35;
        await down(62, lx, ly);
        await drag(62, lx, ly, lx + 70, ly - 25, 6);
        await down(63, cx.x, cx.y);
        await down(64, cn.x, cn.y);
        const st2 = await read('({ t: rw.input.throttle, s: rw.input.steer, look: rw.input.lookX, lookY: rw.input.lookY, fire: rw.input.pressed("fire") || rw.input.held("fire"), coax: rw.input.held("fire2") })');
        check(`${tag}: drive, aim drag, COAX held and CANNON at once`, st2.t > 0.4 && st2.s < -0.3 && st2.look > 30 && st2.fire && st2.coax, JSON.stringify(st2));
        await up(64);
        await up(63);
        await up(62);
        await up(61);
        await page.evaluate(() => rw.frame(1));
        check(`${tag}: all released`, await read('!rw.input.held("fire") && !rw.input.held("fire2") && rw.input.throttle === 0 && rw.input.steer === 0'));
        await checkLayout(`${tag} after multi-touch`);
      }
    }
    await page.evaluate(() => rw.touch.setLeftHanded(false));
    await page.setViewportSize({ width: 915, height: 412 });
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

await liveLayout(check);

console.log(failures.length ? `\nFAILED ${failures.length}/${checks}: ${failures.join('; ')}` : `\nPASSED ${checks}/${checks} checks`);
process.exit(failures.length ? 1 : 0);
