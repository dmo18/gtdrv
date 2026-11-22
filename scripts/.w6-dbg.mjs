import { createRequire } from 'node:module';
import { buildGame, serve } from './build.mjs';
let chromium;
try { ({ chromium } = await import('playwright')); } catch { ({ chromium } = createRequire('/opt/node-tools/node_modules/')('playwright')); }
const OUT = '/tmp/claude-0/-home-user-gtdrv/63a8be28-ec23-56bc-ab33-a9ab62ddd4c3/scratchpad/dist';
await buildGame({ minify: false, outDir: OUT });
{
  const fs = await import('node:fs');
  let t = fs.readFileSync(OUT + '/game.js', 'utf8');
  t = t.replaceAll('} else if (material.visibleXX) {', '} else if (!material) { let o = object, p = []; while (o) { p.push((o.name || o.type) + (o.userData && o.userData.kind ? ":" + o.userData.kind : "")); o = o.parent; } console.log("NOMAT", p.join(" < "), object.geometry && object.geometry.type); } else if (material.visible) {');
  fs.writeFileSync(OUT + '/game.js', t);
}
const server = await serve(0, OUT);
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 915, height: 412 }, hasTouch: true, isMobile: true, deviceScaleFactor: 1 });
page.on('pageerror', (e) => console.log('pageerror', e.stack || String(e)));
page.on('console', (m) => { if (m.text().startsWith('NOMAT')) console.log(m.text()); if (m.type() === 'error') console.log('console.error', m.text().slice(0, 2000)); });
await page.goto(`http://127.0.0.1:${server.address().port}/?autostart`);
await page.waitForTimeout(15000);
console.log(await page.evaluate(() => {
  const g = window.__rw;
  if (!g) return 'no __rw';
  const out = [];
  const walk = (o, path) => { (o.children || []).forEach((c, i) => { if (!c) out.push(path + '/' + i + ' undefined (parent ' + o.type + ' ' + o.name + ' n=' + o.children.length + ')'); else walk(c, path + '/' + (c.name || c.type)); }); };
  walk(g.scene, 'scene');
  return out.join('\n') || 'none';
}));
await browser.close();
server.close();
