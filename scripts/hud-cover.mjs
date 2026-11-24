// HUD coverage (docs/PLAN_V4.md task 6): the share of the screen under painted HUD
// pieces (buttons, pills, the minimap, the steering wheel, text), measured as the union
// of their boxes on the built game at phone sizes in foot, car, boat, tank, helicopter
// and plane, Minimal HUD, right-handed, fan closed. A box is painted when it has a
// background, a border, text or a drawn image. Invisible hit areas (the steering zone,
// the look area) do not count. Fails over the limit (22 percent).
// Usage: node scripts/hud-cover.mjs [--no-build] [--limit 22]
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildGame, serve } from './build.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.join(here, '..', 'dist', 'hud-cover');
const args = process.argv.slice(2);
const LIMIT = args.includes('--limit') ? Number(args[args.indexOf('--limit') + 1]) : 22;
const SIZES = [[915, 412], [780, 360], [748, 360]];
let chromium;
try { ({ chromium } = await import('playwright')); } catch { ({ chromium } = createRequire('/opt/node-tools/node_modules/')('playwright')); }
if (!args.includes('--no-build')) await buildGame({ outDir: out });
const srv = await serve(0, out);
const base = `http://127.0.0.1:${srv.address().port}/`;
const br = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
let worst = 0;
const rows = [];
try {
  for (const [W, H] of SIZES) {
    const ctx = await br.newContext({ viewport: { width: W, height: H }, hasTouch: true, isMobile: true, deviceScaleFactor: 1 });
    const pg = await ctx.newPage();
    await pg.goto(`${base}?autostart&map=miami-downtown`);
    await pg.waitForFunction(() => window.__rw && window.__rw.loop.running, null, { timeout: 120000 });
    await pg.waitForTimeout(1200);
    await pg.waitForFunction(() => !window.__rw.fleet || window.__rw.fleet.ready, null, { timeout: 240000 });
    await pg.evaluate(() => { const g = window.__rw; g.loop.stop(); g.touch.setHudMode('minimal'); g.hud.setHudMode('minimal'); g.touch.setLeftHanded(false); });
    for (const [name, kind] of [['foot', 'foot'], ['car', 'car'], ['boat', 'boat'], ['tank', 'tank'], ['heli', 'heli'], ['plane', 'plane']]) {
      const pct = await pg.evaluate(([k]) => {
        const g = window.__rw;
        if (k === 'foot') { g.player.vehicle = null; g.setPlayerMode('foot'); } else {
          const n = (x) => (x.spec && x.spec.mounts ? x.spec.mounts.length : 0);
          let v = null;
          for (const x of g.vehicles) if (x.kind === k && (!v || n(x) > n(v))) v = x;
          if (!v) return -1;
          g.enterVehicle(v);
        }
        // a normal play moment: speed, health bar, score, a street name, a GPS turn
        g.hud.update({ ...g.hudState, mode: k === 'foot' ? 'foot' : 'car', speedKmh: 60, mortal: false, health: 100, maxHealth: 100, boost: ['car', 'boat', 'plane', 'heli'].includes(k) ? 0.8 : -1 });
        if (g.hud.setStreet) g.hud.setStreet('Alton Rd', '5th St');
        if (g.hud.setNav) g.hud.setNav(true, 'right', '300 ft · Alton Rd', '', false);
        g.touch.update(1 / 60);
        const root = document.getElementById('ui');
        const grid = new Uint8Array(innerWidth * innerHeight);
        let boxes = 0;
        const painted = (e, cs) => {
          if (e.tagName === 'CANVAS' || e.tagName === 'svg' || e.tagName === 'IMG') return e.tagName !== 'svg' || true;
          const a = (c) => { const m = /rgba?\(([^)]+)\)/.exec(c); if (!m) return 0; const p = m[1].split(',').map(Number); return p.length > 3 ? p[3] : 1; };
          if (a(cs.backgroundColor) > 0.04 || (cs.backgroundImage && cs.backgroundImage !== 'none')) return true;
          if (parseFloat(cs.borderTopWidth) > 0 && a(cs.borderTopColor) > 0.04 && cs.borderTopStyle !== 'none') return true;
          for (const n of e.childNodes) if (n.nodeType === 3 && n.nodeValue.trim()) return true;
          return false;
        };
        for (const e of root.querySelectorAll('*')) {
          if (e.closest('svg') && e.tagName !== 'svg') continue;
          const cs = getComputedStyle(e);
          if (cs.display === 'none' || cs.visibility === 'hidden') continue;
          let op = 1;
          for (let p = e; p && p !== root; p = p.parentElement) { const s = getComputedStyle(p); op *= Number(s.opacity); if (s.display === 'none' || s.visibility === 'hidden') { op = 0; break; } }
          if (op < 0.05) continue;
          if (e.classList.contains('rw-stickzone') || e.classList.contains('rw-look') || e.classList.contains('rw-touch')) continue;
          if (e.closest('.rw-none') || e.closest('[hidden]') || e.closest('.rw-ww')) continue;
          const r = e.getBoundingClientRect();
          if (r.width < 2 || r.height < 2 || r.width >= innerWidth * 0.95 || !painted(e, cs)) continue;
          boxes++;
          const x0 = Math.max(0, Math.floor(r.left)), x1 = Math.min(innerWidth, Math.ceil(r.right)), y0 = Math.max(0, Math.floor(r.top)), y1 = Math.min(innerHeight, Math.ceil(r.bottom));
          for (let y = y0; y < y1; y++) grid.fill(1, y * innerWidth + x0, y * innerWidth + x1);
        }
        let n = 0;
        for (let i = 0; i < grid.length; i++) n += grid[i];
        return { pct: (100 * n) / grid.length, boxes };
      }, [kind]);
      if (pct === -1) { rows.push(`${W}x${H} ${name}: no craft`); continue; }
      worst = Math.max(worst, pct.pct);
      rows.push(`${W}x${H} ${name.padEnd(5)} ${pct.pct.toFixed(1)} percent (${pct.boxes} painted boxes)`);
    }
    await ctx.close();
  }
} finally {
  await br.close();
  srv.close();
}
console.log(rows.join('\n'));
console.log(`worst ${worst.toFixed(1)} percent, limit ${LIMIT}`);
process.exit(worst > LIMIT ? 1 : 0);
