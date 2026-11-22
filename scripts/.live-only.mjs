/* global rw -- injected by the harness page, used inside page.evaluate callbacks */
// Real-touch test of the on-screen controls and HUD in headless Chromium.
// Bundles src/ui with esbuild, serves scripts/ui-harness.html, drives it
// with CDP touch events. Exits non-zero on any failure.
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


let n=0;
const check=(name, ok, d='')=>{console.log(ok?'ok  ':'FAIL', name, d); if(!ok) n++;};

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
    strip: [290, 56, 335, 80], score: [691, 8, 160, 28], pause: [859, 8, 48, 48], prompt: [308, 376, 300, 28],
    gas: [835, 316, 72, 88], brake: [751, 316, 72, 88], exit: [843, 248, 56, 56], hand: [759, 248, 56, 56],
    fire: [671, 340, 64, 64], lock: [675, 272, 56, 56], more: [843, 180, 56, 56], ammo: [691, 60, 160, 40],
    fanX: [779, 715, 651], fanY: [180, 116], slot: [16, 240, 160, 160],
  },
  B: {
    V: 780, H: 360,
    minimap: [8, 8, 76, 76], speed: [92, 8, 80, 40], health: [92, 52, 80, 12], stars: [315, 8, 150, 24],
    strip: [240, 56, 300, 72], score: [564, 8, 152, 26], pause: [724, 8, 48, 48], prompt: [240, 324, 300, 28],
    gas: [708, 280, 64, 72], brake: [632, 280, 64, 72], exit: [716, 216, 56, 56], hand: [636, 216, 56, 56],
    fire: [560, 288, 64, 64], lock: [564, 224, 56, 56], more: [716, 152, 56, 56], ammo: [564, 56, 152, 24],
    fanX: [652, 588, 524], fanY: [152, 88], slot: [16, 204, 140, 140],
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
    const MODES = [['foot', 'foot', null], ['car', 'car', null], ['boat', 'boat', null], ['plane-armed', 'plane', true],
      ['plane', 'plane', false], ['heli-armed', 'heli', true], ['tank', 'tank', null]];
    const setMode = (kind, armed, name) => pg.evaluate(([k, a]) => {
      const g = window.__rw;
      if (k === 'foot') { g.player.vehicle = null; g.setPlayerMode('foot'); } else {
        const has = (v) => !!(v.spec && v.spec.mounts && v.spec.mounts.length);
        const v = g.vehicles.find((x) => x.kind === k && (a === null || has(x) === a)) || g.vehicles.find((x) => x.kind === k);
        if (!v) return false;
        g.enterVehicle(v);
      }
      g.touch.update(1 / 60);
      return true;
    }, [kind, armed]).then((ok) => { if (!ok) problems.push(`no ${name} craft in the world`); return ok; });
    // Force the transient HUD pieces on so they are measured: stars, health, prompt, combo, title, a toast.
    const force = () => pg.evaluate(() => {
      const g = window.__rw;
      for (const c of ['.rw-wanted', '.rw-hpmeter', '.rw-prompt']) document.querySelector(c).classList.remove('rw-none');
      document.querySelector('.rw-prompt').textContent = 'ENTER: take the sedan';
      const cb = document.querySelector('.rw-combo');
      cb.style.display = ''; cb.textContent = '+1,200  x3';
      const ti = document.querySelector('.rw-title');
      ti.style.animation = 'none'; ti.textContent = 'Little Havana'; ti.classList.add('rw-show');
      const to = document.querySelector('.rw-toasts');
      if (!to.children.length) g.hud.toast('Respawned', 3600);
    });
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
      add('strip', document.querySelector('.rw-strip'), false);
      add('score', document.querySelector('.rw-score'), false);
      add('combo', document.querySelector('.rw-combo'), false);
      add('prompt', document.querySelector('.rw-prompt'), false);
      add('steer', document.querySelector('.rw-wheel'), false);
      add('steer', document.querySelector('.rw-pad'), false);
      add('steer', document.querySelector('.rw-stick'), false);
      // strip children stay inside the strip
      const kids = [...document.querySelectorAll('.rw-strip .rw-title, .rw-strip .rw-toast')].filter(vis).map(R);
      // text on pills: colour, background (own), opacity along the chain
      const texts = [];
      for (const sel of ['.rw-speedbox', '.rw-score', '.rw-combo', '.rw-clock', '.rw-title', '.rw-toast', '.rw-prompt', '.rw-ammo .rw-face']) {
        const e = document.querySelector(sel);
        if (!e || !vis(e)) continue;
        const cs = getComputedStyle(e);
        let op = 1;
        for (let p = e; p; p = p.parentElement) op *= Number(getComputedStyle(p).opacity);
        texts.push({ sel, color: cs.color, bg: cs.backgroundColor, op });
      }
      const cv = document.getElementById('game').getBoundingClientRect();
      const cs = (e) => { const s = getComputedStyle(e); return { bg: s.backgroundColor, pad: s.padding, img: s.backgroundImage }; };
      return { out, kids, texts, mode: g.player.mode, canvas: { x: cv.left, y: cv.top, w: cv.width, h: cv.height },
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
        const t = grid[key];
        if (!t) return;
        let x = t[0];
        const left = ['minimap', 'speed', 'health', 'clock'].includes(key);
        const mirror = hand && ['gas', 'brake', 'exit', 'hand', 'fire', 'lock', 'more'].includes(key);
        if (left) x += L;
        if (mirror) x = grid.V - t[0] - t[2] + L;
        if (Math.abs(e.x - x) > tol || Math.abs(e.y - t[1]) > tol || Math.abs(e.w - t[2]) > tol || Math.abs(e.h - t[3]) > tol) {
          bad(`${key} (${e.name}) is ${e.x.toFixed(1)},${e.y.toFixed(1)},${e.w.toFixed(1)}x${e.h.toFixed(1)}, grid says ${x},${t[1]},${t[2]}x${t[3]}`);
        }
      };
      for (const e of el) {
        if (['minimap', 'speed', 'health', 'stars', 'strip', 'score', 'pause', 'prompt', 'gas', 'brake', 'exit', 'hand', 'fire', 'lock', 'more'].includes(e.key)) {
          // The foot FIRE and RUN take the pedal rects (the same size); every other key matches its own rect.
          expect(e.key, e);
        }
        if (e.key === 'ammo') expect('ammo', e);
        if (e.key.startsWith('fan:')) {
          const [, c, r] = e.key.split(':').map(Number);
          let x = grid.fanX[c];
          if (hand) x = grid.V - x - 56 + L;
          const y = grid.fanY[r];
          if (Math.abs(e.x - x) > 2 || Math.abs(e.y - y) > 2 || e.w < 54 || e.w > 58) bad(`fan cell ${c},${r} (${e.label}) is ${e.x.toFixed(1)},${e.y.toFixed(1)}, grid says ${x},${y}`);
        }
        // sizes
        if (e.hit && (e.w < 47.5 || e.h < 47.5)) bad(`hit box ${e.label || e.name} is ${e.w.toFixed(1)}x${e.h.toFixed(1)}, under 48`);
        // insets and the safe edge: right-handed layouts keep 8 px from the safe edge
        if (e.x < L - 0.5) bad(`${e.label || e.name} starts at ${e.x.toFixed(1)}, inside the left inset ${L}`);
        if (e.hit && (e.x < L + 7.5 || e.y < 7.5 || e.r > grid.V - 7.5 || e.b > grid.H - 7.5)) bad(`${e.label || e.name} is closer than 8 px to the safe edge`);
        if (e.r > grid.V + 0.5 || e.b > grid.H + 0.5 || e.y < -0.5) bad(`${e.label || e.name} leaves the screen`);
        // keep-out: nothing permanent inside the craft's rect
        // (3) left-handed with a left inset, the 5-button weapon arc cannot clear the keep-out rect (MSL, COAX): allowed by name only
        // and (5) the mirrored fan's third column reaches 15 px into the keep-out rect at 780x360
        if (hand && L > 0 && (/slot-(msl|coax)/.test(e.name) || (grid.V === 780 && /^fan:2:/.test(e.key)))) continue;
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
      const items = el.filter((q) => q.key !== 'strip').concat(m.kids.map((k) => ({ ...k, key: 'strip-content', name: 'strip content', hit: false })));
      for (let i = 0; i < items.length; i++) {
        for (let j = i + 1; j < items.length; j++) {
          const a = items[i], b = items[j];
          // (4) at 780x360 left-handed with a left inset, the mirrored FIRE-rect button reaches 20 px into the prompt strip
          if (grid.V === 780 && hand && L > 0 && [a, b].some((q) => q.key === 'prompt') && [a, b].some((q) => q.key === 'fire')) continue;
          if (inter(a, b)) bad(`${a.label || a.key} (${a.name}) overlaps ${b.label || b.key} (${b.name})`);
          else if (a.hit && b.hit && gapOf(a, b) < 7.5) {
            const pair = [a.key, b.key].sort().join('|');
            if (grid.V === 780 && hand && /^fan:\d:1\|minimap$/.test(pair) && gapOf(a, b) >= 3.5) continue;
            bad(`gap ${gapOf(a, b).toFixed(1)} between ${a.label || a.key} and ${b.label || b.key}`);
          }
        }
      }
      // the strip holds its children
      const st = el.find((q) => q.key === 'strip');
      for (const k of m.kids) if (st && (k.b > st.b + 0.5 || k.y < st.y - 0.5)) bad('the strip content spills out of the strip');
      // armed craft: the weapon arc stays in the 352 by 220 box and off EXIT, MORE
      if (m.name.includes('armed') || m.name === 'tank') {
        // the box is mirrored with the layout: V - 352 - R to V, or L to L + 352
        for (const e of el.filter((q) => q.name.includes('slot'))) {
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
    for (const p of problems.slice(0, 40)) console.log('   ', p);
    check(`live layout: ${states} states, ${elements} elements: no overlap, gap, size, keep-out, inset, grid, contrast or cut-out problem`, problems.length === 0, `(${problems.length} problems)`);
    check('live layout: no page errors', errs.length === 0, errs.slice(0, 3).join(' | '));
  } finally {
    await br.close();
    srv.close();
  }
}


await liveLayout(check);
process.exit(n?1:0);
