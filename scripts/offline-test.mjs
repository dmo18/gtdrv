// Proves the service worker gives full offline play: load the built game
// over http, wait for the worker to take control, go offline, reload, and
// check the game still starts and nothing was fetched from outside.
// usage: node scripts/offline-test.mjs
import { createRequire } from 'node:module';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildGame, serve } from './build.mjs';

let chromium;
try {
  ({ chromium } = await import('playwright'));
} catch {
  ({ chromium } = createRequire('/opt/node-tools/node_modules/')('playwright'));
}
// Own output folder: dist/ is shared with other test scripts that rebuild it.
const out = await mkdtemp(join(tmpdir(), 'rw-offline-'));
await buildGame({ outDir: out });
const server = await serve(0, out);
const base = `http://127.0.0.1:${server.address().port}/`;
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const context = await browser.newContext({ viewport: { width: 915, height: 412 }, hasTouch: true, isMobile: true });
const page = await context.newPage();
const errors = [];
const outside = [];
page.on('crash', () => console.log('PAGE CRASH'));
page.on('close', () => console.log('PAGE CLOSED'));
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
page.on('request', (r) => {
  if (!r.url().startsWith(base) && !r.url().startsWith('data:') && !r.url().startsWith('blob:')) outside.push(r.url());
});
let failed = false;
const check = (ok, label) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}`);
  if (!ok) failed = true;
};
try {
  await page.goto(`${base}?pwa`);
  console.log('step: loaded');
  await page.waitForFunction(() => window.__rw, null, { timeout: 30000 });
  console.log('step: game object ready');
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.waitForFunction(() => !!navigator.serviceWorker.controller, null, { timeout: 60000 });
  const ctl = await page.evaluate(async () => {
    const names = await caches.keys();
    const cache = await caches.open(names[0]);
    return { caches: names, files: (await cache.keys()).length };
  });
  check(ctl.caches.length === 1 && ctl.files >= 15, `worker active, cache ${ctl.caches[0]} holds ${ctl.files} files`);
  await context.setOffline(true);
  await page.goto(`${base}?pwa&autostart`);
  await page.waitForFunction(() => window.__rw && window.__rw.loop.running, null, { timeout: 30000 });
  await page.waitForTimeout(1500);
  const state = await page.evaluate(() => ({ t: window.__rw.time, ctl: !!navigator.serviceWorker.controller }));
  check(state.ctl, 'page is controlled by the service worker');
  check(true, 'offline reload: the game started and is running');
  const probe = await page.evaluate(() => caches.match('privacy.html', { ignoreSearch: true }).then((r) => (r ? r.status : -1)));
  check(probe === 200, `privacy page held in the offline cache (${probe})`);
  const manifest = await page.evaluate(() => caches.match('manifest.webmanifest').then((r) => r.json()).then((j) => j.name));
  check(manifest === 'Rustwater', 'manifest held in the offline cache');
  check(outside.length === 0, `no outside requests (${outside.length})`);
  check(errors.length === 0, `no page errors (${errors.length})`);
  errors.slice(0, 5).forEach((e) => console.log('   ', e));
} catch (e) {
  console.log('FAIL', e.message);
  failed = true;
} finally {
  await browser.close();
  server.close();
  await rm(out, { recursive: true, force: true });
}
process.exit(failed ? 1 : 0);
