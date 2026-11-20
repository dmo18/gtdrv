// Browser test of the pause menu and the economy, in headless Chromium.
// Bundles a small harness with esbuild, serves it, drives it with touch.
// Screenshots of every tab land in dist/menu-test/. Exits non-zero on failure.
import { build } from 'esbuild';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { readFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '..');
const out = path.join(repo, 'dist', 'menu-test');

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
    sourcefile: 'menu-harness-entry.js',
    contents: `
      import { createEvents } from './src/core/events.js';
      import { defaultProgress } from './src/core/save.js';
      import { createEconomy } from './src/systems/economy.js';
      import { createMenu } from './src/ui/menu.js';
      const root = document.createElement('div');
      root.style.cssText = 'position:fixed;inset:0;background:linear-gradient(#9fc8e8,#6d8f5a)';
      document.body.appendChild(root);
      const log = { resizes: 0, volume: null, toasts: [], touchVisible: true };
      const game = {
        events: createEvents(), progress: defaultProgress(), paused: false, quality: 1,
        player: { x: 0, z: 0 }, input: {},
        hud: { toast: (t) => log.toasts.push(t) },
        touch: { setVisible: (v) => { log.touchVisible = v; } },
        audio: { setVolume: (v) => { log.volume = v.master; } },
        resize: () => { log.resizes++; },
        activities: { courses: [{ id: 'race_harbour', name: 'Harbour Dash', type: 'race' }] },
      };
      const economy = createEconomy(game, window.localStorage);
      const menu = createMenu(root, game, economy);
      window.rw = { game, economy, menu, log };
    `,
  },
  bundle: true, platform: 'browser', format: 'esm', outfile: path.join(out, 'harness.js'),
});

const js = await readFile(path.join(out, 'harness.js'));
const html = '<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1">'
  + '<body style="margin:0"><script type="module" src="/harness.js"></script>';
const server = createServer((req, res) => {
  if (req.url === '/harness.js') res.writeHead(200, { 'content-type': 'text/javascript' }).end(js);
  else res.writeHead(200, { 'content-type': 'text/html' }).end(html);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const url = `http://127.0.0.1:${server.address().port}/`;

let checks = 0;
const failures = [];
function check(name, ok, detail = '') {
  checks++;
  if (!ok) failures.push(`${name} ${detail}`);
}

const browser = await (await loadChromium()).launch();
try {
  const ctx = await browser.newContext({ viewport: { width: 915, height: 412 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('dialog', async (d) => { errors.push('dialog: ' + d.message()); await d.dismiss(); });

  await ctx.addInitScript(() => {
    // Runs on every new document, after the old page has saved on its way out.
    if (window.name === 'tamper') {
      window.name = '';
      localStorage.setItem('rustwater.save.v1', '{"money":"1e999","owned":["jet","<img src=x onerror=alert(1)>"],"__proto__":{"polluted":1},"medals":{"<img src=x onerror=alert(2)>":"gold","bad_x":"<b>x</b>"}}');
    }
  });
  const load = async () => {
    await page.goto(url);
    await page.waitForFunction(() => window.rw);
  };
  const ev = (fn, arg) => page.evaluate(fn, arg);
  const progress = () => ev(() => JSON.parse(JSON.stringify(window.rw.game.progress)));
  const stored = () => ev(() => JSON.parse(localStorage.getItem('rustwater.save.v1') || 'null'));
  const tab = (name) => page.getByRole('tab', { name, exact: true }).tap();
  const isOpen = () => ev(() => window.rw.menu.isOpen());

  // Fresh start.
  await load();
  await ev(() => localStorage.clear());
  await load();
  check('starts closed', !(await isOpen()));
  await ev(() => { window.rw.game.paused = true; window.rw.game.events.emit('pause', true); });
  check('pause opens menu', await isOpen());
  check('touch hidden while open', (await ev(() => window.rw.log.touchVisible)) === false);

  // Every tab renders.
  const shots = async (size) => {
    for (const [name, file] of [['Resume', 'resume'], ['Showroom', 'showroom'], ['Records', 'records'], ['Settings', 'settings'], ['How to play', 'howto']]) {
      await tab(name);
      const text = await page.locator('.rw-menu-body').innerText();
      check(`tab ${name} has content`, text.length > 20);
      await page.screenshot({ path: path.join(out, `${file}-${size}.png`) });
    }
  };
  await ev(() => {
    const g = window.rw.game;
    g.progress.medals.race_harbour = 'gold';
    g.progress.medals.air_loop = 'silver';
    g.progress.bestTimes.race_harbour = 83.4;
    g.progress.medals.seen_docks = 'bronze';
    g.progress.stats.distance = 12345;
    window.rw.game.events.emit('progress');
  });
  await shots('915x412');
  await tab('Records');
  const rec = await page.locator('.rw-menu-body').innerText();
  check('records show nice name', rec.includes('Harbour Dash'), rec);
  check('records prettify ids', rec.includes('Air Loop'), rec);
  check('records distance km', rec.includes('12.3 km'), rec);

  // Poor: cannot buy.
  await tab('Showroom');
  const yachtBtn = page.locator('[data-buy="yacht"]');
  check('too poor is disabled', await yachtBtn.isDisabled());
  check('too poor text', /Need \$6,\d+ more/.test(await yachtBtn.innerText()), await yachtBtn.innerText());
  check('buy refused', (await ev(() => window.rw.economy.buy('jet'))) === false);
  check('money unchanged', (await progress()).money === 250);

  // Resume button unpauses.
  await tab('Resume');
  await page.locator('[data-role="resume"]').tap();
  check('resume closes', !(await isOpen()));
  check('resume unpauses', (await ev(() => window.rw.game.paused)) === false);
  check('touch back', (await ev(() => window.rw.log.touchVisible)) === true);

  // Rich: buy persists across reload.
  await ev(() => { window.rw.game.progress.money = 10000; window.rw.economy.save(); });
  await load();
  check('money restored', (await progress()).money === 10000);
  await ev(() => { window.rw.game.paused = true; window.rw.game.events.emit('pause', true); });
  await tab('Showroom');
  const purchases = await ev(() => { window.rw.log.bought = 0; window.rw.game.events.on('purchase', () => window.rw.log.bought++); });
  void purchases;
  await page.locator('[data-buy="jet"]').tap();
  let pr = await progress();
  check('buy deducts', pr.money === 1000, String(pr.money));
  check('buy owns', pr.owned.includes('jet'));
  check('purchase event', (await ev(() => window.rw.log.bought)) === 1);
  check('owned label', (await page.locator('[data-buy="jet"]').innerText()) === 'Owned');
  check('owned disabled', await page.locator('[data-buy="jet"]').isDisabled());
  check('double buy refused', (await ev(() => window.rw.economy.buy('jet'))) === false);
  await page.screenshot({ path: path.join(out, 'showroom-bought-915x412.png') });
  await load();
  pr = await progress();
  check('purchase persists', pr.owned.includes('jet') && pr.money === 1000, JSON.stringify(pr));

  // Settings persist.
  await ev(() => { window.rw.game.paused = true; window.rw.game.events.emit('pause', true); });
  await tab('Settings');
  await page.locator('[data-setting="invertPitch"]').tap();
  await page.locator('[data-setting="leftHanded"]').tap();
  await page.locator('[data-setting="police"]').tap();
  await page.locator('[data-quality="1.25"]').tap();
  await ev(() => {
    const s = document.querySelector('[data-setting="master"]');
    s.value = '35';
    s.dispatchEvent(new Event('input', { bubbles: true }));
    s.dispatchEvent(new Event('change', { bubbles: true }));
  });
  let st = (await progress()).settings;
  check('settings applied', st.invertPitch && st.leftHanded && !st.police && st.quality === 1.25 && Math.abs(st.master - 0.35) < 1e-9, JSON.stringify(st));
  check('quality applied to game', (await ev(() => window.rw.game.quality)) === 1.25 && (await ev(() => window.rw.log.resizes)) > 0);
  check('volume applied', Math.abs((await ev(() => window.rw.log.volume)) - 0.35) < 1e-9);
  check('invert applied', (await ev(() => window.rw.game.input.invertPitch)) === true);
  await tab('How to play');
  check('howto matches invert', (await page.locator('.rw-menu-body').innerText()).includes('Pull the stick down to climb'));
  await load();
  st = (await progress()).settings;
  check('settings persist', st.invertPitch && st.leftHanded && !st.police && st.quality === 1.25 && Math.abs(st.master - 0.35) < 1e-9, JSON.stringify(st));
  check('quality restored to game', (await ev(() => window.rw.game.quality)) === 1.25);

  // Reset needs two steps.
  await ev(() => { window.rw.game.paused = true; window.rw.game.events.emit('pause', true); });
  await tab('Settings');
  await ev(() => { window.refP = window.rw.game.progress; window.refO = window.rw.game.progress.owned; });
  await page.locator('[data-role="reset"]').tap();
  check('reset first step keeps data', (await progress()).owned.includes('jet'));
  await page.screenshot({ path: path.join(out, 'settings-confirm-915x412.png') });
  await page.locator('[data-role="reset-confirm"]').tap();
  pr = await progress();
  check('reset clears', pr.money === 250 && pr.owned.length === 0 && pr.settings.quality === 1 && pr.settings.police === true, JSON.stringify(pr));
  const sv = await stored();
  check('reset saved', sv && sv.money === 250 && sv.owned.length === 0);
  check('progress object kept in place', await ev(() => window.rw.game.progress === window.refP && window.rw.game.progress.owned === window.refO));

  // Tampered storage.
  await page.evaluate(() => { window.name = 'tamper'; });
  await load();
  pr = await progress();
  check('tamper: money safe', pr.money === 250, String(pr.money));
  check('tamper: owned filtered', JSON.stringify(pr.owned) === '["jet"]', JSON.stringify(pr.owned));
  check('tamper: medals clean', Object.keys(pr.medals).length === 0);
  check('tamper: no pollution', await ev(() => ({}).polluted === undefined));
  await ev(() => { window.rw.game.paused = true; window.rw.game.events.emit('pause', true); });
  for (const n of ['Showroom', 'Records', 'Settings']) await tab(n);
  check('tamper: nothing executed', await ev(() => !document.querySelector('.rw-menu img')));
  await page.waitForTimeout(200);

  // Smaller phone.
  await page.setViewportSize({ width: 780, height: 360 });
  await shots('780x360');
  // Layout: nothing wider than the screen, content scrolls instead of being cut.
  for (const size of [{ width: 915, height: 412 }, { width: 780, height: 360 }]) {
    await page.setViewportSize(size);
    for (const n of ['Resume', 'Showroom', 'Records', 'Settings', 'How to play']) {
      await tab(n);
      const m = await ev(() => {
        const b = document.querySelector('.rw-menu-body');
        const bad = [];
        const r = b.getBoundingClientRect();
        for (const e of b.querySelectorAll('button')) {
          const q = e.getBoundingClientRect();
          if (q.right > r.right + 1 || q.left < r.left - 1) bad.push(e.textContent);
          if (q.height < 55.5) bad.push('short:' + e.textContent);
        }
        return { bad, over: document.documentElement.scrollWidth > innerWidth, sx: b.scrollWidth > b.clientWidth + 1 };
      });
      check(`layout ${n} ${size.width}`, !m.bad.length && !m.over && !m.sx, JSON.stringify(m));
    }
  }

  check('no page errors', errors.length === 0, errors.join(' | '));
} catch (e) {
  failures.push('exception: ' + (e && e.stack || e));
} finally {
  await browser.close();
  server.close();
}

if (failures.length) {
  console.error(`menu-test FAILED (${failures.length} of ${checks}):\n- ` + failures.join('\n- '));
  process.exit(1);
}
console.log(`menu-test ok: ${checks} checks, screenshots in dist/menu-test/`);
