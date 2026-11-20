// Targeted check of the SWAP weapon wheel in the real game (915x412, touch):
// a long press opens it, a drag picks a slice, lifting selects and toasts.
// Writes docs/preview/weapon-wheel-open.png and weapon-wheel-selected.png.
import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';
import { buildGame, serve } from './build.mjs';

let chromium;
try {
  ({ chromium } = await import('playwright'));
} catch {
  ({ chromium } = createRequire('/opt/node-tools/node_modules/')('playwright'));
}
const hud = process.argv.includes('--full') ? 'full' : 'minimal';
const W = Number(process.argv.find((a) => a.startsWith('--w='))?.slice(4)) || 915;
const H = Number(process.argv.find((a) => a.startsWith('--h='))?.slice(4)) || 412;
const tag = process.argv.includes('--tag') ? process.argv[process.argv.indexOf('--tag') + 1] : '';
await buildGame({ minify: false });
const server = await serve(0);
await mkdir('docs/preview', { recursive: true });
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const ctx = await browser.newContext({ viewport: { width: W, height: H }, hasTouch: true, isMobile: true, deviceScaleFactor: 1 });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
let failed = false;
const check = (ok, label) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}`); if (!ok) failed = true; };
await page.goto(`http://127.0.0.1:${server.address().port}/?autostart`);
await page.waitForFunction(() => window.__rw && window.__rw.loop.running, null, { timeout: 120000 });
await page.waitForTimeout(1500);
await page.evaluate((m) => {
  const g = window.__rw;
  const p = g.player;
  if (p.vehicle) { p.vehicle.driver = null; p.vehicle = null; g.setPlayerMode('foot'); }
  g.touch.setHudMode(m);
  g.loop.stop(); // the software renderer would starve the pointer events
  for (let i = 0; i < 30; i++) g.step(1 / 60);
}, hud);
await page.waitForTimeout(800);
const cdp = await ctx.newCDPSession(page);
const touch = (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y, id: 1 }] });
const rect = (sel) => page.evaluate((s) => { const r = document.querySelector(s).getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; }, sel);
const weapon = () => page.evaluate(() => window.__rw.player.walker.arms.weapon);
const toasts = () => page.evaluate(() => [...document.querySelectorAll('.rw-toast')].map((t) => t.textContent));
const wheelOpen = () => page.evaluate(() => document.querySelector('.rw-ww').classList.contains('rw-ww-open'));
const hidden = () => page.evaluate(() => document.querySelector('.rw-ww').getAttribute('aria-hidden'));

async function openFan() {
  const open = await page.evaluate(() => window.__rw.touch.isFanOpen());
  if (hud === 'minimal' && !open) {
    const m = await rect('.rw-more');
    await touch('touchStart', m.x + m.w / 2, m.y + m.h / 2);
    await touch('touchEnd');
    await page.waitForTimeout(350);
  }
}
const center = (r) => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });

// 1. quick tap still cycles
await openFan();
const w0 = await weapon();
let sw = center(await rect('.rw-a-swap'));
await touch('touchStart', sw.x, sw.y);
await page.waitForTimeout(80);
await touch('touchEnd');
await page.evaluate(() => { for (let i = 0; i < 3; i++) window.__rw.step(1 / 60); });
await page.waitForTimeout(300);
const w1 = await weapon();
check(w1 !== w0, `tap cycles weapon (${w0} -> ${w1})`);
check(!(await wheelOpen()), 'tap does not open the wheel');
check((await hidden()) === 'true', 'wheel aria-hidden while closed');

// 2. long press opens, drag to slice 3, screenshot, lift
await page.evaluate(() => window.__rw.player.walker.arms.weapon = 'pistol');
await page.waitForTimeout(100);
await openFan();
sw = center(await rect('.rw-a-swap'));
await touch('touchStart', sw.x, sw.y);
await page.waitForTimeout(150);
check(!(await wheelOpen()), 'not open at 150 ms');
await page.waitForTimeout(300);
check(await wheelOpen(), 'open after a long press');
check((await hidden()) === 'false', 'aria-hidden false while open');
const ring = await rect('.rw-ww');
const c = { x: ring.x + ring.w / 2, y: ring.y + ring.h / 2 };
const fire = await rect('.rw-fire');
const pause = await rect('.rw-pause');
const hit = (a, b) => !(a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y);
// the drawn disc is a circle: test circle against the rects
const circ = (r) => { const nx = Math.min(r.x + r.w, Math.max(r.x, c.x)), ny = Math.min(r.y + r.h, Math.max(r.y, c.y)); return Math.hypot(c.x - nx, c.y - ny) < 108; };
check(!circ(fire), 'ring clear of FIRE');
check(!circ(pause), 'ring clear of pause');
check(ring.x >= 0 && ring.y >= 0 && ring.x + ring.w <= W && ring.y + ring.h <= H, 'ring fully on screen');
void hit;
await page.screenshot({ path: `docs/preview/weapon-wheel-open${tag}.png` });
const slices = await page.evaluate(() => [...document.querySelectorAll('.rw-ww-slice')].map((s) => s.getAttribute('aria-label')));
check(slices.length === 7 && slices.every(Boolean), `7 labelled slices (${slices.join(', ')})`);
const target = 3; // Barnyard Thumper
const a = (target * 2 * Math.PI) / 7;
const tx = c.x + Math.sin(a) * 74, ty = c.y - Math.cos(a) * 74;
for (let i = 1; i <= 6; i++) await touch('touchMove', sw.x + ((tx - sw.x) * i) / 6, sw.y + ((ty - sw.y) * i) / 6);
await page.waitForTimeout(150);
const sel = await page.evaluate(() => ({ s: document.querySelector('.rw-ww-slice.rw-sel')?.getAttribute('aria-label'), l: document.querySelector('.rw-ww-label').textContent }));
check(sel.s === 'Barnyard Thumper' && sel.l === 'Barnyard Thumper', `highlighted slice and centre name (${JSON.stringify(sel)})`);
await page.screenshot({ path: `docs/preview/weapon-wheel-selected${tag}.png` });
await touch('touchEnd', tx, ty);
await page.waitForTimeout(400);
check((await weapon()) === 'scatter', `lift selects (${await weapon()})`);
check(!(await wheelOpen()), 'wheel closed after lift');
const t1 = await toasts();
check(t1.includes('Barnyard Thumper'), `toast shows the name (${t1.join('|')})`);
await page.screenshot({ path: `docs/preview/weapon-wheel-toast${tag}.png` });

// 3. dead zone keeps, outer ring cancels
for (const [label, off] of [['dead zone', 0], ['outer ring', 160]]) {
  await page.evaluate(() => window.__rw.player.walker.arms.weapon = 'smg');
  await openFan();
  sw = center(await rect('.rw-a-swap'));
  await touch('touchStart', sw.x, sw.y);
  await page.waitForTimeout(450);
  const r2 = await rect('.rw-ww');
  const c2 = { x: r2.x + r2.w / 2, y: r2.y + r2.h / 2 };
  const ex = off ? c2.x + Math.sin(2.0) * off : c2.x + 5, ey = off ? c2.y - Math.cos(2.0) * off : c2.y + 5;
  await touch('touchMove', ex, ey);
  await page.waitForTimeout(100);
  await touch('touchEnd', ex, ey);
  await page.waitForTimeout(300);
  check((await weapon()) === 'smg', `${label}: weapon kept (${await weapon()})`);
  check(!(await wheelOpen()), `${label}: wheel closed`);
}

// 4. blur closes the wheel without a change
await openFan();
sw = center(await rect('.rw-a-swap'));
await touch('touchStart', sw.x, sw.y);
await page.waitForTimeout(450);
check(await wheelOpen(), 'open again');
await page.evaluate(() => window.dispatchEvent(new Event('blur')));
await page.waitForTimeout(100);
check(!(await wheelOpen()), 'blur closes the wheel');
await touch('touchEnd');
check((await weapon()) === 'smg', 'blur: weapon kept');

check(errors.length === 0, `no page errors (${errors.length})`);
for (const e of errors.slice(0, 5)) console.log('   ', e);
await browser.close();
server.close();
process.exit(failed ? 1 : 0);
